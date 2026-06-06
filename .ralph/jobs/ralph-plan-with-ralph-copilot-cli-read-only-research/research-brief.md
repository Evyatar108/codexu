# Research Brief: Constrain Copilot CLI research-mode invocations to read-only

## Researcher Findings (codebase, v5.50.0)

### Primary file: `plugins/ralph/src/copilot-exec.mjs`
- `parseArgs()` at `:137-220` handles `--prompt`, `--output`, `--model`, `--effort`, `--text`,
  `--include-rubric`, `--section`. No `--read-only` yet. Clean place to add `--read-only`
  (boolean) and `--allow-write-path <dir>` (repeatable).
- `main()` sets `cwd` from `opts.cwd ?? process.cwd()` (`:62`); creates `tempDir` via
  `mkdtempSync(join(tmpdir(), "copilot-exec-"))` (`:95`); opens `outFd = openSync(parsed.outputFile, "w")` (`:101`).
- **childArgs built at `:102-111` — currently includes `--allow-all` + `--silent`** (the root cause).
- `assemblePrompt()` concatenates prompt + `--text`/`--section` chunks (`:242-255`).
- `runCopilot()` at `:257-292` spawns `shell: true`, stdout → `outFd`.
- `registerCleanupHandlers()` at `:294-316` cleans temp dir on `exit`/`SIGINT`/`SIGTERM`.
- **Guard slot:** wrap `runCopilot()` (called at `:113-121`). Snapshot BEFORE `openSync(outputFile)`
  and spawn; revert + surface in the `finally` block (`:125-133`); signal paths (`:294-316`) must
  ALSO revert so a killed research run leaves no edits.

### Sibling wrapper: `plugins/ralph/src/codex-exec.mjs`
- Comparable arg surface (`:95-167`); prompt via stdin, output via `-o`.
- Passes the codex equivalent of `--allow-all`: `--dangerously-bypass-approvals-and-sandbox` (`:63-73`).
- ALSO used by research/review flows → has the SAME write-leak risk, but is OUT OF SCOPE for this
  task (scope = copilot-exec). Recommend a follow-up task to mirror the mechanism to codex-exec.

### Callers of `copilot-exec.mjs`
**RESEARCH/REVIEW mode → opt into `--read-only`:**
- `skills/brainstorm-with-ralph/SKILL.md` (brainstorm lens) ~`:33-42, 58-65, 102-105`
- `skills/plan-with-ralph/SKILL.md` Phase 2 research + Phase 4 review ~`:132-160, 181-189, 215-221`
- `skills/review-changes/SKILL.md` Step 3B code review ~`:177-189`
- `skills/review-plan-with-ralph/SKILL.md` plan-review copilot path ~`:146-160`
- `agents/plan-reviewer.md` ~`:36-45` (+ mirror `.copilot-plugin/agents/plan-reviewer.agent.yaml`)
- `skills/multi-model-investigate/SKILL.md` (+ `.copilot-plugin` mirror) — research/investigation
- `src/review-loop.mjs` **re-review `copilot-opus` slot** ~`:637-705, 1025-1038` — review-mode
**WRITE mode → keep write (do NOT pass --read-only):**
- `src/ralph.mjs` per-iteration implementer (copilot engine) ~`:111-217`
- `src/review-loop.mjs` **plan-fix path** (`planningEngine=copilot`, `runPlanningEngine()`)
  ~`:821-879` — legitimately amends the plan file (which lives under staging/job_dir).
- `skills/implement-with-ralph/SKILL.md` implementer notes.

### Tests
- Auto-discovery: `tests/run.mjs:8-17` discovers `test-*.mjs`.
- Main wrapper test: `tests/test-copilot-exec.mjs` (node:test) — argv/body capture `:169-218`,
  output-preservation-on-nonzero-exit `:378-415`, stub plumbing `:326-346`.
- Stub mock CLI pattern: `tests/fixtures/regression-smoke-phase-3/stub-copilot.sh` +
  `COPILOT_EXEC_SCRIPT` env override; `spawn-extensionless-stub-patch.mjs` Node trampoline.
- New test should be **node:test** mirroring `test-copilot-exec.mjs`.

