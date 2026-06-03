# Stories Outline: ralph-orchestration-worktree-conditional-submodule-init

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Add CLI flags + helpers to `worktree-create.mjs`

**Description:** As a Ralph plugin maintainer, I want `worktree-create.mjs` to accept `--no-submodule-init` (negative-form CLI skip) and `--require-submodule-init` (positive-form impl-side override) flags plus a `RALPH_NO_SUBMODULE_INIT` env var so plan-with-ralph can default-skip submodule init while impl callers (`convert-to-ralph-prd` Step 5) can force init regardless of operator env vars.

**Acceptance Criteria:**
- [ ] `parseArgs` accepts `--no-submodule-init` and `--require-submodule-init` (both boolean, default false). Unknown-arg error continues to fire for typos.
- [ ] Module-level helpers `parseTruthyEnv(value)` and `shouldSkipSubmoduleInit(opts, env = process.env)` exist; precedence is require > no > env > default.
- [ ] `runSubmoduleInit(worktreePath, io, opts = {})` early-returns `false` with a single-line stderr `Skipping submodule init for ...` BEFORE `mkdirSync(lockParent, ...)` at line 267 when `shouldSkipSubmoduleInit(opts)` is true.
- [ ] Reuse-path call (worktree-create.mjs line 88) threads `opts`; `finishResult` signature accepts `opts` and threads it; both fresh-create call sites (lines 108, 113) pass `opts`.
- [ ] `helpText` documents both flags + the env var + the precedence rule. Success-JSON example comment mentions `submoduleInitRan` may be `false` when skipped.
- [ ] Typecheck passes (`node --check ai-developer-toolkit/plugins/ralph/src/worktree-create.mjs` or equivalent ESM parse).
- [ ] Lint passes (no new warnings; the file has no eslint config locally — adhere to existing style).
**Dependencies:** None
**Estimated complexity:** small

## US-002: Add node test cases to `tests/worktree-create.test.mjs`

**Description:** As a plugin maintainer, I want 7 new `node:test` cases asserting both flag-only / env-only / flag+env / default behaviors, the reuse-path skip, and the positive-form override's env immunity so the helper's behavior is locked under all signal combinations.

**Acceptance Criteria:**
- [ ] `beforeEach`/`afterEach` capture-and-restore `process.env.RALPH_NO_SUBMODULE_INIT` (and any other env var the helper reads) so inherited shell env does not bleed in.
- [ ] Fixture helper builds a temp super-repo + temp file-protocol submodule-origin, adds submodule at `external/test-submodule` with `git -c protocol.file.allow=always submodule add`, then `git -C <super-repo> config protocol.file.allow always` so the policy is inherited by helper invocations.
- [ ] Per-test temp `HOME`/`USERPROFILE` override so `~/.cache/ralph-orchestration` lock paths are isolated per test.
- [ ] Cases (a)-(g) all pass: flag-only, env-only (3 truthy variants + 1 falsy regression), flag+env, default unchanged, reuse-path observes skip, `--require-submodule-init` overrides env, `--require-submodule-init` overrides `--no-submodule-init`.
- [ ] `node --test ai-developer-toolkit/plugins/ralph/tests/worktree-create.test.mjs` exits 0 with at least 12 total assertions across the new cases.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Add bash test cases to `tests/test-submodule-worktree-init.sh`

**Description:** As a plugin maintainer, I want 7 new bash behavioral test cases that invoke `worktree-create.mjs` against a fixture super-repo with a declared file-protocol submodule so the CLI path is exercised end-to-end on Git Bash on Windows.

**Acceptance Criteria:**
- [ ] Fixture setup configures `git -C <super-repo> config protocol.file.allow always` so worktree-create.mjs's plain `git submodule update` invocation succeeds against the local file-protocol fixture.
- [ ] Per-test temp `HOME` env-override so the lock-parent dir is isolated.
- [ ] Tests assert via text-grep on JSON output (`grep -q '"submoduleInitRan"[[:space:]]*:[[:space:]]*false'`); NO `jq` calls per the v5.46.0 prerequisite-removal contract.
- [ ] Mtime-based lock-parent skip assertion uses `stat -c '%Y'` (available in Git Bash on Windows).
- [ ] All 7 new sections pass: flag-only, env-only (3 truthy variants + 1 falsy), flag+env, default unchanged, reuse-path, `--require-submodule-init` overrides env, `--require-submodule-init` overrides `--no-submodule-init`.
- [ ] Pre-existing source-contract greps still pass (no breakage of v5.42.0 / v5.46.0 assertions).
- [ ] `bash ai-developer-toolkit/plugins/ralph/tests/test-submodule-worktree-init.sh` exits 0.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-004: Wire flags into plan-with-ralph + convert-to-ralph-prd + regenerate Copilot mirrors

