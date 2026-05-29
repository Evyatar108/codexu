# Stories Outline: Suppress lead `<|report kind=...|>` footer-tag requirement (crews v1.7.4)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-000: Pre-implementation cleanup
**Description:** As the impl member, I want a clean starting worktree at `D:/ai-developer-toolkit/` so my v1.7.4 ship contains only the lead-suppress-kind-tag changes.
**Acceptance Criteria:**
- [ ] `git -C D:/ai-developer-toolkit restore -- plugins/crews/hooks/commands/resume-crew.js` ran successfully (file matches HEAD).
- [ ] Per operator choice (default = Option A): `git -C D:/ai-developer-toolkit restore -- plugins/crews .agents/plugins/marketplace.json .claude-plugin/marketplace.json .github/plugin/marketplace.json` ran successfully. (If Option B, this step is skipped but Phase 5a review must explicitly diff against the pre-applied edits.)
- [ ] A new topic branch `ralph/crews-lead-suppress-kind-tag` is checked out from `main` in a worktree.
- [ ] `git status` shows clean working tree before any US-001 edits begin.
**Dependencies:** None
**Estimated complexity:** small

## US-001: Role-gated briefing + Stop hook
**Description:** As a crews lead session, I want to end my turns with prose only (no mandatory kind tag) so the operator-facing transcript is less noisy, while crews members continue to emit the kind tag for mailbox routing.
**Acceptance Criteria:**
- [ ] `plugins/crews/hooks/stop.js`: `LEAD_DEFAULT_KIND = 'progress'` constant defined; `effectiveTurnKind(role, parsedKind)` helper defined and returns `parsedKind` when present, else `'progress'` for leads, else `parsedKind` (null) for members.
- [ ] `plugins/crews/hooks/stop.js`: the `if (!tags.kind)` block is gated on `state.role === 'member'` (leads bypass).
- [ ] `plugins/crews/hooks/stop.js`: every downstream consumer of `tags.kind` inside `handleInput` uses `turnKind` instead — outbox-append (~line 700), manifest-update (~lines 706, 807), and the `decideStopBlock` call site (~line 676). Verified via grep: no remaining `tags.kind` references inside the success path that runs after the role-gated missing-kind block.
- [ ] `plugins/crews/hooks/stop.js`: lead-tailored Stop reason strings in (a) the empty-body-and-no-summary branch, (b) `buildUnresolvedConsumedReason` (~line 269), and (c) the listener-block reason (~line 478). All "kind tag" wording for leads replaced with role-neutral "turn-end metadata" or equivalent.
- [ ] `plugins/crews/hooks/briefing/template.js`: the `footer-tag`, `examples`, and tag-referencing lines inside `resume-protocol` and `rules` sections render only when `ctx.role === 'member'` (early-return pattern matching the existing `listener-arm` section at lines 13-65).
- [ ] `plugins/crews/hooks/briefing/template.js`: lead briefing includes an explicit short clause stating leads do NOT need a routine kind footer; `<|report ack=...|>` and `<|report reply-to=...|>` metadata syntax + at least one ack example + one reply-to example remain visible to leads.
- [ ] No changes to `hooks/protocol/manifest.js`, `hooks/actors.js`, `hooks/crews.js`, `hooks/commands/status.js`, or `hooks/commands/list-members.js`.
- [ ] No changes to `hooks/commands/resume-crew.js` (US-000 guarantees this).
- [ ] Typecheck passes (the crews plugin is plain JS — equivalent: `node -c` on every changed file).
**Dependencies:** US-000
**Estimated complexity:** medium

