# Research Brief: Codex Agent per-cwd .mcp.json Discovery

## Researcher Findings

### Claude/happy reference (parity target)
- `.mcp.json` reading is delegated to the Claude SDK (`@anthropic-ai/claude-code`); happy-cli only forwards `mcpServers`.
- Forwarding point: `packages/happy-cli/src/claude/sdk/query.ts:75` (`mcpServers: opts?.mcpServers`).
- Type at the forwarder: `packages/happy-cli/src/claude/sdk/types.ts:54` — `mcpServers?: Record<string, unknown>`.
- Schema (per feature request, Claude shape): `{ mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string,string>; type?: 'stdio' | 'http'; url?: string }> }`.

### Codex agent path (needs fix)
- File: `packages/happy-cli/src/codex/runCodex.ts`
- Lines 700–705: `mcpServers` object built with ONLY the `happy` bridge:
  ```ts
  const mcpServers = {
      happy: { command: process.execPath, args: ['--no-warnings','--no-deprecation', bridgeEntrypoint, '--url', happyServer.url] }
  } as const;
  ```
- Lines 719–726: passed to `resumeExistingThread({ ..., mcpServers })`.
- Lines 789–795: passed to `client.startThread({ ..., mcpServers })`.
- `process.cwd()` available at both call sites (already used as `cwd:`).
- `resumeExistingThread.ts:20–49` already forwards `mcpServers` to `client.resumeThread` — no change required there.
- `codexAppServerClient.ts:1098–1188` — `buildThreadConfig()` maps `mcpServers` → `{ mcp_servers: ... }` and `rememberThreadDefaults()` persists it for reconnect. **Single-point merge at happy-cli layer is sufficient.**

### Logger
- Module: `packages/happy-cli/src/ui/logger.ts`
- Methods: `logger.debug`, `logger.info`, `logger.warn`, `logger.debugLargeJson`.
- `logger.warn(message: string, ...args: unknown[])` — console + file. Existing pattern: `logger.warn('Error in codex session:', error)` (`runCodex.ts:821`).
- Acceptable structured form: `logger.warn('[codex] .mcp.json server invalid', { path, serverName, issues })`.

### Zod
- Already a direct dep: `packages/happy-cli/package.json:104` — `"zod": "3.25.76"`.
- Reference patterns in `packages/happy-cli/src/api/types.ts` (record + enum + optional fields).
- Reference codex-side discovery pattern: `packages/happy-cli/src/codex/codexAppServerDiscovery.ts` (sibling discovery module with Zod).

### Test infrastructure
- `packages/happy-cli/src/codex/runCodex.test.ts` does **NOT** exist. The repo uses a multi-file sibling pattern:
  - `runCodex.fork.test.ts`
  - `runCodexPublishMode.test.ts`
  - `runCodex.attachmentsIgnore.test.ts`
  - `resumeExistingThread.test.ts`
  - `codex.integration.test.ts` (primary acceptance per `packages/happy-cli/agents.md` — but feature request explicitly asks for mocked support tests)
- Test runner: vitest 3.2.4. Mocking via `vi.hoisted()` + `vi.fn()` + `vi.mock()`. `MockCodexAppServerClient` with `startThread = vi.fn(...)` is the established assertion vehicle.
- Test command (from request): `pnpm --filter '{packages/happy-cli}' exec vitest run`. The `tee /tmp/...` portion is Git-Bash-shaped; on Windows the safer form is `pnpm --filter happy-cli exec vitest run <paths>` — but the request's command works in the harness Bash shell.

### CLAUDE.md context
- `packages/happy-cli/CLAUDE.md:236–258` — the open-gap entry that this work closes. Mirrors the roadmap bullet.
- `packages/happy-cli/src/daemon/CLAUDE.md:282–310` — Codex transport security model (loopback-only ws, per-spawn auth tokens). Confirms the app-server is a separate process and the merged `mcpServers` is the contract that crosses the boundary.

### Roadmap bullet to mark delivered
- File: `plans/codexu-roadmap.md:472–489`. Exact bullet text begins with `- **Codex agent project-\`.mcp.json\` parity (open, surfaced 2026-05-13):**`. Convention for marking delivered will need verification against adjacent delivered bullets (often a status flip like "delivered" inline, sometimes strikethrough — check siblings before commit).
- Also tracked in:
  - `plans/parallel-assignments.md` — `mcp-discovery` tab (per `.agents/skills/roadmap-and-overview/SKILL.md`, these stay in sync).
  - `plans/overview.html` — `mcp-discovery` cmd row (must be flipped to delivered status to match).

