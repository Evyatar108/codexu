# Plan — `codex-happy-subagent-sessions-in-app`

> Make v1/v2 multi-agent **SUB-sessions** (`spawn_agent` children) appear in the
> Happy app as **nested sidechains** under their parent, extending the shipped
> top-level auto-attach. Builds directly on brainstorm **D-001**
> (`.ralph/brainstorms/codex-happy-subagent-sessions-in-app/selected-direction.md`),
> milestones **M-A … M-H**. The brainstorm's core finding — verified below — is
> that this is **OVERLAY-ONLY**: the Happy app/wire/server already render
> sidechains; codex just has to tag child-thread envelopes with a `subagent` id
> and emit one synthetic parent tool-call to anchor the nest.

**Worktree / repo:** this is a **codex submodule** change. Every source edit
lands inside `codex/` — the bulk in the fork-exclusive overlay
`codex-rs-overlay/codex-happy/` (+ `codex-rs-overlay/codex-invariant-tests/`),
one small feature registration in
`external/repos/codex-patched/codex-rs/features/`, and one minimal
upstream-canonical param-add at the existing attach seam in
`external/repos/codex-patched/codex-rs/tui/src/app.rs`. **Two-commit submodule
flow:** commit inside the `codex-patched` submodule first (the `codex-rs/...`
edits + `Cargo.lock` if it moves), then bump the `codex/` wrapper gitlink; the
codexu parent records only the resulting `codex` pointer bump. **Do NOT edit any
`CLAUDE.md`** (gitignored in codexu; the codex `CLAUDE.md` is read-only context).

---

## 1 · Overview & goal

The shipped `Feature::RemoteSession` + `RemoteAutoAttach` stack tees every
in-process `AppServerEvent` to a Happy session and, at the app-server layer,
**auto-attaches a listener to every new thread — including `spawn_agent`
children** (`app-server/src/in_process.rs` `thread_created_rx`). Today those
child events flow through the overlay's **thread-blind** mapper
(`mapping.rs`), which hardcodes `subagent: None` on every `SessionEnvelope`, so a
child agent's exec/patch/message items **flatten into the parent transcript**
instead of nesting.

The Happy app already knows how to render a nested "sidechain" whenever an
envelope carries `subagent = <cuid2>` **and** a parent tool-call named `Task` or
`Agent` carries that same id in `input.sessionSubagent` (proven below — do NOT
change the app). So the entire feature is: teach the overlay to (a) recognize
non-primary child threads, (b) mint a stable `subagent` id per child, (c) tag
that child's envelopes with it, and (d) emit one synthetic `Agent` tool-call on
the parent turn to anchor the nest — all behind a new default-off experimental
`Feature::RemoteSubagentSessions`.

### Operator decisions baked in (do NOT re-open)

1. **Gate-OFF = SUPPRESS (M-F).** When `Feature::RemoteSubagentSessions` is OFF
   (the default), the overlay **suppresses all non-primary-thread (child)
   envelopes entirely** — the parent transcript shows only its own events. This
   is a deliberate, operator-accepted **behavior change** from today's shipped
   flatten (where child events flatten into the parent with `subagent: None`).
   ON → children appear as nested `Agent` sidechains.
2. **Synthetic-parent label = `Agent`** (M-D), not `Task`. The app's
   `isSubagentToolCall` accepts `name ∈ {Task, Agent}`; we use `Agent`.
3. **cuid2 (M-C) = DETERMINISTIC mapping** — `sha256(thread_id)` → lowercase hex
   → truncate to 24 chars (with an optional fixed leading-letter prefix). Both
   approaches evaluated in §8; deterministic is recommended (zero new deps +
   idempotent).
4. **Scope = CODEX-OVERLAY-ONLY.** No change to `packages/happy-app`,
   `packages/happy-wire`, or `packages/happy-server`.

---

## 2 · Research findings (verified file:line, read-only)

All paths below are relative to `codex/` unless noted. Line numbers verified this
session against the current worktree; treat as *anchors* (may drift a few lines).

### 2.1 The overlay mapper is thread-blind and hardcodes `subagent: None` (the core gap)

- `codex-rs-overlay/codex-happy/src/mapping.rs`
  - `map_event(event: &AppServerEvent) -> Vec<SessionEnvelope>` (~`:55`) — a
    **pure free function** that dispatches per-notification.
  - `map_notification(...)` (~`:69`), `map_item_started` (~`:95`),
    `map_item_completed` (~`:107`) — all read only **turn** ids
    (`n.turn.id` / `n.turn_id`), **never** `thread_id`.
  - `envelope(turn, ev)` (~`:180`) constructs every `SessionEnvelope` with
    **`subagent: None` hardcoded** (~`:186`; brainstorm said `:184` — small
    drift). This is the single line that must become thread-aware.
  - Sibling unit-test file `mapping_tests.rs` calls `map_event(&event)` directly;
    fixtures already build `Turn`/`ThreadItem` shapes we can reuse.

