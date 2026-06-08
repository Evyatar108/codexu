Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

All three lenses ran at xhigh / full-investigation depth and converged hard on the
v1 semantics and the codex-fork-patch verdict. The Devil's Advocate lens contributed
the decisive de-risking evidence (the SessionStart hook payload and rollout-path
materialization ordering) and a third semantics option that dissolves the central fork.

## Central-fork resolution (the decision the brainstorm had to make first)

The seed framed a binary: v1 = (a) FULL remote control vs (b) discoverability + read-only
sync. The Devil's Advocate lens showed this is a FALSE binary that "collapses three
different products into one word: observe, adopt, and control." The synthesized answer:

- **v1 connect-semantics = discoverability + encrypted read-only sync** (semantics b),
  re-framed as an **"unmanaged shadow session"**: the raw codex session appears on the
  Happy tree, its history streams to mobile (E2EE), but mobile does NOT claim to drive
  the already-running native TUI.
- The "control" answer is delivered WITHOUT lying about same-process control: mobile
  offers an explicit **"continue in Happy / spawn managed successor"** handoff that
  starts a FRESH `happy codex` session from the imported thread/history. Full
  same-process remote control is deferred (D-002 opt-in shim, or D-003 fork patch).

Justification: an already-running raw codex TUI embeds codex-core and exposes NO external
control surface; a raw in-process codex can only reach an external app-server via the
`RemoteAppServerClient` path, so retroactive attach is impossible without a fork patch.
Read-only mirroring only READS the natively-written rollout file, so it sidesteps both the
live-process control gap AND the unvalidated app-server-multiplexing assumption
(one-server-per-cwd + happySessionId mismatch invariants).

## codex-fork-patch verdict

**NOT needed for v1 (D-001), and NOT needed for the opt-in shim (D-002).** A codex fork
patch is required ONLY for true same-process control of an already-running raw TUI (D-003),
which is deferred. The SessionStart hook is codex's native external lifecycle seam (zero
upstream-canonical edit; directly analogous to the Claude Code SessionStart hook happy-cli
already installs via `generateHookSettings.ts`). The "no fork patch" claim holds because the
installed codex already ships the SessionStart hook with a `transcript_path` field
(`codex-rs/hooks/src/schema.rs:475-485`, `hooks/src/events/session_start.rs:130-137`) and
materializes the rollout path before exposing it (`core/src/session/mod.rs:3302-3305`).

## Riskiest unknown to validate FIRST (cheapest spike)

A hook-only spike before any product work: install a global `~/.codex/config.toml`
SessionStart **command** hook that appends the raw JSON stdin payload to a file, then start
raw `codex` in new / `--resume` / post-compact / two-parallel-in-one-cwd cases. Accept the
hybrid only if `transcript_path` is non-null early enough, unique per raw TUI, and stable
across restarts. Then kill the daemon, start raw codex, restart the daemon, and prove the
cold-start scanner imports exactly once using deterministic localIds.

---

### D-001: SessionStart-hook → daemon-owned rollout adoption → encrypted read-only "unmanaged" mirror (with explicit managed-successor handoff)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: codex's SessionStart hook fires on every raw start and hands Happy
  the exact `{session_id, transcript_path, cwd, model, permission_mode, source}` on stdin.
  A small happy-cli hook command reads `daemon.state.json.httpPort` and POSTs to a NEW
  loopback daemon route (e.g. `/raw-codex/session-started`); the DAEMON (which holds the
  Happy credentials) creates the E2EE Happy session via `getOrCreateSession`, tails the named
  rollout `.jsonl`, and maps rollout entries → Happy messages with `{managed:false,
  source:'raw-codex', transcriptPath, codexThreadId}` metadata. Mobile renders it as a
  read-only row plus a "continue in Happy" action that spawns a managed successor. Lowest
  codex-patch surface (zero), matches the actual user pain ("stop disappearing"), preserves
  native `codex` UX.
