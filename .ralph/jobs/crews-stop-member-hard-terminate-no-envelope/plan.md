# Plan — crews stop-member hard-terminate

**Task.** Replace the current soft-stop ack round-trip in `crews stop-member`
with a hard-terminate path that kills the per-tab child process tree and
closes the tab visually, without ever touching the shared
`WindowsTerminal.exe` server. Eliminate the redundant second `kind=done`
envelope that the lead has to consume after every clean stop.

**Repo.** `Evyatar108/ai-developer-toolkit`, plugin `plugins/crews`.

**Branch.** `ralph/plan-crews-stop-member-hard-terminate-no-envelope` (this
plan), then impl on `ralph/crews-stop-member-hard-terminate-no-envelope`.

**Version bump.** Crews plugin **v1.9.0** (minor — adds new behaviour AND
flips the default of an existing command, even though backwards-compatible
via `--soft`).

**Phase discipline.** This is the plan-only deliverable. No code edits in
this commit beyond the four files under `.ralph/jobs/<task>/`.

---

## 1. Operator-facing intent recap

The current `/crews-stop-member <name>`:
1. Sets `manifest.shutdownRequested = true`, marks listener exited.
2. Appends a `stop-request` envelope to the member's mailbox.
3. The member reads the envelope, emits a `kind=done` "ok, dying" turn.
4. The Stop hook lets that turn end; the engine (Copilot CLI / Claude Code)
   may then exit and the launcher pwsh stays at an empty `-NoExit` prompt,
   producing the "empty placeholder tab" the operator observed.

The new behaviour, for the common case (member has already shipped its
real work):
1. Lead invokes `/crews-stop-member <name>` (no flag — hard is the new
   default; the operator's existing muscle memory keeps working with
   strictly better behaviour).
2. Manifest is updated to `shutdownRequested=true`, `listenerState='exited'`,
   `actorState='cleared'`, plus new audit fields
   (`terminatedAt`, `terminationKind='hard'`, `terminationReason`,
   `terminatedPids={ launcher, descendants:[…], wtServerPid }`).
3. `manifest.launcherPid` (already captured by `spawnMember` to
   `<memberDir>/launcher.pid`) is read; we walk its descendant subtree and
   `Stop-Process -Force` everything bottom-up — strictly NOT including
   `WindowsTerminal.exe` or any ancestor of `launcherPid`.
4. The launcher pwsh dies, `WindowsTerminal.exe` reaps the paired
   `OpenConsole.exe`, the tab visually disappears.
5. NO `stop-request` envelope is appended; the member never gets a chance
   to emit a follow-up `kind=done`.

For the rare case where the lead wants the legacy soft-stop semantics
(e.g., the member is mid-tool-call and the operator wants graceful
shutdown), `/crews-stop-member <name> --soft` falls back to the existing
mailbox-envelope path verbatim. CLI mirror takes `--soft` too.

---

## 2. Files touched (impl preview)

| File | Change |
|---|---|
| `hooks/actors.js` | New `hardTerminateMemberByLaunchPid(launcherPid, opts)` helper; new `applyHardStopMember(target, lead, cwd, opts)` parallel to existing `applyStopMember`; `stopMemberAsLead` / `stopMemberByOperator` gain `opts.soft` switch. |
| `hooks/commands/stop-member.js` | Slash parser accepts `--soft` (everything else is `reasonText`); CLI parser adds `--soft` boolean flag. Default = hard. Usage docs updated. |
| `hooks/protocol/manifest.js` | New optional fields: `terminationKind`, `terminationReason`, `terminatedAt`, `terminatedPids`. Schema-additive only. |
| `hooks/config.js` | Re-export `hardTerminateMemberByLaunchPid` if any caller needs the primitive directly (tests will). |
| `tests/stop-member-hard-terminate.test.js` | NEW: portable test, spawns a no-launch member (`CREWS_NO_LAUNCH=1`), writes a fake `launcher.pid` pointing at a `setTimeout(…, 600_000)` Node child we spawn ourselves, invokes the new code path, asserts manifest mutations + that the child PID is dead. Cross-platform skip if not Windows. |
| `tests/stop-member-hard-terminate-wt-server-survives.test.js` | NEW (Windows-only, optional in CI): does a REAL `wt.exe` spawn with `CREWS_NO_LAUNCH=0`, captures the WT server PID by walking up from the launcher's PPID, hard-terminates, asserts WT server PID is still alive after the kill. Gated behind `CREWS_WT_LIVE_TESTS=1` so CI without a real WT install skips cleanly. |
| `tests/stop-member-cli.test.js` | EXTEND: assert `--soft` flag parses to `softStop=true`; assert default invocation routes to hard path; assert `parityVectors` updated. |
| `CHANGELOG.md` | New `## v1.9.0` section: round-trip-cost rationale; explicit safety guarantee (WT server untouched); `--soft` opt-in for legacy semantics; pointers to research-brief. |
| `AGENTS.md` (plugin) | Update §"Stop a member" with new default + safety paragraph. |
| `codexu AGENTS.md` (separate consumer-side commit, NOT this repo) | One-line update to the workflow diagram + duty table noting "stop-member is hard by default; kills only the per-tab child tree, never the WT server". Listed as a follow-up impl-time task, not part of this plugin PR. |

