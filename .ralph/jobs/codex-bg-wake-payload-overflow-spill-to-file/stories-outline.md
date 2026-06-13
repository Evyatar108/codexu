# Stories Outline: codex-bg-wake-payload-overflow-spill-to-file

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Tee background output into a session artifact during streaming
**Description:** As a Codex user relying on background shell tasks, I want full background output preserved before truncation so that long-running completions remain recoverable.
**Acceptance Criteria:**
- [ ] A new helper under `core/src/unified_exec/` resolves a sanitized artifact path under `~/.codex/sessions/<conversation>/background-output/`.
- [ ] Streaming writes happen before `HeadTailBuffer` can omit middle bytes.
- [ ] With the feature disabled, no artifact file is created.
- [ ] Typecheck passes
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Surface recovery references in wake notifications and coalesced batches
**Description:** As a Codex user waking back into a completed background task, I want truncated notifications to point at the spilled artifact so that I can recover full output without rerunning the command.
**Acceptance Criteria:**
- [ ] Single-task wake notifications keep the existing `<output>` preview and append `<output_artifact_path>` only when truncation occurred and the spill succeeded.
- [ ] Coalesced background notifications preserve the same optional `<output_artifact_path>` per `<task>` entry instead of dropping it.
- [ ] Notification parsing/coalescing remains backward-compatible for non-spilled tasks.
- [ ] Typecheck passes
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Register the experiment and lock the patch surface with tests
**Description:** As a fork maintainer, I want the spill-to-file behavior clearly gated and documented so that rebases can preserve it safely.
**Acceptance Criteria:**
- [ ] `BackgroundProcessNotification` is exposed as a default-off experimental feature with explicit metadata.
- [ ] Upstream-canonical edits carry `// SANDBOX PATCH:` markers and `docs/implementation/patch-surface.md` gains the matching invariant/replant notes.
- [ ] Unit/invariant coverage is added or updated for the artifact seam, truncation contract, and coalesced notification shape.
- [ ] Typecheck passes
**Dependencies:** US-002
**Estimated complexity:** medium
