# Research Brief — codex-rs build time + cache resilience

## Consolidated File List

### Files to modify (docs/runbook — wrapper-owned)

- `codex/.claude/commands/publish-sandbox-patch.md` — **canonical** location for the frozen iteration profile + sccache wire-up snippet. New "Step 2a: Local iteration profile (frozen env block)" inserted before Step 2; new "Common failures" entries; new "Try-it only debuginfo=0 snippet" subsection.
- `codex/CLAUDE.md` — short "frozen iteration profile" rule pointing at `publish-sandbox-patch.md`; add a "sccache & cache resilience" confusion-point bullet.
- `codex/.claude/commands/rebase-upstream.md` — mirror the same frozen env block (or point at `publish-sandbox-patch.md` as the single source of truth) so rebase-validation builds don't drift the cache keys.

### Files to create (wrapper-owned scripts)

- `codex/scripts/iteration-env.sh` — sourceable Bash snippet emitting the frozen iteration profile (LTO + codegen-units + jobs + RUSTC_WRAPPER + SCCACHE_DIR + LLVM/xwin/rusty_v8 env vars).
- `codex/scripts/measure-build.ps1` — PowerShell benchmark sampler that wraps `cargo build --release --bin codex-core --timings`, captures peak RSS via `Get-Process` polling, dumps `sccache --show-stats` deltas, and writes a CSV row per run.

### Files to NOT touch

- `codex/external/repos/codex-patched/codex-rs/Cargo.toml` — `[profile.release]` `lto = "fat"`, `codegen-units = 1`, `strip = "symbols"`, `split-debuginfo = "off"`. Upstream-canonical; high-conflict; the **env-var overrides** in `publish-sandbox-patch.md` are how we already deviate. Stay in the env-var layer.
- `codex/external/repos/codex-patched/AGENTS.md` — upstream-canonical, would conflict on every rebase. Frozen-profile policy belongs in wrapper files.
- Any `codex-rs/` source files. Plan is scoped to env / config / docs / scripts only.

### Reference (upstream sccache precedents — read-only)

- `codex/external/repos/codex-patched/.github/workflows/rust-ci-full.yml` — installs sccache, sets `SCCACHE_DIR` + `RUSTC_WRAPPER` + `CARGO_BUILD_RUSTC_WRAPPER` + `CARGO_INCREMENTAL=0`, restores/saves cache, prints stats. Proves upstream considers sccache compatible with the codex-rs workspace.
- `codex/external/repos/codex-patched/.github/workflows/rust-ci-full-nextest-platform.yml` — same pattern.
- `codex/external/repos/codex-patched/.github/workflows/v8-canary.yml` — builds rusty_v8 from source with sccache, proving sccache coexists with the rusty_v8 toolchain.

## Current state — verbatim values

### `codex/.claude/commands/publish-sandbox-patch.md` Step 2 (lines 74-87)

```bash
export PATH="/c/Program Files/LLVM/bin:$PATH"
export RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc
export CC=clang-cl CXX=clang-cl AR=llvm-lib CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=lld-link
export CARGO_PROFILE_RELEASE_LTO=thin CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
V8_VERSION=$(grep '^v8 = ' external/repos/codex-patched/codex-rs/Cargo.toml | sed 's/.*"=\(.*\)".*/\1/')
XWIN_WIN_PATH=$(cygpath -w "$HOME/.xwin")
export RUSTY_V8_ARCHIVE="$HOME/.cargo/.rusty_v8/rusty_v8_release_x86_64-pc-windows-msvc_v${V8_VERSION}.lib"
export LIB="${XWIN_WIN_PATH}\\crt\\lib\\x86_64;${XWIN_WIN_PATH}\\sdk\\lib\\um\\x86_64;${XWIN_WIN_PATH}\\sdk\\lib\\ucrt\\x86_64"
export INCLUDE="${XWIN_WIN_PATH}\\crt\\include;${XWIN_WIN_PATH}\\sdk\\include\\ucrt;${XWIN_WIN_PATH}\\sdk\\include\\um;${XWIN_WIN_PATH}\\sdk\\include\\shared"

cd external/repos/codex-patched/codex-rs
cargo build --release --bin codex --bin codex-core --bin codex-windows-sandbox-setup --bin codex-command-runner
```

