# Stories Outline: Ralph V2 Encrypted Role/Wait/Terminal Hardening

*Preliminary source-only decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` after the plan branch is fast-forwarded. Final installed V1/V2 acceptance is a separate lead-owned gate, not a PRD story.*

## US-001: Harden generated V2 delegation and preserve V1

**Description:** As a Ralph maintainer, I want generated Codex delegation recipes to use structural V2 identity and authoritative list state so that encrypted prompts, stale waits, empty completions, or failed children cannot be reported as delegated success.

**UI/UX judgment:** `not-required`

**Relevant files:**

- `plugins/ralph/scripts/codex-lowering.mjs`
- `plugins/ralph/tests/test-codex-generator.mjs`
- `plugins/ralph/tests/test-codex-live-smoke.mjs`

**Acceptance Criteria:**

- [ ] Work runs in an initialized dedicated `ai-developer-toolkit` worktree created from exact `4100a48d`; `48e63c0c` is verified as an ancestor, and neither toolkit `main`, the existing publication worktree, nor the codexu submodule pointer is edited.
- [ ] V2 runtime captures the existing role from plaintext request `arguments.task_name`, then binds successful spawn `output.task_name` to exact `list_agents.agent_name` one-to-one without reading encrypted `arguments.message`; child `agent_path` correlation remains telemetry-only under US-002.
- [ ] V2 executes spawn → list → conditional targetless wait → re-list, skips waiting for already-valid completed children, and re-lists after every wait return including timeout.
- [ ] Only the matched row's nonblank `agent_status.completed` is child output; `Completed(None)`, `last_task_message`, malformed/ambiguous identity, terminal failure, and a timeout whose re-list remains waitable fail closed.
- [ ] Fan-out is all-or-nothing; unrelated/pre-existing rows and partial children cannot satisfy role cardinality.
- [ ] A structured site-contract inventory defines each role/site's required result and artifacts, paths, format/schema, nonblank rule, freshness/run attribution, child provenance, and validator.
- [ ] Required artifacts are fresh, nonempty, structurally valid, and attributable to the required child before downstream work starts.
- [ ] V1 remains a separate `agent_id` → targeted namespaced wait → `status[id].completed` → close flow. Existing single-delegation plaintext markers remain, fan-out gains one stable per-lens marker for telemetry, and the original fan-out task body stays byte-identical after the marker separator; no V2 identity/list semantics enter V1.
- [ ] Every required-child failure stops before local parent substitution. Generator tests pin each affected generated phase and prohibited inline-fallback clause with static negative assertions, plus dynamic failure coverage where available.
- [ ] No new role naming scheme, routing rule, or Claude/Copilot behavior is introduced.

**Dependencies:** None

**Estimated complexity:** large

## US-002: Correct telemetry, artifacts, and the installed-runner contract

**Description:** As a release verifier, I want surface-aware telemetry and hermetic fixtures so that V1 and encrypted-message V2 runs prove the exact child, route, completion, and artifact contract without exposing child response plaintext.

**UI/UX judgment:** `not-required`

**Relevant files:**

- `plugins/ralph/docs/model-routing-dogfood.md`
- `plugins/ralph/tests/test-model-routing-telemetry.mjs`
- Reference only: `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/run-installed-skill-dogfood.ps1`

**Acceptance Criteria:**

- [ ] V2 role correlation uses request `task_name`, exact spawn-output `task_name`, exact child `agent_path`, and one-to-one parent/child binding; encrypted or misleading `arguments.message` has no acceptance value.
- [ ] V1 retains its existing plaintext-marker/`agent_id` correlation surface and exact route/cardinality checks.
- [ ] Every correlated child has exactly one successful `task_complete`, no failed/aborted terminal event, and nonblank `payload.last_agent_message`.
- [ ] Quick-plan telemetry requires exactly `plan_researcher`, `plan_drafter`, `plan_initial_review`, and `plan_review_synthesis`, all requested/effective Sol xhigh; fixer/updater probes keep their exact-one existing routes.
- [ ] Telemetry consumes the structured site-contract inventory and rejects missing, stale, malformed, wrong-owner, duplicate, or partial required artifacts even when the parent exits `0`.
- [ ] Persisted summaries retain safe presence/length/hash/provenance metadata and never child response plaintext.
- [ ] Fixtures cover opaque/encrypted messages, misleading markers, identity mismatch, duplicates/extras, null/blank final messages, wrong routes/surfaces, terminal failure, timeout races, missing/stale artifacts, no-inline-fallback behavior, and V1 positives.
- [ ] The canonical guide defines a one-way mirror contract: the historical codexu runner remains immutable, while the separate lead-owned installed gate copies the corrected canonical runner only into a newly created run directory after hashing all pre-existing evidence.
- [ ] The guide defines exact forced V1/V2 launch arguments, selected-tool-surface assertions, command-record schema, installed manifest/version and published-SHA attribution, unique run IDs, fail-closed exit rules, and before/after SHA-256 preservation of prior failed evidence.
- [ ] PowerShell remains Windows PowerShell 5.1 compatible, UTF-8 without BOM, uses immediate `$LASTEXITCODE`, UTC correlation, `@(...)`, `-LiteralPath`, and one intact V2 inline-table argument after `-c`.

**Dependencies:** US-001

**Estimated complexity:** large

## US-003: Regenerate Codex outputs and update active release documentation

**Description:** As a Ralph release maintainer, I want generated recipes, regression baselines, active documentation, and release gates synchronized with the authored contract so that no stale or hand-edited engine mirror can ship.

**UI/UX judgment:** `not-required`

**Relevant files:**

- `plugins/ralph/.codex-plugin/codex-skills/{brainstorm-with-ralph,implement-with-ralph,multi-model-investigate,plan-with-ralph}/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/{analyze-iteration,convert-to-ralph-prd,review-changes}/SKILL.md`
- `plugins/ralph/AGENTS.md`
- `plugins/ralph/CHANGELOG.md`
- `.claude/skills/release-plugin/SKILL.md`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-4/post-migration-caller-surface.txt`

