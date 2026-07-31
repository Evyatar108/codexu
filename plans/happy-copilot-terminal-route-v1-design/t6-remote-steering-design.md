# T6 — Remote Steering for Happy ↔ Copilot CLI

**Status:** Design proposal, not yet implemented or approved. Answers the "open
decision" the v1 design doc (`design.md`) deliberately deferred: *"Later
remote-approval ownership model (T6). If/when the phone answers approvals,
define terminal-vs-phone authority and the disconnect-safe restore... Decision
needed only if T6 is scheduled."* T6 is now scheduled — the operator has
decided v1 should include real steering (approve/deny, send input, abort,
answer elicitations, set foreground), not defer it.

**Scope:** This document covers both repositories:
- `copilot-agent-runtime` (the Copilot CLI fork) — worktree
  `C:\repos\copilot-agent-runtime\.worktrees\happy-copilot-embedded-ui-server`,
  branch `local/happy-copilot-embedded-ui-server`, classification `local-only`.
- `codexu` (this repo) — the Happy client/daemon side.

**How this was produced:** two independent, parallel investigations (Claude
Opus 5 max effort and GPT-5.6 Sol max effort), each given the same brief and
told to read the actual code and both design docs rather than reason from the
comment/spec alone, followed by an operator Q&A round verifying the key claims
directly against the source. Both investigations converged independently on
the same core architecture; where they differ, both options are recorded
below. All file:line citations were spot-checked directly, not taken on faith
from either sub-agent.

---

## 1. Why this document exists — the v1 design's safety claim is false

The v1 design (`design.md:821-828`, `:886`) states that attaching with
`requestPermission: false` means Happy "is never a permission provider," so
the documented provider-disconnect clobber "cannot occur in v1." **This is
incorrect for the current implementation.**

`src/core/sdkServer.ts:4255-4263` (current worktree HEAD `404de8a307`):

```ts
const shouldProvidePermissionEvents = enablePermissionCallback || observePromptEvents;
const shouldProvideElicitation = requestElicitation || observePromptEvents;
```

