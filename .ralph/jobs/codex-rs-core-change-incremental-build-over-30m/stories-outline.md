# Stories Outline: Codex Core-Change Tiered Verification

*Six-story serial decomposition for measured direction D-001. Implementation is confined to a Codex wrapper worktree; parent codexu pointer and overview closeout remain lead-owned.*

## US-001: Add the fail-closed tier planner and command

**Description:** As a Codex developer, I want one explicit tier command with
metadata-backed package validation so that routine checks cannot silently turn
into slow builds or validate the wrong package.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] `scripts/verify-core-change.sh` self-locates and delegates to the dependency-free Node planner.
- [ ] The planner requires one explicit tier:
  `targeted|workspace|executable|publish`.
- [ ] T1 requires repeatable exact `--package` values and validates them as unique workspace members through `cargo metadata --no-deps`.
- [ ] Missing, external, unknown, ambiguous, or blank packages fail before Cargo.
- [ ] T1 does not infer packages from changed filenames, path substrings, directory names, or `git diff`.
- [ ] T2 emits exact `cargo check --workspace --timings`.
- [ ] T3 emits the exact two-package/two-bin runnable iteration build and requires `--confirm-slow` for execution.
- [ ] T4 emits the existing exact four-bin publish build, validates publish-env separation, and requires `--confirm-slow`.
- [ ] T1/T2 never invoke T3/T4 as a hidden consequence.
- [ ] `--print-plan-json` exposes cwd/argv/tier/packages and
  `preflight.ready/issues` without building; blocked environments still expose
  exact T3/T4 argv, while execution fails before Cargo.
- [ ] Usage/preflight errors exit 2 and child exit codes are preserved.

**Dependencies:** None

**Estimated complexity:** medium

## US-002: Generalize measurement and commit compact evidence

**Description:** As a build-performance maintainer, I want the existing
measurement wrapper to measure every verification tier and restore controlled
probes exactly so that regressions are observable without contaminating source
or cache state.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] `scripts/measure-build.ps1` accepts
  `-Tier targeted|workspace|executable|publish` and repeatable T1 packages.
- [ ] Omitting `-Tier` preserves the current executable-build default and legacy CSV columns.
- [ ] The wrapper consumes planner JSON rather than duplicating tier commands.
- [ ] Compact JSON records wall time, exact command, repository SHAs, environment fingerprint, Cargo timing/artifact data, rebuilt packages, and complete sccache deltas.
- [ ] sccache 0.15 `counts` are counted once; duplicated `adv_counts` are ignored.
- [ ] Explicit budget classes cover targeted edit <=120s, targeted no-op <=30s, and workspace <=600s.
- [ ] T3/T4 have no threshold and cannot be passed to `-EnforceBudget`.
- [ ] Probe specs use full-file hashes plus base64 byte needles/replacements.
- [ ] Probe mode requires a clean nested repository, exact hashes, and exactly one byte match.
- [ ] Success, Cargo failure, parsing failure, and budget failure all restore exact bytes, mtime, attributes, hashes, and clean git state.
- [ ] `docs/implementation/build-perf-baseline.json` records the 2026-07-11 evidence and healthy-cache result.

**Dependencies:** US-001

**Estimated complexity:** large

## US-003: Normalize sccache paths without restarting healthy servers

**Description:** As a Windows Codex developer, I want escaped/slashed/cased
forms of the same sccache path to compare equal so that repeated environment
setup preserves a healthy server and its statistics.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] `scripts/iteration-env.sh` normalizes CR, quotes, whitespace, repeated separators, slash direction, MSYS drive form, case, and trailing separators before comparison.
- [ ] `D:\codex-sccache`, `D:\\codex-sccache`, `D:/codex-sccache/`, lower/upper-case variants, and quoted display forms compare equal.
- [ ] Equivalent paths do not call `sccache --stop-server`, `--start-server`, or reset stats.
- [ ] A genuinely different path performs exactly one restart and retains the existing readiness poll.
- [ ] Normalization does not use escape interpretation such as `printf %b`.
- [ ] Helper variables/functions are cleaned up after sourcing.

