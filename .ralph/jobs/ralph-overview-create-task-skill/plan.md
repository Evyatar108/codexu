# Implementation Plan: ralph-overview-create-task-skill

> Worktree: `.ralph/jobs/ralph-overview-create-task-skill/worktree/plan` on branch
> `ralph/plan-ralph-overview-create-task-skill` (off codexu `main`).
> Target repo for the eventual impl: the **`ai-developer-toolkit` submodule**
> (`ai-developer-toolkit/plugins/ralph-overview/`), NOT codexu directly. The impl
> lands as a submodule commit + a codexu pointer bump (see "Ship & serialization"
> below).

## Summary

Add a new cross-engine guided slash skill `/create-task` to the `ralph-overview`
plugin. An operator or agent runs it to interactively file a new `tracked` task
into `.ralph-overview/data.json`, following the "Filed"-convention shape. The
skill gathers the minimum filing fields, blocks duplicate ids atomically
(including collisions with cold/archived tasks), assembles the canonical task
object, confirms it with the user, and writes exactly once through the existing
shared `upsert-task` mutation core — printing the resulting unified diff. It
performs NO git staging/commit/push (the lead/operator owns git side effects).

To make the no-clobber guard airtight, this plan also extends the shared core
`scripts/lib/data-edit-core.mjs` `upsert-task` verb with a `createOnly` option
that throws BEFORE write when a task with the same id already exists (hot OR
cold), under the existing data-file lock. The option is surfaced on both
write surfaces: a `--create-only` CLI flag and an `overview.upsert_task` Zod
field + handler arg.

This realizes brainstorm direction **D-002**
(`.ralph/brainstorms/ralph-overview-create-task-skill/selected-direction.md`
@ `5ab9fc7d`).

---

## GATING DECISION (resolve before impl — operator may veto)

**Operator-fixed constraint 3** says the skill MUST reuse the shared mutation
core, NOT a fresh re-implementation of the atomic write. There are two readings:

- **D-002 (RECOMMENDED — this plan):** "reuse the core" PERMITS *extending*
  `upsert-task` with a small `createOnly` option. This is the only race-free,
  cold-shard-aware way to guarantee no silent clobber.
- **D-001 (fallback):** "reuse the core" means FREEZE it (no core/CLI/MCP
  edits) and do a SKILL-LEVEL pre-check sourced from `summary-projection.json`
  (which lists cold tasks too), confirm-before-write, fail-closed — accepting a
  residual TOCTOU/staleness window the core flag would eliminate.

### Why D-002 is correct and minimal (source-verified)

The shared core verbs are `mark-shipped | upsert-task | set-lifecycle |
add-kanban-card | set-prompts` — there is **no `create` verb and no
delete/undo verb** (`scripts/lib/data-edit-core.mjs:26`). `upsert-task` does
`tasks.findIndex(t => t.id === args.id)`; on a hit it REPLACES in place and
returns exit 0, and the count invariant explicitly permits replace
(`data-edit-core.mjs` `validateInvariants`: `wasPresent ? beforeCount :
beforeCount + 1`). Crucially, in split mode `runVerbSplit` builds
`beforeUnion = { ...store.hot.data, tasks: assembled.tasks }` — the **assembled
hot+cold union** — and passes THAT to `applyVerb`. So an `upsert-task` against
an existing `merged`/`archived` (cold-shard) id silently deletes that row and
resurrects it into the hot shard, with exit 0.

Therefore:

1. A skill-only pre-check against a tracked-only projection
   (`active-tasks.json` / `lean-tasks.json`) would MISS a cold-shard collision.
   Only `summary-projection.json` lists cold tasks — and any skill-level read
   races the watcher (TOCTOU).
2. Adding a `createOnly` guard INSIDE `applyVerb`'s `upsert-task` case is
   automatically cold-shard-aware (the `tasks` it sees IS the union in split
   mode) AND race-free (it runs inside the `${dataFile}.lock` that covers the
   whole read-mutate-write cycle). It is ~5 lines and is a true EXTENSION of
   the shared core, satisfying constraint 3.

