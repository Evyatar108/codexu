## Direction
D-001 — Minimal viable codex member, hook-enforced but skill-deferred.
All three brainstorm lenses (Codex Feasibility, Copilot Product-Reality,
Devil's Advocate) independently named a minimal-first variant; the
3-lens convergence is the strongest available signal that the
v1.3.0-Copilot-comparable "12-story port" is too aggressive as the
first ship.

## Goal

A spawned codex member can join an existing crew, receive a mailbox
message, emit a parseable `<|report kind="..." summary="..."|>` footer
that the lead's Stop hook validates, get stopped cleanly via
`/crews-stop-member`, and survive a `/resume-crew --confirm`. The MVP
is COMPLETE when an end-to-end smoke (spawn → receive → report → stop
→ resume) passes on a real codex CLI on the developer's Windows box,
WITHOUT shipping codex-flavored slash command files, WITHOUT a
progress-bg gate, and WITHOUT a daemon-bridge inversion.

The MVP is INTENTIONALLY DEGRADED in named ways (slash-command
discovery, progress-bg detection, codex-MCP-server bridge), with
written rationale for each deferral so a future ship can pick it up.

## Scope

### In Scope

- **`manifest.engine` enum** extended from `claude | copilot` →
  `claude | copilot | codex`. `normalizeEngine` rejects unknown values.
  `VALID_ENGINES` updated. Adds 0 new manifest fields (the existing
  `engine` slot already exists; only the enum widens).

- **`buildLauncherCommand(engine, options)` + `buildLauncherInvocation`**
  in `hooks/actors.js` gain a `codex` branch. Verified flags:
  `codex` (no subcommand for interactive; the prompt is positional),
  `--full-auto` (the safer "low-friction sandboxed automatic execution"
  default — `--dangerously-bypass-approvals-and-sandbox` is OUT OF
  SCOPE for v1 unless probe data shows `--full-auto` rejects required
  tool calls), `-C <cwd>` (working root), positional prompt. No
  `--name`, no `--plugin-dir`, no `-i` flag.

- **`readSessionEnv()` 3-way tiebreak** in
  `hooks/lib/session-env.js`. New marker: `CODEX_CLI=1` (verify
  actual var name via probe). New session-id env: `CODEX_AGENT_SESSION_ID`
  (verify name). Tiebreak when 2 or 3 are set: codex if
  `CODEX_CLI=1`, else copilot if `COPILOT_CLI=1`, else claude.

- **Launcher env scrub** (v1.6.1 + v1.6.1 follow-on for 3 engines).
  Codex launcher scrubs `CLAUDE_CODE_SESSION_ID`, `CLAUDECODE`,
  `COPILOT_AGENT_SESSION_ID`, `COPILOT_CLI`,
  `COPILOT_DISABLE_TERMINAL_TITLE`. Claude and Copilot launchers
  additionally scrub `CODEX_AGENT_SESSION_ID` and `CODEX_CLI`. Each
  launcher continues to stamp its own engine marker and
  `CREWS_ENGINE`.

- **`.codex-plugin/` overlay** mirroring `.copilot-plugin/`:
  - `.codex-plugin/plugin.json` — codex plugin manifest. Required fields
    (verified via fixture): `name`, `version`, `description`,
    `scope.agent` (use `"top-level"` for v1 — subagent support deferred
    to a follow-up; subagent context is not how crews members run),
    `interface.{displayName, shortDescription}`. Hook + skill block
    schemas to be verified by the probe spike against `options-mode`.
  - **5 codex hook shims**: `hooks/codex-{session-start,stop,pre-tool-use,
    user-prompt-submit,post-tool-use}.js`. Each shim translates the
    codex hook stdin/stdout shape into the existing Claude-shape
    `handleInput` from the corresponding `hooks/<event>.js` module.
    The actual event names + payload shape MUST be verified by the
    probe spike before this story can be completed.
  - **`hooks/codex-shim.js`** — pure stdin/stdout shape translator
    analog to `hooks/copilot-shim.js`. Pure functions, no
    module-level state.

- **Briefing variant** for codex in `hooks/briefing/template.js::renderListenerArmSection(ctx)`.
  Branch on `ctx.engine === 'codex'`. The arm command shape must
  match whatever async-bash-equivalent codex actually supports
  (probe spike output is gating). Skill-mention text in the briefing
  uses kebab form (`/crews-review-mail`) by default — codex's slash
  parsing also accepted only after probe spike.

- **Resume path** for codex in `/resume-crew --confirm` →
  `repairManifestForResume`. Reads `manifest.engine === 'codex'` and
  dispatches `codex resume <oldSessionId>` (verified flag — codex
  CLI does support `codex resume <SESSION_ID> [PROMPT]`). Transcript
  existence fallback uses the codex date-tree path. For the MVP,
  if transcript lookup is non-trivial (date-tree requires a glob),
  it's acceptable to skip the existence check and ALWAYS try
  `codex resume <id>`; codex returns a clean error if the id is
  unknown, and the launcher falls back to bare relaunch + full
  continuation briefing.

- **Plugin install / load model.** v1 ASSUMES the crews plugin is
  preinstalled in codex's marketplace cache. The spawn-time
  alternative (per-invocation `-c marketplaces.crews.source=<abs>`
  override) is in scope ONLY if the probe spike confirms the `-c`
  override works for plugin marketplaces; otherwise the install-prereq
  is documented and the launcher fails fast with a clear "install
  crews via codex plugin marketplace add first" error.

- **Tab title via wt.exe**. The `♙ <name> (<crew>)` pattern in
  `wtArgs` (v1.5.7 / v1.5.8) extends naturally; v1.8.12-style
  `CODEX_DISABLE_TERMINAL_TITLE` env stamp is in scope only if probe
  data confirms codex has a per-turn title-rewrite behavior to
  suppress.

- **Test surface**:
  - `tests/codex-shim.test.js` — analog to `copilot-shim.test.js`,
    pure-function tests for stdin/stdout shape translation.
  - `tests/codex-engine-field.test.js` — extends
    `tests/engine-field.test.js` with codex coverage:
    `normalizeEngine` accepts codex, manifest round-trips through
    spawn/resume preserving `engine: 'codex'`.
  - `tests/copilot-review-fixes.test.js` v1.6.1 launcher-scrub
    block: add codex parity assertions (codex launcher removes
    Claude + Copilot session env; Claude/Copilot launchers also
    remove codex session env).
  - `tests/integration/codex-member-smoke.test.js` — gated by
    `CREWS_CODEX_LIVE=1`. Live end-to-end with a real codex CLI:
    spawn, deliver one mail, receive one done report, stop, resume.
    SKIP if `CREWS_CODEX_LIVE` is unset (CI runs without).

- **Documentation**:
  - `AGENTS.md` § "v1.NEXT codex CLI support" entry following the
    v1.3.0 Copilot pattern.
  - `CHANGELOG.md` entry.
  - All 5 marketplace indexes + version test updated via
    `node scripts/bump-version.js <new-version>`.

### Out of Scope

- **21 codex-flavored SKILL.md files** under `.codex-plugin/copilot-skills/`
  (or codex equivalent path). Rationale: the slash-command surface is
  cosmetic; members can join and report via prose-and-tag without
  needing slash commands at all. Deferred to "v1.NEXT+1: codex
  skill overlay" once the plug-in load + hook plumbing is proven
  to work. The 21-file count matches Claude/Copilot today; deferring
  reduces v1 surface by ~21 files.

- **Progress-bg gate for codex** (v3.1.0 was Copilot-only by
  design). Codex must reach the v3.1.0 maturity bar on its own
  follow-on ship. Rationale: the gate needs codex transcript
  schema understanding (analog to Copilot's `events.jsonl`
  `tool.execution_start` + `system.notification.shell_completed`),
  which the codex `rollout-*.jsonl` format may or may not provide.
  Probe data missing today. Defer to "v1.NEXT+2: codex bg-liveness
  gate" or roll it into D-004.

- **Subagent-context plugin loading** (`scope.agent: "subagent"`).
  Crews members are top-level codex sessions, not subagents spawned
  inside another codex session. The `scope.agent` field defaults to
  the safer `top-level` value. Rationale: subagent participation
  in crews would be a meaningful protocol change (a subagent's
  parent session would also need to be visible to crews); explicitly
  out of scope.

- **`--dangerously-bypass-approvals-and-sandbox`**. v1 uses the
  safer `--full-auto`. Rationale: codex spawns the member into a
  developer-trusted directory; sandboxing the tool calls is the
  safer default. If `--full-auto` turns out to reject tool calls
  crews members need (e.g., writing to `~/.crews/`), the in-scope
  workaround is `--add-dir ~/.crews` before falling back to the
  dangerous flag.

- **Engine-identity refactor (D-003 from the brainstorm)**. The
  3-way `readSessionEnv` extension is a tactical fix, not the
  full sticky-manifest-identity refactor. Rationale: a refactor
  delivers no user-facing capability and risks regressing Claude/
  Copilot members. Defer to "v2.0.0: engine-adapter table" if the
  3-way env smell actually causes incidents.

- **Codex MCP/app-server inversion (D-005 from the brainstorm)**.
  This is a genuinely different integration paradigm (crews as
  codex daemon client). Rationale: codex's `app-server` and
  `mcp-server` subcommands are `[experimental]`; building on top
  of them is bet-the-future. The `codex-app-server-daemon-codexu-integration`
  task tracks the related research separately. D-001 deliberately
  keeps inversion open as a future option by minimizing crews-side
  codex assumptions.

- **CLI mirror surface for codex-spawned operator-trust commands**.
  v1 ships with codex member callable, not codex lead callable.
  Rationale: the lead role is more sensitive (registry writes,
  spawn auth) and codex lead support deserves its own design pass.
  The v1 happy path is: Claude or Copilot lead spawns a codex
  member.

### Plan-phase pre-requisite probe spike (Story #0 candidate)

Before the main implementation can start, the plan-phase MUST include
a research spike that produces the following artifacts:

1. **`codex-hook-probe-report.md`** — verified by reading
   `ai-developer-toolkit/plugins/options-mode/.codex-plugin/` end-to-end:
   - Actual codex hook event names (PascalCase / camelCase / snake_case)
   - Hook registration mechanism (`.codex-plugin/hooks.json`? Inline in
     `plugin.json`? Config-file?)
   - Hook stdin payload shape per event
   - Outbound decision shape (does codex honor `{ decision: 'block' }`?
     What's the SyntheticResponse path?)
   - Plugin manifest schema (full fields, defaults, enums)

2. **`codex-launcher-probe-report.md`** — verified by running the
   codex CLI with various flag combinations:
   - Confirmed env vars codex sets in child processes (incl.
     `CODEX_AGENT_SESSION_ID` and `CODEX_CLI` actual names)
   - Whether `-c marketplaces.<n>.source=<abs>` works for local
     plugin loading
   - Whether `--full-auto` rejects the kinds of tool calls crews
     members need
   - Whether codex's bash tool can keep a backgrounded subprocess
     alive across the hook return (the listener-arm prerequisite)
   - Whether `codex` has a per-turn terminal-title rewriter analog
     to Copilot's, and what env disables it

3. **`codex-resume-probe-report.md`** — verified by spawning two
   short codex sessions, capturing their session ids, then resuming:
   - Whether `codex resume <id>` reuses the same session id (analog
     to `claude --resume <id>` per v1.2.2)
   - Whether SessionStart hook fires with `input.session_id === <id>`
   - Whether transcript file lookup by date-tree is needed for the
     existence-check fallback

Probe spike output gates the rest of the plan. If probe data invalidates
D-001's hook-enforcement assumption (e.g., codex hooks don't honor
`decision: block` for built-in tools), the plan should replan to D-005
(inversion via MCP/app-server) or defer the project.

## Criteria

Plan-phase Acceptance Criteria should expand from this seed; the
brainstorm-level criteria are:

- **A1 — Codex member spawns.** From a Claude or Copilot lead session,
  `/spawn-member codex-member-1 --crew demo --engine codex --
  "report your engine field"` opens a wt.exe tab running codex,
  writes a member manifest with `engine: 'codex'`, and the member
  emits at least one `<|report kind="..." summary="..."|>` footer
  that the lead's Stop hook validates.

- **A2 — Mailbox delivery to codex member.** With the codex member
  from A1 running and listener armed, the lead sends a direct
  message via `/send-to-member codex-member-1 "ping"`. Within 5
  seconds, the member's listener delivers the envelope, the member
  reads it via `/crews-review-mail`, emits a `kind="done"` reply
  with `reply-to=<msg-id>`, and the lead's PreToolUse + Stop hooks
  treat the cycle as resolved.

- **A3 — Stop cleanly.** `/crews-stop-member codex-member-1` closes
  the wt.exe tab without leaving an orphan codex.exe or launcher
  pwsh process. `tasklist` post-stop shows neither.

- **A4 — Resume.** Tree-kill the member's launcher pwsh (simulating
  a PC restart). `/resume-crew --confirm` relaunches with `codex
  resume <oldSessionId>` (or bare `codex` + full continuation
  briefing if the transcript is missing), the resumed session
  emits at least one valid report tag, and the manifest's
  `listenerState` cleanly transitions through `recoverable` →
  `never-armed` → `armed`.

