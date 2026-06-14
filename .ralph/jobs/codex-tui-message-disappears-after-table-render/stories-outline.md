# Stories Outline: Retained Transcript Viewport Table Tail Fix

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Add the retained viewport regression
**Description:** As a Codex TUI user with `retained_transcript_viewport` enabled, I want a tall active table or paste tail to keep the immediately preceding committed message visible so that the live chat does not appear to lose my prompt or prior context.
**Acceptance Criteria:**
- [ ] A retained-viewport regression test renders committed context plus a tall active table-like tail.
- [ ] The test fails against the current active-first allocation policy because the preceding committed cell is fully evicted.
- [ ] The test asserts the rendered output contains identifiable text content from the preceding committed message, not only a separator or blank reserved row.
- [ ] The test is colocated with existing retained viewport tests in `codex\external\repos\codex-patched\codex-rs\tui\src\app\tests.rs`.
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Reserve pinned committed context in retained viewport rendering
**Description:** As a Codex TUI user with retained viewport enabled, I want the renderer to reserve a minimum committed-cell band before tall active content consumes the viewport so that recent committed context cannot silently disappear.
**Acceptance Criteria:**
- [ ] `RetainedTranscriptViewportRenderable` reserves enough rows to render readable text from the most recent committed cell when committed cells and an active cell both exist.
- [ ] The active tail is bottom-clipped when necessary rather than receiving 100 percent of the content area.
- [ ] Older committed cells may still be tail-windowed or clipped; the fix only guarantees recent committed context.
- [ ] `visible_height()` applies the same committed-reservation policy as `render()` so the height prepass and actual render geometry agree.
- [ ] The non-retained render path is unchanged.
- [ ] `Feature::RetainedTranscriptViewport` remains experimental and default-off.
- [ ] The edit stays inside SANDBOX PATCH retained viewport code, with no changes to markdown/table rendering or generic history-cell measurement.
- [ ] New or modified retained-allocation lines carry a `// SANDBOX PATCH:` marker identifying the no-eviction reservation invariant.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Register the retained viewport invariant and verify
**Description:** As a fork maintainer, I want the patch-surface registry and local verification to cover this retained viewport invariant so that future rebases preserve it.
**Acceptance Criteria:**
- [ ] `codex\external\repos\codex-patched\docs\implementation\patch-surface.md` documents the retained viewport no-eviction invariant and the new enforcing test.
- [ ] The plan's verification commands are run from the canonical inner checkout, not a codexu plan worktree.
- [ ] `cargo check -p codex-tui` passes from `D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs`.
- [ ] The targeted retained viewport regression test passes.
- [ ] The existing `retained_transcript_main_view_tail` snapshot remains unchanged; any new or changed snapshot is reviewed and accepted intentionally.
**Dependencies:** US-002
**Estimated complexity:** small
