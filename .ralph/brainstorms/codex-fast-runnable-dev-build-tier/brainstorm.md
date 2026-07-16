# Brainstorm: Fast Runnable Codex Development Build Tier

<!-- ralph-meta {"overviewTaskId":"codex-fast-runnable-dev-build-tier","uiUxJudgment":"not-required"} -->

## Executive decision

**GO: keep this as a separate implementation task after predecessor D-001.**
The predecessor correctly made `cargo check` the verification loop, but it
explicitly left runnable iteration unsolved. A separate-target,
incremental-on, sccache-off `dev-small` build produced an actually runnable
launcher/core pair after a representative private `codex-core` edit in
**70.040 seconds**, versus the predecessor's **1845.745 seconds** for the
warm release-like executable build. That is a **26.35x speedup** and a
**96.2% wall-time reduction** without changing the production release profile.
An independent-review closure run then built a fresh changed binary with
verbose profile evidence and completed an authenticated shell-tool turn against
that exact SHA-256 in **265.944 seconds (4m25.944s) end to end**.

The measured cold fill was **619.039 seconds (10m19.039s)**, narrowly above
the ten-minute target. That is an honest warm-up cost, not the edit loop.
After warm-up, no-op builds took **13.029s** and **7.037s**, and the changed
core build met the requested runnable-loop target by a wide margin.

The recommended implementation is additive and default-off, and must branch
from or rebase onto accepted predecessor HEAD
`2a95dd19c89fc99492d0e5a25d77cb070fe77da3`:

1. extend the predecessor's canonical `scripts/verify-core-change.{sh,mjs}`
   with a new explicit `runnable` tier and extend its
   `scripts/measure-build.ps1`; do not create a competing command;
2. the existing `dev-small` profile, with incremental compilation explicitly
   enabled and sccache explicitly disabled;
3. a short, per-worktree `CARGO_TARGET_DIR`, never the release target and
   never one implicit global shared target;
4. the real `codex.exe` launcher adjacent to `codex-core.exe`;
5. explicit freshness/provenance and target-ownership safeguards;
6. the existing T1/T2 checks before or alongside runnable smoke, and the
   unchanged optimized publish build as the final fidelity gate.

The implementation should not add Rust source changes, alter `[profile.release]`,
or claim the fast artifact is performance- or package-equivalent to a release.

## Scope and provenance

- Brainstorm worktree:
  `C:\efforts\codexu\.worktrees\brainstorm-codex-fast-runnable-dev-build-tier`
- Branch: `ralph/brainstorm-codex-fast-runnable-dev-build-tier`
- Codexu base: `ec625200500e2034968f23a0ccb76d000573afdf`
- Codex wrapper: `3ff55692e7045e85ce78ebe8337ab40b55494c9c`
- Patched Codex: `587a6a8ab8948ff912b1f24a62833b277934302d`
- Accepted predecessor implementation HEAD:
  `2a95dd19c89fc99492d0e5a25d77cb070fe77da3`
- Host: Windows 11 Enterprise, 8 cores / 16 logical processors, 63.95 GiB RAM
- Toolchain: Cargo/rustc 1.97.0, clang-cl 19.1.7, `lld-link`, eight Cargo jobs

The primary codexu checkout was not switched. All expensive build output was
captured once under this brainstorm's `evidence/` directory.

## Do not conflate the four contracts

| Contract | Question answered | Canonical evidence / gate |
|---|---|---|
| Correctness verification | Does the change type-check at the required scope? | Predecessor T1 targeted check: 100.137s changed core; T2 workspace high-fanout: 54.691s; neither produces a runnable artifact. |
| Runnable smoke | Can the locally changed fork launch through its real launcher and execute representative commands? | This brainstorm's fast artifact and smoke suite. |
| Debug/development performance | Is runtime speed or source-level debugging good enough for local diagnosis? | Separate opt/debug/codegen sweep only if `opt-level=0`, no-symbol output is inadequate. |
| Publish fidelity | Does the release-equivalent, fully vendored package pass optimized runtime and packaging gates? | Existing thin-LTO, four-binary, vendored-ripgrep publish path; historically about 58 minutes. |

