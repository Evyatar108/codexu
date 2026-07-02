# Stories outline — `codex-happy-subagent-sessions-in-app`

Maps brainstorm milestones **M-A … M-H** to implementation stories. All work is
**codex-overlay-only** (see `plan.md` §6). Complexity: **S** ≈ <½ day,
**M** ≈ ½–1 day, **L** ≈ 1–2 days. Suggested order = US-001 → US-008 (US-007 is
deferred; not required for the feature to ship).

---

## US-001 — Register `Feature::RemoteSubagentSessions` (M-A)

**As** the fork, **I want** a default-off experimental feature gate **so that**
sub-agent sidechains stay inert in vanilla codex and opt-in via `/experimental`
or `-c features.remote_subagent_sessions=true`.

**Files:** `external/repos/codex-patched/codex-rs/features/src/lib.rs`
(enum variant after `RemoteAutoAttach` `:189`; `FeatureSpec` after the
`RemoteAutoAttach` spec ~`:1123`), `features/src/tests.rs` (~`:233-300`).

**ACs:**
- `Feature::RemoteSubagentSessions` enum variant exists with a `// SANDBOX PATCH: remote_subagent_sessions` marker + doc-comment (mirrors `RemoteSession`).
- `FeatureSpec { key: "remote_subagent_sessions", stage: Stage::Experimental { name: "Remote sub-agent sessions", menu_description, announcement }, default_enabled: false }`.
- `is_known_feature_key("remote_subagent_sessions") == true` (strict config accepts `-c features.remote_subagent_sessions=…` with **no** `strict_config.rs` edit).
- `fork_visibility_features_are_experimental_and_disabled_by_default` extended with the new tuple and passing.

**Complexity:** S. **Depends on:** none.

---

## US-002 — Child registry + deterministic cuid2 in `ControlState` (M-B)

**As** the overlay, **I want** to recognize non-primary child threads and mint a
stable `subagent` id **so that** child envelopes can be tagged and nested.

**Files:** `codex-rs-overlay/codex-happy/src/inbound.rs` (+ `inbound_tests.rs`).

**ACs:**
- `ControlState` gains `children: HashMap<String, ChildThread>` where `ChildThread { subagent_id: String, announced: bool, label: Option<String> }`, plus a `subagent_sessions: SubagentSessions` enum field (`{ Enabled, Disabled }`; **not** a bool — codex AGENTS.md "avoid bool params"). `Default` keeps `Disabled`.
- `observe()` registers a child on `ThreadStarted` where `thread.parent_thread_id.is_some()`, keyed by `thread.id`, capturing `thread.preview` as `label`.
- **Fallback:** `observe()` registers a child the first time an Item/Turn notification carries a non-primary, unregistered `thread_id` (covers Q-3), with `label: None`.
- `subagent_id` is minted via `sha256(thread_id)` → lowercase hex → first 24 chars (optionally `"s"`-prefixed to 24). **Stable** across re-registration of the same `thread_id`.
- New helpers: `register_child`, `child_subagent(thread_id) -> Option<&str>`, `is_primary` (existing) usable for the child/primary decision.
- Registration is **gated**: when `subagent_sessions == Disabled`, `observe()` does not register children (so suppression is total).

**Complexity:** M. **Depends on:** US-001 (uses the gate value, but can be built with a local enum first).

---

## US-003 — Thread-aware `map_event` / `envelope` (M-C)

**As** the overlay, **I want** the mapper to tag envelopes by thread **so that**
child events carry `subagent = <cuid2>` while parent events keep `subagent: None`.

**Files:** `codex-rs-overlay/codex-happy/src/mapping.rs` (+ `mapping_tests.rs`).

