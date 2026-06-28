# Stories Outline: happy-cli test-baseline failures cleanup

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*
*Target: codexu primary, `packages/happy-cli`. The repo-root `environments/environments.ts` is read-only (NOT edited) — cluster D is resolved by project-level gating in `vitest.config.ts`.*

## US-000: Re-baseline the suite in isolation (Phase 0, mandatory first)
**Description:** As an impl agent, I want a clean unloaded baseline so I can separate genuine failures from load artifacts before deciding fix-vs-quarantine.
**Acceptance Criteria:**
- [ ] On an unloaded box, run `npm_config_script_shell=bash pnpm --filter happy test` once and capture stdout+stderr to `.ralph/jobs/happy-cli-test-baseline-failures-cleanup/isolated-baseline.out`.
- [ ] Write a machine-readable before-list (cluster → file → count, plus failing+skipped test ids) to `.ralph/jobs/happy-cli-test-baseline-failures-cleanup/rebaseline-clusters.md`.
- [ ] Explicitly record whether cluster-C timeouts and the cluster-D migration `exit code null` still occur unloaded; a persisting D-failure is recorded as a confirmed prerequisite gap (not load).
- [ ] Do NOT modify any source in this story — it is measure-only.
**Dependencies:** None
**Estimated complexity:** small

## US-001: Fix cluster A — missing `setLedgerIdleReachedHandler` on test doubles (29)
**Description:** As a maintainer, I want the `runClaude` test doubles to match production so the 29 `TypeError: sessionInstance.setLedgerIdleReachedHandler is not a function` failures clear.
**Acceptance Criteria:**
- [ ] Add `setLedgerIdleReachedHandler: vi.fn()` (and any paired ledger-idle method the `runClaude.ts:724` path invokes) to the hoisted `mockSession` in BOTH `src/claude/runClaude.test.ts` and `src/claude/runClaudePublishMode.test.ts`.
- [ ] Fix is in the test doubles only; production `src/claude/session.ts` / `runClaude.ts` is NOT modified (the method already exists at `session.ts:163`).
- [ ] `pnpm --filter happy exec vitest run src/claude/runClaude.test.ts src/claude/runClaudePublishMode.test.ts` is green.
- [ ] Typecheck passes.
**Dependencies:** US-000
**Estimated complexity:** small

## US-002: Fix `apiSession.test.ts` — v3-migration block + bad nonce (16)
**Description:** As a maintainer, I want the `ApiSessionClient v3 messages API migration` failures and the bad-nonce failure resolved, distinguishing test-drift from a real product regression.
**Acceptance Criteria:**
- [ ] Read `src/api/apiSession.ts` for the agent-configuration metadata-diff queueing behavior backing `describe('ApiSessionClient v3 messages API migration')` (`apiSession.test.ts:215`); determine whether each failure is test drift or a real product regression and record a one-line verdict per sub-cluster in `.ralph/jobs/happy-cli-test-baseline-failures-cleanup/apiSession-triage.md`.
- [ ] Resolve the 14 v3-migration assertions (e.g. `queues agent configuration metadata diffs until a runner subscribes`, `apiSession.test.ts:270`) and the `bad nonce size` failure.
- [ ] If a failure reflects a real product regression, fix the product code (not just the assertion); do NOT rewrite assertions to green over a genuine regression.
- [ ] `pnpm --filter happy exec vitest run src/api/apiSession.test.ts` is green.
- [ ] Typecheck passes.
**Dependencies:** US-000
**Estimated complexity:** medium

## US-003: Fix small deterministic unit failures (sessionScanner, codexCommand, ledger/writer)
**Description:** As a maintainer, I want the remaining deterministic unit failures fixed — including the documented Windows temp-dir cleanup race — without masking a real regression.
**Acceptance Criteria:**
- [ ] `src/claude/utils/sessionScanner.test.ts` "should process initial session and resumed session correctly" passes; record a one-line drift-vs-product verdict for the `length 3 vs 2` dedup mismatch (same masking safeguard as US-002).
- [ ] `src/commands/codexCommand.test.ts` assertion failure passes; record a one-line drift-vs-product verdict.
- [ ] `src/ledger/writer.test.ts` `ENOTEMPTY/EBUSY` cleanup race is fixed using `fs.rm(..., { recursive: true, force: true, maxRetries, retryDelay })` per `packages/happy-cli/AGENTS.md` L41.
- [ ] These stories own those files; the cluster-C timeouts in `codexCommand.test.ts` and `ledger/writer.test.ts` are resolved here (file ownership is clean — US-004 owns the OTHER cluster-C files).
- [ ] `pnpm --filter happy exec vitest run src/claude/utils/sessionScanner.test.ts src/commands/codexCommand.test.ts src/ledger/writer.test.ts` is green.
- [ ] Typecheck passes.
**Dependencies:** US-000
**Estimated complexity:** small

