# Plan Review: Codex Core-Change Tiered Verification

## Review basis

- Full D-001 brainstorm Markdown and JSON
- Full `measurements.json`
- Task plan seed in `.ralph-overview/data.json`
- Current Codex wrapper `3ff55692e` and patched Codex `587a6a8ab8`
- `scripts/measure-build.ps1`
- `scripts/iteration-env.sh`
- `CLAUDE.md` and `AGENTS.override.md`
- Rebase/publish commands
- Build-perf and workflow runbooks
- Cargo workspace/package metadata
- Current invariant-check workflow and script-test conventions
- Active Codex worktree conflict scan
- Review route: GPT-5.6 Sol self-review; no direct child/review agent delegated

## Phase-4 findings resolved

1. **Package-selection ambiguity:** The brainstorm named an affected package
   but did not define how it is selected. The plan now requires repeatable
   exact Cargo package names, validates only workspace members through Cargo
   metadata, and deliberately rejects filename/path inference.
2. **Shell metadata-parsing risk:** A pure shell implementation would require
   undeclared `jq` or brittle TOML parsing. The plan uses a dependency-free
   Node planner behind the requested shell command and exposes pure functions
   for fast tests.
3. **Runnable-tier ambiguity:** Building only `codex-core.exe` leaves the
   launcher stale. T3 now builds both `codex-cli/codex-core` and
   `codex-copilot-launcher/codex`.
4. **Publish-tier drift risk:** The plan preserves the existing four-binary
   publish command and existing runbook-owned environment, adds fail-closed
   preflight, and forbids a <=10-minute claim.
5. **Threshold over-generalization:** The measured 120s/30s/600s budgets apply
   to named benchmark classes, not every package, machine, or cold target.
   Budget enforcement is explicit and separate from Cargo correctness.
6. **Probe contamination risk:** The plan defines clean-repository preflight,
   full-file hashes, exact byte replacement, in-memory byte/mtime/attribute
   snapshots, `finally` restoration, and post-restore hash/git checks.
7. **Slow-CI risk:** Command/metrics tests use fake tools and tracked evidence.
   T3/T4 are tested by exact argv and null-threshold assertions, not real
   31m/58m CI builds.
8. **sccache display-path bug scope:** Normalization now covers escaped
   backslashes, forward slashes, case, quotes, CR, MSYS drive form, and
   trailing separators without unsafe escape interpretation.
9. **Cross-repository ownership:** Codex implementation remains one write root.
   Parent gitlink, overview archive, and final shipped bookkeeping are
   explicitly lead-owned closeout steps.
10. **Live conflict surface:** Active branch
    `ralph/codex-sandbox-setup-vendoring` changes the publish runbook in
    disjoint hunks. The plan requires implementation to start after/rebase onto
    that result rather than overwrite it.
11. **Phase-5 naming collision:** The plan explicitly distinguishes the Codex
    rebase T2/Phase-5a workspace gate from Ralph Phase 5a code review and Phase
    5b docs review.
12. **Stale cache-wipe premise:** The plan commits healthy-cache evidence,
    changes docs to require reproducible cache errors, and archives the old
    task instead of deleting history or clearing the cache.
13. **Placement/edit-budget omission:** The plan now records the rejected
    upstream/overlay seams, selected wrapper-only seam, zero
    upstream-canonical edits, estimated implementation/test size, and
    near-zero upstream re-conflict probability.
14. **Plan-mode/preflight ambiguity:** T3/T4 exact argv must remain testable
    without a prepared slow-build environment, while execution must stay
    fail-closed. The plan now requires plan JSON to report
    `preflight.ready/issues`, permits blocked plan inspection, and forbids
    execution or measurement when preflight is not ready.

## Operational note

`node tools/data-edit.mjs --help` currently fails because the installed
ralph-overview plugin cannot load `@babel/parser`. This is not a Codex
implementation blocker: closeout can repair/update the plugin, use a
dependency-complete in-tree plugin root, or use the equivalent MCP write
tools. The plan does not permit raw overview text edits as a workaround.

## Verdict

Phase-4-ready. Six serial stories, fourteen findings resolved, no open design
decision, and no implementation blocker. D-001 remains wrapper-only with near
zero upstream-canonical conflict. The separate-target `dev-small` runnable A/B
is explicitly deferred.
