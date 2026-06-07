# Stories Outline: Codex Fork One-Liner Installer (D-002, Cloudflare R2)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Target repo for code: the `codex/` wrapper submodule. **HOLD for operator review** before implementation.*

## US-001: Shared release-publisher helper
**Description:** As a release operator, I want one wrapper-owned helper that derives the R2 publish artifacts from a built tarball, so the manifest and served scripts never diverge between the manual and CI publish paths.
**Acceptance Criteria:**
- [ ] `codex/scripts/release/publish-r2.mjs` computes SHA-256 + size of `codex-<ver>-win32-x64.tgz` and writes `manifest.json` (`{version, "win32-x64":{url, sha256, size}}`) + a `latest` object (plain version string). (AC-1)
- [ ] It asserts the tarball's vendor tree contains the full set: `codex.exe`, `codex-core.exe`, `codex-windows-sandbox-setup.exe`, `codex-command-runner.exe`, `rg.exe`; fails on an incomplete tarball. (AC-2b)
- [ ] It uploads the release objects AND syncs `install.ps1`/`install.sh` to the R2 root keys `/install.ps1` `/install.sh` (byte-match the repo sources). (AC-2c)
- [ ] Default interface `wrangler r2 object put` (env `CLOUDFLARE_API_TOKEN`/`R2_ACCOUNT_ID`/`R2_BUCKET`); S3-compatible alt documented as needing a SigV4 signer dep. `--dry-run`/`--local-out` mode works offline.
- [ ] Credential-absence is path-dependent: non-fatal no-op for the CI caller, hard-fail for the manual caller (unless `--skip-r2`/`--dry-run`). (AC-2)
- [ ] Typecheck/lint passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Publish-flow wiring (manual primary + CI guarded)
**Description:** As a release operator, I want the publish-r2 helper wired into both release paths, with the manual Step 5 binary set reconciled, so every release populates R2 with a complete bundle.
**Acceptance Criteria:**
- [ ] Reconcile `codex/.claude/commands/publish-sandbox-patch.md` Step 5 (L304) to copy all four exes (add `codex-windows-sandbox-setup.exe` + `codex-command-runner.exe`) to match CI publish-npm.yml L139-142.
- [ ] Step 5 calls `publish-r2.mjs` after the tarball is packed (after ~L352, before `gh release create`); this is the authoritative path (CI org-blocked).
- [ ] `codex/.github/workflows/publish-npm.yml` adds an R2-upload step after `$BUNDLE_ASSET` (after ~L252), guarded to no-op without the R2 secret; pending Actions unblock.
- [ ] The required R2 secret is named + scoped (least-privilege write to the one bucket) in the docs. (AC-2)
- [ ] Typecheck/lint passes.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: install.ps1 (real Windows installer)
**Description:** As a Windows user on a fresh box, I want `irm https://codex.evyatar.dev/install.ps1 | iex` to install a working, PATH-wired `codex`, so I don't need gh/SAML/npm.
**Acceptance Criteria:**
- [ ] `codex/scripts/install.ps1`: GET `/latest` with a version-shape guard accepting `0.135.0-copilot-api.1` and rejecting HTML; GET `/<ver>/manifest.json`; download to temp; `Get-FileHash` SHA-256 verify. (AC-6)
- [ ] On SHA mismatch: delete temp, abort, no install-dir/PATH change. (AC-4)
- [ ] Scoped process-kill: terminate only `codex`/`codex-core` whose exe path is under the install root (prompt unless `CODEX_NON_INTERACTIVE`); leave unrelated codex processes running. (AC-5)
- [ ] Stage -> backup current -> rename into `~/.codex-fork/bin/` -> rollback on failure; `rg.exe` co-located in `bin/`; `codex-package.json` marker written. (AC-5)
- [ ] PATH: update both persistent user PATH (registry, single entry) AND current-session `$env:Path`. (AC-3)
- [ ] Verify install-context classification of the `~/.codex-fork/bin` + `codex-package.json` layout (self-update consequence); document the result/limitation. (AC-11)
- [ ] Testability knobs `CODEX_INSTALL_ROOT`/`CODEX_BASE_URL`/`CODEX_NON_INTERACTIVE`; AC-3 same-session + persistent verification passes against a stub origin.
**Dependencies:** US-001 (manifest/latest contract); prerequisite layout + URL-shape decision
**Estimated complexity:** large

## US-004: install.sh (Windows-only stub)
**Description:** As a Unix user, I want `curl ... | sh` to clearly tell me the fork is Windows-only rather than silently failing.
**Acceptance Criteria:**
- [ ] `codex/scripts/install.sh` prints a clear "Windows-only fork; Unix build not yet available" message and exits non-zero, installing nothing. (AC-7)
**Dependencies:** None
**Estimated complexity:** small

## US-005: /latest endpoint + doctor-probe contract
**Description:** As the redirect plan's `codex doctor` probe, I want a single public `/latest` version source, so the probe goes green without GitHub auth.
**Acceptance Criteria:**
- [ ] `/latest` is a static R2 object (produced by US-001); documented contract (plain version string).
- [ ] Document that the redirect plan's doctor probe (`doctor/updates.rs:24`) should curl `codex.evyatar.dev/latest` and its hints (`tui/update_action.rs:17`) point at the one-liner; note the either-order sequencing. (AC-8)
- [ ] Optional Cloudflare Worker deferred to a follow-up.
**Dependencies:** US-001
**Estimated complexity:** small

## US-006: Docs + infra runbook
**Description:** As an operator, I want docs that make the one-liner primary and a clear infra-vs-code runbook, so I know exactly what to set up by hand.
**Acceptance Criteria:**
- [ ] `codex/docs/workflows/install.md` presents the one-liner as primary unauthenticated install; authenticated path retained as fallback. (AC-9)
- [ ] `codex/docs/README.md` points the quick-install at the one-liner. (AC-9)
- [ ] An infra-vs-code runbook section enumerates operator/ops steps (R2 bucket, retention, DNS bind, CI/dev credential) separately from code steps; every AC tagged `[code]`/`[infra]`. (AC-10)
**Dependencies:** US-003 (for accurate install steps)
**Estimated complexity:** small
