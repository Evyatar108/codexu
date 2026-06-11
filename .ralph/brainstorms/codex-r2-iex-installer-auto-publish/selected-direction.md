---
overviewTaskId: codex-r2-iex-installer-auto-publish
---

## Direction
D-001 — Standalone/flat bin artifact + R2 custom-domain + `iex` installer. Auto-publish a purpose-built win32-x64 binary artifact to a Cloudflare R2 bucket on every release and ship a `irm https://get.evyatar.dev/install.ps1 | iex` one-liner that verifies, extracts, and PATHs the binaries — no `gh` auth, no SAML, no npm.

> **Precondition (operator gate — must clear before build starts):**
> 1. **GO/NO-GO**: accept that the Copilot-talking fork may be publicly, unauthenticatedly downloadable by anyone (ToS / brand / support / revocation). If the real need is only "no gh+SAML for trusted machines," evaluate **D-004** (public GitHub release/mirror + signed assets) first — it may be cheaper.
> 2. **Security posture**: decide sha256-only (labeled corruption-only) for v1 vs a detached signature + embedded public key required before going public. Same-origin sha256 is a corruption check, NOT supply-chain security.

## Goal
A user on a clean Windows machine — with no Node/npm, no `gh` auth, no SAML authorization to `gim-home`, and no system `rg` — can run a single unauthenticated one-liner and end up with a working `codex` on PATH:

```powershell
irm https://get.evyatar.dev/install.ps1 | iex
```

Re-running the one-liner upgrades in place; an `uninstall.ps1` cleanly removes it. Every codex release auto-publishes the artifact + a `latest.json` pointer to R2 as part of the existing publish flow, gated on an operator-provisioned R2 token (skip+warn if absent so the GitHub Release still happens).

## Scope

### In Scope
- A purpose-built win32-x64 artifact containing all FIVE binaries — `codex.exe`, `codex-core.exe`, `codex-windows-sandbox-setup.exe`, `codex-command-runner.exe`, `rg.exe` — produced from the publish flow's assembled `$VENDOR` dir (the single source of truth). Reconcile the manual-vs-CI vendor-copy divergence (`publish-sandbox-patch.md:292-315` copies 2 exes; `publish-npm.yml:126-153` copies all 4 + rg) so the artifact is complete.
- Install **layout decision** (carry as the first planning question): simple `~/.codex-bin` on PATH vs the recognized standalone layout under `CODEX_HOME/packages/standalone/releases/<ver>/` with `bin/` + `codex-path/rg.exe`. Lenses lean standalone-layout so `install-context` classifies it `Standalone` and `rg`/doctor behave natively (`install-context/src/lib.rs:41-54,123-145,224-249`).
- An env-gated R2 upload step (`publish-r2.ps1`/`.sh` shared script) wired into `/publish-sandbox-patch` (live manual path) and mirrored in `publish-npm.yml`, that uploads the immutable versioned artifact + `.sha256` (+ optional `.sig`) FIRST, verifies, then regenerates + uploads `latest.json` (pointing at the immutable versioned URL; version/sha/size/createdAt) LAST, plus the installer scripts at stable keys.
- `install.ps1`: fetch `latest.json` → download → sha256 verify (abort on mismatch) → kill running `codex`/`codex-core` (locked-exe) → extract → add to USER PATH **and** current-session `$env:PATH` → `codex --version`. Idempotent re-run = upgrade. Support pinned `--version` for rollback.
- `install.sh`: honest — a Git Bash/WSL-on-Windows delegator that installs the win32 exes, or an explicit "unsupported on native Linux/macOS" exit (build is win32-x64 only).
- `uninstall.ps1`: remove the bin dir + PATH entry (+ optional `~/.codex-copilot`).
- Docs: a one-liner section in `codex/docs/workflows/install.md`; cross-reference the Cloudflare provisioning in codexu `docs/fork-notes.md`.

### Out of Scope
- Native Linux/macOS builds and a true cross-platform `curl|bash` installer (no such binaries exist today).
- Auto-installing Node/npm (D-001 is explicitly no-npm).
- Authenticode code-signing as a hard requirement (optional; needs an operator cert).
- Changing the existing GitHub Release / npm-tarball flow (the R2 channel is additive; the tarball remains for the existing audience).

## Criteria
- On a clean Windows profile (no npm, no `gh` auth, no system `rg`, an existing locked `codex.exe`, no prior PATH entry), the one-liner installs and `codex --version`, `codex doctor`, and a `rg`-dependent operation (e.g. thread search) all succeed.
- A tampered/corrupt download (sha mismatch) is rejected by `install.ps1` before extraction.
- A release run with the R2 token present uploads the immutable versioned artifact, then `latest.json` last; with the token absent it warns and skips, and the GitHub Release still succeeds.
- `latest.json` points at an immutable versioned URL (not a mutable "current" object), enabling a pinned `--version` rollback.
- Re-running the one-liner over a running codex upgrades in place without leaving a half-written tree; `uninstall.ps1` fully reverses the install (files + PATH).
- No secret is baked into any committed script; the R2 token is read only from env.

