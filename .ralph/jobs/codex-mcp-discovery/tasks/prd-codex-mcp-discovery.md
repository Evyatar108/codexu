# PRD: Codex Agent Per-cwd `.mcp.json` Discovery

*Generated autonomously by `/implement-with-ralph` Phase 2 PRD subagent on 2026-05-13 from `D:/harness-efforts/codexu/.ralph/jobs/codex-mcp-discovery/plan.md` (round-2 reviewed) and `stories-outline.md`.*

## Introduction

The Claude agent under happy reads `<cwd>/.mcp.json` at session start (Claude Code's project-MCP convention), so a project that drops a `.mcp.json` in its repo root lights up automatically. The codex agent does not — `packages/happy-cli/src/codex/runCodex.ts:700–705` builds the `mcpServers` object handed to `client.startThread({ mcpServers })` and to `resumeExistingThread({ mcpServers })` with **only** the `happy` bridge entry; project-level MCP servers (including `codexu`'s own `paper` HTTP server in the repo's `.mcp.json`) are silently dropped.

This feature closes the gap entirely on the happy-cli side (codex submodule is untouched): introduce a Zod-validated loader that reads `<cwd>/.mcp.json` at thread setup, validates each entry with a `command`-XOR-`url` superRefine, strips the Claude-style `type` field, merges the result into the object passed to both call sites, logs per-entry warnings on malformed or ambiguous input, and treats the `happy` bridge name as reserved. Four new sibling tests in `packages/happy-cli/src/codex/` exercise both the start and resume paths against mocked `client.startThread` / `client.resumeThread`. Roadmap, parallel-assignments, overview (with all six SKILL.md-mandated edits), parity-audit doc, and the happy-cli `CLAUDE.md` open-gap entry are flipped to delivered in the same atomic commit.

## Goals

- Surface every per-cwd `.mcp.json` entry to the codex agent automatically — both stdio and HTTP transports.
- Validate each entry with a Zod schema that enforces `command` XOR `url`, strips the Claude-style `type` field, and reserves the `happy` bridge name.
- Skip-and-log malformed entries; never abort the codex session because of a bad `.mcp.json`.
- Cover both `client.startThread` (first-turn) and `client.resumeThread` (resume) paths via mocked sibling tests.
- Flip all five roadmap/audit/CLAUDE.md doc artifacts to delivered status in the same atomic commit (single commit at HEAD, allowed to be created via initial commit + one `git commit --amend` to fold in the resolved SHA per Acceptance Criterion 9 of the plan).

## User Stories

### US-001: Project `.mcp.json` loader module
**Description:** As a codex-agent maintainer, I want a Zod-validated `loadProjectMcpServers(cwd)` helper so the codex runner can safely consume per-cwd `.mcp.json` files (both stdio and HTTP shapes) with structured warnings on malformed input and a reserved `happy` bridge name.

**Acceptance Criteria:**
- [ ] New file `packages/happy-cli/src/codex/projectMcpConfig.ts` exports `loadProjectMcpServers(cwd: string): Record<string, Record<string, unknown>>` (sync — matches `codexAppServerDiscovery.ts` style).
- [ ] Zod schema is `z.union([StdioEntry, HttpEntry])` where each branch uses `.passthrough()` AND the union has a `.superRefine((entry, ctx) => ...)` that adds an issue when both `command` and `url` are present (XOR enforcement).
- [ ] `StdioEntry` shape: `{ command: z.string(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(), type: z.literal('stdio').optional() }.passthrough()`.
- [ ] `HttpEntry` shape: `{ url: z.string(), type: z.literal('http').optional() }.passthrough()`.
- [ ] Root schema: `z.object({ mcpServers: z.record(z.string(), z.unknown()) }).passthrough()`.
- [ ] Absent `.mcp.json` → returns `{}` silently (no log).
- [ ] JSON parse error → `logger.warn('[codex] .mcp.json parse failed', { path, reason })`; returns `{}`.
- [ ] Root shape invalid → `logger.warn('[codex] .mcp.json root shape invalid', { path, issues })`; returns `{}`.
- [ ] Per-entry validation: each entry independently `safeParse`d; on failure (including superRefine XOR violation), `logger.warn('[codex] .mcp.json server invalid', { path, serverName, issues })` and skip that entry only; valid entries accumulated into the result.
- [ ] Entry name `'happy'` is skipped with `logger.warn('[codex] .mcp.json: server name "happy" is reserved for the Happy bridge — entry skipped', { path })`.
- [ ] `type` field is stripped from each valid entry before return (matches codex plugin loader behavior at `codex/.../core-plugins/src/loader.rs:1042`).
- [ ] Extra Codex-supported fields (`http_headers`, `bearer_token_env_var`, `env_vars`, `cwd`, `startup_timeout_sec`, `tool_timeout_sec`, `enabled`, `required`, tool allow/deny) flow through verbatim via `.passthrough()` on each branch.
- [ ] Sibling `packages/happy-cli/src/codex/projectMcpConfig.test.ts` is created with these test cases:
  - Valid HTTP entry (`{ type: 'http', url: '...' }`) → returns one entry; `type` stripped; `url` preserved.
  - Valid stdio entry (`{ command: 'node', args: ['x'] }`) → returns one entry; `command` and `args` preserved.
  - Absent `.mcp.json` → returns `{}`, no log.
  - Malformed JSON → returns `{}`, `logger.warn` called with path-bearing payload.
  - Invalid root shape (e.g., `{}` with no `mcpServers` key) → returns `{}`, `logger.warn` called.
  - Mixed valid + invalid entries → returns only the valid ones; one `logger.warn` per invalid entry.
  - **Ambiguous entry `{ command: 'x', url: 'y' }`** → skipped with a warning citing the XOR-violation issue.
  - Entry name `'happy'` in project file → skipped with reserved-name warning.
  - Entry with extra Codex-supported fields (`http_headers`, `bearer_token_env_var`) → preserved verbatim via passthrough.
- [ ] Helper tests use `mkdtempSync` + `writeFileSync` for fixtures; each test cleans its own tmpdir; tests do NOT call `process.chdir` (helper takes `cwd` as arg).
- [ ] `pnpm --filter '{packages/happy-cli}' run typecheck` passes.
- [ ] `pnpm --filter '{packages/happy-cli}' exec vitest run packages/happy-cli/src/codex/projectMcpConfig.test.ts` passes.

**Dependencies:** none

### US-002: Wire loader into `runCodex.ts` + acceptance tests
**Description:** As a codex-agent user, I want my project's `.mcp.json` to light up automatically on both `client.startThread` (first turn) and `client.resumeThread` (resume) — matching Claude Code's project-MCP convention.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/codex/runCodex.ts` at the existing `mcpServers` build site (~L700–705) captures `const cwdAtStart = process.cwd()` once.
- [ ] `loadProjectMcpServers(cwdAtStart)` is called and the result is merged into `mcpServers` with the `happy` bridge spread LAST so the bridge always wins on duplicate-name conflicts (defense-in-depth on top of loader's reserved-name guard).
- [ ] The same `cwdAtStart` is used for the `cwd:` arg of both `resumeExistingThread(...)` (~L719–726) and `client.startThread(...)` (~L789–795) — replacing any inline `process.cwd()` at those call sites.
- [ ] `packages/happy-cli/src/codex/resumeExistingThread.ts:20–33` is left unchanged (already forwards `mcpServers` correctly).
- [ ] No edit is made to `packages/happy-cli/src/codex/codexAppServerClient.ts` (reconnect via `rememberThreadDefaults` at L1172 covers persistence automatically).
- [ ] New sibling `packages/happy-cli/src/codex/runCodex.projectMcp.test.ts` is created with 4 acceptance tests, all using HTTP fixtures matching the repo's actual `.mcp.json`: `{ mcpServers: { paper: { type: 'http', url: 'http://127.0.0.1:29979/mcp' } } }`.
- [ ] Test (a) — valid HTTP `.mcp.json`: cwd contains the fixture above; the mocked `client.startThread` is called with `mcpServers` containing BOTH the `happy` bridge AND the `paper` entry; the `paper` entry has `type` stripped; `url` preserved.
- [ ] Test (b) — absent `.mcp.json`: cwd has no `.mcp.json`; the mocked `client.startThread` is called with `mcpServers` containing ONLY `happy`.
- [ ] Test (c) — broken-JSON `.mcp.json`: cwd has a file `.mcp.json` whose contents are syntactically invalid JSON (concrete fixture: file body `{ not valid json`); `logger.warn` is called (with a path-bearing payload) AND the mocked `client.startThread` is called with `mcpServers` containing ONLY `happy`.
- [ ] Test (d) — resume path: cwd has the valid HTTP `.mcp.json` AND the run is invoked with `opts.resumeThreadId` set; `./resumeExistingThread` is **NOT** mocked (unlike `runCodex.fork.test.ts`); the real forwarder runs; the mocked `client.resumeThread` is asserted to have been called with `mcpServers` containing BOTH the `happy` bridge AND the `paper` entry.
- [ ] All 4 tests explicitly set `MockCodexAppServerClient.hasActiveThread = vi.fn(() => false)` (unlike `runCodex.fork.test.ts` which sets it to `true` and skips the startThread path).
- [ ] All 4 tests enqueue at least one user batch (otherwise runCodex exits before `client.startThread` is called).
- [ ] Test setup uses `mkdtempSync` + `process.chdir` into the tmpdir; `afterEach` restores the original cwd (NOT just `process.chdir(originalCwd)` once at the end — must be in `afterEach` for isolation).
- [ ] `pnpm --filter '{packages/happy-cli}' exec vitest run` exits 0 (preferably command logged to `/tmp/codexu-mcp-disc.log` per the feature request; a repo-relative log path such as `.ralph/jobs/codex-mcp-discovery/test-output.log` is acceptable if the shell lacks `/tmp`).
- [ ] No existing tests regress (including `runCodex.fork.test.ts`, `runCodexPublishMode.test.ts`, `runCodex.attachmentsIgnore.test.ts`, `codex.integration.test.ts`).
- [ ] `pnpm -r run typecheck` (or `pnpm --filter '{packages/happy-cli}' run typecheck` for the package alone) exits 0.

**Dependencies:** US-001

### US-003: Roadmap, parity audit, overview, and CLAUDE.md docs flipped + single atomic commit
**Description:** As a codex-roadmap maintainer, I want the `mcp-discovery` work marked delivered across roadmap, parallel-assignments, overview (with full SKILL.md procedure-B metadata), parity audit doc, and the happy-cli CLAUDE.md open-gap entry, so future readers see a consistent state. Everything lands in one atomic commit at HEAD (allowed via initial commit + one `git commit --amend` to fold in the resolved SHA).

**Acceptance Criteria:**
- [ ] `plans/codexu-roadmap.md` (~L472–489): the bullet "Codex agent project-`.mcp.json` parity" is prefixed with `- ✅ ` (dash, space, checkmark emoji, space) preserved before the existing bullet text; the `(open, surfaced 2026-05-13)` qualifier is changed to `(delivered 2026-05-13)`. No strikethrough; no extra date suffix in the bullet itself.
- [ ] `plans/parallel-assignments.md`: the `mcp-discovery` tab/row is flipped to delivered status using the visual convention used by adjacent delivered rows in that file (inspect at edit time — likely a status column flip or ✅ prefix mirroring the roadmap).
- [ ] `plans/overview.html` receives ALL six SKILL.md procedure-B edits per `.agents/skills/roadmap-and-overview/SKILL.md:81-164`, with the embedded JSON block at `plans/overview.html:1900-1908,1944-1952`:
  - (1) `<summary>` badge class for `id="cmd-mcp-discovery"`: flipped from `b-ready`/`b-inflight` to `b-closed`.
  - (2) Emoji + text: `🟡 in progress` → `✅ shipped`.
  - (3) `cmd-desc`: append `· commit <code>SHA</code>` (filled in during the `--amend`).
  - (4) Kanban card (if present): `border-color: var(--warn)` → `border-color: var(--ok); opacity: 0.8`; sub-text `(in progress)` → `(shipped <SHA>)`.
  - (5) Add a `runs[]` entry: `{ id: "mcp-discovery/2026-05-13", taskId: "mcp-discovery", ranAt: "<commit ISO>", outcome: "completed", commits: ["<short sha>"], summary: "per-cwd .mcp.json discovery for codex agent" }`.
  - (6) Bump `lastTouched["mcp-discovery"]` to commit ISO timestamp; bump `generatedAt` to commit ISO timestamp; bump `generatedFromCommit` to commit short SHA.
- [ ] `plans/codex-agent-parity-audit.md` is updated in two places: L63–82 (the High-priority gap entry) and L341 (the "ship mcp-discovery first" recommendation), both flipped to a delivered/shipped marker matching the doc's adjacent-shipped convention (inspect at edit time — likely a status header change from `Severity: High` to `Status: Shipped 2026-05-13` or similar).
- [ ] `packages/happy-cli/CLAUDE.md:236–258`: the open-gap bullet is **deleted entirely** (no "Delivered" subsection exists in this file — verified). Optionally a one-line cross-reference may replace it (e.g., `Project-cwd \`.mcp.json\` discovery shipped 2026-05-13; see plans/codexu-roadmap.md for the closed bullet.`). No `<sha>` placeholder.
- [ ] **Single atomic commit at HEAD**, created in two operations per the plan's Acceptance Criterion 9:
  - (1) Run `pnpm --filter '{packages/happy-cli}' exec vitest run` and `pnpm -r run typecheck` BEFORE committing. Both must be green.
  - (2) Stage all code+tests+docs with `overview.html` SHA-bearing fields set to `"pending"` (`runs[].commits = ["pending"]`, `generatedFromCommit = "pending"`, kanban sub-text `(shipped pending)`, cmd-desc commit suffix `pending` if added).
  - (3) `git commit -m 'feat(happy-cli/codex): per-cwd .mcp.json discovery — closes codexu-roadmap "Codex agent project-.mcp.json parity"'`.
  - (4) Capture `SHA=$(git rev-parse --short HEAD)` and `ISO=$(git log -1 --format=%cI HEAD)`.
  - (5) Edit `plans/overview.html` to replace the `pending` sentinels with the actual `SHA` and `ISO` values; bump `generatedAt = ISO` and `runs[0].ranAt = ISO` if those were left as previous values during staging.
  - (6) `git commit --amend --no-edit` — commit message unchanged; only the overview.html metadata diff folded into the existing commit.
- [ ] After the amend, `git log -1 --format='%H %s'` shows exactly one new commit and the SHA referenced in `overview.html` matches `git rev-parse --short HEAD`.
- [ ] `git status` is clean after the commit (no uncommitted files left over).

**Dependencies:** US-001, US-002

## Functional Requirements

- **FR-1:** A new module `packages/happy-cli/src/codex/projectMcpConfig.ts` MUST export a synchronous function `loadProjectMcpServers(cwd: string): Record<string, Record<string, unknown>>`.
- **FR-2:** The function MUST read `<cwd>/.mcp.json`, return `{}` if the file is absent (no log), and `logger.warn` + return `{}` on JSON parse error or invalid root shape.
- **FR-3:** Each entry under `mcpServers` MUST be validated independently via `safeParse` so one bad entry does not invalidate the others.
- **FR-4:** The entry Zod schema MUST be `z.union([StdioEntry, HttpEntry])` with `.passthrough()` on each branch AND a `.superRefine` that rejects entries containing BOTH `command` and `url`.
- **FR-5:** The `type` field MUST be stripped from each valid entry before merging into the result object.
- **FR-6:** Entries named `'happy'` MUST be skipped with a reserved-name warning.
- **FR-7:** Extra Codex-supported fields (`http_headers`, `bearer_token_env_var`, `env_vars`, `cwd`, `startup_timeout_sec`, `tool_timeout_sec`, `enabled`, `required`, tool allow/deny) MUST flow through unchanged via `.passthrough()`.
- **FR-8:** `packages/happy-cli/src/codex/runCodex.ts` MUST call the loader once with a captured `cwdAtStart = process.cwd()` and merge the result into the existing `mcpServers` const with the `happy` bridge spread LAST (so bridge wins on duplicate-name conflict).
- **FR-9:** The same `cwdAtStart` MUST be passed as the `cwd:` arg of both `resumeExistingThread(...)` and `client.startThread(...)` to avoid divergence if any code calls `process.chdir()` between the load and thread-start.
- **FR-10:** Mocked sibling acceptance tests MUST cover (a) valid HTTP `.mcp.json` to `startThread`, (b) absent `.mcp.json` to `startThread`, (c) broken-JSON `.mcp.json` (`logger.warn` + only-`happy` to `startThread`), and (d) resume path to `client.resumeThread` without mocking `./resumeExistingThread`.
- **FR-11:** Roadmap (`plans/codexu-roadmap.md`), parallel-assignments (`plans/parallel-assignments.md`), overview HTML (`plans/overview.html` with all six SKILL.md procedure-B edits), parity audit (`plans/codex-agent-parity-audit.md` L63–82 and L341), and happy-cli CLAUDE.md (`packages/happy-cli/CLAUDE.md:236–258`) MUST all be updated in the same commit as the code+tests.
- **FR-12:** End-state MUST be a single commit at HEAD. Implementation MAY create the commit in two operations (initial commit + one `git commit --amend --no-edit`) to fold the resolved SHA into `plans/overview.html`'s SHA-bearing fields (`runs[].commits`, `generatedFromCommit`, `cmd-desc` suffix, kanban sub-text).

## Non-Goals (Out of Scope)

- **Primary codex integration test coverage** in `packages/happy-cli/src/codex/codex.integration.test.ts`. Per `packages/happy-cli/AGENTS.md:1–25`, mocked tests do not count as primary acceptance for the codex agent. The feature request explicitly mandates mocked sibling tests as the deliverable for this change — followed as written. A future task should add real-agent integration coverage of `.mcp.json` discovery to `codex.integration.test.ts`; this commit does NOT block on it.
- **Upstream codex submodule changes.** The Codex Rust app-server is intentionally left untouched.
- **Generalization to other agents** (gemini, openclaw). The loader is structured for reuse but is wired only into the codex runner in this commit.
- **Watching `.mcp.json` for post-thread-start changes.** Matches Claude Code's snapshot-at-start behavior.
- **A `strictMcpConfig`-style toggle** (Claude SDK option) — not in spec.
- **Reconnect-path plumbing.** Covered automatically by `rememberThreadDefaults` (`codexAppServerClient.ts:1172`).

## Technical Considerations

- **File paths (must be edited):** `packages/happy-cli/src/codex/runCodex.ts`, `packages/happy-cli/CLAUDE.md`, `plans/codexu-roadmap.md`, `plans/parallel-assignments.md`, `plans/overview.html`, `plans/codex-agent-parity-audit.md`.
- **File paths (must be created):** `packages/happy-cli/src/codex/projectMcpConfig.ts`, `packages/happy-cli/src/codex/projectMcpConfig.test.ts`, `packages/happy-cli/src/codex/runCodex.projectMcp.test.ts`.
- **Reference files (do not edit, but read for patterns):**
  - `packages/happy-cli/src/codex/codexAppServerDiscovery.ts` (sibling discovery module convention).
  - `packages/happy-cli/src/codex/resumeExistingThread.ts` (the forwarder this work must NOT mock in test (d)).
  - `packages/happy-cli/src/codex/codexAppServerClient.ts:1098–1188` (transport contract; L1172 fallback for reconnect).
  - `packages/happy-cli/src/codex/runCodex.fork.test.ts`, `runCodexPublishMode.test.ts`, `runCodex.attachmentsIgnore.test.ts` (test harness patterns; note `runCodex.fork.test.ts` sets `hasActiveThread = true` and mocks `./resumeExistingThread` — the NEW tests do the opposite).
  - `packages/happy-cli/src/api/types.ts` (Zod reference schemas).
  - `packages/happy-cli/src/ui/logger.ts:143–146` (`logger.warn` signature).
  - `.agents/skills/roadmap-and-overview/SKILL.md:81-164` (overview.html procedure B).
  - `packages/happy-cli/AGENTS.md:1–25` (acceptance policy tension).
  - `D:/harness-efforts/codexu/.mcp.json` (repo's actual fixture shape to mirror in tests).
- **Zod version:** `packages/happy-cli/package.json:104` pins `zod 3.25.76`. Use `z.union` + `.superRefine` + `.passthrough()` from that version.
- **Codex Rust contract for `RawMcpServerConfig`:** `codex/external/repos/codex-patched/codex-rs/config/src/mcp_types.rs:190,274-325,312` — accepts `command` XOR `url`, rejects cross-transport fields. The codex plugin loader at `codex/.../core-plugins/src/loader.rs:1042` strips `type` before deserializing.
- **CWD snapshot semantics:** Capture once, reuse for both load and thread-start. Avoids split risk if `process.chdir()` is called between.
- **Test isolation:** Use `mkdtempSync` for fixtures; the runCodex.projectMcp.test.ts MUST `process.chdir` into the tmpdir (since runCodex.ts reads `process.cwd()` internally) and restore in `afterEach`. The unit tests in projectMcpConfig.test.ts pass `cwd` explicitly and do NOT chdir.

## Plan-Review Context (Round 2 — applied)

The plan was reviewed in two rounds (11 findings + 11 findings, all applied). Key round-2 fixes that this PRD propagates:

- **F-R2-001 (High):** Schema is `z.union([Stdio, Http])` with `.passthrough()` on each branch AND `.superRefine` for command-XOR-url enforcement. Helper unit test covers `{ command, url }` ambiguity.
- **F-R2-002 (Medium):** `plans/overview.html` gets all six SKILL.md procedure-B edits, not just a "row flip".
- **F-R2-003 (Medium):** `plans/codex-agent-parity-audit.md` L63–82 AND L341 are explicitly in scope.
- **F-R2-004 (Medium):** Single-commit-+-SHA-in-metadata workflow allows one `git commit --amend` after the initial commit; end-state still one commit at HEAD; documented in Acceptance Criterion 9.
- **F-R2-005 (Medium):** Helper unit tests cover ambiguous-entry rejection and passthrough of Codex-supported extras.
- **F-R2-006 (Low):** Test (d) does NOT mock `./resumeExistingThread` — uses the real forwarder and asserts on `client.resumeThread` mock.
- **F-R2-007 (Low):** Acceptance Criterion 3 fixture is concrete: file body `{ not valid json`.
- **F-R2-009 (Info):** Roadmap convention verified as `- ✅ ` prefix.
- **F-R2-010 (Info):** `packages/happy-cli/CLAUDE.md` has no "Delivered" subsection; delete the open-gap bullet at L236–258 entirely (or replace with one-line cross-reference).
- **F-R2-011 (Info):** `codexAppServerClient.ts:1172` reconnect via `rememberThreadDefaults` requires no additional plumbing.

## Success Metrics

- 0 silently-dropped project MCP servers when codex agent runs in a cwd with a valid `.mcp.json` (verified by test (a) and test (d)).
- 0 codex-session aborts caused by a malformed `.mcp.json` (verified by test (c) and the helper unit tests for malformed JSON, invalid root, mixed valid+invalid).
- 1 atomic commit at HEAD post-implementation, with `plans/overview.html` `generatedFromCommit` matching `git rev-parse --short HEAD`.
- 0 existing test regressions (vitest run is green across `packages/happy-cli`).

## Open Questions

- **`plans/parallel-assignments.md` exact convention.** Inspector should match adjacent delivered rows/tabs in the file at edit time. [INFERRED — likely a status column flip or ✅ prefix mirroring the roadmap.]
- **`plans/codex-agent-parity-audit.md` exact "delivered" marker at L63–82.** Match adjacent shipped entries' convention. [INFERRED — likely a status header change from `Severity: High` to `Status: Shipped 2026-05-13` or similar.]
- **Real-agent integration coverage for `.mcp.json` discovery.** Acknowledged follow-up; out of scope for this commit.
- **Future: generalize the loader to other agents (gemini, openclaw)?** Out of scope for this commit; track as a follow-up.

## Autonomous-mode decisions

This PRD was generated in autonomous mode by the Phase 2 PRD subagent. The following defaults were applied without operator prompting:

- **Branch / worktree:** YES, created. Branch `feat/codex-mcp-discovery` forked from `main` (the current branch). Worktree at `D:/harness-efforts/codexu/.worktrees/codex-mcp-discovery`. Created via `git worktree add` before this PRD was finalized.
- **Story review:** auto-approved as decomposed from the plan + stories-outline (3 stories: US-001 loader, US-002 wire-in + acceptance tests, US-003 doc flips).
- **`securityFixLoop`:** `false` — this feature is a Zod-validated file reader, not a credential/auth/crypto code path. Security review will still run via the adaptive `security_relevant` flag if Phase 5 review-metadata flags it.
- **`codexReview` / `copilotReview`:** kept at default `"always"` for 3-way review (Claude + Codex + Copilot).
- **`iterationEngine`:** `"codex"`.
