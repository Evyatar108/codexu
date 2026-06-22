# Research Brief — codex-autoconnect-e2e-conversation-simulation-harness (TIER 1)

## Researcher Findings (precise API map, primary checkout `D:/harness-efforts/codexu`)

All source is in the codex submodule overlay crate `codex/codex-rs-overlay/codex-happy/`.

### attach.rs (the heart)
- `run_attach(params, request_handle: AppServerRequestHandle, mut rx: UnboundedReceiver<AppServerEvent>)` — private async, lines 141-145.
- `establish(params) -> Option<(SessionClient, UnboundedReceiver<InboundEvent>)>` — lines 251-286; handoff at 283-286 (`SessionClient::new` → `connect()` → `start_smart_reconnect()`).
- **Extraction seam:** steady-state `tokio::select!` loop begins at line 193 (after the establish/pre-connect-drain loop ends at ~176 and the post-establish setup at 178-188). `run_attach_core` extracts from ~178/190 → end (245).
- Helpers taking `&AppServerRequestHandle` (all become generic `<H>`): `handle_inbound` (291-331), `enqueue_or_drive_turn` (333-347), `flush_pending_turns` (349-361), `drive_turn` (363-386), `start_turn` (388-397), `handle_permission` (402-433), `handle_abort` (437-450), `cancel_pending_approvals` (454-469).
- `send_envelope(client, envelope)` (485-492) → `client.send_session_message(&body)` (encrypt + POST /v3).
- **request_handle methods used (the trait surface):** `request_typed::<TurnSteerResponse>` (374), `request_typed::<TurnStartResponse>` (393), `resolve_server_request` (421-423, 461-463), `request` (445-446). NO `reject_server_request` used in attach.rs.

### session.rs
- `InboundEvent` enum (100-117): `UserMessage(UserMessage)`, `Consumption(SessionEvent)`, `Rpc { method: String, params: Value }`, `Other(Value)`.
- `SessionConfig` (150-165): token, session_id, base_url, cli_version, encryption_key:[u8;32], encryption_variant.
- `SessionClient::new(config, initial_state) -> (Self, mpsc::UnboundedReceiver<InboundEvent>)` (187-205). Inits `socket: None`, `connected: false` → **buildable against a wiremock base_url with NO socket connected.** Socket connect is the separate `connect()`.
- `send_session_message(&self, content:&Value) -> Result<MessageDelivery>` (340-380): serialize → encrypt → base64 → POST `/v3/sessions/:id/messages`.
- `is_connected()` (543-545) — false until `connect()` ⇒ keepalive guard (`attach.rs:228`) skips, so no socket needed.

### inbound.rs (pure control logic)
- `ControlState { primary_thread_id: Option<String>, active_turn_id: Option<String> }` (90-98).
  - `observe(&mut self, &AppServerEvent)` (111-136): sets primary thread from root `ThreadStarted` (parent==None) at 118-120; fallback adopts first thread from `TurnStarted`/`ItemStarted`/`ItemCompleted`; sets `active_turn_id` on primary `TurnStarted`; clears on `TurnCompleted`.
  - `primary_thread_id()`, `active_turn_id()`, `set_active_turn`, `clear_active_turn`, `plan_turn(text) -> Option<TurnAction>` (150-155), `plan_interrupt() -> Option<ClientRequest>` (157-169).
- `TurnAction` enum (83): `Start(ClientRequest)` / `Steer(ClientRequest)`.
- `PendingApproval { request_id: RequestId, kind: ApprovalKind, tool: String, arguments: Value }` (68-79).
- `ApprovalKind` (48-58): CommandExecutionV2, FileChangeV2, ExecLegacy, PatchLegacy.
- `approval_from(&AppServerEvent) -> Option<(String, PendingApproval)>` (221-300), `resolve_payload(kind, approved, decision) -> Value` (302-308), `cancel_payload(kind) -> Value` (310-314), `canonical_decision` (316-330), `request_state_entry` (347-356).

### mapping.rs (outbound transcript)
- `map_event(&AppServerEvent) -> Vec<SessionEnvelope>` (52-67). Only final items + turn lifecycle forwarded.
  - `TurnStarted` → `SessionEvent::TurnStart {}`.
  - `TurnCompleted` → `SessionEvent::TurnEnd { status }`.
  - `ItemCompleted(AgentMessage{text})` → `SessionEvent::Text { text, thinking: None }`.
  - `ItemStarted(CommandExecution)` → `ToolCallStart { name:"CodexBash", .. }`; `FileChange` → `ToolCallStart { name:"CodexPatch", title:"Apply patch" }`.
  - `SessionEnvelope { role: Agent, turn: Some(turn_id), ev: .. }`.

### wire.rs
- `SessionRole { User, Agent }`. `SessionEnvelope { id, time, role, turn, subagent, ev }` (371-388).
- `SessionEvent` variants: Text{text,thinking}, Service, ToolCallStart{..}, ToolCallEnd{call}, File, **TurnStart {}**, Start, **TurnEnd { status }**, Stop, ContextBoundary, AgentConfigurationChanged, MessageConsumption.

