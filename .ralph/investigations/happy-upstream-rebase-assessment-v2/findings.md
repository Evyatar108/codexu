# Post-M1 upstream rebase conflict-surface assessment (v2)

**Task:** `happy-fork-upstream-divergence-reconciliation`
**Date assessed:** 2026-07 (fork HEAD `58723b9e`, worktree `ralph/assess-upstream-rebase`)
**Upstream target:** `cli-1.1.10` @ `71c417e1092e73cf34eb24f9601d569394c1f359` (2026-06-23, latest release) — cross-checked `origin/main` @ `d2ef88de` (3 commits past the tag; no newer release tag exists).
**Import baseline (release anchor):** `cli-1.1.8` @ `b72fd8111a43395e9991cfbdabba36f5a3285e5e` (2026-04-27).
**Scope:** read-only. Markdown deliverable only. No production code changed.

---

## TL;DR (answers to the operator's three questions)

1. **Can we rebase on upstream?** **No — a real `git rebase`/`git merge` is IMPOSSIBLE.** codexu's `packages/happy-*` is a **history-detached vendored copy** with **no git merge-base** with slopus/happy. The only viable intake is **selective cherry-pick / per-file 3-way port** governed by `docs/happy-patch-surface.md`.

2. **Which conflicts do we have NOW (post-M1)?** Measured with a real 3-way `git merge-file` (BASE=cli-1.1.8, OURS=fork HEAD, THEIRS=cli-1.1.10): **103 hard-conflict files** — **happy-app 59, happy-cli 33, happy-server 9, happy-agent 2, happy-wire 0.** happy-app is **57%** of the entire surface.

3. **The uncomfortable finding on M1:** measured apples-to-apples, **M1 removed ZERO hard-conflict files.** Its real value was **conflict localization** (fork logic relocated into 6 zero-conflict fork-owned modules + a documented catalogue), which cuts per-conflict *resolution effort* on most server seams — not the file COUNT. See §2.3.

4. **Top M2+ lever:** attack **happy-app** (untouched by M1, 59/103 of the surface) — the sync plane (R5) and e-ink UI components (R8). See §3.

---

## 1. Topology verdict — rebase is impossible

### Evidence
- codexu is a **monorepo**; upstream ships `happy-app`, `happy-cli`, `happy-server` as **separate repos**. codexu's `packages/happy-*` trees were **bulk-imported** during the monorepo restructure (`7f178466`), carrying **no slopus commit ancestry**.
- `git merge-base <codexu HEAD> <upstream cli-1.1.10>` returns **nothing** — the upstream commit object is not even reachable in codexu's object store. There is no common ancestor to rebase/merge against.
- The "baseline" `cli-1.1.8` is a **temporal/release ANCHOR** used to reason about *what upstream changed*, **not a true merge-base**: on an 8-file sample, **0/8** fork files matched the cli-1.1.8 blob byte-for-byte (the fork edited all of them). So even the anchor isn't a clean base.

### Consequence — the only viable intake mechanism
**Selective cherry-pick / per-file 3-way port**, governed by the catalogue `docs/happy-patch-surface.md`:
- For each upstream-canonical file, do a manual 3-way (`base`=cli-1.1.8 blob, `ours`=fork file, `theirs`=new upstream file) via `git merge-file`, resolving hunks against the catalogue's KEEP / KEEP-DELETED / RESTORE rows.
- Fork-only additive trees (`codex/`, `agentComms/`, `tunnel/`, `daemon/`) are **pure adds** — zero intake conflict; just carry them forward.
- This is inherently **package-sequenced and file-triaged**; a single big-bang merge is not an option and never will be under this topology.

---

## 2. Current conflict heatmap (post-M1)

