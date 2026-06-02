# Research Brief — codex-rs feature pruning for sub-45m cold build

## Researcher Findings
(Explore agent, gpt-5.4-mini, 130s)

### 4-bin footprint
- `codex-cli` package (workspace member `cli/`) produces the `codex-core` bin via SANDBOX PATCH at `cli/Cargo.toml:8-14` (`name = "codex-core"`).
  - Direct workspace deps include nearly every heavy crate: `codex-app-server`, `codex-tui`, `codex-core`, `codex-core-plugins`, `codex-cloud-tasks` (path-only at `cli/Cargo.toml:35`), `codex-chatgpt`, `codex-exec-server`, `codex-mcp-server`, `codex-model-provider`, `codex-models-manager`, `codex-plugin`, `codex-rollout`, `codex-sandboxing`, `codex-state`, etc.
- `codex-copilot-launcher` is the **launcher `codex` bin**, lives in `codex-rs-overlay/codex-copilot-launcher/`, sibling overlay package (workspace member declared at `external/repos/codex-patched/codex-rs/Cargo.toml:116`). Small package — not a compile-time bottleneck.
- `codex-windows-sandbox-setup` and `codex-command-runner` both live in package `codex-windows-sandbox` at `external/repos/codex-patched/codex-rs/windows-sandbox-rs/Cargo.toml:12-18`:
  ```
  [[bin]] name = "codex-windows-sandbox-setup"  path = "src/bin/setup_main/main.rs"
  [[bin]] name = "codex-command-runner"         path = "src/bin/command_runner/main.rs"
  ```
  Pulled into the codex-cli build path via `cli/Cargo.toml:94` (`[target.'cfg(target_os = "windows")'.dependencies] codex_windows_sandbox = { ... }`) AND `tui/Cargo.toml:125` (top-level `codex-windows-sandbox = { workspace = true }`). Cargo dedups but the package's heavy `windows-sys` feature list (~30 features) compiles once.
- The publish workflow at `.github/workflows/publish-npm.yml:109-130` confirms the 4-bin release build is `cargo build --release -p codex-cli --bin codex-core -p codex-copilot-launcher --bin codex -p codex-windows-sandbox --bin codex-windows-sandbox-setup -p codex-windows-sandbox --bin codex-command-runner`.

### `image` candidate (F-7 lever 1)
- Workspace dep already minimal: `Cargo.toml:314` → `image = { version = "^0.25.9", default-features = false }`. The heavy decoder set (PNG/JPEG/WebP/GIF/BMP/TIFF/TGA/ICO/HDR/DXT/etc.) is OFF at workspace level.
- Per-consumer opt-ins:
  - `tui/Cargo.toml:76` → `features = ["jpeg", "png", "gif", "webp"]`
  - `core/Cargo.toml:87` → `features = ["jpeg", "png", "webp"]` (no gif)
  - `utils/image/Cargo.toml:12` AND `:20` → `features = ["jpeg", "png", "gif", "webp"]` (duplicate dep line — likely target-block split, needs view in impl)
- Source usage is **unconditional** — no `#[cfg(feature = "image")]` gates anywhere (grep `tui/` returned no matches). Direct calls: `tui/src/clipboard_paste.rs:49-109`, `tui/src/bottom_pane/chat_composer.rs` (`image::image_dimensions(...)`), `core/src/context_manager/history.rs:192-219`, `core/src/tools/handlers/view_image.rs`.
- **Risk:** dropping any decoder breaks user paste/attachment of that format. **HIGH risk.** Lever C below targets just the lowest-cost feature: `gif` (rarely-pasted in practice, smallest decoder).

