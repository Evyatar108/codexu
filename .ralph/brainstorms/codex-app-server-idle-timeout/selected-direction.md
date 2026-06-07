---
overviewTaskId: codex-app-server-idle-timeout
selectedDirection: D-001
selectedBy: operator
brainstormRecommended: D-001
---

## Direction

**D-001 — Defer-and-instrument: ship the seam + idle telemetry, timeout
DEFAULT-OFF, ZERO codex edits.**

The brainstorm's three lenses (codex feasibility, copilot product-reality,
devil's-advocate `red_flag = true`) all converged on D-001, and the operator
selected it. Preserve today's reattach-forever behavior (brainstorm option (a))
as the v1 default. Ship only the cheap, reversible scaffolding in **happy-cli
(TypeScript) only**:

1. A happy-cli `--idle-timeout` **spawn-flag seam** when spawning `codex
   app-server`, gated behind a `codex app-server --help` **capability probe** so
   it **fails closed** (no-op) when the installed codex cannot honor the flag.
   Default OFF (reattach-forever stays the default).
2. **Idle-lifetime telemetry** on the codex daemon sidecar / doctor:
   `last_client_disconnect_age_ms`, `uptime_ms`, and **RSS sampling** — the
   sidecar already records ~80 % of this (per the
   `codex-app-server-daemon-codexu-integration` ship; see
   `packages/happy-cli/docs/codex-daemon-lifecycle.md` and
   `packages/happy-cli/src/codex/`).
3. **Surface the orphan-age distribution** in `happy codex doctor` so the
   eventual "sane default" timeout can be chosen empirically from real data.
4. Fold in **D-004's manual `happy codex kill-idle`** convenience **IF cheap** —
   a janitorial reaper that closes the loop without any automatic-kill race.

This is a **planning task** — the deliverable is a reviewed `plan.md` (plus
stories outline and Phase-4 review artifacts). **No implementation.** The plan is
on **HOLD for operator review** before any impl member is spawned.

### The detach-and-exit trap (the central finding the plan must honor)

happy-cli spawns `codex app-server` as a **detached** child (`detached: true`,
stdio ignored, `unref()`-ed) over a loopback WebSocket
(`codexAppServerClient.ts:857-863`). A bare `disconnect()` **preserves** the
app-server; it outlives the foreground happy-cli process as an orphan. A
happy-cli/TS-side idle timer therefore **dies exactly when happy-cli exits** —
the very moment the orphan is created and would need reaping — so a TS timer
**cannot reap the orphan it is meant to reap.** The plan must **explicitly
REJECT building a TS-side idle timer.** The only places a reliable timer can
live are (i) inside the detached app-server itself (Rust = conflict surface,
deferred as D-002) or (ii) a new long-lived external supervisor (the "new
supervision" the sibling daemon brainstorm explicitly rejected). The seam this
plan ships hands the timer decision to the **codex process itself** via a future
`--idle-timeout` flag, which is the only correct home — so the seam is built now
and stays inert until codex (or a future overlay) honors it.

## Goal

After this lands, happy-cli can **pass an opt-in `--idle-timeout` to `codex
app-server`** through the existing spawn-args path — but only when a
`codex app-server --help` probe confirms codex advertises the flag; otherwise the
seam is a silent no-op and today's reattach-forever behavior is unchanged. The
flag defaults OFF, so no behavior changes for anyone until an operator explicitly
opts in.

Simultaneously, every codex daemon instance accrues **idle-lifetime telemetry**
— how long since the last client disconnected (`last_client_disconnect_age_ms`),
total `uptime_ms`, and **RSS footprint** — and `happy codex doctor` renders an
**orphan-age distribution** across live + post-mortem instances. After a few
weeks of normal single-device + long-ralph-job use, the operator can read that
distribution and decide, **from data**, whether orphaned app-servers actually
cost meaningful RSS/ports — and therefore whether the irreversible auto-exit
policy (D-002 server-Rust self-exit / D-003 tunnels heartbeat) is ever worth
building. If orphans turn out to be rare and cheap, the answer may stay "no
timeout" permanently, and the manual `happy codex kill-idle` (if shipped)
covers the occasional cleanup.

The seam + telemetry are a **strict prerequisite** for D-002 and D-003 no matter
which eventually wins, so this slice is never wasted work.

## Scope

### In Scope — happy-cli (TypeScript) ONLY

- **`--idle-timeout` spawn-flag seam.** Thread an opt-in idle-timeout value from
  happy-cli config / CLI flag / env into the `codex app-server` ws spawn argv at
  the existing build site (`codexAppServerClient.ts:1185`, where the ws args list
  is constructed, with the `extraAppServerArgs` passthrough precedent at
  `:1186-1188` and `:1129-1131`). The flag name codex would expose is an
  assumption the plan must call out (e.g. `--idle-timeout <secs>` or
  `--idle-timeout-ms`); the seam must be tolerant of the exact spelling being
  finalized later.
- **Capability probe (fail-closed).** Add an `--idle-timeout` capability probe
  mirroring the **existing** `isWsAuthAvailable()` precedent
  (`codexAppServerClient.ts:148-160`: run `codex app-server --help`, check
  `helpOutput.includes('--ws-auth')`, cached per-`CodexAppServerClient` instance
  via `getWsAuthAvailability()`). When the probe does **not** find the
  idle-timeout flag, the seam emits **nothing** to argv (no-op) and logs a
  single one-time debug/warn — never an error, never a behavior change. The probe
  result is cached for the client instance's lifetime (same caching contract as
  ws-auth: restart happy after upgrading codex to re-detect).