---

## 3. Design decisions

### Q1 — API shape: **Option C (flip default + `--soft` opt-in)**

| Option | Decision |
|---|---|
| A — new `kill-member` subcommand | REJECTED. Two commands for very similar intent confuses the bookkeeper's mental model; the operator's existing muscle memory (`/crews-stop-member <name>` every time a member ships) is correct and shouldn't be retrained. |
| B — `--hard` flag on existing `stop-member` | REJECTED. The flag will be forgotten 90% of the time; the round-trip cost will silently persist as a tax. The operator explicitly stated hard is the common case. |
| **C — flip the default, add `--soft` opt-in** | **PICKED.** Matches operator intent; preserves the legacy path for callers who genuinely want it; existing `/crews-stop-member <name>` invocations get the round-trip-cost fix with zero migration. |

**Migration risk for option C.** Scanned codexu's `AGENTS.md` and the
fork-notes for any caller that depends on the soft-stop ack envelope:

- `codexu AGENTS.md` workflow diagram (`lead: /crews:stop-member <name>`)
  — the lead reads the second `kind=done` only to acknowledge it; nothing
  downstream depends on it.
- Tests in `tests/stop-member-wake.test.js` — exercise the wake-on-mailbox
  path that fires when a member is asleep and a stop-request envelope
  arrives. This test stays valid because it exercises `--soft`; we update
  the test invocation to pass `--soft` explicitly.
- Tests in `tests/stop-decision.test.js` — exercise Stop-hook authorization
  when `shutdownRequested=true`. Hard path also sets `shutdownRequested=true`
  so this test is invariant.

**No real consumer of the ack flow.** Deprecation timeline: `--soft` stays
in v1.9.0 with no deprecation warning. Soft mode reconsidered in v2.0 if
no real-world usage surfaces by then.

### Q2 — Hard-terminate mechanism: **PowerShell descendant walk over `Stop-Process -Force`**

Empirical findings (see `research-brief.md` §2 and §3):

- `Stop-Process -Id <launcherPid> -Force` alone leaves orphaned descendant
  processes (including `copilot.exe` and its Node children). REJECTED in
  isolation.
- `taskkill /T /F /PID <launcherPid>` cascades correctly. Valid option but
  introduces a `cmd.exe` dependency in `hooks/actors.js` which currently
  uses pure Node `child_process.spawn`.
- **PICKED: BFS walk via `Get-CimInstance Win32_Process | Where-Object
  ParentProcessId -eq $pid` recursively, then `Stop-Process -Force`
  bottom-up.** Equivalent semantics to `taskkill /T /F`, no `cmd.exe`
  dependency, gives us the descendant list to record in
  `manifest.terminatedPids.descendants` for audit. Implemented in JS using
  `child_process.spawnSync('pwsh', ['-NoProfile', '-Command', '<inline
  script>'])` — pwsh is required by `spawnMember` already, so no new
  prereq.

