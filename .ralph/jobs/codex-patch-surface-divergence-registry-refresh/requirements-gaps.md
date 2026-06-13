# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | - |
| Scope | clear | - |
| Criteria | clear | [INFERRED] Success means the current `0.135.0-copilot-api.*` line is reflected in `patch-surface.md`, every missing live patch family gains section 14 + section 15 coverage, the two unmarked source seams gain `SANDBOX PATCH` anchors, the stale paste-burst divergence is retired or corrected, and focused guard coverage is updated where needed. |

## Remaining Open Questions

- Should the refreshed `patch-surface.md` header preserve the existing "series" wording (`0.135.0-copilot-api.*`) or move to the exact maintained release tag now that HEAD is `release/0.135.0-copilot-api.5`?
- Do the retained-viewport and focus-leak-recur families need new explicit `audit_invariants.sh` checks, or will refreshed section 14/15 coverage plus the existing inline markers and focused tests be sufficient?
