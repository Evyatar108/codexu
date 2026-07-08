# Stories Outline — Big-bang `git merge cli-1.1.10` for LINEAGE

**Task:** `happy-fork-make-truly-rebasable-on-upstream`
**Companion:** [`plan.md`](./plan.md) (read §0 TL;DR + §3 mechanics + §8 go/no-go first)
**Impl worktree/branch (for the impl member):** `.ralph/jobs/happy-fork-make-truly-rebasable-on-upstream/worktree/` on `ralph/<task-id>` off `main`. The lead FF-merges; the member never pushes to `origin/main`.

> **The one thing that must not go wrong:** S1 uses **`git merge -s ours`** (whole-tree ours strategy),
> **NOT** a default `git merge` and **NOT** `-X ours`. A default/`-X ours` merge auto-imports ~21,732 lines
> the selective intake deliberately skipped (plan §2.2). `-s ours` yields a tree byte-identical to HEAD.
> The S2 gate (`git diff main` must be EMPTY) is the tripwire.

---

## Ship order

`S0 → S1 → S2 → (S3 optional, default empty) → S4 → (S5 recommended in-job)`

S1 is a single atomic zero-conflict operation; there is **no** per-package resolution loop (that is what
`-s ours` buys us over a manual merge). S1 must ship (be validated by S2) before S3/S4/S5.

---

## S0 — Baseline + preflight

**Goal:** capture the green pre-merge baseline that S2 must reproduce, and confirm every precondition.

**Scope:** read-only; no commits (or a trivial no-op). Run on `main` at HEAD.

**Acceptance criteria (all must hold):**
- [ ] `git config merge.ours.driver` prints `true`. (If not: `git config merge.ours.driver true`.)
- [ ] `git rev-list -n1 cli-1.1.10` == `71c417e1092e73cf34eb24f9601d569394c1f359`; `git rev-parse upstream-happy/main` == `d2ef88de…`. If missing: `git fetch --no-tags upstream-happy main` + `git fetch --no-tags upstream-happy tag cli-1.1.10`.
- [ ] `git merge-base --is-ancestor 52df4e2d HEAD`, `… c815c581 HEAD`, `… 41f6b677b HEAD` all exit 0 (the selective intake is in HEAD). If any fails → **STOP and escalate**: the take-ours premise is invalid and this plan does not apply.
- [ ] **happy-server baseline recorded green:** `pnpm --filter happy-server typecheck` passes; the 6-spec auth set passes (`publicAuthGate`, `remoteDeviceAuth`, `deviceEnrollment`, `socket`, `index`/`forkAuthPlane`, `dualListenerBinding`).
- [ ] **happy-cli baseline recorded green:** `pnpm --filter happy typecheck` passes; `pnpm --filter happy test` passes (do **NOT** set `npm_config_script_shell=bash`). Record the exact pass/fail counts.
- [ ] **happy-app baseline recorded green:** `pnpm --filter happy-app typecheck` passes; the HA guard specs pass; `sources/text/translations.test.ts` parity passes.
- [ ] `node scripts/audit-happy-fork-patches.mjs` reports **zero drift**.
- [ ] The recorded results are written down (commit message or a scratch note) so S2 can diff against them.

**Blocking:** if the baseline is **not** green, do not proceed — a pre-existing failure would masquerade as
a merge regression in S2. Fix or escalate first.

---

## S1 — The lineage merge (`-s ours`)

**Goal:** create the real merge commit that records `cli-1.1.10` lineage without changing the tree.

**Scope:** one merge commit on the topic branch.

**Command:**
```bash
git merge -s ours --no-ff \
  -m "merge(happy): record cli-1.1.10 lineage (selective intake already in HEAD; tree unchanged)

cli-1.1.10 was already selectively intaken (52df4e2d/c815c581/41f6b677b); this -s ours
merge records the lineage so future upstream syncs are incremental. Tree == pre-merge main." \
  cli-1.1.10
```