T1/T2 remain the fastest correctness gates. The fast-runnable lane adds
behavioral evidence; it does not replace them. The release/publish lane remains
the only performance and packaging-fidelity claim.

## Current topology

### Profiles

The current workspace already has the lowest-conflict profile needed for the
first implementation:

- `dev`: Cargo development defaults with `debug = "limited"`.
- `dev-small`: inherits `dev`, sets `opt-level = 0`, `debug = "none"`, and
  `strip = "symbols"`.
- `release`: thin LTO, line tables, `strip = false`, and four codegen units.

The measured arm also set `CARGO_INCREMENTAL=1`, removed Rust, sccache, and all
`CARGO_PROFILE_*` override environment families, and used a separate target.
LTO remained off. The convergence rerun captured verbose rustc argv so the
effective profile can be audited. Implementation tests should preserve that
evidence rather than duplicate Cargo defaults as unverified constants.

### Packages and executable seam

- `codex-cli` owns the `codex-core` binary and has 71 direct dependencies.
- `codex-copilot-launcher` owns the `codex` binary and has six dependencies.
- The launcher searches `CODEX_CORE_PATH` first, then
  `codex-core.exe` adjacent to its own executable.
- The launcher is not a cosmetic shim. It owns first-run bootstrap, Copilot
  provider flags, safety-rail configuration, environment setup, and normal
  invocation policy before starting core.

Therefore direct `codex-core.exe` is useful only as a lower-bound diagnostic.
The minimum representative artifact is the adjacent launcher/core pair.
The measured benign unified shell-tool path succeeded with only the pair, so
the narrowest useful development artifact remains launcher plus core. Sibling
sandbox helpers remain required for helper-specific/elevated sandbox paths and
for publish fidelity; those paths are explicit additional smokes, not part of
the minimum edit loop.

## Measured candidate A

Command:

```text
cargo build --locked --profile dev-small \
  -p codex-cli --bin codex-core \
  -p codex-copilot-launcher --bin codex \
  --timings --message-format=json-render-diagnostics
```

Environment:

- target: `D:\codex-targets\frdbt-dev-small-inc`
- incremental: on
- sccache: off
- LTO: off
- linker: `lld-link`
- jobs: 8

| Scenario | Wall time | Rebuilt packages | Result |
|---|---:|---:|---|
| Cold separate-target fill | 619.039s | 985 | Honest cold cost: 10m19.039s, 19.039s above the ten-minute target. |
| Warm no-op | 13.029s | 0 | Fresh. |
| Private semantics-preserving `codex-core` edit | 70.040s | 25 | Runnable output rebuilt in 1m10.040s. |
| Restoration reconciliation | 70.016s | 25 | Original source bytes restored; repository status clean. |
| Post-reconciliation no-op | 7.037s | 0 | Fresh after reconciliation. |
| Public/high-fanout `codex-core` edit | 75.037s | 25 | Runnable output rebuilt in 1m15.037s. |
| High-fanout restoration reconciliation | 78.018s | 25 | Original source bytes restored; repository status clean. |
| Audited private edit with `-vv` | 200.029s | 25 | Slower evidence mode captured rustc argv; still below ten minutes. |
| Audited build through exact-hash authenticated turn | 246.914s | 25 | Built core hash `14bf1d...e6a4f`; smoke recorded the same hash and returned `FAST_RUNNABLE_OK`. |
| Audited build through exact-hash shell-tool turn | 265.944s | 25 | Same changed hash invoked PowerShell, observed exit 0/output `FAST_TOOL_OK`, and returned `FAST_TOOL_OK`. |
| Audited restoration reconciliation | 92.023s | 25 | Source/status restored cleanly after the exact-artifact smoke. |

The low-edit output changed the `codex-core.exe` hash while leaving the launcher
hash unchanged. `codex-copilot-launcher` was absent from the 25 rebuilt
workspace packages, confirming that including the real launcher adds no
changed-core compile fanout after its initial build.

The restored-source reconciliation produced another valid but byte-different
`codex-core.exe`. Binary hash equality is therefore not a safe freshness
contract for this build. The wrapper should record the hash as provenance, but
freshness must be established by a successful Cargo build against the current
source state plus a manifest of repository/toolchain/profile inputs.

