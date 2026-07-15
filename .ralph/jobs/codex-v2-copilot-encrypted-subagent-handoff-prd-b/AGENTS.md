# Job: codex-v2-copilot-encrypted-subagent-handoff-prd-b

**Repo:** D:/harness-efforts/codexu/codex
**Description:** Codex wrapper invariants, documentation, and static GitHub Release readiness.
**Worktree:** D:/harness-efforts/codexu/codex/.worktrees/codex-v2-copilot-encrypted-subagent-handoff

## Job-Specific Instructions

- Implement only the two serial wrapper stories mapped to B-001 and B-002.
- Write only the eight paths in `prd.json.writeScope`; `external/repos/codex-patched/**` is read-only context.
- Preserve wrapper base `89a6cbea7cd382fa4873b259fb996dcf988a5fdc`, predecessor receipt SHA-256 `46a311b9c6a46972a06d0eb8d3a51de2b52bb49ac4e9e6c579f620bce5753c70`, and nested final SHA `6d73e16c44d65ac243834a942d7fab2c3b279221` as immutable inputs.
- Do not create or delete a worktree. The configured wrapper worktree is external and required.
- Do not stage or commit the nested gitlink, modify nested source, push, tag, release, install, run dogfood, or edit codexu outside this Ralph job directory.
- Use `just test`, never direct `cargo test`, and keep expensive logs in project-relative evidence directories.

## Cleanup

To remove this job:
1. Delete this directory: `D:/harness-efforts/codexu/.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-b`
2. Prune the externally managed worktree only when directed by its owner.
3. If the branch is no longer needed: `git -C D:/harness-efforts/codexu/codex branch -d ralph/codex-v2-copilot-encrypted-subagent-handoff`
