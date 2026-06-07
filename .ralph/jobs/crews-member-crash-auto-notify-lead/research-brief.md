# Research Brief — crews-member-crash-auto-notify-lead

Target: `ai-developer-toolkit/plugins/crews/` (submodule). v3.12.1 current.

## Researcher Findings (exact seams, verified file:line)

1. **`lib/listener-loop.js`** — the lead listener loop (single-actor).
   - Imports: `:4-14` (`consumeMailbox`, `HEARTBEAT_INTERVAL_MS` from `hooks/config`/`hooks/actors`; `markArmed`, `markExited` from `hooks/listener-protocol`).
   - `timeoutMs` parse: `:127-132`; default `null` (indefinite). When `null`, NO timeout/hard-ceiling timers are installed (`:428`, `:440-442`) and the poll loop also gates on `timeoutMs !== null`.
   - Arm: `:239-289` (`markArmed(requireFreshArm:true)`; captures `listenerEpoch` at `:287-289` and threads into every `consumeMailbox`).
   - **Heartbeat timer: `:305-353`** (`setInterval(..., HEARTBEAT_INTERVAL_MS)`). Body: `markArmed` (refresh) wrapped in try/catch + `decideHeartbeatAction` continue/terminate. Closure var `consecutiveHeartbeatFailures` at `:304` is the model for a `lastCrashSweepAt` throttle var. `heartbeatTimer.unref()` at `:354`. **This is the ONLY periodic hook during a quiet indefinitely-armed idle wait → D-001 integration point.**
   - `deliver(reason)`: `:356-393` — calls `consumeMailbox(name, crew, cwd, 'listener', { listenerPid, listenerEpoch })`, then `finish({type:'messages', count, via:reason})`. Function declaration → callable from the heartbeat callback (hoisted within `runListenerLoop`).
   - `bail()`: `:397-415`. Poll timer: `:425-443`.

2. **`hooks/health.js`** — detection (reuse as-is).
   - `isProcessAlive(pid)`: `:13-23` (EPERM→true, ESRCH→false, else null).
   - `deriveHealthState(actorState, pidAlive, heartbeatAge)`: `:46-64`. States: cleared/left/unknown/dead/alive/quiet. **dead** iff `pidAlive===false` OR (`pidAlive===null && heartbeatAge>=HEARTBEAT_STALE_MS`).
   - `getMemberHealth(name, crew, stateCwd)`: `:66-96`. Returns `{name, crew, state, launcherPid, launcherStartedAt, pidAlive, lastHeartbeatAt, lastTurnAt, queuedMailboxCount, unreviewedReviewRequired, actorState, listenerState, reason}`. **NOTE: does NOT return `sessionId` or `createdBy`** — both are read from the manifest internally; the sweep needs them for the latch signature + lead-ownership filter, so either extend `getMemberHealth`'s return (additive, no manifest-count impact) or read the manifest directly in the sweep.
   - Constants in `hooks/actors.js:114-118`: `HEARTBEAT_ALIVE_MS=30_000`, `HEARTBEAT_STALE_MS=5*60_000`.

3. **`hooks/mailbox.js`** — delivery seam (reuse).
   - `appendMailboxWithSender`: `:438-494` (stamps id/seq/sentAt/from/replyTo/hops; logs `mail-queued-no-listener` when recipient unarmed).
   - `appendSystemMailbox(name, crew, cwd, messageOrEnvelope, opts)`: `:541-582`. Stamps `from.role='system'`, `from.routingKind = opts.kind || 'thread-fanout'`. Routes through `buildEnvelope` for schema validation (strict throws under `CREWS_STRICT_SCHEMA=1`) then `appendMailboxWithSender`. `member-left`/`member-joined`/`member-reply`/`proactive-report` all use this. **The crash envelope is written with `appendSystemMailbox(leadName, crew, cwd, {payload}, { kind:'member-crashed' })`.**

4. **`hooks/protocol/envelope.js`** — `kindEnum` `:63-88` (18 kinds incl. operator-direct trio + member-left/joined). `PAYLOAD_RULES` `:96-137` (per-kind required/forbidden subfields; e.g. member-reply/member-joined/member-left/stop-request).

5. **`hooks/protocol/review-required.js`** — `DEFAULT_REVIEW_KINDS` `:1-12` = `[done, question, blocked, operator-direct, operator-direct-summary, escalate-to-operator]`. `envelopeKind` falls back to `from.routingKind` when `env.kind` absent (`:25-30`). System notices like `member-left` are NOT in this list (they are notification-only / not review-required) — but the spawn-prompt + brainstorm REQUIRE member-crashed to be review-required, so **add `member-crashed` here** (this is a deliberate difference from member-left).

