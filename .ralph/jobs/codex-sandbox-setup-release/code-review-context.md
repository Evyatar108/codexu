# Code review context — codex-sandbox-setup-release

## Codebase conventions observed

- **`publish-npm.yml` build step style**: `cargo build --release` invocation uses per-bin continuation lines with trailing backslash, 12-space indent under the heredoc-style `run: |` block. New `--bin` lines must match this exact shape (preserved).
- **vendor copy step**: `cp "$REL/<bin>.exe" "$VENDOR/codex/<bin>.exe"` pattern, 10-space indent. `$REL` is `external/repos/codex-patched/codex-rs/target/release`; `$VENDOR` is `$GITHUB_WORKSPACE/vendor/x86_64-pc-windows-msvc`. New cp lines must mirror this layout.
- **Release-bundle step at line 235**: uses recursive `cp -R "$GITHUB_WORKSPACE/stage-platform/vendor" "$STAGE/vendor"` — automatically picks up any new files dropped under `$VENDOR/codex/`. No edits needed when adding new bins, only verify by inspection.
- **CLAUDE.md Distribution bullets**: backticked binary name, no trailing description (e.g., `` - `codex.exe` ``). New entries must match this grammar.
- **patch-surface tenants**: `codex/.github/workflows/publish-npm.yml` is wrapper-owned (lives outside `external/repos/codex-patched/`), so workflow-only edits do NOT require a `// SANDBOX PATCH:` marker, a `patch-surface.md §14` invariant row, or a §15 rebase-replant note. Those tenants apply only to edits inside `external/repos/codex-patched/codex-rs/`.

## Constraint references applied during review

- **No local cargo build** (codex/CLAUDE.md "Build env is LLVM clang-cl + lld-link + xwin-staged Windows SDK", codexu CLAUDE.md "codex fork: no local cargo, CI is truth"). Verification deferred to CI / operator-driven `/publish-sandbox-patch` per the spawn-prompt override. AC "Final commit lands on `gim-home/codex` main" is operator-driven, not Phase-5a-blocking.
- **Tag-vs-Cargo.toml gate** (`publish-npm.yml:32-46`): release tag must equal `v${VERSION_CONTENT}` where `VERSION_CONTENT` is `external/repos/codex-patched/codex-rs/Cargo.toml workspace.package.version`. Suffix-only test tags fail before the build step runs. The `/publish-sandbox-patch` skill is the authoritative tag-cut path.
- **Wrapper-owned vs submodule-owned surfaces**: edits in `codex/.github/workflows/` are wrapper-owned. Edits in `codex/external/repos/codex-patched/` are submodule-owned and require an additional submodule commit + wrapper gitlink update. This diff only touches wrapper-owned surfaces.

## File relationships discovered

- `build_npm_package.py:76-77` already declares `codex-win32-x64` and `codex-win32-arm64` component lists with both sandbox bins — npm packaging side is ready, only the workflow's build + vendor steps needed updating.
- `install.ps1:673-678` copyMap is target-agnostic — joins copy-source paths under `vendor/$target/`, so future arm64 targets need no install-script edits.
- `setup_orchestrator.rs find_setup_exe()` (3-step probe: current_exe dir → codex-resources/ → PATH) matches the install layout install.ps1 produces — install drops bin under `codex-resources/`, probe finds it via step 2.
- `runner_pipe.rs find_runner_exe()` (called from `runner_client.rs:231`) is the elevated non-yolo path entry — confirms `codex-command-runner` is in-scope alongside `codex-windows-sandbox-setup`.

## Patterns to preserve in future edits

- When adding a new sandbox-bin to `publish-npm.yml`, three sites need touching: (1) build step `--bin`, (2) vendor cp line, (3) verify release-bundle's recursive cp carries the file (no edit, just inspection).
- When updating CLAUDE.md Distribution list, match the existing bullet grammar — backticked binary name only.
- When citing source files in docs/, use `file:line` or `file:line-line` form; line numbers reflect the gitlink at time of writing.
