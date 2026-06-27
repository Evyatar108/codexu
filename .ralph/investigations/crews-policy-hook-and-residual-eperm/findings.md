# crews — residual "hook errored" + "Policy hook failed" under 5-member load

READ-ONLY root-cause investigation. Evidence: crews source @ submodule HEAD
`95415379` (crews 3.24.5) + the live `D:/harness-efforts/codexu/.crews/logs/crews.log`
captured 2026-06-27 under a 5-concurrent-member load on the `ralph-pipeline`
crew (**590 member dirs**). All claims cite file:line in
`ai-developer-toolkit/plugins/crews/`.

---

## Bottom-line verdict

**Both observed failures are RUNTIME / PROCESS-LEVEL hook failures (the Copilot
CLI killing or erroring the crews hook *process*), NOT crews fail-CLOSED
decisions on a caught manifest-write EPERM.**

- `(A)` member `skill(...)` → `Denied by preToolUse hook (hook errored)` = the
  Copilot runtime SIGTERM-ing the `copilot-pre-tool-use.js` process at its
  **30s `timeoutSec`** (`.github/plugin/hooks.json:25`), or an uncaught throw at
  module-load / stdin-parse *outside* the hook's try block. Either renders as
  the `(hook errored)` parenthetical.
- `(B)` lead `read_powershell` tool-result → `Tool result blocked: Policy hook
  failed` = the same class on the **postToolUse** surface
  (`copilot-post-tool-use.js`, `timeoutSec: 30` at `.github/plugin/hooks.json:43`):
  the runtime erroring/timing-out the postToolUse hook process. crews' postToolUse
  path **cannot deny a tool result** — it fails open on every caught error — so
  "Policy hook failed" is the runtime's wording for a postToolUse hook that
  errored at the process level, not a crews block.

**Why 3.24.5 did not prevent (A):** 3.24.5's fail-open (and the entire
fail-open family: 3.24.1 LockTimeout, 3.24.2 advisory budget, 3.24.5
transient-rename) operates on throws that `handleInput` *raises and the wrapper
catches*. The residual failures are the hook **process** being killed/erroring
*externally* (timeout) or *before* the try (module-load). There is no crews-side
throw to catch, so no in-process fail-open can convert it to ALLOW. The fail-open
is on the wrong axis for this failure mode.

The `hook-write-budget-exhausted ... EPERM rename` line in crews.log
(`crews.log` @ `20:09:39`) is a **fail-OPEN** event (the advisory turn-observability
write degrading to skip) — it is a *symptom of the same Windows
concurrent-open-handle contention*, not the cause of the denial.

---

## Evidence from crews.log (2026-06-27)

```
20:19:02 pre-tool-use: blocked tool=report_intent name=brainstorm-naming-i1 ... spawnAt=never
20:19:04 pre-tool-use: blocked tool=skill        name=brainstorm-naming-i1 ... spawnAt=never   <- CLEAN arm-first block
20:19:28 pre-tool-use: listener arm allowed       name=brainstorm-naming-i1
20:19:40 manifest-turn-update ... seq=1
20:20:52 pre-tool-use: blocked tool=read_powershell name=brainstorm-naming-i1 spawnAt=20:19:38 exitedAt=never
20:23:26 stop-member (script) name=brainstorm-naming-i1 ... kind=hard     <- lead killed it
...
20:09:39 hook-write-budget-exhausted path=...brainstorm-divergence-i1\manifest.json err=EPERM ... rename  <- FAIL-OPEN
...
20:26:43 pre-tool-use: advisory-budget-exhausted allow arm without stamp name=overview-bookkeeper elapsedMs=6676  <- LEAD hook took 6.7s
```

Two load-bearing observations:

