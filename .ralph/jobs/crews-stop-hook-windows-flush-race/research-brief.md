# Research Brief — crews-stop-hook-windows-flush-race

Generated 2026-06-03 in Phase 2 of `/plan-with-ralph`. Sources: explore agent `crews-flush-race-research` (gpt-5.4-mini, 202s wall) + direct verification powershell grep (shellId `verify-bg`). All facts pinned to file:line.

## Researcher Findings

### 1) `hooks/stop.js::lastTurnAssistantText` (lines 437-456)
Single-read shape: `fs.readFileSync(transcriptPath, 'utf8')` → split lines → `JSON.parse` per line → walk backwards via `isUserBoundaryEnvelope` → collect text via `extractAssistantTextFromEnvelope` → join with `\n`. Sole caller is `hooks/stop.js:723` inside `handleInput`. No other callers in the file. Depends on `fs`, `JSON.parse`, `isUserBoundaryEnvelope` (defined ~line 405), `extractAssistantTextFromEnvelope` (defined ~line 360).

### 2) `hooks/mailbox.js::sleepSync` (lines 153-160)
Synchronous millisecond sleep via Atomics.wait on a SharedArrayBuffer. **NOT exported** from `mailbox.js` (`module.exports` ends at lines 968-1030) and therefore **NOT re-exported** via `hooks/config.js`. The retry-with-backoff story MUST add `sleepSync` to `mailbox.js`'s `module.exports`, then either re-export from `config.js` or import `./mailbox` directly in `hooks/stop.js`. Already used by `writeJsonAtomic`'s rename-retry loop at line 189.

### 3) Circuit breaker (`hooks/stop.js:583-613`)
- `MAX_CONSECUTIVE_STOP_BLOCKS = 5` at line 67
- `clearFlag(data.session_id, cwd)` at line 601 — the permanent-disengage step
- Two other `clearFlag` sites in stop.js: line 647 (cleared-member loop-break) and line 672 (displaced-session one-shot). **Both stay** under the recoverable-breaker design — they handle different scenarios.
- **`bumpBlockCount` has 9 call sites in stop.js** (not just the missing-kind-tag site):
  - `:541` — listener-unreachable (from `decideStopBlock`)
  - `:684` — `assertSessionOwnsActor` exception path (NOT for IdentityMismatchError or RecipientLeftAtError; those are caught and silently allowed)
  - `:770` — missing kind tag (the path that fires under the flush race)
  - `:835` — body not canonical
  - `:938` — progress-without-bg (v3.1.0 gate)
  - `:994` — empty body + no summary
  - `:1022` — deferred mailbox message cap
  - `:1034` — unresolved consumed mailbox message
- `breakerMutedUntil` **CONFIRMED ABSENT** across `hooks/`, `config.js`, `protocol/`, `commands/`, `lib/`, `tests/`. Pinned with: `grep -rn breakerMutedUntil D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews → 0 matches`.

### 4) `hooks/protocol/manifest.js::manifestFields`
Current declared field count is **51** (NOT 40/41 as the recoverable-breaker plan and crews AGENTS.md still claim). The new manifest field count after this ship will be:
- Variant (i) force-exit: **52** (adds `consecutivePostBreakerAttempts`)
- Variant (ii) recoverable-breaker: **52** (adds `breakerMutedUntil`)

Both variants need a manifest field count assertion update in `tests/protocol/manifest.test.js` (if it exists; verify in implementation).

### 5) Recoverable-breaker plan reference (`.ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md`)
Stories 2 and 3 contain the design:
- **Story 2 (Option A — notification-boundary exemption):** adds `lastUserBoundaryEnvelope(transcriptPath)` and `isSystemNotificationBoundary(env)`. Pre-empts the missing-kind-tag block when the last user-typed envelope is a `system.notification`. Diff size: ~+40 / -0 lines in `hooks/stop.js` only.
- **Story 3 (Option B — recoverable breaker):** adds `breakerMutedUntil` (ISO-8601 string on manifest), helpers `isBreakerMuted` / `parseBreakerMutedUntil` / `resolveBreakerMuteMs`, constant `DEFAULT_BREAKER_MUTE_MS = 60_000`, env var `CREWS_BREAKER_MUTE_MS` (capped 600_000). Removes `clearFlag` from the breaker fire path. Adds an early-return mute-gate immediately after the role-guard. Successful outbox write at `:1055-1065` clears `breakerMutedUntil: null` alongside the counter reset. Diff size: ~+50 / -15 lines in `hooks/stop.js`.
- **Path correction:** the plan is written against the standalone `D:/ai-developer-toolkit/plugins/crews/`. For this ship, substitute `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/` everywhere. Everything else (file structure, helper signatures, story sequencing) is correct.

### 6) Existing tests encoding old breaker contract
- **`tests/stop-circuit-breaker.test.js:64-80`** — explicit assertions: breaker clears flag and next Stop silently allows. Pre-existing assertions encode the OLD permanent-disengage behavior as if it were intended. **MUST be rewritten** if variant (ii) ships.
- **`tests/review-gate.test.js:440-451`** — asserts breaker clears flag BEFORE review-required gate runs. **MUST be updated** if variant (ii) ships (flag preserved + breakerMutedUntil set).
- **`tests/stop-displaced-session.test.js`**, **`tests/first-turn-listener-guard.test.js`**, **`tests/progress-bg-gate.test.js`** — no breaker-contract assertions surfaced. No changes needed.

