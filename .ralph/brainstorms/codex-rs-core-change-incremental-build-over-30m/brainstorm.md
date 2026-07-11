# Codex core-change incremental verification: measurement-led brainstorm

- **Overview task:** `codex-rs-core-change-incremental-build-over-30m`
- **Measured:** 2026-07-11 on the shared Windows 11 development host
- **Wrapper commit:** `3ff55692e7045e85ce78ebe8337ab40b55494c9c`
- **Patched Codex commit:** `587a6a8ab8948ff912b1f24a62833b277934302d`
- **Recommended direction:** D-001 — make a measured tiered verifier the canonical entry point; keep executable and publish builds explicit.

## Executive conclusion

The reported 30+ minute symptom is real for a release-mode executable build after
`codex-core` changes: the warm private one-line probe reproduced it at
**30m 45.75s**. It is not the right per-edit verification gate.
The measured warm, representative private `codex-core` edit passed
`cargo check -p codex-core` in **37.45 seconds**. A target directory that did not
exist yet reached the same gate in **5m 01.78s**, and a no-op rerun took
**6.25 seconds**. Therefore the task's representative warm verification target
of <=10 minutes is already feasible, and the <=5-minute stretch target is
feasible with substantial margin, without changing upstream Rust source,
features, LTO, codegen units, or linker.

The engineering gap is enforcement and observability, not another speculative
compiler flag:

1. The current Phase 5a command is `cargo check --workspace`; it measured
   **5m 38.83s** under the high-fanout probe and is not the 30-minute symptom.
   The symptom is the optimized executable build. Conflating those gates is
   the central workflow error.
2. Existing prose correctly says to iterate with per-crate check and gate with
   workspace check, but the expensive release build is still easy to use as a
   generic "verification build."
3. A changed `codex-core` invocation is necessarily an sccache miss for that
   crate. In check mode the measured work was almost entirely the
   `codex-core` frontend: **30.65s frontend, 0.06s codegen**.
4. A fresh worktree-local target pays non-cacheable/native setup even with a
   healthy shared sccache. The initial check's largest unit was the
   `aws-lc-sys` build script at **131.86s**; `codex-core` itself was only
   **30.82s**.
5. The current cache is not showing the old corruption signature:
   the initial check completed with 1,005 hits, 362 misses, 180 non-cacheable
   requests, and **zero read/write/cache errors**. Do not wipe the healthy
   10.5 GiB cache merely because the pending June task says to.
6. `scripts/iteration-env.sh` still restarts sccache when sourced because the
   human-readable stats expose `D:\\codex-sccache` while the intended path is
   `D:\codex-sccache`. That is a real low-cost bug, but it is not a 30-minute
   root cause.

The lowest-conflict implementation is wrapper-only: add one tiered verification
entry point, generalize the existing measurement wrapper to checks, fix path
normalization in `iteration-env.sh`, and make agents/runbooks invoke the tiered
entry point. Keep the current frozen iteration executable profile and the
slower thin-LTO/no-sccache publish gate unchanged.

## Scope and constraints

### In scope

- Explain current per-edit, workspace, executable, and publish costs separately.
- Preserve the canonical LLVM/xwin/sccache environment.
- Make targeted check the default per-edit command.
- Keep workspace check as the hard pre-commit/rebase type gate.
- Keep runnable-binary and publish-equivalent builds as explicit slower tiers.
- Fix the sccache path-equivalence restart bug.
- Record compact timing/cache evidence so regressions are visible.

### Out of scope

- Making the thin-LTO publish build complete in <=10 minutes.
- Repeating the reverted GIF/voice feature-pruning experiment.
- Clearing a cache that currently completes large request sets with zero errors.
- Changing `codex-rs` Cargo features, release profile defaults, or crate
  boundaries without new evidence.
- Sharing one mutable Cargo target directory across concurrent worktrees by
  default.
- Treating `cargo nextest` as a compiler-speed fix; it only reduces test
  execution overhead after compilation.

## Measured environment

