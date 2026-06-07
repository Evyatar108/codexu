Lenses: ran=[copilot, devils-advocate]; skipped=[codex] (deliberately excluded — see note below)

# Brainstorm synthesis — codex-exec lens hang (instrumentation-first root-cause)

**Task:** `ralph-codex-exec-lens-hang-instrumentation` (scope=ralph, ralph-orchestration plugin)
**Mode:** brainstorm-with-ralph, autonomous; halted at Phase 4 for operator direction selection.
**Idea:** Root-cause the `codex exec` research/review lens HANG on Windows (codex 0.135), invoked from inside a Copilot ralph member — codex spawns, produces NO stdout, never exits, orphans `codex.exe`, and the ~300s lens timeout fails to reap it (hit 3× on 2026-06-07). Instrumentation-first: weigh which instrumentation gives the highest root-cause signal at lowest cost; recommend the cheapest high-signal set; give a reproduction recipe; say which hypothesis the evidence points to. Does NOT ship the fix.

> **Skipped-lens note:** The codex lens was deliberately excluded from the brainstorm fan-out because this very task is the codex-exec lens hang — running it risked the hang under investigation. Instead, codex was used for an **instrumented live reproduction** (see §1), which produced direct evidence for this investigation. (Notably, that minimal repro did *not* hang.)

---

## 1. Live instrumented reproduction (direct evidence gathered this session)

A controlled `codex exec` was run mimicking `codex-exec.mjs`'s exact args
(`exec - --model gpt-5.5 -c model_reasoning_effort=high --dangerously-bypass-approvals-and-sandbox -o <out>`),
with a **tiny** prompt ("Say hello in one word"), `RUST_LOG=debug`, and stderr redirected to a sidecar file.

**Result: it did NOT hang** — printed `Hello`, exit 0, ~27 s wall. The 160-line debug trace reveals the real
session-init phase sequence and timings:

| T (approx) | Phase (from `RUST_LOG=debug`) | Note |
|---|---|---|
| +0 s | `thread/start` begins | |
| +0 s | WARN `agents_md: Project doc AGENTS.md exceeds remaining budget (32768 bytes) - truncating` | non-fatal |
| +3 s | WARN `shell_snapshot: Failed to create shell snapshot for powershell: Shell snapshot not supported yet for PowerShell` | non-fatal |
| +9 s | INFO `codex_core_plugins::manager: starting remote plugin sync` | **network call** |
| +9 s | `hook: SessionStart` → `SessionStart Completed` | crews/ralph hook, sub-second |
| +9 s | `hook: UserPromptSubmit` → `Completed` | sub-second |
| +15 s | `model_client.stream_responses_api … POST /responses` (Copilot API) | model request starts |
| +19 s | INFO `completed remote plugin sync marketplace=openai-curated remote_plugin_count=0` / `enabled_plugin_ids=[]` | **~10 s spent even returning 0 plugins** |
| +19 s | `hook: Stop` → `Stop Completed` | sub-second |
| +20 s | done | exit 0 |

**What this proves and disproves:**

- **Zero MCP servers, hooks are fast.** The merged config has **no `[mcp_servers]`** at all (no repo-layer
  `.codex/config.toml`; only `~/.codex/config.toml`, which configures none). The crews/ralph
  `SessionStart`/`UserPromptSubmit`/`Stop` hooks all fired and **completed sub-second**. This refutes both the
  MCP-connect-block and the plugin-hook-block hypotheses *in the bare-exec context*.
- **`startup_remote_sync` is a per-startup NETWORK call** to the `openai-curated` marketplace — ~10 s even when
  it returns zero plugins. A new, better-grounded version of the original "down/slow remote dependency" idea.
- **The model stream (`POST /responses`)** is the other place a large/`xhigh` run can stall.

---

## 2. Code-reading evidence (why the symptoms happen)