1. **The skill() blocks that crews *logged* are clean deliberate arm-first
   blocks** (`pre-tool-use: blocked tool=skill ... spawnAt=never`,
   `pre-tool-use.js:733`). A clean `block()` writes a decision envelope and
   exits 0 (`pre-tool-use.js:369`), rendering as `Denied by preToolUse hook:
   BLOCKED: you must arm ...` — **not** `(hook errored)`. The `(hook errored)`
   occurrences left **no crews.log line at all**, which is exactly what a hook
   SIGTERM'd mid-execution looks like (crews cannot log its own external kill).
   This is the v3.24.2 "crews.log-invisibility" signature.

2. **A single lead PreToolUse hook took 6.7s of wall-clock** before even
   reaching the arm path (`advisory-budget-exhausted ... elapsedMs=6676`). With
   5 members hammering and a **590-dir** crew roster, an instance crossing the
   30s `timeoutSec` is the direct, observed-trajectory explanation for
   `(hook errored)`.

---

## (A) Why the copilot member `skill()` still gets `(hook errored)`

Trace the copilot member PreToolUse path:

- Wrapper `copilot-pre-tool-use.js` catch (lines 38–78) classifies thrown
  errors and is **fail-open on every error class except `isFailClosedError`**:
  - `LockTimeoutError` → `{}` + `exit 0` (allow) — lines 39–53.
  - `isTransientRenameError(e) && !isFailClosedError(e)` → `{}` + `exit 0`
    (allow) — lines 54–67 (the v3.24.5 branch; **present in the installed copy**,
    verified at `~/.copilot/installed-plugins/.../copilot-pre-tool-use.js:54`).
  - `isFailClosedError(e)` → `decision: 'block'` envelope, `return` (clean exit
    0) — lines 68–73. **This is the ONLY deny path, and it renders as a clean
    `Denied by preToolUse hook: <message>`, NOT `(hook errored)`.**
  - else (any other error incl. a bare non-rename EPERM) → `{}` + `exit 0`
    (allow) — lines 74–77.
- `isFailClosedError` = name ∈ `{TamperedFileError, IdentityMismatchError,
  LockTimeoutError, RecipientNotFoundError, RecipientLeftAtError,
  MailboxFullError, HopLimitError}` (`copilot-shim.js:204-207`). A rename EPERM is
  a generic `Error` (`name === 'Error'`, `code === 'EPERM'`) — **not** in the set.
- `IdentityMismatchError` never escapes `handleInput` — it is caught internally
  and converted to a one-shot `block()`/`return` (`pre-tool-use.js:492-509`). So
  even the one fail-closed name that *could* fire on the member path doesn't
  escape as a throw.

**Conclusion:** No caught throw from `handleInput` can produce the literal
`(hook errored)` parenthetical — every caught error path either exits 0 with a
clean block envelope or exits 0 with `{}`. The runtime's `(hook errored)`
therefore requires a **process-level** failure:

1. **30s runtime timeout (dominant).** `.github/plugin/hooks.json:25`
   `timeoutSec: 30`. The hook is a *fresh `node` process per fire*; under
   sustained 5-member load on Windows the cost stacks:
   - Node cold-start per fire.
   - The **pre-budget lock-free reads** that run BEFORE the v3.24.2 advisory
     wall-clock budget can gate anything: `RuntimeContext.fromHook(data)`
     (`pre-tool-use.js:432`, which resolves state-cwd via pointer/walk-up IO),
     `stateWriteBlockReason` (`:434`), `assertSessionOwnsActor` → `readManifest`
     (`:453`). These are uncovered by the budget — the budget only gates the
     *lock-bearing advisory* ops (crash-sweep, markArmIntent stamp), per the
     v3.24.2 design (`pre-tool-use.js:426-431`, `:528`, `:562`).
   - A single in-flight synchronous `readFileSync`/`openSync` under
     concurrent-open-handle contention **cannot be interrupted** by the
     between-ops wall-clock check (explicit v3.24.2 gotcha).
   - The **590-member** roster inflates every crew-scoped read.
   When the sum crosses 30s the runtime SIGTERMs the process → `(hook errored)`.
   This is the **v3.24.2 failure class, recurring** — 3.24.5 did not touch it.

