# T6 Path B-lite — Handoff for the Copilot fork agent

**Status:** Feasibility-verified implementation directive. Companion to
`t6-remote-steering-design.md` (the full T6 design); this document supersedes
that doc's §4 open decision ("Path A vs Path B") with an operator-approved
third option, and records the source-verified evidence that it is clean.

**Operator decisions locked in (2026-07-31):**

| Decision | Choice |
|---|---|
| Mechanism path | **Path B-lite**: ride Mission Control's `PromptManager`/`CommandPoller` via injection on our Copilot fork — new fork-local adapter files + one small hook, **zero edits to upstream-owned Mission Control files**, nothing shipped upstream, minimal rebase conflict surface |
| Destructive permission kinds | Terminal-only even under a full lease |
| §5.1 upstream bugs (provider conflation, `setForeground` guard) | File upstream issues first; coordinate with the Runtime team before fixing in shared code |
| Default steering scope (first grant) | `answer-prompts` only (approve/deny; no input/abort/foreground) — broaden later via explicit terminal grants |

**Investigation provenance:** read-only source investigation (GPT-5.6 Sol, max
effort, 2026-07-31) against worktree
`C:\efforts\copilot-agent-runtime\.worktrees\copilot-happy-interactive-embed-seam`,
branch `local/copilot-happy-interactive-embed-seam`, HEAD
`1f19c0c1ccd2502b1cce8372419a831cf533f37f`. All file:line citations below are
against that HEAD. The worktree's staged product files were untouched.

---

## 1. Verdict

**Clean (option a).** Happy can be attached as a Mission-Control-style remote
actor for the foreground interactive session with:

1. a Happy event publisher,
2. a queue-backed `MissionControlCommandClient` implementation,
3. a small actor owning a `PromptManager` + `CommandPoller` pair,
4. attach/detach wiring at the existing embedded-server foreground seam.

No Mission Control source file needs modification. Only generic headless or
simultaneously-steerable *background* sessions would expand this to a bounded
fork patch (out of scope for v1).

**Critical construction insight:** do NOT build a "HappyRemoteExportSession"
transport. `RemoteExportSession` represents the **local agent session**, not
the remote transport (`src/core/sharedApi/remoteExportContracts.ts:56-85`).
Pass the existing concrete `Session` — it already exposes itself as
`promptFallback` (`session.ts:5704-5737`). The transport-side seam is
`MissionControlCommandClient` (inbound commands) plus your own event publisher
(outbound events).

## 2. Why the seams are clean (verified)

### 2.1 `RemoteExportSession` — interface, transport-neutral

- Public TypeScript **interface**, not a class
  (`remoteExportContracts.ts:56-85`). No URLs, GitHub clients, tokens, or auth
  anywhere in it.
- `PromptManager` actually uses only: `session.promptFallback` in its four
  response handlers (`promptManager.ts:215-239, 245-268, 274-299, 306-369`)
  and `session.readPlan()` inside `wrapExitPlanMode`
  (`promptManager.ts:498-512`).
- `promptFallback`'s complete surface: four lookups + four responders
  (`remoteExportContracts.ts:40-54`).
- Existing precedent adapter is straightforward delegation
  (`localSessionManager.ts:1872-1920`).

### 2.2 `MissionControlCommandClient` — one-method interface

- Exactly one method: `listSessionCommands(sessionId): Promise<ListSessionCommandsResult>`
  (`commandPoller.ts:76-83`).
- The cloud-coupled `MissionControlClient` (base URL, auth token, native HTTP;
  `missionControlClient.ts:60-91`) is NOT required — `CommandPoller` depends
  only on the interface.
- Command shapes are semantically generic: text, ask-user answer, plan
  approval, permission answer, elicitation answer, abort, mode switch
  (`missionControlContracts.ts:21-29, 160-189`). The envelope is cloud-shaped
  (`session_id`, numeric `user_id`, `external_id`, timestamps, state —
  `missionControlContracts.ts:37-48`); runtime dispatch meaningfully uses only
  ID, state, type, content, external ID. The Happy adapter synthesizes the
  unused fields.
- `CommandPoller` calls on the session: `send()`, `abort()` (+ optional
  `clearPendingItems()`), `commands.invoke()`, `log()`, `currentMode`
  getter/setter (`commandPoller.ts:236-280, 285-341`).
- Polling cadence: 3 s fast → 10 s slow after 600 empty polls (~30 min); any
  non-empty poll resets to fast (`commandPoller.ts:21-23, 52-69`;
  `command_poller.rs:7-15, 55-86`). First poll after the interval, not
  immediate (`api_command_poller.rs:181-200`). 429 honors `Retry-After`
  clamped 1 s–5 min; otherwise 10 s ×1.5 backoff ±20% jitter capped 60 s
  (`command_poller.rs:89-119`). Only unseen `in_progress` commands dispatch;
  IDs deduped in memory (`api_command_poller.rs:226-260`).
