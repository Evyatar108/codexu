# Plan — crews stop-member hard-terminate (v2, corrected)

> **v2 supersedes the v1 plan at commit `33326b6a`.** The v1 strategy was
> empirically wrong about the kill target — operator caught it via direct
> visual inspection of a live test tab. v2 captures the corrected
> strategy (kill the INNER CLI, NOT the launcher; require the launcher
> to end with explicit `exit 0`; drop `-NoExit`).
>
> Branch for this rewrite:
> `ralph/plan-crews-stop-member-hard-terminate-no-envelope-v2`.
> Lead should FF this into main and re-emit a `33326b6a`-equivalent
> bookkeeping update marking the original task `replan-pending → plan-ready`
> against v2.

**Task.** Replace the current soft-stop ack round-trip in `crews stop-member`
with a hard-terminate path that kills the inner CLI's process subtree and
lets the launcher pwsh exit cleanly with `exit 0` so the tab visually
closes (no `[process exited]` placeholder). The shared
`WindowsTerminal.exe` server is never targeted.

**Repo.** `Evyatar108/ai-developer-toolkit`, plugin `plugins/crews`.

**Branch (impl).** `ralph/crews-stop-member-hard-terminate-no-envelope`.

**Version bump.** Crews plugin **v1.9.0**.

**Phase discipline.** Plan-only deliverable. No code edits in this branch
beyond the four files under `.ralph/jobs/<task>/`.

---

## 1. Operator-facing intent

Current `/crews-stop-member <name>` (soft):
1. Sets `manifest.shutdownRequested=true`, marks listener exited.
2. Appends a `stop-request` envelope to the member's mailbox.
3. Member reads the envelope, emits a `kind=done` ack turn.
4. Stop hook authorizes the turn end; the CLI may exit. Launcher pwsh's
   `-NoExit` keeps the tab open at an empty prompt = placeholder.

New default behaviour (hard):
1. Lead invokes `/crews-stop-member <name>` (no flag).
2. Manifest updated (`shutdownRequested=true`, `listenerState='exited'`,
   `actorState='cleared'`, `terminationKind='hard'`, `terminatedAt`,
   `terminatedPids`).
3. Read `<memberDir>/inner.pid` (captured at spawn — see §3 spawn-side
   change). Verify the PID is alive AND that its CommandLine contains
   the engine binary name (`copilot.exe` / `claude.exe`) AND that its
   parent PID matches `<memberDir>/launcher.pid` — recycled-PID guard.
4. `taskkill /T /F /PID <innerCliPid>` — kills the inner CLI subtree
   (the CLI itself + Node descendants + any tool-call pwsh shells).
5. Launcher pwsh sees its `$crewsInner.WaitForExit()` return; runs the
   next line `exit 0`; pwsh exits 0; `closeOnExit: graceful` closes the
   tab visually (no placeholder).
6. WT server PID untouched (structurally — the kill subtree never
   reaches it).
7. NO `stop-request` envelope appended; member never emits a second
   `kind=done` ack.

Rare-case soft path (`--soft`): preserves current behaviour verbatim for
callers who explicitly need it.

---

## 2. Files touched (impl preview)

