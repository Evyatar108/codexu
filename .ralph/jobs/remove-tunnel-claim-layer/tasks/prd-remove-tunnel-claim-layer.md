# PRD: Remove Happy Tunnel Claim Auth Layer

## Introduction

Delete the Happy "tunnel claim" auth layer (`X-Codexu-Authorization`) entirely from all four packages (happy-server, happy-app, happy-cli, happy-agent). Microsoft Dev Tunnels gateway's `X-Tunnel-Authorization` becomes the sole identity gate for remote callers (the BOOX app, and happy-agent talking to remote tunnel URLs). For the loopback caller (happy-cli to daemon on the same machine), the existing `X-Loopback-Capability` capability-token check is preserved — only the tunnel-claim branch is deleted.

The `accountId` plumbing carried in the claim payload is also removed: this fork is single-user self-host, and the operator identity is already loaded into `tofuConfig` from `~/.happy/profile.json` at server boot. Per `packages/happy-server/CLAUDE.md` and `packages/happy-app/CLAUDE.md`, the fork explicitly does not maintain on-disk or wire compatibility across versions — stale `tunnelClaim` strings in MMKV / `expo-secure-store` / `localStorage` are dropped via a refactored load path; the user re-pairs if load fails. Strict parse, fail closed, no "tolerate extra fields for one cycle" hack.

## Goals

- Remove all server-side enforcement, minting, and encoding of `X-Codexu-Authorization` / tunnel claims.
- Remove all client-side production and consumption of the claim in happy-app, happy-cli, and happy-agent.
- Collapse `request.accountId` reads to `tofuConfig.localUserId` (single-user self-host identity).
- Preserve `X-Loopback-Capability` exactly as-is (gates loopback-only traffic).
- Update all documentation (`docs/`, `plans/`, per-package `CLAUDE.md`) to reflect the new "Dev Tunnels gateway for remote, loopback capability for local" model.
- Mark `plans/realtime-sync-perf.md` §WS1 as obsoleted by this removal.

## User Stories

### US-001: Server — tunnel-branch identity collapse + delete `requireAccountIdForTunnel`

**Description:** As the operator, I want the server to stop verifying `X-Codexu-Authorization` and stop requiring `accountId` on tunnel routes, so that subsequent stories can drop the claim entirely without breaking `/v2/me/profile`, `/v2/me/settings`, `/v2/me/machine`.

**Acceptance Criteria:**
- [ ] In the tunnel-auth branch of `packages/happy-server/sources/app/api/api.ts` (`authenticateTunnelClaim`, lines 81-90), claim verification is replaced by `request.userId = tofuConfig.localUserId`. Loopback branch (lines 80-91) untouched.
- [ ] In `packages/happy-server/sources/app/api/socket.ts` (`createSocketAuthMiddleware`, lines 73-84), the tunnel-claim verify+reject block is replaced by setting `socket.data.userId = tofuConfig.localUserId`; loopback branch at lines 64-73 untouched.
- [ ] `packages/happy-server/sources/app/api/utils/requireAccountIdForTunnel.ts` is deleted.
- [ ] All callers of `requireAccountIdForTunnel` updated: `accountRoutes.ts:47-79` and `machineSelfRoutes.ts:23-26` no longer reference it.
- [ ] `accountId?: number` removed from FastifyRequest module augmentation (`types.ts:53-63`).
- [ ] `socket.spec.ts:142,177` updated to drop `accountId` assertions.
- [ ] `pnpm --filter '{packages/happy-server}' typecheck` and `test` green.
- [ ] A new or existing test asserts that a loopback request WITHOUT `X-Loopback-Capability` is rejected — confirms the preserved mechanism still gates loopback traffic.
- [ ] Typecheck passes.
- [ ] Tests pass.

### US-002: Server — delete tunnel-claim minting code + `tunnelClaim.ts`

**Description:** As the operator, I want all server-side claim minting/encoding code removed and `/pair/complete` to stop returning `tunnelClaim`, so that the runtime no longer carries dead code or schema.

