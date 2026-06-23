Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (all three lenses ran; copilot re-run after a first-attempt read-only snapshot-budget abort on the `.xwin-cache` build dir)

# Brainstorm synthesis — codex-autoconnect-self-contained-zero-friction

## Verified problem framing (Part 1, source-cited — treated as ground truth by all lenses)

The codex `remote_session` autoconnect **already targets the per-machine LOCAL listener, not a central server** — but every prerequisite for that listener is owned by the happy-cli daemon today:

- `codex-happy/src/attach.rs:343-379` (`establish()`) reads `~/.happy/access.key` + `~/.happy/machine.json`, sets `base_url = machine.tunnel_local_base_url()` = `http://127.0.0.1:<tunnelPort>` (`auth.rs:84-86`), and `POST /v1/sessions` to that loopback listener (`api.rs:1-7,178-187`) with **no auth header**. The `auth.rs` module doc (7-13) is explicit: the embedded happy-server binds two loopback listeners; the tunnel listener is the entry point, and "cross-machine reach is the happy daemon's Dev-Tunnels hop, not codex's." **CONFIRMED: per-daemon embedded happy-server, NOT central.**
- The four fresh-machine prerequisites — onboarding creds, `machine.json` (tunnelPort), the embedded happy-server bound to `127.0.0.1:tunnelPort` (`dualListenerBinding.ts:36-69` → happy-server `createApp`), and the Dev Tunnel exposing it — are **all produced by the happy-cli daemon** (a Node/TS process; `daemon/AGENTS.md §5`, `tunnelManager.ts`). With no daemon, `establish()` returns `None` → **silent fallback to vanilla codex**. So "install only codex" yields zero remote capability today.
- `onboard.rs` is a **complete but UNWIRED** mechanism: GitHub device flow + `write_credentials`/`profile.json`/`settings.json::machineId` (`complete_onboard_with_token`). Nothing calls it; `/remote on` (US-009, `slash_dispatch.rs`) only checks `credentials_ready()` and surfaces a hint. Even wired, it mints **creds only** — its own module doc (14-18) scopes out `machine.json`, the server, the tunnel, and mobile pairing.
- The M1 perms gap is real: `onboard.rs::write_credentials` → `write_json_atomically` does **no chmod**, so `~/.happy/access.key` (the private key) lands at default umask perms. Fix = `0o600` on Unix.

**Honored constraint (906ed67b, unanimous):** the embedded per-daemon happy-server is **load-bearing** (the pair/push/sessions/v3/Socket.IO plane the Happy app syncs against) and cannot be rebuilt away. The daemon stays; only the central server is dropped.

## Lens consensus

All three lenses independently produced the **same daemon-ownership trichotomy** and converged on the same ranking:

1. **Bundled sidecar (codex-owned lifecycle)** — best matches "install only codex"; honors 906ed67b (reuse, no rebuild). Risk: Node-runtime distribution weight, signing/AV, release coupling/update cadence. (codex rated effort **L**; copilot + DA flagged it as the safer UX but a real product/distribution decision.)
2. **Auto-install happy-cli daemon** — lowest engineering divergence, **highest runtime friction**: Node prereq, npm global perms, corporate/AV policy, offline, and codex↔happy-cli version skew — and the nastiest failure is the existing **silent** fallback to vanilla codex. (codex effort **M**; DA + copilot say do NOT make it the default without a strict compat contract + non-silent diagnostics.)
3. **Codex-native Rust session-plane rebuild** — cleanest distribution but **fights the 906ed67b verdict** (recreates a subtly-incompatible second Happy server). All three lenses rank it last (codex effort **XL**).

**Devil's-Advocate's load-bearing reframe (4th idea, unique):** *split LOCAL zero-friction from CROSS-MACHINE discovery.* The Happy app is **not** running `devtunnel list` and there is no central registry, so "the app finds this machine's tunnel" is **not solved** by Scope-A's daemon↔daemon discovery. Ship a codex-owned **local** bootstrap first (creds + one embedded server + `machine.json` + localhost/webapp pairing, no tunnel/discovery), then design cross-machine app discovery separately. This is a phasing decision orthogonal to ownership and de-risks the one genuinely-open piece.

