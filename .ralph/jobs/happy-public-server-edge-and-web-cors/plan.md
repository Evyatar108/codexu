# Plan — Public-mode CF edge-check (verify `Cf-Access-Jwt-Assertion`) + web CORS gaps (Tasks A + B)

**Tasks:** `happy-public-server-edge-check-cf-jwt-assertion` (A, the linchpin) + `happy-public-server-web-cors-gaps` (B).
**Mode:** planning deliverable — read-only research performed against the worktree; NO code edited, NO build/test run.
**Worktree:** `D:/harness-efforts/codexu/.worktrees/plan-happy-edge-cors` on `ralph/plan-happy-edge-cors` (off `main` @ `8f063076`).
**Package(s):** `packages/happy-server` (primary), `packages/happy-cli` (config threading), docs. **No `packages/happy-wire` change required** (see §7 Decision D-6).
**Bundled because** both tasks touch `packages/happy-server` + `docs/security-model.md`; A and B are otherwise independent and can ship in either order (B first is a smaller quick-win — see §9 ship order).

---

## 1. Goal & framing

The single-user **public** happy-server (`options.auth === "public"`, opt-in, default-off, exposed at `https://happy.evyatar.dev` via an outbound Cloudflare named tunnel + Cloudflare Access service token) was driven end-to-end through a real browser for the first time on 2026-07-05. Two live findings — both **ground-truth verified by probes** — must become durable code:

- **Task A (linchpin).** **Cloudflare Access strips BOTH `CF-Access-Client-Id` AND `CF-Access-Client-Secret` before forwarding to the origin; only the signed `Cf-Access-Jwt-Assertion` header is forwarded.** Proven: direct-to-origin (`127.0.0.1:<tunnelPort>`) WITH both headers → `device_proof_required` (passes `checkEdgeAccess`); the SAME headers through `happy.evyatar.dev` → `edge_access_denied`. So the shipped app-layer `checkEdgeAccess` — which re-validates the client-id/secret (`remoteDeviceAuth.ts:157-169`) — can **NEVER pass via the real CF edge for ANY client** (browser or native). The durable fix replaces that stripped-secret re-check with **cryptographic verification of the CF-injected `Cf-Access-Jwt-Assertion` JWT** (Option A, operator-chosen). CF was confirmed to inject that header for this service-token app (a temporary "accept when present" unblock made the through-CF path return `device_proof_required`).

- **Task B.** The `@fastify/cors` `allowedHeaders` list in `api.ts` + `socket.ts` is **missing the two pairing headers** `x-happy-pairing-secret` and `x-happy-pairing-nonce` that the app sends on `POST /pair/complete`. Today the preflight only works because the Cloudflare Access application's `cors_headers` answers it; the origin cannot answer a `/pair/complete` preflight itself. Add the two headers.

**Everything in this plan preserves the fail-closed public-mode guarantees.** The Ed25519 device proof stays the **PRIMARY** app-layer boundary (unchanged); the assertion check is edge defense-in-depth that replaces a currently-non-functional re-check. Task A must be **fail-closed by construction**: a missing / malformed / expired / wrong-`aud` / wrong-`iss` assertion, an unknown signing key, or a JWKS that cannot be fetched all → reject.

> **Note on the uncommitted local debug unblock.** Finding #3 (2026-07-05) is an uncommitted throwaway hack in `checkEdgeAccess` that accepts when `cf-access-jwt-assertion` is merely PRESENT (no signature verification). This worktree is off `main` @ `8f063076`, which does **NOT** contain that hack — so this plan is written against the clean shipped `checkEdgeAccess` (§3.1). The impl runs against clean main too; there is nothing to "remove" in the tracked tree. The impl MUST NOT reproduce a present-only acceptance — the durable check verifies the signature.

### HARD CONSTRAINT — do NOT regress the shipped single-user public server

Every change to the auth plane MUST keep the fail-closed public-mode guarantees intact. The impl MUST re-run these existing specs as acceptance gates (they must stay green), and Task A adds NEW assertion tests (§6):

| Gate | Spec file (worktree-relative) | What it proves |
|---|---|---|
| **US-005 route inventory (THE GATE)** | `packages/happy-server/sources/app/api/publicAuthGate.spec.ts` | Derives the route inventory from the **live Fastify app** (`onRoute`) and asserts EVERY registered route rejects an unauthenticated request with `401` and leaks no key material; a positive control (valid edge + device proof) proves the 401s are meaningful. |
| **US-005a body-hash + device proof** | `packages/happy-server/sources/app/api/auth/remoteDeviceAuth.spec.ts` | Ed25519 signed-request verify + `preValidation` body-hash guard recomputes raw-body SHA-256, rejects (`401`) on mismatch / uncaptured body; also directly exercises `checkEdgeAccess`. |
| **Device enrollment / TOFU** | `packages/happy-server/sources/app/api/deviceEnrollment.spec.ts` | `/pair/complete` window + secret + single-use nonce; TOFU-pins Ed25519 device key; conflicting key for a pinned id → `409`. |
| **Socket handshake fail-closed** | `packages/happy-server/sources/app/api/socket.spec.ts` | Public device-proof required on both websocket + polling; old fail-open tunnel branch stays closed; strict single-use nonce; edge check gates the handshake. |
| **Operator-identity bind gate** | `packages/happy-server/sources/index.spec.ts` + `packages/happy-server/sources/dualListenerBinding.test.ts` | Public bind to a non-loopback host is refused without a verifier + edge expectation; tunnel bind to a public host is refused. |
| **CORS allowlist** | `packages/happy-server/sources/app/api/auth/corsAllowed.test.ts` | Browser preflight lists the allowed methods + headers. |
| **Fork auth-plane seam** | `packages/happy-server/sources/app/api/auth/forkAuthPlane.spec.ts` | Public-mode hook install order (default-deny) preserved. |
| **CLI public-tunnel config** | `packages/happy-cli/src/tunnel/publicTunnelConfig.test.ts` | `readPublicTunnelConfig` / `assertPublicBindReady` / `buildPublicMode` config shape. |

