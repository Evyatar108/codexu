# Caller Sweep: `codex-exec.sh` / `copilot-exec.sh` (v5.46.0 removals)

This audit confirms that no active runtime caller of the deleted bash entry-shims
`plugins/ralph/codex-exec.sh` and `plugins/ralph/copilot-exec.sh` exists in either of the
two repos this fork can reach locally. All remaining textual references are HISTORICAL
prose, DOCUMENTATION prose, or STALE PROSE in skill mirrors / schema descriptions / hand-
edited overview prompts. The hermetic-test env-var override path
(`CODEX_EXEC_SCRIPT` / `COPILOT_EXEC_SCRIPT`) is NOT counted as an active caller — it is a
supported override mechanism that auto-detects extension (`.sh` → `bash`, `.mjs` → `node`)
and continues to work unchanged.

Cross-reference: `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md`
is the audit that motivated this sweep + advisory promotion. Stale-prose follow-up tasks
filed by US-004 are listed in `follow-ups.md` (sibling file).

## Search scope

Two repos, swept from their topic-branch worktrees:

- `D:/ai-developer-toolkit-worktrees/ralph-exec-sh-wrapper-removal-changelog/` (branch `ralph/ralph-exec-sh-wrapper-removal-changelog` off `origin/main` at `d0682c89`).
- `D:/harness-efforts/codexu-worktrees/ralph-exec-sh-wrapper-removal-changelog/` (branch `ralph/ralph-exec-sh-wrapper-removal-changelog` off `origin/main` at `4fd8e5be`).

## Grep commands

The base grep run in each repo:

```bash
git grep -nE 'codex-exec\.sh|copilot-exec\.sh'
```

The fresh CLAUDE.md grep used to populate US-004's `ralph-claude-stale-sh-prose-cleanup`
follow-up:

```bash
git grep -nE 'codex-exec\.sh|copilot-exec\.sh' -- 'plugins/ralph/CLAUDE.md'
```

(run from `D:/ai-developer-toolkit-worktrees/ralph-exec-sh-wrapper-removal-changelog/`).

## Heuristic

Each match was classified using the rules below. The Findings table enumerates only the
INCLUDE-list categories; EXCLUDE-list paths are NOT enumerated.

### EXCLUDE (matches not enumerated in Findings)

- `**/CHANGELOG.md` — every CHANGELOG entry that mentions the shims is intentional release
  history. This release's bold-led top BREAKING CHANGE bullet (US-001) is itself such a
  reference.
- `**/.agents/memory/feedback_*.md` — auto-memory entries are historical lessons from
  prior incidents (e.g. `feedback_codex_exec_v545_windows_spawn.md`); the env-var
  override they describe is the supported workaround and is not a caller.
- `**/.ralph/jobs/*/{plan,research-brief,audit-report,progress,prd,plan-review-findings}.{md,json}` —
  per-job artifacts, including the plan that drove this task.
- `**/.ralph/job-groups/**/staging/**` — group staging artifacts.
- `plugins/ralph/tests/fixtures/regression-smoke-*` and any path matching
  `*pre-flight-caller-surface*`, `*post-migration-caller-surface*`, `*baseline*`,
  `*recorded*` — captured-baseline test fixtures.
- Generated overview sidecars: `plans/overview-snapshot.json`,
  `plans/overview-recommendations.json`, `plans/overview-dependency-graph.json`,
  `plans/overview-ralph-state.{js,json}`, `plans/overview.html`,
  `plans/overview.html.next`.
- Tests that intentionally create `.sh` mock files at runtime under `mock_dir/`
  (e.g. `plugins/ralph/tests/test-review-loop-rereview.sh`,
  `tests/test-review-loop-planning-engine.sh`, `tests/test-regression-smoke-phase-3.mjs`)
  — these tests assemble `.sh` stubs at runtime under temp dirs to exercise the engine
  resolver's extension auto-detect; they are not callers of the removed shims.

### INCLUDE (matches enumerated in Findings)

- Skill markdown — `plugins/ralph/skills/**/SKILL.md` and
  `plugins/ralph/.copilot-plugin/copilot-skills/**/SKILL.md`.
- Agent markdown — `plugins/ralph/agents/*.md`.
- JSON schemas — `plugins/ralph/schemas/*.json`.
- Application scripts, `package.json` scripts, hook scripts. (Both repos: grep returned ZERO matches in these categories. The category is enumerated here so a future reader can confirm the sweep covered it; the Findings tables below intentionally contain no rows for these paths.)
- Top-of-file docstrings in `plugins/ralph/src/*.{mjs,js}`.
- Hand-edited `CLAUDE.md`, `AGENTS.md`, `README.md`, and `docs/*.md` (not generated).
- `plans/codexu-roadmap.md` (codexu) and any hand-edited content in
  `plans/overview-data.js` command-prose fields (codexu).

### Classifications

- **HISTORICAL** — describes a past release / migration / investigation. The reference is
  not actionable today.
