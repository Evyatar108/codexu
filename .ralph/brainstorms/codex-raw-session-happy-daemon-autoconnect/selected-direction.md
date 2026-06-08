---
overviewTaskId: codex-raw-session-happy-daemon-autoconnect
---

## Direction
D-001 — SessionStart-hook → daemon-owned rollout adoption → encrypted read-only "unmanaged" mirror (with explicit managed-successor handoff). A raw `codex` start fires codex's native global SessionStart command hook, which hands the Happy daemon `{session_id, transcript_path, cwd}`; the daemon (the only holder of Happy E2EE credentials) mints an unmanaged Happy session and tails the named rollout `.jsonl` read-only, so the session becomes discoverable + synced on the Happy tree with **zero codex fork patch**, and "control" is offered as an explicit handoff that spawns a fresh managed `happy codex` successor rather than pretending to drive the live TUI.

## Goal
After this is built, a user who types `codex` directly in a terminal (not `happy codex`) — provided they have opted in by installing the global Happy SessionStart hook once — sees that session appear automatically on the Happy mobile session tree as a **read-only "unmanaged" mirror**: its conversation history streams to mobile end-to-end-encrypted and stays in sync as the terminal session continues. The raw native `codex` TUI experience is unchanged. Mobile exposes a single forward action — "continue in Happy" — that spawns a fresh **managed** `happy codex` session seeded from the imported thread/history; it does NOT claim to drive turns/approvals/interrupts on the already-running raw process. Raw codex sessions are no longer permanently invisible.

## Scope
### In Scope
- v1 connect-semantics decision: **discoverability + encrypted read-only sync** (the "unmanaged shadow session"), NOT same-process remote control.
- A happy-cli-installed **global `~/.codex/config.toml` SessionStart `command` hook** (analogous to the Claude Code SessionStart hook already installed via `generateHookSettings.ts`). The hook reads `daemon.state.json.httpPort` and POSTs the hook stdin payload to the daemon.
- A **new daemon-owned loopback control route** (e.g. `POST /raw-codex/session-started`) — NOT a reuse of `/session-started` (whose schema requires a Happy sessionId + encryption object; raw codex must never receive Happy keys). The **daemon** owns Happy credential + `getOrCreateSession` (E2EE) creation, so no Happy key material ever crosses into codex.
- A daemon-side **rollout-file tailer** that imports the named `~/.codex/sessions/.../rollout-<ts>-<threadid>.jsonl` (session_meta + response_item + event_msg lines) into Happy messages with metadata `{ managed:false, source:'raw-codex', transcriptPath, codexThreadId }`. Torn-line tolerant, with persisted read offsets and rollout-rotation handling.
- **Deterministic localId** derived from (codex session_id + rollout line ordinal / rollout item id) for idempotent E2EE enqueue across daemon restarts (the C-4 lesson; today `apiSession.ts` uses `randomUUID()` which would duplicate on re-import).
- **Identity/dedup keyed by `transcriptPath` / codex thread id, NOT realpath(cwd) hash** — multiple raw TUIs can share one cwd and the existing ws discovery (`codexAppServerDiscovery.ts`) is cwd-keyed.
- A **cold-start orphan-transcript scan** of `~/.codex/sessions/` as the daemon-down backstop (the hook-only POST fails silently if the daemon is not running) — the offline-catchup doc's C-2/X-4 enumeration generalized to live, importing exactly-once via the deterministic localIds.
- A distinct **read-only UI state** for unmanaged raw-codex rows (send/approval/interrupt disabled) + the "continue in Happy" managed-successor handoff action.

### Out of Scope
- **Same-process remote control** of the already-running raw codex TUI (driving turns/approvals/interrupt/stop from mobile). The native TUI exposes no external control surface; this is deferred to **D-002 (opt-in PATH shim)** or **D-003 (codex fork patch)**.
- Any **codex fork patch** / upstream-canonical `codex-rs` edit. v1 uses only the native SessionStart hook seam + natively-written rollout files.
- The **PATH shim** (`codex` → `happy codex`) — tracked as D-002, a separate opt-in/reversible follow-on once read-only adoption proves demand.
- Re-validating or relying on the **app-server multiplexing** assumption (two servers/clients on one thread/cwd); read-only mirroring avoids it entirely.
- Cross-machine transport changes — mirror data uses the existing encrypted Happy relay; cross-machine remains Dev-Tunnels-only.

