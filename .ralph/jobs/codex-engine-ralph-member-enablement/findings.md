# Findings: Enable & Validate codex-engine Ralph Members (Spike)

<!-- ralph-meta {"overviewTaskId":"codex-engine-ralph-member-enablement"} -->

*Spike executed 2026-06-07 by the `impl-engine` member (crew `ralph-pipeline`). Validation spike, not a code change. No plugin version bump. Final diff = this findings doc only.*

## TL;DR — the headline answer

**The original plan premise is OBE (overtaken by events).** When the plan was written, ralph-orchestration shipped **no** `.codex-plugin` overlay, so the plan predicted ralph skills would NOT advertise under codex and a codex member would degrade hard. **That changed this session:** ralph **v5.53.0** (codex multi-agent adapter / `codex-lowering.mjs` generator) + **v5.54.0** (codex-exec pipe-deadlock fix) shipped a full `plugins/ralph/.codex-plugin/` overlay (a `codex-skills/` set, an `agents/` set, `internal-workflows/`, and a `plugin.json` with `"skills": "./codex-skills/"`).

After refreshing the **stale** codex plugin caches (`crews 3.6.2 → 3.12.1`, `ralph-orchestration 5.50.0 → 5.54.0`, install `ralph-overview 2.10.0`) from the **local-source** `ai-developer-toolkit` marketplace, a fresh codex session now:

1. **SEES all 15 `ralph-orchestration:*` skills** (incl. `brainstorm-with-ralph`, `plan-with-ralph`, `implement-with-ralph`) plus all `crews:*` and `ralph-overview:*` skills. *Validated live.*
2. **RUNS them end-to-end** — `brainstorm-with-ralph` executed Phases 1–4 under codex (246s, exit 0), ran a lens, produced correct artifacts, stopped at the right autonomous boundary, "no tool step failed". *Validated live.*

So: **YES — a codex-engine member can now both see and run ralph skills**, given the new `.codex-plugin` overlay + a cache refresh. The remaining gaps are *quality/parity* gaps (the three harness primitives in `codex/tasks/prd-plugin-parity-skill-agent-streaming.md`), not *enablement* gaps. They make some ralph workflows run **degraded** but not **broken**.

## Works / Partially-works / Breaks matrix

