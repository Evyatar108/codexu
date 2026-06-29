# Stories Outline: Single-user PUBLIC happy-server on evyatar.dev (D-001 + mandatory edge)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-000: Scope-guardrail supersession preflight
**Description:** As the operator, I want the fork's "never happy.evyatar.dev / never Cloudflare provider-swap" guardrail explicitly superseded for this single-tenant case so implementation does not start from a constraint violation.
**Acceptance Criteria:**
- [ ] AGENTS.md + docs/fork-notes.md record the operator-approved single-tenant supersession (embedded per-daemon server, Cloudflare is edge defense not boundary)
- [ ] No code/exposure changes in this story
**Dependencies:** None
**Estimated complexity:** small

## US-001: happy-wire signed-request envelope + happy-server verifier + auth:"public" (global hook)
**Description:** As a developer, I want a shared signed-request schema and a fail-closed global public-mode HTTP hook + Ed25519 device verifier so public routes deny by default.
**Acceptance Criteria:**
- [ ] @slopus/happy-wire exports public signed-request schema + deterministic nonce/body-hash/signature test vectors
- [ ] auth:"public" added across server/socket/cli types; global fail-closed HTTP hook installed before route registration; explicit method/path allowlist
- [ ] remoteDeviceAuth.ts verifies Ed25519 over server nonce + method/path/body-hash; replay-protected
- [ ] Typecheck passes
**Dependencies:** US-000
**Estimated complexity:** large

## US-002: Socket.IO handshake verifier (ws+polling) + CORS
**Description:** As a developer, I want the socket handshake to require device proof on both websocket and polling, with CORS headers extended.
**Acceptance Criteria:**
- [ ] socket middleware demands device proof in public mode (ws + polling fallback); fail-open tunnel branch closed
- [ ] CORS/socket allowedHeaders include new proof + CF-Access headers
- [ ] Typecheck passes
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: /pair/complete window+QR gate + /pair/connect verifier gate
**Description:** As the operator, I want self-enrollment closed: /pair/complete only inside an operator window with pre-shared secret; /pair/connect requires device verifier.
**Acceptance Criteria:**
- [ ] /pair/complete returns key material ONLY in window + valid secret; replay-protected; 401 otherwise
- [ ] /pair/connect gated by device verifier
- [ ] Typecheck passes
**Dependencies:** US-001
**Estimated complexity:** medium

## US-004: assertOperatorIdentityGate tighten
**Description:** As a developer, I want public/non-loopback bind allowed ONLY with verifier + edge-auth expectation present.
**Acceptance Criteria:**
- [ ] Gate throws on bare public bind without verifier+edge config
- [ ] Typecheck passes
**Dependencies:** US-001
**Estimated complexity:** small

## US-005: Decisive acceptance test (route-inventory fail-closed)
**Description:** As a developer, I want a generated test deriving the route inventory from the registered Fastify app, asserting every non-allowlisted route returns 401 with no key material; ws+polling handshake rejected; /pair/complete leaks nothing.
**Acceptance Criteria:**
- [ ] Generated route-inventory test: all non-allowlisted routes 401, no key material/secrets
- [ ] ws+polling unauthenticated handshake rejected; /health, version, dev, /files/*, both pair endpoints covered
- [ ] Tests pass
**Dependencies:** US-001, US-002, US-003, US-004
**Estimated complexity:** medium

## US-006: CloudflareTunnelDaemonProvider + listener select + pairing-invite
**Description:** As the operator, I want a Cloudflare provider selectable behind opt-in, auth:"public" listener, persisted machine-state, and a short-lived public pairing-invite payload.
**Acceptance Criteria:**
- [ ] CloudflareTunnelDaemonProvider implements DaemonTunnelProvider; selected only under opt-in
- [ ] Public bind only when verifier+edge active; pairing invite emits URL+secret+machineId+Access creds
- [ ] Typecheck passes
**Dependencies:** US-005
**Estimated complexity:** large

## US-007: happy-app Access service-token storage/headers + enrollment + proof + polling
**Description:** As a BOOX user, I want to import the pairing invite, store Access service-token creds, present device proof + CF-Access headers on HTTP and ws/polling.
**Acceptance Criteria:**
- [ ] tokenStorage adds cloudflareAccessClientId/Secret + device key fields (migration-tested)
- [ ] socketOptions adds polling + CF-Access headers; getMachineAuthHeaders emits proof+Access
- [ ] Typecheck passes
**Dependencies:** US-005, US-006
**Estimated complexity:** large

## US-008: codex Feature gate + /remote on local attach
**Description:** As the operator, I want the variant opt-in/default-off via codex Feature; /remote on keeps local 127.0.0.1 attach observing the public-listener machine-state.
**Acceptance Criteria:**
- [ ] Feature default-off; loopback attach unchanged
- [ ] cargo check passes
**Dependencies:** US-006
**Estimated complexity:** small

## US-009: Cloudflare Access edge ops + WS-proof
**Description:** As the operator, I want the Access service-token application/policy on happy.evyatar.dev, proven to reject missing/incorrect headers and gate the WS upgrade.
**Acceptance Criteria:**
- [ ] Service-token Access app; missing/incorrect headers rejected for HTTP + WS upgrade; valid reach app
- [ ] Documented .cloudflared LocalSystem cred-path
**Dependencies:** US-006, US-007
**Estimated complexity:** medium

## US-010: Docs lockstep
**Description:** As a contributor, I want docs reconciled with the single-tenant public mode.
**Acceptance Criteria:**
- [ ] Update security-model.md, fork-notes.md, AGENTS.md, happy-cli/AGENTS.md; sweep api.md/backend/cli-architecture + server/app AGENTS.md
**Dependencies:** US-001,US-006,US-007,US-008,US-009
**Estimated complexity:** small
