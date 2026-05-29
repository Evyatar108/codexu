# Stories — crews stop-member hard-terminate (v2, corrected)

> **v2 supersedes the v1 outline at commit `33326b6a`.** v1's US-01
> targeted the launcher pwsh for kill; v2 corrects this — US-01 now
> kills the inner CLI subtree AND refactors the launcher script so it
> exits with code 0 after the kill.

Three serial stories on one impl job. Branch:
`ralph/crews-stop-member-hard-terminate-no-envelope`. Repo:
`Evyatar108/ai-developer-toolkit` (plugin `plugins/crews`).

---

## US-01 — Inner-CLI hard-terminate kill helper + launcher script refactor

**As** the crews plugin
**I want** a hard-terminate code path that kills the inner CLI subtree
and lets the launcher pwsh exit cleanly with code 0
**so that** the tab visually closes (no `[process exited]` placeholder)
while the shared `WindowsTerminal.exe` server is never touched.

### Files
- `hooks/actors.js`:
  - Drop `-NoExit` from `wtArgs` (both `newWindow:true` and the named-
    window branch).
  - Refactor launcher script tail to use `Start-Process -PassThru` for
    the inner CLI, capture the inner PID to `<memberDir>/inner.pid`,
    `WaitForExit`, then `exit 0` (or wait at "press enter" prompt if
    `CREWS_KEEP_TAB_OPEN=1`).
  - Add `hardTerminateMemberByInnerPid(innerPid, opts)` helper.
  - Add `applyHardStopMember(target, lead, cwd, opts)` parallel to
    existing `applyStopMember`.
  - Thread `{ soft }` option through `stopMemberAsLead` /
    `stopMemberByOperator` (default `soft:false`).
- `hooks/config.js`: re-export `hardTerminateMemberByInnerPid`.
- `hooks/protocol/manifest.js`: add optional fields `terminationKind`,
  `terminatedAt`, `terminatedPids`. Schema-additive only.
- `tests/spawn-member-launcher-template.test.js` (NEW or extend): snapshot
  the refactored launcher script template.
- `tests/stop-member-hard-terminate.test.js` (NEW; cross-platform skip):
  exercises `hardTerminateMemberByInnerPid` against a synthetic Node
  sleep child.
- `tests/stop-member-hard-terminate-wt-tab-closes.test.js` (NEW;
  gated by `CREWS_WT_LIVE_TESTS=1`): live wt spawn, asserts WT server
  survives + tab actually closes (no OC-count proxy — use launcher-pwsh
  PID exit as the closure signal).

### Acceptance criteria

1. `spawnMember`'s `wtArgs` does NOT contain `-NoExit` in either branch.
2. The generated launcher script:
   - Captures the inner CLI PID via `Start-Process -NoNewWindow
     -PassThru` and writes `<memberDir>/inner.pid` as JSON
     `{ pid, startedAt }`.
   - Calls `$crewsInner.WaitForExit()`.
   - Ends with `exit 0` (or with a `Read-Host 'press enter to close'`
     line if `$env:CREWS_KEEP_TAB_OPEN -eq '1'`).
3. `hardTerminateMemberByInnerPid(innerPid, opts)`:
   - Reads `<memberDir>/inner.pid`. If missing, waits up to 5 s for it
     to appear (handles spawn race). If still missing, returns
     `{ ok:false, reason:'missing-inner-pid', fallback:'launcher-kill' }`
     so caller can choose to fall back.
   - Recycled-PID guard: confirms the live process at `innerPid` has
     `Name` matching the engine binary (`copilot.exe` /
     `claude.exe`) AND `ParentProcessId` matching the value in
     `launcher.pid`. Mismatch → `PidRecycledRefuseToKillError`.
   - `wtServerPid` = launcher's PPID via WMI; RECORDED but NEVER in
     the kill set.
   - Kills inner CLI subtree via `taskkill /T /F /PID <innerPid>`
     (or PowerShell BFS-and-stop; either acceptable).
   - Waits up to 3 s for the launcher pwsh PID to exit naturally
     (running its `exit 0`); if still alive after 3 s, logs WARNING
     and `taskkill /F /PID <launcherPid>` as fallback (records
     `launcherPwsh.fate='force-killed-fallback'`).
   - Returns `{ inner, descendants, launcherPwsh:{pid,fate},
     wtServerPid }`.
