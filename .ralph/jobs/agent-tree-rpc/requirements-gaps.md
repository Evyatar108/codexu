# Requirements Gaps Assessment (Autonomous Mode)

## Dimension Ratings
| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | — Feature description explicitly states: expose codex's live spawn tree as a queryable + streamable RPC; two RPC shapes are named with full field lists. |
| Scope | clear | — Explicitly scopes work to `packages/happy-cli/src/codex/*` and `packages/happy-server/sources/app/events/*` with codex submodule READ-ONLY and "single commit on main". |
| Criteria | clear | — Explicit acceptance: codex spawns 2 sub-agents → happy-cli detects → happy-server fans out → vitest asserts ordered spawn-begin/end deltas with parent linkage + cross-package typecheck green. |

## Remaining Open Questions
- None blocking the plan. Two non-blocking design choices were resolved by research:
  1. `lastTaskMessage` is not directly exposed by the codex app-server protocol today — plan adopts best-effort derivation (from spawn prompt + later `agent_message` correlation) and marks the field optional in the wire schema.
  2. Spawn-begin has no child threadId — plan includes a `pending-spawn-started` variant in the delta union so the acceptance test can assert ordered begin/end deltas per child.
