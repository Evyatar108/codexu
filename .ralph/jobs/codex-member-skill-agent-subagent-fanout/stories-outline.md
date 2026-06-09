# Stories Outline: Codex member native spawn subagents (D-002, dual v1+v2)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> Single serial cluster — every story mutates `codex-lowering.mjs`, its generator
> wiring, its tests, or the generated/versioned outputs derived from it. Run in
> priority order; do NOT parallelize (conflicting writes to one hot file + the
> generated `.codex-plugin/` tree).

## US-001: Dual v1/v2 native-spawn recipe builder + message schema-fix
**Description:** As a codex crew member, I want the lowered subagent recipe to be a native, executable codex `spawn_agent` sequence that works on BOTH v1 (Collab) and v2 (MultiAgentV2), so my write/review subagents run as real fresh-context children instead of failing on a v2-required STOP or a schema-invalid spawn.
**Acceptance Criteria:**
- [ ] `scripts/codex-lowering.mjs` emits a detect-and-branch preamble (by tool presence: `list_agents`/`followup_task` ⇒ v2; namespaced `multi_agent_v1.*` + `send_input`/`resume_agent` and no `list_agents` ⇒ v1) that REPLACES the v2-required `preflightProse()` STOP (222-234); it STOPs only when NEITHER surface exists.
- [ ] The v2 recipe variant: `spawn_agent{task_name, message}` → `wait_agent{timeout_ms}` → `list_agents` → `agents[].agent_status.completed` → `JSON.parse` → `close_agent{target}`. The schema-stale emission (288-296) is fixed: the task is carried in `spawn_agent.message`, NOT a separate `followup_task` step.
- [ ] The v1 recipe variant uses the namespaced `multi_agent_v1.*` tools, one-shot: `multi_agent_v1.spawn_agent{message}` → `multi_agent_v1.wait_agent{targets:[agent_id], timeout_ms}` → `status[agent_id].completed` → `JSON.parse` → `multi_agent_v1.close_agent{target}`. No `followup_task`/`list_agents`/`send_input`.
- [ ] Both single-delegation and fan-out emitters use the shared dual-branch builder, so all 8 existing literal-`Agent(` sites inherit the fix.
- [ ] Shared contract preserved: `fork_turns:"none"` analog, omit `agent_type`/`model`/`reasoning_effort`, `timeout_ms >= 10000`, single-level fan-out, FAIL HARD on timeout/malformed JSON.
- [ ] Typecheck passes; `node plugins/ralph/tests/test-codex-generator.mjs` is updated and green for the builder change.
**Dependencies:** None
**Estimated complexity:** large

