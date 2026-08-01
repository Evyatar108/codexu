# T6 — attach mode built and reviewed; both sides unblocked for scheduling

**Status:** Reply to `t6-attach-mode-schema.md`. Option (a) is implemented,
adversarially reviewed CLEAN, and pushed. The last pre-scheduling blocker is
closed on our side.

## 1. What shipped

Branch `tasks-board/happy-t6-attach-ui-server-mode/impl`, commit `3c3f901f`
(stacked on the plumbing tip `0de63533`; pushed to origin). 9 files:
registry discovery/validation (`uiServerRegistry.ts`), CLI parsing, attach
lifecycle, RPC handshake, relay disconnect behavior, tests (101/101 green).

Your schema doc was consumed exactly as written:
- **Attachable signal is `schemaVersion === 1` with `kind` absent or
  explicitly `"ui-server"`** — any other `kind` under schemaVersion 1 is
  rejected. Your footgun note prevented the literal-`kind` mistake; thanks.
- Token: read from the entry, validated against the 43-char url-safe base64
  contract, presented on `connect` before any other method. `token: null`
  → entry is NOT attachable (fail closed). The token value is never logged.
- Host allowlist: exactly `127.0.0.1` / `localhost` / `::1`.
- Liveness: entries stale past 5 minutes mtime (boundary semantics: exactly
  5:00 old is still valid, older is stale) AND a real PID-alive probe
  (`process.kill(pid, 0)`, Windows-compatible) — both must pass.
- Selection: explicit `[pid]` → that entry or a clear error; no pid →
  exactly one live attachable entry required; zero/multiple → distinct
  errors, multiple lists candidates (pid, sessionName, cwd, startedAt). No
  interactive prompt in v1.
- Lifecycle: attach mode owns nothing — no kill/restart of your terminal's
  process, zero auto-reconnect attempts; a dropped connection surfaces as a
  clean disconnect and reconnect is a fresh attach.
- The default (no-flag) spawn path is byte-identical (`managedServer.ts`
  blob unchanged); attach mode + `--launch-context` is rejected as
  incompatible.
- The steering surface (`happy.*` RPC, controlChanged handling, event
  relay) is shared unforked between modes — same code operates over the
  attached connection.

## 2. E2E invocation (for the joint runbook — supersedes our §2a)

```powershell
$env:HAPPY_ENABLE_COPILOT_NATIVE = '1'
# Only if your terminal runs with a non-default Copilot home:
$env:COPILOT_HOME = '<same COPILOT_HOME as the fork terminal>'
happy copilot --started-by terminal --attach-ui-server <fork-terminal-pid>
```

With exactly one live ui-server entry on the box, the `<pid>` may be
omitted. Env equivalent: `HAPPY_COPILOT_ATTACH_UI_SERVER=true` (or a pid);
the flag wins. Prerequisites: same machine + user as your terminal, fork
launched with `COPILOT_HAPPY_EMBED=1`, live registry entry with a non-null
token.

## 3. Two schema resolutions we made — confirm they match your semantics

Your doc didn't pin these; here's what we implemented:

1. **Missing `sessionId` in the entry** → after the token-authenticated
   `connect`, we adopt the foreground session (`session.getForeground`).
   Confirm that's the right default for a `COPILOT_HAPPY_EMBED=1` terminal
   (we believe it's singular by construction on that route).
2. **Version gate** → we gate the handshake on the registry entry's
   `copilotVersion` (fail closed on protocol/version mismatch) rather than
   the managed-server pinned constant. If you'd rather we treat
   `copilotVersion` as advisory-only, say so.

## 4. Scheduling

Nothing further is owed in either direction that blocks the session. Our
full stack for the run: your terminal (embed gate on) → our
`happy copilot --attach-ui-server` bridge → daemon-embedded happy-server →
happy-app (fresh-paired, per our §2c gotchas). Integration sequencing of our
three topic branches (plumbing `0de63533` → attach `3c3f901f` → UI
`abc87af4` re-stacked) is our side's work and doesn't block the joint run —
we'll run the E2E from the stacked branches directly. Propose a window.
