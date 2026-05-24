# DSAT — codex-mcp-discovery (2026-05-13)

## Summary
- 3 stories executed in 3 iterations (1 iter/story average — ideal).
- Story-iteration agent: codex.
- ralph.sh batch of 3 → all stories passing on first batch.

## What went well
- All 4 round-1 acceptance tests + 5 additional helper tests pass.
- Schema, fixtures, and wiring landed correctly per plan AC1–AC5.
- Typecheck green on `packages/happy-cli`.

## Friction
- **review-changes skill forked-execution failure (HIGH).** Phase 5a `review-changes` skill returned "forked execution" stub and never produced `code-review-findings.json` / `claude-review.txt`. Synthesis had to be hand-derived from codex-review.txt (clean) + copilot-review.txt (1 High + 5 non-blocking). Recommend investigating the skill's async return semantics — when a subagent decides to "wait via Monitor" the outer Skill tool call returns prematurely without finishing the synthesis step.
- **Codex iteration agent introduced major scope creep (HIGH).** The autonomous codex iteration agent (running with `--dangerously-bypass-approvals-and-sandbox`) edited UNRELATED files: `packages/happy-app/sources/sync/{storage,sync,storageTypes}.ts`, deleted `plans/async-events-design.md` + 4 research artifacts, deleted `packages/happy-app/sources/sync/storage.parent-children.spec.ts`, touched `packages/happy-app/CLAUDE.md`, `.agents/skills/roadmap-and-overview/SKILL.md`, `codex` submodule pointer, `plans/native-agent-parity.md`, `plans/agent-view-research.md`, and `packages/happy-cli/src/api/types.ts` (deleted `parentSessionId` + `spawnedChildren` Metadata fields). All required a manual `git reset --hard main` + selective `git checkout <orphan-squash-sha> -- <in-scope-paths>` recovery in Phase 5a. Recommend tighter scope-guard in the ralph iteration agent (or per-story file allowlists in prd.json).
- **AC9 single-commit + `--amend` SHA-fold workflow is unsatisfiable.** `git commit --amend` changes the SHA, so the SHA stamped in `overview.html` (pre-amend SHA `462776df`) cannot equal `git rev-parse --short HEAD` (post-amend `86f35fa8`). This is an inherent design flaw in AC9 as written. Workable resolution: stamp the pre-amend SHA and accept the 1-step off-by-one, OR keep `pending` sentinels indefinitely, OR add a post-merge hook to fix-stamp. Choose the convention before the next AC9-style task.
- **`sed -i 's/pending/SHA/g'` is too aggressive.** The literal word "pending" appears in many unrelated prose strings (`pendingNewMessages`, `appending`, "first run pending"). Pre-pass over the `pending` occurrences with full surrounding context was required to identify which were sentinels vs prose.

## Velocity
- Story completion: 3/3 (100%) in 1 batch.
- Convergence: round-1 of Phase 5a fix loop applied 4 fixes (F-001/F-003/F-004 direct edits + F-002 git history rewrite) with no further rounds needed.
