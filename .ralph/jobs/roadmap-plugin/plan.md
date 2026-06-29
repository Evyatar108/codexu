# Implementation Plan: roadmap-plugin (skill-commands surface)

## Summary

Add a small set of slash-command skills under `packages/codexu-plugin/skills/`
that let agents manage the codexu roadmap programmatically without
hand-editing JSON. Each skill is a thin SKILL.md that drives the existing
`tools/data-edit.mjs` CLI (the codexu wrapper over ralph-overview's id-scoped,
atomic, invariant-checked mutation core) and, where relevant, makes a
surface-narrow edit to `plans/parallel-assignments.md`. No new MCP server, no
new mutation core, no renderer changes.

**Operator decision (2026-06-29):** build **surface (1) skill commands** first.
**Surface (2) MCP tools is OUT OF SCOPE / FUTURE** — ralph-overview already
ships 5 id-scoped `data.json` write tools (`overview.upsert_task`,
`mark_shipped`, `set_lifecycle`, `add_kanban_card`, `set_prompts`), so a second
MCP surface would be ~80% redundant; deferred until/if codexu wants codex-side
MCP write tools.

## Goal

A roadmap-managing agent (or the operator) can, from inside codexu, run a
single slash command to: file a new task, flip a task's lifecycle/status, take
a task (mark it in-progress/blocked/paused), and record a run, with each write
going through the atomic invariant-checked path — never raw JSON edits.

## Scope

- **In scope:** four (4) user-invocable SKILL.md files in
  `packages/codexu-plugin/skills/`, README + plugin-manifest updates, smoke
  verification, no-clobber/atomicity reuse of `tools/data-edit.mjs`.
- **Out of scope:** MCP tools (deferred), new `data-edit` verbs in ralph-overview
  (toolkit submodule — separate repo), renderer/viewer changes, watcher changes,
  hooks. `record-run`'s data.json `runs[]` append is the one surface with no
  existing verb — see US-004 for the bounded approach.

## Acceptance criteria (verifiable)

- `packages/codexu-plugin/skills/roadmap-add-task/SKILL.md` exists, frontmatter
  `name: roadmap-add-task`, `user-invocable: true`, body wraps
  `node tools/data-edit.mjs upsert-task --create-only`.
- `roadmap-update-status` SKILL flips `lifecycle` via `set-lifecycle` and (for
  `merged`) `mark-shipped`.
- `roadmap-take-task` SKILL flips `status` (ok|blocked|paused) via `upsert-task`
  read-modify-write and updates the `parallel-assignments.md` status table row.
- `roadmap-record-run` SKILL appends to `data.json.runs[]` through the bounded
  helper (US-004), no raw clobber.
- `node -e "JSON.parse(fs.readFileSync('.ralph-overview/data.json'))"` parses
  clean after any command (atomic write guarantee).
- README documents the four commands + the "skill commands now / MCP deferred"
  decision.

## Surface design — settled

Two surfaces were scoped (seed open question). Operator picked **(1) skill
commands** and deferred **(2) MCP tools**. Rationale recorded in plan-review
findings; do not re-derive at impl time.

## Architecture

```
packages/codexu-plugin/
  .codex-plugin/plugin.json   # skills: "./skills" already maps the dir
  skills/
    hello-world/SKILL.md      # existing
    roadmap-add-task/SKILL.md       # NEW
    roadmap-update-status/SKILL.md  # NEW
    roadmap-take-task/SKILL.md      # NEW
    roadmap-record-run/SKILL.md     # NEW
  README.md                   # document the 4 commands
```

All skills call `node tools/data-edit.mjs <verb> <id> ...` from repo root. That
wrapper auto-injects `--repo <repoRoot>` and dispatches to
`bin/ralph-overview.mjs data-edit`, which is the atomic, invariant-checked,
hot/cold-shard-aware path. The skills never touch `.ralph-overview/data.json`
with raw editors.

## Verb-to-command mapping

| Skill | data-edit verb(s) | parallel-assignments.md edit |
|---|---|---|
| roadmap-add-task | `upsert-task --json <file> --create-only` | append status-table row |
| roadmap-update-status | `set-lifecycle` (+ `mark-shipped` for merged) | update row Status/Commit |
| roadmap-take-task | `upsert-task` (read→set status→write) | mark row owner/in-progress |
| roadmap-record-run | bounded `runs[]` append (US-004) | none |

Note: `data-edit` has no `set-status`/`record-run` verb. `take-task` reuses
`upsert-task` (read task, change `status`, write back) so atomicity/invariants
still hold. `record-run` is the only gap — US-004 covers a bounded codexu-side
append, NOT a new ralph-overview verb.

## Common mistakes / confusion points

- **`tools/data-edit.mjs` may fail if installed ralph-overview deps missing**
  (`@babel/parser` not found). Skills should prefer the in-tree dispatcher and
  document the `copilot plugin update` / `npm install` recovery. Verified
  2026-06-29 the wrapper resolved to the install path and errored on missing dep.
- **codexu-plugin is codex-only** (`.codex-plugin/plugin.json`, `skills: "./skills"`)
  — no `.claude-plugin/`. Test via `codex plugin marketplace add ./packages/codexu-plugin`.
- **Do NOT git add CLAUDE.md** (gitignored). Fork guidance → AGENTS.md only.
- **Three roadmap axes are separate:** `status` (ok/blocked/paused) is temporary
  availability; `lifecycle` (tracked/merged/archived) is durable. take-task flips
  `status`; update-status flips `lifecycle`. Don't conflate.

## Relevant files

- `packages/codexu-plugin/skills/hello-world/SKILL.md` — skill template
- `packages/codexu-plugin/.codex-plugin/plugin.json`, `README.md`
- `tools/data-edit.mjs` — verbs to wrap
- `ai-developer-toolkit/plugins/ralph-overview/scripts/lib/data-edit-core.mjs` — verb args
- `.agents/skills/roadmap-and-overview/SKILL.md` — convention to reuse
- `plans/parallel-assignments.md`, `plans/codexu-roadmap.md` — secondary targets
- `.ralph-overview/data.json` — data model

## Docs to update

- `packages/codexu-plugin/README.md` (4 commands + MCP-deferred note)
- `.ralph-overview/data.json` task row mark-shipped (lead bookkeeping post-merge)

## Out of scope / future

- MCP tools surface (defer; ralph-overview already covers it)
- New `set-status` / `record-run` data-edit verbs in ralph-overview submodule
