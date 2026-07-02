---
overviewTaskId: codex-happy-subagent-sessions-in-app
recommendedDirection: "D-001 — Overlay-only thread-aware sidechain nesting: register each codex subagent thread with a minted cuid2, synthesize a parent Agent tool-call, tag child-thread envelopes subagent:<cuid2>, reuse Happy's existing Task sidechain UI; gated behind a new default-off Feature::RemoteSubagentSessions."
researchOnly: true
status: brainstorm
---

# codex-happy-subagent-sessions-in-app — selected direction

> Follow-up to the shipped top-level auto-attach
> (`codex-autoconnect-auto-daemon-and-auto-attach`), which explicitly deferred
> surfacing v1/v2 multi-agent SUB-sessions in the Happy app. This brainstorm
> designs the smallest wedge to make spawn_agent children visible.

## Sources (read for this brainstorm)

- Shipped top-level design + deferral:
  `.ralph/brainstorms/codex-autoconnect-auto-daemon-and-auto-attach/selected-direction.md`,
  `.ralph/jobs/codex-autoconnect-auto-daemon-and-auto-attach/plan.md`
- North star (two planes: app-server = control, embedded happy-server = session):
  `.ralph/brainstorms/codex-autoconnect-northstar-design-doc/selected-direction.md`
  (no subagent/child mention — confirms sub-sessions were deferred, not designed)
- Raw-session remote-control ship (built the tee + mapping):
  `data.archived.json` → `codex-raw-session-happy-daemon-autoconnect`
- Overlay crate: `codex/codex-rs-overlay/codex-happy/src/{attach,inbound,mapping,wire}.rs`
- Multi-agent internals:
  `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/{multi_agents,multi_agents_v2}/spawn.rs`,
  `codex/external/repos/codex-patched/codex-rs/app-server/src/{in_process.rs,bespoke_event_handling.rs}`,
  `.../app-server-protocol/src/protocol/v2/item.rs`,
  `codex/external/repos/codex-patched/codex-rs/tui/src/app.rs`
- Feature registry:
  `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs`
- Prior investigation:
  `.ralph/investigations/codex-upstream-multi-agent-v2-fork-impact/findings.md`,
  `plans/codex-child-spawn-tools.md`
- Happy session/wire model:
  `packages/happy-wire/src/sessionProtocol.ts`,
  `packages/happy-app/sources/sync/{typesRaw.ts,reducer/reducerTracer.ts}`

---

## The four key questions, source-grounded

### Q1 — Do spawn_agent child events already flow through `happy_tap`? **YES.**

- The TUI tees **every** `app_server.next_event()` into `happy_tap` *before* it
  demuxes per-thread: `tui/src/app.rs:1254` (SANDBOX PATCH: remote_session),
  gated by `Feature::RemoteSession` (`tui/src/app.rs:1034`).
- That single in-process app-server event stream is **multiplexed across all
  threads** (primary + subagents). The in-process connection auto-attaches a
  listener to **every newly-created thread** via the `thread_created_rx`
  broadcast → `try_attach_thread_listener(thread_id, [IN_PROCESS_CONNECTION_ID])`:
  `app-server/src/in_process.rs:490-501`. Sub-agent spawns create threads →
  auto-subscribed → their notifications reach the same TUI connection →
  `next_event()` → `happy_tap`.
- Every per-thread notification carries its own `thread_id`
  (`app-server-protocol/.../v2/item.rs` ItemStarted/ItemCompleted ~1118-1199;
  turn notifications carry `thread_id`), so child events arrive **tagged and
  distinguishable** at the tap.

**Conclusion:** No new plumbing or TUI seam is needed to *receive* child events —
they already arrive. The gap is entirely in the **outbound mapping**, which
today discards `thread_id`.

### Q2 — What identity does a child carry? Can the tee disambiguate? **YES — own thread_id.**

- A child is a real, independent codex thread with its **own server-assigned
  `thread_id`** (distinct from the parent). Subagent threads carry
  `parent_thread_id: Some(...)`; the root has `parent_thread_id: None`
  (`inbound.rs:181` comment: "a root thread has no parent_thread_id (subagent
  threads do)").
- The overlay's `ControlState` **already** locks `primary_thread_id`
  (`inbound.rs:95`) on the first root `thread/started` (`inbound.rs:118-120`,
  `lock_primary_if_root` `:183-185`), has an `is_primary(thread_id)` helper
  (`inbound.rs:190`), and a lazy `adopt_thread` fallback that adopts the first
  thread seen from a turn/item notification (`inbound.rs:174-178`). So the tee
  can already tell "primary vs child" for any event.

