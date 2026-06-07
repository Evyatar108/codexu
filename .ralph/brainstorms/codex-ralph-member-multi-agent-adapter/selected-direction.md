---
overviewTaskId: codex-ralph-member-multi-agent-adapter
---

## Direction
D-001 — Codex generated target emitting an explicit spawn→trigger→wait→collect recipe, gated by a result-retrieval spike. Extend ralph-orchestration's existing build-time harness-aware generator (`generate-copilot-artifacts.mjs`) with a third (codex) target that lowers one `Agent()` fan-out call into a structured codex multi-agent recipe plus injected when-to-delegate guidance — plugin-side only, no codex source patch, no bespoke runtime adapter — and gate the whole effort on a cheap result-retrieval feasibility spike (D-003).

## Goal
codex-engine Ralph members run NON-degraded multi-lens brainstorm/review (and review-loop fan-out) by reading codex-flavored skill/agent artifacts that the ralph-orchestration generator produces alongside the existing Claude (`.claude-plugin`) and Copilot (`.copilot-plugin`) artifacts. When a Ralph skill is loaded under codex, its fan-out instructions name codex's native sub-agent tools and walk the model through spawn → trigger → wait → collect → validate → close, instead of silently degrading to single-threaded because it only knows Claude `Task` / Copilot `task`.

## Scope
### In Scope
- A third generated harness target in `ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs` (and its parity/drift check) that emits codex-flavored artifacts from the canonical Claude `skills/` + `agents/` sources.
- A codex lowering of the `agent-dispatch` fan-out construct into an explicit **spawn_agent → followup_task → wait_agent → collect (via list_agents / message stream) → validate-JSON → close_agent** recipe block, with fail-hard (or mark-missing) behavior on child timeout / malformed JSON / task-name collision / orphaned agents.
- Injected **when-to-delegate trigger guidance** in the codex artifacts (codex is under-prompted: v1 actively gates spawning, v2 is silent).
- A **D-003 result-retrieval feasibility spike** as story 1 / go-no-go gate: enable `features.multi_agent_v2=true` for one codex member, spawn 2–3 children that must emit JSON, wait, retrieve each FULL final answer using only model-visible tools, force one timeout, validate fail-hard, and close — BEFORE committing to the generator refactor.
- Targeting the **codex 0.135** surface, **v2** (`spawn_agent`/`followup_task`/`wait_agent`/`list_agents`), coordinated with `codex-engine-ralph-member-enablement` for the `features.multi_agent_v2` toggle plumbing.
- **Seam owner: ralph-orchestration. Version-bump target: ralph-orchestration 5.52.0** (minor: new generated harness surface + behavior change, not breaking).

### Out of Scope
- Any patch to codex source / the `codex/` submodule (the leverage is plugin-side per both findings docs).
- A runtime translation adapter that intercepts and rewrites tool calls (explicitly ruled out by the operator steer).
- v137-specific multi-agent deltas (rebase-gated; only the 0.135 surface is in scope).
- The heavier engine-neutral delegation-macro refactor (D-002) — viable later/if per-target hand-tuning proves drift-prone, but not required for first enablement.
- Hand-authored codex skill copies with no generator gate (D-005) — drift liability.

## Criteria
- A codex feasibility spike demonstrates a parent codex 0.135 v2 member can spawn ≥2 lens children, wait, retrieve each child's FULL final answer as valid JSON using only model-visible tools, handle ≥1 induced timeout by failing hard or marking the lens missing, and close the agents — producing the same brainstorm artifact shape as Claude/Copilot. (If this FAILS, the build-time artifact layer is wrong → escalate to runtime-bridge or defer; the plan must encode this go/no-go.)
- `generate-copilot-artifacts.mjs --write` produces codex artifacts for the Ralph fan-out skills, and `--check` / the parity script passes with zero drift across all three harness targets.
- A codex Ralph brainstorm/review run (post-spike) executes multi-lens fan-out concurrently rather than single-threaded, with all lens outputs collected and synthesized (no placeholder/partial-synthesis silent loss).
- The codex artifacts inject explicit when-to-delegate guidance and a complete spawn→collect→close recipe (verified by reading the generated SKILL.md, not just token-gate pass).
- ralph-orchestration version bumped to 5.52.0 with CHANGELOG + AGENTS.md updated; no codex submodule change.

## Context
Both lenses (codex Feasibility-Mapper + Devil's Advocate) converged on three decision-shaping points:

1. **Seam located, right layer, wrong mechanism for a token-swap.** The seam is `plugins/ralph/scripts/generate-copilot-artifacts.mjs` — a build-time single-source generator (Claude canonical → Copilot generated via regex `SUBSTITUTIONS` + `assertNoForbidden` + `check-copilot-parity.mjs`; no runtime harness detection). Claude→Copilot works because `Agent`/`task` are near-isomorphic synchronous calls. **Codex is non-isomorphic** (`spawn_agent` returns a task-path, `wait_agent` returns only completed/timed-out, child output is out-of-band), so one `Agent()` call must lower to a multi-step recipe, NOT a one-line regex swap.

2. **The single load-bearing risk is RESULT COLLECTION, not spawn.** Top-level codex members already CAN spawn (the subagent gate only blocks depth-2). The gating unknown both lenses flag: can a parent codex model recover each child's full final JSON using only model-visible tools, or does it need app-server/event-stream code? Findings §7 independently recommends exactly this probe. Hence D-001 is **gated on the D-003 spike** — if collection needs out-of-band code, the build-time prompt layer is wrong.

3. **Under-prompting must be fixed in the emitted artifact.** codex v1 gates spawning to explicit user requests; v2 is silent. The codex block must inject delegation triggers, and the plan must confirm generated instructions escape v1's suppression (likely by mandating v2).

**Disconfirming observation to carry forward (DA):** the `assertNoForbidden`/parity checker only sees strings — a generated codex artifact can pass token checks yet be semantically wrong; correctness must be validated behaviorally (a real codex run collecting real lens JSON), not by the drift check alone.

**Open questions for planning:** v1-vs-v2 final call + where `features.multi_agent_v2` is set/verified (happy-cli `buildThreadConfig()` vs `~/.codex/config.toml`); timeout/collision/orphan policy (fail-hard vs mark-missing); whether to graduate to the D-002 engine-neutral macro now or after D-001 proves useful; whether the generator script should be renamed `generate-harness-artifacts.mjs` once it owns three targets.

**Prior art:** `.ralph/investigations/codex-upstream-multi-agent-v2-fork-impact/findings.md` (mechanism, async-vs-sync gotcha §7) and `.ralph/investigations/codex-subagent-prompt-trigger-investigation/findings.md` (under-prompting). Use only the codex 0.135 surface.

**Lens note:** the Copilot product lens was deliberately skipped this round for resource-safety (its `--read-only` guard double-snapshots both submodule trees into memory — the likely r1/r2 resource-death cause). Partial mode with codex + Devil's Advocate (2 usable, convergent lenses) supports this recommendation; the opportunity-cost/adoption axis is covered by D-004 (the null option).
