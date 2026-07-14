# Research Brief: Codex V2 Copilot Encrypted Subagent Handoff

## Researcher Findings

# Planning Research: Codex V2 Copilot plaintext handoff and exact wait

## Research metadata

- **Feature request:** `.ralph/jobs/.staging/20260713T193412Z-solo-186108/feature-request.txt`
- **Planning worktree:** `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/worktree/plan`
- **Depth:** thorough
- **UI/UX judgment:** not-required
- **Mode:** research only; no source, release, install, or remote changes were made.

All source paths below are relative to the planning worktree unless explicitly described as evidence in the primary codexu checkout.

## Executive findings

1. **The diagnosis is confirmed against the exact checked-out 0.141 source.** The Codex wrapper is at `3ff55692e7045e85ce78ebe8337ab40b55494c9c` (`v0.141.0-copilot-api.3-15-g3ff55692`); its patched upstream submodule is at `587a6a8ab8948ff912b1f24a62833b277934302d` (`release/0.141.0-copilot-api.3-10-g587a6a8ab`). `codex/external/repos/codex-patched/codex-rs/Cargo.toml` still declares `0.141.0-copilot-api.3`.
2. **All three V2 delegated-message tools are unconditionally encrypted today.** `spawn_agent`, `send_message`, and `followup_task` mark `message` with `JsonSchema::with_encrypted()`, then the shared V2 constructor stores the model-returned value as `encrypted_content`. There is no local plaintext or decryption key.
3. **No protocol rewrite is needed.** `InterAgentCommunication::new(...)` already serializes as `agent_message/input_text`; `new_encrypted(...)` serializes as `agent_message/encrypted_content`. The fix belongs before construction, not in `core/src/client.rs`, `codex-api`, or protocol serialization.
4. **The existing provider abstraction is a better capability seam than `ModelProviderInfo`.** `codex-model-provider::ProviderCapabilities` is provider-owned, defaults permissively, and is already available in `core/src/tools/spec_plan.rs` through `turn_context.provider.capabilities()`. Add a general encrypted-inter-agent-message capability there, default `true`, and override it to `false` in `CopilotModelProvider`. This avoids a Copilot-ID branch and avoids broad serialized-config/schema churn in `model-provider-info`.
5. **The exact status-watch seam exists and V1 already demonstrates the race-safe order.** `AgentControl::subscribe_status` returns a watch receiver containing the latest value. V1 subscribes, reads the receiver, and then waits. V2 currently watches only generic mailbox/steer activity and has no target.
6. **`Completed(None)` must remain a final protocol status.** `agent_status_from_event` derives it from a message-less `TurnComplete`, and `is_final` correctly treats it as terminal. The new targeted wait should return promptly for it; the installed non-empty-canary acceptance layer, not generic wait, must reject it.
7. **A strict Copilot-network integration test seam assumed by older guidance is absent in this exact source.** `core/tests/suite/client.rs:1058-1065` says `CopilotSessionFixture` and `configure_copilot_session_for_tests` were removed during the 0.140 rebase because the responses-URL side channel never landed. Do not plan a wiremock Copilot-ID E2E test as if that helper exists. Use provider-aware router/handler tests plus the published installed-host dogfood, or explicitly add the missing test seam as separate scope.
8. **Release scope is cumulative.** The `.4` release will include ten patched-source commits and fifteen wrapper commits already landed after the `.3` tag, in addition to this fix. Release verification must use the exact final gitlink, not assume `.3 + one patch`.

## Evidence inspected

### Brainstorm and operator decision artifacts

- `.ralph/brainstorms/codex-v2-copilot-encrypted-subagent-handoff/brainstorm.json`
- `.ralph/brainstorms/codex-v2-copilot-encrypted-subagent-handoff/brainstorm-synthesis.md`
- `.ralph/brainstorms/codex-v2-copilot-encrypted-subagent-handoff/selected-direction.md`
- `.ralph-overview/data.json` entries for `codex-v2-copilot-encrypted-subagent-handoff` and its Ralph-side follow-up

These artifacts consistently select D-001 and record the final decisions: general provider capability, truthful plaintext for unsupported providers, encrypted behavior elsewhere, exact targeted wait, and Ralph 5.64 blocked until published `.4` V2 acceptance.

### Installed Ralph 5.64 dogfood artifacts

- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/installed-skill-dogfood-summary.json`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/installed-skill-dogfood.log`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan.command.json`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan-bounds.json`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan.jsonl`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan.stderr.log`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/run-installed-skill-dogfood.ps1`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan-probe/.ralph/jobs/codex-installed-route-plan/worktree/plan/.ralph/jobs/codex-installed-route-plan/{research-brief.md,plan.md,primary-plan-review.md}`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-0.141.0-copilot-api.3-win32-x64.tgz`

Observed facts:

- The command explicitly enabled V2 with `features.multi_agent_v2={enabled=true,hide_spawn_agent_metadata=false}` and exited `0`.
- The installed manifest was Ralph `5.64.0`, but the hard gate failed with expected roles `plan_drafter,plan_initial_review,plan_researcher,plan_review_synthesis` and no actual roles.
- The generated probe plan records `plan_researcher` and `plan_drafter` timeouts and parent-local fallback.
- The runner currently derives `Role` from `arguments.message`; plaintext `.4` will make that value readable again, but final acceptance should also retain structural `task_name`/child-path correlation and non-null final-message checks from the separately planned Ralph hardening.
- The repository does not contain durable copies of the cited raw parent/child rollouts. The brainstorm records their external locations and findings. The `.4` rerun should copy a sanitized parent plus all four child rollouts into the task's dogfood directory so acceptance is reproducible without relying on a user-profile session cache.

## Verified current source contracts

### 1. Tool schema and registration

| Path | Verified contract |
|---|---|
| `codex/external/repos/codex-patched/codex-rs/tools/src/json_schema.rs` | `JsonSchema::with_encrypted()` sets `encrypted: Some(true)`; omission serializes no marker. |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs` | V2 spawn `message` at `spawn_agent_common_properties_v2`, plus send/follow-up `message`, are always `.with_encrypted()`. V2 wait currently accepts only optional `timeout_ms`. |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs` | `add_collaboration_tools` constructs all V2 handlers. The active provider is already present as `turn_context.provider`, and other tools consume `provider.capabilities()` here. This is the correct point to derive one immutable V2 message-encoding policy for schema and runtime. |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec_tests.rs` | Direct schema tests currently assert encryption for all three V2 message fields and timeout-only V2 wait. |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan_tests.rs` | `multi_agent_v2_message_schemas_are_encrypted` verifies the actual router surface. Split this into capable/default and Copilot/unsupported cases. |

### 2. Message construction and transport

| Path | Verified contract |
|---|---|
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2.rs` | `communication_from_tool_message` unconditionally calls `InterAgentCommunication::new_encrypted`. |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs` | Text-only initial V2 input is converted through that shared constructor. Requested model/reasoning overrides are applied before spawn when `fork_turns` is not full-history; this logic should remain untouched. |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs` | Shared runtime path for both send and follow-up also calls the same constructor. |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs` | Unit handler uses `create_send_message_tool()` and queue-only delivery. |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/followup_task.rs` | Unit handler uses `create_followup_task_tool()` and trigger-turn delivery. |
| `codex/external/repos/codex-patched/codex-rs/protocol/src/protocol.rs` | `InterAgentCommunication::new` sets plaintext `content`; `new_encrypted` sets empty `content` plus `encrypted_content`; `to_model_input_item` maps these to `input_text` and `encrypted_content` respectively. |
| `codex/external/repos/codex-patched/codex-rs/core/src/agent/control.rs` | Plaintext affects `render_input_preview` and `last_task_message_from_communication`; encrypted messages intentionally have no readable preview/task message. No decryption occurs here. |

One encoding policy must be stored in the V2 handlers and used by both `spec()` and `handle()`. Querying different predicates independently in schema and runtime would permit the exact dishonest state this task is fixing.

### 3. Provider capability patterns

| Path | Verified contract |
|---|---|
| `codex/external/repos/codex-patched/codex-rs/model-provider/src/provider.rs` | `ProviderCapabilities` is the existing provider-owned upper-bound structure. Default capabilities are permissive. `ConfiguredModelProvider` inherits the default. |
| `codex/external/repos/codex-patched/codex-rs/model-provider/src/copilot.rs` | `CopilotModelProvider` currently does not override `capabilities()`, so it receives defaults. Add the unsupported encryption capability here rather than branching on `is_copilot()` downstream. |
| `codex/external/repos/codex-patched/codex-rs/model-provider/src/amazon_bedrock/mod.rs` | Bedrock constructs an explicit capability literal; it must set the new field to `true` and update its deep-equality test. |
| `codex/external/repos/codex-patched/codex-rs/model-provider-info/src/lib.rs` | `ModelProviderInfo` is serialized/configurable metadata (`wire_api`, retries, auth, `supports_websockets`). Adding a bool here would require updating many constructors/fixtures and potentially config schema. It is a reference, not the smallest `.4` modify seam. |
| `codex/external/repos/codex-patched/codex-rs/app-server/src/request_processors/config_processor.rs` | App-server maps only namespace/image/web fields from runtime capabilities into its public response. The new internal capability need not be exposed. |
| `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/model.rs` | Public `ModelProviderCapabilitiesReadResponse` has only three existing fields. Avoid changing this API for `.4`; otherwise TS/schema fixtures, app-server docs, and integration tests become mandatory. |

Recommended field semantics: `encrypted_inter_agent_messages: true` in `ProviderCapabilities::default()`, `false` only in `CopilotModelProvider`. This is general and provider-owned while preserving every existing provider by default. If operators must configure arbitrary OpenAI-compatible providers as unsupported, that is a separate serialized-config extension.

### 4. Wait and status APIs