| Item | Value |
|---|---|
| Host | Windows 11, 16 logical build cores available to Cargo, 64 GiB RAM; shared host load varied |
| Cargo | `cargo 1.95.0 (f2d3ce0bd 2026-03-21)` |
| rustc | `rustc 1.95.0 (59807616e 2026-04-14)`, LLVM 22.1.2 |
| sccache | 0.15.0 |
| Compiler/linker | `clang-cl`; `lld-link` at `C:\Program Files\LLVM\bin\lld-link.exe` |
| Target directory | Worktree-local `codex-rs\target`; `CARGO_TARGET_DIR` unset |
| Iteration profile | release LTO=off, codegen-units=16, jobs=8, incremental=0 |
| Cache | `RUSTC_WRAPPER=sccache`, `SCCACHE_DIR=D:\codex-sccache`, size limit 50G |
| Cache on disk before matrix | approximately 10.52 GiB / 11,852 files |
| RUSTFLAGS | unset |

The checked-in release profile currently says thin LTO/codegen-units=4, but
`scripts/iteration-env.sh` deliberately overrides it to LTO=off/codegen-units=16
for executable iteration. The publish runbook deliberately resets iteration
state and uses thin LTO/codegen-units=16 without sccache.

## Probe selection and byte-safety

The probes were selected from source/reference evidence rather than invented
dummy files.

### Low-fanout probe

- File: `codex-rs/core/src/session_prefix.rs`
- Symbol: private `pub(crate) fn format_subagent_context_line`
- Reference evidence: exactly one import and one call outside the definition,
  both inside `codex-core`.
- Semantics-preserving implementation edit:

```diff
-        None => format!("- {agent_reference}"),
+        None => ["- ", agent_reference].concat(),
```

- Original SHA-256:
  `f8e9500c865c4ae6a6e1b71742f9c3eaf24597062aead78e390e27313359d66c`
- Edited SHA-256:
  `22b6b7cd519ba754e69b017d6e09c4b7e1d5a05836e3f60bca81d59ab2fef054`

### High-fanout probe

- File: `codex-rs/core/src/config/mod.rs`
- Surface: public `Config` type, imported through
  `codex_core::config` in 185 matches across 117 Rust files; 25 package
  manifests directly depend on `codex-core`.
- Probe: add temporary `#[inline]` to
  `Config::legacy_sandbox_policy(&self) -> SandboxPolicy`. This is a real
  public metadata/codegen-relevant change and is more representative of a
  high-fanout API/body edit than whitespace or a comment.
- Original SHA-256:
  `eb5bfc443624e876f5948a463f7e30f3c7133b3277d73aeb772126905a0e4a59`
- Edited SHA-256:
  `afaad467929b48614fd9b640f065db431e161214b9bf975aad38f6ede6ba021b`

Each original file was snapshotted as bytes before measurement. Every edit is
restored from that snapshot, the original SHA-256 and timestamp are checked,
and the nested patched worktree must end clean.

The warm low-fanout executable measurement uses the reverse of the same
one-line diff: after the edited build completes, the original bytes are
restored and the source mtime is advanced once so Cargo observes the change.
After measurement the snapshot restore runs again to recover the exact
original timestamp.

## Reproducible measurement matrix

All current measurements use:

```bash
cd <codex-wrapper-worktree>
source scripts/iteration-env.sh
cd external/repos/codex-patched/codex-rs
```

The exact Cargo commands are shown below. Wall time includes Cargo/rustc/link
but excludes the environment setup immediately before the measurement.
sccache values are per-scenario deltas; sccache 0.15 emits duplicated
`counts`/`adv_counts`, so the table uses `counts` only.

