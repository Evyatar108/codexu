# Brainstorm synthesis — codex-local-build

Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

## Reproduced build error (grounding evidence)

```
cd D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs
cargo build --release --bin codex
```

```
error: failed to load manifest for workspace member `.../codex-rs/analytics`
referenced by workspace at `.../codex-rs/Cargo.toml`
Caused by: failed to load manifest for dependency `codex-login`
Caused by: failed to load manifest for dependency `core_test_support`
Caused by: failed to load manifest for dependency `codex-arg0`
Caused by: failed to load manifest for dependency `codex-linux-sandbox`
Caused by: failed to load manifest for dependency `codex-core`
Caused by: failed to load manifest for dependency `codex-plugin-scope`
Caused by: failed to read `D:\harness-efforts\codexu\codex\codex-rs-overlay\codex-plugin-scope\Cargo.toml`
Caused by: The system cannot find the path specified. (os error 3)
```

## Reframed problem

The starting framing (per auto-memory `feedback_codex_fork_no_local_cargo`) said "local cargo is unavailable on this Windows machine." All three lenses agree this framing is **stale**:

- `rustup` + `cargo` are installed; LLVM clang-cl + xwin + rusty_v8 lib are documented in `publish-sandbox-patch.md` for release builds.
- `codex/CLAUDE.md` already establishes `cargo check --workspace` (~6 min) as the iteration gate and `cargo test --workspace` + `cargo build --release` as CI's job. The infrastructure exists; the policy is documented.
- The actual reproduced error is **not** missing toolchain — it is `codex-rs-overlay/codex-plugin-scope/Cargo.toml` not existing on disk. The codex-patched submodule (`feature/launcher-additional-instructions`, 5 commits ahead) advanced its workspace to reference `codex-plugin-scope` (commit `31ef20977 feat: [US-001] - Scaffold codex-plugin-scope overlay crate`) before the matching parent-fork overlay was committed. Devil's advocate confirms: on `origin/main` the submodule pin (`a13689049`) does NOT reference the missing overlay. This is a transient mid-flight coordination artifact, not a steady-state local-build policy issue.

The right question is **not** "how do impl members verify Rust changes locally?" (the codex CLAUDE.md already answers: `cargo check --workspace`). The right question is **"how do we prevent the submodule HEAD from advancing past a Cargo.toml-shaped contract with the parent before the matching parent scaffold lands?"**

### Two problem classes

- **P1 — workspace parseability.** Blocks `cargo metadata`, `cargo check`, `cargo build` equally. The current branch's blocker. Solution surface: coordination/scaffolding, not toolchain.
- **P2 — release-build parity.** Downstream of P1. Requires LLVM + xwin + rusty_v8 lib (documented in `publish-sandbox-patch.md`). Already understood by the team to be CI's job per `codex/CLAUDE.md`.

The brainstorm-prompt-original A–G alternatives all silently assumed P2 was the bottleneck. Investigation says the bottleneck is P1 and a stale auto-memory.

## Critical disconfirming evidence (from devils-advocate)

A stub-only `codex-plugin-scope` scaffold WILL NOT make `cargo check --workspace` pass. The submodule already calls these APIs at known sites:

- `core/src/tools/handlers/multi_agents_common.rs:243` — `codex_plugin_scope::apply_subagent_plugin_filter(&mut config)`
- `core/src/tools/handlers/multi_agents_common.rs:248` — `impl codex_plugin_scope::Config for Config`
- `core/src/tools/handlers/multi_agents_tests.rs` — 4 sites calling `codex_plugin_scope::parser::clear_manifest_cache_for_tests()`

An API-faithful stub (with `Config` trait, `apply_subagent_plugin_filter`, `parser::clear_manifest_cache_for_tests`) is required, or the full implementation from the lead's in-flight `plugin-scope-agents-v2` branch must merge first.

This disconfirms a stub-only approach H ("cargo check is enough once P1 is fixed"). A faithful overlay is needed.

## Candidate directions

