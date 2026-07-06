# R5 — happy-app sync-plane residual: per-hunk triage (`sync/sync.ts`, `sync/storage.ts`)

**Task:** `happy-app-r5-sync-plane-residual`
**Type:** read-only analysis (NO code changes to `sources/`)
**Branch/worktree:** `ralph/bs-app-r5` @ `D:/harness-efforts/codexu/.worktrees/bs-app-r5` (off main @ `16ce2ad1`)
**Method:** verified 3-way `git merge-file -p --diff3`, CRLF→LF normalized, BASE = true merge-base `df4cdae8` (cross-checked vs `cli-1.1.8`)

---

## 1. Goal + honest framing

The two files at the center of the happy-app conflict surface — `sync/sync.ts`
(the `Sync` class) and `sync/storage.ts` (the Zustand store) — are the **honest
R5 residual**: the R8 seam pattern (relocate fork logic into `sources/fork/…`
behind a thin seam) **cannot cleanly separate the fork divergence here**, and
this deliverable says so up front rather than manufacturing a seam that would
not survive the next intake.

Two structural facts make the R8 pattern inapplicable:

1. **Both files are single cohesive units, not collections of liftable blocks.**
   `storage.ts` is one Zustand `create()` call — a single object literal of
   state fields + methods that close over the store's `set`/`get`. `sync.ts` is
   one `Sync` class whose private methods share instance state (`this.encryption`,
   `this.sessionLastSeq`, `this.sessionOldestSeq`, `this.deferredSwitchRequests`,
   the sync queues). You cannot relocate an individual store method or class
   method into `sources/fork/` the way R8 lifted a React hook or component,
   because the moved code would lose access to the private `this`/store closure.

2. **The divergence is CONVERGENT EVOLUTION, not additive fork logic.** In R8,
   the fork code was *additive* — fork imports + fork-only modules + inline fork
   blocks sitting alongside otherwise-pristine upstream code, so the fork block
   could be lifted out and upstream's code left intact. Here, **both sides
   independently rewrote the SAME methods** — `sendMessage`, `fetchMessages`,
   `fetchMachines`, the socket update-handlers, and the store's older-message
   pagination — to solve the SAME problems (lazy older-history loading, image
   attachments, machine listing) with **different APIs**. There is no "pristine
   upstream + liftable fork block"; there are two divergent versions of one
   function.

**The fork has already extracted everything that *could* be extracted.** Its
net-new sync helpers are already in **zero-conflict fork-only modules** —
`paginationMath.ts`, `prefetchManager.ts`, `messageWindow.ts`,
`applyPrefetchedRange.ts`, `machineSessionId.ts` (plus `sessionGroupOrdering.ts`,
`slashCommandIntercept.ts`, `socketOptions.ts`, `tunnelProvider.ts`). None of
these conflict. The residual conflict lives entirely in the **call sites** that
wire those helpers into the shared class/store — and a call site cannot be
relocated without relocating the whole method (i.e. the whole class/store).

> **Bottom line (high confidence):** meaningful **file-count** reduction is
> **not** achievable — neither file returns to upstream and neither can be
> R8-seamed. Both stay permanent manual-3-way. What *is* achievable is
> meaningful **per-intake-effort** reduction via (a) formalizing the
> multi-account removal as KEEP-DELETED guard-by-absence rows so those hunks
> become mechanical take-ours, (b) documenting the already-extracted fork-only
> sync overlay so importers don't re-derive it, (c) a per-cluster **intake
> recipe** that turns each future import from a re-analysis into a checklist,
> and (d) two **operator-decision** convergence refactors (adopt upstream
> unread-tracking; rename fork pagination fields toward upstream) that would
> each shave a handful of hunks but change observable behavior / touch the
> e-ink prefetch system.

---

## 2. Reproduced 3-way enumeration

### BASE topology (verified — the task's "restructure moved the paths" concern was unfounded)

| Ref | `sync/sync.ts` | `sync/storage.ts` | Notes |
|---|---|---|---|
| `cli-1.1.7` | present | present | same `packages/happy-app/sources/sync/` path |
| `cli-1.1.8` | present | present | **same path** — no restructure. The `cli-1.1.8` tag was simply missing locally; fetched via `git fetch upstream-happy tag cli-1.1.8`. |
| `df4cdae8` (**merge-base**) | present | present | `= cli-1.1.7-89-gdf4cdae8` — 89 commits past 1.1.7, **after** 1.1.8. This is the true `git merge-base HEAD cli-1.1.10`. |
| `cli-1.1.10` (**THEIRS**) | present (2548 lines) | present | upstream target |
| fork `HEAD` (**OURS**) | present | present | |