**Decision: build D-002.** If the operator intends constraint 3 to FREEZE the
core, fall back to D-001 (skill-only pre-check from `summary-projection.json`,
documented in "Alternative: D-001" below). This is the single load-bearing
open question; everything else in this plan is unaffected by the choice except
US-001 (the core flag) and the wiring stories US-002/US-003.

---

## Background / current state (file references)

- **Shared mutation core:** `ai-developer-toolkit/plugins/ralph-overview/scripts/lib/data-edit-core.mjs`
  - `VERBS` (line 26), `applyVerb()` `upsert-task` case (~line 130),
    `validateInvariants()`, `runVerb()` (lock + dispatch),
    `runVerbLegacy()` (passes `store.hot.data`), `runVerbSplit()` (passes the
    assembled `beforeUnion` to `applyVerb`).
- **CLI surface:** `scripts/data-edit.mjs` — `parseArgs` / `VALUE_FLAGS` /
  `buildVerbArgs` `upsert-task` case (`--json`). Dispatched via
  `bin/ralph-overview.mjs data-edit`.
- **MCP surface:** `tools/overview-mcp/src/schemas.ts` (`upsertTaskInputSchema`,
  line ~94: `{ taskId, task: z.object({id}).passthrough() }`) and
  `tools/overview-mcp/src/tools/data-write.ts` (`upsertTask()` handler →
  `execVerb(context,'upsert-task',{id,task})`, plus `registerDataWriteTools`).
- **Existing guided skills (house style + cross-engine):**
  `skills/{triage,work-on,blocker-report,expand-task,overview-init}/SKILL.md`.
  Closest write-automation precedent: `skills/overview-init/SKILL.md`
  (dry-run → confirm → apply; "do not edit data.json directly").
- **Copilot mirror generator:** `scripts/generate-copilot-artifacts.mjs`.
  `FORBIDDEN` tokens (line 20): `['Skill(', 'Agent(', 'BashOutput',
  'run_in_background', 'EnterPlanMode', 'ExitPlanMode']`. Mirrors are written to
  `.copilot-plugin/copilot-skills/<name>/SKILL.md`. Existing mirrors:
  blocker-report, expand-task, overview-init, triage, work-on.
- **Write-guard hook (must NOT be tripped):** `hooks/pre-tool-use-data-edit.js`
  (Claude) + `hooks/copilot-pre-tool-use-data-edit.js` (Copilot) block raw
  edits/shell-writes to `**/.ralph-overview/data.json`. Tests in
  `hooks/__tests__/pre-tool-use-data-edit.test.mjs`.
- **Projections (read sources for the dup pre-check):**
  `summary-projection.json` (ALL tasks incl cold; bodies stripped) is the only
  projection that lists cold tasks. Emitted by `scripts/lib/emit-projections.mjs`.
