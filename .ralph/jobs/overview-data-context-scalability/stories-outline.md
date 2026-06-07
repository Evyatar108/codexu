# Stories Outline: ID-scoped data.json write tooling + lazy read projections (D-001)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Each story is labeled with its repo. **US-T\* belong to the `ai-developer-toolkit` job (Job 1, ships first); US-C\* belong to the `codexu` job (Job 2, runs after Job 1 ships + the submodule pointer is bumped).** The two jobs are SEPARATE Ralph PRDs — a single PRD cannot span both repo roots.*

## US-T1 [ai-developer-toolkit]: Shared data.json mutation core
**Description:** As a bookkeeper, I want one shared, plugin-owned mutation library so that the CLI and MCP surfaces mutate `data.json` with bit-identical, invariant-checked, byte-stable behavior.
**Acceptance Criteria:**
- [ ] `plugins/ralph-overview/scripts/lib/data-edit-core.mjs` exposes `loadData` (via `parseOverviewDataJson`, NOT `loadOverviewData`), `applyVerb`, `validateInvariants`, `serialize` (`JSON.stringify(data,null,2)+'\n'`, LF), `writeData` (lock + `atomicWriteFile`), `unifiedDiff`, and `runVerb`.
- [ ] All 5 verbs implemented: `mark-shipped`, `upsert-task`, `set-lifecycle`, `add-kanban-card`, `set-prompts`, mutating exactly the fields in the plan's verb table.
- [ ] Global invariants enforced pre-write: result re-parses as JSON; every task non-empty string `id`; no duplicate ids; id matches `^[A-Za-z0-9_./-]+$`; target present after write (upsert insert = exactly one new id); in-place verbs preserve `tasks.length`. On any violation: throw, discard tmp, original untouched, non-zero exit (maps to C-1/C-2).
- [ ] Read-mutate-write is serialized by a lock to avoid lost updates.
- [ ] Serializing the unmodified current `data.json` is byte-identical to the original (no-op write = zero-byte diff); a test asserts the written bytes contain no `\r`.
- [ ] Unit tests (`data-edit-core.test.mjs`) cover happy path + each invariant violation (e.g. `set-lifecycle nonexistent-id` throws, no write).
- [ ] Typecheck/tests pass.
**Dependencies:** None
**Estimated complexity:** large

## US-T2 [ai-developer-toolkit]: `data-edit` bin subcommand
**Description:** As a bookkeeper, I want `node bin/ralph-overview.mjs data-edit <verb> <id> …` so that I can mutate `data.json` from a shell without hand-anchored edits.
**Acceptance Criteria:**
- [ ] `bin/ralph-overview.mjs` routes a `data-edit` subcommand to a thin wrapper over `runVerb`.
- [ ] Arg parsing for all 5 verbs, with large values via `--*-file <path>`/stdin (`--summary-file`, `--html`, `--plan-file`, `--json`, `--commit sha:oneLine[:repo]`).
- [ ] `data-edit --help` lists the 5 verbs; prints minimal unified diff + affected id on success; non-zero exit on invariant failure.
- [ ] Tests for the subcommand dispatch + at least one invariant-violation exit.
- [ ] Typecheck/tests pass.
**Dependencies:** US-T1
**Estimated complexity:** medium

## US-T3 [ai-developer-toolkit]: MCP write tools + CLI↔MCP parity test
**Description:** As an in-session lead, I want `overview.*` write tools so that I can mutate `data.json` without shelling out, with behavior bit-identical to the CLI.
**Acceptance Criteria:**
- [ ] `server.ts` registers `overview.upsert_task`, `overview.mark_shipped`, `overview.set_lifecycle`, `overview.add_kanban_card`, `overview.set_prompts` (snake_case — pending operator confirm), each a thin handler over `runVerb`, with Zod schemas in `schemas.ts`.
- [ ] Round-trip parity test at `tools/overview-mcp/src/__tests__/data-write-roundtrip.test.ts`: for each verb, seed two byte-identical fixture copies, mutate copy A via the CLI **subprocess** (`spawnSync node bin/ralph-overview.mjs data-edit …`) and copy B via the **in-process** MCP handler, then `Buffer.equals` the results = zero-byte diff. The test MUST NOT compare by calling the shared core twice (C-3).
- [ ] MCP package typecheck + tests pass.
**Dependencies:** US-T1
**Estimated complexity:** large