### Build / typecheck
- Per-package: `pnpm --filter '{packages/happy-cli}' run typecheck` (alias for `tsc --noEmit`, see `packages/happy-cli/package.json:61`).
- Cross-package: `pnpm -r run typecheck` (no Turbo; pnpm workspaces).
- Build full: `pnpm --filter happy-cli run build` (`shx rm -rf dist && tsc --noEmit && pkgroll`).

---

## Architect Analysis

### Integration points
- Both `startThread` (~L789) and `resumeExistingThread` (~L719) consume the same `mcpServers` const built at L700–705. A single-point merge upstream of both consumers handles both paths.
- `resumeExistingThread.ts` already forwards `mcpServers` unchanged → no change needed there.

### Helper placement
- Recommended new module: `packages/happy-cli/src/codex/projectMcpConfig.ts` (sibling discovery pattern, mirrors `codexAppServerDiscovery.ts`).
- Rationale: discovery logic is independently testable, lets `runCodex.ts` (~903 LoC) stay focused on orchestration, naturally reusable if other agents (gemini, openclaw) later need it.

### Schema identity & Codex constraint
- At the value level, Claude `.mcp.json` server entries are structurally compatible with the codex app-server `mcp_servers` payload.
- **Important Codex constraint surfaced by Codex review:** the Codex Rust `McpServerConfig` does **not** accept a literal `type` field. The Codex plugin loader strips Claude-style `type` before deserializing. → Validate `type?: 'stdio' | 'http'` for input correctness, but **omit `type`** from the object handed to `client.startThread/resumeThread`. Otherwise the codex app-server may reject the config silently or noisily.

### Merge / reserved-name policy (CONSENSUS: keep `happy` reserved)
- Architect proposed: project keys override `happy` bridge.
- Codex + Copilot pushback: `happy` bridge is platform infrastructure; if project `.mcp.json` defines a server named `happy`, the safe default is to **keep the Happy bridge authoritative**, log a warning, and skip the project entry named `happy`.
- 2-of-3 consensus → adopt "happy is reserved" semantics.

### Cwd policy
- Read `<process.cwd()>/.mcp.json` once at thread setup, snapshot — matches Claude Code's session-start behavior.
- Process-boundary isolation (codex app-server is a separate spawn) means later `chdir` in the CLI cannot retroactively shift discovery for an already-started thread.

### Per-entry validation (Copilot caveat)
- A single `z.record(McpServerSchema).safeParse(parsed.mcpServers)` would reject **all** entries on one bad entry.
- Spec requires per-entry skip → validate each entry independently and accumulate the valid ones. Log a structured warning per failing entry with `{ path, serverName, issues }`.

### Test isolation
- Use `mkdtempSync(join(tmpdir(), 'happy-mcp-'))` + `writeFileSync` for fixtures. Never read real cwd. Use vitest hoisted mocks to mock `readProjectMcpServers` from `runCodex.ts` integration tests.

### Risks
- Schema drift (codex `McpServerConfig` evolves upstream) — `.passthrough()` mitigates; explicit `type` stripping ahead of app-server is required regardless.
- Test isolation against real `.mcp.json` — tmpdir fixtures + mocked helper at the runCodex level.
- Reserved-name override — addressed by "happy is reserved" policy with a warning.
- Security: identical trust model to Claude Code (project cwd is dev-controlled); accept.

### Files to touch (single commit scope)
1. **NEW** `packages/happy-cli/src/codex/projectMcpConfig.ts` (helper + Zod)
2. **EDIT** `packages/happy-cli/src/codex/runCodex.ts` (call helper, merge, reserved-name guard, strip `type`)
3. **NEW** `packages/happy-cli/src/codex/projectMcpConfig.test.ts` (unit tests for helper, the 3 required acceptance tests live here)
4. **EDIT** `plans/codexu-roadmap.md` (mark bullet delivered)
5. **EDIT** `plans/parallel-assignments.md` (mcp-discovery tab status)
6. **EDIT** `plans/overview.html` (mcp-discovery row status)
7. **EDIT** `packages/happy-cli/CLAUDE.md` (move bullet from "open gaps" → close it, or annotate as delivered 2026-05-13)

---

## Codex Research

Codex confirmed the same call sites and helper placement. Three crucial additions over the original spec:

