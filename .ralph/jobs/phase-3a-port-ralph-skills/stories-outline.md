# Stories Outline: Phase 3a — Port Ralph Plugin Skills to codex Plugin Format

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Submodule re-verification + verbatim SKILL.md copy + discovery smoke test
**Description:** As an implementer, I want to verify the codex manifest schema hasn't drifted from the assumed contract, then copy all 13 ralph SKILL.md files verbatim into the codexu-plugin skills directory, and confirm codex discovers them — so that body edits in the next story start from a known-good registration baseline.
**Acceptance Criteria:**
- [ ] `git submodule update --init codex` exits 0. Submodule is read-only; not modified.
- [ ] `codex/core-plugins/src/manifest.rs` around lines 12-33 still defines `skills: Option<String>` (single path, not array). If schema has drifted, STOP and re-plan.
- [ ] `codex/core-plugins/src/loader.rs` around line 678 still defines `plugin_skill_roots()` consistent with single-path discovery.
- [ ] 13 directories created under `packages/codexu-plugin/skills/`: analyze-iteration, brainstorm-with-ralph, convert-to-ralph-prd, create-prd, decompose-plan, edit-prd, implement-with-ralph, list-jobs, parallel-ralph, plan-with-ralph, review-changes, review-plan-with-ralph, run-ralph.
- [ ] Each directory contains a `SKILL.md` byte-identical to its source in `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.24.0/skills/<name>/SKILL.md`. Verifiable: `diff -r` returns no output across all 13.
- [ ] `codex plugin marketplace upgrade codexu` exits 0.
- [ ] `codex debug prompt-input "test" | grep packages/codexu-plugin/skills | sort -u | wc -l` returns ≥ 14 (13 ralph + existing hello-world).
- [ ] `.codex-plugin/plugin.json` is unchanged (`git diff packages/codexu-plugin/.codex-plugin/plugin.json` empty).
- [ ] Typecheck passes (repo-wide pnpm typecheck or local equivalent — codexu-plugin has no compilation step but other workspace packages may).
**Dependencies:** None
**Estimated complexity:** small

## US-002: Body syntax swap on 9 function-call sites across 4 skills
**Description:** As an implementer, I want to convert Claude-Code `Agent(subagent_type="<role>"…)` call prefixes to codex's `agent.spawn({agent_type: "<role>"…})` syntax in the 4 skills that use them — preserving all surrounding call arguments verbatim — so that the SKILL.md bodies are codex-syntax-shaped while honoring the user-approved "don't massage bodies for codex's narrow current API" decision.
**Acceptance Criteria:**
- [ ] `packages/codexu-plugin/skills/brainstorm-with-ralph/SKILL.md`: 0 matches for `Agent(subagent_type=`; 1 match for `agent.spawn({agent_type:` (matching original count).
- [ ] `packages/codexu-plugin/skills/convert-to-ralph-prd/SKILL.md`: 0 matches for `Agent(subagent_type=`; 2 matches for `agent.spawn({agent_type:`.
- [ ] `packages/codexu-plugin/skills/implement-with-ralph/SKILL.md`: 0 matches for `Agent(subagent_type=`; 5 matches for `agent.spawn({agent_type:`.
- [ ] `packages/codexu-plugin/skills/plan-with-ralph/SKILL.md`: 0 matches for `Agent(subagent_type=`; 1 match for `agent.spawn({agent_type:`.
- [ ] Other call args (`prompt=`, `run_in_background=`, etc.) are preserved byte-identically. Verifiable per-file: `diff <(sed 's/Agent(subagent_type=/agent.spawn({agent_type:/g' source) ported` is empty (modulo any multi-line edge cases noted in commit message).
- [ ] The other 9 skills are still byte-identical to source. `diff -r` on those 9 returns no output.
- [ ] Prose mentions of `subagent_type` (e.g., "Spawn via Agent tool with `subagent_type: Explore`") are NOT changed.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: README update — Bundled ralph skills + Known gaps
**Description:** As a developer reading the codexu-plugin README, I want to see which ralph skills are now bundled, which are user-invocable, and what gaps prevent end-to-end execution today — so I can set correct expectations and know which roadmap follow-ups to track.
**Acceptance Criteria:**
- [ ] `packages/codexu-plugin/README.md` gains a "Bundled ralph skills" section listing all 13 skills in a table (skill name, `user-invocable` flag, one-line description copied from frontmatter).
- [ ] Same file gains a "Known gaps" subsection mentioning (a) codex `agent.spawn` API parity follow-ups (`prompt` alias, `run_in_background`, auto `task_name`, result-collection), (b) `context: fork` codex support, (c) Phase 3b-d dependencies (agent role TOMLs, prompts/, helper scripts).
- [ ] Existing README sections (install recipe, Phase 2b junction recipe, smoke test) remain unchanged.
- [ ] Typecheck passes.
**Dependencies:** None (can run parallel to US-002)
**Estimated complexity:** small

