# T6 — independent architecture brainstorm (Claude Opus, 2026-08-01)

**Status:** Independent read-only investigation and recommendation. Nothing was
written, built, committed, or pushed in either repo. This document is a scratch
deliverable for the orchestrating session to accept, reject, or fold in.

**What I read:** `design.md`, `t6-remote-steering-design.md`,
`t6-pathb-lite-handoff.md`, `t6-pathb-lite-implementation-gap-report.md`,
`t6-pathb-lite-inbound-answer.md`, `t6-pathb-lite-phone-side-requirements.md`,
`t6-pathb-lite-phone-side-ack.md`, `t6-pathb-lite-baseline-confirmed.md`, the
full `happy-copilot-embed-regression-matrix` and `happy-mission-control-actor-v1`
records in `.tasks-board/data.json`, and then the actual code:
`happyMissionControlActor.ts` (648 LOC), `happyCommand.ts`, `happyEmbedPolicy.ts`,
`embeddedServer.ts`, `sdkServer.ts`, `promptManager.ts`, `sessionContracts.ts`,
`serverSeamHandlers.ts`, `engine.rs`, plus `app.tsx`/`index.ts` call sites, the
two upstream PR worktrees (`permission-provider-host-race` @ `7c9c96327a`,
`foreground-authz` @ `2d99083e5f`/`2273fab2c0`), and the shipped phone client
(`codexu: packages/happy-cli/src/agent/copilot/nativeLocalRpcClient.ts`,
`types.ts`).

**Code baselines:** Happy fork worktree `happy-copilot-embedded-ui-server` @
`1b5113d228` (clean). Upstream `origin/main` @ `cde60824c9` (2026-08-01 05:16Z);
`answerPromptEvents` is **not** on `origin/main`, i.e. PR #14356 is unmerged, and
`origin/main` is 42 commits ahead of that PR's base — roughly a day's drift.

---

## TL;DR — the four recommendations

| # | Decision | Recommendation | One-line reason |
|---|---|---|---|
| 1 | C4 scope given steering exists | **(c) Neither (a) nor (b): delete `observePromptEvents` from the base attach shape (≈5 lines), reconcile the policy with the real client, and re-scope C4 from wire-shape assertions to session-state-diff assertions** | `observePromptEvents` buys the mirror *nothing* on a TUI-foreground session and costs it the clobber bug; and "leave the base attach as-is" is not actually available — the landed policy and the shipped client are already mutually incompatible |
| 2 | The other open C4 findings | **Fix streaming NOW (fork-local + a separate small upstream PR); fix the `disableResume` comment NOW; retire the watcher-provenance AST proof rather than harden it; and note that finding #4 is _not_ fixed** | Streaming is the only *proven user-visible* mutation and our own allow-list guarantees it fires on every attach |
| 3 | Path B (upstream generalization) | **Drop it. Do not open the alignment conversation.** Replace with two narrow asks: let #14356 ride, and pursue `answeredBy` attribution | `PromptManager` is already transport-neutral and consumed unmodified; `CommandPoller` — the only Mission-Control-shaped part — was deliberately removed from the design before implementation |
| 4 | Broadening beyond `answer-prompts` | **Not yet — and the next increment is not broadening, it is making `answer-prompts` actually work.** As landed it can answer ~zero real prompts, while already permitting arbitrary text injection | Two independent end-to-end blockers plus a porous scope boundary; five concrete traps below |

---

## 0. Findings that are not in any existing doc

These drive the recommendations, so they come first. All were verified directly
against the code, not inferred.

### F1. The landed read-only enforcement and the shipped phone client cannot talk to each other

`classifyHappyConnect` requires the `connect` params to be **exactly one key,
`token`** (`happyEmbedPolicy.ts:55-63`, `entries.length !== 1` at `:57`). The
shipped client sends four keys — `{token, protocolVersion, client, capabilities}`
(`nativeLocalRpcClient.ts:135-140`). `connect` **is** gated: `engine.rs:1059-1072`
runs `authorize_inbound_call` before routing and, on rejection for `connect`,
calls `clear_authentication`. So the handshake is rejected with
`REQUEST_NOT_PERMITTED` and the connection is de-authenticated.