Topology: `cli-1.1.7 → cli-1.1.8 → df4cdae8 (merge-base) → HEAD (OURS)` and
`df4cdae8 → cli-1.1.10 (THEIRS)`. `cli-1.1.8` is an ancestor of both HEAD and
1.1.10. **Not an add/add** — both files existed at every ancestor. Primary BASE
is the merge-base `df4cdae8` (what a real `git merge cli-1.1.10` diff3 produces);
`cli-1.1.8` cross-check gives the same storage.ts result and +1 sync.ts hunk (a
between-1.1.8-and-merge-base change), so merge-base is the correct, tighter BASE.

### Hunk counts (CRLF→LF normalized `git merge-file --diff3`, BASE = `df4cdae8`)

| File | Conflict hunks | Fork Δ vs upstream (diffstat) | Interpretation |
|---|---|---|---|
| `sync/sync.ts` | **22** | 1004 ins / 1607 del | Fork is **smaller** — removed the multi-account + attachment-upload + per-session-encryption plane; upstream grew it. |
| `sync/storage.ts` | **24** | 745 ins / 681 del | Roughly balanced churn — convergent pagination + fork tree-grouping vs upstream unread-tracking. |
| **Total** | **46** | | |

(Cross-check with BASE = `cli-1.1.8`: sync.ts 23, storage.ts 24. storage.ts BASE
is byte-identical at 1.1.8 and merge-base.)

Confirmed by inspection: **no `// FORK PATCH:` markers exist in either file** —
these two are exactly the "deferred M2+ (sync plane, ~R5)" rows HA-1/HA-2 in
`docs/happy-patch-surface.md §5`, never yet marked.

---

## 3. Per-cluster triage

Dispositions: **KEEP-seamable** (relocate to `sources/fork/` behind a thin seam,
R8 pattern) · **DISABLE-revertable** (revert to upstream, no meaningful loss) ·
**RESTORE-toward-upstream** (fork ≈ upstream OR fork lacks an upstream feature it
could adopt; adopting shrinks future conflict) · **must-stay-manual-3-way**
(entangled convergent evolution; cannot seam or revert). **KEEP-DELETED** is the
guard-by-absence sub-case of KEEP used for the multi-account plane (matches
`docs/happy-patch-surface.md §2`).

### 3a. `sync/storage.ts` — 24 hunks → 6 clusters

