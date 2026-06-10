Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm — native multi-repo single-job support for ralph-orchestration

## Problem (verified against source)

One `/implement-with-ralph` scopes a job to ONE repo: `prd.json.repoDir` (single
absolute path) + one `worktree`. A plan that must WRITE to two repos (e.g. the
`ai-developer-toolkit` submodule **and** the codexu wrapper) cannot be one job.
The standing workaround is a manual lead-orchestrated 2-job split, shipped in
dependency order. On 2026-06-09 prose-constraining a single member to "Job 1
only, do NOT do Job 2" caused a codex member to HAND-ROLL the implementation
instead of driving the skill — the concrete failure this task exists to kill.

### Prior art already merged (ralph v5.49.0) and the residual gap

- `ralph-orchestration-spawn-target-repo-override-flag` added `--target-repo
  <abspath>` — a SINGLE-repo authoritative override (validates via `git -C
  <path> rev-parse --show-toplevel`, skips the repo-detector Explore agent,
  flows into `prd.json.repoDir`). It points ONE job at ONE repo; it does NOT
  make a job span N repos and is explicitly REJECTED with `--parallel`
  (`implement-with-ralph/SKILL.md:215-224`).
- `ralph-orchestration-document-multi-repo-pointer-bump-flow` documented the
  lead-owned 7-step "wrapper↔submodule ship ceremony" in `plugins/ralph/
  AGENTS.md` + a Phase 6 handoff in `implement-with-ralph/SKILL.md:1533-1625`
  that DETECTS a submodule `repoDir` and prints the manual ceremony. The helper
  (`finalize-submodule-impl.mjs`) and Phase-6 wiring were deferred/unbuilt — so
  the cross-repo pointer bump is a documented MANUAL handoff, not automation.

### The architecture already has most of the machinery (key reframe)

`/implement-with-ralph --parallel` → `decompose-plan` → `.ralph/job-groups/
<group>/group.json` + N member jobs (each its own `prd.json`/worktree/branch/
stories); `parallel-ralph` runs the `dependsOn` DAG (`topo-sort.mjs`,
`select-ready-jobs.mjs`, `prelaunch-merge-job.mjs`, `atomic-update-group.mjs`)
with a concurrency cap, then Phase 5 merges all member branches into ONE
`ralph/<group>/integration` branch in ONE target repo and Phase 6 opens a PR.
`worktree-create.mjs` ALREADY accepts an arbitrary `--target-repo` (wrapper /
submodule / sibling), and `prd.json.additionalDirs[]` already gives cross-repo
READ context via `--add-dir`.

**So the gap is narrow and explicitly flagged as "future scope":**
`decompose-plan` Step 1 detects ONE `repo_root` and creates every member
worktree there; member `convert-to-ralph-prd --batch` calls omit `--target-repo`
(so every `repoDir` == that one root). `group-schema.json` has NO per-job `repo`
field and a single `baseBranch`/`integrationBranch`/`prUrl`; `parallel-ralph`
Phase 5 finalization and `prelaunch-merge-job` are single-target by design. The
genuinely hard + IRREVERSIBLE surface — cross-repo SHIP ordering (a job in repo
B depends on repo A being merged-to-main + pushed + the submodule pointer
bumped, not merely "branch completed"), automated pointer bumps + multi-remote
pushes, and cross-repo rollback — is exactly what the design DELIBERATELY keeps
lead-owned.

## Candidate directions

### D-001: Repo-aware plan-splitter / scaffolder with lead-owned shipping  ← RECOMMENDED
- Contributing lenses: [codex, copilot, devils-advocate]
- What it is: a command that reads ONE multi-repo plan + an explicit repo map and
  emits N scoped SINGLE-repo job seeds (each a clean `prd.json` with that repo's
  stories only + canonical `--target-repo`/`repoDir`, plus other repos as
  read-only `additionalDirs`) **and** an explicit ship-order manifest /
  checklist that encodes cross-repo ship checkpoints (e.g. "repo A merged →
  pushed to all remotes → SHA reachable → wrapper pointer bumped" before repo B
  finalizes) as LEAD gates. It reuses already-shipped primitives
  (`convert-to-ralph-prd --batch` + `--target-repo`, `worktree-create.mjs`); it
  does NOT automate cross-repo push / pointer-bump / rollback.
- Why this might work: it removes the prose-only "Job 1 only" trap by making each
  member's input a normal single-repo Ralph job + the EXACT runnable command
  (`$ralph-orchestration:implement-with-ralph --from-plan … --target-repo …`),
  so the autonomous loop drives it on every engine; it keeps the irreversible
  ship lead-gated per AGENTS.md; effort is M (mostly artifact generation), not XL.
