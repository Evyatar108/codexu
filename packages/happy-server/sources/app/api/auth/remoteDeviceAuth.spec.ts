import { describe, expect, it } from "vitest";
import {
    signPublicRequest,
    hashRequestBody,
} from "@slopus/happy-wire";
import {
    CF_ACCESS_CLIENT_ID_HEADER,
    CF_ACCESS_CLIENT_SECRET_HEADER,
    PAIRING_NONCE_HEADER,
    PAIRING_SECRET_HEADER,
    checkEdgeAccess,
    createPairingGate,
    createPublicAuthRuntime,
    resolvePublicRoutePolicy,
} from "./remoteDeviceAuth";

describe("createPairingGate — US-003 operator pairing window", () => {
    const secret = "qr-shared-secret";
    const base = {
        secret,
        windowOpenedAt: 1_000,
        windowClosesAt: 2_000,
    };

    function goodHeaders(nonce = "nonce-1"): Record<string, unknown> {
        return {
            [PAIRING_SECRET_HEADER]: secret,
            [PAIRING_NONCE_HEADER]: nonce,
        };
    }

    it("rejects before the window opens", () => {
        const gate = createPairingGate({ ...base, now: () => 999 });
        const result = gate.check(goodHeaders());
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("pairing_window_not_open");
    });

    it("rejects after the window closes", () => {
        const gate = createPairingGate({ ...base, now: () => 2_001 });
        const result = gate.check(goodHeaders());
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("pairing_window_closed");
    });

    it("rejects a wrong secret", () => {
        const gate = createPairingGate({ ...base, now: () => 1_500 });
        const result = gate.check({ [PAIRING_SECRET_HEADER]: "wrong", [PAIRING_NONCE_HEADER]: "n" });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("pairing_secret_invalid");
    });

    it("rejects a missing secret", () => {
        const gate = createPairingGate({ ...base, now: () => 1_500 });
        const result = gate.check({ [PAIRING_NONCE_HEADER]: "n" });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("pairing_secret_invalid");
    });

    it("rejects a missing nonce", () => {
        const gate = createPairingGate({ ...base, now: () => 1_500 });
        const result = gate.check({ [PAIRING_SECRET_HEADER]: secret });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("pairing_nonce_required");
    });

    it("accepts a valid attempt inside the window", () => {
        const gate = createPairingGate({ ...base, now: () => 1_500 });
        const result = gate.check(goodHeaders());
        expect(result.ok).toBe(true);
    });

    it("rejects a replayed nonce (single-use)", () => {
        const gate = createPairingGate({ ...base, now: () => 1_500 });
        expect(gate.check(goodHeaders("same")).ok).toBe(true);
        const replay = gate.check(goodHeaders("same"));
        expect(replay.ok).toBe(false);
        expect(replay.reason).toBe("pairing_nonce_replayed");
    });
});

describe("checkEdgeAccess — Cloudflare Access service token", () => {
    it("passes when no service tokens are configured (verifier remains the boundary)", () => {
        expect(checkEdgeAccess(undefined, {})).toBe(true);
        expect(checkEdgeAccess({ serviceTokens: [] }, {})).toBe(true);
    });

    it("rejects when tokens are configured but the CF-Access headers are absent", () => {
        expect(checkEdgeAccess({ serviceTokens: [{ clientId: "id", clientSecret: "secret" }] }, {})).toBe(false);
    });

    it("rejects a wrong secret", () => {
        expect(checkEdgeAccess({ serviceTokens: [{ clientId: "id", clientSecret: "secret" }] }, {
            [CF_ACCESS_CLIENT_ID_HEADER]: "id",
            [CF_ACCESS_CLIENT_SECRET_HEADER]: "nope",
        })).toBe(false);
    });

    it("accepts matching id + secret", () => {
        expect(checkEdgeAccess({ serviceTokens: [{ clientId: "id", clientSecret: "secret" }] }, {
            [CF_ACCESS_CLIENT_ID_HEADER]: "id",
            [CF_ACCESS_CLIENT_SECRET_HEADER]: "secret",
        })).toBe(true);
    });
});

