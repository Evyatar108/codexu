# Requirements Gaps Assessment

## Dimension Ratings

| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | Desired end state is explicit: lead/orchestrator tab title becomes `♔ <name> (<crew>)`. |
| Scope | clear | Scope is limited to crews lead assignment and SessionStart rehydration; member tabs, new roles, customization, and cross-platform terminal APIs are out of scope. |
| Criteria | clear | Seed provides visible title, persistence, non-WT behavior, member untouched, unit test, and CHANGELOG smoke criteria. |

## Remaining Open Questions

- Implementation must empirically verify whether `wt.exe rename-tab` persists over subsequent Copilot title updates on the dev box.
- Exact original-title restoration on `/crews-assign-role none` is intentionally deferred; the accepted v2.2.0 behavior is to leave the last title in place.
