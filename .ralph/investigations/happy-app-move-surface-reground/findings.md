# happy-app MOVE-surface re-grounding — honest source-verified re-classification

**Investigation:** `happy-app-move-surface-reground`
**Mode:** READ-ONLY. No source edited, no git write/checkout/commit/branch. Only read-only
`git diff`/`git show`/`git merge-base`/`git tag`.
**Date:** 2026-07-08
**Author:** read-only investigation sub-agent

---

## 1. Verification header

- **cli-1.1.10 ref used:** local tag `cli-1.1.10`.
- `git rev-parse cli-1.1.10` → **`71c417e1092e73cf34eb24f9601d569394c1f359`**
- `git rev-parse HEAD` → `90ea0338c90a7a54c95d83cf58c...47efd291e` (main)
- `git merge-base HEAD cli-1.1.10` → **`71c417e1092e73cf34eb24f9601d569394c1f359`** (== cli-1.1.10 itself)
- `git merge-base --is-ancestor cli-1.1.10 HEAD` → **exit 0** (cli-1.1.10 IS an ancestor / the merge-base)

**Therefore the corrected premise holds and is applied throughout:** `git diff cli-1.1.10 HEAD -- <file>`
is the fork's **net divergence** on that file. Reverting a file to cli-1.1.10 **DROPS fork behavior (a
regression)** — it does NOT "inherit upstream's skipped features." Any `+` line is fork-added; any `-` line is
fork-removed **relative to upstream**. The brainstorm's recurring "inherit upstream X for free" framing is
tested against this and, for several flagship files, is **inverted** (the fork REMOVED the thing the brainstorm
says it would "inherit").

- **Total happy-app files diverging cli-1.1.10→HEAD:** ~400 (whole package, incl. added tests + deleted planes).
- **Files examined for this re-classification:** the **32 distinct code files** the brainstorm §3 tags
  MOVE / MOVE-list / MOVE-const / MOVE-partial (HA rows across §3.2–§3.5), including the 5 R8-"DONE" overlays
  (used as empirical calibration of what a *completed* MOVE actually leaves behind).

---

## 2. Per-file table

Δ = `git diff --stat cli-1.1.10 HEAD` (ins/del). "Seam est" = lines of the **canonical** file the fork would
still touch after a MOVE (for DONE rows, this is the **measured** current residual, not an estimate).