## US-002: Prose-site lowering mechanism + block-capture drift guard
**Description:** As a maintainer, I want a codex-only prose-site lowering mechanism with stable block-bounded anchors and a drift guard, so prose-described subagent spawns get lowered without touching the shared skill source (zero Claude/Copilot churn) and without silently breaking when prose drifts.
**Acceptance Criteria:**
- [ ] `scripts/codex-lowering.mjs` exports a `PROSE_SITE_INVENTORY` (each entry: `siteId`, `startAnchor`+`endAnchor` block bounds, subagent type(s), scope-conditionality, child prompt) — mirroring `AGENT_SITE_INVENTORY`.
- [ ] `captureProseSites`/`lowerProseSites` replace the WHOLE delimited block (start→end) with the dual-branch recipe, run inside `applyCodexSubstitutions` BEFORE `assertNoCodexForbidden`.
- [ ] An exported `verifyProseSiteInventory` FAILS the build when a `startAnchor`/`endAnchor` is missing, duplicated, or out-of-order.
- [ ] `CODEX_FORBIDDEN` still passes (no `Agent(`/`Skill(`/`task(` leak).
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Register the two prose sites (PRD-gen + scope-conditioned reviewers)
**Description:** As a codex crew member, I want the Phase-2 PRD-gen and the Phase-5a/5b code/docs reviewer sites lowered to native spawn recipes, so I produce `prd.json` and review findings via real spawn-children instead of inline self-execution.
**Acceptance Criteria:**
- [ ] `PROSE_SITE_INVENTORY` registers (a) `implement-with-ralph` Phase 2 PRD-gen (block 277-280; child prompt reads+follows `create-prd` then `convert-to-ralph-prd` with the autonomous/`--job`/engines/`--target-repo` inputs).
- [ ] It registers (b) `review-changes` Step 2 reviewer (block 113-129) with a scope-conditioned recipe: scope=code → `code-reviewer`, scope=docs → `docs-reviewer`, scope=security → explicit inert/skip branch (Phase 5c disabled — no live `security-reviewer` spawn, but the scope is preserved, not dropped).
- [ ] Generated codex artifacts for `implement-with-ralph` and `review-changes` no longer contain the prose-only "Spawn an Agent subagent" block at those sites — the whole block is replaced by the recipe.
- [ ] `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=codex --check` passes (after regen).
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: Tests — dual v1/v2, message, namespacing, prose-site, drift guard
**Description:** As a maintainer, I want comprehensive tests pinning the new behavior so future edits cannot silently regress the native-spawn recipe or the prose-site lowering.
**Acceptance Criteria:**
- [ ] `tests/test-codex-generator.mjs` asserts: dual v1/v2 recipe present; `message` in every recipe; v2 does not carry the task via `followup_task`; v1 uses namespaced `multi_agent_v1.*` and never mentions `list_agents`/`followup_task`; `close_agent` always names a `target`; prose-site whole-block replacement; `verifyProseSiteInventory` fails on a missing/duplicated/out-of-order anchor (negative test); `PROSE_SITE_INVENTORY` export+shape; security-scope branch inert; `CODEX_FORBIDDEN` clean; generated recipe markers for the new sites.
- [ ] The two pinning tests are updated: US-003 preflight (227-251) now asserts the dual-branch (not the v2-required STOP); US-005 sequence (395-452) asserts both per-system sequences.
- [ ] `tests/test-codex-live-smoke.mjs` (131-143) recipe-shape assertion updated to accept the detect-and-branch + per-system sequences.
- [ ] `node plugins/ralph/tests/test-codex-generator.mjs` is green; the Codex Release Gate (`--target=codex --check && test-codex-generator.mjs && validate-codex-marketplace-policy.mjs`) passes.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** large

## US-005: Acceptance dogfood — live codex-member /implement-with-ralph (re-enable gate)
**Description:** As the operator, I want proof that a real codex crew member runs a full `/implement-with-ralph` with real spawn-child PRD-gen + reviewer/fixer/updater delegation, so I can re-enable `CREWS_ENGINE=codex` with evidence. **Runs BEFORE the release bump.**
**Acceptance Criteria:**
- [ ] A live codex crew member runs `/implement-with-ralph --autonomous` on a minimal fixture (tiny throwaway repo/feature, ≥1 trivial story), exercised on the v2 surface (`features.multi_agent_v2=true`) and ideally also v1; ≥1 full green run with evidence.
- [ ] Produced artifacts exist: `<job_dir>/prd.json`, `<job_dir>/code-review-findings.json`, `<job_dir>/docs-review-findings.json`, ≥1 `feat:` git commit, and a captured transcript at a known path.
- [ ] A scripted check on the transcript shows: a `spawn_agent` (or `multi_agent_v1.spawn_agent`) child performed PRD-gen (`prd.json` written by a child, not inline); `spawn_agent` calls for `code-reviewer` + `docs-reviewer` (and `code-fixer`/`docs-updater` when findings exist), recovered via `wait_agent`→(`list_agents` v2 / `status[target]` v1); NO evidence of inline `prd.json` hand-scaffolding or in-context self-review.
**Dependencies:** US-004
**Estimated complexity:** large

## US-006: Regenerate artifacts + version bump + release metadata (runs LAST)
**Description:** As a maintainer, I want the generated `.codex-plugin/` artifacts regenerated and the ralph version bumped in lockstep, AFTER the dogfood passes, so I don't ship stale version claims behind a dogfood-forced recipe change.
**Acceptance Criteria:**
- [ ] `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --write` produces ZERO diff in `.copilot-plugin/**` and `.claude-plugin/**` skill artifacts (parity preserved); only `.codex-plugin/**` changes. `node plugins/ralph/scripts/check-copilot-parity.mjs` passes.
- [ ] Ralph version bumped across all SIX stamps (`plugins/ralph/.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json` + the three indexes `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`) in sync.
- [ ] `plugins/ralph/CHANGELOG.md` + `plugins/ralph/AGENTS.md` behavioral note added.
- [ ] The full Codex Release Gate passes.
**Dependencies:** US-005
**Estimated complexity:** medium
