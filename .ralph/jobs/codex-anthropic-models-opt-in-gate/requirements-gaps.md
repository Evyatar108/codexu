# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | Operator stated the end state explicitly: Anthropic/Claude OPT-IN only, OFF by default; default behavior identical to pre-D-001. |
| Scope | clear | Four surfaces enumerated (filter, routing, /model picker, sub-agents v1+v2); GPT /responses byte-unchanged; no version bump (separate release task). |
| Criteria | clear | Acceptance is verifiable per-surface in both gate states; refined to concrete assertions in Phase-4 review (F-002/F-005/F-007). |

## Remaining Open Questions
- Env-var NAME (`CODEX_ENABLE_ANTHROPIC` is the [INFERRED] default; operator may prefer another idiom).
- Accepted env truthy values ([INFERRED] `on`/`1`/`true`/`yes`, case-insensitive).
- US-005/US-006 expected test-only; a small production fix may surface for the inherited-Claude error path.
(Cache-safe filter seam was an open question; RESOLVED to a `GatedModelsManager` decorator via Phase-4 review F-001.)
