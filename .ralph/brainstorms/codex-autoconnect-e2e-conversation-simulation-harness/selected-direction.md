---
overviewTaskId: codex-autoconnect-e2e-conversation-simulation-harness
---

## Direction
D-001 — Two-tier harness: hermetic component-seam overlay-loop test (default CI gate) + retained opt-in live-socket smoke. Build the hermetic Tier 1 now to close the operator's gap deterministically, and stage the live-socket Tier 2 (and the spike-gated real-app-server D-002) behind an explicit operator fidelity decision.

## Goal
A retained, automated harness that **simulates a full remote_session conversation** for the shipped raw-codex Happy autoconnect feature, so the question *"did we test the happy support for our codex — conversation and all?"* has a green CI answer.

**Tier 1 (this task's primary, must ship):** a `cargo test -p codex-happy` (or a dedicated `codex-rs-overlay/codex-happy-e2e-tests` crate) integration test that drives `attach.rs::run_attach`'s full routing loop with injected channel seams and asserts both halves of a conversation turn, deterministically, with **no real model, socket, tunnel, auth, or elevation**, so it rides `.github/workflows/invariant-check.yml`.

**Tier 2 (stage; gated on operator decision):** a retained opt-in `#[ignore]`/env-gated `live_*` test (matching the existing `live_session_create` precedent) that stands up the real `packages/happy-server` and a Rust "mobile" client over the **real socket with real crypto-on-wire** — the wire-level E2E that Tier 1 deliberately stubs.

## Scope
### In Scope
- **Tier 1 hermetic overlay-loop harness** exercising, as a wired loop (not pure functions):
  - **Text-turn round-trip:** inject a mobile `UserMessage` `InboundEvent` → assert a turn-start (or steer) `ClientCommand` lands on a fake `AppServerRequestHandle`; feed canned `AppServerEvent`s for the turn (turn-started → agent message → turn-completed) into the tap → assert the encrypted `SessionEnvelope`s emitted on an observable session sink decrypt to the expected transcript.
  - **Tool-approval round-trip, approve AND deny:** feed a codex approval-request `AppServerEvent` → assert a mobile pending-approval is surfaced → inject the mobile `permission` decision → assert `resolve_server_request` (approve) / `reject_server_request`-or-deny-payload (deny) on the fake handle. Include the malformed-decision → fail-safe-deny path.
  - **Interrupt/abort:** inject `abort` → assert the active turn is interrupted and pending approvals are cancelled (codex not left waiting); `killSession` detaches without killing the in-process session.
  - **Reconnect/backfill:** assert seq-gap → backfill behavior (may reuse the existing `wiremock` REST mock for the `/v3` backfill fetch the loop performs).
  - **AEAD-failure drop path:** an undecryptable inbound message is dropped, never acted on.
  - **Default-OFF:** no tap/attach when `Feature::RemoteSession` is off (complements invariant 53).
- A **small overlay-internal test seam** to make the above possible: extract a `run_attach_core(...)`-style entry from `run_attach` that accepts an injected session sink + `inbound_rx` + `request_handle` + tap `rx`, and a test-only constructor exposing the outbound sink and a fake `AppServerRequestHandle` (precedent: `app-server-client/src/lib.rs:2181` builds these from raw channels). Overlay-exclusive (zero upstream-conflict surface per `codex/CLAUDE.md` tenet #1).
- **Placement:** overlay-first — prefer `codex-rs-overlay/codex-happy/tests/` or a new `codex-rs-overlay/codex-happy-e2e-tests/` member crate; runnable via `cargo test -p <crate>` (the local gate) and rides workspace CI. Do NOT add to upstream-canonical crates.
- **Tier 2 (staged):** promote the deleted US-001 probe into a retained `#[ignore]`/env-gated live test reusing `codex-happy`'s `encryption.rs` + a `rust_socketio` mobile client against a hermetically-launched `packages/happy-server` (tunnel-mode-127.0.0.1, deterministic PGlite). Carry the `/v1/updates/` trailing-slash + `dataEncryptionKey:null` gotchas from the US-001 findings.

### Out of Scope
- A real authenticated Copilot/Claude **model turn** (blocked by the ETW/elevation + fail-closed-base_url constraint) — the codex turn is always stubbed/canned.
- **D-003** (real-happy-server + real-codex as the *mandatory* always-on gate) — too heavy/flaky for default CI; only as opt-in.
- **D-002** (real in-process app-server + stub model through the literal `app.rs` tee) **unless** the operator opts into the higher fidelity tier — and only after a tiny feasibility spike confirms a stub model is reachable from an overlay test crate without new upstream seams.
- Any change to `packages/happy-server` itself (Tier 2 uses it as-is, tunnel-mode).

## Criteria
- `cargo test -p codex-happy` (or the new harness crate) runs a **text-turn conversation round-trip** end-to-end through the overlay loop and asserts the decrypted outbound transcript matches the injected turn — with no network, model, or auth.
- The same suite asserts the **tool-approval round-trip for BOTH approve and deny** (correct `resolve`/`reject`/deny payload on the fake handle), plus the malformed→deny fail-safe.
- The suite covers **abort/interrupt**, **AEAD-drop**, and **default-OFF (no attach)**; all pass deterministically and are green in `invariant-check.yml`.
- The harness is **retained** (committed, not throwaway) and named honestly (Tier 1 = overlay-loop integration test; Tier 2 = wire E2E).
- A reviewer can read one test and see the full simulated path (mobile message → inbound → turn → outbound → mobile assert).
- **(If Tier 2 in scope)** an `#[ignore]`/env-gated `live_*` test stands up the real happy-server and round-trips one encrypted turn over the real socket.

## Context
**Audit verdict (PART 1):** the answer to the operator's "did we test it" is **no full-conversation E2E exists today.** The pieces are well-covered as isolated unit tests — crypto KATs (`encryption_tests.rs`), REST session-create + `/v3` send/backfill against a `wiremock` HTTP mock (`api_tests.rs`, `session_tests.rs`), inbound control mapping as pure fns over synthetic `AppServerEvent`s (`inbound_tests.rs`), outbound transcript mapping as pure fns (`mapping_tests.rs`), socket-update state machine over synthetic `Update`s (`session_state_tests.rs`), wire serde (`wire_tests.rs`), and seam structural marker guards (`happy_seam_invariants.rs`). But **no test drives the live socket**, **none wires inbound→turn→outbound as a loop**, and **none drives the approval round-trip**. `session_tests.rs:1-5` itself says the Socket.IO layer is left to "the US-001 probe and a future integration test." The US-001 "live round-trip" was a **throwaway** probe (connect + session-create + one encrypted message + 1 broadcast — no codex turn, no approval) that was **deleted**, so even that is no longer runnable.

**Feasibility constraints that shaped D-001 (verified against source; codex + devils-advocate lenses converged):**
- `attach.rs::run_attach(params, request_handle, rx)` is the testable heart: it drains the tap `rx` (outbound) and drives `request_handle: AppServerRequestHandle` from `inbound_rx` (inbound). The socket is buried in the private `establish()` (`attach.rs:251`), hard-wired to real creds + `rust_socketio`.
- `happy_tap` only fires inside the real `tui/src/app.rs` TUI loop — a `cargo test` can feed the receiver side but cannot run the literal tee (that's D-002's domain).
- `rust_socketio` is client-side; `wiremock` cannot fake Socket.IO — socket fidelity needs the **real happy-server** (hence Tier 2, not a cheap Rust fake).
- The model turn cannot be a real call (ETW/elevation + the copilot provider's fail-closed-on-base_url) → always stub/canned.
- `AppServerRequestHandle` is channel-backed and fakeable (`app-server-client/src/lib.rs:2181` precedent) — so the inbound turn-drive + approval-resolve is assertable on a fake handle.

**Disconfirming observation to watch:** if extracting a testable `run_attach_core` is impossible without widening upstream `app-server-client` APIs (i.e. the fake `AppServerRequestHandle` can't be built from `codex-happy`), Tier 1 loses its zero-conflict advantage and the plan should reconsider toward D-002/D-003.

**Open operator question (must resolve before/at planning):** how far up the fidelity ladder to invest — **mock-only Tier 1 (D-001)** vs **also live-socket Tier 2** vs **also real-app-server turn (D-002, spike-gated)**. This is the single scope-determining decision. See `brainstorm-synthesis.md` "Open questions".

**Key source pointers:** `codex/codex-rs-overlay/codex-happy/src/{attach,session,inbound,mapping,encryption,api,auth}.rs` + the `*_tests.rs` siblings + `Cargo.toml` (dev-deps already include `wiremock`, `tokio` rt-multi-thread, `tempfile`); `codex/codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs`; `codex/external/repos/codex-patched/codex-rs/tui/src/app.rs` (the tee) + `app-server-client/src/lib.rs` (`resolve/reject_server_request`, fakeable handle); `.ralph/jobs/codex-raw-session-happy-daemon-autoconnect/plan.md`; `.ralph/investigations/{codex-raw-autoconnect-us001-live,autoconnect-pre-release-review}/findings.md`; `packages/happy-server/` (Tier 2 real server).
