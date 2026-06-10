# Research Brief: port progress-bg Stop-hook gate to codex members

Seeded from brainstorm: `.ralph/brainstorms/crews-codex-progress-bg-gate-stall-detection/selected-direction.md` (D-001).
Target: `ai-developer-toolkit/plugins/crews/` (submodule, crews v3.20.0). Read from the MAIN checkout
(`D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/`); the plan worktree has uninitialized submodules.

## Researcher Findings (file:line, verified on main @ crews v3.20.0)

### `hooks/stop.js` — the progress-bg gate (the edit site)
- `const isCopilot = manifest.engine === 'copilot';` at `stop.js:1183` (inside the block `1181-1213`).
- Full gate condition `stop.js:1187`: `if (gateEnabled && isCopilot && isProgress && isMember && !isRetry && !isShuttingDown) {`
  - `gateEnabled = process.env.CREWS_PROGRESS_BG_GATE !== 'off'` (`:1182`)
  - `isProgress = turnKind === 'progress'` (`:1184`), `isMember = state.role === 'member'` (`:1185`),
    `isShuttingDown = manifest.shutdownRequested === true` (`:1186`)
- transcript read `:1189`: `const transcriptPath = data.transcript_path || manifest.transcriptPath || null;`
- detector dispatch `:1191-1196`: `detection = detectActiveBg({ transcriptPath, asOf: new Date().toISOString() });`
  wrapped in try/catch that `appendLog`s "failing open" and leaves `detection = null` (failure-open).
- `subagentMode = parseSubagentMode(process.env)` `:1188`; `effectiveActive = computeProgressBgEffectiveActive(detection, subagentMode)` `:1199`.
- hardcoded-Copilot log `:1203`: `appendLog(\`progress-bg-gate name=${state.name} crew=${crew} engine=copilot active=${detection.activeCount} nonListener=${detection.nonListenerCount}${subagentLog}\`, cwd);`
- block on `effectiveActive === 0` `:1204-1208`: `bumpBlockCount(state.name, crew, cwd, state.role, 'progress-without-bg')` then `out.stdout.write({decision:'block', reason})` (reason = the canonical "kind=progress requires active background work…" string).
- `isRetry` is computed earlier from `data.stop_hook_active === true` (researcher: ~`:894`; copilot/architect concur).
- `computeProgressBgEffectiveActive(detection, subagentMode)` lives at `stop.js:165-170`:
  returns `nonListenerCount + (subagentMode === 'on' ? subagentActiveCount : 0)` with `Number.isFinite` guards.
  **Codex detector returning NO subagent fields is safe** — `Number.isFinite(undefined) === false → 0`.

### `hooks/detect-active-bg.js` — Copilot detector (the SIBLING template)
- `function detectActiveBg(opts)` at `:392`; core return shape `{ activeCount, nonListenerCount, samples, asOf }` `:406-433`.
- `samples` entries: `{ shellId, toolName, command, isListener }` (field name `isListener` kept for blast-radius parity).
- subagent fields are OPTIONAL, added by `buildSubagentFields` `:339-357`, gated by `CREWS_PROGRESS_BG_SUBAGENTS` (off by default). **Codex subagent counting is OUT OF SCOPE.**
- STRUCTURAL COMPLETENESS (v3.3.0) header block at `:77-99` — to mirror in the new module header.
- infra filter `:417-423`: `isListenerArmCall(start.command) || isCrewsCliInfraCall(start.command)`.
- flush-race retry-on-empty `:438-450` (`sleepSync(500)` then re-read once).
- helpers `compareTs` `:286-304`, `isActiveAt` `:306-314`.

### `hooks/listener-protocol.js` — reusable, engine-agnostic infra filters
- `isListenerArmCall(cmd)` `:125-128` (regex `ARM_PATTERN_CREWS` `:122`).
- `isCrewsCliInfraCall(cmd)` `:153-155` (regex `INFRA_PATTERN_CREWS` `:151`).
- Both accept `$CREWS_BIN`, `$env:CREWS_BIN`, `%CREWS_BIN%` — engine-agnostic; reuse VERBATIM.