| File | Change |
|---|---|
| `hooks/actors.js` (`spawnMember`, launcher script generation) | (a) drop `-NoExit` from `wtArgs`; (b) refactor launcher script tail to `Start-Process -PassThru` the inner CLI, capture inner PID to `<memberDir>/inner.pid`, `WaitForExit`, then explicit `exit 0`; (c) add `hardTerminateMemberByInnerPid(innerPid, opts)` helper; (d) add `applyHardStopMember(target, lead, cwd, opts)` parallel to existing `applyStopMember`; (e) thread `opts.soft` through `stopMemberAsLead` / `stopMemberByOperator`. |
| `hooks/commands/stop-member.js` | Slash + CLI parsers accept `--soft` (default = hard). Usage docs + parityVectors updated. |
| `hooks/protocol/manifest.js` | Additive fields: `terminationKind`, `terminationReason`, `terminatedAt`, `terminatedPids` (object: `innerCli`, `descendants`, `launcherPwsh` unkilled, `wtServerPid` unkilled). |
| `hooks/config.js` | Re-export `hardTerminateMemberByInnerPid`. |
| `tests/stop-member-hard-terminate.test.js` (NEW; cross-platform skip) | Portable: spawn a no-launch member (`CREWS_NO_LAUNCH=1`), fake `inner.pid` pointing at a Node sleep child; invoke kill helper; assert child PID dead + manifest fields written. |
| `tests/stop-member-hard-terminate-wt-tab-closes.test.js` (NEW; gated by `CREWS_WT_LIVE_TESTS=1`) | Windows-only, real wt spawn. Verifies (a) WT server PID unchanged; (b) tab actually closes (assertion path: capture WT window count / tab count via UIA OR poll for the spawned tab's title disappearing from `wt`'s named-pipe-listing if accessible; see §4 below for the exact assertion mechanism). |
| `tests/stop-member-cli.test.js` (EXTEND) | Assert `--soft` parses; default routes to hard handler; parityVectors updated. |
| `tests/spawn-member-launcher-template.test.js` (NEW or extend if exists) | Snapshot test for the refactored launcher script: contains `Start-Process … -PassThru`, captures `inner.pid`, ends with `exit 0`, no `-NoExit` in the wt args. |
| `CHANGELOG.md` | `## v1.9.0` section: round-trip-cost rationale; **explicit safety guarantee** (WT server untouched); explicit dependency on `closeOnExit: graceful` (the WT default; warning logged if user overrides to `never`); `--soft` opt-in; `CREWS_KEEP_TAB_OPEN=1` debug escape hatch. |
| `AGENTS.md` (plugin) | Update "Stop a member" section. |
| `codexu AGENTS.md` (separate consumer commit) | One-line workflow-diagram update. Listed as a follow-up; NOT this PR. |

---

## 3. Design decisions

### Q1 — API shape: **Option C (flip default + `--soft` opt-in)**

Unchanged from v1. Hard is the operator's common case; `--soft`
preserves legacy for any caller that needs it. No real consumer of the
soft ack-flow surfaced in either AGENTS.md or the crews test suite.

### Q2 — Hard-terminate mechanism: **`taskkill /T /F /PID <innerCliPid>` (NOT the launcher pwsh)**

**v1 ROUTE WAS WRONG.** v1 said kill the launcher pwsh with a
PowerShell descendant BFS. The operator's direct visual verification
showed this leaves a `[process exited with code 1]` placeholder tab.
The corrected route kills the INNER CLI (`copilot.exe` /
`claude.exe`) and its descendants, leaving the launcher pwsh alive to
hit its `exit 0` line — verified working in research-brief §2.2.

Steps:

1. Read `<memberDir>/inner.pid` (JSON `{ pid, startedAt }`); if missing
   or empty, wait up to 5 s for it to be written, then fall back to
   killing the launcher pwsh + accept the placeholder (extremely rare
   race; logged as warning).
2. Recycled-PID guard:
   - `(Get-CimInstance Win32_Process -Filter "ProcessId=$innerPid").Name`
     must match the engine binary (`copilot.exe` or `claude.exe`).
   - `(Get-CimInstance Win32_Process -Filter
     "ProcessId=$innerPid").ParentProcessId` must equal the value in
     `launcher.pid`.
   - If either mismatch, refuse to kill, surface
     `PidRecycledRefuseToKillError`.
3. Compute `wtServerPid` = `Get-CimInstance Win32_Process -Filter
   "ProcessId=$launcherPid").ParentProcessId`. **Record only — never
   killed.**
4. `taskkill /T /F /PID $innerPid` (or PowerShell BFS-and-stop
   equivalent; both produce identical results).
5. Wait up to 3 s for the launcher pwsh PID to exit naturally (it runs
   `exit 0` after `WaitForExit` returns). If still alive after 3 s,
   log a WARNING (the launcher's `exit 0` line may have been clobbered
   by a custom script template), then `taskkill /F /PID <launcherPid>`
   as last-resort cleanup — accept the placeholder.
6. Return `{ inner: <pid>, descendants: [<pids killed by /T>],
   launcherPwsh: <pid, marked 'exited naturally' or 'force-killed'>,
   wtServerPid: <pid, 'survived'> }` for manifest audit.

### Q3 — Spawn-side launcher refactor: required for v2

