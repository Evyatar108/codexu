# Stories Outline: codex patch-surface divergence registry refresh

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Audit and anchor inner source markers

**Description:** As a codex rebase operator, I want every live fork seam in the inner `codex-patched/codex-rs` checkout to carry a clear `// SANDBOX PATCH:` marker so the next upstream rebase can replant patches without silent drops.

**Acceptance Criteria:**

- [ ] `tui/src/chatwidget/tool_lifecycle.rs` is re-verified and receives marker anchors for agent-name display seams if still live.
- [ ] `tui/src/multi_agents.rs` is re-verified and receives marker anchors for agent-name display seams if still live.
- [ ] `tui/src/resume_picker.rs` is re-verified and receives marker anchors for DB-only first page + lazy reconcile seams if still live.
- [ ] Zero-marker production files changed between `.5` and `.8` are reviewed by hunk; each fork-owned seam is marked or explicitly documented as not requiring a marker.
- [ ] Already marker-bearing production files changed between `.5` and `.8` are spot-checked for new unanchored fork hunks.
- [ ] No behavior changes are made.
- [ ] Inner marker edits are committed inside `codex/external/repos/codex-patched`.
- [ ] The chosen inner branch/commit is suitable for the wrapper's `external/repos/codex-patched` gitlink, whose tracked branch is `sandbox-patches`.

**Dependencies:** None

**Estimated complexity:** medium

## US-002: Refresh patch-surface header and release ledger

**Description:** As a codex rebase operator, I want `patch-surface.md` to name the current `.8` maintained base and enumerate the `.6/.7/.8` patch families so I can prepare the `.139` rebase from accurate source-of-truth docs.

**Acceptance Criteria:**

- [ ] Header says `0.135.0-copilot-api.8` and upstream base `rust-v0.135.0`.
- [ ] Release evidence includes inner `.6/.7/.8` commits from `6f0137db45` through `1b1348cb06` and wrapper tags through `v0.135.0-copilot-api.8`.
- [ ] Registry rows are added, updated, or explicitly folded for fast resume history paint, experimental-feature migration, retained transcript typing lag, Copilot prompt context budget, Windows console input self-heal/tracer, feature-gate visibility, Windows Git Bash shell, background wake artifact spill, and retained viewport no-eviction.
- [ ] Stale `.5` language is removed or corrected.

**Dependencies:** US-001

**Estimated complexity:** large

## US-003: Update invariants, replant notes, and audit guard references

**Description:** As a codex rebase operator, I want section 14 invariant rows, section 15 replant notes, and audit guard references to match the marker decisions and current fork feature set so validation and rebase instructions stay aligned.

**Acceptance Criteria:**

- [ ] Section 14 maps each through-.8 patch family to an existing or new invariant/test/grep guard.
- [ ] Section 15 contains replant notes for each through-.8 family that needs manual rebase action.
- [ ] The paste-burst row is corrected to `Feature::LegacyPasteBurstHeuristic` and no longer tells operators to reapply a direct `unwrap_or(true)` seam.
- [ ] The feature-gate set is recorded: `AnthropicModels`, `AutoLoadClaudeMd`, `LegacyPasteBurstHeuristic`, `UserMessageStyling`, `ManagedHooks`, `WindowsGitBashShell`, `McpServerNotifications`, and `BackgroundProcessNotification`.
- [ ] `scripts/audit_invariants.sh` is updated only if a new grep guard is required.

**Dependencies:** US-001, US-002

**Estimated complexity:** large

## US-004: Validate and prepare handoff

**Description:** As a codex rebase operator, I want the completed refresh to pass the wrapper audits and preserve a clean two-commit handoff so the lead can merge the codex wrapper and later bump codexu pointers safely.

**Acceptance Criteria:**

- [ ] `bash scripts/audit_network_calls.sh` result is recorded.
- [ ] `bash scripts/audit_invariants.sh` result is recorded.
- [ ] `cargo check --workspace` is skipped only if source changes are marker-only comments; if logic/config/schema changes occur, the relevant Rust validation is run.
- [ ] Inner submodule commit and wrapper commit are both identified in the report.
- [ ] Wrapper commit includes the `external/repos/codex-patched` gitlink bump to the inner marker commit, or the report explicitly states lead-approved deferral.
- [ ] No codexu root `CLAUDE.md` or unrelated generated files are staged.

**Dependencies:** US-001, US-002, US-003

**Estimated complexity:** medium