| Scenario | Command | Target state / source state | Wall | Rebuilt | sccache hits / misses / non-cacheable / errors | Main timing evidence |
|---|---|---|---:|---|---|---|
| Initial targeted check | `cargo check -p codex-core --timings` | Target absent; pristine source | **301.78s (5:01.78)** | 853 packages / 1,108 artifacts | 1,005 / 362 / 180 / 0 | `aws-lc-sys` build script 131.86s; app-server-protocol check 43.86s; `codex-core` check 30.82s |
| No-op targeted check | same | Warm target; no source change | **6.25s** | 0 | 0 / 0 / 0 / 0 | Cargo freshness scan only |
| Low-fanout targeted check | same | Warm target; private formatter edit | **37.45s** | `codex-core` only | 0 / 1 / 1 / 0 | `codex-core` 30.71s: frontend 30.65s, codegen 0.06s |
| Cold/current-fingerprint iteration executable build | `cargo build --release -p codex-cli --bin codex-core -p codex-copilot-launcher --bin codex --timings` | Release target cold for current fingerprint; low probe applied | **3050.42s (50:50.42)** | 974 package IDs / 1,355 timing units | 21 / 1,514 / 196 / 0 | `aws-lc-sys` build script 466.03s; `codex-tui` 418.37s; final `codex-cli` bin 366.34s; `codex-exec` 344.12s; app server 327.53s; `codex-core` 296.01s |
| Warm low-fanout iteration executable build | same | Warm release target; reverse of private formatter edit | **1845.75s (30:45.75)** | 25 package IDs | 0 / 25 / 1 / 0 | `codex-tui` 437.39s; final `codex-cli` bin 429.87s; `codex-exec` 358.98s; app server 311.29s; `codex-core` 248.23s |
| High-fanout workspace check / Phase 5a | `cargo check --workspace --timings` | Target warmed by targeted checks; first workspace-wide feature union; public `Config` metadata/body probe | **338.83s (5:38.83)** | 383 package IDs | 157 / 274 / 59 / 0 | app-server-protocol 52.29s; `codex-core` 36.20s; `codex-tui` 26.26s; app server 18.05s |
| Warm high-fanout iteration executable build | iteration build command above | Warm release target; public `Config` probe | **1850.61s (30:50.61)** | 25 package IDs | 0 / 25 / 1 / 0 | final `codex-cli` bin 421.60s; `codex-tui` 416.32s; app server 367.05s; `codex-exec` 343.08s; `codex-core` 269.72s |

### Historical controls that should not be repeated without a decision need

| Control | Result | Interpretation |
|---|---:|---|
| Cold iteration build, jobs=4 | 53:01 | Frozen LTO-off profile still has a large cold compile |
| Best valid cold jobs sweep, jobs=8 | 50:12 | More jobs beyond 8 had diminishing returns |
| Warm link-only floor | 45-68s | LTO-off final link is not the 30-minute root cause |
| Thin-LTO build | 58:05, 939 crates, zero sccache requests | sccache bypasses Rust LTO builds; publish-only |
| Feature pruning baseline / no-GIF / no-voice | 2682.9s / 2893.7s / 2839.5s | Both prunes were slower; changes were reverted |
| Defender exclusions | No measurable jobs=4 win | Do not revisit as primary lever |

The exact current thin-LTO/no-sccache publish matrix is intentionally staged
rather than repeated here: it is a long release-equivalent scenario with
direct historical evidence, and it would need a separate target directory to
avoid replacing the canonical LTO-off target fingerprint.

## What the measurements say

### Compile versus link versus setup

- **Targeted check:** the changed crate's frontend dominates. The measured
  private core edit spent 30.65 of 30.71 `codex-core` seconds in the frontend,
  with effectively no codegen and no final executable link.
- **Fresh target setup:** native/build-script work dominates the first check.
  `aws-lc-sys` alone consumed 131.86s. sccache does not eliminate all build
  scripts or non-cacheable steps.
- **Cold LTO-off executable build:** rustc/native work, not the final linker,
  dominates. The critical units included a 466.03s native `aws-lc-sys` build
  script and six Rust units between 278s and 418s. The final `codex-cli` binary
  unit was 366.34s, while an isolated no-source-change relink is historically
  only 45-68s; at least roughly five minutes of that final unit is
  monomorphization/code generation and changed-input processing rather than
  pure `lld-link`.
- **Warm LTO-off executable build:** the private one-line `codex-core` change
  still took 30:45.75. It rebuilt 25 package IDs with 0 sccache hits, 25
  misses, one non-cacheable compilation, and zero cache errors. There were no
  long native setup units; the time is the optimized Rust dependency cascade:
  `codex-core` 248.23s, app server 311.29s, `codex-exec` 358.98s,
  `codex-tui` 437.39s, and the final binary 429.87s.
