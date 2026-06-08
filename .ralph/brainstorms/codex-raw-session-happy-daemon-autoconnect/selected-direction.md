---
overviewTaskId: codex-raw-session-happy-daemon-autoconnect
---

## Direction
D-001 — B: Native Rust Happy session client overlay crate (`codex/codex-rs-overlay/codex-happy`), session-scope first. A raw `codex` invocation of our fork binary self-connects to happy-server and becomes a fully mobile-controllable, synced Happy session — with no happy-cli runtime process — by porting the Happy *protocol* client to Rust and driving it through a bounded, registered, rebase-gated upstream-canonical control seam in the codex TUI/core. **Gated on a Phase-0 feasibility spike; D (hybrid, happy-cli owns the wire) is the explicit fallback.**

> Supersedes the prior read-only mirror (`e27720bc`), which is retained only as the degraded fallback. This direction was chosen to honor the operator's explicit, repeated pivot (full bidirectional control, integrated into the fork, no happy-cli runtime dependency). The recommendation is **not** a rubber-stamp: it corrects the "overlay-only / launcher-wired" framing (bounded upstream edits ARE required), sizes the work as XL, and makes the spike a hard gate. See `brainstorm-synthesis.md` for the full per-direction analysis and the B-vs-D tradeoff.

## Goal
After this is built correctly: a user who types `codex` directly (not `happy codex`), using our fork binary with Happy credentials already present, gets a session that **behaves as if they ran `happy codex`** at the session level — it appears on the Happy mobile session tree within seconds, streams its conversation end-to-end-encrypted, and is **fully bidirectionally controllable from mobile**: the user can send turns, the agent's exec/patch approval requests route to the phone and the decision drives the live session, and interrupt/stop work from mobile. All of this runs with **no happy-cli process at runtime** — codex-rs speaks the Happy wire protocol directly to happy-server (and cross-machine only via Microsoft Dev Tunnels). If Happy is not configured / not authed / offline, raw `codex` silently runs as plain vanilla codex (never broken), optionally falling through to the prior read-only daemon mirror when a daemon is present. An explicit `happy codex` (or the `app-server` subcommand) does NOT double-wrap.

Machine-level features (machine presence, spawn-from-mobile, fork-into-worktree, keepalive) are explicitly **out of v1 scope** and deferred (their natural home is the retained happy-cli daemon / direction D).

## Scope

### In Scope
- **Phase-0 feasibility spike (HARD GATE before product work).** Two throwaway probes: (a) prove a *narrow* upstream TUI `AppEvent`/`AppCommand` (+ `core/src/session` event fan-out) seam can tap and inject one full turn + one exec approval + one patch approval + interrupt + stop, in few enough patched upstream-canonical lines to satisfy the codex fork's minimize-conflict-surface tenet (registerable in `codex/docs/implementation/patch-surface.md`); (b) prove a Rust client can round-trip `POST /v1/sessions` (both `dataKey` and `legacy` encryption), a `/v3` message send, Socket.IO `/v1/updates`, and metadata/state optimistic-concurrency (CAS) against a dev happy-server **with no happy-server protocol changes**. Spike outcome decides B vs the D fallback.
- A new fork-exclusive overlay crate `codex/codex-rs-overlay/codex-happy` (zero upstream conflict surface) implementing the Happy **protocol client** in Rust:
  - E2EE matching `packages/happy-cli/src/api/encryption.ts` byte-for-byte: TweetNaCl `box`/`secretbox`, libsodium sealed-box (incl. the `sha512(seed)[0:32]` pubkey derivation), AES-256-GCM `dataKey` mode, Ed25519 auth challenge (`crypto_box`/`xsalsa20poly1305`/`aes-gcm`/`ed25519-dalek`/`sha2`).
  - `getOrCreateSession` (`POST /v1/sessions`, `dataKey` vs `legacy` selection, sealed-box of the data key to the account pubkey) — mirror `api/api.ts`.
  - Socket.IO session-sync client (`path:/v1/updates`, websocket-only): seq-ordered `update` handling, optimistic-concurrency `update-metadata`/`update-state`, `message-consumption` acks, `session-alive` keepalive, smart-reconnect, session-RPC handling — mirror `api/apiSession.ts`.
  - Auth: GitHub device flow (reuse the pattern in `codex-rs-overlay/codex-copilot/src/auth.rs`) + Dev Tunnels connect token (`X-Tunnel-Authorization: tunnel <jwt>`).
  - `@slopus/happy-wire` session/message/metadata schemas as Rust serde structs (a versioned subset; see drift mitigation below).
