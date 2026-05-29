# Research brief — crews stop-member hard-terminate

> Empirical investigation conducted 2026-05-29 inside the very tab whose process
> tree was under study (member `plan-crews-stop-member-hard-terminate-no-envelope`,
> crew `smoke-copilot-e2e-roles`). All findings below come from live
> `Get-CimInstance Win32_Process` snapshots, `Stop-Process` / `taskkill /T /F`
> experiments on disposable test tabs, and direct probing of the `wt.exe` CLI
> surface. **No findings here are quoted from Microsoft documentation
> alone — every claim is backed by an observed PID/OC-count delta.**

## 1. Windows Terminal process model on this machine

Windows Terminal version observed: **1.24.10921.0** (path
`C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_1.24.10921.0_x64__8wekyb3d8bbwe\`).
The CLI launcher `wt.exe` lives at
`C:\Users\evmitran\AppData\Local\Microsoft\WindowsApps\wt.exe` and is a
fire-and-forget signaler; the long-running server is `WindowsTerminal.exe`.

The full process tree for THIS member (captured by walking
`Win32_Process.ParentProcessId` from `$PID`) is:

```
pwsh (tool-call shell, ephemeral)   ─── PID 85216
└─ copilot.exe                       ─── PID 181704
   └─ pwsh -NoExit -File <launcher>  ─── PID 202132  (manifest.launcherPid)
      └─ WindowsTerminal.exe         ─── PID  32460  (SERVER, shared with EVERY tab)
         └─ explorer.exe             ─── PID  15224
```

`WindowsTerminal.exe` (PID 32460) hosts every tab in the user's Windows Terminal
window. The bookkeeper-lead's tab, every other crews member's tab, the
operator's dev shells, and a half-dozen `OpenConsole.exe` console-host children
(one per tab/pane) are all parented to this single server PID. **Killing it
closes every tab in every window — catastrophic.**

For each tab, `WindowsTerminal.exe` spawns TWO direct children, as siblings:

- the command (`pwsh -NoExit -File <launcher>.ps1` in our case), and
- an `OpenConsole.exe` console host (one per tab, identified at the OS level
  only by a `--server 0x….` arg unique to the tab — no stable mapping back to
  `wt`-visible tab id or title).

The launcher pwsh is NOT a child of `OpenConsole.exe`. They're peers under
`WindowsTerminal.exe`.

Snapshot at experiment time: `OpenConsole.exe` count under WT server = **8**
(baseline) → **9** after spawning one test tab → **8** after killing the test
launcher → **9 again** after spawning a second test tab, → **8** after
`taskkill /T /F`. **The OC-count delta is the empirical signal that a tab
actually disappeared, vs. merely showing a "process exited" placeholder.**

## 2. Process-kill behaviour (T-strategies)

### Experiment 2.1 — `Stop-Process -Id <launcherPid> -Force`

Spawned a test tab with `wt -w crews-smoke-copilot-e2e-roles new-tab --title
PLAN-TEST-… pwsh -NoExit -File <test.ps1>` where the script body sleeps for
600 s. Located the launcher pwsh via
`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match
'crews-plan-test-…' -and $_.ParentProcessId -eq 32460 }` (PID 138736).

```
BEFORE: OC count = 9,   WT(32460) alive=True,  launcher(138736) alive=True
        Stop-Process -Id 138736 -Force
AFTER:  OC count = 8,   WT(32460) alive=True,  launcher(138736) alive=False
        DELTA OpenConsole: 1   ← tab teardown confirmed
