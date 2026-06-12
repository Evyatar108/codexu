# Research Brief

## Researcher Findings

- The settled investigation at `D:\harness-efforts\codexu\.ralph\investigations\codex-plugin-background-execution-terminology\findings.md` already nails the scope: five Codex-facing crews hook surfaces plus six generated Ralph Codex skill/internal-workflow mirrors need terminology fixes, and the recommended mechanism is engine-aware rendering rather than neutral phrasing.
- **Crews change surface:** `plugins/crews/hooks/pre-tool-use.js`, `plugins/crews/hooks/briefing/template.js`, `plugins/crews/hooks/briefing/continuation.js`, `plugins/crews/hooks/stop.js`, and `plugins/crews/hooks/protocol/review-gate.js`.
- **Crews test surface:** `plugins/crews/tests/copilot-briefing.test.js`, `plugins/crews/tests/engine-env-bootstrap.test.js`, `plugins/crews/tests/codex-bash-hook-alias.test.js`, `plugins/crews/tests/lib/briefing-assertions.js`, the golden briefing fixtures under `plugins/crews/tests/golden/`, and `plugins/crews/tests/version.test.js`.
- `plugins/crews/tests/lib/briefing-assertions.js` currently treats the non-Claude path as a single Copilot-shaped branch (`read_bash` plus `mode: "async"`), so Codex needs its own assertion path rather than being silently grouped with Copilot expectations.
- `plugins/crews/tests/codex-bash-hook-alias.test.js` already documents an important guardrail: Codex hook payloads still use the hook tool name alias `"Bash"` for shell detection, so this task should change **rendered model guidance**, not shell-tool detection semantics.
- **Ralph source surface:** `plugins/ralph/scripts/codex-lowering.mjs` and `plugins/ralph/scripts/generate-copilot-artifacts.mjs`.
- **Ralph generated Codex outputs to regenerate, not hand-edit:** `plugins/ralph/.codex-plugin/codex-skills/{plan-with-ralph,brainstorm-with-ralph,multi-model-investigate,implement-with-ralph}/SKILL.md` and `plugins/ralph/.codex-plugin/internal-workflows/{run-ralph,parallel-ralph}/SKILL.md`.
- `plugins/ralph/scripts/codex-lowering.mjs` already has strong Codex-native multi-agent recipe helpers (`whenToDelegateProse`, `detectAndBranchProse`, `operationalFindingsProse`, `v2SingleDelegationSteps`, `v1SingleDelegationSteps`), but its forbidden-token gate does not currently protect against the specific stale shell/background phrasing this task targets.
- `plugins/ralph/tests/test-codex-generator.mjs` is the natural place to add Codex-native wording assertions and stale-token regressions for generated `.codex-plugin/**` outputs.
- Release/versioning surfaces are plugin-local plus shared toolkit indexes:
  - crews: `plugins/crews/CHANGELOG.md`, `plugins/crews/AGENTS.md`, `plugins/crews/.claude-plugin/plugin.json`, `plugins/crews/.github/plugin/plugin.json`, `plugins/crews/.codex-plugin/plugin.json`, `plugins/crews/scripts/bump-version.js`
  - ralph: `plugins/ralph/CHANGELOG.md`, `plugins/ralph/AGENTS.md`, `plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.github/plugin/plugin.json`, `plugins/ralph/.codex-plugin/plugin.json`
  - shared indexes: `ai-developer-toolkit/.claude-plugin/marketplace.json`, `ai-developer-toolkit/.github/plugin/marketplace.json`, `ai-developer-toolkit/.agents/plugins/marketplace.json`

## Architect Analysis

- Recommended ship shape: **two serialized implementations, crews first and ralph second**, rather than one combined impl. The code surfaces are mostly disjoint, but both plugins need their own version bumps, changelog entries, AGENTS updates, and shared marketplace-index edits, so serializing the ships reduces cross-plugin release-file conflicts and creates a natural validation checkpoint after the load-bearing crews listener-arm fix.
- The highest-leverage sequencing is:
  1. crews Codex wording/rendering and tests
  2. live Codex dogfood of the listener-arm path
  3. ralph Codex lowering/generator updates and regenerated `.codex-plugin/**`
  4. ralph generator/parity validation and release-surface updates