### 2.2 `ControlState` already tracks the primary thread + turns — the natural home for a child registry

- `codex-rs-overlay/codex-happy/src/inbound.rs`
  - `struct ControlState` (~`:92`, `#[derive(Default)]`) holds
    `primary_thread_id: Option<String>` + active-turn tracking.
  - `observe(&mut self, event: &AppServerEvent)` (~`:113`) is the state-derivation
    hook already called at BOTH drain sites; it matches:
    `ThreadStarted → lock_primary_if_root` (~`:118`), `TurnStarted → adopt_thread`
    + set active turn (~`:122`), `TurnCompleted` (~`:128`),
    `ItemStarted/ItemCompleted → adopt_thread` (~`:133`).
  - Helpers: `adopt_thread` (~`:171`), `lock_primary_if_root` (~`:181`),
    `is_primary(thread_id)` (~`:196`), `active_turn_id()` (~`:107`), plus a
    `fresh_request_id` using `Uuid::new_v4()`.
  - **CRITICAL (verified `:122-133`):** `active_turn_id` is **already
    primary-scoped** — `TurnStarted` sets it **only** when
    `self.is_primary(&n.thread_id)`, and `TurnCompleted` clears it **only** for
    the primary thread. So a child thread's own `TurnStarted`/`TurnCompleted`
    does **not** clobber the primary active turn. The synthetic parent (M-D) can
    therefore safely anchor on `active_turn_id()` — but see the idle-primary
    edge in §3 step 4 / Risk R2b.
  - Sibling `inbound_tests.rs` already has `turn_started(thread_id, turn_id)` and
    `item_started(thread_id)` fixtures **parameterized by `thread_id`** — ideal for
    exercising non-primary child registration.

### 2.3 The two drain sites where `map_event` is called (both must change symmetrically)

- `codex-rs-overlay/codex-happy/src/attach.rs`
  - `use crate::mapping::map_event;` (~`:60`).
  - **Pre-connect buffer path:** `control.observe(&event)` (~`:271`) then
    `push_bounded(&mut buffer, map_event(&event))` (~`:275`).
  - **Connected path:** `control.observe(&event)` (~`:395`) then
    `for envelope in map_event(&event) { … }` (~`:401`).
  - `control` (a `ControlState`) is in scope at BOTH sites — so a thread-aware
    `map_event(&event, &control)` and a post-observe
    `control.take_pending_child_announcements()` both work at each site.
  - `ControlState::default()` is constructed at ~`:232`; `session_tag()` at ~`:746`.
  - `AttachParams` is an **overlay-owned** struct (zero upstream surface) — the
    feature-gate flag can be threaded through it with no conflict cost.

### 2.4 The wire type already has the field — NO wire change

- `codex-rs-overlay/codex-happy/src/wire.rs`
  - `SessionEnvelope { id, time, role, turn, subagent: Option<String>, ev }` — the
    `subagent` field **already exists** and is already serialized. Setting it is
    the whole outbound change.
  - `SessionEvent::ToolCallStart { call, name, title, description, args: Map<String,Value>, permission_request_id }` — the shape used for the synthetic
    parent tool-call. `args` is a free-form JSON map, so
    `{ "prompt": <label>, "sessionSubagent": <cuid2>, "subagent_type": "subagent" }`
    fits with no schema change.
  - `codex-rs-overlay/codex-happy/Cargo.toml` already depends on **`sha2`** and
    `uuid` → the deterministic cuid2 helper needs **zero new deps**.

### 2.5 The app-server auto-attaches a listener to every child thread (why child events already flow)

- `external/repos/codex-patched/codex-rs/app-server/src/in_process.rs` (~`:490-501`)
  — a `thread_created_rx` loop calls `try_attach_thread_listener(thread_id, …)`
  for **every** newly created thread, including `spawn_agent` children. So the
  child's `ItemStarted`/`ItemCompleted`/`TurnStarted`/`TurnCompleted`
  notifications **already reach the overlay tap**, each tagged with the child's
  `thread_id`. **No edit** — this is the delivery guarantee the design relies on.

### 2.6 v1 Collab spawn events are dropped at the app-server → design keys off `thread_id`, not the spawn event