Impact summary by variant:
- **Retry-with-backoff (always shipped):** zero existing test changes (additive only).
- **Force-exit variant (i):** zero existing test changes; adds new `consecutivePostBreakerAttempts` site coverage.
- **Recoverable-breaker variant (ii):** `stop-circuit-breaker.test.js` rewritten + `review-gate.test.js:440-451` updated; AGENTS.md and CHANGELOG mention the new contract.

### 7) Vitest harness shape
- `tests/stop-circuit-breaker.test.js:23-33` — uses `spawnSync(process.execPath, [STOP], { input: JSON.stringify({session_id, cwd, transcript_path, stop_hook_active}), encoding: 'utf8' })`.
- Fixtures at lines 15-21: `cfg.ensureActorDir`, `cfg.writeFlag`, `tmpDir('crews-...-')`.
- **No `fs.readFileSync = ...` mocking precedent anywhere in the suite.**
- Closest precedent: `tests/run.js:188-193` uses `execArgv: ['--require', ...]` for worker preload. **The mock pattern for the new flush-race test SHOULD use a `--require` shim** that monkey-patches `fs.readFileSync` to return empty on the first matching call and the seeded transcript content on the second.
- Alternative: write the shim as a separate `.js` file under `tests/fixtures/`, then pass it via `spawnSync`'s `execArgv` option. This keeps the mock isolated to the one test process.

### 8) Version bump procedure
- Script: `node plugins/crews/scripts/bump-version.js 3.2.0`
- Verifier: `node plugins/crews/tests/version.test.js`
- **6 files touched** (script lines `scripts/bump-version.js:14-20`, `46-63`, `65-72`):
  1. `plugins/crews/.claude-plugin/plugin.json`
  2. `plugins/crews/.github/plugin/plugin.json`
  3. `.claude-plugin/marketplace.json` (root)
  4. `.github/plugin/marketplace.json`
  5. `.agents/plugins/marketplace.json`
  6. `plugins/crews/tests/version.test.js`

### 9) AGENTS.md active-versions table
**STALE — currently shows `3.0.1`, not `3.1.2`** at `D:/harness-efforts/codexu/AGENTS.md:23-27` (citation line 26). This is a pre-existing bug separate from this fix. The ship for this plan **must update the row to `3.2.0`** in the codexu submodule-pointer-bump commit (one-line fix, no impact on this plan's stories beyond bookkeeping).

### 10) Gate ordering (v3.1.0 progress+no-bg interaction)
- `lastTurnAssistantText` runs at `hooks/stop.js:723`
- Missing-kind-tag block runs at `hooks/stop.js:764-775`
- Progress+no-bg gate runs at `hooks/stop.js:873-945`
- **The retry-with-backoff is orthogonal** to the no-bg gate; the no-bg gate only fires when a `kind="progress"` tag was successfully parsed (so it presumes the missing-tag block already passed). No interaction.

## Consolidated File List

**Files to modify:**
- `hooks/stop.js` — retry-with-backoff in `lastTurnAssistantText`; +Stories 2/3 from recoverable-breaker plan if variant (ii) lands
- `hooks/mailbox.js` — add `sleepSync` to `module.exports`
- `hooks/config.js` (optional) — re-export `sleepSync`
- `hooks/protocol/manifest.js` — add `breakerMutedUntil` (variant ii) OR `consecutivePostBreakerAttempts` (variant i) to `manifestFields`
- `tests/stop-circuit-breaker.test.js` — REWRITE if variant (ii) lands (preserve forward-progress sub-test)
- `tests/review-gate.test.js:440-451` — UPDATE if variant (ii) lands
- `tests/stop-allow-system-notification-boundary.test.js` — NEW (Story 4 of recoverable-breaker plan, ~200 lines)
- `tests/stop-flush-race-retry.test.js` — NEW (this plan's primary test, ~150 lines)
- `tests/fixtures/mock-fs-readsync-once-empty.js` — NEW `--require` shim (if that's the chosen mocking path)
- `.claude-plugin/plugin.json` / `.github/plugin/plugin.json` / 3× marketplace.json / `tests/version.test.js` — via `scripts/bump-version.js 3.2.0`
- `CHANGELOG.md` — new §3.2.0 entry
- `docs/copilot-cli-fsync-upstream-ask.md` — NEW (Story 9, scope-explicitly-out docs deliverable)

**Codexu-side files:**
- `D:/harness-efforts/codexu/AGENTS.md` — update active-versions table row to 3.2.0
- Codexu submodule pointer bump (commit only; affects `.gitmodules`-tracked SHA)

**Reference (read-only):**
- `D:/harness-efforts/codexu/.ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md` — design reference for Stories 1-3 of variant (ii)
- `D:/harness-efforts/codexu/.ralph/jobs/codex-rs-feature-pruning-for-sub-45m-cold/impl-session-handoff.md` — diagnosis
- `D:/harness-efforts/codexu/.ralph/investigations/crews-implement-with-ralph-parallel-outbox-silent-loss/findings.md` — companion investigation
