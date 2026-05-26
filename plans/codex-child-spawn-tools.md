# Codex Child Spawn Tools Spike

Research date: 2026-05-26. Scope: research only; no production code changes.
Surfaced by `agent-tree-rpc` US-006 AC4 (commit `11bc1ff4`) — child agent A
reported `spawn_agent` / `wait_agent` unavailable, so nested A→B never
materialized.

## Summary

The agent-tree-rpc US-006 failure is best explained by the session running
legacy `multi_agent`, not `multi_agent_v2`. In legacy mode, the root thread
gets `spawn_agent` because `Feature::Collab` is enabled by default, but the
spawned child is created at depth 1 and `apply_spawn_agent_overrides()` strips
`Collab`/`SpawnCsv` at the default max depth — which removes `spawn_agent` and
`wait_agent` from the child tool surface.

This is **not** an upstream design rule that child agents must never spawn.
Both the pinned source and upstream HEAD expose child spawn tools when
`features.multi_agent_v2` is enabled. A submodule bump alone is not the fix,
because upstream HEAD still leaves `multi_agent_v2` disabled by default. An
overlay crate is not justified either — the codebase already has a config
path (V2 opt-in) that, if exercised, would expose the missing tools.

## Codebase Architecture

- Codex source lives under `codex/external/repos/codex-patched/codex-rs/`;
  fork-only Rust divergence should prefer `codex/codex-rs-overlay/` per Tenant
  1 ("minimize upstream-canonical conflict surface") in `codex/CLAUDE.md`.
  Existing overlay crates: `codex-copilot-launcher/`, `codex-copilot/`,
  `codex-invariant-tests/`. No precedent exists for an overlay that patches
  tool registration.
- Tool planning is in `core/src/tools/spec_plan.rs` on the pinned tree.
  Upstream HEAD refactors this into a `TurnContext`-based planner but keeps
  the same collaboration-tool policy.
- Feature gates live in `codex-rs/features/src/lib.rs`; `multi_agent`/`Collab`
  is `Stage::Stable, default_enabled: true`, while `multi_agent_v2` is
  `Stage::UnderDevelopment, default_enabled: false`.
- Happy's app-server client starts Codex threads in
  `packages/happy-cli/src/codex/codexAppServerClient.ts`; `buildThreadConfig()`
  currently passes only `mcp_servers` into `thread/start.config`, so app-server
  sessions do not opt into `features.multi_agent_v2` unless external Codex
  config already does.

## Factual Findings

### Pinned Codex

Pinned nested checkout: `codex/external/repos/codex-patched` at `f87244acdc` on
`feature/launcher-additional-instructions`. The older `agent-tree-rpc` commit
`11bc1ff4` pinned the wrapper submodule at a sibling SHA whose subtree had the
same relevant tool-registration shape.

Verified file:line citations on the current pin:

- `codex-rs/features/src/lib.rs:898-908`: `Feature::Collab` (key `multi_agent`)
  is `Stage::Stable, default_enabled: true`; `Feature::MultiAgentV2` (key
  `multi_agent_v2`) is `Stage::UnderDevelopment, default_enabled: false`.
- `codex-rs/core/src/config/mod.rs:176`: `DEFAULT_AGENT_MAX_DEPTH = 1`.
- `codex-rs/tools/src/tool_config.rs:179-180`: `include_collab_tools` is
  enabled when either `MultiAgentV2` or legacy `Collab` is enabled — no
  parent/child gate at registry build time.
- `codex-rs/core/src/tools/spec_plan.rs:303-321`: when `config.multi_agent_v2`
  is true, codex registers `spawn_agent`, `send_message`, `followup_task`,
  `wait_agent`, `close_agent`, and `list_agents` without a child-thread
  exclusion. The legacy branch (lines 325+) registers `SpawnAgentHandler`,
  `SendInputHandler`, `ResumeAgentHandler`, etc.
