---
overviewTaskId: codex-autoconnect-self-contained-zero-friction
---

## Direction
D-001 — Codex-owned lifecycle with bundled happy-cli/happy-server sidecar, shipped PHASED per D-003. Codex owns the per-machine daemon lifecycle and ships/manages the load-bearing Node embedded happy-server as a codex-owned sidecar (reuse, not rebuild), so a codex-first user installs only codex; cross-machine app discovery is sequenced as a later phase.

## Goal
A brand-new user installs ONLY the codex fork, runs `/remote on`, and codex self-onboards (mints `~/.happy` creds via the device flow) AND brings up the per-machine session plane (the load-bearing embedded happy-server + `machine.json` + Dev Tunnel) WITHOUT the user ever touching happy-cli, Node, npm, or manual Happy onboarding — riding the agent-comms Scope-A per-machine-daemon + Microsoft Dev Tunnels architecture (NO central/external happy-server). The codex session then becomes discoverable + streamable E2EE by a Happy client.

## Scope

### In Scope
- **Phase 1 — codex-side local bootstrap (overlay-first, low conflict):**
  - Wire `onboard.rs` into `/remote on` when `credentials_ready()` is false: run the GitHub device flow, surface the user code + open the browser, then `complete_onboard_with_token`. (Absorbs `codex-autoconnect-interactive-self-onboard-remote-on`.)
  - **M1 fix:** chmod `~/.happy/access.key` to `0o600` on Unix in `onboard.rs::write_credentials`.
  - Make `establish()` failure a **hard, diagnosed `/remote` error** (distinguishing "no daemon/listener" from "no creds"), NOT today's silent fallback to vanilla codex.
- **Phase 2 — daemon ownership (the recommendation):**
  - A codex-managed "headless single-tenant" daemon-start path so the embedded happy-server (`dualListenerBinding` → happy-server `createApp`) + `machine.json` (tunnelPort) + the Dev Tunnel come up without manual happy-cli. **Bundled-sidecar flavor (D-001)** preferred; auto-install (D-002) is the documented fallback if bundling is rejected.
  - A codex-happy daemon-lifecycle module (start/health/restart/stop) + the launcher/`publish-npm.yml`/packaging work to ship + supervise the sidecar.

### Out of Scope (deferred to later phases / separate efforts)
- **Phase 3 — cross-machine Happy-app discoverability over Dev Tunnels** (how the app/webapp, which is NOT running `devtunnel list`, finds + pairs with this machine's tunnel with no central registry). Leading candidate: a pairing step recording the machine's public tunnel URL (reuse `POST /pair/complete` + QR/deep-link). **Likely its own brainstorm.**
- D-004 (Rust session-plane rebuild) — REJECTED per the 906ed67b "do not rebuild the load-bearing embedded happy-server" verdict.
- Any central/external happy-server broker/relay (architecturally rejected by Scope A).

## Criteria
- On a machine with ONLY the codex fork installed (no happy-cli, no `~/.happy`), `/remote on` runs the device flow, writes `~/.happy/access.key` at `0o600`, and reports success — verified by backing up + wiping `~/.happy` to simulate a new user (the task's named validation).
- After `/remote on`, `~/.happy/machine.json` exists with a valid `tunnelPort` and the embedded happy-server answers `POST http://127.0.0.1:<tunnelPort>/v1/sessions` — i.e. `establish()` (attach.rs:343-379) succeeds and the codex session attaches, WITHOUT the user starting happy-cli.
- When daemon bootstrap fails, `/remote on` surfaces a hard, actionable error — codex must NEVER silently fall back to vanilla on a remote-on intent.
- The embedded happy-server is REUSED (no Rust reimplementation of pair/push/sessions/v3/Socket.IO); 906ed67b verdict preserved.
- Phase 2 verified by a clean-machine spike: `/remote on` → embedded server + machine.json + tunnel up → one Happy client pairs + streams a session.

## Context
- **Source-verified (Part 1):** autoconnect already hits the per-machine LOCAL listener (`127.0.0.1:<tunnelPort>` from `machine.json`), NOT a central server (attach.rs:343-379, auth.rs:84-86, api.rs:178-187). The four fresh-machine prerequisites (creds, machine.json, embedded server, tunnel) are all produced by the happy-cli DAEMON today; no daemon ⇒ silent fallback. `onboard.rs` is built but unwired and mints creds only.
- **Lens consensus (codex + copilot + devils-advocate):** all three independently ranked bundled-sidecar > auto-install > Rust-rebuild. Auto-install's dominant failure is the silent vanilla fallback; Rust-rebuild fights 906ed67b.
- **Devil's-Advocate reframe (carried forward):** split LOCAL zero-friction from CROSS-MACHINE discovery — the app-discovery half is genuinely unsolved (no central registry; app isn't running devtunnel list) and should not gate Phase-1 success.
- **Open operator decisions (must resolve before/inside planning):**
  1. Bundled sidecar (D-001, recommended) vs auto-install happy-cli (D-002) — does "install ONLY codex" mean shipped-artifacts (→ bundle) or user-visible-steps (→ auto-install ok)?
  2. The Phase-3 discoverability mechanism (pairing-records-tunnel-URL vs QR/deep-link vs local-first-only).
  3. Phasing: local-first then defer cross-machine discovery, or full cross-machine on day one?
- **Cross-repo:** codex fork (codex-happy overlay + launcher/publish flow) + codexu `packages/` (happy-cli daemon headless-start, happy-server reused, happy-wire schema, happy-app for Phase 3). Codex submodule edits use the two-commit + pointer-bump discipline.
