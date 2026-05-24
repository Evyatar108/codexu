# Stories Outline: Codex Agent Per-cwd `.mcp.json` Discovery

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> All three stories below land in **one atomic commit** per the plan's Acceptance Criterion 9 — they are conceptual ordering for the implementer, NOT separate commits.

## US-001: Project `.mcp.json` loader module
**Description:** As a codex-agent maintainer, I want a Zod-validated `loadProjectMcpServers(cwd)` helper so the codex runner can safely consume per-cwd `.mcp.json` files (both stdio and HTTP shapes) with structured warnings on malformed input and a reserved `happy` bridge name.
**Acceptance Criteria:**
- [ ] New file `packages/happy-cli/src/codex/projectMcpConfig.ts` exports `loadProjectMcpServers(cwd: string)`.
- [ ] Zod schema is a `z.union([StdioEntry, HttpEntry])` with `.passthrough()` on each branch AND a `.superRefine((entry, ctx) => ...)` that rejects entries containing BOTH `command` and `url` (XOR enforcement).
- [ ] Absent `.mcp.json` returns `{}` silently (no log).
- [ ] Malformed JSON or invalid root shape: `logger.warn` called with `{ path, reason|issues }`; returns `{}`.
- [ ] Per-entry validation: each entry independently `safeParse`d; on failure, `logger.warn` + skip; valid entries accumulated.
- [ ] Entry named `happy` is skipped with a reserved-name warning.
- [ ] `type` field stripped from valid entries before return (matches codex plugin loader behavior).
- [ ] Extra Codex-supported fields (`http_headers`, `bearer_token_env_var`, `env_vars`, `cwd`, etc.) flow through via `.passthrough()`.
- [ ] Sibling `packages/happy-cli/src/codex/projectMcpConfig.test.ts` covers: HTTP entry (asserts `type` stripped, `url` preserved), stdio entry, absent file, malformed JSON, invalid root, mixed valid+invalid (only valid kept, one warning per invalid), **ambiguous `{ command, url }` entry (logged + skipped per superRefine)**, reserved-`happy`, passthrough of extras.
- [ ] Typecheck passes (`pnpm --filter '{packages/happy-cli}' run typecheck`).
- [ ] Helper unit tests pass under `vitest run`.

**Dependencies:** None
**Estimated complexity:** small

