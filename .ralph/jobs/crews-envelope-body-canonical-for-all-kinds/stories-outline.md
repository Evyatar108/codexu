# Stories Outline: crews body-canonical enforcement for review-surfacing kind tags

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Add `detectLazySummary` helper + canonical constants
**Description:** As a crews-plugin maintainer, I want a pure helper that detects "lazy summary" envelopes (long summary, short body, review-surfacing kind) so the Stop hook can hard-block them.
**Acceptance Criteria:**
- [ ] `hooks/protocol/report-tags.js` exports `detectLazySummary(tags, opts)`, `BODY_CANONICAL_KINDS` (frozen `['done', 'question', 'blocked']`), and `DEFAULT_BODY_CANONICAL_THRESHOLDS` (`{ summaryLimit: 200, bodyFloor: 50 }`).
- [ ] `detectLazySummary` returns `null` when not triggered, or `{ summaryLen, bodyLen, threshold }` when triggered (summary > summaryLimit AND body < bodyFloor AND kind in BODY_CANONICAL_KINDS).
- [ ] `kind=progress` always returns `null` regardless of thresholds.
- [ ] Opts merge with defaults; missing opts use DEFAULT_BODY_CANONICAL_THRESHOLDS.
- [ ] Unit tests in `tests/protocol-report-tags.test.js` cover threshold boundaries (at-limit, ±1 char, kind-exempt, opts-override).
- [ ] Typecheck/lint passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Wire the body-canonical gate into `hooks/stop.js`
**Description:** As a crews-plugin maintainer, I want the Stop hook to hard-block lazy-summary envelopes for `done`/`question`/`blocked` kinds while exempting `progress` and allowing a retry safety-valve.
**Acceptance Criteria:**
- [ ] `hooks/stop.js` directly requires `{ detectLazySummary, BODY_CANONICAL_KINDS, DEFAULT_BODY_CANONICAL_THRESHOLDS }` from `./protocol/report-tags`.
- [ ] Gate placed AFTER missing-kind block AND consumed-inbox eval; BEFORE `decideStopBlock()` listener-arm gate.
- [ ] Env vars: `CREWS_BODY_CANONICAL` (set to `off` to disable), `CREWS_BODY_CANONICAL_SUMMARY_CAP` (numeric override), `CREWS_BODY_CANONICAL_BODY_FLOOR` (numeric override).
- [ ] On detection AND `data.stop_hook_active !== true`: call `bumpBlockCount(state.name, crew, cwd, state.role, 'body not canonical')`; call `appendLog` with literal marker `body-canonical: block ...`; write `{ decision: 'block', reason: <actionable> }` to stdout; return.
- [ ] On detection AND `data.stop_hook_active === true`: call `appendLog` with literal marker `body-canonical: bypassed-on-retry ...`; do NOT block; fall through.
- [ ] Block reason text instructs member to move content from `summary` into prose above the tag and includes a brief example.
- [ ] No outbox row written when blocked.
- [ ] Typecheck/lint passes.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-002b: Extend `runStop` test harness for `stop_hook_active`
**Description:** As a test author, I want `runStop` to accept an optional `stopHookActive` flag so retry-path fixtures can exercise the safety-valve branch.
**Acceptance Criteria:**
- [ ] `tests/lib/force-response.js::runStop` accepts an optional parameter (named or positional after existing ones) that, when truthy, sets `stop_hook_active: true` in the Stop hook JSON input.
- [ ] Default behavior unchanged when the parameter is omitted; existing call sites unaffected.
- [ ] Typecheck/lint passes.
**Dependencies:** None (parallel-safe to US-002)
**Estimated complexity:** small

