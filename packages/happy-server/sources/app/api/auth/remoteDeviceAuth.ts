import { timingSafeEqual } from "crypto";
import {
    PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS,
    PUBLIC_DEVICE_PROOF_FRESHNESS_MS,
    PUBLIC_DEVICE_PROOF_HEADER,
    decodePublicDeviceProofHeader,
    isPublicProofFresh,
    verifyPublicRequest,
} from "@slopus/happy-wire";

// ---------------------------------------------------------------------------
// Remote device auth plane (public mode)
//
// This is the fail-closed application-layer boundary for exposing the embedded
// single-tenant happy-server on the public internet. It has three cooperating
// pieces, all modeled on the loopback-capability 401 pattern:
//   1. An Ed25519 signed-request verifier (per already-paired device, pinned
//      public key, replay-protected, freshness-bounded).
//   2. A mandatory Cloudflare Access service-token edge check (defense in depth).
//   3. An explicit method/path policy allowlist; anything not listed fails
//      closed (401) even with a valid device proof.
// ---------------------------------------------------------------------------

/** A paired device that is allowed to present proofs. */
export interface RemoteDeviceRecord {
    /** Stable identifier the device puts in `keyId` (e.g. a fingerprint or label). */
    keyId: string;
    /** base64-encoded Ed25519 public key (32 bytes). Pinned: the proof must match exactly. */
    publicKey: string;
    label?: string;
}

/** A Cloudflare Access service token (client id + secret pair). */
export interface EdgeAccessServiceToken {
    clientId: string;
    clientSecret: string;
}

export interface EdgeAccessConfig {
    serviceTokens: EdgeAccessServiceToken[];
}

/** Operator-opened pairing window + pre-shared QR secret gate for `/pair/complete` (US-003). */
export interface PublicPairingConfig {
    /** base64/opaque pre-shared secret the operator surfaces via QR/manual entry. */
    secret: string;
    /** Epoch ms when the pairing window opened; requests before this are rejected. */
    windowOpenedAt: number;
    /** Epoch ms when the pairing window closes; requests after this are rejected. */
    windowClosesAt: number;
    /** Optional injectable clock for tests. */
    now?: () => number;
}

export interface PublicAuthConfig {
    /** Pinned paired devices allowed to present proofs. */
    devices: RemoteDeviceRecord[];
    /** Mandatory Cloudflare Access service-token expectation (edge defense in depth). */
    edge: EdgeAccessConfig;
    /** Freshness window for a proof's issuedAt (default 5 min). */
    freshnessMs?: number;
    /** Allowed forward clock skew (default 1 min). */
    clockSkewMs?: number;
    /** Operator pairing window for `/pair/complete` (US-003). */
    pairing?: PublicPairingConfig;
    /** Injectable clock for tests. */
    now?: () => number;
}

export const CF_ACCESS_CLIENT_ID_HEADER = "cf-access-client-id";
export const CF_ACCESS_CLIENT_SECRET_HEADER = "cf-access-client-secret";

/** Fixed method/path binding a device signs for the Socket.IO handshake proof. */
export const SOCKET_PROOF_METHOD = "GET";
export const SOCKET_PROOF_PATH = "/v1/updates";

function headerString(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
        return value[0];
    }
    return undefined;
}

function constantTimeEqual(a: string, b: string): boolean {
    const encoder = new TextEncoder();
    const ab = encoder.encode(a);
    const bb = encoder.encode(b);
    if (ab.length !== bb.length) {
        return false;
    }
    return timingSafeEqual(ab, bb);
}

/**
 * Validates the Cloudflare Access service-token headers. Fail-closed: if edge is
 * configured (it is mandatory for a public bind), a request without matching
 * `CF-Access-Client-Id`/`CF-Access-Client-Secret` headers is rejected. When no
 * service tokens are configured this returns true so the device verifier remains
 * the boundary (used only by non-public/test paths).
 */
export function checkEdgeAccess(config: EdgeAccessConfig | undefined, headers: Record<string, unknown>): boolean {
    if (!config || config.serviceTokens.length === 0) {
        return true;
    }
    const clientId = headerString(headers[CF_ACCESS_CLIENT_ID_HEADER]);
    const clientSecret = headerString(headers[CF_ACCESS_CLIENT_SECRET_HEADER]);
    if (!clientId || !clientSecret) {
        return false;
    }
    return config.serviceTokens.some(
        (token) => constantTimeEqual(token.clientId, clientId) && constantTimeEqual(token.clientSecret, clientSecret),
    );
}

