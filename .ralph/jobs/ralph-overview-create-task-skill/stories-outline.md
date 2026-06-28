# Stories Outline: ralph-overview-create-task-skill

Direction: **D-002** (guided `/create-task` skill + `createOnly` flag pushed into
the shared `upsert-task` core). See `plan.md` for the gating decision the
operator may veto (D-002 vs D-001). Target repo for impl: the
`ai-developer-toolkit` submodule (`plugins/ralph-overview/`).

All paths below are relative to `ai-developer-toolkit/plugins/ralph-overview/`
unless prefixed with `<toolkit>/` (the `ai-developer-toolkit` submodule root).

---

## US-001 — Core: `createOnly` guard on `upsert-task`

**As** the bookkeeper, **I want** `upsert-task` to refuse to overwrite an
existing id when `createOnly` is set, **so that** a new-task filing can never
silently clobber an existing tracked OR cold (`merged`/`archived`) task.

**Files:** `scripts/lib/data-edit-core.mjs`.

**Acceptance criteria:**
- AC-1: `applyVerb(data, 'upsert-task', { id, task, createOnly: true })` throws
  a clear Error naming the existing id + its lifecycle when a task with that id
  already exists in `data.tasks`; it does NOT mutate `data`.
- AC-2: With `createOnly` absent/false, `upsert-task` keeps EXACT current
  insert-or-replace behavior (regression: existing `data-edit-core.test.mjs`
  upsert cases still pass unchanged).
- AC-3: The guard runs BEFORE any push/replace and before `validateInvariants`,
  so on a block the file is byte-unchanged (verified end-to-end via `runVerb`).
- AC-4: In split mode the guard sees cold ids because `runVerbSplit` passes the
  assembled hot+cold union to `applyVerb` (no separate cold read added).

**Verification:** `npm run test:lib` (new cases in `data-edit-core.test.mjs`).

**Dependencies:** none.

---

## US-002 — CLI: `--create-only` flag on `data-edit upsert-task`

**As** an operator/agent at the CLI, **I want** `node bin/ralph-overview.mjs
data-edit upsert-task <id> --json <f> --create-only`, **so that** the no-clobber
guard is reachable from the dispatcher path the skill's fallback uses.

**Files:** `scripts/data-edit.mjs`.

**Acceptance criteria:**
- AC-1: `--create-only` is parsed as a boolean (handled like `--force`, NOT in
  `VALUE_FLAGS`); unknown-flag handling is unaffected.
- AC-2: `buildVerbArgs` `upsert-task` case passes `createOnly:
  Boolean(flags['create-only'])` into the verb args.
- AC-3: Running `... upsert-task <existing-id> --json <f> --create-only` exits
  non-zero with the core's error message and leaves data.json untouched; without
  the flag, the same command still replaces (regression).
- AC-4: `--help` / `HELP` text documents `[--create-only]` on the `upsert-task`
  line.

**Verification:** manual CLI smoke against a throwaway repo copy (existing-id →
non-zero + untouched; fresh-id → insert). Covered for parity by US-006.

**Dependencies:** US-001.

---

## US-003 — MCP: `createOnly` field on `overview.upsert_task`

**As** an agent using MCP, **I want** `overview.upsert_task` to accept
`createOnly: true`, **so that** the guard-immune MCP write path the skill
prefers can guarantee no-clobber.

**Files:** `tools/overview-mcp/src/schemas.ts`,
`tools/overview-mcp/src/tools/data-write.ts`.

**Acceptance criteria:**
- AC-1: `upsertTaskInputSchema` gains `createOnly: z.boolean().optional()`.
- AC-2: `upsertTask()` passes `createOnly: input.createOnly` into
  `execVerb(context, 'upsert-task', { id, task, createOnly })`.
- AC-3: The `overview.upsert_task` tool DESCRIPTION string and the 11-tool list
  are UNCHANGED, so `stdio-tools-list.test.ts` passes without edits.