- `external/repos/codex-patched/codex-rs/app-server/src/bespoke_event_handling.rs`
  (~`:846-853`) — v1 `CollabAgent*` spawn events hit a catch-all no-notification
  arm (dropped). v2 `MultiAgentV2` emits `SubAgentActivity` items
  (`app-server-protocol/.../item.rs:349-354`, carrying `agent_thread_id` +
  `agent_path`). **Both** engines create a real child **thread** whose Item/Turn
  notifications flow tagged with `thread_id`. Keying registration off the child
  `thread_id` (not the version-specific spawn event) makes the feature
  **v1/v2-agnostic** with one code path. **No edit** to either handler.

### 2.7 Notification structs all carry `thread_id` (and `parent_thread_id` on `Thread`)

- `external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/`
  - `ItemStartedNotification { item, thread_id }`,
    `ItemCompletedNotification { item, thread_id }`,
    `TurnStartedNotification { thread_id, turn }`,
    `TurnCompletedNotification { thread_id, turn }`.
  - `ThreadStartedNotification { thread: Thread }`; `Thread { id, parent_thread_id: Option<String>, preview, … }`.
  - `SubAgentActivity { agent_thread_id, agent_path, … }` (item.rs `:349-354`).
  - **All cite-only.** The mapper can read `thread_id` off every relevant
    notification; `parent_thread_id.is_some()` positively identifies a child at
    `ThreadStarted`.

### 2.8 The app already renders sidechains from `subagent` — CONFIRM ONLY, DO NOT CHANGE

- `packages/happy-wire/src/sessionProtocol.ts` (~`:138-143`) — `subagent` is
  `z.string().refine(isCuid).optional()`. `isCuid` (`@paralleldrive/cuid2`)
  validates **`^[0-9a-z]+$` AND length 2..=32**. (`sessionProtocol.test.ts:221`
  rejects `'provider-tool-id'` because of the hyphen — confirming the charset
  constraint.)
- `packages/happy-app/sources/sync/typesRaw.ts`
  - (~`:522-523`) `parentUUID = envelope.subagent ?? null; isSidechain = parentUUID !== null`.
  - (~`:645-656`) `tool-call-start` normalizes `input := envelope.ev.args`.
  - (~`:517-519`) agent-role envelopes **without a `turn` are DROPPED** (except
    a couple of control events) → the synthetic parent **and** every child
    envelope MUST carry a valid `turn` id.
- `packages/happy-app/sources/sync/reducer/reducerTracer.ts`
  - (~`:121-128`) `getToolCallParentIds` reads `content.input.sessionSubagent`.
  - (~`:130-132`) `isSubagentToolCall` = `name ∈ {Task, Agent}`.
- **Conclusion:** the app nests a sidechain iff (1) a tool-call named `Agent`
  carries `input.sessionSubagent = <cuid2>` and (2) subsequent envelopes carry
  `subagent = <same cuid2>`. Both are outbound-only overlay responsibilities.

### 2.9 The attach seam is REUSED — only one minimal upstream param-add

- `external/repos/codex-patched/codex-rs/tui/src/app.rs`
  - (~`:1034`) `happy_tap` is created gated on `Feature::RemoteSession`; (~`:1038`)
    `maybe_attach(AttachParams::new(…), request_handle)`; (~`:1254`) the tee
    `if let Some(tap) = … { tap.send(event.clone()); }`. All already carry
    `// SANDBOX PATCH: remote_session`.
  - The **only** new upstream-canonical edit: read
    `config.features.enabled(Feature::RemoteSubagentSessions)` at this existing
    seam and pass the boolean into the (overlay-owned) `AttachParams`. This is a
    param addition **inside the existing SANDBOX PATCH block** — it does not open
    a new seam. Marked `// SANDBOX PATCH: remote_subagent_sessions`.

### 2.10 Feature-registration convention to mirror (RemoteSession / RemoteAutoAttach)

- `external/repos/codex-patched/codex-rs/features/src/lib.rs`
  - Enum variant cluster: `RemoteSession` (`:177`), `LoopbackInject` (`:182`),
    `RemoteAutoAttach` (`:189`) — each preceded by a `// SANDBOX PATCH:` comment
    and a doc-comment.
  - `FeatureSpec` cluster: `RemoteSession` spec `:1085-1093` (`key: "remote_session"`,
    `Stage::Experimental { name, menu_description, announcement }`,
    `default_enabled: false`); `RemoteAutoAttach` spec `:1113-1123`.
  - `is_known_feature_key` (`:661`) is driven off the `FEATURES` specs, so adding
    a spec makes `-c features.remote_subagent_sessions=…` strict-config-valid with
    **no `config/src/strict_config.rs` edit**.
- `external/repos/codex-patched/codex-rs/features/src/tests.rs` —
  `fork_visibility_features_are_experimental_and_disabled_by_default` (expected
  tuple array ~`:233-300`) enumerates every fork feature; add one tuple.

