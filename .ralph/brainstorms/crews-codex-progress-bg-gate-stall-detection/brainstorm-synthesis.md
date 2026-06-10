Lenses: ran=[source-investigation (codex Rust + real rollout transcript), devils-advocate (critique pass)]; skipped=[codex-exec CLI lens, copilot-exec CLI lens] — replaced by direct source+transcript grounding because this is a code-internals design task where file:line + a real transcript are stronger evidence than LLM-lens consensus.

# Port the crews progress-bg stall gate to codex members

## Problem framing

crews v3.19.1 has a Stop-hook **progress-bg gate**: it BLOCKS a crew MEMBER that
emits `kind=progress` and tries to end its turn when it has **no active
background work** (other than the listener). It forces the member to instead
emit `kind=question` (wait on the lead), `kind=done` (finish), or `kind=blocked`
(surface a problem). The gate is **Copilot-only** today:

- `hooks/stop.js:1183` gates on `manifest.engine === 'copilot'`.
- The detector `hooks/detect-active-bg.js` parses **Copilot** `events.jsonl`
  shapes (`tool.execution_start` `arguments.mode==='async'` + `system.notification`
  `kind.type==='shell_completed'`).
- crews v3.6.0 explicitly DEFERRED the codex equivalent
  ("Progress-bg gate for codex … Defer to v3.NEXT+2: codex bg-liveness gate").

**Live failure (2026-06-09):** a codex `/implement-with-ralph` member
(`impl-overviewdata`) created a worktree, did manual scaffolding, then emitted
`kind=progress` and STOPPED with the Ralph loop never started — exactly the
false-progress stall the gate catches for Copilot, but codex is ungated so
nothing blocked it.

The decision the brainstorm settles: **what is the codex liveness signal**, how
the detector reads it, how the infra filter is shaped, where the code lives, and
how to widen the engine gate without breaking the v3.1.0 structural-completeness
and v3.3.0 no-model-bypass invariants.

---

## Verified evidence (source + a real transcript)

All claims below are checked against the codex Rust submodule
(`codex/external/repos/codex-patched/codex-rs/`) and a real rollout transcript
at `~/.codex/sessions/2026/06/09/rollout-2026-06-09T21-17-42-019eafc0-….jsonl`.

1. **Transcript layout = a date-tree rollout JSONL, NOT a flat `<id>/` dir.**
   Path shape: `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO-ts>-<session-id>.jsonl`.
   Each line is `{timestamp, type, payload}`; **every** line carries a top-level
   ISO `timestamp` (verified: 118/118 lines). Line types observed:
   `session_meta`, `turn_context`, `event_msg` (`task_started`/`task_complete`/
   `user_message`/`agent_message`/`token_count`), and `response_item`
   (`function_call`/`function_call_output`/`reasoning`/`message`).

2. **codex's Stop hook stdin already carries `transcript_path` = the live
   rollout path.** `core/src/hook_runtime.rs:378-388` builds
   `codex_hooks::StopRequest { … transcript_path, … stop_hook_active,
   last_assistant_message, … }`; `hooks/src/events/stop.rs:24-43` serializes
   `StopCommandInput { session_id, turn_id, transcript_path, cwd,
   hook_event_name:"Stop", … }`; the path is the live rollout file
   (`core/src/session/mod.rs:3302-3305` `current_rollout_path()` →
   `thread-store/src/local/live_writer.rs:140-151` `rollout_path()`).
   crews `hooks/codex-shim.js::codexToClaudeStopInput` already threads
   `src.transcript_path → out.transcript_path`, and `hooks/stop.js:1189` already
   reads `data.transcript_path || manifest.transcriptPath`. **So the detector
   gets the rollout path with ZERO new plumbing** — it does NOT need the inline
   `__crewsCodexLastAssistantMessage` (that is for kind-tag enforcement; the bg
   detector needs the full rollout file).

