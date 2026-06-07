# Research Brief: crews arm fail-loud guard (D-001)

Seeded from brainstorm `.ralph/brainstorms/crews-arm-chaining-footgun-guard/selected-direction.md`.
Crews source lives in submodule `ai-developer-toolkit/plugins/crews/` (uninitialized in the plan
worktree; all paths below are in the PRIMARY checkout). Crews version currently **3.7.0**.

## Researcher Findings

### Arm dispatch (`tools/crews.js`)
- `tools/crews.js:43-49` dispatches `arm` to `runListenerLoop(args, out, opts)`; `:45-48` is the
  `--help` short-circuit. Script exit is `dispatch(...).then(code => process.exit(code))` (`:55-56`).
- No arm-specific envelope/exit logic here — it fully delegates to `runListenerLoop`. So the seam
  is `lib/listener-loop.js`, not `crews.js`.

### `lib/listener-loop.js` outcomes (return shapes)
`runListenerLoop(argv, io, opts)` returns a Promise<numericExitCode>. Outcomes:
- **Invalid args** (`:98-101`): no name, or bad `--timeout-ms` → writes usage to **stderr**,
  `return 2` (synchronous; **did NOT become a listener**; already loud + non-zero).
- **arm-skipped** (`:136-152`): `markArmed(... requireFreshArm:true)` returns `{skipped, reason,
  existingPid}` → `finish({type:'arm-skipped', reason, name, crew, sessionId, selfPid, existingPid}, 0)`
  → writes JSON envelope to **stdout**, resolves **code 0** (**did NOT become a listener** — the
  swallowable footgun envelope).
- **messages** (`:231-257`): after a successful `markArmed`, the loop captures `listenerEpoch`
  (`:154-165`), arms heartbeat/poll/watch, then BLOCKS; `tryDeliver` → `{type:'messages', ...}` code 0
  (**BECAME the listener**).
- **timeout** (`:259-271`): `bail(...)` → `{type:'timeout', ...}` code 0 (**BECAME the listener**).
- **error** (`:180-228`, `:240-243`): heartbeat-terminate or deliver-error → `{type:'error', ...}`
  code 1 (**BECAME the listener**).

Key structural fact: a **successful fresh arm BLOCKS** (heartbeat loop) and only returns via
messages/timeout/error. The only **immediate, no-new-listener returns** are invalid-args and
arm-skipped. A guard gated on "no-new-listener immediate return" therefore CANNOT fire on the
legitimate long-running async listener — it is safe by construction.

`finish` → `writeJsonAndResolve` (`:122-131`) does `stdout.write(JSON.stringify(payload)+'\n',
() => resolve(code))`. **Any injected fake stdout in a test MUST call the write callback or the
Promise hangs.**

### `markArmed` / skip reasons (`hooks/listener-protocol.js`, `hooks/actors.js`)
- `markArmed(name, crew, cwd, {sessionId, listenerPid, requireFreshArm})` (`listener-protocol.js
  :193-207`) wraps `touchHeartbeat`.
- `touchHeartbeat` (`actors.js:923-985`) is authoritative for skip reasons, returned under the
  manifest lock:
  - `session-mismatch` (`:929-931`): `current.sessionId !== opts.sessionId`. `existingPid: null`.
    → **no live listener guaranteed (UNSAFE)**.
  - `recoverable-pending-takeover` (`:933-935`): `deriveListenerState(current)==='recoverable'`.
    `existingPid: null`. → **no live listener (UNSAFE)**.
  - `already-active-listener` (`:936-947`): `requireFreshArm` + state ∈ FRESH_ARM_GUARD_STATES +
    `lastListenerPid` is an int ≠ self + heartbeat age < HEARTBEAT_STALE_MS + `isProcessAlive(pid)
    !== false`. Returns `existingPid: <int>`. → **a genuinely live listener exists (SAFE — the
    caller is covered).** (If the PID were stale/dead, `deriveListenerState` demotes to `exited`
    and the arm PROCEEDS to become a new listener instead of skipping.)
- `hooks/listener-protocol.js:101-149` documents why deep shell-pipeline tokenization was
  intentionally REMOVED (regex-only now) — so the fix must NOT reintroduce shell parsing.

### `hooks/actor-state.js` (do not change)
- `deriveListenerState` (`:60-78`) + `isStaleArmedManifest` (`:80-97`) handle stale-armed/dead-PID
  demotion. This is the read-side liveness model and is explicitly OUT OF SCOPE.

### TTY / machine-mode detection
- **No** `isTTY` / `isatty` / `--json` / `--machine` usage anywhere on the arm path today
  (grep clean across the plugin). stdout is always JSON.
