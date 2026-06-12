# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | The end state is explicit: Codex-facing crews and Ralph instructions must stop using Copilot-style async/background wording and instead describe Codex-native exec/yield/session semantics. |
| Scope | clear | The investigation and prompt enumerate the exact plugin surfaces in scope (five crews hooks and the Ralph codex generator/regenerated `.codex-plugin/**` artifacts) and explicitly exclude redoing the investigation, changing ralph-overview, or doing the lead-owned codexu pointer bump. |
| Criteria | partial | [INFERRED] Success includes both static artifact assertions and live behavior checks: generated Codex artifacts must lose stale async/background terms, and the load-bearing crews listener-arm path should be dogfooded on Codex before merged. |

## Remaining Open Questions
- None blocking the plan. The only residual execution choice is where to enforce the live Codex dogfood checkpoint in the eventual impl flow; this plan treats it as a required validation step before the crews ship is considered merge-ready.

