Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (all three lenses produced usable output)

# Brainstorm synthesis — codex-app-server-idle-timeout

**Question:** When the last happy-cli client disconnects from a running `codex app-server`, how long before the process exits? Pick a default and scope the multi-device + tunnels interactions.

## Verified current behavior (the constraint everything else hangs on)

- happy-cli spawns `codex app-server` as a **detached** child (`detached: true`, stdio ignored, `unref()`ed) over a loopback WebSocket. A bare `disconnect()` **preserves** the app-server; it outlives the foreground happy-cli process as an orphan. Only `disconnect({ terminateAppServer: true })`, force-restart, version-mismatch, session-mismatch, or spawn-cleanup kill it. **So TODAY is effectively option (a): no idle timeout — the app-server runs until the OS or operator kills it.** (`packages/happy-cli/src/codex/codexAppServerClient.ts`)
- Reattach is already solved: a per-cwd discovery file `~/.happy/codex-active-<cwdHash>.json` (pid/port/token/startedAt) under a per-cwd lock enforces one-server-per-realpath(cwd). happy-cli **already lazy-starts** (spawn-on-connect) **and already auto-reattaches/respawns** — i.e. the lazy-start + auto-restart half of option (e) exists; only the idle-exit half would be new.
- The **`happySessionId` mismatch guard** KILLS any daemon reattached by a different session id (`terminationReason = 'session_mismatch'`). So "multiple clients sharing one app-server" is **not a real feature yet** — it's effectively one-client-per-session. "Last client disconnects" today simply means "the single client disconnected."
- **The detach-and-exit trap (central finding, all three lenses):** a happy-cli/TS-side idle timer dies exactly when happy-cli exits — which is the very moment the orphan is created and would need reaping. A TS timer therefore cannot reap the orphan it's meant to reap. The only places a reliable timer can live are (i) inside the detached app-server itself (Rust = conflict surface) or (ii) a new long-lived external supervisor (the "new supervision" the sibling `codex-app-server-daemon-codexu-integration` brainstorm explicitly rejected).

## Feasibility grounding (codex submodule, read-only)

- happy-cli spawns the plain **`app-server`** crate, NOT the **`app-server-daemon`** crate. The latter is **Unix-only** (`codex-uds` + `libc`) and is wired to **remote_control** — which this fork **force-disables at three layers**. It is not a viable path for codexu.
- Upstream app-server has a **thread-level** idle-unload (a loaded thread unloads after 30 min with no subscribers and no activity, emitting `thread/closed`) but **no process-level idle-exit** and no `--idle-timeout` flag. So D-002 (server self-exit on zero clients) is genuinely net-new Rust, not a flag flip. The codex lens's disconfirming hope ("maybe upstream already ships `--idle-timeout`") was checked and is **false** at the process level.
- Project tenet (load-bearing): minimize upstream-canonical conflict surface — prefer overlay crates over editing `external/repos/codex-patched/`. This pushes hard against D-002/D-003 landing now.

## Candidate directions

