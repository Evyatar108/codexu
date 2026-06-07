---
overviewTaskId: ralph-codex-exec-lens-hang-instrumentation
---

## Direction
D-001 — Capture-first: port `copilot-exec.mjs`'s fd-backed stdout/stderr capture + process-tree kill into `codex-exec.mjs`. Make the codex-exec lens path drain/capture both child streams (no inherited, undrained pipe) with a `RUST_LOG` tee, plus a bounded wrapper timeout + `taskkill /T /F` tree-kill and a pre-kill process/TCP snapshot — diagnosis and fix in one change. (Operator-selected 2026-06-07.)

## Goal
The ralph `codex-exec` research/review lens, when invoked from inside a Copilot ralph member on Windows (codex 0.135), can no longer wedge the pipeline: it (1) never leaves an orphaned `codex.exe` after a timeout, (2) always persists the codex child's stdout+stderr to per-lens sidecar files (so "no output" becomes inspectable evidence), and (3) cannot be killed by a full OS pipe buffer because the child's streams are written to file descriptors (no write-backpressure) rather than an inherited, undrained pipe. As a side effect, any *remaining* hang is diagnosable: the last sidecar log line + the pre-kill process/TCP snapshot pinpoint the blocking phase.

The decisive validation: run the exact failing large/`xhigh` prompt under BOTH the current `inherit` stdio and the new fd-backed stdio. **If draining/capturing the streams stops the hang, that confirms the Windows pipe-buffer deadlock was the root cause.** If the hang persists under fd-backed capture (with low/no `RUST_LOG`), the sidecar's last log line decides between `startup_remote_sync` and the `POST /responses` model stream.

## Scope

### In Scope
- `codex-exec.mjs` (ralph-orchestration plugin, `src/codex-exec.mjs`): change the child stdio so stdout AND stderr are captured/drained per-lens instead of `inherit`ed, writing to sidecar files (e.g. `.ralph/jobs/<id>/lenses/codex-exec-<ts>.{out,err}`); preserve codex's own `-o` result file.
- Set `RUST_LOG` (a codex-targeted filter or `info`) for lens runs so the sidecar `.err` carries phase markers (`thread/start`, `starting/completed remote plugin sync`, hook fires, `model_client.stream_responses_api POST /responses`).
- Add to `codex-exec.mjs` the Windows-safe lifecycle machinery that already exists in the sibling `copilot-exec.mjs`: a bounded wrapper timeout, `killChildTree()` via `taskkill /T /F /PID`, and SIGINT/SIGTERM handlers; before killing, snapshot the `codex.exe` process subtree + `Get-NetTCPConnection -OwningProcess <pid>` into the sidecar, then tree-kill and record the kill.
- A reproduction recipe / small disconfirmation check that runs the failing prompt under inherit-vs-fd-backed stdio.