The review-closure run closes the opposite direction of that argument: the
changed build and its smoke both recorded
`14bf1df089f856d58bf397e63217b4aab796a72f09a1c26c74ab7ed2c46e6a4f`.
It therefore proves that the changed artifact itself, not only a later restored
artifact, completed both authenticated no-tool and benign shell-tool turns.
`evidence/effective-profile.json` links the captured `codex_core` rustc command
to incremental and symbol-stripping flags; the raw `-vv` command remains in the
stderr evidence.

### Storage and output size

- Target after cold fill: 13,904,021,055 bytes (12.949 GiB).
- Target after edit plus reconciliation: 16,152,048,543 bytes (15.043 GiB).
- Incremental edit/reconciliation growth: about 2.094 GiB.
- Launcher: 1,298,944 bytes (1.239 MiB).
- Core: approximately 360.58 MB (343.88 MiB).

This is fast enough but not cheap. A per-worktree target cleanup command and a
documented disk budget are part of the product, not optional housekeeping.

## Runtime evidence

The smoke script removed `CODEX_CORE_PATH`, so all runs proved adjacent-core
discovery. The exact target executable, not an installed Codex, ran:

| Smoke | Wall time | Exit | What it proves |
|---|---:|---:|---|
| `--version` | 24.044s | 0 | First launch of the newly relinked binary succeeded; earlier built-binary run was 3.047s. |
| `--help` | 6.042s | 0 | Main CLI parses through the built pair. |
| `login --provider copilot --help` | 1.043s | 0 | Fork-specific login command is present. |
| `debug models --bundled` | 1.042s | 0 | Bundled model metadata is readable. |
| `features list` | 1.029s | 0 | Feature/config path runs. |
| `doctor --json` | 4.019s | 0 | Core checks ran; overall status was warning because system `rg.exe` was not found. |
| Authenticated `exec` with no tools | 17.031s | 0 | Real launcher bootstrap/provider path completed a Copilot model turn and returned `FAST_RUNNABLE_OK`. |
| Authenticated shell-tool `exec` | 18.044s | 0 | The pair completed a real Copilot turn, invoked PowerShell through the command tool, observed exit 0/output `FAST_TOOL_OK`, and returned `FAST_TOOL_OK`. |

First-process latency varied materially across runs (3.047-24.044s), likely
including OS scanning/page-cache effects, while warmed parser commands settled
near one second. This does not threaten the ten-minute loop, but implementation
evidence should record first and repeated startup separately.

`doctor` identified the exact running executable as the target's
`codex-core.exe`, model provider `copilot`, and install method `other`.

COFF imports for both native binaries resolve only to Windows system DLLs; no
adjacent third-party DLL was required. However, a raw Cargo target is not the
published vendor layout:

- publish carries `codex.exe`, `codex-core.exe`,
  `codex-windows-sandbox-setup.exe`, and `codex-command-runner.exe`;
- publish also downloads a pinned `rg.exe` under `vendor/.../path`;
- this raw target had no adjacent DLLs, and doctor warned that system
  `rg.exe` was unavailable.

The final doctor run exited 0 but still reported the explicit `rg.exe`
availability warning. The successful benign shell-tool smoke did not require
ripgrep. The fast tier may use a developer-installed `rg.exe`, but must surface that
preflight explicitly. It must not copy or download publish assets implicitly,
and must not claim package fidelity unless the four native binaries and pinned
vendor layout are tested.

## Candidate directions

### D-001 — Extend the canonical verifier with a `dev-small` runnable tier — **GO**

Base implementation on accepted predecessor HEAD `2a95dd19`, extend its
existing tier dispatcher/measurement tooling, use the existing profile with an
explicit isolated environment, and build through the real launcher path.

Why:

- 70.040s changed-core runnable build is far below ten minutes.
- Zero production Rust or release-profile changes are needed.
- The launcher adds no changed-core rebuild fanout.
- Authenticated provider-path smoke succeeded.
- It is naturally additive and default-off.

Tradeoffs:

- cold target warm-up was 10m19.039s;
- each warmed target is about 13-15 GiB;
- opt-level 0 cannot stand in for performance testing;
- raw Cargo output lacks packaged `rg.exe` and may need sandbox helpers for
  tool-using smoke.

### D-002 — New fork-owned `fast-runnable` Cargo profile — **DEFER**

A named profile could freeze opt-level, symbols, codegen units, panic, and
incremental intent. Do not add it in the first implementation because the
existing `dev-small` arm already beats the target, while changing the
upstream-canonical workspace `Cargo.toml` creates recurring rebase conflict.

Reconsider only if:

- `opt-level=0` runtime behavior is too slow for a required smoke;
- Cargo default drift cannot be validated safely by the wrapper;
- a measured opt-level/codegen sweep shows material value.

### D-003 — Direct `codex-core` artifact — **NO-GO as the normal lane**

It is the theoretical minimum binary, but it bypasses launcher bootstrap,
provider policy, safety rails, and environment behavior. Keep it only as an
explicit diagnostic lower bound.

### D-004 — One globally shared target and/or mixed sccache+incremental lane —
**NO-GO**

One shared target creates Cargo lock contention, cross-worktree fingerprint
ambiguity, and stale-artifact ownership problems. Mixing sccache and
incremental compilation makes attribution and cache behavior harder. The
recommended target is deterministic per worktree; alternate cache arms use
separate targets and explicit sccache namespaces.

### D-005 — Split crates or change Rust architecture to reduce linking —
**NO-GO**

The existing profile already turns the 31-minute changed-core build into about
one minute. Crate-boundary work would be high-conflict and unjustified.

## Rigorous A/B matrix

`experiment-design.json` defines the controlled measurement protocol and five
arms:

- A: `dev-small`, incremental on, sccache off — measured primary.
- B: same profile, incremental off, sccache off — isolate incremental value.
- C: same profile, incremental off, sccache on — isolate cross-target cache
  reuse without mixing incremental state.
- D: `dev`, incremental on, limited debug info — debugger-only lane.
- E: conditional opt-level 1 and codegen-unit sweep — runtime responsiveness
  versus compile/link time.

Fixed decisions:

- no LTO in the fast lane;
- no `panic=abort` semantic change;
- no release-profile mutation;
- pair/four-bin launcher path rather than direct core for acceptance;
- no globally shared target.

The stop rule is met: arm A already produces a representative changed-core
launcher-path run below 600 seconds. Do not spend additional cold-target hours
on B-E before implementation unless a concrete debugger, runtime-performance,
or cross-machine cold-cache requirement appears.

## Windows, concurrency, and stale-artifact safety

### Path length

- Long paths are enabled and Git `core.longpaths=true`.
- The source workspace path is already 118 characters before generated
  artifact suffixes.
- `D:` is a `subst` mapping to `C:\dev-drive`.
- The measured target is only 36 characters.

The script should require or derive a short absolute target root. It should
reject a target nested under the deep worktree by default and print the
resolved physical mapping for evidence.

### Target ownership

Each worktree gets a stable target key derived from the canonical worktree path
and patched-Codex repository identity. A lock/owner manifest must include:

- canonical worktree and workspace paths;
- wrapper and patched-Codex commits;
- dirty-state digest;
- toolchain/profile/env fingerprint;
- selected bins;
- build start/completion timestamps;
- produced paths and SHA-256 values.

The script should use an exclusive lock for mutation. A second caller either
waits with an explicit bounded option or fails with the owning PID/path; it
must not race. Do not infer that an old executable is current from its version
string or mere existence.

### Process locks

Windows cannot overwrite a running executable. Before rebuilding, the script
should detect whether any process owns a binary in this target and fail with
the exact path/PID. It must never kill processes by name.

### Cleanup

Provide an explicit cleanup mode that verifies the target owner manifest
before deletion. Never delete a caller-supplied arbitrary directory or the
production release target.

## Test strategy

Implementation acceptance should include:

1. deterministic parser/preflight tests for target derivation, path rejection,
   environment clearing, selected bins, and lock behavior;
2. manifest tests for current, dirty, changed-HEAD, changed-profile, and
   interrupted-build states;
3. real no-op and private core-edit measurement using byte-safe restoration;
4. public/high-fanout edit measurement matching the measured 25-package
   invalidation shape;
