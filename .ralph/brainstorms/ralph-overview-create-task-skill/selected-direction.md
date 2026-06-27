---
overviewTaskId: ralph-overview-create-task-skill
---

## Direction
D-002 — Guided create-only `/create-task` skill + a `createOnly` flag pushed into the shared `upsert-task` core. The skill interactively gathers the Filed-convention fields, pre-checks duplicates, confirms before writing, and writes ONCE through the shared core; the core's new `createOnly` option makes the no-clobber guard atomic (inside the data-file lock, over the hot+cold union) because there is no delete/undo verb and an accidental upsert-over-existing-id is silent and irreversible.

## Goal
A new cross-engine `ralph-overview` guided slash skill (working name `/create-task`) that an operator/agent runs to interactively file a new `tracked` task into `.ralph-overview/data.json`. It asks the minimum filing fields, blocks duplicate ids (atomically, including collisions with cold/archived tasks), assembles the canonical Filed-convention task object, confirms it with the user before writing, and writes exactly once through the existing `upsert-task` mutation core — printing the resulting unified diff as the record. It performs NO git staging/commit/push (the lead/operator owns git side-effects). It works identically on Claude Code and Copilot CLI like the other ralph-overview skills.

## Scope
### In Scope
- ADD `ai-developer-toolkit/plugins/ralph-overview/skills/create-task/SKILL.md` (Claude/source-of-truth), matching the `overview-init` dry-run -> confirm -> apply house style.
- GENERATE the Copilot mirror `.copilot-plugin/copilot-skills/create-task/SKILL.md` via `node scripts/generate-copilot-artifacts.mjs --write`; the SKILL.md body MUST avoid the forbidden tokens (`Skill(`, `Agent(`, `BashOutput`, `run_in_background`, `EnterPlanMode`, `ExitPlanMode`) so the generator/CI drift-check passes.
- EXTEND the shared core `scripts/lib/data-edit-core.mjs` `upsert-task` verb with a `createOnly`/`failIfExists` option that throws BEFORE write when a task with the same id already exists (hot OR cold), under the existing `${dataFile}.lock`. This is reuse/extension of the shared core, satisfying constraint 3.
- Wire the option through both surfaces: a `--create-only` flag in `scripts/data-edit.mjs` (CLI) and an `overview.upsert_task` Zod field + handler in `tools/overview-mcp/src/` (MCP). Keep CLI and MCP writes byte-identical.
- Interactive field set (prompted): `id` (validated `^[A-Za-z0-9_./-]+$`), `scope` (closed multiple-choice taxonomy + pipe-combine + other), `descriptionHtml` (short one-liner), the single `cmd-warn` problem-statement kanban card, `initialStage` (`brainstorming|planning|plan-ready|none`, default `brainstorming`), and the matching stage seed.
- Derived/defaulted (NOT asked): `command.name := id`; `command.warnings := []`; `command.prompts := { <stageKey-derived-from-initialStage>: <seed> }`; `lifecycle := "tracked"` (override-able); `status := "todo"` (override-able); `lastTouchedAt := now()` (MUST inject — `upsert-task` does not auto-set it); `kanbanCards := [{ className: "cmd-warn", html: <card> }]`.
- Guard/UX: friendly dup pre-check sourced from `summary-projection.json` (ALL tasks incl cold) for an early error; assemble id-first canonical object; render it for an explicit Confirm / Edit field / Cancel; FAIL CLOSED (STOP + emit the assembled object) when there is no human confirmation channel (sub-agent / non-interactive without an explicit `--yes`); write once via `overview.upsert_task` (preferred — guard-immune) or `node tools/data-edit.mjs upsert-task <id> --json <temp> --create-only` (temp spec written under a staging dir, never under `.ralph-overview/`); show the printed diff + remind that git staging/commit/push is the operator's step.
- Thin non-interactive fallback ONLY: convention-applying flags (`--id/--scope/--card/--brainstorm|--plan/--stage` + `--yes`) that still run the guard + scaffolding. Explicitly REJECT a raw `--spec <file>` full-JSON mode (redundant with `data-edit upsert-task --json`).
- Docs: update `ralph-overview/README.md` + `ralph-overview/AGENTS.md` skill inventory (4 guided skills -> 5); bump `.claude-plugin/plugin.json` version + the three marketplace indexes at release time; consider the toolkit-root `AGENTS.md` plugin bullet.