- **`codex-exec.mjs` never captures codex's stdout/stderr per-lens.** It spawns with
  `stdio: ["pipe", "inherit", "inherit"]` — stdin is written then closed; **both stdout and stderr are inherited
  to the parent process**. The result file is owned by codex's own `-o` flag. So "no output" is *ambiguous*:
  consistent with (i) codex blocking before writing `-o`, AND (ii) any diagnostic stderr (e.g. a connect ERROR)
  going to the inherited parent stream and never persisted per-lens.
- **`codex-exec.mjs` has NO process-tree kill and NO signal handlers** (by explicit design comment:
  "orchestration owns interrupts here"). `waitForChild` blocks indefinitely with **no internal timeout**. When the
  harness-level ~300 s tool timeout fires and kills the node wrapper (and maybe the `shell:true` cmd.exe), the
  grandchild `codex.exe` is **orphaned** — exactly the observed symptom.
- **The sibling `copilot-exec.mjs` already solves both.** It captures the child's stdout into the output file via
  `openSync(outFile,'w')` → `stdio: ["ignore", outFd, "inherit"]`, and it has `killChildTree()` using
  `taskkill /T /F /PID` on Windows plus SIGINT/SIGTERM handlers. The proven Windows-safe patterns exist in the
  same directory.

---

## 3. Hypothesis ledger (confirm/refute)

| # | Hypothesis | Status after this session | Key discriminator |
|---|---|---|---|
| (a) | Down/slow **configured MCP server** blocks first-turn `list_tools` (original leading) | **REFUTED** for the ~20-min hang | Zero `[mcp_servers]` configured today; and per prior-art `codex-down-mcp-startup-behavior-0135`, a down MCP blocks **at most `startup_timeout_sec` (default 30 s)** — cannot explain a ~20-min hang |
| (d′) | **`startup_remote_sync` network stall** (openai-curated marketplace, every startup) | **PLAUSIBLE** | ~10 s even healthy; need to confirm whether it has a fail-fast bound or can hang unbounded |
| (e) | **Model-stream stall** on `POST /responses` (xhigh + large prompt, no client timeout) | **PLAUSIBLE, unbounded** | Real failure used `--effort xhigh` + a large prompt; the stream has no internal timeout → unbounded wait fits the ~20-min observation |
| (f) | **Pipe-buffer deadlock**: codex blocks on `write()` to an **inherited** stdout/stderr pipe the harness stops draining | **STRONG, unbounded** (raised by devils-advocate) | `stdio[1]/[2]="inherit"`; if the member harness holds those as pipes and waits on process exit instead of draining, the OS pipe fills and codex blocks forever. The live repro could NOT test this — it redirected stderr to a *file* (no backpressure) |
| (g) | **CODEX_HOME / cache / Defender contention** under N parallel lenses | **OPEN** | Only reproduces under the real concurrency envelope; serial tiny repro can't trigger it |
| (b) | stdin / interactive approval wait | **REFUTED** | `--dangerously-bypass-approvals-and-sandbox`; stdin closed; clean repro |
| (c) | sandbox / add-dir guard block | **REFUTED** | bypass flag passed; shell-snapshot WARN non-fatal; clean repro |
| — | crews/ralph **hook block** | **REFUTED** (bare context) | hooks completed sub-second in trace (could differ with crews member env present — worth a check) |

**The single most important discriminator** is *unboundedness*: the observed ~20-min hang is incompatible with the
bounded waits (MCP ≤30 s) and points squarely at the **unbounded** waits — **(f) pipe-buffer deadlock** and
**(e) model-stream stall**, with **(d′) remote-sync** a candidate only if it too can hang unbounded.

---

## Candidate directions

