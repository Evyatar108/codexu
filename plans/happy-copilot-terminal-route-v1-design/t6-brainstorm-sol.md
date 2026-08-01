# T6 remote steering — independent architecture/product recommendation

**Date:** 2026-08-01  
**Scope:** Read-only architecture investigation. No product code was modified.

## Baselines reviewed

- Original and T6 design/handoff documents under
  `C:\efforts\codexu\plans\happy-copilot-terminal-route-v1-design`.
- Tasks Board records:
  `happy-copilot-embed-regression-matrix` and
  `happy-mission-control-actor-v1`
  (`C:\efforts\copilot-runtime-workspace\.tasks-board\data.json:1499-1529,
  1924-1965`).
- Landed local-only Runtime implementation at commit `1b5113d228`:
  `C:\repos\copilot-agent-runtime\.worktrees\happy-copilot-embedded-ui-server`.
- Upstream permission-provider fix at commit `7c9c96327a` / PR #14356:
  `C:\repos\copilot-agent-runtime\.worktrees\permission-provider-host-race`.
- Upstream foreground-authorization branch / PR #14339:
  `2d99083e5f` (“Authorize session foreground changes”) plus HEAD
  `2273fab2c0` (“Harden JSON-RPC connection admission”):
  `C:\repos\copilot-agent-runtime\.worktrees\foreground-authz`.

## Executive recommendation

1. **C4/base attach:** choose a **staged hybrid**, with PR #14356 as the
   durable architecture. Do not build a second full observation stack in
   `HappyMissionControlActor`, but also do not leave the currently blessed
   `observePromptEvents:true` attach shape enabled while waiting. Quarantine
   that shape, fix the independent streaming mutation, and prove a temporary
   non-provider interactive attach. If #14356 is not merged when phone-side
   answer-prompts integration is otherwise ready, prefer a reviewed backport of
   #14356 over a new parallel provider system.
2. **Other C4 findings:** fix `enableStreaming` and the `disableResume`
   documentation immediately. Repair the watcher-provenance proof before C4 is
   declared complete, but it need not block phone-client plumbing while the
   runtime safety fixes are pending.
3. **General Path B:** do **not** start an upstream refactor now. After
   answer-prompts works end to end, send a short evidence-based alignment note
   to the Runtime team; write shared-code changes only if maintainers express
   interest in supporting another transport.
4. **Broader steering:** do not start yet. The lease/revocation foundation is
   reusable, but the landed actor is intentionally answer-prompts-specific.
   Add a versioned control snapshot and action-result ledger first, then ship
   `send-input`, then `abort-turn`, and put `set-foreground` last.

Priority order: **safe attach and real interop → answer-prompts E2E → C4
closeout → broader actions → optional upstream generalization**.

---

## Verified facts that drive the recommendation

### The original v1 safety claim is conclusively false

The original design explicitly blesses
`observePromptEvents:true, requestPermission:false` and concludes that Happy
is “never a permission provider”
(`design.md:715-717, 821-824, 952`). Current Runtime does the opposite:
`observePromptEvents` is unioned into both permission-provider and elicitation-
provider decisions (`src/core/sdkServer.ts:4277-4285`), permission provider
registration drives `session.permissions.setRequired(...)`
(`sdkServer.ts:4482-4489, 5898-5929`), and disconnect releases it
(`sdkServer.ts:6115-6127`). The C4 blocker records the same root cause after
four review rounds (`.tasks-board\data.json:1529`).

### The landed steering actor really does avoid that path

The actor constructs and calls `PromptManager` directly
(`src/cli/happyMissionControlActor.ts:169-183, 320-380, 434-446`). Its lease is
bound to connection/session generation, revoked by terminal key/paste,
disconnect, session switch, or expiry
(`happyMissionControlActor.ts:190-214, 498-527, 549-587`). It contains no
`permissions.setRequired` call. The Tasks Board’s landed record accurately
describes this at `.tasks-board\data.json:1963-1965`.

The implementation is narrower than the earlier handoff implied. The handoff
described an actor owning both `PromptManager` and `CommandPoller`
(`t6-pathb-lite-handoff.md:31-34, 162-175`), but the landed actor imports and
constructs only `PromptManager`. That is consistent with the later correction
that prompt answers must bypass `CommandPoller`
(`t6-pathb-lite-inbound-answer.md:101-121`), but it means queued send/abort
machinery is not already present waiting to be switched on.