- A **bounded** upstream-canonical control seam (the unavoidable Axis-1 part), each line carrying a `// SANDBOX PATCH:` marker and registered in `codex/docs/implementation/patch-surface.md` §14/§15:
  - `core/src/session/mod.rs` — fan the single-consumer `Codex.rx_event` event stream out to an optional secondary Happy sink + a way to inject mobile-originated `Op`/`Submission` (incl. approval decisions and interrupt).
  - `tui/src/{app_event.rs, app_event_sender.rs, app_server_session.rs, chatwidget/turn_runtime.rs, approval_events.rs}` — coordinate so approvals route to mobile (and the TUI does not double-answer), and remote turns/interrupt/stop are honored.
- Launcher wiring (`codex-copilot-launcher/src/main.rs` + `config.rs`): on a normal interactive launch with Happy creds present and the feature enabled, attach the `codex-happy` client to the spawned codex-core session. (The launcher cannot host the client across `exec()`; it wires the in-core seam, e.g. via env/config that codex-core reads at session start.)
- **Idempotency**: disable native autoconnect when `HAPPY_CURRENT_SESSION_ID` is set OR the subcommand is `app-server`, so `happy codex` and its spawned app-server child never double-wrap / create duplicate sessions.
- **Graceful fallback**: no creds / not authed / offline → silent vanilla codex within a strict startup-latency budget; optional fall-through to the prior read-only daemon mirror when a daemon is present.
- **Opt-in/config**: build-time default-on with a kill switch in `~/.codex-copilot/config.toml` + an env override (mirror the existing `style_user_messages` / `auto_load_claude_md` launcher-config pattern).
- **Windows**: the `codex.ps1` / launcher path must carry the same behavior; no startup hang or auth prompt on plain `codex`.
- **Network audit**: register the new happy-server + Dev-Tunnels egress in `scripts/audit_network_calls.sh` allowlist + `runtime_audit_allowlist.txt` + `patch-surface.md` §4, with justification; cross-machine traffic stays Dev-Tunnels-only; never bind anything to non-loopback.
- **Drift mitigation**: pin the Rust wire structs to a `@slopus/happy-wire` version and add an in-tree guard/test that fails when the TS schema version advances without a matching Rust update (so the two-implementation tax is *visible*, not silent).

### Out of Scope
- **Machine-level parity for v1**: machine presence on the tree, spawn-from-mobile, fork-into-worktree, worktree spawns, daemon keepalive (`api/apiMachine.ts`). Deferred; natural home is the retained happy-cli daemon (direction D) as a fast-follow.
- **A — launcher delegation into `happy codex`** as the primary design (keeps the happy-cli runtime dependency and the app-server JSON-RPC driver layer). Kept only as a possible transitional safety valve.
- **C — a permanent bundled bridge sidecar** as the primary design (tends to become a second daemon).
- **happy-server protocol/schema changes** — v1 must round-trip the existing server contract; if the spike shows server changes are needed, that is a disconfirming signal to reconsider B vs D.
- Cross-machine transport changes — Dev Tunnels remain the sole cross-machine data path.

## Criteria
- With Happy creds present and the feature enabled, a raw `codex` start surfaces a new Happy server session on the mobile tree within seconds, NOT marked read-only, with codex-flavor metadata.
- From mobile: sending a turn drives the live raw codex session and its streamed output mirrors back E2EE; an exec approval AND a patch approval requested by codex route to mobile and the mobile decision is what the live session acts on; interrupt and stop issued from mobile actually cancel/stop the live turn (not just the Happy client view).
- No happy-cli process is running at any point during the raw `codex` session (verified by process inspection) for the session-level control path.
- Encryption is byte-compatible with happy-cli: a session created by the Rust client is fully readable/controllable from the existing mobile app, and `dataKey` and `legacy` modes both round-trip.
- Explicit `happy codex` (and a `codex app-server` child it spawns) does NOT auto-connect a second time — exactly one Happy session per intended session; no duplicates.
- With no creds / not authed / offline, raw `codex` starts as plain vanilla codex with no added startup hang, no auth prompt, and no error; the read-only daemon mirror engages only when a daemon is present (if that lesser fallback is implemented).
- The upstream-canonical control-seam diff is bounded, each line `// SANDBOX PATCH:`-marked and registered in `patch-surface.md` §14/§15 with an enforcing test/guard; `cargo check --workspace` passes; the network audit passes with the new egress allowlisted + justified.
- A drift guard fails CI when the pinned `@slopus/happy-wire` schema version advances without a matching `codex-happy` Rust update.

