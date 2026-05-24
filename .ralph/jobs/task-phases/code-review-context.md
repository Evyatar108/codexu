# Code review context — task-phases

Notes captured during Phase 5a code review of the task-phases worktree (against `origin/main`).

## Codebase conventions observed

- `plans/overview.html` is a single-file dashboard with no build step. Acceptance is grep-based + manual browser verification. No automated test infrastructure exists for `plans/*.html`.
- The dashboard's CSS uses theme tokens (`--accent`, `--info`, `--warn`, `--ok`, `--done`, `--purple`, `--muted`, `--border`) that resolve differently per `prefers-color-scheme`. New `.cmd-badge.b-<phase>` rules must keep the token-based palette so dark/light parity holds.
- IIFE order in the main `<script>` block is load-bearing. Several IIFEs depend on each other's DOM mutations (e.g., `renderPhaseBadges` populates `.cmd-status-mod`, then `injectTaskScopeChips` relocates badge+mod into `.cmd-scope-cluster`). Adding or reordering IIFEs requires reading the call chain end-to-end.
- Kanban cards can share a `data-task-id` value when multiple cards roll up to one command row (e.g., three `1b-multidev` sub-task cards point to a single `cmd-1b-multidev`). `linkKanbanToCmds` and `injectKanbanPhasePills` handle this correctly — each card gets its own arrow link/pill resolving to the shared command row.

## Phase model — load-bearing relationships

- `data-task-phase` is the durable lifecycle position (10-value enum). `data-task-status` is a 3-value modifier (`ok` | `blocked` | `paused`).
- Two parallel maps are required because `shipped` vs `closed` differ between order (distinct buckets) and filter (collapsed). Keeping them as **independent constants** (not derived from each other) prevents future re-derivation drift — flagged in plan.md risk #1.
- Precedence rule: `data-task-status` `blocked`/`paused` overrides phase for filter/Today/kanban-bucket assignment; phase only for sort order. Documented as code comments above the `PHASE_TO_*_BUCKET` constants — preserve this comment when refactoring.
- The visible badge is a **render artifact** — `renderPhaseBadges()` flips className from `data-task-phase`, and `.cmd-status-mod` is inserted/removed from `data-task-status`. **Bookkeepers must NOT dual-write** the badge class and the data attribute; the IIFE eliminates that drift.

## Gotchas / cross-cutting concerns

- The badge's text content is NOT touched by `renderPhaseBadges()` — only its className. Stale text like `🔒 blocked` or `⬜ ready` will persist on rows whose phase has been flipped via attribute, producing visually inconsistent badges (see Finding F-001). Future bookkeeper procedures (SKILL.md Procedure B step 2) need to update both the attribute AND the badge text, or the renderer needs to derive text from phase.
- Three of the ten phase enum values (`closed`, `plan-ready`, `shipped`) are the only ones currently used in `data-task-phase=` on the 49 rows. The other 7 (`brainstorm-*`, `plan-in-progress`, `plan-review`, `impl-ready`, `impl-in-progress`) are forward-looking and won't appear until tasks transition into them. Validation grep checks for the enum should not require all 10 values to appear in the current snapshot.
- `legacyPhaseFromBadge()` covers the fail-soft path for legacy rows. Its inverse mapping (`LEGACY_STATUS_TO_PHASE`) defaults blocked/paused → `plan-ready` — a reasonable fallback but loses information. Acceptable because the live dashboard's migration is complete; legacy-only rows would only appear if a bookkeeper forgets the new attributes on a new task.
- `injectKanbanPhasePills` reads the cmd row's `data-task-phase` via a `cmdsById` index. If a kanban card's `data-task-id` doesn't resolve to a real cmd row, the card silently gets no phase pill (correct fail-soft).

## Relevant files

- `plans/overview.html` — single-file dashboard. All CSS + HTML + JS lives here.
- `plans/parallel-assignments.md` — canonical phase enum + status table schema docs.
- `plans/codexu-roadmap.md` — Standing rules > Task phase model paragraph.
- `.agents/skills/roadmap-and-overview/SKILL.md` — bookkeeper SKILL with updated Procedure A/B/D snippets.