### encryption.rs
- `EncryptionVariant { Legacy, DataKey }`. `encrypt(key:&[u8;32], variant, data) -> Vec<u8>`, `decrypt(key:&[u8;32], variant, data) -> Option<Vec<u8>>`.

### Reusable test fixtures (to factor into the harness)
- inbound_tests.rs: `turn_started`, `turn_completed`, `item_started`, `approval_event`, `exec_v2`, `file_change_v2`.
- mapping_tests.rs: `turn(id,status)`, `command_execution`, `file_change`, `agent_message`, `item_started`, `item_completed`.
- session_tests.rs: `config(base_url)`, `initial_state()`, `encrypt_body`, `stored_message`.
- Test module wiring convention: `#[cfg(test)] #[path = "<x>_tests.rs"] mod tests;` (attach.rs:548-550, etc.).

### Cargo.toml dev-deps (already present)
- tempfile, tokio {macros, rt-multi-thread}, wiremock, codex-utils-absolute-path.

### Upstream handle shape (the disconfirming-observation check)
- `app-server-client/src/lib.rs`: `InProcessAppServerRequestHandle { command_tx: mpsc::Sender<ClientCommand> }` — **command_tx PRIVATE (458-461), no public constructor reachable from an external crate.**
- `AppServerRequestHandle` is a `pub enum { InProcess(..), Remote(..) }` (463-467) with public variants; methods `request`/`request_typed`/`resolve_server_request`/`reject_server_request` (787-941).
- ⇒ A fake `AppServerRequestHandle` CANNOT be constructed directly from codex-happy without an upstream edit. **Resolution: a local trait in codex-happy + orphan-rule impl for the foreign `AppServerRequestHandle` keeps the seam zero-upstream-edit.**

## Architect Analysis
- Extraction seam after `attach.rs:188` (core begins ~190/193). `run_attach` keeps establish + pre-connect drain; `run_attach_core(client, inbound_rx, request_handle, rx, control, buffer, pending_approvals, pending_user_messages)`.
- Local trait `AppServerHandle` (methods: `request`, `request_typed::<T>`, `resolve_server_request`) + `impl AppServerHandle for AppServerRequestHandle` (orphan rule legal: local trait + foreign type). `run_attach_core<H: AppServerHandle>` + generic helpers. **Caveat:** the returned futures (esp. `request_typed<T>`) must be `Send` because `run_attach` is `tokio::spawn`ed (`attach.rs:120`) — disconfirming risk only if the real handle's async methods aren't Send-compatible (they are; they await Send channel ops and hold no `!Send` state across awaits).
- Generic spread across the 8 helpers (mechanical).
- Outbound assertions: real `SessionClient` vs wiremock `/v3` mock (session_tests.rs:155-194 pattern), capture POST body, `encryption::decrypt`, assert transcript. No live socket needed (is_connected false → keepalive skipped).
- Placement: in-crate `attach_e2e_tests.rs` sibling (`#[cfg(test)] #[path] mod`) — reaches `pub(crate)` items, zero public-API growth, matches "keep crate API surface small". (Brainstorm's `tests/` dir would force `pub` growth.)
- Determinism risks: drain `select!` to quiescence then drop the tap `tx` to break the loop; set `primary_thread_id` (inject a root thread/`TurnStarted`) before a mobile turn so it drives a `TurnStart` rather than buffering; keepalive guarded by `is_connected()`.
- Existing overlap to acknowledge (not duplicate): default-off invariant 55 (`happy_seam_invariants.rs:148-167`) + tap-gating (70-94); AEAD-drop `backfill_skips_undecryptable_messages` (session_tests.rs).

## Codex Research
Not run — `codex-exec --effort xhigh` hung in this environment (>15 min, zero output) and was killed; the independent feasibility lens was instead provided by the Phase-4 rubber-duck critique (gpt-5.5), which verified the orphan-rule trait seam and corrected three real design errors (see plan-review-findings.json F-001/F-003/F-006).

## Consolidated File List
**Files to modify (codex submodule, overlay-internal only):**
- `codex/codex-rs-overlay/codex-happy/src/attach.rs` — extract `run_attach_core`; add local `AppServerHandle` trait + orphan impl; genericize 8 helpers.
- `codex/codex-rs-overlay/codex-happy/src/attach_e2e_tests.rs` — NEW: the Tier-1 harness (fake handle + scenarios). Wire `#[cfg(test)] #[path] mod e2e_tests;` in attach.rs.

**Read/reuse (no edits):** session.rs, inbound.rs, mapping.rs, wire.rs, encryption.rs, session_tests.rs, inbound_tests.rs, mapping_tests.rs, attach_tests.rs, Cargo.toml.

**Must NOT touch (upstream-canonical):** `codex/external/repos/codex-patched/codex-rs/app-server-client/src/lib.rs`, `tui/src/app.rs`, and everything under `external/repos/codex-patched/`.

**Existing-coverage references (acknowledge overlap):** `codex/codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs` (invariants 53/54/55/56).