### 2.11 Invariant test + patch-surface conventions

- `codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs`
  — `invariant_55_remote_session_feature_is_experimental_and_default_off`
  (~`:159-177`) is the exact model: assert
  `!Feature::RemoteSubagentSessions.default_enabled()`,
  `matches!(spec.stage, Stage::Experimental { .. })`, and `key == "remote_subagent_sessions"`.
- `codex/docs/implementation/patch-surface.md` — §14 invariant table's current
  **max row is 73**, so the new row is **74**. §15 gets a new
  "`remote_subagent_sessions` seam replant" note. remote_session rows are 54-59;
  remote_auto_attach rows are 71-73 (both good templates).

---

## 3 · Approach (overlay-only thread-aware sidechain nesting)

The design is entirely on the **outbound** side of the overlay and reuses the
already-shipped tap + auto-attach delivery. Six moving parts:

1. **Feature gate (M-A).** New default-off experimental
   `Feature::RemoteSubagentSessions` (`key: "remote_subagent_sessions"`),
   registered exactly like `RemoteSession`.

2. **Child registry in `ControlState` (M-B).** Add
   `children: HashMap<String /*thread_id*/, ChildThread>` where
   `ChildThread { subagent_id: String /*cuid2*/, announced: bool, label: Option<String> }`,
   plus a gate field `subagent_sessions: SubagentSessions` (an enum
   `{ Enabled, Disabled }` — **not** a bool param, per codex AGENTS.md "avoid
   bool params"). Registration happens **inside `observe()`** (the existing
   state-derivation hook):
   - On `ThreadStarted` where `thread.parent_thread_id.is_some()` → register the
     child keyed by `thread.id`, capturing `thread.preview` as the label.
   - **Fallback** (covers open-question Q-3): on the *first* Item/Turn
     notification whose `thread_id` is non-primary and unregistered → register it
     with no label. This makes the feature robust even if `ThreadStarted` is not
     delivered to the in-process tap for auto-attached children.
   - Minting the deterministic cuid2 (§8) happens at registration.

3. **Thread-aware mapping (M-C).** Change the signature to
   `map_event(event: &AppServerEvent, control: &ControlState) -> Vec<SessionEnvelope>`
   (immutable borrow). Read the notification's `thread_id`:
   - `control.is_primary(thread_id)` → `subagent: None` (unchanged behavior).
   - registered child → `subagent: Some(child.subagent_id.clone())`.
   - **Gate `Disabled` AND thread non-primary → return `Vec::new()` (SUPPRESS,
     M-F).**
   `envelope()` gains a `subagent: Option<String>` argument (drops the hardcoded
   `None`). `map_notification`/`map_item_*` thread the resolved `subagent` down.

4. **Synthetic parent `Agent` tool-call (M-D).** Emit **once per child**, on the
   PRIMARY active turn, to anchor the nest. To keep `map_event` an immutable
   borrow, the emission is driven from the drain loop, in this exact per-event
   order at BOTH drain sites:
   1. `control.observe(&event)` — may register a child (ThreadStarted-with-parent
      or the non-primary fallback).
   2. `let announcements = control.take_pending_child_announcements();` — returns
      the not-yet-announced children **that have a resolvable primary turn**
      (see the idle-primary rule below), flipping their `announced` flag.
   3. **Emit `announcements` FIRST**, then the `map_event(&event, &control)`
      output — so the synthetic parent always precedes that same event's
      child-tagged envelopes (Risk R3).
   Each announcement is a
   `SessionEnvelope { role: Agent, turn: <primary active turn id>, subagent: None,
   ev: ToolCallStart { name: "Agent", args: { prompt: <label|"subagent">,
   sessionSubagent: <child.subagent_id>, subagent_type: "subagent" },
   permission_request_id: None, … } }`. The **parent** envelope carries
   `subagent: None` (it belongs to the parent transcript); its
   `args.sessionSubagent` is what makes the app treat following `subagent`-tagged
   envelopes as its children. There is intentionally **no** matching
   tool-call-end (the sidechain has no defined "end" event) — see Risk R2 / AC-9.

   **Idle-primary edge (Risk R2b):** `active_turn_id()` returns `None` when the
   primary thread is idle. A synthetic parent with no `turn` would be **dropped**
   by the app (typesRaw.ts `:517`). In practice a child is spawned *during* a
   primary turn, so a turn is normally active — but to be robust,
   `take_pending_child_announcements()` **defers** any child whose primary turn is
   `None` (leaves `announced=false`, returns nothing for it) and re-offers it on
   the next drain once `active_turn_id()` is `Some`. This guarantees every
   synthetic parent carries a valid turn.

