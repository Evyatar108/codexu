# Rollback procedure — `ai-developer-toolkit` submodule integration

This document is the **operator runbook** for backing out the
`ai-developer-toolkit` submodule integration shipped under task
`ai-developer-toolkit-submodule` (`.ralph/jobs/ai-developer-toolkit-submodule/`)
if a regression appears after merge to `main`.

It applies to the `ai-developer-toolkit/` submodule only. The `codex/`
submodule is unaffected by this rollback — its own rollback story (if ever
needed) lives separately in the codex rebase docs.

## When you would use this

- A plugin version pinned via the submodule SHA introduces a regression on
  every consumer machine that runs `pnpm overview`, `pnpm sync-ralph-state`,
  or any crews `spawn-member` / `stop-member` flow.
- The CI invariant check in `tools/check-toolkit-submodule-invariants.mjs`
  (US-006) starts to fail on `main` after a submodule pointer bump landed
  without the matching `AGENTS.md` "Active plugin versions" table update,
  and the cause cannot be unblocked by a forward-fix commit within the
  expected response window.
- `git submodule update --init` reliably fails on a fresh clone (for example,
  the remote URL becomes inaccessible) and the cost of waiting for an
  upstream fix exceeds the cost of temporarily reverting to the
  sibling-checkout flow.

For ordinary plugin bugs, prefer a forward fix: bump the submodule pointer
to a fixed plugin SHA and update the `AGENTS.md` "Active plugin versions"
table in the same codexu commit. The rollback below is the emergency exit,
not a routine response to plugin churn.

## Commits to revert

The integration landed as a single `chore: add ai-developer-toolkit submodule`
commit (US-001) plus several US-002..US-006 commits that **only edit codexu
files** (resolver wrapper, `.claude/settings.json`, `.mcp.json` deletion,
AGENTS.md / README rewrites, `.agents/memory` + `plans/*` path rewrites,
`.ralph-overview/data.json` prompts, CI invariant tooling). The US-007 ship
adds this rollback doc and the smoke-test transcript.

When the integration is on `main`, identify the load-bearing commits with:

```powershell
# From D:/harness-efforts/codexu (lead's primary checkout, on main).
# Adjust the date range or scope as needed.
git log --oneline --grep='ai-developer-toolkit-submodule\|US-00[1-7]' main
```

For a **clean rollback** that restores the full pre-integration state of
the codexu tree (docs, prompts, CI invariant, resolver wrapper fallback,
everything), revert the full integration cluster on `main`:

```powershell
# In order: revert from newest to oldest so each revert applies cleanly.
git revert <US-007 ship commit>      # this doc + smoke-test.md (small)
git revert <US-006 commit>           # tools/check-toolkit-submodule-invariants.mjs + workflow
git revert <US-005 commit>           # .ralph-overview/data.json prompts
git revert <US-004 commit>           # .agents/memory + plans/*.md rewrites
git revert <US-003 commit>           # AGENTS.md + README.md
git revert <US-002 commit>           # bin/ralph-overview.mjs + .mcp.json + .claude/settings.json
git revert <US-001 commit>           # the submodule-add itself
```

The integration was shipped via `--no-ff` merges into a per-story branch,
then a final integration merge, then a single `--ff-only` to `main`. If the
integration landed on `main` as a merge commit `M`, you can roll back with
`git revert -m 1 M` to revert the entire merge in one shot, then push the
resulting revert commit.

Resolve any expected revert conflicts in `.ralph-overview/data.json` by
keeping the post-revert (old) form of every conflict block — the path
rewrites in US-005 were idempotent string replacements and the inverse
applies the same way.

> **Submodule-add-only rollback is NOT a supported shortcut.** Reverting
> US-001 in isolation leaves the AGENTS.md "Active plugin versions" table
> and the US-006 CI invariant workflow on `main` while the submodule
> itself is gone, which immediately breaks the CI invariant check
> (`tools/check-toolkit-submodule-invariants.mjs` expects `.gitmodules` +
> the gitlink to exist) and leaves the operating-manual docs (US-003) and
> path rewrites (US-004/US-005) describing an in-tree submodule that no
> longer exists. If you intentionally want a partial rollback (for
> example, to test the revert sequence on a scratch branch), revert
> US-001 + US-006 together as the minimum coherent pair and accept the
> doc/prompt drift in US-002..US-005 as a known temporary state. The full
> seven-commit revert above is the safe default.

## Step-by-step rollback

These steps assume you are on the **lead's primary codexu checkout**
(`D:/harness-efforts/codexu`) on `main`, with a clean working tree.

