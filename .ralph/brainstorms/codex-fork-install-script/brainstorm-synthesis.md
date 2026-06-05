Lenses: reasoned=[codex (feasibility), copilot (product-reality), devils-advocate]; provenance=analytical-by-member (not separate CLI subprocesses), grounded in verified source.

# Brainstorm synthesis — codex-fork-install-script

## Problem (verified against real source + Claude's live installer)

Goal: a Claude-Code-style one-liner installer for the codex fork —
`irm https://codex.evyatar.dev/install.ps1 | iex` (Windows) and
`curl -fsSL https://codex.evyatar.dev/install.sh | sh` (Unix), modeled on
`claude.ai/install.ps1`.

**Operator-SETTLED:** the install SCRIPT is hosted at
`codex.evyatar.dev/install.{ps1,sh}` via the fork's existing Cloudflare tunnel
(the fork already runs `happy.evyatar.dev`).

**THE real open decision (artifact hosting):** a clean *unauthenticated*
`irm|iex` needs the ~100 MB BINARY bundle at a PUBLIC URL too — but
`gim-home/codex` is **INTERNAL** visibility (Microsoft enterprise, SAML), so the
release asset is not publicly downloadable today.

### Ground truth

- **Artifact set** (`publish-npm.yml` "Assemble vendor layout" + `codex/CLAUDE.md`
  Distribution): `codex.exe` (launcher) → `codex-core.exe`,
  `codex-windows-sandbox-setup.exe`, `codex-command-runner.exe`, plus `rg.exe`.
  Packaged as `codex-<VERSION>-win32-x64.tgz` (an `npm pack` tarball:
  `package/bin/codex.js` shim + `package/vendor/x86_64-pc-windows-msvc/{codex/*.exe, path/rg.exe}`).
- **Windows-x64 ONLY.** `publish-npm.yml` `RELEASE_TARGET=x86_64-pc-windows-msvc`,
  `runs-on: windows-latest`; `/publish-sandbox-patch` Step 5 builds only that
  target. **There is no Unix build** — a `curl|sh` Unix one-liner has nothing to
  install.
- **Distribution today** (`docs/workflows/install.md`): authenticated only —
  `gh auth login` (+ SAML for `gim-home`) → `gh release download v<VERSION>
  --repo gim-home/codex` → `npm install -g <tarball>`. Unauthenticated download
  of the internal repo's asset is a 404.
- **No `install` subcommand.** Unlike `claude.exe install`, codex's `codex.exe`
  is only the launcher (first-run: shell prompt → `~/.codex-copilot/config.toml`
  → `codex login --provider copilot` → exec `codex-core.exe`). PATH wiring is
  done today by `npm install -g`. **A standalone installer must own PATH wiring
  itself.**
- **Claude's model** (`claude.ai/install.ps1`, fetched live):
  `GET $BASE/latest` (plain version string, rejected if not `\d+\.\d+\.\d+`) →
  `GET $BASE/$version/manifest.json` (per-platform `checksum`) →
  `Invoke-WebRequest .../claude.exe` → `Get-FileHash SHA256` verify →
  `claude.exe install` → cleanup. Claude ships a SINGLE self-contained `.exe`;
  **codex ships a multi-binary tarball** → the codex script downloads + extracts
  a tarball, not one `.exe`.
- **License is not the blocker.** Upstream codex is Apache-2.0 (redistribution of
  builds permitted); `rg.exe` is MIT/Unlicense. The blocker is **policy**: may a
  *build* of an INTERNAL-visibility repo be published PUBLICLY?

## Lens convergence

All three frames converge on the same posture:

1. **Feasibility (codex):** mechanically straightforward — Claude's installer is
   a ~90-line script; the codex variant differs only in (a) downloading +
   extracting a tarball instead of a single `.exe`, and (b) doing its own PATH
   wiring because there's no `install` subcommand. The ONLY hard dependency is a
   PUBLIC URL for the bytes.