**Constraint (load-bearing):** Happy's wire requires the `subagent` field to be
a **cuid2** (`sessionProtocol.ts:138-143`, `isCuid` refine); a non-cuid value
causes the message to be **dropped** (`typesRaw.spec.ts` around 2109). codex
`thread_id`s are **UUIDs**, so the overlay MUST **mint a cuid2 per child thread**
and maintain a stable `codex thread_id → cuid2` map. (The envelope `id` itself is
only `z.string()`, so the existing `Uuid::new_v4()` for envelope id is fine —
only `subagent` strictly needs cuid2.)

### Q3 — Does Happy wire/app model nesting, or only flat? **NESTED (as sidechains within ONE session).**

Happy does **not** model a parent→child *session* relationship for this. Instead
it models subagents as **sidechains inside a single session**, rendered nested
under a parent tool-call:

- `SessionEnvelope.subagent?: cuid2` tags an envelope as belonging to a subagent
  (`sessionProtocol.ts:138`; mirrored in the overlay's Rust port
  `codex-happy/src/wire.rs`).
- The app sets `parentUUID = envelope.subagent` → `isSidechain`
  (`typesRaw.ts:522-523`).
- A `tool-call-start` envelope normalizes to a tool-call with
  `input: envelope.ev.args` (`typesRaw.ts:645-656`), so `args.sessionSubagent`
  reaches the reducer.
- The tracer nests sidechain messages under a parent tool-call whose
  `name ∈ {'Task','Agent'}` (`isSubagentToolCall`, `reducerTracer.ts:130`) and
  whose `input.sessionSubagent === <subagent id>` (`getToolCallParentIds`,
  `reducerTracer.ts:121-128`). Confirmed by test "nests subagent-linked sidechain
  messages under parent tool calls" (`reducer.spec.ts:3627`) and
  "link session subagent ids from tool input to the parent tool call message"
  (`reducerTracer.spec.ts:264`).

**Smallest change to make children visible AT ALL (with nesting):** emit one
synthetic parent `Agent`/`Task` tool-call envelope (`args.sessionSubagent =
<child cuid2>`, `args.prompt = <label>`, `args.subagent_type = <role/path>`) when
a child is first registered, and tag that child thread's envelopes with
`subagent: <child cuid2>`. This reuses the **existing** Claude-Task nesting UI
with **zero app/server/wire changes**.

**Flat siblings as separate sessions is NOT how this wire works** and would be
much heavier (see rejected D-003).

### Q4 — v1 (Collab) vs v2 (MultiAgentV2): same event stream? **Version-agnostic — key off thread_id, not the spawn event.**

- Fork is codex 0.135. v1 `Collab` (key `multi_agent`) is **default-ON**
  (`features/src/lib.rs`); v2 `MultiAgentV2` (key `multi_agent_v2`) is
  **default-OFF**. (See
  `.ralph/investigations/codex-upstream-multi-agent-v2-fork-impact/findings.md`.)
- v2 spawn emits a `SubAgentActivityEvent { agent_thread_id, agent_path, kind }`
  (`multi_agents_v2/spawn.rs`), surfaced as `ThreadItem::SubAgentActivity`
  (`v2/item.rs:349-354`).
