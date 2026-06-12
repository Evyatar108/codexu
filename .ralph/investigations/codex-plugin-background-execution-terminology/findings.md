# Codex vs Claude/Copilot background-execution terminology gap in crews + ralph instructions

## Scope and guard

- Repo edits performed: **this file only**.
- Start-of-run repo status:
  - `D:\harness-efforts\codexu\ai-developer-toolkit`: clean (`git status --porcelain` returned nothing).
  - `D:\harness-efforts\codexu\codex\external\repos\codex-patched`: pre-existing dirty state in `codex-rs\tui\src\app\tests.rs`, `status_controls.rs`, `status_surfaces.rs`, `tests\status_and_layout.rs`, plus untracked `.worktrees\` (captured before any investigation work).

## 1. Codex source facts: what "background" actually means

### 1.1 Model-facing shell tools

Codex's model-facing shell surfaces are `exec_command`, `write_stdin`, and `shell_command`, not a `bash`/`powershell` tool with `mode: "async"` or `run_in_background`. The `exec_command` schema exposes `cmd`, `workdir`, `shell`, `tty`, `yield_time_ms`, and `max_output_tokens`; there is no `mode`, `async`, `detach`, `background`, or `run_in_background` field. `write_stdin` takes `session_id`, `chars`, `yield_time_ms`, and `max_output_tokens`. (`codex-rs/core/src/tools/handlers/shell_spec.rs:23-60,103-144`)

The model-visible descriptions are explicit:

- `exec_command`: "Runs a command in a PTY, returning output or a session ID for ongoing interaction." (`shell_spec.rs:81-91`)
- `write_stdin`: "Writes characters to an existing unified exec session and returns recent output." (`shell_spec.rs:131-145`)
- The output schema says `session_id` is the "Session identifier to pass to write_stdin when the process is still running." (`shell_spec.rs:247-278`)

### 1.2 Yield-based backgrounding

Codex backgrounds a command by waiting only until `yield_time_ms` expires, then returning while the process stays alive:

- `ExecCommandArgs` defaults `yield_time_ms` to `10_000` ms. (`codex-rs/core/src/tools/handlers/unified_exec.rs:26-67`)
- `process_manager.exec_command()` computes `deadline = start + Duration::from_millis(yield_time_ms)` and collects output only until that deadline. (`codex-rs/core/src/unified_exec/process_manager.rs:433-459`)
- If the process is still alive after that window, the response keeps `process_id`/`session_id` populated; if the process exited, the response clears it. (`process_manager.rs:509-591`, `process_manager.rs:707-743`)
- `write_stdin` explicitly treats an empty write as a poll of an existing background session. (`codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs:80-120`)

Conclusion: for Codex, "background" is **tool-level yield + later `write_stdin` polling**, not shell/OS backgrounding and not an async-mode flag.

## 2. How codex actually loads these instruction surfaces

### 2.1 AGENTS.md

Codex reads project instructions from `AGENTS.md` by walking from project root to cwd, with `AGENTS.override.md` preferred locally and optional fallback filenames configured via `project_doc_fallback_filenames`. (`codex-rs/core/src/agents_md.rs:1-17,37-45,335-349`)

The integration test proves those instructions are injected into model-visible user instructions. (`codex-rs/core/tests/suite/hierarchical_agents.rs:13-60`)

### 2.2 Skill bodies

Codex plugin skill bodies come from each plugin's `.codex-plugin/plugin.json` `skills` directory:

- crews hooks only: `.codex-plugin/plugin.json` points at `./.codex-plugin/hooks/hooks.json`. (`plugins/crews/.codex-plugin/plugin.json:1-19`)
- ralph skills: `.codex-plugin/plugin.json` points at `./codex-skills/`. (`plugins/ralph/.codex-plugin/plugin.json:1-21`)
- ralph-overview skills: `.codex-plugin/plugin.json` points at `./skills/`. (`plugins/ralph-overview/.codex-plugin/plugin.json:1-40`)

Codex injects a skill body only when the prompt contains a `$`-sigil mention:

- `TOOL_MENTION_SIGIL = '$'`. (`codex-rs/utils/plugins/src/mention_syntax.rs:1-7`)
- skill mentions are extracted with that sigil in `collect_explicit_skill_mentions()`. (`codex-rs/core-skills/src/injection.rs:254-319`)
- those mentions are turned into injected skill instructions during turn assembly. (`codex-rs/core/src/session/turn.rs:500-539`)

So `/slash` prose is not the Codex skill-loader. The Codex-facing skill text is the generated `.codex-plugin/**/SKILL.md` body reached via `$skill-name` / `$plugin:skill-name`.

### 2.3 Hook-emitted text

For crews, Codex receives hook text through the codex plugin hook overlay:

- `.codex-plugin/hooks/hooks.json` registers `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `Stop`. (`plugins/crews/.codex-plugin/hooks/hooks.json:1-60`)
- `codex-shim.js` documents that SessionStart context must be delivered via `hookSpecificOutput.additionalContext`, and that PreToolUse/Stop decisions are translated into Codex's JSON hook envelope. (`plugins/crews/hooks/codex-shim.js:17-35,156-236`)
- `codex-session-start.js` wraps the rendered briefing into `hookSpecificOutput.additionalContext`, which is what the Codex model sees. (`plugins/crews/hooks/codex-session-start.js:3-7,53-74`)

