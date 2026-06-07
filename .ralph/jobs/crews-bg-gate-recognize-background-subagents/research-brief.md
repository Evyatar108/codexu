# Research Brief — crews-bg-gate-recognize-background-subagents (D-002)

## Researcher Findings (crews source surface map)
Target: `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/` (v3.10.0).

- **`hooks/detect-active-bg.js`** — the detector.
  - `ASYNC_SHELL_TOOL_NAMES = new Set(['bash','powershell'])` (:96)
  - helpers: `readEvents(transcriptPath,maxEvents)` (:102-116, default maxEvents 5000),
    `indexEvents(events)` (:124-158, builds asyncStarts/shellExits Maps keyed by shellId),
    `compareTs(a,b)` (:170-178), `isActiveAt(start,exit,tsIso)` (:182-188).
  - `detectActiveBg(opts)` returns `{ activeCount, nonListenerCount, samples, asOf }`
    (:228-229 empty sentinel, :252-254 computed). `retryOnEmpty` default true:
    one 500ms sleep + re-read on empty (:220-267).
  - exports: `{ detectActiveBg, readEvents, indexEvents, isActiveAt, compareTs, ASYNC_SHELL_TOOL_NAMES }` (:270-278).
- **`hooks/stop.js`** progress-bg gate (:1152-1178):
  - `const gateEnabled = process.env.CREWS_PROGRESS_BG_GATE !== 'off';` (:1153)
  - skip unless `gateEnabled && isCopilot && isProgress && isMember && !isRetry && !isShuttingDown` (:1158)
  - `const transcriptPath = data.transcript_path || manifest.transcriptPath || null;` (:1159)
  - log: `appendLog(\`progress-bg-gate name=${state.name} crew=${crew} engine=copilot active=${detection.activeCount} nonListener=${detection.nonListenerCount}\`, cwd)` (:1168)
  - block: `out.stdout.write(JSON.stringify({ decision:'block', reason })); return;` (:1170-1173)
  - `detectActiveBg` imported at stop.js:57.
- **`hooks/listener-protocol.js`** — the harness-aware tool-mention seam:
  - `SHELL_TOOL_NAMES = new Set(['bash','powershell'])` (:20)
  - `ARM_PATTERN_CREWS` (:121), `isListenerArmCall(cmd)` (:124-127),
    `INFRA_PATTERN_CREWS` (:150), `isCrewsCliInfraCall(cmd)` (:152-154),
    `isListenerArmToolCall(toolName,toolInput)` (:169-174).
  - exports at :307-322. NOTE: `ASYNC_SHELL_TOOL_NAMES` currently lives in
    detect-active-bg.js, NOT here. All three lenses: do NOT add `task` to
    `SHELL_TOOL_NAMES` (PreToolUse shell logic consumes it); add a NEW exported
    sub-agent tool-name set next to it.
- **`tests/progress-bg-gate.test.js`** — Tier-1 pure-helper tests (compareTs/
  isActiveAt/indexEvents/detectActiveBg) + Tier-2 Stop subprocess tests via
  `runStop` (imported from `tests/lib/force-response.js`; spawnSync hooks/stop.js,
  passes cwd/session_id/transcript_path). Fake transcript via `writeEvents(dir,events)`
  + `writeMemberTranscript(cwd,opts)`. Sets `CREWS_STRICT_SCHEMA='1'`. Representative
  cases: block-no-bg, listener-only-still-blocks, real-bg-passes, bypass-tag-removed-still-blocks.
- **Version machinery** — `scripts/bump-version.js` (authoritative; do NOT hand-edit) stamps
  **3 plugin manifests** (`.claude-plugin/plugin.json`, `.github/plugin/plugin.json`,
  `.codex-plugin/plugin.json`) + **3 marketplace indexes** (toolkit root
  `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`,
  `.agents/plugins/marketplace.json`) + `tests/version.test.js`. Current version 3.10.0.
- **Docs** — `AGENTS.md` newest section heading style `## v3.10.0 ...` (:4);
  `CHANGELOG.md` top entry `## 3.10.0 - 2026-06-06` (:2).
- **Test runner** — `node tests/run.js` (run from `plugins/crews/`); worker-thread
  runner, concurrency 10, serial denylist at run.js:39-60. Focused:
  `node tests/run.js progress-bg-gate.test.js listener-protocol.test.js copilot-transcript-shape.test.js`.
