# Implementation Plan: Codex Core-Change Tiered Verification
<!-- ralph-meta {"overviewTaskId":"codex-rs-core-change-incremental-build-over-30m","uiUxJudgment":"not-required"} -->

*Generated from measured direction D-001 on 2026-07-10. Ready for `/implement-with-ralph --from-plan .ralph/jobs/codex-rs-core-change-incremental-build-over-30m/plan.md --autonomous` after the lead fast-forwards this plan branch.*

Plan provenance: codexu worktree
`D:\harness-efforts\codexu\.worktrees\plan-codex-core-build-perf`, branch
`ralph/plan-codex-rs-core-change-incremental-build-over-30m`, base
`65af5ae059e25f35ffb3b22f84c6567e717fede4`.

## Overview

The 30+ minute symptom is a warm optimized executable rebuild after a
`codex-core` edit, not the required local type-verification gate:

| Scenario | Measured wall time | D-001 disposition |
|---|---:|---|
| Targeted no-op check | 6.254s | Canonical T1 freshness check; <=30s acceptance |
| Warm private `codex-core` edit, targeted check | 37.45s | Canonical T1 edit loop; <=120s acceptance |
| Warm high-fanout edit, workspace check | 338.829s (5m38.829s) | Canonical T2 Phase-5a/pre-commit gate; <=600s acceptance |
| Warm changed-core runnable iteration build | 1845.745s / 1850.607s (~31m) | Explicit T3 slow tier; no <=10m promise |
| Historical thin-LTO publish build | 3480s (~58m) | Explicit T4 slow tier; no <=10m promise |

D-001 operationalizes the already-fast check path instead of changing Rust
features, profiles, crate boundaries, or production source. It adds one
fail-closed tier command, extends the existing measurement wrapper, fixes the
Windows sccache path-equivalence bug, synchronizes agent/runbook guidance, and
archives the stale unconditional cache-wipe task after measured healthy-cache
evidence is committed.

This is non-UI build tooling. Implementation and every direct Phase 5 review
must use `gpt-5.6-sol`; never use GPT-5.5, an implicit/default model, or Opus.

## Measured Basis and Decisions

### Repository state measured

- Codex wrapper: `3ff55692e7045e85ce78ebe8337ab40b55494c9c`
- Patched Codex: `587a6a8ab8948ff912b1f24a62833b277934302d`
- Toolchain: Cargo 1.95.0, rustc 1.95.0, LLVM 22.1.2, sccache 0.15.0
- Cache: `D:\codex-sccache`, approximately 10.52 GiB / 11,852 files
- Initial check cache evidence: 1,005 hits, 362 misses, 180 non-cacheable,
  zero cache read/write/timeout/other errors
- Release invalidation after either private or public core edits: 25 package
  IDs, 0 hits, 25 misses, 1 non-cacheable, zero cache errors

### D-001 decisions

1. **Verification and runnable output are different contracts.** T1/T2 answer
   "does this Rust change type-check at the required scope?" T3 answers "do I
   need a runnable locally changed binary?" T4 answers "is this a
   publish-equivalent release build?" No tier silently escalates to another.
2. **Targeted package selection is explicit.** T1 accepts repeatable exact
   Cargo package names. It does not infer a package from arbitrary changed
   filenames, path substrings, directory names, or `git diff`.
3. **Package validation is metadata-backed and fail-closed.** The command
   filters `cargo metadata --no-deps --format-version 1` packages through
   `workspace_members`, requires an exact unique package name, and exits before
   `cargo check` for missing, external, ambiguous, or invalid packages.
4. **No tier is the implicit default.** The caller must name
   `targeted|workspace|executable|publish`. T3/T4 also require
   `--confirm-slow` before execution.
5. **The runnable iteration command builds both main binaries.** T3 uses
   `-p codex-cli --bin codex-core -p codex-copilot-launcher --bin codex`, so
   the resulting workspace remains invocable through the launcher.
6. **The publish command remains the existing four-binary release build.**
   T4 validates the publish environment prepared by the publish runbook and
   runs the existing exact command; it does not promise <=10 minutes and does
   not silently rewrite the profile.
