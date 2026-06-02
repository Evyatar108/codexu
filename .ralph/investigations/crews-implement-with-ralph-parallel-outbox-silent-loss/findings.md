# Findings — crews `--parallel` impl member silent-outbox loss

**Member:** `impl-ai-developer-toolkit-submodule`
**Crew:** `ralph-pipeline` (overview-bookkeeper lead)
**Engine:** Copilot CLI v1.0.57 + crews v3.0.0
**Spawn:** 2026-06-02T14:28:14Z (`/implement-with-ralph --from-plan ... --parallel --suggested-decomposition ... --autonomous`)
**Terminated:** 2026-06-02T16:19:26Z (operator hard-stop, 1h 51m later)
**Outbox:** 0 bytes (no envelopes persisted across the entire session)
**Investigation:** read-only, member `investigate-crews-implement-with-ralph-parallel-outbox-silent-loss`

---

## Executive summary

The crews v3.0.0 Stop hook fired its safety **circuit breaker** at 14:31:18 — about 3 minutes after spawn — after 5 consecutive missing-kind-tag blocks. The breaker called `clearFlag(sessionId)` (`hooks/stop.js:600`), which **silently and permanently disengages the session from the crew**. Every Stop hook invocation after that point short-circuits at the role-guard at `hooks/stop.js:572` and writes nothing — even though the model did emit ≥3 well-formed `<|report kind="..."|>` tags after the breaker fired (verifiable in the transcript). The 8 in-transcript tag-bearing assistant messages produced 0 outbox rows because the protocol was disabled by the time any of them ran through Stop.

The reason the breaker fired so quickly is the load-bearing one for the bug report: **`/implement-with-ralph --parallel --suggested-decomposition`** orchestration generates `system.notification` events (sub-agent progress, async shell completions, etc.) at a rate that produces many tiny "respond to a notification" turns. Each such turn-end fires `agentStop`. The model treats these notifications as continuations of an ongoing multi-tool flow and does not emit a kind tag on each one. The 5-block budget is exhausted in tens of seconds. This is not a model-discipline failure that better prompting could fix — it is a structural mismatch between Copilot CLI's `--parallel` turn semantics and the crews 1-tag-per-Stop protocol.

The recommended fix is therefore in the protocol, not the model. Interim mitigation: ban `--parallel` impl spawns until a fix lands. The in-progress 7-cluster work IS salvageable (5/7 branches already merged on integration; 1 small conflict; 1 unlaunched cluster).

---

## 1. Root cause

### Verdict

**New hypothesis H5 (added during investigation):** Copilot CLI's `--parallel --suggested-decomposition` orchestration interleaves `system.notification` events with assistant turns at a rate that **overwhelms the kind-tag protocol's 5-block circuit breaker (`MAX_CONSECUTIVE_STOP_BLOCKS`)**. Once the breaker fires, `clearFlag()` permanently disengages the session — and the manifest is reset (`consecutiveStopBlocks: 0`, `lastStopBlockReason: null`) so the post-mortem looks like "no blocks ever happened" rather than "we tripped the breaker."

**The four listed hypotheses are all rejected by direct evidence:**

| | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | `--parallel` runs all stories in one super-turn that never reaches Stop | **REJECTED** | The transcript has 105 `assistant.turn_end` events and 247 `hook.end` events. Stop hooks fired plenty. |
| H2 | Tags inside ```` ``` ```` code fences were stripped by the parser | **REJECTED** | `TAG_REPORT_REGEX` (`hooks/mailbox.js:136-139`) is a simple `<|\s*report\s+(.*?)\s*\|>` `gi` regex — it matches inside code fences. The 8 tag-bearing assistant messages have plain inline tags, not fenced ones. |
| H3 | `CREWS_STRICT_SCHEMA=1` rejected envelopes during validation | **REJECTED** | Strict-mode checks tag SHAPE (`hooks/protocol/report-tags.js:17-35`); it would surface as a "schema-warning" log entry, not silent loss. The Stop hook's block reason was always "missing kind tag" (no tag parsed), never "tag invalid." |
| H4 | Some other unknown interaction | **REPLACED BY H5** | The replacement is mechanism-complete and reproduces the manifest fingerprint exactly. |

### Mechanism, end-to-end

1. **Spawn (14:28:14).** Copilot CLI starts. SessionStart fires; manifest gets `transcriptPath` populated correctly (the broken member's transcript file exists at `C:\Users\evmitran\.copilot\session-state\3cf8ea73.../events.jsonl`, 7.4 MB, last-written at 16:08:15 — well after the breaker fire). The known-good `impl-codex-channels-option-b` also got `transcriptPath` populated, so the `transcriptPath: null` value visible in the broken manifest TODAY is NOT a SessionStart failure — see step 5 below.

2. **First few turns (14:30:10 – 14:30:49, ~39s).** Four consecutive `agentStop` invocations return `decision: block, reason: "You stopped without emitting a kind tag…"` (visible in the transcript hook.end entries). Each invocation calls `bumpBlockCount` (`hooks/stop.js:496-509`) which increments `manifest.consecutiveStopBlocks` and records `lastStopBlockReason = "missing kind tag"`. Why the tags are missing on these turns is mechanism step 6.

3. **Circuit-breaker fires (14:31:18).** The fifth check finds `consecutiveStopBlocks >= MAX_CONSECUTIVE_STOP_BLOCKS (5)` at `hooks/stop.js:585`. The breaker:
   - Logs `CIRCUIT-BREAKER fired …`.
   - **Resets `consecutiveStopBlocks: 0`, `lastStopBlockReason: null`** (`hooks/stop.js:594-598`). This is why the broken manifest reads `consecutiveStopBlocks: 0, lastStopBlockReason: null, lastStopBlockAt: 14:31:04.803Z` (a stale-but-non-null timestamp from the last bump before reset).
   - **Calls `clearFlag(data.session_id, cwd)`** (`hooks/stop.js:600`). This removes the session→actor mapping from the flag pointer file.
   - Returns a one-shot block envelope to Copilot CLI telling the operator to close the tab. **Copilot does NOT close the tab** (the model treats the block as a regular hook message and keeps going).

4. **All subsequent Stop hooks are inert (14:31:18 → 16:08).** Every later `agentStop` invocation calls `RuntimeContext.fromHook(data)` which reads the now-cleared flag. `runtimeCtx.flag.role` is empty/null, so the role-guard early-return at `hooks/stop.js:572-575` fires:
   ```js
   if (!state || (state.role !== 'member' && state.role !== 'lead') || !state.name) {
     appendLocatorFailureForInput('stop', data, { reason: 'role-guard' });
     return;
   }
   ```
   No outbox write. No block reason. The hook returns `{}` (no decision). The Copilot CLI lets the model continue.

5. **The model emits 8 well-formed `<|report kind="..."|>` tags during this dead window** (visible in transcript; e.g. the `kind="progress" summary="Phase 3 BLOCKED on AGENTS.md merge conflict…"` tag at 16:01:42 and the model's own self-aware "I missed emitting `<|report kind="..."|>` tags after every system_notification-triggered turn — the Stop hook flagged 12+ silent turn-ends and tripped the safety circuit breaker" reasoning text). Zero of them write to outbox because the hook is in role-guard early-return mode.

   The `transcriptPath: null` value visible in the broken manifest TODAY (at investigation time) is a **separate symptom**: SessionStart populated it correctly, and Stop's manifest patch at `hooks/stop.js:912` would have backfilled it on every Stop write — but every Stop after 14:31:18 short-circuited before reaching the manifest-patch path. The `transcriptPath` was therefore last persisted by SessionStart at 14:29:02 (which DID receive it). Whatever scrubbed it to null between 14:29:02 and the dump time is a tertiary issue not central to this bug.

6. **Why the 5 missing-tag blocks happened in the first place.** The transcript shape (collected via `Get-Content … | ForEach-Object { ConvertFrom-Json … }`) is:
   ```
   105 assistant.turn_end       — each one fires agentStop
   208 assistant.message        — only 8 contain any <|report …|> tag
    26 system.notification      — background task completion (async powershell), sub-agent events, etc.
    26 system.message           — orchestrator/briefing prose containing instructional tag examples
     2 subagent.started + 2 subagent.completed   — Copilot CLI sub-agent spawns from --parallel
   ```
   That is, **8 tag-bearing messages out of 208 assistant messages = ~4% tag emission rate.** In a serial `--autonomous` member like `impl-codex-channels-option-b` (known-good, outbox.jsonl 14.6 KB, 1 row at `seq=1, kind=done`) the ratio is essentially 100% because the model emits one substantive turn and tags it.

   The dominant pattern in the broken transcript: a `system.notification` arrives (e.g., "Shell command X completed"), Copilot fires `assistant.turn_start` for the model to respond, the model says something like "Got it, now reading the output" and calls another tool, `assistant.turn_end` fires, `agentStop` fires, Stop sees no tag → block. The model then "responds" to the block but the response is treated as ANOTHER untagged turn, etc. The model is doing exactly what its training tells it to do (acknowledge intermediate progress without ceremony); the protocol is asking for a ceremonial tag on every micro-turn-boundary; the `--parallel` machinery is generating micro-turn-boundaries at high frequency.

   This is structural, not a model-discipline failure. The same model running the same protocol in serial `--autonomous` mode works fine — see "Known-good comparison" below.

### Citations

| File | Lines | What |
|---|---|---|
| `hooks/stop.js` | 66 | `MAX_CONSECUTIVE_STOP_BLOCKS = 5` |
| `hooks/stop.js` | 496-509 | `bumpBlockCount` — increments + records last reason |
| `hooks/stop.js` | 568-575 | Role-guard early return when flag is cleared |
| `hooks/stop.js` | 578-612 | Circuit-breaker: reset counter + `clearFlag()` + one-shot block envelope |
| `hooks/stop.js` | 722-775 | Tag parsing path → "missing kind tag" block |
| `hooks/mailbox.js` | 136-139 | `TAG_REPORT_REGEX` — no code-fence stripping |
| `hooks/protocol/report-tags.js` | 17-35 | `validateReportTags` strict-mode shape (rules out H3) |

---

## 2. Evidence — broken vs known-good on-disk diff

### Manifest comparison

| Field | Broken (impl-ai-developer-toolkit-submodule) | Known-good (impl-codex-channels-option-b) |
|---|---|---|
| `engine` | `copilot` | `copilot` |
| `transcriptPath` | `null` (see mechanism step 5 — present at SessionStart, lost later) | `C:\Users\evmitran\.copilot\session-state\f07443de.../events.jsonl` |
| `lastSeq` | (absent, never set) | `1` |
| `lastTurnAt` | (absent, never set) | `2026-06-02T03:57:16.111Z` |
| `lastKind` | `null` | `done` |
| `lastSummary` | `null` | `Option B consumer shipped on ralph/codex-channels-option-b (c3075b6c)…` |
| `consecutiveStopBlocks` | `0` (reset by breaker) | `0` (never bumped) |
| `lastStopBlockReason` | `null` (reset by breaker) | `null` |
| `lastStopBlockAt` | `2026-06-02T14:31:04.803Z` (stale-from-last-bump-before-reset) | (absent — never blocked) |
| `outbox.jsonl` | **0 bytes** | **14647 bytes (1 row)** |

The combination `lastStopBlockAt` set + `lastStopBlockReason: null` + `consecutiveStopBlocks: 0` is the **circuit-breaker fingerprint**. It is impossible to produce via normal Stop-hook code paths (every `bumpBlockCount` writes a reason alongside the timestamp) — it can ONLY arise via the breaker's reset block at `hooks/stop.js:594-598`. This is forensic proof the breaker fired.

### Transcript comparison

| Metric | Broken | Known-good |
|---|---|---|
| Total events | 1565 | (n/a; transcript is 2.85 MB but I did not parse it) |
| `assistant.turn_end` | 105 | (small — serial impl typically 5-20 turns) |
| `assistant.message` | 208 | (small) |
| `system.notification` | 26 | (typically 0-3 in a serial impl) |
| `subagent.started` / `subagent.completed` | 2 / 2 | 0 / 0 |
| Tag-bearing `assistant.message` | 8 | 1 |
| `decision: block` returned by Stop | 6 (5 missing-kind-tag + 1 circuit-breaker) | 0 |
| `CIRCUIT-BREAKER` / `runaway block loop` mentions | 13 | 0 |

### Confirming the model self-diagnosed mid-session

The transcript at 15:59:53 (1h 28m into the session, well after the breaker) contains an assistant.message whose `reasoningText` reads:

> "I'm realizing I've triggered a safety mechanism by running multiple tool calls without properly ending my turn with a report tag. The system's been processing background notifications as separate assistant turns, and I haven't been closing them out correctly. … I see the pattern now — I've been missing kind tags on my responses to system notifications, treating them as continuations when they're actually separate turns that need validation. After 12+ untagged responses, the circuit breaker fired and disengaged the crew hooks."

And the visible content of that same message:

> "I missed emitting `<|report kind="..."|>` tags after every system_notification-triggered turn — the Stop hook flagged 12+ silent turn-ends and tripped the safety circuit breaker."

The model arrived at the same root-cause conclusion as this investigation. The well-formed `<|report kind="progress" summary="Phase 3 BLOCKED on AGENTS.md merge conflict…"|>` tag the model emitted at 16:01:42 still did not produce an outbox row — confirming the hook was permanently dead post-breaker.

---

## 3. Why the other rule violations occurred — same root cause

The bug summary lists two additional violations of AGENTS.md hard rules:

1. **Commit `bcc5d6f1` ("chore(plan): apply operator preflight override…") landed on `main` directly** (instead of on a topic branch).
2. **Topic branch checked out in lead's primary working directory `D:/harness-efforts/codexu/`** (which AGENTS.md "Branch + worktree discipline" forbids — that dir must stay on `main`).

Both are **symptoms of the same root cause**, not independent bugs:

- After 14:31:18 the model had no functioning communication channel with the lead. The crews protocol's purpose is to relay `kind=question` envelopes when the model is uncertain about scope/policy decisions. With the protocol dead, the model could not surface questions and had to operate fully autonomously for 1h 44m. The model's reasoning text shows it was aware of this ("Since continuing without a working communication channel risks the lead not knowing what I've done…").
- The model's working memory under `--autonomous --parallel` is dominated by orchestration scaffolding (sub-agent prompts, the 7-cluster plan, parallel-ralph runner state). The detailed worktree-discipline rules from AGENTS.md (which are ~30 lines of nuanced "table of allowed worktree placements" prose) are exactly the kind of subtle policy context that gets crowded out. In a normal serial flow the lead would have caught the first violation and corrected the model via mailbox — that feedback loop is what keeps members on-policy on long sessions.
- The `bcc5d6f1` commit is a plan-deliverable update (just `.ralph/jobs/.../plan.md` edits, no code). The model intended to apply the operator preflight override and didn't realize the on-disk dir was the lead's primary. Without a "stop-and-ask" channel, it pushed forward.

`/implement-with-ralph --parallel` ALSO has independent prompt-discipline gaps (the spawn prompt doesn't explicitly re-state the worktree-placement table; the parallel-ralph runner doesn't preflight that the primary checkout is on `main` before launching), but those are second-order: the primary failure was the silent disengagement of the only correction channel. Fix the protocol, the policy violations stop being silent.

---

## 4. Recommended fix

### Tier 1 — Interim mitigation (apply immediately)

**Add a hard veto in the lead's bookkeeper workflow / `/implement-with-ralph` skill: refuse to spawn `--parallel --suggested-decomposition` impl members until tier-2 lands.** Serial `--autonomous` is unaffected and continues to work; today's batch of 4+ shipped members are all serial. The veto should produce an actionable error message ("`--parallel` impl mode is blocked pending crews-protocol fix tracked at `crews-implement-with-ralph-parallel-outbox-silent-loss`; use serial `--autonomous` or re-decompose the plan into independent serial jobs").

### Tier 2 — Code fix (any of these would resolve, in increasing scope)

**Option A (smallest, recommended).** **Exempt notification-driven turn-ends from the kind-tag requirement.** The Stop hook would inspect `data.transcript_path` and walk back to find the LAST user-typed envelope. If that envelope is a `system.notification` (vs a human/lead user.message), allow the stop without requiring a tag and without bumping `consecutiveStopBlocks`. Pseudo-diff in `hooks/stop.js` around line 763 (the `(missing kind tag)` block):

```js
if (state.role === 'member' && (!reports.length || !latestReport.kind)) {
  if (isRetry) { … }
  // NEW: skip kind-tag requirement when the turn was triggered by a
  // system.notification rather than a user/lead message. The protocol
  // contract is "tag every turn the model owns end-to-end"; notification
  // acks are not such turns.
  if (lastUserBoundaryWasSystemNotification(data.transcript_path)) {
    appendLog(`member name=${state.name} crew=${crew} stop allowed (system.notification ack, no tag required)`, cwd);
    return;
  }
  appendLog(`member name=${state.name} crew=${crew} stop blocked (missing kind tag)`, cwd);
  bumpBlockCount(…);
  …
}
```

`lastUserBoundaryWasSystemNotification` is a small extension of the existing `isUserBoundaryEnvelope` (`hooks/stop.js:415`) that distinguishes `env.type === 'system.notification'` from `env.type === 'user.message'`.

This is the smallest behavior change, requires no new env vars, and is observably correct: a notification ack genuinely is not a member-owned turn.

**Option B.** **Make `clearFlag()` recoverable.** Change the circuit-breaker behavior from "permanently disengage" to "temporary mute": instead of clearing the flag, set a `breakerMutedUntil` timestamp (e.g. 5 minutes). After that interval, the next valid tag re-engages the protocol. This caps the blast radius at 5 minutes of lost outbox writes rather than the 1h 44m we saw. Combine with Option A for defense-in-depth.

**Option C.** **Raise `MAX_CONSECUTIVE_STOP_BLOCKS` for sessions that have never written a tag.** Today's threshold of 5 is sensible for "tag-once-then-stops-tagging" loops, but punishing for "hasn't-figured-out-the-tag-yet-because-notification-storm" sessions. Make the threshold 20 (or unbounded) while `lastSeq === 0`, then ratchet down to 5 after the first successful outbox write. This is the least-invasive option but doesn't fix the root cause of why so many notification-driven turns are untagged.

Recommendation: ship A + B together. A removes the per-notification pressure on the budget; B contains the blast radius if A misses any edge case.

### Tier 3 — Independent harden in `/implement-with-ralph --parallel`

Independent of the crews protocol fix, the `--parallel` skill should preflight-assert that **the calling lead's primary checkout is on `main`** before any orchestration starts. Today the orchestrator trusts that the spawn-prompt's mention of AGENTS.md is enough; this incident proves it isn't. A 3-line `git rev-parse --abbrev-ref HEAD` check in the parallel-ralph runner that hard-fails on anything other than `main` would have caught the branch-flip violation pre-flight.

---

## 5. Reproduction

### Minimum repro (no full impl needed; ~5 minutes)

1. From `D:/harness-efforts/codexu`, spawn a no-op member with kind-tag protocol active:
   ```powershell
   node $env:CREWS_BIN spawn-member repro-circuit-breaker `
     --crew ralph-pipeline `
     --cwd D:/harness-efforts/codexu `
     --state-cwd D:/harness-efforts/codexu `
     --as overview-bookkeeper `
     -- "Run six short async powershell commands in a row using bash mode=async. After each completion notification, write one short prose sentence WITHOUT a <|report kind=...|> tag. Then on the seventh turn, emit <|report kind=\"progress\" summary=\"done\"|>."
   ```
