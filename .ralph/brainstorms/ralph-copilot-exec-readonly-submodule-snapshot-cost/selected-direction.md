---
overviewTaskId: ralph-copilot-exec-readonly-submodule-snapshot-cost
---

## Direction
D-001 — Per-submodule git fast-path for nested repos (+ `findNestedRepoRoots` de-dup), plus a fail-closed resource budget as defense-in-depth. Each initialized submodule is snapshotted the same cheap way the parent tree already is (its own `git` status/index fast-path), so clean files are restored from HEAD/index instead of being byte-read into the heap — eliminating the captureManifest memory blowup while preserving the out-of-zone revert guarantee for the `ai-developer-toolkit/` plugin-edit zone.

## Goal
After this lands, two concurrent Copilot read-only lenses (each a multi-lens brainstorm spawning a Copilot child under `ralph-orchestration copilot-exec --read-only`) run in a codexu checkout with both submodules initialized (`codex/` multi-GB Rust + `ai-developer-toolkit/`) **without** exhausting memory, because `captureSnapshot`/`captureManifest` no longer `readFileSync`s every clean tracked file of each submodule tree into a `Map<rel,{bytes:Buffer}>`. The revert guard still fully protects the whole cwd: any out-of-zone write a read-only child makes anywhere under cwd — including inside an initialized submodule such as `ai-developer-toolkit/` — is still detected and reverted byte-for-byte to its pre-run state, and the violation still surfaces (exit 3). Pre-existing operator WIP (dirty-unstaged, staged, partially-staged, untracked) inside a submodule survives the snapshot/revert cycle byte-for-byte and with its index state intact.

## Scope

### In Scope
- **Per-submodule git fast-path in the nested-repo branch of the guard.** In `worktree-snapshot.mjs`, change the nested-repo handling so each initialized submodule discovered by `findNestedRepoRoots` (L311) is snapshotted via its OWN git fast-path — `git ls-files -z` / `ls-files --stage -z` / `status --porcelain -z -uall` rooted at the submodule — mirroring the parent-tree path in `captureSnapshot` (L337, L363, L370). Clean tracked files are restored at revert from the submodule's HEAD/index blobs (not held in heap); only **pre-existing dirty + untracked** files are byte-captured (`readFileSync`, today at L196/L301).
- **`findNestedRepoRoots` de-dup / boundary stop.** Stop descending once a `.git` boundary is found (or de-dup discovered roots) so nested-within-nested repos (e.g. under `codex/external/repos/...`) are not byte-read twice.
- **Whole-cwd protection contract preserved.** The guard continues to protect ANY initialized nested repo under cwd, not just the declared plugin-edit zone. This is the deliberate distinction from the rejected D-002 (skip-by-policy), which the Devil's Advocate lens red-flagged as a skip-the-wrong-submodule regression.
- **Index / restore fidelity for nested repos.** Restoration must be exact for the same cases the main tree already handles (L366–374, L576): clean, dirty-unstaged, staged, partially-staged, staged-deletion, rename, and mode-bit. A pre-existing dirty BINARY in a submodule is still spilled/byte-captured so its exact pre-run bytes (which may not exist in the object DB) can be written back.
- **Fail-closed resource budget (defense-in-depth backstop).** A total-bytes / file-count cap that **fails closed**: it aborts BEFORE the Copilot child is launched and emits a DISTINCT diagnostic, rather than silently logging-and-skipping the rest of the tree (silent under-protection — e.g. `codex/` consuming the budget before `ai-developer-toolkit/` is captured). Layered onto D-001, not a standalone fix.
- **Regression coverage.** A fixture parent repo with two submodules (a clean large `codex`-like repo + an `ai-developer-toolkit`-like target) seeded with clean / dirty-unstaged / partially-staged / untracked / deleted files; a stub read-only child that writes out-of-zone into each; assert exit 3 + exact byte/index restoration + that the clean large submodule is NOT fully Buffer-captured (peak-memory / no-whole-tree-read assertion).

### Out of Scope
- **D-002 (protected-zone scoping / skip `codex/` by policy)** — rejected: removes whole-cwd protection; regression risk.
- **D-004 (disposable read-only lens workspace)** — noted as the strongest LONGER-TERM architectural reframe and a candidate FOLLOW-UP, but not chosen now (larger scope; "lens may need initialized submodule contents" risk). Do not build it in this task.
- **D-003 (hash-only detection)** as a standalone strategy — its only durable part (spill pre-run dirty bytes for binaries) is already absorbed into D-001's dirty-file handling.
- Reworking the main-tree (non-submodule) fast-path, which already only byte-reads dirty files.