The current launcher tail:

```pwsh
copilot --name '...' --allow-all -i '<prompt>'
```

must become:

```pwsh
$crewsInner = Start-Process -FilePath copilot -ArgumentList @('--name','...','--allow-all','-i','<prompt>') -NoNewWindow -PassThru
[ordered]@{ pid = $crewsInner.Id; startedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress | Set-Content -LiteralPath '<inner.pid>' -Encoding ascii
$crewsInner.WaitForExit()
exit 0
```

AND `wtArgs` must drop `-NoExit`:

```js
const wtArgs = options.newWindow
  ? ['new-tab', '--title', tabTitle, 'pwsh', '-File', scriptPath]
  : ['-w', windowName, 'new-tab', '--title', tabTitle, 'pwsh', '-File', scriptPath];
```

(For the engine=claude branch, `buildLauncherCommand` already produces
an engine-specific arglist; the Start-Process refactor needs to be
applied to BOTH branches.)

**Open question for impl (high priority).** Does `Start-Process
-NoNewWindow -PassThru copilot.exe` preserve interactive REPL UX
identically to `& copilot.exe`? Impl member MUST verify this BEFORE
shipping by spawning ONE real member, typing a multi-line prompt at
the copilot REPL, confirming echo + line-editing + colour rendering
+ tool-call output match the current `& copilot` path. If anything
differs, fall back to research-brief Option 5B (Node-side WMI polling
to capture the inner PID) and revert the launcher to `& copilot`.

**`CREWS_KEEP_TAB_OPEN=1` env var.** As a debugging escape hatch for
operators who currently rely on `-NoExit` to inspect failed launchers,
the spawn script checks the env var at run time and emits a final
`if (-not $env:CREWS_KEEP_TAB_OPEN) { exit 0 } else { Read-Host
'press enter to close' }` instead of bare `exit 0`. Default behaviour
(no env var) is `exit 0` — tab closes. With `CREWS_KEEP_TAB_OPEN=1`,
the tab stays at a "press enter" prompt for inspection.

### Q4 — Manifest state + audit log (revised)

```jsonc
{
  // existing fields unchanged …
  "shutdownRequested": true,
  "shutdownRequestedAt": "2026-…",
  "shutdownRequestedBy": "<lead>",
  "shutdownReason": "<reason or null>",
  "lastListenerExitedAt": "2026-…",

  // NEW (hard-only):
  "terminationKind": "hard",
  "terminatedAt": "2026-…",
  "terminatedPids": {
    "innerCli": 181704,                       // killed (+ tree via /T)
    "descendants": [85216, /* …others… */],   // killed
    "launcherPwsh": {
      "pid": 202132,
      "fate": "exited-naturally"              // | "force-killed-fallback"
    },
    "wtServerPid": 32460                      // recorded, NEVER killed
  },
  "actorState": "cleared"
}
```

### Q5 — Edge cases (revised)