- **Default OFF.** With no operator opt-in, no `--idle-timeout` is ever passed;
  reattach-forever remains the default for the single-device + long-ralph-job
  world the fork actually ships.
- **Idle-lifetime telemetry — RSS sampling.** The sidecar exit event already
  carries `uptime_ms`, `last_client_disconnect_age_ms`, and a **reserved**
  `rss_kb_at_exit` (currently always `null`), and the disconnect event carries
  `last_client_disconnect_age_ms` (`codexDaemonLifecycle.ts:39-54`). Populate RSS
  where platform-feasible: live-instance RSS via the doctor probe
  (`probeCodexDaemon` in `codexDaemonDoctor.ts`) and `rss_kb_at_exit` at
  observable-exit time. The plan must handle the **known platform gap** — the
  current `ps-list` field is `%mem`, not RSS-KB, and is **unsupported on
  Windows** (the fork's primary dev box). Choose a real RSS source (e.g. a
  platform-aware sampler) or explicitly scope RSS to the platforms where it is
  obtainable and keep it `null` elsewhere, **without** misreporting `%mem` as
  RSS-KB. Any new sidecar field must respect the `.strict()` snake_case
  append-only contract (`codexDaemonLifecycle.ts:1-7`).
- **Orphan-age distribution in `happy codex doctor`.** Extend the read-only
  doctor output (`codexDaemonDoctor.ts`) to surface an orphan-age /
  idle-lifetime distribution (e.g. a per-instance "idle age since last
  disconnect" column and/or a summary histogram across live + post-mortem
  instances), derived from the sidecar events already grouped by the
  `(pid, started_at_ms)` instance key. Doctor stays **read-only** — it must not
  rotate, prune, kill, restart, or delete daemons.
- **(Cheap-only) `happy codex kill-idle` (D-004).** IF it is cheap on top of the
  above, add a manual reaper command that terminates orphaned/idle app-servers
  the operator selects, reusing the existing discovery enumeration + the
  established confirm-dead-before-delete termination invariants. If it turns out
  non-trivial (e.g. needs new lock-coordination or cross-cwd termination
  plumbing), the plan defers it to a follow-up rather than bloating this slice.
- **Docs.** Update `packages/happy-cli/docs/codex-daemon-lifecycle.md` (the
  daemon lifecycle contract doc) to describe the new telemetry fields, the
  `--idle-timeout` seam + capability-probe semantics, the doctor orphan-age
  surfacing, and (if shipped) `kill-idle`.
- **Tests.** Unit/integration coverage in the existing mocked harness
  (spy on `./codexDaemonTelemetry`; help-probe via the `execSync` mock pattern
  already used for the ws-auth probe in `codexAppServerClient.test.ts`), plus
  doctor-rendering coverage for the orphan-age surface.

### Out of Scope — explicitly deferred

- **ANY codex Rust edit / ANY change to the `codex/` submodule.** Zero. The seam
  passes a flag codex may or may not honor; it does not implement the flag.
- **D-002 — server-owned (Rust) configurable idle-exit** with generous default +
  busy-exemption. This is genuinely net-new process-level idle-exit in
  upstream-canonical `app-server` (upstream has only a *thread-level* 30-min
  idle-unload, no process-level idle-exit flag), and is the highest
  conflict-surface option. **DEFERRED** until telemetry shows orphans actually
  cost RSS/ports **and** a real multi-device handoff exists to protect.