- **Publish builds:** prior evidence shows thin LTO bypasses sccache and takes
  about 58 minutes even before considering a changed core. That cost belongs
  to the release-equivalent tier.

### Invalidation

- The low-fanout check rebuilt only `codex-core`; this is the ideal per-edit
  gate and directly falsifies the assumption that every core edit requires a
  workspace or executable rebuild.
- In release mode the same private one-line change caused a downstream wave:
  the changed `codex-core` artifact altered dependent compilation/cache keys,
  so unchanged direct consumers were misses rather than reusable hits. The
  relevant "fanout" for executable builds is therefore the 25-package crate
  dependency surface, not only the edited symbol's source references.
- The public high-fanout probe plus the first workspace-wide feature union
  rebuilt 383 package IDs, including `codex-core`, TUI, app-server, and
  transport consumers. Even that broad invalidation completed the Phase 5a
  check in 5:38.83, below both the 10-minute target and the existing
  approximately-six-minute policy expectation. This directly argues against
  a crate split for the verification goal.
- In optimized executable mode the low/private and high/public probes were
  effectively identical: 30:45.75 versus 30:50.61 (4.86s, 0.26% apart), both
  rebuilt 25 package IDs, and both recorded 0 hits / 25 misses / 1
  non-cacheable / 0 errors. Symbol-level fanout did not control the release
  result; changing the `codex-core` crate artifact did.
- A newly changed crate key cannot reuse the prior artifact (unless that exact
  new content/key was cached elsewhere). sccache's value is preserving
  compatible dependencies, not making changed `codex-core` work vanish.

### Cache health and environment invalidation

- The old corruption symptom was hundreds of false metadata/rlib errors.
  None appeared.
- The initial check exercised 1,367 cacheable requests with 1,005 hits and
  362 misses, plus 180 non-cacheable requests, and completed with zero cache
  errors.
- The first current-fingerprint release build began mostly cold (for example,
  after about ten minutes it had 21 hits and 1,431 misses) despite a 10.5 GiB
  cache. That is fingerprint coverage, not evidence of corruption: check-mode
  entries hit, while current release-mode entries mostly did not yet exist.
- On the subsequent warm private edit, unchanged consumer source still produced
  25 misses and zero hits because the changed `codex-core` dependency artifact
  changes each downstream rustc command/cache key. sccache is functioning
  correctly; it cannot reuse an object built against a different core artifact.
- Do not execute the pending cache wipe unconditionally. Replace it with a
  health probe and wipe only after a reproducible cache error. The current
  matrix itself naturally rewarms current fingerprints.
- `iteration-env.sh` compares an escaped display path against an unescaped
  Windows path at lines 118-125 and therefore restarts the server on repeated
  shell sourcing. Normalize slash escaping and case before comparison.

## Lever disposition

| Lever | Disposition | Reason |
|---|---|---|
| Targeted check / workspace check / slower build tiers | **Adopt now** | Directly measured; preserves a hard workspace gate and release gate |
| Stable environment fingerprint | **Adopt now** | LTO/codegen/RUSTFLAGS drift invalidates cached work; command should print and validate it |
| Preserve a worktree target between edits | **Adopt now** | Initial check 301.78s versus warm changed check 37.45s |
| One global shared Cargo target | **Do not default** | Concurrent worktrees are normal; lock contention and branch churn need a separate design |
| LTO=off / codegen-units=16 / lld-link | **Keep** | Already the measured fast executable profile; link-only floor is under 70s |
| Existing `dev-small` / Cargo incremental without sccache | **Conditional A/B only** | Plausible for repeated runnable-binary edits, but needs a separate target and expensive warm-up |
| Cache wipe and rewarm | **Do not run now** | Current cache has hits and zero errors; a wipe would deliberately create a 50-minute cold state |
| Remote sccache | **Low-priority follow-up** | Could seed exact current release fingerprints across machines, but cannot hit changed `codex-core` or thin-LTO publish work |
| `cargo nextest` | **Scoped-test option, not build fix** | Improves test execution scheduling after compilation; does not remove core compile/codegen |
| High-fanout crate split | **Defer** | Downstream invalidation is proven, but a split is unnecessary for the measured check goal; consider only after the fast-runnable A/B if runnable output must meet <=10m |
| Feature pruning | **Closed** | Prior GIF/voice A/B was slower and reverted |
| Defender exclusions | **Closed as primary lever** | Prior controlled jobs=4 comparison found no measurable improvement |

