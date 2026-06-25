# Anthropic chat-reasoning replay — CONSUMPTION verification

**Task:** `codex-anthropic-chat-reasoning-replay-consumption-verification`
**Date:** 2026-06-25
**Type:** read-only investigation + live behavioral probe (no transport code changed)

---

## VERDICT — **CONSUMED**

The fork's shipped unsigned reasoning-replay over Copilot `/chat/completions` **IS
consumed by the model. It is NOT a no-op / decorative.**

The shipped shape is a standalone `{role:"assistant", content:<plaintext reasoning>}`
message (NOT a `reasoning_text` field — see fork-shape citation below). In a clean,
confound-free WITH/WITHOUT A/B where a discriminating token lived **only** in the
replayed reasoning, the model recalled that token on **every** trial of the shipped
shape and on **none** of the control trials:

| Replay shape (over `/chat/completions`) | sonnet-4.6 recall | opus-4.8 recall | Meaning |
|---|---|---|---|
| **`shipped_standalone_assistant`** (the fork's actual emission) | **3/3** | **2/2** | **CONSUMED** — model-visible |
| `reasoning_text_field` (dedicated input field) | 0/3 | 0/2 | accepted HTTP 200 but **silently DROPPED** |
| `reasoning_content_field` (DeepSeek/opencode convention) | 0/3 | 0/2 | accepted HTTP 200 but **silently DROPPED** |
| `control_no_reasoning` (baseline) | 0/3 | 0/2 | non-guessable confirmed |

**Implication for the signed `/v1/messages` build:** the unsigned path being consumed
means signed transport is **NOT** rescued from "the only path that works" — it does
**not** get its priority raised on a no-op argument. It remains an **optional fidelity
upgrade**, not a correctness necessity. (Its independent value case — structured + signed
+ tamper-enforced thinking, parity with how Claude Code / the Anthropic-native ecosystem
actually do continuity — stands on its own; see §5.)

---

## 1. The gap this closes

Prior work verified two of three legs:
- Copilot `/chat/completions` **emits** Claude reasoning (live spike 2026-06-21: 46
  `reasoning_text` chunks at `reasoning_effort=high`).
- The fork **captures + replays** it (shipped codex `0.141.0-copilot-api.2`).

The **unverified** leg: does the endpoint actually **consume** the replayed unsigned
reasoning on **input**, or is it silently ignored/stripped by the Copilot proxy? If a
no-op, the shipped feature would be decorative and signed `/v1/messages` would become the
only real continuity path. This investigation closes that leg.

## 2. The exact shape the fork emits (cited, read-only)

`codex/codex-rs-overlay/codex-copilot/src/payload.rs:322-339`, `push_chat_message`
"reasoning" arm (SANDBOX PATCH D-001 reasoning replay):

```rust
"reasoning" => {
    if let Some(text) = capped_reasoning_plaintext(item) {
        messages.push(serde_json::json!({
            "role": "assistant",
            "content": text,
        }));
    }
}
```

So the fork does **not** send a `reasoning_text` field on input. A persisted
`ResponseItem::Reasoning` is re-emitted as a **standalone assistant-role plaintext
message**, placed in-position before the prior answer (two consecutive assistant
messages), byte-capped at `MAX_REPLAYED_REASONING_BYTES = 8000` (`payload.rs:352-387`).
The code comment already records the US-001 probe decision that the dedicated
`reasoning_text` input field "is accepted (HTTP 200) but silently ignored, while a
plaintext assistant message is accepted AND honored" — this investigation **independently
re-verifies that** with a cleaner, controlled A/B and extends it to the
`reasoning_content` field as well.

The live probe mirrors this exact shipped shape (`probe.mjs` `runConsumption`,
`shipped_standalone_assistant` condition).

## 3. Live behavioral probe — methodology & raw results

Script: `probe.mjs --consume --trials=N` (copied alongside this file). Auth/headers are
mirrored 1:1 from the fork's `codex-copilot/src/auth.rs` + `header_source.rs` (same code
the existing probe already mirrored); the live Copilot bearer is used but **never
serialized** — only request bodies (auth-free) and response SSE are written. All evidence
files were grep-scanned for `Bearer/authorization/*_token/gh[osu]_` and are clean.

**Design (confound-free A/B).** Turn-1 (synthesized deterministically so the
discriminating fact is *guaranteed* to exist only in the reasoning): the assistant is
asked to assign codenames to three microservices but explicitly told **not** to list them
in the visible answer — so the names live solely in its private reasoning. Each codename
is a per-run random non-guessable token (`Word-XXXX`, 4 hex). Turn-2 asks: *"What codename
did you assign to microservice #2? Reply with ONLY that token."* The token appears **only**
in the replayed reasoning, never in the visible answer. We then compare:
- **WITH** the reasoning replayed in the shipped shape and in each dedicated-field shape,
- **WITHOUT** it (control),
- N trials per condition to beat stochasticity.

