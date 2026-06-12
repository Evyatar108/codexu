# codex CLI vs Claude Code workflows parity

## Scope

Compared Claude Code's documented workflows feature set from:

- `https://code.claude.com/docs/en/workflows`
- `https://code.claude.com/docs/en/permission-modes`
- `https://code.claude.com/docs/en/settings`
- `https://code.claude.com/docs/en/headless`
- `https://code.claude.com/docs/en/agent-sdk/overview`

against the codex fork surfaces in:

- `codex/external/repos/codex-patched/codex-rs/`
- `codex/codex-rs-overlay/`
- `codex/`

## High-level verdict

Claude Code workflows are a first-class, user-visible orchestration product: Claude can author a workflow script, run it in the background, show a dedicated `/workflows` UI, resume the run in-session, and save the orchestration as a reusable command.

Codex does **not** currently have an equivalent workflow product. What it does have is a useful set of adjacent building blocks:

- upstream-native **Plan mode**
- upstream-native **multi-agent / subagent** tools and agent-thread switching
- upstream-native **background terminals**
- upstream-native **resume/fork session** flows
- upstream-native **non-interactive `exec`** plus **TypeScript/Python SDKs**

Those pieces make codex a plausible host for a future workflow system, but today they do **not** add up to Claude Code workflow parity.

## Claude workflow feature inventory

I enumerated **17** distinct workflow capabilities explicitly documented across the pages above:

1. Dynamic workflows are model-authored **JavaScript scripts** executed by a dedicated runtime in the background.
2. Claude ships a built-in `/deep-research` bundled workflow.
3. A user can trigger a one-off workflow from chat with `ultracode` or a natural-language "use a workflow" request.
4. `/effort ultracode` enables automatic workflow planning for substantive tasks across the session.
5. CLI/Desktop show a **pre-run approval** prompt/card with phase list and script-view options.
6. Runs execute in the **background** while the session remains responsive.
7. `/workflows` opens a dedicated **run browser / progress view**.
8. The task panel shows a one-line **live progress summary** for a running workflow.
9. The progress UI supports **phase/agent drill-down** plus pause/resume, stop, restart-agent, and save-script actions.
10. A completed workflow can be **saved as a reusable command** in project or user scope.
11. Saved workflows accept structured **`args` input**.
12. Each run persists its generated **script file** under the session directory and the user can inspect/edit/relaunch it.
13. A stopped run can **resume within the same session** and reuse completed-agent results.
14. The runtime has documented **behavior/limits**: no mid-run user input, no direct FS/shell access from the script itself, up to 16 concurrent agents, 1,000 total per run.
15. The docs expose **workflow-specific cost/model guidance**.
16. Workflows are available across **CLI, Desktop, IDE, `claude -p`, and Agent SDK** surfaces.
17. Workflows can be **disabled** via `/config`, `settings.json`, env var, and org-managed settings.

## Parity matrix