5. **Attach wiring + gate plumbing (M-E).** Thread the feature boolean from the
   `app.rs` seam (§2.9) into `AttachParams`, store it as the
   `SubagentSessions` enum in `ControlState` at construction (attach.rs `:232`),
   and update **both** drain sites (§2.3) to (a) call the new
   `map_event(&event, &control)` and (b) prepend
   `control.take_pending_child_announcements()` output. Symmetric edits at both
   sites.

6. **Gate-OFF suppression (M-F).** Default OFF ⇒ `SubagentSessions::Disabled` ⇒
   step 3 suppresses child envelopes and step 4 mints/announces nothing
   (announcements only fire when a child is registered, and registration is
   gated). Parent-thread envelopes are untouched.

**Deferred (M-G).** Richer child labels via `agent_path` (v2 `SubAgentActivity`)
— the only human text available at registration is `Thread.preview`; `agent_path`
arrives later on a per-item basis. v1 spawn events are dropped, so there is no
uniform early label source. Ship with the `"subagent"` fallback + `preview`; a
follow-up can enrich the synthetic parent's title/label from the first
`SubAgentActivity` if present. Explicitly out of scope for v1.

**Invariant + docs (M-H).** New overlay invariant test (mirrors invariant 55) +
patch-surface §14 row 74 + §15 replant note + `features/src/tests.rs` tuple.

---

## 4 · Exact files to create / modify

### MODIFY — overlay (`codex-rs-overlay/codex-happy/src/`, fork-exclusive, no upstream surface)

| File | Change |
|---|---|
| `inbound.rs` | Add `children: HashMap<String, ChildThread>` + `subagent_sessions: SubagentSessions` to `ControlState`; add `ChildThread`/`SubagentSessions` types; register children in `observe()` (ThreadStarted-with-parent + non-primary-thread fallback); add `register_child`, `child_subagent(thread_id)`, `take_pending_child_announcements()`, and a `subagent_id_for(thread_id)` mint helper (deterministic cuid2). Add a constructor that accepts the gate (keep `Default` = `Disabled`). |
| `mapping.rs` | Change `map_event(event, control)` signature; thread `subagent: Option<String>` through `map_notification`/`map_item_started`/`map_item_completed`/`envelope`; drop the hardcoded `None` at `envelope` (~`:186`); implement suppress-on-Disabled+non-primary. |
| `attach.rs` | Store the gate in `ControlState` at `:232`; update both drain sites (~`:271-275`, ~`:395-401`) to call `map_event(&event, &control)` and prepend `control.take_pending_child_announcements()`; add the gate field to `AttachParams` and read it from the params. |
| `wire.rs` | **No change** (field + `ToolCallStart` shape already present) — listed for confirmation only. |

### MODIFY — upstream-canonical (`external/repos/codex-patched/codex-rs/`, each edited line carries `// SANDBOX PATCH: remote_subagent_sessions`)

| File | Change |
|---|---|
| `features/src/lib.rs` | Add `Feature::RemoteSubagentSessions` enum variant (after `RemoteAutoAttach`, `:189`) + `FeatureSpec` (`key: "remote_subagent_sessions"`, `Stage::Experimental { name: "Remote sub-agent sessions", menu_description, announcement }`, `default_enabled: false`) in the `FEATURES` array (after the `RemoteAutoAttach` spec, ~`:1123`). |
| `features/src/tests.rs` | Add the `remote_subagent_sessions` tuple to `fork_visibility_features_are_experimental_and_disabled_by_default` (~`:233-300`). |
| `tui/src/app.rs` | At the existing attach seam (~`:1034-1038`), read `Feature::RemoteSubagentSessions` and pass the boolean into `AttachParams`. One param-add inside the existing `remote_session` SANDBOX PATCH block. |

### CREATE / MODIFY — overlay tests + docs (zero upstream-canonical surface)

| File | Change |
|---|---|
| `codex-rs-overlay/codex-happy/src/mapping_tests.rs` | Add tests: primary→`subagent:None`; registered child→`subagent:Some(cuid2)`; gate-Disabled non-primary→empty (suppress); synthetic parent carries `name:"Agent"` + `args.sessionSubagent` + a valid `turn`; child envelope reuses the same cuid2; child `AgentMessage` maps to a readable Text envelope (Q-6). |
| `codex-rs-overlay/codex-happy/src/inbound_tests.rs` | Add tests: `observe(ThreadStarted{parent_thread_id:Some})` registers a child; non-primary Item/Turn fallback registers; deterministic cuid2 is stable across re-registration; `take_pending_child_announcements` returns each child once. |
| `codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs` | Add `invariant_74_remote_subagent_sessions_feature_is_experimental_and_default_off` mirroring invariant 55. |
| `codex/docs/implementation/patch-surface.md` | Add §14 invariant **row 74**; add §15 "`remote_subagent_sessions` seam replant" note listing the `features/src/lib.rs`, `features/src/tests.rs`, and `tui/src/app.rs` edits. |

