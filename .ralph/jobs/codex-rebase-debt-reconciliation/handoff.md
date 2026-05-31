# codex-rebase-debt-reconciliation — handoff

## Status

**ship-blocked-properly** (intentional pause, not failure). Scoped work shipped on
topic branch; deeper architectural rebase debt requires fresh-rebase-resume work.

## What shipped

Topic branch: `ralph/rebase-debt-reconciliation-impl` on
`Evyatar108/codex-openai-fork` (inner submodule). Base: `bd98f7751`. Three
commits, all tagged `rebase-debt-fix:` prefix, all targeting the v0.135.0
upstream rebase squash residue.

| SHA | Files | LoC | What it fixes |
|---|---|---|---|
| `8ca0a3e5c` | `tools/src/tool_config.rs`, `model-provider/src/copilot_models_endpoint.rs` | +13/-4 | Cherry-pick of prior impl-port-plan-and-verification-roles fix (3ff71f000): restore 11 lost imports + delete dead `ApplyPatchToolType::Function` arm. Plus dedup of `default_service_tier: None` (3-way merge auto-stacked two copies). |
| `494219ed4` | `core-plugins/src/remote.rs` | +15 | SANDBOX-PATCH stub for `group_remote_installed_plugins_by_marketplaces`. Pure data fn dropped by squash; stub returns `Vec::new()` (behavior-equivalent because input is always empty via existing SANDBOX-stubbed `fetch_remote_installed_plugins`). Preserves network-suppression invariant at the fetch boundary. |
| `5726e6f08` | `core/src/tools/spec_plan.rs` | +63/-83 | (a) Re-port 1st orphan block (lines 659-714 pre-edit) — 4 registration groups: SpawnTopLevelSession (SANDBOX PATCH plugin-scope-axis), multi-agent V2, multi-agent V1, agent_jobs — from old `builder.register_handler(Arc::new(X))` API to new `planned_tools.add(X)` API. (b) Delete 2nd orphan block (lines 94-129) as dead code (already covered by `add_shell_tools`). (c) Forward-port D-002 SANDBOX PATCH (`AwaitBackgroundCompletionHandler` registration) into `add_shell_tools`'s UnifiedExec branch — was dropped entirely by the squash. |

**Wrapper-side:** topic branch `ralph/rebase-debt-reconciliation` exists at
`D:/harness-efforts/codexu/.ralph/jobs/codex-rebase-debt-reconciliation/codex-worktree/`
with only the inevitable submodule gitlink bump. **NOT pushed** per "lead-only-merge"
discipline — lead handles wrapper FF + codexu submodule bump.

## Disposition of pre-existing followup tasks

| Followup task | Disposition |
|---|---|
| `codex-rebase-core-plugins-manager-dangling-call` | **partially-addressed.** Mechanical fix shipped in `494219ed4`. If a fresh rebase introduces a different upstream variant that needs real grouping logic, this followup may need to re-open. |
| `codex-rebase-spec-plan-malformed-function` | **partially-addressed.** Orphan #1 re-ported + orphan #2 deleted in `5726e6f08`. The deeper "spec_plan.rs is missing PlannedTools type" issue is NOT addressed and falls under the new task below. |

## What's NOT shipped (the blocker)

`cargo check --workspace` still fails on `codex-core` (30 errors). Inventory:

### Category Z — DEEPER REBASE-INCOMPLETENESS (architectural; needs fresh upstream context)

- **Z1.** `PlannedTools` type referenced ~14 times in `core/src/tools/spec_plan.rs`
  (all the `add_*` helper fn signatures: `add_core_utility_tools`, `add_shell_tools`,
  `add_mcp_resource_tools`, `add_mcp_runtime_tools`, `add_dynamic_tools`,
  `add_extension_tools`, etc.) but defined NOWHERE in the workspace. The rebase
  squash imported the upstream rust-v0.135.0 *consumer-side* tool-registration
  refactor (the `planned_tools.add(X)` API) but DROPPED the *producer-side*
  module(s) that define `PlannedTools` + its methods (`.add(X)`,
  `.add_dispatch_only(X)`, `.add_with_exposure(X, ToolExposure)`,
  `.add_hosted_spec(spec)`, etc.).
  Pre-rebase tree (93d915e66) had ZERO refs to `PlannedTools` — entirely upstream.

- **Z2.** `add_collaboration_tools` fn referenced at `core/src/tools/spec_plan.rs:501`
  but defined nowhere. Same root cause as Z1.

