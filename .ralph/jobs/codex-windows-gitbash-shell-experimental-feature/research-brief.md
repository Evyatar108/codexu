# Research Brief: Windows Git Bash shell experimental feature

## Researcher Findings

The committed investigation at `.ralph/investigations/codex-windows-gitbash-shell/findings.md` establishes the missing behavior and the recommended seam:

- G1 confirms the old launcher-era Git Bash detector is still available as source material, but current codex-core no longer auto-selects Git Bash when no explicit `default_shell` exists.
- G2 maps the current Windows default to `core/src/shell.rs::default_user_shell_from_path`, which returns PowerShell on Windows.
- G3 recommends a default-off visible experimental feature using the existing `Feature` registry and a small additive session branch.
- G4 recommends a fresh minimal implementation, not a cherry-pick of launcher commits `1d828e5947` or `fff065934c`.

Relevant files and roles:

- `features/src/lib.rs`: existing fork-local feature enum entries around `AnthropicModels`, `AutoLoadClaudeMd`, `LegacyPasteBurstHeuristic`, and `UserMessageStyling` show the `// SANDBOX PATCH:` + doc-comment pattern. The visible default-off `FeatureSpec` pattern lives near the specs for `legacy_paste_burst_heuristic` and `user_message_styling`.
- `core/src/session/session.rs`: `Session::new` selects `user_shell_override`, then `Feature::ShellZshFork`, then `shell::default_user_shell()`. This is the insertion point for a gated Git Bash default while preserving explicit launcher/config `default_shell`.
- `core/src/shell.rs`: `Shell::derive_exec_args` already maps `ShellType::Bash` to `bash -c` or `bash -lc`, and PowerShell to `-NoProfile -Command`; the feature should reuse this instead of adding a parallel execution path. The generic `get_bash_shell()` uses PATH lookup and must not be used as the first detector for the Windows auto-default.
- `codex-rs-overlay/codex-copilot-launcher/src/setup.rs`: `detect_git_bash()` implements the desired Git-for-Windows-first ordering: hard-coded Git install paths, `%LOCALAPPDATA%`, `where git` to sibling `bin\bash.exe` or `usr\bin\bash.exe`, then last-resort `where bash`.
- `core/src/tools/handlers/shell_spec.rs`: legacy `shell_command` model-facing description currently says "Runs a Powershell command (Windows)" and lists PowerShell examples; `exec_command` appends Windows safety guidance but does not tell the model the active Windows shell syntax.
- `core/src/tools/spec_plan.rs`: `add_shell_tools()` registers the visible `exec_command`/`shell_command` handlers. It has access to `TurnContext` but not currently to the resolved session shell type in a direct field.
- `core/src/session/turn_context.rs`: `make_turn_context()` already receives the resolved `user_shell` and computes `unified_exec_shell_mode`. This is the smallest place to add a `user_shell_type` field for model-facing tool spec generation.
- `core/src/context/environment_context.rs`: `<environment_context><shell>` is another model-facing shell hint. It already renders from `EnvironmentContextEnvironment::from_turn_environments(..., shell)` and `shell.name()`, so the implementation should add regression coverage rather than inventing a second data path.
- `core/src/session/session.rs`: startup warnings are emitted as `EventMsg::Warning` from `post_session_configured_events`; this is the right visible warning channel when the feature is enabled but Git Bash is not detected.
- `codex/docs/implementation/patch-surface.md`: wrapper-side registry is authoritative for this fork. Add a new invariant row and replant note here, not in the smaller inner copy.

## Architect Analysis

The safest architecture is:

1. Add the feature registry entry first, default off and visible in `/experimental`.
2. Add a Windows-only detector module in `codex-core` with pure helper functions that are easy to unit test without mutating process environment.
3. Add a small `Session::new` branch after explicit shell override and `ShellZshFork`, before `shell::default_user_shell()`. When detection succeeds, use `ShellType::Bash` via `shell::get_shell(ShellType::Bash, Some(&path))`; when detection fails, queue a startup warning and fall back to the current PowerShell path.
4. Add resolved-shell awareness to model-facing shell tool specs by carrying `ShellType` into `TurnContext` and threading a small shell-hint option into `ExecCommandHandlerOptions`, `ShellCommandHandlerOptions`, and `CommandToolOptions`.
5. Keep the execution layer unchanged: `exec_command` and `shell_command` continue to derive commands from `Session::user_shell()` and existing `Shell::derive_exec_args`.

This keeps upstream-canonical conflict surface moderate but controlled: one new module, one feature registry entry, one small session branch, one small `TurnContext` field, and dynamic text in the existing shell tool spec factory.

## Codex Research

Not run directly in this member session. The committed read-only investigation is the authoritative Codex-side research source for G1-G4 and is fully cited in the plan.

## Copilot Research

Two read-only explore agents were run:

- `gitbash-shell-surfaces`: confirmed feature registry patterns, the session shell-selection seam, detector prior art, shell/session tests, and wrapper registry requirements.
- `model-shell-hints`: confirmed model-facing shell guidance exists in `shell_spec.rs`; execution is already session-shell driven in `unified_exec.rs`; tool registration happens in `spec_plan.rs`; no separate base/system prompt was found that hard-codes PowerShell in the targeted code search.

## Consolidated File List

### Files to modify

- `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/lib.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/session/session.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/session/turn_context.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/shell_spec.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/shell_spec_tests.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/shell/shell_command.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/context/environment_context_tests.rs`
- `codex/docs/implementation/patch-surface.md`

### Files to create

- `codex/external/repos/codex-patched/codex-rs/core/src/windows_git_bash.rs`

### Test references

- `codex/codex-rs-overlay/codex-copilot-launcher/src/setup.rs` tests for detector candidate ordering.
- `core/src/shell_tests.rs` for shell type and derive-args patterns.
- `core/src/session/tests.rs` for session-construction behavior.
- `core/src/tools/handlers/shell_spec_tests.rs` for exact tool-spec description assertions.
- `core/src/tools/spec_plan_tests.rs` for tool registration and feature-aware specs.