- **Copilot transcript path** — `hooks/turn-observability.js::resolveCopilotTranscriptPath(manifest,sessionId)`
  (:160-167): prefers `manifest.transcriptPath`, else `~/.copilot/session-state/<sessionId>/events.jsonl`.
- **Copilot normalization** — `hooks/copilot-shim.js` maps `transcriptPath`→`transcript_path`,
  handles `toolCalls[]`; `hooks/copilot-stop.js` sets `CREWS_ENGINE='copilot'` then delegates to shared `stop.js`.
- Related/adjacent tests: `tests/copilot-transcript-shape.test.js`,
  `tests/stop-allow-system-notification-boundary.test.js` (a recent system.notification
  exempts missing-kind ack turns — watch interaction with the new agent_completed notification).

## Architect Analysis (design)
The new sub-agent signal source is a NEAR-PERFECT MIRROR of the existing shell-async path:
| aspect | shell async (existing) | sub-agent (new) |
|---|---|---|
| start | tool.execution_start, toolName∈ASYNC_SHELL_TOOL_NAMES, args.mode='async', key=shellId | tool.execution_start, toolName∈ASYNC_SUBAGENT_TOOL_NAMES(['task']), args.mode='background', key=toolCallId (corroborated by subagent.started, same toolCallId) |
| done | system.notification kind.type='shell_completed', key=shellId | subagent.completed (ANY status), key=toolCallId (secondary: system.notification kind.type='agent_completed'/failed/cancelled, key=agentId) |
| false-done trap | tool.execution_complete returns shellId at launch — IGNORED | tool.execution_complete returns agent_id at launch (execution_mode='background', content "Agent started in background...") — IGNORED |

Design asymmetry (deliberate, all-lens consensus): the sub-agent path is STRICTER
than the shell path. The shell path's `compareTs`/`isActiveAt` bias missing/ambiguous
timestamps toward "keep active" (pass). The sub-agent path must FAIL TOWARD BLOCK:
count a sub-agent active ONLY on positive, correlated proof of an in-flight start
(recognized shape + parseable start.ts ≤ asOf) AND no recognized terminal event ≤ asOf.
Any terminal event (subagent.completed/failed/cancelled, or agent_completed/failed/
cancelled notification correlated to the start) ⇒ not active. Unparseable/unknown/
uncorrelated ⇒ contributes ZERO (block). This prevents the completed-but-forgotten
permanent false-pass.

## Probe Findings — see `probe-findings.md` (the decisive feasibility input)
Live read-only scan of THIS member's own Copilot transcript while a background
`task` Explore sub-agent ran start→done CONFIRMED all three D-002 preconditions:
pre-Stop START event (`subagent.started` + tool.execution_start toolName=task
mode=background), stable correlation key (`toolCallId`, present on both
`subagent.started` AND `subagent.completed`), and a visible correlatable DONE
signal in events.jsonl (`subagent.completed`, plus secondary
`system.notification agent_completed`). FEASIBILITY: D-002 is feasible; the
collapse-to-D-001 branch is not triggered by the planning probe (STORY 1 still
locks an impl-time fixture).

## Multi-lens consensus (Copilot gpt-5.4 + Codex gpt-5.5 + Claude probe)
- Keep `task` OUT of `SHELL_TOOL_NAMES`; add a new exported sub-agent tool-name set.
- Separate `indexSubagentEvents` path; additive return fields
  (`subagentActiveCount`/`subagentSamples`/`subagentDecision`); preserve existing
  `{activeCount,nonListenerCount,samples}` so shell tests stay byte-identical.
- Knob from `process.env.CREWS_PROGRESS_BG_SUBAGENTS` ONLY (off/probe/on, default off,
  invalid→off). NO parseTurnReports/tag/attribute/assistant-text path (preserves
  v3.3.0 no-self-attestation).
- `probe`: compute + log subagent decision, do NOT change the block decision.
- `on`: pass when `nonListenerCount + activeCorrelatedSubagents > 0`.
- `off`: byte-identical (no log/decision change).
- `CREWS_PROGRESS_BG_GATE=off` remains the whole-gate kill switch.
- Commit a redacted real fixture under `tests/fixtures/` + a test documenting the
  exact fields and correlation key. If probe disproves → STOP, mark D-002 infeasible → D-001.
