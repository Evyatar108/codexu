# Research Brief: crews pidAlive false-positive (recycled PID)

> Research conducted against the live crews source in the **primary checkout**
> (`D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/`) because the
> plan worktree intentionally leaves the `ai-developer-toolkit` submodule
> uninitialized (`submoduleInitRan:false`). All file:line citations below are
> against crews v3.19.1 on submodule `main`.

## Researcher Findings

### The bug surface: `hooks/health.js`

- `getMemberHealth(name, crew, stateCwd)` — `hooks/health.js:66`. Computes
  `pidAlive` at **line 72**:
  ```js
  const launcher = readLauncherPid(actorDir);
  const pidAlive = launcher ? isProcessAlive(launcher.pid) : null;
  ```
  This is the BARE liveness check the bug report names. It asks "is *some*
  process alive at this PID?" — not "is this PID *this member's launcher*?".
- `isProcessAlive(pid)` — `hooks/health.js:13`. Platform-agnostic
  `process.kill(pid, 0)`:
  - success → `true`
  - `ESRCH` → `false` (definitely gone)
  - **`EPERM` → `true`** ← the v1.2.12 deferred "Hole #3": an unverifiable /
    foreign PID reads as alive.
  - other → `null` (unknown)
- `readLauncherPid(actorDir)` — `hooks/health.js:25`. Reads `launcher.pid` but
  parses **only `{ pid, startedAt }`** — it does NOT read `scriptPath`. The fix
  needs `scriptPath` for the preferred recycle-safety match, so this reader must
  be extended (or replaced) to surface it.
- `deriveHealthState(actorState, pidAlive, heartbeatAge)` — `hooks/health.js:46`:
  - `pidAlive === false` → `dead`
  - `pidAlive === null` → `dead` if heartbeat stale, else `unknown`
  - `pidAlive` truthy + recent heartbeat → `alive`
  - `pidAlive` truthy + stale heartbeat → `quiet`
  So once `pidAlive` becomes `false` for a recycled/foreign PID, the member
  correctly derives `dead`. **`deriveHealthState` needs no change** — the fix is
  entirely in the `pidAlive` determination feeding it.
- Exports — `hooks/health.js:111-115`: `isProcessAlive`, `readLauncherPid`,
  `getMemberHealth`.

### The reusable primitive: `hooks/actors.js`

- `verifyLauncherRecycleSafety(info, opts)` — `hooks/actors.js:2208`
  (**exported** at `hooks/actors.js:3146`). Pure function:
  - `info = { name, commandLine }`.
  - `opts = { memberName, launcherScriptPath }`.
  - Requires `name` ∈ {`pwsh.exe`, `powershell.exe`} **AND** the command line
    carries the spawn marker — preferring the exact launcher-script basename
    (`launcherScriptPath`), falling back to `spawn-launchers` dir marker +
    `memberName` for legacy `launcher.pid` files without a recorded scriptPath.
  - Returns `{ ok: boolean, reason: string }`. **Fail-closed**: every miss
    returns `{ ok:false }`.
- `describeProcess(pid)` — `hooks/actors.js:1977`. Spawns
  `powershell.exe ... Get-CimInstance Win32_Process` and returns
  `{ name, parentProcessId, commandLine }` or `null`. **NOT currently exported**
  (not in the `module.exports` block) — the impl must add it.
- `readLauncherRecord(memberDir)` — `hooks/actors.js:1847`. Reads the full
  `launcher.pid` record including `scriptPath`. Also NOT exported. (The impl can
  either export this OR extend health.js's local `readLauncherPid` to parse
  `scriptPath`; the latter keeps the actors.js surface change minimal.)
- The exact call pattern to mirror is the stop-time recycle guard in
  `hardTerminateMemberByLauncherChildren` — `hooks/actors.js:2295-2313`:
  ```js
  const launcherInfo = getLauncherInfo(launcher);        // describeProcess
  if (!launcherInfo) { throw LauncherRecycleRefuse('launcher-not-alive'); }
  const safety = verifyLauncherRecycleSafety(launcherInfo, {
    memberName: options.memberName,
    launcherScriptPath: options.launcherScriptPath
  });
  if (!safety.ok) { throw LauncherRecycleRefuse(safety.reason); }
  ```
  The injectable seam (`getLauncherInfo`) is the test pattern to reuse — tests
  inject a fake `describeProcess` so they never spawn real CIM.
- `launcher.pid` write site — `spawnMember` at `hooks/actors.js:~2620`:
  `{ pid = $PID; startedAt = ...; scriptPath = '<spawn-launchers>/<name>-<ts>.ps1' }`.
  So a current-vintage `launcher.pid` always carries `scriptPath`; legacy files
  (pre-v3.6.6) lack it → fall back to the `spawn-launchers + memberName` match.

### Consumers of `getMemberHealth` (blast radius)

- `hooks/crews.js:149` — `snapshotCrew` calls `getMemberHealth(name, crew, cwd)`
  for **every** member in the crew (this is `list-members`). Performance-sensitive
  (the ralph-pipeline crew has ~298 members).
- `hooks/member-crash-notifications.js:291` — the crash sweep calls it per member.
  This consumer *benefits* from the fix: a recycled-PID member now reads `dead`,
  so the crash sweep's high-confidence-dead guard fires correctly instead of
  being masked by a false `pidAlive:true`.

### Require-cycle note (load-safe)

