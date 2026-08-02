# T6 — joint live E2E runbook (fork side)

**Purpose:** a scripted, not exploratory, joint test session per
`t6-joint-objective-and-status.md` §2's "ready" checklist. This covers the
Copilot-fork side precisely (verified against actual code); the codexu side
should fill in the equivalent `happy-cli` agent / `happy-server` relay /
`happy-app` startup steps, since that's your stack.

## 1. Build

The worktree needs a real native build (this is TS + Rust changes across 4
commits: `1b5113d228`, `fb45ce87a0`, `4d8d958d65`, `c011626417`,
`dfdcf0bd9a`, `7c971e5867` — all local-only on
`local/happy-copilot-embedded-ui-server`):

```powershell
copilot-local happy-copilot-embedded-ui-server --rebuild --version
```

Uses the GNU-host build workflow already established for this worktree
(`runtime-composition-build` skill). Expect ~20 min for a real Rust build.
Confirm the printed version string lands before proceeding — do not test
against a stale cached build.

## 2. Launch with the embed gate on

```powershell
$env:COPILOT_HAPPY_EMBED = "1"
# Optional: supply your own 43-char url-safe base64 token, or omit and let
# the CLI generate one in-process (design-sanctioned fallback).
$env:COPILOT_CONNECTION_TOKEN = "<your-43-char-token>"
copilot-local happy-copilot-embedded-ui-server
```

Gate details (verified against `src/cli/happyEmbed.ts`):
- Env vars: `COPILOT_HAPPY_EMBED` (gate), `COPILOT_CONNECTION_TOKEN`
  (per-launch token, captured-then-cleared from env so subagents never
  inherit it).
- Token contract: exactly 32 bytes of CSPRNG entropy, 43-char url-safe
  base64. A supplied-but-invalid token is rejected outright (fails closed,
  never falls back to an anonymous listener).
- Listener binds `127.0.0.1` only, OS-assigned ephemeral port (`0`).
- **This is loopback-only** — whatever bridges your phone to this loopback
  listener (your local `happy-cli` agent process, presumably) needs to run
  on the SAME machine as this Copilot process. Please confirm/fill in your
  side's exact startup sequence for that bridge.

## 3. Discovery

The listener publishes a `kind="ui-server"` discovery entry (host, port,
per-launch token, PID, version) once bound. Verified path (native
`get_registry_dir`, `src/runtime/src/remote/registry.rs`):

- `$COPILOT_HOME/servers/` if `COPILOT_HOME` is set, else
- `~/.copilot/servers/` (i.e. `$env:USERPROFILE\.copilot\servers\` on
  Windows)

If your `happy-cli` agent discovers the port/token by reading this
directory, confirm the entry shape it expects matches what we publish
(schema described in `RegistryPublisher`/`api_registry.rs` if you need the
exact field names — ask and we'll pull them).

## 4. The `/happy` flow (terminal side)

**Ordering correction (2026-08-02, from the live web-VM E2E run
`t6-joint-e2e-results-web-vm.md`): request/grant the lease BEFORE the
permission prompt fires, not after.** Once a native permission modal is
open, terminal keystrokes are consumed by that modal, so `/happy grant`
typed at that point never reaches the slash-command router — the original
steps 1-5 below are unreachable in that order on a real terminal. Steps
renumbered accordingly:

1. On the phone: request the lease (`happy.requestLease`) while no prompt
   is pending yet (e.g. while the model is still producing pre-tool text).
2. **On the terminal**: run `/happy status` to see the pending request ID,
   then `/happy grant <request-id>` (fixed while writing this runbook —
   `/happy status` previously only reported a *count* of pending requests
   with no way to discover the actual ID needed for `grant`; now it lists
   them, commit `0c6ce2ac20`).
3. Phone should transition to holding the lease (`happy.controlChanged`,
   `reason: "granted"`, echoing the `requestId`).
4. Trigger a real permission prompt in the terminal (e.g. ask the agent to
   run a shell command requiring approval, or a file write outside the
   trusted workspace) while the lease is active.
5. Your phone should observe the pending prompt via the generic session
   event stream (no `observePromptEvents` needed — see
   `t6-critical-fixes-and-policy-update.md` §2).
6. Phone answers the prompt (`happy.answerPrompt`) — should resolve
   **synchronously** (not the ~3s CommandPoller-era estimate).
7. Confirm the terminal's own permission dialog dismisses via the existing
   "Resolved by another client" path.
8. Press any key in the terminal — confirm the phone's lease is instantly
   revoked (`happy.controlChanged`, `reason: "keystroke"`) and the phone
   reverts to observe-only.
9. Repeat with a destructive-kind permission (e.g. a write/commands
   request) — confirm the phone renders it deny-only, and that attempting
   to answer `decision: "approve"` from the phone is rejected
   `destructive_kind` (should be unreachable from your UI per your policy
   adoption, but worth confirming the server-side gate independently
   rejects it too, belt-and-braces). **Known open issue (2026-08-02):** a
   valid destructive `deny` currently returns JSON-RPC `-32603` instead of
   a typed outcome — see `t6-deny-path-investigation.md` for the fork-side
   root-cause investigation in progress.


## 5. Expected log locations (fork side)

- Terminal-side: `session.info` events with `infoType: "happy.control"`
  carry human-readable status text (`emitInfo()` in
  `happyMissionControlActor.ts`) — these should be visible in the CLI's own
  timeline/log output.
- `logger.debug` calls throughout `embeddedServer.ts`/`happyMissionControlActor.ts`
  — enable debug logging (`COPILOT_LOG_LEVEL=debug` or equivalent, confirm
  exact env var name if this doesn't work) if something needs deeper
  tracing.

## 6. What to capture during the session

For each of the 8 acceptance-criteria items from `t6-pathb-lite-handoff.md`
§6 (still authoritative), note pass/fail + any surprise. Given both sides
predicted a live run would surface a punch list, err on the side of
over-capturing rather than assuming something "obviously worked."

## What we still need from your side to run this

1. The exact commands to start your `happy-cli` agent / relay process
   pointed at this loopback listener, and the `happy-app` phone client
   pointed at your relay.

Once you've filled in the above, we're ready to schedule.