3. **codex background-work model = unified-exec `exec_command` + blocking
   `await_background_completion`.**
   - `exec_command` args (`core/src/tools/handlers/unified_exec.rs:28-51`):
     `{ cmd, workdir, env, yield_time_ms, max_output_tokens }`.
   - `await_background_completion` args
     (`core/src/tools/handlers/unified_exec/await_background_completion.rs:20-28`):
     `{ session_id: i32, timeout_ms, max_output_tokens }`.
   - Output strings (`core/src/tools/context.rs:409-420`):
     `"Chunk ID: <id>"`, `"Wall time: <s> seconds"`, then EITHER
     `"Process exited with code <X>"` (finished within the yield window — NOT bg
     work) OR `"Process running with session ID <N>"` (backgrounded).
   - The `<N>` "session ID" is an **internal unified-exec id** (random
     `1_000..100_000`, `core/src/unified_exec/process_manager.rs:341-365`), the
     SAME id space as `await_background_completion`'s `session_id` arg
     (`await_background_completion.rs:96-100`) — NOT an OS PID.

   **Real transcript proof:** `exec_command {cmd:"rg …", yield_time_ms:1000}` →
   output `"…Wall time: 1.0047 seconds\nProcess running with session ID 68830\n…"`;
   later `await_background_completion {session_id:68830, timeout_ms:10000}` →
   output reporting the process (still running → another
   `"Process running with session ID 68830"`, or done →
   `"Process exited with code 0"`). A synchronous `exec_command` → output
   `"…Process exited with code 0\nOutput:\n<stdout>"`.

4. **`await_background_completion` BLOCKS the codex turn** (awaits exit or
   timeout up to 300_000 ms; `process_manager.rs:768-790`, default max
   `unified_exec/mod.rs:64-69`). Therefore **while a codex member is awaiting,
   Stop does NOT fire.** The ONLY way a codex member reaches Stop with a
   still-running bg session is: it launched one (got "Process running with
   session ID N") and ENDED its turn WITHOUT a terminal await for N. (Confirmed
   in `.ralph/investigations/codex-notify-hook-async-bg-completion/findings.md`.)
   This is the structural analog of Copilot's "async shell still open at Stop"
   and it is what makes the gate's structural-completeness argument hold for
   codex too: any in-process wait blocks Stop; any genuine bg work is a
   backgrounded unified-exec session visible in the rollout.

---

## Candidate directions

### D-001 (RECOMMENDED): rollout-transcript liveness parser, sibling module
- **Contributing lenses:** source-investigation, devils-advocate.
- **Signal source:** parse the codex **rollout JSONL** for backgrounded
  unified-exec sessions. A session `N` is born when a `function_call_output`
  (from an `exec_command` OR an `await_background_completion`) contains
  `"Process running with session ID N"`. It dies when an
  `await_background_completion` **whose `arguments.session_id === N`** returns a
  terminal output (`"Process exited with code …"` / unknown-process / failure).
  The launching command (for the infra filter) is recovered by correlating the
  `exec_command` `function_call` → its `function_call_output` via shared
  `call_id`, reading `arguments.cmd`.
- **Placement:** a NEW sibling module `hooks/detect-active-bg-codex.js`
  exporting `detectActiveBgCodex({ transcriptPath, asOf })` that returns the
  SAME shape as the Copilot detector (`{ activeCount, nonListenerCount,
  samples, asOf }`). `hooks/stop.js` widens the engine gate to
  `copilot || codex` and dispatches the detector by engine. Sibling (not a
  branch inside `detect-active-bg.js`) keeps the Copilot detector's
  STRUCTURAL-COMPLETENESS header intact and avoids interleaving two unrelated
  transcript-format parsers in one file; the two share only the infra-filter
  predicates and the return shape.
- **Why it might work:** lowest conflict (one new file + a ~10-line `stop.js`
  dispatch change), reuses the existing `isListenerArmCall`/`isCrewsCliInfraCall`
  predicates verbatim, and the rollout already gives a clean per-line timestamp +
  turn boundaries (`task_started`).
