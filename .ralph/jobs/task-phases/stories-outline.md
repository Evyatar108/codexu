# Stories Outline: task-phases — Phase-aware status model for codexu roadmap dashboard

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: CSS + JS plumbing for phase + status schema
**Description:** As a roadmap viewer and bookkeeper, I want the dashboard CSS and JS to be ready to read a new `data-task-phase` + `data-task-status` model (with all 10 phase classes defined and JS consumers reading from the attributes, with legacy `.b-*` classes preserved as fail-soft aliases), so that the migration in US-002 can land without breaking section ordering, the Today panel, filter chips, or the kanban summary.
**Acceptance Criteria:**
- [ ] 10 new `.cmd-badge.b-<phase>` CSS classes defined in `plans/overview.html` near the existing badge block at `845-849`, with non-transparent computed backgrounds in both dark (`:root` `7-21`) and light (`@media prefers-color-scheme: light` `22-38`) themes; no two phases in the same phase family resolve to the identical color.
- [ ] `.cmd-status-mod` modifier sub-badge class defined.
- [ ] `PHASE_TO_ORDER_BUCKET` constant introduced near the top of the existing `<script>` block, with `shipped` and `closed` sorted into distinct buckets.
- [ ] `PHASE_TO_FILTER_BUCKET` constant introduced (sibling to ORDER_BUCKET), with `shipped` and `closed` collapsed into the `closed` bucket.
- [ ] `classifyAndOrderCmds()` at `2671-2695` reads `data-task-phase` via `PHASE_TO_ORDER_BUCKET`, falling back to legacy class mapping when the attribute is absent.
- [ ] `classifyCmd()` at `2842-2851`, the multi-axis filter at `3126-3163`, and any Today-panel bucket logic at `962` read `data-task-status` first (status precedence: `blocked` and `paused` override phase) then `data-task-phase` via `PHASE_TO_FILTER_BUCKET`, falling back to legacy class mapping when both attributes are absent.
- [ ] New `renderPhaseBadges()` IIFE added near `2626` that walks every `<details class="cmd">[data-task-phase]`, normalizes the inline `.cmd-badge` class to `cmd-badge b-<data-task-phase>`, and inserts/removes a `<span class="cmd-status-mod">` sibling based on `data-task-status`. Rows with only a legacy `b-*` class (no `data-task-phase`) get `data-task-phase` derived from the inverse of `PHASE_TO_FILTER_BUCKET` and normalized in the same pass. Wrapped in per-row `try {} catch {}`; failures logged to `console.warn` with the row's `data-task-id`.
- [ ] `injectTaskScopeChips()` at `2626-2668` updated to capture both `.cmd-badge` and `.cmd-status-mod` before building `.cmd-scope-cluster`, then append both into the cluster (badge first, modifier last so it sits to the right).
- [ ] `renderPhaseBadges()` invoked before `injectTaskScopeChips()` in the IIFE chain.
- [ ] No change required to `populateKanbanCount` at `2953-2965` (verified counts cards per existing column only).
- [ ] Both existing brittle title-text matchers refactored to read `card.dataset.taskId` instead of substring-matching `title.textContent`: workstream-tagging at `3293-3307` and `linkKanbanToCmds` (`→ command` link injection) at `3334-3355`.
- [ ] Legacy `.b-ready`, `.b-blocked`, `.b-paused`, `.b-closed`, `.b-inprogress` classes remain defined and styled (fail-soft aliases). A hand-crafted test row with only `<span class="cmd-badge b-ready">` (no `data-task-phase`) renders visually identical to today and classifies into the `ready` bucket.
- [ ] No console errors when loading `plans/overview.html` in a browser.

**Dependencies:** None.
**Estimated complexity:** medium.

