import { describe, expect, it } from "vitest";
import {
    signPublicRequest,
    hashRequestBody,
    encodePublicDeviceProofHeader,
    PUBLIC_DEVICE_PROOF_HEADER,
} from "@slopus/happy-wire";
import {
    CF_ACCESS_CLIENT_ID_HEADER,
    CF_ACCESS_CLIENT_SECRET_HEADER,
    PAIRING_NONCE_HEADER,
    PAIRING_SECRET_HEADER,
    SOCKET_PROOF_METHOD,
    SOCKET_PROOF_PATH,
    checkEdgeAccess,
    createPairingGate,
    createPublicAuthRuntime,
    createRemoteDeviceVerifier,
    isEdgeAllowed,
    isValidDeviceKeyId,
    isValidEd25519PublicKeyBase64,
    resolvePublicRoutePolicy,
} from "./remoteDeviceAuth";
import { buildTestEdgeAssertion } from "./testEdgeAssertion";

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

describe("isEdgeAllowed — assertion-first edge guard with legacy fallback", () => {
    it("falls back to the legacy service-token check when no assertion is configured", async () => {
        // No assertion configured + no tokens → open (verifier remains the boundary).
        await expect(isEdgeAllowed({ serviceTokens: [] }, {})).resolves.toBe(true);
        // Tokens configured but headers absent → legacy path rejects (fail-closed).
        await expect(
            isEdgeAllowed({ serviceTokens: [{ clientId: "id", clientSecret: "secret" }] }, {}),
        ).resolves.toBe(false);
        // Matching legacy headers → legacy path accepts.
        await expect(
            isEdgeAllowed({ serviceTokens: [{ clientId: "id", clientSecret: "secret" }] }, {
                [CF_ACCESS_CLIENT_ID_HEADER]: "id",
                [CF_ACCESS_CLIENT_SECRET_HEADER]: "secret",
            }),
        ).resolves.toBe(true);
    });

    it("verifies the CF assertion (ignoring service-token headers) when assertion is configured", async () => {
        const edge = await buildTestEdgeAssertion();
        const config = { serviceTokens: [], assertion: edge.assertionConfig };
        // Valid minted assertion → accepted, even though no CF-Access-Client-* headers are present.
        await expect(isEdgeAllowed(config, edge.headers())).resolves.toBe(true);
        // Missing assertion header → rejected (assertion path is now the edge boundary).
        await expect(isEdgeAllowed(config, {})).resolves.toBe(false);
        // Expired assertion → rejected.
        const expired = await edge.mint({ exp: Math.floor(Date.now() / 1000) - 60 });
        await expect(isEdgeAllowed(config, edge.headers(expired))).resolves.toBe(false);
        // A legacy service-token header cannot satisfy the assertion path.
        await expect(
            isEdgeAllowed(config, {
                [CF_ACCESS_CLIENT_ID_HEADER]: "id",
                [CF_ACCESS_CLIENT_SECRET_HEADER]: "secret",
            }),
        ).resolves.toBe(false);
    });
});

