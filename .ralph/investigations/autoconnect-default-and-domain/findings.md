# Investigation: autoconnect default + domain hardcoding

Scope: READ-ONLY source investigation in the codexu monorepo. Every claim cites `file:line`.

## DIRECT ANSWERS

**(A) Is codex/happy autoconnect ENABLED BY DEFAULT?  -> NO. It is DEFAULT-OFF (opt-in) everywhere.**
The gate is the codex EXPERIMENTAL-FEATURES registry. Every remote/autoconnect feature is
`Stage::Experimental { .. }` + `default_enabled: false`.

**(B) Is the operator's domain hardcoded?  -> The literal `https://happy.evyatar.dev` DOES appear,
but NOT as a functional runtime default in app code.** The runtime public-server URL is fully
config/env-driven. The only non-test source literal is a deterministic TEST-VECTOR constant.
The codex side is contractually forbidden from containing the domain.

---

## 1. AUTOCONNECT DEFAULT STATE (mechanism = codex Experimental Features)

Registry: `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs`
Every remote feature = `Stage::Experimental { .. }`, `default_enabled: false`:

- `remote_session`        (Feature::RemoteSession)        -> lib.rs:1107-1114  (default_enabled: false)  enum: lib.rs:176-177
- `loopback_inject`       (Feature::LoopbackInject)       -> lib.rs:1120-1127  (default_enabled: false)  enum: lib.rs:182
- `remote_auto_attach`    (Feature::RemoteAutoAttach)     -> lib.rs:1135-1142  (default_enabled: false)  enum: lib.rs:189
- `remote_subagent_sessions` (Feature::RemoteSubagentSessions) -> lib.rs:1149-1156 (default_enabled: false) enum: lib.rs:196
- `remote_public_server`  (Feature::RemotePublicServer)   -> lib.rs:1166-1173  (default_enabled: false)  enum: lib.rs:210
- `default_enabled()` accessor: lib.rs:359-360 ; `stage()`: lib.rs:355 ; FeatureSpec.default_enabled field: lib.rs:815

Enforced by invariant tests (fail loudly if flipped):
`codex/codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs`
- remote_session default-off + Experimental: haps... :176-193 (invariant_55)
- remote_auto_attach default-off + Experimental: :430-450 (invariant_71)
- remote_public_server default-off + Experimental: :584-605 (invariant_75)

Toggle paths (all opt-in): `-c features.remote_session=true`, `--enable remote_session`,
`/experimental`, and the per-session `/remote on` self-onboard (device flow, no happy-cli at runtime):
- `/remote on` self-onboard driver: `codex/codex-rs-overlay/codex-happy/src/remote_on.rs` (whole file; `run_self_onboard`)
- onboard device flow: `codex/codex-rs-overlay/codex-happy/src/onboard.rs`

Launcher-level opt-in (also default-OFF, emits the feature flag only when the user opts in):
`codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs`
- fields `enable_remote_session` / `enable_remote_auto_attach`: config.rs:8-9 (docs: config.rs:30-44)
- emit `features.remote_session=true` ONLY when opted in: config.rs:131-141
- emit `features.remote_auto_attach=true` ONLY when opted in: config.rs:143-151
- read from `~/.codex-copilot/config.toml`: config.rs:91-92

happy-cli side (public autoconnect / tunnel): ALSO opt-in, fail-closed.
`packages/happy-cli/src/tunnel/publicTunnelConfig.ts`
- provider selection switch `isPublicTunnelOptedIn` requires `HAPPY_TUNNEL_PROVIDER=cloudflare`: publicTunnelConfig.ts:66-72
- absent `public-tunnel.json` => refuses to start public (does NOT silently enable): publicTunnelConfig.ts:110-135 (`assertPublicBindReady`)
- default keeps Dev Tunnels path (comment): publicTunnelConfig.ts:18-20, 68-70