## Criteria
- A raw `codex` start (with the hook installed) results in a new Happy server session visible on the mobile tree within seconds, labeled read-only / unmanaged, with `source:'raw-codex'` metadata.
- The mirrored conversation history matches the raw codex transcript (titles, message order, boundaries) and continues to stream as the terminal session advances.
- No Happy E2EE key material is ever passed to or stored by the codex process; the daemon is the sole creator of the encrypted session.
- Re-importing the same rollout (e.g. across a daemon restart, or hook POST + cold-start scan both firing) produces **zero duplicate** server-side messages (deterministic localId proven).
- Two raw codex TUIs started in the **same cwd** map to **two distinct** Happy rows (identity keyed by transcript/thread, not cwd).
- With the daemon stopped at raw-codex start and restarted afterward, the cold-start scan imports the missed session exactly once.
- No new network surface beyond the existing loopback daemon port + the existing encrypted Happy relay; the new route is loopback-only.
- Mobile cannot send turns/approvals/interrupts to an unmanaged row; "continue in Happy" spawns a fresh managed `happy codex` session seeded from the imported history without touching the original TUI.

## Context
**Why this direction (3-lens consensus: codex + copilot + devils-advocate).** All three lenses independently rejected "full remote control" as the v1 meaning and recommended discoverability + read-only sync via the SessionStart-hook → daemon-rollout-adoption path with no codex fork patch. The Devil's Advocate lens reframed the central fork as a **false binary** ("observe / adopt / control" are three products) and supplied the decisive third option: an **unmanaged shadow session + explicit handoff**, which gives a credible "control" answer (spawn a managed successor) without lying that the live TUI is drivable.

**codex-fork-patch verdict: NOT needed for v1 (D-001) nor for the opt-in shim (D-002).** A fork patch is required only for D-003 (true same-process control), which is deferred. The "no fork patch" claim is grounded: the installed codex already ships the SessionStart hook with a `transcript_path` field (`codex-rs/hooks/src/schema.rs:475-485`, `hooks/src/events/session_start.rs:130-137`) and materializes the rollout path **before** exposing it to the hook (`core/src/session/mod.rs:3302-3305`). The SessionStart hook is the native external lifecycle seam, exactly analogous to the Claude Code SessionStart hook happy-cli already uses.

**Riskiest unknown — spike FIRST before product work.** Install a global SessionStart `command` hook that appends its raw JSON stdin payload to a file; start raw `codex` in new / `--resume` / post-compact / two-parallel-in-one-cwd cases. Accept the hybrid only if `transcript_path` is non-null early enough, unique per raw TUI, and stable across restarts. Then kill the daemon, start raw codex, restart the daemon, and prove the cold-start scanner imports exactly once with deterministic localIds. (My pre-lens technical explore agent could not locate the SessionStart **runtime emitter** — only the hook discovery/config wiring — so this ordering must be confirmed empirically even though the DA lens cited the schema + materialization site.)

**Key seams / file evidence.**
- Tree visibility primitive: `api.getOrCreateSession(...)` — E2EE, keys live only in happy-cli (`packages/happy-cli/src/codex/runCodex.ts:160-191`).
- Daemon loopback control server: `127.0.0.1` ephemeral port, the binding IS the auth boundary; port published in `daemon.state.json.httpPort` (`packages/happy-cli/src/daemon/controlServer.ts:371-388`, `controlClient.ts:13-20`). Existing `/session-started` schema requires a Happy sessionId + encryption (`controlServer.ts:66-78`) → new route needed.
- codex SessionStart hook: `command`/`prompt`/`agent` kinds, JSON on stdin, global `~/.codex/config.toml` layer; command hooks can block (`FailedAbort`) or observe (`FailedContinue`) (`codex-rs/config/src/hook_config.rs`, `codex-rs/hooks/src/engine/command_runner.rs`, `hooks/src/types.rs`).
- Rollout shape: `CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<threadid>.jsonl`, scanned by path, no separate index (`codex-rs/app-server/tests/common/rollout.rs`).
- Raw in-process codex can reach an external app-server only via `RemoteAppServerClient` (ws/unix) — confirms no retroactive attach to the live TUI without a fork patch (`codex-rs/app-server-client/src/remote.rs`).
- Dedup hazard: `apiSession.ts` enqueues with `randomUUID()` localIds → deterministic derivation required (`docs/plans/offline-catchup-and-sync-architecture.md` C-4).

**Open questions to carry into planning** (full list in `brainstorm.json`): exact v1 user promise + whether same-process control is explicitly out of scope; durable dedup identity choice; daemon-down authority (hook vs cold-start scan); read-only UI affordance shape; whether a happy-cli-installed global hook is an acceptable consent boundary; loopback-trust acceptability for the new raw-registration route.

**Note for the operator/lead:** this `selected-direction.md` records the brainstorm member's recommended direction (D-001), pending operator confirmation. D-002 (opt-in PATH shim) is the natural fast-follow if/when full mobile control is demanded; D-003 (codex fork patch) stays deferred. Full per-direction synthesis is in `brainstorm-synthesis.md`.
