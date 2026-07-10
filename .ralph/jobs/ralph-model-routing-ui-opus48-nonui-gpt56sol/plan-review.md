# Plan Review: Ralph UI/UX-Judgment Model Routing

## Review basis

- D-001 brainstorm Markdown and JSON
- Task row/plan seed in `.ralph-overview/data.json`
- Current wrapper/runtime/schema/generator/lowering/skill/agent/test/release sources
- Copilot CLI 1.0.70-0 custom-agent model-precedence probe

## Findings resolved

1. **Probe ambiguity:** Re-ran with exact namespaced `ralph-orchestration:code-reviewer`; `subagent.started` and `subagent.completed` both reported explicit `gpt-5.6-sol` over the agent's Opus metadata. Plan uses one YAML per role.
2. **Metadata clobber risk:** Added `overview-task-id.mjs` merge-preservation work and tests.
3. **Mixed execution ambiguity:** Defined binary story/call resolution, contradiction rejection, and compatible per-story host behavior.
4. **Generated-boundary ambiguity:** Enumerated generated outputs and the hand-maintained Copilot implement-skill exception.
5. **Historical literal conflict:** Separated active stale-literal bans from narrow immutable-history and `copilot-opus` compatibility allowlists.
6. **Dual-repo ship risk:** Kept implementation write scope in the toolkit submodule and made the codexu pointer/version-table update lead-owned after toolkit merge/push/dogfood.
7. **Resume-dispatch omission:** Added authored `list-jobs` plus both generated mirrors; its resume `Skill()` sites must forward classification and emit exact-model Tasks.
8. **Toolkit documentation drift:** Added toolkit-root `AGENTS.md`; its active Ralph summary currently names GPT-5.5/GPT-5.4/Opus-4.7 behavior and must migrate with 5.63.0.

## Verdict

Phase-4-ready. Six stories, serial execution, eight review findings resolved, and no open implementation decision or blocker.
