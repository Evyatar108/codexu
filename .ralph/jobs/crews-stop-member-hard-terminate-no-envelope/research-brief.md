# Research brief — crews stop-member hard-terminate (v2, corrected)

> **v2 supersedes the v1 brief (commit `33326b6a`).** The v1 strategy
> (kill the launcher pwsh; trust `OpenConsole.exe` count delta as evidence
> of tab closure) was empirically WRONG — operator caught it via direct
> visual inspection of the live test tab. v2 captures the corrected
> empirical findings and the strategy that actually works.

## 1. Windows Terminal process model on this machine

Unchanged from v1. Windows Terminal **1.24.10921.0**, single
`WindowsTerminal.exe` server (PID 32460 in this session) hosting every
tab in every window. Per-tab: a launcher pwsh + an `OpenConsole.exe`
console host, both direct children of `WindowsTerminal.exe`. Killing
`WindowsTerminal.exe` = closing every tab everywhere = catastrophic.

Process tree for the real crews member during plan investigation:

```
pwsh (tool-call shell, ephemeral)   ─── child of copilot.exe
└─ copilot.exe                       ─── PID 181704 (THIS is the kill target)
   └─ pwsh -NoExit -File <launcher>  ─── PID 202132 (NOT the kill target)
      └─ WindowsTerminal.exe         ─── PID  32460 (server — never killed)
         └─ explorer.exe
```

`<memberDir>/launcher.pid` captures PID 202132. The current code does NOT
capture the inner-CLI PID (181704). The v2 plan adds that capture.

## 2. Process-kill behaviour — corrected after operator pushback

### Experiment 2.1 — Killing the launcher pwsh leaves a `[process exited with code 1]` placeholder

**v1 WRONG conclusion** (recorded for posterity): I observed
`OpenConsole.exe` count drop by 1 after `Stop-Process -Force` on the
launcher pwsh and concluded the tab had visually closed. The operator
directly checked their wt window and saw:

```
PowerShell 7.5.4
=========================================
  TAB B  --  WILL BE KILLED
  PID = 266056  PPID = 32460
  This tab should DISAPPEAR when I run taskkill
=========================================

[process exited with code 1 (0x00000001)]
You can now close this terminal with Ctrl+D, or press Enter to restart.
```

**Root cause.** WT's default `closeOnExit: graceful` closes the tab on
exit code 0 but shows `[process exited with code N]` placeholder on any
non-zero exit. `Stop-Process -Force` / `taskkill /F` issue
`TerminateProcess`, which sets exit code to **1** by default. Graceful
sees code 1 → renders placeholder.

**Lesson.** `OpenConsole.exe`-count delta is NOT a reliable proxy for
"tab visually disappeared". The OC drop is real (the tab-paired
OpenConsole is reaped), but WT re-uses the tab pane to render the
placeholder UI without needing a live OC.exe process. Future empirical
work on tab behaviour MUST verify with operator eyes (or screenshot /
UIA inspection), not process-tree counts.

### Experiment 2.2 — Launcher with explicit `exit 0` closes the tab cleanly

Spawned two tabs in a new WT window `DEMO-V2-111117`:

- **Tab C** ran `pwsh -File <launcher>` (NO `-NoExit`) where the launcher
  started a child via `Start-Process … -PassThru`, captured the child
  PID, ran `$child.WaitForExit()`, then `exit 0`. We killed ONLY the
  child (`taskkill /F /PID <childPid>` — no `/T` needed for the test
  since the child had no descendants). The launcher's `WaitForExit`
  returned, the script continued to `exit 0`, pwsh exited 0.
- **Tab D** was a control: launcher slept 8 s then ran `exit 1`. No
  external kill — pure exit-code-1 path through the same
  `closeOnExit: graceful` pipeline.

**Operator visual verification:** "now I see only tab D left" — Tab C
closed cleanly with no placeholder; Tab D persisted as the placeholder.

**This validates the corrected strategy.** Three linked requirements
emerge:

1. The launcher script must NOT use `-NoExit` (so pwsh actually returns
   control to the OS when the script ends).