- `codex-rs/core/src/tools/handlers/multi_agents_common.rs:281-285`:

  ```rust
  pub(crate) fn apply_spawn_agent_overrides(config: &mut Config, child_depth: i32) {
      if child_depth >= config.agent_max_depth && !config.features.enabled(Feature::MultiAgentV2) {
          let _ = config.features.disable(Feature::SpawnCsv);
          let _ = config.features.disable(Feature::Collab);
      }
  }
  ```

  This is the **single point** where children lose collab tools, and it only
  fires in legacy mode. In V2 mode, the function is a no-op for tool
  availability; recursion is instead bounded by
  `max_concurrent_threads_per_session`.
- `codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:66-104`: V2
  computes child depth and calls the shared override function, but the
  override does not strip collab tools when V2 is enabled.
- `packages/happy-cli/src/codex/codexAppServerClient.ts:1213-1249`: Happy
  starts threads with `config` containing only `mcp_servers`, so app-server
  sessions do not opt into `features.multi_agent_v2` unless external Codex
  config already does.

`agent-tree-rpc`'s failure record confirms the symptom:
`.ralph/jobs/agent-tree-rpc/failures/US-006_2026-05-13T20-53-44Z.json:47-66`
records "Focused RUN_CODEX_INTEGRATION test captured root spawning A, but child
A replied it does not have spawn_agent or wait_agent, so required nested B
topology never materialized within 120s."

### Upstream HEAD

Fetched upstream `openai/codex` `main` at
`8a94430bb273623be42b68f144f1ab1df343bb53`.

Upstream HEAD also registers the MultiAgentV2 collaboration handlers without a
`SessionSource::SubAgent(ThreadSpawn)` exclusion (`core/src/tools/spec_plan.rs`
around `add_collaboration_tools()`). It still defaults `multi_agent_v2` off and
keeps the same `apply_spawn_agent_overrides()` rule: strip legacy tools at
depth only when V2 is not enabled.

Conclusion: upstream HEAD exposes child spawn tools under V2, but the current
pin already has that property. **Do not bump solely for this issue.**

## Technical Constraints

- V2 tool schema differs from legacy: `spawn_agent` requires `task_name` and
  `message`; uses `fork_turns` instead of `fork_context`; `send_message`
  replaces `send_input`; `wait_agent` has timeout-only semantics and returns a
  brief mailbox summary rather than targeted child completion content.
- Full-history V2 forks reject `agent_type`, `model`, and `reasoning_effort`
  overrides. Tests that need role/model control should use
  `fork_turns: "none"` or a bounded positive value.
- Spawned agents inherit or copy runtime permission state via
  `apply_spawn_agent_runtime_overrides()` in `multi_agents_common.rs`:
  approval policy, shell environment policy, cwd, sandbox executable, and
  permission profile. **Any child-spawn enablement must not widen permissions
  relative to the parent.**
- MultiAgentV2 enforces `max_concurrent_threads_per_session` instead of the
  legacy depth stop. That is the right limiter for recursive spawns.
- Plugin scoping is a separate gap. Hiding child spawn tools is not a reliable
  way to keep `ralph-orchestration` out of subagents; Phase 2c still needs
  loader-time top-level/subagent filtering — see
  `plans/codexu-roadmap.md` Phase 2c.

## Decision Matrix

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Keep supported roadmap shape top-level-only | Matches `plugin-scope-agents` agent-spawner plan; lowest Codex conflict surface; zero rebase debt | Does not satisfy old nested A→B acceptance | **Recommended baseline** |
| Opt selected sessions/tests into `features.multi_agent_v2` | Minimal likely fix for nested proof; no submodule bump | Requires Happy client config plumbing or user config; V2 schema changes tests/prompts | **Recommended follow-up probe** |
| Bump submodule to upstream HEAD | Gets newer planner/exposure work | Upstream still defaults V2 off; high rebase cost (17 network-suppression patches to re-verify); codexu CI does not run codex test suite | Not targeted |
| Overlay crate to force child registration | Reserved if upstream later hides tools intentionally | Needs upstream seams and permission-policy review; no precedent for overlay touching tool registry; not justified by current evidence | Defer |
| Revise US-006 to flat root → A and root → B | Validates the delivered agent-tree bridge without recursive spawn dependency; agent-tree-rpc is a depth-agnostic view layer, not a spawn-capability layer | Does not prove child-owned spawning | Acceptable for `agent-tree-rpc` closure |