### The current fork/client contract is not end-to-end interoperable yet

The Runtime policy admits a token-only `connect`
(`src/cli/happyEmbedPolicy.ts:46-63`) and requires the old four-field resume
shape (`happyEmbedPolicy.ts:76-91, 112-143`). The checked-out Happy client sends
extra `connect` fields and sends only `disableResume:true` on resume
(`packages/happy-cli/src/agent/copilot/nativeLocalRpcClient.ts:134-140,
167-168`). Its request type does not include any `happy.*` method
(`nativeLocalRpcClient.ts:211-223`), and its event projection still includes
only ten final events, not prompt events
(`packages/happy-cli/src/agent/copilot/types.ts:7-24`).

This is important sequencing evidence: the unsafe provider shape is currently
a fork-side policy/test contract, not a validated phone-to-fork product path.
There is time to correct the architecture before capability advertisement.

### PR #14356 is the correct durable root-cause fix

PR #14356:

- makes `observePromptEvents` pure observation and introduces a separate
  `answerPromptEvents` opt-in
  (`src/core/protocol/types.ts:1906-1931`);
- excludes pure observers from permission and elicitation provider decisions
  (`src/core/sdkServer.ts:4399-4408`);
- changes permission enablement from a scalar writer race to owner-based pins
  (`src/core/session.ts:3117-3122, 3534-3568`;
  `sdkServer.ts:6157-6176`);
- tracks whether dynamic providers actually own a capability before removing
  it, preserving host-baseline elicitation/canvas/MCP capability state
  (`sdkServer.ts:1060-1072, 6111-6126, 6195-6209`);
- adds connection-liveness handling so a closed connection cannot recreate
  ownership after teardown.

That is materially stronger than a Happy-only workaround because it fixes the
shared SDK/Agents-tab/extension ownership model.

### PR #14339 is necessary but not sufficient for future foreground control

The foreground commit requires the caller to have attached to the target
session before it can load or switch it and waits for the actual asynchronous
TUI transition (`src/core/jsonrpc/serverSeamImpl.ts:342-390`;
`src/core/sdkServer.ts:4307-4315`; `src/cli/app.tsx:2377-2391`). The branch also
adds a 64-connection cap, a 10-second authentication deadline, and bounded
per-source authentication backoff
(`src/runtime/src/protocol/jsonrpc/engine.rs:45-50, 798-803, 1009-1018`;
`api_jsonrpc_server.rs:56, 2519-2528`).

Those are good prerequisites, but they do not solve the Happy actor’s
foreground-bound lease lifecycle discussed in Decision 4.

---

## Decision 1 — C4 regression-matrix scope now that steering exists

### Recommendation: staged hybrid, not (a) or (b) as stated

**Do not redesign the entire base mirror around a second actor-owned event
transport now.** The existing SDK event forwarder already sends session events
to every non-extension connection
(`src/core/sdkServer.ts:5315-5384`). The interactive TUI already owns prompt
generation: it pins permission events and subscribes to permission requests
(`src/cli/app.tsx:3092-3115`), and it installs user-input, elicitation, and
exit-plan listeners (`app.tsx:5700-5720, 5812-5816, 6130-6141`). Recreating
generic event forwarding, replay, sanitization, pending snapshots, and
backpressure inside `HappyMissionControlActor` would duplicate mature
machinery and make eventual upstream convergence harder.

**But do not leave the old attach shape live while merely waiting for
#14356.** The current policy knowingly requires
`observePromptEvents:true` even though its own comment admits that this
registers providers (`src/cli/happyEmbedPolicy.ts:81-91, 112-143`). A phone
client must not be updated to that shape on the current branch.

Use this sequence:

1. **Quarantine the old shape.** Keep the route/capability default-off. Treat
   C4 and real answer-prompts acceptance as blocked until the provider and
   streaming issues have safe answers.
2. **Fix the independent resume streaming mutation first** (Decision 2).
3. **Prove a temporary non-provider interactive attach**: resume the already
   foreground interactive session without `observePromptEvents` or any answer
   callback flag, subscribe to `session.event`, and verify that the TUI’s own
   listeners cause all four supported prompt families to reach the Happy
   connection. `SDKServer.registerForegroundSession` explicitly says a client
   must resume to receive events (`sdkServer.ts:2038-2043`), but nothing requires
   that resume to register as a provider.
