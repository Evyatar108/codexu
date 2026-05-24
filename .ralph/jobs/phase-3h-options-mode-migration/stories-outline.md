# Stories Outline: Phase 3h — options-mode plugin migration to codex

*Preliminary decomposition from `/plan-with-ralph` (2026-05-13). Feed to `/implement-with-ralph --from-plan` for PRD generation. Per plan acceptance criteria; AC numbers map to `plan.md`.*

## US-001: Scaffold package, workspace registration, and wire-contract spike
**Description:** As an operator, I want a new `packages/codexu-options-mode-plugin/` workspace member that installs cleanly so subsequent stories have a stable scaffold.
**Acceptance Criteria:**
- [ ] `packages/codexu-options-mode-plugin/package.json` with `name: "codexu-options-mode-plugin"`, `type: "module"`, scripts `test` (vitest run) and `typecheck` (`tsc --noEmit -p tsconfig.json`), dev-deps pinned to match `packages/happy-agent/package.json` (vitest 3.2.4, typescript 5.9.3).
- [ ] `packages/codexu-options-mode-plugin/tsconfig.json` with `allowJs:true, checkJs:false, noEmit:true, target:"ES2022", module:"ESNext", moduleResolution:"Bundler"`.
- [ ] `packages/codexu-options-mode-plugin/.codex-plugin/plugin.json` with `name`, `version`, `description`, `interface`, `skills: "./skills/"`, `hooks: "./hooks/hooks.json"`.
- [ ] `packages/codexu-options-mode-plugin/.agents/plugins/marketplace.json` with same shape as `packages/codexu-plugin/.agents/plugins/marketplace.json`, plugin entry pointing at `.`.
- [ ] `pnpm-workspace.yaml` appended with `- "packages/codexu-options-mode-plugin"`.
- [ ] Root `package.json` workspaces.packages appended with `"packages/codexu-options-mode-plugin"`.
- [ ] `packages/codexu-options-mode-plugin/tests/fixtures/codex-stop-spike.json` — single wire-contract fixture using plain string `transcript_path` / `last_assistant_message` per `NullableString` `serde(transparent)`.
- [ ] `pnpm install` from repo root completes without errors (AC-1).
- [ ] `pnpm --filter codexu-options-mode-plugin typecheck` exits 0 (AC-1).
- [ ] `codex plugin marketplace add packages/codexu-options-mode-plugin` succeeds; codex cache dir created at `~/.codex/plugins/cache/codexu-options-mode/codexu-options-mode-plugin/<version>/` (AC-16 partial).
- [ ] Typecheck passes
**Dependencies:** None
**Estimated complexity:** small