## Context

**Why feasible (verified against source).** The launcher finds `codex-core.exe` as a sibling or via `CODEX_CORE_PATH` (`codex-rs-overlay/codex-copilot-launcher/src/discovery.rs:3-38`); the npm `bin/codex.js` shim only resolves the vendored exe, prepends the vendored `path` dir for `rg.exe`, sets `CODEX_MANAGED_*` provenance, and spawns (`codex-cli/bin/codex.js:78-104,170-238`). Sandbox helpers also resolve as direct siblings / bundled-exe paths (`windows-sandbox-rs/src/helper_materialization.rs:180-208`, `setup.rs:628-639`), so one dir holding all five binaries works for the whole runtime. `CODEX_MANAGED_PACKAGE_ROOT` is read only when `CODEX_MANAGED_BY_NPM` is set, by `doctor`/update guidance (`cli/src/doctor.rs:807-846,971-985`; `cli/src/doctor/updates.rs:55-90`) — diagnostics-only, so a no-npm install does not break runtime (but doctor/update labels stay GitHub-flavored unless the layout is recognized).

**Disconfirming observations to validate early.** (1) A flat-dir smoke fails to launch/doctor because a package-layout assumption or `rg` resolution actually needs the recognized layout — which is why the layout decision leans standalone. (2) PowerShell PATH edits don't reach the current process — installer must set `$env:PATH` too. (3) AV/SmartScreen blocks the pipe-to-PowerShell pattern often enough that users still need manual steps.

**Cloudflare.** `wrangler r2 object put` uploads directly, authenticating from `CLOUDFLARE_API_TOKEN`. A custom-domain R2 binding (`get.evyatar.dev`) is the production path; `r2.dev` is documented non-production / rate-limited. The existing `happy.evyatar.dev` is a named tunnel to `localhost:3005` — NOT reusable for an R2 route; an R2 custom-domain binding routes directly to the bucket.

### Provisioning (operator, one-time) vs build (member, code)

**Operator provisions (manual; Cloudflare dashboard + secrets):**
- **P0 — GO/NO-GO + security posture** (the gate above).
- **P1** — Create the R2 bucket (e.g. `codex-dist`).
- **P2** — Bind a custom domain `get.evyatar.dev` to the bucket (DNS record + R2 custom-domain binding) in the existing `evyatar.dev` Cloudflare zone — independent of the `happy.evyatar.dev` tunnel.
- **P3** — Create a scoped R2 API token (Object Read & Write on that one bucket); export as `CLOUDFLARE_API_TOKEN` on the publish box.
- **P4 (optional)** — Generate a signing keypair; keep the private key OUT of R2's credential blast radius; hand the public key to the installer.

**Member builds (code lands in the codex repo):** the six stories below.

### Story breakdown (D-001)
1. **Artifact assembly** — package the five binaries from the assembled `$VENDOR` dir into the chosen layout (flat zip or standalone-layout zip); compute sha256; reconcile the manual-vs-CI vendor-copy divergence.
2. **R2 upload step** (`publish-r2.ps1`/`.sh`) — env-gated (skip+warn if no token); upload immutable versioned artifact + sha (+ optional sig) first, verify, then `latest.json` last, plus installer scripts; hook into `/publish-sandbox-patch` and mirror in `publish-npm.yml`.
3. **`install.ps1` + `uninstall.ps1`** — fetch/verify/extract/PATH/`--version`; upgrade = idempotent re-run; pinned `--version`; uninstall reverses files + PATH.
4. **`install.sh`** — Git Bash/WSL-on-Windows delegator or explicit unsupported exit.
5. **Security hardening (gated)** — detached signature + embedded public key verification before extract (or honest corruption-only sha framing if signing deferred).
6. **Docs + release-skill update** — `codex/docs/workflows/install.md` one-liner section; update `/publish-sandbox-patch` + `publish-npm.yml`; cross-ref provisioning in codexu `docs/fork-notes.md`.

### codex-vs-codexu placement
- **codex repo:** ALL code — `scripts/publish-r2.{ps1,sh}`, `install/install.ps1`, `install/install.sh`, `install/uninstall.ps1`, artifact assembly, `docs/workflows/install.md`, and the `/publish-sandbox-patch` + `publish-npm.yml` hooks. (Tied to the codex release + version scheme.)
- **codexu repo:** backlog/bookkeeping only (`.ralph-overview/data.json`) plus a cross-reference of the Cloudflare provisioning checklist in `docs/fork-notes.md` (the `evyatar.dev` zone context lives there).

### Alternatives considered (see brainstorm-synthesis.md)
- **D-002** reuse the release `.tgz` and extract+flatten — zero new artifact, but couples the installer to npm internals.
- **D-003** keep npm, just unauthenticate the URL — smallest change, but keeps Node/npm; bridge-only.
- **D-004** reframe — remove the auth barrier without a bespoke R2 channel (public GitHub release/mirror + signed assets); evaluate first if "public-anyone" is NOT the requirement.
