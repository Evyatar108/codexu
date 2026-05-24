# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Pre-Interview | Post-Interview | Gap Resolved? |
|-----------|---------------|----------------|---------------|
| Goal | clear | clear | yes |
| Scope | partial | clear | yes |
| Criteria | clear | clear | yes |

## Clarifications

**Phase tree treatment:** Include a dedicated `window.OVERVIEW_DATA.phaseTree` structure. The draft's `phaseTreePath` field on tasks is insufficient because the existing tree (overview.html lines 1920–2009) contains structural bullets like `1b.1` and `4a-4m` that have no task IDs. New schema: nested phase/sub-phase nodes that may reference task ids or carry standalone text. Add data-driven render for the tree alongside task rows.

**`<details>` open-state on re-render:** Preserve and restore. Read `document.querySelectorAll('details[open]')` before re-render, re-apply by id after. Plus the existing `codexu-overview-details-state-v2` localStorage persistence already handles cross-load state — re-firing it post-render is cheap. Architect estimate: 5–10 LOC, large UX win.

**`tools/overview/validate.mjs`:** Skipped in this plan. Defer to a follow-up if drift pain emerges. Keeps scope tight and avoids false-positive blocking risk on in-progress edits.

## Remaining Open Questions

None blocking. Two items to confirm during implementation:
- Stale references to "edit overview.html" beyond the named docs — a repo-wide grep sweep is part of US-005.
- The `kanbanCards[]` schema decision (one card has multiple per task) — research confirmed; schema is settled. The implementer must respect that `1b-multidev`, `polish-Fs`, `perf-WS2`, `agent-comms` each render multiple cards.
