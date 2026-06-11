# Investigation: codex hook-event lifecycle vs crews once-per-session binding

**Task:** `codex-hook-event-lifecycle-vs-crews-binding`
**Date:** 2026-06-10
**Mode:** read-only source investigation (no code changes; only deliverable is this file)
**Question:** WHEN does codex emit hook events (especially `SessionStart`) relative to
session / turn / message / resume boundaries, and is crews' once-per-session
`SessionStart` role-binding safe under codex's lifecycle?

**Operator observation (2026-06-11):** in a live codex session, a
`SessionStart hook (completed)` fires when the operator sends a NEW message
AFTER a `Stop` hook (after codex's last message). This is NOT how Claude Code /
Copilot behave — there `SessionStart` fires once at session start (+ resume /
`/clear` / `/compact`), never per user message.

---

## TL;DR verdicts

1. **codex `SessionStart` lifecycle (by-design, upstream-canonical — NOT a fork
   artifact).** `SessionStart` hooks run at the **start of a turn**, but only when
   a per-session "pending session-start source" queue is non-empty. That queue is
   populated at **exactly two sites tree-wide**: (a) `Session` construction
   (source = `Startup` / `Resume` / `Clear`, chosen from `InitialHistory`), and
   (b) after a history-replacing **compaction** (source = `Compact`). It is
   *drained* (all entries popped) at the start of each turn. So in steady state a
   single in-memory `Session` fires `SessionStart` **once** (first turn) plus once
   per compaction. For it to fire on a "new message after Stop", a **new `Session`
   must be constructed** for that message — which, in the interactive flow, is a
   **resume** of the same conversation (the by-design explanation; see §1.6).

2. **The decisive safety fact: `session_id` is the conversation/thread id and is
   PRESERVED across a resume.** `session_id() == SessionId::from(thread_id)`, and
   on `InitialHistory::Resumed` the `thread_id` is the *resumed* `conversation_id`
   (not a fresh one). So a per-message resume re-emits `SessionStart` carrying the
   **same `session_id`** crews already bound.

3. **crews IS SAFE under the realistic per-message re-emit (resume / compact)**
   because the `session_id` is stable and crews' `applyEnvRole` "same" shortcut
   makes the re-bind **idempotent**: it returns early WITHOUT re-invoking
   `assignMemberRole`, so the v3.21.x takeover guard is NOT re-evaluated, the
   manifest `sessionId` is not re-pointed, and `lastListenerEpoch` does NOT grow
   from the `SessionStart` path. No correctness bug in the stable-id case.

4. **There IS a real (but benign-for-correctness) churn cost**, and **one genuine
   break condition**:
   - **Churn:** the member branch of `session-start.js` runs FULLY on every
     re-emit even when `applyEnvRole` short-circuits — it re-stamps
     `lastHeartbeatAt`/`lastSessionStartAt`/`actorState`, re-runs the
     registry-pointer backfill, re-runs `ensureActorDir` + a locked
     `updateManifest`, and **re-emits the entire member briefing into
     `additionalContext` on every user message** (context bloat — the most
     tangible negative).
   - **Genuine break (only if `session_id` CHANGES across the re-emit):** if codex
     ever re-emits `SessionStart` with a *different* `session_id` for the SAME
     live tab — which happens on `/clear` (`InitialHistory::Cleared` mints a fresh
     `thread_id`) and would happen if a "new message" started a brand-new
     conversation (`InitialHistory::New`) — crews calls `assignMemberRole` with
     the new id, the takeover guard sees the launcher tab alive
     (`isActorTabAlive`) and throws `ActorHeldByLiveSessionError`, `applyEnvRole`
     swallows it and returns `null`, and the member gets **no crews context and no
     flag for the new id** → it silently drops out of the crew. This matches the
     "binding/identity weirdness seen this session."

5. **Recommended direction:** first run the decisive diagnostic (read the
   `source` field on the per-message `SessionStart`; see §3) to learn whether the
   re-emit carries a stable id (`resume`/`compact` → safe, just churn) or a fresh
   id (`startup`/`clear` → broken). If stable, make crews' member/lead branch a
   cheap no-op on a confirmed same-session re-emit (skip the briefing
   re-injection + redundant writes). If the id changes, the correct fix is on the
   codex side (don't re-emit `SessionStart` per message / keep the conversation
   warm) and/or a narrowly-scoped crews change to treat a same-name +
   same-`launcher.pid` re-bind as a benign rebind rather than a refusal.

---

## STEP 1 — codex `SessionStart` emission lifecycle

### 1.1 Where `SessionStart` hook handlers actually run

The dispatch entry point is `run_pending_session_start_hooks`, invoked from the
**turn** execution path:

- `core/src/session/turn.rs:167` — `run_turn(...)` calls
  `if run_pending_session_start_hooks(&sess, &turn_context).await { return None; }`
  near the top of every turn (after pre-sampling compaction at `turn.rs:147`,
  before `run_hooks_and_record_inputs` / `UserPromptSubmit` at `turn.rs:171`).
- `core/src/hook_runtime.rs:105-158` — `run_pending_session_start_hooks` is a
  `while let Some(session_start_source) = sess.take_pending_session_start_source().await { ... }`
  loop. For each popped source it builds a `SessionStartRequest`
  (`hook_runtime.rs:132-140`, `session_id: sess.session_id().into()` at line 133)
  and runs the configured hook commands (`hooks.run_session_start(...)`,
  `hook_runtime.rs:147`). **If the queue is empty, the loop body never executes —
  no `SessionStart` hook fires.**

`run_turn` is invoked once per user turn from the regular-task path:
`core/src/tasks/regular.rs:70` (`RegularTask::run` → `run_turn(...)`). One user
message = one `RegularTask` = one `run_turn` = one drain of the pending queue.

### 1.2 The queue — populated at EXACTLY two sites (tree-wide)

A tree-wide grep for `queue_pending_session_start_source` returns exactly three
hits: the definition plus two callers.

- **Definition / storage:** `core/src/state/session.rs:39`
  (`pending_session_start_sources: VecDeque<codex_hooks::SessionStartSource>`),
  `:225-230` (`queue_pending_session_start_source` = `push_back`), `:232-236`
  (`take_pending_session_start_source` = `pop_front`). It is a real drain (FIFO
  pop), not a peek.
- **Site 1 — `Session` construction:** `core/src/session/session.rs:1218-1231`.
  The source is chosen from `InitialHistory`:
  ```
  let session_start_source = match &initial_history {
      InitialHistory::Resumed(_) => codex_hooks::SessionStartSource::Resume,   // :1219
      InitialHistory::New | InitialHistory::Forked(_) => Startup,              // :1220-1222
      InitialHistory::Cleared => codex_hooks::SessionStartSource::Clear,       // :1223
  };
  ...
  state.queue_pending_session_start_source(session_start_source);             // :1230
  ```
- **Site 2 — compaction:** `core/src/session/mod.rs:2645-2666`
  (`replace_compacted_history`) queues `SessionStartSource::Compact` at
  `mod.rs:2665` after a history-replacing auto/`/compact` compaction.

There is **no per-message and no per-turn re-queue** anywhere in `codex-core`
(or anywhere else in `codex-rs` — the tree-wide grep confirms only these two
producers). The prewarm path (`core/src/session_startup_prewarm.rs`) does NOT
queue a source.

### 1.3 The drain — per-turn, all-at-once

`run_pending_session_start_hooks` (`hook_runtime.rs:109`) pops **every** queued
source via the `while let Some(...)` loop. So:

- **Turn 1 of a fresh `Session`:** queue holds `[Startup|Resume|Clear]` → drained
  → `SessionStart` fires once, then `UserPromptSubmit`.
- **Later turns of the SAME `Session` instance:** queue empty → no `SessionStart`.
- **A turn whose pre-sampling step triggers compaction:** `replace_compacted_history`
  queues `Compact` and it is drained in the same/next turn → `SessionStart(compact)`.

This is confirmed by upstream-style tests:

- `core/tests/suite/hooks.rs:1204` —
  `session_start_runs_before_user_prompt_submit_on_first_turn`: submits ONE turn
  on a fresh session and asserts the hook order is exactly
  `["SessionStart", "UserPromptSubmit"]` with `source == "startup"`
  (`hooks.rs:1230-1242`).
- `core/tests/suite/hooks.rs:1435` —
  `resumed_thread_runs_resume_then_compact_session_start_hooks`: a **resumed**
  session (built via a new process `resume_builder.resume(...)`, `hooks.rs:1498`)
  whose first turn also auto-compacts asserts the `source` sequence is exactly
  `["resume", "compact"]` (`hooks.rs:1526-1533`). Note the resumed session fires
  `resume`, NOT a second `startup`.

### 1.4 The decisive fact — `session_id` is the (preserved-on-resume) thread id

`core/src/session/session.rs:475-478`:
```
/// Returns the identity shared by the root thread and all descendant threads.
pub(crate) fn session_id(&self) -> SessionId {
    self.services.agent_control.session_id()
}
```
At construction (`session.rs:959-964`) for a **root** session,
`session_id = SessionId::from(thread_id)` (`:962`), and `thread_id`
(`session.rs:523-528`) is:
- `ThreadId::default()` — a **fresh** id — for `InitialHistory::New | Cleared | Forked` (`:524-525`);
- `resumed_history.conversation_id` — the **preserved** id — for `InitialHistory::Resumed` (`:527`).

So the `session_id` delivered to the `SessionStart` hook:
- is **identical** across a compaction (same `Session` instance);
- is **identical** across a **resume** of the same conversation (resumed
  `conversation_id` is reused);
- is **fresh/different** on `New`, `Cleared` (`/clear`), or `Forked`.

The crews codex shim passes this through verbatim:
`hooks/codex-shim.js:62-69` (`codexToClaudeSessionStartInput` →
`{ session_id: src.session_id, ... source: src.source }`).

### 1.5 Contrast with `Stop` / `PreToolUse` / `PostToolUse`

These are per-tool / per-turn by nature and are NOT gated on the session-start
queue:

- `run_pre_tool_use_hooks` (`hook_runtime.rs:165`) and `run_post_tool_use_hooks`
  (`hook_runtime.rs:295`) fire around each tool call within a turn.
- `run_turn_stop_hooks` (`hook_runtime.rs:328`) fires at end-of-turn.
- `run_pre_compact_hooks` / `run_post_compact_hooks` (`hook_runtime.rs:398`,
  `:437`) bracket a compaction.

So the engine emits `Stop` every turn and `Pre/PostToolUse` every tool call, but
`SessionStart` only when the pending-source queue is non-empty (init / resume /
clear / compact). That asymmetry is exactly what makes the per-message
`SessionStart` notable.

### 1.6 Reconciling the operator's "SessionStart on a new message after Stop"

Within `codex-core`, `SessionStart` cannot fire on turn N>1 of a single
`Session` instance unless something re-queues a source — and the only re-queue is
compaction. Therefore the operator's per-message `SessionStart` implies one of:

- **(A) Compaction between messages** — `SessionStart(compact)`, same `Session`
  instance, **same `session_id`**. Plausible only when near the token limit.
- **(B) The interactive flow re-constructs a `Session` per user turn via
  `InitialHistory::Resumed`** — `SessionStart(resume)`, **same `session_id`**
  (preserved `conversation_id`). This is the by-design explanation that best fits
  "fires on a new message after Stop" within one live conversation and is
  consistent with codex's app-server/thread model differing from Claude/Copilot's
  warm in-process session. (I did not exhaustively trace the TUI↔app-server
  submission path to PROVE it re-resumes per idle turn; the `source` field is the
  decisive confirmation — see §3.)
- **(C/D) A fresh-id construction** (`Cleared` via `/clear`, or `New` if a brand
  new conversation is started per message) — `SessionStart(clear|startup)`,
  **DIFFERENT `session_id`**. This is the only sub-case that breaks crews (§2.4).

**By-design vs fork artifact:** the entire lifecycle (the two queue sites, the
per-turn drain, the `InitialHistory→source` mapping, the `session_id == thread_id`
derivation) is **upstream-canonical**. There are NO `// SANDBOX PATCH:` markers on
any of it: `state/session.rs` has zero markers; the markers in
`session/session.rs` (`:64` additional_instructions, `:1173` mcp-server-notifications),
`turn.rs` (`:1745+` stream-cut diagnostics), and `hook_runtime.rs` (`:57/:217/:947`
pre-tool-use synthetic_response) are all on unrelated seams. The upstream-style
tests in §1.3 further confirm the behavior is the engine's designed contract.
**Conclusion: the per-message `SessionStart` is by-design upstream codex behavior,
not a codex-patched fork artifact.** (Any "new message ⇒ resume" decision, if that
is the trigger, is an upstream codex app-server/TUI design choice, not a fork
edit — the fork's only hook-area edits are the pre-tool-use synthetic_response
seam and the plugin-scope subagent gate, neither of which touches this path.)

---

## STEP 2 — is crews safe under codex's lifecycle?

crews wires `assignMemberRole` (role binding) into `SessionStart` via
`hooks/codex-shim.js` → `hooks/codex-session-start.js` → `hooks/session-start.js`.
So if codex re-emits `SessionStart` per message, `session-start.js::handleInput`
runs per message. Trace:

### 2.1 The idempotency gate — `applyEnvRole` "same" shortcut (the thing that saves us)

`hooks/session-start.js:61-111` (`applyEnvRole`):
- `:69` `const current = readFlag(sessionId, cwd);` — the per-`sessionId` role flag.
- `:70-73` `same` is true when `current.role/name/crew` match the env-desired role.
- `:81-89` `mustForce` is true ONLY when the existing manifest's
  `listenerState === 'recoverable'` (the resume/takeover repair state).
- `:90` **`if (same && !mustForce) return current;`** — early return, **`assignRole`
  is NOT called.**

Because the re-emit (resume/compact) carries the **same `session_id`** (§1.4), the
per-`sessionId` flag already exists with matching role/name/crew, so `same` is
true and (for a normally-armed member) `listenerState` is not `recoverable`, so
`mustForce` is false → **early return, no `assignMemberRole`, no takeover-guard
evaluation, no manifest `sessionId` re-point.** The binding is idempotent.

### 2.2 What still runs per re-emit (real churn, benign for correctness)

`applyEnvRole` returns the existing flag (truthy, not `null`), so
`handleInput` proceeds into the member branch (`session-start.js:279-324`) on
**every** re-emit:
- `:258` `maybeBackfillPointersFromRegistry()` — full registry scan (cheap after
  the per-host `.backfill-v1.7.0-<host>` sentinel; first call does real work).
- `:296-309` builds a `patch` that **re-stamps** `lastSessionStartAt`,
  **`lastHeartbeatAt: new Date().toISOString()`**, `sessionId` (no-op, same value),
  `transcriptPath`, `cwd`, `actorState: 'active'`.
- `:315-319` `ensureActorDir(...)` + `withManifestLock(... updateManifest(...))` —
  a locked manifest write every re-emit.
- `:320` `tryWritePointerFromManifest(...)` — pointer re-write.
- `:323` `out.stdout.write(memberContext(...))` — **re-emits the FULL member
  briefing into codex `additionalContext` on every user message.** This is the
  most tangible negative: per-turn context bloat + repeated "arm your listener"
  guidance.

Notes:
- **`lastListenerEpoch` does NOT grow from this path.** Epoch is owned by
  `markArmed`/`touchHeartbeat` in the listener loop; the `SessionStart` patch never
  touches it. (The task asked specifically; the answer is no epoch churn.)
- **`lastHeartbeatAt` re-stamp without `lastListenerPid`/`lastListenerEpoch`** is a
  minor manifest perturbation. Under the v3.21.0 heartbeat-stamp contract the
  canonical freshness signal is the lock-free `<actorDir>/heartbeat` stamp,
  validated by `stamp.pid === manifest.lastListenerPid && stamp.epoch ===
  manifest.lastListenerEpoch`; a manifest-only `lastHeartbeatAt` bump could briefly
  mask a *dead* listener in the manifest-fallback path, but the stamp validation
  mitigates it. Low severity.

### 2.3 The takeover guard is NOT triggered in the stable-id case

`hooks/actors.js::assignMemberRole` (`:866`) is only reached if `applyEnvRole`
does NOT short-circuit. In the stable-`session_id` case it is not reached at all.
Even if it were reached with the SAME id, `:891` `existing.sessionId === sessionId`
routes to the idempotent same-session branch (resume reset only when
`recoverable`), NOT the takeover path. So the v3.21.x guard
(`existing.sessionId && existing.listenerState !== 'recoverable' &&
(isHeartbeatActive(...) || isActorTabAlive('member', ...))` →
`ActorHeldByLiveSessionError`, `actors.js:930-934`) does NOT fire for a stable-id
re-emit.

### 2.4 The ONE genuine break — re-emit with a DIFFERENT `session_id`

If a per-message `SessionStart` carries a **new** `session_id` for the same live
tab (which is exactly what `/clear` → `InitialHistory::Cleared` → fresh
`thread_id` produces, and what a brand-new `InitialHistory::New` conversation per
message would produce):

1. `applyEnvRole` reads `current = readFlag(NEW_sessionId)` → `null` (the flag is
   keyed by `sessionId`) → `same` is false → it calls
   `assignRole(...)` → `assignMemberRole(name, crew, cwd, NEW_sessionId)`.
2. In `assignMemberRole`, `existing.sessionId !== NEW_sessionId`, so it reaches the
   cross-session takeover guard at `actors.js:930-934`. The member's
   `launcher.pid` (the wt.exe tab pwsh) is alive for the whole session →
   `isActorTabAlive('member', ...)` is true → it **throws
   `ActorHeldByLiveSessionError`**.
3. `applyEnvRole` catches it (`session-start.js:100-108`), logs
   `role assign declined (owner tab alive)`, and **returns `null`**.
4. Back in `handleInput`: `state = envState || runtimeCtx.flag` =
   `null || readFlag(NEW_sessionId)` = `null` → `:271-276` "role unset → no context
   injection" → returns early. **No flag is written for the new `session_id`, and
   no crews briefing is injected.**
5. Subsequent `PreToolUse`/`Stop` hooks for the new `session_id` find no flag → the
   role guard bails → the member **silently drops out of the crew** (no listener
   enforcement, no mail routing, no Stop kind-tag gate).

This is the "binding/identity weirdness" failure shape — but it requires the
`session_id` to CHANGE across the re-emit, which (per §1.4) happens on `/clear`
and on a genuinely-new conversation, NOT on the resume/compact path that best
explains the operator's "new message after Stop." `/clear` is a rare explicit
operator action; note that on Claude/Copilot `/clear` keeps the same session id,
whereas codex `Cleared` mints a fresh `thread_id` — so a codex `/clear` of a crew
member tab is a real (pre-existing, separate) divergence worth a follow-up, but it
is not the reported per-message scenario.

### 2.5 Safety verdict

- **SAFE** for the realistic per-message re-emit (resume / compact): `session_id`
  is stable, `applyEnvRole`'s "same" shortcut makes the re-bind idempotent, the
  takeover guard never fires, the manifest `sessionId` is never re-pointed, and
  `lastListenerEpoch` does not grow. The only costs are per-message I/O churn and
  **briefing re-injection / context bloat**, plus a minor `lastHeartbeatAt`
  re-stamp perturbation.
- **UNSAFE** only if the re-emit carries a *different* `session_id` for the same
  live tab (`/clear`, or a new-conversation-per-message), in which case the member
  silently loses its crews binding (§2.4).

---

## DELIVERABLE

**(a) Confirmed codex `SessionStart` emission lifecycle.** `SessionStart` hooks
run at the start of a turn (`turn.rs:167` → `hook_runtime.rs:105`) when a pending
session-start-source queue is non-empty. The queue is populated at exactly two
sites tree-wide — `Session` construction (`session.rs:1218-1230`, source from
`InitialHistory`: Resumed→`resume`, New/Forked→`startup`, Cleared→`clear`) and
post-compaction (`mod.rs:2665`, `compact`) — and drained per turn
(`state/session.rs:225-236`). The hook payload's `session_id` is
`SessionId::from(thread_id)` (`session.rs:476-478`, `:959-962`) and the
`thread_id` is **preserved on resume** but **fresh on New/Cleared/Forked**
(`session.rs:523-528`). The entire mechanism is upstream-canonical (no SANDBOX
PATCH markers; upstream tests `hooks.rs:1204` and `:1435` pin it) — **by-design,
not a fork artifact.** A "new message after Stop" re-emits `SessionStart` only if
a new `Session` is constructed for that message; within one live conversation that
is a **resume** (same `session_id`), not a fresh session.

**(b) Is crews safe?** **Yes, in the stable-`session_id` case (resume/compact)** —
crews' `applyEnvRole` "same" shortcut (`session-start.js:90`) makes the per-message
re-bind idempotent: no `assignMemberRole`, no takeover-guard evaluation, no
manifest `sessionId` re-point, no `lastListenerEpoch` growth. **Concrete issues
that DO exist:** (1) **non-correctness churn** — the member branch re-stamps the
manifest, re-runs the pointer backfill, and **re-injects the full member briefing
into `additionalContext` on every user message** (context bloat); (2) a minor
`lastHeartbeatAt` re-stamp without epoch/pid; (3) **one genuine break** — if the
re-emit ever carries a *different* `session_id` for the same live tab (`/clear` =
fresh `thread_id`, or a new conversation per message), the takeover guard refuses
the re-bind (`ActorHeldByLiveSessionError`, launcher tab alive), `applyEnvRole`
returns `null`, and the member silently loses its crews binding (no context, no
flag, dropped from PreToolUse/Stop enforcement).

**(c) Recommended fix direction.**
1. **Diagnose first (decisive, cheap):** confirm whether the per-message
   `SessionStart` carries a stable or a changing `session_id` (read the `source`
   field and the hook `session_id` — see §3). This single fact decides
   safe-but-noisy (resume/compact) vs broken (clear/new).
2. **If stable (expected):** make crews' member/lead `SessionStart` branch a cheap
   no-op on a *confirmed same-session re-emit* — i.e., when
   `readFlag(sessionId)` already matches role/name/crew AND the manifest is already
   bound to this `sessionId` AND `listenerState !== 'recoverable'`, **skip the full
   briefing re-injection, the registry backfill, and the redundant manifest
   re-stamp** (keep only a lightweight liveness touch if needed). This kills the
   per-message context bloat and I/O churn without changing the binding contract.
3. **If the id changes per message:** the correct fix is on the **codex side** —
   don't re-emit `SessionStart` per message / keep the interactive conversation
   warm like Claude/Copilot (so a "new message after Stop" is a warm turn, not a
   new-`Session` resume). A crews-only mitigation (relaxing the takeover guard to
   treat a same-name + same-`launcher.pid` re-bind as a benign rebind rather than a
   refusal) is possible but risks weakening the v3.21.1 lens-child takeover
   protection, so it should only be considered if the codex-side fix is
   infeasible.
4. **Separate, pre-existing follow-up:** codex `/clear` mints a fresh `thread_id`
   (so a fresh `session_id`), unlike Claude/Copilot. A `/clear` of a crew-member
   tab will therefore drop its crews binding by the §2.4 mechanism. Worth its own
   task if `/clear` on member tabs is a real workflow.

---

## §3 — Decisive diagnostic (for whoever follows up)

The whole safe-vs-broken split hinges on the `session_id` (and `source`) of the
per-message `SessionStart`. To capture it on the live member tab:

- Inspect the crews codex SessionStart hook input. The shim receives codex's
  `{ session_id, source, ... }` and passes both through
  (`hooks/codex-shim.js:62-69`). Add (temporarily) or grep an existing log of the
  hook stdin, OR read `crews.log` for the per-`SessionStart` member-branch
  manifest write and compare the stamped `sessionId` across consecutive messages.
- Interpretation:
  - `source == "resume"` and the `session_id` is **unchanged** across messages →
    **Case B**, crews SAFE (only churn). Most likely.
  - `source == "compact"` and `session_id` unchanged → **Case A**, crews SAFE.
  - `source == "startup"` or `"clear"` and `session_id` **changes** per message →
    **Case C/D**, crews BREAKS per §2.4 — escalate to the codex-side fix.

---

## Appendix — citations (file:line)

codex inner submodule (`codex/external/repos/codex-patched/codex-rs`):
- `core/src/session/turn.rs:167` — per-turn `run_pending_session_start_hooks` call.
- `core/src/session/turn.rs:147,171` — ordering: pre-sampling compact (before),
  `UserPromptSubmit`/`run_hooks_and_record_inputs` (after).
- `core/src/hook_runtime.rs:105-158` — `run_pending_session_start_hooks` drain loop;
  `:133` `session_id: sess.session_id().into()`; `:147` `run_session_start`.
- `core/src/hook_runtime.rs:165,295,328,398,437` — `Pre/PostToolUse`, `Stop`,
  `Pre/PostCompact` dispatchers (per-tool / per-turn, not queue-gated).
- `core/src/tasks/regular.rs:70` — `RegularTask::run` → `run_turn` (one per message).
- `core/src/state/session.rs:39,225-236` — pending-source `VecDeque`,
  `queue_pending_session_start_source` (push_back), `take...` (pop_front).
- `core/src/session/session.rs:1218-1231` — queue site 1 (construction);
  `InitialHistory`→source mapping (Resumed→Resume, New/Forked→Startup, Cleared→Clear).
- `core/src/session/mod.rs:2645-2666` — queue site 2 (`replace_compacted_history`,
  `:2665` `SessionStartSource::Compact`).
- `core/src/session/session.rs:475-478` — `session_id() == agent_control.session_id()`
  ("identity shared by the root thread and all descendant threads").
- `core/src/session/session.rs:523-528` — `thread_id`: fresh for New/Cleared/Forked,
  `resumed_history.conversation_id` for Resumed.
- `core/src/session/session.rs:959-964` — root session `session_id = SessionId::from(thread_id)`.
- `core/tests/suite/hooks.rs:1204-1248` — first-turn-only `["SessionStart","UserPromptSubmit"]`,
  `source == "startup"`.
- `core/tests/suite/hooks.rs:1435-1535` — resumed thread fires `["resume","compact"]`.
- SANDBOX PATCH audit (none on the lifecycle): `state/session.rs` (0 markers);
  `session/session.rs:64,1173` (unrelated seams); `turn.rs:1745+` (stream-cut
  diagnostics); `hook_runtime.rs:57,217,947` (pre-tool-use synthetic_response).

crews plugin (`ai-developer-toolkit/plugins/crews`):
- `hooks/codex-shim.js:62-75` — `codexToClaudeSessionStartInput` passes
  `session_id` + `source` through; forwards optional `agent_id`/`agent_type`.
- `hooks/session-start.js:61-111` — `applyEnvRole`; `:69` `readFlag(sessionId)`;
  `:81-89` `mustForce` (only when `listenerState==='recoverable'`); `:90`
  `if (same && !mustForce) return current;` idempotent shortcut; `:100-108`
  catches `ActorHeldByLiveSessionError` → returns `null`.
- `hooks/session-start.js:252-324` — `handleInput` member branch runs per re-emit:
  `:258` `maybeBackfillPointersFromRegistry`; `:296-309` patch (re-stamps
  `lastHeartbeatAt`/`lastSessionStartAt`/`actorState`); `:315-319` locked
  `updateManifest`; `:323` `memberContext(...)` briefing re-injection.
- `hooks/actors.js:866-939` — `assignMemberRole`; `:891` same-session idempotent
  branch; `:930-934` cross-session takeover guard + `ActorHeldByLiveSessionError`.
- `hooks/actors.js:714-720` `isHeartbeatActive`; `:740-` `isActorTabAlive`
  (reads `launcher.pid`).
