# Plan Review Synthesis

Three reviewers (Claude, Codex, Copilot) reviewed `draft-plan.md`. Consensus + divergences below.

## Critical (2+ reviewers, blocking)

### C-1. US-001 "server is fully accepting" is false — `requireAccountIdForTunnel` still rejects
- **Source:** Copilot (Critical), Codex (High), Claude (F-003 Critical).
- **Evidence:** `packages/happy-server/sources/app/api/utils/requireAccountIdForTunnel.ts:6-10` returns 401 when `request.accountId` is absent. Wired into `accountRoutes.ts:47-79` and `machineSelfRoutes.ts:23-26`.
- **Impact:** After US-001 makes the claim verifier a no-op, `request.accountId` stops being set; `/v2/me/profile`, `/v2/me/settings`, `/v2/me/machine` all 401. The "server first, fully accepting" sequencing assumption breaks.
- **Fix:** US-001 must also remove `requireAccountIdForTunnel` (or rewrite to read `tofuConfig.localUserId` and set `request.accountId` from it). Add `requireAccountIdForTunnel.ts`, `accountRoutes.ts`, `machineSelfRoutes.ts` to the modify list.

### C-2. Storage migration silently drops newly-paired machines
- **Source:** Codex (Critical).
- **Evidence:** `packages/happy-app/sources/auth/tokenStorage.ts:39-67` — `isOldShape()` treats credentials without `tunnelClaim` as old shape and filters them out on load.
- **Impact:** After removing the field from new writes, freshly-paired machines fail the `isOldShape()` check and get dropped during the next storage load. Users would have to re-pair every cold start.
- **Fix:** Update `isOldShape()` so a missing `tunnelClaim` is NOT a "this is old garbage, drop it" signal. Add `tokenStorage.ts` body changes (not just type field) to the modify list.

## High (1+ reviewer, blocking-grade)

### H-1. happy-agent significantly under-scoped
- **Source:** Codex (High), Copilot (High).
- **Evidence:** Plan lists only `api.ts:319`, `api.test.ts:393`, `machineRpc.ts:68`. Actual claim derivation/persistence/refresh in `packages/happy-agent/src/auth.ts:285-313`, `src/credentials.ts:20-32`, `src/index.ts:9,71-77,280-387`. Tests in `auth.test.ts`, `credentials.test.ts`, `happy-agent.integration.test.ts`, `cli-smoke.test.ts`, `machineRpc.test.ts`.
- **Fix:** Expand happy-agent section with auth.ts, credentials.ts, index.ts, all associated tests. Acknowledge happy-agent trust model.

### H-2. happy-agent ≠ happy-cli trust model
- **Source:** Copilot (Medium, but architecturally important).
- **Evidence:** `packages/happy-agent/src/api.ts:315-323` and `machineRpc.ts:61-79` call REMOTE tunnel URLs via Dev Tunnels, not loopback.
- **Impact:** Plan's claim that "loopback locality is the implicit gate for CLI/agent → daemon" is wrong for happy-agent. happy-agent is more like happy-app's trust model (remote, Dev Tunnels gateway).
- **Fix:** Plan's Architecture section must split: happy-cli = loopback, happy-agent = remote via Dev Tunnels (same gate as happy-app), happy-server = trusts both.

### H-3. Missing server-side touch sites beyond what plan lists
- **Source:** Codex (High), Copilot (High), Claude (F-007 High).
- **Evidence:**
  - `packages/happy-server/sources/index.ts:9` — claim reference.
  - `packages/happy-server/sources/app/api/types.ts:53-63` — `accountId?: number` in FastifyRequest augmentation; plus `userId` (already kept).
  - `packages/happy-server/sources/app/api/routes/accountRoutes.ts:47-79` — uses `requireAccountIdForTunnel`.
  - `packages/happy-server/sources/app/api/routes/machineSelfRoutes.ts:23-26` — uses `requireAccountIdForTunnel`.
- **Fix:** Add all four to "happy-server (modify)".

### H-4. Missing app source call sites for `DeviceCodeExpired` / `ClaimExpired`
- **Source:** Codex (Medium, but skipping it leaves dangling catches).
- **Evidence:** `packages/happy-app/sources/sync/apiSocket.ts:6,219` and `packages/happy-app/sources/sync/sync.ts:4,372-378` import and catch these errors. Plan only lists `machineAuth.ts` removal.
- **Fix:** Add `apiSocket.ts` and `sync.ts` to modify list with specific guidance: remove the catch arms whose error types no longer exist.

### H-5. AC grep will fail — docs broader than plan lists
- **Source:** Copilot (Medium), Codex (High).
- **Evidence:** `X-Codexu-Authorization` and `tunnelClaim` strings appear in:
  - `packages/happy-agent/CLAUDE.md`
  - `packages/happy-cli/CLAUDE.md`
  - `packages/happy-cli/src/daemon/CLAUDE.md`
  - `packages/happy-app/CLAUDE.md:129`
  - `docs/backend-architecture.md`, `cli-architecture.md`, `deployment.md`, `encryption.md`, `realtime-sync-and-rpc.md`, `user-identity.md`, `operations/BOOX-TESTING-HANDOFF.md`