2. Observe member's `manifest.json` after ~1 minute:
   - `consecutiveStopBlocks` will tick 1 → 2 → 3 → 4 → 5 on the first five untagged turn-ends.
   - On the fifth, circuit breaker fires; manifest snaps back to `consecutiveStopBlocks: 0, lastStopBlockReason: null` but `lastStopBlockAt` retains the stale timestamp.
   - The model's seventh-turn `<|report kind="progress"|>` produces ZERO outbox rows.
3. Confirm in `D:/harness-efforts/codexu/.crews/logs/crews.log` that a `CIRCUIT-BREAKER fired` line is present at the timestamp of the fifth turn-end.

### Full repro (matches the failure-mode 1:1)

Spawn an impl member exactly as the broken one was spawned:
```powershell
# from a fresh codexu checkout, with a small 2-3 cluster decomposition that
# uses --parallel --suggested-decomposition --autonomous. Choose any plan
# whose decomposition produces ≥ 2 sub-agent worktrees.
/implement-with-ralph --from-plan <plan> --parallel --suggested-decomposition <decomp> --autonomous
```
Wait 3-5 minutes. Confirm:
- `outbox.jsonl` for the spawned member is 0 bytes.
- `manifest.json` shows the circuit-breaker fingerprint (`consecutiveStopBlocks: 0, lastStopBlockReason: null, lastStopBlockAt: <set>`).
- Transcript at `~/.copilot/session-state/<sessionId>/events.jsonl` contains a `CIRCUIT-BREAKER` line in a hook.end output and a `assistant.turn_end` count > 20 within the first 5 minutes.

