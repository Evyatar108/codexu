---
name: feedback-worktree-update-ref-trap
description: "When using `git update-ref refs/heads/<branch>` to fast-forward a branch, never commit from a worktree on that branch without first updating its working tree."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

When fast-forwarding a branch via `git update-ref refs/heads/<branch> <new-sha>` (e.g., to merge a ralph feature branch to main), the worktree's **HEAD pointer auto-moves** but the **working tree files do NOT update**. Any subsequent `git add` + `git commit` from that worktree will record a diff between the new HEAD's tree and the stale working tree — typically appearing as massive deletions of files added by the fast-forwarded commits.

**Why:** 2026-05-26 incident. I fast-forwarded codexu/main to v2's HEAD (`9d89ca43`) via `git update-ref refs/heads/main 9d89ca43 && git push origin main`. Then I edited `overview-data.js` in the `codexu-plans-view` worktree (which I'd created earlier on main when main was at `e1aef923`). The worktree's HEAD had silently moved to `9d89ca43` but its working tree files were still at `e1aef923`. My `git add overview-data.js` and commit produced a 19-file / 855-deletion diff, effectively reverting all of v2's added files. Required a `git revert` recovery commit to fix origin/main.

**How to apply:**
- After any `git update-ref` on a branch checked out in a worktree, IMMEDIATELY run `git -C <worktree> checkout <sha> -- .` to refresh the working tree, OR `git -C <worktree> reset --hard <sha>`.
- Better: avoid `git update-ref` for branch fast-forwarding altogether. Use `git -C <worktree> merge --ff-only <sha>` from a worktree on that branch, OR check out a fresh worktree on the new HEAD.
- For ralph-overview bookkeeper workflow: after fast-forwarding main to a ralph branch HEAD, run `git -C <bookkeeping-worktree> pull --ff-only` BEFORE editing overview-data.js. The "Already up to date" response means the ref was already at the target, but the working tree may not be — verify with `git status` showing no diff before committing.
- Prefer `git switch main` + `git merge --ff-only <branch>` from a worktree dedicated to bookkeeping; the worktree's working tree auto-updates as part of the merge.

See also [[feedback-bookkeeper-updates-overview-data]] (the rule this fix-up was carrying out when it went wrong).