| Hunks | Cluster | Fork change | Upstream change | Disposition | Rationale |
|---|---|---|---|---|---|
| 4, 6, 14, 16, 17, 18, 23 | **Convergent older-message pagination** | `hasOlder`/`oldestLoadedSeq`/`loadingOlder`/`renderWindow`/`activePrefetch` fields + `setLoadingOlder`/`applyOlderMessages`/`setRenderWindow`/`setActivePrefetch`/`applyPrefetchedRange`/`clearActivePrefetch`/`applyMessagesLoaded(pagination)` | `hasMoreOlder`/`isLoadingOlder` fields + `applyOlderMessagesPagination`/`applyOlderMessagesLoading` | **must-stay-manual** | Both independently built "load older." Different field names + method sets on the same store object. Cannot seam (store closure), cannot revert (fork's render-window prefetch is the e-ink perf feature). **Rename-convergence refactor is the operator-decision lever — see §7.** |
| 5, 8, 9, 10, 11, 12, 15, 22, 24 | **Upstream unread-tracking ⟂ fork tree-grouping** | Fork rewrote `buildSessionRowData(s, machines)` / `buildSessionListViewData(sessions, machines)` for parent/children DFS tree-grouping (`TreeSessionRowData`, `depth`, `machineSessionId`) | Upstream threaded `unreadSessionIds`/`currentViewingSessionId` + `markSessionRead`/`markSessionUnread`/`setCurrentViewingSession`/`useIsSessionUnread` through the **same** two functions | **must-stay-manual** (unread sub-part = **RESTORE candidate**, entangled) | The two features collide on the exact same function signatures. Fork lacks unread entirely (verified: 0 `unreadSessionIds` refs). Adopting unread is possible but requires re-threading it through the fork's tree build — an entangled adopt, not a clean restore. See §7 operator call. |
| 3, 7(part), 8(part), 22(part), 24(part) | **Multi-account graph removal** | Fork **deleted** friends/users/feed/artifacts state, methods, hooks, `realtimeMode` debounce, and the artifact types import (verified: 0 `applyFriends`/`applyFeedItems`/`friendTypes` refs) | Upstream **kept + extended** them (hunk 22: fork deleted 123 lines, upstream grew to 158) | **KEEP-DELETED** (guard-by-absence) | Already deleted and load-bearing (single-user fork has no social graph). Intake action is mechanical **take-ours**. Formalize as HA-2a so it stops being re-analyzed each import. |
| 7, 13, 19 | **Permission-mode: fork `userChosen` vs upstream nullable** | Fork's `permissionModeUserChosen` sticky-choice model + `pinnedAvatar` overrides | Upstream's nullable permission modes + `resetOverrides` | **must-stay-manual** | Convergent divergence on the same override methods; both load-bearing (fork ships `storagePermissionModeUserChosen.test.ts`). |
| 2, 20, 21 | **Fork persistence adds (pinned avatars, tree-expanded, path-key)** | Fork adds `pinnedAvatars`, tree-expanded persistence, `machineSessionId` import; drops `friendTypes` import | Upstream adds `getSessionPathKey`/`resetOverrides` | **must-stay-manual** | Both add methods to the same store; trivial-but-nonzero take-both. |
| 1 | **Import line** | Fork: reducer `seedLatestBoundary` | Upstream: `ProjectFilesList` | **must-stay-manual** (trivial) | Take-both import merge. |

### 3b. `sync/sync.ts` — 22 hunks → 7 clusters

| Hunks | Cluster | Fork change | Upstream change | Disposition | Rationale |
|---|---|---|---|---|---|
| 4, 7, 8, 9 | **`sendMessage` / `enqueueUserMessage`** (largest) | `switchMode` + when-idle **deferred-switch** queue, `UserMessageAttachment`, Modal error handling, `permission`/`thinkingLevel` meta | Full **image-attachment upload pipeline** (`AttachmentPreview` → `getImageAttachmentSendPlan` → `uploadAttachmentsForSession`), `awaitQueue` retry, `resolveMessageModeMeta(session, settings)` + `effort` | **must-stay-manual** | Two independent rewrites of one method. Upstream's attachment path pulls in fork-absent modules (`attachmentSupport.ts`, `apiAttachments.ts`, `attachmentTypes.ts`) — a naïve 3-way auto-merges upstream's `import getImageAttachmentSendPlan` in and **breaks the fork build** unless resolved by hand. |
| 13, 14, 15, 16, 17 | **`fetchMessages` / older-history pagination** (largest) | `PrefetchManager` + `computeInitialAfterSeq`/`computeOlderPageAfterSeq` + `computeRenderWindow` render-window system; `forSession(sessionId)` scoping; `decodeApiMessages` (no per-session decrypt) + `normalizeRawMessage(…, seq, …)` extra param; `applyMessagesLoaded(sessionId, {hasOlder, oldestLoadedSeq})` | `fetchInitialLatestPage`/`fetchForwardSince`/`loadOlderMessages`/`prefetchOlderMessagesInBackground`; `encryption.decryptMessages`; `applyOlderMessagesPagination`/`applyOlderMessagesLoading` | **must-stay-manual** | The deepest convergent cluster. Both built lazy older-history loading with entirely different architectures. Also collides with the fork's **no-per-session-encryption** divergence (fork `decodeApiMessages` vs upstream `encryption.decryptMessages`). |
| 5, 6, 19, 20, 21 | **Socket update-handlers + encryption-readiness** | Fork **dropped** the "encryption required" early-return (single-user, no per-session E2E — the app analog of HC-1/HC-2); optimistic **placeholder session** (perf-WS2, BOOX new-message latency) + `compositeSessionId(machineId, sid)`; drops `removeSessionEncryption` | Upstream **enhanced** the gate: `awaitQueue()` retry before giving up (`#1251` "every chat stuck on New chat" title race; "session not found after sync") | **must-stay-manual** | Fork's no-E2E divergence + upstream's race-fix hardening rewrite the same handler blocks. Genuinely entangled. |
| 10, 11 | **`fetchMachines`** | Fork rewrote to the **loopback/tunnel single-user** model — reads `machine.machineId`/`hostname`/`tunnelUrl` un-encrypted (~130 lines) | Upstream kept **encrypted multi-machine** decryption + resilience: never-drop-machine-on-decrypt-failure (h10) and don't-wipe-populated-store-on-empty-result (h11) | **must-stay-manual** (resilience principle = **RESTORE candidate**, non-mechanical) | Fundamental architectural divergence — the whole method is different. Upstream's two resilience fixes are correctness improvements the fork's loopback path should *port the principle of* (follow-up), but not by adopting upstream's code. |
| 12 | **`syncSettings`** | Fork PUT + settings-error-classes (`SettingsPayloadTooLargeError`/`SettingsAuthError`/`SettingsSyncError`) replacing inline throws; drops feed filtering (`friend_request`/`friend_accepted`) | Upstream account-settings POST + `settingsToSyncPayload(settings)` wrapper | **must-stay-manual** + **KEEP-DELETED** (feed filter) | ~101-line near-parallel block; only real logic delta is the payload wrapper + error classes. Feed-filter removal is part of the multi-account KEEP-DELETED. |
| 1, 2, 3, 18 | **Imports + reconnect app-state** | Fork adds pagination/prefetch/`machineSessionId`/settings-error-class imports; **drops** `Encryption` imports | Upstream adds `apiAttachments`/`attachmentTypes`/`encryptBlob`, `webTabTitle` (unread), `settingsToSyncPayload`, `getCurrentAppState`; reconnect adds `apiSocket.sendAppState(getCurrentAppState())` (unread focus-state) | **must-stay-manual** (`settingsToSyncPayload` + `sendAppState` = **RESTORE candidates**, entangled with unread) | Import blocks collide; `sendAppState` on reconnect is a clean upstream add the fork could adopt **iff** it adopts unread-tracking. |
| 22 | **`update-session` body** | Fork `agentState` plain-JSON parse | (unchanged tail) | **must-stay-manual** (trivial) | Small fork-local parse tweak inside the rewritten handler. |

---

## 4. Recommended minimal reduction

### Disposition split (46 hunks → clusters)

| Disposition | Clusters | Hunks (approx) | Achievable now? |
|---|---|---:|---|
| **KEEP-seamable (R8 relocate to `sources/fork/`)** | **0** | 0 | **No** — the extractable helpers are *already* extracted into zero-conflict fork-only modules; the residual is un-relocatable call sites. |
| **DISABLE-revertable (revert to upstream)** | **0** | 0 | **No** — every fork divergence here is load-bearing (single-user loopback, e-ink prefetch, no-E2E, tree-grouping). Nothing low-value to revert. |
| **RESTORE-toward-upstream (adopt; entangled)** | 3 | ~9 | **Partly** (operator-gated) — unread-tracking (storage 5/8/22/24 + sync 1/18), `settingsToSyncPayload` (sync 2/12), machine-store resilience *principle* (sync 10/11). All entangled with fork rewrites → adopt-with-manual-merge, not clean restore. |
| **KEEP-DELETED (multi-account, guard-by-absence)** | 1 | ~5 | **Yes** — formalize as HA-2a/HA-1a; intake becomes mechanical take-ours. Reduces *effort*, not count. |
| **must-stay-manual-3-way** | 6–7 | ~32 | permanent — the convergent pagination, `sendMessage`, `fetchMessages`, `fetchMachines`, socket-handlers, permission-mode clusters. |

### Concrete recommendation (honest file/hunk estimate)

**Files: 2 → 2** (neither returns to upstream; neither is seamable). This is the
same honest finding as M1's `findings.md`: near-zero *file-count* reduction, real
*effort* reduction via localization + catalogue.

**Hunks: 46 → ~32–46 manual**, depending on operator decisions:

1. **No-code, do-now (effort reduction, count unchanged):**
   - Add **HA-1a / HA-2a KEEP-DELETED** rows for the multi-account plane (§6) so
     those ~5 hunks become mechanical **take-ours** (no re-analysis).
   - Add a **"fork-only sync overlay" context row** documenting the
     already-extracted zero-conflict modules (`paginationMath`, `prefetchManager`,
     `messageWindow`, `applyPrefetchedRange`, `machineSessionId`) so importers
     know the render-window prefetch system is import-safe and only the call
     sites conflict.
   - Ship the **§5 intake recipe** as the HA-1/HA-2 "resolution" field.
   - Net: 46 hunks stay, but ~5 become mechanical and the other ~41 each get a
     one-line "how to resolve" so the import is a checklist, not a re-derivation.

2. **Operator-decision refactors (count reduction, behavior/perf-touching — §7):**
   - **Adopt upstream unread-tracking** → collapses storage 5/8/22/24 + sync
     1/18 from "two divergent shapes" to "upstream shape + fork tree-grouping
     additive" (~6 hunks lighter, possibly ~2–3 eliminated). Changes UX (unread
     badges + web tab title).
   - **Rename fork pagination fields toward upstream** (`hasOlder`→`hasMoreOlder`,
     `loadingOlder`→`isLoadingOlder`; keep `renderWindow`/`activePrefetch`
     additive) → collapses storage 4/14/16/17/23 to additive diffs (~5 hunks
     lighter). Touches the e-ink prefetch system → needs a perf regression pass.