| Path | Verified contract |
|---|---|
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs` | Current V2 waits on `InputQueue::subscribe_activity`; pending/current mailbox or future mailbox wakes it, steer wakes it, timeout returns a successful `{message,timed_out}` result. It never resolves an agent or reads status. |
| `codex/external/repos/codex-patched/codex-rs/core/src/session/input_queue.rs` | `subscribe_activity` subscribes before checking pending steer/mailbox. For targeted wait, unrelated mailbox activity must be ignored while steer remains terminal for the wait. |
| `codex/external/repos/codex-patched/codex-rs/core/src/agent/agent_resolver.rs` | `resolve_agent_target` accepts either a UUID or relative/canonical agent path. If the new argument is strictly named `task_name`, decide whether UUIDs should remain accepted; direct `resolve_agent_reference` is the path-only API. |
| `codex/external/repos/codex-patched/codex-rs/core/src/agent/control.rs` | `subscribe_status` obtains a `watch::Receiver<AgentStatus>` whose current value is available immediately; `get_status` is a fallback. |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/wait.rs` | V1 is the canonical subscribe-first example: subscribe, inspect `rx.borrow()`, return if final, otherwise await `changed()`. Preserve this file and V1 schema/behavior unchanged. |
| `codex/external/repos/codex-patched/codex-rs/core/src/agent/status.rs` | `TurnComplete(last_agent_message)` becomes `Completed(Option<String>)`; `is_final` treats `Completed(None)` as final. |
| `codex/external/repos/codex-patched/codex-rs/protocol/src/protocol.rs` | `AgentStatus::Completed(Option<String>)` is the public lifecycle shape; no change is required. |
| `codex/external/repos/codex-patched/codex-rs/core/src/context/subagent_notification.rs` | Final status, including any final text, is injected separately as a `<subagent_notification>`. |

Targeted behavior should be a distinct branch:

1. Resolve the exact target.
2. Subscribe to its status receiver **before** inspecting current status.
3. Subscribe to steer activity; ignore pending/future unrelated mailbox activity.
4. Inspect the same status receiver and return immediately if final.
5. Otherwise `select!` among status changes, steer, and deadline.
6. Keep the existing V2 summary-only output shape unless the plan explicitly chooses an API change. Populate targeted receiver/status fields in `CollabWaitingBeginEvent`/`CollabWaitingEndEvent` for observability.
7. If `task_name` is omitted, execute the current targetless code path byte-for-byte.

### 5. Model and reasoning routing

`codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs` already preserves explicit child routing through `apply_requested_spawn_agent_model_overrides` when `fork_turns` is `none` or partial. Full-history/default `fork_turns=all` intentionally rejects child model/reasoning overrides. The installed Ralph recipe uses an override-compatible V2 request. Do not alter fork-mode or role-override logic as part of encryption work.

Coverage references:

- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_tests.rs`
- `codex/external/repos/codex-patched/codex-rs/core/tests/suite/subagent_notifications.rs`

The `.4` installed canary must assert requested and effective `gpt-5.6-sol`/`xhigh`, not merely readable input.

## File inventory

### Files to modify: patched upstream source

| Path | Planned responsibility | Conflict risk |
|---|---|---|
| `codex/external/repos/codex-patched/codex-rs/model-provider/src/provider.rs` | Add the general capability with a default of `true`; update default-capability test. | Medium |
| `codex/external/repos/codex-patched/codex-rs/model-provider/src/copilot.rs` | Override the capability to `false`; add a focused capability test. | Low/medium; fork-specific file but upstream-owned location |
| `codex/external/repos/codex-patched/codex-rs/model-provider/src/amazon_bedrock/mod.rs` | Preserve `true` in explicit capability literals/tests. | Low |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs` | Derive one provider-aware V2 encoding policy and pass it into spawn/send/follow handlers. | High-touch upstream seam |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs` | Conditionally annotate all three message schemas; add optional exact `task_name` to V2 wait schema/description. | High |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2.rs` | Own a self-documenting encoding enum/helper; select `new` versus `new_encrypted`. | High |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs` | Store/use the encoding policy for spec and initial communication. Keep routing/fork logic unchanged. | High |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs` | Replace unit handler with policy-carrying handler; policy-aware spec/runtime. | Medium |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/followup_task.rs` | Same as send-message while retaining trigger-turn semantics. | Medium |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs` | Use the supplied encoding policy in the shared send/follow runtime path. | Medium |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs` | Add the exact-target status-watch branch and retain the omitted-target branch. | High |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec_tests.rs` | Assert capable and unsupported schemas plus additive wait argument. | Low |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan_tests.rs` | Prove active provider capability flows through the real router for all three tools. | Low |
| `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_tests.rs` | Prove truthful runtime communication for spawn/send/follow and the full targeted-wait race matrix. | Low |
| `codex/external/repos/codex-patched/codex-rs/core/tests/suite/subagent_notifications.rs` | Retain capable-provider encrypted wire coverage; add plaintext child notification coverage only through a real supported test seam. | Medium |
| `codex/external/repos/codex-patched/codex-rs/Cargo.toml` | Bump workspace version to `0.141.0-copilot-api.4` after the fix is committed/tested. | Low |
| `codex/external/repos/codex-patched/codex-rs/Cargo.lock` | Version bump lock update owned by the inner submodule. | Low |

To reduce inline churn, consider new sibling modules under `core/src/tools/handlers/multi_agents_v2/` for encoding and targeted-wait helpers. This follows the fork placement rule (new file in the upstream crate plus small call sites) and keeps `wait.rs` from becoming a mixed generic/targeted state machine. Do not create an overlay crate merely to reach private `Session`/`AgentControl` types.

Every production edit above is inside upstream-canonical source and therefore needs `// SANDBOX PATCH:` markers at the edited seams.

### Files to create/modify: wrapper and invariant coverage

| Path | Planned responsibility |
|---|---|
| `codex/codex-rs-overlay/codex-invariant-tests/tests/multi_agent_v2_handoff.rs` (recommended new file) | Structural guard for capability default/override, schema-policy plumbing, shared truthful constructor, optional targeted wait, and SANDBOX PATCH markers. Existing `plugin_scope_filtering.rs` already demonstrates cross-boundary `include_str!` style. |
| `codex/docs/implementation/patch-surface.md` | Update stale header/ledger to `.4`; add a §14 invariant row with enforcing tests and a §15 replant recipe covering provider, schema, construction, and wait seams. |
| `codex/docs/implementation/regression-history.md` | Add the `.3`-introduced / `.4`-fixed symptom, cause, verification, rollback, and unrecoverable pre-.4 rollout note. |
| `codex/CLAUDE.md` | Add a concise confusion point: V2 encoding is provider-capability-owned, Copilot uses plaintext, targetful wait subscribes before read, targetless semantics remain generic. |
| `codex/external/repos/codex-patched` | Wrapper gitlink update after the patched-source commit. |
| `codex` | Codexu gitlink update after the wrapper release commit is final. |
| `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/` | Persist `.4` command, bounds, summary, sanitized parent/four-child raw evidence, expected artifact inventory, and installed version proof. Keep the `.3` evidence as baseline; do not overwrite it. |

### Reference-only files

- `codex/external/repos/codex-patched/codex-rs/model-provider-info/src/lib.rs`
- `codex/external/repos/codex-patched/codex-rs/tools/src/json_schema.rs`
- `codex/external/repos/codex-patched/codex-rs/protocol/src/protocol.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/agent/{agent_resolver.rs,control.rs,status.rs}`
- `codex/external/repos/codex-patched/codex-rs/core/src/session/input_queue.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/context/subagent_notification.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/wait.rs`
- `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/model.rs`
- `codex/external/repos/codex-patched/codex-rs/app-server/src/request_processors/config_processor.rs`
- `codex/.claude/commands/publish-sandbox-patch.md`
- `codex/scripts/iteration-env.sh`
- `codex/.github/workflows/{publish-npm.yml,invariant-check.yml}`
- `codex/docs/workflows/{repo-topology.md,install.md,developer-guide.md}`
- `codex/docs/implementation/{architecture.md,build-perf.md}`

Documentation drift to resolve or explicitly defer:

- `codex/docs/implementation/patch-surface.md` still says it applies to `.1`, despite current `.3` plus post-release commits.
- `codex/.claude/commands/publish-sandbox-patch.md` is authoritative that distribution is GitHub Releases only, while `codex/docs/workflows/install.md` still documents GitHub Packages as an alternative and says the workflow produces package-registry artifacts. For truthful `.4` install guidance, update `install.md` and the related sentence in `developer-guide.md`, or record a separate owner; do not follow the stale Packages path.

## Required test matrix

### Provider and schema

1. Default/configured provider capability is `true`.
2. Copilot provider capability is `false`.
3. Bedrock remains `true` while its unrelated hosted-tool capabilities remain unchanged.
4. Actual router schemas for `spawn_agent`, `send_message`, and `followup_task`:
   - unsupported/Copilot: no `encrypted` key;
   - capable/default/OpenAI: `"encrypted": true`.
5. V1 spawn/send/wait schemas remain byte-equivalent.

### Runtime encoding

For each of spawn, send, and follow-up:

- unsupported policy produces non-empty `communication.content`, `encrypted_content: None`, and model input `agent_message/input_text`;
- capable policy produces empty `content`, non-empty `encrypted_content`, and model input `agent_message/encrypted_content`;
- plaintext is never placed in `encrypted_content`;
- queue-only versus trigger-turn semantics are unchanged.

### Exact V2 wait

Cover independently:

1. Target already final before `wait_agent` call.
2. Target completes after status subscription but before first current-value inspection.
3. Target completes after the initial non-final read.
4. Unrelated completion/mailbox activity exists before the targeted call and does not wake it.
5. Unrelated activity arrives during the targeted wait and is ignored.
6. User steer pending before wait.
7. User steer arriving during wait.
8. Timeout while target remains non-final.
9. Status channel closure fallback.
10. Relative and canonical task-name resolution; decide and test whether UUID is intentionally accepted.
11. Omitted `task_name` preserves all existing queued-mail, future-mail, steer, timeout, and summary-only behavior.
12. `Completed(None)` is recognized as final by wait; the non-empty-canary acceptance test rejects it separately.

### Routing and installed acceptance

- Handler/config snapshot proves requested/effective `gpt-5.6-sol` and `xhigh` with the plaintext nonsecret canary.
- Existing non-Copilot encrypted integration remains green.
- Published installed-host dogfood must prove all four roles:
  `plan_researcher`, `plan_drafter`, `plan_initial_review`, `plan_review_synthesis`.
- For every child: Copilot provider, exact requested/effective route, readable unique canary in child input, exactly one terminal completion, non-null/nonblank meaningful output, and no `600000` ms wait timeout.
- Outcome assertion is separate from telemetry: all four role artifacts must exist and be child-produced; parent-inline fallback is failure.

