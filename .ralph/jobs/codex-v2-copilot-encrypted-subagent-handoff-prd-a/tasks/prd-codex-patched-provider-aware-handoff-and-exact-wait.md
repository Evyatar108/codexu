# PRD: Codex-Patched Provider-Aware Handoff and Exact Wait

## Introduction

Implement the nested `codex-patched` source portion of the reviewed handoff plan. The work adds a default-capable encrypted inter-agent-message provider capability, makes V2 spawn/send/follow-up schemas and constructors truthful for the active provider, and adds an optional exact race-safe V2 task wait. Copilot selects plaintext `input_text`; capable providers retain `encrypted_content`. The wrapper context is fixed at `89a6cbea7cd382fa4873b259fb996dcf988a5fdc`, and the nested source base is fixed at `587a6a8ab8948ff912b1f24a62833b277934302d`.

## Goals

- Represent encrypted inter-agent messaging as a default-supported provider capability with a Copilot-only unsupported override.
- Drive V2 schemas and runtime construction for spawn, send, and follow-up from one provider-derived encoding.
- Add an exact `task_name` wait branch that subscribes before current-state inspection and cannot complete from unrelated activity.
- Preserve capable-provider encryption, V1 behavior, targetless V2 behavior, and existing model/effort/fork/queue semantics.
- Keep every source edit within the scoped 16-path writable set and both implementation commits local.

## User Stories

### US-001: A-001 — General provider capability
**Source story:** A-001

**Description:** As a Codex provider maintainer, I want encrypted inter-agent messaging represented as a default-capable provider capability so that Copilot can explicitly select plaintext without weakening capable providers.

**UI/UX judgment:** not-required

**Acceptance Criteria:**
- [ ] `ProviderCapabilities` exposes an encrypted-inter-agent-message capability whose default-capable path resolves to supported/encrypted.
- [ ] Copilot explicitly reports the capability as unsupported while Bedrock, default, and configured-provider paths remain supported, with focused provider tests covering each path.
- [ ] The implementation does not add fields to serialized provider info, configuration, app-server, or protocol schemas.
- [ ] Every changed upstream-canonical capability block has exactly one `// SANDBOX PATCH: provider-aware-v2-handoff` marker family annotation.
- [ ] Tests pass: `just test -p codex-model-provider` exits 0 from the effective nested checkout.
- [ ] Typecheck passes.

### US-002: A-002 — Truthful V2 schemas and runtime encoding
**Source story:** A-002

**Description:** As a Codex multi-agent maintainer, I want one provider-derived V2 message encoding to drive schemas and runtime constructors for spawn, send, and follow-up so that each provider receives truthful message fields.

**UI/UX judgment:** not-required

**Acceptance Criteria:**
- [ ] Production tool planning resolves exactly one internal `V2MessageEncoding` from the active provider capability and passes that value to both schema and handler construction for `spawn_agent`, `send_message`, and `followup_task`.
- [ ] Unsupported encoding omits `encrypted_content` from all three V2 schemas, requires readable nonempty `input_text`, and constructs plaintext with `InterAgentCommunication::new` without storing plaintext under `encrypted_content`.
- [ ] Capable encoding preserves all three encrypted schemas and runtime construction through `InterAgentCommunication::new_encrypted`.
- [ ] Model, effort, collaboration mode, fork behavior, send queueing, and follow-up trigger turns remain unchanged, and regression tests preserve V1 plus omitted-target V2 behavior.
- [ ] V2-only schema construction and colocated tests live in `multi_agents_v2_spec.rs` and `multi_agents_v2_spec_tests.rs`, and `multi_agents_spec.rs` is at most 800 lines.
- [ ] Every changed upstream-canonical schema or encoding block has exactly one `// SANDBOX PATCH: provider-aware-v2-handoff` marker family annotation.
- [ ] Focused `just test -p codex-core` filters cover capable and unsupported schemas plus runtime encoding for spawn, send, and follow-up, and all selected tests exit 0.
- [ ] Tests pass.
- [ ] Typecheck passes.

### US-003: A-003 — Exact race-safe V2 task wait
**Source story:** A-003

**Description:** As a Codex multi-agent caller, I want an optional exact V2 `wait_agent.task_name` branch so that I can wait for one task without unrelated mailbox or completion activity satisfying the wait.

**UI/UX judgment:** not-required

**Acceptance Criteria:**
- [ ] The V2 wait schema accepts optional `task_name` beside `timeout_ms`, while schema and regression tests preserve the existing targetless V2 branch and all V1 behavior.
- [ ] The exact branch resolves one target, emits paired target-only telemetry, subscribes before reading current state, and uses that same receiver for current and future status.
- [ ] Unrelated mailbox or completion activity cannot satisfy the exact wait, while steering and timeout behavior remain available for the resolved target.
- [ ] Initial subscription failure and receiver closure each perform exactly one bounded fallback lookup; `NotFound` is classified as target-unavailable and never as success.
- [ ] `Completed(None)` is a final wait state but is not reported as meaningful role completion, with deterministic coverage for nonexistent UUID and resolve-then-remove cases.
- [ ] The exact-wait test matrix covers current-state and race boundaries, timeout, steering, telemetry pairing, unrelated activity, subscription failure, receiver closure, nonexistent UUID, resolve-then-remove, and `Completed(None)`.
- [ ] Every changed upstream-canonical exact-wait block has exactly one `// SANDBOX PATCH: exact-v2-wait` marker family annotation.
- [ ] Focused `just test -p codex-core` exact-wait, targetless V2, V1 regression, and `subagent_notifications` filters exit 0.
- [ ] Tests pass.
- [ ] Typecheck passes.

## Functional Requirements

1. FR-1: The provider capability defaults to encrypted inter-agent-message support.
2. FR-2: Copilot alone overrides that capability to unsupported.
3. FR-3: Production tool planning resolves one V2 message encoding and threads it through schema and handler construction.
4. FR-4: Plaintext mode exposes and consumes only nonempty `input_text`; encrypted mode preserves `encrypted_content`.
5. FR-5: V2-only schema helpers and tests are extracted so `multi_agents_spec.rs` is no more than 800 lines.
6. FR-6: Exact wait resolves one task and subscribes before current-state inspection.
7. FR-7: Exact wait uses one receiver for current and future state, with one bounded fallback lookup on subscription failure or receiver closure.
8. FR-8: Marker families identify every changed upstream-canonical block exactly once.

## Non-Goals

- No wrapper overlay, wrapper documentation, codexu, release metadata, `Cargo.toml`, or `Cargo.lock` edits.
- No protocol, app-server, serialized provider-info, or user-config surface expansion.
- No user-selectable plaintext downgrade.
- No worktree creation, push, tag, release, installation, or Ralph execution during PRD materialization.
- No redesign of V1 or targetless V2 wait behavior.

## Technical Considerations

- The externally managed target checkout and source branch already exist at the immutable nested base.
- The surrounding wrapper overlay invariant crate and wrapper docs are read-only context.
- Use the wrapper's frozen iteration environment and `just test`, never direct `cargo test`.
- Capture expensive output only in project-relative evidence directories.
- Keep LLVM ahead of Git Bash tools on Windows and stop only specific locking process IDs.

## Success Metrics

- All three serial stories complete in one Ralph iteration each.
- Every changed file is one of the 16 top-level `writeScope` paths.
- Model-routing, criteria, scope, focused test, workspace check, and approved full-suite gates exit 0.
- Phase 5a and Phase 5b both converge cleanly.
- The nested branch remains local and the tree is clean after commits.

## Open Questions

None. Source drift or missing verified seams is a hard stop.
