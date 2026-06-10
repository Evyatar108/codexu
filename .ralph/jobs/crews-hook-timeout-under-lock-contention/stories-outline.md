# Stories Outline: Fix the crews hook-timeout cascade (lock-contention + hot-lock starvation)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

Target: the `ai-developer-toolkit` submodule, package `plugins/crews/` (crews v3.19.1). SINGLE serial cluster
(one impl member, one ship) — every story converges on the same version bump + CHANGELOG + AGENTS.md entry and
the three hot-path stories share `actors.js`/`safe-io.js`, so parallel decomposition is NOT recommended.
The submodule push + codexu pointer bump are LEAD-owned (not impl ACs).

## US-001: Dead-holder lock-steal (L3a)
**Description:** As a crews operator, I want an orphaned `.lock` whose holder process is dead reclaimed immediately so that a killed hook does not detonate a 30s lock-contention storm.
**Acceptance Criteria:**
- [ ] New leaf module `hooks/process-liveness.js` exports `isProcessAlive(pid)` (`true|false|null`); `hooks/health.js` re-exports it (single implementation, no `locks.js → health.js` cycle).
- [ ] `acquireLock` (and `acquireStealMutex`) steal an existing lock IMMEDIATELY when `hostname === os.hostname()` AND the PID is a sane positive int AND `isProcessAlive(pid) === false` AND `acquiredAt`/mtime are not implausibly future; otherwise fall back to the existing 30s `lockIsStealable` path.
- [ ] Cascade-repro test: dead local-host holder PID → immediate steal (no ~30s wait); alive PID / foreign host / implausibly-fresh lock → NOT dead-stolen. Uses an injectable liveness seam.
- [ ] `.steal`-mutex orphan test: a `<lock>.steal` with a dead local holder PID is reclaimed immediately, not after 30s.
- [ ] Typecheck passes (`node --check` on changed JS).
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Advisory-only hook-context fail-open write budget (L3b)
**Description:** As a crews hook, I want advisory manifest writes to use a tight single-attempt fail-open budget so that a slow AV-locked write cannot pin the manifest lock across the ~6.5s retry — WITHOUT making protocol-state writes unsafe.
**Acceptance Criteria:**
- [ ] (US-002a, FIRST) Write-site safety classification table is established: BEST-EFFORT/advisory = `turn-observability` `updateManifest`, `claimNagSeq` nag, `markArmIntent`; MUST-COMMIT/transactional = `consumeMailbox` cursor/drain, outbox/report finalization, final Stop `lastSeq`/review-gate update, the v3.6.2 epoch/PID arm claim.
- [ ] (US-002b) A narrow advisory fail-open helper is wired ONLY to the approved advisory sites; `writeJsonAtomic`/`updateManifest` stay FAIL-LOUD by default (no generalized `mailbox.js` fail-open write mode).
- [ ] No-retry-under-lock test: an advisory hook-context write does NOT run the ~6.5s rename-retry loop under the manifest lock; on injected transient failure it fails open (sentinel/`hook-write-budget-exhausted` log) without sleeping the full budget; heartbeat + protocol-state writes do NOT fail open. Uses `sleepFn` injection.
- [ ] Protocol-state write safety test: injected failure on `consumeMailbox`'s cursor/review-required/operator-direct patch leaves `mailbox.json` unemptied (mail retriable); injected failure on outbox/report finalization or the final Stop manifest update is surfaced fail-loud.
- [ ] Heartbeat/listener path keeps the full AV retry budget.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Lock-free heartbeat stamp (L3c)
**Description:** As a crews lead, I want the listener heartbeat written off the manifest lock so that a slow hook holding that lock can no longer starve the heartbeat and reap my listener.
**Acceptance Criteria:**
- [ ] Recurring heartbeat ticks write a tiny lock-free `<actorDir>/heartbeat` `{ ts, pid, epoch }` (full AV retry budget on that small write); the INITIAL arm still claims `lastListenerEpoch`/`lastListenerPid`/`listenerState` under the manifest lock.
- [ ] Path-aware `getListenerState(name, crew, stateCwd, opts)` reads the stamp and uses `stamp.ts` as the primary freshness signal ONLY when `stamp.pid === manifest.lastListenerPid` AND `stamp.epoch === manifest.lastListenerEpoch`; orphan/superseded stamps are ignored (manifest fallback). Pure `deriveListenerState(manifest)` is UNCHANGED.
- [ ] `getMemberHealth` and `snapshotCrew`/`list-members` liveness rows consume the validated stamp `ts` (with `manifest.lastHeartbeatAt` fallback) so a live stamp-only listener is not reported stale/quiet/dead.
- [ ] Heartbeat-not-starved test: under a slow/contended manifest-lock holder the stamp `ts` advances within the reap threshold and `getListenerState` does NOT report `exited`; orphan/superseded-stamp and stamp-absent fallback cases covered.
- [ ] v3.6.2 epoch ownership, `requireFreshArm`/`FRESH_ARM_GUARD_STATES`, and `recoverable` fencing unchanged (existing `consume-mailbox-epoch-fence.test.js` / listener-state tests green).
- [ ] Typecheck passes.
**Dependencies:** US-002
**Estimated complexity:** large