### `lalrpop` candidate (F-7 lever 2)
- **Not present in this checkout.** Grep across all `Cargo.toml` and `build.rs` files: zero hits for `lalrpop`.
- Existing build scripts (`cli/build.rs`, `skills/build.rs`, `bwrap/build.rs`, `execpolicy-legacy/build.rs`, `linux-sandbox/build.rs`) are trivial / non-codegen.
- **Lever is invalid for this codebase.** F-7's mention of `lalrpop` was wrong on the candidate set. Drop and replace with a verified-present heavy compile-time crate.

### `aws-lc-rs` candidate (F-7 lever 3)
- Workspace selects backend explicitly: `Cargo.toml:361-364` → `rustls = { ..., features = ["ring", "std"] }`. rustls is `ring`-backed across the workspace.
- The single `aws_lc_rs` feature flag in the workspace is at `Cargo.toml:352-355` → `rcgen = { ..., features = ["aws_lc_rs", "pem"] }`.
- `rcgen` consumers (production):
  - `codex-client/Cargo.toml:35` → workspace dep, used ONLY in `codex-client/tests/ca_env.rs` (test code, NOT in the release build).
  - `network-proxy/src/certs.rs` → uses `rama_tls_rustls::dep::rcgen` (TRANSITIVE through `rama-tls-rustls`, not via the workspace `rcgen` dep). `network-proxy` IS in the release build (`core/Cargo.toml:51` → `codex-network-proxy = { workspace = true }`).
- **Cargo feature unification gotcha:** even if we change workspace `rcgen.features` to `["ring", "pem"]`, `rama-tls-rustls` likely re-activates `aws_lc_rs` in its own `Cargo.toml`. Cargo unifies — the compiled rcgen has BOTH backends if any consumer asks for `aws_lc_rs`. **Lever is likely a no-op** unless we can also force `rama-tls-rustls` to drop the feature (need to inspect its source or find an alternate). Investigate-and-discard candidate.

### Heavy crates beyond the F-7 list
- `cpal = "0.15"` in `tui/Cargo.toml:129` under `[target.'cfg(not(target_os = "linux"))'.dependencies]` — pulled in for Windows/macOS audio. Used by `tui/src/voice.rs` + `tui/src/audio_device.rs`. Consumed by realtime voice input. **CRITICAL:** `mod voice` and `mod audio_device` are gated by `cfg(not(target_os = "linux"))` (see `tui/src/lib.rs:92-96` and `:199-205`), NOT by a cargo feature. On Windows, the voice modules compile unconditionally. AND `codex-realtime-webrtc` is a stub on non-macOS (its `libwebrtc` dep is `cfg(target_os = "macos")` only — see `realtime-webrtc/Cargo.toml:17`), meaning the Windows TUI compiles cpal + audio_device + voice as **dead code that ships anyway**. Pruning it on Windows is a NET WIN with zero runtime regression on Windows.
- `syntect = "5"` in `tui/Cargo.toml:116` (direct dep, not via workspace). Plus `two-face = { version = "0.5", default-features = false, features = ["syntect-default-onig"] }` at `:117` — the heavy syntax theme bundle. Used for code-block syntax highlighting in TUI markdown rendering. Pruning is a user-visible degradation (colored code blocks → plain). Document as follow-up; out of scope for this plan.
- `webrtc-rs`-family crates: confirmed NOT present (only macOS `libwebrtc` from juberti-oai fork — Windows is unaffected).
- `v8` (workspace dep at `Cargo.toml:434`, `= "147.4.0"`) — only used by workspace member `v8-poc` which is in `[workspace.metadata.cargo-shear].ignored` list. **Not built by the 4 bins** — already pruned. No action needed.
- `sqlx` in workspace deps (`Cargo.toml:383-393`, `default-features = false` with `runtime-tokio`, `tls-rustls`, `sqlite-bundled`, etc.) — sqlite-bundled IS a heavy build (~10-15K LoC of C compiled by `libsqlite3-sys`). Consumed by `thread-store/`, `agent-graph-store/`. Both are workspace members; need to verify whether they're in the codex-cli dep graph (likely yes via core). Out of scope for this plan but worth filing as a follow-up: "force sqlite-system instead of sqlite-bundled on dev boxes that have sqlite installed."
- `tonic` with `features = ["channel", "codegen"]` (workspace `Cargo.toml:422-423`) — gRPC. Used by `otel/` (opentelemetry-otlp). On a wrapper that doesn't use OTLP in production, this could be pruned. Out of scope follow-up.
- `gix = "0.81.0"` with `features = ["sha1"]` — git operations. Used by `git-utils/`. Active user-facing feature. Don't touch.
- `keyring = "3.6"` with `default-features = false` — used by `keyring-store/`, `login/`, `secrets/`, `rmcp-client/`. Multi-platform native backends; each enables a separate Windows API surface. Already minimal at workspace level.