2. **Uncaught throw outside the try (secondary).** In `copilot-pre-tool-use.js`,
   `process.env.CREWS_ENGINE = 'copilot'` (line 30), `readStdinJson()` (line 31)
   and `copilotToClaudePreToolUseInput(stdin)` (line 32) run **before** the
   `try` at line 36, and the `require(...)` module loads (lines 17–25) run before
   `main()`. A transient EPERM on a `.js` file read during `require` under
   Defender/IO pressure, or a torn stdin payload, throws *uncaught* → non-zero
   exit → `(hook errored)`. No in-process fail-open covers this region.

Neither is a fail-CLOSED manifest-write EPERM inside `handleInput`. **3.24.5's
fail-open is "incomplete" for (A) only in the sense that (A) was never a
caught-EPERM throw** — it is an external timeout / pre-try uncaught throw.

---

## (B) What produces the lead's `Tool result blocked: Policy hook failed`

"Policy hook failed" is the Copilot runtime's wording for a **postToolUse** hook
that errored at the process level (the postToolUse analog of preToolUse's
`(hook errored)`). It is produced by the runtime, **not** by crews:

- crews' postToolUse handler `handleInput` wraps everything in try/catch and
  **always fails open** to `writeEmpty` (`post-tool-use.js:124-132`). It has no
  deny path for a tool *result* except the deliberate v1.6.0 review-required nag
  (`writeBlock`, `post-tool-use.js:121`), which is a clean re-prompt, not a
  "failure".
- The copilot/codex postToolUse **wrappers have NO `isFailClosedError` deny
  branch at all** — `copilot-post-tool-use.js:53-58` and
  `codex-post-tool-use.js:25-29` log + `{}` + `exit 0` on every caught error.
  So crews can never deny a tool result via a caught throw.
- The lead's postToolUse advisory work (the `lastMidTurnNagSeq` nag) goes
  through the **advisory budget** (`post-tool-use.js:61-65`,
  `budgetKind: 'advisory-hook-context'`) and the helper's lead branch
  early-returns for non-member roles — so it is cheap and fail-open. The
  `maybeUpdateTurnObservability` member-only write (`copilot-post-tool-use.js:27-42`)
  is also advisory + try/caught.

Therefore "Policy hook failed" on the lead's `read_powershell` result is the
**same root cause as (A)** on the postToolUse surface: the
`copilot-post-tool-use.js` process timing out (30s, `.github/plugin/hooks.json:43`)
or erroring at module-load under the 5-member load (the lead's PreToolUse hook
was measured at 6.7s the same session). It does **not** share an unguarded
fail-CLOSED manifest-write path — postToolUse has no fail-closed path to share.

---

## (C) Hook-entry-point enumeration: which writes can throw EPERM, fail-OPEN vs fail-CLOSED