**Two cross-cutting must-haves all lenses raised:**
- `/remote on` must surface a **hard setup error**, never silently fall back — today's `establish() → None → vanilla` is a UX trap regardless of ownership choice.
- Someone must **own version/protocol compatibility** across `attach.rs` ↔ `machine.json` schema ↔ embedded happy-server API ↔ Socket.IO/session-plane ↔ app expectations.

## Candidate directions

### D-001: Codex-owned lifecycle with bundled happy-cli/happy-server sidecar (RECOMMENDED ownership)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: literally satisfies "install only codex" (no separate npm step); reuses the load-bearing embedded happy-server (honors 906ed67b); codex owns start/health/restart UX so it never feels like a second onboarding; avoids npm-global-perms / version-skew fragility.
- Risks / friction: ships a Node runtime + happy-server bundle inside a Rust CLI distribution (binary size, Windows signing/AV, codesigning); every happy-server protocol/security update now needs a codex-bundle refresh (release coupling); background-process behavior may surprise Rust-binary users.
- Cheapest validation: a thin spike where `/remote on` launches an existing happy-cli/happy-server sidecar from a codex-managed path, writes `machine.json`, starts the tunnel, and proves one Happy client pairs + streams on a clean machine.
- Disconfirming observation: if bundle size / update cadence / signing / process-supervision are unacceptable, OR Happy-client pairing still needs manual happy-cli steps, this fails the bar.

### D-002: Codex auto-installs + starts the existing happy-cli daemon on /remote on
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: lowest engineering divergence; happy-cli stays the single daemon/protocol owner; codex just orchestrates `npm i -g happy-coder` + `happy daemon start`.
- Risks / friction: assumes Node/npm present + writable global prefix + permissive endpoint protection + network reachability + codex/happy-cli version match; the dominant failure is **silent** (attach.rs → None → vanilla codex, no diagnostic). DA: "starts looking less like zero-friction and more like a second package manager embedded in codex."
- Cheapest validation: on a clean Windows + macOS VM with only codex, run `/remote on`, log every prompt/failure, and measure whether a streamable Happy session is reached with zero manual shell commands.
- Disconfirming observation: if more than a small minority of clean-machine attempts fail (npm/perms/AV/offline), it cannot be called zero-friction.

### D-003: Phased — ship codex-owned LOCAL bootstrap first, defer cross-machine app discovery (phasing overlay)
- Contributing lenses: [devils-advocate]
- Why this might work: delivers honest zero-friction sooner (no tunnel, no registry, no central broker); isolates the one genuinely-unsolved problem (app discovery over Dev Tunnels) into its own effort; composes with EITHER D-001 or D-002 (it is a scope/sequencing choice, not a competing owner).
- Risks / friction: "remote" on day one becomes "local only"; cross-machine mobile use is deferred; needs a localhost/webapp pairing surface.
- Cheapest validation: `/remote on` on a clean codex-only machine → creds + one embedded server + `machine.json` + a localhost webapp that streams the live session, with NO tunnel.
- Disconfirming observation: if the operator requires cross-machine mobile discovery on day one, local-first is "local bootstrap wearing a remote label."

### D-004: Codex-native Rust daemon / single-session session-plane rebuild (REJECTED per 906ed67b)
- Contributing lenses: [codex, copilot]
- Why this might (not) work: zero Node/npm dependency, smallest distribution — but recreates a second Happy server that the app must trust; the minimal route set tends to expand to most of pair/push/sessions/v3/Socket.IO. Documented-rejected by the prior 3-lens verdict; kept here only to record why it is out.
- Cheapest validation (if ever revisited): read-only compat spike of the smallest single-session flow against an unmodified Happy client, listing every unsupported route.
- Disconfirming observation: any app-side special-casing or route-set growth makes maintenance divergence dominate the bundle-weight savings.

