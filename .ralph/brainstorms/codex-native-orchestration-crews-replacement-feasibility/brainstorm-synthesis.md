Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm synthesis (v2 / D-004): single-writer daemon owns crews' coordination files

> **This supersedes the prior brainstorm's PARTIAL/D-001 ("keep Layer B as-is")
> recommendation.** The operator answered that brainstorm's #1 open question —
> the pain is the **locks (b)** and the **hooks (c)**, not wt.exe tab-spawning —
> and chose a specific new direction (D-004): make ONE persistent daemon the
> sole owner/writer of crews' durable coordination files, with members talking
> to it over IPC instead of file-locks + per-process hooks, preserving Layer B's
> durability value while dropping its mechanism. This brainstorm designs +
> feasibility-checks D-004 and recommends a sub-direction.

## Headline verdict: PARTIAL — GO on dropping the LOCKS, NO on dropping the HOOKS

D-004's verbatim wish — *"a single daemon ... without relying on hooks and
locks"* — welds **two separable mechanisms with opposite risk profiles**, and
all three lenses converged on splitting them:

- **Dropping the multi-process LOCKS via a single-writer daemon → GO-able and
  ~80% already shipped.** The happy-cli daemon's `127.0.0.1` control plane is
  ALREADY a single-writer-over-IPC durable mailbox (agent-comms Scope B). Because
  Node's event loop serializes daemon-internal writes, `LockTimeoutError` /
  EPERM from crews' cross-process `acquireLock` genuinely *disappears* for the
  write path — this is removal, not relocation into an in-daemon mutex with the
  same failure mode.