## US-002: Port `config.js` with PLUGIN_DATA-based state and tag constants
**Description:** As a developer, I want a `config.js` module that exposes byte-identical tag constants, mode resolution, and per-session/global state management against codex's `PLUGIN_DATA` env var.
**Acceptance Criteria:**
- [ ] `packages/codexu-options-mode-plugin/hooks/config.js` adapted from upstream `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/options-mode/0.16.12/hooks/config.js`.
- [ ] `getConfigRoot()` reads `process.env.PLUGIN_DATA`; throws if unset (fail-loud — no fallback).
- [ ] Tag constants byte-identical: `OPTIONS_NO_QUESTION_TAG`, `OPTIONS_BACKGROUND_TASK_TAG`, `OPTIONS_BACKGROUND_AGENT_TAG`, `OPTIONS_TASK_COMPLETE_TAG`.
- [ ] `FUNCTION_CALL_NAMES` constant array: `['request_user_input', 'ask_user_question']`.
- [ ] `isOptionsActive(session_id)`, `getOptionsMode(session_id)`, `setOptionsMode(session_id, mode)`, `appendLog()` exported and byte-identical to upstream behavior.
- [ ] `packages/codexu-options-mode-plugin/hooks/package.json` matches upstream (no runtime deps).
- [ ] `packages/codexu-options-mode-plugin/tests/config.test.mjs` covers: PLUGIN_DATA-throws, mode read/write per-session, global default state, counter-file SHA stability, tag-constant snapshot equality.
- [ ] All tests in `tests/config.test.mjs` pass under `pnpm --filter codexu-options-mode-plugin test`.
- [ ] Typecheck passes
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Port `session-start.js` and `user-prompt-submit.js`
**Description:** As an agent, I want SessionStart rule injection and UserPromptSubmit `/options-mode <args>` toggle parsing to behave byte-identically to upstream Claude — with a small SessionStart addition that prepends `options-mode: <mode>` as a statusline substitute.
**Acceptance Criteria:**
- [ ] `packages/codexu-options-mode-plugin/hooks/session-start.js` byte-identical to upstream EXCEPT for a leading `options-mode: <mode>\n` line prepended to the `additionalContext` payload.
- [ ] `packages/codexu-options-mode-plugin/hooks/user-prompt-submit.js` byte-identical to upstream.
- [ ] `tests/session-start.test.mjs` covers: rule injection for `on`/`strict`/`auto` modes contains the canonical upstream text + the new `options-mode:` prefix (AC-13); `off` mode → empty/omitted (AC-14).
- [ ] `tests/user-prompt-submit.test.mjs` covers all toggle forms: `on|off|strict|auto|status|default on|default off|default strict|default auto|default clear|default status` and pass-through for non-slash prompts (AC-15).
- [ ] All tests pass
- [ ] Typecheck passes
**Dependencies:** US-002
**Estimated complexity:** small

## US-004: Rewrite `stop.js` for codex `last_assistant_message` + transcript scan
**Description:** As a Stop hook running under codex, I want to detect missing tag protocols against codex's pre-extracted `last_assistant_message` and codex JSONL transcript shape, returning byte-identical block/pass-through decisions to upstream Claude behavior.
**Acceptance Criteria:**
- [ ] `packages/codexu-options-mode-plugin/hooks/stop.js` reads `input.last_assistant_message` and `input.transcript_path` directly as `string | null` (no object unwrap — `NullableString` is `serde(transparent)`).
- [ ] Preserve `if (input.stop_hook_active === true) return;` early-return verbatim from upstream (NOT inverted; verified at `codex/.../core/src/session/turn.rs:366, 557`).
- [ ] Preserve `if (input.agent_id || input.agent_type) return;` from upstream.
- [ ] Replace upstream `parseTranscript()` + `normalizeAssistantContent()` with: `last_assistant_message` direct read; if empty/null, scan `transcript_path` JSONL for the last `function_call` (`payload.type:"function_call", name in FUNCTION_CALL_NAMES`) after the last `payload.type:"message"` — pass-through if found.
- [ ] Preserve counter-file loop logic byte-identically (SHA hash of `transcript_path\nkey`, cap at 5).
- [ ] Preserve mode-aware block reasons (on / strict / auto) byte-identically.
- [ ] `tests/stop.test.mjs` covers AC-2 through AC-12:
  - AC-2: missing tag (on) → block
  - AC-3: no-question tag (on) → pass
  - AC-4: background tags (on/strict/auto) → pass
  - AC-5: no-question tag (strict) → block
  - AC-6: task-complete (auto) → pass
  - AC-7: no-question (auto) → block
  - AC-8: state off → pass
  - AC-9: empty last_assistant_message + trailing function_call (both name forms) → pass
  - AC-10: 6th call with same hash → pass + warning logged
  - AC-11: `stop_hook_active:true` → early-return
  - AC-12: `stop_hook_active:false` → normal enforcement
- [ ] All fixtures use plain string `transcript_path` and `last_assistant_message` (NOT object-wrapped).
- [ ] All tests pass
- [ ] Typecheck passes
**Dependencies:** US-002, US-003 (config + tag constants)
**Estimated complexity:** medium

