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
submodules. Manifest mirror URLs are configured before any update can fetch.
Existing branches are never force-reset: any divergent/resumed branch fails
closed without moving its ref or discarding commits. There is no silent
fallback.

The root contract is exact:
`migration/vm-2026-07-14` at
`fa48a50a54fdf35c72e7f63ceba5d9cfab7655b5`. Restore preflight checks it
before changing remotes, submodules, or worktrees. A clean descendant on that
same branch is accepted only with explicit `-AllowNewerRootSnapshot`; a wrong
branch, unrelated SHA, or dirty root fails before mutation.

The toolkit's nested mcporter dependency is also manifest-controlled through
`https://github.com/evmitran_microsoft/mcporter.git`. Its mirror URL is set
before every toolkit restore, including toolkit worktrees and `D:\h`.

## Source publication gates

The Codex package fix at
`ad3eea7308db19b946cae9233ee2ad1071ccebed` and current plugin fixes are
local-only. They are deliberately not added to
`docs\vm-migration-manifest.json` as remote refs. Publish the owning source
first or provide explicit local inputs:

Publication inputs are exact, not advisory:

```powershell
...\bootstrap-vm.ps1 -ValidateOnly `
  -CodexPackagePath C:\path\codex-package.tgz `
  -CodexPackageSha256 <64-hex> `
  -CodexPackageExpectedVersion <version> `
  -CodexRef <ref> -CodexExpectedCommit <40-hex> `
  -ToolkitRef <ref> -ToolkitExpectedCommit <40-hex> `
  -ToolkitSourcePath C:\path\to\local-toolkit
```

The package path is checked for name, version, SHA256, and all shipped Windows
binaries. Git refs must resolve exactly to the supplied commits. Plugin setup
uses an exact detached toolkit checkout and validates installed plugin
versions; marketplace latest is not accepted as reproducibility evidence.
For an unpublished toolkit ref, `-ToolkitSourcePath` is mandatory and the
clean local checkout itself is installed. Without a local path, the ref must
exist remotely at the exact expected commit.

Install a validated Codex package with:

```powershell
...\bootstrap-vm.ps1 -InstallCodexPackage `
  -CodexPackagePath C:\path\codex-package.tgz `
  -CodexPackageSha256 <64-hex> `
  -CodexPackageExpectedVersion <version>
```

The install writes nonsecret provenance and then checks installed package
name, version, Windows binary layout, source artifact path, and SHA256.
Merely validating a ref or observing an already-installed version is not
release reproducibility evidence.

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
  rusty_v8 v149.2.0 with pinned extracted-library SHA256. Use
  `scripts\fork-setup\invoke-codex-build.ps1` for cargo checks/builds: it
  sources the frozen iteration profile, then overrides its `stable` setting
  with exact `RUSTUP_TOOLCHAIN=1.95.0-x86_64-pc-windows-msvc` for that child
  shell only. It never changes the global rustup default. `RUSTC_WRAPPER` is
  not global. Release/publish keeps its separate profile.
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
- The optional `D:\h` clone must match the manifest repository URL, snapshot
  branch, exact snapshot SHA, cleanliness, and every recursive submodule.
  Existing stale or unrelated repositories are rejected, never repointed.
- The production package id remains `com.evyatar109.happy`.
- Optional public mode is daemon-owned. The daemon starts its outbound
  cloudflared provider; this bootstrap creates no NSSM services.
- `setup-services.ps1` is retained only for an old standalone deployment and
  now requires the explicit `-LegacyStandaloneServices` switch.
- The enabled Copilot set is exactly stop-copilot-shell-polling,
  ralph-overview, edge-browser, and subagent-model-routing. Crews and Ralph
  Orchestration remain disabled.
- Secret gates inspect only existence and ACLs; secret content is not read.
  The owner itself must be the current operator, SYSTEM, or
  BUILTIN\Administrators. Effective allow ACEs, inherited or explicit, may
  grant access only to those same principals. Broad read,
  ReadAndExecute, or write grants to Everyone, Users, Authenticated Users, or
  any other principal fail validation. No token prefix is printed, and
  `happy auth status` is never called.
- GitHub/SAML, Codex Copilot login, signing, Firebase login, Cloudflare
  login/tunnel credentials, `~\.happy\public-tunnel.json`, USB authorization,
  pushes, tags, releases, and distribution remain operator gates.

## Lightweight validation

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fork-setup\test-vm-bootstrap.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fork-setup\bootstrap-vm.ps1 -ValidateOnly
```
