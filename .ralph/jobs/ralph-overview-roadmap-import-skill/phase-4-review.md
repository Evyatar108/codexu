# Phase-4 review — `ralph-overview-roadmap-import-skill`

Self + source-verified review of the plan. Findings classified `fixable` (folded into plan)
or `prd-worthy`. All resolved in `plan.md`/`stories-outline.md` before sign-off.

## Findings

### F-1 [High → fixed] No batch verb — apply must be N fail-soft inserts
`data-edit-core.runVerb` mutates ONE task per lock/atomicWrite (verified `scripts/data-edit.mjs`
+ AGENTS Unreleased section). A mid-batch createOnly throw commits M, aborts rest, blocks
re-run. **Resolution:** US-001 mandates skip-existing + continue + manifest + deterministic
kebab → re-run no-op (D-003 baked in, not optional).

### F-2 [High → fixed] Kebab headings yield inert stubs (no prompts)
A heading→id gives id + cmd-warn card but no `prompts.{brainstorm,plan}`. **Resolution:**
mandatory editable `proposed-tasks.json` curate gate (D-002) — operator seeds scope/prompts
before write; default templated empty brainstorm seed + `initialStage:"brainstorming"`.

### F-3 [Med → fixed] Cold-shard collisions must be caught
createOnly guard runs in `applyVerb` over the assembled hot+cold union (verified AGENTS),
so cold ids are caught. Dedup precheck must read summary-projection (hot+cold) and degrade
to both shards if absent. Reflected in US-001 phase 2.

### F-4 [Med → fixed] Copilot mirror is generated + FORBIDDEN-token gated
Generator auto-discovers `skills/*` (verified `discoverSkillMirrors`), rejects `Skill(`/
`Agent(`. **Resolution:** US-002 regenerates; SKILL.md must avoid those tokens (agent parses
inline, no subagent calls). Mirror count assertion 5→6.

### F-5 [Low → fixed] Version is minor, not patch
Additive skill = 2.14.3 → 2.15.0. 4-file bump + policy validator + codexu table (US-003/004).

### F-6 [resolved] SKILL vs thin loop open question
Justified: bulk parse, cross-shard dedup, single curate gate, fail-soft manifest — addressed in plan §"Why a SKILL".

## Verdict
Plan is implementable, surgical, reuses createOnly (zero new core), defers D-004/D-005. No prd-worthy blockers. Ready for `/implement-with-ralph --from-plan`.
