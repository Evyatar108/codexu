# AGENTS.md (fork-level)

> Fork-specific guidance for AI agents working in this repo. Per-package guidance lives in `packages/happy-app/AGENTS.md`, `packages/happy-server/AGENTS.md`, etc. (mostly upstream). This file covers what's different about the fork.
>
> Filed as `AGENTS.md` rather than `CLAUDE.md` because the upstream repo's `.gitignore` excludes root-level `CLAUDE.md` (treated as per-developer personal context). Modern agent tooling (Claude Code, **Copilot CLI**, Cursor, Aider) auto-loads `AGENTS.md` in addition to `CLAUDE.md` files.

## Fork context

- **Fork:** [Evyatar108/happy](https://github.com/Evyatar108/happy). Remote name: `fork`. Upstream (slopus/happy) is `origin`.
- **Primary target device:** Android e-ink tablet. Every UX / perf decision is evaluated against that constraint first (weak CPU/GPU, no real compositor, hates smooth-scroll / continuous repaints). Opt-in features get a toggle that defaults `false` so non-e-ink users aren't affected.
- **Active branches:** `main` (mirrors `fork/main`, ahead of upstream by N), `feature/tablet-sidebar-toggle` (historical sidebar work, not for upstream), `fix/chat-list-perf-inverted-flatlist` (shipped upstream as PR #1154).
- **Server architecture — distributed per-daemon, NO central server (corrected 2026-06-27):** Do NOT assume or propose a single central happy-server. The `https://happy.evyatar.dev` Cloudflare-tunnel'd central instance (`localhost:3005` + named Cloudflare Tunnel) is **RETIRED / not in use** — the operator has flagged this to bookkeepers repeatedly; do NOT propose reusing it or a "Cloudflare provider-swap" shortcut. The **architecture** (operator-blessed, partly shipped as the **`agent-comms` "Scope A"** workstream — `plans/agent-comms-design.md §5`, task `agent-comms` @ `2a47a29c`, brainstorm `906ed67b`): **each machine runs a daemon that EMBEDS its own happy-server, with NO central broker.** The embedded *per-daemon* happy-server is load-bearing: it IS the session plane the Happy app pairs/syncs against (the 3-lens `906ed67b` verdict — you cannot drop it). **Codex autoconnect (`remote_session`) connects to the LOCAL per-daemon happy-server (`127.0.0.1:<tunnelPort>` from `~/.happy/machine.json`), NOT an external central server.** **Transport is PLUGGABLE, not Dev-Tunnels-only:** Microsoft Dev Tunnels was the assumed cross-machine transport, but the operator's **corporate policy BLOCKS Microsoft Dev Tunnels**, so an **ADDITIVE LAN / known-devices transport** (default-off, opt-in) is the active direction — task `remote-connectivity-lan-known-devices-additive-transport` (brainstorm D-001: per-daemon LAN listener + fail-closed server-side per-device cryptographic auth). When scoping "codex/agent sessions reaching the Happy app," frame it as **per-machine daemon, pluggable transport (Dev Tunnels OR LAN), never a central server / never happy.evyatar.dev**. (This note exists because bookkeepers have repeatedly mis-scoped against a central happy-server / the retired `happy.evyatar.dev` tunnel — e.g. the autoconnect-zero-friction mis-scope 2026-06-23 and the LAN-brainstorm "Cloudflare provider-swap" premise 2026-06-27.)

Full fork context, branches, build workflow, and "things that bit us" catalogue are in **`docs/fork-notes.md`** — read that before touching any fork-local setup.

Agent-readable Ralph pipeline state is emitted as `.ralph-overview/generated/ralph-state.{json,js}`; `.ralph-overview/generated/snapshot.json` is the merged aggregate snapshot for agents, and recent transitions append to `.ralph-overview/generated/activity.jsonl`. Artifacts are emitted by the **`ralph-overview` plugin** (installed via the `gim-home/ai-developer-toolkit` marketplace as of Plan 12). The plugin's watcher runs inside the Vite dev server during `pnpm overview` (delegating through `bin/ralph-overview.mjs dev`), or as a standalone process via `pnpm sync-ralph-state:watch` (delegating to `ralph-overview watch`). Both paths share the same `.ralph-overview/generated/.lock/sync.lock` and emit the same set of files. See `bin/ralph-overview.mjs` for the resolver wrapper that locates the installed plugin.

**Plugin resolution.** The resolver wrapper (`bin/ralph-overview.mjs` — **tracked in git as of the codexu-bin-ralph-overview-wrapper-retirement task**; previously gitignored / per-machine) checks (in order): `$RALPH_OVERVIEW_PLUGIN_ROOT` env, `$CLAUDE_PLUGIN_ROOT/ralph-overview/`, `$CLAUDE_PLUGIN_ROOT/cache/ai-developer-toolkit/ralph-overview/<latest>/`, `~/.claude/plugins/cache/ai-developer-toolkit/ralph-overview/<latest>/`, **`~/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/`** (Copilot CLI install layout — single live copy, no per-version subdir), then the in-tree local-dev fallback `./ai-developer-toolkit/plugins/ralph-overview/`. The fallback is resolved script-relatively from `bin/ralph-overview.mjs` via `import.meta.url`, so it works from any cwd inside a fresh clone and no longer depends on a machine-global sibling checkout. Because the wrapper is now tracked, a fresh clone of codexu under EITHER Claude Code OR Copilot CLI gets a working `pnpm sync-ralph-state` / `pnpm overview` out of the box after submodules are initialized — no per-machine wrapper-copy or shell-rc setup. For local development against an unmerged plugin branch, prefer editing the `ai-developer-toolkit/` submodule and committing both the toolkit change and the codexu submodule-pointer bump; set `RALPH_OVERVIEW_PLUGIN_ROOT` only when you intentionally want an external checkout. **Done:** the codexu install now uses the marketplace plugin registration (`enabledPlugins["ralph-overview@ai-developer-toolkit"]` in `.claude/settings.json` for Claude Code and the equivalent block in `~/.copilot/settings.json` for Copilot CLI); the old local-path `.mcp.json` entry and `enabledMcpjsonServers["ralph-overview"]` have been removed.

## Active plugin versions

<!-- BEGIN: active-plugin-versions -->
| Plugin | Pinned version | Source |
|---|---:|---|
| `ralph-overview` | `2.14.0` | `ai-developer-toolkit/plugins/ralph-overview/.claude-plugin/plugin.json` |
| `crews` | `3.24.6` | `ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json` |
| `ralph` (`ralph-orchestration`) | `5.61.0` | `ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json` |
<!-- END: active-plugin-versions -->

The table above is the CI invariant's source of truth. Update it in the same
commit as any `ai-developer-toolkit` submodule pointer bump that changes one of
those plugin manifests.

If the submodule integration ever needs to be backed out (a pinned plugin
version introduces a regression that cannot be forward-fixed in the
expected response window, or the submodule remote becomes inaccessible),
the rollback procedure lives at [`docs/submodule-rollback.md`](docs/submodule-rollback.md).
It walks through the revert commit-by-commit, the `git submodule deinit`
steps, the post-revert sibling-checkout restoration, and verifies what
state is preserved vs. cleared. The end-to-end smoke transcript for this
integration is at
[`.ralph/jobs/ai-developer-toolkit-submodule/smoke-test.md`](.ralph/jobs/ai-developer-toolkit-submodule/smoke-test.md).

## After a fresh clone of codexu

Run `git submodule update --init --recursive` before using the repo. Codexu has
two load-bearing submodules: `codex/` for the engine fork and
`ai-developer-toolkit/` for the local-dev plugin sources that back Ralph,
crews, and overview workflows.

For toolkit development, configure your operator-personal remotes inside the
submodule after initialization. The canonical submodule URL is
`https://github.com/evmitran_microsoft/ai-developer-toolkit.git`; add personal
or marketplace remotes inside `ai-developer-toolkit/` as needed for pushes.
Toolkit edits use a two-commit flow: first commit inside the submodule, then
commit the resulting `ai-developer-toolkit` pointer bump in codexu.

For dev-mode plugin execution from the submodule checkout, install dependencies
inside the plugin packages you run locally. The toolkit plugins use **npm
workspaces**, and `pnpm install` from inside a codexu checkout gets captured
by codexu's `pnpm-workspace.yaml` and hoists deps into codexu's `node_modules/`
instead of the plugin's own — which leaves the wrapper's
`existsPluginAt(<plugin>)` check failing because it looks for
`node_modules/chokidar` inside the plugin dir. Use `npm install` (or each
plugin's documented canonical command) instead:

```bash
cd ai-developer-toolkit/plugins/ralph-overview && npm install
cd ../crews                                                  # crews has no package.json today; skip install
cd ../ralph                                                  # ralph has no package.json today; skip install
```

Some plugins have no `package.json`; skip the install step there unless the
plugin adds one.

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
| Submodule rollback / emergency recovery (`ai-developer-toolkit`) | `docs/submodule-rollback.md` |

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
| **Update `.ralph-overview/data.json` when a task ships** | Use `node tools/data-edit.mjs mark-shipped <task-id> ...` (or `set-lifecycle` for archive/reopen) so the write is id-scoped, atomic, and invariant-checked |
| Commit + push the bookkeeping update | `chore(overview): update data for shipped tasks` |
| Stop the member cleanly | `/crews:stop-member <name>` |

> **Scope guardrail (codified 2026-06-08):** every duty above is
> *orchestration* — curate the backlog, choose the batch, drive members,
> bookkeep ships. The lead does NOT personally do research, source
> investigation, feasibility analysis, or coding (not even via its own
> `explore` / `research` subagents). That is member work. See
> **"Bookkeeper operating invariants > Lead orchestrates; members do the
> work"** below for the full boundary and the delegation recipes.

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

**Two-shard storage (ralph-overview ≥ 2.12.0):** the hand-curated store is split into a
HOT shard `.ralph-overview/data.json` (tracked/active tasks + metadata) and a COLD shard
`.ralph-overview/data.archived.json` (merged + archived tasks). The loader auto-detects
single-file (legacy) vs split and assembles the identical `{tasks:[...]}`, so every
consumer (watcher/MCP/viewer/projections) is unchanged. `data-edit`
(`mark-shipped`/`set-lifecycle`) moves a task between shards crash-safely under one store
lock. Edit the HOT file for active backlog work; the COLD file is touched only when a task
ships/archives. (Reading the full file into agent context is now ~5x smaller — the whole
point of the split.)

Stable task definitions: `id`, `scope`, `lifecycle`, `status`,
`lastTouchedAt`, `shipManifest`, legacy `mergeCommit`, `kanbanCards`, and `command{name,
descriptionHtml, warnings, prompts}`. This is what the operator and lead use
to plan: it carries the *intent* (`prompts.brainstorm`, `prompts.plan`, and
`prompts.impl` seeds, kanban cards, dependency notes in warnings). The lead
**must** flip `lifecycle` to `"merged"` and add `shipManifest` when a task
lands on `origin/main`; closed-without-merge work becomes `"archived"`. `mergeCommit`
is a deprecated read alias for old rows only; when both fields exist,
`shipManifest` is authoritative. The
full rule is codified below under "Bookkeeper operating invariants."

Use `node tools/data-edit.mjs <verb> ...` as the canonical write path for this
file. The helper delegates through `bin/ralph-overview.mjs data-edit` to the
installed `ralph-overview` plugin's shared mutation core, so CLI writes and MCP
write tools use the same id-scoped, atomic implementation. For large read-only
scans, prefer the generated projections (`active-tasks.json` for live backlog,
`summary-projection.json` when prompt/body bulk is not needed) over loading the
full hand-curated file into agent context.

The three phase-like axes are deliberately separate:

| Axis | Owner | Values | Meaning |
|---|---|---|---|
| `OverviewTask.lifecycle` | Bookkeeper data in `.ralph-overview/data.json` | `tracked`, `merged`, `archived` | Durable backlog/merge/archive status |
| `RalphPipelineState.stage` | Ralph watcher snapshot | `brainstorming`, `brainstorm-ready`, `planning`, `plan-ready`, `implementing`, `reviewing`, `shipped`, `blocked` | Runtime position in the state machine |
| `CrewSessionRef.phase` | Crew session reference | `brainstorm`, `plan`, `impl`, `null` | Intent of the member when it was spawned |

### `.ralph-overview/generated/ralph-state.{js,json}` — watcher-generated

Auto-emitted by `pnpm sync-ralph-state:watch` (or
`node bin/ralph-overview.mjs watch`) based on `.ralph/jobs/<slug>/job-state.json`. Carries the dynamic
state: `stage`, `terminalReason`, `storyCompletion`, `crewSessions`,
`branchName`, etc. **Do not hand-edit** — the watcher overwrites it.
If it's stale, the watcher has crashed; see `.claude/skills/overview-reset`.

The React viewer is owned by the installed/local `ralph-overview` plugin and
renders both sidecars merged into `.ralph-overview/generated/overview.html`.
The MCP server (`mcp__ralph-overview__*`) reads the watcher-generated
snapshot. Agents querying the canonical task list should read
`.ralph-overview/generated/snapshot.json` (the merged form).

### Other generated files (don't hand-edit)

- `.ralph-overview/generated/snapshot.json` — aggregated snapshot for agents
- `.ralph-overview/generated/active-tasks.json` — tracked-task projection for live backlog reads
- `.ralph-overview/generated/summary-projection.json` — all-task projection with prompt/body bulk stripped
- `.ralph-overview/generated/lean-tasks.json` — tracked-only AND fully body-stripped projection (the smallest tracked read, ~14% of the hot shard; prefer for agent backlog reads)
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
   Ralph state, and do NOT hand-edit `.ralph-overview/generated/ralph-state.js`. The original
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

See `./ai-developer-toolkit/plugins/crews/CLAUDE.md` for the full protocol.

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
lead: if this was the FINAL phase (impl ship), run
     node tools/data-edit.mjs mark-shipped <task-id> ...
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

### Lead orchestrates; members do the work (codified 2026-06-08)

**The bookkeeper-lead's job is to ORCHESTRATE tasks and members — NOT to do
the work itself.** "The work" includes technical research, source/codebase
investigation, external-repo research, feasibility analysis, scoping
deep-dives, and any coding. All of that is MEMBER work. This holds even when
the lead could technically do it faster in-session — doing it itself is the
anti-pattern the operator corrected on 2026-06-08: *"this research is not
something you should do, it should be a task that we assign to a member; your
job as the bookkeeper is to orchestrate the tasks and members."*

The boundary, concretely:

| Lead DOES (hands-on, in-session) | Lead DELEGATES to a member |
|---|---|
| Curate `.ralph-overview/data.json` (file backlog items, write prompts/cards, flip `lifecycle`, add `shipManifest`) | Research "what would it take to support X" / "how does Y work" |
| Pick the next batch (`overview_parallel_ready_tasks` + snapshot) | Investigate fork/codex/plugin internals to settle a claim |
| Spawn / stop / message members; review mail; relay operator decisions | Read external repos to scope an integration |
| Ship-ceremony git ops (FF-merge, push, worktree/branch cleanup) | Feasibility / GO-NO-GO spikes |
| Light bookkeeping verification (JSON.parse guard, `git status`, MCP queries, confirm a commit landed) | Brainstorm / plan / implement (the ralph phases) |

**This explicitly forbids the lead from using its OWN `task` subagents
(`explore`, `research`, `general-purpose`, `rubber-duck`) or its own direct
grep / view / web_fetch / web_search to perform investigation or research
work.** Those tools are for the lead's OWN orchestration housekeeping only
(e.g., locating a data.json edit anchor, confirming a ship landed on
`origin/main`, finding the line to edit in this doc). The moment a question
requires understanding how something works or what a change would entail, the
answer is "file a task and spawn a member," not "let me look into it."

How to delegate research, by shape:
- **Fuzzy "what's needed to support X" / "is X feasible" ->** file the task
  with a `prompts.brainstorm` seed and spawn a `/brainstorm-with-ralph` member
  (heavy multi-lens -> `--engine copilot`). The brainstorm member does the
  research and produces a recommended direction + conflict-surface analysis.
- **Narrow "settle this factual claim about fork/codex/a plugin" ->** spawn a
  focused read-only investigation member (cite file:line, commit findings under
  `.ralph/investigations/<topic>/`). See the "Settle a load-bearing factual
  claim" bullet below.
- **Concrete scoping with known files/edits ->** `/plan-with-ralph`.

The lead's value is in WHICH tasks run, in WHAT order, with WHICH seeds and
disjoint surfaces — not in personally answering the technical question. When
unsure whether something is lead-work or member-work, default to member-work.

### Lead takeover + the `resume-crew` footgun (codified 2026-06-08)

A fresh bookkeeper session does NOT inherit the lead binding automatically —
the lead manifest still points at the PREVIOUS session id (the one in the
handoff). Re-bind it EARLY, before arming:

- **Correct lead-takeover mechanism:** `assign-role lead --crew ralph-pipeline
  --name overview-bookkeeper`. It reads the session id from
  `COPILOT_AGENT_SESSION_ID` / `CLAUDE_CODE_SESSION_ID` and the state-cwd from
  the **`CREWS_STATE_CWD` env var** — it REJECTS a `--cwd` flag. (Flag surfaces
  differ per subcommand: `list-members` uses `--cwd`; `arm` uses `--cwd` +
  `--session-id`; `assign-role` uses env only. Check `<sub> --help` first.)
- After `assign-role lead`, verify the lead manifest `sessionId` equals the
  current session, THEN arm. `arm` fails `session-mismatch` until the rebind.

- **NEVER use `resume-crew --confirm` to re-claim the lead — it does NOT
  rebind the lead, and it is a mass-respawn footgun.** Per crews README L212,
  `resume-crew --confirm` *"respawns [every dead member] as fresh sessions."*
  On a long-lived crew like `ralph-pipeline` the roster accumulates HUNDREDS of
  historical dead members (273 dead / 298 total as of 2026-06-08), and
  `--confirm` relaunches all non-cleared ones at once — each a new wt.exe tab.
  On 2026-06-08 this froze the operator's PC and forced a window-kill
  (post-mortem: `.ralph/handoffs/2026-06-08-resume-crew-mass-respawn-postmortem.md`).
  The `--dry-run` "targets" list IS the respawn set — a long list means a long
  respawn, not a cleanup preview. Treat `resume-crew` as effectively-banned on
  `ralph-pipeline` until the roster is pruned. To recover ONE member, spawn it
  fresh by name instead.

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
  | **Submodule impl** (touches `codex/` or `ai-developer-toolkit/`) | `<submodule>/.worktrees/<task-id>/` — INSIDE that submodule | Lead/impl-member creates manually before editing. The worktree lives in the submodule repo it works on, and codexu records only the final submodule pointer bump. |
  | **Other cross-repo impl** (touches a sibling repo outside codexu) | `D:/<sibling-repo>/.worktrees/<task-id>/` — INSIDE that repo | Lead/impl-member creates manually before editing. The worktree lives in the repo it works on, not in the parent dir nor in codexu's state tree. |
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

- **Two FF-merge gotchas for plan/brainstorm branches (codified 2026-06-08).**
  Both bit repeatedly this session:
  1. **Stale-base phantom diff.** A plan/brainstorm branch forked before
     intervening ships shows phantom "reverts" of `.ralph-overview/data.json`,
     `AGENTS.md`, and the `ai-developer-toolkit` pointer in the two-dot
     `git diff main..<sha>` (the branch is *behind* on those files, not
     changing them). Confirm with the three-dot `git diff main...<sha> --
     <file>` (empty = the branch never touched it), then **rebase the
     member's worktree onto current main** (`git -C <worktree> rebase main`)
     so the FF is clean and additions-only. Do NOT FF a stale-base branch
     directly — it silently reverts the intervening ships.
  2. **Untracked-copy conflict.** Brainstorm/plan members often write their
     deliverables into BOTH their worktree AND the lead's primary checkout
     `.ralph/{brainstorms,jobs}/<id>/` dir, so `git merge --ff-only` aborts
     with "untracked working tree files would be overwritten". Verify each
     untracked copy is byte-identical to the branch blob
     (`git hash-object <wt-file>` == `git rev-parse <sha>:<path>`), then
     `Remove-Item -Recurse` the untracked copies and re-run the FF. Never
     blind-delete without the hash check.

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

- **Always push main to ALL configured remotes after every merge.** Codexu and
  its submodule repos can each have multiple remotes that must stay in lockstep
  — leaving any of them stale is operator surprise the
  next time they `git fetch` or try a `copilot plugin update`. The
  bookkeeper duty is: after `git merge --ff-only <sha>` or
  `git cherry-pick`, run `git remote | ForEach-Object { git push $_ main }`
  (or the equivalent loop) and verify every remote's `main` HEAD matches
  local. Surface any push failure (auth, permission denied, protected
  branch) immediately rather than silently leaving the remote behind.
  Codexu remotes today: `origin` (evmitran_microsoft), `personal`
  (Evyatar108). In `ai-developer-toolkit/`, toolkit remotes today are
  `origin` (evmitran_microsoft),
  `gim-home` (the marketplace source — `copilot plugin update` pulls
  from here), `personal` (Evyatar108). **`copilot plugin update`
  depends on `gim-home/main` being current**, so a sync miss there
  silently leaves every other consumer machine running the old plugin
  even after the operator runs `copilot plugin update`.

  > **See also (canonical, do NOT duplicate the ceremony in place):** `ai-developer-toolkit/plugins/ralph/AGENTS.md` under `## Lead-Owned Ceremonies > Multi-repo wrapper-to-submodule ship ceremony` — the canonical 7-step ship procedure (FF-merge submodule → push to all submodule remotes → verify → bump wrapper pointer → update active-plugin-versions table → commit wrapper → `copilot plugin update`). The ralph-side version is the source of truth; this codexu doc backlinks rather than re-derives so the ceremony stays single-source-of-truth across forks.

- **Cross-repo and submodule impl spawns need worktrees in EVERY shared repo.**
  When two or more impl members touch the same repo, including the `codex/` and
  `ai-developer-toolkit/` submodules, each needs its own worktree in that repo
  so they don't stomp each other's uncommitted state. The mandate is per-repo,
  not per-task. **Correct pattern:** `git -C <repo> worktree add
  <repo>/.worktrees/<task-id> -b ralph/<task-id> main`. For the toolkit
  submodule, `<repo>` is `D:/harness-efforts/codexu/ai-developer-toolkit`, not
  a sibling checkout. (The older recommended pattern `<repo>-<slug>` as
  a sibling-of-repo path was retired 2026-05-29 — see the worktree placement
  convention table above.) Enumerate every repo the plan touches before
  spawning; check `list-members` + manifest cwd for co-residents.

- **Submodule edits require two commits.** For changes under `codex/` or
  `ai-developer-toolkit/`, commit and push the submodule repo first, then commit
  the updated submodule pointer in codexu. Do not mix uncommitted submodule
  edits with a parent codexu commit; the parent commit can only record a SHA.

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

- **Default member engine is CODEX again — RE-ENABLED 2026-06-09 after the
  subagent-fan-out gap closed and a real-task codex dogfood passed.** The
  history: the 2026-06-08 `CREWS_ENGINE=codex` flip was briefly REVERTED on
  2026-06-09 because a live `codex-impl-dogfood` (commit `34368efa`) showed that
  while a codex member injects + drives `/implement-with-ralph` and commits
  cleanly, the **`Skill()`/`Agent()` subagent fan-out degraded** — Phase-2 PRD
  generation and Phase 5a/5b reviewer convergence couldn't run as real
  subagents (the member hand-scaffolded `prd.json` + self-reviewed). That gap
  was then CLOSED by task `codex-member-skill-agent-subagent-fanout` (D-002,
  shipped as **ralph 5.56.0**): ralph's write/review subagents now lower to
  NATIVE codex `spawn_agent` children, DUAL-support for both v1 (Collab) and v2
  (MultiAgentV2), detect-and-branch by tool presence. Two write-child smokes
  (v2 `69de6def`, v1 `9beb869a`) + TWO real `/implement-with-ralph` dogfoods
  proved real native spawn-child fan-out end-to-end: the US-005 fixture dogfood
  on **v2**, and a real-task dogfood (crews 3.19.0 review-mail overview,
  operator-approved plan) on **v1** — PRD-gen child + code-reviewer child +
  docs-reviewer child each ran as real native children and wrote their
  artifacts, NOT inline.
  - **Mechanism:** the User-level env var `CREWS_ENGINE=codex` was re-set on
    2026-06-09 (`[Environment]::SetEnvironmentVariable('CREWS_ENGINE','codex','User')`).
    Engine precedence (`hooks/actors.js` `spawnMember`): explicit `--engine` >
    `process.env.CREWS_ENGINE` > caller-CLI detect (Copilot/Claude) > `claude`.
    So **spawn members WITHOUT `--engine` to get a codex member**; pass
    `--engine copilot` only for a deliberate cross-engine member (HEAVY
    multi-lens brainstorm/plan members still go on copilot for reliability —
    see the engine-selection bullet below). A User-level env var only reaches
    NEW process trees, so a shell predating the flip needs
    `$env:CREWS_ENGINE='codex'` or explicit `--engine codex`.
  - **To REVERT** (if codex regresses):
    `[Environment]::SetEnvironmentVariable('CREWS_ENGINE',$null,'User')` — the
    default falls back to the caller-CLI mirror (copilot under Copilot CLI).

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
- **Codex rebase Phase 5a/5b protocol** lives in
  `codex/.claude/commands/rebase-upstream.md` `## Phase 5a` /
  `## Phase 5b`. Phase 5a is the HARD `cargo check --workspace` local
  gate before any `sandbox-patches` force-push; Phase 5b is the
  post-push `invariant-check` CI watch on `gim-home/codex@main` (or
  the documented interim-closeout path while CI is org-policy-blocked
  via `escalate-gim-home-actions-policy` — see the rebase skill
  `### Sunset checklist (self-triggering)` for the bookkeeper trigger
  on block lift). **Naming overlap warning:** NOT the same as
  codexu's impl-member Phase 5a/5b review-fix loop (the spawn-prompt
  invariant in this AGENTS.md). Same number, different scope: the
  rebase protocol gates the codex submodule pointer bump; the impl
  protocol gates the impl-story ship.

### Bookkeeper operational practice

- **Treat `ai-developer-toolkit/` as an in-tree submodule, not a sibling
  checkout.** It sits alongside `codex/` under codexu. Toolkit code changes ship
  as a submodule commit first, followed by a codexu parent commit that records
  the new `ai-developer-toolkit` SHA and any matching docs/version-table edits.
  Cross-repo worktree rules apply to both load-bearing submodules.

- **Dogfood a shipped CLI/tool feature via its REAL invocation path before
  flipping `merged` — green unit tests are NOT sufficient (codified
  2026-06-08).** crews v3.14.0's provisioner passed 295/295 but was 100%
  broken via the INSTALLED Copilot CLI (its toolkit-root resolver walked up
  from `~/.copilot/installed-plugins/…`, which has no marketplace index →
  ENOENT); only a live dogfood through the installed CLI caught it (fixed as
  v3.14.1). After the ship ceremony + `copilot plugin update`, run the
  feature once through the path a real lead/user would use (the installed
  CLI at `~/.copilot/installed-plugins/…`, NOT the in-tree `tools/*.js`) and
  confirm the happy path before the `merged` flip. This generalizes the
  crews-lifecycle rule (live smoke after green tests) to every CLI/tool ship.
  File dogfood-discovered bugs immediately with the exact repro command + the
  source root-cause.

- **Engine selection for spawns (updated 2026-06-09 — codex-default
  RE-ENABLED).** With `CREWS_ENGINE=codex` set, a bare spawn is a **codex**
  member. Codex impl members now run ralph's full `/implement-with-ralph` with
  real native spawn-child fan-out (ralph 5.56.0 D-002). EXCEPTION: HEAVY
  multi-lens work (brainstorm / plan members that fan out
  codex+copilot+devil's-advocate lenses) stays on **copilot** for reliability —
  heavy multi-lens members are the more crash-prone workload under heavy load
  (see the retired-cap note under "Continuous-flow pipeline"; this is an
  ENGINE-reliability point, NOT a count cap) — so spawn those with explicit
  `--engine copilot` (the
  `spawn-copilot-from-file.js` helper forces it). For routine impls, a bare
  spawn (codex) is the default; `spawn-from-file.js` also sets
  `CREWS_ENGINE=codex` explicitly. If codex regresses, revert per the
  engine-policy bullet above.

- **When seeding a brainstorm with the operator's directional preference,
  instruct it to VERIFY FEASIBILITY, not rubber-stamp (codified 2026-06-08).**
  The raw-codex-autoconnect v2 seed leaned hard toward one option (native
  Rust client, no happy-cli) but explicitly said "evaluate rigorously, do
  not rubber-stamp" — and the brainstorm earned its keep by correcting the
  operator's "overlay-only / zero upstream edits" framing with a
  source-verified finding (`Codex.rx_event` is a TUI-owned single-consumer
  mpsc, so a bounded upstream seam is unavoidable). A seed that only confirms
  the operator's framing wastes the lens process: bake the operator's intent
  in as the *lean* AND demand the disconfirming check.

- **Settle a load-bearing factual claim against SOURCE before it drives task
  framing — don't assert fork/codex internals from memory (codified
  2026-06-08).** A confident-but-wrong claim ("codex sub-agents recursively
  spawn sub-agents") nearly mis-shaped a task; a read-only source-investigation
  member proved the opposite (depth-limited-to-1 via a fork gate at
  `tool_config.rs:223-228`) and corrected the framing. When a task's
  direction hinges on how the fork / codex / a plugin actually behaves, spawn
  a focused read-only investigation (cite file:line, commit findings under
  `.ralph/investigations/<topic>/`) rather than reasoning from memory. The
  operator will (rightly) challenge unverified internal-behavior claims.
  **The investigation is a SPAWNED MEMBER — not the lead's own grep / view /
  `explore` / `research` subagent.** Settling the claim against source is
  member work (see "Lead orchestrates; members do the work" above); the lead's
  part is framing the question, spawning the read-only member, and recording
  the verdict in the task. A read-only investigation member should run on a
  pre/post working-tree snapshot+revert guard (tool-denial alone is not an
  airtight read-only sandbox on Copilot CLI).

- **Update `.ralph-overview/data.json` the same turn a task ships.** When a
  ralph member terminates clean (`terminal:complete`) and the work is on
  `origin/main`, flip `lifecycle: "tracked"` → `"merged"` (or `"archived"`
  for closed/superseded work), add `shipManifest` with `shippedAt`, a
  human-written 1-3 paragraph `summary`, and `commits[]` rows shaped as
  `{ sha, oneLine, repo? }`, and refresh
  `lastTouchedAt`. Bundle multiple ships into one
  `chore(overview): update data for shipped tasks` commit per
  batch. The watcher updates the sidecar automatically, but
  .ralph-overview/data.json is hand-curated and goes stale otherwise — future
  agents querying it directly (not through the snapshot) see stale state.
  Keep historical `mergeCommit` values for back-compat, but do not add it to
  new ship rows unless you are preserving an already-authored legacy alias.

- **Don't flip `lifecycle` until the work is actually on `origin/main`.**
  A member reporting `kind=done` but only pushed to a topic branch (or with
  CI still in flight) stays `tracked` with a comment about the in-flight
  state. Wait for the actual main-side commit before bookkeeping.

- **Wait for members via armed listener, NEVER periodic poll loops
  (codified 2026-06-03).** When a spawned member is running and there is
  no immediate parallel work for the lead to do, arm the lead listener
  (`node <crews-bin> arm overview-bookkeeper ralph-pipeline --cwd
  D:/harness-efforts/codexu --session-id <lead-session-id>` in async mode,
  with NO `--timeout-ms` — see "Arm the lead listener INDEFINITELY" below)
  and end the turn. The crews protocol delivers a `system_notification` when the
  member sends mail (the listener subprocess exits, the runtime fires
  the completion notification, the lead's next turn handles it via
  `/crews:review-mail`). Polling loops — "wait 30s, peek mailbox, wait
  30s, peek mailbox" or any analog — are forbidden because (a) every
  empty cycle burns a model invocation, and (b) a peek can race the
  same delivery the listener would have caught cleanly. The crews v3.4
  `lead-listener-unconditional` Stop-hook gate is the design-time
  enforcement; this bullet is the operating-discipline counterpart for
  the lead model itself. Operator-observed correction
  (2026-06-03T17:22): "never do periodic checks, it should always be by
  listeners."

- **Arm the lead listener INDEFINITELY — never pass `--timeout-ms`
  (codified 2026-06-06).** The crews listener supports indefinite blocking
  (`timeoutMs === null` → no timeout timers at all; crews v1.2.7). The
  hook-provided arm command (the one PreToolUse hands you on a block)
  already OMITS `--timeout-ms`, so it blocks until a message arrives and
  delivers in REAL TIME via `fs.watch` (the `via=watch` path). A manually
  added `--timeout-ms <N>` is an anti-pattern: when it expires it leaves a
  brief un-armed gap, and any member report that lands in that gap is only
  caught by the NEXT arm's `via=initial` scan — a multi-second-to-minutes
  delay instead of instant. Evidence (2026-06-06): a manual 20-min-timeout
  re-arm (`lead-listener-29`) timed out at 02:03:43; the impl's done report
  was written at 02:03:45 (`mailbox-history` seq 417 `sentAt`) — 2 seconds
  into the gap — and sat until the next arm's `via=initial` scan at
  02:04:20. There was NO watch/poll delivery bug (`crews.log` had no
  `orphan-consume-refused`; an earlier indefinite listener delivered
  `via=watch` in real time); the self-imposed timeout was the sole cause.
  ALWAYS arm with the exact hook-provided command (name + `--crew` +
  `--cwd` + `--session-id`, no `--timeout-ms`). With indefinite arming the
  "empty timeout cycle" failure mode below cannot occur — the listener only
  ever exits on a real delivery (then you re-arm after processing the mail).

- **Peek the mailbox between tool-call clusters WITHIN a single turn.**
  During extended investigations (debugging, multi-step setup) that
  exceed ~6–8 tool calls without a natural turn boundary, run
  `review-mail --peek` between sub-tasks. The Stop-hook is a backstop,
  not a primary signal — relying on it can miss a `kind=question` that
  arrives mid-investigation. This rule is WITHIN-turn only (between
  tool batches inside one assistant turn). BETWEEN turns the
  armed-listener rule above is the only valid pattern; do NOT
  peek-poll across turns.

- **Don't re-arm the listener on every empty timeout cycle.** When the
  listener exits via timeout (not message delivery) and the conversation
  is idle (no mailbox content, no pending member checkpoint, no operator
  instruction), don't immediately re-arm and emit a content-free
  "Idle." turn. Each empty re-arm cycle burns a model invocation. Exception:
  when a member is mid-task and could checkpoint any moment, the re-arm
  is worth it (and the re-arm itself satisfies the listener-first rule
  above — it is NOT a periodic-poll pattern; only ONE re-arm per timeout
  exit, immediately ending the turn).

### data.json helper safety (codified 2026-06-03; updated 2026-06-13)

`.ralph-overview/data.json` is the single most-edited file the bookkeeper
touches. Edits to it are also where the highest concentration of regressions
happen — observed 4 distinct regressions in a single session (2026-06-03)
where edit anchors matched the WRONG task object because the chosen anchor
text (e.g., `"lastTouchedAt":`, `"scope":`, `"lifecycle":`) is non-unique
across the ~135 task entries. The failure mode is silent: the edit succeeds,
the JSON parses, but a different task's `id` field is consumed or a foreign
block lands between tasks.

Rules:

1. **Canonical write path: use `node tools/data-edit.mjs`, not raw edits.**
   The helper delegates through the ralph-overview bin dispatcher to the shared
   mutation core used by the MCP write tools. Available verbs:
   `upsert-task`, `mark-shipped`, `set-lifecycle`, `add-kanban-card`,
   `set-prompts`. Run `node tools/data-edit.mjs --help` for exact flags.

2. **Ship bookkeeping uses `mark-shipped`.** Prefer
   `node tools/data-edit.mjs mark-shipped <task-id> --summary-file <file>
   --commits-file <json> [--shipped-at <iso>]` so `lifecycle`,
   `shipManifest`, and `lastTouchedAt` move together under one id-scoped lock.
   Use `set-lifecycle <task-id> archived` only for closed-without-ship work.

3. **Backlog/task-seed edits use the matching helper verb.** Use
   `upsert-task` for whole task rows, `add-kanban-card` for cards, and
   `set-prompts` for brainstorm/plan/impl seeds. Large text belongs in
   `--*-file` inputs; avoid inline PowerShell quoting for multiline content.

4. **MANDATORY: `node -e "JSON.parse(require('fs').readFileSync('.ralph-overview/data.json','utf8'))"`
   before every commit.** If it fails, do NOT commit. Recovery: read the
   diff against HEAD and locate the breakage; if unrepairable, `git checkout
   .ralph-overview/data.json` and redo the edit.

5. **Strongly recommended: enumerate task IDs before AND after the edit**
   via `node -e "...d.tasks.map(t=>t.id)...filter(i=>!i)..."` and compare
   counts. A drop in `tasks.length` OR a non-zero `without_id` count means
   a task was clobbered. Restore from `git diff HEAD .ralph-overview/data.json`
   and patch in place rather than `git checkout` (preserves intended edits).

6. **Raw edit anchors are last-resort only.** If the helper cannot express a
   one-off repair, anchor any manual edit on `"id": "<exact-task-id>"` plus the
   specific field being changed. Never anchor on non-unique fields like
   `"lastTouchedAt":`, `"scope":`, or `"lifecycle":`. For prepending before
   another task, anchor on the old task's exact `"id"` line and keep that line
   in the replacement so the old task survives.

7. **NEVER use `git add -A`** in a bookkeeping commit. Stage data.json
   explicitly. Otherwise generated sidecars (`.ralph-overview/generated/*`),
   gitignored CLAUDE.md, and untracked staging dirs end up in the commit.

### Task lifecycle state machine (codified 2026-06-03)

Every task moves through a sequence of bookkeeping states. Each state
transition has a specific `data.json` shape the bookkeeper writes. Documented
here so future bookkeepers don't re-derive the convention from examples:

| State | `lifecycle` | `kanbanCards[]` | `command.prompts.*` | `shipManifest` |
|---|---|---|---|---|
| **Filed** | `tracked` | 1 `cmd-warn` problem-statement card | Seed `prompts.brainstorm` OR `prompts.plan` | absent |
| **Brainstorm shipped** | `tracked` | + 1 `cmd-ok` "Brainstorm shipped @ SHA" card with recommended direction | Add `prompts.plan` with `--from-brainstorm` | absent |
| **Plan shipped** | `tracked` | + 1 `cmd-ok` "Plan shipped @ SHA" card with stories count + Phase 4 findings count + key reviewer corrections | Add `prompts.impl` with `--from-plan` | absent |
| **Impl shipped** | `merged` | Trim warn cards; keep brief ok cards (or replace all with a concise summary) | Keep all prompts as historical reference | **REQUIRED:** `{ shippedAt, summary (1-3 paragraphs human-written), commits: [{ sha, oneLine, repo? }, ...] }` |
| **Closed without ship** | `archived` | Keep cards as historical record + add cmd-warn "Closed because…" | Keep prompts | absent |
| **Re-targeted (pivot)** | `tracked` | Add `cmd-warn` "Plan @ SHA is OFF-TARGET due to design pivot…" card; existing plan-ship card stays as history | Rewrite `prompts.plan` with new direction; existing `prompts.impl` stays but is invalidated | absent |

Always refresh `lastTouchedAt` on every state transition. Always run the JSON
parse check before commit (per data.json edit-anchor safety rules above).

The 3 axes — `OverviewTask.lifecycle` (this state machine), watcher's
`RalphPipelineState.stage`, and `CrewSessionRef.phase` — are deliberately
independent and must not be conflated. See "Overview data — two-file split"
above for details.

### Parallel-spawn disjoint-surface rule (codified 2026-06-03)

When considering multiple impl-member spawns in parallel, check disjoint
surfaces at THREE levels:

1. **Repo level.** Spawns targeting different repos (codexu, ai-developer-toolkit,
   codex) are always parallel-safe.

2. **Plugin level (within the ai-developer-toolkit submodule).** Spawns
   targeting different plugins (`plugins/crews/`, `plugins/ralph/`,
   `plugins/ralph-overview/`) are parallel-safe at the plugin code level.
   BUT every plugin ship needs to bump `plugin.json`, edit `AGENTS.md`, and
   prepend `CHANGELOG.md` — and 3 of the 4 marketplace indexes carry
   `version` fields per plugin. Two impls targeting THE SAME plugin produce
   conflicting version-file writes and conflicting AGENTS.md/CHANGELOG.md
   prepends. **Same-plugin parallel = conflict; must serialize.**

3. **Cross-cutting docs.** Two impls that both touch `codexu/AGENTS.md` or
   both touch a shared `plans/<file>.md` will conflict on those files even
   if the plugin code is disjoint. Inspect the plan deliverables for any
   non-plugin file edits before spawning in parallel.

When same-plugin or shared-doc parallel is needed, the workflow is:

- **Bundle into ONE plan + ONE impl member** if the work naturally
  combines (e.g., crews v3.4 bundle = 2 stories in one impl ship), OR
- **Serialize via ship sequence**: spawn impl-A; let it ship; lead does
  FF + push + plugin.json bump; THEN spawn impl-B; impl-B rebases topic
  branch onto post-A toolkit main before push. Lead-orchestrated.

For 3-way parallel where two of the three conflict, file the 2 as a
serial bundle and run the 3rd alongside.

### Continuous-flow pipeline (codified 2026-06-09)

Prefer **continuous flow** over **batch-and-wait**: keep the pipeline
saturated near the concurrency cap and **top up the moment a member finishes
+ is processed**, rather than spawning a fixed batch and idling until the
whole batch completes. The operator asked for this explicitly (2026-06-09:
"continue spawning members instead of waiting for a new batch"). It maximizes
throughput while the lead is awake to babysit.

The rules that make it safe:

- **No capacity cap on member count (operator decision 2026-06-24).** There is
  NO fixed concurrency limit — spawn whatever is surface-disjoint (see the
  four-level disjointness rule below), and only back off if something *actually*
  crashes. The earlier "~2 concurrent heavy multi-lens" heuristic has been
  RETIRED: it was an over-cautious extrapolation from a SINGLE observed event
  (2026-06-06, session c62b26f0: two concurrent multi-lens brainstorm members
  died with a `.crews` lock-file crash), not a measured limit, and the operator
  explicitly removed it ("we dont have a capacity cap"). Keep that 2026-06-06
  event in mind only as a *failure mode to recognize* (multi-lens members fan
  out 3 xhigh lenses each, so heavy concurrent load can surface transient
  Windows `.crews` lock contention) — if a member dies pidAlive:false with no
  deliverable, respawn it and, if it recurs under load, THEN serialize that
  specific batch. Do not pre-emptively throttle. Still read the live roster +
  each member's phase before topping up so spawns stay disjoint — that is a
  correctness check, not a count cap.

- **Top-up candidate must be disjoint at ALL FOUR levels** (extends the
  three-level rule above): repo, plugin (within a submodule), shared-docs,
  AND **git-index**. The 4th is new: a member spawned with `--cwd` = the
  lead's primary checkout that does NOT use a worktree-managing skill (or a
  codex member that can't invoke the skill — see the `$`-sigil bug) commits
  in the SHARED codexu-primary checkout and races the lead's `.git/index.lock`
  / can flip the lead off `main`. Members whose skill-managed worktree lives
  in a SUBMODULE (`ai-developer-toolkit/.worktrees/...`) or a sibling repo do
  NOT touch the codexu-primary index, so they are git-index-disjoint and the
  safest top-ups while codexu-primary impls are also running. Prefer
  submodule/sibling-repo members as fillers when a codexu-happy-cli impl is
  already in flight.

- **Maintain a leverage-ordered ready queue.** When a surface frees, top up
  with the highest-leverage disjoint task that targets it. Heuristic order:
  (1) unblockers that free other work (e.g. the `$`-token fix unblocks codex
  members); (2) operator-priority features; (3) bug fixes with no workaround;
  (4) cleanup/follow-ups. Surface the queue to the operator so they can
  reprioritize.

- **Pause-points still apply mid-flow.** Continuous flow does NOT bypass the
  standing pauses: plugin VERSION pushes + `copilot plugin update` still
  pause for operator confirmation; dual-repo `/implement-with-ralph` still
  pauses for the proceed-vs-split decision; `kind=question` from a member is
  still relayed-or-decided per the usual rule.

- **Process-then-top-up, in that order.** When a member reports done: verify
  the commit, FF-merge/cherry-pick + bookkeep + stop the member FIRST, THEN
  spawn the next top-up. Don't spawn the replacement before the finished
  member is stopped — stale roster + extra live members compound the
  index-lock / resource pressure. Use the commit retry-with-backoff guard
  (loop `git commit` up to ~5x with a 3s sleep) because top-up members may
  hold the codexu-primary `index.lock` during the lead's bookkeeping commit.

### Impl-with-ralph capability surface (clarified 2026-06-03)

`/implement-with-ralph` is NOT limited to JS/markdown edits within
codexu's own packages. The capability surface is wider than the default
spawn examples suggest:

- **Can target any git repo** via `--target-repo <abspath>` flag (once
  the `ralph-orchestration-spawn-target-repo-override-flag` task ships) OR
  via the plan-analysis agent's repo-detection in convert-to-ralph-prd
  Step 1 (today's default). Submodule paths, sibling-repo paths, and the
  wrapper itself are all valid targets.

- **Can invoke the target repo's own `.claude/commands/` skills.** When
  an impl member targets the codex submodule, slash commands defined at
  `codex/.claude/commands/` (e.g., `/publish-sandbox-patch`,
  `/rebase-upstream`) are in scope. This means heavy release operations
  (cut a tag + push + GitHub Release upload) ARE impl-with-ralph driveable
  — they are NOT operator-only. The skill internally handles commit + tag
  + push so the AGENTS.md "ask before pushing" rule is honored by the
  skill, not bypassed.

- **Long-build impls are fine** if the build prereqs are in place. The
  codex release build is ~3 min with sccache warm; ~2h 47m cold. Impl
  members tolerate long builds; the operator's interactive bottleneck
  is the bookkeeper's review-mail cycle, not the build wall time.

- **Cross-account git pushes** (e.g., the SAML-authorized `evmitran_microsoft`
  account for the `gim-home` org vs the `Evyatar108` account for personal
  remotes) work inside impl-with-ralph via `gh auth switch`. Spawn prompt
  should include the explicit account-switching steps when the target repo
  needs an account different from the lead's current one.

When in doubt about whether something can be impl-with-ralph driven, ask
the operator — but default to YES rather than defaulting to operator-only.

### Listener re-arm + plugin update discipline (codified 2026-06-03)

**Listener re-arm**: the background listener PROCESS dies in four observed
patterns: (a) message delivery → exit (clean, logged `listener delivered`);
(b) idle timeout → exit (only if armed WITH `--timeout-ms`; we arm indefinite,
so this should not occur); (c) crash (e.g. the Windows lock-file race,
`UNKNOWN: open manifest.json.lock` errno-4094 — see
`crews-listener-eperm-rename-crash-recurring`); and (d) **silent reap across a
long idle / between-turns gap — NOT fully understood (see open question
below).** The Stop hook and PreToolUse hook both gate on
`listenerState == 'armed'`, but they differ in strictness — Stop hook is
lenient (only gates on terminal kinds or pending mail) while PreToolUse is
strict (any tool call requires armed listener). For LEAD sessions specifically,
when the listener exits via message delivery and the lead writes prose-only
turns, PreToolUse will catch the next tool call but Stop may silently allow
several intervening turn-ends (gap fix is filed as
`crews-stop-hook-require-lead-listener-unconditionally`).

**OPEN QUESTION — silent listener reap across idle (pattern (d), documented
2026-06-09, NOT yet root-caused):** A lead listener armed indefinitely
(`--timeout-ms` omitted, `timeoutMs=null`) was found `exited` after a long
idle/between-turns gap, with the lead later hitting the plain PreToolUse
"arm a listener" block (NOT the "review-required" nag, since no mail was
pending). EVIDENCE gathered (2026-06-09 session, gap ~22:53Z→00:16Z, ~1h23m):
(1) NO crews exit transition logged for that listener in the gap — no
`listener delivered`, no timeout, no `to=exited`; (2) NO crash/lock/EPERM/errno
line in `crews.log` during the gap; (3) `lastListenerEpoch` had reached ~148
(many spawn/re-arm cycles across the session); (4) the manifest heartbeat had
gone stale (the listener writes a heartbeat ~every 10s while alive). The
WORKING HYPOTHESIS (plausible, NOT proven): the runtime reaps the **attached**
async shell hosting the `arm` process across long idle/suspend periods — the
Copilot CLI documents that non-`detach` async processes are "attached to the
session" and killed on session shutdown/suspend; an external kill runs none of
crews' clean-exit code, which matches the total absence of an exit transition.
Because crews re-arms as the FIRST action each turn (PreToolUse-enforced), the
reap is normally self-healing; the ONE real risk is that a member `done`
landing DURING the dead idle window is not delivered in real time — it waits
for the next re-arm's `via=initial` scan (same class as
`crews-stop-hook-require-lead-listener-unconditionally`).
**OPERATOR CONSTRAINT (2026-06-09):** the listener MUST stay session-bound — do
NOT "fix" this with `detach: true` (a detached listener that outlives the
session is explicitly unwanted). A better solution must keep the listener bound
to the session while surviving idle gaps (candidates to explore in a future
deeper investigation: heartbeat-based liveness + automatic in-turn re-arm, a
lightweight session-bound supervisor, or simply accepting+narrowing the gap).
Tracked for deeper investigation as
`crews-listener-silent-reap-across-idle-investigation`.

In the meantime, the discipline:

1. After reading a `system_notification` for listener completion, if the
   listener delivered messages, run `review-mail` to process them, THEN
   either continue with a tool call (PreToolUse will block with arm prompt
   if needed) OR let the turn end naturally and PreToolUse will catch the
   next tool call.

2. Don't spam re-arms. Each re-arm spawns a node subprocess; spamming
   them creates the same leaked-async-shell pattern that the bg-gate
   filter has to handle.

3. The arm command is engine-aware and shipped with hooks: the PreToolUse
   block emits the EXACT command to run with the EXACT `mode: "async"`.
   Use it verbatim; don't substitute.

**Plugin update vs session restart**: when a plugin (crews, ralph,
ralph-overview, etc.) ships a new version and the lead runs `copilot plugin
update --all`, the new code is on disk under `~/.copilot/installed-plugins/<plugin>/`.
**No session restart is needed** because:

- Crews/ralph hooks (`hooks/*.js`) are spawned as fresh `node` subprocesses
  on every hook fire (PreToolUse, Stop, PostToolUse, SessionStart). They
  read the latest code from disk per invocation.

- The crews CLI (`crews.js`) is spawned fresh per `arm`/`review-mail`/
  `status`/etc. invocation.

- The long-running listener is respawned several times per session (every
  message delivery + idle timeout), so within a few minutes it's running
  the new code.

- The Copilot CLI session itself doesn't cache plugin CODE — only the
  hook-event subscription map at session-start time. The map shape hasn't
  changed across crews v3.0 → v3.3; ralph v5.46 → v5.49.

Restart IS needed when:

- A plugin adds/removes/renames a skill (the slash-command registry is
  session-start-time)
- A plugin changes its hook event subscriptions in `plugin.json`
- A new plugin is installed (the `enabledPlugins` map is loaded at start)

For routine version bumps (semantic refactors, bug fixes, new test
coverage), neither restart NOR `copilot plugin update --all` is blocking
— the hook code reads fresh from disk and the CLI session keeps working.

### Spawn-prompt preamble template (codified 2026-06-03)

For impl-phase member spawns, the stable preamble pattern observed across
2026-05-29 → 2026-06-03:

```text
You are the IMPL-phase member for task <task-id>.

Phase discipline: produce only the implementation commits per the plan;
do NOT chain into another task. Per codexu AGENTS.md the lead handles
FF-merge + push (ask-before-pushing); your scope is local commit on
topic branch <topic-branch> inside the <repo-or-submodule> worktree
at <worktree-path>.

The /implement-with-ralph skill manages worktree + Phase 5a (code
review-fix convergence) + Phase 5b (docs review-fix convergence). Drive
ALL phases to terminal — do NOT stop at Phase 4 stories-pass.

The plan is at <plan-path> (Phase-4 reviewed; <N> findings fixed;
<decomposition-shape>). [+ key plan corrections vs original spec]

[Specific scope notes: file:line refs, key invariants, what NOT to do,
relevant prior-art tasks, version bump target]

codexu root CLAUDE.md is gitignored — do NOT git add CLAUDE.md.
Fork-level guidance edits go in codexu/AGENTS.md only. Body-canonical
convention (substantive content in prose body, brief summary in attribute).

After local commit, report kind=done with: commit SHA + topic branch +
brief summary of fixed ACs.

RUN: /implement-with-ralph --from-plan <plan-path> --autonomous
```

For plan-phase spawns the same shape but with `/plan-with-ralph` invocation
and "produce only plan.md + stories-outline.md + Phase-4 review artifacts"
in place of the impl scope sentence. Operator-driven release skills
(`/publish-sandbox-patch`, `/rebase-upstream`) require a three-phase
prompt: Phase 5a workspace check → release cut → Phase 5b CI closeout.

### Rebase-as-closeout discipline (codified 2026-06-03)

Codex submodule rebase tasks (`codex-upstream-rebase`, `codex-rebase-*`) are
NOT complete when the rebase commits land on `gim-home/codex@main`. The
upstream `codex/.claude/commands/rebase-upstream.md` defines Steps 7+ as
the post-rebase closeout, mandatory for every rebase:

- **Step 7 / Phase 5a workspace check (HARD gate)**: `cargo check
  --workspace` from `codex/external/repos/codex-patched/codex-rs`.
  Non-zero exit → file additional `codex-rebase-debt-fix-<crate>` tasks
  BEFORE proceeding. Skipping this gate manifests later as 4+ reactive
  debt-fix tasks discovered by impl members hitting workspace-parse
  failures days later (observed 2026-05-30 → 2026-06-03 for the
  rust-v0.135.0 rebase).

- **Steps 10-12 release cut**: version bump in
  `external/repos/codex-patched/codex-rs/Cargo.toml`
  → release build → pack → commit + tag inside `codex-patched` submodule
  → wrapper gitlink update + wrapper tag → push to `gim-home/codex` with
  archival tag on `codex-patched` remote → GitHub Release tarball upload
  → smoke-test launcher. The `/publish-sandbox-patch` skill drives all
  of this. Skipping = consumers stuck on the prior release.

- **Phase 5b CI closeout (or interim closeout)**: watch `invariant-check`
  workflow on `gim-home/codex@main` for green. Since `escalate-gim-home-actions-policy`
  blocks `workflow_dispatch` on the gim-home org as of 2026-04, fall back
  to the documented interim-closeout path: cite the escalation task in
  `shipManifest.summary`. Bookkeeper triggers the rebase skill's
  `### Sunset checklist (self-triggering)` on block lift.

The bookkeeper enforces this by NOT flipping a rebase task's `lifecycle`
to `merged` until all three phases complete. A rebase task with rebase
commits on main but no release cut + no CI closeout stays `tracked` with
a `cmd-warn` card flagging the missing phases. See
`codex-cut-v0.135.0-copilot-api.1-release` (filed 2026-06-03) as the
canonical "closeout-missed → file separate task to drive it" pattern.

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
