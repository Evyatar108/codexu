# Fast runnable Codex development build tier

## Decision

**GO for a warm runnable-smoke lane; NO-GO for a universal ten-minute claim.**

The selected artifact is the adjacent fork launcher/core pair:

```text
codex.exe
codex-core.exe
```

Build it explicitly with the existing `dev-small` profile, a short
per-worktree `CARGO_TARGET_DIR`, `CARGO_INCREMENTAL=1`, and sccache disabled:

```text
cargo build --locked --profile dev-small \
  -p codex-cli --bin codex-core \
  -p codex-copilot-launcher --bin codex \
  --timings --message-format=json-render-diagnostics
```

This is a separate task after predecessor D-001. The predecessor proved
correctness verification (T1/T2); it intentionally did not provide or run a
changed executable. The new lane proves the real launcher path and therefore
has a distinct artifact, freshness, storage, runtime, and cleanup contract.

## Honest SLOs and measured result

The audit revision separates two contracts:

| Contract | Metric | Budget | Canonical result | Verdict |
|---|---|---:|---:|---|
| Warm changed-core loop | Build start through exact built `codex.exe --version` | <=600s | private 92.963s; high-fanout 98.635s | **PASS** |
| Warm build only | Cargo process | informational | private 68.037s; high-fanout 74.036s | PASS |
| Warm representative behavior | Exact changed launcher/core authenticated and benign shell-tool smoke | functional | private and high-fanout both passed | PASS |
| Cold start, incremental on | Empty target through exact `--version` | <=600s aspirational; <=720s honest setup budget | 648.476s | **FAIL 10m; PASS 12m** |
| Publish fidelity | Existing thin-LTO release/publish path | unchanged | prior ~31m release-like / ~58m publish baseline | separate gate |

The recommendation is therefore **GO for the warm loop only**. A clean target
does not meet a universal ten-minute promise on this host. Cold setup has a
separate 720-second point budget, and the single cold observation is not a
percentile guarantee.

Authenticated/model latency is recorded but is not folded into the build SLO.
For completeness, Arm A finished the benign shell-tool turn at 681.255s cold,
126.926s after the private edit, and 129.550s after the high-fanout edit.

## Why launcher plus core is the narrowest useful artifact

- `codex.exe` is the fork-owned launcher. It owns bootstrap, provider/policy
  setup, and adjacent-core discovery.
- `codex-core.exe` is the changed Rust implementation. Launcher-only cannot
  run; direct core bypasses fork behavior and is only a diagnostic lower bound.
- Smokes ran with `CODEX_CORE_PATH` unset against exact measured binary paths,
  proving adjacent discovery rather than an installed-binary fallback.
- Exact changed binary hashes were captured before source restoration and
  those exact binaries passed `--version`, authenticated no-tool, and benign
  `PowerShell Write-Output FAST_TOOL_OK` turns.
- Import inspection found only Windows system DLL dependencies and no adjacent
  DLLs. Some real commands still need separately packaged helpers such as
  `rg.exe`; the runnable lane must report helper availability rather than claim
  publish completeness.

## Contract separation

1. **Correctness verification:** predecessor T1/T2 remain the fast compile
   checks. They do not imply a runnable artifact.
2. **Runnable smoke:** this lane builds and launches the adjacent pair and
   proves representative authenticated behavior.
3. **Debug/dev performance:** `dev-small` is opt-level 0, no debug symbols,
   stripped symbols, no LTO. It is suitable for behavior iteration, not
   source-level debugging or runtime performance conclusions.
4. **Publish fidelity:** thin LTO, release codegen units, four-binary vendor
   layout, helper packaging, and publish tests remain unchanged and mandatory.

## Exact audit reruns

All nine final runs used the same committed measurement script SHA-256:

```text
49e9dd12d5112bc374ef01755cfcf07af68be22d4d4a17e95e247091a157ac48
```

The smoke script SHA-256 was:

```text
5651946f60324e494fa5053affd1ef1d63cbe4a22a5b2d05353f9ce8064137cc
```

