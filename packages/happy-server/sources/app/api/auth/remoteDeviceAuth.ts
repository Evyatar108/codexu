import { timingSafeEqual } from "crypto";
import { decodeBase64 } from "privacy-kit";
import {
    PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS,
    PUBLIC_DEVICE_PROOF_FRESHNESS_MS,
    PUBLIC_DEVICE_PROOF_HEADER,
    decodePublicDeviceProofHeader,
    hashRequestBody,
    isPublicProofFresh,
    verifyPublicRequest,
    type PublicSignedRequestEnvelope,
} from "@slopus/happy-wire";
import {
    createEdgeAssertionVerifier,
    type EdgeAssertionConfig,
    type EdgeAssertionVerifier,
} from "./edgeAssertion";

// ---------------------------------------------------------------------------
// Remote device auth plane (public mode)
//
// This is the fail-closed application-layer boundary for exposing the embedded
// single-tenant happy-server on the public internet. It has three cooperating
// pieces, all modeled on the loopback-capability 401 pattern:
//   1. An Ed25519 signed-request verifier (per already-paired device, pinned
//      public key, replay-protected, freshness-bounded).
//   2. A mandatory Cloudflare Access service-token edge check (defense in depth).
//   3. An explicit method/path policy allowlist; anything not listed fails
//      closed (401) even with a valid device proof.
// ---------------------------------------------------------------------------

/** A paired device that is allowed to present proofs. */
export interface RemoteDeviceRecord {
    /** Stable identifier the device puts in `keyId` (e.g. a fingerprint or label). */
    keyId: string;
    /** base64-encoded Ed25519 public key (32 bytes). Pinned: the proof must match exactly. */
    publicKey: string;
    label?: string;
}

/** A Cloudflare Access service token (client id + secret pair). */
export interface EdgeAccessServiceToken {
    clientId: string;
    clientSecret: string;
}

export interface EdgeAccessConfig {
    serviceTokens: EdgeAccessServiceToken[];
    /**
     * Cloudflare Access edge-assertion expectation. When present, the public-mode
     * edge guard cryptographically verifies the CF-injected `Cf-Access-Jwt-Assertion`
     * JWT (signature against CF's JWKS + iss + aud + exp) INSTEAD of the legacy
     * service-token header pair — which real Cloudflare Access strips before the
     * origin and so can never pass through. The device Ed25519 proof remains the
     * PRIMARY app-layer boundary; this is additive edge defense in depth.
     */
    assertion?: EdgeAssertionConfig;
}

/** Operator-opened pairing window + pre-shared QR secret gate for `/pair/complete` (US-003). */
export interface PublicPairingConfig {
    /** base64/opaque pre-shared secret the operator surfaces via QR/manual entry. */
    secret: string;
    /** Epoch ms when the pairing window opened; requests before this are rejected. */
    windowOpenedAt: number;
    /** Epoch ms when the pairing window closes; requests after this are rejected. */
    windowClosesAt: number;
    /** Optional injectable clock for tests. */
    now?: () => number;
}

export interface PublicAuthConfig {
    /** Pinned paired devices allowed to present proofs. */
    devices: RemoteDeviceRecord[];
    /** Mandatory Cloudflare Access service-token expectation (edge defense in depth). */
    edge: EdgeAccessConfig;
    /** Freshness window for a proof's issuedAt (default 5 min). */
    freshnessMs?: number;
    /** Allowed forward clock skew (default 1 min). */
    clockSkewMs?: number;
    /** Operator pairing window for `/pair/complete` (US-003). */
    pairing?: PublicPairingConfig;
    /**
     * Optional durable-persistence hook invoked after a NEW device is TOFU-pinned
     * via `/pair/complete` enrollment. The single embedded daemon owner (happy-cli)
     * wires this to persist the enrolled device so it survives a daemon restart —
     * without it, enrollment is in-memory only for the current process lifetime.
     * Called with the freshly pinned device and the full current device list. It is
     * awaited best-effort; a persistence failure does NOT unpin the in-memory device
     * (the verifier is the source of truth for the current process).
     */
    onDeviceEnrolled?: (device: RemoteDeviceRecord, allDevices: RemoteDeviceRecord[]) => void | Promise<void>;
    /** Injectable clock for tests. */
    now?: () => number;
}