**Description:** As a Ralph operator, I want plan-with-ralph Phase 1B to default to `--no-submodule-init` (with `/plan-with-ralph --init-submodules` as the opt-out) AND convert-to-ralph-prd Step 5 to pass `--require-submodule-init` so plan-phase wins on submodule init time while impl-phase stays safe.

**Acceptance Criteria:**
- [ ] `skills/plan-with-ralph/SKILL.md` Phase 1 arg-parsing list documents new `--init-submodules` boolean flag (no-list-arg variant; differs from the future helper-CLI `--init-submodules <list>` deferred to D-002).
- [ ] `skills/plan-with-ralph/SKILL.md` Phase 1 output state table has a new `init_submodules` row.
- [ ] `skills/plan-with-ralph/SKILL.md` Phase 1B wraps the worktree-create.mjs invocation so `--no-submodule-init` is added IFF `init_submodules != true`. Prose update documents the default + opt-out behavior.
- [ ] `skills/convert-to-ralph-prd/SKILL.md` Step 5 invocation includes `--require-submodule-init` with a 1-line prose rationale.
- [ ] `node ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs --write` (from codexu root) regenerates `.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md` AND `.copilot-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md` to match.
- [ ] `node ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs --check` and `node ai-developer-toolkit/plugins/ralph/scripts/check-copilot-parity.mjs` both exit 0.
- [ ] PR description / commit message lists every `worktree-create.mjs` callsite in plan-with-ralph + Copilot mirror + convert-to-ralph-prd + its mirror, with per-site decision rationale (skip / keep / require).
**Dependencies:** US-001
**Estimated complexity:** small

## US-005: AGENTS.md `## v5.48.0 Behavioral Additions` section

**Description:** As a plugin maintainer, I want a new `## v5.48.0 Behavioral Additions` section in `plugins/ralph/AGENTS.md` documenting the new flags, env var, precedence rule, plan-default change, impl positive-form override, lock-skip semantics, test gate, and release reminder so future agents have an authoritative reference.

**Acceptance Criteria:**
- [ ] New section added immediately AFTER the existing latest-version block (likely after `## v5.47.0` or `## v5.46.0` if 5.47 has no entry).
- [ ] ≥8 bold-prefixed bullets following the v5.42.0 style (each starts with `- **<topic>.**`).
- [ ] Bullets cover: both new flags individually, env var, precedence rule (require > no > env > default), lock-skip on no-op, plan-default + `--init-submodules` opt-out, convert-to-ralph-prd `--require-submodule-init` wiring, test gate (no jq, protocol.file.allow=always), why v5.42.0 relaxation is safe on plan-phase, release reminder (5 stamps).
- [ ] Verifier command: `test "$(awk '/^## v5\.48\.0/,/^## v5\.4[0-7]/' ai-developer-toolkit/plugins/ralph/AGENTS.md | grep -c '^- \*\*')" -ge 8` exits 0.
**Dependencies:** US-001, US-004
**Estimated complexity:** small

## US-006: 5-stamp version bump to `5.48.0`

**Description:** As a plugin maintainer, I want all 5 version-stamp locations bumped to `5.48.0` in the same toolkit commit so consumer installers pick up the new version cleanly.

**Acceptance Criteria:**
- [ ] `ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json` `"version": "5.48.0"`.
- [ ] `ai-developer-toolkit/plugins/ralph/.github/plugin/plugin.json` `"version": "5.48.0"`.
- [ ] `ai-developer-toolkit/.claude-plugin/marketplace.json` ralph entry `"version": "5.48.0"`.
- [ ] `ai-developer-toolkit/.github/plugin/marketplace.json` ralph entry `"version": "5.48.0"`.
- [ ] `ai-developer-toolkit/.agents/plugins/marketplace.json` ralph entry `"version": "5.48.0"`.
- [ ] `grep -l '"5.48.0"' <5 files>` returns all 5 paths (verifier).
**Dependencies:** US-001, US-002, US-003, US-004, US-005 (all toolkit-side stories squash into one ship commit)
**Estimated complexity:** small

