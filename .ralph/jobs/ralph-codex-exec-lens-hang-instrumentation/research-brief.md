# Research Brief — codex-exec lens hang (D-001 capture-first)

## Researcher Findings (codebase context)

`ai-developer-toolkit/plugins/ralph` is a skills-only plugin with zero-dependency Node ESM
runtime wrappers under `src/`. Tests use `node:test`; `tests/run.mjs` auto-discovers
`tests/test-*.mjs`. The two engine wrappers are siblings:

- `src/codex-exec.mjs` — Codex CLI wrapper. `main()` builds args
  (`exec - --model gpt-5.5 -c model_reasoning_effort=<effort> --dangerously-bypass-approvals-and-sandbox -o <outputFile>`),
  writes the assembled prompt to the child's stdin then closes it, and spawns with
  **`stdio: ["pipe", "inherit", "inherit"]`** (codex-exec.mjs:80-84). It does **not** drain or
  capture the child's stdout/stderr — both are inherited to the parent. `waitForChild()`
  (203-227) blocks on `error`/`close` with **no timeout, no signal handlers, no tree-kill**.
  The header comment (line 8) explicitly says it "must not install signal handlers;
  orchestration owns interrupts here" and "Codex owns the output file directly through its
  own -o flag." **That contract is the root cause and must be revised by this plan.**