Legend: **caught-EPERM** = behavior when a manifest-write EPERM is *thrown and
caught by the wrapper*. **process-level** = behavior when the hook process
itself times out / throws uncaught (the (A)/(B) class — uniformly renders as the
runtime's "(hook errored)"/"Policy hook failed", uncatchable by crews).

| Surface | Manifest writes that can EPERM | caught-EPERM: rename | caught-EPERM: LockTimeout | Unguarded fail-CLOSED-on-contention? |
|---|---|---|---|---|
| **PreToolUse** — `pre-tool-use.js` handleInput + Claude `require.main` (`:761`) + `copilot-pre-tool-use.js` + `codex-pre-tool-use.js` | `markArmIntent` (advisory, fail-open via budget `pre-tool-use.js:570`); inline catch `:586`; crash-sweep is lead-only + fail-soft `:535` | **fail-OPEN** (3.24.5 branch in all 3 wrappers + inline `:586`) | **fail-OPEN** (3.24.1, all 3 wrappers + inline) | **No** — fully guarded |
| **PostToolUse** — `post-tool-use.js` handleInput + `copilot-post-tool-use.js` + `codex-post-tool-use.js` | nag `lastMidTurnNagSeq` (advisory, `:61`); turn-observability (advisory) | **fail-OPEN** (handleInput try/catch `:124` + wrappers `{}`/exit 0) | **fail-OPEN** (same) | **No** — never denies (no fail-closed path), but **no advisory wall-clock budget** like PreToolUse |
| **Stop** — `stop.js` handleInput + Claude `require.main` (`:1623`) + `copilot-stop.js` + `codex-stop.js` | **fail-LOUD protocol-state writes**: `markReviewed`, `consumeMailbox` drain, `appendOutbox`, final lastSeq/review-gate (10-attempt `writeJsonAtomicWithRetry`, then throws) | **fail-OPEN via the `else` branch** (a generic rename `Error` is not in FAIL_CLOSED → `{}`/exit 0); **but the protocol write is silently LOST** | **fail-CLOSED** — `LockTimeoutError` ∈ FAIL_CLOSED (`copilot-stop.js:33`, `codex-stop.js:35`, `stop.js:1618-1627`) → BLOCKS turn-end | **YES** — no 3.24.5 transient-rename branch; LockTimeout denies turn-end on contention |
| **SessionStart** — `session-start.js` + `copilot-session-start.js` + `codex-session-start.js` | heartbeat patch, pointer write, `applyEnvRole`/takeover manifest, `leadsRegistry.upsertLead`, lead crash-sweep | **fail-OPEN via `else`** (generic rename Error → `{}`/exit 0) | **fail-CLOSED** — `LockTimeoutError` ∈ FAIL_CLOSED (`copilot-session-start.js:43`, `codex-session-start.js:43`) → BLOCKS session start | **YES** — no transient-rename branch; LockTimeout denies on contention |
| **UserPromptSubmit** — `user-prompt-submit.js` + `copilot-user-prompt-submit.js` + `codex-user-prompt-submit.js` | `/wake` `markReviewed` (fail-loud) | **fail-OPEN via `else`** | **fail-CLOSED** — `LockTimeoutError` ∈ FAIL_CLOSED (`copilot-user-prompt-submit.js:37`, `codex-user-prompt-submit.js:39`) → blocks the prompt dispatch | **YES** — no transient-rename branch; LockTimeout fail-closed |
| **safe-io shared write** — `safe-io.js` | `writeJsonAtomicWithRetry` is fail-LOUD: after 10 transient-rename retries it **throws** the EPERM (`safe-io.js:144-150`). The advisory wrapper `writeJsonAtomicHookContextAdvisory` (`:177`) catches + returns `{failOpen:true}` | n/a (depends on caller's catch) | n/a | The fail-loud path **rethrows**; only callers wrapped in a fail-open catch absorb it. Stop/SessionStart/UPS protocol writes are NOT so wrapped (see above) |

**Still-unguarded fail-CLOSED-on-contention paths (caught-error axis):**

1. **Stop / SessionStart / UserPromptSubmit wrappers (copilot + codex, and the
   Claude `require.main` of each)** lack the PreToolUse pattern:
   - No `isTransientRenameError` fail-open branch — a rename EPERM that arrives
     wrapped as a fail-closed-named error (e.g. a `TamperedFileError` from a torn
     read after a partially-failed write) would DENY. A bare-`Error` rename EPERM
     fails open via the `else` (benign), **but the protocol-state write is
     silently lost**.
   - `LockTimeoutError` is **kept in `FAIL_CLOSED_ERRORS`** for these surfaces
     (intentional per the v3.24.1 AGENTS.md note), so a transient lock-contention
     timeout on a Stop / SessionStart / UPS manifest-lock op **denies the
     turn-end / session / prompt** under load.
2. **PostToolUse has no advisory wall-clock budget** (the v3.24.2 budget is
   PreToolUse-only). Its writes are advisory/single-attempt so it cannot deny,
   but it has no in-process bound against blowing the 30s `timeoutSec` — which is
   precisely (B).

**Crucial caveat:** none of these caught-error fail-CLOSED paths produce
`(hook errored)` / `Policy hook failed`. Those are the **process-level** column,
uniform across all five surfaces and uncatchable by crews. Closing the
fail-CLOSED gaps above is correct defense-in-depth but will **not** fix the
observed (A)/(B) symptoms.

---

## Fix recommendation (target crews 3.24.6)

### Part 1 — extend the PreToolUse fail-open pattern to all wrappers (closes the genuine fail-CLOSED gaps; defense-in-depth)
- In `copilot-stop.js`, `codex-stop.js`, `copilot-session-start.js`,
  `codex-session-start.js`, `copilot-user-prompt-submit.js`,
  `codex-user-prompt-submit.js`, and the Claude `require.main` of `stop.js`
  (`:1623`), `session-start.js`, `user-prompt-submit.js`: add the v3.24.5
  `isTransientRenameError(e) && !isFailClosedError(e)` fail-open branch **before**
  the `isFailClosedError(e)` deny check (mirroring `copilot-pre-tool-use.js:54-67`),
  with every fail-open `appendLog` try/caught.
- Decide whether `LockTimeoutError` should remain fail-CLOSED on Stop /
  SessionStart / UPS. Under heavy load it denies the turn/session/prompt on
  transient lock contention. Recommend a `LockTimeoutError` fail-open special-case
  on these wrappers too (it is already special-cased fail-open on all three
  PreToolUse shims), OR keep it fail-closed but document the deliberate
  turn-deny-on-contention semantics.
- PostToolUse already fully fails open — no wrapper change needed.

### Part 2 — shared safe-io write path (surgical, do NOT swallow protocol state)
- Do **not** make `writeJsonAtomicWithRetry` silently swallow a rename EPERM —
  that would silently lose Stop outbox/cursor protocol state (the v3.6.2
  silent-loss class). Keep it fail-loud. The right place to degrade a
  best-effort contention EPERM to ALLOW is the **wrapper catch** (Part 1), where
  the decision is "deny vs allow the tool/turn", not the write primitive.

### Part 3 — the actual fix for (A)+(B): stop the 30s process timeout (HIGHEST leverage)
Parts 1–2 will NOT stop `(hook errored)` / `Policy hook failed`. These do:
- **(3a) Guard the wrapper pre-try region.** Move the `require(...)` loads,
  `readStdinJson()`, and `copilotToClaudePreToolUseInput()`/`...PostToolUse...`
  into a fail-open try (write `{}` + exit 0 on throw) so a transient
  module-load/stdin EPERM cannot surface as an uncaught non-zero exit.
- **(3b) Bound the pre-budget wall time.** The v3.24.2 advisory budget starts
  AFTER `RuntimeContext.fromHook` + `assertSessionOwnsActor`. Bound/cache those
  pre-budget reads, and start the wall-clock budget at the very top of the
  wrapper (before requires/reads) so the hook can bail-to-ALLOW well before 30s.
- **(3c) Raise `timeoutSec` 30 → 60** in `.github/plugin/hooks.json` (and the
  Claude `timeout`) as immediate headroom while 3a/3b land.
- **(3d) Operational:** the `ralph-pipeline` roster is **590 member dirs** —
  every crew-scoped read/scan (RuntimeContext, leads-registry, lead crash-sweep)
  pays for all of them. Prune dead-member dirs, verify the `.crews` Defender
  real-time-scan exclusion is active on this box, and cap/stagger concurrent
  member spawns to reduce simultaneous hook-process pressure.

### Confidence
- **High** for the structural verdict (no caught crews throw yields
  `(hook errored)`/`Policy hook failed`; both are process-level), grounded in the
  wrapper catch enumeration above.
- **Moderate-high** for "30s timeout is the dominant trigger" — supported by the
  observed 6.7s lead hook (`elapsedMs=6676`) + 590-dir load + the
  crews.log-invisibility of the `(hook errored)` occurrences; indirect because
  crews cannot log its own runtime SIGTERM. Module-load/stdin uncaught throw is a
  plausible secondary process-level trigger.