4. `applyHardStopMember`:
   - Same authorization preconditions as `applyStopMember`.
   - Updates manifest under `withManifestLock` with all fields from §3
     Q4 of the plan.
   - Does NOT append a `stop-request` envelope.
   - Returns the same shape as `applyStopMember` plus
     `{ terminationKind, terminatedPids }`.
5. `stopMemberAsLead` / `stopMemberByOperator` route to
   `applyHardStopMember` by default (`opts.soft !== true`) and to
   `applyStopMember` (legacy) when `opts.soft === true`.
6. `tests/spawn-member-launcher-template.test.js` snapshot-asserts:
   - `wtArgs` does NOT include `'-NoExit'`.
   - Generated script contains `Start-Process -FilePath` followed by the
     engine binary.
   - Generated script contains `Set-Content -LiteralPath` writing to
     `<memberDir>/inner.pid`.
   - Generated script contains `$crewsInner.WaitForExit()`.
   - Generated script contains `exit 0` (and a branch for
     `CREWS_KEEP_TAB_OPEN`).
7. `tests/stop-member-hard-terminate.test.js` (non-WT):
   - Spawns a Node `setTimeout(()=>{},600000)` child the test controls.
   - Writes a fake `inner.pid` + `launcher.pid` JSON.
   - Invokes `hardTerminateMemberByInnerPid`.
   - Asserts child PID dead within 3 s.
   - Asserts manifest mutations written under lock.
   - Asserts `wtServerPid` field is set to the test's fake launcher's
     PPID and that PID is unchanged after the kill.
   - Self-skips on non-Windows.
