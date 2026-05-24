# PRD: Session Role Pill

*Autonomous-mode PRD generated from the pre-existing plan, stories outline, research brief, and requirements gaps assessment for the `session-role-pill` job. No clarifying questions were asked; assumptions are documented inline and in `notepad.md`.*

## 1. Introduction / Overview

Add an inline horizontal pill row beneath each session-list row's subtitle in `packages/happy-app/sources/components/SessionsList.tsx::SessionItem`. The row surfaces three agent-identity signals at a glance:

1. **Flavor icon** (e.g., codex / claude / openclaw / gemini), reusing `newSessionAgentIcons`.
2. **Abbreviated model code** (e.g., `gpt-5-codex` → `codex`), produced by a local `formatModelCode()` helper.
3. **Permission-mode badge** colored by `theme.colors.permission.*`, mapped via an explicit `permissionColorForCode()` helper that mirrors `AgentInput.tsx:1387-1396`.

Today these fields live on `Session.metadata` and only appear inside `SessionContextDrawer`. Bringing them onto the row itself gives the mobile session list the same "teammate view" affordance that Claude Code's spinner-tree exposes on every line.

The change is additive and parallel-safe with everything else in the agent-view roadmap. No wire schema changes (the metadata already carries all three fields). No public API impact (`SessionRowData` is internal-only).

## 2. Goals

- Surface flavor, model, and permission mode on every (non-active) session row without opening the drawer.
- Reuse existing assets (`newSessionAgentIcons`, `theme.colors.permission.*`) — no new shared primitive introduced.
- Make `SessionItem` testable via a named export.
- Lock in the rendering with a vitest snapshot plus structural assertions, so future refactors cannot silently regress.
- Stay parallel-safe: confined to `packages/happy-app/` plus one `plans/parallel-assignments.md` status flip.

## 3. User Stories

### US-001: Extend SessionRowData with metadata model/permission fields
**Description:** As a session-list consumer, I want `currentModelCode` and `currentPermissionModeCode` projected onto each `SessionRowData` so the list row can render them without reaching into the raw `Session` object.

**Acceptance Criteria:**
- [ ] `SessionRowData` interface in `packages/happy-app/sources/sync/storage.ts` (lines 84-107) has two new fields: `currentModelCode?: string | null` and `currentPermissionModeCode?: string | null`.
- [ ] `buildSessionRowData()` (lines 109-147) copies `session.metadata?.currentModelCode ?? null` and `session.metadata?.currentPermissionModeCode ?? null` into the returned object.
- [ ] No other field is added or modified on `SessionRowData`.
- [ ] `keyExtractor` in `SessionsList.tsx` (lines 225-233) is unchanged (still keys on `session-${session.id}`).
- [ ] Typecheck passes: `pnpm --filter happy-app typecheck` exits 0.

### US-002: Add helpers and pill row to SessionItem; export SessionItem
**Description:** As a mobile session-list user, I want each session row to show the agent's flavor icon, abbreviated model code, and permission-mode badge so I can identify the running agent at a glance without opening the drawer.

