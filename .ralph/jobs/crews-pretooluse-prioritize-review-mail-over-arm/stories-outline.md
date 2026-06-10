# Stories Outline: PreToolUse — prioritize review-mail over arm when unreviewed mail is pending

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Insert the review-mail-first gate-ordering branch in pre-tool-use.js
**Description:** As a crews lead/member, I want the arm-first PreToolUse block to tell me to run
REVIEW-MAIL first when I have unreviewed pending mail (instead of telling me to arm a listener, which
re-delivers + exits and loops), so I drain my mailbox, advance my reviewed cursor, then arm against a
clean mailbox.
**Acceptance Criteria:**
- [ ] In `ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js`, import `reviewRequiredReason` from
      `./protocol/review-gate`.
- [ ] In `handleInput`, after the `if (listenerState === 'armed') return;` early-return (line ~475),
      read `manifest` ONCE and build the `cmd` + engine-aware `armBlock` (no side effects), then insert
      a new branch: call `reviewRequiredReason(state.name, crew, cwd, state.role, manifest)`; if it
      returns non-null, build a combined reason `[<reviewRequiredReason output>, '', <arm note + armBlock>]`,
      `appendLog`, `block(reason, out)`, and `return`.
- [ ] If `reviewRequiredReason(...)` returns null (no mail pending), fall through to the EXISTING plain
      arm block unchanged (reusing the already-built `cmd`/`armBlock`).
- [ ] The branch is placed AFTER the `isReviewMailCall` bypass, the listener-output-inspection bypass,
      the AskUserQuestion intercept, and the armed early-return (no regression to any).
- [ ] The new combined block preserves arm-first safety: it still instructs the actor to arm AFTER
      draining (secondary note containing the arm command).
- [ ] No change to Stop's review-required gate, the v3.4 lead-unconditional-listener gate (in stop.js),
      or `CREWS_REVIEW_MODE` handling. The arm-first gate fires regardless of review mode (unchanged).
- [ ] `node --check ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js` passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Add the new test file and update the flipped existing test
**Description:** As a maintainer, I want tests pinning the review-mail-first routing across roles and
engines, and the one existing test that flips updated, so the behavior is locked and `node tests/run.js`
stays green.
**Acceptance Criteria:**
- [ ] Create `ai-developer-toolkit/plugins/crews/tests/pretooluse-review-mail-first.test.js` covering:
      (a) unreviewed-mail-pending + unarmed MEMBER → block begins with the exact
      `reviewRequiredReason(...)` output (review-mail command present), NOT the plain
      `you must arm a background listener` lead;
      (b) no-mail + unarmed → existing plain arm block (contains `you must arm a background listener`),
      review-mail command absent;
      (c) armed → no block (regression);
      (d) engine-aware matrix: engine ∈ {claude, copilot, codex} × CREWS_BIN set/unset, asserting the
      block's leading segment equals a DIRECT `reviewRequiredReason(...)` call output (per-engine token:
      `$CREWS_BIN` / `$env:CREWS_BIN` / absolute dispatcher path);
      (e) LEAD pending + unarmed → review-mail-first block.
- [ ] The engine comparison uses DIRECT `reviewRequiredReason(...)` output — do NOT extend
      `review-gate.test.js`'s `expectedReviewRequiredReason` helper (it special-cases only copilot and
      yields the wrong codex arm-prefix).
- [ ] Update `review-gate.test.js` `crews-review-gate-pretool-before-listener` block (~367-381) to
      expect the review-mail-first block instead of `must arm a background listener` / no `review-required`.
      Do NOT change the four armed mode-tests above it (~337-365) — they stay green.
- [ ] Grep the whole `ai-developer-toolkit/plugins/crews/tests/` tree for
      `you must arm a background listener`, `lastReviewRequiredSeq`, `lastReviewedSeq`; update any other
      unarmed+review-pending fixture that asserts the plain arm-block text. Confirm
      `pre-tool-use-listener-output.test.js` arm-block fixtures (no review seqs) stay green.
- [ ] `node tests/run.js` passes (full crews suite green). Model the harness on
      `pre-tool-use-listener-output.test.js` (`runPreTool` + `seedExitedMember`) + `seedReviewRequired`.
- [ ] `node --check` passes on the new test file.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Ship mechanics — version bump, marketplace sync, CHANGELOG, AGENTS.md
**Description:** As a release manager, I want the crews plugin version bumped and all release surfaces
updated, so consumers pick up the new gate-ordering behavior.
**Acceptance Criteria:**
- [ ] Run `node ai-developer-toolkit/plugins/crews/scripts/bump-version.js 3.20.0` (edits 7 files:
      3 plugin manifests `.claude-plugin/plugin.json`, `.github/plugin/plugin.json`,
      `.codex-plugin/plugin.json`; 3 marketplace indexes `.claude-plugin/marketplace.json`,
      `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`; plus `tests/version.test.js`).
- [ ] `node ai-developer-toolkit/plugins/crews/tests/version.test.js` passes (all stamps == 3.20.0).
- [ ] Prepend a `## 3.20.0` entry to `ai-developer-toolkit/plugins/crews/CHANGELOG.md`.
- [ ] Add a v3.20.0 section to `ai-developer-toolkit/plugins/crews/AGENTS.md` documenting the
      gate-ordering change + a common-mistake gotcha (don't broaden the gate into review enforcement;
      don't regress arm-first safety / the v3.4 lead gate / AskUserQuestion ordering; the branch only
      changes the block MESSAGE when unarmed AND mail pending).
- [ ] Do NOT edit the codexu root `CLAUDE.md` (gitignored). Do NOT bump the codexu submodule pointer
      (lead-owned, two-commit submodule flow at merge time).
- [ ] `node tests/run.js` still green after the bump.
**Dependencies:** US-001, US-002
**Estimated complexity:** small
