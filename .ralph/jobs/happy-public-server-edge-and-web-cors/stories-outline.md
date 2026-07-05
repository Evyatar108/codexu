# Stories outline — Public-mode CF edge-check + web CORS gaps (Tasks A + B)

**Job:** `happy-public-server-edge-and-web-cors` · **Plan:** `./plan.md`
**Tasks bundled:** A = `happy-public-server-edge-check-cf-jwt-assertion` (stories A1–A6) · B = `happy-public-server-web-cors-gaps` (stories B1–B2).
**8 stories total.** Ship order: **B1 → A1 → A2 → A3 → A4 → A5 → A6 → B2** (single co-located happy-server + happy-cli impl, one PRD).

| Story | Task | Complexity | Depends on |
|---|---|---|---|
| B1 | B | S | — |
| A1 | A | M | — |
| A2 | A | M | A1 |
| A3 | A | S | A2 |
| A4 | A | M | A2 |
| A5 | A | M | A1, A2 |
| A6 | A | S | A1–A5 |
| B2 | B | S | B1 |

---

## B1 — Add pairing headers to CORS allowlists (Task B)
**Files:** `packages/happy-server/sources/app/api/api.ts:64`, `packages/happy-server/sources/app/api/socket.ts:121`, `packages/happy-server/sources/app/api/auth/corsAllowed.test.ts`.
**Change:** add `'x-happy-pairing-secret'` + `'x-happy-pairing-nonce'` to both `allowedHeaders` lists (keep all existing entries incl. `CF-Access-Client-Id/Secret`). Do **NOT** add `Cf-Access-Jwt-Assertion` (CF-injected, browser never sends it).
**Acceptance criteria:**
- Both pairing headers appear in `api.ts` AND `socket.ts` `allowedHeaders`.
- `corsAllowed.test.ts` gains a `/pair/complete` `OPTIONS` preflight (`Access-Control-Request-Headers: x-happy-pairing-secret, x-happy-pairing-nonce`) asserting `204` + both echoed in `access-control-allow-headers`; existing `X-Loopback-Capability` case still green.
- `pnpm --filter happy-server exec vitest run sources/app/api/auth/corsAllowed.test.ts` green.
**Deps:** none.

## A1 — `edgeAssertion.ts` verifier + `jose` + unit spec (Task A foundation)
**Files:** `packages/happy-server/package.json` (+`jose`), `packages/happy-server/sources/app/api/auth/edgeAssertion.ts` (new), `packages/happy-server/sources/app/api/auth/edgeAssertion.spec.ts` (new).
**Change:** implement `EdgeAssertionConfig`, `deriveJwksUrl`, `createEdgeAssertionVerifier` (jose `createRemoteJWKSet` + `jwtVerify` with `issuer`/`audience`/`algorithms:['RS256']`/`clockTolerance`), returning `{ ok, reason, identity }`. Injectable `jwks` + `now` for tests. Side-effect-free import (JWKS built lazily inside the factory). Export `CF_ACCESS_JWT_ASSERTION_HEADER = "cf-access-jwt-assertion"`.
**Acceptance criteria:**
- Valid assertion → `{ ok:true }`; each negative (missing / invalid / expired / nbf-future / wrong-aud / wrong-iss / unknown-kid / JWKS-fetch-failure / identity-denied) → `{ ok:false, reason:<specific> }`. **Never `ok:true` on a negative.**
- JWKS-fetch-failure + unknown-kid **fail closed** (reject).
- Importing the module performs no network / no side effects.
- `pnpm --filter happy-server exec vitest run sources/app/api/auth/edgeAssertion.spec.ts` green.
**Deps:** none.

## A2 — Thread `assertion` into `EdgeAccessConfig` + switch guards to `isEdgeAllowed` (Task A)
**Files:** `packages/happy-server/sources/app/api/auth/remoteDeviceAuth.ts` (`EdgeAccessConfig` +`assertion?`, new `isEdgeAllowed`, build verifier in `createPublicAuthRuntime`, `httpGuard:438` + `verifySocketHandshake:481` → `await isEdgeAllowed(...)`), `packages/happy-server/sources/app/api/auth/remoteDeviceAuth.spec.ts`.
**Change:** keep sync `checkEdgeAccess` unchanged (legacy fail-closed fallback). `isEdgeAllowed` = assertion-first, legacy fallback when no `assertion`.
**Acceptance criteria:**
- Existing sync `checkEdgeAccess` asserts still green (unchanged).
- A runtime built with `edge.assertion` (injected JWKS) accepts ONLY a valid `Cf-Access-Jwt-Assertion` header; an absent/invalid one → `edge_access_denied` (401 body unchanged).
- New `isEdgeAllowed` unit cases cover both branches.
- `remoteDeviceAuth.spec.ts` green.
**Deps:** A1.

## A3 — Require `assertion` at the operator bind gate (Task A)
**Files:** `packages/happy-server/sources/fork/operatorIdentityGate.ts`, `packages/happy-server/sources/index.spec.ts` (+ `sources/dualListenerBinding.test.ts` if it builds `publicAuth.edge`).
**Change:** public **non-loopback** bind additionally requires `edge.assertion.teamDomain` + `.appAud`; refusal message names the missing assertion config. Loopback exempt.
**Acceptance criteria:**
- Existing "permits public bind" case updated to include `assertion` and still passes.
- New "refuses public non-loopback bind with serviceTokens but no assertion" case fails fast at startup.
- Loopback public binds unaffected.
- `pnpm --filter happy-server exec vitest run sources/index.spec.ts sources/dualListenerBinding.test.ts` green.
**Deps:** A2.

