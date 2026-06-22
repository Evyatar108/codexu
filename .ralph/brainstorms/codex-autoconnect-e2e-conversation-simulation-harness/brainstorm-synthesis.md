Lenses: ran=[codex, devils-advocate]; skipped=[copilot] (copilot-exec `--read-only` snapshot exceeded the 512MB budget because the repo carries a 547MB `.xwin-cache` build artifact tree; environment failure, not a content problem — see "Open questions")

# Brainstorm synthesis — `codex-autoconnect-e2e-conversation-simulation-harness`

**Operator request (2026-06-22):** *"did we already test the happy support for our codex? we should have a way to simulate it, conversation and all, as integration test."*

This brainstorm has two halves: **(1) a precise audit** of what `remote_session` behavior is automatically tested today (PART 1), and **(2) the design** of an end-to-end conversation-simulation harness that closes the gap (PART 2). The audit is the direct answer to the operator's first question; the harness is the answer to the second.

---

## PART 1 — AUDIT: what is tested today, and the gap

### Headline answer: **NO.** There is no automated test that drives a complete conversation turn end-to-end through the live encrypted socket path, and no automated tool-approval round-trip.

The **pieces** of `remote_session` are genuinely well-covered as isolated unit tests; what is missing is a test that **wires them together over the live socket + a codex turn**. Concretely:

#### What IS tested (all hermetic `cargo test -p codex-happy` / `-p codex-invariant-tests`)

| Area | File | What it proves | Fidelity |
|---|---|---|---|
| Crypto KATs + round-trips | `codex-happy/src/encryption_tests.rs` (12 tests, e.g. `decrypts_encryption_ts_datakey_bundle`, `verifies_encryption_ts_signature`, `datakey_round_trip_random_nonce`) | Byte-compat with `packages/happy-cli/src/api/encryption.ts` across all 5 primitives | Pure crypto, no I/O |
| REST session-create | `codex-happy/src/api_tests.rs` (`datakey_session_posts_null_data_encryption_key`, `server_4xx/5xx_*`) against a **`wiremock` HTTP mock** | `POST /v1/sessions` contract + `dataEncryptionKey:null` fidelity + error handling | REST only (no socket) |
| REST message send + backfill | `codex-happy/src/session_tests.rs` (`backfill_decrypts_and_routes_messages`, `send_session_message_resolves_seq_and_advances`, `backfill_paginates_until_has_more_false`, `backfill_skips_undecryptable_messages`) against a **`wiremock` HTTP mock** | `/v3` encrypt→POST→seq-resolve and decrypt→route→paginate | **REST half only** — its own doc-comment (`session_tests.rs:1-5`) says *"The Socket.IO layer is exercised live by the US-001 probe and a future integration test; these tests use a wiremock mock of the tunnel listener so the crate is unit-testable in isolation."* |
| Inbound control mapping | `codex-happy/src/inbound_tests.rs` (17 tests: `plan_turn_starts_when_idle_and_steers_when_active`, `plan_interrupt_targets_active_turn_only`, `approval_from_v2_command_execution_*`, `resolve_payload_v2/legacy_decision_vocabulary`, `cancel_payload_maps_per_kind`) | Mobile-UserMessage→turn-start/steer logic; approval extraction; resolve/cancel payloads | **Pure functions over synthetic `AppServerEvent`s** — not wired to a real app-server or socket |
| Outbound transcript mapping | `codex-happy/src/mapping_tests.rs` (`turn_started_maps_to_turn_start`, `command_execution_started_maps_to_bash_tool_call_start`, `agent_message_completed_maps_to_text`, `user_message_and_reasoning_are_not_forwarded`) | codex `AppServerEvent`→Happy `SessionEnvelope` | Pure functions |
| Socket update state machine | `codex-happy/src/session_state_tests.rs` (`new_message_with_gap_triggers_seq_gap_backfill`, `apply_metadata_only_accepts_newer_versions`, `parse_cas_ack_*`) | Seq-gap/backfill trigger + CAS-ack parsing | Pure logic over **synthetic `Update` structs** (no real socket) |
| Wire serde | `codex-happy/src/wire_tests.rs` | happy-wire envelope round-trips | Pure serde |
| Cred / attach helpers | `auth_tests.rs`, `attach_tests.rs` (`skip_attach_only_when_happy_session_env_present`, `push_bounded_drops_oldest_past_cap`, `build_metadata_marks_codex_flavor`), `agent_state_tests.rs` | Cred reads, preconnect-buffer cap, idempotency env gate, pending-approval map | Pure helpers |
| Dormant self-onboard | `onboard_tests.rs` | Device-flow + creds write (US-003, not wired) | Pure / `#[ignore]` live |
| Seam structural guards | `codex-invariant-tests/tests/happy_seam_invariants.rs` (invariants 52/53/54/57) | `// SANDBOX PATCH` markers survive rebase, `happy_tap` field exists, tee is BEFORE `handle_app_server_event`, `resolve/reject` handle methods exist, `/remote` markers, default-OFF | **Mostly structural marker asserts**; the one behavioral test drives the raw `UnboundedSender` channel only, not a real turn |
| Wire drift guard | `codex-invariant-tests/tests/happy_wire_drift_guard.rs` | Pins in-repo `@slopus/happy-wire` schema snapshot | Snapshot |
| Static egress audit | `codex/scripts/audit_network_calls.sh` + `runtime_audit_allowlist.txt` | All egress registered/allowlisted | Grep-based, not behavioral |