/** Ed25519 public keys are exactly 32 bytes; base64 of 32 bytes is 44 chars (padded). */
const ED25519_PUBLIC_KEY_BYTES = 32;
/** Conservative charset + length bound for a device `keyId` (fingerprint/label-like). */
const DEVICE_KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** True when `keyId` is a well-formed device identifier (charset + length bound). */
export function isValidDeviceKeyId(keyId: string): boolean {
    return DEVICE_KEY_ID_PATTERN.test(keyId);
}

/** True when `publicKey` decodes as a 32-byte Ed25519 public key (base64). */
export function isValidEd25519PublicKeyBase64(publicKey: string): boolean {
    let bytes: Uint8Array;
    try {
        bytes = decodeBase64(publicKey);
    } catch {
        return false;
    }
    return bytes.length === ED25519_PUBLIC_KEY_BYTES;
}

/** Validates the shape of a device-enrollment record before it is pinned. */
export function isValidDeviceRecordShape(record: RemoteDeviceRecord): boolean {
    return isValidDeviceKeyId(record.keyId) && isValidEd25519PublicKeyBase64(record.publicKey);
}

/** Outcome of a device-enrollment attempt against the live verifier. */
export interface DeviceEnrollResult {
    ok: boolean;
    /** Present on failure. `invalid_device_key` | `device_key_conflict`. */
    reason?: string;
    /** true when a NEW device was pinned; false on an idempotent re-enroll of the same key. */
    enrolled?: boolean;
}

export const CF_ACCESS_CLIENT_ID_HEADER = "cf-access-client-id";
export const CF_ACCESS_CLIENT_SECRET_HEADER = "cf-access-client-secret";

/** Pre-shared QR secret the operator surfaces to open a pairing attempt. */
export const PAIRING_SECRET_HEADER = "x-happy-pairing-secret";
/** Single-use nonce the mobile presents so a captured pairing request cannot be replayed. */
export const PAIRING_NONCE_HEADER = "x-happy-pairing-nonce";

/** Fixed method/path binding a device signs for the Socket.IO handshake proof. */
export const SOCKET_PROOF_METHOD = "GET";
export const SOCKET_PROOF_PATH = "/v1/updates";

function headerString(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
        return value[0];
    }
    return undefined;
}

function constantTimeEqual(a: string, b: string): boolean {
    const encoder = new TextEncoder();
    const ab = encoder.encode(a);
    const bb = encoder.encode(b);
    if (ab.length !== bb.length) {
        return false;
    }
    return timingSafeEqual(ab, bb);
}

/**
 * Validates the Cloudflare Access service-token headers. Fail-closed: if edge is
 * configured (it is mandatory for a public bind), a request without matching
 * `CF-Access-Client-Id`/`CF-Access-Client-Secret` headers is rejected. When no
 * service tokens are configured this returns true so the device verifier remains
 * the boundary (used only by non-public/test paths).
 */
export function checkEdgeAccess(config: EdgeAccessConfig | undefined, headers: Record<string, unknown>): boolean {
    if (!config || config.serviceTokens.length === 0) {
        return true;
    }
    const clientId = headerString(headers[CF_ACCESS_CLIENT_ID_HEADER]);
    const clientSecret = headerString(headers[CF_ACCESS_CLIENT_SECRET_HEADER]);
    if (!clientId || !clientSecret) {
        return false;
    }
    return config.serviceTokens.some(
        (token) => constantTimeEqual(token.clientId, clientId) && constantTimeEqual(token.clientSecret, clientSecret),
    );
}