This fixes two weaknesses of the earlier `--two-turn` canary test (evidence retained at
`evidence/two-turn-canary-evidence-sonnet-4.6-2026-06-21.json`): (1) its "reveal your
secret verification codeword" framing tripped Claude's prompt-injection **refusal** (the
model objected instead of cleanly using the value — though it still demonstrably *read*
it, which already proved visibility); (2) it had no explicit WITHOUT control. The neutral
"recall the codename you assigned" framing here produces a **clean functional signal** and
the control proves non-guessability.

**Results (raw captures in `evidence/`):**

- **`shipped_standalone_assistant` — CONSUMED.** sonnet-4.6 returned the exact
  reasoning-only token on all 3 trials (`Zephyr-B915`, `Cobalt-3730`, `Onyx-FA72`);
  opus-4.8 on both (`Vesper-3667`, `Onyx-CD05`). Turn-2 output was literally just the
  token.
- **`reasoning_text_field` — DROPPED.** 0/3 (sonnet), 0/2 (opus). Model: *"I don't
  actually have persistent private memory between turns…"* — it never saw the reasoning.
  HTTP 200 (accepted) but content not model-visible.
- **`reasoning_content_field` (the field opencode actually uses) — DROPPED.** 0/3
  (sonnet). Same "no memory" response. HTTP 200 but dropped.
- **`control_no_reasoning` — 0/3, 0/2.** Confirms the token is non-guessable: absent the
  replay the model cannot produce it. The WITH/WITHOUT divergence is total and clean.

Schema answer to the task's question: Copilot `/chat/completions` **accepts** an assistant
`reasoning_text` *and* `reasoning_content` field on input (no 400) but **silently drops
both** for Claude models — neither reaches the model. Only ordinary assistant `content` is
model-visible. Raw request+response for each shape are in the evidence JSONs under
`rawCaptures`.

## 4. Reference implementations (cited)

### Claude Code (`D:\harness-efforts\claude-code`, full TS source)
- **Replays thinking: YES**, over the **native Anthropic Messages API** (`POST /v1/messages`)
  as structured signed `thinking` / `redacted_thinking` content blocks
  (`src/services/api/claude.ts:555,864` `anthropic.beta.messages.create`;
  `src/utils/messages.ts:4774,3012-3013`).
- **Signature preserved verbatim**: `contentBlock.signature = delta.signature`
  (`claude.ts:2127-2146`); stripped only when key/model changes
  (`messages.ts:5060-5064`, `query.ts:924-928`). Consecutive assistant messages with
  mismatched thinking-block **signatures** cause API 400s (`messages.ts:2307-2310`).
- **Chat-completions reasoning replay: NONE EXISTS.** Whole-tree search for
  `reasoning_content`, `reasoning_text`, `chat/completions`, `"reasoning"` → **no matches**.
  Continuity is exclusively native-`/v1/messages` signed thinking.

### opencode (`D:\harness-efforts\opencode`, multi-provider)
- **Replays reasoning: YES, over BOTH shapes — split by protocol.**
  - Native Anthropic path lowers reasoning to `thinking` blocks **with a signature** over
    `/v1/messages` (`packages/llm/src/protocols/anthropic-messages.ts:447-452`; signature
    from `signature_delta` → `providerMetadata.anthropic.signature`, lines 718-727,253-256;
    beta header `interleaved-thinking-2025-05-14` at `core/src/plugin/provider/anthropic.ts:13-14`).
  - OpenAI-compatible path replays reasoning over `/chat/completions` via a
    **`reasoning_content`** field, **unsigned, plaintext**
    (`packages/llm/src/protocols/openai-chat.ts:253-261`; legacy AI-SDK path
    `src/provider/transform.ts:300-310`). Capability union encodes the either/or
    (`core/src/models-dev.ts:53-59`).
  - **Crucially: Anthropic *models* are NOT routed through the chat-completions reasoning
    path.** The unsigned `reasoning_content` replay is only for OpenAI-compat reasoning
    models (DeepSeek/Kimi/GLM); signed Anthropic continuity is exclusive to native
    `/v1/messages`. No repo replays *signed Anthropic thinking* through a chat-completions
    endpoint.

### happy (`D:\harness-efforts\happy`) & microsoft-happy-coder
- **happy** is a UI/wire wrapper around the Claude Code / Codex CLI; it does **not**
  construct model requests. Thinking blocks are carried over its own protocol for
  **display only**, explicitly *not* model replay
  (`packages/happy-wire/src/nonRenderablePolicy.ts:94-96`). Every `signature` in its code
  is Ed25519 auth crypto, not Anthropic thinking signatures.
