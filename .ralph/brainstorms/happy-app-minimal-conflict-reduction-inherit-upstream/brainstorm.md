# Minimal-conflict reduction — MOVE fork divergence off the merge surface, inherit upstream features

**Task:** `happy-app-minimal-conflict-reduction-inherit-upstream`
**Type:** READ-ONLY analysis / brainstorm — NO production code changed (one Markdown deliverable).
**Branch / worktree:** `ralph/bs-app-minconflict` @ `D:/harness-efforts/codexu/.worktrees/bs-app-minconflict`
**Method:** re-triage of the app hard-conflict set (`docs/happy-patch-surface.md §5` HA-1…HA-52) under the
**MOVE-preferred** lens, cross-checked against measured per-file divergence
(`git diff --stat cli-1.1.10 HEAD -- <file>`, CRLF→LF), the R8 overlay precedent
(`packages/happy-app/sources/fork/*`, 26 modules), and the three companion brainstorms.

> **Framing correction applied (operator, 2026-07-08).** We do **NOT** drop any fork behavior — essential
> or not. The reduction lever is to **MOVE** each fork divergence into a fork-only `sources/fork/*` module so
> the upstream-canonical file stays near-upstream (merges clean, inherits upstream features) **while the fork
> behavior is preserved in the overlay**. The old "REVERT-to-upstream (lose the tweak)" disposition is
> retired. The decisive axis is now **REDUCIBLE → MOVE** vs **IRREDUCIBLE → ACCEPT**; the essential /
> non-essential split no longer decides keep-vs-drop (we keep everything) — it only informs overlay design.

> **Companion analyses (read; do not duplicate):**
> - `.ralph/brainstorms/happy-fork-make-truly-rebasable-on-upstream/brainstorm.md` — lineage verdict + why
>   `sync.ts`/`storage.ts` are irreducible + the "adopt-upstream+wrap" test + the M1 seam finding.
> - `.ralph/brainstorms/happy-app-r5-sync-plane-residual/brainstorm.md` — per-hunk sync-plane triage.
> - `.ralph/brainstorms/happy-app-restore-voice-realtime-subsystem/brainstorm.md` — voice keep-removed verdict.
> - `docs/happy-patch-surface.md §5` (HA rows + A0), §7 (merge policy), §9 (cadence).

---

## 1. Goal + honest framing (verdict first)

**The mechanism, restated.** The fork shares real merge lineage with upstream (established at the cli-1.1.10
intake). The operator wants upstream *app* features to flow in **automatically via `git merge`**. Today they
don't, because the fork **diverged inline on the same files** → 3-way conflict → resolved take-ours →
upstream's feature silently dropped. **The way to auto-inherit upstream is to stop the canonical file from
diverging — by MOVING the fork's behavior out of it, not by deleting the fork's behavior.**

**The three dispositions (MOVE / ALIGN / ACCEPT):**

1. **MOVE (the default for every reducible file).** Relocate the fork's divergence — whether essential
   identity behavior *or* a non-essential tweak — into a fork-only `sources/fork/*` module, and revert the
   upstream-canonical file to near-upstream + a thin seam (the R8 pattern). Result: the canonical file merges
   cleanly and inherits upstream features on future merges, **and every fork behavior is preserved** in the
   overlay. Bias hard toward this.
