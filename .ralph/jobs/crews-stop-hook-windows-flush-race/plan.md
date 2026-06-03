# Implementation Plan: crews Stop hook Windows flush-race fix + recoverable circuit breaker + bypass tag rename

**Job:** `crews-stop-hook-windows-flush-race`
**Crews plugin source:** `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/` (in-tree submodule — NOT the standalone `D:/ai-developer-toolkit/` clone)
**Current shipped version:** `3.1.2`
**Target plugin version:** `3.2.0`
**Topic branch (impl):** `ralph/crews-stop-hook-windows-flush-race`
**Impl worktree (toolkit-submodule-side):** `D:/harness-efforts/codexu/ai-developer-toolkit/.worktrees/crews-stop-hook-windows-flush-race`
**Diagnosis handoff:** `D:/harness-efforts/codexu/.ralph/jobs/codex-rs-feature-pruning-for-sub-45m-cold/impl-session-handoff.md`
**Companion design reference (DESIGN ONLY — NEVER SHIPPED):** `D:/harness-efforts/codexu/.ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md`
**Companion investigation:** `D:/harness-efforts/codexu/.ralph/investigations/crews-implement-with-ralph-parallel-outbox-silent-loss/findings.md`
**Operator inbound (lead → plan member, in chronological order):**
- msg id `0417779c-b4e3-49a0-9704-ecc4446d9aa7` (2026-06-03T06:22Z) — extend retry to `detect-active-bg.js` shared read path + add Test F.8
- msg id `a1e0852b-baba-4f81-bc00-9d932d6fedc2` (2026-06-03T06:25Z) — initial bypass tag rename proposal (SUPERSEDED)
- msg id `4b9daa70-fa29-4b4e-bf75-59e3fb6c2002` (2026-06-03T06:28Z, SUPERSEDES `a1e0852b`) — final bypass tag rename scope: in-band `<|report kind='progress' background-task|>` form + deprecation cycle

---

## Background

### The bug (P0)

On 2026-06-02 the `impl-codex-rs-feature-pruning-for-sub-45m-cold` member (session `f6d962f7-169f-4e4a-80c6-8cfbf353a367`, crews v3.1.0, engine=copilot) was disengaged by the Stop hook circuit breaker after **5 consecutive false-positive missing-kind-tag blocks**. The member's final assistant prose DID contain a valid `<|report kind="progress" summary="operator decided (A) serial autonomous; starting Phase 2 with codex-submodule worktree adaptation" reply-to="cab7cd8b-b4f0-4903-a5b4-3e797ba692d8"|>` tag — verified via hex-dump of `~/.copilot/session-state/<sid>/events.jsonl` at envelope 572 (bytes `3C 7C 72 65 70 6F 72 74 20 6B 69 6E 64 3D ...`). A Node reproduction of `parseTurnReports` against the truncated transcript (`events.jsonl[0..573]`, the on-disk state at hook-fire time) correctly finds 1 match with `kind="progress"`. So the parser at `hooks/stop.js::parseTurnReports` is sound; the tag is on disk.

The Stop hook fires 105ms after Copilot CLI writes the assistant.message envelope. On the affected turn, the prose body was ~2KB (a substantive operator-decision acknowledgment). The kernel page-cache hadn't flushed the envelope to disk by the time `hooks/stop.js:723`'s `lastTurnAssistantText(data.transcript_path)` called `fs.readFileSync(transcriptPath, 'utf8')` at line 440 — so the hook saw a transcript missing envelope 572 and fell into the missing-kind-tag block at line 764-776, bumping `consecutiveStopBlocks`. Each retry hit the same race (prose stayed >2KB). At 5 consecutive blocks the breaker fired at line 586-613 and called `clearFlag(data.session_id, cwd)` at line 601, **permanently disengaging the session**. The member's subsequent 6+ recovery attempts (bare valid kind tags) were silent role-guard no-ops, manifesting as a close-tab loop.

**Operator urgency (2026-06-03T06:05Z):** the prior workaround "spawn impl members under Claude Code instead of Copilot" is going away because Claude Code access is being deprecated. Copilot CLI MUST be a fully supported member engine. Every Copilot impl member that emits long-prose ack/done turns is at risk under the current crews v3.1.2 Stop hook.

### CRITICAL PRE-PLAN CORRECTION

The spawn prompt repeatedly says "the v3.1.0 breakerMutedUntil mechanism doesn't engage because this is a different blocker classification than the v3.0 notification storm." **This premise is false.** Verified by powershell grep (`grep-breaker.txt` in staging):

```
grep -rn breakerMutedUntil D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews
→ 0 matches
```

`breakerMutedUntil` does not exist in the live codebase. What v3.1.0 actually shipped (commit ffcb8f83) was the **progress + no-bg gate for Copilot members** (see `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/CHANGELOG.md` §3.1.0 and `AGENTS.md` § "v3.1.0 progress + no-bg gate"). The two-part recoverable-breaker design (Option A notification-boundary exemption + Option B `breakerMutedUntil`) was fully drafted as 1050 LoC at `.ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md`, multi-model reviewed, but the operator manually shipped the smaller progress+no-bg fix as v3.1.0 instead. The shipManifest at `.ralph-overview/data.json:111` documents this verbatim: *"Operator shipped manually as crews v3.1.0... rather than running the planned /implement-with-ralph impl from the 1050-LoC plan... Plan deliverable... remains as design reference."*

The practical consequence: when the Stop-hook circuit-breaker fires today (`hooks/stop.js:586-613`), it still calls `clearFlag()` at line 601 and **permanently disengages the session**. There is no 60s mute window. This shapes the close-tab-loop fix: "member-side awareness of breaker-muted state" is not viable today because there is no mute state to be aware of.

### Why we resurrect Option (ii) instead of the simpler force-exit counter (i)

The spawn prompt proposes two options for the close-tab loop:
- **(i) Force-exit threshold on a new counter** (e.g. `consecutivePostBreakerAttempts` incremented on each Stop after `clearFlag` has run, force-exit at >= 10).
- **(ii) Resurrect the recoverable-breaker design** from `.ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md`.

**This plan recommends (ii)** for these reasons (multi-model reviewers in Phase 4 are explicitly asked to challenge):

1. **The clearFlag permanent-disengage path is a latent footgun, observed twice in production within 30 days.** The 2026-05-30 `--parallel` notification-storm investigation (`.ralph/investigations/crews-implement-with-ralph-parallel-outbox-silent-loss/findings.md`) and the 2026-06-02 flush-race diagnosis are independent failure modes that converge on the same disengagement step. A fix that only retries on the flush race leaves the breaker still capable of permanent disengagement on the third-and-fourth future failure mode we haven't discovered yet. Defense-in-depth at the breaker fire site eliminates the entire class.