---

## 5 · Coexistence & do-not-regress

- **Top-level auto-attach unchanged when the sub-agent gate is OFF except for the
  operator-accepted suppression.** With `RemoteSubagentSessions` OFF (default),
  parent-thread envelopes map **identically** to today (`subagent: None`); the
  only difference is that child-thread envelopes are **suppressed** rather than
  flattened (M-F, operator-accepted). `RemoteSession`/`RemoteAutoAttach`
  attach/daemon/inbound paths are untouched.
- **`map_event` is called from exactly two sites** — both updated symmetrically;
  no third caller (`mapping_tests.rs` is updated to the new signature).
- **Every child + synthetic-parent envelope carries a `turn`** (the primary
  active turn id), so none are dropped by the app's no-turn filter
  (typesRaw.ts `:517`).
- **No new upstream seam.** The tap tee (app.rs `:1254`) and app-server
  auto-attach (`in_process.rs`) are reused unmodified; the only upstream edit is
  a param read inside the existing `remote_session` SANDBOX PATCH block +
  the feature registration.
- **Deterministic cuid2 ⇒ reattach-safe.** Re-registering the same `thread_id`
  (reconnect/replay) yields the same `subagent` id, so a reconnect never orphans
  an earlier sidechain.

---

## 6 · Scope

**In scope (all inside `codex/`):**
- `codex-rs-overlay/codex-happy/src/{inbound.rs, mapping.rs, attach.rs}` + their
  `*_tests.rs` siblings.
- `codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs`.
- `external/repos/codex-patched/codex-rs/features/src/{lib.rs, tests.rs}`.
- `external/repos/codex-patched/codex-rs/tui/src/app.rs` (one param read).
- `codex/docs/implementation/patch-surface.md` (§14 row + §15 note).

**Out of scope (hard):**
- **`packages/happy-app`, `packages/happy-wire`, `packages/happy-server` —
  ZERO changes.** The app/wire/server already render sidechains; touching them is
  a scope violation. The wire snapshot drift-guard (invariant 58) stays green.
- No new happy-server / transport / E2EE surface.
- No change to the app-server auto-attach or the v1/v2 spawn handlers.
- M-G (agent_path label enrichment) — deferred to a follow-up.
- Nesting depth > 1 (Q-5) — v1 scopes depth-1; deeper nesting deferred.

---

## 7 · cuid2 approach (M-C) — both evaluated; recommend DETERMINISTIC

The app requires `subagent` to satisfy `isCuid`: **`^[0-9a-z]+$` and length
2..=32** (sessionProtocol.ts `:138-143`). It does **not** require a "real" cuid2
or a leading letter. Two ways to produce a conforming id from a codex UUID
`thread_id`:

### Recommended — DETERMINISTIC mapping (`sha256(thread_id)` → hex → 24 chars)
```
subagent_id = &hex(sha256(thread_id.as_bytes()))[..24]   // optional: "s" + [..23]
```
- **Zero new dependencies** — `sha2` is already a `codex-happy` dependency; hex
  via std `format!("{:02x}", b)`. No Cargo.lock / MODULE.bazel.lock churn in the
  submodule.
- **Idempotent** — same `thread_id` ⇒ same id, so reattach/replay/re-registration
  never orphans a prior sidechain (directly satisfies the reattach-safety goal).
- **Format-valid** — hex ⊂ `[0-9a-z]`, length 24 ≤ 32 ⇒ passes `isCuid`. (Hex
  first char can be `0-9`; `isCuid` allows it. An optional fixed leading letter —
  e.g. `"s"` + 23 hex chars — makes it *look* like a real cuid2 without changing
  validity; recommended as a cosmetic belt-and-suspenders.)
- **Collision-safe** — 24 hex chars = 96 bits; the handful of subagents per
  session make collision probability negligible.

### Rejected — RANDOM (add `cuid2`/`nanoid` crate, or use workspace `rand`)
- New crate ⇒ Cargo.lock churn **inside the submodule** + a
  `just bazel-lock-update` (MODULE.bazel.lock) step + extra rebase-conflict
  surface.
- **Not idempotent** — a re-registration mints a fresh id ⇒ the app would render
  a *new* orphaned sidechain on reconnect/replay.
- The only nominal advantage (produces a "genuine" cuid2) is **irrelevant** — the
  app validates format only.

