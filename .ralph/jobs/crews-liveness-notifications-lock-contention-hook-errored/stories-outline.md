# Stories Outline: Fix crews liveness-notifications crash-sweep lock contention

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. All stories target the `ai-developer-toolkit/plugins/crews` submodule; they form ONE serial cluster (same-plugin version/changelog conflicts forbid parallel).*

## US-001: Move the crash-sweep crew scan outside the latch lock
**Description:** As a crews lead running a large crew, I want the member-crash sweep to hold the per-crew `liveness-notifications.json.lock` only for the brief dedupe/append/write, not across the full O(N-members) crew scan, so that concurrent lead-side sweepers stop timing out (`LockTimeoutError`) and the recurring `member-crash-sweep-failed` log noise disappears.
**Acceptance Criteria:**
- [ ] `sweepMemberCrashNotifications` (`hooks/member-crash-notifications.js`) runs `listNames` + per-member `readManifest` + the skip guards + `getMemberHealth` + `buildDeadSignature` into a `candidates[]` array **without holding** the latch lock.
- [ ] The latch lock (`withStateFileLock(getLatchPath(...))`) is acquired only for: `readLatch` → per-candidate re-validation → dedupe check → `appendSystemMailbox` → `setLatchSignature` → final `writeJsonAtomicWithRetry`.
- [ ] **Required** per-candidate manifest re-validation under the brief lock: re-read the candidate manifest and re-check manifest-based guards #1 (role), #2 (intentionally-stopped: `shutdownRequested`/`terminationKind`/`terminatedAt`), #3 (recoverable), #5 (ownership) before append; skip the candidate if any now fails. Do NOT re-run `getMemberHealth` under the lock.
- [ ] Persist-after-append ordering preserved (latch signature set/written only after `appendSystemMailbox` succeeds).
- [ ] No-double-notify preserved: two sweeps over the same dead member append exactly once (second sees the first's latch row).
- [ ] Return contract unchanged: `{ appended, notified }`; throttle short-circuit `{ appended: 0, notified: [], throttled: true }`; `lib/listener-loop.js`'s `appended > 0` deliver path still fires.
- [ ] Corrupt-latch fallback + AC4 latch-write-fail handling unchanged.
- [ ] **Fail-soft regression test**: a forced sweep error (e.g. `LockTimeoutError`) does NOT throw out of `pre-tool-use.js` and does NOT deny the triggering tool. Fixture satisfies the other PreToolUse gates (lead role, armed listener, no pending review-required mail, non-`.crews`-write tool); assert allow/no-deny while the injected sweep throws.
- [ ] **Lock-window test (deterministic)**: via an injected recording lock seam (optional additive `args.withStateFileLock`, default real) OR monkeypatch-before-require of `../hooks/locks` + `../hooks/health`, assert every `listNames`/`getMemberHealth` call is recorded BEFORE the first latch-lock acquisition. No timing claims; no real held-lock 2 s fixtures.
- [ ] **Re-validation TOCTOU test**: flip `shutdownRequested`/`terminationKind` (or `listenerState: 'recoverable'`) between scan and append → zero appends.
- [ ] `tests/member-crash-notifications.test.js`, `tests/member-crash-backstop-reset.test.js`, `tests/integration/member-crash-listener-delivery.test.js` stay green.
- [ ] Full crews suite passes: `node ai-developer-toolkit/plugins/crews/tests/run.js` (with `CREWS_*` + agent-session env scrubbed).
- [ ] `node --check` passes on every touched JS file.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: (Optional / deferrable) Unify the two sweeper throttles to avoid redundant crew scans
**Description:** As a maintainer, I want the listener-loop heartbeat-tick sweep (D-001) and the hook-backstop sweep to share a per-lead debounce so the now-lock-free but still O(N) CPU crew scan does not run redundantly twice per window. **This story does NOT gate the bugfix — US-001 alone resolves the reported `LockTimeoutError`.** Ship only if low-risk; otherwise defer to a follow-up task.
**Acceptance Criteria:**
- [ ] The listener-loop D-001 sweep consults the same shared per-lead file-stamp debounce (`shouldThrottleTurnBoundarySweep`) so at most one sweep performs the full scan per crew/lead per window.
- [ ] **Listener-delivery test**: prove the listener still wakes/drains a crash notice appended by the hook backstop when the listener's own sweep was debounced (the queued envelope is delivered on the listener's next `fs.watch` wake) — `lib/listener-loop.js:424,432`.
- [ ] No regression to D-001 delivery when the listener's own sweep does append (`appended > 0` → `deliver('crash-sweep')`).
- [ ] Crews suite green; `node --check` passes.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Crews release ceremony (version bump + changelog)
**Description:** As a maintainer, I want the crews plugin version bumped and changelog updated so consumers pick up the fix. Must serialize after any in-flight crews impl (e.g. impl-rmoutbox) because it touches the shared version stamps / CHANGELOG / AGENTS.md table.
**Acceptance Criteria:**
- [ ] Version bumped via `scripts/bump-version.js <x.y.z>` (patch bump from whatever crews main is at impl time): updates `.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json`, root `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`, and `tests/version.test.js`.
- [ ] `node tests/version.test.js` green; `CHANGELOG.md` entry prepended describing the lock-window fix.
- [ ] **Two-commit submodule flow**: the impl member commits all the above INSIDE `ai-developer-toolkit/` on its topic branch (no dirty submodule). The codexu parent-pointer bump + codexu root `AGENTS.md` active-plugin-versions table update are the **lead's** responsibility after merging the submodule branch.
**Dependencies:** US-001 (and US-002 if shipped)
**Estimated complexity:** small
