# Happy-fork ⇄ upstream `slopus/happy` — conflict-surface assessment & merge strategy

**Task:** `happy-upstream-conflict-surface-and-merge-strategy` · **Mode:** read-only research (no source edits, no git commit/push, no merge/rebase run).
**Date:** 2026-07-02 · **Upstream compared:** `slopus/happy` `origin/main` `f6adffb4` (2026-07-02) + latest release `cli-1.1.10` `71c417e1` (2026-06-23).
**Method:** tracked-only tree archives of three trees (codexu HEAD, standalone `Evyatar108/happy` `fork/main`, upstream `origin/main`) extracted to a scratch dir and diffed with `git diff --no-index --name-status/--numstat`; true 3-way conflict computed from the standalone fork's real `merge-base`; "next-merge" conflict set computed as the intersection of codexu inline-edits with upstream files changed since codexu's ~2026-05-03 sync baseline. All source claims cite `file:line`.

> **Relationship to prior art.** The strategic *direction* was already chosen in
> `.ralph/brainstorms/happy-fork-upstream-divergence-reconciliation/` (D-002 restore-auth+E2E wedge) and the auth divergence was source-verified in
> `.ralph/investigations/happy-server-auth-fork-vs-upstream/findings.md`. Those left one thing **unquantified** — the actual per-package conflict heatmap and first-merge sizing. **This document supplies that missing quantification** and turns it into a sequenced merge strategy. It does not re-litigate the D-002 decision.

---

## 1. Topology resolution (the thing to get right first)

**One-line answer:** codexu's `packages/happy-*` is a **vendored, history-detached copy** of happy that has become the **live fork** and has **no git merge-base with `slopus/happy`**; the standalone `Evyatar108/happy` clone is a **true git fork (has ancestry) but is frozen at 2026-05-02** and is NOT a viable inbound-merge vehicle — so upstream intake must be **selective cherry-pick / manual port, not a DAG rebase or a single 3-way merge.**

Evidence:

| Fact | Evidence |
|---|---|
| codexu remotes | `origin=evmitran_microsoft/codexu`, `personal=Evyatar108/codexu` (`git remote -v`). codexu is a **superset monorepo**, not the happy fork repo. |
| **No merge-base with upstream** | Upstream HEAD `f6adffb4` and older `21c6ced0` are `Not a valid object name` in codexu's object store (`git cat-file -t`). codexu's happy tree entered via a monorepo restructure `7f178466` "fix: fix monorepo" (2026-01-27, renamed `server → packages/happy-server` etc.); brainstorm-verified as a 1163-file bulk import whose earliest SHA is absent from slopus history. **`git merge-base` is empty even though the trees are structurally identical.** |
| Standalone `Evyatar108/happy` (`D:/harness-efforts/happy`, remote `fork`) is a **true fork** | remotes `origin=slopus/happy`, `fork=Evyatar108/happy`; `merge-base(origin/main, fork/main) = f6083b48` (2026-04-22). It retains upstream ancestry. |
| …but it is **frozen / stale** | `fork/main` HEAD = `b592d917` **2026-05-02** ("docs(plan): …") — a *docs* commit; **338 ahead / 293 behind** upstream. It **lacks every codexu-era feature** (codex autoconnect, public server, agent-comms, subagent-sessions). |
| codexu **≠** standalone fork (independently divergent) | codexu-vendored vs `fork/main` per package, e.g. `happy-app`: **139 modified + 122 codexu-only + 93 forkstd-only**; `happy-cli`: 103 modified + 160 codexu-only + 11 forkstd-only. They have drifted in **both** directions. |
| Upstream is an **active monorepo, same package set** | `origin/main` packages = `codium, happy-agent, happy-app-logs, happy-app, happy-cli, happy-server, happy-wire`; codexu = same **+** only `codexu-plugin`, `codexu-options-mode-plugin`. `happy-wire/happy-agent/codium` are **upstream** packages, not fork-added. |
| **How far behind** | codexu's last sync was **~2026-05-03** (per `.agents/skills/happy-upstream-sync/SKILL.md`). Upstream has since shipped **~194 commits (179 touching `packages/`)** and **~2 releases** (`cli-1.1.8` 2026-04-27 → `cli-1.1.10` 2026-06-23). |

**Role separation (keep it):** `Evyatar108/happy` is the **outbound** PR-staging repo (its `ralph/*`, `feature/tablet-sidebar-toggle` branches exist to push fork work *up* to `slopus/happy`, per codexu AGENTS.md "Upstream cherry-picking discipline"). codexu is where development happens and where **inbound** upstream must land. These are two different flows and should not be conflated.

