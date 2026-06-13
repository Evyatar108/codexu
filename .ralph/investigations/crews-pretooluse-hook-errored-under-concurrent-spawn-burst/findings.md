# Verdict

The broad hypothesis is confirmed, with one important narrowing: this looks like a **runtime-level hook failure during a concurrent SessionStart/arming burst**, not a normal `pre-tool-use.js` logic exception, and not the older deterministic "single hook path exceeds a 5s budget" bug.

On Copilot, `preToolUse` is launched as a fresh `node hooks/copilot-pre-tool-use.js` subprocess with `timeoutSec: 30` (`ai-developer-toolkit/plugins/crews/.github/plugin/hooks.json:22-29`). The Copilot wrapper converts handled failures into valid JSON: fail-closed errors become `{ decision: "block", reason }`, and all other caught exceptions log and return `{}` with exit 0 (`ai-developer-toolkit/plugins/crews/hooks/copilot-pre-tool-use.js:35-47`, `:49-56`). So a Copilot-side message of the form **"Denied by preToolUse hook (hook errored)"** is much more consistent with **the hook child not returning a parseable response at all** (timeout, launch/startup starvation, or abrupt termination) than with an ordinary JS throw inside crews.

What the source supports is: under a spawn burst, crews creates many fresh Node hook processes, and those processes perform synchronous `.crews` reads/writes, lock acquisition, and manifest rewrites. The lead's own PreToolUse path is not, by itself, an obvious 30s critical section; the failure is better explained as **process-burst saturation plus synchronous filesystem/lock work across many sibling hook children**. This is distinct from the older `crews-hook-timeout-under-lock-contention` finding, which was about a deterministic 5s timeout ceiling on Codex/Claude hook registrations. Copilot's registration here is already 30s (`.github/plugin/hooks.json:22-45`), so the prior 5s mechanism is not the main explanation for this incident.

# Why this is not a normal hook exception path

1. Copilot launches a fresh Node process per hook fire:
   - `preToolUse` -> `node hooks/copilot-pre-tool-use.js` with `timeoutSec: 30` (`.github/plugin/hooks.json:22-29`).
   - `sessionStart` -> `node hooks/copilot-session-start.js` with `timeoutSec: 30` (`.github/plugin/hooks.json:4-11`).
   - `postToolUse` -> `node hooks/copilot-post-tool-use.js` with `timeoutSec: 30` (`.github/plugin/hooks.json:31-38`).

2. The Copilot PreToolUse wrapper is defensive:
   - It calls the shared `pre-tool-use.js` handler (`hooks/copilot-pre-tool-use.js:31-36`).
   - Fail-closed exceptions produce a valid block envelope (`:37-43`).
   - Other exceptions produce `{}` and exit 0 (`:44-47`).
   - Even malformed captured stdout falls back to `{}` (`:49-56`).

That means a user-visible Copilot runtime error is not the normal "hook code threw and crews forgot to handle it" shape. The child likely failed before the wrapper could emit its fallback JSON.

# What one lead PreToolUse fire actually does

The shared `pre-tool-use.js` handler does real work, but the common lead path is not obviously 30s by itself:

- Build runtime context from the session flag (`hooks/pre-tool-use.js:382-405`, `hooks/runtime-context.js:42-50`).
- Read the lead manifest via `assertSessionOwnsActor` (`hooks/pre-tool-use.js:405-465`, `hooks/actors.js:1234-1250`).
- Optionally run the lead crash-sweep backstop (`hooks/pre-tool-use.js:466-485`).
- Recognize listener-arm / review-mail special cases (`hooks/pre-tool-use.js:487-545`).
- Read listener state, possibly read the manifest again, and either allow or build the block reason (`hooks/pre-tool-use.js:526-635`).

The heavy part on this path is the lead crash-sweep, but even that is throttled in PreToolUse. The throttle itself is cheap (mtime check plus best-effort stamp write) (`hooks/member-crash-notifications.js:121-140`, `:245-253`). The full sweep, when it does run, is a crew scan plus a latch lock and per-member health reads (`hooks/member-crash-notifications.js:238-339`; `hooks/health.js:126-176`).

Current local logs show that this shared latch path can contend under load:

- `lock at ... liveness-notifications.json.lock was stolen ...`
- `member-crash-sweep-failed ... LockTimeoutError: timed out after 2000ms acquiring ... liveness-notifications.json.lock`

(`D:\harness-efforts\codexu\.crews\logs\crews.log:11-15`, `:22`, `:31`)

So the lead hot path does have a real shared-lock amplifier, but still not a clean "single deterministic 30s hook body" story.

# What the concurrent SessionStart/arming burst adds

The stronger signal is the *other* hook children running at the same time.

Each new member SessionStart does more than a tiny role bind:

- `maybeBackfillPointersFromRegistry()` runs at the top of every SessionStart (`hooks/session-start.js:339`).
- `startBackfillIfNeeded()` may spawn detached work (`hooks/session-start.js:345`, `:264-273`).
- Member SessionStart reads the manifest, computes an engine patch, seeds actor dirs, then takes `withManifestLock(...)` and rewrites the manifest (`hooks/session-start.js:388-429`).
- It then writes pointer state and may append bootstrap history (`hooks/session-start.js:429-430`).
- Lead SessionStart additionally upserts the lead registry and can run a crash-sweep (`hooks/session-start.js:471-508`).

Listener arming also takes manifest locks:

- `markArmed()` delegates to `touchHeartbeat()` (`hooks/listener-protocol.js:194-209`).
- `touchHeartbeat()` takes `withManifestLock(...)` and rewrites listener/heartbeat fields (`hooks/actors.js:1329-1386`).
- `markArmIntent()` also takes `withManifestLock(...)` and writes advisory hook-context state (`hooks/actors.js:1389-1429`).

The lock/write infrastructure is synchronous:

- Manifest/mailbox locks default to a 2000ms acquisition budget (`hooks/locks.js:23-25`, `:237-255`).
- Atomic rename retries can sleep for up to 6500ms at defaults (`hooks/safe-io.js:41-48`, `:129-154`, `:161-174`).

Again: Copilot's hook cap is 30s here, not 5s. So the point is not "one single PreToolUse write path must exceed 30s." The point is that **many sibling hook children, each with sync startup + sync filesystem + lock + rename-retry work, can create exactly the kind of transient launch/CPU/IO starvation where one unlucky child never gets back to the wrapper in time**.

# Saturation trigger characterization

I would characterize the trigger this way:

1. **Fresh-node-per-fire is load-bearing.** Copilot does not keep a warm hook daemon; each hook fire starts a fresh Node child (`.github/plugin/hooks.json:4-45`).
2. **SessionStart is the expensive phase.** It does materially more filesystem work than the steady-state lead PreToolUse path (`hooks/session-start.js:339-508`).
3. **Arming adds more lock/write traffic.** `markArmIntent` / `touchHeartbeat` both go through manifest locks (`hooks/actors.js:1329-1429`).
4. **The lead's own PreToolUse is mostly collateral damage.** It is competing with the spawn-burst children for process startup, CPU, Defender-scanned filesystem access, shared `.crews` logs, and some shared latch/registry/pointer paths.
5. **The observed Copilot error string fits a "no valid response came back" failure mode better than a handled JS exception.** The wrapper would otherwise emit valid JSON (`hooks/copilot-pre-tool-use.js:35-56`).

So the narrow claim "the lead PreToolUse logic itself is intrinsically too slow" is **not** confirmed. The broader claim "fresh-node-per-fire plus synchronous manifest/filesystem work can make an individual PreToolUse invocation miss the Copilot hook window during a concurrent SessionStart burst" **is** confirmed.

# Mitigation ranking

| Rank | Mitigation | Type | Why it ranks here |
| --- | --- | --- | --- |
| 1 | **Throttle/stagger concurrent spawns / SessionStart bursts** | Operating guidance now; code follow-up later | Highest-confidence fix for this exact incident shape. The failure is burst-correlated, and reducing the burst directly reduces fresh Node count and concurrent hook/filesystem pressure. |
| 2 | **Reduce SessionStart per-fire work** | crews-code | Best code-side structural fix. SessionStart is the heavier hook, and every new member pays it. Defer non-critical work (pointer backfill, detached backfill trigger, optional sweep/registry work) out of the critical hook window where possible. |
| 3 | **Add a cheaper lead PreToolUse fast-path for the common armed case** | crews-code | Helpful secondary fix. Keep the steady-state lead path as close to "read flag, verify ownership, allow" as possible, and avoid optional sweep/log/state work on the hot path when the listener is already armed. |
| 4 | **Hook self-retry/backoff for transient empty-output/startup failures** | crews-code | Limited value. It can help only if the wrapper gets enough CPU time to run a second attempt. It cannot rescue a child that the runtime kills after 30s or never schedules promptly enough. |
| 5 | **Lower global rename/lock retry budgets** | crews-code / env workaround | Poor primary fix for this bug. It targets the older lock-budget family and weakens listener-heartbeat AV resilience. Use only as a last-resort experiment, not the main answer here. |

# Immediate mitigation

The best immediate mitigation is **operational**: do not fire the 4th spawn while 3 fresh members are still in SessionStart/arming. Let the first wave settle, then top up.

If an env-only mitigation is needed today, the least damaging existing knob is:

- `CREWS_CRASH_SWEEP_THROTTLE_MS` - raise it on the lead so the PreToolUse backstop sweep runs less often (`hooks/member-crash-notifications.js:102-140`, `hooks/pre-tool-use.js:466-485`).

I would **not** use `CREWS_RENAME_RETRY_LIMIT` as the first response here. It exists (`hooks/safe-io.js:76-95`), but it weakens the listener-heartbeat path that the earlier lock-contention work intentionally protected.

# Recommended follow-up scope

1. Add a spawn-burst-safe policy in the lead/orchestrator layer (cap new concurrent spawns; delay new spawn until prior SessionStart/arm settles).
2. Audit SessionStart for work that can move off the critical hook path.
3. Audit lead PreToolUse for an earlier armed fast-path and for optional work that can be skipped/deferred under load.
4. Only after that, consider wrapper-level retry logic for transient "no output produced" cases.

# Distinction from the earlier lock-timeout task

`crews-hook-timeout-under-lock-contention` was about a deterministic 5s timeout budget on Codex/Claude hook registrations and the fact that the canonical retry/lock budget could exceed that ceiling. This incident is different:

- Copilot already gives the hook 30s (`.github/plugin/hooks.json:22-45`).
- The wrapper would normally emit valid JSON even on handled failures (`hooks/copilot-pre-tool-use.js:35-56`).
- The incident is burst-shaped: multiple fresh SessionStart/arm children plus the lead's own hook, all competing at once.

So the right fix direction here is **burst control and critical-path slimming**, not merely "shrink the per-write retry budget."
