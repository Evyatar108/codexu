#!/usr/bin/env bash
# Master benchmark script for codex-rs-build-perf-baseline-measurement.
# Runs the 4 scenarios from codex/docs/implementation/build-perf.md in order,
# sharing one target dir + sccache cache (the natural chain).
#
# Each scenario:
#   - sccache --zero-stats
#   - capture sccache stats BEFORE
#   - run measure-build.ps1 (writes <runId>.csv)
#   - capture sccache stats AFTER
#   - save stdout/stderr to per-scenario .log file
#
# Outputs live under RESULTS_DIR.

set -uo pipefail

RESULTS_DIR="D:/harness-efforts/codexu/.ralph/jobs/codex-rs-build-perf-baseline-measurement"
CODEX_ROOT="D:/harness-efforts/codexu/codex"
CODEX_RS_DIR="$CODEX_ROOT/external/repos/codex-patched/codex-rs"
BIN_PATH="$CODEX_RS_DIR/target/release/codex-core.exe"
MASTER_LOG="$RESULTS_DIR/master.log"

mkdir -p "$RESULTS_DIR"

# Source iteration env (sets sccache, frozen profile, LLVM toolchain).
cd "$CODEX_ROOT"
source scripts/iteration-env.sh 2>&1 | tee -a "$MASTER_LOG" || true
# NOTE: piping `source` runs it in a subshell, so re-source plainly to get env into THIS shell.
source scripts/iteration-env.sh >/dev/null 2>&1

# Verify the frozen profile is active.
if [ "${RUSTC_WRAPPER:-}" != "sccache" ]; then
  echo "[run-benchmark] ERROR: RUSTC_WRAPPER != sccache" | tee -a "$MASTER_LOG"
  exit 2
fi

echo "==================================================================" | tee -a "$MASTER_LOG"
echo "[run-benchmark] Starting benchmark batch at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$MASTER_LOG"
echo "  RESULTS_DIR=$RESULTS_DIR" | tee -a "$MASTER_LOG"
echo "  CODEX_RS_DIR=$CODEX_RS_DIR" | tee -a "$MASTER_LOG"
echo "==================================================================" | tee -a "$MASTER_LOG"

run_scenario() {
  local label="$1"
  local jobs="$2"
  local lto="$3"
  local cleanup_cmd="$4"  # bash snippet for pre-build cleanup

  local scenario_log="$RESULTS_DIR/${label}.log"
  local stats_before="$RESULTS_DIR/${label}-sccache-stats-before.txt"
  local stats_after="$RESULTS_DIR/${label}-sccache-stats-after.txt"
  local start_iso end_iso start_epoch end_epoch elapsed

  export CARGO_BUILD_JOBS="$jobs"
  export CARGO_PROFILE_RELEASE_LTO="$lto"

  echo "" | tee -a "$MASTER_LOG"
  echo "==================================================================" | tee -a "$MASTER_LOG"
  echo "[run-benchmark] SCENARIO: $label  jobs=$jobs  LTO=$lto" | tee -a "$MASTER_LOG"
  echo "[run-benchmark] log: $scenario_log" | tee -a "$MASTER_LOG"
  echo "==================================================================" | tee -a "$MASTER_LOG"

  # Pre-build cleanup
  echo "[run-benchmark] cleanup: $cleanup_cmd" | tee -a "$MASTER_LOG"
  eval "$cleanup_cmd" 2>&1 | tee -a "$MASTER_LOG"

  # Zero sccache stats so this scenario's delta is clean.
  sccache --zero-stats >/dev/null 2>&1 || true
  sccache --show-stats > "$stats_before" 2>&1 || true

  start_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  start_epoch=$(date -u +%s)
  echo "[run-benchmark] START $label at $start_iso" | tee -a "$MASTER_LOG"

  # Run the measure-build wrapper. RunId derived from scenario label + timestamp
  # so the resulting CSV path is predictable per-scenario.
  local run_id="${label}-${start_iso}"
  run_id="${run_id//:/}"

  pwsh -NoProfile -File "$CODEX_ROOT/scripts/measure-build.ps1" \
    -Scenario "$label" -RunId "$run_id" > "$scenario_log" 2>&1
  local rc=$?

  end_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  end_epoch=$(date -u +%s)
  elapsed=$((end_epoch - start_epoch))

  echo "[run-benchmark] END $label at $end_iso  rc=$rc  elapsed_sec=$elapsed" | tee -a "$MASTER_LOG"

  sccache --show-stats > "$stats_after" 2>&1 || true

  # Copy the CSV row into a predictable per-scenario path.
  local csv_src="$CODEX_ROOT/docs/implementation/build-perf-artifacts/${run_id}.csv"
  if [ -f "$csv_src" ]; then
    cp "$csv_src" "$RESULTS_DIR/${label}.csv"
    echo "[run-benchmark] CSV row:" | tee -a "$MASTER_LOG"
    cat "$RESULTS_DIR/${label}.csv" | tee -a "$MASTER_LOG"
  else
    echo "[run-benchmark] WARN: expected CSV not found at $csv_src" | tee -a "$MASTER_LOG"
  fi

  # Verify binary exists (sanity check that build succeeded).
  if [ -f "$BIN_PATH" ]; then
    local size_mb
    size_mb=$(stat -c '%s' "$BIN_PATH" 2>/dev/null | awk '{printf "%.1f", $1/1024/1024}')
    echo "[run-benchmark] codex-core.exe size: ${size_mb} MB" | tee -a "$MASTER_LOG"
  else
    echo "[run-benchmark] WARN: codex-core.exe not produced" | tee -a "$MASTER_LOG"
  fi

  return $rc
}

