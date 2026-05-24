# Research Brief — session-role-pill

## Researcher Findings

### SessionItem memo (`packages/happy-app/sources/components/SessionsList.tsx:342-463`)
- Props: `{ session: SessionRowData; selected?; isFirst?; isLast?; isSingle? }`
- Layout: Avatar 48px + content (title, subtitle, status row)
- **No explicit memo equality function** — React.memo default shallow compare on `session` (object reference)
- Fixed height `88px` (line 68)
- `keyExtractor` (lines 225-233): keys on `session-${session.id}` — independent of new fields

### SessionRowData (`packages/happy-app/sources/sync/storage.ts:84-107`)
- Already has `flavor: string | null` (line 89)
- **MISSING**: `currentModelCode`, `currentPermissionModeCode`
- Built by `buildSessionRowData()` at lines 109-147 — adds new field projection here
- Interface is intentionally "all primitives, cheap to deep-equal" — keep new fields as primitives
- `useSessionListViewData()` uses deep equality (line 1485 area) — adding metadata fields lets metadata-only updates notify the list

### Metadata schema (`packages/happy-app/sources/sync/storageTypes.ts:8-88`)
- `currentModelCode: z.string().optional()` (line 16)
- `currentPermissionModeCode: z.string().optional()` (line 23)
- `flavor: z.string().nullish()` (line 74)
- No enum literals — all are free-form strings

### SessionContextDrawer (`packages/happy-app/sources/components/SessionContextDrawer.tsx`)
- Renders model + permission chips today via local `ContextChip` helper (lines 184-190)
- Chip style: height 24, borderRadius 8, `theme.colors.surfacePressed` background, 12px semi-bold text
- `PathChip` adds icon prefix variant (lines 192-200)
- **No shared Pill/Badge primitive in codebase**

### Pill/Chip primitives (no centralized one exists)
- `TaskNotificationPill.tsx` — paddingHorizontal 16, paddingVertical 12, borderRadius 12, `theme.colors.surface`
- `AttachmentChip.tsx` — caller-provided styles
- `SessionContextDrawer.ContextChip` / `PathChip` — closest canonical pattern
- `GitStatusBadge.tsx` — icon + text + flexbox, specialized

### Flavor icons
- **Shared**: `packages/happy-app/sources/components/NewSessionAgentIcons.ts` exposes flavor-icon asset map (codex/claude/openclaw/gemini)
- Also duplicated in `Avatar.tsx:27-32` (local)
- Flavor label normalization in `app/(app)/session/[id]/info.tsx`: treats `gpt`/`openai` as Codex — inconsistency to note

### Permission color tokens (`packages/happy-app/sources/theme.ts:138-147`)
- `theme.colors.permission`:
  - `default: #8E8E93` (grey)
  - `acceptEdits: #007AFF` (blue)
  - `bypass: #FF9500` (orange)
  - `plan: #34C759` (green)
  - `readOnly: #8B8B8D`
  - `safeYolo: #FF6B35`
  - `yolo: #DC143C`

### Vitest test infrastructure
- Config: `packages/happy-app/vitest.config.mts` — node env, `@/` alias to `./sources/`
- Setup: `sources/_test-stubs/setup.ts` — RN/expo module stubs
- Pattern reference: `packages/happy-app/sources/components/ActiveSessionsGroupCompact.test.tsx` — uses `react-test-renderer` + `TestRenderer.create()`, mocks all UI deps with string components
- **No existing snapshot tests in package** — this would be first; no `__snapshots__` dirs
- Related test files: `SessionContextDrawer.test.tsx`, `modelModeOptions.test.ts`, `storage.spec.ts`, `storage.applySessions.spec.ts`
- **No `SessionsList.test.tsx` exists yet**

### Build/typecheck commands
- happy-app: `pnpm --filter happy-app typecheck` → `tsc --noEmit`
- happy-app tests: `pnpm --filter happy-app test` → `vitest`
- **No root-level `typecheck` script** — cross-package = `pnpm -r --if-present typecheck`
- No turbo.json

### Styling
- `react-native-unistyles` with `StyleSheet.create((theme, runtime) => ({...}))`
- Theme tokens: `theme.colors.*`
- No Tailwind/NativeWind

### plans/agent-view-research.md §6
- Task `session-role-pill`, effort 3h, low risk, parallel-safe
- Acceptance restated: vitest snapshot of SessionItem with all three pills

## Architect Analysis

### Key architectural finding
**SessionItem is NOT exported** — for a direct snapshot test, either export it or render `SessionsList` with mocked `useVisibleSessionListViewData()`. Cleanest path: export named `SessionItem`.

