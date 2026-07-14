# Job: codex-v2-copilot-encrypted-subagent-handoff-prd-a

**Repo:** D:/harness-efforts/codexu/codex/.worktrees/codex-v2-copilot-encrypted-subagent-handoff/external/repos/codex-patched
**Description:** Provider-aware V2 handoff and exact race-safe wait in the externally managed nested codex-patched checkout.
**Worktree:** D:/harness-efforts/codexu/codex/.worktrees/codex-v2-copilot-encrypted-subagent-handoff/external/repos/codex-patched

## Job-Specific Instructions

- Implement only the three serial source stories mapped to A-001, A-002, and A-003.
- Write only the 16 paths in `prd.json.writeScope`; wrapper overlay/docs in `additionalDirs` are read-only.
- Preserve nested base `587a6a8ab8948ff912b1f24a62833b277934302d` and wrapper context `89a6cbea7cd382fa4873b259fb996dcf988a5fdc` as immutable inputs.
- Do not create or delete a worktree. The configured worktree is external and required for the wrapper-relative Cargo workspace.
- Do not push, tag, release, install, edit codexu or wrapper files, or modify `codex-rs/Cargo.toml` or `codex-rs/Cargo.lock`.
- Use `just test`, never direct `cargo test`, and keep expensive logs in project-relative evidence directories.

## Cleanup

To remove this job:
1. Delete this directory: `D:/harness-efforts/codexu/.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-a`
2. Prune the externally managed worktree only when directed by its owner.
3. If the branch is no longer needed: `git -C D:/harness-efforts/codexu/codex/.worktrees/codex-v2-copilot-encrypted-subagent-handoff/external/repos/codex-patched branch -d ralph/codex-v2-copilot-encrypted-subagent-handoff-source`
