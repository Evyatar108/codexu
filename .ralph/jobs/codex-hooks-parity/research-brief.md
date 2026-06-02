# Research Brief — codex-hooks-parity (remaining halves)

Captured during plan-phase. Sources verified at HEAD = `c944d758` on `origin/main`.

## Scope re-statement

Gap 4 in `plans/codex-agent-parity-audit.md` has three sub-gaps. One shipped earlier; this plan ships the remaining two with the deferred-switch protocol question still punted:

1. **Auto-compact context boundary** — SHIPPED in commit `620d31a8` (`feat(codex): wire context_compacted to autocompact context-boundary (Gap 4)`). Verified by regression test `packages/happy-cli/src/codex/runCodex.contextCompacted.test.ts`. No code change needed; this plan only re-affirms the test stays green.
2. **Turn lifecycle** — gap. Codex never publishes `agentState.turnActive`. Wire the codex task lifecycle to publish it, matching the visible primitive Claude's `Session.setTurnActive(...)` produces.
3. **Permission-prompt notification** — gap. Codex's permission handler updates `agentState.requests` but does NOT fire `sendPushEvent({ kind: 'permission', ... })`. Wire it, matching Claude's `permissionHandler.ts:222-231`.

Deferred-switch protocol on codex remains explicitly out of scope per `packages/happy-cli/AGENTS.md` "Codex exclusion" and `.ralph/jobs/preserve-turn-on-mode-switch/plan.md`.

## Verified findings (file:line)

### Claude side (parity baseline)

- `packages/happy-cli/src/claude/session.ts:125-131` — `setTurnActive(turnActive)` mutates `this.turnActive` and calls `this.client.updateAgentState(s => ({ ...s, turnActive }))`. The only AgentState-visible side effect of `onTurnStarted`/`onTurnCompleted`.
- `packages/happy-cli/src/claude/session.ts:152-161` — `onTurnStarted` sets active true and awaits `turnStartCallbacks`; `onTurnCompleted` sets active false, awaits `turnCompleteCallbacks`, and runs the ledger idle hook.
- `packages/happy-cli/src/claude/session.ts:199-201` — `onNotification` just awaits `notificationCallbacks`. No agent-state mutation, no envelope, no boundary. Only consumer in the tree is the local-launcher's deferred-switch waker.
- `packages/happy-cli/src/claude/runClaude.ts:265-317` — hook server registers `onSessionHook`/`onCompactHook`/`onUserPromptSubmitHook`/`onStopHook`/`onNotificationHook`. The last three call `currentSession?.onTurnStarted()`/`onTurnCompleted()`/`onNotification()` respectively (after a `currentMode === 'remote'` short-circuit).
- `packages/happy-cli/src/claude/utils/permissionHandler.ts:222-231` — Claude's `PermissionHandler` fires `this.session.client.sendPushEvent({ kind: 'permission', data: { sessionId, requestId, tool, type: 'permission_request', provider: 'claude' } })` BEFORE writing `agentState.requests` for the pending-request path. This is the real "session.onNotification()-equivalent envelope" the audit-doc sub-gap is about — it is a `push-event`, not an `onNotification` callback.

### Codex side (current state)

- `packages/happy-cli/src/codex/runCodex.ts:159-164` — initial `state` comes from `createSessionMetadata({ flavor: 'codex', ... })`, which writes `{ controlledByUser: false }` (`packages/happy-cli/src/utils/createSessionMetadata.ts:73-75`). `turnActive` is never seeded and never updated; it stays `undefined` for the whole codex session lifecycle.
- `packages/happy-cli/src/codex/runCodex.ts:777-814` — the event handler currently:
  - logs a `messageBuffer` status line for `task_started`/`task_complete`/`turn_aborted`,
  - toggles a local `thinking` boolean and pings `session.keepAlive(thinking, 'remote')` when the flag changes.
  - There is NO `session.updateAgentState((s) => ({ ...s, turnActive: ... }))` on any of these branches.
- `packages/happy-cli/src/codex/runCodex.ts:723-743` — `client.setApprovalHandler(async (params) => {...})` delegates to `permissionHandler.handleToolCall(callId, toolName, input)` and returns its `decision`. No push event is emitted here.
- `packages/happy-cli/src/codex/utils/permissionHandler.ts:69-108` — `CodexPermissionHandler.handleToolCall`:
  - Auto-approval branch: writes `agentState.completedRequests[callId]` and returns `{ decision: 'approved' }` synchronously — no push event (correct: auto-approved is silent).
  - Pending branch: stores the request in `pendingRequests`, calls `this.addPendingRequestToState(...)` (which writes `agentState.requests[callId]`), and awaits an external resolution via the `'permission'` RPC handler. **No `sendPushEvent` call.** This is the parity gap.
