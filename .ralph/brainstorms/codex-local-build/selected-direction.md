## Direction
D-001 — Overlay-coordination audit guard + spawn-preflight (architecture fix). Generalize `scripts/audit_invariants.sh` and add a `cargo metadata` preflight so a submodule pin can never reference a missing `codex-rs-overlay/<crate>/` again, converting an ad-hoc "this branch happens to be broken" experience into a CI-enforced invariant.

## Goal
After this lands, any submodule HEAD that references a `../../../../codex-rs-overlay/<name>` workspace member or `[workspace.dependencies]` path entry whose directory does not exist in the parent fork is rejected at CI invariant-check time, with a clear error pointing to the missing overlay path. A `scripts/codex_workspace_preflight.sh` is callable locally (and by orchestrator spawn prompts that touch the codex submodule) to surface workspace-parse failures in <5 s before any impl work begins. Impl members on a codex-touching task either find the workspace parses cleanly (proceed) or get an actionable error pointing at the parent-fork coordination gap (escalate to operator) — never spending iterations attributing inherited breakage to their own edits.

## Scope

### In Scope
- Extend `scripts/audit_invariants.sh` (currently hard-codes `OVERLAY_CRATE_DIR="codex-rs-overlay/codex-invariant-tests"` at lines 19–20 and only enforces that one overlay) to:
  - Parse `external/repos/codex-patched/codex-rs/Cargo.toml` `[workspace].members` for every `../../../../codex-rs-overlay/<name>` entry.
  - Parse `[workspace.dependencies]` for every `<crate> = { path = "../../../../codex-rs-overlay/<name>" }` entry.
  - For each, verify `codex-rs-overlay/<name>/Cargo.toml` exists in the parent worktree.
  - Fail with a clear per-overlay error including the missing path and the offending submodule member/dependency line.
- Add `scripts/codex_workspace_preflight.sh` that runs `cargo metadata --no-deps --format-version 1` inside `external/repos/codex-patched/codex-rs/` and pretty-prints workspace-parse errors (exit non-zero on failure). ~20 lines.
- Wire `codex_workspace_preflight.sh` into the codexu lead-side spawn-prompt template (or a documentation note in `codex/CLAUDE.md` § "Confusion points") so that any spawn touching the codex submodule runs it first.
- Documentation updates:
  - `codex/docs/implementation/patch-surface.md` § 14 — add an invariant row: "Every `codex-rs-overlay/<name>` referenced by the submodule's `Cargo.toml` workspace must have a matching parent-fork directory; enforced by `scripts/audit_invariants.sh`."
  - `codex/CLAUDE.md` "Confusion points and common mistakes" — flag the overlay-coordination invariant and the new preflight script.
  - `D:/harness-efforts/codexu/CLAUDE.md` — flag the preflight script in the bookkeeper workflow as a step before spawning codex-touching impl members.

### Out of Scope
- D-002 (committing the actual `codex-rs-overlay/codex-plugin-scope/` overlay scaffold). That work is presumed to be a deliverable of the lead's in-flight `ralph/plugin-scope-agents-v2` branch; if it isn't, it is a separate ralph job, NOT this one. The audit guard's job is to enforce the invariant, not to fix the current symptom.
- D-003 (sub-2-min `quick-check.yml` Linux GitHub Action). Useful follow-up but architecturally independent; can ship later.
- D-004 (hermetic Windows release-build toolchain bootstrap for contributors). Lower priority because `codex/CLAUDE.md` already establishes release builds are CI's job, and `publish-sandbox-patch.md` documents the env for release operators.
- Updating the stale auto-memory `feedback_codex_fork_no_local_cargo` — that is an operator-facing cleanup, not in the scope of a codex-fork ralph job.
- Refactoring `audit_invariants.sh` beyond the overlay-enumeration extension. The script has accreted other checks; this work touches only the overlay-membership section.

