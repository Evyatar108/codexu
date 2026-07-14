Severity: Critical
Category: Ordering
Section: Implementation Strategy 1/5; US-005; Repository rule “Only the lead merges to main”
Description: The plan creates the wrapper worktree on `ralph/codex-v2-copilot-encrypted-subagent-handoff` and assigns publication to the implementation member, but the authoritative `codex/.claude/commands/publish-sandbox-patch.md` Step 4c tags the current topic commit and then runs `git push origin main` (lines 338-344). That command pushes the separate local `main`, not the current topic branch, so the immutable tag/release can reference a commit that was never merged to wrapper main. It also directly violates `AGENTS.md` lines 571-573: members must not push `origin/main`; only the lead merges and pushes. Split the lead-owned wrapper-main integration from publication and specify the exact branch/HEAD checks before creating either immutable tag.

Severity: High
Category: Feasibility
Section: Implementation Strategy 8; Suggested Decomposition; Next Step
Description: The plan correctly states that one Ralph PRD must not own both the Codex wrapper and codexu parent, but then emits one `/implement-with-ralph` invocation (and one `--parallel` handoff) containing US-001 through US-007. `AGENTS.md` lines 1369-1375 explicitly says a dual-repo plan cannot be expressed as one PRD without silently dropping stories and must pause for manual phase ownership or two jobs. The decomposition JSON has no repository-root/owner field that could make US-006/US-007 executable separately. Split wrapper implementation/release and codexu acceptance/pointer closeout into distinct jobs or an explicit lead-owned second phase.

Severity: High
Category: Completeness
Section: Implementation Strategy 7; Files to Create/Modify > Repository C; US-006
Description: The required exact runner `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/run-installed-skill-dogfood.ps1` does not exist in the supplied plan worktree and is untracked in `D:\harness-efforts\codexu`; the runner itself also hardcodes that primary-checkout path (lines 7-11). US-006 depends only on US-005, so a clean implementation checkout has no durable input for AC 17. Add an explicit prerequisite on the task/commit that tracks the runner, or make a tracked, provenance-bound runner part of the lead-owned closeout before dogfood.

Severity: High
Category: Ordering
Section: Implementation Strategy 7; Acceptance Criterion 20
Description: The plan says to rerun the exact runner and preserve the `.3` failure evidence, but does not snapshot that evidence first. `Invoke-CapturedCommand` redirects with `1> $StdoutPath`/`2> $StderrPath`, `Write-Summary` rewrites `installed-skill-dogfood-summary.json`, and `New-RouteProbeRepo` recursively deletes same-name probe directories. Thus rerunning overwrites the named `.3` evidence before the later copy step. Require a pre-run immutable copy plus hashes/inventory, run `.4`, then verify the old hashes before accepting AC 20.

Severity: High
Category: Criteria Quality
Section: Implementation Strategy 7; Acceptance Criterion 19
Description: “All four expected role artifacts … are child-produced” is impossible for the exact installed Ralph 5.64 workflow. In installed `plan-with-ralph/SKILL.md`, `plan_researcher` uses “Output handling (prose)” and returns findings to the parent; Phase 2’s parent then compiles and writes `<STAGING>/research-brief.md`. Require child-produced terminal prose correlated into the parent-produced research brief for `plan_researcher`; retain direct child-artifact ownership only where the installed role contract actually assigns it.

Severity: High
Category: Completeness
Section: Files to Create/Modify > Repository A; Acceptance Criteria 2-9
Description: The plan adds only unit/schema/router tests under `core/src/.../*_tests.rs`, a structural overlay invariant, and reruns the pre-existing capable-provider `core/tests/suite/subagent_notifications.rs`. It adds no new integration test for either unsupported-provider handoff or exact targeted wait. `codex-patched/AGENTS.md` lines 114-116 mandates an integration test for agent-logic changes under `core/tests/suite` using `test_codex`. Add a named integration test and exact `just test -p codex-core --test all <filter>` gate covering the new production tool flow.

Severity: High
Category: Completeness
Section: Files to Create/Modify > Repository B; Acceptance Criterion 11
Description: The plan updates `codex/CLAUDE.md` only for a new confusion point, leaving its current Distribution section saying packages are published to GitHub Packages (`CLAUDE.md` lines 105-115). The authoritative release workflow says GitHub Releases only and explicitly forbids GitHub Packages (`publish-sandbox-patch.md` lines 12-14). AC 11 cannot claim `codex/CLAUDE.md` is current unless this directly related contradiction is corrected alongside `install.md` and `developer-guide.md`.

Severity: High
Category: Criteria Quality
Section: Risk Areas > Release rollback; Acceptance Criterion 22
Description: AC 22 calls rollback “documented and executable,” but the plan supplies no exact `.3` asset/tag/digest, install command, V2-disable command, or post-rollback checks proving the launcher is `.3` and the active surface is V1. “Known `.3` reinstall plus explicit V1 containment” is not autonomously verifiable, especially while the `.3` bundle/evidence is currently untracked. Pin the rollback artifact and digest, spell out the operator-owned reinstall and `features.multi_agent_v2=false` invocation/config path, and require version, PATH, and V1 tool-surface smoke evidence.
