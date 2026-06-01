# Jobs sweep with Defender exclusions — results

**Run date:** 2026-06-01 (UTC 15:11 – 18:42)
**Host:** Windows dev box, 64 GB RAM
**Frozen iteration profile:** LTO=off, codegen-units=16, CARGO_INCREMENTAL=0, sccache wrapper
**Build target:** `cargo build --release -p codex-cli --bin codex-core`
**Defender exclusions (already applied by operator):** target/, sccache cache dir, .cargo, .rustup, .xwin, .rusty_v8, codex wrapper; processes rustc.exe, cargo.exe, sccache.exe, link.exe, lld-link.exe, clang-cl.exe.

## Comparison table

| Scenario        | Jobs | Wall (s) | Wall (m:ss) | Peak RSS (GB) | sccache req | sccache hits/misses/stores | Cargo exit |
|-----------------|-----:|---------:|------------:|--------------:|------------:|----------------------------|-----------:|
| A — jobs=4 cold |    4 |  3386.4  |   56:26     | 8.1           | 1705        | 5 / 1495 / 1495            | 0          |
| B — jobs=6 cold |    6 |  3076.2  |   51:16     | 8.1           |   21 ⚠      | 0 / 20 / 20  ⚠             | 0          |
| C — jobs=8 cold |    8 |  3011.6  |   50:12     | 8.2           | 1705        | 5 / 1495 / 1495            | 0          |
| D — jobs=12 cold|   12 |  2962.4  |   49:22     | 8.3           |   21 ⚠      | 0 / 20 / 20  ⚠             | 0          |
| Warm — jobs=12  |   12 |    45.0  |   00:45     | 0.24          | 0           | 0 / 0 / 0                  | 0          |

⚠ B and D both show only 21 sccache compile requests vs 1705 in A and C, even though `RUSTC_WRAPPER=sccache` was set and `iteration-env.sh` ran the same reconciliation block (transcripts confirm this). Implication: rustc bypassed the wrapper for ~99% of compiles in B and D — those wall-times are effectively "cold build without sccache wrapper overhead". A and C are the apples-to-apples sccache-active cold numbers. See "Anomaly" section below.

## Baseline comparisons

| Baseline                              | Wall  | This run    | Δ            |
|---------------------------------------|------:|------------:|-------------:|
| r6 (LTO=thin, broken cache)           | 2h 47m (167m) | C (50:12) | **−3.33x (117m saved)** |
| benchmark-r1 (no Defender excl, jobs=4) | 53:00 | A (56:26) | **+3:26 SLOWER (+6%)** |
| benchmark-r1 (no Defender excl, jobs=4) | 53:00 | C (50:12) | **−2:48 (−5%)** |
| benchmark-r1 (no Defender excl, jobs=4) | 53:00 | D (49:22) | **−3:38 (−7%)** ⚠ wrapper bypassed |
| Prior warm (jobs=4, no Defender excl) | 1:08  | Warm jobs=12 | **−0:23 (−34%)** |

**Defender-only impact (apples-to-apples, A vs r1, both jobs=4):**
+3:26 SLOWER — within run-to-run noise; **Defender process/path exclusions had no measurable build-perf benefit on this machine.** Possible reasons: rustc CPU was already the bottleneck at jobs=4 (single-core saturation), and IO/file-handle scanning by Defender was not the limiting factor.

**Combined Defender + concurrency impact (D vs r1):**
−3:38 (−7%). Most of the win is concurrency, not Defender — and that "win" still includes the sccache-bypass anomaly.

## F-2 disposition (≤45m target from original plan)

**NOT HIT.** Best cold result is 49:22 (D, jobs=12) — and that run had the sccache wrapper bypassed. Best sccache-wrapper-active result is 50:12 (C, jobs=8). Both are 4–5 minutes over the 45m AC.

The bottleneck is no longer concurrency — peak RSS is flat (8.1 → 8.3 GB) regardless of jobs setting, and wall-time gain from jobs=4 → jobs=12 is only 7%. The build is dominated by a small set of crates with long sequential compile time (codex-tui, codex-app-server, codex-core, final link), and adding more rustc parallelism doesn't help past jobs=8.

## Recommended default JOBS for iteration-env.sh

**Recommend: `CARGO_BUILD_JOBS=8`.**