## Criteria
- **AC-1 (guard fires on current branch):** Running `bash scripts/audit_invariants.sh` from `D:/harness-efforts/codexu/codex` while the codex submodule is on `feature/launcher-additional-instructions` (which references `codex-rs-overlay/codex-plugin-scope/`) AND that directory is absent from the parent fork → exit code non-zero, error message names the missing path explicitly.
- **AC-2 (guard does not fire on clean state):** Running the same script after the submodule is reset to `origin/main` pin (`a13689049991cb585698c515ca85d41ae44143ef`, which does NOT reference the missing overlay) → exit code 0.
- **AC-3 (guard does not fire when overlay exists):** Manually creating a stub `codex-rs-overlay/codex-plugin-scope/Cargo.toml` while the submodule references it → guard passes (the guard checks for existence only; API correctness is `cargo check`'s job).
- **AC-4 (preflight script works):** Running `bash scripts/codex_workspace_preflight.sh` from `D:/harness-efforts/codexu/codex` on the current broken branch → exit non-zero in <10 s, output contains `codex-plugin-scope` and `Cargo.toml`.
- **AC-5 (CI green on main):** `.github/workflows/invariant-check.yml` continues to pass on `origin/main` after the audit extension lands.
- **AC-6 (documentation updated):** `docs/implementation/patch-surface.md` § 14 has the new invariant row; `codex/CLAUDE.md` "Confusion points" mentions the preflight script and the overlay-coordination invariant; `codexu/CLAUDE.md` bookkeeper section references the preflight for codex-touching spawns.

## Context

This brainstorm started with a hypothesis ("local cargo is unavailable on this Windows machine") drawn from auto-memory `feedback_codex_fork_no_local_cargo`. Investigation reproduced the actual build failure and found that hypothesis is stale:

- **`rustup` + `cargo` are installed** at `C:/Users/evmitran/.cargo/bin/`; active toolchain `stable-x86_64-pc-windows-msvc`.
- **`codex/CLAUDE.md` already establishes the policy:** `cargo check --workspace` (~6 min) is the standard typecheck gate; `cargo test --workspace` and `cargo build --release` are CI's job. The infrastructure exists; only the auto-memory framing was wrong.
- **The actual reproduced first error is NOT a missing toolchain:**
  ```
  failed to read `D:\harness-efforts\codexu\codex\codex-rs-overlay\codex-plugin-scope\Cargo.toml`
  Caused by: The system cannot find the path specified. (os error 3)
  ```
- **This is a transient mid-flight coordination artifact.** The codex-patched submodule (branch `feature/launcher-additional-instructions`, 5 commits ahead of its origin) advanced its `[workspace].members` to reference `codex-plugin-scope` (submodule commit `31ef20977 feat: [US-001] - Scaffold codex-plugin-scope overlay crate`), but the matching parent-fork overlay scaffold was never committed. The lead's current branch is `ralph/plugin-scope-agents-v2`, presumably the work-in-progress for that overlay.
- **`origin/main` is clean.** The submodule pin on `origin/main` (`a13689049991cb585698c515ca85d41ae44143ef`) does NOT reference the missing overlay — confirming this is a steady-state non-issue and a mid-flight-only failure.

### Why D-001 over the alternatives

The brainstorm evaluated four candidate directions:

| ID    | Lenses                      | Verdict                                            |
|-------|-----------------------------|----------------------------------------------------|
| D-001 | codex, devils-advocate      | **Recommended.** Architecture fix; prevents class.|
| D-002 | codex, copilot, devils-adv. | Immediate symptom fix; expected to be a separate near-term ralph job (possibly already in-flight on `plugin-scope-agents-v2`). NOT a brainstorm decision. |
| D-003 | copilot, devils-advocate    | Worthwhile follow-up; orthogonal to D-001. Defer.  |
| D-004 | codex, copilot              | Lowest priority. `codex/CLAUDE.md` + `publish-sandbox-patch.md` already cover release-operator needs. |

D-001 wins because:
1. It converts an ad-hoc "I happened to notice the workspace is broken" event into a CI-enforced invariant. Per auto-memory `feedback_fix_architecture_not_workarounds`, when a coordination bug bites in normal multi-session use, fix the architecture; don't paper over symptoms.
2. The existing `audit_invariants.sh` already enforces ONE overlay membership invariant — generalizing it to enumerate ALL overlays from submodule Cargo.toml is a small, well-scoped, low-risk change.
3. The disconfirming evidence from the devils-advocate lens that "a stub overlay won't pass `cargo check`" reinforces that fixing the symptom alone (D-002 done badly) buys little — the audit guard is the durable answer.

### Disconfirming observations to watch for during planning
- If `audit_invariants.sh` cannot reliably parse the submodule's Cargo.toml `[workspace]` block from bash (e.g., TOML quirks, multi-line member arrays), the implementation may need to call out to a small Python or `cargo metadata` helper instead of pure bash awk/grep. Verify the parser robustness against the actual Cargo.toml format on this branch.
- If `cargo metadata --no-deps` itself requires the workspace to parse (which it does), the preflight script's failure mode is "workspace doesn't parse" — same signal but via a different path. That's fine; the two artifacts complement (audit catches the directory-existence invariant; preflight catches anything `cargo metadata` notices, including manifest-syntax errors).
- A future overlay member might be added via `[workspace.dependencies]` only (path dep) without being a `[workspace].members` entry — the guard must handle both shapes.

### Open questions for the planner
1. **Authoritative or advisory?** Should the audit guard's failure block submodule pin bumps (e.g., in CI on pin-bump PRs), or only warn? Authoritative is stronger but blocks legitimate in-flight branches where the overlay scaffold is being added across two commits. **Suggested default:** authoritative in `audit_invariants.sh` (CI fails); preflight in spawn-prompts is informational (operator decides whether to proceed).
2. **Is D-002 owned by `ralph/plugin-scope-agents-v2`?** If the lead's in-flight branch already includes the `codex-plugin-scope` overlay scaffold work, this D-001 ralph job is shippable independently — only the guard. If not, the operator may want to chain D-001's plan with a small "create overlay scaffold" appendix.
3. **Stale-auto-memory cleanup ownership.** The auto-memory `feedback_codex_fork_no_local_cargo` is actively misleading agents. Should retiring/updating it happen here, or be a separate housekeeping task in the bookkeeper-lead session?
4. **Spawn-prompt wiring location.** Should the codex-touching spawn-prompt preflight live in the lead's `crews:spawn-member` template, in a new `codex/scripts/codex_workspace_preflight.sh` referenced by spawn prompts, or as a generic codexu-side step the bookkeeper runs before spawning? Trade-off: centralized in spawn template (one place, harder to forget) vs. decentralized in script (script auditable, can be run by anyone).
5. **Should `cargo metadata` parse-error capture include the failing crate name explicitly?** The current cargo error format chains "Caused by:" messages — the preflight could either dump those raw or post-process them to surface the leaf cause (the missing-directory path). Suggested default: dump raw + flag the last `Caused by:` line as the "leaf error" in a summary line.