`health.js` **top-level** requires `actors.js` (`HEARTBEAT_ALIVE_MS`,
`HEARTBEAT_STALE_MS`, `readManifest`). `actors.js` requires `health.js` only
**lazily inside functions** (`hooks/actors.js:1093,1167`:
`const { isProcessAlive } = require('./health')`). At module-load time the lazy
requires don't fire, so adding `describeProcess` + `verifyLauncherRecycleSafety`
to health.js's existing top-level destructure from `./actors` is safe — no
new load-time cycle.

## Architect Analysis

### Recommended approach (verified-pidAlive with cheap pre-check)

A focused `resolvePidAlive(launcher, name, opts)` helper in `hooks/health.js`:

1. No launcher record → `null` (unchanged fallback).
2. Cheap pre-check `isProcessAlive(pid)`:
   - `false` (ESRCH) → `pidAlive = false` (definitely gone; **no CIM call** — this
     is the performance guard that keeps `list-members` cheap on a 298-member crew,
     since the vast majority of stale `launcher.pid`s are ESRCH-dead).
   - else (true / EPERM / null) → proceed to verification.
3. **Windows**: `describeProcess(pid)`:
   - `null` (gone / inaccessible) → `pidAlive = false` (fail-closed).
   - else `verifyLauncherRecycleSafety(info, { memberName: name, launcherScriptPath: launcher.scriptPath })`
     → `ok ? true : false`. A recycled/foreign image or non-matching cmdline →
     `false`. This **closes Hole #3**: an EPERM-but-foreign PID is disconfirmed by
     CIM (CIM does not need signal perms).
4. **Non-Windows**: `verifyLauncherRecycleSafety` is CIM/Windows-only.
   Document the platform gap; close Hole #3 by treating EPERM/`null`/unverifiable
   as not-alive (`true` → `true`, anything else → `false`). crews is Windows-only
   in practice (wt.exe + pwsh launchers), so this is a theoretical path.

Wire via an optional 4th `opts` arg on `getMemberHealth` carrying injectable
seams `{ describeProcess, isProcessAlive, platform }` (defaults = real impls).
Production callers (`crews.js`, `member-crash-notifications.js`) pass 3 args →
real implementations; tests pass fakes → no real process spawns.

### Why this is the minimal correct change

- `deriveHealthState` is untouched → the `alive`/`quiet`/`dead`/`unknown`
  classification contract is preserved; only the `pidAlive` input is corrected.
- The return shape (51-field manifest mirror, `sessionId`/`createdBy`/`role`/...
  added in v3.13.0) is unchanged — only the *value* of `pidAlive` changes for
  recycled/foreign/unverifiable PIDs.
- Reuses the audited v3.6.6 primitive rather than inventing a second check, so
  the health surface and the stop-member kill guard share one definition of
  "is this PID this member's launcher".

### Risk areas

1. **Performance on large crews.** Mitigated by the ESRCH cheap pre-check (CIM
   only fires for the handful of live-PID launcher records; ~11 of 298 per the
   live evidence). Residual: a busy box could recycle many dead PIDs onto live
   processes → more CIM spawns. Optional further bound: skip CIM when the
   heartbeat is fresh (fresh heartbeat ⟹ member alive ⟹ PID genuine) — documented
   as an optional optimization, not required for correctness.
2. **Shared file with sibling task.** This task only READS actors.js (plus one
   `module.exports` line to export `describeProcess`). The sibling
   `crews-codex-member-tab-title-not-renamed` MODIFIES `spawnMember`/launcher
   builders in actors.js. Low conflict risk; the impl must rebase onto whichever
   ships first (lead-serialized).
3. **Test contract changes.** Two existing `tests/health.test.js` assertions
   encode the OLD (buggy) behavior and must flip: line 51 (`EPERM → alive`) and
   lines 94-97 (`pid reuse is not resisted`). These are intentional contract
   changes, not regressions.

## Consolidated File List

### Files to modify
- `ai-developer-toolkit/plugins/crews/hooks/health.js` — core fix (verified
  pidAlive determination; extend `readLauncherPid` to read `scriptPath`; import
  `describeProcess` + `verifyLauncherRecycleSafety` from `./actors`).
- `ai-developer-toolkit/plugins/crews/hooks/actors.js` — add `describeProcess`
  to `module.exports` (1-line surface change; `verifyLauncherRecycleSafety`
  already exported).
- `ai-developer-toolkit/plugins/crews/tests/health.test.js` — new recycled-PID /
  verified-alive / EPERM / missing-pid cases via injected seams; flip the two
  stale assertions.

### Version / release surface (impl, lead-owned two-commit submodule flow)
- `ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json`,
  `.github/plugin/plugin.json`, `.codex-plugin/plugin.json` (3 plugin manifests)
- `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`,
  `.agents/plugins/marketplace.json` (3 marketplace indexes)
- `ai-developer-toolkit/plugins/crews/tests/version.test.js` (version pin)
- All 7 stamps via `node scripts/bump-version.js <x.y.z>` (authoritative writer):
  the 6 version-bearing files above + `tests/version.test.js` (which asserts the
  literal string). i.e. "6 version-bearing files + version.test.js".
- `ai-developer-toolkit/plugins/crews/CHANGELOG.md` (`## <x.y.z> - <date>`)
- `ai-developer-toolkit/plugins/crews/AGENTS.md` (`## v<x.y.z>` section)

### Test infrastructure
- JS-only plugin (no package.json/tsconfig). Typecheck = `node --check <file>`.
- Full suite: `cd ai-developer-toolkit/plugins/crews && node tests/run.js`
  (~40-60s on Windows; targeted file: `node tests/run.js health.test.js`).
- Tests must NOT spawn real processes — use the `describeProcess`/`isProcessAlive`
  injection seams (Git Bash must be first on PATH for the bash-stub suite, but
  health.test.js is pure-node).