Every run used `verbosity=normal`; `-vv` is emitted only for the explicit
`very-verbose` option. Each compact run manifest records exact Cargo argv,
controlled and cleared environment families, PowerShell executable/version,
culture/timezone, the actual process command line, repository revisions,
target sizes, binary hashes, raw artifact paths/hashes, and smoke results.
Smoke runs enforce a 180-second timeout and verify bounded termination of only
the exact captured process tree. No-tool JSONL must have exactly four
whitelisted events and no tool/error item. Tool JSONL must have exactly six
whitelisted events, one normalized `pwsh` command, exact tool output, and one
exact final message. A separate one-second timeout preflight terminated all
three probes, verified root/tree exit, and left zero target processes.

### Arm A: incremental on, sccache off

Target: `D:\codex-targets\frdbt-audit-a-inc1`

| Run | Build | Build->version | Build->tool | Rebuilt packages |
|---|---:|---:|---:|---:|
| cold | 622.041s | 648.476s | 681.255s | 985 |
| warm no-op | 9.030s | - | - | 0 |
| private core edit | 68.037s | 92.963s | 126.926s | 25 |
| high-fanout core edit | 74.036s | 98.635s | 129.550s | 25 |
| post-reconcile no-op | 7.031s | - | - | 0 |

### Arm B: incremental off, sccache off

Target: `D:\codex-targets\frdbt-audit-b-inc0`

| Run | Build | Rebuilt packages |
|---|---:|---:|
| cold | 465.034s | 985 |
| first post-cold no-op | 81.038s | 0 |
| private core edit | 170.032s | 25 |
| post-reconcile no-op | 7.043s | 0 |

The first Arm B no-op is a one-time stabilization outlier; the post-reconcile
no-op is the steady-state comparison. Cold Arm B was faster in this serial
order, but a single sample after Arm A benefits from different OS/source-cache
state. It does not establish that disabling incremental causally improves cold
builds.

## Attributed storage and cache conclusion

The previous report called 2.094 GiB of *total target growth* incremental
growth. That attribution was invalid and is withdrawn.

The revised driver measures the incremental directory directly:

| State | Whole target | Incremental directory |
|---|---:|---:|
| Arm A cold | 12.949 GiB | 5.184 GiB |
| Arm A after edit/reconcile cycles | 15.054 GiB | 7.286 GiB |
| Arm B cold | 7.729 GiB | 0 |
| Arm B after edit/reconcile | 7.731 GiB | 0 |

Arm A's private edit was 101.995s (60.0%) faster than Arm B's:
68.037s versus 170.032s. The warm-loop benefit and storage cost are therefore
directly observed: incremental compilation buys about 102 seconds for this
private-core edit while retaining 5.184-7.286 GiB of incremental state.

All measured arms disabled sccache. No result attributes speed or storage to
sccache, and no mixed sccache/incremental default should ship without a
separate fresh-target arm.

## Windows, concurrency, and stale-artifact safety