## US-004: Resolve timeout cluster C + scopeB cascade (G) — owns `vitest.config.ts` testTimeout
**Description:** As a maintainer, I want the 5000ms timeouts resolved deterministically (or `skipIf`-gated with evidence) so they stop flaking the gate.
**Acceptance Criteria:**
- [ ] Using the US-000 isolated baseline, for each cluster-C test owned here (`roadmap/renderRoadmap.test.ts`, `claude/utils/claudeFindLastSession.test.ts`, `codex/codexAppServerClient.test.ts`, `daemon/controlServer.spawnSessionFromSession.test.ts`, `daemon/spawnInWorktree.test.ts`, `daemon/worktreeTransactions.test.ts`, `agentComms/scopeB.test.ts`): make it deterministic (raise per-test `testTimeout`, fake timers, retry) OR — only with concrete evidence (isolated-run output + reason a deterministic fix is impractical + exact condition) — `skipIf`-gate it with a skip-list row.
- [ ] Fix the `scopeB.test.ts:88` `afterAll → server.stop()` cascade (guard `server` and/or fix the `beforeAll` setup timeout; scopeB is the only `fs.watch` user — apply the AGENTS.md L41 cleanup remedy if relevant).
- [ ] If the isolated baseline shows broad load-sensitivity, raise the `unit` project `testTimeout` in `packages/happy-cli/vitest.config.ts`.
- [ ] No Bucket-A pure-unit test is blanket-skipped.
- [ ] Typecheck passes.
**Dependencies:** US-000, US-001, US-002, US-003
**Estimated complexity:** medium
**Note:** Edits `packages/happy-cli/vitest.config.ts` — bundle/serialize with US-005 (same file).

## US-005: Gate the integration projects behind `RUN_INTEGRATION=1` (cluster D)
**Description:** As a maintainer, I want the environment-dependent integration projects excluded from the default gate (opt-in via env) so a no-auth/no-DB box reaches a green default run without editing integration test content.
**Acceptance Criteria:**
- [ ] In `packages/happy-cli/vitest.config.ts`, build the `projects` array so the `unit` project is always included and the five integration projects (`integration-empty`, `integration-claude-utils`, `integration-plan-mode`, `integration-authenticated`, `integration-agent-comms`) are included **only when `process.env.RUN_INTEGRATION === '1'`**.
- [ ] Verify: default `pnpm --filter happy test` runs only the `unit` project (integration projects absent from the run, NOT errored) and exits 0.
- [ ] Verify: `RUN_INTEGRATION=1 npm_config_script_shell=bash pnpm --filter happy test` still includes the integration projects (gate is opt-in, not deleted).
- [ ] No integration test file is edited; repo-root `environments/environments.ts` is NOT edited.
- [ ] Typecheck passes.
**Dependencies:** US-000
**Estimated complexity:** small
**Note:** Edits `packages/happy-cli/vitest.config.ts` — bundle/serialize with US-004 (same file).

## US-006: Acceptance closeout — green gate + documented skip-list
**Description:** As a maintainer, I want a single trustworthy green default run and a documented skip-list/opt-in so the suite is a reliable acceptance signal for future happy-cli impls.
**Acceptance Criteria:**
- [ ] On an unloaded box, `npm_config_script_shell=bash pnpm --filter happy test` exits 0 with `tsc --noEmit` passing.
- [ ] A `### Test skip-list / quarantine` subsection is added to `packages/happy-cli/AGENTS.md` (Testing block) documenting (i) the integration opt-in (`RUN_INTEGRATION=1`) and (ii) a table of any unit-level `skipIf` quarantines (file · condition · tracking ref · re-enable prereq). Each new unit code skip carries a matching `// TODO(<ref>):` comment.
- [ ] Unit-level quarantine skips added by this task are ≤ 5 and equal the number of rows in the table; no Bucket-A pure-unit test appears in it.
- [ ] The final default-run skipped set is compared against the US-000 before-list; every newly-skipped test is accounted for in the table; no previously-passing test became failing or silently skipped.
**Dependencies:** US-001, US-002, US-003, US-004, US-005
**Estimated complexity:** small