### Version stamps (5, currently 5.50.0)
- `plugins/ralph/.claude-plugin/plugin.json`
- `plugins/ralph/.github/plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.github/plugin/marketplace.json`
- `.agents/plugins/marketplace.json`

### CHANGELOG + parity gate
- `plugins/ralph/CHANGELOG.md` — newest-first `## vX.Y.Z` sections, short bullet lists.
- If any SKILL.md caller is edited, regenerate the Copilot mirror:
  `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --write`, then validate with
  `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check && node plugins/ralph/scripts/check-copilot-parity.mjs`.

## Architect Analysis (snapshot/revert design)

### Allowed-write-zone + flags
- New `--read-only` (boolean, default OFF — preserves implementer/plan-fix write path byte-for-byte).
- New `--allow-write-path <dir>` (repeatable). Default allowed zone = `dirname(outputFile)` so the
  wrapper's own `--output` write is never flagged. Research callers also pass the job_dir/staging.
- The wrapper's `--output` file is written by the wrapper's `outFd`, NOT a model tool → exclude
  from snapshot/revert regardless.

### Snapshot mechanism (WIP-preserving, cross-platform)
- **Git cwd (fast path):** `git status --porcelain=v1` to enumerate pre-existing dirty/untracked
  paths; capture content (blob/hash) of tracked files that could change. After the run, diff
  PRE vs POST; for any path changed/created during the window AND outside the allowed zone:
  restore tracked files to their PRE content, delete files that were newly created during the
  window. Restore ONLY window-changed files so pre-existing operator WIP survives untouched.
  (`git stash create` is insufficient — it misses untracked files.)
- **Non-git cwd (fallback):** filesystem manifest `{path, mtime, size, sha256}` excluding `.git`,
  `node_modules`, `.ralph`, gitignored heavies, and the allowed zone; diff + revert the same way.

### Surfacing
- Emit a single stderr sentinel line: `<copilot-readonly-violation>{json: reverted paths}</copilot-readonly-violation>`.
- Revert + emit warning + PRESERVE copilot's exit code / text output (research output isn't lost).
  Only return non-zero if the revert itself fails.

### Risks / edge cases (each must be addressed by a story/AC)
(a) pre-existing WIP must survive (restore vs PRE snapshot, never `git checkout HEAD`).
(b) legitimate writes to job_dir/staging allowed via `--allow-write-path`.
(c) `--output` file excluded from snapshot/revert.
(d) non-git cwd → filesystem-manifest fallback.
(e) Windows symlinks/junctions → canonicalize paths before zone checks.
(f) large repos → git-tracked fast path; avoid full-tree scans in git repos.
(g) concurrent research invocations sharing a cwd → snapshot/revert per-process, scoped to the
    exact window; no shared temp state.

## Empirical investigation (verified 2026-06-06, Copilot CLI v1.0.59 — CURRENT)
- `--allow-all` == `--allow-all-tools --allow-all-paths --allow-all-urls`.
- `--deny-tool=write` blocks the dedicated create/edit tool BUT the model falls back to the
  `shell` tool (PowerShell) to write files anyway → tool-denial alone is NOT airtight.
- Therefore the snapshot+revert guard (option c) is the load-bearing enforcement; the
  flag-tightening (option a) is defense-in-depth.

## Consolidated File List
**Modify (core):** `src/copilot-exec.mjs`
**Create (helper + test):** `src/worktree-snapshot.mjs` (or `readonly-guard.mjs`),
`tests/test-copilot-readonly-guard.mjs` (+ stub fixture under `tests/fixtures/`)
**Modify (callers):** `skills/brainstorm-with-ralph/SKILL.md`, `skills/plan-with-ralph/SKILL.md`,
`skills/review-changes/SKILL.md`, `skills/review-plan-with-ralph/SKILL.md`,
`skills/multi-model-investigate/SKILL.md`, `agents/plan-reviewer.md`, `src/review-loop.mjs`
(re-review copilot-opus path only), `agents/copilot-planner-prompt.md`,
`agents/copilot-reviewer-prompt.md`, `agents/copilot-brainstorm-prompt.md` (research-only note)
**Regenerate:** `.copilot-plugin/**` mirror via generator
**Docs/version:** `CHANGELOG.md`, `AGENTS.md`, plugin.json x2, 3 marketplace indexes
