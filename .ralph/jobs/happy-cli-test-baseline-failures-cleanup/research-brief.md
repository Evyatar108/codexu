# Research Brief — happy-cli test-baseline failures cleanup

## Empirical baseline (the decisive input)

Captured once via `npm_config_script_shell=bash pnpm --filter happy test` from the
primary checkout `D:/harness-efforts/codexu` on main (`origin/main` @ 56953d95).
Full log saved to the session files dir (`happy-cli-test-baseline.out`, 144 KB).

```
Test Files  19 failed | 133 passed | 2 skipped (154)
     Tests  59 failed | 1092 passed | 12 skipped (1163)
  Duration  178.13s (transform 158.79s, collect 394.71s, tests 425.00s, prepare 489.27s)
  Exit status 1
```

`pnpm run build` (`tsc --noEmit && pkgroll`) PASSED — vitest ran. So this is NOT a
typecheck/build problem; it is purely test failures.

> **LOAD CAVEAT (load-bearing).** The transform/collect/prepare times (158s / 394s /
> 489s) are absurdly high — the box was under heavy concurrent crew-member load during
> capture. Therefore the **timeout cluster (C)** and the **integration migration `exit
> code null` cluster (D)** are SUSPECT as load artifacts (5000ms default timeout blown
> by load; the migration subprocess killed/timed-out under load → `status null`). The
> impl member MUST re-run the suite (and at least clusters C and D) in ISOLATION on an
> unloaded box before deciding fix-vs-quarantine for those two clusters.

## Root-cause clusters (68 FAIL lines → 7 clusters)

| Cluster | Count | File(s) | Root cause | Classification |
|---|---|---|---|---|
| **A** | 29 | `src/claude/runClaude.test.ts` (14), `src/claude/runClaudePublishMode.test.ts` (15) | Hand-rolled `mockSession` (`vi.hoisted`) lacks `setLedgerIdleReachedHandler`; production `runClaude.ts:724` now calls `sessionInstance.setLedgerIdleReachedHandler(recordIdleReached)` (method defined for real at `session.ts:163`). Test double drifted behind production. | **FIX-NOW** (low risk, high leverage) |
| **B-apiSession** | 14 | `src/api/apiSession.test.ts` | All inside `describe('ApiSessionClient v3 messages API migration')` (line 215). E.g. `queues agent configuration metadata diffs until a runner subscribes` (line 270) → `expected [] to deeply equal [{ model:'claude-opus', ... }]`. Config-diff queueing returns empty. Likely one shared root cause (prod behavior changed or test setup drift). | **FIX-NOW (investigate)** medium |
| **C** | 14 | 10 files, 1–3 each: `roadmap/renderRoadmap.test.ts` (3), `ledger/writer.test.ts` (2), `commands/codexCommand.test.ts` (2), `agentComms/scopeB.test.ts` (1), `api/apiSession.test.ts` (1), `claude/utils/claudeFindLastSession.test.ts` (1), `codex/codexAppServerClient.test.ts` (1), `daemon/controlServer.spawnSessionFromSession.test.ts` (1), `daemon/spawnInWorktree.test.ts` (1), `daemon/worktreeTransactions.test.ts` (1) | `Test timed out in 5000ms` (unit project default). Spread thin → consistent with load-induced flakiness, NOT 14 distinct bugs. Some may be genuinely slow (e.g. "50+ sessions efficiently", roadmap render). | **VERIFY-IN-ISOLATION** → fix (raise timeout / make deterministic) or document |
| **D** | 6 (file-level) | All 6 integration files in `integration-empty` + `integration-authenticated` | `Error: Migration failed with exit code null` thrown at `environments/environments.ts:357` (`spawnSync('pnpm', ['exec','tsx', standalone.ts, 'migrate'])` returned `status !== 0`; `null` = killed/failed-to-complete). Hits ALL files in the project because the setup file `await`s `installIntegrationEnvironment(...)` at module scope → project-wide setup HARD-FAIL. `describe.skipIf` inside the files cannot rescue a setup-file throw. | **VERIFY-IN-ISOLATION** → fix env provisioning OR gate the project/setup when prereq absent |
| **B-sessionScanner** | 1 | `src/claude/utils/sessionScanner.test.ts` | `should process initial session and resumed session correctly` → `expected length 3 but got 2` (dedup logic vs test expectation mismatch). | **FIX-NOW (investigate)** |
| **B-codexCommand** | 1 | `src/commands/codexCommand.test.ts` | 1 AssertionError (+ 2 timeouts in cluster C). | **FIX-NOW** small |
| **E** | 1 | `src/ledger/writer.test.ts` | `ENOTEMPTY/EBUSY/EPERM` temp-dir cleanup race — exactly the documented Windows `fs.watch`→delete race. | **FIX-NOW** via AGENTS.md L41 remedy (`fs.rm(..., {recursive,force,maxRetries,retryDelay})`) |
| **F** | 1 | `src/api/apiSession.test.ts` | `Error: bad nonce size` (TweetNaCl nonce) — encryption test-data/setup drift. | **FIX-NOW** small |
| **G** | 1 | `src/agentComms/scopeB.test.ts` | `TypeError: Cannot read properties of undefined (reading 'stop')` at `scopeB.test.ts:88` `afterAll → server.stop()`. `server` undefined because `beforeAll` setup timed out (the scopeB cluster-C timeout). **Cascade of the same root cause as scopeB's C timeout.** scopeB is the only test directly using `fs.watch`. | **FIX with C** (make setup deterministic / raise hook timeout) |

