# Stories Outline: Codex background-execution terminology for crews and Ralph

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Render Codex-native crews listener guidance
**Description:** As a Codex crews member, I want listener/briefing/review-gate guidance to describe Codex-native exec/yield/session behavior so I follow the correct shell contract.
**Acceptance Criteria:**
- [ ] `plugins/crews/hooks/pre-tool-use.js`, `hooks/briefing/template.js`, `hooks/briefing/continuation.js`, `hooks/stop.js`, and `hooks/protocol/review-gate.js` render Codex-native shell/session terminology.
- [ ] The Codex wording uses `exec_command`, `yield_time_ms`, `session_id`, and `write_stdin` where appropriate.
- [ ] The Codex wording does not mention `mode: "async"`, `run_in_background`, `read_bash`, or `read_powershell`.
- [ ] Claude and Copilot wording on the same surfaces remains intentionally unchanged.
- [ ] Typecheck/tests for the touched plugin surface pass.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Lock crews coverage and plugin release surfaces
**Description:** As the crews maintainer, I want Codex-specific tests and release-surface updates so the new wording stays pinned and ships coherently.
**Acceptance Criteria:**
- [ ] Crews tests/helpers/golden coverage explicitly exercise the Codex wording branch (`briefing-render`, `continuation-briefing`, `review-gate`, `pretooluse-review-mail-first`, `copilot-briefing`, `engine-env-bootstrap`, and any shared helper updates).
- [ ] `codex-bash-hook-alias.test.js` remains valid and continues to pin the non-goal that hook detection still uses the `"Bash"` alias.
- [ ] Claude-default goldens remain stable unless a deliberate Codex-specific fixture split is introduced.
- [ ] Crews changelog, AGENTS notes, version manifests, and shared marketplace indexes are updated together for the ship.
- [ ] A live Codex dogfood of the listener-arm path is captured as a required validation step before merged.
- [ ] Typecheck/tests for the touched plugin surface pass.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Teach Ralph's Codex generator the native background terminology
**Description:** As a Codex Ralph member, I want generated Codex skills and internal workflows to describe long-running shell work and multi-agent orchestration in native Codex terms so generated instructions map to real Codex capabilities.
**Acceptance Criteria:**
- [ ] `plugins/ralph/scripts/codex-lowering.mjs` and `generate-copilot-artifacts.mjs` emit Codex-native shell wording for the affected skills/workflows.
- [ ] The change preserves the existing Codex-native multi-agent recipe machinery.
- [ ] The stale terminology gap is covered by a primary invariant (forbidden-token expansion, generated-artifact assertions, or both) so `background: true`-style leakage cannot silently recur.
- [ ] Generated `.codex-plugin/**` mirrors are never hand-edited; they are regenerated from source.
- [ ] Typecheck/tests for the touched plugin surface pass.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: Regenerate Ralph Codex mirrors and lock the release gates
**Description:** As the Ralph maintainer, I want regenerated `.codex-plugin/**` artifacts and updated tests/release surfaces so the new Codex wording is durable and shippable.
**Acceptance Criteria:**
- [ ] The affected `.codex-plugin/codex-skills/**` and `.codex-plugin/internal-workflows/**` mirrors are regenerated from source.
- [ ] `test-codex-generator.mjs` asserts positive Codex-native markers and negative stale-token absence for the affected generated artifacts.
- [ ] The documented Ralph Codex release gate remains green: `generate-copilot-artifacts.mjs --target=codex --check`, `test-codex-generator.mjs`, and `validate-codex-marketplace-policy.mjs`.
- [ ] Ralph changelog, AGENTS notes, version manifests, and shared marketplace indexes are updated together for the ship.
- [ ] Typecheck/tests for the touched plugin surface pass.
**Dependencies:** US-003
**Estimated complexity:** medium
