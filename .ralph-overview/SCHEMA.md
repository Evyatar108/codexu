# OVERVIEW_DATA schema

Renders into `.ralph-overview/generated/overview.html` as of ralph-overview plugin v2.5.0.

- `generatedAt`: ISO 8601 timestamp for the dashboard data snapshot.
- `generatedFromCommit`: short git SHA that the dashboard was generated against.
- `tasks`: task-row data owned by downstream task-port stories; empty in this foundation story.
- `phaseTree`: phase-tree data owned by downstream phase-tree stories; empty in this foundation story.
- `lastTouched`: map of taskId to ISO timestamp for the last metadata or status edit.
- `periodic`: map of periodic taskId to intervalDays, lastRunId, and nextDueAt scheduling metadata.
- `cadence`: map of taskId to cadence marker; currently "periodic" for recurring tasks.
- `runs`: chronological history records for completed, failed, partial, deferred, or obsolete task runs.
- `effort`: map of taskId to estimated effort in hours.
- `risk`: map of taskId to low, medium, or high implementation risk.
- `workstream`: map of taskId to dashboard workstream key.
- `sizeBucket`: map of taskId to quick, small, medium, or large estimate bucket.
- `spawnedFrom`: map of childTaskId to parentTaskId for research/audit follow-up lineage.

## Codexu UI override convention

Codexu-specific UI strings live in `.ralph-overview/data.json` under `ui` rather than inside the `@gim-home/ralph-overview-viewer` plugin tree. The plugin renders generic defaults when these values are absent; codexu provides labels, copy preambles, and static-section HTML here to preserve the pre-migration dashboard appearance.

## Mutation discipline

Each downstream story mutates only its own array body (US-002/US-003 append to tasks[]; US-004 appends to phaseTree[]). The top-level object skeleton — braces, key order, comma layout — must not be re-formatted by downstream stories. This isolation lets US-003 and US-004 run in parallel worktrees without merge conflicts on the object literal.