**Leverage:** A (29) + B-apiSession (14) = **43 of the ~49 test-level failures come from just 3 unit files** (`runClaude.test.ts`, `runClaudePublishMode.test.ts`, `apiSession.test.ts`).

## Test harness facts (from researcher + architect agents)

- **Vitest 6 projects** (`packages/happy-cli/vitest.config.ts`): `unit` (`src/**/*.test.ts`
  excl. `*.integration.test.ts`), `integration-empty`, `integration-claude-utils`,
  `integration-plan-mode`, `integration-authenticated`, `integration-agent-comms`.
  `pnpm --filter happy test` runs ALL 6.
- **globalSetup** `src/test-setup.ts` builds the CLI and sets
  `HAPPY_RUN_SANDBOX_NETWORK_TESTS=1`. Default unit `testTimeout` is vitest's 5000ms.
- **Integration setup is the hard-fail surface.** `integration.setup.empty.ts`
  (`template:'empty', up:false`) and `integration.setup.authenticated.ts`
  (`template:'authenticated-empty', up:true`) both `await installIntegrationEnvironment`
  at module scope → `createIntegrationEnvironment` (`src/testing/integrationEnvironment.ts:45`)
  → root `environments/environments.ts:createEnvironment` (migration throw). The **seed**
  step is already softened (`try/catch` → `console.warn` "authenticated seed unavailable;
  auth-required suites will skip", sets `authenticated:false`) — the migration step is NOT.
- **Per-test binary gates already SKIP cleanly** (the existing idiom): `describe.skipIf`
  on `!claudeAvailable` (`claude.integration.test.ts:257`), `!claudeInstalled`
  (`claudeLocalLauncher.integration.test.ts:39`), `!codexAppServerAvailable` +
  `RUN_CODEX_INTEGRATION` (`codex.integration.test.ts:74,244`), `!gatewayAvailable`
  (`openclaw.integration.test.ts:102…`), `RUN_CLAUDE_INTEGRATION!=='1'`
  (`queryInitMetadata.integration.test.ts:13`), `!RUN_NETWORK_INTEGRATION`
  (`network.integration.test.ts:19`), `process.platform==='win32'`
  (`claudeLocal.test.ts:251`). Precedent for unconditional quarantine:
  `daemon.integration.test.ts:708` `it.skip('[skipped] should detect version mismatch…')`.
- **No issue-link skip convention exists** — skips carry inline prose only. Introducing
  `// TODO(<issue>):` on quarantine skips would be a new (recommended) practice.
- **CI does NOT run vitest.** `.github/workflows/cli-smoke-test.yml` only does
  `pnpm --filter happy build` + `pack` + binary smoke (`happy --help/--version/doctor/
  daemon status`). `typecheck.yml` is happy-app only. So the full suite is **purely a
  local/dev acceptance signal today**; nothing in CI enforces it.
- Inventory: **144 unit `*.test.ts` files (~1095 cases); 10 `*.integration.test.ts`
  files (~39 cases).**

## Quarantine strategy (architect recommendation)

- **Primary mechanism: `skipIf(<prerequisite-absent>)`** — matches existing idiom, keeps
  the gate trustworthy (the test still runs when the prerequisite IS present, e.g. a dev
  with `claude`/`codex` installed or CI with secrets). Reserve unconditional
  `it.skip(/* TODO(#issue) */)` only for genuinely-broken-no-prereq cases.
- **Gate integration provisioning at the project/setup boundary**, not only inside the
  file — a setup-file throw (cluster D) is unreachable by `describe.skipIf`. Make the
  setup a graceful no-op/skip when its prereq (DB migration toolchain / `RUN_*_INTEGRATION`)
  is absent, mirroring the softened-seed pattern at `integrationEnvironment.ts:52`.
- **Do NOT blanket-skip Bucket-C timing tests** — their flakiness is environmental but the
  assertions are real product logic. Prefer determinism fixes (fake timers, `fs.rm` retries
  per AGENTS.md L41, pick-free-port retry, partial `child_process` mock per AGENTS.md L42,
  or a raised `testTimeout`). Over-quarantining collapses the gate to Bucket A.
- **Document the skip-list** in a new `### Test skip-list / quarantine` subsection of
  `packages/happy-cli/AGENTS.md` (Testing block, L34–43): a small table
  *file · skip condition · tracking ref · prereq to re-enable*, with each code skip
  carrying a matching `// TODO(<ref>):` comment.

## Acceptance-signal options (architect)

- **Option A (recommended immediate):** single green gate — `pnpm --filter happy test`
  exits 0 on a no-auth/no-agent box with exactly N documented `skipIf`-skips. Requires
  fixing the integration setup-file hard-fail so the projects don't crash at load.
- **Option B:** `unit` project is the hard gate (100% deterministic); integration projects
  run only when prereq env present.
- **Option C:** split CI gate (required unit job + optional/nightly integration job).
- Recommendation: target A now, structured to upgrade to B/C.

## Consolidated file list

**Fix (test doubles / assertions):** `src/claude/runClaude.test.ts`,
`src/claude/runClaudePublishMode.test.ts`, `src/api/apiSession.test.ts`,
`src/claude/utils/sessionScanner.test.ts`, `src/commands/codexCommand.test.ts`,
`src/ledger/writer.test.ts`.
**Production references (read for ground truth; likely no change):**
`src/claude/runClaude.ts:724`, `src/claude/session.ts:163`, `src/api/apiSession.ts`.
**Timing/determinism:** `packages/happy-cli/vitest.config.ts` (project `testTimeout`),
`src/agentComms/scopeB.test.ts`, `src/roadmap/renderRoadmap.test.ts`,
`src/claude/utils/claudeFindLastSession.test.ts`, and the other cluster-C files.
**Integration setup gate:** `src/testing/integration.setup.empty.ts`,
`src/testing/integration.setup.authenticated.ts`,
`src/testing/installIntegrationEnvironment.ts`, `src/testing/integrationEnvironment.ts`,
and root `environments/environments.ts:357` (cross-package, codexu-primary repo root).
**Docs:** `packages/happy-cli/AGENTS.md` (skip-list subsection).
**CI (out-of-scope but noted):** `.github/workflows/cli-smoke-test.yml`.