### Wrapper-level disable mechanism — pre-research expectation vs reality
Pre-research the feature request suggested a wrapper-only `CARGO_FEATURES_TO_DISABLE` env. **This is not feasible via raw cargo:**
- Cargo's `--no-default-features` ONLY affects the packages named in `-p`, NOT their transitive deps. The candidate features live in workspace.dependencies (image, rcgen) or per-package Cargo.toml (tui's image opt-ins, tui's cpal dep) — `--no-default-features` on `-p codex-cli` does NOT disable image features that the dep graph pulls in.
- Cargo's `--features <list>` can ENABLE optional features for the package(s) in `-p`, but only if those features are defined in that package's `[features]` block. The codex-cli package has NO `[features]` block.
- **Therefore the wrapper env var is necessary but not sufficient:** disabling features requires per-package Cargo.toml edits to define new `[features]` blocks AND add `#[cfg(feature = "...")]` gates in source. The wrapper env var THEN selects which features to enable in the cargo build invocation. Both edits are required; neither alone works.

## Architect Analysis
(Explore agent, gpt-5.4-mini, 157s)

### Seam inventory (lowest conflict surface first)
1. **Wrapper/harness seam** — `codex/scripts/measure-build.ps1:156-158` already hardcodes the build command. Adding an env var translation here (e.g., `CODEX_FEATURE_OVERRIDE`) and threading it into the cargo invocation is **zero workspace Cargo.toml churn**.
2. **CLI feature flags on the build invocation** — `--no-default-features -p <pkg>` + `--features <list>`. Per-package, no Cargo.toml churn — but as the researcher noted, only works once `[features]` blocks exist in the target packages.
3. **Package-local Cargo.toml edit** — smallest manifest blast radius but still upstream-canonical if inside `external/repos/codex-patched/`. Each edit needs SANDBOX PATCH + §14 invariant row + §15 replant recipe.
4. **Workspace Cargo.toml patch / `[patch]` style** — highest conflict surface; avoid.

### sccache interaction
Feature changes invalidate affected crate fingerprints on the first build, then subsequent identical builds hit sccache. **The frozen profile rules still apply** (LTO=off invariant; CARGO_BUILD_JOBS not in cache key; RUSTFLAGS/codegen-units/lto must stay pinned). The first A/B measurement after a feature-change runs cold; the second run with same features hits cache. This is the **desired and expected** behavior — call it out explicitly so reviewers don't read the first-cold-after-change as a regression.

### Phase ordering
Measure **one lever at a time**: image-gif-only, then cpal-voice, then aws-lc-rs investigation. Each lever needs its own cold-cache A/B before stacking. Stacking levers obscures attribution.

### Verification gates
- `cargo check --workspace` (~6 min) — codex/CLAUDE.md confirmed gate.
- `cargo build --release` for all 4 bins (`-p codex-cli --bin codex-core -p codex-copilot-launcher --bin codex -p codex-windows-sandbox --bin codex-windows-sandbox-setup -p codex-windows-sandbox --bin codex-command-runner`).
- Runtime smokes: `codex --version`, `codex login --provider copilot` (no-network probe), `/audit`, `/runtime-audit`.
- A/B cold-cache measurement via `scripts/measure-build.ps1`.