Note line 89: "codex-core LTO takes ~20 minutes on a cold cache. It may use 5+ GB of RAM during the link step." (with `lto = "thin"` + `codegen-units = 16` overrides; fat LTO from `Cargo.toml` defaults is even worse.)

Note line 387 in "Common failures": "`rustc` OOM during codex-core link: ensure `CARGO_PROFILE_RELEASE_LTO=thin` and `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16` are set (fat LTO needs 10+ GB)."

### `codex/external/repos/codex-patched/codex-rs/Cargo.toml` lines 505-514

```toml
[profile.release]
lto = "fat"
split-debuginfo = "off"
# Because we bundle some of these executables with the TypeScript CLI, we
# remove everything to make the binary as small as possible.
strip = "symbols"

# See https://github.com/openai/codex/issues/1411 for details.
codegen-units = 1
```

Upstream defaults force fat-LTO + codegen-units=1; the publish runbook env-var overrides them to thin + 16 to avoid 10+ GB link-step OOM. **No incremental setting** — defaults to on for dev/test, off for release.

### `codex/external/repos/codex-patched/codex-rs/.cargo/config.toml`

```toml
[target.'cfg(all(windows, target_env = "msvc"))']
rustflags = ["-C", "link-arg=/STACK:8388608", "-C", "target-feature=+crt-static"]
```

(Plus aarch64 and gnu equivalents.) **Note:** `target-feature=+crt-static` is a hard rustc input; sccache cache keys include it. Any change here invalidates the entire workspace cache wholesale.

### Host facts (probed 2026-06-01)

- Total RAM: 63.7 GB.
- Logical CPUs: 16.
- Pagefile `C:\pagefile.sys`: allocated **52,945 MB ≈ 52 GB**, current usage 6,863 MB, peak 14,394 MB → **≥32 GB requirement already satisfied**.
- Pagefile `D:\pagefile.sys`: registry says `0 0 TempPageFile=true` (auto-managed temp, not the active backing store).
- Free space: C: ≈34 GB, D: ≈454 GB. **`SCCACHE_DIR` must go on D:.**
- `sccache` not on PATH.

### Workspace facts

- 119 `[package]` manifests under `codex-rs/`. Final link of `codex-core` is the dominant wall-time consumer at fat-LTO; even at thin-LTO + 16 units the link step is ~20 min.
- 4 shipped binaries: `codex`, `codex-core`, `codex-windows-sandbox-setup`, `codex-command-runner`. Each invokes the system linker → **none of those final link steps are sccache-cacheable** per sccache's documented exclusion list (`bin`, `dylib`, `cdylib`, `proc-macro`).
- Rust toolchain pin: `1.95.0` from `rust-toolchain.toml`. **The toolchain version is part of every sccache key**; an rustup upgrade invalidates the cache once per upgrade (expected, not a regression).

## sccache compatibility with the LLVM cross-toolchain

**Compatibility verdict: COMPATIBLE.** Three pieces of evidence:

1. **Upstream codex uses sccache today** in `rust-ci-full.yml`, `rust-ci-full-nextest-platform.yml`, and `v8-canary.yml`. Those workflows run on Windows runners with the same x86_64-pc-windows-msvc target (CI uses MSVC stock not LLVM clang-cl, but sccache's rustc-wrapping path is target-toolchain-agnostic — it intercepts `rustc` invocations, not `cl.exe`/`link.exe`).
2. **sccache's rustc cache key is the parsed `rustc` argv + source hash + dep hashes** (per Mozilla sccache docs `docs/Rust.md`). It does NOT include `LIB`/`INCLUDE`/`RUSTY_V8_ARCHIVE` directly; those flow into the binary at link time, which sccache skips anyway (the `bin`/`dylib`/`cdylib`/`proc-macro` exclusion).
3. **`RUSTY_V8_ARCHIVE` is a prebuilt `.lib`** consumed by the rusty_v8 crate's `build.rs` and then handed to the linker. The crate's rustc-level output (the `lib*-*.rlib`) IS sccache-cacheable; the final link that pulls in the `.lib` is not, but it never was. So sccache cleanly speeds up everything *between* "cold target/" and "final link" — which on a 119-crate workspace is the dominant cost. This is consistent with how Mozilla, the upstream codex CI, and Tauri use sccache.

**One configuration requirement:** `CARGO_INCREMENTAL=0`. sccache's docs say incremental and sccache are mutually exclusive (incremental cache state is per-target-dir and not shareable, plus sccache can't key off incremental fragments). All upstream workflows set this. The release profile already disables incremental by default (Cargo behavior — `incremental = false` is the default for release), but the dev/test profiles inherit-from-default with incremental enabled; we set `CARGO_INCREMENTAL=0` explicitly in the iteration-env snippet to cover `cargo check --workspace` and `cargo test -p <crate>` too.

