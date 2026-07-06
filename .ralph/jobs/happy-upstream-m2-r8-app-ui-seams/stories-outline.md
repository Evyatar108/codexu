# R8 happy-app UI conflict-surface reduction — stories outline

Companion to `plan.md`. Each story is independently typecheck-green and mergeable. **No source edits in this artifact** — this is the story decomposition for a later `/implement-with-ralph --from-plan` job.

**Repo/worktree for impl:** `packages/happy-app/` in the codexu monorepo. Impl runs in a ralph-managed worktree off `main`.
**Primary gate (all stories):** `pnpm --filter happy-app typecheck`.
**Test runner:** Vitest, config `packages/happy-app/vitest.config.mts` (NOT `.ts`). `pnpm --filter happy-app test`.
**Marker convention:** `// FORK PATCH: [RESTORE-R8<x>] <reason> (invariant HA-<n>)` (JSX: `{/* … */}`).
**Discipline:** no `git add -A`; no `git add CLAUDE.md`; e-ink KEEPs are pure relocations (behavior-preserving).

---

## Ship order (DAG)

```
US-000 (scaffold + catalogue)
   │
US-001 (DISABLE reverts) ──┐
US-002 (KEEP-DELETED guards)│  (US-001, US-002 depend only on US-000)
   │                        │
   ├── US-003 (MarkdownView) ┐
   ├── US-004 (MessageView)  │  parallel-safe: disjoint files
   └── US-005 (ChatList)     ┘
                 │
              US-006 (AgentInput)   (after US-001 reverts land in AgentInput)
                 │
              US-007 (SessionView)  (after US-001 reverts land in SessionView)
                 │
              US-008 (Sidebar trio, operator-gated)
```

US-003 / US-004 / US-005 touch three disjoint files (`MarkdownView.tsx`, `MessageView.tsx`, `ChatList.tsx`) and are parallel-safe. US-006 and US-007 touch the two largest files and are serialized after US-001 so they extract against already-reverted (smaller) files. US-008 is last and gated on the §7 operator decision.

**Operator-decision independence:** US-000, US-002, US-003, US-004, US-005 do NOT need any §7 call resolved and can ship immediately. US-001 needs calls #6/#7 (which reverts). US-008 needs call #1 (sidebar). US-006 needs call #4 (mic/voice) + #5 (choosers). US-004/US-005 KEEP-DELETED guards (US-002) need calls #2/#3.

---

## US-000 — Scaffolding + catalogue (zero behavior change)

**Goal:** establish the `sources/fork/` overlay dir and record the R8 plan in the catalogue before any hotspot is touched.

