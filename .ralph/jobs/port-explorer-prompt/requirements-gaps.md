# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Pre-Interview | Post-Interview | Gap Resolved? |
|-----------|--------------|----------------|--------------|
| Goal | clear | clear | yes |
| Scope | clear | clear | yes |
| Criteria | clear | clear | yes |

## Clarifications
No gap-closing questions needed — the feature request is unusually precise:
- **Goal**: fill `explorer.toml` with a paraphrased Explore prompt; smallest delta from §2.1.
- **Scope**: only `codex-rs/core/src/agent/builtins/explorer.toml` (no `role.rs` edit), plus submodule worktree workflow and superproject pointer bump.
- **Criteria**: `cargo build --workspace` green, role parses, 1-min `codex exec` smoke returns sensible output. License paraphrase review is operator-gated.

Auto-mode override: any in-flight decisions get made by the plan with best-judgment defaults, flagged in Open Questions for operator review.

## Remaining Open Questions
None blocking. A few operational defaults the plan adopts (with rationale, surfaced in plan's Open Questions for operator confirmation):
1. Branch name in codex submodule: `feat/explorer-role-prompt` (per Codex research suggestion).
2. Add `sandbox_mode = "read-only"` to the TOML for real runtime enforcement (complements prompt prose).
3. Add `project_doc_fallback_filenames = []` as `omitClaudeMd` analog — provisional; plan flags for operator confirmation.
4. Update the existing `apply_empty_explorer_role_preserves_current_model_and_reasoning_effort` test rather than removing it, plus add one new tiny invariant test asserting `developer_instructions` is non-blank.
5. Update `codex/docs/implementation/patch-surface.md` with a one-line note about the new built-in content (fork-guidance expects upstream-canonical edits to be documented).
6. Reconcile pre-existing `M codex` pointer in the user's working tree before bumping again (plan explicitly handles this in a pre-flight step).