**ACs:**
- Signature becomes `map_event(event: &AppServerEvent, control: &ControlState) -> Vec<SessionEnvelope>` (immutable borrow).
- `envelope()` gains a `subagent: Option<String>` argument; the hardcoded `subagent: None` (~`:186`) is removed. `map_notification`/`map_item_started`/`map_item_completed` thread the resolved value down.
- Primary-thread envelope → `subagent: None` (byte-identical to today).
- Registered-child envelope → `subagent: Some(<child cuid2>)`.
- Child-thread **turn-boundary** notifications produce **no** turn-boundary envelope (suppressed); only child item envelopes are emitted, tagged with the child cuid2 (Risk R2c).
- Every emitted envelope carries a valid `turn` id (never dropped by the app's no-turn filter).
- `mapping_tests.rs` updated to the new signature; tests cover primary vs child tagging and Q-6 (child `AgentMessage` → readable Text envelope with the child cuid2).

**Complexity:** M. **Depends on:** US-002.

---

## US-004 — Synthetic `Agent` parent tool-call (M-D)

**As** the app, **I want** an anchor tool-call named `Agent` carrying
`input.sessionSubagent` **so that** subsequent `subagent`-tagged envelopes nest
under it.

**Files:** `codex-rs-overlay/codex-happy/src/inbound.rs` (announcement queue +
`take_pending_child_announcements`), `attach.rs` (prepend at drain), `wire.rs`
(no change — `ToolCallStart` shape reused), `mapping_tests.rs`.

**ACs:**
- Exactly **one** synthetic `SessionEnvelope` per child: `role: Agent`, `turn: <primary active turn id>`, `subagent: None`, `ev: ToolCallStart { name: "Agent", args: { prompt: <label|"subagent">, sessionSubagent: <child cuid2>, subagent_type: "subagent" }, permission_request_id: None }`.
- `control.take_pending_child_announcements()` returns each newly-registered child once (flips `announced`), and never twice.
- The synthetic parent is emitted **before** that child's first tagged envelope (ordering test).
- When `active_turn_id()` is `None` at registration, the announcement is **deferred** (never emitted with a null turn) and fires on the next drain once a primary turn is active (Risk R2b).
- No matching tool-call-end is emitted (documented; verified renderable in AC-9 / US-006 note).

**Complexity:** M. **Depends on:** US-002, US-003.

---

## US-005 — Gate plumbing + both drain sites (M-E)

**As** the overlay, **I want** the feature boolean threaded from the TUI seam
into `ControlState` **so that** the gate controls tagging/suppression, and both
drain sites behave identically.

**Files:** `external/repos/codex-patched/codex-rs/tui/src/app.rs` (one param read,
inside the existing `remote_session` SANDBOX PATCH block, marked
`// SANDBOX PATCH: remote_subagent_sessions`), `codex-rs-overlay/codex-happy/src/attach.rs`
(AttachParams field + `ControlState` construction at `:232` + both drain sites
~`:271-275` and ~`:395-401`).

**ACs:**
- `app.rs` reads `config.features.enabled(Feature::RemoteSubagentSessions)` at the attach seam (~`:1034-1038`) and passes the boolean into `AttachParams`.
- `AttachParams` gains an overlay-owned gate field; `ControlState` is constructed with `SubagentSessions::{Enabled|Disabled}` accordingly (was `ControlState::default()` at `:232`).
- **Both** drain sites call `map_event(&event, &control)` and prepend `control.take_pending_child_announcements()` output — symmetric edits.
- With the gate ON, a child thread produces a synthetic `Agent` parent + tagged child envelopes; with the gate OFF, neither (see US-006).
- The one upstream `app.rs` line + the `features` edits carry `// SANDBOX PATCH: remote_subagent_sessions`.

**Complexity:** M. **Depends on:** US-001, US-002, US-003, US-004.

---

## US-006 — Gate-OFF suppression (M-F)

**As** the operator, **I want** child events **suppressed** (not flattened) when
the feature is OFF **so that** the default parent transcript shows only its own
events. *(Operator-accepted behavior change vs. today's flatten.)*

**Files:** `codex-rs-overlay/codex-happy/src/mapping.rs` +
`inbound.rs` (gating), `mapping_tests.rs`.

**ACs:**
- Gate `Disabled` AND thread non-primary → `map_event` returns `Vec::new()` (no child envelope reaches the wire).
- Gate `Disabled` → no child registration, so `take_pending_child_announcements()` is always empty ⇒ no synthetic parent.
- Gate `Disabled` → primary-thread envelopes are **byte-identical** to the pre-feature output (`subagent: None`), confirming zero regression to top-level auto-attach.
- Test asserts a child Item notification yields empty output when OFF and a tagged envelope when ON.

**Complexity:** S. **Depends on:** US-003, US-005.

---

## US-007 — *(DEFERRED)* agent_path label enrichment (M-G)

**As** a user, **I'd like** the sidechain labeled with the child's agent name/path
**so that** multiple sub-agents are distinguishable.

**Status:** **Deferred — not built in v1.** The only human text at child
registration is `Thread.preview`; `agent_path` arrives later per-item on v2
`SubAgentActivity`, and v1 spawn events are dropped at the app-server
(`bespoke_event_handling.rs:846-853`). v1 ships with the `"subagent"` fallback +
`preview`. Documented here so it is not silently lost.

**Follow-up ACs (when built):** enrich the synthetic parent's `prompt`/title from
the first `SubAgentActivity.agent_path` for the child's `thread_id`, without a
second synthetic parent (update in place or defer emission until the label is
known).

**Complexity:** M (deferred). **Depends on:** US-004.

---

## US-008 — Invariant 74 + patch-surface + build gate (M-H)

**As** the fork, **I want** a rebase guard + docs **so that** the feature survives
upstream rebases and the invariant table stays authoritative.

**Files:** `codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs`,
`codex/docs/implementation/patch-surface.md` (§14 + §15),
`external/repos/codex-patched/codex-rs/features/src/tests.rs` (if not already
covered by US-001).

**ACs:**
- `invariant_74_remote_subagent_sessions_feature_is_experimental_and_default_off` added, mirroring invariant 55: asserts `!default_enabled`, `Stage::Experimental`, `key == "remote_subagent_sessions"`.
- patch-surface §14 gains **row 74** (enforcement type + test command + break-and-verify columns, following the row-55/row-73 template).
- patch-surface §15 gains a "`remote_subagent_sessions` seam replant" note listing the `features/src/lib.rs`, `features/src/tests.rs`, and `tui/src/app.rs` upstream-canonical edits to re-apply on rebase.
- Build gate green: `cargo check --workspace`; `just test -p codex-happy`; `just test -p codex-features fork_visibility_features_are_experimental_and_disabled_by_default`; `just test -p codex-invariant-tests --test happy_seam_invariants`; `just fmt` no-diff; `bash scripts/audit_network_calls.sh` green.
- Scope check: `git diff` touches no `packages/happy-{app,wire,server}` file; wire drift-guard (invariant 58) green.

**Complexity:** M. **Depends on:** US-001 … US-006.

---

### Story count

**8 stories (US-001 … US-008)** mapping M-A … M-H one-to-one. **US-007 (M-G) is
deferred** — the shippable v1 is **7 built stories** (US-001..US-006 + US-008).
