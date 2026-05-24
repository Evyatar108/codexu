# Research Brief — Phase 3h: options-mode plugin migration

## Researcher Findings (Claude Explore agent)

**Claude source unreachable from agent's env.** Did not read `C:/ai-developer-toolkit/plugins/options-mode/` (architect agent did succeed — see below).

**Codex hook system mapped:**
- `codex/external/repos/codex-patched/codex-rs/config/src/hook_config.rs` — hook event types: `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`, `Stop`
- `codex/external/repos/codex-patched/codex-rs/hooks/src/events/stop.rs:23-31` — `StopCommandInput` includes `last_assistant_message: Option<String>` pre-extracted by codex
- `codex/external/repos/codex-patched/codex-rs/hooks/src/schema.rs:375-385` — Output: `decision: "block"`, `reason` (required if block, non-empty), `continue` (default true), `stopReason`
- Exit code 0 + JSON stdout OR exit code 2 + stderr both produce block; non-0/non-2 → hook failed
- `core/src/stream_events_utils.rs:436-451` + `core/src/session/turn.rs:2267-2274` — codex extracts `last_assistant_message` from `ResponseItem` entries via `get_last_assistant_message_from_turn()` before passing to hook

**Test runner: Vitest.** Pattern at `packages/happy-agent/src/*.test.ts`. Test-output convention: `.test-output/<package>.{typecheck,test}.log` (per `/run-tests` skill).

## Architect Analysis (Claude Explore agent)

