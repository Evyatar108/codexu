# Making the happy-* fork truly rebasable on upstream `slopus/happy`

**Task:** `happy-fork-make-truly-rebasable-on-upstream`
**Type:** read-only analysis / brainstorm (NO production code changed — Markdown deliverable only)
**Branch / worktree:** `ralph/bs-happy-rebasable` @ `D:/harness-efforts/codexu/.worktrees/bs-happy-rebasable`
**Method:** live throwaway `git merge --no-commit --no-ff cli-1.1.10` in this worktree (measured conflicts, then `git merge --abort`); topology counted with `git rev-list`/`git merge-base`; convergent-file structure read from fork HEAD vs `git show cli-1.1.10:<path>`.

> Companion analyses that this builds on (read them, do not duplicate): `.ralph/brainstorms/happy-app-r5-sync-plane-residual/brainstorm.md` (per-hunk sync-plane triage), `.ralph/investigations/happy-upstream-rebase-assessment-v2/findings.md` (conflict heatmap), `docs/happy-patch-surface.md` (KEEP/KEEP-DELETED/RESTORE catalogue + §6 merge-base correction), `codex/docs/implementation/patch-surface.md` (the north-star model).

---

## 1. Goal + honest framing (verdict first)

**Question:** can codexu's `packages/happy-*` fork track upstream via a real `git rebase`/`git merge` instead of the current manual selective per-file intake?

**Verdict, in one paragraph:** A real `git merge` is **topologically possible today and worth doing once, immediately** — not because it magically removes the conflict surface (it does not), but because it **establishes merge lineage**, which converts every *future* upstream sync from a full ~115-file re-derivation into a small **incremental** merge of only the new-release delta. That is the single highest-leverage move available, it is **cheap right now** (fork HEAD already contains the selective cli-1.1.10 intake, so resolving the merge is dominantly "take-ours"), and it does not require a submodule migration or an overlay rewrite. **However**, a *codex-grade* "rebase = replay a tiny patch set" experience is **NOT achievable** for happy's core sync plane. `sync/sync.ts` and `sync/storage.ts` are **irreducibly convergent** — the fork rewrote them by *removing* whole planes (multi-account, per-session E2E) and *replacing* core method bodies (loopback machines, no-decrypt fetch), which cannot be re-expressed as an additive overlay the way codex's fork-only crates can, because **upstream happy's sync plane is a monolithic class + store with no extension seams to hang an overlay on** (codex's upstream *does* have provider/trait/plugin seams — that is exactly why codex is cleanly rebasable and happy is not). So the honest, achievable target is a **phased hybrid**: (1) a one-time real merge now to buy lineage + incremental future merges, (2) flip cadence to a per-release `git merge`, (3) keep shrinking the *UI* conflict surface with the existing R8 overlay pattern, and (4) **accept ~a dozen core sync/store files as permanent manual-3-way** with catalogue-driven resolution recipes. Truly-rebasable "for free" is optimism; truly-rebasable "with a small, bounded, catalogued manual core" is real and reachable.

**Measured conflict count (this worktree, `git merge --no-commit --no-ff cli-1.1.10`, then aborted):**

| Package | Conflicting files | Notes |
|---|---:|---|
| happy-server | 12 | |
| happy-cli | 34 | |
| happy-app | 64 | dominant surface |
| other (AGENTS.md, .gitignore, Dockerfile.webapp, happy-agent tests) | 5 | trivial take-ours |
| **TOTAL** | **115 files / 382 conflict hunks** | `merge=ours` driver **was active** — `pnpm-lock.yaml` + the sidebar trio auto-resolved and are NOT in the 115 |

---

## 2. Current state — why happy is not rebasable "for free" today

### 2.1 A real merge-base DOES exist (the old "history-detached" claim is wrong — verified)

`.ralph/investigations/happy-upstream-rebase-assessment-v2/findings.md` TL;DR #1 asserts *"a real `git rebase`/`git merge` is IMPOSSIBLE … history-detached vendored copy … no git merge-base."* **That is false**, and `docs/happy-patch-surface.md §6` already corrected it. This brainstorm **empirically re-confirms** the correction:

- `git merge-base HEAD cli-1.1.10` = **`df4cdae8`** (`git describe` = `cli-1.1.8-4-gdf4cdae8`).
- `git rev-list --count HEAD ^cli-1.1.10` = **2580** (fork-side commits).
- `git rev-list --count cli-1.1.10 ^df4cdae8` = **213** (upstream-side commits).
- The throwaway `git merge` **ran to completion** (auto-merged the clean files, surfaced 115 conflicts) — a history-detached tree cannot even *start* a merge. Proof by execution.

The "history-detached" belief was an artifact of computing `merge-base` *before* the permanent `upstream-happy` remote's objects were fetched. With them present, the shared ancestry is real.

### 2.2 Why the fork still isn't "rebasable" in practice — the missing lineage

The trap is subtle and it is the crux of section 6's recommendation:

> **cli-1.1.10 was already intaken as ORDINARY commits, not a merge commit.** The first selective intake (2026-07-07: server `52df4e2d`, cli `c815c581`, app `41f6b677b`) advanced the fork's baseline to cli-1.1.10 — but as normal commits on the fork branch. **Git therefore has no record that cli-1.1.10 is a merged ancestor.**

Consequence, and the answer to the task's "would git try to re-merge all 213 upstream commits?" question — **yes, empirically it does:** because the recorded merge-base is still the ancient `df4cdae8`, a `git merge cli-1.1.10` recomputes a 3-way across *all 213 upstream commits*, re-surfacing conflicts even on files the ordinary-commit intake already reconciled by hand. That is why the measured **115** is *higher* than the doc's catalogued ~96 and the findings' 103 (which were measured file-to-file against the tree, not as a from-`df4cdae8` merge): the extra ~15 are test files, translations, and the 5 "other" files that the intake touched but that git re-conflicts because it has no lineage shortcut. **Every future selective intake pays this same full-re-derivation tax, forever, until lineage is recorded.**

### 2.3 The structural reasons the surface exists at all

1. **In-tree vendored copy, not a submodule.** `packages/happy-*` was bulk-imported during the monorepo restructure. Divergence is spread **inline across ~359 files**.
2. **Removals + replacements, not just additions.** The fork is *single-user / self-hosted / e-ink*; upstream is *multi-tenant SaaS*. The fork **deleted** entire planes (friends/feed/artifacts social graph, per-session E2E encryption, attachment-upload) and **replaced** core method bodies (loopback `fetchMachines`, no-decrypt `fetchMessages`). Deletions and body-replacements cannot be quarantined into fork-only files.
3. **Convergent evolution on the crux files.** Fork AND upstream independently rewrote the *same* methods (older-message pagination, `sendMessage`, socket handlers). There is no "pristine upstream + liftable fork block" to separate — there are two divergent versions of one function. (`.ralph/brainstorms/happy-app-r5-sync-plane-residual` established this per-hunk; this brainstorm re-tests it under a more aggressive restructure in §5.)
4. **M1/R8 seam extraction reduces *effort*, not file *count*.** findings-v2 §2.3 proved M1 removed **zero** hard-conflict files: relocating fork logic into `sources/fork/*` leaves a thin **seam call-site** in the canonical file, so it still diverges and still conflicts when upstream also edits it. What M1/R8 buys is that each conflict is now a 1-line seam re-apply instead of a 100–200-line re-derivation.

---

## 3. The codex model, applied to happy

### 3.1 How codex actually achieves clean rebasability

Read from `codex/.gitmodules`, `codex/codex-rs-overlay/`, and `codex/docs/implementation/patch-surface.md`:

- **Upstream lives as a submodule.** `external/repos/codex-patched` → `Evyatar108/codex-openai-fork`, tracking a small **`sandbox-patches`** branch = a *minimal* diff on top of a pinned upstream `rust-vX.Y.Z` tag.
- **All real divergence lives in fork-only overlay crates** (zero conflict surface — upstream never has these files): `codex-copilot`, `codex-copilot-launcher`, `codex-happy`, `codex-invariant-tests`, `codex-mcp-notification-bridge`, `codex-plugin-scope`, `codex-stream-diagnostics` (7 crates).
- **In-upstream-file edits are kept tiny and marked.** Every inline edit carries a `// SANDBOX PATCH:` marker, a `patch-surface.md §14` invariant row, and a §15 replant note. The engineering tenet (codex `CLAUDE.md` "Core engineering tenants" #1) is: overlay-first → 1–3-line call-site seam → inline edit only as last resort.
- **Rebase = rebase the small `sandbox-patches` diff onto the new upstream tag; the overlay crates just carry forward.**

### 3.2 The load-bearing enabler codex has and happy lacks

**Codex is rebasable because upstream `openai/codex` is architected with extension seams** the fork implements in overlay crates: a `ModelProvider` trait (fork ships `CopilotModelProvider` in `model-provider/src/copilot.rs`), a plugin registry, a provider-runtime abstraction. The fork hangs its behavior on seams **upstream already exposes**, so its in-file footprint stays small (dozens of marked lines).

**Upstream happy's sync plane has no such seams.** `sync/sync.ts` is one `Sync` class whose private methods share instance state; `sync/storage.ts` is one Zustand `create()` call whose methods close over `set`/`get` and which the entire app consumes via `storage.getState().X`. There is **no interface, adapter point, or provider trait** at which the fork could register single-user behavior from an overlay file. To get one, the fork would have to *create* the seam — which means either editing the upstream file (= the conflict we are trying to avoid) or landing a seam PR upstream.

### 3.3 The concrete happy-equivalent of the codex layout (and the gap)

| Codex mechanism | Happy equivalent that exists today | Gap to codex-parity |
|---|---|---|
| Upstream as submodule on `sandbox-patches` | ❌ in-tree vendored copy | Migration is possible but **not required** for lineage (see §4.1) |
| Fork-only overlay crates (7) | ✅ **partial** — `packages/happy-app/sources/fork/*` (26 modules), `happy-cli/src/fork/`, `happy-server/sources/fork/`, plus additive trees (`codex/`, `agentComms/`, `tunnel/`, `daemon/`) | Overlay pattern already adopted for **UI** (R8) and server/cli **seams** (M1); it does **not** and **cannot** cover the sync plane |
| Small marked in-upstream-file patch set | ✅ **partial** — `// FORK PATCH:` markers + `docs/happy-patch-surface.md` HS-/HC-/HA- catalogue | The catalogue exists; the *patch set is not small* because the sync plane is a body-rewrite, not a seam |
| Upstream exposes provider/trait seams | ❌ **upstream happy sync plane is monolithic** | **The irreducible gap** — no seam to overlay against without upstream cooperation |

**Bottom line of §3:** happy has already copied the *mechanics* of the codex model (overlay dirs, marker discipline, a catalogue). What it cannot copy is the *precondition*: an upstream that is seam-architected. For the UI and server/cli seams that gap is bridgeable (R8/M1 do it). For the sync plane it is not, absent upstream seam PRs.

---

## 4. Per-option analysis

### Option 1 — Big-bang real `git merge` now (once), then done

Run `git merge cli-1.1.10` (or `upstream-happy/main`) into fork main, resolve the 115 conflicts, **commit the merge commit**.

- **Effort NOW:** **Low–Medium.** Because fork HEAD already contains the selective cli-1.1.10 intake, the correct resolution for the vast majority of the 115 is **take-ours** (the fork's reconciled behavior is already on HEAD). `git merge -X ours cli-1.1.10` would auto-take-ours on conflicting hunks while still pulling in upstream's *non*-conflicting improvements; a careful pass would spot-adopt the handful of upstream deltas worth taking. This is *re-confirming* the intake, not re-doing it.
- **What it delivers (the real prize):** **merge lineage.** After the merge commit `M`, `git merge-base` advances from `df4cdae8` to `cli-1.1.10`. The **next** sync (`git merge upstream-happy/main`, today only **3 commits / 7 files** past the tag) surfaces **only the new-release delta** — a handful of files, likely near-zero conflicts — instead of the full 115. Future syncs become genuine incremental merges.
- **Cons:** does **not** shrink the steady-state surface — the *convergent* files (§5) still conflict on any future release that touches them; it just makes each future merge only-the-delta instead of everything-from-`df4cdae8`. Requires the `merge=ours` driver configured on the merge host (already `git config merge.ours.driver true` here — verified).
- **Verdict:** **the essential first move.** Cheap, high-leverage, reversible (it's one commit on a topic branch until the lead FF-merges).

### Option 2 — Full codex-style overlay restructure

Move happy toward the codex model: upstream consumed near-unmodified + fork behavior entirely in fork-only overlays + a tiny in-file patch set; rebase = bump base + replay patch.

- **Effort:** **High / L**, and **partially blocked**. The UI half is already in progress and works (R8: `SessionView`, `ChatList`, `MessageView`, `AgentInput`, `MarkdownView` relocated to `sources/fork/*`). The **sync plane is the wall**: §5 shows `sync.ts`/`storage.ts` cannot be seamed because (a) they are single cohesive units (class/store closure), and (b) the divergence is removals + convergent body-rewrites, not liftable additive blocks. You cannot overlay against a seam upstream does not expose.
- **What future syncs look like:** trivial for the *seamed* files (they stay near-upstream and auto-merge), unchanged/manual for the *convergent* files.
- **Cons:** big upfront cost with a **hard ceiling** — you can seam the UI and the server/cli edges, but the sync core stays manual no matter how much you invest, unless you also get upstream to accept seam PRs (Option 3's "upstream-the-good-parts" lever, slow + external-dependency + upstream may reject single-user hooks).
- **Verdict:** **do NOT attempt as a big-bang.** Pursue its *tractable* subset (UI overlay + `new/index.tsx`) incrementally under Option 3. Full codex-parity is not reachable for the sync plane.

### Option 3 — Hybrid (recommended): merge-for-lineage now → incremental overlay-refactor + accept a manual core

Big-bang merge now (Option 1) to get lineage + the incremental-merge property, **then** continue the R8/R5 overlay work opportunistically to keep shrinking the per-merge UI surface, and **accept** the sync core as a small permanent manual-3-way set with catalogue recipes.

- **Effort:** front-loaded is just Option 1 (S–M); the rest is ongoing/opportunistic (M–L spread over releases).
- **What future syncs look like:** each new upstream release is `git merge <tag>` surfacing only that release's delta; clean files auto-merge; UI conflicts shrink release-over-release as R8 progresses; the ~dozen convergent core files resolve via the documented per-cluster recipe in `.ralph/brainstorms/happy-app-r5-sync-plane-residual §5`.
- **Cons:** you never reach "zero manual files." That is the honest floor, not a defect.
- **Verdict:** **recommended.** It is the only option that is both *achievable* and *delivers the operator's goal* ("upstream tracking becomes a real merge").

---

## 5. The convergent-file crux (per-file verdict under aggressive restructure)

The task asks specifically: for each convergent file, can the fork's divergence be **re-expressed as upstream-shape + a fork wrapper/overlay** (so the file itself auto-merges), or is it **irreducibly convergent**? The R5 brainstorm concluded "must-stay-manual" under the *seam* approach; here is the re-examination under the **more aggressive** "adopt upstream wholesale + wrap" approach.

| File | Fork LOC | Upstream LOC | Conflict hunks (this merge) | Verdict | Why |
|---|---:|---:|---:|---|---|
| `happy-app/sources/sync/storage.ts` | 1548 | 1496 | **27** | **IRREDUCIBLE** | One Zustand `create()` call; every method closes over `set`/`get`; the whole app calls `storage.getState().X`. You cannot "adopt upstream + wrap" a store whose consumers reference its internal methods by name. Divergence = convergent pagination fields + fork tree-grouping ⟂ upstream unread-tracking on the *same* `buildSessionRowData`/`buildSessionListViewData` signatures + deleted multi-account state. Load-bearing three-extent / seq invariants (happy-app AGENTS.md "Socket-prefetch pagination invariants"). Adopting upstream wholesale re-adds the social graph + unread the fork deliberately removed. |
| `happy-app/sources/sync/sync.ts` | 2037 | 2548 | **15** | **IRREDUCIBLE** | One `Sync` class; private methods share `this` state. Fork is *smaller* — it **removed** ~500 lines (multi-account + per-session E2E + attachment-upload) and **replaced** bodies (loopback `fetchMachines`, `decodeApiMessages` no-decrypt). Removals and body-replacements cannot be an additive overlay. "Adopt upstream + wrap" = reverting the fork's single-user architecture and its e-ink render-window prefetch — the exact opposite of the fork's purpose. No upstream seam to overlay against. |
| `happy-app/sources/app/(app)/new/index.tsx` | 583 | **1851** | **16** | **PARTIALLY RESTRUCTURABLE (R8-style)** | This is a **leaf UI screen**, not shared infra — the one convergent file that *can* be handled. Upstream **tripled** it (new-session right sidebar + FilesSidebar + richer machine/path/worktree/agent config); the fork keeps a lean e-ink screen. Move the fork screen to a fork-owned file (`sources/fork/newSession/`), let upstream's `new/index.tsx` come in near-clean, and have the route pick fork-vs-upstream by flag. **Removes it from the conflict set.** Cost ~M. Tradeoff: carry a parallel screen; re-port upstream new-session features by deliberate choice, not by merge. |
| `happy-cli/src/utils/MessageQueue2.ts` | 352 | 325 | **12** | **PARTIALLY** | Standalone generic `MessageQueue2<T>` util. Already carries `// FORK PATCH:` markers but is **un-catalogued** (should become **HC-8**). Fork divergence: attachment-by-ref type (`{type, ref, mimeType}`) vs upstream inline-bytes, plus consumption-ack delivery tracking (`MessageDelivery` + `consumedMessages`). Delivery-ack is *additive* (could be a wrapper); attachment-by-ref is a *type replacement* threaded through batch-consumption bodies. ~half convergeable toward upstream shape, ~half stays manual. Small surface (12 hunks); catalogue + partial-converge is the right move, not a rewrite. |

**Cross-file conclusion:** the "adopt upstream + wrap" hypothesis **succeeds only for leaf UI** (`new/index.tsx`, and the broader R8 component set) and **fails for the sync core** (`sync.ts`, `storage.ts`) because their divergence is dominated by *removals* and *convergent body-rewrites* against a *monolithic, seam-less* upstream. The R5 verdict holds even under the aggressive lens. The floor is: **~sync.ts + storage.ts + the ~half of MessageQueue2 + a handful of sibling sync files (`messageMeta`, `reducer`, `apiSession`) = roughly a dozen permanent manual-3-way core files.** Everything else is either auto-mergeable, mechanically take-ours (KEEP-DELETED), or R8-seamable.

---

## 6. Recommendation — phased hybrid

**Adopt Option 3.** Concrete sequence, each phase a candidate Ralph task:

### Phase 1 — Establish lineage (do now; effort S–M, ~1–2 days)
1. **Commit a real `git merge cli-1.1.10`** into fork main. Resolution policy: **take-ours-dominant** (fork HEAD already carries the reconciled cli-1.1.10 intake), spot-adopt the few upstream deltas worth taking. Gate with `pnpm --filter happy-app typecheck` + the fork sync test suite (`paginationMath`, `prefetchManager`, `messageWindow`, `applyPrefetchedRange`, `storage.tree`, `storagePermissionModeUserChosen`, etc.) + `happy-cli`/`happy-server` typechecks.
2. **Bake the `merge=ours` driver into the intake runbook** (`git config merge.ours.driver true` — already set here; make it a documented one-time host step so a fresh clone gets it).
3. Update `docs/happy-patch-surface.md §6` baseline + §9 cadence to record the merge commit as the new lineage anchor.
   - *Decomposes to:* `happy-establish-merge-lineage-cli-1.1.10` (impl).

### Phase 2 — Flip cadence to per-release `git merge` (effort S)
4. Change the intake process from "selective per-file 3-way" to "`git merge <new upstream tag>` per release." First target after Phase 1: `upstream-happy/main` (3 commits / 7 files past cli-1.1.10) as a *proof* that the incremental merge is tiny.
   - *Decomposes to:* `happy-per-release-merge-cadence` (docs + runbook) + `happy-intake-upstream-main-post-1.1.10` (first incremental merge).

### Phase 3 — Shrink the UI surface opportunistically (effort M–L, ongoing)
5. Continue R8 overlay extraction for the remaining high-hunk UI files (`SessionView` 19, `useGroupedMessages.test` 19, `MessageView`/`ChatList`/`AgentInput` 11 each).
6. **Restructure `new/index.tsx`** into a fork-owned e-ink screen behind a route flag (the one convergent file that yields to the aggressive approach — §5).
   - *Decomposes to:* `happy-r8-remaining-ui-overlays`, `happy-new-session-screen-fork-owned`.

### Phase 4 — Catalogue + accept the manual core (effort S)
7. Add the un-catalogued CLI/sync hotspots as catalogue rows with resolution recipes: **HC-8** `MessageQueue2.ts`, `sessionScanner.ts`, `utils/log.ts`, plus the R5 **HA-1a/HA-2a** KEEP-DELETED rows.
8. **Accept** `sync.ts` + `storage.ts` (+ ~half of `MessageQueue2`, `messageMeta`, `reducer`, `apiSession`) as permanent manual-3-way, resolved via the per-cluster recipe already written in `.ralph/brainstorms/happy-app-r5-sync-plane-residual §5`.
   - *Decomposes to:* `happy-catalogue-uncatalogued-sync-hotspots`.

**Rough total effort:** Phase 1 is the only near-term cost (~1–2 days) and unlocks the whole benefit. Phases 2–4 are spread across future releases and pay for themselves each merge.

**What you get:** upstream tracking IS a real `git merge` (the operator's stated goal), each future release is an incremental merge of only its delta, the UI surface shrinks over time, and the irreducible sync core is a small, bounded, recipe-driven manual set — not a full re-derivation.

**What you do NOT get (be honest):** a codex-grade "replay a tiny patch set with zero manual resolution." Happy's monolithic, seam-less upstream sync plane forbids it without upstream seam PRs.

---

## 7. Operator-decision calls

1. **Submodule vs. stay-vendored?** — **Recommend: STAY vendored + establish lineage.** A submodule is codex's *mechanism* but is **not required** for rebasability — **lineage is what's required**, and an in-tree vendored copy can carry lineage and be `git merge`d just fine (proven by the throwaway merge). A submodule migration is a large, risky change and the monorepo currently depends on `packages/happy-*` being in-tree (pnpm workspace, the shared `@slopus/happy-wire` package). Defer submodule conversion unless a separate driver appears.
2. **How much upfront restructure investment?** — **Recommend: minimal now** (just the Phase-1 lineage merge), overlay-refactor incrementally. Do **not** fund a big-bang overlay rewrite of the sync plane — §5 shows it hits a hard ceiling.
3. **Adopt upstream's convergent files wholesale (losing fork behavior)?** — **sync.ts / storage.ts: NO** — that reverts single-user architecture, no-E2E, loopback machines, and the e-ink render-window prefetch (all load-bearing). **new/index.tsx: MAYBE** — adopt upstream's screen behind a flag while the fork keeps its lean e-ink screen as a fork-owned file (this is the recommended Phase-3 move).
4. **Big-bang merge resolution policy: take-ours-dominant vs. re-review-every-hunk-for-upstream-deltas?** — **Recommend take-ours-dominant + spot-adopt.** The merge exists to buy *lineage*, not features — cli-1.1.10's features were already intaken selectively. Re-reviewing all 382 hunks for upstream deltas would re-do the intake; instead, take-ours and separately cherry-pick any specific upstream improvement worth having.
5. **Merge target: `cli-1.1.10` (tag) or `upstream-happy/main` (+3 commits)?** — **Recommend merge the `cli-1.1.10` tag** for a clean release-anchored lineage point, then do the 3-commit `main` delta as the first *incremental* merge in Phase 2 (which also validates the incremental-merge property immediately).
6. **Should upstream seam PRs be pursued (to eventually make the sync core overlay-able)?** — Optional, slow, external-dependency, and upstream may reject single-user hooks. Treat as a *separate* long-horizon bet (the "upstream-the-good-parts" / PR #1154 pattern), not part of the rebasability workstream. Not recommended as a dependency of Phases 1–4.

---

## Appendix — reproducibility

- Throwaway merge: `cd .worktrees/bs-happy-rebasable && git merge --no-commit --no-ff cli-1.1.10` → counted `git diff --name-only --diff-filter=U` (115) and `^<<<<<<<` markers per working-tree file (382 hunks) → `git merge --abort`. Worktree restored clean; scratch files removed.
- Topology: `git merge-base HEAD cli-1.1.10` = `df4cdae8`; `git rev-list --count HEAD ^cli-1.1.10` = 2580; `git rev-list --count cli-1.1.10 ^df4cdae8` = 213; `git merge-base HEAD upstream-happy/main` = `df4cdae8` (still — no lineage yet); `git rev-list --count upstream-happy/main ^cli-1.1.10` = 3; `git diff --name-only cli-1.1.10 upstream-happy/main` = 7 files. `merge.ours.driver` = `true` (verified).
- Convergent file sizes: `git show cli-1.1.10:<path> | measure` vs fork HEAD.
- Top conflict hunks (this merge): storage.ts 27, SessionView.tsx 19, useGroupedMessages.test.ts 19, new/index.tsx 16, sync.ts 15, MessageQueue2.ts 12, MessageView.tsx 11, ChatList.tsx 11, AgentInput.tsx 11.