- **microsoft-happy-coder** is an installer/deployment fork of happy (wraps `agency claude`);
  **no model-request source present** — inherits Claude Code's behavior.

## 5. Synthesis & implication for the signed-transport build

**Industry pattern (confirmed):** real, *faithful, signed* cross-turn reasoning continuity
is done over the **native Anthropic Messages API with `thinking` blocks carrying a
`signature`**. Chat-completions "reasoning" replay, where it exists at all (opencode for
DeepSeek-style models), is **unsigned plaintext best-effort** — and is **never** used for
Anthropic models, which always get the native signed path. Claude Code has **no**
chat-completions reasoning path whatsoever.

**But the fork's unsigned chat-completions replay IS consumed** (this probe). The two
findings are consistent and complementary:
- The fork's standalone-assistant-message replay works because it is just **ordinary
  assistant conversational content** the model reads back — not a structured "reasoning
  channel." The dedicated reasoning fields (`reasoning_text`, `reasoning_content`) that a
  structured channel would use are **dropped** by the Copilot proxy for Claude.
- So the fork achieves **functional best-effort continuity today**, at the cost of
  replaying CoT as *visible assistant text* (lower fidelity; can occasionally be
  misread by the model as a prior visible turn / prompt-injection, as the canary run
  showed) rather than as private, signed, tamper-verified thinking blocks.

**Therefore, for `codex-anthropic-native-messages-transport-for-signed-cot`:**
- The unsigned path is **consumed**, so signed transport's priority is **NOT raised** by a
  "unsigned is a no-op" argument. The shipped feature is functional; signed transport is
  **not** required for basic continuity.
- Signed `/v1/messages` remains an **optional fidelity upgrade**, justified independently
  by: (1) faithful structured thinking instead of visible assistant text; (2) signature
  round-trip is available and **enforced** by Copilot's `/v1/messages` (prior probe=GO:
  genuine signed replay 200, tampered 400 — `evidence/v1messages-signed-cot-evidence-…json`);
  (3) parity with the canonical Claude Code / opencode-native Anthropic pattern; (4) avoids
  polluting visible turn history with raw CoT.
- Net: **build it for fidelity/faithfulness if/when the fork wants signed CoT — but it is
  not gating, and the current unsigned shipped behavior should not be treated as broken.**

## 6. Does us008's deterministic mock need a companion live-probe gate? — **YES (thin)**

us008's deterministic mock validates the **fork's emission shape** (that a persisted
`reasoning` item lowers to a standalone assistant message) — that is the right unit-test
layer and should stay deterministic. But **consumption** depends on the **Copilot proxy's
runtime behavior** (it silently drops `reasoning_text`/`reasoning_content` yet honors plain
assistant `content`), which a deterministic mock cannot guarantee remains true across proxy
changes. Recommendation: keep a **thin, opt-in live-probe gate** (this `--consume` probe,
~9 calls) runnable on demand / pre-release, separate from CI, to catch a future proxy change
that starts honoring the dedicated fields (which would let the fork switch to a cleaner
shape) or — the real risk — stops surfacing replayed assistant content. The two test
different layers: mock = "fork emits the right shape", live probe = "the proxy still
consumes that shape."

## 7. Evidence index (`evidence/`)

| File | What it shows |
|---|---|
| `consumption-evidence-sonnet-4.6-3trials-with-reasoning_content.json` | Full A/B incl. `reasoning_content`: shipped 3/3, both fields 0/3, control 0/3 + raw req/resp |
| `consumption-evidence-sonnet-4.6-3trials-initial.json` | Initial sonnet A/B (shipped 3/3, `reasoning_text` 0/3, control 0/3) |
| `consumption-evidence-opus-4.8-2trials.json` | Cross-model confirm (shipped 2/2, field 0/2, control 0/2) |
| `two-turn-canary-evidence-sonnet-4.6-2026-06-21.json` | Prior canary run (standalone honored; `reasoning_text` field model had zero knowledge) |
| `v1messages-signed-cot-evidence-sonnet-4.6-2026-06-24.json` | Signed `/v1/messages` GO: genuine 200, tampered 400 (signature enforced) |
| `../probe.mjs` (`probe.mjs` here) | The extended probe (auth mirrored from fork; `--consume` mode added) |

**Read-only guard:** no codex/codexu transport source was modified. The only edits were to
the external scratch probe `D:\ExtRepos\copilot-thinking-probe\probe.mjs` (sanctioned by the
task) plus the new files under this investigation directory. Worktree `git status` confirmed
clean of source edits before commit.
