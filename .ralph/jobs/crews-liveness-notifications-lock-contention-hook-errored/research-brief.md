# Research Brief: crews-liveness-notifications-lock-contention-hook-errored

## Verified root cause (corrects the original task framing)

The lead-side crash-sweep `sweepMemberCrashNotifications` (`ai-developer-toolkit/plugins/crews/hooks/member-crash-notifications.js:238`) wraps the ENTIRE crew scan in `withStateFileLock(getLatchPath(crew,cwd), cwd, () => {...})` (`member-crash-notifications.js:262-350`). Inside that lock it runs `listNames` + per-member `readManifest` + `getMemberHealth` (which on Windows calls CIM `describeProcess` via `resolvePidAlive`, `hooks/health.js:101-176`) for EVERY member dir. On the `ralph-pipeline` crew there are **555 member directories**, so the lock is held far longer than the DEFAULT 2000ms acquire budget (`withStateFileLock` → `acquireLock(..., DEFAULT_MAILBOX_LOCK_TIMEOUT_MS=2000)`, `hooks/locks.js:223-224,24`). A second lead-side sweeper (a different PROCESS) then times out: `LockTimeoutError: timed out after 2000ms acquiring …/liveness-notifications.json.lock`.

Two lead-side sweepers run in **different processes with independent throttles**:
- listener-loop heartbeat-tick sweep (D-001), in the armed-listener subprocess, in-process closure throttle `lastCrashSweepAt` — `lib/listener-loop.js:408-440` (helpers ~339-424).
- turn-boundary hook backstop (pre-tool-use / stop / session-start), file-stamp throttle `shouldThrottleTurnBoundarySweep`/`turnStampPath` — `member-crash-notifications.js:83-141`, call sites `pre-tool-use.js:475-485`, `stop.js:912-922`, `session-start.js:509-517`.

Because the throttles are independent, both sweepers can fire in the same ~60s window and collide on the long-held lock.

### Two corrections to the original task seed (both source- + log-verified)
1. **The error ALREADY fails soft — NO tool is denied.** All four sweep call sites wrap the sweep in try/catch and only `appendLog('member-crash-sweep-failed …')`. Confirmed by the live log (every occurrence is a `member-crash-sweep-failed` line) and by reading all four call sites. The seed's "the member's tool is DENIED ('hook errored')" premise is incorrect.
2. **The sweep is LEAD-ONLY; members never sweep.** All four call sites gate on `state.role === 'lead'` (or `actorRole === 'lead'`). The seed's "5 concurrent members + the lead all firing pre-tool-use contend" mechanism is incorrect — the contention is the single lead's OWN two sweeper processes (listener subprocess + hook subprocess) racing on a lock held across the 555-member scan. The live log shows only one actor erroring: `name=overview-bookkeeper`.

