# Research Brief: Crews Inner PID Capture Not Firing

## Seed
Brainstorm selected direction: `D:\ai-developer-toolkit\.ralph\brainstorms\crews-inner-pid-capture-not-firing\selected-direction.md`

Selected direction: treat this as a capture-child lifetime/detachment failure first. Live evidence shows `launcher.pid` and `inner-pid-capture-*.ps1` exist, `inner.pid` is absent, no capture process remains alive, and the real `copilot.exe` process is a direct child of launcher `pwsh.exe`.

## Relevant Files
### Files to modify
- `D:\ai-developer-toolkit\plugins\crews\hooks\actors.js`
  - `spawnMember()`
  - `spawnInnerPidCapture()`
  - `buildInnerPidCaptureScript()`
  - `applyHardStopMember()`
  - `fallbackKillLauncher()`
- `D:\ai-developer-toolkit\plugins\crews\hooks\config.js`
  - Re-export any new or renamed capture helper.
- `D:\ai-developer-toolkit\plugins\crews\hooks\commands\stop-member.js`
  - Format fallback warning for slash output.
- `D:\ai-developer-toolkit\plugins\crews\tools\diagnose-inner-pid-capture.js`
  - New diagnostic entry point if implemented as a tool.
- `D:\ai-developer-toolkit\plugins\crews\tests\launcher-pid.test.js`
  - Update capture invariants for launcher-owned capture startup.
- `D:\ai-developer-toolkit\plugins\crews\tests\inner-pid-capture-live.test.js`
  - Update gated live stand-in smoke for launcher-owned capture and trace assertions.
- `D:\ai-developer-toolkit\plugins\crews\tests\inner-pid-capture-real-copilot-live.test.js`
  - New gated live smoke for real Copilot capture.
- `D:\ai-developer-toolkit\plugins\crews\tests\stop-member-hard-terminate.test.js`
  - Preserve missing-inner-pid fallback behavior and audit assertions.
- `D:\ai-developer-toolkit\plugins\crews\CHANGELOG.md`
- `D:\ai-developer-toolkit\plugins\crews\AGENTS.md`
- `D:\ai-developer-toolkit\plugins\crews\.claude-plugin\plugin.json`
- `D:\ai-developer-toolkit\.github\plugin\marketplace.json`

### Dependencies and existing patterns
- `actors.js` is the canonical lifecycle surface. It already owns spawn, launcher scripts, hard stop, PID reading, and the capture script generator.
- `config.js` re-exports hooks helpers for tests and command modules.
- Tests use small Node scripts with `tests\lib\assert.js` and `tests\run.js`.
- Live Windows Terminal tests are gated by `CREWS_WT_LIVE_TESTS=1` and skip cleanly on non-Windows or missing `wt.exe`.
- Existing test output convention in `D:\ai-developer-toolkit\AGENTS.md`: save long plugin test output to a file, e.g. `node plugins/crews/tests/run.js ... > <log> 2>&1`.

## Current Implementation Summary
- `spawnMember()` writes the launcher script, spawns `wt.exe`, and then calls `spawnInnerPidCapture()` from the parent Node process.
- The launcher script writes `launcher.pid`, sets location, invokes `& ${launcherCommand}`, optionally waits for `CREWS_KEEP_TAB_OPEN`, and exits 0.
- `spawnInnerPidCapture()` writes a PowerShell script beside `launcher.pid` and starts `powershell.exe -WindowStyle Hidden -NoProfile -NonInteractive -File <script>` without `detached: true`.
- The generated capture script waits for `launcher.pid`, checks whether the launcher is alive, scans child processes via P/Invoke and CIM fallback, and writes `inner.pid` via temp file + rename.
- `applyHardStopMember()` waits for `inner.pid`, kills only the inner CLI when present, or fallback-kills the launcher tree when absent.

## Key Finding
The live evidence contradicts a matcher bug: `copilot.exe` is a direct child of the launcher `pwsh.exe`, and the current acceptable-name predicate should match it. The absent `inner.pid` plus absent live capture process points to capture process lifetime/ownership or early exit. The current comments assume the parent process is long-lived enough and that Windows will not clean up the child; that assumption is suspect under Copilot CLI tool execution.

## Recommended Plan
1. Add trace rows and a diagnostic classifier first.
2. Include `capture-died-without-trace` as a first-class classifier for the current symptom: capture start evidence exists, no capture exit row exists, no `inner.pid` exists, capture PID is gone, and launcher/inner evidence indicates the engine predicate should have matched.
3. Run the diagnostic against a freshly reproduced failing member before the ownership refactor. If the classification contradicts lead-side cleanup, pause and re-scope.
4. Move capture startup into the launcher script after `launcher.pid` is written.
5. Keep the interactive engine inline via `&`.
6. Add stop fallback wording.
7. Add/update tests, including a real Copilot gated live smoke and non-live ordering assertions.
8. Bump to v1.10.0 because capture ownership/lifetime moves structurally. If the implementation instead proves and ships a small `detached: true`-style fix with no ownership move, v1.9.4 is acceptable.

## Verification Surface
- Targeted non-live:
  - `node plugins/crews/tests/run.js launcher-pid.test.js stop-member-hard-terminate.test.js stop-member-cli.test.js`
- Full non-live:
  - `node plugins/crews/tests/run.js`
- Gated live on dev box:
  - `CREWS_WT_LIVE_TESTS=1 node plugins/crews/tests/run.js inner-pid-capture-live.test.js stop-member-hard-terminate-wt-server-survives.test.js`
  - `CREWS_WT_LIVE_TESTS=1 CREWS_REAL_COPILOT_LIVE_TESTS=1 node plugins/crews/tests/run.js inner-pid-capture-real-copilot-live.test.js`

## Risks
- Reintroducing the v1.9.0 TTY regression if the inner CLI is launched via `Start-Process`.
- Hidden capture process console flash.
- Live test flakiness if Copilot CLI startup is slow or unavailable.
- Trace writes must not break capture success.
- Multiple version metadata locations can drift.
