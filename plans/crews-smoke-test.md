# Crews 1.0.2 smoke test — operator playbook

A fresh-agent runbook to **verify that the three bugs found in the 1.0.0 smoke run are now fixed in 1.0.2.** Each step's "Pass criteria" describes the fixed-behavior we expect; "Fail criteria" is what 1.0.0 did wrong and what would tell us the fix didn't land.

**Bugs we are verifying as fixed:**

1. **Member→lead notification on reply** — when a member emits an outbox envelope with `replyTo` pointing at a lead-sent message, the lead's mailbox should get a system-from notification so the lead's `wait-for-message` listener wakes.
2. **SessionStart member-context briefing** — members should be told to include `reply-to="<incoming-msg-id>"` and `summary="..."` on report tags when responding to a mailbox message.
3. **Manifest stale-tracker** — after a member's second-or-later turn, `lastSeq` / `lastKind` / `lastSummary` / `lastTurnAt` on the member's manifest should re-stamp on every Stop-hook outbox write (not pin to turn-1 values).

Detailed root-cause report from the 1.0.0 run is in the prior session transcript.

---

## Prerequisites

- Plugin `crews` version 1.0.2 installed at user scope. Verify:
  ```
  ls C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/crews/
  ```
  Should show `1.0.2`.
- Working directory: `D:/harness-efforts/codexu`
- No old `assigned-roles` plugin enabled (check `.claude/settings.json` `enabledPlugins` is `{}`).
- Existing `smoke` crew is fine to leave; this test creates a fresh `smoke2` crew.

---

## Step 1 — Operator types the lead assignment

Operator types this directly into the agent's prompt input (the `/assign-role` slash command is hook-handled, agents can't invoke it themselves):

```
/assign-role lead --crew smoke2 --name smoke2-lead
```

