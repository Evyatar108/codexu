# Plan — Big-bang `git merge cli-1.1.10` for LINEAGE (make happy-* truly rebasable)

**Task:** `happy-fork-make-truly-rebasable-on-upstream`
**Author:** PLAN-phase Ralph member
**Worktree/branch:** `.worktrees/plan-happy-merge-lineage` @ `ralph/plan-happy-merge-lineage` (off `main` @ `224263a1c`)
**Governing brainstorm:** [`.ralph/brainstorms/happy-fork-make-truly-rebasable-on-upstream/brainstorm.md`](../../brainstorms/happy-fork-make-truly-rebasable-on-upstream/brainstorm.md) — verdict *"phased hybrid, merge-for-lineage now"* (operator-approved)
**Governing catalogue:** [`docs/happy-patch-surface.md`](../../../docs/happy-patch-surface.md) (§3/§4/§5 HS/HC/HA dispositions, §6 baseline, §7 merge policy, §9 cadence)
**Sibling reference (recipes):** [`.ralph/jobs/happy-first-selective-intake-cli-1.1.10/plan.md`](../happy-first-selective-intake-cli-1.1.10/plan.md) + [`stories-outline.md`](../happy-first-selective-intake-cli-1.1.10/stories-outline.md)
**Deliverables:** this `plan.md` + [`stories-outline.md`](./stories-outline.md)

---

## 0. TL;DR (read this first)

**The approved move is right, and the correct mechanism is `git merge -s ours cli-1.1.10`** — a *real* merge
commit that records `cli-1.1.10` as a second parent (establishing lineage so future syncs become
incremental) while keeping the working tree **byte-identical to HEAD**. I proved this empirically in the
worktree:

