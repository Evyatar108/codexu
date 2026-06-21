# Research Brief: Capture/persist/display/replay Claude CoT over Copilot /chat/completions

All paths are in the codex submodule PRIMARY checkout `D:/harness-efforts/codexu/codex`.
Overlay = `codex-rs-overlay/codex-copilot/`; patched core = `external/repos/codex-patched/codex-rs/`.

## Researcher Findings (Explore agent — confirmed seed, no contradictions)

### 1. Capture seam
- `core/src/chat_transport/anthropic_sse.rs:36-39` — `TranslatedSseEvent` has only `Chat(...)` + `StreamError(...)`; NO reasoning variant yet (add `ReasoningDelta(String)`).
- `anthropic_sse.rs:237-295` — `decode_openai_structured_content()` only handles array-shaped `delta.content`; early-returns unless `content` is an array, then emits ContentDelta/ToolCallDelta/Finish. The new `reasoning_text` branch goes BEFORE the array early-return.
- `anthropic_sse.rs:297-408` — test style: `#[cfg(test)] mod tests` with helpers `parse_chat(sse)` / `collected_text(...)`, inline `concat!` SSE fixtures.
- Overlay `chat_completions.rs:156-178` — `ChatDelta` deserializes only `content: Option<String>` + `tool_calls`; no `reasoning_text` → serde drops it. `decode_chunk` (120-152) only emits ContentDelta when content non-empty, so `content:""` reasoning chunk → overlay emits NOTHING.
- Overlay tests use `parse_all(sse)` helper + inline SSE fixtures (`chat_completions.rs:261-408`).

### 2. Transport mapping (`core/src/chat_transport.rs`)
- `:63-75` `effective_wire_api()` gates `ChatCompletions` behind `anthropic_models_resolved()`.
- `:87-134` `AssistantMessageItem` lifecycle: `open()` → `ResponseItem::Message` for OutputItemAdded; `finish()` → closing Message w/ accumulated text for OutputItemDone. **This is the pattern to mirror for a reasoning accumulator.**
- `:185-330` `run_chat_stream()` feeds bytes to BOTH parsers, then closes assistant message before tool finalization + Completed.
- `:338-361` `handle_translated_events()` forwards `Chat(...)` into `handle_event`, surfaces StreamError. **Clean place to feed the new ReasoningDelta lifecycle.**
- `:366-447` `handle_event()` synthesizes OutputItemAdded on first text delta → OutputTextDelta; tool deltas accumulate by index.
- `:521-595` regression test proves open-before-text + close-with-full-text — **the model for the reasoning lifecycle test.**

### 3. Consumer (`core/src/session/turn.rs`)
- `:2050-2121` `OutputItemAdded(item)` becomes active item.
- `:2275-2294` `ReasoningContentDelta` handled ONLY when active item exists; else `error_or_panic("ReasoningRawContentDelta without active item")`.
- `:2217-2219` analogous `OutputTextDelta without active item` guard.

### 4. Replay seam (`codex-rs-overlay/codex-copilot/src/payload.rs`)
- `:277-326` `push_chat_message()` maps message/function/tool; reasoning family dropped by `_ => {}` (`:322-325`).
- `:328-337` `assistant_tool_call()`; `:349-360` `chat_message_content()` helpers.

### 5. Test/build conventions
- `external/repos/codex-patched/AGENTS.md:65-71` — use `just fmt`, `just test`, `just test -p <project>`; not raw `cargo test`.
- `codex/CLAUDE.md` — `cargo test --workspace` is CI-only; prefer `just test -p <crate>`. `cargo check --workspace` (~6 min) is the standard typecheck gate.
- `external/repos/codex-patched/justfile:71-83` — `just test` runs `cargo nextest run`.

### 6. Anthropic gate
- `model-provider/src/anthropic_gate.rs:35-45` — `install_anthropic_gate()` stores resolved flag; `anthropic_models_resolved()` reads it.
- `core/src/chat_transport.rs:63-75` — `effective_wire_api()` routes chat-hinted models to `WireApi::ChatCompletions` only when enabled. **Capture is inherently gated — no new gate.**

### 7. Patch-surface convention
- `docs/implementation/patch-surface.md` — authoritative ledger, paths relative to `external/repos/codex-patched/codex-rs/`. `// SANDBOX PATCH:` markers + invariant tables (§1, §14) + replant notes (§15).

## Architect Analysis (Explore agent — integration, ordering, replay flow, risks)

### Integration seam / ordering
- Core seam = `core/src/chat_transport.rs`. `run_chat_stream` already fans out to both parsers (185-331). `handle_translated_events` (338-362) is the clean place to feed a core-only reasoning lifecycle when `TranslatedSseEvent::ReasoningDelta` is added. The **close-before-content/tool** trigger belongs at the `handle_translated_events`/`handle_event` boundary (or immediately before `handle_event` is called) — NOT in the overlay parser.
- Use `content_index = 0` for the single raw reasoning stream. `ReasoningRawContentDeltaEvent.content_index` is an `i64` field (`protocol/src/protocol.rs:1836-1845`).

### Double-emit risk (cleared)
- Overlay emits nothing for the reasoning chunk (ChatDelta lacks reasoning_text; `decode_chunk` drops empty content). Core `decode_openai_structured_content` is the only emitter; new `reasoning_text` branch inserted before the array early-return won't double-emit because later string-content chunks stay on the overlay parser and reasoning chunks are ignored there.