- **Risks / friction:** free-text parsing of `context.rs` output strings is
  brittle to codex version drift; the naive "last-signal-is-running" rule is
  UNSOUND (see Disconfirming observations) and must be hardened to bias
  false-negative.
- **Cheapest validation:** a live codex dogfood (arm-only + `kind=progress`
  ⇒ blocked) plus a committed real-shaped rollout fixture.

### D-002 (alternative): structured manifest-tracked bg sessions via codex hooks
- **Contributing lenses:** source-investigation, devils-advocate.
- Instead of parsing free-text, have crews' codex `Pre/PostToolUse` hooks record
  `exec_command` bg-session starts/exits into the actor manifest, and the gate
  reads manifest state.
- **Why considered:** immune to output-format drift; structured truth.
- **Why NOT recommended:** codex `PostToolUse` does not expose structured
  "still-running session id" metadata for an exec that backgrounded, and an
  async exit that lands AFTER the turn never fires `PostToolUse` at all — so a
  faithful structured tracker needs **codex-side changes**, which is a far larger
  surface and a rebase liability. Higher effort, partial infeasibility without
  upstreaming. Keep as the fallback if D-001's free-text signal proves too
  fragile.

### D-003 (alternative): minimal "fresh-await-proof" gate
- **Contributing lenses:** source-investigation, devils-advocate.
- Exploit the blocking-await invariant: require a progress turn to carry a
  **fresh, current-turn** non-infra liveness proof (ideally an
  `await_background_completion` that returned "still running"); treat a bare
  `exec_command` "running" as provisional and never carry it across turns.
- **Why considered:** simplest and most robust against stale-running false-pass.
- **Relationship to D-001:** this is not a separate architecture — it is the
  CORRECT freshness rule that D-001 must adopt (folded into the recommended
  direction below). Listed separately because it reframes "active = open
  session" into "active = freshly-proven-open session this turn," which is the
  key soundness correction.

---

## Recommended direction (D-001, hardened with D-003's freshness rule)

### (a) Codex bg-liveness SIGNAL SOURCE — DECISION
Parse the **rollout JSONL** at `data.transcript_path`. Index two maps:
- `execLaunch: call_id → { cmd, ts }` from every `exec_command` `function_call`
  (`payload.name === 'exec_command'`, `arguments.cmd`).
- `awaitArgs: call_id → { sessionId, ts }` from every
  `await_background_completion` `function_call` (`arguments.session_id`) — needed
  because the EXIT output text (`"Process exited with code X"`) does **not**
  carry the session id, so exits are correlated to `N` only via the await call's
  argument.

Then walk `function_call_output` rows in order:
- `"Process running with session ID N"` → mark session `N` RUNNING at this row's
  `timestamp`; if this output's `call_id` is in `execLaunch`, record `N`'s
  launching `cmd` (the exec that backgrounded it).
- `"Process exited with code …"` / unknown-process / await-failure on an output
  whose `call_id` is in `awaitArgs` → mark that `awaitArgs[call_id].sessionId`
  TERMINAL (dead).

**Liveness rule (biased false-NEGATIVE, matching the Copilot detector's
ambiguity bias):** session `N` counts as **active-non-infra** at Stop iff ALL:
1. `N`'s most recent signal is RUNNING (no later terminal for `N`), AND
2. that RUNNING signal is **FRESH** — it occurs in the CURRENT turn (after the
   last `event_msg.task_started` / user boundary in the rollout). A stale
   "running" carried over from a prior turn with no fresh await this turn is
   treated as DEAD/unverifiable → does NOT satisfy the gate. (Rationale below.)
3. `N`'s launching `cmd` is resolvable AND does NOT match the infra filter
   (next). If the `cmd` is unresolvable, do NOT count `N` as non-infra.

`nonListenerCount` = count of active-non-infra sessions; `activeCount` = active
sessions before the infra filter; `samples` mirror the Copilot shape
(`{ sessionId, cmd, isListener }`, field name kept `isListener` for blast-radius
parity with existing tests/log lines).

