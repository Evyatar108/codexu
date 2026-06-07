# Stories Outline: Gated Copilot-first background sub-agent detector for the crews progress-bg gate (D-002)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. All stories are SERIAL (heavy file overlap; US-001 is a hard feasibility prerequisite). Target plugin: `ai-developer-toolkit/plugins/crews/` (v3.10.0 → 3.11.0). Plan-phase note: do NOT bump versions in the plan phase — that happens at impl ship.*

## US-001: Phase-0 Copilot transcript probe + committed fixture + feasibility decision (HARD PREREQUISITE)
**Description:** As a crews maintainer, I want a captured real Copilot background-`task` transcript and a documented start→done correlation key so that the detector is built against proven schema, not assumptions — and so the task collapses to D-001 if the schema turns out to be absent.
**Acceptance Criteria:**
- [ ] AC-1: A committed real (redacted) fixture `tests/fixtures/copilot-subagent-transcript.jsonl` shows a background `task` START (`subagent.started`), an in-flight checkpoint, and a COMPLETION (`subagent.completed`), with the `toolCallId` correlation key documented in `tests/fixtures/copilot-subagent-schema.md` (durable, plugin-shipped). The launch-time `tool.execution_complete` trap (fires at launch, `execution_mode:'background'`) is documented as launch-metadata-only.
- [ ] Attempt to also capture a cancelled/failed sub-agent; if it emits a terminal event, document its shape for US-003 to recognize; if it emits none, document the crash-no-completion residual handled by the optional TTL.
- [ ] If the capture shows NO pre-Stop start event and/or NO stable correlation key, STOP: produce a written "D-002 infeasible → collapses to D-001" decision artifact (clearer block-message wording + AGENTS.md policy guidance) and do NOT ship a detector.
- [ ] Typecheck passes (`node --check` on any new JS; fixture/doc are data/markdown).
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Harness-aware `task` tool-name seam + `CREWS_PROGRESS_BG_SUBAGENTS` knob parser
**Description:** As a crews maintainer, I want the Copilot `task` tool name recognized via the existing harness-aware seam (not a runtime adapter) and an operator-only env knob, so the detector stays consistent with the cross-engine tool-name convention and the v3.3.0 no-self-attestation invariant is preserved.
**Acceptance Criteria:**
- [ ] `hooks/listener-protocol.js` exports `ASYNC_SUBAGENT_TOOL_NAMES = new Set(['task'])` (Copilot-only; the D-003 extension point). `task` is NOT added to `SHELL_TOOL_NAMES`.
- [ ] A `parseSubagentMode(env)` helper resolves `process.env.CREWS_PROGRESS_BG_SUBAGENTS` to `'off'|'probe'|'on'` (default `off`; any other value → `off`). Read ONLY from env (no tag/attribute/summary/assistant-text path). (AC-7, AC-10)
- [ ] Unit tests: seam export pinned in `tests/listener-protocol.test.js`; knob parser covers off/probe/on/invalid/unset.
- [ ] Typecheck passes (`node --check`).
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Sub-agent signal source in `detect-active-bg.js` (truth-table detector)
**Description:** As a crews maintainer, I want a pure sub-agent signal source that counts a pending Copilot `task` sub-agent active only on positive correlated proof of an in-flight start, so a still-running sub-agent is recognized without ever producing a completed-but-forgotten permanent pass.
**Acceptance Criteria:**
- [ ] `indexSubagentEvents(events)` builds `subagentStarts: Map<toolCallId,{ts,…}>` (from `subagent.started` and/or `tool.execution_start` toolName∈ASYNC_SUBAGENT_TOOL_NAMES + `mode:'background'`) and `subagentTerminals: Map<toolCallId,{ts}>` (from `subagent.completed`, any status — the sole baseline terminal signal).
- [ ] `isSubagentActiveAt(start,terminal,asOf,ttlMs?)` implements the 7-row truth table (open live start ⇒ active; already-completed/malformed/future/uncorrelated/unknown/stale ⇒ not active). Takes an EXPLICIT `asOf` for deterministic unit tests.
- [ ] `tool.execution_complete` for `task` is treated as launch metadata only — never terminal (regression test: a launched sub-agent with only a launch-time `tool.execution_complete` is still ACTIVE).
- [ ] `detectActiveBg()` adds `subagentActiveCount`/`subagentSamples`/`subagentDecision` ONLY when the knob is `probe`/`on`; with `off`/unset the return object is deep-equal to the legacy `{activeCount,nonListenerCount,samples,asOf}` (no new keys). (AC-5)
- [ ] Optional stale-start TTL via `CREWS_PROGRESS_BG_SUBAGENT_TTL_MS` (default disabled).
- [ ] Unit tests cover every truth-table row with explicit `asOf`. Typecheck passes.
**Dependencies:** US-001, US-002
**Estimated complexity:** medium

