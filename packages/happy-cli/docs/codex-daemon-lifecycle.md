# Codex Daemon Lifecycle Contract

This document is the operating contract for Happy's Codex app-server WebSocket
daemon: discovery records, the per-cwd lock, detached process ownership,
lifecycle telemetry, and the read-only `happy codex doctor` / `status`
diagnostics.

## Discovery Contract

WebSocket app-server discovery lives under the Happy home directory as
`codex-active-<cwdHash>.json`, normally `~/.happy/codex-active-<cwdHash>.json`
or `$HAPPY_HOME_DIR/codex-active-<cwdHash>.json`. The file schema is version 1
and is defined by `CodexDiscoveryRecord` in
`src/codex/codexAppServerDiscovery.ts:20-56`:

| Field | Meaning |
|---|---|
| `version` | Literal discovery schema version, currently `1`. |
| `pid` | OS process id for the WebSocket app-server. |
| `port` | Loopback port used by `ws://127.0.0.1:<port>`. |
| `startedAt` | ISO timestamp captured when the discovery record is created. |
| `happyCliVersion` | Happy CLI package version that spawned the daemon. |
| `cwd` | Canonical working directory served by this daemon. |
| `capabilityToken` | Raw loopback WebSocket bearer token, local profile only. |
| `capabilityTokenSha256` | SHA-256 hash of the token for diagnostics. |
| `transport` | Literal `ws`; stdio sessions do not write discovery. |
| `happySessionId` | Optional Happy session id that owns the daemon. |

`cwdHash` is the SHA-256 of `realpathSync(cwd)`
(`src/codex/codexAppServerDiscovery.ts:58-60`). `discoveryFilePath()` and
`lockFilePath()` derive the discovery file and `<file>.lock` paths from that
hash (`src/codex/codexAppServerDiscovery.ts:63-69`). The lock is acquired with
`openSync(path, 'wx', 0o600)` after ensuring the parent directory exists, and
is released by closing the fd and unlinking the lock file
(`src/codex/codexAppServerDiscovery.ts:165-190`). That lock is the cwd-keyed
single-flight gate: normal connect and force-restart flows must not spawn or
replace a WebSocket app-server for a cwd without holding it.

`writeDiscoveryRecord()` writes an atomic temp file and renames it over the
record (`src/codex/codexAppServerDiscovery.ts:104-123`).
`deleteDiscoveryIfMatches()` removes a record only when both `pid` and
`startedAt` match the intended instance (`src/codex/codexAppServerDiscovery.ts:125-133`).
Because clean termination can remove the discovery record, doctor enumerates
the union of discovery records and lifecycle sidecar events; otherwise
post-mortem-only daemons would be invisible.

## Detached Spawn And Foreground CLI Lifetime

The WebSocket transport launches `codex app-server` as a detached child with
ignored stdin and stdout/stderr redirected to the app-server log fd:

```ts
crossSpawn(command, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env,
    windowsHide: true,
});
```

This is implemented in `src/codex/codexAppServerClient.ts:859-871`. The child
is `unref()`-ed, so it can outlive the foreground Happy CLI process. A normal
foreground disconnect preserves the daemon and leaves discovery in place;
`disconnect({ terminateAppServer: true })`, force restart, version mismatch,
session mismatch, or spawn cleanup explicitly terminate it.

## happySessionId Mismatch Guard

When a reconnect attempts to reuse a discovery record with a different
incoming `HAPPY_CURRENT_SESSION_ID`, the client treats the discovered daemon as
belonging to another Happy session. The reattach branch sets
`terminationReason = 'session_mismatch'`, emits a synthetic exit event, and
terminates the attached app-server before falling through to spawn a fresh one
(`src/codex/codexAppServerClient.ts:984-990`). The persisted exit event records
`exit_reason: 'session_mismatch'` and `exit_code: null`.

## Sidecar Lifecycle File

Lifecycle telemetry is stored at
`<happyHomeDir>/codex-daemons/lifecycle.jsonl`. The helper lives in
`src/codex/codexDaemonLifecycle.ts` and exposes a frozen four-event schema:
spawn, reattach, disconnect, and exit. There is no `health` event.

