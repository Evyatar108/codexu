# Stories Outline: Windows native-shell hook execution (codex)

*Preliminary decomposition from `/plan-with-ralph`. Feed to*
*`/implement-with-ralph --from-plan` for PRD generation.*
*Target repo: `codex/external/repos/codex-patched/codex-rs` (codex inner submodule).*

## US-001: Route Windows hook execution to the native shell for POSIX session shells
**Description:** As a Windows codex user with a POSIX session shell (git-bash / WSL
bash), I want plugin hook commands to run through the native Windows shell
(`cmd.exe`) so that the backslash `${CLAUDE_PLUGIN_ROOT}` path is not mangled and
my PreToolUse/PostToolUse hooks stop crashing with exit 1.
**Acceptance Criteria:**
- [ ] A predicate `hook_shell_should_use_native(&Shell) -> bool` is added in
      `core/src/session/mod.rs`, written as a single fn using `cfg!(windows)` in
      the body and matching `shell.shell_type` (the `pub(crate)` **field**, no new
      accessor) against `ShellType::Bash | Zsh | Sh`. It returns `false` on
      non-Windows and for PowerShell/Cmd.
- [ ] `build_hooks_for_config` (`core/src/session/mod.rs` ~3577-3602) adds
      `.filter(|shell| !hook_shell_should_use_native(shell))` before the
      `.map(...)` that derives the hook shell program/args, so a POSIX session
      shell on Windows yields `(None, vec![])` -> empty `HooksConfig.shell_program`
      -> `command_runner::default_shell_command()` = `cmd.exe /C`.
- [ ] On Windows, a PowerShell or Cmd `environment.shell` is still used for hooks
      (program preserved). On non-Windows, hook shell selection is unchanged.
- [ ] A platform-gated unit test pins the predicate truth table (POSIX rows
      `== cfg!(windows)`; PowerShell/Cmd always false) and is green under
      `cargo test --workspace` on both ubuntu and windows.
- [ ] Every edited upstream-canonical line carries a `// SANDBOX PATCH:` marker.
- [ ] `cargo check --workspace` passes from the `codex-rs` root; changed files are
      formatted with `rustfmt <file>` only (not `cargo fmt -p`).
- [ ] Typecheck passes (`cargo check --workspace`).
**Dependencies:** None
**Estimated complexity:** small

## US-002: Behavioral regression test — Windows hook command runs via native shell
**Description:** As a maintainer, I want a test that fails before the fix and
passes after, proving a Windows hook command runs under the native shell and not a
POSIX shell, so the bug cannot silently regress on a future upstream rebase.
**Acceptance Criteria:**
- [ ] A Windows-gated behavioral test constructs a Bash-typed `Shell` (bogus
      `shell_path`) as the session shell, runs a hook `handler.command` containing
      a cmd-only expansion (`echo %OS%`) through the hook execution path, and
      asserts stdout contains `Windows_NT`.
- [ ] The test does NOT require `node` or a real `bash` to be installed (the bogus
      bash path is never invoked once the fix routes to `cmd.exe`); it fails before
      the fix (bash leaves `%OS%` literal / ENOENTs) and passes after.
- [ ] The test lives next to the changed code
      (`core/src/session/` test module, or a `#[path = "..."]` sibling) and is the
      enforcing test referenced by the patch-surface §14 invariant.
- [ ] Typecheck passes; `just test -p codex-core` is green for the touched crate.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Docs + verify-only findings (patch-surface, regression-history)
**Description:** As a maintainer, I want the SANDBOX PATCH recorded in the fork's
patch inventory and the two adjacent operator asks documented as already-satisfied,
so the next rebase replants the patch and nobody re-does the verify-only work.
**Acceptance Criteria:**
- [ ] `codex/docs/implementation/patch-surface.md` gains a §14 invariant row
      (invariant + enforcing test = the US-002 test) and a §15 rebase-replant note
      for the `build_hooks_for_config` POSIX-shell filter.
- [ ] The patch-surface note documents the two behavioral constraints: (a) a
      git-bash/WSL hook now needs a Windows interpreter on the `cmd.exe` PATH;
      (b) a bare POSIX `command` now runs under `cmd.exe` on Windows — use
      `command_windows` for POSIX semantics.
- [ ] `codex/docs/implementation/regression-history.md` gains a ledger entry for
      the hook-shell mangling fix.
- [ ] The plan's two verify-only findings are recorded (no code change):
      `WindowsGitBashShell` already present on `main`
      (`features/src/lib.rs:166`); the system-prompt `<shell>` hint is already
      dynamic (`core/src/context/environment_context.rs:550`).
- [ ] Documentation-only changes; no typecheck impact (but `cargo check
      --workspace` from US-001/US-002 must remain green).
**Dependencies:** US-001
**Estimated complexity:** small
