# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Rating | Inference |
|---|---|---|
| Goal | clear | The desired end state is that retained live rendering no longer fully evicts the immediately preceding committed message when the active tail is tall. |
| Scope | clear | Scope is limited to fork-owned retained viewport row allocation, one retained-viewport regression test, and the inner patch-surface registry row. |
| Criteria | clear | Success is verifiable with a retained-viewport regression test, unchanged default-off feature behavior, and focused `codex-tui` verification. |

## Remaining Open Questions
None for planning. The lead will decide whether the implementation rides `ralph/codex-v8-int` or a dedicated branch.