After fix (Option A + B together), the same spawn should produce a healthy outbox and no breaker fire.

---

## 6. Salvage assessment for the in-progress 7-worktree impl

**Verdict: SALVAGEABLE. Recommend RECOVERY.md "Option B" path (manual conflict resolve + serial finish), with one upstream-respecting tweak.**

The broken member's RECOVERY.md (at `.ralph/job-groups/ai-developer-toolkit-submodule/RECOVERY.md`, 6.5 KB, written at 16:01Z just before termination) is unusually detailed and accurate: it correctly identifies every commit SHA, the failed merge conflict, and the correct resume path. I cross-checked its claims against the actual git state and they hold up:

| Cluster | Branch | HEAD | Status on integration |
|---|---|---|---|
| submodule-add | `…/submodule-add` | `32fdb9de` | ✅ Merged (base) |
| auto-memory-and-plans | `…/auto-memory-and-plans` | `bff0ad2f` | ✅ Merged |
| data-and-prompts | `…/data-and-prompts` | `fb70f169` | ✅ Merged |
| operating-manual | `…/operating-manual` | `d9242a48` | ✅ Merged |
| ci-invariant | `…/ci-invariant` | `e8354131` | ✅ Merged (integration HEAD: `f02e105d`) |
| **resolver-wrapper** | `…/resolver-wrapper` | `65283323` | ❌ **AGENTS.md 1-line conflict with `operating-manual`** |
| **smoke-and-rollback** | `…/smoke-and-rollback` | `6bfc0b34` | ⏸️ **Never launched** (DAG dep blocked) |