### 2.1 Method (reproducible + defensible)
- **BASE** = `cli-1.1.8` tree; **THEIRS** = `cli-1.1.10` tree — both extracted via `git -C D:/harness-efforts/happy archive <ref> packages/happy-{app,cli,server} | tar -x` into scratch dirs.
- **OURS** = the fork's current worktree files.
- For every file present in **OURS ∩ THEIRS** where **both differ from BASE**, run `git merge-file -p --diff3 <ours> <base> <theirs>`:
  - exit **0** → clean auto-merge;
  - exit **N>0** → **hard-conflict** (N conflict hunks);
  - add/add (no base) with ours≠theirs → counted as hard-conflict (empty-base 3-way).
- Skips: binary (null-byte scan), `dist/`, `pnpm-lock.yaml`, image/font extensions.
- Two independent implementations (worktree `git ls-files` vs. extracted-tree walk) produce **identical** numbers.

### 2.2 The number that matters — hard-conflict files by package (vs cli-1.1.10)

| package | **HARD-conflict (true 3-way)** | clean auto-merge | intersection proxy* | fork-only (additive, 0-conflict) |
|---|---:|---:|---:|---:|
| **happy-app** | **59** | 17 | 76 | 254 |
| **happy-cli** | **33** | 11 | 44 | 187 |
| **happy-server** | **9** | 5 | 14 | 32 |
| happy-agent | 2 | 0 | 2 | 13 |
| happy-wire | 0 | 3 | 3 | 28 |
| **TOTAL** | **103** | 36 | 139 | 514 |

\* *intersection proxy* = files where both sides simply differ from base (the looser, name-level metric the **prior** assessment used). It over-counts because two files can both change without textually conflicting.

Other categories (informational): **upstream-new-on-intake** = 118 files (app 68, cli 39, server 11) — new upstream files to add; **fork-deleted-upstream** = 126 files (app 95, cli 5, server 26) — files the fork removed that upstream still ships (mostly the deleted multi-tenant/auth plane, KEEP-DELETED).

### 2.3 Delta vs the prior 187 — and M1's TRUE impact

The prior (pre-M1) assessment reported **187 hard-conflict files** (app 101, cli 58, server 23, agent 2, wire 3) using a **name-level intersection** (`fork-touched ∩ upstream-touched`).

| metric | app | cli | server | agent | wire | total |
|---|---:|---:|---:|---:|---:|---:|
| **Prior (pre-M1), intersection method** | 101 | 58 | 23 | 2 | 3 | **187** |
| **Now, same intersection method** | 76 | 44 | 14 | 2 | 3 | **139** |
| **Now, true 3-way merge-file** | 59 | 33 | 9 | 2 | 0 | **103** |

**Do NOT read this as "M1 dropped 187 → 103."** The drop is almost entirely **method + target precision**, not M1:
- The prior **187 is an intersection UPPER-BOUND** (any file both sides touched), measured against a further-ahead `origin/main`. The true 3-way (**103**) only counts files that actually produce conflict markers — a stricter, more accurate metric.
- **M1's isolated file-count impact = 0**, proven by running the **identical** analyzer over three trees:

| tree | app | cli | server |
|---|---:|---:|---:|
| pre-M1 parent `f07ef95e` | 59 | 33 | 9 |
| exact M1-end `228c3829` | 59 | 33 | 9 |
| post-M1 HEAD `58723b9e` | 59 | 33 | 9 |

All three are **byte-identical in count**. M1 was a **behavior-preserving relocation**: it moved fork logic bodies into new fork-owned files but left a **seam call-site** in each upstream-canonical file, so the file still diverges from upstream and still registers as a hard-conflict when upstream also touches it.

