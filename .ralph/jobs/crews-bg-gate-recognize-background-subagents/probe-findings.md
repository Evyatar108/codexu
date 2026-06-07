# Phase-0 probe findings (read-only, planning-time) — Copilot background `task` sub-agent

Source: live read-only scan of THIS plan member's own Copilot transcript
`~/.copilot/session-state/f080e21f-5ecf-4104-82ea-5b916162f383/events.jsonl`
while a background `task` Explore sub-agent (`crews-research`) was in-flight.
This is the cheapest-validation probe the brainstorm recommended. It is NOT the
STORY 1 deliverable (that requires an impl-time captured fixture + the actual
detector), but it de-risks feasibility and grounds the correlation-key design.

## Event-type inventory (256-line transcript)
hook.start/end, tool.execution_start (31), tool.execution_complete (29),
assistant.message/turn_start/turn_end, system.notification (9), user.message,
session.start, session.model_change, session.plan_changed, skill.invoked,
**subagent.started (1)**, system.message.

## START events for a background `task` sub-agent (BOTH keyed by `toolCallId`)
1. `tool.execution_start`:
   `{ toolCallId: "toolu_01AoG3...", toolName: "task",
      arguments: { name:"crews-research", agent_type:"explore", mode:"background",
                   description, prompt, ... }, model, turnId }`
   - NOTE: `arguments.mode === "background"` (NOT `"async"` like shell tools).
   - `toolName === "task"` is the Copilot tool name to recognize via the
     harness-aware seam (NOT bash/powershell).
2. `subagent.started`:
   `{ toolCallId: "toolu_01AoG3...",   // SAME id as the tool.execution_start
      agentName:"explore", agentDisplayName:"Explore Agent", agentDescription }`

=> **Stable start correlation key = `toolCallId`** (the `shellId` analog).
   The human task `name` ("crews-research") appears only in
   `tool.execution_complete.toolTelemetry.restrictedProperties.agent_id`, NOT in
   subagent.started; `agentName` is the agent TYPE ("explore"), not unique.
   `toolCallId` is the one stable key present on both start rows.

## FALSE-completion trap (the load-bearing safety finding)
`tool.execution_complete` for the task toolCallId **FIRES AT LAUNCH**, not at
sub-agent completion:
   `{ toolCallId:"toolu_01AoG3...", success:true,
      result.content: "Agent started in background with agent_id: crews-research.
                       You'll be notified when it completes...",
      toolTelemetry.properties.execution_mode:"background",
      toolTelemetry.restrictedProperties.agent_id:"crews-research" }`
=> A naive detector pairing tool.execution_start <-> tool.execution_complete by
   toolCallId would mark the sub-agent "done" the instant it launched — the SAME
   trap detect-active-bg.js documents for shell async (`tool.execution_complete`
   "fires when Copilot RETURNS the shellId", not at process exit). **The launch
   completion MUST NOT be treated as the done signal.**
   It IS distinguishable: launch-complete carries `execution_mode:"background"`
   AND `result.content` begins "Agent started in background with agent_id:".

## TRUE-completion signal — PIVOTAL UNKNOWN (capturing now)
At in-flight capture there was:
   - NO `subagent.completed` / `subagent.finished` event (sub-agent still running)
   - NO `system.notification` with a subagent-completion kind (the 9
     system.notification rows were all `shell_completed` (shellId-keyed) or
     `instruction_discovered`).
The completion event shape (and whether it carries `toolCallId`) is the decisive
feasibility input. `crews-research` is in-flight; will re-scan on its completion.

## Provisional feasibility verdict (pending completion capture)
- Pre-Stop START event: PRESENT (subagent.started + tool.execution_start
  toolName=task mode=background). ✅
- Stable start correlation key: PRESENT (`toolCallId`). ✅
- Visible, correlatable DONE signal at Stop time: **TBD** — if a
  `subagent.completed`/`*.finished` (or system.notification subagent kind)
  carrying `toolCallId` exists, D-002 is fully feasible. If completion is
  delivered ONLY out-of-band (never written to events.jsonl the Stop hook
  reads), then a started-but-never-visibly-done sub-agent is a permanent
  false-pass risk => the disconfirming case that collapses D-002 -> D-001.
  The detector's fail-toward-block rule and the `probe` knob mode exist
  precisely to validate this against ground truth before any gate-behavior
  change ships.

## COMPLETION CAPTURE (resolved the pivotal unknown) — D-002 IS FEASIBLE
On `crews-research` finish, TWO completion signals were written to events.jsonl:
1. `subagent.completed` (the clean, toolCallId-keyed DONE signal):
   `{ toolCallId:"toolu_01AoG3...",   // SAME id as subagent.started
      agentName:"explore", agentDisplayName:"Explore Agent",
      model:"gpt-5.4-mini", totalToolCalls:49, totalTokens:1371538,
      durationMs:106270 }`  (ts 05:45:54; started 05:44:07)
2. `system.notification { kind.type:"agent_completed", agentId:"crews-research",
      agentType:"explore", status:"completed", description, prompt }`
      — keyed by `agentId` (human name) + `agentType`, NOT toolCallId.

=> **Start->done correlation key = `toolCallId`, CONFIRMED present on BOTH
   `subagent.started` AND `subagent.completed`, both written durably to the
   events.jsonl the Stop hook reads.** This is a near-perfect mirror of the
   existing shell-async pairing (`tool.execution_start mode:async` <->
   `system.notification shell_completed`, keyed by `shellId`).

FEASIBILITY VERDICT: D-002 is FEASIBLE; the disconfirming/collapse-to-D-001
branch is NOT triggered by this probe. (STORY 1 must still re-confirm with an
impl-time captured fixture against a Phase-5a-style review sub-agent and lock
the shapes — but the read-only planning probe shows all three preconditions met.)

## Symmetry table the detector should mirror
| aspect        | shell async (existing)                                  | sub-agent (new)                                              |
|---------------|---------------------------------------------------------|-------------------------------------------------------------|
| start event   | tool.execution_start, toolName in ASYNC_SHELL_TOOL_NAMES, args.mode='async', key=shellId | tool.execution_start, toolName in ASYNC_SUBAGENT_TOOL_NAMES, args.mode='background', key=toolCallId (corroborated by subagent.started, same toolCallId) |
| done event    | system.notification kind.type='shell_completed', key=shellId | subagent.completed, key=toolCallId (secondary: system.notification kind.type='agent_completed', key=agentId) |
| false-done trap | tool.execution_complete returns shellId at LAUNCH — ignored | tool.execution_complete returns agent_id at LAUNCH (execution_mode='background', content "Agent started in background...") — ignored |

## Detector design implication (for the plan)
Recognize a pending sub-agent as active iff:
  (a) a `subagent.started` (or tool.execution_start toolName=task mode=background)
      with start.ts <= asOf exists for some `toolCallId`, AND
  (b) that `toolCallId` has NO correlatable COMPLETION signal at/<= asOf
      (where the launch-time tool.execution_complete with
      execution_mode=background is explicitly NOT a completion), AND
  (c) `CREWS_PROGRESS_BG_SUBAGENTS` resolves to `on` (probe mode logs only).
Unknown/uncorrelated/ambiguous shape => do NOT count (fail toward block).
