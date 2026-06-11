# Stories Outline: Crews Nested Child Takeover Engine-Agnostic Prevention

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Build centralized ralph spawn-env sanitizer
**Description:** As a crews member runner, I want nested child processes to launch with non-claimable crews identity env so they cannot impersonate the parent actor.
**Acceptance Criteria:**
- [ ] A shared sanitizer strips `CREWS_ROLE`, `CREWS_NAME`, `CREWS_CREW`, `CREWS_STATE_CWD`, and `CREWS_BOOTSTRAP_REPLY_TO` from nested child env.
- [ ] The sanitizer is reused by ralph nested spawn code (not duplicated ad hoc logic).
- [ ] Typecheck passes
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Apply sanitizer to all nested spawn boundaries and lens paths
**Description:** As a planner/implementer workflow operator, I want every nested child path to use sanitized env so no missed spawn path can claim member identity.
**Acceptance Criteria:**
- [ ] Iteration path (`ralph.mjs` to `codex-exec.mjs`/`copilot-exec.mjs`) uses sanitized env.
- [ ] Review/lens paths (`review-loop.mjs`, brainstorm/plan lens commands) use sanitized env.
- [ ] Tests cover all known nested spawn call sites.
- [ ] Typecheck passes
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Add crews engine-agnostic ancestry refusal guard
**Description:** As a crews role owner, I want descendant processes refused at claim time regardless of engine so env leaks cannot hijack ownership.
**Acceptance Criteria:**
- [ ] Ownership claim flow declines a claimer process when it is a descendant of the live role-holder process and has a different session id.
- [ ] Guard behavior is engine-agnostic (same-engine and cross-engine).
- [ ] Legitimate same-session ownership behavior is not regressed.
- [ ] Typecheck passes
**Dependencies:** US-002
**Estimated complexity:** large

## US-004: Expand regression and takeover tests
**Description:** As a maintainer, I want explicit coverage for takeover-prevention and regressions so future refactors cannot reintroduce hijack paths.
**Acceptance Criteria:**
- [ ] Same-engine nested test proves no takeover.
- [ ] Cross-engine nested test proves no takeover.
- [ ] Lens-child nested test proves no takeover.
- [ ] Existing first-bind, same-tab reclaim, and dead-member recovery tests remain green.
- [ ] Typecheck passes
**Dependencies:** US-003
**Estimated complexity:** medium

## US-005: Perform live dogfood and record cross-plugin sequencing closeout
**Description:** As the pipeline lead, I want a live same-engine dogfood proof and explicit two-job ship sequence so the fix is operationally safe to ship.
**Acceptance Criteria:**
- [ ] Live same-engine codex->codex nested run shows parent ownership intact and report delivery intact.
- [ ] Plan handoff explicitly states two-job sequence: ralph-first, crews-second.
- [ ] Ship sequencing note calls out crews serialization due to version-file collision risk.
- [ ] Typecheck passes
**Dependencies:** US-004
**Estimated complexity:** medium
