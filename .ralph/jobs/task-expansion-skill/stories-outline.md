# Stories Outline: task-expansion-skill

*Preliminary decomposition from `/plan-with-ralph --from-brainstorm`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Checked-in 5-section template
**Description:** As an agent expanding a tracked task, I want a checked-in 5-section template in codexu so that every expansion follows the same format contract.
**Repo:** codexu
**Acceptance Criteria:**
- [ ] File `.ralph-overview/task-expansion-template.md` exists at codexu repo root.
- [ ] Contains exactly 5 sections in this order: `## 1. What it is`, `## 2. Why it matters`, `## 3. Upstream-conflict surface`, `## 4. Prerequisites (what unblocked this task)`, `## 5. Unblocks (what this task unblocks)`.
- [ ] Each section has a 1-paragraph "guidance" sub-block explaining what to write there (what evidence to cite, what to leave out).
- [ ] Header preamble: 1-paragraph "how to use the bundled context" pointing the reader at the `overview.expand_task_context` MCP tool and the bundle fields each section consumes.
- [ ] Evidence rubric block: instructs the author to (a) cite source files by path, (b) link commits by SHA, (c) distinguish auto-discovered `candidate:true` entries from operator-curated fields by prefixing with `(candidate)`.
- [ ] Typecheck N/A (markdown).
**Dependencies:** None.
**Estimated complexity:** small.

## US-002: MCP tool — schema, handler shell, registration
**Description:** As an agent, I want to call `overview.expand_task_context({ taskId })` and receive a typed JSON bundle so that I have structured context before authoring a task expansion.
**Repo:** ai-developer-toolkit/plugins/ralph-overview
**Acceptance Criteria:**
- [ ] `src/schemas.ts` exports `expandTaskContextInputSchema` (zod raw shape `{ taskId: z.string().regex(/^[A-Za-z0-9_./-]+$/).min(1) }` — note: regex rejects `:` so the internal story-node format `<task>:<story>` is rejected at input parse time) and `expandTaskContextOutputSchema` (strict `z.object({...}).strict()` with `templatePath: z.string().nullable()`, `planPath: z.string().nullable()`, `brainstormPath: z.string().nullable()`, `stage: ralphStageSchema.nullable()`, `caveats: z.array(z.string())`, etc.).
- [ ] `src/tools/expand-task-context.ts` exports `registerExpandTaskContextTool(server, context)` and async `expandTaskContext(context, input): Promise<ToolEnvelope<ExpandTaskContextResult>>` following the same pattern as `parallel-ready-tasks.ts`.
- [ ] Handler returns bundle with: `task` (OverviewTask), `stage` (RalphStage|null), `recentCommits` (≤ 20 from `git log --grep=<taskId> --format=%H%x00%s -n 20` via `execFile` with 5s `AbortSignal.timeout`; parsed on `\u0000` separator so SHA is full 40 chars), `prerequisitesCandidates: []` (empty for US-002; populated in US-003), `unblocksCandidates: []` (ditto), `planPath` (resolved by snapshot priority: `task.ralph?.artifacts?.jobDir + '/plan.md'` → `task.ralph?.jobSlug` → fallback `<taskId>`; null if no plan.md exists at any candidate), `brainstormPath` (or null), `templatePath` (or null if file absent), `caveats: string[]`.
- [ ] On git-log timeout (5s `AbortSignal.timeout` fires), return `recentCommits: []` AND append `"git log timed out after 5s"` to `caveats` instead of throwing.
- [ ] Not-found path returns the tool envelope `{ ok: false, error: "task id <id> not found in .ralph-overview/data.json; valid ids include: <first 5 ids>..." }` (envelope returned via `toToolResult`, not thrown).
- [ ] `src/server.ts` registers the tool via `registerExpandTaskContextTool(server, context)`. Server `version` bumped from `2.1.0` to `2.2.0`.
- [ ] `pnpm --filter @gim-home/ralph-overview-mcp typecheck` and `pnpm --filter @gim-home/ralph-overview-mcp build` pass.
**Dependencies:** None.
**Estimated complexity:** medium.

