# Skill Suggestions

## Candidate: mcp-stdio-server-scaffold
- Description: Scaffold a new stdio MCP server package (TypeScript + Vitest + pnpm workspace) that satisfies the recurring contract: stdout reserved for JSON-RPC, stderr-only diagnostics, narrow Zod-to-SDK schema boundary, dynamic imports for optional helpers, and `.d.mts` siblings for `.mjs` JS helpers consumed from TS.
- Triggers: User asks to "add an MCP server", "scaffold a stdio MCP tool package", "expose <X> as MCP tools", or starts an MCP-server story; iteration agent is about to create the first MCP package under `tools/*` or similar.
- Target location: `plugins/ralph-orchestration/skills/mcp-stdio-server-scaffold/SKILL.md` (Ralph orchestration is the right host because the recurring evidence comes from Ralph-driven MCP builds; alternatively a new top-level plugin `mcp-server-toolkit`).
- Evidence:
  - 5 of the 10 feature commits carry an explicit `Constraint: stdout ... MCP ...` / `Constraint: stdout is reserved for MCP JSON-RPC traffic` trailer: commits `83d5a16d`, `eff06107`, `6d4d2179`, `5394f46d`, `2b2acc75` (from `git log 8de22837..HEAD`).
  - `progress.txt` Codebase Patterns lines 13-17 enumerate four MCP-specific constraints reused across stories: keep diagnostic output on stderr; narrow Zod/SDK boundary via `ZodRawShapeCompat`; keep package-local structural types under `src/types.ts`; set `rootDir: "src"` for NodeNext CLI packages emitting `dist/index.js`.
  - `CLAUDE.md` job-specific instructions repeat the same constraints (stderr-only diagnostics, dynamic import for Plan 08 helper, `runWorkOnViaCrew({ stdout: process.stderr })`).
  - Iteration learnings reaffirm the contract across US-001 (Iter 1) and US-002 (Iter 2) in `progress.txt` ("Keep MCP diagnostic output on stderr; stdout must remain protocol-only").
  - Post-hoc `fix:` commits `ab41c749` (zod v4 import) and `2deb3df5` (split monolithic test file) show recurring corrections downstream review keeps catching on first MCP build.
- Rationale: This is a multi-step, contract-heavy workflow that the iteration agent kept rediscovering and that downstream review then patched. None of the inventoried skills (assigned-roles, crews, ralph-orchestration, seval, teams, devui, options-mode) covers "scaffold an MCP stdio server with the standard guardrails". Encoding the contract as a skill would shorten future MCP-server stories and prevent the stdout-corruption / zod-version / rootDir / `.d.mts`-missing regressions that surfaced as fix commits here.

## Candidate: apply-plan-review-findings
- Description: Process a numbered plan-review findings file (`plan-review-findings.json` with `F-001..F-NNN`) by applying each finding inline as you implement the story it touches, then commit with the `docs: [F-NNN] ...` / `fix: [F-NNN] ...` trailer convention so reviewers can audit which findings were resolved by which commit.
- Triggers: User says "apply plan review findings", "work through the F- list", or "fix the open review findings"; a Ralph job has `plan-review-findings.json` plus an "Open review findings" section in `plan.md` with Medium-severity items deferred to inline application.
- Target location: `plugins/ralph-orchestration/skills/apply-plan-review-findings/SKILL.md` (matches the existing `review-plan-with-ralph` skill on the producer side; this would be the consumer-side skill).
- Evidence:
  - 13 commits since `8de22837` use the `[F-NNN]` numbering convention: `46e6b968` (F-004), `f63dd8cd` (F-003), `2d88dcd2` (F-002), `be5a034c` (F-001) for docs; `2deb3df5` (F-002), `099cf2e2` (F-005), `ab41c749` (F-007), `747d3771` (F-003), `98c736db` (F-006), `b1ec6bde` (F-010), `5f0d7863` (F-004), `136a7deb` (F-001), `681842c1` (F-008) for fixes (from `git log` body inspection).
  - Two commits resolve duplicate findings explicitly: `099cf2e2` notes "Also resolves duplicate F-011" and `136a7deb` notes "Resolves duplicate F-009 (same root cause, Copilot variant)" — a recurring sub-procedure (collapsing cross-model duplicate findings) that a skill can codify.
  - `notepad.md` Autonomous Decisions records the converter rule (F-001..F-006 High → included in PRD, F-007..F-014 Medium → applied inline) and `notepad.md` Open Notes for Implementer says "F-007..F-014 ... apply inline as each relevant story is reached".
- Rationale: This is a documented, repeatable workflow (numbered findings file + per-commit trailer + duplicate-collapse handling) that produced 13 commits in this single job. The existing `review-plan-with-ralph` skill produces the findings but no skill describes how to systematically consume them, leading to ad-hoc handling each time. The commit-trailer convention is the auditable artifact a skill should preserve.

## Candidate: mjs-typescript-bridge-helpers
- Description: When TypeScript code (e.g., a new package under `tools/*`) needs to import functions from existing `.mjs` helpers under `scripts/lib/`, create a sibling `.d.mts` declaration file that mirrors every exported symbol the TS code consumes, so package typecheck stays green without converting the `.mjs` source.
- Triggers: A TS package fails to typecheck against an `.mjs` import; user asks to "add types for the JS helper", "expose <fn> to TypeScript", or "create the `.d.mts` sibling"; iteration agent is about to import a `scripts/lib/*.mjs` symbol from new TS code.
- Target location: `.claude/skills/mjs-typescript-bridge-helpers/SKILL.md` (repo-level — this is a codexu-specific layout convention rather than a general Ralph workflow).
- Evidence:
  - US-001 progress entry adds `scripts/lib/work-on-via-crew.d.mts` so later TS MCP tools can type the Plan 08 crew helper (`progress.txt` ~line 23).
  - US-004 progress entry adds `scripts/lib/append-journal.d.mts` for `appendJournalNote()` and `assertSafeTaskId()` (`progress.txt` ~line 80).
  - Codebase Patterns line 17 of `progress.txt` distills the rule: "Shared `.mjs` helpers imported by `tools/overview-mcp` need sibling `.d.mts` declarations for every new export used by TypeScript code".
  - US-004 iteration learning repeats the rule: "Shared `.mjs` helpers imported by `tools/overview-mcp` need matching `.d.mts` declarations for new exports, or package typecheck loses the contract" (`progress.txt` near line 85).
- Rationale: The pattern recurred at least twice within the same 10-story job and was promoted into Codebase Patterns — a strong signal that the next agent touching another `tools/*` package will hit the same need. It is narrow enough to belong at the repo level rather than the plugin level, and it does not duplicate any existing skill (no inventory entry covers `.mjs` → `.d.mts` bridging).
