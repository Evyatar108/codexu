# Stories Outline: crews pidAlive false-positive (recycled-PID hardening)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Verified tri-state pidAlive in getMemberHealth
**Description:** As an operator/bookkeeper, I want `pidAlive` to reflect whether
the launcher PID is *verified* to be this member's launcher pwsh, so a recycled
or foreign PID never reports a dead member as `alive`, while a transient
verification failure does not flip a live member to a false `dead`.
**Acceptance Criteria:**
- [ ] Extend health.js's `readLauncherPid` (or add a reader) to surface
  `scriptPath` from `launcher.pid` alongside `pid`/`startedAt`.
- [ ] Add `describeProcess` to `hooks/actors.js` `module.exports`
  (`verifyLauncherRecycleSafety` is already exported).
- [ ] Import `describeProcess` + `verifyLauncherRecycleSafety` into `health.js`
  via the existing top-level `require('./actors')` destructure (load-safe per the
  lazy-require cycle analysis).
- [ ] Add `resolvePidAlive(launcher, name, opts)` implementing the **tri-state**:
  no launcher → `null`; cheap `isProcessAlive===false` (ESRCH) → `false` with NO
  `describeProcess` call; Windows → `describeProcess` returns `null` → `null`
  (UNVERIFIABLE), else `verifyLauncherRecycleSafety(...).ok ? true : false`
  (foreign/recycled → `false`); non-Windows → `null` for any non-ESRCH (cannot
  verify ownership), with a documented platform-gap comment.
- [ ] Replace the line-72 bare `isProcessAlive(launcher.pid)` with `resolvePidAlive`.
- [ ] Thread injectable seams `{ describeProcess, isProcessAlive, platform }` through
  an optional 4th `opts` arg on `getMemberHealth` (defaults = real impls);
  3-arg production callers (`crews.js`, `member-crash-notifications.js`) unchanged.
- [ ] `deriveHealthState` is NOT modified (it already maps `false→dead`,
  `null→dead/unknown` by heartbeat, `true→alive/quiet`); the return-object shape /
  51-field manifest pin is NOT modified.
- [ ] `node --check hooks/health.js` and `node --check hooks/actors.js` pass.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Tests — new cases, fixture migration, integration + crash-sweep fixes
**Description:** As a maintainer, I want regression tests proving the tri-state
classification and proving the fix does NOT break existing alive-path or
crash-sweep tests, without spurious real-process dependence.
**Acceptance Criteria:**
- [ ] AC1 recycled-PID (win32): injected `isProcessAlive→true` + `describeProcess`
  foreign image (or pwsh w/ non-matching cmdline) → `pidAlive===false`, `state==='dead'`.
- [ ] AC2 genuinely-alive (win32): injected `describeProcess→{name:'pwsh.exe',
  commandLine:'pwsh -File <spawn-launchers>/<name>-<ts>.ps1'}` + recent heartbeat →
  `pidAlive===true`, `state==='alive'`.
- [ ] AC3 CIM-null unverifiable (win32, Hole #3 closure): injected `isProcessAlive→true`,
  `describeProcess→null` → `pidAlive===null`; recent heartbeat → `state==='unknown'`,
  stale heartbeat → `state==='dead'`. EPERM no longer yields a bare `true`.
- [ ] AC4 no false member-crashed: a fresh-heartbeat member whose `describeProcess→null`
  → `state==='unknown'` AND `sweepMemberCrashNotifications` emits ZERO `member-crashed`
  for it.
- [ ] AC5 verified-foreign is sweep-eligible: `describeProcess` foreign → `pidAlive:false`,
  `state:'dead'`; crash sweep treats it as high-confidence dead (per existing latch/guards).
- [ ] AC6 ESRCH short-circuit: cheap `isProcessAlive===false` → `pidAlive===false` and the
  injected `describeProcess` spy records ZERO calls.
- [ ] AC7 missing launcher.pid → `pidAlive===null`; existing stale/recent fallback preserved.
- [ ] AC8 legacy launcher.pid (no `scriptPath`): falls back to `spawn-launchers` +
  member-name match → genuine legacy launcher reads `pidAlive:true`.
- [ ] AC9 non-Windows: injected `platform` non-`win32`, `isProcessAlive→true` →
  `pidAlive===null`; `isProcessAlive→false` → `pidAlive===false`. Pins the documented gap.
- [ ] AC10 return-shape: existing `PREV_FIELDS` + `NEW_FIELDS` assertions still pass; the
  lead-actor regression case (snapshotCrew classifies a lead) still passes.
- [ ] AC11 migrate existing fixtures: the alive/quiet/shape `health.test.js` fixtures using
  PID 111 (~lines 70-83, 133-175) inject a matching `describeProcess` seam; flip the two
  stale assertions (~line 51 `EPERM→alive`; ~lines 94-97 "pid reuse is not resisted").
- [ ] AC12 integration test: `tests/integration/list-members-health.test.js` `alivemember`
  fixture is a genuine verified `pwsh -File <spawn-launchers/...>` launcher (matching
  `launcher.pid.scriptPath`) so it keeps reading `alive`; suite passes.
- [ ] AC13 crash-test audit: `tests/member-crash-notifications.test.js` audited; any
  PID-stubbed-alive launcher fixture mis-classified under verification is updated; suite passes.
- [ ] AC14 unit tests use injected seams — no real CIM/tasklist spawn in the unit path.
- [ ] `node tests/run.js` passes (Git Bash first on PATH).
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Release surface — version bump + marketplace sync + CHANGELOG + AGENTS.md
**Description:** As a consumer, I want the version bumped and the change documented
so `copilot plugin update` picks it up and future agents understand the
verified-tri-state-pidAlive contract.
**Acceptance Criteria:**
- [ ] `node scripts/bump-version.js <x.y.z>` updates the 6 version-bearing files
  (3 plugin manifests + 3 marketplace indexes) + `tests/version.test.js`;
  `node tests/version.test.js` passes.
- [ ] `CHANGELOG.md` gains a `## <x.y.z> - <date>` entry summarizing the verified
  tri-state pidAlive determination, the Hole #3 closure, and the crash-sweep
  coupling (why unverifiable → `null`).
- [ ] Plugin `AGENTS.md` gains a `## v<x.y.z>` section documenting: the bug, the
  reuse of `verifyLauncherRecycleSafety`/`describeProcess`, the tri-state mapping
  (CIM-null → `null`, definitive-disconfirmation → `false`), the ESRCH cheap
  pre-check, the unchanged `deriveHealthState`/return-shape, the non-Windows
  guarantee scoping, and the gotcha that the two flipped tests + the integration
  fixture change are intentional.
- [ ] Full suite green: `node tests/run.js`.
- [ ] Do NOT git add the gitignored codexu root `CLAUDE.md`; fork-level notes go in
  `AGENTS.md`. (Two-commit submodule ship is lead-owned.)
**Dependencies:** US-001, US-002
**Estimated complexity:** small
