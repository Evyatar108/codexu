Severity: High
Category: Ordering
Section: Suggested Decomposition > US-005; Acceptance Criteria 20-23; Next Step
Description: US-005 is a prerequisite-blocked, lead-owned release gate, but the plan still places it in the source implementation story set and then tells the implementation run to complete only US-001 through US-004 and report US-005 blocked. That job cannot reach a clean Ralph terminal state while an in-scope story is intentionally blocked, and its actor is forbidden to perform US-005's push/install actions. Remove US-005 and its installed-host criteria from the source PRD. Make the reviewed local implementation commit the source job's terminal deliverable, then track installed V1/V2 acceptance as a separate release task/handoff after `codex-v2-copilot-encrypted-subagent-handoff`.

Severity: High
Category: Feasibility
Section: Files to Modify > External acceptance runner mirror; Implementation Strategy 7; US-004
Description: `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/run-installed-skill-dogfood.ps1` is outside the `ai-developer-toolkit` target repo and is currently untracked and unignored in codexu. A single-repo toolkit Ralph job cannot modify or commit that file, so treating the job-local mirror as a toolkit implementation edit is not implementable. Either commit a canonical runner in `ai-developer-toolkit` and use the codexu path only for lead-owned evidence, or create a separate codexu-scoped job/change. The source plan should identify the external file as read-only reference unless that split is made.

Severity: High
Category: Ordering
Section: Overview; Approach > Architecture, Stage B; Out of Scope
Description: The release dependency is inverted. The plan says pushing, publishing, and installing wait until after the final installed-host gate, but that gate can only exercise the corrected candidate after the lead publishes and verifies it and refreshes the real installs. The canonical `.claude/skills/release-plugin/SKILL.md` contract is: reviewed local handoff, lead integration onto the publication branch, push `origin` and `gim-home`, verify their SHAs, refresh installed Copilot/Codex copies, run installed telemetry, then tag and update the codexu pointer/version table. State that exact split; do not use “land” ambiguously for both a local candidate commit and remote publication.

Severity: High
Category: Feasibility
Section: Technical Constraints 1; Implementation Strategy 1; release handoff
Description: The exact candidate `4100a48d` and toolkit `main` are divergent, not fast-forward related. Local `main` contains `267e7cd7` (`feat(ralph): route work by UI/UX judgment`), which changes the same lowerer, generated Ralph artifacts, telemetry guide, manifests, and release skill. Meanwhile `--publish-existing` requires the prepared candidate to be on the default publication branch (`main`) before it pushes. The plan explains how to branch from `4100a48d` but never how the lead reconciles that branch with `267e7cd7`; a direct FF to current main is impossible. Add an explicit lead-owned merge/rebase-and-review prerequisite, including regeneration and rerunning the affected tests after conflict resolution, before publication.

Severity: High
Category: Completeness
Section: Implementation Strategy 7; Acceptance Criteria 21-23
Description: “Explicit V1 and V2 runner paths” is not an executable external-runner contract. Specify the exact command/configuration that forces V1 and V2, the assertion that proves the expected tool surface was actually selected, installed manifest/version and published-SHA attribution, stable non-overwriting evidence names/schema, command-record requirements, and fail-closed exit conditions. Without those details both invocations can silently select the same surface while still producing plausible role counts. The contract must also preserve the intact V2 inline-table argv value and distinguish source-checkout output from admissible installed-host evidence.

Severity: High
Category: Criteria Quality
Section: Technical Constraints > required artifacts; Implementation Strategy 2-4; Acceptance Criteria 7, 9, 13, and 17
Description: “The site-declared output/artifact contract” is underspecified. The current lowerer has coarse contracts such as `review-meta`, `artifact`, `text`, and JSON, but the plan never inventories each dispatch site, role, required path, format/schema, freshness rule, and owning child. Consequently an implementer cannot know which generated recipes need artifact checks, and the tests cannot objectively prove all current single/fan-out sites or the no-parent-substitution rule. Add a source-of-truth matrix mapping every lowering call site to its generated files and exact result/artifact contract, including child provenance, nonblank/schema validation, and stale/pre-existing artifact rejection.