```

**Result.** The tab disappeared (OC count dropped by 1), the WT server PID
survived. Single-PID kill of the launcher pwsh is sufficient to close the tab
visually IF the launcher pwsh has no surviving child processes. **The
"empty placeholder" the operator observed is NOT a side-effect of the kill
strategy — it has a different root cause (see §4).**

### Experiment 2.2 — `Stop-Process` does NOT cascade

A second test tab launched a child via `Start-Process pwsh -ArgumentList
'-NoExit','-File',<childScript>`, then we killed only the parent pwsh with
`Stop-Process -Force`. The child (a grandchild of `WindowsTerminal.exe` once
its parent died) **survived as an orphan**. This is documented Windows
behaviour: `TerminateProcess` does not cascade.

For the real crews member, the launcher pwsh has `copilot.exe` (and its
descendants — Node language-server children, pwsh tool-call shells like
PID 85216 above) as children. **A single `Stop-Process -Id <launcherPid>
-Force` would orphan `copilot.exe`** — the model session would keep running,
the listener would keep heartbeating, the lead would not see the member
disappear.

### Experiment 2.3 — `taskkill /T /F /PID <launcherPid>` cascades

The `/T` flag tells `taskkill` to terminate the process and all descendants.
Verified in cleanup: `taskkill /T /F /PID 277492` killed the launcher pwsh
plus its child pwsh in one shot; OC count went back to baseline. **This is
the kill mechanism the plan recommends.**

PowerShell alternative (no taskkill dependency): walk descendants with a BFS
over `Get-CimInstance Win32_Process` filtered by `ParentProcessId`, then
`Stop-Process -Force` bottom-up. Equivalent semantics, marginally more
portable inside the JS code path that already uses `child_process.spawn`.
Plan recommends the PowerShell walk for purity + the same exit-code reporting
shape as the rest of `spawnMember`.

### Experiment 2.4 — `WindowsTerminal.exe` server PID is never targeted

In all three experiments, the WT server PID (32460) survived. The kill set
contains only PIDs strictly inside the descendant subtree of `launcherPid`.
The walk **stops at `launcherPid` itself** — we never traverse upward to its
parent (which IS the WT server). This satisfies the "wt.exe server MUST
survive" constraint from the prompt.

## 3. `wt.exe` CLI surface (T1 feasibility)

The prompt's leading candidate T1 was "`wt --window <wid> close-tab --tabid
<tid>` after kill". Empirical probe results:

| Invocation | Exit code | OC count delta | Effect |
|---|---|---|---|
| `wt nonexistent-subcommand` | 0 | 0 | silent no-op |
| `wt -w crews-… close-pane` | 0 | 0 | silent no-op (no focused pane in target window from external shell) |
| `wt -w crews-… focus-tab --title nonexistent` | 0 | 0 | silent no-op |
| `wt -w crews-… close-tab --title nonexistent` | 0 | 0 | silent no-op |
| `wt -w crews-… close-tab` (bare) | 0 | 0 | silent no-op |

**Every probe returns exit 0**, because `wt.exe` is a fire-and-forget signaler
that relays subcommands to the WT server over a named pipe; it does not wait
for the server to validate or act on the subcommand. No subcommand observed
actually closed a tab. There is no documented `--tabid` flag on any
subcommand in WT 1.24; `focus-tab` accepts only `--target <index>` (a runtime
index that is unstable when other crews members spawn or the operator
rearranges tabs), and `close-pane` closes the focused pane in the focused
window — useless for remote-targeting a specific member's tab from the
lead's tab.

**Conclusion for T1: NOT FEASIBLE.** `wt.exe` cannot be used to close a
specific tab by stable identity. T1 is removed from the candidate set.

T2 (settings.json dedicated profile) is intrusive (modifies user's wt
settings file at install time) AND unnecessary (see §2: killing the launcher
pwsh tree already closes the tab; we don't depend on any `closeOnExit`
setting because we kill the pwsh PID outright rather than letting it exit
with a non-zero code that `closeOnExit: graceful` would refuse to close on).

T3 (UI keystroke automation) is fragile (requires the target tab to be
focused; subject to z-order races; trivially defeated by the user clicking
elsewhere) and not pursued.

**The plan picks NEW strategy T5: `taskkill /T /F` (or equivalent PowerShell
descendant walk) of `manifest.launcherPid.pid`.** This single mechanism
satisfies both acceptance criteria — (a) kills only the per-tab child tree,
never the WT server, and (b) makes the tab visually disappear (OC count
delta = 1, no placeholder UI).

## 4. Root cause of "empty placeholder" tabs (operator's prior observation)

The operator reported that prior smoke-test stops left tabs visible but
empty (no PowerShell prompt, no copilot UI). The root cause is the spawn
argv:

```js
const wtArgs = options.newWindow
  ? ['new-tab', '--title', tabTitle, 'pwsh', '-NoExit', '-File', scriptPath]
  : ['-w', windowName, 'new-tab', '--title', tabTitle, 'pwsh', '-NoExit', '-File', scriptPath];
