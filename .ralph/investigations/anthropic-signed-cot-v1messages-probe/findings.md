# Signed CoT over Copilot `/v1/messages` — GO/NO-GO probe findings

- **Task:** `codex-anthropic-native-messages-transport-for-signed-cot` (gating spike).
- **Direction:** D-001 "probe-gated signed fast-follow" (brainstorm shipped @ `2db146c0`).
- **Date:** 2026-06-24.
- **Endpoint probed:** `POST https://api.githubcopilot.com/v1/messages` (Anthropic Messages shape).
- **Model:** `claude-sonnet-4.6` (Copilot slug; the proxy echoes it back as `claude-sonnet-4-6`).
- **Auth:** fork-exact Copilot bearer + headers + token cache, mirrored from `D:\ExtRepos\copilot-thinking-probe\probe.mjs` (which mirrors `codex-rs-overlay/codex-copilot/src/auth.rs`). Plus the two Anthropic contract headers `anthropic-version: 2023-06-01` and `anthropic-beta: interleaved-thinking-2025-05-14`.

---

## VERDICT: **GO**

All three gates pass, and the decisive gate (c) passes in its **strongest** form: the
genuine captured signature is **accepted on replay** AND a single-character-tampered
signature is **rejected**. That means Copilot's proxy **preserves the Anthropic
`thinking` signature byte-for-byte end-to-end AND enforces it** — it does not strip,
re-sign, or ignore it. A native `/v1/messages` transport can therefore deliver faithful
**signed** chain-of-thought continuity that `/chat/completions` `reasoning_text`
(unsigned) cannot.

> Caveat (scope, not a blocker): this is a single live run on one model
> (`claude-sonnet-4.6`) at one point in time. The proxy behavior is a GitHub Copilot
> product decision and could change. The transport build should gate behind an
> experimental feature flag and keep the unsigned `reasoning_text` path as the
> always-available fallback (see "Sequencing" below). Re-run `probe-v1messages.mjs`
> as a pre-flight before the signed build lands, and add a CI/invariant smoke if the
> build ships.

---

## Per-gate evidence

Machine-readable evidence: `v1messages-evidence.json` (in this dir).
Raw, auth-scrubbed SSE excerpts: `raw-excerpts/` (response bodies only; no request
headers were ever serialized to disk).

### Gate (a) — Copilot bearer auth ACCEPTED on `/v1/messages`: **GO**

Turn-1 POST returned **HTTP 200 OK**, `content-type: text/event-stream`. The Copilot
bearer token + the fork's standard session headers were accepted on the Anthropic
Messages endpoint with no 401/403/404/"unsupported". The proxy streams a well-formed
Anthropic Messages SSE.

Citation: `raw-excerpts/turn1-signed-thinking-and-tooluse.sse.txt` line "…`"type":"message_start"`…" (`msg_vrtx_01RgqW7Mq1EAsK7iSz9YRKnp`, `input_tokens:669`).

### Gate (b) — signed `thinking` + `signature` EMITTED: **GO**

Turn 1 elicited a `thinking` block followed by a `tool_use` block (the model called
`record_answer({"answer":0.05})`). The thinking block streamed the full Anthropic
shape:

- `content_block_start` with `content_block.type == "thinking"` (index 0),
- a run of `content_block_delta` / `delta.type == "thinking_delta"` carrying the CoT text (350 chars),
- a terminal `content_block_delta` / `delta.type == "signature_delta"` carrying a **748-char `signature`**,
- then `content_block_start` for a `text` block (index 1) and a `tool_use` block (index 2, `toolu_vrtx_01BpvnHK3td4VMa9Wp2yef3B`).

This is exactly the shape that `/chat/completions` does **not** produce (that path emits
a flat OpenAI-shape `choices[].delta.reasoning_text` with **no** signature — see the
sibling `/chat/completions` captures in `D:\ExtRepos\copilot-thinking-probe\raw-*.sse`).

Citation: `raw-excerpts/turn1-signed-thinking-and-tooluse.sse.txt` — the `signature_delta`
line (`"signature":"EqwECmcIDxAC…ICaye0bd7tDl0kjxgB"`), the three `content_block_start`
lines, and `message_delta` with `stop_reason:"tool_use"`.

### Gate (c) — signed thinking ACCEPTED ON REPLAY before `tool_result`: **GO** (strong)

Turn 2 replayed the captured signed `thinking` block (verbatim text + signature) in the
assistant turn, immediately followed by its `tool_use`, then a `user` turn carrying a
`tool_result`. Two variants were sent:

