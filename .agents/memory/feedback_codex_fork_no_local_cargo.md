---
name: codex-fork-local-cargo
description: "Codex fork DOES have local cargo. `cargo check --workspace` (~6 min) is the documented typecheck gate; only `cargo build --release` requires CI. The earlier 'no local cargo' framing was stale and actively misled agents."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

**The actual fork build situation** (corrected 2026-05-27 by `brainstorm-codex-local-build`):

- **`rustup` + `cargo` ARE installed** at `C:/Users/evmitran/.cargo/bin/`; active toolchain `stable-x86_64-pc-windows-msvc`.
- **`cargo check --workspace` (~6 min) is the standard typecheck gate** per `codex/CLAUDE.md`. Impl members CAN and SHOULD run it as part of Phase 5a.
- **`cargo test --workspace`** runs in CI per push (`.github/workflows/invariant-check.yml`) — local execution optional.
- **`cargo build --release` IS deferred to CI** for daily iteration. The heavy toolchain (xwin + LLVM clang-cl + lld-link + V8 lib in `~/.cargo/.rusty_v8/`) is only installed by `codex/.claude/commands/publish-sandbox-patch.md` for actual release cuts.

**Why this memory was rewritten:** Earlier 2026-05-25 framing was "local cargo is intentionally unavailable; CI is truth for everything." That was wrong — `cargo check` works fine locally. The earlier framing made impl members reject perfectly valid local Phase 5a verification, deferring class-of-bug detection to a CI cycle that only runs on push. The just-shipped `impl-codex-sandbox-setup-release` member followed the old framing and produced 8 file changes without running `cargo check` once — relying entirely on Claude+Copilot text review for correctness of Rust workflow edits.

**How to apply when spawning codex-touching members:**

1. **DO require `cargo check --workspace` green as Phase 5a verification** for any codex-Rust change. ~6 min, acceptable cost.
2. **DO NOT require `cargo build --release` green locally** — that needs the heavy publish-sandbox-patch toolchain; defer to CI on push.
3. **Before spawning, run a workspace preflight** to detect mid-flight overlay-coordination gaps that bite specific branches:
   ```
   cd D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs
   cargo metadata --no-deps --format-version 1 >NUL 2>&1
   ```
   Non-zero exit = the current branch has a missing overlay scaffold (or other workspace-parse failure). Impl members on this branch will burn iterations attributing inherited breakage to their own edits. Surface to operator. (Until the `codex-local-build` D-001 audit-guard ships, this preflight is manual.)
4. **`origin/main` always parses cleanly** — feature-branch overlay-coordination gaps are mid-flight artifacts, not steady-state issues.

**Known mid-flight branch issue (2026-05-27):** `codex/feature/launcher-additional-instructions` (referenced by codexu's current submodule pointer on `ralph/plugin-scope-agents-v2`) advanced its `[workspace].members` to reference `codex-rs-overlay/codex-plugin-scope/Cargo.toml` whose scaffold landed via the lead's parent-fork commits but verification of the overlay materialization is still in progress. Impl members on this branch may hit the workspace-parse failure before that overlay scaffold lands in the right commit on this submodule pointer.

See also [[feedback-fix-architecture-not-workarounds]] (why D-001 audit-guard wins over D-002 stub-the-scaffold), [[feedback-crews-spawn-state-cwd-override]] (spawn flag).