### Data flow trace
1. `applySessions()` (storage.ts line 395+) — normalizes incoming sessions
2. `buildSessionListViewData()` (line 250+) — calls `buildSessionRowData()` per session
3. `useSessionListViewData()` selector — deep-equal memoized
4. `useVisibleSessionListViewData()` hook → SessionsList FlatList

### Memoization safety
- New fields are stable primitives (string|null) — no referential identity churn
- `buildSessionRowData()` is deterministic — same metadata → same output
- `useSessionListViewData()` deep-equal shields against spurious diffs
- **No changes needed to React.memo call**

### Pill row design recommendation
- **Inline `View` + `Text` + `Image`** in SessionItem; no separate file
- Order: flavor → model → permission (LTR)
- Spacing: `gap: 8`, `marginTop: 4` below subtitle
- Height: each pill 20-24px high — total adds ~28px to row
- **Height concern**: current 88px is fixed. Inline single-line pills probably fit but verify; may need bump to ~108-120px or trim spacing elsewhere
- Use `theme.colors.permission[code]` with grey fallback
- Use `numberOfLines={1}` to prevent virtualization breakage

### Model abbreviation
- No helper exists; create local `formatModelCode(code)`:
  - `gpt-5-codex` → last segment if it's a known model name (codex/opus/sonnet/haiku)
  - Otherwise truncate or use raw
- Locate in SessionsList.tsx (component-local)

### Risk areas
1. **Height/virtualization**: FlatList relies on stable row height — verify pills fit at 88px or bump
2. **Permission color conflicts**: `acceptEdits` blue ≈ `status.connecting` blue — pills rendered separately so no overlay conflict
3. **RTL**: app has no RTL handling; assume LTR
4. **Flavor normalization**: `gpt`/`openai` may need mapping to codex icon — reuse `newSessionAgentIcons` directly
5. **SessionItem export**: requires a small refactor to be testable

## Codex Research

Codex highlights (additional value over agents):
- **Don't add new fields to `keyExtractor`** — row identity stays `session-${id}`
- **Don't filter through `modelModeOptions` for `flavor='codex' + plan` test case**: Codex hardcoded modes don't include `plan`, so render raw metadata codes rather than picker-resolved labels
- **Add storage test** asserting `buildSessionRowData` includes new fields — catches the shallow-copy pitfall directly
- Verification commands:
  - `pnpm --filter happy-app test -- SessionsList`
  - `pnpm --filter happy-app test`
  - `pnpm --filter happy-app typecheck`
  - `pnpm -r --if-present typecheck`
- Render row conditionally: only when at least one of flavor/model/permission is present

## Copilot Research

Copilot highlights (additional value):
- **Local picker overrides not included** — `updateSessionPermissionMode()` and `updateSessionModelMode()` in storage.ts deliberately do NOT rebuild `sessionListViewData` (comments confirm). For drawer-parity (metadata-only), this is fine; for "show local unsynced picks immediately" would require extra work — **out of scope for this task**
- Acceptance underspecified: pills should render **raw metadata codes** (matches Codex finding), not picker-resolved display names
- Active vs inactive: active sessions use a separate compact path in `ActiveSessionsGroupCompact.tsx:422` — verify whether pills also belong there or only in the SessionItem code path
- Could optionally normalize flavor in `buildSessionRowData()` to avoid render-time normalization

## Consolidated File List

### Files to modify
- `packages/happy-app/sources/sync/storage.ts` (lines 84-107: SessionRowData interface; lines 109-147: buildSessionRowData)
- `packages/happy-app/sources/components/SessionsList.tsx` (lines 342-463: SessionItem memo; add pill row, helper, styles; export SessionItem for testing)

### Files to create
- `packages/happy-app/sources/components/SessionsList.test.tsx` (new snapshot test file)

### Files referenced (no changes)
- `packages/happy-app/sources/sync/storageTypes.ts` — metadata schema (already has fields)
- `packages/happy-app/sources/components/NewSessionAgentIcons.ts` — flavor icon asset map (reuse)
- `packages/happy-app/sources/theme.ts` — `theme.colors.permission.*` (reuse)
- `packages/happy-app/sources/components/SessionContextDrawer.tsx` — chip styling reference (reuse pattern, don't import private helpers)
- `packages/happy-app/sources/components/ActiveSessionsGroupCompact.test.tsx` — test pattern reference
- `packages/happy-app/sources/components/modelModeOptions.ts` — DO NOT route through this for raw-code render
- `packages/happy-app/vitest.config.mts` — config reference
- `plans/agent-view-research.md` — research source (§6 task)

### Docs to update (per CLAUDE.md preference)
- `plans/agent-view-research.md` — mark `session-role-pill` as completed/in-progress
- `plans/overview.md` (if it exists) — overview tracker