1. **Strip `type` before passing to codex app-server.** The Codex Rust `McpServerConfig` does not accept a literal `type` field. Validate Claude-shape input including `type`, but emit a normalized object without `type` to the transport. (Codex plugin loader already does this strip; Happy must do the same.)
2. **Reserved-name policy for `happy` bridge.** If project `.mcp.json` defines a server named `happy`, do not let it override the platform bridge — log a warning, skip that single entry. Codex's wording: "keep Happy's bridge authoritative".
3. **Overview/assignments docs must stay in sync.** Per `.agents/skills/roadmap-and-overview/SKILL.md`, status flips touch all three: `plans/codexu-roadmap.md`, `plans/parallel-assignments.md`, `plans/overview.html`.

Suggested call shape in `runCodex.ts` (Codex variant):
```ts
const projectMcpServers = await loadProjectMcpServers(process.cwd());
const mcpServers: Record<string, unknown> = {
  ...projectMcpServers,  // happy entry stripped by loader before merge
  happy: happyBridge,    // platform bridge always wins
};
```

Codex also suggests an extra (4th) test exercising the resume path or one additional test for the "valid + invalid entry → valid kept" case.

---

## Copilot Research

Copilot's findings track closely with Codex and Architect. Key emphases:

1. **Per-entry validation is required by spec.** A whole-object `safeParse` cannot satisfy "skip the invalid entry — never abort the session". Iterate over entries.
2. **The fork.test.ts mock pattern is the right vehicle** for the 3 acceptance tests — they already mock `CodexAppServerClient`, `startHappyServer`, `projectPath`, logger, message queue. Reuse it.
3. **No `runCodex.test.ts`** exists; the convention is `runCodex.<feature>.test.ts`. A new sibling `runCodex.projectMcp.test.ts` (or `projectMcpConfig.test.ts` if helper-scoped) fits.
4. **Reserved-name policy:** also agrees `happy` should stay reserved.
5. **codexAppServerClient.ts preserves `mcpServers` across reconnects** via `rememberThreadDefaults()` — no separate reconnect plumbing.
6. **Primary Codex acceptance** lives in `codex.integration.test.ts` per `packages/happy-cli/agents.md`, but the feature request explicitly asks for support-level mocked tests. Document this in plan: the 3 mocked tests are sufficient for the acceptance bar in this request.
7. **Test command Windows-portability:** the `tee /tmp/...` portion is bash-shaped; runs under the Bash tool in this environment fine.

---

## Consolidated File List

### Files to MODIFY
| Path | Purpose |
|------|---------|
| `packages/happy-cli/src/codex/runCodex.ts` | Insert helper call, merge results, reserved-name guard, strip `type` before transport |
| `plans/codexu-roadmap.md` | Mark "Codex agent project-.mcp.json parity" bullet delivered |
| `plans/parallel-assignments.md` | Flip `mcp-discovery` tab status |
| `plans/overview.html` | Flip `mcp-discovery` row status |
| `packages/happy-cli/CLAUDE.md` | Move/annotate the open-gap entry as resolved |

### Files to CREATE
| Path | Purpose |
|------|---------|
| `packages/happy-cli/src/codex/projectMcpConfig.ts` | New module: Zod schema + `loadProjectMcpServers(cwd)` helper |
| `packages/happy-cli/src/codex/projectMcpConfig.test.ts` (OR `runCodex.projectMcp.test.ts`) | The 3 acceptance tests; helper unit tests |

### Files used as REFERENCE (no edit)
| Path | Why |
|------|-----|
| `packages/happy-cli/src/codex/codexAppServerDiscovery.ts` | Sibling discovery module pattern |
| `packages/happy-cli/src/codex/resumeExistingThread.ts` | Already forwards mcpServers — no edit needed |
| `packages/happy-cli/src/codex/codexAppServerClient.ts` | Confirms transport contract + reconnect persistence |
| `packages/happy-cli/src/codex/runCodex.fork.test.ts` | Mock pattern reference |
| `packages/happy-cli/src/codex/runCodexPublishMode.test.ts` | Sibling test naming convention |
| `packages/happy-cli/src/codex/runCodex.attachmentsIgnore.test.ts` | Sibling test naming convention |
| `packages/happy-cli/src/ui/logger.ts` | Logger API surface |
| `packages/happy-cli/src/api/types.ts` | Zod schema reference patterns |
| `packages/happy-cli/CLAUDE.md` | Original gap entry (lines 236–258) |
| `packages/happy-cli/src/daemon/CLAUDE.md` | Transport / lifecycle context (lines 282–310) |
| `.agents/skills/roadmap-and-overview/SKILL.md` | Doc-sync procedure |
| `packages/happy-cli/agents.md` | Codex acceptance policy |
