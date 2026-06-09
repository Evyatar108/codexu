---
overviewTaskId: codex-member-skill-agent-subagent-fanout
---

## Direction
D-001 — Hybrid: write/reviewer subagents via `copilot-exec.mjs` CLI shell-out; keep read-only lens fan-out on `spawn_agent`. When `engine=codex`, route the write/context-isolation-critical subagent sites (PRD-gen helpers + Phase 5a/5b reviewers and fixers) to a proven in-worktree Copilot CLI helper instead of an unvalidated `spawn_agent` write-child, while leaving the already-shipped read-only lens fan-out unchanged.

## Goal
A codex crew member runs a **full** `/implement-with-ralph` end-to-end with **real, fresh-context** PRD generation and **real** Phase 5a/5b reviewer-convergence subagents — no hand-scaffolded `prd.json`, no in-context self-review finalization — so that codex can be re-enabled as the default crews member engine (`CREWS_ENGINE=codex`) without losing independent PRD/criteria validation or independent code/docs review signal.

## Scope
### In Scope
- A second lowering target in `scripts/codex-lowering.mjs` (+ `generate-copilot-artifacts.mjs`) that, for `engine=codex`, lowers the **write / context-isolation-critical** subagent sites to a `copilot-exec.mjs` shell-out (`--model claude-opus-4.7-1m-internal`) running in the member's `work_dir`: `code-fixer`, `docs-updater`, `criteria-validator`, `repo-detector`, plus the **prose** reviewer sites `code-reviewer` / `docs-reviewer` inside `review-changes` (which the current `Agent(`-token scanner never sees — review-changes SKILL.md:113-124).
- Normalizing helper outputs back into the existing contracts the workflows already read: `<review-meta>` (code/docs review), criteria-validator JSON, repo-detector single path, and `code-fixer`/`docs-updater` edits + commits in the worktree.
- A go/no-go **smoke**: prove `copilot-exec` runs in the member `work_dir` with write perms, produces a committed edit plus parseable `<review-meta>`/JSON, and leaves parent-visible files after it exits — BEFORE wiring all sites.
- Keeping the read-only parallel LENS fan-out (brainstorm + Phase-5.5 retrospective trio) on the already-shipped `spawn_agent` recipes.
- Updating `AGENT_SITE_INVENTORY` + the codex generator tests; ralph version bump + marketplace-index sync.
- A re-enable dogfood: a real codex-member full `/implement-with-ralph` with git + transcript evidence proving no inline PRD-gen / self-review.

### Out of Scope
- Native `spawn_agent` WRITE-subagent lowering (D-002) — deferred as the codex-purity graduation, itself gated on a separate `spawn_agent` write-child worktree/commit smoke.
- Codex-native phase rewrite of PRD-gen / review-convergence (D-003) — XL, highest drift risk.
- Any codex source-tree (`codex/` submodule) change; this is a plugin-side (`ai-developer-toolkit/plugins/ralph`) change.
- Re-architecting the read-only lens fan-out (already shipped and D-003-spike-validated).
- Plumbing `features.multi_agent_v2` enablement is a **prerequisite/coordination** item (needed for the retained read-only lenses), tracked with `codex-engine-ralph-member-enablement` — not re-built here.

## Criteria
- For a codex-generated `implement-with-ralph` / `review-changes` / `convert-to-ralph-prd`, the write/reviewer subagent sites emit a `copilot-exec.mjs` in-worktree shell-out (NOT a JSON-only `spawn_agent` recipe), and `code-reviewer` / `docs-reviewer` are now covered (added to `AGENT_SITE_INVENTORY`; the prose sites are detected).
- The go/no-go smoke passes: a `copilot-exec` helper run in the member `work_dir` makes a committed edit + emits a parseable `<review-meta>`/JSON, parent-visible after exit. (If it FAILS, the helper-in-worktree premise is wrong → escalate to D-002's native probe or D-004 waiver; the plan must encode this go/no-go.)
- A live codex-member full `/implement-with-ralph` dogfood produces `prd.json` via real PRD-generation delegation and real Phase 5a/5b reviewer + fixer/updater delegation, yielding `prd.json` / `code-review-findings.json` / `docs-review-findings.json` / commits, with git + transcript evidence showing **no** hand-scaffolded `prd.json` and **no** in-context self-review finalization.
- Codex generator gates green (`generate-copilot-artifacts.mjs --target=codex --check`, `tests/test-codex-generator.mjs`, marketplace-policy validator); `CODEX_FORBIDDEN` still passes (no `Skill(`/`Agent(`/`task(` leak); ralph version bumped + all six stamps + three marketplace indexes in sync.
- The schema-stale shipped recipe is fixed (`spawn_agent` now carries the required `message` field) OR a follow-up bug is filed for it.

## Context
All three lenses (codex Feasibility-Mapper, Copilot Product-Reality, Devil's Advocate) ran in full mode, independently verified the gap against source, and converged on D-001 as the lowest-risk gate-closer (codex lens rated it effort **L** vs **XL** for D-002/D-003).

Decision-shaping points:
1. **Residual gap is real and four-fold:** the shipped recipe is JSON-lens-shaped (codex-lowering.mjs:300-302), the code/docs reviewers are prose-only and uninventoried (review-changes SKILL.md:113-124 vs scanner codex-lowering.mjs:86-93), spawn-child write/commit semantics are unvalidated, and `features.multi_agent_v2` enablement was deferred. The prior adapter (v5.53.0) was scoped to the read-only lens fan-out only.
2. **Hybrid does not defeat the purpose of a codex member:** codex still owns the top-level member, the per-story iteration engine (the bulk of the work), and the read-only lens fan-out; only the clean-context **write/review** subagents are delegated to `copilot-exec`. This is consistent with the operator's current posture (impls already run on copilot for reliability per the `CREWS_ENGINE` revert).
3. **The load-bearing OPEN QUESTION (operator-owned):** may "codex-default" depend on a Copilot/Claude helper for the clean-context write/review phases, or must every subagent be codex-native? If the answer is "must be native," start with **D-002** instead — gated on the cheap `spawn_agent` write-child smoke.

Disconfirming observations to carry forward:
- (DA) The shipped read-lens recipe may be **schema-stale**: `spawn_agent` emitted without the required `message` (codex-lowering.mjs:287-296 vs multi_agents_spec.rs:100-103). Don't mechanically extend it to write subagents; fix it.
- (DA) Under any manual-finalization fallback (D-004), **docs-review loses its only independent reviewer** — there is no CLI docs lens, only the `docs-reviewer` Agent.
- (all) The hybrid's value claim must be **measured** by the dogfood: git + transcript evidence is the pass/fail signal that the member did not silently inline the delegated phases.

Prior art (do not redo): `codex-ralph-member-multi-agent-adapter` (shipped v5.53.0), `codex-upstream-multi-agent-v2-fork-impact`, `codex-recursive-subagent-spawn`, `codex-child-spawn-tools`.
