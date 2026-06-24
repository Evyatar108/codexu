# Stories Outline: Lean tracked-only body-stripped projection (`lean-tasks.json`) + read routing

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Extend the shared strip helper (presence flags + kanbanCards strip)
**Description:** As an agent reading `summary-projection.json`, I want `command.prompts` to expose presence flags and `kanbanCards` html removed, so the all-tasks summary loses its ~122 KB of kanban bulk and signals which prompt seeds exist without loading them.
**Acceptance Criteria:**
- [ ] In `ai-developer-toolkit/plugins/ralph-overview/scripts/lib/emit-projections.mjs`, `stripColdBodies` replaces `command.prompts` with `{ stripped:true, present:{ brainstorm, plan, impl }, approxBytes:N }` where `present[k]` is `typeof prompts[k] === 'string' && prompts[k].trim().length > 0` (all three keys always emitted).
- [ ] A new `stripKanbanCards` helper replaces a task's `kanbanCards` with `[{ className, approxBytes }, ...]` preserving array order; raw `html` is dropped. It is applied at the TASK level INDEPENDENTLY of `command` presence (a command-less task with cards must still be stripped — F-006).
- [ ] `stripColdBodies` remains pure: it shallow-clones task + command and never mutates the input (existing purity test still passes).
- [ ] `summary-projection.json` reflects both changes and remains ALL-tasks.
- [ ] `scripts/lib/emit-projections.test.mjs` summary assertions are updated: prompts marker includes `present` (tested for all three keys incl. empty-string), no raw kanban `html` remains, kanban marker present; a command-less-with-cards case is covered; the purity + additive (snapshot byte-identical) tests still pass.
- [ ] Typecheck passes; `npm test` (plugin-local) green on Windows.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Add the `lean-tasks.json` projection + config wiring
**Description:** As an agent triaging the live backlog, I want a tiny tracked-only, fully body-stripped projection so I can navigate active tasks without loading the full `data.json` hot shard or the body-heavy `active-tasks.json`.
**Acceptance Criteria:**
- [ ] `emit-projections.mjs` emits `lean-tasks.json` when `config.outputs.leanTasksJson` is set: `tasks.filter(t => t.lifecycle === 'tracked').map(stripColdBodies)`, with the same `{ generatedAt, generatedFromCommit, count, tasks }` envelope and `JSON.stringify(payload, null, 2) + '\n'` serialization as the siblings (preserving hot-then-cold order).
- [ ] `lean-tasks.json` is materially smaller than `active-tasks.json` AND < 40% of the `data.json` hot-shard size on the current corpus.
- [ ] `config.outputs.leanTasksJson` default = `.ralph-overview/generated/lean-tasks.json` in `scripts/lib/default-config.mjs`.
- [ ] `scripts/lib/resolve-config.mjs` wires `leanTasksJson` in BOTH the outputs destructure block AND the resolved-outputs rebuild block (mirroring `activeTasksJson`/`summaryProjectionJson`).
- [ ] `scripts/lib/default-config.d.mts` adds `leanTasksJson` to the `outputs` interface (and backfills the omitted `activeTasksJson`/`summaryProjectionJson`).
- [ ] `tools/overview-viewer/src/__tests__/scripts.d.ts` (duplicate `RalphOverviewConfig.outputs` type) is backfilled with `leanTasksJson` + the two existing projection keys it also lacks (F-008).
- [ ] `templates/overview-config.schema.json` adds `leanTasksJson` to `outputs.properties`.
- [ ] `scripts/lib/emit-projections.test.mjs` adds lean-projection tests: tracked-only; all three body classes (prompts, descriptionHtml, kanbanCards) stripped; spine fields verbatim; purity; additive.
- [ ] `scripts/lib/sync-core.test.mjs` integration test asserts a sync emits `lean-tasks.json` tracked-only AND that `snapshot.json` + the `.tasks` of `active-tasks.json` are byte-identical to a pre-change baseline (compare `.tasks`, not whole-file — `generatedAt` varies; F-002).
- [ ] Typecheck passes; `npm test` (plugin-local) green on Windows.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Additive per-scope navigation in `tasks/INDEX.md`
**Description:** As a human scanning the backlog, I want a per-scope navigation section in the generated index so I can jump to the tasks in one scope without scrolling the whole file.
**Acceptance Criteria:**
- [ ] `scripts/lib/emit-tasks-index.mjs` `buildTasksIndex` prepends an additive "Tasks by scope" section: multi-scope `scope` strings are split on `|`, deduped, scopes sorted alphabetically; under each scope, the member task ids are listed as links in snapshot order; tasks with no scope group under `(none)`.
- [ ] The nav links use an EXPLICIT anchor scheme that works for task ids containing `/`, `.`, `_`, `-` (e.g. emit `<a id="task-<raw-id>"></a>` on each detail block and link to `#task-<raw-id>`, or a documented+tested slug) — do NOT rely on renderer-dependent markdown auto-slugs (F-011).
- [ ] The existing flat `## <taskId>` detail blocks remain UNCHANGED below the nav section (the `## TASK` assertion in `sync-core.test.mjs` still passes).
- [ ] A test in `scripts/lib/emit-tasks-index.test.mjs` asserts the nav scope→task grouping (incl. a multi-scope task appearing under each scope and a punctuated id anchor) AND the detail blocks survive; `scripts/lib/emit-tasks-index.test.mjs` is ADDED to the `test:lib` file list in `package.json` so `npm test` runs it (F-007).
- [ ] Typecheck passes; `npm test` (plugin-local) green on Windows.
**Dependencies:** None
**Estimated complexity:** small

