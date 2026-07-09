# Minimal-conflict reduction — make happy-app inherit upstream features via clean merge

**Task:** `happy-app-minimal-conflict-reduction-inherit-upstream`
**Type:** READ-ONLY analysis / brainstorm — NO production code changed (one Markdown deliverable).
**Branch / worktree:** `ralph/bs-app-minconflict` @ `D:/harness-efforts/codexu/.worktrees/bs-app-minconflict`
**Method:** re-triage of the app hard-conflict set (`docs/happy-patch-surface.md §5` HA-1…HA-52) under the **aggressive-REVERT** lens, cross-checked against measured per-file divergence (`git diff --stat cli-1.1.10 HEAD -- <file>`, CRLF→LF), the R8 overlay precedent (`packages/happy-app/sources/fork/*`, 26 modules), and the three companion brainstorms.

> **Companion analyses (read; do not duplicate):**
> - `.ralph/brainstorms/happy-fork-make-truly-rebasable-on-upstream/brainstorm.md` — lineage verdict + why `sync.ts`/`storage.ts` are irreducible + the "adopt-upstream+wrap" test.
> - `.ralph/brainstorms/happy-app-r5-sync-plane-residual/brainstorm.md` — per-hunk sync-plane triage.
> - `.ralph/brainstorms/happy-app-restore-voice-realtime-subsystem/brainstorm.md` — voice keep-removed verdict.
> - `docs/happy-patch-surface.md §5` (HA rows + A0), §7 (merge policy), §9 (cadence).

---

## 1. Goal + honest framing (verdict first)

**The mechanism, restated.** The fork now shares real merge lineage with upstream (established at the
cli-1.1.10 intake). The operator wants upstream *app* features to flow in **automatically via `git merge`**,
not be re-adopted one-by-one. Today they don't, because the fork **diverged on the same files** → 3-way
conflict → resolved take-ours → upstream's feature is silently dropped. **The only way to auto-inherit an
upstream feature is to stop the fork from diverging on that feature's file.** So the reduction lever is
*divergence reduction*, resolved into three dispositions per file: **REVERT** (drop the fork's non-essential
divergence, so the file merges clean and upstream flows in), **OVERLAY** (relocate the fork's essential
behavior into `sources/fork/*` and revert the canonical file to near-upstream + a thin seam — the R8
pattern), or **ACCEPT** (irreducibly convergent → keep as a catalogued permanent manual-3-way).

**Headline (the honest number).** Of the **59 app hard-conflict files** catalogued at A0 (`docs/happy-patch-surface.md §5`; the live-merge measure was 64 — the delta is tests/i18n git re-conflicts), the aggressive-REVERT re-triage lands:

| Disposition | HA rows / files | What it buys |
|---|---:|---|
| **REVERT** (auto-inherit upstream) | **~7** | file stops conflicting; upstream's version (incl. features) merges clean forever |
| **OVERLAY** (R8 seam → near-clean merge) | **~8** (5 already DONE + `new/index.tsx` + 2 session-list) | canonical file inherits upstream; conflict shrinks to a 1-line seam re-apply |
| **OVERLAY-list** (concat-from-fork pattern — *new lever*) | **~4** (`modelModeOptions`, `suggestionCommands`, i18n, adjacent catalogues) | upstream list/catalogue flows in clean; fork rows appended from a fork-only module |
| **ACCEPT — expensive irreducible** | **~7** (`sync.ts`, `storage.ts`, `reducer.ts`, `apiSocket.ts`, `ops.ts`, i18n-if-not-listed, `package.json`) | permanent manual-3-way; recipe-driven |
| **ACCEPT — cheap additive-adopt** | **~18** (types/settings/persistence/layout guards) | conflicts only when upstream touches them; resolves in minutes each |
| **KEEP-DELETED** (guard, take-ours) | **8 files** (HA-49…52 + voice) | mechanical; NEVER take-theirs (resurrection hazard) |
| **merge=ours shim** (already zero-cost) | **3** (sidebar trio HA-10/11/12) | auto-resolves today; no manual work |

**So the real prize is not a single "59 → 15" number — be honest about that.** Two things drop
the count of files that produce a *genuine* manual conflict:

1. **REVERT + OVERLAY + OVERLAY-list remove ~19 files** from the diverged set (they auto-inherit or
   shrink to a trivial seam). That takes the **expensive** manual-3-way core to a **permanent floor of
   ~7 files** (`sync.ts`, `storage.ts`, `reducer.ts`, `apiSocket.ts`, `ops.ts`, `package.json`, + i18n).