Because the exact source lacks a redirectable Copilot test fixture, the decisive real-Copilot assertion belongs to published installed dogfood. Do not weaken it to a mock while claiming provider-ID E2E coverage.

### Targeted validation commands

Run from the Codex implementation worktree, not this deeply nested planning worktree:

```text
git submodule update --init --recursive
cd codex/external/repos/codex-patched/codex-rs
cargo metadata --no-deps --format-version 1
source ../../../../../scripts/iteration-env.sh
just test -p codex-model-provider
just test -p codex-core multi_agent_v2
just test -p codex-core subagent_notifications
just test -p codex-invariant-tests --test multi_agent_v2_handoff
cargo check --workspace
```

Use the repository's `just test` convention rather than direct `cargo test`. Do not run the full local workspace test suite; fork guidance reserves that for CI because it is 90+ minutes and includes inherited failures. Run `just fmt` after edits and scoped `just fix -p codex-model-provider` / `just fix -p codex-core` before finalizing, following the nested Rust guidance.

## Release, install, and dogfood sequence

1. Create the implementation worktree inside `codex/.worktrees/`, then initialize its nested `external/repos/codex-patched` submodule. Do not implement in the plan worktree or shared codexu checkout.
2. Commit patched-source code/tests first inside `codex/external/repos/codex-patched`; push the final inner commit to `sandbox-patches`.
3. After focused tests and `cargo check --workspace`, bump `Cargo.toml`/`Cargo.lock` to `0.141.0-copilot-api.4`.
4. Follow `codex/.claude/commands/publish-sandbox-patch.md` exactly:
   - immutable `release/0.141.0-copilot-api.4` retention tag on the patched remote;
   - wrapper gitlink commit and `v0.141.0-copilot-api.4` tag;
   - release bundle containing `codex.exe`, `codex-core.exe`, `codex-windows-sandbox-setup.exe`, `codex-command-runner.exe`, and `rg.exe`;
   - GitHub Release asset verification.
5. Automation may verify the release asset non-destructively but must not run global `npm install -g`. Operator install then verifies `codex --version`.
6. Run the exact installed Ralph 5.64 V2 dogfood from `run-installed-skill-dogfood.ps1`, with the command and evidence copied under this task's dogfood directory.
7. Only after installed acceptance, advance the codexu `codex` gitlink and unblock Ralph 5.64 bookkeeping. Pre-.4 failed children must be rerun, not relabeled.

## Security and rollback constraints

- **Explicit privacy change:** for providers that report no encrypted inter-agent-message support, delegated task text is plaintext in the provider request and local rollout/history. This matches practical V1 behavior but must be documented. Dogfood must use a unique nonsecret canary.
- **No late relabeling:** never place plaintext under `encrypted_content`, strip markers in `core/src/client.rs`, or mutate generic transport/protocol serialization.
- **Default-safe compatibility:** capability defaults to encrypted support; only explicit provider implementations opt out. OpenAI and existing configured providers retain encrypted V2.
- **No history migration:** the fork has neither plaintext nor a key for pre-.4 ciphertext-only child rollouts. Preserve them as failed evidence and rerun from original task sources.
- **Wait is not a validator:** targeted wait may return for `Completed(None)`; workflow acceptance must reject null/blank output for a non-empty canary.
- **Rollback:** V2 is default-off (`features/src/lib.rs`). The temporary rollback is explicit V1 by omitting/disabling `features.multi_agent_v2`; never silently translate V2 calls to V1. Reverting only the plaintext policy while leaving Copilot unable to decrypt must fail closed rather than recreate empty children.
- **Release rollback:** release tags and patched retention tags are immutable. If `.4` is bad, publish a higher suffix or reinstall the known `.3` bundle; never move `v0.141.0-copilot-api.4` or `release/0.141.0-copilot-api.4`.

## Prerequisites and Windows pitfalls

1. **Workspace parse:** run `cargo metadata --no-deps --format-version 1` before implementation. The current checked-out source parses, but the implementation must use its own nested worktree/submodule.
2. **Long paths:** this plan worktree is extremely deep. Build in the canonical `codex/.worktrees/<task>/` implementation worktree; do not add another sibling-of-repo or nested plan path.
3. **Frozen build profile:** source `codex/scripts/iteration-env.sh`; do not change LTO, codegen units, or `RUSTFLAGS` between rounds. `CARGO_BUILD_JOBS` alone is safe to tune.
4. **Toolchain:** LLVM `clang-cl`/`lld-link`, xwin SDK/CRT, matching rusty_v8 archive, stable MSVC Rust toolchain, sccache, and at least 75 GB free on D:.
5. **Wrong binary command:** `cargo build -p codex-core` builds the library, not `codex-core.exe`. The publish workflow builds `codex-cli --bin codex-core` plus the launcher and two helper executables.
6. **File locking:** close running `codex.exe`/`codex-core.exe` before release build and global install. Windows otherwise leaves stale binaries after `Access is denied`/`EPERM`. If automation must stop a process, identify and stop the specific PID rather than killing by name.
7. **Git Bash linker collision:** LLVM must precede `/usr/bin` so coreutils `link.exe` does not shadow `lld-link`.
8. **PATHEXT trap:** Python's package builder cannot resolve `npm`/`pnpm` `.cmd` shims from Git Bash without the documented wrapper; PowerShell avoids this.
9. **PowerShell encoding:** keep `.ps1` edits ASCII or UTF-8 with BOM under PowerShell 5.1.
10. **Auth switching:** patched retention tags use the `Evyatar108` account; wrapper `gim-home/codex` pushes/releases use `evmitran_microsoft`. Restore the normal account afterward.
11. **Stale install:** verify `Get-Command codex`/`where codex` and `codex --version`; old `~/.codex-sandbox/bin` or a locked global package can shadow `.4`.
12. **No forbidden temp path:** the publish document's optional verification example uses `mktemp`/`/tmp`; in this execution environment use a project-relative scratch directory and clean it afterward.

## Common mistakes to prevent in the plan

- Editing `model-provider-info` by reflex instead of using the existing runtime `ProviderCapabilities`.
- Applying a Copilot predicate separately at three tool sites rather than deriving one general policy.
- Fixing only `spawn_agent`; `send_message` and `followup_task` share the same defect.
- Omitting the schema change while changing runtime construction, or vice versa.
- Changing `AgentStatus`, rejecting `Completed(None)` globally, or making targetless wait wake on historical completions.
- Waiting on generic mailbox activity in the targeted branch; unrelated mail must not satisfy an exact wait.
- Checking status before subscribing, which recreates the race.
- Returning child content from V2 wait without intentionally changing its public output contract.
- Assuming a `configure_copilot_session_for_tests` helper exists.
- Building/publishing only the one patch while overlooking the ten inner and fifteen wrapper commits already beyond `.3`.
- Committing only the inner source or only the Codex wrapper gitlink; the codexu parent pointer is the third persistent layer.
- Treating green source tests or parent exit code `0` as final acceptance instead of running the installed four-child dogfood.

## Planning conclusion

The smallest verified design is: add a default-true runtime provider capability, override it false for Copilot, derive one V2 encoding enum in `spec_plan`, use it consistently for all three schemas and communications, and add an optional exact task-name wait branch using the existing status watch with subscribe-before-read ordering. Keep protocol, client transport, V1, targetless V2, and generic `Completed(None)` semantics unchanged. Ship only after `.4` release/install and four-role installed Ralph 5.64 evidence pass.

## Architect Analysis

# Architect Analysis — D-001 Copilot V2 plaintext handoff and exact wait

## Executive recommendation

Implement D-001 as two independently testable native Codex changes in the same `0.141.0-copilot-api.4` release:

1. **Provider-owned V2 message capability.** Extend the existing runtime `ProviderCapabilities` abstraction with a positive capability such as `encrypted_inter_agent_messages`. Its compatibility default is `true`; `CopilotModelProvider` explicitly returns `false`. Resolve that capability once while building the V2 tool set, store the resulting `Encrypted`/`Plaintext` mode on each relevant handler, and use that same mode for both the model-visible schema and `InterAgentCommunication` construction.
2. **Optional exact V2 wait.** Add optional `task_name` to V2 `wait_agent`. The targeted branch resolves one task, subscribes to that task's status watch, then inspects the receiver's current value. It awaits later status changes and user steering on the already-subscribed receivers. The no-target branch stays byte-for-byte behaviorally equivalent to today's mailbox-activity wait.

Do not change `InterAgentCommunication`, `core/src/client.rs`, `codex-api`, targetless historical-completion semantics, V1, or `Completed(None)`. Existing `InterAgentCommunication::new` and `new_encrypted` already represent the two truthful wire shapes. Actual Copilot service behavior is proved by the published-installed Ralph 5.64 dogfood; deterministic in-tree tests prove the provider/schema/encoding/wait mechanics without introducing a production transport test hook.

This is necessarily a bounded upstream-canonical patch. An overlay cannot truthfully alter a schema before the model creates tool arguments, cannot access private V2 status/input-queue machinery without widening APIs, and a late transport rewrite would recreate the exact mislabeling D-001 rejects.

## Verified current architecture and failure path

### Provider and tool planning

- `codex/external/repos/codex-patched/codex-rs/model-provider/src/provider.rs`
  - `ModelProvider` is the runtime provider abstraction.
  - `ProviderCapabilities` is already the provider-owned upper-bound mechanism used by core tool planning.
  - Defaults are permissive; specialized providers override only unsupported behavior.
- `codex/external/repos/codex-patched/codex-rs/model-provider/src/copilot.rs`
  - `CopilotModelProvider` is selected for the reserved Copilot provider ID.
  - It currently inherits default capabilities and therefore has no way to report the missing cross-child encrypted-message service behavior.
- `codex/external/repos/codex-patched/codex-rs/model-provider-info/src/lib.rs`
  - `create_copilot_provider`, reserved ID handling, `is_copilot`, and `is_copilot_trusted` establish the correct provider identity.
  - This file should remain a reference, not the decision site: adding another `is_copilot()` branch in core would scatter provider policy. A runtime capability is the final operator-selected general design.