/**
 * Fail-closed edge guard used by the live public-mode runtime. When an assertion
 * expectation is configured (the shipped public bind path), it verifies the
 * CF-injected `Cf-Access-Jwt-Assertion` JWT — real Cloudflare Access strips the
 * service-token headers, so the JWT is the only edge signal that survives to the
 * origin. When no assertion is configured it falls back to the legacy sync
 * `checkEdgeAccess` service-token check (kept for non-public/test paths and as a
 * fail-closed legacy fallback).
 *
 * `assertionVerifier` should be a verifier built ONCE (via
 * `createEdgeAssertionVerifier`) and reused so the JWKS is cached/rotated across
 * requests; `createPublicAuthRuntime` builds and closes over it. When omitted a
 * per-call verifier is built from `edge.assertion` (used by direct unit tests
 * that inject a local JWKS).
 */
export async function isEdgeAllowed(
    edge: EdgeAccessConfig | undefined,
    headers: Record<string, unknown>,
    assertionVerifier?: EdgeAssertionVerifier,
): Promise<boolean> {
    if (edge?.assertion) {
        const verify = assertionVerifier ?? createEdgeAssertionVerifier(edge.assertion);
        const result = await verify(headers);
        return result.ok;
    }
    return checkEdgeAccess(edge, headers);
}

export interface RemoteDeviceProofResult {
    ok: boolean;
    reason?: string;
    keyId?: string;
    /** The authenticated envelope (present only when ok). Carries the signed bodyHash. */
    envelope?: PublicSignedRequestEnvelope;
}

export interface RemoteDeviceVerifyInput {
    method: string;
    path: string;
    header: string | undefined;
}

export interface RemoteDeviceVerifier {
    verify(input: RemoteDeviceVerifyInput): Promise<RemoteDeviceProofResult>;
    /**
     * TOFU-pins a device into the live verifier's authorized set. Idempotent for an
     * identical (keyId, publicKey) pair; rejects a conflicting publicKey for an
     * already-pinned keyId (`device_key_conflict`) without overwriting; rejects a
     * malformed record (`invalid_device_key`). The mutation is visible immediately to
     * the shared `verify` path used by BOTH the HTTP guard and the socket handshake
     * because they read this same map.
     */
    enroll(record: RemoteDeviceRecord): DeviceEnrollResult;
    /** Snapshot of currently pinned devices (for durable persistence hooks). */
    listDevices(): RemoteDeviceRecord[];
}

/**
 * Builds the Ed25519 device-proof verifier. Enforces (in order): well-formed
 * envelope, known+pinned key, freshness, single-use nonce (replay cache), and
 * finally the cryptographic signature bound to method+path via `@slopus/happy-wire`.
 */
