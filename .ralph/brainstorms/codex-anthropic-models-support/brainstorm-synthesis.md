Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm synthesis — codex-anthropic-models-support

**Idea.** Let codexu users select and run Anthropic/Claude models (claude-opus,
claude-sonnet, claude-haiku, ...) through the same Copilot-backed provider that
already serves GPT-5.x, with no new egress or credentials.

## Source-verified endpoint verdict (the GO/NO-GO crux — SETTLED)

The brainstorm member settled the central question against source **and** a live
probe before any lens ran:

- **codex is Responses-API-only.** `WireApi` enum has only `Responses`; the
  `chat` variant was deleted upstream and `wire_api = "chat"` is a hard
  deserialize error (`model-provider-info/src/lib.rs:48,55-82`).
  `create_copilot_provider()` hardcodes `wire_api: WireApi::Responses`
  (`lib.rs:477-498`). `wire_api` is a **provider-level** field, not per-model.
- **The transport dispatch is a single-arm match:** `core/src/client.rs:1582-1621`
  — `match wire_api { WireApi::Responses => stream_responses_api(...) }`. No
  other arm exists.
- **The live /models filter requires `/responses`:** `is_chat_responses_picker_entry`
  (`model-provider/src/copilot_models_endpoint.rs:199-215`) keeps an entry only
  if `model_picker_enabled` AND `capabilities.type=="chat"`(or absent) AND
  `supported_endpoints` contains `/responses` (const at `:51`).
- **Live probe (authoritative)** — `GET https://api.githubcopilot.com/models`
  via codex's own Copilot-entitled token, 2026-06-08: **every Claude model
  advertises `supported_endpoints = /chat/completions + /v1/messages` only;
  NONE advertises `/responses`.** Claude rows: `capabilities.type="chat"`,
  `model_picker_enabled=true`, `vision=true`, `tools=true`, context 200k–1M.
  The only `/responses`-capable models are OpenAI/Azure GPT-5.x.
- **No residual chat code:** the only codex-rs file mentioning chat/completions
  is `copilot_models_endpoint.rs` (a doc comment + the `/responses` const).
  Upstream deleted all chat-completions request/response/SSE serialization, so a
  chat transport must be **built or vendored from scratch** — the dominant
  edit-budget driver.

**Consequence:** a filter/metadata-only change is **impossible**. Relaxing the
filter would surface Claude, but `stream()` would still POST a Responses body to
`/responses` for a Claude model, which Copilot does not serve for Claude → a
false affordance / request-time 400. A fork-local non-Responses transport is
required.

All three lenses independently converged on this verdict and on the same
recommended shape.

---

### D-001: Overlay /chat/completions transport with per-model routing (spike-gated, contract-scoped)
- **Contributing lenses:** [codex, copilot, devils-advocate]  •  **Effort:** L  •  **Re-conflict:** low–medium
- **Why this might work:** It matches both the live endpoint verdict and the
  reference prior art. The risky, voluminous logic (request body translation +
  streaming SSE→`ResponseEvent` translation + tool-call/vision mapping) lives in
  a new overlay crate file (`codex-rs-overlay/codex-copilot/src/chat_completions.rs`
  + `payload.rs`), which is **zero upstream conflict surface** per fork tenet #1.
  The only upstream-canonical edits are small and well-contained: a new
  `WireApi::ChatCompletions` variant (`model-provider-info/src/lib.rs:55-82`),
  one new match arm at the `client.rs:1582-1621` dispatch, and relaxing the
  `/models` filter to surface `/chat/completions` Claude entries tagged to the
  new wire api (`copilot_models_endpoint.rs:199-292`). Egress stays
  `api.githubcopilot.com` (same host, new path). The Copilot lens **source-verified**
  that the reference proxy (ericc-ch/copilot-api) forwards OpenAI-shaped payloads
  directly to Copilot `/chat/completions` and implements its Anthropic
  `/v1/messages` surface as a *translation to* chat-completions — i.e.
  `/chat/completions` is the proven, lowest-friction Claude path, and codex's
  OpenAI-shaped internals are closest to it.
