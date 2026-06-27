Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (all three lenses produced usable output)

# Brainstorm synthesis — ralph-overview "create a tracked task" skill

**Idea:** Design a new cross-engine `ralph-overview` guided skill that
interactively CREATES a tracked task in `.ralph-overview/data.json`, reusing the
shared `upsert-task` mutation core, performing the dup-id/JSON/count guards +
confirmation diff, and doing NO git side-effects. (Operator fixed 4 constraints;
the brainstorm designs within them.)

## The load-bearing finding (all three lenses, raised by devils-advocate)

There is **no `create` operation and no delete/undo verb** in the system. The
shared core verbs are `mark-shipped | upsert-task | set-lifecycle |
add-kanban-card | set-prompts` (`scripts/lib/data-edit-core.mjs:26`). `upsert-task`
builds `{ id, ...incoming }` and **REPLACES** an existing id in place, returning
exit 0 — the count-preservation invariant (`data-edit-core.mjs:192-199`) *permits*
replace. So a mistaken "create" over an existing id is **silent AND
irreversible by any skill-available verb**. Worse, because the locked write path
operates over the assembled **hot+cold** union, an upsert against an existing
**archived/merged (cold-shard)** id silently deletes that row and resurrects it
into the hot shard.

Consequence for the design: a dup-id pre-check that reads a **tracked-only**
projection (`active-tasks.json` / `lean-tasks.json`) is **insufficient** — it
cannot see cold tasks. Only `summary-projection.json` enumerates all tasks.
And any skill-level pre-check is TOCTOU/staleness-prone (it races the watcher
projection). This is the central design fork below (D-001 vs D-002).

A second, smaller convergent finding: `upsert-task` does **not** auto-set
`lastTouchedAt` (only the in-place verbs do), and it does not enforce
`command.name == id` or `initialStage <-> prompts-key` agreement. The skill must
inject `lastTouchedAt` and DERIVE those invariants rather than ask the user
twice.

## Areas of agreement across all lenses

- A **create-only guided slash skill** (working name `/create-task`) is the right
  surface: ask the minimum filing fields, pre-check duplicates, confirm the
  assembled object, write ONCE through the shared `upsert-task` core, print the
  diff as the record. Matches the `overview-init` dry-run -> confirm -> apply
  house style.
- **Confirm BEFORE write** (not write-then-diff-then-maybe-revert), because there
  is no undo verb. The printed `data-edit` diff is the *post-write record*, not
  the confirmation gate.
- **Reject a heavy non-interactive `--spec <file>` JSON fallback** — it is
  byte-for-byte redundant with the existing `data-edit upsert-task --json` and
  re-introduces the clobber + convention-omission footguns the skill exists to
  prevent. At most, a THIN convention-applying flag set
  (`--id/--scope/--card/--brainstorm`) that still runs the guard + scaffolding
  earns its keep.
- **Never raw-write data.json** (the write-guard hook blocks it, even shell reads
  that name the path). Mutate only through `overview.upsert_task` (MCP) or
  `node tools/data-edit.mjs upsert-task` (CLI).
- The **Filed-convention object** (codexu AGENTS.md state machine): `lifecycle:
  tracked`, one `cmd-warn` problem-statement card, a single `prompts.<stage>`
  seed agreeing with `initialStage`, `command.name == id`, no `shipManifest`.

---

### D-001: Guided create-only skill with a SKILL-LEVEL no-clobber guard (thin, ship-fast)
- Contributing lenses: [codex, copilot, devils-advocate]
- Shape: a new `skills/create-task/SKILL.md` (+ generated Copilot mirror) ONLY,
  no core/MCP/CLI/test changes. Gather fields interactively; dup pre-check reads
  the **ALL-tasks** id set from `summary-projection.json` (explicitly NOT the
  tracked-only projections); hard-stop on a collision naming the existing id +
  lifecycle; assemble the Filed-convention object; render it for an explicit
  Confirm / Edit / Cancel; **fail-closed** (STOP + emit the object) if there is
  no human confirmation channel; then write once via `overview.upsert_task`
  (preferred, guard-immune) with the `data-edit upsert-task` CLI as fallback;
  show the printed diff.
