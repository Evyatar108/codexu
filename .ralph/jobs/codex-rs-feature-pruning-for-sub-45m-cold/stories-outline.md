# Stories Outline: codex-rs feature pruning for sub-45m cold build

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Wrapper seam — 4-bin coverage + CODEX_FEATURE_OVERRIDE
**Description:** As the build-perf author, I want `scripts/measure-build.ps1` to (a) build all 4 release bins by default (not just 2) so A/B measurements reflect the full ship surface, and (b) honor a closed-allowlist `CODEX_FEATURE_OVERRIDE` env var (`voice` / `image-gif` / optionally `aws-lc-rs`) that translates into the right top-level cargo `--no-default-features --features ...` flags on the `codex-cli` package, so feature-prune experiments can be run per-build without churning workspace `Cargo.toml`.
**Acceptance Criteria:**
- [ ] `scripts/measure-build.ps1` cargo invocation at line 157 covers all 4 release bins: `cargo build --release -p codex-cli --bin codex-core -p codex-copilot-launcher --bin codex -p codex-windows-sandbox --bin codex-windows-sandbox-setup -p codex-windows-sandbox --bin codex-command-runner --timings`.
- [ ] `pwsh scripts/measure-build.ps1 -ParseOnly` with `CODEX_FEATURE_OVERRIDE` unset prints the 4-bin invocation above unchanged.
- [ ] `pwsh scripts/measure-build.ps1 -ParseOnly` with `CODEX_FEATURE_OVERRIDE=voice,image-gif` appends `--no-default-features --features voice,image-gif` flags scoped to the `codex-cli` package.
- [ ] `pwsh scripts/measure-build.ps1 -ParseOnly` with `CODEX_FEATURE_OVERRIDE=tui/voice` (package-style) OR `CODEX_FEATURE_OVERRIDE=foobar` (unknown name) fails before invoking cargo with a parse-time error.
- [ ] `scripts/iteration-env.sh` banner mentions the `CODEX_FEATURE_OVERRIDE` knob with one example.
- [ ] Typecheck passes (n/a for shell + powershell scripts; smoke via `-ParseOnly` in lieu).
- [ ] No SANDBOX PATCH needed (wrapper-only files: `scripts/measure-build.ps1`, `scripts/iteration-env.sh` banner).
**Dependencies:** None (Phase 1, parallel with US-004).
**Estimated complexity:** small

## US-002: Lever A — image-gif feature gate + release-graph forwarding
**Description:** As the build-perf author, I want the `image` crate's `gif` decoder to be a default-on cargo feature that can be turned off in the measurement harness, so cold-cache builds can drop the libwebp/gif decoder compile work while default distribution builds retain it.
**Acceptance Criteria:**
- [ ] `tui/Cargo.toml`: change `image = { workspace = true, features = ["jpeg", "png", "gif", "webp"] }` (line 76) to `image = { workspace = true, features = ["jpeg", "png", "webp"] }`. Add `[features]` block: `default = ["image-gif", "voice"]` (combined with US-003), `image-gif = ["image/gif"]`. SANDBOX PATCH marker `# SANDBOX PATCH: image-gif feature for sub-45m cold-cache prune; see patch-surface.md §14 inv-N + §15 replant.`
- [ ] `utils/image/Cargo.toml`: same shape applied to both `image = ...` lines at `:12` and `:20` (impl agent inspects whether both need editing or just one).
- [ ] **Release-graph feature forwarding (per F-001 fix):** `cli/Cargo.toml` changes `codex-tui = { workspace = true }` and `codex-utils-image = ...` (via `core/Cargo.toml`) to `default-features = false` with explicit feature lists; `cli/Cargo.toml` adds `[features]` block re-exporting `image-gif` via `codex-tui/image-gif` and `codex-utils-image/image-gif`. Impl agent runs `rg "codex-tui = { workspace" external/repos/codex-patched/codex-rs/` to find every consumer edge that needs forwarding. SANDBOX PATCH on each edge.
- [ ] Workspace `cargo check --workspace` passes from `external/repos/codex-patched/codex-rs/`.
- [ ] Full 4-bin release build passes with default features.
- [ ] `cargo tree -e features -i image --target x86_64-pc-windows-msvc` in pruned mode (env `CODEX_FEATURE_OVERRIDE=image-gif` — note: the OVERRIDE replaces default features) shows `image/png` + `image/webp` + `image/jpeg` present but NOT `image/gif`. Same command in default mode (no override) shows `image/gif`.
- [ ] Cold-cache A/B measurement captured per `docs/implementation/build-perf-artifacts/<runId>.csv` convention with two runs (BEFORE no override, AFTER `CODEX_FEATURE_OVERRIDE=image-gif`), both with full sccache + target wipe. Wall-time delta documented.
- [ ] `just bazel-lock-update` run after the Cargo.toml edits; `MODULE.bazel.lock` update included in the same commit.
- [ ] `just bazel-lock-check` passes.
- [ ] All §14 invariant rows + §15 replant recipe entries landed in same commit (per US-005, but the SANDBOX PATCH markers themselves land here).
**Dependencies:** US-001 (wrapper seam consumes the feature names this lever defines).
**Estimated complexity:** medium