export interface RemoteDeviceProofResult {
    ok: boolean;
    reason?: string;
    keyId?: string;
}

export interface RemoteDeviceVerifyInput {
    method: string;
    path: string;
    header: string | undefined;
}

export interface RemoteDeviceVerifier {
    verify(input: RemoteDeviceVerifyInput): Promise<RemoteDeviceProofResult>;
}

/**
 * Builds the Ed25519 device-proof verifier. Enforces (in order): well-formed
 * envelope, known+pinned key, freshness, single-use nonce (replay cache), and
 * finally the cryptographic signature bound to method+path via `@slopus/happy-wire`.
 */
export function createRemoteDeviceVerifier(
    config: Pick<PublicAuthConfig, "devices" | "freshnessMs" | "clockSkewMs" | "now">,
): RemoteDeviceVerifier {
    const devicesByKeyId = new Map(config.devices.map((device) => [device.keyId, device]));
    const seenNonces = new Map<string, number>();
    const now = config.now ?? (() => Date.now());
    const windowMs = config.freshnessMs ?? PUBLIC_DEVICE_PROOF_FRESHNESS_MS;
    const clockSkewMs = config.clockSkewMs ?? PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS;

    function pruneNonces(nowMs: number): void {
        for (const [nonce, expiry] of seenNonces) {
            if (expiry <= nowMs) {
                seenNonces.delete(nonce);
            }
        }
    }

    return {
        async verify({ method, path, header }) {
            const envelope = decodePublicDeviceProofHeader(header);
            if (!envelope) {
                return { ok: false, reason: "missing_or_malformed_proof" };
            }
            const device = devicesByKeyId.get(envelope.keyId);
            if (!device) {
                return { ok: false, reason: "unknown_key" };
            }
            if (envelope.publicKey !== device.publicKey) {
                return { ok: false, reason: "public_key_mismatch" };
            }
            const nowMs = now();
            if (!isPublicProofFresh(envelope.issuedAt, nowMs, windowMs, clockSkewMs)) {
                return { ok: false, reason: "stale_proof" };
            }
            if (seenNonces.has(envelope.nonce)) {
                return { ok: false, reason: "replayed_nonce" };
            }
            const verification = await verifyPublicRequest(envelope, {
                method,
                path,
                expectedPublicKey: device.publicKey,
            });
            if (!verification.ok) {
                return { ok: false, reason: verification.reason };
            }
            pruneNonces(nowMs);
            seenNonces.set(envelope.nonce, envelope.issuedAt + windowMs + clockSkewMs);
            return { ok: true, keyId: envelope.keyId };
        },
    };
}

export type PublicRoutePolicy = "deviceProof" | "pairComplete";

export interface PublicRoutePolicyEntry {
    method: string;
    path: string;
    policy: PublicRoutePolicy;
}

/**
 * The explicit public-mode route policy allowlist. Every route that should be
 * reachable in public mode MUST be listed here with a named policy. Anything not
 * listed is denied (401) even with a valid device proof — a newly registered
 * route fails closed until it is deliberately added here.
 *
 * `deviceProof` → requires a valid Ed25519 device proof (and edge headers).
 * `pairComplete` → pre-enrollment: passes the edge check then reaches the route
 *   handler, which enforces the operator pairing window + QR secret + replay
 *   (see pairRoutes.ts). It never requires a device proof because the device is
 *   not yet paired.
 */