4. **Use PR #14356 as the durable contract.** After merge/rebase, Happy may
   declare `observePromptEvents:true` with `answerPromptEvents:false`; the actor
   remains the only answer path. This cleanly separates observation from
   response authority.
5. **Fallback trigger:** if phone-side answer-prompts is integration-ready and
   #14356 is still not available, prefer a reviewed backport of its owner-latch
   and observation split. Add actor-specific prompt notifications only if the
   upstream fix is rejected or changes direction—not merely because its merge
   is a few days late.

This recommendation disagrees with both extremes:

- **Against full redesign now:** it creates a second event substrate before
  the first end-to-end client exists.
- **Against passive waiting:** it leaves a known destructive contract ready
  for the phone side to copy.

It also reduces the urgency of Decision 3. Once #14356 supplies safe generic
observation, the fork-local actor stays a small lease/policy adapter rather
than becoming a second remote-control platform.

---

## Decision 2 — the other three open C4 findings

### 2.1 Unconditional `enableStreaming` mutation: fix now; release blocker

Current resume always executes:

`session.updateOptions({ enableStreaming: params.streaming ?? false, ... })`
(`src/core/sdkServer.ts:3708-3712`).

Because the Happy policy does not permit a `streaming` field, every allowed
Happy resume forces streaming off. Supplying `streaming:true` would not be a
sound workaround because the real TUI can legitimately have been launched
with streaming disabled (`src/cli/index.ts:3220-3224`).

The correct fix is to preserve the resident session’s current value when
`params.streaming` is omitted and mutate it only when the caller explicitly
supplies the field. Add regression coverage for both initial states:

- streaming on + observer resume with field omitted → remains on;
- streaming off + observer resume with field omitted → remains off;
- an ordinary authorized SDK resume with an explicit value still changes it.

PR #14356 does not fix this, so waiting for that PR is not a reason to hold
this work. This is a generic resume correctness bug and can follow the normal
upstream bug path; C4 should consume it by merge or a classified local
backport.

### 2.2 `disableResume` documentation/behavior drift: fix now

The public protocol says it is useful for reconnecting “without triggering
resume-related side effects”
(`src/core/protocol/types.ts:1992-1998`), and the Happy policy repeats that
claim (`src/cli/happyEmbedPolicy.ts:81-83`). In implementation it gates only
emission of the `session.resume` event (`src/core/sdkServer.ts:3941-3947`);
option updates, connection/session registration, shell-notifier wiring, and
provider setup occur before that check.

Correct both comments immediately to say **“suppress the `session.resume`
event”**. Do not describe `disableResume` as an ownership or read-only
boundary. If a clearer future wire name is desired, add an alias such as
`suppressResumeEvent`; do not silently broaden the old flag’s behavior.

This is low-risk documentation work and should not wait for any upstream PR.

### 2.3 Watcher-provenance proof: fix before C4 completion, not before client plumbing

The current AST test proves that the call argument resolves to a binding
destructured from `options`, but it never proves that the binding element’s
source property is actually `featureFlags`
(`test/cli/happyEmbedRegressionMatrix.test.ts:1371-1444`). Therefore
`{ happyDerivedFlags: featureFlags } = options` can satisfy the proof, exactly
as the C4 blocker says (`.tasks-board\data.json:1529`).

The production seam is already reasonable:
`bootstrapAgentRegistryWatcher` accepts feature flags and internally owns the
construction decision
(`src/cli/remoteRegistry/agentRegistryWatcherBootstrap.ts:55-56, 91-100`).
Do not replace the current test with an even larger source-text heuristic.
Either:

1. strengthen the symbol proof to require an absent `propertyName` or an exact
   source property named `featureFlags`, and add mutation fixtures for renamed
   destructuring plus a real-call/decoy-call wrapper; or
2. make the interactive bootstrap pass a single already-computed
   `agentsTabEnabled` boolean into a construction helper whose type surface has
   no Happy input, then test that helper behaviorally.

This is a proof-quality issue, not a runtime steering blocker. It may wait
until C4 resumes after the base-attach decision, but it must be closed before
the Happy route capability or release gate is declared proven.

