# Research Brief: codex-app-server-idle-timeout (D-001 defer-and-instrument)

Feature: happy-cli (TS) ONLY. ZERO codex Rust edits / no codex submodule touch.
(1) `--idle-timeout` spawn-flag seam gated behind a `codex app-server --help`
capability probe (fail-closed, default OFF). (2) idle-lifetime telemetry
(last_client_disconnect_age_ms, uptime_ms, RSS sampling). (3) orphan-age
distribution in `happy codex doctor`. (4) optional `happy codex kill-idle` IF
cheap. REJECT a TS-side idle timer.

## Researcher Findings (explore, gpt-5.4-mini)

- Spawn/probe seam: `codexAppServerClient.ts:148-160` (`isWsAuthAvailable()` help
  probe), `:283-301` (ctor, transportSource, wsAuthProbeResult,
  resolveEffectiveTransport fallback), `:851-888` (`createWsConnection()` detached
  spawn + ws transport), `:1069-1210` (`connect()` builds args/listenUrl, ws path
  has `--ws-auth capability-token --ws-token-sha256 <sha>` then appends
  extraAppServerArgs).
- Probe cache: `:947-951` (`getWsAuthAvailability()` memoizes per instance);
  fallback to stdio `:291-301`; explicit ws fails closed `:1092-1097`.
- `--codex-arg` flow: `cliArgs.ts:251-292` (`extractCodexArgFlag`) →
  `codexCommand.ts:16-52` (passes `codexAppServerArgs`) → `runCodex.ts:701-706`
  (`extraAppServerArgs: opts.codexAppServerArgs`) → client `:288-289`, appended at
  `:1129-1131` (stdio) and `:1186-1188` (ws).
- Sidecar: `codexDaemonLifecycle.ts:29-55` strict discriminated union — disconnect
  has `last_client_disconnect_age_ms`; exit has `uptime_ms`, `rss_kb_at_exit`,
  `last_client_disconnect_age_ms`. `codexDaemonTelemetry.ts:20-33` write/rotate.
  Emit sites in client: synthetic exit `:780-800`, observable exit `:793-801`,
  reattach `:1032-1044`, disconnect `:1388-1398`.
- Doctor: `codexDaemonDoctor.ts:16-34` types, `:123-177` table (columns: state,
  pid, endpoint, cwd, age, RSS, last-health, last-disconnect, exit_reason,
  version), `:180-247` `probeCodexDaemon()` (RSS null today), `:249-259`
  `classifyCodexDaemonState()`, `:268-335` `runCodexDoctor()` summary + exit-code
  matrix. Dispatch before auth at `codexCommand.ts:16-20`.
- RSS: `ps-list` IS a dependency (`package.json:68-120`); doctor RSS blank/null
  (`:123-130, 224-245`); doc says ps-list `%mem` != RSS-KB, no bg timer
  (`docs/codex-daemon-lifecycle.md:205-208`).
- Tests: `package.json:60-66` `test: pnpm run build && vitest run`. Patterns:
  `codexAppServerClient.test.ts` (`vi.mock('./codexDaemonTelemetry')` spy seam,
  `execSync` help-probe mock, extraAppServerArgs-verbatim, explicit/implicit
  ws-auth fallback). `codexDaemonTelemetry.test.ts:16-149`,
  `codexDaemonDoctor.test.ts:110-292` (RSS null, exit codes, post-mortem),
  `codex.integration.test.ts:48-78`.
- Env/config: `configuration.ts:32-79` reads HAPPY_SERVER_URL, HAPPY_WEBAPP_URL,
  HAPPY_HOME_DIR, HAPPY_EXPERIMENTAL, HAPPY_DISABLE_CAFFEINATE, HAPPY_VARIANT;
  `utils/envNames.ts:1-4` env-name constants.
- Docs headings: Discovery Contract / Detached Spawn / happySessionId Mismatch /
  Sidecar Lifecycle File / Event Taxonomy (spawn,reattach,disconnect,exit) /
  Doctor States / Exit-Code Matrix / Security Note / Stdio Scope Note / What This
  Does Not Do.