2. The launcher script must END WITH EXPLICIT `exit 0` (so the exit code
   passed to WT is 0 regardless of what the inner CLI's exit code was).
3. Hard-terminate must kill ONLY the inner CLI process (and its
   descendants), NOT the launcher pwsh — because we need the launcher
   pwsh to run its `exit 0` line after `WaitForExit` returns on the
   killed inner CLI.

### Experiment 2.3 — `taskkill /T /F` cascades over the inner-CLI subtree

Verified earlier: `taskkill /T /F /PID <parentPid>` cascades to every
descendant. `Stop-Process -Force` alone does NOT cascade on Windows
(`TerminateProcess` doesn't recurse) — orphaned children survive. For
the inner CLI's subtree (copilot.exe + its Node descendants + any
tool-call pwsh.exe children), the kill mechanism must therefore use
either `taskkill /T /F` (one external call, simplest) or an explicit
PowerShell BFS-and-stop walk (no `cmd.exe` dependency). Both are
functionally equivalent. Plan recommends `taskkill /T /F` for brevity.

### Experiment 2.4 — `WindowsTerminal.exe` server PID always survives

In every kill experiment, WT server PID 32460 was unchanged. The
corrected kill set contains ONLY the inner CLI's subtree — never the
launcher pwsh, never the WT server. The "MUST NOT kill WT server"
constraint is structurally enforced: the walk starts at the inner CLI
(grandchild of WT) and only traverses downward, so it can't reach the
WT server even by accident. Bonus: the launcher pwsh itself also
survives the kill (it transitions through `& copilot returned →
exit 0 → pwsh exits 0` in the milliseconds following the inner kill;
it dies as a result of running `exit 0`, not because we killed it).

## 3. `wt.exe` CLI surface (T1 feasibility)

Unchanged from v1 — `wt.exe` CLI cannot target a tab by stable identity:

| Invocation | Exit code | Effect |
|---|---|---|
| `wt nonexistent-subcommand` | 0 | silent no-op |
| `wt -w … close-pane` | 0 | silent no-op from external shell |
| `wt -w … focus-tab --title <unique>` | 0 | silent no-op |
| `wt -w … close-tab --title <unique>` | 0 | silent no-op |
| `wt -w … close-tab` (bare) | 0 | silent no-op |

`wt.exe` is a fire-and-forget signaler to the WT server; subcommands the
server doesn't recognize are silently dropped, all with exit 0. There is
no documented `--tabid` or `--title`-targeted close in WT 1.24.
**T1 (wt CLI tab-close) remains INFEASIBLE.**

Therefore the strategy depends entirely on `closeOnExit: graceful` doing
the right thing when given exit code 0 — which §2.2 confirmed it does.

## 4. Two distinct placeholder failure modes — both must be fixed

The operator's "empty placeholder tab" report from the original smoke
test (different shape — empty pwsh prompt, no `[process exited]` text)
and the `[process exited with code 1]` placeholder I produced by killing
the launcher pwsh are TWO DIFFERENT failures with TWO DIFFERENT root
causes. The plan must address both.

### 4.1 Failure mode A — `-NoExit` placeholder (soft-stop path)

Current spawn argv:

```js
const wtArgs = options.newWindow
  ? ['new-tab', '--title', tabTitle, 'pwsh', '-NoExit', '-File', scriptPath]
  : ['-w', windowName, 'new-tab', '--title', tabTitle, 'pwsh', '-NoExit', '-File', scriptPath];
```

`pwsh -NoExit -File <launcher>` instructs pwsh to NOT exit after the
launcher script finishes. The launcher's last line is
`copilot --name ... -i <prompt>`. When copilot exits cleanly (soft-stop
ack flow), the launcher script ends, but pwsh remains alive at an empty
interactive prompt because of `-NoExit`. The tab stays open hosting an
empty pwsh prompt.

Verified empirically: a test tab with `pwsh -NoExit -File <script that
ends with exit 0>` left the launcher pwsh alive for 35+ seconds after
the script's `exit 0`; the tab persisted as an empty prompt.

### 4.2 Failure mode B — non-zero-exit-code placeholder (hard-terminate path)

If the launcher pwsh exits with a non-zero code, WT's
`closeOnExit: graceful` (default) renders `[process exited with code N]`
placeholder. `Stop-Process -Force` / `taskkill /F` set exit code 1, so
killing the launcher pwsh directly always produces the placeholder.
Confirmed by operator visual verification after experiment 2.1.

### 4.3 The fix requires all three changes together

A correct hard-terminate path needs ALL of:

1. **Drop `-NoExit`** so the launcher pwsh actually exits when the
   script ends (eliminates failure mode A on the soft-stop path too,
   as a bonus).
2. **End the launcher script with explicit `exit 0`** so pwsh ALWAYS
   exits 0 regardless of the inner CLI's exit code (eliminates failure
   mode B for the hard-terminate path).