- Processed commands are acked on success AND failure to avoid redelivery
  (`commandPoller.ts:190-207`). Mission Control piggybacks ack IDs on the next
  event submission (`remoteSessionExporter.ts:995-1039`); Happy supplies its
  own acknowledgement callback.

### 2.3 Single construction point; Happy bypasses it entirely

- `new PromptManager(...)` and `new CommandPoller(...)` each have exactly one
  production construction site: `RemoteSessionExporter.ensureCommandPollerRunning()`
  (`remoteSessionExporter.ts:1024-1044`), gated on the exporter being
  steerable (`remoteSessionExporter.ts:666-672`).
- The Happy actor does NOT go through `setupRemoteExporter` / `--remote` at
  all, so none of the upstream gating applies: TTY check
  (`index.ts:2001-2009`), GitHub auth wait (`index.ts:4022-4040`), remote-control
  policy (`remoteControlApi.ts:61-116`), token-bearing MC client
  (`setupRemoteExporter.ts:98-190`), `cloud_session_storage_enabled`
  entitlement (`index.ts:3912-3923`). Happy needs only the staged loopback
  token gate (`happyInteractiveEmbed.ts:23-64`).

### 2.4 The injection seam is the staged Happy embedded server

- `EmbeddedServer.registerSession()` resolves and binds the actual foreground
  `Session` (`embeddedServer.ts:328-366`); App calls register/unregister on
  foreground changes (`app.tsx:3280-3309`); teardown points exist at
  `EmbeddedServer.stop()` / `unregisterSession()`
  (`embeddedServer.ts:230-268, 663-670`).

### 2.5 Coexistence with Mission Control (both attached at once)

- The native pending-request store is globally first-wins and tombstoned
  (request ID + tool-call ID, 60 s — `pendingRequestStore.ts:209-223,
  791-857`), so no double-resolution is possible at the base layer.
- BUT two independent `PromptManager` maps do not share local registrations: a
  naïve second manager resolves through `Session.promptFallback` while the MC
  manager retains a stale entry.
- **Required adapter behavior:** delegate Happy prompt responses to the
  currently active Mission Control `promptManager` when its
  `attachedSessionId` matches; otherwise use Happy's own manager/fallback.
  `RemoteControlStatus` deliberately exposes that opaque in-process handle
  (`remoteExportContracts.ts:162-178`); the in-process sessions API returns it
  (`sessionsApi.ts:910-914`). No shared-file patch needed.

### 2.6 Enablement-clobber bug (T6 design §2.1) — this path avoids it

- `PromptManager` never calls `permissions.setRequired()`. The TUI
  independently writes true on mount / false on final departure
  (`app.tsx:2528-2549`).
- The SDK provider-registration path still drives the unowned boolean
  (`sdkServer.ts:4577-4609`; acknowledged clobber comment at
  `sdkServer.ts:4612-4628`; teardown at `sdkServer.ts:4794-4805`).
- Consequence: a **direct in-process Happy actor using PromptManager avoids
  introducing the clobber write**. Attaching Happy as an SDK
  `observePromptEvents` provider would still hit the bug. This is an
  additional argument for B-lite over the v1 SDK-attach design. Note
  PromptManager does not FIX the ownership bug — it just doesn't participate
  in it; the §5.1.3 latch fix remains desirable upstream.

### 2.7 Lifecycle safety

- `PromptManager` has no start/stop machinery; `CommandPoller` is one-session
  with explicit start/stop (`commandPoller.ts:128-147`). Exporter restart
  stops the old pair before initializing the new session
  (`remoteSessionExporter.ts:815-852`).
- Mission Control HTTP failure → retry/backoff only; exporter stop/dispose
  never writes permission enablement (`remoteSessionExporter.ts:707-759`). The
  Happy actor must mirror this: **disconnect/teardown must not touch
  permission state.**
- Interactive MC follows the foreground; App transfers the singleton on
  session switch (`app.tsx:1565-1605, 6285-6305`). Foreground-only is the
  natural v1 shape; concurrent background steering would need a per-session
  actor registry (out of scope).

## 3. Implementation shape (Copilot fork side)

| Piece | Where | Size |
|---|---|---|
| `HappyMissionControlActor` — event publisher, queue-backed `MissionControlCommandClient`, command-envelope normalization, MC prompt-manager delegation (§2.5), `CommandPoller` lifecycle, Happy acks | **New** `src/cli/happyMissionControlActor.ts` | ~150–250 LOC |
| Hook: import/field; construct only for the Happy `publishRegistry` route; attach/swap in `registerSession()`; detach in `unregisterSession()`; dispose in `stop()` | `src/cli/embeddedServer.ts` | ~15–25 LOC |
| Focused tests | new test files | as needed |

**Files that must NOT be modified:** `promptManager.ts`, `commandPoller.ts`,
`remoteSessionExporter.ts`, `remoteExportContracts.ts`,
`setupRemoteExporter.ts`, `app.tsx`, `sdkServer.ts`.

**Known rough edges (accepted):**

