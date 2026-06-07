---
overviewTaskId: crews-bg-gate-recognize-background-subagents
---

## Direction
D-002 — Gated, Copilot-first sub-agent detector with hard start→done correlation + CREWS_ escape hatch. Add a NEW detector signal source so a *pending* Copilot background `task` sub-agent counts as active background work for the progress-bg gate, but ONLY behind a stable start→done correlation key (a `shellId` analog) so a completed-but-forgotten sub-agent can never become a permanent pass — gated by `CREWS_PROGRESS_BG_SUBAGENTS`, Copilot-only, and preceded by a read-only transcript probe.

## Goal
After this lands, a crews member that has launched a Copilot **background** `task` sub-agent (e.g. a Phase-5a code-review agent) and is legitimately polling it can emit `kind=progress` while that sub-agent runs, instead of being forced into a synchronous in-turn wait. The progress-bg gate (`hooks/stop.js` + `hooks/detect-active-bg.js`) recognizes the pending sub-agent as a genuine third category of async background work — but recognition is conditioned on a stable, transcript-derived start→done correlation that proves the sub-agent is *still running at Stop time*. The change is operator-gated (`CREWS_PROGRESS_BG_SUBAGENTS=off|probe|on`, default `off`), Copilot-only (matching the gate's existing scope), and re-introduces **no** model-controllable bypass — the v3.3.0 no-self-attestation invariant is fully preserved. A real, captured Copilot transcript is a hard prerequisite: if the probe proves the required start event or correlation key does not exist, the task collapses back to D-001 (status-quo synchronous wait + clearer policy) rather than shipping an unsafe detector.

## Scope
### In Scope
- **Phase 0 — Copilot transcript probe (hard prerequisite).** A read-only investigation that captures the real event shape of a Copilot **background** `task` sub-agent across three moments: (a) START, (b) an in-flight checkpoint while it is still running, and (c) COMPLETION. Answer concretely: does a background `task` emit a pre-Stop `tool.execution_start` row (note: NOT a `bash`/`powershell` async shell)? What is its completion/consumption event? What is the stable correlation key (the analog of `shellId` / `toolCallId`) that links start→done? Persist the captured transcript as a fixture under the crews test corpus.
- **`CREWS_PROGRESS_BG_SUBAGENTS=probe` mode** — a read-only detector path that LOGS its active/inactive decision for a pending sub-agent WITHOUT changing gate behavior, so its decisions can be compared against ground truth on a real Phase-5a job before it is ever allowed to unblock a stop.
- **New detector signal source in `hooks/detect-active-bg.js`** for Copilot background `task` agents: count one as active **iff** a stable start→done correlation key exists AND the transcript shows that key in a not-completed state at Stop time.
- **`CREWS_PROGRESS_BG_SUBAGENTS` operator knob** with values `off` (default) / `probe` / `on`, operator-only (env var; the model cannot set it), explicitly parallel to `CREWS_PROGRESS_BG_GATE=off`.
- **Fail-toward-block semantics:** unknown / unrecognized / uncorrelated completion shape ⇒ do NOT count the sub-agent as active (block the `kind=progress`), recoverable by the member via `kind=question` / `kind=done` / `kind=blocked`. A start without a *visible, correlatable* done signal must never become a permanent pass.
- **Reuse of the existing harness-aware tool-mention / infra-filter seam** in `hooks/listener-protocol.js` (`SHELL_TOOL_NAMES` / `ASYNC_SHELL_TOOL_NAMES`, `isCrewsCliInfraCall`) to recognize the Copilot `task` tool name — NOT a runtime translation adapter.
- **Copilot-only scope**, matching the gate's current scope.
- Tests + crews `AGENTS.md` / `CHANGELOG.md` documentation of the new knob and the start→done-correlation invariant.

### Out of Scope
- Claude `Task` and codex `spawn_agent` / `wait_agent` detection — that is **D-003**, explicitly gated on this Copilot probe first proving that a per-engine start→done signal is even derivable from the data the crews Stop hook actually receives. Do not build the engine-aware abstraction here.
- Any runtime translation adapter between engines.
- Any new **model-controllable** bypass (tag, attribute, or summary form). v3.3.0 removed all 5 bypass-tag forms; this design must not resurrect a self-attest path.
- Changing the synchronous-wait fallback. With the knob `off` (default) or when correlation is absent, behavior is byte-identical to today's shell-only gate; D-001's "wait synchronously and report a real result" remains the safe default.
- Broadening the gate beyond Copilot, or touching `codex-shim.js` / `codex-stop.js`.

## Criteria
- A captured **real Copilot transcript fixture** exists showing a background `task` START event, an in-flight checkpoint, and a COMPLETION event, with the start→done correlation key identified — OR, if the probe shows there is no pre-Stop start event and/or no stable correlation key, the task is closed/escalated as "D-002 infeasible → collapses to D-001" instead of shipping a detector. (This is the disconfirming gate; it must be resolved before any gate-behavior change ships.)
- With `CREWS_PROGRESS_BG_SUBAGENTS=on` and a **correlated, still-running** Copilot background `task`, a member's `kind=progress` is **allowed** by the gate (unit test against the fixture).
- With the knob `on` but the sub-agent **already completed** (correlation resolves to done), `kind=progress` is **blocked** — proving no completed-but-forgotten sub-agent yields a permanent pass (unit test).
- With an **unknown / uncorrelated** completion shape, `kind=progress` is **blocked** (fail-toward-block; unit test).
- With `CREWS_PROGRESS_BG_SUBAGENTS=off` (default), gate behavior is **byte-identical** to the current shell-only detector (regression test).
- In `probe` mode the detector logs its decision but does **not** alter the stop outcome (unit/integration test).
- The model **cannot** flip the knob or otherwise self-attest past the gate from inside a turn — verified by confirming no tag/attribute/summary path reaches the new signal source (the env var is the only enable seam).
- `CREWS_PROGRESS_BG_GATE=off` still disables the whole gate exactly as before (unchanged regression).

## Context
**Why D-002 over the recommended D-001.** All three lenses (Devil's Advocate, Codex, Copilot) recommended **D-001** as the cheapest, most defensible baseline — it touches zero detector code and fully preserves the no-self-attestation invariant — and flagged D-002 as a feasibility-gated follow-on. The operator deliberately selected **D-002**: the *actual* detection feature, accepting the Phase-0 probe cost, because forcing a synchronous wait on an expensive background review agent is a real recurring friction and the "third category" of async work (a harness sub-agent that is genuinely running at Stop time and that the model can legitimately poll) is exactly what the v3.3.0 "complete by construction / no third category" claim missed. D-002 is the v3.3.0-endorsed *correct* fix for a new bg modality: **extend the detector with a new signal source, never add a bypass.**

**The structural-completeness premise that this disproves.** The detector header + v3.3.0 AGENTS.md assert that any genuine async background work is a shell subprocess at Stop time (hence a `tool.execution_start mode:async` row the detector sees), so "there is no third category." A Copilot background `task` agent is precisely that third category — async, pollable at Stop time, but NOT a shell subprocess and emitting no `tool.execution_start mode:async`. D-002 closes the gap by adding the sub-agent as a first-class signal source rather than weakening the gate.

**Folded-in open questions (now design constraints, not unknowns):**
- **Copilot transcript-probe is a prerequisite, not an afterthought.** The background-`task` event schema is undocumented; nothing ships until a real transcript proves the start event + correlation key exist. The `probe` knob value exists specifically so this can be validated read-only against ground truth before the detector is ever allowed to unblock.
- **Hard start→done correlation is mandatory.** A sub-agent counts as active ONLY with a stable correlation key (the `shellId` analog — a Copilot task/agent id with a known not-completed state). Airtight correlation is the whole safety argument; a start without a correlatable done is the worst failure mode (false-pass forever) and is therefore disallowed.
- **Unknown completion ⇒ don't count (fail toward block).** Consistent with the gate's failure-open-toward-*recovery* bias: blocking is recoverable (the member re-reports via `kind=question`/`done`/`blocked`); a permanent false-pass is not.
- **`CREWS_PROGRESS_BG_SUBAGENTS` is operator-only and distinct from `CREWS_PROGRESS_BG_GATE=off`.** Because the model cannot set env vars, an env knob is not a model-controllable bypass — it preserves the v3.3.0 invariant while giving operators an explicit off/probe/on dial. Default is conservative (`off`).

**Disconfirming observation (kill-switch for the whole direction).** If the Copilot probe shows background `task` calls do not write a `tool.execution_start` row before Stop, OR their completion has no stable correlation key analogous to `shellId`/`toolCallId`, then the no-self-attestation invariant cannot be preserved and **D-002 collapses back into D-001** — ship the status-quo synchronous-wait policy (clearer block-message wording + AGENTS.md guidance + Ralph prompt nudges) instead of an unsafe detector.

**Carried-forward question for planning (does not block D-002, informs UX weight).** Does a `kind=progress` report while a sub-agent runs actually wake the lead / schedule a member resume, or does it merely park the session with a low-signal row? If progress checkpoints are low-signal in crews semantics, the *value* of D-002 is bounded even if it is feasible — the plan should weigh this against the probe + detector cost. Sequence remains: D-001 baseline now → Copilot probe → D-002 detector → (only if proven across engines) D-003.

**Reference surface for planning.** `plugins/crews/hooks/detect-active-bg.js` (the detector — SIGNAL SOURCES + STRUCTURAL COMPLETENESS header subsections), `plugins/crews/hooks/stop.js` (the gate block right after the listener-armed `decideStopBlock`), `plugins/crews/hooks/listener-protocol.js` (`isListenerArmCall` / `isCrewsCliInfraCall` + `SHELL_TOOL_NAMES` / `ASYNC_SHELL_TOOL_NAMES` — the harness-aware filter seam to reuse), and the crews `AGENTS.md` v3.1.0 (gate intro, Copilot-only scope) / v3.3.0 (bypass removal + structural-completeness argument) / v3.4.0 (infra-filter broaden + lead-listener-unconditional) sections.
