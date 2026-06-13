# Stories Outline: Codex patch-surface divergence registry refresh

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Re-baseline the maintained registry line
**Description:** As a rebase operator, I want the divergence ledger to reflect the maintained `.5` release line and only live divergences so that I do not replay retired patches.
**Acceptance Criteria:**
- [ ] `patch-surface.md` header/date reflect the maintained `0.135.0-copilot-api.5` / `rust-v0.135.0` line
- [ ] Every stale paste-burst instruction is removed or corrected, including the duplicate registry section, the conflict-resolution guide note, and `codex/CLAUDE.md`
- [ ] Feature-bookkeeping notes use `Feature::...` enum variants and keep Knob A / Knob B out of the feature set
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Register the undocumented `.4` patch families
**Description:** As a rebase operator, I want the recent `.4` fork seams represented in section 14 and section 15 so that upstream merges can replant them mechanically.
**Acceptance Criteria:**
- [ ] Focus leak, BG exec-cell rendering, Knob A, Knob B, and managed-hooks families each gain section 14 + section 15 coverage
- [ ] Each family names the exact source seam(s) and a focused verification hook
- [ ] Existing numbering is preserved by appending new invariant rows
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Register the maintained `.5` families and add marker anchors
**Description:** As a rebase operator, I want the maintained `.5` TUI/source-marker gaps closed so that the next release line can be replayed without source archaeology.
**Acceptance Criteria:**
- [ ] Agent-name display, `/resume` DB-only first page, retained committed-transcript viewport, and focus-leak recurrence each gain section 14 + section 15 coverage
- [ ] `tool_lifecycle.rs`, `multi_agents.rs`, and `resume_picker.rs` gain the expected `SANDBOX PATCH` anchors at the named functions/blocks
- [ ] Other `.4` / `.5` families stay registry-only unless a grep proves they still lack markers
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: Lock the guardrails and ship notes
**Description:** As a maintainer, I want focused audit hooks and branch-target guidance so that future rebases and release prep cannot silently regress the refreshed registry.
**Acceptance Criteria:**
- [ ] `audit_invariants.sh` gains the focused marker/drift checks the refresh requires
- [ ] `bash -n scripts/audit_invariants.sh` and `bash scripts/audit_invariants.sh` are the explicit verification commands
- [ ] The implementation notes name the dedicated branch base and preserve the two-commit submodule flow
**Dependencies:** US-003
**Estimated complexity:** small