---

## 2. Divergence quantification (codexu HEAD vs upstream `origin/main`)

Tracked files only (no `node_modules`). "inline-M" = file exists in **both** trees but differs → **conflict candidate**. "fork-excl-A" = exists only in codexu → **zero conflict**. "upstream-only-D" = exists only upstream (fork deleted) → **deletion-conflict candidate**.

| package | inline-M (conflict cand.) | fork-excl-A (0-conflict) | upstream-only-D | +lines | −lines |
|---|---:|---:|---:|---:|---:|
| **happy-app** | **176** | 255 | 163 | +48,058 | −40,120 |
| **happy-cli** | **111** | 178 | 43 | +40,655 | −12,100 |
| **happy-server** | **45** | 25 | 36 | +6,278 | −7,263 |
| happy-agent | 18 | 13 | 0 | +7,591 | −800 |
| happy-wire | 9 | 28 | 0 | +17,888* | −43 |
| **TOTAL** | **359** | 499 | 242 | — | — |

\* happy-wire's `+17,888` is dominated by **tracked `dist/` build artifacts** + `README.md`; source divergence is small (see §5.8).

### The number that actually matters — the **next-merge hard-conflict set**

`git diff --no-index` above over-counts: a file can differ merely because upstream evolved it since codexu's baseline, not because the fork touched it. The **real** conflict set for the next intake is *(codexu inline-edited)* **∩** *(upstream changed since ~2026-05-03)*:

| package | codexu inline-M | upstream active since baseline | **HARD-CONFLICT (both)** |
|---|---:|---:|---:|
| **happy-app** | 176 | 173 | **101** |
| **happy-cli** | 111 | 101 | **58** |
| **happy-server** | 45 | 37 | **23** |
| happy-wire | 9 | 3 | 3 |
| happy-agent | 18 | 2 | 2 |
| **TOTAL** | | | **187** |

**187 files would conflict** on a naive merge of upstream HEAD into codexu today — **concentrated in `happy-app` (101) and `happy-cli` (58)**. This is why a single big-bang merge is the wrong tool and a triaged, package-sequenced intake is right.

---

## 3. Conflict-surface hotspots (ranked, with `file:line`)

### 3a. `happy-server` — the deployment-model / auth surface (highest strategic value to fix)
These are **upstream-canonical files the fork rewrote inline** to collapse multi-tenant→single-user and delete the auth plane. Restoring upstream shape (D-002) **removes them from the conflict surface**.

| rank | file:line | fork churn | what diverged |
|---|---|---:|---|
| S1 | `packages/happy-server/sources/app/api/api.ts:79-80` | +120/−128 | `authenticateTunnel` is a literal **no-op**; `authenticate` decorator wired to it in tunnel mode. Upstream calls `enableAuthentication(typed)` (fail-closed bearer verifier). |
| S2 | `packages/happy-server/sources/app/api/socket.ts:61-95` | +154/−117 | Socket.IO handshake is **fail-open** in tunnel mode. Upstream verifies `handshake.auth.token` → 401. |
| S3 | `packages/happy-server/sources/index.ts:101-108` | +235/−45 | `assertOperatorIdentityGate` bind-gate + dual-listener wiring (fork-specific startup). |
| S4 | `packages/happy-server/prisma/schema.prisma` | +55/−350 | **Multi-tenant `userId` scoping dropped** (single-tenant collapse). Mostly deletions. |
| S5 | `packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts:166-168` | +12/−38 | Server stores plaintext under a **mislabeled `{t:'encrypted'}`** (no server crypto). |
| S6 | `sources/app/events/eventRouter.ts` (+180/−76), `routes/accountRoutes.ts` (+72/−295), `routes/pushRoutes.ts`, `routes/sessionRoutes.ts`, `sources/main.ts` | — | route/fan-out edits from the single-user + agent-comms work. |

### 3b. `happy-cli` — auth/E2E + codex integration inline
| rank | file:line | fork churn | what diverged |
|---|---|---:|---|
| C1 | `packages/happy-cli/src/api/apiSession.ts:659` (no `encrypt()` at send) + `:316` (`JSON.parse(...content.c)` plaintext) | +539/−445 | **E2E encryption dropped**; `encrypt` imported (`:5`) but not called at the session send site. Top-3 CLI hotspot AND upstream-active. |
| C2 | `packages/happy-cli/src/api/api.ts` | +43/−338 | client-side auth-plane deletion (mostly removals). |
| C3 | `packages/happy-cli/src/codex/codexAppServerClient.ts` (+1245/−381), `src/codex/runCodex.ts` (+534/−347) | — | **codex app-server integration** — fork-unique feature, but living **inline** in the shared package + heavily upstream-active neighbors. |
| C4 | `packages/happy-cli/src/claude/runClaude.ts` (+271/−486), `src/claude/claudeLocalLauncher.ts` (+179/−29) | — | launcher/streaming edits on upstream-hot files. |
| C5 | `packages/happy-cli/src/daemon/run.ts` (+325/−109), `src/api/apiMachine.ts` (+243/−196) | — | daemon codex/tunnel wiring injected into upstream files. |