**Recommendation: deterministic `sha256`→hex→24 (optionally `"s"`-prefixed).**

---

## 8 · Risk areas

- **R1 — `ThreadStarted` may not reach the in-process tap for auto-attached
  children (Q-3).** *Mitigation:* the fallback registration path (first
  non-primary Item/Turn notification) makes the feature correct regardless. Both
  paths are unit-tested. Impl member should still confirm which path actually
  fires at runtime and note it.
- **R2 — Synthetic `Agent` tool-call has no matching tool-call-end.** The app
  must render it as a stable, non-spinning parent in `TaskView`. *Mitigation:*
  **impl-time verification AC (AC-9)** — pair a codex session driving a real
  `spawn_agent` child with the Happy app and confirm the sidechain renders and
  does not spin. If it spins, options: emit a terminal marker or a synthetic
  tool-call-end (still overlay-only) — but **do not** change the app.
- **R2b — Synthetic parent emitted while the primary is idle (`turn == None`).**
  Would be dropped by the app's no-turn filter. *Mitigation:* the announcement
  drainer **defers** any child until `active_turn_id()` is `Some`, so the
  synthetic parent always carries a valid primary turn (§3 step 4). Unit-tested.
- **R2c — Child turn-boundary envelopes.** A child thread's own
  `TurnStarted`/`TurnCompleted` would map to turn-boundary `SessionEvent`s tagged
  `subagent: Some(cuid2)`, possibly rendering an odd nested "turn divider" in the
  sidechain. *Mitigation / decision:* **suppress child turn-boundary envelopes**
  — for non-primary threads, `map_notification` emits only item envelopes
  (ItemStarted/ItemCompleted → exec/patch/message), not turn boundaries. The
  sidechain is anchored solely by the synthetic `Agent` parent, not by child turn
  boundaries. Impl confirms the app renders cleanly either way; suppression is the
  safe default.
- **R3 — Envelope ordering.** The synthetic parent MUST be delivered **before**
  the first child-tagged envelope, or the app has no parent to nest under.
  *Mitigation:* `take_pending_child_announcements()` runs right after `observe()`
  and its output is **prepended** at each drain site, so the announcement
  precedes that same event's child envelopes. Unit-test the ordering.
- **R4 — Two drain sites drift.** *Mitigation:* both are edited in the same story
  (M-E) with a shared helper; a mapping test asserts identical behavior for the
  buffered vs connected path shape.
- **R5 — Gate plumbing regresses top-level attach.** *Mitigation:* the gate is an
  additive `AttachParams` field defaulting to `Disabled`; when OFF the parent
  path is byte-identical to today (verified by a "primary→subagent:None" test).
- **R6 — Rebase drift on the one upstream `app.rs` param-add + `features` edits.**
  *Mitigation:* SANDBOX PATCH markers + patch-surface §14 row 74 + §15 replant
  note + the invariant test are the rebase guard.

---

## 9 · Open questions (non-blocking — v1 proceeds with the stated default)

- **Q-3:** Is `ThreadStarted` delivered to the in-process tap for auto-attached
  subagent threads, or only Item/Turn notifications? *Design covers both via the
  fallback path; confirm at impl.*
- **Q-4:** Does the synthetic `Agent` tool-call (no tool-call-end) render cleanly
  in `TaskView`? *Impl-time verification AC-9.*
- **Q-5:** Nesting depth. v1 is practically depth-1 (the fork gates `spawn_agent`
  from SubAgent sessions). *Scope depth-1 first; deeper nesting deferred.*
- **Q-6:** Does `map_item_completed` yield a readable Text envelope for a child's
  final `AgentMessage` once tagged? *Same code path as the parent; add a unit
  test (AC-8).*

---

## 10 · Build / verify plan (codex submodule)

Run from `codex/external/repos/codex-patched/codex-rs`:

1. **Workspace-parse preflight** (before editing):
   `cargo metadata --no-deps --format-version 1` — non-zero signals an inherited
   overlay-coordination gap, not your edits.
2. **Typecheck gate (Phase-5a, ~6 min):** `cargo check --workspace`. Must be
   clean before any push. (`cargo build --release` is deferred to CI.)
3. **Focused tests (use `just`, not raw `cargo test`):**
   - `just test -p codex-happy` (mapping + inbound unit tests).
   - `just test -p codex-features fork_visibility_features_are_experimental_and_disabled_by_default`.
   - `just test -p codex-invariant-tests --test happy_seam_invariants` (invariant 74).
4. **Format changed files only:** `just fmt` (rustfmt). Do not reformat unrelated
   files.
5. **Audit guards:** `bash scripts/audit_network_calls.sh` and, if present in the
   overlay flow, `bash scripts/audit_invariants.sh` — must stay green (no new
   egress; invariant table consistent).
