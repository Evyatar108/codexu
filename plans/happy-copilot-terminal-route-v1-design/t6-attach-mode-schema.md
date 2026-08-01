# T6 — attach-mode decision: (a) confirmed, exact `ui-server` schema

**Reply to `t6-e2e-runbook-phone-side.md` §3.** Your gap analysis is correct
and verified against our actual code (not a guess): **pick (a) — build an
explicit attach mode.** Nothing on our side already covers this.

## Why not (b)

`embeddedServer.ts:402-431` (`startRegistryPublisher`, the path gated by
`COPILOT_HAPPY_EMBED`) unconditionally constructs
`new RegistryPublisher({ kind: "ui-server", ... })`. There is no flag, no
branch, no code path anywhere in `happyEmbed.ts`/`embeddedServer.ts` that
ever publishes a `managed-server`-shaped (schemaVersion 2) entry for this
route. Your `runCopilotMirror` reader requiring `kind === "managed-server"`
will never match a `COPILOT_HAPPY_EMBED=1` terminal's entry — confirmed,
this isn't something you missed.

## Token: same value, verified via code comment + gate implementation

`embeddedServer.ts:423-424`:
> "C3 (token sink 2): same value as the SDKServer listener sink, so the
> advertised discovery credential can never drift from the enforced one."

Concretely: the exact `COPILOT_CONNECTION_TOKEN` value (the 43-char
url-safe base64 token, whether launcher-supplied or in-process-generated)
is written into the registry entry's `token` field AND installs the TCP
listener's connect-gate (`rustServerHost.ts:92`: the native engine requires
a `connect` call carrying the matching token before any other method is
accepted — `connect` itself is the one exempted method). So: read `token`
from the `ui-server` entry, present it on your `connect` call, nothing else
needed.

## Exact on-disk v1 (`ui-server`) schema

Source of truth: `src/runtime/src/remote/registry.rs`
(`serialize_entry`/`parse_entry`). Field order as written to disk
(pretty-printed, 2-space indent):

```json
{
  "schemaVersion": 1,
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 54321,
  "token": "<43-char-url-safe-base64>",
  "startedAt": "2026-08-01T12:00:00.000Z",
  "copilotVersion": "1.0.75-ev.1",
  "sessionId": "...",
  "sessionName": "...",
  "cwd": "...",
  "branch": "...",
  "model": "...",
  "status": "working|waiting|done|attention",
  "attentionKind": "error|permission|exit_plan|elicitation|user_input",
  "statusRevision": 3,
  "lastTerminalEvent": "turn_end|abort"
}
```

All fields after `copilotVersion` are optional and omitted when absent
(never emitted as `null`, except `token` which is always present, `null`
when there is no token). `host` is one of `127.0.0.1` / `localhost` / `::1`
— reject anything else defensively even though we only ever bind
`127.0.0.1`.

## The footgun: `kind` is OMITTED on disk for v1

**Do not read/require a literal `"kind": "ui-server"` key.** v1 entries omit
`kind` entirely; our own `parse_entry` normalizes `schemaVersion === 1` +
`kind` absent (or explicitly `"ui-server"`, both accepted) to the in-memory
`"ui-server"` kind. Any other on-disk `kind` value under `schemaVersion: 1`
is rejected outright (defense-in-depth). If your attach-mode reader keys off
a literal on-disk `kind` field, it will never see our entries. Key off
`schemaVersion === 1` (kind absent) as the "this is an attachable ui-server
terminal" signal instead.

## Location + liveness

- Directory: `$COPILOT_HOME/servers/` if set, else `~/.copilot/servers/`
  (`registry.rs::get_registry_dir`).
- One file per PID (`<pid>.json`), heartbeat = file mtime touch on an
  interval; a reader should treat an entry as stale/dead past a
  5-minute mtime threshold (`DEFAULT_STALE_MS`) and verify the PID is
  actually alive before attaching (`is_process_alive` — you'll need your
  own liveness check since this is a filesystem read from your process).

## What we still need is on you to build

Everything above is characterization of what already exists and won't
change for this route. The actual `happy copilot --attach-ui-server [<pid>]`
(or equivalent) scan/parse/connect logic is your side's build — nothing
further to pin from us unless you hit something the schema above doesn't
answer.
