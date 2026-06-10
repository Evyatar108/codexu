---
overviewTaskId: ralph-orchestration-multi-repo-single-job-support
---

## Direction
D-001 — Repo-aware plan-splitter/scaffolder with lead-owned shipping. Build a command that turns ONE multi-repo plan into N scoped single-repo Ralph job seeds plus an explicit ship-order manifest, reusing already-shipped primitives and keeping the irreversible cross-repo SHIP lead-gated — explicitly NOT the full automated multi-repo finalizer (D-002).

## Goal
A lead can take a single plan that must WRITE to multiple repos (e.g. the `ai-developer-toolkit` submodule + the codexu wrapper) and, with one command, get back N clean SINGLE-repo job seeds — each a normal `prd.json`/plan scoped to exactly one repo (canonical `--target-repo`/`repoDir`, only that repo's stories, other repos exposed as read-only `additionalDirs`) plus an explicit, ordered ship checklist that names the cross-repo ship gates (merge → push-all-remotes → SHA reachable → submodule pointer bump → next repo). Each generated job runs end-to-end via the EXISTING single-repo `/implement-with-ralph` flow on Claude, Copilot, OR codex, with NO member ever hand-rolling because scope lives in the per-repo PRD and the spawn command is a concrete `$ralph-orchestration:implement-with-ralph --from-plan … --target-repo …`. The plugin does NOT automate cross-repo pushes, pointer bumps, or rollback — those stay the documented lead-owned ceremony.

## Scope
### In Scope
- Increment 1 (ship first, effort ~S): a canonical per-repo plan/spawn template + a requirement that spawn prompts use a `$ralph-orchestration:implement-with-ralph` namespaced mention with scope encoded in the plan (not prose prohibitions) + a tiny validator that rejects a job seed whose plan names writable files in more than one repo (other repos must be read-only context). This alone eliminates the observed 2026-06-09 codex hand-roll.
- Increment 2 (effort ~M, gated on the frequency check): a `scaffold-multi-repo-jobs` (a.k.a. `decompose-multi-repo-plan`) skill that reads one plan + a machine-readable repo map and emits N scoped single-repo job dirs via `convert-to-ralph-prd --batch` + per-job `--target-repo` + `worktree-create.mjs`, plus a standalone ship-order manifest encoding cross-repo ship checkpoints as LEAD gates and the exact ordered run/ship commands.
- `.copilot-plugin` + `.codex-plugin` mirrors for any new/changed skill (via `scripts/generate-copilot-artifacts.mjs` + `scripts/codex-lowering.mjs`).
- Docs: `plugins/ralph/AGENTS.md` (the splitter + the UNCHANGED lead-owned ship ceremony) and codexu `AGENTS.md` ("Dual-repo plans don't chain…" updated to point at the splitter).

### Out of Scope
- Automated cross-repo submodule-pointer bumps, multi-remote pushes, PR creation across repos, and cross-repo rollback/partial-failure recovery (D-002) — these remain the documented lead-owned `wrapper↔submodule ship ceremony`.
- Reworking `parallel-ralph` Phase 5 finalization / `prelaunch-merge-job` / `group-schema.json` for per-repo integration branches. (Prefer INDEPENDENT `.ralph/jobs/<slug>` seeds + a manifest over reusing `group.json`, to avoid conflating execution `dependsOn` with cross-repo RELEASE dependencies.)
- Any change to the existing `--target-repo` × `--parallel` rejection.
- Promising an "atomic single multi-repo job" — the product copy must say "split & sequence a multi-repo plan."

## Criteria
- Given one dual-repo plan + a repo map, the splitter emits N job dirs, each with a valid `prd.json` whose `repoDir` is the canonical toplevel of exactly one mapped repo and whose stories only touch that repo (other repos appear only in `additionalDirs`).
- The splitter emits a ship-order manifest/checklist that lists the jobs in dependency order with explicit cross-repo ship gates (merge → push-all-remotes → SHA reachable → pointer bump) and the exact per-job run command, and references the existing lead-owned submodule-ship ceremony.
- A codex member spawned with a generated job seed runs `$ralph-orchestration:implement-with-ralph` (skill body loads) and drives the autonomous loop — it does NOT hand-roll — verified by replaying the 2026-06-09 toolkit+codexu scenario.
- The plugin performs NO cross-repo push or pointer-bump automatically; a test/dogfood confirms the irreversible steps are surfaced only as a lead checklist.
- The Increment-1 validator rejects a job seed whose plan writes to >1 repo.
- A frequency check (last ~20 Ralph tasks: true multi-repo-WRITE count vs single-repo+read-context) is recorded to justify Increment 2 over Increment 1 alone.
- New/changed skills have regenerated copilot + codex mirrors; relevant tests pass.

## Context
Source-verified reframe: ralph ALREADY has the execution substrate — `decompose-plan` → `.ralph/job-groups/` with per-job PRDs/worktrees, a `dependsOn` DAG run by `parallel-ralph` (`topo-sort`/`select-ready-jobs`/`prelaunch-merge-job`/`atomic-update-group`), `worktree-create.mjs` that already accepts an arbitrary `--target-repo`, and `additionalDirs[]` for cross-repo READ context. The NARROW gap (explicitly flagged "future scope" at `implement-with-ralph/SKILL.md:215-224`): `decompose-plan` builds every member from one `repo_root`, `group-schema.json` has no per-job `repo` field and one `baseBranch`/`integrationBranch`, and `parallel-ralph` Phase 5 + `prelaunch-merge-job` are single-target. The genuinely hard + IRREVERSIBLE surface (cross-repo ship ordering, pointer bumps, multi-remote pushes, rollback) is DELIBERATELY lead-owned (Phase 6 handoff at `implement-with-ralph/SKILL.md:1533-1625` + the `plugins/ralph/AGENTS.md` ceremony).

Tri-lens consensus (codex, copilot, devils-advocate) recommended the splitter over full orchestration. The devil's-advocate `red_flag` on D-002: "single job" over-promises atomicity git cannot provide across N histories — success becomes a saga with compensating actions; automating pushes/pointer-bumps opens new half-shipped failure classes (repo A pushed but repo B failed; consumers pull a broken gitlink; a remote silently stays stale; `group.json` COMPLETED while a push never happened — there is no per-repo ship ledger). Both copilot and codex independently rated the splitter effort-M vs XL for full orchestration and stressed reusing the shipped `--target-repo`/`worktree-create` primitives.

Disconfirming observation to watch during planning: if generated jobs can't be run across repos because `.ralph/jobs` anchors under each target repo's root (`path-utils.detectRepoRoot` resolves a worktree back to its repo root), the job-dir placement must be solved first (under each target repo vs a central tracking dir invoked with `--job-dir`). And if a frequency check shows truly-multi-repo plans are rare and the only live failure is the codex hand-roll, ship Increment 1 (D-003's content) and defer Increment 2.

Open questions carried forward: independent job seeds + manifest vs `group.json` reuse; repo-map input shape (`--repo name=path` vs sidecar cluster `repo` field); minimum ship-order-manifest schema with a "SHA reachable on all remotes" precondition; exact codex trigger text that reliably loads the generated skill body.
