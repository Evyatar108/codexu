import { describe, expect, it } from "vitest";
import {
    CF_ACCESS_CLIENT_ID_HEADER,
    CF_ACCESS_CLIENT_SECRET_HEADER,
    PAIRING_NONCE_HEADER,
    PAIRING_SECRET_HEADER,
    checkEdgeAccess,
    createPairingGate,
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
