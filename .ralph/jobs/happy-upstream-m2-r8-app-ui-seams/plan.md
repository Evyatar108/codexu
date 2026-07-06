# R8 — happy-app UI conflict-surface reduction (KEEP/DISABLE triage + fork-overlay seams)

**Milestone:** M2 / R8 (happy-app UI plane)
**Job:** `happy-upstream-m2-r8-app-ui-seams`
**Worktree:** `D:/harness-efforts/codexu/.worktrees/plan-happy-r8` · branch `ralph/plan-happy-r8` (off `main` @ `0e859eae`)
**Upstream forward target:** `cli-1.1.10` @ `71c417e1092e73cf34eb24f9601d569394c1f359` (mirror at `D:/harness-efforts/happy`, remote `origin` = slopus/happy)
**Status:** PLAN — no source edits, no builds, no tests in this deliverable. Implementation is a separate `/implement-with-ralph` job.

---

## 1. Goal

happy-app is the single biggest lever on the fork's upstream-merge cost: **59 of 103 hard-conflict files (57%)** vs `cli-1.1.10`, and it was **untouched by the M1 seam refactors** (which only relocated happy-server/cli seams). This plan reduces that surface by applying, per fork divergence in the UI hotspots, an explicit **KEEP vs DISABLE-for-now** decision:

- **KEEP** — the divergence is e-ink-tablet-critical or high-value fork feature. Preserve it via a **fork-OWNED overlay module** (`sources/fork/…`, the happy analog of the CLI's `src/fork/` seams and codex's `codex-rs-overlay` crates) + a `// FORK PATCH:` marker + a **thin call-site seam** in the upstream-canonical component. The fork logic moves OUT of the canonical file into a zero-conflict module.
- **DISABLE-for-now** — the divergence is low-value (cosmetic, non-e-ink, stale, or trivially re-derivable). Revert that hunk to the upstream shape to ease the rebase; document what's lost + the re-apply recipe in the catalogue.

**The end state:** the upstream-canonical hotspot files (`SessionView.tsx`, `AgentInput.tsx`, `ChatList.tsx`, `MarkdownView.tsx`, `MessageView.tsx`, sidebar trio) return *toward* upstream shape — either full DISABLE reverts, thin re-export shims, or upstream-scaffold + thin seam calls — so they stop being large manual-three-way-merge cost centers. Fork behavior is preserved in `sources/fork/…` modules that upstream does not have and therefore **cannot conflict**.

## 2. HARD CONSTRAINT — behavior-preserving e-ink parity

Every **KEEP** seam extraction is a **pure relocation**: the e-ink tablet UI must render and behave **identically** before/after. This is not a redesign. Specifically (from `packages/happy-app/AGENTS.md`):

- **User-message styling (MessageView):** `userMessageBackground` = `#d4d4d4` (NOT `#f0f0f0`/`surfaceHigh`), left-aligned full-width grey band, **no `paddingVertical` on `userMessageBubble`**. Must survive byte-for-byte.
- **Tappable option cards (MarkdownView):** `userMessageBackground` fill + `textSecondary` 2px border + text `4px`-accent; the e-ink option-card branch (`MarkdownView.tsx:817-856`) is a **critical KEEP**.
- **Contrast-safe code-block / image styling (MarkdownView `:719-771`):** e-ink quantization requires the tuned contrast — must survive.
- **No smooth-scroll / continuous repaint (ChatList):** `windowSize=21`, `removeClippedSubviews=false`, `maxToRenderPerBatch=4`, `maintainVisibleContentPosition.minIndexForVisible=0` are **e-ink anchor-stability** settings (diagnosed 2026-04-29, `.ralph/brainstorms/streaming-pagination-scroll-jump/`). The `chatPaginatedScroll` tap-zone page-turn is an **e-ink-first** interaction (no fling/smooth-scroll). Must survive.
- **Static boundary UI (`BoundaryDivider`):** no animation on the e-ink target.

**Parity verification** (happy-app has few UI tests): each KEEP story defines an explicit visual/interaction parity checklist (§8) because `pnpm --filter happy-app typecheck` proves the seam compiles but NOT that pixels/interactions are unchanged. `adb screencap` shows the full-color framebuffer, NOT the e-ink-quantized panel output — visual parity is judged from the framebuffer + on-tablet spot-check, per AGENTS.md.

## 3. Verified research (file:line)

