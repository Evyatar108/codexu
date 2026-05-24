# Research Brief — Phase 3a Ralph Skills Port

## Researcher Findings

Initial agent run reported the literal source path `C:/ai-developer-toolkit/plugins/ralph/skills/` as inaccessible. Direct verification by main agent showed the live source is at `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.24.0/skills/` (Claude plugin marketplace cache, 13 SKILL.md files matching roadmap inventory).

Existing scaffold at `packages/codexu-plugin/`:
- `.codex-plugin/plugin.json`: `name=codexu-plugin`, `version=0.1.0`, `skills="./skills"`, with `interface` block. Single skills root (not array). Verified line 5.
- `.agents/plugins/marketplace.json`: marketplace anchor.
- `skills/hello-world/SKILL.md`: format template — frontmatter `name`, `description`, `user-invocable: true`.
- `README.md`: install + Phase 2b junction recipe.

## Architect Analysis

The codex submodule at `codex/` is uninitialized (`git submodule status` reports gitlink only). `core-plugins/src/manifest.rs:12-33` and `core-plugins/src/loader.rs:678` cannot be re-verified in this checkout. The roadmap already documents the binding constraints from Phase 2b's earlier verification:
- `skills` field is `Option<String>` — single plugin-root-relative path; no arrays.
- Unknown manifest fields silently tolerated.
- Unknown frontmatter fields silently tolerated (including Claude-only `allowed-tools`, verified via junction smoke test).

codex's `agent.spawn` (roadmap §3a line 1738-1740 and §3d notes) requires `agent_type`, `message`, `task_name`; denies unknown fields. This is narrower than Claude's `Agent()` / `Task()` which accept `subagent_type`, `prompt`, `run_in_background`, etc.

Risk: skills reference supporting tree (`agents/`, `prompts/`, shell scripts) under `<plugin_root>/…`. Phase 3a scopes the port to SKILL.md files only — supporting tree is Phase 3b-d. Skills will register but won't run end-to-end until those phases land.

## Codex Research

Located at `D:/harness-efforts/codexu/.ralph/jobs/.staging/20260513-060008/codex-research.txt`. Confirms:
- Single-path constraint for `skills`; do NOT add array entries.
- Codex tolerates Claude-only frontmatter.
- Body rewrite scope is per roadmap §3a (Task → agent_type), but `<plugin_root>` references should NOT be expanded (they're a portable placeholder).
- Notes the smoke-test skill mismatch: `list-jobs` is `user-invocable: false`, must substitute.

## Copilot Research

Located at `D:/harness-efforts/codexu/.ralph/jobs/.staging/20260513-060008/copilot-research.txt`. Confirms:
- Single-path manifest constraint.
- `context: fork` is Claude-only hint.
- Spec inconsistency between task wording and source `user-invocable: false` for list-jobs.
- Cites roadmap line ranges 1149-1189 and 2635-2645 for manifest/path constraints.

## Consolidated File List

**Files to modify:**
- `packages/codexu-plugin/README.md`
- `plans/codexu-roadmap.md` (specifically §Phase 3a starting line 1706)

**Files to create (13):**
- `packages/codexu-plugin/skills/{analyze-iteration,brainstorm-with-ralph,convert-to-ralph-prd,create-prd,decompose-plan,edit-prd,implement-with-ralph,list-jobs,parallel-ralph,plan-with-ralph,review-changes,review-plan-with-ralph,run-ralph}/SKILL.md`

**Source files (read-only):**
- `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.24.0/skills/<13 names>/SKILL.md`

**Reference (read-only):**
- `codex/core-plugins/src/manifest.rs` (after `git submodule update --init codex`)
- `codex/core-plugins/src/loader.rs:~678` (after submodule init)
- `packages/codexu-plugin/.codex-plugin/plugin.json` (no edits)
- `packages/codexu-plugin/skills/hello-world/SKILL.md` (format reference)

**Test/build infrastructure:**
- No automated test harness in this repo for codex plugin loading; smoke tests are CLI invocations of `codex plugin marketplace upgrade`, `codex debug prompt-input`, and TUI `/skills` picker (manual).

## Verified Counts (Grep)

- `Agent(subagent_type=` function-call sites: **9 across 4 skills** (brainstorm-with-ralph: 1, convert-to-ralph-prd: 2, implement-with-ralph: 5, plan-with-ralph: 1). The earlier "53 across 8 files" count came from a combined-pattern grep that included `plugin_root` and other tokens.
- `allowed-tools`: **0** across all 13 skills.
- `model:` in frontmatter: **0**.
- `argument-hint:`: **0**.
- `options-mode|options_mode`: **0** in skill bodies.
- `AskUserQuestion|ask_user_question`: **0** in skill bodies.
- `context: fork` in frontmatter: **5** (analyze-iteration, convert-to-ralph-prd, create-prd, decompose-plan, review-changes).
