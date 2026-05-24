# code-review-context — session-role-pill

Patterns and conventions confirmed while reviewing the session-role-pill diff.

## Codebase conventions observed

- **`expo-image` size MUST be inline, not in unistyles** — `packages/happy-app/CLAUDE.md` "Expo Image" section. The PR honors this (`{ width: 12, height: 12 }` on the flavor pill Image at SessionsList.tsx:521-525).
- **Unistyles `StyleSheet.create((theme) => ({...}))` at end of file** — packages/happy-app/CLAUDE.md "Always put styles in the very end of the component or page file". PR adds the three new style entries (`sessionRolePillRow`, `sessionRolePill`, `sessionRolePillText`) inside the existing stylesheet block at lines 178-201, before `statusRow`.
- **Theme access inside `React.memo` components** uses `const { theme } = useUnistyles()` (not the prebuilt sheet's closure theme). PR added this at SessionsList.tsx:421 to feed `permissionColorForCode(permissionCode, theme)`.
- **Permission color lookup is the F-001 plan-review trap** (resolved): theme keys are `bypass`/`readOnly`/`safeYolo` but metadata codes are `bypassPermissions`/`read-only`/`safe-yolo`. The pattern is the explicit switch helper modeled after `AgentInput.tsx:1387-1396`. PR's `permissionColorForCode()` (SessionsList.tsx:44-63) translates correctly.

## Cross-cutting relationships

- `SessionRowData` is the storage projection consumed by `SessionItem` and other rows. Two new optional fields (`currentModelCode?: string | null`, `currentPermissionModeCode?: string | null`) at storage.ts:90-91 are populated from `session.metadata?.currentModelCode/currentPermissionModeCode` at storage.ts:134-135 — no consumer of `SessionRowData` is broken because both fields are optional.
- `newSessionAgentIcons` (NewSessionAgentIcons.ts) is the canonical flavor→png map keyed on `codex`/`claude`/`openclaw`/`gemini`. There is no `gpt`/`openai` entry; the plan explicitly accepts the fallthrough (plan.md:36, :186, :194, :240) as a documented v1 limitation. The two external reviewers (Codex+Copilot) flagged this as a defect; per the plan's own clarifying language it is intentional.
- The `plan` permission code resolves to `theme.colors.permission.plan = '#34C759'` (light theme) — verified in `theme.ts:143`. The PR's snapshot pins this color on the permission pill (snapshot line 645).

## Test infra gotchas

- Vitest evaluates `SessionsList.tsx` at import time under the node runner. The mock list in `SessionsList.test.tsx` must cover **every** module-scope import; the iteration agent landed all 25 mocks (react-native, unistyles, safe-area, reanimated, expo-image/router/store-review, all `@/*` component/hook/util imports). The test file uses `await import('./SessionsList')` after `vi.mock(...)` declarations to honor the mock-hoist contract.
- `@/sync/storage` mock only stubs `useSettingMutable` because `SessionRowData` is a type import — no runtime value of `storage` is needed.
- `react-native` mock stubs `Platform.select` and `StyleSheet.hairlineWidth` because both are referenced at module-scope by sibling imports.

## Reviewer disagreement notes (for the orchestrator)

Both Codex and Copilot flagged "unknown flavor codes (gpt/openai) silently drop the flavor pill" as a Medium correctness/completeness issue. Plan.md explicitly documents this as a v1 limitation (lines 36, 186, 194, 240) and the implementation matches the plan. This is a plan-language ambiguity ("with a fallback" in line 27 was interpreted differently by the external reviewers vs the planner) rather than a real defect. Do not promote this to a fix in iteration 2 unless product wants the v1 fallthrough closed.
