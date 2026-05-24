# F-013 — Research Brief

**Note:** The feature request points to `.ralph/jobs/devtunnels-E-cleanup/notepad.md` for the F-013 finding text and remediation. **That file does not exist in this repo.** Four independent research sources (researcher Agent, architect Agent, Codex, Copilot) reverse-engineered the bug from code and all four converge on the same diagnosis below.

---

## Convergent diagnosis (4/4 sources agree)

**F-013 root cause:** `packages/happy-cli/src/claude/utils/permissionHandler.ts` `handlePermissionResponse()` (≈ lines 86–89) directly assigns `this.permissionMode = response.mode` without calling `mapToClaudeMode()`, violating the protocol invariant documented in `packages/happy-cli/CLAUDE.md` ("Permission Mode Protocol"): the handler's internal `permissionMode` must always be a 4-mode Claude SDK value, never a 7-mode Happy wire value.

**Why "latent / non-production-reachable":**
- `PermissionResponse.mode` is currently *typed* as the narrow 4-mode `ClaudeSdkPermissionMode`.
- Today the mobile app's permission RPC sender (`packages/happy-app/sources/sync/ops.ts`) only ever sends 4-mode values, so TypeScript blocks the misuse at compile time at the app boundary.
- BUT the shared `PermissionMode` type in `packages/happy-cli/src/api/types.ts` is the wider 7-mode union, and `AgentState.completedRequests[*].mode` is typed as that wider union.
- If a 7-mode wire value (`yolo`, `safe-yolo`, `read-only`) ever reaches `response.mode` (schema drift, future wire-protocol extension, in-process test path, internal mutation, or rehydration from `completedRequests`), the handler stores it unmapped. Subsequent `handleToolCall` comparisons against SDK-only values (`'bypassPermissions'`, `'acceptEdits'`, `'plan'`) silently fail to match, so the auto-allow paths short-circuit to "ask user instead". The mode is wrong but never observed as wrong — it's a silent correctness loss, not a thrown error. This matches the "Low severity, latent, non-production-reachable" classification in `docs/operations/BOOX-TESTING-HANDOFF.md:244`.

**Contrast — the message path is correct:** `handleModeChange(mode: PermissionMode)` at line ≈ 64 *does* call `mapToClaudeMode(mode)`. So the latent bug is specifically the *response* code path, not the *message* code path.

## Researcher Findings (detail)

