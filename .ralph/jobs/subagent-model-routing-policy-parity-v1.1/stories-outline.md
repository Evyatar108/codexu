# Stories Outline: Subagent Model Routing Policy Parity v1.1

*Preliminary decomposition from `/plan-with-ralph`. Execute serially in one `ai-developer-toolkit` implementation job.*

## US-001: Canonical v1.1 route taxonomy and shared guidance

**Description:** As an agent parent, I want one explicit policy for classifying
the actual work delegated to a child so that every ordinary child receives the
operator-approved model and effort without changing the parent session.

**UI/UX judgment:** not-required

**Acceptance Criteria:**

- [ ] `hooks/model-routing-policy.js` defines explicit category coverage for
  exploration, repository detection, planning, research, non-UI review,
  orchestration, non-UI implementation, code fixing, docs updating,
  refactoring, and UI implementation/design/review requiring UI/UX judgment.
- [ ] Exploration/repository detection maps to `gpt-5.6-luna` `medium`.
- [ ] Planning/research/non-UI review/orchestration maps to `gpt-5.6-sol`
  `xhigh`.
- [ ] Non-UI implementation/code fixing/docs updating/refactoring maps to
  `gpt-5.6-sol` `medium`.
- [ ] UI implementation/design/review requiring UI/UX judgment maps to
  `claude-opus-4.8` `high`.
- [ ] Shared guidance explicitly excludes parent-session model selection.
- [ ] Shared guidance routes by actual delegated work and includes the
  web/mobile/desktop/TUI acceptance-surface caveat.
- [ ] Unsupported named models are surfaced rather than silently substituted.

**Dependencies:** None

**Estimated complexity:** medium

## US-002: Engine adapter parity and fail-open contract

**Description:** As a Copilot or Codex user, I want engine-native SessionStart
guidance that carries identical routing semantics without making an advisory
plugin a session-start failure point.

**UI/UX judgment:** not-required

**Acceptance Criteria:**

- [ ] Copilot output remains `{additionalContext: rules}`.
- [ ] Codex output remains the `SessionStart` `hookSpecificOutput` envelope.
- [ ] Both engine outputs are composed from one byte-identical normative
  policy body.
- [ ] Copilot guidance names the supported task-call model/effort arguments.
- [ ] Codex guidance preserves v2 `fork_turns: "none"`, v1 omitted/false
  `fork_context`, full-history rejection, and role-override warnings.
- [ ] Empty, malformed, array, null, and unexpected invalid stdin returns
  `{}`, exit code 0, and empty stderr for both hooks.
- [ ] A valid object with unknown fields still emits the full guidance.
- [ ] Hook adapters add no classifier, dependency, persistent state, network
  access, or cross-plugin call.

**Dependencies:** US-001

**Estimated complexity:** small

## US-003: Exact snapshots, category matrix, parity, and independence gates

**Description:** As a maintainer, I want exact contract tests so route wording,
engine parity, release metadata, and standalone boundaries cannot drift
silently.

**UI/UX judgment:** not-required

**Acceptance Criteria:**

- [ ] Authored Copilot and Codex guidance fixtures exist under
  `tests/fixtures/`.
- [ ] The hook output matches each fixture byte-for-byte.
- [ ] Tests assert every explicit category alias and exact model/effort.
- [ ] Tests assert the parent-session boundary, actual-work rule, UI override,
  and acceptance-surface caveat.
- [ ] Tests assert cross-engine normative-body identity.
- [ ] Existing malformed-input process coverage is preserved and expanded.
- [ ] Root `.gitattributes` pins
  `plugins/subagent-model-routing/tests/fixtures/*.txt` to LF, and the
  snapshot comparison performs no line-ending normalization.
- [ ] A recursive plugin-local guard rejects the forbidden cross-plugin token
  without importing, executing, or scanning that other plugin and without a
  literal self-exemption in the guard source.
- [ ] Tests assert that the two engine manifests and all three marketplace
  entries carry one identical version value.
- [ ] `node plugins/subagent-model-routing/tests/session-start.test.js` passes.

**Dependencies:** US-001, US-002

**Estimated complexity:** medium

## US-004: Documentation, dogfood, and confusion-point guidance

**Description:** As an operator or future maintainer, I want the plugin's
scope, route semantics, authored boundaries, install proof, and rollback
procedure documented close to the code.

**UI/UX judgment:** not-required

**Acceptance Criteria:**

- [ ] `README.md` documents the final route table, parent-session exclusion,
  actual-work classification, acceptance-surface caveat, engine syntax,
  fail-open behavior, tests, install/update, and rollback.
- [ ] Plugin `AGENTS.md` records v1.1.0 invariants, authored/generated
  boundaries, five-stamp release discipline, and confusion points.
- [ ] `CHANGELOG.md` records v1.1.0 and the v1.0.0 baseline.
- [ ] `docs/installed-dogfood.md` requires structured Copilot/Codex child-call
  evidence and separate proof that the parent model did not change.
- [ ] The dogfood guide covers plugin refresh, fresh-session requirements,
  Codex marketplace caching, v1/v2 fork settings, role overrides, and evidence
  storage.
- [ ] The directly related root `AGENTS.md` plugin bullet is updated.
- [ ] Root `AGENTS.md` contains a narrow plugin-specific exception documenting
  the manual five-stamp path, the absence of a Claude manifest, and that the
  generic release skill must not be used for this plugin.
- [ ] Documentation contains no forbidden cross-plugin reference.

**Dependencies:** US-001, US-003

**Estimated complexity:** medium

## US-005: v1.1.0 metadata and release readiness

**Description:** As a marketplace operator, I want every real version surface
and release check updated atomically so Copilot and Codex consumers can install
and verify v1.1.0 reliably.

**UI/UX judgment:** not-required

**Acceptance Criteria:**

- [ ] `.github/plugin/plugin.json` is `1.1.0`.
- [ ] `.codex-plugin/plugin.json` is `1.1.0`.
- [ ] `.claude-plugin/marketplace.json`,
  `.github/plugin/marketplace.json`, and
  `.agents/plugins/marketplace.json` entries are `1.1.0`.
- [ ] The test's final expected version is `1.1.0`, and the complete plugin
  suite passes after all five stamps are updated.
- [ ] No metadata-only `.claude-plugin/plugin.json` is added.
- [ ] Marketplace descriptions are updated surgically without unrelated
  formatting churn.
- [ ] `node tools/validate-codex-marketplace-policy.mjs
  .agents/plugins/marketplace.json .claude-plugin/marketplace.json
  .github/plugin/marketplace.json` passes.
- [ ] `git diff --check` passes.
- [ ] Release handoff names the toolkit multi-remote verification, codexu
  submodule pointer bump, installed-plugin dogfood, and forward-only rollback
  release.

**Dependencies:** US-003, US-004

**Estimated complexity:** small
