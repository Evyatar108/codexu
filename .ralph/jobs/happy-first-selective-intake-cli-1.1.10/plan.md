# Plan — First selective upstream intake of `cli-1.1.10` into codexu `packages/happy-*`

**Task:** `happy-first-selective-intake-cli-1.1.10`
**Author:** PLAN-phase Ralph member
**Worktree/branch:** `.worktrees/plan-first-intake` @ `ralph/plan-first-intake` (off `main` @ `a0a42f03`)
**Governing catalogue:** [`docs/happy-patch-surface.md`](../../../docs/happy-patch-surface.md) (the per-file dispositions)
**Prior assessment:** [`.ralph/investigations/happy-upstream-rebase-assessment-v2/findings.md`](../../investigations/happy-upstream-rebase-assessment-v2/findings.md)
**Deliverables:** this `plan.md` + [`stories-outline.md`](./stories-outline.md)

---

## 1. Goal + honest framing

### 1.1 What this task is (and is not)

**Intake** = pull upstream's NEW work — the delta **`cli-1.1.8` → `cli-1.1.10`** — INTO the fork,
resolving each changed file per the catalogue disposition. It is **not** "make fork == upstream," and it
is **not** a `git rebase`/`git merge`. It is a **selective, per-file, 3-way cherry-pick**:

- **BASE** = `cli-1.1.8` (`b72fd811`, the §6 import baseline / temporal anchor).
- **THEIRS** = `cli-1.1.10` (`71c417e1`, the intake target tag).
- **OURS** = fork HEAD (`a0a42f03`).
- Upstream's *delta* for a file = `git diff cli-1.1.8 cli-1.1.10 -- <path>`. Empty ⇒ upstream didn't touch
  it ⇒ **not in the intake set**. Non-empty ⇒ the file is in-set and must be classified + resolved.

Fork-only trees (`codex/`, `daemon/`, `agentComms/`, `tunnel/`, `sources/fork/`, and every file upstream
lacks — 117 cli files + the app fork-only `sync/*` overlays) are carried **untouched**; they cannot
3-way-conflict because upstream has no blob at that path.

### 1.2 The REAL intake set is far smaller than the raw fork-vs-upstream file counts

The raw fork-vs-upstream divergence (101 server / 320 cli / 528 app "different" files) is a red herring —
it counts fork-only + upstream-only files that never intake-conflict. The **real intake set** is the
upstream *delta* ∩ each package, classified at fork HEAD (LF-normalized, `git merge-file -p --diff3`):

| package | upstream-delta files | clean-adopt (fork==base) | **HARD-conflict** (hand-merge) | clean-auto-merge | upstream-NEW (triage) | fork-deleted (KEEP-DELETED) |
|---|---:|---:|---:|---:|---:|---:|
| happy-server | 32 | 6 | **7** | 6 | 11 | 1 |
| happy-cli | 98 | 14 | **30** | 11 | 39 | 0 |
| happy-app | 190 | 37 | **59** | 17 | 62 (+6 add/add) | ~8 |
| **total** | **320** | **57** | **96** | **34** | **112+** | **~9** |

**The load-bearing number is the HARD-conflict column: 7 / 30 / 59 = 96 files** that need a real
hand-merge. Everything else is either mechanical (clean-adopt = take upstream + typecheck; clean-auto =
git resolves it, verify only), or a bucket decision (adopt vs skip an upstream-new file; never resurrect a
fork-deleted one). This matches the v2 findings' TRUE 3-way counts (9 / 33 / 59), reduced by the
R8/gitattributes/Rsrv ships landed since the findings' `58723b9e` measurement — so **re-measure per stage
at execution** (§7 appendix gives the command).

### 1.3 Is the first intake safe to fully automate?

**No — stage it; do not run one big pass.** The honest per-package risk profile:

- **Server (7 hard, all catalogued; strong gates)** — the safe **pilot**. Every hard file maps to an
  HS row; the 6-spec auth gate + typecheck + audit make regressions loud. The only unknowns are 2
  small uncatalogued *clean-auto* files and ~3 upstream-new ADOPT rulings (§6).
- **CLI (30 hard, ALL catalogued; strong recipe)** — also safe to *prepare* autonomously; every hard
  file maps to an HC row (verified §2.2). Risk is the package.json dep-pin traps (§4) + a large
  upstream-new triage.
- **App (59 hard: 22 catalogued + ~36 uncatalogued + the sync-plane manual-3-way)** — **not** a safe
  single autonomous pass. ~36 hard files have **no HA row** (known-uncatalogued-by-design per §5),
  ~8 fork-deleted files are **resurrection hazards** (encryption/multi-account/github planes), and the
  sync plane is a permanent `start-from-OURS` manual merge (HA-1/HA-2, 22+24 hunks). App needs a
  catalogue-extension sub-stage + operator review.

