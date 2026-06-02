# Stories Outline: Integrate ai-developer-toolkit as a git submodule of codexu

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Pre-flight sync + submodule add
**Description:** As the bookkeeper, I want the ai-developer-toolkit added as a git submodule of codexu at an operator-confirmed SHA so that codexu can version-pin its toolkit dependency without violating the AGENTS.md "ask before push" rule.

**Acceptance Criteria:**
- [ ] Local `D:/ai-developer-toolkit` working tree is clean (no uncommitted changes, no unpushed commits on tracked branches) — verified before any push.
- [ ] **HARD GATE**: operator is asked which SHA to pin BEFORE any `git push` to gim-home. The question includes the current remote divergence: gim-home/main=`d7e01874`, origin/personal=`0c8047f`.
- [ ] If gim-home/main needs syncing, operator approves the specific push command BEFORE it runs.
- [ ] The chosen SHA + approval source + timestamp + approval-channel reference is recorded in `.ralph/jobs/ai-developer-toolkit-submodule/preflight-approval.md`.
- [ ] `git submodule add https://github.com/gim-home/ai-developer-toolkit.git ai-developer-toolkit` succeeds.
- [ ] `git submodule update --init` brings the toolkit in cleanly.
- [ ] `git -C ai-developer-toolkit rev-parse HEAD` matches the operator-approved SHA.
- [ ] Single commit lands on the impl branch: `chore: add ai-developer-toolkit submodule at <SHA>`.
- [ ] No commits are made INSIDE `ai-developer-toolkit/` as part of this story (toolkit history untouched aside from the pre-flight gim-home sync if approved).

**Dependencies:** None (foundation; every other story depends on this).
**Estimated complexity:** small (when pre-flight is clean) / medium (if gim-home push approval is denied or remote divergence requires extra coordination).

## US-002: Update bin/ralph-overview.mjs + delete .mcp.json + fix .claude/settings.json
**Description:** As any agent running codexu's overview tooling, I want the resolver wrapper's local-dev fallback to resolve to the in-tree submodule (script-relative) AND the Claude config to be internally consistent with AGENTS.md so that fresh clones work and no tracked file references a deleted MCP server.

**Acceptance Criteria:**
- [ ] `bin/ralph-overview.mjs` imports `fileURLToPath` from `node:url` (added to existing imports at lines 40-44).
- [ ] The local-dev fallback (currently line 92) uses `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ai-developer-toolkit', 'plugins', 'ralph-overview')` so the resolution is portable across drive layouts.
- [ ] Error-help text at lines 117-118 mentions the new path (the in-tree submodule fallback) rather than `D:/ai-developer-toolkit/...`.
- [ ] The wrapper's comment block (lines 16-25, line 86) describes the in-tree submodule fallback.
- [ ] `.claude/settings.json` is updated: `"ralph-overview"` removed from `enabledMcpjsonServers` (or the array removed entirely if empty afterward), and `"ralph-overview@ai-developer-toolkit": true` added to `enabledPlugins`.
- [ ] `.mcp.json` is deleted from the tracked tree (verify with `git ls-files .mcp.json` returning empty).
- [ ] AGENTS.md line 18's claim that the `.mcp.json` entry and `enabledMcpjsonServers["ralph-overview"]` were "removed" is now ACCURATE (this story makes it accurate; previously it was contradictory).
- [ ] `pnpm sync-ralph-state` from repo root exits 0 and regenerates `.ralph-overview/generated/snapshot.json` with a new `generatedAt` timestamp.
- [ ] Typecheck passes (no compilation errors).

**Dependencies:** US-001 (needs `ai-developer-toolkit/` to exist for the resolver to find).
**Estimated complexity:** small.

## US-003: Update AGENTS.md + README.md (operating manual)
**Description:** As any agent starting in codexu, I want the operating manual to describe the submodule integration, the dev-mode operating model, and the active plugin versions so that I follow the right two-commit-flow for toolkit edits and CI can enforce version consistency.