## Recommendation

**Daemon-ownership = D-001 (codex-owned lifecycle, bundled happy-cli/happy-server sidecar)**, shipped **phased per D-003**:

- **Phase 1 (codex overlay, local-first, low conflict):** wire `onboard.rs` into `/remote on` when creds absent (surface device code + browser open); add the **M1 `access.key` 0o600** chmod; make `establish()` failure a **hard, diagnosed** `/remote` error instead of a silent vanilla fallback. Absorbs `codex-autoconnect-interactive-self-onboard-remote-on`.
- **Phase 2 (daemon ownership):** add a codex-managed "headless single-tenant" start path so the embedded happy-server + `machine.json` + Dev Tunnel come up without the user touching happy-cli — bundled-sidecar flavor preferred (D-001); auto-install (D-002) is the fallback if bundling is rejected.
- **Phase 3 (discoverability — likely its own brainstorm):** how a Happy app/webapp discovers + pairs with a codex-hosted machine over its Dev Tunnel (no central registry). Leading candidate: a pairing step that records the machine's public tunnel URL (reuse `POST /pair/complete` + QR/deep-link).

D-001 is the **truest to the literal "install ONLY codex" bar**, sidesteps the npm-install fragility/silent-fallback the DA and copilot lenses warn against, and honors the 906ed67b "don't rebuild the session plane" verdict. D-004 is rejected. D-002 remains a viable fallback if the operator deems a Node bundle too heavy.

## Cross-repo surface & sequencing

**codex fork (`codex/codex-rs-overlay/codex-happy/` + launcher):**
- `slash_dispatch.rs` / `event_dispatch.rs` — invoke onboard on `/remote on` when creds absent; non-silent failure UX. (SANDBOX-PATCH seam already exists.)
- `onboard.rs` — wire it; add 0o600 (M1).
- `attach.rs` — distinguish "no daemon/listener" from "no creds" so `/remote` can diagnose.
- NEW codex-happy module — daemon-lifecycle manager (start/health/restart/stop of the codex-owned sidecar).
- launcher (`codex-copilot-launcher`) + `publish-npm.yml` + package scripts — D-001 bundling of the Node sidecar (or D-002 install/start orchestration).

**codexu `packages/`:**
- `happy-cli/src/daemon/` — a headless/codex-managed start path (embedded server + `machine.json` + tunnel) that codex can launch.
- `happy-cli/src/tunnel/tunnelManager.ts` — Dev Tunnel exposure (exists).
- `happy-server/` — the embedded server, **reused as-is** (load-bearing).
- `happy-wire/` — `machine.json`/session-metadata schema alignment.
- `happy-app/` — Phase-3 discoverability/pairing over Dev Tunnels (the open piece).

**Conflict/effort:** codex overlay edits are overlay-first (low upstream conflict; markers already present). The happy-cli headless-start path ≈ M. D-001 bundling adds release-engineering to the codex publish flow ≈ M-L. Phase-3 discoverability is the biggest unknown (potentially XL; own brainstorm). Codex submodule edits require the two-commit + submodule-pointer-bump discipline.

## Genuine OPERATOR decisions to surface

1. **Daemon ownership: bundled sidecar (D-001, recommended) vs auto-install happy-cli (D-002)?** Hinges on whether "install ONLY codex" means *shipped artifacts* (→ bundle) or *user-visible steps* (→ auto-install acceptable). Trade: Node bundle weight + release coupling vs npm-install fragility + silent-fallback risk.
2. **Discoverability mechanism for the Happy app over Dev Tunnels** (no central registry; app isn't running `devtunnel list`): pairing-records-tunnel-URL (+QR/deep-link) vs local-first-only vs something else. Genuinely unsolved — likely its own brainstorm/spike.
3. **Phasing (D-003): local-first then defer cross-machine discovery, or attempt full cross-machine on day one?**