## US-003: Integration tests in new `tests/stop-body-canonical.test.js`
**Description:** As a crews-plugin maintainer, I want exhaustive fixtures verifying the body-canonical gate fires when (and only when) intended.
**Acceptance Criteria:**
- [ ] New file `tests/stop-body-canonical.test.js` exists with fixtures A, A2, B, C, D, D2, E, F as documented in plan.md AC#7.
- [ ] All fixtures pass `messages: []` to `setupForceResponse` so consumed-inbox/strict-ack gates don't pre-empt.
- [ ] Fixture A (summary=600, body=45, kind=question) → blocks; outbox empty.
- [ ] Fixture A2 (boundary 201/49, 200/49, 201/50) → first blocks, others allow.
- [ ] Fixture B (summary=250, body=300, kind=done) → allows.
- [ ] Fixture C (summary=20, body=10, kind=done) → allows.
- [ ] Fixture D (summary=400, body=5, kind=progress) → allows.
- [ ] Fixture D2 (same as D + adversarial thresholds env) → allows (progress exemption unconditional).
- [ ] Fixture E (summary=300, body=20, kind=blocked, then retry via `stopHookActive=true`) → first blocks; second allows; crews.log has both `body-canonical: block` and `body-canonical: bypassed-on-retry` lines.
- [ ] Fixture F (summary=300, body=20, kind=question, `CREWS_BODY_CANONICAL=off`) → allows; no `body-canonical` lines in crews.log.
- [ ] `node tests/run.js stop-body-canonical.test.js` green.
**Dependencies:** US-002, US-002b
**Estimated complexity:** medium

## US-004: SessionStart briefing + goldens
**Description:** As an operator, I want every new member session to see explicit guidance that the prose body is canonical for `done`/`question`/`blocked` kinds.
**Acceptance Criteria:**
- [ ] `hooks/briefing/template.js` `footer-tag` section has a new bullet (after the existing `summary` attribute line) explaining the body-canonical rule for review-surfacing kinds, naming thresholds, and noting hard-block at Stop.
- [ ] `tests/golden/briefing-member.md` and `tests/golden/briefing-lead.md` regenerated to match.
- [ ] `node tests/run.js briefing-render.test.js` green.
**Dependencies:** None (parallel-safe with helper-and-gate cluster)
**Estimated complexity:** small

## US-005: Docs — CLAUDE.md, README.md, new docs/protocol.md
**Description:** As an operator/maintainer, I want the rule + thresholds + env overrides documented.
**Acceptance Criteria:**
- [ ] New `docs/protocol.md` documents: tag kinds, body-canonical rule, summary attribute usage, enforcement thresholds + env overrides, progress exemption rationale, `stop_hook_active` safety-valve.
- [ ] `CLAUDE.md` has a new v1.8.0 section pointing to docs/protocol.md, naming env vars and defaults, cross-referencing v1.6.2 listener-arm gate precedent.
- [ ] `README.md` has a short paragraph linking to docs/protocol.md.
**Dependencies:** None (parallel-safe with helper-and-gate cluster)
**Estimated complexity:** small

## US-006: Version bump to v1.8.0 + CHANGELOG
**Description:** As a release manager, I want all version-bearing files pinned to 1.8.0 and CHANGELOG describing the behavioral change.
**Acceptance Criteria:**
- [ ] `node scripts/bump-version.js 1.8.0` run; all pinned files updated (`.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, three repo-level marketplace files, `tests/version.test.js`).
- [ ] `CHANGELOG.md` has a v1.8.0 entry naming: behavioral change (Stop hook hard-blocks lazy-summary envelopes for review-surfacing kinds), new env vars + defaults, progress exemption, `stop_hook_active` retry behavior, link to docs/protocol.md.
- [ ] `node tests/run.js version.test.js` green.
**Dependencies:** US-001, US-002, US-002b, US-003, US-004, US-005
**Estimated complexity:** small

## US-007: Full-suite green + named-remote push
**Description:** As a release manager, I want a clean full test run and push to the two named remotes only.
**Acceptance Criteria:**
- [ ] `node tests/run.js` (full suite) green; v1.6.2 listener-arm gate test unchanged.
- [ ] Commit on feature branch with message referencing the v1.8.0 behavioral change and findings F-001..F-011 from the plan review.
- [ ] Push branch to `origin` AND `work` only (the two pre-existing remotes).
- [ ] If any uncertainty (CI failure on either remote, unexpected diff, version-pin drift), surface `kind=question` to operator before FF-merging main.
- [ ] When CI green and diff matches: FF main locally; push main to `origin` and `work`.
- [ ] NO `git push --force` and NO pushing to remotes other than `origin`/`work` without explicit operator approval.
**Dependencies:** US-006
**Estimated complexity:** small
