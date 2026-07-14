# Implementation Plan: PRD C — Codexu Static Release and Installed-Dogfood Tooling
<!-- ralph-meta {"overviewTaskId":"codex-v2-copilot-encrypted-subagent-handoff","uiUxJudgment":"not-required"} -->

*Repository-scoped implementation seed derived from the reviewed parent plan. Consume this file directly with `/implement-with-ralph --from-plan`; do not run the combined parent plan.*

## Overview

Implement only the codexu-owned **static tooling** needed for the release-validation slice of parent US-005, the installed-dogfood-validation slice of US-006, and the closeout-validation slice of US-007. Build a tracked task-local runner, closed evidence schemas, fail-closed phase validator, atomic workflow-state logic, bounded command/bounds templates, and fixture-driven tests.

This execution unit ends with a reviewed local codexu tooling commit and immutable receipt payload. It does not publish, push, tag, release, install, run the real installed dogfood, generate or commit live evidence, modify either gitlink, edit overview shards, unblock Ralph 5.64, or mark the parent task shipped.

## Execution Contract

- **Exact target repository:** `D:\harness-efforts\codexu`
- **UI/UX judgment:** `not-required`
- **Base branch:** current fetched codexu `origin/main`
- **Branch:** `ralph/codex-v2-copilot-encrypted-subagent-handoff-dogfood-tooling`
- **Worktree:** `D:\harness-efforts\codexu\.worktrees\codex-v2-copilot-encrypted-subagent-handoff-dogfood-tooling`
- **Read-only context:** PRD A and PRD B immutable receipts plus the exact nested/wrapper commits they identify.
- **Writable repository:** only the static task-local files listed below.

Create the worktree from fetched codexu `origin/main`; never switch the primary checkout away from `main`. Verify all three repository layers and receipts before editing. Do not stage unrelated generated overview sidecars, plan artifacts, gitlinks, or live dogfood files.

## Immutable Predecessor Inputs and Output Receipt

Required receipts:

- `D:\harness-efforts\codexu\.ralph\jobs\codex-v2-copilot-encrypted-subagent-handoff\receipts\prd-a-nested-source.json`
- `D:\harness-efforts\codexu\.ralph\jobs\codex-v2-copilot-encrypted-subagent-handoff\receipts\prd-b-codex-wrapper.json`

Before any edit:

1. Parse both receipts and compute each SHA-256.
2. Require PRD B's recorded `predecessorReceiptSha256` and PRD A `finalCommitSha` to match the supplied PRD A receipt.
3. Resolve the exact nested and wrapper commit SHAs in their repositories.
4. Require both predecessor scopes/tests/reviews/clean-tree proofs to pass and `pushed == false`.
5. Treat either receipt and both source repositories as read-only. Hard-stop on any mismatch.

On completion, return a receipt payload for the lead to verify and persist at:

`D:\harness-efforts\codexu\.ralph\jobs\codex-v2-copilot-encrypted-subagent-handoff\receipts\prd-c-codexu-tooling.json`

The payload must contain:

- `schemaVersion`, `executionUnit: "PRD-C"`, `targetRepository`, `baseSha`, and `finalCommitSha`;
- both predecessor receipt paths/hashes and their final commit SHAs;
- exact changed files and proof every path is in this plan's static write scope;
- every tooling test/parse command, exit code, and retained project-relative log hash;
- `review.code == "clean"` and `review.docs == "clean"`;
- proof that no generated evidence, gitlink, overview shard, release artifact, installation, or external action occurred;
- clean-tree proof, `pushed: false`, and `completedAt`.

The lead verifies and persists the receipt before any release preparation or installed dogfood.

## Scoped Stories

### C-001 — Static release evidence contract

Maps only to the codexu-tooling slice of parent US-005.

- Define closed schemas for prepublication approval, release receipt, install request/receipt, installed-plugin provenance, runner provenance, acceptance summary, workflow state, and closeout request.
- Validate candidate SHA, nested SHA, three wrapper mirrors, tags, asset digest/layout, approval binding, ordered successful commands, and release-state transitions.
- Reject any release/install progression when fields, hashes, reachability, approval, command results, or state order are missing or inconsistent.

