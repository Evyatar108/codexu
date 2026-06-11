Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm synthesis — codex-r2-iex-installer-auto-publish

**Idea:** A Claude-Code-style unauthenticated one-liner installer
(`irm https://<domain>/install.ps1 | iex`, plus a `curl|bash` analog) for the
win32-x64 Copilot Codex fork (`gim-home/codex`, built in `codexu/codex`), backed
by auto-publish to a Cloudflare R2 bucket — replacing today's `gh auth` + SAML +
`npm install -g` flow.

## Cross-lens agreement (high confidence)

All three lenses converged on the same conclusions, several independently
re-deriving the same source citations:

- **No-npm standalone packaging is technically feasible and not materially
  harder at runtime.** The launcher finds `codex-core.exe` as a sibling or via
  `CODEX_CORE_PATH` (`codex-rs-overlay/codex-copilot-launcher/src/discovery.rs:3-38`);
  the npm `bin/codex.js` shim only resolves the vendored exe, prepends the
  vendored `path` dir for `rg.exe`, sets `CODEX_MANAGED_*` provenance, and spawns
  (`codex-cli/bin/codex.js:78-104,170-238`). The Codex lens closed the last
  open question: the sandbox helpers also resolve as direct siblings / bundled-exe
  paths (`windows-sandbox-rs/src/helper_materialization.rs:180-208`,
  `setup.rs:628-639`), so a single dir holding all five binaries works.
- **`CODEX_MANAGED_PACKAGE_ROOT` is diagnostics-only, not runtime.** It is read
  only when `CODEX_MANAGED_BY_NPM` is set, by `doctor`/update guidance
  (`cli/src/doctor.rs:807-846,971-985`, `cli/src/doctor/updates.rs:55-90`). A
  flat install will not break runtime, but `doctor`/update labels will keep
  pointing at GitHub releases unless the layout is recognized.
- **Layout matters more than "flat vs not".** `InstallContext::rg_command`
  prefers a package layout's `codex-path` or a standalone `codex-resources`
  before falling back to plain `rg` on PATH
  (`install-context/src/lib.rs:123-145`); the standalone layout under
  `CODEX_HOME/packages/standalone/releases/<ver>/` is a recognized shape
  (`install-context/src/lib.rs:41-54,224-249`). Two lenses recommend mimicking
  that recognized layout over a bare `~/.codex-bin`.
