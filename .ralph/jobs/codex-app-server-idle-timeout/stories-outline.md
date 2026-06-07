# Stories Outline: Codex app-server idle-timeout — D-001 defer-and-instrument

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. happy-cli (TypeScript) ONLY — ZERO codex Rust edits / no codex-submodule changes. HOLD for operator review before implementation.*

## US-001: `--idle-timeout` spawn-flag seam + fail-closed capability probe
**Description:** As a happy-cli operator, I want an opt-in `happy codex --idle-timeout <seconds>` flag that is passed to a freshly spawned `codex app-server` only when codex advertises the flag, so the seam is in place and safe (no-op) without changing today's reattach-forever default.
**Acceptance Criteria:**
- [ ] AC-1: with `--idle-timeout <n>` set AND the help probe reporting the flag, the captured ws spawn argv contains `--idle-timeout <n>` (mocked client harness).
- [ ] AC-1a: `--codex-arg --idle-timeout=30` is forwarded verbatim as a passthrough arg; bare `--idle-timeout 30` is parsed structurally into `codexIdleTimeoutSec` and not forwarded (cliArgs/codexCommand tests).
- [ ] AC-1b: `extractCodexIdleTimeoutFlag()` rejects zero, negative, non-integer/non-numeric, empty `--idle-timeout=`, missing value, and duplicate occurrences — each with a clear error and `cliArgs.test.ts` coverage.
- [ ] AC-2: with the probe NOT reporting the flag, ws argv has no idle-timeout token, the client still connects, and at most one non-error log line is emitted (`execSync` help-mock without the flag).
- [ ] AC-3: with no opt-in, no idle-timeout token is ever added; spawn argv byte-for-byte unchanged vs today.
- [ ] AC-3a: when `tryReattach()` succeeds, a `--idle-timeout` invocation reattaches without spawning and does NOT re-apply/override/reject the existing daemon's timeout (fresh-spawn-only; reattach regression test).
- [ ] AC-4: the idle-timeout `codex app-server --help` probe runs at most once per `CodexAppServerClient` instance (cached, mirroring ws-auth).
- [ ] AC-8: diff touches only `packages/happy-cli/**`; no `codex/` change, no submodule pointer move.
- [ ] Typecheck passes (AC-10).
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Real RSS sampling wired into the existing telemetry stub
**Description:** As an operator diagnosing daemon footprint, I want `rss_kb_at_exit` and live doctor RSS populated with real KB where platform-reliable, so the orphan-cost question can be answered from data instead of always-null RSS.
**Acceptance Criteria:**
- [ ] AC-5: implement `processRss.ts` `sampleProcessRssKb(pid)` with the pinned matrix (Linux `/proc/<pid>/statm` or `ps -o rss=`; macOS `ps -o rss=`; Windows `null` v1; dead/stale pid → `null`, never throws); wire it into the existing `refreshLastSampledRssKb()` stub (`:728-730`) and `probeCodexDaemon()`. `rss_kb_at_exit` carries the last cached lifecycle sample (observable-exit does NOT re-sample — pid may be gone); live doctor rows use a real-time probe. `%mem` is never reported as RSS-KB. Covered by `processRss.test.ts` + telemetry-module + doctor-render tests.
- [ ] AC-8: diff touches only `packages/happy-cli/**`.
- [ ] Typecheck passes (AC-10).
**Dependencies:** US-001 (shares `codexAppServerClient.ts`)
**Estimated complexity:** medium

## US-003: Doctor last-disconnect age distribution
**Description:** As an operator, I want `happy codex doctor` to show how long each daemon has been since its last observed client disconnect, plus a bucketed distribution, so I can judge whether orphans accumulate — without implying a true server-idle measure the client cannot know.
**Acceptance Criteria:**
- [ ] AC-6: reuse/extend the existing read-only `last-disconnect` cell to render a per-instance last-disconnect age (live/stale: now − latest observed client-side disconnect; post-mortem: exit `last_client_disconnect_age_ms`) AND a bucket summary (`<1h`/`1-24h`/`>24h`/`unknown`) across live + post-mortem instances. It must NOT be labelled true idle-age (which needs a deferred server-side active-client count). Doctor stays read-only; exit-code matrix intact.
- [ ] AC-8: diff touches only `packages/happy-cli/**`.
- [ ] Typecheck passes (AC-10).
**Dependencies:** US-002 (shares `codexDaemonDoctor.ts`)
**Estimated complexity:** small/medium

## US-004: (OPTIONAL — DEFERRED by default) `happy codex kill-idle`
**Description:** As an operator, I want a manual reaper to terminate idle/orphaned app-servers on demand. DEFERRED by default: cross-cwd reaping needs a shared per-discovery-file terminator + lock refactor (the existing terminators are private and current-cwd only), so it fails the seed's "IF cheap" gate.
**Acceptance Criteria (only if operator opts in):**
- [ ] AC-7: `happy codex kill-idle` terminates only operator-selected idle/orphan instance(s), honors confirm-dead-before-delete + per-cwd-lock invariants, and is a clear no-op when nothing is idle. When deferred (default), this story and AC do not apply.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** medium/large

## US-005: Docs — update the daemon lifecycle contract
**Description:** As a future maintainer, I want `codex-daemon-lifecycle.md` to document the fresh-spawn-only `--idle-timeout` seam + fail-closed probe, real RSS sampling, the doctor last-disconnect age surface, and why true server-idle age is deferred.
**Acceptance Criteria:**
- [ ] AC-9: `packages/happy-cli/docs/codex-daemon-lifecycle.md` documents the telemetry/RSS, the fresh-spawn-only `--idle-timeout` seam + fail-closed probe, the doctor last-disconnect age surface, and the deferred true-idle-age (server-side active-client count) requirement.
- [ ] AC-8: docs-only change under `packages/happy-cli/**`.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** small

---

*Cross-cutting: AC-10 (`pnpm --filter happy typecheck` + `pnpm --filter happy test` green) applies to every code story. Recommended execution is **serial** single-member (US-001 → US-002 → US-003 → US-005, with US-004 only on operator opt-in) due to heavy shared-file overlap on `codexAppServerClient.ts` and `codexDaemonDoctor.ts`.*
