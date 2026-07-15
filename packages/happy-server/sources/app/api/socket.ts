import { onShutdown } from "@/utils/shutdown";
import { Fastify } from "./types";
import { buildMachineActivityEphemeral, createEventRouter, type ClientConnection } from "@/app/events/eventRouter";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-streams-adapter";
import { Redis } from "ioredis";
import { log } from "@/utils/log";
import { getMetricsLabelsFromSocket, redisStreamLagMsGauge, websocketConnectionsGauge, websocketEventsCounter } from "../monitoring/metrics2";
import { rpcHandler } from "./socket/rpcHandler";
import { pingHandler } from "./socket/pingHandler";
import { sessionUpdateHandler } from "./socket/sessionUpdateHandler";
import { machineUpdateHandler } from "./socket/machineUpdateHandler";
import { sessionMessageRangeHandler } from "./socket/sessionMessageRangeHandler";
import type { TofuHandshakeConfig } from "./api";
import { makeLoopbackSocketVerifier, type LoopbackCapabilityPaths } from "./auth/loopbackCapability";
import { verifyPublicSocketHandshake, type PublicAuthRuntime } from "./auth/remoteDeviceAuth";
import { parseCorsOrigins } from "./utils/parseCorsOrigins";
import type { LocalAuthRuntime } from "./auth/localDeviceAuth";

export interface StartSocketOptions {
    auth?: "tunnel" | "loopback" | "local-device" | "public";
    paths?: LoopbackCapabilityPaths;
    publicAuthRuntime?: PublicAuthRuntime;
    localAuthRuntime?: LocalAuthRuntime;
}

export function configureRedisStreamsAdapter(io: Server): Redis | undefined {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        return undefined;
    }

    const streamClient = new Redis(redisUrl);
    io.adapter(createAdapter(streamClient, { maxLen: 200000, readCount: 2000 }));
    log({ module: 'websocket' }, 'Redis streams adapter enabled for multi-process support');

    // Track stream reader lag: wrap onRawMessage to capture last-read offset,
    // then periodically compare against stream HEAD.
    let lastReadOffset = "0-0";
    const adapter = io.of("/").adapter as any;
    const origOnRawMessage = adapter.onRawMessage.bind(adapter);
    adapter.onRawMessage = (msg: any, offset: string) => {
        lastReadOffset = offset;
        return origOnRawMessage(msg, offset);
    };
    const interval = setInterval(async () => {
        try {
            const info = await streamClient.xinfo("STREAM", "socket.io") as any[];
            const headId = String(info[info.indexOf("last-generated-id") + 1]);
            const headMs = parseInt(headId.split("-")[0]);
            const readMs = parseInt(lastReadOffset.split("-")[0]);
            redisStreamLagMsGauge.set(headMs - readMs);
        } catch { /* stream may not exist yet */ }
    }, 5000) as unknown as { unref?: () => void };
    interval.unref?.();

    return streamClient;
}

