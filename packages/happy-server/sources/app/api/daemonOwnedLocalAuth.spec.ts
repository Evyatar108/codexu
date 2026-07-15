import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { encodeBase64 } from "@slopus/happy-wire";

import { configureApi, createApi, type TofuHandshakeConfig } from "./api";
import { createSocketAuthMiddleware } from "./socket";

describe("default local-device daemon clients", () => {
    const apps: ReturnType<typeof createApi>[] = [];
    const roots: string[] = [];
    afterEach(async () => {
        await Promise.all(apps.splice(0).map(app => app.close()));
        await Promise.all(roots.splice(0).map(root => rm(root, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 50,
        })));
    });

    it("accepts capability-authenticated HTTP and machine/session sockets while rejecting unknown callers", async () => {
        const root = join(process.cwd(), `.daemon-local-auth-test-${randomUUID()}`);
        roots.push(root);
        await mkdir(root, { recursive: true });
        const loopbackCap = join(root, "loopback-cap.txt");
        await writeFile(loopbackCap, "daemon-capability\n");
        const tofuConfig: TofuHandshakeConfig = {
            localUserId: "machine-1",
            tofuPublicKeys: {
                ed25519PublicKey: encodeBase64(new Uint8Array(32).fill(1)),
                x25519PublicKey: encodeBase64(new Uint8Array(32).fill(2)),
                ed25519Fingerprint: "SHA256:server",
            },
            ed25519SecretKey: new Uint8Array(32).fill(3),
        };
        const localAuth = {
            machineId: "machine-1",
            serverUrl: "http://127.0.0.1:4567",
            devices: [],
        };
        const app = createApi();
        apps.push(app);
        let runtime: import("./auth/localDeviceAuth").LocalAuthRuntime | undefined;
        configureApi(app, tofuConfig, {
            auth: "local-device",
            localAuth,
            paths: { loopbackCap },
            onLocalAuthRuntime: value => {
                runtime = value;
            },
        });
        await app.ready();

        expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(401);
        expect((await app.inject({
            method: "GET",
            url: "/",
            headers: { "X-Loopback-Capability": "daemon-capability" },
        })).statusCode).toBe(200);

        const middleware = createSocketAuthMiddleware(tofuConfig, {
            auth: "local-device",
            paths: { loopbackCap },
            localAuthRuntime: runtime,
        });
        for (const auth of [
            { clientType: "machine-scoped", machineId: "machine-1" },
            { clientType: "session-scoped", sessionId: "session-1" },
        ]) {
            const socket = {
                handshake: {
                    headers: { "x-loopback-capability": "daemon-capability" },
                    auth,
                },
                data: {},
            };
            await expect(new Promise<void>((resolve, reject) => {
                middleware(socket, error => error ? reject(error) : resolve());
            })).resolves.toBeUndefined();
        }
        const unknownSocket = {
            handshake: { headers: {}, auth: { clientType: "machine-scoped", machineId: "machine-1" } },
            data: {},
        };
        await expect(new Promise<void>((resolve, reject) => {
            middleware(unknownSocket, error => error ? reject(error) : resolve());
        })).rejects.toThrow("Unauthorized");
    });
});