**Acceptance Criteria:**
- [ ] `packages/happy-server/sources/app/api/auth/tunnelClaim.ts` deleted (verifier, encoder, `jti` cache, `TunnelClaimSchema`, `__resetTunnelClaimReplayCacheForTests`, `__TUNNEL_CLAIM_TESTING__`).
- [ ] `packages/happy-server/sources/app/api/auth/encodeTunnelClaim.test.ts` deleted.
- [ ] `buildTunnelClaimPayload` removed from `pairRoutes.ts:39-48`.
- [ ] Mint calls at `pairRoutes.ts:126-127` (`/pair/complete`) and `pairRoutes.ts:164-167` (`/pair/connect`) removed.
- [ ] `tunnelClaim` field removed from pair response schemas at `pairRoutes.ts:94,137,174` and from runtime response payloads.
- [ ] `pairRoutes.test.ts:7,63`, `accountRoutes.test.ts:7`, `dualListenerBinding.test.ts:8,89`, and `socket.spec.ts:32` rewritten to drop `encodeTunnelClaim` / `verifyTunnelClaim` imports. Tests that previously authenticated via a minted claim now authenticate via `X-Loopback-Capability` (pattern at `accountRoutes.test.ts:64,178`) or via no auth (whichever fits the test).
- [ ] `pnpm --filter '{packages/happy-server}' typecheck` and `test` green.
- [ ] Typecheck passes.
- [ ] Tests pass.

### US-003: happy-app — remove claim machinery

**Description:** As the operator, I want the app to stop sending `X-Codexu-Authorization`, delete all claim refresh / parse / persist code, and refactor the stored-credentials shape — strict parse, force re-pair on mismatch, no backward-compat hack.

**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/refreshClaim.ts` deleted.
- [ ] `packages/happy-app/sources/sync/refreshClaim.test.ts` deleted.
- [ ] `getMachineAuthHeaders` in `machineAuth.ts:65-72` simplified to return only `{ 'X-Tunnel-Authorization': 'tunnel ' + connectToken }`.
- [ ] `X-Codexu-Authorization` send sites removed from `socketOptions.ts:22-35` (both `auth` and `extraHeaders`).
- [ ] `tunnelClaim: string` removed from the `AuthCredentials` interface (`tokenStorage.ts:14`).
- [ ] `tokenStorage.ts:39-67` `isOldShape()` refactored so a credential missing `tunnelClaim` is NOT treated as old-shape-to-drop. Strict parse; if old persisted credentials structurally don't match, drop and force re-pair (no tolerance hack).
- [ ] `parseTunnelClaimPayload` and `assertMachineHasAccountId` removed from `pairing.ts:202-213`; `accountId` assertion in `completePair` (~line 171) removed; `tunnelClaim` write removed from `credentialsFromPairMachine` (~line 185).
- [ ] `apiSocket.ts:6,219` dangling catches of `DeviceCodeExpired` / `ClaimExpired` removed.
- [ ] `sync.ts:4,372-378` same removal.
- [ ] `_layout.tsx:170-197,239` dev-only `EXPO_PUBLIC_DEV_TUNNEL_CLAIM` / `dev_tunnel_claim` paths removed.
- [ ] Tests updated: `socketOptions.test.ts:37-41`, `pairing.test.ts`, `machineAuth.test.ts`, `tokenStorage.test.ts`, `apiSocket.test.ts`, `pushRegistration.test.ts`, `picker.test.tsx:92-96`.
- [ ] `pnpm --filter '{packages/happy-app}' typecheck` and `test` green.
- [ ] `grep -rn 'tunnelClaim\|X-Codexu-Authorization\|refreshTunnelClaim\|parseTunnelClaimPayload' packages/happy-app/sources/` returns no live read/write sites.
- [ ] Typecheck passes.
- [ ] Tests pass.

### US-004: happy-cli — remove claim minting, preserve loopback-capability

**Description:** As the operator, I want the CLI to stop minting/sending the happy claim on daemon calls while preserving the separate `X-Loopback-Capability` mechanism intact.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/daemon/getLocalTunnelClaim.ts` deleted.
- [ ] `packages/happy-cli/src/daemon/getLocalTunnelClaim.test.ts` deleted.
- [ ] `mintTunnelClaim` import and call removed from `daemonClient.ts:142,162`; the resulting header is dropped from CLI requests.
- [ ] Signed-claim usage removed from `daemon/run.ts:720`.
- [ ] `api/socketTunnelAuth.test.ts:86-185` rewritten or deleted (the `tunnelClaim()` helper no longer applies).
- [ ] `packages/happy-cli/src/daemon/loopbackCapability.ts` and `loopbackCapability.test.ts` untouched.
- [ ] `loopbackCapabilityPath` usage in `daemon/run.ts:222` and the capability-token send path remain functional.
- [ ] `pnpm --filter '{packages/happy-cli}' typecheck` and `test` green.
- [ ] Typecheck passes.
- [ ] Tests pass.

### US-005: happy-agent — remove claim machinery + rebuild dist

