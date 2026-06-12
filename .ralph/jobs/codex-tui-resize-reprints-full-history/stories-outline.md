# Stories Outline: codex-tui-resize-reprints-full-history

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Render committed transcript history in the retained viewport
**Description:** As a Codex user, I want committed transcript history rendered inside the retained TUI viewport so resize redraws the current UI instead of replaying terminal scrollback.
**Acceptance Criteria:**
- [ ] The main chat surface renders committed history from `transcript_cells` in-process.
- [ ] Shared retained-history rendering logic is moved into a small dedicated TUI module.
- [ ] Transcript overlay rendering remains aligned with the committed history model.
- [ ] The main retained transcript stays bottom/tail-focused; full-history scrolling remains delegated to the existing transcript overlay.
- [ ] Typecheck passes
**Dependencies:** None
**Estimated complexity:** large

## US-002: Remove committed-history resize replay
**Description:** As a user resizing the terminal, I want committed history to survive resize without clear-and-replay churn.
**Acceptance Criteria:**
- [ ] The main committed-history path no longer emits finalized cells through terminal scrollback insertion.
- [ ] Resize of committed history becomes a retained repaint path rather than `clear_terminal_for_resize_replay()` plus replay.
- [ ] `render_transcript_once()` and transcript-overlay close no longer reinsert committed history into terminal scrollback.
- [ ] Initial resume replay and thread-switch replay no longer depend on scrollback insertion for committed history presentation.
- [ ] Rollback, backtrack, thread-switch, and stream-consolidation flows remain synchronized with the retained transcript.
- [ ] Typecheck passes
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Lock the seam with tests and patch-surface docs
**Description:** As a fork maintainer, I want regression coverage and patch-surface documentation so the retained-history fix survives rebases.
**Acceptance Criteria:**
- [ ] `codex-tui` tests cover the new retained-history resize behavior.
- [ ] Required snapshots are updated for the user-visible transcript rendering change.
- [ ] `codex/docs/implementation/patch-surface.md` records the new invariant and replant note.
- [ ] Typecheck passes
**Dependencies:** US-002
**Estimated complexity:** medium