export function createRemoteDeviceVerifier(
    config: Pick<PublicAuthConfig, "devices" | "freshnessMs" | "clockSkewMs" | "now">,
): RemoteDeviceVerifier {
    const devicesByKeyId = new Map(config.devices.map((device) => [device.keyId, device]));
    const seenNonces = new Map<string, number>();
    const now = config.now ?? (() => Date.now());
    const windowMs = config.freshnessMs ?? PUBLIC_DEVICE_PROOF_FRESHNESS_MS;
    const clockSkewMs = config.clockSkewMs ?? PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS;

    function pruneNonces(nowMs: number): void {
        for (const [nonce, expiry] of seenNonces) {
            if (expiry <= nowMs) {
                seenNonces.delete(nonce);
            }
        }
    }

    /**
     * Proof verification: well-formed envelope, known+pinned key, freshness, strict
     * single-use nonce (replay cache), then the cryptographic signature bound to
     * method+path. Used by BOTH the HTTP guard and the socket handshake — a nonce is
     * consumed exactly once across transports, so a reused nonce always fails closed.
     */
    async function verify(
        { method, path, header }: RemoteDeviceVerifyInput,
    ): Promise<RemoteDeviceProofResult> {
        const envelope = decodePublicDeviceProofHeader(header);
        if (!envelope) {
            return { ok: false, reason: "missing_or_malformed_proof" };
        }
        const device = devicesByKeyId.get(envelope.keyId);
        if (!device) {
            return { ok: false, reason: "unknown_key" };
        }
        if (envelope.publicKey !== device.publicKey) {
            return { ok: false, reason: "public_key_mismatch" };
        }
        const nowMs = now();
        if (!isPublicProofFresh(envelope.issuedAt, nowMs, windowMs, clockSkewMs)) {
            return { ok: false, reason: "stale_proof" };
        }
        if (seenNonces.has(envelope.nonce)) {
            return { ok: false, reason: "replayed_nonce" };
        }
        const verification = await verifyPublicRequest(envelope, {
            method,
            path,
            expectedPublicKey: device.publicKey,
        });
        if (!verification.ok) {
            return { ok: false, reason: verification.reason };
        }
        pruneNonces(nowMs);
        seenNonces.set(envelope.nonce, envelope.issuedAt + windowMs + clockSkewMs);
        return { ok: true, keyId: envelope.keyId, envelope };
    }

    return {
        verify,
        enroll(record) {
            if (!isValidDeviceRecordShape(record)) {
                return { ok: false, reason: "invalid_device_key" };
            }
            const existing = devicesByKeyId.get(record.keyId);
            if (existing) {
                if (existing.publicKey === record.publicKey) {
                    return { ok: true, enrolled: false };
                }
                // TOFU: a pinned keyId may not be rebound to a different public key.
                return { ok: false, reason: "device_key_conflict" };
            }
            devicesByKeyId.set(record.keyId, { keyId: record.keyId, publicKey: record.publicKey });
            return { ok: true, enrolled: true };
        },
        listDevices() {
            return Array.from(devicesByKeyId.values(), (device) => ({
                keyId: device.keyId,
                publicKey: device.publicKey,
            }));
        },
    };
}

export type PublicRoutePolicy = "deviceProof" | "pairComplete";

export interface PublicRoutePolicyEntry {
    method: string;
    path: string;
    policy: PublicRoutePolicy;
}

/**
 * The explicit public-mode route policy allowlist. Every route that should be
 * reachable in public mode MUST be listed here with a named policy. Anything not
 * listed is denied (401) even with a valid device proof — a newly registered
 * route fails closed until it is deliberately added here.
 *
 * `deviceProof` → requires a valid Ed25519 device proof (and edge headers).
 * `pairComplete` → pre-enrollment: passes the edge check then reaches the route
 *   handler, which enforces the operator pairing window + QR secret + replay
 *   (see pairRoutes.ts). It never requires a device proof because the device is
 *   not yet paired.
 */
export const PUBLIC_ROUTE_POLICY_ALLOWLIST: PublicRoutePolicyEntry[] = [
    { method: "GET", path: "/", policy: "deviceProof" },
    { method: "GET", path: "/health", policy: "deviceProof" },
    { method: "GET", path: "/files/*", policy: "deviceProof" },
    { method: "POST", path: "/v1/version", policy: "deviceProof" },
    { method: "POST", path: "/logs-combined-from-cli-and-mobile-for-simple-ai-debugging", policy: "deviceProof" },
    { method: "POST", path: "/pair/complete", policy: "pairComplete" },
    { method: "POST", path: "/pair/connect", policy: "deviceProof" },
    { method: "POST", path: "/push/register", policy: "deviceProof" },
    { method: "POST", path: "/v1/push-tokens", policy: "deviceProof" },
    { method: "GET", path: "/v1/push-tokens", policy: "deviceProof" },
    { method: "DELETE", path: "/v1/push-tokens/:token", policy: "deviceProof" },
    { method: "GET", path: "/v2/me/profile", policy: "deviceProof" },
    { method: "GET", path: "/v2/me/settings", policy: "deviceProof" },
    { method: "PUT", path: "/v2/me/settings", policy: "deviceProof" },
    { method: "GET", path: "/v2/me/machine", policy: "deviceProof" },
    { method: "GET", path: "/v1/sessions", policy: "deviceProof" },
    { method: "GET", path: "/v2/sessions/active", policy: "deviceProof" },
    { method: "GET", path: "/v2/sessions", policy: "deviceProof" },
    { method: "POST", path: "/v1/sessions", policy: "deviceProof" },
    { method: "GET", path: "/v1/sessions/:sessionId/messages", policy: "deviceProof" },
    { method: "POST", path: "/v1/sessions/:sessionId/archive", policy: "deviceProof" },
    { method: "DELETE", path: "/v1/sessions/:sessionId", policy: "deviceProof" },
    { method: "GET", path: "/v3/sessions/:sessionId/messages", policy: "deviceProof" },
    { method: "POST", path: "/v3/sessions/:sessionId/messages", policy: "deviceProof" },
];