- The plan should explicitly keep the **lead-owned** work out of impl scope: the toolkit submodule push choreography, codexu submodule-pointer bump, active-plugin-versions table update in `codexu/AGENTS.md`, and consumer `copilot plugin update` refresh.
- The safest story boundary is by plugin, with validation/release chores attached to the plugin they belong to rather than a combined cleanup story. That keeps each serialized ship independently reviewable and rebaseable.

## Codex Research

- Failed to produce a usable artifact within the planning window. Proceed using the settled investigation plus local/agent research; no Codex-specific contradiction surfaced elsewhere that blocks planning.

## Copilot Research

- Copilot confirmed the same two-plugin architecture and sharpened the likely test/generator seams:
  - crews: `plugins/crews/tests/pretooluse-review-mail-first.test.js`, `plugins/crews/tests/review-gate.test.js`, `plugins/crews/tests/copilot-briefing.test.js`, `plugins/crews/tests/engine-env-bootstrap.test.js`
  - ralph: `plugins/ralph/scripts/codex-lowering.mjs:30-39` (`CODEX_FORBIDDEN`), `plugins/ralph/scripts/codex-lowering.mjs:764-784` (`PROSE_SITE_INVENTORY`), and `plugins/ralph/scripts/generate-copilot-artifacts.mjs`
- It also reinforced two constraints worth keeping in the final plan:
  - do **not** widen crews shell-tool detection based on Codex model-facing `exec_command` / `shell` names; the `"Bash"` hook alias remains correct and pinned by `plugins/crews/tests/codex-bash-hook-alias.test.js`
  - Ralph should fix shell-background prose at the lowering/generator seam and regenerate `.codex-plugin/**`, not hand-edit generated mirrors
- Copilot's implementation-shape suggestion was looser than the architecture pass: it said a single member/branch touching both plugins is technically possible as long as the work stays internally serialized. The final plan still prefers **two serialized ships** because that creates a cleaner dogfood checkpoint and reduces version/index churn per branch.

## Consolidated File List

### Files to modify

- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\crews\hooks\pre-tool-use.js`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\crews\hooks\briefing\template.js`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\crews\hooks\briefing\continuation.js`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\crews\hooks\stop.js`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\crews\hooks\protocol\review-gate.js`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\scripts\generate-copilot-artifacts.mjs`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\scripts\codex-lowering.mjs`

### Generated artifacts to regenerate

- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\.codex-plugin\codex-skills\plan-with-ralph\SKILL.md`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\.codex-plugin\codex-skills\brainstorm-with-ralph\SKILL.md`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\.codex-plugin\codex-skills\multi-model-investigate\SKILL.md`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\.codex-plugin\codex-skills\implement-with-ralph\SKILL.md`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\.codex-plugin\internal-workflows\run-ralph\SKILL.md`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\.codex-plugin\internal-workflows\parallel-ralph\SKILL.md`

### Test files

- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\crews\tests\copilot-briefing.test.js`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\crews\tests\engine-env-bootstrap.test.js`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\crews\tests\codex-bash-hook-alias.test.js`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\crews\tests\lib\briefing-assertions.js`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\crews\tests\version.test.js`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\tests\test-codex-generator.mjs`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\tests\test-codex-live-smoke.mjs`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\tests\test-no-stale-sh-refs.mjs`
- `D:\harness-efforts\codexu\ai-developer-toolkit\plugins\ralph\tests\test-ralph.mjs`

### Release/config files

- `D:\harness-efforts\codexu\ai-developer-toolkit\.claude-plugin\marketplace.json`
- `D:\harness-efforts\codexu\ai-developer-toolkit\.github\plugin\marketplace.json`
- `D:\harness-efforts\codexu\ai-developer-toolkit\.agents\plugins\marketplace.json`
- `D:\harness-efforts\codexu\AGENTS.md`