2. **Product-reality (copilot):** the value of a clean one-liner is exactly
   proportional to how many target machines CAN'T already `gh release download`.
   If the audience is 100% SAML-authed Microsoft users, the public installer
   buys nothing; if it includes personal/CI/fresh boxes, it's the only clean
   path. And the Unix half is a broken promise until a Unix artifact exists.
3. **Devil's Advocate (`red_flag = true`):** the whole premise hangs on ONE
   policy question — *may the internal-repo binary be public?* This is a policy
   decision in an engineering costume; resolve it BEFORE any build work, because
   a "NO" collapses the deliverable to the authenticated status quo.

---

## Candidate directions (artifact hosting — axis 1)

### D-001: Public GitHub release-mirror repo + evyatar.dev thin control-plane — RECOMMENDED
- Contributing lenses: [codex, copilot, devils-advocate]
- **Effort:** low-medium · **Reliability:** HIGH · **Maintenance:** low · **Cost:** free
- **Shape:** the publish flow uploads the existing `codex-<ver>-win32-x64.tgz` +
  its `.sha256` to a NEW **public** mirror repo (e.g. `Evyatar108/codex-releases`)
  via `gh release create/upload`. `codex.evyatar.dev` serves `install.{ps1,sh}`
  and resolves `/latest`. The script fetches `/latest`, downloads the tarball
  from the public GitHub release CDN, verifies sha256, extracts to an install
  dir, wires PATH, triggers first-run.
- **Security:** split-trust, same as Claude — bytes from GitHub CDN (TLS), hash
  (manifest) + script from a trusted origin (`evyatar.dev` or the public GitHub
  release over TLS). Hash from a trusted channel is what makes verification
  meaningful.
- **Why it wins:** reuses the `gh release upload` machinery the publish flow
  already runs; GitHub-CDN reliability is **decoupled from the dev box**; free;
  and `/latest` doubles as the redirect-plan doctor probe's public version
  source.
- **Gate:** requires operator sign-off that publishing a build of the internal
  `gim-home/codex` to a PUBLIC repo is policy-acceptable.
- **Downside:** a SECOND, public release target the publish flow must never
  forget (same discipline class as the multi-remote push rule / marketplace
  index sync); the patched binary is public.

### D-002: Cloudflare R2 behind evyatar.dev (single-origin clean URLs)
- Contributing lenses: [codex, copilot, devils-advocate]
- **Effort:** medium-high · **Reliability:** HIGH · **Maintenance:** medium · **Cost:** near-free
- **Shape:** per-release `wrangler r2 object put` (or S3 PUT) of the tarball +
  `manifest.json` (version + sha256 + URL) to an R2 bucket bound to
  `codex.evyatar.dev`. Script, manifest, hash, AND bytes all live on ONE
  evyatar.dev origin.
- **Cost detail:** R2 free tier (10 GB storage) + **free egress to the internet**
  (the big win vs S3); ~100 MB/release needs a retention policy as releases
  accumulate.
- **Security:** strongest single-origin trust story (everything from one origin
  you control); needs an R2 access key in CI / the publish skill.
- **Why consider:** cleanest URLs and tightest trust; the natural upgrade if
  D-001's GitHub-API `/latest` resolution proves clunky or rate-limited.
- **Gate:** same public-binary policy gate as D-001 (R2 objects are public).
- **Downside:** most setup; a new credential + bucket lifecycle to own; marginal
  benefit over D-001 since the script entry point is already evyatar.dev.

### D-003: Cloudflare tunnel serving the bundle off the dev box — NOT recommended
- Contributing lenses: [codex, devils-advocate]
- **Effort:** lowest · **Reliability:** LOW · **Maintenance:** low-but-fragile · **Cost:** free
- **Shape:** add a route to the existing `happy.evyatar.dev` tunnel that serves a
  local `releases/` dir.
