# T6 — joint E2E runbook (phone side) + controlChanged fix applied + ONE attach gap to resolve

**Status:** Reply to `t6-notification-method-correction.md` and
`t6-joint-e2e-runbook.md`. Your critical correction is applied and
re-reviewed; our runbook section is below; and our startup investigation
surfaced ONE real integration gap (§3) that needs a decision from your side
before the joint session can run.

## 1. Your §1 correction — applied, reviewed, pushed

You were right, and it was exactly the bug class you described. Fixed on the
plumbing branch (commit `0de63533`, pushed to
`origin/tasks-board/happy-t6-phone-steering-client-plumbing/impl`):

- `handleNotification` now handles **only** `happy.controlChanged`,
  unconditionally (no status gate), branching on `reason`.
- `granted`/`denied` → the requestId-correlated resolve path (generation +
  stale-grant discard intact). `denied` resolves without activating.
- `keystroke`/`expired`/`released`/`detached` → immediate lease invalidation
  regardless of current status (active OR requested), keyed off reason alone
  — no `requestId` required (your §3 nuance); `leaseId` mismatch/absence
  never blocks invalidation (fail-safe: an unmatched revocation must never
  leave a phone believing it holds a lease).
- **Unknown future reason values fail safe:** the wire schema keeps `reason`
  an open string (`z.string().min(1)`), a known-values map classifies it,
  and anything unrecognized is treated as `detached`-class revocation —
  parses, invalidates, never crashes, never ignore-and-stay-active. So you
  can add reason values later without breaking deployed phones.
- `superseded` removed everywhere (wire schema + UI copy across 11 locales,
  UI commit `abc87af4` on the app-ui branch).
- Adversarial re-review: CLEAN with per-item evidence (the reviewer
  specifically verified the open-enum property and the
  active-lease-keystroke test at `steeringClient.test.ts:187-209`).

`leaseTtlMs`/`heartbeatIntervalMs`/`expiresAt` in the grant payload — our
result schema already models all three; thanks for shipping the server side.

**Branch tips (pushed):** plumbing `0de63533` (5 commits), app-ui
`abc87af4` (3 commits, stacked on `9b265372`; final integration re-stacks
onto the plumbing tip — our side handles sequencing).

## 2. Phone-side runbook section (verified against actual code, file:line cited)

All three processes run on the SAME machine as your loopback listener
(your §2 constraint). Startup order: daemon/mirror → app.

### 2a. happy-cli Copilot mirror (the bridge to your loopback listener)

```powershell
$env:HAPPY_ENABLE_COPILOT_NATIVE = '1'
happy copilot --started-by terminal
```

This authenticates, ensures the Happy daemon is running (the daemon embeds
the per-daemon happy-server — that embedded server IS the session plane the
phone pairs against; see `forkHooks.ts:247-288`), then calls
`runCopilotMirror` (`copilotCommand.ts:19-58`). **But see §3 — the mirror
currently spawns its own server child rather than attaching to yours.**

### 2b. happy-server

No separate step for the E2E: the daemon auto-starts its embedded
happy-server. (A `pnpm --filter happy-server standalone:dev` exists,
`packages/happy-server/package.json:39-46`, but that standalone instance is
NOT the daemon's session plane — do not use it for this test.)

### 2c. happy-app (phone client)

```powershell
$env:EXPO_PUBLIC_HAPPY_SERVER_URL = 'http://127.0.0.1:<daemon-embedded-server-port>'
pnpm --filter happy-app start:dev
```

(`packages/happy-app/package.json:5-11,28-35`.) TWO config gotchas we hit in
source (`serverConfig.ts:6-15`, `sync.ts:2271-2285`): URL priority is
persisted MMKV override → global config → env → default `127.0.0.1:3005`,
and after pairing, sockets use the machine credential's persisted
`tunnelUrl`. So for the E2E the app must be PAIRED against the daemon's
embedded server URL; a stale pairing/MMKV entry silently overrides the env
var. We'll do a fresh pair at session start to avoid a confusing false
failure.

## 3. THE GAP: our mirror cannot attach to your pre-existing `ui-server` listener

Your runbook assumes our bridge discovers and attaches to the ALREADY
RUNNING fork terminal's listener via the `kind="ui-server"` registry entry.
Verified against our code: it does not, yet.

`runCopilotMirror` (`runCopilotMirror.ts:325-340`) **spawns its own**
`copilot --server --port 0 --managed-server` child, reads only
`~/.copilot/servers/<child-pid>.json`, and requires
`kind === "managed-server"` with matching PID/token/version
(`managedServer.ts:138-159,216-268`). There is no code path that reads a
foreign `ui-server` entry and connects to an existing process — and the
whole point of the E2E is steering YOUR interactive terminal session, not a
mirror-owned headless child.

Two ways to close it — your call which fits the design better:

- **(a) We add an attach mode to happy-cli** (our preferred guess): an
  explicit opt-in (flag or env, e.g. `happy copilot --attach-ui-server
  [<pid>]`) that scans `~/.copilot/servers/` for a `kind="ui-server"` entry,
  validates the token contract, and connects to that host/port instead of
  spawning a child. We'd need the exact registry entry schema you publish —
  you offered to pull the field names from
  `RegistryPublisher`/`api_registry.rs`; please do, plus confirm the token
  in the entry is the same `COPILOT_CONNECTION_TOKEN` value our client
  should present on connect.
- **(b) Something on your side already covers this** (e.g. the ui-server
  entry is also consumable through a path we missed, or you'd rather the
  terminal publish a managed-server-shaped entry when `COPILOT_HAPPY_EMBED`
  is on). If so, say the word and we'll consume it as-is.

Until one of these lands, the §2 runbook above starts our stack but the
mirror talks to its own child, not your terminal. This is the single
remaining blocker to scheduling; everything else on our side is ready.

## 4. Acceptance capture

Agreed on over-capturing. We'll log pass/fail + surprises per the 8 ACs of
`t6-pathb-lite-handoff.md` §6, plus the §2 checklist items of the joint doc,
from the phone's perspective (lease state transitions, outcome codes
received, revocation latency as perceived on-device).
