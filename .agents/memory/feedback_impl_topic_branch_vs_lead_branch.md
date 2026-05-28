---
name: feedback-impl-topic-branch-vs-lead-branch
description: "Impl members should commit to a topic branch off main (per ralph standard), not to the lead's branch. Plan members commit to lead's branch because plans are smaller + the lead can't switch branches mid-plan."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

For **impl-phase** members, the spawn prompt should instruct: create a topic branch off `origin/main` (`ralph/<task-id>`), commit + push there, surface to lead. Lead cherry-picks or merges to main.

For **plan-phase** members, the spawn prompt instructs: commit to the lead's current branch (per [[feedback-plan-member-branch-cherry-pick]]), lead cherry-picks to main.

The two phases have different branch conventions for a reason:
- **Plan members** produce a small artifact (plan.md + research files) and can't easily juggle worktrees inside the lead's working tree. Easier to commit to whatever branch the lead is on.
- **Impl members** use ralph.sh which has its own worktree convention — it expects to operate on a topic branch matching the job name. Trying to commit to the lead's branch breaks the impl workflow's internal assumptions.

**Why:** 2026-05-27 incident. The `impl-session-parent-link-writer` member followed the plan's mandate (topic branch off main) and ignored the spawn prompt's "commit to lead branch" instruction. The plan was right; my spawn prompt overcorrected from the plan-phase pattern.

**How to apply:**

1. **Spawn prompt for impl members:** "Commit to a topic branch off origin/main (e.g. `ralph/<task-id>`). Push. Surface the branch name + commit SHAs in your kind=done report. Lead will cherry-pick to main."

2. **Spawn prompt for plan members:** "Commit to the lead's current branch. Lead will cherry-pick to main via the codexu-plans-view worktree." (Unchanged from [[feedback-plan-member-branch-cherry-pick]].)

3. **Lead's cherry-pick workflow** is identical for both — `cd` to plans-view worktree on main + `git cherry-pick <sha>` + push.

See also [[feedback-plan-member-branch-cherry-pick]] (plan-phase variant), [[feedback-spawn-prompt-must-require-review-fix]] (Phase 5a/5b mandate; orthogonal to branch convention).
