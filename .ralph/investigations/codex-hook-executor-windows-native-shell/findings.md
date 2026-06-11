# Investigation: codex hook executor on Windows — shell selection + `${CLAUDE_PLUGIN_ROOT}` substitution

**Task:** `codex-hook-executor-windows-native-shell`
**Mode:** READ-ONLY source investigation (no engine code changed; only this findings doc committed).
**Date:** 2026-06-10
**Engine under investigation:** codex inner submodule
`codex/external/repos/codex-patched/codex-rs` @ submodule HEAD `03da7a2d`.
**Installed codex on this (affected) machine:** `codex-cli 0.135.0-copilot-api.1`
(`C:\Users\evmitran\AppData\Roaming\npm\codex.ps1` → `codex-core.exe`).

**Supersedes:** the staged plan-hookshell feature-request at
`.ralph/jobs/.staging/20260611T053724Z-plan-hookshell-d2ba601b/`. The plan-hookshell
finding ("`${CLAUDE_PLUGIN_ROOT}` is ENV-ONLY and never substituted into the hook
command string") is **wrong** — see "The contradiction, resolved" below.

---

## TL;DR verdict

1. **Codex DOES textually substitute `${CLAUDE_PLUGIN_ROOT}` into the hook command
   string** before exec. The operator's codex agent was **right**; plan-hookshell was
   **wrong**. The substitution loop is
   `hooks/src/engine/discovery.rs:467-469`. plan-hookshell cited only the env-insertion
   at `discovery.rs:225` and missed the command-string substitution 240 lines below it.

2. **On Windows, codex runs hooks via PowerShell — NOT bash.** The hook shell is the
   *same* `default_user_shell()` the agent's shell tool uses, and on Windows that is
   **forced to PowerShell** (`core/src/shell.rs:316-318`). There is **no
   `which("bash")`** anywhere in the hook-execution path. So the operator agent's
   *conclusion* ("codex runs the hook via bash on Windows") is **false** for codex
   0.135.

3. **Empirically, the substituted hook command WORKS under PowerShell and FAILS under
   bash** (controlled test, see "Empirical reproduction"). Because codex 0.135 uses
   PowerShell for hooks, the `/mnt/c …` MODULE_NOT_FOUND error the operator agent
   reported did **not** come from codex's hook executor. It came from a **bash** process
   — almost certainly the agent re-running the already-substituted command under bash to
   "test" it (WSL `bash.exe` is on PATH at `C:\Windows\system32\bash.exe`), then
   mis-attributing the bash failure to codex's executor.

4. **The stale `~/.codex-copilot/config.toml` `default_shell = 'C:\Program Files\Git\bin\bash.exe'`
   is a RED HERRING.** codex-core has **no `default_shell` config field** (confirmed by
   repo-wide grep), so the launcher's `-c default_shell=…` override is silently ignored —
   exactly like the documented-ignored `copilot_api_port` / `default_model` keys sitting
   next to it in the same file. It does **not** make codex use bash.

**Net:** Both prior accounts were half-right. plan-hookshell was right that the hook
shell is PowerShell but wrong that the token isn't substituted. The operator agent was
right that the token is substituted but wrong that the hook runs under bash. The
corrected fix is therefore **different from plan-hookshell's "substitute the token +
cmd.exe /C"** — that fix is moot (codex already substitutes) and infeasible (you cannot
force cmd.exe from `hooks.json`). See "Corrected fix direction".

---

## The contradiction, resolved (cite file:line)

> plan-hookshell: "`${CLAUDE_PLUGIN_ROOT}` is ENV-ONLY and NEVER substituted into the hook
> command string (`hooks/src/engine/discovery.rs:225`)."
> Operator agent: "`${CLAUDE_PLUGIN_ROOT}` EXPANDED to the real Windows path (codex DID
> substitute it)."

**Truth: codex substitutes the token into the command string.** Both are true at once,
which is what tripped up plan-hookshell:

- `hooks/src/engine/discovery.rs:223-228` inserts the plugin-root values as **env vars**
  on the hook source (`PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT`, `PLUGIN_DATA`,
  `CLAUDE_PLUGIN_DATA`). The comment at `:224`/`:227` says *"For OOTB compat with existing
  plugins that use this env var."* plan-hookshell read only this.
- `hooks/src/engine/discovery.rs:467-469` then **textually substitutes every one of those
  env keys into the command string**:

  ```rust
  let command = source.env.iter().fold(command, |command, (key, value)| {
      command.replace(&format!("${{{key}}}"), value)
  });
  ```

  So `${CLAUDE_PLUGIN_ROOT}` (and `${PLUGIN_ROOT}`, `${PLUGIN_DATA}`,
  `${CLAUDE_PLUGIN_DATA}`) in the `command` field are replaced with the plugin-root path
  via `plugin_root.display()` — i.e. a **Windows backslash path** like
  `C:\Users\evmitran\.codex\plugins\cache\ai-developer-toolkit\crews\3.21.3`.