# --- Scenario A: cold-cache --------------------------------------------------
# Full cold: empty sccache + empty target dir.
# Expected wall-time: <= 45 min per build-perf.md (vs ~2h 47m baseline).
COLD_CLEANUP="rm -rf '$CODEX_RS_DIR/target/release' 2>/dev/null; sccache --stop-server >/dev/null 2>&1 || true; rm -rf 'D:/codex-sccache' 2>/dev/null; mkdir -p 'D:/codex-sccache'; sccache --start-server >/dev/null 2>&1 || true"
run_scenario cold-cache 4 off "$COLD_CLEANUP" || echo "[run-benchmark] cold-cache failed; continuing with remaining scenarios"

# --- Scenario B: warm-cache --------------------------------------------------
# Same env as cold-cache; delete only target/release/codex-core.exe.
# Expected: sccache hit rate >= 90%; link dominates. Target: <= 5 min.
WARM_CLEANUP="rm -f '$BIN_PATH' 2>/dev/null; true"
run_scenario warm-cache 4 off "$WARM_CLEANUP" || echo "[run-benchmark] warm-cache failed; continuing"

# --- Scenario C: jobs-change -------------------------------------------------
# Same env as warm-cache, change jobs (4 -> 2). Cache should survive.
# Expected: <= 6 min.
JOBS_CLEANUP="rm -f '$BIN_PATH' 2>/dev/null; true"
run_scenario jobs-change 2 off "$JOBS_CLEANUP" || echo "[run-benchmark] jobs-change failed; continuing"

# --- Scenario D: lto-change --------------------------------------------------
# Same env as warm-cache, change LTO (off -> thin). Expected: near-cold-cache.
# No time target — recorded as evidence of by-design invalidation.
LTO_CLEANUP="rm -f '$BIN_PATH' 2>/dev/null; true"
run_scenario lto-change 4 thin "$LTO_CLEANUP" || echo "[run-benchmark] lto-change failed; continuing"

echo "" | tee -a "$MASTER_LOG"
echo "==================================================================" | tee -a "$MASTER_LOG"
echo "[run-benchmark] All scenarios complete at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$MASTER_LOG"
echo "==================================================================" | tee -a "$MASTER_LOG"

# Print summary
echo "" | tee -a "$MASTER_LOG"
echo "[run-benchmark] CSV SUMMARY:" | tee -a "$MASTER_LOG"
for label in cold-cache warm-cache jobs-change lto-change; do
  if [ -f "$RESULTS_DIR/${label}.csv" ]; then
    echo "--- $label ---" | tee -a "$MASTER_LOG"
    cat "$RESULTS_DIR/${label}.csv" | tee -a "$MASTER_LOG"
  fi
done
