---
overviewTaskId: codex-app-server-daemon-codexu-integration
---

## Direction
D-001 — Harden happy-cli-owned discovery, lifecycle, and observability. Build on the existing `packages/happy-cli/src/codex/` discovery + lock + detachment infrastructure (which the operator's framing underestimated) by shipping operator-visible observability first, before any new supervision or multi-client multiplexing.

## Goal

The codex app-server integration has a documented, observable contract that operators can debug without process-walking. Concretely, after this work ships:

- `happy codex doctor` (or equivalent) reports, for the local machine: every known codex app-server process (pid, endpoint, cwd-keyed discovery record, age, RSS), the last-known client, the last health check, the recorded exit reason (if exited), and whether the discovery record is stale relative to the actual process.
- A sidecar metadata file under `HAPPY_HOME` (next to the existing discovery record) carries structured spawn/disconnect/exit/cold-start/RSS data per daemon instance, append-only.
- happy-cli's spawn path emits structured telemetry events (one per spawn, one per disconnect, one per exit with exit reason + exit code + uptime + RSS-at-exit + last-client-disconnect-age) so happy-server's existing log pipeline can aggregate them without code changes on the server side.
- The team has 1-2 weeks of real-operator-usage telemetry that can answer "is supervision YAGNI or load-bearing?" and "is multi-client RSS savings material?" without speculation.

Explicitly NOT in this work: no proactive supervisor, no auto-restart, no multiplexing, no relaxation of the `happySessionId` mismatch guard, no codex Rust submodule changes.

## Scope

### In Scope

- New `happy codex doctor` / `happy codex status` CLI command in `packages/happy-cli/` that reads existing discovery records under `HAPPY_HOME`, probes each daemon (loopback WebSocket health ping or equivalent), and reports a human-readable table.
- New sidecar metadata file format (e.g., `HAPPY_HOME/codex-daemons/<pid>.json` or extended discovery record fields) carrying: pid, endpoint, cwd, started-at, last-health-check, last-client-disconnect-at, cold-start-ms, current-RSS, exit-reason (when exited), exit-code, exit-at.
- Structured telemetry emission in `codexAppServerDiscovery.ts` / `codexAppServerClient.ts` / `runCodex.ts` for spawn, reattach, disconnect, and exit events. Events flow through the existing happy-cli logging surface so happy-server's pipeline picks them up.
- Documentation: a `packages/happy-cli/docs/codex-daemon-lifecycle.md` (or AGENTS.md addition) that finally writes down the current discovery + lock + detachment semantics, so operators have a reference for what "expected" behavior is.
- A clean closure of the pre-existing brainstorm-only task `codex-app-server-idle-timeout`: it is explicitly absorbed by D-001's telemetry, OR it gets promoted to plan once D-001 has shipped and the data is in.

### Out of Scope

- Proactive supervision / auto-restart on crash (defer until D-001 telemetry proves a recurring user-visible failure that observability alone cannot fix).
- Multi-client multiplexing of any kind, including same-identity reattach (gated on D-002's smoke test; see follow-up task list).
- Cross-machine discovery (happy-server remote → local codex daemon over tunnel).
- Daemon-side context sharing or conversation reuse across happy-cli sessions.
- Adopting the upstream Rust `app-server-daemon` crate (Unix-only today; see D-003).
- Changing the `happySessionId` mismatch guard semantics.
- Any change inside the codex/ submodule (overlay crate, sandbox-patch, or codex-rs/ edit). All work stays in `packages/happy-cli/` and (where strictly necessary) `packages/happy-server/` log aggregation glue.
- Auth / identity unification across happy-server-spawned vs. happy-cli-spawned daemons.

## Criteria

Acceptance criteria for the downstream plan to consume:

1. Running `happy codex doctor` on a dev box with at least one active codex app-server prints a table containing pid, endpoint, cwd, age, RSS, last health check timestamp, last client disconnect timestamp, and exit reason (the last is blank for live daemons). The command exits 0 when at least one daemon is reachable.
2. Spawning a codex app-server via `happy <command-that-needs-codex>` produces a structured spawn event in happy-cli logs containing at minimum `event: codex.daemon.spawn`, `pid`, `endpoint`, `cwd`, `cold_start_ms`, `happy_session_id`.
3. A codex app-server exit (crash, kill, idle exit, or `happySessionId` mismatch termination) produces a structured exit event containing at minimum `event: codex.daemon.exit`, `pid`, `exit_code`, `exit_reason` (enum: `crashed`, `killed`, `idle`, `session_mismatch`, `unknown`), `uptime_ms`, `rss_kb_at_exit`, `last_client_disconnect_age_ms`.
4. A sidecar metadata file (location chosen by the plan) persists the structured lifecycle record so `happy codex doctor` can report on a daemon that exited 5 minutes ago (post-mortem visibility), not only on live ones.
5. The pre-existing discovery contract (cwd-keyed via `realpath`, single-flight spawn lock, detached child surviving foreground CLI exit, `happySessionId` mismatch guard) is documented in a markdown file under `packages/happy-cli/` so reviewers can reference it without reverse-engineering the code.
6. No changes to the codex/ submodule; no new sandbox-patches; no overlay crate additions. The diff is contained in `packages/happy-cli/` (with possible minor additions to `packages/happy-server/` log handling glue, only if necessary for telemetry aggregation).
7. After 1-2 weeks of operator use, the telemetry data can answer (yes/no, with evidence): "Did any codex app-server exit unexpectedly (exit reason `crashed` or `unknown`)? With what frequency?" — this output gates whether D-002 multiplexing and the supervision sub-feature get filed as follow-up tasks.

## Context

### Multi-lens synthesis highlights

- **Codex (feasibility)** probed the repo and found `packages/happy-cli/src/codex/codexAppServerDiscovery.ts` already implements loopback-WebSocket discovery keyed by `realpath(cwd)` under `HAPPY_HOME`, a spawn/reattach lock, detached child processes that survive foreground CLI exit, and a `happySessionId` mismatch guard. The fuzzy idea's framing ("integration is minimal and reactive ... lifecycle undefined") was partially stale — most of the discovery + lock + detachment story already exists. Codex also discovered the upstream Rust `app-server-daemon` crate is Unix-only, which is a hard blocker for the Windows-first dev box and the reason D-003 stays deferred.
- **Copilot (product-reality)** independently converged on "observability + discovery + minimal supervision first." Identified the adoption-friction risk that observability sidecars often become "another sidecar nobody checks" unless the status command becomes part of operator habit. Flagged the trust-boundary issue for multiplexing (D-002).
- **Devil's Advocate** went furthest with the contrarian "instrument before supervising" framing (originally a separate D-004). Caught two silent failure modes worth carrying into the plan: (1) a supervisor that auto-restarts daemons would silently mask crashes by losing in-memory session state, presenting as "vague missing context or duplicate turns" to mobile users while the team declares reliability improved; (2) multi-client sharing in D-002 may leak cached tool permissions, MCP handles, or OAuth tokens across sessions that the operator's machines accept as convenience until a second identity appears.

### Disconfirming observations to watch during plan + impl

- If happy-cli traces or happy-server logs already show recurring unexplained codex app-server exits or 10-15s cold-start waits on normal reconnects that observability alone cannot resolve, the supervision sub-feature must be pulled into D-001 scope, not deferred.
- If `happy codex doctor` cannot meaningfully distinguish `crashed` vs `stale` vs `wrong-identity` vs `unreachable` daemons during real failures, the metadata schema is wrong and must iterate before the operator can rely on the command. Plan should specify the exit-reason enum precisely.
- If telemetry aggregation requires non-trivial happy-server code changes (e.g., new event types in the encrypted `DaemonState` channel), the plan should split into "happy-cli telemetry only" first and "happy-server aggregation" second.

### Open questions carried forward to plan-phase

1. Should `happy codex doctor` be local-only, or should daemon health also be published through the encrypted `DaemonState` channel so the mobile app can show "codex unreachable" warnings? (Lens disagreement: Codex leans local-only first; Copilot raises mobile/web visibility as a question for synthesis.)
2. Is the current one-server-per-`realpath(cwd)` discovery invariant still correct, or should discovery be keyed by `(cwd, identity)` to prepare the ground for D-002 without changing semantics yet?
3. Is the `codex-app-server-idle-timeout` brainstorm-only task absorbed by D-001's lifecycle telemetry (so it gets closed as duplicate), or does it remain a separate policy question that gets promoted to plan once we have the telemetry data to choose a timeout policy?
4. Sidecar metadata file location and rotation policy: per-pid files? Single append-only JSONL? Keyed by `cwd` or `pid`? How long do exited-daemon records survive before being pruned by `happy codex doctor` or a cleanup pass?

### Follow-up tasks the bookkeeper should file after this brainstorm ships

In priority order:

1. **`codex-daemon-happy-cli-doctor-and-telemetry`** (impl-worthy, P1) — implements D-001 (this direction) and folds in the spirit of D-004 (telemetry-first, no behavior change). Scope: this `selected-direction.md`. Spawn `/plan-with-ralph --from-brainstorm .ralph/brainstorms/codex-app-server-daemon-codexu-integration/`.

2. **`codex-daemon-isolation-smoke-test`** (brainstorm-only or short research task, P2) — implements D-002's cheapest validation. A two-Happy-session smoke test that drives two distinct happy-cli sessions against one app-server with distinct identities, observes whether approval requests, thread subscriptions, or Codex account state leak. Deliverable is a written finding (impl-worthy or impl-deferred), NOT code. Can run in parallel with #1 since it touches no shared code.

3. **`codex-daemon-upstream-windows-watch`** (brainstorm-only, P3) — implements D-003. A perpetually-tracked task that revisits upstream codex's Windows-support roadmap for the Rust `app-server-daemon` crate every 2 sync cycles. No impl in codexu/codex submodules until either (a) upstream ships Windows lifecycle, or (b) #1 telemetry shows happy-cli-layer fixes are inadequate.

4. **`codex-daemon-same-identity-reattach`** (impl-worthy, **conditional on #2 finding "isolation is safe"**, P4) — narrow scope: relax `happySessionId` mismatch ONLY for same-identity reattach. Do NOT file this task until #2's finding is in.

5. **Close-or-absorb decision for the existing `codex-app-server-idle-timeout` brainstorm-only task** — once #1 ships and telemetry is in, the bookkeeper makes a call: either close as duplicate (D-001's lifecycle telemetry naturally answers the timeout question), or promote to `/plan-with-ralph` for a concrete idle-exit policy. This is a bookkeeper-side data.json edit, not a separately-spawned member.

### Explicit "do not file" list (out of scope for this brainstorm, will not become follow-up tasks)

- Proactive daemon supervision (auto-restart, crash-loop limiter, health-check-driven restart) — re-evaluate only if #1 telemetry shows recurring unexplained exits.
- Cross-machine codex daemon discovery (happy-server tunnel → remote local daemon).
- Daemon-side context / conversation sharing across happy-cli sessions.
- Codex Rust `app-server-daemon` adoption in codex/ submodule (deferred per D-003).
- Unifying auth across happy-server-spawned vs. happy-cli-spawned daemons (waits on #2 finding).
- A Windows-services-style supervisor for codex daemons (analog to systemd/launchd) — explicit YAGNI per Devil's Advocate, may revisit only on #1 telemetry evidence.
