Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

# Brainstorm synthesis — close the codex-member Skill()/Agent() subagent fan-out gap in /implement-with-ralph

Full mode: all three lenses ran (codex Feasibility-Mapper, Copilot Product-Reality, Devil's Advocate). All three independently verified the residual gap against source and **converged on the same recommended direction (Hybrid, D-001)**, the same go/no-go prerequisite (a cheap write-capable-helper-in-worktree smoke), and the same single load-bearing operator decision (may codex-default depend on a Copilot/Claude helper for the clean-context write/review phases?).

## Why the merged prior art does NOT already cover this path (source-verified by all three lenses)

The shipped adapter `codex-ralph-member-multi-agent-adapter` (ralph **v5.53.0**, `scripts/codex-lowering.mjs` + `generate-copilot-artifacts.mjs --target=codex`) was scoped to the **read-only multi-lens brainstorm/review fan-out** and validated by the D-003 spike, which was GO **only for a read-only lens that returns JSON**. The `/implement-with-ralph` PRD-gen + Phase 5a/5b reviewer-convergence path is uncovered for four concrete, source-cited reasons:

1. **The recipe contract is JSON-lens-shaped, not write-subagent-shaped.** `singleDelegationRecipe` (codex-lowering.mjs:273-315) ends with `list_agents -> agents[].agent_status.completed` then **`JSON.parse the recovered message; reject if it does not parse`** (L300-302). That fits a lens returning a JSON blob; it does **not** fit `code-fixer`/`docs-updater`, whose real output is a **file edit + git commit**, nor `convert-to-ralph-prd`'s PRD write. (codex lens + copilot lens + DA all confirmed.)
2. **The code/docs REVIEWERS are entirely invisible to the generator.** `review-changes` invokes them via **prose** ("Spawn an Agent subagent", review-changes SKILL.md:113-124) with **no literal `Agent(` token**, while `codex-lowering` only scans the `Agent(` token (codex-lowering.mjs:86-93). So `code-reviewer`/`docs-reviewer` are **not in `AGENT_SITE_INVENTORY`** (L68-81) and are not lowered at all. (DA disconfirming observation, re-verified by codex lens.)
3. **Spawned-child worktree/commit semantics for WRITE subagents are unvalidated.** The D-003 spike only validated read-only JSON lenses. Whether a `spawn_agent` child (`fork_turns:"none"`, clean context) shares the parent's worktree cwd, can run write/shell tools under the member launch config, persists edits, and commits so the parent sees them after `close_agent` — is **never probed**. This is the write-side analog of the D-003 unknown.
4. **`features.multi_agent_v2` enablement for a crews codex member is unplumbed** (default OFF) — the prior adapter explicitly **deferred** it to `codex-engine-ralph-member-enablement`. The recipe's preflight says STOP when the v2 tools are absent; the 2026-06-09 dogfood member did **not** stop, it **inlined** — so the preflight is being read as advisory prose.

**Bonus disconfirming finding (DA, source-cited):** the shipped read-lens recipe itself may be **schema-stale** — it emits `spawn_agent { task_name, fork_turns }` with **no `message`** (codex-lowering.mjs:287-296), but v2's `spawn_agent` schema requires `message` (multi_agents_spec.rs:100-103; spawn.rs:251-260). Worth a separate small fix and a reason NOT to mechanically extend the existing recipe to write subagents.

## Candidate directions

### D-001: Hybrid — write/reviewer subagents via copilot-exec.mjs CLI shell-out; keep read-only lens fan-out on spawn_agent
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: When `engine=codex`, lower the **write / context-isolation-critical** Agent() sites (`code-fixer`, `docs-updater`, `criteria-validator`, `repo-detector`) AND the prose reviewer sites (`code-reviewer`, `docs-reviewer`) to a **`copilot-exec.mjs` CLI shell-out** (model `claude-opus-4.7-1m-internal`) running **in the member's work_dir** — reusing the **proven** wrapper that already edits files + commits, already powers the codex/copilot review lenses, and already backs the copilot iteration engine (copilot-exec.mjs:239-241,344-347; ralph.mjs:945-968). Keep the **read-only parallel LENS fan-out** (brainstorm + Phase-5.5 retrospective trio) on the already-shipped `spawn_agent` recipes. Sidesteps the unvalidated spawn-child write semantics AND the v2-enablement plumbing for the write path.
- Risks / friction: Makes codex-default **depend on the Copilot CLI** for the decisive write/review phases — the single strategic objection all three lenses name. Adds Copilot availability/model-access/timeout/log dependencies. The dogfood must measure that the codex member still owns enough (top-level orchestration + iteration engine + read-only lenses) to justify "codex-default."
- Cheapest validation: Replace ONE Phase 5a fixer/reviewer slot in a locally-generated codex artifact with a `copilot-exec` write-mode helper; run a tiny Ralph job; assert the findings/artifact/commit appears **without the parent doing it inline**. (Effort rated **L** by the codex feasibility lens vs XL for D-002/D-003.)
- Disconfirming observation: a live codex-member smoke cannot run `copilot-exec` in the target `work_dir` with write perms, produce a committed edit plus parseable `<review-meta>`/JSON, and leave parent-visible files after the helper exits.

### D-002: Extend codex lowering with native WRITE-subagent spawn_agent recipes (gated on a write-child smoke)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Highest codex-purity — map the write/edit/reviewer sites to `spawn_agent` with a collection contract that handles **file edits + commits** (combine `<review-meta>`/JSON with `git commit`/`diff` checks, not `JSON.parse` of the final message alone), add the `review-changes` reviewer sites to `AGENT_SITE_INVENTORY`, and plumb `features.multi_agent_v2` enablement for crews codex members.
- Risks / friction: Effort **XL**. Blocked on the **unvalidated** spawn-child worktree/commit semantics; needs the schema-stale recipe fixed first; v2-enablement must be made non-advisory and scoped to not affect non-Ralph codex sessions.
- Cheapest validation (the decisive go/no-go for native): a tiny `spawn_agent` write-child probe in a temp git worktree — parent spawns child with `fork_turns:"none"`, child edits a file and commits, parent verifies the commit/file from its cwd, then `close_agent`. **Do not touch Ralph until this passes.**
- Disconfirming observation: the child does not share the intended cwd/git worktree, cannot run shell/write tools under the member launch config, or its edits/commits are not visible to the parent after `close_agent`.

### D-003: Codex-native phase rewrite for PRD generation and review convergence
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Restructure the affected phases (make `review-changes` emit explicit artifact-producing subprocess steps) around codex-native orchestration when `engine=codex`, rather than per-Agent-site lowering.
- Risks / friction: Effort **XL** and **highest drift risk** — creates a parallel codex-specific implementation of PRD-gen + review convergence that must stay aligned with the Claude/Copilot paths on review persistence, group-mode `context_dir`, retry-before-fallback, and orchestrator resume semantics. Still needs the same live write-side spawn_agent proof as D-002.
- Disconfirming observation: the prototype must duplicate enough skill semantics that generator drift tests cannot keep the codex fork aligned over future plugin versions.

### D-004: Accept manual/local finalization with a hardened evidence protocol (interim waiver — null/fallback)
- Contributing lenses: [devils-advocate]
- Why this might work: Cheapest. A labeled, degraded waiver while a real fix lands.
- Risks / friction: **Not gate-closing.** Quantified coverage loss: code-review keeps the external Codex/Copilot CLI signal, but **docs-review loses its ONLY independent reviewer** (no CLI docs lens — it is purely the `docs-reviewer` Agent), and PRD-gen loses clean-context criteria validation. A member reviewing its own work in its own context is the classic fox-guarding-henhouse loss of independent-reviewer signal — unacceptable as the gate for re-enabling codex as the **default** engine.
- Disconfirming observation: stakeholders accept "codex-default" with self-reviewed docs and self-scaffolded PRDs (they should not).

## Recommendation

**D-001 (Hybrid)** is recommended by all three lenses, is the only **L**-effort option, closes the gate at the lowest risk, and is consistent with the operator's current posture (impls already run on copilot for reliability per the `CREWS_ENGINE` revert). It does **not** defeat the purpose of a codex member: codex still owns the top-level member, the per-story iteration engine (the bulk of the work), and the read-only lens fan-out; only the clean-context **write/review** subagents are delegated to `copilot-exec`. **D-002 is the future codex-purity graduation**, explicitly gated on the cheap `spawn_agent` write-child smoke. **D-004 is the fallback** only if D-001 proves infeasible.

## Open questions to carry forward to planning
1. **(Operator decision — load-bearing)** May "codex-default" depend on a Copilot/Claude helper for clean-context write/review phases, or must every subagent be codex-native? All three lenses pivot on this. (If "must be native" → D-002 first, gated on the write-child smoke.)
2. Should helper outputs be normalized to the existing Agent contracts (`<review-meta>`, criteria-validator JSON, repo-detector single path), or should the codex workflows read helper output files directly?
3. What git + transcript evidence is sufficient to prove the member did **not** inline PRD-gen or review convergence? (the dogfood's pass/fail signal)
4. Fix the schema-stale shipped recipe (`spawn_agent` emitted without the required `message`) — verify against multi_agents_spec.rs:100-103; file as a separate small bug.
5. Where is `features.multi_agent_v2` enabled for crews codex members (needed even under D-001 so the retained read-only lens fan-out actually runs on a codex member)?

## What a successful codex-default re-enable dogfood looks like
A single codex crew member runs a **full** `/implement-with-ralph` end-to-end and:
- generates `prd.json` via a **real PRD-generation delegation** (repo-detector + criteria-validator ran as fresh-context helpers, not hand-scaffolded),
- runs **real Phase 5a/5b reviewer + fixer/updater delegation** (code-reviewer/docs-reviewer produced `<review-meta>` from a clean context; code-fixer/docs-updater edited + committed),
- produces `prd.json` / `code-review-findings.json` / `docs-review-findings.json` / commits,
- with **git + transcript evidence** showing **no hand-scaffolded prd.json and no in-context self-review finalization**.
Only then is `CREWS_ENGINE=codex` re-set as the default crews member engine.
