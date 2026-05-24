# Stories Outline: session-role-pill

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Extend SessionRowData with metadata model/permission fields
**Description:** As a session-list consumer, I want `currentModelCode` and `currentPermissionModeCode` projected onto each `SessionRowData` so that the list row can render them without reaching into the raw `Session` object.
**Acceptance Criteria:**
- [ ] `SessionRowData` interface in `packages/happy-app/sources/sync/storage.ts` (lines 84-107) has two new fields: `currentModelCode?: string | null` and `currentPermissionModeCode?: string | null`.
- [ ] `buildSessionRowData()` (lines 109-147) copies `session.metadata?.currentModelCode ?? null` and `session.metadata?.currentPermissionModeCode ?? null` into the returned object.
- [ ] No other field is added or modified on `SessionRowData`.
- [ ] `keyExtractor` in `SessionsList.tsx` (lines 225-233) is unchanged.
- [ ] Typecheck passes: `pnpm --filter happy-app typecheck` exits 0.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Add helpers and pill row to SessionItem; export SessionItem
**Description:** As a mobile session-list user, I want each session row to show the agent's flavor icon, abbreviated model code, and permission-mode badge so I can identify the running agent at a glance without opening the drawer.
**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/components/SessionsList.tsx` gains a pure helper `formatModelCode(code: string | null | undefined): string | null` that returns the last `-`-segment when it matches `['codex', 'opus', 'sonnet', 'haiku']`, otherwise the raw code (capped at ~12 chars).
- [ ] `packages/happy-app/sources/components/SessionsList.tsx` gains a pure helper `permissionColorForCode(code, theme): string` with explicit switch mapping `acceptEdits/bypassPermissions/plan/read-only/safe-yolo/yolo/default` → `theme.colors.permission.*` (mirrors `AgentInput.tsx:1387-1396`). Falls back to `theme.colors.textSecondary` for unknown codes.
- [ ] `SessionItem` (line 342) is exported via `export const SessionItem = React.memo(...)`. No other export changes.
- [ ] `SessionItem` renders a pill row `View` between the subtitle `Text` (line 436-438) and the `statusRow` `View` (line 440-450). The pill row container is rendered ONLY when at least one of `session.flavor`, `session.currentModelCode`, `session.currentPermissionModeCode` is non-null/non-empty.
- [ ] Three pills, each with a stable `testID`:
  - `testID="session-role-pill-flavor"` — renders an `expo-image` `Image` with `source={newSessionAgentIcons[flavor]}` (size inline: `{ width: 12, height: 12 }`), shown only when `session.flavor` matches a known key.
  - `testID="session-role-pill-model"` — renders `Text` with `formatModelCode(session.currentModelCode)`, shown only when `session.currentModelCode` is non-null.
  - `testID="session-role-pill-permission"` — renders `Text` with raw `session.currentPermissionModeCode`, colored via `permissionColorForCode(...)`, shown only when `session.currentPermissionModeCode` is non-null.
- [ ] Pill layout: container is `flexDirection:'row', alignItems:'center', gap:6, marginTop:4, overflow:'hidden'`. Each pill is `flexShrink:1, minWidth:0, height:20, paddingHorizontal:6, borderRadius:6`. Pill text is `numberOfLines={1}, ellipsizeMode:'tail'`.
- [ ] `sessionItem` style `height` is bumped from 88 to 108 in the unistyles block at the end of the file.
- [ ] All new styles live in the existing `stylesheet = StyleSheet.create((theme) => ({...}))` block (project convention — styles at end of file).
- [ ] `React.memo` call on `SessionItem` remains without a custom comparator (default shallow compare).
- [ ] Typecheck passes: `pnpm --filter happy-app typecheck` exits 0.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Snapshot/structural tests + docs status update
**Description:** As a code reviewer, I want a vitest test that locks in the three-pill render and a deterministic snapshot so future refactors don't silently regress this UX.
**Acceptance Criteria:**
- [ ] New file `packages/happy-app/sources/components/SessionsList.test.tsx` exists.
- [ ] Test file mocks all module-scope imports of `SessionsList.tsx` so vitest can evaluate the module under the node runner: `react-native`, `react-native-unistyles`, `react-native-safe-area-context`, `react-native-reanimated`, `@expo/vector-icons`, `expo-image`, `expo-router`, `expo-store-review`, `@/components/StyledText`, `@/components/Avatar`, `@/components/StatusDot`, `@/components/UpdateBanner`, `@/components/SessionActionsPopover`, `@/components/ActiveSessionsGroupCompact`, `@/components/NewSessionAgentIcons` (stable stub: `{ codex:1, claude:2, gemini:3, openclaw:4 }`), `@/hooks/useNavigateToSession`, `@/hooks/useVisibleSessionListViewData`, `@/hooks/useSessionQuickActions`, `@/utils/responsive`, `@/utils/requestReview`, `@/utils/sessionUtils` (deterministic `vibingMessages`/`formatLastSeen`), `@/sync/storage`, `@/text`, `@/constants/Typography`, `@/components/layout`.
- [ ] Test A (acceptance): renders `SessionItem` with `flavor:'codex', currentModelCode:'gpt-5-codex', currentPermissionModeCode:'plan', state:'waiting'`. Asserts:
  - `renderer.root.findByProps({ testID: 'session-role-pill-flavor' })` resolves.
  - `renderer.root.findByProps({ testID: 'session-role-pill-model' })` resolves and contains text `'codex'`.
  - `renderer.root.findByProps({ testID: 'session-role-pill-permission' })` resolves and contains text `'plan'`.
  - `expect(renderer.toJSON()).toMatchSnapshot()` passes (snapshot file created on first run).
- [ ] Test B (no-fields): renders `SessionItem` with `flavor:null, currentModelCode:null, currentPermissionModeCode:null, state:'waiting'`. Asserts `renderer.root.findAllByProps({ testID: 'session-role-pill-flavor' })` returns an empty array (and likewise for the other two `testID`s). No empty pill row container is rendered.
- [ ] `pnpm --filter happy-app test --run SessionsList` exits 0 and creates `__snapshots__/SessionsList.test.tsx.snap`.
- [ ] `pnpm --filter happy-app test --run` (full package suite) exits 0.
- [ ] `pnpm -r --if-present typecheck` (cross-package typecheck) exits 0.
- [ ] `plans/parallel-assignments.md` line 484 status flipped from `🟡 in progress` to `✅ done`.
- [ ] Single commit on `main` branch.
**Dependencies:** US-001, US-002
**Estimated complexity:** medium