- **Filed-convention task shape** (from codexu `AGENTS.md` "Task lifecycle
  state machine" + the live `.ralph-overview/data.json`): `id`, `scope`,
  `lifecycle: "tracked"`, `status`, `lastTouchedAt`, `command: { name,
  descriptionHtml, warnings: [], prompts: { <stage>: <seed> } }`, `kanbanCards:
  [{ className: "cmd-warn", html }]`, NO `shipManifest`.
- **Core tests:** `scripts/lib/data-edit-core.test.mjs`,
  `scripts/lib/data-edit-core-split.test.mjs`,
  `scripts/lib/data-edit-relocation-safety.test.mjs`.
- **Byte-parity roundtrip test:**
  `tools/overview-mcp/src/__tests__/data-write-roundtrip.test.ts` (drives the
  CLI subprocess + the MCP handler against two byte-identical fixtures and
  byte-diffs). Tool-list pin: `tools/overview-mcp/src/__tests__/stdio-tools-list.test.ts`.

---

## Design / approach

### A. Core: `createOnly` on `upsert-task` (US-001)

In `applyVerb()`'s `upsert-task` case, the existing code already computes
`const index = tasks.findIndex((task) => task && task.id === args.id)`
(`data-edit-core.mjs:135`). **Do NOT redeclare `index`** — insert the guard
immediately AFTER that existing line, BEFORE the canonicalize/push step, reusing
the same `index`:

```js
// existing line (data-edit-core.mjs:135) — keep as-is:
const index = tasks.findIndex((task) => task && task.id === args.id)
// NEW guard, reuses the existing `index`:
if (args.createOnly && index !== -1) {
    const existing = tasks[index]
    const lifecycle = (existing && existing.lifecycle) ? existing.lifecycle : 'unknown'
    throw new Error(
        `upsert-task: createOnly is set but a task with id "${args.id}" already exists ` +
        `(lifecycle=${lifecycle}); refusing to overwrite. data.json is untouched.`,
    )
}
```

> Review note (L2): a verbatim `const index = ...` re-insertion would be a
> duplicate-`const` SyntaxError — reuse the existing declaration.

- Because this runs inside `applyVerb`, and `runVerbSplit` passes the assembled
  hot+cold UNION, the guard sees cold (`merged`/`archived`) ids too. In legacy
  (single-file) mode `runVerbLegacy` passes `store.hot.data` which already
  contains every task. Cold-shard awareness is therefore automatic in BOTH
  modes — no separate cold read needed.
- The throw happens before any mutation, and `runVerb` holds `${dataFile}.lock`
  for the whole cycle, so it is race-free and leaves data.json untouched.
- `createOnly` is OPT-IN: default/absent preserves the exact current
  insert-or-replace semantics, so existing callers and the roundtrip parity
  test are unaffected when the flag is not passed.
- No change to `validateInvariants` is needed (the guard fires first).

### B. CLI: `--create-only` flag (US-002)

In `scripts/data-edit.mjs`:
- Add `--create-only` to the boolean-flag handling in `parseArgs` (it is a
  boolean like `--force`, NOT in `VALUE_FLAGS`): `else if (arg ===
  '--create-only') { flags['create-only'] = true }`.
- In `buildVerbArgs`'s `upsert-task` case, thread it through:
  `return { id, task: JSON.parse(...), createOnly: Boolean(flags['create-only']) }`.
- Update the `HELP` text `upsert-task` line to document `[--create-only]`.

### C. MCP: `createOnly` Zod field + handler (US-003)

In `tools/overview-mcp/src/schemas.ts` `upsertTaskInputSchema`, add
`createOnly: z.boolean().optional()`. In `tools/overview-mcp/src/tools/data-write.ts`
`upsertTask()`, pass it through:
`execVerb(context, 'upsert-task', { id: input.taskId, task: input.task, createOnly: input.createOnly })`.

- The tool COUNT and tool DESCRIPTION strings are UNCHANGED (still 11 tools,
  same `overview.upsert_task` description), so `stdio-tools-list.test.ts` stays
  green without edits. The new optional input field does not break it.
- Keep CLI and MCP byte-identical: both feed the same `runVerb` args, so the
  roundtrip test stays valid; ADD a `--create-only`/`createOnly` roundtrip case
  (US-006) so the parity is pinned for the new flag too.

### D. The `/create-task` guided skill (US-004)

New `skills/create-task/SKILL.md` (Claude / source-of-truth), matching the
`overview-init` dry-run → confirm → apply house style. The skill:

1. **Resolve roots** (repo root via `git rev-parse --show-toplevel`; plugin root
   via `RALPH_OVERVIEW_PLUGIN_ROOT` / `$CLAUDE_PLUGIN_ROOT/ralph-overview`), like
   `triage`/`work-on`.
2. **Gather fields interactively** (engine-neutral prose; the agent uses its
   normal turn — Claude AskUserQuestion / Copilot `ask_user` — honoring the
   operator's preference for structured/multiple-choice prompts):
   - `id` — validate `^[A-Za-z0-9_./-]+$` (same as core `ID_PATTERN`).
   - `scope` — closed multiple-choice taxonomy (derive the option list from the
     distinct `scope` values already present in `summary-projection.json` WHEN
     PRESENT; if that projection is absent, derive the distinct scopes by reading
     `data.json` + `data.archived.json` directly, else fall back to free text) +
     pipe-combine + "other (free text)".
   - `descriptionHtml` — a short one-liner.
   - the single `cmd-warn` problem-statement kanban card (`html`).
   - `initialStage` — `brainstorming | planning | plan-ready | none`
     (default `brainstorming`).
   - the matching stage seed (the prompt body for the chosen stage), UNLESS
     `initialStage === none`.
3. **Dup pre-check (friendly early error):** read `summary-projection.json`
   (ALL tasks incl cold) and, if `id` already exists, STOP with a clear message
   naming the existing id + its lifecycle. **Graceful degradation (review H1):**
   `summary-projection.json` is watcher-EMITTED and is frequently ABSENT (it is
   absent in the live codexu `.ralph-overview/` right now, and a throwaway-copy
   smoke that copies only `data.json` + `data.archived.json` will not have it).
   If the projection is missing, EITHER read `data.json` + `data.archived.json`
   directly for the pre-check, OR skip the friendly pre-check entirely and rely
   on the core `createOnly` guard (which is ALWAYS present and is the real
   race-free guarantee). The pre-check is a UX nicety, never the safety
   mechanism — the skill must not crash or hard-block when the projection is
   absent.
4. **Derive/default (NOT asked):**
   - `command.name := id`
   - `command.warnings := []`
   - `command.descriptionHtml := <gathered>`
   - `command.prompts := { <stageKey> : <seed> }` where `<stageKey>` is derived
     from `initialStage` (`brainstorming→brainstorm`, `planning|plan-ready→plan`).
     If `initialStage === none`, `command.prompts := {}`.
   - `lifecycle := "tracked"` (override-able)
   - `status := "todo"` (override-able)
   - `lastTouchedAt := now()` (MUST inject — `upsert-task` does NOT auto-set it)
   - `kanbanCards := [{ className: "cmd-warn", html: <card> }]`
   - `initialStage := <gathered>` (set on the task too, so the watcher/MCP
     ready-task derivation works for a snapshot-absent task).
5. **Assemble + confirm:** build the canonical object id-first, render it
   (pretty JSON), and ask **Confirm / Edit a field / Cancel**. **FAIL CLOSED:**
   if there is no human confirmation channel (running as a sub-agent / a
   non-interactive context without an explicit `--yes`), STOP and emit the
   assembled object instead of writing.
6. **Write once** through the shared core (guard-immune path preferred):
   - Preferred: `overview.upsert_task` MCP tool with `{ taskId, task,
     createOnly: true }`.
   - Fallback: write the assembled object to a temp spec under a STAGING dir
     (NEVER under `.ralph-overview/`), then
     `node "$pluginRoot/bin/ralph-overview.mjs" data-edit upsert-task <id>
     --json <temp> --create-only --repo "$repoRoot"`.
   - Either way the write goes through the shared core; the raw-write guard
     hook is never tripped (we never `edit`/`>`/`Set-Content` data.json).
7. **Report + reminder:** print the returned unified diff, then remind that
   **git staging/commit/push is the operator's step** (the skill does no git).

**Thin non-interactive fallback ONLY:** support convention-applying flags
(`--id`, `--scope`, `--card`, `--brainstorm|--plan`, `--stage`, `--yes`) that
still run the dup guard + scaffolding + core write. **Explicitly REJECT** a raw
`--spec <file>` full-JSON mode (redundant with `data-edit upsert-task --json`).

### E. Copilot mirror (US-005)

Regenerate `.copilot-plugin/copilot-skills/create-task/SKILL.md` via
`node scripts/generate-copilot-artifacts.mjs --write`. The source SKILL.md body
MUST avoid the FORBIDDEN tokens (`Skill(`, `Agent(`, `BashOutput`,
`run_in_background`, `EnterPlanMode`, `ExitPlanMode`) so the generator's
`assertNoForbidden` (a case-sensitive `result.includes(token)`) and the CI
drift-check pass. **Review note (L1):** `ask_user(`, `AskUserQuestion(`, and the
generated `task(agent_type=...)` form contain NO forbidden substring and are
safe — the genuine trap is a literal `Skill(` (e.g. in an explanatory sentence
about how a `Skill()` chain lowers on Copilot). Describe interactive prompting
and dispatch in PROSE, and do NOT transcribe any explanatory sentence containing
`Skill(`/`Agent(` into the SKILL.md body. (The §E sentence in THIS plan that
contains `Skill(` is plan-only prose and must not be copied into the skill.)

### F. Docs + version + indexes (US-007)

- `README.md` + `AGENTS.md` skill inventory: 4 guided skills → 5 (add
  `/create-task`). Update the toolkit-root `AGENTS.md` "Ralph Overview Plugin"
  bullet's skill list if it enumerates skills.
- `CHANGELOG.md`: prepend a `2.15.0` entry (new skill + `createOnly` core/CLI/MCP).
- Version bump `2.14.1 → 2.15.0` (minor; additive feature) in:
  `.claude-plugin/plugin.json` AND the three marketplace indexes
  (`<toolkit>/.claude-plugin/marketplace.json`,
  `<toolkit>/.github/plugin/marketplace.json`,
  `<toolkit>/.agents/plugins/marketplace.json`) — per AGENTS.md invariant #6.
  > NOTE: a new SKILL changes the slash-command registry, so consumers need a
  > session restart / `copilot plugin update` to see `/create-task`. This is a
  > release-time concern, not an impl blocker.

---

## Files to change (impl checklist)

All paths under `ai-developer-toolkit/plugins/ralph-overview/` unless noted.

**Core + surfaces (D-002):**
- `scripts/lib/data-edit-core.mjs` — `createOnly` guard in `applyVerb`
  `upsert-task` case. (US-001)
- `scripts/data-edit.mjs` — `--create-only` boolean flag + `buildVerbArgs`
  threading + `HELP` text. (US-002)
- `tools/overview-mcp/src/schemas.ts` — `createOnly: z.boolean().optional()` on
  `upsertTaskInputSchema`. (US-003)
- `tools/overview-mcp/src/tools/data-write.ts` — pass `createOnly` through
  `upsertTask()`. (US-003)

**Skill (new) + mirror:**
- `skills/create-task/SKILL.md` — NEW. (US-004)
- `.copilot-plugin/copilot-skills/create-task/SKILL.md` — GENERATED. (US-005)

**Tests:**
- `scripts/lib/data-edit-core.test.mjs` — new `createOnly` unit cases
  (hot-id blocks, fresh-id inserts). (US-006)
- `scripts/lib/data-edit-core-split.test.mjs` — new `createOnly` blocks an
  existing COLD id case. (US-006)
- `tools/overview-mcp/src/__tests__/data-write-roundtrip.test.ts` — add a
  `createOnly` CLI-vs-MCP byte-parity case. (US-006)

**Docs / version / indexes:**
- `README.md`, `AGENTS.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`. (US-007)
- `<toolkit>/.claude-plugin/marketplace.json`,
  `<toolkit>/.github/plugin/marketplace.json`,
  `<toolkit>/.agents/plugins/marketplace.json`. (US-007)
- `<toolkit>/AGENTS.md` (Ralph Overview Plugin bullet, if it lists skills). (US-007)

---

## Tests (new)

The three brainstorm-mandated core tests, plus the parity case:

1. **`createOnly` blocks an existing HOT id** (`data-edit-core.test.mjs`):
   seed a fixture with `task-alpha` (tracked); `applyVerb(data,'upsert-task',
   {id:'task-alpha', task:{id:'task-alpha',...}, createOnly:true})` THROWS and
   the on-disk file is byte-unchanged via `runVerb`.
2. **`createOnly` blocks an existing COLD id** (`data-edit-core-split.test.mjs`):
   seed split fixtures (hot + `data.archived.json` containing a `merged`/`archived`
   id); `runVerb(... upsert-task <cold-id> --create-only ...)` THROWS, BOTH
   shards byte-unchanged (this is the disconfirming test that motivated D-002).
3. **`createOnly` allows a FRESH id** (`data-edit-core.test.mjs`): inserts
   exactly one task; without `createOnly` the replace path still works
   (regression guard for default behavior).
4. **CLI↔MCP byte-parity with `--create-only`/`createOnly`**
   (`data-write-roundtrip.test.ts`): both surfaces insert the same fresh task
   and produce byte-identical data.json; both REJECT the same existing id
   identically. **Review note (M1):** the reject case CANNOT reuse the existing
   `assertByteParity()` helper — it asserts the file CHANGED (`not.toEqual(
   FIXTURE_RAW)`), and `runCli` wraps `execFileSync` which THROWS on non-zero
   exit. For the reject case, add a dedicated path: `expect(() => runCli(...
   '--create-only')).toThrow()`, assert MCP `result.ok === false`, and assert
   BOTH files are byte-IDENTICAL to the seed (unchanged) — do not call
   `assertByteParity`.

Validation commands (run from plugin root
`ai-developer-toolkit/plugins/ralph-overview/`):
- `npm run test:lib` (scripts/lib) — covers core unit tests.
- `npm test` (full: scripts/lib + overview-mcp + viewer) — runs serial on
  Windows; the roundtrip + tools-list tests live under overview-mcp.
- `node scripts/generate-copilot-artifacts.mjs --check` — mirror drift +
  forbidden-token gate.
- Manual smoke (throwaway dir): copy `data.json` + `data.archived.json` to a
  tmp dir; `node bin/ralph-overview.mjs data-edit upsert-task <existing-archived-id>
  --json <tracked-skeleton> --create-only --repo <tmp>` → expect non-zero exit +
  untouched shards.

---

## Ship & serialization (impl/lead notes — flag in plan)

- **Two ralph-overview impls must SERIALIZE at ship time.** The sibling task
  `overview-naming-rebrand` is being PLANNED in parallel (same plugin). At the
  PLAN level the two are disjoint (separate job dirs + worktrees), but BOTH
  impls bump `plugin.json` + the 3 marketplace indexes + prepend `CHANGELOG.md`
  — conflicting version/index/changelog writes. Per codexu AGENTS.md
  "Parallel-spawn disjoint-surface rule" (plugin level), **same-plugin parallel
  = conflict; the two ralph-overview impls must be serialized** (spawn impl-A,
  let it ship + lead bumps version, THEN spawn impl-B which rebases onto
  post-A toolkit main before push).
- **User-facing naming follows the rebrand plan.** Per the lead's note, the new
  skill's user-facing naming should follow whatever `overview-naming-rebrand`
  decides — likely **"roadmap" as the human-facing term, keeping `ralph-overview`
  as the technical/package identity**. If the rebrand lands FIRST, the
  `/create-task` skill copy (README/SKILL prose) should say "roadmap task" in
  user-facing text while keeping `ralph-overview` plugin/file identifiers. If
  `/create-task` lands first, use neutral wording ("a tracked task") and let the
  rebrand sweep update it. Do NOT hardcode a name that pre-empts the rebrand
  decision.
- **Shared interactive-gather flow with the bulk-import sibling.** The sibling
  task `ralph-overview-roadmap-import-skill` (bulk import) will ALSO need a
  field-gather + core-write flow. **Decision for impl:** keep `/create-task`
  focused (single-task interactive create) and do NOT prematurely extract a
  shared module now — but author the SKILL.md "assemble canonical Filed object"
  + "write once via createOnly core" steps as a clearly delineated, copy-able
  section so the import skill can reuse the SAME core write path
  (`upsert-task --create-only`, looped per row) without duplicating the atomic
  logic. The core `createOnly` flag is the genuinely shared primitive; the
  import skill consumes it row-by-row. Revisit a shared SKILL fragment only if
  the import skill's gather logic proves substantially identical.
- **Cross-repo:** the impl is a SUBMODULE change. The lead ships via the
  canonical "Multi-repo wrapper-to-submodule ship ceremony"
  (`ai-developer-toolkit/plugins/ralph/AGENTS.md`): FF-merge submodule topic
  branch → push all submodule remotes → bump codexu `ai-developer-toolkit`
  pointer + update the codexu AGENTS.md active-plugin-versions table (2.14.1 →
  2.15.0) → commit + push wrapper → `copilot plugin update`.

---

## Out of scope

- Any git staging/commit/push by the skill (constraint 2).
- Editing/deleting tasks; a delete/undo verb.
- A fresh re-implementation of the atomic write inside the skill (constraint 3).
- A raw `--spec <file>` full-JSON non-interactive mode.
- Raw writes to `.ralph-overview/data.json` (blocked by the write-guard hook).
- Changing the data.json schema, the hot/cold shard split, or the watcher.
- Building the bulk-import skill (`ralph-overview-roadmap-import-skill`) — sibling.

---

## Alternative: D-001 (only if the operator vetoes core edits)

Same guided skill, but FREEZE the core (no `data-edit-core.mjs` / CLI / MCP
edits). The dup guard becomes a SKILL-LEVEL pre-check against
`summary-projection.json` (lists cold tasks), confirm-before-write, fail-closed.
The write still goes through the UNMODIFIED `upsert-task` (CLI `--json` or MCP).
Drops US-001/002/003/006-parity; keeps US-004/005/007. **Residual risk:** a
TOCTOU window between the skill's read and the core write (the watcher or a
concurrent writer can change the shard set in between), so a same-instant
duplicate filing could still clobber a cold task. This is the exact failure
D-002 eliminates — hence D-002 is recommended.

---

## Common mistakes / confusion points for the impl agent

- **`upsert-task` does NOT auto-set `lastTouchedAt`, `command.name == id`, or
  `initialStage ↔ prompts-key` agreement** — the SKILL must inject/derive all
  three before the write.
- **The dup pre-check reads `summary-projection.json` (the only cold-listing
  projection), NOT `active-tasks.json`/`lean-tasks.json`** — but that file is
  watcher-emitted and OFTEN ABSENT (review H1). Degrade gracefully when missing:
  read `data.json`+`data.archived.json` directly, or skip the pre-check. The
  core `createOnly` flag is the real guard; the pre-check is just a friendly
  early error and must never be the safety mechanism.
- **Never write the temp spec under `.ralph-overview/`** — use a staging dir;
  a temp file under `.ralph-overview/` could be picked up by the watcher and
  the data.json write-guard hook is path-scoped to that dir.
- **Keep the SKILL.md body free of FORBIDDEN tokens** (`Skill(`, `Agent(`,
  `BashOutput`, `run_in_background`, `EnterPlanMode`, `ExitPlanMode`) — the
  Copilot generator hard-fails (case-sensitive `includes`). The real near-miss
  is a literal `Skill(` in explanatory prose (NOT `ask_user(`/`AskUserQuestion(`,
  which are safe). Describe prompting/dispatch in prose without those tokens.
- **codexu root `CLAUDE.md` is gitignored** — do not `git add CLAUDE.md`.
  Fork-level guidance edits go in codexu/`AGENTS.md`; plugin guidance in the
  plugin's own `AGENTS.md`.
- **Submodule two-commit flow** — commit inside `ai-developer-toolkit` first,
  then the codexu pointer bump; never mix.
- **Do NOT change the `overview.upsert_task` tool description string** — it is
  drift-checked by `stdio-tools-list.test.ts`; adding an optional input field
  does not change the pinned tool list.
