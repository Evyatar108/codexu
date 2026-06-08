# Research Brief — ralph-codex-iteration-engine-runaway-spawn-guard

Seeded from brainstorm: `.ralph/brainstorms/ralph-codex-iteration-engine-runaway-spawn-guard/selected-direction.md` (D-001, shipped @ 6c0af6fa).

All paths repo-relative to `D:/harness-efforts/codexu`. Submodules initialized in the primary checkout (research read from there; the plan worktree has uninitialized submodules by design).

## Researcher Findings (explore agent + first-hand verification)

### (a) The codex iteration code path + argv
- `ai-developer-toolkit/plugins/ralph/src/ralph.mjs:112` — `resolveEngine(parsed.engine, prdJson.iterationEngine)` resolves `codex|copilot|claude` (claude→copilot deprecated alias). `resolveEngine` at `:879`.
- `ai-developer-toolkit/plugins/ralph/src/ralph.mjs:917` — `runEngineIteration(...)` is the SINGLE-STORY iteration path. Builds args `--prompt prompts/<engine>.md --output <iterOut> [--model … for copilot] --effort <ITERATION_EFFORT> --text <header> --section "## prd.json" <prd> [+progress/notepad sections]` (`:939-964`). It passes **NO** collaboration-disabling flag and **NO** `--timeout-ms`. `resolveEngineScript` at `:978` → `src/<engine>-exec.mjs`.
- `ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs:120-131` — fixed argv: `exec - --model gpt-5.5 -c model_reasoning_effort=<effort> --dangerously-bypass-approvals-and-sandbox -o <outputFile>`. **It already passes a `-c key=value` config override** (`model_reasoning_effort`). Adding another `-c features.X=…` is mechanically trivial.
- `codex-exec.mjs` flags today: `--prompt --output --effort --include-rubric --text --section --sidecar-dir --rust-log --timeout-ms`. `DEFAULT_TIMEOUT_MS=240000` (`:72`) — the 4-min reap (OUT of scope; owned by `ralph-codex-exec-default-timeout-too-short`). Spawn at `:181` (`shell:true`).

### (b) Per-invocation codex knob to disable/cap collaboration? **GO — knob exists.**
codex submodule = `codex/external/repos/codex-patched/codex-rs/`, version `0.135.0-copilot-api.1` (`.../codex-rs/Cargo.toml`).
- `features/src/lib.rs:939-944` — `Feature::Collab` { key: `"multi_agent"`, stage: `Stable`, **default_enabled: true** }. THIS is the v1 Collab feature (the runaway culprit), default-ON.
- `features/src/lib.rs:946-950` — `Feature::MultiAgentV2` { key: `"multi_agent_v2"`, stage: `UnderDevelopment`, default_enabled: false } (already off in the iteration).
- `features/src/lib.rs:951-956` — `Feature::SpawnCsv` { key: `"enable_fanout"`, default_enabled: false }.
- `features/src/lib.rs:512-513` — guard: `if SpawnCsv && !Collab { enable(Collab) }`. Since SpawnCsv defaults off, this won't re-enable a disabled Collab — but belt-and-suspenders, also keep `enable_fanout=false`.
- `core/src/tools/spec_plan.rs:297` — `collab_tools_enabled(turn_context) = multi_agent_v2_enabled(turn_context) || features.enabled(Feature::Collab)`.
- `core/src/tools/spec_plan.rs:639-726` — `add_collaboration_tools` injects spawn tools ONLY when `collab_tools_enabled`. v2 path (642-694) injects SpawnAgentHandlerV2 etc.; v1 path (695-725) injects SpawnAgentHandler/SendInputHandler/ResumeAgentHandler/WaitAgentHandler/CloseAgentHandler. **With both features off → zero spawn tools injected → no runaway affordance.**
- **Mechanism confirmed working on 0.135:** `.ralph/jobs/codex-ralph-member-multi-agent-adapter/spike-verdict.json:7` — `codex exec --enable multi_agent_v2` is equivalent to `-c features.multi_agent_v2=true` (codex-cli 0.135.0-copilot-api.1). By symmetry, **`-c features.multi_agent=false` (or `codex exec --disable multi_agent`) disables v1 Collab.** The spike (Story 1) confirms this exact syntax empirically.
- **Cap alternative (escalation rung 2):** `max_concurrent_threads_per_session(turn_context)` is read at `spec_plan.rs:664` (v2) AND `:714` (v1) — it feeds BOTH spawn handlers. Config at `core/src/config/mod.rs` under `features.multi_agent_v2.max_concurrent_threads_per_session` (`>= 1`). So `-c features.multi_agent_v2.max_concurrent_threads_per_session=1` caps runaway threads to 1 even with Collab on. Spike tests this as the fallback if full-disable is rejected.

