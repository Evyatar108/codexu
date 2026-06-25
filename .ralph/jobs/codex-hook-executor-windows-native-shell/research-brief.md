# Research Brief: codex-hook-executor-windows-native-shell

*Source investigation performed against the codex inner submodule at*
*`codex/external/repos/codex-patched/codex-rs` (codexu primary checkout, submodule HEAD `5f9dc1105e`).*
*All file:line citations below are relative to that `codex-rs/` root.*

## The reported bug (operator machine)

Repo `C:\TentedRepos`, codex with crews `3.21.3`. Codex runs a crews plugin hook
command and it fails:

```
node ${CLAUDE_PLUGIN_ROOT}/hooks/codex-pre-tool-use.js
=> Cannot find module '/mnt/c/TentedRepos/C:Usersevmitran.codexpluginscacheai-developer-toolkitcrews3.21.3/hooks/codex-pre-tool-use.js'
=> "PreToolUse hook (failed)" (exit 1; stderr hidden behind the exit code)
```

Decoding the mangled path proves the mechanism exactly:
- `${CLAUDE_PLUGIN_ROOT}` was substituted to the **Windows backslash** path
  `C:\Users\evmitran\.codex\plugins\cache\ai-developer-toolkit\crews\3.21.3`.
- The full command string became
  `node C:\Users\evmitran\.codex\plugins\cache\ai-developer-toolkit\crews\3.21.3/hooks/codex-pre-tool-use.js`.
- A **POSIX shell** (bash) tokenized it: every backslash is an escape char, so
  `\U \e \c …` collapsed to `C:Usersevmitran.codexpluginscache…crews3.21.3`
  (backslashes stripped), while the literal `/hooks/codex-pre-tool-use.js` suffix
  survived (forward slashes are not escapes).
- The result is a **relative** path (no leading `/`), so bash resolved it against
  its cwd `/mnt/c/TentedRepos` — i.e. **WSL bash**. A bare `bash` on Windows PATH
  resolves to `C:\Windows\System32\bash.exe` (the WSL launcher) first (known
  gotcha), which is why the cwd is `/mnt/c/...`.

## How codex executes hooks (STEP 1 answer — confirmed against source)

1. **Hook command substitution** — `hooks/src/engine/discovery.rs:499-501`:
   ```rust
   let command = source.env.iter().fold(command, |command, (key, value)| {
       command.replace(&format!("${{{key}}}"), value)
   });
   ```
   `source.env` is built at `discovery.rs:227-235` and includes
   `CLAUDE_PLUGIN_ROOT = plugin_root.display().to_string()` — a **backslash**
   Windows path. So `${CLAUDE_PLUGIN_ROOT}` is replaced by codex (NOT by the
   shell) with a literal backslash path **before** the shell ever sees it. This is
   why the backslash mangling happens at shell tokenization rather than at env
   expansion (env expansion would have preserved the backslashes).
   - A `command_windows` override field exists (`discovery.rs:465-474`): on Windows
     codex prefers `command_windows` over `command` if the hook author supplies it.
     crews does **not** use it (`ai-developer-toolkit/plugins/crews/.codex-plugin/hooks/hooks.json`
     uses plain `command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/<event>.js"`).

2. **Which shell runs the hook** — `core/src/session/mod.rs:3577-3602`
   (`build_hooks_for_config`):
   ```rust
   let (hook_shell_program, hook_shell_argv) = environment
       .and_then(|environment| environment.shell.as_ref())
       .map(|shell| {
           let mut argv = shell.derive_exec_args("", /*use_login_shell*/ false);
           let program = argv.remove(0);
           let _ = argv.pop();
           (Some(program), argv)
       })
       .unwrap_or_default();
   ...
   Hooks::new(HooksConfig { ... shell_program: hook_shell_program, shell_args: hook_shell_argv })
   ```
   The hook runner's shell is derived from the **user's selected session shell**
   (`environment.shell`). For a bash shell, `Shell::derive_exec_args`
   (`core/src/shell.rs:22-49`) yields `[<bash-path>, "-c", ""]`, so
   `shell_program = "<bash-path>"` and `shell_args = ["-c"]`.

3. **The exec** — `hooks/src/engine/command_runner.rs:103-117` (`build_command`)
   and `:119-135` (`default_shell_command`):
   ```rust
   fn build_command(shell, handler) -> Command {
       let mut command = if shell.program.is_empty() {
           default_shell_command()          // EMPTY program -> native shell
       } else {
           Command::new(&shell.program)     // NON-empty -> user's shell
       };
       if shell.program.is_empty() { command.arg(&handler.command); }
       else { command.args(&shell.args); command.arg(&handler.command); }
       ...
   }
   fn default_shell_command() -> Command {
       #[cfg(windows)] { COMSPEC (cmd.exe) + "/C" }       // <-- native Windows shell
       #[cfg(not(windows))] { $SHELL or /bin/sh + "-lc" }
   }
   ```
   So when `shell.program` is **non-empty bash**, codex runs
   `bash -c "node C:\Users\...\x.js"` -> mangled. When `shell.program` is **empty**,
   the Windows branch already uses `cmd.exe /C`, which handles `node C:\...\x.js`
   natively.

**Cause classification (STEP 1):** it is **(ii) no win32 branch in the hook-shell
selection** combined with **(iii) the POSIX session shell leaking into the hook
runner**. It is NOT (i) codex hardcoding bash — the native default
(`default_shell_command`) is already cmd.exe on Windows; the bug is that
`build_hooks_for_config` *overrides* that native default with the user's POSIX
session shell.

