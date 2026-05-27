# Stories Outline: session-parent-link-writer

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Wire forkSession to populate parent/child metadata fields

**Description:** As a daemon process forking a Codex session into a worktree, I want the new child to carry `metadata.parentSessionId` and the parent to carry the new child's composite sid in `metadata.spawnedChildren`, so that the session-parent-link read helpers (`getSessionParent`, `getSessionChildren`) work for fork-into-worktree the same way they already work for `spawn-session-from-session`.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/daemon/forkSession.ts`'s `ForkSessionDeps` gains `machineId: string` and `updateParentMetadata: (parentLocalId, tracked, patchFn) => Promise<void>` (matching `spawnSessionFromSession.ts`'s deps shape). Existing `findTrackedSessionById` is reused for the `getTrackedSession` callback that `validateSpawnAncestry` accepts.
- [ ] `forkSession` calls `validateSpawnAncestry(parentSessionId, deps.machineId, deps.findTrackedSessionById)` AFTER the server-metadata refresh (around current line 92) and BEFORE the worktree stat (around current line 98). On ancestry error, returns the ancestry error result directly.
- [ ] `forkSession` sets `env[HAPPY_PARENT_SESSION_ID] = ${deps.machineId}:${parentSessionId}` on the child spawn env, alongside the existing `env[HAPPY_FORKED_FROM_SESSION_ID] = parentSessionId`.
- [ ] After `spawnTrackedHappyProcess` returns `{ type: 'success' }`, `forkSession` awaits `deps.updateParentMetadata(parentSessionId, tracked, m => appendSpawnedChild(m, ${deps.machineId}:${result.sessionId}))` WITHOUT a try-catch around the await. Failures propagate through the function's outer try-catch (lines 184-191) → RPC error response. (Matches `spawnSessionFromSession.ts:143-144` semantics exactly.)
- [ ] `appendSpawnedChild` and `validateSpawnAncestry` are imported from `./spawnSessionFromSession`; no new helper is introduced.
- [ ] `packages/happy-cli/src/daemon/run.ts` injects `machineId` and `updateParentMetadata` into `forkSession`'s deps. The `updateParentMetadata` variable already exists at line 902 (`createSpawnFromSessionMetadataUpdater(api)`) for `spawnSessionFromSession`; reuse it (the same variable) — do not invoke the factory a second time.
- [ ] `pnpm --filter happy-cli typecheck` exits 0.
- [ ] `pnpm --filter happy-app typecheck` exits 0.

**Dependencies:** None

**Estimated complexity:** small

---

## US-002: Extend forkSession.test.ts to cover the new behavior

**Description:** As a maintainer, I want unit tests that lock in the new parent/child wiring, the strict pre-spawn ancestry-validation ordering, the propagate-on-throw semantics, and parity with `spawnSessionFromSession.test.ts`'s depth-cap pattern.

**Acceptance Criteria:**
- [ ] Existing assertions remain valid (e.g., `expect(launch.env[HAPPY_FORKED_FROM_SESSION_ID]).toBe('parent-local-id')` at lines 95 and 274 — unchanged).
- [ ] NEW: every body that today asserts on `launch.env[HAPPY_FORKED_FROM_SESSION_ID]` ALSO asserts `launch.env[HAPPY_PARENT_SESSION_ID]` equals `${machineId}:${parentLocalId}`.
- [ ] NEW: success path — `updateParentMetadata` is called exactly once with the parent local id and a patch fn; exercising the patch fn against a small metadata fixture produces the appended composite sid.
- [ ] NEW: spawn-error path — when `spawnTrackedHappyProcess` returns `{ type: 'error', errorMessage: 'x' }`, `updateParentMetadata` is NOT called.
- [ ] NEW: approval-request path (defensive) — when `spawnTrackedHappyProcess` returns `{ type: 'requestToApproveDirectoryCreation' }`, `updateParentMetadata` is NOT called. (This branch isn't expected to fire in fork-into-worktree today; assertion documents the invariant.)
- [ ] NEW: ancestry-rejection — construct a chain at depth `MAX_SPAWN_DEPTH` (mirror `spawnSessionFromSession.test.ts:186`'s `ancestryLinks('machine-1', MAX_SPAWN_DEPTH)` helper pattern); attempt to fork at the leaf; assert error result AND no call to `spawnTrackedHappyProcess` / `runGit` / `realpath` / `stat` / `updateParentMetadata`.
- [ ] NEW: ancestry-passes-at-depth-(MAX_SPAWN_DEPTH-1) — mirror `spawnSessionFromSession.test.ts:167`.
- [ ] NEW: updateParentMetadata-throws → forkSession returns `{ type: 'error', errorMessage starts with 'Failed to fork session: ' }`. Assert no SUCCESS leaks to caller.
- [ ] `pnpm --filter happy-cli exec vitest run packages/happy-cli/src/daemon/forkSession.test.ts` exits 0.

**Dependencies:** US-001

**Estimated complexity:** small

---

## US-003: Update happy-cli CLAUDE.md "Codex fork-into-worktree RPC" section

**Description:** As a future agent reading the daemon's documented invariants, I want the CLAUDE.md section on fork-into-worktree to reflect the new writer behavior so that I don't reintroduce the gap or write conflicting code.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/CLAUDE.md` — under the "Codex fork-into-worktree RPC" paragraph, add a sentence noting that the daemon also writes `HAPPY_PARENT_SESSION_ID = <parentCompositeSid>` on child env AND appends the child's composite sid to the parent's `metadata.spawnedChildren` via the same `createSpawnFromSessionMetadataUpdater` factory used by `spawnSessionFromSession`. Note that `HAPPY_FORKED_FROM_SESSION_ID` (bare) and `HAPPY_PARENT_SESSION_ID` (composite) coexist on a fork.
- [ ] Reaffirm `MAX_SPAWN_DEPTH = 10` invariant applies to forks identically (mention `validateSpawnAncestry` is called pre-spawn).
- [ ] No other doc files need changes (`packages/happy-app/CLAUDE.md` already documents the read-side invariants and does not change behavior here).

**Dependencies:** US-001

**Estimated complexity:** small

---

## US-004: Commit and push on topic branch off origin/main

**Description:** As an operator integrating this change, I want a clean, single-commit topic branch ready for cherry-pick / merge so that the change history stays readable.

**Acceptance Criteria:**
- [ ] Worktree at `D:/harness-efforts/codexu/.worktrees/session-parent-link-writer/`.
- [ ] Topic branch `ralph/session-parent-link-writer` off `origin/main`.
- [ ] Single commit message follows the existing commit-style. Body references this plan (`.ralph/jobs/session-parent-link-writer/plan.md`) and the read-side landing (`commit 11c3eafb`).
- [ ] `git push -u origin ralph/session-parent-link-writer` succeeds.
- [ ] After push, the implementer reports the commit SHA + branch and surfaces for merge.

**Dependencies:** US-001, US-002, US-003

**Estimated complexity:** small