## US-003: Auto-discovery heuristics
**Description:** As an agent, I want the MCP tool's `prerequisitesCandidates` and `unblocksCandidates` arrays to surface likely upstream/downstream tasks so that I have starting points for the Prerequisites and Unblocks sections.
**Repo:** ai-developer-toolkit/plugins/ralph-overview
**Acceptance Criteria:**
- [ ] `prerequisitesCandidates` populated via two heuristics, every entry tagged `{ candidate: true, heuristic: "commit-message-grep" | "prompt-file-overlap", taskId?, sha?, file? }`:
  - `commit-message-grep`: for each `recentCommits` entry whose message references another known taskId (substring match against `data.json` task ids), emit `{ taskId, sha, heuristic: "commit-message-grep", candidate: true }`.
  - `prompt-file-overlap`: extract file paths from THIS task's `prompts.{brainstorm,plan,impl}` text via regex `(packages|src|scripts|docs|tools|\.ralph-overview|\.ralph|plugins)/[\w./-]+\.(ts|tsx|js|mjs|md|json|toml|rs)`. **Before applying the regex, normalize prompt text:** `prompt.replace(/\\\\/g, '/')` so Windows-authored prompts with backslashes aren't excluded. For each extracted path, scan `lifecycle=="merged"` tasks' `shipManifest.commits[].oneLine` for matches; emit `{ taskId, file, heuristic: "prompt-file-overlap", candidate: true }`.
- [ ] `unblocksCandidates` populated by inverse scan: extract file paths from this task's prompts (same normalized regex); for every other `lifecycle=="tracked"` task whose `prompts.*` text contains this task's id OR overlapping file paths, emit `{ taskId, heuristic: "prompt-id-reference" | "prompt-file-overlap", candidate: true }`.
- [ ] Both arrays deduplicated by `(taskId or sha, heuristic, file?)` tuple.
- [ ] When `task.scope` matches `/codex/i`, append `"task.scope contains 'codex'; codex-submodule commits were not searched"` to `caveats`.
- [ ] Heuristic file-path regex AND the backslash-normalization pre-pass documented as a top-of-file comment in `expand-task-context.ts`.
- [ ] `pnpm --filter @gim-home/ralph-overview-mcp typecheck` and `build` still pass.
**Dependencies:** US-002.
**Estimated complexity:** medium.

## US-004: Unit tests (≥ 5 cases)
**Description:** As a maintainer, I want unit-test coverage so that the tool's behavior is verifiable and refactor-safe.
**Repo:** ai-developer-toolkit/plugins/ralph-overview
**Acceptance Criteria:**
- [ ] New file `src/__tests__/expand-task-context.test.ts` using `vitest` and the existing `__tests__/helpers.ts` utilities (`setupTempRoot`, `writeOverviewData`, `writeSnapshot`, `makeContext`).
- [ ] ≥ 5 test cases:
  1. **Happy-path bundle shape:** returns `ok:true`, every documented field present, output validates against `expandTaskContextOutputSchema.parse(data)` (strict — would throw on extra/missing fields).
  2. **Prereq heuristic positive (fixture-driven, satisfies AC-3):** fixture has THIS task (`task-A`) with `prompts.plan` containing the string `"edit src/foo/bar.ts"`, and one `lifecycle="merged"` task (`task-B`) with `shipManifest.commits: [{ sha: "...", oneLine: "feat(foo): refactor src/foo/bar.ts" }]`. Assert `task-B` appears in `prerequisitesCandidates` with `heuristic: "prompt-file-overlap"` and `file: "src/foo/bar.ts"`.
  3. **Not-found error:** unknown taskId returns the envelope `{ ok: false, error: <message> }` whose error string starts with `"task id"` and contains the unknown id; does NOT throw.
  4. **Plan/brainstorm/template pointer presence vs absence:** parameterized — when `<repo>/.ralph/jobs/<task>/plan.md` exists → `planPath` is an absolute string ending in `plan.md`; when it doesn't → `planPath: null`. Same matrix for `brainstormPath` and `templatePath`.
  5. **Codex-scope caveat emission:** fixture task with `scope: "codex"` → bundle's `caveats` array contains the string `"task.scope contains 'codex'; codex-submodule commits were not searched"`.
- [ ] `pnpm --filter @gim-home/ralph-overview-mcp test` passes with all 5 new cases included.
**Dependencies:** US-003.
**Estimated complexity:** medium.

## US-005: Skill doc + plugin/marketplace version bumps + copilot mirror generation
**Description:** As an agent in either Claude Code or Copilot CLI, I want a discoverable `expand-task` skill so that I auto-invoke it when reasoning about a tracked task — AND I want the plugin version bumped consistently across all manifests so `copilot plugin update` actually picks it up post-merge.
**Repo:** ai-developer-toolkit/plugins/ralph-overview (+ toolkit-root marketplace files)
**Acceptance Criteria:**
- [ ] Source skill at `skills/expand-task/SKILL.md`. Frontmatter: `name: expand-task`, `description: > ...` describing when to invoke (agent considering a tracked task, picking a candidate from `parallel_ready_tasks`, planning a related task, etc.). Body instructs: (1) call `overview.expand_task_context({ taskId })` via MCP; (2) read the file at the returned `templatePath` (or proceed without if `null`); (3) author the 5 sections in order, citing bundle fields by name; (4) for each `candidate:true` entry, evaluate before including in prose; (5) emit output as markdown in chat reply unless a specific destination is requested.
- [ ] Copilot mirror generated by `node scripts/generate-copilot-artifacts.mjs --write` (do not hand-edit `.copilot-plugin/copilot-skills/expand-task/SKILL.md` — the generator creates and overwrites it from the `skills/` source). Generator script is run as part of the commit; the generated file IS checked in.
- [ ] Plugin metadata `version` field bumped in BOTH:
  - `.claude-plugin/plugin.json` (currently `2.6.0` → `2.7.0`)
  - `.github/plugin/plugin.json` (currently `2.6.0` → `2.7.0`)
  Neither file has a skill list (Claude Code auto-discovers from `skills/<name>/SKILL.md`; Copilot CLI loads from `.copilot-plugin/copilot-skills/`); both manifests just need the version bump.