**Realistic outcome:** with both operator refactors, **~46 → ~35 manual hunks**,
of which ~5 are mechanical take-ours. Without them, the win is purely the
catalogue + recipe (effort, not count). Neither file ever leaves the manual set.

---

## 5. Intake recipe (for the next `cli-*` import)

For these two files, do **not** attempt a blind `git merge` — the auto-merge
silently pulls upstream's attachment/unread imports into a fork that lacks the
backing modules. Resolve per-cluster:

### `sync/storage.ts`

1. **Start from OURS** (`git checkout --ours storage.ts`) — the fork store is the
   larger structural rewrite (tree-grouping); porting upstream deltas onto it is
   cheaper than the reverse.
2. **Multi-account plane (KEEP-DELETED, HA-2a):** take-ours everywhere. If the
   diff shows upstream added/extended friends/users/feed/artifacts/`realtimeMode`,
   **drop it**. Verify post-merge: `grep -c 'applyFriends\|applyFeedItems\|friendTypes' storage.ts` == 0.
3. **Older-message pagination (convergent):** keep the fork fields/methods
   (`hasOlder`/`loadingOlder`/`renderWindow`/`activePrefetch`,
   `applyPrefetchedRange`, `applyMessagesLoaded(pagination)`). Port any upstream
   *behavior* fix inside `applyOlderMessages*` into the fork's equivalents by
   hand. Do **not** take upstream's `hasMoreOlder`/`isLoadingOlder` unless the
   rename refactor (§7-B) has landed.