- **Fix:** Add all listed docs to the documentation section, or narrow the AC's grep scope to exclude historical docs.

### H-6. Plan ordering for response-shape change risks intermediate breakage
- **Source:** Codex (High).
- **Evidence:** US-002 removes `tunnelClaim` from `/pair/complete` response; current app `refreshClaim.ts:56-84` and agent `api.ts:343-394` expect `machine.tunnelClaim`. Intermediate state has clients calling refresh against responses that no longer include the field.
- **Fix:** Reorder so client-side removal of refresh callers lands before, or simultaneously with, server response-shape change. Or just bundle response-shape + client cleanup into one commit.

## Medium (worth fixing, not strictly blocking)

### M-1. Metrics listener on `0.0.0.0` complicates trust write-up
- **Source:** Claude (F-006 High).
- **Evidence:** `packages/happy-server/sources/app/monitoring/metrics.ts:48` binds metrics to `0.0.0.0` (all interfaces); main server uses `127.0.0.1`.
- **Fix:** Plan should explicitly note metrics surface is public (no auth, no secrets) and call out that this is unchanged by this plan — pre-existing posture, not a new exposure.

### M-2. Loopback capability auth (`X-Loopback-Capability`) must be preserved
- **Source:** Codex (Medium).
- **Evidence:** `api.ts:80-91`, `socket.ts:64-73`, `happy-cli/src/daemon/daemonClient.ts:142` implement a separate loopback-capability auth flow. Plan's "make middleware no-op" wording could read as deleting this too.
- **Fix:** Explicitly state in plan: only the tunnel-claim branch is deleted; `X-Loopback-Capability` and its capability-token check are preserved.

### M-3. Simpler server implementation
- **Source:** Codex (Medium).
- **Evidence:** Plan reads as a broad middleware rewrite. Cleaner: keep the auth decorator/middleware structure; only edit the tunnel branch to set `request.userId = tofuConfig.localUserId` (and drop `accountId` from the response); then delete `requireAccountIdForTunnel`.
- **Fix:** Reframe US-001 as "tunnel branch identity collapse" not "auth no-op."

### M-4. happy-agent dist artifacts (checked-in `dist/index.*`)
- **Source:** Codex (Medium).
- **Evidence:** `packages/happy-agent` ships pre-built `dist/` files via `package.json` exports.
- **Fix:** Require regenerating dist (or exclude `dist/` from the AC grep scope).

### M-5. Acceptance criteria specificity
- **Source:** Copilot (Medium), Claude (F-008/F-009/F-014/F-015 Low).
- **Evidence:** "smoke check on BOOX" is human-only; some grep ACs span docs unscoped in the plan; `getLocalTunnelClaim` deletion conditional on a grep run "during" implementation.
- **Fix:** Mark BOOX check as manual-only; specify exact greps; do the `getLocalTunnelClaim` grep now.

### M-6. socket.spec.ts assertions on `socket.data.accountId`
- **Source:** Claude (F-011 Medium).
- **Evidence:** `socket.spec.ts:142,177` assert specific `accountId` values that no longer apply.
- **Fix:** Add explicit guidance for these test lines in the plan.

### M-7. Missing additional live references
- **Source:** Copilot (High).
- **Evidence:** `packages/happy-app/sources/app/_layout.tsx:170-197,239` (dev-only `EXPO_PUBLIC_DEV_TUNNEL_CLAIM` env), `packages/happy-app/sources/app/(app)/picker.test.tsx:92-96`.
- **Fix:** Either remove these dev-only references too, or explicitly note them as out-of-scope (dev tooling that mirrors the now-removed production path).

## Synthesis

**Recommendation: revise the plan before handoff.** The two Critical findings (C-1, C-2) would break the system mid-implementation; H-1 through H-6 are large enough that an autonomous implementer following the plan as written would either fail or produce a half-finished change with the AC grep failing.

The corrected plan should:
1. Make US-001 fully sufficient — claim verifier no-op AND `requireAccountIdForTunnel` removal AND identity substitution (`request.userId = tofuConfig.localUserId`).
2. Update `tokenStorage.ts isOldShape()` so missing `tunnelClaim` is not a drop signal.
3. Expand happy-agent scope to include `auth.ts`, `credentials.ts`, `index.ts`, plus their tests.
4. Correct the trust-model distinction: happy-agent is remote Dev-Tunnels (like the app), not loopback.
5. Add the missing server touch sites (`types.ts`, `index.ts`, `accountRoutes.ts`, `machineSelfRoutes.ts`).
6. Add the app catch sites (`apiSocket.ts`, `sync.ts`) for `DeviceCodeExpired`/`ClaimExpired`.
7. Add the broader docs sweep to scope (and CLAUDE.md across happy-agent, happy-cli, daemon).
8. Either reorder US-002 vs client cleanups or bundle them.
9. Preserve `X-Loopback-Capability` explicitly.
10. Handle happy-agent `dist/` artifacts.
