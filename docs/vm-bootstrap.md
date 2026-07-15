# VM bootstrap and restore

Run the read-only acceptance pass first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fork-setup\bootstrap-vm.ps1 -ValidateOnly
```

It prints `PASS`, `GATED`, and `FAIL` rows. `GATED` means an install action,
interactive secret, or unpublished source input remains. Only required
nonsecret `FAIL` rows return a nonzero exit.

## Staged bootstrap

Stages are explicit and idempotent:

```powershell
# User-scoped tools plus verified portable JDK and cloudflared.
...\bootstrap-vm.ps1 -InstallToolchains

# Repair the hook-safe Node copy from the selected NVM Node, if validation
# reports a mismatch. The replacement is staged, hash-checked, and atomic.
...\bootstrap-vm.ps1 -RepairNodeHookShim

# Exact migration branches, commits, worktrees, and recursive submodules.
...\bootstrap-vm.ps1 -RestoreWorkspace

# Node workspace, then Happy build and global source link without daemon start.
...\bootstrap-vm.ps1 -InstallWorkspaceDependencies -BuildAndLinkHappy

# Only the approved Copilot plugin allowlist.
...\bootstrap-vm.ps1 -ConfigurePlugins

# Android SDK packages and local.properties. Licenses are never implicit.
...\bootstrap-vm.ps1 -ConfigureAndroid
...\bootstrap-vm.ps1 -ConfigureAndroid -AcceptAndroidLicenses

# Optional real short clone for Gradle/MAX_PATH.
...\bootstrap-vm.ps1 -CreateShortClone -ShortClonePath D:\h
```

The documented legacy command remains compatible:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fork-setup\restore-vm-workspace.ps1
```

It delegates to the manifest-driven restore, validates every recorded branch
and SHA, restores all priority worktrees, and recursively initializes nested
submodules. There is no silent fallback.

## Source publication gates

The Codex package fix at
`ad3eea7308db19b946cae9233ee2ad1071ccebed` and current plugin fixes are
local-only. They are deliberately not added to
`docs\vm-migration-manifest.json` as remote refs. Publish the owning source
first or provide explicit local inputs:

```powershell
...\bootstrap-vm.ps1 -ValidateOnly -CodexPackagePath C:\path\codex-package.tgz -ToolkitRef refs\heads\operator-provided
...\bootstrap-vm.ps1 -ValidateOnly -CodexRef refs\heads\operator-provided -ToolkitRef refs\heads\operator-provided
```

The bootstrap never reconstructs a fix by editing installed npm or plugin
caches.

## Behavior and reruns

- Version pins and verified JDK/cloudflared URLs and SHA256 values live in
  `scripts\fork-setup\vm-bootstrap-config.json`.
- Cloudflared is pinned to 2026.7.2 Windows amd64. Validation checks only the
  named tunnel identity `happy` / `ebd51c79-c883-4850-a9bd-403c1513ed36`,
  its credential filename, and `cert.pem` ACL/existence. Certificate content
  is never read or printed.
- `D:` maps persistently at user logon to `C:\dev-drive`.
  `D:\codex-sccache`, `D:\cxb`, and `D:\Android\Sdk` are durable roots.
- Git Bash `usr\bin` is never globally added to `PATH`; narrow wrappers cover
  bash, Python, CMake, Perl, rm, and cp.
- The machine currently resolves `C:\.tools\.npm-global` before
  `%NVM_SYMLINK%`, and Copilot hooks call its `node.exe`. Validation compares
  that executable's version and SHA256 with the selected NVM Node. Repair uses
  a same-volume staged copy plus atomic replace, never delete/rename-first.
  If Windows denies replacement, leave the live executable intact and either
  rerun elevated or move `%NVM_SYMLINK%` ahead of the shadow directory in
  Machine PATH. Never remove the hook Node during an active session.
- Codex iteration uses `codex\scripts\iteration-env.sh`, sccache, xwin, and
  the verified rusty_v8 v149.2.0 archive. `RUSTC_WRAPPER` is not global.
  Release/publish keeps its separate profile.
- Happy source installation builds happy-wire, happy-server, and happy-cli,
  then runs `npm link` inside `packages\happy-cli`. It does not invoke
  `scripts\install-local.cjs`, start the daemon, or run auth.
- Android pins platform 36, build-tools 36.0.0, NDK 27.1.12297006, both CMake
  3.22.1 (app external native build) and 3.30.5 (ReactAndroid sources),
  platform-tools, emulator, `extras;google;usb_driver`, and
  command-line tools 20.0 from Google's archive with its official repository
  checksum. The USB driver package files are noninteractive; BOOX driver
  binding and USB authorization remain operator/device gates. It writes
  `sdk.dir=D:/Android/Sdk`. Expo prebuild is not used.
- The production package id remains `com.evyatar109.happy`.
- Optional public mode is daemon-owned. The daemon starts its outbound
  cloudflared provider; this bootstrap creates no NSSM services.
- `setup-services.ps1` is retained only for an old standalone deployment and
  now requires the explicit `-LegacyStandaloneServices` switch.
- The enabled Copilot set is exactly stop-copilot-shell-polling,
  ralph-overview, edge-browser, and subagent-model-routing. Crews and Ralph
  Orchestration remain disabled.
- Secret gates inspect only existence and ACL shape. No secret content or
  token prefix is printed, and `happy auth status` is never called.
- GitHub/SAML, Codex Copilot login, signing, Firebase login, Cloudflare
  login/tunnel credentials, `~\.happy\public-tunnel.json`, USB authorization,
  pushes, tags, releases, and distribution remain operator gates.

## Lightweight validation

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fork-setup\test-vm-bootstrap.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fork-setup\bootstrap-vm.ps1 -ValidateOnly
```