### Rollback story
- Wrapper-only changes → revert `measure-build.ps1` chunk.
- Package Cargo.toml + source gates → revert the SANDBOX PATCH lines + remove the `#[cfg(feature = "...")]` blocks. §15 replant recipe documents this.

## Codex Research
Not run. Async-mode bash exec wrapper completed without producing output (codex-research.txt missing; suspected stdio-inherit pipe loss when the async PowerShell shell session terminated). Retry-in-Phase-4 plan: use synchronous codex-exec with long-form timeout in Phase 4 review.

## Copilot Research
Not run. Same failure mode as Codex (copilot-research.txt was created at 0 bytes, then orphaned). Retry-in-Phase-4 plan: synchronous copilot-exec in Phase 4 review.

## Consolidated File List

### Files the plan will modify (proposed disable set)
- `codex/external/repos/codex-patched/codex-rs/tui/Cargo.toml` — add `[features]` block defining `voice` (default-on for compatibility) and `image-gif` (default-on), AND mark the `cpal`, `image` decoder opt-ins behind those features. **SANDBOX PATCH.**
- `codex/external/repos/codex-patched/codex-rs/tui/src/lib.rs` — add `#[cfg(feature = "voice")]` guards on the two `mod voice` + `mod audio_device` declarations (lines ~92-99 and ~199-208). **SANDBOX PATCH.**
- `codex/external/repos/codex-patched/codex-rs/tui/src/` — any module that imports `voice::` or `audio_device::` (e.g., `app.rs`, `chatwidget.rs`, `chat_composer.rs`) needs `#[cfg(feature = "voice")]` on the import sites + on event-dispatch arms.
- `codex/external/repos/codex-patched/codex-rs/utils/image/Cargo.toml` — change image features to `["jpeg", "png", "webp"]` (drop `gif`). **SANDBOX PATCH.** (Aligns with core's existing minimal set.)
- `codex/scripts/measure-build.ps1` — add `CODEX_FEATURE_OVERRIDE` env-var handling that translates a CSV like `voice,image-gif` into `--features tui/voice,utils-image/image-gif` (or the equivalent comma-separated cargo feature list) and threads it into the line 157 cargo invocation. **Wrapper-only.**
- `codex/docs/implementation/patch-surface.md` — add §14 invariant row for the new SANDBOX PATCHes and a §15 replant recipe for each. **Wrapper-only.**
- `codex/docs/implementation/build-perf.md` — add results table rows for the A/B measurements; document the `CODEX_FEATURE_OVERRIDE` knob. **Wrapper-only.**

### Files the plan will REFERENCE but not modify
- `codex/scripts/iteration-env.sh` — frozen iteration profile; don't touch.
- `codex/.claude/commands/publish-sandbox-patch.md` — release-build env vars; don't touch.
- `codex/CLAUDE.md` — engineering tenants; don't touch.
- `.github/workflows/publish-npm.yml` — release builds use defaults (all features on); don't touch.
- `codex/external/repos/codex-patched/codex-rs/Cargo.toml` workspace deps — do NOT change `image` workspace dep (already minimal at `default-features = false`); do NOT change `rcgen` features (lever C is investigate-and-likely-discard).
- `codex/external/repos/codex-patched/codex-rs/core/Cargo.toml` — image features already minimal; don't touch. Core does NOT use cpal/audio.

### Out-of-scope follow-up candidates (file but defer)
- `syntect` + `two-face` removal — user-visible degradation; needs UX decision.
- `sqlx` `sqlite-bundled` → `sqlite-system` — needs system sqlite dep on the dev box.
- `tonic` (otel grpc) — if otel/otlp is unused in production, dropping codegen feature saves ~30 sec.
- `gif` feature in TUI specifically — included in this plan's Lever A as the lowest-risk image trim.