describe("resolvePublicRoutePolicy — default-deny allowlist", () => {
    it("returns deviceProof for an allowlisted device route", () => {
        expect(resolvePublicRoutePolicy("GET", "/v1/sessions")).toBe("deviceProof");
        expect(resolvePublicRoutePolicy("get", "/v1/sessions")).toBe("deviceProof");
    });

    it("returns pairComplete for /pair/complete", () => {
        expect(resolvePublicRoutePolicy("POST", "/pair/complete")).toBe("pairComplete");
    });

    it("returns null (default-deny) for an unknown route", () => {
        expect(resolvePublicRoutePolicy("GET", "/totally/unknown")).toBeNull();
        expect(resolvePublicRoutePolicy("PUT", "/v1/sessions")).toBeNull();
        expect(resolvePublicRoutePolicy("GET", undefined)).toBeNull();
    });
});

describe("bodyHashGuard — signed body-hash binding (US-005a)", () => {
    const seed = Uint8Array.from({ length: 32 }, (_, i) => (i + 3) & 0xff);
    const keyId = "unit-device";

    async function runtimeWithDevice() {
        const seedEnvelope = await signPublicRequest({
            method: "POST",
            path: "/v1/version",
            keyId,
            nonce: "seed-nonce",
            issuedAt: Date.now(),
            bodyHash: hashRequestBody(null),
        }, seed);
        return createPublicAuthRuntime({
            devices: [{ keyId, publicKey: seedEnvelope.publicKey }],
            edge: { serviceTokens: [] },
        });
    }

    function fakeReply() {
        const captured: { statusCode?: number; payload?: unknown } = {};
        const reply: any = {
            code(status: number) { captured.statusCode = status; return reply; },
            send(payload: unknown) { captured.payload = payload; return reply; },
        };
        return { reply, captured };
    }

    async function envelopeFor(bodyHash: string, nonce: string, method = "POST", path = "/v1/version") {
        return signPublicRequest({ method, path, keyId, nonce, issuedAt: Date.now(), bodyHash }, seed);
    }

    it("passes when no authenticated envelope is present (non device-proof route)", async () => {
        const runtime = await runtimeWithDevice();
        const { reply, captured } = fakeReply();
        await runtime.bodyHashGuard({}, reply);
        expect(captured.statusCode).toBeUndefined();
    });

    it("rejects 401 body_hash_mismatch when the body differs from the signed hash (the exploit)", async () => {
        const runtime = await runtimeWithDevice();
        const envelope = await envelopeFor(hashRequestBody('{"a":1}'), "n-mismatch");
        const { reply, captured } = fakeReply();
        await runtime.bodyHashGuard({ publicDeviceEnvelope: envelope, rawBody: Buffer.from('{"a":2}') }, reply);
        expect(captured.statusCode).toBe(401);
        expect(captured.payload).toEqual({ error: "body_hash_mismatch" });
    });

    it("passes when the body matches the signed hash", async () => {
        const runtime = await runtimeWithDevice();
        const bodyStr = '{"a":1}';
        const envelope = await envelopeFor(hashRequestBody(bodyStr), "n-match");
        const { reply, captured } = fakeReply();
        await runtime.bodyHashGuard({ publicDeviceEnvelope: envelope, rawBody: Buffer.from(bodyStr) }, reply);
        expect(captured.statusCode).toBeUndefined();
    });

    it("fails closed when a body-bearing proof has no captured raw body (empty hash != signed non-empty hash)", async () => {
        const runtime = await runtimeWithDevice();
        const envelope = await envelopeFor(hashRequestBody('{"a":1}'), "n-nobody");
        const { reply, captured } = fakeReply();
        await runtime.bodyHashGuard({ publicDeviceEnvelope: envelope }, reply);
        expect(captured.statusCode).toBe(401);
        expect(captured.payload).toEqual({ error: "body_hash_mismatch" });
    });

    it("passes a bodyless proof (empty-body hash) when no raw body is present", async () => {
        const runtime = await runtimeWithDevice();
        const envelope = await envelopeFor(hashRequestBody(null), "n-empty", "GET", "/");
        const { reply, captured } = fakeReply();
        await runtime.bodyHashGuard({ publicDeviceEnvelope: envelope }, reply);
        expect(captured.statusCode).toBeUndefined();
    });
});
