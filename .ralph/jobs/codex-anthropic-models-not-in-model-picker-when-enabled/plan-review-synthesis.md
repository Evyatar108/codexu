# Plan Review Synthesis

## Review Inputs

- Source re-check of the committed investigation at `.ralph/investigations/codex-anthropic-models-not-in-model-picker/findings.md`.
- `cache-seam-researcher` read-only brief.
- `cache-fix-architect` read-only brief.

## Consensus Findings

### F-001: Do not rely on the gate wrapper to restore missing Claude rows

Severity: High

The `GatedModelsManager` is a removal-only defense. Once `CopilotModelsEndpoint` persists a feature-off, post-filtered model list, chat-only Claude rows are absent from the cache and cannot be reconstructed by turning the gate on later.

Resolution: The plan requires a cache identity mismatch before cached models are applied and explicitly avoids picker/wrapper filter changes.

### F-002: Preserve steady-state cache hits

Severity: Medium

A naive fix could force a `/models` refetch on every startup and erase the 300 second TTL benefit.

Resolution: The plan requires a matching-identity fresh-cache test that proves no second fetch happens when the gate/provider identity is unchanged.

### F-003: Patch-surface documentation is required

Severity: Medium

The fix edits upstream-canonical Rust crates under `external/repos/codex-patched/codex-rs`, so the codex fork guidance requires SANDBOX PATCH markers and patch-surface documentation.

Resolution: The plan includes `codex/docs/implementation/patch-surface.md` and SANDBOX PATCH comments in the acceptance criteria.

## Result

All review findings are fixed in `plan.md` and represented in `plan-review-findings.json`.