### Replay data flow (CONFIRMED end-to-end)
- Persisted `ResponseItem::Reasoning{content:[ReasoningText]}` reaches next-turn request build:
  - history accepts Reasoning as an API message (`core/src/context_manager/history.rs:445-466`).
  - `parse_turn_item` maps it back to `TurnItem::Reasoning` preserving `ReasoningItemContent::ReasoningText` (`core/src/event_mapping.rs:139-185`).
  - `build_responses_request` uses `prompt.get_formatted_input_for_request(...)` and serializes `input` (`core/src/client.rs:774-830`).
  - chat path → `build_chat_request_body(...)` → `push_chat_message(...)` (`payload.rs:251-325`).
- **No core-side filter drops reasoning on the chat path before payload.rs;** the only explicit drop is `push_chat_message`'s `_ => {}` arm.
- `should_serialize_reasoning_content` (`protocol/src/models.rs:1255-1262`) skips serialization only when content has NO ReasoningText.

### Risk areas
- Context stability / cache: reasoning is model-visible history — no history rewrite, keep bounded-item semantics, avoid cache-miss churn (codex/AGENTS "model visible context" rules).
- Unsigned/plaintext replay: no signature, best-effort echo (NOT verified CoT).
- `reasoning_effort=none`: zero chunks ⇒ no reasoning item opened.
- Two-commit submodule flow (submodule commit first, then codexu pointer bump — for impl, not this plan).
- Change size: keep core change additive/localized; replay overlay is the scoped exception. Mind the 800-line change-size guidance.

### Suggested implementation shape
- Second accumulator mirroring `AssistantMessageItem`: open on first reasoning delta, stream raw deltas, close before first content/tool delta, close-at-finish if still open with no content. Close logic in core dispatch, not overlay. Replay: patch payload.rs only, `// SANDBOX PATCH:` + patch-surface.md row.

## Codex Research
Independent codex-exec lens (xhigh) — corroborates the seed and both Explore agents. Added refinements:
- The `justfile` is at `external/repos/codex-patched/codex-rs/justfile` (NOT `codex/` root); run `just test -p <crate>` (or equivalent `cargo test -p <crate>`) FROM the `codex-rs` dir. Local policy: `cargo check --workspace` + focused `cargo test -p <crate>`.
- Open the reasoning item with `content:None`, close with `content:Some(vec![ReasoningText{text}])` (mirrors AssistantMessageItem open-empty/close-full).
- Reaffirms: overlay cannot depend on `codex-api`, so `ReasoningDelta` must be a core-owned `TranslatedSseEvent` variant (not on the overlay `ChatStreamEvent`). No new protocol type; no new gate. Replay field shape is NOT knowable from code — the 2-turn probe must decide it before editing payload.rs.

## Copilot Research
Failed: read-only snapshot budget exceeded (primary checkout `.xwin-cache` + submodules > 512MB). Non-blocking. (Phase 4 copilot review will run with cwd=PLAN_WORKTREE to avoid this.)

## Consolidated File List

### Files to modify — core (capture/persist/display, overlay UNTOUCHED)
- `external/repos/codex-patched/codex-rs/core/src/chat_transport/anthropic_sse.rs` — add `TranslatedSseEvent::ReasoningDelta(String)`; extend `decode_openai_structured_content` to emit it from `delta.reasoning_text` before the array early-return; add parser unit tests.
- `external/repos/codex-patched/codex-rs/core/src/chat_transport.rs` — add reasoning-item accumulator (mirror `AssistantMessageItem`); thread `ReasoningDelta` through `run_chat_stream` + `handle_translated_events`; emit OutputItemAdded(Reasoning)/ReasoningContentDelta/OutputItemDone(Reasoning) with correct ordering; lifecycle test.

### Files to modify — overlay (replay, SCOPED EXCEPTION)
- `codex-rs-overlay/codex-copilot/src/payload.rs` — add a `"reasoning"` arm to `push_chat_message` (replace the `_ => {}` drop) emitting the probe-decided field shape; `// SANDBOX PATCH:` marker; replay round-trip test (mirror ChatSseParser test style).

### Docs (both halves touch fork seams)
- `external/repos/codex-patched/codex-rs/docs/implementation/patch-surface.md` (or `codex/docs/implementation/patch-surface.md`) — §14 invariant rows + §15 replant notes for the new capture seam and the replay overlay exception.

### Probe (de-risk, no codex source edits)
- `D:/ExtRepos/copilot-thinking-probe/probe.mjs` — extend to a 2-turn request to decide the replay field shape.

### Types already present (NO additions needed)
- `codex-api/src/common.rs:73-114` — `ResponseEvent::{OutputItemAdded,OutputItemDone,ReasoningContentDelta}`.
- `protocol/src/models.rs:927-940,1518-1523` — `ResponseItem::Reasoning{summary,content,encrypted_content,..}`, `ReasoningItemContent::ReasoningText{text}`.

### Reference (do NOT edit)
- `client.rs:1672-1708` chat dispatch arm; `client.rs:1690-1700` reasoning_effort threading (knob-a-default-medium interplay).