7. **Thresholds are evidence/acceptance budgets, not correctness substitutes.**
   Cargo failures always fail. Wall-time budgets are enforced only by an
   explicit measurement expectation, so ambient host load cannot turn an
   otherwise-correct routine T1/T2 invocation into a false compile failure.
8. **`dev-small` remains a follow-up.** A separate-target,
   no-sccache/incremental runnable A/B is not needed for D-001 and must not
   delay it.

## Placement Analysis and Edit Budget

Placement options considered:

1. **Change upstream-canonical Rust, Cargo features/profiles, or crate
   boundaries:** rejected. T1/T2 already meet the verification target, and
   these changes would create unnecessary rebase conflict.
2. **Add an overlay Rust crate/profile:** rejected. The gap is command
   selection, evidence, and documentation, not executable Rust behavior.
3. **Add wrapper-owned scripts, tests, evidence, CI wiring, and docs:**
   selected. All durable edits stay outside
   `external/repos/codex-patched/codex-rs/`.

Estimated edit budget: six new wrapper-owned files and ten modified
wrapper-owned files; approximately 250-400 lines of command/measurement logic,
300-500 lines of deterministic tests/fixtures, and synchronized documentation.
Upstream-canonical edit count is zero, so upstream re-conflict probability is
near zero. Shared wrapper-script/doc conflict probability is moderate and is
handled by serialization/rebase.

## Canonical Tier Contract

Create a thin shell entry point backed by a dependency-free Node module:

```text
bash scripts/verify-core-change.sh targeted --package codex-core
bash scripts/verify-core-change.sh workspace
bash scripts/verify-core-change.sh executable --confirm-slow
bash scripts/verify-core-change.sh publish --confirm-slow
```

`scripts/verify-core-change.sh` only self-locates and `exec`s the Node module.
`scripts/verify-core-change.mjs` owns parsing, Cargo metadata validation,
environment preflight, exact argv construction, elapsed-wall reporting, and
exit-code propagation. Node is used because parsing Cargo metadata in shell
would otherwise add an undeclared `jq` dependency or brittle TOML/path
heuristics.

### T1: `targeted`

Command shape:

```text
cargo check --timings -p <package> [-p <package> ...]
```

Rules:

- Require at least one repeatable `--package <exact-workspace-package-name>`.
- Reject `--package` on every other tier.
- Resolve package names only through Cargo metadata and `workspace_members`.
- Deduplicate repeated identical package names while preserving first-seen
  order.
- Reject zero matches, multiple workspace matches for one name, dependencies
  outside the workspace, blank values, and unknown flags with exit 2.
- Do not accept changed file paths as package selectors in D-001.
- If the caller cannot name every affected package, or changes workspace-root
  `Cargo.toml`, `Cargo.lock`, `.cargo/`, shared build config, or an ambiguous
  cross-package surface, instruct them to run T2 instead.
- Source `scripts/iteration-env.sh` first so the Windows toolchain and sccache
  environment are stable.

### T2: `workspace`

Command shape:

```text
cargo check --workspace --timings
```

Rules:

- This is the hard pre-commit and Codex rebase Phase 5a gate.
- It is never replaced by a successful T1.
- Scoped `cargo test -p <package>` remains an additional touched-crate test,
  not part of automatic tier escalation.
- Warm acceptance budget: <=600 seconds.

### T3: `executable`

Command shape:

```text
cargo build --release \
  -p codex-cli --bin codex-core \
  -p codex-copilot-launcher --bin codex \
  --timings
```

Rules:

- Require `--confirm-slow`.
- Validate the frozen iteration profile from `scripts/iteration-env.sh`
  (`RUSTC_WRAPPER=sccache`, LTO off, codegen-units 16, incremental 0).
- Label expected changed-core warm behavior as approximately 31 minutes.
- Never run as a hidden consequence of T1/T2 or in the new fast CI tests.
- Do not claim a <=10-minute budget.

### T4: `publish`

Command shape:

```text
cargo build --release \
  --bin codex \
  --bin codex-core \
  --bin codex-windows-sandbox-setup \
  --bin codex-command-runner \
  --timings
```

Rules:

- Require `--confirm-slow`.
- Validate the publish profile established by
  `.claude/commands/publish-sandbox-patch.md`: stable MSVC toolchain;
  `clang-cl`/`llvm-lib`/`lld-link`; thin LTO; codegen-units 16;
  `RUSTFLAGS`, `CARGO_TARGET_DIR`, `RUSTC_WRAPPER`, `SCCACHE_*`, and
  `CARGO_INCREMENTAL` unset; and resolvable `RUSTY_V8_ARCHIVE`, `LIB`, and
  `INCLUDE` inputs.
- Preserve the existing publish command and smoke/release ceremony.
- Label historical wall time as approximately 58 minutes and explicitly state
  that T4 is not promised <=10 minutes.
- A `--print-plan-json` mode may show the command without running it; execution
  remains explicit.

### CLI behavior and exit contract

- Exit 0: selected Cargo command succeeded.
- Exit 2: usage, package-selection, metadata, or environment preflight failure;
  Cargo must not have started.
- Other non-zero: propagate the Cargo/native child exit code.
- Reject arbitrary passthrough Cargo args in D-001; they could weaken or change
  the canonical gate.
- Print selected tier, exact argv, workspace, target directory, and next tier.
- `--print-plan-json` emits exact argv plus
  `preflight: {ready, issues[]}` without executing Cargo. Environment blockers
  may produce `ready:false` while still exposing T3/T4 argv for deterministic
  tests; selection/metadata errors still exit 2. Execution must exit 2 before
  Cargo when `ready:false`.

## Measurement and Evidence Design

Generalize `scripts/measure-build.ps1` rather than adding a second production
measurement command.

### Compatibility

- Add `-Tier targeted|workspace|executable|publish`.
- Default `-Tier executable` so the existing
  `-Scenario <name>` invocation retains its current two-binary behavior.
- Add repeatable `-Package` for T1 and reject it for other tiers.
- Preserve `-RunId`, `-ParseOnly`, `-CodexRsDir`, current CSV columns, and the
  current per-run ignored artifact directory.
- Append new CSV fields; do not rename/remove existing fields.

### Canonical command reuse

`measure-build.ps1` invokes:

```text
node scripts/verify-core-change.mjs <tier/args> --print-plan-json
```

It parses the returned cwd/argv/preflight/budget metadata, appends
`--message-format=json-render-diagnostics` for measurement, and executes the
same command. It refuses `preflight.ready:false`; tier definitions must not be
duplicated in PowerShell.

### Compact JSON result

Write
`docs/implementation/build-perf-artifacts/<runId>.json` alongside the legacy
CSV with this stable top-level shape:

```json
{
  "schemaVersion": 1,
  "runId": "...",
  "scenario": "...",
  "tier": "targeted|workspace|executable|publish",
  "packages": ["codex-core"],
  "command": {"cwd": "...", "argv": ["cargo", "check", "..."]},
  "startedAt": "...",
  "finishedAt": "...",
  "wallSeconds": 37.45,
  "exitCode": 0,
  "budget": {
    "class": "targeted-edit|targeted-noop|workspace|none",
    "thresholdSeconds": 120,
    "status": "pass|fail|not-applicable"
  },
  "repository": {"wrapperCommit": "...", "patchedCommit": "..."},
  "environment": {
    "targetDirectory": "...",
    "cargo": "...",
    "rustc": "...",
    "rustcWrapper": "sccache",
    "sccacheDirectory": "D:\\codex-sccache",
    "lto": "off",
    "codegenUnits": "16",
    "incremental": "0",
    "jobs": "8",
    "rustflags": null,
    "linker": "lld-link"
  },
  "cargo": {
    "timingsPath": "...",
    "artifactEvents": 1108,
    "freshPackageCount": 852,
    "rebuiltPackageCount": 1,
    "rebuiltPackages": ["codex-core@..."]
  },
  "sccache": {
    "enabled": true,
    "compileRequests": 2,
    "cacheHits": 0,
    "cacheMisses": 1,
    "cacheWrites": 1,
    "requestsNotCacheable": 1,
    "compileFails": 0,
    "cacheErrors": 0,
    "cacheReadErrors": 0,
    "cacheWriteErrors": 0,
    "cacheTimeouts": 0
  },
  "probe": null
}
```

