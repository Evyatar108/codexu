# PRD: Codex Wrapper Invariants, Documentation, and Release Readiness

## Introduction

Implement only the Codex wrapper-owned portion of the approved handoff plan. The job registers and documents PRD A's provider-aware V2 handoff and exact-wait patch, adds a fork-exclusive structural invariant, and makes the release command and GitHub Release workflow statically ready. The nested checkout remains read-only at `6d73e16c44d65ac243834a942d7fab2c3b279221`.

This PRD was authored in autonomous mode with durable `uiUxJudgment=not-required` and PRD-authoring call `uiUxJudgment=not-required`.

## Goals

- Enforce both PRD A source features from a wrapper-owned invariant test.
- Register the patch and replant procedure in the wrapper's authoritative implementation documentation.
- Record the `.3` regression, `.4` behavior, evidence, rollback, and forward-fix policy.
- Correct runtime, install, developer, and release guidance.
- Remove active package-registry publication while retaining GitHub Release bundle publication.
- Preserve the exact external worktree, branch, wrapper base, predecessor receipt, nested source commit, and unstaged gitlink state.

## User Stories

### US-001: B-001 — Register and document the fork patch
**Source story:** B-001

**Description:** As a Codex fork maintainer, I want the provider-aware V2 handoff and exact-wait source changes enforced and documented at the wrapper layer so that future rebases and operators preserve the reviewed behavior.

**UI/UX judgment:** not-required

**Acceptance Criteria:**
- [ ] Create `codex-rs-overlay/codex-invariant-tests/tests/multi_agent_v2_handoff.rs` as one fork-exclusive structural invariant test covering provider capability defaults and the Copilot override, one provider-derived V2 schema/runtime encoding, truthful spawn/send/follow-up communication constructors, the exact subscribe-before-read wait shape, both marker families, and the `multi_agents_spec.rs` maximum of 800 lines.
- [ ] The invariant test fails on missing, duplicate, or conflicting logical-block markers and proves every expected PRD A source seam has exactly one applicable `// SANDBOX PATCH: provider-aware-v2-handoff` or `// SANDBOX PATCH: exact-v2-wait` marker.
- [ ] Update `docs/implementation/patch-surface.md` section 14 with the two reviewed invariants using IDs 76 and 77 unless a fresh probe proves either ID occupied, and add complete section 15 replant instructions.
- [ ] Update `docs/implementation/regression-history.md` with the `.3` opaque Copilot-child and already-final wait failures, `.4` behavior, required evidence, rollback pins, and forward-fix policy.
- [ ] Update `CLAUDE.md`, `docs/workflows/install.md`, and `docs/workflows/developer-guide.md` so runtime/build guidance describes direct GitHub Release tarball installation and the four Codex binaries plus `rg.exe` without reviving package-registry guidance.
- [ ] `just test -p codex-invariant-tests --test multi_agent_v2_handoff`, `bash scripts/audit_invariants.sh`, and `bash scripts/audit_network_calls.sh` exit 0 against nested commit `6d73e16c44d65ac243834a942d7fab2c3b279221`.
- [ ] Only paths in the eight-entry top-level `writeScope` change; `external/repos/codex-patched/**` stays read-only, its inner tree stays clean, and the wrapper gitlink advance remains unstaged.
- [ ] Typecheck passes.

### US-002: B-002 — Make the release workflow statically ready
**Source story:** B-002

**Description:** As a Codex release maintainer, I want the authoritative release command and workflow to be GitHub-Releases-only and candidate-bound so that later lead-owned publication cannot accidentally use stale package-registry paths.

**UI/UX judgment:** not-required

**Acceptance Criteria:**
- [ ] Update `.claude/commands/publish-sandbox-patch.md` to use `just test`, project-relative scratch and evidence paths, canonical `origin`, `work`, and `personal` mirror checks, exact candidate approval, and fast-forward, equality, and ancestry gates before release actions.
- [ ] Update `.github/workflows/publish-npm.yml` to remove package-write permission, registry authentication, and `npm publish` while retaining tag-triggered bundle construction and GitHub Release upload.
- [ ] Remove active GitHub Packages, package-registry alternative, and split-package guidance from active wrapper documentation without performing a version bump, build, push, tag, release upload, installation, or dogfood run.
- [ ] A case-insensitive scan across `.github/workflows/**`, `.claude/commands/**`, `AGENTS.md`, `CLAUDE.md`, and `docs/workflows/**` finds no active `npm publish`, `npm.pkg.github.com`, `packages: write`, `GitHub Packages`, `read:packages`, registry-alternative, or split-package instruction.
- [ ] Structural checks prove `publish-npm.yml` remains a tag-triggered bundle/GitHub Release workflow and `publish-sandbox-patch.md` contains no `/tmp` path and uses all three canonical wrapper mirrors.
- [ ] Only paths in the eight-entry top-level `writeScope` change; `external/repos/codex-patched/**` stays read-only, its inner tree stays clean, and the wrapper gitlink advance remains unstaged.
- [ ] Typecheck passes.

## Functional Requirements

1. FR-1: The wrapper must contain one structural invariant test for both PRD A feature families and their marker/line-count constraints.
2. FR-2: Patch-surface sections 14 and 15 must register the invariants and replant procedure.
3. FR-3: Regression history must capture the `.3` failure, `.4` behavior, evidence, rollback, and forward-fix policy.
4. FR-4: Runtime, install, and developer guidance must describe the current GitHub Release bundle and shipped binaries.
5. FR-5: The release command must use candidate-bound approval, project-relative evidence, `just test`, and canonical mirror gates.
6. FR-6: The release workflow must build and upload the GitHub Release bundle without package-registry permissions, authentication, or publication.
7. FR-7: Active wrapper documentation and workflows must contain no package-registry alternative or split-package publication path.
8. FR-8: The nested checkout is read-only context and the existing wrapper gitlink advance remains unstaged.

## Non-Goals

- No nested Rust source, `Cargo.toml`, or `Cargo.lock` edits.
- No extra worktree creation or deletion.
- No staging or committing the nested gitlink.
- No version bump, build, push, tag, release, upload, installation, or dogfood execution.
- No codexu source, documentation, workflow, overview, or bookkeeping edits outside this Ralph job directory.
- No Ralph implementation execution during PRD materialization.

## Technical Considerations

- Reuse `D:/harness-efforts/codexu/codex/.worktrees/codex-v2-copilot-encrypted-subagent-handoff`.
- Preserve wrapper base `89a6cbea7cd382fa4873b259fb996dcf988a5fdc`.
- Gate future execution on predecessor receipt SHA-256 `46a311b9c6a46972a06d0eb8d3a51de2b52bb49ac4e9e6c579f620bce5753c70`.
- Keep `external/repos/codex-patched/**` read-only at `6d73e16c44d65ac243834a942d7fab2c3b279221`.
- Capture expensive output only in project-relative evidence directories; never use `/tmp`.
- Preserve the wrapper's frozen iteration profile and use `just test`, not direct `cargo test`.

## Success Metrics

- Exactly two Ralph stories map one-to-one to B-001 and B-002.
- The top-level write scope contains exactly eight approved wrapper paths.
- Model-routing and PRD-scope validators exit 0.
- No duplicate worktree or `<job_dir>/worktree` directory exists.
- Materialization leaves wrapper and nested repository state byte-for-byte unchanged.

## Open Questions

None. A predecessor mismatch, repository identity mismatch, occupied invariant ID, or incompatible wrapper/source drift is a hard stop.