/** Resolves the named policy for a matched route, or null (default-deny) if not allowlisted. */
export function resolvePublicRoutePolicy(method: string, routePath: string | undefined): PublicRoutePolicy | null {
    if (!routePath) {
        return null;
    }
    const upperMethod = method.toUpperCase();
    const entry = PUBLIC_ROUTE_POLICY_ALLOWLIST.find((candidate) => candidate.method === upperMethod && candidate.path === routePath);
    return entry ? entry.policy : null;
}

export interface PairingGateResult {
    ok: boolean;
    reason?: string;
}

export interface PairingGate {
    /** Validates the operator pairing window, pre-shared QR secret, and single-use nonce. */
    check(headers: Record<string, unknown>): PairingGateResult;
}

/**
 * Builds the `/pair/complete` gate for public mode. This is the ONLY route that
 * can return key material to a not-yet-paired device, so it fails closed unless
 * ALL of the following hold: the operator has opened a pairing window (now within
 * [windowOpenedAt, windowClosesAt]); the caller presents the pre-shared QR secret
 * (constant-time compared); and the caller presents a nonce that has not been used
 * before in this window (single-use → replay protection). Everything else → 401.
 */
export function createPairingGate(config: PublicPairingConfig): PairingGate {
    const now = config.now ?? (() => Date.now());
    const consumedNonces = new Set<string>();
    return {
        check(headers) {
            const nowMs = now();
            if (nowMs < config.windowOpenedAt) {
                return { ok: false, reason: "pairing_window_not_open" };
            }
            if (nowMs > config.windowClosesAt) {
                return { ok: false, reason: "pairing_window_closed" };
            }
            const secret = headerString(headers[PAIRING_SECRET_HEADER]);
            if (!secret || !constantTimeEqual(secret, config.secret)) {
                return { ok: false, reason: "pairing_secret_invalid" };
            }
            const nonce = headerString(headers[PAIRING_NONCE_HEADER]);
            if (!nonce) {
                return { ok: false, reason: "pairing_nonce_required" };
            }
            if (consumedNonces.has(nonce)) {
                return { ok: false, reason: "pairing_nonce_replayed" };
            }
            consumedNonces.add(nonce);
            return { ok: true };
        },
    };
}