### Reversibility ranking

1. **Accept constraint:** zero code, instant rollback. No friction.
2. **V2 opt-in probe:** config-only flip in `buildThreadConfig` or per-test
   override. Trivial to revert.
3. **Overlay crate:** delete crate + revert 3-line seam (~5 min). No rebase
   debt, but ~6–8h to build and review.
4. **Submodule bump:** git reset to prior SHA + revert wrapper gitlink. Risk
   if a latent bug ships before reversion is exercised; codex's own CI is the
   authoritative gate (codexu CI does not run `cargo test --workspace`).

## Recommended Path

**Now (unblocks the downstream chain):** Proceed with `plugin-scope-agents`
using the top-level-only plugin tier plus a designated agent-spawner that
creates top-level sessions on behalf of the operator. That satisfies Phase 2c's
core safety requirement: `ralph-orchestration` stays out of subagents but
remains reachable through the spawner. Relax `agent-tree-rpc` US-006 AC4 to a
flat root→A, root→B topology so the agent-tree bridge can ship without a
recursive-spawn dependency.

**Follow-up probe (only if the nested-spawn question still matters):** Before
any Codex bump or overlay, run a small V2-specific probe:

1. Start a real `app-server` thread with config override
   `features.multi_agent_v2 = true` (one path: extend `buildThreadConfig()`
   to forward a `features` block; another path: use `~/.codex/config.toml` on
   the test box).
2. Spawn A with `fork_turns: "none"`.
3. Have A issue a real V2 `spawn_agent` call for B.

If the probe passes, plumb the V2 opt-in into Happy's app-server config and
update `agent-tree-rpc`'s gated test (or keep the relaxed flat AC). If it still
lacks tools, inspect the actual binary version and child-thread feature flags;
that's the point where bump-vs-overlay becomes a real question rather than a
speculative one.

**No overlay crate is justified by current evidence.** The natural seam, if
future upstream changes require it, is the collaboration-tool registration
branch in `spec_plan.rs` (lines 303–321), with an overlay-owned policy helper
deciding exposure by `SessionSource`, plugin scope, and permission profile.

## Gap-Log Entry (for `docs/codex-fork-extension-strategy.md`)

> Child agents cannot spawn grandchildren under default Happy app-server
> sessions because those sessions run in legacy `multi_agent` mode, where
> `apply_spawn_agent_overrides` strips `Collab`/`SpawnCsv` at
> `agent_max_depth=1`. Codexu Phases 1–6 (`agent-tree-rpc`,
> `plugin-scope-agents`, long-lived teammates) do **not** require nested
> spawn. Future Phase 7+ requests for nested spawn are gated on:
>
> 1. Empirical workflow that requires recursion (not speculation).
> 2. A V2 opt-in probe in `buildThreadConfig()` (cheapest path).
> 3. Only if the probe fails or V2 is unacceptable, evaluate bump vs overlay
>    using `docs/codex-fork-extension-strategy.md` Gates 1–3 (overlay-first /
>    upstream churn data / patch registration).

## Open Questions

- Is there any production workflow on the codexu roadmap that genuinely
  requires nested spawn beyond what V2 opt-in delivers? Phase 6 ("long-lived
  teammates") is contemplated as top-level teammates, not grandchildren —
  confirm with operator.
- If V2 opt-in is plumbed into `buildThreadConfig`, does the schema change
  (e.g., `task_name` + `message` instead of legacy `send_input`) break any
  existing happy-cli RPC consumers? Audit `packages/happy-cli/src/codex/`
  before flipping.