5. exact-path launcher smoke with `CODEX_CORE_PATH` unset;
6. authenticated no-tool turn and a benign shell-tool turn;
7. explicit preflight/result for sandbox helper and `rg.exe` availability;
8. T1/T2 checks retained as correctness gates;
9. one optimized release/publish smoke before shipping, outside the fast tier.

Fast-lane success must never waive a failed Cargo command, T1/T2 check, scoped
test, or release gate.

## Upstream conflict surface

First implementation should stay in the Codex wrapper and extend the accepted
predecessor topology:

- add a `runnable` tier to `scripts/verify-core-change.{sh,mjs}`;
- extend `scripts/measure-build.ps1` and its deterministic tests;
- update `CLAUDE.md`, `AGENTS.override.md`, and build-performance docs;
- add only compact, durable evidence.

Avoid edits to:

- `external/repos/codex-patched/codex-rs/Cargo.toml`;
- Rust source or crate boundaries;
- `[profile.release]`;
- publish commands or vendor checks.

Conflict probability is moderate in the predecessor's shared verifier,
measurement script, tests, and documentation. Base on predecessor HEAD and
serialize with other build-performance work.

## Rollback

Rollback removes the `runnable` tier additions from the existing verifier,
measurement script, tests, and docs, then cleans up only owner-verified fast
targets. Existing targeted/workspace/executable/publish semantics, the release
target, publish profile, and installed binaries remain untouched. No data
migration or global toolchain rollback is required.

## Concrete plan seed

Plan an implementation named `codex-fast-runnable-dev-build-tier` in a Codex
wrapper worktree based on accepted predecessor HEAD
`2a95dd19c89fc99492d0e5a25d77cb070fe77da3`, with no upstream-canonical Rust
edits in the initial scope. Preserve predecessor tiers
`targeted|workspace|executable|publish`; add `runnable` rather than repurposing
the existing release-like `executable` tier.

Stories:

1. Extend `scripts/verify-core-change.{sh,mjs}` with explicit `runnable`
   dispatch that self-locates the patched workspace, derives a short
   per-worktree target, clears conflicting Rust/sccache/profile overrides,
   sets incremental on, disables sccache, and invokes the measured
   `dev-small` bin set.
2. Add target owner locking, provenance/freshness manifest generation,
   interrupted-build handling, running-executable detection, and guarded
   cleanup.
3. Decide and codify the native artifact boundary from tool smoke: at minimum
   adjacent launcher/core; include command-runner/sandbox-setup if required for
   representative Windows tool execution. Surface `rg.exe` as an explicit
   preflight rather than silently packaging it.
4. Add exact-path offline, authenticated, and benign tool-use smoke commands
   that prove the target executable ran.
5. Extend `scripts/measure-build.ps1` and deterministic predecessor tests, plus
   one real private/public core-edit measurement; retain T1/T2 and optimized
   executable/publish gates without implicit escalation.
6. Update agent/build docs with the four-contract hierarchy, cold/warm
   expectations, storage budget, concurrency rule, limitations, and rollback.

Acceptance criteria:

- warmed private and public core edits produce the selected runnable artifact
  in at most 600 seconds on the measured host class;
- no-op build invokes no rustc and completes in at most 30 seconds;
- exact-path authenticated launcher smoke succeeds;
- representative benign shell-tool smoke either succeeds with the documented
  helper boundary or fails preflight before starting;
- target ownership prevents concurrent cross-worktree mutation;
- stale/dirty/interrupted provenance cannot be reported as current;
- production release profile and publish command are byte-for-byte unchanged;
- final code and docs reviews report no Medium-or-higher findings.

## Review state

Two independent `gpt-5.6-sol` xhigh review rounds completed. Round 1 found two
Medium issues: the initially smoked binary was post-restoration rather than the
changed hash, and the plan seed duplicated predecessor tooling. Both were
fixed. Round 2 verified exact hash equality, the honest 265.944s
build-through-tool result, clean source restoration, and canonical predecessor
extension topology. Its only Low wording cleanup was fixed. Final state:
**GO, no remaining High, Medium, or Low findings.**