- **Z3.** `core/src/tools/handlers/multi_agents/spawn.rs:218` and
  `core/src/tools/handlers/multi_agents_v2/spawn.rs:242` use the old
  `ToolHandler` trait method shape (`async fn handle(...) -> Result<Self::Output, ...>`)
  but `CoreToolRuntime` (defined at `core/src/tools/registry.rs:48` as
  `pub(crate) trait CoreToolRuntime: ToolExecutor<ToolInvocation>`) has no `handle`
  method or `Output` associated type. These are upstream files (not fork SANDBOX
  PATCH) — the squash imported the new `impl CoreToolRuntime for Handler` block
  but left the old `handle()` body inside.

### Category C — fork-file trait migration (mechanical, but blocked by Z3 scope clarity)

- **C1.** `core/src/tools/handlers/spawn_top_level_session.rs` (fork SANDBOX PATCH
  plugin-scope-axis): lines 6-7 unresolved imports (`crate::tools::registry::ToolHandler`,
  `ToolKind`), line 42 ambiguous associated type. Uses pre-rebase
  `ToolHandler`+`ToolKind` API. Needs migration to whatever shape upstream V2 spawn
  handlers settle on (gated on Z3 resolution).

- **C2.** `core/src/tools/handlers/unified_exec/await_background_completion.rs`
  (fork SANDBOX PATCH D-002): same — old `ToolHandler`/`ToolKind` imports (lines
  7-8) + missing `effective_max_output_tokens` helper import (line 15). Same Z3
  gate.

### Category A — other dropped definitions

- **A1.** `core/src/tools/handlers/mod.rs:72` `pub use shell::ShellHandler` —
  `ShellHandler` no longer exists (the `shell` submod was restructured upstream).
  Either remove the re-export or migrate to new path.
- **A2.** `core/src/tools/handlers/mod.rs:76-77` `pub use unavailable_tool::UnavailableToolHandler`
  + `unavailable_tool_message` — `unavailable_tool` submod deleted entirely upstream.
- **A3.** `core/src/config/mod.rs:3547` `config_profile` variable referenced but
  not in scope — orphan from upstream refactor.
- **A4.** `core/src/unified_exec/process_manager.rs:819` `ExecCommandToolOutput`
  missing field `truncation_policy` — type gained a new required field upstream
  that the squash didn't propagate to all initializers.

## Recommended next-task scope

**Spawn a fresh member: `codex-rebase-resume-proper`** (or `/rebase-upstream
rust-v0.135.0` discipline). Approach:

1. `git fetch <upstream-codex-remote> rust-v0.135.0` in the inner submodule.
2. `git diff bd98f7751..rust-v0.135.0 -- 'codex-rs/core/src/tools/'` to identify
   every file the rebase squash should have brought over but didn't. Focus on:
   - The module defining `PlannedTools` (probably a new sibling under
     `core/src/tools/` like `planned_tools.rs` or `tool_plan.rs`).
   - The module defining `add_collaboration_tools` (probably another new sibling).
   - The new `CoreToolRuntime` trait method shape that `multi_agents/spawn.rs:218`
     and `multi_agents_v2/spawn.rs:242` were partially migrated to.
3. Import those files, run `cargo check --workspace`, iterate.
4. THEN re-base / re-apply my 3 commits on top — they shouldn't conflict because:
   - `8ca0a3e5c` touches files (tool_config.rs, copilot_models_endpoint.rs) that
     a proper rebase would have already merged correctly; this commit may become
     a no-op.
   - `494219ed4` is a SANDBOX PATCH that survives any upstream variant (or gets
     superseded by upstream re-adding the real fn — in which case delete the stub).
   - `5726e6f08` may need to be re-done against the post-resume spec_plan.rs
     shape, but the SAME 4 registration groups should land in
     `add_core_utility_tools` regardless.

## Base SHAs for next member

- **Inner submodule branch:** `ralph/rebase-debt-reconciliation-impl` @ `5726e6f08`
  on `Evyatar108/codex-openai-fork`. Base: `bd98f7751` (current wrapper main pointer).
- **Wrapper:** still on `origin/main` @ `7a51ef8c9` (`gim-home/codex`). No
  wrapper-side commit needed yet; the gitlink bump should happen as part of the
  resume-proper task's wrapper FF, not separately.

## Logs

Six cargo-check log files in this directory (`cargo-check-baseline.log` through
`cargo-check-r5.log`) trace the per-iteration error reduction:

- baseline: 23 errors (all `tool_config.rs`)
- r2: 2 errors (core-plugins/manager.rs after 1)
- r3: 1 error (spec_plan.rs unexpected delim after 2)
- r4: 16 errors (core deep debt after orphan #1 re-port surfaced)
- r5: 30 errors (after orphan #2 delete + D-002 forward-port; final pre-blocker state)