- **Disqualifier:** the binary's availability is tied to the operator's **desktop
  being awake/online** — fatal for an installer meant to run on fresh machines at
  arbitrary times. Acceptable ONLY for the tiny static `install.{ps1,sh}` +
  `version.json` (cheap, cacheable), never for the ~100 MB binary.

### D-004: No public mirror — authenticated npm-from-Packages for SAML users (Devil's-Advocate null option)
- Contributing lenses: [copilot, devils-advocate]
- **Effort:** low · **Reliability:** HIGH (authenticated) · **Maintenance:** lowest · **Cost:** free
- **Shape:** keep today's authenticated path; at most a thin `evyatar.dev` script
  that wraps `gh release download <latest> --repo gim-home/codex` + `npm install
  -g` for users who ALREADY have gh+SAML.
- **Honest framing:** this is the do-nothing-public baseline. It is **NOT** a
  clean unauthenticated one-liner — only users who can install today can use it.
  It is the correct answer **iff** the public-binary gate fails.

---

## Cross-cutting design (applies identically to D-001 / D-002)

### Script shape (axis 2) — model on claude.ai/install.ps1, adapt for a multi-binary tarball
1. `GET https://codex.evyatar.dev/latest` → fork version (e.g.
   `0.135.0-copilot-api.1`); reject non-version content (HTML error page guard,
   exactly as Claude does).
2. `GET .../manifest.json` → `{ version, "win32-x64": { url, sha256 } }`.
3. Download the tarball to a temp path.
4. `Get-FileHash -Algorithm SHA256` / `sha256sum`, compare to manifest; abort +
   delete on mismatch.
