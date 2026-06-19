# Codex `.141` Upstream Rebase — Read-Only Assessment

**Task:** `codex-upstream-rebase-to-0.141`
**Author:** member `assess-rebase-0141` (crew `ralph-pipeline`)
**Date:** 2026-06-19
**Mode:** READ-ONLY (no codex source edits, no cargo, no git mutations except read-only `git fetch` of the upstream tag)

---

## 1. Target coordinates

| Coordinate | Value |
|---|---|
| **Target tag** | `rust-v0.141.0` |
| **Target `^{commit}`** | `3fb81667d30d9d24297216ea61fbfcc4351b2aa9` |
| **Target date** | 2026-06-17 (PT) |
| **Effective fork base** | `rust-v0.140.0` = `6506579001c322927a3e4bd440563267a7ac6c1f` (2026-06-15) |
| **Fork tip** | `sandbox-patches` @ `9615bef64` (label `0.140.0-copilot-api.1`) — inner HEAD confirmed |
| **Delta window** | ~2 days (single-minor) |

**Aggregate delta `rust-v0.140.0..rust-v0.141.0` under `codex-rs/`:**
`609 files changed, +26086 / -7325`.

**Structural notes (important):**
- **NO renames / deletes / copies** under `codex-rs/` in the delta (`--diff-filter=DRC` empty). This means the path-based fork-seam ↔ upstream-churn intersection below is *complete* — no fork-edited file was moved out from under us.
- Fork carries **175 files with `SANDBOX PATCH` markers**; **62** of those also appear in the upstream churn → that 62-file set is the entire conflict-risk surface (everything else the fork patches is untouched upstream).
- Despite the 26k-line aggregate, per-file churn on the conflict-risk set is **modest** (max 277 lines; most < 100). The 26k is dominated by net-new subsystems the fork does **not** patch (Noise relay exec-server, new plugin-MCP routing crates, rustls provider, windows-sandbox wrapper, schema/TS files).

---

## 2. Per-fork-patch conflict forecast

### 2.0 The headline: the heaviest-divergence fork families are UNTOUCHED

The following high-divergence fork patch families have **ZERO upstream churn** in 0.140→0.141 (verified `--stat` empty or file absent from the 62-file intersection):

| Fork family | Anchor file(s) | Upstream churn | Verdict |
|---|---|---|---|
| **Anthropic transport** | `core/src/chat_transport.rs`, `chat_transport/anthropic_sse.rs` | none | **CLEAN** |
| **Copilot model-provider** (F-2 port) | `model-provider/**` (copilot.rs, anthropic_gate.rs, copilot_models_endpoint.rs, bearer_auth, gated_models_manager) | none | **CLEAN** |
| **P2 remote-control (LEAN-on-upstream policy)** | `app-server-transport/.../remote_control/mod.rs` | none (`--stat` empty) | **CLEAN — P2 LEAN holds** |
| **multi-agent-v2 spawn gate** | `core/src/tools/handlers/multi_agents_v2/spawn.rs` | none | **CLEAN** (only the *spec* description text churned — see 2.2) |
| **Managed hooks crate** | `hooks/**`, `core/src/hook_runtime.rs`, `managed_gate.rs` | none | **CLEAN** |
| **Windows Git Bash shell** | `core/src/windows_git_bash.rs`, `windows_job.rs`, `spawn.rs` | none | **CLEAN** (but see turn-environment ripple in 2.1) |
| **Paste-burst (LegacyPasteBurstHeuristic)** | `tui/src/bottom_pane/paste_burst.rs`, `features/src/legacy.rs` | none | **CLEAN** |
| **Release-only update modules** (the cargo-check `--release` gap) | `tui/src/{updates,update_action,update_prompt,npm_registry}.rs` | none | **CLEAN** |
| **rmcp seams** | `rmcp-client/{elicitation_client_service,logging_client_handler,rmcp_client}.rs` | none (only non-seam `stdio_server_launcher.rs` +2) | **CLEAN** |