- **Public, unauthenticated hosting is a product/legal decision, not just an
  engineering task** (Devil's Advocate `red_flag=true`, echoed by Copilot). The
  binary holds no secret (auth is per-user `codex login`), but publishing a
  Copilot-talking fork to anyone raises ToS / brand / support / abuse / revocation
  questions.
- **Same-origin sha256 is a corruption check, not supply-chain security.**
  `latest.json` and the artifact share one compromise domain; a bucket/token
  compromise rewrites both. Either add a detached signature with a public key
  baked into the installer (key kept out of R2's blast radius), or label sha256
  honestly as corruption-only. Do not call same-origin hashing "secure".
- **The `.sh` analog must be honest.** Release CI builds `x86_64-pc-windows-msvc`
  only (`publish-npm.yml:12-15,119-130`); a native Linux/macOS `curl|bash`
  install is impossible today. `install.sh` should be a Git Bash/WSL-on-Windows
  delegator or an explicit "unsupported" exit.
- **Cloudflare hosting:** `wrangler r2 object put` uploads directly and reads
  `CLOUDFLARE_API_TOKEN` from env; a custom-domain R2 binding (e.g.
  `get.evyatar.dev`) is the production path, while `r2.dev` is documented
  non-production / rate-limited. The existing `happy.evyatar.dev` is a named
  tunnel to `localhost:3005` (`AGENTS.md`, `docs/fork-notes.md`) — NOT reusable
  for an R2 route; R2 custom-domain binding routes directly to the bucket.
- **Repo placement:** all code (artifact assembly, `publish-r2.*`,
  `install.ps1`/`install.sh`/`uninstall.ps1`, docs, workflow + skill hooks) lives
  in the **codex** repo. **codexu** only tracks backlog/bookkeeping plus a
  cross-reference of the Cloudflare provisioning in `docs/fork-notes.md`.

## Candidate directions

### D-001: Standalone/flat bin artifact + R2 custom-domain + `iex` installer  (RECOMMENDED)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: delivers the literal one-liner the operator asked for; the
  publish flow already assembles the full vendor bin set, so producing a
  purpose-built artifact + `latest.json` is a small delta; the public artifact is
  decoupled from npm internals; install is trivial (verify → extract → PATH).
- Risks / friction: pipe-to-PowerShell trust + AV/SmartScreen prompts; PATH edits
  don't affect the current terminal (installer must also set `$env:PATH`);
  in-place overwrite of a running `codex.exe` is locked on Windows (must kill
  processes first); support moves off npm's familiar update/uninstall semantics.
- Cheapest validation: build one artifact from the assembled vendor set (4 codex
  exes copied at `publish-npm.yml:139-142` + `rg.exe` at `:153`), host with a
  hand-written `latest.json` on temporary R2, then run `install.ps1` on a clean
  Windows profile with NO npm, NO gh auth, NO system `rg`, and an existing locked
  `codex.exe`; assert `codex --version`, `codex doctor`, `rg` resolution, and a
  sandbox flow.
- Disconfirming observation: a flat-dir smoke fails to launch / doctor because a
  package-layout assumption or `rg` resolution actually requires the recognized
  layout — which is exactly why the open question below leans toward the
  standalone layout under `CODEX_HOME/packages/standalone/releases/<ver>/`.
- Key sub-decision: install to a simple `~/.codex-bin` on PATH (simplest) vs the
  recognized standalone layout (so `install-context` classifies it `Standalone`
  and `rg`/doctor behave natively). Lenses lean standalone-layout.

### D-002: Reuse the existing release `.tgz`; installer extracts and flattens
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: zero new build artifact; mirror the existing
  `codex-<ver>-win32-x64.tgz` to R2 as-is and have `install.ps1` `tar -x` +
  copy `package/vendor/x86_64-pc-windows-msvc/codex/*.exe` + `path/rg.exe`.
- Risks / friction: installer is coupled to npm tarball internals (path drift,
  layout changes); PowerShell `tar` support varies across Windows versions;
  the public trust boundary depends on the tarball's internal shape. The
  manual-flow-copies-2-exes vs CI-copies-4 divergence
  (`publish-sandbox-patch.md:292-315` vs `publish-npm.yml:126-153`) means the
  installer can't be a clean trust boundary until that's reconciled.
- Cheapest validation: prototype an extractor against the current Release `.tgz`
  that validates exactly the five required files and runs `codex --version`, with
  no publish-flow change.
- Disconfirming observation: PowerShell extraction is unreliable on a target
  machine, or the npm pack layout shifts again.

### D-003: Keep npm, just remove GitHub auth from the tarball URL
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: smallest change (effort S) — host the existing tarball on
  public R2 and make the one-liner `npm install -g https://.../codex.tgz`. Removes
  the gh+SAML barrier with near-zero new code.
- Risks / friction: keeps the Node/npm dependency, global-prefix/PATH confusion,
  and the locked-exe upgrade failure mode; it does NOT deliver the no-npm
  Claude-style standalone promise.
- Cheapest validation: upload the tarball to a public object; test
  `npm install -g <url>` on a fresh Windows box with and without Node present.
- Disconfirming observation: target users don't already have Node/npm, or upgrades
  still fail on locked exes.
- Note: viable only as a short-term BRIDGE; fails the core "no-npm" product goal.

### D-004: Reframe — remove the auth barrier WITHOUT a bespoke R2 channel
- Contributing lenses: [devils-advocate, copilot]
- Why this might work: if the real requirement is "no gh+SAML for trusted
  operators" (not "anyone on the internet"), the cheapest path may be making the
  `gim-home` release/repo public (or a small public release-only mirror / GitHub
  Pages redirect) with signed assets — avoiding bucket, DNS, token, and installer
  ownership entirely.
- Risks / friction: still a public-redistribution decision; doesn't give the
  branded `get.evyatar.dev` one-liner; GitHub release URLs are less "clean" than a
  custom domain.
- Cheapest validation: confirm with the operator whether "public-anyone" is the
  requirement; if not, price a public-release + signed-assets path against D-001.
- Disconfirming observation: the operator genuinely wants a branded, custom-domain,
  Claude-style one-liner — in which case D-001 wins and D-004 is moot.

## Gating decision (precondition for D-001/D-002/D-003)

Before ANY public-hosting direction proceeds, the operator must clear two gates
(this is the Devil's Advocate red flag, echoed by Copilot):
1. **GO/NO-GO** acceptance that the Copilot-talking fork may be publicly,
   unauthenticatedly downloadable (ToS / brand / support / revocation).
2. **Security posture**: sha256-only (labeled corruption-only) for v1, OR detached
   signature + embedded public key before going public.

## Open questions carried to planning
- `~/.codex-bin` (simple) vs recognized standalone layout under
  `CODEX_HOME/packages/standalone/releases/<ver>/` (native doctor/`rg`/Standalone
  classification)?
- sha256-only v1 vs detached-signature-required-before-public?
- `install.sh`: Windows-bash/WSL delegator now, or defer until non-Windows builds?
- Rollback when `latest.json` points at a bad release: pinned `--version` installs
  and/or a `latest`-pin-revert procedure?
- Reconcile the manual-Step-5 (copies 2 exes) vs CI (copies 4 exes) vendor
  divergence so the artifact source-of-truth is the assembled `$VENDOR` dir.
