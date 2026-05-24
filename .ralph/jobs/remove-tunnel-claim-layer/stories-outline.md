# Stories Outline: Remove Happy Tunnel Claim Auth Layer

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Server — tunnel-branch identity collapse + delete `requireAccountIdForTunnel`

**Description:** As the operator, I want the server to stop verifying `X-Codexu-Authorization` and stop requiring `accountId` on tunnel routes, so that the next-iteration commits can drop the claim entirely without breaking `/v2/me/profile`, `/v2/me/settings`, `/v2/me/machine`.

**Acceptance Criteria:**
- [ ] In the tunnel-auth branch of `packages/happy-server/sources/app/api/api.ts` (`authenticateTunnelClaim`, lines 81-90), the claim verification is replaced by `request.userId = tofuConfig.localUserId` (or the call site's equivalent identity-from-profile). Loopback branch untouched.
- [ ] In `packages/happy-server/sources/app/api/socket.ts` (`createSocketAuthMiddleware`, lines 73-84), the tunnel-claim verify+reject block is replaced by setting `socket.data.userId = tofuConfig.localUserId`; loopback branch at lines 64-73 untouched.
- [ ] `packages/happy-server/sources/app/api/utils/requireAccountIdForTunnel.ts` is deleted.
- [ ] All callers of `requireAccountIdForTunnel` are updated: `accountRoutes.ts:47-79` and `machineSelfRoutes.ts:23-26` no longer reference it.
- [ ] `accountId?: number` removed from FastifyRequest module augmentation (`types.ts:53-63`).
- [ ] `socket.spec.ts:142,177` updated to drop `accountId` assertions (tunnel path no longer sets it).
- [ ] `packages/happy-server` typecheck and test green.
- [ ] **A new or existing test asserts that a loopback request WITHOUT `X-Loopback-Capability` is rejected** — confirms the unrelated mechanism is preserved.

**Dependencies:** None
**Estimated complexity:** medium

---

## US-002: Server — delete tunnel-claim minting code + tunnelClaim.ts

**Description:** As the operator, I want all server-side claim minting/encoding code removed and `/pair/complete` to stop returning `tunnelClaim`, so that the runtime no longer carries dead code or schema.

**Acceptance Criteria:**
- [ ] `packages/happy-server/sources/app/api/auth/tunnelClaim.ts` deleted (verifier, encoder, `jti` cache, `TunnelClaimSchema`, `__resetTunnelClaimReplayCacheForTests`, `__TUNNEL_CLAIM_TESTING__`).
- [ ] `packages/happy-server/sources/app/api/auth/encodeTunnelClaim.test.ts` deleted.
- [ ] `buildTunnelClaimPayload` removed from `pairRoutes.ts:39-48`.
- [ ] Mint calls at `pairRoutes.ts:126-127` (`/pair/complete`) and `pairRoutes.ts:164-167` (`/pair/connect`) removed.
- [ ] `tunnelClaim` field removed from pair response schemas at `pairRoutes.ts:94,137,174` and from runtime response payloads.
- [ ] `pairRoutes.test.ts:7,63` rewritten (drop `verifyTunnelClaim` import and claim assertion).
- [ ] `accountRoutes.test.ts:7` and `dualListenerBinding.test.ts:8,89` and `socket.spec.ts:32` rewritten to remove `encodeTunnelClaim` import; tests that authenticated via a minted claim now authenticate via `X-Loopback-Capability` (pattern already present at `accountRoutes.test.ts:64,178`) or via no auth (whichever fits the test).
- [ ] `packages/happy-server` typecheck and test green.

**Dependencies:** US-001
**Estimated complexity:** medium

---

## US-003: happy-app — remove claim machinery

**Description:** As the operator, I want the app to stop sending `X-Codexu-Authorization`, delete all claim refresh / parse / persist code, and refactor stored-credentials shape — strict parse, force re-pair on mismatch, no backward-compat hack.

**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/refreshClaim.ts` deleted.
- [ ] `packages/happy-app/sources/sync/refreshClaim.test.ts` deleted.
- [ ] `getMachineAuthHeaders` in `machineAuth.ts:65-72` simplified to return only `{ 'X-Tunnel-Authorization': 'tunnel ' + connectToken }`.
- [ ] `X-Codexu-Authorization` send sites removed from `socketOptions.ts:22-35` (both `auth` and `extraHeaders`).
- [ ] `tunnelClaim: string` removed from `AuthCredentials` interface (`tokenStorage.ts:14`).
- [ ] `tokenStorage.ts:39-67` `isOldShape()` refactored so a credential missing `tunnelClaim` is NOT treated as old-shape-to-drop. Strict parse; if old persisted credentials structurally don't match, drop and force re-pair (no tolerance hack).
- [ ] `parseTunnelClaimPayload` and `assertMachineHasAccountId` removed from `pairing.ts:202-213`; `accountId` assertion in `completePair` (~line 171) removed; `tunnelClaim` write removed from `credentialsFromPairMachine` (~line 185).
- [ ] `apiSocket.ts:6,219` dangling catches of `DeviceCodeExpired` / `ClaimExpired` removed.
- [ ] `sync.ts:4,372-378` same removal.
- [ ] `_layout.tsx:170-197,239` dev-only `EXPO_PUBLIC_DEV_TUNNEL_CLAIM` / `dev_tunnel_claim` paths removed.
- [ ] Tests updated: `socketOptions.test.ts:37-41`, `pairing.test.ts`, `machineAuth.test.ts`, `tokenStorage.test.ts`, `apiSocket.test.ts`, `pushRegistration.test.ts`, `picker.test.tsx:92-96`.
- [ ] `pnpm --filter '{packages/happy-app}' typecheck` and `test` green.
- [ ] `grep -rn 'tunnelClaim\|X-Codexu-Authorization\|refreshTunnelClaim\|parseTunnelClaimPayload' packages/happy-app/sources/` returns no live read/write sites (only doc-prose remnants if any).

**Dependencies:** US-001 (server must accept claim-less requests before app stops sending them, OR land US-001 + US-003 in coordinated push)
**Estimated complexity:** large

---

## US-004: happy-cli — remove claim minting, preserve loopback-capability

**Description:** As the operator, I want the CLI to stop minting/sending the happy claim on daemon calls while preserving the separate `X-Loopback-Capability` mechanism intact.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/daemon/getLocalTunnelClaim.ts` deleted.
- [ ] `packages/happy-cli/src/daemon/getLocalTunnelClaim.test.ts` deleted.
- [ ] `mintTunnelClaim` import and call removed from `daemonClient.ts:142,162`; the resulting header is dropped from CLI requests.
- [ ] Signed-claim usage removed from `daemon/run.ts:720`.
- [ ] `api/socketTunnelAuth.test.ts:86-185` rewritten or deleted (the `tunnelClaim()` helper no longer applies).
- [ ] **`packages/happy-cli/src/daemon/loopbackCapability.ts` + `loopbackCapability.test.ts` untouched** (the unrelated capability-token mechanism is preserved).
- [ ] `loopbackCapabilityPath` usage in `daemon/run.ts:222` and the capability-token send path remain functional.
- [ ] `pnpm --filter '{packages/happy-cli}' typecheck` and `test` green.

**Dependencies:** US-001 (server must accept claim-less requests first)
**Estimated complexity:** small

---

## US-005: happy-agent — remove claim machinery (deeper than originally scoped)

**Description:** As the operator, I want happy-agent to stop sending `X-Codexu-Authorization`, drop the claim from its persisted credentials shape, and rebuild the `dist/` artifacts so the AC grep doesn't hit stale generated output.

**Acceptance Criteria:**
- [ ] `X-Codexu-Authorization` removed from `src/api.ts:319,343-394` and the refresh-paths there.
- [ ] `X-Codexu-Authorization` removed from `src/machineRpc.ts:61-79`.
- [ ] Claim derivation/persistence/refresh removed from `src/auth.ts:285-313`.
- [ ] `tunnelClaim` removed from the persisted shape in `src/credentials.ts:20-32`.
- [ ] Claim imports and any login/spawn/resume code referencing the claim contract removed from `src/index.ts:9,71-77,280-387`.
- [ ] Tests updated: `src/auth.test.ts`, `src/credentials.test.ts`, `src/happy-agent.integration.test.ts`, `src/cli-smoke.test.ts`, `src/machineRpc.test.ts`, `src/api.test.ts:393`.
- [ ] `pnpm --filter '{packages/happy-agent}' typecheck` and `test` green.
- [ ] **`packages/happy-agent/dist/` regenerated** (run the package's build script so the AC grep doesn't hit stale generated output).
- [ ] `grep -rn 'tunnelClaim\|X-Codexu-Authorization' packages/happy-agent/` returns no hits (including `dist/`).

**Dependencies:** US-001 (server must accept claim-less requests first)
**Estimated complexity:** large

---

## US-006: Documentation sweep + plan obsoletion notes

**Description:** As future-self maintaining the codebase, I want every doc that references the now-removed claim layer updated, the original WS1 marked obsoleted, and the BOOX validation pain point marked resolved.

**Acceptance Criteria:**
- [ ] `plans/realtime-sync-perf.md` §Workstream 1 (lines 80-103 + touch-points table at line 178) replaced with an obsoletion note referencing this plan and the implementation commit hash.
- [ ] `docs/validation/devtunnels-boox-result.md` "Realtime sync perf (deferred)" subsection: "Slow first-load on foreground" bullet marked resolved.
- [ ] `docs/security-model.md` rewritten: "Claim Envelope Contract" + "Operator Identity Gate" sections updated to describe the new dual-gate model (Dev Tunnels gateway for remote, loopback capability for local).
- [ ] `docs/protocol.md` (lines 24-33, 40-59) updated: remove claim header details, document new wire contract.
- [ ] `docs/api.md` (lines 14-28, 30-42) updated: pair response no longer includes `tunnelClaim`.
- [ ] `docs/backend-architecture.md`, `docs/cli-architecture.md`, `docs/deployment.md`, `docs/encryption.md`, `docs/realtime-sync-and-rpc.md`, `docs/user-identity.md`, `docs/operations/BOOX-TESTING-HANDOFF.md` swept for stale claim references; updated.
- [ ] `packages/happy-server/CLAUDE.md` "Tunnel-auth headers (BOOX-validated 2026-05-13)" paragraph updated.
- [ ] `packages/happy-app/CLAUDE.md:129` Authentication Flow paragraph updated.
- [ ] `packages/happy-agent/CLAUDE.md`, `packages/happy-cli/CLAUDE.md`, `packages/happy-cli/src/daemon/CLAUDE.md` swept for stale claim references; updated.
- [ ] `plans/codexu-roadmap.md` (lines 233, 239, 265, 277, 295, 330, 334, 347, 361, 364, 365) swept for stale claim references.
- [ ] `grep -rn 'X-Codexu-Authorization\|verifyTunnelClaim\|encodeTunnelClaim\|TunnelClaimSchema\|buildTunnelClaimPayload\|parseTunnelClaimPayload\|refreshTunnelClaim\|requireAccountIdForTunnel' docs/ plans/ packages/*/CLAUDE.md packages/*/src/**/CLAUDE.md` returns no live references (historical-context paragraphs explaining the removal are acceptable but must be clearly framed as historical, not current).

**Dependencies:** US-001, US-002, US-003, US-004, US-005 (commit hashes referenced by US-006 require the implementation commits to exist first)
**Estimated complexity:** medium
