Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode — all three lenses produced usable JSON)

# Brainstorm synthesis — ralph-codex-iteration-engine-runaway-spawn-guard

> **Halts at Phase 4 (user-gated).** This file + `brainstorm.json` are the deliverables. No `selected-direction.md` is written until the operator/lead picks a direction ID.

## Scope (after lead scope-update)

This brainstorm owns **the genuine pathology: the codex iteration-engine RUNAWAY COLLAB SPAWN guard** (detection signal + cap/abort/prevention). The codex-exec **timeout raise is OUT of scope** — it is filed as its own dedicated task, **`ralph-codex-exec-default-timeout-too-short`** — and is only *referenced* here as context.

## The reframe that defines the scope split: TWO separate surfaces, not one

The seed asked whether the **iteration-engine runaway-spawn hang** and the **codex-exec lens exit124 stall** share a root cause. They do **not**:

- **Surface A — iteration-engine RUNAWAY COLLAB SPAWN (THIS task's REAL bug).** codex 0.135 driving a ralph single-story iteration (impl-adapter / codex-ralph-member-multi-agent-adapter US-002) rabbit-holed spawning runaway multi-agent (Collab / multi_agent_v2) sub-agents — ~10 min, ~383K tokens — and burned tokens without converging. A genuine pathological codex behavior.

- **Surface B — codex-exec lens exit124 (OUT of scope; owned by `ralph-codex-exec-default-timeout-too-short`).** The exit124s on plan-crash, plan-agentcomms, and this brainstorm's own codex lens were **largely premature reaps** by `codex-exec.mjs` `DEFAULT_TIMEOUT_MS=240000` (4 min, `codex-exec.mjs:66-72`), not codex hanging. Fix = raise the default to ≥ 20 min and re-validate the "~300s caller harness tool-timeout" premise (under Copilot CLI, async shell commands background — there is no 300s hard kill — so the low default may be solving a Claude-Code-only constraint). **Tracked separately; mentioned here only to confirm the runaway-spawn is the REAL codex-iteration problem.**

**Live evidence collected this run:** this brainstorm's own codex lens **completed cleanly (exit 0)** with valid JSON — it did not stall — corroborating that the lens path is not deterministically broken and that the exit124s are reap artifacts, not true hangs.

**Answer to the seed's question: NO, they do not share a root cause.** They were conflated only because both present as "codex exit124 / didn't finish." Surface A is active runaway sub-agent spawning (this task); Surface B is passive premature reaping (separate task).

## Operator / lead directives folded in

1. **Timeout policy (hard rule):** NEVER use a short timeout on a codex (or any agent) lens/iteration; agents legitimately run long. **A wall-clock circuit-breaker on iterations is therefore OUT** — any runaway-spawn guard in this task must use a **spawn signal**, not a low wall clock. (Generous ≥ 20-min backstops belong to the separate timeout task.)
2. **Keep the two fixes cleanly separated:** the timeout raise (Surface B) is `ralph-codex-exec-default-timeout-too-short`; this task is the runaway-spawn guard (Surface A) only.

## Repo grounding (confirmed this session)

- `iterationEngine` is resolved in `src/ralph.mjs` `resolveEngine(parsed.engine, prdJson.iterationEngine)`; valid `codex | copilot | claude` (claude deprecated → copilot). The per-engine iteration prompt template is `prompts/<engine>.md` — `prompts/codex.md` is the codex iteration prompt (the anti-spawn-guidance surface).
- **Both the iteration AND the lens go through the same `src/codex-exec.mjs` wrapper** (`resolveEngineScript` → `src/<engine>-exec.mjs`). So the v5.54.0 fd-backed-drain + tree-kill pipe-deadlock fix already covers the iteration path — confirming Surface A is *model behavior* (runaway spawn), not the already-fixed plumbing deadlock.
- `runEngineIteration` invokes codex-exec with `--prompt prompts/codex.md --output … --effort medium --section "## prd.json" <prd>`; it passes **no** collaboration-disabling flag and **no** `--timeout-ms`.
- `codex-exec.mjs` already snapshots the process subtree and hard-kills via `taskkill /T /F` on timeout — so enumerating/**counting codex child processes is mechanically feasible** in the wrapper if a spawn-signal guard is wanted.
- Codex surfaces: v1 **Collab** (legacy, default ON / stock) and **MultiAgentV2** (opt-in, default OFF). `add_collaboration_tools` in `core/src/tools/spec_plan.rs` injects the tools; `scripts/codex-lowering.mjs` (shipped v5.53.0) deliberately makes codex *members* spawn sub-agents for multi-lens work — in direct tension with suppressing spawning during a single-story iteration. **Mode separation (per-profile tool exposure) is the way to reconcile "spawn for lenses" with "don't rabbit-hole in an iteration."**

---

## Candidate directions

### D-001: Codex-side no-collab / capped-collab "iteration profile" (root-cause prevention) — RECOMMENDED
- Contributing lenses: [codex, copilot, devils-advocate]
- **What:** Give ralph single-story iterations a codex execution profile that **disables or caps** sub-agent spawning (v1 Collab + MultiAgentV2) — while **preserving** multi_agent_v2 for brainstorm/review/lens fan-out and for codex *members* (the v5.53.0 adapter). Prefer a per-invocation config override codex 0.135 already supports (a config/feature flip, or a `max_concurrent_threads_per_session=1`-style cap passed at `codex exec` time via `codex-exec.mjs`); fall back to a small codex patch only if no such knob exists. Pair with explicit anti-spawn guidance baked into `prompts/codex.md`.
- **Why this might work:** Removes the *affordance* that lets a one-story/one-agent/one-commit iteration decide to "collaborate." Devil's Advocate reframe: the real surface is "do not expose collaboration affordances to an iteration whose contract is a single story." Mode separation resolves the spawn-for-lenses-vs-don't-rabbit-hole tension. This is what graduates codex back to a *supported* iterationEngine, which the codex-as-default-member readiness chain needs (policy-only leaves it blocked).
- **Risks / friction:** Depends on whether codex 0.135 exposes a per-invocation collaboration toggle, or whether a fork patch (rebase-gated) is required. A prompt-only anti-spawn instruction is advisory — the model can still choose to spawn; the **config-level disable is the load-bearing part**.
- **Cheapest validation (the go/no-go spike — must be story 1 of any plan):** Replay the impl-adapter US-002 story with collaboration disabled/capped; if the runaway does not recur and the story completes, Surface A is collab-spawn-caused and the profile is the fix. Simultaneously answer: does a 0.135 per-invocation knob exist, or is a patch needed?
- **Disconfirming observation:** If a codex exec with Collab disabled / `max_concurrent_threads_per_session=1` *still* reproduces the iteration stall on a focused story, the root cause is broader than sub-agent spawning and D-001 only addresses one symptom.

### D-002: Policy — Copilot as the supported impl iteration engine, codex non-iteration-only (interim default, already in effect)
- Contributing lenses: [codex, copilot, devils-advocate]
- **What:** Formalize `iterationEngine=copilot` as ralph's documented/default implementation iteration engine; mark codex as research/review/lens engine (safe once the separate timeout task lands) unless an explicit opt-in selects codex for implementation. Surfaces: `skills/*/SKILL.md`, `schemas/prd-schema.json` default, `CHANGELOG.md`, `.ralph-overview/data.json`, `docs/fork-roadmap.md`.
- **Why this might work:** Zero-code, zero-risk; already the de-facto state (impl-async and the adapter member both switched to copilot to recover). Buys safety while D-001 is designed/validated.
- **Risks / friction:** Default-safe but can *mask* the root cause; creates a split-brain engine story; leaves the codex-as-default-member chain blocked because a codex member that drives an iteration still hits Surface A. Pair with D-001, not a terminal answer.
- **Cheapest validation:** Run the next 3–5 ralph impl tasks with `iterationEngine=copilot`; record completion rate / manual interventions.
- **Disconfirming observation:** If copilot iterations also stall or need comparable intervention, the problem is not codex-specific and policy buys little.

### D-003: Ralph-side runaway-spawn guard — containment only, SPAWN-SIGNAL based, NOT a wall clock
- Contributing lenses: [codex, copilot, devils-advocate]
- **What:** If prevention (D-001) is incomplete or a 0.135 knob doesn't exist, add a *diagnostic-first* guard in `codex-exec.mjs`/`ralph.mjs` that detects runaway spawning via a **spawn signal** — codex.exe child-process count (the wrapper already enumerates the subtree) and/or parsing sidecar Collab spawn markers (CollabAgentSpawnBegin/End) — and aborts only on a clear runaway. **Per operator directive this must NOT be a low wall-time timeout.**
- **Why this might work:** Bounds blast radius / token spend and prevents orphaned processes even if codex-side gating is imperfect. A spawn-count signal targets Surface A specifically without false-positiving on legitimately long iterations.
- **Risks / friction:** Requires the runaway be observable from outside the codex process (OS child processes vs internal agents vs only token usage — unknown; see open questions). Thresholds risk being codex-version-fragile; killing a mid-commit iteration can leave partial branch state that looks like normal partial progress. Devil's Advocate: "containment, not correctness" — do not advertise it as making codex reliable.
- **Cheapest validation:** Diagnostic-only run wrapper that *logs* child-agent count / last event type during the known-problem story without changing abort behavior — confirm the signal is observable and clean before gating on it.
- **Disconfirming observation:** If the runaway is invisible at the OS/sidecar layer (only token burn rises), ralph cannot detect it from the wrapper and D-003 collapses to a wall-time backstop — which is out per the timeout directive.

---

## Recommended direction

**D-001 (codex-side no-collab iteration profile)** — it fixes Surface A (the real bug) at its root and is the prerequisite that graduates codex back to a supported iterationEngine for the codex-as-default-member chain. Its plan **must open with the go/no-go spike**: replay US-002 with collaboration disabled + determine whether a per-invocation knob exists on codex 0.135 vs needing a (rebase-gated) fork patch. If a patch is required and infeasible near-term, fall back to **D-003** (spawn-signal guard) with **D-002** (policy: copilot default) as the interim safety net. D-002 is cheap and already de-facto, so adopt it immediately regardless. Surface B (lens exit124) is handled by the separate `ralph-codex-exec-default-timeout-too-short` task.

## Open questions to carry into planning
1. Can ralph pass an existing **per-invocation codex config override** to disable/cap collaboration on **0.135**, or does it require a fork patch (rebase-gated)?
2. During the US-002 runaway, were Collab children visible as **OS child processes**, **codex internal agents/transcript events**, or **only token usage**? (Determines whether D-003's spawn-signal detection is even feasible.)
3. Should the no-collab profile apply **only** to ralph iteration prompts while preserving multi_agent_v2 for lens fan-out and codex members? (The tension resolution.)
4. Is the guard codex-version-specific (0.135 vs ≥137)? Will the next rebase change the feature/config surface?
5. Should the schema/example **default** flip from codex to copilot for `iterationEngine`, or only the operating policy/docs?
6. What evidence graduates codex back to a supported iterationEngine (N clean stories, no spawn events, a codex-side cap)?
