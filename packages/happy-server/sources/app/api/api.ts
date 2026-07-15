import fastify from "fastify";
import { log, logger } from "@/utils/log";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { onShutdown } from "@/utils/shutdown";
import { Fastify } from "./types";
import { startSocket } from "./socket";
import { enableMonitoring } from "./utils/enableMonitoring";
import { enableErrorHandlers } from "./utils/enableErrorHandlers";
import { type MachineSelfState } from "./routes/machineSelfRoutes";
import { installForkCors } from "@/fork/forkCors";
import { registerForkRoutes } from "@/fork/registerForkRoutes";
import { isLocalStorage, getLocalFilesDir } from "@/storage/files";
import type { EventRouter } from "@/app/events/eventRouter";
import { verifyLoopbackCapability, type LoopbackCapabilityPaths } from "./auth/loopbackCapability";
import { type PublicAuthConfig } from "./auth/remoteDeviceAuth";
import { type LocalAuthRuntime, type LocalDeviceAuthConfig } from "./auth/localDeviceAuth";
import { installForkAuthPlane } from "./auth/forkAuthPlane";
import * as path from "path";
import * as fs from "fs";

export interface ApiPaths extends LoopbackCapabilityPaths {
    profile?: string;
    accountSettings?: string;
    githubConnection?: string;
}

export type MachineStateGetter = () => MachineSelfState | Promise<MachineSelfState>;

export interface TofuHandshakeConfig {
    localUserId: string;
    tofuPublicKeys?: {
        ed25519PublicKey: string;
        x25519PublicKey: string;
        ed25519Fingerprint?: string;
    };
    x25519SecretKey?: Uint8Array;
    ed25519SecretKey?: Uint8Array;
    publicUrl?: string;
}

export function createApi() {
    return fastify({
        loggerInstance: logger,
        bodyLimit: 1024 * 1024 * 100, // 100MB
    });
}

export interface ConfigureApiOptions {
    auth?: "tunnel" | "loopback" | "local-device" | "public";
    publicAuth?: PublicAuthConfig;
    localAuth?: LocalDeviceAuthConfig;
    paths?: ApiPaths;
    machineState?: MachineStateGetter;
    onEventRouter?: (eventRouter: EventRouter) => void;
    onLocalAuthRuntime?: (runtime: LocalAuthRuntime) => void;
}

export function configureApi(app: any, tofuConfig: TofuHandshakeConfig = { localUserId: "local-user" }, options: ConfigureApiOptions = {}) {
    const fastifyApp = app as ReturnType<typeof createApi>;
    // Create typed provider
    fastifyApp.setValidatorCompiler(validatorCompiler);
    fastifyApp.setSerializerCompiler(serializerCompiler);
    const typed = fastifyApp.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

    // Enable features
    enableMonitoring(typed);
    enableErrorHandlers(typed);
    typed.decorate('verifyLoopbackCapability', verifyLoopbackCapability(options.paths));
    // FORK PATCH: [RESTORE-R1a-done] fork single-user + public auth plane wiring — see auth/forkAuthPlane.ts (invariants HS-1, HS-2). Install order (before route/socket registration) is load-bearing for US-005 default-deny.
    const { publicAuthRuntime, localAuthRuntime } = installForkAuthPlane(fastifyApp, typed, tofuConfig, options);
    if (localAuthRuntime) {
        options.onLocalAuthRuntime?.(localAuthRuntime);
    }
    installForkCors(fastifyApp, localAuthRuntime);
    fastifyApp.get('/', function (request, reply) {
        reply.send('Welcome to Happy Server!');
    });

    // Serve local files when using local storage
    if (isLocalStorage()) {
        fastifyApp.get('/files/*', function (request, reply) {
            const filePath = (request.params as any)['*'];
            const baseDir = path.resolve(getLocalFilesDir());
            const fullPath = path.resolve(baseDir, filePath);
            if (!fullPath.startsWith(baseDir + path.sep)) {
                reply.code(403).send('Forbidden');
                return;
            }
            if (!fs.existsSync(fullPath)) {
                reply.code(404).send('Not found');
                return;
            }
            const stream = fs.createReadStream(fullPath);
            reply.send(stream);
        });
    }

    const eventRouter = startSocket(typed, tofuConfig, {
        auth: options.auth,
        paths: options.paths,
        publicAuthRuntime,
        localAuthRuntime,
    });
    options.onEventRouter?.(eventRouter);

    // FORK PATCH: [KEEP-DELETED] fork curated route surface relocated to fork/registerForkRoutes.ts; auth plane installed above still runs BEFORE routes (default-deny) (invariant HS-7)
    registerForkRoutes(typed, eventRouter, tofuConfig, options, publicAuthRuntime, localAuthRuntime);

    return typed;
}

export async function startApi() {

    // Configure
    log('Starting API...');

    // Start API
    const app = createApi();
    configureApi(app);

    // Start HTTP
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3005;
    const host = process.env.HAPPY_API_HOST ?? '127.0.0.1';
    await app.listen({ port, host });
    onShutdown('api', async () => {
        await app.close();
    });

    // End
    log('API ready on port http://localhost:' + port);

    return app;
}