**Acceptance Criteria:**

- [ ] All seven listed Codex artifacts are regenerated from `codex-lowering.mjs`; generated files are never hand-edited.
- [ ] Generator/static-smoke tests pin list-before-wait, post-wait re-list, valid already-completed skip, terminal/result/artifact failures, all-or-nothing fan-out, V1 preservation, and no parent fallback.
- [ ] `plugins/ralph/AGENTS.md` and the unreleased `5.64.0` changelog entry describe structural V2 identity, list authority, fail-closed completion/artifacts, and the unresolved installed prerequisite without claiming ship success.
- [ ] Release-plugin Step 9 distinguishes source completion from the lead-owned reconcile/publish/install/dogfood/tag/pointer sequence and requires forced V1 and V2 evidence after the Codex prerequisite.
- [ ] The deterministic caller-surface baseline changes only if its owning regression test proves authored drift.
- [ ] All six Ralph manifest/marketplace stamps remain equal at `5.64.0`; any immutable-version replacement is a separate lead decision.
- [ ] Regeneration produces no unrelated Claude/Copilot churn.

**Dependencies:** US-001, US-002

**Estimated complexity:** medium

## US-004: Pass source gates and hand off a terminal local implementation

**Description:** As the source implementation owner, I want all targeted and full Ralph gates green and a reviewed local commit so that the lead can reconcile and publish it without conflating source completion with future installed acceptance.

**UI/UX judgment:** `not-required`

**Relevant files:**

- `plugins/ralph/tests/test-codex-generator.mjs`
- `plugins/ralph/tests/test-codex-live-smoke.mjs`
- `plugins/ralph/tests/test-model-routing-telemetry.mjs`
- `plugins/ralph/tests/test-codex-launch-evidence.mjs`
- `plugins/ralph/tests/test-regression-smoke-phase-4.mjs`
- `plugins/ralph/tests/test-model-routing.mjs`
- `plugins/ralph/tests/test-copilot-generator.sh`
- `plugins/ralph/tests/run.mjs`

**Acceptance Criteria:**

- [ ] Targeted generation, recipe, telemetry, route, launch-evidence, regression, parity, marketplace-policy, and explicit Git Bash tests pass from the dedicated toolkit worktree.
- [ ] `generate-copilot-artifacts.mjs --target=all --check` and `check-copilot-parity.mjs` pass after the final generated diff.
- [ ] The full `node plugins/ralph/tests/run.mjs` suite passes once; expensive output is captured under the Ralph job/toolkit worktree, never a system temporary directory.
- [ ] Review confirms only planned toolkit files changed and no Codex runtime, codexu pointer, job-local runner, unrelated plugin, or source-checkout evidence was modified.
- [ ] The implementation job reaches terminal success with US-001 through US-004 complete and reports “Ralph source complete; installed V1/V2 acceptance blocked.”
- [ ] The local handoff includes exact base/head SHAs, test evidence, generated-file inventory, remaining prerequisite, and no push/tag/publish/install/pointer action.
- [ ] Lead-owned reconciliation with divergent toolkit `main` regenerates and reruns affected gates before publication; this is explicitly outside the implementation commit.

**Dependencies:** US-003

**Estimated complexity:** medium

## Lead-Owned Installed V1/V2 Gate (not a PRD story)

After `codex-v2-copilot-encrypted-subagent-handoff` ships, the lead reconciles the candidate with toolkit `main`, publishes and verifies the required remote SHAs, creates a new evidence run, hashes every pre-existing dogfood file (including the historical runner and older runs), copies the corrected canonical runner only into the new run, refreshes the real installed Copilot/Codex copies, and proves forced V1 and forced V2 separately with that run-local copy. Tagging and the codexu pointer/version-table closeout occur only after both installed gates pass and the pre-existing hash set remains unchanged.