### D-001: Capture-first — port copilot-exec's fd-backed capture + process-tree kill into codex-exec.mjs
- Contributing lenses: [copilot, devils-advocate]
- Why this might work: It is the cheapest high-signal move because the proven machinery already exists in the
  sibling wrapper. Change `codex-exec.mjs` stdio from `["pipe","inherit","inherit"]` to **fd-backed** sidecars
  (`.ralph/jobs/<id>/lenses/codex-exec-<ts>.{out,err}` via `openSync`), preserve codex's `-o` result file, set
  `RUST_LOG` so the sidecar has phase markers, and add a wrapper bounded timeout + `killChildTree` (`taskkill /T /F`)
  + SIGINT/SIGTERM handlers that snapshot the process subtree + `Get-NetTCPConnection -OwningProcess` **before**
  killing. This is **diagnosis + fix in one change**: it removes the orphaned-`codex.exe` failure mode, converts
  "no output" into inspectable evidence, AND — crucially — *eliminates the (f) pipe-buffer-deadlock failure mode
  entirely* because files apply no write-backpressure.
- Risks / friction: Low workflow friction, but (per devils-advocate) it can give **false root-cause confidence**:
  if capturing stderr to a file makes the hang vanish, that likely means (f) pipe-deadlock was the cause — NOT that
  (d′)/(e) are fixed. The validation MUST run the exact failing large/`xhigh` prompt under **both** current `inherit`
  stdio and fd-backed stdio and compare. RUST_LOG=debug also changes timing (Heisenbug) — include a low/no-log run.
  Sidecar retention policy + verbose traces in job artifacts need a decision.
- Cheapest validation: Patch a local copy; run (i) tiny prompt → sidecars created, last-log visible; (ii) an
  artificially short wrapper timeout → confirm `taskkill /T` leaves **no** orphaned `codex.exe`; (iii) the real
  failing large/`xhigh` prompt under inherit-vs-fd-backed.
- Disconfirming observation: A timed-out run still leaves an orphaned `codex.exe`, OR the captured stderr lacks
  phase markers to distinguish startup-sync from model-request from hooks, OR the large/`xhigh` prompt still hangs
  under fd-backed stdio with low/no RUST_LOG (which would *exonerate* pipe-deadlock and point back at (d′)/(e)).

### D-002: Isolate the lens environment — isolated CODEX_HOME + disable remote plugin sync, run an A/B matrix
- Contributing lenses: [copilot, devils-advocate]
- Why this might work: The minimal repro did not exercise the real failure envelope (large prompt, `xhigh`,
  concurrent lenses, shared `CODEX_HOME`, marketplace-sync cache, Defender). Running a controlled matrix — normal
  shared home vs an isolated `CODEX_HOME` with no plugins/marketplace and remote sync disabled — both **diagnoses**
  which shared startup surface causes non-determinism under load and provides a **cheap operational mitigation**
  (disabling the ~10 s remote sync also speeds up *every* lens). Directly targets (d′) and (g).
- Risks / friction: Medium. Isolation can **mask** the bug and yield a mitigation rather than a diagnosis; a clean
  home that passes only proves "some shared state matters", not which (config vs plugin registry vs auth cache vs
  marketplace cache vs locks vs Defender). Disabling remote sync may destroy evidence needed to explain production
  hangs. Must carefully re-add only the config needed for model auth + repo context.
- Cheapest validation: A/B reproduction matrix with the same tiny and large/`xhigh` prompts under current
  `~/.codex` vs an isolated no-plugin/no-marketplace-sync home, capturing RUST_LOG sidecars + wall time for each.
- Disconfirming observation: The isolated environment hangs at the **same phase and rate** (especially with the
  last log line at `model_client.stream_responses_api` rather than plugin startup) — which would kill (d′) and (g)
  and re-point at (e)/(f).

