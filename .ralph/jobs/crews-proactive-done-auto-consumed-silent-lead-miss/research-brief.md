# Research Brief — crews proactive-terminal-report deliver/consume silent-loss race

Task: `crews-proactive-done-auto-consumed-silent-lead-miss`. Crews plugin source at
`ai-developer-toolkit/plugins/crews/` (current version **3.6.1**). Plan deliverables live in
codexu `.ralph/jobs/`. IMPL is a two-commit toolkit-submodule ship and must SERIALIZE after
the in-flight `impl-d001-toolkit-guard` (both toolkit).

## Researcher Findings (terrain map — Claude sonnet)

### Mailbox delivery/consume path
- `consumeMailbox` (hooks/mailbox.js:526-575): under `withMailboxLock`. sessionId fence at :535-536
  (throws IdentityMismatchError only on a DIFFERENT session); recoverable fence :544-546; empty
  return :551; drain loop :556-560 stamps each history row with `consumedAt: now` (:558) and tracks
  `lastReviewRequiredSeq` (:559); fsync :561-562; clears mailbox.json via writeJsonAtomic(mailboxTemplate()) :563;
  manifest patch lastInboxSeq/lastInboxAt + (review-required) lastReviewRequiredSeq/...DeliveryAt :564-572.
  KEY: `consumedAt` is stamped at DRAIN time by whoever drains — NOT a lead-review signal.
- THREE consumeMailbox callers:
  1. `lib/listener-loop.js:223` deliver(): consume → markExited(:230) → finish({type:'messages'},0)(:232-239).
     ONLY path that emits a `{type:messages}` envelope → runtime system_notification (via subprocess exit/stdout).
     Triggers: tryDeliver('initial') :262, ('poll') :267, fs.watch ('watch') :275.
  2. `hooks/stop.js:889` opportunistic: gated `if (listenerState !== 'armed')` :886; surfaces via
     `decision:block` reason body :891-899 (NO {type:messages} notification).
  3. `hooks/user-prompt-submit.js:74` /wake: consume → surface in block body → markReviewed (:80-84).
- `appendSystemMailbox`/`appendMailboxWithSender` (hooks/mailbox.js:403-436,482+): under withMailboxLock,
  envelope.seq = messages.length+1 (:425).

### Listener lifecycle + duplicate-listener guards
- actor-state.js:13-31 LISTENER_STATES = [never-armed, armed, exited, recoverable]; transitions :28-32.
- getListenerState/deriveListenerState (actor-state.js:60-97): stale-armed → 'exited' when heartbeat
  >= HEARTBEAT_STALE_MS (5min) OR isProcessAlive(lastListenerPid)===false.
- touchHeartbeat/markArmed (actors.js:893-985): recoverable early-return; session fence; the
  requireFreshArm guard (v1.2.10/12) returns {skipped,'already-active-listener',existingPid} when
  requireFreshArm AND listenerState ∈ FRESH_ARM_GUARD_STATES {armed,exited,never-armed} AND
  Number.isInteger(lastListenerPid) AND lastListenerPid !== caller PID AND heartbeat fresh AND alive.
  markArmed writes lastListenerPid under the manifest lock (listener-loop passes listenerPid=process.pid).
- markArmIntent (PreToolUse-owned): stamps listenerState:'armed' INTENT, does not claim PID — and in
  its non-skip branches sets lastListenerPid:null / lastHeartbeatAt:null (the TOCTOU — see architect).
- markExited (actors.js:1043+): recoverable + session fences. Called by listener-loop on delivery(:230)/error(:225).
- Heartbeat timer (listener-loop.js:168-217): 10s; v3.5.0 decideHeartbeatAction continue-vs-terminate;
  5-consecutive-failure cap so heartbeat staleness can't cross HEARTBEAT_STALE_MS (prevents 2nd listener).

### Proactive report production + routing (hooks/stop.js proactive-routing block)
- Terminal-gated v2 batch (member, terminal outbox batch, NOT a direct reply) → appendSystemMailbox to
  the createdBy lead with kind='proactive-report', payload {memberName, outboxSeq, outboxId, entries[]}.
- Lands in leads/<lead>/mailbox.json + mailbox-history.jsonl; the history row's consumedAt is stamped at drain.