**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/components/SessionsList.tsx` gains a pure helper `formatModelCode(code: string | null | undefined): string | null` that returns the last `-`-segment when it matches `['codex', 'opus', 'sonnet', 'haiku']`, otherwise the raw code (capped at ~12 chars).
- [ ] `packages/happy-app/sources/components/SessionsList.tsx` gains a pure helper `permissionColorForCode(code, theme): string` with explicit switch mapping `acceptEdits`/`bypassPermissions`/`plan`/`read-only`/`safe-yolo`/`yolo`/`default` → `theme.colors.permission.*` (mirrors `AgentInput.tsx:1387-1396`). Falls back to `theme.colors.textSecondary` for unknown codes.
- [ ] `SessionItem` (line 342) is exported via `export const SessionItem = React.memo(...)`. No other export changes.
- [ ] `SessionItem` renders a pill-row `View` between the subtitle `Text` (lines 436-438) and the `statusRow` `View` (lines 440-450). The pill row container is rendered ONLY when at least one of `session.flavor`, `session.currentModelCode`, `session.currentPermissionModeCode` is non-null/non-empty.
- [ ] Three pills, each with stable `testID`:
  - `testID="session-role-pill-flavor"` — renders an `expo-image` `Image` with `source={newSessionAgentIcons[flavor]}` (size inline: `{ width: 12, height: 12 }`), shown only when `session.flavor` matches a known key.
  - `testID="session-role-pill-model"` — renders `Text` with `formatModelCode(session.currentModelCode)`, shown only when `session.currentModelCode` is non-null.
  - `testID="session-role-pill-permission"` — renders `Text` with raw `session.currentPermissionModeCode`, colored via `permissionColorForCode(...)`, shown only when `session.currentPermissionModeCode` is non-null.
- [ ] Pill layout: container is `flexDirection:'row', alignItems:'center', gap:6, marginTop:4, overflow:'hidden'`. Each pill is `flexShrink:1, minWidth:0, height:20, paddingHorizontal:6, borderRadius:6`. Pill text is `numberOfLines={1}, ellipsizeMode:'tail'`.
- [ ] `sessionItem` style `height` is bumped from `88` to `108` in the unistyles block at the end of the file.
- [ ] All new styles live in the existing `stylesheet = StyleSheet.create((theme) => ({...}))` block (project convention — styles at end of file).
- [ ] `React.memo` call on `SessionItem` remains without a custom comparator (default shallow compare).
- [ ] Typecheck passes: `pnpm --filter happy-app typecheck` exits 0.

### US-003: Snapshot/structural tests + docs status update
**Description:** As a code reviewer, I want a vitest test that locks in the three-pill render plus a deterministic snapshot so future refactors don't silently regress this UX.

**Acceptance Criteria:**
- [ ] New file `packages/happy-app/sources/components/SessionsList.test.tsx` exists.
- [ ] Test file mocks all module-scope imports of `SessionsList.tsx` so vitest can evaluate the module under the node runner: `react-native`, `react-native-unistyles`, `react-native-safe-area-context`, `react-native-reanimated`, `@expo/vector-icons`, `expo-image`, `expo-router`, `expo-store-review`, `@/components/StyledText`, `@/components/Avatar`, `@/components/StatusDot`, `@/components/UpdateBanner`, `@/components/SessionActionsPopover`, `@/components/ActiveSessionsGroupCompact`, `@/components/NewSessionAgentIcons` (stable stub: `{ codex:1, claude:2, gemini:3, openclaw:4 }`), `@/hooks/useNavigateToSession`, `@/hooks/useVisibleSessionListViewData`, `@/hooks/useSessionQuickActions`, `@/utils/responsive`, `@/utils/requestReview`, `@/utils/sessionUtils` (deterministic `vibingMessages`/`formatLastSeen`), `@/sync/storage`, `@/text`, `@/constants/Typography`, `@/components/layout`.
- [ ] Test A (acceptance): renders `SessionItem` with `flavor:'codex', currentModelCode:'gpt-5-codex', currentPermissionModeCode:'plan', state:'waiting'`. Asserts:
  - `renderer.root.findByProps({ testID: 'session-role-pill-flavor' })` resolves.
  - `renderer.root.findByProps({ testID: 'session-role-pill-model' })` resolves and its descendant text reads `'codex'`.
  - `renderer.root.findByProps({ testID: 'session-role-pill-permission' })` resolves and its descendant text reads `'plan'`.
  - `expect(renderer.toJSON()).toMatchSnapshot()` passes (snapshot file created on first run).
- [ ] Test B (no-fields): renders `SessionItem` with `flavor:null, currentModelCode:null, currentPermissionModeCode:null, state:'waiting'`. Asserts `renderer.root.findAllByProps({ testID: 'session-role-pill-flavor' })` returns an empty array (and likewise for the other two `testID`s). No empty pill-row container is rendered.
- [ ] `pnpm --filter happy-app test --run SessionsList` exits 0 and creates `__snapshots__/SessionsList.test.tsx.snap`.
- [ ] `pnpm --filter happy-app test --run` (full package suite) exits 0.
- [ ] `pnpm -r --if-present typecheck` (cross-package typecheck) exits 0.
- [ ] `plans/parallel-assignments.md` line 484 status flipped from `🟡 in progress` to `✅ done`.
- [ ] Single commit on the `ralph/session-role-pill` branch.
- [ ] Verify in browser using dev-browser skill (visual check that pills do not clip the statusRow at the new 108px row height; bump up to 120 if needed).

## 4. Functional Requirements

- FR-1: `SessionRowData` (in `packages/happy-app/sources/sync/storage.ts`) MUST expose `currentModelCode?: string | null` and `currentPermissionModeCode?: string | null` projected from `session.metadata` via `buildSessionRowData()`.
- FR-2: `SessionsList.tsx` MUST define a pure helper `formatModelCode(code)` that returns the last `-`-segment for known codes (`codex`, `opus`, `sonnet`, `haiku`); otherwise returns the raw code (capped at ~12 chars). Returns `null` for `null/undefined` input.
- FR-3: `SessionsList.tsx` MUST define a pure helper `permissionColorForCode(code, theme)` that switches on the metadata code (`default`, `plan`, `acceptEdits`, `bypassPermissions`, `read-only`, `safe-yolo`, `yolo`) and maps each to the correct `theme.colors.permission.*` token. Unknown codes fall back to `theme.colors.textSecondary`.
- FR-4: `SessionItem` MUST be exported as a named export (`export const SessionItem = React.memo(...)`).
- FR-5: `SessionItem` MUST render a pill row between the subtitle and `statusRow` views, gated on at least one of `flavor`/`currentModelCode`/`currentPermissionModeCode` being present. When all three are absent, the row container MUST NOT be rendered (no empty spacer).
- FR-6: Each pill MUST carry a stable `testID`: `session-role-pill-flavor`, `session-role-pill-model`, `session-role-pill-permission`.
- FR-7: Flavor pill MUST render an `expo-image` `Image` sourced from `newSessionAgentIcons[flavor]` with inline size `{ width: 12, height: 12 }` (per CLAUDE.md expo-image rule). Skipped when `flavor` is not a known key.
- FR-8: Model pill `<Text>` MUST render `formatModelCode(session.currentModelCode)`; permission pill `<Text>` MUST render the **raw** `session.currentPermissionModeCode` (v1 decision — no picker label resolution).
- FR-9: Pill row layout MUST be single-line and ellipsize, never wrap: container `flexDirection:'row', alignItems:'center', gap:6, marginTop:4, overflow:'hidden'`; each pill `flexShrink:1, minWidth:0, height:20, paddingHorizontal:6, borderRadius:6, flexDirection:'row', alignItems:'center', gap:4`; pill text `fontSize:11, fontWeight:'600', numberOfLines:1, ellipsizeMode:'tail'`.
- FR-10: `sessionItem` style `height` MUST be bumped from 88 to 108 to fit the new pill row. If clipping is observed during browser verification, the implementer MAY raise the value (cap at 120).
- FR-11: All new styles MUST live in the existing `stylesheet = StyleSheet.create((theme) => ({...}))` block at the end of `SessionsList.tsx`.
- FR-12: `keyExtractor` and the `React.memo(SessionItem)` call MUST remain unchanged (no new comparator, key still `session-${session.id}`).
- FR-13: A new vitest file `packages/happy-app/sources/components/SessionsList.test.tsx` MUST exist with the two tests (A and B) and the full module-mock list described in US-003.
- FR-14: `plans/parallel-assignments.md` line 484 status MUST flip from `🟡 in progress` to `✅ done` (and only that line changes).
- FR-15: All work MUST land on the `ralph/session-role-pill` branch inside the dedicated worktree at `D:/harness-efforts/codexu/.worktrees/session-role-pill`. No changes to `main`.

## 5. Non-Goals (Out of Scope)

- **`ActiveSessionsGroupCompact.tsx`** — the separate compact path for active sessions. The feature request points only at `SessionsList.tsx`. Pill parity for that path is a follow-up.
- **Local picker overrides** — `updateSessionPermissionMode` / `updateSessionModelMode` in `storage.ts` deliberately do NOT rebuild `sessionListViewData`. Pills mirror metadata only and update when the agent echoes the change back. Out of scope to change.
- **Drawer-style permission labels** — drawer resolves `bypassPermissions` → `'Yolo'`, `read-only` → `'Read Only'` via `getAvailablePermissionModes`. This PR renders raw codes (v1 decision); label parity is Open Question 6 and a follow-up.
- **Flavor normalization (`gpt`/`openai` → `codex`)** — direct key lookup with fallback; matches `Avatar` and `NewSessionAgentIcons` current behavior. Out of scope.
- **RTL layout** — codebase has no existing RTL support; assume LTR.
- **i18n for permission/model strings** — raw metadata codes only for v1.
- **Shared Pill/Badge primitive extraction** — chip styles stay local to `SessionsList.tsx` (consistent with `GitStatusBadge`, `TaskNotificationPill`, etc.).

## 6. Design Considerations

- **Reuse**: flavor icons from `packages/happy-app/sources/components/NewSessionAgentIcons.ts`; permission colors from `packages/happy-app/sources/theme.ts:138-147`.
- **Chip styling reference**: `SessionContextDrawer.tsx:184-200,271-310` (`ContextChip` / `PathChip`) — pattern only; do not import private helpers. Replicate locally inside `SessionsList.tsx`.
- **Permission badge precedent**: `AgentInput.tsx:1387-1405` already maps metadata codes → theme color keys via an explicit conditional. Mirror this mapping.
- **expo-image rule**: per `packages/happy-app/CLAUDE.md`, `Image` size (`width`/`height`) must be inline, not in unistyles.
- **Unistyles convention**: `StyleSheet.create((theme, runtime) => ({...}))` block placed at the end of the file.

## 7. Technical Considerations

- **CRITICAL — Permission color helper (F-001)**: theme keys (`bypass`, `readOnly`, `safeYolo`) do NOT match metadata codes (`bypassPermissions`, `read-only`, `safe-yolo`). Direct dynamic indexing fails TypeScript strict-mode and silently falls back. Use the explicit switch helper documented in `plan.md` "Permission color helper" section.
- **Render raw codes, not picker-resolved labels (v1 decision, F-006)**: Codex hardcoded modes don't include `plan`, but the acceptance test specifies `flavor='codex' + currentPermissionModeCode='plan'`. Picker resolution would drop or transform that, breaking the test.
- **Row height risk**: 88 → 108 may still clip the statusRow if pill row + existing rows exceed budget. If clipping observed during browser verification, increase to 116-120 (cap 120). Snapshot output won't catch this (no layout engine in `react-test-renderer`); manual verification is required.
- **Memoization safety**: new `SessionRowData` fields are stable primitives. `useSessionListViewData()` deep-equal selector shields against spurious diffs. No changes needed to the `React.memo` call.
- **Test mock breadth (F-002)**: vitest evaluates the whole `SessionsList.tsx` module at import time. The complete mock list (see US-003) is mandatory; partial mocks will fail at import before any test runs.
- **Worktree isolation**: main has uncommitted in-progress work from a parallel task (`session-parent-link` modifying `storageTypes.ts`, plus `codex` submodule, `packages/happy-agent/dist/*`, `packages/happy-cli/src/api/types.ts`). All session-role-pill work MUST occur in the dedicated worktree `D:/harness-efforts/codexu/.worktrees/session-role-pill` on branch `ralph/session-role-pill`.

## 8. Success Metrics

- All four verification commands pass: `pnpm --filter happy-app typecheck`, `pnpm --filter happy-app test --run`, `pnpm --filter happy-app test --run SessionsList`, `pnpm -r --if-present typecheck`.
- A reviewer can identify the running agent (flavor + model + permission mode) on every session list row without tapping into the drawer.
- Snapshot file is created at `packages/happy-app/sources/components/__snapshots__/SessionsList.test.tsx.snap` and committed.
- Structural `testID` assertions provide regression protection independent of unrelated tree changes.

## 9. Open Questions

1. **Row height bump magnitude** — 88 → 108 is a starting point; verify visually and increase up to 120 if clipping is observed.
2. **`gpt`/`openai` flavor mapping** — direct key lookup with fallback for this PR. Follow-up: add a shared normalizer if product wants `gpt`/`openai` to render the codex icon.
3. **i18n for permission codes** — rendered as raw `'plan'` / `'default'` / `'acceptEdits'` etc. Localization out of scope.
4. **Parity with `ActiveSessionsGroupCompact`** — separate code path. Follow-up if parity is desired.
5. **Codex `plan` permission oddity** — acceptance test pairs codex flavor with plan; rendering raw codes accepts that. No flavor↔permission compatibility validation in the pill renderer.
6. **Drawer-style permission labels** — follow-up to add `formatPermissionLabel(code, flavor)` with `getAvailablePermissionModes` lookup if product wants label parity.
