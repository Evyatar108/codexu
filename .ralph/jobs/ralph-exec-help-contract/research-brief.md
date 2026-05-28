# Research Brief: ralph-exec-help-contract

## Researcher Findings

**Target repo:** `D:/ai-developer-toolkit/` (branch `main`), NOT the codexu repo where this plan runs.

### Current parse structure

**`plugins/ralph/src/codex-exec.mjs`** (`parseArgs()` lines 87–154):
- Switch on each flag (`--prompt`, `--output`, `--effort`, `--text`, `--include-rubric`, `--section`).
- Line ~148: default case throws `UsageError(`${usage()}Error: unknown argument: ${arg}`)` → exit 1.
- Existing `usage()` function at lines 237–239 returns the canonical usage string.
- `main(argv, opts)` accepts `stderr`, `spawn`, `env` — does NOT currently accept `stdout`.

**`plugins/ralph/src/copilot-exec.mjs`** (`parseArgs()` lines 129–208):
- Switch on each flag (`--prompt`, `--output`, `--model`, `--effort`, `--text`, `--include-rubric`, `--section`).
- Line ~196: default case throws `UsageError(\`${USAGE}Error: unknown argument: ${arg}\n\`)` → exit 1.
- Existing `USAGE` constant at lines 52–53 (pre-defined static string).
- `main(argv, opts)` accepts `stderr`, `cwd`, `env`, `process`, `spawn` — does NOT currently accept `stdout`.

### v5.46.0 --help convention (established prior art)

Three in-tree precedents write usage to **stdout** and return `0`:
- `plugins/ralph/src/ralph.mjs` — `parseArgs()` sets `help: true`; post-parse check at lines 67–69 calls `usage()` and returns 0.
- `plugins/ralph/src/review-loop.mjs` — exports `usage(stdout)`; `parseArgs()` sets `showHelp: true` for `--help` OR `-h` (lines 88–92). Help check happens BEFORE `validateConfig()`.
- `plugins/ralph/src/scan-reviewer-bullets.mjs` — writes `USAGE` to stdout, returns 0.

Some `scripts/*.mjs` write to stderr for bash parity, but the acceptance criteria here say **non-empty stdout**.

### v5.45.x bash wrapper prior art

CHANGELOG v5.46.0 explicitly states v5.45.x bash wrappers **also returned exit 1** on `--help` (treated as unknown). The bash entry-shims were deleted in v5.46.0; no bash predecessor helper to copy.

→ **Convention to follow:** mirror `review-loop.mjs` (accept `--help` AND `-h`, write usage to stdout, return 0).

### Test infrastructure

