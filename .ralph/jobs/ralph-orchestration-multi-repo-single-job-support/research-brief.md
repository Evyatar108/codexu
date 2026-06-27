# Research Brief — multi-repo plan splitter for ralph-orchestration

## Researcher Findings (Explore agent, gpt-5.4-mini)
- `skills/decompose-plan/SKILL.md`: repo-root detection L105-118 (one `repo_root` via `git rev-parse --show-toplevel`); all member worktrees built from that one root L172-193; batch convert call at Step 5e L209-221 does NOT pass `--target-repo` (the gap).
- `schemas/group-schema.json` L1-43: no per-job `repo` field (jobs[] = name/jobDir/branch/phase/dependsOn/status L32-39); single-target baseBranch L18 / integrationBranch L19 / prUrl L20.
- `src/worktree-create.mjs`: accepts `--target-repo` (L157-159) + `--init-submodules` (L172-174); uses targetRepo as git cwd (L101,113,118); does not itself validate via rev-parse (higher-level does).
- `skills/implement-with-ralph/SKILL.md`: `--target-repo`×`--parallel` reject L215-224; Phase 6 submodule-ship handoff L1528-1632.
- `scripts/codex-lowering.mjs` + `generate-copilot-artifacts.mjs`: codex bodies generated; mirror regen `--target=all --write`; `$namespaced` machine-invocable mention required for codex.
- `src/path-utils.mjs`: detectRepoRoot L57-73; resolveJobsBase L45-47; `.ralph/jobs` anchored under repo root.
- Tests: `tests/run.mjs` auto-discovers `test-*.mjs`; relevant: test-target-repo-override.mjs, test-decompose-plan-*.sh, test-codex-generator.mjs, worktree-create.test.mjs.
- Version 5.60.0; six stamps (3 plugin.json + 3 marketplace indexes).

## Architect Analysis (Explore agent, gpt-5.4-mini)
- Validator should be a new `src/*.mjs` CLI (like path-utils.mjs CLI surface L57-99,225-243). Contract: `node src/validate-prd-scope.mjs --prd <prd.json> [--repo-map <json>]`; exit 0 OK / 1 IO-error / 2 multi-repo-write. repoDir = authoritative write repo; additionalDirs = read-only.
- Per-repo template belongs in implement-with-ralph SKILL.md surface (already owns --target-repo/additionalDirs/repoDir wiring). Cross-engine loading is via codex-lowering pass over SKILL bodies, not slash syntax. Require `$ralph-orchestration:implement-with-ralph` namespaced mention; reject prose-only "Job 1 only".
- Scaffolder: separate repo-map JSON (not overloaded into suggested-decomposition.json). Emit INDEPENDENT per-repo seeds + standalone ship manifest (keep execution dependsOn separate from cross-repo release order).
- Job-dir placement: architect leaned "under each target repo's own .ralph/jobs"; OVERRIDDEN by firsthand finding that `convert-to-ralph-prd --batch --job-dir` is decoupled from `--target-repo`, so central placement under the orchestrating wrapper is viable and preferred.
- Ship-order manifest: minimal checkpoint-list JSON {jobs:[{jobDir,repoDir,run,shipGate}]}; reference (not re-implement) the lead ceremony.
- Risks: don't change --target-repo×--parallel reject; avoid touching group-schema.json (scheduler blast radius); main risk = confusing execution dependency with release dependency.
- Tests: validator 1-repo vs 2-repo; scaffolder multi-repo fixture; codex lowering fixture proving namespaced mention loads the skill body.

## Codex Research
[See codex-research.txt if collected; additive — research never blocks. Plan grounding is from the two Explore agents + firsthand source verification.]

## Firsthand source verification (plan member)
- group-schema.json L1-43: confirmed no per-job repo field; single-target group fields.
- implement-with-ralph SKILL.md L215-224 (reject) + L1533-1625 (Phase 6 submodule-ship handoff, manual) — read directly.
- convert-to-ralph-prd SKILL.md: `--batch` needs --branch/--worktree-path/--job-dir (L23-27); `--target-repo` override L32,L265-281; **--job-dir decoupled from --target-repo** (key finding); repoDir + additionalDirs L86,L123.
- decompose-plan SKILL.md Step 5e L209-221: batch convert omits --target-repo (the gap), confirmed.

## Frequency check (Increment-2 gate)
Genuine 2+ repo substantive write = 57 of 144 shipped (vs 36 submodule+pointer-bump, 51 single); ~14/30 recent. Disconfirming "rare" condition FALSE → Increment 2 justified. Dominant case = codex nested (codex-patched inner sandbox-patches + codex wrapper main). Full detail in frequency-check.md.

## Consolidated File List
- Files to create: src/validate-prd-scope.mjs, tests/test-validate-prd-scope.mjs, docs/multi-repo-split.md (Inc1); skills/scaffold-multi-repo-jobs/SKILL.md, schemas/repo-map-schema.json, schemas/ship-order-manifest-schema.json, tests/test-scaffold-multi-repo-jobs.mjs (Inc2) + generated mirrors.
- Files to modify: implement-with-ralph/SKILL.md (cross-ref), AGENTS.md, CHANGELOG.md, scripts/generate-copilot-artifacts.mjs, six version stamps (x2), codexu AGENTS.md.
- Reuse unchanged: worktree-create.mjs, convert-to-ralph-prd (via --batch), path-utils.mjs, group-schema.json, parallel-ralph helpers.
- Tests: run.mjs auto-discovery (node:test); test-target-repo-override.mjs, test-decompose-plan-*.sh, test-codex-generator.mjs.
- Mirror-generation: generate-copilot-artifacts.mjs; .copilot-plugin/**, .codex-plugin/**.