The deinit step happens **before** the revert, not after — `git submodule
deinit` resolves the submodule path against `.gitmodules`, and once
`git revert` strips that stanza the deinit call fails with `fatal: no
submodule mapping found in .gitmodules for path 'ai-developer-toolkit'`.

```powershell
# 0. Verify clean working tree + clean toolkit submodule worktree.
cd D:/harness-efforts/codexu
git status                                  # should report nothing to commit
git -C ai-developer-toolkit status --short  # MUST be empty — destructive cleanup follows.
                                            # If non-empty, stash/commit/push those edits
                                            # to your operator-personal toolkit remote
                                            # FIRST: `Remove-Item -Recurse -Force ai-developer-toolkit`
                                            # below will destroy any uncommitted submodule changes.
git fetch --all --prune

# 1. Identify the integration merge commit on main (or the list of US-001..US-007
#    commits if they landed as direct commits rather than a merge).
git log --oneline --grep='ai-developer-toolkit-submodule' main

# 2. Deinit the submodule FIRST, while `.gitmodules` still maps the path.
#    -f forces deinit even when the submodule has uncommitted changes
#    (Step 0's preflight is how you avoid losing those silently).
git submodule deinit -f -- ai-developer-toolkit

# 3. Revert. Pick ONE of the two patterns:
#    a) Single merge commit M:
git revert -m 1 <M>
#    b) Sequence of commits, newest-first:
git revert <US-007-sha> <US-006-sha> <US-005-sha> <US-004-sha> <US-003-sha> <US-002-sha> <US-001-sha>

# 4. Clean up the residual working-tree dir + the gitlink storage left over
#    after deinit + revert. Both are safe to delete at this point: the
#    submodule is no longer registered (deinit) and no longer pointed at
#    (revert).
Remove-Item -Recurse -Force ai-developer-toolkit
Remove-Item -Recurse -Force .git/modules/ai-developer-toolkit

# 5. Verify the tree is back to the pre-integration shape.
git status                                  # clean (or has expected revert deltas)
Test-Path ai-developer-toolkit              # should be False
Get-Content .gitmodules -ErrorAction SilentlyContinue   # no ai-developer-toolkit entry

# 6. Push the revert.
git push origin main
git push personal main                       # if the personal remote is configured

# 7. Restore the sibling-checkout development flow for plugin work
#    (this is what existed BEFORE the integration; the wrapper falls back to
#    it via the legacy local-dev path — see "Plugin resolution restored
#    behavior" below):
cd D:/
gh repo clone evmitran_microsoft/ai-developer-toolkit     # re-clone sibling
cd ai-developer-toolkit
git remote add personal https://github.com/Evyatar108/ai-developer-toolkit.git
git remote add gim-home https://github.com/gim-home/ai-developer-toolkit.git
git fetch --all --prune
git checkout main
git reset --hard origin/main

# 8. Reinstall plugin dependencies in the sibling checkout so the wrapper's
#    legacy local-dev path resolves cleanly (the wrapper requires
#    node_modules/chokidar to consider an install "usable"). The toolkit
#    plugins use npm workspaces, so use npm install (pnpm gets captured by
#    codexu's pnpm-workspace.yaml if invoked from a codexu subdir).
cd D:/ai-developer-toolkit/plugins/ralph-overview
npm install
# crews has no package.json today; skip npm install there.
cd D:/harness-efforts/codexu
pnpm sync-ralph-state                       # should exit 0 against the sibling path
```

## Plugin resolution restored behavior

The wrapper (`bin/ralph-overview.mjs`) is intentionally
**revert-tolerant** at the missing-submodule level: `existsPluginAt(localDev)`
gracefully returns false when the in-tree submodule dir is gone, and the
cascade falls through to whichever earlier step resolves. The wrapper's
resolution cascade is:

1. `$RALPH_OVERVIEW_PLUGIN_ROOT` env var
2. `$CLAUDE_PLUGIN_ROOT/ralph-overview` (Claude Code harness-set)
3. `$CLAUDE_PLUGIN_ROOT/cache/ai-developer-toolkit/ralph-overview/<latest>`
4. `~/.claude/plugins/cache/ai-developer-toolkit/ralph-overview/<latest>`
5. `~/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/`
6. `<repo>/ai-developer-toolkit/plugins/ralph-overview/` (script-relative
   in-tree submodule fallback)

The behavior after rollback depends on **which** rollback you ran:

- **Full rollback (US-001 through US-007 all reverted).** The wrapper's
  step-6 fallback is restored to its pre-integration `D:/ai-developer-toolkit/...`
  hard-coded form by the US-002 revert, and the legacy sibling checkout
  works automatically without operator env-var setup. Steps 2-5 of the
  cascade keep working as before (the integration never touched them).

- **Submodule-only or partial rollback (US-001 reverted, US-002 still in
  place).** Step 6 is the post-US-002 script-relative form that points at
  the now-missing in-tree submodule. `existsPluginAt(step6)` cleanly
  returns false, but there is no automatic legacy-sibling fallback at the
  wrapper level — the cascade either succeeds via an engine install (steps
  2-5) or fails with the friendly "could not locate the ralph-overview
  plugin" stderr message. Restore the sibling-checkout behavior by setting
  `RALPH_OVERVIEW_PLUGIN_ROOT=D:/ai-developer-toolkit/plugins/ralph-overview`
  (cascade step 1) in the operator's shell profile.

The historical guidance for the sibling-checkout flow is preserved in the
codexu-wrapper-retirement smoke-test record
(`.ralph/jobs/codexu-bin-ralph-overview-wrapper-retirement/smoke-test.md`),
which demonstrates the wrapper resolving to the legacy sibling path via the
env override. That record is the operator's reference for "what worked
before" if the rollback is staged as part of a longer investigation.

## What the rollback does NOT do

- **It does not delete operator data.** `.ralph-overview/data.json`,
  `.ralph/jobs/`, `.ralph/brainstorms/`, `.crews/`, `plans/`, generated
  sidecars, and crew member manifests are untouched. Revert only flips the
  tracked submodule pointer + the codexu-side text rewrites.
- **It does not modify any toolkit-side history.** The toolkit's own repos
  (`evmitran_microsoft/ai-developer-toolkit`,
  `Evyatar108/ai-developer-toolkit`, `gim-home/ai-developer-toolkit`) are
  read-only from codexu's perspective. Nothing in this procedure pushes to
  any toolkit remote.
- **It does not require a force-push.** Every step appends a new revert
  commit and pushes through normal fast-forward semantics.
- **It does not require operator credentials beyond `gh auth status`.**
  Re-cloning the sibling checkout in step 6 uses the operator's existing
  GitHub credentials for `evmitran_microsoft`.

## Post-rollback checklist

After the revert has propagated to `origin/main`, walk through the checklist
once on any machine that pulled the post-integration `main`:

- `pnpm sync-ralph-state` from `D:/harness-efforts/codexu` exits 0 and
  regenerates `.ralph-overview/generated/snapshot.json` with a new
  `generatedAt`. If it exits non-zero with
  `bin/ralph-overview.mjs: could not locate the ralph-overview plugin`, set
  `RALPH_OVERVIEW_PLUGIN_ROOT=D:/ai-developer-toolkit/plugins/ralph-overview`
  per the cascade above and re-run.
- The Copilot CLI session can still load skills (the marketplace install at
  `~/.copilot/installed-plugins/...` is independent of the codexu
  submodule).
- The bookkeeper crew can still spawn members:
  `node ai-developer-toolkit/plugins/crews/tools/crews.js` no longer
  resolves locally, so spawn from the sibling checkout instead:
  `node D:/ai-developer-toolkit/plugins/crews/tools/crews.js spawn-member ...`.
- The CI invariant check workflow
  (`.github/workflows/toolkit-submodule-invariant.yml`) is also reverted as
  part of US-006; verify it is gone or disabled in `main`'s workflow set.

If any step fails, capture the failure mode in
`.ralph/investigations/<short-name>/findings.md` and surface the rollback
result as a new tracked overview task before continuing.

## Related references

- `AGENTS.md` "Plugin resolution" block — describes the cascade above and
  is itself reverted as part of US-003 when the integration is rolled back.
- `AGENTS.md` "Active plugin versions" — the CI invariant's source of
  truth; the table is removed by the US-003 revert.
- `tools/check-toolkit-submodule-invariants.mjs` — the CI invariant script
  shipped in US-006; removed by the US-006 revert.
- `.ralph/jobs/ai-developer-toolkit-submodule/smoke-test.md` — the
  end-to-end smoke transcript that demonstrates what the integration looks
  like when it works, including the operator-approved pin SHA
  `d7e01874385c13e7e833a6935d7de11ea2e565f7`.
- `.ralph/jobs/codexu-bin-ralph-overview-wrapper-retirement/smoke-test.md`
  — the prior smoke run for the wrapper itself, which demonstrates the
  sibling-checkout fallback path.
