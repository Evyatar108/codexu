# Requirements Gaps Assessment — Phase 3h options-mode migration

## Dimension Ratings
| Dimension | Pre-Interview | Post-Interview | Gap Resolved? |
|-----------|--------------|----------------|---------------|
| Goal | clear | clear | yes |
| Scope | partial | clear (decisions made autonomously) | yes — see Clarifications |
| Criteria | partial | partial (1 AC relaxed) | partial — statusline AC deferred |

Pre-interview rationale:
- Goal is clear — migrate plugin with byte-identical tag enforcement, all behaviors specified.
- Scope was partial because codex TUI rejects unknown slash commands before they reach UserPromptSubmit (per codex chat_composer.rs research) AND codex statusline is a built-in Rust enum with no plugin slot. Neither blocker is solvable in pure-plugin form.
- Criteria was partial because "statusline shows current state" cannot be met plugin-only.

## Clarifications

User was not present (auto options-mode). Decisions made autonomously using best judgment + Recommended defaults from research consensus:

1. **Slash command path**: Skill only — `skills/options-mode-toggle/SKILL.md`. Reason: pure-plugin path; no codex-core changes; matches what prior phase 3a precedent uses for command-like skills.

2. **Statusline path**: Defer to Phase 3h-tail follow-up. Reason: codex TUI statusline has no plugin slot. Ship `.ps1` + `.sh` scripts in plugin tree for forward-compat (no wiring), document gap in README + roadmap. Out-of-band substitute: SessionStart hook injects current mode into `additionalContext` so the agent and `/debug prompt-input` can see state.

3. **State storage**: `PLUGIN_DATA` env var (resolves to `~/.codex/plugins/<id>/data/` via codex). Reason: idiomatic codex pattern, cleanly isolated, no cross-agent coupling. No fallback to Claude config root — fresh start for codex.

## Remaining Open Questions

- **Statusline acceptance criterion**: Phase 3h ACs as written require "statusline shows current state". With statusline deferred, this AC cannot be met. Plan downgrades this to "state visible via SessionStart additionalContext + skill `/options-mode-toggle status` output". Operator should confirm this relaxation is acceptable before merging.
- **Slash command empirical confirmation**: Story 1 must verify whether `/options-mode` reaches UserPromptSubmit when typed in codex TUI. Codex CLI research says TUI rejects; copilot says uncertain. If it DOES reach the hook, defensive UserPromptSubmit handler is a bonus path. Story 1 records the actual TUI behavior in a test fixture.
- **Counter-file location**: Architect proposed `~/.codex-options-mode/.stop-counter-<sha>`; PLUGIN_DATA decision means counter lives in `${PLUGIN_DATA}/stop-counter-<sha>`. Stop-counter SHA hash key remains `sha256(transcript_path + "\n" + message_key).slice(0,32)` for parity.