Consequently the **dead-holder lock-steal** (v3.21.0 L3a, `hooks/locks.js` `isDeadLocalHolderLock`/`lockCanBeStolen`/`acquireLock`) does NOT fix this: it is already active by default for the latch lock, but the contending holder is ALIVE (the lead's other sweeper actively scanning), so the steal never fires.

Real symptoms: (a) recurring `member-crash-sweep-failed` log noise (17+ this session), and (b) a real member-crash notification can be DELAYED (NOT lost — the next successful sweep, the outbox, and listener re-arm still surface it).

## Researcher Findings (Explore agent)
- Core contention: `sweepMemberCrashNotifications()` holds `withStateFileLock(getLatchPath(...))` for the whole crew scan — `member-crash-notifications.js:233-350`.
- Scan cost: `listNames()` over members/leads/tasks `hooks/actors.js:1606-1615`; per-name `readManifest()` + `getMemberHealth()` `member-crash-notifications.js:274-292`; `getMemberHealth()` may do CIM via `resolvePidAlive()` `hooks/health.js:101-176`.
- Two throttles: turn-boundary stamp throttle `member-crash-notifications.js:83-140`; listener-loop closure throttle `lib/listener-loop.js:339-424`.
- Latch semantics: append mailbox first, then write latch; duplicate on latch-write failure is acceptable, silent loss is not — `member-crash-notifications.js:307-349`.
- Tests/runner/versioning: `tests/member-crash-notifications.test.js`, `tests/member-crash-backstop-reset.test.js`, `tests/run.js` (serial-denylist/env-scrub), `scripts/bump-version.js`.

## Architect Analysis (Explore agent)
- Callers: `lib/listener-loop.js:408-438` (uses `sweepResult.appended > 0` to trigger in-tick `deliver('crash-sweep')`); `pre-tool-use.js:477` (`throttle:true`); `session-start.js:510`; `stop.js:914`.
- Lock source: scan under `withStateFileLock` at `member-crash-notifications.js:259-330`; dedupe + `appendSystemMailbox(...)` happen inside that latch lock today at `:302-325`.

## Codex Research (independent validation — converges on the same approach)
- Confirms the long-held lock at `sweepMemberCrashNotifications` (`member-crash-notifications.js:238`) wrapping `listNames`/`readManifest`/`getMemberHealth`/append/latch-write; reset path `:357` ← `hooks/commands/clear-member.js:82`.
- Anchors: `listNames` `actors.js:1606`, `readManifest` `actors.js:630`, `getMemberHealth` `health.js:126` (CIM via `describeProcess`), `appendSystemMailbox` `hooks/mailbox.js:544` (schema validation + recipient mailbox lock; preserve append-before-latch-write), lock primitive `locks.js:171` (DEFAULT 2000ms; dead/stale steal already in `acquireLock`).
- Recommends Approach 1 (two-phase split) as the PRIMARY fix — identical to Copilot's and the architect's recommendation. Phase 1 (no lock): listNames + readManifest + 6 skip guards + getMemberHealth + buildDeadSignature + candidate payload. Phase 2 (brief lock): readLatch + per-candidate dedupe + appendSystemMailbox + setLatchSignature + one latch write if dirty. Preserves no-double-notify (serialize at latch update) + persist-after-append.
- Agrees: do NOT raise the latch timeout; shared throttling is NOT the primary fix (delays detection, less important once lock-hold is tiny). Moving the scan out is safe because the latch never protected manifests/health/ownership (snapshot reads). Optional: revalidate only final candidates before appending (keeps lock cost proportional to notify candidates).
- Regression tests: thrown `LockTimeoutError` from sweep must not make `pre-tool-use` deny/throw; candidate collection must NOT occur under the latch lock; keep `member-crash-notifications.test.js`, `member-crash-backstop-reset.test.js`, `tests/integration/member-crash-listener-delivery.test.js` green.

**3-way research consensus:** Codex + Copilot + the architect/researcher Explore agents all independently recommend the same two-phase lock-window-shrink as the primary fix, agree the error already fails soft, agree NOT to raise the 2000ms timeout, and agree shared-throttle unification is a secondary/optional optimization.

## Copilot Research (independent validation of the primary approach)
- Confirms the lock wraps the entire sweep (`member-crash-notifications.js:262-350`) and the latch only needs to serialize dedupe state, not the O(N) scan.
- Confirms persist-after-append is load-bearing (mailbox append before latch write; lost notifications unacceptable, duplicates acceptable).
- Confirms moving the scan outside the latch does NOT weaken the six skip guards (the latch never protected member manifests or health state anyway). Optional extra safety: re-read ONLY candidate manifests under the short lock before append; do NOT re-run the full crew scan there.
- Recommends the exact two-phase refactor (Phase 1 scan outside lock → `candidates[]`; Phase 2 brief lock for dedupe + append + latch write). No-double-notify preserved because concurrent sweeps serialize at dedupe time.
- Agrees: do NOT raise the 2000ms timeout (would make hook hot paths block longer); shared throttling between listener + turn-boundary sweepers is a reasonable SECONDARY optimization, not the root fix.
- Tests: extend `member-crash-notifications.test.js` + `member-crash-backstop-reset.test.js`; add hook-level fail-soft regression in `pretooluse-*.test.js` / `tests/lib/scenario.js` styles. No package build/typecheck; validate via `node tests/run.js` + `node --check`.

## Consolidated File List

### Files to modify (impl, not this plan)
- `ai-developer-toolkit/plugins/crews/hooks/member-crash-notifications.js` — restructure `sweepMemberCrashNotifications` (scan outside lock; brief lock for dedupe+append+write). Possibly unify throttle (secondary).
- `ai-developer-toolkit/plugins/crews/lib/listener-loop.js` — (secondary) make the D-001 sweep honor a shared per-crew/lead debounce stamp.
- Tests: `tests/member-crash-notifications.test.js`, `tests/member-crash-backstop-reset.test.js`, NEW hook-level fail-soft + lock-window contention test.
- Release stamps (6): `.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json`, root `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `tests/version.test.js` (via `scripts/bump-version.js`); `CHANGELOG.md`; codexu `AGENTS.md` active-plugin-versions table.

### Reference files (read-only)
- `hooks/locks.js` (lock primitives, dead-holder steal, withStateFileLock default 2000ms)
- `hooks/health.js` (getMemberHealth/resolvePidAlive CIM cost)
- `hooks/actors.js:1606-1615` (listNames)
- `hooks/mailbox.js` (appendSystemMailbox, its own mailbox lock)
- `hooks/safe-io.js` (writeJsonAtomicWithRetry)
- `tests/run.js`, `scripts/bump-version.js`
