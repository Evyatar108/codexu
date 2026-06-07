# Stories Outline: Hard-crash member-crashed auto-notify v1 (crews)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*
*Single serial cluster (`member-crash-autonotify`) — all in `plugins/crews/`, shared files + hard ordering; do NOT parallelize.*

## US-001: `member-crashed` envelope-kind wiring
**Description:** As the crews protocol, I want a new `member-crashed` envelope kind that is
review-required AND strict-ack-exempt (modeled on `member-left`), so the crash notification surfaces in
`/crews-review-mail` without forcing the lead into an ack chore.
**Acceptance Criteria:**
- [ ] `'member-crashed'` added to `kindEnum` (`hooks/protocol/envelope.js:63-88`).
- [ ] `PAYLOAD_RULES['member-crashed']` added with required `{ memberName:'string', deadReason:'string', signature:'string', detectedAt:'string' }`; `launcherPid`/`launcherStartedAt`/`sessionId`/`takeoverAt` carried in payload for forensics (not required).
- [ ] `'member-crashed'` added to `DEFAULT_REVIEW_KINDS` (`hooks/protocol/review-required.js:1-12`).
- [ ] `'member-crashed'` added to `ACK_EXEMPT_KINDS` (`hooks/stop.js:189-196`); exemption test (`from.role==='system'`) verified.
- [ ] New `tests/member-crashed-envelope-kind.test.js` (mirror `operator-envelope-kinds.test.js`) asserts: kind accepted by `buildEnvelope` under `CREWS_STRICT_SCHEMA=1`; review-required true for a lead recipient; ack-exempt true; turn-tag `VALID_KINDS` UNCHANGED (it is an envelope kind, not a report kind).
- [ ] `node --check` passes on touched files.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Strictly-additive `getMemberHealth` return extension
**Description:** As the crash sweep, I want `getMemberHealth` to expose the fields the sweep needs
(sessionId, createdBy, role, takeoverAt, shutdown markers) without changing existing behavior.
**Acceptance Criteria:**
- [ ] `getMemberHealth` (`hooks/health.js:66-96`) return gains `sessionId`, `createdBy`, `role`, `takeoverAt`, `shutdownRequested`, `terminationKind`, `terminatedAt` — ADDITIVE only; no existing field renamed/removed; no member-role gating added.
- [ ] `hooks/health.test.js` asserts the new fields are present for a member fixture AND that the pre-existing return shape (and `snapshotCrew`/list-members behavior) is unchanged.
- [ ] `node --check` passes.
**Dependencies:** None
**Estimated complexity:** small

## US-003: `member-crash-notifications` helper + skip guards + F-001 pre-kill intent write
**Description:** As the lead, I want a focused helper that detects high-confidence-dead member
transitions, dedupes per incarnation, and appends one `member-crashed` envelope to my own mailbox —
with all the false-positive guards — plus the `applyHardStopMember` pre-kill intent write that makes the
intentional-stop guard actually correct.
**Acceptance Criteria:**
- [ ] New `hooks/member-crash-notifications.js` exports `buildDeadSignature(health)` (canonical string of `{memberName, sessionId, launcherPid, launcherStartedAt, takeoverAt, deadReason}`), `sweepMemberCrashNotifications({leadName, crew, cwd, now})`, `resetMemberCrashNotificationLatch({leadName, crew, cwd, memberName})`.
- [ ] Locked + atomic latch over `<crewRoot>/liveness-notifications.json` shaped `{ memberCrash: { <leadName>: { <memberName>: <signature> } } }`; persist ONLY after a successful append; on latch-write failure log `member-crash-latch-write-failed` (fail-loud/fail-duplicate).
- [ ] Sweep applies all 6 skip guards: member-role-only; intentional-stop (shutdownRequested/terminationKind/terminatedAt); mid-resume (listenerState==='recoverable'); terminal cleared/left; ownership via `createdByLeadName()` + `activeLeadNames()` single-lead determination with `member-crash-sweep-orphan-skipped` log; `state==='dead'` only.
- [ ] `hooks/actors.js::applyHardStopMember` writes `shutdownRequested:true` (intent) BEFORE the kill (`~:1545`), keeping the post-kill audit write.
- [ ] `tests/member-crash-notifications.test.js`: signature determinism; each guard (incl. intentional-stop-DURING-kill-window via the new pre-kill write, mid-resume, quiet/unknown/alive → zero); single append per dead incarnation; no dup across repeated sweeps; latch-write-fail path; reset clears one entry; orphan-skip log.
- [ ] `node --check` passes.
**Dependencies:** US-002
**Estimated complexity:** large

