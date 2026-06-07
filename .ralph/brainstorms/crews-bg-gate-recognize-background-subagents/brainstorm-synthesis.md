Lenses: ran=[devils-advocate, codex, copilot]; skipped=[] (full mode — all three lenses produced usable output)

# Brainstorm synthesis — crews bg-gate recognize background sub-agents

**Task:** `crews-bg-gate-recognize-background-subagents` (crews-scoped)

**Problem.** The crews progress-bg gate (`hooks/stop.js` + `hooks/detect-active-bg.js`)
blocks a Copilot member's `kind=progress` when no async SHELL subprocess is
active (`tool.execution_start mode:async` correlated by `shellId` with
`system.notification shell_completed`). It does NOT recognize harness-spawned
background Task/sub-agents (Claude `Task`, Copilot `task`, codex
`spawn_agent`/`wait_agent`). A real impl member waiting on a background Phase-5a
review sub-agent was blocked from checkpointing, self-recovered by waiting
synchronously, and judged the block "correct but coarse." All three lenses agree
the v3.3.0 "no third category / complete by construction" claim is likely FALSE
for harnesses that expose async sub-agent spawning — but they diverge on whether
that makes the block WRONG, and on whether a detector can safely recognize a
sub-agent without reopening the idle-progress hole the gate was built to close.

The directions below are ordered multi-lens first, then by decision relevance.

---

### D-001: Keep the gate shell-only; force synchronous sub-agent waits (status quo + clearer policy)
- Contributing lenses: [devils-advocate, copilot, codex]
- Why this might work: The useful output of a Phase-5a review sub-agent is the
  RESULT, not "still running." A `kind=progress` checkpoint while a sub-agent runs
  is low-signal and (per crews semantics) often does not wake the lead, so the
  member gains little versus simply awaiting the sub-agent in-turn
  (`read_agent`/`wait_agent`) and reporting `kind=done`/`question`/`blocked` once a
  result exists. This is the smallest change (block-message wording + AGENTS.md
  policy + Ralph prompt guidance; NO detector code), preserves the
  no-self-attestation invariant completely, and keeps the member's control flow
  linear. Codex sized it effort S.
- Risks / friction: Preserves a known false-block for genuinely long sub-agent
  runs; members may have to sit through expensive review agents instead of
  yielding; if a harness imposes turn-length / token pressure during a long
  synchronous wait, the policy becomes impractical; members may hack around it by
  wrapping sub-agents in async shells (coupling crews to an implementation
  accident).
- Cheapest validation: Grep recent crews job logs for `progress-without-bg` blocks
  and check whether members self-recovered cleanly or wasted operator time — i.e.
  measure how often the false-block actually bites.
- Disconfirming observation: A real transcript showing a member with MEANINGFUL
  progress to report while a sub-agent legitimately runs (not soft-question
  idling), AND the harness guaranteeing a completion wake-up + a durable,
  correlated result handle — which would prove progress-then-resume is a real UX,
  not just parking a low-signal row.

### D-002: Gated, Copilot-first sub-agent detector with hard start→done correlation + CREWS_ escape hatch
- Contributing lenses: [devils-advocate, copilot, codex]
- Why this might work: Treats the harness sub-agent as the genuine "third
  category" of async bg work and adds it as a NEW detector signal source — exactly
  the v3.3.0-endorsed fix for a new bg modality ("extend the detector, never add a
  bypass"). Critically, it counts a sub-agent as active ONLY when a stable
  start→done correlation key exists (the analog of `shellId`: a Copilot `task`
  agent id with a known not-completed state), so a completed-but-forgotten
  sub-agent can NEVER become a permanent pass. Gated behind a new operator-only
  `CREWS_PROGRESS_BG_SUBAGENTS` knob (off / probe / on; default conservative),
  Copilot-only to match the gate's existing scope. Unknown completion shape ⇒ do
  not count (fail toward block, recoverable via `kind=question`/`done`),
  consistent with the gate's failure-open-toward-recovery bias. Codex sized it
  effort M.
- Risks / friction: Copilot's background-`task` event schema (does a background
  task even write a pre-Stop `tool.execution_start`? what is its completion
  event?) is undocumented and MUST be probed first. A start-without-a-visible-done
  signal fails in the worst direction (false-pass forever) unless correlation is
  airtight. Adds config surface — operators may not know whether a block is
  policy, missing-harness-support, or a detector bug. Default-on before schemas
  are proven risks making every background review spawn "a license to stop
  thinking" (DA red flag).
