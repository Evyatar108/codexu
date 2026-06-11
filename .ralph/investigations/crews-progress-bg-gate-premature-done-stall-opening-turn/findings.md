# Investigation - crews progress-bg gate premature `done` stall (Copilot opening turn path)

**Task:** `crews-progress-bg-gate-premature-done-stall-opening-turn`  
**Mode:** READ-ONLY investigation (no crews source edits)  
**Date:** 2026-06-11  
**Plugin source root:** `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews`

---

## Verdict

The stall mechanism is real and rooted in a **gate-coerced terminal report**:

1. `hooks/stop.js` blocks Copilot member `kind=progress` when effective active background work is zero and emits a reason that explicitly offers `kind=done` as the turn-ending alternative (`hooks/stop.js:1182-1208`, reason at `:1205`).
2. `plan-prevention` received that exact block reason in-session (`events.jsonl` line `173`) and then emitted premature terminal `done` (`line 175`) with the "acknowledged kind usage constraint" summary.
3. Terminal rows (`done/question/blocked`) are proactively routed to the lead mailbox (`hooks/stop.js:1483-1527`), not to self.
4. With no further inbound message and no long-lived background completion to trigger another active cycle, the member idles indefinitely until externally nudged.

So the root cause is **not engine hijack** (both manifests stayed `engine: copilot`) and not the codex gate-port task. It is a Copilot stop-hook interaction: progress gate -> premature terminal `done` -> no automatic self re-wake path.

---

## Findings by requested question

### 1) Progress-bg gate behavior (when it blocks/forces terminal choices)

- Gate condition: `gateEnabled && isCopilot && isProgress && isMember && !isRetry && !isShuttingDown` (`hooks/stop.js:1182-1187`).
- It reads transcript liveness via `detectActiveBg(...)` (`:1189-1194`) and blocks when `effectiveActive === 0` (`:1204`).
- Block reason text (exact):  
  `kind=progress requires active background work (open subprocess). Use kind=question + reply-to to wait on the lead, kind=done to complete this turn, or kind=blocked to surface a problem.` (`hooks/stop.js:1205`).
- What counts as active bg for Copilot: async shell starts from `tool.execution_start` (`bash`/`powershell`, `mode="async"`) and exits from `system.notification` `shell_completed` (`hooks/detect-active-bg.js:14-30`, `:147-173`, `:399-423`), with crews infra calls filtered out (`:407-413`).

### 2) Origin of the acknowledged kind-usage guidance

The acknowledged wording **does not originate verbatim** from crews prompts or stop text.  
The source guidance is the stop block reason above (`hooks/stop.js:1205`), injected into transcript (`plan session events line 173`), and the member then paraphrased it as:

- "I'll use `progress` only when there is an active subprocess and otherwise end non-working turns with `done`..." (`plan session line 175`).

So `"end non-working turns with done"` is model paraphrase, not literal crews copy.

### 3) Transcript divergence (`plan-prevention` vs `bs-prevention`)

**plan-prevention (`0ef25c80...`)**
- `/plan-with-ralph` was invoked before premature done (`tool skill start line 11`, `skill.invoked line 33`, skill-context line `34`).
- Lens/review work had already run earlier (`"Lenses: ran=[...]"` in tool result line `49`).
- Then later the gate reason was injected (`line 173`) and premature done emitted (`line 175`).
- A later wake-nudge path is visible when lead-direction message re-enters and skill is reinvoked (`lines 210-234`).

**bs-prevention (`92d49ed5...`)**
- No matching premature-done artifact ("acknowledged kind usage constraint") found.
- Recorded `done` is the final completion report (`line 684`, commit `3b0fb109`).
- Brainstorm lens activity appears before completion (`line 520` includes `Lenses: ran=[devils-advocate, codex, copilot]`).

**Conclusion:** the "both had identical premature-done artifact" claim is not supported by this transcript capture. The plan stall case is confirmed; bs case appears to have completed without that opening-turn done pattern.

### 4) Why terminal `done` does not re-wake while bg completion does

- Terminal member rows are delivered to lead via proactive mailbox routing (`hooks/stop.js:1483-1527`), so the member does not get a self-directed trigger from its own `done`.
- Listener wake behavior is mailbox-delivery driven (`listener-loop.js:444-489`); no new mailbox delivery to that member => no listener-driven wake.
- Background process completion is a separate runtime signal (`system.notification` with `shell_completed`) used by bg-liveness detection (`detect-active-bg.js:27-30`, `:163-173`) and can create a new interaction cycle.

This difference explains the permanent idle after premature terminal `done` when no further completion/message arrives.

### 5) Distinct from `crews-codex-progress-bg-gate-stall-detection`

Distinct tasks in overview data:
- Codex-port task: `crews-codex-progress-bg-gate-stall-detection` (`.ralph-overview/data.json:6653`).
- This task: `crews-progress-bg-gate-premature-done-stall-opening-turn` (`.ralph-overview/data.json:7289`).

The former is engine-porting; this investigation is Copilot opening-turn premature-terminal behavior.

---

## Recommended fix (primary + tradeoffs)

### Primary recommendation: **(a) reject premature `done` with no task progress evidence**, then re-prompt to continue

Implement in `hooks/stop.js` near terminal handling (`:1483+`) as a member-only guard:

- If latest terminal kind is `done`,
- and there is no actionable progress evidence since the current assignment cycle (e.g., no non-infra work artifacts/outbox progress rows for the assigned task in this cycle),
- then `decision: block` with explicit reason: "You have not started/completed the assigned task yet; continue execution (invoke assigned skill or perform next work step), do not end this turn with done."

Why primary:
- It directly prevents the stall-producing transition (premature terminal `done`).
- It remains effective even when skill invocation has already happened (as in `plan-prevention`), so it covers broader "premature done" shapes.
- It is engine-local to crews stop policy and does not depend on spawn orchestration changes.

Tradeoffs:
- Requires a precise "progress evidence" predicate to avoid blocking legitimate no-op done turns (e.g., explicit cancel/lead stop scenarios). Keep existing `shutdownRequested`/retry escape semantics intact.

### Secondary mitigations

- **(d) Reword progress-bg block reason** (`hooks/stop.js:1205`) to avoid implicitly steering unfinished members toward terminal done.  
  Helpful but advisory only; model may still choose done.
- **(b) Spawn auto-invokes assigned skill** can reduce opening-turn drift, but does not eliminate this failure mode (plan case already had prior skill invocation).
- **(c) Opening-turn exemption for done-eligibility/progress gate** lowers false coercion risk but can re-open stale idle-progress behavior the gate was introduced to close.

---

## Story outline / effort

1. **Story 1 - Stop guard for premature done (core)**  
   Add member `done` premature-completion blocker with clear remediation text; preserve shutdown/retry escapes.
2. **Story 2 - Reason-text hardening**  
   Adjust progress-bg gate reason so unfinished workers are directed to continue work, not to prefer terminal completion.
3. **Story 3 - Regression tests**  
   Add stop-hook tests for: (a) gate block -> paraphrased premature done blocked, (b) valid done after real work allowed, (c) shutdownRequested still allows done.