## US-002: Wire loader into `runCodex.ts` + acceptance tests
**Description:** As a codex-agent user, I want my project's `.mcp.json` to light up automatically on both `client.startThread` (first turn) and `client.resumeThread` (resume) — matching Claude Code's project-MCP convention.
**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/codex/runCodex.ts` captures `const cwdAtStart = process.cwd()` once at the existing `mcpServers` build site (~L700).
- [ ] `loadProjectMcpServers(cwdAtStart)` is called; result is merged into `mcpServers` with the `happy` bridge spread LAST (bridge wins on duplicate-name as defense-in-depth on top of loader's reserved-name guard).
- [ ] Both `resumeExistingThread({ ..., cwd: cwdAtStart, mcpServers })` (~L719–726) and `client.startThread({ ..., cwd: cwdAtStart, mcpServers })` (~L789–795) use the same captured `cwdAtStart` for their `cwd:` args.
- [ ] New sibling `packages/happy-cli/src/codex/runCodex.projectMcp.test.ts` contains 4 acceptance tests using HTTP fixtures matching the repo's actual `.mcp.json` shape (`{ paper: { type: 'http', url: '...' } }`):
  - (a) Valid HTTP `.mcp.json` → `client.startThread` mock called with `mcpServers` containing BOTH `happy` AND `paper`; `type` stripped, `url` preserved.
  - (b) Absent `.mcp.json` → `client.startThread` mock called with `mcpServers` containing ONLY `happy`.
  - (c) Broken-JSON `.mcp.json` (fixture: `{ not valid json`) → `logger.warn` called AND `client.startThread` mock called with `mcpServers` containing ONLY `happy`.
  - (d) `opts.resumeThreadId` set + valid `.mcp.json` → `client.resumeThread` mock called with `mcpServers` containing BOTH `happy` AND project entry. **`./resumeExistingThread` MUST NOT be mocked** (unlike `runCodex.fork.test.ts`); the real forwarder must run so the assertion exercises `resumeExistingThread.ts:20–33`.
- [ ] Test setup explicitly sets `MockCodexAppServerClient.hasActiveThread = vi.fn(() => false)` and enqueues at least one user batch (otherwise the start path is skipped).
- [ ] Test setup uses `mkdtempSync` + `process.chdir` into tmpdir + `afterEach` restoration of original cwd.
- [ ] All tests pass under `pnpm --filter '{packages/happy-cli}' exec vitest run`.
- [ ] No existing tests regress.
- [ ] Cross-package typecheck passes (`pnpm -r run typecheck`).

**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Roadmap, parity audit, and overview docs flipped + single commit (with `--amend` for SHA)
**Description:** As a codex-roadmap maintainer, I want the `mcp-discovery` work marked delivered across roadmap, parallel-assignments, overview (with full SKILL.md procedure-B metadata), parity audit doc, and the happy-cli CLAUDE.md open-gap entry, so future readers see a consistent state.
**Acceptance Criteria:**
- [ ] `plans/codexu-roadmap.md` (~L472–489) bullet "Codex agent project-.mcp.json parity" prefixed with `- ✅ ` and `(open, surfaced 2026-05-13)` → `(delivered 2026-05-13)`.
- [ ] `plans/parallel-assignments.md` `mcp-discovery` tab/row flipped to delivered (match adjacent delivered rows' convention).
- [ ] `plans/overview.html` gets ALL 6 SKILL.md procedure-B edits (per `.agents/skills/roadmap-and-overview/SKILL.md:81-164`):
  - [ ] `cmd-mcp-discovery` `<summary>` badge class: `b-inflight`/`b-ready` → `b-closed`; emoji/text `🟡 in progress` → `✅ shipped`.
  - [ ] `cmd-desc`: optionally append `· commit <code>SHA</code>` (applied via `--amend`).
  - [ ] Kanban card (if present): border-color `var(--warn)` → `var(--ok); opacity: 0.8`; sub-text `(in progress)` → `(shipped <SHA>)`.
  - [ ] Add `runs[]` entry: `{ id: "mcp-discovery/2026-05-13", taskId: "mcp-discovery", ranAt: "<ISO>", outcome: "completed", commits: ["<SHA>"], summary: "..." }`.
  - [ ] Bump `lastTouched["mcp-discovery"]` to commit ISO timestamp.
  - [ ] Bump `generatedAt` to commit ISO timestamp; bump `generatedFromCommit` to commit short SHA.
- [ ] `plans/codex-agent-parity-audit.md` (L63–82 entry, L341 recommendation) flipped to delivered (match audit doc convention).
- [ ] `packages/happy-cli/CLAUDE.md:236–258` open-gap bullet DELETED (or replaced with a one-line cross-reference; no `<sha>` placeholder). Verified no "Delivered" subsection exists.
- [ ] **One atomic commit at HEAD, allowed via initial commit + ONE `git commit --amend`** to fold in resolved SHA values for `overview.html` (`runs[].commits`, `generatedFromCommit`, `cmd-desc` suffix, kanban sub-text). Initial commit uses `"pending"` sentinels in those positions. End-state: single commit at HEAD with SHA-bearing fields populated.
- [ ] Commit message references the roadmap bullet, e.g. `feat(happy-cli/codex): per-cwd .mcp.json discovery — closes codexu-roadmap "Codex agent project-.mcp.json parity"`.
- [ ] Typecheck + vitest both green BEFORE the initial commit (so the `--amend` is metadata-only).

**Dependencies:** US-001, US-002
**Estimated complexity:** small-medium