## Context

**Three-lens consensus (codex + copilot + devils-advocate), corroborated by a direct source read.** All three lenses named B (native Rust session client) as a real candidate but none endorsed the operator's literal "overlay-only / launcher-wired / zero upstream edits / no happy-cli" shape — that exact shape is not achievable. The synthesis untangles two independent axes: **Axis 1** (the in-fork control seam — required for ANY in-fork full-control design) and **Axis 2** (who speaks the Happy wire — native Rust [B] vs happy-cli daemon [D] vs bridge [C] vs delegate [A]). The operator's "collapse the app-server JSON-RPC layer" insight is correct for the *transport* (`codexAppServerClient.ts` + ws/stdio + discovery/lock all collapse), but what replaces it is a *different* upstream seam, not no seam.

**Two load-bearing findings (verified from source):**
1. The launcher `exec()`s codex-core and exits (`codex-copilot-launcher/src/main.rs:115-180`) — it cannot host a session-lifetime client; the client must live in codex-core's runtime.
2. `core/src/session/mod.rs:372` — `Codex { tx_sub: Sender<Submission>, rx_event: mpsc::Receiver<Event> }`, both `pub(crate)`, `next_event()` pulls the single-consumer mpsc owned by the TUI. **An overlay crate cannot subscribe.** Full control therefore needs a bounded upstream-canonical fan-out + inject seam. The codex feasibility lens independently named the seam files (`tui/src/app_event.rs`, `app_event_sender.rs`, `app_server_session.rs`, `chatwidget/turn_runtime.rs`, `approval_events.rs`) and sized B at **XL**.

**Why B over D despite D being lower-risk.** Since the Axis-1 seam is unavoidable for both, the *only* thing D buys over B is avoiding the Rust protocol port (and keeping Happy egress out of the audited codex-core) — at the cost of the happy-cli runtime dependency the operator explicitly wants to eliminate. So D's advantage is precisely the thing the operator de-prioritized. B is therefore the direction that delivers the stated goal; D is the principled fallback if the Phase-0 spike shows the port or the seam is larger than bounded.

**Three real costs to carry into planning (do not lose these):**
- *Perpetual two-implementation drift tax*: a Rust Socket.IO + NaCl-compatible crypto + AES-GCM dataKey + Ed25519 auth + happy-wire schema + metadata-CAS client must stay in lockstep with the evolving TS `@slopus/happy-wire`/happy-cli. Mitigate with a version-pin guard.
- *New audited network egress inside codex-core*: the fork's whole purpose is non-Copilot egress suppression (`audit_network_calls.sh` 5 phases + `runtime_audit.ps1`). happy-server + Dev Tunnels become new allowlisted destinations requiring patch-surface registration + justification. This is the strongest argument FOR D.
- *E2EE key ownership shift*: the integrated codex process reads `~/.happy` credentials and owns per-session data keys (replaces daemon-sole-holder). Same user/machine trust boundary (the codex child already inherits all `HAPPY_*` env today), but it moves key material into the network-audited binary.

**Open questions for planning** (full list in `brainstorm.json`): exact v1 promise (session-level only — confirmed by all lenses); the Phase-0 spike go/no-go criteria for B vs D; key-ownership acceptability with no daemon; whether expanding codex-core's audited egress is acceptable or itself argues for D; idempotency detection; fallback-latency budget; default-on-with-kill-switch config placement; the drift-tax acceptability.

**Codex fork tenets that bind this work** (from `codex/CLAUDE.md` / `packages/happy-cli/AGENTS.md`): minimize upstream-canonical conflict surface (overlay-first; new file under `codex-rs-overlay/` preferred; upstream edits only at unavoidable seams, each `// SANDBOX PATCH:`-marked + registered); two-commit submodule flow (codex submodule commit first, then codexu pointer bump); `cargo check --workspace` gate; work in a `codex/.worktrees/<task>/` worktree; cross-machine Dev-Tunnels-only; app-server loopback-only security model.

**Note for operator/lead:** this records the brainstorm member's recommended direction (B/D-001), pending confirmation. The B-vs-D protocol-layer choice can legitimately be deferred until after the Phase-0 spike, since both share the same highest-risk Axis-1 seam — planning could begin with the spike + the shared seam and pick the Axis-2 implementation once the spike reports.