- **Risks / friction (the DA's core warning):** the danger is **silent lossy
  success**, not a loud 400. codex's internal contract is Responses-shaped
  (function_call/custom_tool_call items, reasoning summaries, response.output
  ordering, usage accounting, `previous_response_id`/`store` continuity,
  structured output, apply_patch, web-search). Forcing these through
  `/chat/completions` can silently drop or degrade: streamed tool-call deltas can
  desync (chat emits partial JSON arguments differently than Responses output
  items), parallel tool calls can reorder/collapse, reasoning/"thinking" can be
  unavailable or leak as assistant text, usage/cost can be missing or
  mis-normalized, `previous_response_id`/`store` likely can't round-trip if
  Copilot chat is stateless. **wire_api is provider-level**, so per-model routing
  is the second design hazard: the "new variant + decide at stream()" change can
  metastasize across config, model metadata, the picker, the models cache,
  retries, and websocket-fallback assumptions if not bounded deliberately. A new
  request builder must not regress the `set_sensitive(true)` redaction invariant,
  and the static network audit allows the host but has no path-level assertion.
- **Cheapest validation (Phase-0 gate):** before broad implementation, hard-code
  ONE Claude slug (e.g. `claude-sonnet-4.6`) behind an internal flag and run a
  single live Copilot `/chat/completions` request that asks for a **typed
  tool-call with streamed JSON arguments plus a follow-up turn** needing
  continuation, and an apply_patch/edit flow. If the translator cannot reproduce
  the same internal `ResponseEvent`/output-item sequence codex expects for a
  comparable `/responses` model, D-001 is not viable without a much narrower,
  explicitly-labeled feature contract → fall through to D-003.
- **Disconfirming observation:** a direct Copilot `/chat/completions` probe for
  Claude rejects codex-required fields (system/developer messages, tool
  messages, function tools, image_url data URIs) or streams deltas that cannot
  be losslessly converted into codex tool-call state; OR the seam expands beyond
  a small `// SANDBOX PATCH:`-marked edit into broad upstream-canonical changes.

### D-002: Anthropic-native /v1/messages transport (deferred fidelity fallback)
- **Contributing lenses:** [codex, copilot, devils-advocate]  •  **Effort:** XL  •  **Re-conflict:** medium
- **Why this might work:** `/v1/messages` is Claude-native and may preserve
  thinking/long-context/tool_use semantics more faithfully.
- **Risks / friction:** codex internals are OpenAI/Responses-shaped, so this
  needs MORE bespoke mapping, not less. **Source-verified counter-evidence:** the
  reference proxy implements its `/v1/messages` route as an Anthropic→OpenAI-chat
  translation *before* calling Copilot, so there is **no proven fidelity
  advantage** over D-001 at strictly higher cost (XL). Anthropic-specific headers
  could also stress the existing redacted Copilot header path.
- **Cheapest validation:** send the smallest codex-equivalent prompt to Copilot
  `/v1/messages` and compare returned stream events vs `/chat/completions` for
  the same Claude slug, focusing on tool-use + usage. No advantage → drop.
- **Disconfirming observation:** `/v1/messages` needs Anthropic-only semantics
  codex can't represent cleanly, can't preserve tool_call ids / usage / output
  ordering, or shows no fidelity gain after testing.

### D-003: No-go / defer behind a must-pass spike + filter-only regression guardrail
- **Contributing lenses:** [devils-advocate, codex, copilot]
- **Why this might be right:** the strongest skeptical position is that Claude is
  not worth a **permanent second transport** in a fork whose tenet #1 is
  minimizing upstream-canonical conflict surface — a bespoke chat translator must
  be maintained forever against BOTH upstream Responses churn AND Copilot's
  undocumented, evolving Claude wire. If the user outcome is "Claude with GPT-5.x
  reliability," a lossy bridge may be worse than no feature.
- **Form:** if the D-001 Phase-0 spike fails any must-pass item, ship nothing or
  only an explicitly-labeled experimental text-only mode. Independently, land a
  regression test asserting Claude rows lacking `/responses` stay hidden unless a
  chat-transport hint is present (kills future filter-only footguns), plus a
  model-cache diagnostic explaining why Claude is absent today.
- **Cheapest validation:** define the must-pass Claude contract from real codex
  workflows (streamed tool call, apply_patch/edit, multi-turn continuation,
  image input if claimed, structured JSON if claimed, usage reporting); if any
  can't be implemented in a one-day spike, choose no-go/defer.
- **Disconfirming observation:** the Phase-0 spike cleanly produces codex's
  expected output-item sequence for tool-heavy + continuation turns → the no-go
  position is unjustified and D-001 proceeds.

---

## Recommendation

**D-001 — Overlay `/chat/completions` transport with per-model routing, gated by a
Phase-0 feasibility spike and shipped with an explicit, test-enforced v1 Claude
feature contract.** All three lenses recommend the overlay `/chat/completions`
transport; the Devil's Advocate's amendment is adopted as a hard precondition:
the L-budget build does not start until the spike proves the must-pass tool-call
+ continuation contract, and the v1 scope must enumerate exactly which Responses
features are supported vs UI-disabled for Claude so degradation is visible, never
silent. D-003 is the explicit off-ramp wired into D-001 (spike fails → defer or
experimental text-only). D-002 is a deferred phase-2 fidelity upgrade, justified
only by a concrete Claude-native need that `/chat/completions` cannot expose.

**Edit-budget estimate:** L (dominated by the from-scratch overlay translation
layer: chat-completions request builder + streaming SSE→`ResponseEvent`
translator + tool-call/vision mapping; the upstream seam itself is small).
**Re-conflict probability:** low–medium (the `WireApi` enum and the `client.rs`
dispatch are exactly the kind of seam upstream churns, but the fork already owns
heavy patches there, and the bulk of the code is overlay-exclusive).

## Model-id normalization / capability-mapping gotchas (from the probe + proxy)

- **Copilot-only slugs** `claude-opus-4.8`, `...-4.6-1m`, `...-4.7-1m-internal`,
  `...-4.7-high`, `...-4.7-xhigh` have no bundled `models.json` metadata → the
  `synthesize_from_capabilities` path (`copilot_models_endpoint.rs:230-292`)
  generates a minimal `ModelInfo`. `-1m` = 1,000,000-token context variants;
  `-high`/`-xhigh` = reasoning-effort variants; `-internal` may be entitlement-gated.
- **Alias normalization:** the reference proxy normalizes model aliases; codex
  should preserve exact Copilot slugs in UI+wire and only normalize after a live
  POST proves an alias works.
- **Capabilities:** all Claude rows report `vision=true`, `tools=true` — the
  translator must map codex tool-call format ↔ chat `tool_calls`, and vision
  image parts ↔ chat `image_url` data URIs (a proxy gotcha).
- **Thinking/reasoning:** Claude "thinking" differs from GPT reasoning-effort;
  the Responses reasoning config must be converted or dropped deliberately.
- **finish_reason / usage:** chat `finish_reason` ↔ codex stop reasons, and
  chat `usage` ↔ codex usage accounting both need explicit mapping (proxy
  gotchas: tool_use/tool_result mapping, finish_reason, usage).

## Hard constraints carried into planning
Egress stays `api.githubcopilot.com` only (no new network surface); preserve
`Authorization`/`ChatGPT-Account-ID` `set_sensitive(true)` redaction in the new
request builder; overlay-first per fork tenet #1 with every upstream-canonical
edit carrying a `// SANDBOX PATCH:` marker + patch-surface.md §14 row + §15
rebase note; codex submodule work in a worktree under
`codex/external/repos/codex-patched/codex-rs` with `cargo metadata --no-deps`
preflight and `cargo check --workspace` as the typecheck gate.