## Architect Analysis (explore, gpt-5.4-mini)

- Integration points: probe seam mirrors `isWsAuthAvailable()`/`getWsAuthAvailability()`
  (cached `:272`,`:297-300`,`:1092-1104`); inject flag at ws argv `:1185-1188`
  (ws branch only; leave stdio/sandbox-wrapped stdio untouched); RSS at exit
  emit `:738-777`/placeholder hook `:728-730`/schema fields `lifecycle.ts:44-54`;
  doctor orphan-age in `buildRows()`/`runCodexDoctor()` `:268-280`.
- Dependency graph: CLI flags `codexCommand.ts:16-52` → `runCodex.ts:701-706`
  (transport/transportSource/logFilePath/extraAppServerArgs) → client. Idle-timeout
  threads the same path → `CodexAppServerClientOptions` → ws-only spawn argv.
- Constraints: strict snake_case append-only sidecar; raw ws token must stay out
  of argv/env/logs/sidecar; doctor read-only; idle-timeout ws-only; sandbox forces
  stdio non-Windows `:1086-1090`,`:1110-1117`; Windows RSS gap.
- Approach: reuse ws-auth probe + extraAppServerArgs + telemetry spy-test patterns;
  single source-of-truth flag string; prefer CLI flag over `--codex-arg` (footgun);
  kill-idle "cheap if it reuses enumerateDiscoveryRecords + terminate/delete
  invariants `:803-849`, preserving confirm-dead-before-delete."
- Stories: (1) spawn seam+probe [client,runCodex,codexCommand]; (2) idle telemetry
  on exit [client,lifecycle]; (3) doctor orphan-age/RSS [doctor,lifecycle];
  (4) optional kill-idle [codexCommand,client,discovery]; (5) tests. Story 1 & 2
  overlap on client.ts → serialize. 3 after 2. 4 depends on 1/2/3.

## Codex Research (codex-exec, gpt-5.5 xhigh)

- Same seam placement + opt-in threading (`extractCodexIdleTimeoutFlag` in
  cliArgs.ts → codexCommand.ts before extractCodexArgFlag → runCodex
  `codexIdleTimeout` → client). WS-only (stdio foreground-owned).
- `refreshLastSampledRssKb()` is a null stub already called on
  spawn/reattach/disconnect/synthetic-exit; `rss_kb_at_exit`/`uptime_ms`/
  `last_client_disconnect_age_ms` already in strict schema; doctor already has
  RSS/age/last-disconnect columns, groups by `(pid, started_at_ms)`, hardcodes
  live RSS null.
- Canonical seam: `CODEX_IDLE_TIMEOUT_FLAG = '--idle-timeout'` constant shared by
  probe + argv. Opt-in `happy codex --idle-timeout <seconds>`, validate positive
  integer, default undefined = OFF, env/config later.
- RSS: add `packages/happy-cli/src/codex/processRss.ts` → `Promise<number|null>`,
  true KB only where reliable else null; wire into `refreshLastSampledRssKb()` and
  `probeCodexDaemon()`.
- Doctor: `idle-age` column (latest disconnect for live/stale; exit
  last_client_disconnect_age_ms for post-mortem) + bucket summary `<1h`/`1-24h`/
  `>24h`/`unknown`.
- **kill-idle NOT obviously cheap**: existing terminators are PRIVATE and delete
  via current-cwd `discoveryFilePath()`, not arbitrary enumerated discovery files;
  cross-cwd reaping needs per-record/file locking + a shared terminator helper.
  Defer unless the plan includes that small explicit refactor.
- Tests: extend cliArgs.test.ts, codexCommand.test.ts, codexAppServerClient.test.ts,
  codexDaemonDoctor.test.ts, codexDaemonLifecycle.test.ts + focused RSS helper test.

## Copilot Research (copilot-exec, xhigh)

- Mirrors codex/architect: `extractCodexIdleTimeoutFlag()` (integer seconds) →
  command → runCodex → CodexAppServerClientOptions; ws-only.