### C-002 — Installed V2 runner and acceptance validator

Maps only to the static-tooling slice of parent US-006 and depends on C-001.

- Track a parameterized task-local copy of the exact V2 quick-plan runner.
- Track bounded command and filesystem-bounds templates with nonsecret role canaries.
- Validate installed Codex `.4`, Ralph 5.64 immutable provenance, runner bytes, pre-`.4` sanitized snapshot integrity, four exact role task names, plaintext message evidence, isolated waits, terminal completion, role ownership, artifacts, transformations, and privacy.
- Command exit `0`, file existence, `Completed(None)`, timeout, blank output, or uncorrelated researcher prose never passes by itself.

### C-003 — Static lead-closeout validation

Maps only to the tooling slice of parent US-007 and depends on C-002.

- Validate the hash-bound `awaiting_lead_closeout` request against the exact wrapper release SHA, acceptance-summary hash, passing evidence checkpoint, and `parentCloseoutAllowed`.
- Implement only validation/state-transition behavior. Do not advance the `codex` gitlink, edit overview data, remove blockers, mark tasks shipped, or create a parent closeout commit.

## Approach

1. Materialize closed JSON Schemas in one versioned schema bundle.
2. Implement a phase-selectable validator with `Release`, `Install`, `Acceptance`, and `LeadCloseout` modes; every missing, unordered, ambiguous, failed, or cross-receipt-inconsistent state exits nonzero.
3. Implement a parameterized runner that verifies tracked bytes/provenance, creates fresh bounded run directories, records parent/four-child evidence, and invokes installed Ralph without mutating installed caches.
4. Implement atomic state transitions:
   `release_published -> awaiting_operator_install -> installed_verified -> dogfood_passed -> awaiting_lead_closeout -> complete`.
   Static tooling may validate/perform transition mechanics in fixtures; real state files remain lead/operator-owned.
5. Add bounded task-local command/bounds templates for the exact quick-plan role run.
6. Add deterministic project-local fixture tests for every passing phase and representative fail-closed condition.
7. Commit only static scripts, schemas, templates, and tests.

## Writable Files

All paths are relative to the exact target repository.

### Create

- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/run-installed-v2-dogfood.ps1`
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/validate-installed-v2-handoff.ps1`
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/evidence-schemas.json`
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/templates/codex-plan.command.json`
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/templates/codex-plan-bounds.json`
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/tests/run-tests.ps1`
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/tests/fixtures/**`

No other file is writable.

### Read-only references

- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/run-installed-skill-dogfood.ps1`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan.command.json`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan-bounds.json`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan.jsonl`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/installed-skill-dogfood-summary.json`
- the two immutable predecessor receipts and commits
- installed Ralph 5.64 manifest/skill bytes for later real-run provenance checks

The primary-checkout reference runner may be untracked. It is source-only reference and must never be invoked or required after this task-local runner is committed.

## Explicit Lead/Operator-Owned Exclusions

These source-plan surfaces are deliberately covered by later lead/operator phases, not silently dropped:

- `plugin-provenance.json`, `runner-provenance.json`, prepublication receipt, `release-approval.json`, `release-receipt.json`, `acceptance-summary.json`
- `workflow-state.json`, `operator-install-request.json`, `install-receipt.json`, `lead-closeout-request.json`
- `installed-version-evidence.*`, `parent-rollout.jsonl`, `children/**`, `artifact-inventory.json`, retained role artifacts/hashes, sanitized `pre-api4-failure-snapshot/**`, and `install-scratch/**`
- the `codex` gitlink
- `.ralph-overview/data.json` and `.ralph-overview/data.archived.json`
- all version bumps, builds, pushes, tags, GitHub Releases, global installs, real dogfood execution, generated evidence checkpoints, blocker removal, and ship bookkeeping

PRD C schemas/validators describe and test these generated artifacts without creating live instances of them.

## Tests and Verification

Use existing PowerShell/Node capabilities; add no new test framework. Tests must use only project-relative fixture/scratch paths and clean them afterward.

1. PowerShell parse validation for both `.ps1` files
2. JSON parse and closed-schema self-validation for `evidence-schemas.json`
3. `pwsh -NoProfile -File .ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/dogfood/tests/run-tests.ps1`
4. Passing fixtures for Release, Install, Acceptance, and LeadCloseout
5. Failing fixtures for missing fields, additional forbidden fields, bad hashes, wrong candidate/version, failed commands, mirror/tag mismatch, stale PATH/vendor inventory, invalid provenance, wrong role set/task names, encrypted Copilot message evidence, timeout/out-of-range elapsed time, duplicate/missing terminal records, blank completion, malformed/empty artifacts, missing researcher correlation, privacy failure, snapshot mutation, and premature/out-of-order transitions
6. Static checks that the runner uses exact role names, nonsecret canaries, exact targeted waits below 600000 ms, fresh run directories, byte verification, and no installed-cache mutation
7. Git diff-scope check proving only the listed static paths changed

Do not run publication, installation, real service dogfood, overview helpers, or closeout commands as tests. On Windows, use `pwsh -NoProfile`, quote all paths, avoid `/tmp`, avoid name-based process termination, and ensure test cleanup never escapes the task-local fixture/scratch root.

## Acceptance Criteria

1. The schema bundle is versioned, closed where contracts are closed, and covers every required release/install/provenance/acceptance/workflow/closeout field from the parent plan.
2. Release validation binds exact nested and approved wrapper candidate SHAs, all three canonical mirror pushes/fetches/ancestry, immutable tags, asset digest/layout, approval hash, ordered successful commands, and published status.
3. Install validation binds the release/request hashes, operator/time/command/exit, npm global entry, PATH order, five-file vendor inventory, asset digest, and exact `codex-cli 0.141.0-copilot-api.4`.
4. Provenance validation requires immutable Ralph source commit plus package digest and byte equality, permitting only the documented deterministic `skills` path rewrite.
5. Acceptance validation requires exactly the four named roles, readable nonsecret plaintext `input_text`, no `encrypted_content`, exact isolated waits with `0 <= elapsedMs < 600000`, exactly one matching completed terminal record, meaningful output, role-specific ownership/artifacts, researcher hash correlation, transformation hashes, and passing privacy/snapshot checks.
6. State transitions are atomic, resume-safe, owner-bounded, and strictly ordered; pauses exit without polling.
7. Lead-closeout validation rejects any request not bound to the exact passing summary, wrapper release SHA, evidence checkpoint, and `parentCloseoutAllowed: true`.
8. Every failure class listed in Tests has a fixture proving nonzero fail-closed behavior.
9. The committed runner/templates are parameterized, task-local, nonsecret, and verifiable by `git ls-files`, `git show`, and SHA-256 before later execution.
10. Only listed static files changed. No live receipt/evidence, gitlink, overview shard, release artifact, install, plugin cache, blocker, or external state changed.
11. A local tooling commit exists on the scoped branch, the worktree is clean, and nothing was pushed.

## Phase 5a / Phase 5b Convergence

- **Phase 5a:** run code review-fix rounds until schema closure, semantic/hash checks, path containment, atomic transitions, privacy behavior, runner byte/provenance checks, and fixture coverage are clean. Re-run the complete tooling test suite after fixes.
- **Phase 5b:** run docs review-fix rounds over script help, schema descriptions, templates, fixture names, operator/lead boundaries, and error text until ownership and resume behavior are unambiguous and clean.

Do not stop at tests-pass. Both review states must be `clean` before the local commit and receipt payload.

## Rollback and Security

Rollback is a local revert of the static tooling commit before it is consumed. The validator must fail closed and never log or retain credentials, tokens, customer data, private source excerpts, or unrelated session content. Raw evidence remains outside Git; only sanitized, scanned, hash-correlated derivatives may later be committed by the lead.

## Open Questions

None. Missing or inconsistent predecessor receipts, source drift, unavailable PowerShell/Node tooling, or unsafe fixture containment is a hard stop.

## Next Step

Run only after PRD B's receipt (and its PRD A chain) is verified and persisted:

`$ralph-orchestration:implement-with-ralph --from-plan .ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/scoped-plans/codexu-dogfood-tooling-plan.md --target-repo D:\harness-efforts\codexu`

Do not push, publish, install, or execute real dogfood. Return the immutable static-tooling receipt for lead-owned release and acceptance phases.
