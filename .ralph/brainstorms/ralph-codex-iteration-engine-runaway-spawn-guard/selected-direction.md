---
overviewTaskId: ralph-codex-iteration-engine-runaway-spawn-guard
---

## Direction
D-001 — Codex-side no-collab / capped-collab iteration profile (root-cause, **spike-gated**), with **D-002 (copilot-default iterationEngine) adopted immediately as the interim safety net**. Give ralph single-story iterations a codex execution profile that disables/caps sub-agent spawning while preserving multi_agent_v2 for lens fan-out and codex members — mode separation is the tension resolution.

## Goal
A codex 0.135 iteration driving a ralph single-story implementation no longer rabbit-holes spawning runaway multi-agent sub-agents. Collaboration tools (v1 Collab + MultiAgentV2) are disabled or capped for the single-story iteration profile, while multi_agent_v2 stays available for brainstorm/review/lens fan-out and for codex crew members (the v5.53.0 adapter). In the interim, `iterationEngine=copilot` is the documented supported default for implementation iterations. End state: codex can be re-graduated to a supported iterationEngine once the spike + profile are verified.

## Scope

### In Scope
- A codex execution profile for ralph **single-story iterations** — the path through `src/ralph.mjs` `runEngineIteration` → `src/codex-exec.mjs` → `prompts/codex.md` — that **disables or caps sub-agent spawning** (v1 Collab + MultiAgentV2).
- Anti-spawn guidance baked into `prompts/codex.md` (advisory layer; the config-level disable is the load-bearing part).
- **The go/no-go spike as story 1** (mandatory, opens the plan): replay impl-adapter US-002 with collaboration disabled/capped — does the runaway stop and the story complete? — AND determine whether codex 0.135 exposes a **per-invocation knob** (a config flip / a `max_concurrent_threads_per_session=1`-style cap passable via `codex-exec.mjs`) vs needing a **rebase-gated fork patch**.
- **D-002 adopted immediately**: copilot as the supported impl `iterationEngine` default (interim safety net), regardless of D-001's outcome. **Plan decision to record:** does the schema/example **default** flip codex→copilot, or only the operating policy/docs?
- Preserve multi_agent_v2 for brainstorm/review/lens fan-out **and** for codex members — verified **mode separation**.

### Out of Scope
- **Surface B — the codex-exec lens exit124 stalls** — owned by the separate task **`ralph-codex-exec-default-timeout-too-short`** (these were largely premature reaps of healthy long xhigh runs, not true codex hangs).
- **Any wall-clock circuit-breaker on iterations** — operator hard rule: no short/low timeouts on the iteration path.
- **D-003 (ralph-side spawn-signal guard)** — FALLBACK only, pursued solely if D-001 requires a fork patch that is infeasible near-term. If built, it must be **spawn-signal based** (codex.exe child-process count / sidecar Collab spawn markers), **never a wall clock**.

## Criteria
- The go/no-go spike (story 1) is completed and recorded: replaying US-002 with collaboration disabled/capped either **stops the runaway and completes the story (GO)** or reproduces the stall (**NO-GO** → root cause is broader than sub-agent spawning, pivot).
- It is determined and documented whether codex 0.135 has a **per-invocation collaboration disable/cap knob** usable via `codex-exec.mjs`, vs needing a rebase-gated fork patch.
- A ralph single-story codex iteration demonstrably runs with sub-agent spawning **disabled/capped** while multi_agent_v2 **remains available** for lens fan-out and codex members (mode separation verified, not regressed).
- `iterationEngine=copilot` is the documented supported default for impl iterations; the **schema/example default decision** (flip vs policy-only) is made and recorded.
- **No wall-clock circuit-breaker** is added to the iteration path.

## Context

**Two surfaces, separated (answer to the seed's shared-root-cause question: NO).**
- *Surface A (this task):* the iteration-engine runaway Collab/multi_agent_v2 sub-agent spawn during a single-story iteration (impl-adapter US-002, ~10 min / ~383K tokens) — a genuine pathological codex behavior.
- *Surface B (separate task `ralph-codex-exec-default-timeout-too-short`):* the codex-exec lens exit124s were largely **premature reaps** by `codex-exec.mjs` `DEFAULT_TIMEOUT_MS=240000` (4 min), not true hangs. **Live evidence:** this brainstorm's own codex lens completed cleanly (exit 0).

**Repo grounding (confirmed this session).**
- Both the iteration AND the lens go through the same `src/codex-exec.mjs` wrapper (`resolveEngineScript` → `src/<engine>-exec.mjs`), so the v5.54.0 fd-backed-drain + tree-kill pipe-deadlock fix already covers the iteration path — confirming Surface A is *model behavior* (runaway spawn), not the fixed plumbing deadlock.
- `runEngineIteration` invokes codex-exec with `prompts/codex.md` and passes **no** collaboration-disabling flag.
- `codex-exec.mjs` already snapshots the process subtree and hard-kills via `taskkill /T /F` on timeout, so enumerating/**counting codex child processes is mechanically feasible** if the D-003 spawn-signal fallback is ever needed.
- Codex surfaces: v1 **Collab** (default ON/stock) and **MultiAgentV2** (opt-in, default OFF); `add_collaboration_tools` in `core/src/tools/spec_plan.rs` injects the tools; `scripts/codex-lowering.mjs` (v5.53.0) deliberately teaches codex *members* to spawn sub-agents for multi-lens work — the tension that mode separation resolves.

**Tension resolution.** "Spawn for lenses / members" vs "don't rabbit-hole during a single-story iteration" is reconciled by **per-profile tool exposure**: the iteration profile suppresses collaboration; the lens/member profile keeps multi_agent_v2.

**Open questions carried into planning.**
1. Does codex 0.135 expose a per-invocation collaboration disable/cap knob (passable via `codex-exec.mjs`), or is a rebase-gated fork patch required?
2. During the US-002 runaway, were Collab children visible as OS child processes, codex internal agents/transcript events, or only token usage? (Determines D-003 feasibility.)
3. Should the no-collab profile apply only to ralph iteration prompts while preserving multi_agent_v2 for lens fan-out and codex members?
4. Is the guard codex-version-specific (0.135 vs ≥137)? Will the next rebase change the feature/config surface?
5. Should the schema/example default flip from codex to copilot for `iterationEngine`, or only the operating policy/docs?
6. What evidence graduates codex back to a supported iterationEngine (N clean stories, no spawn events, a codex-side cap)?

**Lenses:** full mode — codex (Feasibility Mapper), copilot (Product-Reality Challenger), devils-advocate all ran and converged on this a/b/c shape; the Devil's Advocate reframe ("do not expose collaboration affordances to an iteration whose contract is one story") anchors D-001.
