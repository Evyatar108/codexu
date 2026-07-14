# Implementation Plan: PRD A — Codex-Patched Provider-Aware Handoff and Exact Wait
<!-- ralph-meta {"overviewTaskId":"codex-v2-copilot-encrypted-subagent-handoff","uiUxJudgment":"not-required"} -->

*Repository-scoped implementation seed derived from the reviewed parent plan. Consume this file directly with `/implement-with-ralph --from-plan`; do not run the combined parent plan.*

## Overview

Implement only the nested `codex-patched` source changes for parent stories US-001–US-003: a general default-capable provider capability for encrypted inter-agent messages, truthful provider-aware V2 schemas/runtime communication for `spawn_agent`, `send_message`, and `followup_task`, and an optional exact race-safe V2 `wait_agent.task_name` branch. Copilot explicitly selects plaintext `agent_message/input_text`; encryption-capable providers retain `encrypted_content`. Omitted-target V2 and all V1 behavior stay unchanged.

This execution unit ends with reviewed local nested-source commits and an immutable receipt payload. It does not edit the Codex wrapper, publish, push, tag, release, install, mutate codexu, or run installed Ralph dogfood.

## Execution Contract

- **Exact target repository:** `D:\harness-efforts\codexu\codex\external\repos\codex-patched`
- **UI/UX judgment:** `not-required`
- **Base branch:** current fetched `sandbox-patches`
- **Source branch:** `ralph/codex-v2-copilot-encrypted-subagent-handoff-source`
- **Required wrapper context worktree:** `D:\harness-efforts\codexu\codex\.worktrees\codex-v2-copilot-encrypted-subagent-handoff`
- **Effective nested checkout:** `D:\harness-efforts\codexu\codex\.worktrees\codex-v2-copilot-encrypted-subagent-handoff\external\repos\codex-patched`
- **Read-only additional context:** the surrounding Codex wrapper worktree and its `codex-rs-overlay\codex-invariant-tests` crate.
- **Writable repository:** the effective nested checkout only.

The lead must create the wrapper context worktree from fetched wrapper `origin/main`, recursively initialize its nested checkout, and create the source branch from current `sandbox-patches`. Do **not** create a standalone inner `codex-patched\.worktrees\...` build checkout: the Rust workspace depends on the surrounding wrapper overlay through its normal relative path.

Before editing, record wrapper HEAD, nested base SHA, remotes, branch, and clean status; run `cargo metadata --no-deps --format-version 1` from `codex-rs`; and re-probe every named source seam. Any incompatible source drift is a hard stop requiring plan refresh.

## Immutable Inputs and Output Receipt

PRD A has no predecessor receipt. Its immutable inputs are the fetched `sandbox-patches` base SHA and the wrapper-context SHA recorded at start.

On completion, return a receipt payload for the lead to verify and persist at:

`D:\harness-efforts\codexu\.ralph\jobs\codex-v2-copilot-encrypted-subagent-handoff\receipts\prd-a-nested-source.json`

The PRD must not write into codexu itself. The payload must contain:

- `schemaVersion`, `executionUnit: "PRD-A"`, `targetRepository`, `wrapperContextSha`, `baseBranch`, and `baseSha`;
- ordered `commitShas` and `finalCommitSha`;
- the exact changed-file list and confirmation every path is in this plan's write scope;
- marker inventory, pre/post `multi_agents_spec.rs` line counts, and the final line count;
- every validation command, exit code, and project-relative retained log hash;
- `review.code == "clean"` and `review.docs == "clean"`;
- nested clean-tree proof, `pushed: false`, and `completedAt`.

The lead independently verifies the SHAs, diff, tests, review state, and clean tree before hashing and persisting the receipt. PRD B must not begin before that immutable receipt exists.

## Scoped Stories

### A-001 — General provider capability

Maps only to parent US-001.

- Add an encrypted-inter-agent-message capability to `ProviderCapabilities`.
- Default it to supported/encrypted.
- Override it to unsupported only for Copilot.
- Preserve Bedrock/default/configured-provider support.
- Do not widen serialized provider info, config, app-server, or protocol schemas.

### A-002 — Truthful V2 schemas and runtime encoding

Maps only to parent US-002 and depends on A-001.

- Resolve one internal `V2MessageEncoding` from the active provider capability in production tool planning.
- Feed that same value to each tool's schema and handler.
- Unsupported mode omits the encrypted schema member and constructs nonempty plaintext `InterAgentCommunication::new`.
- Capable mode preserves encrypted schemas and `new_encrypted`.
- Keep send queueing, follow-up trigger turns, model/effort, collaboration mode, and fork behavior unchanged.
- Extract V2-only schema construction/tests so `multi_agents_spec.rs` finishes at or below 800 lines.

### A-003 — Exact race-safe V2 task wait

Maps only to parent US-003 and depends on A-002.

- Add optional `task_name` beside `timeout_ms`.
- Preserve the existing targetless V2 branch byte-for-behavior and all V1 behavior.
- Resolve the exact target, emit paired target-only telemetry, subscribe before reading current state, and use the same receiver for current/future status.
- Preserve steering and timeout while unrelated mailbox/completion activity cannot satisfy the exact wait.
- Classify initial subscription failure and receiver closure with exactly one bounded fallback lookup; `NotFound` is target-unavailable, never success.
- Treat `Completed(None)` as final wait state without treating it as meaningful role completion.

## Approach

