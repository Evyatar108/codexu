# Stories Outline — port-plan-and-verification-roles

Single-story bundle. Decomposition was considered (see plan.md §5 "Bundle vs split") and rejected: the two roles share the same registry block, match arm, SANDBOX PATCH marker, and invariant row. Splitting would force two near-duplicate replant entries that always need to be applied together.

## Story 1 — Register plan + verification built-in roles

**Scope:** plan.md §3.1 IP-1 through IP-8.

**Acceptance:** plan.md §9 items 1–9 (all must pass).

**Files touched:**
- `codex/external/repos/codex-patched/codex-rs/core/src/agent/role.rs` (modify — ~30 LoC added)
- `codex/external/repos/codex-patched/codex-rs/core/src/agent/role_tests.rs` (modify — 3 tests added)
- `codex/external/repos/codex-patched/codex-rs/core/src/agent/builtins/plan.toml` (new — ~25 LoC)
- `codex/external/repos/codex-patched/codex-rs/core/src/agent/builtins/verification.toml` (new — ~35 LoC)
- `codex/external/repos/codex-patched/codex-rs/core/BUILD.bazel` (probe — extend `compile_data` glob if not already matching `src/agent/builtins/*.toml`)
- `codex/codex-rs-overlay/codex-invariant-tests/tests/builtin_roles.rs` (new — ~30 LoC)
- `codex/docs/implementation/patch-surface.md` (modify — §14 row + §15 paragraph)
- Submodule gitlink bump + `.ralph/jobs/port-plan-and-verification-roles/plan.md` promotion at codexu wrapper level.

**Verification gates (in order):**
1. `cd codex/external/repos/codex-patched/codex-rs && cargo check --workspace` (~6 min)
2. `cd codex/external/repos/codex-patched/codex-rs && just test -p codex-core built_in`
3. `cd codex && cargo test -p codex-invariant-tests builtin_roles`
4. `cd codex && bash scripts/audit_network_calls.sh`
5. Manual smoke: spawn an agent with `role: "plan"` and confirm developer-instructions are injected.

**Out-of-scope (separate tasks):**
- Filling `explorer.toml` (tracked as `port-explorer-prompt`).
- `audit-general-purpose-vs-worker` (separate task).
- Adding per-role tool gating in TOML (codex schema does not currently support; would be a separate seam-design task).

## Suggested Decomposition

Not applicable — single-story bundle.

```json
{
  "clusters": [
    {
      "id": "cluster-1",
      "stories": ["story-1"],
      "rationale": "Single atomic commit; no parallel execution opportunity."
    }
  ]
}
```