Method: `git -C D:/harness-efforts/happy show 71c417e1:packages/happy-app/sources/<path>` (upstream) vs the fork file in this worktree, `git diff --no-index --unified=2`. **Path mapping is DIRECT** — `packages/happy-app/sources/<path>` on BOTH sides (upstream is a monorepo, same layout; the task prompt's "sources/… at repo root" guess was wrong). Mirror was read-only (only `show`/`cat-file`); no mirror branches touched.

### 3.1 Hotspot diffstat (fork vs upstream `cli-1.1.10`)

| Hotspot (`sources/…`) | fork LOC | up LOC | hunks | +/− | dominant divergence |
|---|---:|---:|---:|---|---|
| `-session/SessionView.tsx` | 1039 | 913 | 23 | +574/−518 | sidebar-collapse, path-surface header, controlled composer + pre-send, attachments, context-drawer, boundary advisory, chat-width |
| `components/AgentInput.tsx` | 1944 | 1389 | 30 | +902/−426 | attachment rewrite, chat-width/text-size overlays, controlled mode + send-policy, keyboard state machine, mic/voice removal |
| `components/markdown/MarkdownView.tsx` | 913 | 627 | 25 | +321/−78 | e-ink option cards, contrast tuning, session-file autolink + nav, session-aware images, Claude meta-tag→task pills, font-scale |
| `components/MessageView.tsx` | 385 | 328 | 16 | +188/−151 | **e-ink user-message band**, skillBody suppression, chatBodyWidth, boundary divider, attachment chips, nested-depth cap; drops upstream goal/command parsing + fork-from-message long-press |
| `components/ChatList.tsx` | 486 | 365 | 7 | +355/−259 | pinch-zoom font scale, **paginated page-turn scroll (e-ink)**, render-window prefetch, typed boundary items, **e-ink FlatList tuning**; drops upstream tool-grouping/collapse + DuplicateSheet |
| `components/SidebarView.tsx` | 280 | 97 | 3 | +237/−61 | collapsible-sidebar feature (near-total rewrite) |
| `components/SidebarNavigator.tsx` | 125 | 175 | 4 | +75/−139 | collapsible-sidebar feature (fork simplified the navigator) |
| `-session/ChatHeaderView.tsx` | 324 | 176 | 3 | +250/−106 | sidebar-restore control + avatar-header redesign |
| **TOTAL (8 hotspots)** | — | — | **111** | — | — |

### 3.2 The fork ALREADY has a partial overlay — this is the key finding

The conflict surface is **not** caused by the fork-only feature modules — those already exist and are **zero-conflict** (upstream has no same-named file, so an import cannot three-way-conflict them). Verified present in fork / absent upstream:

| fork-only module (`sources/…`) | in fork | in upstream | consumed by |
|---|:---:|:---:|---|
| `components/SidebarContext.tsx` | ✅ | ❌ | SessionView, SidebarView |
| `components/CollapsedSidebarView.tsx` | ✅ | ❌ | SessionView, SidebarView |
| `components/CollapsibleSidebarEdge.tsx` | ✅ | ❌ | SessionView, SidebarView |
| `hooks/useChatWidth.ts` | ✅ | ❌ | SessionView, AgentInput, ChatList, MessageView |
| `hooks/useChatFontScale.ts` | ✅ | ❌ | ChatList, MarkdownView, MessageView |
| `components/ChatList.boundaryItems.ts` | ✅ | ❌ | ChatList |
| `components/BoundaryDivider.tsx` | ✅ | ❌ | ChatList, MessageView |
| `components/markdown/processClaudeMetaTags.ts` | ✅ | ❌ | MarkdownView |
| `components/SessionContextDrawer.tsx` | ✅ | ❌ | SessionView |
| `components/composer/AttachmentChip.tsx` | ✅ | ❌ | AgentInput, MessageView |
| `-session/composeBoundaryAdvisory.ts` | ✅ | ❌ | SessionView |
| `components/markdown/skillBody.ts` | ✅ | ❌ | MessageView, MarkdownView |

**Implication for the whole plan:** the conflict cost is the **inline fork body edits + fork imports** *inside the canonical files*, not the extracted modules. R8's job is therefore mostly (a) **convert those inline edits into thin call-site seams** that delegate to fork modules (existing or new), and (b) **DISABLE-revert** the low-value inline hunks. There is little net-new logic to write — this is relocation + reversion. `sources/fork/` (new dir, mirroring `packages/happy-cli/src/fork/`) is where net-new extractions land; existing fork-only modules stay put (re-homing them is optional churn, out of scope).

### 3.3 SYNC-PLANE residual (out of R8 scope — flag, do not extract)

Several hotspot divergences are **not UI** — they are the fork's single-user / embedded-server / typed-boundary **sync plane** (catalogued `HA-1`/`HA-2`/`HA-3`, replant note "~R5"). Overlay-into-`sources/fork/` **cannot** cleanly fix these because they interleave with upstream's reducer/socket wiring:

- ChatList render-window prefetch (`sync.reportRenderWindow`, `sync.loadOlder`, `storage.getState().sessionMessages`), typed boundary item build (`buildChatListBoundaryItems`, `useLatestBoundary`).
- SessionView permission/model/effort resolution + agent-config emit, session-visibility sync hook, local-Claude idle-send / pending-switch controls.
- AgentInput controlled-`mode`/`value` + send-policy API split, deferred-send/attachment-clearing.

R8 extracts the **UI** parts that ride alongside these (font-scale, chat-width, page-turn, attachment chrome, boundary *divider rendering*) and leaves the sync wiring as a labeled **R5 careful-seam** residual. Each such hunk is tagged in the triage as `SYNC-R5` and gets a `// FORK PATCH: [KEEP] … (invariant HA-1/2/3, R5 residual)` marker rather than an extraction.

### 3.4 Catalogue model + marker convention

R8 follows the exact discipline already proven for `HS-1..HS-8` / `HC-1..HC-7` in `docs/happy-patch-surface.md`:
- Marker form in canonical files: `// FORK PATCH: [RESTORE-R8<x>] <reason> (invariant HA-<n>)`; JSX variant `{/* FORK PATCH: … */}`.
- New "Zero-conflict overlay directories" context row for `sources/fork/` (no markers — import-safe by construction), mirroring the CLI's `codex/`+`daemon/`+`agentComms/` rows.
- Full-relocation shim files (sidebar trio) additionally get a `.gitattributes merge=ours` entry so a 3-way import auto-resolves them (take-ours) instead of surfacing a manual conflict — the mechanism that actually removes them from the manual-merge budget. `.gitattributes` already carries a `merge=ours` driver block (`pnpm-lock.yaml`, `packages/happy-wire/dist/**`).

## 4. Invariant-ID assignment

Existing rows `HA-1`(sync.ts)/`HA-2`(storage.ts)/`HA-3`(reducer.ts) stay as SYNC-R5. `HA-4`/`HA-5`/`HA-6` are re-scoped from "doc-only" to "RESTORE-R8". New rows `HA-8..HA-12` are added for the hotspots not yet catalogued.

| invariant | file | R8 disposition |
|---|---|---|
| HA-4 | `-session/SessionView.tsx` | RESTORE-R8 (selective seam extraction + DISABLE reverts) |
| HA-5 | `components/ChatList.tsx` | RESTORE-R8 (selective extraction; SYNC-R5 residual) |
| HA-6 | `components/AgentInput.tsx` | RESTORE-R8 (selective extraction + DISABLE reverts) |
| HA-8 | `components/markdown/MarkdownView.tsx` | RESTORE-R8 (selective extraction + DISABLE reverts) |
| HA-9 | `components/MessageView.tsx` | RESTORE-R8 (selective extraction; e-ink KEEP) |
| HA-10 | `components/SidebarView.tsx` | RESTORE-R8 (full-relocation shim OR DISABLE — operator-decision) |
| HA-11 | `components/SidebarNavigator.tsx` | RESTORE-R8 (full-relocation shim OR DISABLE — operator-decision) |
| HA-12 | `-session/ChatHeaderView.tsx` | RESTORE-R8 (full-relocation shim OR DISABLE — operator-decision) |

## 5. KEEP / DISABLE triage tables (per hotspot)

Legend: **K** = KEEP (fork overlay seam) · **D** = DISABLE-for-now (revert to upstream) · **KD** = KEEP-DELETED (fork removed an upstream construct; keep it removed) · **SYNC-R5** = sync-plane residual, out of R8. **⚑ = operator-decision** (UX-affecting call the operator should approve before impl). "Δhunks" = estimated hunks removed from the manual-merge budget for that file (either eliminated by DISABLE, or collapsed from a multi-line body edit to a ≤1-line seam call).

### 5.1 HA-4 `-session/SessionView.tsx` (23 hunks)

| # | divergence | file:symbol | K/D | rationale | seam design (KEEP) / re-apply note (DISABLE) | Δhunks |
|---|---|---|---|---|---|---|
| 4a | sidebar-collapse + collapsed-rail wiring | `SessionView` body ↔ `SidebarContext`/`CollapsedSidebarView`/`CollapsibleSidebarEdge` | **K ⚑** | e-ink two-pane toggle; fork-only modules already exist | New `sources/fork/session/useSessionSidebar.ts` owns the collapse state + rail render; canonical file calls `const sidebar = useSessionSidebar(...)` + renders `{sidebar.rail}`. Marker `RESTORE-R8a`. | 3→1 |
| 4b | web avatar-actions / pinned-avatar header entrypoint | `SessionView` header JSX | **K ⚑** | fork header affordance | Fold into `sources/fork/session/SessionHeaderSurfaces.tsx` (with 4c). | 2→1 |
| 4c | header metadata / path-surface refactor | `SessionView` ↔ `-session/SessionViewPathSurfaces` | **K** | fork path/metadata surface | Extract header composition to `sources/fork/session/SessionHeaderSurfaces.tsx`; canonical renders `<SessionHeaderSurfaces .../>`. Marker `RESTORE-R8a`. | 2→1 |
| 4d | controlled-draft composer + pre-send intercept | `SessionView` ↔ `@/hooks/usePreSendCommand` | **K ⚑** | fork slash/goal pre-send intercept + controlled draft | `sources/fork/session/useForkComposer.ts` owns draft state + pre-send hook; canonical passes `{...composer}` to `<AgentInput>`. Marker `RESTORE-R8a`. | 3→1 |
| 4e | attachment upload/send pipeline | `SessionView` ↔ attachment hook | **K** | fork attachments feature | Share `sources/fork/composer/useFileAttachment.ts` (see 6b); canonical seam only. Marker `RESTORE-R8a`. | 2→1 |
| 4f | session context drawer + archived-resume | `SessionView` ↔ `components/SessionContextDrawer` (fork-only) | **K ⚑** | fork context drawer + archived resume | `sources/fork/session/useSessionContextDrawer.ts` owns wiring; canonical renders `{drawer.node}`. Marker `RESTORE-R8a`. | 2→1 |
| 4g | boundary advisory + compose-start tracking | `SessionView` ↔ `-session/composeBoundaryAdvisory` (fork-only) | **K** | typed-boundary advisory UI | Wrap in `sources/fork/session/useBoundaryAdvisory.ts`; thin seam. Marker `RESTORE-R8a`. | 1→1 |
| 4h | chat-width helper | `SessionView` ↔ `@/hooks/useChatWidth` (fork-only) | **K** | e-ink chat width | Already a hook; canonical keeps the 1-line `useChatWidth()` call as the seam. Marker `RESTORE-R8a`. | 1→1 |
| 4i | diff/file overlay routing cleanup | `SessionView` overlay routing | **D ⚑** | feature-drift vs upstream file viewer; low e-ink value | Revert routing block to upstream. **Lost:** fork's overlay routing tweak. **Re-apply:** re-add the routing branch (catalogue re-apply recipe). | 3→0 |
| 4j | local-Claude idle-send / pending-switch controls | `SessionView` send controls | **SYNC-R5 ⚑** | sync-plane (send policy) | Leave; mark `RESTORE-R8a (HA-1, R5 residual)`. Pending-switch banner/abort UX is R5. | 0 |
| 4k | permission / model / effort resolution + agent-config emit | `SessionView` | **SYNC-R5** | sync-plane | Leave; mark R5 residual. | 0 |
| 4l | session-visibility sync hook | `SessionView` | **SYNC-R5** | sync-plane | Leave; mark R5 residual. | 0 |

SessionView net: ~7 KEEP extractions (collapse to thin seams), 1 DISABLE (−3 hunks), 3 SYNC-R5 left. Est. manual-merge hunks 23 → ~9.

### 5.2 HA-6 `components/AgentInput.tsx` (30 hunks)

| # | divergence | file:symbol | K/D | rationale | seam / re-apply | Δhunks |
|---|---|---|---|---|---|---|
| 6a | controlled `mode`/`value` + send-policy API split | `AgentInput` props/handlers | **SYNC-R5 ⚑** | send-policy is sync-plane | Leave; mark R5 residual. Deferred "when idle" send is R5. | 0 |
| 6b | attachment system rewrite | `AgentInput` ↔ `useFileAttachment`/`AttachmentChip` (fork-only) | **K** | fork attachments | New `sources/fork/composer/useFileAttachment.ts` (+ existing `AttachmentChip`); canonical renders `<AttachmentRow {...attach}/>`. Marker `RESTORE-R8c`. | 4→1 |
| 6c | new-session slot panel | `AgentInput` new-session JSX | **K ⚑** | fork new-session affordance | `sources/fork/composer/NewSessionSlotPanel.tsx`; thin seam. Marker `RESTORE-R8c`. | 2→1 |
| 6d | chat-width + text-size overlays | `AgentInput` ↔ `useChatWidth`/`useIsTablet` | **K ⚑** | e-ink width + text-size chooser | `sources/fork/composer/useComposerLayout.ts`; thin seam. Marker `RESTORE-R8c`. | 3→1 |
| 6e | active toolbar controls fork-gated | `AgentInput` toolbar JSX | **K** | e-ink toolbar gating | Fold into `useComposerLayout`/toolbar fork component. Marker `RESTORE-R8c`. | 2→1 |
| 6f | layout width chat-body constrained | `AgentInput` layout | **K** | e-ink layout | Part of `useComposerLayout`. Marker `RESTORE-R8c`. | 1→1 |
| 6g | send-button — mic/voice removed | `AgentInput` send button | **KD ⚑** | fork removed voice/mic for e-ink | Keep removed. Guard: negative test "no mic button". Re-apply recipe if upstream voice wanted. | 1→0 |
| 6h | active-context row reshaped | `AgentInput` context row | **D ⚑** | feature-drift, low value | Revert to upstream context row. **Lost:** reshaped row. **Re-apply:** catalogue recipe. | 2→0 |
| 6i | status row inline + mode gating | `AgentInput` status row | **D ⚑** | feature-drift | Revert to upstream status row. **Lost:** inline status. **Re-apply:** recipe. | 2→0 |
| 6j | keyboard/focus state machine | `AgentInput` keyboard effects | **D ⚑** | feature-drift, high-risk to KEEP inline | Revert to upstream keyboard handling **only if** on-tablet parity holds; else KEEP as `RESTORE-R8c`. **Operator-decision.** | 3→0 |
| 6k | autocomplete/settings overlay mode-aware | `AgentInput` overlay | **D** | feature-drift | Revert to upstream overlay. **Re-apply:** recipe. | 2→0 |
| 6l | import churn / reordering | `AgentInput` imports | **D** | cosmetic | Restore upstream import block. | 1→0 |

AgentInput net: ~4 KEEP extractions, ~5 DISABLE (−10 hunks), 1 KEEP-DELETED, 1 SYNC-R5. Est. 30 → ~8.

### 5.3 HA-5 `components/ChatList.tsx` (7 hunks)

| # | divergence | file:symbol | K/D | rationale | seam / re-apply | Δhunks |
|---|---|---|---|---|---|---|
| 5a | e-ink FlatList tuning (`windowSize=21`, `removeClippedSubviews=false`, `maxToRenderPerBatch=4`, MVCP `minIndexForVisible=0`) | `ChatListInternal` `<FlatList>` props | **K** | **e-ink anchor stability (critical)** | Move the prop object to `sources/fork/chat/chatListEinkProps.ts` (a const); canonical spreads `{...chatListEinkProps}`. Marker `RESTORE-R8b`. | 1→1 |
| 5b | paginated page-turn scroll (`chatPaginatedScroll`, tap-zones, `scrollEnabled` gate) | `ChatListInternal` gesture + page zones | **K ⚑** | **e-ink no-smooth-scroll interaction** | `sources/fork/chat/usePageTurnScroll.ts` owns page logic + zone views; canonical renders `{pageTurn.zones}`. Marker `RESTORE-R8b`. | 1→1 |
| 5c | pinch-to-zoom font scale (`pinchToZoomEnabled`, `ChatScaleLiveContext`, `useChatFontScale`) | `ChatListInternal` pinch gesture | **K ⚑** | fork font-scale feature | `sources/fork/chat/usePinchFontScale.ts`; canonical wraps list in `{pinch.wrap(list)}`. Marker `RESTORE-R8b`. | 1→1 |
| 5d | typed-boundary items + BoundaryDivider render | `ChatListInternal` ↔ `ChatList.boundaryItems`/`BoundaryDivider` (fork-only) | **K (partly SYNC-R5)** | typed-boundary UI; item-build touches sync store | Divider render stays via fork modules; the `buildChatListBoundaryItems`+`useLatestBoundary`+prefetch wiring is `HA-3` R5 residual. Marker split `RESTORE-R8b` (render) / R5 (data). | 1→1 |
| 5e | render-window prefetch (`reportRenderWindow`, `loadOlder`, `sessionMessages` store reads) | `ChatListInternal` viewability + endReached | **SYNC-R5** | sync-plane pagination | Leave; mark `RESTORE-R8b (HA-1/HA-2, R5 residual)`. | 0 |
| 5f | dropped upstream tool-grouping/collapse (`useGroupedMessages`, `ToolGroupView`, `AgentWorkGroupView`, collapse-state) | removed | **KD ⚑** | fork flattened rendering for e-ink | Keep removed. **Operator-decision:** does the fork want flat rendering permanently, or restore upstream grouping? Guard: negative test. | 1→0 |
| 5g | dropped fork-from-message via `DuplicateSheet` / `useSessionQuickActions` | removed | **KD** | fork uses a different fork flow | Keep removed (paired with MessageView 9f). Guard: negative test. | included above |

ChatList net: ~4 KEEP (thin seams), 2 KEEP-DELETED, 1 SYNC-R5. Est. 7 → ~5 (this file stays a conflict file due to SYNC-R5; merge effort drops as bodies move to `sources/fork/chat/`).

### 5.4 HA-8 `components/markdown/MarkdownView.tsx` (25 hunks)

| # | divergence | file:symbol | K/D | rationale | seam / re-apply | Δhunks |
|---|---|---|---|---|---|---|
| 8a | e-ink option cards | `MarkdownView.tsx:817-856` | **K** | **critical e-ink KEEP** | `sources/fork/markdown/optionCardStyles.ts` + a fork option-card renderer; canonical branch calls it. Marker `RESTORE-R8d`. | 3→1 |
| 8b | contrast-safe code-block / image styling | `MarkdownView.tsx:719-771` | **K** | e-ink quantization contrast | `sources/fork/markdown/einkMarkdownStyles.ts` (style overrides merged into the rules object). Marker `RESTORE-R8d`. | 3→1 |
| 8c | Claude meta-tags → task notifications | `MarkdownView` ↔ `processClaudeMetaTags`/`TaskNotificationPill` (fork-only) | **K** | fork metadata-tag rendering | Already fork-only helpers; canonical keeps the thin pre-process seam call. Marker `RESTORE-R8d`. | 3→1 |
| 8d | session-file autolinking | `MarkdownView` ↔ `@/utils/sessionFileLinks`/`./linkUtils` | **K ⚑** | fork file autolink | `sessionFileLinks` exists in BOTH (conflicts) — pull the fork autolink transform into `sources/fork/markdown/sessionFileAutolink.ts`, canonical seam call. Marker `RESTORE-R8d`. | 3→1 |
| 8e | internal file-link navigation | `MarkdownView` link handler | **K** | fork nav | Fold into `sources/fork/markdown/useMarkdownLinkNav.ts`. Marker `RESTORE-R8d`. | 2→1 |
| 8f | session-aware image loading (`sessionReadFile`) | `MarkdownView` image render | **K** | fork image fallback | `sources/fork/markdown/SessionAwareImage.tsx`; canonical image branch delegates. Marker `RESTORE-R8d`. | 2→1 |
| 8g | animated font-scale wrapper (`useChatFontScale`) | `MarkdownView` text render | **K** | consistent with ChatList font-scale KEEP | Keep via fork hook seam. Marker `RESTORE-R8d`. | 2→1 |
| 8h | code-block text scaling | `MarkdownView` code render | **K** | e-ink readability | Part of `einkMarkdownStyles`. | 2→1 |
| 8i | list rendering simplified to inline bullets | `MarkdownView` list render | **D ⚑** | feature-drift; upstream list render is fine | Revert to upstream list rendering. **Lost:** inline-bullet simplification. **Re-apply:** recipe. | 3→0 |
| 8j | table link-trust propagation | `MarkdownView` table render | **D** | only needed if autolink deferred | Revert if 8d/8e deferred; else KEEP. Conditional. | 2→0 |

MarkdownView net: ~7 KEEP extractions, 2 DISABLE (−5 hunks). Est. 25 → ~9.

### 5.5 HA-9 `components/MessageView.tsx` (16 hunks)

| # | divergence | file:symbol | K/D | rationale | seam / re-apply | Δhunks |
|---|---|---|---|---|---|---|
| 9a | **e-ink user-message band** (`userMessageContainer` grey fill, no bubble `paddingVertical`) | `MessageView` styles + `UserTextBlock` | **K** | **critical e-ink KEEP (documented)** | `sources/fork/message/einkMessageStyles.ts` holds the user-message style block; canonical `UserTextBlock` uses it. Marker `RESTORE-R8e`. | 3→1 |
| 9b | skillBody suppression (`isSkillBodyMessage`) in user + agent blocks | `MessageView` ↔ `markdown/skillBody` (fork-only) | **K** | fork Claude-skill-body hiding | Keep the two thin `if (isSkillBodyMessage(...)) return null;` guards as seams (they ARE thin already). Marker `RESTORE-R8e`. | 2→1 |
| 9c | `chatBodyWidth` prop + width style | `MessageView` props | **K** | e-ink chat width (paired ChatList 5a/AgentInput 6d) | Keep the prop; sourced from `useChatWidth`. Thin. Marker `RESTORE-R8e`. | 2→1 |
| 9d | context-boundary → `BoundaryDivider` | `AgentEventBlock` | **K** | typed-boundary render (paired ChatList 5d) | Thin `return <BoundaryDivider .../>` seam. Marker `RESTORE-R8e`. | 1→1 |
| 9e | attachment chips (`MessageAttachmentChips`) | `MessageView` ↔ `formatAttachmentSize` (AttachmentChip) | **K** | fork attachment display | `sources/fork/message/MessageAttachmentChips.tsx`; canonical renders `<MessageAttachmentChips .../>`. Marker `RESTORE-R8e`. | 2→1 |
| 9f | dropped upstream goal/command parsing + fork-from-message long-press (`parseLocalCommandMessage`, `isUserSlashCommandEcho`, `onForkFromUserMessage`) | removed vs upstream | **KD ⚑** | fork replaced with pre-send intercept (4d) + flat rendering | Keep removed. **Operator-decision:** upstream added goal-confirmation/command chips + fork-from-message; fork dropped them here. Confirm fork does NOT want upstream's version. Guard: negative test. | 3→0 |
| 9g | font-scale animated text (`useChatScaleAnimatedTextStyle`, `AnimatedText`, `AgentEventText`) | `MessageView` text | **K** | fork font-scale (consistent) | Keep via fork hook seam. Marker `RESTORE-R8e`. | 2→1 |
| 9h | nested-child depth cap (`MAX_NESTED_CHILD_DEPTH`, `NestedStepsSummary`, `countNestedSteps`) | `RenderBlock`/`ToolCallBlock` | **K ⚑** | e-ink render-cost cap (avoid deep nesting repaint) | `sources/fork/message/nestedStepsCap.ts`; canonical delegates count + summary. Marker `RESTORE-R8e`. Could DISABLE if perf non-critical. | 1→1 |

MessageView net: ~7 KEEP extractions, 1 KEEP-DELETED. Est. 16 → ~7 (this file is a strong KEEP — mostly e-ink-critical; extraction shrinks the bodies but the file stays fork-diverged).

### 5.6 HA-10/HA-11/HA-12 — sidebar trio (near-total rewrites)

| # | file | K/D | rationale | strategy | Δhunks |
|---|---|---|---|---|---|
| 10 | `components/SidebarView.tsx` (3 hunks, 280 vs 97) | **K ⚑ or D ⚑** | collapsible-sidebar feature | **Full-relocation shim:** move body to `sources/fork/sidebar/ForkSidebarView.tsx`; canonical `SidebarView.tsx` = `export { SidebarView } from '@/fork/sidebar/ForkSidebarView'` + `.gitattributes merge=ours`. OR **DISABLE** → revert to upstream 97-line sidebar (lose collapse). | 3→~0 (shim) or 3→0 (disable) |
| 11 | `components/SidebarNavigator.tsx` (4 hunks, 125 vs 175) | **K ⚑ or D ⚑** | collapsible-sidebar feature (fork simplified) | Same as HA-10; paired decision. | 4→~0 or 4→0 |
| 12 | `-session/ChatHeaderView.tsx` (3 hunks, 324 vs 176) | **K ⚑ or D ⚑** | sidebar-restore control + avatar-header redesign | Full-relocation shim to `sources/fork/session/ForkChatHeaderView.tsx` + merge=ours; OR selective (restore control seam only, DISABLE avatar redesign). | 3→~0 or 3→0 |

**The sidebar trio is the single biggest operator-decision** (see §7). AGENTS.md records `feature/tablet-sidebar-toggle` as "fork-only UX conveniences, NOT for upstream" — but it is on `main` now. Either way it should NOT go upstream, so full-relocation-shim (fork owns it, `merge=ours` auto-resolves) is the recommended KEEP path; DISABLE is only if the operator wants to drop the collapse feature entirely.

## 6. Overlay layout convention (`sources/fork/`)

New dir `packages/happy-app/sources/fork/` (mirrors `packages/happy-cli/src/fork/`), zero-conflict by construction, catalogued as a "Zero-conflict overlay directory" context row (no markers). Proposed structure:

```
sources/fork/
  session/      useSessionSidebar.ts, SessionHeaderSurfaces.tsx, useForkComposer.ts,
                useSessionContextDrawer.ts, useBoundaryAdvisory.ts, ForkChatHeaderView.tsx
  composer/     useFileAttachment.ts, NewSessionSlotPanel.tsx, useComposerLayout.ts
  chat/         chatListEinkProps.ts, usePageTurnScroll.ts, usePinchFontScale.ts
  markdown/     optionCardStyles.ts, einkMarkdownStyles.ts, sessionFileAutolink.ts,
                useMarkdownLinkNav.ts, SessionAwareImage.tsx
  message/      einkMessageStyles.ts, MessageAttachmentChips.tsx, nestedStepsCap.ts
  sidebar/      ForkSidebarView.tsx, ForkSidebarNavigator.tsx
```

Existing fork-only modules (§3.2) stay in place — re-homing them is optional churn, out of R8 scope. Each canonical hotspot retains ONE representative `// FORK PATCH: [RESTORE-R8<x>] … (invariant HA-<n>)` marker at its seam entry point (per the catalogue "one representative marker" rule for largely-rewritten files); the catalogue carries the per-hunk detail.

## 7. Operator-decision calls (approve before impl)

Ordered by impact:

1. **Sidebar trio (HA-10/11/12) — KEEP-as-shim vs DISABLE.** Biggest surface (10 hunks + the largest LOC deltas). Recommend KEEP-as-full-relocation-shim + `merge=ours` (fork owns it; never upstream). DISABLE only if dropping the collapse UX.
2. **ChatList tool-grouping removal (5f) — permanent flat rendering vs restore upstream grouping.** The fork deleted upstream's `useGroupedMessages`/`ToolGroupView` collapse system. Confirm flat rendering is the intended e-ink design (KEEP-DELETED) vs re-adopting upstream grouping.
3. **MessageView goal/command parsing + fork-from-message removal (9f).** Upstream `cli-1.1.10` added goal-confirmation/command chips + fork-from-message long-press; the fork dropped them here. Confirm the fork's pre-send intercept (4d) is the intended replacement (KEEP-DELETED) rather than a regression.
4. **AgentInput mic/voice removal (6g).** Confirm voice input stays removed for the e-ink target (KEEP-DELETED).
5. **AgentInput text-size + chat-width choosers (6d), ChatList pinch-zoom (5c) & page-turn (5b).** e-ink interaction KEEPs — confirm they stay (recommended KEEP).
6. **AgentInput keyboard state machine (6j) — DISABLE vs KEEP.** Reverting to upstream keyboard handling is the riskiest DISABLE (focus/keyboard parity on-tablet). Recommend KEEP unless on-tablet parity is verified after revert.
7. **SessionView diff/file overlay routing (4i), AgentInput context/status rows (6h/6i), MarkdownView list simplification (8i).** Low-value DISABLE reverts — confirm the fork tweaks are expendable.

## 8. Stories (summary — full AC/deps/ship-order in `stories-outline.md`)

Phased so the cheapest, highest-reduction, lowest-risk work ships first and each phase is independently mergeable.

- **US-000 — Scaffolding + catalogue (no behavior change).** Create `sources/fork/` dir + README; add the R8 rows/markers plan to `docs/happy-patch-surface.md` (re-scope HA-4/5/6, add HA-8..12, add the `sources/fork/` zero-conflict context row); add sidebar-trio shim files to `.gitattributes merge=ours`. Gate: `pnpm --filter happy-app typecheck`. **Ship first.**
- **US-001 — DISABLE reverts, grouped.** Revert 4i, 6h, 6i, 6k, 6l, 8i (and 8j/6j if operator approves) to upstream shape; record each re-apply recipe in the catalogue. Biggest raw hunk-count drop; lowest risk. Gate: typecheck + visual parity checklist (reverted regions match upstream).
- **US-002 — KEEP-DELETED guards.** Add negative "must-not-exist" tests for 5f/5g, 6g, 9f; catalogue rows. No source change beyond tests + docs.
- **US-003 — MarkdownView KEEP extraction (HA-8).** Extract 8a–8h into `sources/fork/markdown/*`; thin seams in `MarkdownView.tsx`. **Critical e-ink parity** (option cards :817-856, contrast :719-771).
- **US-004 — MessageView KEEP extraction (HA-9).** Extract 9a/9c/9e/9g/9h into `sources/fork/message/*`; keep 9b/9d thin seams. **Critical e-ink parity** (user-message band).
- **US-005 — ChatList KEEP extraction (HA-5).** Extract 5a/5b/5c into `sources/fork/chat/*`; leave 5d(data)/5e as R5 residual with markers. **Critical e-ink parity** (FlatList tuning, page-turn).
- **US-006 — AgentInput KEEP extraction (HA-6).** Extract 6b/6c/6d/6e/6f into `sources/fork/composer/*`; thin seams. Largest file; ship after US-001 reverts land to reduce interweave.
- **US-007 — SessionView KEEP extraction (HA-4).** Extract 4a–4h into `sources/fork/session/*`; thin seams; leave 4j/4k/4l as R5 residual with markers.
- **US-008 — Sidebar trio (HA-10/11/12), operator-gated.** Full-relocation shims to `sources/fork/sidebar/*` + `sources/fork/session/ForkChatHeaderView.tsx`; canonical files become re-export shims + `merge=ours`. OR DISABLE per operator call.

**Ship order:** US-000 → US-001 → US-002 → (US-003 ∥ US-004 ∥ US-005 are disjoint files, parallel-safe) → US-006 → US-007 → US-008. US-006/US-007 touch the two largest files and are serialized after the reverts. Each story is independently typecheck-green and mergeable.

## 9. i18n

Most extractions **move existing JSX** whose strings already resolve via `t('…')` keys that exist in all locales — **no new i18n**. Two watch-outs (per `packages/happy-app/AGENTS.md` i18n rules — every key in all 10 locales + `_default.ts` + `text/translations.test.ts` structural parity):

1. **DISABLE reverts that re-introduce an upstream string** (e.g. 8i list rendering, 6h/6i rows) — if upstream references a `t(...)` key the fork's locales lack, add it to all locales + `_default.ts`, or the reverted code fails `translations.test.ts`. Enumerate upstream `t(...)` keys in each reverted region during impl.
2. **KEEP-DELETED removals** (5f/6g/9f) may orphan fork-only keys (e.g. `message.sentAsGoal`). Orphaned keys are harmless to parity but should be noted in the catalogue re-apply recipe so a future re-apply restores them.

No user-visible string is newly authored by R8; all seam extractions preserve existing keys verbatim.

## 10. Estimated conflict-surface reduction (honest framing)

Mirroring M1's honesty (M1 removed **zero** hard-conflict *files* but cut merge *effort* via localization), R8 distinguishes two metrics:

**(a) Hard-conflict FILE count** — drops only where a file returns fully to upstream (full DISABLE) or becomes a `merge=ours` shim:
- Sidebar trio (HA-10/11/12) as `merge=ours` shims → **−3 files** from the manual budget.
- No other hotspot fully returns to upstream (all retain KEEP seams and/or SYNC-R5 residual), so they remain "modified" files but with trivial-to-merge seams.
- **happy-app hard-conflict files: 59 → ~56** (manual-merge budget; ~53 if the operator also DISABLEs a few borderline files entirely).

**(b) Manual three-way-merge HUNK budget on the 8 hotspots** — the real win:
- Current: **111 hunks**.
- After R8: DISABLE eliminates ~20 hunks; KEEP extractions collapse large multi-line body edits into ≤1-line seam calls; the bulk of fork logic moves to zero-conflict `sources/fork/` modules.
- **Estimated post-R8 hotspot hunks: ~45–50** (a **~55–60% reduction in merge effort**), with the majority of remaining "hunks" being single-line `{...forkProps}` / `<ForkX/>` seam calls that auto-resolve or resolve in seconds.
- SYNC-R5 residual (~6–8 hunks across ChatList/SessionView/AgentInput) is explicitly deferred to R5 and is the main reason those three files stay conflict files.

**Bottom line:** R8 barely moves the *file count* (only the sidebar trio drops out) but roughly **halves the manual-merge effort** for the happy-app UI plane and **relocates the fork's e-ink UI logic into ~25 zero-conflict `sources/fork/` modules** that all future imports are immune to. The file-count lever for the remaining ~56 files is R5 (sync plane) + R6 (i18n), not R8.

## 11. Risks & open questions

1. **e-ink parity is not typecheck-verifiable.** happy-app has few UI tests; KEEP extractions are behavior-preserving by inspection + on-tablet spot-check. Mitigation: per-story visual/interaction parity checklists (§8, `stories-outline.md`); `adb screencap` shows framebuffer not panel output (AGENTS.md). **Highest risk.**
2. **SessionView/AgentInput interweave.** SYNC-R5 wiring is threaded through the same functions as the UI KEEPs; extracting UI without disturbing send-policy/reducer wiring needs care. Mitigation: mark SYNC-R5 hunks explicitly; do not touch them in R8; serialize US-006/US-007 after reverts.
3. **`sessionFileLinks.ts` / `FABWide.tsx` exist in BOTH fork and upstream** — they genuinely conflict. 8d handles `sessionFileLinks` by pulling the fork transform into `sources/fork/markdown/`; `FABWide` is out of the 8 hotspots (flag for a follow-up row).
4. **Full-relocation shims still "differ" from upstream** — only `merge=ours` removes them from the manual budget. If the operator rejects `merge=ours` on UI files, the sidebar trio stays a (trivial) conflict.
5. **Operator has not yet ruled on §7 calls.** US-001/US-008 cannot finalize scope until the KEEP/DISABLE calls (esp. sidebar trio, tool-grouping, goal/command parsing) are approved. Mitigation: US-000/US-002/US-003/US-004/US-005 are operator-decision-independent and can ship first.
6. **Upstream may have moved/renamed a hotspot** between `cli-1.1.10` and the next import — a re-export shim then becomes a delete/modify conflict. Mitigation: markers + catalogue anchors are the durable locators (re-grep after each import).

## 12. Acceptance criteria & gates

Per story (details in `stories-outline.md`):
- **Compile gate:** `pnpm --filter happy-app typecheck` green.
- **Test gate:** `pnpm --filter happy-app test` (Vitest, config `vitest.config.mts`) — happy-app has few UI tests; where a hotspot has one (`ChatList.preBoundaryHistory.test.tsx`, `AgentInput.{mode,attachments,keyboard,activeRegression}.test.tsx`), it must stay green; KEEP-DELETED stories ADD negative guards.
- **i18n gate (only if strings touched):** `pnpm --filter happy-app test text/translations.test.ts` (structural parity across all 10 locales + `_default.ts`).
- **Parity gate (KEEP stories):** visual/interaction checklist met — user-message band, option cards, contrast, page-turn, boundary divider render identically (framebuffer + on-tablet spot-check).
- **Marker/catalogue gate:** every touched canonical file carries its `RESTORE-R8<x>` marker; `docs/happy-patch-surface.md` HA rows reflect the final KEEP/DISABLE disposition.
- **No `git add -A`, no `git add CLAUDE.md`** — stage explicitly.

---

*This is a planning artifact. Implementation is a separate `/implement-with-ralph --from-plan` job. The lead FF-merges this plan; §7 operator-decision calls should be resolved before US-001/US-008 impl.*
