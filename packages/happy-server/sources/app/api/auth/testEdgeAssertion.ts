import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK, type KeyLike } from "jose";
import { CF_ACCESS_JWT_ASSERTION_HEADER, type EdgeAssertionConfig } from "./edgeAssertion";

// ---------------------------------------------------------------------------
// Shared test helper: mint a valid `Cf-Access-Jwt-Assertion` + build a matching
// `EdgeAssertionConfig` wired to an IN-PROCESS local JWKS (zero network). Specs
// that migrated their positive controls from the (now non-functional) CF service
// -token headers to a signed assertion use this so one valid token can be minted
// once and reused across many `app.inject` calls (assertions, unlike device-proof
// nonces, are not single-use).
// ---------------------------------------------------------------------------

export const TEST_TEAM_DOMAIN = "evyatar-codexu.cloudflareaccess.com";
export const TEST_APP_AUD = "3978a5b707e4bfa1d94adfef748c8b7549db394cc7d6866e75adc1aaf1ebe88e";
const TEST_ISSUER = `https://${TEST_TEAM_DOMAIN}`;
const TEST_KID = "test-edge-key";

export interface TestMintOptions {
    iss?: string;
    aud?: string | string[];
    /** Absolute epoch-seconds expiration (default now + 1h). */
    exp?: number;
    /** Absolute epoch-seconds not-before. */
    nbf?: number;
    /** Set to null to omit common_name entirely. */
    commonName?: string | null;
    sub?: string;
    /** Sign with a key absent from the JWKS → signature verification fails. */
    invalidSignature?: boolean;
}

export interface TestEdgeAssertion {
    /** EdgeAssertionConfig wired with an in-process local JWKS (zero network). */
    assertionConfig: EdgeAssertionConfig;
    /** The lowercase header name Cloudflare Access injects. */
    headerName: string;
    /** A pre-minted valid assertion (correct iss + aud, unexpired). */
    validToken: string;
    /** Mint a fresh assertion, overriding claims/signing as needed. */
    mint: (options?: TestMintOptions) => Promise<string>;
    /** Header map carrying a valid (or supplied) assertion. */
    headers: (token?: string) => Record<string, string>;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * Builds a self-contained edge-assertion test fixture. Call from a spec's
 * top-level await or `beforeAll`; reuse `validToken` across injects.
 */
export async function buildTestEdgeAssertion(
    configOverrides: Partial<EdgeAssertionConfig> = {},
): Promise<TestEdgeAssertion> {
    const primary = await generateKeyPair("RS256");
    const signingKey: KeyLike = primary.privateKey;
    const publicJwk: JWK = await exportJWK(primary.publicKey);
    publicJwk.kid = TEST_KID;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    const jwks = createLocalJWKSet({ keys: [publicJwk] });

    const wrong = await generateKeyPair("RS256");
    const wrongKey: KeyLike = wrong.privateKey;

    const assertionConfig: EdgeAssertionConfig = {
        teamDomain: TEST_TEAM_DOMAIN,
        appAud: TEST_APP_AUD,
        jwks,
        ...configOverrides,
    };

    async function mint(options: TestMintOptions = {}): Promise<string> {
        const payload: Record<string, unknown> = {};
        if (options.commonName !== null) {
            payload.common_name = options.commonName ?? "operator@example.com";
        }
        if (options.sub !== undefined) {
            payload.sub = options.sub;
        }
        const builder = new SignJWT(payload)
            .setProtectedHeader({ alg: "RS256", kid: TEST_KID })
            .setIssuer(options.iss ?? TEST_ISSUER)
            .setAudience(options.aud ?? [TEST_APP_AUD])
            .setIssuedAt(nowSec())
            .setExpirationTime(options.exp ?? nowSec() + 3600);
        if (options.nbf !== undefined) {
            builder.setNotBefore(options.nbf);
        }
        return builder.sign(options.invalidSignature ? wrongKey : signingKey);
    }

    const validToken = await mint();

    return {
        assertionConfig,
        headerName: CF_ACCESS_JWT_ASSERTION_HEADER,
        validToken,
        mint,
        headers: (token?: string) => ({ [CF_ACCESS_JWT_ASSERTION_HEADER]: token ?? validToken }),
    };
}
