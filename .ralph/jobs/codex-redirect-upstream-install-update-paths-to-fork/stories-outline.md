# Stories Outline: Redirect upstream install/update paths to the fork (gim-home/codex)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. **HOLD** — operator must clear OQ1-OQ5 in `plan.md` first.*

## US-001: Make `codex doctor` fork-aware (probe + functional npm-root bug)
**Description:** As a fork user, I want `codex doctor` to check the fork's releases and recognize my fork install so the update probe stops hitting upstream OpenAI and the install check stops falsely failing.
**Files:** `cli/src/doctor/updates.rs` (call site → `KNOWN_PATCH_FILES`), `cli/src/doctor.rs` (functional + string, file-scoped guard).
**Acceptance Criteria:**
- [ ] `GITHUB_LATEST_RELEASE_URL` → `https://api.github.com/repos/gim-home/codex/releases/latest`, with a `// SANDBOX PATCH:` marker.
- [ ] Tag parse `strip_prefix("rust-v")` → `strip_prefix("v")`, extracted to a pure `parse_release_tag(tag: &str) -> Result<String, String>` helper.
- [ ] Brew probe neutralized (no fork cask) — no live `formulae.brew.sh` egress; marked.
- [ ] `update_action_label` hint strings redirected off `@openai/codex`.
- [ ] `compare_npm_package_roots` (`doctor.rs:987`) targets `@gim-home/codex`; the `:818` summary string + `:3112/:3124` tests updated to the fork package path; marked.
- [ ] Unit tests: `parse_release_tag("v0.135.0-copilot-api.1") == Ok("0.135.0-copilot-api.1")`; the redirected const names `gim-home/codex` and not `openai`; npm-root comparison matches a `@gim-home/codex` running root.
- [ ] The doctor `updates` row degrades to **Warning** (not Fail) on the internal-repo 404 (accepted behavior).
- [ ] `just test -p codex-cli` passes; `just fmt` + `just fix -p codex-cli` clean.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Neutralize the Unix daemon self-updater remote-script-exec
**Description:** As a maintainer, I want the `#[cfg(unix)]` daemon self-updater to stop fetching `chatgpt.com/codex/install.sh` and piping it to `/bin/sh`, eliminating the upstream self-update + remote-script-exec vector before any non-Windows build ships.
**Files:** `app-server-daemon/src/update_loop.rs` (call site → `KNOWN_PATCH_FILES`).
**Acceptance Criteria:**
- [ ] `install_latest_standalone()` neutralized to a no-op `Ok(())`; the `reqwest::get("https://chatgpt.com/codex/install.sh")` + `/bin/sh` pipe removed entirely (literal gone); `// SANDBOX PATCH:` marker present.
- [ ] Now-unused `#[cfg(unix)]` imports (`Stdio`, `AsyncWriteExt`, tokio `Command`) removed or `#[allow]`-ed; crate still compiles on both ubuntu and windows.
- [ ] Enforcement is the file-scoped `audit_invariants.sh` guard (forbid `chatgpt.com/codex/install` in `update_loop.rs`) + the `chatgpt\.com/codex/install` `ENDPOINT_PATTERN`; an optional `#[cfg(unix)]` no-op assertion test may be added (existing `update_loop_tests.rs` only covers restart-mode logic).
- [ ] `just test -p codex-app-server-daemon` passes; `cargo check --workspace` green.
**Dependencies:** None
**Estimated complexity:** small