export interface PublicAuthRuntime {
    verifier: RemoteDeviceVerifier;
    edge: EdgeAccessConfig;
    config: PublicAuthConfig;
    /** Operator pairing-window + QR-secret + replay gate for `/pair/complete`, if configured. */
    pairingGate?: PairingGate;
    /** Fastify `onRequest` hook that fail-closes every public-mode HTTP route. */
    httpGuard: (request: any, reply: any) => Promise<unknown>;
    /**
     * Fastify `preValidation` hook that enforces the signed body-hash binding. The
     * onRequest `httpGuard` verifies the signature over method+path only (it runs
     * before the body is parsed), so a valid proof would otherwise authorize ANY
     * body. This second hook — run after the raw body has been captured — recomputes
     * the body hash and rejects (401) unless it matches the authenticated envelope's
     * signed `bodyHash`, closing the body-swap gap. Fail-closed: a body-bearing
     * device-proof route whose raw body cannot be captured hashes to the empty-body
     * hash, which will not match a non-empty signed hash, so it is rejected too.
     */
    bodyHashGuard: (request: any, reply: any) => Promise<unknown>;
    /** Socket.IO handshake check (ws + polling); returns ok/reason without throwing. */
    verifySocketHandshake: (headers: Record<string, unknown>) => Promise<RemoteDeviceProofResult>;
    /**
     * TOFU-enrolls a device into the live verifier (see `RemoteDeviceVerifier.enroll`)
     * and awaits the durable-persistence hook on a new pin. Wired into `/pair/complete`
     * so a device paired inside the operator window is pinned into the SAME verifier
     * instance the HTTP guard + socket handshake read — closing the enroll->verify gap.
     */
    enrollDevice: (record: RemoteDeviceRecord) => Promise<DeviceEnrollResult>;
}

/**
 * Assembles the shared public-mode auth runtime. One verifier (one replay cache)
 * backs both the HTTP guard and the socket handshake check so a nonce cannot be
 * replayed across transports.
 */
export function createPublicAuthRuntime(config: PublicAuthConfig): PublicAuthRuntime {
    const verifier = createRemoteDeviceVerifier(config);
    const edge = config.edge;
    const pairingGate = config.pairing ? createPairingGate(config.pairing) : undefined;
    // Built ONCE and closed over so the CF Access JWKS is fetched/cached/rotated
    // across every request (never per-call). Undefined when no assertion is
    // configured — the guards then fall back to the legacy service-token check.
    const assertionVerifier = edge?.assertion ? createEdgeAssertionVerifier(edge.assertion) : undefined;

    async function httpGuard(request: any, reply: any): Promise<unknown> {
        // CORS preflight is handled by @fastify/cors and must not be blocked here.
        if (request.method === "OPTIONS") {
            return;
        }
        // Edge (Cloudflare Access) is mandatory defense-in-depth, checked first.
        if (!(await isEdgeAllowed(edge, request.headers, assertionVerifier))) {
            return reply.code(401).send({ error: "edge_access_denied" });
        }
        const routePath = request.routeOptions?.url as string | undefined;
        const policy = resolvePublicRoutePolicy(request.method, routePath);
        if (policy === null) {
            return reply.code(401).send({ error: "route_not_allowlisted" });
        }
        if (policy === "pairComplete") {
            // The route handler enforces the operator window + QR secret + replay.
            return;
        }
        const urlPath = String(request.url ?? "").split("?")[0];
        const header = headerString(request.headers[PUBLIC_DEVICE_PROOF_HEADER]);
        const result = await verifier.verify({ method: request.method, path: urlPath, header });
        if (!result.ok) {
            return reply.code(401).send({ error: "device_proof_required" });
        }
        // Carry the authenticated envelope so the preValidation bodyHashGuard can
        // enforce the signed body-hash binding once the raw body is available.
        request.publicDeviceEnvelope = result.envelope;
    }

    /**
     * preValidation hook: enforces that the actual request body matches the body
     * the device signed. Only device-proof routes carry `publicDeviceEnvelope`
     * (pairComplete and unauthenticated routes do not reach here with one), so
     * this is a no-op for them. Bodyless requests hash to the empty-body hash and
     * match a bodyless-signed proof; body-bearing requests must match exactly.
     */
    async function bodyHashGuard(request: any, reply: any): Promise<unknown> {
        const envelope = request.publicDeviceEnvelope as PublicSignedRequestEnvelope | undefined;
        if (!envelope) {
            return;
        }
        const rawBody = request.rawBody as Uint8Array | string | undefined;
        const actualBodyHash = hashRequestBody(rawBody ?? null);
        if (actualBodyHash !== envelope.bodyHash) {
            return reply.code(401).send({ error: "body_hash_mismatch" });
        }
    }

    async function verifySocketHandshake(headers: Record<string, unknown>): Promise<RemoteDeviceProofResult> {
        if (!(await isEdgeAllowed(edge, headers, assertionVerifier))) {
            return { ok: false, reason: "edge_access_denied" };
        }
        const header = headerString(headers[PUBLIC_DEVICE_PROOF_HEADER]);
        // Strict single-use, identical to the HTTP guard: the handshake proof's nonce is
        // consumed exactly once. The app MUST connect with `reconnection: false` and a
        // single transport (or mint a fresh per-transport nonce) so a ws->polling fallback
        // does not re-present the consumed nonce — a reused nonce fails closed as
        // `replayed_nonce`. This keeps replay protection strict rather than granting a
        // socket-only exception (US-007 flag; documented for US-009 edge ops).
        return verifier.verify({ method: SOCKET_PROOF_METHOD, path: SOCKET_PROOF_PATH, header });
    }

    /**
     * TOFU-enrolls a device into the live verifier and, on a genuinely NEW pin,
     * awaits the optional durable-persistence hook. Returns the enrollment outcome
     * so the caller (`/pair/complete`) can map it to an HTTP status. The persistence
     * hook is best-effort: if it throws, the device stays pinned in-memory (the
     * verifier is authoritative for the current process) and the error propagates so
     * the route can decide how to surface it.
     */
    async function enrollDevice(record: RemoteDeviceRecord): Promise<DeviceEnrollResult> {
        const result = verifier.enroll(record);
        if (result.ok && result.enrolled && config.onDeviceEnrolled) {
            await config.onDeviceEnrolled(
                { keyId: record.keyId, publicKey: record.publicKey },
                verifier.listDevices(),
            );
        }
        return result;
    }

    return { verifier, edge, config, pairingGate, httpGuard, bodyHashGuard, verifySocketHandshake, enrollDevice };
}