- Risks / friction: it does NOT make shipping autonomous — the lead still runs +
  sequences N jobs; product copy must be honest ("split & sequence a multi-repo
  plan", NOT "one atomic multi-repo job"); repo-assignment of stories can be
  ambiguous; the manifest can go stale after plan-review changes stories.
- Cheapest validation: (1) count, over the last ~20 Ralph tasks, how many truly
  needed coordinated WRITES across two repos vs one repo + read context — confirm
  it recurs enough to amortize; (2) build a thin prototype that turns one known
  dual-repo plan (toolkit+codexu pointer bump) into two scoped job dirs + a ship
  checklist, and dogfood it: a codex member must run the generated skill command
  instead of hand-rolling.
- Disconfirming observation: if generated jobs can't actually be run across repos
  via `--job-dir`/`--target-repo` because `.ralph/jobs` anchors under each target
  repo's root (`path-utils.detectRepoRoot`), or if leads spend ~as long repairing
  generated PRDs as hand-splitting, the helper does not earn its keep.

### D-002: Full multi-repo single-job orchestration + automated finalization
- Contributing lenses: [codex, copilot, devils-advocate]  (all three flag it as the "don't start here" option; devil's-advocate red_flag=true)
- What it is: extend the group machinery for a per-job `repo` (group-schema +
  suggested-decomposition `clusters[]`), per-repo worktree creation + per-member
  `--target-repo` threading in `decompose-plan`, per-repo integration branches +
  cross-repo ship ordering in `parallel-ralph` Phase 5, automated submodule
  pointer bumps + multi-remote pushes, and a cross-repo rollback / partial-failure
  ledger.
- Why it might work: it would be the only fully-unattended end-to-end multi-repo
  release path; the DAG/scheduler/worktree substrate already exists to build on.
- Risks / friction: XL surface concentrated on the riskiest, IRREVERSIBLE steps
  (pushes, gitlink commits) that AGENTS.md reserves as ask-before-acting;
  "single job" over-promises atomicity git cannot give across N histories —
  success becomes a saga with compensating actions; new silent-failure classes
  (repo A pushed but repo B failed → half-shipped pointer; consumers pull a
  broken gitlink; a remote silently stays stale; `group.json` COMPLETED while a
  push never happened because there is no per-repo ship ledger).
- Cheapest validation: a NO-WRITE simulator over a real multi-repo ship
  transcript that models `group.json` repo fields + ship states + rollback
  checkpoints and compares its proposed actions to the real lead ceremony.
- Disconfirming observation: if the simulator can't unambiguously decide
  "ship-complete vs branch-complete" or can't produce safe rollback for a failed
  pointer bump/push, full automation is premature.

### D-003: Harden the manual 2-job split (template + spawn-prompt convention + tiny validator)
- Contributing lenses: [codex, copilot, devils-advocate]
- What it is: a canonical per-job plan template ("Plan A: submodule/plugin repo
  only", "Plan B: wrapper/consumer repo only", each with its own plan.md +
  stories-outline.md + EXACT command line) + a spawn-prompt snippet that forces a
  `$ralph-orchestration:implement-with-ralph` mention with scope encoded in the
  plan (not in a paragraph of prohibitions); optionally a tiny validator that
  refuses a job seed whose plan names writable files in >1 repo.
- Why it might work: cheapest (effort S); directly kills the observed 2026-06-09
  codex hand-roll; the source already shows codex needs machine-shaped commands,
  not nuanced prose (`scripts/codex-lowering.mjs:198-227`).
- Risks / friction: leaves repo-assignment, per-repo PRD authoring, AND
  sequencing manual every time — the lead can still err on order/pointer-bump;
  no unified dashboard for the two jobs.
- Cheapest validation: run the next dual-repo task with only the
  template/snippet; success = no hand-roll, both jobs use the skill, the lead's
  ship ceremony persists all cross-repo steps.
- Note: D-003 is effectively the **first increment of D-001** — the scaffolder
  auto-generates the artifacts this template describes by hand.

### D-004: Status quo (fully manual lead-orchestrated 2-job split)
- Contributing lenses: [implicit baseline across all three]
- Leaves the hand-roll trap unaddressed; relies entirely on lead + prose
  discipline. Rejected because the 2026-06-09 incident shows prose discipline
  fails on codex members.

## Recommendation: D-001 (staged), keeping cross-repo SHIP lead-owned

Build the **repo-aware plan-splitter/scaffolder**, but STAGE it so the
hand-roll fix ships first and the irreversible ship stays lead-gated:

1. **Increment 1 (= D-003's content, ship immediately, effort S):** the canonical
   per-repo plan/spawn template + a `$namespaced` skill-mention requirement + a
   tiny "writable-paths-in-one-repo" validator. This alone eliminates the
   observed codex hand-roll and de-risks the rest.
2. **Increment 2 (the scaffolder, effort M, gated on the frequency check):** a
   command that emits N scoped single-repo job dirs (reusing
   `convert-to-ralph-prd --batch` + `--target-repo` + `worktree-create.mjs`) plus
   an explicit ship-order manifest with cross-repo ship checkpoints as LEAD
   gates. It generates the exact runnable per-job commands. It does NOT push,
   bump pointers, or roll back across repos — that remains the documented
   lead-owned ceremony.

Explicitly REJECT D-002 (full automated finalization) now: it is XL, concentrated
on irreversible ops AGENTS.md reserves for the lead, cannot deliver the atomicity
its "single job" name implies, and opens new half-shipped failure classes. Revisit
only if task history shows frequent, high-cost dual-repo plans where the manual
SHIP ceremony itself (not the split/hand-roll) is the measured bottleneck — at
which point design an explicit per-repo ship ledger first.

### Why this eliminates the codex hand-roll risk
Each member receives a normal single-repo Ralph job + a concrete plan file + the
EXACT `$ralph-orchestration:implement-with-ralph --from-plan … --target-repo …`
command. Scope lives in the per-repo PRD/plan, not in a prose prohibition, so a
codex member loads the skill body (via the `$namespaced` mention) and drives the
autonomous loop instead of improvising.

## Conflict surface (files a D-001 impl would touch)
- New: a `decompose-multi-repo-plan` / `scaffold-multi-repo-jobs` skill (+ its
  `.copilot-plugin`/`.codex-plugin` mirrors via `scripts/generate-copilot-
  artifacts.mjs` + `scripts/codex-lowering.mjs`); a ship-order-manifest shape.
- Reused (no change): `convert-to-ralph-prd` (`--batch` + `--target-repo`),
  `worktree-create.mjs`, `path-utils.mjs`.
- Likely light edits: `plan-with-ralph/SKILL.md` (emit a repo-map / per-repo
  cluster hint in the suggested decomposition), `implement-with-ralph/SKILL.md`
  (cross-reference the new splitter; keep the `--target-repo`×`--parallel`
  rejection), `plugins/ralph/AGENTS.md` (document the splitter + the unchanged
  lead-owned ship ceremony), codexu `AGENTS.md` (update the "Dual-repo plans
  don't chain" guidance to point at the splitter).
- Tests: `tests/test-target-repo-override.mjs`,
  `tests/test-decompose-plan-suggested-decomposition.sh`,
  `tests/test-codex-generator.mjs` + new fixture tests for the splitter.
- If Increment 2 reuses the group machinery instead of independent jobs, add a
  per-job `repo` to `group-schema.json` — but the recommendation prefers
  INDEPENDENT `.ralph/jobs/<slug>` seeds + a manifest to avoid conflating
  execution `dependsOn` with cross-repo RELEASE dependencies.

## Prerequisites
- A machine-readable repo-map input (explicit `--repo <name>=<abspath>` mapping
  or an extended `suggested-decomposition.json` cluster `repo` field) so repo
  selection is never inferred from prose.
- Confirm generated jobs are runnable across repos given `.ralph/jobs` anchors at
  each target repo's root (`path-utils.detectRepoRoot`) — decide job-dir
  placement (under each target repo vs a central tracking dir + `--job-dir`).
- The frequency check (last ~20 tasks) to confirm Increment 2 is worth M effort
  beyond Increment 1.
- Keep the existing Phase-6 submodule-ship handoff as the canonical lead ceremony
  the manifest references.

## Open questions carried to planning
- Independent `.ralph/jobs/<slug>` seeds + a standalone ship-order manifest, vs
  reuse `group.json` with a new per-job `repo` field? (Lenses lean independent +
  manifest, to avoid confusing execution deps with release deps.)
- Repo selection input shape: CLI `--repo name=path` map vs extended
  decomposition sidecar cluster `repo` field?
- Minimum ship-order-manifest schema that encodes a "SHA reachable on all
  remotes" precondition (stronger than `dependsOn`) without becoming a full saga
  ledger?
- Exact codex trigger text that reliably loads the generated skill body across
  current codex behavior (`$ralph-orchestration:implement-with-ralph`).