## US-004: *(removed — landed pre-job)*
**Status:** The roadmap §3a-tail follow-up entries were landed in commit `607c44b5` on 2026-05-13 **before** this job started, per the user's instruction to handle the roadmap addition as a separate commit. The implementer should:
- Verify `plans/codexu-roadmap.md` §3a-tail exists on `main` before starting (look for the heading `#### 3a-tail. Codex API parity follow-ups (surfaced during skills port)`).
- **NOT** re-edit `plans/codexu-roadmap.md` in this job's commit.
- Reference the already-landed §3a-tail from the README's "Known gaps" subsection (US-003).

This story remains in the outline as a tombstone so future readers don't wonder about the gap between US-003 and US-005.

## US-005: Final smoke tests — marketplace upgrade fresh-log check + prompt-input listing + TUI picker
**Description:** As an implementer, I want to run the three concrete smoke tests after all changes are in place — fresh-log warning check on marketplace upgrade, full skill listing in `prompt-input`, and TUI `/skills` picker invocation of one user-invocable skill — and capture results in the commit message so reviewers can verify post-merge.
**Acceptance Criteria:**
- [ ] Captured `LOG_PRE=$(wc -c < ~/.codex/log/codex-tui.log)` before `codex plugin marketplace upgrade codexu`. After upgrade, `tail -c +$((LOG_PRE+1)) ~/.codex/log/codex-tui.log | grep -iE 'warn|error' | grep -iE 'codexu|ralph|brainstorm-with-ralph|plan-with-ralph|implement-with-ralph|review-plan-with-ralph|analyze-iteration|convert-to-ralph-prd|create-prd|decompose-plan|edit-prd|list-jobs|parallel-ralph|review-changes|run-ralph'` returns zero lines.
- [ ] `codex debug prompt-input "test" | grep -E 'packages/codexu-plugin/skills/(brainstorm-with-ralph|plan-with-ralph|implement-with-ralph|review-plan-with-ralph|analyze-iteration|convert-to-ralph-prd|create-prd|decompose-plan|edit-prd|list-jobs|parallel-ralph|review-changes|run-ralph)/SKILL.md' | sort -u | wc -l` returns exactly 13.
- [ ] Manual TUI step: `codex` → `/` → confirm picker shows `/brainstorm-with-ralph`, `/plan-with-ralph`, `/implement-with-ralph`, `/review-plan-with-ralph` (and NOT `/list-jobs`). Capture screenshot or transcript fragment.
- [ ] Manual TUI step: select `/brainstorm-with-ralph` from picker; confirm first prose paragraph is emitted without codex manifest/load error. Full workflow completion **explicitly NOT required**. Capture transcript fragment.
- [ ] Smoke-test results pasted into commit message body or job notes.
**Dependencies:** US-001, US-002, US-003, US-004
**Estimated complexity:** small

## US-006: Single bundled commit
**Description:** As a maintainer reviewing the change, I want one cohesive commit containing the 14 file changes (13 new SKILL.md + 1 modified README.md), with a commit message that names the scope decisions and points to the already-landed roadmap §3a-tail — so the PR is reviewable as one unit and future archeology is easy.
**Acceptance Criteria:**
- [ ] Single commit on `main` (or a feature branch ready for PR) contains exactly 14 file changes: 13 new SKILL.md + modified `packages/codexu-plugin/README.md`. `plans/codexu-roadmap.md` is **not** in this commit (it was landed earlier in commit `607c44b5`).
- [ ] Commit message follows repo style (see recent commits like `607c44b5`, `7ef13b21`, `19c84daf` — short imperative title, body with bullets, no trailing emoji unless repo convention does it).
- [ ] Commit body explicitly notes: (a) frontmatter preserved verbatim including `context: fork`, (b) body syntax swap limited to `Agent(subagent_type=` → `agent.spawn({agent_type:` prefix on 9 sites in 4 skills, (c) codex API gaps already tracked in roadmap §3a-tail commit `607c44b5` (don't massage bodies), (d) smoke-test substitution from `/list-jobs` to `/brainstorm-with-ralph`.
- [ ] `git status` clean after commit.
- [ ] Typecheck passes.
**Dependencies:** US-005
**Estimated complexity:** small
