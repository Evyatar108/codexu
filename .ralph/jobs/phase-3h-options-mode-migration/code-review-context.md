# Code Review Context — phase-3h-options-mode-migration

Notes captured during code review for downstream fixer / regression-detection agents.

## Codebase conventions observed

- The plugin follows the upstream Claude options-mode hook layout: `hooks/*.js` files invoked as Node CLIs reading stdin JSON and writing stdout JSON or plain text. CommonJS (`require`), not ESM, for the hook entrypoints; ESM (`.mjs`) for tests and smoke scripts. This split mirrors upstream byte-identically and is intentional.
- Tag constants live in `hooks/config.js` and are imported by every hook. Tests assert byte-identity against upstream snapshots (per plan AC tag-constant byte-identity test).
- State files (per-session flag, default mode JSON, counter files, log) all live under `process.env.PLUGIN_DATA` which codex sets at hook invocation. `getConfigRoot()` throws `ERR_OPTIONS_PLUGIN_DATA_REQUIRED` if unset — this is the documented fail-loud contract (INV-6, README:81-84). Several stop.js callers wrap getConfigRoot in try/catch and swallow the throw, which softens that contract into fail-open (see F-004).
- The hooks use `${CLAUDE_PLUGIN_ROOT}` literally in `hooks/hooks.json` even on codex — codex's discovery layer aliases that env var (INV-5). Do not switch to `${PLUGIN_ROOT}`.
- Atomic writes (`safeWriteFlag`, `_writeConfigJsonAtomic`) use the openSync(O_NOFOLLOW | O_EXCL) + renameSync pattern with documented TOCTOU acceptance comments at config.js:154-157 and 217-222. Threat model: local attacker with write access to PLUGIN_DATA already owns plugin state.

## Codex engine gotchas (relevant to this review)

- **SessionStart accepts plain-text stdout as additional_context.** codex-rs/hooks/src/events/session_start.rs:193-205 has an explicit fallback: if stdout does not parse as the strict SessionStartCommandOutputWire JSON and `looks_like_json()` is false, the raw trimmed stdout is appended as additionalContext. UserPromptSubmit does NOT have the same fallback — it requires JSON via `hookSpecificOutput.additionalContext`. user-prompt-submit.js correctly uses JSON (lines 83-88); session-start.js correctly uses plain text (line 32). Both work. Reviewers unfamiliar with the SessionStart plain-text fallback may falsely flag session-start.js as broken (Codex's F1 in `codex-review.txt` is this kind of false positive — verified against codex source).
- **Stop hook output is opt-in.** Empty stdout from stop.js = pass-through; non-empty must parse as StopCommandOutputWire JSON `{"decision":"block","reason":"..."}`. stop.js writes the JSON form only on the block path (line 136-139), which matches the contract.
- **NullableString shape.** `transcript_path` and `last_assistant_message` are plain `string | null` (INV-1). Fixtures and tests use plain strings; do not wrap in `{path:...}` / `{text:...}` objects.
- **stop_hook_active semantics identical to upstream Claude.** Init false, set true after a Stop hook blocks (INV-2). `if (input.stop_hook_active === true) return;` is the correct port — verified at stop.js:97.
- **PreToolUse for request_user_input is NOT wired** (INV-3). `hooks/hooks.json` correctly omits the PreToolUse block. The auto-mode rule text and stop.js block reason claim a PreToolUse auto-responder anyway (see F-003) — that wording predates the deferral and needs to be updated to match the deployed behavior.

## Cross-cutting concerns

- **Fail-open vs fail-loud surface.** The plan and CLAUDE.md emphasize fail-loud (INV-6, README:81-84). Three places in stop.js swallow the loud failure: line 100-102 (isOptionsActive try/catch), line 117 (getOptionsMode try/catch), line 143-145 (top-level main().catch). Aggregating these, a misconfigured install with PLUGIN_DATA unset will silently pass every Stop event through. This is the dominant pattern behind F-002 and F-004.
- **Empty / whitespace-only `last_assistant_message` handling.** The current branch at stop.js:111-114 short-circuits with pass-through when the message is empty AND no trailing function_call exists. The plan calls for blocking in that case (AC-2: missing tag in active mode → block). This is F-001 — the most material correctness issue.
- **Documentation parity for deferred behavior.** SKILL.md (line 14) and README §Known Gaps (line 64-66) correctly describe the deferred PreToolUse auto-responder; the rule text in config.js (OPTIONS_RULES_TEXT_AUTO line 53) and the block reason in stop.js (line 119) still claim the auto-responder exists. F-003.

## Fixture / test coverage gap

- Plan §Story 4 enumerated nine codex-shape Stop fixtures (`codex-stop-tag-present.json`, `codex-stop-tag-missing.json`, `codex-stop-disabled.json`, `codex-stop-strict-bg-task.json`, `codex-stop-auto-task-complete.json`, `codex-stop-function-call.jsonl`, `codex-stop-loop-counter.json`, `codex-stop-first-run.json`, `codex-stop-continuation.json`). Only `codex-stop-spike.json` was committed. Dynamic in-test payload construction in `tests/stop.test.mjs` (224 lines) covers the runtime behavior; the static fixture corpus called out as a wire-shape regression surface is not present. Logged as F-006 (Low) — runtime coverage exists, static documentation coverage does not.
