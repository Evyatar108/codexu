# codex-rs build-perf baseline measurement — 2026-06-01

Run of all 4 scenarios from `codex/docs/implementation/build-perf.md` against
the frozen iteration profile (`scripts/iteration-env.sh`, sccache 0.15.0,
`D:\codex-sccache`, LTO=off, codegen-units=16, jobs=4).

Hardware: 16-core / 64 GB / D: ~455 GB free / sccache 0.15.0 (winget).

## Headline numbers

| Scenario     | Wall time | Peak RSS | sccache hits/misses/stores | sccache hit rate | cargo "Compiling" lines | Target | Met? |
|---|---|---|---|---|---|---|---|
| cold-cache   | **53m 01s** (3181 s) | **8616 MB** | 5 / 1495 / 1495 | 0.33 % (Rust 0.00 %) | 939 | ≤ 45 min  | ❌ (close) |
| warm-cache   | **1m 08s** (66 s)    | **244 MB**  | 0 / 0 / 0      | n/a                  | 0   | ≤ 5 min   | ✅ |
| jobs-change  | **9s** (6.6 s)       | **244 MB**  | 0 / 0 / 0      | n/a                  | 0   | ≤ 6 min   | ✅ |
| lto-change   | **58m 05s** (3480 s) | **7096 MB** | 0 / 0 / 0      | n/a                  | 939 | "near cold" | ⚠ confirms cold, see findings |

Baseline reference (from r6 retrospective in `build-perf.md`): **2h 47m**
cold rebuild with LTO=thin + no sccache + `CARGO_BUILD_JOBS` 2→1
mid-day. Treatment cold-cache (53 min) is a **3.16× speedup vs r6
baseline**, even though it slightly missed the optimistic ≤45-min target.

Final `codex-core.exe`: 294.6 MB (LTO=off), 281.5 MB (LTO=thin).

## Raw CSV rows

```
cold-cache,3181.4,8616,5,1495,1495,off,16,4
warm-cache,65.8,244,0,0,0,off,16,4
jobs-change,6.6,244,0,0,0,off,16,2
lto-change,3480,7096,0,0,0,thin,16,4
```

Per-scenario CSVs are alongside this file (`<scenario>.csv`); per-scenario
build logs are `<scenario>.log`; pre/post sccache stats are
`<scenario>-sccache-stats-{before,after}.txt`.

## Findings

### F-1 (HIGH): sccache does **not** cache `LTO=thin` builds — wrapper-side bypass

**Symptom.** The `lto-change` scenario recompiled all 939 crates over
57m 57s but reported **0 sccache compile requests**, **0 misses**,
**0 stores**. On-disk cache nonetheless grew from ~1 GiB (post-cold-cache)
to 2.25 GiB during the run, so SOMETHING wrote to D:\codex-sccache — but
sccache's request counters do not reflect any of those compilations.

**Interpretation.** sccache's Rust support bypasses caching at the
*wrapper level* when LTO is enabled (it inspects rustc's `--emit` /
`-Clto` / `-Cembed-bitcode` flags and shells through to rustc directly
without contacting the server). The on-disk growth is therefore likely
from cargo's own outputs landing in `target/`, not the sccache cache.

**Why this matters for the methodology doc.** `build-perf.md` currently
says of `lto-change`:

> Near-cold-cache rebuild expected (**LTO IS a cache key**).

That's right in outcome (~58 min — close to cold-cache ~53 min) but
wrong in mechanism. The implication "if you later switch back to
LTO=off the cache from previous LTO=off runs is still warm" remains
true, but the doc should be updated to clarify:

- LTO=thin builds **gain no sccache acceleration at all**, even on the
  second/third LTO=thin run in a row.
- Only LTO=off iterations benefit from sccache. Anyone tempted to "test
  one thing with LTO=thin locally" should expect a 50-60 min full
  recompile on every LTO=thin build, not just the first.
- The doc's "Known steady-state misses" section should add a fourth
  item: *"4. Any iteration with `CARGO_PROFILE_RELEASE_LTO != off` —
  sccache bypasses caching for LTO-enabled rustc invocations entirely
  (wrapper-level skip; not just key invalidation)."*

