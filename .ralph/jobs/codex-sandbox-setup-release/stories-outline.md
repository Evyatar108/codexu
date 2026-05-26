# Stories Outline: codex-sandbox-setup-release

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Windows publish-workflow packages codex-windows-sandbox-setup.exe and codex-command-runner.exe
**Description:** As a Windows user installing codex from a `gim-home/codex` release, I want both `codex-windows-sandbox-setup.exe` and `codex-command-runner.exe` to be present in the published bundle so that codex-core can locate the setup binary (`find_setup_exe()`) and the non-yolo elevated path can launch the runner binary (`find_runner_exe()`), allowing the CLI to run without `--yolo`.
**Acceptance Criteria:**
- [ ] `cargo metadata --manifest-path codex/external/repos/codex-patched/codex-rs/Cargo.toml --format-version 1 | jq -r '.packages[] | select(.name | test("windows-sandbox")) | .targets[] | select(.kind | index("bin")) | .name'` confirms bin target names `codex-windows-sandbox-setup` and `codex-command-runner`.
- [ ] `codex/.github/workflows/publish-npm.yml` is edited: build step (lines 126–128) extended with `--bin codex-windows-sandbox-setup` and `--bin codex-command-runner` preserving the trailing-backslash continuation style and 12-space indent; vendor copy step (after line 138) extended with two new `cp` lines at 10-space indent.
- [ ] `codex/CLAUDE.md` § Distribution (lines 104–112) lists both new binaries as bullets matching the existing list grammar.
- [ ] `external/repos/codex-patched/codex-rs/Cargo.toml` `workspace.package.version` bumped (submodule commit) and wrapper gitlink updated (wrapper commit) via `/publish-sandbox-patch`. Tag `v<NEW_VERSION>` matches Cargo.toml — the workflow's lines 32–46 gate enforces this, so suffix-only test tags are non-viable.
- [ ] `publish-npm.yml` CI run for the tag completes all steps green.
- [ ] `tar tzf` of the release-bundle tarball shows BOTH `vendor/x86_64-pc-windows-msvc/codex/codex-windows-sandbox-setup.exe` AND `vendor/x86_64-pc-windows-msvc/codex/codex-command-runner.exe`.
- [ ] Smoke test on a clean Windows machine (no prior `~/.codex-copilot/` state, no prior firewall rules): install bundle via `install.ps1`, confirm both `.exe` files exist under `<install-dir>\codex-resources\`, then run `codex exec "echo hello"` without `--yolo` — exit code 0, no "cannot find sandbox-setup" or "cannot find/launch codex-command-runner" errors, `~/.codex/log/` shows the elevated runner spawned.
- [ ] Typecheck passes (workflow YAML lint — implicit via CI passing).
**Dependencies:** None.
**Estimated complexity:** small (single-file workflow edit + one-line CLAUDE.md update + version bump via existing skill).

## US-002: Cross-platform sandbox-setup platform-matrix doc
**Description:** As a future maintainer expanding codex distribution to Linux/macOS/Windows-arm64, I want a definitive platform-matrix doc inventorying the per-platform sandbox-binary landscape, citing upstream openai/codex's release strategy, and writing the concrete delta against the current `publish-npm.yml`, so that the next person doesn't have to re-research the entire surface.
**Acceptance Criteria:**
- [ ] `codex/docs/implementation/sandbox-setup-platform-matrix.md` exists on `gim-home/codex` `main`.
- [ ] Section 1 (Per-platform sandbox-setup binary inventory) contains a table covering Windows / Linux / macOS with Cargo.toml file:line citations (or `seatbelt.rs:198` for macOS).
- [ ] Section 2 (Upstream openai/codex release model) cites `external/repos/codex-patched/.github/workflows/rust-release.yml:74,86,99,111,258-274` and states that `bwrap` is a Rust workspace bin target (built via `cargo build --bin bwrap` from the `codex-rs/bwrap` crate, linking vendored bubblewrap C sources), not an externally sourced binary.
- [ ] Section 3 (Concrete delta vs current publish-npm.yml) lists literal additions for Linux + macOS + Windows-arm64 (matrix, target triples, bin builds, vendor layout, install scripts, npm package suffixes), and calls out that `codex-win32-arm64` is already declared in `build_npm_package.py:77` and `install.ps1`'s copyMap is target-agnostic.
- [ ] Section 4 (Recommendation) picks "Split" or "Bundle" and states reasons.
- [ ] If "Split", names the follow-up task `codex-cross-platform-publish` and references this doc as its plan seed.
- [ ] Typecheck passes (markdown link/anchor sanity — implicit, no enforced gate).
**Dependencies:** None (independent of US-001 in edit surface; both touch disjoint files).
**Estimated complexity:** small (single new documentation file, research already done by the plan phase).
