# Implementation Plan: crews v3.0.0 Stop hook circuit-breaker recoverable + notification-boundary exemption

**Job:** `crews-stop-circuit-breaker-recoverable`
**Crews plugin source:** `D:/ai-developer-toolkit/plugins/crews/`
**Target plugin version:** `3.0.1` → `3.1.0`
**Topic branch (impl):** `ralph/crews-stop-circuit-breaker-recoverable`
**Companion investigation:** `D:/harness-efforts/codexu/.ralph/investigations/crews-implement-with-ralph-parallel-outbox-silent-loss/findings.md`

---

## Background

On 2026-06-02 the `impl-ai-developer-toolkit-submodule` crew member
(spawned via `/implement-with-ralph --parallel --suggested-decomposition
--autonomous`) ran for 1h 51m and produced a **0-byte outbox**, despite
emitting 8 well-formed `<|report kind="..."|>` tags in its transcript.
The post-mortem identified two structurally linked failures in
`hooks/stop.js`:

1. **Notification-storm exhausts the kind-tag budget.** Copilot CLI's
   `--parallel` orchestration interleaves `system.notification` events
   (sub-agent progress, async shell completions) with assistant turns
   at a high rate. Each notification → `assistant.turn_end` →
   `agentStop` invocation. The model treats notifications as
   continuations of a multi-tool flow and does not ceremoniously emit
   a kind tag on each one. With `MAX_CONSECUTIVE_STOP_BLOCKS = 5`,
   the budget is exhausted in tens of seconds.

2. **Circuit-breaker fires once → session is dead forever.** When the
   breaker fires (`hooks/stop.js:585-612`), it calls
   `clearFlag(data.session_id, cwd)`, removing the session→actor
   mapping. Every subsequent Stop hook invocation hits the role-guard
   early-return at `:572-575` and silently returns `{}`, never writing
   to outbox even when the model self-corrects and emits valid tags.

Tier-1 mitigation (banning `--parallel` impl spawns) has already
shipped at the bookkeeper-lead level. This plan is the **Tier-2 code
fix**, shipped as a single crews-plugin minor release that combines
two defense-in-depth changes:

- **Option A**: exempt `system.notification`-driven turn-ends from the
  kind-tag requirement at the missing-kind-tag block.
- **Option B**: make `clearFlag()` recoverable. The breaker no longer
  permanently disengages the session; it sets a `breakerMutedUntil`
  timestamp (~60s) during which Stop is inert, then re-engages.

Both are required: A removes the per-notification pressure on the
budget (eliminates the most-common trip cause), B caps the blast
radius if some future code path still trips the breaker (no permanent
data loss).

---

## Suggested Decomposition

The plan decomposes into seven stories along three independent edit
surfaces (`hooks/stop.js`, new test files, version+CHANGELOG metadata).
Story 1 is a single-shell preflight; Stories 2-3 are the code
changes; Stories 4-5 add test coverage for each; Story 6 ships the
version bump + changelog; Story 7 is an end-to-end repro to validate
the fix actually closes the bug.

**Serial execution is recommended.** All stories touch shared files
(`hooks/stop.js`, `CHANGELOG.md`, `.claude-plugin/plugin.json`) and
the safe-iteration loop benefits from each step seeing the previous
step's diff. **`--parallel --suggested-decomposition` is explicitly
forbidden until this fix ships** (per the Tier-1 mitigation already in
place at the lead).

```yaml
suggested_decomposition:
  parallelism: serial
  reason: |
    All seven stories touch hooks/stop.js or its sibling files in
    overlapping ranges. Serial execution lets each story see the
    previous diff and keeps the test suite green at each step.
```

---

## Story 1 — Preflight: detect edit-path target and seed worktree

**Goal:** before any code change, deterministically decide whether
the edits land in the standalone clone (`D:/ai-developer-toolkit/`)
or through the codexu in-tree path. Today's reality is the standalone
clone; this story makes that explicit and documents the alternative
path so a future re-run after the submodule task ships is a one-line
flag-flip.

**Acceptance criteria:**

1. The impl member runs a preflight bash/PowerShell block that prints
   one of two outputs:

   - `EDIT_PATH=standalone CREWS_DIR=D:/ai-developer-toolkit/plugins/crews` (today)
   - `EDIT_PATH=submodule CREWS_DIR=D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews` (post-submodule-task)

   Detection logic:
   ```bash
   if git -C D:/harness-efforts/codexu submodule status 2>/dev/null | grep -q ' ai-developer-toolkit '; then
     echo "EDIT_PATH=submodule"
     echo "CREWS_DIR=D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews"
   else
     echo "EDIT_PATH=standalone"
     echo "CREWS_DIR=D:/ai-developer-toolkit/plugins/crews"
   fi
   ```

2. The impl member creates its own implementation worktree per AGENTS.md
   "Cross-repo impl spawns" convention:

   - `EDIT_PATH=standalone` →
     `git -C D:/ai-developer-toolkit worktree add D:/ai-developer-toolkit/.worktrees/crews-stop-circuit-breaker-recoverable -b ralph/crews-stop-circuit-breaker-recoverable main`
   - `EDIT_PATH=submodule` →
     `git -C D:/harness-efforts/codexu/ai-developer-toolkit worktree add D:/harness-efforts/codexu/ai-developer-toolkit/.worktrees/crews-stop-circuit-breaker-recoverable -b ralph/crews-stop-circuit-breaker-recoverable main`

   All subsequent stories run inside this implementation worktree.