4. **Unread-tracking (RESTORE, gated):** if §7-A **not** adopted → drop upstream's
   `unreadSessionIds`/`markSessionRead`/`setCurrentViewingSession`/`useIsSessionUnread`
   and the `unreadSessionIds` param on `buildSessionRowData`/`buildSessionListViewData`.
   If §7-A **adopted** → re-thread the `unreadSessionIds` param through the fork's
   tree-DFS build by hand.
5. **Permission-mode + persistence adds:** take-ours (`userChosen`, `pinnedAvatars`,
   tree-expanded). Port upstream `getSessionPathKey`/`resetOverrides` if
   referenced elsewhere.

### `sync/sync.ts`

1. **Start from OURS.** The fork is the smaller file (removed 3 planes); re-adding
   upstream features is opt-in.
2. **Imports:** manual take-both, then **prune** any upstream import whose backing
   module the fork doesn't ship (`apiAttachments`, `attachmentTypes`,
   `attachmentSupport`, `webTabTitle`) unless the corresponding feature is being
   adopted. This is the #1 auto-merge trap.
3. **`fetchMachines` (architectural):** take-ours wholesale (loopback/tunnel).
   Re-read upstream's diff **only** to check for a new resilience guard worth
   porting the *principle* of (don't-wipe-populated-store; degrade-to-null on
   decrypt-failure) — port by hand into the fork's loopback path, don't copy code.
4. **`sendMessage`/`enqueueUserMessage` (convergent):** take-ours. Re-apply the
   fork's deferred-switch + `UserMessageAttachment` + Modal handling. Adopt
   upstream's attachment-upload pipeline **only** as a deliberate feature port
   (see follow-up `happy-app-restore-voice-realtime-subsystem` sibling scope) —
   otherwise drop it and its imports.
