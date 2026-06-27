# Stories Outline: Native Anthropic Messages (`/v1/messages`) transport for signed chain-of-thought

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation — BUT note this is a codex-submodule nested 2-repo change; see the plan's Next Step (direct two-commit impl, not a single `/implement-with-ralph`). US-001 is a hard GATE.*

## US-001: Confirmation re-probe of Copilot `/v1/messages` (GATE)
**Description:** As the fork maintainer, I want a live re-probe of Copilot's `/v1/messages` so that no signed-transport Rust lands unless the proxy provably accepts auth, emits signed `thinking`+`signature`, and accepts a replayed signed `thinking` block before a `tool_result`.
**Acceptance Criteria:**
- [ ] AC1: Extend `D:/ExtRepos/copilot-thinking-probe/probe.mjs` to POST an Anthropic Messages request to `api.githubcopilot.com/v1/messages` with the fork's exact Copilot auth/headers; 2-turn flow (turn 1 captures signed `thinking`+`signature`; turn 2 replays the signed block before a `tool_result`); raw captures to a gitignored path; secrets never committed.
- [ ] AC2: Commit `.ralph/jobs/codex-anthropic-native-messages-transport-for-signed-cot/probe-decision.md` with a GO/NO-GO verdict keyed to the 3 gates (each with a sanitized citation) + observed billing/quota. On NO-GO recommend D-003; no codex-rs code modified.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Routing skeleton + signed sub-flag (inert)
**Description:** As the fork, I want a third `AnthropicMessages` wire route + a stricter signed sub-flag wired through every gate/cache/filter seam, landing inert (degrades to the unsigned chat path), so the transport plumbing is safe to ship before the builder/parser exist.
**Acceptance Criteria:**
- [ ] AC3: `WireApi::AnthropicMessages` (+ Display/Deserialize/unknown-variant list) and `ModelWireRoute::AnthropicMessages` added; `cargo check --workspace --all-targets` passes (all exhaustive `match` sites incl. the `#[cfg(test)]` `proto_wire_api` in `remote.rs`).
- [ ] AC4: `wire_route_for` routes to `AnthropicMessages` only when both gates on; model-cache identity keys on `anthropic_signed_messages`; `GatedModelsManager` hides the route when off; `synthesize_from_capabilities` gives it the chat default reasoning level.
- [ ] AC5: `effective_wire_api_gated` takes the signed flag as an explicit param; in US-002 it degrades `AnthropicMessages` → `ChatCompletions` unconditionally; `Feature::AnthropicSignedMessages` (default off) + `install`/`resolved` pair + config-build install.
- [ ] AC6: `client.rs` `WireApi::AnthropicMessages` dispatch stub delegates to `stream_chat_completions` (never panics, runs unsigned even if the flag is flipped early).
- [ ] AC14 (partial): each upstream edit hunk/seam carries a `// SANDBOX PATCH:` marker + a §14 invariant row starting at **63** + §15 replant fragment.
- [ ] AC15: `cargo check --workspace` + targeted `cargo test -p` pass.
**Dependencies:** US-001 (GO)
**Estimated complexity:** medium

## US-003: Inbound signed-SSE capture + signature persistence
**Description:** As the transport, I want the Messages-SSE parser to surface `thinking`+`signature` (instead of dropping them) and persist the signature into `ResponseItem::Reasoning.encrypted_content`, so a turn's signed CoT is captured for later replay.
**Acceptance Criteria:**
- [ ] AC7: Parser unit test surfaces reasoning text + `signature` from `thinking_delta`/`signature_delta` (replacing the `_ => {}` discard); a multi-block fixture (different/out-of-order indices) asserts each `signature_delta` binds to its own `thinking` block (no cross-binding).
- [ ] AC8: Persistence test — closing reasoning item yields `Reasoning{ content: Some([ReasoningText]), encrypted_content: Some(<sig>) }`; lifecycle unchanged; multi-block items each carry the correct signature bound to the correct following `function_call`.
- [ ] AC10 (history half): `core/src/context_manager/history.rs` token accounting counts the plaintext `content` for `Reasoning{encrypted_content:Some, content:Some}`, not only the opaque field.
**Dependencies:** US-001 (GO), US-002 (shares `chat_transport.rs` + `patch-surface.md`)
**Estimated complexity:** medium

