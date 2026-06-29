# Stories outline: roadmap-plugin

## US-001 — roadmap-add-task skill
Add `packages/codexu-plugin/skills/roadmap-add-task/SKILL.md`. Wraps
`node tools/data-edit.mjs upsert-task <id> --json <file> --create-only` so a new
task row is filed without clobbering an existing id, then appends a status row
to `plans/parallel-assignments.md`. AC: skill file exists; create-only collision
rejected; data.json parses clean.

## US-002 — roadmap-update-status skill
Add `roadmap-update-status` SKILL flipping lifecycle via `set-lifecycle <id>
<tracked|merged|archived>`; for `merged` uses `mark-shipped` with summary +
commits. AC: lifecycle transitions for all three; mark-shipped writes shipManifest.

## US-003 — roadmap-take-task skill
Add `roadmap-take-task` SKILL: read task, set `status` (ok|blocked|paused), write
via `upsert-task` (atomic), update parallel-assignments row owner/in-progress.
AC: status flips without lifecycle change; round-trips parse clean.

## US-004 — roadmap-record-run skill (bounded runs[] append)
Add `roadmap-record-run` SKILL appending to `data.json.runs[]`. No data-edit verb
exists; use a bounded id-anchored append helper that re-parses + atomic-writes,
NOT raw clobber. AC: run entry appended; JSON valid; existing runs preserved.

## US-005 — README + manifest docs
Document the 4 commands + "skill commands now / MCP deferred" decision in
`packages/codexu-plugin/README.md`. Confirm `.codex-plugin/plugin.json` skills
dir maps. AC: README lists 4 commands; smoke `codex plugin marketplace add`.

Decomposition: US-001..004 share `skills/` dir + README; serial single job.
