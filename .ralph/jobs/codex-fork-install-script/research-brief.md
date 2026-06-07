# Research Brief — codex-fork-install-script (D-002)

Direction: D-002 (Cloudflare R2 behind codex.evyatar.dev; NO public GitHub repo; operator override of brainstorm's D-001).
Target repo for code: the `codex/` wrapper submodule (`D:/harness-efforts/codexu/codex`). Plan/job artifacts live in codexu.

## Researcher Findings (Explore)

- **publish-npm.yml** (`codex/.github/workflows/publish-npm.yml`): tag-triggered `v*`, `runs-on: windows-latest`, `RELEASE_TARGET=x86_64-pc-windows-msvc`. Builds `codex, codex-core, codex-windows-sandbox-setup, codex-command-runner` (L109-130). "Assemble vendor layout" (L132-154) copies the 4 exes + verified `rg.exe`. Merged bundle `codex-${RELEASE_VERSION}-win32-x64.tgz` via `npm pack` (L228-252, sets `$BUNDLE_ASSET`). Upload via `gh release upload "$TAG" "$BUNDLE_ASSET" --clobber` (L254-267) using `secrets.GITHUB_TOKEN`. **R2-upload insertion: after L252, before/alongside L254.**
- **publish-sandbox-patch.md** (`codex/.claude/commands/publish-sandbox-patch.md`): manual release path. Frozen env from `scripts/iteration-env.sh`. **Step 5 "Build and upload release bundle" L292-379**; tarball pack L336-352; `gh release create ... codex-${NEW_VERSION}-win32-x64.tgz` L370-373. `gh auth switch` already used (L239, L273). **R2-upload insertion: after L352, before L370.**
- **install.md** (`codex/docs/workflows/install.md`): current authenticated flow = `gh auth login` -> `gh release download v<VERSION> --repo gim-home/codex --pattern 'codex-*-win32-x64.tgz' ...` -> `npm install -g`. First-run: shell prompt -> `~/.codex-copilot/config.toml` -> `codex login --provider copilot` -> `codex-core.exe`. Vendor tree `$(npm root -g)/@gim-home/codex/vendor/x86_64-pc-windows-msvc/...`.
- **Script locations**: NO `codex/scripts/` dir today. Upstream's OWN install scripts at `codex/external/repos/codex-patched/scripts/install/install.{ps1,sh}` = REFERENCE-ONLY (upstream-canonical, openai/codex single-binary model). New installer is NET-NEW wrapper-owned: candidate `codex/scripts/install.ps1` (+ release helper under `codex/scripts/release/`), or top-level `codex/install.ps1` for a short served name (served key is decoupled from repo path).
- **Config dir** = `.codex-copilot` (NOT `.codex-fork`). Binaries dir `~/.codex-fork/` is separate -> no conflict.
- **Doctor coupling** (OUT OF SCOPE; redirect plan owns): `codex/external/repos/codex-patched/codex-rs/cli/src/doctor/updates.rs:24-26` `GITHUB_LATEST_RELEASE_URL`. Redirect task `codex-redirect-upstream-install-update-paths-to-fork`.
- **.ps1 test conventions**: none repo-wide beyond `pwsh -NoProfile -File ...` invocations in skills.

## Architect Analysis (Explore)

- **R2 publish integration: ONE shared generator/upload script invoked by BOTH** publish-npm.yml and publish-sandbox-patch Step 5 (DRY; avoids manifest drift; honors "every release target must receive the asset" rule). Secrets: CI = GitHub Actions secret (R2 S3-compat key-id+secret OR scoped API token); manual = dev-box env. If gim-home Actions policy-blocked, manual path is the only initial uploader.
- **install.ps1 algorithm** (Claude-model, adapted for tarball): GET /latest (version-regex guard) -> GET manifest.json -> download temp -> `Get-FileHash -Algorithm SHA256` compare (abort+delete temp on mismatch; NO PATH/dir mutation) -> Stop running `codex`/`codex-core` -> `tar.exe` extract `package/vendor/x86_64-pc-windows-msvc/**` -> install dir `~/.codex-fork/` -> user PATH wire `[Environment]::SetEnvironmentVariable('Path',...,'User')` (idempotent, no dup) -> trigger first-run -> idempotent upgrade = re-extract.
- **manifest.json** `{ version, "win32-x64": { url, sha256, size } }`; **/latest** plain version string. **Static R2 objects** recommended over a Worker (Worker optional, could also serve install.{ps1,sh} + doctor probe from one control plane). Manifest `url` = direct custom-domain `codex.evyatar.dev/<ver>/...`.
- **Infra-vs-code split**: ops = bucket create, DNS bind codex.evyatar.dev, retention/lifecycle (~100MB/release on 10GB free tier), CI/dev credential, optional Worker route. code = install.ps1, install.sh stub, manifest/latest gen+upload, publish-flow edit, optional Worker source.
- **Risks**: Windows file-lock on upgrade; tar.exe/.tgz quirks; PATH-not-visible-in-current-shell; sha trust (manifest+bytes same origin OK under single-origin TLS); credential leakage; retention growth; Unix stub mistaken for working; redirect coupling.
- **Test**: stub the origin (local HTTP/file mock) — verify version flows, non-version aborts, sha mismatch aborts cleanly, idempotent rerun, process-kill-before-overwrite, extracted tree shape.

## Codex Research (gpt-5.5, xhigh) — highest-signal additions

- **rg.exe-on-PATH requirement (CRITICAL):** `bin/codex.js:78` shim prepends the vendor `path/` dir (containing `rg.exe`) to the child PATH before launching codex. **Running `codex.exe` directly (our installer's model) bypasses that** -> `rg.exe` won't be found unless co-located on the same PATH-visible dir we wire, OR we replicate the standalone package layout. => HARD AC: `rg.exe` must sit in the same dir we add to PATH (e.g. `~/.codex-fork/bin/` alongside the 4 exes).
- **Launcher co-location:** `codex-rs-overlay/codex-copilot-launcher/src/discovery.rs:3` requires `codex-core.exe` next to `codex.exe`. `setup.rs:16` first-run writes `~/.codex-copilot/config.toml` + `codex login --provider copilot`.
- **Version regex:** upstream installer regex only allows `x.y.z[-alpha|-beta]`; this fork ships `0.135.0-copilot-api.1` -> guard must accept `-copilot-api.N`.
- **Layout alternative:** `install-context/src/lib.rs:184` standalone detection expects `~/.codex/packages/standalone/releases/...` with `codex-package.json`, `bin/`, `codex-resources/`, `codex-path/`. Codex recommends Option 2 (adapt that standalone layout so `codex doctor`/update/resource-detection classify it natively) over Option 1 (plain `~/.codex-fork/`). **Operator's selected-direction.md chose `~/.codex-fork/` (Option 1).** => surface as Open Question; default Option 1 + co-locate rg.exe; Option 2 as documented trade-off.
- **Step 5 drift (verify):** codex claims publish-sandbox-patch Step 5 copies only `codex.exe`+`codex-core.exe` (not the helper exes) before packing — conflicts with researcher's read. => Open Question / verification: confirm Step 5 packs the full 4-binary + rg.exe set BEFORE wiring R2 upload, else the R2 bundle is incomplete.
- **Second redirect coupling point (OUT OF SCOPE):** `tui/src/update_action.rs:17` update hints reference `chatgpt.com/codex/install.ps1` (US-003 hint strings).
- **install.ps1 reuse:** upstream `scripts/install/install.ps1:145` has reusable `Invoke-WithInstallLock`, `Path-Contains`, `Prepend-PathEntry`, staging-before-move, checksum. Testability knobs to add: `CODEX_INSTALL_ROOT`, `CODEX_BASE_URL`, `CODEX_NON_INTERACTIVE`.
- **Safer flow:** download to temp -> verify sha BEFORE touching install dir -> extract to staging dir -> atomic swap into `~/.codex-fork/` after killing processes (strengthens abort-cleanliness AC).

## Copilot Research (xhigh)

- Confirms: Windows-x64 only; tarball not bare exe; no `codex install` subcommand; Windows file-lock; CI vs manual path drift (CI still has GitHub Packages steps; manual says CI blocked, Releases-only). Recommends static R2 model first; helper scripts under `codex/scripts/release/` + `codex/scripts/install/`; download->verify->stage->swap; update `install.md` + `docs/README.md` to make one-liner primary; document redirect coupling (doctor curls /latest, US-003 hints use the irm one-liner).

## Consolidated File List

### Files to create (code-driven, wrapper-owned in `codex/`)
- `codex/scripts/install.ps1` (or `codex/install.ps1`) — real Windows installer.
- `codex/scripts/install.sh` (or `codex/install.sh`) — Windows-only non-zero stub.
- `codex/scripts/release/generate-manifest.mjs` (or .sh) — compute sha256+size, write manifest.json + latest.
- `codex/scripts/release/upload-r2.mjs` (or .sh) — upload tarball+sha256+manifest+latest to R2 (wrangler/S3 PUT). May be merged with the generator.

### Files to modify
- `codex/.github/workflows/publish-npm.yml` — add R2-upload step (after L252); CI = pending until Actions unblocked.
- `codex/.claude/commands/publish-sandbox-patch.md` — add R2-upload to Step 5 (after L352) = PRIMARY path; verify/reconcile binary-set drift.
- `codex/docs/workflows/install.md` — make one-liner primary; keep authenticated path as fallback.
- `codex/docs/README.md` — install pointer to one-liner.

### Reference-only / coupling (NOT edited by this plan)
- `codex/external/repos/codex-patched/scripts/install/install.ps1` (pattern reuse).
- `codex/external/repos/codex-patched/codex-cli/bin/codex.js` (rg.exe PATH-prepend behavior).
- `codex/codex-rs-overlay/codex-copilot-launcher/src/{discovery.rs,setup.rs}` (co-location + first-run).
- `codex/external/repos/codex-patched/codex-rs/install-context/src/lib.rs` (standalone layout option).
- `codex/external/repos/codex-patched/codex-rs/cli/src/doctor/updates.rs:24` + `tui/src/update_action.rs:17` (redirect-plan coupling, OUT OF SCOPE).

## Infra prerequisites (operator/ops — NOT Ralph-implementable)
- R2 bucket creation + retention/lifecycle policy.
- DNS / Cloudflare custom-domain binding of codex.evyatar.dev to the bucket (+ serving install.{ps1,sh}).
- CI R2 credential (GitHub Actions secret, least-privilege = write to the one bucket) and/or dev-box env for manual path.