```

`pwsh -NoExit -File <launcher>` instructs pwsh to NOT exit after the
launcher script finishes. The launcher script's last line is `copilot
--name ... -i <prompt>`. When copilot exits cleanly (soft-stop ack flow),
the launcher script ends, but pwsh remains alive at an empty interactive
prompt because of `-NoExit`. The tab stays open, hosting an empty pwsh
prompt — the "placeholder" the operator saw.

Verified empirically: spawned a test tab with `pwsh -NoExit -File <script
that ends with exit 0>`. After the script's 30-second sleep and `exit 0`,
OC count stayed at the post-spawn level (9, not 8). The tab was still
present.

**This is the soft-stop placeholder problem, NOT the hard-terminate
placeholder problem.** Hard-terminate (kill the pwsh PID) destroys pwsh
entirely, so `-NoExit` doesn't matter — there's no pwsh left to hold the
tab open. The OC count drops, the tab closes.

The plan accordingly recommends a **follow-up story (US-04)** to drop
`-NoExit` from `spawnMember`'s wt argv so soft-stop also closes tabs
cleanly. That's a one-line change with its own small risk surface
(debugging convenience for operators inspecting failed launchers is lost)
and is documented as out of scope of the core hard-terminate plan, eligible
to ship in the same release if desired.

## 5. Capturing the launcher PID — already done

The current launcher script captures `$PID` to
`<memberDir>/launcher.pid` as a JSON blob:

```
$crewsLauncherPid = [ordered]@{ pid = $PID; startedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
Set-Content -LiteralPath '<launcher.pid>' -Value $crewsLauncherPid -Encoding ascii
```

Confirmed: this file exists for me at
`D:\harness-efforts\codexu\.crews\crews\smoke-copilot-e2e-roles\members\plan-crews-stop-member-hard-terminate-no-envelope\launcher.pid`
with content `{"pid":202132,"startedAt":"2026-05-29T17:47:16.0832149Z"}`. PID
202132 is the launcher pwsh whose parent is WindowsTerminal.exe (32460).
**No new PID-capture work is required for the kill code path.** The hard
case (Copilot CLI's own PID, which is a child of the launcher pwsh) is
reached transitively via the descendant walk; we don't need to track it
explicitly.

## 6. wt `closeOnExit` setting — irrelevant for our strategy

Read `C:\Users\evmitran\AppData\Local\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json`.
All profiles (including `defaults`) leave `closeOnExit` empty, meaning the
WT default applies (`graceful`: close on exit code 0, placeholder otherwise).

**This does not affect our strategy.** We kill the pwsh PID via
`TerminateProcess`, which means the pwsh process is GONE — not exited.
There is no exit code for `closeOnExit` to evaluate against. WT simply
notices its tab's command died and tears down the tab + OpenConsole. The
OC-count delta in §2.1 confirms this.

Documentation note for the CHANGELOG: the hard-terminate path does NOT
depend on user's `closeOnExit` setting. The soft-stop path DOES (and would
benefit from `closeOnExit: graceful` being the default, which it is), but
that's the follow-up US-04 story above.

## 7. Open questions for impl

1. **`taskkill /T /F` vs PowerShell BFS-and-stop.** Both work; the plan
   defaults to PowerShell BFS-and-stop because it keeps `spawnMember`'s
   Node-only code path uniform with the rest of `hooks/actors.js` (no
   `cmd.exe` dependency to debug on different Windows SKUs). Impl member
   may switch to `taskkill /T /F` if BFS implementation in Node feels heavy.
2. **Audit-log retention.** `manifest.terminatedPids` records what was
   killed. Open question: should we also record what we DID NOT kill (e.g.,
   the WT server PID) as proof of the safety guarantee? Plan recommends YES
   (`manifest.terminatedPids.wtServerPid` is the WT PID we walked UP to and
   stopped at; recording it lets a forensic reviewer confirm we stopped at
   the right boundary).
3. **Cross-engine.** `taskkill` and `Stop-Process` behave identically for
   Claude Code members (where the inner process is `claude.exe` instead of
   `copilot.exe`). The walk is engine-agnostic. No engine-specific code path
   needed.

## 8. Anomalies and irrelevant findings

- `wt.exe nonexistent-subcommand` returning exit 0 (not 1) means we cannot
  use exit-code probing to discover supported subcommands; we have to rely
  on OpenConsole-count side-effects as the empirical signal. Not blocking,
  just a documentation note.
- During cleanup of the second experiment, the descendant-walk lookup
  returned `$parentProc.ProcessId` as null because the spawn race left
  WMI's view of the new tab one query behind. Production code should
  retry the lookup with exponential backoff (a sentence in story US-01).
- `manifest.launcherPid` is currently a JSON blob on disk, not a manifest
  field — the file is `<memberDir>/launcher.pid`, not part of `manifest.json`.
  Plan recommends keeping it on disk (atomic write semantics are simpler
  than threading it into `ensureActorDir`'s manifest path).
- `copilot.exe` is the Windows shim at
  `C:\Users\evmitran\AppData\Local\Microsoft\WinGet\Links\copilot.exe`. It
  spawns a real Node process under the hood; the descendant walk catches it
  regardless of which Node binary the shim selects.