## US-004: Route reads to the lean surfaces (docs + consumer config/schema)
**Description:** As a bookkeeper/member, I want docs to point me at `lean-tasks.json` + the per-scope INDEX first, opening `data.json` only to mutate via `data-edit`, so accidental full-file context loads stop.
**Acceptance Criteria:**
- [ ] codexu `AGENTS.md` projection-reads guidance (~the "prefer the generated projections" paragraph) names `lean-tasks.json` as the canonical lean live-backlog read; the "Other generated files" list gains a `lean-tasks.json` entry describing it as tracked-only + fully body-stripped.
- [ ] `.ralph-overview/config.json` (codexu repo root) adds `outputs.leanTasksJson` (consistency; deep-merge makes it functionally optional).
- [ ] `.ralph/overview-config.schema.json` (codexu repo root) `outputs.properties` is brought in sync: adds `activeTasksJson`, `summaryProjectionJson`, AND `leanTasksJson` (fixing the pre-existing drift under `additionalProperties:false`).
- [ ] `templates/overview-config.template.json` adds `leanTasksJson` to its enumerated `outputs` (so scaffolded consumers match — F-003).
- [ ] Plugin docs updated: `README.md` ("two lazy read projections" → three), `docs/configuration.md` outputs table gains the projection keys, and the plugin AGENTS.md "Lazy read projections" note mentions the lean projection + kanbanCards strip; `data-edit` remains the only documented mutation path.
- [ ] No `scripts/lib` code/test changes required by this story (docs + config only); if `docs/configuration.md`/template changes are asserted by `tools/overview-mcp` `init-consumer.test.ts` / viewer `config.test.ts`, those tests pass.
**Dependencies:** US-002
**Estimated complexity:** small

## US-005: Release bookkeeping (version bump + indexes + changelog + version table)
**Description:** As a consumer running `copilot plugin update`, I want the version + marketplace indexes + changelog bumped in lockstep so the new projection ships and the CI invariant-check passes.
**Acceptance Criteria:**
- [ ] All THREE engine manifests bumped 2.12.0 → 2.13.0: `ai-developer-toolkit/plugins/ralph-overview/.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json` (F-001).
- [ ] The ralph-overview `version` field updated to 2.13.0 in all three marketplace indexes: `ai-developer-toolkit/.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`.
- [ ] `ai-developer-toolkit/plugins/ralph-overview/CHANGELOG.md` gets a new `## [2.13.0]` section documenting the lean projection + kanbanCards strip + per-scope index nav.
- [ ] codexu `AGENTS.md` active-plugin-versions table ralph-overview row → 2.13.0.
- [ ] `node tools/validate-codex-marketplace-policy.mjs` (from ai-developer-toolkit root) passes.
**Dependencies:** US-001, US-002, US-003, US-004
**Estimated complexity:** small