## US-004: Wire the sub-agent signal into the `stop.js` gate behind the knob
**Description:** As a crews maintainer, I want the gate to consult the sub-agent signal only when the operator opts in, via a single combined-count decision, so AC-2 can pass while `off`/`probe` behavior stays identical to today.
**Acceptance Criteria:**
- [ ] The gate computes `effectiveActive = detection.nonListenerCount + (subagentMode==='on' ? detection.subagentActiveCount : 0)` and makes a SINGLE `if (effectiveActive === 0) block` decision (NOT block-on-shell-0-first-then-consult). (AC-9)
- [ ] `probe` mode COMPUTES + LOGS the sub-agent decision but adds 0 to `effectiveActive` (decision identical to `off`). (AC-6)
- [ ] The `progress-bg-gate` log line gains ` subagentMode=… subagentActive=…` ONLY when `subagentMode !== 'off'` (so `off` is byte-identical). (AC-5)
- [ ] `CREWS_PROGRESS_BG_GATE=off` still disables the whole gate. (AC-8) The knob reaches the gate ONLY via `process.env.CREWS_PROGRESS_BG_SUBAGENTS`. (AC-7)
- [ ] Typecheck passes (`node --check hooks/stop.js`).
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** medium

## US-005: Tests — unit + E2E + fixture-backed + `off` byte-identical regression
**Description:** As a crews maintainer, I want comprehensive coverage so every acceptance criterion is verified deterministically and the `off` path is provably unchanged.
**Acceptance Criteria:**
- [ ] Unit tests (explicit `asOf`) for `indexSubagentEvents`/`isSubagentActiveAt` covering all 7 truth-table rows, and `parseSubagentMode` (off/probe/on/invalid/unset). (AC-2..AC-4, AC-10)
- [ ] E2E Stop-hook tests (via `tests/lib/force-response.js::runStop`) following the existing shell pattern: still-running = start-only fixture (passes under `on`); completed = start+terminal-in-past (blocks under `on`); `probe` blocks an `on`-would-pass transcript; `off` byte-identical; combined-count ordering (shell-bg-only still passes; subagent-only passes under `on`). (AC-2, AC-3, AC-5, AC-6, AC-9)
- [ ] No-self-attestation test: a transcript with a bypass-shaped tag/assistant-text does not change the sub-agent decision. (AC-7)
- [ ] `off` deep-equality regression: `detectActiveBg()` return shape unchanged + no new log fields; existing shell scenarios unchanged. (AC-5)
- [ ] `node tests/run.js` (from `plugins/crews/`) passes. (AC-11)
**Dependencies:** US-001, US-002, US-003, US-004
**Estimated complexity:** medium

## US-006: Docs + version bump (plugin-local) + parent-repo ship bookkeeping
**Description:** As a crews maintainer, I want the new knob, the `toolCallId` correlation invariant, and the truth table documented, and the plugin version bumped, so consumers pick up the change and the codexu CI invariant stays satisfied.
**Acceptance Criteria:**
- [ ] `AGENTS.md` gains a `## v3.11.0 …` section (knob, `toolCallId` start→done correlation invariant, truth table, no-self-attestation preservation, off-byte-identical guarantee); `CHANGELOG.md` gains `## 3.11.0 - <date>`.
- [ ] `scripts/bump-version.js 3.11.0` applied (3 plugin manifests + 3 marketplace indexes + `tests/version.test.js`); `tests/version.test.js` green. (AC-11)
- [ ] Impl member commits plugin-local changes + bump on the submodule topic branch; does NOT edit codexu root `AGENTS.md`/`CLAUDE.md`.
- [ ] (Lead-owned at merge) codexu submodule-pointer bump + codexu root `AGENTS.md` active-plugin-versions table `crews 3.10.0`→`3.11.0` per `plugins/ralph/AGENTS.md` "Multi-repo wrapper-to-submodule ship ceremony". (AC-11)
**Dependencies:** US-001, US-002, US-003, US-004, US-005
**Estimated complexity:** small