### Out of Scope
- Shipping a final root-cause fix for `startup_remote_sync` stalls or `POST /responses` model-stream stalls (those become follow-ups IF D-001's capture shows the hang persists — see alternatives D-002/D-003 in the synthesis).
- Changing `copilot-exec.mjs` (already has fd-capture + tree-kill).
- Any codex (Rust) source change. This is a Node wrapper / ralph-plugin change only.
- Disabling plugins/marketplace remote sync globally (that is D-002's mitigation, deferred).

## Criteria
- After an induced wrapper timeout on a deliberately-long codex run, **no orphaned `codex.exe`** remains (verify via process listing); the kill is recorded in the sidecar.
- Both a `.out` and `.err` sidecar exist per codex-exec lens invocation and contain the child's stdout/stderr; codex's `-o` result file is still written on success.
- The `.err` sidecar contains `RUST_LOG` phase markers sufficient to distinguish startup-sync vs model-request vs hooks on a hang.
- A/B check: the exact failing large/`xhigh` prompt is run under both current `inherit` stdio and the new fd-backed stdio, and the outcome (hang vanishes ⇒ pipe-deadlock confirmed; hang persists ⇒ last-log-line attributes the phase) is recorded.
- No regression on the happy path: a normal codex-exec lens still returns its result via `-o` and exits 0.

## Context

### Refined hypothesis ranking (after this session's live evidence)
- **REFUTED — down/slow configured MCP server (original leading hypothesis).** The merged codex config has **zero `[mcp_servers]`** (no repo-layer `.codex/config.toml`; only `~/.codex/config.toml`, which configures none). The instrumented live repro (a minimal `codex exec` mimicking the wrapper's exact args, `RUST_LOG=debug`, stderr→file) **exited 0 in ~27 s** — no hang. Prior-art `codex-down-mcp-startup-behavior-0135` further shows a down MCP blocks **at most `startup_timeout_sec` (default 30 s)** — incompatible with the observed ~20-min hang.
- **LEADING (unbounded) — pipe-buffer deadlock.** `codex-exec.mjs` spawns with `stdio: ["pipe", "inherit", "inherit"]`: it does **not** drain the child's stdout/stderr itself — both are *inherited* to the parent (ultimately the Copilot member harness's pipes). If that harness holds those as pipes and waits on process exit instead of draining continuously, the OS pipe buffer fills (~64 KB on Windows) and `codex.exe` blocks on `write()` forever. This fits both the unbounded ~20-min hang and the "no output" symptom. The minimal repro could **not** test this because it redirected stderr to a *file* (no backpressure).
- **LEADING (unbounded) — model-stream stall.** The real failures used `--effort xhigh` + a large prompt; the `POST /responses` (Copilot API) stream has no client-side timeout, so a stalled stream hangs unboundedly while the `-o` file stays empty.
- **PLAUSIBLE — `startup_remote_sync` network stall.** The trace shows `codex_core_plugins::manager: starting remote plugin sync` → `completed remote plugin sync marketplace=openai-curated remote_plugin_count=0` taking ~10 s on *every* startup even when it returns zero plugins; a slow/down endpoint could block here.
- **REFUTED — stdin/approval wait, sandbox/add-dir guard, crews/ralph hook block.** `--dangerously-bypass-approvals-and-sandbox` is passed, stdin is closed after the prompt, and in the trace the `SessionStart`/`UserPromptSubmit`/`Stop` hooks all completed sub-second.

### KEY OPEN QUESTION FOR THE PLAN (raised by the lead)
**Confirm whether `codex-exec.mjs` currently drains both stdout AND stderr concurrently.** Code reading says it does **not** drain either — it `inherit`s both (`src/codex-exec.mjs`, the `spawn("codex", args, { stdio: ["pipe", "inherit", "inherit"] })` call). With `inherit`, the deadlock locus is whatever the inherited fds point to (the harness pipe), and the classic Windows ~64 KB pipe-buffer deadlock applies if that consumer reads one stream then the other, or reads neither during a long run. The plan must (a) verify the exact end-to-end fd chain from `codex.exe` → node wrapper (inherited) → Copilot harness, and (b) ensure the chosen fix removes the pipe entirely (fd-backed files) OR drains both streams concurrently — never a single-threaded read-one-then-the-other.

### Reference (proven sibling machinery to port)
`copilot-exec.mjs` in the same directory already solves capture (`openSync(outFile,'w')` → `stdio:["ignore", outFd, "inherit"]`) and reaping (`killChildTree()` via `taskkill /T /F /PID` + SIGINT/SIGTERM handlers). D-001 ports these to `codex-exec.mjs`, additionally capturing **stderr** to a file (copilot-exec still inherits stderr) since codex's diagnostic stream is stderr.

### Disconfirming observations to carry into the plan
- Pipe-deadlock is **disconfirmed** if the exact large/`xhigh`/concurrent run still hangs with stdout+stderr attached directly to files (no inherited pipe) and low/no `RUST_LOG`.
- Capture-as-fix giving false confidence: if the hang merely *vanishes* under fd-backed capture, attribute it to pipe-deadlock — do NOT claim `startup_remote_sync`/model-stream are fixed.
- Tree-kill adequacy is disconfirmed if `taskkill /T /F` on the shell/wrapper PID still leaves a `codex.exe` descendant (process ancestry can change after `shell:true`).
