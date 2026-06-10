---
overviewTaskId: crews-codex-progress-bg-gate-stall-detection
---

## Direction
D-001 — Rollout-transcript liveness parser (sibling `detect-active-bg-codex.js`). Port the crews progress-bg stall gate to codex by parsing the codex rollout JSONL for backgrounded unified-exec sessions, with current-turn freshness scoping and a cmd-via-call_id infra filter, and widening the `stop.js` engine gate from copilot-only to copilot|codex.

## Goal
A codex crew MEMBER that emits `kind=progress` and tries to end its turn with **no fresh, non-infra active background work** is BLOCKED at the Stop hook (forced to emit `kind=question` / `kind=done` / `kind=blocked` instead), exactly as Copilot members already are. The live failure mode — a codex `/implement-with-ralph` member doing manual scaffolding then `kind=progress`-stalling with the Ralph loop never started — is caught and blocked. Verified end-to-end by a LIVE codex dogfood, not just green unit tests.

## Scope
### In Scope
- New `hooks/detect-active-bg-codex.js` (sibling to `detect-active-bg.js`) exporting `detectActiveBgCodex({ transcriptPath, asOf })` with the SAME return shape `{ activeCount, nonListenerCount, samples, asOf }`.
  - Signal: parse the rollout JSONL at the Stop-supplied `transcript_path`. A session `N` is RUNNING when a `function_call_output` contains `"Process running with session ID N"`; it is DEAD when an `await_background_completion` whose `arguments.session_id === N` returns a terminal output (`"Process exited with code …"` / unknown-process / failure). Exits are correlated to `N` via the await call's `session_id` argument (the exit text carries NO id). The launching `cmd` is recovered via the `exec_command` `function_call` → `function_call_output` shared `call_id`.
  - Liveness biased FALSE-NEGATIVE (block on ambiguity, matching the Copilot detector): a session counts only if its latest signal is RUNNING, that running signal is FRESH (in the current turn, after the last `event_msg.task_started` boundary), and its launching `cmd` is resolvable and non-infra.
  - Infra filter: reuse `isListenerArmCall(cmd) || isCrewsCliInfraCall(cmd)` from `hooks/listener-protocol.js` verbatim (engine-agnostic; already handles `$env:CREWS_BIN`). Unresolvable `cmd` ⇒ treated as not-non-infra (fail toward block).
- `hooks/stop.js` progress-bg gate (`~:1182-1212`): widen the engine condition to `copilot || codex`; dispatch `detectActiveBgCodex` for codex / `detectActiveBg` for copilot; **drop the `!isRetry` skip for codex** (codex's Stop carries `stop_hook_active`, so the retry would otherwise be a model bypass — rely on the existing `bumpBlockCount('progress-without-bg')` circuit breaker); make the hardcoded `engine=copilot` log line engine-aware.
- Preserve the v3.1.0 STRUCTURAL-COMPLETENESS invariant (document it in the new module header) and the v3.3.0 NO-MODEL-BYPASS invariant (only `CREWS_PROGRESS_BG_GATE=off` env escape; NO new bypass tag).
- `tests/progress-bg-gate-codex.test.js`: unit tests over a committed redacted REAL rollout fixture + a Stop-subprocess e2e.
- 6-file version bump via `scripts/bump-version.js`; crews `AGENTS.md` section; `CHANGELOG.md`.

### Out of Scope
- The Copilot detector internals (`detect-active-bg.js`) — unchanged.
- Codex `task`/`multi_agent` subagent fan-out counting (a separate question from unified-exec bg sessions).
- D-002 (structured manifest tracking via hooks) — fallback only; needs codex-side changes.
- The codexu root `CLAUDE.md` (gitignored — do NOT touch); fork guidance edits go in crews `AGENTS.md` / codexu `AGENTS.md` only.

## Criteria
- A codex member emitting `kind=progress` with NO background work is BLOCKED at Stop with the canonical reason (`kind=progress requires active background work …`).
- A codex member with ONLY the listener (`node $env:CREWS_BIN arm`) as a backgrounded session is BLOCKED (infra filter excludes it) — proves the filter.
- A codex member with a FRESH non-infra backgrounded `exec_command` session (e.g. a real long-running build) emitting `kind=progress` is ALLOWED.
- A codex member whose bg session was launched then exited before Stop (await returned `Process exited with code` / unknown-process), emitting `kind=progress`, is BLOCKED.
- A stale `"Process running with session ID N"` from a PRIOR turn with no fresh await this turn does NOT satisfy the gate (no false-pass on dead sessions).
- The codex retry path (`stop_hook_active === true`) re-evaluates the gate (no bypass); the circuit breaker still bounds block loops.
- Claude/Copilot member behavior is byte-identical (engine-gated).
- `node plugins/crews/tests/run.js` is green AND a LIVE codex dogfood confirms the 5-case matrix (green units alone are NOT acceptance — the v3.16.0/3.17.0 lesson).

## Context
Settled from codex Rust source + a real rollout transcript:
- Transcript = date-tree rollout JSONL `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`; every line `{timestamp,type,payload}`. codex's Stop hook stdin ALREADY carries `transcript_path` = the live rollout path (`core/src/hook_runtime.rs:378-388`, `hooks/src/events/stop.rs:24-43`, `core/src/session/mod.rs:3302-3305`), threaded by `codex-shim.js::codexToClaudeStopInput` to `data.transcript_path` which `stop.js:1189` already reads — ZERO new plumbing.
- BG model: `exec_command` (`unified_exec.rs:28-51`) + blocking `await_background_completion` (`await_background_completion.rs:20-28`). Output strings from `core/src/tools/context.rs:409-420`: `"Process running with session ID N"` (backgrounded) vs `"Process exited with code X"` (synchronous). `N` = internal unified-exec id (`process_manager.rs:341-365`), same id space as await's `session_id` arg.
- `await_background_completion` BLOCKS the turn (`process_manager.rs:768-790`), so Stop never fires while awaiting ⇒ the only at-Stop bg session is a launch-then-end-turn-without-await ⇒ the structural-completeness argument holds for codex (per `.ralph/investigations/codex-notify-hook-async-bg-completion/findings.md`).

Disconfirming observations to respect in the plan: (1) "last-signal-is-running" is UNSOUND without current-turn freshness — async/unpersisted `ExecCommandEnd` and restart/resume leave stale running lines that would false-PASS dead sessions; bias false-negative. (2) The listener-as-bg-session assumption is to be confirmed cheaply by the arm-only live smoke before relying on the infra filter. (3) Free-text parsing is version-fragile; commit a real fixture and escalate to D-002 only if it proves repeatedly brittle. (4) Unlike Copilot's rarely-firing `agentStop`, codex's `Stop` fires per turn — good for this gate, but make the retry/circuit-breaker interaction correct so a blocked member can still recover.
