# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Pre-Interview | Post-Interview | Gap Resolved? |
|-----------|--------------|----------------|--------------|
| Goal | clear | clear | yes |
| Scope | partial | clear | yes |
| Criteria | partial | clear | yes |

## Clarifications

### Q1: Copy behavior
**Decision:** Match current preamble-injected copy.

- Port `BOOKKEEPING_PREAMBLE` and other scope preambles from `plans/overview.html:1725-1761` verbatim into `src/data/copyPreambles.ts`.
- Copy emits `preamble + "\n\n" + task.command.planPrompt` (or whatever shape the current `copyCommand()` produces).
- AC reworded: "Copy-Command button writes text that matches what today's `plans/overview.html` writes byte-for-byte" — verifiable via snapshot test.
- Strict byte-for-byte planPrompt (no preamble) is rejected as a UX regression.

### Q2: Phase-tree state class derivation
**Decision:** Add 'deferred' for blocked/paused (deliberate UX improvement over 9f81c1f8 baseline).

- Mapping: `shipped → donefade`, `closed → closed`, `status==blocked || status==paused → deferred`, else → `open`.
- This is a VISIBLE behavior change from baseline 9f81c1f8 — the phase tree will now surface stuck work.
- Visual-parity AC reworded: "renders identically to `plans/overview.html` at 9f81c1f8 EXCEPT the phase tree, which additionally applies the `deferred` CSS class to task-refs whose underlying task has `status: blocked | paused`. All other render output is pixel-identical."
- CSS for `.task-ref.deferred` is already present in overview.html — port verbatim, no new CSS needed.

### Q3: Workspace registration
**Decision:** Update both `pnpm-workspace.yaml` AND root `package.json` → `workspaces.packages`.

- PRD AC adds: "Both `pnpm-workspace.yaml` and root `package.json`'s `workspaces.packages` list include `tools/overview-viewer`."
- Matches the existing repo pattern (Copilot research finding).

## Remaining Open Questions

None. All three surfaced ambiguities resolved.

## Notes from research that didn't need user input
- `mergeCommit` populated on 8 tasks (not 6 as feature request said) — corrected in TS schema notes; doesn't affect AC.
- Line endings are MIXED `\r\n` and `\n` (not pure CRLF as feature request said) — corrected in pitfall list.
- `injectWorkstreamPills()` is broader than name suggests (cadence + datasets) — captured in component decomposition.
- `phaseTree.task-ref.state` legacy field still in shipped data — TS schema marks `state?` optional; React renderer ignores.
- Existing localStorage keys (`codexu-overview-details-state-v2`, etc.) ported verbatim to avoid churn.