describe("createPublicAuthRuntime — assertion edge check on HTTP guard + socket handshake", () => {
    it("rejects a public HTTP request whose CF assertion is missing/invalid but accepts a valid one", async () => {
        const edge = await buildTestEdgeAssertion();
        const runtime = createPublicAuthRuntime({
            devices: [],
            edge: { serviceTokens: [], assertion: edge.assertionConfig },
        });

        function reply() {
            const captured: { code?: number; body?: unknown } = {};
            return {
                captured,
                code(status: number) {
                    captured.code = status;
                    return { send(body: unknown) { captured.body = body; return body; } };
                },
            };
        }

        // Missing assertion → edge_access_denied before any device-proof check.
        const missing = reply();
        await runtime.httpGuard(
            { method: "GET", url: "/v1/sessions", headers: {}, routeOptions: { url: "/v1/sessions" } },
            missing,
        );
        expect(missing.captured.code).toBe(401);
        expect(missing.captured.body).toEqual({ error: "edge_access_denied" });

        // Valid assertion but no device proof → passes the edge, fails at device proof.
        const noProof = reply();
        await runtime.httpGuard(
            { method: "GET", url: "/v1/sessions", headers: edge.headers(), routeOptions: { url: "/v1/sessions" } },
            noProof,
        );
        expect(noProof.captured.code).toBe(401);
        expect(noProof.captured.body).toEqual({ error: "device_proof_required" });
    });

    it("rejects a socket handshake with a missing assertion (edge_access_denied)", async () => {
        const edge = await buildTestEdgeAssertion();
        const runtime = createPublicAuthRuntime({
            devices: [],
            edge: { serviceTokens: [], assertion: edge.assertionConfig },
        });
        const denied = await runtime.verifySocketHandshake({});
        expect(denied.ok).toBe(false);
        expect(denied.reason).toBe("edge_access_denied");
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

describe("device-key shape validators", () => {
    it("accepts well-formed keyIds", () => {
        expect(isValidDeviceKeyId("device-1")).toBe(true);
        expect(isValidDeviceKeyId("AbC._:-09")).toBe(true);
        expect(isValidDeviceKeyId("x".repeat(128))).toBe(true);
    });

    it("rejects empty, over-long, or bad-charset keyIds", () => {
        expect(isValidDeviceKeyId("")).toBe(false);
        expect(isValidDeviceKeyId("x".repeat(129))).toBe(false);
        expect(isValidDeviceKeyId("has space")).toBe(false);
        expect(isValidDeviceKeyId("has/slash")).toBe(false);
        expect(isValidDeviceKeyId("emoji\u{1F600}")).toBe(false);
    });

    it("accepts a base64 32-byte Ed25519 public key", async () => {
        const seed = Uint8Array.from({ length: 32 }, (_, i) => (i + 11) & 0xff);
        const envelope = await signPublicRequest({
            method: "GET",
            path: "/",
            keyId: "k",
            nonce: "n",
            issuedAt: Date.now(),
            bodyHash: hashRequestBody(null),
        }, seed);
        expect(isValidEd25519PublicKeyBase64(envelope.publicKey)).toBe(true);
    });

    it("rejects a wrong-length or malformed base64 public key", () => {
        expect(isValidEd25519PublicKeyBase64("")).toBe(false);
        // 31 bytes base64 -> not a valid Ed25519 key length.
        expect(isValidEd25519PublicKeyBase64(Buffer.alloc(31).toString("base64"))).toBe(false);
        // 33 bytes.
        expect(isValidEd25519PublicKeyBase64(Buffer.alloc(33).toString("base64"))).toBe(false);
        expect(isValidEd25519PublicKeyBase64("!!!not-base64!!!")).toBe(false);
    });
});

describe("createRemoteDeviceVerifier — enroll (TOFU pin) + strict single-use", () => {
    const keyId = "enroll-device";

    async function deviceProof(nonce: string, method = SOCKET_PROOF_METHOD, path = SOCKET_PROOF_PATH) {
        const seed = Uint8Array.from({ length: 32 }, (_, i) => (i + 5) & 0xff);
        const envelope = await signPublicRequest({
            method,
            path,
            keyId,
            nonce,
            issuedAt: Date.now(),
            bodyHash: hashRequestBody(null),
        }, seed);
        return { envelope, header: encodePublicDeviceProofHeader(envelope) };
    }

    it("starts with an EMPTY device set that fails a valid proof closed (unknown_key)", async () => {
        const verifier = createRemoteDeviceVerifier({ devices: [] });
        const { header } = await deviceProof("n0");
        const result = await verifier.verify({ method: SOCKET_PROOF_METHOD, path: SOCKET_PROOF_PATH, header });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("unknown_key");
    });

    it("pins a device via enroll() so a subsequent proof from that key VERIFIES", async () => {
        const verifier = createRemoteDeviceVerifier({ devices: [] });
        const { envelope, header } = await deviceProof("n1");
        const enroll = verifier.enroll({ keyId, publicKey: envelope.publicKey });
        expect(enroll).toEqual({ ok: true, enrolled: true });
        const result = await verifier.verify({ method: SOCKET_PROOF_METHOD, path: SOCKET_PROOF_PATH, header });
        expect(result.ok).toBe(true);
        expect(result.keyId).toBe(keyId);
    });

    it("is idempotent for the same (keyId, publicKey) pair", async () => {
        const verifier = createRemoteDeviceVerifier({ devices: [] });
        const { envelope } = await deviceProof("n2");
        expect(verifier.enroll({ keyId, publicKey: envelope.publicKey })).toEqual({ ok: true, enrolled: true });
        expect(verifier.enroll({ keyId, publicKey: envelope.publicKey })).toEqual({ ok: true, enrolled: false });
        expect(verifier.listDevices()).toHaveLength(1);
    });

    it("rejects re-enrolling a pinned keyId with a DIFFERENT key (device_key_conflict), no overwrite", async () => {
        const verifier = createRemoteDeviceVerifier({ devices: [] });
        const first = await deviceProof("n3a");
        const secondSeed = Uint8Array.from({ length: 32 }, (_, i) => (i + 99) & 0xff);
        const secondEnvelope = await signPublicRequest({
            method: SOCKET_PROOF_METHOD,
            path: SOCKET_PROOF_PATH,
            keyId,
            nonce: "n3b",
            issuedAt: Date.now(),
            bodyHash: hashRequestBody(null),
        }, secondSeed);
        expect(verifier.enroll({ keyId, publicKey: first.envelope.publicKey })).toEqual({ ok: true, enrolled: true });
        const conflict = verifier.enroll({ keyId, publicKey: secondEnvelope.publicKey });
        expect(conflict).toEqual({ ok: false, reason: "device_key_conflict" });
        // The original key is still the pinned one.
        expect(verifier.listDevices()).toEqual([{ keyId, publicKey: first.envelope.publicKey }]);
    });

    it("rejects a malformed enroll record (invalid_device_key)", () => {
        const verifier = createRemoteDeviceVerifier({ devices: [] });
        expect(verifier.enroll({ keyId: "bad id", publicKey: Buffer.alloc(32).toString("base64") }))
            .toEqual({ ok: false, reason: "invalid_device_key" });
        expect(verifier.enroll({ keyId, publicKey: "not-a-key" }))
            .toEqual({ ok: false, reason: "invalid_device_key" });
        expect(verifier.listDevices()).toHaveLength(0);
    });

    it("the socket-handshake path (verify) is STRICTLY single-use — a byte-identical replay of the same nonce fails closed (replayed_nonce)", async () => {
        const verifier = createRemoteDeviceVerifier({ devices: [] });
        const { envelope, header } = await deviceProof("handshake-n1");
        verifier.enroll({ keyId, publicKey: envelope.publicKey });
        const first = await verifier.verify({ method: SOCKET_PROOF_METHOD, path: SOCKET_PROOF_PATH, header });
        expect(first.ok).toBe(true);
        // Same header replayed (identical nonce + signature). Unlike a bounded idempotent
        // handshake exception, the socket path stays strict: the reused nonce is rejected.
        // The app avoids this by connecting with reconnection:false + a single transport
        // (US-007 flag; documented for US-009 edge ops).
        const second = await verifier.verify({ method: SOCKET_PROOF_METHOD, path: SOCKET_PROOF_PATH, header });
        expect(second.ok).toBe(false);
        expect(second.reason).toBe("replayed_nonce");
    });

    it("rejects a DIFFERENT envelope reusing a consumed nonce on the socket path (replayed_nonce)", async () => {
        const verifier = createRemoteDeviceVerifier({ devices: [] });
        const seed = Uint8Array.from({ length: 32 }, (_, i) => (i + 5) & 0xff);
        const nonce = "handshake-shared-nonce";
        const envA = await signPublicRequest({
            method: SOCKET_PROOF_METHOD, path: SOCKET_PROOF_PATH, keyId, nonce, issuedAt: Date.now(), bodyHash: hashRequestBody(null),
        }, seed);
        verifier.enroll({ keyId, publicKey: envA.publicKey });
        const okFirst = await verifier.verify({ method: SOCKET_PROOF_METHOD, path: SOCKET_PROOF_PATH, header: encodePublicDeviceProofHeader(envA) });
        expect(okFirst.ok).toBe(true);
        // A different proof (different issuedAt -> different signature) reusing the SAME nonce must fail.
        const envB = await signPublicRequest({
            method: SOCKET_PROOF_METHOD, path: SOCKET_PROOF_PATH, keyId, nonce, issuedAt: Date.now() + 1, bodyHash: hashRequestBody(null),
        }, seed);
        const reject = await verifier.verify({ method: SOCKET_PROOF_METHOD, path: SOCKET_PROOF_PATH, header: encodePublicDeviceProofHeader(envB) });
        expect(reject.ok).toBe(false);
        expect(reject.reason).toBe("replayed_nonce");
    });

    it("HTTP verify() stays STRICTLY single-use — the same nonce fails on the second call", async () => {
        const verifier = createRemoteDeviceVerifier({ devices: [] });
        const { envelope, header } = await deviceProof("http-n1", "POST", "/v1/version");
        verifier.enroll({ keyId, publicKey: envelope.publicKey });
        const first = await verifier.verify({ method: "POST", path: "/v1/version", header });
        expect(first.ok).toBe(true);
        const second = await verifier.verify({ method: "POST", path: "/v1/version", header });
        expect(second.ok).toBe(false);
        expect(second.reason).toBe("replayed_nonce");
    });
});

describe("createPublicAuthRuntime.enrollDevice — pin into the live verifier + persistence hook", () => {
    const keyId = "runtime-enroll-device";

    async function proofFor(nonce: string) {
        const seed = Uint8Array.from({ length: 32 }, (_, i) => (i + 7) & 0xff);
        const envelope = await signPublicRequest({
            method: SOCKET_PROOF_METHOD,
            path: SOCKET_PROOF_PATH,
            keyId,
            nonce,
            issuedAt: Date.now(),
            bodyHash: hashRequestBody(null),
        }, seed);
        return { envelope, header: encodePublicDeviceProofHeader(envelope) };
    }

    it("enrolls into the SAME verifier the socket handshake reads, and fires onDeviceEnrolled once", async () => {
        const persisted: Array<{ device: unknown; all: unknown }> = [];
        const runtime = createPublicAuthRuntime({
            devices: [],
            edge: { serviceTokens: [] },
            onDeviceEnrolled: (device, all) => { persisted.push({ device, all }); },
        });
        const { envelope, header } = await proofFor("rt-n1");

        // Before enrollment the socket handshake fails closed.
        const before = await runtime.verifySocketHandshake({ [PUBLIC_DEVICE_PROOF_HEADER]: header });
        expect(before.ok).toBe(false);
        expect(before.reason).toBe("unknown_key");

        const enroll = await runtime.enrollDevice({ keyId, publicKey: envelope.publicKey });
        expect(enroll).toEqual({ ok: true, enrolled: true });
        expect(persisted).toHaveLength(1);
        expect(persisted[0].device).toEqual({ keyId, publicKey: envelope.publicKey });
        expect(persisted[0].all).toEqual([{ keyId, publicKey: envelope.publicKey }]);

        // After enrollment the SAME runtime's socket handshake verifies.
        const after = await runtime.verifySocketHandshake({ [PUBLIC_DEVICE_PROOF_HEADER]: header });
        expect(after.ok).toBe(true);
        expect(after.keyId).toBe(keyId);
    });

    it("does NOT fire onDeviceEnrolled on an idempotent re-enroll, and rejects a conflicting key", async () => {
        let calls = 0;
        const runtime = createPublicAuthRuntime({
            devices: [],
            edge: { serviceTokens: [] },
            onDeviceEnrolled: () => { calls += 1; },
        });
        const { envelope } = await proofFor("rt-n2");
        expect(await runtime.enrollDevice({ keyId, publicKey: envelope.publicKey })).toEqual({ ok: true, enrolled: true });
        expect(await runtime.enrollDevice({ keyId, publicKey: envelope.publicKey })).toEqual({ ok: true, enrolled: false });
        expect(calls).toBe(1);

        const conflictKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => (i + 200) & 0xff)).toString("base64");
        expect(await runtime.enrollDevice({ keyId, publicKey: conflictKey })).toEqual({ ok: false, reason: "device_key_conflict" });
        expect(calls).toBe(1);
    });
});