Independently, `classifyHappyResume` *requires* `disableResume`,
`observePromptEvents` and `requestPermission` to be present
(`happyEmbedPolicy.ts:112`), while the shipped client sends only
`{disableResume: true, sessionId}` (`nativeLocalRpcClient.ts:168`, sessionId
injected at `:211-219`). And `runtime.shutdown` — which the client calls
(`:190-192`) — is not on the allow-list at all.

⇒ **The read-only v1 route is currently broken end-to-end in three places.** The
C4 matrix did not catch this because it validates `classifyHappyCall` against
hand-written param objects, never against the actual client's call sites. This is
the single highest-value missing test in the whole matrix.

### F2. `observePromptEvents` buys the Happy mirror nothing, on this route, today

Three independent reasons:

1. **Forwarding does not need it.** `sdkServer.ts:5543-5549`: permission events are
   filtered only for *extension* connections — "Non-extension connections (e.g.
   the CLI app) always receive the event." Happy is a non-extension seam
   connection.
2. **Event raising does not need it.** All the flag does beyond provider
   registration is install six typed no-op listeners (`sdkServer.ts:4704-4734`) so
   that `hasEventListeners(...)` flips and the per-turn agent config wires the
   synthetic prompt callbacks. On a TUI-foreground session the TUI has already
   registered real listeners for every one of those six:
   `app.tsx:3094` (permission), `:5702` (user_input), `:5815` (elicitation),
   `:6140` (exit_plan_mode), `hooks/useAutoModeSwitchDialog.ts:68`,
   `hooks/useSessionLimitsExhaustedDialog.ts:36`.
3. **The client does not even use the live stream.** It mirrors by polling
   `session.eventLog.read` (`nativeLocalRpcClient.ts:171-190`), not by subscribing
   to `session.event`.

The flag matters for the *`LocalRpcSession` thin-client controller* case, where the
target is a managed headless child with no local UI and nothing else would enable
prompts. That is not our case. On our route it is **pure liability**: it is what
registers Happy as a permission+elicitation provider
(`sdkServer.ts:4284-4285` → `:4488`) and what makes disconnect call
`updatePermissionCallbackProvider(..., false, ...)` (`:6126`) and clobber the
TUI's `setRequired(true)` (`app.tsx:3092`).

### F3. Every Happy attach silently turns off streaming in the terminal — and our own policy guarantees it

`sdkServer.ts:3711` runs `session.updateOptions({enableStreaming: params.streaming ?? false, ...})`
unconditionally on resume for resident sessions, **235 lines before** the
`disableResume` gate at `:3946`. The interactive CLI creates sessions with
`enableStreaming: cliStreaming ?? config.stream ?? true` (`index.ts:3223`,
`app.tsx:8065`, `:14952`, `:14991`, `:20316`) — i.e. **true by default**. The
shipped client sends no `streaming` param, and `classifyHappyResume`'s allow-list
**forbids** it (any unlisted key is denied, `happyEmbedPolicy.ts:99-102`), so the
client cannot even opt out.

`enableStreaming` is not cosmetic: it feeds the per-turn agent config
(`session.ts:24086`), the tool config (`:22048`), and the subagent config
(`:22170`).

⇒ Attaching the phone degrades the human's terminal from token-by-token streaming
to non-streaming, on the next turn, with no notice. C4 finding #2 was recorded as
"HIGH, Sol-only"; it is in fact the **only proven user-visible mutation** in the
whole set, and the read-only policy as landed makes it unavoidable.

(`sdkServer.ts:3874` `setShellNotifier(this.createShellNotificationSender())` is a
second unconditional resume side effect on the same path. I did not chase its
user-visible impact.)

### F4. C4 finding #4 (bespoke registry prototype chain) is only half-fixed

`serverSeamHandlers.ts:171` is now `Object.freeze({ ...(deps.bespoke ?? {}) })`.
That fixes the *mutation-after-install* half. It does **not** remove
`Object.prototype` from the chain, and `:223` still does an unguarded
`installedBespoke[payload.method]` lookup with no own-property check. Verified in
node against the exact shape:

