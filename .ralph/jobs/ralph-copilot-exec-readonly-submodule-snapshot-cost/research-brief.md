# Research Brief: ralph-copilot-exec-readonly-submodule-snapshot-cost

## Researcher Findings
- Brainstorm selected D-001: per-submodule git fast-path plus `findNestedRepoRoots` de-dup/boundary stop and a fail-closed budget, while preserving whole-cwd read-only protection. Source seed: `.ralph/brainstorms/ralph-copilot-exec-readonly-submodule-snapshot-cost/selected-direction.md`.
- Current expensive path is `plugins/ralph/src/worktree-snapshot.mjs`: `captureManifest()` byte-reads every file in nested repos; `findNestedRepoRoots()` performs a blind DFS; `captureSnapshot()` uses the parent git fast-path and then falls back to byte manifests for initialized nested repos; `revertOutsideZone()` restores nested repos via manifest replay, not index-aware git restore.
- Current read-only guard wiring is `plugins/ralph/src/copilot-exec.mjs`: `READONLY_SNAPSHOT_ENABLED = false` hard-disables snapshot capture before launching the Copilot child. Re-enable depends on making `captureSnapshot()` cheap and safe for initialized submodules.
- Existing test coverage lives mostly in `plugins/ralph/tests/test-worktree-snapshot.mjs` and `plugins/ralph/tests/test-copilot-readonly-guard.mjs`. The latter has guard tests skipped while the snapshot guard is disabled.
- Ralph release convention: update `plugins/ralph/CHANGELOG.md`, plugin AGENTS release notes, all three plugin manifests, and all three marketplace indexes. Current ralph version is `5.59.0`.

## Architect Analysis
- Main integration point: `plugins/ralph/src/copilot-exec.mjs` should keep the existing child invocation and sentinel contract, but re-enable snapshot capture only after `worktree-snapshot.mjs` stops byte-reading clean nested-repo trees.
- Core hotspot: `plugins/ralph/src/worktree-snapshot.mjs`. Parent-tree capture already has the desired model: `git ls-files -z`, `git ls-files --stage -z`, `git status --porcelain=v1 -z -uall`, and byte capture only for dirty/untracked pre-run paths. Nested repos should reuse the same model with their own cwd/root.
- The hard part is nested repo restore fidelity. The parent path preserves the exact pre-run index entry with `restoreIndexEntry()`; nested repos need equivalent index replay for staged, partially staged, staged deletion, rename, and mode-bit cases.
- `git status -uall` intentionally does not report ignored files; the plan should make ignored nested-repo files explicitly out of scope rather than accidentally narrowing the contract.
- Fail-closed budgeting must abort before the Copilot child launch. A soft skip would silently under-protect a later submodule after an earlier large tree consumes the budget.

## Codex Research
Not run in this plan member. The in-process researcher and architect covered the relevant source seams, and the brainstorm already included codex/copilot/devils-advocate lenses.

## Copilot Research
Not run in this plan member. The in-process researcher and architect covered the relevant source seams, and the brainstorm already included codex/copilot/devils-advocate lenses.

## Consolidated File List

### Files to modify
- `plugins/ralph/src/worktree-snapshot.mjs` - nested repo discovery, per-nested git snapshot, dirty/untracked spill, resource budget, nested restore.
- `plugins/ralph/src/copilot-exec.mjs` - re-enable the read-only snapshot guard and surface budget-exceeded diagnostics.
- `plugins/ralph/tests/test-worktree-snapshot.mjs` - nested repo/submodule fidelity and no-whole-tree-byte-capture tests.
- `plugins/ralph/tests/test-copilot-readonly-guard.mjs` - unskip guard tests, add budget-before-child and nested-submodule integration coverage.
- `plugins/ralph/CHANGELOG.md` and `plugins/ralph/AGENTS.md` - release notes for the new behavior.
- `plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.github/plugin/plugin.json`, `plugins/ralph/.codex-plugin/plugin.json` - ralph version stamp bump.
- `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json` - marketplace version stamp bump.

### Tests and release gates
- `node plugins/ralph/tests/run.mjs` with output saved under the job directory.
- `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check`
- `node plugins/ralph/scripts/check-copilot-parity.mjs`
- `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=codex --check`
- `node plugins/ralph/tests/test-codex-generator.mjs`
- `node tools/validate-codex-marketplace-policy.mjs`
