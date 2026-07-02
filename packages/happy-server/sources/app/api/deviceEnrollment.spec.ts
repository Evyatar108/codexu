import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createApi, configureApi, type TofuHandshakeConfig } from "./api";
import {
    PUBLIC_DEVICE_PROOF_HEADER,
    signPublicRequest,
    encodePublicDeviceProofHeader,
    generatePublicRequestNonce,
    hashRequestBody,
} from "@slopus/happy-wire";
import {
    CF_ACCESS_CLIENT_ID_HEADER,
    CF_ACCESS_CLIENT_SECRET_HEADER,
    PAIRING_NONCE_HEADER,
    PAIRING_SECRET_HEADER,
    type PublicAuthConfig,
} from "./auth/remoteDeviceAuth";

// ---------------------------------------------------------------------------
// Enroll -> authenticate acceptance test (the enrollment->verification gap).
//
// Proves the loop is CLOSED end to end: a device paired via POST /pair/complete
// (inside the operator window + valid QR secret) is TOFU-pinned into the SAME
// verifier that guards every protected route, so a proof signed by that device's
// key then VERIFIES (200). An un-enrolled key still FAILS CLOSED (401), and the
// operator pairing gate is NOT weakened — an out-of-window / bad-secret pairing
// attempt is rejected (401) and pins NOTHING. Re-enrolling a pinned keyId with a
// different key is rejected (409) without disturbing the original pin.
// ---------------------------------------------------------------------------

const EDGE_CLIENT_ID = "CF-EDGE-CLIENT-ID";
const EDGE_CLIENT_SECRET_SENTINEL = "CF-EDGE-CLIENT-SECRET-SENTINEL";
const PAIRING_SECRET = "pairing-qr-secret";

const TOFU_ED25519_SENTINEL = "TOFU-ED25519-PUBLIC-KEY-SENTINEL";
const TOFU_X25519_SENTINEL = "TOFU-X25519-PUBLIC-KEY-SENTINEL";
const TOFU_FINGERPRINT_SENTINEL = "TOFU-ED25519-FINGERPRINT-SENTINEL";
const TUNNEL_URL_SENTINEL = "https://tunnel-url-SENTINEL.example";

// Key material / secrets that must NEVER appear in a fail-closed (401/400) body.
const SECRET_SENTINELS = [
    TOFU_ED25519_SENTINEL,
    TOFU_X25519_SENTINEL,
    TOFU_FINGERPRINT_SENTINEL,
    TUNNEL_URL_SENTINEL,
    EDGE_CLIENT_SECRET_SENTINEL,
];

const tofuConfig: TofuHandshakeConfig = {
    localUserId: "operator-user",
    publicUrl: TUNNEL_URL_SENTINEL,
    tofuPublicKeys: {
        ed25519PublicKey: TOFU_ED25519_SENTINEL,
        x25519PublicKey: TOFU_X25519_SENTINEL,
        ed25519Fingerprint: TOFU_FINGERPRINT_SENTINEL,
    },
};

const deviceSeed = Uint8Array.from({ length: 32 }, (_, i) => (i + 11) & 0xff);
const otherSeed = Uint8Array.from({ length: 32 }, (_, i) => (i + 200) & 0xff);
const deviceKeyId = "enrolled-device";

function edgeHeaders(): Record<string, string> {
    return {
        [CF_ACCESS_CLIENT_ID_HEADER]: EDGE_CLIENT_ID,
        [CF_ACCESS_CLIENT_SECRET_HEADER]: EDGE_CLIENT_SECRET_SENTINEL,
    };
}

/** Derives the base64 Ed25519 public key for a seed (by signing a throwaway proof). */
async function publicKeyForSeed(seed: Uint8Array, keyId: string): Promise<string> {
    const envelope = await signPublicRequest({
        method: "GET",
        path: "/",
        keyId,
        nonce: generatePublicRequestNonce(),
        issuedAt: Date.now(),
        bodyHash: hashRequestBody(null),
    }, seed);
    return envelope.publicKey;
}

/** Builds a device-proof header bound to method+path, with a fresh single-use nonce. */
async function proofHeader(seed: Uint8Array, keyId: string, method: string, urlPath: string): Promise<string> {
    const envelope = await signPublicRequest({
        method,
        path: urlPath,
        keyId,
        nonce: generatePublicRequestNonce(),
        issuedAt: Date.now(),
        bodyHash: hashRequestBody(null),
    }, seed);
    return encodePublicDeviceProofHeader(envelope);
}