## US-004: Outbound Anthropic Messages request builder (overlay)
**Description:** As the transport, I want an overlay request builder that assembles the Anthropic `messages[]` — replaying a persisted signed `thinking` block immediately before its `tool_use`, with `tool_result` in the next user message — plus faithful system/tools translation, so signed CoT round-trips across the tool loop.
**Acceptance Criteria:**
- [ ] AC9: Builder places `{thinking,signature}` then `{tool_use}` in one assistant message and `{tool_result}` in the next user message; `encrypted_content:None` emits NO `thinking` block (omit, never unsigned); test asserts no unsigned thinking on the Messages path.
- [ ] AC9b: Fidelity — system → top-level `system`; tools/`tool_choice` → Anthropic `tools` schema; multiple parallel tool calls preserved; text-only turn → valid `messages[]` with no thinking/tool blocks; hard-errors (never silently drops) unrepresentable Responses features.
- [ ] AC10 (cap half): oversized signed reasoning item capped (text + signature bytes) so no item exceeds the 10K-token bound.
- [ ] Uses self-defined fixtures (constructs `Reasoning{encrypted_content:Some}` directly) to stay parallel-safe with US-003.
**Dependencies:** US-001 (GO). File-disjoint from US-003 (may run in parallel) or serialize after it.
**Estimated complexity:** large

## US-005: Dispatch wiring + signed round-trip
**Description:** As the transport, I want the real `WireApi::AnthropicMessages` dispatch arm + a `stream_anthropic_messages` driver wired to the overlay builder + the extended parser, with the gate flipped to honor the signed flag, proven by an end-to-end signed round-trip test.
**Acceptance Criteria:**
- [ ] AC11: Real dispatch arm builds via the overlay Messages builder, POSTs to `/v1/messages` with Copilot auth/headers, streams through the extended `AnthropicSseParser` → `ResponseEvent`s; `stream_anthropic_messages` mirrors `stream_chat_completions`; `effective_wire_api_gated` flipped to route when the flag is on.
- [ ] AC12: `core/suite` `test_codex` integration test with mock `/v1/messages` SSE proves parse → persist (`encrypted_content`) → replay → request carries the signed `thinking` before the `tool_use`, signature preserved across a tool-call turn.
**Dependencies:** US-002, US-003, US-004
**Estimated complexity:** medium

## US-006: Harden, audit, verify
**Description:** As the fork maintainer, I want the egress audit, ledger, and full gates finalized plus a live dogfood, so the signed transport ships dark-and-safe with the network invariant intact.
**Acceptance Criteria:**
- [ ] AC13: §14 grep-guard invariant asserting the only Copilot inference paths in source are `/chat/completions` and `/v1/messages`; Invariant 38's path set extended; `audit_network_calls.sh` still passes (no new host/unaudited pattern).
- [ ] AC14 (final): consolidated §15 replant note covering the enum/route/gate/dispatch seams; all §14 rows at **63+** (never reusing 54–62).
- [ ] AC15: `cargo check --workspace` + `cargo test -p {codex-core,codex-copilot,codex-model-provider,codex-model-provider-info}` + `cargo check --workspace --all-targets` green (release/full-suite deferred to CI).
- [ ] AC16: manual 2-turn dogfood on a real Claude model (signed flag on) — tool-call turn completes, signed thinking accepted on replay; flag stays landed-dark until this passes (or explicit deferral noted).
**Dependencies:** US-005
**Estimated complexity:** medium