### 3c. `happy-app` — e-ink UX + sync/streaming rewrite (the largest cost center)
| rank | file:line | fork churn | what diverged |
|---|---|---:|---|
| A1 | `packages/happy-app/sources/sync/sync.ts` | +1004/−1607 | core sync loop **rewritten** (streaming/reconnect/e-ink). Upstream changes this constantly. |
| A2 | `packages/happy-app/sources/sync/storage.ts` (+745/−681), `sync/ops.ts` (+231/−383), `sync/reducer/reducer.ts` (+440/−140), `sync/apiSocket.ts` (+388/−190) | — | sync/reducer hotpath rewrites. |
| A3 | `packages/happy-app/sources/-session/SessionView.tsx` | +573/−517 | session view (e-ink render). |
| A4 | `packages/happy-app/sources/components/AgentInput.tsx` (+901/−425), `components/ChatList.tsx` (+354/−258) | — | composer + chat-list (e-ink/perf). PR #1154 pattern. |
| A5 | `packages/happy-app/sources/app/(app)/new/index.tsx` | +288/−1629 | new-session screen (mostly deletions). |
| A6 | `sources/text/_default.ts` + `translations/{pl,ru,es,ja,ca,…}.ts` | ~+253/−290 each | **mechanical** translation conflicts (≈10 files). Low-stakes but recurring. |

### 3d. Fork-**exclusive** files (ZERO conflict) — the discipline that is *already* working
The additive fork features are **already isolated in dedicated directories with no upstream equivalent** — exactly the codex-overlay discipline, applied organically:

| package | fork-exclusive cluster (file count) |
|---|---|
| happy-cli | `src/codex/` (41), `src/agentComms/` (33), `src/daemon/` (30 net-new), `src/tunnel/` (13) |
| happy-app | `sources/components/` (63 new), `android/app/` (52), `sources/sync/` (39 new), `sources/hooks/` (15), `sources/auth/` (12) |
| happy-wire | `src/node/`, `src/tunnel/`, `src/publicDeviceAuth.ts` |
| happy-agent | `src/tunnel/`, `src/ledger/`, `src/monitor.ts` |

**Implication:** the conflict surface is **not** the new features — those are clean overlays. It is (i) the **inline deployment-model rewrites** (auth/E2E/single-tenant on `api.ts`/`socket.ts`/`apiSession.ts`/`v3SessionRoutes.ts`/`index.ts`/`schema.prisma`) and (ii) the **deep inline edits to upstream-hot app files** (`sync.ts`, `storage.ts`, `reducer.ts`, `SessionView.tsx`, `ChatList.tsx`, `AgentInput.tsx`) plus **wiring hooks** injected into upstream `happy-cli` files.

---

## 4. Refactor recommendations (shrink the conflict surface)

Ordered by **conflict-reduction ÷ effort**. `from` = current inline divergence; `toSeam` = proposed fork-owned seam.

