# Investigation — crews `--engine codex` member spawn does not start a session

**Task:** `crews-codex-member-spawn-does-not-start-session`
**Date:** 2026-06-05
**Mode:** READ-ONLY diagnosis. No code changed. **HOLD for operator.**
**Box:** Windows 11, codex `0.135.0-copilot-api.1`, crews `v3.6.3` (installed at
`~/.copilot/installed-plugins/ai-developer-toolkit/crews/`).

---

## TL;DR — root cause

The crews codex launcher invokes codex's **interactive TUI** with
`--sandbox workspace-write … --add-dir 'C:\Users\evmitran\.crews'`.

In codex `0.135.0`, the TUI startup path contains a **hard, fatal guard**:
when `--add-dir` is supplied but the *effective permission profile* does not
already grant additional writable roots, codex prints
`Error adding directories: …` and calls **`std::process::exit(1)`** —
**before** the agent session starts, before the crews `SessionStart` hook
fires, before the listener arms.

`codex-rs/tui/src/lib.rs:1167-1176`:

```rust
if let Some(warning) = add_dir_warning_message(
    &cli.add_dir,
    &config.permissions.effective_permission_profile(),
    config.cwd.as_path(),
) {
    eprintln!("Error adding directories: {warning}");
    std::process::exit(1);          // <-- HARD fatal exit, pre-TUI
}
```

On this box, `--sandbox workspace-write` on the command line does **not**
resolve into an effective-permission-profile that grants writable roots (the
guard reads `config.permissions.effective_permission_profile()`, which is
decoupled from the legacy `--sandbox` / `sandbox_mode` flag), so the guard
fires and codex exits 1 immediately. That is exactly the observed smoke
symptom: `codex-core.exe` appears for <1s then is gone, no `~/.codex/sessions`
entry is created, the manifest stays `sessionId:null` / `listenerState:
never-armed`, and the launcher pwsh is later force-killed (`refusedReason:
inner-pid-missing`).