- AC-4: Calling the handler with `createOnly: true` against an existing id
  returns `{ ok: false, error: <core message> }` and does not write; against a
  fresh id it inserts.

**Verification:** `npm test` (overview-mcp suite; `stdio-tools-list.test.ts`
green). Parity pinned by US-006.

**Dependencies:** US-001.

---

## US-004 — Guided `/create-task` skill (Claude source)

**As** an operator/agent, **I want** a `/create-task` skill that interactively
files a new `tracked` task into `data.json` in the canonical Filed shape, **so
that** filing a task no longer requires hand-writing JSON or risking a clobber.

**Files:** `skills/create-task/SKILL.md` (NEW).

**Acceptance criteria:**
- AC-1: Running the skill and answering prompts files a NEW task with the exact
  Filed shape: `lifecycle: "tracked"`, `status: "todo"` (unless overridden), a
  single `cmd-warn` problem-statement `kanbanCards` entry, `command.name == id`,
  `command.warnings == []`, one `command.prompts.<stage>` seed whose key agrees
  with the chosen `initialStage` (or empty prompts when `initialStage == none`),
  a valid injected `lastTouchedAt`, and NO `shipManifest`.
- AC-2: The write goes through the shared core (preferred `overview.upsert_task`
  with `createOnly: true`, fallback `data-edit upsert-task --json <tmp>
  --create-only`), NOT a raw data.json edit; the write-guard hook is not tripped.
- AC-3: Before writing, the skill reads `summary-projection.json` (ALL tasks
  incl cold) and STOPS with a clear error (naming the existing id + lifecycle)
  if the id already exists. **When `summary-projection.json` is ABSENT** (it is
  watcher-emitted and frequently missing), the skill degrades gracefully — reads
  `data.json`+`data.archived.json` directly OR skips the pre-check — and never
  crashes/hard-blocks on its absence (the core `createOnly` guard remains the
  real safety net).
- AC-4: The skill renders the assembled object and asks Confirm / Edit / Cancel
  before writing, and FAILS CLOSED (does not write; emits the assembled object)
  when no human confirmation channel exists and no explicit `--yes` was passed.
- AC-5: The skill performs NO git operations and ends by reminding the operator
  that git staging/commit/push is their step; it prints the returned diff.
- AC-6: A thin non-interactive flag set (`--id/--scope/--card/--brainstorm|--plan/
  --stage/--yes`) runs the same guard + scaffolding + core write; a raw
  `--spec <file>` full-JSON mode is explicitly REJECTED.
- AC-7: The SKILL.md body contains none of the FORBIDDEN tokens (`Skill(`,
  `Agent(`, `BashOutput`, `run_in_background`, `EnterPlanMode`, `ExitPlanMode`).

**Verification:** read-through against the AC list + the `overview-init` house
style; `generate-copilot-artifacts.mjs --check` (US-005) confirms no forbidden
tokens. Manual dry-run of the gather→assemble→confirm flow against a throwaway
repo.

**Dependencies:** US-001, US-002, US-003 (the skill's preferred write path is
the `overview.upsert_task` MCP tool with `createOnly` (US-003); its fallback is
the CLI `--create-only` flag (US-002); both rely on the core guard (US-001)).

---

## US-005 — Copilot mirror regenerated

**As** a Copilot-CLI user, **I want** `/create-task` to work identically under
Copilot, **so that** the skill is cross-engine like the other ralph-overview
skills.

**Files:** `.copilot-plugin/copilot-skills/create-task/SKILL.md` (GENERATED).

**Acceptance criteria:**
- AC-1: `node scripts/generate-copilot-artifacts.mjs --write` emits the mirror;
  the committed mirror matches source (`--check` drift-check is green).
- AC-2: The mirror contains no FORBIDDEN tokens.

**Verification:** `node scripts/generate-copilot-artifacts.mjs --check`.

**Dependencies:** US-004.

---

## US-006 — Tests: createOnly hot/cold/fresh + CLI↔MCP parity