2. **ALIGN-to-upstream (rare, narrow).** ONLY where a conflicting file carries **no distinct fork behavior
   worth preserving** — pure convergent-evolution noise (both sides refactored the same code differently, but
   the fork's version holds no intentional feature/tweak). This is **not** "reverting a feature"; it's "there
   was nothing fork-specific to keep." Any intentional fork behavior ⇒ MOVE, not ALIGN. Small + justified.
3. **ACCEPT-CONFLICT (irreducible).** The convergent sync core that cannot be seamed (`sync.ts`,
   `storage.ts`, and the honest few adjacent monoliths). Permanent catalogued manual-3-way.

**Headline (the post-reduction number).** Of the **59 app hard-conflict files** (A0; 64 via live merge):

| Disposition | HA rows / files | What it buys |
|---|---:|---|
| **MOVE** (fork behavior → overlay; canonical near-upstream) | **~31** (5 R8 already DONE) | canonical file inherits upstream; fork behavior preserved in `sources/fork/*`; conflict drops to a thin seam that *usually* merges clean |
| **ALIGN** (no fork intent → upstream stands) | **~0** (criterion in §3.4; provisionally empty) | file leaves the diverged set entirely |
| **ACCEPT** (irreducible convergent core) | **~5–7** (`sync.ts`, `storage.ts`, `reducer.ts?`, `apiSocket.ts?`, `package.json`, i18n-if-not-MOVED) | permanent manual-3-way; recipe-driven |
| **KEEP-DELETED** (guard by absence) | **8 files + voice** (HA-49…52) | mechanical take-ours; NEVER take-theirs (resurrection hazard) |
| **merge=ours shim** (already zero-cost) | **3** (sidebar trio HA-10/11/12) | auto-resolves today; no manual work |

**Expected post-reduction conflict count: a permanent *expensive* floor of ~5–7 irreducible ACCEPT files
(`sync.ts` + `storage.ts` the hard core), with 0 fork behaviors dropped.** Everything else becomes a
fork-only overlay behind a thin seam (MOVE), a mechanical guard (KEEP-DELETED / merge=ours), or — rarely — an
ALIGN. Combined with merge lineage, each future release is `git merge <tag>` surfacing only that release's
delta against this small floor.

**The honest caveat about "conflict count" (do not oversell MOVE).** MOVE does **not** zero the
conflict-*marker* count. The R8/M1 finding (`findings-v2 §2.3`) is that relocation removed **zero hard-conflict
FILES** at a given snapshot, because the canonical file still carries a **thin seam call-site** that diverges
from upstream. What MOVE removes is the **resolution COST and frequency**: instead of the *entire* file being
fork-rewritten (so *every* upstream edit collides), only the small stable seam can collide — most upstream
edits land elsewhere in the file and **git 3-way-merges them cleanly**, so the fork inherits the feature. Over
many releases a MOVE'd file conflicts *far* less often and, when it does, it's a 1-line seam re-apply not a
100–200-line re-derivation. So the "~5–7" floor is the **expensive** residue; the ~31 MOVE seams are the
**cheap** residue that mostly auto-merges. That distinction is the whole game.

**The finding the operator should keep in mind.** MOVE is the right default, but it is **real work**:
relocating ~31 files into overlays is a multi-wave effort (R8 has done 5 so far across 5 stages). And a file
is only cleanly MOVE-able if its fork behavior is **separable** from the canonical file's structure. Two
sub-cases complicate this and are called out per-file below: (a) **plane-removal files** (e.g. `typesRaw.ts`,
`persistence.ts`, the route layouts) diverge by *deleting* an upstream plane — you cannot overlay an absence,
so their canonical file can only be "upstream **minus** the guarded removed plane," leaving a thin residual
divergence even after the fork's *additions* are MOVED out; (b) the **monolith core** (`sync.ts`,
`storage.ts`) has no seam at all → ACCEPT.

---

## 2. The essential-divergence boundary (now: overlay-design input, not keep-vs-drop)

Under the MOVE model we keep **all** fork behavior, so this boundary no longer decides revert-vs-keep. It now
tells the overlay designer **what must stay behaviorally identical** (default-off toggles, byte-identical
render output) and **which guards to preserve** (guard-by-absence for removed planes). It also flags the
files where "near-upstream" can only mean "upstream minus a guarded removal."