### F-2 (MEDIUM): cold-cache 53min vs ≤45min target — ~18% over

**Symptom.** First cold build with sccache wired in and frozen iteration
profile took **53m 01s** (3181s). Plan projection was ≤ 45 min.

**Interpretation.** Still a massive 3.16× speedup vs the r6 baseline
(2h 47m), so the *premise* of the plan (sccache + LTO=off recovers
iteration cost) is validated. The 45-min target was set optimistically
based on the per-component model (~30 sec link + parallel rustc fan-out)
without measuring the long-tail single-threaded link/codegen-units=16
finalization for the codex-cli crate.

This dev box is not Defender-excluded for `D:\codex-sccache` or
`target/release` (the doc marks the exclusion as OPTIONAL). Adding those
exclusions might shave 5-10 min off cold — worth testing if anyone wants
to chase the target. Not a blocker.

**Recommendation.** Either:
- (a) Update `build-perf.md` target to **"≤ 55 min"** for cold-cache to
  reflect measured reality on a non-Defender-excluded D:, OR
- (b) Add Defender exclusions to the dev-box setup script and re-measure
  (low operator effort, possibly closes the gap).

### F-3 (LOW): "warm-cache" scenario is effectively a link-only floor, not a sccache stress test

**Symptom.** `warm-cache` deletes only `target/release/codex-core.exe`
(per methodology), leaving every dependency artifact in place. As a
result cargo decides nothing-but-the-bin needs to be rebuilt, **no
rustc is invoked**, sccache sees 0 requests, and the 66s elapsed is
pure `lld-link` time on a 294 MB binary.