- `src/copilot-exec.mjs` — already solves capture + reaping. fd-backed stdout capture
  `openSync(outputFile,"w")` → `stdio: ["ignore", outFd, "inherit"]` (229-230, 447-448),
  closed in `finally` via `closeSync` (293-299). `killChildTree()` (107-128) uses
  `taskkill /T /F /PID` on Windows / `SIGKILL` on POSIX with `child.killed`/`pid` guards;
  `IS_WINDOWS` const at line 35. `registerCleanupHandlers()` (474-498) wires
  exit/SIGINT/SIGTERM with an `unregister()` contract; registered before spawn, unregistered
  in `finally`. **copilot-exec captures only stdout to the fd and still INHERITS stderr** —
  the codex port must capture BOTH (codex's diagnostic trace goes to stderr).
- `src/ralph.mjs` (per-iteration implementer) and `src/review-loop.mjs` (plan-fix +
  re-review) call the codex engine and honor `CODEX_EXEC_SCRIPT`.

## Architect Analysis (integration points, constraints)

**Caller contract (all callers are FILE-backed, none consume codex stdout as data):**
- `src/ralph.mjs:917-985` — passes `--output <jobDir>/.codex_iter_<N>.tmp`, tails it live
  (`streamLiveFile`), then `readFileSync(iterOut)`. `resolveEngineScript()` honors `CODEX_EXEC_SCRIPT`.
- `src/review-loop.mjs:821-844, 899-937` — plan-fix loop; `--output <outputPath>`, streams the
  engine's stdout/stderr live to parent stderr for visibility, tails the output file, then
  `readFileSync(outputPath)`. **Default `planningEngine` is `codex`** (review-loop.mjs:79),
  so a codex-exec hang wedges plan-fix iterations. (This plan's own Phase 4 convergence is run
  with `--planning-engine copilot` to avoid that.)
- `skills/plan-with-ralph`, `skills/review-changes`, `skills/brainstorm-with-ralph`,
  `skills/multi-model-investigate`, `agents/plan-reviewer.md` — all write `--output <...>.txt`
  and later read the FILE. No stdout/stderr data dependence; only live-terminal **visibility**
  depends on the current `inherit` behavior.

**Exit-code contract (must be preserved):** `waitForChild` returns `child.exitCode`, else
`128 + signalNum` on signal, else `1` for wrapper/spawn failure (codex-exec.mjs:203-227;
restated in AGENTS.md/CHANGELOG v5.45.0 "preserve child exit codes").

**Test surface that pins behavior to change:**
- `tests/test-codex-exec.mjs:120` asserts `stdio === ["pipe","inherit","inherit"]` — **this
  assertion must be updated** to the new fd-backed shape. Other cases pin argv (`-c` value as
  one element, `--output` present), exit-code preservation (157-170), and output-file
  non-mutation on child failure (183-194) — all must still hold.
- `tests/test-regression-smoke-phase-3.mjs:190-275` — codex stdin/argv capture, partial output
  preserved on non-zero exit, codex output non-mutation, exact exit-code propagation.
- `tests/test-wrapper-rubric.sh` — `--include-rubric` injects `## Severity Rubric` once + creates
  output file (unaffected by stdio change but re-verify).
- `tests/test-copilot-exec.mjs` — reference for fd-capture + cleanup test patterns.
- Fixture stubs (`tests/fixtures/**/stub-codex.sh`, `spawn-extensionless-stub-patch.mjs`) assert
  `--prompt`/`--output` present and write the `-o` file; the trampoline forces `shell:false`.

**Sidecar location options:** codex-exec.mjs has no job-id today. `src/path-utils.mjs` exposes
`resolveJobsBase` / `autoDetectJobDir` / `resolveWorkDir` (CLI subcommands too), but the
**simpler, deterministic** option is a caller-supplied optional `--sidecar-dir <dir>` flag
defaulting to `dirname(--output)/lenses/`. Every existing caller already roots `--output` in a
job/staging/context dir, so deriving sidecars next to `--output` keeps the change local and
requires **no caller edits**.

**Other constraints (from Copilot lens):**
- `RUST_LOG` must be merged into the spawn `env` WITHOUT mutating the caller's `process.env`;
  respect a caller-set `RUST_LOG`, else apply the default; record the effective value in the
  sidecar header.
- `shell:true` means `child.pid` is the cmd.exe wrapper, not `codex.exe`. Tree-kill targets the
  spawned PID with `/T`; the process/TCP snapshot must walk descendants
  (`Get-CimInstance Win32_Process` by `ParentProcessId`, recursively) + `Get-NetTCPConnection
  -OwningProcess`. No package-local `package.json`; snapshot is Windows-only, best-effort,
  guarded for non-Windows.
- Repo rule: do not silently swallow failures. If `taskkill`/snapshot commands fail, **record**
  the failure in the sidecar rather than treating it as success.
- `RUST_LOG=debug` is a Heisenbug (changes timing) — include a low/no-log control mode so the
  instrumentation does not alter the workload during the A/B test.

## Codex Research
Not run. The `codex-exec` lens is the subject of this investigation and reproducibly HANGS on
this Windows box (~20 min, orphaned `codex.exe`, ~300s harness timeout fails to reap it;
observed 3× on 2026-06-07). Treated as unavailable per the standing lead instruction; the plan
was researched with the Claude(explore) + Copilot lenses. (A minimal instrumented `codex exec`
repro from the brainstorm — tiny prompt, stderr→file, `RUST_LOG=debug` — did **not** hang and
exited 0 in ~27s, which is why MCP-block was refuted and pipe-deadlock + model-stream + remote-sync
remain the live unbounded-hang candidates.)

## Copilot Research
Confirms the design: implement primarily in `codex-exec.mjs::main()` around the spawn block by
porting selected `copilot-exec.mjs` primitives, adapted for TWO sidecar fds
(`stdio: ["pipe", outFd, errFd]`). Preserve codex's `-o` result file (do not write/truncate it
in Node). Add wrapper timeout (configurable, safe default), on-timeout `.err` diagnostic block,
process-tree + TCP snapshot before kill, `taskkill /T /F /PID`, distinct non-zero timeout exit
code. Merge `RUST_LOG` into spawn env; record effective value in sidecar header. Update tests:
replace the stdio assertion, assert sidecar creation, assert `-o` argv unchanged, add
timeout/tree-kill test via injected `execFileSync`/timer hooks (not real `taskkill`), add
signal-handler cleanup tests. Avoid changing call sites unless adding `--sidecar-dir`.

## Consolidated File List

**Files to modify (impl):**
- `ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs` — core change (stdio, sidecars, RUST_LOG, timeout, snapshot, tree-kill, signal handlers, header-comment revision)
- `ai-developer-toolkit/plugins/ralph/tests/test-codex-exec.mjs` — update stdio assertion + new tests
- `ai-developer-toolkit/plugins/ralph/AGENTS.md` — vX.Y.0 Behavioral Additions + revise codex-exec contract notes
- `ai-developer-toolkit/plugins/ralph/CHANGELOG.md` — new version entry
- Version stamps (5): `plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.github/plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`

**Files to create (impl):**
- A small A/B repro harness (script + buffer-filling prompt) and a findings note recording the
  inherit-vs-fd-backed outcome (US-001).
- Possibly new fixture(s) under `tests/fixtures/` for the timeout/tree-kill test.

**Verify-only (must stay green):** `tests/test-regression-smoke-phase-3.mjs`,
`tests/test-wrapper-rubric.sh`, `tests/test-copilot-exec.mjs`, fixture stubs.

**Impl repo:** `ai-developer-toolkit` submodule (ralph-orchestration plugin) — needs a submodule
worktree + two-commit flow (submodule commit first, then codexu pointer bump).