### Out of Scope
- Any git staging/commit/push by the skill (constraint 2).
- Editing tasks beyond creation, deleting tasks, or adding a delete/undo verb.
- A fresh re-implementation of the atomic write logic in the skill (constraint 3 — reuse the core).
- A raw `--spec <file>` full-JSON non-interactive mode (rejected by all lenses).
- Raw writes to `.ralph-overview/data.json` (blocked by the write-guard hook; mutate only through the helper/MCP tool).
- Changing the data.json schema, the hot/cold shard split, or the watcher.

## Criteria
- Running the new skill and answering the prompts files a NEW `tracked` task into `.ralph-overview/data.json` with the exact Filed-convention shape: `lifecycle: "tracked"`, `status: "todo"` (unless overridden), a single `cmd-warn` problem-statement card, `command.name == id`, one `command.prompts.<stage>` seed whose key agrees with `initialStage`, a valid `lastTouchedAt`, and NO `shipManifest`.
- The write goes through the shared `upsert-task` core (CLI or MCP), NOT a raw data.json edit; the write-guard hook is not tripped.
- Creating a task whose id already exists — including an id that belongs to a `merged`/`archived` (cold-shard) task — is BLOCKED with a clear error naming the existing id + lifecycle, and `.ralph-overview/data.json` (+ `data.archived.json`) is left UNTOUCHED. (Verified by the disconfirming test: `upsert-task <existing-archived-id> --json <tracked-skeleton> --create-only` exits non-zero and changes nothing.)
- The skill confirms the assembled object with the user BEFORE writing, and fails closed (does not write) when no human confirmation channel is available.
- The skill performs NO git operations; it ends by reminding the operator/lead that git staging/commit/push is their step.
- The Copilot mirror is regenerated and matches source (`generate-copilot-artifacts.mjs` drift-check is green); the SKILL.md contains no forbidden tokens.
- `node tools/data-edit.mjs upsert-task` CLI output and `overview.upsert_task` MCP output remain byte-identical for the same assembled object (existing roundtrip test re-pinned and green); new core unit tests cover `createOnly` insert-vs-throw on hot and cold ids.

## Context
**Gating decision for the plan phase (open question 1):** D-002 assumes
"reuse the shared core" PERMITS extending `upsert-task` with a `createOnly`
option (the airtight, cold-shard-aware, un-raceable guard). If the operator
intends constraint 3 to FREEZE the core (skill-only, no core/MCP/CLI edits),
fall back to **D-001**: the same guided skill but with a SKILL-LEVEL pre-check
sourced from `summary-projection.json` (ALL tasks incl cold), confirm-before-
write, and fail-closed — accepting a residual TOCTOU/staleness window that the
core flag eliminates. Confirm this scope before building.

**Why the guard must be airtight (disconfirming observation that motivated
D-002):** the shared core verbs are `mark-shipped | upsert-task | set-lifecycle
| add-kanban-card | set-prompts` — there is NO `create` and NO delete/undo verb
(`scripts/lib/data-edit-core.mjs:26`). `upsert-task` builds `{ id, ...incoming }`
and REPLACES an existing id in place with exit 0 (the count invariant at
`:192-199` permits replace). Because the locked write path operates over the
assembled hot+cold union, an upsert against an existing archived/merged id
silently deletes that row and resurrects it into the hot shard. A tracked-only
projection pre-check (`active-tasks.json`/`lean-tasks.json`) would MISS that
collision; only `summary-projection.json` lists cold tasks, and any skill-level
read races the watcher. Cheapest disconfirming test: copy `data.json` +
`data.archived.json` to a throwaway dir and run `upsert-task
<existing-ARCHIVED-id> --json <tracked-skeleton> --repo <tmp>` — observed exit 0,
archived row deleted, resurrected into hot. This disconfirms both "the core
protects me" and "a tracked-only pre-check is enough."

**Cross-engine + convention details to carry forward:** ralph-overview skills are
authored once in `skills/<name>/SKILL.md` and mirrored to Copilot by
`generate-copilot-artifacts.mjs` (rewrites `Skill()`/`mcp__x__y`, asserts no
forbidden tokens, CI fails on drift). Interactive prompting is engine-neutral —
the agent asks in its normal turn (Claude AskUserQuestion / Copilot `ask_user`);
describe asks in prose so the mirror is safe and honor the operator's preference
for structured/multiple-choice prompts. Note that on the Copilot mirror, `Skill()`
chains become `task(general-purpose)` sub-agent dispatches with no human channel —
hence the fail-closed requirement. `upsert-task` does NOT auto-set `lastTouchedAt`
and does NOT enforce `command.name == id` or `initialStage <-> prompts-key`
agreement, so the skill must inject/derive those. The closest precedent skill is
`skills/overview-init/SKILL.md` (dry-run -> confirm -> apply, "do not edit
data.json directly").