---

## 2. Auth-plane topology (post-M1 seam refactors — verified current)

The public-mode auth plane recently moved into fork-owned seams (M1 R1a/R1b/R3, shipped `76bf14bf`). Verified current shape:

- `packages/happy-server/sources/app/api/api.ts` — `configureApi()` registers `@fastify/cors` (**Task B site #1**, `api.ts:62-66`) then calls `installForkAuthPlane(fastifyApp, typed, tofuConfig, options)` (`api.ts:87`).
- `packages/happy-server/sources/app/api/auth/forkAuthPlane.ts` — `installForkAuthPlane(...)` builds the runtime via `createPublicAuthRuntime(options.publicAuth)` and installs the buffer content-parser + `onRequest httpGuard` + `preValidation bodyHashGuard` (public mode only). Threads `publicAuthRuntime` back to `startSocket` + `pairRoutes`.
- `packages/happy-server/sources/app/api/socket.ts` — `startSocket()` builds the Socket.IO server with its own CORS block (**Task B site #2**, `socket.ts:118-122`); the public handshake dispatches to `verifyPublicSocketHandshake(...)` → `runtime.verifySocketHandshake(...)`.
- `packages/happy-server/sources/app/api/auth/remoteDeviceAuth.ts` — owns `EdgeAccessConfig`, `checkEdgeAccess` (**Task A site**), `createPublicAuthRuntime`, `httpGuard`, `verifySocketHandshake`, `PUBLIC_ROUTE_POLICY_ALLOWLIST`. **Both edge-check call sites are here** (`:438` httpGuard, `:481` verifySocketHandshake).
- `packages/happy-server/sources/fork/operatorIdentityGate.ts` — `assertOperatorIdentityGate(...)` gates a public non-loopback bind on `publicAuth.devices.length > 0` AND `publicAuth.edge.serviceTokens.length > 0` (**Task A §5.A3 site**).
- `packages/happy-cli/src/tunnel/publicTunnelConfig.ts` — `PublicTunnelConfigSchema`, `readPublicTunnelConfig`, `assertPublicBindReady`, `buildPublicMode(...)` (**Task A §5.A4 site**). Wired from `packages/happy-cli/src/fork/forkHooks.ts:151-179` (NOT `daemon/run.ts` — the M1 refactor relocated it into `forkHooks.ts`).
- `packages/happy-cli/src/types/happy-server.d.ts` — the ambient `declare module 'happy-server'` type mirror the CLI compiles against (must mirror any `EdgeAccessConfig` / `PublicAuthConfig` shape change — **Task A §5.A4**).

---

## 3. Verified research (current fork state, file:symbol)

### 3.1 The shipped `checkEdgeAccess` (Task A replaces this — verified `remoteDeviceAuth.ts:157-169`)

```ts
export function checkEdgeAccess(config: EdgeAccessConfig | undefined, headers: Record<string, unknown>): boolean {
    if (!config || config.serviceTokens.length === 0) {
        return true;                                  // escape hatch: test / non-public paths
    }
    const clientId = headerString(headers[CF_ACCESS_CLIENT_ID_HEADER]);
    const clientSecret = headerString(headers[CF_ACCESS_CLIENT_SECRET_HEADER]);
    if (!clientId || !clientSecret) return false;     // FAILS via real CF (headers stripped)
    return config.serviceTokens.some((t) =>
        constantTimeEqual(t.clientId, clientId) && constantTimeEqual(t.clientSecret, clientSecret));
}
```

- `EdgeAccessConfig = { serviceTokens: EdgeAccessServiceToken[] }` (`remoteDeviceAuth.ts:42-44`). `EdgeAccessServiceToken = { clientId, clientSecret }` (`:37-40`).
- Header consts `CF_ACCESS_CLIENT_ID_HEADER = "cf-access-client-id"`, `CF_ACCESS_CLIENT_SECRET_HEADER = "cf-access-client-secret"` (`:118-119`).
- **Call sites (both already `async`, both currently call the sync fn):**
  - `httpGuard` (`:438`): `if (!checkEdgeAccess(edge, request.headers)) return reply.code(401).send({ error: "edge_access_denied" });`
  - `verifySocketHandshake` (`:481`): `if (!checkEdgeAccess(edge, headers)) return { ok: false, reason: "edge_access_denied" };`
- **Direct spec use:** `remoteDeviceAuth.spec.ts` asserts `checkEdgeAccess({...}, {...})` synchronously (~4 asserts).
- **`serviceTokens` is still load-bearing and must stay:** it configures CF Access, seeds the pairing invite (so the app can present client-id/secret to the CF **edge** — `buildPublicMode` → `createPublicPairingInvite.cloudflareAccess`), and gates `assertOperatorIdentityGate` / `assertPublicBindReady`. Task A does **not** remove it — it **adds** an `assertion` config that the origin actually verifies.

### 3.2 Config threading (Task A §5.A4 — verified `publicTunnelConfig.ts`)

- `PublicTunnelConfigSchema.cloudflareAccess = z.object({ serviceTokens: z.array(...).min(1) })` (`publicTunnelConfig.ts:27-33`). **No team-domain / AUD field today.**
- `buildPublicMode(input)` (`:135-190`) maps `config.cloudflareAccess.serviceTokens` → `publicAuth.edge.serviceTokens` (`:169-174`) and uses `serviceTokens[0]` to seed the invite (`:158`, `:150-157`).
- `assertPublicBindReady(config)` (`:96-114`) throws unless `serviceTokens.length >= 1`.
- Wired at `forkHooks.ts:152-179`: `readPublicTunnelConfig()` → `assertPublicBindReady()` → `buildPublicMode({ config, serverUrl, machineId, devices, onDeviceEnrolled })` → `writePublicPairingInvite(...)`; `publicMode.publicAuth` flows to `createHappyServer` via `{ publicListener: { auth: 'public', publicAuth } }` (`forkHooks.ts:243`).

### 3.3 Existing JWT/crypto libs (Task A library decision — verified `packages/happy-server/package.json`)

- **Already present:** `jsonwebtoken@^9.0.2` + `@types/jsonwebtoken@^9.0.10`, `@noble/ed25519@^3.0.0`, `@noble/hashes@^2.0.1`, `privacy-kit@^0.0.25`, `zod`, `fastify`, `axios`.
- **NOT present:** `jose`, `jwks-rsa`. `jsonwebtoken` alone cannot fetch/cache/rotate JWKS.
- `packages/happy-server` is `"type": "module"`, Node 20, Vitest 3.
- **Recommendation: add `jose`** (see §7 D-1).

### 3.4 CORS allowlists (Task B — verified)

- `api.ts:64`: `allowedHeaders: ['X-Tunnel-Authorization', 'X-Loopback-Capability', 'X-Happy-Client', 'Content-Type', 'X-Happy-Device-Proof', 'CF-Access-Client-Id', 'CF-Access-Client-Secret']` — **missing** `x-happy-pairing-secret`, `x-happy-pairing-nonce`.
- `socket.ts:121`: same list, same gap.
- Pairing header consts already exist: `PAIRING_SECRET_HEADER = "x-happy-pairing-secret"`, `PAIRING_NONCE_HEADER = "x-happy-pairing-nonce"` (`remoteDeviceAuth.ts:122,124`).
- `parseCorsOrigins()` (`app/api/utils/parseCorsOrigins.ts`) reads `HAPPY_CORS_ORIGINS` (comma-separated, wildcards rejected). Origins empty → `origin: false`.
- `corsAllowed.test.ts` sets `HAPPY_CORS_ORIGINS`, calls `configureApi(app)`, and injects an `OPTIONS` preflight asserting `access-control-allow-methods` / `-headers`. **This is the extend site for Task B.**

### 3.5 The Cloudflare Access assertion facts (Task A — operator-supplied + CF docs)

- Team domain (issuer host): **`evyatar-codexu.cloudflareaccess.com`**. Issuer claim `iss` = `https://evyatar-codexu.cloudflareaccess.com` (https scheme, no trailing slash).
- JWKS: `https://evyatar-codexu.cloudflareaccess.com/cdn-cgi/access/certs` (RSA public keys; tokens are **RS256**).
- App **AUD**: **`3978a5b707e4bfa1d94adfef748c8b7549db394cc7d6866e75adc1aaf1ebe88e`**. The `aud` claim is an **array**; verification asserts it **contains** the app AUD.
- Injected header (origin-side, lowercased by Fastify): **`cf-access-jwt-assertion`**. **The browser never sends this** — CF injects it between the edge and the origin — so it is **NOT** added to CORS `allowedHeaders` (Task B). Note this explicitly in code + docs.
- Service-token identity: for a `non_identity` service-token app, the token's `common_name` claim carries the service-token **Client ID** (and `sub` is empty). Optional hardening: assert `common_name` ∈ an operator-configured allowlist (see §7 D-4).

### 3.6 Docs to correct (they describe the impossible re-check)

- `docs/security-model.md:70` (Mandatory edge section): *"The server independently re-checks the service-token headers (`checkEdgeAccess`, constant-time compare)…"* — **factually wrong** via real CF. Rewrite to the assertion model.
- `packages/happy-server/AGENTS.md` → "Public-mode auth plane" → Cloudflare Access edge bullet: *"`checkEdgeAccess` re-validates `CF-Access-Client-Id` / `CF-Access-Client-Secret` (constant-time)…"* — rewrite.
- `docs/api.md:26` and `docs/cli-architecture.md:217` — both say the service-token headers are "re-checked server-side"; correct to the assertion model.
- `docs/fork-notes.md` "Single-user public mode" → `public-tunnel.json` shape block (`fork-notes.md:305-322`) — add `teamDomain` + `appAud` fields.

---

## 4. Design — Task A (verify `Cf-Access-Jwt-Assertion`)

### 4.1 New module `packages/happy-server/sources/app/api/auth/edgeAssertion.ts`

Co-located with `remoteDeviceAuth.ts` (the `auth/` overlay dir). Exports:

```ts
export const CF_ACCESS_JWT_ASSERTION_HEADER = "cf-access-jwt-assertion";

export interface EdgeAssertionConfig {
    /** Cloudflare Zero-Trust team domain, e.g. "evyatar-codexu.cloudflareaccess.com" (no scheme). */
    teamDomain: string;
    /** Access application AUD tag; the JWT `aud` array must contain this. */
    appAud: string;
    /** Optional JWKS URL override; default derived from teamDomain. */
    jwksUrl?: string;
    /** Optional service-token identity allowlist (`common_name`/`sub`); when set, the
     *  assertion's identity claim must match one entry. Omitted → identity not checked. */
    expectedIdentities?: string[];
    /** TEST-ONLY: injectable key resolver (jose JWKSet fn). Prod builds a remote set. */
    jwks?: JWTVerifyGetKey;   // jose type
    /** TEST-ONLY: injectable clock (ms). Prod uses Date.now via jose default. */
    now?: () => number;
}

export function deriveJwksUrl(teamDomain: string): string;               // `https://<teamDomain>/cdn-cgi/access/certs`
export function createEdgeAssertionVerifier(config: EdgeAssertionConfig): (headers: Record<string, unknown>) => Promise<EdgeAssertionResult>;
export interface EdgeAssertionResult { ok: boolean; reason?: string; identity?: string; }
```

- Production: `const JWKS = config.jwks ?? createRemoteJWKSet(new URL(config.jwksUrl ?? deriveJwksUrl(config.teamDomain)))`. `createRemoteJWKSet` caches keys in-memory and re-fetches on an unknown `kid` (with an internal cooldown) — this is the "cache the keys, they rotate" requirement, for free.
- Verify with `jwtVerify(token, JWKS, { issuer: 'https://' + teamDomain, audience: config.appAud, algorithms: ['RS256'], clockTolerance: '5s', currentDate: config.now ? new Date(config.now()) : undefined })`. `jwtVerify` checks signature + `iss` + `aud` (membership) + `exp`/`nbf` in one call and **throws on any failure** → trivially fail-closed.
- Fail-closed mapping (return `{ ok: false, reason }`, never throw out): missing header → `assertion_missing`; malformed/none-alg/sig-fail → `assertion_invalid`; expired/nbf → `assertion_expired`; wrong aud → `assertion_aud_mismatch`; wrong iss → `assertion_iss_mismatch`; unknown kid / JWKS fetch failure → `assertion_key_unavailable`; identity not in allowlist → `assertion_identity_denied`. (Reasons are for logs/tests; the HTTP surface stays the existing `edge_access_denied` 401 so no key material leaks — behavior-preserving at the wire.)
- **Side-effect-free import** (per happy-server AGENTS.md rule #7): the remote JWKS set is constructed lazily inside `createEdgeAssertionVerifier` (called from `createPublicAuthRuntime`), never at module top-level.

### 4.2 Wire into `EdgeAccessConfig` + the two call sites (`remoteDeviceAuth.ts`)

- Extend `EdgeAccessConfig`: `{ serviceTokens: EdgeAccessServiceToken[]; assertion?: EdgeAssertionConfig }`. (`assertion` optional so all existing `edge: { serviceTokens: [...] }` specs still typecheck.)
- Keep the sync `checkEdgeAccess` **unchanged** (legacy service-token path — still used by non-public/test paths and as the fail-closed fallback when no assertion is configured). Add a single async wrapper used by both guards:

```ts
export async function isEdgeAllowed(edge: EdgeAccessConfig | undefined, headers: Record<string, unknown>): Promise<boolean> {
    if (edge?.assertion) return (await assertionVerifier(headers)).ok;   // assertion is the durable path
    return checkEdgeAccess(edge, headers);                               // legacy fallback (fail-closed via real CF)
}
```

  Build `assertionVerifier` once inside `createPublicAuthRuntime` (`createEdgeAssertionVerifier(edge.assertion)`) and close over it, so the remote JWKS set + its cache live for the process, not per request.
- Both guards change to `if (!(await isEdgeAllowed(edge, request.headers))) …` — **both are already `async`**, so this is a one-token change each; the 401 response bodies (`edge_access_denied`) are unchanged.
- **Why keep the sync legacy path:** it is additive + behavior-preserving for the ~4 direct `checkEdgeAccess` asserts in `remoteDeviceAuth.spec.ts` (no signature break), and in production, if `assertion` were ever absent while `serviceTokens` non-empty, the legacy path checks stripped headers → returns `false` → **fail-closed** (denies every request). The operator gate (§5.A3) makes that misconfig fail fast at startup instead.

### 4.3 Config location — where team-domain + AUD come from (NOT hardcoded)

Threaded end to end: `public-tunnel.json` → `PublicTunnelConfigSchema` → `buildPublicMode` → `PublicAuthConfig.edge.assertion` → `createPublicAuthRuntime`.

- `public-tunnel.json` gains under `cloudflareAccess`: `teamDomain` (e.g. `evyatar-codexu.cloudflareaccess.com`), `appAud` (the AUD hex), optional `jwksUrl`, optional `expectedServiceTokenNames` (→ `expectedIdentities`).
- `buildPublicMode` maps them into `publicAuth.edge.assertion = { teamDomain, appAud, jwksUrl?, expectedIdentities? }`.
- `EdgeAccessConfig.assertion` carries them to the server verifier.

---

## 5. Milestone stories

Each story is small, independently testable, and mapped to Task A or B. Complexity S/M. Dependencies + ACs inline; ship order in §9. The full per-story AC list lives in `stories-outline.md`.

### B1 — CORS pairing headers (Task B; independent; do first as a quick-win) · S
- **Edit:** add `'x-happy-pairing-secret'`, `'x-happy-pairing-nonce'` to `allowedHeaders` in `api.ts:64` AND `socket.ts:121`. (Keep existing entries incl. CF-Access-Client-Id/Secret — still sent by clients to CF.)
- **Test:** extend `corsAllowed.test.ts` with a `/pair/complete` `OPTIONS` preflight (`Access-Control-Request-Headers: x-happy-pairing-secret, x-happy-pairing-nonce`) asserting `204` + both echoed in `access-control-allow-headers`; keep the existing `X-Loopback-Capability` case.
- **AC:** `pnpm --filter happy-server exec vitest run sources/app/api/auth/corsAllowed.test.ts` green; both pairing headers present in both allowlists; `X-Happy-Device-Proof` + CF-Access headers still present. **`Cf-Access-Jwt-Assertion` is NOT added** (CF-injected, not browser-sent). **Deps:** none.

### A1 — `edgeAssertion.ts` verifier + `jose` dependency + unit spec (Task A) · M
- **Add** `jose` to `packages/happy-server/package.json` dependencies (latest stable v5). **Add** `edgeAssertion.ts` per §4.1.
- **New spec** `packages/happy-server/sources/app/api/auth/edgeAssertion.spec.ts`: generate a local RSA keypair (`jose.generateKeyPair('RS256')`), expose it as a local JWKS (`createLocalJWKSet` or a `jwks` resolver), and mint assertions with `new SignJWT(...).setProtectedHeader({ alg:'RS256', kid }).setIssuer(...).setAudience(appAud).setExpirationTime(...).sign(privateKey)`. Cases: valid → `{ ok:true }`; missing header → `assertion_missing`; garbage/none-alg → `assertion_invalid`; expired / future-nbf (via injected `now`) → `assertion_expired`; wrong `aud` → `assertion_aud_mismatch`; wrong `iss` → `assertion_iss_mismatch`; unknown-kid / JWKS-resolver-throws → `assertion_key_unavailable` (**fail-closed**); with `expectedIdentities` set, matching `common_name` → ok, non-matching → `assertion_identity_denied`.
- **AC:** all cases green; verifier NEVER returns `{ ok:true }` on any negative; module import has no side effects (no network at import). **Deps:** none (foundation).

### A2 — thread `assertion` into `EdgeAccessConfig` + switch both guards to `isEdgeAllowed` (Task A) · M
- **Edit** `remoteDeviceAuth.ts`: extend `EdgeAccessConfig` with `assertion?`; add `isEdgeAllowed`; build the verifier once in `createPublicAuthRuntime`; change `httpGuard:438` + `verifySocketHandshake:481` to `await isEdgeAllowed(...)`. Keep sync `checkEdgeAccess` intact.
- **Test** `remoteDeviceAuth.spec.ts`: keep the existing sync `checkEdgeAccess` asserts (unchanged); add runtime-level cases via `createPublicAuthRuntime({ …, edge:{ serviceTokens:[…], assertion:{…injected JWKS…} } })` — a valid assertion header passes the edge, an absent/invalid one → `edge_access_denied`. Add an `isEdgeAllowed` unit case for both branches.
- **AC:** `remoteDeviceAuth.spec.ts` green; a runtime with `assertion` configured accepts ONLY a valid `Cf-Access-Jwt-Assertion` and rejects the old client-id/secret-only request; `edge_access_denied` 401 body unchanged. **Deps:** A1.

### A3 — require `assertion` at the operator bind gate (Task A) · S
- **Edit** `fork/operatorIdentityGate.ts`: for a public **non-loopback** bind, additionally require `config.publicAuth.edge.assertion?.teamDomain` + `.appAud` present (alongside the existing devices + serviceTokens checks). Extend the refusal message to name the missing assertion config.
- **Test** `index.spec.ts` (+ `dualListenerBinding.test.ts` if it constructs `publicAuth`): update the existing "permits a public bind … with verifier + edge expectation" case to include `assertion`; add a new "refuses a public bind on a non-loopback host with serviceTokens but no assertion config" case. Loopback public binds still exempt.
- **AC:** `index.spec.ts` + `dualListenerBinding.test.ts` green; a public non-loopback bind without `assertion` throws at startup; loopback unaffected. **Deps:** A2.

### A4 — happy-cli config threading + type mirror (Task A) · M
- **Edit** `publicTunnelConfig.ts`: extend `PublicTunnelConfigSchema.cloudflareAccess` with `teamDomain: z.string().min(1)`, `appAud: z.string().min(1)`, `jwksUrl: z.string().url().optional()`, `expectedServiceTokenNames: z.array(z.string()).optional()`; map them in `buildPublicMode` into `publicAuth.edge.assertion`; extend `assertPublicBindReady` to require `teamDomain` + `appAud` (fail-closed message).
- **Edit** `packages/happy-cli/src/types/happy-server.d.ts`: mirror `EdgeAssertionConfig` + `EdgeAccessConfig.assertion?` so the CLI typechecks against the new server shape.
- **Test** `publicTunnelConfig.test.ts`: update `VALID_CONFIG` to include `teamDomain` + `appAud`; add a case that `buildPublicMode` populates `publicAuth.edge.assertion`; add a `assertPublicBindReady` case that a config missing `teamDomain`/`appAud` throws.
- **AC:** `pnpm --filter happy exec vitest run src/tunnel/publicTunnelConfig.test.ts src/fork/forkHooks.test.ts` green; `buildPublicMode` output carries `edge.assertion`; CLI typecheck passes. **Deps:** A2 (server type shape).

### A5 — update full-gate positive-control specs to the real (assertion) deployment (Task A) · M
- **Shared test helper** (e.g. `packages/happy-server/sources/app/api/auth/testEdgeAssertion.ts` under a test-only export, or an inline helper in each spec): mints a valid `Cf-Access-Jwt-Assertion` from a local keypair + returns the matching `assertion` config with an injected local JWKS. Reused across specs.
- **Edit** `publicAuthGate.spec.ts`, `deviceEnrollment.spec.ts`, `socket.spec.ts`: build `publicAuth.edge` with BOTH `serviceTokens` (unchanged, for config validity) AND `assertion` (injected JWKS); replace the `edgeHeaders()` client-id/secret positive path with a `cf-access-jwt-assertion` header carrying a valid minted assertion. Add a negative through-gate case: a request with serviceTokens+assertion configured but NO/invalid assertion header → `401` (route inventory still 401s; positive control still 401s without a device proof; with valid assertion + device proof → passes).
- **AC:** all four (`publicAuthGate`, `deviceEnrollment`, `socket`, and the US-005 route inventory within `publicAuthGate`) green under the assertion model; the positive control passes ONLY with a valid assertion + device proof. **Deps:** A2 (+ A1 helper).

### A6 — docs correction (Task A) · S
- **Edit** `docs/security-model.md:70` (Mandatory edge) — replace the "re-checks the service-token headers (`checkEdgeAccess`, constant-time compare)" sentence with: CF strips `CF-Access-Client-Id`/`CF-Access-Client-Secret` before forwarding; only the signed `Cf-Access-Jwt-Assertion` reaches the origin; the server verifies that JWT's signature against the team JWKS + checks `aud`/`iss`/`exp`/`nbf` fail-closed (JWKS-fetch-failure → reject). Keep the "primary boundary is the Ed25519 verifier" framing.
- **Edit** `packages/happy-server/AGENTS.md` "Public-mode auth plane" → Cloudflare Access edge bullet — same correction.
- **Edit** `docs/api.md:26` + `docs/cli-architecture.md:217` — correct "re-checked server-side" to the assertion model.
- **Edit** `docs/fork-notes.md` `public-tunnel.json` shape block — add `teamDomain` + `appAud` (+ optional `jwksUrl`) with placeholder values.
- **AC:** no doc still claims the origin re-validates the client-id/secret; `public-tunnel.json` shape shows the new fields. **Deps:** A1–A5 landed.

### B2 — docs: browser bring-up + CORS (Task B) · S
- **Edit** `docs/security-model.md` (Socket.IO handshake / a new "Browser (CORS) bring-up" note) + `docs/fork-notes.md`: document that browsers additionally require (1) `HAPPY_CORS_ORIGINS=<app-origin>` on the origin (so it emits `Access-Control-Allow-Origin`), and (2) the Cloudflare Access application's `cors_headers` (`allow_all_headers` + `allowed_origins`) so CF answers the preflight; note the origin now also answers the `/pair/complete` preflight (pairing headers added in B1); note **native clients are immune to CORS**.
- **AC:** both docs describe the two-part browser CORS setup + the native-immune note. **Deps:** B1.

---

## 6. New tests added (summary)

- `edgeAssertion.spec.ts` (A1) — valid accept; missing / invalid / expired / nbf-future / wrong-aud / wrong-iss reject; unknown-kid + JWKS-fetch-failure **fail-close**; optional identity allowlist.
- `remoteDeviceAuth.spec.ts` (A2) — new runtime-level assertion accept/reject + `isEdgeAllowed` branch cases (existing sync `checkEdgeAccess` asserts retained).
- `index.spec.ts` (A3) — new "refuses public non-loopback bind without assertion config".
- `publicTunnelConfig.test.ts` (A4) — `buildPublicMode` emits `edge.assertion`; `assertPublicBindReady` requires teamDomain+appAud.
- `publicAuthGate.spec.ts` / `deviceEnrollment.spec.ts` / `socket.spec.ts` (A5) — positive control migrated to a valid `Cf-Access-Jwt-Assertion`; negative "no/invalid assertion → 401".
- `corsAllowed.test.ts` (B1) — `/pair/complete` preflight echoes both pairing headers.

---

## 7. Key decisions & recommendations

- **D-1 (library) — RECOMMEND `jose`.** happy-server already ships `jsonwebtoken`, but it cannot fetch/cache/rotate JWKS on its own (would need net-new `jwks-rsa` anyway). `jose` is a single, well-audited, **zero-dependency, ESM-native** library (matches happy-server's `"type":"module"` + Node 20). `createRemoteJWKSet(url)` gives JWKS fetch + in-memory cache + automatic rotation-on-unknown-kid with a cooldown (the exact "cache keys, they rotate, fail-closed on fetch failure" requirement); `jwtVerify(token, JWKS, { issuer, audience, algorithms:['RS256'], clockTolerance })` does signature + `iss` + `aud`-membership + `exp`/`nbf` in one throwing (⇒ fail-closed) call; and it ships `generateKeyPair` + `SignJWT` + `createLocalJWKSet` so the negative-case tests mint valid/expired/wrong-aud assertions locally with **zero network**. **Documented fallback:** `jwks-rsa` + the already-present `jsonwebtoken` (more manual wiring: `getSigningKey` callback → `jwt.verify` with `{ audience, issuer, algorithms:['RS256'] }`; still one net-new lib, weaker test ergonomics). Net-new deps are equal (1), so `jose` wins on capability + fail-closed ergonomics.
- **D-2 (config location) — the team domain + AUD live in `public-tunnel.json` → `PublicAuthConfig.edge.assertion`, never hardcoded.** Threaded through `PublicTunnelConfigSchema` → `buildPublicMode` → `EdgeAccessConfig.assertion` (§4.3). This keeps the machine-specific `evyatar-codexu.cloudflareaccess.com` / AUD out of source, mirrors how `serviceTokens` already flow, and keeps the CLI type mirror in `happy-server.d.ts` in lockstep.
- **D-3 (additive, keep `checkEdgeAccess` sync) — RECOMMENDED.** Add async `isEdgeAllowed` wrapper + keep the sync legacy path, rather than making `checkEdgeAccess` itself async. Zero churn to existing sync asserts; the assertion path is the durable one; the legacy path is fail-closed in production. (Alternative — hard-cutover to a single async `checkEdgeAccess` — was rejected: higher churn + rewrites every positive-control edge header for no fail-closed benefit.)
- **D-4 (service-token identity check) — OPTIONAL, default-off.** Support `expectedIdentities` (matched against `common_name`/`sub`) but leave it unset by default so a single-service-token deployment is not over-constrained. Recommend the operator populate it once multiple tokens exist.
- **D-5 (require assertion at the bind gate) — RECOMMENDED.** `assertOperatorIdentityGate` + `assertPublicBindReady` require `teamDomain`+`appAud` for a public non-loopback bind, so a missing/typo'd assertion config **fails fast at startup** rather than silently denying every request (legacy fallback returns false via real CF). This is the fail-fast safety posture.
- **D-6 (no happy-wire change) — CONFIRMED.** The `PublicPairingInvite` (`packages/happy-wire/src/publicPairingInvite.ts`) carries `cloudflareAccess: { clientId, clientSecret }` so the **app** can authenticate to the CF **edge** (present client-id/secret to CF; CF injects the assertion). The app never needs `teamDomain`/`appAud` (only the origin verifies the assertion). So the invite + happy-wire schema are **unchanged** — keeps scope tighter and avoids a cross-package version bump.
- **D-7 (Cf-Access-Jwt-Assertion NOT in CORS).** CF injects it origin-side; the browser never sends it, so it stays out of `allowedHeaders` (Task B). Code comment + docs must say so to prevent a future "add the missing header" mistake.

---

## 8. Risks & open questions

- **R-1 (biggest) — test-surface migration in A5.** `publicAuthGate` / `deviceEnrollment` / `socket` specs currently pass the edge via injected `CF-Access-Client-Id/Secret`. Under the assertion model their positive controls must mint a valid `Cf-Access-Jwt-Assertion` + inject a local JWKS. Mitigation: one shared test helper (A5) + injectable `jwks`/`now` on `EdgeAssertionConfig`; land A1 (helper) before A5. Risk if underestimated: the impl "fixes" a red spec by weakening the gate. The US-005 route inventory is the backstop — it must stay green.
- **R-2 — clock skew / freshness.** CF assertions are short-lived; use `clockTolerance` (~5s) in `jwtVerify` and an injectable `now` for deterministic expired/nbf tests. Do NOT widen tolerance to "fix" a flaky test.
- **R-3 — JWKS fetch at runtime.** `createRemoteJWKSet` fetches lazily on first verify; a cold origin's first request incurs a network round-trip. Acceptable (single-user, low RPS). Fail-closed on fetch failure is REQUIRED (reject, do not fall through). Keep the remote set process-lived (built once in `createPublicAuthRuntime`).
- **R-4 — `jose` ESM/CJS + pkgroll build.** happy-server builds via `pkgroll` (dual cjs/mjs). `jose` supports both; verify `pnpm --filter happy-server build` (`tsc --noEmit` + pkgroll) stays green after adding it. (Impl-time check, not a plan blocker.)
- **OQ-1 — should the legacy sync `checkEdgeAccess` be deleted eventually?** This plan keeps it (fail-closed fallback + test compat). A follow-up could remove it once every public path requires `assertion`. Left as debt, not in scope. *(Lead to note; not blocking.)*
- **OQ-2 — persist/rotate awareness of AUD/team-domain changes.** If the operator rotates the Access app (new AUD), they must update `public-tunnel.json` + restart the daemon. Documented in A6/fork-notes; no live-reload in scope.
- **OQ-3 — `dualListenerBinding.test.ts` (happy-server) coverage.** Confirm whether it constructs `publicAuth.edge`; if so it needs the A3 assertion field. The impl must check both `sources/dualListenerBinding.test.ts` (happy-server) and leave `packages/happy-cli/src/daemon/dualListenerBinding.test.ts` untouched unless it constructs the server config. *(Verify at impl time.)*

---

## 9. Ship order & acceptance commands

**Ship order (single impl, sequential commits):** B1 → A1 → A2 → A3 → A4 → A5 → A6 → B2. B1 is an independent quick-win; A1 is the foundation everything else builds on; A5 depends on A1's helper + A2's wiring; docs (A6, B2) land last. All in ONE happy-server + happy-cli impl (co-located; not a dual-repo split — both packages are in codexu, one PRD).

**Acceptance test commands** (Windows/PowerShell; run from repo root; happy-server package name `happy-server`, CLI package name `happy`):

```powershell
# Task A + HARD-CONSTRAINT gates (happy-server) — file-scoped:
pnpm --filter happy-server exec vitest run `
  sources/app/api/auth/edgeAssertion.spec.ts `
  sources/app/api/auth/remoteDeviceAuth.spec.ts `
  sources/app/api/publicAuthGate.spec.ts `
  sources/app/api/deviceEnrollment.spec.ts `
  sources/app/api/socket.spec.ts `
  sources/index.spec.ts `
  sources/dualListenerBinding.test.ts `
  sources/app/api/auth/forkAuthPlane.spec.ts `
  sources/app/api/auth/corsAllowed.test.ts

# happy-server typecheck (must stay green after adding jose + assertion types):
pnpm --filter happy-server typecheck

# Task A CLI config threading (happy-cli) — file-scoped (Windows/Git Bash shell expansion):
npm_config_script_shell=bash pnpm --filter happy exec vitest run `
  src/tunnel/publicTunnelConfig.test.ts `
  src/fork/forkHooks.test.ts

# Full happy-server suite (final gate before ship):
pnpm --filter happy-server test
```

Docs stories (A6, B2) need no test run. Do NOT run android/gradle or unrelated suites.

---

## 10. Files touched (index)

**happy-server (Task A):** `sources/app/api/auth/edgeAssertion.ts` (new) · `sources/app/api/auth/edgeAssertion.spec.ts` (new) · `sources/app/api/auth/remoteDeviceAuth.ts` (EdgeAccessConfig + isEdgeAllowed + guard call sites) · `sources/app/api/auth/remoteDeviceAuth.spec.ts` · `sources/fork/operatorIdentityGate.ts` · `sources/index.spec.ts` · `sources/dualListenerBinding.test.ts` (verify) · `sources/app/api/publicAuthGate.spec.ts` · `sources/app/api/deviceEnrollment.spec.ts` · `sources/app/api/socket.spec.ts` · `sources/app/api/auth/testEdgeAssertion.ts` (new helper, optional) · `package.json` (+jose).
**happy-server (Task B):** `sources/app/api/api.ts` · `sources/app/api/socket.ts` · `sources/app/api/auth/corsAllowed.test.ts`.
**happy-cli (Task A):** `src/tunnel/publicTunnelConfig.ts` · `src/tunnel/publicTunnelConfig.test.ts` · `src/types/happy-server.d.ts`.
**docs:** `docs/security-model.md` · `docs/api.md` · `docs/cli-architecture.md` · `docs/fork-notes.md` · `packages/happy-server/AGENTS.md`.

**Do NOT touch:** `packages/happy-wire/*` (D-6) · codexu root `CLAUDE.md` (gitignored) · the retired `happy.evyatar.dev` central-instance framing.
