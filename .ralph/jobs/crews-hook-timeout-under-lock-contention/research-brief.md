# Research Brief: crews hook-timeout cascade fix

Target: `ai-developer-toolkit/plugins/crews/` (crews v3.19.1). Read code from the PRIMARY checkout
(`D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews`); the plan worktree's submodule is empty.

All four lenses (researcher, architect, codex, copilot) CONVERGE on the design below.

## Consolidated File Map (file:line, confirmed)

### Locking — `hooks/locks.js`
- `LOCK_STALE_MS = 30000` (`:20`); `DEFAULT_MAILBOX_LOCK_TIMEOUT_MS = 2000` (`:23`).
- `writeNewLockFile()` ALREADY writes `{ pid, owner, acquiredAt, hostname }` (`:41-60`).
- `readLockFile()` (`:63-69`); `lockIsStealable()` uses ONLY acquiredAt/mtime vs LOCK_STALE_MS — **no PID liveness today** (`:71-90`).
- `acquireStealMutex()` (`:92-119`); `stealStaleLock()` via `.steal` mutex (`:121-132`).
- `acquireLock()` EEXIST loop, steals only when `lockIsStealable()` true (`:134-155`).
- `withManifestLock`/`withMailboxLock`/`withStateFileLock` default 2000ms, run callback under lock, release in finally (`:186-224`).
- `isTransientLockOpenError` (`:30-39`).

### Atomic write + retry — `hooks/safe-io.js`
- Retry knobs CREWS_RENAME_RETRY_LIMIT=10 / _BASE_MS=100 / _MAX_DELAY_MS=1000 → cumulative ~6500ms (`:41-65`).
- `renameSyncWithRetry` synchronous, injectable `sleepFn`, `onRetrySuccess(attempts,elapsedMs)` (`:125-155`).
- `sleepSync` Atomics.wait (`:98-107`); `writeJsonAtomicWithRetry` unique-temp + retrying rename (`:157-175`).
- Heartbeat helpers: `classifyHeartbeatError` (`:198-206`), `decideHeartbeatAction` (`:233-247`), `getMaxConsecutiveHeartbeatFailures` (`:225-231`).

### Manifest writes — `hooks/actors.js`
- `writeManifest()` → `writeJsonAtomic(file,state)` (`:618-628`); `updateManifest()` read-merge-rewrite (`:631-638`).
- `touchHeartbeat()`: UNDER `withManifestLock`, writes `lastHeartbeatAt`+`listenerState:'armed'`+`lastListenerSpawnAt`(+`lastListenerPid`/`lastListenerEpoch`); `requireFreshArm` guard (`:1073-1134`).
- `markArmIntent()`: UNDER `withManifestLock`, writes `listenerState:'armed'`+`lastListenerSpawnAt` only (`:1137-1177`).
- `FRESH_ARM_GUARD_STATES = {armed, exited, never-armed}` (top of file).

### Liveness + listener state
- `isProcessAlive(pid)` lives in `hooks/health.js:13-23` — `process.kill(pid,0)`; ESRCH→false, EPERM→true, returns true|false|null.
- **CYCLE HAZARD (codex):** `health.js` imports `actors.js`; `actors.js`/`config.js` depend on `locks.js`. So `locks.js` MUST NOT `require('./health')`. Fix: extract liveness into a LEAF module both import (or a local conservative helper in locks.js).
- `hooks/actor-state.js::deriveListenerState`: HEARTBEAT_STALE_MS_LOCAL = 5*60_000 (5 min); stale `lastHeartbeatAt` → 'exited'; `isStaleArmedManifest` also checks `isProcessAlive(lastListenerPid)===false` (`:54-96`).
- `lib/listener-loop.js`: heartbeat timer calls `markArmed({sessionId,listenerPid})` each tick + `decideHeartbeatAction` recovery (`:358-407`); consecutive-failure cap default 5.

### Hook entrypoints + per-hook I/O
- `pre-tool-use.js`: reads manifest multiple times; WRITES only `markArmIntent` on listener-arm calls (ALREADY conditional) (`:343-425,456-526`).
- `post-tool-use.js`: reads once; WRITES via `claimNagSeq`→updateManifest ONLY when nag due (ALREADY conditional) (`:51-113`).
- `stop.js`: `bumpBlockCount` (`:663-675`), opportunistic `consumeMailbox`, final manifest update, turn-observability (`:747+`).
- `consumeMailbox` (`mailbox.js:635-722`): mailbox lock THEN manifest lock; appends history, fsyncs, rewrites mailbox, updates manifest.
- **Full events.jsonl reads each fire:** `detect-active-bg.js::readEvents` full readFileSync, parses tail ≤5000 (`:126-144`); `turn-observability.js::extractLatestAssistantMessage` reads whole file (`:114-153`), and `turn-observability` ALWAYS updateManifest on a new transcript msg (`:258-277`).