2. **The retry-with-backoff (this plan's Story 2) alone is not sufficient.** The 500ms backoff handles the observed flush latency band (2KB prose @ ~100ms), but a Stop hook running concurrently with a busy Defender scan or a massive (>5KB) prose body could still exceed 500ms. The fix should reduce trip likelihood AND bound the blast radius if a trip still happens.

3. **The recoverable-breaker design is already 1050 LoC of designed, multi-model-reviewed work.** Re-deriving an equivalent (i) variant would duplicate effort. The only path-substitution needed is `D:/ai-developer-toolkit/` → `D:/harness-efforts/codexu/ai-developer-toolkit/` (in-tree submodule).

4. **(ii) makes the close-tab-loop fix free.** With `breakerMutedUntil` set, every Stop during the mute window is silently inert — no block decision, no outbox write, no counter bump. The member's bare-tag retry turns are no-ops. After 60s the breaker re-engages naturally; either the next turn succeeds (recovery) or the breaker re-fires (bounded blast radius). No extra code needed for the close-tab UX.

5. **(i)'s force-exit counter introduces its own permanent-tombstone state shape.** That's a NEW class of disengagement we'd later regret if the next failure mode wants to recover, not tombstone. (ii) is the more general primitive.

If multi-model review tilts to (i) instead, the plan adapts: drop Stories S4, S5, S8, S9; replace with a single force-exit counter story + matching test.

### What the user prompt's three mitigations resolve to in this plan

- **(a) Retry-with-backoff in `lastTurnAssistantText`** → **Story 2** (PRIMARY FIX for THIS bug). **Extended to also cover `detect-active-bg.js::readEvents`** per operator mail `0417779c` 2026-06-03T06:22Z — the bg-gate has its own `fs.readFileSync` of `events.jsonl` at `detect-active-bg.js:66` and is subject to the same race when a Copilot member emits a freshly-launched async shell whose `tool.execution_start` event hasn't flushed yet.
- **(b) File-watch instead of poll-on-stop** → **Open Question — deferred follow-up.** Significantly more architectural change (SessionStart watcher lifecycle, ring buffer, two consumers). Higher regression risk. Defer unless (a) is empirically insufficient post-ship. Documented in Open Questions.
- **(c) Require fsync on Copilot side** → **Story 10** (docs-only deliverable — `docs/copilot-cli-fsync-upstream-ask.md` filing the upstream request). Long-term root-cause fix; do NOT block this ship on Copilot acceptance.

### Additional operator-directed scope (mail msg 4b9daa70 2026-06-03T06:28Z, supersedes mail msg a1e0852b 2026-06-03T06:25Z)

The v3.1.0 progress-bg gate's **bypass tag is cross-plugin-namespace-coupled to the `options-mode` plugin** — `<options-mode>background-task</options-mode>` (and its three sibling forms at `stop.js:919-922`) is borrowed from the separate `options-mode` plugin's tag protocol. Crews has no business claiming that namespace. Co-ship a **bypass tag rename to crews-namespaced form** as part of v3.2.0.

**Recommended form** (per operator preference in mail 4b9daa70): `<|report kind='progress' background-task|>` — an **in-band bare attribute** on the existing `<|report|>` tag that crews already owns. Rationale:
- Uses the namespace crews ALREADY owns (the `<|report|>` tag with the `|...|` delimiter convention).
- Keeps the bypass semantically connected to the `kind=progress` emit it modifies (same tag, attribute flag) — eliminates the false-positive risk of a stray `background-task` token elsewhere in the prose triggering the bypass.
- Eliminates the need to track 4 separate string-match positions in `stop.js` for two HTML-shape + two CommonMark-shape bypass tags.
- Makes the protocol grammar uniform.

**Parser feasibility:** verified against `TAG_REPORT_REGEX` at `hooks/mailbox.js:136-139` (`<|\s*report\s+(.*?)\s*|>` shape). The regex captures all attrs between `report ` and the closing `|>` as a single `(.*?)` group. The downstream `parseTurnReports` at `mailbox.js:907-940` parses the captured attrs blob — extracting `kind="..."` / `summary="..."` / `reply-to="..."` / `ack="..."` / `decision="..."` / `reason="..."` via individual extractors. A bare `background-task` token in the attrs would naturally be ignored by those extractors. The rename is **purely additive at the parser layer**: add a new extractor that detects the bare token and exposes it as `report.bgTask = boolean`. No regex changes needed.

**Alternative if in-band attribute parsing is awkward:** `<|crews:background-task|>` as a sibling tag. Requires a new regex and new parser pass. More invasive. Not recommended; in-band is cleaner.

**Deprecation cycle.** Keep the 4 legacy `options-mode`-namespaced forms recognized for ONE deprecation cycle. When any legacy form is detected, emit a stderr warning telling the user to switch. Remove in v4.0.0 (or a stated deprecation window in CHANGELOG.md).

---

## Suggested Decomposition

Twelve stories along three independent edit surfaces (`hooks/stop.js` + `hooks/mailbox.js` + `hooks/config.js` + `hooks/protocol/manifest.js` + `hooks/detect-active-bg.js` core; tests; version metadata + docs). Stories 1-5 are code changes; Stories 6-9 are test coverage; Stories 10-12 are docs + ship.

**Serial execution required.** All stories touch `hooks/stop.js` or its sibling files in overlapping ranges. Serial execution lets each story see the previous diff and keeps the test suite green at each step. `--parallel --suggested-decomposition` is explicitly FORBIDDEN for this ship until the underlying breaker bug is closed (which is what this plan ships).

```yaml
suggested_decomposition:
  parallelism: serial
  reason: |
    All twelve stories touch hooks/stop.js or its immediate siblings
    (mailbox.js, config.js, manifest.js, detect-active-bg.js,
    tests/stop-*, tests/progress-bg-gate.test.js). Serial keeps the
    diff readable and lets each story verify against a green baseline.
    The very bug this plan fixes makes --parallel mode inherently
    risky for crews work today.
```

---

## Story 1 — Preflight: toolkit-submodule worktree + sanity checks

**Goal:** before any code change, set up the impl worktree on the correct submodule, confirm the v3.1.2 baseline, pin the absence of `breakerMutedUntil` in the live tree, and capture the AGENTS.md active-versions stale-row state so Story 11 can fix it in the same commit.

**Acceptance criteria:**

1. From `D:/harness-efforts/codexu`, run preflight:

   ```pwsh
   # Confirm in-tree submodule presence
   git -C D:/harness-efforts/codexu submodule status | Select-String 'ai-developer-toolkit'
   # Confirm the lead's primary checkout is on main (AGENTS.md "lead primary stays on main" rule)
   $head = git -C D:/harness-efforts/codexu rev-parse --abbrev-ref HEAD
   if ($head -ne 'main') { Write-Error "lead primary not on main; aborting"; exit 1 }
   # Confirm crews version is 3.1.2
   $ver = (Get-Content D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json | ConvertFrom-Json).version
   if ($ver -ne '3.1.2') { Write-Error "expected crews v3.1.2, got $ver; aborting"; exit 1 }
   # Confirm breakerMutedUntil absence
   $matches = & "C:\Program Files\Git\usr\bin\grep.exe" -rl breakerMutedUntil D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews
   if ($matches) { Write-Error "breakerMutedUntil ALREADY exists; recoverable-breaker may have shipped under a different SHA; abort and re-check"; exit 1 }
   # Capture AGENTS.md active-versions row (expect stale '3.0.1' per research brief item 9)
   $row = (Get-Content D:/harness-efforts/codexu/AGENTS.md | Select-String 'crews\b.*\|' | Select-Object -First 1).Line
   Write-Host "AGENTS.md crews row (will be updated in Story 11): $row"
   ```

   Output saved to `.ralph/jobs/crews-stop-hook-windows-flush-race/preflight.md`.

2. Create the toolkit-submodule worktree:

   ```pwsh
   git -C D:/harness-efforts/codexu/ai-developer-toolkit worktree add `
     D:/harness-efforts/codexu/ai-developer-toolkit/.worktrees/crews-stop-hook-windows-flush-race `
     -b ralph/crews-stop-hook-windows-flush-race origin/main
   ```

3. All subsequent stories run inside `D:/harness-efforts/codexu/ai-developer-toolkit/.worktrees/crews-stop-hook-windows-flush-race`.

**Files added/modified:** worktree + branch only. No commit boundary in this story.

**Verification:** `git -C <worktree> rev-parse --abbrev-ref HEAD === 'ralph/crews-stop-hook-windows-flush-race'`; `<worktree>/plugins/crews/.claude-plugin/plugin.json` reads `version: "3.1.2"`.

---

## Story 2 — Retry-with-backoff in `lastTurnAssistantText` (PRIMARY fix for the flush race)

**Goal:** when the first `fs.readFileSync` of the transcript yields no kind-bearing report tag, sleep 500ms via `sleepSync` and re-read once before returning. Gate behind `manifest.engine === 'copilot'` (the affected shape — Claude has not been observed to show this race). One retry only (no retry-loop).

**Why this is correct:** the parser at `parseTurnReports` is sound (verified by reproduction). The race is purely on the read side: kernel writeback hadn't flushed the envelope to the file by the time the hook read it. A single 500ms backoff covers the observed flush latency band (~100ms with 2KB prose @ default Windows NTFS+Defender writeback policy). A single retry caps Stop hook latency at +500ms even when the retry fires unnecessarily (rare; almost all turns parse on the first read).

**Acceptance criteria:**

1. Add `sleepSync` to `hooks/mailbox.js`'s `module.exports` at lines 968-1030. The export shape mirrors the other helpers (just add `sleepSync,` to the object literal). Also re-export from `hooks/config.js`'s aggregated exports surface (around lines 158-180 where mailbox helpers are re-exported) so `hooks/stop.js`'s existing `const { … } = require('./config')` pattern picks it up without a second require statement.

2. Add a small predicate helper next to `lastTurnAssistantText` in `hooks/stop.js` (before line 437):

   ```js
   // Returns true when the joined assistant text from a transcript walk
   // contains at least one kind-bearing report tag. Used by the
   // flush-race retry in lastTurnAssistantText: an empty / no-kind
   // first read is the trigger, not just an empty file.
   function transcriptHasKindBearingReport(text) {
     if (!text) return false;
     try {
       const parsed = parseTurnReports(text);
       return parsed.reports.some(r => r.kind);
     } catch (e) {
       return false;
     }
   }
   ```

3. Rewrite `lastTurnAssistantText` (lines 437-456) with the retry-with-backoff:

   ```js
   // Flush-race retry (v3.2.0). Copilot CLI on Windows writes the final
   // assistant.message envelope to events.jsonl just before invoking the
   // agentStop hook. Under default NTFS+Defender writeback policy, the
   // kernel page-cache flush can lag the write by 50-500ms (observed at
   // 105ms in the 2026-06-02 diagnosis at
   // .ralph/jobs/codex-rs-feature-pruning-for-sub-45m-cold/impl-session-handoff.md).
   // If our first read misses the final envelope, the parsed assistant
   // text has no kind-bearing report tag → missing-kind-tag block fires
   // even though the tag IS on disk. Five such false-positives trip the
   // circuit breaker and disengage the session.
   //
   // Mitigation: when the first read yields no kind-bearing tag AND we
   // believe we're on the affected shape (Copilot engine, transcript
   // path provided), sleep 500ms and re-read ONCE before returning.
   // Single retry cap: don't compound latency on legitimately tag-less
   // turns (those still need to fall through to the missing-kind-tag
   // block; the retry just gives them one chance to be flush-late
   // instead of genuinely missing).
   //
   // Gated on engine='copilot' via the optional `manifestEngine` arg;
   // Claude transcripts have not been observed to show this race, so
   // the original single-read path is preserved for them. The retry
   // path is bypassed entirely when manifestEngine !== 'copilot'.
   function lastTurnAssistantText(transcriptPath, manifestEngine, cwd) {
     if (!transcriptPath) return '';
     const readOnce = () => {
       let raw;
       try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch (e) { return ''; }
       const envelopes = [];
       for (const line of raw.split(/\r?\n/)) {
         if (!line.trim()) continue;
         try { envelopes.push(JSON.parse(line)); } catch (e) {}
       }
       let userBoundary = -1;
       for (let i = envelopes.length - 1; i >= 0; i -= 1) {
         if (isUserBoundaryEnvelope(envelopes[i])) { userBoundary = i; break; }
       }
       const texts = [];
       for (let i = userBoundary + 1; i < envelopes.length; i += 1) {
         const t = extractAssistantTextFromEnvelope(envelopes[i]);
         if (t) texts.push(t);
       }
       return texts.join('\n');
     };

     const first = readOnce();
     if (manifestEngine !== 'copilot') return first;
     if (transcriptHasKindBearingReport(first)) return first;
     // Flush-race window: re-read once after a 500ms sleep.
     sleepSync(500);
     const second = readOnce();
     if (transcriptHasKindBearingReport(second)) {
       appendLog(`flush-race retry-with-backoff: recovered kind tag on second read (engine=copilot transcript=${path.basename(transcriptPath)})`, cwd);
     } else {
       appendLog(`flush-race retry-with-backoff: second read also empty/no-tag (engine=copilot transcript=${path.basename(transcriptPath)})`, cwd);
     }
     return second;
   }
   ```

4. Update the sole call site at `hooks/stop.js:723` to pass `manifest.engine` and `cwd`. Since `manifest` is read at line ~778 (after `lastTurnAssistantText`), this requires a manifest read BEFORE the retry-eligibility check. Cleanest shape: load the manifest at the top of `handleInput` (it's already needed for engine-dependent logic later), and pass `manifest.engine` to `lastTurnAssistantText`:

   ```js
   // In handleInput, BEFORE the text = lastTurnAssistantText(...) line:
   const preTextManifest = readManifest(state.name, crew, cwd) || {};
   const text = lastTurnAssistantText(data.transcript_path, preTextManifest.engine, cwd);
   ```

   Note: the existing `const manifest = readManifest(...)` at line 778 stays — it's read AFTER opportunistic delivery + after the missing-kind-tag block, by design (manifest may have changed). The new `preTextManifest` read is a separate, earlier load just for engine resolution. Both reads are cheap (small file, OS-cached after first read).

5. Ensure `path` is required at the top of `hooks/stop.js` (for `path.basename` in the log line). If not already imported, add `const path = require('path');`.

6. **Listener-loop interaction.** None. The listener heartbeat lifecycle does not call `lastTurnAssistantText`. The retry path is local to Stop hook.

7. **Body-canonical interaction.** None. Body-canonical detection happens AFTER `parseTurnReports` on the returned text; the retry simply gives the parser a better text to work with.

8. **Progress+no-bg gate (v3.1.0) bypass-tag check interaction.** The gate's bypass-tag check at `stop.js:918-923` reads the same `text` variable returned by `lastTurnAssistantText`. The retry-with-backoff in this story THEREFORE covers the bypass-tag flush race automatically — no extra change needed here at the bypass-tag check site. (Story 4's bypass-tag rename then changes WHAT the check looks for, but it still reads from the same `text` variable.)

**Edge cases the implementation MUST handle:**

- **Transcript file genuinely truncated mid-write.** `readOnce` returns whatever bytes were on disk. Both reads tolerate truncated final lines silently (try/catch on JSON.parse). If both are truly empty, fall through to existing missing-kind-tag block.
- **Manifest absent on first read.** `readManifest(...) || {}` returns `{}`; `{}.engine !== 'copilot'` is true; retry is bypassed; original single-read behavior preserved. Safe.
- **Two retries fire on the same Stop invocation.** Impossible by construction — `lastTurnAssistantText` is called once per Stop invocation at `:723`.
- **Concurrent writes during the retry sleep.** Beneficial: that's the entire point. The 500ms sleep gives the kernel time to flush concurrent writes.
- **Copilot CLI removes the transcript file mid-sleep.** `readOnce` catches the ENOENT and returns ''. The retry path returns the second-read empty string. Fall through to missing-kind-tag block. Safe.

**Files modified:**
- `hooks/stop.js` — rewrite `lastTurnAssistantText`; add `transcriptHasKindBearingReport`; thread engine through to call site; add `path` to requires if not already present. Estimated diff: +60 / -10 lines.
- `hooks/mailbox.js` — add `sleepSync` to `module.exports`. Diff: +1 line.
- `hooks/config.js` — re-export `sleepSync` via the aggregated mailbox surface. Diff: +1 line (or 0 if `module.exports = require('./mailbox')` already spreads).

**Verification:** Story 6's test suite locks the new behavior.

---

## Story 3 — Retry-with-backoff in `detect-active-bg.js::detectActiveBg` (extension of Story 2)

**Goal:** apply the same retry-with-backoff to the bg-gate's separate `events.jsonl` read path. Per operator mail `0417779c`, the bg-gate at `stop.js:930` calls `detectActiveBg`, which internally calls `readEvents` at `detect-active-bg.js:66` — a SECOND `fs.readFileSync` against the same flush-race-prone file. Without this fix, a Copilot member with a freshly-launched async shell whose `tool.execution_start` event hasn't flushed yet would trigger a false-positive "progress without bg work" block from the bg-gate, with the same circuit-breaker downstream consequences.

**Why a separate story:** the file change is in `detect-active-bg.js`, not `stop.js`. Distinct edit site, distinct test coverage. Bundled in the same ship because the bug class is identical.

**Acceptance criteria:**

1. In `detect-active-bg.js`, import `sleepSync` from `./mailbox` (since `config.js` re-exports it per Story 2 AC #1, this import goes through `require('./config').sleepSync` for consistency with the rest of the codebase):

   ```js
   const { sleepSync } = require('./config');
   ```

   Actually — `detect-active-bg.js` is a low-level helper; check whether it already imports from `./config` or `./mailbox` directly. If it already imports from `./mailbox` (likely simpler), use that.

2. Modify `detectActiveBg` (lines 164-193) to add the retry. Refactor the existing function body into a `computeOnce` helper, then wrap with a retry:

   ```js
   function detectActiveBg(opts) {
     const transcriptPath = opts && opts.transcriptPath;
     const asOf = opts && opts.asOf || null;
     const maxEvents = opts && opts.maxEvents;
     // Opt-out for tests + callers that want strictly one read.
     const retryOnEmpty = opts && opts.retryOnEmpty !== false;

     const empty = { activeCount: 0, nonListenerCount: 0, samples: [], asOf };
     if (!transcriptPath) return empty;

     const computeOnce = () => {
       const events = readEvents(transcriptPath, maxEvents);
       if (!events.length) return null;
       const { asyncStarts, shellExits } = indexEvents(events);
       const samples = [];
       for (const [shellId, start] of asyncStarts) {
         const exit = shellExits.get(shellId) || null;
         if (!isActiveAt(start, exit, asOf)) continue;
         const isListener = isListenerArmCall(start.command);
         samples.push({
           shellId,
           toolName: start.toolName,
           command: start.command.slice(0, 200),
           isListener
         });
       }
       const activeCount = samples.length;
       const nonListenerCount = samples.filter(s => !s.isListener).length;
       return { activeCount, nonListenerCount, samples, asOf };
     };

     const first = computeOnce();
     if (first !== null) return first;
     if (!retryOnEmpty) return empty;
     // Flush-race window: empty events.jsonl on first read could be the
     // kernel page-cache lag for a recently-written tool.execution_start
     // or system.notification event. Sleep 500ms and re-read once before
     // declaring "no bg work" (which would trigger the progress-bg gate
     // to block on a Copilot member that DOES have bg work).
     sleepSync(500);
     const second = computeOnce();
     return second !== null ? second : empty;
   }
   ```

3. The retry trigger is `events.length === 0` (file empty OR all lines malformed). This is the analog of `lastTurnAssistantText`'s "no kind-bearing tag found" trigger: both detect the case where the read succeeded but yielded nothing useful, which is the flush-race fingerprint.

4. Forensic logging is OUT of scope for this story — `detect-active-bg.js` has no `appendLog` precedent (it's a pure helper). The gate's existing log line at `stop.js:935` (`progress-bg-gate name=… active=N nonListener=M`) will naturally show the difference: pre-fix shows `active=0 nonListener=0` on the affected path; post-fix shows the actual counts. If retry-fire frequency telemetry becomes important later, add it via the caller side in `stop.js` (pass a callback opt or wrap the call). Out of scope now.

5. The bg-gate caller at `stop.js:930` (`detection = detectActiveBg({ transcriptPath, asOf })`) requires NO CHANGE — the retry is fully internal to `detectActiveBg`. The gate's failure-open semantics (catch throws, skip gate) still apply: if both reads return empty (genuine "no bg work"), the gate fires normally.

6. The `tests/progress-bg-gate.test.js` file passes the existing 4 scenarios verbatim (test cases that don't exercise the retry continue to pass because the default behavior with `retryOnEmpty: true` STILL returns `empty` on truly-empty-events; the retry just delays it by 500ms). Tests that want to assert single-read behavior pass `retryOnEmpty: false` explicitly.

**Edge cases the implementation MUST handle:**

- **First read returns events with no `tool.execution_start` entries.** `events.length > 0` so `computeOnce` returns a result with `activeCount: 0`. NOT a flush-race trigger; no retry. The empty result is genuine.
- **First read returns events with `tool.execution_start` but all matching `shellExits`.** Same as above — events.length > 0; returns `activeCount: 0`; no retry. Genuine "all bg work completed."
- **First read returns malformed JSONL.** `readEvents` skips malformed lines silently, returns `events.length === 0` if EVERY line was malformed. Triggers retry (which is correct — a partial-flush could be the cause).
- **Second read STILL returns empty.** Returns `empty`. Caller proceeds normally; bg-gate may fire. Correct fallback.

**Files modified:**
- `hooks/detect-active-bg.js` — add retry-with-backoff in `detectActiveBg`. Estimated diff: +30 / -25 lines (refactor body into `computeOnce`).

**Verification:** Story 6's test suite includes Test F.8 specifically for this code path.

---

## Story 4 — Bypass tag rename to crews namespace (operator mail 4b9daa70)

**Goal:** rename the v3.1.0 progress-bg-gate bypass tag from `<options-mode>background-task</options-mode>` (and 3 sibling forms) to a crews-namespaced form. Recommended: in-band bare attribute `<|report kind='progress' background-task|>` on the existing `<|report|>` tag. Keep 4 legacy `options-mode` forms recognized for ONE deprecation cycle with stderr warning. Remove in v4.0.0.

**Why this is needed:** the v3.1.0 ship borrowed the `options-mode` plugin's tag protocol verbatim, creating a cross-plugin namespace coupling. Crews should own its own bypass-tag namespace. The in-band attribute form is the cleanest fit because it uses the namespace crews already owns and keeps the bypass semantically attached to the `kind=progress` emit it modifies.

**Acceptance criteria:**

1. **Parser extension in `parseTurnReports` (`hooks/mailbox.js:907-940`).** Add a bare-token attribute detector that flags `background-task` (and `background-agent` as a sibling synonym since v3.1.0 recognized both):

   ```js
   // Inside parseTurnReports's per-match loop, after extracting kind/summary/reply-to/ack/decision/reason:
   const bgTaskRe = /\bbackground-task\b/i;
   const bgAgentRe = /\bbackground-agent\b/i;
   const bgTask = bgTaskRe.test(attrs) || bgAgentRe.test(attrs);
   reports.push({ kind, summary, replyTo, acks, decisions, body, bgTask, start, ... });
   ```

   The bare-token check is loose: it matches `background-task` as a whole word ANYWHERE in the attrs string. This handles both `<|report kind="progress" background-task|>` and `<|report background-task kind="progress"|>` (any attribute order). It does NOT require `="value"` shape because the bypass is a boolean flag.

2. **Bypass-tag check rewrite in `hooks/stop.js:918-923`.** Replace the 4 string-match conditions with a check against the parsed reports:

   ```js
   // Old:
   const hasBgTag = typeof text === 'string' && (
     text.indexOf('<options-mode>background-task</options-mode>') !== -1 ||
     text.indexOf('<options-mode>background-agent</options-mode>') !== -1 ||
     text.indexOf('[//]: # (options-mode-background-task)') !== -1 ||
     text.indexOf('[//]: # (options-mode-background-agent)') !== -1
   );

   // New (v3.2.0):
   const hasBgTagFromCrews = reports.some(r => r.bgTask);
   const hasBgTagFromLegacy = typeof text === 'string' && (
     text.indexOf('<options-mode>background-task</options-mode>') !== -1 ||
     text.indexOf('<options-mode>background-agent</options-mode>') !== -1 ||
     text.indexOf('[//]: # (options-mode-background-task)') !== -1 ||
     text.indexOf('[//]: # (options-mode-background-agent)') !== -1
   );
   if (hasBgTagFromLegacy && !hasBgTagFromCrews) {
     // Deprecation warning to stderr (visible in the agent's tool output).
     process.stderr.write(
       'crews: <options-mode>background-task</options-mode> bypass tag is DEPRECATED (cross-plugin namespace).\n' +
       'Switch to the crews-namespaced form: <|report kind="progress" background-task|>\n' +
       'Legacy form will be removed in crews v4.0.0.\n'
     );
     appendLog(`progress-bg-gate: legacy options-mode bypass tag detected name=${state.name} crew=${crew} (DEPRECATED; remove in v4.0.0)`, cwd);
   }
   const hasBgTag = hasBgTagFromCrews || hasBgTagFromLegacy;
   ```

3. **User-facing reason string at `stop.js:937` updated to instruct the NEW form:**

   ```js
   // Old:
   const reason = sanitizeReason('kind=progress needs active bg work. Use kind=question + reply-to to wait on lead, kind=done/blocked to terminate, or <options-mode>background-task</options-mode> if polling.');

   // New:
   const reason = sanitizeReason('kind=progress needs active bg work. Use kind=question + reply-to to wait on lead, kind=done/blocked to terminate, or add the background-task attribute to your report tag (e.g. <|report kind="progress" background-task|>) if polling.');
   ```

4. **AGENTS.md docs update in `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/AGENTS.md`:**
   - Lines 41 (gate trigger conditions) — update reference from `<options-mode>background-task</options-mode>` to `<|report kind="progress" background-task|>` (the new canonical form) with a footnote that legacy forms are deprecated.
   - Lines 51 (trigger reason string) — match Story 4 AC #3.
   - Lines 226 (common mistakes) — mention the deprecation cycle.
   - Line 236 (any other reference) — verify and update.

5. **CHANGELOG.md line 123 entry update** — the existing v3.1.0 CHANGELOG entry mentions the bypass tag. Add a deprecation note alongside (or as a separate v3.2.0 mention): "Note: as of v3.2.0 the bypass tag is renamed to the crews-namespaced in-band attribute `<|report kind="progress" background-task|>`; the legacy `<options-mode>background-task</options-mode>` and three sibling forms are deprecated and will be removed in v4.0.0."

6. **`tests/progress-bg-gate.test.js` cases 4+5 (lines 365, 371, 391) updates** — Story 7 covers the test rewrites in detail.

**Edge cases:**

- **Backwards compat for in-flight messages.** Operator agents on old crews versions reading new-form tags: the new form `<|report kind="progress" background-task|>` parses cleanly through the existing TAG_REPORT_REGEX (the regex captures all attrs; old parsers just ignore the bare token). Worst case on an old client: it parses the kind="progress" correctly but doesn't recognize the bypass — falls into the bg-gate, which on old clients is the v3.1.0 behavior recognizing the legacy form. Mixed-version sessions: a new-form member with an old-CLI lead sees the lead correctly parse the kind=progress; bypass behavior is engine-local (only matters at Stop hook time, which is engine-version-local). Safe.

- **Sibling-form `background-agent` token.** v3.1.0 recognized both `background-task` AND `background-agent` as bypass forms. Preserve both in the new parser extractor. The synonym is intentional (it matches the `options-mode` plugin's `<options-mode>background-agent</options-mode>` sibling shape).

- **Quoted-attribute parsing collision.** Could `background-task` appear as part of a quoted attribute value? E.g. `<|report kind="background-task progress"|>`. The bare-token regex `/\bbackground-task\b/i` would match. Unlikely in practice (no valid `kind` value contains the token), but to be defensive: scope the bare-token match to OUTSIDE quoted regions. Implementation: strip `"..."` and `'...'` regions from attrs before testing. Adds ~5 lines but is defense-in-depth against false-positive bypasses. **Decision: implement the strip-quotes defense.**

**Files modified:**
- `hooks/mailbox.js::parseTurnReports` — add `bgTask` field to reports. Diff: +8 / -2 lines.
- `hooks/stop.js:918-944` — bypass-tag check rewrite. Diff: +20 / -8 lines.
- `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/AGENTS.md` — doc updates at 4 line ranges. Diff: +15 / -10 lines.
- `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/CHANGELOG.md` — line 123 v3.1.0 entry deprecation note. Diff: +5 / -0 lines.

**Verification:** Story 7's test suite locks the rename + deprecation behavior.

---

## Story 5 — Option A + Option B from recoverable-breaker plan (notification-boundary exemption + breakerMutedUntil)

**Goal:** lift Stories 2 and 3 of `.ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md` (lines 142-450) verbatim, with one path correction: substitute `D:/ai-developer-toolkit/plugins/crews/` → `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/` in any path reference. Combined into one story because both touch `hooks/stop.js` in overlapping ranges and ship as one diff.

**Story 5a — Option A (notification-boundary exemption):**
- Lift Story 2 of recoverable-breaker plan: acceptance criteria, helper signatures (`lastUserBoundaryEnvelope`, `isSystemNotificationBoundary`), insertion site (`hooks/stop.js:763` BEFORE the existing `if (isRetry)` short-circuit), edge cases, tradeoff (notifications interleaving with user.message → most-recent boundary wins) all carry over unchanged.
- Diff size: +40 / -0 lines in `hooks/stop.js` only.

**Story 5b — Option B (`breakerMutedUntil` recoverable breaker):**
- Lift Story 3 of recoverable-breaker plan: new constant `DEFAULT_BREAKER_MUTE_MS = 60_000`, env var `CREWS_BREAKER_MUTE_MS` (capped 600_000), helpers `isBreakerMuted` / `parseBreakerMutedUntil` / `resolveBreakerMuteMs`, manifest field `breakerMutedUntil` as ISO-8601 string, removal of `clearFlag()` from breaker fire path (line 601), new early-return mute-gate after role-guard, clearing on successful outbox write, untouched cleared-member (line 647) and displaced-session (line 672) `clearFlag` sites — all carry over unchanged.
- **One addition not in the original plan:** update `hooks/protocol/manifest.js::manifestFields` to add `breakerMutedUntil`. Per research brief item 4, the current declared field count is **51** (NOT the 40/41 the existing AGENTS.md and recoverable-breaker plan both claim — both docs are stale). New count: **52**.
- Diff size: +50 / -15 lines in `hooks/stop.js`; +1 line in `hooks/protocol/manifest.js`.

**Why these two ship together with Story 2/3:** the retry-with-backoff (Stories 2/3) prevents the flush race from being the trigger. Option A removes the steady-state notification-storm trip. Option B caps the blast radius if either still trips. Three-layer defense-in-depth — each layer addresses a different failure mode of the same `consecutivePostBlocks` counter.

**Files modified:**
- `hooks/stop.js` — Option A body + Option B body. Combined diff: +90 / -15 lines.
- `hooks/protocol/manifest.js` — add `breakerMutedUntil` to `manifestFields`. Diff: +1 line.
- `tests/protocol/manifest.test.js` (or wherever the field count is pinned) — bump literal from 51 → 52. Diff: +1 / -1 line.

**Verification:** Stories 8 and 9 cover the test suite.

---

## Story 6 — Tests for retry-with-backoff (Stories 2 and 3)

**Goal:** new `tests/stop-flush-race-retry.test.js` (covers Story 2) AND extend `tests/progress-bg-gate.test.js` with a 5th case (covers Story 3 per operator mail `0417779c`).

**Test harness pattern:** per research brief item 7, the suite has no `fs.readFileSync` mocking precedent. Use a `--require` shim — `spawnSync(process.execPath, ['--require', SHIM, STOP], ...)` — where SHIM is a per-test fixture file that monkey-patches `fs.readFileSync` to return empty on the first matching call and the seeded content on the second.

**Mock shim (`tests/fixtures/mock-fs-flush-race.js`):**

```js
// Mocks fs.readFileSync to return empty bytes on the FIRST call against
// a target path, and the original content on the SECOND call. Triggered
// only when the path matches process.env.MOCK_FLUSH_RACE_PATH.
const fs = require('fs');
const original = fs.readFileSync;
let firstCallDone = false;
fs.readFileSync = function patched(target, ...rest) {
  if (typeof target === 'string' &&
      process.env.MOCK_FLUSH_RACE_PATH &&
      target === process.env.MOCK_FLUSH_RACE_PATH &&
      !firstCallDone) {
    firstCallDone = true;
    return ''; // empty bytes on first read
  }
  return original.call(this, target, ...rest);
};
```

The shim reads the mocked target path from env so the test driver pre-seeds the actual file on disk (with the kind-bearing prose or tool.execution_start events), then points both the mock and the hook input at it.

### Test cases for Story 2 (lastTurnAssistantText retry) — F.1 through F.7

(Cases F.1-F.7 as in the v1 draft; brevity here since they are unchanged. See `tests/stop-flush-race-retry.test.js` in the impl worktree.)

- **F.1** flush race — retry catches the tag (copilot engine, first read empty, second read has prose with valid kind tag → no block, counter unbumped, log line present).
- **F.2** claude engine — single-read path preserved (mock first-read empty, no retry, normal missing-kind block fires, counter = 1).
- **F.3** engine undefined — single-read path preserved (same as F.2).
- **F.4** genuine missing tag — existing block fires unchanged (retry fires but second read is also tag-less → counter bumped, forensic log line present).
- **F.5** retry latency budget — assert wall-clock < 1500ms on the F.1 path.
- **F.6** retry on isRetry path — retry still fires on stop_hook_active=true (same as F.1).
- **F.7** transcript_path absent — `lastTurnAssistantText` returns '' immediately; no `readFileSync` calls.

### Test case for Story 3 (detectActiveBg retry) — F.8

Added per operator mail `0417779c`.

**Setup:** seed `events.jsonl` with two events:
1. A `user.message` envelope (boundary).
2. A `tool.execution_start` event for `bash`/`async`/`shellId=build-watch` — the bg launch the member started moments ago.

The member's assistant prose contains `<|report kind="progress" background-task|>` (using the new crews-namespaced bypass tag per Story 4). Note: this test must pass with EITHER the new or legacy bypass tag form depending on what the impl member chose; if Story 4 adopts the in-band form, use that.

Actually: simpler approach — for F.8 we want to test the RETRY in detect-active-bg, not the bypass-tag path. So construct the test to trip the bg-gate's `detectActiveBg` call by having a `kind="progress"` emit with NO bypass tag (the gate then needs to see active bg work to allow the turn). The setup:
1. Seed `events.jsonl` with `user.message` + `tool.execution_start` (bash/async/shellId=build-watch).
2. The member's prose contains `<|report kind="progress" summary="building..."|>` (no bypass tag).
3. Mock `fs.readFileSync` to return empty on the FIRST call matching the events.jsonl path AFTER the first call (the first call is by `lastTurnAssistantText` for the text; the second call is by `detectActiveBg::readEvents` for the events).

**Wait** — the mock fixture needs refinement. `lastTurnAssistantText` calls `readFileSync(transcriptPath)` first. Then `detectActiveBg::readEvents` calls `readFileSync(transcriptPath)` again with the same path. We want the SECOND call (the `readEvents` one) to return empty on its first invocation, then content on its second (the in-detect retry). Use a call counter on the mock:

```js
// In mock-fs-flush-race-detect-active-bg.js
const fs = require('fs');
const original = fs.readFileSync;
let callCount = 0;
const detectActiveBgFirstCallIdx = parseInt(process.env.MOCK_DETECT_ACTIVE_BG_CALL_IDX || '2', 10); // 0-based: 0=lastTurnAssistantText, 1=detectActiveBg first read, 2=detectActiveBg second read
let detectFirstReadDone = false;
fs.readFileSync = function patched(target, ...rest) {
  if (typeof target === 'string' &&
      process.env.MOCK_FLUSH_RACE_PATH &&
      target === process.env.MOCK_FLUSH_RACE_PATH) {
    callCount += 1;
    if (callCount === 2 && !detectFirstReadDone) {
      detectFirstReadDone = true;
      return ''; // empty on detectActiveBg's first read — simulates flush race for the events.jsonl events
    }
  }
  return original.call(this, target, ...rest);
};
```

Simpler shape: the test can call `detectActiveBg` DIRECTLY in a unit test, bypassing the Stop hook subprocess and the lastTurnAssistantText complexity. Then the F.8 test becomes a direct module-level test:

```js
// In tests/progress-bg-gate.test.js (Case 5, added by Story 7):
const { detectActiveBg } = require('../hooks/detect-active-bg');
const fs = require('fs');
const tmpPath = path.join(tmpDir('crews-bg-race-'), 'events.jsonl');
fs.writeFileSync(tmpPath, '{"type":"tool.execution_start","data":{"toolName":"bash","arguments":{"mode":"async","shellId":"build-watch","command":"build"}},"timestamp":"2026-06-03T13:00:00.000Z"}\n');

// Monkey-patch fs.readFileSync inside this process to return empty on FIRST call:
const originalRead = fs.readFileSync;
let firstDone = false;
fs.readFileSync = function(target, ...rest) {
  if (target === tmpPath && !firstDone) { firstDone = true; return ''; }
  return originalRead.call(this, target, ...rest);
};

const result = detectActiveBg({ transcriptPath: tmpPath, asOf: '2026-06-03T13:01:00.000Z' });
// After retry, the bg shell is detected
equal(result.activeCount, 1, 'F.8: retry detects bg shell after flush race');
equal(result.nonListenerCount, 1);

fs.readFileSync = originalRead; // restore
```

**Files added/modified:**
- `tests/stop-flush-race-retry.test.js` (NEW; ~180 lines covering F.1-F.7)
- `tests/fixtures/mock-fs-flush-race.js` (NEW; ~25 lines)
- `tests/progress-bg-gate.test.js` (EXTEND with Case 5 / F.8; ~30 lines added; covered formally in Story 7)

---

## Story 7 — Tests for bypass tag rename (Story 4)

**Goal:** update `tests/progress-bg-gate.test.js` cases 4 and 5 to use the new crews-namespaced form, AND add a deprecation test case verifying the legacy `options-mode` form still works + emits stderr warning. The Test F.8 from Story 6 ALSO lives in this file (since it touches the same code surface).

**Test cases (extending `tests/progress-bg-gate.test.js`):**

### Case 4-updated: new in-band bypass tag form is recognized

Drive Stop with a Copilot member emitting `<|report kind="progress" background-task|>` in prose, no real bg work. Assert:
- Stop exits 0 with the existing pass-path output.
- No `decision: 'block'`.
- `progress-bg-gate` log line shows the gate evaluated but didn't block (because `hasBgTag === true`).
- Manifest `consecutiveStopBlocks` unchanged.

### Case 5-updated: deprecation warning fires on legacy options-mode form

Drive Stop with a Copilot member emitting `<options-mode>background-task</options-mode>` in prose, no real bg work, NO new-form tag. Assert:
- Stop exits 0 (the legacy form is still recognized — backwards compat for deprecation cycle).
- Stderr contains `crews: <options-mode>background-task</options-mode> bypass tag is DEPRECATED`.
- `crews.log` contains `progress-bg-gate: legacy options-mode bypass tag detected ... (DEPRECATED; remove in v4.0.0)`.
- Manifest `consecutiveStopBlocks` unchanged.

### Case 5b (new): legacy + new BOTH present, only ONE warning

Drive Stop with both `<options-mode>background-task</options-mode>` AND `<|report kind="progress" background-task|>` in prose. Assert:
- Stop exits 0 normally.
- No stderr warning (the new-form match short-circuits the legacy-form check per Story 4 AC #2's `if (hasBgTagFromLegacy && !hasBgTagFromCrews)` guard).

### Case 5c (new): legacy CommonMark form deprecation

Drive Stop with `[//]: # (options-mode-background-task)` in prose. Same assertion as Case 5-updated (deprecation warning fires, gate doesn't block, legacy form recognized).

### F.8 (from Story 6): detect-active-bg retry catches flush race

Per Story 6's description; the test directly invokes `detectActiveBg` with a monkey-patched `fs.readFileSync` returning empty on first call. Assert `activeCount === 1` after the retry catches the seeded `tool.execution_start` event.

### Case 6 (new): bare-token bypass attribute outside quoted regions

Drive Stop with `<|report kind="background-task progress"|>` (a contrived case where the bare-token regex `/\bbackground-task\b/i` would match inside the quoted kind value if we didn't strip quotes). Assert:
- Per Story 4 AC #4 (strip-quotes defense), the bare-token detector does NOT trigger on quoted-region matches.
- `hasBgTagFromCrews === false` for this report.
- Gate fires normally if no real bg work.

This case locks the defensive scoping of the bare-token detector to OUTSIDE quoted regions.

**Files modified:**
- `tests/progress-bg-gate.test.js` — update cases 4, 5; add cases 5b, 5c, F.8, 6. Diff: +120 / -30 lines.

---

## Story 8 — Tests for Option A from Story 5 (notification-boundary exemption)

**Goal:** new `tests/stop-allow-system-notification-boundary.test.js` lifted from Story 4 of `.ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md` (lines 453-568). Seven test cases (A.1 through A.7) lock the notification-boundary exemption.

**Files added:**
- `tests/stop-allow-system-notification-boundary.test.js` (~200 lines)

---

## Story 9 — Tests for Option B from Story 5 (recoverable breaker) + cross-impact updates

**Goal:** rewrite `tests/stop-circuit-breaker.test.js` per Story 5 of `.ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md` (lines 572-732). Replace OLD assertions (`equal(cfg.readFlag(SESS, cwd), null, ...)` etc.) with the new recoverable contract: flag preserved, `breakerMutedUntil` set as ISO-8601 string, mute window honored.

**Cross-impact updates per the recoverable-breaker plan's "Other suite tests" subsection (§683-722):**

- **`tests/review-gate.test.js:440-451`** — update assertion at line 450 from "flag cleared" to "flag preserved + `breakerMutedUntil` is parseable ISO-8601 in the future"; line 449 reason-string check needs to handle the new "temporarily muted" wording; line 448 ("runaway block loop") stays unchanged (Story 5b keeps that phrase).
- **`tests/stop-displaced-session.test.js`** — comments reference the breaker but no assertions encode the OLD contract per the research brief. Run the test post-fix to verify no breakage; no edits expected.
- **`tests/first-turn-listener-guard.test.js`** — listener-unreachable bump path, NOT a breaker fire site. No edits expected.

**Mandatory pre-commit scan command** (run from the impl worktree):

```bash
rg -n 'clearFlag\(|runaway block loop|consecutiveStopBlocks: 5|circuit breaker clears' tests/
```

Every match must be reviewed against the new contract and either preserved (semantic unchanged) or updated. Captured grep results saved to `<impl-job-dir>/cross-impact-grep.md`. If any NEW call site surfaces (a test not listed above that fails to match the new contract), the impl member surfaces a `kind=question` to the lead before committing.

**Files modified:**
- `tests/stop-circuit-breaker.test.js` (rewritten in place; ~150 lines)
- `tests/review-gate.test.js:440-451` (updates)

---

## Story 10 — Upstream feature request: `docs/copilot-cli-fsync-upstream-ask.md`

**Goal:** file the long-term root-cause fix as an upstream feature request to GitHub Copilot CLI, captured as a docs deliverable in the crews plugin. Two requested behaviors (either is acceptable):

1. **fsync after final assistant.message of a turn.** Copilot CLI calls `fs.fsync()` (or `fdatasync`) on the events.jsonl file descriptor after writing the final `assistant.message` envelope of a turn AND before invoking the `agentStop` hook. Eliminates the page-cache flush race entirely.

2. **Pass final assistant text + recent tool events directly in the hook input payload.** The `agentStop` hook input gains two new fields: `assistant_message_content` (the final assistant.message body) and `recent_events` (the last N events). The hook can read them directly without re-reading the transcript. Most robust shape — the race ceases to exist by design because the data flows in-process rather than via a shared file.

**Acceptance criteria:**

1. Write `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/docs/copilot-cli-fsync-upstream-ask.md` with:
   - Background: link to the 2026-06-02 diagnosis handoff + the in-house mitigation (Stories 2/3 retry-with-backoff).
   - Reproduction protocol: standalone bash script using `spawnSync` to drive the agentStop hook against an events.jsonl that was written by a concurrent process; assert flush latency >100ms with prose >2KB under Windows NTFS+Defender.
   - Two requested behaviors as above.
   - Note that the in-house retry-with-backoff is a workaround; the upstream fix is preferred long-term because (a) it removes the +500ms Stop latency on the affected path, (b) it eliminates the retry-with-backoff edge case where 500ms isn't enough, (c) it covers BOTH read paths (lastTurnAssistantText + detectActiveBg) uniformly.
   - Link the GitHub issue URL placeholder (`https://github.com/github/copilot-cli/issues/<TBD>`) once filed.

2. Do NOT block this ship on the upstream filing or acceptance. The docs deliverable IS the action item; subsequent operator action (filing the issue) is a separate task.

**Files added:**
- `docs/copilot-cli-fsync-upstream-ask.md` (~80 lines)

---

## Story 11 — Version bump, CHANGELOG, AGENTS.md active-versions table fix

**Acceptance criteria:**

1. Run `node plugins/crews/scripts/bump-version.js 3.2.0` from inside the impl worktree's `plugins/crews/` directory. Verify with `node plugins/crews/tests/version.test.js`.

2. Append CHANGELOG.md §3.2.0 entry. Template (operator chooses final commit-date YYYY-MM-DD at commit time):

   ```markdown
   ## 3.2.0 - <YYYY-MM-DD>

   Four co-shipped fixes addressing a P0 missing-kind-tag false-positive
   bug on Copilot members (discovered 2026-06-02; operator urgency note
   2026-06-03T06:05Z confirming Claude Code deprecation forces Copilot
   to be the supported impl engine). Full diagnosis at
   `.ralph/jobs/codex-rs-feature-pruning-for-sub-45m-cold/impl-session-handoff.md`
   in the codexu repo.

   The symptom: a Copilot member emitted a valid `<|report kind="progress" ...|>`
   tag in its final assistant prose; the tag was persisted in
   `events.jsonl` at envelope N (verified via hex-dump); but the
   agentStop hook running 105ms later read the file before the kernel
   page-cache had flushed envelope N to disk, saw a tag-less transcript,
   and bumped `consecutiveStopBlocks`. After 5 such false-positives the
   circuit breaker fired and called `clearFlag()`, permanently
   disengaging the session.

   Four co-shipped changes:

   - **Retry-with-backoff in `lastTurnAssistantText`** (Story 2 in the
     plan). When the first read of `events.jsonl` yields no kind-bearing
     report tag AND `manifest.engine === 'copilot'`, the hook sleeps
     500ms (via the existing `sleepSync` helper, newly exported from
     `hooks/mailbox.js`) and re-reads once before returning. Covers the
     observed kernel page-cache writeback latency band (~100ms with 2KB
     prose). Single retry; gated on copilot engine so the Claude path
     is unchanged.

   - **Retry-with-backoff in `detect-active-bg.js::detectActiveBg`**
     (Story 3 in the plan; co-shipped per operator mail
     `0417779c-b4e3-49a0-9704-ecc4446d9aa7` 2026-06-03T06:22Z). The
     v3.1.0 progress-bg gate has its own `fs.readFileSync` of
     `events.jsonl` to scan for `tool.execution_start` /
     `system.notification` events. Same race surface as
     `lastTurnAssistantText`. When `readEvents` returns an empty result,
     sleep 500ms and re-read once. Without this fix, a Copilot member
     with a freshly-launched async shell whose `tool.execution_start`
     event hasn't flushed yet would trigger a false-positive "progress
     without bg work" block.

   - **Bypass tag rename to crews namespace** (Story 4 in the plan;
     co-shipped per operator mail
     `4b9daa70-fa29-4b4e-bf75-59e3fb6c2002` 2026-06-03T06:28Z). The
     v3.1.0 progress-bg gate borrowed the `options-mode` plugin's
     `<options-mode>background-task</options-mode>` tag verbatim — a
     cross-plugin namespace coupling smell. Renamed to the in-band
     attribute form `<|report kind="progress" background-task|>` on the
     existing `<|report|>` tag that crews already owns. Parser
     extension is additive (new `report.bgTask` boolean field exposed
     by `parseTurnReports`); no regex changes. Four legacy
     `options-mode`-namespaced forms (HTML + CommonMark × task + agent)
     remain recognized for ONE deprecation cycle with a stderr warning
     telling the user to switch. **Legacy forms will be removed in
     crews v4.0.0.**

   - **Notification-boundary exemption + recoverable circuit breaker**
     (Story 5 in the plan; resurrects the previously-deferred design
     at `.ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md`).
     The missing-kind-tag block now exempts turn-ends whose last
     user-typed envelope is a `system.notification` (Copilot CLI shape).
     The circuit breaker no longer calls `clearFlag()` (permanent
     disengagement). It instead sets `manifest.breakerMutedUntil` to
     `now + 60s` (tunable via `CREWS_BREAKER_MUTE_MS`). During the mute
     window, Stop is silently inert; after, it re-engages naturally;
     a successful outbox write clears both the counter and the mute.
     Caps the blast radius of any future breaker fire at the mute
     duration rather than the session lifetime. Naturally bounds the
     member-side close-tab loop observed in the original bug.

   Defense-in-depth combination: Stories 2/3 prevent the single-turn
   flush race on both code paths; Story 5a prevents the steady-state
   notification-storm trip from `--parallel` impl sub-agents; Story 5b
   caps the blast radius if either still trips. Story 4 fixes an
   orthogonal cross-plugin namespace bug surfaced by the operator
   during review.

   Tests:
   - New `tests/stop-flush-race-retry.test.js` locks the
     `lastTurnAssistantText` retry with 7 cases.
   - New `tests/stop-allow-system-notification-boundary.test.js` locks
     the Option A exemption with 7 cases.
   - `tests/stop-circuit-breaker.test.js` rewritten to assert the new
     mute-window contract.
   - `tests/progress-bg-gate.test.js` extended with case F.8
     (`detectActiveBg` retry) plus cases 4/5/5b/5c/6 covering the
     bypass tag rename + deprecation warning + bare-token defensive
     scoping.
   - `tests/review-gate.test.js:440-451` updated for the new
     "temporarily muted" wording and the flag-preserved assertion.

   Manifest schema change: `breakerMutedUntil` field added (52 total
   declared fields; was 51). Pre-3.2.0 manifests have the field as
   null/undefined; `isBreakerMuted` treats null as "not muted." No
   migration required.

   No envelope-wire-format changes. Stop hook latency adds at most
   500ms on the affected Copilot retry path (rare; almost all turns
   parse on the first read).

   Long-term root cause: an upstream feature request to GitHub Copilot
   CLI asks for `fs.fsync()` after writing the final assistant.message
   envelope of a turn before invoking the agentStop hook (or, more
   robustly, passing the final assistant text + recent tool events
   directly in the hook input payload). Documented in
   `docs/copilot-cli-fsync-upstream-ask.md`. The retry-with-backoff is
   the in-house mitigation until upstream lands.
   ```

3. **AGENTS.md active-versions table fix — LEAD RESPONSIBILITY, NOT IMPL.** Per operator mail `81030d74-a452-466c-8c10-0cfded8e8836` 2026-06-03T06:41Z: "Lead does FF-merge + bumps codexu submodule pointer + updates AGENTS.md active-plugin-versions table (3.1.0 → 3.2.0) + runs copilot plugin update on this session." The impl-phase member does NOT touch the codexu side. The impl member ships ONLY the toolkit-side commit + push (Story 12). The lead handles the codexu submodule pointer bump + AGENTS.md table update + `copilot plugin update` after FF-merge.

**Files modified BY THIS STORY (toolkit-side only — codexu-side moved to lead per operator decision):**
- `plugins/crews/.claude-plugin/plugin.json` (via bump script)
- `plugins/crews/.github/plugin/plugin.json` (via bump script)
- `.claude-plugin/marketplace.json` (via bump script)
- `.github/plugin/marketplace.json` (via bump script)
- `.agents/plugins/marketplace.json` (via bump script)
- `plugins/crews/tests/version.test.js` (via bump script)
- `plugins/crews/CHANGELOG.md` (manual)

`D:/harness-efforts/codexu/AGENTS.md` is **NOT** modified by the impl member. The lead handles that post-FF-merge.

---

## Story 12 — End-to-end smoke + commit + push (TOOLKIT-SIDE ONLY)

**Goal:** validate the fix actually closes the original bug, commit the toolkit-side diff with a body-canonical message, push to all three toolkit remotes (origin / personal / gim-home), and produce a ship-manifest summary the LEAD uses to (a) FF-merge on the three toolkit remotes, (b) bump the codexu submodule pointer + AGENTS.md table in a separate codexu commit, (c) push codexu to both codexu remotes, (d) run `copilot plugin update` on the lead session, (e) update `.ralph-overview/data.json`.

**Critical scope correction (operator mail `81030d74-a452-466c-8c10-0cfded8e8836` 2026-06-03T06:41Z):** the impl member does NOT touch the codexu side. Steps 9-11 below are LEAD responsibility, listed here for completeness so the impl member's final report enables the lead to act atomically.

**Acceptance criteria:**

1. **Pre-commit cross-impact scan** (from impl worktree's `plugins/crews/`):

   ```bash
   grep -n "clearFlag\|consecutiveStopBlocks\|breakerMutedUntil\|background-task\|background-agent" hooks/*.js > <impl-job-dir>/grep-source.md
   rg -n 'clearFlag\(|runaway block loop|consecutiveStopBlocks: 5|circuit breaker clears|options-mode|background-task' tests/ > <impl-job-dir>/grep-tests.md
   ```

   Every hit must be reviewed against the new contract.

2. **Full crews test suite** (from impl worktree's `plugins/crews/`):

   ```bash
   node tests/run.js 2>&1 | tee <impl-job-dir>/test.log
   ```

   Expected: 0 failures, suite under 90s on Windows at default concurrency.

3. **E2E flush-race smoke** (lastTurnAssistantText path). Save to `<impl-job-dir>/smoke-flush-race-text.md`.

4. **E2E detect-active-bg smoke** (Story 3 path). Save to `<impl-job-dir>/smoke-flush-race-detect-bg.md`.

5. **E2E bypass tag rename smoke** (Story 4 path). Save to `<impl-job-dir>/smoke-bypass-tag.md`.

6. **E2E breaker-recovery smoke** (Story 5b path). Save to `<impl-job-dir>/smoke-breaker-recovery.md`.

7. **Toolkit commit** (in the toolkit worktree, after all tests pass). Body-canonical message; template below.

8. **Toolkit push to all three remotes:**

   ```bash
   git push origin ralph/crews-stop-hook-windows-flush-race
   git push gim-home ralph/crews-stop-hook-windows-flush-race
   git push personal ralph/crews-stop-hook-windows-flush-race
   ```

   The `gim-home` push is load-bearing — `copilot plugin update` reads from `gim-home/main`. Surface failures as `kind=question` to the lead.

9. **LEAD STEP (not impl): codexu submodule-pointer-bump commit.** After the lead FF-merges the toolkit topic branch to `main` on all three toolkit remotes:
   - `git add ai-developer-toolkit` (bumps submodule gitlink)
   - Update `D:/harness-efforts/codexu/AGENTS.md` active-versions table row for `crews` → `3.2.0` (current stale value depends on snapshot; research brief item 9 saw `3.0.1`; operator mail referenced `3.1.0`; either way the target is `3.2.0`)
   - Commits with body-canonical message
   - Pushes to both codexu remotes (origin + personal)

10. **LEAD STEP (not impl): `copilot plugin update`** on the lead session. Refreshes crews from `gim-home/main` to v3.2.0 in the lead's running Copilot CLI. Deployment trigger for fleet-wide v3.2.0.

11. **LEAD STEP (not impl): `.ralph-overview/data.json` update.** Per bookkeeper "ship the bookkeeping update the same turn" invariant: flip `lifecycle: "tracked"` → `"merged"`, add `shipManifest`, refresh `lastTouchedAt`.

12. **Impl final report to the lead** (`kind=done` turn) MUST include:
    - Toolkit commit SHA + topic branch + worktree path (the ONLY commit the impl made)
    - Test suite pass count
    - One-line summary of each of the 4 smokes (steps 3-6)
    - List of remotes pushed (3 toolkit remotes ONLY; impl does NOT push codexu)
    - Reminder to the lead about the 3 lead-side post-merge actions (steps 9-11)
    - Confirmation that the impl did NOT touch `D:/harness-efforts/codexu/AGENTS.md` (lead handles in step 9)

**Toolkit commit message template (Story 12 step 7):**

```
crews(v3.2.0): fix Copilot Stop-hook flush race (both read paths) + recoverable breaker + bypass tag rename

Four co-shipped Stop-hook fixes for the P0 missing-kind-tag false-
positive bug discovered 2026-06-02 (operator urgency note
2026-06-03T06:05Z forcing Copilot as supported impl engine). Full
diagnosis at .ralph/jobs/codex-rs-feature-pruning-for-sub-45m-cold/impl-session-handoff.md
in codexu; per-story acceptance at
.ralph/jobs/crews-stop-hook-windows-flush-race/plan.md.

- Retry-with-backoff in lastTurnAssistantText. When the first read
  of events.jsonl yields no kind-bearing report tag AND
  manifest.engine === 'copilot', sleep 500ms via sleepSync (newly
  exported from hooks/mailbox.js) and re-read once. Covers the
  observed kernel page-cache writeback latency band on Windows
  NTFS+Defender (~100ms with 2KB prose, observed at 105ms in the
  2026-06-02 diagnosis). Single retry; copilot-gated.

- Retry-with-backoff in detect-active-bg.js::detectActiveBg.
  Co-shipped per operator mail 0417779c 2026-06-03T06:22Z. The
  v3.1.0 progress-bg gate has its own readFileSync of events.jsonl
  subject to the same race for freshly-launched async shells whose
  tool.execution_start event hasn't flushed.

- Bypass tag rename to crews namespace. Co-shipped per operator
  mail 4b9daa70 2026-06-03T06:28Z. The v3.1.0 ship borrowed
  <options-mode>background-task</options-mode> from the separate
  options-mode plugin — cross-plugin namespace coupling smell.
  Renamed to in-band attribute form <|report kind="progress"
  background-task|> on the crews-owned <|report|> tag. Four legacy
  forms recognized for one deprecation cycle with stderr warning.
  Removed in v4.0.0.

- Notification-boundary exemption + recoverable circuit breaker.
  Resurrects the deferred design at
  .ralph/jobs/crews-stop-circuit-breaker-recoverable/plan.md. The
  breaker no longer calls clearFlag() (permanent disengagement); it
  sets manifest.breakerMutedUntil = now + 60s. During the mute
  window, Stop is silently inert; after, it re-engages naturally.

Tests: new tests/stop-flush-race-retry.test.js (7 cases);
tests/stop-allow-system-notification-boundary.test.js (7 cases);
tests/stop-circuit-breaker.test.js rewritten;
tests/progress-bg-gate.test.js extended with F.8 + bypass tag cases.

Manifest: breakerMutedUntil field added (52 total). Backward
compatible. No wire format changes.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

**Files modified by impl member:** none beyond `<impl-job-dir>/*.md` artifacts. The codexu-side commit + AGENTS.md table update + `copilot plugin update` + `.ralph-overview/data.json` are ALL lead responsibilities (steps 9-11).


---

## Open questions (none load-bearing — plan is execution-ready pending multi-model review)

1. **(LOAD-BEARING for plan recommendation but not execution) Variant (i) force-exit counter OR (ii) recoverable-breaker resurrection?** This plan recommends (ii). Multi-model review (Phase 4) is explicitly asked to validate or dissent.

2. **Should the retry sleep be 500ms or longer?** Tunability via an env var (e.g. `CREWS_FLUSH_RACE_RETRY_MS`) is a follow-up if real-world telemetry shows 500ms is wrong. Not in this ship.

3. **Should we implement Option (b) file-watch alternative?** Defer. Re-evaluate if Story 2/3's retry-with-backoff proves empirically insufficient post-ship.

4. **Does Claude Code emit any envelope shape that should also be exempt under Option A (Story 5a)?** No (already analyzed).

5. **Should the recoverable breaker emit a system mailbox notification to the lead when it fires?** Ideal but adds scope. Follow-up v3.3.0.

6. **`--require` shim pattern interaction with worker-thread runner.** Per research brief item 7, no precedent; verify in implementation.

7. **AGENTS.md "Active plugin versions" CI invariant** — out of scope; the stale-table state at v3.0.1 shows the invariant is either not enforced or silently failing.

8. **(NEW) Bypass tag form — in-band attribute vs sibling tag?** Plan recommends in-band per operator mail 4b9daa70. Multi-model review asked to verify parser feasibility.

9. **(NEW) Bare-token quoted-region defense in `parseTurnReports`** — Story 4 AC #4 adds quote-strip before bare-token regex test. Multi-model review asked to validate (cost: ~5 lines; benefit: defensive against a theoretical false-positive bypass).

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| 500ms retry sleep insufficient for heavy-Defender / >5KB prose | Medium | Recoverable-breaker (Story 5b) caps blast radius at 60s mute. Empirical telemetry via `crews.log` retry-fired frequency. |
| `--require` shim breaks under worker-thread runner | Low | Mock runs in subprocess, not worker. Fallback: `Module._compile` patch or DI refactor of `lastTurnAssistantText`. |
| `manifestFields` count assertion test misses bump 51 → 52 | Low | Story 5b explicitly identifies + updates; Story 12 pre-commit grep catches. |
| Claude transcript path regressed by retry change | Very low | Retry gated on `manifest.engine === 'copilot'`; tests F.2/F.3 lock single-read preservation. |
| New tests push suite above 60s ceiling | Medium | Story 12 step 2 raises ceiling to 90s; serial denylist available as fallback. |
| Operator manually edits `breakerMutedUntil` to malformed | Low | `parseBreakerMutedUntil` returns null for non-parseable. |
| Fix doesn't actually close original bug | Low | Story 12 E2E smokes run pre-fix vs post-fix; mismatch surfaces `kind=blocked`. |
| Two-commit ship breaks if codexu pointer commit lands but toolkit topic branch fails to FF | Low-medium | Lead FF-merge atomically; revert + retry on failure. |
| `gim-home` push fails (SAML re-auth) | Medium | Per codexu AGENTS.md remotes section; trigger fresh SAML URL. Surface as `kind=question` if persistent. |
| (NEW) Bypass tag rename breaks operators using legacy form | Very low | Legacy forms recognized for one deprecation cycle with warning; removal deferred to v4.0.0. |
| (NEW) Bare-token bypass attribute false-positive on `<|report kind="background-task progress"|>` | Very low | Story 4 AC #4 strip-quotes defense scopes the bare-token detector to outside quoted regions. Case 6 locks this. |
| (NEW) `detectActiveBg` retry adds 500ms latency to every Stop where no bg work was launched | Medium | Acceptable: this is the worst-case latency cap. Most Copilot members don't launch bg shells at all, so events.jsonl always has SOME events (assistant.message, tool.execution_complete, etc.) → `events.length > 0` → no retry. The retry only fires on genuinely-empty events.jsonl, which is rare. |

---

## Handoff to `/implement-with-ralph`

This plan is execution-ready as `/implement-with-ralph --from-plan <plan-path> --autonomous`. The `--parallel` mode is INTENTIONALLY NOT used.

**Spawn-prompt template for the impl member:**

```
/implement-with-ralph --from-plan D:/harness-efforts/codexu/.ralph/jobs/crews-stop-hook-windows-flush-race/plan.md --autonomous
```

The impl member should follow Stories 1-12 in order. Story 1 (preflight) must complete before any code edits. Story 12 must complete with all 5 remotes pushed (3 toolkit + 2 codexu) before emitting `kind=done`.

**Parallel handoff:** `INTENTIONALLY NOT OFFERED.`