## Root-cause ranking

| Rank | Cause | Confidence | Evidence |
|---:|---|---|---|
| 1 | Crate-granular optimized rebuild through `codex-core`'s 25-package consumer surface | High | A private one-line edit rebuilt 25 package IDs, produced 0 hits / 25 misses, and took 30:45.75 |
| 2 | Release executable build is being used as a generic per-edit verification gate | High | The same edit checked in 37.45s; broad workspace check completed in 5:38.83 |
| 3 | Fresh worktree-local release targets and cold exact fingerprints add the full native/dependency graph | High | Cold/current-fingerprint run 50:50.42; `aws-lc-sys` alone 466.03s |
| 4 | sccache cannot reuse a changed crate or consumers whose dependency key changed | High | Warm private edit had zero hits despite a healthy cache and unchanged consumer source |
| 5 | Thin-LTO publish build bypasses sccache | High, release tier only | Historical 58:05 with zero sccache requests |
| 6 | sccache escaped-path restart bug | High but low impact | Repeated `D:\\...` versus `D:\...` mismatch at source lines 118-125 |
| 7 | Cache corruption | Low today | Zero errors across large check/release request sets; no metadata-stub failure |
| 8 | Defender or feature graph | Disconfirmed as primary | Defender no win; GIF/voice prunes measured slower and were reverted |

## Candidate directions

### D-001 — Canonical measured tiered verifier (recommended)

Create one wrapper-only verification entry point and make it the command agents
and runbooks use:

| Tier | Trigger | Command | Contract |
|---|---|---|---|
| T1: edit loop | Every coherent `codex-core` edit | `cargo check -p codex-core --timings` | Warm <=5m; hard ceiling <=10m |
| T2: integration gate | Before commit / rebase Phase 5a | `cargo check --workspace --timings` plus tests for touched crates | Warm <=10m |
| T3: runnable behavior | Only when the change must be exercised in an executable | Frozen LTO-off `-p codex-cli --bin codex-core`; add the launcher only when its surface changed | Explicit slow tier; never implicit in T1/T2 |
| T4: release equivalent | Release cut / explicit CI-parity request | Existing thin-LTO, no-sccache publish command plus smoke | Slow by design and unchanged |

The command should emit wall time, environment fingerprint, target directory,
Cargo timing path, rebuilt package set, and sccache hit/miss/non-cacheable/error
deltas. It should warn on a cold/missing target and on profile drift, and print
the next tier rather than silently running it.

Why this leads:

- It meets the task target with measured current behavior.
- It changes wrapper tooling and docs, not upstream canonical Rust.
- It preserves verification strength by adding a workspace hard gate and
  retaining explicit executable/release tiers.
- It makes the already-correct prose operational, reducing agent confusion.
- It provides evidence before any future profile or crate-boundary change.

### D-002 — Separate incremental fast-runnable lane (conditional experiment)

If the product requirement is specifically "produce a runnable changed binary
in <=10 minutes," stage an A/B using a separate target:

- first test the existing `dev-small` profile; compare it with release-opt
  incremental only if needed;
- unset `RUSTC_WRAPPER` and the iteration release overrides;
- set `CARGO_INCREMENTAL=1`;
- use a versioned dedicated target directory;
- build only `-p codex-cli --bin codex-core`;
- warm it once, then measure the same low/high probes;
- compare changed-core rustc and link wall time, not the cold warm-up.

Do not make this canonical without evidence. It trades away reusable sccache
objects, consumes another large target directory, and can regress clean or
cross-worktree builds. The current <=10-minute verification goal does not need
it because check mode already wins by a wide margin.

### D-003 — Split/stabilize high-fanout `codex-core` boundaries (defer)

