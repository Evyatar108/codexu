# Docs review context — task-phases

Notes captured during Phase 5b docs review of the task-phases worktree (against `origin/main`, round 1).

## Scope of the diff (docs surface)

The diff touches 4 files, 3 of which are tracked markdown the docs reviewer must consider:

- `.agents/skills/roadmap-and-overview/SKILL.md` — already updated in-scope by US-004. Phase enum + status modifier wired into orientation block, Procedure A row template, Procedure B close-out, Procedure D pause/block, and pitfalls list. The single `data-task-id` example block in Procedure A now includes `data-task-phase="plan-ready"` and `data-task-status="ok"`.
- `plans/codexu-roadmap.md` — already updated in-scope by US-004. Standing rules section adds a "Task phase model" bullet pointing at parallel-assignments.md as the authoritative enum source.
- `plans/parallel-assignments.md` — already updated in-scope by US-004. Preamble adds the 10-value phase enum + 3-value status modifier definition and the optional artifact-attribute list. The status table grew from 4 columns (`Tab | Task | Status | Commit`) to 7 (`Tab | Task | Phase | Status | Plan source | Plan job | Commit`).

The fourth changed file is `plans/overview.html`, which is HTML (not a docs surface for this reviewer).

## Cross-reference findings

Searched every tracked `.md` file (excluding `.ralph/`) for the legacy badge vocabulary that this diff retires:

- `b-ready` / `b-blocked` / `b-paused` / `b-closed` / `b-inprogress` / `b-inflight` — only stale residue is in `plans/crews-integration.md` (lines 132 + 139, both referencing `b-inflight`). Captured as F-001.
- `cmd-badge` / `cmd-pre` / `cmd-warn` / `details class="cmd"` — appear in SKILL.md (updated this round), parallel-assignments.md (updated this round), and crews-integration.md (the `cmd-warn blocked` banner phrasing is still current — that selector did not change in this diff). No findings.
- `data-task-phase` / `data-task-status` / `data-task-id` / `data-task-scope` — only mentioned in the three updated docs. No stale doc treats these as new yet because no other tracked doc previously named them.

## Notes for future docs reviews

- `plans/crews-integration.md` is a forward-looking design doc that quotes the live SKILL.md verbatim in places. Whenever the SKILL.md wording it quotes changes, those quoted passages drift out of sync. Future plans that touch SKILL.md should grep `plans/crews-integration.md` for the affected phrase before landing.
- `packages/happy-server/CLAUDE.md` and `.agents/skills/happy-upstream-sync/SKILL.md` mention `plans/parallel-assignments.md` by name (referencing tracked task IDs like `userid-cleanup` and `codex-upstream-rebase`). These references are about task identity, not the dashboard schema — they remain accurate after this diff.
- Date claims (`as of 2026-04-19`, etc.) were not invalidated by this diff; no date-staleness findings emitted.

## Severity rationale

The single F-001 finding is **Medium** under the rubric:
- Not Critical: no safety, security, data-integrity, or repo-rule violation.
- Not High: no acceptance criterion is invalidated. US-004's AC only required updating the three docs that *are* in scope (SKILL.md, codexu-roadmap.md, parallel-assignments.md); crews-integration.md is not listed.
- Medium-floor: a downstream doc that quotes the new-stale SKILL.md text will mislead future readers attempting the crews migration — leaving it open ships incorrect cross-references but does not break the build or any AC.
