# Stories Outline: Raise codex-exec.mjs default timeout & re-validate its premise

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Raise DEFAULT_TIMEOUT_MS to 20 min and correct the premise comment
**Description:** As the operator, I want codex-exec.mjs's default self-reap timeout
raised to 20 min (the operator hard-minimum) and the stale "must sit below a ~300s
harness tool-timeout" rationale corrected, so healthy long `xhigh` codex lens runs
are no longer prematurely reaped as bogus exit-124 "stalls."
**Acceptance Criteria:**
- [ ] `const DEFAULT_TIMEOUT_MS = 1200000;` in `plugins/ralph/src/codex-exec.mjs`
      (with an inline `// 20 min` + brief "last-resort backstop" note).
- [ ] The module header block (file-top + the constant comment, lines ~18-21 and
      66-71) no longer claims the wrapper must self-reap below a ~300s harness
      tool-timeout; it instead frames the timeout as a last-resort backstop for a
      genuinely-wedged codex, noting the pipe-deadlock root cause was fixed in
      v5.54.0 and the SIGINT/SIGTERM handlers handle orphan-prevention on a harness
      kill.
- [ ] The `SNAPSHOT_TIMEOUT_MS` comment (lines 73-75) is corrected to justify the
      8s cap as bounding the pre-kill snapshot so the reap path completes promptly
      (NOT "stays well under the ~300s harness bound"); the VALUE 8000 is unchanged.
- [ ] `src/codex-exec.mjs` contains none of the premise phrases `~300s`,
      `under 300s`, `harness tool-timeout`, or `harness bound` (an unrelated bare
      `300` elsewhere is fine only if unrelated to the timeout premise).
- [ ] `--timeout-ms` / `CODEX_EXEC_TIMEOUT_MS` precedence and the `0`/negative =
      disabled semantics are unchanged (`resolveTimeoutMs` :391-402 and the
      `waitForChild` `if (timeoutMs > 0)` guard untouched).
- [ ] `node --test plugins/ralph/tests/test-codex-exec.mjs` stays green.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Add a regression-guard test pinning the new default
**Description:** As a maintainer, I want a hermetic test asserting the resolved
default timeout is 1200000 when no `--timeout-ms` and no `CODEX_EXEC_TIMEOUT_MS` are
provided, so a future edit cannot silently lower the operator hard-minimum.
**Acceptance Criteria:**
- [ ] New `test(...)` in `plugins/ralph/tests/test-codex-exec.mjs` calls
      `main(["--prompt", promptFile, "--output", outputFile], {...})` with NO
      `--timeout-ms` and an `env` lacking `CODEX_EXEC_TIMEOUT_MS`, injecting
      `setTimeout: (fn, delay) => { captured = delay; return 1; }` and a spawn whose
      child never closes. It MUST settle the awaited `main()` promise: after the
      synchronous capture, invoke the captured timeout callback (so `waitForChild`
      resolves to `124`), `await` the promise, then assert captured delay
      `=== 1200000` (mirrors the existing "wrapper timeout ... returns 124" test;
      avoids an unresolved-promise hang).
- [ ] The test is hermetic (no real `codex`; uses `RALPH_CODEX_TEST=1` + injected
      fakes) and does not write real sidecar files/timers.
- [ ] `node --test plugins/ralph/tests/test-codex-exec.mjs` passes (existing + new).
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Version bump + CHANGELOG + AGENTS.md docs
**Description:** As a consumer, I want the standard ralph release bookkeeping so the
raised default ships discoverably and CI version invariants stay green.
**Acceptance Criteria:**
- [ ] All 6 version stamps (ralph entry) read `5.55.0`:
      `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`,
      `.agents/plugins/marketplace.json`, `plugins/ralph/.claude-plugin/plugin.json`,
      `plugins/ralph/.github/plugin/plugin.json`,
      `plugins/ralph/.codex-plugin/plugin.json` (edit the ralph ENTRY's `version`,
      not the top-level marketplace `version`).
- [ ] `plugins/ralph/CHANGELOG.md` gains a `## v5.55.0` entry describing the raise
      + premise correction; the `## v5.54.0` block is unmodified.
- [ ] `plugins/ralph/AGENTS.md` gains a `## v5.55.0 Behavioral Additions` section
      and its "Six version stamps in sync" line reads `5.55.0`; the historical
      `## v5.54.0 Behavioral Additions` section is left intact.
- [ ] The CHANGELOG v5.55.0 + AGENTS.md v5.55.0 text NARROWS the guarantee to the
      codex-exec wrapper default and notes that outer shell-tool timeouts (e.g.
      Claude-Code SKILL `timeout: 300000`) may still cap a run before the new
      default is reached.
- [ ] Release gates pass from the toolkit repo root:
      `node tools/validate-codex-marketplace-policy.mjs`; the Copilot gate
      `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check && node plugins/ralph/scripts/check-copilot-parity.mjs`;
      and the Codex gate
      `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=codex --check && node plugins/ralph/tests/test-codex-generator.mjs`.
**Dependencies:** US-001
**Estimated complexity:** small