- Risks / friction: (1) the SessionStart runtime emitter / payload nullability for a raw
  interactive TUI is the load-bearing unknown (spike first). (2) MUST key dedup/identity by
  `transcriptPath` or codex thread id, NOT realpath(cwd) hash — multiple raw TUIs can run in
  one cwd and the existing ws discovery is cwd-keyed (`codexAppServerDiscovery.ts:58-64`).
  (3) CANNOT reuse `/session-started` (its schema needs a Happy sessionId + encryption object;
  raw codex must NEVER receive Happy keys) — a new daemon-owned route is required. (4) Dedup:
  use a deterministic localId derived from (codex session_id + rollout line ordinal / item id),
  NOT `randomUUID()` (`apiSession.ts:658-660`; the C-4 lesson from the offline-catchup doc).
  (5) Daemon-down: a hook-only POST fails silently — needs a cold-start orphan-transcript
  scan of `~/.codex/sessions/` as a backstop (C-2/X-4 generalized to live), plus
  torn-line-tolerant tailing + persisted offsets + rollout-rotation handling. (6) UI must
  visibly mark the row read-only so users don't expect control.
- Cheapest validation: the hook-only payload spike above, then a happy-dev-only importer that
  mints one encrypted unmanaged session from one named rollout with deterministic localIds and
  proves exactly-once import across a daemon restart.
- Disconfirming observation: SessionStart cannot supply/derive a stable non-null
  transcript_path early enough, or test users still describe read-only visibility as "not
  solving the core problem."

### D-002: Opt-in PATH shim — `codex` wrapper delegates plain interactive starts to `happy codex`
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: if a user truly wants to DRIVE turns/approvals/interrupts/stop from
  mobile, the only honest non-fork path is to intercept `codex` BEFORE codex starts and
  relaunch through `happy codex`, which already creates the encrypted session, notifies the
  daemon, and starts `codex app-server` with `HAPPY_CURRENT_SESSION_ID` +
  `HAPPY_DAEMON_CONTROL_URL` in the child env (`runCodex.ts:936-945`) over loopback ws-auth
  (`codexAppServerClient.ts:1181-1185`). Full fidelity, still zero codex fork patch.
- Risks / friction: intercepting a popular binary changes habit/scripts/completions; must
  pass through `exec`, `app-server`, `plugin`, `resume` and all non-interactive subcommands
  byte-for-byte untouched; "raw codex auto-connect" becomes a lie (it is now an opt-in
  wrapper). Fallback-to-raw-when-Happy-down gives two semantics under one command; no-fallback
  couples `codex` reliability to daemon health. Must be opt-in + cleanly reversible.
- Cheapest validation: a dev-only `happy install codex-shim --dry-run` that prints which
  binary it would shadow + a one-session temp-PATH wrapper for ONE test user; compare argv,
  exit codes, resume flags, and daemon-down behavior against the real binary before touching
  user PATH.
- Disconfirming observation: common codex workflows break under the shim, or the
  happy-wrapped local experience is meaningfully worse than the native TUI users wanted.

### D-003: Codex fork patch — raw TUI emits/adopts a Happy control lifecycle (deferred)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: the only path to true bidirectional mobile control of the
  already-running native TUI. Best long-term fidelity (native UX + full control).
- Risks / friction: XL. Raw TUI control paths are tightly coupled to embedded codex-core with
  no stable internal control boundary, so it likely needs broad upstream-canonical edits
  rather than a small `codex-rs-overlay/` crate — directly against the minimize-conflict-surface
  tenet (every edit = rebase friction + SANDBOX PATCH marker + patch-surface row + rebase
  note). Risks exposing app-server auth beyond loopback and breaking one-server-per-cwd /
  happySessionId invariants if a TUI and an app-server share a thread (multiplexing assumption
  is unvalidated). Rejected for v1.
- Cheapest validation: spike the smallest `codex-rs-overlay` change that could emit lifecycle
  metadata via the existing notify/hook seam WITHOUT touching upstream-canonical control paths;
  if even that needs canonical edits, the verdict stands.
- Disconfirming observation: a minimal overlay-only seam turns out to be feasible AND a real
  v1 requirement genuinely needs same-process control — neither is currently true.