| Edge case | Behaviour |
|---|---|
| `inner.pid` file missing (just-spawned member; race) | Wait up to 5 s; if still missing, fall back to launcher-pwsh kill + accept placeholder. Log WARNING. |
| `inner.pid` present but PID dead (CLI crashed) | No-op kill; record `launcherPwsh.fate='exited-naturally'` after waiting for it; mark manifest cleared. |
| `inner.pid` recycled (alive but wrong process) | `PidRecycledRefuseToKillError`; manifest NOT updated to `cleared`. |
| Member mid-tool-call (active model inference, child pwsh.exe running a Bash tool) | Kill anyway; `/T` cascades to the child pwsh. Output truncated mid-call; documented risk. |
| wt tab manually closed by operator (Ctrl+W) | Inner-PID lookup returns nothing; no-op kill; mark cleared. |
| Multi-WT-server (Stable + Preview both installed) | `wtServerPid` walk identifies OUR server (launcher's PPID); kill set never includes any WT server PID. |
| `closeOnExit: never` overridden by user | Tab persists after `exit 0`; logged WARNING at spawn time. UX nit, not correctness. |
| `CREWS_KEEP_TAB_OPEN=1` set | Launcher waits at "press enter" prompt instead of `exit 0`; tab stays open until operator dismisses. Hard-terminate still kills the inner CLI cleanly; just doesn't auto-close the tab. |

### Q6 — AGENTS.md updates

Plugin AGENTS.md "Stop a member" section gets:

> v1.9.0+: `stop-member` defaults to HARD-terminate. The inner CLI
> (`copilot.exe` / `claude.exe`) and its descendants are killed with
> `taskkill /T /F`. The launcher pwsh's `WaitForExit` returns, the
> script hits `exit 0`, pwsh exits 0, and Windows Terminal's
> `closeOnExit: graceful` default closes the tab cleanly (no
> `[process exited]` placeholder).
>
> The `WindowsTerminal.exe` server PID is NEVER targeted — every
> other tab in every wt window survives. The launcher pwsh itself
> survives the kill (it dies as a result of its own `exit 0`, not
> because we killed it).
>
> Pass `--soft` for the legacy mailbox-envelope ack flow. Set
> `CREWS_KEEP_TAB_OPEN=1` to keep tabs open after hard-terminate for
> debugging (re-enables the v1-era `-NoExit` placeholder behaviour
> as an opt-in).
>
> See `.ralph/jobs/crews-stop-member-hard-terminate-no-envelope/research-brief.md`
> for empirical basis (including operator-visual verification of the
> v1 → v2 strategy correction).

Codexu AGENTS.md gets a one-line workflow-diagram update — separate
consumer-side commit, NOT this PR.

---

## 4. Tests + verification gates

### Local typecheck / lint
- `node --check hooks/commands/stop-member.js`, `hooks/actors.js`,
  `hooks/protocol/manifest.js`.
- `node tests/run-all.test.js` (or whatever the crews suite entry is).

### Test coverage matrix

| Story | Test file | What's asserted |
|---|---|---|
| US-01 | `tests/spawn-member-launcher-template.test.js` (NEW or extend) | Refactored launcher contains `Start-Process … -PassThru`, captures `<memberDir>/inner.pid`, ends with `exit 0`. `wtArgs` does NOT contain `-NoExit`. |
| US-01 | `tests/stop-member-hard-terminate.test.js` (NEW; cross-platform skip) | Spawn no-launch member; write fake `inner.pid` pointing at a Node `setTimeout(…, 600000)` child; invoke `hardTerminateMemberByInnerPid`; assert child PID dead within 3 s + manifest fields set. |
| US-01 | `tests/stop-member-hard-terminate-wt-tab-closes.test.js` (NEW; gated `CREWS_WT_LIVE_TESTS=1`) | Real wt spawn. Capture WT server PID (launcher's PPID). After hard-terminate: (a) WT server PID still alive; (b) tab gone — verified by polling `wt`'s tab-list named-pipe IF exposed, OR by UIA traversal of WT window descendants, OR (lowest-tech fallback) by asserting the launcher pwsh PID exited and that NO `pwsh.exe` whose CommandLine matches our launcher script path is alive. The OperatorCount-delta proxy MUST NOT be used (v1 used it and was wrong). |
| US-02 | `tests/stop-member-cli.test.js` (EXTEND) | `--soft` parses; default routes to hard; parityVectors updated. |
| US-03 | `tests/stop-decision.test.js` (verify unchanged) | Stop-hook authorization still works on `shutdownRequested=true`. |

### Manual verification (impl member, before shipping)

1. Spawn an interactive member via the refactored launcher.
2. Type a multi-line prompt at the copilot REPL. Verify echo,
   line-editing, colour, and tool-call output behave identically to
   pre-v1.9.0 spawn (this is the `Start-Process -NoNewWindow` UX
   verification from Q3).
3. From the lead, run `/crews-stop-member <test-name>`.
4. Confirm visually that the tab DISAPPEARS (no `[process exited]`
   placeholder), `WindowsTerminal.exe` PID unchanged, manifest contains
   the new audit fields with `terminatedPids.launcherPwsh.fate=
   'exited-naturally'`.
5. Repeat with `--soft`; confirm legacy two-envelope flow still works.
6. Repeat with `CREWS_KEEP_TAB_OPEN=1` in the spawn env; confirm tab
   stays at "press enter" prompt after kill (debugging escape hatch).

---

## 5. Sequencing (single-job, three stories, partial parallelism)

| Phase | Cluster | Stories | Note |
|---|---|---|---|
| 1 | `core-kill-and-launcher` | US-01 | Foundation. Touches both `spawnMember` launcher generation AND the new kill helper. Must land first. |
| 2 | `cli-default-flip` | US-02 | Surface change. Cannot run before US-01 (default route uses the helper). |
| 3 | `audit-and-docs` | US-03 | CHANGELOG, AGENTS.md, manifest JSDoc. Must land last for accurate CHANGELOG copy. |

Estimated 3-5 commits, single impl member, serial. The Start-Process
UX verification (Q3 open question) is the only meaningful risk; if it
fails, impl falls back to research-brief Option 5B (heavier change,
Node-side WMI polling) and US-01's scope grows by ~150 lines.

---

## 6. Follow-ups (separate tasks, NOT in this PR)

| ID | Scope | Summary |
|---|---|---|
| `crews-soft-stop-placeholder-cleanup` | crews | Even with `-NoExit` dropped, soft-stop's two-envelope flow still has the round-trip cost we're avoiding. Investigate retiring the soft path in v2.0 if no usage materializes. |
| `crews-cross-platform-hard-terminate` | crews | macOS (osascript / process-group kill) + Linux (`setsid` + `kill -PGID`). Currently throws "not-yet-implemented" on non-Windows. |
| `codexu-agents-md-stop-member-update` | codexu | Workflow-diagram + invariants one-liner. Separate from plugin PR. |
| `crews-wt-tab-close-direct-api` | crews | If Microsoft adds `wt close-tab --tabid <id>` in a future WT version, switch from "exit 0 + closeOnExit" to direct CLI close. Currently INFEASIBLE (verified WT 1.24). |

---

## 7. Acceptance criteria for the impl member

1. `/crews-stop-member <name>` (no flag) kills the inner CLI subtree
   (NOT the launcher pwsh), the launcher pwsh exits 0 cleanly, the tab
   visually disappears (no `[process exited]` placeholder),
   `WindowsTerminal.exe` server PID is unchanged, NO `stop-request`
   envelope is appended to the member's mailbox.
2. `--soft` exhibits the exact pre-v1.9.0 behaviour (manifest mutation,
   mailbox envelope, member ack-round-trip).
3. Manifest after hard stop has: `terminationKind='hard'`, `terminatedAt`,
   `terminatedPids.innerCli` (number), `terminatedPids.descendants`
   (array), `terminatedPids.launcherPwsh={pid, fate:'exited-naturally'|
   'force-killed-fallback'}`, `terminatedPids.wtServerPid` (number, alive
   after kill), `actorState='cleared'`.
4. `spawnMember`'s wt argv does NOT contain `-NoExit`; launcher script
   contains `Start-Process … -PassThru` + captures `inner.pid` +
   ends with `exit 0` (unless `CREWS_KEEP_TAB_OPEN=1`, in which case it
   waits at "press enter" prompt).
5. Interactive UX of the inner CLI is verified unchanged from
   pre-v1.9.0 (Q3 open question above; impl member runs the manual
   check).
6. The new `tests/stop-member-hard-terminate.test.js` passes on Windows,
   skips cleanly on non-Windows. The gated live-WT test passes when
   `CREWS_WT_LIVE_TESTS=1` is set on a Windows dev box.
7. CHANGELOG.md v1.9.0 entry includes: round-trip-cost rationale; the
   v1 → v2 correction story (operator caught the wrong kill target);
   explicit dependency on `closeOnExit: graceful` + behaviour on
   `never` override; `--soft` opt-in; `CREWS_KEEP_TAB_OPEN=1` env var.
8. Plugin `AGENTS.md` "Stop a member" section updated.
9. No regression in `tests/stop-decision.test.js`,
   `tests/stop-member-wake.test.js`, `tests/stop-member-cli.test.js`.

---

## 8. Reporting back from impl

The impl member's `kind=done` body must include:

- Commit SHA(s) on `Evyatar108/ai-developer-toolkit:main`.
- Outcome of the Q3 Start-Process UX verification (passed unchanged, or
  fell back to Option 5B).
- Outcome of the gated live-WT regression test (WT server PID before vs.
  after; tab-closure verification method used).
- Any deviation from the plan with rationale.