- **D-003 — heartbeat / liveness-driven exit tied to the tunnels directory
  entry.** Depends on the **not-yet-shipped** tunnels directory/TTL system and on
  relaxing the `happySessionId` mismatch guard (which today KILLS cross-session
  reattaches, so "multiple clients share one server" is not even a real feature
  yet). **DEFERRED.**
- **Building a TS-side idle timer of any kind** — rejected outright (the
  detach-and-exit trap). The plan ships a flag *seam*, not a timer.
- **Choosing/enabling a default idle-timeout value.** The value is chosen later,
  from the measured orphan-age + handoff-window data this slice produces.
- **`app-server-daemon` crate / remote-control** — Unix-only and wired to the
  force-disabled remote-control layer; not a viable codexu path.

## Criteria

- **AC-1 (seam passes flag only when supported):** When an operator opts in to an
  idle timeout AND the `codex app-server --help` probe reports the idle-timeout
  flag, the spawned ws app-server argv contains the idle-timeout flag with the
  configured value (verifiable by asserting on the captured spawn argv in the
  mocked client harness).
- **AC-2 (fail-closed no-op):** When the help probe does NOT report the
  idle-timeout flag, the spawn argv contains **no** idle-timeout flag, the client
  still connects normally (reattach-forever behavior unchanged), and at most one
  non-error log line is emitted. Verifiable via the `execSync` help-output mock
  returning help text without the flag.
- **AC-3 (default OFF):** With no operator opt-in configured, no idle-timeout flag
  is ever added to argv regardless of probe result, and there is zero behavior
  change vs today (assert spawn argv unchanged).
- **AC-4 (probe cached per instance):** The `codex app-server --help` idle-timeout
  probe runs at most once per `CodexAppServerClient` instance (assert the mocked
  `execSync` help call count == 1 across multiple connect attempts), matching the
  ws-auth probe's caching contract.
- **AC-5 (RSS telemetry populated where feasible):** On a platform where RSS is
  obtainable, `rss_kb_at_exit` is a non-null KB value on observable exit and the
  doctor live-row RSS is populated; on unsupported platforms (e.g. Windows) the
  value stays `null` and **never** reports `%mem` as RSS-KB. Verifiable through
  the telemetry-module tests and a doctor-render test.
- **AC-6 (orphan-age surfaced in doctor):** `happy codex doctor` renders an
  idle-age / orphan-age figure per instance (and/or a distribution summary)
  derived from `last_client_disconnect_age_ms` + `uptime_ms`, across both live
  and post-mortem instances, with doctor remaining strictly read-only (exit-code
  matrix and read-only invariants preserved).
- **AC-7 (kill-idle, only if shipped):** IF `happy codex kill-idle` is included,
  it terminates only the operator-selected idle/orphan instance(s), honors the
  confirm-dead-before-delete + per-cwd-lock invariants, and is a no-op with a
  clear message when there is nothing idle to reap. (If deferred, the plan states
  so explicitly with rationale, and this AC is dropped.)
- **AC-8 (zero codex/Rust footprint):** The implementation diff touches only
  `packages/happy-cli/**` (and its docs/tests). No file under `codex/` is
  modified; no submodule pointer changes. Verifiable by inspecting the final diff
  path list.
- **AC-9 (docs updated):** `packages/happy-cli/docs/codex-daemon-lifecycle.md`
  documents the new telemetry fields, the `--idle-timeout` seam + fail-closed
  capability-probe semantics, the doctor orphan-age surface, and (if shipped)
  `kill-idle`.
- **AC-10 (typecheck + tests green):** Cross-package typecheck passes and the
  happy-cli vitest suite (including the new seam/telemetry/doctor tests) is green.

## Context

Source brainstorm: `.ralph/brainstorms/codex-app-server-idle-timeout/`
(`brainstorm.json`, `brainstorm-synthesis.md`). The recommendation was D-001 and
the operator selected D-001 (this file records that gated decision; the brainstorm
had been left on HOLD pending operator review).

Verified ground truth (do not re-litigate during planning):

- **Detached spawn = orphan by default.** `codexAppServerClient.ts:857-863`
  (`detached: true`, stdio ignored, `unref()`-ed). Bare `disconnect()` preserves
  the app-server; only `disconnect({ terminateAppServer: true })`, force-restart,
  version-mismatch, session-mismatch, or spawn-cleanup kill it. **Today is
  effectively brainstorm option (a): no idle timeout.**
- **Reattach already solved.** Per-cwd discovery file
  `~/.happy/codex-active-<cwdHash>.json` under a per-cwd lock enforces
  one-server-per-realpath(cwd); happy-cli already lazy-starts (spawn-on-connect)
  and auto-reattaches/respawns. Only the idle-*exit* half is missing.
