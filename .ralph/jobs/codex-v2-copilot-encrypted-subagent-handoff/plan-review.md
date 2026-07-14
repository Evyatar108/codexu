### Primary Plan Review

The primary lane found eight actionable issues:

- **Critical — release ownership and wrapper-main correctness.** The implementation member is assigned publication even though the release workflow's `git push origin main` pushes the separate local `main` ref, not the topic branch, and codexu policy reserves main integration/pushes for the lead.
- **High — one-repository-per-PRD violation.** One serial `/implement-with-ralph` handoff still spans nested `codex-patched`, the Codex wrapper, and codexu parent closeout.
- **High — unavailable dogfood runner.** The required runner is absent from the plan worktree. Verification confirmed that its primary-checkout copy is untracked and therefore cannot be reproduced from a clean checkout.
- **High — destructive evidence ordering.** The exact runner overwrites the named `.3` outputs and deletes reused probe directories, so the `.3` failure must be copied, hashed, and committed before the `.4` run starts.
- **High — incorrect artifact ownership.** Installed Ralph 5.64 defines `plan_researcher` as a prose-return child; the parent compiles `research-brief.md`. A blanket “all artifacts child-produced” criterion is false.
- **High — missing integration coverage.** Agent-logic changes require `core/tests/suite` coverage through `test_codex`; unit/router/invariant tests alone do not satisfy the nested repository instructions.
- **High — stale distribution documentation.** `codex/CLAUDE.md`, `docs/workflows/install.md`, and `docs/workflows/developer-guide.md` still describe GitHub Packages while the authoritative release workflow is GitHub-Releases-only.
- **High — non-executable rollback.** The plan does not pin the `.3` asset/digest, install command, V2-disable command/config, or version/PATH/V1 post-checks.

### Codex Host-Lane Review

The Codex-host lane independently confirmed the cross-repository scope problem and missing runner, and added:

- **Critical — unresolved test-command contract.** `codex-patched/AGENTS.md` requires `just test`, requires a complete suite after `codex-core` changes (with operator approval), and prohibits direct `cargo test`; the plan forbids the full suite while `publish-sandbox-patch.md` still invokes direct `cargo test -p codex-copilot-launcher`.
- **High — Ralph 5.64 provenance is not immutable.** A machine-local cache path and `version: 5.64.0` manifest prove a version string, not the source commit/tag or installed-file identity.
- **High — release Step-0 ordering is impossible as written.** Wrapper docs/invariants are changed before a preflight that rejects every tracked wrapper change except the nested gitlink.
- **High — no persisted operator/lead handoff states.** The plan needs durable release-published, awaiting-install, installed, dogfood-passed, and awaiting-parent-closeout receipts.
- **Medium — oversized schema module.** `multi_agents_spec.rs` is verified at 854 lines; adding both policy and wait schema logic conflicts with the large-module guidance unless extracted or explicitly justified.

### Copilot Host-Lane Review

The Copilot-host lane independently confirmed the wrapper-main/tag reachability problem, Step-0 contradiction, and missing operator handoff. It additionally found:

- **Critical — no approval gate before external writes.** Pushes, immutable retention/wrapper tags, account switches, and GitHub Release creation require an explicit operator approval checkpoint before the first external action.
- **High — release reachability is under-specified.** Tag equality alone can pass while `origin/main` remains stale; the release commit must be proven reachable from `origin/main`.
- **High — artifact proof must be role-contract-specific.** Artifact-writing roles need child session plus child write-event evidence, while the prose-return researcher needs child-output-to-parent-brief correlation.
- **Medium — targeted-wait telemetry is incomplete.** Tests must pin one begin/end pair, matching `call_id`, receiver metadata, and final status maps across terminal, timeout, steering, invalid-target, and closure outcomes.
- **Medium — closure semantics are ambiguous.** `AgentControl::get_status()` returns `AgentStatus::NotFound`, and `is_final()` currently treats `NotFound` as final; the targeted branch must turn closure plus `NotFound` into a model-facing error rather than success.
- **Medium — dogfood predicates are subjective.** “Meaningful,” “non-failure contribution,” and timing language need deterministic fields and pass/fail rules.
- **Medium — marker wording is over-broad.** “Exactly one marker family” must apply per changed logical block; one file may legitimately contain both marker families in separate blocks.
- **Medium — archived shard omitted.** `mark-shipped` may move the task from `.ralph-overview/data.json` to `.ralph-overview/data.archived.json`, so both are possible closeout outputs.

