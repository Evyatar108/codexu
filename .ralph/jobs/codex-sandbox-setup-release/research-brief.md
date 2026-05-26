# Research Brief — codex-sandbox-setup-release

## Researcher Findings

### Verified facts

- **Bin target name** confirmed via `external/repos/codex-patched/codex-rs/windows-sandbox-rs/Cargo.toml:13-19`: `codex-windows-sandbox-setup`, entry point `src/bin/setup_main.rs`. A second bin target `codex-command-runner` (entry `src/bin/command_runner.rs`) is also defined in the same crate.
- **Three edit sites** in `codex/.github/workflows/publish-npm.yml`:
  - lines 126–128: `cargo build --release --bin codex --bin codex-core` (missing `--bin codex-windows-sandbox-setup`)
  - lines 130–149: vendor layout assembly — `cp $REL/codex.exe $VENDOR/codex/codex.exe`, `cp $REL/codex-core.exe $VENDOR/codex/codex-core.exe` (missing third cp)
  - lines 224–248: release bundle stage — uses `cp -R stage-platform/vendor` (recursive); **no edit needed** if step-2 copy lands the exe under `$VENDOR/codex/`.
- **Downstream consumers are already prepared** to receive the binary:
  - `external/repos/codex-patched/codex-cli/scripts/build_npm_package.py:89-96` — `COMPONENT_DEST_DIR` already maps `codex-windows-sandbox-setup` → `codex` dir; `codex-command-runner` → `codex` dir.
  - `external/repos/codex-patched/codex-cli/scripts/build_npm_package.py:76` — Windows native components list already includes `"codex-windows-sandbox-setup"` and `"codex-command-runner"`.
  - `external/repos/codex-patched/scripts/install/install.ps1:673-677` — copyMap explicitly references both `codex/codex-windows-sandbox-setup.exe` → `codex-resources\codex-windows-sandbox-setup.exe` and `codex/codex-command-runner.exe` → `codex-resources\codex-command-runner.exe`.

### Launcher / discovery logic

- `external/repos/codex-patched/codex-rs/windows-sandbox-rs/src/setup_orchestrator.rs:558-578` — `find_setup_exe()` probes in this order: (1) same dir as `current_exe`, (2) `<exe-dir>/codex-resources/codex-windows-sandbox-setup.exe`, (3) PATH lookup.
- `codex/codex-rs-overlay/codex-copilot-launcher/src/discovery.rs` — launcher discovers `codex-core` only (via `CODEX_CORE_PATH` env or co-located). Sandbox-setup discovery is delegated to `codex-core` at runtime.
- Net: if the binary lands in `$VENDOR/codex/codex-windows-sandbox-setup.exe`, the install scripts move it to `codex-resources/`, and `find_setup_exe()` step (2) succeeds.

### Possible second gap: `codex-command-runner`

Both research agents independently surfaced that `codex-command-runner.exe` is listed by `build_npm_package.py` and `install.ps1` as a required Windows component — but the publish workflow only builds `codex` + `codex-core`. If this binary is referenced at runtime, it will produce the same "binary not found" symptom. The plan must verify whether `codex-command-runner` is referenced from the runtime path (via grep for invocations) and, if so, fold its build+copy into the same workflow PR. If not invoked at runtime, the plan documents it as a separate known gap.

### Cross-platform sandbox crate inventory

| Platform | Crate | Cargo.toml | Bin targets | Runtime sandbox |
|---|---|---|---|---|
| Windows | `windows-sandbox-rs` | `external/repos/codex-patched/codex-rs/windows-sandbox-rs/Cargo.toml:13-19` | `codex-windows-sandbox-setup`, `codex-command-runner` | Windows Job Object API (in-process), plus setup binary for installing firewall/security templates |
| Linux | `linux-sandbox` | `external/repos/codex-patched/codex-rs/linux-sandbox/Cargo.toml:6-9` | `codex-linux-sandbox` | Custom sandbox binary (gim-home fork's analog of upstream's bubblewrap dependency) |
| macOS | *none* | — | — | System `sandbox-exec` at hardcoded path `/usr/bin/sandbox-exec` (see `external/repos/codex-patched/codex-rs/sandboxing/src/seatbelt.rs:198`) |

Sandbox manager dispatch: `external/repos/codex-patched/codex-rs/sandboxing/src/manager.rs:48-62` (`get_platform_sandbox` → `MacosSeatbelt`/`LinuxSeccomp`/`WindowsRestrictedToken`) and `manager.rs:168-260` (`transform` method per-platform handling).

### Upstream openai/codex release model