| File | §3 class | VERIFIED class | Fork-divergence shape (diff evidence) | Post-MOVE seam est | Inherits FUTURE upstream cleanly? | Notes |
|---|---|---|---|---|---|---|
| `components/tools/views/CodexPatchView.tsx` | MOVE (HA-21) | **TRUE-MOVE-CLEAN** | +94/-212, 3 hunks; fork-OWNED codex renderer, whole-file rewrite of an independent view | ~1 line (registry entry) | Yes — canonical upstream copy untouched; fork copy registered from a fork module | Best clean target. But it does NOT "inherit upstream normalization" (brainstorm claim) — the two versions are independent. |
| `components/tools/views/_all.tsx` | MOVE-list (HA-23) | **TRUE-MOVE-CLEAN** (small residual) | +9/-5; registry `Record` additions (`TaskOutput`/`TaskStop`/`file-edit`) + removed `file`/`FileView` + removed `permissionFooter?` prop | ~3-5 lines | Mostly — a `{...upstream, ...forkRows}` spread merges upstream rows | Registry is the genuine concat-pattern. Entangled residual = the `permissionFooter?` type-prop removal (ties to ToolView). |
| `components/autocomplete/suggestions.ts` | MOVE-const (HA-37) | **TRUE-MOVE-CLEAN** (marginal) | +6/-3; added `MAX_COMMAND_SUGGESTIONS=15` const, `limit:50→15`/`→5` e-ink caps, `+source` field | ~3 lines | Yes | Genuinely clean but tiny ROI (6-line divergence → ~3-line seam). |
| `sync/localSettings.ts` | MOVE-const (HA-33) | **TRUE-MOVE-CLEAN** (partial) | +21/-4; Zod: +10 e-ink toggle fields, **−`voiceUpsellOverride`(E5)**, **−`zenMode`** | ~5-6 lines (`.merge()` + defaults spread + guarded `.omit`) | Additions: yes via declaration-merge; removals leave a guarded omit residual | Brainstorm "adopt additive `zenMode`" is **INVERTED** — fork REMOVED zenMode. |
| `components/ChatList.tsx` | MOVE — DONE (HA-5) | **TRUE-MOVE-CLEAN (render) + storage-coupled residual** | +42/-54; top-level seam → `ForkFlatChatList` (clean), BUT `ChatListGrouped/Internal` still use fork storage fields `hasOlder`/`loadingOlder`/`sync.loadOlder`, `useChatWidth`, dropped fork-from-message | ~40 lines residual (~15 clean seam + ~25 storage-plane-coupled) | Render: yes; older-page path: **no** (tracks ACCEPT'd `storage.ts`) | The only "DONE" overlay that got near a thin seam — and even it keeps a storage-coupled tail. |
| `app/(app)/new/index.tsx` | MOVE special (HA-13) | **MOVE-FEASIBLE-SPECIAL (expensive)** | +288/-1629, 11 hunks; fork 288-line lean screen vs upstream ~1917-line screen — effectively two different screens | whole-screen route-flag swap | Only if you host upstream's full screen as canonical | Feasible as a flag-gated whole-file swap, but hosting upstream's 1851-line screen re-introduces removed-plane references (multi-account pickers, all-files sidebar). Real cost + regression risk. |
| `components/AgentInput.tsx` | MOVE — DONE (HA-6) | **ENTANGLED** | +765/-417, **26 hunks** — even AFTER R8 overlay extraction the canonical file is massively diverged | ~700+ lines (measured, post-MOVE) | No | Empirical proof MOVE ≠ thin seam for complex interactive components. |
| `components/MarkdownView.tsx` | MOVE — DONE (HA-8) | **ENTANGLED** | +95/-154, ~17 hunks interleaved across every render block + big style deletions | ~150 lines (measured) | No | "DONE" but still interleaved e-ink rewrite. |
| `components/MessageView.tsx` | MOVE — DONE (HA-9) | **ENTANGLED** | +183/-54, 14 hunks; `messageCommandChips` toggle + e-ink render threaded through RenderBlock/UserTextBlock/AgentEventBlock/ToolCallBlock/styles | ~180 lines (measured) | No | "DONE" but the toggle-gated fork still touches every block. |
| `app/(app)/-session/SessionView.tsx` | MOVE — DONE (HA-4) | **ENTANGLED** | +382/-656, 13 hunks; net −274 removals (E1/E2 session-plane) | ~600 lines (measured) | No | "DONE" but heavily diverged; session/sync-plane coupled. |
| `components/ActiveSessionsGroupCompact.tsx` | MOVE (HA-14) | **ENTANGLED** | +279/-97, **18 hunks** spread across STATUS_CONFIG/SectionHeader/main/CompactSessionRow/styles — in-place DFS-tree rework (E1) | high; would need full component rewrite | No | Not an appended block; the tree renderer is woven through the whole component. |
| `components/SessionsList.tsx` | MOVE (HA-15) | **ENTANGLED** | +208/-57, 15 hunks; in-place DFS-tree list rework (E1) | high | No | Same as above. |
| `components/tools/ToolView.tsx` | MOVE (HA-20) | **ENTANGLED** | +76/-130, 14 hunks; interleaved render rewrite + `permissionFooter` prop-surface change (affects `_all.tsx` + consumers) | high | No | Brainstorm "inherit toolDisplay layout" — but it's an interleaved rewrite, not a relocatable block. |
| `components/tools/PermissionFooter.tsx` | MOVE (HA-22) | **ENTANGLED** | +77/-69, **15 hunks**; near-1:1 style/prop tweaks threaded through the whole render + a body rewrite; tied to `userChosen` (E1) | high | No | Permission-mode identity (E1) is woven in, not separable. |
| `components/diff/PierreDiffView.tsx` | MOVE (HA-24) | **ENTANGLED (small)** | +27/-8; **−`expandUnchanged`** prop, +`maxVisibleLines`/`hunks`, web render return restructured | ~15 lines | Partial | Brainstorm "inherit `expandUnchanged`" is **INVERTED** — fork REMOVED it. |
| `app/(app)/session/[id]/info.tsx` | MOVE (HA-19) | **ENTANGLED / MOVE-partial** | +44/-83, 8 hunks; E1 multi-account info removals interleaved | moderate residual | Partial | Removal residual can't be overlaid. |
| `hooks/useSessionQuickActions.ts` | MOVE (HA-16) | **ENTANGLED / MOVE-partial** | +57/-142, 7 hunks; big `−66` removal of multi-account/other-user quick actions (E1) interleaved | moderate residual | Partial | Mostly a removal, not an additive block. |
| `components/SettingsView.tsx` | MOVE-partial (HA-38) | **ENTANGLED / MOVE-partial** | +92/-203, 9 hunks; big removals of multi-account/github/encryption rows (E1/E3) + e-ink additions | guarded-removal residual | Partial | "Inherit version row" is additive-true, but the file is dominated by guarded removals. |
| `components/FilesSidebar.tsx` | MOVE (HA-39) | **ENTANGLED** | +119/-323, 16 hunks; huge net removal (`−126` in main component, `−63` in AllFilesTab) + interleaved rewrite | high | No | Brainstorm "inherit all-files mode" looks **INVERTED** — the fork removed large chunks of that path. |
| `components/modelModeOptions.ts` | MOVE-list (HA-40/41) | **ENTANGLED** | +40/-13; removed `getCodeAgentDefaults` dep, rewrote 4 exported functions inline, **−`xhigh`**, `opus 4.8→4.7`, +`resolvePermissionModeForPicker` | high (N consumers of exported fns) | No | Brainstorm "inherit opus-4.8 + `xhigh` free" is **DOUBLY INVERTED** — fork has opus-4.7 and REMOVED xhigh. Not a list-concat. |
| `sync/suggestionCommands.ts` | MOVE-list (HA-36) | **ENTANGLED** | +123/-69, 3 hunks; **wholesale rewrite** of the command system (new `CommandSource`, `NATIVE_PROMPT_COMMANDS`, `APP_SYNTHETIC_COMMANDS`, `classifyCommand`/`buildCommandItem`, rewrote `searchCommands`) | high | No | The flagship "highest-leverage MOVE-list" claim **collapses**: this is a reimplementation, not `upstream.concat(forkRows)`. |
| `sync/messageMeta.ts` | MOVE (HA-28) | **ENTANGLED (small)** | +34/-26, 1 concentrated hunk; rewrite of the meta-mapping region (`effort`→`thinkingLevel` mapping + codex fields) | moderate | No | Single-region rewrite, not an additive overlay. |
| `sync/typesMessageMeta.ts` | MOVE-const (HA-30) | **ENTANGLED (small)** | +11/-2; Zod schema: +`thinkingLevel`/`capabilities`/`attachmentRefs`/`contextBoundaryFallback`, **−`effort`** | ~4 lines | Additions via `.extend()`; removal not cleanly expressible | Brainstorm "adopt additive `effort`" is **INVERTED** — fork REMOVED effort in favor of thinkingLevel. |
| `app/(app)/_layout.tsx` | MOVE-partial (HA-17) | **ENTANGLED / ACCEPT-adjacent** | +22/-117, 4 hunks; dominated by a `−72` route-tree removal (E1) | removal residual (can't overlay an absence) | No | Mostly a plane deletion. |
| `app/_layout.tsx` | MOVE-partial (HA-18) | **ENTANGLED / MOVE-partial** | +27/-46, 8 hunks; encryption/multi-account bootstrap removals (E1/E3) interleaved | removal residual | Partial | Interleaved removals + a few additive push hunks. |
| `sync/ops.ts` | MOVE-partial (HA-26) | **ACCEPT-adjacent** | +231/-383, **~30 hunks** across every `machine*`/`session*` fn; loopback/daemon (E2) rewrite + `−123` multi-account op removal | not seamable | No | Every function touched — convergent-rewrite, effectively manual 3-way. |
| `sync/typesRaw.ts` | MOVE-partial (HA-27) | **ACCEPT-adjacent** | +188/-176, **~30 hunks**; `−87` wire-type block removal + a type-signature change threaded through ~20 `normalizeRawMessage` call sites | not seamable | No | Deeply interleaved; the threaded per-call change is the ACCEPT signature. |
| `sync/storageTypes.ts` | MOVE-const (HA-31) | **ACCEPT-coupled** | +63/-61, 9 hunks; Metadata/AgentState/Session/Machine schema rewrite incl. `−43` multi-account/encryption-type removal | not cleanly seamable | No | Couples to the ACCEPT'd storage plane. |
| `sync/persistence.ts` | MOVE-partial (HA-34) | **ENTANGLED / ACCEPT-coupled** | +119/-66, 6 hunks; plane-removal (E1/E3) + tree-expanded state, storage-plane coupled | moderate residual | No | Tracks the ACCEPT'd store. |
| `hooks/useDemoMessages.ts` | MOVE follows-storage (HA-42) | **ACCEPT-coupled** | +5/-3; field rename `hasMoreOlder→hasOlder`, `+oldestLoadedSeq`, `+renderWindow`, `isLoadingOlder→loadingOlder` | n/a — not independently movable | No | Dictated by `storage.ts` (ACCEPT). Brainstorm correctly flags "follows fork storage." |
| `app.config.js` | MOVE-const (HA-46) | **ACCEPT** | +29/-91; structural config: `−`voice/audio/camera plugins, `−`ATS, `−`intentFilters, `−`expo updates, **−`buildCommitSha`**, +changelog-version reader, bundleId change | not seamable | No | Structural like `package.json` → manual 3-way. Brainstorm "adopt additive `buildCommitSha`/`NSAppTransportSecurity`" is **INVERTED** — fork REMOVED both. |
| `metro.config.js` | MOVE-const (HA-47) | **ACCEPT (low-leverage)** | +14/-29, 2 hunks; small structural resolver/config churn | not a clean overlay | Partial | Config file; adopt non-conflicting hunks manually. |

---

## 3. Honest summary counts

| Class | Count | Files |
|---|---:|---|
| **TRUE-MOVE-CLEAN** | **4** (+2 qualified) | Solid: `CodexPatchView` (HA-21), `_all.tsx` (HA-23), `autocomplete/suggestions.ts` (HA-37), `localSettings.ts` (HA-33). Qualified: `ChatList` (HA-5, DONE, render-seam + storage residual), `new/index.tsx` (HA-13, expensive whole-screen swap). |
| **ENTANGLED** (rewrite/removal, not a cheap relocation) | **19** | HA-4, HA-6, HA-8, HA-9, HA-14, HA-15, HA-16, HA-17, HA-18, HA-19, HA-20, HA-22, HA-24, HA-28, HA-30, HA-36, HA-38, HA-39, HA-40/41 |
| **ACCEPT / ACCEPT-coupled** (irreducible or storage/sync-plane coupled) | **7** | HA-26, HA-27, HA-31, HA-34, HA-42, HA-46, HA-47 |
| **ALIGN-ADDITIVE** (whole-file) | **0** | Matches the brainstorm's own §3.4 verdict (`∅`). Additive *sub-slices* exist inside entangled files (e.g. `+thinkingLevel`, `+source`, additive push hunks) but no whole file is a pure additive align. |

**Versus the brainstorm's claim of ~31 clean MOVE:** the reducible-by-cheap-relocation surface is **~4–6 files**,
not ~31. **~19** of the claimed MOVEs are ENTANGLED (require rewriting the canonical file with an override-seam
and re-validating consumers — not a relocation), and **~7** collapse to ACCEPT (structural configs or
storage/sync-plane-coupled files with no seam).

**Empirical calibration from the 5 R8-"DONE" MOVEs:** four of the five (AgentInput 26 hunks/+765-417,
MarkdownView ~17 hunks, MessageView 14 hunks, SessionView 13 hunks/−274) **still carry heavy interleaved
divergence in the canonical file after the overlay extraction**. Only ChatList reached a semi-thin render seam,
and even it keeps a ~25-line storage-plane-coupled tail. This is direct, in-tree proof that "MOVE → thin seam"
does not hold for complex interactive components; it holds only for whole-file fork-owned views (CodexPatch) and
list/const registries.

**Recurring inverted "inherit-for-free" claims found (the corrected premise in action):** the fork REMOVED the
very things the brainstorm says a MOVE would "inherit" — `xhigh` effort (HA-40/41), `expandUnchanged`
(HA-24), `effort` field (HA-30), `zenMode` (HA-33), `buildCommitSha`/`NSAppTransportSecurity` (HA-46), and much
of the all-files path (HA-39). Reverting toward upstream on these = **re-adding a plane the fork deliberately
dropped**, i.e. exactly the fork-behavior regression the operator forbade.

---

## 4. Recommendation (blunt)

**The remaining multi-wave MOVE effort is NOT worth it as scoped.** The brainstorm's "~31 clean MOVE" is
optimistic by roughly 5×: only **4–6 files** are genuinely cheap TRUE-MOVE-CLEAN relocations, and the 5 already-
"DONE" overlays demonstrate that finishing the interactive-component MOVEs buys a toggle-gated fork that *still*
diverges by hundreds of lines per file — the conflict COST barely drops for those.

**Do these (real reducible surface, low risk, hours not days):**
- **HA-21 `CodexPatchView.tsx`** — relocate the whole fork-owned codex renderer to `sources/fork/tools/`, register via a fork registry module. ~1-line seam. Clean.
- **HA-23 `_all.tsx`** + **HA-37 `autocomplete/suggestions.ts`** — genuine registry/const overlays; small, clean, `{...upstream, ...fork}` spread + imported caps.
- **HA-33 `localSettings.ts`** (+ **HA-30 `typesMessageMeta.ts`** if you accept a `.extend()` + guarded `.omit`) — declaration-merge the fork Zod fields; keep the E5 removals as guarded omits.

**Explicitly DON'T "MOVE" these — they are ENTANGLED rewrites, not relocations (treat as ACCEPT / manual
3-way, keep take-ours):** the sync-plane monoliths `ops.ts` (HA-26), `typesRaw.ts` (HA-27), `storageTypes.ts`
(HA-31), `persistence.ts` (HA-34), `useDemoMessages.ts` (HA-42), plus the structural configs `app.config.js`
(HA-46) and `metro.config.js` (HA-47). And the flagship MOVE-list claims `suggestionCommands.ts` (HA-36) and
`modelModeOptions.ts` (HA-40/41) are wholesale rewrites, not concat-lists — pursuing them as "cheap MOVE-list"
will burn a wave and deliver a full rewrite instead.

**Bottom line:** cli-1.1.10 is confirmed as the merge-base, so every one of these diffs is pure fork divergence
and reverting drops fork behavior. The honest reducible surface is ~4–6 clean relocations (CodexPatchView,
_all, suggestions, localSettings, ± typesMessageMeta, ± the ChatList-style render seam pattern) — worth a
single small wave. The other ~26 "MOVE" candidates are either interleaved rewrites that would cost a full
canonical-file re-derivation (no cheaper than the ACCEPT they're trying to escape) or structural/plane-coupled
files with no seam. Re-scope the workstream to the 4–6 genuine targets and re-label the rest ENTANGLED/ACCEPT;
do not sell a "~31-file conflict reduction."
