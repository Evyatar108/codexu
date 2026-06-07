# Research Brief — codex-ralph-member-multi-agent-adapter (D-001)

Seeded from brainstorm: `.ralph/brainstorms/codex-ralph-member-multi-agent-adapter/selected-direction.md`

## Researcher Findings (Explore agent + direct read of the seam)

### The generator seam — `ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs`
- `:33` `FORBIDDEN` = `['Skill(', 'Agent(', 'BashOutput', 'run_in_background', '<options-mode>', '--add-dir', 'mcp__']` — asserted post-substitution by `assertNoForbidden` (`:218-222`). A generated artifact still containing `Agent(` throws.
- `:34` `AGENT_SOURCES` (13 agent defs, emitted verbatim as `.agent.yaml`).
- `:35` `INTERNAL_WORKFLOWS` (9 skills, substituted).
- `:37` `USER_SKILLS` = `['brainstorm-with-ralph','plan-with-ralph','multi-model-investigate','prepare-handoff']` (substituted).
- `:142-165` `renderAgentYaml()` — agent bodies emit **verbatim** (load-bearing invariant: engine-specific tool refs in agent source must be authored engine-neutral; substitution is for SKILL.md only).
- `:197-216` `SUBSTITUTIONS` (ordered regex list). Key entries:
  - `:198` `skill-dispatch`: `Skill("ralph-orchestration:X", args="...")` → `task(agent_type="general-purpose", ...)`.
  - `:199` `agent-dispatch`: `Agent(subagent_type="X", ...)` → `task(agent_type="x", description=..., `. **Single-line, near-isomorphic token rewrite.**
  - `:200` `spawn-agent-prose`, `:201` `spawn-selected-agent-prose` — prose rewrites of "Spawn an Agent subagent…".
- `:224-228` `applySubstitutions()` = apply all rules in order, then `assertNoForbidden`.
- `:244-259` `expectedOutputs(repoRoot)` — the fan-out site. Loops `AGENT_SOURCES` → `.copilot-plugin/agents/*.agent.yaml`; `INTERNAL_WORKFLOWS` → `.copilot-plugin/internal-workflows/*/SKILL.md`; `USER_SKILLS` → `.copilot-plugin/copilot-skills/*/SKILL.md`.
- `:262-291` `check()` (drift; **vacuous pass if `.copilot-plugin` absent**, `:263-267`) vs `write()` (mkdir + write).
- `repoRoot = process.cwd()` (`:295`) — generator is run from `ai-developer-toolkit/` repo root.

### The parity checker — `ai-developer-toolkit/plugins/ralph/scripts/check-copilot-parity.mjs`
- Compares hand-forked `implement-with-ralph` source vs its `.copilot-plugin` mirror; anchors via `<!-- src: skills/.../SKILL.md#... -->`; asserts declared Copilot-only sections; **assertion E forbids Claude-only tokens** in generated files; scans for stale `.sh` refs.
- `.copilot-plugin/parity-exceptions.json` exists (declares allowed hand-fork divergences).
- **Implication:** the parity/`--check` layer is purely string/token-level — it cannot validate that a codex recipe is *semantically* correct. Behavioral validation is required (this is the D-003 spike's whole point and the DA's disconfirming observation).

### Fan-out sites (where one `Agent()` multi-lens fan-out lives)
Confirmed small set of Agent-tool fan-out sites in canonical Claude sources:
- `skills/brainstorm-with-ralph/SKILL.md:113-159` (Phase 2; "same message" parallel; `Agent(...)` at `:122-126`).
- `skills/implement-with-ralph/SKILL.md:1215-1258` (Phase 5.5; `Agent()` triple — dsat-analyst/skill-suggester/followup-task-gatherer).
- `skills/plan-with-ralph/SKILL.md` (Phase 2 researcher+architect; Phase 4 reviewer) — parallel Agent spawns.
- `skills/multi-model-investigate/SKILL.md:85-117` is **CLI** fan-out (codex-exec + copilot-exec), NOT Agent-tool — already engine-portable; not a target.
- **Count:** a handful of distinct Agent-tool fan-out sites → enough that hand-authored codex copies (D-005) drift, but few enough that per-target lowering (D-001) is viable without the full engine-neutral macro (D-002).