## 3. Verified codex-vs-copilot rendering

### 3.1 Live SessionStart capture

I exercised the real entrypoints `hooks/codex-session-start.js` and `hooks/copilot-session-start.js` against seeded member manifests. Both succeeded (`status: 0`) and both returned the same listener guidance text:

- Codex saw: `bash command and mode: "async" ... inspect its output with read_bash ... run /crews-review-mail` in `hookSpecificOutput.additionalContext`.
- Copilot saw the same text in `additionalContext`.

Live-capture output excerpt: `C:\Users\evmitran\AppData\Local\Temp\copilot-tool-output-1781236766894-716u8u.txt:1-155`

### 3.2 Live PreToolUse arm-block capture

I exercised the real entrypoints `hooks/codex-pre-tool-use.js` and `hooks/copilot-pre-tool-use.js` against seeded member manifests with no listener armed. Both succeeded (`status: 0`) and both returned the same block reason:

- Codex saw: `Run this powershell tool call now: ... mode: "async"` in both the top-level `reason` and `hookSpecificOutput.permissionDecisionReason`.
- Copilot saw the same `Run this powershell tool call now: ... mode: "async"` block in `reason` / `permissionDecisionReason`.

Live-capture output excerpt: `C:\Users\evmitran\AppData\Local\Temp\copilot-tool-output-1781236766894-716u8u.txt:157-207`

This is decisive evidence that the current Codex branch is **not** using Codex-native exec/yield terminology; it is reusing Copilot async-shell terminology.

## 4. Offending instruction surfaces

### 4.1 crews (high priority; hook-emitted and definitely reaches codex members)

