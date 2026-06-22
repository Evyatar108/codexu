# Stories Outline: Tier-1 Hermetic E2E Conversation-Simulation Harness for `remote_session`

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> All stories edit `codex/codex-rs-overlay/codex-happy/src/attach.rs` and the new
> `codex/codex-rs-overlay/codex-happy/src/attach_e2e_tests.rs`. They share those files and the
> changes are strictly ordered, so they **must run serially** (one cluster, four phases). **Zero
> edits under `codex/external/repos/codex-patched/`** in any story. Verification runs from
> `codex/external/repos/codex-patched/codex-rs` after `source scripts/iteration-env.sh`.

## US-001: Overlay-internal enabling refactor (`run_attach_core` + `AppServerHandle` trait)
**Description:** As a fork maintainer, I want `run_attach`'s steady-state routing loop extracted into a
`run_attach_core` that is generic over a local `AppServerHandle` trait, so a hermetic test can drive
the loop with a fake handle — without any upstream-canonical edit.
**Acceptance Criteria:**
- [ ] `run_attach` is split: it keeps `establish()` + the pre-connect drain, then calls a new `run_attach_core(client, inbound_rx, request_handle, rx, control, buffer, pending_approvals, pending_user_messages)` carrying the steady-state `tokio::select!` loop + teardown (extraction boundary after attach.rs:188).
- [ ] A `pub(crate) trait AppServerHandle` is defined with exactly the methods the loop uses (`request`, `request_typed::<T>`, `resolve_server_request`) as native RPITIT methods with a `Send + Sync` supertrait, `+ Send + '_` futures, and `T: DeserializeOwned + Send + 'static`; implemented once for `codex_app_server_client::AppServerRequestHandle` (orphan-rule impl: local trait + foreign type).
- [ ] `run_attach_core` and the eight handle-taking helpers (`handle_inbound`, `enqueue_or_drive_turn`, `flush_pending_turns`, `drive_turn`, `start_turn`, `handle_permission`, `handle_abort`, `cancel_pending_approvals`) are generic over `H: AppServerHandle`; the spawned `run_attach_core<H: AppServerHandle + 'static>`; `run_attach` passes the real handle.
- [ ] `attach.rs` adds `#[cfg(test)] #[path = "attach_e2e_tests.rs"] mod e2e_tests;` and the new file exists with a minimal placeholder so the crate compiles.
- [ ] `git diff --name-only` is confined to `codex/codex-rs-overlay/codex-happy/`; **no file under `external/repos/codex-patched/` is modified.**
- [ ] The pre-existing `attach_tests.rs` still passes; `cargo check --workspace` is green; `just fmt` + `just fix -p codex-happy` clean.
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Harness scaffolding + text-turn round-trip scenario
**Description:** As a reviewer, I want one readable test that simulates a full text turn (mobile
message → inbound → codex turn → outbound → mobile-side decrypt + assert), so the conversation path
has retained, deterministic CI coverage.
**Acceptance Criteria:**
- [ ] A `FakeAppServerHandle` implements `AppServerHandle`: records received `ClientRequest`s and `resolve_server_request(request_id, payload)` calls behind a shared `Arc<Mutex<…>>`, and returns canned `TurnStartResponse`/`TurnSteerResponse` (a `serde_json::Value` matching the incoming request variant, `from_value::<T>`'d).
- [ ] Minimal fixtures are **duplicated locally** in `attach_e2e_tests.rs` (the sibling test-module fixture fns are private and unreachable from a child module of `attach.rs`).
- [ ] A wiremock outbound-sink helper builds a real `SessionClient` against a `wiremock` `MockServer` whose `POST /v3/sessions/:id/messages` handler captures request bodies and (via a dynamic `wiremock::Respond`) **echoes the request `localId` back with a seq** (so `send_session_message` resolves cleanly — session.rs:367-371); a decrypt helper (`encryption::decrypt` + base64) reconstructs the transcript.
- [ ] A driver spawns `run_attach_core` on a task, holds the tap `tx` + `inbound_tx`, injects events, drives to a deterministic observable barrier (not `yield_now`; no `start_paused` — `test-util` is not a dev-dep), drops the tap `tx`, and `await`s the task before asserting.
- [ ] The text-turn scenario **injects a root `ThreadStarted` (`parent_thread_id == None`) first** so `primary_thread_id` is set with NO active turn (injecting `TurnStarted` would set `active_turn_id` → `TurnSteer`, not `TurnStart` — inbound.rs:121-125/194-218), then a mobile `UserMessage`, and asserts a `TurnStart` `ClientRequest` carrying the message text on the fake handle.
- [ ] A canned codex turn (`turn_started` → `item_completed(agent_message)` → `turn_completed`) produces `/v3` POST bodies that **decrypt to `TurnStart {}` → `Text { text }` → `TurnEnd { status }`** in order.
- [ ] Runs under `cargo test -p codex-happy` with no network/model/socket/auth; deterministic.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Tool-approval round-trip (approve, deny, dedup, malformed→deny)
**Description:** As a mobile user, I want my approve/deny decisions on a codex tool-approval to drive
`resolve_server_request` correctly, with first-resolve-wins dedup against the local TUI, so the
approval round-trip is covered.
**Acceptance Criteria:**
- [ ] Injecting a codex approval `ServerRequest` (`exec_v2`) surfaces a pending approval; **after a deterministic barrier proving the approval was processed** (e.g. a following mapped transcript event whose `/v3` POST is captured — not `yield_now`), injecting a mobile `permission` `Rpc` with `approved=true` asserts the **approve** `resolve_server_request` payload on the fake handle.
- [ ] The same flow with `approved=false` asserts the **deny** payload.
- [ ] **First-resolve-wins dedup:** a second `permission` for the same id yields **exactly one** `resolve_server_request` (the entry was consumed via `pending_approvals.remove`).
- [ ] A **malformed decision** (missing/garbage `decision`, or missing `id`) asserts the **current** `resolve_payload`/`canonical_decision` behavior (approved authoritative; false/missing → abort→cancel unless exactly `denied`; missing `id` is a no-op) and proves no panic — it does **not** impose a new "deny" semantic (that would be a separate behavior-change story).
- [ ] Runs under `cargo test -p codex-happy`; deterministic.
- [ ] Typecheck passes.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: Abort/interrupt + AEAD-drop + default-off
**Description:** As a fork maintainer, I want the remaining loop behaviors covered so the harness is a
complete Tier-1 conversation simulation.
**Acceptance Criteria:**
- [ ] **Abort:** with an active turn + a pending approval, injecting a mobile `abort` `Rpc` asserts an interrupt `ClientRequest` on the fake handle **and** the pending approval canceled (cancel `resolve_server_request`); `killSession` does the same and the loop detaches (returns).
- [ ] **AEAD-failure drop:** pass `run_attach_core` the `inbound_rx` **returned by `SessionClient::new`** (not a test-owned channel) and drive `client.fetch_messages()` against a wiremock GET returning an *undecryptable* encrypted message, so the real `decrypt_and_route` early-drop (session.rs:629-633) runs; assert **no `InboundEvent` reaches the loop and no fake-handle action fires** (wired-loop no-action, distinct from the unit-level `backfill_skips_undecryptable_messages`).
- [ ] **Default-off:** `should_skip_attach`/`maybe_attach` returns `None` under the `HAPPY_CURRENT_SESSION_ID` idempotency env, with a code cross-reference to invariant 55 for the `app.rs` feature gate (out of scope for `cargo test -p codex-happy`).
- [ ] All scenarios run under `cargo test -p codex-happy`; the full suite is green in `invariant-check.yml`; deterministic.
- [ ] Typecheck passes.
**Dependencies:** US-002 (and logically follows US-003)
**Estimated complexity:** medium