- `CommandPoller` is polling-only; its dispatch method is private. v1 uses a
  queue adapter (Happy pushes into a local queue; poller drains it on its 3 s
  cadence). If sub-3 s latency is later needed, a small shared
  `processCommand`/wake patch is the bounded fork-patch escalation — do not do
  it in v1.
- The command envelope carries unused GitHub-cloud fields — synthesize them.
- Prompt publication/reconnect replay is outside PromptManager; ephemeral
  pending prompts (user-input `pendingRequestStore.ts:264-270`, elicitation
  `:316-327`, exit-plan `:684-702`; permissions are durable `:248-261`) need
  buffering/snapshot handling on the Happy side for reconnecting clients.
- PromptManager handles ask-user, elicitation, exit-plan/plan-approval, and
  hook/path/URL/tool permissions. It does NOT handle sampling, external
  tools, session-limit prompts, or auto-mode-switch prompts — those remain
  terminal-only in v1.

**Rebase conflict surface (90-day commit counts at this HEAD):** the single
hook file `embeddedServer.ts` (23 commits/90 d, already fork-touched) is the
only shared-file touch. Avoided hot files: `app.tsx` (384), `index.ts` (174),
`sdkServer.ts` (136), `interactiveMode.ts` (81), `localSessionManager.ts`
(80). MC files themselves are cool (`promptManager.ts` 7, `commandPoller.ts`
11, `remoteSessionExporter.ts` 25) and remain untouched anyway.

## 4. T6 policy layer (from `t6-remote-steering-design.md`, unchanged)

The lease/attribution model rides ON TOP of this mechanism, implemented in
the Happy adapter (fork-local), not in shared code:

- **Steering lease** (§3.3 of the T6 doc): single holder, terminal-granted
  only, short expiry with phone-heartbeat renewal, any terminal keystroke
  revokes, in-memory only. Default scope on first grant: `answer-prompts`
  only. The Happy actor checks the lease before enqueueing any
  send/abort/mode/foreground command; prompt answers require the
  `answer-prompts` scope.
- **Destructive permission kinds are terminal-only** even under a full lease
  (operator decision) — the adapter must refuse to forward those permission
  requests as answerable (observe-only rendering).
- **Attribution:** surface "answered by Happy (device)" via the adapter's
  event publisher; the upstream `answeredBy` completion-event extension
  (§5.2.3) is deferred to the upstream-coordination track.
- **Idempotency:** phone-originated commands carry an `actionId`; the adapter
  dedupes per session with a short TTL before enqueueing (`session.send` has
  no native replay protection).
- **No second token tier:** the existing loopback connection token admits;
  the lease conveys steering authority in memory.

## 5. Upstream coordination track (parallel, not blocking)

Operator decision: **file upstream issues first** for the shared-code bugs;
coordinate with the Runtime team before fixing in shared files. From the T6
doc §5.1, the two filing-worthy items:

1. `observePromptEvents: true` registers permission+elicitation providers
   (`sdkServer.ts:4255-4263`), so a read-only observer's disconnect clobbers
   the host's permission enablement (silent-deny;
   `session.ts:7989-8049`). Blast radius: VS Code extension + Agents tab.
2. `session.setForeground` is unguarded (`serverSeamImpl.ts:372-424`): any
   authenticated connection can redirect the screen to an arbitrary session,
   including cold-loading one it never attached to.

Neither blocks Path B-lite: the Happy actor uses neither the SDK provider
path nor `setForeground` in v1.

## 6. Acceptance criteria for the fork agent

1. New actor file + `embeddedServer.ts` hook only; `git diff` shows no other
   shared-file modification.
2. With Happy attached and Mission Control OFF: phone can approve/deny a tool
   permission; terminal dialog dismisses with the existing "Resolved by
   another client" path; terminal keystroke revocation works.
3. With Happy attached and Mission Control ON (same session): first-wins
   holds in both directions; no stale PromptManager entry (delegation per
   §2.5); no double-ack.
4. Happy disconnect mid-prompt: prompt stays live on the terminal; permission
   enablement untouched (regression test asserting `setRequired` never called
   by the actor or its teardown).
5. Lease enforcement: commands outside the granted scope are rejected with a
   typed outcome, not silently dropped; destructive permission kinds are
   never answerable from Happy.
6. Duplicate `actionId` within TTL: exactly-once effect.
7. Existing embed contract tests (`happyEmbedContract.ts` surface) stay
   green; the read-only v1 posture is unchanged for clients that do not hold
   a lease.

## 7. Pointers

- Full T6 design + evidence: `plans/happy-copilot-terminal-route-v1-design/t6-remote-steering-design.md`
- v1 interactive design: `plans/happy-copilot-terminal-route-v1-design/design.md`
- Implementation contract for the staged seam: `docs/copilot-happy-embedded-ui-server-handoff.md`
- Copilot fork worktree (staged, uncommitted product files — do not reset):
  `C:\efforts\copilot-agent-runtime\.worktrees\copilot-happy-interactive-embed-seam`
  @ `1f19c0c1ccd2502b1cce8372419a831cf533f37f`