### Version-stamp surfaces (confirmed current = 5.51.0)
- `plugins/ralph/.claude-plugin/plugin.json` → `5.51.0`
- `plugins/ralph/.github/plugin/plugin.json` → `5.51.0`
- `.claude-plugin/marketplace.json` (`:139-151`), `.github/plugin/marketplace.json` (`:139-151`), `.agents/plugins/marketplace.json` (`:139-151`)
- `plugins/ralph/CHANGELOG.md` (prepend), `plugins/ralph/AGENTS.md` (behavioral additions block)
- Codexu-side: `D:\harness-efforts\codexu\AGENTS.md:20-28` active-plugin-versions table (ralph pinned `5.51.0`).
- Bump target: **5.52.0** (minor — new generated harness surface + behavior change, not breaking).

### Codex discovery / manifest
- **No `.codex-plugin/` directory exists** anywhere in `ai-developer-toolkit` (glob returned none).
- Codex discovers plugins via the repo-local marketplace index `ai-developer-toolkit/.agents/plugins/marketplace.json` (which carries `policy.{installation,authentication}` enums validated by `tools/validate-codex-marketplace-policy.mjs`).
- A codex skill *target* would need a NEW convention/dir + a discovery story (how codex actually loads ralph skill artifacts is an open question to resolve in the generator/discovery story).

### Tests
- `plugins/ralph/tests/run.mjs` auto-discovers `test-*.mjs`; existing generator tests are bash (`test-copilot-generator.sh`, `test-copilot-nested-task.sh`) requiring Git Bash on Windows. A codex-target test should follow the `node:test` pattern where possible for cross-platform coverage, plus a behavioral shape assertion (not just token drift).

## Architect Analysis (Explore agent)
- **Hook point** = `expectedOutputs()` (`:244-259`); add a 4th/codex target there.
- **Do NOT** reuse the single-line `agent-dispatch` regex for codex — the codex shape is non-isomorphic (`spawn_agent`→`followup_task`→`wait_agent`→collect→validate→`close_agent`). Use a **dedicated codex lowering function** (templated/marker-based block expansion), distinct from `SUBSTITUTIONS`.
- **D-003 spike** (Story 1 / go-no-go): enable `features.multi_agent_v2=true` for one codex 0.135 member (audit two plumbing paths: `buildThreadConfig()` in `packages/happy-cli/src/codex/codexAppServerClient.ts` vs `~/.codex/config.toml`). Spawn 2-3 children each required to emit JSON; `followup_task`; `wait_agent`; recover each child's FULL final answer using ONLY model-visible tools (`list_agents` + message stream); validate JSON; force ≥1 timeout → fail-hard/mark-missing; `close_agent`. PASS = full child answers recoverable model-side. FAIL = build-time prompt layer is wrong → pivot/defer.
- **Pivot path** if FAIL: runtime bridge collecting via app-server/event-stream joined by task-path (touches codex app-server client / orchestration glue, not just the generator), OR defer.

## Codex Research
Not available: the codex-exec xhigh research process produced no output (its attached async shell was terminated by a session-lifecycle event mid-run). Not re-run — the seam, parity checker, fan-out inventory, version surfaces, and the two prior investigations already provide ample grounding, and the skill's research-error policy is "never block on research."

## Consolidated File List

### Files to create (during implementation, contingent on spike GO)
- `ai-developer-toolkit/plugins/ralph/.ralph/jobs/<spike>/…` spike artifacts (disposable; or a throwaway probe script + `spike-verdict.json`).
- New codex-target output tree (dir convention TBD by discovery story), e.g. `ai-developer-toolkit/plugins/ralph/.codex-plugin/…`.
- A codex lowering helper (e.g. `scripts/` module or a function block inside the generator) + a codex `--check`/parity surface.
- A codex-target test under `plugins/ralph/tests/`.

### Files to modify (contingent on spike GO)
- `ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs` (add codex target to `expectedOutputs()` + lowering fn).
- `ai-developer-toolkit/plugins/ralph/scripts/check-copilot-parity.mjs` (or a new codex-parity script) for codex drift/forbidden-token coverage.
- Canonical fan-out skill sources IF a marker approach is chosen (must stay runnable as plain Claude markdown).
- Five version stamps + `CHANGELOG.md` + `plugins/ralph/AGENTS.md` + codexu `AGENTS.md` active-plugin-versions table.

### Authoritative grounding docs (read; do not re-derive)
- `.ralph/investigations/codex-upstream-multi-agent-v2-fork-impact/findings.md` (§1 v2 tool surface; §5 degradation root cause = tool-name/schema mismatch not spawn gap; §7 async/result-collection gotcha).
- `.ralph/investigations/codex-subagent-prompt-trigger-investigation/findings.md` (under-prompting: v1 gates spawn to explicit user request; v2 silent).
- `.ralph/brainstorms/codex-ralph-member-multi-agent-adapter/{selected-direction.md,brainstorm-synthesis.md}`.
