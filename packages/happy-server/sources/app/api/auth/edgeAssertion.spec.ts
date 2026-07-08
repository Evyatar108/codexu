import { beforeAll, describe, expect, it } from "vitest";
import {
    SignJWT,
    createLocalJWKSet,
    exportJWK,
    generateKeyPair,
    type JWK,
    type JWTVerifyGetKey,
    type KeyLike,
} from "jose";
import {
    CF_ACCESS_JWT_ASSERTION_HEADER,
    createEdgeAssertionVerifier,
    deriveIssuer,
    deriveJwksUrl,
    type EdgeAssertionConfig,
} from "./edgeAssertion";

const TEAM_DOMAIN = "example-team.cloudflareaccess.com";
const APP_AUD = "3978a5b707e4bfa1d94adfef748c8b7549db394cc7d6866e75adc1aaf1ebe88e";
const ISSUER = `https://${TEAM_DOMAIN}`;
const KID = "test-key-1";

let signingKey: KeyLike;
let wrongSigningKey: KeyLike;
let jwks: JWTVerifyGetKey;

const nowSec = () => Math.floor(Date.now() / 1000);

interface MintOptions {
    key?: KeyLike;
    kid?: string;
    iss?: string;
    aud?: string | string[];
    /** Absolute epoch-seconds expiration. Defaults to now + 1h. */
    exp?: number;
    /** Absolute epoch-seconds not-before. */
    nbf?: number;
    commonName?: string | null;
    sub?: string;
}

async function mint(options: MintOptions = {}): Promise<string> {
    const payload: Record<string, unknown> = {};
    if (options.commonName !== null) {
        payload.common_name = options.commonName ?? "operator@example.com";
    }
    if (options.sub !== undefined) {
        payload.sub = options.sub;
    }
    const builder = new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", kid: options.kid ?? KID })
        .setIssuer(options.iss ?? ISSUER)
        .setAudience(options.aud ?? [APP_AUD])
        .setIssuedAt(nowSec())
        .setExpirationTime(options.exp ?? nowSec() + 3600);
    if (options.nbf !== undefined) {
        builder.setNotBefore(options.nbf);
    }
    return builder.sign(options.key ?? signingKey);
}

function verifier(overrides: Partial<EdgeAssertionConfig> = {}) {
    return createEdgeAssertionVerifier({
        teamDomain: TEAM_DOMAIN,
        appAud: APP_AUD,
        jwks,
        ...overrides,
    });
}

function headers(token?: string): Record<string, unknown> {
    return token === undefined ? {} : { [CF_ACCESS_JWT_ASSERTION_HEADER]: token };
}

beforeAll(async () => {
    const primary = await generateKeyPair("RS256");
    signingKey = primary.privateKey;
    const publicJwk: JWK = await exportJWK(primary.publicKey);
    publicJwk.kid = KID;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    jwks = createLocalJWKSet({ keys: [publicJwk] });

    const wrong = await generateKeyPair("RS256");
    wrongSigningKey = wrong.privateKey;
});

describe("edgeAssertion — deriveJwksUrl / deriveIssuer", () => {
    it("derives the CF Access certs endpoint from a bare team domain", () => {
        expect(deriveJwksUrl(TEAM_DOMAIN)).toBe(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`);
    });

    it("normalizes an accidental scheme + trailing slash", () => {
        expect(deriveJwksUrl(`https://${TEAM_DOMAIN}/`)).toBe(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`);
    });

    it("derives the issuer claim from the team domain", () => {
        expect(deriveIssuer(TEAM_DOMAIN)).toBe(ISSUER);
    });
});

describe("createEdgeAssertionVerifier — fail-closed JWT verification", () => {
    it("accepts a valid, unexpired assertion signed by the JWKS key with correct iss + aud", async () => {
        const token = await mint();
        const result = await verifier()(headers(token));
        expect(result.ok).toBe(true);
        expect(result.identity).toBe("operator@example.com");
        expect(result.reason).toBeUndefined();
    });

    it("matches aud when the token's aud is an array containing the app AUD", async () => {
        const token = await mint({ aud: ["some-other-aud", APP_AUD] });
        const result = await verifier()(headers(token));
        expect(result.ok).toBe(true);
    });

    it("rejects a missing assertion header (fail-closed)", async () => {
        const result = await verifier()(headers());
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("assertion_missing");
    });

    it("rejects a malformed (non-JWT) assertion", async () => {
        const result = await verifier()(headers("not-a-jwt"));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("assertion_invalid");
    });

    it("rejects an assertion with a bad signature (wrong key, right kid)", async () => {
        const token = await mint({ key: wrongSigningKey });
        const result = await verifier()(headers(token));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("assertion_invalid");
    });

    it("rejects an expired assertion", async () => {
        const token = await mint({ exp: nowSec() - 60 });
        const result = await verifier()(headers(token));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("assertion_expired");
    });

    it("rejects an assertion whose nbf is in the future", async () => {
        const token = await mint({ nbf: nowSec() + 3600 });
        const result = await verifier()(headers(token));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("assertion_expired");
    });

    it("rejects an assertion for the wrong audience", async () => {
        const token = await mint({ aud: "some-other-app-aud" });
        const result = await verifier()(headers(token));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("assertion_aud_mismatch");
    });

    it("rejects an assertion from the wrong issuer", async () => {
        const token = await mint({ iss: "https://evil.cloudflareaccess.com" });
        const result = await verifier()(headers(token));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("assertion_iss_mismatch");
    });

    it("rejects an assertion signed by an unknown key id (not in the JWKS)", async () => {
        const token = await mint({ key: wrongSigningKey, kid: "unknown-key" });
        const result = await verifier()(headers(token));
        expect(result.ok).toBe(false);
    });

    it("fails closed when the JWKS cannot be resolved (fetch/key failure)", async () => {
        const token = await mint();
        const throwingJwks: JWTVerifyGetKey = async () => {
            throw new Error("simulated JWKS fetch failure");
        };
        const result = await verifier({ jwks: throwingJwks })(headers(token));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("assertion_key_unavailable");
    });

    it("denies a valid assertion whose identity is not in expectedIdentities", async () => {
        const token = await mint({ commonName: "intruder@example.com" });
        const result = await verifier({ expectedIdentities: ["operator@example.com"] })(headers(token));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("assertion_identity_denied");
        expect(result.identity).toBe("intruder@example.com");
    });

    it("accepts a valid assertion whose identity is in expectedIdentities", async () => {
        const token = await mint({ commonName: "operator@example.com" });
        const result = await verifier({ expectedIdentities: ["operator@example.com"] })(headers(token));
        expect(result.ok).toBe(true);
        expect(result.identity).toBe("operator@example.com");
    });

    it("falls back to sub when common_name is absent for identity matching", async () => {
        const token = await mint({ commonName: null, sub: "device-sub-123" });
        const result = await verifier({ expectedIdentities: ["device-sub-123"] })(headers(token));
        expect(result.ok).toBe(true);
        expect(result.identity).toBe("device-sub-123");
    });
});