5 of 7 clusters are clean on `ralph/ai-developer-toolkit-submodule/integration`. The 1-line `AGENTS.md` conflict on `resolver-wrapper` is mechanical — RECOVERY.md describes both sides accurately (operating-manual rewrote the broader paragraph; resolver-wrapper made a narrower phrasing edit to the same paragraph). Recommended resolution: take operating-manual's text wholesale, then apply resolver-wrapper's submodule-relative phrasing to the local-dev-fallback line within it.

`smoke-and-rollback` never started, so its branch HEAD is the empty topic-branch starting point. Spawning a fresh serial member for just that one cluster (a small "add ai-developer-toolkit smoke-test workflow + rollback note" scope) is the cleanest path.

The on-main commit `bcc5d6f1 "chore(plan): apply operator preflight override…"` is harmless — it only touches `.ralph/jobs/.../plan.md`. It is already a parent of current `main` HEAD `d401034f`, so reverting it would force-push history. Leave it; the offense was the discipline violation, not the content.

### Recommended salvage procedure

1. **Apply the tier-1 mitigation first** — ban future `--parallel` spawns. Otherwise step 4 below will hit the same bug.
2. From `D:/harness-efforts/codexu/.worktrees/finish-ai-dev-toolkit-submodule/` (a NEW lead-driven scratch worktree — per AGENTS.md "Lead-driven scratch work" convention, NOT a sibling-of-repo path):
   ```bash
   git worktree add .worktrees/finish-ai-dev-toolkit-submodule \
     ralph/ai-developer-toolkit-submodule/integration
   cd .worktrees/finish-ai-dev-toolkit-submodule
   git merge --no-ff ralph/ai-developer-toolkit-submodule/resolver-wrapper
   # resolve AGENTS.md conflict as described above
   git add AGENTS.md && git commit
   ```
