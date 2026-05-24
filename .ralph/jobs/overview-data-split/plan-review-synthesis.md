# Phase 4 Review Synthesis

## Claude Plan Review (summary)
3 High + 2 Medium + 1 Low. AC-quality focused. Caught: Today-panel binding not verified in AC; prompt-body decode strategy missing from AC; open-state test methodology not concrete; grep AC ambiguous due to overview.html's own self-reference comment; render-order coordination between US-003/US-004 not specified; spawnedFrom map redundancy is acceptable but lacks consumer list.

## Codex Plan Review (summary)
4 High + 6 Medium. Factual + schema focused. Caught: task count is 51 not 49 (and `data-plan-only`=7, `data-merge-commit`=7); JSON block actually ends at line **2612** not 3529 — plan's range would delete most of the main script; `meta.generatedFromCommit` shape breaks existing consumer at line 3540; `kanbanCards[]` schema with `column/titleHtml/subHtml` can't round-trip 33 `.card-meta` blocks, `class="card closed"`, inline styles, pills; `phaseTree[]` tagged-union can't preserve `.phase-grid`/`.phase-head`/`.item-name open|deferred|donefade|closed` display states; no `DOMContentLoaded` wrapper exists — plan's wording is wrong; `plans/overview-vite-react.md` still uses stale `?id=`; grep target too narrow (also needs `roadmap-data`, `lastRanAt timestamp` phrases at `parallel-assignments.md` lines 225, 235, 242, 247); US-005 ordering conflict with risk-section guidance; US-003/US-004 share `OVERVIEW_DATA` skeleton — need owner or merge checkpoint; "renders identically" + "no `<div class="card">` blocks" both insufficiently specific.

## Copilot Plan Review
**Failed (exit 127, empty output).** Skipping; per skill rules, external reviewer failures are non-blocking.

## Independent verification of Codex's facts
Confirmed all counts and line ranges with direct `grep`/`sed` against `plans/overview.html`:
- 51 `<details class="cmd">` rows (Codex right)
- 7 `data-plan-only` rows, 7 `data-merge-commit` rows (Codex right)
- JSON block `<script type="application/json" id="roadmap-data">` is lines 2180–2612 (Codex right; researcher was wrong about 3529)
- Main inline `<script>` block: lines 2614–3767
- Zero `DOMContentLoaded` matches in `overview.html` (Codex right)
- 33 `.card-meta` instances (Codex right)
- `overview-vite-react.md` lines 66 + 147 still say `?id=` (Codex right)
- `parallel-assignments.md` lines 225, 235, 242, 247 contain stale "roadmap-data JSON" / "lastRanAt timestamp" phrasings (Codex right)
- `roadmap-data` referenced in `.agents/skills/roadmap-and-overview/SKILL.md`, `plans/agent-view-research.md`, `plans/parallel-assignments.md`

## Consensus
- Acceptance criteria need to be sharper: count, prompt fidelity, render-identity checks (Claude + Codex independently arrived here).
- Grep AC is wrong/ambiguous as written (Claude + Codex both flagged different aspects of the same AC line).

## Divergences
- Codex caught factual line-range errors that Claude missed entirely.
- Claude caught the Today-panel and open-state-test AC gaps that Codex didn't surface.
- No contradictions.

## Recommended amendments
The plan has correctness bugs (line ranges, task count) and schema gaps (kanbanCards rich content, phaseTree display states, meta wrapper). Fix sequence:
1. **F-001/F-009 (count)**: Update AC and US-003 from 49/46 to 51/48 + add no-duplicate-id AC.
2. **F-002 (line range)**: Correct JSON range to 2180–2612 throughout plan. Update Inline JS range from "3530–3767" to "2614–3767". This is the highest-risk error.
3. **F-003 (meta wrapper)**: Keep `generatedAt`/`generatedFromCommit` at top level OR rewrite consumer at line 3540 in US-001. Recommend keeping top-level.
4. **F-004 (kanban schema)**: Replace `kanbanCards[].{titleHtml, subHtml}` with `kanbanCards[].{column, html}` where `html` is the full trusted card inner-HTML (or include explicit `metaHtml` + `pillsHtml` + a `cardClass` slot for `card closed`).
5. **F-005 (phase tree schema)**: Replace tagged union with `phaseTree[]` of phase nodes each carrying nested `nodes[]` of `{kind, html, ...}` where `kind: "task-ref"|"raw"` and `raw` carries a trusted HTML fragment for non-task structural nodes. Preserve `.item-name open|deferred|donefade|closed` via a `state` field.
6. **F-006/F-007/F-008/F-017/F-018 (AC quality)**: Sharpen AC. Today-panel verification, prompt-decode explicit, open-state test concrete, "renders identically" replaced with parity-count + hash-nav + filter-functional checks, "no static card elements in authored body" wording.
7. **F-010 (render order)**: Replace "DOMContentLoaded handling" with "synchronously, before the first DOM-walking IIFE".
8. **F-011 (vite-react sibling)**: Add `plans/overview-vite-react.md` update to US-005 scope (fix `?id=`→`?tasks=` references).
9. **F-012 (grep targets)**: Broaden US-005 stale-doc sweep to `roadmap-data`, `generatedFromCommit`, `lastRanAt timestamp in plans/overview.html`, plus the existing `edit plans/overview.html`.
10. **F-013 (US-005 ordering)**: Move US-005 to depend on `full-task-port` AND `phase-tree-port` (Phase 4), so the SKILL examples reference the final schema. Resolves the inconsistency with the risk-section guidance.
11. **F-014/F-015 (US-003/US-004 coordination)**: US-002 lays the foundation with explicit section markers `// ===== renderTasks() =====` and `// ===== renderPhaseTree() =====` (empty stub in US-002, filled in US-003 and US-004 respectively). Both stories then own a disjoint section.
12. **F-016 (grep AC)**: Clarify the AC to "outside `plans/overview.html` itself".

After fixes: re-review with Claude only (Codex available but per user, only Copilot is off; let's keep Codex on for one more round to verify factual fixes).
