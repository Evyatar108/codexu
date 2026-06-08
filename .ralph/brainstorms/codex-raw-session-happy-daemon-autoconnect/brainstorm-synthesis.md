Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode — all three lenses returned usable output)

# Brainstorm Synthesis — codex-raw-session-happy-daemon-autoconnect (v2, operator pivot)

> **Supersedes** the prior read-only brainstorm (D-001 read-only mirror, shipped @ `e27720bc`). The operator pivoted (4 refinement messages, 2026-06-08): raw `codex` of our fork must behave EXACTLY like `happy codex` — full mobile remote control (turns + approvals + interrupt/stop) + discoverable + synced — by INTEGRATING the Happy client natively into the fork, NOT read-only, NOT a PATH alias, ideally with NO happy-cli runtime dependency. The prior read-only mirror is retained only as the degraded fallback.

## The decision this brainstorm resolves

The operator's framing has two independent axes that the lenses (and a direct source read) untangle:

- **Axis 1 — the in-fork control seam.** How does the integrated fork tap one live `codex` session to mirror it out and drive it from mobile (turns/approvals/interrupt/stop)? **This is required for ANY in-fork full-control design (B, C, and D's native part all need it).**
- **Axis 2 — who speaks the Happy wire protocol.** Native Rust in codex-core (B, no happy-cli), a retained happy-cli daemon (D), a bundled bridge sidecar (C), or delegate the whole thing back to `happy codex` (A).

The operator's "collapse the JSON-RPC layer" insight is **correct for the transport** (`codexAppServerClient.ts`, 91 KB, plus ws/stdio transport + discovery/lock, exists only because happy-cli is an external process and all collapses on integration) — but **what replaces it is not free**: it is a *different* upstream seam (Axis 1), not the absence of a seam.

## Two load-bearing findings (verified directly from source, not just lens claims)

1. **The launcher cannot host the client.** `codex/codex-rs-overlay/codex-copilot-launcher/src/main.rs:115-180` runs first-run bootstrap, loads config, sets env, then `exec()`s `codex-core` (Unix) / spawn+wait (Windows) and is GONE. There is no long-lived launcher process to carry a Happy event tap. The operator's "wired into the launcher startup" mental model does not hold for a session-lifetime client; the client must live inside codex-core's runtime.

2. **The runtime event stream is a single-consumer, crate-private channel.** `core/src/session/mod.rs:372` — `pub struct Codex { pub(crate) tx_sub: Sender<Submission>, pub(crate) rx_event: mpsc::Receiver<Event>, ... }`; `next_event()` (`:740`) pulls from the **mpsc** receiver. The TUI is the *sole* consumer, and both channels are `pub(crate)` — **an overlay crate cannot reach them.** Therefore full bidirectional control **cannot be overlay-only**: it requires a bounded set of upstream-canonical edits to fan the event stream out to a second sink and expose an Op-injection + approval-routing path. The codex feasibility lens independently named the exact seam files: `tui/src/app_event.rs`, `app_event_sender.rs`, `app_server_session.rs`, `chatwidget/turn_runtime.rs`, `approval_events.rs`.

These two findings are why all three lenses (and this synthesis) refuse to rubber-stamp "pure B, overlay-only, zero upstream edits, no happy-cli." That exact shape is not achievable.

## What collapses vs. what genuinely remains (the port surface)

**Collapses on integration (the operator's insight, validated):** the entire external-driver layer — `codexAppServerClient.ts` (JSON-RPC 2.0 over ws/stdio), the `codex app-server` spawn + per-cwd discovery + lock + ws-auth capability token + sandbox-wrap-for-transport. codex-core already owns turns/approvals/interrupts natively, so it does not need a JSON-RPC bridge to drive itself.

**Genuinely remains (must be reimplemented for B, in Rust):**
- `api/encryption.ts` — TweetNaCl `box`/`secretbox` + libsodium sealed-box (note the `sha512(seed)[0:32]` pubkey derivation) + AES-256-GCM `dataKey` mode + Ed25519 auth challenge → Rust `crypto_box`/`xsalsa20poly1305`/`aes-gcm`/`ed25519-dalek`/`sha2`. Moderate, must match byte-for-byte.
- `api/apiSession.ts` (~45 KB) — Socket.IO client on `path:/v1/updates` (websocket-only), seq-ordered `update` handling, optimistic-concurrency `update-metadata`/`update-state` (version CAS), `message-consumption` acks, `session-alive` keepalive, smart-reconnect, RPC handler manager. **This is the subtle, behavior-parity-critical port.**
- `api/api.ts` `getOrCreateSession` — `POST /v1/sessions`, `dataKey` vs `legacy` encryption selection, sealed-box of the data key to the account public key.
- Auth — GitHub device flow (precedent already in Rust: `codex-rs-overlay/codex-copilot/src/auth.rs`, 23 KB) + Dev Tunnels connect token (`X-Tunnel-Authorization: tunnel <jwt>`).
- `@slopus/happy-wire` session/message/metadata schemas as serde structs — the **perpetual two-implementation drift tax** vs the TS package as both evolve.
- The Axis-1 glue: map codex `Event` ↔ Happy session envelopes (`sessionProtocol.ts`: `text`/`tool-call-start{permissionRequestId}`/`tool-call-end`/`turn-start`/`turn-end`/`context-boundary`…), and Happy mobile turns/approval decisions/interrupt ↔ codex `Op`/`Submission`.

**Deferred (machine-level — the daemon's job, `api/apiMachine.ts`):** `machine-alive` keepalive, `spawnSession`/`spawnInWorktree`/`spawnSessionFromSession`, machine presence. All three lenses agree v1 should stop at session-level and defer these.

## A third, easy-to-miss cost: the network-egress audit

The fork's **whole purpose** is suppressing non-Copilot network paths, enforced by `scripts/audit_network_calls.sh` (5 phases) + `scripts/runtime_audit.ps1` (allowlist). B (and C) add a brand-new happy-server + Dev-Tunnels egress path **inside the audited codex-core boundary** — a new allowlisted host, a new `reqwest`/Socket.IO call site, and a `patch-surface.md` §14/§15 registration with justification. This is a meaningful expansion of the fork's audited surface and a real point in D's favor (D keeps Happy egress in a separate, unaudited-by-codex process).

---

## Directions

### D-001 (RECOMMENDED): B — Native Rust Happy session client overlay crate (`codex-happy`), session-scope first
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: delivers exactly the operator's goal — typing `codex` is a Happy-controlled session with **no happy-cli runtime process**. The protocol client genuinely CAN be a conflict-free overlay crate; the Axis-1 upstream seam it needs is *unavoidable for any in-fork full-control design*, so B's distinctive cost is "only" the Rust protocol port — the price of the no-dependency goal the operator explicitly chose. Auth precedent exists (`codex-copilot/auth.rs`); crypto/Socket.IO crates are mature.
- Risks / friction: **XL.** Not overlay-only — needs bounded, rebase-gated upstream-canonical edits in `tui/src` (AppEvent/AppCommand for remote turns/approvals/interrupt/stop) + `core/src/session` (event fan-out from the single-consumer mpsc), registered in `patch-surface.md`. Perpetual two-implementation drift tax vs `@slopus/happy-wire`. New audited network egress inside codex-core. The integrated process becomes the E2EE key holder (replaces daemon-sole-holder).
- Cheapest validation (Phase-0 GATE, do before any product work): (a) prove a *narrow* TUI AppEvent/AppCommand seam can tap+inject one full turn + one exec approval + one patch approval + interrupt + stop in few enough patched lines to honor the conflict-surface tenet; (b) a throwaway Rust spike that authenticates to a dev happy-server, runs `getOrCreateSession` with compatible `dataKey`/`legacy` encryption, sends one message, and rides Socket.IO `/v1/updates` with metadata/state CAS — **with no happy-server protocol changes.**
- Disconfirming observation: if the spike shows the TUI seam sprawls across many upstream-canonical files, or the Rust client cannot round-trip without happy-server protocol changes, B is not a bounded-overlay project — fall back to **D**.

### D-002: D — Hybrid (native in-fork control seam + retained happy-cli daemon owns Happy wire/keys/machine scope)
- Contributing lenses: [devils-advocate, copilot, codex]
- Why this might work: reuses the SAME Axis-1 TUI/core seam as B, but keeps the proven TypeScript Happy protocol/E2EE/Socket.IO/machine-RPC implementation in happy-cli, reached over a thin local IPC. Avoids the second crypto/Socket.IO/wire implementation AND keeps Happy egress + key material out of the audited codex-core. It is also the only honest home for machine-level parity (spawn-from-mobile, presence, keepalive). The Devil's Advocate's preferred direction.
- Risks / friction: keeps a happy-cli runtime dependency — the exact thing the operator wants to eliminate. Defines a new versioned codex↔happy IPC contract.
- Cheapest validation: prove codex-rs can emit typed lifecycle events + consume control commands over a minimal IPC that the existing `ApiSessionClient` drives, for one turn + one approval + interrupt + stop.
- Disconfirming observation: if the IPC contract is small and stable, D dominates B on maintenance; if it grows toward re-exposing the full app-server JSON-RPC surface, its advantage over A evaporates.

### D-003: A — Launcher-internal delegation (codex.exe re-execs into `happy codex`)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: lowest engineering risk and exact behavioral parity by reusing `runCodex`/`CodexAppServerClient`/`ApiSessionClient`/`ApiMachineClient` verbatim; implemented inside codex.exe with recursion guards (not a user-facing PATH alias).
- Risks / friction: KEEPS the happy-cli runtime dependency and PRESERVES the app-server JSON-RPC driver layer the operator explicitly wants to collapse; fails on clean machines without happy-cli; double-wrap/version-skew hazards. Operator already rejected the alias framing; treat A only as a transitional safety valve.
- Cheapest validation: patch the launcher behind a kill switch to re-exec `happy codex` only when not already Happy-driven; test one Windows raw invocation for discovery/approvals/interrupt/offline-fallback.
- Disconfirming observation: the no-happy-cli-runtime constraint is hard, which removes A from primary contention by construction.

### D-004: C — Fork-bundled thin Happy bridge sidecar
- Contributing lenses: [copilot, codex, devils-advocate]
- Why this might work: zero user setup (bundled with the fork) while keeping Happy crypto/protocol out of codex-core; middle ground between B (no extra process) and A/D (full happy-cli).
- Risks / friction: the bridge tends to accrete key ownership, Socket.IO state, RPC routing, and process lifecycle until it is a second happy-cli daemon — neither small nor clearly better than D, and it still undermines the operator's "direct codex-rs → happy-server" goal.
- Cheapest validation: define the narrowest possible bridge contract and prove session-level sync + one approval round-trip without the bridge needing machine-level logic.
- Disconfirming observation: if the bridge must own machine scope/keepalive/spawn to feel like `happy codex`, it has become happy-cli — prefer D (reuse the real daemon) over reinventing it.

## Recommendation

**B (D-001) for v1 SESSION-LEVEL control, GATED on the Phase-0 spike, with D (D-002) as the explicit protocol-layer fallback.** B is recommended because it is the only direction that delivers the operator's clearly and repeatedly stated goal (integrated, full control, no happy-cli runtime dependency), and because its distinctive cost — the Rust protocol port — is the genuine price of that goal, while the upstream control seam it needs is unavoidable for *any* in-fork full-control design. The recommendation is deliberately **not** a rubber-stamp: it corrects the operator's "overlay-only / launcher-wired" mental model (false — bounded upstream tui/core edits are required), flags the XL size, the perpetual drift tax, and the new audited egress, and makes the Phase-0 feasibility spike a hard gate. If the spike fails, fall back to **D** (same control seam, happy-cli owns the wire). Machine-level scope is deferred for v1 and is the natural home for D's daemon when it lands. The prior read-only mirror is retained as the offline/no-creds degraded fallback.

This is a brainstorm recommendation pending operator/lead confirmation at plan time; the B-vs-D protocol-layer choice can legitimately be deferred until after the Phase-0 spike, since both share the same (highest-risk) Axis-1 seam.
