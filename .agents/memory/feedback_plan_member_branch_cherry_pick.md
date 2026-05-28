---
name: feedback-plan-member-branch-cherry-pick
description: "Plan-phase members commit to whatever branch the lead's cwd is on; lead cherry-picks to main rather than asking member to switch branches."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

When spawning a plan-<task> member from a lead session whose `cwd` is on a non-main branch (e.g. `ralph/plugin-scope-agents-v2` left over from a prior impl), the member CANNOT cleanly switch the branch of the lead's working tree to commit `.ralph/jobs/<task>/plan.md` to main — doing so would disrupt the lead's concurrent state and any other in-flight members reading from the same cwd.

**Why:** 2026-05-26 incident — `plan-overview-data-dynamic-stages-schema` correctly committed plan artifacts (10 files, plan.md 422 lines) to the lead's current branch `ralph/plugin-scope-agents-v2` as commit `3b646b50` and flagged the divergence from the spawn prompt's "push to origin/main" instruction. The lead cherry-picked to main as `b258713e` via the `D:/harness-efforts/codexu-plans-view` worktree and pushed cleanly.

**How to apply:**

1. **Spawn prompt:** for plan-phase members, write the instruction as "commit + push to wherever your `cwd` is checked out; lead will cherry-pick to main." Don't say "push to origin/main" — the member can't safely change the working tree's branch.

2. **Post-member cherry-pick:** when a `plan-<task>` member ships `kind=done`, the lead's wrap-up flow is:
   - Verify the plan commit on the lead's current branch via `git show --stat <sha>`
   - `cd` to the `codexu-plans-view` worktree (which IS on main) and run `git cherry-pick <plan-sha>`
   - Push to origin/main from the plans-view worktree
   - Then stop the member cleanly via `/crews:stop-member`

3. **Why not switch the lead to main:** the lead's cwd has `.crews/` and `.ralph/jobs/<other-task>/` state read by sibling members. A `git checkout main` mid-session could leave stale files or remove worktree state. Cherry-pick from a sibling worktree is safer.

4. **Long-term fix:** the lead's session should ideally be checked out on main when no impl is in flight. Bookkeeper should switch to main between impl cycles — but this requires verifying no sibling members are reading the lead's worktree.

See also [[feedback-worktree-update-ref-trap]] (different worktree-related trap: don't use `git update-ref` to fast-forward; use `git merge --ff-only` from inside the worktree).