**Recommendation:** server-first pilot → cli → app, each a self-contained commit set gated
independently. See §5 for the story table and §6 for the autonomy recommendation.

### 1.4 The merge-base correction (catalogue GAP #0 — flag to operator)

The task brief and catalogue §6 both assert codexu is a **"history-detached copy … no `git merge-base`
exists."** **This is inaccurate.** `git merge-base HEAD cli-1.1.10` resolves to **`df4cdae8`** (2026-04-29,
"Merge PR #1203 fix/init-ready-hang"), 4 commits after `cli-1.1.8`. codexu genuinely descends from upstream
at `df4cdae8`; it is an ancestor of both fork HEAD and `upstream-happy/main`. Notably the catalogue's own
**§8 R5** section already cites this same commit (`BASE = true merge-base cli-1.1.7-89-gdf4cdae8`), so §6
and R5 are internally inconsistent.

**Why it does not change the plan:**
1. Classification is **identical** whether BASE = `cli-1.1.8` or BASE = `df4cdae8` (verified — the
   4-commit gap is classification-neutral for every bucket). So `cli-1.1.8` remains a perfectly good BASE
   and all numbers in this plan use it, consistent with §6's documented anchor.
2. A merge-base *existing* does **not** make a wholesale `git merge`/`rebase` safe. The fork deliberately
   deleted whole planes (multi-account HA-1a/2a, encryption, attachment HS-7, central-push HC-18/HS-12,
   static-webapp HS-7). A 3-way merge from `df4cdae8` would silently **resurrect every one of them** and
   produce catastrophic conflicts. The selective per-file strategy is correct **regardless** of merge-base
   existence.

