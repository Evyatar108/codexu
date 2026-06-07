# Stories Outline: Capture-First Instrumentation for the codex-exec Lens Hang (D-001)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> Impl target: the `ai-developer-toolkit` submodule (ralph-orchestration plugin). Requires a
> submodule worktree (`ai-developer-toolkit/.worktrees/ralph-codex-exec-lens-hang-instrumentation`)
> and the two-commit flow (commit + push inside the submodule first, then bump the codexu pointer).
> All stories edit `plugins/ralph/src/codex-exec.mjs`; execute serially (single cluster).

## US-001: Confirm/refute pipe-deadlock via a synthetic A/B repro harness
**Description:** As a maintainer, I want a deterministic, orphan-safe A/B harness that proves
whether an undrained inherited pipe is what blocks the child, so the root cause is established
before any wrapper behavior changes.
**Acceptance Criteria:**
- [ ] The current no-drain wiring is documented (`codex-exec.mjs` spawns `stdio: ["pipe","inherit","inherit"]`; neither stream is drained).
- [ ] A harness runs a synthetic child that writes `> ~256KB` under (a) an undrained inherited pipe and (b) stdout/stderr attached to files; each leg runs under an EXTERNAL watchdog (`Start-Process` timeout + `taskkill /T`) so no orphan can occur.
- [ ] The outcome + attribution is recorded to `plugins/ralph/docs/codex-exec-hang-ab-findings.md` (inherited-pipe leg blocks ⇒ pipe-deadlock mechanism confirmed; fd-backed leg completes).
- [ ] Does NOT run the real flaky `xhigh` prompt (that is US-005).
- [ ] Typecheck/lint passes for any new harness/fixture.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Per-lens fd-backed capture of BOTH stdout and stderr
**Description:** As a maintainer, I want `codex-exec.mjs` to write the child's stdout AND stderr to
per-lens sidecar files instead of inheriting them, eliminating the pipe-buffer-deadlock failure
mode and making "no output" inspectable.
**Acceptance Criteria:**
- [ ] Spawn stdio changes to `["pipe", outFd, errFd]` where `outFd`/`errFd` are `openSync(<sidecar>.out|.err, "w")`.
- [ ] Sidecars default to `--sidecar-dir = dirname(--output)/lenses/` with names `codex-exec-<ts>.{out,err}`; an optional `--sidecar-dir <dir>` flag overrides; no caller edits required.
- [ ] `mkdirSync(sidecarDir, { recursive: true })` runs before opening the fds (missing `lenses/` does not throw).
- [ ] Both fds are closed in `finally`; codex's `-o` result file is still written and never truncated by Node.
- [ ] Happy path: a normal run produces `.out` + `.err` sidecars containing the child streams, returns the result via `-o`, exits 0, and preserves the exit-code contract (`child.exitCode` / `128+signal` / `1`).
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: RUST_LOG phase-trace tee + low/no-log control
**Description:** As a maintainer, I want the `.err` sidecar to carry codex phase markers so any
remaining hang is attributable to startup-sync vs model-request vs hooks, without a Heisenbug.
**Acceptance Criteria:**
- [ ] A codex-scoped `RUST_LOG` default is merged into the spawn `env` WITHOUT mutating the caller's `process.env`; a caller-set `RUST_LOG` takes precedence.
- [ ] The effective `RUST_LOG` value is recorded in the sidecar header.
- [ ] The `.err` sidecar surfaces the discriminating substrings `remote plugin sync`, `stream_responses_api`/`POST /responses`, and `SessionStart`/`Stop`.
- [ ] A low/no-log control flag/env exists (Heisenbug guard) so the A/B can run at low/no trace.
- [ ] Default filter + env/flag precedence is documented.
**Dependencies:** US-002
**Estimated complexity:** small

## US-004: Bounded wrapper timeout + pre-kill snapshot + tree-kill (no orphan)
**Description:** As a maintainer, I want the wrapper to self-reap a stuck codex subtree before the
harness kills node, capturing diagnostic state first, so `codex.exe` is never orphaned.
**Acceptance Criteria:**
- [ ] A configurable timeout (`--timeout-ms`/`CODEX_EXEC_TIMEOUT_MS`, documented default below the ~300s harness bound) is enforced.
- [ ] On timeout and on SIGINT/SIGTERM: a pre-kill snapshot of the spawned-shell-PID subtree (recursive `Get-CimInstance Win32_Process` by `ParentProcessId`) + `Get-NetTCPConnection -OwningProcess` is written to a snapshot sidecar; a snapshot failure is RECORDED, not swallowed.
- [ ] After the snapshot, `killChildTree()` runs `taskkill /T /F /PID <child.pid>` (Windows) / `SIGKILL` (POSIX); the kill is recorded; the run settles with a distinct non-zero timeout exit code.
- [ ] `registerCleanupHandlers()` (exit/SIGINT/SIGTERM) is ported with `unregister()` in `finally`; the header contract comment is revised (no longer "must not install signal handlers").
- [ ] After an induced timeout, NO descendant of the spawned shell PID remains (verified against the snapshot — not a global `Get-Process codex`).
**Dependencies:** US-002
**Estimated complexity:** large

## US-005: Real-prompt A/B confirmation + tests, regression parity, docs, version stamps
**Description:** As a maintainer, I want the real failing workload confirmed safely, full test
coverage, and the docs/version metadata updated so the change ships cleanly.
**Acceptance Criteria:**
- [ ] The exact failing large/`xhigh` prompt is run under `inherit` vs fd-backed stdio (low/no `RUST_LOG`), safe via US-004's tree-kill; the outcome (hang vanishes ⇒ pipe-deadlock confirmed; persists ⇒ last-log-line attributes the phase) is appended to `docs/codex-exec-hang-ab-findings.md`.
- [ ] `tests/test-codex-exec.mjs` stdio assertion is updated to the fd-backed shape; new tests cover sidecar creation, the missing-`lenses/`-dir case, `-o` argv unchanged, timeout→tree-kill→no-orphan (via injected `execFileSync`/timer hooks, not real `taskkill`), and signal cleanup.
- [ ] `tests/test-regression-smoke-phase-3.mjs`, `tests/test-wrapper-rubric.sh`, and `tests/test-copilot-exec.mjs` stay green.
- [ ] `AGENTS.md` gains a `## vX.Y.0 Behavioral Additions` entry; `CHANGELOG.md` gains an entry; the 5 version stamps are bumped in lockstep (`plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.github/plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`).
- [ ] All edited `.md` files are LF-normalized before staging; the codexu root `CLAUDE.md` is not staged.
**Dependencies:** US-002, US-003, US-004
**Estimated complexity:** medium
