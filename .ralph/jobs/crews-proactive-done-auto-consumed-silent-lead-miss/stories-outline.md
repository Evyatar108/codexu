# Stories Outline: Fix crews proactive-terminal-report deliver/consume silent-loss race

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. IMPL must serialize after `impl-d001-toolkit-guard` (both toolkit). Single serial cluster `crews-silent-loss-fix`.*

## US-001: Listener-epoch ownership + prevention layer + regression tests (core fix)
**Description:** As a crews lead, I want a member's proactive terminal report to never be silently consumed-and-dropped, so that a duplicate/orphan listener subprocess cannot drain the mailbox and lose the lead notification.
**Acceptance Criteria:**
- [ ] `manifest.lastListenerEpoch` declared in `hooks/protocol/manifest.js` (number; absent treated as `0`); manifest field-count assertion in `tests/protocol-manifest.test.js` updated.
- [ ] `markArmed`/`touchHeartbeat` bump `lastListenerEpoch` (+ record arming PID) under the manifest lock ONLY on a true arm transition (arming PID != current `lastListenerPid`, or no epoch yet); same-PID heartbeat refreshes do NOT bump it (so the owning listener's captured epoch stays valid for its lifetime).
- [ ] `markArmIntent` no longer writes `lastListenerPid: null`/`lastHeartbeatAt: null` in any branch (stamps `listenerState:'armed'` only); `tests/mark-arm-intent.test.js` updated to the new no-null contract. (`markExited` already doesn't null the PID — verified; no change there.)
- [ ] `consumeMailbox` accepts `opts.listenerEpoch` (+ `opts.listenerPid`) and, under the manifest lock gating the mailbox-empty write (`mailbox.js:563`), refuses (returns `[]`, writes no history row, leaves `mailbox.json` unchanged, logs `listener-orphan-consume-refused …`) when the caller epoch is not `manifest.lastListenerEpoch`; an unset caller epoch OR unset/0 manifest epoch is inert (no refusal); a matching epoch drains normally (commits `consumedAt`, advances `lastReviewRequiredSeq`).
- [ ] `lib/listener-loop.js` `deliver()` passes `{ sessionId, listenerPid, listenerEpoch }` using the loop's existing `listenerPid` variable and the epoch captured at `markArmed`.
- [ ] Deterministic unit test `tests/consume-mailbox-epoch-fence.test.js`: stale epoch → `[]` + no new history row + `mailbox.json` unchanged + log line; current epoch → drains + exactly one new `consumedAt` row; unset epoch → inert drain.
- [ ] Integration test `tests/integration/proactive-report-silent-loss-race.test.js`: two same-session listeners (current-epoch + stale-epoch orphan) + one queued proactive `done` → orphan emits no `{type:messages}`; current-epoch listener emits exactly one `{type:messages,count:1}`; exactly one `consumedAt` history row (from the current listener); `markArmIntent` did not clear `lastListenerPid`. Added to the `tests/run.js` serial denylist if it spawns subprocesses.
- [ ] Full crews suite passes: `cd ai-developer-toolkit/plugins/crews && node tests/run.js`.
- [ ] Typecheck passes (`node --check` on every changed `.js` file).
**Dependencies:** None (within plan); externally gated on `impl-d001-toolkit-guard`.
**Estimated complexity:** medium

## US-002: crews patch release + codexu pointer bump
**Description:** As a maintainer, I want the fix shipped as a crews patch release with the submodule pointer and CI-invariant version table updated, so consumers pick it up and CI stays green.
**Acceptance Criteria:**
- [ ] crews version bumped via `node scripts/bump-version.js <next>` (6 stamp files); `node tests/version.test.js` passes.
- [ ] crews `CHANGELOG.md` has a `## <next> - <date>` section; crews `AGENTS.md` has a new section AND the existing v1.2.12 section (which documents `markArmIntent` PID-clearing) is amended to the new no-null contract; the 3 marketplace indexes carry `<next>`.
- [ ] Two commits: (1) one `ai-developer-toolkit` submodule commit with all crews changes; (2) one codexu parent commit recording the new gitlink AND bumping the root `D:/harness-efforts/codexu/AGENTS.md` active-plugin-versions table crews row `3.6.1 → <next>` in the same commit. Root worktree shows the updated gitlink + table together.
- [ ] External gate evidence: IMPL began only after `impl-d001-toolkit-guard` shipped; topic branch rebased onto post-d001 toolkit `main`; the ship manifest/commit records the post-d001 base SHA (and observed crews version after d001).
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** small
