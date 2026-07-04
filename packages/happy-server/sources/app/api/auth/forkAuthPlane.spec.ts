import { mkdtemp, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureApi, createApi, type TofuHandshakeConfig } from "../api";
import {
    PUBLIC_DEVICE_PROOF_HEADER,
    encodePublicDeviceProofHeader,
    generatePublicRequestNonce,
    hashRequestBody,
    signPublicRequest,
} from "@slopus/happy-wire";
import {
    CF_ACCESS_CLIENT_ID_HEADER,
    CF_ACCESS_CLIENT_SECRET_HEADER,
    type PublicAuthConfig,
} from "./remoteDeviceAuth";

// ---------------------------------------------------------------------------
// Golden auth-decision tests for the M1-R1a relocation (api.ts auth wiring ->
// auth/forkAuthPlane.ts). These lock the accept/reject decision of the three
// auth modes so the relocation is proven byte-identical in behavior:
//   - tunnel  -> `authenticate` collapses to the no-op tunnel authenticator,
//   - loopback -> `authenticate` is the capability-token verifier,
//   - public  -> the fail-closed boundary denies unauthenticated requests (401)
//               and admits a valid edge + device proof (200).
// The mode-selection + the public-mode boundary now live behind
// installForkAuthPlane(); these assertions are unchanged from the pre-refactor
// inline wiring.
// ---------------------------------------------------------------------------

const tofuConfig: TofuHandshakeConfig = { localUserId: "operator-user" };

describe("forkAuthPlane golden auth-decision (M1-R1a behavior-preserving relocation)", () => {
    const apps: ReturnType<typeof createApi>[] = [];

    afterEach(async () => {
        await Promise.all(apps.splice(0).map((app) => app.close().catch(() => {})));
    });

    it("tunnel mode collapses `authenticate` to the no-op tunnel authenticator (never rejects)", async () => {
        const app = createApi();
        apps.push(app);
        configureApi(app, tofuConfig, { auth: "tunnel" });
        await app.ready();

        expect(typeof (app as any).authenticateTunnel).toBe("function");
        // Mode selection: authenticate IS the no-op tunnel authenticator.
        expect((app as any).authenticate).toBe((app as any).authenticateTunnel);

        // No-op: regardless of headers it resolves without ever calling reply.code.
        const reply: any = { code: vi.fn(() => reply), send: vi.fn(() => reply) };
        await (app as any).authenticate({ headers: {}, url: "/anything" }, reply);
        expect(reply.code).not.toHaveBeenCalled();
    });

    it("loopback mode binds `authenticate` to the loopback-capability verifier (accept + reject)", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "happy-fork-authplane-"));
        const capPath = path.join(dir, "loopback-cap.txt");
        await writeFile(capPath, "golden-secret-token\n", { mode: 0o600 });

        const app = createApi();
        apps.push(app);
        configureApi(app, tofuConfig, { auth: "loopback", paths: { loopbackCap: capPath } });
        // A route gated by the mode-selected `authenticate` decorator.
        (app as any).get("/__golden_loopback__", { preHandler: (app as any).authenticate }, async () => ({ ok: true }));
        await app.ready();

        // Mode selection: authenticate IS the loopback-capability verifier.
        expect((app as any).authenticate).toBe((app as any).verifyLoopbackCapability);

        const accept = await app.inject({
            method: "GET",
            url: "/__golden_loopback__",
            headers: { "x-loopback-capability": "golden-secret-token" },
        });
        expect(accept.statusCode).toBe(200);
        expect(accept.json()).toEqual({ ok: true });

        const missing = await app.inject({ method: "GET", url: "/__golden_loopback__" });
        expect(missing.statusCode).toBe(401);
        expect(missing.json()).toEqual({ error: "invalid_loopback_capability" });

        const wrong = await app.inject({
            method: "GET",
            url: "/__golden_loopback__",
            headers: { "x-loopback-capability": "wrong-token" },
        });
        expect(wrong.statusCode).toBe(401);
    });

    it("public mode without a publicAuth verifier refuses to configure (fail-closed throw)", () => {
        const app = createApi();
        apps.push(app);
        expect(() => configureApi(app, tofuConfig, { auth: "public" })).toThrow(/publicAuth/);
    });

    it("public mode installs the fail-closed boundary: unauthenticated is denied 401, valid edge + device proof is admitted 200", async () => {
        const deviceSeed = Uint8Array.from({ length: 32 }, (_, i) => (i + 11) & 0xff);
        const keyId = "golden-device";
        const seedEnvelope = await signPublicRequest({
            method: "GET",
            path: "/",
            keyId,
            nonce: generatePublicRequestNonce(),
            issuedAt: Date.now(),
            bodyHash: hashRequestBody(null),
        }, deviceSeed);

        const publicAuth: PublicAuthConfig = {
            devices: [{ keyId, publicKey: seedEnvelope.publicKey }],
            edge: { serviceTokens: [{ clientId: "edge-id", clientSecret: "edge-secret" }] },
        };

        const app = createApi();
        apps.push(app);
        configureApi(app, tofuConfig, { auth: "public", publicAuth });
        await app.ready();

        // Fail-closed: a fully unauthenticated request is denied.
        const denied = await app.inject({ method: "GET", url: "/" });
        expect(denied.statusCode).toBe(401);

        // POSITIVE CONTROL: valid edge check + device proof reaches the handler (200),
        // proving the 401 is a meaningful gate and not a blanket failure.
        const proofEnvelope = await signPublicRequest({
            method: "GET",
            path: "/",
            keyId,
            nonce: generatePublicRequestNonce(),
            issuedAt: Date.now(),
            bodyHash: hashRequestBody(null),
        }, deviceSeed);
        const admitted = await app.inject({
            method: "GET",
            url: "/",
            headers: {
                [CF_ACCESS_CLIENT_ID_HEADER]: "edge-id",
                [CF_ACCESS_CLIENT_SECRET_HEADER]: "edge-secret",
                [PUBLIC_DEVICE_PROOF_HEADER]: encodePublicDeviceProofHeader(proofEnvelope),
            },
        });
        expect(admitted.statusCode).toBe(200);
        expect(admitted.body).toContain("Welcome to Happy Server!");
    });
});