- `codex/external/repos/codex-patched/codex-rs/core/src/session/turn_context.rs`
  - `TurnContext.provider` is a `SharedModelProvider`; `turn_context.provider.capabilities()` is available when tools are planned.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs`
  - `add_collaboration_tools` creates the V2 spawn/send/follow-up/wait handlers.
  - This is the correct single point to resolve the provider capability into a V2 message mode and pass it into all three message-bearing handlers. Resolving once prevents schema/runtime drift.

### Schema and communication construction

- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
  - `spawn_agent_common_properties_v2`, `create_send_message_tool`, and `create_followup_task_tool` unconditionally call `JsonSchema::with_encrypted()` on `message`.
  - `create_wait_agent_tool_v2` currently exposes only optional `timeout_ms`.
- `codex/external/repos/codex-patched/codex-rs/tools/src/json_schema.rs`
  - `with_encrypted()` merely emits the model-service schema annotation; it does not encrypt or decrypt in Codex.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2.rs`
  - `communication_from_tool_message` unconditionally calls `InterAgentCommunication::new_encrypted`.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
  - Text-only initial tasks are converted to an `Op::InterAgentCommunication` through that shared helper.
  - Requested `model` and `reasoning_effort` are already applied independently and were retained in the failed raw children; routing is not the defect.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs`
  - Both `send_message` and `followup_task` share this runtime path and the same helper.
- `codex/external/repos/codex-patched/codex-rs/protocol/src/protocol.rs`
  - `InterAgentCommunication::new` stores plaintext in `content`, leaves `encrypted_content` absent, and emits `agent_message/input_text`.
  - `InterAgentCommunication::new_encrypted` stores only the opaque value in `encrypted_content` and emits `agent_message/encrypted_content`.
  - No protocol extension is needed. Putting plaintext into `new_encrypted` is the current lie and must not be preserved under another name.

### Wait and completion

- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
  - The current V2 wait subscribes only to aggregate `InputQueueActivity` and returns on pending/future mailbox activity, user steering, or timeout.
  - It has no exact target and cannot recover a completion whose mailbox item was already delivered before the wait starts.
- `codex/external/repos/codex-patched/codex-rs/core/src/session/input_queue.rs`
  - `InputQueueActivity` distinguishes `Mailbox` from `Steer`.
  - A targeted wait can continue past unrelated mailbox activity while still returning promptly on steering.
- `codex/external/repos/codex-patched/codex-rs/core/src/agent/control.rs`
  - `resolve_agent_reference` resolves relative/canonical V2 task paths.
  - `subscribe_status` returns a Tokio watch receiver containing the latest `AgentStatus`.
  - The completion watcher already uses subscribe-then-read behavior.
- `codex/external/repos/codex-patched/codex-rs/core/src/agent/status.rs`
  - `TurnComplete.last_agent_message` mechanically becomes `AgentStatus::Completed(Option<String>)`.
  - `Completed(None)` is valid protocol state. It is not a production error to outlaw; it is an acceptance failure for a child that was given a non-empty canary/task.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/wait.rs`
  - V1 is useful prior art: subscribe to each status receiver before reading its current status. V1 itself must remain unchanged.

## Proposed design

### 1. General provider capability

Add `encrypted_inter_agent_messages: bool` to `ProviderCapabilities` in `model-provider/src/provider.rs`.

- Default: `true`, preserving every existing provider and custom configured-provider behavior.
- Copilot: override `CopilotModelProvider::capabilities()` with `encrypted_inter_agent_messages: false` and `..ProviderCapabilities::default()`.
- Amazon Bedrock: update its explicit `ProviderCapabilities` literal and equality test to retain `true`, preferably using `..Default::default()` for future additive capability resilience.
- Do not expose a user config toggle in `.4`. This is a provider implementation capability, not an operator preference. A user-controlled downgrade would make accidental plaintext easier and is not required.
- Do not key core behavior on display name or `is_copilot()`. Future provider implementations can independently return `false`.

Use a small, copyable internal enum in the V2 handler module, for example:

```text
V2MessageEncoding
├─ Encrypted
└─ Plaintext
```

The enum is preferable to passing positional booleans. Its default should be `Encrypted` so existing direct-handler tests and any missed non-production constructor remain fail-compatible with the old behavior.

### 2. One policy value drives schema and runtime

In `spec_plan.rs::add_collaboration_tools`:

1. Read `turn_context.provider.capabilities().encrypted_inter_agent_messages`.
2. Convert it once to `V2MessageEncoding`.
3. Pass it to `SpawnAgentHandlerV2`, `SendMessageHandlerV2`, and `FollowupTaskHandlerV2`.

Each handler instance must retain the mode. Its `spec()` and `handle()` paths must read that same field:

- `Encrypted` schema: preserve `.with_encrypted()`.
- `Plaintext` schema: emit an ordinary string schema with the existing task/message description and no `encrypted` property.
- `Encrypted` runtime: preserve `InterAgentCommunication::new_encrypted`.
- `Plaintext` runtime: call `InterAgentCommunication::new`.

Extend the existing shared `communication_from_tool_message` seam rather than duplicating constructors in spawn/send/follow-up. Convert the current unit send/follow-up handlers to small structs with `Default = Encrypted` and explicit `new(mode)` constructors. That keeps production provider-aware while minimizing churn in existing direct tests.

The three operations are one compatibility unit:

```text
spawn_agent(message) ─┐
send_message(message) ├─ schema mode ──> tool argument ──> same runtime mode ──> InterAgentCommunication
followup_task(message)┘
```

Fixing spawn alone is incomplete: later follow-up or queued communication would still be opaque to a Copilot child.

### 3. Exact optional V2 wait

Add optional `task_name: Option<String>` to the V2 `WaitArgs` and schema. Keep `timeout_ms` optional and keep `required = None`. Do not add V1's `targets` array or rename existing V2 fields.

Split handling explicitly:

```text
task_name omitted
└─ existing aggregate mailbox/steer wait, unchanged

task_name supplied
├─ resolve relative/canonical task name to thread ID
├─ obtain metadata for begin/end telemetry
├─ subscribe to that thread's status watch
├─ subscribe to input activity for user steering
├─ read status_rx.borrow_and_update()
│  └─ already final => return immediately
└─ until deadline, select:
   ├─ status changed => read; return only when exact target is final
   ├─ activity changed to Steer => return interrupted
   ├─ activity changed to Mailbox => ignore and continue
   └─ deadline => timed_out
```

Load-bearing details:

- **Subscribe before current read.** This closes both races: already final before the call and completion between subscription and inspection.
- **Use the same receiver.** Do not perform a separate `get_status` precheck followed by a new subscription.
- **Ignore unrelated mailbox activity only in the targeted branch.** Do not drain or rewrite mailbox items; completion notifications remain available through the normal model-context path.
- **Preserve steering.** Pending steering returns immediately; future steering races through the activity receiver.
- **Preserve output privacy/shape.** `WaitAgentResult` remains `{message, timed_out}` and does not duplicate child content. Exact final status may populate `CollabWaitingEndEvent.statuses`/`agent_statuses` for telemetry, but the model receives the normal completion notification/list result.
- **Clear errors.** An unresolved or unloaded/removed exact task should be a model-facing target error, not a false successful wait. Do not silently fall back to targetless mode.
- **No historical-any change.** Omitted-target V2 must not scan all open agents for prior final states; stale open completions would cause false wakes and Ralph loops.

### 4. Meaningful completion is acceptance, not protocol mutation

Do not change `AgentStatus::Completed(Option<String>)` or make `Completed(None)` globally invalid.

Instead, acceptance for the delegated nonsecret canary and installed Ralph roles requires:

- `Completed(Some(text))`;
- `text.trim()` is non-empty;
- the returned text satisfies the role contract (prose or artifact/job path);
- required on-disk artifacts exist and parse where applicable.

This distinction avoids breaking generic agents that legitimately end without a final assistant message while preventing this rollout from treating a message-less child as success.

## Dependency graph

```text
ProviderCapabilities default=true
├─ Configured/OpenAI/Bedrock remain encryption-capable
└─ CopilotModelProvider override=false
   ↓
TurnContext.provider.capabilities()
   ↓
spec_plan::add_collaboration_tools resolves V2MessageEncoding once
   ├─ SpawnAgentHandlerV2
   │  ├─ provider-aware spawn schema
   │  └─ shared communication constructor
   ├─ SendMessageHandlerV2
   │  ├─ provider-aware send schema
   │  └─ shared communication constructor
   └─ FollowupTaskHandlerV2
      ├─ provider-aware follow-up schema
      └─ shared communication constructor
         ↓
InterAgentCommunication::{new,new_encrypted}
         ↓
ResponseItem::AgentMessage::{InputText,EncryptedContent}

wait_agent(task_name?)
├─ omitted ──> existing InputQueue mailbox/steer behavior
└─ exact ────> resolve_agent_target
               ├─ AgentControl::subscribe_status (first)
               ├─ receiver current value (second)
               ├─ later status changes
               └─ InputQueueActivity::Steer

source/tests/docs green
   ↓
inner codex-patched source commit
   ↓
codex wrapper gitlink/docs commit
   ↓
version bump + release commits/tags/bundle
   ↓
operator-installed 0.141.0-copilot-api.4
   ↓
exact installed Ralph 5.64 dogfood
   ↓
codexu pointer/evidence closeout; only then unblock Ralph 5.64
```

## File plan

### Inner `codex-patched` source — modify

- `codex/external/repos/codex-patched/codex-rs/model-provider/src/provider.rs`
  - Add the general capability and default-true test.
- `codex/external/repos/codex-patched/codex-rs/model-provider/src/copilot.rs`
  - Override the capability to false; add focused provider test.