#### What is NOT tested (the gap)

- **No live socket coverage at all.** Every test mocks the **REST** half via `wiremock`; `wiremock` cannot speak Socket.IO. The only thing that ever exercised the live `rust_socketio` path is the throwaway US-001 probe (below).
- **No full-conversation round-trip.** Nothing wires: *simulated mobile encrypts a UserMessage → socket → `session.rs` receive+decrypt → `inbound.rs` route → codex turn (seam) → `AppServerEvent` stream tee'd into `happy_tap` → `mapping.rs` → encrypt → `/v3` POST → simulated mobile decrypts+asserts.* The inbound half and the outbound half are each tested as **pure functions**, never as a wired loop.
- **No tool-approval round-trip.** Only the pure-fn approval *mapping* is tested (`inbound_tests.rs`); nothing drives *codex approval event → mobile pending-approval → mobile approve/deny → `inbound` resolve → `resolve_server_request`/`reject_server_request`*.
- **No real `happy_tap` tee execution.** The tee lives in `tui/src/app.rs` and only fires while the real TUI loop drains `app_server.next_event()`; no test runs that loop.

#### The US-001 "live round-trip" — what it actually was

`.ralph/investigations/codex-raw-autoconnect-us001-live/` was a **throwaway Rust probe** (reqwest + rust_socketio + crypto) that proved: socket-connect + `POST /v1/sessions` (no auth) + encrypted `/v3` message POST + fetch+decrypt-byte-identical + saw 1 socket broadcast. It did **NOT** drive a codex turn, **NOT** the approval round-trip, and was **DELETED** after the de-risk — it is **not a retained regression test**. So even the socket-connect + crypto-on-wire proof is no longer runnable.

**Bottom line for the operator:** the building blocks are solidly tested in isolation (and even have a `wiremock` REST-integration layer), but the answer to *"did we test the conversation, end to end?"* is **no** — that loop, the approval round-trip, and the live socket have never been covered by a retained automated test.

---

## PART 2 — DESIGN: the harness

### Key feasibility constraints (verified against source — all three lenses converged here)

1. **`run_attach` is the testable heart of the overlay.** `attach.rs::run_attach(params, request_handle, rx)` drives the whole loop: it drains `rx: UnboundedReceiver<AppServerEvent>` (outbound, fed by the seam tee), and on the inbound side drains `inbound_rx` (mobile control) → `handle_inbound` → drives `request_handle: AppServerRequestHandle` (turn start/steer/interrupt + `resolve/reject_server_request`). The socket lives **inside** the private `establish()` (`attach.rs:251`), which is hard-wired to read `~/.happy` creds + connect a real `rust_socketio` client.
2. **`happy_tap` only fires inside the real `tui/src/app.rs` TUI loop** (devils-advocate + confirmed). A `cargo test -p codex-happy` cannot execute the literal tee; it can only feed events into the receiver side of the same channel (`maybe_attach` hands back the `tx`).
3. **`rust_socketio` is a client library; `wiremock` cannot fake Socket.IO** (engine.io handshake, `/v1/updates/` mount, acks). So a *cheap* in-Rust fake socket server is not realistic — socket fidelity requires the **real `packages/happy-server`** (node + PGlite, tunnel-mode-on-127.0.0.1, exactly as the US-001 de-risk stood it up).
4. **The model turn cannot use a real Copilot/Claude call** (the ETW/elevation + auth constraint that blocked the release runtime audit). The fork's copilot provider is **fail-closed on an untrusted `base_url`**, so even a stub-model upgrade must go through codex-core's test side-channel, not a repointed provider.
5. **`AppServerRequestHandle` is channel-backed and fakeable.** It is an enum wrapping `InProcessAppServerRequestHandle { command_tx: mpsc::Sender<ClientCommand>, .. }`; the app-server-client crate's own tests construct these from raw channels and observe the `command_rx` (`app-server-client/src/lib.rs:2181`). A fake that records the `ClientCommand`s the overlay emits is constructible (may need a small test-only constructor exported from `codex-happy`).