| # | Capability | Status | Evidence | Root cause / note |
|---|---|---|---|---|
| 1 | Plugin install / cache refresh (local-source marketplace) | **WORKS** | `codex plugin add <p>@ai-developer-toolkit` re-copied source into new cache version subdirs; POST cache = crews/3.12.1, ralph-orchestration/5.54.0, ralph-overview/2.10.0; `codex plugin list` reports all three "installed, enabled" at new versions | The local-source marketplace (`\\?\D:\harness-efforts\codexu\ai-developer-toolkit`) is immune to the git-marketplace auto-upgrade corruption bug. |
| 2 | Fresh-thread ralph **skill advertisement** | **WORKS** | A fresh `codex exec` session enumerated all 15 `ralph-orchestration:*` skills (`brainstorm-with-ralph`, `plan-with-ralph`, `implement-with-ralph`, `multi-model-investigate`, `prepare-handoff` + 10 internal) and the model explicitly answered `brainstorm-with-ralph: YES; plan-with-ralph: YES; implement-with-ralph: YES` | Resolved via the new `.codex-plugin/plugin.json` (`"skills": "./codex-skills/"`). Pre-overlay (cache 5.50.0) this would have shown nothing. |
| 3 | ralph **skill execution** — `brainstorm-with-ralph` end-to-end | **WORKS** | `codex exec` ran the skill through Phase 4 (the correct autonomous stop point), 246.3s, exit 0; ran the `devils-advocate` lens; produced `brainstorm-synthesis.md`, `brainstorm.json` (3 candidate directions), and a handoff breadcrumb; reported "No tool step failed." | The lowered codex-skill body executed correctly. Only the multi-lens fan-out (codex + copilot lenses) was intentionally skipped via `--codex-brainstorm never --copilot-brainstorm never` to keep the probe light (see Limitations). |
| 4 | codex `multi_agent_v2` fan-out **primitive** (the F2 foundation) | **WORKS** | A minimal `codex exec -c features.multi_agent_v2=true` fan-out fired `collab: SpawnAgent` → `Wait` → `CloseAgent`, completed in **58.7s with no hang**, exit 0; single-level fan-out gate enforced (`spawn_agent is not available from subagent sessions`) | This is exactly the primitive the ralph v5.53.0 lowering targets. The single-level guard is the documented contract; my naive probe tripped it only because I did not set `fork_turns="none"` (see Operational notes). |
| 5 | crews codex **hook lifecycle** (SessionStart / PreToolUse / PostToolUse / Stop) | **WORKS** | All four hook events fired (`hook: SessionStart … Stop Completed`) on every `codex exec` session; config.toml carries all 5 crews codex hook stanzas | crews ships `.codex-plugin/hooks/hooks.json` + `codex-*.js` shims; ralph is skills-only (no codex hooks → no `hooks.state` entries). |
| 6 | crews codex **member lifecycle** (interactive `--engine codex` spawn) | **NOT AUTONOMOUSLY DRIVEABLE from this session; INDIRECTLY VALIDATED** | A live `--engine codex` crews member is an interactive `wt.exe` codex TUI tab requiring (a) lead spawn authority and (b) a human-observable tab — neither available to a non-lead impl member. Per the plan's contract this gate STOPs here rather than silently hanging. Indirect validation: crews **v3.6.4** (spawn fix: `--dangerously-bypass-approvals-and-sandbox` clears the codex 0.135 TUI `--add-dir` guard) and **v3.6.6** (deterministic stop-time tab close) shipped + smoke-tested; the crews codex hooks demonstrably load and fire in a fresh codex session (row 5) | This is the one gate that cannot be driven from inside an impl-member probe; it is an interactive + lead-authority operation. It is independently covered by the crews plugin's own shipped work. |
| 7 | `plan-with-ralph` full multi-lens fan-out under codex | **NOT RUN LIVE (scoped out)** | — | Structurally the same `multi_agent_v2` + CLI-lens machinery already characterized in rows 3/4/8/9; running it live risks the documented `multi_agent_v2` iteration-hang + xhigh lens cost (`plugins/ralph/AGENTS.md`: "Do not run the live smoke during normal implementation iterations"). Characterized analytically below, not executed. |
| 8 | **F1 — Skill chaining** (`invoke_skill` + `internal:true`) | **MISSING in engine; WORKED AROUND in overlay (degraded)** | codex 0.135 has no `invoke_skill` tool (`prd-plugin-parity-skill-agent-streaming.md` Feature 1 proposes adding it). The lowered codex implement-with-ralph chains by prose: *"read the internal-workflow SKILL.md at `…/internal-workflows/<name>/SKILL.md` … and execute its workflow inline with these inputs: …"* | Functional but **no sub-turn isolation** — the chained workflow accumulates in the parent turn's context instead of running as an isolated sub-turn. Acceptable for short chains; risk grows with chain depth + context length. |
| 9 | **F2 — Typed subagents** (`subagent_type` registry from `.codex-plugin/agents/`) | **PARTIAL** | Generic `multi_agent_v2::spawn` works (row 4) and the overlay lowers `Agent(...)` fan-out to it (80 recipe sites in implement-with-ralph, 16 in brainstorm-with-ralph). But codex 0.135 has **no typed agent registry** — `subagent_type` tool-whitelist / model-selection / base-prompt per type is not enforced | Lenses run as **generic** spawns. A lowered "read-only Explore" lens is not actually tool-restricted to read-only; model/effort per agent-type is not applied. `prd-plugin-parity-skill-agent-streaming.md` Feature 2 adds the registry. |
| 10 | **F3 — Streaming background output** (`watch_background_session`) | **MISSING in engine; crews works around** | codex `exec_command` background + `await_background_completion` is not line-streaming. `prd-plugin-parity-skill-agent-streaming.md` Feature 3 proposes `watch_background_session` | Not used by ralph skill bodies (CODEX_FORBIDDEN strips `run_in_background`/`BashOutput`). Affects crews **listener** real-time mailbox delivery quality; crews works around with its own codex-listener subprocess + hooks. |
| 11 | codex-exec recursion / pipe-deadlock **hang** | **NOT OBSERVED** | All direct `codex exec` probes (skill-advertisement, multi_agent_v2, full brainstorm) ran clean (58.7s / 246.3s, exit 0) — zero hangs | The Windows pipe-deadlock was a property of ralph's `src/codex-exec.mjs` *wrapper* (undrained inherited stdout/stderr), fixed in **ralph v5.54.0** (fd-backed sidecars). My probes invoke `codex exec` **directly** (powershell drains the pipe), so they exercise codex itself, not the wrapper fix — but they confirm codex-side execution does not hang on these workloads. |
| 12 | MCP under codex | **MINOR NON-FATAL NOISE** | Two `ERROR rmcp::transport::async_rw: Error reading from stream: serde error EOF` lines appeared on codex startup; sessions completed fine. ralph-overview MCP not separately exercised (brainstorm/plan don't need it) | A configured MCP server EOF'd at startup (benign). Worth a glance if any MCP-dependent workflow misbehaves, but it did not affect skill execution. |

## PRE / POST codex environment snapshots

### Environment
- **codex**: `codex-cli 0.135.0-copilot-api.1`
- **Marketplace** (`~/.codex/config.toml`): `[marketplaces.ai-developer-toolkit] source = '\\?\D:\harness-efforts\codexu\ai-developer-toolkit'` — **local-source** (path, not git). Marketplace source versions at spike time: ralph-orchestration 5.54.0, crews 3.12.1, ralph-overview 2.10.0.

### PRE (before refresh)
- **Cache** `~/.codex/plugins/cache/ai-developer-toolkit/`: `crews/3.6.2`, `ralph-orchestration/5.50.0` (no ralph-overview).
- **`codex plugin list`**: `ralph-orchestration@… installed, enabled 5.50.0`; `crews@… installed, enabled 3.6.2`; `ralph-overview@… not installed`.
- **config.toml** plugin stanzas: `[plugins."crews@ai-developer-toolkit"]`, `[plugins."ralph-orchestration@ai-developer-toolkit"]`; crews codex hooks registered (`pre_tool_use`, `post_tool_use`, `session_start`, `user_prompt_submit`, `stop`); **no** ralph hook stanzas (ralph is skills-only).
- The PRE ralph cache (5.50.0) **predates** the `.codex-plugin` overlay → ralph skills would NOT have advertised.

### POST (after `codex plugin add crews@… / ralph-orchestration@… / ralph-overview@…`)
- **Cache**: `crews/3.12.1`, `ralph-orchestration/5.54.0`, `ralph-overview/2.10.0`.
- **`codex plugin list`**: all three `installed, enabled` at the new versions.
- **config.toml** plugin stanzas: now three (`crews`, `ralph-orchestration`, `ralph-overview`); crews codex hooks unchanged; still no ralph hook stanzas.
- **ralph 5.54.0 cache** now contains `.codex-plugin/` → `codex-skills/{brainstorm-with-ralph, plan-with-ralph, implement-with-ralph, multi-model-investigate, prepare-handoff}`, `agents/`, `internal-workflows/`, and `plugin.json` with `"version": "5.54.0"`, `"skills": "./codex-skills/"`.
- Old cache subdirs (`crews/3.6.2`, `ralph-orchestration/5.50.0`) were **left in place** (codex selects the new version; pruning is optional and safe to skip).

## How the overlay closes the gap (concrete mechanics)

- **Skill discovery**: codex reads `.codex-plugin/plugin.json` `"skills": "./codex-skills/"` and registers each `codex-skills/<name>/SKILL.md` as `ralph-orchestration:<name>`.
- **F1 chaining workaround** (no `invoke_skill`): orchestrator skills emit prose like *"read the internal-workflow SKILL.md at `plugins/ralph/.codex-plugin/internal-workflows/decompose-plan/SKILL.md` … and execute its workflow inline with these inputs: …"* — i.e. inline sub-turn execution, not an isolated chained turn.
- **F2 fan-out lowering**: `Agent(...)` multi-lens sites are mechanically lowered (`plugins/ralph/scripts/codex-lowering.mjs`) to the `spawn_agent → followup_task → wait_agent → list_agents → close_agent` recipe with a v1/v2 preflight that STOPs on `multi_agent_v2 is not enabled`. The recipe hardcodes six operational findings (incl. `fork_turns="none"`, single-level fan-out, `timeout_ms >= 10000`, match by canonical `agent_name`, fail-hard on timeout/malformed JSON).
- **CODEX_FORBIDDEN token gate** strips `Skill(`, `Agent(`, `run_in_background`, `BashOutput`, `--add-dir`, `mcp__`, etc. from emitted codex artifacts, so no Claude-only primitive leaks into the codex skill bodies.

## Remediation tracks

### Track A — plugin-side codex overlay — **ALREADY SHIPPED (v5.53.0 / v5.54.0)**
The codex-lowering generator (`plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=codex`, lowering rules in `plugins/ralph/scripts/codex-lowering.mjs`) + the emitted `plugins/ralph/.codex-plugin/` overlay are what make ralph skills *see + run* under codex today. **No further Track-A work is required for basic codex-member operation.** Optional future Track-A refinement: emit `.codex-plugin/agents/<type>.md` definitions + thread `subagent_type` into the lowered recipes once codex supports the typed-agent registry (Track B Feature 2) — until then the registry would be inert.

### Track B — engine-side parity — **OUTSTANDING** (`codex/tasks/prd-plugin-parity-skill-agent-streaming.md`)
Three independent codex Rust features that upgrade ralph-under-codex from *degraded* to *full*:
- **Feature 1 — `invoke_skill` + `internal:true`** → real skill chaining with sub-turn isolation; retires the inline-read workaround (row 8). Highest impact / smallest surface. Files: `core/src/tools/handlers/invoke_skill.rs` (+ spec, registration in `spec_plan.rs`), skill loader `internal` field, SessionStart skill-list filter.
- **Feature 2 — `subagent_type` typed-agent registry** → per-lens tool whitelist / model / base-prompt; closes the "generic spawn loses agent-type semantics" gap (row 9). Files: `core/src/tools/handlers/multi_agents_v2/spawn.rs` + new agent registry + `.codex-plugin/agents/` loader.
- **Feature 3 — `watch_background_session`** → real-time line-streamed background output; improves crews listener delivery (row 10). Files: `core/src/unified_exec/process_manager.rs` + new `watch_background_session.rs`.

**Recommended track selection (advisory; operator owns the call):** the *enablement* objective is already met by Track A, so Track B is a **quality/parity** investment, not a blocker. If sequenced, Feature 1 (skill chaining) gives the largest correctness improvement for ralph's orchestrator skills per unit of Rust work; Feature 2 matters most for multi-lens review fidelity; Feature 3 is crews-listener-facing. Each Track-B feature must clear the codex fork's overlay-first conflict-surface gates (`codex/CLAUDE.md` core tenet 1) and carry a `// SANDBOX PATCH:` marker + patch-surface registration.

### Downstream consumer
`crews-target-engine-plugin-provisioning` (the automation that would auto-refresh a target engine's plugin caches before spawning a member) is **de-risked** by this spike: the manual refresh path (`codex plugin add <p>@<marketplace>` per plugin) is proven, and the authoritative install-state evidence is the cache version subdirs + `~/.codex/config.toml` stanzas (and, on codex 0.135, `codex plugin list` STATUS/VERSION — see Operational notes).

## codex / Windows operational notes (so future sessions don't re-derive)

- **`codex plugin list` DOES report install state on codex 0.135** — `STATUS = "installed, enabled"` + `VERSION` columns. This **corrects** the plan's premise that it reports only marketplace availability. The cache version subdirs + `~/.codex/config.toml` plugin stanzas remain the most authoritative cross-check, but `codex plugin list` is a valid quick signal here.
- **Cache-not-source**: `codex/CLAUDE.md` — plugin **source** edits do NOT propagate to the marketplace cache. `codex plugin add <p>@<mp>` re-copies current source into a new `~/.codex/plugins/cache/<mp>/<p>/<version>/` subdir. A **fresh codex thread/session** is required to load new skills/hooks (an already-open session won't see them).
- **`codex exec` needs `--skip-git-repo-check`** when run outside a trusted/git directory (else: *"Not inside a trusted directory and --skip-git-repo-check was not specified."*).
- **`multi_agent_v2` is gated** by `-c features.multi_agent_v2=true` (or `--enable multi_agent_v2`). Fan-out is **single-level**: a sub-agent calling `spawn_agent` is rejected with `spawn_agent is not available from subagent sessions`. The ralph lowering's `fork_turns="none"` is **load-bearing** — without it the spawned child inherits the parent prompt and trips that grandchild spawn-gate (reproduced live by a naive probe that omitted `fork_turns`).
- **codex member spawn flag**: crews v3.6.4 spawns `--engine codex` members with `--dangerously-bypass-approvals-and-sandbox` (NOT `--sandbox workspace-write`) because codex 0.135's interactive **TUI** has a fatal pre-session `--add-dir` guard (`tui/src/lib.rs`); this guard is TUI-only and is NOT exercised by `codex exec`, so `codex exec` probes can give a false-green on launcher posture.
- **Benign MCP noise**: `ERROR rmcp::transport::async_rw: … serde error EOF` on codex startup is non-fatal (a configured MCP server EOF'd); sessions completed normally.
- **Windows MAX_PATH**: deep `.ralph/jobs/<slug>/worktree/` paths blow up some tooling; all live codex probes were run from a short temp cwd (`%TEMP%\codex-ralph-spike`) so throwaway `.ralph/` artifacts landed **outside** the codexu repo (no tracked-tree cleanup needed).
- **No codex-exec hang** in any direct `codex exec` probe this session (the v5.54.0 wrapper fix targets ralph's `codex-exec.mjs`, a different surface than direct `codex exec`).

## Acceptance-criteria disposition

- [x] codex cache shows crews ≥3.12.0 + ralph-orchestration ≥5.52.0 after `codex plugin add` — POST cache = 3.12.1 / 5.54.0 / 2.10.0; PRE/POST cache + config snapshots captured above.
- [x] Fresh codex thread started after refresh; skill advertisement captured via explicit transcript excerpt (15 `ralph-orchestration:*` skills + model YES/YES/YES). Discovery path = `.codex-plugin/plugin.json` `"skills"` (NOT the `.claude-plugin` fallback — the overlay now exists).
- [~] Primitive-free crews codex member lifecycle smoke — **NOT autonomously driveable** from a non-lead impl member (interactive wt.exe TUI + lead authority); recorded as the explicit interactive-driving blocker per the plan's STOP-this-gate contract; indirectly validated by crews v3.6.4/v3.6.6 ships + live crews-codex-hook firing.
- [x] `brainstorm-with-ralph` attempt recorded gate-by-gate — ran to Phase 4 (autonomous stop), 246.3s, correct artifacts, "no tool step failed"; multi-lens fan-out intentionally skipped (minimal mode) to bound cost/hang risk.
- [~] `plan-with-ralph` degradation probe — **scoped out of live execution** (documented hang risk; structurally identical machinery to the validated brainstorm + multi_agent_v2 probes). F1/F2/F3 gap characterization stands as the evidence.
- [x] `findings.md` exists with works/partial/breaks matrix + per-row root cause + PRE/POST snapshots + Track A/B remediation with file pointers + cross-refs.
- [x] codex/Windows operational notes captured.
- [x] Throwaway artifacts isolated to `%TEMP%` (outside the repo); no plugin/engine source modified; no version bump; final diff = this `findings.md`.

## Limitations & honest scope notes

- **The full multi-lens fan-out of `brainstorm-with-ralph` was NOT exercised** — the live run used `--codex-brainstorm never --copilot-brainstorm never` (minimal mode, devils-advocate only) to bound xhigh-lens cost and the documented `multi_agent_v2` iteration-hang risk. The fan-out **primitive** was validated separately (matrix row 4); the full 3-lens brainstorm/plan fan-out under codex remains live-unverified.
- **`plan-with-ralph` / `implement-with-ralph` were not run live** — characterized analytically. They lean harder on F1 chaining (implement-with-ralph chains through ~5 internal workflows) and the CLI-lens fan-out (plan-with-ralph Phase 2/4 via `codex-exec.mjs`/`copilot-exec.mjs`), so the degraded-but-functional verdict (F1 inline-read, F2 generic spawn) applies but with more accumulated context risk for the long orchestrator chain.
- **Indirect-only validation** for the interactive crews codex member spawn (matrix row 6) — by construction (lead authority + interactive TUI) it cannot be driven from an impl-member probe.