| Variant | Signature replayed | Result | Meaning |
|---|---|---|---|
| **2a genuine** | the real captured 748-char signature, unmodified | **HTTP 200 OK**, model continues (`stop_reason:"end_turn"`) | proxy **preserved** the signature end-to-end and accepted the replay |
| **2b tampered** (negative control) | one char flipped at the midpoint | **HTTP 400 Bad Request**: `messages.1.content.0: Invalid \`signature\` in \`thinking\` block` | proxy **validates/enforces** the signature — it is not passed through blindly or ignored |

The pair is decisive: 2a alone could mean "proxy ignores signatures"; 2b rules that out.
Together they prove the signature round-trips faithfully **and** is cryptographically
meaningful through the Copilot proxy. (The `*_vrtx_*` id prefixes indicate Copilot proxies
Claude via a Vertex-hosted Anthropic backend; the signature is validated by that upstream
Anthropic backend — exactly the faithful round-trip the signed path needs.)

Citations:
- `raw-excerpts/turn2-genuine-accepted-200.sse.txt` — `message_start` (`msg_vrtx_01J4njKMorr1NM1vCZSXQrwN`) + `message_delta` `stop_reason:"end_turn"`.
- `raw-excerpts/turn2-tampered-rejected-400.sse.txt` — the full `invalid_request_error` body (`request_id req_vrtx_011CcNVBWsS9DRbWw9C53Zzx`).

---

## On GO: overlay-first transport sketch

This sketch names the exact seams from the brainstorm criteria and grounds each against
the current submodule tree (`codex/external/repos/codex-patched/codex-rs`, verified
2026-06-24). It is a **fast-follow after the unsigned sibling
(`codex-anthropic-chat-reasoning-text-capture-and-replay`) ships** — both touch
`core/src/chat_transport/anthropic_sse.rs` and overlay `payload.rs::push_chat_message`,
so running them in parallel guarantees a merge conflict.

### Key probe-derived architectural finding (de-risks the build)

The Anthropic Messages SSE shape captured here is **exactly** the event vocabulary the
fork's `anthropic_sse.rs` already branches on: `content_block_start`,
`content_block_delta` with `thinking_delta` / `signature_delta` / `input_json_delta` /
`text_delta`, and `message_delta` with `stop_reason`. Today those reasoning branches are
**deliberately dropped** at `core/src/chat_transport/anthropic_sse.rs:179-181`
(`// thinking_delta / signature_delta are reasoning content and are intentionally not
surfaced … _ => {}`). The signed transport's single substantive parser change is to
**stop discarding** `thinking_delta` + `signature_delta` and instead surface them into a
persisted reasoning item that carries the signature verbatim. Most of the parser
(tool-call accumulation, text, usage, stop-reason) is reusable as-is.

### Seam inventory + edit-budget + re-conflict probability

All paths relative to `codex/external/repos/codex-patched/codex-rs/`.

| # | Seam (file:line) | Change | Placement tenet | Edit budget | Re-conflict prob. on rebase |
|---|---|---|---|---|---|
| 1 | `model-provider-info/src/lib.rs:56` `enum WireApi` (today: `Responses` default + `ChatCompletions` SANDBOX PATCH) | Add a third arm `Messages` (`/v1/messages`) | Inline upstream-canonical (registry enum upstream owns) — Tenet 1.3 | ~6 lines (variant + doc) | **Medium** — upstream rarely edits this enum, but it is canonical; pair with `// SANDBOX PATCH:` + patch-surface §14 row |
| 2 | `protocol/src/openai_models.rs:413` `enum ModelWireRoute` (today: `ProviderDefault`, `ChatCompletions`) | Add `Messages` route hint | Inline upstream-canonical | ~3 lines | **Low-Medium** — small protocol enum |
| 3 | `model-provider/src/copilot_models_endpoint.rs:282-296` `fn wire_route_for` + a new `COPILOT_MESSAGES_ENDPOINT = "/v1/messages"` constant | Recognize models whose `supported_endpoints` contains `/v1/messages` and route them to `ModelWireRoute::Messages` when the signed feature is enabled. The `/v1/messages` string already appears here only as test-fixture data (`:547/613/665/711`) — no live routing today. | New constant + 1 branch in existing fn | ~10-15 lines | **Medium** — `wire_route_for` is fork-authored (SANDBOX PATCH D-001), so conflict is with our own prior edit, not upstream |
| 4 | `core/src/chat_transport.rs:64-77` `effective_wire_api` / `effective_wire_api_gated` (the single `ModelWireRoute → WireApi` mapping) | Add a `ModelWireRoute::Messages if signed_enabled => WireApi::Messages` arm; keep the match exhaustive | Inline (fork-authored fn) | ~3-5 lines | **Low** — fork-owned, exhaustive match |
| 5 | `core/src/client.rs:1633-1675` dispatch `match wire_api { Responses => … ChatCompletions => … }` | Add a `WireApi::Messages =>` arm that builds the Anthropic Messages request and routes it through a new overlay Messages transport | 1 arm calling into the overlay (Tenet 1.2 — call site is the only conflict candidate) | ~10-20 lines (arm + wiring) | **Medium** — adjacent to the D-001 `ChatCompletions` arm |
| 6 | **NEW overlay file** e.g. `codex-rs-overlay/codex-copilot/src/messages_transport.rs` (request builder: `system` / `messages` / `max_tokens` / `thinking:{type:"enabled",budget_tokens}` / `tools` in Anthropic shape) | Build the Messages request body + headers (reuse `CopilotHeaderSource::inject`, add `anthropic-version` + `anthropic-beta`) | **New overlay file** — Tenet 1.1, **zero upstream conflict surface** | ~150-250 lines | **None** (fork-exclusive) |
| 7 | `core/src/chat_transport/anthropic_sse.rs:179-181` (the `_ => {}` that drops `thinking_delta`/`signature_delta`) + overlay `payload.rs::push_chat_message` | Surface `thinking` + `signature` into a **neutral persisted-reasoning item** that stores the signature bytes verbatim and replays them unmodified before the next `tool_result` | Inline at the existing branch + overlay item shape | ~30-60 lines | **HIGH** — this is the SHARED file with the unsigned sibling. Sequence after unsigned; reuse its reasoning-item scaffold (see coordination ask) rather than re-editing |

