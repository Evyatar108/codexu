# Requirements Gaps Assessment

## Dimension Ratings

| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | The goal is an accurate through-.8 patch-surface registry for the upcoming `codex-upstream-rebase-to-0.139`. |
| Scope | clear | Scope is explicitly dual-surface: wrapper registry/guards plus marker-only inner source anchors. |
| Criteria | clear | Success can be verified by exact header/base update, patch row inventory, marker audit, stale-row retirement, and audit scripts. |

## Remaining Open Questions

- The lead decides whether inner marker anchors land on `ralph/codex-v9-int` or a fresh inner branch.
- The implementation must avoid staging the inner submodule's vestigial `docs/implementation/patch-surface.md` drift; the authoritative wrapper registry is `codex/docs/implementation/patch-surface.md`.