3. **Spawn a fresh serial `--autonomous` member** to ship `smoke-and-rollback` (cluster scope is small enough to do as a normal serial impl). Use the existing topic branch `ralph/ai-developer-toolkit-submodule/smoke-and-rollback` so its commits land where the DAG expects them. The lead then merges that branch into integration.
4. **Run Phase 5a/5b convergence on the integration branch** via the lead's normal review-fix loop (the impl skill's autonomous phases are inert without `/implement-with-ralph`, but a manual code-review + docs-review pass against the full diff is equivalent and matches what an `--autonomous` impl would have done).
5. **Lead FF-merges integration → main** on all configured remotes (origin, personal — per AGENTS.md "Always push main to ALL configured remotes after every merge").
6. **Update `.ralph-overview/data.json`** to flip `ai-developer-toolkit-submodule` to `lifecycle: "merged"` with the appropriate `shipManifest` per the bookkeeper convention.
7. **Clean up the per-cluster worktrees** under `.ralph/job-groups/ai-developer-toolkit-submodule/<cluster>/worktree/` after merge (RECOVERY.md notes one had an EPERM lock on `esbuild.exe`; `--force` after lock release).

Total salvage effort: roughly 1-2 hours of focused work, vs throwing away ~5 cluster-days of shipped impl content. **Do not restart from scratch.**

