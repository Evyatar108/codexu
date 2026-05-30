# AGENTS.md (fork-level)

> Fork-specific guidance for AI agents working in this repo. Per-package guidance lives in `packages/happy-app/AGENTS.md`, `packages/happy-server/AGENTS.md`, etc. (mostly upstream). This file covers what's different about the fork.
>
> Filed as `AGENTS.md` rather than `CLAUDE.md` because the upstream repo's `.gitignore` excludes root-level `CLAUDE.md` (treated as per-developer personal context). Modern agent tooling (Claude Code, **Copilot CLI**, Cursor, Aider) auto-loads `AGENTS.md` in addition to `CLAUDE.md` files.

## Fork context

- **Fork:** [Evyatar108/happy](https://github.com/Evyatar108/happy). Remote name: `fork`. Upstream (slopus/happy) is `origin`.
- **Primary target device:** Android e-ink tablet. Every UX / perf decision is evaluated against that constraint first (weak CPU/GPU, no real compositor, hates smooth-scroll / continuous repaints). Opt-in features get a toggle that defaults `false` so non-e-ink users aren't affected.
- **Active branches:** `main` (mirrors `fork/main`, ahead of upstream by N), `feature/tablet-sidebar-toggle` (historical sidebar work, not for upstream), `fix/chat-list-perf-inverted-flatlist` (shipped upstream as PR #1154).
- **Server:** own happy-server runs locally on `localhost:3005`, exposed as `https://happy.evyatar.dev` via a named Cloudflare Tunnel.

Full fork context, branches, build workflow, and "things that bit us" catalogue are in **`docs/fork-notes.md`** — read that before touching any fork-local setup.

Agent-readable Ralph pipeline state is generated at `.ralph-overview/generated/snapshot.json`; recent transitions append to `.ralph-overview/generated/activity.jsonl`. Artifacts are emitted by the **`ralph-overview` plugin** (installed via the `gim-home/ai-developer-toolkit` marketplace as of Plan 12). The plugin's watcher runs inside the Vite dev server during `pnpm overview` (delegating through `bin/ralph-overview.mjs dev`), or as a standalone process via `pnpm sync-ralph-state:watch` (delegating to `ralph-overview watch`). Both paths share the same `.ralph-overview/generated/.lock/sync.lock` and emit the same set of files. See `bin/ralph-overview.mjs` for the resolver wrapper that locates the installed plugin.

**Plugin resolution.** The resolver wrapper (`bin/ralph-overview.mjs` — **tracked in git as of the codexu-bin-ralph-overview-wrapper-retirement task**; previously gitignored / per-machine) checks (in order): `$RALPH_OVERVIEW_PLUGIN_ROOT` env, `$CLAUDE_PLUGIN_ROOT/ralph-overview/`, `$CLAUDE_PLUGIN_ROOT/cache/ai-developer-toolkit/ralph-overview/<latest>/`, `~/.claude/plugins/cache/ai-developer-toolkit/ralph-overview/<latest>/`, **`~/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/`** (Copilot CLI install layout — single live copy, no per-version subdir), then the local-dev fallback `D:/ai-developer-toolkit/plugins/ralph-overview/`. Because the wrapper is now tracked, a fresh clone of codexu under EITHER Claude Code OR Copilot CLI gets a working `pnpm sync-ralph-state` / `pnpm overview` out of the box — no per-machine wrapper-copy or shell-rc setup. For local development against an unmerged plugin branch, set `RALPH_OVERVIEW_PLUGIN_ROOT` to point at the toolkit checkout. **Done:** the codexu install now uses the marketplace plugin registration (`enabledPlugins["ralph-overview@ai-developer-toolkit"]` in `.claude/settings.json` for Claude Code and the equivalent block in `~/.copilot/settings.json` for Copilot CLI); the old local-path `.mcp.json` entry and `enabledMcpjsonServers["ralph-overview"]` have been removed.

**Cross-engine manual smoke test (the wrapper).** To verify the wrapper resolves to the engine-appropriate install path on this machine, from `D:/harness-efforts/codexu` (or any subdir) run `pnpm sync-ralph-state` under each engine. Exit 0 + an updated `.ralph-overview/generated/snapshot.json` (only `generatedAt` changed) confirms resolution worked. To inspect which install path was chosen, watch for the `RALPH_OVERVIEW_PLUGIN_ROOT=<path>` line in stderr or set `RALPH_OVERVIEW_PLUGIN_ROOT=` empty + run with `node --trace-warnings bin/ralph-overview.mjs sync` and the cascade is visible. Reference smoke-test record: `.ralph/jobs/codexu-bin-ralph-overview-wrapper-retirement/smoke-test.md`.

Codexu owns: `.ralph-overview/data.json` (hand-curated tasks + `ui` overrides for codexu-specific copy), `.ralph-overview/config.json` (consumer config + JSON schema), generated sidecars under `.ralph-overview/generated/`, and `tasks/INDEX.md`. The plugin owns: the sync library, the watcher, the MCP server, the React viewer, and the `/work-on` / `/triage` / `/blocker-report` skills.

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

---

<!-- Bookkeeper / Scrum-Master operating manual — appended 2026-05-29 for copilot auto-load compatibility. The same content lives in the gitignored CLAUDE.md for any local claude-code session habit. -->

# Codexu — Bookkeeper / Scrum-Master Workspace

This repo is driven by an autonomous **bookkeeper + scrum-master** session
(Copilot CLI as of 2026-05-29; Claude Code still supported — see the
"Engine choice" note in the Copilot migration milestone block below).
The lead spawns Ralph workers, monitors their mailboxes, merges their
work, and keeps the overview data — the team's single source of truth —
current.

## The lead's job

| Duty | Mechanism |
|---|---|
| Pick the next parallel batch from the backlog | `mcp__ralph-overview__overview_parallel_ready_tasks` + `.ralph-overview/generated/snapshot.json` |
| Spawn a Ralph member per task | `node <plugin>/tools/crews.js spawn-member <name> --crew ralph-pipeline --cwd D:/harness-efforts/codexu --state-cwd D:/harness-efforts/codexu --as overview-bookkeeper -- <prompt>` |
| Watch the member mailbox | armed listener; on `messages` envelope, `/crews:review-mail` |
| Relay operator decisions when members surface `kind=question` | `/crews:send-to-member` |
| **Update `.ralph-overview/data.json` when a task ships** | Edit `lifecycle` → `"merged"` (or `"archived"` for closed/superseded work); add `mergeCommit`; refresh `lastTouchedAt` |
| Commit + push the bookkeeping update | `chore(overview): update data for shipped tasks` |
| Stop the member cleanly | `/crews:stop-member <name>` |

### Phase discipline - state machine + one member per ralph phase

Each ralph phase gets its OWN fresh member. Never chain brainstorm -> plan ->
impl inside a single member session. The rule is codified below under
"Bookkeeper operating invariants."

Ralph is a state machine, not a one-way checklist. Normal forward movement is
`brainstorming` -> `brainstorm-ready` -> `planning` -> `plan-ready` ->
`implementing` -> `reviewing` -> `shipped`. A task can regress from any stage
back to `brainstorming` or `planning` when review finds a design gap, scope
change, or stale assumption. Every regression must carry a short
`regressionReason` in the watcher state so the operator can see why the task
moved backward.

Regression does not reuse the old member. It spawns a FRESH member for the
regressed-to phase, using the matching seed in `.ralph-overview/data.json`:
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
5. Phase 5a/5b convergence is INTERNAL to the impl member (see invariants below) - the one-member-per-phase rule applies to the brainstorm/plan/impl axis, not to sub-phases inside impl.

## Overview data — two-file split

Two files describe task state; they coexist and must not be conflated.

### `.ralph-overview/data.json` — hand-curated, lead-owned

Stable task definitions: `id`, `scope`, `lifecycle`, `status`,
`lastTouchedAt`, `mergeCommit`, `kanbanCards`, and `command{name,
descriptionHtml, warnings, prompts}`. This is what the operator and lead use
to plan: it carries the *intent* (`prompts.brainstorm`, `prompts.plan`, and
`prompts.impl` seeds, kanban cards, dependency notes in warnings). The lead
**must** flip `lifecycle` to `"merged"` and add `mergeCommit` when a task
lands on `origin/main`; closed-without-merge work becomes `"archived"`. The
full rule is codified below under "Bookkeeper operating invariants."

The three phase-like axes are deliberately separate:

| Axis | Owner | Values | Meaning |
|---|---|---|---|
| `OverviewTask.lifecycle` | Bookkeeper data in `.ralph-overview/data.json` | `tracked`, `merged`, `archived` | Durable backlog/merge/archive status |
| `RalphPipelineState.stage` | Ralph watcher snapshot | `brainstorming`, `brainstorm-ready`, `planning`, `plan-ready`, `implementing`, `reviewing`, `shipped`, `blocked` | Runtime position in the state machine |
| `CrewSessionRef.phase` | Crew session reference | `brainstorm`, `plan`, `impl`, `null` | Intent of the member when it was spawned |

### `.ralph-overview/generated/ralph-state.{js,json}` — watcher-generated

Auto-emitted by `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/sync-ralph-state.mjs --watch`
based on `.ralph/jobs/<slug>/job-state.json`. Carries the dynamic
state: `stage`, `terminalReason`, `storyCompletion`, `crewSessions`,
`branchName`, etc. **Do not hand-edit** — the watcher overwrites it.
If it's stale, the watcher has crashed; see `.claude/skills/overview-reset`.

The React viewer (`tools/overview-viewer/`) renders both sidecars merged.
The MCP server (`mcp__ralph-overview__*`) reads the watcher-generated
snapshot. Agents querying the canonical task list should read
`.ralph-overview/generated/snapshot.json` (the merged form).

### Other generated files (don't hand-edit)

- `.ralph-overview/generated/snapshot.json` — aggregated snapshot for agents
- `.ralph-overview/generated/recommendations.json` — ranked next-task list
- `.ralph-overview/generated/dependency-graph.json` — DAG
- `.ralph-overview/generated/activity.jsonl` — append-only audit log
- `.ralph-overview/generated/overview.html{,.next}` — static viewer build
- `tasks/INDEX.md` — regenerated per-task index

## Common confusion points

1. **Bash sessions default to `D:/harness-efforts/codexu/codex/`** (the codex
   submodule), not the repo root. Always pass `--state-cwd D:/harness-efforts/codexu`
   + `--as overview-bookkeeper` to any `crews.js` CLI call to override the
   auto-resolution.

2. **The codex submodule (`codex/`) DOES support local typecheck (corrected
   2026-05-27).** `rustup` + `cargo` are installed at `~/.cargo/bin/`; `cargo
   check --workspace` (~6 min) is the documented Phase-5a gate per
   `codex/CLAUDE.md`. Only `cargo build --release` is deferred to CI — that
   needs the heavy publish toolchain (xwin + LLVM + V8 lib) installed by
   `codex/.claude/commands/publish-sandbox-patch.md`. The earlier "no local
   cargo" framing was stale and led members to skip valid local verification.
   Before spawning a codex-touching impl, run `cd codex/external/repos/codex-patched/codex-rs
   && cargo metadata --no-deps --format-version 1` as a workspace-parse
   preflight; non-zero exit signals a mid-flight overlay-coordination gap
   that the member would otherwise burn iterations chasing.

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

5. **Two-file split is intentional.** Do NOT extend `.ralph-overview/data.json` with
   Ralph state, and do NOT hand-edit `overview-ralph-state.js`. The original
   plan (`C:/Users/evmitran/.claude/plans/glistening-wondering-llama.md` Part 1
   R4) chose the sidecar split specifically to avoid race conditions between
   hand-editing and watcher writes.

## Crews-plugin invariants (v1.9.2)

The lead and members coordinate via the **crews** plugin (Claude Code + Copilot CLI cross-engine compatible since v1.3.0; default member engine inherits from caller CLI since v1.8.11). Key behaviors:

- **Listener arming**: lead and member sessions must keep a background
  listener armed (`node $CREWS_BIN arm` or `wait-for-message.js`). The
  PreToolUse hook blocks non-arm tools when the listener is exited. As of
  `06f75ec5`, the missing-kind-tag Stop block no longer mentions
  listener-arming — that error focuses solely on the report-tag protocol;
  listener gaps surface via PreToolUse instead.
- **Stop hook gates** turn completion on: missing kind tag, unreviewed mail
  (`lastReviewRequiredSeq > lastReviewedSeq`), strict-ack unresolved consumed
  messages. Stop hook strict; PostToolUse runs an advisory nag at >30s mid-turn.
  progress envelopes do not trigger review-required at either gate. The lead's
  turn must end with `<|report kind="<kind>" summary="..."|>`.
- **`/crews:review-mail`** advances the cursor under the manifest lock
  (monotonic; v1.5.6 guarantees no rollback). Side effect is the single
  source of truth for "agent reviewed."
- **`/crews:spawn-member`** launches a new `wt.exe` tab in the CURRENT
  Windows Terminal window (not a new window — `--new-window` flag was
  retired in v1.8.13). Member auto-registers via SessionStart within
  ~5-10s. The lead's outbox carries an initial `spawn-prompt` envelope
  for forensics.
- **`/crews:stop-member` is HARD-TERMINATE by default as of v1.9.x.** Node-
  side WMI captures the inner Copilot/Claude CLI PID at spawn time (v1.9.2);
  stop kills ONLY that inner PID, which lets the launcher's inline `&`
  return → `exit 0` → wt closes the tab cleanly under default `closeOnExit:
  graceful`. The legacy soft mailbox-ack flow is opt-in via `--soft`.
  Killing the inner PID never touches the wt.exe server (which hosts every
  tab in the window — killing it is catastrophic).

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
lead: if this was the FINAL phase (impl ship), EDIT .ralph-overview/data.json
     (lifecycle → "merged", mergeCommit, lastTouchedAt)
   ↓
lead: commit "chore(overview): update data for shipped tasks"
   ↓
lead: push
   ↓
lead: loop back to overview_parallel_ready_tasks
```

If the member surfaces `kind=question`, the lead **must** decide whether to
relay to the operator (significant choices, ambiguity, blocked-on-toolchain)
or to answer autonomously (false blockers, follow-up clarifications). When
you notice a recurring pattern worth capturing for future sessions, propose
adding it to the "Bookkeeper operating invariants" section below; this
document is the canonical store, not auto-memory.

## Skills

- **`.claude/skills/overview-reset`** — hard-reset the ralph-overview watcher
  when sessions get tangled (orphan watcher processes, stale owner-marker
  lease, sidecar staleness).
- Other repo-local skills are pointers (small text files) to
  `.agents/skills/<name>/` which is the canonical location for cross-machine
  skill content.

## Bookkeeper operating invariants

These are the load-bearing rules for the `overview-bookkeeper` lead session
and the `ralph-pipeline` crew. Previously they lived as `.agents/memory/`
auto-memory entries; they're now inlined here so every agent (Claude, Copilot,
others) sees them on session start through the same channel as the rest of
this doc.

### Branch + worktree discipline

- **The lead's primary working dir (`D:/harness-efforts/codexu`) STAYS on
  `main`.** Do not `git checkout` a scratch/topic/feature branch in the
  primary dir. Any experimental or scratch work the lead needs goes in a
  worktree — never in the primary dir. Rationale: the primary dir is what
  every new agent session, every Copilot/Claude tab, every editor's
  recent-files window, and the auto-loaded `AGENTS.md`/`.crews/` state
  point at by default. Checking out a scratch branch there is what made the
  old `codexu-plans-view` worktree (the "view on main" workaround) load-bearing
  in the first place. With the lead on main directly, that workaround is
  retired — there is no separate "plans view" needed.

- **Worktree placement convention (codified 2026-05-29):** every worktree
  has exactly one correct home depending on who creates it and why. NEVER
  use sibling-of-repo paths like `../codexu-<slug>` — they clutter
  `D:/harness-efforts/` and don't survive routine `git worktree list`
  cleanup hygiene without explicit operator awareness. The 2026-05-29
  smoke-test session created three sibling-of-repo worktrees by mistake
  (`codexu-plan-wrapper-retirement`, `codexu-plan-hard-terminate`,
  `codexu-plan-hard-terminate-v2`) following the now-obsolete pattern
  this section USED to recommend. The correct mapping:

  | Case | Where the worktree lives | Owner |
  |---|---|---|
  | **Ralph-skill spawn** (`/plan-with-ralph`, `/implement-with-ralph`, `/brainstorm-with-ralph`) | `.ralph/jobs/<task-id>/worktree/` (with `/plan-with-ralph` using `worktree/plan/`; `/implement-with-ralph` keeps its historical `worktree/` layout) | The ralph skill itself manages it. Lead spawn-prompts should NOT include a manual `git worktree add ...` — that bypasses the skill's own setup and may create duplicate state. Run `/plan-with-ralph`; it auto-manages its plan worktree. |
  | **Lead-driven scratch work** (rare; non-ralph-skill) | `D:/harness-efforts/codexu/.worktrees/<purpose-slug>/` | Lead creates manually. Matches every existing operator worktree (see `git worktree list`). |
  | **Cross-repo impl** (touches a sibling repo like `D:/ai-developer-toolkit/`) | `D:/<sibling-repo>/.worktrees/<task-id>/` — INSIDE the sibling repo | Lead/impl-member creates manually before editing. The worktree lives in the repo it works on, not in the parent dir nor in codexu's state tree. |
  | **NEVER** | `../codexu-<slug>/`, `D:/codexu-<slug>/`, `D:/<sibling-repo>-<slug>/` — all sibling-of-repo paths | — |

- **Plan-phase members commit on a topic branch in a worktree, NOT on
  local main directly.** Earlier guidance ("plan-phase members commit to
  `main` directly because the lead is already on main") created a real
  concurrency hazard observed 2026-05-29: the plan-member's working dir
  is the same as the lead's primary dir, and any `git checkout` the
  member runs flips the lead's branch out from under the lead.
  `/plan-with-ralph` now owns the safe flow: it creates
  `.ralph/jobs/<task-id>/worktree/plan/` on `ralph/plan-<task-id>`,
  commits the plan deliverables there, pushes the topic branch to
  `origin`, and reports the commit SHA + branch + worktree path to the
  lead. Spawn prompts should simply say "run `/plan-with-ralph`"; do not
  paste a manual WORKTREE MANDATE or `git worktree add` snippet. The lead
  reviews, FF-merges (or cherry-picks if siblings landed in the wrong
  order), pushes main, and cleans up with `/plan-with-ralph cleanup
  <task-id>` after merge. This matches the impl-phase pattern (next
  bullet) and avoids the dual-writer hazard entirely.

- **Lead post-FF flow for plan branches.** After a plan member reports a
  clean plan commit, the lead reviews the branch and then runs the three
  post-ship steps from the lead's primary codexu checkout: `git merge
  --ff-only <sha>`, push `main` to the configured remotes, then
  `/plan-with-ralph cleanup <task-id>`. Add `--prune-remote` only when the
  operator intentionally wants the remote topic branch deleted; the
  cleanup command leaves the origin branch intact by default as an audit
  trail.

- **Impl-phase members still commit to a topic branch off `origin/main`.**
  Ralph's impl flow uses its own worktree convention and expects a
  `ralph/<task-id>` topic branch. The lead merges (fast-forward or PR) at
  ship time. This rule is unchanged from before the flip.

- **Only the lead merges to main.** Members commit + push their topic
  branches; the lead FF/cherry-picks to `main` and pushes. Members must
  NOT push directly to `origin/main` even via their worktree. The lead
  is also responsible for post-merge cleanup: `git worktree remove
  <path>`, `git push origin --delete <topic-branch>`, and (locally)
  `git branch -D <topic-branch>` for branches whose work has fully
  landed. Stale topic branches on origin cause `git fetch origin
  --prune` noise and clutter `git ls-remote` output.

- **Always push main to ALL configured remotes after every merge.** Both
  codexu and `D:/ai-developer-toolkit` have multiple remotes that must
  stay in lockstep — leaving any of them stale is operator surprise the
  next time they `git fetch` or try a `copilot plugin update`. The
  bookkeeper duty is: after `git merge --ff-only <sha>` or
  `git cherry-pick`, run `git remote | ForEach-Object { git push $_ main }`
  (or the equivalent loop) and verify every remote's `main` HEAD matches
  local. Surface any push failure (auth, permission denied, protected
  branch) immediately rather than silently leaving the remote behind.
  Codexu remotes today: `origin` (evmitran_microsoft), `personal`
  (Evyatar108). Toolkit remotes today: `origin` (evmitran_microsoft),
  `gim-home` (the marketplace source — `copilot plugin update` pulls
  from here), `personal` (Evyatar108). **`copilot plugin update`
  depends on `gim-home/main` being current**, so a sync miss there
  silently leaves every other consumer machine running the old plugin
  even after the operator runs `copilot plugin update`.

- **Cross-repo impl spawns need worktrees in EVERY shared repo.** When two
  or more impl members touch the same sibling repo (e.g., both edit
  `D:/ai-developer-toolkit`), each needs its own worktree in that repo so
  they don't stomp each other's uncommitted state. The mandate is per-repo,
  not per-task. **Correct pattern:** `git -C <repo> worktree add
  <repo>/.worktrees/<task-id> -b ralph/<task-id> main`. (The older
  recommended pattern `<repo>-<slug>` as a sibling-of-repo path was
  retired 2026-05-29 — see the worktree placement convention table
  above.) Enumerate every sibling repo the plan touches before spawning;
  check `list-members` + manifest cwd for co-residents.

- **Never `git update-ref` to fast-forward a worktree's branch.** It moves
  HEAD but leaves stale working-tree files; the next `git add` + commit
  records a diff that effectively reverts the fast-forwarded commits. Use
  `git -C <worktree> merge --ff-only <sha>` from inside the worktree.

- **Codexu root `CLAUDE.md` is gitignored.** Fork-level guidance goes in this
  AGENTS.md. The bookkeeper's local `CLAUDE.md` is an operator-only file
  (now just a pointer to AGENTS.md). When spawning a codexu-touching impl
  member, the spawn prompt MUST explicitly note this so the member doesn't
  `git add CLAUDE.md`. When merging impl branches into main, scan the diff
  for `CLAUDE.md` adds and reject them — those edits belong in `AGENTS.md`.

### Spawn-prompt invariants

- **Always pass `--state-cwd D:/harness-efforts/codexu` and
  `--as overview-bookkeeper`** to every `crews.js` CLI call. Bash sessions
  default to the `codex/` submodule path; auto-resolution picks the wrong
  state-cwd and the spawn fails with `SenderNotFoundError: sender "null" not
  found in crew "ralph-pipeline"`.

- **`--engine` is OPTIONAL as of crews v1.8.11.** The default member engine
  now mirrors the caller-CLI engine (Copilot lead → Copilot member; Claude
  lead → Claude member) instead of always defaulting to `claude`. Pass
  `--engine <other>` only when you intentionally want a cross-engine spawn.
  Old AGENTS.md guidance to "always pass `--engine copilot` from a Copilot
  lead" is now obsolete — it still works but is redundant noise.

- **Every implement-driving spawn prompt must hard-code Phase 5a (code
  review-fix convergence — multiple rounds if needed) and Phase 5b (docs
  review-fix convergence) before fast-forward and push.** Don't trust members
  to infer "drive to terminal" as the full Phase 6 terminal-clean; they read
  it as "Phase 4 (stories pass) done" and skip the post-impl review where
  reviewers historically catch Highs that pre-impl review missed. Phase
  5a/5b must reach `review: {code: 'clean', docs: 'clean'}` before merge.
  Exceptions: empty-diff short-circuits (work already on main), explicit
  operator hotfix instruction, and research-only docs that hit 4-way
  reviewer consensus + citation verification.

### Copilot migration milestone (2026-05-29)

- **Bookkeeper lead now runs under Copilot CLI by default.** End-to-end
  smoke test on 2026-05-29 ran a full brainstorm + plan cycle for the
  `crews-roles-and-direct-operator-channel` task entirely under Copilot:
  spawn → SessionStart → listener-arm → multi-min work → kind=done →
  review-mail → stop → FF to main, twice in succession. Brainstorm shipped
  as `fc9012f5`, plan as `23546aee`. Engine-specific failures: zero (after
  one in-session PreToolUse hook patch landed in crews v1.8.x to recognize
  `powershell` as the Copilot shell-tool name alongside `bash`).
- **`crews` plugin v1.8.11** (`fix/crews-spawn-default-engine-from-caller`
  on `evmitran_microsoft/ai-developer-toolkit`) shipped during that smoke
  test. `spawnMember()` now reads the caller-CLI session-env vars
  (`CLAUDECODE=1+CLAUDE_CODE_SESSION_ID` / `COPILOT_CLI=1+COPILOT_AGENT_SESSION_ID`)
  as the engine-default when no explicit `--engine` and no `CREWS_ENGINE`
  are present. Precedence (top wins): explicit `options.engine` > env
  `CREWS_ENGINE` > caller-CLI detection > `'claude'` (legacy fallback for
  non-CLI shells / scripted use).
- **Engine choice.** Either CLI is supported as the bookkeeper-lead; the
  trade-offs are roughly: Copilot is now the default driver (skills load
  from `~/.copilot/installed-plugins/...`, settings at `~/.copilot/settings.json`);
  Claude Code remains usable (skills load from `~/.claude/plugins/cache/...`,
  settings at `~/.claude/settings.json`) and was the historical default.
  The `bin/ralph-overview.mjs` resolver checks BOTH install layouts
  (see "Plugin resolution" above) — both engines work on the same workspace
  without conflict.
- **Known follow-ups surfaced by the smoke test** (none blocking):
  (a) **RESOLVED (crews v1.8.11, commit `2c658b23`).** Stale assertions in
  `tests/engine-env-bootstrap.test.js` referenced the pre-patch "bash tool"
  block message; the platform-aware F-016 fix updated them to "powershell
  tool" wording alongside the hook patch.
  (b) **RESOLVED (ralph-overview v2.5.0, commit `d7200aee`).** The
  `parseOverviewData` 1-statement strictness was relaxed by the data-
  relocation Job 1 ship: the loader now auto-detects by extension
  (`.json` → `JSON.parse`; `.js` → AST path with the 1-statement constraint
  retained for back-compat). The remaining adoption work (move codexu's data
  to `.ralph-overview/data.json`) is tracked as
  `ralph-overview-data-relocation-and-json-migration` Job 2.
  (c) `stop-member <name> bare positional reason text` rejected with
  `unexpected arg`; either accept trailing positionals or document
  `--reason` as mandatory for non-empty reasons.
  (d) **RESOLVED (`codexu-bin-ralph-overview-wrapper-retirement`).** The
  `bin/ralph-overview.mjs` resolver wrapper is now tracked in git (the
  `/bin/` line was removed from `.gitignore`) and includes the Copilot
  CLI install-path probe (`~/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/`)
  in its cascade. A fresh clone of codexu — under EITHER Claude Code or
  Copilot CLI — now gets a working `pnpm sync-ralph-state` and
  `pnpm overview` out of the box, no per-machine wrapper-copy or shell-rc
  required. See "Plugin resolution" above and the cross-engine smoke-test
  record at `.ralph/jobs/codexu-bin-ralph-overview-wrapper-retirement/smoke-test.md`.
  The longer-term plan to push the cross-engine resolution UPSTREAM into
  the plugin's own `scripts/init-consumer.mjs` (so future consumers do not
  each need a copy of this wrapper) is tracked as
  `ralph-overview-init-consumer-cross-engine-wrapper` in
  `.ralph-overview/data.json`. An external Copilot CLI feature request for
  per-plugin env-var parity with Claude Code's `$CLAUDE_PLUGIN_ROOT` is
  drafted in the plan's Reference Artifacts section
  (`.ralph/jobs/codexu-bin-ralph-overview-wrapper-retirement/plan.md`)
  and pending operator decision on when/whether to file.

### Codex submodule build situation

- **`rustup` + `cargo` ARE installed locally.** `cargo check --workspace`
  (~6 min) is the standard Phase-5a typecheck gate per `codex/CLAUDE.md`.
  Impl members can and should run it locally.
- **`cargo build --release` IS deferred to CI** — that needs the heavy
  publish toolchain (xwin + LLVM + V8 lib) installed only by
  `codex/.claude/commands/publish-sandbox-patch.md`.
- **Workspace-parse preflight** before any codex-touching spawn:
  `cd codex/external/repos/codex-patched/codex-rs && cargo metadata --no-deps
  --format-version 1`. Non-zero exit signals an overlay-coordination gap on
  the current branch; impl members would otherwise burn iterations
  attributing inherited breakage to their own edits.
- **`origin/main` always parses cleanly.** Feature-branch overlay gaps are
  mid-flight artifacts, not steady-state issues.

### Bookkeeper operational practice

- **Update `.ralph-overview/data.json` the same turn a task ships.** When a
  ralph member terminates clean (`terminal:complete`) and the work is on
  `origin/main`, flip `lifecycle: "tracked"` → `"merged"` (or `"archived"`
  for closed/superseded work), add `mergeCommit: "<sha>"` (comma-separated
  for dual-repo work — e.g., `"e9fa64a0,d279d49d"`), and refresh
  `lastTouchedAt`. Bundle multiple ships into one
  `chore(overview): update data for shipped tasks` commit per
  batch. The watcher updates the sidecar automatically, but
  .ralph-overview/data.json is hand-curated and goes stale otherwise — future
  agents querying it directly (not through the snapshot) see stale state.

- **Don't flip `lifecycle` until the work is actually on `origin/main`.**
  A member reporting `kind=done` but only pushed to a topic branch (or with
  CI still in flight) stays `tracked` with a comment about the in-flight
  state. Wait for the actual main-side commit before bookkeeping.

- **Peek the mailbox between tool-call clusters.** During extended
  investigations (debugging, multi-step setup) that exceed ~6–8 tool calls
  without a natural turn boundary, run `review-mail --peek` between
  sub-tasks. The Stop-hook is a backstop, not a primary signal — relying
  on it can miss a `kind=question` that arrives mid-investigation.

- **Don't re-arm the listener on every empty timeout cycle.** When the
  listener exits via timeout (not message delivery) and the conversation
  is idle (no mailbox content, no pending member checkpoint, no operator
  instruction), don't immediately re-arm and emit a content-free
  "Idle." turn. Each empty re-arm cycle burns a model invocation. Exception:
  when a member is mid-task and could checkpoint any moment, the re-arm
  is worth it.

### Architectural-fix preference

- **When a long-running coordination component (MCP server, watcher,
  daemon) misbehaves in normal multi-session use, propose an architectural
  fix — NOT a process-kill workaround.** "Kill the conflicting watchers and
  retry" is the wrong default; the assumption "one session per repo" is
  wrong, N concurrent sessions is legitimate use. The fix belongs in the
  component's cooperative-lease / passive-consumer code, not in operator
  muscle memory. Surface multi-session coordination bugs as candidate
  brainstorm or `/plan-with-ralph` tasks.

- **Dual-repo plans don't chain into `/implement-with-ralph` blindly.**
  When a finalized plan touches two repo roots, names two branch names in
  two repos, or has a phase-precondition gated on another repo's PR merge,
  pause the chain. `/implement-with-ralph` generates one PRD per repo; a
  dual-repo plan can't be expressed as one PRD without silently dropping
  half the stories. Offer: (a) planning-only result, (b) phase A manually +
  phase B later, (c) two separate Ralph jobs.

### Crews stop-hook semantics (for reference)

The lead session is exempt from the member kind-tag requirement (v1.8.1+):
lead prose-only turns pass Stop. Members still must emit a `<|report
kind="..." summary="..."|>` final-line tag every turn. The body-canonical
gate (v1.8.0+) hard-blocks `done`/`question`/`blocked` reports that put
substantive content in `summary` instead of the prose body
(default: `summary > 200` chars + body `< 50` chars triggers the block;
`CREWS_BODY_CANONICAL=off` disables it).

For the in-flight `overview-install-streamline` brainstorm — that work will
add agent-callable MCP tools (`overview.init`, `overview.upsert_task`,
`overview.mark_shipped`) that automate the bookkeeper duties this doc
describes. Until then, this AGENTS.md is the operating manual.

### Crews protocol v2.0.0 report rows

Crews v2 writes one member outbox JSONL row per kind-bearing report tag, not one envelope per assistant turn. Multi-report turns can produce multiple review-mail entries in one terminal-gated batch. Metadata-only report tags (ack/reply-to/decision without kind) are folded into the nearest kind-bearing row, including their prose body, and are not standalone outbox rows. Progress-only rows update member state and remain inspectable with `/crews:read-member <name> --all`, but do not wake the lead until a done/question/blocked row appears on the proactive non-reply path; rows with reply-to addressed to a lead still emit per-row member-reply notifications. `payload.progressTail` is retired; consumers should read the delivered `payload.entries` batch and must not assume `kind`/`summary` summarize a whole turn. Expanded review-mail rows keep the mailbox envelope id as the actionable ack/reply id, expose the member outbox row as outboxId/reportId, use entry.seq for the outbox seq, and include inboxSeq for the consumed mailbox-history seq.