**Expected reply from hook** (printed back into the agent's context, blocked from reaching the model):
- `role: lead (name=smoke2-lead, crew="smoke2").` followed by the lead-context briefing.

**If the reply is an error:** capture the exact error text and stop. That's the bug to report.

---

## Step 2 — Agent arms the lead listener

After Step 1's successful `/assign-role`, the agent's next tool call will be blocked unless the listener is armed first. The agent runs:

```bash
node C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/crews/1.0.2/tools/wait-for-message.js smoke2-lead --crew smoke2
```
…with `run_in_background: true`.

**Expected**: the listener stays running. `.crews/crews/smoke2/leads/smoke2-lead/manifest.json` should have `lastListenerSpawnAt` set and `lastHeartbeatAt` refreshed every ~10s.

---

## Step 3 — Verify lead state-dir

Agent runs:

```bash
cd D:/harness-efforts/codexu
find .crews/crews/smoke2 -type f
cat .crews/crews/smoke2/meta.json
cat .crews/crews/smoke2/leads/smoke2-lead/manifest.json
cat .crews/crews/smoke2/leads/smoke2-lead/capabilities.json
cat .crews/crews/smoke2/threads/general/subscribers.json
```

**Expected**:
- Files present: `meta.json`, `leads/smoke2-lead/{manifest,capabilities,mailbox,outbox,mailbox-history}.{json,jsonl}`, `.init-complete` sentinel, `threads/general/{messages.jsonl,meta.json,subscribers.json}`.
- `meta.json` has `leads: ["smoke2-lead"]`, `createdBy: "smoke2-lead"`.
- `capabilities.json` is `{allowPeers: false, allowCreateCrew: false}`.
- `threads/general/subscribers.json` lists `smoke2-lead`.
- Manifest's `lastHeartbeatAt` is within the last ~15s.

---

## Step 4 — Spawn alice + bob (real Windows Terminal tabs)

Agent runs sequentially:

```bash
cd D:/harness-efforts/codexu
node C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/crews/1.0.2/tools/spawn-member.js alice --crew smoke2 -- "Say hello in one sentence."
node C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/crews/1.0.2/tools/spawn-member.js bob   --crew smoke2 -- "Say hello in one sentence."
```

**Expected**: each returns `{ok: true, name: ..., pid: ..., note: "wt.exe tab launched..."}`. Two new wt tabs visible on the operator's screen.

---

## Step 5 — Wait for both members to complete their first turn

Agent runs:

```bash
node C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/crews/1.0.2/tools/wait-for-any-member.js --crew smoke2 --timeout-ms 90000 alice bob
```

**Expected**: an envelope JSON for whichever finishes first, with `kind: "done"` and `message: "Hello!"` (or similar). Then repeat to catch the second:

```bash
node C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/crews/1.0.2/tools/list-members.js --crew smoke2
```

**Expected**: both alice and bob show `lastKind: "done"`, `liveness: "alive"` or `"idle"`, `lastSeq: 1`.

**Check bug #3 (partial)**: alice and bob's `lastSummary` should be populated if the SessionStart briefing (bug #2) now instructs members to emit `summary="..."`. If `summary` is still `null`, bug #2 isn't fixed.

---

## Step 6 — Send alice a follow-up question (the critical test)

Agent runs:

```bash
node C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/crews/1.0.2/tools/send-to-member.js alice "What is 2+2? Answer in one word then stop." --as smoke2-lead --crew smoke2
```

**Expected**: returns `{ok: true, id: "<msg-id>", seq: 1, ...}`. Capture this **msg-id** — call it `LEAD_MSG_ID`. The lead's `send-history.jsonl` will have a row with `id: LEAD_MSG_ID`.

**This is the moment the bugs would manifest.** Alice's listener fires, alice runs a turn answering the question. The Stop hook in alice's tab writes seq=2 to alice's outbox.

---

## Step 7 — Critical: did the lead's listener wake?

**Bug #1 verification.** Without polling, the agent should be woken by its background `wait-for-message smoke2-lead` listener firing. The agent will see a `<task-notification>` in their next prompt for task `b...` (the listener task ID) with the message body.

**Check after ~30s** (give alice's session time to respond):

- Read the listener's output file:
  ```bash
  cat C:\Users\evmitran\AppData\Local\Temp\claude\D--harness-efforts\<session-id>\tasks\<listener-task-id>.output
  ```
  Replace `<session-id>` with whatever appeared when the listener was armed in Step 2.
- Look at the lead's mailbox+history:
  ```bash
  cd D:/harness-efforts/codexu
  cat .crews/crews/smoke2/leads/smoke2-lead/mailbox.json
  cat .crews/crews/smoke2/leads/smoke2-lead/mailbox-history.jsonl
  ```

**Pass criteria** (bug #1 fixed):
- Listener output file contains a JSON line with `type: "messages"` and a message of `kind: "member-reply"` (or similar system-from kind) referencing alice and `LEAD_MSG_ID`.
- `mailbox-history.jsonl` has the consumed envelope.
- The lead-tab agent reports being notified without having polled.

**Fail criteria** (bug #1 still present):
- Listener output file is empty.
- Lead's `mailbox.json` is still `{"messages": []}`.
- Agent had to poll via `wait-for-any-member` to discover alice's reply.

---

## Step 8 — Inspect alice's reply for bug #2

Agent runs:

```bash
cd D:/harness-efforts/codexu
cat .crews/crews/smoke2/members/alice/outbox.jsonl
```

**Expected seq=2 envelope** (alice's reply to lead's message):

```json
{
  "seq": 2,
  "kind": "done",
  "summary": "<some short text>",   ← Pass: non-null. Fail: null.
  "message": "Four.",
  "replyTo": "<LEAD_MSG_ID from Step 6>",   ← Pass: matches. Fail: null.
  ...
}
```

**Pass criteria** (bug #2 fixed):
- `summary` is a non-empty string.
- `replyTo` equals `LEAD_MSG_ID` from Step 6.

**Fail criteria** (bug #2 still present):
- `summary: null`.
- `replyTo: null`.

(Bug #1 cannot fire correctly without bug #2 also being fixed — the Stop hook needs `replyTo` non-null to identify the lead to notify.)

---

## Step 9 — Inspect alice's manifest for bug #3

```bash
cat .crews/crews/smoke2/members/alice/manifest.json
```

**Expected** (bug #3 fixed):
- `lastSeq: 2` (matches alice's two outbox rows)
- `lastKind: "done"` (from her latest turn)
- `lastSummary`: short text from seq=2's `summary` attribute (or null if no summary, but should match the latest)
- `lastTurnAt`: timestamp of seq=2's `writtenAt` (NOT seq=1's)

**Fail criteria** (bug #3 still present):
- `lastSeq: 1` (pinned to first turn).
- `lastTurnAt` is the seq=1 timestamp.

---

## Step 10 — Confirm via `/list-members` lead-view

Agent runs:

```bash
node C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/crews/1.0.2/tools/list-members.js --crew smoke2
```

**Expected for alice's row**:
- `lastKind: "done"`
- `lastSummary`: non-null (bug #2 fixed)
- `lastSeq: 2` (bug #3 fixed)
- `lastTurnAt`: from her second turn

This is the data point the codexu dashboard workflow ultimately depends on.

---

## Step 11 — Cleanup

Agent runs:

```bash
cd D:/harness-efforts/codexu
node C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/crews/1.0.2/tools/clear-member.js alice --crew smoke2 --as smoke2-lead
node C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/crews/1.0.2/tools/clear-member.js bob   --crew smoke2 --as smoke2-lead
```

Operator types:

```
/assign-role none
```

Background listeners will time out on their own (1-hour default) or can be killed via process manager.

The `smoke2` crew directory remains on disk for inspection. To fully scrub: delete `.crews/crews/smoke2/` and remove the smoke2-lead session-config file from `.crews/sessions-configs/`.

---

## Pass/fail summary template

After running the test, fill this out and attach the relevant evidence files:

| Bug | Status | Evidence |
|---|---|---|
| #1 — member→lead notification on reply | PASS / FAIL | listener output file contents; lead `mailbox.json` after Step 7 |
| #2 — SessionStart briefing for reply-to + summary | PASS / FAIL | alice's seq=2 envelope from Step 8 |
| #3 — manifest stale-tracker | PASS / FAIL | alice's manifest after Step 9 |

If any bug FAILs, paste the relevant file contents + the exact tool invocation commands so the plugin author can reproduce.

---

## Notes for the fresh agent running this

- This test creates persistent state in `D:/harness-efforts/codexu/.crews/crews/smoke2/`. Names are workspace-permanent in 1.0.x — once you `/assign-role lead --crew smoke2 --name smoke2-lead`, that handle is taken in that crew forever (no `/release-name` in 1.0).
- Use throwaway names if you re-run (e.g., `smoke3`, `smoke4`).
- The agent running this must be a separate fresh session — don't try to switch identities mid-session, the session-flag is one-per-session and the prior conversation showed that re-assignment is fragile.
- After each Bash tool call, the agent's own listener heartbeat must stay alive. If the agent gets blocked with "BLOCKED: you must arm a background listener", re-arm with the wait-for-message command for `smoke2-lead --crew smoke2`.
