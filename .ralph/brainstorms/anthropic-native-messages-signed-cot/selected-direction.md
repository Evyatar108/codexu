---
overviewTaskId: codex-anthropic-native-messages-transport-for-signed-cot
---

## Direction
D-001 — Probe-gated signed fast-follow (after unsigned ships). Do not build the native signed `/v1/messages` transport now and do not blind-defer it; gate it on a cheap live probe of Copilot's `/v1/messages`, and only build it — as a fast-follow after the unsigned `reasoning_text` capture lands, on a shared neutral reasoning-item scaffold — if the probe proves Copilot accepts auth, emits signed `thinking`, AND accepts signed thinking on replay.

## Goal
A clear, evidence-based GO / NO-GO decision (and, on GO, a sequenced implementation sketch) for a native Anthropic `/v1/messages` transport that gives Claude-via-Copilot faithful **signed** chain-of-thought continuity. Concretely, after this is done correctly there will exist:
1. A committed probe artifact: the existing faithful probe (`D:\ExtRepos\copilot-thinking-probe\probe.mjs`, which already mirrors the fork's exact Copilot auth/headers) extended to POST a minimal Anthropic **Messages** request to `api.githubcopilot.com/v1/messages`, with **raw captured SSE** showing whether `thinking` + `signature` are emitted, plus a **two-turn** capture showing whether a replayed signed `thinking` block placed before a `tool_result` is accepted/validated through the Copilot proxy.
2. A recorded verdict (GO/NO-GO) against three explicit gates: (a) Copilot bearer auth accepted on `/v1/messages`; (b) signed `thinking`+`signature` emitted; (c) signed thinking accepted on replay before `tool_result`.
3. On GO only: an overlay-first implementation sketch (request builder + Messages-SSE parser + third `WireApi`/`ModelWireRoute` arm + `wire_route_for`/`effective_wire_api`/`client.rs` dispatch) sequenced as a fast-follow **after** the unsigned sibling ships, reusing a neutral persisted-reasoning item shape.

## Scope
### In Scope
- Extend the probe to `/v1/messages` (Anthropic Messages request shape; reuse fork Copilot auth/headers/token cache). This is the gating deliverable — S effort, no codex-rs build.
- A two-turn probe: turn 1 captures signed thinking; turn 2 replays the signed thinking block before a `tool_result` and records whether it is accepted/validated (the decisive gate (c)).
- Record the GO/NO-GO verdict and, on GO, the overlay-first transport sketch + sequencing relative to the unsigned sibling (`codex-anthropic-chat-reasoning-text-capture-and-replay`).
- Coordinate a request to the unsigned sibling to reserve a **neutral persisted-reasoning item shape** that can later carry `signature` metadata, so the signed build extends it rather than re-editing `core/src/chat_transport/anthropic_sse.rs` + overlay `payload.rs::push_chat_message`.

### Out of Scope
- Building the third-transport (request builder, Messages-SSE parser, third `WireApi` arm, routing) BEFORE the probe returns GO. No codex-rs transport edits land on a NO-GO or un-probed endpoint.
- Re-scoping the unsigned sibling task (it is being planned in parallel; this direction only adds a coordination ask).
- Running the signed transport build in parallel with the unsigned sibling (both touch the same two files — must be sequenced after unsigned to avoid the merge/parallel-edit conflict).
- Any inline upstream-canonical edit not strictly required by the eventual dispatch seam (tenet #1: overlay-first; the only unavoidable upstream edits are the third `WireApi`/`ModelWireRoute` arm + `wire_route_for` + `effective_wire_api` + the `client.rs` dispatch arm).

## Criteria
- A committed, runnable probe extension that POSTs an Anthropic Messages request to `api.githubcopilot.com/v1/messages` using the fork's exact Copilot auth/headers, with raw SSE captured to disk.
- The captured evidence explicitly answers all three gates (auth accepted / `thinking`+`signature` emitted / signed thinking accepted on replay before `tool_result`), each with a raw-capture citation.
- A written GO/NO-GO verdict keyed to that evidence; on NO-GO, the recommendation falls back to "defer/abandon signed; rely on unsigned" (D-003).
- On GO: an overlay-first transport sketch naming the exact seams (third `WireApi`/`ModelWireRoute` arm, `wire_route_for` recognizing `/v1/messages`, `effective_wire_api`, `client.rs` dispatch, reuse-and-stop-discarding-signature in `anthropic_sse.rs:174-176`), an edit-budget estimate + re-conflict probability per upstream-canonical seam, and an explicit "sequence after unsigned ships" note.
- No codex-rs transport code is modified by this task's first deliverable (the probe is the gate).

## Context
Synthesis highlights (all three lenses — codex, copilot, devils-advocate — converged):
- This is an **evidence problem, not a transport-choice problem.** `/v1/messages` has NEVER been probed against Copilot; in the codex tree it appears only as test-fixture strings in `supported_endpoints` (`model-provider/src/copilot_models_endpoint.rs:547/613/665/711`). `wire_route_for` (lines 282-296) ignores it; there is no endpoint constant, no routing, no live capture.
- The fork already ships a Claude-via-Copilot `/chat/completions` transport (SANDBOX PATCH D-001): two-variant `WireApi` + `ModelWireRoute`, `effective_wire_api` as the single route→wire mapping, dispatch at `core/src/client.rs:1675`.
- DISCONFIRMING OBSERVATION (verified 2026-06-21 by a faithful live probe): Copilot's `/chat/completions` streams Claude CoT as a NON-STANDARD OpenAI-shape `choices[].delta.reasoning_text` (gated by `reasoning_effort`; 46 chunks at "high", 0 with none), NOT the Anthropic thinking/`content_block_delta` shape. Consequently the existing `anthropic_sse.rs` `thinking_delta`/`signature_delta` handling is **dead code** over `/chat/completions`. `reasoning_text` carries NO signature, so it cannot faithfully round-trip — that is exactly the gap the signed path would fill IF `/v1/messages` actually delivers and accepts signatures.
- The signed path collapses to no-better-than-unsigned if Copilot (as a proxy) strips, re-signs, or rejects Anthropic signatures on replay — hence gate (c) is the decisive one and the probe is the cheapest way to settle it.
- CONFLICT SURFACE: both the signed path and the in-flight unsigned sibling touch `core/src/chat_transport/anthropic_sse.rs` and overlay `payload.rs::push_chat_message`. Running them in parallel guarantees a merge conflict; the signed build must be sequenced AFTER unsigned and ideally reuse a shared neutral reasoning-item scaffold.
- This is a codex-submodule effort (overlay + core + model-provider) → impl would be a two-commit flow (submodule commit, then codexu pointer bump). The transport build was sized XL by both codex and copilot lenses; the probe gate is S.

Open questions to carry into planning:
- Minimum probe result to justify the build: require BOTH signed emission and signed replay acceptance (not endpoint availability alone).
- Does Copilot preserve, rewrite, or reject Anthropic signatures when proxying `/v1/messages`?
- Should signed Messages get a stricter sub-flag vs. reusing `CODEX_ENABLE_ANTHROPIC` until validated?
- Can the unsigned sibling reserve a neutral persisted-reasoning item shape that later carries `signature` metadata?