## US-003: Lever B — voice feature gate + release-graph forwarding
**Description:** As the build-perf author, I want the TUI's `cpal` audio dep + `voice` / `audio_device` modules to be a default-on cargo feature that can be turned off in the measurement harness, so cold-cache builds on Windows can drop the cpal+WASAPI compile work (which today is dead code on Windows because `realtime-webrtc`'s `libwebrtc` consumer is `cfg(target_os = "macos")` only).
**Acceptance Criteria:**
- [ ] `tui/Cargo.toml`: change `cpal = "0.15"` (line 129) to `cpal = { version = "0.15", optional = true }`. Extend `[features]` block (from US-002): `voice = ["dep:cpal"]`. SANDBOX PATCH marker `# SANDBOX PATCH: voice cargo feature gates cpal + voice/audio_device modules for sub-45m cold-cache prune; see patch-surface.md §14 inv-N + §15 replant.`
- [ ] `tui/src/lib.rs`: change lines 92-99 from:
  ```
  #[cfg(not(target_os = "linux"))]
  mod audio_device;
  #[cfg(target_os = "linux")]
  #[allow(dead_code)]
  mod audio_device { /* stub body */ }
  ```
  to the generalized form:
  ```
  // SANDBOX PATCH: feature-off voice/audio_device stubs for cold-cache prune; see patch-surface.md §14 inv-N + §15 replant.
  #[cfg(all(not(target_os = "linux"), feature = "voice"))]
  mod audio_device;
  #[cfg(any(target_os = "linux", not(feature = "voice")))]
  #[allow(dead_code)]
  mod audio_device { /* stub body — same no-op shape as the existing Linux stub */ }
  ```
  Same pattern at lines ~199-208 for `mod voice`.
- [ ] **Stub-surface verification:** `tui/src/voice.rs` (real module) and the no-op stub MUST export the same surface API names (types/functions/enums) that consumers reference. Impl agent runs `rg "use crate::voice::|use crate::audio_device::" tui/src/` and `rg "voice::|audio_device::" tui/src/` and ensures the no-op stub covers every referenced symbol. Consumers expected (from Copilot review): `chatwidget/realtime.rs`, `chatwidget/settings_popups.rs`, `app/event_dispatch.rs`, `chatwidget.rs`. No widespread `#[cfg(feature = "voice")]` source edits at the consumer side.
- [ ] **Release-graph feature forwarding (per F-001 fix):** `cli/Cargo.toml` (and any other release-graph edge) re-exports `voice` via `codex-tui/voice`. Impl agent runs `rg "codex-tui = { workspace" external/repos/codex-patched/codex-rs/` to identify every edge.
- [ ] Workspace `cargo check --workspace` passes.
- [ ] Full 4-bin release build passes with default features (voice on).
- [ ] `cargo build --release -p codex-tui --no-default-features --features image-gif` (no voice) succeeds.
- [ ] `cargo tree -e features -i cpal --target x86_64-pc-windows-msvc` in pruned mode (env `CODEX_FEATURE_OVERRIDE=voice`) shows no path to `cpal` in the resolved graph. Same command in default mode shows the `codex-tui -> cpal` edge.
- [ ] Runtime smoke: `codex --version` returns expected version with voice gated off.
- [ ] Cold-cache A/B measurement captured per `docs/implementation/build-perf-artifacts/<runId>.csv` convention with BEFORE (default) and AFTER (`CODEX_FEATURE_OVERRIDE=voice`), both cold wipes. Wall-time delta documented.
- [ ] `just bazel-lock-update` + `just bazel-lock-check` pass.
**Dependencies:** US-001 (wrapper seam consumes the feature names); US-002 (shares `tui/Cargo.toml` edits — US-002 must land first to avoid `[features]` block race).
**Estimated complexity:** medium