## US-007: Toolkit topic-branch handoff

**Description:** As an impl member, I want to commit the toolkit changes on topic branch `ralph/ralph-orchestration-worktree-conditional-submodule-init` (inside the `ai-developer-toolkit/` submodule worktree) and push that topic branch to ai-developer-toolkit `origin` so the lead can review, FF-merge to `main`, and sync `origin`/`personal`/`gim-home`.

**Acceptance Criteria:**
- [ ] Toolkit changes committed on topic branch `ralph/ralph-orchestration-worktree-conditional-submodule-init` (inside the ai-developer-toolkit worktree). Commit message references the brainstorm direction D-001 and lists the impl scope.
- [ ] Topic branch pushed to ai-developer-toolkit `origin` (one remote only — multi-remote sync is lead-owned).
- [ ] `git -C ai-developer-toolkit/.worktrees/<task-id>/ ls-remote --heads origin ralph/ralph-orchestration-worktree-conditional-submodule-init` returns the expected SHA.
- [ ] Impl member's kind=done report includes toolkit commit SHA + branch name.
- [ ] Impl member does NOT push to `main` on any toolkit remote (verified by absence of push events to `refs/heads/main`).
**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006
**Estimated complexity:** small

## US-008: Codexu submodule pointer bump + version-table update + topic-branch handoff

**Description:** As an impl member, I want to commit the codexu submodule pointer bump (recording the new toolkit SHA) plus the codexu root `AGENTS.md` `## Active plugin versions` table update on codexu topic branch `ralph/ralph-orchestration-worktree-conditional-submodule-init`, then push that topic branch to codexu `origin` so the lead can FF-merge after the toolkit-side merge lands.

**Acceptance Criteria:**
- [ ] `ai-developer-toolkit` submodule pointer in codexu HEAD matches the toolkit SHA from US-007 (after lead-FF on toolkit; member coordinates with lead handoff).
- [ ] Codexu root `AGENTS.md` `## Active plugin versions` table row `| \`ralph\` (\`ralph-orchestration\`) | \`5.48.0\` | ...` matches the new toolkit version stamp.
- [ ] Both edits in ONE codexu commit on topic branch `ralph/ralph-orchestration-worktree-conditional-submodule-init`.
- [ ] Topic branch pushed to codexu `origin`.
- [ ] Impl member's kind=done report includes codexu commit SHA + branch name.
- [ ] Impl member does NOT push to codexu `main` (lead-owned).
**Dependencies:** US-007 (toolkit SHA must exist; member coordinates lead-FF on toolkit before bumping codexu pointer)
**Estimated complexity:** small

## US-009: Post-ship Criterion 12 two-variant smoke

**Description:** As the bookkeeper, I want two `/plan-with-ralph` smoke spawns after both toolkit and codexu merges land — one default (asserts `submoduleInitRan: false` + plan completes) and one `/plan-with-ralph --init-submodules` (asserts `submoduleInitRan: true` + plan completes) — so we have empirical proof that both code paths work in production.

**Acceptance Criteria:**
- [ ] **Variant 1 (default-skip):** Spawn `/plan-with-ralph <any small fuzzy idea>`. Observe `worktree-result.json` contains `"submoduleInitRan": false`. `git -C <plan-worktree> submodule status` shows `-` lines. Plan member reaches Phase 5 and reports `kind=done`.
- [ ] **Variant 2 (init opt-out):** Spawn `/plan-with-ralph --init-submodules <any small fuzzy idea>`. Observe `worktree-result.json` contains `"submoduleInitRan": true`. `git -C <plan-worktree> submodule status` shows space-prefix lines (populated). Plan member reaches Phase 5 and reports `kind=done`.
- [ ] Both variants documented in the ship-manifest commit summary OR a follow-up bookkeeper note.
- [ ] No regressions observed in concurrent plan/impl spawns during the 24-48 hour window post-merge (operator monitors).
**Dependencies:** US-008 (both repos merged to main)
**Estimated complexity:** small