2. The remaining **~18 "cheap additive-adopt"** files still show a conflict marker *when upstream edits
   them*, but each is a few additive hunks resolved in minutes — not a re-derivation.

**Combined with merge lineage** (the rebasability brainstorm's Phase 1 — already the operator's direction),
each future release is `git merge <tag>` surfacing **only that release's delta** of these buckets, not the
whole surface. **That is the operator's goal delivered:** upstream app features arrive by merge, the fork's
essential identity is preserved (in overlays or the accepted core), and the manual surface is a small,
bounded, catalogued floor.

**The uncomfortable finding the operator should hear.** A naive "revert all the cosmetics" hope
over-reaches. The fork's **identity threads through the majority of the 59 files** via shared symbol names —
the single-user **storage state shape** (`hasOlder`/`renderWindow`/`oldestLoadedSeq`), **no-central-server**
socket/ops, **codex/gemini** tooling, the **DFS session tree**, and the **e-ink permission model**. A file
is only a *clean* REVERT if its divergence is **both cosmetic AND symbol-disjoint** from the accepted core.
That test disqualifies more files than it first appears (worked example: `useDemoMessages.ts` looks like
throwaway demo content but actually carries the fork's render-window pagination field rename — see §3).
Bias toward REVERT, yes — but verified per-file, not by category.

---

## 2. The essential-divergence boundary (what MUST stay)

Keep a divergence (via **OVERLAY** or **ACCEPT**, never REVERT) **only** if it serves one of these fork
identities. Everything else is a REVERT candidate.

| # | Identity | Concrete surface in happy-app | Load-bearing evidence |
|---|---|---|---|
| E1 | **Single-user / no-multi-account** | `Sync` class + Zustand store dropped friends/feed/artifacts/other-user planes; DFS parent/child **session tree** (`buildSessionRowData`/`buildSessionListViewData`, `TreeSessionRowData`); `userChosen` sticky permission mode | HA-1/HA-1a, HA-2/HA-2a; `sync/encryptionDeletion.spec.ts` guard |
| E2 | **No-central-server** (per-daemon, loopback) | loopback `fetchMachines`, remote-daemon socket/tunnel wiring (`apiSocket.ts`, `socketOptions.ts`, `tunnelProvider.ts`), daemon/codex RPC ops (`ops.ts`), remote-daemon push tuning (`app/_layout.tsx`) | HA-25, HA-26, HA-18; AGENTS.md "distributed per-daemon, NO central server" |
| E3 | **No per-session E2E** (plaintext codec) | `decodeApiMessages` no-decrypt; deleted `encryption/*` + `sync/encryption/*`; dropped encryption wire types | HA-1, HA-27, HA-34, HA-49 |
| E4 | **e-ink perf** (static UI, no continuous repaint/animation) | inverted-FlatList tuning + `BoundaryDivider`, static markdown/message/tool rendering, page-turn scroll, pinch font-scale, the `chatToolGrouping`/`messageCommandChips` default-off toggles | HA-4/5/6/8/9 (R8 overlays); `sources/fork/{chat,message,markdown,session,agentInput}/*` |
| E5 | **Removed planes — KEEP-DELETED** (guard by absence) | voice/ElevenLabs realtime (`sources/realtime/` — 12 files, absent), encryption plane (5 files), multi-account other-user screen, GitHub-connect plane, upstream `CLAUDE.md` | HA-49…52; `realtime/` confirmed absent in fork, present (12 files) in cli-1.1.10; no `@elevenlabs/*` deps |

**Explicitly NON-essential (REVERT candidates when symbol-disjoint):** cosmetic UI rewrites, tool-renderer
layout tweaks, suggestion-list lengths, diff-view collapse styling, the info screen's non-e-ink parts, and
the new-session screen's non-daemon layout. **Guard rail:** a REVERT must never re-import an E5 plane —
gate every REVERT wave on `sync/encryptionDeletion.spec.ts` (asserts absence of
`apiGithub|apiArtifacts|apiFeed|apiVoice|@/encryption/|@/sync/encryption/`) + per-file `Test-Path == false`.

---

## 3. Per-file disposition table

Divergence size = `git diff --stat cli-1.1.10 HEAD` (lines changed). Conflict-hunk counts (where cited)
from patch-surface §5 / the live merge. **Disposition** is the *re-triaged* call under the aggressive lens;
where it differs from the old conservative KEEP, that's the point.

### 3.1 ACCEPT — expensive irreducible (permanent manual-3-way)

| HA | file | Δlines | identity | disposition | rationale |
|---|---|---:|---|---|---|
| HA-1 | `sync/sync.ts` | (2037↔2548, 15–22 hunks) | E1/E2/E3 | **ACCEPT** | monolithic `Sync` class; removals + convergent body-rewrites; no upstream seam. Proven irreducible. |
| HA-2 | `sync/storage.ts` | (1548↔1496, 24–27 hunks) | E1 | **ACCEPT** | one Zustand `create()`; whole app calls `getState().X`; convergent with upstream unread-tracking. Irreducible. |
| HA-3 | `sync/reducer/reducer.ts` | 580 | E1/E4 | **ACCEPT** | typed context-boundary + e-ink accumulation; 580-line convergent rewrite vs upstream reducer; no seam. |
| HA-25 | `sync/apiSocket.ts` | 578 | E2 | **ACCEPT** (+ adopt appState?) | loopback/remote-daemon socket; convergent with upstream `sendAppState`/`appState` handshake. Entangled w/ HA-18. |
| HA-26 | `sync/ops.ts` | 614 | E2 | **ACCEPT** + adopt-additive | daemon/codex op set; hand-port additive builders (spawn-lineage, rewind/fork, `sessionGoalAction`). |
| HA-7 | `text/_default.ts` + `text/translations/*` | (multi-file) | — | **ACCEPT** *(candidate OVERLAY-list, §3.3)* | fork-added keys; `merge=union` UNSAFE (TS1117). Manual until namespaced. |
| HA-48 | `package.json` (pkg root) | — | E2/E5 | **ACCEPT** (§7 manual-3-way) | deps/scripts diverge each intake; no merge driver; keep fork deps, hand-add upstream prod deps. |

### 3.2 OVERLAY — essential + separable (R8 seam pattern)

| HA | file | Δlines | identity | disposition | overlay module |
|---|---|---:|---|---|---|
| HA-4 | `-session/SessionView.tsx` | (19 hunks) | E4 | **OVERLAY — DONE** (R8 s5) | `sources/fork/session/*` (composer, boundary, drawer, sidebar, header). Residual seam + SYNC-R5 in-place. |
| HA-5 | `components/ChatList.tsx` | (11 hunks) | E4 | **OVERLAY — DONE** (R8 s2) | `sources/fork/chat/*`; grouping restored behind `chatToolGrouping` (default flat). |
| HA-6 | `components/AgentInput.tsx` | (11 hunks) | E4 | **OVERLAY — DONE** (R8 s4) | `sources/fork/agentInput/*`; upstream mic RESTORED inert. |
| HA-8 | `components/markdown/MarkdownView.tsx` | (many) | E4 | **OVERLAY — DONE** (R8 s1) | `sources/fork/markdown/*`. |
| HA-9 | `components/MessageView.tsx` | (11 hunks) | E4 | **OVERLAY — DONE** (R8 s3) | `sources/fork/message/*`; chips behind `messageCommandChips` (default off). |
| HA-13 | `app/(app)/new/index.tsx` | **1917** (583↔1851) | E2/E4 | **OVERLAY** *(operator-call vs REVERT — §5.1)* | relocate fork e-ink+daemon screen → `sources/fork/newSession/`, route flag picks fork-vs-upstream. |
| HA-14 | `components/ActiveSessionsGroupCompact.tsx` | 376 | E1 | **OVERLAY-candidate** | DFS-tree rendering consumes storage's tree data; relocate the fork tree-row renderer → `sources/fork/session/`. Else ACCEPT. |
| HA-15 | `components/SessionsList.tsx` | 265 | E1/E4 | **OVERLAY-candidate** + adopt selection-stability | same DFS-tree coupling; hand-port upstream FlatList selection-stability hunk. |

### 3.3 OVERLAY-list — the concat-from-fork lever (NEW; converts ACCEPT→clean-merge)

The catalogue/list files diverge because the fork **appends** codex/daemon rows to an upstream list. If the
fork instead consumes `upstream_list.concat(FORK_ROWS)` where `FORK_ROWS` lives in a fork-only module, the
**canonical list file reverts to near-upstream and auto-merges** — upstream's new rows flow in, fork's rows
are preserved. Highest-leverage new pattern this brainstorm proposes.

| HA | file | Δlines | disposition | fork-only module |
|---|---|---:|---|---|
| HA-40/41 | `components/modelModeOptions.ts` (+test) | 53 | **OVERLAY-list** | `sources/fork/models/forkModelRows.ts` — upstream catalogue + codex rows appended; inherits opus-4.8 + `xhigh` free. |
| HA-36 | `sync/suggestionCommands.ts` | 192 | **OVERLAY-list** *(operator-call)* | `sources/fork/slash/forkSlashCommands.ts` — inherits upstream `/goal` + skills; fork codex/daemon slash appended. |
| HA-7 | i18n `text/*` | multi | **OVERLAY-list** (future) | fork-namespaced strings file merged into the tree (already noted as the HA-7 long-term fix). |

### 3.4 REVERT — non-essential + symbol-disjoint (auto-inherit upstream)

| HA | file | Δlines | disposition | upstream feature inherited | caveat |
|---|---|---:|---|---|---|
| HA-23 | `components/tools/views/_all.tsx` | 14 | **REVERT-mostly** | `TaskOutputView`, `TaskStopView`, `FileEditView` (renamed from `FileView`) | must preserve codex/gemini registrations (CodexBash/Patch/Diff, Gemini*) — near-revert, not blind |
| HA-37 | `components/autocomplete/suggestions.ts` | 9 | **REVERT** *(operator-call)* | file/command mention limit → 50 | drops mild e-ink count-caps (15 cmd / 5 file); `source` field pairs with HA-36 |
| HA-20 | `components/tools/ToolView.tsx` | 206 | **REVERT — pending e-ink spot-check** | upstream compact/header `toolDisplay` layout | verify upstream layout is static (no continuous repaint) before reverting |
| HA-24 | `components/diff/PierreDiffView.tsx` | 35 | **REVERT** *(operator-call)* | `expandUnchanged` prop | loses fork `maxVisibleLines`/`hunks` collapse-cap — check `CollapsibleDiffPreview` callers first |
| HA-19 | `app/(app)/session/[id]/info.tsx` | 127 | **REVERT** *(operator-call)* | parent-session nav affordance | single-user screen; verify no multi-account row resurfaces |
| HA-16 | `hooks/useSessionQuickActions.ts` | 199 | **REVERT — lean KEEP** *(operator-call)* | upstream `resolveMessageModeMeta` resume defaults | changes resume model/permission preset — behavior change; default lean KEEP |
| HA-39 | `components/FilesSidebar.tsx` | 442 | **REVERT — lean KEEP** *(operator-call)* | all-files mode, Windows path split, per-file line totals | large e-ink layout divergence; if upstream is static, REVERT wins features |

### 3.5 ACCEPT — cheap additive-adopt (keep fork body; hand-port small upstream hunks)

Essential-identity body (drops E1/E3/E5 planes or carries E2/E4 fields) **but** upstream's delta is small +
additive. Keep fork; adopt the additive hunk. Conflicts only when upstream re-touches them.

| HA | file | Δlines | identity | note |
|---|---|---:|---|---|
| HA-17 | `app/(app)/_layout.tsx` | 139 | E1/E5 | route tree omits removed planes; adopt new settings route **(operator-call)** |
| HA-18 | `app/_layout.tsx` | 73 | E2/E3 | drops encryption/multi-account bootstrap; adopt push-suppression/messages-channel **(operator-call)** |
| HA-21 | `components/tools/views/CodexPatchView.tsx` | 306 | codex (E-fork) | codex feature; hand-port `materializeUnifiedDiffPatch` normalization — NOT a revert |
| HA-22 | `components/tools/PermissionFooter.tsx` | 146 | E1 | tied to `userChosen` permission model; KEEP |
| HA-27 | `sync/typesRaw.ts` | 364 | E1/E3 | drops encryption/multi-account types; adopt additive `thumbhash`/`claudeUuid`/`codexItemId` **(file-event = operator-call)** |
| HA-28 | `sync/messageMeta.ts` (+HA-29 test) | 60 | codex | `effort`→`thinkingLevel` mapping; KEEP + adopt `agentDefaultOverrides` |
| HA-30 | `sync/typesMessageMeta.ts` | — | — | adopt additive `effort` field |
| HA-31 | `sync/storageTypes.ts` (+HA-32 test) | — | E1 | adopt additive `forkedFromMessageId`/`AgentGoalStatusSchema` |
| HA-33 | `sync/localSettings.ts` (+HA-35 test) | — | E4 | e-ink toggles; adopt additive `zenMode` |
| HA-34 | `sync/persistence.ts` | 185 | E1/E3 | drops encryption/multi-account persisted planes; KEEP (guard-by-absence) |
| HA-38 | `components/SettingsView.tsx` | 295 | E1/E4/E5 | removes multi-account/github/encryption rows; KEEP + adopt version row; defer Agent Defaults |
| HA-40/41 | `components/modelModeOptions.ts` (+test) | 53 | codex | *see §3.3 OVERLAY-list — preferred*; else KEEP + adopt-additive |
| HA-42 | `hooks/useDemoMessages.ts` | 8 | E1 | **NOT a revert** — carries the fork render-window field rename (`hasOlder`/`oldestLoadedSeq`/`renderWindow`); matches storage shape |
| HA-43/44/45 | `changelog.json`, `CHANGELOG.md`, `scripts/parseChangelog.ts` | — | fork-owned | KEEP wholesale — reverting overwrites fork release history/parser (not a divergence-to-reduce) |
| HA-46 | `app.config.js` | — | E2 | bundle ids/remote-daemon; adopt additive `buildCommitSha`/`NSAppTransportSecurity` |
| HA-47 | `metro.config.js` | — | E4 | Tauri exclusion + preact singleton (desktop/e-ink); adopt non-conflicting resolver hunks |

### 3.6 KEEP-DELETED — resurrection hazards (take-ours; NEVER take-theirs)

| HA | files | plane | guard |
|---|---|---|---|
| HA-49 | `encryption/base64.ts`, `encryption/deriveKey.ts`, `sync/encryption/encryption.ts`, `sync/encryption/encryptor.ts`, `auth/secretKeyBackup.spec.ts` | E2E encryption (E3) | `encryptionDeletion.spec.ts` + `Test-Path==false` |
| HA-50 | `app/(app)/user/[id].tsx` | multi-account other-user (E1) | file-absence |
| HA-51 | `sync/apiGithub.spec.ts` | GitHub-connect | `apiGithub` absence |
| HA-52 | `packages/happy-app/CLAUDE.md` | upstream per-package doc | file-absence (fork uses `AGENTS.md`) |
| (voice) | `sources/realtime/*` (12 files) + `sync/apiVoice.ts` | voice/ElevenLabs (E5) | dir-absence; no `@elevenlabs/*` dep |

### 3.7 merge=ours shim — essential tablet identity, already zero-cost

| HA | file | note |
|---|---|---|
| HA-10 | `components/SidebarView.tsx` | fork tablet sidebar; upstream same-name file is a DIFFERENT feature (new-session right sidebar) → `.gitattributes merge=ours` |
| HA-11 | `components/SidebarNavigator.tsx` | paired with HA-10 |
| HA-12 | `components/ChatHeaderView.tsx` | fork avatar-header + sidebar-restore control |

> These already auto-resolve via `merge=ours` (requires `git config merge.ours.driver true` on the merge
> host). They cost **zero manual work** today and are functionally an ACCEPT that git handles for us — leave
> as-is. Note: A0's `git merge-file` measure counted them among the 59 (it ignores `.gitattributes`), but a
> real `git merge` does not surface them.

---

## 4. Wave plan

Each wave is independently shippable, gated, and reduces the conflict surface. Waves are ordered by
**leverage ÷ risk**: cheap REVERTs first (most upstream features per unit effort), then the concat-list
lever, then the OVERLAY refactors, with the sync core explicitly out of scope.

### Wave 0 — Establish/confirm lineage (prerequisite, borrowed from the rebasability brainstorm)
- Real `git merge cli-1.1.10` committed (take-ours-dominant) so `merge-base` advances and future merges are
  incremental. **This wave is what makes every REVERT below actually "flow upstream in" on the *next*
  release** — without lineage, a REVERT still re-conflicts from `df4cdae8`.
- Gate: `pnpm --filter happy-app typecheck` + fork sync suite.
- *Already the operator's direction (`happy-establish-merge-lineage-cli-1.1.10`).* Do not duplicate; just
  sequence the app REVERTs to land after it.

### Wave 1 — Cheap disjoint REVERTs (highest feature-yield, lowest risk)
- Files: **HA-23** (`_all.tsx`, preserve codex/gemini rows), **HA-37** (`suggestions.ts`), **HA-24**
  (`PierreDiffView.tsx`), **HA-42-audit** (confirm it is NOT a revert — it isn't).
- Inherits: upstream `TaskOutput`/`TaskStop`/`FileEdit` tool views, `expandUnchanged` diff, upstream mention
  limits.
- Expected reduction: **−3 files** from the diverged set (they auto-inherit thereafter).
- Gates: `pnpm --filter happy-app typecheck`; `components/tools/*` + `autocomplete/suggestions.test.ts` +
  `diff/CollapsibleDiffPreview.test.tsx`; **`encryptionDeletion.spec.ts`** (resurrection guard);
  **e-ink spot-check** on the diff/tool renderers on the tablet.

### Wave 2 — Concat-from-fork OVERLAY-list (converts ACCEPT→clean-merge)
- Files: **HA-40/41** (`modelModeOptions`), **HA-36** (`suggestionCommands`, operator-call), later **HA-7**
  (i18n namespaced strings).
- Mechanism: extract fork rows to `sources/fork/{models,slash}/*`; canonical file = `upstream.concat(FORK)`.
- Inherits: upstream model rows (opus-4.8, `xhigh`), `/goal` + skills slash suggestions.
- Expected reduction: **−2–3 files** to clean-merge.
- Gates: `modelModeOptions.test.ts`, `suggestionCommands.test.ts`, typecheck.

### Wave 3 — Operator-gated REVERTs (behavior-visible; need sign-off)
- Files: **HA-20** (`ToolView`, after e-ink spot-check), **HA-19** (`info.tsx`), **HA-16**
  (`useSessionQuickActions`), **HA-39** (`FilesSidebar`).
- Inherits: upstream tool-card layout, parent-session nav, resume defaults, files all-files mode.
- Expected reduction: **−2–4 files** (whichever the operator rules ADOPT).
- Gates: per-file test rows + e-ink spot-check + resurrection guard.

### Wave 4 — Finish OVERLAY (new-session + session-list)
- Files: **HA-13** (`new/index.tsx` → `sources/fork/newSession/` behind a route flag), **HA-14**/**HA-15**
  (relocate DFS tree-row renderer to `sources/fork/session/`).
- Inherits: upstream's richer new-session screen becomes reachable-by-flag; upstream session-list features.
- Expected reduction: the single largest file (`new/index.tsx`, 1917 Δ, 16 hunks) drops to a route-flag seam.
- Gates: `new/index.unifiedComposer.test.ts`, `ActiveSessionsGroupCompact.dfs-order.spec.tsx`, typecheck,
  e-ink pass on the new-session screen.

### Wave 5 (no action) — ACCEPT the core
- `sync.ts`, `storage.ts`, `reducer.ts`, `apiSocket.ts`, `ops.ts`, `package.json`, i18n(if not §3.3'd).
- Resolution = the per-cluster recipe in `happy-app-r5-sync-plane-residual §5`. No refactor — attempting a
  seam here hits the proven hard ceiling.

**Cumulative expected outcome:** ~19 files leave the diverged/expensive set (REVERT + OVERLAY + OVERLAY-list),
leaving a **permanent expensive floor of ~7** + ~18 cheap additive-adopts that only conflict when upstream
touches them. With lineage, each release surfaces only its delta of these.

---

## 5. Special-case rulings

### 5.1 `new/index.tsx` — **recommend OVERLAY, not pure REVERT** (operator-call)
- **Divergence:** 1917 Δ lines; fork 583 vs upstream 1851 (16 hunks). Upstream tripled it (new-session
  right sidebar + FilesSidebar + richer machine/path/worktree/agent config); the fork keeps a lean screen.
- **Why not pure REVERT:** the fork screen carries **E2 remote-daemon machine/agent pickers** — a blind
  revert to upstream's screen risks breaking remote-daemon session creation and pulls in upstream's
  central-server-shaped agent config. The e-ink layout is E4.
- **Why OVERLAY works:** the rebasability brainstorm rated it **"partially restructurable"** — it's a **leaf
  UI screen**, not shared infra. Move the fork screen to `sources/fork/newSession/`, let upstream's
  `new/index.tsx` merge near-clean, and pick fork-vs-upstream by a route flag. Upstream's new-session
  features become adoptable **by deliberate choice**, not by merge accident, and the file leaves the hard set.
- **Recommendation: OVERLAY (Wave 4).** Flag REVERT-vs-OVERLAY as an operator-call: pure REVERT is on the
  table only if the operator decides the remote-daemon pickers can be re-expressed on top of upstream's
  richer composer (more work, re-verifies daemon wiring).

### 5.2 Voice / realtime — **recommend KEEP-DELETED** (surface as operator-call)
- **State:** fork deleted `sources/realtime/` (12 files, ~1177 lines) + `apiVoice.ts` + storage realtime
  state; no `@elevenlabs/*` deps. Upstream cli-1.1.10 still ships all of it. It is an **E5 resurrection
  hazard**, guarded by absence — *not* in the 59 content-conflict set (it's an add-conflict like HA-49).
- **Does the "inherit all upstream features + minimal conflict" reframe override the keep-removed verdict?**
  This is the sharpest tension in the whole task, so state it plainly. The removal *is* an ongoing
  divergence the fork maintains (drop upstream's realtime re-adds every merge). "Minimal conflict" would, in
  the abstract, argue for stopping that maintenance by restoring it. **But restoring re-introduces exactly
  the planes the fork's identity forbids:** a **central-server** ElevenLabs credential broker
  (`POST /v1/voice/conversations`, RevenueCat paywall — violates E2), **continuous mic→3rd-party-cloud
  egress** (privacy/cost — orthogonal to E3 but same posture), an **animated `VoiceAssistantStatusBar`**
  (VAD-driven continuous repaint — violates E4), and **2 npm deps** (`@elevenlabs/react`,
  `@elevenlabs/react-native`).
- **Ruling: stays KEEP-DELETED (E5).** The `happy-app-restore-voice-realtime-subsystem` brainstorm already
  reached this ("keep-removed is the recommended default"; full restore "architecturally hostile"). The
  "minimal-conflict" reframe does **not** override it, because the divergence being maintained here is
  *cheap* (mechanical drop-upstream-re-adds, guard-tested) and the alternative *re-adds four identity
  violations*. **Cost-benefit: maintaining the deletion is far cheaper than owning the restored subsystem.**
  The upstream mic UI is already restored *inert* (HA-6), so nothing is lost by waiting. **Operator-call
  only if** the operator explicitly wants hands-free tablet voice — then the *only* acceptable path is the
  bypass-only, push-to-talk, e-ink-static, default-off minimal restore (Option b of that brainstorm), which
  is a separate feature task, not part of this reduction workstream.

### 5.3 Removed encryption / multi-account / github planes — **ESSENTIAL keep-deleted, guard confirmed**
- The 8 A0 resurrection-hazard files (HA-49 encryption ×5, HA-50 other-user screen, HA-51 apiGithub,
  HA-52 upstream CLAUDE.md) stay **take-ours-deleted**. Confirmed absent at HEAD.
- **This is the load-bearing constraint on the entire REVERT bias:** a REVERT that reverts a file which
  `import`s one of these planes would resurrect it. Therefore **every REVERT wave gates on
  `sync/encryptionDeletion.spec.ts`** (asserts `apiGithub|apiArtifacts|apiFeed|apiVoice|@/encryption/|@/sync/encryption/`
  == 0) plus per-file `Test-Path == false`. No REVERT in Waves 1/3 touches a file that imports these (verified
  against the disposition table — the REVERT set is tool renderers, diff view, suggestions, info screen).

---

## 6. Operator-decision calls (ranked)

1. **`new/index.tsx`: OVERLAY (recommended) vs pure REVERT.** OVERLAY preserves remote-daemon pickers +
   e-ink and still lets upstream's screen in behind a flag. Pure REVERT is cleaner but risks daemon wiring.
   **Lean: OVERLAY.**
2. **Voice restore vs keep-removed.** **Lean: KEEP-DELETED** (E5). Restore only on explicit request, and
   only the bypass-only minimal variant.
3. **HA-16 `useSessionQuickActions` — adopt upstream resume defaults?** Changes the model/permission preset
   applied on resume. **Lean: KEEP fork.**
4. **HA-39 `FilesSidebar` — REVERT to upstream all-files/layout?** 442 Δ e-ink layout. **Lean: KEEP** unless
   an e-ink spot-check shows upstream's layout is static and strictly better.
5. **HA-20 `ToolView` — REVERT to upstream tool-card layout?** **Lean: REVERT** *iff* e-ink spot-check
   confirms no continuous repaint; else KEEP.
6. **HA-36 `suggestionCommands` — OVERLAY-list vs KEEP.** OVERLAY-list inherits `/goal`+skills while keeping
   codex slash. **Lean: OVERLAY-list.**
7. **HA-17/HA-18 route + root-layout adopts** (new settings route, foreground-push suppression, messages
   channel, browser shortcuts). Behavior-visible; entangled with E2 daemon push. **Lean: KEEP fork; adopt
   only the additive settings route if wanted.**
8. **HA-19 `info.tsx` — REVERT for parent-session nav?** **Lean: REVERT** (single-user-safe, mostly cosmetic).
9. **HA-24 `PierreDiffView` / HA-37 `suggestions` — REVERT?** **Lean: REVERT** (small, disjoint) after
   checking `maxVisibleLines`/`source` consumers.
10. **HA-27 `typesRaw` file-event attachments — adopt?** Additive fields are safe; file-event changes
    attachment rendering. **Lean: adopt additive, defer file-event to a toggle.**

---

## 7. Risk

- **REVERT loses fork tweaks.** Notable losses if reverted: e-ink suggestion count-caps (HA-37: 15 cmd/5
  file → 50), the diff collapse-cap `maxVisibleLines`/`hunks` (HA-24), the e-ink tool-card tuning (HA-20),
  the fork files-sidebar layout (HA-39). Each REVERT is a deliberate trade of a fork tweak for auto-inheriting
  upstream — acceptable per the operator's stated priority, but must be enumerated at ship time.
- **e-ink regression from inheriting upstream's animated UI.** Upstream is a multi-tenant SaaS app with
  continuous-repaint affordances (unread badges, animated status bars, smooth-scroll). Any REVERT/adopt that
  pulls in an animated or continuously-repainting surface is an e-ink regression. **Every REVERT and every
  `adopt?` wave requires an e-ink spot-check on the tablet before ship** — this is a hard gate, not advisory.
- **Resurrection hazard.** A careless REVERT of a file importing an E5 plane silently re-adds
  encryption/multi-account/github/voice. Mitigation: `encryptionDeletion.spec.ts` + per-file `Test-Path`
  gate on every wave (the REVERT set is chosen to avoid these imports).
- **Entanglement mis-classification.** The biggest analysis risk is calling a file "cosmetic REVERT" when it
  actually carries an identity symbol (worked example: `useDemoMessages.ts` render-window rename; also the
  `source` field linking HA-37↔HA-36, and `maxVisibleLines` consumers of HA-24). Mitigation: every REVERT is
  verified symbol-disjoint (grep the reverted symbols' consumers) before landing, not classified by category.
- **OVERLAY-list correctness.** The concat pattern must preserve fork-row ordering/precedence where the app
  relies on it (e.g., default model selection). Guard with the existing `*.test.ts` catalogue tests.
- **Honesty ceiling.** This does **not** reach "zero manual files." The expensive irreducible core
  (`sync.ts`/`storage.ts`/`reducer.ts`/`apiSocket.ts`/`ops.ts`/`package.json`) is permanent manual-3-way by
  convergent evolution against a seam-less upstream — proven in the rebasability + R5 brainstorms. The prize
  is a *small, bounded, catalogued* floor + auto-inheritance of everything reducible, not a free rebase.

---

## Appendix — method & reproducibility

- **Disposition source:** re-triage of `docs/happy-patch-surface.md §5` HA-1…HA-52 (A0 classification) under
  the aggressive-REVERT lens defined in the task; the old rows are conservative KEEP, re-classified here.
- **Divergence sizes:** `git diff --stat cli-1.1.10 HEAD -- <file>` in the primary checkout (measured this
  session): `new/index.tsx` 1917, `FilesSidebar` 442, `ActiveSessionsGroupCompact` 376, `typesRaw` 364,
  `CodexPatchView` 306, `SettingsView` 295, `SessionsList` 265, `ToolView` 206, `useSessionQuickActions` 199,
  `suggestionCommands` 192, `persistence` 185, `PermissionFooter` 146, `_layout(app)` 139, `info` 127,
  `_layout(root)` 73, `messageMeta` 60, `modelModeOptions` 53, `PierreDiffView` 35, `_all.tsx` 14,
  `suggestions.ts` 9, `useDemoMessages.ts` 8. `apiSocket` 578 / `ops` 614 / `reducer` 580 (sync-adjacent).
- **Entanglement spot-checks (read the actual hunks):** `suggestions.ts` (adds `MAX_COMMAND_SUGGESTIONS`,
  `source` field — pairs with HA-36); `useDemoMessages.ts` (`hasMoreOlder`→`hasOlder`/`oldestLoadedSeq`/
  `renderWindow` — storage-shape coupling → NOT a revert); `_all.tsx` (upstream added TaskOutput/TaskStop/
  FileEdit, dropped `permissionFooter` prop); `PierreDiffView.tsx` (fork `maxVisibleLines`/`hunks` replaced
  upstream `expandUnchanged`).
- **Guard state:** `sources/realtime/` absent in fork, 12 files in cli-1.1.10; no `@elevenlabs/*` in fork
  `package.json`. R8 overlay precedent: 26 modules under `packages/happy-app/sources/fork/*`.
- **Conflict-hunk counts:** from patch-surface §5 (`sync.ts` 22, `storage.ts` 24) and the rebasability
  brainstorm live merge (`storage.ts` 27, `SessionView` 19, `useGroupedMessages.test` 19, `new/index.tsx` 16,
  `sync.ts` 15, `MessageView`/`ChatList`/`AgentInput` 11 each).
- **No production code changed.** Read-only analysis; single Markdown deliverable.