## US-004: Lever C — aws-lc-rs investigation (conditional impl)
**Description:** As the build-perf author, I want to know whether the workspace `rcgen.features = ["aws_lc_rs", "pem"]` swap to `["ring", "pem"]` actually drops aws-lc-rs from the build graph, or whether `rama-tls-rustls` (transitively pulled by `network-proxy/src/certs.rs`) re-activates `aws_lc_rs` via cargo's feature unification — so I can either ship the prune or document why it's a no-op.
**Acceptance Criteria:**
- [ ] Pre-flight: `cd external/repos/codex-patched/codex-rs && cargo tree -e features -i aws-lc-rs --target x86_64-pc-windows-msvc > .ralph/jobs/codex-rs-feature-pruning-for-sub-45m-cold/cargo-tree-aws-lc-rs-before.txt`.
- [ ] **Decision branch:** if the pre-flight tree shows aws-lc-rs activated ONLY via the workspace `rcgen` dep (no rama-tls-rustls path): apply the SANDBOX PATCH at workspace `Cargo.toml:352-355` swapping `features = ["aws_lc_rs", "pem"]` → `features = ["ring", "pem"]`. Capture `cargo-tree-aws-lc-rs-after.txt` showing aws-lc-rs no longer in graph. Run `cargo check -p codex-client` to confirm test code compiles with ring backend. A/B measurement captured.
- [ ] **Else (rama-tls-rustls also activates it):** mark Lever C dead. Document the rama-tls-rustls path in the plan ship summary citing the cargo-tree evidence. NO `[patch.crates-io]` attempt (high conflict surface). NO dep-site override at the rama-tls-rustls site (transitive, not ours). Do NOT apply any Cargo.toml edit.
- [ ] If applied: `just bazel-lock-update` + `just bazel-lock-check` pass; full 4-bin release build passes; runtime smokes pass.
**Dependencies:** None (Phase 1, parallel with US-001 — read-only investigation; conditional workspace `Cargo.toml` edit has no overlap with US-002/US-003).
**Estimated complexity:** small (investigation) — medium (if applied)

## US-005: Docs — patch-surface §14/§15 + build-perf results table
**Description:** As a future rebaser, I want every SANDBOX PATCH landed by US-001..US-004 to be documented in `docs/implementation/patch-surface.md` §14 (invariant + enforcing test/guard) AND §15 (replant recipe), and the cold-cache A/B measurements documented in `docs/implementation/build-perf.md`, so the next upstream rebase has a checklist for re-applying the prune levers and the next perf-debug session has the historical baseline.
**Acceptance Criteria:**
- [ ] `docs/implementation/patch-surface.md` §14: add 1 invariant row per SANDBOX PATCH actually landed (likely 4-7 rows: tui/Cargo.toml `[features]` block; utils/image/Cargo.toml `[features]` block; tui/src/lib.rs stub-gating; cli/Cargo.toml dep-edge edits; core/Cargo.toml dep-edge edits; (conditional) workspace `Cargo.toml` rcgen feature swap). Each row has: invariant statement, enforcing test/guard command, severity.
- [ ] `docs/implementation/patch-surface.md` §15: add Feature-prune replant recipe block listing every edited file with exact SANDBOX PATCH marker text + diff hunk shape, so a future rebase can re-apply mechanically.
- [ ] `docs/implementation/build-perf.md` results table: add rows per lever attempted, BEFORE + AFTER, with wall-time, peak RSS, sccache delta, cargo exit code. Cross-link `CODEX_FEATURE_OVERRIDE` env-var documentation. Document A/B framing note (both runs cold, full wipe, ignore cached re-runs).
- [ ] `scripts/iteration-env.sh` banner already updated by US-001; cross-link from build-perf.md.
- [ ] Phase 5b docs review reaches `{docs: 'clean'}`.
**Dependencies:** US-001, US-002, US-003, US-004 (docs need the actual SANDBOX PATCH locations and measurement results).
**Estimated complexity:** medium