Use sccache 0.15 `counts`, not duplicated `adv_counts`. Retain the ignored raw
Cargo JSON/timing HTML path for diagnosis, but commit only the compact baseline
file described below.

### Explicit budget classes

- `targeted-edit`: T1 only, threshold 120 seconds.
- `targeted-noop`: T1 only, threshold 30 seconds.
- `workspace`: T2 only, threshold 600 seconds.
- `none`: mandatory for T3/T4; no threshold exists.
- `-EnforceBudget` requires a compatible non-`none` class and returns a
  distinct non-zero result only after Cargo succeeds but the acceptance budget
  is missed.

### Tracked recorded evidence

Add `docs/implementation/build-perf-baseline.json` containing the compact
2026-07-11 measurements, commits, probe hashes, cache health, thresholds, and
the explicit absence of T3/T4 budgets. Tests load this file to assert:

- 37.45 <= 120;
- 338.829 <= 600;
- 6.254 <= 30;
- T3/T4 have `thresholdSeconds: null`;
- the recorded ~31m and ~58m slow tiers are not mislabeled as <=10m;
- the healthy-cache record has zero read/write/cache errors.

CI must not reproduce a 31- or 58-minute build.

## Byte-Safe Probe Contract

Add optional `-ProbeSpec <json>` support to `measure-build.ps1`.

Probe schema:

```json
{
  "schemaVersion": 1,
  "repositoryRoot": "external/repos/codex-patched",
  "files": [{
    "path": "codex-rs/core/src/session_prefix.rs",
    "expectedOriginalSha256": "...",
    "expectedEditedSha256": "...",
    "findBase64": "...",
    "replaceBase64": "..."
  }]
}
```

Required safety:

1. Resolve every path under `repositoryRoot`; reject traversal and files
   outside that repository.
2. Require the nested probe repository to be clean. Snapshot the outer wrapper
   status before the probe and require it to be byte-identical afterward, so
   implementation edits may exist but the probe cannot add/remove them.
3. Verify each full-file original hash.
4. Decode the byte needles, require exactly one match, apply one replacement,
   advance mtime so Cargo observes the edit, and verify edited hash.
5. Snapshot the full original byte array, `LastWriteTimeUtc`, and file
   attributes in memory before editing.
6. In `finally`, restore exact bytes, timestamp, and attributes on success,
   Cargo failure, parser failure, or budget failure.
7. Verify restored hashes and a clean repository after restoration. Restoration
   failure outranks the Cargo result and emits an actionable hard failure.
8. Record before/edited/restored hashes and clean-state booleans in `probe`.

The implementation acceptance run may generate probe specs under the already
ignored `docs/implementation/build-perf-artifacts/`; do not commit source
snapshots or large logs.

## Sccache Windows Path Normalization

In `scripts/iteration-env.sh`, add a small
`_iter_normalize_windows_path` helper and compare normalized active/intended
values.

Normalization must:

- trim CR, surrounding quotes, whitespace, and non-root trailing separators;
- treat `\`, `\\`, and `/` as separators and collapse repeated separators;
- normalize MSYS drive form `/d/...` to `d:/...` when present;
- compare case-insensitively;
- never use `printf %b` or another escape interpreter that can turn legitimate
  path text such as `\t` or `\n` into control characters.

Equivalent examples:

- `D:\codex-sccache`
- `D:\\codex-sccache`
- `D:/codex-sccache/`
- `d:\CODEX-SCCACHE`
- `"D:\\codex-sccache"`

Repeated sourcing against any equivalent display form must leave the healthy
server and its statistics intact. A genuinely different path must still
perform one stop/start plus the existing readiness poll.

## Exact Files to Create or Modify

Paths are relative to the Codex wrapper implementation worktree unless marked
`[parent codexu]`.

### New build tooling and tests

- `scripts/verify-core-change.sh`
- `scripts/verify-core-change.mjs`
- `scripts/test_verify_core_change.mjs`
- `scripts/test_iteration_env_sccache_path.sh`
- `scripts/test_measure_build.ps1`
- `docs/implementation/build-perf-baseline.json`

### Existing tooling and CI

- `scripts/measure-build.ps1`
- `scripts/iteration-env.sh`
- `.github/workflows/invariant-check.yml`

### Agent guidance and runbooks

- `CLAUDE.md`
- `AGENTS.override.md`
- `.claude/commands/rebase-upstream.md`
- `.claude/commands/publish-sandbox-patch.md`
- `docs/implementation/build-perf.md`
- `docs/workflows/repo-topology.md`
- `docs/workflows/submodule-migration.md`

### Parent closeout only

- `[parent codexu] codex` (gitlink to the merged Codex wrapper commit)
- `[parent codexu] .ralph-overview/data.json`
- `[parent codexu] .ralph-overview/data.archived.json`

The overview shards are mutated only through `data-edit`/MCP tools; generated
snapshot files are not staged manually.

### Reference-only; do not modify

- `external/repos/codex-patched/codex-rs/Cargo.toml`
- `external/repos/codex-patched/codex-rs/core/Cargo.toml`
- `external/repos/codex-patched/codex-rs/cli/Cargo.toml`
- `codex-rs-overlay/codex-copilot-launcher/Cargo.toml`
- `external/repos/codex-patched/codex-rs/core/src/session_prefix.rs`
- `external/repos/codex-patched/codex-rs/core/src/config/mod.rs`

No `external/repos/codex-patched` gitlink change occurs inside the Codex
wrapper implementation.

## Documentation Contract

Update all named docs in the same implementation so no agent sees a different
verification hierarchy.

### `CLAUDE.md` and `AGENTS.override.md`

- Name the four canonical commands.
- Require explicit package names for T1; when selection is uncertain, route to
  package-free T2 instead of guessing.
- Keep T2 as the hard workspace gate.
- Label T3 ~31m warm changed-core and T4 ~58m publish.
- Distinguish the 45-68s historical link-only floor from a changed-core
  executable rebuild.
- Remove guidance that treats profile drift or a cold fingerprint as reason to
  clear a healthy cache; prefer a separate cache/target for experiments.

### Rebase and publish commands

- Rebase fast loop: T1 with explicit affected packages.
- Rebase Phase 5a: T2, unchanged as a hard gate.
- Runnable smoke need: explicit T3 only.
- Publish step: exact T4 under the existing publish environment.
- Preserve the existing four-binary package/release smoke.
- Replace stale ~20m generic release wording with the measured tier labels.

### Build-perf and workflow docs

- Add the current measurement matrix and root-cause explanation.
- Document the JSON evidence schema and probe-restore guarantee.
- Document healthy-cache gating: wipe only after a reproducible cache
  read/write/metadata error, not because the fingerprint is cold.
- Point topology/submodule runbooks to the canonical command instead of generic
  `cargo build --release`.

## Story Decomposition

### US-001 — Add the fail-closed tier planner and command

Implement the shell shim, Node planner, explicit package validation, exact tier
argv, environment preflights, and plan JSON.

### US-002 — Generalize measurement and commit compact evidence

Extend `measure-build.ps1`, preserve CSV compatibility, add compact JSON,
sccache/cargo metrics, explicit budgets, and byte-safe probe restoration; add
the tracked baseline.

### US-003 — Normalize sccache paths without restarting healthy servers

Fix `iteration-env.sh` comparison and cover equivalent/different path behavior.

### US-004 — Add fast regression tests and CI wiring

Cover selection, invalid/missing packages, exact commands, path normalization,
probe restoration, metrics schema, legacy measurement defaults, and recorded
thresholds without long builds.

### US-005 — Make all Codex guidance use the tier contract

Synchronize CLAUDE/AGENTS, rebase/publish commands, build-perf, and workflow
docs; remove stale generic release/cache-wipe language.

### US-006 — Prove acceptance, converge reviews, and hand off closeout

Run live T1/T2 acceptance probes, cheap T3/T4 plan checks, Phase 5a/5b review
convergence, commit the Codex branch, then let the lead merge/push, bump the
parent pointer, and archive the stale cache-wipe task.

All six stories execute serially in one Codex wrapper worktree because they
share the tier contract, CI, and documentation. Do not split into parallel
writers.

## Implementation Worktree and Branch

Implementation repository: the Codex wrapper submodule.

```text
Repository: D:\harness-efforts\codexu\codex
Worktree:   D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m
Branch:     ralph/codex-rs-core-change-incremental-build-over-30m
Base:       current codex/main after plan merge and after any conflicting build-tooling ship
```

Creation/preflight:

```powershell
git -C D:\harness-efforts\codexu\codex worktree add `
  D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m `
  -b ralph/codex-rs-core-change-incremental-build-over-30m main