The same loop also runs on the listing path; the substituted string is what is stored
(`discovery.rs:483 command: Some(command.clone())`) and what is later executed.

So the operator agent's observed string —
`node C:\Users\evmitran\.codex\plugins\cache\ai-developer-toolkit\crews\3.21.3/hooks/codex-pre-tool-use.js`
— is exactly `node ${CLAUDE_PLUGIN_ROOT}/hooks/codex-pre-tool-use.js` after codex's
substitution (backslash path from `display()` + the literal `/hooks/…` tail). The env
vars are *also* exported to the subprocess; substitution and env-export are not mutually
exclusive.

This is upstream-shaped codex behavior (no `// SANDBOX PATCH` marker at `discovery.rs:467-469`
or `:223-228`).

---

## Q1 — Why "bash" on Windows? The EXACT shell selection for HOOK execution

**Answer: hooks use the same `default_user_shell()` path plan-hookshell cited, which on
Windows is PowerShell. There is NO separate `which("bash")` for hook execution.** Codex
0.135 therefore does **not** run hooks via bash on Windows; the `/mnt/c` error originates
from a bash process outside codex's hook executor.

Shell-selection chain (all in `core/src/`):

1. `session/session.rs:830-848` computes the session `default_shell`:
   `user_shell_override` (if any) → else zsh-fork → else `shell::default_user_shell()`.
   **Production callers always pass `user_shell_override = None`** (`thread_manager.rs:615,
   694, 918, 1088…`; only `*_for_tests` paths set `Some`). zsh-fork is off on Windows. So
   `default_shell = default_user_shell()`.
2. `shell.rs:312-318` `default_user_shell()` → `default_user_shell_from_path(get_user_shell_path())`;
   and `default_user_shell_from_path` **ignores the path on Windows**:
   ```rust
   fn default_user_shell_from_path(user_shell_path: Option<PathBuf>) -> Shell {
       if cfg!(windows) {
           get_shell(ShellType::PowerShell, /*path*/ None).unwrap_or(ultimate_fallback_shell())
       } else { … }
   }
   ```
   (`get_user_shell_path()` is `None` on non-unix anyway — `shell.rs:152-155`.) The
   `cfg!(windows) → PowerShell` branch dates to commit `7b027e7536` (2025-11-13),
   well before 0.135, so the installed binary forces PowerShell. `ultimate_fallback_shell()`
   on Windows is **cmd.exe** (`shell.rs:280-294`), never bash.
3. `session/session.rs:942` `build_hooks_for_config(&config, …, &default_shell)` derives the
   HOOK shell from that same `default_shell`:
   `session/mod.rs:3366-3384` →
   `let mut hook_shell_argv = user_shell.derive_exec_args("", /*use_login_shell*/ false);`
   then `shell_program: Some(argv[0])`, `shell_args: argv[1..last]`.
   For PowerShell, `derive_exec_args` (`shell.rs:53-62`) yields
   `[<pwsh>, "-NoProfile", "-Command", ""]`, so the hook runs as
   `pwsh -NoProfile -Command "<substituted command>"`.
4. `hooks/src/engine/command_runner.rs:103-117` `build_command`: uses `shell.program` +
   `shell.args` + `handler.command`. The `cmd.exe /C` fallback at
   `command_runner.rs:104-105 / 119-135` only fires when `shell.program` is **empty** —
   which never happens, because `build_hooks_for_config` always sets `shell_program: Some(…)`.

**Where the `/mnt/c` bash error actually comes from:** a bash process, not codex's
PowerShell hook executor. WSL `bash.exe` is on PATH (`C:\Windows\system32\bash.exe`) and
Git Bash is at `C:\Program Files\Git\bin\bash.exe`. The most likely sequence: codex
substituted `${CLAUDE_PLUGIN_ROOT}` (Q1/contradiction confirm it does), the agent copied
the *substituted* command and re-ran it under bash to "test the hook", and bash mangled
the Windows backslash path → `MODULE_NOT_FOUND` (`/mnt/c/…` under WSL bash). The agent
then reported that as if it were codex's hook executor's behavior. Codex's actual
executor (PowerShell) runs that exact command successfully (see Empirical reproduction).

---

## Q2 — Which macro does the crews `.codex-plugin/hooks/hooks.json` actually use?

**`${CLAUDE_PLUGIN_ROOT}`** (a Claude-ism), not a codex-specific token. Exact strings from
`ai-developer-toolkit/plugins/crews/.codex-plugin/hooks/hooks.json`:

```json
"command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/codex-session-start.js"      (SessionStart)
"command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/codex-user-prompt-submit.js" (UserPromptSubmit)
"command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/codex-stop.js"               (Stop)
"command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/codex-pre-tool-use.js"       (PreToolUse)
"command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/codex-post-tool-use.js"      (PostToolUse)
```

All five use `${CLAUDE_PLUGIN_ROOT}`.

---

## Q3 — Does codex support/substitute that macro for `.codex-plugin` hooks? Canonical token?

**Yes — `${CLAUDE_PLUGIN_ROOT}` is supported and substituted for hooks**, as the OOTB-compat
alias for codex's native `${PLUGIN_ROOT}`. Codex differs from Claude only in that it adds
its own `PLUGIN_ROOT` / `${CODEX_PLUGIN_ROOT}` namespace while keeping the Claude names as
aliases.

- **Hooks** (`hooks/src/engine/discovery.rs:223-228, 467-469`): the substitution folds over
  the hook source's env map, which contains `PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT`,
  `PLUGIN_DATA`, `CLAUDE_PLUGIN_DATA`. So `${PLUGIN_ROOT}` (codex-native) and
  `${CLAUDE_PLUGIN_ROOT}` (alias) both substitute. **`${CODEX_PLUGIN_ROOT}` is NOT a hook
  env key**, so for hooks it would pass through verbatim and break — crews is correct to
  use `${CLAUDE_PLUGIN_ROOT}` (or could use `${PLUGIN_ROOT}`).
- **`.mcp.json`** (`core-plugins/src/mcp_substitution.rs:11-12, 50-54`): a fork
  `// SANDBOX PATCH` substitutes **both** `${CLAUDE_PLUGIN_ROOT}` and `${CODEX_PLUGIN_ROOT}`
  in `command` / `args` / `cwd` / `env` values. This is a *separate* substitution surface
  from hooks (MCP server configs, not hook commands).

So the macro choice is **not** the bug. `${CLAUDE_PLUGIN_ROOT}` is supported and is
substituted. The bug is downstream: what the substituted value looks like (a Windows
backslash path) when handed to a shell that can't tolerate backslashes (bash).

---

## Empirical reproduction (controlled, temp dir, no repo writes)

Mimicked codex's substitution (Windows backslash plugin-root + `/hooks/h.js` tail) with a
trivial `h.js` that prints `HOOK_OK`, then ran the exact command codex would build:

| Shell (as codex builds it) | Command | Result |
|---|---|---|
| **PowerShell** (Windows hook executor) | `pwsh -NoProfile -Command "node C:\…\plugintest/hooks/h.js"` | `HOOK_OK`, **exit 0** |
| **Git Bash** (`bash -c`, the would-be `default_shell`) | `bash -c "node C:\…\plugintest/hooks/h.js"` | `Error: Cannot find module 'C:\UsersevmitranAppData…\hooks\h.js'`, **exit 1** |