export const PUBLIC_ROUTE_POLICY_ALLOWLIST: PublicRoutePolicyEntry[] = [
    { method: "GET", path: "/", policy: "deviceProof" },
    { method: "GET", path: "/health", policy: "deviceProof" },
    { method: "GET", path: "/files/*", policy: "deviceProof" },
    { method: "POST", path: "/v1/version", policy: "deviceProof" },
    { method: "POST", path: "/logs-combined-from-cli-and-mobile-for-simple-ai-debugging", policy: "deviceProof" },
    { method: "POST", path: "/pair/complete", policy: "pairComplete" },
    { method: "POST", path: "/pair/connect", policy: "deviceProof" },
    { method: "POST", path: "/push/register", policy: "deviceProof" },
    { method: "POST", path: "/v1/push-tokens", policy: "deviceProof" },
    { method: "GET", path: "/v1/push-tokens", policy: "deviceProof" },
    { method: "DELETE", path: "/v1/push-tokens/:token", policy: "deviceProof" },
    { method: "GET", path: "/v2/me/profile", policy: "deviceProof" },
    { method: "GET", path: "/v2/me/settings", policy: "deviceProof" },
    { method: "PUT", path: "/v2/me/settings", policy: "deviceProof" },
    { method: "GET", path: "/v2/me/machine", policy: "deviceProof" },
    { method: "GET", path: "/v1/sessions", policy: "deviceProof" },
    { method: "GET", path: "/v2/sessions/active", policy: "deviceProof" },
    { method: "GET", path: "/v2/sessions", policy: "deviceProof" },
    { method: "POST", path: "/v1/sessions", policy: "deviceProof" },
    { method: "GET", path: "/v1/sessions/:sessionId/messages", policy: "deviceProof" },
    { method: "POST", path: "/v1/sessions/:sessionId/archive", policy: "deviceProof" },
    { method: "DELETE", path: "/v1/sessions/:sessionId", policy: "deviceProof" },
    { method: "GET", path: "/v3/sessions/:sessionId/messages", policy: "deviceProof" },
    { method: "POST", path: "/v3/sessions/:sessionId/messages", policy: "deviceProof" },
];

/** Resolves the named policy for a matched route, or null (default-deny) if not allowlisted. */
export function resolvePublicRoutePolicy(method: string, routePath: string | undefined): PublicRoutePolicy | null {
    if (!routePath) {
        return null;
    }
    const upperMethod = method.toUpperCase();
    const entry = PUBLIC_ROUTE_POLICY_ALLOWLIST.find((candidate) => candidate.method === upperMethod && candidate.path === routePath);
    return entry ? entry.policy : null;
}

export interface PublicAuthRuntime {
    verifier: RemoteDeviceVerifier;
    edge: EdgeAccessConfig;
    config: PublicAuthConfig;
    /** Fastify `onRequest` hook that fail-closes every public-mode HTTP route. */
    httpGuard: (request: any, reply: any) => Promise<unknown>;
    /** Socket.IO handshake check (ws + polling); returns ok/reason without throwing. */
    verifySocketHandshake: (headers: Record<string, unknown>) => Promise<RemoteDeviceProofResult>;
}

/**
 * Assembles the shared public-mode auth runtime. One verifier (one replay cache)
 * backs both the HTTP guard and the socket handshake check so a nonce cannot be
 * replayed across transports.
 */
export function createPublicAuthRuntime(config: PublicAuthConfig): PublicAuthRuntime {
    const verifier = createRemoteDeviceVerifier(config);
    const edge = config.edge;

    async function httpGuard(request: any, reply: any): Promise<unknown> {
        // CORS preflight is handled by @fastify/cors and must not be blocked here.
        if (request.method === "OPTIONS") {
            return;
        }
        // Edge (Cloudflare Access) is mandatory defense-in-depth, checked first.
        if (!checkEdgeAccess(edge, request.headers)) {
            return reply.code(401).send({ error: "edge_access_denied" });
        }
        const routePath = request.routeOptions?.url as string | undefined;
        const policy = resolvePublicRoutePolicy(request.method, routePath);
        if (policy === null) {
            return reply.code(401).send({ error: "route_not_allowlisted" });
        }
        if (policy === "pairComplete") {
            // The route handler enforces the operator window + QR secret + replay.
            return;
        }
        const urlPath = String(request.url ?? "").split("?")[0];
        const header = headerString(request.headers[PUBLIC_DEVICE_PROOF_HEADER]);
        const result = await verifier.verify({ method: request.method, path: urlPath, header });
        if (!result.ok) {
            return reply.code(401).send({ error: "device_proof_required" });
        }
    }

    async function verifySocketHandshake(headers: Record<string, unknown>): Promise<RemoteDeviceProofResult> {
        if (!checkEdgeAccess(edge, headers)) {
            return { ok: false, reason: "edge_access_denied" };
        }
        const header = headerString(headers[PUBLIC_DEVICE_PROOF_HEADER]);
        return verifier.verify({ method: SOCKET_PROOF_METHOD, path: SOCKET_PROOF_PATH, header });
    }

    return { verifier, edge, config, httpGuard, verifySocketHandshake };
}
