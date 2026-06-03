# Stories Outline: ralph-orchestration v5.49 spawn-and-ship UX bundle

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: `--target-repo` override flag for `/implement-with-ralph`

**Description:** As a bookkeeper-lead, I want a `--target-repo <path>` spawn-time override flag on `/implement-with-ralph` so I can force the target repo when (a) the plan touches both wrapper + submodule files and the plan-analysis Explore agent picks wrong, (b) the task is submodule-only and the agent would otherwise fall back to cwd, or (c) I want to fix an issue in a sibling repo not declared in any prd.json — without paying the ~30s plan-analysis cost.

**Acceptance Criteria:**
- [ ] AC-001: `plugins/ralph/skills/implement-with-ralph/SKILL.md` Phase 1 documents `--target-repo <path>` with description, validation contract (`git -C "$path" rev-parse --show-toplevel`), and fail-fast error wording.
- [ ] AC-002: Phase 2 wires `--target-repo` through to `convert-to-ralph-prd` (verified by `grep "convert-to-ralph-prd .*--target-repo"`).
- [ ] AC-003: `plugins/ralph/skills/convert-to-ralph-prd/SKILL.md` Step 1 has an override branch BEFORE the existing Explore-agent block (validates, stores `target_repo`, skips Explore). Fallback (no flag) preserves Explore flow byte-for-byte.
- [ ] AC-004: `convert-to-ralph-prd` batch flag list lists `--target-repo`; override branch works in BOTH interactive and batch modes; captured `git rev-parse` stdout is normalized via `path-utils.mjs` and stored as canonical `target_repo` (not raw user arg).
- [ ] AC-005: `worktree-create.mjs` help text mentions `--target-repo` can be wrapper / submodule / sibling. No behavioral change.
- [ ] AC-006: `plugins/ralph/AGENTS.md` v5.49.0 Behavioral Additions section documents `--target-repo` semantics, precedence over plan-analysis, and when to use.
- [ ] AC-007: New `plugins/ralph/tests/test-target-repo-override.mjs` exists, auto-discovered by `tests/run.mjs`, three `node:test` cases pass at case-level (`node --test ...` shows `ok 1`, `ok 2`, `ok 3`).
- [ ] AC-008: `scripts/generate-copilot-artifacts.mjs --check` and `scripts/check-copilot-parity.mjs` both exit 0.
- [ ] AC-009: Typecheck passes (`node plugins/ralph/tests/run.mjs` exits 0).
- [ ] AC-010: Tests pass (same gate as AC-009).
- [ ] AC-020: `/implement-with-ralph` rejects `--parallel --target-repo` combination up-front with documented error before invoking `decompose-plan`.

**Dependencies:** None.
**Estimated complexity:** medium.

## US-002: Multi-repo wrapper-to-submodule ship ceremony docs (Phase a only)

**Description:** As a bookkeeper-lead, I want the 7-step submodule-ship ceremony documented in `plugins/ralph/AGENTS.md` with repo-agnostic placeholders, plus a Phase 6 lead-handoff prose block in `implement-with-ralph/SKILL.md` that triggers when `prd.json.repoDir` is a submodule of my wrapper — so I (and any future bookkeeper on a different wrapper repo) don't have to re-derive the ceremony from scratch each ship.

**Acceptance Criteria:**
- [ ] AC-011: `plugins/ralph/AGENTS.md` has a new "Multi-repo wrapper-to-submodule ship ceremony" subsection with all 7 steps + placeholders (`<wrapper-repo>`, `<submodule>`, `<submodule-remotes>`, `<submodule-main>`, `<wrapper-main>`, `<consumer-machine>`). NO codexu-specific repo names appear.
- [ ] AC-012: `implement-with-ralph/SKILL.md` Phase 6 has "Lead handoff for submodule ship" block running BEFORE terminal write. Wrapper root derived from `<job_dir>/<group_dir>` parent (NOT from `repo_root` — F-001 fix); validates wrapper is a git repo; runs `git -C <wrapper_root> submodule status -- <relative>`. On non-empty + exit 0, echoes prose to stdout AND appends to `<job_dir>/progress.txt` (NOT crews kind=done — that's a separate layer).
- [ ] AC-013: Codexu's root `AGENTS.md` has single backlink line within 20 lines of "Always push main to ALL configured remotes after every merge" bullet, explicitly mentioning both "ceremony" and "canonical".
- [ ] AC-014: No duplication of existing submodule guidance (manual reviewer check; Phase 5b docs-review gate).
- [ ] AC-015: Copilot hand-fork mirror of `implement-with-ralph/SKILL.md` Phase 6 hand-mirrored and parity-checked (covered by AC-008's `check-copilot-parity.mjs`).

**Dependencies:** US-001 (shared file overlap on `plugins/ralph/AGENTS.md` and `plugins/ralph/skills/implement-with-ralph/SKILL.md`).
**Estimated complexity:** small (docs-only; no code, no tests).

## Bundle-level shared

- [ ] AC-016: Version bump `5.47.0` → `5.49.0` across 5 toolkit stamps + codexu's active-plugin-versions table (1 line in `<wrapper>/AGENTS.md`).
- [ ] AC-017: `plugins/ralph/CHANGELOG.md` has v5.49.0 entry covering both stories.
- [ ] AC-018: Phase 5a + 5b convergence both reach `clean` before merge (per codexu AGENTS.md spawn-prompt invariant).
- [ ] AC-019: `bash plugins/ralph/tests/test-submodule-worktree-init.sh` exits 0.

## Implementation order

Serial: US-001 → US-002 (shared-file overlap on `AGENTS.md` + `implement-with-ralph/SKILL.md` prevents safe parallelization). See `suggested-decomposition.json` for the cluster definition.
