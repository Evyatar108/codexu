import {
    createRemoteJWKSet,
    jwtVerify,
    type JWTPayload,
    type JWTVerifyGetKey,
    type JWTVerifyResult,
} from "jose";

// ---------------------------------------------------------------------------
// Cloudflare Access edge-assertion verifier (public mode, defense in depth)
//
// Cloudflare Access terminates the browser/service-token authentication at its
// edge and then STRIPS the `CF-Access-Client-Id` / `CF-Access-Client-Secret`
// request headers before forwarding to the origin. The origin therefore cannot
// re-check the service-token pair (the legacy `checkEdgeAccess` path can never
// pass through real CF). What CF *does* forward is a short-lived, RS256-signed
// JWT in the `Cf-Access-Jwt-Assertion` header. This module cryptographically
// verifies that JWT — signature (against CF's rotating JWKS), issuer, audience
// (the Access application AUD tag) and exp/nbf — so the edge check is a real
// boundary rather than a no-op. It is fail-closed: anything we cannot positively
// verify (missing header, bad signature, wrong iss/aud, expired, JWKS
// unavailable) is rejected.
//
// The Ed25519 signed-request device proof remains the PRIMARY app-layer
// boundary; this assertion check is additive defense in depth at the edge.
// ---------------------------------------------------------------------------

/**
 * Header Cloudflare Access injects between its edge and the origin. Fastify
 * lowercases incoming header names, so we read the lowercase form. A browser
 * NEVER sends this header, which is why it must not appear in the CORS
 * `allowedHeaders` preflight allowlist.
 */
export const CF_ACCESS_JWT_ASSERTION_HEADER = "cf-access-jwt-assertion";

export interface EdgeAssertionConfig {
    /** Cloudflare Access team domain, e.g. "evyatar-codexu.cloudflareaccess.com". */
    teamDomain: string;
    /** The Access application AUD tag (the token's `aud` must include this). */
    appAud: string;
    /** Optional explicit JWKS certs URL; defaults to the derived team-domain endpoint. */
    jwksUrl?: string;
    /**
     * Optional identity allowlist. When set, the verified token's identity
     * (`common_name`, falling back to `sub`) must be a member. Unset/empty =
     * identity is not checked (signature + iss + aud + exp remain mandatory).
     */
    expectedIdentities?: string[];
    /**
     * Injectable JWKS key resolver for tests — a `createLocalJWKSet(...)` value —
     * so specs mint + verify assertions with zero network access. When omitted a
     * fail-closed `createRemoteJWKSet` is built (lazily fetched + cached + rotated).
     */
    jwks?: JWTVerifyGetKey;
    /** Injectable clock for tests (drives exp/nbf evaluation). */
    now?: () => number;
}

export type EdgeAssertionReason =
    | "assertion_missing"
    | "assertion_invalid"
    | "assertion_expired"
    | "assertion_aud_mismatch"
    | "assertion_iss_mismatch"
    | "assertion_identity_denied"
    | "assertion_key_unavailable";

export interface EdgeAssertionResult {
    ok: boolean;
    /** Present on failure. */
    reason?: EdgeAssertionReason;
    /** The verified identity (`common_name`/`sub`) when available. */
    identity?: string;
}

export type EdgeAssertionVerifier = (headers: Record<string, unknown>) => Promise<EdgeAssertionResult>;

function normalizeTeamDomain(teamDomain: string): string {
    return teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** Derives the Cloudflare Access JWKS certs endpoint from a team domain. */
export function deriveJwksUrl(teamDomain: string): string {
    return `https://${normalizeTeamDomain(teamDomain)}/cdn-cgi/access/certs`;
}

/** Derives the `iss` claim Cloudflare Access stamps into the assertion. */
export function deriveIssuer(teamDomain: string): string {
    return `https://${normalizeTeamDomain(teamDomain)}`;
}

function headerString(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
        return value[0];
    }
    return undefined;
}

/**
 * Maps a thrown jose error to a fail-closed rejection reason. Every unclassified
 * error (including an injected resolver that throws, or a remote JWKS fetch
 * failure) falls through to `assertion_key_unavailable` so verification never
 * "passes" on an error path.
 */
function classifyJoseError(err: unknown): EdgeAssertionReason {
    const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
    switch (code) {
        case "ERR_JWT_EXPIRED":
            return "assertion_expired";
        case "ERR_JWT_CLAIM_VALIDATION_FAILED": {
            const claim = typeof err === "object" && err !== null ? (err as { claim?: string }).claim : undefined;
            if (claim === "aud") {
                return "assertion_aud_mismatch";
            }
            if (claim === "iss") {
                return "assertion_iss_mismatch";
            }
            if (claim === "nbf" || claim === "exp") {
                return "assertion_expired";
            }
            return "assertion_invalid";
        }
        case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
        case "ERR_JWS_INVALID":
        case "ERR_JWT_INVALID":
        case "ERR_JOSE_ALG_NOT_ALLOWED":
        case "ERR_JWKS_NO_MATCHING_KEY":
        case "ERR_JWKS_MULTIPLE_MATCHING_KEYS":
            return "assertion_invalid";
        case "ERR_JWKS_TIMEOUT":
            return "assertion_key_unavailable";
        default:
            return "assertion_key_unavailable";
    }
}

function checkIdentity(config: EdgeAssertionConfig, payload: JWTPayload): EdgeAssertionResult {
    const commonName = typeof payload.common_name === "string" ? payload.common_name : undefined;
    const sub = typeof payload.sub === "string" ? payload.sub : undefined;
    const identity = commonName ?? sub;
    if (!config.expectedIdentities || config.expectedIdentities.length === 0) {
        return { ok: true, identity };
    }
    if (identity !== undefined && config.expectedIdentities.includes(identity)) {
        return { ok: true, identity };
    }
    return { ok: false, reason: "assertion_identity_denied", identity };
}

/**
 * Builds a fail-closed verifier for the `Cf-Access-Jwt-Assertion` header. Call
 * this ONCE (it is invoked from `createPublicAuthRuntime`) and reuse the returned
 * function — the JWKS is fetched, cached and rotated by jose across calls. Never
 * call it at module top-level: `createRemoteJWKSet` binds a live network fetcher.
 */
export function createEdgeAssertionVerifier(config: EdgeAssertionConfig): EdgeAssertionVerifier {
    const issuer = deriveIssuer(config.teamDomain);
    const jwksUrl = config.jwksUrl ?? deriveJwksUrl(config.teamDomain);
    const keyResolver: JWTVerifyGetKey = config.jwks ?? createRemoteJWKSet(new URL(jwksUrl));
    const now = config.now;

    return async function verifyEdgeAssertion(headers: Record<string, unknown>): Promise<EdgeAssertionResult> {
        const token = headerString(headers[CF_ACCESS_JWT_ASSERTION_HEADER]);
        if (!token) {
            return { ok: false, reason: "assertion_missing" };
        }
        let verifyResult: JWTVerifyResult;
        try {
            verifyResult = await jwtVerify(token, keyResolver, {
                issuer,
                audience: config.appAud,
                algorithms: ["RS256"],
                clockTolerance: "5s",
                ...(now ? { currentDate: new Date(now()) } : {}),
            });
        } catch (err) {
            return { ok: false, reason: classifyJoseError(err) };
        }
        return checkIdentity(config, verifyResult.payload);
    };
}