### Scope note on the fifth C4 finding

The generic bespoke registry still snapshots into a normal object and does
property lookup with `installedBespoke[payload.method]`
(`src/core/jsonrpc/serverSeamHandlers.ts:166-171, 222-229`). The Happy listener
currently fail-closes unknown method names before dispatch
(`src/cli/embeddedServer.ts:38-39`), so `constructor` is not a Happy mutation
escape. The broader “introspection exactly equals every property reachable by
lookup” claim nevertheless remains technically false and should stay a
separate generic hardening item rather than being silently marked solved.

---

## Decision 3 — pursue general Path B upstream?

### Recommendation: no implementation now; one post-E2E alignment note

The full T6 design recommends starting Happy-specific work while opening Path
B alignment in parallel
(`t6-remote-steering-design.md:286-310, 431-445`). I disagree with the
“parallel now” part.

The landed adapter has already captured the most valuable shared semantics:

- it uses the upstream `PromptManager`;
- it delegates to the active Mission Control manager for the same session;
- it relies on the same native first-wins pending-request state;
- it keeps the lease, destructive-kind policy, rate limiting, and local
  transport outside Mission Control files.

That means the dangerous form of duplication—two independent prompt
arbitration systems—does not exist. What remains separate is intentionally
product-specific policy.

Generalizing `CommandPoller` now would also solve the wrong immediate problem.
The actor does not instantiate it, and `CommandPoller` currently:

- discards the four `PromptManager` return outcomes;
- acknowledges commands on both success and failure;
- treats user messages as fire-and-forget because awaiting `session.send()`
  can deadlock prompt-response polling
  (`src/core/sharedApi/commandPoller.ts:190-207, 211-275`).

Those are valid Mission Control semantics, not yet a transport-neutral command
broker with the typed synchronous outcomes Happy needs.

Recommended trigger:

1. finish safe base observation;
2. validate answer-prompts on a real phone, including reconnect, terminal
   takeover, and concurrent Mission Control;
3. record which shared primitive is actually missing;
4. send a short `#copilot-cli` alignment proposal;
5. code only if maintainers want a supported second transport or independently
   want the same abstraction.

If the team is interested, propose a narrow typed action-dispatch/control-state
API rather than beginning with a broad `PromptManager`/`CommandPoller`
refactor. If the team is not interested, staying on Path B-lite is acceptable:
the adapter already reuses the core arbitration semantics and has a small
shared-file footprint.

---

## Decision 4 — broaden beyond `answer-prompts`?

### Recommendation: only after the current slice passes real E2E

The T6 design correctly puts answer-prompts first
(`t6-remote-steering-design.md:341-345, 431-445`), and the operator-approved
handoff hard-codes the first grant accordingly
(`t6-pathb-lite-handoff.md:10-15`). Keep that boundary until:

- fork and Happy client handshake contracts agree;
- prompt events and `destructive` classification render on the phone;
- lease request/grant/heartbeat/revocation works across the full relay;
- duplicate mobile retries are proven harmless;
- terminal and Happy first-wins behavior is validated with Mission Control both
  off and on;
- a disconnect leaves every terminal prompt live and answerable.

The checked-out Happy client currently has none of the `happy.*` methods and
does not project prompt events, so broadening now would outrun the integration
by more than one architectural layer.

### The current actor is a useful foundation, but broadening is not trivial

Reusable pieces:

- connection/session-generation binding;
- single-holder lease;
- explicit terminal-only grant;
- heartbeat/expiry/revocation;
- action IDs, basic TTL dedup, and rate-limit plumbing;
- uniform domain-result style;
- Mission Control prompt-manager delegation.

Hidden traps in the actual code:

1. **Scope is structurally hard-coded.** Both pending and active lease types are
   `readonly ["answer-prompts"]`, and lease requests reject any other scope
   (`src/cli/happyMissionControlActor.ts:89-99, 249-282`). `/happy grant` has no
   scope or TTL argument and explicitly describes prompt-answer control
   (`src/cli/commands/happyCommand.ts:42-49`).
2. **The method surface is answer-only.** The six bespoke methods contain no
   action dispatch for send, abort, or foreground
   (`happyMissionControlActor.ts:19-28, 177-187`).
3. **There is no `CommandPoller` or queued-command client in the actor.**
   Broadening requires choosing an execution model; it is not enabling dormant
   code.