/** Result of the relocated public-mode Socket.IO handshake check. */
export interface SocketHandshakeAuthResult {
    ok: boolean;
    /**
     * Present only when `ok` is false: the rejection reason surfaced by the thin
     * dispatcher's websocket log line (`Public socket handshake rejected: <reason>`).
     * Mirrors the two original inline messages: `"no verifier configured"` for a
     * missing runtime, otherwise the underlying `RemoteDeviceProofResult.reason`.
     */
    reason?: string;
}

// FORK PATCH: [RESTORE-R1b-done] socket public device-proof handshake branch relocated from socket.ts `createSocketAuthMiddleware` (invariant HS-3)
/**
 * Fail-closed Socket.IO handshake check for public mode (`auth === 'public'`).
 *
 * Behavior-preserving relocation of the inline public branch that previously lived
 * in `socket.ts` `createSocketAuthMiddleware`. The handshake is an HTTP request for
 * BOTH the websocket (upgrade) and polling transports, so this single check — run
 * once per connection against `socket.handshake.headers` — is the enforcement point
 * for both. It fails closed (returns `{ ok: false }`) when no verifier is configured
 * or when the mandatory Cloudflare Access edge check + Ed25519 device proof fail,
 * closing the previously fail-open tunnel branch for public exposure. The strict
 * single-use nonce lives in the shared `PublicAuthRuntime.verifySocketHandshake`
 * verifier (a nonce is consumed exactly once across HTTP + socket transports).
 *
 * The log side-effect stays in the thin dispatcher (which already owns `@/utils/log`)
 * so this module remains free of import-time side effects; the returned `reason`
 * reproduces the original log text byte-for-byte.
 */
export async function verifyPublicSocketHandshake(
    runtime: PublicAuthRuntime | undefined,
    headers: Record<string, unknown>,
): Promise<SocketHandshakeAuthResult> {
    if (!runtime) {
        return { ok: false, reason: "no verifier configured" };
    }
    const result = await runtime.verifySocketHandshake(headers);
    if (!result.ok) {
        return { ok: false, reason: result.reason };
    }
    return { ok: true };
}
