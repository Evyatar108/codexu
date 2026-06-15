# Research Brief: codex patch-surface divergence registry refresh

## Feature Request

Re-plan the `codex-patch-surface-divergence-registry-refresh` task from scratch for the current codex state. The existing committed plan is stale: it was written for the `0.135.0-copilot-api.5` / `.130` line and assumed no accumulation branch. The current released state is wrapper tag `v0.135.0-copilot-api.8`, wrapper commit `381da3d41`, inner release commit `1b1348cb06`, base upstream `rust-v0.135.0`.

Goal: refresh `codex/docs/implementation/patch-surface.md` so the next upstream rebase (`codex-upstream-rebase-to-0.139`) can replant live fork patches and retire stale ones. Scope is dual-surface: wrapper-owned registry/guards plus inner `codex-rs` source marker anchors.

## Researcher Findings

### Current wrapper registry state

- `codex/docs/implementation/patch-surface.md` still has a stale header: `Last Updated: 2026-05-12` and `Applies to: 0.130.0-copilot-api.*`.
- Committed HEAD already contains invariant rows 30-39, including stream-cut diagnostics, install/update redirects, D-001 chat transport rows, and D-002 Anthropic opt-in gate rows.
- The header and rebase-ledger narrative have not been coherently refreshed for the actual `.6`, `.7`, and `.8` release sequence.
- The authoritative wrapper registry at `codex/docs/implementation/patch-surface.md` is the edit target. The observed uncommitted drift is in the inner submodule's vestigial `codex/external/repos/codex-patched/docs/implementation/patch-surface.md`; it is out of scope unless the lead explicitly expands the task.

### Prior audit findings that still matter

The prior audit at `.ralph/investigations/codex-fork-patch-marking-and-divergence-audit/findings.md` identified gaps from the `.4/.5` era. Current source re-verification shows these remain plan-relevant:

- `codex-rs/tui/src/chatwidget/tool_lifecycle.rs`: agent-name display behavior exists, but the file has 0 `SANDBOX PATCH` markers.
- `codex-rs/tui/src/multi_agents.rs`: agent-name display behavior exists, but the file has 0 markers.
- `codex-rs/tui/src/resume_picker.rs`: DB-only first page + lazy reconcile behavior exists, but the file has 0 markers.
- `codex-rs/tui/src/tui.rs`: focus/PageDown/VT input work is marker-bearing, but the registry must verify it is documented through `.8`.
- `codex-rs/tui/src/chatwidget/command_lifecycle.rs`: background completion rendering is marker-bearing, but registry coverage must be verified.
- The old paste-burst row is stale as written: current `.8` code no longer uses a direct `disable_paste_burst: cfg.disable_paste_burst.unwrap_or(true)` fork seam. It now resolves through the default-off `Feature::LegacyPasteBurstHeuristic` plus a compatibility adapter in `core/src/config/mod.rs`.

### Release history from `.5` to `.8`

Inner commits after `release/0.135.0-copilot-api.5`:

1. `6f0137db45` - `fix(tui): restore fast resume history paint`
2. `9345bac3f3` - `Migrate fork flags to experimental features`
3. `e406f11bdf` - release bump to `0.135.0-copilot-api.6`
4. `705d14c6c2` - `Fix retained transcript typing lag`
5. `c08785c658` - `Fix Copilot prompt context budget`
6. `7e49fc58d2` - release bump to `0.135.0-copilot-api.7`
7. `5b8aec23bf` - `Self-heal Windows console input mode`
8. `43ac126981` - `Expose fork experimental feature gates`
9. `fd331d2f1d` - `Add Windows Git Bash shell experiment`
10. `8fb378ad2b` - `Spill background wake output to artifacts`
11. `e3edc3fd24` - `Prevent retained viewport active tail eviction`
12. `1b1348cb06` - release bump to `0.135.0-copilot-api.8`

Wrapper tags:

- `.6`: wrapper `f0e4c6ec7`
- `.7`: wrapper `4d7f37777`
- `.8`: wrapper `381da3d41`

### Patch rows to add or update through `.8`

The plan should require the implementation to add, update, or verify registry rows and replant notes for:

- `.6` fast resume history paint: `6f0137db45` touched `tui/src/app.rs`, `tui/src/app/event_dispatch.rs`, `tui/src/app/resize_reflow.rs`, `tui/src/app/thread_routing.rs`, `tui/src/app_backtrack.rs`, and feature tests. It should be represented as a retained-transcript/reflow first-paint invariant or folded into an existing retained viewport family if one already exists.
- `.6` fork flags migrated to experimental features: `9345bac3f3` touched config schema, `core/src/config/mod.rs`, `features/src/lib.rs`, `features/src/legacy.rs`, managed-hooks gate, Anthropic model gating, TUI style/composer/app-server-session surfaces. It should explicitly replace old launcher/config-boolean language with feature-registry language.
- `.7` retained transcript typing lag: `705d14c6c2` touched `tui/src/chatwidget/committed_transcript.rs`; it should be recorded as a retained viewport no-repaint/no-typing-lag invariant.
- `.7` Copilot prompt context budget: `c08785c658` touched `model-provider/src/auth.rs`, `model-provider/src/copilot.rs`, `model-provider/src/copilot_models_endpoint.rs`, `model-provider/src/provider.rs`, and `models-manager/src/model_info.rs`; it should have a row/replant note for prompt context budget metadata.
- `.8` Windows console input self-heal + console-mode tracer: `5b8aec23bf` touched `tui/src/app.rs`, `tui/src/app/thread_routing.rs`, `tui/src/tui.rs`, `tui/src/tui/console_mode_trace.rs`, `tui/src/tui/event_stream.rs`, and `docs/implementation/console-mode-trace-runbook.md`.
- `.8` fork experimental feature gate visibility: `43ac126981` touched `config/src/config_toml.rs`, `core/config.schema.json`, `core/src/agents_md.rs`, `core/src/config/mod.rs`, `features/src/legacy.rs`, `features/src/lib.rs`, feature tests, and TUI popup/settings tests.
- `.8` Windows Git Bash shell experiment: `fd331d2f1d` touched `core/src/session/default_shell.rs`, `core/src/windows_git_bash.rs`, shell spec/handler files, session config paths, and `features/src/lib.rs`.
- `.8` background wake spill-to-artifact: `8fb378ad2b` touched `core/src/tasks/mod.rs`, `core/src/tools/runtimes/unified_exec.rs`, `core/src/unified_exec/*`, `features/src/lib.rs`, and tests.
- `.8` retained viewport no-eviction fix: `e3edc3fd24` touched `tui/src/chatwidget/committed_transcript.rs`, `tui/src/chatwidget/rendering.rs`, app tests, and snapshots.