### D-003: Minimal targeted phase-tracing probe + one-variable-at-a-time disconfirmation matrix
- Contributing lenses: [copilot, devils-advocate]
- Why this might work: Avoids anchoring on (d′)/(e) merely because they are the last lines of a *successful* trace.
  Add wrapper phase markers (spawn ts; `child.stdin.write()` return/`false`/drain/end; child PID; sidecar open mode;
  first byte in each of stdout/stderr/`-o`; remote-sync start/end; model POST start/end; timeout snapshot; kill
  result) and rely on codex RUST_LOG as one input among several. Then run a matrix changing ONE variable at a time:
  effort `high` vs `xhigh` × tiny vs large prompt × 1 vs N parallel × inherit vs fd-backed stderr × shared vs
  isolated home. The highest-value signal is the **first divergence** between a successful and a failing trace, not
  the final line. Folds in copilot's "classify large-prompt xhigh model-stream stalls" (hypothesis e) as one matrix
  axis.
- Risks / friction: Highest effort of the three; a last-line trace is "a seductive but weak causal story" — the
  failing run might never reach the successful run's tail, or block on request-body upload, response stream, local
  token accounting, `-o` write, or parent-pipe write. Needs care to log stdin backpressure and to include a
  low/no-RUST_LOG control so the instrumentation doesn't change the workload.
- Cheapest validation: One saved large/failing prompt + a tiny control; execute tiny/high/serial,
  large/high/serial, large/`xhigh`/serial, large/`xhigh`/3-parallel — each once with current `inherit` stdio and
  once with fd-backed sidecars; bounded timeout; snapshot before kill; then tree-kill.
- Disconfirming observation: (e) dies if failing traces never reach `POST /responses` or receive first token before
  the hang; large-prompt/stdin path dies if wrapper logs stdin drain/end and codex logs model POST quickly before
  every failure; (f) dies if the exact large/`xhigh`/concurrent failure persists with stdout+stderr attached to
  files (no inherited pipe) and low/no RUST_LOG.

---

## Recommendation

**Recommended: D-001 (capture-first).** It is the cheapest high-signal move and uniquely does three things at once:
(1) it **fixes the two confirmed symptoms** (orphaned `codex.exe` via tree-kill; capture-gap via fd-backed
sidecars), (2) it **eliminates the strongest unbounded-hang hypothesis (f) pipe-buffer deadlock** as a side effect
(files have no write-backpressure), and (3) it makes **every remaining hang diagnosable** (the last sidecar log line
plus the pre-kill process/TCP snapshot pinpoint the blocking phase). It reuses proven sibling code
(`copilot-exec.mjs`), minimizing risk and conflict surface.

**Important caveat carried from the devils-advocate lens:** D-001's validation must explicitly run the failing
large/`xhigh` prompt under *both* the current `inherit` stdio and the new fd-backed stdio (and at low/no RUST_LOG),
so that "the hang vanished" is correctly attributed to (f) pipe-deadlock rather than falsely crediting a fix for
(d′)/(e). If the hang **persists** under fd-backed capture, the sidecar's last log line decides between (d′)
remote-sync and (e) model-stream — at which point D-002 (disable remote sync / isolate home) or an `(e)`-targeted
model-stream timeout becomes the follow-up.

D-002 and D-003 are complementary follow-ups, not mutually exclusive: D-001 should land first as mandatory hardening
regardless of root cause; D-002/D-003 then collect the disconfirming evidence opportunistically on any remaining
hang.

## Open questions for the operator / finalize step
- Was the original hung `codex.exe` writing to an inherited stdout/stderr **pipe** owned by the Copilot member
  harness, and does that harness continuously **drain** those streams while waiting? (Decides hypothesis (f).)
- Did the three 2026-06-07 hangs occur **concurrently** with other lenses, and were they all large/`xhigh` prompts
  sharing one `CODEX_HOME`? (Decides (g) vs (e)/(f).)
- Can codex `startup_remote_sync` be disabled / made fail-fast for non-interactive lenses, and is that acceptable as
  a mitigation even if it masks root cause?
- What is the exact timeout owner today (Ralph lens harness vs Node wrapper vs Copilot member vs outer
  orchestration), and which PID does it kill? (Confirms the orphan mechanism.)
- Diagnosis purity vs operational reframe: land D-001's capture/tree-kill now, then collect evidence opportunistically?
