# Requirements Gaps Assessment

## Dimension Ratings

| Dimension | Rating | Inference |
|---|---|---|
| Goal | clear | The desired end state is concrete: enabling `Feature::AnthropicModels` and restarting within the 300s models-cache TTL must still make eligible Claude rows appear in `/model`. |
| Scope | clear | The scope is limited to model-cache eligibility/metadata plus Copilot endpoint identity and tests. Picker filtering, transport routing, and unrelated model-fetch semantics are out of scope. |
| Criteria | clear | Success is verifiable with a no-network regression test: a feature-off cache must not satisfy a feature-on `OnlineIfUncached` catalog read, while a matching gate identity must preserve cache hits. |

## Remaining Open Questions

- The lead must decide whether implementation lands on the accumulation branch `ralph/codex-v9-int` or a dedicated branch before the inner codex checkout is edited.