These constraints define a **fidelity ladder**: how real do you make (a) the socket/crypto-on-wire and (b) the codex turn? The three directions are rungs on that ladder.

---

### D-001: Two-tier harness — hermetic component-seam overlay-loop test (default CI gate) + retained opt-in live-socket smoke
- Contributing lenses: [codex, devils-advocate]
- **Tier 1 (default, always-on, fully hermetic):** A `cargo test`-runnable integration test that drives the overlay's full routing loop with **injected channel seams** — feed canned `AppServerEvent`s into the tap `rx` (simulating a codex turn: turn-started → command/file tool-call → agent message → turn-completed), inject `InboundEvent`s (simulating mobile UserMessage / approve / deny / abort), assert the **outbound `SessionEnvelope`s** on an observable session sink AND the **inbound `ClientCommand`s** on a fake `AppServerRequestHandle`. Covers scenarios: text-turn round-trip; tool-call approval **approve AND deny**; interrupt/abort; AEAD-failure drop (synthetic undecryptable message → dropped); default-OFF (no tap when feature off, already partly via invariant 53). No model, socket, tunnel, auth, or elevation → rides `.github/workflows/invariant-check.yml`.
- **Tier 2 (opt-in `#[ignore]`/env-gated, nightly/manual):** **Promote the throwaway US-001 probe into a retained `live_*` test** (matching the existing `live_session_create`/`live_request_device_code` precedent) that stands up the **real `packages/happy-server`** in tunnel-mode-on-127.0.0.1 and runs a Rust "mobile" client over the **real socket** with **real crypto-on-wire**, asserting the decrypted transcript. This is the wire-level E2E that Tier 1 deliberately stubs.
- Why this might work: Tier 1 closes the operator's gap **deterministically and immediately** (a real conversation+approval simulation that runs in CI), while Tier 2 preserves real-socket/real-crypto fidelity without making the default gate depend on node/tunnel/auth. Honest naming: Tier 1 is an **overlay-loop integration test**, Tier 2 is the **wire E2E** — don't conflate them (devils-advocate's red flag).
- Risks / friction: Tier 1 needs a **small overlay-internal test seam** (extract a `run_attach_core(client_sink, inbound_rx, request_handle, tap_rx)` from `run_attach`, plus a test constructor that exposes the outbound sink and a fake request-handle). That refactor is overlay-exclusive (zero upstream-conflict surface per `codex/CLAUDE.md` tenet #1) but is real work. Tier 2 inherits the US-001 standup cost (node + PGlite + the `/v1/updates/` trailing-slash gotcha).
- Cheapest validation: write **one** Tier-1 text-turn round-trip test first (inject UserMessage → assert a turn-start `ClientCommand` + assert the agent-message envelope is sent); if that wires cleanly, the rest are incremental.
- Disconfirming observation: if extracting `run_attach_core` proves impossible without widening upstream `app-server-client` APIs (i.e. `AppServerRequestHandle` cannot be faked from `codex-happy` without an upstream change), Tier 1 loses its zero-conflict advantage and collapses toward D-003.

### D-002: Real in-process codex app-server driven by a stubbed model (spike-gated higher-fidelity hermetic turn)
- Contributing lenses: [codex, devils-advocate]
- Stand up the **real in-process codex app-server** and drive a **genuine codex turn** through the **real `happy_tap` tee**, with the model **stubbed** (a canned Responses-API SSE via codex-core's test transport side-channel — never a real Copilot/Claude call). This is the only direction that exercises the actual `app.rs` tee + `app_server.next_event()` ordering + real `resolve_server_request`/`reject_server_request` behavior, rather than synthetic events + a fake handle.
- Why this might work: it tests the one seam D-001 stubs — the real app-server turn and the literal tee — closing the "synthetic events prove nothing about the inbound→turn-start path" objection.
- Risks / friction: **feasibility is uncertain** — can codex-core/app-server be instantiated in-process with a canned transport from an *overlay test crate*, without real auth/config side effects and without the full TUI? The copilot provider's fail-closed-on-base_url behavior means the stub must go through codex's test plumbing, which may not be reachable from `codex-rs-overlay/`. Effort L–XL.
- Cheapest validation: **a tiny spike** (devils-advocate's recommendation) — start a real in-process app-server with a stub model and observe **one** genuinely tapped `AppServerEvent` reach `happy_tap`, with no new upstream seam. If that spike passes, D-002 becomes a credible upgrade to D-001's Tier 1; if it fails, stay at D-001.
- Disconfirming observation: if the only way to reach a stub model is via the real launcher/auth path (no in-process test transport reachable from the overlay), D-002 is not hermetic and should be folded into D-001 Tier 2 instead.

### D-003: Full real-stack E2E (real happy-server + real codex + stub model) as the primary always-on gate
- Contributing lenses: [codex]
- The maximalist option: make the **always-on CI gate** a true wire-level E2E — real `packages/happy-server` + real codex subprocess (`remote_session` on, injected test creds, stub model) + Rust mobile client over the real socket — asserting a full encrypted turn + approval round-trip end to end.
- Why this might work: it is the most faithful possible answer to "test it, conversation and all."
- Risks / friction: requires **node + a built happy-server + codex-core test harness all running hermetically inside `cargo test --workspace`** on `ubuntu-latest` AND `windows-latest`. That is a cross-runtime dependency the invariant-check CI does not have today; it is heavy and flake-prone as a *mandatory* gate. Effort XL.
- Cheapest validation: confirm whether `packages/happy-server` can be launched hermetically (deterministic PGlite, no operator creds) from a Rust test in CI; the US-001 findings suggest it can locally, but not necessarily inside the existing Rust CI job.
- Disconfirming observation: if `cargo test --workspace` CI cannot provision node + happy-server deterministically, this direction's "always-on" premise fails and it must demote to D-001's opt-in Tier 2.

---

## Recommendation: **D-001** (build Tier 1 now; stage Tier 2 + D-002 by fidelity decision)

D-001 is the right first build because it **closes the operator's gap immediately and deterministically** — an always-on hermetic simulation of a full conversation turn **and** the approve/deny approval round-trip — while honestly scoping what it does and does not cover, and preserving a clean escalation path (Tier 2 live socket, then D-002's real app-server turn) gated on how much fidelity the operator wants to pay for. All three lenses independently produced this same fidelity ladder and the same two hard constraints (the tee only fires in the real `app.rs`; the socket can't be cheaply faked), which is strong corroboration.

The genuine **operator decision** is *how far up the ladder to invest*, not *which harness* — surfaced below as the lead open question.

---

## Open questions (carry into planning / operator)

1. **[OPERATOR DECISION] Fidelity scope.** Is the hermetic Tier 1 (D-001) sufficient to answer "did we test the conversation," or does the operator also want (a) the opt-in **live-socket** tier (D-001 Tier 2, real happy-server + real crypto-on-wire), and/or (b) the **real-app-server stub-model turn** (D-002, spike-gated)? This is the one choice that materially changes plan scope (M vs L vs XL).
2. **[PLAN] Test-seam acceptability.** Is a small **overlay-internal refactor** (extract `run_attach_core` + a test-only constructor exposing the outbound sink + a fake `AppServerRequestHandle`) acceptable to make Tier 1 possible? It is zero-upstream-conflict-surface, but it does touch shipped overlay code.
3. **[PLAN] First scenario priority.** Should the first retained test be the **text-turn** round-trip (simplest wiring) before approvals + abort + reconnect + AEAD-drop, or should approvals (the highest-risk untested behavior) come first?
4. **[INFO] Missing copilot lens.** The copilot lens could not run: `copilot-exec --read-only` snapshots the cwd tree and the repo carries a **547MB `.xwin-cache`** (Windows SDK build libs) that blew the 512MB snapshot budget (exit 5). Not decision-relevant here (codex + devils-advocate + first-hand source reading covered the space), but it recurs for any copilot-exec lens run from the codexu root and is worth a follow-up (e.g. snapshot-scope exclusion for build-cache dirs) — related to the existing `ralph-copilot-exec-readonly-submodule-snapshot-cost` brainstorm.