**Acceptance Criteria:**
- [ ] AGENTS.md "Plugin resolution" block reflects the in-tree submodule local-dev fallback (script-relative path; `import.meta.url`-resolved).
- [ ] AGENTS.md "Bookkeeper operational practice" / "Worktree placement convention" sections note ai-developer-toolkit is now a submodule alongside codex/ and the cross-repo worktree mandate applies to both submodules.
- [ ] AGENTS.md "Crews-plugin invariants" reference `D:/ai-developer-toolkit/plugins/crews/CLAUDE.md` is rewritten to `./ai-developer-toolkit/plugins/crews/CLAUDE.md`.
- [ ] A new AGENTS.md section "## Active plugin versions" with HTML-comment markers (`<!-- BEGIN: active-plugin-versions -->` / `<!-- END: active-plugin-versions -->`) lists current pinned versions of ralph-overview, crews, ralph (the ralph-orchestration plugin). This is the CI invariant's source of truth.
- [ ] A new section "## After a fresh clone of codexu" (or extension of existing fresh-clone guidance) documents `git submodule update --init`, operator-personal-remote setup, and `pnpm install` in submodule plugins for dev-mode.
- [ ] README.md fresh-clone section mentions ai-developer-toolkit alongside codex/.
- [ ] Typecheck passes (markdown doesn't have typecheck but ensure no broken syntax in any embedded code blocks).

**Dependencies:** US-001 (so the in-tree path actually exists when docs reference it).
**Estimated complexity:** medium (multiple sections, must preserve existing AGENTS.md tone and not introduce typos).

## US-004: Update .agents/memory + plans/*.md
**Description:** As any agent reading auto-memory or plan-history documents, I want all tracked references to the toolkit absolute path to use the new submodule-relative convention so that no current document refers to a machine-specific absolute path.

**Acceptance Criteria:**
- [ ] Every `.agents/memory/*.md` file matching `git grep -lE '[DC]:[/\\]ai-developer-toolkit' .agents/memory/` is updated: absolute-path references rewritten to `./ai-developer-toolkit/...` (or repo-root-relative equivalent).
- [ ] Every `plans/*.md` file matching the same grep is updated to use the submodule-relative path. No per-file historical exemption — all tracked plans/*.md hits are rewritten.
- [ ] The framing in `feedback_cross_repo_impl_worktree_mandate.md` is updated to reflect that ai-developer-toolkit is now a submodule-of-codexu, treated as a sibling git repo with its own worktree semantics; the per-repo-worktree mandate still applies.
- [ ] `git grep -lE '[DC]:[/\\]ai-developer-toolkit' .agents/memory/ plans/` returns empty after the commit.

**Dependencies:** US-001 (for accurate "what the new path looks like" text).
**Estimated complexity:** medium (~13 files to edit; mostly mechanical search-and-replace with careful framing updates in the cross-repo worktree mandate).

## US-005: Bulk-rewrite .ralph-overview/data.json prompts + regenerate
**Description:** As any agent that spawns a Ralph member from a `data.json` task seed, I want `lifecycle: tracked` prompts to reference the new submodule path so that members get correct path guidance from the start.

**Acceptance Criteria:**
- [ ] Programmatically walk `.ralph-overview/data.json` tasks. For each task with `lifecycle: tracked`, all references to `D:/ai-developer-toolkit`, `D:\\ai-developer-toolkit`, `C:/ai-developer-toolkit`, `C:\\ai-developer-toolkit` in `prompts.brainstorm|plan|impl` and kanban-card text are rewritten to the submodule-relative form.
- [ ] Tasks with `lifecycle: merged` or `lifecycle: archived` are NOT modified (their seeds are historical record).
- [ ] `lastTouchedAt` is refreshed on each task that was rewritten.
- [ ] `pnpm sync-ralph-state` regenerates `snapshot.json`, `overview.html`, `overview.html.next` successfully.
- [ ] Verification command exits 0 (no `D:/...` or `C:/...` ai-developer-toolkit references in regenerated snapshot's `tracked` tasks): `node -e "const s=require('./.ralph-overview/generated/snapshot.json');const re=/[DC]:[\\\\/\\\\\\\\]ai-developer-toolkit/i;for(const t of s.tasks){if(t.lifecycle==='tracked'){const text=JSON.stringify(t.prompts||{})+JSON.stringify(t.kanbanCards||[]);if(re.test(text)){console.error('STILL HAS',t.id);process.exitCode=1;}}}"`.
- [ ] Commit message: `chore(overview): rewrite tracked-task prompts to use submodule-relative ai-developer-toolkit path`.

**Dependencies:** US-001 (so submodule is in the worktree for sync regeneration to find the ralph-overview plugin in-tree if needed; cached marketplace plugin remains the primary runtime).
**Estimated complexity:** medium (scripted rewrite + verification + sync regeneration; ~16 tasks affected).

## US-006: CI invariant check (metadata-only required, deep-mode optional with PAT)
**Description:** As a code reviewer, I want CI to fail when the documented "Active plugin versions" block disagrees with the in-tree submodule's pinned versions, so that the docs and the pinned versions never drift.

**Acceptance Criteria:**
- [ ] `tools/check-toolkit-submodule-invariants.mjs` exists. Default (metadata-only) mode reads:
  - `.gitmodules` (verifies the `ai-developer-toolkit` entry has `url = https://github.com/gim-home/ai-developer-toolkit.git` and `path = ai-developer-toolkit`).
  - The submodule's pinned SHA via `git ls-tree HEAD ai-developer-toolkit` (verifies the gitlink is well-formed; no submodule fetch required).
  - AGENTS.md `<!-- BEGIN: active-plugin-versions -->` / `<!-- END: active-plugin-versions -->` block (verifies the block exists and lists ralph-overview, crews, ralph with well-formed semver strings).
  - Exits 0 on consistency; exits non-zero with a diff message on mismatch.
- [ ] Optional `--deep` mode additionally reads `ai-developer-toolkit/plugins/{ralph-overview,crews,ralph}/.claude-plugin/plugin.json` and compares versions; only runs when the submodule is initialized (i.e., when checkout was run with `submodules: true` AND a GIM_HOME_PAT was provided to fetch the private submodule).
- [ ] `package.json` `scripts` includes `"check:toolkit-submodule": "node tools/check-toolkit-submodule-invariants.mjs"`.
- [ ] A new dedicated workflow `.github/workflows/toolkit-submodule-invariant.yml` exists with `paths:` trigger including `.gitmodules`, `AGENTS.md`, `ai-developer-toolkit` (the gitlink), `tools/check-toolkit-submodule-invariants.mjs`. The job runs `pnpm check:toolkit-submodule` (metadata-only mode, no submodule fetch required, no PAT needed).
- [ ] `.github/workflows/typecheck.yml` is NOT touched (kept happy-app-scoped per F-013 simplicity finding).
- [ ] Optional deep-mode CI job is documented in the workflow with a clear "skipped without GIM_HOME_PAT secret" message; the metadata-only job is the required gate.

**Dependencies:** US-001 (needs submodule pointer to exist), US-003 (needs AGENTS.md "Active plugin versions" block to exist).
**Estimated complexity:** medium (Node script + new workflow file + AGENTS.md "Active plugin versions" block addition).

## US-007: End-to-end smoke test + rollback documentation
**Description:** As the operator landing this change, I want a recorded smoke test confirming the system still works end-to-end, plus a rollback procedure so I can recover if a regression appears post-merge.

**Acceptance Criteria:**
- [ ] `pnpm sync-ralph-state` from `D:/harness-efforts/codexu` (repo root) exits 0 + snapshot regenerated with new timestamp.
- [ ] A bounded overview-build check passes: `pnpm overview:build` (if it exists in package.json) OR document the timeout/readiness method for the dev-server `pnpm overview` (start in background, wait up to 60s for a readiness marker in stdout, then kill). Use whichever the impl member confirms is available; record the chosen approach in smoke-test.md.
- [ ] At least one engine (Copilot CLI per AGENTS.md migration milestone; Claude Code if installed) successfully runs `pnpm sync-ralph-state`. Engines that are not installed are explicitly noted in smoke-test.md as "not tested — engine not present".
- [ ] A smoke crew-member spawn-test succeeds end-to-end: `node ai-developer-toolkit/plugins/crews/tools/crews.js spawn-member smoke-test-submodule-integration-<unix-ts> --crew ralph-pipeline --cwd D:/harness-efforts/codexu --state-cwd D:/harness-efforts/codexu --as overview-bookkeeper -- '/crews-status'`. Verified: launcher generates, member's manifest appears under `.crews/crews/ralph-pipeline/members/`, SessionStart fires, heartbeat appears within 30s, stop is clean.
- [ ] Rollback procedure documented in AGENTS.md (or new `docs/submodule-rollback.md` if AGENTS.md is too crowded). Steps: `git revert <chore-add-submodule-commit> <chore-rewrite-paths-commits>` → `git submodule deinit -f ai-developer-toolkit` → `rm -rf ai-developer-toolkit/` → push revert → re-clone `D:/ai-developer-toolkit` sibling if needed.
- [ ] Smoke-test transcript saved to `.ralph/jobs/ai-developer-toolkit-submodule/smoke-test.md` (matches the precedent set by `codexu-bin-ralph-overview-wrapper-retirement/smoke-test.md`). Includes the recorded operator-approved SHA from US-001.
- [ ] Final verification grep exits 0 with only acceptable hits (merged/archived data.json entries inside historical fields): `git grep -nIE '[DC]:[/\\]ai-developer-toolkit' -- ':(exclude).ralph/jobs/*' ':(exclude).ralph/brainstorms/*' ':(exclude).ralph/investigations/*' ':(exclude)ai-developer-toolkit/*'`.

**Dependencies:** US-002, US-003, US-004, US-005, US-006 (smoke test exercises the full integrated system; rollback docs need all structural changes to be in place).
**Estimated complexity:** medium (smoke test + rollback documentation + final verification).