## US-003: Redirect user-facing install/update hint strings
**Description:** As a fork user, I want every install/update hint to point at the fork, not upstream OpenAI's installer.
**Files:** `tui/src/update_action.rs` (strings + pinned tests, file-scoped guard), `app-server-daemon/src/lib.rs` (`:664` string), `app-server-daemon/README.md` (`:39`), affected `tui` snapshots.
**Acceptance Criteria:**
- [ ] `UpdateAction::command_args()` npm/bun `@openai/codex` → fork; brew neutralized; Standalone Unix/Windows `curl ... chatgpt.com/install.sh | sh` / `irm ... install.ps1 | iex` → the fork releases/install-docs URL (`command_args()` is static; per OQ5 RECOMMENDED `https://github.com/gim-home/codex/releases`); doc comments (11-20) updated; `// SANDBOX PATCH:` markers.
- [ ] The two pinned tests (`update_action.rs:142-163`) updated to the redirected commands.
- [ ] `app-server-daemon/src/lib.rs:664` error string + `app-server-daemon/README.md:39` redirected off `chatgpt.com/codex/install.sh`.
- [ ] `tui` snapshots refreshed: `just test -p codex-tui` then `cargo insta accept -p codex-tui`; review the `.snap` diffs.
- [ ] `just test -p codex-tui` + `just test -p codex-app-server-daemon` pass; `just fmt` clean.
**Dependencies:** None
**Estimated complexity:** medium

## US-004: Patch-surface + audit registration
**Description:** As a maintainer, I want every redirect/neutralization registered so the audits catch a regression to upstream on the next rebase.
**Files:** `docs/implementation/patch-surface.md`, `scripts/audit_network_calls.sh`, `scripts/audit_invariants.sh`.
**Acceptance Criteria:**
- [ ] `KNOWN_PATCH_FILES` (+ `KNOWN_PATCH_DESCRIPTIONS`) gains ONLY the true call sites `cli/src/doctor/updates.rs` and `app-server-daemon/src/update_loop.rs`; the string/functional files stay OUT (so Phase 2 keeps scanning them).
- [ ] `ENDPOINT_PATTERNS` gains `chatgpt\.com/codex/install` only (no tree-wide `@openai/codex`/`openai/codex`).
- [ ] `audit_invariants.sh`: new file-scoped `check_*` functions require the fork URL/package in `doctor/updates.rs` + `doctor.rs` and forbid `openai/codex/releases`, `@openai/codex`, `formulae.brew.sh`, `chatgpt.com/codex/install` in each patched file; wired into the run list.
- [ ] `patch-surface.md` §1 rows (the two call-site files), §14 invariant rows (one per story, with enforcing test/grep), §15 replant recipes (per-site; emphasize HIGH-churn `update_loop.rs` + `lib.rs`).
- [ ] `bash scripts/audit_network_calls.sh` and `bash scripts/audit_invariants.sh` both pass with no NEW-endpoint findings and no false positives on `branch_summary.rs`/`feedback_view.rs`/snapshots.
**Dependencies:** US-001, US-002, US-003 (and US-005 if Scope B)
**Estimated complexity:** medium

## US-005: (Scope B — RECOMMENDED per "EVERY"; operator may cut at HOLD) Redirect the latent TUI update-UI cluster
**Description:** As a fork user, I want even the currently-dead TUI update-notification surfaces to name the fork, so no stale upstream link can ever surface if the update flow is re-enabled.
**Files:** `tui/src/history_cell/notices.rs`, `tui/src/update_prompt.rs`, `tui/src/npm_registry.rs`, `tui/src/update_versions.rs`, `tui/src/updates.rs` (dead consts), affected `tui` snapshots.
**Acceptance Criteria:**
- [ ] `notices.rs` (`github.com/openai/codex` + `/releases/latest`), `update_prompt.rs:207`, `npm_registry.rs:5` `PACKAGE_URL`, `update_versions.rs:8` `rust-v` parse, and `updates.rs:49,51` dead consts redirected to the fork (markers as appropriate).
- [ ] `tui/src/updates.rs::get_upgrade_version` still returns `None` (no edit re-enables the update flow); an invariant asserts this.
- [ ] `tui` snapshots refreshed (`cargo insta accept -p codex-tui`).
- [ ] `just test -p codex-tui` passes; `just fmt` clean.
**Dependencies:** None (but land before US-004 so its registration covers these files)
**Estimated complexity:** medium
