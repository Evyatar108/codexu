# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Pre-Interview | Post-Interview | Gap Resolved? |
|-----------|--------------|----------------|--------------|
| Goal | clear | clear | yes (source doc fully specifies the desired end state) |
| Scope | clear | partial | (pending Q1) source doc focuses on CSS/markup; research found JS classifier + filter + Today-panel coupling that may also need updating |
| Criteria | clear | clear | yes (source doc's "Acceptance" section enumerates verifiable criteria) |

## Clarifications

Source doc supplies goal/scope/criteria comprehensively. One scope-expansion question for the operator:

- Q1: Codex research recommended using `data-task-phase` / `data-task-status` HTML attributes as the schema source of truth (with CSS badges as renderers) instead of pure CSS classes. This approach naturally enables updating `classifyAndOrderCmds()` / `classifyCmd()` / toolbar filters / Today panel to read phase from attributes. Without this, the JS will drift from the new badge classes. The source doc doesn't explicitly call out the JS-coupling scope.

## Remaining Open Questions

- Whether to update `.agents/skills/roadmap-and-overview/SKILL.md` in this plan or track as follow-up
- Whether to reconcile the existing doc drift (`perf-WS3` and `1a-fork-doc` shipped in overview.html but in-progress in parallel-assignments.md) as part of migration
