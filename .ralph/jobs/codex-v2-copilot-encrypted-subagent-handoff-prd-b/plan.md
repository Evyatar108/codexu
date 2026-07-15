# Implementation Plan: PRD B — Codex Wrapper Invariants, Documentation, and Release Readiness
<!-- ralph-meta {"overviewTaskId":"codex-v2-copilot-encrypted-subagent-handoff","uiUxJudgment":"not-required"} -->

*Repository-scoped implementation seed derived from the reviewed parent plan. Consume this file directly with `/implement-with-ralph --from-plan`; do not run the combined parent plan.*

## Overview

Implement only the Codex wrapper-owned surface for parent US-004 and the static release-readiness slice of US-005. Starting from PRD A's verified immutable nested-source receipt, add the fork invariant test, patch-surface and regression documentation, runtime/build guidance, authoritative release-command corrections, and GitHub-Releases-only workflow cleanup.

This execution unit ends with a reviewed local wrapper commit and immutable receipt payload. It does not modify nested Rust source, stage the nested gitlink, bump versions, build/publish a release, push, tag, install, generate release evidence, mutate codexu, or run installed dogfood.

## Execution Contract

- **Exact target repository:** `D:\harness-efforts\codexu\codex`
- **UI/UX judgment:** `not-required`
- **Base branch:** current fetched wrapper `origin/main`
- **Wrapper branch:** `ralph/codex-v2-copilot-encrypted-subagent-handoff`
- **Wrapper worktree:** `D:\harness-efforts\codexu\codex\.worktrees\codex-v2-copilot-encrypted-subagent-handoff`
- **Read-only nested context:** `external\repos\codex-patched` at PRD A's exact `finalCommitSha`
- **Writable repository:** wrapper-owned files listed below only.

Use the same wrapper context worktree that hosted PRD A. Before editing, verify the wrapper branch/base, pin the nested checkout to the receipt SHA, prove the inner tree is clean, and record the expected wrapper gitlink difference without staging it. Re-probe Invariant IDs 76/77; if occupied, use the next two free IDs without changing their content.

## Immutable Predecessor Input and Output Receipt

Required predecessor:

`D:\harness-efforts\codexu\.ralph\jobs\codex-v2-copilot-encrypted-subagent-handoff\receipts\prd-a-nested-source.json`

Before any edit:

1. Parse the receipt and compute its SHA-256.
2. Require `executionUnit == "PRD-A"`, the exact target repository, `pushed == false`, clean Phase 5a/5b states, passing tests, and a complete changed-file list inside PRD A scope.
3. Resolve `finalCommitSha` in the nested repository and require the effective nested checkout to equal it.
4. Independently verify its diff/marker inventory and clean inner status.
5. Hard-stop on any mismatch; never repair PRD A from this PRD.

On completion, return a receipt payload for the lead to verify and persist at:

`D:\harness-efforts\codexu\.ralph\jobs\codex-v2-copilot-encrypted-subagent-handoff\receipts\prd-b-codex-wrapper.json`

The PRD must not write the receipt into codexu. Its payload must contain:

- `schemaVersion`, `executionUnit: "PRD-B"`, `targetRepository`, `baseSha`, and `finalCommitSha`;
- `predecessorReceiptPath`, `predecessorReceiptSha256`, and PRD A `finalCommitSha`;
- exact changed files and proof each is in this plan's write scope;
- invariant IDs, marker/seam validation, documentation/publication scans, test/audit commands, exit codes, and retained log hashes;
- `review.code == "clean"` and `review.docs == "clean"`;
- clean inner-tree proof, wrapper status proof showing only the allowed unstaged nested gitlink, `pushed: false`, and `completedAt`.

PRD C must not begin before the lead verifies, hashes, and persists that receipt.

## Scoped Stories

### B-001 — Register and document the fork patch

Maps only to parent US-004.

- Add one fork-exclusive structural invariant test covering both source features.
- Register provider-aware handoff and exact wait in patch-surface §14 and §15.
- Record the `.3` failure, `.4` behavior, evidence requirements, and rollback in regression history.
- Add the runtime confusion point and update install/developer guidance.
- Verify every source logical block from PRD A has exactly one applicable marker and the extracted parent module is at most 800 lines.

### B-002 — Make the release workflow statically ready

Maps only to the wrapper-owned release-command/workflow slice of parent US-005.

- Correct `publish-sandbox-patch.md` to use `just test`, project-relative scratch/evidence, canonical `origin`/`work`/`personal` mirror checks, and candidate-bound release ordering.
- Remove package-write permission, registry authentication, and `npm publish` from `publish-npm.yml` while retaining bundle build and GitHub Release upload.
- Remove active GitHub Packages/registry-alternative/split-package guidance from active wrapper documentation.
- Add fail-closed scans proving no active package-publication path remains.

The actual version bump, build, approval, pushes, tags, release upload, receipts, installation, and dogfood remain lead/operator-owned and are not part of B-002.

## Approach