- **Runner:** `node:test` (built-in, requires Node 20+).
- **Discovery:** `plugins/ralph/tests/run.mjs` auto-discovers `test-*.mjs` files.
- **Spawn pattern in existing tests:** unit tests call `runMain(argv, opts)` in-process with a mocked `spawn` and capture stderr — they do NOT subprocess the wrapper. See `test-codex-exec.mjs` lines 64–72 and 209–228; `test-copilot-exec.mjs` lines 109–114 using `sink()` and `failSpawn` helpers.
- **Plan should follow the in-process pattern** (no subprocess spawn needed; mock spawn to assert it's NOT called when `--help` short-circuits).

### CHANGELOG + version

CHANGELOG entry format (top of file): `## v<version>` header, prose-bulleted change list.

**Five release stamps** (per v5.46.0 CHANGELOG note "Bumps all five release stamps"):
1. `plugins/ralph/.claude-plugin/plugin.json` — `"version": "5.46.0"` → `"5.46.1"`
2. `plugins/ralph/.github/plugin/plugin.json` — same field
3. `.claude-plugin/marketplace.json` (repo root) — ralph plugin entry
4. `.github/plugin/marketplace.json` (repo root) — ralph plugin entry
5. `.agents/plugins/marketplace.json` (repo root) — ralph plugin entry

(CHANGELOG itself is separate — adds a `## v5.46.1` section at top.)

### Remotes

- `origin` → `https://github.com/Evyatar108/ai-developer-toolkit`
- `work` → `https://github.com/gim-home/ai-developer-toolkit`

"Multi-remote push" means push to both.

## Architect Analysis

### Callers of these scripts

Skills that invoke `codex-exec.mjs` / `copilot-exec.mjs`:
- `plugins/ralph/skills/brainstorm-with-ralph/SKILL.md`
- `plugins/ralph/skills/multi-model-investigate/SKILL.md`
- `plugins/ralph/skills/plan-with-ralph/SKILL.md`
- `plugins/ralph/skills/review-changes/SKILL.md`
- `plugins/ralph/skills/review-plan-with-ralph/SKILL.md`

Internal: `plugins/ralph/src/review-loop.mjs` (`runPlanningEngine()` / `resolvePlanningEngineScript()`, ~lines 821–851) spawns the planning engine via `node` (auto-detects `.mjs` vs `.sh` from extension; honors `CODEX_EXEC_SCRIPT` / `COPILOT_EXEC_SCRIPT` env overrides).

**No current caller passes `--help` as a probe**, so the existing exit-1 behavior breaks nothing internal — but the external audit at `f4d63067` is broken by it. No caller is at risk if we flip to exit 0 + stdout.

### Risk of changing argv parse order

Safe approach: insert `--help` / `-h` as the **first case** in the parseArgs switch (before any other arg).

- Match exact strings only (`"--help"`, `"-h"`); skills don't use variants like `--help=true`.
- Help check in `main()` must fire **BEFORE** `validateConfig()` so missing-required-args don't error out.
- Help check must fire **BEFORE side effects**: codex-exec must not read prompt or spawn; copilot-exec must not create temp file, truncate output, or spawn.
- No shared helper extraction needed (each script keeps its own usage string).

### Test wiring

- Use existing in-process `runMain()` / `sink()` helpers; no subprocess.
- Assertions per new test: `code === 0`, stdout includes `"Usage:"` and is non-empty, stderr empty, spawn NOT called, no FS side effects.
- Tests must add a `stdout` sink to opts (since `main()` doesn't currently take one — that signature widens as part of this change).

### Version bump mechanics

Two plugin.json files + three marketplace.json indexes = five release stamps. All must move together to 5.46.1. CHANGELOG header matches the manifest.

### CI surface

No GitHub Actions workflow found under `D:/ai-developer-toolkit/.github/workflows/` — Ralph tests run via direct `node plugins/ralph/tests/run.mjs`. Node 20+ required.

### Risk areas

- **stdout stream addition:** `main()` currently takes `stderr` but not `stdout`. The plan must widen the opts signature in both scripts AND update the test harness `runMain()` / `sink()` to provide a stdout sink. Avoid touching unrelated test logic.
- **`UsageError` must NOT be the vehicle:** `UsageError` is caught and written to stderr with exit 1. `--help` needs a direct stdout write + return 0 — bypass the error class entirely.
- **Negative-test fixtures are pinned**: existing tests pin exact stderr text for unknown args, missing args, bad `--effort`. Don't perturb them.
- **`-h` short flag:** Codex research recommends it for review-loop parity. The audit only required `--help`, but adding `-h` is a 2-line cost with parity benefit.
- **No top-level import side effects** in `path-utils.mjs` (the only shared import) — safe.

## Codex Research

Confirms researcher findings. Key additions:
- Implementation pattern: add `const stdout = opts.stdout ?? process.stdout;` in each `main()`.
- Skip validation when `help` is set.
- Verification command set: `node plugins/ralph/tests/run.mjs` + targeted `node --test test-codex-exec.mjs` + `test-copilot-exec.mjs` + direct CLI smoke (`node codex-exec.mjs --help`, same for copilot).
- Remotes confirmed: `origin` (Evyatar108) and `work` (gim-home).
- Multi-remote push should be a **separate confirmed release step**, not bundled into impl iterations.

## Copilot Research

Confirms researcher findings independently. Diverges only on test pattern recommendation: suggests `spawnSync(process.execPath, [wrapperPath, "--help"])` for the test (subprocess-based) instead of in-process. **Reject** — in-process matches existing test patterns and is faster/more reliable on Windows. Stick with `runMain()` / `sink()`.

## Consolidated File List

### Files to modify
- `D:/ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs` — add `--help`/`-h` parseArgs case; add stdout opt; help short-circuit in main() before validateConfig.
- `D:/ai-developer-toolkit/plugins/ralph/src/copilot-exec.mjs` — same.
- `D:/ai-developer-toolkit/plugins/ralph/tests/test-codex-exec.mjs` — add stdout sink in runMain helper; one `--help` test, one `-h` test (or one parameterized).
- `D:/ai-developer-toolkit/plugins/ralph/tests/test-copilot-exec.mjs` — same.
- `D:/ai-developer-toolkit/plugins/ralph/CHANGELOG.md` — prepend `## v5.46.1` section.
- `D:/ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json` — version 5.46.0 → 5.46.1.
- `D:/ai-developer-toolkit/plugins/ralph/.github/plugin/plugin.json` — version 5.46.0 → 5.46.1.
- `D:/ai-developer-toolkit/.claude-plugin/marketplace.json` — ralph plugin version 5.46.0 → 5.46.1.
- `D:/ai-developer-toolkit/.github/plugin/marketplace.json` — same.
- `D:/ai-developer-toolkit/.agents/plugins/marketplace.json` — same.

### Reference files (read-only)
- `D:/ai-developer-toolkit/plugins/ralph/src/review-loop.mjs` (lines 48–100, 160–163) — canonical --help pattern to mirror.
- `D:/ai-developer-toolkit/plugins/ralph/src/ralph.mjs` (lines 51–70) — second precedent.
- `D:/ai-developer-toolkit/plugins/ralph/src/scan-reviewer-bullets.mjs` — third precedent.

### Build / config
- `D:/ai-developer-toolkit/plugins/ralph/tests/run.mjs` — runner used by full-suite verification.
- No GitHub Actions workflow runs these tests in CI today.

### Remotes
- `origin` (Evyatar108) + `work` (gim-home). Multi-remote push is a manual release step, not bundled into impl iterations.