- `git merge -s ours --no-commit --no-ff cli-1.1.10` → **"Automatic merge went well"**, **zero conflicts**,
  and **`git diff HEAD` is EMPTY** — the merge-result tree == HEAD exactly. **Pure lineage, zero content
  delta, zero risk.** (Reproduction in [§11](#11-appendix--reproducibility).)
- After that merge, `git merge-base HEAD cli-1.1.10` advances `df4cdae8` → **`71c417e1` (cli-1.1.10
  itself)**, and the very next `git merge upstream-happy/main` surfaces **only 7 files** (the +3-commit
  delta) instead of the current 115 — **the incremental cadence, demonstrated live.**

**The load-bearing warning (this changes the risk framing in the brainstorm):** a *naive* merge — the
default recursive/ort strategy, or `-X ours` — does **NOT** produce a near-zero delta. It auto-merges
**208 non-conflict files (~21,732 net insertions)**: **142 upstream-NEW files (~19,603 lines)** the
selective intake **deliberately skipped** (whole trees the intake never even scoped — `packages/codium`
+17, `.agents/skills` +7, `docs/superpowers`+`docs/plans` +8, plus 106 upstream-NEW files inside the
`happy-*` packages) **plus 64 fork-carried files that upstream changed in non-conflicting regions
(+2,129/-474)**. "Take-ours on the 115 conflicts" is **necessary but not sufficient** for pure lineage —
you would ALSO have to drop all 142 additions and revert all 64 modifications. **`git merge -s ours` does
exactly that, atomically and provably.** Use it. Do **not** run a default `git merge` and hand-resolve.

**Spot-adopts:** keep the lineage merge **pure** (zero features). Every "safe upstream feature" candidate
turns out to be either not self-contained, a hand-port into a convergent file, an e-ink repaint risk, or
post-tag (out of scope for the cli-1.1.10 tag). **Recommendation: adopt NONE inline; file each wanted
feature as its own reviewable follow-up** (default DEFER-ALL). See [§4](#4-spot-adopt-analysis-ruling-4).

---

## 1. Goal + honest framing

### 1.1 What this task is

Commit a **real `git merge`** of upstream `cli-1.1.10` into fork `main` to establish **merge lineage**.
The prize is **not** new content (cli-1.1.10's wanted content was already pulled in by the 2026-07-07
selective intake — server `52df4e2d` + cli `c815c581` + app `41f6b677b`, all confirmed ancestors of HEAD).
The prize is that after the merge commit `M`, git *records* cli-1.1.10 as a merged ancestor, so every
**future** upstream sync is an incremental `git merge <new tag>` of only that release's delta instead of a
full ~115-file re-derivation from the ancient `df4cdae8` merge-base.

### 1.2 The key insight — verified, with one crucial nuance

**Insight (from the brief):** *cli-1.1.10 was already selectively intaken onto fork main, so HEAD already
represents the intended fork+intake state; the merge is primarily for LINEAGE; the correct resolution for
nearly every conflict is take-ours; `git diff HEAD <merge-result>` should be empty or a small enumerated
delta.*

**Verified TRUE — but only if the merge is done with `-s ours`.** The nuance the brainstorm did not measure:
a merge's tree is the union of (a) conflict resolutions **and** (b) the **auto-merged non-conflict
portion**. Point (a) is take-ours (correct). Point (b), under a *default* merge, silently pulls in
**21,732 lines** of upstream content that HEAD does not carry — because the selective intake was **scoped
to `packages/happy-*`** and resolved *conservatively*, whereas a repo-wide `git merge` reaches **every**
upstream change since `df4cdae8`, including whole trees the intake never touched. So:

| Merge mechanism | Conflicts | `git diff HEAD <result>` | Verdict |
|---|---:|---|---|
| **`git merge -s ours`** (recommended) | **0** | **EMPTY** (tree == HEAD) | **Pure lineage, zero risk** |
| default (`-s ort`) / `-X ours` | 115 (take-ours) | **~21,732 insertions across 208 files** | Re-introduces skipped upstream-NEW; **not pure lineage** |

The insight's "empty or small enumerated delta" is achieved **exactly** (empty) by `-s ours`. The
enumeration of what a naive merge *would* drag in is in [§2](#2-the-measured-content-delta-evidence), so the
operator can see the full risk of the wrong mechanism.

### 1.3 The 6 approved sub-decisions (recorded)

1. **Stay vendored** (not a submodule) — lineage, not mechanism, is what enables rebasability. ✔ this plan.
2. **Minimal now** — merge for lineage; overlay-refactor incrementally later (NOT this job). ✔
3. Convergent files (`sync.ts`/`storage.ts`): **do NOT adopt upstream wholesale**. ✔ (take-ours; `-s ours`).
4. Resolution policy: **take-ours-dominant + spot-adopt** safe bits. ✔ ([§4](#4-spot-adopt-analysis-ruling-4) → defer-all recommended).
5. Merge target: **cli-1.1.10 tag first**, then the +3 `upstream-happy/main` commits. ✔ ([§5](#5-stages--validation-gates) S1 then S5).
6. Upstream seam PRs: **skip**. ✔ (out of scope.)

---

## 2. The measured content-delta (evidence)

All measurements taken live in this worktree at HEAD `224263a1c`, merge-base `df4cdae8`, tag `cli-1.1.10`
= `71c417e1`, `merge.ours.driver = true` (verified). Throwaway merges were `--abort`ed / `reset --hard`; the
worktree is clean and unchanged.

### 2.1 The `-s ours` result (the recommended mechanism) — PURE LINEAGE

```
$ git merge -s ours --no-commit --no-ff cli-1.1.10
Automatic merge went well; stopped before committing as requested
$ git diff HEAD          # tree delta vs HEAD
(EMPTY)
$ git rev-parse MERGE_HEAD
71c417e1092e73cf34eb24f9601d569394c1f359   # cli-1.1.10 recorded as lineage parent
```

**Zero conflicts. Zero content delta. `git diff HEAD <result>` is empty by construction.** This is the
strongest possible go-signal: the merge provably changes nothing except history shape.

### 2.2 What a *naive* merge would drag in (the risk of the wrong mechanism)

`git merge --no-commit --no-ff cli-1.1.10` (default strategy) → 115 conflicts (matches the brainstorm) **+**
the following auto-merged non-conflict delta vs HEAD:

| class | files | churn | what it is |
|---|---:|---|---|
| **Added (upstream-NEW)** | **142** | **+19,603** | Files upstream added since `df4cdae8` that the intake **skipped**. Breakdown below. |
| **Modified** | **64** | +2,129 / −474 | Fork-carried files upstream changed in non-conflicting regions (intake did not pull these). |
| **Deleted** | 2 | — | `packages/codium/.../Automations.tsx`, `packages/happy-app/sources/sync/projectManager.ts` |
| **Total non-conflict delta** | **208** | **~+21,732** | The delta a default/`-X ours` merge would introduce beyond HEAD. |

**Added-file tree breakdown (the 142):** `packages/happy-app` 60 · `packages/happy-cli` 36 ·
`packages/codium` 18 · `packages/happy-server` 10 · `.agents/skills` 7 · `docs/superpowers` 6 ·
`docs/plans` 2 · `.claude/skills` 1 · `patches/*` 2. Sample: `.agents/skills/agent-browser/SKILL.md`,
`docs/superpowers/plans/2026-05-20-new-session-right-sidebar.md`, `packages/codium/sources/...` (17 new
codium files: upstream grew codium 128→145; the fork stayed at 128),
`packages/happy-app/sources/-session/agentGoalActionHandler.ts`,
`packages/happy-app/sources/app/(app)/settings/agents.tsx`, `.../components/AgentGoalBar.spec.ts`,
`.../assets/images/zen-icon.png` — i.e. the `/goal` + agent-defaults + zenMode feature cluster the intake
**deferred as operator-calls**, plus entire out-of-scope trees.

**Why this matters:** these are exactly the constructs the selective intake **decided not to carry**.
Letting them flow back in via a careless auto-merge would silently reverse those decisions (re-add whole
upstream tooling trees, agent-goal UI, skills docs, etc.). `-s ours` declines all of it. That is the
correct behavior for a *lineage* merge whose sole job is to record the ancestry we already accounted for.

### 2.3 The incremental cadence — demonstrated live

On a scratch lineage merge commit (then `reset --hard` away), `git merge --no-commit --no-ff
upstream-happy/main` surfaced **only the +3-commit delta (7 files)**:

- **5 conflicts** (resolve take-ours per catalogue): `packages/happy-app/CHANGELOG.md` (HA-44, fork-owned),
  `sources/changelog/changelog.json` (HA-43, fork-owned), `sources/components/modelModeOptions.ts` (HA-40,
  additive Fable-5/opus rows — adopt-or-defer), `sources/sync/settings.ts` (convergent + additive zenMode /
  session-sort), `sources/sync/storage.ts` (HA-2, convergent — take-ours).
- **2 clean auto-merges**: `sources/app/(app)/changelog.tsx`, `sources/app/(app)/settings/features.tsx`
  (+18/−3 total).

**This is the entire payoff of the job**: 7 files instead of 115. Every future release behaves like this.

### 2.4 Is take-ours correct for *all* conflict classes? YES — zero exceptions.

Under `-s ours` there are **literally zero conflicts** to resolve (the strategy takes ours for the whole
tree). Mapping the catalogue conflict classes confirms this is *semantically* correct, not just mechanical:

| Catalogue class | Dispositions | Resolves to | In HEAD already? |
|---|---|---|---|
| **KEEP** (HS-1/2/3/4/5/10/11/12/14, HC-1…19, HA-1…9,13…48) | keep fork body | HEAD content | ✔ yes |
| **KEEP-DELETED** (HS-6/7/8/13, HC-18, HA-1a/2a/49/50/51/52) | stay removed | HEAD content (absence) | ✔ yes |
| **RESTORE / adopt-adapted** (HS-16/17/18) | adopt upstream verbatim/adapted | HEAD content | ✔ **already applied by the intake** |
| **manual-3-way** (package.json ×3, translations, sync plane) | reconciled fork+upstream | HEAD content | ✔ **already reconciled by the intake** |

**There is no conflict class where HEAD is missing wanted cli-1.1.10 content.** The RESTORE/adopt-adapted
rows (the only classes that *take* upstream) were already resolved into HEAD during the selective intake, so
`-s ours` preserves them. The content HEAD "lacks" (the 142 added + 64 modified) is content the intake
**deliberately deferred**, recoverable at will via explicit spot-adopt. **⇒ take-ours (i.e. `-s ours`) is
correct for the entire tree; no file where take-ours loses wanted upstream content.**

---

## 3. Merge mechanics

### 3.1 Preconditions (one-time host setup)

- **`git config merge.ours.driver true`** — already set on this host (verified). It is a **repo-local, not
  committed** config, and it is **inert for `-s ours`** (which ignores `.gitattributes`) but **load-bearing
  for every future incremental merge** (S5 and beyond), where `.gitattributes merge=ours` auto-resolves
  `pnpm-lock.yaml`, `packages/happy-{wire,agent}/dist/**`, and the sidebar trio (HA-10/11/12). Document it in
  the runbook so a fresh clone re-runs it (§7 of the catalogue already specifies this).
- **`upstream-happy` remote fetched** — `cli-1.1.10` tag (`71c417e1`) + `upstream-happy/main` (`d2ef88de`)
  present (verified). Refresh per release: `git fetch --no-tags upstream-happy main` + `git fetch --no-tags
  upstream-happy tag <new-tag>`.
- **Topic branch off `main`** — this job's impl branch is `ralph/<task-id>` off `main` (the lead FF-merges;
  members never push to `origin/main`). `main` is untouched until the FF, so the whole operation is
  reversible by abandoning the branch.

### 3.2 The lineage merge command (S1)

```bash
git switch -c ralph/happy-merge-lineage-cli-1.1.10 main       # topic branch (or the ralph impl worktree)
git merge -s ours --no-ff \
  -m "merge(happy): record cli-1.1.10 lineage (selective intake already in HEAD; tree unchanged)" \
  cli-1.1.10
git diff main --stat        # MUST be empty — proves tree == pre-merge main == HEAD
```

- `--no-ff` is redundant with `-s ours` (a merge commit is always created) but stated for intent.
- **`-s ours` is the strategy, NOT `-X ours`.** `-X ours` (a.k.a. `-s ort -X ours`) does a real 3-way and
  only biases *conflicts* toward ours while letting non-conflicting upstream changes flow in — i.e. it would
  drag in the [§2.2](#22-what-a-naive-merge-would-drag-in-the-risk-of-the-wrong-mechanism) 21.7k delta. Do
  not use `-X ours`. Use `-s ours` (whole-tree ours).
- **Commit-message hygiene:** the message must record *why* the tree is unchanged (intake already in HEAD)
  so future archaeologists don't mistake a `-s ours` merge for a lost-content bug.

### 3.3 Why `-s ours`, not "manual `--no-ff` + resolve-to-ours"

Both produce the **identical tree** (== HEAD). The difference is risk and effort:

| | `git merge -s ours` (recommended) | manual `git merge --no-ff` + hand-resolve |
|---|---|---|
| conflicts to resolve | **0** | **115** (each a chance to mis-resolve) |
| auto-added files to drop | **0** (never staged) | **142** (must `git rm` each, or silently ship them) |
| auto-modified files to revert | **0** | **64** (`git checkout HEAD -- …` each) |
| tree-== HEAD guarantee | **by construction** | only if all 321 actions are perfect |
| effort | one command | hours of per-file work, error-prone |

`-s ours` is the **canonical git idiom** for "we have already incorporated this branch's changes by other
means; record the merge so git stops re-offering them." That is precisely our situation. The manual path
buys nothing and risks accidentally shipping part of the 21.7k delta.

**Operator-decision surfaced:** if the operator specifically wants the merge to *also* pull the
non-conflicting upstream improvements to fork-carried files (the 64 modified, +2,129/−474 — e.g. an
upstream `standalone.ts` refactor), that is a **content** decision, not a lineage decision, and belongs in
an explicit spot-adopt stage ([§4](#4-spot-adopt-analysis-ruling-4)), not smuggled through the merge
strategy. Default recommendation: **`-s ours`, decline all of it, spot-adopt explicitly if desired.**

### 3.4 Target: tag first (S1), then the +3 incremental demo (S5)

Per decision #5, S1 merges the **`cli-1.1.10` tag** (`71c417e1`) for a clean release-anchored lineage
point. The **+3 `upstream-happy/main`** commits are then merged as a **separate, clearly-gated stage (S5)** —
the first genuine demonstration of the incremental cadence (7 files, [§2.3](#23-the-incremental-cadence--demonstrated-live)). Rationale for keeping them separate:

- S1 is *pure lineage* (tree unchanged) — its go/no-go is crisp (`git diff main` empty).
- S5 is a *real content merge* (5 conflicts + 2 auto-merges + 3 adopt-calls) — real intake work with its
  own gates and operator-calls (adopt Fable-5? zenMode? `features.tsx`?). Bundling it into S1 would blur the
  zero-delta guarantee.
- **Recommendation:** do S5 **in this job** as the cadence proof (highest-value demonstration), resolving
  **take-ours on the convergent/fork-owned conflicts** and **deferring the 3 additive adopt-calls** unless
  the operator opts in. If the operator wants to think about the adopt-calls, S5 can split to an immediate
  follow-up task without affecting S1's ship. **Either way S1 ships first and independently.**

---

## 4. Spot-adopt analysis (ruling #4)

Ruling #4 = *take-ours-dominant + spot-adopt safe upstream bits*, and the operator "leaned adopt-by-default
for SAFE features." I evaluated every candidate the brief named. **Net recommendation: adopt NONE inside the
lineage merge; keep S1 pure. File wanted features as separate reviewable follow-ups (default DEFER-ALL).**
The single candidate worth doing *soon* as its own small follow-up is **HA-23 FileView** (self-contained,
e-ink-neutral). Rationale per candidate:

| Candidate | Catalogue | Lives in | Self-contained? | e-ink-safe? | In cli-1.1.10 tag? | Recommendation |
|---|---|---|---|---|---|---|
| **File-mention limit 10→50** | HA-37 (`components/autocomplete/suggestions.ts`) | conflict file | yes (1 constant) | **risk** — 5× longer transient `@`-mention list = more e-ink repaint | yes | **DEFER** — low value, minor repaint risk; trivially adoptable later, or adopt a smaller bump behind a toggle |
| **`/goal` + skills suggestions** | HA-36 (`sync/suggestionCommands.ts`) | conflict file | **NO** — the `/goal` slash entry needs the `agentGoalActionHandler.ts` + `AgentGoalBar` + `settings/agents.tsx` cluster (all in the 142 upstream-NEW) or it's a dead command | n/a | yes (suggestion) / cluster partly post-tag | **DEFER** — adopting the suggestion alone is broken UX; the whole agent-goal plane is a separate feature task, not a lineage spot-adopt |
| **FileView tool renderer** | HA-23 (`components/tools/views/_all.tsx` + new `FileView`) | conflict (registry hunk) + 1 upstream-NEW component | **yes** — additive renderer + one registry line | yes — static file view | yes | **DEFER to a small follow-up** (`happy-app-adopt-fileview-renderer`). Cleanest self-contained candidate; still keep it *out* of S1 to preserve zero-delta |
| **CodexPatchView UI** | HA-21 (`components/tools/views/CodexPatchView.tsx`) | conflict (fork-owned file) | no — hand-port of `materializeUnifiedDiffPatch` normalization into the fork's divergent renderer | yes | yes | **DEFER** — convergent hand-port; codex-relevant so higher value, but belongs in a deliberate feature task with its own tests |
| **Fable-5 model + `xhigh` effort** | HA-40 (`components/modelModeOptions.ts`) | **post-tag** (+3 delta) | yes (additive catalogue rows) | yes (menu entries only) | **NO — post-tag** | **out of scope for S1**; evaluate during S5 (+3 merge). Lean adopt-if-used, else defer |
| **Session-sort toggle** | post-tag (`sync/settings.ts`) | **post-tag** (+3 delta) | additive | likely fine | **NO — post-tag** | **out of scope for S1**; evaluate during S5. Lean defer |

**Why defer-all keeps faith with ruling #4:** the ruling's own words are *"the merge exists to buy lineage,
not features… take-ours and separately cherry-pick any specific upstream improvement worth having."* The
cleanest expression of "clearly separable, reviewable stage" (brief requirement #3) is a **pure `-s ours`
lineage merge (S1) that adopts zero features**, with each desired feature filed as its own commit/task where
it gets real tests and an e-ink pass. **The sync-core convergent files (`sync.ts`/`storage.ts`) stay
take-ours with no feature adoption**, exactly as ruling #3 requires.

**Optional Stage S3 (spot-adopts)** exists in the story table as the *vehicle* for any adopt the operator
insists on doing in-job — each as an isolated post-S1 commit with its own gates. Its **default is empty.**

---

## 5. Stages + validation gates

Because `-s ours` makes S1 a single atomic zero-conflict operation, the staging is **not** the per-package
resolution loop of a manual merge. Instead it is: establish a green baseline → do the pure lineage merge →
prove nothing changed → (optional adopts) → docs → the incremental demo.

| # | stage | action | gate (all run from repo root unless noted) | go/no-go |
|---|---|---|---|---|
| **S0** | **Baseline** | On `main` (pre-merge): capture the **green baseline** for all three packages. Confirm `merge.ours.driver true`; confirm tag/remote fetched; re-confirm the intake commits are HEAD ancestors. | `pnpm --filter happy-server typecheck` + the **6-spec auth set** · `pnpm --filter happy typecheck` + `pnpm --filter happy test` · `pnpm --filter happy-app typecheck` + HA guard specs + `sources/text/translations.test.ts` · `node scripts/audit-happy-fork-patches.mjs` (0 drift). **Record every result** — this is the invariant S2 must match. | baseline must be **green** before merging |
| **S1** | **Lineage merge** | `git merge -s ours --no-ff -m "…" cli-1.1.10` on the topic branch. | `git diff main --stat` **EMPTY**; `git rev-list --parents -n1 HEAD` shows both parents incl. `71c417e1`; `git merge-base HEAD cli-1.1.10` == `71c417e1`. | tree delta **must be empty** |
| **S2** | **Post-merge validation** | Re-run the **exact S0 gate set** on the merge commit. | Same commands as S0. Because tree==HEAD, results **must match S0 byte-for-byte** (green). Any divergence ⇒ the merge was not `-s ours` ⇒ **abort**. | must equal the S0 baseline |
| **S3** | **(Optional) spot-adopts** | Default **empty**. If the operator opts in, each adopt is a **separate post-S1 commit** (e.g. HA-23 FileView) with its own targeted gate (the specific HA guard test + package typecheck + audit). | per-adopt: package typecheck + that feature's guard spec + audit 0-drift | each adopt gated independently |
| **S4** | **Catalogue + docs** | Update `docs/happy-patch-surface.md` §6/§9 (lineage anchor + cadence flip) and `docs/fork-notes.md` (intake mechanism). Docs-only. | markdown only — no build gate; `node scripts/audit-happy-fork-patches.mjs` still 0-drift (no marker changes) | — |
| **S5** | **+3 incremental demo** | `git merge --no-ff upstream-happy/main` (real 3-way). Resolve the 5 conflicts **take-ours** on convergent/fork-owned (`storage.ts` HA-2, `settings.ts` convergent, `CHANGELOG.md`/`changelog.json` fork-owned); **defer** the 3 additive adopt-calls (Fable-5, zenMode, session-sort) unless operator opts in; verify the 2 auto-merges (`changelog.tsx`, `features.tsx`) compile + are wanted. | `pnpm --filter happy-app typecheck` + HA-2 guard specs (`sync/storage.tree.spec.ts`, `storagePermissionModeUserChosen.test.ts`, `encryptionDeletion.spec.ts`) + `translations.test.ts` + audit 0-drift | tree delta vs pre-S5 must be **fully enumerated** (≤7 files) + gates green |

**Per-package gate commands (from the selective-intake gate table, verified there):**

- **happy-server:** `pnpm --filter happy-server typecheck` + the **6-spec auth set** (`publicAuthGate`,
  `remoteDeviceAuth`, `deviceEnrollment`, `socket`, `index`/`forkAuthPlane`, `dualListenerBinding`).
- **happy-cli:** `pnpm --filter happy typecheck` + `pnpm --filter happy test` (do **NOT** set
  `npm_config_script_shell=bash` — WSL2 disk-attach fails on this box; the cli build uses cross-platform
  `shx`). *Note the intake's 4 `publishPermissionModeWiring` failures were fixed pre-HEAD; expect fully
  green now.* **No codex build is required here** (no `codex/` submodule change).
- **happy-app:** `pnpm --filter happy-app typecheck` + the HA guard specs + `sources/text/translations.test.ts`
  parity.
- **ALL:** `node scripts/audit-happy-fork-patches.mjs` — **zero drift** (S1 adds no markers, so it stays
  0-drift trivially).

**Ship rule:** S1 → S2 must be green before anything else. S3/S4/S5 are independent and each self-gated. The
final invariant: **post-merge per-package gates == the S0 baseline** (which is green). Because S1 is
tree-neutral, this is guaranteed by construction — S2 is the *proof*, not a hope.

---

## 6. Fork-only trees untouched (checked precondition)

Confirmed empirically that the fork-only trees **cannot** conflict, because upstream has no blob at those
paths (so a 3-way merge has nothing to converge), and under `-s ours` they are trivially untouched
(tree==HEAD):

| fork-only path | HEAD | cli-1.1.10 | conflict-able? |
|---|---|---|---|
| `codex/` (submodule gitlink `160000` `0e94f80e…`) | present | **absent** | no — upstream has no `codex/` submodule |
| `packages/happy-app/sources/fork/` | tree | **absent** | no |
| `packages/happy-cli/src/fork/` | tree | **absent** | no |
| `packages/happy-server/sources/fork/` | tree | **absent** | no |
| `agentComms/`, `tunnel/`, `daemon/` (repo-root) | absent | absent | n/a (not repo-root dirs in this tree) |

> **Note (avoid a false alarm):** a broad grep for `codex/`|`daemon/` matches `packages/happy-cli/src/codex/`
> and `packages/happy-cli/src/daemon/run.ts` — these are happy-cli's **own** codex/daemon integration, which
> **upstream also ships** (catalogued HC-4/5/6/14/19 etc.); they are normal happy-cli conflict files, **not**
> the fork-only root `codex/` submodule. Under `-s ours` they resolve take-ours like everything else. The
> **submodule gitlink does not change** (verified: identical in HEAD; absent in cli-1.1.10 so it cannot be
> touched).

**Precondition satisfied:** the merge (S1) disturbs no fork-only tree and does not move the `codex/`
submodule pointer.

---

## 7. Catalogue + docs updates (S4)

All are markdown-only (no build gate). Keep them in the impl commit set but *after* S1/S2.

### 7.1 `docs/happy-patch-surface.md`

- **§6 Baseline record:** add a row recording the **lineage merge commit SHA** as the new **lineage
  anchor**. Change the framing from *"a real merge-base exists but codexu was imported as ordinary commits,
  so git has no lineage record"* to *"cli-1.1.10 is now a true merged ancestor (merge commit `<SHA>`,
  strategy `-s ours` — tree unchanged, selective intake already in HEAD). `git merge-base HEAD cli-1.1.10` ==
  `71c417e1`."* Keep the historical `df4cdae8` note as the *former* merge-base for archaeology. Advance the
  documented baseline anchor to `cli-1.1.10` **as a merged ancestor**, not merely an inferred release anchor.
- **§9 Ownership & cadence:** flip the cadence from *"selective per-file 3-way intake"* to **"per-release
  `git merge <new upstream tag>`"**, and document the **incremental-merge recipe**:
  1. `git fetch --no-tags upstream-happy main` + `… tag <new-cli-tag>`.
  2. Ensure `git config merge.ours.driver true` on the host.
  3. `git merge --no-ff <new-tag>` on a topic branch → surfaces **only the new release's delta**
     (demonstrated: cli-1.1.10 → `upstream-happy/main` = **7 files**, not 115).
  4. Resolve take-ours on convergent/fork-owned (`sync.ts` HA-1, `storage.ts` HA-2, translations HA-7,
     package.json, changelog files); let `.gitattributes merge=ours` auto-resolve `pnpm-lock.yaml` + `dist/**`
     + sidebar trio; spot-adopt additive upstream bits deliberately (each tested).
  5. Carry fork-only trees (`sources/fork/`, `codex/` submodule) untouched — they can't conflict.
  6. Gate per package + `audit-happy-fork-patches.mjs`; advance the §6 baseline to the merged tag.
- **§6 wording correction (carried from intake op-call #0):** ensure the "history-detached / selective-only"
  framing is fully retired everywhere it lingers — the fork now has *recorded* lineage, not just a
  *computable* merge-base.

### 7.2 `docs/fork-notes.md`

If it describes the intake mechanism as "manual selective per-file re-derivation," update it to note the
lineage merge + the new per-release `git merge` cadence, cross-linking the catalogue §9 recipe. (Verify the
exact section at impl time; keep the "things that bit us" catalogue intact.)

### 7.3 Overview bookkeeping (lead-owned, not this member)

The lead flips `.ralph-overview/data.json` lifecycle → `merged` with a `shipManifest` after the merge lands
on `origin/main`. **Not this member's job** (plan-phase writes only markdown deliverables).

---

## 8. Risks + rollback + go/no-go

### 8.1 Risks

| risk | likelihood | mitigation |
|---|---|---|
| **Wrong strategy** — someone runs a default `git merge` / `-X ours` and ships the 21.7k-line delta (re-adding `packages/codium`, skills docs, agent-goal UI the intake skipped) | **the #1 risk** | Plan mandates **`-s ours`**; S2 gate re-runs the S0 baseline and **any non-empty `git diff main`** fails go/no-go. The mechanic is one command — hard to get wrong once specified. |
| History shape changes (main gains a 2-parent merge commit) | intended | This *is* the deliverable. Downstream tooling handles merge commits normally; the `-s ours` commit message documents the tree-neutrality. |
| `-s ours` silently *declines* an upstream fix we actually wanted (one of the 64 modified / 142 added) | low | By design for a *lineage* merge; the intake already pulled the wanted content. Anything specifically wanted → explicit spot-adopt ([§4](#4-spot-adopt-analysis-ruling-4)) / the S5 +3 merge. The full declined set is enumerated in [§2.2](#22-what-a-naive-merge-would-drag-in-the-risk-of-the-wrong-mechanism) for review. |
| Missing `merge.ours.driver` on a future host breaks the **incremental** cadence (S5+) | low | Documented one-time host step in §7 catalogue + fork-notes; S5 is the first place it matters (though the +3 delta happens not to include lockfile/sidebar/dist). |
| S5 +3 merge mis-resolves a convergent file (e.g. resurrects unread-tracking via `storage.ts`) | low-med | S5 resolves `storage.ts` take-ours (HA-2) + runs the HA-2 guard specs + `encryptionDeletion.spec.ts` (removed-plane grep == 0). Defer the additive adopt-calls. |

### 8.2 Rollback

- **Before FF:** the merge lives only on the topic branch; `main` is untouched. If S2 (or any gate) fails,
  **abandon the branch** — zero blast radius.
- **After FF (if a latent issue surfaces):** `git revert -m 1 <merge-SHA>` reverts the merge's *tree* effect
  (a no-op, since the tree was unchanged) but does **not** un-record the lineage cheaply — reverting a
  `-s ours` merge is awkward. Because the tree effect is nil, the realistic recovery is *forward-fix*, not
  revert. This is a strong argument for **not** bundling content (spot-adopts / S5) into the S1 merge commit:
  keep S1 pure so it never *needs* reverting.

### 8.3 Go / No-Go (the decision the lead makes before FF-merging S1 to main)

**FF-merge S1 to `main` ONLY IF ALL hold:**
1. `git diff main --stat` against the merge commit is **EMPTY** (tree == HEAD). *(Non-negotiable — this is
   the whole safety guarantee.)*
2. The merge commit has **two parents**, the second == `71c417e1` (cli-1.1.10). `git merge-base main
   cli-1.1.10` == `71c417e1`.
3. The **S2 per-package gates == the S0 green baseline** (server typecheck + 6-spec auth; cli typecheck +
   test; app typecheck + HA specs + translations parity; audit 0-drift).
4. No fork-only tree changed; `codex/` submodule gitlink unchanged.

If any fails → **do not FF; abandon the topic branch and investigate** (almost certainly the wrong merge
strategy was used).

---

## 9. Story table + ship order

Ship order: **S0 → S1 → S2 → (S3 optional) → S4 → (S5)**. Full acceptance criteria in
[`stories-outline.md`](./stories-outline.md).

| # | story | scope | gate | parallel-safe? |
|---|---|---|---|---|
| **S0** | Baseline + preflight | capture green per-package baseline; confirm driver/tag/ancestry | all package gates green + audit 0-drift | — |
| **S1** | Lineage merge (`-s ours`) | `git merge -s ours --no-ff cli-1.1.10` on topic branch | `git diff main` empty; 2 parents; merge-base == 71c417e1 | ❌ (single atomic op) |
| **S2** | Post-merge validation | re-run S0 gates on the merge commit | results == S0 baseline (green) | ❌ after S1 |
| **S3** | (Optional) spot-adopts | **default empty**; each opted-in adopt = separate post-S1 commit | per-adopt: package typecheck + feature guard spec + audit | ✅ (independent commits, after S2) |
| **S4** | Catalogue + docs | patch-surface §6/§9 lineage anchor + cadence flip; fork-notes intake mechanism | markdown; audit still 0-drift | ✅ (after S1) |
| **S5** | +3 incremental demo | `git merge --no-ff upstream-happy/main`; take-ours convergent/fork-owned; defer 3 adopt-calls | app typecheck + HA-2 specs + translations parity + audit; ≤7-file enumerated delta | ❌ after S1 (touches storage.ts) |

**Autonomy recommendation:** the impl member may drive S0–S4 autonomously (S1 is deterministic and
tree-neutral; S2 proves safety). **Pause for operator input before S5's 3 adopt-calls** (Fable-5 / zenMode /
session-sort) and before **any** S3 spot-adopt — those are content decisions. The lead FF-merges S1 (and
S4/S5 as they land) after confirming the [§8.3](#83-go--no-go-the-decision-the-lead-makes-before-ff-merging-s1-to-main) go/no-go.

---

## 10. Operator-decision calls (surface before/at execution)

| # | call | recommendation |
|---|---|---|
| **#1** | **Merge strategy: `-s ours` vs manual `--no-ff`+resolve.** | **`-s ours`** — identical tree, zero conflicts, provably zero delta, canonical idiom. Manual buys nothing and risks shipping the 21.7k delta. |
| **#2** | Do the +3 `upstream-happy/main` merge (S5) **in this job** or as an immediate follow-up? | **In this job as S5** (highest-value cadence proof), take-ours-dominant, defer the 3 additive adopt-calls. Split to a follow-up only if the operator wants to deliberate the adopt-calls first. S1 ships independently regardless. |
| **#3** | **Spot-adopts (ruling #4):** which safe features to adopt in-job? | **DEFER-ALL** for S1 (keep it pure). Soonest self-contained follow-up candidate: **HA-23 FileView**. HA-36 `/goal` (not self-contained), HA-21 CodexPatchView (convergent hand-port), HA-37 mention-50 (e-ink churn) → separate feature tasks. Fable-5 / session-sort are **post-tag** → S5 territory. |
| **#4** | S5 additive adopt-calls: Fable-5 model rows (HA-40), zenMode + session-sort (`settings.ts`), `settings/features.tsx` auto-merge. | Lean **defer** (adopt only if the operator uses those models / wants zen/sort); each is trivially adoptable later. Verify `features.tsx` is wanted before keeping its auto-merge. |
| **#5** | `docs/fork-notes.md` intake-mechanism wording — update in this job or defer? | Update in **S4** (small; keeps docs coherent with the new cadence). Confirm exact section at impl time. |

**No blocking open questions.** The mechanism is proven; the only genuine choices are content (adopts),
which default to defer.

---

## 11. Appendix — reproducibility

All commands run in `.worktrees/plan-happy-merge-lineage` at HEAD `224263a1c`; every throwaway merge was
reverted (`git merge --abort` / `git reset --hard 224263a1c`); worktree left clean.

**Topology / preconditions:**
```
git rev-parse HEAD                      → 224263a1c
git merge-base HEAD cli-1.1.10          → df4cdae8   (git describe: v3-1501-gdf4cdae8e)
git rev-list -n1 cli-1.1.10             → 71c417e1
git rev-parse upstream-happy/main       → d2ef88de
git config merge.ours.driver            → true
git rev-list --count cli-1.1.10..upstream-happy/main → 3
git diff --name-only cli-1.1.10..upstream-happy/main → 7 files
# intake commits are ancestors of HEAD:
git merge-base --is-ancestor {52df4e2d,c815c581,41f6b677b} HEAD → all exit 0
```

**`-s ours` (recommended) — pure lineage:**
```
git merge -s ours --no-commit --no-ff cli-1.1.10   → "Automatic merge went well"
git diff HEAD                                       → (empty)
git rev-parse MERGE_HEAD                            → 71c417e1
git merge --abort
```

**Default merge (the risk) — measured delta vs HEAD:**
```
git merge --no-commit --no-ff cli-1.1.10   → 115 conflicts
git diff --cached --name-status | group:  A=142  M=64  D=2   (U=115 conflicts)
git diff --cached --diff-filter=A --shortstat → 142 files, +19,603
git diff --cached --diff-filter=M --shortstat → 64 files, +2,129 / −474
# added-tree breakdown: happy-app 60 · happy-cli 36 · codium 18 · happy-server 10
#                       · .agents/skills 7 · docs/superpowers 6 · docs/plans 2 · misc 3
git merge --abort
```

**Lineage advance + incremental demo (scratch commit, then reset --hard):**
```
git merge -s ours --no-ff -m "scratch" cli-1.1.10
git merge-base HEAD cli-1.1.10          → 71c417e1   (advanced from df4cdae8)
git merge-base HEAD upstream-happy/main → 71c417e1
git merge --no-commit --no-ff upstream-happy/main
  → 7 files: 5 conflicts (CHANGELOG.md, changelog.json, modelModeOptions.ts, settings.ts, storage.ts)
           + 2 clean (changelog.tsx, settings/features.tsx);  +18 / −3 auto-churn
git merge --abort ; git reset --hard 224263a1c
```

**Fork-only-tree / submodule precondition:**
```
git cat-file -t {…}:packages/happy-{app,cli,server}/…/fork → tree in HEAD, absent in cli-1.1.10
git ls-tree HEAD codex        → 160000 commit 0e94f80e…  (submodule)
git ls-tree cli-1.1.10 codex  → (empty — upstream has no codex/ submodule)
```