1. Validate PRD A's receipt and exact nested commit without editing it.
2. Add the wrapper invariant test for capability default/override, one-policy schema/runtime plumbing, truthful communication constructors, exact subscribe-before-read wait shape, marker families, and line-count bound.
3. Add §14 Invariants 76/77 (or next verified free IDs) and §15 replant instructions.
4. Update regression history, `CLAUDE.md`, install, and developer guidance.
5. Correct the authoritative release command and GitHub Release workflow before any release work can start.
6. Run invariant tests, audits, active-publication scans, and review convergence.
7. Commit only wrapper-owned files; leave the PRD A gitlink unstaged for later lead-owned release integration.

## Writable Files

All paths are relative to the exact target repository.

### Create

- `codex-rs-overlay/codex-invariant-tests/tests/multi_agent_v2_handoff.rs`

### Modify

- `docs/implementation/patch-surface.md`
- `docs/implementation/regression-history.md`
- `CLAUDE.md`
- `docs/workflows/install.md`
- `docs/workflows/developer-guide.md`
- `.claude/commands/publish-sandbox-patch.md`
- `.github/workflows/publish-npm.yml`

### Read-only references

- `external/repos/codex-patched/**` at PRD A's exact receipt SHA
- `.claude/commands/verify.md`
- `scripts/iteration-env.sh`
- `scripts/audit_invariants.sh`
- `scripts/audit_network_calls.sh`
- `docs/implementation/build-perf.md`
- `docs/implementation/architecture.md`
- `docs/workflows/repo-topology.md`
- `AGENTS.md`

The `external/repos/codex-patched` gitlink is lead-owned integration state and is excluded from this PRD's commit.

## Tests and Verification

Run against the exact read-only PRD A nested commit:

1. `just test -p codex-invariant-tests --test multi_agent_v2_handoff`
2. `bash scripts/audit_invariants.sh`
3. `bash scripts/audit_network_calls.sh`
4. A case-insensitive active-surface scan across `.github/workflows/**`, `.claude/commands/**`, `AGENTS.md`, `CLAUDE.md`, and `docs/workflows/**` for `npm publish`, `npm.pkg.github.com`, `packages: write`, `GitHub Packages`, `read:packages`, registry alternatives, and split-package instructions
5. Structural verification that `publish-npm.yml` retains tag-triggered bundle/GitHub Release behavior and contains no package publication
6. Structural verification that `publish-sandbox-patch.md` uses `just test`, project-relative scratch/evidence, candidate-bound approval, and all three canonical wrapper mirrors
7. Wrapper diff-scope and gitlink-staging checks

Capture expensive output once under a project-relative evidence/log directory. Never use `/tmp`. On Windows, avoid shell path conversion surprises, quote worktree paths, and do not run release binaries that could lock later build outputs.

## Acceptance Criteria

1. The invariant test maps both marker families to every expected PRD A seam, rejects missing/duplicate/conflicting logical-block markers, and verifies `multi_agents_spec.rs <= 800` lines.
2. Patch-surface §14 contains the two reviewed invariants and §15 contains complete replant guidance.
3. Regression history captures `.3` opaque Copilot child/already-final wait behavior, `.4` fixes, evidence requirements, rollback pins, and forward-fix policy.
4. `CLAUDE.md`, install, and developer guidance accurately describe direct GitHub Release tarball installation and the four Codex binaries plus `rg.exe`.
5. No active wrapper instruction or workflow retains GitHub Packages publication/authentication, registry alternatives, split packages, or `npm publish`.
6. `publish-npm.yml` still builds/uploads the tag-triggered GitHub Release bundle but has no package-write permission, registry authentication, or package publication.
7. `publish-sandbox-patch.md` uses `just test`, project-relative evidence, all three canonical mirrors, exact candidate approval, fast-forward/equality/ancestry gates, and no `/tmp`.
8. Invariant tests, both audits, and all static scans pass against PRD A's exact commit.
9. Only listed wrapper files changed; nested source stayed read-only and the nested gitlink is not staged or committed.
10. The local wrapper commit exists, the inner tree is clean, wrapper status contains only the expected unstaged gitlink advance, and nothing was pushed, tagged, released, or installed.

## Phase 5a / Phase 5b Convergence

- **Phase 5a:** run code review-fix rounds on the invariant test and workflow changes until structural coverage, fail-closed scans, target-repo scope, and no-package-publication behavior are clean. Re-run invariant/audit/static gates after fixes.
- **Phase 5b:** run docs review-fix rounds until patch-surface, regression history, runtime guidance, install guidance, developer guidance, release commands, rollback instructions, and mirror/account wording are consistent and clean.

Do not stop at tests-pass. Both review states must be `clean` before the local wrapper commit and receipt payload.

## Rollback and Security

Before release, rollback is a local revert of the wrapper commit. This PRD must preserve the security framing: encryption remains default; Copilot plaintext is capability-selected, not user-selected; no body logging or evidence secret retention is introduced. Documentation must state that plaintext delegated tasks may be present in provider requests and local rollout/history.

## Open Questions

None. Missing/mismatched predecessor evidence, occupied invariant IDs, stale remotes, or incompatible wrapper/source drift is a hard stop.

## Next Step

Run only after PRD A's receipt is verified and persisted:

`$ralph-orchestration:implement-with-ralph --from-plan .ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/scoped-plans/codex-wrapper-plan.md --target-repo D:\harness-efforts\codexu\codex`

Do not push or release. After the lead validates and persists PRD B's immutable receipt, continue with `codexu-dogfood-tooling-plan.md`.