**Tasks:**
- Create `packages/happy-app/sources/fork/` with subdirs `session/ composer/ chat/ markdown/ message/ sidebar/` (a `README.md` explaining the zero-conflict overlay convention, mirroring `packages/happy-cli/src/fork/`).
- `docs/happy-patch-surface.md`: re-scope `HA-4`/`HA-5`/`HA-6` from "doc-only in M0" to "RESTORE-R8"; add rows `HA-8` (MarkdownView), `HA-9` (MessageView), `HA-10` (SidebarView), `HA-11` (SidebarNavigator), `HA-12` (ChatHeaderView); add a "Zero-conflict overlay directories" context row for `sources/fork/` under §5 (mirroring the CLI's §4 context table).
- `packages/happy-app/.gitattributes` (or root `.gitattributes` app section): add sidebar-trio shim files to `merge=ours` **conditioned on US-008 choosing the shim path** (leave a documented placeholder if US-008 is DISABLE).

**Acceptance criteria:**
- `sources/fork/` exists with the 6 subdirs + README; no `.tsx` logic yet.
- Catalogue HA-4..HA-12 rows present with correct bucket + test/guard + replant note columns.
- `pnpm --filter happy-app typecheck` green (no code change).
- No `CLAUDE.md` staged.

**Deps:** none. **Ships first.**

---

## US-001 — DISABLE reverts (grouped)

**Goal:** revert the low-value fork hunks to upstream shape; the biggest raw hunk-count drop, lowest risk.

**Scope (revert to `cli-1.1.10` shape, record re-apply recipe in catalogue for each):**
- `SessionView.tsx` 4i — diff/file overlay routing cleanup.
- `AgentInput.tsx` 6h (active-context row), 6i (status row inline), 6k (autocomplete/settings overlay), 6l (import churn).
- `MarkdownView.tsx` 8i (list rendering simplification); 8j (table trust) **only if** 8d/8e autolink is deferred.
- `AgentInput.tsx` 6j (keyboard state machine) **only if operator approves call #6** AND on-tablet parity holds after revert; else defer 6j to US-006 as a KEEP.

**Acceptance criteria:**
- Each reverted region byte-matches the corresponding `cli-1.1.10` block (`git -C D:/harness-efforts/happy show 71c417e1:packages/happy-app/sources/<path>` reference).
- Each revert has a catalogue re-apply recipe (what was lost + how to re-add).
- i18n: any upstream `t(...)` key re-introduced by a revert exists in all 10 locales + `_default.ts` (add if missing); `pnpm --filter happy-app test text/translations.test.ts` green.
- `pnpm --filter happy-app typecheck` + existing `AgentInput.*.test.tsx` green.
- Visual parity: reverted regions render as upstream does.

**Deps:** US-000; operator calls #6, #7.

---

## US-002 — KEEP-DELETED guards + catalogue

**Goal:** lock in the fork's deliberate removals with negative "must-not-exist" tests so a future import can't silently resurrect them.

**Scope (add guard tests + catalogue KEEP-DELETED rows; no production-code change):**
- 5f/5g — ChatList tool-grouping (`useGroupedMessages`, `ToolGroupView`, `AgentWorkGroupView`) + `DuplicateSheet`/`useSessionQuickActions` fork-from-message stay removed.
- 6g — AgentInput mic/voice send-button variant stays removed.
- 9f — MessageView goal/command parsing (`parseLocalCommandMessage`, `isUserSlashCommandEcho`) + `onForkFromUserMessage` long-press stay removed.

**Acceptance criteria:**
- A test asserts each removed symbol/import is absent (e.g. source-scan or render-assert "no mic button", "no tool-group toggle").
- Catalogue rows record each KEEP-DELETED + its re-apply recipe (incl. any orphaned i18n keys like `message.sentAsGoal`).
- `pnpm --filter happy-app typecheck` + `pnpm --filter happy-app test` green.

**Deps:** US-000; operator calls #2, #3, #4.

---

## US-003 — MarkdownView KEEP extraction (HA-8)

**Goal:** relocate MarkdownView's e-ink + fork-feature hunks into `sources/fork/markdown/*`; `MarkdownView.tsx` returns toward upstream shape + thin seams.

**Scope:**
- `sources/fork/markdown/optionCardStyles.ts` + option-card renderer ← 8a (`:817-856`).
- `sources/fork/markdown/einkMarkdownStyles.ts` ← 8b (`:719-771`), 8h (code-block scaling).
- keep thin seam to existing `processClaudeMetaTags`/`TaskNotificationPill` ← 8c.
- `sources/fork/markdown/sessionFileAutolink.ts` ← 8d; `useMarkdownLinkNav.ts` ← 8e; `SessionAwareImage.tsx` ← 8f.
- font-scale seam ← 8g (existing `useChatFontScale`).
- One `RESTORE-R8d` marker at the seam entry.

**Acceptance criteria (behavior-preserving):**
- **e-ink parity:** option cards = `userMessageBackground` fill + `textSecondary` 2px border + 4px text accent; code-block/image contrast unchanged vs pre-extraction (framebuffer compare + on-tablet spot-check).
- Session-file autolink + internal nav + session-aware image fallback behave identically.
- Claude meta-tag → task pill rendering unchanged.
- `MarkdownView.tsx` diff vs upstream is now thin seam calls only (no large inline style/render blocks).
- `pnpm --filter happy-app typecheck` green; existing markdown tests (if any) green.

**Deps:** US-000. Parallel-safe with US-004, US-005.

---

## US-004 — MessageView KEEP extraction (HA-9)

**Goal:** relocate MessageView's e-ink user-message styling + fork features into `sources/fork/message/*`; keep the two thin suppression guards inline.

**Scope:**
- `sources/fork/message/einkMessageStyles.ts` ← 9a (user-message band: `userMessageBackground` fill, no bubble `paddingVertical`).
- keep thin `isSkillBodyMessage(...)` guards ← 9b; keep `chatBodyWidth` prop ← 9c; keep `<BoundaryDivider/>` seam ← 9d.
- `sources/fork/message/MessageAttachmentChips.tsx` ← 9e.
- font-scale seam ← 9g; `sources/fork/message/nestedStepsCap.ts` ← 9h.
- One `RESTORE-R8e` marker at the seam entry.

**Acceptance criteria (behavior-preserving):**
- **e-ink parity (critical):** user-message renders as the `#d4d4d4` full-width left-aligned band, NO `paddingVertical` on the bubble — byte-identical to pre-extraction.
- skillBody suppression still hides Claude SKILL.md echoes in both user + agent paths.
- Attachment chips, boundary divider, font-scale, nested-depth cap render identically.
- `MessageView.tsx` diff vs upstream is thin seams only.
- `pnpm --filter happy-app typecheck` green.

**Deps:** US-000 (KEEP-DELETED 9f handled in US-002). Parallel-safe with US-003, US-005.

---

## US-005 — ChatList KEEP extraction (HA-5)

**Goal:** relocate ChatList's e-ink FlatList tuning + page-turn + pinch-zoom into `sources/fork/chat/*`; leave SYNC-R5 prefetch/boundary-data wiring in place with markers.

**Scope:**
- `sources/fork/chat/chatListEinkProps.ts` (const) ← 5a (`windowSize=21`, `removeClippedSubviews=false`, `maxToRenderPerBatch=4`, MVCP `minIndexForVisible=0`); canonical spreads `{...chatListEinkProps}`.
- `sources/fork/chat/usePageTurnScroll.ts` ← 5b (tap-zones, `scrollEnabled` gate, `chatPaginatedScroll`).
- `sources/fork/chat/usePinchFontScale.ts` ← 5c (pinch gesture, `ChatScaleLiveContext`, `pinchToZoomEnabled`).
- 5d divider render via existing `BoundaryDivider`; **do NOT extract** the `buildChatListBoundaryItems`/`useLatestBoundary`/`reportRenderWindow`/`loadOlder` wiring — mark `RESTORE-R8b (HA-1/2/3, R5 residual)`.
- One `RESTORE-R8b` marker at the seam entry.

**Acceptance criteria (behavior-preserving):**
- **e-ink parity (critical):** load-older anchor stability preserved (no snap-back — the 2026-04-29 regression must NOT reappear); page-turn tap-zones page through history without smooth-scroll; pinch-zoom scales font live then commits.
- Existing `components/ChatList.preBoundaryHistory.test.tsx` green.
- SYNC-R5 wiring untouched (diff shows only extraction of UI props/gestures, not sync calls).
- `pnpm --filter happy-app typecheck` green.

**Deps:** US-000; operator call #5 (pinch/page-turn confirmed KEEP). Parallel-safe with US-003, US-004.

---

## US-006 — AgentInput KEEP extraction (HA-6)

**Goal:** relocate AgentInput's attachment + layout + toolbar fork chrome into `sources/fork/composer/*`; leave SYNC-R5 send-policy wiring in place.

**Scope:**
- `sources/fork/composer/useFileAttachment.ts` (+ existing `AttachmentChip`) ← 6b.
- `sources/fork/composer/NewSessionSlotPanel.tsx` ← 6c.
- `sources/fork/composer/useComposerLayout.ts` ← 6d (chat-width + text-size overlays), 6e (toolbar gating), 6f (layout width).
- 6a (controlled `mode`/`value` + send-policy) + 6-deferred-send: **leave**, mark `RESTORE-R8c (HA-1, R5 residual)`.
- One `RESTORE-R8c` marker at the seam entry.

**Acceptance criteria (behavior-preserving):**
- Attachment attach/preview/clear flow identical; new-session slot panel identical; chat-width + text-size choosers behave identically; toolbar gating identical.
- `AgentInput.attachments.test.tsx` + `AgentInput.mode.test.tsx` + `AgentInput.keyboard.test.tsx` + `AgentInput.activeRegression.test.tsx` green.
- SYNC-R5 send-policy wiring untouched.
- `AgentInput.tsx` diff vs upstream materially smaller (post-US-001 reverts + post-extraction).
- `pnpm --filter happy-app typecheck` green.

**Deps:** US-000, US-001 (reverts land first); operator calls #4, #5 (and #6 if 6j deferred here).

---

## US-007 — SessionView KEEP extraction (HA-4)

**Goal:** relocate SessionView's sidebar/header/composer/context-drawer/boundary UI into `sources/fork/session/*`; leave SYNC-R5 wiring in place.

**Scope:**
- `sources/fork/session/useSessionSidebar.ts` ← 4a; `SessionHeaderSurfaces.tsx` ← 4b/4c; `useForkComposer.ts` ← 4d; attachment seam ← 4e; `useSessionContextDrawer.ts` ← 4f; `useBoundaryAdvisory.ts` ← 4g; chat-width seam ← 4h.
- 4j/4k/4l (idle-send/pending-switch, permission/model/effort, session-visibility): **leave**, mark `RESTORE-R8a (HA-1/2/3, R5 residual)`.
- One `RESTORE-R8a` marker at the seam entry.

**Acceptance criteria (behavior-preserving):**
- Sidebar collapse/expand + collapsed rail; header path/metadata surface; controlled-draft + pre-send intercept; attachment send; context drawer + archived resume; boundary advisory — all render/behave identically.
- SYNC-R5 wiring (send policy, model/effort, visibility) untouched.
- `SessionView.tsx` diff vs upstream is thin seams + SYNC-R5 residual only.
- `pnpm --filter happy-app typecheck` green.

**Deps:** US-000, US-001; shares `useFileAttachment` with US-006 (US-006 authors it) → US-007 after US-006.

---

## US-008 — Sidebar trio (HA-10/11/12) — operator-gated

**Goal:** take the near-total-rewrite sidebar files fully fork-owned (KEEP-as-shim) OR revert to upstream (DISABLE), per operator call #1.

**Scope (KEEP-as-shim path — recommended):**
- Move `SidebarView.tsx` body → `sources/fork/sidebar/ForkSidebarView.tsx`; canonical `SidebarView.tsx` = `export { SidebarView } from '@/fork/sidebar/ForkSidebarView'`.
- Same for `SidebarNavigator.tsx` → `sources/fork/sidebar/ForkSidebarNavigator.tsx`.
- Move `ChatHeaderView.tsx` body → `sources/fork/session/ForkChatHeaderView.tsx`; canonical re-export.
- Add the three canonical files to `.gitattributes merge=ours` (finalize the US-000 placeholder).

**Scope (DISABLE path — if operator drops collapse UX):**
- Revert `SidebarView.tsx`/`SidebarNavigator.tsx`/`ChatHeaderView.tsx` to `cli-1.1.10`; delete the fork-only sidebar modules they depended on if now unused; record full re-apply recipe.

**Acceptance criteria:**
- KEEP-as-shim: canonical files are 1-line re-exports; `merge=ours` entries present; sidebar collapse/restore + avatar header render identically; `pnpm --filter happy-app typecheck` green.
- DISABLE: canonical files byte-match upstream; no dangling imports; typecheck green; re-apply recipe in catalogue.

**Deps:** US-000; operator call #1. **Ships last.**

---

## Cross-cutting acceptance (whole job)

- Every touched canonical hotspot carries exactly one representative `RESTORE-R8<x>` marker (per the catalogue "one representative marker for largely-rewritten files" rule).
- `docs/happy-patch-surface.md` HA-4..HA-12 rows reflect the FINAL KEEP/DISABLE/KEEP-DELETED disposition + re-apply recipes + the `sources/fork/` zero-conflict context row.
- `pnpm --filter happy-app typecheck` green after every story.
- `pnpm --filter happy-app test` green (existing tests + new KEEP-DELETED negative guards).
- e-ink parity checklists met for US-003/004/005 (and 006/007 where UI moves): user-message band, option cards, contrast, page-turn/anchor stability, boundary divider, pinch/text-size — all byte/behavior identical.
- i18n parity (`text/translations.test.ts`) green wherever strings were touched.
- No `git add -A`; no `git add CLAUDE.md`.
- Estimated outcome (per `plan.md` §10): happy-app hard-conflict FILES 59 → ~56 (sidebar trio drops via `merge=ours`); hotspot manual-merge HUNK budget 111 → ~45–50 (~55–60% effort cut); fork e-ink UI logic relocated into ~25 zero-conflict `sources/fork/` modules.