The private low-fanout release probe already shows crate-granular downstream
recompilation, so there is evidence for the problem. It is still not the first
move: a useful split would need consumers to depend on narrower stable crates,
not merely move a module into a leaf crate that `codex-core` immediately wraps
(that would still rebuild `codex-core` and its consumers). Pursue this only if
a runnable binary must meet <=10 minutes and the lower-conflict incremental
fast-runnable experiment fails. This direction has the largest upstream
rebase/conflict surface and is unnecessary for the measured check-based
verification goal.

## Recommended implementation files

All paths are relative to the Codex wrapper worktree.

### Change

- `scripts/verify-core-change.sh` — new tier dispatcher; defaults to T1,
  requires an explicit flag for T3, and delegates release work to the existing
  publish command.
- `scripts/measure-build.ps1` — generalize the existing release-only
  measurement wrapper to `core-check`, `workspace-check`, and
  `iteration-build`; capture non-cacheable/error counters, environment
  fingerprint, rebuilt packages, and timing artifact.
- `scripts/iteration-env.sh` — normalize escaped/case-insensitive Windows cache
  paths before deciding to restart sccache; print target/fingerprint state.
- `.claude/commands/rebase-upstream.md` — invoke the T1/T2 wrapper, retaining
  T2 as the Phase 5a hard gate.
- `.claude/commands/publish-sandbox-patch.md` — use T1/T3 names in the
  iteration section while leaving the T4 publish command unchanged.
- `CLAUDE.md`
- `AGENTS.override.md`
  - keep their duplicated local verification hierarchy synchronized and point
    to the executable command, not only prose.
- `docs/implementation/build-perf.md` — add this matrix, explain cold target
  versus changed crate versus link, and supersede unconditional cache-wipe
  advice with a health gate.

### Reference, do not change initially

- `external/repos/codex-patched/codex-rs/core/src/session_prefix.rs`
- `external/repos/codex-patched/codex-rs/core/src/config/mod.rs`
- `external/repos/codex-patched/codex-rs/Cargo.toml`
- `external/repos/codex-patched/codex-rs/justfile`
- `.ralph/jobs/codex-rs-build-perf-baseline-measurement/benchmark-results.md`
- `.ralph/jobs/codex-rs-build-perf-jobs-sweep-with-defender/results.md`

## Conflict surface and common mistakes

- `scripts/iteration-env.sh` and `scripts/measure-build.ps1` are shared build
  infrastructure. Serialize with any pending build-perf/cache implementation.
- `CLAUDE.md` and `AGENTS.override.md` repeat the hierarchy; changing only one
  creates agent-dependent behavior.
- Do not use `cargo build -p codex-core` as a binary gate. That package is the
  library; the binary is `-p codex-cli --bin codex-core`.
- Do not label a deleted-binary relink as an incremental core edit. Historical
  45-68s runs measured a link-only floor.
- Do not compare the first build after changing LTO/codegen/RUSTFLAGS with a
  warm build. Those values alter the cache fingerprint.
- Do not enable Cargo incremental in the sccache target; the two strategies are
  intentionally separated.
- Do not set one global shared target by default without concurrency testing.
  Concurrent worktrees are normal in this repository.
- Do not wipe `D:\codex-sccache` while it is returning successful hits with
  zero errors.
- Do not repeat feature pruning absent new dependency evidence; it was already
  measured and reverted.

## Acceptance thresholds

1. On the measured host and a warm target, the low-fanout probe (or an
   equivalent private `codex-core` edit) passes T1 in <=5 minutes; <=10 minutes
   is the hard acceptance ceiling.
2. The high-fanout public probe passes T2 in <=10 minutes on a warm target.
3. A T1 no-op completes in <=30 seconds and invokes no rustc.
4. T1/T2 output records command, SHA, target dir, toolchain, LTO,
   codegen-units, incremental mode, jobs, linker, sccache location, and cache
   errors.
5. T3 is never invoked by default or as a hidden consequence of T1/T2.
6. T4 retains thin LTO/no-sccache and the existing runtime/release smoke; the
   task does not claim that T4 is <=10 minutes.