6. **`hooks/stop.js`** — `ACK_EXEMPT_KINDS` `:189-196` = `[thread-fanout, thread-notification, member-reply, proactive-report, member-left, member-joined]`. Exemption test `:264`: `from.role==='system' && ACK_EXEMPT_KINDS.has(from.routingKind)`. **Add `member-crashed`** so the lead is not forced into a strict-ack chore for a system notice. (review-required AND ack-exempt = modeled on member-left, except member-left is not review-required and member-crashed IS.)

7. **`hooks/actors.js`** — `listNames(crew, cwd)` `:1144-1153` enumerates members+leads+tasks roots, returns names with a readable manifest. The sweep should filter to MEMBER actors (skip leads/tasks) and skip the sweeping lead's own name — read each candidate's manifest role, or enumerate `getMembersRoot(crew, cwd)` directly.

8. **`hooks/commands/resume-crew.js`** — `repairManifestForResume(name, crew, cwd, includeCleared)` `:276-360`. Captures prior listener state/PID `:284-286`; kills orphan `:328-332`; rewrites `listenerState:'recoverable'`, `lastListenerPid:null` `:333-339`. **Latch-reset wires into this patch block (~`:333-339`).**

9. **`hooks/commands/clear-member.js`** `:1-134`, handler `:63-87`. CLI→`leaveCrewHelper`+`removeLead`; slash→`clearMemberAsLead`. Archives mailbox, removes thread subs, sets `leftAt`/`clearedBy`. **Latch-reset (delete member entry) wires here.**

10. **`tests/protocol-manifest.test.js:22`** — `equal(manifestFields.length, 51, ...)`. A new TOP-LEVEL manifest field bumps this to 52. **Using a separate latch FILE avoids this churn entirely** (Option B advantage). manifest fields confirmed include `createdBy` (string/object/null), `sessionId`, `lastListenerPid`, `lastListenerEpoch`.

11. **Version bump** — `scripts/bump-version.js` touches 6 files (`.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json`, 3 marketplace indexes) + `tests/version.test.js` (7th stamp). Current version `3.12.1` → next `3.13.0`. `CHANGELOG.md` uses `## <version> - <date>` prepend.

12. **Test infra** — no `package.json`; run via `node tests/run.js` (worker-per-file, concurrency 10, 60s target). `node --check <file>` for "typecheck". Relevant test files: `health.test.js`, `mailbox.test.js`, `system-mailbox.test.js`, `protocol-envelope-enforcement.test.js`, `protocol-manifest.test.js`, `operator-envelope-kinds.test.js`. Race-sensitive listener/mailbox tests are in the serial denylist (`tests/run.js`).

## Architect Analysis (design recommendations)

- **Integration:** put the throttled sweep INSIDE the heartbeat `setInterval` callback (`:305-353`), after `markArmed`. The heartbeat timer is decoupled from `deliver()` — so to make the crash row "ride out in the same wake," call `deliver('crash-sweep')` synchronously right after the append (single synchronous JS unit → append-before-consume guaranteed, avoids the v3.12.0 delayed-delivery shape).
- **Throttle state:** module-local closure var `lastCrashSweepAt` in `runListenerLoop` (same lifetime as `consecutiveHeartbeatFailures`). Throttle ≤1/60s (1 in ~6 heartbeat ticks).
- **Roster cost:** O(members) `listNames` + `getMemberHealth` (sync fs + `process.kill(pid,0)`) per throttled tick. Throttling mitigates Windows Defender/indexer lock pressure.
- **Lock ordering:** do NOT run the sweep inside any mailbox-lock scope. Safe order: sweep → `appendSystemMailbox` (acquires lead mailbox+manifest locks fresh, after `markArmed` released its lock) → `deliver` → `consumeMailbox`. No nested lock, no self-deadlock.
- **Latch home — RECOMMEND Option B:** a new lead/crew-level liveness-notifications file, NOT the member manifest. Rationale: (a) avoids racing `repairManifestForResume` (which rewrites the member manifest under its lock); (b) zero churn to the `manifestFields.length===51` exact-count test; (c) multi-lead clean. Generation-scoped signature is the primary dedupe; explicit reset = hygiene/GC + collision defense.
- **Envelope wiring:** add `member-crashed` to `kindEnum` (+ `PAYLOAD_RULES` if required fields), `DEFAULT_REVIEW_KINDS`, `ACK_EXEMPT_KINDS`.
- **Tests:** synthetic dead-member fixture + armed lead listener asserting EXACTLY ONE delivery; zero for quiet/unknown/healthy; no dup across repeated sweeps; fresh notify after resume.