3. **Kill the INNER CLI process subtree, NOT the launcher pwsh** so the
   launcher pwsh can run its `exit 0` after `WaitForExit` returns.

All three are coupled. The plan binds them into ONE story (US-01).
Partial adoption recreates one of the placeholder failures. (Also note:
change #1, dropping `-NoExit`, is a behaviour change for the existing
soft-stop path — current users who lean on the empty pwsh prompt for
debugging will lose that affordance. Plan documents the loss + offers
an `OPTIONAL` `CREWS_KEEP_TAB_OPEN=1` env var as a debugging escape
hatch that re-enables `-NoExit`.)

## 5. Capturing the INNER CLI PID — new work required

The current launcher captures only `$PID` (launcher pwsh PID) to
`<memberDir>/launcher.pid`. v1 was wrong about this being sufficient.
v2's corrected strategy needs the inner CLI PID too. Three options, in
preferred order:

### Option 5A (recommended) — `Start-Process … -PassThru` in the launcher

Refactor the launcher's tail from:

```
copilot --name '...' --allow-all -i '<prompt>'
```

to:

```
$crewsInner = Start-Process -FilePath copilot -ArgumentList @('--name','...','--allow-all','-i','<prompt>') -NoNewWindow -PassThru
[ordered]@{ pid = $crewsInner.Id; startedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress | Set-Content -LiteralPath '<inner.pid>' -Encoding ascii
$crewsInner.WaitForExit()
exit 0
```