- Practical predicate: `stdout && stdout.isTTY !== true` (piped/redirected/spawn-captured stdout
  is non-TTY in Node).

### Existing arm/listener tests (the test-compat constraint)
- `tests/listener-redundant-arm-skip.test.js` is the regression home. Its `spawnListenerSync` /
  `spawnListenerAsync` capture stdout over a **pipe** (non-TTY) and `parseListenerOutput`
  (`:31-34`) **asserts `out.status === 0`** then `JSON.parse(stdout)`. Cases assert arm-skipped:
  - `already-active-listener` (`:75-79`, async contention `:152-158`)
  - `recoverable-pending-takeover` (`:130-133`)
  - `session-mismatch` (`:141-144`)
  Under a naive guard these pipe-based skip cases (esp. the UNSAFE ones that become non-zero)
  would FAIL `parseListenerOutput`'s `status===0` assertion. → they must opt into machine mode.
- `tests/dispatcher-arm-listener.test.js` spawns arm over a pipe and asserts `type==='messages'`
  (a BECAME-listener path) → guard never fires → **unaffected**.
- `tests/listener-stdout-flush.test.js` spawns the legacy `wait-for-message.js` shim, expects a
  `messages` envelope → BECAME-listener → **unaffected**.
- `tools/wait-for-message.js` delegates to `crews.js arm`, so the fix covers the legacy entry too.

## Architect Analysis
- **Seam:** `lib/listener-loop.js` (owns envelopes + the block path + the early arm-skipped exit);
  keep `tools/crews.js` dispatch-only.
- **Classification:** BECAME-listener = messages/timeout/error (silent OK). NO-NEW-listener =
  3 arm-skipped reasons + invalid-args.
- **Predicate:** `noNewListener && !process.stdout.isTTY && !machineMode`. A PTY-wrapping harness
  may report `isTTY` true even when chained — acceptable, because the outcome-gating (only
  immediate no-new-listener returns) is the real safety, not the TTY check.
- **Risk (load-bearing):** the legitimate async background listener (hooks-emitted `mode:async`
  arm) BLOCKS on a fresh arm, so it never reaches the loud immediate-return branch. Confirm the
  guard only routes the arm-skipped + invalid-args paths; do NOT touch deliver/bail/heartbeat
  finish() calls.
- **Release:** version is 3.7.0 in both manifests; CHANGELOG top block is `## 3.7.0`. Multi-remote
  push discipline is in `AGENTS.md`.

## Codex Research (xhigh)
- Agrees on the seam (`lib/listener-loop.js`), helpers (`isStdoutNonInteractive`,
  `isArmMachineJsonEnabled`, `formatArmSkippedAdvisory`), and the `armed.skipped` routing point.
- Suggests an opt-in flag `--machine-json` and/or env `CREWS_ARM_MACHINE_JSON=1`.
- Suggests reason-specific stderr wording (see below).
- **Divergence (noted for review):** codex routes ALL three arm-skipped reasons (including
  `already-active-listener`) to **exit code 1** when redirected, differentiated only by stderr
  wording. This plan instead keeps `already-active-listener` at **exit 0** (a live listener covers
  the caller; preserves the agent's documented anti-arm-loop contract) and reserves non-zero for
  the genuinely-listener-less reasons. See Open Questions Q1.
- Warns: a fake injected `stdout.write` must invoke its callback or `runListenerLoop` hangs.

## Copilot Research
Failed: process crashed (exit 134, V8 fatal native stack trace, empty output). Not retried — the
other three sources fully cover the surface.

## Consolidated File List
### Files to modify (implementation)
- `ai-developer-toolkit/plugins/crews/lib/listener-loop.js` — add machine-mode parse + redirection
  helper + reason-classifying guard; route the arm-skipped `finish` (and clarify invalid-args
  message).
### Files to modify (tests)
- `ai-developer-toolkit/plugins/crews/tests/listener-redundant-arm-skip.test.js` — opt the existing
  skip-assertions into machine mode (the documented opt-in proof) + add fail-loud regression cases.
  (Or a sibling new test file `tests/listener-arm-fail-loud.test.js` for the new cases.)
### Files to modify (release)
- `.claude-plugin/plugin.json`, `.github/plugin/plugin.json` (crews manifests, version)
- `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json` (root indexes)
- `tests/version.test.js` (asserts the literal version)
- `plugins/crews/CHANGELOG.md`, `plugins/crews/AGENTS.md` (new version section)
- Bumped via `node plugins/crews/scripts/bump-version.js <x.y.z>` (do NOT hand-edit the 6 stamps).
### Do NOT touch
- `hooks/actors.js::touchHeartbeat`, `hooks/actor-state.js::deriveListenerState`, mailbox draining,
  listener-epoch semantics, deep shell-command parsing.