- `packages/happy-cli/src/utils/BasePermissionHandler.ts:46-57` — `this.session: ApiSessionClient`. So `this.session.sendPushEvent({ ... })` is the correct call shape in codex (no `.client` indirection like Claude's wrapper).
- `packages/happy-cli/src/codex/runCodex.ts:845-863` — `context_compacted` event already fires `session.sendContextBoundary({ kind: 'autocompact' | 'compact', triggeredBy: 'system' | 'user', at })` using `userTriggeredCompactInFlight`. SHIPPED.

### Wire / consumer surface

- `packages/happy-cli/src/api/types.ts:356` — `AgentState.turnActive?: boolean | null | undefined`.
- `packages/happy-app/sources/sync/storageTypes.ts:112` — `turnActive: z.boolean().nullish()` on the mobile-app side. Round-tripped.
- `packages/happy-app/sources/-session/SessionView.tsx:59,391` — the app consumes `session.agentState?.turnActive === true` for the "send when idle" composer gating BUT only after a `flavor === 'claude' && getSessionMode(session) === 'local'` short-circuit. So codex's `agentState.turnActive` publication is **not currently rendered through this UI path** — wiring it is parity in the cli-wire, not an immediate app-side behavior change.
- `packages/happy-agent/src/monitor.ts:99-106` — `classifySession(metadata, agentState, ledgerRecords)` reads `meta?.turnActive` (metadata, not agentState). Claude's `setTurnActive` also writes to AgentState, not metadata — so the monitor's `turnActive` branch is never hit by Claude either. Monitor falls back to `state?.controlledByUser === true || getRequestIds(agentState).length > 0`. Implication: wiring codex `agentState.turnActive` does NOT change monitor classification today. A monitor fix (read from agentState in addition to metadata) is a separate concern.
- `packages/happy-cli/src/api/apiSession.ts:913-940` — `sendPushEvent({ kind: 'done' | 'permission' | 'question', data?: Record<string, unknown> })` is fire-and-forget; returns early if `!this.socket`. Safe to call from inside the permission handler without try/catch.

## Tests scaffolding

- `packages/happy-cli/src/codex/runCodex.contextCompacted.test.ts` — full-runCodex vitest harness with mocked `CodexAppServerClient` exposing the registered event handler. The `mockSession` already has `updateAgentState` and `sendPushEvent` vi.fn()s and an `eventHandler` capture. This is the right shape for a new `runCodex.turnLifecycle.test.ts` that drives `task_started`/`task_complete`/`turn_aborted` and asserts the `updateAgentState` call sequence.
- `packages/happy-cli/src/codex/__tests__/permissionHandler.test.ts` — unit-test harness for `CodexPermissionHandler` with a synthesized `ApiSessionClient`. The right shape for a new test asserting `sendPushEvent` is called with the expected `{ kind: 'permission', data: { provider: 'codex', ... } }` payload for the non-auto-approved path AND not called for the auto-approved path (e.g. `change_title`).

## Rubber-duck corrections applied

Three corrections from the rubber-duck pass that this plan reflects:

1. The "session.onNotification()-equivalent envelope" in the task spec actually refers to the `sendPushEvent({ kind: 'permission', provider: ... })` Claude already fires alongside `addPendingRequestToState`. NOT `session.onNotification()` itself (which is a deferred-switch waker with no codex analog).
2. `agentState.turnActive: false` publication on `task_complete`/`turn_aborted` must be UNCONDITIONAL — placing it inside the existing `if (thinking)` block would leave codex stuck-true after a duplicate/out-of-order/reconnect-without-task_started event.
3. The `happy-agent` `monitor.ts` consumer reads `meta?.turnActive` (metadata) not `state?.turnActive` (agentState). Codex's `agentState.turnActive` publication therefore does NOT change `classifySession` behavior today. Acknowledged as out-of-scope; a follow-up monitor fix is suggested.

## Consolidated file list

### Files to modify (production code)

- `packages/happy-cli/src/codex/runCodex.ts` — add `session.updateAgentState((s) => ({ ...s, turnActive: true }))` in `task_started` branch and `(s) => ({ ...s, turnActive: false })` in `task_complete`/`turn_aborted` branch (unconditional on completion). Place immediately after the existing thinking-toggle block (~line 814) and BEFORE the `agent_reasoning_*` branches. Do NOT move the early `mcpNotificationConsumer.handle(...)` or `agentTreeState.applyEvent(...)` calls at the top of the handler — those are ordering-sensitive (see `runCodex.ts:749-759` comments).
- `packages/happy-cli/src/codex/utils/permissionHandler.ts` — in the pending-request branch of `handleToolCall`, fire `this.session.sendPushEvent({ kind: 'permission', data: { sessionId, requestId, tool, type: 'permission_request', provider: 'codex' } })` BEFORE `addPendingRequestToState(...)`, matching Claude's emit-then-update ordering at `claude/utils/permissionHandler.ts:222-238`.

### Files to modify (test scaffold)

- `packages/happy-cli/src/codex/__tests__/permissionHandler.test.ts` — extend `createSessionMock()` (lines 10-25) to add `sendPushEvent: vi.fn()` and `sessionId: 'sess-1'` to the returned `session` object. WITHOUT this extension, the existing pending-request tests at lines 47-65, 67-80, and 82-95 will fail with `sendPushEvent is not a function` once the production change lands. The existing test assertions need not change — the new mock field is just satisfying the production-code call. (Optionally, the existing pending-request tests can add `expect(session.sendPushEvent).toHaveBeenCalled()` assertions for extra coverage, but the new `permissionHandler.pushEvent.test.ts` covers that case explicitly.)

### Files to add (tests)

- `packages/happy-cli/src/codex/runCodex.turnLifecycle.test.ts` — vitest, modeled on `runCodex.contextCompacted.test.ts`. The mock pattern from `runCodex.contextCompacted.test.ts` already exposes `updateAgentState: vi.fn()` and the registered `eventHandler` via `mocks.getEventHandler()` — directly reusable. The new test asserts `updateAgentState` mutator produces `turnActive: true` on `task_started` and `turnActive: false` on each of `task_complete`/`turn_aborted` (separate it cases). One additional case: a `task_complete` arriving with no preceding `task_started` (out-of-order) still publishes `turnActive: false`. **Assertion shape:** capture all `updateAgentState(mutator)` calls into an array, apply the mutators in order to a base state of `{ controlledByUser: false }`, and assert the final state's `turnActive` — NOT "last call" or "Nth call" assertions, which would be brittle if the event handler later adds unrelated state mutations on the same events.
- `packages/happy-cli/src/codex/__tests__/permissionHandler.pushEvent.test.ts` — vitest, modeled on the existing `__tests__/permissionHandler.test.ts`. **The new test file's `createSessionMock()` MUST include `sendPushEvent: vi.fn()` and `sessionId: 'sess-1'`** on the returned session shape. Asserts `sendPushEvent` was called once with the right payload for a non-auto-approved tool name (use `CodexBash`, matching the `runCodex.ts:724` exec mapping); not called at all for an auto-approved name like `change_title`. Pending-Promise cleanup follows the existing pattern: `const pending = handler.handleToolCall(...); ... handler.abortAll(); await expect(pending).resolves.toEqual({ decision: 'abort' });`.

### Files to update (docs)

- `plans/codex-agent-parity-audit.md` — Gap 4 section (lines ~131-160):
  - Flip status header from "Auto-compact context-boundary parity SHIPPED" to "Auto-compact + turn-lifecycle + permission-push notification SHIPPED. Deferred-switch protocol + renderable permission-prompt boundary remain deferred."
  - Update the "Remaining sub-gaps" subsection: turn-lifecycle and permission-push are no longer deferred (only the deferred-switch protocol and the renderable-boundary discriminator remain).
  - Update the "Current state: Codex side, post-ship" paragraph to reflect new emissions.

### Files NOT to modify

- `packages/happy-cli/src/utils/BasePermissionHandler.ts` — keep the `sendPushEvent` emission inside `CodexPermissionHandler` rather than `BasePermissionHandler`, to avoid scope-creep into Gemini parity (separate audit work).
- `packages/happy-cli/src/utils/createSessionMetadata.ts` — do NOT pre-seed `turnActive: false` in initial state. Codex's first lifecycle event is the authority; seeding could mask a wiring regression.
- `packages/happy-wire/src/sessionProtocol.ts` — no new `sessionEventSchema` discriminator. The audit doc punts the renderable-boundary path; this plan does not unpunt it.
- `packages/happy-agent/src/monitor.ts` — the `meta?.turnActive` vs `state?.turnActive` mismatch is pre-existing and orthogonal. Flag in the plan's "Open questions / follow-ups" section.