- Why this might work: smallest footprint, fastest to ship, matches "reuse the
  core as-is" most literally; the summary-projection pre-check + confirm-before-
  write closes the common-case clobber.
- Risks / friction: the guard is **best-effort, not airtight** — a residual
  TOCTOU window remains (projection staleness between the read and the upsert; a
  down watcher makes the projection stale/absent). On the Copilot mirror,
  `Skill()` chains are rewritten into `task(general-purpose)` SUB-AGENT dispatches
  with no human channel — interactive asks silently degrade to invented values
  unless the skill fails closed.
- Cheapest validation: dogfood one disposable task end-to-end on a branch; then
  run the disconfirming test below to confirm the residual hole is understood.
- Disconfirming observation: a skill-level pre-check sourced from a tracked-only
  projection (or a stale summary projection) still lets an archived-id collision
  through to a silent, irreversible clobber.

### D-002 (RECOMMENDED): Guided create-only skill + a `createOnly` flag pushed INTO the shared core (airtight guard)
- Contributing lenses: [devils-advocate] (guard placement) + [codex, copilot]
  (skill design as the thin wrapper)
- Shape: everything in D-001 PLUS extend the EXISTING `upsert-task` in
  `scripts/lib/data-edit-core.mjs` with a `createOnly` / `failIfExists` option
  that throws BEFORE write when `tasks.findIndex(t.id === id) !== -1`, plus the
  matching `--create-only` CLI flag (`scripts/data-edit.mjs`) and the
  `overview.upsert_task` MCP Zod field + handler. The skill calls upsert with
  `createOnly: true`, so the no-clobber guard runs **inside the same
  `${dataFile}.lock`** over the assembled hot+cold union — it cannot be raced and
  it sees cold tasks. The skill still does the friendly summary-projection
  pre-check for an early, well-worded error, but the core flag is the
  authoritative backstop.
- Why this might work: directly delivers the "dup-id guard" the operator asked
  for as an **atomic, cold-shard-aware, un-raceable** check; the asymmetry
  (silent irreversible data loss with no undo vs. one small contained core
  change) strongly favors it; adding an option to the shared core IS reuse/
  extension, not a fresh re-implementation (constraint 3 satisfied).
- Risks / friction: touches three surfaces (core + MCP Zod schema + CLI flag) and
  needs the byte-identical CLI/MCP roundtrip test
  (`tools/overview-mcp/src/__tests__/data-write-roundtrip.test.ts`) re-pinned and
  core unit tests added; slightly larger plan + the usual marketplace
  version-bump coupling.
- Cheapest validation: add the core flag + one unit test that asserts
  `createOnly` throws on an existing id (hot AND cold) and inserts otherwise;
  then dogfood the skill against a disposable id.
- Disconfirming observation: if the operator intends constraint 3 to FREEZE the
  core (skill-only, no core/MCP/CLI edits), D-002 is out of scope and D-001 is
  the fallback. **This is the single gating decision for the plan phase.**

### D-003: Question whether a 5th skill is the right unit (compose verbs / extend overview-init / document the MCP tool)
- Contributing lenses: [devils-advocate] + (partially) [codex, copilot]
- Shape: three cheaper packagings to price before committing to a new skill +
  marketplace version bump — (i) COMPOSE from existing verbs (`upsert-task`
  skeleton -> `add-kanban-card --class cmd-warn` -> `set-prompts --brainstorm`);
  (ii) EXTEND `overview-init`'s dry-run -> confirm -> apply pattern; (iii) DO
  NOTHING new and document that power users call `overview.upsert_task` /
  `data-edit upsert-task` directly.
- Why this might work: avoids new surface area and the CI drift-check +
  version-bump coupling.
- Risks / friction: (i) compose-from-verbs = 3 writes / 3 locks / 3 diffs and
  MORE steps to desync the unchecked invariants; (ii) overview-init-extension
  blurs two distinct operations; (iii) do-nothing leaves the clobber + convention
  gap unaddressed. The operator explicitly asked for a NEW interactive skill, so
  this direction is recorded mainly as a sanity check — it loses to D-001/D-002
  on the stated goal.
