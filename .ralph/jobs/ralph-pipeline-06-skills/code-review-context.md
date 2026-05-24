# Code Review Context — Plan 06

Patterns and conventions discovered during code review of `ralph-pipeline-06-skills`.

## Repo conventions reinforced by this change

- `scripts/lib/*.mjs` modules ship with sibling `*.d.mts` TypeScript declaration files so overview-viewer (`moduleResolution: "bundler"`) can `import` them with types. The new `derive-next-command.d.mts` follows the same shape as `derive-ralph-stage.d.mts`.
- Tests live flat under `scripts/lib/<name>.test.mjs`; `vitest.config.ts` picks them up automatically. No `__tests__/` subdirectory.
- Path strings in Ralph artifacts are POSIX-style even on Windows. The predicate's `cleanPath()` normalises `\` to `/` and the rest of the module concatenates with `/` rather than calling `path.join` — required to keep the module browser-safe.
- The `RalphPipelineState` shape is the output of `derive-ralph-stage.mjs`. Consumers (this predicate, future UI, MCP) MUST switch on `state.stage` and MUST NOT read raw `orchestrator.*` fields.

## Cross-cutting concerns observed

- **`NextCommand.icon` shared contract.** Plan 06 lands the predicate and the type; Plan 07 (running in parallel) extends `RalphPipelineState`. The two extensions are disjoint in `types.ts`, but UI work and Plan 09's MCP will both consume `icon` if it's present. Skipping `icon` now means downstream consumers will have to either re-derive icons from `stage` (defeating the single source of truth) or accept icon-less buttons.
- **Skill `--dry-run` is a documentation contract.** Skills are markdown read by Claude at runtime; ordering in the body matters because Claude reads top-to-bottom. The "Derive Command" → "Null Handling" → "Invoke" order in `/work-on` currently short-circuits in the wrong place when `--dry-run` meets a `null` helper result.
- **Cascade deferral is implicit in the diff.** Plan 06's US-006 cascade refresh is deferred via `notepad.md`'s `## Deferred Cascade` section (Plan 07 RUNNING). External reviewers (Codex/Copilot) flagged the missing plan-doc edits as High because they cannot see `notepad.md` outside the worktree — it lives at the job dir. Future reviewers should be told to check `<job_dir>/notepad.md` for deferred-cascade entries before flagging missing cross-plan edits.

## Files of note

- `scripts/lib/derive-next-command.mjs` — pure-ESM predicate.
- `scripts/lib/derive-next-command-cli.mjs` — Node CLI wrapper (uses `node:child_process`, `node:fs`, `node:path`, `node:process` — these are fine because the CLI is Node-only).
- `scripts/lib/derive-next-command.d.mts` — TS declarations consumed by overview-viewer.
- `scripts/lib/fixtures/derive-next-command-snapshot.json` — CLI test fixture.
- `tools/overview-viewer/src/types.ts:166-170` — `NextCommand` interface; placed near `Recommendation` per plan layout.
- `.claude/skills/{work-on,triage,blocker-report}/SKILL.md` — repo-local skills (markdown only, no executable code).

## Verification

- `pnpm test scripts/lib/derive-next-command.test.mjs scripts/lib/derive-next-command-cli.test.mjs` → 19/19 pass.
- `pnpm --filter @codexu/overview-viewer typecheck` → green.
- The `NextCommand` interface is correctly placed near `Recommendation` (line 166) and the disjoint cluster from Plan 07's `RalphPipelineState` extension is preserved.
