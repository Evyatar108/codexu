# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | Feature request specifies exact files, line numbers, schema shape, behavior on absent/malformed input, and 3 verifiable test cases. End state is unambiguous. |
| Scope | clear | In-scope: helper + runCodex.ts edit + 3 tests + roadmap update. Out-of-scope is implicit (no upstream codex changes; reserved-name policy and type-stripping uncovered by research and adopted as autonomous decisions, documented in plan). |
| Criteria | clear | 3 named tests with explicit assertions, vitest command provided, single-commit constraint, cross-package typecheck stays green, roadmap bullet flipped. All verifiable. |

## Clarifications
No gap questions needed — all three dimensions clear from the feature request itself.

Two emergent considerations surfaced by Phase 2 research that the original spec did not pin down:
1. **Reserved-name policy for the `happy` bridge entry.** 2-of-3 reviewers (Codex, Copilot) recommend "happy stays authoritative; project entry named `happy` is skipped with a warning". Adopted as autonomous decision and documented in the plan. (Alternative: project keys override — rejected because the bridge is platform infrastructure the user did not opt into.)
2. **Codex Rust `McpServerConfig` does not accept a literal `type` field.** Codex plugin loader strips it before deserializing; Happy must do the same. Validate Claude-shape (with optional `type`), but omit `type` from the object handed to `client.startThread/resumeThread`. Surfaced by Codex research; adopted as autonomous decision in the plan.

## Remaining Open Questions
- Roadmap "delivered" marker convention — adjacent delivered bullets must be inspected at implementation time to match the existing visual convention (e.g., strikethrough vs. inline "delivered" tag). [INFERRED] from research finding that the format is not uniform.
