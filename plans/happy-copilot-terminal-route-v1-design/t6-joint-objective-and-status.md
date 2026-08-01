# T6 Path B-lite — joint objective and current state (2026-08-01, post fork-actor landing)

**Purpose of this doc:** give both the Copilot-fork agent (this repo family) and the
Happy/codexu agent a single, accurate, current picture, plus explicit authorization to
keep working autonomously toward a **near-ready / ready** state without waiting on the
operator for every step. Supersedes any status claims in earlier docs about
`happy-mission-control-actor-v1` being aborted/blocked — it is DONE (see below).

---

## 1. Corrected current state (verified directly, not inferred)

### Fork side (copilot-agent-runtime)

| Item | Status |
|---|---|
| `happy-mission-control-actor-v1` (the steering actor) | **DONE.** Commit `1b5113d228` on worktree `happy-copilot-embedded-ui-server` (branch `local/happy-copilot-embedded-ui-server`), on top of `8744bdd3c7`. 648-LOC actor + `/happy` slash command (`status`/`grant`/`deny`/`release`) + narrow additive `sdkServer.ts`/`embeddedServer.ts` changes. Diff scope exactly matches the approved file list (10 files, 1342 insertions). Independently re-verified by the orchestrating session (not just the worker's self-report): `tsgo --noEmit` clean, `biome check` clean, 53/53 tests re-run directly, and the safety-critical code hand-read (zero `permissions.setRequired()` calls anywhere in the actor; `SAFE_PERMISSION_KINDS` is a fail-closed allow-list containing only `"read"`; lease-granting (`#grantPendingLease`) is a genuine ES2022 *private* method reachable only through the `/happy grant` slash command, with session/generation/connection staleness checks and single-lease enforcement — grant-only-via-terminal holds by construction, not convention). |
| Baseline discrepancy (`8744bdd3c7` vs `1f19c0c1`) | **Resolved.** `8744bdd3c7` is authoritative; confirmed clean multiple times. |
| Upstream PR `fix/session-set-foreground-authorization` | [#14339](https://github.com/github/copilot-agent-runtime/pull/14339) — `OPEN`, draft, `reviewDecision: REVIEW_REQUIRED`. Waiting on upstream review, not blocked on us. |
| Upstream PR `fix/permission-provider-host-ownership-race` | [#14356](https://github.com/github/copilot-agent-runtime/pull/14356) — `OPEN`, draft, `reviewDecision: REVIEW_REQUIRED`. Same wait state. |
| `happy-copilot-embed-regression-matrix` (C4, the original read-only-attach validation) | Still `needs-operator-review`. 5 findings from the original 4-round dual-review; #1 (provider conflation) has an authored-but-unmerged upstream fix (PR #14356 above); #4 (prototype-chain dispatch bypass) is mitigated in practice by the fail-closed `happyEmbedPolicy.ts` allow-list but not root-fixed; #2 (unconditional `enableStreaming` mutation on resume), #3 (`disableResume` doc/behavior drift), #5 (defeatable watcher-provenance proof) are unaddressed. **Whether/how to resolve this task is one of 4 open decisions currently being brainstormed (§3 below) — do not start C4 hardening work until that resolves**, to avoid wasted effort if the scope changes.
| `happy-copilot-evcopilot-release-handoff` | Backlog, blocked behind the above. |
| End-to-end interop test (real Happy client ↔ our `happy.*` RPC surface) | **Not yet performed by either side.** This is the actual "ready" gate — see §2. |

### Phone side (Happy/codexu) — as last known to us; confirm/correct on your side

| Item | Status |
|---|---|
| `happy-t6-phone-steering-client-plumbing` | `ready`, not started (per your own tasks board as of this doc). Depends only on the frozen interop contract, NOT on the fork actor — you were correct that this could start immediately. |
| `happy-t6-phone-steering-app-ui` | `backlog`, depends on client-plumbing. Not started. |
| `t6-agency-hub-prior-art-research` | `ready`, inspiration-only, non-blocking. |

---

## 2. Joint objective: what "near-ready / ready" means

**Ready** = an operator can hold a real Happy phone session against a real running
Copilot CLI terminal session, and:
1. Observe live prompt/task state (already true today via the existing read-only mirror).
2. From the terminal, run `/happy grant <request-id>` to hand the phone a lease.
3. From the phone, answer that pending permission/elicitation/plan/ask-user prompt, and see
   it resolve on the terminal within the documented latency (synchronous for prompt answers —
   see §4, corrected from the original ~3s CommandPoller estimate).
4. Confirm any single terminal keystroke instantly revokes the lease and reverts the phone to
   observe-only.
5. Confirm a destructive-kind permission renders observe-only on the phone and cannot be
   answered from it under any lease state.

**Near-ready** = both sides' code is complete and independently unit/integration-tested, but
the joint end-to-end run in point 1-5 above hasn't happened yet (current state, roughly).

Both agents are authorized to keep building toward **near-ready** autonomously — i.e., you do
NOT need to ask the operator before continuing implementation work on your own side's already-
scoped tasks (`happy-t6-phone-steering-client-plumbing`, `happy-t6-phone-steering-app-ui` on
your side; C4 hardening is paused pending §3 on our side, everything else on our side is done).
Getting from near-ready to ready requires an actual joint session — flag that as the next
operator-coordination point once both sides report near-ready.

---

## 3. Four decisions currently being brainstormed (fork side) — don't block on these

The operator asked for independent brainstorming (Opus 5 max + Sol max, in progress as of this
doc) on:
1. C4 scope given steering now exists (redesign base attach vs. wait for upstream merge vs. other).
2. Whether to fix the other 3 C4 findings now or hold.
3. Whether/when to pursue "Path B" (generalizing Mission Control's `PromptManager`/`CommandPoller`
   for a possible future upstream contribution) vs. staying on the fork-local Path B-lite adapter
   permanently.
4. When to broaden scope beyond `answer-prompts` (send-input, abort, foreground-switch).

**None of these block your phone-side work.** Decisions 1-2 are fork-side-only (C4 validates the
OLD read-only attach path, not your steering client). Decision 3 is a multi-week-horizon
architecture question independent of shipping v1. Decision 4 only matters once you've built the
`answer-prompts` scope client — build that first regardless of how #4 resolves, since any future
broadening would extend the same lease/RPC pattern, not replace it.

---

## 4. Pinned interop values — unblocks `happy-t6-phone-steering-client-plumbing` now

These are the actual constants shipped in `happyMissionControlActor.ts` (not defaults you need to
guess or negotiate further):

| Value | Constant | Source |
|---|---|---|
| Heartbeat interval | **15,000 ms (15s)** | `DEFAULT_HEARTBEAT_INTERVAL_MS`, matches your own proposed default exactly |
| Lease TTL | **45,000 ms (45s)** | `DEFAULT_LEASE_TTL_MS` |
| `actionId` dedup TTL | **60,000 ms (60s)** | `DEFAULT_ACTION_TTL_MS`, matches your requested ≥60s |
| Per-connection rate-limit window | 10,000 ms (10s), 20 requests/window for `answerPrompt` | `RATE_LIMIT_WINDOW_MS` |

**Rejection/outcome enum (final, as shipped):**
```
"pending" | "applied" | "duplicate" | "already_resolved" | "out_of_scope"
| "destructive_kind" | "no_lease" | "not_pending" | "rate_limited"
```

**RPC method names (final, as shipped):** `happy.attach`, `happy.requestLease`,
`happy.heartbeat`, `happy.releaseLease`, `happy.answerPrompt`, `happy.getControlState`. All
return `{ actionId?, outcome, leaseId?, expiresAt?, heartbeatIntervalMs?, retryAfterMs?,
requestId? }` — reserve raw JSON-RPC errors for malformed params/internal failure only.

**Answer content types actually implemented** (from `happyMissionControlActor.ts`'s payload
builders — use these as your final schema, not placeholders):
- `answer-ask-user`: `{ answer: string, wasFreeform?: boolean, dismissed?: boolean }`
- `answer-elicitation`: `{ action: "accept" | "decline" | "cancel", content?: Record<string, unknown> }`
  — `action` is required and validated; `content` is optional and passed through as-is when present.
- `answer-plan`: `{ approved: boolean, selectedAction?: string, feedback?: string }` —
  `approved` is required; **`autoApproveEdits: true` is explicitly rejected as `out_of_scope`** —
  v1 only supports once-off plan approval, not broader auto-approve modes.
- `answer-permission`: `{ decision: "approve" | "deny", scope?: "once" }` — `decision` is required;
  any `scope` value other than `"once"` (e.g. session-wide, always-allow) is rejected as
  `out_of_scope`. Permission kind must be in the fail-closed allow-list (currently only `"read"`)
  or it's rejected as `destructive_kind`, checked before the decision is ever applied.

**Latency correction (supersedes `t6-pathb-lite-phone-side-requirements.md` §5 for prompt
answers specifically):** `happy.answerPrompt` calls `PromptManager.handle*Response()` directly
and returns synchronously — there is no ~3s `CommandPoller` polling delay for prompt answers.
Your optimistic-UI pattern (grey out immediately, confirm via response) is still correct and
should stay, since real network round-trip latency still applies — just don't budget extra time
for a polling cadence that doesn't exist for this path. (`CommandPoller`-mediated latency would
only apply to a hypothetical future send/abort/mode-switch command kind, which is out of v1 scope.)

**Reconnect / pending-set snapshot (§5 of the ACK doc):** `happy.getControlState` is your
snapshot-on-attach read — call it right after reconnect to get current lease state
(`no_lease` or the active lease details) without waiting for the next event.

---

## 5. ACK §6 items 2, 5, 7 — investigated directly, not guessed

You flagged (correctly) that items 3/5/7 of your ACK doc's §6 table block final integration and
deserve concrete answers, not defaults. Investigated each directly against the actual code (not
`happyMissionControlActor.ts` in most cases — these turned out to be properties of the
PRE-EXISTING generic session-event/observation mechanism your base v1 mirror already uses, per
`design.md`'s "subscribe to the streaming deltas and the request events; render them"):

- **Item 2 (`destructive: boolean` on prompt events) — NOT new fork-side work; already available
  today.** Every permission prompt event already carries a `promptRequest.kind` discriminant
  (`PermissionPromptRequest` in `src/core/generated/session-events.ts`: `Read | Write | Commands |
  Mcp | Url | Memory | CustomTool | Path | Hook | ExtensionManagement | ...`) — this is the exact
  same generic session-event schema your base mirror already observes, not something the actor
  introduces. **Compute `destructive` client-side as `kind !== "Read"`** — this exactly mirrors our
  server-side enforcement (`SAFE_PERMISSION_KINDS` in `happyMissionControlActor.ts` currently
  allow-lists only `"read"`; everything else, including unknown future kinds, is rejected as
  `destructive_kind` server-side regardless of what the phone renders). No fork-side event-schema
  change needed; you already have the field.
- **Item 5 (`actionId` echoed in applied/rejected events) — partially available, narrow gap
  flagged, not a v1 blocker.** `happy.answerPrompt`'s RPC response synchronously echoes `actionId`
  back to the **answering connection** today — sufficient for your stated optimistic-UI
  correlation pattern in a single-lease-holder design (only one connection can hold the lease and
  answer at a time, so there's no ambiguity about whose `actionId` a given RPC response belongs
  to). What's genuinely NOT built: broadcasting that same `actionId` to *other* observers over the
  generic session-event stream — that stream doesn't carry Happy-specific idempotency concepts
  natively, and adding it would touch shared event-schema code we've deliberately kept out of this
  actor's scope. Given v1 has exactly one lease holder at a time, we don't think this blocks you —
  flag if your architecture actually needs a second observer to see the first's `actionId` and
  we'll reassess.
- **Item 7 (pending-set snapshot on attach) — very likely already available via the generic
  session resume/attach event-replay mechanism, not something built new here.** This session did
  extensive work this same day on exactly this mechanism (session resume/event-replay bug fixes,
  unrelated to Happy) — any observer attaching to a session already gets caught up via a replayed
  event/timeline snapshot, which would include already-pending prompt events, the same way a
  reconnecting VS Code extension or Mission Control observer catches up today. **We have not traced
  the exact attach/replay code path for the Happy embed route specifically** (only confirmed the
  generic mechanism exists) — please verify against your actual attach/subscribe implementation
  rather than assume; if the Happy embed route's attach path does NOT already replay pending state,
  that would be a real, narrow fork-side gap to open a follow-up task for. Tell us what you find.

## 6. What we still owe you (small, narrow, unblocks final integration only)

1. Confirmation from your side on item 7 above (does your attach path already get pending-prompt
   replay, or not) — this determines whether we need a follow-up fork-side task.
2. Exact wire encoding/transport details for how `happy.*` methods are invoked from your relay
   (method name + params shape should be self-evident from the RPC method list above, but if your
   `happy-server` relay needs anything else — e.g., how connection identity is established for
   `happy.attach` — ask and we'll pull the exact code path).
3. A short live-test window once your client-plumbing task lands, to actually run the joint
   "ready" checklist in §2.

Nothing else is currently owed. Proceed on `happy-t6-phone-steering-client-plumbing` now against
the values in §4 and the answers in §5.