**`observePromptEvents: true` alone — the flag the v1 contract blesses as pure,
listener-only observation — already registers the connection as a permission
*and* elicitation provider.** This was independently confirmed by two parallel
code reviewers (Opus 5 and Sol) during the C4 regression-hardening round, and
independently re-confirmed by both brainstorming agents while reading the code
fresh. It is not a Happy-specific bug: `git blame` on the acknowledging comment
(`sdkServer.ts:5924-5927`, "the broader provider-vs-host ownership race... is a
separate, pre-existing issue not addressed here") attributes it to an upstream
engineer (Matthew Rayermann, 2026-07-08), and `sdkServer.ts:4255-4263` itself
carries real upstream commit history (`git blame` → `9aae39c967f`, upstream PR
#8391, 2026-05-26) with **zero changes from this Happy work** — confirmed via
`git diff origin/main...HEAD -- src/core/sdkServer.ts`, which touches only an
unrelated import and `buildSeamHandlers`. Any VS Code-extension connection or
Agents-tab attach that resumes with `observePromptEvents: true` and later
disconnects hits the same silent lockout today, with no Happy involved.

**Practical consequence:** the shipped Happy client (`codexu:
packages/happy-cli/src/agent/copilot/nativeLocalRpcClient.ts:167-169`) is
accidentally safe today only because it does **not** implement the design as
written — it sends `session.resume` with just `{sessionId, disableResume:
true}` and never sets `observePromptEvents`, mirroring via `session.eventLog.read`
polling instead of `session.event`. Implementing the v1 design faithfully
would introduce the bug. `design.md` and
`docs/copilot-happy-embedded-ui-server-handoff.md:221` need correction
regardless of whether T6 proceeds.

---

## 2. Current-state findings (verified)

### 2.1 Permission/capability state has no owner, only writers

`Session.permissions.setRequired` (`src/core/session.ts:2954-2969`) is a
single, synchronous Rust-owned boolean scalar. It records no source, no
reference count, no owner identity. When `false`, every tool/path/URL
permission request resolves immediately to `{kind: "user-not-available"}` —
**a silent denial with no dialog** (`session.ts:7989-8049`).

At least seven independent call sites write to it directly, with no
coordination between them:

| Writer | Site |
|---|---|
| TUI foreground effect (mount `true` / unmount `false`) | `src/cli/app.tsx:3092-3115` |
| Background session pool re-assertion | `src/cli/sessions/backgroundSessionManager.ts:233-243` |
| ACP server | `src/cli/acp/server.ts:721` |
| Prompt mode (`-p`) | `src/cli/promptMode.ts:1645` |
| AHP relay session | `src/core/ahp/client/relaySession.ts:624` |
| SDK provider refcount (`updatePermissionCallbackProvider`) | `src/core/sdkServer.ts:5876-5908` |
| Extension-gate restore snapshot | `src/core/sdkServer.ts:5929-5945` |

The TUI's own `true` (`app.tsx:3092`) fires once, on mount, from an effect
keyed on `[sessionClient, handlePermissionRequest, backgroundSessionManager]`
— it does not re-run on an interval, on mode change, or on
`capabilities.changed`. **Once clobbered by an unrelated connection's
disconnect, nothing repairs it for the rest of the session's life.**

The exact same unowned-boolean pattern applies to the `elicitation`,
`mcp-apps`, and `canvas-renderer` capabilities (`sdkServer.ts:5844-5974`) —
first tracked provider adds the capability, last one removes it, and removal
cancels any pending request that depended on it
(`session.ts:8902-8910`; `src/runtime/src/session/pending_request_store.rs:655-679`).
A read-only Happy disconnect can cancel an in-flight elicitation the terminal
itself was relying on.

### 2.2 There is no authorization on the JSON-RPC surface, at all, today

- Admission is one shared bearer token, binary: `connect` with a matching
  token flips `record.authenticated = true`
  (`src/runtime/src/protocol/jsonrpc/engine.rs:821-864`) and **every**
  registered method becomes reachable. Comparison is constant-time
  (`engine.rs:1144-1146`) — that part is fine.
- No per-connection check after admission. `serverSeamDispatch.ts:273-277`
  resolves a session purely by the `sessionId` parameter in the request; it
  never checks whether the calling connection actually attached to that
  session.
- Caller identity is extension-only and `null` for every direct/SDK caller
  (`serverSeamDispatch.ts:49-52`; `napi_seam.rs:71-77`).
- **`session.setForeground` is completely unguarded**
  (`src/core/jsonrpc/serverSeamImpl.ts:372-424`): it checks only that a
  foreground callback is registered and that the target session is loadable —
  including cold-loading a session the caller never attached to. Any
  authenticated connection can redirect the human's screen to an arbitrary
  session id. This is close to a standalone security bug independent of T6.
- The `local-attach` foreground refusal that might look like a guard is inert
  for this path — it's gated on a sidebar feature flag and only guards
  in-process registration, not the RPC method (`embeddedServer.ts:768-776`).
- No rate limiting or connection cap exists anywhere
  (`engine.rs:817-820`: a rejected peer "can do nothing but re-attempt
  `connect`" — unbounded).
- **The v1 "read-only" property is enforced nowhere in production.**
  `classifyHappyCall` (`test/cli/happyEmbedContract.ts:153-267`) is real,
  reviewed, fail-closed logic — but it is wired only into
  `test/cli/happyEmbedInboundRpcSurface.test.ts`. `describeInboundRpcSurface`
  (the introspection half) is the only production caller
  (`src/core/jsonrpc/serverSeamHandlers.ts:190`). **The connection token, as
  issued today, already grants `session.send`, `session.abort`,
  `session.setForeground`, and every `handlePending*` method.** Read-only v1
  is currently a client-side promise, not a server-enforced property.

> This is the single most important framing to carry into T6: **you are not
> granting the phone a new capability it lacked. The token already grants
> everything. T6 is about constraining and attributing a capability that is
> currently unconstrained.** Shipping T6 well makes the product *more*
> secure than today, not less.

### 2.3 The hard part of "two actors, one session" is already solved — for Mission Control, not for Happy

Copilot already runs a live local TUI and a remote actor answering the same
prompts, first-wins, in production — for `--remote`/Mission Control, GitHub's
cloud-based remote-agent-steering feature. This is a **materially different
mechanism from Happy**, verified directly:

- `PromptManager` (`src/core/sharedApi/promptManager.ts`) — constructor takes
  a `RemoteExportSession` (`:100-104`), imports types from
  `./missionControlContracts` (`:21-26`). Its own doc comment states "Both
  local TUI and remote UI can respond (first wins, idempotent)" (`:56-96`).
- `CommandPoller` (`src/core/sharedApi/commandPoller.ts`) — polls
  `MissionControlCommand`s via a `MissionControlCommandClient` (`:16-102`),
  the input-injection path for remote-originated messages
  (`session.send()`, `:91-101`).
- Both files carry genuine upstream commit history (`git log`: upstream PRs
  **#12002**, **#11063**, **#11706**, **#11650**) — they are actively
  maintained, team-owned core Runtime files, not something addable/removable
  locally.
- Underneath both, the runtime enforces first-wins via a **native tombstone**,
  not a JS race: `pendingRequestStore.ts:234-294` — once any client resolves a
  pending request, every other resolution attempt gets `success: false`. This
  layer is generic (not Mission-Control-specific) and is exactly the layer
  Happy should reuse regardless of which path below is chosen.
- The terminal already dismisses its own dialog when a remote answered first,
  with an honest message ("Resolved by another client",
  `app.tsx:5879-5930`).
- `remoteSteerable` (`sdkServer.ts:7087-7090`; event
  `RemoteSteerableChangedData`, `generated/session-events.ts:3706-3710`) is an
  existing, coarser precedent for "a per-session flag describing whether a
  remote actor may steer."

**Confirmed directly: the v1 design doc never mentions Mission Control,
`PromptManager`, `CommandPoller`, or `RemoteExportSession` anywhere** (grep
across `design.md` — zero matches). This was not a "compared and rejected"
decision; it simply never came up. Happy was built directly on `SDKServer`'s
generic embedded JSON-RPC seam (the same one the VS Code extension uses),
which is exactly why it re-derives "one session, two actors" from scratch and
walks into the exact race Mission Control already solved.

---

## 3. Architecture: separate five concerns that are currently one boolean

Both investigations, independently, arrived at the same decomposition. The
current code conflates all of these into `permissionRequestEventsEnabled`:

| Layer | Question | Current state | Correct model |
|---|---|---|---|
| **Observation** | May this connection receive events at all? | Conflated with providing (`observePromptEvents` implies provider) | Pure subscribe, no side effects |
| **Capability availability** | Does `elicitation`/etc. exist on this session? | First/last provider add/remove, cancels in-flight work on last-remove | Base (host-owned) + dynamic overlay, removed only when both reach zero |
| **Prompt demand (enablement)** | Should this session wait for a human at all? | One boolean, N uncoordinated writers, no owner tracking | **Owner-set latch**: `enabled ⟺ |owners| > 0`; host owners are pinned and never cleared by a peer's disconnect |
| **Response authorization (arbitration)** | Who gets to answer *this* pending prompt? | Already correct — native first-wins tombstone | Keep as-is; add attribution |
| **Steering authority** | Who may originate input / abort / change foreground? | Nothing — the token already grants it unconditionally | **Single-holder, expiring, terminal-revocable lease** |

### 3.1 Enablement latch (replaces the bare boolean)

```
enabled  ⟺  |owners| > 0
owners  := { host:tui-foreground, host:background-pool, conn:<id>, ext:<id>, ... }
```

- `acquire(owner)` / `release(owner)` are the only mutators; releasing an
  owner never held is a no-op.
- Host owners (TUI, background pool, ACP, prompt mode) are pinned — cleared
  only by their own explicit release, never by a peer's disconnect.
- Connection owners auto-release on disconnect
  (`sdkServer.ts:6104`'s call becomes `release(conn:<id>)`) — correct by
  construction, no host-vs-provider asymmetry possible.
- Legacy `setRequired({required})` becomes a shim mapping to
  `acquire`/`release` for a synthetic `legacy:<caller>` owner — the wire
  contract for every existing caller is unchanged.
- `restorePermissionEventsAfterGate`'s one-shot snapshot hack
  (`sdkServer.ts:5929-5945`) is deleted entirely; the extension gate becomes
  `acquire(ext:x)` / `release(ext:x)`.
- `observePromptEvents` stops implying provider status; a new explicit opt-in
  (e.g. `answerPromptEvents: true`) is required to become an enablement
  owner. This is a real, small behavioral change for the Agents tab, whose
  controller *does* answer today (`localRpcSession.ts:1332,1403`) and should
  set the explicit flag.

### 3.2 Prompt arbitration — keep as-is, add attribution

The native tombstone semantics (`pendingRequestStore.ts:234-294`) are already
correct, already tested, and should not change. What's missing is
**attribution**: `PermissionCompletedData` and the other three completion
event shapes (`generated/session-events.ts:3095-3102` and neighbors) carry
`{requestId, result, toolCallId?}` with no answerer identity. Add an optional
`answeredBy?: {kind: "terminal" | "remote" | "extension" | "rule" | "hook",
label?: string}`. This single addition is what turns "a dialog silently
vanished" into "Approved on Happy (iPhone) — Bash(npm test)" — addressing the
"autonomous-looking behavior" concern directly.

Do **not** hold remote answers in a pending tray for human confirmation before
they take effect — that defeats "steering while away from the terminal,"
doubles approval latency, and creates a second queue with its own expiry
semantics. Where that posture is wanted, express it as an authority-scope
restriction (below), not as a change to arbitration.

### 3.3 Steering authority — a lease, not a stack or last-writer-wins

```
lease := { holder, grantedAt, expiresAt, scope, grantedBy }
scope ⊆ { answer-prompts, send-input, abort-turn, set-foreground }
```

| Property | Value | Why |
|---|---|---|
| Default | no lease; terminal has full implicit authority | fail-safe; zero behavior change when no phone is attached |
| Holders | exactly one at a time | makes "multiple phones" well-defined |
| Grant | **only from the terminal**, explicit human action | a phone (or a stolen token) must never self-grant; token compromise then buys only observation |
| Expiry | short (e.g. 15 min), renewed by phone heartbeat | covers crash, network death, walking away and forgetting |
| Revocation | any terminal keystroke instantly revokes | the human at the physical keyboard is the ultimate authority |
| Loss (expiry/revoke/disconnect) | terminal regains full authority; **nothing else changes** | no clobber, no silent-deny — this is the fix for §2.1's bug, generalized |
| Persistence | in-memory only | a lease surviving a process crash is a bug, not a feature |

Rejected alternatives and why:
- **Authority stack / priority list** — needs a total order between "human at
  the keyboard" and "human holding the phone," but they're usually the same
  person; when not, ordering is a policy choice, not an inherent property, and
  a silently-vanished top-of-stack entry has no defined recovery.
- **Last-writer-wins, scaled up from `setRequired` to input/abort** — this is
  the current bug, generalized to a strictly larger blast radius. A dropped
  packet or stale retry becomes a control-flow change.

Worked scenarios:

| Scenario | Outcome under the lease model |
|---|---|
| Phone answers first, human also tries | Phone's answer stands (arbitration, unchanged). Terminal shows "Approved on Happy (iPhone) 0.4s ago." Human's redundant input is dropped with a visible reason, not silently. |
| Phone disconnects mid-decision | Prompt stays live; terminal keeps rendering it — enablement is held by the terminal's own pinned owner, never by the phone. (Today: this is the clobber.) |
| Phone reconnects after human acted | Reconnect replays history + `session.permissions.pendingRequests` (the actual current pending set); no divergence, no re-prompt. The lease is **not** auto-restored on reconnect — a reconnecting client isn't necessarily the same authorized human. |
| Multiple phones attach | All may observe. At most one holds the lease; a second phone's lease request raises a terminal-side approval prompt. |
| Human hands off fully (stepping away) | Explicit terminal action (e.g. `/handoff --to <device> --for 2h --scope all`) grants a full-scope lease with a visible "steered by Happy" banner. |
| Convenient secondary approval channel (still at the desk) | No lease, or `scope: {answer-prompts}` only — phone may answer prompts, may not originate input/abort/foreground. **Recommended default posture for the first shipped increment.** |

---

## 4. Mechanism choice: build Happy-specific, or generalize Mission Control's plumbing?

This is the one decision both investigations frame as genuinely open, and
where they weigh the tradeoff slightly differently in emphasis (Opus:
"investigate reuse first, build standalone only if entangled"; Sol: "extract a
transport-neutral `SessionControlBroker`" as the target shape either way).
Both file:line-verified that `PromptManager`/`CommandPoller` are real,
upstream-owned, actively-maintained files (§2.3) — this is not a hypothetical
tradeoff.

| | **Path A — Happy-specific mechanism** | **Path B — generalize `PromptManager`/`CommandPoller`** |
|---|---|---|
| Where new code lives | Entirely within the local-only Happy worktree/seam | Refactors genuinely shared, upstream-owned core files |
| Process required | None beyond the narrow bug-fix PRs in §5.1 — local-only work needs no team sign-off | Architecture-level refactor of shared code → requires documented Copilot CLI/Runtime team alignment **before** coding, per this workspace's non-core-feature-alignment norm |
| New code volume | Larger — building first-wins-adjacent plumbing, attribution, and a lease from scratch (even though the *pattern* to copy already exists and is well understood) | Smaller — reuses already-built, already-tested arbitration, dismissal, and remote-input-injection wiring |
| Long-term risk | Ends up as a second, parallel remote-control system alongside Mission Control's — a real maintenance and user-confusion cost ("why does my phone behave differently from the web UI?") both agents flagged independently | Short-term coordination/schedule risk; some chance the team has different plans for this code |
| Speed to ship | Faster to start | Slower to start (needs the alignment conversation first) |

**Recommendation:** do not treat this as binary. Start with **Path A**, but
deliberately mirror `PromptManager`'s semantics (first-wins arbitration
already reused from the native layer regardless; same event/attribution
shape) so that a later merge into Path B is a mechanical consolidation rather
than a rewrite. In parallel, open the team-alignment conversation about
generalizing `PromptManager`/`CommandPoller` as its own, separate initiative —
if it succeeds, migrate Happy onto it; if it doesn't happen soon, Happy is not
blocked.

---

## 5. Copilot (Runtime) side — work breakdown

### 5.1 Needed regardless of the Path A/B decision (do first, do independently)

| # | Work | Size | Notes |
|---|---|---|---|
| 5.1.1 | Correct `design.md:821-828,886` and `test/cli/happyEmbedContract.ts:209-218` — `observePromptEvents:true` **does** register a provider today | small | Documentation/test-comment accuracy; do this before anyone implements from the doc again |
| 5.1.2 | File the upstream issue for the provider-vs-host race: repro, `sdkServer.ts:5924-5927` (ack comment) + `:4255-4263` (the actual conflation) + `session.ts:7989-8049` (silent-deny symptom); blast radius = VS Code extension + Agents tab, not Happy-specific | small | Normal bug-fix path (AGENTS.md 4a carve-out) — no team-alignment gate needed for *reporting/fixing the bug itself* |
| 5.1.3 | Implement the enablement-latch owner-set (§3.1); `setRequired` becomes a legacy shim; delete `restorePermissionEventsAfterGate`'s snapshot | medium | Fixes §2.1 generally, benefits every multi-client caller |
| 5.1.4 | Separate `observePromptEvents` (pure observe) from an explicit answer/provider opt-in; update `protocol/types.ts:1834-1860`'s doc comment; adjust the Agents-tab attach to set the new flag | medium | |
| 5.1.5 | Regression tests: last-provider-disconnect preserves the host's pin; existing extension-gate regression (`test/cli/e2e/extension-permission-access.test.ts:223`) stays green; background-pool re-assertion unaffected | medium | |
| 5.1.6 | Authorize `session.setForeground` (`serverSeamImpl.ts:372-424`): require the caller to have actually attached to the target session id; reject cold-loading an arbitrary session | small–medium | Close to a standalone security fix; do this even if T6 stalls |
| 5.1.7 | Promote `classifyHappyCall` (`test/cli/happyEmbedContract.ts:153-267`) from test-only into a real production enforcement point on the Happy embed listener | medium | Turns v1's "read-only" from a client-side promise into a server-enforced property — arguably v1's single biggest outstanding gap, independent of T6 |
| 5.1.8 | Basic listener hardening: connection cap, exponential backoff on repeated failed `connect` attempts | small | `engine.rs:817-820` currently allows unbounded retries |

### 5.2 T6-specific (depends on the Path A/B decision in §4)

| # | Work | Size |
|---|---|---|
| 5.2.1 | Steering lease: request/grant/renew/release/revoke state machine (§3.3) | large — own design doc regardless of path |
| 5.2.2 | New/changed RPC surface (see §6 below) | medium–large |
| 5.2.3 | `answeredBy` attribution on the four completion event shapes | small |
| 5.2.4 | Terminal UI: persistent steering-status indicator, attribution on dismissed dialogs, phone-originated-message badge, "already answered elsewhere" feedback on swallowed input | medium |
| 5.2.5 | Idempotency key on `session.send` (dedup per session, short TTL) — required before any phone is allowed to send, given mobile retry behavior | small |
| 5.2.6 | If Path B: the `PromptManager`/`CommandPoller` decoupling investigation + refactor, gated on team alignment | large, separate initiative |

**Sequencing:** 5.1 entirely, then 5.2.1–5.2.5 (Phase "phone approves prompts"
first — lowest risk, ~80% of user value, needs only `answer-prompts` scope),
then abort/send/foreground under lease scope (larger surface, smaller
marginal value, this is where AGENTS.md 4a's feature-alignment gate applies
most clearly since it's new CLI-facing protocol/behavior).

---

## 6. Protocol/RPC surface for T6

Both investigations agree on the design principle — **add as few new methods
as possible; add identity, scoping, and attribution to what exists** — and
proposed similar but not identical concrete shapes. Recording both; pick one
during implementation.

### Option 1 (Opus): discrete authority methods

- `session.authority.request {scope[], requestedTtlMs, deviceLabel} → {status, requestId}` — always raises a terminal-side approval prompt; never self-granting.
- `session.authority.release {leaseId} → {released}`
- `session.authority.renew {leaseId} → {expiresAt}`
- `session.authority.get {} → {lease?}`
- `session.attach.describe {} → {connectionId, role, scope[]}`
- Event: `session.authority.changed {lease?, reason}`

### Option 2 (Sol): consolidated snapshot + dispatch

- `session.control.snapshot {} → {processGeneration, foregroundSessionId, foregroundGeneration, activeTurnId, controlMode, activeController, pendingRequests[]}` — needed because `user_input.requested`/`elicitation.requested` are ephemeral and not replayed; recovery today is in-process-only.
- `session.control.dispatch {action: send_text | abort_turn | respond_permission | respond_user_input | respond_elicitation | set_foreground, actionId, leaseEpoch, attachGeneration, ...}` → `{outcome: applied | duplicate | already_resolved | stale_state | not_pending | unauthorized | rate_limited}`

Either way, existing methods gain scope checks rather than new signatures:
`session.send`/`session.abort` gate on lease scope at dispatch (no signature
change — `session.send` already tolerates concurrent input by queueing,
`session.ts:17813-17819`, so a phone message simply enqueues behind the
human's turn); `session.setForeground` requires both a `set-foreground`-scoped
lease **and** the compare-and-set fields `expectedForegroundSessionId` +
`foregroundGeneration` (it currently reports success before the TUI's async
switch even completes — `serverSeamImpl.ts:372-425` vs `app.tsx:2338-2363`).

### Security model for the new surface

- **No second token tier.** Convey steering authority via the in-memory,
  expiring, terminal-granted lease — not a second longer-lived secret on
  disk. Two tokens in the same file is theatre; whoever reads one can read
  both.
- **First-release permission scope: approve-once / deny only.** Do not expose
  Happy's existing generic modes (accept-edits, bypass-permissions,
  session-wide approval) for Copilot in v1 — a phone is a materially worse
  decision environment for destructive commands (small screen, truncated
  context) and this is a real, separate risk both investigations flagged.
- **Replay protection:** prompts are already replay-proof via the native
  tombstone. `session.send` is not — add an `idempotencyKey`, de-duplicated
  per session with a short TTL, before allowing phone-originated sends.
- **Rate limiting on mutating verbs**, even though the transport is loopback —
  a 43-char token on a loopback listener is shared with every process running
  as that user, and there is currently no connection cap or backoff at all.
  This matters regardless of whether the user later tunnels the connection
  over SSH/VPN.

---

## 7. Happy/codexu side — work breakdown

### 7.1 Needed regardless of T6/Path A/B (independent client-side gaps found)

| # | Work | Evidence |
|---|---|---|
| 7.1.1 | Stop treating every `flavor:"copilot"` session as blanket read-only; drive the composer/steering UI off actual capability/control-state instead | `packages/happy-app/sources/sync/storage.ts:46-93`; composer removal at `SessionView.tsx:175-180,479` |
| 7.1.2 | Add a real non-owning **detach** lifecycle distinct from the current shutdown-on-disconnect | `runCopilotMirror.ts:248-286` sends `runtime.shutdown` and terminates the target today — correct for M1a's headless-spawn use case, **wrong** for interactive mirroring; a phone crash/logout must never kill the terminal process |
| 7.1.3 | Add an idempotency/`actionId` concept to the RPC relay | `packages/happy-server/sources/app/api/socket/rpcHandler.ts:160-220` forwards only `{method, params}` today, no dedup |
| 7.1.4 | Extend event projection beyond the current narrow mirror-only set | `packages/happy-cli/src/agent/copilot/types.ts:11-22` currently maps only ten final event kinds — live pending-prompt rendering needs more |
| 7.1.5 | Build the actual composer/prompt-answer UI (approve/deny, text input, elicitation response rendering) | net-new product UI work, needed for any steering to be usable at all |

### 7.2 T6-specific

| # | Work |
|---|---|
| 7.2.1 | Implement the Copilot-specific restricted permission mapper (approve-once/deny only — do not surface Happy's broader generic modes for Copilot) |
| 7.2.2 | Implement the client side of whichever protocol option (§6) is chosen — either discrete authority calls or snapshot+dispatch |
| 7.2.3 | Steering-status UI: show current control mode (observe/companion/delegated), active device, lease expiry, and a manual release action |
| 7.2.4 | Attribution rendering: show "approved/denied here" vs. "approved/denied on terminal" consistently |
| 7.2.5 | Handle `set_foreground`'s async nature correctly — await the actual lifecycle transition event, don't assume success from the RPC response alone |

**What changes between Path A and Path B for codexu specifically:** only the
wire shape in 7.2.2 (bespoke Happy methods vs. Mission-Control-style
discriminated actions). Everything else in §7 is needed either way and can
start immediately — it does not need to wait on the Copilot-side mechanism
decision.

---

## 8. Sequencing summary (both repos)

1. **Now, independent of T6:** §5.1 (Copilot correctness/security fixes) and
   §7.1 (codexu client-side gaps) — both are real, already-identified defects
   worth fixing on their own merits.
2. **Phase "phone approves prompts"** (the highest-value, lowest-risk slice):
   §5.2.1–5.2.4 with `scope: {answer-prompts}` only, plus §7.2.1, §7.2.2 (a
   minimal dispatch surface), §7.2.4. No input, no abort, no foreground yet.
3. **Phase "full steering"**: extend the lease to `send-input`, `abort-turn`,
   `set-foreground`; §7.2.3, §7.2.5. This is the piece most clearly subject to
   the CLI/Runtime team feature-alignment gate, since it's new user-facing
   protocol and behavior, not a bug fix.
4. **Ongoing, separate initiative:** the Path B investigation (generalizing
   `PromptManager`/`CommandPoller`) — start the team-alignment conversation in
   parallel with phase 2/3, migrate later if it lands.

---

## 9. Open decisions requiring operator input

1. Path A now / Path B later (recommended, §4), or commit to Path B from the
   start and accept the slower ramp-up?
2. Exact protocol shape for §6 — discrete authority methods (Opus) vs.
   snapshot+dispatch (Sol)?
3. Default lease scope on first grant — `answer-prompts` only (recommended)
   or broader from day one?
4. Should destructive permission kinds (e.g. `rm -rf`-class commands) be
   terminal-only even under a full lease, regardless of scope? Both
   investigations lean yes; this is a product-safety call.
5. Who owns filing/driving the upstream bug-fix PRs in §5.1 (this operator, or
   coordinate with the Runtime team given §2.1/§2.2 affect shared code)?

---

## Appendix: source investigations

This document synthesizes two independent background-agent investigations
(Claude Opus 5 max effort, GPT-5.6 Sol max effort) conducted 2026-07-31 against
`happy-copilot-embedded-ui-server` worktree HEAD `404de8a307` and this repo's
`design.md`/`copilot-happy-embedded-ui-server-handoff.md`, plus direct operator
verification of the Mission Control file ownership and design-doc silence on
it. Full raw agent transcripts are not preserved in this repo; re-run the same
investigation prompts against the current code if this document goes stale.