### (c) Mode separation — CLEAN, structurally separate code paths
- Iteration profile change lands in `runEngineIteration` (ralph.mjs) → `codex-exec.mjs` argv.
- `ai-developer-toolkit/plugins/ralph/scripts/codex-lowering.mjs` is a **GENERATOR-TIME** transformer (`lowerAgentBlocks`/`lowerSkillBlocks` at `:381-449`; `fanOutRecipe()` vs `singleDelegationRecipe()` at `:273-367`) that emits `.codex-plugin/` artifacts so codex MEMBERS can fan out via multi_agent_v2. It is NOT the runtime iteration path. Suppressing collab on the iteration (via a flag threaded only through `runEngineIteration`) does NOT touch member/lens fan-out. The v5.53.0 adapter is not regressed.
- The lens callers (`plan-with-ralph` Phase 2/4, `brainstorm-with-ralph`, `review-changes`, `review-loop` re-review) call `codex-exec.mjs` directly WITHOUT the new flag → unaffected by default (collab not needed for a single research/review exec anyway).

### (d) Schema default for iterationEngine (D-002 flip surface)
- `ai-developer-toolkit/plugins/ralph/schemas/prd-schema.json:17-21` — `iterationEngine` enum `["codex","copilot","claude"]`, **default `"codex"`**.
- `ai-developer-toolkit/plugins/ralph/src/review-loop.mjs:68-80` — `planningEngine` also defaults `"codex"`.
- Load-bearing flip points (if flip chosen): prd-schema.json:17-21, ralph.mjs resolveEngine fallback (:879-915), convert-to-ralph-prd write site. Docs/policy: AGENTS.md, CHANGELOG.md, `.ralph-overview/data.json`, create-prd/convert-to-ralph-prd skills, example PRDs, docs/fork-roadmap.md.

### (e) Child-process enumeration (D-003 fallback) + its INFEASIBILITY
- `codex-exec.mjs:518-549` — Windows subtree snapshot (`Get-CimInstance Win32_Process` by ParentProcessId + `Get-NetTCPConnection`). `:551-577` — `killChildTree` via `taskkill /T /F /PID`. `:579-600` — SIGINT/SIGTERM → snapshotAndKill.
- **CRITICAL (architect agent):** codex sub-agent spawns are **internally orchestrated codex threads/agents, NOT OS child-process fan-out**. So a ralph-side codex.exe **child-process-count guard is NOT a reliable collab-spawn detector**. The externally-visible collab surface is the codex session event/tool-plan stream (`spec_plan.rs`, `multi_agents_v2/*`), not OS process count. This matches the brainstorm's disconfirming observation. ⇒ D-003-as-child-count largely collapses; the only spawn-signal would require parsing codex transcript markers (much harder). **D-003 is documented as NON-VIABLE in its child-count form; the real fallback if the config knob fails is a codex fork patch (rung 3), not D-003.**