## A4 — happy-cli config threading + type mirror (Task A)
**Files:** `packages/happy-cli/src/tunnel/publicTunnelConfig.ts`, `packages/happy-cli/src/tunnel/publicTunnelConfig.test.ts`, `packages/happy-cli/src/types/happy-server.d.ts`.
**Change:** `PublicTunnelConfigSchema.cloudflareAccess` gains `teamDomain` + `appAud` (required), `jwksUrl` + `expectedServiceTokenNames` (optional); `buildPublicMode` maps → `publicAuth.edge.assertion`; `assertPublicBindReady` requires `teamDomain`+`appAud`; `happy-server.d.ts` mirrors `EdgeAssertionConfig` + `EdgeAccessConfig.assertion?`.
**Acceptance criteria:**
- `VALID_CONFIG` includes `teamDomain`+`appAud`; `buildPublicMode` output carries `edge.assertion`; config missing them throws in `assertPublicBindReady`.
- CLI typecheck passes (mirror matches server).
- `pnpm --filter happy exec vitest run src/tunnel/publicTunnelConfig.test.ts src/fork/forkHooks.test.ts` green.
**Deps:** A2 (server type shape).

## A5 — Migrate full-gate positive-control specs to the assertion model (Task A)
**Files:** `packages/happy-server/sources/app/api/auth/testEdgeAssertion.ts` (new shared helper, optional), `packages/happy-server/sources/app/api/publicAuthGate.spec.ts`, `packages/happy-server/sources/app/api/deviceEnrollment.spec.ts`, `packages/happy-server/sources/app/api/socket.spec.ts`.
**Change:** shared helper mints a valid `Cf-Access-Jwt-Assertion` + returns the matching `assertion` config w/ injected local JWKS; the three specs build `edge` with `serviceTokens` (kept) + `assertion`, and their positive control sends the minted assertion header instead of client-id/secret. Add a negative "assertion configured but no/invalid assertion header → 401".
**Acceptance criteria:**
- `publicAuthGate.spec.ts` (incl. US-005 route inventory), `deviceEnrollment.spec.ts`, `socket.spec.ts` green under the assertion model.
- Positive control passes ONLY with valid assertion + valid device proof.
- Every route still 401s unauthenticated (US-005 backstop intact).
- `pnpm --filter happy-server exec vitest run sources/app/api/publicAuthGate.spec.ts sources/app/api/deviceEnrollment.spec.ts sources/app/api/socket.spec.ts` green.
**Deps:** A1 (helper), A2 (wiring).

## A6 — Docs correction: assertion model (Task A)
**Files:** `docs/security-model.md:70`, `packages/happy-server/AGENTS.md` (Public-mode auth plane), `docs/api.md:26`, `docs/cli-architecture.md:217`, `docs/fork-notes.md` (`public-tunnel.json` shape).
**Change:** replace every "server re-checks / re-validates the service-token headers (`checkEdgeAccess`, constant-time compare)" claim with the assertion model (CF strips client-id/secret; only the signed `Cf-Access-Jwt-Assertion` reaches origin; server verifies signature vs team JWKS + `aud`/`iss`/`exp`/`nbf` fail-closed; JWKS-fetch-failure → reject; Ed25519 device proof remains primary). Add `teamDomain`+`appAud` (+optional `jwksUrl`) to the `public-tunnel.json` shape block.
**Acceptance criteria:**
- No doc still claims the origin re-validates client-id/secret.
- `public-tunnel.json` shape shows the new config fields.
- Ed25519-primary framing preserved. (No test run required.)
**Deps:** A1–A5 landed.

## B2 — Docs: browser (CORS) bring-up (Task B)
**Files:** `docs/security-model.md` (Socket.IO handshake / new browser-CORS note), `docs/fork-notes.md`.
**Change:** document that browsers additionally require (1) `HAPPY_CORS_ORIGINS=<app-origin>` on the origin (emits `Access-Control-Allow-Origin`; wildcards rejected by `parseCorsOrigins`), and (2) the Cloudflare Access application's `cors_headers` (`allow_all_headers` + `allowed_origins`) so CF answers the preflight; note the origin now answers the `/pair/complete` preflight (B1 headers); note **native clients are immune to CORS**.
**Acceptance criteria:**
- Both docs describe the two-part browser CORS setup + native-immune note. (No test run required.)
**Deps:** B1.

---

## Acceptance gate commands (impl must run)
```powershell
pnpm --filter happy-server exec vitest run `
  sources/app/api/auth/edgeAssertion.spec.ts sources/app/api/auth/remoteDeviceAuth.spec.ts `
  sources/app/api/publicAuthGate.spec.ts sources/app/api/deviceEnrollment.spec.ts `
  sources/app/api/socket.spec.ts sources/index.spec.ts sources/dualListenerBinding.test.ts `
  sources/app/api/auth/forkAuthPlane.spec.ts sources/app/api/auth/corsAllowed.test.ts
pnpm --filter happy-server typecheck
pnpm --filter happy exec vitest run src/tunnel/publicTunnelConfig.test.ts src/fork/forkHooks.test.ts
pnpm --filter happy-server test    # full suite, final gate
```