## US-004: D-001 — throttled sweep in the listener heartbeat tick + self-deliver
**Description:** As an idle lead on an indefinitely-armed listener, I want a dead member to wake me
promptly through my existing mailbox channel without any poll loop.
**Acceptance Criteria:**
- [ ] In `lib/listener-loop.js` heartbeat `setInterval` (`:305-353`), after the `markArmed` write, gated on the actor being a lead and throttled by a module-local `lastCrashSweepAt` (≤1/60s, env `CREWS_CRASH_SWEEP_THROTTLE_MS`), call `sweepMemberCrashNotifications`. Whole block in try/catch (`member-crash-sweep-failed` log; never crash the heartbeat/listener).
- [ ] When `sweep.appended > 0`, call the existing `deliver('crash-sweep')` synchronously in the same tick (append-before-consume). stdout `{type:'messages',...}` envelope shape unchanged; verify no consumer pins the `via` enum.
- [ ] `tests/integration/member-crash-listener-delivery.test.js`: armed lead listener + synthetic dead member → EXACTLY ONE delivery that wakes the listener; quiet/unknown/intentionally-stopped/recoverable → zero; repeated sweeps → no dup; after a simulated resume (new takeoverAt) a re-crash → one fresh delivery.
- [ ] `node --check` passes; crews suite green.
**Dependencies:** US-001, US-003
**Estimated complexity:** medium

## US-005: D-003 — turn-boundary backstop sweeps + latch-reset wiring
**Description:** As an actively-working lead, I want the same sweep at my turn boundaries, and I want the
latch reset when a member is resumed or cleared.
**Acceptance Criteria:**
- [ ] Lead-role sweep call added to `hooks/stop.js` (before the opportunistic `consumeMailbox`), `hooks/session-start.js`, and `hooks/pre-tool-use.js`; each best-effort try/catch, never blocks the hook decision.
- [ ] Behavior matches the armed/unarmed split: armed → listener delivers; unarmed → Stop's consume surfaces same-turn.
- [ ] `repairManifestForResume` (`hooks/commands/resume-crew.js:~333-339`) calls `resetMemberCrashNotificationLatch` for the resumed member.
- [ ] clear-member (`hooks/commands/clear-member.js:63-87`) calls the reset for the cleared member.
- [ ] Reset test: resume of a crashed member → subsequent re-crash (new takeoverAt) yields a fresh notification; clear-member removes the latch entry.
- [ ] `node --check` passes.
**Dependencies:** US-003, US-004
**Estimated complexity:** medium

## US-006: Version bump + CHANGELOG + AGENTS.md
**Description:** As a crews maintainer, I want the release stamped consistently across all manifests.
**Acceptance Criteria:**
- [ ] `node scripts/bump-version.js 3.13.0` updates the 6 version files + `tests/version.test.js`; `node tests/version.test.js` passes.
- [ ] `CHANGELOG.md` prepends a `## 3.13.0 - <date>` entry describing the member-crashed auto-notify feature.
- [ ] `plugins/crews/AGENTS.md` gains a `## v3.13.0 ...` section documenting the kind wiring, the latch file, the skip guards (incl. the F-001 pre-kill intent write), the D-001/D-003 split, and the common-mistake gotchas.
- [ ] Full crews suite green via `node tests/run.js`; `manifestFields.length===51` test UNCHANGED.
- [ ] (Submodule ship: two-commit flow — commit in `ai-developer-toolkit` first, then the codexu pointer bump; the LEAD pauses before the version push per codexu AGENTS.md.)
**Dependencies:** US-001, US-002, US-003, US-004, US-005
**Estimated complexity:** small