- `codex/external/repos/codex-patched/codex-rs/model-provider/src/amazon_bedrock/mod.rs`
  - Preserve the new default-true field in the existing explicit capability value/test.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs`
  - Resolve one mode from the active provider and construct all three V2 message handlers with it.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
  - Make V2 spawn/send/follow-up message schemas mode-aware.
  - Add optional V2 wait `task_name` schema and update its description without changing the result schema.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2.rs`
  - Own/re-export the explicit encoding enum and make the existing shared communication constructor mode-aware.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
  - Store/use the mode in both `spec()` and initial communication construction.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs`
  - Store/use the mode; preserve encrypted default for direct tests.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/followup_task.rs`
  - Store/use the mode; preserve encrypted default for direct tests.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs`
  - Pass the handler's mode through the existing shared send/follow-up construction path.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
  - Add the optional exact branch and subscribe-before-read select loop.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan_tests.rs`
  - Replace the provider-blind encrypted-schema assertion with OpenAI/encryption-capable and Copilot/plaintext cases covering all three tools.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec_tests.rs`
  - Unit-test both schema modes and optional/non-required exact wait input.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_tests.rs`
  - Cover plaintext/encrypted communication construction for spawn/send/follow-up and exact wait behavior/races.
- `codex/external/repos/codex-patched/codex-rs/core/tests/suite/subagent_notifications.rs`
  - Retain the non-Copilot encrypted wire test and add/adjust the deterministic Copilot-ID canary integration as described below.
- `codex/external/repos/codex-patched/codex-rs/Cargo.toml`
  - Release-only workspace version bump to `0.141.0-copilot-api.4`.
- `codex/external/repos/codex-patched/codex-rs/Cargo.lock`
  - Release version lock refresh. No dependency or Bazel lock change is expected.

### Wrapper `codex` repo — modify

- `codex/docs/implementation/patch-surface.md`
  - Add §14 invariant rows 76 and 77 (or the next unallocated IDs after rechecking at implementation time).
  - Add a §15 “Provider-aware V2 handoff and exact wait replant” section with seams, markers, tests, and rollback.
- `codex/docs/implementation/regression-history.md`
  - Add the `.3` failure/`.4` fix ledger entry, including the opaque child symptom, missed already-final wait, and installed dogfood proof.
- `codex/external/repos/codex-patched`
  - Gitlink advances first to the implementation commit, then to the `.4` release/version commit.

### Codexu acceptance harness/evidence — modify or add in a separate closeout

- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/run-installed-skill-dogfood.ps1`
  - The current `Assert-CodexPlanRoutes` checks role/model/effort and a generic task-complete row but does **not** reject `last_agent_message = null`, prove plaintext input, reject timed-out wait results, or assert the role artifacts. Strengthen it before rerunning, or add an equally strict companion validator under the current job.
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/`
  - Retain the exact command record, summary, copied parent/child rollouts, child-role evidence, wait evidence, artifact inventory/hashes, installed version/launcher output, and a concise result manifest.

Do not edit Ralph 5.64 plugin source for this task. Acceptance must use the existing installed cache at `C:\Users\evmitran\.codex\plugins\cache\ai-developer-toolkit\ralph-orchestration\5.64.0`.

### Reference only — do not modify unless a failing probe disproves the design

- `codex/external/repos/codex-patched/codex-rs/model-provider-info/src/lib.rs`
- `codex/external/repos/codex-patched/codex-rs/protocol/src/protocol.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/session/input_queue.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/agent/control.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/agent/status.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/client.rs`
- `codex/external/repos/codex-patched/codex-rs/codex-api/**`
- `codex/.claude/commands/publish-sandbox-patch.md`
- `codex/.claude/commands/verify.md`

## Ordered implementation

1. **Create isolated nested worktrees and verify the seam.**
   - Use the topology below; do not implement in the plan worktree.
   - Initialize submodules recursively.
   - Run `cargo metadata --no-deps --format-version 1` from the wrapper worktree's normal nested `external/repos/codex-patched/codex-rs` path.
   - Re-run focused source probes for the named functions; upstream layouts move.
2. **Add the provider capability first.**
   - Default true, Copilot false, Bedrock explicit behavior preserved.
   - Add provider tests before core consumes the field.
3. **Introduce the explicit V2 encoding mode and schema/runtime plumbing.**
   - Resolve once in `spec_plan`.
   - Update all three schemas and handlers together.
   - Keep `InterAgentCommunication` unchanged.
4. **Add focused handoff tests.**
   - First prove schema truthfulness.
   - Then prove communication object/wire truthfulness and requested child routing.
   - Keep the existing encrypted-provider test as a regression control.
5. **Implement exact wait independently.**
   - Add schema/args.
   - Preserve the omitted-target helper/path.
   - Implement subscribe-before-read targeted status/steer wait and exact telemetry.
6. **Add deterministic wait and Copilot-ID integration coverage.**
   - Test the transition-before-current-read race via a watch receiver that is updated after subscription but before helper inspection; avoid a flaky sleep-only race test.
   - Test actual handler resolution and telemetry separately.
7. **Register the patch and ledger.**
   - Add `// SANDBOX PATCH: provider-aware-v2-handoff` and `// SANDBOX PATCH: exact-v2-wait` anchors adjacent to every fork edit block.
   - Add §14/§15 and regression-history updates in the same wrapper commit as the gitlink.
8. **Run local quality gates under the frozen profile.**
   - Format/fix according to the nested Rust guidance.
   - Run focused nextest crates/families, audits, then `cargo check --workspace`.
   - Do not run a local full workspace test; CI owns it and the documented local cost is 90+ minutes.
9. **Commit implementation in two logical source commits if practical.**
   - Commit A: provider-aware schema/encoding.
   - Commit B: exact targeted wait.
   - Wrapper commit records the resulting inner SHA plus patch-surface/regression docs.
10. **Run Phase 5a/5b code/docs review-fix convergence.**
    - Do this before release publication, not after story completion.
11. **Cut `0.141.0-copilot-api.4` through the publish workflow.**
    - Follow the exact release order below; do not improvise tags or package layout.
12. **Operator installs the published bundle; automation verifies read-only.**
    - Global npm installation is explicitly operator-owned by the publish/verify workflows.
13. **Run the exact installed Ralph 5.64 dogfood and strict companion assertions.**
    - A source checkout or `.3` binary is not acceptance.
14. **Only after installed dogfood passes, finish parent codexu pointer/evidence bookkeeping and unblock Ralph 5.64.**

## Test design and commands

### Focused deterministic coverage