### D-001: Overlay-coordination audit guard + spawn-preflight (architecture fix)
- Contributing lenses: [codex, devils-advocate]
- Why this might work: Generalize `scripts/audit_invariants.sh` (currently hard-codes a single `OVERLAY_CRATE_DIR="codex-rs-overlay/codex-invariant-tests"` at line 19) to parse the submodule's `Cargo.toml` `[workspace].members` for ALL `../../../../codex-rs-overlay/<name>` entries, and verify each `<name>/Cargo.toml` exists. Optionally add a `scripts/codex_workspace_preflight.sh` that runs `cargo metadata --no-deps` and surfaces parse errors — invoked at the top of any spawn-prompt touching the codex submodule. CI already runs `audit_invariants.sh`, so this becomes a per-push guard with zero local-toolchain cost.
- Risks / friction: The guard catches missing-directory regressions but not API-shape regressions (a directory can exist but its source can be missing types the submodule calls). It's necessary-but-not-sufficient. Per-spawn preflight adds 5–10s to spawn time. Adding the guard requires reading submodule Cargo.toml at audit time — straightforward but new for that script.
- Cheapest validation: Edit `audit_invariants.sh` to enumerate `codex-rs-overlay/*` members from submodule `Cargo.toml`. Run on `origin/main` (must pass). Check out current branch (`plugin-scope-agents-v2`) — must fail with a clear pointer to `codex-plugin-scope` missing. ~30 min to implement; immediate signal.
- Disconfirming observation: A guard passes a fresh checkout but a submodule commit still lands referencing wrapper-owned APIs that don't compile because the directory exists with stub-only sources. (Mitigation: pair guard with `cargo check --workspace` Phase 5a, or extend guard to also probe API signatures via `cargo metadata` parse.)

### D-002: Commit faithful `codex-plugin-scope` overlay scaffold + ratify cargo check as Phase 5a gate (immediate fix)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Unblocks the immediate workspace-parse failure by creating `codex-rs-overlay/codex-plugin-scope/Cargo.toml + src/lib.rs + src/parser.rs` with API-faithful stubs matching the call sites in `multi_agents_common.rs:243,248` and `multi_agents_tests.rs`. Pattern: mirror `codex-rs-overlay/codex-copilot/Cargo.toml` (workspace pointer + workspace-inherited package fields). Then update auto-memory (`feedback_codex_fork_no_local_cargo` → contradict, retire, or update) and ensure spawn prompts for codex-touching tasks include "run `cargo check --workspace` from `external/repos/codex-patched/codex-rs/` as Phase 5a" — codex CLAUDE.md already documents this as the standard gate but the auto-memory is wrong.
- Risks / friction: "Faithful stub" walks a line — if the stub diverges from what `plugin-scope-agents-v2` is building, the eventual merge has friction. Better if the lead's in-flight branch ships its overlay first and this brainstorm waits on it. Codex CLAUDE.md flags `cargo check --workspace` takes ~6 min — still under any reasonable Phase 5a budget but not a 2-min ping.
- Cheapest validation: After scaffolding, run `cd D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs && cargo check --workspace`. Must complete green in <10 min on this Windows box (LLVM + xwin already staged per `publish-sandbox-patch.md` Preconditions).
- Disconfirming observation: Even with the faithful overlay scaffold in place, `cargo check --workspace` bottoms out on a rusty_v8 / V8 lib dependency that isn't fetched on this machine — implying P2 deps DO leak into `cargo check`, not just `cargo build --release`. (Cheapest probe: try the build today, see what happens after just the overlay fix.)

### D-003: Sub-2-min PR-time `cargo check` GitHub Action (CI-as-source-of-truth done right)
- Contributing lenses: [copilot, devils-advocate]
- Why this might work: `invariant-check.yml` runs `cargo test --workspace` with a 6h ceiling — exhaustive but slow. Add a `quick-check.yml` that does `cargo check --workspace` on `ubuntu-latest` only (Linux skips xwin + V8 native-lib hassle for most crates; identify which crates need to be `--exclude`d), targets the typo-class regressions the brainstorm worries about, and runs in <5 min. Block merge on this fast check. Then the local-vs-CI tradeoff resolves: `cargo check` is for impl-member's own machine when they want sub-min feedback; CI's quick-check.yml is the binding signal for everyone else. Zero local-install commitment.
- Risks / friction: Some crates may transitively require `rusty_v8` (the `core-plugins` crate is the suspect — the `boa-engine`/`rusty_v8` dependency drives the heavy build path). If `--exclude` doesn't actually skip a dep because of `[workspace.dependencies]` resolution, the quick-check approach falls back to full build cost. Empirical test required.
- Cheapest validation: On a Linux machine (e.g., a Codespace or a temporary GitHub Action run), execute `cargo check --workspace --exclude codex-core-plugins --exclude codex-cli` (or similar minimal exclude set) in the submodule and measure: (a) does it complete? (b) in how long? (c) does it catch a deliberately-introduced typo in `core/`?
- Disconfirming observation: The quick-check workflow takes >5 min in practice OR doesn't catch the typo class the slow `cargo test --workspace` does — meaning the existing 6h invariant-check is necessary and the gap is unfixable via faster checks alone.

