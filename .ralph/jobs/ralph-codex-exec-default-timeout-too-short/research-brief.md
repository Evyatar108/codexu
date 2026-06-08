# Research Brief: raise codex-exec.mjs default timeout + re-validate premise

*Research conducted inline by the plan-phase member against the live submodule
source at `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/ralph/`
(the plan worktree starts with uninitialized submodules, so research targets the
main-checkout submodule source, which is the impl target).*

## Researcher Findings

### Target file: `plugins/ralph/src/codex-exec.mjs`
- **`DEFAULT_TIMEOUT_MS = 240000` (line 72).** The single constant to raise.
- **`SNAPSHOT_TIMEOUT_MS = 8000` (line 75).** Hard cap on the pre-kill PowerShell
  process-tree snapshot. Independent of the self-reap value (see Premise below).
- **`TIMEOUT_EXIT_CODE = 124` (line 79).** Distinct exit code for a timeout reap.
- **`resolveTimeoutMs(parsed, env)` (lines 391-402).** Precedence:
  `--timeout-ms` (parsed.timeoutMs, if non-null) > `CODEX_EXEC_TIMEOUT_MS` env
  (if finite) > `DEFAULT_TIMEOUT_MS`. The `0`/negative-disables semantics live in
  `waitForChild` (line 451: `if (timeoutMs > 0)`), so a `0` or negative resolved
  value schedules no timer at all.
- **Module header comment (lines 1-25, 66-79).** Lines 66-71 carry the stale
  premise: "Must sit BELOW the caller's harness tool-timeout (~300s) so the
  wrapper kills codex and returns BEFORE the harness kills node ... so the default
  leaves comfortable headroom under 300s." Lines 73-75 justify SNAPSHOT_TIMEOUT_MS
  as keeping "the timeout reap path (timeout + snapshot + taskkill) ... well under
  the ~300s harness bound." The file-top block (lines 18-21) repeats "A bounded
  wrapper timeout self-reaps BELOW the caller's harness tool-timeout."
- **Reap mechanics (lines 435-475, ~480-545).** `waitForChild` schedules a single
  `setTimeoutFn(() => { onTimeout(); settle(124) }, timeoutMs)` only when
  `timeoutMs > 0`. The `onTimeout` path snapshots the spawned-shell PID subtree
  (bounded by SNAPSHOT_TIMEOUT_MS) then `taskkill /T /F /PID`. The SAME snapshot +
  tree-kill runs from the SIGINT/SIGTERM signal handlers (installed for the run's
  lifetime, removed in `finally`).

### Callers (who inherits DEFAULT_TIMEOUT_MS)
NONE of the in-repo callers pass `--timeout-ms`, so every one inherits the default:
- **`src/ralph.mjs`** — per-iteration implementer (codex engine). Resolves the
  codex-exec script (line 979-980) and spawns it with the iteration prompt; no
  `--timeout-ms`. So the per-story implementer inherits the default. Raising the
  default helps codex-as-iteration-engine directly.
- **`src/review-loop.mjs`** — planning-engine codex path (line 823: args =
  `["--prompt", ..., "--output", ..., "--effort", "high"]`, no timeout) and the
  3-way re-review codex slot (line 1072: same shape, no timeout). Both inherit the
  default.
- **Skill prose** (`plan-with-ralph`, `brainstorm-with-ralph`, `review-changes`,
  `multi-model-investigate`, `agents/plan-reviewer.md`) invokes
  `node .../src/codex-exec.mjs --prompt ... --output ... --effort xhigh|high ...`
  with NO `--timeout-ms`; the SKILL wraps the call in a Bash/shell tool invocation
  with `timeout: 300000`. So the research/review lenses inherit the default too —
  but under Claude Code that outer Bash `timeout: 300000` can still hard-kill at
  5 min BEFORE codex-exec reaches the new default, so the raise only PARTIALLY
  helps Claude-Code SKILL lenses. It FULLY helps the no-outer-timeout
  iteration-engine (`ralph.mjs`) + review-loop (`review-loop.mjs`) paths and the
  operator's Copilot-CLI lenses (async, no hard kill).

### Tests: `plugins/ralph/tests/test-codex-exec.mjs`
- **No test pins the literal `240000`.** The two timeout tests pass explicit
  `--timeout-ms 1000` (line 289, the timeout->snapshot->taskkill->124 test) and
  `--timeout-ms 0` (line 336, the SIGINT test). Grep for `240000` across all
  `tests/*.mjs` returns zero hits.
- **The default path is exercised but not asserted on value.** Tests at lines
  267-281 (RUST_LOG precedence) and 216-265 (sidecar capture) call
  `runMain(["--prompt", ..., "--output", ...])` with no `--timeout-ms`. The
  injected `setTimeout` is a fake; the actual delay value is never asserted, so the
  bump is test-safe.
- **Injectable surface enables a regression guard.** `main(argv, opts)` accepts an
  injected `setTimeout: (fn, delay) => {...}` (see line 299). A new hermetic test
  can call `main` with NO `--timeout-ms` and NO `CODEX_EXEC_TIMEOUT_MS`, capture
  the `delay`, and assert it equals the new default (1200000) — pinning the
  operator hard-minimum so a future edit cannot silently lower it.

### Version stamps (6, all currently `5.54.0`)
Per `plugins/ralph/AGENTS.md` "Six version stamps in sync": the ralph plugin entry
in `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`,
`.agents/plugins/marketplace.json` (note: the top-level marketplace `version` in
the first two indexes is `1.0.0` and is NOT the ralph entry — the ralph entry
inside each index is `5.54.0`), plus `plugins/ralph/.claude-plugin/plugin.json`,
`plugins/ralph/.github/plugin/plugin.json`, `plugins/ralph/.codex-plugin/plugin.json`.
Next version: **5.55.0**. `CHANGELOG.md` head is the `## v5.54.0` block.