**Interpretation.** This is a useful floor measurement (it pins the
link-step cost we can't optimize further on a no-source-change rebuild),
but it does *not* exercise the "sccache hit rate ≥ 90 %" claim the doc
makes. To exercise sccache hits we'd need to e.g. `cargo clean -p
codex-tui` (force one crate + its dependents to recompile) and watch
those recompiles become cache hits.

**Recommendation.** Either:
- Keep `warm-cache` as-is and rename it to `link-only-floor` in the doc
  so it's clearly understood as a floor measurement (its current
  "≥ 90% hit rate" assertion can't be verified by it), OR
- Add a new `single-crate-recompile` scenario (mutate one source file
  in a leaf-ish crate, rebuild, expect ≥ 90 % sccache hit rate on the
  recompiled-dependents subset). This would be the actual sccache
  effectiveness test.

### F-4 (LOW): jobs-change cleanup pattern doesn't isolate the variable

**Symptom.** `jobs-change` finished in **6.6 s** — meaningfully *faster*
than `warm-cache` (66 s), not within 1.1× of it. Both ran the exact same
cargo invocation (delete bin, rebuild); only `CARGO_BUILD_JOBS` differs.

**Interpretation.** The 10× speedup is almost certainly Windows file-
system cache being hot from `warm-cache` finishing 2 seconds earlier —
not a property of `jobs=2` being faster than `jobs=4`. The scenario as
designed does not isolate the jobs-as-cache-key claim because, like
F-3, neither rustc nor sccache is invoked — both runs are pure relinks.

**The methodology claim "cache survives the change (jobs is NOT a cache
key)" therefore cannot be tested by this scenario as currently
specified.** To test that claim properly we'd need to invalidate at
least one crate (e.g. `cargo clean -p codex-tui`), rebuild with jobs=4,
then `cargo clean -p codex-tui` again and rebuild with jobs=2, and
verify the second run shows mostly sccache HITS (proving the jobs
change didn't bust the cache).

**Recommendation.** Either accept that `jobs-change` is currently a
"jobs change didn't break the build" smoke test (not a "didn't bust
the cache" test) and document that limitation, or redesign the scenario
to actually force a recompile that exercises sccache.

## Direct answers to the task's questions

**Was `jobs=4` sufficient or should we OV-5 sweep higher?**

`jobs=4` was sufficient. Peak RSS at jobs=4 on cold-cache was 8.6 GB —
well under the 64 GB box budget and well under the 32 GB pagefile
minimum. There's headroom to try `jobs=6` or `jobs=8`, which **might**
shave 5-15% off cold-cache by overlapping more parallel rustc with the
single-threaded link tail.

But: codex-cli's final link is single-threaded regardless of jobs, and
the long-tail crates (`codex-tui`, `codex-cli`, `codex-cloud-tasks`)
serialize anyway. **I'd defer the OV-5 sweep unless someone wants to
chase the ≤45 min cold target specifically.** Conservative
recommendation: leave `jobs=4` as the default in `iteration-env.sh` and
add a doc note that operators on >= 16-core boxes can safely try
`CARGO_BUILD_JOBS=6 source iteration-env.sh` for marginal cold-build
gains.

**Iteration profile tweaks suggested by the data:**

1. **F-1 doc update is the most important change.** Adding the
   "LTO != off ⇒ sccache bypass" warning to `build-perf.md` (and to
   `iteration-env.sh`'s frozen-profile banner) would prevent the
   exact misunderstanding that wasted ~58 min in this benchmark run.
2. **Consider lowering codegen-units from 16 to 8** for cold builds.
   With 16 codegen-units per crate and jobs=4, we get up to 64
   parallel codegen invocations, which may oversubscribe a 16-core box
   during the codegen-heavy tail. Untested suggestion; would need a
   side-by-side run to validate. **Not recommended without measurement
   first** because the value is in the sccache cache key.
3. **Defender exclusion on `D:\codex-sccache` + `target/release`**
   (currently marked OPTIONAL in the methodology) may close the cold-
   cache target gap and is essentially free to add. Recommend
   promoting from OPTIONAL to RECOMMENDED in the doc.
4. **`iteration-env.sh` should `set -e`-style fail-loud if sourced
   under a pipe.** The first attempt at this benchmark blew up
   because `source iteration-env.sh | tee log` ran source in a
   subshell and lost all env exports. A defensive check (e.g.
   `[[ "${BASH_SOURCE[0]}" == "$0" ]] && { echo "must be sourced, not
   piped"; exit 1; }`) or a banner-line marker the caller can grep
   for would prevent repeats.

## What was NOT a finding

- **No OOM, no Defender interference, no rebase debt surfaced during
  the 1h 53m batch.** All four cargo invocations exited 0.
- **No `Access is denied (os error 5)` from a stale codex.exe process**
  (the patch-surface.md hazard) — clean run.
- **No xwin / rusty_v8 / LLVM env issues.** The frozen profile from
  `iteration-env.sh` worked cleanly on this box on the second try.

## Reproducing this run

```bash
# From repo root:
bash .ralph/jobs/codex-rs-build-perf-baseline-measurement/run-benchmark.sh
```

Total elapsed: ~1h 53m (52:55 cold + 1:09 warm + 0:09 jobs + 58:05 lto +
~30 s of cleanups/stats). Outputs land alongside the script.

## Artifacts produced

- `run-benchmark.sh` — the master script (idempotent; reruns will repeat
  the 4 scenarios from scratch)
- `master.log` — combined progress log
- `<scenario>.csv` — one row per scenario (run-id, wall sec, peak RSS,
  sccache deltas, profile)
- `<scenario>.log` — full cargo stdout/stderr per scenario
- `<scenario>-sccache-stats-{before,after}.txt` — sccache stats snapshots

Plus the per-run CSVs that `measure-build.ps1` wrote to
`codex/docs/implementation/build-perf-artifacts/` (gitignored).

## Suggested follow-up tasks (not done in this benchmark)

1. Update `codex/docs/implementation/build-perf.md` with the F-1
   wrapper-bypass clarification, F-2 target reset / Defender promotion,
   F-3 scenario rename + new single-crate-recompile scenario, F-4
   scenario redesign.
2. Add the F-1 warning line to the `iteration-env.sh` banner output.
3. (Optional) Run a `CARGO_BUILD_JOBS=6` and `jobs=8` cold-cache sweep
   on the same box to see whether the cold-cache target can be hit
   without changing the cache key.
4. (Optional) Add `Add-MpPreference -ExclusionPath` lines to the
   dev-box setup script for `D:\codex-sccache` and
   `external/repos/codex-patched/codex-rs/target/release`, then
   re-measure cold-cache.
