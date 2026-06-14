# Requirements Gaps Assessment

## Dimension Ratings

| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | Desired end state is explicit: a default-off visible codex experimental feature makes Git Bash the default Windows shell when detected and enabled. |
| Scope | clear | Scope is bounded to codex inner checkout shell selection, model-facing shell hints, tests, and wrapper registry docs. Launcher explicit `default_shell` remains the custom-path escape hatch. |
| Criteria | clear | Acceptance criteria can be verified with feature registry tests, detector ordering tests, session default-shell tests, shell tool spec tests, docs registry checks, and `cargo check -p codex-core`. |

## Remaining Open Questions

None. The operator approved defaults: auto-detect only, warn on enabled-but-undetected fallback, and keep model-facing shell hints consistent with the active shell.