The sidecar is append-only. `appendEvent()` validates the event, creates the
parent directory, and performs one append write with
`writeFileSync(path, JSON.stringify(parsed) + '\n', { flag: 'a' })`
(`src/codex/codexDaemonLifecycle.ts:71-76`). Readers use
`instanceKey({ pid, startedAt })`, rendered as `<pid>:<startedAt>`, as the
daemon instance key (`src/codex/codexDaemonLifecycle.ts:63-65`). `readEvents()`
parses line by line and tolerates one torn final line by dropping only that
last unparseable line (`src/codex/codexDaemonLifecycle.ts:78-101`).

Rotation is single-tier. `rotateIfNeeded()` renames `lifecycle.jsonl` to
`lifecycle.jsonl.1` after the current file exceeds 5 MB, deleting any existing
`.1` first. If rename/delete throws, it logs a warning and leaves the current
file in place for the next append to retry (`src/codex/codexDaemonLifecycle.ts:103-118`).
There is no age-prune helper in v1; revisit pruning after 4 weeks of operator
telemetry per the plan's Open Question 6.

Lifecycle JSON uses snake_case field names intentionally. This sidecar is an
append-only public diagnostic contract read outside the TypeScript process, so
these fields must not be renamed to Happy's usual camelCase style
(`src/codex/codexDaemonLifecycle.ts:1-7`).

## Event Taxonomy

All events include these base fields:

| Field | Meaning |
|---|---|
| `event` | One of the four persisted event names below. |
| `pid` | OS process id for this daemon instance. |
| `started_at_ms` | Epoch-ms instance start key used with `pid`. |
| `cwd` | Canonical cwd associated with the daemon. |
| `happy_session_id` | Optional Happy session id, when known. |

### `codex.daemon.spawn`

Emitted after the freshly spawned WebSocket daemon completes `initialize` and
after `writeDiscoveryRecord()` succeeds (`src/codex/codexAppServerClient.ts:1294-1341`).

| Field | Meaning |
|---|---|
| `endpoint` | Token-free `ws://127.0.0.1:<port>` endpoint. |
| `cold_start_ms` | Nonnegative ms from spawn-decision time to initialize ack. |

### `codex.daemon.reattach`

Emitted only after an existing discovery record's WebSocket connection opens
and the reattach `initialize` succeeds (`src/codex/codexAppServerClient.ts:1008-1045`).
Stale PID, session mismatch, version mismatch, refused connection, and
initialize failure do not emit reattach.

| Field | Meaning |
|---|---|
| `reattached_at_ms` | Epoch ms when successful reattach completed. |

### `codex.daemon.disconnect`

Emitted from `disconnectInternal()` when the client has a discovery record,
before the connection/discovery state is cleared (`src/codex/codexAppServerClient.ts:1377-1410`).
It fires for normal disconnects and for disconnects followed by intentional
termination.

| Field | Meaning |
|---|---|
| `disconnected_at_ms` | Epoch ms for the client-side disconnect. |
| `last_client_disconnect_age_ms` | Ms since this client instance's previous disconnect, or `null` for the first one. |

### `codex.daemon.exit`

Exit events have two producers and one per-instance dedup guard. Both routes
go through `emitCodexDaemonExitEvent()`, which returns immediately when
`exitEventEmitted` is already true and otherwise sets it before emitting
(`src/codex/codexAppServerClient.ts:746-786`).

Synthetic exit events are emitted at intentional-kill decision time before the
kill. They use `exit_code: null` and refresh RSS with a final best-effort
sample (`src/codex/codexAppServerClient.ts:788-799`). Callers include attached
termination, spawned-child termination, session mismatch, version mismatch,
and force-restart paths.

Observable exit events come from the extended child handler
`child.once('exit', (code, signal) => ...)`, which captures `lastExitCode` and
`lastExitSignal`, preserves the existing `wsChildExited` / handler machinery,
and emits only when the dedup guard has not already fired
(`src/codex/codexAppServerClient.ts:877-890`). Detached post-disconnect deaths
are not emitted in real time because foreground Happy has detached and no
process remains to observe the eventual child exit; doctor reports those later
from discovery plus sidecar state.