**Description:** As the operator, I want happy-agent to stop sending `X-Codexu-Authorization`, drop the claim from its persisted credentials shape, and rebuild the `dist/` artifacts so the AC grep doesn't hit stale generated output.

**Acceptance Criteria:**
- [ ] `X-Codexu-Authorization` removed from `src/api.ts:319,343-394` and the refresh-paths there.
- [ ] `X-Codexu-Authorization` removed from `src/machineRpc.ts:61-79`.
- [ ] Claim derivation/persistence/refresh removed from `src/auth.ts:285-313`.
- [ ] `tunnelClaim` removed from the persisted shape in `src/credentials.ts:20-32`.
- [ ] Claim imports and login/spawn/resume code referencing the claim contract removed from `src/index.ts:9,71-77,280-387`.
- [ ] Tests updated: `src/auth.test.ts`, `src/credentials.test.ts`, `src/happy-agent.integration.test.ts`, `src/cli-smoke.test.ts`, `src/machineRpc.test.ts`, `src/api.test.ts:393`.
- [ ] `pnpm --filter '{packages/happy-agent}' typecheck` and `test` green.
- [ ] `packages/happy-agent/dist/` regenerated (run the package's build script).
- [ ] `grep -rn 'tunnelClaim\|X-Codexu-Authorization' packages/happy-agent/` returns no hits (including `dist/`).
- [ ] Typecheck passes.
- [ ] Tests pass.

### US-006: Documentation sweep + plan obsoletion notes

**Description:** As future-self maintaining the codebase, I want every doc that references the now-removed claim layer updated, the original WS1 marked obsoleted, and the BOOX validation pain point marked resolved.

**Acceptance Criteria:**
- [ ] `plans/realtime-sync-perf.md` §Workstream 1 (lines 80-103 + touch-points table at line 178) replaced with an obsoletion note referencing this plan and the implementation commit hash.
- [ ] `docs/validation/devtunnels-boox-result.md` "Realtime sync perf (deferred)" subsection: "Slow first-load on foreground" bullet marked resolved.
- [ ] `docs/security-model.md` rewritten: "Claim Envelope Contract" + "Operator Identity Gate" sections updated to describe the new dual-gate model (Dev Tunnels gateway for remote, loopback capability for local). Explicitly note that the metrics endpoint (`0.0.0.0` bind, no auth) is unchanged by this work.
- [ ] `docs/protocol.md` (lines 24-33, 40-59) updated: remove claim header details, document new wire contract.
- [ ] `docs/api.md` (lines 14-28, 30-42) updated: pair response no longer includes `tunnelClaim`.
- [ ] `docs/backend-architecture.md`, `docs/cli-architecture.md`, `docs/deployment.md`, `docs/encryption.md`, `docs/realtime-sync-and-rpc.md`, `docs/user-identity.md`, `docs/operations/BOOX-TESTING-HANDOFF.md` swept for stale claim references; updated.
- [ ] `packages/happy-server/CLAUDE.md` "Tunnel-auth headers (BOOX-validated 2026-05-13)" paragraph updated.
- [ ] `packages/happy-app/CLAUDE.md:129` Authentication Flow paragraph updated.
- [ ] `packages/happy-agent/CLAUDE.md`, `packages/happy-cli/CLAUDE.md`, `packages/happy-cli/src/daemon/CLAUDE.md` swept for stale claim references; updated.
- [ ] `plans/codexu-roadmap.md` (lines 233, 239, 265, 277, 295, 330, 334, 347, 361, 364, 365) swept for stale claim references.
- [ ] `grep -rn 'X-Codexu-Authorization\|verifyTunnelClaim\|encodeTunnelClaim\|TunnelClaimSchema\|buildTunnelClaimPayload\|parseTunnelClaimPayload\|refreshTunnelClaim\|requireAccountIdForTunnel' docs/ plans/ packages/*/CLAUDE.md` returns no live references (historical-context paragraphs framed as historical are acceptable).
- [ ] Typecheck passes.

## Functional Requirements

- FR-1: `/pair/complete` and `/pair/connect` no longer return a `tunnelClaim` field in their JSON response.
- FR-2: The server's tunnel-auth branch (HTTP decorator + socket middleware) sets `request.userId` / `socket.data.userId` to `tofuConfig.localUserId` without inspecting `X-Codexu-Authorization`.
- FR-3: The server's loopback-auth branch (`X-Loopback-Capability` check) remains byte-for-byte identical to the pre-change implementation.
- FR-4: happy-app HTTP requests to the daemon include `X-Tunnel-Authorization` but never `X-Codexu-Authorization`.
- FR-5: happy-app socket handshake (`auth` and `extraHeaders`) includes `X-Tunnel-Authorization` but never `X-Codexu-Authorization` / `codexuAuthorization`.
- FR-6: happy-cli HTTP requests to the daemon include `X-Loopback-Capability` but never `X-Codexu-Authorization`.
- FR-7: happy-agent HTTP and RPC calls include `X-Tunnel-Authorization` but never `X-Codexu-Authorization`.
- FR-8: Stored credentials in happy-app (`AuthCredentials`) and happy-agent (`Credentials`) no longer carry a `tunnelClaim` field on new writes; loading old credentials with an extra `tunnelClaim` field either ignores the field (preferred) or, if structurally incompatible, drops them and forces re-pair.
- FR-9: All files listed under "Files to DELETE" in the plan are removed from the working tree.
- FR-10: `packages/happy-agent/dist/` is regenerated so the cross-package grep ACs do not hit stale built artifacts.

## Non-Goals

- **Loopback capability auth (`X-Loopback-Capability`) is NOT removed.** Separate mechanism, preserved as-is.
- **No new auth layer.** The claim is not replaced with a different per-request token.
- **No Dev Tunnels gateway change.**
- **Workstreams 2 and 3 of `plans/realtime-sync-perf.md`** (optimistic placeholder session, server-side event replay buffer) remain open for future work.
- **No multi-tenant accommodation.** Single-user self-host collapse only.
- **No DB migration.** No DB rows are keyed on `accountId` (per blast-radius research).
- **No change to the metrics endpoint posture** (`0.0.0.0` bind, no auth). Pre-existing and intentional — only documented, not modified.
- **No backward compatibility for on-disk credentials.** Stale `tunnelClaim` in MMKV / `expo-secure-store` / `localStorage` is dropped via strict parse; user re-pairs.

## Technical Considerations

- **Identity replacement.** `tofuConfig.localUserId` (loaded from `~/.happy/profile.json` at server boot) is the operator identity used wherever the route/socket layer previously read `request.accountId`. Socket scope keys like `user-${accountId}` collapse to a single constant derived from `tofuConfig.localUserId`.
- **`/pair/complete` stays.** Still mints/returns TOFU public keys, tunnel URL, optional `mobileSharedSecret`, and `githubLogin`. Only `tunnelClaim` is dropped from the response.
- **happy-agent `dist/` artifacts.** `packages/happy-agent/package.json` ships pre-built `dist/index.*` files. Implementation must rebuild them (in US-005) so the cross-package grep ACs do not hit stale generated output.
- **Trust boundary on operator machine.** With the claim layer gone, happy-cli relies solely on `X-Loopback-Capability`. The capability-token mechanism must not be accidentally weakened — US-001 explicitly adds/keeps a test asserting that a loopback request without the capability token is rejected.
- **Strict credential parse.** US-003 and US-005 commit messages must document that the user may need to re-pair after upgrading, since old persisted credentials may not load cleanly under the new strict parser.
- **Identity-collapse blast radius.** Any handler that destructured `request.accountId` from a typed `FastifyRequest` will fail TypeScript after `accountId` is removed from the module augmentation. Implementer must follow the typecheck error trail — mechanical but not zero.
- **Test baseline.** `packages/happy-app/sources/sync/refreshClaim.test.ts` reports 6 failed / 5 passed at baseline (already asserting an obsolete contract). US-003 deletes these tests along with `refreshClaim.ts`.

## Success Metrics

- All four packages build and test green (`pnpm -r build`, `pnpm -r test`).
- Cross-package greps for `X-Codexu-Authorization`, `verifyTunnelClaim`, `encodeTunnelClaim`, `TunnelClaimSchema`, `buildTunnelClaimPayload`, `parseTunnelClaimPayload`, `refreshTunnelClaim`, `requireAccountIdForTunnel` return no live references (historical doc-prose remnants framed as historical are acceptable).
- Manual operator check (post-merge, not CI-verifiable): BOOX → daemon HTTP and socket connections succeed without `X-Codexu-Authorization`. Confirmed in `docs/validation/devtunnels-boox-result.md`.

## Open Questions

- **Single commit on `main` vs commit-per-story.** Default per the plan: one commit per story (six commits in one push to `main`). If the operator prefers a squashed merge, that's a final-merge choice, not a planning choice.
- **happy-agent `dist/` regen — automated or manual?** If the package has a `prepare` / `build` script that runs on `pnpm install`, regen is automatic. If not, the implementer must run `pnpm --filter '{packages/happy-agent}' build` and commit the result. Implementer confirms during US-005.