- **Dropping the per-process HOOKS → throws out the hard operator-gate.** The
  Devil's Advocate's decisive, source-grounded correction (which overturns the
  prior brainstorm's capability-row #3): **in this fork, codex members DO have a
  working Stop/PreToolUse hook surface that honors `decision:'block'`**, and that
  hook — not the lock, not the daemon — is the ONLY thing that can veto a codex
  member's turn-end. A daemon over IPC can refuse the next write and enqueue a
  between-turns wake, but it CANNOT prevent a member from ending its turn.

So the honest framing: D-004 done right = **single-writer daemon (kills the
locks) + a THIN codex hook that QUERIES the daemon over IPC (keeps the hard
gate, does zero file I/O).** The operator's "without hooks" must be amended to
"without LOCKS; thin daemon-querying hooks retained" — UNLESS the operator
explicitly accepts downgrading the hard turn-block to a cooperative/advisory
gate (a real capability regression, see D-002).

## The decisive source corrections (this brainstorm vs the prior one)

| Prior-brainstorm claim | This brainstorm's source-grounded correction |
|---|---|
| "codex has NO native Stop-hook (only `/goal` + `request_user_input`)" — `brainstorm-synthesis.md` capability row #3 | **STALE for the gim-home/codex fork.** crews ships a working codex hook overlay: `ai-developer-toolkit/plugins/crews/.codex-plugin/hooks/hooks.json` wires `codex-stop.js` / `codex-pre-tool-use.js`; `hooks/codex-shim.js` ("codex accepts the universal `decision:block` form"); crews AGENTS.md v3.22.0 "codex progress-bg Stop-hook gate" + `tests/progress-bg-gate-codex.test.js` PROVE a codex member's turn-end is HARD-blocked. The hooks/locks are SEPARABLE. |
| "codex-native replacement ≈ rewriting Layer B in TS — what NEW capability justifies it?" (open Q #3) | The substrate is NOT a from-scratch rewrite: `packages/happy-cli/src/agentComms/` (mailbox.ts + recovery.ts + ingestHandler.ts + the daemon `/agent-comms/send` route) **already ships** the single-writer-daemon + durable-mailbox substrate as agent-comms Scope B. D-004 is "add Layer-B operator-gate semantics ON TOP of a shipped substrate," not "rewrite the substrate." |
| Gap #2: "codex v2 mailbox is in-memory, cannot survive a daemon restart" (`session/mod.rs:1690-1758`) | **Fixed by the substrate's OWN on-disk store.** agent-comms persists `mailbox.json` (cursor + pending) + `history.jsonl` (append-only audit) via `writeJsonAtomically`, with restart recovery (`recovery.ts` re-reads the inbox on startup, enqueues exactly one wake, never consumes). This directly answers the operator's D-004 counter-claim. |

## Does it actually KILL the locks, or just move them? (the hard confront)

**Mostly yes — but only if the daemon becomes the single ACCESSOR, not just the
single WRITER.** Two source-grounded caveats decide the rewrite size:

1. **The consumer is a second writer today.** `mailbox.ts` STILL carries a
   cross-process O_EXCL `withInboxLock` (`mailbox.ts:157-222`) because the daemon
   *appends* (`appendMessage` via `/agent-comms/send`) while each session's own
   bridge *consumes/advances the cursor* (`consumePending` / `markConsumed`) from
   a different OS process — a fact the `mailbox.crossProcess.integration.test.ts`
   regression exists to pin. So Scope B already removed N-member *append*
   contention but has NOT removed all locks. **The lock-killing slice is moving
   `consumePending` + cursor-advance INTO the daemon** so the per-session bridge
   never writes `mailbox.json`. Then the daemon's in-process `inboxChains` promise
   chain (already in `mailbox.ts`) is the single-writer serializer — an in-process
   FIFO with NO `LockTimeout`/EPERM failure class.
2. **The dominant crews EPERM is READER-induced, not writer-induced.** crews'
   v3.24.5 race is a concurrent manifest *READER* holding `manifest.json` open
   (Node `fs` 'r' omits `FILE_SHARE_DELETE` on Windows) blocking a writer's atomic
   rename (`hooks/pre-tool-use.js:583-590`). A single-*writer* daemon does NOT fix
   this unless member *reads* ALSO route through the daemon. **Forensics gate:** if
   >50% of the last ~20 EPERM/LockTimeout incidents cluster at the reader-rename
   site, the daemon must be single-ACCESSOR (all reads + writes via IPC), a
   materially bigger rewrite than "just own the files" implies. (If members touch
   NO files at all — pure IPC — both races vanish.)

## Windows daemon-vehicle recommendation (all three lenses agree)

**Use the existing happy-cli daemon; do NOT use the codex app-server-daemon.**

- The Rust `codex-app-server-daemon` is **explicitly Unix-only** — *"The current
  daemon implementation is Unix-only. It uses pidfile-backed daemonization plus
  Unix process and file-locking primitives, and does not yet support Windows
  lifecycle management"* (`codex/external/repos/codex-patched/codex-rs/app-server-daemon/README.md`).
  Its only websocket transport is marked experimental/unsupported.
- The codex app-server *client* in happy-cli is **one active thread/turn per
  process** (`codexAppServerClient.ts`), not a natural multi-member coordination
  broker, and is one-server-per-cwd by the discovery-lock invariant.
- The **happy-cli daemon** already (a) runs on Windows, (b) binds a `127.0.0.1`
  control plane (`controlServer.ts`, `HAPPY_DAEMON_CONTROL_URL`), (c) IS the
  single writer for agent-comms inboxes via `POST /agent-comms/send →
  appendMessage`, (d) has discovery/lifecycle/locks (`codexAppServerDiscovery.ts`).
  Treat codex app-server as the *session/turn engine + wake consumer*; the happy
  daemon owns the orchestration mailbox/review state.

Cost note (priced into the migration, not free): the daemon becomes a **single
point of failure** with a real Windows-service lifecycle to own (start-on-login,
crash-restart, port binding, the codexu fork-notes landmines: LocalSystem
profile, sc.exe quoting, attached-async-shell silent reap). A daemon that dies
takes ALL members' coordination down at once vs today's localized per-member
lock contention.

## IPC protocol sketch (reuse the shipped loopback control plane)

Transport: **loopback HTTP**, reusing the Happy daemon control plane
(`daemonPost` → `controlServer.ts`); a named pipe is a later Windows-hardening
swap if loopback auth (`X-Loopback-Capability`) is insufficient. Request set
(the part that must be ADDED to today's `/agent-comms/send`-only surface):

- `registerActor/sessionStarted(sessionId, role, parentSessionId, engine, generation)`
- `heartbeat(sessionId, generation, pid, state)`
- `appendMessage(from, to, kind, body, correlationId)` *(shipped today)*
- `readPending(sessionId, cursor)` / `advanceCursor(sessionId, cursor, reason)` *(move OFF the bridge INTO the daemon — the lock-killing op)*
- `submitReport(sessionId, kind, summary, body, acks, decisions, replyTo)`
- `reviewStatus(sessionId) -> {lastReviewRequiredSeq, lastReviewedSeq, blockedReason}`
- `endTurnIntent(sessionId, report?) -> allow/block` *(advisory unless a hook honors it — see operator-gate design)*
- `crashSweep()` / `claimTakeover(member, generation)` / `stopMember(member)`
- wake via the existing MCP `resource_updated` consumer (`mcpNotificationConsumer.ts`) — best-effort hint; recovery re-reads on startup.

## Durability + restart analysis

Strong enough for a PARTIAL: agent-comms persists `mailbox.json` (versioned
envelope, monotonic per-inbox seq, post-drain consume) + `history.jsonl`
append-only audit, validates `sessionId` before any path, and recovers on
restart by re-reading the inbox and enqueuing exactly one wake without consuming.
**Caveat (audit parity):** the `history.jsonl` append is currently *best-effort*
(`mailbox.ts:255-266` — fails soft after `mailbox.json` commits), whereas crews'
drain path fsyncs inbox-history rows BEFORE clearing the mailbox. If operator
incident-response/post-mortem parity matters, history must become fail-loud or
independently recoverable before retiring crews Layer B.

## Operator-gates-without-hooks design (the crux)

agent-comms Scope B has the SUBSTRATE (durable mailbox, monotonic consumer
cursor, history, single-writer daemon, restart recovery) but **~0% of the
operator-gate SEMANTICS**: no review-cursor-as-gate (`lastReviewRequiredSeq` vs
`lastReviewedSeq`), no hard Stop/PreToolUse enforcement, no crash-sweep/takeover
(`member-crash-notifications.js`), no member manifests/registry, no operator
channel (`protocol/envelope.js`). The substrate is the easy ~80%; the
operator-gate semantics are the hard, hook-coupled part.

The hard turn-block has exactly one enforcement seam on a codex member: the
`.codex-plugin` **Stop hook returning `decision:'block'`** (proven hard-blocking
in `progress-bg-gate-codex.test.js`). A daemon can refuse a `submitReport` /
`endTurnIntent` RPC and wake the member, but cannot veto turn-end. Therefore:

- **Keep the hard gate (recommended, D-001):** retain a THIN codex Stop/PreToolUse
  hook that does ZERO file I/O — it only QUERIES the daemon ("is reviewed < required?")
  and emits `decision:'block'`. The lock-grabbing file writes leave the hook;
  the hard veto stays.
- **Or accept advisory (D-002, operator-gated):** members run with NO hooks; the
  daemon refuses the next IPC op + enqueues a between-turns wake. A misbehaving
  member that auto-continues or never calls the daemon ends its turn with its
  cursor behind. This is the operator's literal wish but a knowing downgrade of
  operator-in-the-loop HARD control to a hint.

## Candidate sub-directions (within D-004)

### D-001: Happy-cli daemon owns Layer-B state + a THIN codex hook for the hard gate  (RECOMMENDED)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: best matches the operator's VALUE goal ("keep Layer B's
  value") while granting the SAFE half of the mechanism goal. Substrate ~80%
  shipped (agent-comms Scope B on the happy-cli `127.0.0.1` daemon); moving
  consume+cursor into the daemon makes the in-process `inboxChains` the
  single-writer serializer (no cross-process lock → `LockTimeout`/EPERM write
  class gone); a thin codex hook that only queries the daemon preserves the hard
  `decision:'block'` turn-veto with zero file I/O.
- Risks / friction: only HALF-grants the literal "without hooks" wish (a thin
  hook remains, but touches no files); daemon is a NEW SPOF with a real Windows
  service lifecycle; reader-rename EPERM survives unless member READS also route
  through the daemon; history is best-effort today.
- Cheapest validation: rewrite exactly ONE hook path — the PreToolUse
  `markArmIntent` stamp OR the Stop review-gate check — to call a daemon route
  instead of `withManifestLock`; run a 5-member crew and confirm (a) zero
  `LockTimeoutError`/EPERM in crews.log AND (b) `decision:'block'` still fires on
  an unreviewed codex member turn-end (assert against `progress-bg-gate-codex.test.js`).
- Disconfirming observation: if forensics show the dominant EPERM site is
  concurrent manifest READS (the `FILE_SHARE_DELETE` rename race), single-WRITER
  alone does not fix it — you must move ALL reads through the daemon
  (single-ACCESSOR), a materially bigger rewrite than "just own the files."

### D-002: Pure daemon, NO per-process hooks (operator's literal wish) — only with EXPLICIT acceptance the hard gate degrades to advisory
- Contributing lenses: [devils-advocate, copilot]
- Why this might work: fully grants the verbatim wish; members have ZERO Node
  hook surface; daemon enforces review server-side by refusing the next
  coordination IPC op + the already-shipped between-turns MCP wake; maximally
  simple member side; substrate ~80% shipped.
- Risks / friction: **RED-FLAG.** The hard turn-block is LOST — the daemon cannot
  veto a codex member's turn-end; only the Stop hook's `decision:'block'` does.
  Crews' value proposition (operator-in-the-loop HARD control) silently
  downgrades to a hint a misbehaving member can ignore. A capability regression
  masquerading as a simplification.
- Cheapest validation: spike — make a codex member HARD-stop at turn-end using
  ONLY a daemon signal and ZERO hooks. Expected: it cannot; codex exposes no
  turn-end veto OTHER than the `.codex-plugin` Stop hook.
- Disconfirming observation: if the spike confirms the daemon cannot veto
  turn-end without a hook, D-002 is RULED OUT for any workflow needing the hard
  gate (every ralph review-mail gate today). It survives only if the operator
  KNOWINGLY accepts a soft/advisory gate for codex-only members.

### D-003: Point-fix crews' Windows lock sites; question whether a daemon is needed AT ALL
- Contributing lenses: [devils-advocate]  (corroborated by prior-brainstorm D-003 + `durable-mailbox-channel-wake.md` §3)
- Why this might work: the EPERM/LockTimeout surface is localized — `acquireLock`
  O_EXCL + steal (`locks.js:145-203`), the reader-induced rename race
  (`pre-tool-use.js:583-590`). Three in-place fixes avoid a daemon entirely: (a)
  share-delete manifest READS so a reader can't block a writer's atomic rename;
  (b) an in-process advisory write-queue for the LEAD (the dominant writer); (c)
  codex-only migration ALREADY shrinks N (lead-writes + occasional member-reads),
  so multi-writer contention is structurally small. `durable-mailbox-channel-wake.md`
  §3 already REJECTED moving crews storage off the filesystem mailbox.
- Risks / friction: won't hold if incidents spread across MANY lock-sites, or if
  the operator's real goal is architectural (single persistent owner of the
  files) rather than incident-rate reduction.
- Cheapest validation: bisect the last ~20 crews EPERM/LockTimeout/`UNKNOWN`
  incidents; if >50% cluster in the reader-rename + steal sites, point-fixing
  dominates a daemon on cost.
- Disconfirming observation: if incidents are systemic across many distinct
  hook lock-sites, OR the operator confirms the daemon is wanted for
  persistence/single-owner architecture independent of incident-rate, then
  point-fixing is insufficient and D-001 is the right scope.

### D-004: Codex app-server ITSELF as the coordination daemon  (NO-GO on Windows now — answers the operator's "app server if possible?")
- Contributing lenses: [copilot]
- Why this might (eventually) work: codex app-server has thread/turn APIs and
  bounded queues; if it gained supported Windows daemon lifecycle + durable
  multi-client coordination storage + a hard turn-complete policy hook, a
  codex-native owner is conceivable.
- Risks / friction: the daemon lifecycle package is **Unix-only**
  (`app-server-daemon/README.md`); websocket is experimental/unsupported; the
  happy-cli app-server client is one-thread-per-process / one-server-per-cwd.
  Shipping against an explicitly-unsupported Windows daemon path creates a
  reliability story WORSE than the current lock pain.
- Cheapest validation: run one Windows app-server with two independent ws
  clients, post coordination-like RPCs while one disconnects, restart, verify
  persisted cursor/audit survives. Expect failure/unsupported edges today.
- Disconfirming observation: revisit only if codex app-server gains supported
  Windows daemon lifecycle + durable multi-client coordination + a hard
  turn-complete policy hook.

## What must ship to flip the verdict to GO (gate list)

1. **Daemon-owned consume + advanceCursor** so session bridges never write
   `mailbox.json`/cursor files (the lock-killing primitive). For full
   lock-elimination on Windows, route member READS through the daemon too
   (single-ACCESSOR), or confirm by forensics that the reader-rename race is not
   the dominant incident site.
2. **Daemon-owned review-mail protocol:** `lastReviewRequiredSeq` /
   `lastReviewedSeq` as a gate, ack/decision rows, operator-direct / escalate /
   member-reply envelope semantics.
3. **Durable crash/liveness/takeover state** matching crews' member-crashed latch
   + high-confidence dead-member sweep.
4. **A hard turn-boundary enforcement decision:** either keep a thin
   daemon-querying codex Stop/PreToolUse hook (D-001), or an explicit
   operator-approved downgrade to cooperative daemon advisories (D-002).
5. **Audit parity:** append-only `history.jsonl` made fail-loud/recoverable if
   operator incident response depends on it.
6. **Windows daemon-lifecycle smoke:** reboot/restart recovery, stale-PID
   cleanup, version-upgrade behavior, two-member concurrent send/drain with NO
   lockfile contention, daemon-SPOF recovery without message loss.
7. **Migration parity tests** proving today's crews value survives: message
   survives offline receiver, review-cursor monotonicity cannot regress,
   unreviewed mail blocks-or-wakes as designed, crash notice not stranded, killed
   daemon recovers without loss.

## Conflict surface (repos/plugins a D-004 build touches)

- **packages/happy-cli/** (highest-churn): `src/agentComms/` (move consume+cursor
  + add review/report/crash protocol), `src/daemon/` (controlServer/controlClient
  new routes), `src/codex/` (agentCommsBridge, mcpNotificationConsumer wake).
- **crews plugin** (`ai-developer-toolkit/plugins/crews/`): hooks rewritten to
  query the daemon instead of `withManifestLock` (D-001 thin-hook), or removed
  entirely (D-002); `.codex-plugin/hooks/` is the load-bearing hard-gate seam.
- **codex submodule**: NO edits required for D-001/D-002 (app-server stays the
  session engine); D-004 vehicle would need a Windows app-server-daemon port
  (out of scope).

## Open questions carried to planning

1. Does the operator ACCEPT downgrading the hard turn-block to a
   cooperative/advisory daemon gate (→ D-002), or is hard `decision:'block'`
   parity required (→ D-001 thin hook)? This is the single decision that picks
   the direction.
2. Forensics: do the EPERM/LockTimeout incidents originate in concurrent WRITES
   (single-writer daemon fixes) or concurrent manifest READS (the
   `FILE_SHARE_DELETE` rename race, which needs single-ACCESSOR)? Decides the
   rewrite size.
3. Must `history.jsonl` become fail-loud before crews audit behavior is retired?
4. Who owns the daemon's Windows lifecycle (start-on-login, crash-restart,
   supervised service), and is the daemon-SPOF blast radius acceptable vs today's
   localized per-member lock contention?
5. Is cross-engine loss (Claude/Copilot members) fully accepted for ralph
   brainstorm/plan lenses too, or only for routine members? (Operator already
   accepted codex-only for members; lenses are the residual.)
