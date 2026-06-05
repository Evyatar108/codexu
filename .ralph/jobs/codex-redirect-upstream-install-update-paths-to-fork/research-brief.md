# Research Brief: Redirect upstream install/update paths to the fork

## Researcher Findings (Explore agent — corroborated against direct reads)

Call sites in `external/repos/codex-patched/codex-rs/`:

- `cli/src/doctor/updates.rs`: consts `GITHUB_LATEST_RELEASE_URL`/`HOMEBREW_CASK_API_URL` (25-26); `updates_check()` (33-107) reached from `codex doctor` via `cli/src/doctor.rs:373` `tokio::join!` check set (no extra feature gate); `update_action_label` hints (134-136); `strip_prefix("rust-v")` (158-162); `run_command("curl", ...)` (174-179, defined `cli/src/doctor.rs:1039`).
- `app-server-daemon/src/update_loop.rs`: unix `run()` (53-69); non-unix `run()` bails (71-74); `install_latest_standalone()` (156-193); `reqwest::get("https://chatgpt.com/codex/install.sh")` (158). **Crate compiles on Windows** (no platform exclusion in Cargo.toml); `run_pid_update_loop` is a real CLI subcommand (`cli/src/main.rs`), but the updater loop body is `#[cfg(unix)]`-only → dead on shipped Windows.
- `tui/src/update_action.rs`: doc comments (11-20); `command_args()` literals (38-61: npm/bun `@openai/codex` 41-42, brew 43, Unix installer 48, Windows installer 57); `get_update_action()` (71-74). Reachable from `tui/src/app.rs`/`update_prompt.rs` but inert because `tui/src/updates.rs::get_upgrade_version()` is a hard no-op.
- `app-server-daemon/src/lib.rs`: `ensure_managed_codex_bin` install hint (654-666, the curl string at 664); not platform-gated at the function level.

No-op precedent `tui/src/updates.rs`: `#![cfg(not(debug_assertions))]` + SANDBOX PATCH marker (1-4); `get_upgrade_version() -> None` (32-35); `#[allow(unused_imports)]` dead imports (3-30); dead URL consts `#[allow(dead_code)]` (48-52); dead `check_for_update`/`fetch_latest_github_release_version` (74-132).

Audit infra: `audit_network_calls.sh` — `KNOWN_PATCH_FILES` (34-48), descriptions (50-64), `ENDPOINT_PATTERNS` (90-113), `EXCLUDED_FILES` (117-194); Phase 1 marker check (213-270), Phase 2 new-endpoint scan skipping known/excluded (274-390). `audit_invariants.sh` — `require_file_pattern` (40-48), `forbid_file_pattern` (50-60), `forbid_rust_tree_pattern` (62-76); example `check_launcher_remote_control_forced_off` (134-141, include-scoped + numbered-invariant comment).

Patch-surface format (AUTHORITATIVE, from direct read):
- §1 network suppression table: `| File | Call suppressed | Approach |` (lines 38-51).
- §14 invariant-to-test mapping: `| Invariant | One-line description | Enforcement type | Test path or script reference | Deliberate-violation procedure |` (highest invariant number is 30; new rows continue numbering).
- §15: per-feature rebase-replant recipes (e.g. "Stream-cut diagnostics replant" 1132-1213).

Verify commands (codex submodule): `cargo check --workspace` (Phase-5a gate); per-crate `just test -p <crate>` (or `cargo test -p <crate>`); `just fmt` / `just fix -p <project>`; `bash scripts/audit_network_calls.sh` + `bash scripts/audit_invariants.sh` (run in `.github/workflows/invariant-check.yml`).

Fork release/install (`docs/workflows/install.md`): tags `v<VERSION>` (e.g. `v0.135.0-copilot-api.1`); primary `gh release download v<VERSION> --repo gim-home/codex --pattern 'codex-*-win32-x64.tgz' ...; npm install -g <tgz>`; alt registry `npm install -g '@gim-home/codex' --@gim-home:registry=https://npm.pkg.github.com ...`.

Additional refs (completeness): live — the 4 in-scope files. Dead/latent in fork — `tui/src/updates.rs` (no-op), `tui/src/history_cell/notices.rs`, `tui/src/update_prompt.rs:207`, `tui/src/npm_registry.rs` PACKAGE_URL (all latent behind the no-op), `cli/src/doctor.rs:818` (remediation text, not network), `update_loop.rs` non-unix bail branch.

## Architect Analysis (Explore agent)

For all 4 sites, **overlay is NOT the lowest-conflict option** — it only adds a dep edge while still forcing inline edits at the literals. Use inline `// SANDBOX PATCH:` edits with guards/tests (matches the category-3 network-suppression precedent).

Per-site edit budget + re-conflict risk:
- `doctor/updates.rs`: ~6-10 lines; **MEDIUM**. Brew → neutralize; tag parse `rust-v`→`v`; `is_newer` degrades quietly on `-copilot-api.N`. Test: pure tag-parse unit test + fork-URL grep guard.
- `update_loop.rs`: ~8-12 lines; **HIGH** (new crate, Unix-only churny seam). Neutralize early-return `Ok(())`; dead-code fallout (`Stdio`/`AsyncWriteExt`/`reqwest`). Unix-cfg test runs on ubuntu CI; or grep guard.
- `update_action.rs`: ~8-10 lines; **LOW-MEDIUM**. Brew neutralize not redirect. Test: `command_args()` in-tree unit test.
- `lib.rs:664`: 1-2 lines; **HIGH** (new daemon crate; string re-emitted each rebase). Test: exact-string grep guard.

Ordering: update_action.rs → doctor/updates.rs → lib.rs → update_loop.rs (last; highest churn).

## Codex Research
Completed. Key adds: (1) `cli/src/doctor.rs::compare_npm_package_roots` hard-codes `@openai/codex` (functional fork bug). (2) `tui/src/update_versions.rs:8` also parses `rust-v`. (3) `command_args()` is static → the versioned `gh release download` flow doesn't fit; prefer the static GitHub Packages command. (4) `cli/src/main.rs:705 run_update_action` executes `command_args()`. Confirms inline-over-overlay and the same story split.

## Copilot Research
Completed. Key adds: (1) same `compare_npm_package_roots` functional bug. (2) **Guard-design constraint:** do NOT add a tree-wide `openai/codex` ban — legit refs in `branch_summary.rs`, `feedback_view.rs`, snapshots; guards must be file-scoped or install-pattern-specific. (3) Recommends Scope B (include latent TUI cluster) per "EVERY". (4) Snapshots may need updates if visible TUI strings change.

## Consolidated File List

**Files to modify (Rust, upstream-canonical, marked):**
- `cli/src/doctor/updates.rs`
- `app-server-daemon/src/update_loop.rs`
- `tui/src/update_action.rs`
- `app-server-daemon/src/lib.rs`

**Files to modify (fork-owned docs/scripts):**
- `docs/implementation/patch-surface.md`
- `scripts/audit_network_calls.sh`
- `scripts/audit_invariants.sh`

**Optional (HOLD — latent TUI cluster):**
- `cli/src/doctor.rs:818`, `tui/src/history_cell/notices.rs`, `tui/src/update_prompt.rs`, `tui/src/npm_registry.rs`, `tui/src/updates.rs` (dead consts)

**Precedent / reference:**
- `tui/src/updates.rs` (no-op template), `tui/src/tooltips.rs`, `analytics/src/client.rs`