---

## Appendix — files inspected

- `D:/harness-efforts/codexu/.crews/crews/ralph-pipeline/members/impl-ai-developer-toolkit-submodule/{manifest,mailbox,outbox.jsonl,inner-pid-capture.trace.jsonl}.{json,jsonl}`
- `D:/harness-efforts/codexu/.crews/crews/ralph-pipeline/members/impl-codex-channels-option-b/{manifest.json,outbox.jsonl}` (known-good comparison)
- `C:/Users/evmitran/.copilot/session-state/3cf8ea73-dd71-4339-803f-895347775d33/events.jsonl` (broken member transcript, 7.4 MB)
- `C:/Users/evmitran/.copilot/session-state/f07443de-c9e2-478c-9550-9cabbcdeedd5/` (known-good transcript dir)
- `C:/Users/evmitran/.copilot/installed-plugins/ai-developer-toolkit/crews/{.claude-plugin/plugin.json, hooks/stop.js, hooks/copilot-stop.js, hooks/copilot-shim.js, hooks/copilot-session-start.js, hooks/session-start.js, hooks/mailbox.js, hooks/protocol/report-tags.js, hooks/hooks.json}`
- `D:/harness-efforts/codexu/.crews/logs/crews.log`
- `D:/harness-efforts/codexu/.ralph/job-groups/ai-developer-toolkit-submodule/{RECOVERY.md, job-state.json, group.json}`
- `git log` of `main`, `ralph/ai-developer-toolkit-submodule/integration`, and 7 cluster topic branches in `D:/harness-efforts/codexu`