| Field | Meaning |
|---|---|
| `exited_at_ms` | Epoch ms when the exit event was produced. |
| `exit_code` | Child exit code, or `null` for synthetic intentional-kill events. |
| `exit_signal` | Child exit signal when observable, otherwise `null` or absent. |
| `exit_reason` | Classified reason, described below. |
| `termination_reason_detail` | Optional detail, currently used for `version_mismatch`. |
| `uptime_ms` | Nonnegative ms from `started_at_ms` to `exited_at_ms`, or `null` when unavailable. |
| `rss_kb_at_exit` | Last opportunistic RSS sample in KB, or `null` when no sample exists. |
| `last_client_disconnect_age_ms` | Ms since this client instance's previous disconnect, or `null`. |

Exit reasons:

| Value | Example cause |
|---|---|
| `killed` | `disconnect({ terminateAppServer: true })`, force restart, version mismatch, spawn cleanup. |
| `session_mismatch` | Discovery record belongs to another Happy session id. |
| `crashed` | Observable child exit with a nonzero exit code and no intentional reason. |
| `unknown` | Observable child exit with no intentional reason and no useful code. |

RSS sampling is opportunistic only: once after connect/reattach initialize,
once at disconnect start, and once at intentional-kill synthetic exit. There
is no background timer.

## Doctor States

`happy codex doctor` and `happy codex status` dispatch before auth, daemon
startup, or Codex flag parsing (`src/commands/codexCommand.ts:16-20`). Doctor
enumerates discovery records with `enumerateDiscoveryRecords()`, reads sidecar
events with `readEvents()`, groups events by `instanceKey({ pid, startedAt })`,
and builds the union of discovery and sidecar instance keys
(`src/codex/codexDaemonDoctor.ts:248-301`).

Instances with discovery records are probed concurrently through
`Promise.all`. Each probe checks `isPidAlive(pid)` and attempts a WebSocket
`initialize` using the saved capability token with a 1.5 second timeout
(`src/codex/codexDaemonDoctor.ts:164-226`, `:278-283`). Probe results render
to the table only. They do not emit `codex.daemon.health`, and there is no
health event in the sidecar schema.

Doctor states:

| State | Classification |
|---|---|
| `live` | Has discovery record, PID is alive, and WS initialize probe succeeded. |
| `stale-pid-gone` | Has discovery record and PID is not alive. |
| `stale-unreachable` | Has discovery record, PID is alive, and WS initialize failed or timed out. |
| `post-mortem` | Has no discovery record and has sidecar events for the instance. |

Doctor is read-only. It does not rotate, prune, kill, restart, remove, or
delete daemons. It renders a table with state, PID, endpoint, cwd, age, RSS,
last-health, last-disconnect, exit reason, and version
(`src/codex/codexDaemonDoctor.ts:138-161`). The summary line is
`N live, M stale, P post-mortem` plus the stdio disclaimer
(`src/codex/codexDaemonDoctor.ts:296-300`).

## Exit-Code Matrix

`happy codex doctor` and `happy codex status` return:

| Code | Meaning |
|---|---|
| `0` | At least one instance is classified `live`. |
| `1` | Instances exist, but zero are `live`. |
| `2` | No discovery records and no sidecar events exist. |
| `3` | Discovery directory enumeration threw, such as unreadable or not a directory. |

The command sets `process.exitCode` and returns; it does not call
`process.exit()`.

## Security Note

The raw `capabilityToken` never leaves the discovery record into lifecycle
telemetry or doctor output. Spawn telemetry uses the token-free WebSocket URL.
The doctor table may render only the existing `capabilityTokenSha256` field as
`sha256:<first-8-hex>` (`src/codex/codexDaemonDoctor.ts:87-90`).

## Stdio Scope Note

Stdio transport is foreground-owned. It has no discovery record and no exposed
daemon pid metadata via `createStdioTransport()`, so Happy emits no lifecycle
telemetry for stdio sessions. Doctor cannot discover stdio sessions and says
so in its summary line.

## What This Does Not Do

This lifecycle work is observability only. It does not add a supervisor,
auto-restart, app-server multiplexing, codex submodule changes, or remediation
from doctor/status. Recovery behavior stays in existing explicit restart and
termination paths.
