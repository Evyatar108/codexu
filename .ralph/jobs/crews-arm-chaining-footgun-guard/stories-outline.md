# Stories Outline: crews `arm` fail-loud redirected/no-new-listener guard (D-001)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

All three stories ship in ONE serial job (single cluster `arm-fail-loud-guard`) — they share
`lib/listener-loop.js` / its tests / the crews version files and have a strict data dependency
(tests exercise the implementation; the version/CHANGELOG bump gates on green code + tests).

## US-001: Core fail-loud guard in `lib/listener-loop.js`
**Description:** As a crews lead/operator, I want `node tools/crews.js arm …` to fail loudly when it
returns WITHOUT becoming a live background listener and its stdout envelope is swallowed (redirected),
so I cannot silently end up listener-less from a chained/redirected `arm | Out-Null; <cmd>` invocation.
**Acceptance Criteria:**
- [ ] `parseListenerArgs` recognizes a machine-mode opt-in: a `--machine` flag AND env
      `CREWS_ARM_MACHINE` (`1`/`true`, case-insensitive) read via the existing `options.env` seam;
      the flag must not be mis-parsed as the positional name (use `parseCrewArgs` allowUnknown +
      a declared boolean flag).
- [ ] New helpers added + exported for unit tests: `isStdoutNonInteractive(stdout)`
      (`!!stdout && stdout.isTTY !== true`) and `formatNoNewListenerAdvisory({reason,name,crew,existingPid})`.
- [ ] The `arm-skipped` branch (`lib/listener-loop.js:141-152`) routes by reason when stdout is
      redirected AND machine mode is off: `already-active-listener` → exit **0** + stderr advisory
      stating an existing live listener is already active; `session-mismatch` /
      `recoverable-pending-takeover` → exit **non-zero (3)** + stderr containing
      `no background listener was started`. The stdout JSON envelope is unchanged in all cases.
- [ ] The guarded path awaits BOTH the stdout and stderr write callbacks before resolving (a
      `finishWithAdvisory`-style barrier) so neither stream is truncated by `crews.js`'s immediate
      `process.exit` (AC F-001).
- [ ] With machine mode ON (env or flag), behavior is byte-identical to pre-3.7.1: stdout JSON
      envelope, exit 0, no guard stderr.
- [ ] A successful fresh arm (no competing listener) still BLOCKS and resolves via `messages`/`timeout`
      (exit 0) with NO guard stderr — the legitimate async listener path is untouched.
- [ ] Invalid-args / missing-identity paths are NOT wrapped (out of scope — already loud + non-zero).
- [ ] `node --check ai-developer-toolkit/plugins/crews/lib/listener-loop.js` passes (Typecheck passes).
**Dependencies:** None
**Estimated complexity:** small

## US-002: Regression tests (existing opt-in + new fail-loud coverage)
**Description:** As a crews maintainer, I want regression coverage proving both the new fail-loud
behavior and the preserved machine-mode JSON contract, so future refactors can't reintroduce the
silent-no-listener footgun or break scripted consumers.
**Acceptance Criteria:**
- [ ] `tests/listener-redundant-arm-skip.test.js`: the existing pipe-based skip assertions
      (`session-mismatch`, `recoverable-pending-takeover`, `already-active-listener`, async
      contention) thread `CREWS_ARM_MACHINE=1` into the spawn env so `parseListenerOutput`'s
      `status===0` + JSON-parse assertions stay green — proving the documented opt-in JSON envelope
      remains available.
- [ ] New `tests/listener-arm-fail-loud.test.js` (spawned-subprocess, non-TTY pipe, machine mode OFF):
      asserts `session-mismatch` and `recoverable-pending-takeover` exit non-zero with stderr
      containing `no background listener was started` AND a parseable `arm-skipped` envelope still on
      stdout; asserts `already-active-listener` exits 0 with the "existing live listener" advisory +
      unchanged stdout envelope; asserts a normal fresh arm reaches `messages`/`timeout` (exit 0,
      no guard stderr).
- [ ] New file also covers an in-process injected-IO unit test of the pure helpers; the fake
      `stdout`/`stderr` write methods MUST invoke their callbacks (else `runListenerLoop` hangs).
- [ ] `tests/dispatcher-arm-listener.test.js` and `tests/listener-stdout-flush.test.js` remain green
      unmodified (they exercise became-listener paths the guard never touches).
- [ ] `node plugins/crews/tests/run.js` passes in full on Windows (target < ~90s); the new test file
      is added to the runner's serial denylist if it spawns timing-sensitive child processes.
- [ ] `node --check` passes on the new/changed test files.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Release surface (version bump + docs + marketplace sync)
**Description:** As a consumer running `copilot plugin update` / `/plugin update`, I want the crews
version bumped and the escape hatch documented so the new behavior reaches every install and
operators know about the `CREWS_ARM_MACHINE` opt-out.
**Acceptance Criteria:**
- [ ] `node plugins/crews/scripts/bump-version.js 3.7.1` run (stamps the 3 plugin manifests incl
      `.codex-plugin/plugin.json` + the 3 marketplace indexes); do NOT hand-edit the stamps.
- [ ] `node plugins/crews/tests/version.test.js` passes (asserts the literal `3.7.1` across all stamps).
- [ ] `plugins/crews/CHANGELOG.md` has a `## 3.7.1 - <date>` entry describing the guard + escape hatch.
- [ ] `plugins/crews/AGENTS.md` has a `## v3.7.1` section documenting the guard, the
      `CREWS_ARM_MACHINE`/`--machine` escape hatch, the no-new-listener vs became-listener
      classification, and the common-mistake gotchas (don't wrap invalid-args; keep exit-0 for
      already-active; await both write callbacks).
- [ ] `plugins/crews/README.md` documents the `CREWS_ARM_MACHINE` env + `--machine` flag escape
      hatch for scripted JSON consumers.
- [ ] All three marketplace indexes carry `3.7.1` for the crews entry.
**Dependencies:** US-001, US-002
**Estimated complexity:** small