- **A5 — Env tiebreak under codex.** The full crews test suite
  passes (no regression on Claude / Copilot paths) AND a new
  `tests/codex-shim.test.js` (analog to `copilot-shim.test.js`)
  exercises the codex shim shape contract.

- **A6 — Deferral inventory written.** Every out-of-scope item in
  this brainstorm's "Out of Scope" section appears in `AGENTS.md`'s
  new "v1.NEXT codex CLI support" section with the rationale
  preserved, so a follow-up ship can pick it up without
  re-discovering.

- **A7 — Probe spike artifacts published.** The three probe reports
  named under "Plan-phase pre-requisite probe spike" are committed
  in the same PR (or as a prior PR), with the answer to each
  bullet captured. Probe-blocking unknowns must NOT be left for
  the implementation to discover.

## Context

This brainstorm carries Devil's Advocate `red_flag: true` against
the operator's framing. The contrarian argument (D-005: crews should
integrate via codex's mcp-server / app-server protocols rather than
launching codex as a third terminal-tab engine) is genuine. D-001's
hook-enforced-but-skill-deferred scope deliberately keeps the
inversion option open by minimizing crews-side codex assumptions —
the plan phase should re-read D-005 in `brainstorm-synthesis.md`
before locking in.

Cross-lens questions to carry forward to the plan phase (see
`brainstorm.json::questionsForSynthesis` for the full list):