3. The preflight block emits a one-paragraph commit-trailer note
   (saved to the impl worktree's `.ralph/jobs/<job>/preflight.md`)
   capturing which path was chosen, the worktree path, the `main`
   start-point SHA, and the timestamp. The note is referenced from
   the final commit message so reviewers can verify the choice.

4. If `EDIT_PATH=submodule`, the preflight ALSO asserts that the
   codexu lead's primary checkout (`D:/harness-efforts/codexu`) is on
   `main` (`git -C D:/harness-efforts/codexu rev-parse --abbrev-ref
   HEAD` must equal `main`). This is the standard "lead primary stays
   on main" guard from AGENTS.md, surfaced here because a submodule-path
   edit could otherwise be mistaken for a parent-repo edit by accident.

**Verification:** the chosen branch exists in the chosen repo; the
worktree is on disk; `<worktree>/plugins/crews/.claude-plugin/plugin.json`
exists and reads `version: "3.0.1"`.

**Files added/modified:** none in this story (worktree + new branch
only). Commit boundary: this story does NOT produce a commit. The
preflight artifact lives only in the impl member's job-dir.

---

## Story 2 — Option A: notification-boundary exemption in `hooks/stop.js`

**Goal:** at the missing-kind-tag block, inspect the transcript and
allow the Stop without bumping `consecutiveStopBlocks` when the last
user-typed envelope before the current turn is a `system.notification`
(Copilot CLI's sub-agent progress / async shell completion / etc.).

**Why this is correct:** the crews protocol contract is "tag every
turn the model owns end-to-end." A `system.notification` →
`assistant.turn_end` flow is a sub-agent acknowledgement, not a
member-owned turn boundary. Tagging it adds no information to the
outbox (no operator-visible outcome to report) and exhausts the budget
that protects against real loop bugs.

**Acceptance criteria:**

1. New helper `lastUserBoundaryEnvelope(transcriptPath)` is added next
   to `lastTurnAssistantText` (`hooks/stop.js` ~line 436). Signature:

   ```js
   function lastUserBoundaryEnvelope(transcriptPath) {
     // Returns the most recent envelope `env` for which
     // isUserBoundaryEnvelope(env) === true, OR an envelope that the
     // model treats as a turn boundary (system.notification on the
     // Copilot shape). Returns null when transcript is absent /
     // unreadable / empty.
   }
   ```

   The helper walks the same envelope list as `lastTurnAssistantText`
   (read whole file, JSON-parse each line, walk backwards) but returns
   the matching envelope itself rather than concatenating downstream
   assistant text. It MUST recognize `env.type === 'system.notification'`
   (the Copilot shape — Claude has no analogous event type) as a
   boundary type, in addition to whatever `isUserBoundaryEnvelope`
   already accepts.

   Read budget: bounded by the existing `lastTurnAssistantText`
   pattern — both helpers read the whole transcript file at each
   Stop. This is acceptable: the call site fires at most once per
   Stop and the transcript is local-disk. No new I/O budget concerns.

2. New small predicate `isSystemNotificationBoundary(env)` exported
   from the same file (or inlined into the call site if cleaner):

   ```js
   function isSystemNotificationBoundary(env) {
     return Boolean(env && env.type === 'system.notification');
   }
   ```

3. At `hooks/stop.js:763` (the
   `state.role === 'member' && (!reports.length || !latestReport.kind)`
   block), BEFORE the existing `if (isRetry)` short-circuit, insert:

   ```js
   const lastBoundary = lastUserBoundaryEnvelope(data.transcript_path);
   if (isSystemNotificationBoundary(lastBoundary)) {
     appendLog(
       `member name=${state.name} crew=${crew} stop allowed (system.notification ack; no kind tag required)`,
       cwd
     );
     return;
   }
   ```

   Critically: this code path MUST NOT call `bumpBlockCount`. The
   whole point is that notification acks do not count against the
   consecutive-block budget. The model's normal turns continue to be
   measured against the budget exactly as before.

4. Behavior preserved unchanged for non-notification boundaries:
   - `user.message` (operator) → still requires kind tag, still bumps.
   - `messages` envelope (lead dispatcher delivery) → not a user
     boundary, so the existing walker's choice of last user boundary
     is unchanged; if no user boundary exists, the helper returns
     null and the exemption does not apply.
   - Empty / unreadable transcript → helper returns null; exemption
     does not apply; existing missing-kind-tag block runs unchanged.

5. The `isRetry` branch (line 764-767) is left intact below the new
   exemption check — a Claude Code retry on a missing-tag block still
   short-circuits to allow.

6. **Documented tradeoff (intentional).** If a `system.notification`
   arrives between a real `user.message` boundary and the model's
   substantive answer, the substantive answer is ALSO exempted from
   the kind-tag requirement (because the walker returns the more-
   recent notification boundary). The author of the original
   investigation explicitly chose this behavior: per findings.md §1
   the dominant transcript pattern is short ack-style responses to
   notifications, and the protocol's purpose is "tag every turn the
   model owns end-to-end" — once a notification interleaves, the
   immediately-following assistant text is no longer cleanly
   attributable to the original user prompt. The recoverable breaker
   in Option B is the safety net: if the model genuinely loses tag
   discipline across many real turns in this scenario, the breaker
   still fires (just with a 60s mute instead of permanent
   disengagement). No code-level threshold (e.g. "exempt only if body
   < N chars") is added because (a) the impl complexity isn't worth
   it for the rare-real-loss scenario and (b) tuning N would push
   the gotcha into a different shape rather than eliminating it.
   This tradeoff is called out in the CHANGELOG entry (Story 6) so
   operators understand the new semantics.

**Edge cases the implementation MUST handle:**

- **Claude transcript shape.** Claude does not emit
  `system.notification` events. The helper's check `env.type === 'system.notification'`
  is naturally false for Claude shapes (where the type field is
  `user`/`assistant` or the `role` field is set). No Claude regression
  is possible from this change.

- **Mixed-shape transcripts** (Copilot CLI session that includes
  Claude-style envelopes from a sub-agent invocation) — the
  type-string match is shape-agnostic; no harm.

- **System.notification interleaved between user.message and the
  current turn.** Walking backward, the FIRST boundary hit is the
  one that decides. If a `system.notification` is between two
  assistant turns and the model wrote nothing user-facing in between,
  that notification is the boundary and the exemption applies. If a
  real `user.message` is more recent than the most-recent notification,
  the user.message wins (helper returns the user.message envelope
  first when walking backward) and the exemption does NOT apply.

- **Transcript truncation.** The current helpers tolerate truncated
  final lines silently (`try { JSON.parse } catch {}`). New helper
  matches that tolerance.

**Files modified:** `hooks/stop.js` only. Estimated diff: +40 / -0
lines.

**Verification:** Story 4's test suite locks the new behavior.

---

## Story 3 — Option B: recoverable breaker via `breakerMutedUntil`

**Goal:** when the circuit-breaker fires, stop calling `clearFlag()`.
Instead, set `breakerMutedUntil = now + DEFAULT_BREAKER_MUTE_MS`
(default 60_000 = 60s) on the manifest. While the mute is active,
every Stop hook returns silently without writing outbox AND without
emitting a block decision. When the mute expires, the next Stop
proceeds normally — the protocol re-engages naturally, and a
successful outbox write clears `breakerMutedUntil` along with
`consecutiveStopBlocks`.

**Why a temporary mute is correct:** the breaker fires because some
loop is in progress — typically the model is failing to emit kind
tags. A 60s mute gives the model a window to (a) consume the breaker
advisory block, (b) self-correct (the breaker's one-shot block
envelope explains what happened), and (c) emit a valid tag on a
subsequent turn. If the underlying bug is structural (e.g., the
notification storm from --parallel) and the mute expires without
recovery, the breaker fires again — but each fire is bounded to 60s
of lost outbox, not the 1h 44m we saw.

**Acceptance criteria:**

1. New constant near `MAX_CONSECUTIVE_STOP_BLOCKS`:

   ```js
   const DEFAULT_BREAKER_MUTE_MS = 60_000;
   ```

   Optionally tunable via env var `CREWS_BREAKER_MUTE_MS` (positive
   integer ms; non-numeric or non-positive → fallback to default;
   capped at e.g. 600_000 to prevent operator footgun). The env-var
   parsing helper mirrors the existing `parseProgressTailMax` pattern
   at line 83.

2. New small predicate near `bumpBlockCount` (~line 510):

   ```js
   function isBreakerMuted(name, crew, cwd, nowMs = Date.now()) {
     const manifest = readManifest(name, crew, cwd) || {};
     const untilMs = parseBreakerMutedUntil(manifest.breakerMutedUntil);
     return untilMs !== null && untilMs > nowMs;
   }

   function parseBreakerMutedUntil(value) {
     if (!value) return null;
     const parsed = Date.parse(String(value));
     return Number.isFinite(parsed) ? parsed : null;
   }
   ```

   `breakerMutedUntil` is stored on the manifest as an ISO-8601
   string for forensic readability (matches `lastStopBlockAt`,
   `lastTurnAt`, etc.).

3. The circuit-breaker block at `hooks/stop.js:578-612` changes as
   follows:

   ```js
   const priorBlocks = readBlockCount(state.name, crew, cwd);
   if (priorBlocks >= MAX_CONSECUTIVE_STOP_BLOCKS) {
     const manifest = readManifest(state.name, crew, cwd) || {};
     const muteMs = resolveBreakerMuteMs(); // reads env-var with fallback
     const muteUntil = new Date(Date.now() + muteMs).toISOString();
     appendLog([
       `stop: CIRCUIT-BREAKER fired for ${state.role} name=${state.name} crew=${crew}`,
       `(consecutiveStopBlocks=${priorBlocks}, max=${MAX_CONSECUTIVE_STOP_BLOCKS}`,
       `lastReason="${manifest.lastStopBlockReason || ''}")`,
       `Setting breakerMutedUntil=${muteUntil} (mute=${muteMs}ms);`,
       'session flag preserved.'
     ].join(' '), cwd);
     try {
       withManifestLock(state.name, crew, cwd, state.role, () => updateManifest(state.name, crew, {
         consecutiveStopBlocks: 0,
         lastStopBlockReason: null,
         breakerMutedUntil: muteUntil
       }, cwd));
     } catch {}
     // NOTE: clearFlag(data.session_id, cwd) is INTENTIONALLY REMOVED.
     // The session flag is preserved so subsequent Stops can re-engage
     // once the mute expires. See the breakerMutedUntil mute gate
     // BELOW the role-guard near the top of handleInput.
     out.stdout.write(JSON.stringify({
       decision: 'block',
       reason: [
         `Stop hook detected a runaway block loop (${priorBlocks} consecutive blocks without progress).`,
         `Last block reason: ${manifest.lastStopBlockReason || '(unknown)'}.`,
         `This session is temporarily muted from the crew protocol for ${Math.round(muteMs / 1000)}s.`,
         'During the mute, your turns will complete without outbox writes; emit valid kind tags afterward to re-engage.',
         '(This is a safety circuit-breaker; it will not repeat during the mute window.)'
       ].join('\n')
     }));
     return;
   }
   ```

4. New early-return gate ABOVE the existing breaker-fire check (so
   subsequent Stops during the mute window are inert). Add
   immediately AFTER the role-guard at line 575:

   ```js
   if (isBreakerMuted(state.name, crew, cwd)) {
     // During the mute window, Stop is inert: no outbox write, no
     // block decision, no counter bump. The session flag is intact
     // so a future Stop after the window expires re-engages naturally.
     appendLog(`stop: muted (breaker) for ${state.role} name=${state.name} crew=${crew}`, cwd);
     return;
   }
   ```

   This gate runs ONCE per Stop. The role-guard above it still bails
   for non-member/non-lead sessions exactly as before.

5. The successful-outbox-write manifest update at line 1055-1065
   clears `breakerMutedUntil` alongside the existing counter reset:

   ```js
   withManifestLock(state.name, crew, cwd, state.role, () => updateManifest(state.name, crew, {
     lastSeq: writtenSeq,
     lastTurnAt: now,
     lastKind: lastRow.kind || turnKind,
     lastSummary: lastRow.summary || null,
     sessionId: data.session_id,
     transcriptPath: data.transcript_path || (manifest && manifest.transcriptPath) || null,
     lastHeartbeatAt: now,
     consecutiveStopBlocks: 0,
     lastStopBlockReason: null,
     breakerMutedUntil: null
   }, cwd));
   ```

6. The empty-body-on-retry write path at line 906-914 also clears
   `breakerMutedUntil: null` for symmetry. (It already clears
   neighbours implicitly by virtue of being a successful outbox
   write; explicitly nulling the new field keeps every reset path
   consistent so reviewers don't have to memorise which path resets
   which field.)

7. The `assertSessionOwnsActor` exception handler at line 614-660
   (cleared-member loop break) is untouched — its `clearFlag` call
   handles a different scenario (member ran `/leave-crew` or lead ran
   `/clear-member`) and remains correct. Only the breaker's
   `clearFlag` is removed.

**Edge cases the implementation MUST handle:**

- **Clock skew during the mute window.** The check is "now > untilMs"
  using `Date.now()` and `Date.parse()` of an ISO string. No reliance
  on monotonic time. The 60s window is forgiving enough to absorb
  small drift.

- **Manifest write race.** `withManifestLock` already serializes
  writes per actor. The breaker's mute write and a concurrent
  successful-outbox-write reset both go through the lock; whichever
  is later wins. In the steady state, the successful write is later
  (mute is what FIRES first, recovery is what writes second), so the
  reset correctly clears it.

- **Pre-existing manifests without `breakerMutedUntil`.** The field
  is null/undefined → `isBreakerMuted` returns false. Backward
  compatible with all crews-v3.0.x manifests on disk.

- **Operator manually clears the mute.** Setting
  `manifest.breakerMutedUntil = null` (e.g. by hand-editing the
  manifest after diagnosing the underlying loop) takes effect on the
  next Stop. No CLI tool is added in this minor release; manual
  edit is the documented escape hatch.

**Files modified:** `hooks/stop.js` only. Estimated diff: +50 / -15 lines.

**Verification:** Story 5's test suite locks the new behavior.

---

## Story 4 — Tests for Option A: notification-boundary exemption

**Goal:** new `tests/stop-allow-system-notification-boundary.test.js`
that exhaustively exercises the new exemption path.

**Test harness reminders:** see `tests/stop-circuit-breaker.test.js`
(101 lines, the existing canonical breaker test) for the established
pattern:

- `tmpDir('crews-...-')` for an isolated state cwd per test.
- `cfg.ensureActorDir('member', NAME, crew, cwd, { manifest: { sessionId: SESS }, capabilities: {} }, { sessionId: SESS })`
- `cfg.writeFlag(SESS, { role: 'member', crew, name: NAME }, cwd)`
- `spawnSync(process.execPath, [STOP], { input: JSON.stringify({ session_id, cwd, transcript_path, stop_hook_active: false }), encoding: 'utf8' })`
- Assertions via `tests/lib/assert.js`'s `equal`, `ok`.

The new file MUST construct on-disk transcripts (Copilot CLI
events.jsonl shape) and pass their paths as `transcript_path`.
Reference `tests/copilot-transcript-shape.test.js` for the canonical
envelope shapes:

- `{"type":"system.notification", "data":{"content":"..."}}`
- `{"type":"user.message", "data":{"content":"..."}}`
- `{"type":"assistant.message", "data":{"content":"..."}}`

**Test cases (one assertion section per case; all in one file):**

### Case A.1: bare notification boundary → Stop allows without bumping

Transcript:
```
{"type":"user.message","data":{"content":"initial prompt"}}
{"type":"assistant.message","data":{"content":"ok, working on it"}}
{"type":"system.notification","data":{"content":"async shell completed"}}
{"type":"assistant.message","data":{"content":"got it"}}
```

Drive Stop with this transcript. Assert:
- Stop exits 0.
- Stdout is empty (no block decision).
- Manifest `consecutiveStopBlocks` remains 0 (NOT bumped).
- Manifest `lastStopBlockReason` remains null.

### Case A.2: user.message boundary still requires kind tag

Same as A.1 but the boundary is `user.message` instead of
`system.notification`:
```
{"type":"system.notification","data":{"content":"earlier notification"}}
{"type":"assistant.message","data":{"content":"working"}}
{"type":"user.message","data":{"content":"another prompt"}}
{"type":"assistant.message","data":{"content":"no tag here"}}
```

Drive Stop. Assert:
- `decision: 'block'`
- `reason` contains "kind tag"
- Manifest `consecutiveStopBlocks` = 1 (bumped).

This case proves the helper walks backward correctly: the
user.message is more recent than the notification.

### Case A.3: notification more recent than user.message → exemption applies

```
{"type":"user.message","data":{"content":"earlier prompt"}}
{"type":"assistant.message","data":{"content":"ok"}}
{"type":"system.notification","data":{"content":"shell completed"}}
{"type":"assistant.message","data":{"content":"no tag"}}
```

Drive Stop. Assert:
- Stop exits 0, stdout empty, counter 0.

### Case A.4: empty / missing transcript → existing missing-tag block still fires

Drive Stop with `transcript_path: null` and no kind tag in the empty
transcript text. Assert:
- `decision: 'block'`, reason contains "kind tag", counter incremented
  to 1.

### Case A.5: Claude transcript shape with no notification → block as before

```
{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"no tag"}]}}
```

Drive Stop. Assert:
- `decision: 'block'`, counter incremented.

### Case A.6: notification followed by valid kind tag → outbox row written, counter 0

```
{"type":"user.message","data":{"content":"prompt"}}
{"type":"assistant.message","data":{"content":"working"}}
{"type":"system.notification","data":{"content":"shell done"}}
{"type":"assistant.message","data":{"content":"All tests pass.\n\n<|report kind=\"progress\" summary=\"tests green\"|>"}}
```

Drive Stop. Assert:
- Outbox file has one row with `kind: 'progress'`, `summary: 'tests green'`.
- Counter remains 0.

This case proves the exemption coexists with normal tag-bearing
turns — the exemption applies only to MISSING tags, not to overriding
tag parsing.

### Case A.7: isRetry path still short-circuits when exempt

Drive Stop with `stop_hook_active: true` and a notification-boundary
transcript. Assert:
- Stop exits 0, stdout empty, counter 0. (Same as A.1 — both code
  paths take the same shape.)

**Files added:** `tests/stop-allow-system-notification-boundary.test.js`
(~200 lines).

---

## Story 5 — Tests for Option B: recoverable breaker

**Goal:** new `tests/stop-circuit-breaker-recoverable.test.js` that
locks the new mute-window behavior. The existing
`tests/stop-circuit-breaker.test.js` is REWRITTEN to match the new
behavior — its previous assertions about `clearFlag` and
"silently allows after breaker" are now incorrect.

**Decision:** REPLACE the existing test in place (not add a sibling).
Reasoning: the existing assertions encode the pre-fix permanent-
disengagement behavior as if it were correct. Keeping them as a
"locked legacy contract" would falsely document that as the intended
behavior. The replacement test asserts the NEW recoverable contract.
The plan-impl member MUST update both the assertions and the leading
comment block so the test file's first 6 lines describe the new
behavior (e.g. "1.0.4 circuit-breaker (v3.1.0 recoverable variant)").

**Test cases (replacement for `stop-circuit-breaker.test.js`):**

### Case B.1: 5 untagged turns + 6th trip = breaker sets `breakerMutedUntil`, NOT clearFlag

- Drive 5 consecutive Stops with no kind tag. Assert counter walks
  1→5 and each invocation returns `decision: 'block'` with
  "kind tag" reason (NOT "runaway" / "circuit-breaker").
- Drive the 6th Stop. Assert:
  - `decision: 'block'`
  - `reason` contains "runaway block loop"
  - `reason` contains "temporarily muted" (NEW — replaces
    "Close this tab" wording).
  - `reason` contains "60s" (or the resolved mute window) — confirms
    the user sees the recovery duration.
  - **Flag IS NOT cleared**: `cfg.readFlag(SESS, cwd)` returns the
    original `{ role: 'member', crew, name: NAME }` object.
  - Manifest `consecutiveStopBlocks` = 0 (reset by breaker, as before).
  - Manifest `lastStopBlockReason` = null (reset by breaker, as before).
  - Manifest `breakerMutedUntil` is a valid ISO-8601 string parsable
    by `Date.parse`, ≥ now and ≤ now + 60s + 5s tolerance.

### Case B.2: Stop during mute window is silently inert (no block, no outbox, no manifest write)

- Continue from B.1's state (mute is set ~60s in the future).
- Drive a 7th Stop with a tagged transcript that WOULD normally write
  an outbox row (e.g. `<|report kind="progress" summary="recovered"|>`).
- Assert:
  - Stop exits 0.
  - Stdout is empty (no `decision: 'block'` AND no normal-pass
    output — Stop is fully inert).
  - Outbox file is still empty.
  - Manifest `lastSeq` is still absent / 0.
  - Manifest `breakerMutedUntil` is unchanged.

### Case B.3: After mute expires, Stop re-engages normally

- Manually fast-forward by writing
  `manifest.breakerMutedUntil = (new Date(Date.now() - 5000)).toISOString()`
  via `cfg.updateManifest` (simulates the mute window having expired).
- Drive Stop with a tagged transcript that produces a valid outbox row.
- Assert:
  - Stop exits 0 with empty stdout (normal-pass behavior).
  - Outbox has the new row.
  - Manifest `breakerMutedUntil` is now null (cleared by the successful
    write reset path).
  - Manifest `consecutiveStopBlocks` is 0.

### Case B.4: After mute expires, untagged turn re-bumps the counter starting from 0

- Use the same setup as B.3 (mute just expired).
- Drive Stop with a transcript that has no kind tag.
- Assert:
  - `decision: 'block'` with "kind tag" reason.
  - Manifest `consecutiveStopBlocks` = 1 (started fresh from 0,
    confirming the breaker's counter-reset wrote correctly).
  - Manifest `breakerMutedUntil` is unchanged (the bump path does not
    clear the mute, but at this point the mute is in the past so it's
    no-op).

### Case B.5: Honoring `CREWS_BREAKER_MUTE_MS` env var

- Set `process.env.CREWS_BREAKER_MUTE_MS = '5000'` for the spawn.
- Drive the 6-stop trip sequence.
- Assert `breakerMutedUntil` is ≤ now + 5s + 1s tolerance.

### Case B.6: Successful outbox write clears `breakerMutedUntil` (defense-in-depth)

- Manually set `breakerMutedUntil` to the FAR FUTURE
  (e.g. `(new Date(Date.now() + 999_999_000)).toISOString()`).
- ALSO manually set `breakerMutedUntil` to a near-past time on the
  ALREADY-CLEARED mute path? No — instead: directly invoke the
  manifest update at the successful-write site by driving a Stop with
  a kind tag and a NEAR-PAST `breakerMutedUntil` so the mute gate
  doesn't block. Assert: after the Stop, manifest `breakerMutedUntil`
  is null.

  (Case B.3 already covers this implicitly, but B.6 makes it explicit
  for code reviewers tracing the reset paths.)

### Case B.7: Reset path test from the existing legacy test (preserved)

Keep the existing "forward progress clears the counter" sub-test
(lines 82-100 of the current file) verbatim — it asserts that
`updateManifest` with `consecutiveStopBlocks: 0` correctly clears the
counter. Extend it to also assert `breakerMutedUntil: null` is
cleared by the same write.

**Files modified:**
- `tests/stop-circuit-breaker.test.js` (rewritten in place; ~150 lines).
- `tests/stop-circuit-breaker-recoverable.test.js` is NOT added — the
  decision is to update the existing canonical test rather than
  fragment the breaker assertions across two files. The new behavior
  IS the canonical behavior at v3.1.0.

### Other suite tests that encode the OLD breaker behavior (MUST update)

A pre-commit scan of the existing suite turned up these tests that
already assert the pre-v3.1.0 breaker contract. They are NOT in
`stop-circuit-breaker.test.js` and the impl member could miss them.
Each one must be updated as part of Story 5 (NOT a separate story —
they are part of the same fix's test-coverage scope):

- **`tests/review-gate.test.js:440-451`** — asserts breaker clears
  the session flag BEFORE the review-required gate can run. Update
  required:
  - Line 450 (`equal(cfg.readFlag('alice-s', cwd), null, 'circuit breaker clears the session flag before review gate can run')`)
    → replace with: assert flag is PRESERVED and
    `manifest.breakerMutedUntil` is a parseable ISO-8601 string in
    the future.
  - Line 449 (`equal(result.parsed.reason.includes('review-required'), false, 'circuit breaker fires before review-required Stop gate')`)
    → unchanged in spirit but the reason string check should match
    the new wording ("temporarily muted" replaces "Close this tab");
    update line 448 (`ok(result.parsed.reason.includes('runaway block loop'), ...)`)
    only if the impl changes that phrase (Story 3 keeps "runaway
    block loop" in the reason string, so line 448 still passes).
  - Line 451 (`equal(cfg.readManifest('alice', 'demo', cwd).consecutiveStopBlocks, 0, ...)`)
    → unchanged (the breaker still resets the counter to 0).
  - The intent of the test (breaker precedes review-required) is
    preserved; only the flag-cleared assertion changes.

- **`tests/stop-displaced-session.test.js:6, 70`** — comments
  reference the breaker. Inspect for any assertions that depend on
  the OLD behavior. Initial scan: lines 51/71-72 assert
  `consecutiveStopBlocks was not bumped on the displaced-session
  path` — that semantic is preserved by the fix (the displaced-
  session path is the `assertSessionOwnsActor` exception handler,
  which is intentionally untouched per Story 3 AC #7). No code
  change needed; verify by running the test post-fix.

- **`tests/first-turn-listener-guard.test.js:60`** — asserts
  `m.consecutiveStopBlocks` is 1 after a listener-unreachable bump.
  This is a `bumpBlockCount` call site, NOT a breaker fire site;
  unchanged. Verify by running the test post-fix.

**Mandatory pre-commit scan command** (added to Story 7 AC #3):

```bash
rg -n 'clearFlag\(|runaway block loop|consecutiveStopBlocks: 5|circuit-breaker.*clears.*flag' tests/
```

Every match must be reviewed against the new contract and either
preserved (semantic unchanged) or updated. The impl member MUST
inspect every hit and either show why it's unaffected or update it
in the same commit as the code change.

---

## Story 6 — Version bump, CHANGELOG, plugin.json

**Acceptance criteria:**

1. `D:/ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json`
   `version` field: `"3.0.1"` → `"3.1.0"`.

2. `D:/ai-developer-toolkit/plugins/crews/.copilot-plugin/plugin.json`
   (or the Copilot-side counterpart, if it exists with a separate
   version field) — update in lockstep. The impl member checks both
   locations and updates whichever exists.

3. `D:/ai-developer-toolkit/plugins/crews/CHANGELOG.md` gains a new
   top-of-file entry. Template:

   ```markdown
   ## 3.1.0 - <YYYY-MM-DD>

   Fix (defense-in-depth, two-part): the v3.0.0 Stop hook circuit-
   breaker had a structural failure mode where Copilot CLI's
   `--parallel --suggested-decomposition` orchestration generated
   `system.notification` events fast enough to exhaust the 5-block
   budget in tens of seconds. When the breaker tripped, `clearFlag()`
   permanently disengaged the session — every subsequent Stop hit
   the role-guard early-return and wrote nothing, even when the
   model emitted valid `<|report kind="..."|>` tags. The
   `impl-ai-developer-toolkit-submodule` member on 2026-06-02
   produced a 0-byte outbox across 1h 44m of work as a result. Full
   root-cause investigation:
   `.ralph/investigations/crews-implement-with-ralph-parallel-outbox-silent-loss/findings.md`.

   Two-part remediation:

   - **Option A — notification-boundary exemption.** The missing-
     kind-tag block in `hooks/stop.js` now walks the transcript
     backward to the last user-typed envelope; when that envelope is
     a `system.notification` (Copilot CLI shape — Claude has no
     equivalent), Stop allows the turn without bumping the counter.
     This removes the per-notification pressure on the budget so
     the breaker no longer trips under normal parallel-mode load.

   - **Option B — recoverable breaker via `breakerMutedUntil`.** The
     breaker no longer calls `clearFlag()`. It instead sets
     `manifest.breakerMutedUntil` to `now + 60s` (tunable via
     `CREWS_BREAKER_MUTE_MS`). During the mute window, Stop is
     silently inert — no block decision, no outbox write, no counter
     bump. After the window expires, the next Stop re-engages
     naturally; a successful outbox write clears both the counter
     and the mute. This caps the blast radius of any future breaker
     fire at the mute duration rather than the lifetime of the
     session.

   Both ship together for defense-in-depth: A removes the most
   common trip cause, B contains the blast radius if A misses an
   edge case.

   Tests:

   - New `tests/stop-allow-system-notification-boundary.test.js`
     locks the Option A exemption with seven cases (notification
     boundary, user.message boundary, recency walk, Claude shape,
     mixed-with-valid-tag, isRetry path, empty transcript).
   - `tests/stop-circuit-breaker.test.js` rewritten to assert the
     new mute-window contract: flag preserved (NOT cleared),
     `breakerMutedUntil` set as an ISO-8601 string, Stop inert
     during mute, re-engaged after, env-var honored, successful
     write clears the field.

   Manifest backward compatibility: the new `breakerMutedUntil`
   field is null/undefined on pre-3.1.0 manifests; the
   `isBreakerMuted` predicate treats null as "not muted." No
   migration required.

   No envelope-wire-format changes. No consumer-side reads of
   `breakerMutedUntil` are added in this release; the field is
   internal to the Stop hook.
   ```

4. The impl member chooses the `<YYYY-MM-DD>` at commit time (UTC).

**Files modified:** `.claude-plugin/plugin.json`, optionally
`.copilot-plugin/plugin.json`, `CHANGELOG.md`. All under
`D:/ai-developer-toolkit/plugins/crews/`.

---

## Story 7 — End-to-end smoke test + commit + push + ship

**Goal:** validate the fix actually closes the original bug, commit
the full diff with a body-canonical message, push to the appropriate
remotes, and produce a ship-manifest summary the bookkeeper can use
to flip `.ralph-overview/data.json`.

**Acceptance criteria:**

1. Run the minimum repro from findings.md §5 against the patched
   plugin. **Run path:** drive the impl worktree's `hooks/stop.js`
   DIRECTLY via `spawnSync(process.execPath, [STOP_PATH], ...)` —
   the same harness pattern the existing 220+ tests use. Do NOT
   rely on `copilot plugin update` for the in-loop smoke (that
   command only loads from `gim-home/main` once the topic branch
   is merged and pushed, and would deploy the OLD version while the
   impl is still iterating on the fix). `copilot plugin update` is
   only relevant POST-merge by the lead for fleet deployment, not
   for impl-loop validation.

   Smoke flow (run from
   `D:/ai-developer-toolkit/.worktrees/crews-stop-circuit-breaker-recoverable/plugins/crews`):

   - From an empty test cwd, seed an actor and flag (mirror
     `tests/stop-circuit-breaker.test.js` lines 14-21).
   - Drive six untagged Stops in sequence via `spawnSync` against
     `<worktree>/plugins/crews/hooks/stop.js`.
   - **Pre-fix expected (regression check, run BEFORE applying the
     Option B diff):** breaker fires on the 6th, flag is cleared,
     subsequent Stops are silent no-ops.
   - **Post-fix expected (after applying both Option A and B diffs):**
     breaker fires on the 6th, flag is PRESERVED, `breakerMutedUntil`
     is set ~60s in the future.
   - Drive a 7th Stop during the mute → silent no-op (stdout empty).
   - Wait for the mute to expire (or set `CREWS_BREAKER_MUTE_MS=2000`
     on the spawn env for a faster iteration) or manually fast-
     forward via `cfg.updateManifest(..., { breakerMutedUntil: (new
     Date(Date.now() - 5000)).toISOString() }, ...)`.
   - Drive an 8th Stop with a valid kind tag → outbox row written,
     manifest reset (consecutiveStopBlocks: 0, breakerMutedUntil:
     null).

   Save the repro script as
   `<impl-worktree>/plugins/crews/tests/repro-3.1.0-recovery.js`
   matching existing test style (Node + custom assert). The script
   is RUN by the impl member as final validation; mark it as a
   regular `*.test.js` file so the canonical test suite picks it up
   too (defense-in-depth: the same scenario is locked in TWO test
   files — the unit test in Story 5 and this repro). DO NOT name
   it `*.sh`; the existing suite is Node-only.

2. Run the full crews test suite from the impl worktree:

   ```bash
   cd D:/ai-developer-toolkit/.worktrees/crews-stop-circuit-breaker-recoverable/plugins/crews
   node tests/run.js
   ```

   Expected: 0 failures. The two new/updated test files
   (`stop-allow-system-notification-boundary.test.js`,
   `stop-circuit-breaker.test.js`) appear in the pass list. The
   existing 220+ tests continue to pass. Save output as
   `<impl-job-dir>/test.log`.

3. **Cross-impact pre-commit scan.** Before committing, grep BOTH
   the crews source AND the test suite for any other call sites of
   `clearFlag`, `consecutiveStopBlocks`, the breaker advisory
   strings, OR the new `breakerMutedUntil` field that this plan
   didn't touch:

   ```bash
   # Source side — confirm only the intended sites change
   grep -n "clearFlag\|consecutiveStopBlocks\|breakerMutedUntil" hooks/*.js

   # Test side — confirm every old-contract assertion is reviewed
   rg -n 'clearFlag\(|runaway block loop|consecutiveStopBlocks: 5|circuit breaker clears' tests/
   ```

   Expected hits beyond the changed surface (must be VERIFIED, not
   blindly accepted):

   Source:
   - `actors.js` (the `clearFlag` definition itself) — unchanged.
   - `stop.js:614-660` cleared-member loop-break `clearFlag` call —
     intentionally untouched per Story 3 AC #7.

   Tests:
   - `tests/pointer-mirror.test.js:102-105` — tests the `clearFlag`
     function directly; unchanged.
   - `tests/split-export-compat.test.js:60` — asserts `clearFlag` is
     in the export surface; unchanged.
   - `tests/stop-decision.test.js:85,124,129` — asserts
     `consecutiveStopBlocks: undefined` on three exempt paths
     (progress, retry, shutdown); unchanged.
   - `tests/first-turn-listener-guard.test.js:60` — listener-unreachable
     bump, NOT a breaker fire site; unchanged.
   - `tests/stop-displaced-session.test.js:51,71-72` — displaced-session
     `assertSessionOwnsActor` path, untouched per Story 3 AC #7;
     unchanged.
   - `tests/review-gate.test.js:440-451` — **MUST be updated** per
     Story 5's "Other suite tests" subsection.
   - `tests/stop-circuit-breaker.test.js` — **MUST be rewritten** per
     Story 5.

   If any NEW call site surfaces (a test not listed above that fails
   to match the new contract), the impl member surfaces a
   `kind=question` to the lead before committing. Do not blindly
   update unfamiliar tests.

4. Commit message (impl worktree):

   ```
   fix(crews): make Stop circuit-breaker recoverable + exempt system.notification boundaries (v3.1.0)

   Two-part defense-in-depth fix for the v3.0.0 silent-outbox-loss bug
   in --parallel impl members (see investigation
   .ralph/investigations/crews-implement-with-ralph-parallel-outbox-silent-loss/findings.md
   in the codexu repo). Full rationale and per-story acceptance in
   .ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md.

   - Option A: notification-boundary exemption in the missing-kind-
     tag block. system.notification → assistant.turn_end is sub-agent
     activity, not a member-owned turn boundary; allowing the Stop
     without bumping the consecutive-block counter eliminates the
     dominant trip cause under Copilot CLI --parallel orchestration.

   - Option B: recoverable circuit-breaker. The breaker no longer
     calls clearFlag() (permanent disengagement). It sets
     manifest.breakerMutedUntil = now + 60s (tunable via
     CREWS_BREAKER_MUTE_MS). During the mute window, Stop is silently
     inert; after, it re-engages naturally; a successful outbox write
     clears the mute alongside the existing counter reset.

   Tests:
   - New tests/stop-allow-system-notification-boundary.test.js (7 cases)
   - tests/stop-circuit-breaker.test.js rewritten for the new contract

   No envelope-wire-format changes. Manifest backward compatible.

   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
   ```

5. Push the topic branch to all three remotes (per AGENTS.md
   "Always push main to ALL configured remotes" rule, applied here at
   the topic-branch level so the lead sees it on every clone):

   ```bash
   git push origin ralph/crews-stop-circuit-breaker-recoverable
   git push gim-home ralph/crews-stop-circuit-breaker-recoverable
   git push personal ralph/crews-stop-circuit-breaker-recoverable
   ```

   Failures are reported as `kind=question` to the lead; do not retry
   silently. The lead will FF-merge to `main` on each remote and run
   `copilot plugin update` to deploy.

6. Final report to the lead (the impl member's `kind=done` turn) MUST
   include in the prose body:
   - Commit SHA on the topic branch
   - Topic branch name
   - Impl worktree path
   - Test-suite pass count (e.g. "tests/run.js: 223 passed, 0 failed")
   - One-line summary of the repro outcome (e.g. "minimum repro
     against patched plugin: pre-fix flag-cleared behavior absent;
     post-fix mute window honored; outbox re-engages after mute")
   - List of remotes pushed (origin, gim-home, personal)

   The lead uses this to FF-merge and update `.ralph-overview/data.json`
   per the bookkeeper "ship the bookkeeping update the same turn"
   invariant.

**Files modified:** none in this story beyond the test log artifact.
Story 7 is verification + commit, not new code.

---

## Open questions (none load-bearing, plan is execution-ready)

1. **Does Claude Code emit any envelope shape that should also be
   exempt?** Claude's hook input has no notification stream of the
   same shape; the model's only equivalents are tool-result envelopes
   which are already filtered by `classifyEnvelope` as non-boundary.
   Decision: NO change for Claude; Option A is Copilot-CLI-specific
   by virtue of the `env.type === 'system.notification'` check, and
   that's correct.

2. **Should the mute window be longer than 60s?** 60s was chosen as
   "long enough for the model to see the breaker advisory + emit a
   recovery turn, short enough to bound data loss." The env var
   `CREWS_BREAKER_MUTE_MS` gives operators an escape hatch if
   they want to tune. No load-bearing reason to deviate from 60s as
   the default.

3. **Should the recoverable breaker emit a system mailbox notification
   to the lead when it fires?** This would be ideal for operator
   visibility (the lead would see "member X tripped the breaker") but
   adds scope. Not included in this minor release; can be added in a
   follow-up 3.2.0 if the new behavior surfaces in practice.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| The new `lastUserBoundaryEnvelope` helper reads the full transcript on every Stop, adding I/O cost | Low | `lastTurnAssistantText` (the existing helper) does the same thing today. No new I/O budget. |
| Claude transcript shapes get mis-classified by the helper | Very low | The `env.type === 'system.notification'` check is shape-agnostic and Claude has no such type. Story 4 case A.5 locks this. |
| `breakerMutedUntil` field collides with some future field on the manifest | Very low | The field name is new; ad-hoc namespacing prefix `breaker*` keeps it contained. |
| Operator manually edits the mute to a malformed value | Low | `parseBreakerMutedUntil` returns null for non-parseable strings; mute is then "not active"; protocol works as if no mute were set. Safe default. |
| The fix doesn't actually close the original `--parallel` bug | Low-medium | Story 7's smoke test runs the minimum repro from findings.md §5. If the repro doesn't pass post-fix, the impl member surfaces `kind=blocked` to the lead rather than committing. Validation gate. |

---

## Handoff to `/implement-with-ralph`

This plan is execution-ready as `/implement-with-ralph --from-plan
<plan-path> --autonomous`. The `--parallel` mode is INTENTIONALLY NOT
used (per Tier-1 mitigation already in place at the lead bookkeeper
level — `--parallel` impl mode is blocked until this fix ships, which
is what this very plan is shipping).

Spawn-prompt template for the impl member:

```
/implement-with-ralph --from-plan D:/harness-efforts/codexu/.ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md --autonomous
```

The impl member should follow the plan's seven stories in order;
Story 1 (preflight) must complete before any code edits; Story 7
(commit/push) must complete with all three remotes pushed before
emitting `kind=done`.