| Feature | Claude Code behavior | Codex equivalent | Evidence or gap note |
|---|---|---|---|
| Dynamic workflow runtime | Claude writes a JS workflow script and a background runtime executes it (`workflows`) | **NO** | Codex exposes no user-visible workflow runtime. Built-in slash commands are enumerated in `codex/external/repos/codex-patched/codex-rs/tui/src/slash_command.rs:12-76` and do not include `/workflows`. Internal `SessionTask` runners are framework internals for "regular chat, reviews, ghost snapshots" rather than user-authored workflow scripts: `codex/external/repos/codex-patched/codex-rs/core/src/tasks/mod.rs:292-299`. |
| Bundled `/deep-research` workflow | Built-in research workflow with fan-out web search, source fetch, cross-check, and cited report (`workflows#bundled-workflows`) | **NO** | No `/deep-research` command appears in the built-in slash command registry at `.../tui/src/slash_command.rs:12-76`; no `ultracode`/`deep-research`/`/workflows` matches were found in `cli/src`, `tui/src`, or `core/src`. |
| One-off workflow trigger from prompt | `ultracode` keyword or "use a workflow" request launches a one-off workflow (`workflows#ask-for-a-workflow-in-your-prompt`) | **NO** | No `ultracode` trigger surface exists in codex source under `cli/src`, `tui/src`, or `core/src`; closest user-visible planning surface is `/plan` in `.../tui/src/slash_command.rs:115-117`. |
| Session-wide ultracode mode | `/effort ultracode` auto-plans workflows for substantive tasks (`workflows#let-claude-decide-with-ultracode`) | **PARTIAL** | Codex has session planning knobs, but not automatic workflow orchestration: `/plan` = "switch to Plan mode" and `/model` = "choose what model and reasoning effort to use" in `.../tui/src/slash_command.rs:108-117`; Plan-mode-specific reasoning override exists in `.../core/src/config/mod.rs:874-880` and `.../tui/src/chatwidget/settings.rs:156-176`. |
| Pre-run approval + script review | Before launch, Claude shows phases and options like run / don't ask again / view raw script (`workflows#approve-the-plan-before-it-runs`) | **PARTIAL** | Codex has a plan-to-implementation confirmation popup, but not workflow-script approval: `Implement this plan?`, `Yes, implement this plan`, `Yes, clear context and implement`, `No, stay in Plan mode` in `.../tui/src/chatwidget/plan_implementation.rs:9-18` and `:77-113`. |
| Background execution while chat stays responsive | Workflow runs in background while session stays free (`workflows#watch-the-run`) | **PARTIAL** | Codex has adjacent background primitives, not a workflow runner: multi-agent tools (`spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `close_agent`, `list_agents`) are wired in `.../core/src/tools/spec_plan.rs:649-690`, and the TUI exposes `/ps` and `/stop` for background terminals in `.../tui/src/slash_command.rs:104-105` and `.../tui/src/chatwidget/slash_dispatch.rs:406-410`. |
| Dedicated `/workflows` browser / progress view | `/workflows` lists runs and opens a phase/agent progress UI (`workflows#watch-the-run`) | **PARTIAL** | Codex has agent-thread navigation, not a workflow run browser: `/subagents` and `/agent` map to "switch the active agent thread" in `.../tui/src/slash_command.rs:69-70` and `:115-119`; agent inventory is available through `list_agents` in `.../core/src/tools/handlers/multi_agents_v2/list_agents.rs:6-41`. |
| Task-panel live progress summary | Running workflow shows one-line progress in the task panel (`workflows#run-a-bundled-workflow`) | **NO** | No user-visible workflow/task-panel feature surfaced in the built-in slash command list (`.../tui/src/slash_command.rs:12-76`), and no `/workflows` command exists to back one. |
| Drill into phases/agents; pause/resume/stop/restart/save | Workflow UI can inspect phases/agents and control the run (`workflows#watch-the-run`) | **PARTIAL** | Codex exposes adjacent agent controls, but not workflow phases or restart/save-script: `wait_agent` blocks on mailbox change with configurable timeout in `.../core/src/tools/handlers/multi_agents_v2/wait.rs:22-80`; `close_agent` exists in `.../core/src/tools/handlers/multi_agents_v2/close_agent.rs:26-118`; CLI has session `Resume` and `Fork` subcommands in `.../cli/src/main.rs:175-179`. |
| Save workflow as reusable command | Save a run into `.claude/workflows/` or `~/.claude/workflows/` and invoke it later as `/<name>` (`workflows#save-the-workflow-for-reuse`) | **NO** | Codex has reusable **skills/plugins**, but no workflow-save surface. Relevant nearby commands are `/skills` and `/plugins` in `.../tui/src/slash_command.rs:28-29` and `:53-55`; there is no `/workflows` save flow and no `.claude/workflows`-like path referenced in `cli/src`, `tui/src`, or `core/src`. |
| Structured args for saved workflows | Saved workflows receive structured `args` input (`workflows#pass-input-to-a-saved-workflow`) | **NO** | No saved-workflow command surface exists in codex, so there is no equivalent `args` plumbing. |
| Persisted generated script file | Each run writes its generated script under the session dir and the user can inspect/edit/relaunch it (`workflows#how-a-workflow-runs`) | **NO** | No workflow-script persistence surface appears in codex CLI/TUI/core sources; codex session persistence that does exist is thread/session persistence, e.g. TypeScript SDK `resumeThread()` documents threads under `~/.codex/sessions` in `codex/external/repos/codex-patched/sdk/typescript/src/codex.ts:30-37`. |
| Resume paused workflow in-session with cached completed agents | Stopped runs can resume in the same session and reuse completed-agent results (`workflows#resume-after-a-pause`) | **NO** | Codex can resume conversations (`/resume`, CLI `Resume`) but not paused workflow executions with cached sub-results: `Resume` slash description at `.../tui/src/slash_command.rs:87-90`; CLI subcommand at `.../cli/src/main.rs:175-176`. |
| Documented workflow runtime limits | No mid-run user input; no direct FS/shell access from the script; 16 concurrent agents; 1,000 total per run (`workflows#behavior-and-limits`) | **PARTIAL** | Codex has some agent runtime limits, but not a workflow-runtime contract. MultiAgentV2 exposes `max_concurrent_threads_per_session` config in `.../features/src/feature_configs.rs:9-39`, defaulting to `4` in `.../core/src/config/mod.rs:189` and `:1016-1031`; `wait_agent` timeouts are configurable in `.../core/src/config/mod.rs:1002-1013`. Also, codex explicitly *does* support interactive user input via `request_user_input` in Plan mode: `.../core/src/tools/handlers/request_user_input_spec_tests.rs:136-144`. |
| Workflow-specific cost/model guidance | Docs explain workflow token cost, per-agent usage, and model-routing guidance (`workflows#cost`) | **PARTIAL** | Codex has model/reasoning controls, but no workflow cost UI or per-stage routing surface: `/model` description in `.../tui/src/slash_command.rs:108-115`; Plan-mode reasoning override in `.../core/src/config/mod.rs:874-880` and `.../tui/src/chatwidget/settings.rs:156-176`. |
| Workflow availability on CLI/Desktop/IDE/headless/SDK | Same workflow feature is available from interactive apps, `claude -p`, and Agent SDK (`workflows#turn-workflows-off`, `headless`, `agent-sdk/overview`) | **PARTIAL** | Codex has multiple surfaces, but not workflow parity across them: interactive CLI/TUI default path in `.../cli/src/main.rs:86-116`, non-interactive `Exec` subcommand in `.../cli/src/main.rs:118-123`, and SDK thread APIs in `codex/external/repos/codex-patched/sdk/typescript/src/codex.ts:7-38` plus sibling Python/TypeScript SDK trees under `codex/external/repos/codex-patched/sdk/`. |
| Disable workflows via config/settings/env/org policy | `/config`, `"disableWorkflows": true`, `CLAUDE_CODE_DISABLE_WORKFLOWS=1`, and org-managed settings disable workflows (`workflows#turn-workflows-off`, `settings`) | **NO** | No workflow feature exists to disable in codex, and no `disableWorkflows` / `disable_workflows` key appears in `codex-rs/core/config.schema.json` or codex `cli/src` / `tui/src` / `core/src` workflow-adjacent sources. |

## Counts

- **YES:** 0
- **PARTIAL:** 8
- **NO:** 9

## Most notable gaps worth filing

1. **Workflow product MVP (`/workflows` + persisted run registry)**
   - **Worth filing:** Yes, high value.
   - **Rough shape:** build a user-visible orchestration layer on top of the existing upstream-native multi-agent tools (`spawn_agent`, `wait_agent`, `list_agents`, `close_agent`), with persisted run metadata and a TUI browser.

2. **Prompt-triggered workflow creation / ultracode equivalent**
   - **Worth filing:** Yes, high value.
   - **Rough shape:** add a first-class trigger path that converts a user request into an orchestration plan, instead of making the user manually juggle `/plan`, `/subagents`, and thread switching.

3. **Saved reusable workflows**
   - **Worth filing:** Yes, medium-high value.
   - **Rough shape:** define a codex-native saved-workflow format and storage location (likely codex-owned rather than `.claude/workflows`), plus invocation as a slash command or CLI subcommand.

4. **Dedicated deep-research workflow**
   - **Worth filing:** Yes, medium value.
   - **Rough shape:** either a native bundled workflow once a workflow runtime exists, or an interim plugin/skill that standardizes fan-out research + source cross-checking.

5. **Workflow-specific approval / policy surface**
   - **Worth filing:** Yes, medium value.
   - **Rough shape:** separate workflow-launch approval, script review, and "remember this workflow in this repo" consent from today's generic permission and Plan-mode prompts.

6. **Run-resume semantics with cached completed-agent results**
   - **Worth filing:** Yes, medium value.
   - **Rough shape:** persist orchestration state/results separately from normal chat resume so interrupted long-running automation can continue without redoing finished agents.

## Guard note

Read-only guard captured start status for:

- `D:/harness-efforts/codexu`
- `D:/harness-efforts/codexu/codex`
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched`

End-of-task scoped guard confirmed the only new repo path introduced by this investigation is:

- `.ralph/investigations/codex-cli-vs-claude-code-workflows-parity/findings.md`

The whole-tree start/end compare was noisy because the pre-existing dirty tree is large and one long pre-existing untracked line was wrapped in the original capture artifact, but the normalized compare surfaced this investigation directory as the only intentional new path from this work.