**Why current-turn freshness (not carry-forward like Copilot):** Copilot's
`shell_completed` is a reliably-persisted `system.notification`, so an open shell
with no completion is trustworthy across turns. codex's exit can be an
**async `ExecCommandEnd` that is not guaranteed to be persisted to the rollout**,
and restart/resume leave stale "running" lines — so carrying a prior-turn
"running" forward would false-PASS a dead session (the exact stall we fix). It
is also well-aligned with codex's idiom: to genuinely track a bg task you either
`await_background_completion` (blocks → no Stop) or you re-touch it this turn
(fresh await → fresh "running"). A member that launched a build three turns ago
and is just spinning out `progress` without touching it IS the stall to block;
the false-block is recoverable (emit `question`/`done`/`blocked`).

### (b) Detector placement + engine-gate widening — DECISION
- New `hooks/detect-active-bg-codex.js` (sibling). Same return shape; reuse
  `isListenerArmCall` + `isCrewsCliInfraCall` from `hooks/listener-protocol.js`.
- `hooks/stop.js` gate (currently `:1182-1212`):
  - Widen `const isCopilot = manifest.engine === 'copilot';` to also admit
    `codex`; dispatch `manifest.engine === 'codex' ? detectActiveBgCodex(...) :
    detectActiveBg(...)`.
  - **Drop the `!isRetry` skip for codex.** codex's Stop input DOES carry
    `stop_hook_active` (`codex-shim.js` reads `src.stop_hook_active`), so on the
    block-retry the existing `!isRetry` term would let the model re-emit
    `kind=progress` and pass — a model bypass. For codex, evaluate the gate
    regardless of `isRetry`; the existing `bumpBlockCount`
    (`'progress-without-bg'`) circuit breaker is the loop safety valve. (For
    Copilot `stop_hook_active` is always false, so this is inert there.)
  - Make the hardcoded `engine=copilot` log line (`:1203`) engine-aware.
  - Preserve invariants: NO model-settable bypass tag (v3.3.0); only the
    operator env `CREWS_PROGRESS_BG_GATE=off`. The codex detector is
    COMPLETE-BY-CONSTRUCTION by the same argument as Copilot's (await blocks
    Stop; bg work is a rollout-visible session) — document this in the new
    module header mirroring `detect-active-bg.js`'s STRUCTURAL COMPLETENESS
    section.

### (c) Codex infra-filter SHAPE — DECISION
For each active session `N`, resolve its launching `cmd` (via the `exec_command`
`call_id` → `arguments.cmd`) and apply
`isListenerArmCall(cmd) || isCrewsCliInfraCall(cmd)` — the EXACT engine-agnostic
predicates the Copilot detector uses (v3.4 confirmed `isCrewsCliInfraCall`
already handles the `$env:CREWS_BIN` PowerShell form). The codex listener-arm
(`node $env:CREWS_BIN arm`, which blocks waiting for mail) and any backgrounded
`review-mail`/`status`/`stop-member` infra call are thereby excluded so they do
NOT satisfy the gate. An unresolvable `cmd` is treated as NOT-non-infra (fail
toward block).

### (d) Conflict / effort estimate
- **Effort:** ~1 plan + 1 impl member. New file `detect-active-bg-codex.js`
  (~150-200 lines, structurally mirrors `detect-active-bg.js`); ~10-line
  dispatch change in `stop.js`; new `tests/progress-bg-gate-codex.test.js` with
  a committed redacted real rollout fixture + a Stop-subprocess e2e; 6-file
  version bump (`scripts/bump-version.js`) + AGENTS.md crews section + CHANGELOG.
- **Conflict surface: LOW.** Touches the `stop.js` gate block + one new sibling
  file. No edits to the Copilot detector internals. Same-plugin (crews) → must
  SERIALIZE against any other in-flight crews impl per the parallel-spawn
  disjoint-surface rule (version-file + AGENTS.md/CHANGELOG conflicts otherwise).