- **`happySessionId` mismatch guard kills cross-session reattaches**
  (`terminationReason = 'session_mismatch'`), so "multiple clients share one
  app-server" is **not a real feature yet** — effectively one-client-per-session.
  "Last client disconnects" today simply means "the single client
  disconnected." (This is exactly why D-003 is premature.)
- **Capability-probe precedent exists.** `isWsAuthAvailable()`
  (`codexAppServerClient.ts:148-160`) runs `codex app-server --help` and checks
  `helpOutput.includes('--ws-auth')`; the result is cached per client instance
  (`getWsAuthAvailability()`) and drives a fail-closed downgrade (explicit ws
  errors, implicit ws falls back to stdio). The idle-timeout seam mirrors this
  precedent exactly.
- **Spawn-arg passthrough precedent exists.** `extraAppServerArgs`
  (`--codex-arg`) is already appended to the ws args list
  (`codexAppServerClient.ts:1129-1131`, `:1186-1188`).
- **Sidecar already ~80 % there.** `codexDaemonLifecycle.ts:39-54`: the exit
  event already has `uptime_ms`, `rss_kb_at_exit` (reserved, always `null`
  today), and `last_client_disconnect_age_ms`; the disconnect event has
  `last_client_disconnect_age_ms`. Schema is `.strict()` snake_case append-only —
  fields must not be renamed and additions must extend the discriminated union.
- **RSS is the real telemetry gap.** Live rows + exit events render RSS as
  blank/null today because the available `ps-list` field is `%mem`, not RSS-KB,
  and is unsupported on Windows; there is no background RSS timer
  (`codex-daemon-lifecycle.md`, "RSS sampling is reserved for future
  platform-aware implementation").
- **Doctor is read-only.** `happy codex doctor` / `status` are first-token
  diagnostics routed before auth/flag-parsing/daemon-startup; they enumerate
  discovery ∪ sidecar instances and must not rotate/prune/kill/restart/delete.
- **Upstream has no process-level idle-exit flag.** Upstream `app-server` only
  has thread-level 30-min idle-unload (emits `thread/closed`), no process-level
  idle-exit and no `--idle-timeout`. So D-002 is genuinely net-new Rust, which is
  why the flag the seam targets does not exist in codex yet — and why the seam
  must fail closed.
- **Project tenet:** minimize upstream-canonical conflict surface; prefer overlay
  crates over editing `external/repos/codex-patched/`. This pushes hard against
  doing D-002/D-003 now and is the structural reason D-001 wins.

### Open questions for the planner

1. **Idle-timeout flag spelling + unit.** codex does not expose the flag today.
   What spelling/unit should the seam target (`--idle-timeout <secs>` vs
   `--idle-timeout-ms`, integer seconds vs ms), and how does the probe stay
   robust to the final spelling? Recommend a single canonical assumption and make
   the seam's detection string a single source of truth.
2. **Operator opt-in surface.** Where does the opt-in live — a `happy` CLI flag,
   an env var (e.g. `HAPPY_CODEX_IDLE_TIMEOUT`), happy config, or `--codex-arg`
   passthrough only? Recommend the least-surprising, most-testable surface, and
   note whether it should ever apply in stdio mode (likely ws-detached only).
3. **RSS source on Windows.** Is there a real RSS-KB source obtainable on the
   Windows dev box (e.g. a `tasklist`/WMI/`Get-Process` path, or a cross-platform
   library that reports true RSS), or does RSS stay `null` on Windows and only
   populate on macOS/Linux? Pick one and scope AC-5 accordingly.
4. **Doctor orphan-age shape.** Per-instance column, a summary histogram, or
   both? What buckets make the "is there a real orphan problem" decision legible
   after a few weeks (e.g. <1h / 1-24h / >24h)?
5. **`kill-idle` cheap-or-defer.** Can `happy codex kill-idle` reuse the existing
   `enumerateDiscoveryRecords()` + `terminateAttachedAppServer`/`closeWsChild`
   confirm-dead invariants with only a thin selection/CLI layer (cheap → include),
   or does cross-cwd reaping need new lock-coordination (non-trivial → defer)?
6. **Telemetry sufficiency for a later default.** Are `last_client_disconnect_age_ms`
   + `uptime_ms` + RSS enough to choose a sane default later, or does the plan
   also need to capture the device-handoff window (which can't be measured until
   multi-device ships)? State clearly what this slice can and cannot answer.