- Use a short target outside the deep worktree. The measured workspace path was
  118 characters; targets were under `D:\codex-targets\`. Long paths were
  enabled, but short object paths still reduce MAX_PATH/tooling risk.
- Never use one global mutable target across worktrees. Derive a per-worktree
  target and protect it with an owner/provenance manifest plus an exclusive
  lock.
- Record wrapper/patched-Codex revisions, dirty state, profile, bins,
  toolchain, environment, timestamps, and exact output hashes.
- On failed or interrupted builds, do not smoke or bless prior executables.
  Restored-source reconciliation must complete before the target becomes
  canonical again.
- Detect running target executables by exact path/PID. Do not kill by process
  name.
- Cleanup must require an owner manifest and may delete only that target. It
  must never touch release targets, arbitrary caller paths, or installed
  binaries.

## Alternatives

### D-001 - extend the accepted predecessor with an explicit runnable tier

**GO.** Reuse its tier dispatch, locking, provenance, byte-safe probe,
reconciliation, tests, and documentation. Add the measured adjacent pair and
exact-path smoke rather than creating a parallel tool.

Tradeoffs: 12-minute cold setup budget, about 15.054 GiB after measured
edit/reconcile cycles, no source-debug symbols, and no publish-fidelity claim.

### D-002 - add a new Cargo profile

**DEFER.** The existing `dev-small` profile already passes the warm SLO.
Changing upstream-canonical `Cargo.toml` adds conflict without evidence that a
new debug/opt/LTO/codegen/panic combination is needed. Reconsider only if a
debugger tier or runtime usability requires it.

### D-003 - direct `codex-core.exe`

**NO-GO as primary.** Useful only as a lower-bound diagnostic because it
bypasses launcher-owned fork behavior.

### D-004 - incremental off

**NO-GO as default.** It saves 5.184-7.286 GiB but made the private edit
101.995s slower. Keep only as a low-disk diagnostic option.

### D-005 - shared target or mixed sccache/incremental

**NO-GO without a new experiment.** Shared mutation introduces lock,
fingerprint, provenance, and cleanup hazards. Sccache causality is unmeasured.

### D-006 - release/LTO or crate-boundary architecture changes

**NO-GO.** They are unnecessary for a warm lane measured at 92.963-98.635
seconds through executable launch and would expand upstream conflict surface.

## Upstream conflict surface, tests, and rollback

The first implementation should stay in fork-owned wrapper scripts, tests, and
docs. Avoid patched-Codex Rust and workspace-profile edits.

Required tests:

- deterministic target derivation and unsafe/deep/shared path rejection;
- environment clearing, fixed profile/bin selection, and sccache policy;
- target owner lock, stale/dirty/changed-HEAD/interrupted manifests;
- byte-safe private/high-fanout probes and reconciliation;
- exact-path version, authenticated, and benign shell-tool smokes;
- helper/DLL preflight reporting;
- retained predecessor T1/T2 and one optimized publish smoke outside the lane.

Rollback is additive: remove the new runnable dispatch, tests, measurement
integration, and docs, then remove only owner-verified fast targets. Existing
verification tiers, release profile, publish command, release targets, and
installed binaries remain untouched.

## Evidence retention and repository footprint

Raw Cargo JSONL, stderr, and timing HTML are external to git under:

```text
D:\codex-targets\frdbt-evidence\audit-20260716-v2
```

`evidence/raw-evidence-manifest.json` covers 36 raw files / 20.83 MiB and
independently verified every current SHA-256. Retain them until implementation
plan acceptance or 2026-08-15, whichever is later.

Repository evidence is bounded to 48 files, 450,509 bytes, and 9,390 physical
lines: scripts, compact run/smoke manifests and exact outputs, profile and
provenance, summaries, and the checksummed external-raw manifest. Cargo JSONL,
timing HTML, and verbose logs are not committed.

## Concrete plan seed

Implement an additive, explicit, default-off `runnable` lane by extending the
accepted predecessor at
`2a95dd19c89fc99492d0e5a25d77cb070fe77da3`.

1. Extend `scripts/verify-core-change.{sh,mjs}` rather than adding a parallel
   command. Build `codex-cli/codex-core` plus
   `codex-copilot-launcher/codex` with `dev-small`, a short per-worktree
   target, incremental on, sccache off, and all conflicting overrides cleared.
2. Add exclusive ownership/locking, provenance and freshness manifests,
   interrupted-build fail-closed behavior, exact-path running-process
   detection, and guarded cleanup.
3. Add exact-path version, authenticated no-tool, and benign shell-tool smokes
   with `CODEX_CORE_PATH` unset. Report optional helper/package gaps without
   weakening publish.
4. Extend predecessor measurement/tests to retain exact command/environment,
   binary hashes, separate incremental-directory sizing, and external raw
   evidence hashes.
5. Document four distinct contracts: T1/T2 correctness, warm runnable smoke,
   debugger/runtime-performance limitations, and publish fidelity.

Acceptance:

- private and high-fanout changed-core artifacts complete build-through-version
  within 600 seconds on the controlled warm host;
- exact changed artifacts pass authenticated and benign shell-tool smokes;
- post-reconcile no-op rebuilds zero packages and completes within 30 seconds;
- clean-target build-through-version is reported separately against a
  720-second setup budget, never marketed as the warm SLO;
- unsafe concurrency, stale/interrupted provenance, or unowned cleanup fails
  closed;
- production release/publish configuration remains byte-for-byte unchanged;
- code and docs review converge with no Medium-or-higher findings.