Bash backslash demo: `bash -c 'echo C:\Users\evmitran\.codex\plugins'` → `C:Usersevmitran.codexplugins`
(backslashes eaten). WSL bash would instead translate `C:\` → `/mnt/c/…` (the operator's exact
symptom). Either bash flavor yields `MODULE_NOT_FOUND`; PowerShell does not.

This confirms: (a) codex substitutes the token, (b) PowerShell runs the result fine, and
(c) only a bash shell produces the operator's failure — and codex 0.135 doesn't use bash
for hooks.

---

## The stale launcher config (why "codex uses bash" looked plausible)

`~/.codex-copilot/config.toml` on this machine:

```toml
copilot_api_port = 4141                                   # v5-era, documented-ignored
default_model = "gpt-5.4"                                 # removed, documented-ignored
default_shell = 'C:\Program Files\Git\bin\bash.exe'       # ← vestigial; see below
```

- The launcher (`codex-rs-overlay/codex-copilot-launcher/src/config.rs:106-107`) emits
  `-c default_shell=<path>` to codex-core.
- **codex-core has NO `default_shell` config field** (`git grep default_shell -- config core/src/config*`
  returns nothing; `user_shell_override` is set only in `*_for_tests`). So the override is
  silently ignored at deserialize, exactly like `copilot_api_port` and `default_model` next
  to it (per `codex/CLAUDE.md` "v5-era … silently ignored").
- Therefore the launcher's `default_shell=bash` does **not** select bash for the shell tool
  or for hooks. It is a launcher↔core integration gap (the launcher still emits a key core no
  longer reads), and it is the likely origin of the "codex runs hooks via bash" mental model.

---

## Corrected fix direction (differs from plan-hookshell)

plan-hookshell proposed "substitute the token + cmd.exe /C". **Both halves are wrong:**

- "Substitute the token" is **moot** — codex already substitutes `${CLAUDE_PLUGIN_ROOT}`
  (`discovery.rs:467-469`).
- "cmd.exe /C" is **infeasible from `hooks.json`** — the hook shell is the user's
  `default_user_shell()` (PowerShell on Windows, forced); a plugin cannot force cmd.exe.
  It's also unnecessary: PowerShell already runs the substituted command correctly.

The accurate situation and recommended actions, in priority order:

1. **No crews-side or codex-side change is required for the PowerShell path.** On codex
   0.135 the crews codex hooks run under PowerShell, the token is substituted, and the
   resulting (no-space) backslash path resolves under node. The integration should work.
   **Action: the operator should re-verify hooks actually fire on codex 0.135.** The agent's
   `/mnt/c` bash error was a debugging artifact (a manual bash re-run of the substituted
   command), not codex's executor — so it does not, by itself, prove the hooks are broken.

2. **If hooks genuinely aren't firing, the cause is NOT shell/substitution** — look at hook
   registration / trust status / the codex-side JS (`codex-pre-tool-use.js`) erroring
   internally. (Out of scope here, but the shell/substitution path is exonerated.)

3. **Clean up the stale launcher config / integration gap.** Delete the vestigial
   `default_shell` (and `copilot_api_port`, `default_model`) from
   `~/.codex-copilot/config.toml`, and/or stop the launcher emitting `-c default_shell=…`
   (`codex-rs-overlay/codex-copilot-launcher/src/config.rs:106-107`) since codex-core has no
   such field. This removes the false "codex uses bash" signal.

4. **Latent fragility worth a codex-side hardening (not required for the operator):** codex
   substitutes `${CLAUDE_PLUGIN_ROOT}` with `plugin_root.display()` — a **Windows backslash
   path** that is shell-fragile. It breaks under bash (any user whose default shell is bash,
   or a future codex that honors a bash `default_shell` override) and would break even under
   PowerShell if the plugin-root path contained spaces (`-Command "node C:\Program Files\…"`
   would word-split). A robust codex fix would normalize separators and/or quote the
   substituted path at `discovery.rs:467-469`. The crews `.codex-plugin/hooks/hooks.json`
   `command_windows` variant (`discovery.rs:438-439`) is available but does not help here —
   the substituted value is identical regardless of variant, so the shell is the only lever.

---

## Source citations (definitive)

- `ai-developer-toolkit/plugins/crews/.codex-plugin/hooks/hooks.json` — all 5 hooks use
  `node ${CLAUDE_PLUGIN_ROOT}/hooks/codex-*.js` (Q2).
- `codex-rs/hooks/src/engine/discovery.rs:223-228` — env-export of `PLUGIN_ROOT` /
  `CLAUDE_PLUGIN_ROOT` / `PLUGIN_DATA` / `CLAUDE_PLUGIN_DATA` for plugin hooks.
- `codex-rs/hooks/src/engine/discovery.rs:467-469` — **textual `${KEY}`→value substitution
  into the command string** (the line plan-hookshell missed; settles the contradiction).
- `codex-rs/hooks/src/engine/discovery.rs:438-439` — `command_windows.unwrap_or(command)`
  Windows-variant selection.
- `codex-rs/core-plugins/src/mcp_substitution.rs:11-12, 50-54` — `.mcp.json` substitutes
  both `${CLAUDE_PLUGIN_ROOT}` and `${CODEX_PLUGIN_ROOT}` (Q3; separate from hooks).
- `codex-rs/core/src/session/session.rs:830-848` — `default_shell` selection
  (`user_shell_override`→zsh-fork→`default_user_shell()`); `:942` derives the hook shell
  from it; `:1001` uses the same shell for the agent shell tool.
- `codex-rs/core/src/shell.rs:316-318` — **Windows forces PowerShell**;
  `:280-294` cmd.exe ultimate fallback; `:152-155` `get_user_shell_path()`=None on non-unix;
  `:53-62` PowerShell `derive_exec_args` → `-NoProfile -Command`.
- `codex-rs/core/src/session/mod.rs:3366-3384` — hook shell derived from `user_shell` via
  `derive_exec_args("", false)`.
- `codex-rs/hooks/src/engine/command_runner.rs:103-135` — `build_command`; cmd.exe `/C`
  fallback only when `shell.program` is empty (never, for hooks).
- `codex-rs/core/src/thread_manager.rs:615, 694, 918, 1088, 1123, 1160` —
  `user_shell_override = None` in production.
- `git grep default_shell -- config core/src/config*` → **empty** (no codex-core config
  field; the launcher's `-c default_shell=…` is ignored).
- `codex-rs-overlay/codex-copilot-launcher/src/config.rs:106-107` — launcher emits the
  vestigial `default_shell` flag.
- Installed: `codex-cli 0.135.0-copilot-api.1`; submodule HEAD `03da7a2d`; Windows-PowerShell
  shell branch from commit `7b027e7536` (2025-11-13).