**Safety boundary.** The walk ALWAYS starts at `launcherPid` and traverses
downward only. It NEVER consults the launcher's PPID; that ancestor is the
`WindowsTerminal.exe` server, which we record (as
`manifest.terminatedPids.wtServerPid`) for forensic confirmation but never
kill. The implementation is explicit:

```pwsh
$launcherPid = <number>
$wtServerPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$launcherPid").ParentProcessId
$descendants = @()
$frontier = ,$launcherPid
while ($frontier.Count -gt 0) {
  $children = Get-CimInstance Win32_Process | Where-Object { $frontier -contains $_.ParentProcessId }
  $childPids = $children | ForEach-Object { $_.ProcessId }
  $descendants += $childPids
  $frontier = $childPids
}
# Kill bottom-up. Launcher itself is killed last so OS doesn't reparent its descendants mid-walk.
($descendants + $launcherPid) | Sort-Object -Unique | ForEach-Object {
  try { Stop-Process -Id $_ -Force -ErrorAction Stop } catch { Write-Warning "could not stop pid=$_ : $($_.Exception.Message)" }
}
# wtServerPid is NEVER in the kill set. Asserted post-walk in tests.
```

**Edge cases handled** (all matched against §5 of research brief):

- Launcher PID file missing → soft-fail with `terminatedReason="missing
  launcher.pid; member never started or was already cleared"`; still update
  manifest state to `cleared`.
- Launcher PID dead → record empty `terminatedPids.descendants`, mark
  manifest cleared, no error.
- Launcher PID recycled (current PID belongs to an unrelated process) →
  defensive guard: confirm `(Get-CimInstance Win32_Process -Filter
  "ProcessId=$launcherPid").CommandLine -match
  '<expected spawn-launcher script path>'` before killing. If mismatch,
  refuse to kill and surface error
  (`PidRecycledRefuseToKillError`).
- WT tab already closed by operator → launcher PID lookup returns nothing,
  no-op kill, manifest updated.
- Multi-WT-server (Stable + Preview both installed) → walking UP from
  launcher PPID identifies OUR WT server PID specifically; the kill set
  contains only descendants of OUR launcher, so any other WT server is
  trivially untouched.
- Multiple wt windows under one server → walking DOWN from launcher reaches
  only ITS tab's processes; sibling tabs are unaffected. Confirmed
  empirically (research brief §2: 8 sibling OpenConsole.exe processes
  survived the test kill).

### Q3 — Mac / Linux sketch (out of scope for v1)

`spawnMember` currently errors on non-Windows. For future cross-platform
parity, the hard-terminate API surface should look the same:

- **macOS.** `osascript -e 'tell app "Terminal" to close window id <wid>'`
  closes the entire window; for per-tab close, `osascript` against
  `Terminal.app`'s `tab` object addressed by index. Equivalent of our
  launcher PID is the Terminal.app shell process pid (obtainable via
  AppleScript: `do script` returns a tab whose `tty` we can correlate to
  a Unix pid).
- **Linux.** No standard terminal-multiplexer CLI. Options: `tmux kill-pane
  -t <id>` if the user runs tmux; gnome-terminal-server has no documented
  per-tab kill CLI. Pragmatic plan: spawn each crews member in its own
  process group (`setsid`), record the pgid, and `kill -- -<pgid>` to
  terminate the whole group. Tab cleanup is then the terminal's
  responsibility (gnome-terminal closes the tab when its shell exits).

The plugin v1.9.0 API surface is identical across platforms; only the
implementation under `applyHardStopMember` branches on `process.platform`.
For v1.9.0 the non-Windows branches throw `not-yet-implemented` with a
pointer to the existing "spawn-member currently requires Windows" guard.

### Q4 — Manifest state + audit log

The manifest gains four additive fields (no schema break — all optional):

```jsonc
{
  // existing fields unchanged …
  "shutdownRequested": true,                     // unchanged (set by both soft and hard)
  "shutdownRequestedAt": "2026-…",               // unchanged
  "shutdownRequestedBy": "<lead-name>",          // unchanged
  "shutdownReason": "<reason or null>",          // unchanged
  "lastListenerExitedAt": "2026-…",              // unchanged

  // NEW (hard-only):
  "terminationKind": "hard",                     // | "soft" (omitted on legacy or soft path)
  "terminatedAt": "2026-…",                      // when applyHardStopMember finished
  "terminatedPids": {
    "launcher": 202132,
    "descendants": [181704, 85216 /* …copilot + tool-call descendants */],
    "wtServerPid": 32460                         // recorded for forensic proof we stopped at the boundary
  },
  "actorState": "cleared"                        // flipped automatically on hard (was 'active')
}
```

