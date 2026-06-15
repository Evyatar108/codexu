# Stories Outline: Codex Paste Burst Robustness

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Remove first-char hold and make PasteBurst rearmable

**Description:** As a Windows Codex user, I want normal typing to render immediately while paste-like bursts still become buffered paste payloads, so enabling the legacy heuristic does not make ordinary typing feel laggy.

**Acceptance Criteria:**
- [ ] A single ASCII keystroke with `LegacyPasteBurstHeuristic` enabled inserts immediately and does not leave `PasteBurst::is_active()` true solely to wait for a delayed redraw.
- [ ] `PasteBurst` no longer has a hot-path `pending_first_char` behavior for ordinary ASCII typing; if a short prefix later proves paste-like, it is recovered by an explicit retro-capture/rearm path rather than by holding the first char.
- [ ] A fast `h`, `i`, `Enter` sequence still starts/continues a burst and treats Enter as pasted newline rather than submit.
- [ ] Active burst continuation accepts eligible chars/Enter before applying an idle flush, so a late-but-bounded continuation can rearm instead of splitting the paste.
- [ ] `paste_burst.rs` module docs and tests are updated to describe the new states and remove stale pending-first-char claims.
- [ ] `just fmt` and targeted `just test -p codex-tui paste_burst` pass from `codex/external/repos/codex-patched/codex-rs`.

**Dependencies:** None

**Estimated complexity:** large

## US-002: Integrate robust slow-paste behavior in ChatComposer

**Description:** As a Windows Codex user pasting multiline text through a slow terminal or PTY, I want the whole payload to land as one paste group without any pasted Enter submitting early, so large prompts are not truncated.

**Acceptance Criteria:**
- [ ] `handle_input_basic_with_time()` no longer flushes an active burst before offering a burst-eligible current char/Enter to the state machine.
- [ ] A simulated slow multiline non-bracketed paste with inter-event gaps greater than the old Windows 60ms idle timeout but inside the new rearm window flushes as one paste payload.
- [ ] A simulated large slow paste above `LARGE_PASTE_CHAR_THRESHOLD` creates exactly one placeholder and one `pending_pastes` entry containing the complete payload.
- [ ] Pasted Enter never produces `InputResult::Submitted` while the burst is active or within the rearm/submission-protection window.
- [ ] Slash-command context still bypasses paste Enter suppression for real slash command dispatch.
- [ ] Non-char keys still flush buffered paste before applying the unrelated key.
- [ ] `disable_paste_burst` still bypasses the heuristic and explicit `TuiEvent::Paste(String)` behavior is unchanged.
- [ ] `chat_composer.rs` docs and affected tests are updated, including the former pending-first-char disable test.
- [ ] `just test -p codex-tui chat_composer` passes from `codex/external/repos/codex-patched/codex-rs`.

**Dependencies:** US-001

**Estimated complexity:** large

## US-003: Register fork patch surface and verification

**Description:** As a fork maintainer, I want the upstream-canonical paste-burst edits recorded with rebase anchors and invariant tests, so the next Codex upstream rebase preserves the robustness fix intentionally.

**Acceptance Criteria:**
- [ ] Every upstream-canonical logic edit introduced for this fix has an adjacent `// SANDBOX PATCH:` marker unless it is purely test/doc text.
- [ ] `codex/docs/implementation/patch-surface.md` gains a separate "paste-burst robustness" entry, distinct from the already-shipped default-flip entry.
- [ ] Patch-surface invariant table gains a row naming the focused tests that enforce no first-char lag and no slow multiline early-submit/split regression.
- [ ] The rebase replant notes mention the exact files and tests to re-apply after an upstream conflict.
- [ ] If a grep guard is added to `codex/scripts/audit_invariants.sh`, it is narrowly scoped to the new SANDBOX PATCH marker(s) and does not duplicate the behavioral Rust tests.
- [ ] Final local validation includes `just fmt`, `just test -p codex-tui paste_burst`, `just test -p codex-tui chat_composer`, and `just fix -p codex-tui`.

**Dependencies:** US-002

**Estimated complexity:** medium