- **DOCUMENTATION** — describes the supported override path or the historical contract for
  intentional reader context.
- **STALE PROSE** — describes a runtime path that v5.46.0 deleted. Reader following the
  prose verbatim will hit "No such file or directory". Each such location becomes a
  separate follow-up task in `follow-ups.md`.
- **TEST FIXTURE** — captured-baseline data (EXCLUDE-list; not enumerated here).
- **ACTIVE CALLER** — runtime code that spawns a deleted `.sh` shim by literal path.

## Findings

### ai-developer-toolkit

| File:line | Classification | Notes |
|---|---|---|
| `plugins/ralph/skills/implement-with-ralph/SKILL.md:1624,1625,1639,1640` | STALE PROSE | Appendix D "Iteration Engine" and "Planning engine" still says "via `codex-exec.sh`" / "via `copilot-exec.sh`". Follow-up: `ralph-stale-sh-prose-cleanup-skills`. |
| `plugins/ralph/skills/multi-model-investigate/SKILL.md:146` | STALE PROSE | Round-2 prompt-assembly note references `codex-exec.sh` / `copilot-exec.sh`. Follow-up: `ralph-stale-sh-prose-cleanup-skills`. |
| `plugins/ralph/skills/review-plan-with-ralph/SKILL.md:11` | STALE PROSE | Plugin-path derivation note still lists `codex-exec.sh`. Follow-up: `ralph-stale-sh-prose-cleanup-skills`. |
| `plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md:1662` | STALE PROSE | Copilot mirror copy of Appendix D iteration engine prose. Follow-up: `ralph-stale-sh-prose-cleanup-copilot-mirror`. |
| `plugins/ralph/.copilot-plugin/copilot-skills/multi-model-investigate/SKILL.md:146` | STALE PROSE | Copilot mirror of the multi-model-investigate Round-2 note. Follow-up: `ralph-stale-sh-prose-cleanup-copilot-mirror`. |
| `plugins/ralph/schemas/prd-schema.json:21,27` | STALE PROSE | `iterationEngine` and `planningEngine` description fields still say "Codex (gpt-5.5 via codex-exec.sh)" / "Copilot (… via copilot-exec.sh)". Follow-up: `ralph-stale-sh-prose-cleanup-skills` (grouped with skill prose because both are operator-facing schema/skill docs surfaces). |
| `plugins/ralph/src/codex-exec.mjs:2` | DOCUMENTATION | US-002 `@see` pointer added by this PR; references the deleted `codex-exec.sh` deliberately so readers find the v5.46.0 CHANGELOG entry. NOT a caller. |
| `plugins/ralph/src/copilot-exec.mjs:2` | DOCUMENTATION | US-002 `@see` pointer; symmetric to above. NOT a caller. |
| `plugins/ralph/docs/follow-ups/sh-to-js-migration.md:17,26,27,74` | HISTORICAL | This is the migration plan that PROPOSED removing the shims. Historical-by-design. No cleanup. |
| `plugins/ralph/docs/future-work/copilot-port-handoff.md:17` | HISTORICAL | v5.32.0-era hand-off note recording the `copilot-exec.sh` gpt-5.4 → gpt-5.5 bump. Historical-by-design. No cleanup. |
| `plugins/ralph/CLAUDE.md:24,52,53,69,83,84,179,187,189,195,204,205,210,221,224,230,232,279,325,326,346,347,388,417,671,672,789,790,806,807,808,809,860,862,887,996` | STALE PROSE / HISTORICAL (mixed) | Multi-section CLAUDE.md. CLAUDE.md is reverse-chronological: v5.46.0 starts at file line 20 and pre-v5.46.0 release-note blocks (v5.45.0, v5.35.0, v5.34.0, …) sit physically BELOW the v5.46.0 block. The matches split into three groups: (a) lines 24, 52, 53 are inside the v5.46.0 block and accurately describe the deletion — HISTORICAL/KEEP. (b) Lines 69, 83-84, 179, 187, 189, 195, 204-205, 210, 221, 224, 230, 232, 279, 325-326, 346-347, 388 sit inside pre-v5.46.0 release-note blocks and describe what shipped at those prior releases — HISTORICAL/KEEP. (c) Lines 417, 671-672, 789-790, 806-809, 860, 862, 887, 996 sit in the architectural sections (`## What's in this plugin`, `## Key files`, `## Multi-model planning`, `## Multi-model review`, `## Prerequisites`) outside all release-note blocks and describe current behavior — these are the STALE PROSE that needs to flip to `.mjs`. Follow-up: `ralph-claude-stale-sh-prose-cleanup` (full per-line classification + rule of thumb in US-004's `follow-ups.md`). |
| `CLAUDE.md:32` (ai-developer-toolkit root) | HISTORICAL | Long-form ralph-plugin description in the root CLAUDE.md mentions `copilot-exec.sh` in a v5.21.0 release note (the gpt-5.4 → gpt-5.5 bump). Historical-by-design. No cleanup. |
| `plugins/crews/CLAUDE.md:657` | HISTORICAL | v1.3.2 cleanup-release note recording a 3-way post-ship review that USED the ralph shims to run the review. Historical-by-design. No cleanup. |

### codexu

| File:line | Classification | Notes |
|---|---|---|
| `plans/codexu-roadmap.md:146,1220,1226,1293,1392,2232,2333,2335,2375,2376,2382,2387,2399,2407,2410,2413,2427,2687,2711,2716,2940,3030,3137,3222,3452` | STALE PROSE | Roadmap §Phase 3d ("Codex-based workers via native agent role spawn") describes the migration path that would replace `codex-exec.sh` with codex native `spawn-agent-role`. Now that v5.46.0 has shipped the `.sh` removal, the §Phase 3d "Today: ralph orchestrator skill runs `bash → codex-exec.sh`" baseline is stale (today's baseline is `node src/codex-exec.mjs`). Follow-up: `codexu-roadmap-stale-sh-refs`. |
| `plans/overview-data.js:475` | DOCUMENTATION | Card descriptionHtml for the Phase 3d task — accurate at the time it was authored (when ralph still shelled to `codex-exec.sh`). The card itself is now historical; the card prose is a candidate for refresh during Phase 3d's actual planning cycle. Follow-up: `codexu-roadmap-stale-sh-refs` (grouped with roadmap). |
| `plans/overview-data.js:488` | DOCUMENTATION | `prompts.plan` seed for Phase 3d. Same disposition as the line-475 card prose. Follow-up: `codexu-roadmap-stale-sh-refs`. |
| `plans/overview-data.js:708` | DOCUMENTATION | `prompts.plan` seed for `ralph-codex-exec-windows-spawn-fix`. References the removed shim as the pre-fix baseline; relevant for the historical context of that fix's plan. No active caller. No cleanup unless the seed gets re-planned. |
| `plans/overview-data.js:813,815` | DOCUMENTATION | The `descriptionHtml` and `prompts.plan` seed THIS task was spawned from (`ralph-exec-sh-wrapper-removal-changelog`). Now that this task is shipping, the bookkeeper will lifecycle-flip the entry to `"merged"`; the prose remains historical and is not enumerated for cleanup. |
| `plans/overview-data.js:846,848` | DOCUMENTATION | The card + seed for `ralph-implement-skill-mirror-regenerate-2026-05-28` — i.e. the Copilot-mirror follow-up. Continues to be relevant until that task ships. No cleanup. |

## Active callers

**ZERO.**

Reasoning:

1. v5.46.0 deleted `codex-exec.sh` and `copilot-exec.sh` from `plugins/ralph/`. No file in
   either repo invokes the literal paths `bash plugins/ralph/codex-exec.sh ...` or
   `bash plugins/ralph/copilot-exec.sh ...` from a runtime code path. The matches above
   are all in markdown/JSON description prose, src-file docstrings, or hand-edited plan
   prose — none of those are runtime code paths.
2. The hermetic-test env-var overrides `CODEX_EXEC_SCRIPT` / `COPILOT_EXEC_SCRIPT` are a
   SUPPORTED OVERRIDE MECHANISM. The Phase 5 resolver in
   `plugins/ralph/src/ralph.mjs::resolveEngineScript()` auto-detects the resolved
   path's extension and spawns `node` for `.mjs` paths and `bash` for `.sh` paths. A
   `.sh` override path therefore remains valid post-v5.46.0; this is documented in the
   v5.46.0 CHANGELOG entry, the `feedback_codex_exec_v545_windows_spawn.md` auto-memory
   entry, and the BREAKING CHANGE bullet US-001 added. An env-var override is NOT the
   same as a caller of the deleted shim — it points at a stub path the operator owns.
3. The runtime fixtures under `plugins/ralph/tests/**/mock_dir/` that assemble
   `stub-codex.sh` / `stub-copilot.sh` at test-time DO produce `.sh` files, but those
   stubs are CREATED by the test under a temp dir and pointed at via the env-var
   override — they exercise the resolver's `.sh` auto-detect, not the deleted shim.

## Follow-up tasks filed

See `follow-ups.md` (sibling file) for the four follow-up task seeds the bookkeeper will
paste into `plans/overview-data.js`:

1. `ralph-stale-sh-prose-cleanup-skills` — operator-facing skill markdown + JSON schema
   descriptions (ai-developer-toolkit).
2. `ralph-stale-sh-prose-cleanup-copilot-mirror` — `.copilot-plugin/copilot-skills/**`
   regeneration (ai-developer-toolkit). May dedupe with the audit-report's
   `ralph-implement-skill-mirror-regenerate-2026-05-28` candidate — bookkeeper decides.
3. `ralph-claude-stale-sh-prose-cleanup` — `plugins/ralph/CLAUDE.md` post-v5.46.0
   architecture-section refresh (ai-developer-toolkit).
4. `codexu-roadmap-stale-sh-refs` — `plans/codexu-roadmap.md` Phase 3d baseline refresh
   (codexu).
