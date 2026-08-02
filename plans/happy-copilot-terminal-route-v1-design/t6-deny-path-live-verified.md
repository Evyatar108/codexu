# T6 — live deny-path re-run: **PASSED** (web-on-VM, ev.6)

Closes the last open item from `t6-joint-e2e-results-web-vm.md` /
`t6-deny-path-root-cause.md` / `t6-deny-path-root-cause-confirmed.md`.

**Build under test:** unchanged published fork payload
`20260802T061301Z-875812e07a90` (`ev-copilot`, edition `1.0.76-ev.6`), launched
with `COPILOT_HAPPY_EMBED=1` inside a `@microsoft/tui-test` PTY. Registry entry
published as `schemaVersion: 1` with **no `kind` key** — the documented footgun,
handled correctly by `uiServerRegistry.ts`.

**Happy side:** `tasks-board/happy-t6-joint-e2e-integration/impl` including the
`leaseId` fix. Phone substituted by the Expo **web** client (no tablet on this
VM), driven through `agent-browser`.

## 1. Contract probe — root cause reproduced and fix proven on the live build

Before the UI run, both param sets were replayed against the live ev.6 actor
over the raw loopback JSON-RPC seam. This finally captures the **exact wire
error text** that was originally requested and could not be produced:

```
A) PRE-FIX param set (leaseId omitted)
   -> JSON-RPC ERROR code=-32603
      message="Request happy.answerPrompt failed with message:
               happy.* requires a non-empty string leaseId"

B) POST-FIX param set (leaseId present)
   -> RESULT {"actionId":"c40e22f7-…","outcome":"no_lease","requestId":"d163265f-…"}
```

A reproduces the original failure verbatim on the shipped binary. B shows the
same call passing validation and returning a **typed domain outcome** instead.
This confirms the diagnosis and the fix independently of the UI run below.

## 2. Live end-to-end deny — PASSED

| Step | Result |
|---|---|
| Attach to real ev.6 `schemaVersion: 1` registry entry | ✅ |
| Local pairing of the web client (CORS fix holding) | ✅ |
| Mirror session created and observable | ✅ |
| `Request steering` from web → terminal shows request id | ✅ |
| `/happy grant <id>` at terminal → web shows `Steering active · until 13:13` | ✅ |
| Heartbeats renew the lease across the model's work | ✅ |
| Destructive `path` permission becomes pending at the terminal | ✅ |
| Web renders it **deny-only**: `Approve is only available at the terminal` | ✅ |
| **Click `Deny` on the web client** | ✅ **no `-32603`** |
| Mirror log: `happy.answerPrompt … Handler returned { hasResult: true }` | ✅ |
| Web updates to `Permission request · Answered from this device` | ✅ |
| Terminal modal closes with `✗ Edit  Create …\hello2.txt` | ✅ |
| Target file **and its parent directory were never created** | ✅ |
| Lease stayed active after the answer (no spurious revoke) | ✅ |

The deny genuinely took effect at the runtime, not just in the UI.

Also re-observed live this run: `Happy control revoked (keystroke)` fires
immediately when free text is typed at the terminal while a lease is held, and
the terminal-side `Esc` deny path still works normally.

## 3. Two environment findings worth folding into the runbook

**(a) Granting is necessarily the LAST terminal interaction.** There is a real
ordering constraint that the earlier "grant before the prompt fires" correction
only half-captures:

- Grant *after* the modal opens → impossible; the modal consumes keystrokes.
- Grant *before* submitting the task → the lease is revoked the moment you type
  the task, because free-text keystrokes are (correctly) treated as "the human
  took over".

The only sequence that works is therefore: **submit the task first → request
steering from the phone → `/happy grant <id>` at the terminal → walk away.**
Slash-command input for `/happy grant` does *not* trigger the keystroke
revocation; only free text does. The grant must land in the window between task
submission and the first permission prompt (a prompt that emits some text before
its first tool call gives a comfortable margin).

**(b) Most tool calls will not block, so a naive runbook step won't produce a
pending permission.** On a default fork session the current working directory,
any `trustedFolders` entry, and the **system temp directory** are all
auto-allowed (cf. the `--disallow-temp-dir` flag), and shell commands ran
without prompting. Two earlier attempts silently auto-approved and produced
`Permission request · Answered at the terminal or another device` rather than a
pending prompt. To reliably force a blocking permission, target a path that is
outside the cwd, outside every trusted folder, **and** outside temp — e.g.
`C:\efforts\t6-outside-test\hello2.txt`, which raised the `Allow directory
access` modal used above.

## 4. Scope — what this run does and does not cover

Covered: `answer-permission` **deny** on a destructive (`path`) kind, plus the
full lease lifecycle (request / grant / heartbeat / release / keystroke
revocation) and deny-only rendering.

**Not covered** (unchanged from the previous run, and not regressions):

- The **approve** path. Approve is fail-closed for destructive kinds by design
  (`destructive_kind`), and `read` kinds auto-approve without ever becoming
  pending, so there was no reachable approve case to exercise here.
- `answer-elicitation`, `answer-plan`, `answer-ask-user` — only
  `answer-permission` was exercised live. They share the same
  `handleAnswerPrompt` validation path (and therefore the same `leaseId`
  requirement, now satisfied for all types since the fix is at the transport
  call site), but none has been driven end-to-end.

## 5. Status

The joint checklist is now **fully green for the scope defined in the joint
objective doc**. No known open defects on either side.