6. **Two-commit submodule flow:** commit the `codex-rs/...` + `codex-rs-overlay/...`
   + `docs/...` edits (and `Cargo.lock` if it moved — it should NOT, deterministic
   approach adds no deps) **inside the `external/repos/codex-patched` submodule
   first**, then bump the `codex/` wrapper gitlink. The codexu parent records only
   the `codex` pointer bump. **Do NOT `git add` any `CLAUDE.md`.**

---

## 11 · Acceptance criteria (verifiable)

- **AC-1 (M-A):** `Feature::RemoteSubagentSessions` exists, `key == "remote_subagent_sessions"`, `Stage::Experimental`, `default_enabled == false`; strict config accepts `-c features.remote_subagent_sessions=true` with no `strict_config.rs` edit. *(features tests + invariant 74)*
- **AC-2 (M-B):** `observe(ThreadStarted{ parent_thread_id: Some })` registers a child keyed by `thread.id` with a minted cuid2 and the `thread.preview` label. *(inbound_tests)*
- **AC-3 (M-B fallback):** A non-primary `thread_id` first seen on an Item/Turn notification (no prior `ThreadStarted`) is registered. *(inbound_tests)*
- **AC-4 (M-C):** `map_event(&event, &control)` tags a primary-thread envelope `subagent: None` and a registered-child envelope `subagent: Some(<same cuid2>)`. *(mapping_tests)*
- **AC-5 (M-C cuid2):** The minted id satisfies `^[0-9a-z]+$` and length 2..=32, and is **stable** across re-registration of the same `thread_id`. *(inbound_tests)*
- **AC-6 (M-D):** Exactly one synthetic `SessionEnvelope` per child, role `Agent`, `ev.name == "Agent"`, `ev.args.sessionSubagent == <child cuid2>`, carrying the **primary active turn** id, delivered **before** that child's first tagged envelope. *(mapping_tests ordering test)*
- **AC-6b (R2b):** When `active_turn_id()` is `None` at child registration, the synthetic parent is **deferred** (not emitted with a null turn) and is emitted on the next drain once a primary turn is active. *(unit test)*
- **AC-6c (R2c):** Child-thread turn-boundary notifications do **not** produce turn-boundary envelopes; only child item envelopes (exec/patch/message) are emitted, each tagged with the child cuid2. *(mapping_tests)*
- **AC-7 (M-F):** With the gate OFF (default), any non-primary-thread event yields an **empty** envelope vector (suppressed) and no synthetic parent is emitted; primary-thread events are byte-identical to today's `subagent: None` output. *(mapping_tests)*
- **AC-8 (Q-6):** A child thread's final `AgentMessage` maps to a readable Text `SessionEnvelope` tagged with the child cuid2. *(mapping_tests)*
- **AC-9 (Q-4, impl-time manual verification):** Driving a real `spawn_agent`
  child in a live codex session with the feature ON, the Happy app renders the
  child as a nested `Agent` sidechain under the parent in `TaskView`, and the
  synthetic parent tool-call (no tool-call-end) does **not** spin indefinitely.
  Record the result in the job dir.
- **AC-10 (M-H):** `happy_seam_invariants.rs::invariant_74_*` passes; patch-surface
  §14 has row 74 and §15 has the replant note; `features/src/tests.rs` tuple
  present.
- **AC-11 (scope):** `git diff` touches **no** file under `packages/happy-app`,
  `packages/happy-wire`, or `packages/happy-server`; the wire drift-guard
  (invariant 58) stays green.
- **AC-12 (build gate):** `cargo check --workspace` clean; the three focused
  test commands green; `just fmt` leaves no diff on changed files;
  `audit_network_calls.sh` green.

---

## 12 · Milestone → story map

See `stories-outline.md`. Summary:

| Milestone | Story | Gist |
|---|---|---|
| M-A | US-001 | Register `Feature::RemoteSubagentSessions` (default-off experimental) |
| M-B | US-002 | Child registry + deterministic cuid2 mint in `ControlState` |
| M-C | US-003 | Thread-aware `map_event`/`envelope` (tag child, drop hardcoded `None`) |
| M-D | US-004 | Synthetic `Agent` parent tool-call, once per child, on primary turn |
| M-E | US-005 | Gate plumbing (app.rs read → AttachParams → ControlState) + both drain sites |
| M-F | US-006 | Gate-OFF suppression of non-primary-thread envelopes |
| M-G | US-007 | *(Deferred)* agent_path label enrichment — documented, not built in v1 |
| M-H | US-008 | Invariant 74 + patch-surface §14/§15 + features tuple + build gate |