### D-001: Defer-and-instrument — ship the seam + idle telemetry, timeout DEFAULT-OFF, zero codex edits  **(RECOMMENDED)**
- Contributing lenses: [codex, copilot, devils-advocate] — the only 3-lens direction.
- Why this might work: It is the honest resolution of the detach-and-exit trap. Instead of building a fragile TS timer or a premature Rust timer, ship the cheap reversible scaffolding now — a happy-cli `--idle-timeout` spawn-flag seam (gated behind a `codex app-server --help` capability probe, so it fails closed when codex can't honor it) plus idle-lifetime telemetry that the sidecar already 80% supports (`last_client_disconnect_age_ms`, `uptime_ms`, optional RSS). Today's reattach-forever default is the *correct* behavior for the single-device + long-ralph-job world we actually ship. The "sane default" the seed predicted gets chosen later, from data, and lands as D-002 (once measured) or D-003 (once tunnels ship). Honors the minimize-conflict tenet (zero Rust) and the sibling brainstorm's "harden happy-cli lifecycle, NO new supervision."
- Risks / friction: Could be seen as "doing nothing." Mitigation: it is not nothing — it ships the negotiation seam + the measurement that every other direction depends on, and it's the prerequisite work for D-002/D-003 regardless of which wins. Telemetry-only value is real (feeds `doctor`).
- Cheapest validation: The sidecar already records `last_client_disconnect_age_ms` + `uptime_ms`; add RSS sampling to `doctor` and read the orphan-age distribution after a few weeks of normal use. If orphans are rare/cheap, the answer may stay "no timeout" permanently.
- Disconfirming observation: If telemetry shows orphaned app-servers genuinely accumulate and cost real RSS/ports on the e-ink tablet, the "defer" framing weakens and D-002 should be pulled forward.

### D-002: Server-owned (Rust) configurable idle-exit with generous default + busy-exemption
- Contributing lenses: [codex, copilot].
- Why this might work: It puts the timer where it can actually fire — inside the detached app-server, surviving happy-cli's exit. Configurable, with a **generous** default (~10-30 min, sized to bridge the multi-device handoff, explicitly NOT 30-60s) and a **hard busy-exemption** so a session mid-turn or an active ralph job is never reaped. This is the robust end-state answer to "where does the timer live."
- Risks / friction: Highest codex-Rust conflict surface — net-new process-level idle-exit in upstream-canonical `app-server` (upstream only has thread-level unload). Choosing the default value before the handoff window is measured risks silently breaking "seamless." Busy-detection must be reliable or it kills long jobs.
- Cheapest validation: Prototype behind an overlay seam with the timeout default-OFF (i.e. D-001's seam), measure the handoff p90 and cold-restart cost first, then enable a measured default.
- Disconfirming observation: If a cold app-server restart turns out to be cheap and lossless (fast reattach, no in-flight-turn loss), an aggressive idle-exit is harmless and the elaborate generous-default + busy-exemption machinery is over-engineering.

### D-003: Heartbeat/liveness-driven exit tied to the tunnels directory entry (option d)
- Contributing lenses: [codex, copilot].
- Why this might work: Models exit on **directory-entry heartbeat-with-grace** rather than raw connection count. Any device refreshes the per-machine app-server liveness entry; the server exits only when no device has asserted liveness for the whole grace window — exactly the "truly abandoned" signal. Tolerates e-ink tablet sleep/flap and the handoff gap in one mechanism and unifies with the tunnels registry lifecycle.
- Risks / friction: Highest coupling. Depends on the **not-yet-shipped** tunnels directory/TTL system AND on relaxing the `happySessionId` mismatch guard (shared-client semantics don't exist yet). Premature to design in detail now.
- Cheapest validation: Build the heartbeat/liveness entry as **read-only telemetry feeding `doctor`** first (decoupled from any exit decision), so when multi-device ships the data already exists. This is the same seam as D-001 from a different angle.
- Disconfirming observation: If the tunnels plan ends up owning daemon lifecycle itself (the registry TTL reaps the address entry and a supervisor restarts on demand), the app-server may not need to self-exit on heartbeat at all.

### D-004: Observability + manual reaper, no automatic policy (`happy codex kill-idle`)
- Contributing lenses: [devils-advocate].
- Why this might work: Keeps the human in the loop with zero race surface. `doctor` already enumerates live/stale/orphaned daemons read-only; add `happy codex kill-idle` (and/or a doctor hint) so the operator reaps on demand. Avoids every automatic-kill failure mode for an orphan whose cost is largely unverified. Companion reframe: make reattach cheap + cold-start fast so the app-server's lifetime stops mattering at all.
- Risks / friction: Doesn't satisfy a future fully-automated multi-device handoff if one is truly needed; it's a janitorial convenience, not a policy.
- Cheapest validation: Ship the command alongside D-001's telemetry; see whether operators ever feel the need to run it. Usage (or its absence) is itself the measurement of whether automation is warranted.
- Disconfirming observation: If operators never run `kill-idle` because orphans never bother them, that confirms "no timeout" is the right default and closes the whole question.

## Recommendation

**D-001 (Defer-and-instrument).** All three lenses independently converged on "ship the seam + telemetry, keep the timeout default-OFF, defer the irreversible policy until there's data and a real multi-device handoff to protect." It is the only direction that (1) honors the minimize-conflict tenet with zero codex Rust edits, (2) escapes the detach-and-exit trap honestly rather than building a timer that can't fire, (3) preserves today's correct reattach-forever behavior for single-device + long ralph jobs, (4) is a strict prerequisite for D-002 and D-003 regardless of which eventually wins, and (5) is the honest first increment toward the seed's predicted "configurable + sane default" — the configurability seam ships now; the sane default is chosen later from measured orphan-lifetime + handoff-window data. Fold D-004's manual `kill-idle` in as the chosen-after-measurement convenience.

The Devil's Advocate raised a genuine `red_flag: true` (task is blocked on unshipped multi-device + tunnels; no measured problem; every automatic option is fragile or conflict-heavy). D-001 respects that flag without stalling: it ships the cheap, reversible, prerequisite slice and explicitly defers the costly, irreversible policy decision to a data-informed follow-up.

**Status: HOLD for operator review.** No `selected-direction.md` written — direction selection is operator-gated.