### D-004: Hermetic Windows release-build bootstrap for contributors (P2-only, release-operators-only)
- Contributing lenses: [codex, copilot]
- Why this might work: Some contributors (release operators, anyone debugging a release-only regression) need full `cargo build --release` parity locally. Package the `publish-sandbox-patch.md` preconditions (xwin splat, LLVM, rusty_v8 cached lib) into a `scripts/setup_windows_release_toolchain.ps1` script + verification probe. Document in `docs/workflows/install.md`. Lower priority than D-001/D-002/D-003 because codex CLAUDE.md already establishes release builds are CI's job for iteration.
- Risks / friction: ~5–10 GB install footprint per machine; per-worktree replication cost. Most impl members never need it. Risk of script rot vs. publish-sandbox-patch.md drift.
- Cheapest validation: Run the existing `publish-sandbox-patch.md` step-1 setup on a fresh machine; time it. If <60 min and reliable, packaging it as a script is incremental work. If >60 min or version-sensitive (xwin/V8 pin drift), it's worth investing in caching/version-pinning first.
- Disconfirming observation: Setup script breaks on next contributor's machine because of version-pin drift, or the release build remains too slow (>30 min) to be useful for routine iteration verification — meaning release parity is fundamentally a CI-only concern and contributor-facing infrastructure is wasted effort.

## Recommendation

Hybrid D-001 + D-002 + D-003, in that order of leverage, with D-004 deferred:

1. **D-002 (commit overlay scaffold) is the immediate unblocker** — the current branch literally cannot compile until `codex-rs-overlay/codex-plugin-scope/` exists. This is a near-term ralph job, possibly already in-flight on `plugin-scope-agents-v2`.
2. **D-001 (audit-guard generalization) is the architecture fix** — per auto-memory `feedback_fix_architecture_not_workarounds`, when a coordination bug bites, fix the architecture. Generalize the audit script so this class of regression never repeats for any future overlay crate. ~30 min ralph job.
3. **D-003 (sub-2-min CI quick-check) closes the latency complaint** that the original brainstorm worried about — without forcing any local-toolchain commitment. Pairs naturally with codex CLAUDE.md's documented "cargo check is the gate" policy.
4. **D-004 (hermetic release-build for contributors) is deferred** — `codex/CLAUDE.md` and `publish-sandbox-patch.md` already cover what release operators need; impl members don't need it.

`recommendedDirection`: **D-001** — it's the highest-leverage move because it converts an ad-hoc "this branch happens to be broken" experience into a CI-enforced invariant. D-002 is a prerequisite ralph job, not a brainstorm decision.

## Open questions for the planner

1. Should `audit_invariants.sh`'s overlay enumeration be authoritative (block submodule pin bumps that reference missing overlays) or advisory (warn and continue)? Authoritative is stronger but blocks legitimate in-flight branches where the overlay is being added across two commits.
2. Should the matching overlay scaffold for `codex-plugin-scope` be created BY this brainstorm's follow-up plan/impl ralph job, OR is it already a deliverable of the lead's in-flight `plugin-scope-agents-v2` branch? If the latter, this brainstorm waits on that branch and only ships the audit-guard generalization (D-001).
3. Is the lead willing to update auto-memory `feedback_codex_fork_no_local_cargo` to reflect that cargo IS installed and `cargo check --workspace` IS the documented gate? Stale auto-memory is actively contributing to misframing.
4. For D-003 (quick-check.yml), is there appetite for adding a new GitHub Action workflow, or is the preference to extend `invariant-check.yml` with a fast-path job? (The latter avoids workflow proliferation but the former is conceptually cleaner.)