### Review cursors
- lastReviewRequiredSeq set by consumeMailbox (:569). lastReviewedSeq set ONLY by markReviewed
  (actors.js:987-1030, monotonic max, session fence) via review-mail / /wake AFTER content surfaced.
- Stop-hook review gate fires when lastReviewRequiredSeq > lastReviewedSeq (CREWS_REVIEW_MODE enforce/advisory/off).
- NOTE: the bug card said "reviewed cursor advanced"; on disk it is lastReviewRequiredSeq that advances at
  consume — lastReviewedSeq is NOT advanced by a drain. Either way the lead never saw the content.

### Reuse + tests + release
- Reuse: hooks/locks.js (withMailboxLock/withManifestLock), hooks/safe-io.js (writeJsonAtomicWithRetry),
  {sessionId} opt threading.
- tests/run.js: per-file Workers (conc 10), --serial-denylist for race-sensitive files, per-worker temp
  HOME/USERPROFILE/CREWS_HOME, cleared session env. Model new test on
  tests/integration/proactive-report-progress-tail.test.js (simulateStopTurn) + tests/listener.test.js
  (spawn listener, assert {type:messages} envelope) + tests/mailbox.test.js (drain/append/drain seq).
  tests/lib/force-response.js runStop spawns the Stop hook.
- Release stamp surface: scripts/bump-version.js stamps 6 files — crews/.claude-plugin/plugin.json,
  crews/.github/plugin/plugin.json, crews/.codex-plugin/plugin.json, .claude-plugin/marketplace.json,
  .github/plugin/marketplace.json, .agents/plugins/marketplace.json — plus tests/version.test.js. Then
  CHANGELOG.md (prepend) + AGENTS.md (new section).
