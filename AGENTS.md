# AGENTS.md (fork-level)

> Fork-specific guidance for AI agents working in this repo. Per-package guidance lives in `packages/happy-app/CLAUDE.md`, `packages/happy-server/CLAUDE.md`, etc. (mostly upstream). This file covers what's different about the fork.
>
> Filed as `AGENTS.md` rather than `CLAUDE.md` because the upstream repo's `.gitignore` excludes root-level `CLAUDE.md` (treated as per-developer personal context). Modern agent tooling (Claude Code, Cursor, Aider) auto-loads `AGENTS.md` in addition to `CLAUDE.md` files.

## Fork context

- **Fork:** [Evyatar108/happy](https://github.com/Evyatar108/happy). Remote name: `fork`. Upstream (slopus/happy) is `origin`.
- **Primary target device:** Android e-ink tablet. Every UX / perf decision is evaluated against that constraint first (weak CPU/GPU, no real compositor, hates smooth-scroll / continuous repaints). Opt-in features get a toggle that defaults `false` so non-e-ink users aren't affected.
- **Active branches:** `main` (mirrors `fork/main`, ahead of upstream by N), `feature/tablet-sidebar-toggle` (historical sidebar work, not for upstream), `fix/chat-list-perf-inverted-flatlist` (shipped upstream as PR #1154).
- **Server:** own happy-server runs locally on `localhost:3005`, exposed as `https://happy.evyatar.dev` via a named Cloudflare Tunnel.

Full fork context, branches, build workflow, and "things that bit us" catalogue are in **`docs/fork-notes.md`** — read that before touching any fork-local setup.

Agent-readable Ralph pipeline state is generated at `plans/overview-snapshot.json`; recent transitions append to `plans/overview-activity.jsonl`. Artifacts are emitted by the **`ralph-overview` plugin** (installed via the `gim-home/ai-developer-toolkit` marketplace as of Plan 12). The plugin's watcher runs inside the Vite dev server during `pnpm overview` (delegating through `bin/ralph-overview.mjs dev`), or as a standalone process via `pnpm sync-ralph-state:watch` (delegating to `ralph-overview watch`). Both paths share the same `.ralph/overview-sync.lock` and emit the same set of files. See `bin/ralph-overview.mjs` for the resolver wrapper that locates the installed plugin.

**Plugin resolution.** The resolver wrapper checks (in order): `$RALPH_OVERVIEW_PLUGIN_ROOT` env, `$CLAUDE_PLUGIN_ROOT/ralph-overview/`, `$CLAUDE_PLUGIN_ROOT/cache/ai-developer-toolkit/ralph-overview/<latest>/`, `~/.claude/plugins/cache/ai-developer-toolkit/ralph-overview/<latest>/`, then the local-dev fallback `D:/ai-developer-toolkit/plugins/ralph-overview/`. For local development against an unmerged plugin branch, set `RALPH_OVERVIEW_PLUGIN_ROOT` to point at the toolkit checkout. **Done:** the codexu install now uses the marketplace plugin registration (`enabledPlugins["ralph-overview@ai-developer-toolkit"]` in `.claude/settings.json`); the old local-path `.mcp.json` entry and `enabledMcpjsonServers["ralph-overview"]` have been removed.

Codexu owns: `plans/overview-data.js` (hand-curated tasks + `ui` overrides for codexu-specific copy), `.ralph/overview-config.json` (consumer config + JSON schema), and the generated sidecars / snapshot / activity / `tasks/INDEX.md` under `plans/` and `tasks/`. The plugin owns: the sync library, the watcher, the MCP server, the React viewer, and the `/work-on` / `/triage` / `/blocker-report` skills.

Activity-log readers MUST tolerate a final torn line: if `JSON.parse` fails on the last line, skip that line and keep the earlier parsed events.

## Entry points

| Topic | File |
|---|---|
| Backlog + follow-ups + shipped log | `docs/fork-roadmap.md` |
| Setup, branches, build workflow, known debt, decision log | `docs/fork-notes.md` |
| Windows Services setup for happy-server + cloudflared | `scripts/fork-setup/setup-services.ps1` |
| Day-to-day service ops (restart, logs, failure modes) | `.agents/skills/happy-service-manage/SKILL.md` |
| JS-only edit-reload loop on the tablet | `.agents/skills/happy-tablet-iterate/SKILL.md` |
| Claude Code metadata-tag discovery for `MarkdownView` | `.agents/skills/happy-discover-metadata-tags/SKILL.md` |

## Working preferences (learned from real sessions)

**Prefer automated scripts over manual checklists.** When a setup task has 5+ steps or needs elevation, create an idempotent script (e.g. `scripts/fork-setup/setup-services.ps1`) rather than pasting commands one-by-one into a chat. The user will ask for a script if you don't offer one first.

**Just do ops work.** Installing a missing CLI tool (winget), killing a stuck process (taskkill), probing a port (curl), rebasing a feature branch — these are low-risk, reversible, and the user expects you to drive them. No need to ask permission for each step. Ask before:

- Pushing to remotes (`git push`).
- Anything visible to others (GitHub issues/PRs, messages).
- Destructive operations (force-push to main, delete branches, `rm -rf` outside worktree).

**Match the task's risk profile.** Local experiments, typechecks, editing worktree files → just do it. Irreversible or externally-visible actions → confirm.

**Keep documentation close to the code, not in user-global memory.** This fork's setup (stable tunnel URL, services, build tricks) lives in `docs/fork-notes.md` and `.agents/skills/` — versioned, portable across machines, discoverable to any agent without needing prior session context.

**Capture expensive test/build output to a file once, then grep the file.** When a command takes >30 sec (large `vitest run`, monorepo `tsc --noEmit`, gradle builds), redirect stdout+stderr to `/tmp/<name>.out` on the first invocation and run subsequent greps against the saved file. Don't re-run the same long command to ask different questions of its output — each rerun costs minutes and produces identical output unless underlying state changed.

```bash
# Do this once:
pnpm --filter happy-cli test > /tmp/happy-cli.test.out 2>&1

# Then any of:
grep FAIL /tmp/happy-cli.test.out
grep -B1 -A5 "AssertionError" /tmp/happy-cli.test.out | head -40
grep -c "^✓" /tmp/happy-cli.test.out
```

Re-run only when code/deps/env actually changed.

## Windows-specific cautions

The dev box runs Windows 11 + Git Bash + PowerShell 5.1 (default admin Terminal). A few consistent landmines (expanded details in `docs/fork-notes.md` → "Things that bit us that aren't obvious"):

- **MAX_PATH (260 chars)** blows up Android Gradle builds if the repo lives at a deep path. Primary clone lives at `D:\harness-efforts\happy`; short-path build clone at `D:\h` is used for anything that invokes Gradle. pnpm resolves symlinks, so `subst` / junctions don't help.
- **PowerShell 5.1 file encoding.** Default admin Terminal reads `.ps1` files as CP-1252 (ANSI) without a BOM. Keep scripts ASCII-only (em-dashes, curly quotes break the tokenizer), or save with a UTF-8 BOM.
- **`sc.exe config binPath=`** with embedded quotes is mangled by PS 5.1's native-command argument passing. Use nssm (recommended) or `Set-Service -BinaryPathName` on PS 7+.
- **LocalSystem profile.** Windows services don't read from `~/.cloudflared/` — they read from `C:\Windows\System32\config\systemprofile\.cloudflared\`. Config updates need an explicit copy step (scripted in `scripts/fork-setup/setup-services.ps1`).
- **MSYS path conversion.** Git Bash converts forward-slash paths to Windows paths when invoking native commands, which can mangle git refs containing `/` (e.g. `feature/tablet-sidebar-toggle:file`). Set `MSYS_NO_PATHCONV=1` when this matters.

## Ralph-orchestration workflows

The 2026-04-22 PR-A..PR-D batch was built end-to-end via `/plan-with-ralph` + `/implement-with-ralph --autonomous`. Artifacts under `.ralph/jobs/chat-text-ux-eink/` (plan, stories outline, research briefs, review findings, commit log).

Prereq for these workflows: `jq` installed (`winget install jqlang.jq`). Without it, `ralph.sh` and `review-loop.sh` fail at startup.

If you're planning another feature and the decomposition is non-trivial, `/plan-with-ralph` is available. If you're just fixing a bug or doing a small refactor, skip the ceremony.

## Upstream cherry-picking discipline

Everything on `main` targets upstream eventually. Keep PRs self-contained (don't bundle unrelated work). Flag i18n additions explicitly in commit messages if they're English-only so the upstream reviewer can assign translation work. `feature/tablet-sidebar-toggle` is the holding area for work that's explicitly NOT for upstream (fork-only UX conveniences with i18n debt).

## Typed context boundaries

Lifecycle boundaries (`/clear`, `/compact`, autocompact, plan-mode enter/exit, and `/resume` forks) are represented by the shared `@slopus/happy-wire` `context-boundary` session event. CLI producers must use `ApiSessionClient.sendContextBoundary()`, which dual-emits the typed envelope first and a legacy compatibility event second with `meta.contextBoundaryFallback: true`, while also updating encrypted `metadata.latestBoundary` for cold starts.

App consumers treat the typed event as authoritative, suppress any legacy fallback carrying `meta.contextBoundaryFallback === true`, render loaded boundary rows through `BoundaryDivider`, and use the metadata side channel only for out-of-window pagination and cross-device advisory state. Keep all boundary UI static for the e-ink tablet target.

## Auto-memory (codexu bookkeeper-scope)

The repo-tracked auto-memory store at `.agents/memory/` covers codexu bookkeeper and ralph-pipeline operating lessons: Ralph phase discipline, overview bookkeeping, crew coordination, and codexu-specific repo conventions. It is NOT happy-app/happy-server implementation guidance; use the package-level docs and skills for those areas.

Index: [.agents/memory/MEMORY.md](.agents/memory/MEMORY.md)

Curated high-priority entries:

- [Phase discipline: separate member per ralph phase](.agents/memory/feedback_phase_discipline_separate_members.md)
- [Bookkeeper updates overview-data.js as tasks ship](.agents/memory/feedback_bookkeeper_updates_overview_data.md)
- [Spawn prompt must require Phase 5a/5b review-fix](.agents/memory/feedback_spawn_prompt_must_require_review_fix.md)
- [Cross-repo impl spawns need worktrees in EVERY shared repo](.agents/memory/feedback_cross_repo_impl_worktree_mandate.md)
- [codexu root CLAUDE.md is gitignored](.agents/memory/feedback_codexu_claude_md_gitignored.md)
- [Impl members commit to topic branch off main, NOT lead's branch](.agents/memory/feedback_impl_topic_branch_vs_lead_branch.md)

This TOC is a curated subset for fast orientation; see [.agents/memory/MEMORY.md](.agents/memory/MEMORY.md) for the full list (17 entries total; 18 files including the MEMORY.md index).

---

<!-- Bookkeeper / Scrum-Master operating manual — appended 2026-05-29 for copilot auto-load compatibility. The same content lives in the gitignored CLAUDE.md for any local claude-code session habit. -->

# Codexu — Bookkeeper / Scrum-Master Workspace

This repo is driven by an autonomous **bookkeeper + scrum-master** Claude Code
session (the `overview-bookkeeper` lead in crew `ralph-pipeline`). The lead
spawns Ralph workers, monitors their mailboxes, merges their work, and keeps
the overview data — the team's single source of truth — current.

## The lead's job

| Duty | Mechanism |
|---|---|
| Pick the next parallel batch from the backlog | `mcp__ralph-overview__overview_parallel_ready_tasks` + `plans/overview-snapshot.json` |
| Spawn a Ralph member per task | `node <plugin>/tools/crews.js spawn-member <name> --crew ralph-pipeline --cwd D:/harness-efforts/codexu --state-cwd D:/harness-efforts/codexu --as overview-bookkeeper -- <prompt>` |
| Watch the member mailbox | armed listener; on `messages` envelope, `/crews:review-mail` |
| Relay operator decisions when members surface `kind=question` | `/crews:send-to-member` |
| **Update `plans/overview-data.js` when a task ships** | Edit `lifecycle` → `"merged"` (or `"archived"` for closed/superseded work); add `mergeCommit`; refresh `lastTouchedAt` |
| Commit + push the bookkeeping update | `chore(plans): update overview-data.js for shipped tasks` |
| Stop the member cleanly | `/crews:stop-member <name>` |

### Phase discipline - state machine + one member per ralph phase

Each ralph phase gets its OWN fresh member. Never chain brainstorm -> plan ->
impl inside a single member session. See
`feedback_phase_discipline_separate_members` in auto-memory for the rule.

Ralph is a state machine, not a one-way checklist. Normal forward movement is
`brainstorming` -> `brainstorm-ready` -> `planning` -> `plan-ready` ->
`implementing` -> `reviewing` -> `shipped`. A task can regress from any stage
back to `brainstorming` or `planning` when review finds a design gap, scope
change, or stale assumption. Every regression must carry a short
`regressionReason` in the watcher state so the operator can see why the task
moved backward.

Regression does not reuse the old member. It spawns a FRESH member for the
regressed-to phase, using the matching seed in `plans/overview-data.js`:
`prompts.brainstorm` for brainstorming, `prompts.plan` for planning, and
`prompts.impl` for implementation. If the relevant prompt is missing, the task
is not actionable until the bookkeeper adds one or chooses a different initial
stage.

When picking the next batch:
1. For each candidate task, determine its current state by checking the watcher
   snapshot plus on-disk deliverables:
   - Brainstorm: `.ralph/brainstorms/<task-id>/brainstorm.json` (recommendedDirection set?)
   - Plan: `.ralph/jobs/<task-id>/plan.md` (committed?)
   - Impl: `.ralph/jobs/<task-id>/job-state.json` (orchestrator.terminal?)
2. Determine next-phase action based on what's missing AND how concrete the seed is:
   - Fuzzy goal / multiple competing approaches / unknown conflict surface -> spawn `brainstorm-<task>` (`/brainstorm-with-ralph`)
   - Concrete seed with file paths + specific edits -> spawn `plan-<task>` directly (`/plan-with-ralph` or `--from-brainstorm` if brainstorm shipped)
   - `plan.md` committed + reviewed -> spawn `impl-<task>` (`/implement-with-ralph --from-plan --autonomous`)
3. Surface stage + next action when recommending tasks. Say "stage planning; spawn plan-<task>", not just "ready".
4. When a member ships `kind=done`, stop it cleanly via `/crews:stop-member`. Do NOT keep it alive across phases. The next-phase member reads the committed deliverable from `origin/main`, not from a chained mailbox handoff.
5. Phase 5a/5b convergence is INTERNAL to the impl member (per `feedback_spawn_prompt_must_require_review_fix`) - the one-member-per-phase rule applies to the brainstorm/plan/impl axis, not to sub-phases inside impl.

## Overview data — two-file split

Two files describe task state; they coexist and must not be conflated.

### `plans/overview-data.js` — hand-curated, lead-owned

Stable task definitions: `id`, `scope`, `lifecycle`, `status`,
`lastTouchedAt`, `mergeCommit`, `kanbanCards`, and `command{name,
descriptionHtml, warnings, prompts}`. This is what the operator and lead use
to plan: it carries the *intent* (`prompts.brainstorm`, `prompts.plan`, and
`prompts.impl` seeds, kanban cards, dependency notes in warnings). The lead
**must** flip `lifecycle` to `"merged"` and add `mergeCommit` when a task
lands on `origin/main`; closed-without-merge work becomes `"archived"`. See
`feedback_bookkeeper_updates_overview_data` in the lead's auto-memory for the
rule.

The three phase-like axes are deliberately separate:

| Axis | Owner | Values | Meaning |
|---|---|---|---|
| `OverviewTask.lifecycle` | Bookkeeper data in `overview-data.js` | `tracked`, `merged`, `archived` | Durable backlog/merge/archive status |
| `RalphPipelineState.stage` | Ralph watcher snapshot | `brainstorming`, `brainstorm-ready`, `planning`, `plan-ready`, `implementing`, `reviewing`, `shipped`, `blocked` | Runtime position in the state machine |
| `CrewSessionRef.phase` | Crew session reference | `brainstorm`, `plan`, `impl`, `null` | Intent of the member when it was spawned |

### `plans/overview-ralph-state.{js,json}` — watcher-generated

Auto-emitted by `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/sync-ralph-state.mjs --watch`
based on `.ralph/jobs/<slug>/job-state.json`. Carries the dynamic
state: `stage`, `terminalReason`, `storyCompletion`, `crewSessions`,
`branchName`, etc. **Do not hand-edit** — the watcher overwrites it.
If it's stale, the watcher has crashed; see `.claude/skills/overview-reset`.

The React viewer (`tools/overview-viewer/`) renders both sidecars merged.
The MCP server (`mcp__ralph-overview__*`) reads the watcher-generated
snapshot. Agents querying the canonical task list should read
`plans/overview-snapshot.json` (the merged form).

### Other generated files (don't hand-edit)

- `plans/overview-snapshot.json` — aggregated snapshot for agents
- `plans/overview-recommendations.json` — ranked next-task list
- `plans/overview-dependency-graph.json` — DAG
- `plans/overview-activity.jsonl` — append-only audit log (gitignored)
- `plans/overview.html{,.next}` — static viewer build
- `tasks/INDEX.md` — regenerated per-task index

## Common confusion points

1. **Bash sessions default to `D:/harness-efforts/codexu/codex/`** (the codex
   submodule), not the repo root. Always pass `--state-cwd D:/harness-efforts/codexu`
   + `--as overview-bookkeeper` to any `crews.js` CLI call to override the
   auto-resolution. See `feedback_crews_spawn_state_cwd_override`.

2. **The codex submodule (`codex/`) does NOT build locally on this Windows box.**
   Local cargo is intentionally unavailable — the publish path
   (`codex/.claude/commands/publish-sandbox-patch.md`) installs xwin + LLVM
   + V8 lib for release cuts only. Daily iteration **defers Rust verification
   to CI on push** (`.github/workflows/invariant-check.yml`). When spawning a
   member for any codex-submodule task, override the seed's "cargo build green"
   acceptance criterion; tell the member to push and let CI verify. See
   `feedback_codex_fork_no_local_cargo`.

3. **`.ralph/jobs/<slug>/codex-worktree/` and `codexu-pointer-worktree/`** are
   multi-GB sibling-repo checkouts. They're gitignored (added in `chore(gitignore)`
   commit `3ca67e43`). Worktree-local edits are committed inside those worktrees;
   never let them leak into the parent commit via `git add -A`.

4. **Ralph members' "cwd" in their crew manifest is advisory.** A member
   spawned with `--cwd .worktrees/<slug>` will often still write to the parent
   repo's `.ralph/jobs/<slug>/` directory — that's the canonical job-dir
   location, even when the member is "working in" a worktree. Verify with
   `git status` from the repo root before assuming a member's commit landed
   on the right branch.

5. **Two-file split is intentional.** Do NOT extend `overview-data.js` with
   Ralph state, and do NOT hand-edit `overview-ralph-state.js`. The original
   plan (`C:/Users/evmitran/.claude/plans/glistening-wondering-llama.md` Part 1
   R4) chose the sidecar split specifically to avoid race conditions between
   hand-editing and watcher writes.

## Crews-plugin invariants (v1.6.0)

The lead and members coordinate via the **crews** Claude Code plugin
(`gim-home/ai-developer-toolkit`, version 1.6.0+). Key behaviors:

- **Listener arming**: lead and member sessions must keep a background
  listener armed (`node $CREWS_BIN arm` or `wait-for-message.js`). The
  PreToolUse hook blocks non-arm tools when the listener is exited.
- **Stop hook gates** turn completion on: missing kind tag, unreviewed mail
  (`lastReviewRequiredSeq > lastReviewedSeq`), strict-ack unresolved consumed
  messages. Stop hook strict; PostToolUse runs an advisory nag at >30s mid-turn.
  progress envelopes do not trigger review-required at either gate. The lead's
  turn must end with `<|report kind="<kind>" summary="..."|>`.
- **`/crews:review-mail`** advances the cursor under the manifest lock
  (monotonic; v1.5.6 guarantees no rollback). Side effect is the single
  source of truth for "agent reviewed."
- **`/crews:spawn-member`** launches a new `wt.exe` tab. Member auto-registers
  via SessionStart within ~5-10s. The lead's outbox carries an initial
  `spawn-prompt` envelope for forensics.

See `D:/ai-developer-toolkit/plugins/crews/CLAUDE.md` for the full protocol.

## Bookkeeper workflow at-a-glance

```
operator says "continue"
   ↓
lead: mcp.overview_parallel_ready_tasks → readyTasks[]
   ↓
lead: pick 2-3 disjoint-surface tasks
   ↓
lead: for EACH task, determine current stage + next-phase action
     (brainstorm / plan / impl)
   ↓
lead: spawn ONE fresh member per task per phase with the matching prompts.<phase> seed
     (e.g., plan-<id>; NOT impl-<id> until plan ships)
   ↓
[phase member: /brainstorm-with-ralph OR /plan-with-ralph OR
               /implement-with-ralph --autonomous (exactly one phase)]
   ↓
member: kind=done report → mailbox
   ↓
lead: review-mail → verify commit on origin/main
   ↓
lead: /crews:stop-member <name> (do NOT chain into the next phase)
   ↓
lead: if this was the FINAL phase (impl ship), EDIT plans/overview-data.js
     (lifecycle → "merged", mergeCommit, lastTouchedAt)
   ↓
lead: commit "chore(plans): update overview-data.js for shipped tasks"
   ↓
lead: push
   ↓
lead: loop back to overview_parallel_ready_tasks
```

If the member surfaces `kind=question`, the lead **must** decide whether to
relay to the operator (significant choices, ambiguity, blocked-on-toolchain)
or to answer autonomously (false blockers, follow-up clarifications). Save
recurring patterns as `feedback_*` auto-memory entries so future sessions
inherit the lessons.

## Skills

- **`.claude/skills/overview-reset`** — hard-reset the ralph-overview watcher
  when sessions get tangled (orphan watcher processes, stale owner-marker
  lease, sidecar staleness).
- Other repo-local skills are pointers (small text files) to
  `.agents/skills/<name>/` which is the canonical location for cross-machine
  skill content.

## Auto-memory (codexu bookkeeper-scope)

The repo-tracked auto-memory store at `.agents/memory/` covers codexu bookkeeper and ralph-pipeline operating lessons: Ralph phase discipline, overview bookkeeping, crew coordination, and codexu-specific repo conventions. It is NOT happy-app/happy-server implementation guidance; use the package-level docs and skills for those areas.

Index: [.agents/memory/MEMORY.md](.agents/memory/MEMORY.md)

Curated high-priority entries:

- [Phase discipline: separate member per ralph phase](.agents/memory/feedback_phase_discipline_separate_members.md)
- [Bookkeeper updates overview-data.js as tasks ship](.agents/memory/feedback_bookkeeper_updates_overview_data.md)
- [Spawn prompt must require Phase 5a/5b review-fix](.agents/memory/feedback_spawn_prompt_must_require_review_fix.md)
- [Cross-repo impl spawns need worktrees in EVERY shared repo](.agents/memory/feedback_cross_repo_impl_worktree_mandate.md)
- [codexu root CLAUDE.md is gitignored](.agents/memory/feedback_codexu_claude_md_gitignored.md)
- [Impl members commit to topic branch off main, NOT lead's branch](.agents/memory/feedback_impl_topic_branch_vs_lead_branch.md)

This TOC is a curated subset for fast orientation. See [.agents/memory/MEMORY.md](.agents/memory/MEMORY.md) for the full list.

For the in-flight `overview-install-streamline` brainstorm — that work will
add agent-callable MCP tools (`overview.init`, `overview.upsert_task`,
`overview.mark_shipped`) that automate the bookkeeper duties this doc
describes. Until then, this CLAUDE.md is the operating manual.
>>>>>>> 8c2a16bf (docs: append bookkeeper operating manual to AGENTS.md for copilot auto-load)
