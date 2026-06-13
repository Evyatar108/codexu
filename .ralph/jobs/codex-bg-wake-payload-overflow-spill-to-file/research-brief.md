# Research Brief

## Researcher Findings

### Relevant seams
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/async_watcher.rs`
  - `start_streaming_output()` consumes PTY chunks before `HeadTailBuffer` omission.
  - `spawn_exit_watcher()` builds the `<task_notification>`, queues it for the next turn, and wakes the session.
  - `build_background_completion_output()` owns the current 16 KiB inline head/tail truncation behavior.
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/process_manager.rs`
  - Creates the shared transcript and shared `notified` flag, starts the streaming watcher, and spawns the exit watcher.
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/mod.rs`
  - `BackgroundCompletionEvent` currently carries only `process_id`, `exit_code`, and inline `output`.
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/head_tail_buffer.rs`
  - Retains only the bounded head/tail transcript; dropped middle bytes are unrecoverable after omission.
- `external/repos/codex-patched/codex-rs/core/src/tasks/mod.rs`
  - `coalesce_background_notifications()` currently preserves only `task_id` and `exit_code` when merging consecutive background completions.
- `external/repos/codex-patched/codex-rs/features/src/lib.rs`
  - Houses `Feature`, `Stage`, and `FeatureSpec`; `BackgroundProcessNotification` is currently default-off and `Stage::UnderDevelopment`.

### Reusable patterns
- Session-scoped artifact writes already exist:
  - `external/repos/codex-patched/codex-rs/core/src/stream_events_utils.rs`
  - `codex-rs-overlay/codex-stream-diagnostics/src/sidecar.rs`
- Session directory precedents already exist under `~/.codex/sessions/<conversation>/...`:
  - `external/repos/codex-patched/codex-rs/core/src/session/turn.rs`
  - `external/repos/codex-patched/codex-rs/rollout/src/recorder.rs`

### Tests and docs already covering nearby behavior
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/async_watcher_tests.rs`
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/process_manager_tests.rs`
- `external/repos/codex-patched/codex-rs/core/src/tasks/mod_tests.rs`
- `external/repos/codex-patched/codex-rs/core/src/session/tests.rs`
- `codex-rs-overlay/codex-invariant-tests/tests/background_notifications.rs`
- `codex-rs-overlay/codex-invariant-tests/tests/background_completion.rs`
- `docs/implementation/patch-surface.md`

## Architect Analysis

Failed: the architect subagent follow-up returned an unrelated happy-app analysis, so it was excluded from synthesis.

## Codex Research

Failed: the Codex research leg hung without producing staged output (`codex-exec` never wrote `codex-research.txt`), so the plan relies on direct source inspection plus the Copilot and researcher passes.

## Copilot Research

- The only seam that can recover bytes already dropped by `HeadTailBuffer` is the live streaming path in `start_streaming_output()` / `process_chunk()`; exit-time spill is too late.
- A small new helper under `core/src/unified_exec/` is the best fit for session-scoped artifact path construction, lazy file creation, streaming writes, and final reference generation.
- The background notification XML can stay backward-compatible if the current `<output>` preview is preserved and an additional escaped recovery-reference tag is appended only when truncation happened and the spill succeeded.
- The existing coalescer in `core/src/tasks/mod.rs` is the main downstream risk because it strips everything except `task_id` and `exit_code`.
- The best session-path precedents are the image-generation artifact helper and the stream-cut sidecar sink.

## Consolidated File List

### Files to modify
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/async_watcher.rs`
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/mod.rs`
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/process_manager.rs`
- `external/repos/codex-patched/codex-rs/core/src/tasks/mod.rs`
- `external/repos/codex-patched/codex-rs/features/src/lib.rs`
- `docs/implementation/patch-surface.md`

### Likely new file
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/background_output_artifact.rs`

### Dependencies and reuse
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/head_tail_buffer.rs`
- `external/repos/codex-patched/codex-rs/core/src/stream_events_utils.rs`
- `external/repos/codex-patched/codex-rs/core/src/session/turn.rs`
- `external/repos/codex-patched/codex-rs/rollout/src/recorder.rs`
- `codex-rs-overlay/codex-stream-diagnostics/src/sidecar.rs`

### Tests
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/async_watcher_tests.rs`
- `external/repos/codex-patched/codex-rs/core/src/unified_exec/process_manager_tests.rs`
- `external/repos/codex-patched/codex-rs/core/src/tasks/mod_tests.rs`
- `external/repos/codex-patched/codex-rs/core/src/session/tests.rs`
- `codex-rs-overlay/codex-invariant-tests/tests/background_notifications.rs`
- `codex-rs-overlay/codex-invariant-tests/tests/background_completion.rs`

### Docs and config
- `docs/implementation/patch-surface.md`
- `external/repos/codex-patched/codex-rs/features/src/lib.rs`
