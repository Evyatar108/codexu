# Investigation: PreToolUse "(hook errored)" denial despite the 3.23.3 fail-soft sweep

Task: `crews-pretooluse-hook-errored-denial-despite-failsoft-investigation`
Scope: READ-ONLY. crews plugin only (`ai-developer-toolkit/plugins/crews`).
Date: 2026-06-25.

---

## TL;DR root-cause verdict

**Cause = 2b + 2c (NOT 2a).** The crash-sweep (2a) is genuinely fail-soft and is
*not* the deny source. The denial is produced by **a DIFFERENT lock op on the
PreToolUse path that is NOT wrapped fail-soft (2b) — `markArmIntent` →
`withManifestLock` — whose thrown `LockTimeoutError` is then deliberately mapped
to a DENY (2c) by crews' own `FAIL_CLOSED_ERRORS` set, AND, if it ever escapes
uncaught, by the engine runtime's non-timeout-error → fail-closed deny path
(`hookPreToolUseErroredMessage` = the literal "(hook errored)" string).**

The 3.23.3 fix shrank the lock *window* (the sweep no longer holds the latch
across an O(N×CIM) scan) but left the *denial mechanism* untouched: a
`LockTimeoutError` thrown by any non-sweep lock op on the PreToolUse path is
still treated as fail-CLOSED. Under box-wide AV/IO pressure (which an OLD,
pre-3.23.3 listener running the O(N)-in-lock sweep still creates), the lead's own
`manifest.json.lock` acquisition in `markArmIntent` times out at 2000 ms, throws
`LockTimeoutError`, escapes `handleInput`, and the wrapper denies the tool.

**Fix: make the PreToolUse path fail-OPEN (allow) on `LockTimeoutError`** — mirror
the runtime's OWN intent, which already *allows* on a hook *timeout*
("allowing the tool call to proceed"). Lock contention is a "couldn't complete
the advisory bookkeeping" condition, semantically identical to a timeout, and
must degrade to allow, never deny.

---

## 1. Full PreToolUse execution path + every lock acquisition (in order)

`hooks/pre-tool-use.js::handleInput({ input, io }, ctx)` runs, per fire, in this
order. Lock ops are flagged.

| # | Step (file:line) | Takes a lock? | Fail-soft? | Can deny? |
|---|---|---|---|---|
| 1 | `stateWriteBlockReason(data, cwd)` → deliberate `.crews`-write block (`pre-tool-use.js:387`) | no | n/a | deliberate block (no throw) |
| 2 | subagent skip + role guard (`:394-400`) | no (lock-free reads) | n/a | no |
| 3 | `assertSessionOwnsActor(...)` (`:406`) → `readManifest` + `getEffectiveActorState` (`actors.js:1294-1311`) | **no** — `readJsonStrict`, lock-free | wrapped in try/catch (`:407-465`) | deliberate clean blocks (RecipientLeftAt / IdentityMismatch / `else block(e.message)`) |
| 4 | `sweepMemberCrashNotifications({ throttle:true })` (lead only) (`:475-485`) | **YES** — latch `withStateFileLock(getLatchPath)` (`member-crash-notifications.js:433`) | **YES — try/catch + appendLog (3.23.3)** | **no** (fail-soft) |
| 5 | `markArmIntent(...)` on arm-tool calls (`:490`) → `actors.js:1449` → **`withManifestLock(name,crew,cwd,role,...)`** (`actors.js:1453`) → `acquireLock` (`locks.js:171`) | **YES — manifest lock** | **NO — UNGUARDED in handleInput** | **YES — throws `LockTimeoutError` → escapes → fail-closed deny** |
| 6 | `isReviewMailCall(...)` (`:521`) | no | n/a | no |
| 7 | `getListenerState(...)` (`:526`) → `readJsonStrict` + `effectiveHeartbeatAt` (`actor-state.js:122-130`) | **no** — lock-free | n/a | no |
| 8 | AskUserQuestion intercept → `routeAskUserQuestionToLead` → `appendSystemMailbox` (member only) (`:541-543`) | mailbox lock (member path) | partial (fails open on recipient errors) | deliberate block |
| 9 | `reviewRequiredReason(...)` (`:607`) | no — lock-free reads | n/a | deliberate review-first block |
| 10 | final arm-first `block(reason)` (`:635`) | no | n/a | deliberate block |