`Start-Process -NoNewWindow -PassThru` inherits stdin/stdout/stderr from
the parent pwsh's console — should preserve interactive copilot UX.
Impl member MUST sanity-check this with one real interactive spawn
before shipping (open Q #1 below); some terminal UIs behave differently
under Start-Process versus inline `&`. The inner CLI's PID is captured
to disk before `WaitForExit` blocks — zero race window.

### Option 5B (fallback) — post-spawn WMI polling from Node side

After `child_process.spawn('wt.exe', wtArgs, …)` in `spawnMember`, kick
off a Node-side polling loop that runs `pwsh -Command "Get-CimInstance
Win32_Process -Filter \"Name='copilot.exe' AND ParentProcessId=<launcherPid>\""`
with exponential backoff up to ~30 s, writes `inner.pid` on first hit.
Race window: hard-terminate within the first second is ambiguous —
either retry the WMI lookup at kill time, or fall back to killing the
launcher pwsh (accept the placeholder).

### Option 5C (worst) — kill-time WMI discovery only

At hard-terminate call, walk from `launcherPid`'s descendants to find
copilot.exe / claude.exe and kill its subtree. Same race window as 5B
but worse because the manifest never carries a durable record of the
inner PID — forensic auditability lost.

**Plan picks Option 5A.** The launcher script must change anyway (for
the `exit 0` requirement in §4.3); rolling the inner-PID capture into
the same edit is free.

## 6. wt `closeOnExit` setting — load-bearing for our strategy

Read `C:\Users\evmitran\AppData\Local\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json`.
All profiles (including `defaults`) leave `closeOnExit` empty — WT
default `graceful` applies. Per docs (verified against empirical
behaviour in experiment 2.2): `graceful` closes on exit 0, shows
placeholder on non-zero. `TerminateProcess` exit code is 1, so directly
killing pwsh = placeholder.

**This is now load-bearing.** The strategy depends entirely on the
launcher running `exit 0` AFTER the inner CLI's `WaitForExit` returns,
so that `closeOnExit: graceful` sees exit code 0 and closes the tab.

**Risk: user has overridden `closeOnExit` to `never`.** In that case the
tab persists even on exit 0. Plan recommends a spawn-time settings.json
sanity check: read the user's settings, if the spawn-profile's
`closeOnExit` resolves to `never`, log a warning. UX courtesy, not a
hard failure.

**Risk: WT version too old for `closeOnExit`.** Documented support
landed in WT 1.10 (2021). Verified on 1.24.10921.0 here. Plan
recommends a WT-version-gate log at spawn time warning "WT 1.10+
recommended for hard-terminate to close tabs cleanly".

## 7. Open questions for impl

1. **`Start-Process -NoNewWindow -PassThru` vs. inline `& copilot`.**
   Plan recommends 5A (Start-Process for race-free PID capture). Impl
   MUST run ONE interactive sanity test: spawn a member via the
   refactored launcher, type a multi-line prompt at copilot's REPL,
   confirm input/output behaves identically to the current `& copilot`
   path. If anything differs (echo, line-editing, control-key handling,
   colour rendering, prompt redraw), fall back to Option 5B.
2. **`taskkill /T /F` vs. PowerShell BFS-and-stop.** Both work. Plan
   recommends `taskkill /T /F`. Impl may switch.
3. **Audit-log retention.** `manifest.terminatedPids` records the inner
   CLI PID + its descendants. Plan also records the un-killed launcher
   pwsh PID and the un-killed WT server PID for forensic proof of the
   safety boundary.
4. **Cross-engine.** Both `taskkill /T /F` and `Start-Process` work
   identically for Claude Code members (inner = `claude.exe`). The
   launcher-script template's Start-Process arglist is engine-branched
   in `buildLauncherCommand` already; no new engine-specific logic.
5. **`closeOnExit: never` override** — warning only.
6. **First-second race.** Hard-terminate called within ~50 ms of spawn
   may find no `inner.pid`. Plan: kill helper waits up to 5 s for
   `inner.pid` to exist; if not present, fall back to killing the
   launcher pwsh (accept placeholder) and log a warning. Extremely rare
   in real bookkeeper flows.
7. **`-NoExit` regression for debugging.** Operators who currently
   rely on `-NoExit` to inspect failed launchers will lose that
   affordance. Plan offers `CREWS_KEEP_TAB_OPEN=1` env var as an
   opt-in debugging escape hatch that re-enables `-NoExit` (at the
   cost of restoring failure mode A).

## 8. Anomalies and irrelevant findings

- `wt.exe nonexistent-subcommand` returns exit 0 (not 1). We can't
  use exit-code probing for wt subcommand discovery; we relied on
  side-effect observation (and ultimately on operator visual check)
  as the only honest signal. Document, don't block.
- **OpenConsole-count delta is NOT a reliable proxy for "tab visually
  closed".** My v1 conclusion was based on this proxy and was wrong.
  Future empirical work on WT tab behaviour MUST involve operator
  visual verification or UIA-level inspection, not process-tree
  counts. This is the load-bearing lesson of the v1→v2 plan rewrite.
- `manifest.launcherPid` is stored on disk as
  `<memberDir>/launcher.pid`. v2 plan adds a sibling
  `<memberDir>/inner.pid` with the same JSON shape. Both stay on disk
  for atomic-write simplicity.
- `copilot.exe` is the Windows shim at
  `C:\Users\evmitran\AppData\Local\Microsoft\WinGet\Links\copilot.exe`.
  It spawns a real Node process under the hood; `Start-Process
  -PassThru` returns the shim's PID. `taskkill /T /F` on the shim PID
  cascades to the Node descendants.
- The launcher's parent (WT server PID 32460) is shared across every
  WT window in the user's session — including the bookkeeper-lead's
  own tab. The "must never kill WT server" constraint is structurally
  enforced by the kill walk starting at the inner CLI (grandchild of
  WT) and only descending; the walk's upward boundary is the launcher
  pwsh, which it never crosses.

## 9. Demo cleanup notes

Two placeholder tabs were left in the operator's WT window during v1/v2
investigation:

- Tab B (`DEMO-B-will-be-killed`, red) from the first demo — shows
  `[process exited with code 1]`.
- Tab D (`TAB-D-exit-1`, magenta) from the second demo — shows
  `[process exited with code 1]`.

Both are harmless — they're idle WT tab placeholders, no live processes
behind them. Operator can close them with Ctrl+D or by clicking the X.
Listed here so the impl member's regression-test workflow knows to
expect occasional residue when verifying the corrected `exit 0` path.