### Feature set to preserve during rebases

Current `.8` `features/src/lib.rs` fork-added or fork-repurposed feature gates to record:

- `AnthropicModels`
- `AutoLoadClaudeMd`
- `LegacyPasteBurstHeuristic`
- `UserMessageStyling`
- `ManagedHooks`
- `WindowsGitBashShell`
- `McpServerNotifications`
- `BackgroundProcessNotification` (fork-repurposed/default-off background wake notification and artifact behavior)

The implementation should also mention that retained transcript/viewport work uses upstream feature names where present but carries fork-specific behavior that must be preserved.

### Marker audit

Exact marker counts from committed `.8` inner HEAD for high-priority files:

- `codex-rs/tui/src/chatwidget/tool_lifecycle.rs`: 0
- `codex-rs/tui/src/multi_agents.rs`: 0
- `codex-rs/tui/src/resume_picker.rs`: 0
- `codex-rs/tui/src/tui.rs`: 2
- `codex-rs/tui/src/chatwidget/command_lifecycle.rs`: 1
- `codex-rs/features/src/lib.rs`: 15
- `codex-rs/core/src/config/mod.rs`: 11

Additional zero-marker production files changed between `.5` and `.8` that require hunk-level review before deciding whether to add markers or document why no marker is needed:

- `codex-rs/core/src/agents_md.rs`
- `codex-rs/features/src/legacy.rs`
- `codex-rs/model-provider/src/auth.rs`
- `codex-rs/model-provider/src/copilot/gated_models_manager.rs`
- `codex-rs/tui/src/app/thread_routing.rs`
- `codex-rs/tui/src/bottom_pane/chat_composer.rs`
- `codex-rs/tui/src/chatwidget/constructor.rs`
- `codex-rs/tui/src/tui/console_mode_trace.rs`
- `codex-rs/tui/src/tui/event_stream.rs`

Do not blanket-add markers to entire files. Add `// SANDBOX PATCH:` only at upstream-canonical fork seams that need rebase anchors.

## Architect Analysis

### Implementation architecture

Use a two-commit submodule flow:

1. Inner `codex-patched` commit first: add only missing `// SANDBOX PATCH:` comment anchors in `external/repos/codex-patched/codex-rs`. No behavior changes.
2. Wrapper commit second: update `codex/docs/implementation/patch-surface.md`, `codex/scripts/audit_invariants.sh` if a new grep guard is needed, optionally the summary inventory in `codex/.claude/commands/rebase-upstream.md`, and the `external/repos/codex-patched` gitlink to the inner marker commit.
3. Outer parent `codexu` pointer bump is lead-owned after the codex wrapper work lands.

The inner marker work can land on the current post-.8 accumulation branch (`ralph/codex-v9-int`) or a fresh branch; the lead decides. The wrapper registry edit should happen in a codex wrapper worktree, not the shared checkout.

### Constraints and risks

- Tenant 1 applies: minimize upstream-canonical conflict surface. Marker-only comments are the only planned source edits.
- The inner submodule checkout is dirty and a concurrent `impl-feature-pruning` member is editing unrelated inner files. The implementation must use worktrees and avoid depending on or staging those uncommitted edits.
- `patch-surface.md` is large and hand-authored; edits should be section-scoped and reviewed with targeted diffs.
- `cargo check` is not required for marker-only comments. If implementation changes Rust logic or config/schema, run the relevant `just`/cargo gate per codex AGENTS guidance.
- The wrapper audit scripts are the right validation surface: `bash scripts/audit_network_calls.sh` and `bash scripts/audit_invariants.sh`.

## Consolidated File List

### Files to modify

- `codex/docs/implementation/patch-surface.md`
- `codex/scripts/audit_invariants.sh` if new invariant grep guards are needed
- `codex/.claude/commands/rebase-upstream.md` only if the summary inventory is stale
- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/tool_lifecycle.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/multi_agents.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/resume_picker.rs`
- Candidate marker files listed in "Marker audit" after hunk-level verification

### Files to inspect

- `.ralph/investigations/codex-fork-patch-marking-and-divergence-audit/findings.md`
- `codex/CLAUDE.md`
- `codex/AGENTS.override.md`
- `codex/scripts/audit_network_calls.sh`
- `codex/scripts/audit_invariants.sh`
- `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/config/mod.rs`

### Validation commands

- `git -C codex status --short`
- `git -C codex/external/repos/codex-patched status --short`
- `bash scripts/audit_network_calls.sh`
- `bash scripts/audit_invariants.sh`
- Optional only if marker changes unexpectedly affect build surfaces: from `codex/external/repos/codex-patched/codex-rs`, `cargo check --workspace`
