# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Pre-Interview | Post-Interview | Gap Resolved? |
|-----------|--------------|----------------|--------------|
| Goal | clear | clear | yes |
| Scope | partial | clear | yes |
| Criteria | partial | clear | yes |

## Clarifications

Four user decisions were gathered during planning:

1. **Smoke-test skill substitution.** Task suggested `/list-jobs` but source has `user-invocable: false`. User chose: "Pick a user-invocable skill instead" — keep list-jobs as `user-invocable: false`, smoke-test against `/brainstorm-with-ralph` (one of the 4 source-user-invocable skills).

2. **Body porting depth.** User initially chose "Full body port (Task → agent.spawn, paths, options-mode)". After Phase 4 multi-model review surfaced that codex's `agent.spawn` API is narrower than Claude's `Agent()` (denies unknown fields like `prompt`, `run_in_background`), user clarified: "we need to add support for these to codex if not available in some form, adding these to our roadmap." Final interpretation: do the syntactic prefix swap only (`Agent(subagent_type=` → `agent.spawn({agent_type:`), preserve other call args verbatim, and add roadmap follow-ups for codex API parity.

3. **`context: fork` frontmatter on 5 skills.** Task wording was ambiguous (mentions stripping "Claude-only fields like allowed-tools" but ralph has no `allowed-tools`). User chose: keep `context: fork` verbatim, add roadmap follow-up to track codex support.

4. **Roadmap-first ordering.** Mid-planning, the user directed that the §3a-tail roadmap entries be added as a **separate commit before** running implement-with-ralph, rather than baked into the Phase 3a implementation commit. Effect: this job's scope shrinks from "13 new + 2 modified" to "13 new + 1 modified" (skills + README only); US-004 removed from the stories outline; commit `607c44b5` is the prerequisite.

## Remaining Open Questions

- Manual smoke-test capture for `/skills` picker — no non-interactive automation in this repo; relies on implementer transcript/screenshot. If a TUI test harness lands later, retroactively automate.
- Submodule re-verification — implementer should `git submodule update --init codex` and confirm `manifest.rs:12-33` + `loader.rs:678` still match the assumed contract before starting body edits. If schema has drifted, stop and re-plan.