**What M1 actually bought (real, but not a count reduction):**
- Fork logic now lives in **6 named, tested, zero-conflict fork-owned modules**: `forkAuthPlane.ts`, `operatorIdentityGate.ts`, `sessionPayloadCodec.ts`, `onCodexRun.ts`, `onClaudeRun.ts`, `forkHooks.ts`.
- Resolving a seam-file conflict on intake becomes "**re-apply a ~1-line seam call**" instead of "re-derive a 100-200-line inline block" → lower per-conflict effort + regression risk.
- Fork-vs-upstream **diff-line magnitude** shrank on 5 of 9 seam files: `api.ts` −36, `index.ts` −35, `daemon/run.ts` −179, `apiMachine.ts` −45, `socket.ts` −9.
- **Honest caveat:** `runCodex.ts` **+177** and `runClaude.ts` **+209** GREW — those entry bodies are ~entirely fork-owned end-to-end, so seam scaffolding *added* lines (the catalogue's "thin reduction only" caveat for HC-4/HC-5). Further "seaming" of these two has low ROI; treat them as accepted manual-merge cost centers.

### 2.4 Biggest remaining hotspots (conflict hunks, vs cli-1.1.10)

**happy-app (59 files — the dominant, M1-untouched surface):**
`SessionView.tsx` (30), `sync/storage.ts` (24), `sync/sync.ts` (23), `app/(app)/new/index.tsx` (20), `AgentInput.tsx` (12), `ChatList.tsx` (10), `SidebarView.tsx` (10), `sync/messageMeta.test.ts` (9), `ChatHeaderView.tsx` (7), `markdown/MarkdownView.tsx` (7), `SidebarNavigator.tsx` (7), `MessageView.tsx` (6).

**happy-cli (33 files):**
`utils/MessageQueue2.ts` (12) — **not catalogued**, the #1 CLI hotspot; `api/apiSession.ts` (11) — catalogued HC-1/2/3, M1 relocated the codec but the file still conflicts; `apiSession.test.ts` (7); `claude/.../sessionScanner.ts` (6) — **not catalogued**; `claudeLocalLauncher.ts` (4); `apiMachine.ts` (3), `claudeRemoteLauncher.ts` (3), `runClaude.ts` (3), `query.ts` (3).

**happy-server (9 files):**
`api/api.ts` (6) — HS-1/2 seam still conflicts; `package.json` (5) — mechanical; `utils/log.ts` (4) — **not catalogued**; `socket.ts` (3) — HS-3; `eventRouter.ts` (2); `index.ts` (1).

### 2.5 M1 seam-file status now (vs cli-1.1.10)
| seam file | status |
|---|---|
| `happy-server/.../api.ts` | HARD (6 hunks) |
| `happy-server/.../socket.ts` | HARD (3) |
| `happy-server/.../index.ts` | HARD (1) |
| `happy-server/.../v3SessionRoutes.ts` | **clean auto-merge** (only seam file fully resolved) |
| `happy-cli/.../apiSession.ts` | HARD (11) |
| `happy-cli/.../apiMachine.ts` | HARD (3) |
| `happy-cli/.../runClaude.ts` | HARD (3) |
| `happy-cli/.../runCodex.ts` | HARD (2) |
| `happy-cli/.../daemon/run.ts` | HARD (1) |

The seams still register as hard-conflicts (the call-site diverges), but each is now a **small, catalogued, localized** hunk rather than a large inline block.

---

## 3. Ranked M2+ reduction recommendations

Effort: **S** ≈ <½ day, **M** ≈ 1-3 days, **L** ≈ multi-day/ongoing. "Est. reduction" = hard-conflict files plausibly removed or materially shrunk.

| # | Recommendation | Est. reduction | Effort | Notes |
|---|---|---:|:--:|---|
| **1** | **R8 — happy-app e-ink UI seams.** Move default-off e-ink behavior out of shared components (`SessionView` 30, `AgentInput` 12, `ChatList` 10, `SidebarView` 10, `MarkdownView` 7, `ChatHeaderView` 7) behind fork hooks/wrappers (`useEinkMode`, `<EinkChatList>`, etc.). | ~6-10 app files shrunk/removed | **M-L** | Highest-leverage: happy-app is 57% of the surface and M1 never touched it. Not all divergence is e-ink (some is genuine feature drift) — expect shrink, not elimination. |
| **2** | **R5 — happy-app sync plane.** `sync/sync.ts` (23), `sync/storage.ts` (24), `reducer`, `messageMeta`. The single-user sync rewrite. | LOW-MED count; HIGH magnitude | **L / ongoing** | The **honest residual**: overlay CANNOT fix this. Strategy = "upstream-the-good-parts" (the PR #1154 pattern) + accept manual per-file 3-way each intake. Biggest per-file conflict magnitude in the repo. |
| **3** | **Catalogue + seam the un-catalogued CLI hotspots.** `utils/MessageQueue2.ts` (12 — #1 CLI), `claude/.../sessionScanner.ts` (6), `claudeLocalLauncher.ts` (4). | ~3-6 cli files | **S-M** | These are the biggest CLI conflict sources yet **absent from the HC-* catalogue**. Add rows; relocate fork changes behind seams, or minimize gratuitous diff toward upstream. |
| **4** | **Mechanical-noise reduction + `.gitattributes` merge driver.** `merge=ours` for lockfiles/`dist/`; set `git config merge.ours.driver true` in the intake runbook; normalize `package.json` version/dep churn (server 5, app 3). | ~3-5 files + ongoing noise | **S** | Catalogue §7 defines the attributes but the one-time driver config + runbook step is missing. `merge=union` remains **UNSAFE** for typed TS translations (TS1117 duplicate-key). |
| **5** | **Set up a permanent upstream remote + per-release sync cadence.** Add `slopus/happy` as a real remote (or keep the mirror), intake **every** upstream release, not every N months. | 0 direct; prevents growth | **S** | codexu is ~2 releases / ~2 months behind; the surface grows with every skipped release. Small, frequent intakes are far cheaper than big-bang. |
| **6** | **HC-3 latent decrypt asymmetry** (correctness, not conflict-surface). Fork fetch/cold-start still calls `decrypt()` while send/live are plaintext. | 0 conflict files | **S-M** | Flag as a **latent data-integrity bug**, fix in a separate behavior-changing milestone (needs a payload-format decision), not folded into intake. |

**Deprioritized:** R6 (i18n) — no translation file appears in the current top hotspots, so translations are not presently a material conflict source; keep the fork-namespace-strings fix on the shelf but below 1-4. Further seaming of `runCodex.ts`/`runClaude.ts` — low ROI (they grew under M1); accept as fork-owned cost centers.

---

## 4. Recommended intake strategy

1. **Anchor on the release tag** (`cli-1.1.10` today), not `origin/main`, for reproducibility and catalogue alignment.
2. **Selective cherry-pick / per-file 3-way**, governed by `docs/happy-patch-surface.md`. For each conflicting file: `git merge-file --diff3 <ours> <cli-1.1.8 blob> <cli-1.1.10 blob>`, resolve against the catalogue row (KEEP / KEEP-DELETED / RESTORE), re-apply the seam call where relocated.
3. **Package-sequence easiest → hardest** to validate the flow before the cost center:
   **happy-server (9)** → **happy-cli (33)** → **happy-app (59)** → happy-agent (2) / happy-wire (0, free).
   Carry the fork-only additive trees (`codex/`, `agentComms/`, `tunnel/`, `daemon/`) forward untouched.
4. **Add a permanent upstream remote and adopt a per-release cadence** (rec #5). Do the **first** intake soon — the fork is ~2 releases behind and the gap compounds.
5. **Keep the catalogue current**: add the un-catalogued hotspots (MessageQueue2, sessionScanner, log.ts) as HC-* rows during the first intake so the next one is cheaper.

---

## Appendix — reproducibility

- Analyzer: `_scratch/analyze2.js` (full) and `_scratch/analyze3.js` (parameterized `<oursDir> [theirsDir]`); raw output `_scratch/result.json` (deleted before commit — regenerate from the trees).
- Trees extracted with `git -C D:/harness-efforts/happy archive <ref> packages/... | tar -x` for `cli-1.1.8`, `cli-1.1.10`, and the fork commits `f07ef95e` (pre-M1), `228c3829` (M1-end), `58723b9e` (HEAD).
- The upstream mirror `D:/harness-efforts/happy` was **only fetched** (`git fetch origin --tags`); no local branches modified.