## US-002: Migrate all 49 command rows + kanban cards per pinned Migration Mapping
**Description:** As a bookkeeper, I want every command row and matching kanban card to carry the new `data-task-phase`, `data-task-status`, and optional artifact attributes per the pinned per-row Migration Mapping table in the plan, so that the dashboard reflects the phase-aware schema and the JS consumers from US-001 classify everything correctly.
**Acceptance Criteria:**
- [ ] Every one of the 49 `<details class="cmd">` data rows (`1417-1882`; NOT the 51 raw grep matches — line `851` is a docstring example, `2799` is a JS comment) carries `data-task-phase` (one of the 10 enum values) and `data-task-status` (one of `ok | blocked | paused`).
- [ ] `grep -c 'data-task-phase="' plans/overview.html` returns **exactly 49**.
- [ ] `grep -c 'data-task-status="' plans/overview.html` returns **exactly 49**.
- [ ] `grep -oP 'data-task-phase="\K[^"]+' plans/overview.html | sort -u` returns **only** the 10 allowed phase values; `grep -oP 'data-task-status="\K[^"]+' plans/overview.html | sort -u` returns **only** `blocked`, `ok`, `paused`.
- [ ] Per-row `data-task-phase` and `data-task-status` values match the Migration Mapping table in the plan (every row's attributes agree with its row in the table, by `data-task-id`).
- [ ] Optional artifact attributes (`data-plan-only`, `data-plan-source`, `data-plan-source-ref`, `data-{brainstorm,plan,implement}-job-id`, `data-plan-review-iterations`, `data-merge-commit`) added where the Migration Mapping table specifies them.
- [ ] On page load, `document.querySelectorAll('details.cmd[data-task-phase]').forEach(d => { const want = 'b-' + d.dataset.taskPhase; const have = [...d.querySelector('.cmd-badge').classList].find(c => c.startsWith('b-')); console.assert(have === want, d.dataset.taskId, have, '!=', want); })` produces zero assertion failures (verifies the `renderPhaseBadges()` IIFE rendered every row consistently).
- [ ] Every kanban card at `1061-1395` (within `sec-kanban` opening at `1043`) carries `data-task-id` matching a command row.
- [ ] Cards display a phase pill that reflects their command row's `data-task-phase`.
- [ ] Both refactored matchers (US-001's workstream-tagging at `3293-3307` and `linkKanbanToCmds` at `3334-3355`) work for every card via `data-task-id` lookup; no console errors / no missing `→ command` jump-links.
- [ ] Typecheck / lint passes for `plans/overview.html` (no automated test infrastructure; verification is grep-based + manual visual).

**Dependencies:** US-001.
**Estimated complexity:** large (49 rows × ~3 attrs minimum each, plus matching kanban-card edits).

## US-003: Reconcile known drift on perf-WS3 and 1a-fork-doc
**Description:** As a roadmap maintainer, I want the inconsistent phase between `plans/overview.html` and `plans/parallel-assignments.md` for `perf-WS3` and `1a-fork-doc` reconciled to the canonical state (both `shipped` per the Migration Mapping table), so that there's no source-of-truth ambiguity going forward.
**Acceptance Criteria:**
- [ ] `perf-WS3` has consistent phase values in both `plans/overview.html` (`data-task-phase="shipped"`) and `plans/parallel-assignments.md` (Phase column = `shipped`).
- [ ] `1a-fork-doc` has consistent phase values in both files (both `shipped`).
- [ ] No other rows show drift between the two files (verifiable via diff of the per-task tables, scoped to the rows touched in this US).

**Dependencies:** US-002 (the attributes must exist in overview.html first).
**Estimated complexity:** small.

## US-004: Update plans/parallel-assignments.md, plans/codexu-roadmap.md, and .agents/skills/roadmap-and-overview/SKILL.md
**Description:** As a bookkeeper or fresh agent reading the docs, I want the front-matter, status table, and operational SKILL to describe the new phase + status model rather than the legacy `b-*`-only model, so the docs match the code on day one.
**Acceptance Criteria:**
- [ ] `plans/parallel-assignments.md` front-matter conventions block (`1-22`) documents the phase enum (all 10 values) + status modifier (`ok | blocked | paused`) + optional artifact field schema.
- [ ] `plans/parallel-assignments.md` per-task status table (`553-583+`) carries explicit `Phase | Status | Plan source | Plan job` columns (replacing the single `Status` column); existing `Commit` column preserved where it is.
- [ ] `plans/codexu-roadmap.md` Standing rules section (`163-174`) carries a one-paragraph "Task phase model" entry that links to `parallel-assignments.md` for the full enum.
- [ ] `.agents/skills/roadmap-and-overview/SKILL.md` updated at all 13 load-bearing line ranges (per plan step 8): `36` (orientation), `49` (close-out summary), `119` (cmd row encoding), `133-135` (When to update what table), `146` (procedure A status field), `161` (procedure A copy-from-existing HTML template), `178` (status table reference), `196` (procedure B class flip), `226` (procedure B dependent unblock), `244` (procedure D paused/blocked), `308` (pitfall about badge-class as source of truth), `315-316` (pitfall about agent badge flips).
- [ ] Every legacy `cmd-badge b-<status>` template in SKILL.md replaced with the two-element pattern (`cmd-badge b-<phase>` primary + optional `.cmd-status-mod` modifier).
- [ ] Procedural workflow shape preserved (only field names + badge template snippets change; the When/Why columns stay).

**Dependencies:** US-001 (schema must be defined to document).
**Estimated complexity:** medium (SKILL.md touches multiple line ranges; parallel-assignments.md table is wide).

## US-005: Smoke test the 4 progression paths on a temporary copy
**Description:** As a release reviewer, I want a verifiable smoke procedure that exercises all 4 task progression paths (brainstorm, standard, fused 1-paragraph, planOnly) on a temporary copy of `plans/overview.html` (NOT the real dashboard), so I can confirm the new model works end-to-end before merging.
**Acceptance Criteria:**
- [ ] Create a temporary smoke copy: `cp plans/overview.html plans/overview.smoke.html` (verify the `.smoke.html` suffix is ignored by git; if not, use an out-of-tree path like `/tmp/overview.smoke.html` and load via `file://`).
- [ ] **Brainstorm path on `agent-comms`:** in the smoke copy, flip `data-task-phase` through `brainstorm-ready` → `brainstorm-in-progress` → `brainstorm-review` → `plan-ready`. Reload the smoke copy between each transition; verify the badge color flips correctly (via `renderPhaseBadges()`), the filter chips classify the row correctly, the Today panel buckets it correctly, and the section ordering moves it as expected.
- [ ] **Standard path on `1b-multidev`:** flip through `plan-ready` → `plan-in-progress` → `plan-review` → `impl-ready` → `impl-in-progress` → `shipped`. Same verifications between each transition.
- [ ] **Fused (1-paragraph) path on `codex-claude-md-autoload`:** flip through `plan-ready` → `impl-in-progress` → `shipped` (skipping `plan-in-progress`/`plan-review`/`impl-ready`). Same verifications.
- [ ] **planOnly path on `codex-parity-audit`:** flip through `plan-ready` → `plan-in-progress` → `plan-review` → `closed`. Same verifications.
- [ ] Smoke procedure also verifies the precedence rule on at least one `data-task-status="blocked"` row (e.g., `perf-WS2`, `3b-agents`, `agent-comms`): `classifyCmd()` returns `blocked`, the multi-axis filter classifies it as `blocked`, the section ordering sorts by phase (alongside same-phase `ok` rows), and the Today panel buckets it as `blocked`.
- [ ] Backwards-compat smoke: a hand-crafted test row in the smoke copy with only `<span class="cmd-badge b-ready">` (no `data-task-phase`) renders visually identical to today's `b-ready` rows and classifies into the `ready` bucket.
- [ ] Both dark and light themes verified (DevTools > Rendering > Emulate CSS media `prefers-color-scheme`); no visual regression in kanban, command rows, Today panel, filter chips, or the spawn-relationship pills.
- [ ] Discard the smoke copy: `rm plans/overview.smoke.html` (or remove the out-of-tree copy). The real `plans/overview.html` is unaffected.
- [ ] Record pass/fail per transition and per theme in the PR description.

**Dependencies:** US-001, US-002, US-003, US-004 (the model + migration + docs must all be in place).
**Estimated complexity:** small.
