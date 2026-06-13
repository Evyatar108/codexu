# Research Brief

## Researcher Findings

- `codex/docs/implementation/patch-surface.md` is the canonical divergence ledger, but its header is still pinned to `0.130.0-copilot-api.*` and the document still carries the stale paste-burst entry that assumes `disable_paste_burst.unwrap_or(true)`.
- `codex/CLAUDE.md` and `codex/.claude/commands/rebase-upstream.md` both reinforce the same contract: every upstream-canonical edit needs a `// SANDBOX PATCH:` marker plus matching `patch-surface.md` section 14 and section 15 coverage.
- Section 14 uses one invariant row per patch family, with a focused enforcement hook and deliberate-violation procedure.
- Section 15 uses titled replant subsections that name exact seams, explain the rebase anchor, and list focused post-rebase checks.
- Likely edit points:
  - `codex/docs/implementation/patch-surface.md`
  - `codex/scripts/audit_invariants.sh`
  - `codex/.claude/commands/rebase-upstream.md` only if its summary file list or inventory guidance needs to mention the new families explicitly
  - `codex/external/repos/codex-patched/codex-rs/tui/src/multi_agents.rs`
  - `codex/external/repos/codex-patched/codex-rs/tui/src/resume_picker.rs`

## Architect Analysis

- The change is a registry-refresh / source-marker reconciliation pass, not a behavior change, so it should minimize upstream-canonical conflict by:
  1. keeping source edits limited to the smallest missing marker seams,
  2. using `patch-surface.md` plus focused audit hooks for the rest,
  3. avoiding feature-flag migrations in this task.
- The paste-burst entry is stale enough that the safest plan is to retire or rewrite it rather than "re-mark" source that has already reverted to upstream-like behavior.
- Knob A and Knob B should be documented as fork product settings, while the feature-registry bookkeeping should explicitly call out fork-added or fork-repurposed `Feature` entries such as `anthropic_models`, `managed_hooks`, `background_process_notification`, and `mcp_server_notifications`.
- Branch sequencing still matters because the missing marker seams and the additional `.5` registry families belong to the maintained `.5` release line. The refreshed planning recommendation is to use a dedicated branch from the current maintained codex line rather than the historical accumulation branch, so the marker reconciliation matches the already-tagged code that will ship.

## Codex Research

- The current codex submodule HEAD is tagged `release/0.135.0-copilot-api.5`, so the maintained line is no longer hypothetical `.5` accumulation work; it is the live `0.135.0-copilot-api.5` / upstream `rust-v0.135.0` release line.
- Additional concrete source anchors from the codex review:
  - focus-leak recurrence / Windows VT-input lifetime: `codex-rs/tui/src/tui.rs:293`, `:394`
  - agent-name display: `codex-rs/tui/src/chatwidget/tool_lifecycle.rs:117`, `codex-rs/tui/src/multi_agents.rs:334`, `:475`
  - `/resume` DB-only lazy reconcile: `codex-rs/tui/src/resume_picker.rs:112`, `:161`, `:1320`, `:1731`, `:1930`
  - retained committed-transcript viewport: `codex-rs/tui/src/app/resize_reflow.rs`, `codex-rs/tui/src/app.rs:1307`, `codex-rs/tui/tests/suite/resize_reflow.rs`
- Recommended verification posture:
  - reuse existing focused tests where they already exist for TUI/model families
  - add new lightweight grep guards only for the still-unmarked seams in `multi_agents.rs` and `resume_picker.rs`
- Branching recommendation changed from "stay on the historical accumulation branch" to "use a dedicated branch from the current maintained codex line", because `.5` is already tagged at HEAD.

## Copilot Research

- The wrapper/inner-submodule split is the key architectural boundary:
  - wrapper-owned docs and guard scripts live under `codex/docs/` and `codex/scripts/`
  - upstream-canonical patched source lives under `codex/external/repos/codex-patched/codex-rs/`
  - fork-exclusive overlay crates remain the preferred low-conflict placement for new logic
- Recent source families that the registry refresh must account for:
  - focus-leak/focus-leak-recur: `codex-rs/tui/src/tui.rs`
  - BG exec-cell rendering: `codex-rs/tui/src/chatwidget/command_lifecycle.rs`
  - agent-name display: `codex-rs/tui/src/chatwidget/tool_lifecycle.rs`, `codex-rs/tui/src/multi_agents.rs`
  - Knob A reasoning: `codex-rs/core/src/client.rs`, `codex-rs/model-provider/src/copilot_models_endpoint.rs`
  - Knob B context tier / status line: `codex-rs/config/src/config_toml.rs`, `codex-rs/core/src/config/mod.rs`, `codex-rs/model-provider/src/copilot_models_endpoint.rs`, `codex-rs/tui/src/chatwidget/status_surfaces.rs`
  - managed hooks: `codex-rs/features/src/lib.rs`, `codex-rs/hooks/src/managed_gate.rs`, `codex-rs/hooks/src/engine/mod.rs`, `codex-rs/core/src/config/mod.rs`
  - `/resume` DB-only first page + lazy reconcile: `codex-rs/tui/src/resume_picker.rs`
  - retained committed-transcript viewport: `codex-rs/tui/src/app.rs`, `codex-rs/tui/src/app/resize_reflow.rs`, `codex-rs/tui/src/chatwidget/committed_transcript.rs`, `codex-rs/tui/src/chatwidget/rendering.rs`, `codex-rs/tui/src/pager_overlay.rs`
- Release evidence points to the maintained `0.135.0` line:
  - `patch-surface.md` already contains `v0.135.0` replant notes later in the file
  - the local tag set includes `v0.135.0-copilot-api.1` through `.5` plus `release/0.135.0-copilot-api.5`

## Consolidated File List

### Files to Modify

- `codex/docs/implementation/patch-surface.md`
- `codex/scripts/audit_invariants.sh`
- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/tool_lifecycle.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/multi_agents.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/resume_picker.rs`

### Likely Dependency / Evidence Files

- `codex/CLAUDE.md`
- `codex/.claude/commands/rebase-upstream.md`
- `.ralph/investigations/codex-fork-patch-marking-and-divergence-audit/findings.md`
- `.ralph/investigations/codex-fork-flags-to-experimental-features-migration/findings.md`
- `.ralph/investigations/codex-resume-slow-history-paint-regression-from-resize-fix/findings.md`

### Source Families the Registry Must Cover

- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/command_lifecycle.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/tool_lifecycle.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/status_surfaces.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/tui.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/app/resize_reflow.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/client.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/config/mod.rs`
- `codex/external/repos/codex-patched/codex-rs/model-provider/src/copilot_models_endpoint.rs`
- `codex/external/repos/codex-patched/codex-rs/hooks/src/managed_gate.rs`