CONCLUSION (A): default is OFF at every layer. The memory ("/remote on self-onboard shipped +
remote_public_server gate for single-user public happy-server") is CONFIRMED, and all such gates
default OFF. Nothing to "flip" - it is already default-off.

---

## 2. DOMAIN / URL HARDCODING - full hit list

### Runtime serverUrl is env/config-driven (NOT the domain baked in):
- `packages/happy-cli/src/configuration.ts:37` -> `this.serverUrl = process.env.HAPPY_SERVER_URL || 'http://127.0.0.1:3005'`  (env-driven; default LOOPBACK, not the domain). Comment invariant HC-12: configuration.ts:36. webappUrl env `HAPPY_WEBAPP_URL`: configuration.ts:38.
- `packages/happy-agent/src/config.ts:42` -> `process.env.HAPPY_SERVER_URL ?? 'https://api.cluster-fluster.com'` (env-driven; upstream default). pairing url env `HAPPY_PAIRING_URL`: config.ts:43.
- Public-mode runtime serverUrl is BUILT FROM CONFIG hostname, not hardcoded:
  `packages/happy-cli/src/fork/forkHooks.ts:155` -> `const serverUrl = \`https://${publicTunnelConfig.hostname}\`;`  (hostname read from `public-tunnel.json` via `readPublicTunnelConfig`, schema field `hostname`: publicTunnelConfig.ts:23,79-105).

### The literal `https://happy.evyatar.dev` - EVERY hit:
NON-TEST SOURCE (app code) - exactly ONE, and it is a test-fixture constant:
- `packages/happy-wire/src/publicPairingInvite.ts:161` -> `serverUrl: 'https://happy.evyatar.dev'` inside `PUBLIC_PAIRING_INVITE_TEST_VECTOR` (deterministic round-trip fixture, lines 158-172). Ships in the package but is a test vector, NOT a runtime default.

COMMENTS / EXAMPLES only (no functional effect):
- `packages/happy-cli/src/tunnel/publicTunnelConfig.ts:23` (comment "e.g. happy.evyatar.dev")
- `packages/happy-cli/src/tunnel/cloudflareTunnelDaemonProvider.ts:16` and `:43` (comments/example)
- `packages/happy-app/sources/auth/tokenStorage.ts:22` (comment)
- `packages/happy-app/sources/auth/machineAuth.ts:10` (comment)

DEPLOY / OPS SCRIPT (operator infra, hardcoded hostname):
- `scripts/fork-setup/setup-services.ps1:12` (cloudflared route dns comment), `:98` (nssm HappyServer description), `:116` (nssm cloudflared description), `:137` (`Invoke-WebRequest -Uri "https://happy.evyatar.dev"` health probe)

DOCS (descriptive, not code):
- `docs/fork-notes.md` (16 hits incl. :313,:318,:387-400,:438,:463,:482,:496)
- `docs/security-model.md:7,:51,:53,:70`
- `docs/backend-architecture.md:52,:187` ; `docs/api.md:22` ; `docs/cli-architecture.md:211`
- `packages/happy-server/AGENTS.md:250` ; `packages/happy-app/AGENTS.md:128`

TESTS (fixtures/expectations):
- `packages/happy-wire/src/publicPairingInvite.test.ts:15,29,97`
- `packages/happy-cli/src/tunnel/publicTunnelConfig.test.ts:101,122,131,148,169` (+ hostname `:17`)
- `packages/happy-cli/src/tunnel/cloudflareTunnelDaemonProvider.test.ts` (13 hits: :144,:158,:172,:176,:189,:199,:213,:222,:244,:255,:267,:286,:307)
- `packages/happy-app/sources/auth/tokenStorage.test.ts:250,254`
- `packages/happy-app/sources/auth/publicEnrollment.test.ts:51,68`
- `packages/happy-app/sources/auth/machineAuth.test.ts:38,118`
- `packages/happy-app/sources/sync/socketOptions.test.ts:36`

Other `evyatar` (author name, not domain - ignore): `packages/codexu-plugin/.codex-plugin/plugin.json:12`,
`packages/codexu-options-mode-plugin/.codex-plugin/plugin.json:10` ("Evyatar Mitrani").
Test fixtures using upstream `api.cluster-fluster.com`: `packages/happy-agent/src/credentials.test.ts:12,13,24`,
`config.test.ts:27,28`, README `packages/happy-agent/README.md:191`.

### CODEX side deliberately has NO domain (contractually enforced):
`codex/codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs` invariant_75:
- :634-635 -> `codex-happy auth.rs must NOT reference the public evyatar.dev URL`
- :629-632 -> `codex-happy auth.rs must NOT bake in any external HTTPS host`
codex-happy only uses loopback: `codex/codex-rs-overlay/codex-happy/src/auth.rs:85` (`http://127.0.0.1:{tunnel_port}`), `:92` (`http://127.0.0.1:{loopback_port}`). GitHub URLs (device flow) in onboard.rs:47,49 (`https://github.com`, `https://api.github.com`), overridable via `HAPPY_GITHUB_CLIENT_ID` (onboard.rs:132-134).

### Existing env-var support (ALREADY present):
`HAPPY_SERVER_URL`, `HAPPY_WEBAPP_URL` (configuration.ts:37-38); `HAPPY_SERVER_URL`, `HAPPY_PAIRING_URL` (happy-agent config.ts:40-43); `HAPPY_TUNNEL_PROVIDER` (publicTunnelConfig.ts:66-72); `HAPPY_HOME_DIR` (configuration.ts:45 / auth.rs:24-26); `HAPPY_GITHUB_CLIENT_ID` (onboard.rs:132); `HAPPY_EXPERIMENTAL`, `HAPPY_VARIANT`, `HAPPY_DISABLE_CAFFEINATE` (configuration.ts). Public hostname is config-file-driven via `public-tunnel.json` (publicTunnelConfig.ts:23, forkHooks.ts:155).

---

## 3. SCOPED CHANGE OUTLINE

(a) Autoconnect default-OFF: ALREADY default-off. No change required.
    - The controlling symbols are the FeatureSpec entries in features/src/lib.rs:1107-1173
      (remote_session/remote_auto_attach/remote_public_server/... all `default_enabled: false`).
    - The fork prefers the Experimental-Features mechanism (confirmed) - so if a future edit ever
      set one to true, the minimal fix is to set that spec's `default_enabled: false` again; invariants
      55/71/75 already guard this. Nothing to do today.

(b) Domain-from-env: runtime is ALREADY env/config-driven (no runtime literal to change):
    - General server URL already reads `HAPPY_SERVER_URL` (configuration.ts:37, happy-agent config.ts:42).
    - Public server hostname already read from `public-tunnel.json` -> `https://${hostname}` (forkHooks.ts:155).
    - The ONLY remaining literal `https://happy.evyatar.dev` in non-test source is the deterministic
      test-vector `packages/happy-wire/src/publicPairingInvite.ts:161`. If the goal is "no operator
      domain anywhere in shipped source", replace it with a neutral example (e.g. `https://happy.example.com`)
      and update the matching expectations in publicPairingInvite.test.ts:15,29,97 (this constant is a
      fixture, changing it has NO runtime effect but breaks the pinned base64url token if the test asserts one).
    - Deploy script `scripts/fork-setup/setup-services.ps1:12,98,116,137` hardcodes the hostname; to make
      it env-driven, add a `$Hostname = $env:HAPPY_PUBLIC_HOSTNAME` (or a script param) and interpolate it
      into the nssm descriptions + health-probe URL.

(c) Tests/docs to update IF the fixture domain is changed:
    - Tests: publicPairingInvite.test.ts, publicTunnelConfig.test.ts, cloudflareTunnelDaemonProvider.test.ts,
      tokenStorage.test.ts, publicEnrollment.test.ts, machineAuth.test.ts, socketOptions.test.ts (all assert
      `happy.evyatar.dev`).
    - Docs (descriptive only, optional): docs/fork-notes.md, docs/security-model.md, docs/backend-architecture.md,
      docs/api.md, docs/cli-architecture.md, packages/happy-server/AGENTS.md, packages/happy-app/AGENTS.md.
    - Do NOT touch codex-happy auth.rs to add the domain - invariant_75 (happy_seam_invariants.rs:634-635)
      forbids it; codex must stay loopback-only.