- `packages/happy-cli/CLAUDE.md:88–101` — "Permission Mode Protocol" section. Confirms 7-wire vs 4-SDK enum and the `mapToClaudeMode` contract.
- `packages/happy-cli/src/utils/publishPermissionMode.ts:24–49` — `publishPermissionModeIfChanged` mutates runner-local metadata before awaiting server update. **Not the bug** — already correct.
- `packages/happy-cli/src/claude/utils/permissionHandler.ts:87–89` — **F-013 latent override**: direct assignment, no mapping.
- `permissionHandler.ts:96–98` — Secondary concern: `ExitPlanMode` branch has a hardcoded allowlist `['default', 'acceptEdits', 'bypassPermissions']` that excludes `'plan'`. Worth investigating but likely intentional (don't exit plan mode by re-entering plan mode).
- `permissionHandler.ts:164–176` — Auto-allow checks compare against SDK modes; these short-circuit silently if `this.permissionMode` is an unmapped wire value.
- `permissionHandler.ts:65` — Correct mapping site (`handleModeChange`).
- `permissionMode.ts:19–26` — `mapToClaudeMode` definition. `yolo → bypassPermissions`, `safe-yolo → default`, `read-only → default`.

## Architect Analysis (detail)

The interface typing currently makes the bug latent — `PermissionResponse.mode: ClaudeSdkPermissionMode` blocks the misuse at the type level at most call sites. But:
- The mapping contract is implicit; nothing in the runtime enforces it.
- If the RPC schema or response-construction code ever drifts (a refactor merging wire and response types, a server-side schema bump, a test path that constructs a response with cast types), the bug becomes silently active.
- The fix should make the contract *explicit* at the assignment site so it survives type drift.

**Recommended fix shape** (architect's pick):
1. Widen `PermissionResponse.mode` from `ClaudeSdkPermissionMode` to the shared 7-mode `PermissionMode` so the API matches the wider wire reality.
2. In `handlePermissionResponse()`, compute `const claudeMode = response.mode ? mapToClaudeMode(response.mode) : undefined` and assign that to `this.permissionMode`.
3. In the `ExitPlanMode` branch, use the *mapped* Claude mode when deciding `newMode`.
4. If TypeScript flags it, widen `PermissionsField.mode` in `claudeRemoteLauncher.ts` to `PermissionMode` so logs preserve the raw wire mode (do not silently narrow logging types).

## Codex Research (detail)

Confirms diagnosis with the cleanest mechanical write-up:
- Widen `PermissionResponse.mode` to shared `PermissionMode`.
- Use mapped mode in both the direct response branch and the `ExitPlanMode` branch.
- Add one regression test: resolve a pending permission with `mode: 'yolo'`, assert subsequent dangerous tool call auto-allows because `yolo` mapped to `bypassPermissions`.
- Note `sessionAllowlist.ts` is **secondary** — accepts `mode?: string`, only treats `acceptEdits` specially; not the F-013 fix point.
- `publishPermissionModeIfChanged` already correct, don't touch.

## Copilot Research (detail)

Adds two important guard-rails:
- One-immediate correction to the original scope: `packages/happy-cli/src/claude/permissions.ts` does **not exist** in this repo. The real file is `packages/happy-cli/src/claude/utils/permissionMode.ts` (mapping) plus `permissionHandler.ts` (handler).
- "Be careful if widening types" — `PermissionsField.mode` in `claudeRemoteLauncher.ts` and `sdkToLogConverter.ts` currently assume the 4-mode subset. A clean fix should normalize for Claude-internal behavior **without accidentally widening unrelated logging/output types** unless that is intentional.
- Cross-package typecheck command: **the monorepo root has no obvious single root `typecheck` script.** Plan must name the exact existing commands. Likely `pnpm -r --if-present run typecheck` or per-package `pnpm --filter '{packages/happy-cli}' run typecheck`.

## Consolidated File List

### Files to modify (fix implementation)
- `packages/happy-cli/src/claude/utils/permissionHandler.ts` — fix `handlePermissionResponse()` assignment + `ExitPlanMode` branch; widen `PermissionResponse.mode` type
- `packages/happy-cli/src/claude/utils/permissionHandler.test.ts` — add regression test for the previously-latent path

### Files possibly affected (downstream type ripple — verify with typecheck)
- `packages/happy-cli/src/claude/claudeRemoteLauncher.ts` — `PermissionsField.mode` typing
- `packages/happy-cli/src/claude/utils/sdkToLogConverter.ts` — if it consumes `response.mode`

### Files for reference (read only — do not edit)
- `packages/happy-cli/CLAUDE.md` — Permission Mode Protocol section (canonical contract)
- `packages/happy-cli/src/claude/utils/permissionMode.ts` — `mapToClaudeMode`
- `packages/happy-cli/src/api/types.ts` — `PermissionMode` (7-mode union), `AgentState.completedRequests`
- `packages/happy-cli/src/claude/sdk/types.ts` — `ClaudeSdkPermissionMode`
- `packages/happy-cli/src/claude/utils/sessionAllowlist.ts` — secondary; understand `acceptEdits` interaction
- `packages/happy-cli/src/utils/publishPermissionMode.ts` — already correct; understand offline-reconnect contract
- `packages/happy-cli/src/claude/runClaude.ts` — mode flow in loop (94–102, 396–423, 458–469)
- `packages/happy-cli/src/claude/claudeRemote.ts:204` — SDK QueryOptions construction

### Test infrastructure
- Runner: **Vitest**, run via `pnpm --filter '{packages/happy-cli}' exec vitest run`
- Existing permission tests: `permissionMode.test.ts`, `permissionHandler.test.ts`, `sessionAllowlist.test.ts`, `runClaudePublishMode.test.ts`, `setupOfflineReconnection.permissionMode.test.ts`
- Test style: `describe`/`it` blocks, helper functions like `createStubSession()`, `callTool()`, `expectPending()` already in `permissionHandler.test.ts`. New test belongs in same file.

### Docs to update as part of plan
- **None strictly required.** `CLAUDE.md` already documents the protocol invariant the fix enforces. Could optionally update `docs/fork-roadmap.md` or `plans/codexu-roadmap.md` (which currently list F-013 as deferred/open) and `docs/operations/BOOX-TESTING-HANDOFF.md:244` to close out the F-013 entry after fix lands. Defer that to the operator — the polish PR rollup may want a single doc-update commit.

## Open Questions for the operator (from missing notepad)

1. **Severity confirmation.** Notepad would have said exactly *what triggered* the F-013 review-time finding. Was it a real production trace? A code-review observation? Or a test that exercises this path? The convergent code analysis says it is reachable only via wire-protocol or schema drift today, but if the notepad has a more specific reproduction, that should drive the test design.
2. **Scope discipline.** Should the plan touch only the response path (minimal fix per "Low severity, quick polish commit" from `BOOX-TESTING-HANDOFF.md:244`), or also tighten the `ExitPlanMode` allowlist at `permissionHandler.ts:96–98` (`'plan'` excluded)?
3. **Documentation closeout.** Should the single commit also update `docs/fork-roadmap.md` / `plans/codexu-roadmap.md` / `BOOX-TESTING-HANDOFF.md` to mark F-013 closed? Or hold that for a doc-only commit in the polish PR rollup (per the parallel-assignments.md model)?
4. **Typecheck command.** Copilot flagged that no root `typecheck` script exists. Confirm the operator's expected cross-package typecheck command (likely `pnpm -r --if-present run typecheck` or `pnpm typecheck` if added to root).