## Why the operator's shell was bash (not the Windows default PowerShell)

`shell-command/src/shell_detect.rs:276-277`: on Windows `default_user_shell()`
returns **PowerShell**. So hooks run under bash only when `environment.shell` is a
POSIX shell, which happens when one of:
- the `WindowsGitBashShell` experimental feature is enabled and git-bash is
  detected (`features/src/lib.rs:166`, `core/src/windows_git_bash.rs`,
  `core/src/session/default_shell.rs:49-61`, wired at
  `core/src/session/session.rs:802-823`);
- a `user_shell_override` / model-provided shell selects bash
  (`default_shell.rs:23-28`).

The operator's bare-`bash`-resolving-to-WSL evidence indicates a bash
`environment.shell` whose program is the bare token `bash`. **The exact
provenance (feature-on vs override) cannot be fully reconstructed from the error
string alone, but the fix must be robust for ANY bash-on-Windows session shell.**

Important consequence for the fix design: even the git-bash feature path (full
`C:\Program Files\Git\bin\bash.exe`) STILL mangles the backslash command — it just
fails with a Windows cwd instead of `/mnt/c`. And the WSL bare-`bash` path is
*doubly* broken: WSL bash runs the Linux `node` against a Windows-shaped path in a
Linux filesystem namespace, so no path-format tweak alone can rescue it — the only
robust fix is to stop using a POSIX shell for hooks on Windows.

## Two adjacent concerns (both verify-only — already correct on main)

1. **"Restore the git-bash-as-shell experimental feature."** ALREADY PRESENT on
   `main` (HEAD `5f9dc1105e`):
   - `features/src/lib.rs:164-166` + `:1118-1129` — `Feature::WindowsGitBashShell`,
     `Stage::Experimental`, `default_enabled: false`, `// SANDBOX PATCH`.
   - `core/src/windows_git_bash.rs` — detector (full git-bash path; prefers Git
     installs over WSL `where bash`).
   - `core/src/session/default_shell.rs` — `select_default_shell` precedence
     (explicit override > zsh-fork > git-bash > default) + tests.
   - `core/src/session/session.rs:802-823` — feature-gated, win32-gated wiring.
   - `features/src/tests.rs:255-256` — registry coverage.
   Conclusion: the feature does not need restoring. The actual end-to-end blocker
   to *using* git-bash on Windows is the hook-executor mangling bug above. Fixing
   the hook executor is what unblocks the git-bash feature with plugin hooks.

2. **"Verify the system prompt does not hard-hint powershell."** It does NOT.
   `core/src/context/environment_context.rs:550` renders
   `<shell>{environment.shell}</shell>` — the value is the **selected shell**
   (`EnvironmentContextEnvironment.shell: String` set from `environment.shell` at
   `:50-52`, displayed via the `Shell`/`ShellType::name()` mapping in
   `shell-command/src/shell_detect.rs:16-30`). The base model prompts
   (`core/gpt_5_codex_prompt.md`, `core/gpt_5_2_prompt.md`, etc.) contain no
   hardcoded `powershell` / shell hint (grep returned nothing). So the shell hint
   already matches the selected shell; no change needed.

## Consolidated file list

### Files to modify
- `core/src/session/mod.rs` — `build_hooks_for_config` (~3577-3602): gate the
  POSIX-session-shell -> hook-runner plumbing on Windows (the fix seam) + a small
  private helper. Upstream-canonical edit -> needs `// SANDBOX PATCH:` marker.
- `core/src/session/` test module (new `*_tests.rs` or inline) — unit truth-table
  for the helper + behavioral assertion that a Windows bash session shell yields an
  empty hook `shell_program` (native cmd.exe fallback) while PowerShell is
  preserved.
- (Optional regression-test home) `hooks/src/engine/command_runner.rs` /
  `hooks/src/engine/mod_tests.rs` — a Windows-gated test that a backslash-path hook
  command runs through the native shell without mangling.
- `codex/docs/implementation/patch-surface.md` — new §14 invariant + §15
  rebase-replant note for the SANDBOX PATCH.
- `codex/docs/implementation/regression-history.md` — ledger entry for the
  hook-shell mangling fix.

### Reference files (no change — confirm only)
- `hooks/src/engine/discovery.rs:227-235,465-474,499-501` — `${CLAUDE_PLUGIN_ROOT}`
  substitution + `command_windows` field.
- `hooks/src/engine/command_runner.rs:103-135` — `build_command` /
  `default_shell_command` (the native cmd.exe fallback we route to).
- `hooks/src/registry.rs:29-93` — `HooksConfig.shell_program/shell_args` -> engine.
- `core/src/shell.rs:9-50` — `Shell`, `ShellType`, `derive_exec_args`.
- `shell-command/src/shell_detect.rs:271-295` — Windows default = PowerShell.
- `features/src/lib.rs:164-166,1118-1129` — `WindowsGitBashShell` (already present).
- `core/src/windows_git_bash.rs`, `core/src/session/default_shell.rs`,
  `core/src/session/session.rs:802-823` — git-bash wiring (already present).
- `core/src/context/environment_context.rs:550,560` — dynamic `<shell>` hint.
- `ai-developer-toolkit/plugins/crews/.codex-plugin/hooks/hooks.json` — the
  failing hooks (plain `node ${CLAUDE_PLUGIN_ROOT}/...`; cmd-safe once routed to
  the native shell).