| # | from (`file:line`) | toSeam | effort | conflict-reduction |
|---|---|---|---|---|
| R1 | `happy-server/.../api.ts:79-80`, `socket.ts:61-95`, `auth/auth.ts` (deleted `verifyToken`) | **Restore upstream `enableAuthentication.ts` verbatim**; put the single-user collapse in a fork-owned `auth/singleUserVerifier.ts` overlay that `verifyToken` delegates to (identity = `tofuConfig.localUserId`). *This is the D-002 wedge.* | M | **HIGH** — retires S1, S2, auth.ts from the hot set; brings `api.ts`/`socket.ts` back to near-vanilla. |
| R2 | `happy-cli/.../apiSession.ts:659,316`; `happy-server/.../v3SessionRoutes.ts:166-168` | **Re-activate upstream `encrypt()/decrypt()` call sites** (single-operator key; reuse `happy-agent/src/encryption.ts`); stop the plaintext mislabel. | S–M | **HIGH** — apiSession.ts is a top-3 CLI hotspot; re-adding upstream's crypto shape shrinks its diff and retires S5. |
| R3 | `happy-server/.../index.ts:101-108` | Extract `assertOperatorIdentityGate` + dual-listener wiring into `sources/fork/operatorIdentityGate.ts`; leave `index.ts` a thin upstream file with one call. | S | **MED** — S3 (+235/−45) shrinks to a 1-line hook. |
| R4 | `happy-cli/.../runCodex.ts`, `runClaude.ts`, `daemon/run.ts`, `apiMachine.ts` | Replace inline fork blocks with single `forkHooks.onXxx()` calls whose bodies live in the **already-isolated** `src/codex/` / `src/daemon/` overlays. Goal: shrink the *wiring footprint* in upstream files, not the features. | M/file | **MED** — reduces C3/C4/C5 diff size on upstream-hot files. |
| R5 | `happy-app/.../ChatList.tsx`, `SessionView.tsx`, `AgentInput.tsx`, `MarkdownView.tsx` | Move default-off e-ink behavior behind fork hooks/components (`useEinkMode`, `<EinkChatList>`) instead of inline branching; extend the existing 63-new-component pattern. | M | **MED** — converts A3/A4 from full-file rewrites toward additive wrappers. |
| R6 | `happy-app/sources/text/_default.ts` + `translations/*` | Put fork strings in a separate namespace file + merge; and/or `.gitattributes merge=union` on translation files. | S | **LOW/file** but removes ≈10 recurring mechanical conflicts. |
| R7 | `happy-wire/dist/**`, `happy-agent/dist/**` (tracked build output) | Gitignore `dist/` or `.gitattributes merge=ours`; build in CI. | S | **LOW** — removes generated-artifact diff/conflict noise. |
| R8 | `happy-app/sources/sync/sync.ts`, `storage.ts`, `ops.ts`, `reducer.ts` | **Do NOT overlay** (they are the core reducer). Instead: (a) minimize gratuitous diff, (b) upstream the good parts (PR #1154 pattern) so they stop being fork-only, (c) accept manual 3-way here as the tracked cost center. | L / ongoing | **LOW–MED**, but this is the honest residual — most of `happy-app`'s 101 hard-conflicts live here. |
| — | `happy-server/prisma/schema.prisma` | **KEEP-DELETED** — record in the catalogue; single schema file, not overlay-able. Mostly deletions, so upstream additions rarely conflict. | n/a | track-only. |

**Net:** R1–R4 (the D-002 restore + a few extractions) plausibly retire the majority of the `happy-server` (23) and a meaningful slice of the `happy-cli` (58) hard-conflicts by bringing rewritten upstream-canonical files back toward vanilla. `happy-app` stays the durable cost center and is best managed by discipline + selective upstreaming, not overlay.

---

## 5. Recommended merge/rebase strategy — ONE direction

### The direction
**Release-anchored *selective intake* (cherry-pick + manual port), governed by a new `docs/happy-patch-surface.md` invariant catalogue, with a conflict-surface paydown roadmap led by the D-002 auth+E2E restore.** *Not* a DAG rebase (impossible — no merge-base), *not* a single big-bang 3-way merge (187 conflicts, undesirable).

Why not the alternatives:
- **DAG rebase (codex-style):** requires shared ancestry. codexu has **none** with `slopus/happy`. Not applicable. (It works for the *standalone* fork, which has a base — but that fork is frozen and lacks codexu's work, so it can't carry codexu's state.)
- **Single 3-way merge via a synthetic baseline (`git read-tree`/`-X subtree` graft):** possible but high-effort/error-prone and dumps all 187 conflicts at once across fragile daily-use paths. Reserve only if selective intake proves too slow.
- **Re-fork from current upstream + re-apply behind seams (brainstorm D-003):** XL; declines by default (throws away ~1200+ fork commits). Revisit only if the heatmap proves the tree unmaintainable — it does **not** (the additive features are already clean overlays; the pain is bounded to a known ~187-file set).

### Anchor & cadence
- **Anchor on upstream RELEASE tags, not HEAD.** Latest = `cli-1.1.10` (`71c417e1`, 2026-06-23). Releases are stable cuts (upstream ships ~monthly: 1.1.7 Apr20 → 1.1.8 Apr27 → 1.1.10 Jun23). This matches the existing `happy-upstream-sync` skill and the codex rebase discipline (anchor on stable, not mid-PR-stack HEAD).
- **Cadence:** every upstream release, or every 4 weeks, whichever first; sooner for a security fix or a >30-commit release. Per-intake, prioritize **`happy-app`** (most upstream-active + most fork-wanted UI/perf fixes), then `happy-cli`, then `happy-server` (skip-until-D-002).

### Tooling
- **`.gitattributes`:** `merge=union` on `happy-app/sources/text/**` (translations); `merge=ours` (or gitignore) on tracked `dist/**` and lockfiles. A custom source merge driver is **not** worth it — the value is in the catalogue + triage, not automated hunk resolution.
- **`docs/happy-patch-surface.md`** — mirror codex's `codex/docs/implementation/patch-surface.md` (numbered invariant entries with SHA + description; `// SANDBOX PATCH:` marker convention). Buckets: **KEEP** (fork-unique value), **KEEP-DELETED** (single-tenant/route deletions to protect from re-merge), **RESTORE** (auth/E2E debt). Add `// FORK PATCH:` markers at each inline-edited upstream-canonical hunk so a future intake knows which hunks are intentional. This is the single highest-leverage *navigability* investment.
- **Baseline record:** add `slopus/happy` as a remote in codexu (or keep the `D:/harness-efforts/happy` clone as the upstream mirror) and record codexu's import-baseline commit (tree-match the ~2026-05-03 / `cli-1.1.8`-era state) in the catalogue so per-file 3-way `git checkout -p`/`cherry-pick` becomes possible.

### First-merge timing & risk
- **Do the first intake SOON — next cycle.** codexu is **~194 commits / ~2 releases / ~2 months behind**, and the gap grows ~50–100 commits/month; waiting only enlarges the 187-file set.
- **But run it as a *triaged, package-sequenced intake*, not a big merge.** Risk of a wholesale merge **today = MEDIUM-HIGH** (187 conflicts across fragile sync/auth paths). Risk of a triaged per-package cherry-pick intake = **LOW-MEDIUM**.
- **Sequence:** (1) stand up `docs/happy-patch-surface.md` + `.gitattributes` + baseline record; (2) ship the **D-002 auth+E2E restore** (shrinks `happy-server`/`happy-cli` hotspots *before* the first server-side intake); (3) run the first release-anchored intake on **`happy-app` only**, anchored on `cli-1.1.10`, using the existing `happy-upstream-sync` triage buckets; (4) then `happy-cli`; (5) `happy-server` last (post-D-002). Update the catalogue after each.

### Milestones
1. **M0 — Baseline & catalogue** (S): add upstream remote/mirror, record import baseline, create `docs/happy-patch-surface.md` (KEEP/KEEP-DELETED/RESTORE) + `.gitattributes` for translations/dist/lockfiles.
2. **M1 — D-002 restore** (M, already-decided task): restore upstream auth + E2E in single-user shape → retires S1/S2/S5 + shrinks C1. Do R3 (index.ts extraction) alongside.
3. **M2 — First intake: `happy-app` @ `cli-1.1.10`** (L, multi-day): triaged cherry-pick/manual/skip; land UI/perf fixes; apply R6 (translations) to stop the mechanical churn.
4. **M3 — `happy-cli` intake + R4** (M): extract codex/daemon wiring hooks; intake CLI fixes.
5. **M4 — `happy-server` intake** (S, post-D-002): now that auth is upstream-shaped, server intake is small.
6. **M5 — Steady state:** per-release cadence; catalogue updated each intake; e-ink app edits (R5) migrated to hooks opportunistically; upstream the good `sync`/`ChatList` parts (R8) to shrink the residual.

---

## 6. Open questions (not asserted)
- **Exact import baseline SHA.** codexu has no merge-base; the ~2026-05-03 / `cli-1.1.8`-era baseline is inferred from the sync-skill note and commit dates, not a verified tree-match. M0 should pin it by tree-matching a stable file.
- **`happy-app/sources/sync/*` residual.** After R1–R6, most of `happy-app`'s 101 hard-conflicts still live in the rewritten sync/reducer. Is the fork willing to (a) upstream those changes, or (b) permanently own manual 3-way merges there? This is the one surface overlay can't fix.
- **`.gitattributes merge=union` on translations** can produce duplicate keys; confirm the app's i18n loader tolerates/ dedupes, or prefer a separate fork-namespace strings file.
- **Standalone `Evyatar108/happy` fate.** Keep as outbound-PR staging only, or resync/retire it? It is 2 months stale and not on codexu's inbound path; leaving it stale is fine for outbound PRs but it should not be mistaken for codexu's upstream mirror.
- **Ownership.** Who runs the per-release intake and keeps the KEEP/KEEP-DELETED catalogue current? Without a named owner + visible cadence, the catalogue rots (same risk flagged in the brainstorm).
- **`happy-cli/src/codex/*` (74 fork-exclusive + heavy inline neighbors):** these are fork-unique but sit next to upstream-active files; confirm whether upstream's own codex/ACP work (e.g. Copilot ACP PRs) will start colliding — if so, R4's hook-extraction gets more urgent.