**Cache-key sensitivity (the actual r6 root cause):**
- `CARGO_BUILD_JOBS` is a Cargo scheduling parameter; **NOT** part of any rustc cache key. ✅ Cache survives jobs changes.
- `LTO` (`-C lto=...`): part of rustc argv → cache key. ❌ Changing LTO invalidates the cache.
- `RUSTFLAGS=-C debuginfo=0`: part of rustc argv → cache key. ❌ Changing debuginfo invalidates the cache.
- `codegen-units`: part of rustc argv → cache key. ❌ Changing this invalidates the cache.
- `RUSTY_V8_ARCHIVE`: env var only seen by rusty_v8's `build.rs` → cache key for that one crate's build script output. Path change is fine if the contents are byte-identical; pointing at a different `.lib` invalidates rusty_v8.

The r6 retrospective's hope was that sccache would survive "LTO=thin→off + jobs=2→1." **It survives jobs but NOT LTO.** The actual fix is *both* sccache *and* the frozen profile rule: freeze LTO so the cache is sticky AND turn on sccache so when the cache IS valid it gives 100x speedup.

## Risk areas

- **Final `codex-core` link is uncacheable.** Even with sccache and a warm cache, the link step (currently ~20 min thin-LTO) is the floor. To improve link time, the only knobs are (a) `LTO=off` to skip cross-crate LTO (lets each crate's `.rlib` be near-final, link becomes mechanical concat + relocations), (b) reduce codegen-units (counter-intuitive: more units = more rlibs to combine = more link work, but also more parallelism upstream — there's a tradeoff). r6 noted `LTO=off` brought 2h 47m → ~3 min in their wish. That bound is for *warm* cache only; cold cache with sccache empty is still 30-60 min for compilation + 3 min for link.
- **Sticky cache vs. correctness.** If we freeze LTO=off and a rebase upstream adds inline-cross-crate-required code, the binary will be ~5-15% larger and ~3-8% slower at runtime. Acceptable for iteration; CI release build keeps LTO=thin to match the published binary.
- **Job-count OOM regression.** jobs=6 with LTO=off on 64GB — peak RSS during parallel `rustc` is mostly bounded by the largest crate, not the sum (codegen-units=16 means each crate spawns up to 16 LLVM threads). Likely safe but needs empirical verification per Plan story US-3.
- **Path length on Windows (MAX_PATH).** SCCACHE_DIR on D: keeps depth ≤ ~30 chars, well under 260. Safe.
- **Antivirus locks.** Defender scanning `D:\codex-sccache\*` on every miss/store could erase the wins. Plan story US-1 includes a Defender exclusion-folder recommendation (operator runs `Add-MpPreference -ExclusionPath D:\codex-sccache`).
- **No effect on CI release builds.** Iteration profile is local-iteration scoped; CI keeps the existing `publish-npm.yml` env-vars unchanged so the published binary's optimization level is unchanged.

## Suggestions (synthesized from Codex + Copilot research)

Both Codex and Copilot independently converged on:
1. Single PR for docs + scripts + env snippets (tightly coupled).
2. Canonical location for the frozen profile = `publish-sandbox-patch.md`.
3. SCCACHE_DIR on D:.
4. `CARGO_INCREMENTAL=0` explicitly.
5. Don't oversell sccache for env-var thrash — it survives jobs changes but NOT LTO/debuginfo changes. The real fix is "sccache + freeze."
6. Benchmark methodology: cold/warm/jobs-only/LTO-change matrix; expect only the last category to miss by design.