### `hooks/codex-shim.js::codexToClaudeStopInput` — ZERO new plumbing
- `:77-95`. `transcript_path: src.transcript_path || null` `:81`. `stop_hook_active: src.stop_hook_active === true` `:83`.
  `__crewsCodexLastAssistantMessage = src.last_assistant_message` `:91-93`.
- So `stop.js:1189` (`data.transcript_path`) ALREADY receives the codex rollout path; the codex Stop retry signal ALREADY reaches `stop.js` as `data.stop_hook_active === true`.

### `hooks/codex-stop.js`
- `:33` calls `handleInput({ input: JSON.stringify(claudeInput), io })` after `codexToClaudeStopInput`. No new entrypoint needed.

### `stop.js:717-722` is a DIFFERENT gate (do NOT confuse)
- `if (manifest.engine === 'copilot' || manifest.engine === 'codex')` only switches the listener-arm *instruction prose* to the PowerShell/async form. NOT the progress-bg gate.

### Tests / version / docs
- Runner: `node tests/run.js` (recurses `tests/**/*.test.js`; serial denylist `tests/run.js:34-60`).
- Copilot gate test template: `tests/progress-bg-gate.test.js` (two-tier: pure-fn unit + Stop-subprocess e2e).
- Stop subprocess helper: `tests/lib/force-response.js` `runStop(cwd, sessionId, transcript, env, isRetry)` `:95-109`.
- Fixtures dir `tests/fixtures/` already holds `copilot-subagent-transcript.jsonl` — precedent for a committed real-shaped transcript fixture.
- Version: `scripts/bump-version.js` stamps **6** files (3 plugin manifests: `.claude-plugin/`, `.github/plugin/`, `.codex-plugin/`; 3 marketplace indexes: root `.claude-plugin/`, `.github/plugin/`, `.agents/plugins/`) + updates `tests/version.test.js`. Run `node scripts/bump-version.js <x.y.z>`.
- Docs: `plugins/crews/AGENTS.md` (prepend a `## v3.21.0` section) and `plugins/crews/CHANGELOG.md` (EXISTS — prepend a `## 3.21.0` entry). No `package.json`/`tsconfig` — typecheck via `node --check <file>`.

## Architect Analysis (key decisions)
- Widen `stop.js:1187` guard `isCopilot` → `isCopilot || isCodex`; per-engine dispatch (`manifest.engine === 'codex' ? detectActiveBgCodex(...) : detectActiveBg(...)`); keep the try/catch failure-open; make the `:1203` log `engine=${manifest.engine}`.
- DROP `!isRetry` for codex only: express as `(manifest.engine === 'codex' || !isRetry)`. Codex Stop carries `stop_hook_active`, so without this a block-retry could re-emit progress and bypass; `bumpBlockCount('progress-without-bg')` is the loop circuit breaker. For Copilot `stop_hook_active` is always false, so the term is inert there.
- Current-turn FRESHNESS rule is the load-bearing soundness decision (bias false-NEGATIVE): a RUNNING signal counts only if it occurs after the last `event_msg` `task_started` boundary in the rollout. Stale "running" from a prior turn / restart / unpersisted async `ExecCommandEnd` would otherwise false-PASS a dead session.
- Structural-completeness holds for codex: `await_background_completion` BLOCKS the turn, so Stop never fires while awaiting ⇒ the only at-Stop bg session is launch-then-end-turn-without-await.
- 5-case LIVE dogfood matrix (acceptance — green units NOT sufficient, the v3.16/3.17 lesson):
  (1) no bg → BLOCK; (2) listener/infra-only → BLOCK; (3) fresh non-infra running this turn → ALLOW; (4) bg launched then exited before Stop → BLOCK; (5) stale prior-turn running, no fresh await → BLOCK.