5. **`fetchMessages`/pagination (convergent):** take-ours (`PrefetchManager` +
   render-window). Keep `decodeApiMessages` (no per-session decrypt) — do **not**
   take upstream's `encryption.decryptMessages` (fork is single-user no-E2E).
6. **Socket update-handlers:** take-ours (optimistic placeholder + `compositeSessionId`).
   Evaluate upstream's `awaitQueue()` retry guard (`#1251`) — the fork's
   single-user path may have the same latent "message before session" race;
   port the retry *shape* by hand if it applies.
7. **`syncSettings`:** take-ours (PUT + error classes). Adopt `settingsToSyncPayload`
   only if §7 decides to converge the payload shape.
8. **Reconnect `sendAppState`:** adopt only if unread-tracking (§7-A) is adopted.

**Post-merge gate:** `pnpm --filter happy-app exec tsc --noEmit` +
run the fork-only sync test suite (`paginationMath.spec.ts`,
`prefetchManager.spec.ts`, `messageWindow.spec.ts`, `applyPrefetchedRange.spec.ts`,
`loadOlderDedup.test.ts`, `machineFallbacks.test.ts`, `storage.tree.spec.ts`,
`storagePermissionModeUserChosen.test.ts`) — these encode the fork invariants the
manual merge must preserve.

---

## 6. Proposed `docs/happy-patch-surface.md §5` rows (propose only — do NOT edit)

Replace/augment the two existing deferred rows HA-1/HA-2 with the following. New
IDs HA-1a/HA-2a formalize the KEEP-DELETED multi-account guards; HA-1/HA-2 gain
concrete resolution recipes.

```
| ID    | File                         | Bucket        | Invariant / feature                                   | Resolution (intake)                                                                 |
|-------|------------------------------|---------------|-------------------------------------------------------|-------------------------------------------------------------------------------------|
| HA-1  | sync/sync.ts                 | KEEP (manual) | Single-user loopback sync: no-E2E fetch, loopback     | manual-3-way, start-from-OURS; §5 sync.ts recipe. Fork-only overlay modules         |
|       |                              |               | fetchMachines, PrefetchManager render-window, deferred | (paginationMath/prefetchManager/messageWindow/applyPrefetchedRange/machineSessionId) |
|       |                              |               | mode-switch, optimistic placeholder (perf-WS2)         | are zero-conflict; only call sites conflict. 22 hunks, permanent manual.            |
| HA-1a | sync/sync.ts                 | KEEP-DELETED  | Multi-account plane removed: friends/feed/artifacts/   | take-ours; drop any upstream re-add. Verify grep count == 0. Mechanical.            |
|       |                              |               | apiFeed/apiFriends imports + feed-filter in syncSettings |                                                                                   |
| HA-2  | sync/storage.ts              | KEEP (manual) | Zustand store: tree-session grouping (parent/children  | manual-3-way, start-from-OURS; §5 storage.ts recipe. 24 hunks, permanent manual.   |
|       |                              |               | DFS), userChosen permission mode, pinned avatars,      |                                                                                     |
|       |                              |               | render-window pagination fields                        |                                                                                     |
| HA-2a | sync/storage.ts              | KEEP-DELETED  | Multi-account store removed: friends/users/feed/        | take-ours; drop any upstream extend. Verify unreadSessionIds/applyFriends == 0.     |
|       |                              |               | artifacts state+methods+hooks, realtimeMode debounce   | Mechanical.                                                                          |
| HA-1b | sync/sync.ts + storage.ts    | RESTORE?      | Upstream unread-tracking (unreadSessionIds, webTabTitle,| OPERATOR-GATED (§7-A). Fork lacks entirely. Adopt = entangled re-thread through     |
|       |                              |               | sendAppState focus-state) — fork absent                | fork tree-build. If not adopted: drop upstream's unread additions each intake.      |
```

Also add a **context note** under §5 (not a row):

> *Sync-plane fork-only overlay (zero-conflict, import-safe): `paginationMath.ts`,
> `prefetchManager.ts`, `messageWindow.ts`, `applyPrefetchedRange.ts`,
> `machineSessionId.ts`, `sessionGroupOrdering.ts`, `slashCommandIntercept.ts`,
> `socketOptions.ts`, `tunnelProvider.ts`. The R5 conflict is entirely in the
> `sync.ts`/`storage.ts` call sites that wire these in — the modules themselves
> never conflict and require no seam work.*