8. `tests/stop-member-hard-terminate-wt-tab-closes.test.js` (gated):
   - Real wt spawn via `spawnMember`.
   - Captures `wtServerPid` (launcher's PPID).
   - Invokes the hard-terminate path.
   - Asserts `wtServerPid` still alive after kill.
   - Asserts launcher pwsh PID exited naturally (i.e.,
     `terminatedPids.launcherPwsh.fate === 'exited-naturally'`) —
     this is the empirical signal that the `exit 0` path worked.
   - Does NOT rely on OpenConsole-count delta (v1 used it; was wrong).
9. **MANUAL UX SANITY CHECK** (not automated; impl member runs once):
   spawn an interactive member with the refactored launcher, type a
   multi-line prompt at the copilot REPL, confirm input/output is
   indistinguishable from the pre-v1.9.0 `& copilot` invocation path.
   Record the result in the impl member's `kind=done` body.

### Out of scope
- CLI surface (US-02).
- CHANGELOG / AGENTS.md text (US-03).

### Risk

**Medium-high.** Three coupled changes (launcher refactor + kill helper
+ Start-Process UX verification). The Start-Process REPL UX is the
single largest risk. If verification fails, impl pivots to research-
brief Option 5B (Node-side WMI polling for inner PID, keep `& copilot`
inline) and the story grows by ~150 lines + adds a polling lifecycle
that needs its own test coverage.

---

## US-02 — CLI + slash default flip; `--soft` opt-in

**As** the bookkeeper-lead
**I want** `/crews-stop-member <name>` (no flag) to hard-terminate
**so that** my common-case stop doesn't pay the round-trip cost.

### Files
- `hooks/commands/stop-member.js` (slash + CLI parsers; usage docs;
  parityVectors).
- `tests/stop-member-cli.test.js` (EXTEND).

### Acceptance criteria

1. Slash: `/stop-member <name> [--soft] [reason text]`. Default = hard.
   `--soft` is the only flag the slash accepts; everything else is
   `reasonText`.
2. CLI: `node tools/crews.js stop-member <name> --crew <crew> [--as <lead>]
   [--state-cwd <path>] [--cwd <workspace>] [--reason <text>] [--soft]`.
   Default = hard.
3. `USAGE` documents `--soft`, the new default, and the safety guarantee
   one-liner ("hard-terminates the inner CLI subtree; never targets the
   WindowsTerminal.exe server").
4. Slash handler routes to `stopMemberAsLead(name, cwd, sessionId,
   { reasonText, soft })`; CLI handler routes to
   `stopMemberByOperator(name, cwd, effectiveAs, crew,
   { reasonText, soft })`.
5. `formatSuccess` for the hard path mentions the inner-CLI kill and
   the launcher's fate, e.g.:
   `/stop-member: alice hard-terminated in crew "demo" at <iso>
   (killed copilot.exe pid=181704 + 3 descendants; launcher pwsh
   exited naturally; WindowsTerminal.exe server pid=32460 untouched)`.
6. Tests:
   - `parseSlash('/stop-member alice')` → `{ soft:false, reasonText:'' }`.
   - `parseSlash('/stop-member alice --soft please wrap up')` →
     `{ soft:true, reasonText:'please wrap up' }`.
   - `parseCli(['alice','--crew','demo','--as','lead1'])` →
     `{ soft:false }`.
   - `parseCli(['alice','--crew','demo','--as','lead1','--soft'])` →
     `{ soft:true }`.
   - Default route asserts `applyHardStopMember` is the one that runs;
     `--soft` route asserts `applyStopMember` (mailbox envelope) runs.
   - parityVectors updated; divergenceCases mention the `--soft`
     positional vs. flag divergence.

### Out of scope
- Underlying kill helper (US-01).
- Docs (US-03).

### Risk

Low. Surface-layer only.

---

## US-03 — Manifest schema docs, CHANGELOG, plugin AGENTS.md

**As** the plugin maintainer
**I want** the v1.9.0 release notes + manifest schema + AGENTS.md to
clearly describe the new behaviour and the v1 → v2 correction story
**so that** consumers know hard is the new default, why the v1 plan
was wrong, and what guarantees the v2 strategy actually delivers.

### Files
- `CHANGELOG.md` (`## v1.9.0`).
- `AGENTS.md` (plugin; update "Stop a member" section).
- `hooks/protocol/manifest.js` JSDoc / inline schema (additive fields).
- `tests/stop-member-cli.test.js` (verify divergenceCases mention
  `--soft`).

### Acceptance criteria

1. `## v1.9.0` CHANGELOG entry contains:
   - Round-trip-cost rationale + smoke-test reference.
   - **The v1 → v2 correction**: brief paragraph explaining that the
     initial plan killed the launcher pwsh, leaving a `[process
     exited with code 1]` placeholder; operator caught it visually;
     v2 corrected by killing the inner CLI subtree and refactoring
     the launcher to `exit 0`. (This is important for future
     maintainers who'll wonder "why this convoluted strategy".)
   - Explicit safety guarantee: "hard-terminate kills only the
     inner CLI subtree; the `WindowsTerminal.exe` server PID and
     every other tab in every wt window are never touched".
   - Dependency on `closeOnExit: graceful` (the WT default); warning
     emitted at spawn time if user overrides to `never`.
   - `--soft` opt-in description + open-ended deprecation timeline.
   - `CREWS_KEEP_TAB_OPEN=1` debug escape hatch documented.
   - Pointer to `.ralph/jobs/.../research-brief.md` (v2).
2. Plugin `AGENTS.md` "Stop a member" section matches the wording in
   plan §3 Q6.
3. `manifest.js` JSDoc / schema comment lists `terminationKind` ∈
   `'hard' | 'soft'`, `terminatedAt` ISO string, `terminatedPids`
   object with `innerCli`, `descendants`, `launcherPwsh.{pid,fate}`,
   `wtServerPid`.
4. `divergenceCases` in `stop-member.js` parityVectors mention `--soft`.

### Out of scope
- Codexu AGENTS.md update (separate consumer follow-up).
- `crews-soft-stop-placeholder-cleanup` follow-up (separate task).

### Risk

Low. Pure documentation.