export function createSocketAuthMiddleware(tofuConfig: TofuHandshakeConfig, socketOptions: StartSocketOptions = {}) {
    // FORK PATCH: [RESTORE-R1b-done] thin handshake dispatcher; loopback + public device-proof branch bodies relocated to auth/ helpers (invariant HS-3)
    // The loopback capability verifier is built for BOTH the loopback listener
    // (its sole credential) AND the public listener (as a co-resident fast-path
    // credential, checked before device-proof — see the public branch below).
    const verifyLoopbackHandshake = (socketOptions.auth === 'loopback' || socketOptions.auth === 'public' || socketOptions.auth === 'local-device')
        ? makeLoopbackSocketVerifier(socketOptions.paths ?? {})
        : null;

    return async function socketAuthMiddleware(socket: any, next: (err?: Error) => void) {
        // Fail-closed handshake dispatch: pick the mode's relocated helper and reject
        // (next(Error)) on failure. Loopback checks the capability token; public runs
        // the device-proof handshake on BOTH ws + polling (strict single-use nonce; the
        // fail-open tunnel branch stays closed). Tunnel mode has no handshake gate. The
        // branch bodies live in auth/loopbackCapability.ts + auth/remoteDeviceAuth.ts.
        if (socketOptions.auth === 'loopback') {
            const ok = await verifyLoopbackHandshake!(socket.handshake.headers);
            if (!ok) {
                next(new Error('Unauthorized'));
                return;
            }
        }

        if (socketOptions.auth === 'public') {
            // Co-resident daemon fast-path: the daemon's OWN embedded socket clients
            // (machine + session) live on THIS public listener (co-located with the
            // app so app->daemon RPC works) and authenticate with the local loopback
            // capability — a 0600 per-start secret at paths.loopbackCap that is NEVER
            // transmitted to remote clients. A valid capability accepts WITHOUT a
            // device proof. Authorization is by possession of the SECRET only, never
            // by remote address: cloudflared collapses every remote request to
            // 127.0.0.1 at the origin, so a loopback-address exemption would authorize
            // any remote attacker. An absent OR invalid capability falls THROUGH to
            // the unchanged device-proof path (fail-closed) — a remote client that
            // cannot obtain or forge the secret still needs a valid device proof.
            const presentedCapability = socket.handshake.headers['x-loopback-capability'];
            const acceptedViaCapability = presentedCapability !== undefined
                && await verifyLoopbackHandshake!(socket.handshake.headers);
            if (!acceptedViaCapability) {
                const result = await verifyPublicSocketHandshake(socketOptions.publicAuthRuntime, socket.handshake.headers);
                if (!result.ok) {
                    log({ module: 'websocket' }, `Public socket handshake rejected: ${result.reason}`);
                    next(new Error('Unauthorized'));
                    return;
                }

            }
        }

        if (socketOptions.auth === 'local-device') {
            const presentedCapability = socket.handshake.headers['x-loopback-capability'];
            const acceptedViaCapability = presentedCapability !== undefined
                && await verifyLoopbackHandshake!(socket.handshake.headers);
            if (!acceptedViaCapability) {
                const result = await socketOptions.localAuthRuntime?.verifySocketHandshake(socket.handshake.headers);
                if (!result?.ok) {
                    next(new Error('Unauthorized'));
                    return;
                }
            }
        }

        const clientType = socket.handshake.auth.clientType as 'session-scoped' | 'user-scoped' | 'machine-scoped' | undefined;
        const sessionId = socket.handshake.auth.sessionId as string | undefined;
        const machineId = socket.handshake.auth.machineId as string | undefined;

        if (clientType === 'session-scoped' && !sessionId) {
            log({ module: 'websocket' }, `Session-scoped client missing sessionId`);
            next(new Error('Session ID required for session-scoped clients'));
            return;
        }

        if (clientType === 'machine-scoped' && !machineId) {
            log({ module: 'websocket' }, `Machine-scoped client missing machineId`);
            next(new Error('Machine ID required for machine-scoped clients'));
            return;
        }

        socket.data.clientType = clientType;
        socket.data.sessionId = sessionId;
        socket.data.machineId = machineId;
        socket.data.tofuPublicKeys = tofuConfig.tofuPublicKeys;
        socket.data.happyClient = socket.handshake.auth.happyClient as string
            || socket.handshake.headers['x-happy-client'] as string
            || undefined;
        next();
    };
}

