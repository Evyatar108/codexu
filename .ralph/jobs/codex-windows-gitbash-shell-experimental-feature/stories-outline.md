# Stories Outline: Windows Git Bash shell experimental feature

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Register the default-off experimental feature

**Description:** As a Windows Codex user, I want Git Bash defaulting to be behind a visible experimental feature so that the fork can dogfood it without changing default behavior.

**Acceptance Criteria:**
- [ ] `Feature::WindowsGitBashShell` exists in `features/src/lib.rs` with a `// SANDBOX PATCH:` marker and doc comment.
- [ ] Feature key is `windows_git_bash_shell`.
- [ ] `FeatureSpec` uses `Stage::Experimental { name, menu_description, announcement }`.
- [ ] `default_enabled: false`.
- [ ] Existing feature tests or registry snapshots are updated if required.

**Dependencies:** None

**Estimated complexity:** small

## US-002: Add a Windows Git Bash detector

**Description:** As the session shell selector, I want a Git-for-Windows-first detector so that WSL `System32\bash.exe` is not selected by accident.

**Acceptance Criteria:**
- [ ] New `core/src/windows_git_bash.rs` is `#[cfg(windows)]` and exported from `core/src/lib.rs` only for Windows.
- [ ] Detector order is hard-coded Git install paths, `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`, `where git` sibling `bin\bash.exe`/`usr\bin\bash.exe`, then last-resort `where bash`.
- [ ] The `where git` branch preserves the launcher candidate order exactly: `git.exe` parent `..\bin\bash.exe`, then sibling `.\bash.exe`, then parent `..\usr\bin\bash.exe`.
- [ ] Detector returns `shell::get_shell(ShellType::Bash, Some(&path))`.
- [ ] Unit tests cover candidate ordering, including `Git\cmd\git.exe -> Git\bin\bash.exe` and `Git\bin\git.exe -> Git\bin\bash.exe` fixtures before any `where bash` fallback.
- [ ] No generic `get_bash_shell()` or bare `which("bash")` first behavior is introduced.

**Dependencies:** US-001

**Estimated complexity:** medium

## US-003: Wire session default selection and startup fallback warning

**Description:** As a Windows Codex user, I want the feature to select Git Bash only when enabled and detected, while preserving explicit shell overrides and current fallback behavior.

**Acceptance Criteria:**
- [ ] `Session::new` still prioritizes `user_shell_override` before any feature default.
- [ ] `Feature::ShellZshFork` still has priority over `Feature::WindowsGitBashShell`.
- [ ] When `windows_git_bash_shell` is enabled and detection succeeds, `Session::user_shell()` is Bash.
- [ ] When the feature is disabled, Windows default behavior remains PowerShell/cmd fallback.
- [ ] When the feature is enabled and detection fails, startup emits an `EventMsg::Warning` and falls back to current PowerShell behavior.
- [ ] Tests cover feature off, feature on with detected Git Bash, explicit override precedence, and feature on with missing Git Bash warning.

**Dependencies:** US-002

**Estimated complexity:** medium

## US-004: Make model-facing shell hints match the active shell

**Description:** As the model using shell tools, I want tool descriptions to describe Bash syntax when the active Windows shell is Git Bash and PowerShell syntax when it is PowerShell.

**Acceptance Criteria:**
- [ ] `TurnContext` carries the resolved session shell type or equivalent shell hint derived from `user_shell`.
- [ ] `spec_plan::add_shell_tools()` passes that hint into `ExecCommandHandlerOptions` and `ShellCommandHandlerOptions`.
- [ ] `shell_spec.rs` renders PowerShell examples for `ShellType::PowerShell` and Git Bash/bash examples for `ShellType::Bash`.
- [ ] `exec_command` description identifies that commands run in the active shell and, on Windows, names Git Bash/bash or PowerShell as appropriate.
- [ ] `shell_command` description no longer unconditionally says "Runs a Powershell command (Windows)" when the active shell is Bash.
- [ ] Tests assert Windows PowerShell hints when the feature is off, Git Bash/bash hints when the feature is on and detected, and Git Bash/bash hints when an explicit Bash `default_shell` / `user_shell_override` is active with the feature off.
- [ ] `<environment_context><shell>` remains derived from the resolved `Session::user_shell`; add or update a regression test that an explicit Bash shell override renders `<shell>bash</shell>`.
- [ ] Searches for model-facing `PowerShell`/`pwsh` guidance are accounted for in plan or tests; genuinely non-model-facing test strings are left alone.

**Dependencies:** US-003

**Estimated complexity:** large

## US-005: Register the patch surface and verify the gate

**Description:** As a fork maintainer, I want the new fork patch documented and guarded so upstream rebases preserve the default-off gate, detector ordering, warning, and model-facing hint consistency.

**Acceptance Criteria:**
- [ ] `codex/docs/implementation/patch-surface.md` gets a new invariant row in the wrapper registry, not the inner smaller copy.
- [ ] The replant note names the feature enum/spec, detector module, session branch, and shell-hint tool-spec seam.
- [ ] Verification guidance includes `cargo check -p codex-core`, focused feature/detector/session/tool-spec tests, and `just fmt` / `just fix -p codex-core` for impl.
- [ ] Plan records that implementation should happen in the canonical inner checkout on `ralph/codex-v8-int` because cargo cannot build from a worktree.

**Dependencies:** US-004

**Estimated complexity:** small