## US-004: Reduce per-hook I/O (L3d)
**Description:** As a crews maintainer, I want fewer file ops per hook fire so that the system stops inviting the Defender locks that trigger the slow writes in the first place.
**Acceptance Criteria:**
- [ ] `updateManifest` skips the write when the merged result equals the current manifest (no-op coalescing).
- [ ] A shared bounded `readEventsTail(path, maxBytes/maxLines)` helper replaces the full `readFileSync` in BOTH `detect-active-bg.js` and `turn-observability.js`, preserving reverse traversal, `lastObservedAssistantMessageId` dedupe, and torn/malformed-final-line tolerance (no regression on `turn-observability.test.js` / `progress-bg-gate.test.js`).
- [ ] File-op-count regression test: the pinned Copilot `PostToolUse` turn-observability fixture (exact inputs in plan AC) drops from the measured pre-fix baseline (8 counted ops) to <= 7, with the transcript access routed through the bounded tail helper. The fs-op counter is TESTS-ONLY (not plumbed through production APIs).
- [ ] Typecheck passes.
**Dependencies:** US-003
**Estimated complexity:** medium

## US-005: Mitigations — timeout bump (L2) + Defender-exclusion docs (L1)
**Description:** As a crews operator, I want the codex/Claude hook timeouts raised and the Defender-exclusion step documented so that the band-aid headroom and the AV-trigger reduction are both in place (without weakening AV resilience).
**Acceptance Criteria:**
- [ ] `.codex-plugin/hooks/hooks.json` + `hooks/hooks.json` PreToolUse/PostToolUse/Stop timeouts set to 30s; `.github/plugin/hooks.json` (Copilot) unchanged.
- [ ] A `.crews/` Windows-Defender real-time-scan exclusion ops note is added to the plugin-local `plugins/crews/AGENTS.md` (mandatory; `README.md` only if operator-facing setup already lives there).
- [ ] Typecheck passes.
**Dependencies:** US-004
**Estimated complexity:** small

## US-006: Release plumbing (impl member; lead owns the push)
**Description:** As the impl member, I want the crews version/CHANGELOG/AGENTS/marketplace updated so the change is shippable, while leaving the submodule push + codexu pointer bump to the lead.
**Acceptance Criteria:**
- [ ] `node scripts/bump-version.js <next>` (minor bump, e.g. 3.20.0) updates all 6 version stamps; `node tests/version.test.js` passes.
- [ ] `CHANGELOG.md` entry + a `## vX.Y.Z` section in `plugins/crews/AGENTS.md` describing the L3a–d + L1/L2 changes and the new heartbeat-stamp / advisory-fail-open contracts.
- [ ] Full suite green: `node plugins/crews/tests/run.js` (Git Bash first on PATH); `tests/split-export-compat.test.js` green (prefer leaf-only exports for new helpers).
- [ ] Do NOT push the submodule `main` or bump the codexu pointer (LEAD-owned two-commit ceremony).
- [ ] Typecheck passes.
**Dependencies:** US-005
**Estimated complexity:** small