export function startSocket(app: Fastify, tofuConfig: TofuHandshakeConfig = { localUserId: "local-user" }, socketOptions: StartSocketOptions = {}) {
    const allowedOrigins = parseCorsOrigins();
    const io = new Server(app.server, {
        cors: {
            origin(origin, callback) {
                const allowed = origin !== undefined && (
                    allowedOrigins.includes(origin)
                    || socketOptions.localAuthRuntime?.isOriginAllowed(origin) === true
                );
                callback(null, allowed);
            },
            methods: ["GET", "POST", "OPTIONS"],
            credentials: true,
            // `Cf-Access-Jwt-Assertion` is intentionally absent: Cloudflare Access
            // injects it origin-side, the browser never sends it. The pairing
            // headers ARE browser-sent (POST /pair/complete).
            allowedHeaders: ["X-Tunnel-Authorization", "X-Loopback-Capability", "X-Happy-Client", "Content-Type", "X-Happy-Device-Proof", "X-Happy-Local-Device-Proof", "X-Happy-Pairing-Secret", "X-Happy-Pairing-Nonce", "CF-Access-Client-Id", "CF-Access-Client-Secret"]
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 45000,
        pingInterval: 15000,
        path: '/v1/updates',
        allowUpgrades: true,
        upgradeTimeout: 10000,
        connectTimeout: 20000,
        serveClient: false, // Don't serve the client files
        // Brief-disconnect event replay. Currently OFF to preserve parity with
        // pre-multi-process prod behavior — clients fall through to the full
        // REST re-fetch path on every reconnect (apiSocket.ts onReconnected
        // listener). Enabling this lets socket.io replay missed events from
        // the streams adapter (which implements restoreSession via the Redis
        // stream) so the client can skip the heavy refetch when
        // socket.recovered === true. Verified working cross-replica via
        // deploy/integration-tests/missed-events.mjs (event #2 fired during a
        // forced engine.close() arrived after auto-reconnect, recovered=true).
        // Ship parity first; turn this on as a follow-up.
        // connectionStateRecovery: {
        //     maxDisconnectionDuration: 2 * 60 * 1000,
        // },
    });

    configureRedisStreamsAdapter(io);

    const eventRouter = createEventRouter(io);

    // Handshake metadata is captured in middleware so it is available before
    // client events can reach the connection handlers.
    io.use(createSocketAuthMiddleware(tofuConfig, socketOptions));

    io.on("connection", (socket) => {
        const clientType = socket.data.clientType as 'session-scoped' | 'user-scoped' | 'machine-scoped' | undefined;
        const sessionId = socket.data.sessionId as string | undefined;
        const machineId = socket.data.machineId as string | undefined;
        const labels = getMetricsLabelsFromSocket(socket);

        log({ module: 'websocket' }, `TOFU handshake accepted: clientType: ${clientType || 'user-scoped'}, client: ${labels.client}, sessionId: ${sessionId || 'none'}, machineId: ${machineId || 'none'}, socketId: ${socket.id}`);

        if (tofuConfig.tofuPublicKeys) {
            socket.emit('tofu-pubkeys', tofuConfig.tofuPublicKeys);
        }

        // Store connection based on type
        // FORK PATCH: [KEEP-DELETED] single-user connection data — NO per-socket userId (single-user, happy-server AGENTS.md hard rule); upstream's optional happyClient? telemetry IS adopted additively so the connection-registration blocks converge onto upstream (userId removal is the only residual delta) (invariant HS-9)
        const happyClient = socket.data.happyClient as string | undefined;
        const metadata = { clientType: clientType || 'user-scoped', sessionId, machineId };
        let connection: ClientConnection;
        if (metadata.clientType === 'session-scoped' && sessionId) {
            connection = {
                connectionType: 'session-scoped',
                socket,
                sessionId,
                happyClient
            };
        } else if (metadata.clientType === 'machine-scoped' && machineId) {
            connection = {
                connectionType: 'machine-scoped',
                socket,
                machineId,
                happyClient
            };
        } else {
            connection = {
                connectionType: 'user-scoped',
                socket,
                happyClient
            };
        }
        const lastSeenSeq = socket.handshake.auth.lastSeenSeq;
        const replay = (typeof lastSeenSeq === 'number' && Number.isFinite(lastSeenSeq))
            ? eventRouter.getReplayForConnection(lastSeenSeq, connection)
            : null;

        eventRouter.addConnection(connection);

        if (replay !== null) {
            if (replay.overflow) {
                socket.emit('replay-overflow', { replayOverflow: true, currentSeq: replay.currentSeq });
            } else {
                for (const event of replay.events) {
                    socket.emit('update', event);
                }
            }
        }

        websocketConnectionsGauge.inc({ type: connection.connectionType, ...labels });

        // Broadcast daemon online status
        if (connection.connectionType === 'machine-scoped') {
            // Broadcast daemon online
            const machineActivity = buildMachineActivityEphemeral(machineId!, true, Date.now());
            eventRouter.emitEphemeral({
                payload: machineActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        }

        socket.on('disconnect', () => {
            websocketEventsCounter.inc({ event_type: 'disconnect', ...labels });

            // Cleanup connections
            eventRouter.removeConnection(connection);
            websocketConnectionsGauge.dec({ type: connection.connectionType, ...labels });

            log({ module: 'websocket' }, `Socket disconnected: ${socket.id}`);

            // Broadcast daemon offline status
            if (connection.connectionType === 'machine-scoped') {
                const machineActivity = buildMachineActivityEphemeral(connection.machineId, false, Date.now());
                eventRouter.emitEphemeral({
                    payload: machineActivity,
                    recipientFilter: { type: 'user-scoped-only' }
                });
            }
        });

        // Handlers
        rpcHandler(socket, io);
        sessionUpdateHandler(socket, connection, eventRouter, tofuConfig.localUserId);
        pingHandler(socket);
        machineUpdateHandler(socket, eventRouter);
        sessionMessageRangeHandler(socket);

        // Ready
        log({ module: 'websocket' }, `Socket connected: ${socket.id}`);
    });

    onShutdown('api', async () => {
        eventRouter.close();
        await io.close();
    });

    return eventRouter;
}