let tmpDir: string;
let profilePath: string;

beforeAll(() => {
    // Write a temp profile.json (NOT in /tmp) so /pair/complete reaches the enrollment
    // step (a missing profile short-circuits to 503 BEFORE any device is pinned).
    tmpDir = fs.mkdtempSync(path.join(__dirname, "devenroll-"));
    profilePath = path.join(tmpDir, "profile.json");
    fs.writeFileSync(profilePath, JSON.stringify({ githubUserId: 4242, githubLogin: "operator" }));
});

afterAll(() => {
    if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

/** A fresh public-mode app with an EMPTY device set (so enrollment is what pins). */
async function buildApp(pairing?: { windowOpenedAt?: number; windowClosesAt?: number }) {
    const publicAuth: PublicAuthConfig = {
        devices: [],
        edge: { serviceTokens: [{ clientId: EDGE_CLIENT_ID, clientSecret: EDGE_CLIENT_SECRET_SENTINEL }] },
        pairing: {
            secret: PAIRING_SECRET,
            windowOpenedAt: pairing?.windowOpenedAt ?? 0,
            windowClosesAt: pairing?.windowClosesAt ?? Number.MAX_SAFE_INTEGER,
        },
    };
    const app = createApi();
    configureApi(app, tofuConfig, { auth: "public", publicAuth, paths: { profile: profilePath } });
    await app.ready();
    return app;
}

interface PairCompleteBody {
    deviceKeyId?: string;
    deviceEd25519PublicKey?: string;
}

function pairComplete(app: Awaited<ReturnType<typeof createApi>>, body: PairCompleteBody, secret = PAIRING_SECRET) {
    return app.inject({
        method: "POST",
        url: "/pair/complete",
        headers: {
            ...edgeHeaders(),
            [PAIRING_SECRET_HEADER]: secret,
            [PAIRING_NONCE_HEADER]: generatePublicRequestNonce(),
        },
        payload: body,
    });
}

function getRoot(app: Awaited<ReturnType<typeof createApi>>, proof: string) {
    return app.inject({
        method: "GET",
        url: "/",
        headers: {
            ...edgeHeaders(),
            [PUBLIC_DEVICE_PROOF_HEADER]: proof,
        },
    });
}

describe("device enrollment via /pair/complete -> authenticate", () => {
    it("(a) enrolls a device then a proof signed by THAT key VERIFIES (200) on a protected route", async () => {
        const app = await buildApp();
        try {
            const devicePublicKey = await publicKeyForSeed(deviceSeed, deviceKeyId);
            const pair = await pairComplete(app, { deviceKeyId, deviceEd25519PublicKey: devicePublicKey });
            expect(pair.statusCode).toBe(200);

            const proof = await proofHeader(deviceSeed, deviceKeyId, "GET", "/");
            const res = await getRoot(app, proof);
            expect(res.statusCode).toBe(200);
            expect(res.body).toContain("Welcome to Happy Server!");
        } finally {
            await app.close();
        }
    });

    it("(b) an un-enrolled device key FAILS CLOSED (401) on a protected route", async () => {
        const app = await buildApp();
        try {
            // No enrollment happened; a proof from a never-pinned key must be rejected.
            const proof = await proofHeader(deviceSeed, deviceKeyId, "GET", "/");
            const res = await getRoot(app, proof);
            expect(res.statusCode).toBe(401);
            expect(res.json()).toEqual({ error: "device_proof_required" });
        } finally {
            await app.close();
        }
    });

    it("(c) out-of-window enroll -> 401, no key material leaked, and NO device pinned", async () => {
        // Window already closed (now > windowClosesAt).
        const app = await buildApp({ windowOpenedAt: 0, windowClosesAt: 1 });
        try {
            const devicePublicKey = await publicKeyForSeed(deviceSeed, deviceKeyId);
            const pair = await pairComplete(app, { deviceKeyId, deviceEd25519PublicKey: devicePublicKey });
            expect(pair.statusCode).toBe(401);
            for (const sentinel of SECRET_SENTINELS) {
                expect(pair.body).not.toContain(sentinel);
            }
            // The device was NOT pinned: its proof still fails closed.
            const proof = await proofHeader(deviceSeed, deviceKeyId, "GET", "/");
            const res = await getRoot(app, proof);
            expect(res.statusCode).toBe(401);
        } finally {
            await app.close();
        }
    });

    it("(c') bad QR secret enroll -> 401 and NO device pinned", async () => {
        const app = await buildApp();
        try {
            const devicePublicKey = await publicKeyForSeed(deviceSeed, deviceKeyId);
            const pair = await pairComplete(app, { deviceKeyId, deviceEd25519PublicKey: devicePublicKey }, "WRONG-SECRET");
            expect(pair.statusCode).toBe(401);
            for (const sentinel of SECRET_SENTINELS) {
                expect(pair.body).not.toContain(sentinel);
            }
            const proof = await proofHeader(deviceSeed, deviceKeyId, "GET", "/");
            const res = await getRoot(app, proof);
            expect(res.statusCode).toBe(401);
        } finally {
            await app.close();
        }
    });

    it("(d) re-enroll of a pinned keyId with a DIFFERENT key -> 409, original key still authenticates", async () => {
        const app = await buildApp();
        try {
            const keyA = await publicKeyForSeed(deviceSeed, deviceKeyId);
            expect((await pairComplete(app, { deviceKeyId, deviceEd25519PublicKey: keyA })).statusCode).toBe(200);

            const keyB = await publicKeyForSeed(otherSeed, deviceKeyId);
            const conflict = await pairComplete(app, { deviceKeyId, deviceEd25519PublicKey: keyB });
            expect(conflict.statusCode).toBe(409);
            expect(conflict.json()).toEqual({ error: "device_key_conflict" });
            for (const sentinel of SECRET_SENTINELS) {
                expect(conflict.body).not.toContain(sentinel);
            }

            // Original key A still verifies; the conflicting key B was never pinned.
            const proofA = await proofHeader(deviceSeed, deviceKeyId, "GET", "/");
            expect((await getRoot(app, proofA)).statusCode).toBe(200);
            const proofB = await proofHeader(otherSeed, deviceKeyId, "GET", "/");
            expect((await getRoot(app, proofB)).statusCode).toBe(401);
        } finally {
            await app.close();
        }
    });

    it("idempotent re-enroll of the SAME key returns 200 and keeps the device authenticated", async () => {
        const app = await buildApp();
        try {
            const keyA = await publicKeyForSeed(deviceSeed, deviceKeyId);
            expect((await pairComplete(app, { deviceKeyId, deviceEd25519PublicKey: keyA })).statusCode).toBe(200);
            expect((await pairComplete(app, { deviceKeyId, deviceEd25519PublicKey: keyA })).statusCode).toBe(200);
            const proof = await proofHeader(deviceSeed, deviceKeyId, "GET", "/");
            expect((await getRoot(app, proof)).statusCode).toBe(200);
        } finally {
            await app.close();
        }
    });

    it("a malformed device public key -> 400 invalid_device_key, no device pinned", async () => {
        const app = await buildApp();
        try {
            const pair = await pairComplete(app, { deviceKeyId, deviceEd25519PublicKey: "not-a-valid-ed25519-key" });
            expect(pair.statusCode).toBe(400);
            expect(pair.json()).toEqual({ error: "invalid_device_key" });
            const proof = await proofHeader(deviceSeed, deviceKeyId, "GET", "/");
            expect((await getRoot(app, proof)).statusCode).toBe(401);
        } finally {
            await app.close();
        }
    });

    it("partial device identity (only the public key, no keyId) -> 400 invalid_device_key", async () => {
        const app = await buildApp();
        try {
            const keyA = await publicKeyForSeed(deviceSeed, deviceKeyId);
            const pair = await pairComplete(app, { deviceEd25519PublicKey: keyA });
            expect(pair.statusCode).toBe(400);
            expect(pair.json()).toEqual({ error: "invalid_device_key" });
        } finally {
            await app.close();
        }
    });

    it("back-compat: /pair/complete with NO device fields still pairs (200), pinning nothing", async () => {
        const app = await buildApp();
        try {
            const pair = await pairComplete(app, {});
            expect(pair.statusCode).toBe(200);
            // Nothing pinned: an arbitrary key's proof still fails closed.
            const proof = await proofHeader(deviceSeed, deviceKeyId, "GET", "/");
            expect((await getRoot(app, proof)).statusCode).toBe(401);
        } finally {
            await app.close();
        }
    });
});