**Operator call #0:** correct §6's "no merge-base" wording (point it at `df4cdae8`, reconcile with R5).
Keep `cli-1.1.8` as the documented BASE (classification-neutral, matches R5's start-from-OURS recipe).
This is a *documentation* fix, not a strategy change.

---

## 2. Enumerated intake set (per package)

Full per-file bucket lists are in
[`scratch/classification.json`](./scratch/classification.json); hard-conflict hunk counts are the live
`git merge-file` measurement (see [`scratch/mergefile.mjs`](./scratch/mergefile.mjs)).

### 2.1 happy-server (32 delta files)

**HARD-conflict (7 — all catalogued; hand-merge per HS row):**

| file | hunks | catalogue row | disposition |
|---|---:|---|---|
| `sources/app/api/api.ts` | 6 | HS-1/2/7/18 | KEEP (auth-plane + fork route arch); take upstream non-auth hunks by hand |
| `package.json` | 5 | HS-15 / §7 | manual-3-way; keep fork packaging; take dep bumps deliberately (Trap B) |
| `sources/utils/log.ts` | 5 | HS-11 | KEEP; reconcile onto upstream `pretty()`+`pino.multistream`; quiet-gate stays in `fork/forkLogger.ts` |
| `sources/app/api/socket.ts` | 3 | HS-3/9 | KEEP; **never** reintroduce per-socket `userId` |
| `sources/app/events/eventRouter.ts` | 2 | HS-10 | KEEP single-user room model; port only new event *kinds* |
| `sources/app/api/routes/pushRoutes.ts` | 1 | HS-12 | KEEP fork-owned single-user push route |
| `sources/app/monitoring/metrics2.ts` | 1 | HS-13 | KEEP; keep exact `db.count()`; no `Account` gauge |

**Clean-auto-merge (6 — git resolves; verify the result, don't blindly trust):**
`README.md`, `sources/app/api/routes/v3SessionRoutes.ts` (HS-4), `…/v3SessionRoutes.test.ts` (HS-4),
`sources/app/session/sessionDelete.ts` **(GAP — no HS row)**, `sources/storage/files.ts`
**(GAP — no HS row)**, `sources/storage/processImage.spec.ts` (HS-16, RESTORE upstream spec verbatim).

> **Server catalogue GAPS #1/#2:** `sessionDelete.ts` (fork −88 lines; upstream +13/−2) and
> `storage/files.ts` (fork rewrote; upstream +29). **Both auto-merge clean** (fork & upstream touched
> disjoint regions), so the gaps are **low-risk** — but they are genuinely uncatalogued. The server story
> must (a) verify the auto-merge output is behavior-correct, and (b) **add HS rows** for them (findings
> rec #5). `README.md` is a trivial doc gap (adopt upstream).

**Clean-adopt (6 — fork==base; take upstream wholesale + typecheck):**
`.gitignore`, `deploy/handy.yaml`, `sources/app/enableErrorHandlers.ts`,
`sources/app/monitoring/metrics.ts`, `sources/app/standalone.ts`, `tsconfig.json`.

**Add/add take-ours (1):** `sources/index.ts` — HS-14 whole-file **take-ours** embedded-server entry
(upstream also touched it; decline upstream's version).

**Fork-deleted / KEEP-DELETED (1):** `sources/app/api/routes/voiceRoutes.ts` — HS-7 (voice/attachment
plane removed). Do **not** resurrect.

**Upstream-NEW (11 — triage; adopt bugfixes fitting the fork's single-user/no-central-server posture,
SKIP multi-tenant/self-host/packaging):**

| file | signal | decision |
|---|---|---|
| `sources/app/api/routes/attachmentRoutes.ts` (+`.spec.ts`) | acct=8, userId=12 | **SKIP** — attachment plane removed (HS-7) |
| `sources/app/api/routes/machinesRoutes.spec.ts` | multi-machine | **SKIP** — replaced by machineSelfRoutes (HS-7) |
| `sources/app/push/pushDispatch.ts` | acct=3, userId=10 | **SKIP** — account-based push dispatch (fork push is HS-12) |
| `sources/app/monitoring/metrics2.test.ts` | acct=2 | **SKIP/adapt** — asserts the declined `Account` gauge (HS-13) |
| `sources/app/push/focusTracker.ts` | userId=2 | **operator call** — per-user focus (lean SKIP/adapt) |
| `bin/happy-server.cjs`, `bin/index.cjs`, `scripts/build-runtime.cjs` | upstream packaging bin | **SKIP** — fork uses pkgroll `dist/` (HS-15) |
| `sources/app/push/pushSend.ts` | acct=0, userId=0 | **ADOPT-candidate** — pure send transport, no tenancy |
| `sources/app/standalone.spec.ts` | test for adopted `standalone.ts` | **ADOPT-candidate** |

### 2.2 happy-cli (98 delta files)

**HARD-conflict (30 — ALL catalogued; zero cli gaps among hard files):**

| file(s) | hunks | HC row |
|---|---:|---|
| `src/utils/MessageQueue2.ts` (+`.test.ts`) | 12 (+1) | HC-8 |
| `src/api/apiSession.ts` (+`.test.ts`) | 11 (+7) | HC-1/2/3 |
| `src/claude/utils/sessionScanner.ts` (+`.test.ts`) | 6 (+1) | HC-9 |
| `src/claude/claudeLocalLauncher.ts`, `src/claude/session.ts` | 4, 1 | HC-10 |
| `src/api/apiMachine.ts` | 3 | HC-7 |
| `src/claude/claudeRemoteLauncher.ts`, `src/claude/claudeRemote.ts` | 3, 2 | HC-11 |
| `src/claude/runClaude.ts` | 3 | HC-5 |
| `src/claude/sdk/query.ts` | 3 | HC-13 |
| `src/codex/codexAppServerClient.ts` (+`.test.ts`), `src/codex/__tests__/executionPolicy.test.ts` | 1 (+3, +1) | HC-19 |
| `src/commands/codexCommand.ts` (+`.test.ts`) | 3 (+2) | HC-14 |
| `src/codex/runCodex.ts` | 2 | HC-4 |
| `src/configuration.ts`, `src/utils/serverConnectionErrors.test.ts` | 2, 1 | HC-12 |
| `src/api/api.ts` | 1 | HC-18 (guard-by-absence — do not resurrect push) |
| `src/claude/utils/permissionHandler.ts` | 1 | HC-15 |
| `src/claude/utils/sessionProtocolMapper.ts` | 1 | HC-16 |
| `src/daemon/run.ts` | 1 | HC-6 |
| `src/modules/common/registerCommonHandlers.ts`, `src/persistence.ts`, `src/utils/createSessionMetadata.ts` (+`.test.ts`) | 1 each | HC-17 |
| `package.json` | 1 | §7 / §4 manifest finding (Trap A/B) |

**Clean-auto-merge (11 — verify only):** `README.md`, `src/agent/acp/runAcp.ts`, `src/api/types.ts`,
`src/claude/loop.ts`, `src/claude/sdk/types.ts`, `src/claude/utils/sessionProtocolMapper.test.ts`,
`src/codex/codexAppServerTypes.ts`, `src/codex/executionPolicy.ts`, `src/index.ts`,
`src/utils/serverConnectionErrors.ts`, `vitest.config.ts`. (These were previously mis-flagged as
"uncatalogued gaps" — they auto-merge and need no HC row, just a post-merge verify.)

**Clean-adopt (14 — fork==base; take upstream + typecheck):** enumerated in `classification.json`
(`cli-1.1.8 › packages/happy-cli › buckets.cleanAdopt`).

**Upstream-NEW (39) + add/add (3):** triage per single-user/no-central-server posture — adopt bugfixes,
SKIP anything threading `userId`/account/central-push. Most upstream-new cli files land in fork-only
overlay dirs' *canonical* slots or are small utilities; enumerate + decide at execution (list in
`classification.json`).

### 2.3 happy-app (190 delta files)

**HARD-conflict (59):**

*Catalogued (22 files → HA rows):* `-session/SessionView.tsx`(26, HA-4), `sync/storage.ts`(24, HA-2),
`sync/sync.ts`(23, HA-1), `components/AgentInput.tsx`(12, HA-6), `components/SidebarView.tsx`(10, HA-10),
`components/ChatList.tsx`(8, HA-5), `components/MessageView.tsx`(8, HA-9),
`components/markdown/MarkdownView.tsx`(8, HA-8), `components/ChatHeaderView.tsx`(7, HA-12),
`components/SidebarNavigator.tsx`(7, HA-11), `components/markdown/parseMarkdownBlock.test.ts`(4, HA-8),
`text/translations/{ca,en,es,it,ja,pl,pt,ru,zh-Hans,zh-Hant}.ts`(4 each, HA-7), `text/_default.ts`(3, HA-7),
`sync/reducer/reducer.ts`(1, HA-3). Plus `package.json`(3, §7 manual-3-way).

*Uncatalogued — the app GAP class (~36 files, "known-uncatalogued-by-design" per §5):* the biggest is
**`app/(app)/new/index.tsx`** (20 hunks; fork 583 lines vs upstream 1851 — the fork stripped the
multi-account/machine-picker new-session screen to single-user). Others ≥3 hunks: `sync/messageMeta.test.ts`(9),
`sync/messageMeta.ts`(4), `components/tools/ToolView.tsx`(6), `components/ActiveSessionsGroupCompact.tsx`(5),
`hooks/useSessionQuickActions.ts`(5), `components/tools/views/CodexPatchView.tsx`(4),
`components/SessionsList.tsx`(3), `sync/apiSocket.ts`(3), `sync/suggestionCommands.ts`(3),
`sync/typesRaw.ts`(3); plus ~24 more at 1–2 hunks (routes `_layout.tsx`/`info.tsx`, `SettingsView.tsx`,
`FilesSidebar.tsx`, `PermissionFooter.tsx`, the `sync/*` type+persistence cluster, `changelog.json`,
`app.config.js`, `metro.config.js`, `modelModeOptions.*`, etc. — full list in `classification.json`).

> **App catalogue GAP class (#3):** these ~36 hard files have **no HA row**. §5 explicitly disclaims
> per-file completeness ("inventory of cost-centers only"). The app stage **must** add HA rows for the
> hottest of these (at minimum `new/index.tsx`, the `sync/messageMeta*` + `sync/typesRaw` cluster, the
> tools cluster) before/while resolving them — otherwise the intake silently hand-resolves un-governed
> files.

**Clean-auto-merge (17 — verify only):** incl. `app/(app)/dev/index.tsx`, `app/(app)/session/[id]/file.tsx`,
`…/files.tsx`, and 14 more (list in `classification.json`).

**Clean-adopt (37 — fork==base; take upstream + typecheck).**

**Fork-deleted / KEEP-DELETED (~8 — RESURRECTION HAZARD, GAP class #4):** `CLAUDE.md`,
`app/(app)/user/[id].tsx`, `auth/secretKeyBackup.spec.ts`, `encryption/base64.ts`, `encryption/deriveKey.ts`,
`sync/apiGithub.spec.ts`, `sync/encryption/encryption.ts`, `sync/encryption/encryptor.ts` — the removed
encryption + multi-account + github planes. A take-theirs anywhere near these **resurrects a whole removed
subsystem**. Guard-by-absence: after the app stage, grep `applyFriends`/`applyFeedItems`/`unreadSessionIds`/
`friendTypes` under `sources/sync` == **0** hits (HA-1a/2a).

**Upstream-NEW (62) + add/add (6):** triage — adopt UI bugfixes that fit e-ink single-user; SKIP
multi-account/encryption/github/realtime-voice additions.

---

## 3. `cli-1.1.10` (tag) vs `upstream-happy/main` (`d2ef88de`, +3 commits)

The intake target is the **stable tag `cli-1.1.10`** (`71c417e1`). `upstream-happy/main` is **3 commits
past** the tag (`d2ef88de`).

**Recommendation: intake to the tag `cli-1.1.10` first; defer the 3 post-tag commits to a follow-up
task.** Rationale: (a) the entire catalogue (§6, every HS/HC/HA row, R5, R8) is written against
`cli-1.1.10` blobs — intaking to the tag keeps the plan and the catalogue in lockstep; (b) the 3 post-tag
commits are unreleased HEAD churn (higher risk, no release gate, may be reverted upstream); (c) the §9
cadence explicitly advances the §6 baseline to the *imported tag*, not to a moving `main`. After the tag
intake lands and the baseline advances to `cli-1.1.10`, a follow-up can evaluate `d2ef88de` (or the next
`cli-1.1.x` tag, whichever the operator prefers) as its own small delta.

---

## 4. Per-file recipe (conflict resolution)

The per-file recipe is **sourced from the catalogue** — for every catalogued hard file, the §8 replant
note + the HS/HC/HA row IS the recipe. This section states the *mechanism* per bucket; the row citations
in §2 give the *disposition*.

### 4.1 Mechanism per bucket

- **clean-adopt (fork==base):** `git checkout cli-1.1.10 -- <path>` (or copy the upstream blob) →
  typecheck. No merge needed; fork never touched it. *Still gated* — an adopted file can pull a reference
  to a fork-removed construct.
- **clean-auto-merge:** run the 3-way; git resolves with no conflict markers. **Verify** the merged
  output compiles + preserves fork behavior (esp. the 2 server gaps + the app auto-merges near removed
  planes), then commit the merged file.
- **HARD-conflict (catalogued):** apply the row disposition:
  - **KEEP** ⇒ start from OURS; hand-port only upstream's *non-fork-divergent* hunks (bugfixes, new event
    kinds) — never take-theirs the fork-owned block.
  - **KEEP-DELETED** ⇒ take-ours; do **not** re-add upstream's re-introduction (guard-by-absence grep).
  - **RESTORE** ⇒ take upstream (deliberate behavior change; test it) — e.g. HS-16 processImage.spec.
  - **take-ours (whole file)** ⇒ HS-14 `index.ts`.
  - **manual-3-way** ⇒ package.json (§4.2), translations (§4.3), sync plane (§4.4).
- **HARD-conflict (uncatalogued app gap):** characterize the file (what did the fork change? what did
  upstream add?), decide KEEP vs adopt, **add an HA row**, then resolve. Default lean **KEEP** for the
  stripped single-user screens (e.g. `new/index.tsx`) — hand-port only non-account bugfixes.
- **upstream-NEW:** adopt-vs-skip per the single-user/no-central-server posture (§2 tables).
- **fork-deleted:** KEEP-DELETED unconditionally; never resurrect.

### 4.2 package.json (all three packages — manual 3-way, no driver)

Per §7 + the §4 manifest finding: **keep fork packaging + fork-only deps; take upstream dep bumps one at a
time with testing.**
- **Trap A:** do **not** alphabetically re-sort the `happy-server` workspace dep in happy-cli's manifest —
  it fuses with the version-bumped `fastify-type-provider-zod` line and manufactures an extra conflict
  hunk (proven by US-001). Leave it where it is.
- **Trap B (silent):** the fork pins several deps below upstream (`zod` v3, `prisma` 6.11,
  `@modelcontextprotocol/sdk`, `@anthropic-ai/claude-agent-sdk`, `fastify-type-provider-zod`). A 3-way
  merge takes upstream's newer version **cleanly, raising no conflict**, silently dropping the fork pin.
  **Re-verify every pin by hand after the merge.**

### 4.3 translations (`sources/text/**` — manual 3-way, NOT merge=union)

Per §7 i18n finding: `merge=union` is **unsafe** (TS1117 duplicate-key build failure + spliced invalid
TS). Resolve the 10 locale files + `_default.ts` by hand; keep the parity test
(`sources/text/translations.test.ts`) green. The R8 stages already added several keys (toolGroup,
chatToolGrouping, messageCommandChips, message.sentAsGoal) — reconcile upstream's new keys against them.

### 4.4 sync plane (`sync/sync.ts` HA-1, `sync/storage.ts` HA-2 — `start-from-OURS`)

Per §8 R5 (the authoritative recipe): **start from OURS; cherry-pick upstream's non-account changes by
hand; never take-theirs wholesale** (that resurrects multi-account HA-1a/2a). Concretely:
1. `git checkout --ours` both files.
2. `sync.ts`: prune upstream imports with no fork backing (`Encryption`, `apiFeed`, `apiFriends`);
   take-ours `fetchMachines` (loopback/tunnel), `sendMessage` (deferred-switch), `fetchMessages`
   (`decodeApiMessages`, **not** `decryptMessages`); evaluate — don't auto-adopt — any `awaitQueue`
   race-ordering port.
3. `storage.ts`: take-ours the multi-account removals (HA-2a), tree-grouping, `userChosen` mode, and
   render-window pagination fields.
4. **Verify absence:** grep `applyFriends`/`applyFeedItems`/`unreadSessionIds` under `sources/sync` == 0.
5. Gate: `pnpm --filter happy-app typecheck` + audit + the HA-1/HA-2 guard specs (`messageWindow.spec`,
   `applyPrefetchedRange.spec`, `machineFallbacks.test`, `storage.tree.spec`,
   `storagePermissionModeUserChosen.test`, `encryptionDeletion.spec`).
6. **HA-1b unread-tracking stays DEFERRED** (operator-gated) — drop upstream's unread additions.

---

## 5. Story table + ship order

Ship order is **server → cli → app** (low-risk pilot first; each stage a self-contained commit set with
its own gates; auth-plane server stories are **not** parallelized). Full acceptance criteria in
[`stories-outline.md`](./stories-outline.md).

| # | story | scope | gates | parallel-safe? |
|---|---|---|---|---|
| **S0** | Intake prep + baseline | `git config merge.ours.driver true`; fetch/verify tags; re-measure the heatmap; §6 merge-base correction (op call #0) | classification reproduces | — |
| **S1** | Server hard-conflicts (auth cluster) | api.ts, socket.ts (HS-1/2/3/7/9/18) | **FULL 6-spec auth set** + `pnpm --filter happy-server typecheck` + audit | ❌ (auth — serialize) |
| **S2** | Server hard-conflicts (non-auth) | log.ts, eventRouter.ts, pushRoutes.ts, metrics2.ts, package.json (HS-10/11/12/13/15) | server typecheck + audit + auth set (log/router touch startup) | ❌ after S1 |
| **S3** | Server clean-auto + clean-adopt + gaps | 6 auto-merge (incl. sessionDelete.ts/files.ts gaps → **add HS rows**), 6 clean-adopt, index.ts take-ours (HS-14), voiceRoutes KEEP-DELETED | server typecheck + audit | ✅ (after S1/S2) |
| **S4** | Server upstream-new triage | SKIP the 9 multi-tenant/packaging; ADOPT-eval pushSend.ts + standalone.spec.ts (op call) | server typecheck + audit | ✅ |
| **S5** | CLI hard-conflicts (E2E codec + queue) | apiSession.ts(+test) HC-1/2/3, MessageQueue2.ts(+test) HC-8 | `pnpm --filter happy typecheck` + `pnpm --filter happy test` (no `npm_config_script_shell=bash`) | ❌ (core send path) |
| **S6** | CLI hard-conflicts (claude/codex/daemon wiring) | HC-4/5/6/7/9/10/11/13/14/15/16/19 files | cli typecheck + test | ❌ after S5 (shared session graph) |
| **S7** | CLI hard-conflicts (config/metadata + manifest) | HC-12/17/18 files + package.json (Trap A/B) | cli typecheck + test + verify HC-12 default + pin re-check | ❌ after S6 |
| **S8** | CLI clean-auto + clean-adopt + upstream-new | 11 auto-merge (verify), 14 clean-adopt, 39 new (triage) | cli typecheck + test | ✅ (after S5–S7) |
| **A0** | **App catalogue-extension (operator-reviewed)** | add HA rows for ~36 uncatalogued hard files (new/index.tsx, messageMeta*, typesRaw, tools cluster, …); classify each KEEP/adopt | catalogue review; audit still 0-drift | ❌ (gates the rest of app) |
| **A1** | App sync plane (HA-1/HA-2 — start-from-OURS) | sync.ts, storage.ts + guard-by-absence | app typecheck + audit + sync guard specs | ❌ |
| **A2** | App UI seams (catalogued HA rows) | SessionView, AgentInput, ChatList, MessageView, MarkdownView, sidebar trio, reducer (HA-3/4/5/6/8/9/10/11/12) | app typecheck + audit + the HA guard tests | ❌ (many share imports) |
| **A3** | App uncatalogued hard files | new/index.tsx (KEEP) + the ~35 others per A0 rulings; KEEP-DELETED guard for the ~8 removed-plane files | app typecheck + audit + resurrection grep == 0 | partial |
| **A4** | App translations + _default (HA-7, manual) | 10 locales + `_default.ts` | app typecheck + `translations.test.ts` parity | ✅ (after A2) |
| **A5** | App clean-auto + clean-adopt + upstream-new | 17 auto-merge, 37 clean-adopt, 62 new (triage — skip encryption/multi-account/github/voice) | app typecheck + audit | ✅ |
| **Sfin** | Advance §6 baseline → `cli-1.1.10`; final full-package gates + audit `--strict` | all three packages | all gates + `node scripts/audit-happy-fork-patches.mjs --strict` | — |

**Ship rule (per stage):** after each stage's commit set, run that package's gates + the audit; the audit
must show **zero drift** before moving on (§9 step 6). Do **not** advance the §6 baseline until Sfin.

---

## 6. Risks + operator-decision calls

### 6.1 Operator-decision calls (flag before execution)

| # | call | recommendation |
|---|---|---|
| **#0** | §6 "no merge-base" is wrong (`df4cdae8` is the real merge-base; R5 already cites it). | **Correct §6 wording**; keep `cli-1.1.8` BASE (classification-neutral). Doc fix only. |
| **#1** | Server gaps `sessionDelete.ts` + `storage/files.ts` (uncatalogued, but clean-auto-merge). | Verify auto-merge behavior-correct; **add HS rows** in S3. Low risk. |
| **#2** | Server upstream-new ADOPT (behavior-changing): `pushSend.ts`, `standalone.spec.ts`, `focusTracker.ts`. | Rule per file in S4. Lean ADOPT pushSend/standalone.spec; SKIP/adapt focusTracker (per-user). |
| **#3** | App uncatalogued hard-conflict class (~36 files, incl. `new/index.tsx` 20 hunks). | **Operator review required**; catalogue-extension stage A0 before A3. |
| **#4** | App fork-deleted KEEP-DELETED class (~8 files: encryption/multi-account/github). | Guard-by-absence; **never resurrect**. Grep gate in A3. |
| **#5** | `cli-1.1.10` tag vs `upstream-happy/main` (+3 commits). | **Intake the tag**; defer the 3 commits (§3). |
| **#6** | HA-1b unread-tracking RESTORE? (catalogue-deferred). | **Keep deferred** (e-ink repaint churn); drop upstream's unread additions. |
| **#7** | package.json dep-bump adoption (all 3 packages; Trap A/B). | Take each bump by hand + re-verify fork pins; do not re-sort. |
| **#8** | Every **RESTORE/adopt** changes observable behavior. | Each adopt is deliberate + tested; list them in the stage commit message. |

### 6.2 Risks

- **CRLF trap:** tree-to-tree diffs are LF-clean, but `git merge-file` runs on *checked-out working files*
  (Windows autocrlf→CRLF) → normalize OURS/BASE/THEIRS to LF before every merge-file (the appendix
  scripts do this). Skipping it collapses every file to a whole-file conflict.
- **Silent resurrection:** the fork's removed planes (multi-account, encryption, attachment, central-push,
  static-webapp, github) re-enter via any careless take-theirs. Guarded by KEEP-DELETED grep gates
  (HS-6/7, HC-18, HA-1a/2a) — these gates are **mandatory**, not advisory.
- **Auth-plane regression:** any S1/S2 change to api.ts/socket.ts/index.ts runs the **full 6-spec auth
  set** (publicAuthGate, remoteDeviceAuth, deviceEnrollment, socket, index, dualListenerBinding) +
  typecheck. `installForkAuthPlane` must stay **before** `registerForkRoutes` (public-mode fail-closed).
- **Re-measure drift:** findings were at `58723b9e`; current HEAD `a0a42f03` measures 7/30/59. Ships
  between now and execution can shift counts — **re-run the classification + merge-file at the start of
  each stage** (S0/A0 re-measure).
- **App scale:** 59 hard + ~36 uncatalogued + ~8 resurrection hazards + 62 upstream-new is too much for
  one pass — hence the A0–A5 decomposition.
- **`npm_config_script_shell=bash` fails on this box** (WSL2 disk-attach). The cli build uses
  cross-platform `shx`, so run cli gates **without** forcing bash.

### 6.3 Autonomy recommendation (explicit)

**HYBRID — the lead may autonomously PREPARE server + cli on topic branches with all gates green, but
must PAUSE for operator review before merging any stage to `main`, and must NOT start the app stage
autonomously.**

Rationale:
- **Server (S1–S4)** and **CLI (S5–S8)**: every hard-conflict file is **catalogued** (7/7 and 30/30), the
  recipe is fully specified, and the gates are strong (auth 6-spec, typecheck, `pnpm test`, audit). The
  lead can produce these intakes on a `ralph/intake-cli-1.1.10-server` / `…-cli` topic branch and drive
  every gate to green *without* an operator. This is safe, valuable, and reversible (topic branch).
- **But this is the *first behavior-affecting intake* across production packages, and the operator is
  away.** Merging behavior changes (RESTORE/adopts, dep bumps, op calls #2/#7/#8) to `main` unreviewed is
  not appropriate. So: **prepare + gate autonomously, then hold at the topic-branch boundary for operator
  sign-off before FF-merge.**
- **App (A0–A5)**: **operator review required before execution.** ~36 uncatalogued hard files needing HA
  rows, ~8 resurrection hazards, the permanent sync-plane manual-3-way, and the translation TS1117 traps
  are too many un-governed decisions for an autonomous pass. The A0 catalogue-extension is itself an
  operator-reviewed design step.

Net: **lead-autonomous for server+cli *preparation* (topic branch, gates green) → operator review gate →
merge → app only with operator.** This maximizes progress while the operator is away without merging
un-reviewed behavior changes to production packages.

---

## 7. Reproducibility appendix

All commands run **from the worktree root** (`.worktrees/plan-first-intake`), where the `upstream-happy`
remote + tags are in-repo. Supporting scripts kept under
[`scratch/`](./scratch/) as reproducibility artifacts.

### 7.1 One-time host setup (required for `merge=ours`)

```bash
git config merge.ours.driver true    # §7 — inert .gitattributes merge=ours lines otherwise
git fetch --no-tags upstream-happy main
git fetch --no-tags upstream-happy tag cli-1.1.10
```

### 7.2 Tag SHAs (verify)

```
cli-1.1.8  = b72fd811…   (2026-04-27, BASE)
cli-1.1.10 = 71c417e1…   (2026-06-23, THEIRS)
merge-base HEAD cli-1.1.10 = df4cdae8   (2026-04-29 — the real merge-base; §6 correction #0)
upstream-happy/main = d2ef88de          (+3 commits past the tag — deferred, §3)
```

### 7.3 Regenerate the intake set (per package)

```bash
# Upstream delta ∩ package = the real intake set:
git diff --name-only cli-1.1.8 cli-1.1.10 -- packages/happy-server packages/happy-cli packages/happy-app

# Full bucket classification (clean-adopt / conflict / upstream-new / fork-deleted), both bases:
node .ralph/jobs/happy-first-selective-intake-cli-1.1.10/scratch/classify2.mjs
#   → writes scratch/classification.json  (uses `git diff --ignore-cr-at-eol` — LF-safe, fast)
```

### 7.4 Regenerate the true hard-conflict counts (per package)

```bash
# LF-normalized real 3-way (OURS=HEAD, BASE=cli-1.1.8, THEIRS=cli-1.1.10) over the diverged bucket:
node .ralph/jobs/happy-first-selective-intake-cli-1.1.10/scratch/mergefile.mjs cli-1.1.8 packages/happy-server
node .ralph/jobs/happy-first-selective-intake-cli-1.1.10/scratch/mergefile.mjs cli-1.1.8 packages/happy-cli
node .ralph/jobs/happy-first-selective-intake-cli-1.1.10/scratch/mergefile.mjs cli-1.1.8 packages/happy-app
#   → prints HARD (conflict-hunk count per file) vs CLEAN AUTO-MERGE
#   current HEAD a0a42f03: server 7/6, cli 30/11, app 59/17
```

### 7.5 Per-file manual 3-way (execution — one file)

```bash
p=packages/happy-server/sources/app/api/api.ts
git show HEAD:$p        | tr -d '\r' > /c/scratch/ours     # or a worktree scratch path (never /tmp)
git show cli-1.1.8:$p   | tr -d '\r' > /c/scratch/base
git show cli-1.1.10:$p  | tr -d '\r' > /c/scratch/theirs
git merge-file -p --diff3 /c/scratch/ours /c/scratch/base /c/scratch/theirs   # inspect conflict hunks
# then hand-resolve per the HS/HC/HA row disposition, write back to $p
```

### 7.6 Per-stage gates

```bash
# server:
pnpm --filter happy-server typecheck
pnpm --filter happy-server test -- publicAuthGate remoteDeviceAuth deviceEnrollment socket index dualListenerBinding
# cli (do NOT set npm_config_script_shell=bash on this box):
pnpm --filter happy typecheck && pnpm --filter happy test
# app:
pnpm --filter happy-app typecheck
# after EVERY stage:
node scripts/audit-happy-fork-patches.mjs          # advisory; --strict for CI (zero drift required)
# resurrection guard-by-absence (app):
grep -R "applyFriends\|applyFeedItems\|unreadSessionIds\|friendTypes" packages/happy-app/sources/sync   # == 0 hits
```

### 7.7 Finalize (§9 step 7)

Advance the §6 baseline record to `cli-1.1.10` (`71c417e1`) only after all stages land + `--strict` audit
passes; update the catalogue header + §9 cadence note; re-tree-match if a tighter anchor appears.
