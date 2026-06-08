# Post-mortem — `resume-crew --confirm` mass-respawn incident (2026-06-08)

**Severity:** High (operator PC near-freeze; operator had to force-close the
`crews-ralph-pipeline` wt.exe window to stop it).
**Author:** overview-bookkeeper lead (session `ba496dad`), Copilot CLI.
**Status:** RESOLVED — 3 intended members re-spawned cleanly; lead re-bound;
listener armed. Follow-up bug candidate filed (see Action Items).

---

## 1. What happened (timeline)

1. Operator approved a 4-task batch; I spawned 3 members successfully
   (`bs-anthropic` copilot, `impl-overview-wrapper` codex, `impl-idle-timeout`
   codex). All 3 registered alive. Good.
2. I tried to **arm the lead listener** and got
   `arm-skipped: session-mismatch` — the lead manifest was still bound to the
   PREVIOUS session (`ebadd2f4`, from the handoff), not this one (`ba496dad`).
3. **ROOT-CAUSE ACTION:** to re-claim the lead, I ran
   `resume-crew ralph-pipeline --as overview-bookkeeper --confirm`.
   I had run `--dry-run` first and saw a long "targets" list of dead members,
   but I **misread it as a cleanup/reconcile preview** instead of recognizing
   it as the **respawn set**.
4. `resume-crew --confirm` is the **member-recovery** command: per crews
   README L212 it *"on `--confirm` respawns [dead members] as fresh sessions."*
   This crew had accumulated **298 member records over weeks, 273 of them
   dead.** `--confirm` began respawning the non-cleared dead members, each as
   a NEW wt.exe tab → tens of tabs → near-freeze.
5. While the respawn ran (~40s, visible as the shell "still running" reads),
   a subsequent tool call hit the crews PreToolUse hook, which **errored
   fail-closed** (likely `manifest.json.lock` contention from the storm) and
   began denying ALL my tool calls.
6. Operator force-closed the wt.exe window with all tabs → killed every
   respawned zombie AND my 3 intended members. The hook stopped erroring once
   the storm ended.

**Double failure:** `resume-crew` (a) did NOT do what I wanted (it does not
re-bind the lead — the lead stayed bound to `ebadd2f4`), and (b) caused the
mass-respawn.

## 2. Root cause

- **Primary (operator-side / my error):** I used `resume-crew --confirm` as if
  it were a "re-claim lead for this session" command. It is not. It is a
  bulk dead-member recovery command, and on a long-lived crew with hundreds of
  historical dead members it is a footgun that respawns ALL of them with no
  per-member cap or throttle.
- **Contributing (tooling):** `resume-crew --confirm` has **no cap, no
  throttle, and no "this will respawn N members — continue?" guard** scaled to
  the target count. A `--dry-run` "targets" list of 100+ entries is easy to
  misread, and `--confirm` then fires all of them at once. The crews PreToolUse
  hook also went fail-closed-erroring under the lock contention, which froze
  my ability to react.

## 3. Resolution (what fixed it)

1. Identified 0 alive members after the window close (storm self-terminated).
2. Re-bound the lead to THIS session with the CORRECT mechanism:
   `assign-role lead --crew ralph-pipeline --name overview-bookkeeper`
   (env `COPILOT_AGENT_SESSION_ID=ba496dad`, `CREWS_STATE_CWD=...`). Verified
   lead manifest `sessionId == ba496dad`.
3. Armed the listener (hook-provided command, indefinite). It delivered a
   backlog of 30 stale review-mail entries (weeks-old ships never reviewed +
   the 3 `member-crashed` notices for my killed members); drained the cursor
   with `review-mail`.
4. Re-spawned the 3 intended members ONE AT A TIME with fresh `-r2` names
   (old dead records still held the original names), verifying exactly one new
   alive member after each. Final state: 3 alive
   (`bs-anthropic-r2` copilot, `impl-overview-wrapper-r2` codex,
   `impl-idle-timeout-r2` codex), nothing else.

## 4. Lessons / prevention (to codify in AGENTS.md)

1. **NEVER run `resume-crew --confirm` to re-claim the lead.** The correct
   "fresh session takes over as lead" mechanism is
   `assign-role lead --crew <crew> --name <lead-name>` (reads session id from
   `COPILOT_AGENT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID`; pass `CREWS_STATE_CWD`
   via env, NOT `--cwd` — `assign-role` rejects `--cwd`).
2. **`resume-crew --confirm` respawns EVERY dead member in the crew.** Before
   ever running it, count the dead members
   (`list-members --json` → filter `health==='dead'`). On this long-lived
   `ralph-pipeline` crew that is **273**. Treat `resume-crew` as
   effectively-banned on this crew until the roster is pruned. If you genuinely
   need to recover ONE member, spawn it fresh by name instead.
3. **`assign-role` arg quirk:** it reads state-cwd from env
   (`CREWS_STATE_CWD`), and rejects a `--cwd` flag. `list-members` uses
   `--cwd`; `arm` uses `--cwd` + `--session-id`. The flag surface differs per
   subcommand — check `<sub> --help` before scripting.
4. **A fresh bookkeeper session must re-bind the lead via `assign-role lead`
   as an early step** (the handoff's lead session id is the PREVIOUS session).
   Do this BEFORE arming; `arm` fails `session-mismatch` until the lead
   manifest points at the current session.

## 5. Action items

- [ ] Codify lessons #1–#4 in codexu `AGENTS.md` (Bookkeeper operating
      invariants → a new "Lead takeover + the resume-crew footgun" subsection).
- [ ] File a crews bug candidate: `resume-crew --confirm` needs a respawn
      cap / per-batch throttle / "about to respawn N members, N>threshold —
      require `--yes-respawn-all`" guard, AND the crew roster needs a prune
      path so hundreds of historical dead members don't make `resume-crew` a
      catastrophe. (Delegate the investigation/impl to a member, not the lead.)
- [ ] Consider a roster-prune / `clear-member` sweep of the 273 dead
      `ralph-pipeline` members so a future accidental `resume-crew` can't spam
      (deliberate, reviewed — not a blind sweep).