git -C D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m `
  submodule update --init --recursive
Set-Location D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\external\repos\codex-patched\codex-rs
cargo metadata --no-deps --format-version 1
```

Do not edit in `D:\harness-efforts\codexu\codex` directly. Do not make a
worktree beside the repository. Do not modify the nested patched Codex source.

## Exact Test Matrix

| Area | Case | Expected |
|---|---|---|
| Tier parsing | no tier / unknown tier | exit 2, no Cargo |
| Targeted selection | no package | exit 2, actionable T1/T2 guidance |
| Targeted selection | exact `codex-core` | one `-p codex-core` |
| Targeted selection | duplicate same package | one stable package entry |
| Targeted selection | missing package | exit 2, no check |
| Targeted selection | dependency outside workspace | reject |
| Targeted selection | ambiguous duplicate workspace name fixture | reject |
| Targeted selection | filename/path supplied instead of package | reject; no guessing |
| Tier isolation | package flag on T2/T3/T4 | reject |
| T1 command | multiple packages | exact repeated `-p`, no build |
| T2 command | workspace | exact `cargo check --workspace --timings` |
| T3 command | confirmed | exact two-package/two-bin release argv |
| T3 command | unconfirmed execution | reject before Cargo |
| T4 command | confirmed/publish env | exact four-bin release argv |
| T4 command | iteration env leaked | reject before Cargo |
| No escalation | T1/T2 success | no T3/T4 child invocation |
| Path normalize | slash/escape/case/quote variants | no server restart |
| Path normalize | truly different path | exactly one restart + poll |
| Measurement | existing invocation without `-Tier` | executable legacy behavior |
| Measurement | fake targeted/workspace Cargo JSON | stable metrics schema |
| Sccache metrics | `counts` + duplicated `adv_counts` | count once |
| Probe preflight | dirty repo / wrong original hash / multiple byte matches | unchanged file, hard failure |
| Probe success | fake Cargo exit 0 | bytes/mtime/attrs restored, repo clean |
| Probe failure | fake Cargo non-zero | bytes/mtime/attrs restored, child code preserved unless restore fails |
| Threshold fixture | 37.45 / 338.829 / 6.254 | all acceptance budgets pass |
| Slow-tier fixture | 1845.745 / 3480 | no threshold; explicit slow labels |
| Cache fixture | 10.52 GiB / zero errors | no wipe recommendation |

## Validation Commands

Run from the Codex implementation worktree root.

### Fast deterministic tests

```powershell
node --test scripts/test_verify_core_change.mjs
bash scripts/test_iteration_env_sccache_path.sh
pwsh -NoProfile -File scripts/test_measure_build.ps1
git diff --check
```

### Planner integration without builds

```powershell
bash scripts/verify-core-change.sh targeted --package codex-core --print-plan-json
bash scripts/verify-core-change.sh workspace --print-plan-json
bash scripts/verify-core-change.sh executable --print-plan-json
bash scripts/verify-core-change.sh publish --print-plan-json
```

### Live acceptance on the measured Windows host

Source the frozen environment once:

```bash
source scripts/iteration-env.sh
```

Generate ignored low/high probe specs under
`docs/implementation/build-perf-artifacts/` from the exact hashes and
byte replacements recorded in the brainstorm, then run:

```powershell
pwsh -NoProfile -File scripts/measure-build.ps1 `
  -Tier targeted -Package codex-core `
  -Scenario d001-targeted-noop `
  -BudgetClass targeted-noop -EnforceBudget

pwsh -NoProfile -File scripts/measure-build.ps1 `
  -Tier targeted -Package codex-core `
  -Scenario d001-targeted-low-edit `
  -BudgetClass targeted-edit -EnforceBudget `
  -ProbeSpec docs/implementation/build-perf-artifacts/d001-low-probe.json