### (f) US-002 replay artifacts (Story 1 spike material)
- `.ralph/jobs/codex-ralph-member-multi-agent-adapter/` — the job whose **US-002 "Generator Third (Codex) Target + Dual Lowering"** exhibited the runaway under codex iteration.
- `ralph-run1.log` (637 KB) = the runaway codex run; `ralph-run2-copilot.log` / `ralph-run3-copilot.log` = recovery after switching to copilot.
- `prd.json` (US-001..US-006), `plan.md`, `worktree/` present. `AGENTS.md`, `spike-verdict.json` (that job's own D-003 result-retrieval spike — distinct from our runaway spike).

## Architect Analysis (explore agent)
- Iteration-only cap belongs threaded through `runEngineIteration` in ralph.mjs (:112-213); `--engine` only selects engine today (:270-318); no per-invocation collab knob threaded.
- If `codex exec -c` disable confirmed → thread only through `runEngineIteration` (clean mode separation).
- If NO knob → minimal fork patch: gate `add_collaboration_tools` at `spec_plan.rs:639` behind a config/env (e.g. a new `features.multi_agent_v2.disable_collab` bool or env check). Config surface at `config/mod.rs:188-191, 760-799`. Rebase-gated (codex 0.135 pin may shift on next intake).
- Confidence: medium-high on integration points; the spike must confirm the built-in CLI knob.
- Test infra: `node plugins/ralph/tests/run.mjs` (auto-discovery, `tests/run.mjs:1-37`). NOTE (memory): Git Bash must be first on PATH for the bash-stub tests.

## Codex Research Lens
**FAILED / orphaned.** The codex research lens (xhigh, 20-min timeout) ran ~8+ min, grew a 2.4 MB `.err` sidecar, spawned 3 pwsh + a 4-deep nested node chain under codex-core.exe, but never wrote its `-o` output; its async shell vanished and the subtree was left orphaned. Reclaimed manually (deepest-first Stop-Process) to stop the resource burn. Flagged to the lead per operator hung-lens rule. (Ironic given the task subject; the lens itself fanned out heavily.) First-hand codex-rs source reading substitutes and is more authoritative.

## Copilot Research Lens
Partial — produced only investigation narration (780 bytes; located the plugin, confirmed iterationEngine hard-defaults to codex and no codex feature/config args beyond reasoning effort are passed), no structured final brief. Non-blocking.

## Consolidated File List
**Files to modify (impl phase — ai-developer-toolkit/plugins/ralph, submodule):**
- `src/codex-exec.mjs` — add per-invocation collab-suppression flag (append `-c features.multi_agent=false` [+ belt: `-c features.enable_fanout=false`], OR cap variant).
- `src/ralph.mjs` — `runEngineIteration` passes the new flag ONLY for `engine === "codex"` iteration.
- `prompts/codex.md` — anti-spawn advisory guidance (do not spawn sub-agents during a single-story iteration).
- `schemas/prd-schema.json` — D-002 decision (default flip vs policy-only).
- Version stamps (×6) + `AGENTS.md` + `CHANGELOG.md`; regenerate `.copilot-plugin/` + `.codex-plugin/` via `generate-copilot-artifacts.mjs --target=all --write`.
- Tests under `tests/` (codex-exec argv assertion, runEngineIteration flag-passthrough + mode-separation, codex/copilot generator gates).

**codex submodule (ONLY if spike forces fork patch — rung 3, NOT expected):**
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:639` — gate `add_collaboration_tools`. + `// SANDBOX PATCH:` marker, patch-surface.md §14/§15 row (per codex CLAUDE.md core tenets).

**Spike (Story 1) reads:** `.ralph/jobs/codex-ralph-member-multi-agent-adapter/{prd.json,ralph-run1.log,worktree/}`; codex-rs `features/src/lib.rs`, `spec_plan.rs`.

## Open questions carried to planning
1. Exact `-c` syntax to disable v1 Collab on 0.135: `-c features.multi_agent=false` vs `--disable multi_agent` vs `=off` — spike confirms.
2. Does full-disable (`features.multi_agent=false`) actually suppress the v1 spawn tools, or does a Stable feature resist `-c` disable? (If resists → cap rung 2 → fork patch rung 3.)
3. Does `max_concurrent_threads_per_session=1` actually ENFORCE on the v1 (non-v2) SpawnAgentHandler at runtime? (cap-rung verification.)
4. D-002: flip schema default codex→copilot, or policy/docs-only? (Recommendation in plan: policy/docs-only, since D-001 lands same ship and makes codex iterations safe; flip regresses codex-member readiness + creates split-brain.)
5. Version-fragility: re-verify the knob/config surface on the next codex rebase (0.135 → ≥0.137).
6. Codex re-graduation criteria back to a supported iterationEngine (N clean stories, no spawn events).