**Conclusion:** the only UNGUARDED lock op on the path is **#5 `markArmIntent` →
`withManifestLock`** (and, defensively, any future lock op added below the
`assertSessionOwnsActor` try/catch). The sweep (#4) is fail-soft. Reads (#3, #7,
#9) take no lock. So a `LockTimeoutError` that escapes `handleInput` comes from
the manifest lock in `markArmIntent`, which fires on the lead's listener-arm tool
call — the lead's FIRST tool call each turn.

---

## 2. Settling 2a / 2b / 2c against source

### 2a — the crash-sweep: RULED OUT

The sweep is genuinely fail-soft at all four call sites, including PreToolUse:

```js
// pre-tool-use.js:475-485
if (state.role === 'lead') {
  try {
    sweepMemberCrashNotifications({ leadName: state.name, crew, cwd, throttle: true });
  } catch (sweepErr) {
    try { appendLog(`member-crash-sweep-failed ... err=${code}:${msg}`, cwd); }
    catch (_) { /* observability best-effort */ }
  }
}
```

A `LockTimeoutError` from the sweep's `withStateFileLock(getLatchPath...)` is
caught and logged; the tool is allowed. This is pinned by the EXISTING regression
test `tests/member-crash-lock-contention.test.js` case (a) "FAIL-SOFT": it forces
the sweep export to throw a `LockTimeoutError` and asserts `blocked === null`.
The 3.23.3 plan's own framing confirms the intent: *"all four sweep call sites
try/catch + appendLog … so no tool is denied."* So 2a is not the cause — and the
3.23.3 fix correctly neutered it.

**Why 3.23.3 still believed the bug was closed but it wasn't:** the 3.23.3 plan
reasoned "the only lock the sweep touches is fail-soft, therefore no deny." It
only audited the SWEEP's lock op. It never audited the OTHER lock op on the same
hook path (`markArmIntent`), which is NOT fail-soft and IS mapped fail-closed.

### 2b — a DIFFERENT non-fail-soft lock op: CONFIRMED (proximate trigger)

`markArmIntent` (`actors.js:1449`) acquires the actor's `manifest.json` lock:

```js
function markArmIntent(name, crew, cwd, opts) {
  ...
  return withManifestLock(name, crew, cwd, role, () => { ... });   // actors.js:1453
}
```

`withManifestLock` → `acquireLock(getManifestLockPath(...), 2000ms)`
(`locks.js:253-255`). On contention `acquireLock` retries through transient
EPERM/EACCES/EBUSY/UNKNOWN errors with jitter until the 2000 ms deadline, then
`throw new LockTimeoutError(lockPath, timeout)` (`locks.js:192`). In
`handleInput` the call is **unguarded** (`pre-tool-use.js:490`), so the throw
propagates out of `handleInput`.

This fires on the lead's listener-arm tool call (`isListenerArmToolCall` true →
the `markArmIntent` branch at `:487-496`), i.e. the arm command the lead must run
as its FIRST tool call each turn. Box-wide AV/IO pressure makes even the lead's
OWN `manifest.json.lock` (a different file from the latch) flaky to acquire — the
contention is general scanner/IO pressure, not specifically the held latch file.

### 2c — the error → deny mapping: CONFIRMED (load-bearing root cause)

Two layers both turn a thrown `LockTimeoutError` into a DENY:

**(i) crews-side — `FAIL_CLOSED_ERRORS` deliberately includes `LockTimeoutError`.**

```js
// pre-tool-use.js:638-641  (Claude entry)
const FAIL_CLOSED_ERRORS = new Set([
  'TamperedFileError', 'IdentityMismatchError', 'LockTimeoutError',
  'RecipientNotFoundError', 'RecipientLeftAtError', 'MailboxFullError', 'HopLimitError'
]);
if (require.main === module) {
  try { handleInput(...); }
  catch (e) { if (e && FAIL_CLOSED_ERRORS.has(e.name)) { block(e.message); return; } ... }
}
```