`clear-member` becomes redundant for hard-terminated members. Plan keeps the
two commands separate (`clear-member` ALSO archives mailbox history; that's
a distinct, hard-to-undo data operation), but documents that hard-stop +
clear-member's mailbox archival can be invoked in a chain by callers who
want the full cleanup.

### Q5 — Edge cases

All addressed in §3.Q2 above; tests assert each one.

### Q6 — AGENTS.md updates (plugin + consumer)

**Plugin `AGENTS.md`** (in this PR): update the "Stop a member" section
with:

> v1.9.0+: `stop-member` defaults to HARD-terminate. This kills the per-tab
> child process tree (launcher pwsh + Copilot/Claude CLI + their
> descendants) and lets Windows Terminal close the tab. The
> `WindowsTerminal.exe` server PID is NEVER targeted — every other tab in
> every window survives. Pass `--soft` for the legacy mailbox-envelope
> ack flow. See `.ralph/jobs/crews-stop-member-hard-terminate-no-envelope/research-brief.md`
> for the empirical basis.

**Consumer `codexu/AGENTS.md`** (NOT in this PR — separate codexu commit
referenced as a follow-up below): one-line change in the workflow diagram
duty table:

> Stop the member cleanly | `/crews:stop-member <name>` (hard-terminate; pass `--soft` for legacy ack flow)

…plus a safety note in the "Crews-plugin invariants" section pointing at
the same research-brief.

---

## 4. Tests + verification gates

### Local typecheck / lint
- `node --check hooks/commands/stop-member.js` (per repo convention)
- `node tests/run-all.test.js` or whatever the crews suite entry is (impl
  member to verify) — must pass after the new tests are added.

### Test coverage matrix

| Story | Test file | What's asserted |
|---|---|---|
| US-01 | `tests/stop-member-hard-terminate.test.js` (NEW) | (a) descendant Node child killed; (b) manifest fields written; (c) `actorState='cleared'`; (d) cross-platform skip on non-Windows. |
| US-01 | `tests/stop-member-hard-terminate-wt-server-survives.test.js` (NEW, gated `CREWS_WT_LIVE_TESTS=1`) | After hard-terminate, WT server PID survives + the launcher.pid file's pid is dead. |
| US-02 | `tests/stop-member-cli.test.js` (EXTEND) | `--soft` flag parses; default routes to hard handler; parityVectors include both. |
| US-03 | `tests/stop-decision.test.js` (verify unchanged) | Stop hook still recognizes `shutdownRequested=true` regardless of hard/soft path. Hard path sets the same authorization signal. |
| US-04 (follow-up, see §6) | n/a — separate plan if pursued | Drop `-NoExit` from spawnMember wtArgs; verify soft path also closes tabs. |

### Manual verification by impl member (one-time)
1. With a fresh `pnpm overview` watcher running, spawn a test member with
   `node tools/crews.js spawn-member …`. Observe the new tab.
2. `node tools/crews.js stop-member <test-name> --crew <crew> --as <lead>`.
3. Confirm the tab visually disappears (not placeholder), the
   `WindowsTerminal.exe` PID (`Get-CimInstance Win32_Process -Filter
   "Name='WindowsTerminal.exe'" | Select ProcessId`) is unchanged, and
   manifest.json has the new audit fields populated.