pwsh -NoProfile -File scripts/measure-build.ps1 `
  -Tier workspace `
  -Scenario d001-workspace-high-edit `
  -BudgetClass workspace -EnforceBudget `
  -ProbeSpec docs/implementation/build-perf-artifacts/d001-high-probe.json
```

Acceptance:

- targeted changed edit <=120s;
- targeted no-op <=30s;
- workspace high-fanout edit <=600s;
- every probe reports exact restoration, the nested repository ends clean,
  and the outer wrapper status is unchanged.

Do not rerun a 31m T3 or 58m T4 merely to test the dispatcher. The committed
recorded evidence plus exact plan/argv tests are sufficient for D-001. Run T3
only if the implementation itself needs a runnable binary; run T4 only in an
actual publish-equivalent decision.

### CI

Add one fast step in `.github/workflows/invariant-check.yml` on both matrix
operating systems:

```bash
node --test scripts/test_verify_core_change.mjs
bash scripts/test_iteration_env_sccache_path.sh
pwsh -NoProfile -File scripts/test_measure_build.ps1
```

The step uses fake Cargo/sccache fixtures and the tracked baseline JSON. It
must not run a real T3/T4 build.

## Phase 5a and Phase 5b Convergence

Two similarly named protocols exist; do not conflate them:

1. **Codex rebase Phase 5a:** the T2 `cargo check --workspace` hard gate.
2. **Ralph implementation Phase 5a/5b:** post-story code-review/fix and
   docs-review/fix convergence.

After all stories and tests:

### Ralph Phase 5a — code review/fix

1. Run a `gpt-5.6-sol` code reviewer over the complete Codex wrapper diff,
   D-001 brainstorm, this plan, and the recorded baseline.
2. Review command safety, metadata validation, PowerShell `finally` behavior,
   path normalization, exit-code preservation, and test isolation.
3. Fix every Critical/High/Medium finding using `gpt-5.6-sol`.
4. Re-run targeted tests and the live T1/T2 acceptance affected by fixes.
5. Repeat until code review is clean.

### Ralph Phase 5b — docs review/fix

1. Run a `gpt-5.6-sol` docs reviewer against all changed Markdown.
2. Cross-check every named tier, exact command, threshold, slow-tier label,
   cache-health rule, and Phase-5 naming distinction.
3. Fix stale/contradictory docs and rerun review until clean.

The implementation is not ship-ready until both review states are clean.

## Parent Pointer and Bookkeeping Flow

The implementation member commits only inside the Codex wrapper worktree and
does not push.

Lead-owned sequence after review:

1. Fast-forward the Codex topic commit into `codex/main`.
2. Push and verify Codex `main` on every configured Codex remote.
3. In parent `D:\harness-efforts\codexu`, stage only the `codex` gitlink and
   commit the pointer bump with the required Copilot trailer.
4. Push/verify parent `main` on its configured remotes.
5. Add an explanatory card and archive the stale cache task:

   ```text
   node tools/data-edit.mjs add-kanban-card \
     build-env-sccache-cache-wipe-and-rewarm \
     --class cmd-ok \
     --html "<strong>Archived after D-001 measurement:</strong> healthy 10.52 GiB cache, 1,005 hits, zero cache read/write/timeout errors. Future wipes require a reproducible cache error; a cold fingerprint is insufficient."

   node tools/data-edit.mjs set-lifecycle \
     build-env-sccache-cache-wipe-and-rewarm archived
   ```

6. Mark `codex-rs-core-change-incremental-build-over-30m` shipped only after
   the Codex wrapper commit and parent gitlink commit are on `origin/main` and
   all configured remotes have been verified in sync.
7. Stage overview shards explicitly; never stage generated snapshots with
   `git add -A`.

Planning-time operational note: the installed ralph-overview dispatcher on
this machine currently fails to load `@babel/parser`. This does not block
Codex implementation. Before closeout, the lead must either repair/update the
installed plugin, point `RALPH_OVERVIEW_PLUGIN_ROOT` at a dependency-complete
in-tree plugin, or use the equivalent `overview.add_kanban_card` and
`overview.set_lifecycle` MCP tools.

## Conflict Surface

- `scripts/iteration-env.sh` and `scripts/measure-build.ps1` are shared build
  infrastructure. Serialize with any other build-perf/cache task.
- `.claude/commands/publish-sandbox-patch.md` is currently modified on active
  branch `ralph/codex-sandbox-setup-vendoring`. Its current changes are in
  disjoint packaging/smoke hunks, but this implementation must start from or
  rebase onto that branch's merged result rather than overwrite it.
- `.github/workflows/invariant-check.yml`, `CLAUDE.md`, and
  `AGENTS.override.md` are cross-cutting files; do not run a parallel Codex
  implementation that edits them.
- Parent `.ralph-overview/data*.json` is lead-owned and may change while the
  Codex implementation runs. Apply id-scoped bookkeeping only after rebasing
  parent main.
- No upstream-canonical Rust files, Cargo manifests, profiles, features, crate
  boundaries, or nested submodule gitlink are changed. Upstream re-conflict
  probability is therefore near zero; wrapper-doc conflict risk is moderate.

## Rollback

1. Revert the single Codex wrapper implementation commit on Codex `main`.
2. Re-run the fast script tests and `git diff --check`.
3. Push/verify the reverted Codex main on all configured remotes.
4. Revert the parent codexu `codex` gitlink commit.
5. Reopen `build-env-sccache-cache-wipe-and-rewarm` only if a new reproducible
   cache read/write/metadata error exists; add that evidence before moving it
   back to `tracked`.
6. Do not clear `D:\codex-sccache` as part of rollback. The implementation does
   not modify its contents or Cargo profiles.
7. Remove only ignored per-run evidence under
   `docs/implementation/build-perf-artifacts/` if cleanup is needed.

## Common Mistakes and Confusion Points

- Passing a source path and expecting the verifier to guess a package. T1
  accepts exact Cargo package names only.
- Treating a successful T1 as permission to skip the T2 workspace hard gate.
- Running `cargo build -p codex-core` and believing it produced
  `codex-core.exe`; that package is the library. The binary is
  `-p codex-cli --bin codex-core`.
- Building only `codex-core.exe` for T3 and leaving the launcher stale.
- Hiding T3/T4 behind a default, fallback, test, or automatic escalation.
- Enforcing a 120s T1 budget for arbitrary packages or a cold target. Budget
  classes are explicit benchmark expectations.
- Counting both sccache `counts` and `adv_counts`.
- Interpreting 0 sccache hits after a changed `codex-core` release build as
  cache corruption. The changed dependency key invalidates all 25 consumers.
- Wiping a healthy cache because a new toolchain/profile fingerprint is cold.
- Using `printf %b` to normalize Windows paths and accidentally interpreting
  backslash escapes.
- Restoring probe text but not exact bytes, mtime, attributes, hash, and clean
  git state.
- Measuring a no-op immediately after a restored probe without first ensuring
  Cargo's target represents the restored source. Run the no-op baseline before
  controlled edit probes (the acceptance sequence below does so).
- Writing probe backups or long logs outside the repository; use the ignored
  build-perf artifact directory.
- Editing both the Codex wrapper and parent codexu in one Ralph PRD. The
  implementation write root is Codex-only; the pointer/archive steps are
  lead-owned closeout.
- Confusing Codex rebase Phase 5a with Ralph implementation Phase 5a/5b.
- Running T3/T4 in CI to prove command selection; use fake tools and recorded
  evidence.
- Bundling a `dev-small`, incremental, shared-target, remote-cache, crate-split,
  or feature-pruning experiment into D-001.

## Out of Scope and Follow-up

Create a separate follow-up only if a runnable changed binary itself must meet
<=10 minutes:

- use a versioned separate target;
- unset sccache/release overrides;
- set `CARGO_INCREMENTAL=1`;
- warm `cargo build --profile dev-small -p codex-cli --bin codex-core`;
- measure the same low/high probes;
- compare warm edits, not cold warm-up;
- do not change the canonical D-001 tiers without evidence.

Remote sccache, shared mutable targets, crate splitting, Cargo feature pruning,
profile changes, and production Rust changes remain excluded.

## Open Questions

None. D-001 is fully specified. The installed ralph-overview dependency issue
is an operational closeout issue with documented fallbacks, not a design or
implementation blocker.