- Cheapest validation: Capture one real Copilot transcript each for a background
  sub-agent START, a still-running checkpoint, and COMPLETION; build a READ-ONLY
  detector probe that logs active/inactive WITHOUT changing gate behavior; compare
  its decisions against ground truth on one Phase-5a job before letting it block.
- Disconfirming observation: A Copilot probe shows background `task` calls do not
  write a `tool.execution_start` row before Stop, OR their completion has no stable
  correlation key analogous to `shellId`/`toolCallId` — making the
  no-self-attestation invariant unpreservable, which collapses D-002 back into
  D-001.

### D-003: Full engine-aware background-work detector refactor (all three engines)
- Contributing lenses: [codex]
- Why this might work: Generalizes the detector from "async shell only" to an
  engine-aware background-work abstraction covering Copilot `task`, Claude `Task`,
  and codex `spawn_agent`/`wait_agent`, reusing the existing harness-aware
  tool-mention seam (NOT a runtime translation adapter). Future-proofs the gate as
  crews extends across engines, and would also let the gate (today Copilot-only)
  cover Claude/codex members.
- Risks / friction: Largest blast radius — touches `detect-active-bg.js`,
  `stop.js`, `codex-shim.js`, `codex-stop.js`, `listener-protocol.js`. Claude/codex
  Stop inputs may not expose enough prior tool-use/tool-result history to
  correlate a spawn with its completion (codex Stop prefers the inline
  `last_assistant_message` over transcript parsing), so the needed signal might
  require engine/runtime changes outside crews scope. Premature before per-engine
  schemas are proven — D-002's probe is effectively a prerequisite.
- Cheapest validation: The same transcript-probe as D-002, but across all three
  engines, confirming each exposes a stable start→done key from the data crews'
  Stop hook actually receives (not from data it would need a runtime adapter to
  obtain).
- Disconfirming observation: A target engine's Stop input lacks the
  tool-use/tool-result history needed to correlate `Task`/`spawn_agent` with
  completion — meaning detection there is impossible without an out-of-scope
  runtime change.

---

## Recommendation

**Recommended: D-001** — the cheapest, most defensible default, and the only
option that touches zero detector code while fully preserving the
no-self-attestation invariant. All three lenses converge on it as the safe
baseline; the Devil's Advocate explicitly verdicts it "the cheapest and most
defensible default until there is proof that progress-then-resume on sub-agent
completion is a real, reliable UX," and Codex sized it effort S.

D-002 is the natural feasibility-gated FOLLOW-ON: if the operator values
sub-agent checkpointing enough to fund a Copilot transcript probe, and that probe
finds a stable start→done correlation key, D-002 adds the detector signal safely
behind a `CREWS_PROGRESS_BG_SUBAGENTS` knob. D-003 is the maximal all-engines
version of D-002 and should not be attempted before the per-engine probe proves
the signals exist. The directions are therefore largely sequential
(D-001 now → probe → D-002 → maybe D-003), not mutually exclusive — but the
operator should pick the immediate target.

## Open questions carried forward
- Does a `kind=progress` report while a sub-agent runs actually wake the lead /
  schedule a member resume, or does it merely park the session with a low-signal
  row? (If the latter, D-001 wins decisively.)
- What is the per-engine analog of `shellId` — the stable start→done correlation
  key — for Claude `Task`, Copilot `task`, and codex `spawn_agent`? And what exact
  event proves a sub-agent is done / failed / cancelled / consumed by
  `read_agent`/`wait_agent`?
- Should the fix stay Copilot-only (matching the current gate scope) or define a
  cross-engine contract now?
- Should unknown completion shapes fail toward BLOCK (don't count) rather than
  PASS (count forever), despite the gate's broader failure-open posture?
- Is a separate experimental env knob (`CREWS_PROGRESS_BG_SUBAGENTS=off/probe/on`)
  warranted, distinct from `CREWS_PROGRESS_BG_GATE=off`, so the model still cannot
  self-attest past the gate with tags (the v3.3.0 invariant)?