4. Repeat with `--soft`; confirm the legacy two-envelope flow still works
   and the tab persists as a `-NoExit` placeholder (this is the legacy
   behaviour we're preserving for soft mode).

---

## 5. Sequencing (single-job, three stories serial)

| Phase | Cluster | Stories | Why serial |
|---|---|---|---|
| 1 | `core-kill` | US-01 | Foundation; everything else depends on the helper. |
| 2 | `cli-default-flip` | US-02 | Surfaces US-01 to slash + CLI. |
| 3 | `audit-and-docs` | US-03 | Manifest schema + CHANGELOG + plugin AGENTS.md tightly coupled to US-01/US-02 wording. |

Single impl member, serial: estimated 2-3 commits total, low merge risk
since the kill helper is the only meaningful logic and it lives in
`hooks/actors.js` which neither US-02 nor US-03 modifies on its own.

Parallelism opportunity: **none recommended.** Story surface is small;
coordination overhead > parallel speedup.

---

## 6. Follow-ups (separate tasks, NOT in this PR)

| ID | Scope | Summary | Why deferred |
|---|---|---|---|
| crews-soft-stop-no-exit-fix | crews | Drop `-NoExit` from `spawnMember`'s wt argv so soft-stop also closes its tab. One-line change. | Out of scope of THIS plan (the hard-terminate path doesn't need it). Documented for completeness; eligible to land in v1.9.0 too if impl member has bandwidth. |
| crews-cross-platform-hard-terminate | crews | Implement macOS (osascript) + Linux (setsid + kill -PGID) branches of `applyHardStopMember`. | Spawn is Windows-only today; this follow-up unblocks Mac/Linux parity. |
| codexu-agents-md-stop-member-update | codexu | Update `AGENTS.md` workflow diagram + invariants to reflect new stop-member default + safety guarantee. | One-line change in consumer repo; not this PR's surface. |

---

## 7. Acceptance criteria for the impl member

1. `node tools/crews.js stop-member <name> --crew <crew> --as <lead>`
   (default, no flag) kills the launcher pwsh tree, the tab disappears,
   no `stop-request` envelope is appended to the member's mailbox, and
   the `WindowsTerminal.exe` server PID is unchanged.
2. `node tools/crews.js stop-member <name> --crew <crew> --as <lead>
   --soft` exhibits the EXACT pre-v1.9.0 behaviour (manifest mutation,
   mailbox envelope, member's `kind=done` round-trip). Behavioural
   equivalence verified by `tests/stop-member-wake.test.js` (existing) +
   parityVectors in `tests/stop-member-cli.test.js`.
3. Manifest after hard stop contains: `terminationKind='hard'`,
   `terminatedAt` ISO string, `terminatedPids.launcher` (number),
   `terminatedPids.descendants` (array of numbers including the Copilot
   CLI PID), `terminatedPids.wtServerPid` (number), `actorState='cleared'`.
4. The new `tests/stop-member-hard-terminate.test.js` runs on Windows + is
   skipped cleanly on non-Windows; it asserts (a) descendant Node child
   PID is dead after the kill, (b) manifest mutations as above, (c)
   `wtServerPid` field is set to a non-zero number and that PID is alive
   AFTER the kill (asserted in the gated live-WT test).
5. `CHANGELOG.md` has a `## v1.9.0` section that explicitly states:
   (a) round-trip-cost rationale + smoke-test reference, (b) safety
   guarantee that `WindowsTerminal.exe` server is never targeted, (c)
   `--soft` opt-in for legacy semantics + deprecation timeline ("not
   scheduled; reconsider in v2.0 if no usage surfaces").
6. Plugin `AGENTS.md` "Stop a member" section updated.
7. No regression in `tests/stop-decision.test.js`, `tests/stop-member-wake.test.js`,
   `tests/stop-member-cli.test.js` (the latter extended, not regressed).
8. Optional, gated by `CREWS_WT_LIVE_TESTS=1` env: a real `wt.exe` spawn
   test asserts the WT server PID survives a hard-terminate. Tests
   register skip if env is unset.

---

## 8. Reporting back from impl

When the impl member ships, the bookkeeper-lead expects:

- Commit SHA on `Evyatar108/ai-developer-toolkit:main`.
- Confirmation that v1.9.0 marketplace registration includes the updated
  plugin (so `~/.copilot/installed-plugins/ai-developer-toolkit/crews/`
  picks up the new code on next install).
- Outcome of the gated live-WT test if the impl member ran it locally:
  WT server PID before vs. after, OC count before vs. after.
- Any deviation from this plan (e.g., if impl picked `taskkill /T /F`
  over the PowerShell BFS), with rationale.