**Dependencies:** US-001

**Estimated complexity:** small

## US-004: Add fast regression tests and CI wiring

**Description:** As a maintainer, I want deterministic command, path, probe,
metrics, and evidence tests so that D-001 remains enforced without adding a
30- or 58-minute CI job.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Node tests cover tier parsing, exact argv, package validation, ambiguity, missing packages, duplicate handling, and no filename guessing.
- [ ] Shell tests fake sccache stats and cover all path-equivalence variants plus a real mismatch.
- [ ] PowerShell tests use fake Cargo/sccache and a repo-local scratch git repository to cover metrics shape and restoration on success/failure.
- [ ] Tests verify the legacy measurement default remains the two-binary executable build.
- [ ] Recorded evidence asserts 37.45 <=120, 338.829 <=600, and 6.254 <=30.
- [ ] Recorded T3/T4 evidence has null thresholds and explicit ~31m/~58m labels.
- [ ] Healthy-cache evidence has zero cache read/write/timeout errors and cannot recommend a wipe.
- [ ] `.github/workflows/invariant-check.yml` runs only the fast tests on both matrix operating systems.
- [ ] No test runs a real T3/T4 build or writes outside the repository.

**Dependencies:** US-001, US-002, US-003

**Estimated complexity:** medium

## US-005: Make all Codex guidance use the tier contract

**Description:** As an agent or operator, I want one synchronized build
hierarchy across project instructions and runbooks so that slow release builds
are never mistaken for routine verification.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] `CLAUDE.md` and `AGENTS.override.md` name the same four commands and package-selection contract.
- [ ] Both keep T2 as the hard pre-commit/rebase Phase 5a gate.
- [ ] Rebase guidance uses T1 for iteration and T2 for the hard gate.
- [ ] Publish guidance uses explicit T3 only for runnable iteration and T4 for release.
- [ ] T3 is labeled approximately 31 minutes warm after a core edit; T4 is labeled approximately 58 minutes and not <=10 minutes.
- [ ] The 45-68s link-only floor is not presented as changed-core rebuild time.
- [ ] `docs/implementation/build-perf.md` incorporates the current matrix, compact schema, probe safety, and healthy-cache gate.
- [ ] `docs/workflows/repo-topology.md` and `submodule-migration.md` point to the canonical verifier instead of generic release builds.
- [ ] Cold fingerprints/profile experiments no longer imply clearing the healthy shared cache; separate targets/cache namespaces are preferred.

**Dependencies:** US-001, US-002, US-003

**Estimated complexity:** medium

## US-006: Prove acceptance, converge reviews, and hand off closeout

**Description:** As the release lead, I want live check-tier evidence, clean
code/docs reviews, and a two-repository ship handoff so that D-001 lands
without modifying Codex Rust source or leaving stale bookkeeping.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Live warm private `codex-core` T1 probe completes <=120 seconds.
- [ ] Live T1 no-op runs before controlled edit probes and completes <=30 seconds.
- [ ] Live high-fanout T2 probe completes <=600 seconds.
- [ ] Every controlled probe restores exact bytes/mtime/attributes, leaves the
  nested repository clean, and leaves outer wrapper status unchanged.
- [ ] T3/T4 planner checks prove exact commands without mandatory slow rebuilds.
- [ ] No production Rust source, Cargo feature/profile, crate boundary, or nested gitlink changed.
- [ ] Ralph Phase 5a code review/fix uses `gpt-5.6-sol` and converges clean.
- [ ] Ralph Phase 5b docs review/fix uses `gpt-5.6-sol` and converges clean.
- [ ] The implementation member commits only the Codex wrapper branch and does not push.
- [ ] The lead merges/pushes Codex first, then commits/pushes the parent codexu `codex` gitlink.
- [ ] The lead adds healthy-cache evidence to `build-env-sccache-cache-wipe-and-rewarm` and archives it through id-scoped overview tooling.
- [ ] The main task is marked shipped only after both Codex and parent commits
  are on `origin/main` and all configured remotes are verified in sync.

**Dependencies:** US-004, US-005

**Estimated complexity:** medium
