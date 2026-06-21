# Stories Outline: Capture, persist, display & replay Claude chain-of-thought over Copilot /chat/completions

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Probe 2-turn input-acceptance de-risk (decides replay field shape)
**Description:** As an implementer, I want to know which replay field shape Copilot `/chat/completions` accepts and honors on INPUT, so that US-003 encodes replayed reasoning in the right shape (or the safe fallback) before any overlay code is written.
**Acceptance Criteria:**
- [ ] Extend `D:/ExtRepos/copilot-thinking-probe/probe.mjs` to issue a SECOND `/chat/completions` request whose `messages` array carries the prior assistant turn's reasoning in each candidate shape: (a) a `reasoning_text` field on the assistant message, (b) reasoning folded inline into assistant `content`, (c) a standalone assistant-role message carrying the reasoning.
- [ ] For each candidate, record transport ACCEPTANCE: HTTP 200 vs a 400 field-rejection, with the exact request body used.
- [ ] Record a qualitative HONORING signal: whether turn-2 output reflects/continues the replayed reasoning, OR an explicit statement that honoring could not be demonstrated (in which case the feature is framed as best-effort plaintext context injection). Acceptance and honoring are reported SEPARATELY. (AC6)
- [ ] Write the decision (chosen shape + acceptance/honoring evidence + captured raw SSE/response) to a named artifact `<job_dir>/probe-decision.md`, consumed by US-003.
- [ ] No codex-source edits in this story.
**Dependencies:** None (runs first; may run in parallel with US-002).
**Estimated complexity:** small

## US-002: Core capture / persist / display of reasoning_text (core-only, overlay untouched)
**Description:** As a Claude-via-Copilot user, I want my model's chain-of-thought captured off the chat SSE, shown live, and persisted to history, so reasoning is no longer silently discarded.
**Acceptance Criteria:**
- [ ] Add a core-owned `TranslatedSseEvent::ReasoningDelta(String)` variant in `core/src/chat_transport/anthropic_sse.rs` (overlay `ChatStreamEvent` stays UNTOUCHED — core-only-capture constraint).
- [ ] Extend `decode_openai_structured_content` to emit `ReasoningDelta` from `choices[0].delta.reasoning_text` BEFORE the array early-return; skip empty reasoning chunks.
- [ ] Add a `ReasoningMessageItem` accumulator in `core/src/chat_transport.rs` mirroring `AssistantMessageItem`; thread it through `run_chat_stream`, `handle_translated_events`, AND `handle_event` so it opens on the first reasoning delta, streams `ReasoningContentDelta{content_index:0}`, and closes (`OutputItemDone(Reasoning{content:Some([ReasoningText]), encrypted_content:None})`) before the first `ContentDelta` AND the first `ToolCallDelta`, and at stream finish if still open.
- [ ] AC1: parser unit test feeds a real `reasoning_text` chat-SSE fixture (`delta.content:""` + `delta.reasoning_text`) asserting exactly one `ReasoningDelta` per chunk, concatenating to the expected CoT.
- [ ] AC2: test asserts the overlay `ChatSseParser` emits NOTHING for the same chunk (no double-emit).
- [ ] AC3: transport test asserts reasoning-then-content order: `OutputItemAdded(Reasoning)` → `ReasoningContentDelta`(s) → `OutputItemDone(Reasoning)` → `OutputItemAdded(Message)` → `OutputTextDelta` → `OutputItemDone(Message)`.
- [ ] AC14: transport test covers reasoning-then-tool-call (no assistant text): reasoning item is CLOSED before the `FunctionCall` item is finalized.
- [ ] AC4: with zero reasoning_text chunks (reasoning_effort=none shape), NO reasoning item events are emitted.
- [ ] AC5: closing `OutputItemDone(Reasoning)` yields a `ResponseItem::Reasoning` whose `content` holds a `ReasoningItemContent::ReasoningText` (so `should_serialize_reasoning_content` persists it).
- [ ] AC11: adds NO new gate; notes the inherent `anthropic_models_resolved()` gating + `reasoning_effort=medium` default interplay.
- [ ] AC10 (capture seam): `codex/docs/implementation/patch-surface.md` §14 invariant row + §15 replant note for the capture seam; inline `// SANDBOX PATCH: D-001 reasoning capture` markers.
- [ ] AC8: `cargo check --workspace` passes from `external/repos/codex-patched/codex-rs`.
- [ ] AC9: `just test -p codex-core` (or `cargo test -p codex-core`) passes from `external/repos/codex-patched/codex-rs`.
- [ ] Typecheck passes.
**Dependencies:** None (parallel with US-001).
**Estimated complexity:** medium

## US-003: Overlay replay of persisted reasoning (scoped D-001 exception)
**Description:** As a Claude-via-Copilot user, I want my prior reasoning replayed onto later-turn requests so the model retains its chain-of-thought across turns (best-effort, unsigned plaintext).
**Acceptance Criteria:**
- [ ] Replace `push_chat_message`'s `_ => {}` reasoning drop (`codex-rs-overlay/codex-copilot/src/payload.rs`) with a `"reasoning"` arm emitting the US-001-decided field shape; DEFAULT = standalone assistant-role message (keeps `push_chat_message` stateless). If US-001 shows attach-to-following-message is required, implement the buffering/merge at the caller loop `payload.rs:257-261`. Inline plaintext is the guaranteed fallback. `// SANDBOX PATCH: D-001 reasoning replay`.
- [ ] AC7: round-trip test feeds `ResponseItem::Reasoning{content:[ReasoningText{text}]}` through `push_chat_message`, asserting the emitted chat message carries the reasoning in the decided shape (or fallback), and non-reasoning items are unchanged.
- [ ] AC15: end-to-end test/fixture proves `OutputItemDone(Reasoning)` → history → `build_responses_request` → `build_chat_request_body` → `push_chat_message` yields a chat body carrying the reasoning.
- [ ] AC13: bounded plaintext-reasoning history — a regression test feeds an oversized reasoning item and asserts the replayed reasoning is capped/truncated (or most-recent-N policy applied) so no replayed item exceeds the fork's model-visible-context bound (no item >10K tokens). The chosen cap/policy is documented.
- [ ] AC12: feed a `Reasoning{content:[ReasoningText], encrypted_content:Some("sig")}` through `build_chat_request_body`/`push_chat_message`; assert no panic, plaintext still replays, original item NOT mutated (signature-ready forward-compat for the future signed fast-follow).
- [ ] AC10 (replay seam): `codex/docs/implementation/patch-surface.md` §14 invariant row + §15 replant note for the replay exception.
- [ ] AC9: `just test -p codex-copilot` (or `cargo test -p codex-copilot`) passes from `external/repos/codex-patched/codex-rs`.
- [ ] Typecheck passes.
**Dependencies:** US-001 (replay field shape), US-002 (captured/persisted reasoning items to replay).
**Estimated complexity:** medium