### Hook timeout config
- `.codex-plugin/hooks/hooks.json` + `hooks/hooks.json`: Pre 5s / Post 5s / Stop 10s.
- `.github/plugin/hooks.json`: all 30s (Copilot, ~immune).

### Release machinery
- crews version **3.19.1** (`.claude-plugin/plugin.json`). `scripts/bump-version.js` edits 6 files (3 plugin manifests + 3 marketplace indexes); `tests/version.test.js` pins all. CHANGELOG.md version-sectioned; AGENTS.md `## vX.Y.Z` section convention + "6-file version stamp bump".
- `hooks/config.js` re-export surface is PINNED by `tests/split-export-compat.test.js` (exact count) — adding exports there breaks the snapshot.

### Test infra
- `node tests/run.js` (or `node plugins/crews/tests/run.js` from toolkit root): worker-per-file, per-worker temp HOME/CREWS_HOME, serial denylist (`tests/run.js:39`) incl. `locks.test.js`, `crew-init-race.test.js`.
- Seams: `safe-io` `sleepFn`; tests monkey-patch `fs.renameSync`; existing anchors `listener-eperm-recovery.test.js`, `locks.test.js`, `mailbox-rename-retry.test.js`, `crew-init-race.test.js`, `consume-mailbox-epoch-fence.test.js`, `turn-observability.test.js`, `listener-state-transitions.test.js`.

## Convergent Design (all four lenses agree)

- **L3a dead-holder lock-steal** (`locks.js`): on EEXIST, read holder; if lock `hostname === os.hostname()` AND `acquiredAt`/mtime sane AND `isProcessAlive(pid) === false` → steal immediately (under existing `.steal` mutex). Keep age/future-staleness path as fallback for foreign-host / unknown-liveness / corrupt locks. Use a LEAF liveness helper (avoid the health.js cycle). Injectable liveness seam for deterministic tests.
- **L3b no-6.5s-retry-under-lock**: thread a hook-context write option through `safe-io`→`writeJsonAtomic`→`writeManifest`/`updateManifest`→hook call sites. Hook context = SINGLE attempt under the manifest lock; on transient exhaustion FAIL-OPEN + cheap log, retry on the next hook fire (hooks already tolerate best-effort state). This avoids BOTH the lock-pin AND the overwrite hazard of "rename outside lock". Heartbeat/listener path keeps the FULL ~6.5s AV budget.
- **L3c lock-free heartbeat stamp**: listener heartbeat ticks write a tiny per-actor stamp file (e.g. `<actorDir>/heartbeat`) WITHOUT the manifest lock (own light path, full AV budget). `deriveListenerState` + health/list-members read the stamp as primary/fallback liveness. INITIAL arm still claims `lastListenerEpoch`/`lastListenerPid` under the manifest lock (preserve v3.6.2 ownership + `requireFreshArm` duplicate-listener guard); recurring ticks avoid the full manifest rewrite. Back-compat: fall back to `manifest.lastHeartbeatAt` when the stamp is absent (pre-upgrade actors).
- **L3d reduce per-hook I/O**: (1) coalesce — skip `updateManifest` when the merged patch is a no-op; moving the heartbeat out of the manifest (L3c) removes the single biggest recurring write. (2) shared BOUNDED tail reader for `events.jsonl` reused by `turn-observability.js` + `detect-active-bg.js`. (3) file-op-count regression test via an injectable fs-op counter seam.
- **L2 (mitigation)**: bump Pre/Post/Stop to 30s in `.codex-plugin/hooks/hooks.json` + `hooks/hooks.json` (leave Copilot 30s as-is). Heartbeat-safe; does NOT weaken AV resilience.
- **L1 (mitigation)**: document `.crews/` Windows-Defender exclusions in `README.md`/`AGENTS.md`.

## Bundle verdict (UNANIMOUS): do NOT bundle with `crews-listener-silent-reap-across-idle-investigation`.
L3c fixes the HOT-LOCK heartbeat-starvation reap. That task's recorded evidence (no lock/EPERM lines in the idle gap; attached async-shell reaped by the runtime) is a DIFFERENT mechanism. Ship the hot-lock fix here; keep the attached-shell-reap investigation separate.

## Coupling / sequencing
- L3a + L2 + L1 are independent of the manifest-write changes.
- L3b + L3c + L3d are tightly coupled (all touch `actors.js`/`safe-io.js` manifest-write + heartbeat path); ship together.
- All stories converge on ONE plugin → ONE `bump-version.js` + ONE CHANGELOG + ONE AGENTS.md entry + shared `actors.js`/`safe-io.js`/`locks.js`. Per codexu AGENTS.md "same-plugin parallel = conflict; must serialize" → SINGLE serial impl member (one ship). Internal story order: L3a → L3b+L3c → L3d → L2/L1 → version/CHANGELOG/marketplace.