- **Acceptance gate:** a LIVE codex dogfood is MANDATORY — green units are NOT
  sufficient (the v3.16.0/3.17.0 lesson: both passed units, failed the live
  dogfood). This also discharges the v3.6.0 deferred "Story #3 live codex spawn
  smoke."

### (e) Rough story outline for the follow-on plan
- **US-001 — `detect-active-bg-codex.js`.** Rollout reader + `execLaunch`/
  `awaitArgs` indexing + running/terminal scan + session-id↔await correlation +
  current-turn freshness scoping + infra filter; returns
  `{activeCount, nonListenerCount, samples, asOf}`. Unit tests over a committed
  real-shaped rollout fixture (synchronous-exit / backgrounded-running /
  await-exited / listener-only / stale-prior-turn-running cases).
- **US-002 — `stop.js` gate widening.** Engine gate `copilot→copilot|codex`,
  detector dispatch by engine, drop `!isRetry` for codex, engine-aware log line.
  Preserve structural-completeness + no-bypass invariants.
- **US-003 — transcript-path robustness.** Confirm `data.transcript_path` is the
  rollout path on the codex Stop surface (it is, per evidence #2); add a fallback
  that derives the newest `~/.codex/sessions/**/rollout-*-<session_id>.jsonl`
  from `manifest.sessionId` if `transcript_path` is ever null (failure-open:
  skip the gate rather than guess wrong).
- **US-004 — LIVE codex dogfood (acceptance).** The 5-case matrix:
  (1) no bg + `progress` ⇒ blocked; (2) listener-only + `progress` ⇒ blocked
  (proves infra filter); (3) fresh non-infra running session + `progress` ⇒
  allowed; (4) bg launched-then-exited-before-Stop + `progress` ⇒ blocked;
  (5) await returned exit/unknown-process + `progress` ⇒ blocked.
- **US-005 — docs + version.** crews `AGENTS.md` section, `CHANGELOG.md`,
  6-file version bump. (codexu root `CLAUDE.md` is gitignored — do NOT touch.)

---

## Disconfirming observations / open questions (carry into the plan)

1. **The "last-signal-is-running" rule is unsound without freshness.** codex can
   emit `ExecCommandEnd` asynchronously after the model already saw "Process
   running with session ID N", and that end event is not guaranteed to be in the
   rollout under bounded history; restart/resume leave stale "running" lines.
   Carrying them forward false-PASSES a dead session — the exact stall. The
   freshness rule in (a) (current-turn-scoped + await-correlated exits) is the
   mandatory correction. This is THE load-bearing soundness decision.
2. **Listener-as-bg-session is an ASSUMPTION to confirm cheaply.** The infra
   filter is essential ONLY if a codex member's listener-arm actually appears as
   a backgrounded `exec_command` session in the rollout. It almost certainly
   does (an in-session arm blocks, so an `exec_command` with any `yield_time_ms`
   backgrounds it), but settle it with the US-004 arm-only smoke before relying
   on it. Even if the listener is launched some other way, the filter is still
   needed for backgrounded `review-mail`/`status` and is harmless if unused.
3. **Free-text parsing is version-fragile.** `context.rs` output strings could
   change across codex releases. Mitigation: commit a real rollout fixture, and
   if codex later exposes typed fields (`session_id`/`exit_code`) or a persisted
   `ExecCommandEnd`, prefer those. If fragility bites repeatedly, escalate to
   D-002 (structured), accepting it needs codex-side work.
4. **codex Stop cadence vs Copilot agentStop.** Unlike Copilot's `agentStop`
   (which the v3.5.1 finding showed fires ~0 times in long autonomous runs),
   codex's `Stop` fires per turn. That is GOOD for this gate (it actually runs),
   but it means the `isRetry`/circuit-breaker interaction (US-002) must be right
   so a blocked codex member can still recover after the breaker trips.