- What are codex's actual hook event names + stdin payload shapes?
  (Probe-spike gate.)
- Does codex honor `{ decision: 'block' }` from PreToolUse for
  built-in tools?
- Can crews load a local plugin without mutating
  `~/.codex/config.toml`?
- Does codex's bash tool keep an async-spawned subprocess alive
  across the hook return?

Disconfirming observations the plan phase must watch for:

- **Hook decision-block not honored** — falsifies D-001's
  hook-enforcement assumption. Replan to D-005.
- **No async-listener subprocess survival** — falsifies the listener
  loop. Replan to a polling-only delivery mode or defer the project.
- **Probe spike reveals >3 stories require novel design (no Copilot
  analog) or global config mutation** — D-001 is still safe, but
  D-002 collapses; the implementation should resist scope creep
  back to D-002 mid-flight.

Related tracked tasks (engine-orthogonal):

- `codex-app-server-daemon-codexu-integration` [brainstorm-first,
  JUST FILED] — daemon-side integration; adjacent to D-005.
- `crews-roles-and-direct-operator-channel` [brainstorm-first] —
  engine-orthogonal.
- `codex-local-build` [brainstorm-first] — codex Rust workspace
  Windows build; not a prereq but useful context.
- `agent-comms` [tracked, plan, blocked] — same-daemon comm scope
  intersects with D-005.

Ship-count estimate: **1 ship for D-001** (probably 4-6 sessions
since the probe spike adds Story #0 and crews v1.3.0 took
"12 stories + 7 post-ship hardening releases"; D-001 trades the
21-skill overlay and progress-bg gate for time-to-MVP, putting it
closer to "8 stories"). Follow-on D-004 (durable parity) is a
separate ship. D-002 / D-003 / D-005 are explicit non-picks for
the next ship.