Run from `codex/external/repos/codex-patched` using `just test` (the repo's nextest wrapper), not bare `cargo test`:

- `just test -p codex-model-provider` for capability defaults and Copilot override.
- Focused `codex-core` filters covering:
  - `multi_agent_v2_message_schemas`;
  - spawn/send/follow-up encoding;
  - exact `wait_agent`;
  - `subagent_notifications`.
- Existing V1 targetful wait/spawn tests remain green.

The required cases are:

**Schema**
- Copilot `spawn_agent`, `send_message`, `followup_task`: `message.encrypted == None`.
- OpenAI/default/Bedrock: `message.encrypted == Some(true)`.
- V2 `wait_agent`: optional `task_name`, optional `timeout_ms`, no `targets`, unchanged output schema.

**Encoding**
- Plaintext mode: `content == canary`, `encrypted_content == None`, model input is `agent_message/input_text`.
- Encrypted mode: `content` empty, `encrypted_content == Some(opaque)`, model input is `agent_message/encrypted_content`.
- Cover spawn, queued send, and trigger-turn follow-up.
- Assert plaintext is never stored under `encrypted_content`.

**Exact wait**
- Exact target already `Completed(Some(...))` before call.
- Receiver subscribed, then target completes before the helper's first current-value read.
- Target completes after initial current-value read.
- Unrelated previously queued mailbox item does not satisfy exact wait.
- Unrelated future mailbox activity does not satisfy exact wait.
- Pending and future user steering interrupts exact wait.
- Exact timeout returns `timed_out: true`.
- Invalid/missing exact target errors without targetless fallback.
- Omitted target retains current pending-mail, future-any-mail, steering, and timeout behavior.
- V1 targetful wait is unchanged.

**Copilot-ID deterministic integration**
- Build a turn with `create_model_provider(create_copilot_provider(), ...)`, enable V2, and build the production tool plan.
- Assert provider capability selects plaintext schemas for all three tools.
- Spawn `task_name = "provider_canary"` with exact `model = "gpt-5.6-sol"` and `reasoning_effort = "xhigh"`.
- Inspect the real spawned child config snapshot for exact model/effort and the captured initial op for `input_text`.
- Emit a real child `TurnComplete` with a unique nonsecret canary and assert the exact wait returns non-timeout while status is `Completed(Some(canary))`.

This is a core integration of provider identity, production planning, handler construction, child configuration, communication, status, and wait. It intentionally does not fake Copilot service decryption. Current source explicitly notes at `core/tests/suite/client.rs` that the old Copilot Responses URL test side-channel was removed. Reintroducing a test-only `core/src/client.rs` URL override would add a high-churn seam unrelated to production correctness. The installed dogfood is the real service boundary test. Reopen the test-sidechannel choice only if Phase-4 review insists that “Copilot-ID integration” must issue a hermetic HTTP request; do not silently add it.

### Quality gates

From the codex wrapper worktree:

```text
source codex/scripts/iteration-env.sh
cd codex/external/repos/codex-patched/codex-rs
cargo check --workspace
```

Also run:

- `just fmt` from `codex/external/repos/codex-patched`;
- scoped `just fix -p codex-model-provider` and `just fix -p codex-core`;
- `bash codex/scripts/audit_invariants.sh`;
- `bash codex/scripts/audit_network_calls.sh` because this sandbox patch touches upstream-canonical files, even though it adds no egress;
- no `just bazel-lock-update`: there are no dependency changes.

Use a project-relative output file for long command logs; do not use `/tmp`.

## Upstream-canonical conflict budget and overlay alternatives

### Budget

Expected production footprint: approximately 10 upstream-canonical files, about 120–200 net production lines, plus focused tests. Keep the full non-mechanical change under the repository's 500-line complex-change target where possible; if tests push the total over that threshold, retain two reviewable commits rather than compressing assertions.

Observed churn:

- `spec_plan.rs`, `multi_agents_spec.rs`, and `multi_agents_v2/wait.rs` moved in both the 0.140 and 0.141 rebases: **medium-high re-conflict probability**.
- `multi_agents_v2/spawn.rs` is actively changed by upstream/fork UX work: **medium**.
- `message_tool.rs` and the small V2 module are less active: **low-medium**.
- `model-provider/src/provider.rs` changes with provider abstraction evolution: **medium**.
- `model-provider/src/copilot.rs` is fork-owned in intent but lives in the upstream subtree and is frequently extended: **medium**, usually straightforward.

Budget expectation: 2–4 conflict hunks on a future multi-agent/provider rebase, not a broad protocol conflict. Keep the provider decision in one capability, the schema decision in one helper, communication in the existing shared helper, and targetless wait untouched to hold that budget.

### Alternatives considered

1. **Fork-exclusive overlay crate:** rejected. Core tool schema creation and V2 private control-plane types are not injectable. Making them injectable would add more public APIs and dependency edges than the patch itself.
2. **New file inside the upstream core crate:** acceptable only if the encoding policy grows. For `.4`, the existing small `multi_agents_v2.rs::communication_from_tool_message` seam is simpler than a one-use module. Do not create a helper referenced once.
3. **`is_copilot()` branches in schema and handlers:** rejected by the final operator decision. It duplicates policy and cannot represent another unsupported provider.
4. **Serialized config toggle in `ModelProviderInfo`:** rejected for `.4`. It exposes a plaintext downgrade knob and creates constructor/schema churn. The runtime capability is general across provider implementations while remaining provider-owned.
5. **Late rewrite in `core/src/client.rs`/`codex-api`:** rejected. The schema has already caused the service to return an opaque value; Codex has no plaintext or key. Relabeling it cannot restore task text and would corrupt persistence semantics.
6. **Protocol extension:** rejected. `InterAgentCommunication` already has truthful plaintext and encrypted constructors and wire forms.
7. **Targetless scan of historical completions:** rejected. Open completed agents are reusable and retained; any-old-final wake creates false positives and repeated wait loops.
8. **Silent V2-to-V1 emulation:** rejected. V1 is an explicit operational rollback with different schema/identity/result semantics.

## Patch registration (§14/§15)

Add two independent invariant rows:

- **Invariant 76 — provider-aware V2 message truthfulness.**
  - Provider default supports encryption; Copilot explicitly does not.
  - All three V2 message schemas and runtime communications use the same resolved mode.
  - Copilot plaintext never occupies `encrypted_content`; capable providers remain encrypted.
  - Enforcement: provider unit tests, `spec_plan_tests`, spec tests, handler encoding tests, and the non-Copilot wire integration.
- **Invariant 77 — exact V2 wait subscribe-before-read.**
  - Optional exact `task_name` resolves one status receiver, subscribes before current inspection, ignores unrelated mailbox activity, preserves steering/timeout, and leaves omitted-target/V1 semantics unchanged.
  - Enforcement: deterministic receiver-race tests plus handler tests.

Add a §15 replant entry listing the exact source seams above, the marker names, the default-true security rule, the no-protocol/no-client boundaries, and the focused commands. On every rebase:

1. verify `ProviderCapabilities`, V2 tool constructors, and status receiver APIs still exist;
2. reapply capability and handler mode before schema tests;
3. reapply exact wait without replacing upstream targetless logic;
4. run invariant 76/77 tests before `cargo check --workspace`;
5. if upstream gains a native provider message capability or exact V2 target wait, retire the fork implementation and migrate tests rather than retaining parallel policy.

## Security, privacy, compatibility, and rollback

### Security/privacy

- The operator has accepted plaintext delegated-task visibility for providers that explicitly lack encrypted cross-child support.
- Copilot V2 task/message text will be visible in the provider request and local rollout, matching practical V1 behavior. This is a confidentiality downgrade from the intended encrypted shape, not from currently working behavior (the current encrypted path is unusable).
- Use only nonsecret canaries in tests/evidence. Do not place tokens, customer data, or private source excerpts in the dogfood task.
- Capability defaults to encrypted. Only an explicit provider implementation opt-out selects plaintext.
- Do not add logging of message bodies. Existing rollout persistence is sufficient evidence.
- Exact wait output remains summary-only; it must not echo child content into tool output.

### Compatibility

- OpenAI, Bedrock, configured providers, and future providers that do not override the capability retain encrypted V2 behavior.
- Copilot V2 changes only message encoding and gains an additive optional wait input.
- Omitted-target V2 behavior is unchanged.
- V1 tool schemas, plaintext task behavior, targetful wait, result shape, and close semantics are unchanged.
- Existing pre-`.4` rollouts deserialize unchanged. Ciphertext-only failed tasks cannot be decrypted or migrated; respawn from the original task source.
- `Completed(None)` remains valid globally.

### Rollback

- Before publication: revert the handoff and wait commits independently and rerun V1 control tests.
- After immutable `.4` tags/release: never move tags. Forward-fix with `.5`.
- Operational containment: explicitly disable `features.multi_agent_v2` and use installed Ralph's documented V1 recipe. Never silently downgrade a V2 request.
- If plaintext is later judged unacceptable, block Copilot V2 and pursue D-002 service capability; do not restore ciphertext masquerading as a usable task.
- If exact wait regresses independently, revert only the optional target branch; targetless V2 and the handoff correction can remain.

## Implementation worktree topology

The current plan worktree is:

`D:\harness-efforts\codexu\.ralph\jobs\codex-v2-copilot-encrypted-subagent-handoff\worktree\plan`

It is for plan artifacts only and must not become the implementation checkout.

Recommended implementation topology:

```text
D:\harness-efforts\codexu                         # parent stays on main; lead-owned
└─ codex\                                         # codex wrapper submodule
   └─ .worktrees\
      └─ codex-v2-copilot-encrypted-subagent-handoff\
         # branch ralph/codex-v2-copilot-encrypted-subagent-handoff
         ├─ codex-rs-overlay\
         ├─ docs\
         └─ external\repos\codex-patched\
            # recursively initialized nested checkout
            # branch ralph/codex-v2-copilot-encrypted-subagent-handoff-source
            └─ codex-rs\
```

Important exception: **do not build from a separate inner `codex-patched\.worktrees\...` checkout.** The inner workspace has a cross-boundary member path to `../../../../codex-rs-overlay/codex-invariant-tests`; it is only buildable at its normal relative location inside a codex wrapper checkout. The outer codex worktree already isolates the nested submodule from other members. Create the source branch in that nested checkout, commit/push it first, then record its SHA in the outer wrapper branch.

Commit layers:

1. nested `codex-patched` source commit(s) and later `.4` version commit;
2. codex wrapper gitlink/docs commit(s) and immutable wrapper release tag;
3. parent codexu `codex` gitlink/evidence bookkeeping, lead-owned after installed acceptance.

Because parent codexu harness/evidence and codex wrapper source are two repo roots, do not force both into one Ralph PRD. The implementation member owns the codex wrapper plus nested source/release. The lead/operator owns the install and parent acceptance closeout.

## Prerequisites and Windows/build traps

### Prerequisites

- Recursive submodules initialized in the implementation worktree.
- Inner source based on current `sandbox-patches`; wrapper based on current `origin/main`.
- Workspace parse preflight succeeds.
- `gh auth status` shows accounts with access to `gim-home/codex` and `Evyatar108/codex-openai-fork`; switch accounts per publish step.
- `gh release view v0.141.0-copilot-api.4 --repo gim-home/codex` and remote tag probes confirm `.4` is not already in flight.
- Rust/Cargo/`just`/cargo-nextest available.
- `jq` available for Ralph workflows/evidence.
- LLVM `clang-cl`/`lld-link`, xwin CRT/SDK, and matching rusty_v8 archive present.
- Installed Ralph manifest at `C:\Users\evmitran\.codex\plugins\cache\ai-developer-toolkit\ralph-orchestration\5.64.0\.codex-plugin\plugin.json` is exactly `5.64.0`.
- Ralph 5.64 remains blocked until the final installed V2 acceptance passes.

### Windows/build traps

- Keep Windows paths short enough for Rust/package tooling; the long Ralph plan path is unsuitable for release build outputs.
- Build from the codex wrapper worktree's normal nested path so overlay-relative workspace members resolve.
- Source `codex/scripts/iteration-env.sh` for every iteration; do not vary `RUSTFLAGS`, release LTO, or codegen units between rounds.
- Publish profile is separate: unset iteration/sccache variables and use LLVM+xwin with `LTO=thin`.
- Close running `codex.exe`/`codex-core.exe` processes before release build or npm install; Windows locks mapped executables.
- Build all four shipped binaries. `cargo build -p codex-core` builds the library, not `codex-core.exe`.
- Git Bash can resolve `link.exe` to coreutils unless LLVM is first on PATH.
- Python `subprocess` may not resolve `npm.cmd`/`pnpm.cmd` from Git Bash; use the documented PowerShell or `shutil.which` workaround.
- Package all four binaries plus `rg.exe`; verify the merged tarball layout before release.
- Do not write validation logs or extracted assets to `/tmp`; use a project-relative scratch/evidence directory.

## Release, install, launcher smoke, and exact Ralph dogfood

### `0.141.0-copilot-api.4` release

Follow `codex/.claude/commands/publish-sandbox-patch.md` exactly:

1. Clean-source and release-not-already-in-flight preflights.
2. Bump inner workspace version and lock to `.4`.
3. Release-profile build of `codex`, `codex-core`, `codex-windows-sandbox-setup`, and `codex-command-runner`; verify all report `.4`.
4. Run login repros, launcher tests, focused patch tests, and required audits before tagging.
5. Commit/push inner source/version to `sandbox-patches`.
6. Create and verify immutable `release/0.141.0-copilot-api.4` on the `codex-patched` remote at the exact inner SHA.
7. Commit wrapper gitlink/docs; tag/push `v0.141.0-copilot-api.4` to `gim-home/codex`.
8. Build the self-contained Windows x64 bundle, verify all four binaries plus `rg.exe`, create the GitHub Release, and verify asset digest/layout/version non-destructively.

### Install and launcher smoke

The publish workflow forbids automation from mutating the operator's global npm environment. Therefore installation is an explicit operator gate:

```powershell
gh release download v0.141.0-copilot-api.4 --repo gim-home/codex --pattern 'codex-*-win32-x64.tgz' --output "$env:TEMP\codex.tgz" --clobber
npm install -g "$env:TEMP\codex.tgz"
```

After the operator installs, automation runs read-only checks from `codex/.claude/commands/verify.md`:

- `npm ls -g @gim-home/codex` reports `.4`;
- `where.exe codex`/`Get-Command codex -All` resolves the npm shim, not stale `~/.codex-sandbox/bin`;
- vendor contains all four binaries and `rg.exe`;
- `codex --version` reports `codex-cli 0.141.0-copilot-api.4` and exits without bootstrap;
- Copilot token/config are present (do not force re-auth unless operator requests);
- capture the outputs into the current job's dogfood evidence.

### Exact installed Ralph 5.64 run

Rerun the existing pinned harness:

`pwsh -NoProfile -File D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\dogfood\run-installed-skill-dogfood.ps1`

Its exact Codex planning invocation remains the recorded command:

```text
codex exec --json --dangerously-bypass-approvals-and-sandbox
  -c features.multi_agent_v2={enabled=true,hide_spawn_agent_metadata=false}
  -C <codex-plan-probe>
  $ralph-orchestration:plan-with-ralph
  Inputs: --autonomous --depth quick --ui-ux-judgment not-required
          --job codex-installed-route-plan ...
```

Do not substitute in-tree Ralph, edit the installed cache, disable V2, or invoke a different plan recipe.

Strengthened acceptance must prove for each exact task:

- `plan_researcher`
- `plan_drafter`
- `plan_initial_review`
- `plan_review_synthesis`

that:

1. Parent spawn used exact `gpt-5.6-sol`/`xhigh` and child effective context retained both.
2. Child initial `agent_message` is `input_text`, contains its nonsecret `RALPH_DISPATCH_ROLE=<role>` marker/readable structured task, and contains no `encrypted_content`.
3. Child has exactly one successful terminal completion with non-null, nonblank `last_agent_message`.
4. Each V2 wait targets the exact returned `task_name`, returns `timed_out:false`, and does not consume the 600000-ms ceiling.
5. No unrelated completion is accepted for another role.
6. The outcome artifacts exist and are meaningful:
   - researcher contribution present in non-failure `research-brief.md`;
   - drafter produces final `plan.md` and parseable `suggested-decomposition.json`;
   - initial reviewer produces nonempty `primary-plan-review.md`;
   - synthesis produces nonempty `plan-review.md` and parseable `plan-review-findings.json`.
7. The top-level summary status is `passed`, and raw parent/child evidence is copied rather than inferred from command success.

An exit code 0 alone is not acceptance. The prior failed run already exited 0 while children completed empty and waits timed out.

## Primary risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Schema and runtime mode diverge | Plaintext mislabeled encrypted or ciphertext treated as text | Resolve once; store one enum on each handler; paired schema/object tests |
| Only spawn is fixed | Later send/follow-up remains unreadable | Treat all three tools as one invariant/release unit |
| Status check occurs before subscription | Fast completion still missed | Receiver first, `borrow_and_update` second; deterministic race test |
| Exact wait wakes on unrelated mailbox | Wrong role accepted or loop | Ignore mailbox activity in targetful branch; preserve only steer/status/deadline |
| Targetless semantics accidentally change | Stale completed agents cause false wakes | Separate branch; regression-test omitted target |
| `Completed(None)` is globally prohibited | Breaks legitimate generic terminal behavior | Acceptance-only nonempty requirement |
| Capability defaults plaintext | Confidentiality/compatibility regression | Positive capability defaults true; only explicit provider override is plaintext |
| “Copilot integration” test is only a mock | Service boundary remains unproved | Deterministic provider-ID core test plus mandatory published-installed dogfood |
| Existing dogfood false-passes | Empty children could be accepted | Strengthen/companion-validate raw content, wait result, final message, artifacts |
| Release built from wrong nested checkout | Overlay workspace path fails or wrong binary ships | Build from outer codex worktree's normal nested submodule path |
| Global install performed by automation | Unauthorized machine mutation | Operator-owned install gate; read-only automated verification |
| Immutable release needs rollback | Tags cannot safely move | Forward-fix `.5`; explicit V1 containment |

## Completion definition

D-001 is complete only when:

- provider capability, schema, communication, and exact wait changes are registered and reviewed;
- focused tests, audits, and `cargo check --workspace` pass under the frozen profile;
- code and docs Phase 5a/5b converge clean;
- inner and wrapper commits/tags point to the intended SHAs;
- the published bundle is `0.141.0-copilot-api.4` and contains the correct four binaries;
- the operator-installed launcher reports `.4`;
- the exact installed Ralph 5.64 V2 dogfood passes all four role, plaintext, routing, nonempty completion, exact-wait, and artifact assertions;
- parent codexu records the final pointer/evidence;
- only then is Ralph 5.64 unblocked.

## Codex Research

### Codebase Architecture

- The implementation lives in a patched OpenAI Codex Rust workspace at `codex/external/repos/codex-patched/codex-rs/`, pinned as a git submodule by the wrapper repository under `codex/`.
- It is a large Cargo workspace using Rust 2024, Tokio, Serde, Schemars, and custom `codex-tools` JSON schemas. Core behavior is primarily in:
  - `core/` — sessions, agents, tool registration and handlers.
  - `model-provider/` — runtime provider abstraction and capabilities.
  - `model-provider-info/` — serialized provider configuration and built-ins.
  - `protocol/` — shared wire/session types.
- Fork-only crates live under `codex/codex-rs-overlay/`, but the requested changes affect upstream-owned tool/schema seams and therefore require `// SANDBOX PATCH:` markers.
- Builds and tests use Cargo plus repository `just` commands. Local work must source `codex/scripts/iteration-env.sh`; release packaging uses the separate profile in `codex/.claude/commands/publish-sandbox-patch.md`.

### Feature-Relevant Code

**Provider capability**

- `codex-rs/model-provider/src/provider.rs`
  - Already defines `ProviderCapabilities` and `ModelProvider::capabilities()`.
  - This is the natural general capability seam. Add an encrypted-inter-agent-message capability defaulting to `true`.
- `codex-rs/model-provider/src/copilot.rs`
  - `CopilotModelProvider` currently inherits all default capabilities.
  - Override `capabilities()` so only encrypted V2 inter-agent messages are unsupported.
- `codex-rs/model-provider/src/amazon_bedrock/mod.rs`
  - Contains explicit `ProviderCapabilities` literals that must add the new default-true member.
- Using `ProviderCapabilities` is much smaller than adding a field to `ModelProviderInfo`; that struct has roughly 70 literal construction sites.

**Schema generation**

- `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
  - `spawn_agent_common_properties_v2()` marks `message` with `.with_encrypted()`.
  - `create_send_message_tool()` and `create_followup_task_tool()` do likewise.
  - `wait_agent_tool_parameters_v2()` currently exposes only `timeout_ms`.
- `codex-rs/core/src/tools/spec_plan.rs:730`
  - Builds V2 handlers with access to `turn_context.provider.capabilities()`.
  - Pass the resolved message-encoding capability into the three message handlers so their model-visible schemas and runtime behavior use one decision.
- Existing schema tests are in `core/src/tools/handlers/multi_agents_spec_tests.rs`.

**Communication encoding**

- `core/src/tools/handlers/multi_agents_v2.rs:43`
  - `communication_from_tool_message()` unconditionally calls `InterAgentCommunication::new_encrypted`.
  - Extend this shared constructor to select `new_encrypted` or `new`.
- `core/src/tools/handlers/multi_agents_v2/spawn.rs:116`
  - Converts the initial text-only child operation into inter-agent communication.
  - Existing model/reasoning override logic already preserves requested routing.
- `core/src/tools/handlers/multi_agents_v2/message_tool.rs:58`
  - Shared dispatch for `send_message` and `followup_task`.
- `protocol/src/protocol.rs:686`
  - `InterAgentCommunication::new()` stores plaintext in `content`.
  - `new_encrypted()` empties `content` and sets `encrypted_content`.
  - `to_model_input_item()` already emits `agent_message/input_text` versus `encrypted_content` correctly. No protocol or client transport rewrite is necessary.

**Exact V2 wait**

- `core/src/tools/handlers/multi_agents_v2/wait.rs`
  - Targetless behavior subscribes only to input-queue mailbox/steering activity.
  - Add optional `task_name` to `WaitArgs`, retaining the existing branch unchanged when omitted.
- `core/src/agent/agent_resolver.rs`
  - `resolve_agent_target()` already resolves relative and canonical V2 task names.
- `core/src/agent/control.rs:340`
  - `subscribe_status()` returns a Tokio watch receiver carrying the current status and future updates.
- `core/src/tools/handlers/multi_agents/wait.rs`
  - V1 provides the correct subscribe-first pattern and `wait_for_final_status()` helper behavior.
- `core/src/agent/status.rs`
  - Provides `is_final`; `Completed(None)` must remain valid.

**Tests and release**

- `core/src/tools/handlers/multi_agents_tests.rs`
  - Existing V2 encoding and targetless wait tests.
- `core/tests/suite/subagent_notifications.rs:1027`
  - Existing encrypted `agent_message` wire integration test; retain it for encryption-capable providers and add a Copilot plaintext counterpart.
- `model-provider/src/copilot.rs` tests can enforce the Copilot capability override.
- `codex/docs/implementation/patch-surface.md`
  - Add §14 invariant/test rows and a §15 replant subsection.
- `codex/.claude/commands/publish-sandbox-patch.md`
  - Defines version bump, four-binary build, tests, submodule retention tag, wrapper tag, bundle, and non-destructive verification.

### Technical Constraints

- All edits under `external/repos/codex-patched/codex-rs/` require nearby `// SANDBOX PATCH:` markers plus patch-surface invariant and replant documentation.
- V1 schemas and handlers must remain unchanged.
- Encryption-capable providers must default to encrypted behavior. A new capability must therefore default to `true`, with Copilot explicitly returning `false`.
- Tool schemas are constructed before invocation, so capability selection must be carried into handler state; checking only `turn.provider` during message dispatch would leave the schema potentially inconsistent.
- Preserve the existing targetless wait implementation exactly. Historical completion scanning there would cause false wakes from stale open agents.
- Targeted wait must subscribe to the target status watch before inspecting its current value. Tokio `watch` then covers completion before the call, during setup, and afterward without a check/subscribe gap.
- User steering must remain a competing wake condition for non-final targeted waits.
- The workspace version is currently `0.141.0-copilot-api.3`; `.4` requires updating `Cargo.toml` and `Cargo.lock`.
- No dependency addition should be necessary.

### Implementation Suggestions

1. Extend `ProviderCapabilities` with a clearly named field such as `encrypted_inter_agent_messages`, defaulting to `true`; override it to `false` in `CopilotModelProvider`.
2. Introduce a small internal V2 message-encoding enum or named option rather than passing opaque booleans. Store it in the spawn, send, and follow-up handlers.
3. Make schema helpers conditionally call `.with_encrypted()`. Do not place plaintext beneath `encrypted_content`.
4. Change only `communication_from_tool_message()` to choose `InterAgentCommunication::new()` or `new_encrypted()`, keeping spawn/send/follow-up unified.
5. Add `task_name: Option<String>` to V2 wait:
   - Omitted: run the existing mailbox-based path.
   - Present: resolve target, subscribe to status, inspect current status, then `tokio::select!` status changes against steering activity under the existing deadline.
6. Keep `WaitAgentResult`’s summary shape unless tests demonstrate consumers require status content; the completion notification remains the source of child output.
7. Add focused tests for both capability values, all three schemas, all three message paths, exact-wait races, targetless regression, V1 regression, and Copilot routing/canary completion.
8. Validate with focused provider/core tests, the existing encrypted wire test, then frozen-profile `cargo check --workspace`. Publish only after those pass, and retain the Ralph parent/child rollout JSONL plus four expected role artifacts as dogfood evidence.

## Copilot Research

I’m loading the task prompt and repository state first.

I’ve confirmed this is a research-only plan analysis. I’m tracing the native provider, schema, V2 handler, wait, tests, and release seams without modifying files.

The core seams match the feature framing: V2 schemas are provider-blind, all V2 text funnels through one encrypted constructor, and `wait_agent` currently listens only to aggregate input-queue activity. I’m now checking the provider defaulting, task/status registry, and existing test harnesses that constrain the plan.

The natural implementation path is now clear: provider capability must be captured when the tool plan is built, then reused by both schema constructors and runtime message construction; exact waits can reuse the existing V1 status-watch pattern plus the V2 steering receiver. I’m checking those prior-art implementations and race-test hooks before writing the final analysis.

A key prerequisite mismatch surfaced: this worktree pins Ralph 5.62 and lacks the four named 5.64 rollout roles, while acceptance explicitly targets the installed 5.64 plugin. I’m verifying the installed artifact path so the plan can separate Codex source changes from the post-release dogfood correctly.

Research complete; no files were changed.

## Codebase Architecture

- The releasable fork is `codex/`, which wraps the patched upstream repository at `codex/external/repos/codex-patched/`. Rust changes land and are tagged in the inner repository first; the outer wrapper then records the gitlink and publishes the binary bundle.
- Provider capabilities live in `codex-rs/model-provider-info/src/lib.rs`. Tool registration is assembled per turn in `core/src/tools/spec_plan.rs`, where the active provider is available.
- V2 tool schemas are defined in `core/src/tools/handlers/multi_agents_spec.rs`. Runtime handling is split across `multi_agents_v2/spawn.rs`, `message_tool.rs`, and `wait.rs`, with shared communication construction in `multi_agents_v2.rs`.
- Wire representation belongs to `protocol/src/protocol.rs`: `InterAgentCommunication::new()` produces plaintext `content`, while `new_encrypted()` produces only `encrypted_content`.
- Agent identity and status are already centralized in `core/src/agent/control.rs`; targets resolve by UUID, relative task name, or canonical path, and status subscriptions use current-value `watch` receivers.

## Feature-Relevant Code

- `ModelProviderInfo` is the correct owner for a general encrypted-V2-message capability. Copilot is already identifiable by its reserved provider ID.
- Current V2 schemas mark `message` encrypted for all providers in:
  - `spawn_agent`
  - `send_message`
  - `followup_task`
- `spec_plan.rs` should derive the provider capability once and pass it into the V2 handlers. This keeps schema generation and runtime encoding consistent.
- `multi_agents_v2.rs::communication_from_tool_message()` is the narrow runtime seam: select `InterAgentCommunication::new()` for unsupported providers and retain `new_encrypted()` elsewhere.
- Spawn model and effort routing in `multi_agents_v2/spawn.rs` is independent and should remain untouched.
- V2 `wait_agent` is currently targetless and wakes from aggregate `InputQueueActivity`. Add optional `task_name` to its schema and arguments, then use existing target resolution and `AgentControl::subscribe_status()`.
- For targeted waits:
  1. Resolve the exact target.
  2. Subscribe to its status receiver.
  3. Inspect the receiver’s current value.
  4. Return immediately if final.
  5. Otherwise select between status changes, user steering, and timeout.
- `InputQueueActivity` combines `Mailbox` and `Steer` in one latest-value watch channel. Targeted waiting must ignore mailbox-only activity without losing steering. A small helper in `core/src/session/input_queue.rs` that checks pending user input after any activity is safer than trusting the coalesced enum value.
- Existing tests provide the required seams:
  - Provider/default/serde: `model-provider-info/tests/model_provider_info_tests.rs`
  - Schemas: `multi_agents_spec_tests.rs`
  - Handler/wait behavior: `multi_agents_tests.rs`
  - Wire integration: `core/tests/suite/subagent_notifications.rs`

## Technical Constraints

- A normal `bool` capability is unsafe because `ModelProviderInfo` derives `Default`; false would silently make old/custom providers plaintext. Prefer `Option<bool>` interpreted as `true` when absent, with Copilot explicitly set to `Some(false)`.
- Adding a provider field requires updating direct struct literals and regenerating `core/config.schema.json`.
- Schema and runtime policy must use the same value. Omitting the schema annotation while still calling `new_encrypted()`, or vice versa, creates mislabeled data.
- All three V2 communication tools must change together. Spawn-only handling leaves follow-up and parent-to-child messages broken.
- Omitted-target `wait_agent`, V1 behavior, and non-Copilot encrypted behavior must remain unchanged.
- `Completed(None)` remains a legitimate generic final state; acceptance should reject it only for the non-empty dogfood canary.
- Every edit to upstream-canonical files requires `// SANDBOX PATCH:` registration plus invariant and replant documentation in `codex/docs/implementation/patch-surface.md` sections 14 and 15.
- The checked-in toolkit reports Ralph 5.62 and lacks the named 5.64 rollout roles. Acceptance must use the installed Ralph 5.64 cache, not the in-tree plugin. Direct inspection of that installed cache was restricted in this environment; committed brainstorm evidence identifies its `plan-with-ralph` task-targeting recipe.
- `publish-sandbox-patch.md` forbids agents from globally replacing the operator’s installation. The release plan therefore needs an explicit operator-owned `.4` install gate before dogfood.

## Implementation Suggestions

1. Add a compatibility-safe provider capability such as `supports_encrypted_multi_agent_messages: Option<bool>` and an accessor defaulting to true. Set Copilot false; retain encrypted defaults elsewhere. Regenerate the config schema and add old-config/custom-provider serde tests.
2. Derive `encrypt_messages` once in `spec_plan.rs`. Pass it into V2 spawn, send, and follow-up handlers so their schemas conditionally call `.with_encrypted()` and runtime construction selects the matching communication constructor.
3. Extend only V2 `wait_agent` with optional `task_name`. Populate targeted waiting telemetry with the resolved receiver and terminal status, while preserving the existing result shape unless Ralph demonstrably requires more.
4. Add deterministic tests for:
   - Copilot plaintext and non-Copilot encrypted schemas/wire items.
   - Plaintext never appearing under `encrypted_content`.
   - Already-final targets.
   - Completion after subscription but before initial inspection.
   - Later completion, timeout, steering, unrelated mailbox activity, and omitted-target legacy behavior.
   - Exact `gpt-5.6-sol`/`xhigh` spawn routing.
5. Run focused crate tests and `cargo check --workspace` under the frozen iteration profile. Update patch-surface documentation.
6. Bump the inner workspace and lockfile to `0.141.0-copilot-api.4`, publish through `codex/.claude/commands/publish-sandbox-patch.md`, install the published bundle, then run the exact installed Ralph 5.64 dogfood.
7. Keep Ralph 5.64 blocked until raw parent and four child rollouts prove `plan_researcher`, `plan_drafter`, `plan_initial_review`, and `plan_review_synthesis` received readable tasks, used Copilot with `gpt-5.6-sol`/`xhigh`, returned meaningful output, produced their expected artifacts, and avoided `600000` ms waits.

## Consolidated File List

### Patched-source files expected to change
- `codex/external/repos/codex-patched/codex-rs/model-provider/src/provider.rs`
- `codex/external/repos/codex-patched/codex-rs/model-provider/src/copilot.rs`
- `codex/external/repos/codex-patched/codex-rs/model-provider/src/amazon_bedrock/mod.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/followup_task.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec_tests.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan_tests.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_tests.rs`
- `codex/external/repos/codex-patched/codex-rs/core/tests/suite/subagent_notifications.rs`
- `codex/external/repos/codex-patched/codex-rs/Cargo.toml`
- `codex/external/repos/codex-patched/codex-rs/Cargo.lock`

### Wrapper/docs/invariant and dogfood files expected to change or be created
- `codex/codex-rs-overlay/codex-invariant-tests/tests/multi_agent_v2_handoff.rs` (new)
- `codex/docs/implementation/patch-surface.md`
- `codex/docs/implementation/regression-history.md`
- `codex/CLAUDE.md`
- `codex/external/repos/codex-patched` (gitlink)
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/run-installed-skill-dogfood.ps1` or a task-local strict companion validator
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/**` (new retained acceptance evidence)
- `codex` (codexu gitlink after release closeout)

### Reference-only seams and workflows
- `.ralph/brainstorms/codex-v2-copilot-encrypted-subagent-handoff/{selected-direction.md,brainstorm.json,brainstorm-synthesis.md}`
- `codex/external/repos/codex-patched/codex-rs/model-provider-info/src/lib.rs`
- `codex/external/repos/codex-patched/codex-rs/protocol/src/protocol.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/agent/{control.rs,agent_resolver.rs,status.rs}`
- `codex/external/repos/codex-patched/codex-rs/core/src/session/input_queue.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/wait.rs`
- `codex/.claude/commands/publish-sandbox-patch.md`
- `codex/.claude/commands/verify.md`
- `codex/scripts/iteration-env.sh`
- `codex/docs/implementation/build-perf.md`