This is the single most important finding: the most painful parts of the 0.135→0.140 rebase do not recur at 0.141.

### 2.1 Conflict-risk set (fork seam ∩ upstream churn), ranked by coupling

| # | Verdict | File (seams) | Upstream churn (+/−) | Reason / upstream PR |
|---|---|---|---|---|
| **1** | **REPLANT — highest** | `tui/src/app/resize_reflow.rs` (9), + `tui/src/app.rs` (2), `tui/src/app/event_dispatch.rs` (3) | 15/82, 17/42, 11/8 | **#27794 "Remove terminal resize reflow flag gates."** Upstream retired `Feature::TerminalResizeReflow` → `Stage::Removed` (always-on) and **deleted the `terminal_resize_reflow_enabled()` helper + every call-site**. The fork's e-ink *retained-transcript replay* seams are interwoven with exactly those now-deleted guards; the fork's LIVE code still defines `terminal_resize_reflow_enabled()` (resize_reflow.rs:112) and calls it from app.rs:1269/1349, event_dispatch.rs:277, resize_reflow.rs:266. This is the only **semantic** conflict of the round: the fork must decide whether to re-introduce a fork-owned gate for its e-ink retained-transcript mode (default-off for non-e-ink) and re-thread 9 seams into upstream's de-guarded, always-on reflow path. Note `TerminalResizeReflowConfig` (max_rows knob, config/mod.rs) survives both sides — only the on/off *Feature* was removed. |
| **2** | **REPLANT — medium-high** | `core/src/session/input_queue.rs` (4), + `core/src/session/mod.rs` background-wake seam | 101/15, 67/89 | **#28341 "core: let steer interrupt wait_agent."** Upstream changed the mailbox watch channel `watch::Sender<()>` → `watch::Sender<InputQueueActivity>` (new `Mailbox`/`Steer` enum). The fork's **P14 BackgroundProcessNotification** stash/drain + "pending-work wake predicate" seams (input_queue.rs:32/51/56/62) and the background-completion wake routed onto the submission loop (session/mod.rs:1159) sit on exactly this channel and must re-anchor to the new activity enum. |
| **3** | **REPLANT — medium** | `core/src/connectors.rs` (1) | 4/200 | **Plugin-MCP routing refactor** (#27607/#27870/#27884/#27902/#27958). Upstream gutted connectors.rs (−200), relocating `AppToolPolicy` + apps-config into new crates (`connectors/src/app_tool_policy.rs`, `core-plugins/src/app_mcp_routing.rs`). The fork's **invariant-25 (McpServerNotifications)** seam (connectors.rs:314) is below the deleted block but depends on imports/helpers that moved. Re-anchor required. |
| **4** | **CONFLICT — medium** | `core/src/config/mod.rs` (11) | 52/15 | Two upstream regions churned: (a) `to_mcp_config` refactored into `to_mcp_config_with_plugin_registrations` + `apply_plugin_mcp_server_requirements` + new `McpPluginAttribution` (plugin-MCP routing, #27884); (b) multi-agent-v2 prompt text restructured into `DEFAULT_MULTI_AGENT_V2_SHARED_USAGE_HINT_TEXT` / `NO_SPAWN_HINT_TEXT` constants (#28283). Fork's 11 seams (Anthropic gate install :2792, managed-hooks gate :2773, Knob-B tier, launcher additional_instructions, compat adapters) are in **non-overlapping** regions → mostly clean, but the Knob-B seam (:1393) is adjacent to the `to_mcp_config` hunk; verify no textual collision. |
| **5** | **CONFLICT — low/mechanical** | `core/src/agents_md.rs` (2) | 4/20 | **#27955 "retain resolved environments across turns"** + shell-snapshot work. Signature churn: `ResolvedTurnEnvironments` → `TurnEnvironmentSnapshot`, and `load_project_instructions`/`read_agents_md` `&mut Config` → `&Config` (the `warn_invalid_utf8` startup-warning push was removed). The fork's **AutoLoadClaudeMd** CLAUDE.md-load seam must adapt to the read-only `&Config` + new snapshot type. Mechanical but touches a fork-patched signature. |
| **6** | **CONFLICT — low/mechanical** | `analytics/src/client.rs` (3) | 95/8 | **#27093 "Analytics Capture to File in Debug Builds."** Upstream added `AnalyticsEventsDestination { Http, #[cfg(debug)] CaptureFile }`. The fork's **telemetry-disable** seam (drain-without-send, :26/:67/:407) must re-anchor so the new `CaptureFile` (debug-only, local file — not network) destination is also short-circuited. See backlog note for `codex-network-audit-coverage-gaps`. |
| **7** | **CONFLICT — low/mechanical** | `features/src/lib.rs` (15), `features/src/tests.rs` (2) | 13/6, 23/7 | Upstream added one new variant `Feature::SleepTool` (UnderDevelopment, default-off) near `TokenBudget`, plus a `terminal_resize_reflow` legacy-key `continue` arm, and flipped `TerminalResizeReflow` spec to `Stage::Removed`. Fork's 8 gate variants are at distinct offsets (enum 149-166/237; specs 1036-1102/1311) → non-adjacent, clean insertion. Trivial. |
| **8** | **CONFLICT — low/mechanical** | `core/src/tools/handlers/mod.rs` (2) | 3/1 | Upstream added `mod sleep;` + `pub use sleep::SleepHandler;` and renamed `ToolSearchHandler` → `ToolSearchHandlerCache` (#27258 per-session tool-search cache). Fork's **plugin-scope-axis** "retained handler" seams (:29/:73) edit the same mod/use lists → adjacency merge; mechanical. Watch the `ToolSearchHandler` rename for any fork referent. |
| **9** | **CONFLICT — low/mechanical** | `core/src/tools/registry.rs` (1) | 22/27 | **#28365 "Respect blocking PostToolUse hooks in code mode"** reworked PostToolUse outcome handling (`should_stop`→`should_block`, replacement-text path moved). Fork's seam is **PreToolUse synthetic_response** (:536), above the changed hunk → separable, mechanical. *Opportunity:* the fork's ManagedHooks intent may now align with upstream's native blocking-PostToolUse behavior. |
| **10** | **CONFLICT — low** | `protocol/src/protocol.rs` (6), `core/src/session/{mod,session,turn_context,turn}.rs`, `tools/spec_plan.rs` (3), `multi_agents_spec.rs` (2), `codex-mcp/{connection_manager,mcp/mod}.rs`, `unified_exec/**`, `app-server/.../turn_processor.rs`, `app-server-protocol/.../v2/thread.rs`, `tui/app/thread_routing.rs`, misc | various, mostly < 60 | Spread-out, low-density seams (launcher rails, Knob-B, stream-cut diagnostics, Windows shell hint, unified-exec). Churn is moderate and the seams are well-separated; expect mechanical 3-way merges. `spec_plan.rs`/`multi_agents_spec.rs` churn is **description-string only** (no trait/shape change — see below). |

### 2.2 P3 (multi-agent / tool-registration) explicitly re-checked — LOW risk this round

The 0.140 rebase was bitten by a `ToolExecutor` / `CoreToolRuntime` **trait-shape** refactor. **That did NOT continue in 0.141:**
- `multi_agents_spec.rs` churn = tool **description strings only** (wait_agent now mentions steer-interrupt; spawn_agent gains `fork_turns` context-propagation guidance). No struct/trait change.
- `tools/registry.rs` churn = PostToolUse hook outcome handling (#28365), not the executor trait.
- `tools/handlers/mod.rs` churn = module list (`mod sleep`) + one rename. No trait change.
- `multi_agents_v2/spawn.rs` (the fork's actual subagent gate) = **untouched**.

So the P3 family is mechanical at 0.141.

### 2.3 New upstream files (context — none gut a fork-edited path)

Net-new subsystems (no fork seams in them): `exec-server/src/noise_relay/**` + `noise_channel*` (Noise relay), `connectors/src/app_tool_policy*`, `core-plugins/src/app_mcp_routing*` + `remote_tests.rs`, `core/src/tools/handlers/sleep.rs` (SleepTool), `ext/mcp/src/executor_plugin/**`, `utils/path-uri/src/api_path_string*`, `utils/rustls-provider/tests/**`, `windows-sandbox-rs/src/{wrapper,stdio_bridge}*`, `app-server/.../rate_limit_resets*`, analytics `analytics_capture.rs`, plus many schema/TS files.

---

## 3. BACKLOG-IMPACT scan

Scanned `.ralph-overview/data.json`: **293 tasks, 68 tracked, 36 tracked `scope:"codex"`.** Mapped every 0.141 change-of-note against tracked tasks. Impact key: none / easier / harder / obsolete / superseded / new-prereq.

| task-id | impact | evidence (upstream change → why) |
|---|---|---|
| **codex-workflows-replace-ralph-orchestration-feasibility** | **none** | No workflow surface added in 0.141 (verified: zero new workflow/goal/approval `Feature` variants; release notes carry none). |
| **codex-workflows-product-mvp** | **none** | Same — no upstream workflow/goal/approval movement. |
| **codex-workflows-prompt-trigger-ultracode-equivalent** | **none** | Same. |
| **codex-workflows-saveable-reusable** | **none** | Same. |
| **codex-workflows-deep-research-bundled** | **none** | Same. |
| **codex-workflows-approval-policy-surface** | **none** | No new approval-policy surface in 0.141. (Connectors `AppToolApproval`/`ApprovalsReviewer` were *relocated* by the plugin-MCP refactor, not extended into a user-facing approval surface.) |
| **codex-workflows-resume-cached-agent-results** | **none** | No agent-result caching/resume surface added. (Note: #28336 "cache orchestrator resources per thread" is plugin-resource caching, not agent-result resume.) |
| **codex-cli-vs-claude-code-workflows-parity** | **none** | No workflow parity surface added. |
| **codex-goal-command-research** | **none** | `Feature::Goals` is **pre-existing** (features/lib.rs:225-226) and **unchanged** in the 0.141 delta. No goal-command movement. |
| **codex-subagent-model-effort-context-propagation** | **easier (context)** | #28283 multi-agent-v2 prompt update + spec change adds explicit `fork_turns="none"`-vs-`"all"` context-propagation guidance (multi_agents_spec.rs; config/mod.rs `NO_SPAWN_HINT`/`SHARED_USAGE_HINT` constants). Upstream now documents the propagation semantics this task targets. |
| **codex-multi-agent-v2-vs-v1-research** | **harder (surface moved)** | Multi-agent-v2 prompt text restructured (#28283) + wait_agent steer-interrupt (#28341) + new SleepTool. v2 behavior shifted since the research baseline; re-verify after rebase. |
| **codex-crews-vs-multi-agent-v2-comparison** | **harder (surface moved)** | Same v2 prompt/behavior churn changes the comparison surface. |
| **codex-background-process-notification-experimental-visibility** | **harder + watch** | #28341 reworked `input_queue` into `InputQueueActivity{Mailbox,Steer}` — the exact channel the fork's P14 background-completion wake rides. The new **interruptible SleepTool** (#28429) + wait_agent steer-interrupt are adjacent async-completion primitives; evaluate whether they overlap/inform the fork's BackgroundProcessNotification gate. |
| **codex-notify-hook-async-bg-completion-investigation** | **harder + watch** | Same input_queue activity-channel rework touches the async-completion/notify plumbing this investigation targets. |
| **codex-hook-executor-windows-native-shell** | **harder** | (a) PostToolUse hook semantics reworked (#28365 blocking-PostToolUse-in-code-mode; #26434 hook-trust-bypass through exec); (b) shell-snapshot ownership simplified + "use local environment for user shell commands" (#27756/#28163/#28421/#27955). Both the hook surface and the windows-shell surface this task targets churned. |
| **codex-per-turn-resume-trigger-upstream-vs-fork** | **harder (minor)** | #27955 retain-environments-across-turns + #26434 hook-trust-bypass-persists-through-resume + thread_routing churn touch the resume/turn boundary this task compares. |
| **codex-rebase-0140-remote-control-policy-layer-test** | **none** | `remote_control/**` has **zero** 0.141 churn → the P2 LEAN-on-upstream policy test debt is stable; rebase won't disturb it. |
| **codex-rebase-0140-debt-spec-plan-tests** | **harder** | `spec_plan.rs` (+43/−13) and `multi_agents_spec.rs` churned (description strings) → the spec-plan test surface this debt task covers will re-touch on rebase. |
| **codex-core-test-tree-precompile-breakage** | **harder / re-baseline** | Heavy test churn: `session/tests.rs` (+163/−74), `core/tests/suite/client.rs`, `config_tests.rs`, `connection_manager_tests.rs`, `process_manager_tests.rs`, plus new `core/tests/common/test_environment*.rs`. The precompile baseline shifts. |
| **codex-test-binaries-compile-debt-baseline** | **harder / re-baseline** | Same — new test modules + churned test trees change the compile-debt baseline. |
| **codex-network-audit-coverage-gaps** | **new-prereq / harder** | New network/telemetry surfaces to cover: Noise relay exec-server transport (#26242/#26245), `analytics_capture.rs` debug `CaptureFile` sink (#27093), new rustls/aws-lc-rs crypto provider + P-521 (#27706). The fork's network/analytics suppression seams + audit must extend to these. |
| **codex-v135-runtime-audit-elevated** | **new-prereq (minor)** | Same new network surfaces broaden the runtime-audit scope. |
| **codex-anthropic-transport-bazel-lock-regen** | **none** | model-provider/chat_transport churn = empty → Anthropic transport untouched. |
| **codex-anthropic-transport-us008-e2e-test** | **none** | Same — Anthropic transport untouched. |
| **codex-anthropic-model-persists-without-enable-flag** | **none** | Fork-internal config-reload bug; AnthropicModels gate + config-reload path untouched upstream. |
| **codex-windows-bracketed-paste-vt-input** | **none (minor adjacency)** | No paste/VT/bracketed change in 0.141 (`paste_burst.rs`, `tui/.../event_stream.rs` untouched). Adjacent-only: #27086 "Windows unified exec yield floor" + "more time before backgrounding" are exec-timing, not paste/VT input. |
| **codex-fork-patch-marking-and-divergence-audit** | **new-prereq** | A fresh rebase shifts the divergence ledger; re-run the marking/audit after 0.141 lands. |
| **codex-fork-install-script** / **codex-git-marketplace-snapshot-tmp-ephemeral** | **watch (minor)** | New "created-by-me remote marketplace" + curated-catalog-by-auth (#28203/#28383) extend the plugin-marketplace surface these tasks touch. No direct break; re-check assumptions. |
| **codex-local-build** / **codex-publish-npm-subprocess-resolver-fix** / **codex-r2-iex-installer-auto-publish** / **build-env-sccache-cache-wipe-and-rewarm** / **codex-anthropic-transport-bazel-lock-regen** | **watch (minor)** | #28001 "package Windows ARM64 on x64" adds a release target; new crates (noise_relay, rustls-provider, windows-sandbox wrapper) grow the build graph (sccache rewarm, Bazel lock regen on rebase). |
| **codex-tmux-vs-windows-terminal-research**, **codex-test-binaries-compile-debt-baseline**, **codex-sandbox-setup-install-despite-skip-flag**, **codex-subagent-...**, others not listed | **none / negligible** | No overlapping 0.141 churn beyond items already captured. |

### 3.1 Backlog headlines (for the operator)

- **No task becomes obsolete or fully superseded by 0.141.** Upstream did not ship a workflows/goals/approval surface, so the **entire `codex-workflows-*` + `codex-goal-command-research` cluster (9 tasks) is unaffected** — still greenfield-for-us.
- **Easier:** `codex-subagent-model-effort-context-propagation` gains upstream's explicit `fork_turns` context-propagation guidance.
- **Harder / re-baseline:** the **test-tree compile-debt tasks** (heavy upstream test churn), the **multi-agent-v2 research/comparison tasks** (prompt+behavior churn), **background-process-notification + notify-hook** tasks (input_queue `InputQueueActivity` rework), **hook-executor-windows-native-shell** (PostToolUse + shell-snapshot churn), and **network-audit** tasks (Noise relay + analytics CaptureFile + new TLS provider = new surfaces to cover).
- **Stable:** all **Anthropic transport** tasks and the **0.140 remote-control policy test debt** — their surfaces have zero 0.141 churn.

---

## 4. Recommendation

**Bottom line: 0.141 is a DIRECT-IMPL rebase — go straight to `rebase-upstream.md`.** This is a true single-minor (2-day) delta, and the heaviest fork-divergence families (Anthropic transport, Copilot model-provider, P2 remote-control LEAN, multi-agent-v2 spawn gate, managed-hooks crate, paste-burst, release-only update modules) have **zero** upstream churn — none of the pain points from the 5-minor 0.135→0.140 rebase recur. The conflict surface is 62 files but almost entirely mechanical 3-way merges; debt-fix risk is **LOW**.

**Only one surface warrants care — no full P2/P3-style spike needed, just attention during the rebase:** the **e-ink `resize_reflow.rs` replant (Replant #1)**, because upstream (#27794) retired `Feature::TerminalResizeReflow` and deleted the `terminal_resize_reflow_enabled()` guard the fork's retained-transcript e-ink seams are threaded through. Resolution is a design choice the implementer must make deliberately (re-introduce a fork-owned default-off gate for the e-ink retained-transcript mode vs. fold into always-on reflow), not a mechanical accept-theirs. Budget the bulk of the rebase effort here.

**Top 3 highest-risk replants, in order:** (1) `resize_reflow.rs` + `app.rs` + `event_dispatch.rs` (e-ink ↔ retired reflow flag); (2) `input_queue.rs` + `session/mod.rs` (P14 background-wake ↔ new `InputQueueActivity{Mailbox,Steer}` channel, #28341); (3) `connectors.rs` + `config/mod.rs` `to_mcp_config` (McpServerNotifications/plugin-MCP ↔ plugin-MCP-routing relocation). Everything else (agents_md signature, analytics destination enum, features SleepTool insertion, registry PreToolUse adjacency, the spread-out low-density seams) is mechanical.

**Verification reminders for the implementer:** keep the cargo-check `--release` gate (the release-only update modules are untouched but the `#![cfg(not(debug_assertions))]` gap still applies); re-confirm the P2 remote-control LEAN compiles after the plugin-MCP/connectors churn settles; and after rebase, re-run the divergence audit (`codex-fork-patch-marking-and-divergence-audit`).

---

## Read-only proof

Captured as the last step of the assessment (verbatim):

```
=== git -C codex/external/repos/codex-patched status --short ===
?? .worktrees/
=== (end inner) ===
=== git -C codex status --short ===
?? .crews/
?? .ralph-overview/
?? .worktrees/
?? external/repos/codex-anthropic-models-opt-in-gate-worktree/
?? tasks/INDEX.md
=== (end wrapper) ===
```

**Verdict: READ-ONLY CONFIRMED.** The inner submodule (`codex-patched`) shows only the
pre-existing `?? .worktrees/` untracked dir — **no modified or added `codex-rs` source**.
The wrapper (`codex`) shows only pre-existing untracked dirs (`.crews/`, `.ralph-overview/`,
a sibling worktree, `tasks/INDEX.md`) — none of them codex source. No cargo, no build, no
git mutations beyond the read-only `git fetch` of the two upstream tags. The only files
written by this assessment live under
`.ralph/investigations/codex-rebase-0141-assessment/`.