**Estimated total upstream-canonical edit budget:** ~35-65 lines across 5 canonical
seams (#1-#5, #7-inline), plus one new fork-exclusive overlay file (#6, ~150-250 lines,
zero conflict surface). This fits the per-change budget. Seam #7 is the only HIGH
re-conflict item and is exactly why this is sequenced as a fast-follow.

**Hard correctness constraint surfaced by the probe:** the signature must be stored and
replayed **byte-for-byte**. The tampered-control 400 proves any mutation (even one char)
invalidates it. So the persisted reasoning-item shape must not normalize, re-encode,
trim, or re-wrap the signature string; round-trip it verbatim.

### Sequencing relative to the unsigned sibling

1. **Unsigned sibling ships first** (`codex-anthropic-chat-reasoning-text-capture-and-replay`).
   It lands the neutral persisted-reasoning item scaffold + the `payload.rs::push_chat_message`
   changes for unsigned `reasoning_text`.
2. **Signed build is the fast-follow.** It (a) adds the 3rd `WireApi`/`ModelWireRoute`
   arm + routing (#1-#5), (b) adds the overlay Messages request builder (#6), and (c)
   **extends** the sibling's reasoning-item scaffold with a `signature` field + the
   "stop discarding signature" change at `anthropic_sse.rs:179-181` (#7) — rather than
   re-editing the same two files from scratch.
3. Gate the signed path behind an **experimental feature** (codex `features/src/lib.rs`
   `Feature` enum, default off, enabled via `--enable <name>` / `-c features.<name>=true`)
   — a stricter sub-flag distinct from the unsigned path's `CODEX_ENABLE_ANTHROPIC`, so
   signed Messages can be validated independently and rolled back without disabling the
   unsigned transport. (Consistent with the fork convention to prefer experimental
   features over ad-hoc config bools.)

### Coordination ask for the unsigned sibling (carry into its planning)

Reserve a **neutral persisted-reasoning item shape** in the unsigned sibling that can
later carry `signature` metadata without a schema rewrite. Concretely, the unsigned
item should have an **optional** `signature: Option<String>` (and ideally an optional
provider/`type` discriminator) field that the unsigned path simply leaves `None`. The
signed fast-follow then populates it from the `signature_delta` and replays it verbatim.
This lets the signed build **extend** the scaffold rather than re-editing
`core/src/chat_transport/anthropic_sse.rs` + overlay `payload.rs::push_chat_message`,
collapsing seam #7's re-conflict risk from HIGH to LOW.

---

## NO-GO fallback (not taken)

For completeness: had gate (b) or (c) failed (e.g. `/v1/messages` 404'd, emitted no
signature, or rejected the genuine replay / accepted the tampered one), the recommended
fallback was D-003 — **defer/abandon the signed transport and rely on the unsigned
`reasoning_text` path**. That path is not blocked by this result; the unsigned sibling
ships regardless and remains the always-on baseline. The signed build is purely additive
faithful-continuity on top.

---

## Reproduce

```
node D:\ExtRepos\copilot-thinking-probe\probe-v1messages.mjs claude-sonnet-4.6
```

Requires a logged-in Copilot token cache at `~/.local/share/copilot-api/`
(`codex login --provider copilot`). The script writes per-turn `raw-v1messages-*.sse`
captures + a `v1messages-evidence-*.json` next to itself. A committed copy of the script
is `probe-v1messages.mjs` in this dir.