- `isIdleTimeoutAvailable()` + `getIdleTimeoutAvailability()` mirroring ws-auth;
  append `[IDLE_TIMEOUT_FLAG, String(seconds)]` before extraAppServerArgs when
  configured AND supported; else no-op + one-time non-error log.
- RSS: small platform-aware sampler module used by both `refreshLastSampledRssKb()`
  and `probeCodexDaemon()`; null on Windows if no reliable true-RSS.
- Doctor buckets `<1h`/`1-24h`/`>24h`/unknown + keep per-instance values (testable).
- **kill-idle: DEFER** unless reusable without exposing private CodexAppServerClient
  methods / broad cross-cwd plumbing.

## CONSENSUS (2+ lenses)

1. Probe mirrors ws-auth precisely: `isIdleTimeoutAvailable()` +
   `getIdleTimeoutAvailability()` cached per instance; fail-closed no-op.
2. Single source-of-truth flag constant `CODEX_IDLE_TIMEOUT_FLAG = '--idle-timeout'`,
   value = positive integer seconds.
3. Structured opt-in `happy codex --idle-timeout <seconds>` via
   `extractCodexIdleTimeoutFlag()` (NOT `--codex-arg`); default undefined = OFF;
   env/config deferred.
4. WS-only injection at `:1185-1188` (stdio foreground-owned, untouched).
5. RSS = implement a real sampler (`processRss.ts`) and wire into the EXISTING
   `refreshLastSampledRssKb()` stub + `probeCodexDaemon()`; never report `%mem` as
   RSS-KB; null on unsupported platforms (Windows).
6. Doctor: `idle-age` per-instance + bucket summary `<1h`/`1-24h`/`>24h`/`unknown`;
   stays read-only.
7. Tests extend existing files + focused RSS helper test; spy at the
   `codexDaemonTelemetry` boundary, mock `execSync` for the help probe.

## DIVERGENCE

- **kill-idle (D-004) cost.** Architect: cheap (reuse enumerate + terminate
  invariants). Codex + Copilot: NOT cheap — terminators are private & current-cwd
  only; needs a shared per-discovery-file terminator + lock refactor. 2/3 external
  lenses say defer-unless-refactored. Per the seed's "IF cheap" gate → recommend
  DEFER as a fast-follow, with the minimal-standalone-reaper option documented for
  operator/Phase-4 to weigh.

## Consolidated File List

### Files to modify
- `packages/happy-cli/src/codex/codexAppServerClient.ts` — flag constant, probe
  (`isIdleTimeoutAvailable`/`getIdleTimeoutAvailability`), ws argv injection,
  wire real RSS into `refreshLastSampledRssKb()`, new ctor option `idleTimeoutSec`.
- `packages/happy-cli/src/codex/cliArgs.ts` — `extractCodexIdleTimeoutFlag()`.
- `packages/happy-cli/src/commands/codexCommand.ts` — parse + thread; (kill-idle
  dispatch only if included).
- `packages/happy-cli/src/codex/runCodex.ts` — thread `codexIdleTimeout` option.
- `packages/happy-cli/src/codex/codexDaemonDoctor.ts` — idle-age column + bucket
  summary; RSS via `processRss`.
- `packages/happy-cli/docs/codex-daemon-lifecycle.md` — document seam, telemetry,
  doctor surfacing.

### Files to create
- `packages/happy-cli/src/codex/processRss.ts` — platform-aware RSS sampler.
- `packages/happy-cli/src/codex/processRss.test.ts` — sampler tests.

### Test files (extend)
- `codexAppServerClient.test.ts`, `cliArgs.test.ts`, `codexCommand.test.ts`,
  `codexDaemonDoctor.test.ts`, `codexDaemonLifecycle.test.ts`.

### Build/config
- `packages/happy-cli/package.json` — `ps-list` already present; likely no new dep.
- Test command: `npm_config_script_shell=bash pnpm --filter happy test` (Git Bash)
  or `pnpm --filter happy exec vitest run <paths>` for file-scoped runs.

### Lifecycle schema
- `codexDaemonLifecycle.ts` — NO schema change required for telemetry; fields
  already exist. (Only touch if a new doctor-only derived field is needed; avoid.)