| # | Identity | Concrete surface in happy-app | Overlay-design implication |
|---|---|---|---|
| E1 | **Single-user / no-multi-account** | `Sync` class + store dropped friends/feed/artifacts/other-user; DFS **session tree**; `userChosen` permission mode | tree renderers MOVE to `sources/fork/session/*`; store closure is ACCEPT (no seam) |
| E2 | **No-central-server** (per-daemon, loopback) | loopback `fetchMachines`, remote-daemon socket/tunnel/ops, remote-daemon push tuning | daemon/codex ops + tunnel already partly in fork-only modules; MOVE the rest |
| E3 | **No per-session E2E** (plaintext codec) | `decodeApiMessages` no-decrypt; deleted `encryption/*`; dropped encryption wire types | plane-removal ⇒ residual guarded divergence (can't overlay an absence) |
| E4 | **e-ink perf** (static UI, no continuous repaint/animation) | inverted-FlatList + `BoundaryDivider`, static markdown/message/tool rendering, page-turn scroll, pinch scale, `chatToolGrouping`/`messageCommandChips` default-off toggles | MOVE targets already exist under `sources/fork/{chat,message,markdown,session,agentInput}/*`; **overlays must default to behavior-identical** |
| E5 | **Removed planes — KEEP-DELETED** (guard by absence) | voice/ElevenLabs (`sources/realtime/` — 12 files, absent), encryption plane (5), other-user screen, GitHub-connect, upstream `CLAUDE.md` | never MOVE/ALIGN; stay deleted; gate every wave on `encryptionDeletion.spec.ts` |

**Guard rail (unchanged):** a MOVE that reverts a canonical file toward upstream must never re-import an E5
plane. Gate every wave on `sync/encryptionDeletion.spec.ts` (asserts
`apiGithub|apiArtifacts|apiFeed|apiVoice|@/encryption/|@/sync/encryption/` == 0) + per-file `Test-Path == false`.

---

## 3. Per-file disposition table (columns: MOVE / ALIGN / ACCEPT)

Divergence size = `git diff --stat cli-1.1.10 HEAD` (lines changed, measured this session). Hunk counts from
patch-surface §5 / the live merge. **Disposition** is the re-triaged call under the MOVE-preferred lens.

### 3.1 ACCEPT — irreducible convergent core (permanent manual-3-way)

| HA | file | Δlines | disp. | why irreducible (no seam) |
|---|---|---:|:---:|---|
| HA-1 | `sync/sync.ts` | 15–22 hunks | **ACCEPT** | monolithic `Sync` class; divergence = removals (E1/E3) + convergent body-rewrites (loopback fetch, no-decrypt); no upstream seam. Proven. |
| HA-2 | `sync/storage.ts` | 24–27 hunks | **ACCEPT** | one Zustand `create()`; app calls `getState().X`; convergent tree-grouping ⟂ upstream unread on the same signatures. Proven. |
| HA-3 | `sync/reducer/reducer.ts` | 580 | **ACCEPT** *(MOVE-investigate)* | typed context-boundary + e-ink accumulation, convergent with upstream's reducer rewrite. If the context-boundary cases prove separable, downgrade to MOVE (fork reducer-extension); default ACCEPT. |
| HA-25 | `sync/apiSocket.ts` | 578 | **ACCEPT** *(MOVE-investigate)* | loopback/remote-daemon socket body-replacement; some fork logic already in `socketOptions.ts`/`tunnelProvider.ts` overlays, but the call sites convergent-conflict with upstream `sendAppState`. Default ACCEPT. |
| HA-48 | `package.json` | — | **ACCEPT** | deps/scripts diverge each intake; no merge driver; structural, un-seamable → §7 manual-3-way. |
| HA-7 | `text/_default.ts` + `text/translations/*` | multi | **ACCEPT** *(MOVE-preferred, §3.3)* | fork-added keys; `merge=union` UNSAFE (TS1117). MOVE to a fork-namespaced strings file if funded; else ACCEPT. |

### 3.2 MOVE — R8 UI overlays (essential e-ink; 5 already DONE, rest planned)

| HA | file | Δlines / hunks | disp. | overlay module (`sources/fork/…`) |
|---|---|---:|:---:|---|
| HA-4 | `-session/SessionView.tsx` | 19 hunks | **MOVE — DONE** (R8 s5) | `session/*` (composer, boundary, drawer, sidebar, header). SYNC-R5 residual in-place. |
| HA-5 | `components/ChatList.tsx` | 11 hunks | **MOVE — DONE** (R8 s2) | `chat/*`; grouping behind `chatToolGrouping` (default flat = identical). |
| HA-6 | `components/AgentInput.tsx` | 11 hunks | **MOVE — DONE** (R8 s4) | `agentInput/*`; upstream mic RESTORED inert. |
| HA-8 | `components/markdown/MarkdownView.tsx` | many | **MOVE — DONE** (R8 s1) | `markdown/*`. |
| HA-9 | `components/MessageView.tsx` | 11 hunks | **MOVE — DONE** (R8 s3) | `message/*`; chips behind `messageCommandChips` (default off). |
| HA-13 | `app/(app)/new/index.tsx` | **1917** (583↔1851, 16 hunks) | **MOVE** *(special case §5.1)* | `newSession/*` — fork e-ink+daemon screen behind a route flag; canonical near-upstream. |
| HA-14 | `components/ActiveSessionsGroupCompact.tsx` | 376 | **MOVE** | `session/*` — relocate the DFS tree-row renderer; canonical consumes it via seam. |
| HA-15 | `components/SessionsList.tsx` | 265 | **MOVE** | `session/*` — DFS tree list; also inherit upstream FlatList selection-stability on the canonical. |
| HA-20 | `components/tools/ToolView.tsx` | 206 | **MOVE** | `tools/*` — e-ink tool-card frame; canonical inherits upstream `toolDisplay` layout. |
| HA-22 | `components/tools/PermissionFooter.tsx` | 146 | **MOVE** | `tools/*` — e-ink permission footer (tied to `userChosen`). |
| HA-24 | `components/diff/PierreDiffView.tsx` | 35 | **MOVE** | `diff/*` — fork `maxVisibleLines`/`hunks` collapse-cap; canonical inherits `expandUnchanged`. |
| HA-19 | `app/(app)/session/[id]/info.tsx` | 127 | **MOVE** | `session/*` — fork single-user/e-ink info screen; canonical inherits parent-session nav. |
| HA-16 | `hooks/useSessionQuickActions.ts` | 199 | **MOVE** | `session/*` — fork quick-action set; canonical inherits upstream `resolveMessageModeMeta` defaults. |
| HA-38 | `components/SettingsView.tsx` | 295 | **MOVE-partial** | `settings/*` — e-ink controls MOVE; **removed multi-account/github/encryption rows are guarded** (§3.5); adopt version row. |
| HA-39 | `components/FilesSidebar.tsx` | 442 | **MOVE** | `files/*` — e-ink layout; canonical inherits all-files mode / path-split / line totals. |
| HA-21 | `components/tools/views/CodexPatchView.tsx` | 306 | **MOVE** | fork-owned codex renderer (already fork-only in spirit); adopt upstream patch normalization. |

### 3.3 MOVE — concat-from-fork list overlay (the highest-leverage sub-pattern)

Catalogue/list files diverge because the fork **appends** codex/daemon/e-ink rows to an upstream list. Have the
canonical file consume `upstream_list.concat(FORK_ROWS)` where `FORK_ROWS` lives in a fork-only module — the
**canonical list reverts to near-upstream and auto-merges** (inherits upstream's new rows) while the fork rows
are preserved.

| HA | file | Δlines | disp. | fork-only module |
|---|---|---:|:---:|---|
| HA-40/41 | `components/modelModeOptions.ts` (+test) | 53 | **MOVE-list** | `models/forkModelRows.ts` — inherits opus-4.8 + `xhigh` free. |
| HA-36 | `sync/suggestionCommands.ts` | 192 | **MOVE-list** | `slash/forkSlashCommands.ts` — inherits upstream `/goal` + skills. |
| HA-23 | `components/tools/views/_all.tsx` | 14 | **MOVE-list** | `tools/forkToolRegistry.ts` — canonical inherits `TaskOutput`/`TaskStop`/`FileEdit`; fork registers codex/gemini + `permissionFooter` prop from the module. |
| HA-37 | `components/autocomplete/suggestions.ts` | 9 | **MOVE-const** | `autocomplete/forkSuggestionLimits.ts` — canonical reads the e-ink caps (15 cmd / 5 file) via import; inherits upstream logic otherwise. |
| HA-7 | `text/*` i18n | multi | **MOVE-list** (future) | fork-namespaced strings file merged into the tree. |

### 3.4 MOVE — additive-field / config files + the ALIGN criterion

Fork body carries E2/E4 fields (or drops an E5 plane); upstream's delta is small + additive. MOVE the fork
additions to a fork module or declaration-merge; adopt the upstream additive hunk on the canonical.

| HA | file | Δlines | disp. | note |
|---|---|---:|:---:|---|
| HA-26 | `sync/ops.ts` | 614 | **MOVE-partial** | fork daemon/codex op builders → `sync/*` fork ops module (several already exist); adopt upstream additive builders; residual = removed multi-account ops (guarded). |
| HA-27 | `sync/typesRaw.ts` | 364 | **MOVE-partial** | fork codex wire types → fork types module (declaration-merge); adopt additive `thumbhash`/`claudeUuid`/`codexItemId`; residual = removed encryption/multi-account types (guarded). |
| HA-28 | `sync/messageMeta.ts` (+HA-29 test) | 60 | **MOVE** | fork codex fields + `effort`→`thinkingLevel` mapping → fork meta module; adopt `agentDefaultOverrides`. |
| HA-30 | `sync/typesMessageMeta.ts` | — | **MOVE-const** | adopt additive `effort` field; keep fork meta types alongside. |
| HA-31 | `sync/storageTypes.ts` (+HA-32 test) | — | **MOVE-const** | adopt additive `forkedFromMessageId`/`AgentGoalStatusSchema`. |
| HA-33 | `sync/localSettings.ts` (+HA-35 test) | — | **MOVE-const** | e-ink toggles kept; adopt additive `zenMode`. |
| HA-46 | `app.config.js` | — | **MOVE-const** | fork bundle ids/remote-daemon kept; adopt additive `buildCommitSha`/`NSAppTransportSecurity`. |
| HA-47 | `metro.config.js` | — | **MOVE-const** | fork Tauri/preact-singleton kept; adopt non-conflicting resolver hunks. |
| HA-42 | `hooks/useDemoMessages.ts` | 8 | **MOVE (follows storage)** | carries the fork render-window field rename (`hasOlder`/`oldestLoadedSeq`/`renderWindow`) — tracks the ACCEPT'd store shape; keep fork. **Not ALIGN** (it follows fork storage, not upstream). |

**ALIGN criterion (why the bucket is provisionally empty).** ALIGN applies only when a hunk carries **no
intentional fork behavior** — pure convergent-noise (incidental reformat / rename to match a shared symbol /
byte-level churn). From this analysis, **no app hard-conflict file is confidently ALIGN**: every diverged file
inspected shows intentional fork behavior (e-ink, single-user, codex, daemon, or a deliberate tweak).
Candidate ALIGN entries must be confirmed **per-hunk at the code stage** with an explicit "is there fork
intent here?" check; do not ALIGN a file just because it is small (a 9-line e-ink cap is still fork intent →
MOVE). Provisional ALIGN set: **∅**.

### 3.5 MOVE-partial residual — plane-removal files (you cannot overlay an absence)

These diverge by *deleting* an upstream plane, so even after MOVE-ing the fork's *additions* out, the canonical
file stays "upstream **minus** the guarded removed plane" — a thin residual divergence, guarded by absence.
This is the honest reason the ACCEPT-adjacent set is a bit larger than "just sync.ts/storage.ts."

| HA | file | Δlines | removed plane (guarded) | residual |
|---|---|---:|---|---|
| HA-17 | `app/(app)/_layout.tsx` | 139 | multi-account/github/feed routes (E1) | route-tree omission stays; adopt new settings route optionally (§6) |
| HA-18 | `app/_layout.tsx` | 73 | encryption/multi-account bootstrap (E1/E3) | bootstrap omission stays; adopt push-suppression/messages-channel optionally (§6) |
| HA-34 | `sync/persistence.ts` | 185 | encryption/multi-account persisted planes (E1/E3) | tree-expanded state MOVE-able; removal residual guarded |

### 3.6 KEEP-DELETED — resurrection hazards (take-ours; NEVER take-theirs)

| HA | files | plane | guard |
|---|---|---|---|
| HA-49 | `encryption/base64.ts`, `encryption/deriveKey.ts`, `sync/encryption/encryption.ts`, `sync/encryption/encryptor.ts`, `auth/secretKeyBackup.spec.ts` | E2E encryption (E3) | `encryptionDeletion.spec.ts` + `Test-Path==false` |
| HA-50 | `app/(app)/user/[id].tsx` | multi-account other-user (E1) | file-absence |
| HA-51 | `sync/apiGithub.spec.ts` | GitHub-connect | `apiGithub` absence |
| HA-52 | `packages/happy-app/CLAUDE.md` | upstream per-package doc | file-absence (fork uses `AGENTS.md`) |
| (voice) | `sources/realtime/*` (12 files) + `sync/apiVoice.ts` | voice/ElevenLabs (E5) | dir-absence; no `@elevenlabs/*` dep — see §5.2 |

### 3.7 merge=ours shim — essential tablet identity, already zero-cost

| HA | file | note |
|---|---|---|
| HA-10 | `components/SidebarView.tsx` | fork tablet sidebar; upstream same-name file is a DIFFERENT feature → `.gitattributes merge=ours` |
| HA-11 | `components/SidebarNavigator.tsx` | paired with HA-10 |
| HA-12 | `components/ChatHeaderView.tsx` | fork avatar-header + sidebar-restore control |

> Auto-resolve via `merge=ours` today (requires `git config merge.ours.driver true` on the merge host). Zero
> manual work — a git-handled ACCEPT. Could later be MOVE'd (fork header/sidebar to `sources/fork/session/*`)
> if the operator wants upstream's new-session-sidebar feature reachable, but that's optional. A0's
> `git merge-file` counted them among the 59 (it ignores `.gitattributes`); a real `git merge` does not.

### 3.8 Fork-owned wholesale files (keep entire file; not an overlay candidate)

`changelog/changelog.json` (HA-43), `CHANGELOG.md` (HA-44), `scripts/parseChangelog.ts` (HA-45): these are
**fork-owned** — the whole file is fork content (release history + parser), so there is nothing to "move out."
Keep wholesale (take-ours). They don't carry an upstream feature to inherit; not counted in the MOVE effort.

---

## 4. Wave plan

Each wave is independently shippable, gated, and MOVEs a coherent cluster off the conflict surface. Ordered by
leverage ÷ risk. **Nothing in any wave drops fork behavior** — each MOVE ships the overlay + a behavior-identical
seam.

### Wave 0 — Establish/confirm lineage (prerequisite)
- Real `git merge cli-1.1.10` committed so `merge-base` advances; future merges become incremental. **This is
  what makes each MOVE actually inherit upstream on the *next* release.** Already the operator's direction
  (`happy-establish-merge-lineage-cli-1.1.10`) — sequence the app MOVEs after it.
- Gate: `pnpm --filter happy-app typecheck` + fork sync suite.

### Wave 1 — MOVE-list / MOVE-const (cheapest, highest feature-yield)
- Files: **HA-40/41** (`modelModeOptions`), **HA-36** (`suggestionCommands`), **HA-23** (`_all.tsx`),
  **HA-37** (`suggestions.ts`), **HA-30/31/33/46/47** (additive-const files).
- Inherits: upstream model rows (opus-4.8, `xhigh`), `/goal` + skills slash, `TaskOutput`/`TaskStop`/`FileEdit`
  tool views, upstream mention logic, additive schema/config keys — all while preserving fork rows/caps in
  fork modules.
- Reduction: **~7–9 files** to clean-merge canonical + fork module.
- Gates: `modelModeOptions.test.ts`, `suggestionCommands.test.ts`, `autocomplete/suggestions.test.ts`,
  `components/tools/*` tests, typecheck, **`encryptionDeletion.spec.ts`**, e-ink spot-check.

### Wave 2 — MOVE tool/diff/permission renderers
- Files: **HA-20** (`ToolView`), **HA-24** (`PierreDiffView`), **HA-22** (`PermissionFooter`), **HA-21**
  (`CodexPatchView` — adopt normalization).
- Inherits: upstream tool-card layout, `expandUnchanged`, patch normalization; fork e-ink versions preserved in
  `sources/fork/{tools,diff}/*`.
- Reduction: **~4 files** to thin seams.
- Gates: `components/tools/*`, `diff/CollapsibleDiffPreview.test.tsx`, typecheck, e-ink spot-check.

### Wave 3 — MOVE session-tree + screens
- Files: **HA-14** (`ActiveSessionsGroupCompact`), **HA-15** (`SessionsList`), **HA-19** (`info.tsx`),
  **HA-16** (`useSessionQuickActions`), **HA-38** (`SettingsView`, MOVE-partial + guard), **HA-39**
  (`FilesSidebar`).
- Inherits: upstream session-list selection-stability, parent-session nav, resume defaults, settings version
  row, files all-files mode; fork DFS-tree / e-ink versions preserved in `sources/fork/session/*`.
- Reduction: **~6 files** to thin seams (SettingsView keeps a guarded residual).
- Gates: per-file test rows + `encryptionDeletion.spec.ts` + e-ink spot-check.

### Wave 4 — MOVE the new-session screen (largest single file)
- File: **HA-13** (`new/index.tsx`, 1917 Δ, 16 hunks) → `sources/fork/newSession/*` behind a route flag;
  canonical near-upstream.
- Inherits: upstream's richer new-session screen becomes reachable-by-flag; fork e-ink+daemon screen preserved.
- Reduction: the single largest file drops to a route-flag seam.
- Gates: `new/index.unifiedComposer.test.ts`, typecheck, e-ink pass on the new-session screen.

### Wave 5 — MOVE-partial residuals + i18n (optional, lower leverage)
- Files: **HA-17/HA-18** (route/root layout — MOVE fork bootstrap, guard removals), **HA-26** (`ops.ts` fork
  ops → module), **HA-27** (`typesRaw` fork types → declaration-merge), **HA-28** (`messageMeta`), **HA-7**
  (i18n namespaced strings).
- Reduction: shrinks each toward a guarded thin divergence.
- Gates: `sync/*` test rows, `encryptionDeletion.spec.ts`, typecheck.

### Wave 6 (no action) — ACCEPT the core
- `sync.ts`, `storage.ts` (hard core), `reducer.ts`/`apiSocket.ts` (unless MOVE-investigate succeeds),
  `package.json`. Resolution = the per-cluster recipe in `happy-app-r5-sync-plane-residual §5`. No seam attempt
  — proven hard ceiling.

**Cumulative expected outcome:** ~31 files MOVE to fork-only overlays + thin seams (inherit upstream, preserve
fork behavior), 8 stay KEEP-DELETED guards, 3 stay merge=ours, leaving a **permanent expensive floor of ~5–7
irreducible ACCEPT files**. Zero fork behaviors dropped.

---

## 5. Special-case rulings

### 5.1 `new/index.tsx` — **MOVE** (fork-own the e-ink new-session behind an overlay/flag)
- **Divergence:** 1917 Δ; fork 583 vs upstream 1851 (16 hunks). Upstream tripled it (new-session right
  sidebar + FilesSidebar + richer machine/path/worktree/agent config); the fork keeps a lean e-ink screen with
  **E2 remote-daemon machine/agent pickers**.
- **Ruling: MOVE, not revert.** Relocate the fork's lean e-ink+daemon screen to `sources/fork/newSession/`,
  let upstream's `new/index.tsx` merge near-clean, and pick fork-vs-upstream by a route flag. Upstream's
  new-session features become **inheritable by flag** while the fork's e-ink+daemon screen and its remote-daemon
  pickers are **preserved in the overlay** (nothing dropped). Rated "partially restructurable" by the
  rebasability brainstorm — it's a leaf UI screen, the ideal MOVE target. Cost ~M (the largest single file).

### 5.2 Voice / realtime — **KEEP-DELETED** (an intentional divergence to maintain; the reframe does not force restore)
- **State:** fork deleted `sources/realtime/` (12 files, ~1177 lines) + `apiVoice.ts` + storage realtime
  state; no `@elevenlabs/*` deps. Upstream cli-1.1.10 still ships all of it → an **E5 resurrection hazard**,
  guarded by absence, **not** in the 59 content-conflict set (it's an add-conflict like HA-49).
- **Framing under "inherit upstream + minimal conflict."** Keeping voice removed **is** an intentional
  divergence the fork maintains (drop upstream's realtime re-adds every merge). The reframe does **not** force
  restoring it — "minimal conflict" is served by *cheap mechanical maintenance* of the deletion (guard-tested
  take-ours), not by re-adopting a subsystem that violates fork identity. Restoring re-introduces a
  **central-server** ElevenLabs credential broker (`POST /v1/voice/conversations`, RevenueCat paywall — E2),
  **continuous mic→3rd-party-cloud** egress, an **animated `VoiceAssistantStatusBar`** (VAD-driven repaint —
  E4), and **2 npm deps**.
- **Ruling: stays KEEP-DELETED** (the `happy-app-restore-voice-realtime-subsystem` verdict holds). **Surface
  the decision** to the operator, framed as: *maintaining the removal is cheap and identity-preserving; the
  reframe doesn't override it.* The upstream mic UI is already restored **inert** (HA-6), so nothing is lost by
  waiting. **Operator-call only if** hands-free tablet voice is explicitly wanted — then the only acceptable
  path is the bypass-only, push-to-talk, e-ink-static, default-off minimal restore (a separate feature task,
  not part of this reduction workstream).

### 5.3 Removed encryption / multi-account / github planes — **KEEP-DELETED** (guard by absence)
- The 8 A0 resurrection-hazard files (HA-49 encryption ×5, HA-50 other-user screen, HA-51 apiGithub, HA-52
  upstream CLAUDE.md) stay **take-ours-deleted**, confirmed absent at HEAD.
- **Load-bearing constraint on every MOVE wave:** a MOVE that reverts a canonical file toward upstream must not
  re-import a removed plane. Every wave gates on `sync/encryptionDeletion.spec.ts` + per-file `Test-Path ==
  false`. The MOVE-partial files (§3.5) explicitly keep the removal as a guarded residual — they never adopt
  upstream's removed-plane code.

---

## 6. Operator-decision calls (ranked)

Under the MOVE model these are **no longer keep-vs-drop** (we keep all fork behavior). They are:
(A) whether to also **surface an upstream NEW feature** that MOVE makes inheritable, and (B) the voice call.

1. **Voice restore vs keep-removed.** **Lean: KEEP-DELETED** (§5.2). Restore only on explicit request, bypass-only variant.
2. **HA-17 — surface upstream's new settings/agents route** (MOVE makes it inheritable)? Behavior-visible. **Lean: yes if wanted; default keep hidden.**
3. **HA-18 — surface upstream foreground-push suppression / messages channel / browser shortcuts?** Entangled with E2 daemon push. **Lean: adopt push-suppression cautiously; verify against remote-daemon behavior.**
4. **HA-38 — surface upstream Agent Defaults section** (beyond the version row)? **Lean: defer Agent Defaults; adopt version row now.**
5. **HA-16 — surface upstream resume model/permission defaults** on the canonical? Changes resume preset. **Lean: keep fork preset as the default; expose upstream behind the fork quick-actions overlay.**
6. **HA-39 — surface upstream files all-files mode** in the fork sidebar overlay? **Lean: yes, additive.**
7. **HA-27 — file-event attachment rendering** (upstream additive tool-result shapes)? **Lean: adopt additive fields; defer file-event rendering behind a toggle.**
8. **HA-3 / HA-25 MOVE-investigate:** should reducer/apiSocket be attempted as MOVE (fork reducer-extension / socket seam) or accepted? **Lean: spike the seam once; ACCEPT if it doesn't cleanly separate.**
9. **merge=ours trio → MOVE?** Only if upstream's new-session-sidebar feature is wanted reachable. **Lean: leave as zero-cost shim.**
10. **i18n (HA-7) — fund the fork-namespaced strings MOVE** now or accept manual? **Lean: fund when i18n conflicts recur.**

---

## 7. Risk

- **MOVE is real, multi-wave effort.** Relocating ~31 files into overlays is the bulk of the work (R8 has done
  5 across 5 stages). Sequence by leverage; don't attempt a big-bang. This is effort, not behavior risk.
- **Thin seams still conflict occasionally (don't oversell the reduction).** Per the M1/R8 finding, MOVE
  removes *zero* hard-conflict FILES at a snapshot — it converts a whole-file re-derivation into a stable
  1-line seam that mostly auto-merges but can re-collide if upstream edits the seam site. "Post-reduction
  conflict count" therefore means the **expensive** floor (~5–7 ACCEPT), not zero markers.
- **Behavior-identity risk in the MOVE itself.** Each overlay must reproduce fork behavior exactly (default
  toggles off, byte-identical e-ink render). A MOVE that subtly changes rendering is a regression — gate every
  MOVE on the file's existing test row **and an e-ink spot-check on the tablet**.
- **Inheriting upstream's animated UI on the canonical.** MOVE reverts the canonical toward upstream, which may
  carry continuous-repaint affordances (unread badges, animated status bars, smooth-scroll). The seam must keep
  the fork's static e-ink path as the default; surfacing an upstream animated feature (§6) needs an e-ink pass.
- **Resurrection hazard.** A MOVE toward "near-upstream" on a plane-removal file (§3.5) risks re-including a
  removed E5 plane. Guard-by-absence (`encryptionDeletion.spec.ts` + `Test-Path`) gates every wave; the
  MOVE-partial files keep the removal as an explicit guarded residual.
- **ALIGN mis-judgment (the one drop-risk left).** ALIGN is the only disposition that lets upstream's version
  stand — so aligning a file that actually had fork intent **drops behavior**, the exact thing to avoid.
  Mitigation: ALIGN is provisionally empty; any candidate needs a per-hunk "is there fork intent?" check at the
  code stage before it may ALIGN.
- **Honesty ceiling.** This does not reach "zero manual files." The irreducible core (`sync.ts`/`storage.ts`,
  and likely `reducer.ts`/`apiSocket.ts`, plus `package.json`) is permanent manual-3-way by convergent
  evolution against a seam-less upstream — proven in the rebasability + R5 brainstorms. The prize is a small,
  bounded, catalogued floor + auto-inheritance of everything reducible, **with no fork behavior dropped**.

---

## Appendix — method & reproducibility

- **Disposition source:** re-triage of `docs/happy-patch-surface.md §5` HA-1…HA-52 (A0) under the
  MOVE-preferred lens (operator framing correction, 2026-07-08). Old rows are conservative KEEP; re-classified
  here into MOVE / ALIGN / ACCEPT.
- **Divergence sizes** (`git diff --stat cli-1.1.10 HEAD -- <file>`, measured this session): `new/index.tsx`
  1917, `apiSocket` 578, `ops` 614, `reducer` 580, `FilesSidebar` 442, `ActiveSessionsGroupCompact` 376,
  `typesRaw` 364, `CodexPatchView` 306, `SettingsView` 295, `SessionsList` 265, `ToolView` 206,
  `useSessionQuickActions` 199, `suggestionCommands` 192, `persistence` 185, `PermissionFooter` 146,
  `_layout(app)` 139, `info` 127, `_layout(root)` 73, `messageMeta` 60, `modelModeOptions` 53, `PierreDiffView`
  35, `_all.tsx` 14, `suggestions.ts` 9, `useDemoMessages.ts` 8.
- **Entanglement spot-checks (read actual hunks):** `suggestions.ts` (adds `MAX_COMMAND_SUGGESTIONS`, `source`
  field — pairs with HA-36); `useDemoMessages.ts` (`hasMoreOlder`→`hasOlder`/`oldestLoadedSeq`/`renderWindow` —
  storage-shape coupling → MOVE-follows-storage, NOT ALIGN); `_all.tsx` (upstream added TaskOutput/TaskStop/
  FileEdit, dropped `permissionFooter` prop → MOVE-list preserving codex/gemini + the prop); `PierreDiffView.tsx`
  (fork `maxVisibleLines`/`hunks` replaced upstream `expandUnchanged` → MOVE).
- **Guard state:** `sources/realtime/` absent in fork, 12 files in cli-1.1.10; no `@elevenlabs/*` in fork
  `package.json`. R8 overlay precedent: 26 modules under `packages/happy-app/sources/fork/*`.
- **Hunk counts:** patch-surface §5 (`sync.ts` 22, `storage.ts` 24) + rebasability live merge (`storage.ts` 27,
  `SessionView` 19, `useGroupedMessages.test` 19, `new/index.tsx` 16, `sync.ts` 15, `MessageView`/`ChatList`/
  `AgentInput` 11 each). M1 seam finding: `findings-v2 §2.3` (relocation removed zero hard-conflict files).
- **No production code changed.** Read-only analysis; single Markdown deliverable.