**Acceptance criteria:**
- [ ] The command prints `Merge made by the 'ours' strategy.` (**not** a conflict list).
- [ ] `git diff main --stat` (merge commit vs the pre-merge `main` tip) is **EMPTY**. *(Non-negotiable.)*
- [ ] `git rev-list --parents -n1 HEAD` shows **two** parents; the second is `71c417e1…` (cli-1.1.10).
- [ ] `git merge-base HEAD cli-1.1.10` == `71c417e1…` (advanced from `df4cdae8`).
- [ ] `git ls-tree HEAD codex` gitlink == `0e94f80ed309af1d15214e344fd3bbfb5d662d51` (submodule pointer unchanged).
- [ ] No fork-only tree changed (trivially true — tree==HEAD).

**Do NOT:** run a default `git merge`; use `-X ours`; hand-resolve conflicts; `git add` any content.

---

## S2 — Post-merge validation

**Goal:** prove the merge changed nothing except history shape.

**Scope:** re-run the S0 gate set on the S1 merge commit; no code changes.

**Acceptance criteria:**
- [ ] `git diff main --stat` remains EMPTY (re-assert).
- [ ] **happy-server:** `pnpm --filter happy-server typecheck` + 6-spec auth set → results **identical to the S0 baseline** (green).
- [ ] **happy-cli:** `pnpm --filter happy typecheck` + `pnpm --filter happy test` → counts **identical to S0** (green).
- [ ] **happy-app:** `pnpm --filter happy-app typecheck` + HA guard specs + `translations.test.ts` → **identical to S0** (green).
- [ ] `node scripts/audit-happy-fork-patches.mjs` → **zero drift** (unchanged from S0).
- [ ] Any divergence from the S0 baseline ⇒ the merge was NOT `-s ours` ⇒ **abort the branch and redo S1.**

**This is the go/no-go proof** for the lead's FF decision (plan §8.3).

---

## S3 — (Optional) spot-adopts — DEFAULT EMPTY

**Goal:** vehicle for any feature the operator explicitly opts into adopting in-job. **Default: do nothing.**

**Scope:** if opted in, each adopt is a **separate commit AFTER S1/S2** (never folded into the S1 merge).