5. **Kill running `codex` / `codex-core` processes first** (Windows file-locking
   — `npm` can't unlink locked `.exe`, per `install.md`).
6. Extract `package/vendor/x86_64-pc-windows-msvc/**` to an install dir
   (`$env:USERPROFILE\.codex-fork\` / `~/.codex-fork/`), keeping `codex.exe` and
   `codex-core.exe` co-located.
7. Put the `codex.exe` launcher on PATH (PATH entry or a shim) — **the script
   owns this** because codex has no `install` subcommand.
8. Trigger the launcher's existing first-run (shell prompt →
   `~/.codex-copilot/config.toml` → `codex login --provider copilot`).
9. Idempotent upgrade = re-extract over the install dir; cleanup the temp
   tarball.

### Version resolution (axis 3) — ONE public source, TWO consumers
A single public `/latest` serves BOTH the installer AND the redirect-plan doctor
probe. For D-001, `/latest` can be GitHub's native **public** `releases/latest`
302 (unauthenticated-OK on a public mirror) or a 2-line Cloudflare Worker on
evyatar.dev that proxies it. For D-002 it's a static `/latest` object in R2.
**The redirect plan should curl THIS endpoint** instead of the internal-404
`api.github.com/repos/gim-home/codex/releases/latest` path — turning its doctor
**Warning row green** with no GitHub-auth plumbing.

### Publish-flow integration (axis 4)
`publish-npm.yml` + the manual `/publish-sandbox-patch` Step 5 already build
`codex-<ver>-win32-x64.tgz` and `gh release upload` it to `gim-home/codex`. Add:
compute the tarball sha256; write/refresh `manifest.json` + the version pointer;
push tarball + sha256 + manifest to the chosen PUBLIC host (D-001:
`gh release create/upload` to the public mirror repo; D-002: `wrangler r2 object
put`). One extra step, governed by the same "every release target must receive
the asset" sync discipline the fork already applies to multi-remote pushes.

### Redirect-plan integration (axis 5) — coupling + sequencing
The redirect plan (`codex-redirect-upstream-install-update-paths-to-fork`) is on
**HOLD**. Once `codex.evyatar.dev/install.*` + `/latest` exist, three of its HOLD
defaults FLIP:
- **OQ1 (doctor probe):** curl the public `/latest` → the Warning row becomes a
  functional green version row (no `Authorization: Bearer $(gh auth token)`
  plumbing needed).
- **US-003 (hint strings):** point at the `irm ...|iex` / `curl ...|sh`
  one-liner instead of `github.com/gim-home/codex/releases` (which a clean,
  unauthenticated user cannot even view).
- **US-002 (Unix self-updater):** could REDIRECT to `install.sh` instead of being
  neutralized — **but only once a Unix build target exists** (see below).

**Sequencing:** if THIS installer ships first, re-open redirect OQ1/OQ5/US-002 to
target the new public endpoint. If the redirect plan ships first with its
neutralize/static-pointer defaults, this installer is the follow-up that upgrades
those pointers. Either order works; flag the coupling so they don't drift.

### Windows-only reality (must not be glossed)
The fork builds **Windows-x64 only**. The `curl -fsSL ...|sh` Unix one-liner has
**nothing to install** today. Ship `install.ps1` (real) now; make `install.sh`
either a clear "Windows-only fork; Unix build not yet available — see <docs>"
stub that exits non-zero, OR defer it entirely until a Unix `RELEASE_TARGET` is
added to `publish-npm.yml`. Do NOT advertise the Unix one-liner as working.

---

## Recommended direction (HOLD for operator)

**Primary: D-001 (public GitHub release-mirror repo + evyatar.dev thin
control-plane)** — the lowest-effort path to a reliable, free, dev-box-independent
clean installer. It reuses the existing `gh release upload` machinery, inherits
GitHub-CDN reliability, satisfies split-trust integrity (bytes from CDN, hash +
script from a trusted TLS origin), and its `/latest` doubles as the redirect
plan's public version source.

Layered posture:
- **D-001 now** — *conditional on the public-binary policy gate clearing.*
- **D-002 (R2)** — the clean-single-origin upgrade if GitHub-API `/latest`
  resolution proves clunky or rate-limited; defer to a follow-up.
- **D-003** — rejected on availability (never host the binary off the dev box).
- **D-004** — the honest fallback **iff** the public-binary gate FAILS; not a
  clean one-liner.
- **install.ps1 now; install.sh stub/deferred** until a Unix build target exists.

This reflects a 3-frame + Devil's-Advocate consensus (`red_flag = true`) that the
deliverable's viability is **gated on a single policy answer**, not on
engineering: *may a build of the internal `gim-home/codex` be published
publicly?* A "YES" makes D-001 a small, clean piece of work; a "NO" collapses the
whole "clean unauthenticated one-liner" goal to D-004.

## Open questions for the operator
1. **GATE (decides everything):** May a BUILD of the internal-visibility
   `gim-home/codex` artifacts be published to a PUBLIC URL (public GitHub repo or
   R2)? If NO → only D-004 is possible and a clean unauthenticated one-liner
   cannot exist.
2. **Audience:** who installs via the one-liner — only SAML-authed Microsoft
   machines (D-004 may suffice), or also non-enterprise/personal/CI machines
   (public mirror is the only clean path)?
3. **Artifact host:** D-001 (public GitHub release-mirror, reuse `gh release
   upload`) vs D-002 (Cloudflare R2 single-origin)? Recommend starting D-001.
4. **Unix:** stub `install.sh` as "Windows-only, not yet supported" now, or defer
   it until a Unix `RELEASE_TARGET` is added? (No Unix artifact exists today.)
5. **Sequencing vs the redirect plan:** ship THIS installer first (then re-open
   redirect OQ1/OQ5/US-002 at `codex.evyatar.dev`), or let the redirect plan ship
   with neutralize/static defaults and treat this as the follow-up?
6. **install.ps1 layout:** extract to `~/.codex-fork/` + PATH entry (Claude-style)
   vs reuse the npm-global layout? (Codex has no `install` subcommand → the
   script owns PATH wiring.)