7. Sourcing `scripts/iteration-env.sh` twice against
   `D:\codex-sccache` leaves the same server alive and does not reset its stats
   solely because the displayed path contains escaped backslashes.
8. A cache wipe requires a reproducible cache read/write/metadata error; a cold
   fingerprint alone is not sufficient.
9. No `codex-rs` source, Cargo feature, or crate-boundary change is introduced
   by the first implementation.
10. Documentation and agent guidance name the same tier commands and
    thresholds.

## Plan seed

**Goal:** make representative warm `codex-core` verification reliably
sub-10-minute by operationalizing checks as the default, while preserving
explicit executable and publish gates.

**Suggested implementation worktree:** create the implementation in the Codex
wrapper repository at
`D:\harness-efforts\codexu\codex\.worktrees\codex-core-verification-tiers`
(suggested branch `ralph/codex-core-verification-tiers`). Do not implement in
the codexu artifact worktree used for this brainstorm.

**Suggested stories:**

1. Generalize `scripts/measure-build.ps1` to measure core check, workspace
   check, and iteration build without breaking its existing default/CSV
   compatibility.
2. Add `scripts/verify-core-change.sh` with explicit T1/T2/T3 dispatch,
   thresholds, fingerprint output, and non-escalating behavior.
3. Fix escaped Windows path comparison in `scripts/iteration-env.sh` and
   dogfood repeated sourcing against the installed sccache.
4. Update rebase, publish, CLAUDE/AGENTS, and build-perf docs in one commit so
   the executable command is canonical everywhere.
5. Re-run the low/high probes through the final command; retain compact JSON
   evidence and verify the nested patched worktree remains untouched.
6. Bookkeeping follow-up: rewrite or archive
   `build-env-sccache-cache-wipe-and-rewarm`; its unconditional wipe premise is
   stale against the current zero-error cache evidence.
7. Only if T3 remains a hard product need under 10 minutes, create a separate
   follow-up experiment for no-sccache incremental codegen. Do not bundle it
   into the first implementation.

**Decision:** proceed with D-001. D-002 is a measured follow-up only if a
runnable binary, rather than compile/type verification, must meet <=10
minutes. D-003 remains deferred.

## Evidence review

- Current measurements are machine-generated from Cargo JSON messages,
  Cargo timing HTML, process sampling, and sccache JSON counters. The compact
  committed record is `measurements.json`; multi-megabyte build logs are not
  committed.
- The low probe's fanout claim was checked against all Rust source: one import,
  one call, and the definition.
- The high probe's fanout claim was checked against Rust imports and Cargo
  manifests: 185 `codex_core::config` import matches in 117 files and 25
  direct package dependencies.
- The sccache health conclusion uses `counts`, not the duplicated
  `adv_counts` representation in sccache 0.15.
- The link conclusion is not inferred from total Cargo time: it is
  cross-checked against Cargo units and the prior deleted-binary link-only
  controls.
- The recommendation does not claim the publish build is fast. It explicitly
  retains the measured slow release-equivalent gate.
- The plan does not claim remote cache or Cargo incremental will win; both are
  conditional follow-ups requiring a separate-target A/B.
- Source files are restored by hash, and a final nested-worktree clean check
  is required before committing these artifacts.

## Remaining long benchmark

No required current-state scenario remains unmeasured. Two intentionally
deferred, separate-target experiments remain:

1. **Fast runnable A/B, only if a runnable binary must meet <=10 minutes.**
   Unset sccache/release overrides, set `CARGO_INCREMENTAL=1`, set a versioned
   `CARGO_TARGET_DIR`, warm
   `cargo build --profile dev-small -p codex-cli --bin codex-core`, then repeat
   the low/high probes. The cold warm-up is expected to be long and must not be
   compared with a warm edit.
2. **Current exact thin-LTO/no-sccache publish benchmark.** Run it in a
   separate target at the next actual release decision. Historical direct
   evidence is already 58:05 with zero sccache requests, so rerunning it now
   would not alter the tiered-verification decision.

Remote-cache seeding is lower priority and should be measured only if exact
cross-machine release fingerprints recur often enough to justify the
operational and trust surface.