## Architect Analysis

### Premise re-validation (the load-bearing finding)
The "~300s harness tool-timeout" the comment refers to is the `timeout: 300000`
parameter the SKILL prose passes to the Bash/shell tool that invokes codex-exec —
NOT a property of codex-exec itself.

- **Copilot CLI (the operator's engine, and this member's).** The shell tool runs
  async: a command that exceeds `initial_wait` (30-600s) moves to the BACKGROUND
  and keeps running; async-mode commands run indefinitely. There is **no 300s hard
  kill**. Therefore a 240s self-reap inside codex-exec actively and prematurely
  reaps healthy long `xhigh` runs — exactly the operator-observed exit124 "stalls."
  This is verified by the Copilot CLI shell-tool semantics (sync `initial_wait` then
  background; async runs to completion) and matches stored memory `timeout policy` /
  `codex lens timeout` (operator directive: min 20 min; the 240s default "prematurely
  reaps healthy long xhigh codex runs").
- **Claude Code.** The Bash tool's `timeout` parameter IS a hard process kill at the
  specified value, so a SKILL passing `timeout: 300000` causes Claude Code to kill
  node at 300s. In that world a sub-300s self-reap let the wrapper finish its clean
  tree-kill first. BUT this is now redundant: (a) the v5.54.0 SIGINT/SIGTERM signal
  handlers already run the same snapshot+tree-kill when ANY harness kills node
  (the harness sends SIGTERM, which the handler catches), and (b) the original
  reason long runs hung-then-orphaned — the Windows ~64KB OS-pipe-buffer deadlock —
  is FIXED by the v5.54.0 fd-backed concurrent drain, so healthy long runs no longer
  hang; they just need wall time.

**Conclusion:** the "must self-reap below ~300s" constraint is engine-specific and
now obsolete. The wrapper timeout should be reframed as a pure LAST-RESORT backstop
for a genuinely-wedged codex (which has hung long before 20 min), and raised to the
operator hard-minimum (>= 1200000 ms / 20 min). No orphan regression: the signal
handlers cover the harness-kill path independently of the self-reap value.

### Recommended exact value: 1200000 (20 min)
Meets the operator hard-minimum exactly. A genuinely hung codex is already wedged
well before 20 min, so 20 min suffices as a backstop and avoids holding a wedged
process 50% longer than necessary. Overrides (`--timeout-ms`,
`CODEX_EXEC_TIMEOUT_MS`) and the `0`/negative = disabled semantics are preserved,
so any operator wanting 30 min / unbounded can set them. (30 min / 1800000 is a
documented alternative; rejected as the default because it adds backstop latency
without a concrete need on this box.)

### SNAPSHOT_TIMEOUT_MS interaction
`SNAPSHOT_TIMEOUT_MS = 8000` stays unchanged. Its real purpose is to bound the
pre-kill snapshot so the reap path (whether triggered by the self-reap timer OR by
a harness-kill signal handler) completes promptly without itself hanging. The
old justification ("stays well under the ~300s harness bound") is obsolete and is
corrected in the same comment edit; the VALUE does not change.

## Consolidated File List

### Files to modify (impl)
- `plugins/ralph/src/codex-exec.mjs` — raise `DEFAULT_TIMEOUT_MS` to `1200000`;
  rewrite the header/premise comment (lines ~18-21, 66-79) to reflect the new value
  + corrected premise + reframed last-resort-backstop role; correct the
  SNAPSHOT_TIMEOUT_MS justification comment (value unchanged).
- `plugins/ralph/tests/test-codex-exec.mjs` — add a hermetic regression-guard test
  asserting the resolved default (no `--timeout-ms`, no env) is `1200000`.
- `plugins/ralph/CHANGELOG.md` — new `## v5.55.0` entry (leave v5.54.0 intact).
- `plugins/ralph/AGENTS.md` — add `## v5.55.0 Behavioral Additions`; update the
  present-tense reference to the `240000` default if present (leave the historical
  `## v5.54.0 Behavioral Additions` section intact per the docs convention).
- 6 version stamps (ralph entry) -> `5.55.0`:
  `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`,
  `.agents/plugins/marketplace.json`, `plugins/ralph/.claude-plugin/plugin.json`,
  `plugins/ralph/.github/plugin/plugin.json`, `plugins/ralph/.codex-plugin/plugin.json`.

### Out of scope (note as follow-ups, do NOT change here)
- The SKILL-prose Bash `timeout: 300000` wrapper values. Under Copilot CLI these are
  `initial_wait` (no hard kill), so raising codex-exec's default is the load-bearing
  fix for the operator. Under Claude Code, long (>300s) runs would still be killed
  by the harness at 300s; raising those SKILL timeouts is a related but separate
  change. Note as an open question / follow-up.
- The codex **iteration-engine runaway-Collab-spawn** hang
  (`ralph-codex-iteration-engine-runaway-spawn-guard`) — a DISTINCT pathology, not
  this timeout fix.
- Re-enabling/changing the copilot-exec read-only snapshot guard — unrelated.

## Build / verification
- Targeted node test: `node --test plugins/ralph/tests/test-codex-exec.mjs`
  (hermetic; no real `codex` needed — `RALPH_CODEX_TEST=1` + injected fakes).
- Codex release gate (docs/version sanity): the marketplace-policy validator
  `node tools/validate-codex-marketplace-policy.mjs` from the toolkit repo root.
- No `cargo`/heavy build involved (this is a JS-only plugin change).