```
node -e "const f=Object.freeze({'happy.attach':()=>1}); ..."
ctor: function true      // f['constructor'] is truthy
hasOwn ctor: false
call result: {"a":1}     // Object(params, conn, token) → params, handled: true
```

`engine.rs:1087-1094` routes any unrouted method name to the bespoke seam, so
`constructor`/`toString`/`valueOf` dispatch "successfully" and
`describeInboundRpcSurface` (`serverSeamHandlers.ts:194`, `Object.keys`) does not
report them. The claim "introspection cannot lie about what is callable" is still
false. `sdkServer.ts:4051-4062`'s new `seamExtension` spread produces the same
plain-prototype object, so the actor's methods inherit the same registry.

The Happy listener is *incidentally* protected (`authorizeHappyInboundCall` denies
any name not in `HAPPY_MISSION_CONTROL_METHOD_SET` or `classifyHappyCall`), but
ordinary `--ui-server`/extension seam connections are not gated at all
(`engine.rs:895-909`).

### F5. The shipped steering can answer approximately zero real permission prompts

`SAFE_PERMISSION_KINDS = new Set(["read"])` (`happyMissionControlActor.ts:106`) is
the fail-closed allowlist; every other kind returns `destructive_kind` (`:370`).

But **`kind: "read"` permission prompts structurally cannot be pending in a
CLI-style session**. `approveAllReadPermissionRequests: true` is set
unconditionally at every entry point — `app.tsx:7060` and `:19782`,
`promptMode.ts:1629`, `acp/server.ts:1235` and `:1357`, and
`sdkServer.ts:7648` for managed-server sessions. `sdkServer.ts:7605-7612` states
it outright: *"File reads are treated as inherently safe; surfacing a
`kind: "read"` permission prompt to a controller's UI is unsupported and crashes
the Ink render"*, and `components/permissionRequest.tsx:670-675` repeats it.

Acceptance criterion 2 ("phone can approve/deny a tool permission") was validated
against a mock that manufactures exactly that impossible shape:
`test/cli/happyMissionControlActor.test.ts:37` `createSession(permissionKind = "read")`,
used at `:166`. The unit test is correct about the allowlist; it proves nothing
about the product.

### F6. The phone cannot see a pending prompt either

The client requests `types: [...COPILOT_PROJECTED_EVENT_TYPES]` from
`session.eventLog.read` (`nativeLocalRpcClient.ts:174`), and that list
(`packages/happy-cli/src/agent/copilot/types.ts:11-22`) contains **no `*.requested`
event types at all** — only ten final kinds. `session.info` (the actor's lease
notifications) is not in it either.

⇒ F5 and F6 are two *independent* blockers between the landed actor and a phone
that can approve anything. Either alone makes the feature a no-op. F6 is already
tracked as codexu work (T6 §7.1.4 / `happy-t6-phone-steering-client-plumbing`); F5
is not tracked anywhere.

### F7. The `destructive: boolean` flag the phone side was promised does not exist

`t6-pathb-lite-phone-side-requirements.md` §3 and the ack §3 both settle on "put
it on the prompt event as `destructive: boolean`". The landed actor has **no event
publisher at all** — `emitInfo` (`happyMissionControlActor.ts:635`) emits only
`session.info` lease messages. The handoff doc's §3 implementation shape listed "a
Happy event publisher" as the first component; it was dropped and the interop
contract was never renegotiated. The phone will render approve/deny on everything
and get `destructive_kind` back on essentially everything (see F5).

---

## Decision 1 — C4 regression-matrix scope, given steering now exists

### Recommendation: option (c). Make the base attach shape honest, then re-scope C4 from wire-shape assertions to state-diff assertions.

I disagree with how both (a) and (b) are priced.

**Why (a) is mispriced (too expensive in the framing, right in spirit).** "Redesign
the base attach to avoid SDK-provider registration entirely — more robust, more
work now" implies a redesign. It is a **deletion**. Given F2, the mirror does not
need `observePromptEvents`; it needs to stop sending it. The change is:

- `happyEmbedPolicy.ts:143` — drop `observePromptEvents` from
  `happyAttachResumeParams`;
- `happyEmbedPolicy.ts:88` — remove the allow-list entry, so a resume carrying the
  flag is denied by the existing fail-closed rule at `:99-102`;
- `happyEmbedPolicy.ts:112` — drop it from the required set.

Three lines of policy plus test updates. There is no mechanism to mirror from the
steering actor, because the steering actor's advantage here is precisely that it
*does nothing* on attach.

**Why (b) is not actually available.** "Leave the base attach as-is and wait for
#14356" assumes the current shape survives the rebase. It does not:

- After #14356, `observePromptEvents` registers no providers, no capabilities and
  **no typed listeners** (`initializeSession` comment in the PR: "observePromptEvents
  is intentionally not consumed here"), and the listener block is re-gated on the
  new `answerPromptEvents`. Our policy file *requires* a now-inert flag, so
  `happyEmbedPolicy.ts` must be touched on rebase regardless.
- The obvious "fix the rebase" move — add `answerPromptEvents: true` — reintroduces
  the exact clobber under the new name. That is a real trap for whoever does the
  rebase without this context.
- Timing is not under our control: #14356 is a 24-file Rust+TS ownership refactor
  (268 lines in `sdkServer.ts` alone) from a non-core contributor, and `origin/main`
  moved 42 commits between its base and now. AGENTS.md rule 14 also says not to
  hold an agent polling it.
- And (b) addresses none of F1, F3, F4, F5.

**Concrete plan.**

1. **Unbreak the route (F1).** Reconcile `classifyHappyConnect` with the real
   handshake — allow the four known keys with per-key value checks rather than
   `entries.length !== 1` — or change the client; but do one of them, and add a
   contract test that feeds the *actual* client's param literals through
   `classifyHappyCall`. Decide `runtime.shutdown` deliberately: T6 §7.1.2 says a
   phone crash must never kill the terminal, so denying it is arguably correct —
   but then the client's `shutdown()` path needs to change, not silently fail.
2. **Delete `observePromptEvents` from the contract (F2).** This kills C4 finding
   #1 *for Happy* today, with no upstream dependency, and is forward-compatible
   with #14356 landing or not landing.
3. **Correct the doc that started this**: `copilot-happy-embedded-ui-server-handoff.md:221`
   ("Resume uses `observePromptEvents: true` and `requestPermission: false`") is
   the origin of the whole problem. T6 §1 said "the doc needs correcting"; I'd go
   further — the flag should be removed from the contract, not documented more
   accurately.
4. **Re-scope the C4 acceptance itself.** Every finding that survived four
   dual-reviewer rounds is a **session-state mutation the matrix never measured**,
   because the matrix asserts on the *wire shape* of permitted calls. Replace
   "prove the attach parameters are read-only" with "prove the attach is
   state-neutral": snapshot and diff, before attach / after attach / after
   disconnect:
   - `session.permissionEventsEnabled`
   - `nativeRuntime.sessionScalarEnableStreaming(...)`
   - the session capability set (`elicitation`, `mcp-apps`, `canvas-renderer`)
   - the shell-notifier binding
   - the pending-request set
   That single reframing catches findings 1, 2 and 3 mechanically, would have
   caught F3 and F5, and is *cheaper* than the AST proof it replaces.

**Also correct the blocker's framing.** It calls this "the blessed read-only attach
shape". It is blessed by *our* handoff doc and *our* policy file — not by
upstream. We can unbless it unilaterally, which is exactly what makes option (c)
cheap.

---

## Decision 2 — the other open C4 findings

### 2a. Unconditional `enableStreaming` mutation — **fix now**, highest priority of the three

This is the one where "hold" is clearly wrong: it is proven, user-visible, fires on
every attach, and our own allow-list guarantees it (F3).

- **Fork-local, immediately:** either allow `streaming` in the resume allow-list
  pinned to the session's current value, or carry the upstream fix locally.
- **Upstream, as its own small PR — not folded into #14356:** gate the mutation,
  e.g. `...(params.streaming !== undefined ? { enableStreaming: params.streaming } : {})`,
  or at minimum skip it when `params.disableResume` is set. It is independently
  mergeable, trivially reviewable, and hits every reconnecting SDK client (VS Code
  extension, Agents-tab controller), not just Happy. #14356 is already large;
  bundling a second behavior change into it lowers both PRs' odds.
- **Anticipate the review objection:** some SDK caller may rely on resume resetting
  streaming to `false`. The `disableResume`-gated variant is the conservative
  framing and I'd lead with it.

### 2b. `disableResume` doc/behavior drift — **fix now** (it got worse, not stale)

The overclaim has been *copied into a new production file*: `happyEmbedPolicy.ts:81-83`
says `disableResume` means "Reconnect without emitting a second session.resume
event **or triggering resume-related side effects in the terminal-owned session**"
— and there it functions as the load-bearing justification for the allow-list.
Meanwhile `disableResume` gates exactly one thing: the resume event emission
(`sdkServer.ts:3946`). Streaming (`:3711`), shell-notifier rebinding (`:3874`),
`activeSessions` rebinding, and provider registration all run regardless.

Fix: state precisely what it suppresses and enumerate what it does not, in the same
commit as Decision 1. Minutes of work. Do **not** attempt to make `disableResume`
actually suppress everything — that is a shared-contract change needing alignment,
and 2a's targeted fix is the better lever.

### 2c. Defeatable watcher-provenance proof — **hold, and I recommend retiring it**

An AST walk that tries to prove "this call site reads this data source" is
defeatable by construction; each hardening round buys exactly one more rename.
Two rounds × two reviewers already failed to converge on it, and the blocker's own
prescription ("bind to the real property name") is a mitigation, not a proof.

- Replace with a **behavioral** assertion: construct the server across the flag
  matrix and assert the watcher is/isn't constructed and what it observes.
- Revisit the provenance question only if the watcher-construction path becomes
  reachable in a shipping configuration (Agents tab default-on, or a non-test
  caller appears). That is the trigger.

### 2d. Finding #4 is not fixed — **fix now, it is one line**

Per F4. `Object.freeze(Object.assign(Object.create(null), extension, core))`, or an
`Object.hasOwn(installedBespoke, payload.method)` guard at
`serverSeamHandlers.ts:223`. It is smaller than the paragraph describing it, and it
should be corrected on the task record, which currently implies it is closed.

**Priority within Decision 2:** 2a (streaming) > 2d (one line) > 2b (comment) >
2c (retire).

---

## Decision 3 — Path B: generalize `PromptManager`/`CommandPoller` upstream?

### Recommendation: **no.** Drop it as a goal and do not open the alignment conversation. Substitute two much smaller upstream asks.

I explicitly disagree with `t6-remote-steering-design.md` §4's "start Path A,
pursue Path B alignment in parallel." Path B no longer has content:

1. **The generalization already exists upstream.** `PromptManager`'s constructor
   takes `RemoteExportSession` — a plain interface (`sessionContracts.ts:217-245`)
   with no URLs, tokens or clients — and its response paths route through
   `session.promptFallback` (`RemotePromptFallback`, `:201-215`). The fork imports
   it and calls four public methods with **zero modification**
   (`happyMissionControlActor.ts:13`, `:349-380`). There is nothing to decouple for
   the `answer-prompts` scope.
2. **The only Mission-Control-shaped component was deliberately removed.**
   `t6-pathb-lite-inbound-answer.md` correctly found that `CommandPoller` discards
   all four `PromptManager` return values (`commandPoller.ts:211-235`) and acks
   unconditionally (`:190-207`), so answers go direct. The landed actor never
   imports `CommandPoller`. So "Path B-lite" is a misnomer for what shipped —
   it is "use `PromptManager` as a library" — and Path B would mean generalizing
   the one component we chose not to use.
3. **The divergence cost that justified Path B is not being paid.** Fork delta on
   shared upstream-owned files, measured against the merge base: `sdkServer.ts` +50,
   `serverSeamHandlers.ts` +13, `slashCommands.ts` +2, `slashCommandNames.ts` +1.
   The 3,062-line total is overwhelmingly new fork-owned files. The "second parallel
   remote-control system" concern both original investigations raised is a
   **product/UX** cost ("why does my phone behave differently from the web UI?") —
   and upstreaming plumbing does not pay it down; consistent *semantics* do, which
   the fork already gets for free by calling the same `PromptManager`.
4. **The ask is the wrong shape for a non-core contributor.** AGENTS.md 4a puts
   refactor/architecture of shared code behind documented pre-coding team
   agreement. An extensibility hook (`seamExtension`) with no upstream consumer is
   close to the least persuasive possible request.

**What to pursue upstream instead:**

- **#14356** — already filed; let it ride without depending on it. It is the real
  Path-B-equivalent win because it makes `observePromptEvents` a genuine observation
  primitive for every client, not just ours.
- **`answeredBy` attribution** on the four completion event shapes (T6 §5.2.3,
  `generated/session-events.ts:3095-3102`). Small, additive, and *generically*
  useful — Mission Control has the same "a dialog silently vanished" problem today
  (`app.tsx:5879-5930` says "Resolved by another client" with no identity). If you
  want exactly one alignment conversation, make it this one; it is far easier to
  win than "let us refactor your remote-control plumbing," and it is the piece that
  turns remote answering from autonomous-looking into legible.
- **The streaming fix** from 2a.

**Trigger to revisit Path B:** only if (i) upstream independently begins extracting
a transport-neutral steering broker, **or** (ii) scope broadening actually forces us
onto `CommandPoller` *and* the queue semantics need shared-file changes. Not before.

**Interaction worth noting:** taking Decision 1(c) drops our dependency on #14356 to
zero. That is strategically valuable on its own — it converts our only upstream
*dependency* into a pure *contribution*, which is the correct posture here.

---

## Decision 4 — broadening beyond `answer-prompts`

### Recommendation: not yet — and broadening is the wrong next increment. The next increment is making `answer-prompts` actually work and actually bounded.

The lease state machine is genuinely well built (single-holder, generation-bound,
`#grantPendingLease` is a true ES2022 private method so `/happy grant` really is
the only grant path by construction). The traps are not in the state machine.

**Trap A — the feature is a no-op in practice (fatal; F5 + F6).** `read` is the one
permission kind that can never be pending. Combined with the phone's projection
carrying no `*.requested` events at all, there are two independent end-to-end
blockers. Fixing A is a **policy** decision the operator must make; my
recommendation is the asymmetric one, which I have not seen considered anywhere in
the docs:

> **Let the phone `deny` any kind, and `approve` nothing (or only an explicit
> narrow set).** Denial is always the safe direction; approval is the dangerous
> one. That is a coherent, defensible, genuinely useful v1.1 posture ("I'm on the
> bus, that `rm -rf` is wrong, kill it"), it satisfies the "phone is a materially
> worse decision environment" concern in T6 §6 without making the feature useless,
> and it needs no new mechanism — just splitting the allowlist by decision rather
> than by kind at `happyMissionControlActor.ts:370`.

**Trap B — the `answer-prompts` boundary is porous; "no send-input in v1" is not
true.** `type: "answer-ask-user"` passes `content.answer` (any string) and
`wasFreeform` straight through to `PromptManager.handleAskUserResponse`
(`happyMissionControlActor.ts:349`, `:391-401`; `promptManager.ts:214-238` →
`fallback.respondToUserInput`). That text enters the running turn as the model's
requested input. Functionally that **is** send-input, scoped to "while an ask_user
prompt is open." Similarly `answer-plan` authorizes execution of a plan with only
an `autoApproveEdits` guard (`:356-358`). Neither is destructive-classified.
Either split these into their own scopes now, or document explicitly that
`answer-prompts` includes bounded text injection and plan authorization — but do
not keep telling the phone team that send-input is deferred.

**Trap C — grant/revoke ergonomics make the lease near-unusable.**
`terminal.on("key")` / `on("paste")` → `revokeLease("keystroke")`
(`happyMissionControlActor.ts:166`, `:190-191`), and `Terminal` emits `key` for
every parsed key (`terminal/terminal.ts:1071-1072`). TTL is 45 s with a 15 s
heartbeat (`:102-103`). The grant ceremony is: phone requests → a `session.info`
line appears with a **UUID** → the human types `/happy grant <uuid>`
(`:284-286`, `happyCommand.ts:60-70`). Typing a UUID costs more keystrokes than
answering the prompt would have. Before broadening: short ordinal request ids, and
a policy where typing does not instantly revoke unless the human actually engages
the prompt themselves. (Verified positive: the terminal really is the process-wide
singleton the TUI reads from — `TerminalContextProvider.ts:42` returns
`getLifecycleTerminal()` whenever stdin is `process.stdin` — so revocation does
fire in production. It would silently *not* fire under a mocked-stdin mount.)

**Trap D — v1's safety does not transfer to send/abort/foreground.** Everything
that makes prompt answering safe comes from the native first-wins tombstone reached
via `RemotePromptFallback`. `session.send()`/`session.abort()` have no equivalent.
The actor's own idempotency is a 60 s in-memory `(sessionId, actionId)` map
(`:156`, `:614-631`) that is **never cleared on detach or dispose** —
`detachSession()` (`:213-220`) clears attachments, connections and pending lease
requests but not `seenActions` or `rateLimits`, and entries prune only lazily on a
same-session lookup. That is fine as a nicety layered on a tombstone; it is *not*
adequate as the primary exactly-once guarantee for phone-originated sends over a
mobile relay that retries. Broadening means writing genuinely new arbitration, not
extending a state machine.

**Trap E — the easy part is the part that looks hard.** `scope` is a literal tuple
type `readonly ["answer-prompts"]` (`:92`, `:98`), validated by
`scopes.length !== 1 || scopes[0] !== "answer-prompts"` (`:259`), and enforced by an
inline `lease.scope.includes("answer-prompts") || !type.startsWith("answer-")`
(`:334`). Generalizing to a scope *set* with per-method declarations and one
`authorize(action, lease)` helper is maybe half a day. So the architecture does look
broadening-ready — but only where it is cheapest. A–D are where the cost is, and
none of them are visible from the type signatures.

**Trap F — `set-foreground` must wait on PR #14339 regardless.** Until
`2d99083e5f` lands, `session.setForeground` is unguarded and returns success before
the TUI's async switch completes (`serverSeamImpl.ts:372-425`). That PR both adds
the attach requirement *and* awaits the transition — which is precisely what makes a
truthful phone-side "did it work?" possible (T6 §7.2.5). Do not grant a
foreground scope before it merges.

**Recommended increment order:**

1. **v1.1 "make it work":** fix Trap A (permission policy — I recommend
   deny-only-from-phone), decide Trap B explicitly, implement the `destructive`
   flag the phone was promised (F7), extend the phone's event projection to carry
   `*.requested` (F6), fix Trap C's grant ergonomics, and send the interop values
   still owed (dedup TTL, final outcome enum, pending-set snapshot on attach —
   ack §6 items 4, 6, 7; heartbeat/TTL are already returned by `leaseResult`,
   `:590-602`).
2. **Then, only after real phone-against-real-session usage:** `abort-turn`
   (smallest marginal risk — idempotent-ish, no content), then `send-input` (needs
   Trap D's arbitration answered), then `set-foreground` (needs #14339).

---

## Ranking and interactions

1. **Decision 1, steps 1–2 (unbreak `connect`/`resume`, delete `observePromptEvents`).**
   Smallest change, unblocks everything, removes the only hard upstream dependency.
2. **Decision 2a (streaming).** Fork-local now; separate upstream PR. The only
   proven user-visible defect in the entire C4 set.
3. **Decision 4 step 1, Trap A.** Without it the landed feature does nothing. This
   is the difference between "steering shipped" and "steering works."
4. **Decision 2b + 2d.** Trivial; bundle with 1.
5. **Decision 3.** Do nothing new. Let #14356 ride; open at most the `answeredBy`
   conversation.
6. **Decision 4 broadening.** Unscheduled, gated on 3 above plus real usage.

**How the decisions move each other:**

- **1 → 3:** choosing (c) makes #14356 an upside rather than a dependency, so
  Decision 3's "should we invest upstream?" loses its urgency argument entirely.
- **1 → 2:** (c) makes C4 finding #1 unreachable on our route, but leaves finding #2
  (streaming) at full severity. Do not let them be bundled as "the C4 permission
  work" and closed together — one is solved by deletion, the other needs a real fix.
- **1(iv) → 4:** the state-diff reframing is the same discipline that surfaces
  Trap A. If C4 is re-scoped to "assert observable session state, not wire shape,"
  Trap A falls out of it for free. That is the strongest reason to do Decision 1's
  test re-scoping and Decision 4's first step in the same pass.
- **2a ↔ 3:** the streaming fix is the *good* version of the upstream ask Path B
  wanted to be — small, bug-shaped, no alignment gate, benefits VS Code and the
  Agents tab. It is evidence for the Decision 3 substitution, not a separate track.

---

## Explicit disagreements with existing docs/decisions

| Doc | Claim | My position |
|---|---|---|
| `t6-remote-steering-design.md` §4 | "Start Path A, pursue Path B alignment in parallel" | Path B has no remaining content (Decision 3). `PromptManager` is already transport-neutral; `CommandPoller` was dropped before implementation. |
| `t6-pathb-lite-handoff.md` §2.6 | A direct PromptManager actor "avoids introducing the clobber write" — an argument for B-lite over the v1 SDK attach | True but incomplete, and it left the actual bug in place. The real point is that the *base* attach never needed provider registration either; B-lite fixed the new path and ignored the old one. |
| `copilot-happy-embedded-ui-server-handoff.md:221` | "Resume uses `observePromptEvents: true` and `requestPermission: false`" | Should be deleted from the contract, not merely corrected. It is the origin of C4 finding #1 and it is now enforced as *mandatory* by `happyEmbedPolicy.ts:112`. |
| C4 blocker record | Implies finding #4 (bespoke prototype chain) is resolved; lists 3 open | Finding #4 is half-fixed and still live (F4, verified in node). |
| C4 blocker record | Calls the read-only shape "the blessed read-only attach shape" | Blessed by *our* doc and *our* policy file, not upstream. We can unbless it unilaterally — which is what makes Decision 1 cheap. |
| `t6-pathb-lite-phone-side-requirements.md` §3 / ack §3 | Prompt events will carry `destructive: boolean` | Not implemented; the actor has no event publisher at all (F7). The phone team is building against a promise that does not exist. |
| `t6-pathb-lite-phone-side-requirements.md` §5 | "~3 s pickup, don't build for sub-3s" | Already corrected in the inbound answer, but the phone team holds *this* doc. It needs an explicit correction note, not just a correction elsewhere. |
| `happy-mission-control-actor-v1` closeout | "All 8 acceptance criteria met" | Criterion 2 ("phone can approve/deny a tool permission") is met against a mock producing a permission kind the runtime cannot produce (F5). The criteria were met; the product behavior was not. |

---

## What I did not verify (residual risk in this document)

- I did not run any build or test. Every claim is source-read plus one `node -e`
  check of plain-object prototype semantics.
- I did not verify the *user-visible* impact of `setShellNotifier` rebinding on
  resume (`sdkServer.ts:3874`) — only that it is unconditional.
- I did not check whether `allowAllMcpServerInstructions` (also unconditional at
  `sdkServer.ts:3745`-ish) is a third silent resume mutation; it looks like one and
  is worth ten minutes.
- I did not check PR #14356/#14339 review state on GitHub (the active `gh` account
  is `evmitran_microsoft`, which cannot resolve the upstream repo, and switching
  accounts would mutate shared local state). I inferred "unmerged" from
  `answerPromptEvents` being absent on `origin/main` @ `cde60824c9`, which is
  sufficient for the recommendation.
- I did not examine the codexu-side tasks
  `happy-t6-phone-steering-client-plumbing` / `happy-t6-phone-steering-app-ui`, so
  some of F6/F7 may already be scheduled there; F5 is definitely not.