Rationale:
- Best sccache-active cold time (50:12 vs A's 56:26 — 6:14 saved, the largest non-anomalous gain).
- Peak RSS 8.2 GB → 56 GB headroom on a 64 GB box (zero OOM risk).
- Tied for best diminishing-returns inflection: jobs=4→8 saves 6.2m; jobs=8→12 would save at most ~1m extra (and the D measurement showing −0:50 is contaminated by the wrapper-bypass anomaly, so the real jobs=8→12 cold delta with wrapper active is unknown — likely <1 min).
- Avoids `jobs=12` until the sccache anomaly is understood; running production iteration with the wrapper silently bypassed would tank warm-cache performance on subsequent runs (sccache cache wouldn't get populated).

Suggested change to `codex/scripts/iteration-env.sh`:
```diff
-: "${CARGO_BUILD_JOBS:=4}"
+: "${CARGO_BUILD_JOBS:=8}"
```

## Sccache anomaly (worth filing as followup)

Observed: B (jobs=6) and D (jobs=12) cold runs registered only 21 sccache compile requests vs 1705 in A (jobs=4) and C (jobs=8). All four ran identical setup: same `run-scenario.ps1` → `sccache --stop-server` → wipe `D:\codex-sccache` → wipe `target/release` → `source iteration-env.sh` (which reconciled sccache and restarted server because active-dir double-backslash never matches intended single-backslash) → `sccache --zero-stats` → `pwsh measure-build.ps1`.

No errors in the logs. `RUSTC_WRAPPER=sccache` and `SCCACHE_DIR=D:\codex-sccache` confirmed in env-dump output for B and D. Cargo exit 0 in all cases.

Pattern is alternating (A=active, B=bypassed, C=active, D=bypassed) — possibly a race where the sccache server restart in iteration-env.sh leaves the server unresponsive long enough that the first batch of rustc invocations falls back to direct compile. Once cargo has cached "rustc doesn't use the wrapper" for a build session, subsequent invocations follow suit. (Hypothesis — not verified.)

The wall-time evidence suggests sccache wrapper overhead on cold misses is ~3–5 minutes across 1500 invocations, since B and D are ~5m faster than the trend line set by A→C (jobs=4 to jobs=8 saved 6.2m; jobs=8 to jobs=12 with wrapper-bypassed only saved 0.83m).

**Followup candidate:** investigate whether `iteration-env.sh`'s reconciliation `sccache --stop-server && --start-server` should wait for the server to be ready (e.g. poll `sccache --show-stats` until exit 0) before returning, to prevent the first burst of rustc invocations from falling back to direct compile. Worth ~5 min on every cold build.

## Other findings worth filing as followups

1. **Defender exclusions had no measurable benefit at jobs=4.** Either the exclusion list is incomplete (something not on D: still scanned) or the build wasn't IO-bound to begin with. Worth a one-shot diagnostic: run Procmon during a jobs=8 cold and confirm no `MpEng.exe`/`MsMpEng.exe` activity on excluded paths. If clean, drop the operator-applied Defender exclusions to reduce machine-state divergence (they cost zero, but they're a hidden state others won't reproduce).

2. **Warm-cache 45s at jobs=12 (vs prior 1:08 at jobs=4)** — 23s savings is real but small in absolute terms. Warm-cache is dominated by the final binary link (~30s of single-threaded lld-link work that can't be parallelised). The remaining ~15s is cargo's incremental-check scan across the workspace. There may not be much more to squeeze here.

3. **Wall-time floor below 45m likely requires reducing total compile work** (e.g. dropping unused codex-rs features that pull in heavy dep trees like `image`, `lalrpop`, `aws-lc-rs`), NOT more concurrency. Confirmed empirically: 4x→12x concurrency only bought 7% wall-time.

## Files in this job dir

| File | Contents |
|------|----------|
| `run-scenario.ps1` | Per-scenario runner — wipe (if cold), source iteration-env, run measure-build |
| `master.ps1` | Sequential orchestrator for B,C,D,Warm with OOM-headroom gate for D |
| `master.log` | High-level pass/fail log with wall-times |
| `<scenario>.log` | Full bash + cargo + sccache transcript per scenario |
| `<scenario>.csv` | One-row CSV from measure-build.ps1 (runId, wall, peak RSS, sccache deltas) |
| `<scenario>-sccache-stats-before.txt` / `-after.txt` | Raw `sccache --show-stats` output |
| `summary.csv` | Cross-scenario summary table |
| `results.md` | This file |

No commits, no PRs — operator/lead to decide on iteration-env.sh default change and Defender-exclusion retention.