**Claude source DID load:** `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/options-mode/0.16.12/` (different from feature-request path — that's the marketplace cache). 1249 LOC, 335 in `config.js`.

**Acceptance criteria scope (from architect synthesis):**
1. Plugin installs via `codex plugin marketplace add packages/codexu-options-mode-plugin`
2. Stop hook reads `last_assistant_message`, returns `{"decision":"block","reason":"..."}` on missing tag
3. Stop hook returns `{}` (pass-through) when tag present or mode is "off"
4. Counter file prevents infinite loops (>5 blocks → pass-through)
5. SessionStart injects rules via additional_contexts
6. UserPromptSubmit handles `/options-mode on|off|status`
7. State persisted to `~/.codex-options-mode/state.json` (primary) with Claude fallback
8. Tag protocol byte-identical

**Architect proposed 8-story decomposition:** scaffold, config/state, Stop hook, SessionStart+PreToolUse, UserPromptSubmit+skill, manifest wiring, tests+fixtures, docs+statusline.

**Loop detection:** Counter file at `~/.codex-options-mode/.stop-counter-<sha256(transcript_path\nmessage_key).slice(0,32)>`. Increment per call; if >5 → pass-through with warning.

## Codex Research

**Critical constraints surfaced (highest-risk findings):**

1. **Slash command blocker:** "Plugin `commands/*.toml` does not register native Codex slash commands. TUI rejects `/options-mode` as unrecognized BEFORE `UserPromptSubmit`, so true `/options-mode off` needs either a Codex TUI change or a skill/alternate command." (`codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/chat_composer.rs`)

2. **Statusline blocker:** "Statusline is built from Rust enum items, not plugin shell scripts." (`tui/src/bottom_pane/status_line_setup.rs`) — strict "statusline shows state" requires Codex core extension or accepting non-statusline substitute.

3. **Windows hook shell:** Default is `cmd.exe /C`; avoid `$PLUGIN_ROOT` in hook commands. Prefer `node -e "require(process.env.PLUGIN_ROOT + '/apps/hooks/stop.cjs')"`.

4. **Hooks run in user cwd**, not plugin root. Use `PLUGIN_ROOT`/`PLUGIN_DATA` env vars (codex also sets Claude aliases — see Copilot finding).

5. **Codex transcript lines:** `type:"response_item"` with `payload.type:"message"` or `payload.type:"function_call"`. Don't parse Claude shape.

**Recommended layout (codex):**
```
packages/codexu-options-mode-plugin/
  .codex-plugin/plugin.json
  hooks/hooks.json
  apps/hooks/config.cjs
  apps/hooks/session-start.cjs
  apps/hooks/user-prompt-submit.cjs
  apps/hooks/stop.cjs
  skills/options-mode-toggle/SKILL.md
  test/*.test.mjs
```

**Manifest schema** (`core-plugins/src/manifest.rs`): `RawPluginManifest` fields = `skills`, `mcpServers`, `apps`, `hooks`, `interface`. `hooks` can be string-path, string-array, inline object, or inline-object-array (`resolve_manifest_hooks()`).

## Copilot Research

**Confirms codex findings:**

1. **`CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` env vars are set by codex** (`hooks/src/engine/discovery.rs`) — materially lowers port risk for existing Node scripts that reference those vars.

2. **Statusline:** "no plugin hook/script slot for external statusline scripts" (`tui/src/bottom_pane/status_line_setup.rs`) — strict statusline AC cannot be met plugin-only.

3. **Slash command parity uncertain:** "depends on whether unknown slash text reaches `UserPromptSubmit` unchanged" — needs empirical verification or codex source read of chat_composer.rs to confirm.

4. **`request_user_input` is a separate tool/request flow**, not inline assistant text — structured-choice exemption needs transcript_path inspection for `payload.type:"function_call" name:"request_user_input"`.

5. **Test seam precedent:** `packages/happy-cli/src/codex/codex.integration.test.ts` for codex session testing. Use Vitest + deterministic fixtures.

## Consolidated File List

### Files to create (new plugin package)
- `packages/codexu-options-mode-plugin/.codex-plugin/plugin.json` — manifest
- `packages/codexu-options-mode-plugin/hooks/hooks.json` — hook registrations
- `packages/codexu-options-mode-plugin/apps/hooks/config.cjs` — shared state/tag detection
- `packages/codexu-options-mode-plugin/apps/hooks/constants.cjs` — tag constants + rule text (byte-identical from Claude source)
- `packages/codexu-options-mode-plugin/apps/hooks/session-start.cjs` — rule injection
- `packages/codexu-options-mode-plugin/apps/hooks/user-prompt-submit.cjs` — `/options-mode on|off|status` parser
- `packages/codexu-options-mode-plugin/apps/hooks/stop.cjs` — tag detection on `last_assistant_message`
- `packages/codexu-options-mode-plugin/skills/options-mode-toggle/SKILL.md` — fallback slash command (skill-based, since plugin can't register native `/options-mode`)
- `packages/codexu-options-mode-plugin/test/stop.test.mjs` — Stop hook unit tests
- `packages/codexu-options-mode-plugin/test/user-prompt-submit.test.mjs`
- `packages/codexu-options-mode-plugin/test/session-start.test.mjs`
- `packages/codexu-options-mode-plugin/test/fixtures/codex-stop-*.json` — mock StopCommandInput fixtures
- `packages/codexu-options-mode-plugin/package.json` — workspace member
- `packages/codexu-options-mode-plugin/README.md` — install, known gaps (slash/statusline)
- `packages/codexu-options-mode-plugin/CLAUDE.md` — engine notes

### Files to read as reference
- `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/options-mode/0.16.12/` — source plugin (1249 LOC; architect agent verified accessible)
- `D:/harness-efforts/codexu/packages/codexu-plugin/.codex-plugin/plugin.json` — codex manifest example
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/core-plugins/src/manifest.rs` — RawPluginManifest schema
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/core-plugins/src/loader.rs` — hook discovery rules
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/config/src/hook_config.rs` — hook event types
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/hooks/src/schema.rs` — stdin/stdout JSON shapes
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/hooks/src/events/stop.rs` — Stop hook contract + tests
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/hooks/src/engine/discovery.rs` — env var setup (`PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT` aliases)
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/chat_composer.rs` — slash command rejection (verify empirical behavior)
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/status_line_setup.rs` — statusline gap (no plugin slot)
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/core/src/session/turn.rs` — Stop hook loop semantics, `last_assistant_message` population
- `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/rollout/src/recorder_tests.rs` — codex JSONL transcript examples
- `D:/harness-efforts/codexu/plans/codexu-roadmap.md` §Phase 3h (lines 1871-2431)
- `D:/harness-efforts/codexu/packages/happy-cli/src/codex/codex.integration.test.ts` — test pattern
- `D:/harness-efforts/codexu/packages/happy-agent/src/*.test.ts` — vitest pattern

### Test/build commands
- `pnpm typecheck` / `pnpm test` per package
- `.test-output/<package>.{typecheck,test}.log` caching (run-tests skill)
- New plugin package needs workspace entry in `pnpm-workspace.yaml`

## Cross-source consensus

All three external sources (architect, codex, copilot) agree:
1. **New package** `packages/codexu-options-mode-plugin/` (not folded into codexu-plugin)
2. **Keep Node.js hooks** — codex sets `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` aliases, minimal port surface
3. **Use `input.last_assistant_message`** for tag detection — do NOT parse Claude JSONL shape
4. **Slash command blocker** — pure plugin cannot register `/options-mode`; codex/copilot flag this; architect did not but architect's "skill body calls hook via /options-mode" plan implicitly works around it
5. **Statusline blocker** — no plugin slot exists; must defer or codex-core patch

## Divergences

- **Statusline path:** Architect proposes shipping ps1/sh scripts for forward-compat; codex+copilot say "surface gap to operator" without shipping. Both compatible.
- **State storage:** Architect says `~/.codex-options-mode/` with Claude fallback; codex says use `PLUGIN_DATA` env var (which codex resolves to `~/.codex/plugins/<id>/data/` or similar). Codex recommendation is more idiomatic.
- **Slash command empirical question:** Copilot says "verify whether unknown `/options-mode` reaches the hook"; codex says "TUI rejects before UserPromptSubmit" (more definitive). Story-1 should empirically confirm.
