# Research Brief: codex-member native spawn subagents (D-002, dual v1+v2)

All source lives in the `ai-developer-toolkit` submodule under
`plugins/ralph/` (paths below are relative to that submodule root). Ralph
version is currently **5.55.0**.

## Researcher Findings (exact line numbers)

### `scripts/codex-lowering.mjs`
- `CODEX_FORBIDDEN` / `assertNoCodexForbidden` — 18-39 (forbids the literal
  token `Agent(`, NOT bare `Agent`; also `Skill(`, `task(agent_type=`, etc.).
- `AGENT_SITE_INVENTORY` — 41-81 (declares every literal `Agent(` site +
  shape; the drift guard is keyed to this).
- `captureAgentBlocks` — 83-120 (balanced-paren scanner for `Agent(`).
- `groupAgentBlocks` — 144-169 (fence adjacency ⇒ fan-out vs single-delegation).
- `whenToDelegateProse` — 190-220.
- `preflightProse` — **222-234** (the v2-REQUIRED STOP to be replaced with
  detect-and-branch).
- `operationalFindingsProse` — 236-259.
- `singleDelegationRecipe` — 273-315; the **schema-stale** `spawn_agent`
  emission is **288-296** (`spawn_agent { task_name, fork_turns }` then a
  separate `followup_task { task }` — OMITS the v2-required `message`).
- `fanOutRecipe` — 317-368; fan-out spawn emission at **331-339**.
- `captureSkillBlocks` 405-436, `lowerSkillBlocks` 438-450,
  `renderCodexSkillDispatch` 452-463, `CODEX_SUBSTITUTIONS` 465-480,
  `applyCodexSubstitutions` 482-493, `verifyAgentSiteInventory` 495-560.

### `scripts/generate-copilot-artifacts.mjs`
- import lowering helpers — 10; `AGENT_SOURCES` 36; `INTERNAL_WORKFLOWS` 37;
  `USER_SKILLS` 39.
- Copilot `expectedOutputs()` 246-261; `renderSkillDispatch` 183-190;
  `renderAgentDispatch` 192-197 (`Agent(` → `task(agent_type=...)`);
  `SUBSTITUTIONS` 199-218.
- `expectedCodexOutputs()` + `codexUserSkills` 279-313; `verifyAgentSiteInventory`
  wired at 295; `applyCodexSubstitutions` + `assertNoCodexForbidden` at 303-310.
- codex non-vacuous `--check` 344-364; codex `--write` 374-380; `--target`
  parse 383-404; `main()` 406-412.
- implement-with-ralph is **generated for codex, hand-forked for Copilot**
  (comments 272-278, 281-287; `parity-exceptions.json` noted).

### The PROSE-ONLY spawn sites (the gap — uninventoried, never lowered)
- `skills/implement-with-ralph/SKILL.md` Phase 2 PRD-gen — **273-280**, esp.
  **line 277** "Spawn an Agent subagent to generate the PRD." The site reads
  the `create-prd` then `convert-to-ralph-prd` skills. **No literal `Agent(`**
  at 277-280. (This is the root cause of hand-scaffolded `prd.json`.)
- `skills/review-changes/SKILL.md` Step 2 reviewer — **113-129**; scope→agent
  table **117-121** (code→`code-reviewer`, docs→`docs-reviewer`,
  security→`security-reviewer` [Phase-5c-disabled]); "Spawn an Agent subagent
  using the selected agent definition" at **line 123**. `rg "Agent\("` on this
  file returns **ZERO matches** — fully prose.

### Already-inventoried literal `Agent(` sites (need the message-fix + dual-branch
via the shared recipe builder; no new inventory work)
- `convert-to-ralph-prd`: `Explore` (repo-detector), `criteria-validator`
  (inventory 69-70).
- `implement-with-ralph`: `criteria-validator`, `code-fixer`, `docs-updater`,
  Phase-5.5 fan-out `dsat-analyst`/`skill-suggester`/`followup-task-gatherer`
  ×2 modes (inventory 71-79).
- `brainstorm-with-ralph`: `general-purpose` devil's-advocate (inventory 80).

### Tests — `tests/test-codex-generator.mjs`
- single-delegation operational-findings 64-83; fan-out 85-107; FORBIDDEN
  109-114; inventory drift 116-134; shape flip 136-158; substitutions 160-179;
  generated-artifact recipe markers 181-198; US-003 trigger guidance 200-225;
  **US-003 v1/v2 preflight STOP 227-251** (currently pins the v2-required STOP —
  MUST be updated to assert the dual-branch); FORBIDDEN across artifacts 253-278;
  inventory-matches-source 280-304; US-004 plugin.json 306-340; US-005 non-vacuous
  --check 342-393; **US-005 full spawn→followup→wait→list→close sequence 395-452**
  (pins current v2 sequence — update to dual v1/v2 + message); drift guard 454-483;
  marketplace discovery 485-509.
- `tests/test-codex-live-smoke.mjs` — opt-in double-gated; loads the GENERATED
  codex implement-with-ralph SKILL.md + extracts the recipe block.