## GROUND-TRUTH codex rollout shapes (verified against a REAL rollout on disk)
Real file: `~/.codex/sessions/2026/06/05/rollout-2026-06-05T08-22-30-019e9860-…jsonl` (155 of 1526 local rollouts carry the bg signal). Each line is `{ timestamp, type, payload }`.

- **Turn boundary**: `{ type: 'event_msg', payload: { type: 'task_started' } }` (line 1 of that rollout).
- **exec_command launch** (`type:'response_item'`, `payload.type:'function_call'`, `payload.name:'exec_command'`):
  - `payload.call_id` (e.g. `"call_SkkEAQwTEbyaoCE3JivsYfmd"`)
  - `payload.arguments` is a **JSON STRING** (needs `JSON.parse`): `{"cmd":"git status --short --branch","workdir":"…","yield_time_ms":1000,"max_output_tokens":4000}` — the launching `cmd` is `arguments.cmd`.
- **backgrounded output** (`payload.type:'function_call_output'`, same `call_id`):
  - the text lives in **`payload.output`** (a STRING — NOT `content`): `"Chunk ID: 5beb79\nWall time: 1.0147 seconds\nProcess running with session ID 90331\nOriginal token count: 0\nOutput:\n"`.
  - ⇒ session `N` (here 90331) is born RUNNING; recover its `cmd` via the exec_command's `call_id`.
- **await_background_completion** (`payload.name:'await_background_completion'`):
  - `payload.arguments` JSON string `{"session_id":90331,"timeout_ms":10000,"max_output_tokens":4000}` — `arguments.session_id` is the only place the exit is correlated to `N` (the exit TEXT has no id).
- **terminal output** (`function_call_output`, the await's `call_id`):
  - `payload.output` = `"Chunk ID: 3b3657\nWall time: 0.0000 seconds\nProcess exited with code 0\nOriginal token count: …\nOutput:\n…"` ⇒ session `90331` is DEAD.

PARSER CORRECTION vs brainstorm prose: the output field is **`payload.output`** (string), and **`payload.arguments` is a JSON string** that must be `JSON.parse`d. The detector must tolerate parse failures (treat as not-resolvable → fail toward block).

## Codex Research
Not run (the codex-exec research shell was reaped at a turn boundary before completion). Coverage is fully provided by the researcher + architect + ground-truth investigation above.

## Copilot Research
Confirms: plain Node/CommonJS, no package.json/tsconfig/build (typecheck = `node --check`). Same integration points and constraints. A sibling `hooks/detect-active-bg-codex.js` mirroring the Copilot detector API but parsing rollout JSONL; reuse `isListenerArmCall`/`isCrewsCliInfraCall` exactly; correlate `exec_command`→`function_call_output` by `call_id`; correlate exits through `await_background_completion` args; fail toward blocking on ambiguity. Add a codex-focused sibling test rather than overloading the large Copilot test.

## Consolidated File List
**Create:**
- `ai-developer-toolkit/plugins/crews/hooks/detect-active-bg-codex.js`
- `ai-developer-toolkit/plugins/crews/tests/progress-bg-gate-codex.test.js`
- `ai-developer-toolkit/plugins/crews/tests/fixtures/codex-rollout-bg.jsonl` (committed redacted real-shaped fixture)

**Modify:**
- `ai-developer-toolkit/plugins/crews/hooks/stop.js` (gate widening ~`:1182-1213`)
- `ai-developer-toolkit/plugins/crews/AGENTS.md` (prepend `## v3.21.0` section)
- `ai-developer-toolkit/plugins/crews/CHANGELOG.md` (prepend `## 3.21.0`)
- 6 version-stamp files via `scripts/bump-version.js` + `tests/version.test.js`

**Reuse (no edit):**
- `hooks/listener-protocol.js` (`isListenerArmCall`, `isCrewsCliInfraCall`)
- `hooks/detect-active-bg.js` (template; untouched)
- `hooks/codex-shim.js`, `hooks/codex-stop.js` (already thread transcript_path + stop_hook_active)
- `tests/lib/force-response.js` (`runStop`)