```js
// copilot-shim.js:204-210  (Copilot entry, used by copilot-pre-tool-use.js:38)
const FAIL_CLOSED_ERRORS = new Set([
  'TamperedFileError', 'IdentityMismatchError', 'LockTimeoutError', ...]);
function isFailClosedError(err) { return !!(err && FAIL_CLOSED_ERRORS.has(err.name)); }
```

`LockTimeoutError.name === 'LockTimeoutError'` (`errors.js:24-31`). So when the
escaped `LockTimeoutError` reaches the wrapper:

- Claude (`pre-tool-use.js:647-650`): `block(e.message)` → writes
  `{decision:'block', reason:"LockTimeoutError: timed out after 2000ms acquiring …"}`.
- Copilot (`copilot-pre-tool-use.js:37-43`): `isFailClosedError(e)` → writes
  `{permissionDecision:'deny', permissionDecisionReason:"LockTimeoutError: …"}`.

The Copilot runtime renders this as
`Denied by preToolUse hook: LockTimeoutError: timed out after 2000ms acquiring …`
(clean deny, reason verbatim). This is a crews CHOICE — not a runtime necessity.

**(ii) runtime-side — non-timeout hook error → "(hook errored)" deny; hook
timeout → ALLOW.** Verified in the installed Copilot CLI bundle
(`C:\Users\evmitran\.copilot\pkg\win32-x64\1.0.65\app.js`). The preToolUse hook
dispatcher:

```js
try {
  c = await o.handler({ sessionId, timestamp, cwd, toolName:a, toolArgs:l });
  if (c?.permissionDecision === "deny" && ...) n.set(s.id, `Denied by preToolUse hook: ${c.permissionDecisionReason}`);
  ...
} catch (a) {
  if (a instanceof WE) {                       // WE = "Hook command timed out after N seconds"
    this.logger.warning(`preToolUse hook ... timed out; allowing the tool call to proceed: ...`);
    continue;                                  // <-- TIMEOUT → ALLOW
  }
  this.logger.error(`Error in preToolUse hook ... (fail-closed): ...`),
  n.has(s.id) || n.set(s.id, Pde(o));          // <-- ANY OTHER throw → DENY
}
```

and the handler `Eft(...)` throws on non-zero exit / spawn error:

```js
// Eft(): if outcome==="timeout" throw WE(...);  if r=exitCode; if r!==0 throw E3(r,...) "Hook command failed with code N"
```

and the deny-message function:

```js
function Pde(t){ return x.hookPreToolUseErroredMessage(t.source); }   // app.js (1.0.65) ~idx 241631
```

`x.hookPreToolUseErroredMessage(source)` is the literal **"(hook errored)"**
text the operator saw. It fires when the hook handler throws a NON-timeout error
— i.e. when the crews `copilot-pre-tool-use.js` process **exits non-zero / spawn-
errors / emits unparseable output**. So:

- If crews catches the `LockTimeoutError` and emits an explicit deny envelope →
  `Denied by preToolUse hook: LockTimeoutError: …` (clean deny).
- If the `LockTimeoutError` (or a follow-on IO/`appendLog` failure under the same
  pressure) ever escapes the wrapper UNCAUGHT, or on any crews build whose
  wrapper didn't catch it → the crews process exits non-zero → the runtime's
  non-timeout branch → **`Denied by preToolUse hook (hook errored)`** via
  `hookPreToolUseErroredMessage`.

Both renderings trace to the SAME crews root cause: **crews treats a
LockTimeoutError as fail-CLOSED instead of fail-OPEN.** The "(hook errored)" form
is the operator-observed manifestation of the non-zero-exit/uncaught variant; the
"…: LockTimeoutError: …" form is the explicit-deny variant. Critically, the
runtime ALREADY models "the hook couldn't finish in time" as ALLOW (the `WE`
branch). crews violates that model by converting a recoverable lock-contention
failure into a deny.