## US-002: Test coverage + golden refresh
**Description:** As a crews-plugin maintainer, I want regression-grade test coverage proving the role-asymmetric behavior holds, so future contributors don't "fix" the lead path back to symmetric.
**Acceptance Criteria:**
- [ ] `plugins/crews/tests/golden/briefing-lead.md` regenerated. Loses footer-tag mandatory instructions, kind-tag-only examples, the "end with kind tag" line in resume-protocol, and the kind-tag-required line in rules. Gains the explicit "leads do not need to emit a routine kind footer" clause + ack/reply-to metadata examples.
- [ ] `plugins/crews/tests/golden/briefing-member.md` is byte-identical to its v1.7.3 state. Verified by a fresh diff before commit.
- [ ] `plugins/crews/tests/briefing-render.test.js` passes (golden diff).
- [ ] `plugins/crews/tests/briefing-structure.test.js` updated so the `footer-tag` section assertion is gated on member role.
- [ ] `plugins/crews/tests/copilot-briefing.test.js` updated per-engine + per-role assertions reflect the lead omission.
- [ ] `plugins/crews/tests/role-gate.test.js` (preferred home) OR new `plugins/crews/tests/lead-footer-tag.test.js` adds 5 fixtures (numbered to ACs from plan.md):
  - F-A1 (AC-1+3+4) lead prose-only passes Stop, asserts outbox envelope `kind === 'progress'`, manifest `lastKind === 'progress'`, manifest `lastSummary === synthesizeSummary(body)`.
  - F-A2 (AC-2) member-no-tag still blocks at Stop with the existing missing-kind message.
  - F-A5 (AC-5) lead with manifest.listenerState='armed' + recent lastListenerSpawnAt + unresolved consumed mail still blocks at Stop with the lead-tailored unresolved-mail reason; assert the reason string mentions `<|report ...|>` metadata tag, NOT "kind tag".
  - F-A6 (AC-6) lead emits prose + `<|report ack="<id>" reason="..."|>` (no kind); message resolves, Stop passes, manifest `lastKind === 'progress'`, `lastSummary === synthesizeSummary(body)`.
  - F-A12 (AC-12) lead with listener never-armed still blocks at Stop on listener-reachability; assert the block reason uses role-neutral "turn-end metadata" wording (no "kind tag" substring).
- [ ] Full plugin test suite green via `node plugins/crews/tests/run.js` (or the canonical entry point). Operator's known orphan-listener timing flake is documented separately and out of scope for this ship.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Docs + version bump to 1.7.4
**Description:** As a downstream plugin consumer, I want clear release notes and matching version stamps so I know the role-asymmetric behavior is intentional and I can refresh my plugin cache.
**Acceptance Criteria:**
- [ ] `plugins/crews/CLAUDE.md` has a new v1.7.4 section that documents the role-asymmetric behavior: leads exempt from kind-tag emission; members enforced; `effectiveTurnKind` helper; rationale ("future contributors must not 'fix' the lead path back to symmetric — kind tag served no consumer above the lead").
- [ ] `plugins/crews/CHANGELOG.md` has a v1.7.4 entry prepended above v1.7.3 listing the user-facing bullets (lead prose-only turns, member behavior unchanged, briefing role-asymmetric, 5 new test fixtures).
- [ ] `node plugins/crews/scripts/bump-version.js 1.7.4` ran from the ai-developer-toolkit repo root and updated all 5 files (`plugins/crews/.claude-plugin/plugin.json`, `plugins/crews/.github/plugin/plugin.json`, `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`) + `plugins/crews/tests/version.test.js` to `1.7.4`. (Not hand-edited.)
- [ ] `tests/version.test.js` passes against the new version.
- [ ] Branch pushed to both `Evyatar108` and `gim-home` remotes per spawn-prompt pre-authorization.
- [ ] Merge to `main` per the v1.7.3 precedent (member-driven direct merge authorized). Commit message references the spawn-prompt authorization quote.
- [ ] Ship report flags the post-ship operator action: hand-update local `D:/harness-efforts/codexu/CLAUDE.md` lines 143-147 (gitignored, cannot be updated via ship) or move the section to `AGENTS.md`.
- [ ] Full plugin test suite green.
**Dependencies:** US-002
**Estimated complexity:** small