### Consensus

All lanes agree the native provider-capability design is feasible and appropriately avoids serialized `ModelProviderInfo`/config/API widening. The shared encoding enum and separate targeted/targetless wait branches remain sound.

Two or more lanes support these plan defects: the one-repo-per-PRD/lead-owned closeout violation; wrapper-main/tag reachability; release Step-0 ordering; missing/untracked dogfood runner; role-specific artifact proof; operator pause/resume state; and exact release/install/acceptance receipts.

Source checks corroborated the reviewers: Ralph's installed 5.64 Codex skill makes `plan_researcher` prose-returning and has the parent write `research-brief.md`; the runner exists only as an untracked primary-checkout file and is absent from the plan worktree; `publish-sandbox-patch.md` permits only the dirty gitlink at Step 0, invokes direct `cargo test`, and pushes local `main`; `get_status()` returns `NotFound` while `is_final()` accepts it; and `multi_agents_spec.rs` is 854 lines.

### Divergences

There is **no Critical reviewer divergence**. The Critical items are plan findings: some are consensus-backed, and the approval/test-contract findings are unopposed and source-verified. Consensus on a Critical finding does not itself imply reviewer disagreement.

Two non-critical perspective differences remain:

- The primary lane correctly rejected blanket child ownership for `plan_researcher`; the Copilot-host lane asked for child write events for each artifact. Installed 5.64 resolves this: use terminal-prose correlation for the researcher, and child write-event evidence only for roles whose contract assigns direct artifact writes.
- The Codex-host lane flagged the 854-line `multi_agents_spec.rs`; the Copilot-host lane reported no simplicity issue. Treat this as a Medium design note: extract V2 schema helpers unless the amended plan documents a concrete ownership reason and line-budget exception.

### Recommended Amendments

1. Split execution into repository-scoped PRDs with explicit `repoDir`, `additionalDirs`, and `writeScope`: nested Rust work, wrapper invariant/docs work, then lead-owned release integration. Keep operator installation and codexu pointer/evidence/overview closeout outside the implementation PRDs. Remove the single serial and parallel handoff commands that imply one job can own all repositories.
2. Add a hard, durable operator approval checkpoint before the first push/tag/release action. Bind approval to version, candidate nested/wrapper SHAs, remotes, tags, and asset name.
3. Make the lead fast-forward the reviewed wrapper topic commit onto wrapper `main`, push `main`, verify `local main == origin/main`, and require `git merge-base --is-ancestor <release-sha> origin/main` before creating/pushing the wrapper tag or release.
4. Reconcile test instructions before implementation: replace direct `cargo test` in the release workflow with `just test`; name the focused and integration commands; and either obtain approval to run the complete `just test` gate required after core changes or amend the authoritative instructions with an explicit focused/CI exception.
5. Commit wrapper invariant/docs changes before release Step 0 (excluding the dirty nested gitlink), then enter Step 0 with wrapper clean except that gitlink and inner source clean. Keep the final nested version commit and final wrapper gitlink release commit ordered explicitly.
6. Make the exact dogfood runner a tracked, commit-pinned prerequisite visible in a clean checkout. Before `.4` execution, copy every `.3` input/output to a versioned snapshot, write a SHA-256 inventory, and commit it; run `.4` into fresh task-local paths and verify the old hashes afterward.
7. Record immutable Ralph 5.64 provenance: source commit/tag/release, installed manifest path/hash, installed Codex skill hash, and equality against the immutable source.
8. Correct role ownership: correlate the `plan_researcher` child terminal prose into the parent-written brief; require child session/write-event evidence for drafter and review artifacts; record parent move/finalization transformations separately.
9. Add named `core/tests/suite` integration tests using `test_codex` for unsupported-provider spawn/send/follow-up and exact targeted wait, with exact `just test -p codex-core --test all <filter>` commands.
10. Persist `release-receipt.json`, `operator-install-request.json`, `install-receipt.json`, and `acceptance-summary.json` with exact schema fields, hashes, commands, actors, timestamps, state transitions, role/wait/artifact evidence, and parent-closeout prerequisites. Installation may start only after the release receipt is durable.
11. Specify targeted-wait telemetry and closure outcomes exactly; define deterministic dogfood predicates; scope marker-family uniqueness per logical block.
12. Update all stale distribution docs, pin an executable `.3` rollback and V1-containment procedure, and include `.ralph-overview/data.archived.json` as a possible helper-owned closeout output.