## Codex Research
NOT RUN — codex-exec lens timed out (exit 124, 0 bytes) despite ralph v5.54.0. Same Windows
codex-exec hang the brainstorm hit (it also skipped codex). Reported to lead as kind=progress.
Non-blocking: copilot lens + 2 Explore agents + direct source reads give full coverage.

## Copilot Research (succeeded)
Strongly corroborates the architect. Adds concrete specifics adopted into the plan:
- **Helper module** `hooks/member-crash-notifications.js` with exports
  `sweepMemberCrashNotifications({leadName, crew, cwd, now})`, `buildDeadSignature(health, manifest)`,
  `resetMemberCrashNotificationLatch({memberName, crew, cwd})` — keeps scan logic out of multiple hooks.
- **Latch file** `<crewRoot>/liveness-notifications.json`, guarded by `withStateFileLock` + `writeJsonAtomic`,
  keyed `memberCrash[leadName][memberName] = signature`. Per-lead key matches the delivery model (sweep
  appends to the CURRENT lead's own mailbox) and is multi-lead clean.
- **Sweep algorithm (8 steps):** verify scanner is a lead → enumerate member manifests only → getMemberHealth →
  skip unless `state==='dead'` → build signature `{memberName, sessionId, launcherPid, launcherStartedAt, deadReason}`
  → skip if unchanged from latch → `appendSystemMailbox(leadName, ..., {kind:'member-crashed', summary, message, payload}, {kind:'member-crashed', triggeredBy:memberName})`
  → persist latch ONLY after successful append.
- **D-001:** run sweep inside the heartbeat callback after the heartbeat write, throttled ~60s; if any
  notification appended for a lead listener, immediately call the existing delivery path to wake the idle listener.
- **D-003:** call the same helper in lead **Stop** BEFORE opportunistic `consumeMailbox()` + review-required
  checks (best surface for immediate model-visible delivery when no listener is armed); SessionStart/PreToolUse
  as backstops + latch-reset hygiene home.
- Constraints reaffirmed: keep stdout `{type:'messages',...}` envelope stable (diagnostics → crews.log only);
  throttle to avoid lock pressure; wire the new kind through kindEnum + review-required + ack-exempt + PAYLOAD_RULES
  consistently under `CREWS_STRICT_SCHEMA=1`; separate latch file beats `manifest.custom` (no count churn AND no
  member-manifest write race AND multi-lead clean).

## Consolidated File List

**Files to modify (impl):**
- `lib/listener-loop.js` — D-001 throttled sweep in heartbeat tick + deliver('crash-sweep').
- `hooks/health.js` — (additive) expose `sessionId`/`createdBy` on `getMemberHealth` return OR sweep reads manifest.
- `hooks/protocol/envelope.js` — `kindEnum` + optional `PAYLOAD_RULES['member-crashed']`.
- `hooks/protocol/review-required.js` — `DEFAULT_REVIEW_KINDS`.
- `hooks/stop.js` — `ACK_EXEMPT_KINDS`.
- NEW `hooks/lib/liveness-latch.js` (or similar) — generation-scoped latch read/write + sweep helper (pure-ish, unit-testable).
- D-003: lead turn-boundary sweep entry — `hooks/pre-tool-use.js` / `hooks/stop.js` / `hooks/session-start.js` (lead role) + latch-reset wiring.
- `hooks/commands/resume-crew.js` (`repairManifestForResume` ~`:333-339`) — latch reset.
- `hooks/commands/clear-member.js` (handler `:63-87`) — latch reset.
- `scripts/bump-version.js` consumers: 6 version files + `tests/version.test.js`; `CHANGELOG.md`.

**Files to create (tests):**
- `tests/member-crashed-sweep.test.js` (or similar) — sweep transition + single-delivery + dedupe + reset.
- `tests/member-crashed-envelope-kind.test.js` — kind/review-required/ack-exempt wiring (mirror `operator-envelope-kinds.test.js`).

**Reuse as-is:** `getMemberHealth`/`deriveHealthState`/`isProcessAlive`, `appendSystemMailbox`, `listNames`.