- Cheapest validation: n/a (this is a packaging challenge, resolved by the
  operator's explicit "new skill" ask).
- Disconfirming observation: the operator's request for an interactive,
  guard-bearing, convention-scaffolding skill is not met by raw verb composition
  or by documentation alone.

---

## Recommended field set + prompt flow (for D-002, the wrapper is identical for D-001)

Prompted (interactive; prefer multiple-choice / `ask_user`-style where enum-ish,
honoring the operator's structured-prompt preference; described engine-neutrally
so the Copilot mirror is safe):

1. **id** (required) — validate `^[A-Za-z0-9_./-]+$`; suggest the kebab-case,
   scope-prefixed convention.
2. **scope** (required) — closed multiple-choice from the observed taxonomy
   (`codex | crews | codexu | ralph-overview | ralph | ralph-orchestration | ops
   | bookkeeping`) + a "combine two with `|`" option + "other (free text)". (Core
   enforces no scope taxonomy, so a closed list prevents off-taxonomy typos.)
3. **descriptionHtml** (required) — short one-line description -> `command.descriptionHtml`.
4. **problem-statement card** (required) — the single `cmd-warn` kanban card html.
5. **initialStage** (choice; default `brainstorming`) — `brainstorming | planning
   | plan-ready | none`.
6. **stage seed** — required when initialStage is `brainstorming`/`planning`
   (the matching `prompts` key is DERIVED from the stage); optional for
   `plan-ready`/`none`.

Derived / defaulted (NOT asked): `command.name := id`; `command.warnings := []`;
`command.prompts := { <stageKey>: <seed> }`; `lifecycle := "tracked"` (override-
able); `status := "todo"` (override-able); `lastTouchedAt := now()` (MUST inject —
upsert-task does not); `kanbanCards := [{ className: "cmd-warn", html: <card> }]`;
`initialStage` omitted when "none".

Flow: parse args -> gather fields -> summary-projection dup pre-check (all tasks
incl cold) -> assemble id-first canonical object (+ inject lastTouchedAt, force
command.name=id, derive prompts key) -> render for explicit Confirm/Edit/Cancel
(fail-closed if no human channel) -> write once via `overview.upsert_task`
(createOnly) or `data-edit upsert-task --create-only` (temp spec written to
staging, never under `.ralph-overview/`) -> show the diff + remind the operator
that git staging/commit/push is THEIR step.

## Files to add / change

- ADD `skills/create-task/SKILL.md`.
- GENERATE `.copilot-plugin/copilot-skills/create-task/SKILL.md`
  (`node scripts/generate-copilot-artifacts.mjs --write`; body must avoid the
  forbidden tokens `Skill(` / `Agent(` / `BashOutput` / `run_in_background` /
  `EnterPlanMode` / `ExitPlanMode`).
- **(D-002 only)** EXTEND `scripts/lib/data-edit-core.mjs` upsert-task with
  `createOnly`; add `--create-only` in `scripts/data-edit.mjs`; add the
  `overview.upsert_task` Zod field + handler in `tools/overview-mcp/src/`; re-pin
  `data-write-roundtrip.test.ts` (+ `stdio-tools-list.test.ts` if the tool shape
  changes) and add `data-edit-core.test.mjs` cases.
- UPDATE `README.md` + `AGENTS.md` skill inventory (4 guided skills -> 5).
- BUMP `.claude-plugin/plugin.json` version + the three marketplace indexes
  (`.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`,
  `.agents/plugins/marketplace.json`) at release time; consider the toolkit-root
  `AGENTS.md` plugin bullet.

## Open questions carried to planning

1. **(GATING)** Is extending the shared core with `createOnly`/`failIfExists` in
   scope (-> D-002, airtight), or does "reuse the core" mean freeze it
   (-> D-001, skill-only, race-prone)?
2. Non-interactive contract when there is no human to confirm: fail-closed +
   emit the assembled object, or refuse outright? (No undo verb -> writing
   unconfirmed is unrecoverable.)
3. Slash-command name: `/create-task` vs `/file-task` vs `/new-task`.
4. Should `scope` be a closed multiple-choice list (recommended) vs free text?
5. Non-interactive fallback: thin convention-applying flags only (recommended),
   or none at all? (Raw `--spec <file>` is rejected by all lenses.)
6. Should `descriptionHtml` / problem-card be allowed to be the same text for a
   minimal card-only filing, or always distinct?
