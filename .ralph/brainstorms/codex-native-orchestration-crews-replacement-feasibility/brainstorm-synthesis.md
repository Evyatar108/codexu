Lenses: ran=[codex, devils-advocate]; skipped=[copilot] (CLI snapshot budget exceeded — read-only mode tried to snapshot multi-GB .xwin-cache; partial mode)

# Brainstorm synthesis v4 (D-006): NO-REHOST native-codex inject seam

> **Round 4.** Round 3 (@f4f4a061) verdict: fully-hook-free = GO but CONDITIONAL on rehosting members from native `codex` tabs into happy-cli runCodex, because native tabs lacked a MessageQueue2 inject seam. OPERATOR CHALLENGE: "the codex fork is ours to extend — why rehost? ADD the inject seam to native codex." This round designs + source-verifies the no-rehost path.

## Headline verdict: GO / PARTIAL — the operator is right (no rehost), but the seam is NOT free; it needs ONE new thin loopback-IPC inject endpoint, smaller than Round 3's rehost

Both lenses converge: rehost is unnecessary. The in-process inject primitives exist and are proven happy-server-free — `Session::inject_if_running` + `try_start_turn_if_idle` (`core/src/session/inject.rs:18-150`), idle-wake via `maybe_start_turn_for_pending_work` (`tasks/mod.rs:574-616`), and the mailbox enqueue `enqueue_mailbox_communication(trigger_turn)` (`input_queue.rs:96-117`). They are reached today by an in-process Rust caller holding `Arc<Session>`. So the FORK already has everything to wake/steer a native codex session — what's missing is one EXTERNAL door to those primitives. The cost is a bounded loopback endpoint in the overlay, NOT a rehost of every member into happy-cli runCodex. **Operator challenge validated: native-inject < rehost.**

## The decisive correction (devil's advocate, source-grounded): "seam already exists" is half-true

| Round-4 seed premise | Source-grounded correction |
|---|---|
| codex-happy attach.rs already injects → reuse is free | The inject *primitives* are free + in-process (`ext/goal/src/runtime.rs` drives them with zero happy-server). But the only *inbound driver* that reaches them remotely — `attach.rs::establish` (~463-498) — hard-requires `~/.happy/machine.json` tunnel base_url + a connected Socket.IO `SessionClient`, gated by `Feature::RemoteSession` (default-OFF, `happy_seam_invariants.rs` inv55). A daemon over separate `& codex` tabs has no `Arc<Session>` and no happy-server. So no-rehost-no-happy-server = a NEW local-IPC inject endpoint (named pipe/UDS) → `inject_if_running` + idle-wake. Real patch, just SMALL. |
| daemon stream-parses member stdout for protocol | TUI stdout is ANSI-redraw + title-suppressed + sandbox-exit-prone (bit crews at 0.135 `lib.rs:1167-1176`); no turn boundary. Enforce via the app-server EVENT stream (`mapping.rs` already maps it) + happy_tap (`app.rs:1243`), NOT stdout scraping. |

## Cost: native loopback IPC vs runCodex rehost
Native: own a thin overlay listener (~150-300 LoC, codex-rs-overlay) + 1-3 line `app.rs` seam mirroring the remote_session pattern minus E2EE/tunnel; consume output via the existing AppServerEvent tee. Smaller + leaner than rehosting every member into happy-cli runCodex (D-001 round3, ~750-line attach reuse + glue). Patch-surface upkeep = one overlay crate + one bounded seam (low rebase risk).

## Residuals (unchanged): daemon SPOF (one crash freezes all members' un-injected mail); codex-only mono-engine lock-in (Claude/Copilot members have no inject seam); soft gate only (no hard turn-veto — inject IS the read); Windows lifecycle.

## Directions
### D-001 (RECOMMENDED): native codex loopback-IPC inject endpoint — daemon owns files + injects via new overlay endpoint, output via AppServerEvent stream, ZERO rehost, ZERO crews hooks. Contributing: [codex, devils-advocate]. Smallest patch that zeroes hooks AND keeps members native. Effort L; thin overlay + bounded seam.
### D-002: reuse codex-happy attach over a per-daemon happy-server (Happy session plane). Contributing: [codex]. Most code reuse, but re-introduces per-daemon happy-server dep + remote_session. PARTIAL.
### D-003: bounded file-ownership-only daemon, KEEP hooks, no inject. Contributing: [devils-advocate]. ~80% win (kills locks), zero patch/SPOF/lock-in; fails zero-hook + keeps soft gate via hooks. Cheapest fallback.

## Open questions: (1) external IPC vs in-process embed — patch size? (2) mono-engine acceptable? (3) SPOF recovery vs hooks fail-open? (4) is file-ownership-only (D-003) enough?