Reference: `external/repos/codex-patched/.github/workflows/rust-release.yml` (canonical upstream release that the fork's `codex-patched` repo carries).

- **macOS** matrix at `rust-release.yml:74,86`: targets `aarch64-apple-darwin` + `x86_64-apple-darwin`; binaries shipped: `codex`, `codex-responses-api-proxy`. No sandbox binary.
- **Linux** matrix at `rust-release.yml:99,111`: targets `x86_64-unknown-linux-musl` + `aarch64-unknown-linux-musl`; binaries shipped: `codex`, `codex-responses-api-proxy`, **`bwrap`** (bubblewrap, sourced externally — not a Rust crate).
- **Windows**: upstream does NOT ship Windows. The gim-home fork added `.github/workflows/publish-npm.yml` for Windows distribution.

**Conclusion**: Upstream's strategy is platform-specific:
- macOS: rely on system sandbox-exec; ship no sandbox binary.
- Linux: ship the external `bwrap` binary as a vendored runtime dependency.
- Windows: upstream has no story; fork added its own publish workflow + a fork-built sandbox-setup binary.

The fork's `codex-linux-sandbox` Rust crate appears to be a fork-specific implementation (gim-home variant) replacing upstream's `bwrap` dependency.

### Existing docs in the codex submodule

- `codex/docs/implementation/architecture.md` — fork architecture overview.
- `codex/docs/implementation/patch-surface.md` — inventory of every patch vs upstream (Part B doc should slot alongside this or extend it).
- `codex/external/repos/codex-patched/AGENTS.md` — fork-level engineering guidance (per codexu CLAUDE.md, this is where fork guidance lives because root CLAUDE.md is gitignored).

## Architect Analysis

### Integration points & dependency graph

```
publish-npm.yml cargo build
    └─ produces target/release/codex-windows-sandbox-setup.exe
       └─ vendor copy: $REL/codex-windows-sandbox-setup.exe → $VENDOR/codex/
          └─ build_npm_package.py (auto-discovers from COMPONENT_DEST_DIR)
             └─ platform tarball codex-win32-x64.tgz includes it
          └─ release bundle stage (cp -R vendor) auto-includes it
             └─ install.ps1 copies vendor/codex/ → codex-resources/
                └─ find_setup_exe() probe-2 hits codex-resources/codex-windows-sandbox-setup.exe
```

### Technical constraints

- **No local cargo build available** on this Windows box (per codexu CLAUDE.md "codex fork: no local cargo, CI is truth"). Plan must:
  - Verify bin target name via `cargo metadata` (parses Cargo.toml, no compile) — already done by both research agents.
  - Defer workflow verification to CI on tag push.
- **CI is the only verifier**: `gim-home/codex` CI runs `invariant-check.yml` on push; the publish workflow runs on tag push. The acceptance gate (artifacts contain the exe) only manifests when a tag is pushed.
- **The fix is workflow-only**: no Rust code changes required.

### Risk areas

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bin target name mismatch | Resolved (verified `codex-windows-sandbox-setup`) | Cargo.toml grep |
| Release bundle stage misses the new exe | Low — uses `cp -R vendor` | Verify by inspecting line 224-248 in the produced workflow; smoke-test release tarball post-tag |
| Install script path mismatch | Low — install.ps1 already references the binary | Already verified |
| Launcher path resolution diverges | Low — launcher delegates to codex-core; find_setup_exe() in setup_orchestrator probes co-located + codex-resources + PATH | Smoke-test by running codex without --yolo after install |
| **`codex-command-runner.exe` also missing from packaging** | Medium — surfaced by both agents | Plan adds a verification step + scope-extension toggle |
| Test tag pollutes release history | Low | Use a pre-release suffix (e.g., `v0.X.Y-sandbox-test`); delete the test tag after verification or keep as a smoke release |
| `xwin`/LLVM build env on `windows-latest` runner | Low — already configured in workflow | n/a |

### Suggested phase strategy

- **PLAN phase (this phase)**: produce plan.md with file:line edit recipes, verification recipe, and Part B doc draft. Hand off to a separate impl member.
- **IMPL phase**: separate ralph member touches only `codex/.github/workflows/publish-npm.yml` (Part A) and `codex/docs/implementation/sandbox-setup-platform-matrix.md` (Part B). Pushes to `gim-home/codex` for CI verification. Tags a pre-release for end-to-end smoke test.

## Codex Research

Not run — codex CLI failed with `spawn codex ENOENT` (internal subprocess issue under Git Bash on Windows). Additive; no impact on plan quality.

## Copilot Research

Not run — `Model "gpt-5.5" from --model flag is not available` (env config mismatch with default model). Additive; no impact on plan quality.

## Consolidated File List

### Part A — files to modify

- `codex/.github/workflows/publish-npm.yml` (lines 126-128 build step; ~line 139 vendor cp; lines 224-248 release bundle stage — likely no edit but verify)

### Part B — files to read/reference

- `codex/external/repos/codex-patched/codex-rs/windows-sandbox-rs/Cargo.toml:13-19`
- `codex/external/repos/codex-patched/codex-rs/linux-sandbox/Cargo.toml:6-9`
- `codex/external/repos/codex-patched/codex-rs/sandboxing/src/manager.rs:48-62, 168-260`
- `codex/external/repos/codex-patched/codex-rs/sandboxing/src/seatbelt.rs:198`
- `codex/external/repos/codex-patched/.github/workflows/rust-release.yml:74, 86, 99, 111`
- `codex/external/repos/codex-patched/codex-cli/scripts/build_npm_package.py:66-96`
- `codex/external/repos/codex-patched/scripts/install/install.ps1:584-603, 670-681`
- `codex/external/repos/codex-patched/scripts/install/install.sh:594-602, 648-700`
- `codex/external/repos/codex-patched/codex-rs/windows-sandbox-rs/src/setup_orchestrator.rs:558-578`
- `codex/codex-rs-overlay/codex-copilot-launcher/src/discovery.rs`
- `codex/docs/implementation/architecture.md`
- `codex/docs/implementation/patch-surface.md`
- `codex/external/repos/codex-patched/AGENTS.md`

### Part B — files to create

- `codex/docs/implementation/sandbox-setup-platform-matrix.md` (new)

### codexu-side (optional follow-up)

- `D:/harness-efforts/codexu/plans/overview-data.js` — task `codex-sandbox-setup-release` should be flipped to `shipped` (with mergeCommit) after Part A merges; optional new task `codex-cross-platform-publish` filed if Part B recommends splitting.