## US-T4 [ai-developer-toolkit]: Watcher read projections (additive)
**Description:** As an agent, I want small generated read projections so that I rarely need to load the full `data.json`.
**Acceptance Criteria:**
- [ ] `scripts/lib/emit-projections.mjs` emits `active-tasks.json` (exactly `lifecycle==='tracked'` tasks) and `summary-projection.json` (all tasks, with `command.prompts` + `command.descriptionHtml` replaced by `{stripped:true, approxBytes:N}`), wired into `emitAgentArtifacts`.
- [ ] New `config.outputs` keys added in `default-config.mjs` (and codexu `.ralph-overview/config.json` in US-C2; note `resolve-config.mjs` REPLACES, not merges, so the consumer config must carry the keys) (C-4).
- [ ] **C-7 test:** `node bin/ralph-overview.mjs sync` produces a `snapshot.json` whose `tasks` array is byte-identical before/after when no source edit occurred; projections are additive only.
- [ ] No new watch root / depth change (invariant #14). Tests pass.
**Dependencies:** US-T1 (ordering only; additive)
**Estimated complexity:** medium

## US-T5 [ai-developer-toolkit]: Engine-aware PreToolUse guard hook
**Description:** As a bookkeeper, I want a hook that flags raw `edit`/`apply_patch` on `data.json` so that muscle-memory edits are redirected to the helper.
**Acceptance Criteria:**
- [ ] Claude: `plugins/ralph-overview/hooks/hooks.json` (auto-discovered) PreToolUse entry → `hooks/pre-tool-use-data-edit.js`, returning `{"decision":"block","reason":…}` with the `data-edit` helper invocation when an `edit`/`apply_patch`/`write` targets `**/.ralph-overview/data.json`.
- [ ] Copilot: `.github/plugin/plugin.json` carries `"hooks": ".github/plugin/hooks.json"`; `.github/plugin/hooks.json` `preToolUse` → `hooks/copilot-pre-tool-use-data-edit.js`, returning `{permissionDecision:"deny", permissionDecisionReason, decision:"block", reason}`. Document the Copilot edit-tool best-effort caveat (v0.16.4) + reliable-on-shell behavior.
- [ ] `.claude-plugin/plugin.json` NOT modified for hooks (invariant #5).
- [ ] Unit test feeds synthetic edit-on-data.json + non-data.json payloads to each hook script and asserts deny/allow JSON + helper substring (C-5).
**Dependencies:** US-T1 (helper invocation text)
**Estimated complexity:** medium

## US-T6 [ai-developer-toolkit]: Release ceremony + docs
**Description:** As a consumer, I want the plugin version + docs updated so that the new write/read surfaces are discoverable and installable.
**Acceptance Criteria:**
- [ ] `plugin.json` version bump + the 3 marketplace indexes updated in lockstep (Codex policy-enum valid).
- [ ] Plugin `AGENTS.md` gains a behavioral section for the write tools + projections + hook; `README.md` lists the new CLI + MCP verbs; `docs/extending.md` + `CHANGELOG.md` updated (C-8 plugin half).
- [ ] Plugin build/typecheck/tests green.
**Dependencies:** US-T1, US-T2, US-T3, US-T4, US-T5
**Estimated complexity:** medium

## US-C1 [codexu]: Submodule pointer bump
**Description:** As codexu, I want the `ai-developer-toolkit` pointer bumped to the shipped toolkit commit so that the CLI wrapper resolves the new lib + subcommand.
**Acceptance Criteria:**
- [ ] `ai-developer-toolkit` submodule pointer recorded at the Job-1 ship commit (toolkit committed/pushed first; codexu records only the SHA).
- [ ] `node bin/ralph-overview.mjs data-edit --help` resolves and lists the 5 verbs from the in-tree submodule.
**Dependencies:** Job 1 shipped
**Estimated complexity:** small

## US-C2 [codexu]: Thin CLI wrapper + config
**Description:** As a bookkeeper, I want `node tools/data-edit.mjs <verb>` so that the documented ergonomics work in the codexu checkout.
**Acceptance Criteria:**
- [ ] `tools/data-edit.mjs` forwards argv to `node bin/ralph-overview.mjs data-edit` (resolving the plugin via the existing wrapper); `package.json` adds a `data-edit` script.
- [ ] `.ralph-overview/config.json` carries the new `outputs.activeTasksJson` + `outputs.summaryProjectionJson` keys (REPLACE semantics).
- [ ] Smoke test: a fixture-scoped `data-edit set-lifecycle` round-trips and re-parses.
**Dependencies:** US-C1
**Estimated complexity:** small

## US-C3 [codexu]: AGENTS.md bookkeeper-invariants rewrite
**Description:** As any bookkeeper, I want AGENTS.md to declare the helpers canonical so that edit-anchor regressions stop recurring.
**Acceptance Criteria:**
- [ ] Root `AGENTS.md` `## Bookkeeper operating invariants → data.json edit-anchor safety` rewritten: helper/MCP = canonical WRITE path; `active-tasks.json`/`summary-projection.json` = canonical READ paths; edit-anchor rules demoted to last-resort fallback (C-8 codexu half).
- [ ] Edits land in `AGENTS.md` ONLY — the gitignored `CLAUDE.md` is NOT staged.
**Dependencies:** US-C1
**Estimated complexity:** small

## US-C4 [codexu]: Deterministic adoption-evidence dry-run
**Description:** As a reviewer, I want fixture-based proof the helper performs ship updates cleanly so that adoption is verifiable inside the Ralph job.
**Acceptance Criteria:**
- [ ] A fixture copy of `data.json` is mutated by the helper across `set-lifecycle <id> merged` + `mark-shipped <id> --summary-file … --commit …` for two distinct fixture task ids; captured invocations + unified-diff recorded as test artifacts; post-write `JSON.parse` exits zero and `tasks.length` preserved (C-6, deterministic scope).
- [ ] AGENTS.md operational-practice section references the fixture transcripts as the adoption pattern; the two real-task operator-in-the-loop ships are filed as a separate follow-up task (deferred, NOT gating this job).
**Dependencies:** US-C2, US-C3
**Estimated complexity:** medium