---

## 3. What 3.23.3 covered vs. left open

`crews-liveness-notifications-lock-contention-hook-errored` (crews 3.23.3,
`member-crash-notifications.js` two-phase split):

- **Covered:** shrank the SWEEP's lock-hold window from `O(N members × CIM)` to
  `O(notify-count × small write)` — reduced the contention SOURCE — and added a
  regression test pinning the four sweep call sites fail-soft. Its plan asserts
  "no tool is denied."
- **Left open (this bug):**
  1. The PreToolUse hook's OWN non-sweep lock op (`markArmIntent` →
     `withManifestLock`) is still UNGUARDED in `handleInput` and still throws
     `LockTimeoutError`.
  2. The error → deny mapping was never touched: `FAIL_CLOSED_ERRORS` still
     includes `'LockTimeoutError'` in BOTH entry points, so any escaped
     `LockTimeoutError` is still a deny.
  3. An OLD, pre-3.23.3 listener (running the O(N)-in-lock sweep) STILL exists in
     practice and STILL produces the box-wide contention — and a long-running
     listener does NOT pick up the 3.23.3 code until it re-arms (re-spawns a
     fresh `node $CREWS_BIN arm` process), which an indefinitely-armed idle
     listener may not do for a long time. So the 3.23.3 window-shrink doesn't
     even reach the in-flight offender.

Net: 3.23.3 reduced how OFTEN the latch is contended; it did nothing about what
happens when ANY lock on the PreToolUse path times out. The denial survives.

(Complementary in-flight task `crews-hook-timeout-under-lock-contention` (crews
3.19.1 plan) attacks the contention FREQUENCY from the other side — de-contend
the heartbeat off the manifest lock, kill the orphan-lock cascade, cut per-hook
IO. That reduces how often `markArmIntent`'s lock times out but, like 3.23.3,
does NOT change the fail-closed mapping. The two are complementary; THIS task is
the safety net that makes the gate resilient even when contention still happens.)

---

## 4. Proposed fix

### Primary fix (sufficient on its own): PreToolUse fails OPEN on LockTimeoutError

Make a lock/sweep/contention error on the PreToolUse path degrade to **allow the
tool**, never deny — mirroring the runtime's own "hook timed out → proceed"
behavior. Concretely, a catch-all that distinguishes a *deliberate block* (which
writes `{decision:'block'}` and `return`s — no throw) from an *internal
contention error* (a thrown `LockTimeoutError`), and allows on the latter.

Single best edit point — inside `handleInput` so ONE change covers BOTH engine
wrappers (both call `handleInput`) and short-circuits BEFORE the wrapper's
`FAIL_CLOSED_ERRORS` check ever sees the error:

1. **Wrap the lock-taking region (step #4 onward, after the
   `assertSessionOwnsActor` try/catch) in a top-level `try/catch` in
   `handleInput`.** On `LockTimeoutError` (and, conservatively, any unexpected
   non-deliberate error): `appendLog('pre-tool-use: lock-contention degraded to
   allow …')` + `return` WITHOUT writing a block envelope (= allow). Deliberate
   blocks are unaffected because they `return` after writing and never throw.

2. **Remove the fail-CLOSED treatment of `LockTimeoutError` on the PreToolUse
   entry points (defense-in-depth, in case it still escapes):**
   - `pre-tool-use.js:638-653` (Claude `require.main` block): on
     `e.name === 'LockTimeoutError'` → log + ALLOW (do NOT `block`).
   - `copilot-pre-tool-use.js:37-48`: on a `LockTimeoutError`, take the
     fail-OPEN branch (`process.stdout.write('{}')`) instead of writing a deny
     envelope. Scope this to the PreToolUse shim — do NOT remove `LockTimeoutError`
     from the SHARED `copilot-shim.js` `FAIL_CLOSED_ERRORS` set, because Stop /
     SessionStart may legitimately want different semantics. (Either special-case
     `LockTimeoutError` in `copilot-pre-tool-use.js` before the `isFailClosedError`
     check, or thread a per-surface "lockTimeoutFailsOpen" flag.)