| # | Surface | Reachability | Claude/Copilot sees | Codex sees | Why this is wrong |
|---|---|---|---|---|---|
| 1 | PreToolUse listener-arm block (`plugins/crews/hooks/pre-tool-use.js:557-628`) | Direct hook output | Claude: `Bash ... run_in_background: true`; Copilot: `powershell/bash ... mode: "async"` | **Same as Copilot** (live-captured) | Codex has no `mode: "async"` shell tool; shell backgrounding is yield + `session_id` + `write_stdin`. |
| 2 | SessionStart briefing managed-listener section (`plugins/crews/hooks/briefing/template.js:8-42`) | Injected via `codex-session-start.js` | Claude: `BashOutput` / `run_in_background`; Copilot: `read_bash` / `mode: "async"` | **Same as Copilot** (live-captured) | Tells Codex to think in Copilot shell-tool terms (`read_bash`, `mode: "async"`). |
| 3 | Continuation briefing managed-listener section (`plugins/crews/hooks/briefing/continuation.js:8-37`) | Injected on resume/continuation | Claude: `BashOutput` / `run_in_background`; Copilot: `read_bash` / `mode: "async"` | Source says **same as Copilot** | Same problem as SessionStart; resume-time listener guidance stays Copilot-shaped. |
| 4 | Stop hook listener-arm prose (`plugins/crews/hooks/stop.js:719-721`) | Stop-time block reason | Claude: `Arm via the Bash tool ... run_in_background: true` | Codex falls through the async-shell branch and gets `bash ... mode: "async"` | Still names the wrong shell contract for Codex. |
| 5 | Review-required / drain-the-mail builder (`plugins/crews/hooks/protocol/review-gate.js:79-103`) | PreToolUse/Stop review gate | Copilot sees `Run this bash tool call (synchronous; mode: "sync")`; Claude sees `run_in_background: false` | Codex gets `Run this bash tool call (synchronous; not in mode:"async")` | Better than item 1 because it warns against async mode, but it still tells Codex to use a `bash` tool call rather than `exec_command`/yield semantics. |

Notes:

- Engine detection for these branches is explicit and current: `manifest.engine === 'codex'` is recognized in `pre-tool-use.js`. (`plugins/crews/hooks/pre-tool-use.js:564-577`)
- The current implementation intentionally groups Codex with Copilot in the managed-listener prose. (`plugins/crews/hooks/briefing/template.js:13-18`, `continuation.js:9-12`)

### 4.2 ralph Codex skill mirrors (codex-facing skill bodies; also reaches codex members)

These are not source `skills/*.md` files. They are the generated Codex-facing skill bodies under `.codex-plugin/`, which Codex loads via `$`-sigil skill injection.

| # | Surface | Reachability | Claude/Copilot source text | Codex sees | Why this is wrong |
|---|---|---|---|---|---|
| 6 | `plugins/ralph/.codex-plugin/codex-skills/plan-with-ralph/SKILL.md:327-400` | `$ralph-orchestration:plan-with-ralph` | Source skill uses `run_in_background: true` / `BashOutput` | Generated Codex skill says `background: true`, `Spawn via Agent tool ... background: true`, `Wait for all background tasks to complete` | Codex shell backgrounding has no `background: true` arg; Codex subagents are `spawn_agent`/`wait_agent`, not `Agent(... background: true)`. |
| 7 | `plugins/ralph/.codex-plugin/codex-skills/brainstorm-with-ralph/SKILL.md:115-252` | `$ralph-orchestration:brainstorm-with-ralph` | Source skill says `run_in_background: true` | Generated Codex skill says `background: true` for Agent + Bash launches | Same stale background contract. |
| 8 | `plugins/ralph/.codex-plugin/codex-skills/multi-model-investigate/SKILL.md:85-121` | `$ralph-orchestration:multi-model-investigate` | Source skill says `run_in_background=true` and tells the user to use `BashOutput` | Generated Codex skill says `Codex (Bash, background: true)`, `Copilot (Bash, background: true)`, `Claude agent ... background: true` | Same stale background contract, across both shell and agent delegation. |
| 9 | `plugins/ralph/.codex-plugin/codex-skills/implement-with-ralph/SKILL.md:949-959` | `$ralph-orchestration:implement-with-ralph` | Source skill says `Run ralph via Bash with run_in_background: true` | Generated Codex skill says `Run ralph via Bash with background: true` | Same stale shell-background contract. |
| 10 | `plugins/ralph/.codex-plugin/internal-workflows/run-ralph/SKILL.md:104-118` | Internal codex workflow used by orchestration | Source internal skill says `run_in_background: true` | Generated Codex skill says `Execute ralph via Bash with background: true` | Same stale shell-background contract. |
| 11 | `plugins/ralph/.codex-plugin/internal-workflows/parallel-ralph/SKILL.md:120` | Internal codex workflow used by orchestration | Source internal skill says `multiple Bash tool calls, each with run_in_background: true` | Generated Codex skill says `multiple Bash tool calls, each with background: true` | Same stale shell-background contract, in the group orchestrator. |

