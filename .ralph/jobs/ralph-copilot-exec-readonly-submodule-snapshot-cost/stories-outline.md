# Stories Outline: Copilot Read-Only Submodule Snapshot Fast Path

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Harden nested repo discovery and snapshot shape
**Description:** As a Ralph planner, I want initialized nested repos discovered as a complete de-duplicated forest so the read-only guard can protect all submodules without duplicate capture.
**Acceptance Criteria:**
- [ ] `findNestedRepoRoots()` returns each initialized nested repo exactly once across a parent -> submodule -> child-submodule fixture.
- [ ] Parent capture skips child repo roots while child snapshots protect their own contents.
- [ ] Existing parent-tree snapshot behavior remains unchanged.
- [ ] Typecheck/tests pass.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Restore nested repos through git metadata with dirty spill
**Description:** As a Ralph user, I want nested repo writes reverted from git metadata and dirty spills so clean files do not consume heap and operator WIP survives exactly.
**Acceptance Criteria:**
- [ ] Clean tracked nested files restore from nested HEAD/index blobs, not pre-run Buffers.
- [ ] Dirty-unstaged, staged, partially-staged, staged deletion, rename, mode-bit, untracked, and dirty binary nested files are restored byte-for-byte and with index state unchanged.
- [ ] Index-only and mode-only mutations are detected and reverted even when file bytes are unchanged.
- [ ] Nested child submodules are protected independently of their parent submodule.
- [ ] Typecheck/tests pass.
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Add fail-closed budget and no-whole-tree instrumentation
**Description:** As a Ralph maintainer, I want snapshot capture to fail closed before child launch when dirty/untracked capture exceeds safe limits, with deterministic proof that clean submodule trees are not byte-read.
**Acceptance Criteria:**
- [ ] Capture budgets reserve file count and bytes before reading or streaming content.
- [ ] Large or binary dirty/untracked content spills outside the protected cwd without whole-file heap allocation.
- [ ] Budget exceed throws a dedicated error before a partial snapshot can be used.
- [ ] Spill files are cleaned on clean run, violation revert, signal revert, and budget failure.
- [ ] Tests include a deterministic read-spy/test hook that fails if clean tracked large-submodule files are byte-read.
- [ ] Typecheck/tests pass.
**Dependencies:** US-001, US-002
**Estimated complexity:** medium

## US-004: Re-enable Copilot read-only guard and integration tests
**Description:** As a Ralph user, I want `copilot-exec.mjs --read-only` to again revert out-of-zone shell writes while avoiding the previous initialized-submodule OOM.
**Acceptance Criteria:**
- [ ] `READONLY_SNAPSHOT_ENABLED` is re-enabled.
- [ ] Budget errors are caught narrowly around `captureSnapshot()` before `runCopilot()`.
- [ ] Budget exceed emits a distinct sentinel/diagnostic, returns a distinct non-zero status, and does not spawn the Copilot child.
- [ ] Existing skipped read-only guard tests are re-enabled or replaced by equivalent active tests.
- [ ] A child write inside both ai-developer-toolkit-like and codex-like initialized submodules is reverted and reported as exit 3.
- [ ] Typecheck/tests pass.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** medium

## US-005: Update release metadata and gates
**Description:** As a plugin consumer, I want the shipped ralph version and marketplace metadata to accurately reflect the restored read-only guard behavior across Claude, Copilot, and Codex installs.
**Acceptance Criteria:**
- [ ] `plugins/ralph/CHANGELOG.md` and `plugins/ralph/AGENTS.md` document the behavior.
- [ ] The three ralph plugin manifests and three marketplace indexes have synchronized version stamps.
- [ ] Copilot and Codex generated-artifact release gates pass.
- [ ] Ralph tests are run with output saved to the job directory; any pre-existing environmental failures are explicitly documented.
**Dependencies:** US-004
**Estimated complexity:** small