3. **Guarantee the crews process never exits non-zero / never emits malformed
   output under contention** (so the runtime's "(hook errored)" non-zero-exit
   path can't fire either): the `handleInput` catch-all + a wrapper-level final
   safety net that always writes a valid allow envelope (`{}` / nothing) on any
   otherwise-unhandled error. The crews wrapper should ALWAYS exit 0 with a valid
   allow/deny JSON.

Why allow (not deny) is correct here: per the cooperative-agent threat model
documented throughout crews AGENTS.md, the PreToolUse gate is a SELF-DISCIPLINE
mechanism (arm-first rule, `.crews` write-guard), not a security boundary. The
advisory bookkeeping that needs the lock (`markArmIntent` stamp, the crash sweep,
listener-state read) is best-effort. Failing it OPEN means the agent proceeds
without the advisory stamp — fully recoverable. Failing it CLOSED hard-deadlocks
the lead (it can't even run `ask_user` to ask for help). The asymmetry of harm is
decisive, and it matches the runtime's own timeout = allow design.

Keep genuinely-fail-closed errors fail-closed: `TamperedFileError` (real manifest
corruption) and the deliberate `.crews`-write block stay as denies. Only the
CONTENTION error (`LockTimeoutError`) flips to allow.

### Secondary mitigation: the old-listener-cycle question

- **Not required for correctness once the primary fix lands.** The catch-all-ALLOW
  makes the lead resilient to ANY lock contention regardless of whether a stale
  pre-3.23.3 listener is wedging a lock. This is the right architectural answer
  (fix the gate's resilience) rather than depending on cycling offenders.
- **A long-running listener CANNOT hot-swap code without re-spawn.** Hook
  processes are spawned fresh per fire and DO pick up new on-disk code, but the
  `lib/listener-loop.js` process is loaded ONCE at arm time and keeps the OLD
  sweep until it next re-arms (a fresh `node $CREWS_BIN arm` on the next message
  delivery / timeout). An indefinitely-armed idle pre-fix listener can stay stale
  a long time. So "wait for it to cycle" is unreliable.
- **Optional lead-side hardening (lower priority):** stamp the running crews
  version into the manifest at arm time (e.g. `listenerCrewsVersion`), and have
  the lead detect members whose listener predates the lock-fix version and
  force-cycle them (`/stop-member` + respawn, or send a no-op message to trigger
  a re-arm that loads new code). This reduces the noise/contention SOURCE but is
  strictly secondary to the gate-resilience fix. Best folded into the broader
  `crews-hook-timeout-under-lock-contention` effort rather than this task.

---

## 5. Regression test sketch

Add to `tests/member-crash-lock-contention.test.js` (or a new
`tests/pretooluse-lock-timeout-fails-open.test.js`), mirroring the existing
monkeypatch-then-fresh-require harness used by case (a):

```js
// (d) NON-SWEEP LOCK OP — markArmIntent's manifest lock throws LockTimeoutError;
//     PreToolUse must ALLOW (no deny), not just for the sweep.
{
  const cwd = freshCwd(); const crew = 'demo'; const leadName = 'lead1';
  const leadSession = `${leadName}-session`;
  seedCrewMeta(cwd, crew, [leadName]);
  // UNARMED lead so the arm-tool path reaches markArmIntent.
  seedLead(cwd, crew, leadName, { listenerState: 'never-armed' });
  cfg.writeFlag(leadSession, { role: 'lead', crew, name: leadName }, cwd);

  // Force the manifest-lock op to throw LockTimeoutError. Patch the function
  // pre-tool-use destructures at module top (listener-protocol.markArmIntent),
  // then fresh-require pre-tool-use so it captures the throwing stub.
  const lp = require('../hooks/listener-protocol');
  const origMarkArm = lp.markArmIntent;
  lp.markArmIntent = function () {
    const err = new Error('timed out after 2000ms acquiring manifest.json.lock');
    err.name = 'LockTimeoutError';
    throw err;
  };
  delete require.cache[PRE_TOOL_USE_PATH];
  const pre = require('../hooks/pre-tool-use');

  let blocked = null;
  const io = { stdout: { write: s => { blocked = s; } }, stderr: { write() {} } };
  // An arm tool call -> isListenerArmToolCall true -> markArmIntent (throws).
  const armCmd = "node $CREWS_BIN arm lead1 --crew demo --cwd " + cwd;
  process.env.CREWS_STATE_CWD = cwd;
  try {
    pre.handleInput({ input: JSON.stringify({
      tool_name: 'bash',
      tool_input: { command: armCmd, mode: 'async' },
      session_id: leadSession, cwd
    }), io });
  } finally {
    lp.markArmIntent = origMarkArm;
    delete require.cache[PRE_TOOL_USE_PATH];
  }
  // BEFORE the fix this asserts the bug (blocked is a deny envelope). AFTER the
  // fix: allow (no block written).
  equal(blocked, null, '(d) markArmIntent LockTimeoutError must ALLOW, not deny');
}

// (e) NEGATIVE/regression — a DELIBERATE block still blocks (the catch-all only
//     swallows thrown lock errors, never deliberate blocks). E.g. an unarmed
//     lead running a NON-arm tool still gets the arm-first block.
{
  // ... seed unarmed lead, send tool_name:'Read'; assert blocked !== null and
  // the reason contains 'arm a background listener'.
}

// (f) WRAPPER-LEVEL — copilot-pre-tool-use.js subprocess: when handleInput throws
//     LockTimeoutError, the emitted envelope is ALLOW ({} / no permissionDecision
//     === 'deny') AND the process exits 0 (so the runtime '(hook errored)'
//     non-zero-exit path cannot fire). Mirror tests/copilot-review-fixes.test.js
//     spawnSync harness; inject a throwing lock via env/monkeypatch.
```

Key assertions:
- (d) markArmIntent `LockTimeoutError` → `blocked === null` (ALLOW). This is the
  case the existing (a) does NOT cover — (a) only forces the *sweep* to throw.
- (e) a deliberate block still denies (proves the fix doesn't over-swallow).
- (f) wrapper exits 0 with a valid allow envelope on `LockTimeoutError` (closes
  both the explicit-deny and the non-zero-exit "(hook errored)" variants).

---

## Evidence index (file:line)

- Path + lock ops: `pre-tool-use.js:382-636` (handleInput); sweep fail-soft
  `:475-485`; `markArmIntent` unguarded `:490`.
- `markArmIntent` → manifest lock: `actors.js:1449-1490`; `withManifestLock`
  `locks.js:253-262`; `acquireLock` throw `locks.js:171-193`.
- Lock-free reads: `assertSessionOwnsActor` `actors.js:1294-1311`; `readManifest`
  `actors.js:630-633`; `getListenerState` `actor-state.js:122-130`.
- Fail-closed mapping: `pre-tool-use.js:638-653`; `copilot-shim.js:199-223`;
  `copilot-pre-tool-use.js:35-48`; `LockTimeoutError` name `errors.js:24-31`.
- Runtime mapping (Copilot 1.0.65 `app.js`): preToolUse deny render `~idx 2341482`
  (`Denied by preToolUse hook: ${permissionDecisionReason}`); timeout→allow vs
  error→deny catch `~idx 2342050-2342300`; handler throw on non-zero exit `Eft` /
  `E3` `~idx 234900-235600`; `Pde(t)=x.hookPreToolUseErroredMessage(t.source)`
  `~idx 241631`.
- 3.23.3 coverage/limits: `tests/member-crash-lock-contention.test.js` (sweep-only
  fail-soft); plan `.ralph/jobs/crews-liveness-notifications-lock-contention-hook-errored/plan.md`.
- Complementary frequency-reduction task: `.ralph/jobs/crews-hook-timeout-under-lock-contention/plan.md`.
- Listener can't hot-swap code without re-arm: crews AGENTS.md "Plugin update vs
  session restart" + codexu AGENTS.md "Listener re-arm + plugin update discipline".