---

## 7. Operator-decision calls

Both of these are **behavior/perf-touching convergence refactors** — they are
*not* intake-time actions and each changes something observable, so they need an
explicit ruling before any code task is filed. Both are the only levers that
actually reduce hunk **count** (§4); without them the win is catalogue/effort only.

### 7-A. Adopt upstream unread-session tracking? (recommend: **DEFER, lean no for e-ink**)

- **What:** upstream's `unreadSessionIds`/`currentViewingSessionId` +
  `markSessionRead`/`markSessionUnread`/`useIsSessionUnread` + web `webTabTitle`
  + reconnect `sendAppState(getCurrentAppState())`. Fork lacks all of it.
- **Reduction if adopted:** ~6 hunks lighter (storage 5/8/22/24, sync 1/18),
  possibly 2–3 eliminated, because the fork stops "reverting" pure upstream adds.
- **Cost:** entangled — the `unreadSessionIds` param threads through the exact
  `buildSessionRowData`/`buildSessionListViewData` functions the fork rewrote for
  tree-grouping, so adoption is a manual re-thread, not a clean take-theirs. It
  also adds UX (unread badges, web tab-title flashing) whose value on the e-ink
  BOOX target is questionable (unread badges = extra repaint churn).
- **Recommendation:** **defer.** The reduction is real but modest and the e-ink
  cost is non-zero. If adopted later, file it as its own task with an explicit
  e-ink perf pass + a default-`false` toggle per the fork's opt-in convention.

### 7-B. Rename fork pagination fields toward upstream? (recommend: **DEFER, revisit if intake pain persists**)

- **What:** rename the fork store's `hasOlder`→`hasMoreOlder`,
  `loadingOlder`→`isLoadingOlder` to match upstream, keeping
  `renderWindow`/`activePrefetch`/`oldestLoadedSeq` as additive fork fields. A
  behavior-preserving rename.
- **Reduction if adopted:** storage 4/14/16/17/23 (+ sync 16/17) collapse from
  "two divergent shapes" to "upstream shape + additive fork fields" (~5–7 hunks
  much lighter).
- **Cost:** touches the e-ink render-window prefetch system (`prefetchManager`,
  `messageWindow`, `applyPrefetchedRange` + their specs). Pure rename, but the
  fork's whole perceived-latency story rides on this code, so it needs the
  fork-only sync test suite green + a manual BOOX scroll-perf check.
- **Recommendation:** **defer** until the intake friction is actually felt on a
  real import. It's the highest-leverage count-reducer but also the one that most
  directly touches the fork's differentiating perf feature; do it deliberately,
  not speculatively.

### 7-C. Machine-store resilience — port principle (recommend: **file as correctness follow-up, not a reduction**)

- Upstream's `fetchMachines` gained two resilience fixes (never-drop-machine-on-
  decrypt-failure; don't-wipe-populated-store-on-empty). The fork's loopback
  `fetchMachines` is a different implementation but may share the latent
  "empty result wipes populated store" bug. **Not a conflict reducer** (the
  method stays fully manual), but worth a small correctness follow-up to port
  the *principle* into the fork's loopback path. Same for the `awaitQueue()`
  message-before-session race (`#1251`) — evaluate whether the fork's single-user
  path needs the analogous retry guard.

---

## Appendix — method & artifacts

- **3-way command (per file):** dump OURS=`HEAD:…`, BASE=`df4cdae8:…`,
  THEIRS=`cli-1.1.10:…` via `git show`, **CRLF→LF normalize each**
  (`-replace "\r",""`, `Set-Content -NoNewline`), then
  `git merge-file -p --diff3 <ours> <base> <theirs>`; count `<<<<<<<` regions.
  (The Windows CRLF trap otherwise collapses the whole file into one conflict.)
- **BASE choice:** merge-base `df4cdae8` (`= git merge-base HEAD cli-1.1.10`) is
  primary — it's what a real `git merge cli-1.1.10` produces. `cli-1.1.8`
  cross-check: storage.ts identical (24), sync.ts +1 (23).
- Scratch artifacts (`_scratch/`) — the normalized blobs, full diff3 output, and
  the per-hunk parse files — were used to produce this analysis and are **deleted
  before commit** (they are analysis inputs, not deliverables).