- v1 spawn emits `CollabAgentSpawnBeginEvent` / `CollabAgentSpawnEndEvent`
  (`multi_agents/spawn.rs:85,197`) — and these are **explicitly DROPPED by the
  app-server** (`bespoke_event_handling.rs:846-853` catch-all "no notification
  emitted" arm). **So the v1 spawn signal is NOT visible at the tap.**
- **What IS reliably visible for both v1 and v2:** each child creates a real
  thread whose own item/turn notifications flow (auto-attach, Q1) tagged with the
  child `thread_id`, and a generic `thread/started` with `parent_thread_id: Some`
  that `ControlState.observe` already receives (`inbound.rs:118-120`).

**Conclusion:** The robust, version-agnostic identity signal is the child
`thread_id` (+ generic `thread/started`), NOT the engine-specific spawn event.
The design keys off that, so it covers v1 (default-on, the common case) and v2
(when enabled) identically. The `SubAgentActivity` / Collab spawn events are only
*optional enrichment* (human-readable `agent_path`/prompt) — and v1's is
unavailable at the tap, so enrichment is a follow-up, not the wedge.

---

## Current mapping gap (the exact change surface + a latent bug)

`mapping.rs` today is **thread-blind**:

- `map_event` → `map_notification` (`mapping.rs:57,69`) matches
  TurnStarted/TurnCompleted/ItemStarted/ItemCompleted but reads only
  `turn.id`/`turn_id` — it **never reads `thread_id`**.
- The `envelope()` helper **hardcodes `subagent: None`** (`mapping.rs:184`).

**Consequence (latent bug):** in a top-level remote session today, when the model
spawns a sub-agent (Collab is default-ON), the child's item/turn events already
arrive at the tap (Q1) and get **flattened into the parent transcript** with
`subagent: None` — as if they were the parent's own output. The new feature both
*fixes* this and must coordinate so it does **not** regress the shipped
top-level behavior (see M-F).

---

## Recommended direction — D-001 (overlay-only nested sidechain wedge)

**One line:** Register each codex subagent thread with a minted cuid2 in
`ControlState`, synthesize a parent `Agent` tool-call envelope, tag child-thread
envelopes `subagent: <cuid2>`, and reuse Happy's existing Task-sidechain UI —
**entirely inside the overlay**, gated behind a new default-off
`Feature::RemoteSubagentSessions`.

Why this is the smallest AND best wedge:

- **Zero app / happy-wire / happy-server changes.** The `subagent` field, the
  `sessionSubagent` linkage, the sidechain reducer, and TaskView already exist
  and ship in the app today (Q3). We only produce envelopes shaped for them.
- **Reuses the existing tap seam** (`app.rs:1254`) — no new TUI seam, so the
  patch-surface tap invariants from the top-level ship are untouched (see M-A/M-H).
- **Self-contained in `inbound.rs` (registry) + `mapping.rs` (thread-aware
  envelopes) + a small `attach.rs` wiring** — the same files the raw-session ship
  already owns.
- **Version-agnostic** (keys off `thread_id`, not the v1/v2-specific spawn event).
- **Fixes the latent flattening bug** as a side effect of becoming thread-aware.

### Identity & registration

Extend `ControlState` (`inbound.rs:92`) with a child registry:
`HashMap<child_thread_id (String), cuid2 (String)>` plus `register_child(thread_id)
-> cuid2` and `child_cuid2(thread_id) -> Option<&str>` accessors. Populate it on
whichever child signal arrives first:

1. **Primary path** — `observe`'s `ThreadStarted` arm (`inbound.rs:118-120`):
   when `n.thread.parent_thread_id.is_some()`, `register_child(n.thread.id)`
   (mint + store cuid2) and remember `agent_path` if the notification carries it.
2. **Fallback path** — first non-primary `thread_id` seen on an item/turn
   notification (extend the `adopt_thread`/`is_primary` logic at
   `inbound.rs:174-190`): if `thread_id != primary` and not yet registered,
   `register_child(thread_id)`. This covers the case where `ThreadStarted` is not
   delivered to the tap for auto-attached children (OPEN QUESTION Q-3).

Minting a cuid2 needs a generator in the overlay (small dep or vendored helper) —
see OPEN QUESTION Q-2.

### Flat-vs-nested decision: **NESTED.**

Emit one synthetic parent tool-call envelope per child at registration time on the
**primary** turn:

```
SessionEvent::ToolCallStart {
  call:  <fresh id>,
  name:  "Agent",                 // ∈ {Task, Agent} per reducerTracer.ts:130
  args:  { "prompt": <label>,      // → normalized to input (typesRaw.ts:656)
           "sessionSubagent": <child cuid2>,   // → getToolCallParentIds
           "subagent_type": <agent_path or "subagent"> },
  ...
}
```

Then map every child-thread notification through a thread-aware `envelope()` that
sets `subagent: Some(<child cuid2>)`. The app nests those messages under the
synthetic parent tool-call (Q3). Nested is both the smallest change (reuses app
machinery) and the correct UX (matches Claude-Code Task nesting; avoids the
flattening confusion).

### Gate & do-not-regress coordination

- New **default-off** `Feature::RemoteSubagentSessions` (Experimental), registered
  by mirroring `Feature::RemoteSession` in `features/src/lib.rs`. The entire
  child-thread behavior is gated on it.
- **When OFF (default):** to avoid today's latent flattening, **suppress**
  non-primary-thread envelopes (filter `thread_id != primary`). This is strictly
  cleaner than today and preserves exact top-level auto-attach parity. It IS a
  behavior change to the shipped path → flag for operator ack (OPEN QUESTION Q-1).
- **When ON:** nest child threads as Task sidechains.
- Reusing the existing tap (no new seam) means the top-level ship's tap
  invariants are not disturbed; the wire-drift guard (US-008) is unaffected
  because no wire struct changes (the `subagent` field already exists in
  `wire.rs` + `sessionProtocol.ts`).

---

## Sequenced milestones

- **M-A · Feature gate.** Add default-off `Feature::RemoteSubagentSessions`
  (Experimental) mirroring `Feature::RemoteSession` in `features/src/lib.rs`;
  fork-visibility unit test; patch-surface §14 invariant row + §15 replant note.
- **M-B · Child registry in `ControlState` (`inbound.rs`).** Add the
  `HashMap<child_thread_id, cuid2>` + `register_child`/`child_cuid2`; populate on
  `ThreadStarted{parent_thread_id: Some}` (primary path) and on first non-primary
  item/turn `thread_id` (fallback via the adopt/is_primary path). Add a cuid2
  minting helper (Q-2). Unit-test in the inbound tests.
- **M-C · Thread-aware outbound mapping (`mapping.rs`).** Thread
  `&ControlState` (or `primary_thread_id` + registry) into
  `map_event`/`map_notification`/`map_item_*`; read `thread_id` from each
  notification; primary → `subagent: None`; registered child → `subagent:
  Some(cuid2)`; make `envelope()` accept a `subagent` arg (drop the hardcoded
  `None` at `mapping.rs:184`). Unit tests asserting child envelopes carry the
  cuid2.
- **M-D · Synthetic parent tool-call.** On child registration emit one
  `ToolCallStart` (`name: "Agent"`, `args.sessionSubagent = <cuid2>`,
  `args.prompt = <label>`, `args.subagent_type = <agent_path|"subagent">`) on the
  primary turn so the app registers the parent mapping
  (`reducerTracer.ts:121-132`). Unit test.
- **M-E · Wire into both drain sites (`attach.rs`).** Pass `&control` into the
  mapping call at the pre-connect buffer path (`attach.rs:275`) and the connected
  path (`attach.rs:401`). Reuse the existing `happy_tap` seam (`app.rs:1254`) —
  **no new TUI seam**. Gate all child-thread behavior on
  `Feature::RemoteSubagentSessions`.
- **M-F · Gate-off coordination / do-not-regress.** When the feature is OFF,
  suppress non-primary-thread envelopes (fixes today's flatten, preserves
  top-level parity). Flag the behavior change for operator ack (Q-1). When ON,
  nest.
- **M-G · Optional child lifecycle enrichment (defer).** Emit `start{title}` /
  `stop{}` boundary markers + child turn-end tagged with the cuid2 for cleaner
  rendering. Note the app currently **drops** `start`/`stop`
  (`typesRaw.ts:568-570`), so this is nice-to-have, not required.
- **M-H · Patch-surface + audit closeout.** §14 row for the feature gate; confirm
  **zero** new upstream-canonical seam (tap reused); wire-drift guard (US-008)
  unaffected; `cargo check --workspace` local gate + overlay `cargo test`.

---

## Open questions (unverified in source → NOT asserted)

- **Q-1 (gate-off behavior — needs operator ack):** When the feature is OFF,
  should the overlay **suppress** child-thread events (cleaner parity, but a
  behavior change to the shipped top-level path) or **keep today's flatten**?
  Recommendation: suppress.
- **Q-2 (cuid2 minting):** Which crate/impl generates a cuid2 in the overlay? The
  app strictly requires `subagent` to be a cuid2 (`sessionProtocol.ts:140`),
  while envelope `id` is unconstrained. Needs a small dep or vendored generator;
  confirm the format passes `isCuid`.
- **Q-3 (is `ThreadStarted` delivered to the tap for auto-attached subagent
  threads, or only their item/turn notifications?):** `inbound.rs:181`'s comment
  assumes subagent threads produce a `thread/started` with `parent_thread_id`,
  but this is unverified for the in-process auto-attach path
  (`in_process.rs:490-501`). If not delivered, registration relies on the
  fallback (first non-primary item/turn) — the design already covers both.
- **Q-4 (synthetic parent tool-call rendering):** Does an `Agent`/`Task`
  tool-call with **no** matching `tool-call-end`/result render cleanly in
  TaskView (or spin forever)? Is `name: "Agent"` or `"Task"` the better label?
  Validate against `reducerTracer` + TaskView before ship.
- **Q-5 (nesting depth):** The fork gates `spawn_agent` from
  `SessionSource::SubAgent(_)` sessions (top-level-only) and v1 depth-strips, so
  practical nesting is **depth-1** for the v1 default; v2 can go deeper. Scope
  depth-1 first; confirm grandchildren are out of scope for v1.
- **Q-6 (child result surfacing):** The child's final `AgentMessage` flows as a
  child-thread ItemCompleted (Q1/Q2) and, once tagged, nests under the parent
  tool-call — but confirm `map_item_completed` (`mapping.rs:107`) produces a
  readable Text envelope for the child (it should, same code path, just tagged).