## US-005: Wire `hooks.json` and `.codex-plugin/plugin.json`
**Description:** As an operator, I want the plugin to register its 3 hooks (SessionStart, UserPromptSubmit, Stop) with codex so they actually fire during a session — no PreToolUse (codex `request_user_input` has no `pre_tool_use_payload`).
**Acceptance Criteria:**
- [ ] `packages/codexu-options-mode-plugin/hooks/hooks.json` registers SessionStart (matcher `startup|resume|compact|clear`, timeout 5), UserPromptSubmit (no matcher, timeout 5), Stop (no matcher, timeout 35). Commands use `node ${CLAUDE_PLUGIN_ROOT}/hooks/<hook>.js` form (codex sets the env var per `discovery.rs:181-186`).
- [ ] **No PreToolUse entry** — codex `request_user_input` handler has no `pre_tool_use_payload` (verified `core/src/tools/handlers/request_user_input.rs`).
- [ ] `.codex-plugin/plugin.json` `hooks` field points at `./hooks/hooks.json` (or relies on codex default discovery — Story 1 spike confirms which).
- [ ] After `codex plugin marketplace add packages/codexu-options-mode-plugin` and starting `codex`, `~/.codex/log/codex-tui.log` (or the appropriate plugin-load log per Story 1 spike) shows no warnings about missing hook files or unresolved `${CLAUDE_PLUGIN_ROOT}` substitution (AC-16).
- [ ] Manual trigger: agent ends a turn with prose only → Stop hook fires, codex shows continuation prompt with block reason.
- [ ] Typecheck passes
**Dependencies:** US-001, US-002, US-003, US-004
**Estimated complexity:** small

## US-006: Discoverability skill, README, CLAUDE.md, statusline scripts, roadmap closure
**Description:** As an operator, I want clear install/troubleshooting docs, a discoverability skill, deferred statusline scripts (forward-compat), and the roadmap updated to reflect Phase 3h closure plus the two Phase 3h-tail follow-ups.
**Acceptance Criteria:**
- [ ] `packages/codexu-options-mode-plugin/skills/options-mode/SKILL.md` — documentation-only skill body (adapted from upstream `.codex-plugin/skills/options-mode/SKILL.md`). Remove the upstream "no Stop hook on this surface" claim. Skill body tells agent/user to type `/options-mode <args>` (UserPromptSubmit hook intercepts).
- [ ] `packages/codexu-options-mode-plugin/apps/statusline/options-mode-statusline.ps1` and `.sh` — copies from upstream `hooks/options-mode-statusline.{ps1,sh}`. Not wired to manifest. Forward-compat only.
- [ ] `packages/codexu-options-mode-plugin/README.md` — Install procedure with reproducible command sequence per AC-17; behavior matrix per mode; known gaps (statusline deferred, PreToolUse auto-intercept deferred); plugin-source-vs-cache developer-workflow note (delete `~/.codex/plugins/cache/codexu-options-mode/codexu-options-mode-plugin/<version>/` to pick up source edits); troubleshooting.
- [ ] `packages/codexu-options-mode-plugin/CLAUDE.md` — Engine notes: `NullableString` `serde(transparent)` wire form; `stop_hook_active` semantics identical to Claude (NOT inverted); `function_call name:request_user_input` detection (with `ask_user_question` forward-compat); codex env var aliases (`CLAUDE_PLUGIN_ROOT`, `PLUGIN_DATA`); plugin-source-vs-cache divergence; common mistakes ("don't restore Claude JSONL parsing in stop.js"; "don't add PreToolUse — codex `request_user_input` handler has no `pre_tool_use_payload`").
- [ ] `plans/codexu-roadmap.md` — Mark §Phase 3h done; add two Phase 3h-tail entries: (a) codex TUI statusline plugin slot; (b) codex `request_user_input` handler `pre_tool_use_payload()` override to enable AskUserQuestion auto-intercept.
- [ ] Manual end-to-end smoke test (AC-17): execute reproducible command sequence; agent receives continuation prompt; toggling `/options-mode off` makes Stop hook pass-through.
- [ ] AC-18 verification: `/codexu-options-mode-plugin:options-mode` skill appears in codex's skill listing (exact verification command confirmed during this story).
- [ ] AC-19: single commit referencing "Phase 3h".
- [ ] Typecheck passes
**Dependencies:** US-005
**Estimated complexity:** medium