- Naming: camelCase fns (append*/mark*/read*/write*/with*); fields *At/*Seq/*State/*Pid; crews.log lines
  `event-name key=value ...`.

## Architect Analysis (root cause + fix — Claude opus)

### Root cause — Mechanism A (orphan/duplicate listener): CONFIRMED DOMINANT
- markArmIntent (actors.js ~957-983) sets `lastListenerPid: null` in its non-skip branches. The next
  listener's markArmed(requireFreshArm) guard requires `Number.isInteger(current.lastListenerPid)` —
  FALSE when null — so the guard does NOT fire and a SECOND same-session listener arms while the first
  is still alive/about-to-deliver. consumeMailbox's sessionId fence (:535) rejects only a DIFFERENT
  session, so a same-session orphan is NOT refused → it can win withMailboxLock and drain.
- Result: one listener drains + exits with {type:messages} on ITS stdout; the runtime is awaiting a
  DIFFERENT (newer) listener subprocess → that notification is lost; the live listener then drains an
  empty mailbox and never notifies. On disk: consumedAt ~immediately after writtenAt (the live-evidence
  125ms), mailbox.json empty, lastReviewRequiredSeq advanced, NO lead notification. Matches arm-60..arm-65 churn.

### Root cause — Mechanism B (Stop-hook opportunistic-consume TOCTOU): CONFIRMED SECONDARY
- stop.js reads listenerState (:886) then consumes when !=='armed' (:889); window where the live
  listener just markExited and is about to exit. Surfaces via decision:block — for a LEAD on Copilot,
  agentStop fires per-turn so the block reason should reach the model (adequately defended). The 125ms
  evidence (no model turn) implicates the listener, not Stop → B is secondary. Fix should defend it but
  it is not the primary loss path.

### Recommended fix (lowest-risk, lowest-conflict; covers A primary + defends B)
1. actors.js markArmIntent: STOP clearing lastListenerPid (and lastHeartbeatAt). Leave the old PID so
   the next listener's markArmed(requireFreshArm) can check it; isProcessAlive(old) gates correctly
   (alive→skip duplicate; dead→overwrite). Closes the duplicate-listener TOCTOU; STRENGTHENS the v1.2.10/12 guard.
2. mailbox.js consumeMailbox: add a `listenerPid` opt + PID fence after the sessionId fence — when
   opts.listenerPid is set AND manifest.lastListenerPid is a different integer, return [] (orphan
   refused; mail stays queued for the live listener). This BINDS the right-to-drain to the
   manifest-recorded PID, which equals the runtime-awaited (last successful markArmed) listener. No
   silent loss: mail is either delivered+notified by the live listener or left queued.
3. lib/listener-loop.js deliver(): pass `listenerPid: process.pid` to consumeMailbox.
4. New crews.log line `listener-orphan-consume-refused name=.. crew=.. callerPid=.. manifestPid=..`. No new manifest field.
5. Stop-hook (B): no code change needed for leads (decision:block surfaces per-turn); add a regression case.

### Invariants preserved (architect-verified): the six 1.2.1 listener-race/mailbox-fence properties;
v1.2.10/12 already-active guard (strengthened); v3.4 lead-unconditional-listener; v3.5.0 EPERM
recovery + cap; v2 one-row-per-kind; recoverable fence. Edit sites are DISJOINT from
impl-d001-toolkit-guard (d001 = spawnMember/codex-shim/session-env/listener-loop usage-text). Only
version files + AGENTS.md + CHANGELOG serialize (LOW, different sections).

### Residual window to test/flag: if a TRUE dual-listener exists (isProcessAlive false-negative) and the
orphan drains in the sub-ms BEFORE the new listener's markArmed writes its PID, the manifest PID may
still be the orphan's → orphan drains+notifies but runtime awaits the new one. The PID-fence + the
markArmIntent change together shrink this to a narrow window; the worst case is mail LEFT QUEUED (no
silent loss), because an orphan whose PID is NOT the manifest PID returns []. Cover with the regression test.

### Regression test (model on tests/integration/proactive-report-progress-tail.test.js)
Two same-session listeners (orphan PID=100, current PID=200) race ONE queued proactive done. Assert:
(1) current (manifest PID) drains the message + commits consumedAt + advances lastReviewRequiredSeq;
(2) orphan (non-manifest PID) consumeMailbox returns [] + no consumedAt committed + mail stays queued +
crews.log has `listener-orphan-consume-refused`; (3) Stop hook skips consume when listenerState==='armed';
(4) markArmIntent does NOT clear lastListenerPid (old value retained; new markArmed overwrites it).

## Codex Research — Failed
codex-research.txt not produced (the attached async shell was killed at the planning member's turn-end /
session shutdown). Additive only; not blocking. Codex/Copilot are RE-USED for Phase-4 plan review (run detached).

## Copilot Research — Failed
copilot-research.txt produced only ~332 bytes of streaming preamble before the attached async shell was
killed at turn-end. Additive only; not blocking.

## Operator steering note (folded into plan)
Operator: "I recently updated codex here from 125 to 135 maybe its related." Assessment: the codex
125→135 engine update is a plausible AGGRAVATOR, not the root cause. If the affected lead/member sessions
run the codex engine, codex 135 may change PreToolUse/SessionStart/Stop hook cadence or flush timing,
increasing listener arm-churn (more markArmIntent calls → more PID-clearing windows → more duplicate
listeners) and interacting with the known Windows events.jsonl ~100ms flush race. The recommended fix is
ENGINE-INDEPENDENT (it closes the race at the consume layer), so it is resilient to whatever hook-cadence
change codex 135 introduced. Open Question OQ-1 asks the impl to confirm the affected sessions' engines and
whether codex 135 changed hook cadence, as supporting evidence (not a gate on the fix).

## Consolidated File List
Files to modify (crews plugin):
- hooks/actors.js (markArmIntent: stop clearing lastListenerPid/lastHeartbeatAt)
- hooks/mailbox.js (consumeMailbox: add listenerPid opt + PID fence + crews.log line)
- lib/listener-loop.js (deliver(): pass listenerPid: process.pid)
Test:
- tests/integration/proactive-report-silent-loss-race.test.js (NEW) — model on proactive-report-progress-tail.test.js
- possibly tests/listener-redundant-arm-skip.test.js (extend for markArmIntent-no-clear)
Release ceremony:
- scripts/bump-version.js run (stamps the 6 files) + tests/version.test.js
- CHANGELOG.md (prepend), AGENTS.md (new section)
Reference: .ralph/investigations/crews-implement-with-ralph-parallel-outbox-silent-loss/findings.md (same family).