### Version stamps (SIX) + marketplace (THREE) + gates
- Stamps: `plugins/ralph/.claude-plugin/plugin.json`,
  `plugins/ralph/.github/plugin/plugin.json`,
  `plugins/ralph/.codex-plugin/plugin.json`, and the three indexes
  `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`,
  `.agents/plugins/marketplace.json` — all at 5.55.0.
- Codex Release Gate (`plugins/ralph/AGENTS.md` 16-23):
  `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=codex --check
  && node plugins/ralph/tests/test-codex-generator.mjs
  && node tools/validate-codex-marketplace-policy.mjs`.

## Architect Analysis (key points)
- `codex-lowering.mjs` is a **markdown rewriter**; the recipe is PROSE injected
  into the generated SKILL.md that a codex MEMBER reads + self-executes at
  runtime. There is NO JS calling `spawn_agent`; the member's model does,
  guided by the recipe prose. So "native spawn" = emitting correct recipe prose.
- Injection points for the dual-branch: `preflightProse`/`operationalFindingsProse`
  (shared) and the two emitters `singleDelegationRecipe`/`fanOutRecipe`.
- **Schema-stale fix (recommended):** pass the subagent task in
  `spawn_agent.message` and DROP `followup_task` as the initial-task carrier
  (matches the v2 smoke recommendation; keeps the recipe usable on v1 which has
  no `followup_task`).
- Disjoint-write-set rule: sequential fixer/updater/reviewer sites are trivially
  safe; the Phase-5.5 fan-out trio is read-only retrospective work.
- `features.multi_agent_v2` enablement is coordination-only; dual-support means
  a default-config (v1) member already works.
- Riskiest stories: the prose-site lowering (silent-break if anchors drift).

## Copilot Research (xhigh) — converges with architect
- **Recommends a codex-only prose-site lowering** "keyed by stable site IDs and
  anchored text" + a parallel prose-site drift guard, rather than converting the
  prose to literal `Agent(` in shared source.
- "Extend `codex-lowering.mjs` rather than adding a separate helper. Add a
  generic native-spawn recipe builder supporting single-delegation + fan-out,
  emitting two runtime branches":
  - v2: `spawn_agent{task_name, message}` → `wait_agent{timeout_ms}` →
    `list_agents` → `agents[].agent_status.completed` → JSON-validate → `close_agent`.
  - v1: `spawn_agent{message}` → `wait_agent{targets:[agent_id], timeout_ms}` →
    `status[target].completed` → JSON-validate → `close_agent`.
- Add prose-site lowering BEFORE the forbidden-token check, with explicit
  entries for (1) Phase-2 PRD-gen (prompt carries plan path + create-prd +
  convert-to-ralph-prd + autonomous flags + `--job`/engines/`--target-repo`) and
  (2) review-changes Step 2 reviewer, scope-conditioned code-reviewer/docs-reviewer.
- Tests must assert: generated codex artifacts NO LONGER contain the prose-only
  "Spawn an Agent subagent" instructions; every recipe includes `message`; v2 no
  longer depends on `followup_task` as task carrier; v1 does not mention
  `list_agents`; the new prose inventory FAILS on anchor drift.
- **Key correctness win of option (b):** because shared source SKILL.md is
  UNCHANGED, the Claude source + Copilot generated/hand-fork artifacts are
  byte-identical → no Copilot parity churn; ONLY `.codex-plugin` changes.

## Codex Research
Not run — codex-exec returned empty output (0 bytes). Non-blocking per skill
contract (external research is additive); the codex review lens is retried in
Phase 4.

## Consolidated File List
**Files to modify (impl phase):**
- `plugins/ralph/scripts/codex-lowering.mjs` — recipe builder (dual v1/v2 +
  message), replace `preflightProse` STOP with detect-and-branch, new prose-site
  inventory + lowering + drift guard, wire into `applyCodexSubstitutions`.
- `plugins/ralph/scripts/generate-copilot-artifacts.mjs` — call prose-site verify
  alongside `verifyAgentSiteInventory`.
- `plugins/ralph/tests/test-codex-generator.mjs` — dual v1/v2 + message + prose-site
  + drift-guard assertions; update the two tests that pin the current v2-required
  STOP / v2 sequence.
- `plugins/ralph/.codex-plugin/**` — regenerated artifacts (generated, not hand).
- Six version stamps + three marketplace indexes + `plugins/ralph/CHANGELOG.md`
  + `plugins/ralph/AGENTS.md` behavioral note.
**Source NOT modified (option b):** the shared `skills/*/SKILL.md` prose stays
intact (anchors only), so Claude + Copilot artifacts are untouched.
**Dependencies/agents (read-only context):** `agents/code-reviewer.md`,
`agents/docs-reviewer.md`, `agents/code-fixer.md`, `agents/docs-updater.md`,
`agents/criteria-validator.md`, `prompts/repo-detector.md`.
**Smoke findings (already GO — do not re-run):**
`.ralph/investigations/codex-spawn-agent-write-child-smoke/findings.md` (v2 @
69de6def), `.ralph/investigations/codex-v1-vs-v2-subagent-dual-support/findings.md`
(v1 @ 9beb869a).
