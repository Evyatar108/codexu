Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

# Brainstorm synthesis — native Anthropic `/v1/messages` transport for SIGNED chain-of-thought

## Framing (all three lenses converged here)

This is **not primarily a transport-choice problem — it is an evidence problem.** The signed
path's entire value proposition depends on an endpoint (`/v1/messages`) that **has never been
probed against Copilot.** In the codex tree `/v1/messages` appears only as literal strings in
test-fixture `supported_endpoints` arrays; there is no routing, no endpoint constant, no live
capture. Three independent facts must ALL hold for the signed path to deliver anything beyond
the cheaper unsigned `reasoning_text` capture:

1. Copilot's `/v1/messages` **accepts the fork's Copilot bearer token + headers** (it may be
   advertised-but-not-served, or demand Anthropic-style `x-api-key`/`anthropic-version`/beta headers).
2. It actually **emits signed `thinking` blocks** (`thinking` + a usable `signature`).
3. It **accepts a signed `thinking` block on REPLAY** before a `tool_result` in a later turn and
   the signature validates **through the Copilot proxy** (a proxy may strip, re-sign, or reject).

If (3) fails, the signed path collapses to no better than unsigned — at the cost of a permanent
THIRD transport in a fork that already carries two (`Responses` + `ChatCompletions`). Both codex
and copilot lenses independently sized a full build as XL and flagged the parallel-edit conflict
with the in-flight unsigned sibling (`codex-anthropic-chat-reasoning-text-capture-and-replay`):
both efforts touch the SAME two files — core `chat_transport/anthropic_sse.rs` and overlay
`payload.rs::push_chat_message`.

## Directions

### D-001: Probe-gated signed fast-follow (after unsigned ships)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: It spends the cheapest possible evidence first. Extend the existing
  faithful probe (`D:\ExtRepos\copilot-thinking-probe\probe.mjs`, which already mirrors the
  fork's exact Copilot auth/headers) to POST a minimal Anthropic Messages request to
  `/v1/messages`, capture raw SSE for `thinking`/`signature`, then send a SECOND request that
  replays the signed thinking block before a `tool_result` and verify acceptance. Only if all
  three gates (auth / signed emission / signed replay) pass do you build the overlay-first signed
  transport — and you sequence it as a FAST-FOLLOW after the unsigned capture lands, reusing a
  neutral persisted-reasoning item shape so the second build extends the first instead of
  colliding with it on `anthropic_sse.rs` + `payload.rs`.
- Risks / friction: Requires the sibling unsigned plan to reserve a signature-compatible neutral
  reasoning-item shape (a coordination dependency). Probe needs valid Copilot auth on the box.
- Cheapest validation: The probe extension itself (S effort, no codex-rs build) IS the validation.
- Disconfirming observation: A faithful POST to `api.githubcopilot.com/v1/messages` with the
  existing Copilot bearer + headers returns 404/401/unsupported, omits `thinking.signature`, or
  rejects replay of a prior signed thinking block before a `tool_result`.

### D-002: Build the native signed `/v1/messages` transport now (overlay-first, third WireApi arm)
- Contributing lenses: [codex, copilot]  (devils-advocate red-flags it)
- Why this might work: If the endpoint does faithfully proxy signatures, this is the only wire
  that gives faithful cross-turn / tool-loop CoT continuity. Overlay-first keeps most of the
  request builder + Messages-SSE parser in `codex-rs-overlay/codex-copilot`; the unavoidable
  upstream-canonical edits are a third `WireApi` + `ModelWireRoute` arm, extending `wire_route_for`
  to recognize `/v1/messages`, `effective_wire_api`, and the `client.rs` dispatch arm. The existing
  (currently dead-code) `anthropic_sse.rs` thinking/signature decoder is a partial head-start —
  stop discarding the signature at lines 174-176.
- Risks / friction: Builds on an UNPROBED endpoint (highest risk). Runs in parallel with the
  unsigned sibling → guaranteed merge conflict on the two shared files. Permanent third-transport
  maintenance + billing/quota behavior on a second endpoint is unknown. Effort XL.
- Cheapest validation: Smallest vertical slice — route one Claude model to `/v1/messages` behind a
  strict sub-flag, build a minimal Messages request without tools, confirm signed thinking SSE
  reaches a neutral event type. (But this still front-loads transport plumbing before the probe.)
- Disconfirming observation: The vertical slice requires broad upstream-canonical rewrites beyond
  the WireApi/ModelWireRoute/effective_wire_api/client dispatch seams, OR tool-loop request
  translation cannot place signed thinking immediately before each `tool_result`.

### D-003: Defer signed indefinitely; rely on unsigned `reasoning_text`
- Contributing lenses: [devils-advocate]  (codex/copilot accept this as the fallback if the probe fails)
- Why this might work: The unsigned sibling matches the ONLY verified Copilot behavior today and
  delivers immediate, testable continuity/UX with no third transport. Signed continuity is a
  proxy-dependent benefit most users cannot directly observe; carrying a third WireApi branch
  indefinitely for it may be net-negative for a fork maintainer.
- Risks / friction: Leaves faithful signed continuity unbuilt; replayed reasoning is unsigned and
  the model may treat it as ordinary context rather than its own verified prior thinking.
- Cheapest validation: Dogfood one multi-tool Claude session on the unsigned path; see whether
  unsigned replay already removes the observable pain.
- Disconfirming observation: A concrete workflow appears where unsigned replay measurably degrades
  vs. signed (model rejects/ignores replayed CoT), AND the probe proves signatures round-trip.

## Recommendation

**D-001 — probe-gated signed fast-follow.** This directly answers the task question (now /
fast-follow / deferred): **not now, and not blind-deferred — gate it on a cheap probe.** Run the
`/v1/messages` validation spike first (S effort, no codex-rs build); if signed emission AND signed
replay both round-trip through the Copilot proxy, build the overlay-first signed transport as a
fast-follow AFTER the unsigned capture ships, on a shared neutral reasoning-item scaffold. If any
probe gate fails, fall to D-003 (defer/abandon). D-002 (build now, in parallel) is not
recommended: it front-loads an XL third-transport on an unproven endpoint and collides with the
in-flight unsigned plan on the two shared files.

## Open questions to carry into planning
- What minimum probe result justifies the build: signed emission only, or full signed replay
  through a tool loop? (Synthesis answer: require BOTH emission and replay acceptance.)
- Can the unsigned sibling reserve a neutral persisted-reasoning item shape that later carries
  `signature` metadata, so the signed fast-follow extends it rather than re-editing the same files?
- Does Copilot preserve, rewrite, or reject Anthropic signatures when proxying `/v1/messages`?
- Is the fork willing to carry a third `WireApi` branch indefinitely, or should signed Messages get
  a stricter sub-flag (vs. reusing `CODEX_ENABLE_ANTHROPIC`) until validated?