1. Add the default-true provider capability and focused provider tests.
2. Add a self-documenting encoding enum, resolve it once in `spec_plan.rs`, and pass it through all three V2 message tools.
3. Move V2 message/exact-wait schema construction into private `multi_agents_v2_spec.rs` and its colocated tests.
4. Update runtime constructors for spawn, send, and follow-up atomically.
5. Add the exact targeted wait helper and deterministic subscription/closure boundary.
6. Apply exactly one applicable `// SANDBOX PATCH:` family to every changed upstream-canonical logical block:
   - `provider-aware-v2-handoff` for capability/schema/encoding work;
   - `exact-v2-wait` for exact-target schema/wait work.
7. Commit provider-aware handoff first, then exact wait, keeping both commits local.

## Writable Files

All paths are relative to the exact target repository.

### Modify

- `codex-rs/model-provider/src/provider.rs`
- `codex-rs/model-provider/src/copilot.rs`
- `codex-rs/model-provider/src/amazon_bedrock/mod.rs`
- `codex-rs/core/src/tools/spec_plan.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/followup_task.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_spec_tests.rs`
- `codex-rs/core/src/tools/spec_plan_tests.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_tests.rs`

### Create

- `codex-rs/core/src/tools/handlers/multi_agents_v2_spec.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2_spec_tests.rs`

### Read-only references

- `codex-rs/model-provider-info/src/lib.rs`
- `codex-rs/tools/src/json_schema.rs`
- `codex-rs/protocol/src/protocol.rs`
- `codex-rs/core/src/agent/agent_resolver.rs`
- `codex-rs/core/src/agent/control.rs`
- `codex-rs/core/src/agent/status.rs`
- `codex-rs/core/src/session/input_queue.rs`
- `codex-rs/core/src/tools/handlers/multi_agents/wait.rs`
- `codex-rs/core/tests/suite/subagent_notifications.rs`
- `codex-rs/core/tests/suite/client.rs`
- `codex-rs/core/src/client.rs`
- `codex-rs/codex-api/**`
- `codex-rs/app-server-protocol/src/protocol/v2/model.rs`
- `codex-rs/app-server/src/request_processors/config_processor.rs`

`codex-rs/Cargo.toml` and `codex-rs/Cargo.lock` are lead-owned release metadata and are outside this PRD.

## Tests and Verification

Run from the effective nested checkout using the frozen profile established by the surrounding wrapper's `scripts/iteration-env.sh`. Use `just test`, never direct `cargo test`.

1. `cargo metadata --no-deps --format-version 1`
2. Scoped `just fix -p codex-model-provider`
3. Scoped `just fix -p codex-core`
4. `just fmt`
5. `just test -p codex-model-provider`
6. Focused `just test -p codex-core` filters covering provider planning, all three capable/unsupported schemas, all three runtime encodings, the exact-wait matrix, targetless V2, and V1 regression paths
7. Focused `subagent_notifications` capable-provider encrypted-wire coverage
8. Frozen-profile `cargo check --workspace`
9. After focused gates pass and operator approval is recorded, the complete `just test`

Capture expensive output once under a project-relative task evidence directory. Never use `/tmp`, vary frozen profile flags, or kill processes by name. On Windows, keep LLVM ahead of Git Bash tools, use the normal nested checkout path, and stop only specific locking PIDs.

## Acceptance Criteria

1. The general capability defaults true; Copilot alone explicitly reports false; Bedrock/default/configured providers remain true.
2. No serialized provider/config/app-server/protocol surface is widened.
3. One encoding value drives schema and runtime behavior for spawn, send, and follow-up.
4. Unsupported mode emits readable nonempty `input_text`, has no `encrypted_content`, and never stores plaintext under that field.
5. Capable mode retains encrypted schemas and `encrypted_content`.
6. Model, effort, fork, queue, trigger-turn, V1, and omitted-target V2 behavior remains unchanged.
7. Optional exact `task_name` uses subscribe-before-current-read on one receiver and cannot be satisfied by unrelated completion.
8. Steering, timeout, resolution errors, initial subscription failures, receiver closure, and `Completed(None)` follow the reviewed classifications.
9. The deterministic race/closure/telemetry matrix passes, including nonexistent UUID and resolve-then-remove.
10. Every changed production/test block has exactly one applicable marker family and `multi_agents_spec.rs` is at most 800 lines.
11. All listed focused, workspace, and approved full-suite gates pass.
12. Only listed writable files changed; no version/lock, wrapper, parent, generated evidence, or installed-plugin file changed.
13. Local commits exist on the source branch, the nested tree is clean, and nothing was pushed.

## Phase 5a / Phase 5b Convergence

- **Phase 5a:** run code review-fix rounds until the provider capability, all three schema/runtime pairs, exact wait races, telemetry, marker assignment, and regression coverage are clean. Re-run affected focused tests after every fix and the complete scoped gate after convergence.
- **Phase 5b:** run docs review-fix convergence even though no prose docs are expected. It must confirm marker comments and user/model-facing schema/error text are accurate and that no wrapper documentation was edited. Both review states must be `clean`.

Do not stop at story-pass. Return only after both convergence states and the receipt payload are complete.

## Rollback and Security

Before publication, rollback is a local revert of either nested source commit. Plaintext fallback is a deliberate confidentiality change only for a provider that reports encryption unsupported: delegated task text may exist in provider requests and local rollout/history as practical V1 does. Keep encrypted-by-default policy, no user downgrade toggle, no body logging, and use only nonsecret canaries/tests.

## Open Questions

None. Source drift or missing verified seams is a hard stop, not an invitation to redesign transport or widen protocol.

## Next Step

Run only after the wrapper context worktree and nested source branch satisfy this plan:

`$ralph-orchestration:implement-with-ralph --from-plan .ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/scoped-plans/codex-patched-plan.md --target-repo D:\harness-efforts\codexu\codex\external\repos\codex-patched`

Do not push. After the lead validates and persists PRD A's immutable receipt, continue with `codex-wrapper-plan.md`.