**Acceptance criteria (per opted-in adopt only):**
- [ ] The adopt touches only the enumerated files for that feature (e.g. HA-23 FileView = the new `FileView` component + the one `components/tools/views/_all.tsx` registry line).
- [ ] The feature's guard spec passes (e.g. `components/tools/views/EditView.test.tsx` / `FileEditView.test.ts` for HA-23).
- [ ] That package's `typecheck` passes + `node scripts/audit-happy-fork-patches.mjs` stays 0-drift.
- [ ] A catalogue row is updated/added for the adopt (flip the HA row's disposition + add a marker if code changed).
- [ ] The commit message names the observable behavior change.

**Recommendation (plan §4):** adopt **none** by default. If the operator wants a quick win, **HA-23
FileView** is the cleanest self-contained candidate. HA-36 `/goal` (not self-contained), HA-21
CodexPatchView (convergent hand-port), HA-37 mention-50 (e-ink churn) → file as separate feature tasks.

---

## S4 — Catalogue + docs updates

**Goal:** record the lineage anchor and flip the documented cadence to per-release `git merge`.

**Scope:** markdown only — `docs/happy-patch-surface.md`, `docs/fork-notes.md`. No build gate.

**Acceptance criteria:**
- [ ] **`docs/happy-patch-surface.md` §6:** a new row records the **lineage merge commit SHA** as the lineage anchor; framing updated from "computable merge-base only / imported as ordinary commits" to "**cli-1.1.10 is a recorded merged ancestor** (merge `<SHA>`, `-s ours`, tree unchanged)"; the former `df4cdae8` merge-base is kept as a historical note.
- [ ] **`docs/happy-patch-surface.md` §9:** cadence flipped to **"per-release `git merge <tag>`"** with the 6-step incremental-merge recipe (plan §7.1), explicitly citing the demonstrated **7-file** cli-1.1.10→`upstream-happy/main` delta as evidence.
- [ ] Any lingering "history-detached / selective-only" framing in the catalogue is corrected.
- [ ] **`docs/fork-notes.md`:** the intake-mechanism description references the lineage merge + new `git merge` cadence (verify the exact section at impl time; do not disturb the "things that bit us" catalogue).
- [ ] `node scripts/audit-happy-fork-patches.mjs` still **zero drift** (docs edits add no markers).
- [ ] **No** `packages/happy-app/CLAUDE.md` or root `CLAUDE.md` is added (both gitignored/removed — HA-52).

---

## S5 — +3 incremental merge (first cadence demo) — RECOMMENDED IN-JOB

**Goal:** the first genuine incremental merge — proves the new cadence and lands the +3 upstream delta.

**Scope:** a real 3-way `git merge --no-ff upstream-happy/main` (7 files) resolved take-ours-dominant.

**Command + expected surface:**
```bash
git merge --no-ff upstream-happy/main
# 5 conflicts: packages/happy-app/{CHANGELOG.md, sources/changelog/changelog.json,
#              sources/components/modelModeOptions.ts, sources/sync/settings.ts, sources/sync/storage.ts}
# 2 clean auto-merges: sources/app/(app)/{changelog.tsx, settings/features.tsx}
```

**Acceptance criteria:**
- [ ] `packages/happy-app/sources/sync/storage.ts` resolved **take-ours** (HA-2 convergent) — no upstream unread-tracking / multi-account resurrected.
- [ ] `packages/happy-app/sources/sync/settings.ts` resolved **take-ours** on the convergent parts; the additive `zenMode` / session-sort adopt-calls **deferred** unless operator opted in.
- [ ] `packages/happy-app/CHANGELOG.md` + `sources/changelog/changelog.json` resolved **take-ours** (HA-44 / HA-43 fork-owned).
- [ ] `packages/happy-app/sources/components/modelModeOptions.ts`: Fable-5/opus additive rows **deferred** unless operator opted in (take-ours on the fork catalogue otherwise).
- [ ] The 2 auto-merges (`changelog.tsx`, `settings/features.tsx`) verified to compile and be wanted; else revert to ours.
- [ ] Post-merge tree delta vs pre-S5 is **fully enumerated** (≤7 files) and intentional.
- [ ] **Gates green:** `pnpm --filter happy-app typecheck` + HA-2 guard specs (`sync/storage.tree.spec.ts`, `storagePermissionModeUserChosen.test.ts`, `encryptionDeletion.spec.ts`) + `sources/text/translations.test.ts` + `node scripts/audit-happy-fork-patches.mjs` 0-drift.
- [ ] Resurrection guard: grep `applyFriends|applyFeedItems|unreadSessionIds|apiGithub` under `packages/happy-app/sources/sync` == **0** hits.
- [ ] §6 baseline advanced to `upstream-happy/main` (`d2ef88de`) as the new merged tip.

**Pause point:** before deciding the 3 additive adopt-calls (Fable-5, zenMode, session-sort), surface them
to the operator. Default: **defer all three**. If the operator wants to deliberate, **split S5 to an
immediate follow-up task** — S1–S4 ship independently regardless.

---

## Cross-story invariants

- **S1 stays pure.** No content (spot-adopts, S5) is ever folded into the S1 `-s ours` merge commit. This
  keeps its go/no-go crisp and means it never needs reverting.
- **The lead merges to main.** The impl member commits on the topic branch and reports; the lead confirms
  the plan §8.3 go/no-go, FF-merges, and pushes to all remotes.
- **codexu root `CLAUDE.md` is gitignored** — never `git add CLAUDE.md`; fork-level doc edits go in
  `AGENTS.md` / the referenced `docs/*`.
- **No codex submodule build here** — this job does not touch `codex/`; the cli gates are typecheck + test
  only.
- **Overview bookkeeping is lead-owned** — the plan-phase/impl member does not edit `.ralph-overview/data.json`.