**As** a maintainer, **I want** the new behavior pinned, **so that** the
no-clobber guard and the byte-parity contract can't regress.

**Files:** `scripts/lib/data-edit-core.test.mjs`,
`scripts/lib/data-edit-core-split.test.mjs`,
`tools/overview-mcp/src/__tests__/data-write-roundtrip.test.ts`.

**Acceptance criteria:**
- AC-1: A test in `data-edit-core.test.mjs` asserts `createOnly` blocks an
  existing HOT id (throws; `runVerb` leaves the file byte-unchanged).
- AC-2: A test in `data-edit-core-split.test.mjs` asserts `createOnly` blocks an
  existing COLD id (split fixtures: hot + `data.archived.json`); BOTH shards
  byte-unchanged. (The disconfirming test that motivated D-002.)
- AC-3: A test asserts `createOnly` ALLOWS a fresh id (inserts exactly one),
  and that default (no `createOnly`) replace still works.
- AC-4: A `data-write-roundtrip.test.ts` case drives both the CLI subprocess
  (`--create-only`) and the MCP handler (`createOnly: true`) against
  byte-identical fixtures and byte-diffs: a fresh insert is byte-identical, and
  an existing-id attempt is rejected identically by both surfaces. NOTE: the
  reject case must NOT reuse `assertByteParity()` (it asserts the file CHANGED,
  and `runCli` throws on non-zero exit) — use a dedicated assertion that both
  surfaces error AND both files stay byte-identical to the seed (review M1).

**Verification:** `npm run test:lib` + `npm test`.

**Dependencies:** US-001, US-002, US-003.

---

## US-007 — Docs, version bump, marketplace indexes

**As** a maintainer, **I want** the inventory/version/indexes updated, **so
that** consumers discover `/create-task` and pick up the release.

**Files:** `README.md`, `AGENTS.md`, `CHANGELOG.md`,
`.claude-plugin/plugin.json`, `<toolkit>/.claude-plugin/marketplace.json`,
`<toolkit>/.github/plugin/marketplace.json`,
`<toolkit>/.agents/plugins/marketplace.json`, `<toolkit>/AGENTS.md`
(Ralph Overview Plugin bullet if it lists skills).

**Acceptance criteria:**
- AC-1: README + AGENTS.md skill inventory updated "4 guided skills → 5" with a
  `/create-task` description; the user-facing term follows the
  `overview-naming-rebrand` decision (see plan.md "Ship & serialization").
  NOTE: the docs say "4 guided skills" deliberately (excluding `expand-task`);
  use "4 → 5", do NOT recount `skills/` directories (which would read 5 → 6).
- AC-2: `CHANGELOG.md` gets a prepended `## [2.15.0]` entry covering the new
  skill + the `createOnly` core/CLI/MCP addition.
- AC-3: `plugin.json` and all THREE marketplace indexes bump `2.14.1 → 2.15.0`
  in lockstep (AGENTS.md invariant #6); `node <toolkit>/tools/validate-codex-marketplace-policy.mjs`
  passes.

**Verification:** `git grep 2.15.0` shows the four version stamps; marketplace
policy validator green.

**Dependencies:** US-001..US-006 (version bump is the last step). **SERIALIZE
with the `overview-naming-rebrand` impl at ship time** — same plugin, conflicting
version/index/CHANGELOG writes (see plan.md).

---

## Suggested execution order

1. US-001 (core flag) — unblocks everything.
2. US-002 + US-003 (CLI + MCP wiring) — parallel-safe with each other.
3. US-004 (skill) — depends on US-001.
4. US-006 (tests) — after US-001/002/003.
5. US-005 (mirror) — after US-004.
6. US-007 (docs + version + indexes) — last; serialize with the rebrand impl.

Single-job (not parallel-decomposed): the surface is one plugin, tightly
coupled (core flag → wiring → skill → tests → version), and same-plugin parallel
conflicts on version/index/CHANGELOG. Run as one `/implement-with-ralph` job.