- [ ] Marketplace `version` field bumped to the SAME new value (`2.7.0`) in all THREE toolkit-root index files:
  - `D:/ai-developer-toolkit/.claude-plugin/marketplace.json`
  - `D:/ai-developer-toolkit/.github/plugin/marketplace.json`
  - `D:/ai-developer-toolkit/.agents/plugins/marketplace.json`
- [ ] `CHANGELOG.md` updated with one bullet describing the new MCP tool + skill + version.
- [ ] After all the above edits + generator run, `git status` is clean of any unintended diffs; `pnpm --filter @gim-home/ralph-overview-mcp build` still passes.
- [ ] Grep verification: the new version string (`2.7.0`) appears in exactly the 5 files listed above (2 plugin manifests + 3 marketplace indexes) plus CHANGELOG.md.
**Dependencies:** US-002 (skill references the tool name).
**Estimated complexity:** medium (because of the multi-file version-bump coordination).

## US-006: Worked example + AC-8 noise-rate measurement (pre-publish, local dev plugin root)
**Description:** As the operator validating direction D-004, I want a worked example expansion + a measured `prerequisitesCandidates` noise rate so that the AC-8 fallback trigger is empirically checked BEFORE the plugin ships.
**Repo:** ai-developer-toolkit/plugins/ralph-overview (artifact lives under `tools/overview-mcp/docs/example-expansion.md`)
**Preconditions:** US-002..US-005 complete in the plugin worktree. The codexu repo on this machine is configured with `RALPH_OVERVIEW_PLUGIN_ROOT=D:/ai-developer-toolkit/.worktrees/task-expansion-skill/plugins/ralph-overview` so `bin/ralph-overview.mjs` resolves the in-development plugin (NOT the installed marketplace version).
**Acceptance Criteria:**
- [ ] Invoke `overview.expand_task_context({ taskId: "impl-mcp-server-notifications" })` against the local dev plugin and write the resulting 5-section expansion to `<plugin-worktree>/tools/overview-mcp/docs/example-expansion.md`, following the template verbatim (5 H2 headers in order).
- [ ] Expansion prologue (above the first H2) cites which bundle fields each section drew from, e.g. "Section 4 prereqs derived from `data.json.task.command.prompts.plan` (curated) plus `prerequisitesCandidates[0]` (commit-message-grep, candidate)".
- [ ] Repeat the tool invocation against 2 additional real backlog tasks of DISTINCT scopes (e.g. one plugin-scoped, one codex-scoped) and append a markdown judgment table to `example-expansion.md` with this schema:

      | sampleTaskId | candidateKey | candidateTaskId/sha/file | heuristic | judgment | rationale |
      |---|---|---|---|---|---|

  Per-row rules: `judgment ∈ {true, false, uncertain}`; count ONLY `prerequisitesCandidates` (not `unblocksCandidates`); dedupe by `(candidateTaskId or sha, heuristic, file)` tuple BEFORE judging; `uncertain` counts as `false` for the aggregate.
- [ ] Aggregate noise rate computed and recorded below the table: `noiseRate = falseCount / dedupedTotal`. If `dedupedTotal == 0` for ALL three samples, record `noiseRate: n/a (zero candidates surfaced)` and treat that as a non-failure for the purposes of AC-8 (zero candidates is silence, not noise).
- [ ] **AC-8 gate:** if `noiseRate > 0.5`, the impl member emits `kind=question` to operator citing the metric and recommending pivot to D-005 (operator-curated `unblocks[]`/`unblockedBy[]` TaskSchema fields, promoted from Phase 2 to v1). The impl member STOPS without pushing the plugin worktree to plugin main and waits for operator pivot. If `noiseRate <= 0.5` or `n/a`, the impl member proceeds to emit `kind=done` and the lead handles the merge.
- [ ] The judgment-table file is committed in the plugin worktree alongside the other US-006 changes; no codexu-side changes for this story.
**Dependencies:** US-005 (skill + version bumps complete so the local-dev tool is fully wired).
**Estimated complexity:** medium.
