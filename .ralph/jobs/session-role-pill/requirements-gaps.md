# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | Feature request explicitly names target component, fields, and pill shape (icon + abbreviated model + colored permission badge) |
| Scope | partial | [INFERRED] Scope limited to `SessionsList.tsx::SessionItem` and the upstream `SessionRowData` projection in `storage.ts` (research confirms two fields missing from row data). Active-session compact path (`ActiveSessionsGroupCompact.tsx`) is **out of scope** — the feature request only names `SessionsList.tsx:342-463`. |
| Criteria | partial | [INFERRED] Acceptance test: vitest snapshot of `SessionItem` named export with `flavor='codex' + currentModelCode='gpt-5-codex' + currentPermissionModeCode='plan'`. Snapshot must show three distinct pill elements. Pills render raw metadata codes (not picker-resolved labels) — confirmed by Codex+Copilot research because Codex hardcoded modes don't include 'plan'. |

## Remaining Open Questions
1. **Row height**: current SessionItem is fixed at 88px. Inline single-line pills should fit; if not, bump height to ~108px. Resolve during implementation via snapshot inspection.
2. **Active sessions compact view**: `ActiveSessionsGroupCompact.tsx` is a separate rendering path for active sessions. Decision: out of scope for this PR — file path and acceptance criteria in feature request point only at the inactive `SessionItem` path. Document as a follow-up.
3. **Flavor normalization**: `metadata.flavor` may contain `gpt` or `openai` (see `app/(app)/session/[id]/info.tsx`). Decision: use `newSessionAgentIcons` direct key lookup with fallback to claude/null. Don't add a normalization helper in this PR.