### 4.3 ralph source skills that do **not** directly reach codex

The source `plugins/ralph/skills/*.md` files still contain many Claude/Copilot-era phrases such as `run_in_background: true`, `BashOutput`, and `Bash` (`skills/brainstorm-with-ralph`, `plan-with-ralph`, `multi-model-investigate`, `review-plan-with-ralph`, `run-ralph`, `parallel-ralph`). Those matter because the Codex generator currently lowers some of them into `.codex-plugin/` text, but **the source files themselves are not what a Codex member loads**. The Codex-facing bug surface is the generated `.codex-plugin/` mirror plus crews hook output.

### 4.4 ralph-overview

No relevant codex-facing async/background shell guidance was found in `plugins/ralph-overview/.codex-plugin/` or `plugins/ralph-overview/skills/` for this investigation.

## 5. Recommendation

### Recommended mechanism: (a) engine-aware rendering

Recommend **engine-aware rendering**, not generic wording, with two concrete seams:

1. **crews**: make the codex hook/briefing/review-gate branches emit Codex-native terminology:
   - shell tool: `exec_command`
   - short wait: `yield_time_ms`
   - continued session handle: `session_id`
   - follow-up polling/input: `write_stdin`
   - no mention of `mode: "async"`, `run_in_background`, `BashOutput`, `read_bash`, or `read_powershell` on codex branches

2. **ralph**: fix the Codex generator/lowering so emitted `.codex-plugin/` skill text stops saying `background: true` / `Agent(... background: true)` and instead describes Codex-native sequencing for:
   - long-running shell work: `exec_command` with a short `yield_time_ms`, then poll/re-enter with `write_stdin`
   - multi-agent work: Codex-native `spawn_agent` / `wait_agent` / `list_agents` / `close_agent` recipes (where those workflows already use them)

### Why not the other options

- **(b) Engine-neutral phrasing** is too weak for the load-bearing crews listener path. The current bug is precisely that the model maps "background" to the wrong engine semantics when the prose is vague.
- **(c) Codex glossary/translation note** would be additive but not authoritative. It still leaves the main instruction surfaces saying the wrong thing at the moment the model acts.
- **(d) Fix only crews** is insufficient. It would solve the highest-value listener-arm failure, but Codex-facing ralph skill mirrors would still tell Codex to use `background: true` for Bash and Agent calls.

## 6. Conflict surface, effort, and workflow call

### Files likely to change

- **crews**: `hooks/pre-tool-use.js`, `hooks/briefing/template.js`, `hooks/briefing/continuation.js`, `hooks/protocol/review-gate.js`, `hooks/stop.js`, plus tests covering codex/copilot branch text
- **ralph**: the codex generator/lowering path (`scripts/generate-copilot-artifacts.mjs`, `scripts/codex-lowering.mjs`) and regenerated `.codex-plugin/**` artifacts, plus generator tests
- **ralph-overview**: none expected for this task

### Version/conflict impact

- **Plugin version bumps** will be needed for **crews** and **ralph** only.
- **Marketplace indexes** will need synchronized version updates for whichever plugin(s) change.
- **Cross-engine test impact** is real but bounded: crews engine-rendering tests and ralph codex-generator/parity tests should cover most of it; a live codex dogfood on the load-bearing listener-arm path is still advisable before marking merged.

### Brainstorm vs plan

This should go **straight to plan**, not brainstorm.

Reason: the facts are already source-settled and live-captured. The seams are known, the failure mode is concrete, and the fix direction is straightforward: update engine-branch text in crews and the codex skill generator output in ralph. There is no open product-direction ambiguity left that needs a brainstorm.

## 7. End-of-run guard

After writing this report, the only repo change introduced by this investigation should be this file on branch `ralph/investigate-codex-bg-terms`. The pre-existing dirty state in `codex-patched` must remain untouched.
