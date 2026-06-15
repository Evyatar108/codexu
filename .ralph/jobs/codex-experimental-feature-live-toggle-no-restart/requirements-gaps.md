# Requirements Gaps Assessment

## Dimension Ratings

| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | The desired end state is exactly three experimental features applying live after `/experimental` acceptance. |
| Scope | clear | In scope: `AnthropicModels`, `LegacyPasteBurstHeuristic`, `UserMessageStyling`. Out of scope: general framework, restart-bound features, already-live features. |
| Criteria | clear | The prompt provides concrete same-session `/model`, paste-burst, and styling behavior plus test/manual-repro expectations. |

## Remaining Open Questions

- None blocking. The only runtime caveat is account-dependent availability of Claude rows in the Copilot `/models` response; fixture-backed tests should prove the code path, and manual smoke should be phrased conditionally on the account receiving Claude rows.