4. **Control state is too thin.** `happy.getControlState` returns only lease or
   `no_lease`; it exposes no foreground generation, active turn, available
   scopes, pending prompts, or pending lease requests
   (`happyMissionControlActor.ts:383-388, 488-495`). This also leaves the phone
   ACK’s requested pending snapshot unimplemented
   (`t6-pathb-lite-phone-side-ack.md:95-104`).
5. **The dedup map is a seen-bit, not a result ledger.** It records an action
   after processing and later returns generic `duplicate`
   (`happyMissionControlActor.ts:603-619`). For asynchronous actions, a retry
   needs the original accepted/completed/failed outcome, not merely “seen.”
6. **`send()` cannot be awaited in the inbound RPC.** It can run through an
   entire model/tool/prompt turn. `CommandPoller` deliberately fire-and-forgets
   it to avoid deadlocking later prompt answers
   (`commandPoller.ts:263-275`). Happy must return `pending` after an atomic
   enqueue and publish later completion/failure.
7. **Abort needs stale-state protection.** A delayed mobile request must not
   abort a later turn. The current lease binds only session generation, not an
   active-turn ID. Add `expectedTurnId`/turn generation and a `stale_state`
   outcome before exposing abort.
8. **Foreground switching conflicts with the actor lifecycle.** A successful
   foreground transition causes `EmbeddedServer.registerSession()` to attach
   the actor to a new session, while `attachSession()` first revokes the current
   lease as detached
   (`src/cli/embeddedServer.ts:802-813`;
   `happyMissionControlActor.ts:200-214`). Thus the action would revoke the
   authority that initiated it. PR #14339 adds necessary authorization and
   await semantics, but Happy still needs an explicit two-phase lease transfer
   or a process-level controller lease.
9. **The current outcome enum is too small for asynchronous control.** It has
   `pending`, but no `stale_state`, `busy`, transition identifier, or terminal
   execution failure (`happyMissionControlActor.ts:30-48`).

### Recommended broadening sequence

#### Foundation first

Add a versioned attach/control snapshot containing at least:

- supported scopes/actions;
- foreground session ID and generation;
- active turn ID/generation;
- lease holder/scope/expiry;
- pending prompt snapshot;
- action-status lookup.

Replace the seen-bit dedup map with a bounded per-session action ledger that
caches the original result and transition ID. Extend `/happy grant` so the
terminal explicitly chooses scope and duration; never reinterpret an old
answer-prompts grant as broader authority.

#### Phase 1: `send-input`

- separate explicit scope;
- atomically enqueue, return `pending`, and publish completion/failure;
- attach a visible Happy/device source;
- define what happens if the lease expires while the turn continues
  (recommended: the accepted turn continues; expiry prevents new actions).

#### Phase 2: `abort-turn`

- require `expectedTurnId` or turn generation;
- reject stale/no-active-turn requests distinctly;
- rate-limit independently;
- retain terminal-keystroke revocation.

#### Phase 3: `set-foreground`

- wait for the foreground authorization/async-transition fix from PR #14339;
- grant authority for an explicit target, not arbitrary session IDs;
- use compare-and-set foreground ID/generation;
- transfer or reissue the lease only after the TUI commits the switch;
- return a transition ID and confirm through a lifecycle event.

`set-foreground` should be last because it changes both the viewed session and
the actor’s own session-bound authority.

---

## Final ranked plan

1. **Block capability advertisement.** The checked-out fork and Happy client do
   not yet share a working handshake or steering RPC contract.
2. **Fix resume streaming preservation and correct `disableResume` docs.**
3. **Quarantine provider-style observation; validate a non-provider temporary
   attach.**
4. **Land/rebase PR #14356 (or use a reviewed backport if it becomes the
   schedule blocker).**
5. **Finish answer-prompts phone integration and real E2E acceptance.**
6. **Repair the watcher provenance proof and close C4.**
7. **Build the control snapshot/action ledger, then broaden send → abort →
   foreground.**
8. **Only after E2E, ask upstream whether a shared transport-neutral control
   abstraction is wanted.**

This ordering keeps the current safety win from Path B-lite, avoids a second
generic observation framework, and prevents speculative upstream architecture
or broader mutation verbs from outrunning the first working phone-controlled
prompt.