**This is a codex version-drift regression.** The launcher was probe-verified
against `0.125.0-copilot-api.8` using `codex --help` + `codex exec` probes; the
live interactive spawn smoke (Story #3 / "CREWS_CODEX_LIVE") was **deferred**
at the v3.6.0 ship. The fatal `--add-dir` guard lives in the **TUI** path only
(`tui/src/lib.rs`), so the probe's `codex exec` checks never exercised it.

---

## The exact launcher command (captured)

From the v3.6.0 smoke launcher
`D:\harness-efforts\codexu\.crews\spawn-launchers\smoke-codex-member-1780694660321.ps1`
(line 40), the inner invocation is:

```powershell
& codex --sandbox workspace-write --ask-for-approval never --add-dir 'C:\Users\evmitran\.crews' -c 'tui.terminal_title=[]' '<initial prompt>'
```

This is emitted by `buildLauncherCommand` (flat string) and mirrored by
`buildLauncherInvocation` (structured argv) in the installed crews:
`~/.copilot/installed-plugins/ai-developer-toolkit/crews/hooks/actors.js`.

- `buildLauncherCommand` codex branch — **lines 176-221**. The load-bearing line:
  ```js
  const sandboxPart = skipPerms
    ? `--sandbox workspace-write --ask-for-approval never --add-dir '${psEscape(getCrewsHome())}'`
    : '--sandbox read-only';
  ```
- `buildLauncherInvocation` codex branch — **lines 269-288**:
  ```js
  if (skipPerms) {
    argList.push('--sandbox', 'workspace-write');
    argList.push('--ask-for-approval', 'never');
    argList.push('--add-dir', getCrewsHome());   // <-- the fatal flag
  } else {
    argList.push('--sandbox', 'read-only');
  }
  argList.push('-c', 'tui.terminal_title=[]');
  ```

`getCrewsHome()` resolves to `C:\Users\evmitran\.crews`.

Launch chain (Windows): wt.exe tab → `pwsh -File launcher.ps1` →
inline `& codex` → `codex.ps1` (npm shim) → `node codex.js` →
`codex.exe` (codex-copilot-launcher, 723 KB) → **`codex-core.exe`** (295 MB,
the actual TUI/agent). Confirmed by `codex doctor` (`executable …\codex\codex-core.exe`).

---

## Evidence chain

### 1. The smoke artifacts (real wt-tab, real TTY)

`…\members\smoke-codex-member\inner-pid-capture.trace.jsonl`:

```
…"phase":"poll-match" … "candidates":":","count":1 …
…"innerPid":0,"innerName":null … "phase":"write-success","exitCode":0
```

`…\members\smoke-codex-member\inner.pid`:
```json
{"capturedBy":"crews-v2.1.0-launcher","pid":0,"name":null,"startedAt":"…"}
```

`…\members\smoke-codex-member\manifest.json`: `listenerState: "never-armed"`,
no `sessionId`, `terminatedPids.refusedReason: "inner-pid-missing"`,
`launcherPwsh.fate: "force-killed-fallback"`.

Interpretation: `codex-core.exe` *did* briefly exist (WMI poll matched
`count:1`) but its `ProcessId`/`Name` read back empty (`":"`) because it had
already exited by the time the property read ran — i.e. it lived **<1s**. No
session, no SessionStart, no listener.

### 2. The codex source guard (why <1s)

- `tui/src/lib.rs:1167-1176` — the hard `std::process::exit(1)` shown above.
- `tui/src/additional_dirs.rs:7-44` — `add_dir_warning_message` returns
  `Some(warning)` (⇒ exit) **unless** one of:
  - `additional_dirs` is empty, **or**
  - profile is `Disabled`/`External`, **or**
  - `file_system_policy.has_full_disk_write_access()` (danger-full-access /
    unrestricted), **or**
  - `file_system_policy.can_write_path_with_cwd(cwd, cwd)` (cwd is writable).

The guard reads `config.permissions.effective_permission_profile()`, **not**
the `--sandbox` CLI flag.

### 3. Live reproduction matrix (this box, codex 0.135.0)

Ran the captured top-level command (and variants) directly, stdin = `NUL`,
output captured. `Error adding directories` ⇒ the fatal add-dir guard fired;
`stdin is not a terminal` ⇒ the guard was **cleared** and codex proceeded to
the later TTY check (an artifact of the no-TTY repro shell; a real wt-tab has a
TTY and would continue into the TUI).

| Variant | Result |
|---|---|
| `--sandbox workspace-write --add-dir <~/.crews>` *(the crews config)* | **`Error adding directories` → exit 1** |
| `--sandbox workspace-write -C codexu --add-dir <~/.crews>` | **`Error adding directories` → exit 1** |
| `--sandbox workspace-write` *(no `--add-dir`)* | guard cleared (reaches TTY check) |
| `--sandbox danger-full-access --add-dir <~/.crews>` | guard cleared (reaches TTY check) |
| *default (no `--sandbox`)* `--add-dir <~/.crews>` | guard cleared (reaches TTY check) |
| **`--dangerously-bypass-approvals-and-sandbox --add-dir <~/.crews>`** | **guard cleared (reaches TTY check)** |
| **`--dangerously-bypass-approvals-and-sandbox`** *(no `--add-dir`)* | **guard cleared (reaches TTY check)** |

Key: the *only* failing rows are the two that combine `--sandbox
workspace-write` **with** `--add-dir` — i.e. exactly the crews launcher. The
ordering (`Error adding directories` printed with **no** subsequent
`stdin is not a terminal`) proves the add-dir guard runs *before* the TTY
init, so in the real wt-tab smoke the guard is *the* failure and the TTY is
irrelevant.

### 4. Ruled out

- **codex unhealthy / not logged in** — RULED OUT. `codex doctor` =
  `16 ok · 1 idle · 3 notes · 1 warn · 0 fail`. Provider `copilot`, auth OK
  (`api.githubcopilot.com` reachable), state DBs healthy. The operator runs
  `codex` interactively (doctor rollout sources show `cli=12`) and `codex exec`
  (`exec=1320`) routinely.
- **Interactive first-run not completed** (seed hypothesis #2) — RULED OUT.
  `~/.codex-copilot/config.toml` exists (first-run shell prompt + `codex login`
  already done). The codex-copilot-launcher won't prompt.
- **Port 4141 / copilot-api proxy down** — IRRELEVANT. `copilot_api_port = 4141`
  lives only in `~/.codex-copilot/config.toml`; per `codex/CLAUDE.md` that v5-era
  key was removed and is silently ignored. Default `codex` uses `CODEX_HOME=~/.codex`,
  whose config drives the copilot provider directly. Port 4141 is closed and that
  does not matter.
- **Windows sandbox machinery broken** — RULED OUT. `codex sandbox -- cmd /c
  echo …` returns exit 0; the restricted-token sandbox works.
- **Wrong inner-PID capture target (`codex-core.exe` vs `codex.exe`)** — NOT the
  cause. `codex doctor` confirms the running image is `codex-core.exe`, so the
  capture target is correct. The `pid:0` is a *consequence* of codex-core.exe
  exiting in <1s, not a capture-name miss. (Once the launch is fixed, the capture
  should resolve normally; no separate fix needed there.)
- **node→native spawn losing the TTY** — NOT the cause. The operator's own
  interactive `codex` uses the identical `codex.ps1 → node → codex.exe →
  codex-core.exe` chain and works; the only difference under crews is the flag set.

---

## Why `--sandbox workspace-write` doesn't satisfy the guard

The guard validates `config.permissions.effective_permission_profile()`, the
newer "permission profile" abstraction, which on this box does not derive
"writable roots" from the legacy `--sandbox`/`sandbox_mode` CLI flag. Empirically
(matrix row "`--sandbox workspace-write -C codexu --add-dir`") even with the cwd
set to the workspace root, `can_write_path_with_cwd(cwd, cwd)` returns false and
`has_full_disk_write_access()` returns false ⇒ the guard fires. Only
`danger-full-access` / `--dangerously-bypass-approvals-and-sandbox` (full disk
write ⇒ `has_full_disk_write_access()` true) or the box's *default* unrestricted
profile clear it. The error message ("Switch to workspace-write …") is therefore
misleading on 0.135.0 — workspace-write does **not** actually satisfy it for an
external `--add-dir`.

---

## Recommended fix (crews codex launcher)

Align codex members with how crews already launches Claude/Copilot members —
**fully unsandboxed, trusted**:

| Engine | crews "skip perms" flag | Sandbox? |
|---|---|---|
| Claude | `--dangerously-skip-permissions` | none |
| Copilot | `--allow-all` (= all tools + paths + urls) | none |
| **codex (recommended)** | **`--dangerously-bypass-approvals-and-sandbox`** | none |

`--dangerously-bypass-approvals-and-sandbox` is codex's exact analog: "Skip all
confirmation prompts and execute commands without sandboxing." It grants full
disk access (so `--add-dir` is unnecessary — the member's `~/.crews`
heartbeat/manifest/mailbox writes work regardless of cwd) and clears the fatal
add-dir guard (validated — matrix rows E/F).

**Edit `hooks/actors.js` `skipPerms` (true) branch in BOTH helpers** (keep them
in sync, per the in-file note at the top of `buildLauncherInvocation`):

`buildLauncherCommand` (lines ~209-211):
```js
const sandboxPart = skipPerms
  ? `--dangerously-bypass-approvals-and-sandbox`
  : '--sandbox read-only';
```
(drop `--ask-for-approval never` and `--add-dir <crews home>` from the skipPerms
case — both become redundant under bypass.)

`buildLauncherInvocation` (lines ~275-281):
```js
if (skipPerms) {
  argList.push('--dangerously-bypass-approvals-and-sandbox');
} else {
  argList.push('--sandbox', 'read-only');
}
argList.push('-c', 'tui.terminal_title=[]');
```

`-c 'tui.terminal_title=[]'` and the positional prompt are unaffected (validated
parsing fine alongside the bypass flag). `getCrewsHome()` would become unused on
the codex path; leave the import or reuse it for the non-skipPerms case as the
implementer sees fit.

### Acceptable alternative (keeps a nominal sandbox name)

`--sandbox danger-full-access --ask-for-approval never` (drop `--add-dir`).
Functionally identical fs access (full disk write ⇒ clears the guard), but still
"sandbox"-spelled. Slightly less honest than the bypass flag, which is the true
peer of the other engines' skip-perms flags. **Not recommended:** keeping
`--sandbox workspace-write` and merely dropping `--add-dir` — it clears the guard
but then the member's sandboxed shell tool cannot write `~/.crews` (heartbeat /
listener writes break), which is the very reason `--add-dir` was added (probe R3).

### Re-verify after fixing

The deferred live smoke must actually run this time: spawn a codex member, then
confirm (a) `Get-Process codex-core` returns a stable inner PID, (b)
`~/.codex/sessions/<id>` is created, (c) the manifest gets a real `sessionId`
via the codex `SessionStart` hook, (d) the listener arms, and (e) a
`kind=done` report reaches the lead mailbox. Pin the launcher against the codex
version actually installed (currently `0.135.0`), and add a regression note that
the add-dir guard is **TUI-only** so `codex exec` probes cannot catch it.

---

## Appendix — environment facts

- `codex` → `C:\Users\evmitran\AppData\Roaming\npm\codex.ps1` → `node …\@openai\codex\bin\codex.js`.
- `codex.js` spawns the vendor native binary (legacy layout
  `vendor\x86_64-pc-windows-msvc\codex\codex.exe`, 723 KB) which execs
  `codex-core.exe` (295 MB). `codex-core.exe` is **not** on PATH (invoked by full path).
- `codex --help` (0.135.0) confirms `--sandbox`, `--add-dir`, `-a/--ask-for-approval`,
  `-c`, positional `[PROMPT]`, and `--dangerously-bypass-approvals-and-sandbox` all parse.
- `~/.codex/config.toml`: `model = "gpt-5.5"`, provider `copilot`; crews plugin
  enabled + hook trust hashes present (`[plugins."crews@ai-developer-toolkit"] enabled = true`).
- `~/.codex/auth.json` absent (copilot provider needs no OpenAI auth — doctor confirms).
- Probe baseline: `.ralph/jobs/crews-codex-engine-support/probe-reports/codex-launcher-probe-report.md`
  (codex `0.125.0-copilot-api.8`, 2026-06-04); §9 lists the live spawn smoke as an
  OPEN "must" item — it was deferred, which is how this slipped through.