## Criteria
- With both codexu submodules initialized, two concurrent `copilot-exec --read-only` runs complete without OOM / member death; peak heap is bounded by dirty+untracked bytes, not total tracked-tree size. (Reproduces and fixes the 2026-06-06 resource-exhaustion deaths.)
- A read-only child that writes to a previously-clean tracked file inside `ai-developer-toolkit/` is reverted byte-for-byte and the run exits 3 (the 2026-05-28 16-file-edit incident class stays protected).
- A read-only child that writes to a clean tracked file inside `codex/` (any non-zone initialized submodule) is ALSO reverted and flagged — whole-cwd contract holds.
- Pre-existing dirty-unstaged, staged, partially-staged, untracked, and renamed/mode-bit-changed files inside a submodule are unchanged byte-for-byte AND index-state-identical after a snapshot/revert cycle (including when the child mutates them).
- The clean large submodule is not fully read into memory: a no-whole-tree-Buffer assertion (or peak-memory bound) passes in the regression fixture.
- The fail-closed resource budget, when exceeded, aborts BEFORE child launch and emits a distinct diagnostic (asserted) — never a silent partial snapshot.
- The ralph-orchestration node test suite is green (Git Bash first on PATH for the bash-stub tests; the two environmental failures — `test-parse-not-tested-trailers` needing sha256sum/shasum, and the 3 host-path/submodule-worktree cases in `test-regression-smoke-phase-4` — are pre-existing and out of scope).

## Context

**Verified problem (Phase 1).** `copilot-exec.mjs --read-only` calls `captureSnapshot(cwd)` (`worktree-snapshot.mjs` L337). The main tree uses a cheap `git status` fast-path (only dirty files byte-read), but `findNestedRepoRoots` (L311) discovers each initialized submodule and feeds it to `captureManifest` (L267), which `readFileSync`s EVERY non-zone file into a `Map<rel,{bytes:Buffer}>` held for the whole run, then re-walks at revert (L196/L301 confirmed in the installed plugin). In codexu the submodules are `codex/` (multi-GB Rust) + `ai-developer-toolkit/` (the plugin-edit zone). Two concurrent Copilot read-only lenses exhaust memory → the 2026-06-06 member deaths. The Codex lens (no snapshot guard) stayed healthy; a partial brainstorm skipping the Copilot lens succeeded.

**Hard correctness constraint (all three lenses agree).** The guard exists because a 2026-05-28 read-only review edited 16 files under `ai-developer-toolkit/`, and the parent `git status` only sees the gitlink, not inner files. Any fix that simply stops looking inside `ai-developer-toolkit/` removes the safety property — a regression, not an optimization. D-001 keeps looking; it just stops *byte-reading clean files*.

**Live empirical note.** This brainstorm's own Copilot read-only lens ran clean from a worktree with UNINITIALIZED submodules → `findNestedRepoRoots` found nothing → no manifest blowup. This confirms the cost is gated on submodule-init state and is exactly what D-001 neutralizes (and what D-004 would generalize).

**Lens consensus.** D-001 is endorsed by all three lenses (codex, copilot, devils-advocate) as the *safe* primary fix — the only direction that eliminates the clean-file byte blowup while preserving the guard's core guarantee, and it includes the cheap `findNestedRepoRoots` de-dup.

**Disconfirming observation to watch in planning.** A nested repo with pre-existing dirty/staged/untracked content cannot be restored byte-for-byte from the git-status snapshot model alone → the dirty-byte spill/capture path is mandatory (not optional). If planning finds the index-fidelity restore for partially-staged/renamed nested-repo files is materially harder than the main tree's, re-surface to the operator.

**Open questions carried forward (fold into planning; recommended defaults noted):**
1. **Contract — whole cwd vs known high-risk edit zones.** DECIDED for this task: keep WHOLE-cwd protection (protect every initialized nested repo). This is what makes D-001 ≠ D-002. Planning should not silently narrow it.
2. **Gitignored files inside submodules.** `git status -uall` does NOT see gitignored files, whereas today's `captureManifest` byte-reads them — so a naive D-001 NARROWS ignored-file coverage. This must be an EXPLICIT contract decision, not an accident. Recommended default: gitignored files inside submodules are OUT of the revert guard's restoration scope (a read-only lens creating/altering a gitignored artifact is low-risk and outside the 16-file-edit incident class), BUT planning must confirm with the operator and add an acceptance criterion stating the chosen behavior so the narrowing is intentional and tested.
3. **Fail-closed resource budget.** Include as defense-in-depth (above). Open sub-decision for planning: the concrete cap values (total bytes / file count) and whether the cap is configurable vs a fixed conservative constant.
4. **0-byte-output + exit-3 robustness sub-issue (related, orthogonal to heap).** `openSync(--output,"w")` truncates the output to 0 bytes BEFORE snapshot/child; a killed/empty child can leave a 0-byte output, and the violation contract emits exit 3 only via the stderr sentinel. Memory exhaustion makes this more likely but does not cause it. Recommended default: SPLIT it out into its own follow-up task unless the fix (write a diagnostic body / distinct status sidecar) turns out trivial enough to ride along; planning decides and records the split explicitly.
