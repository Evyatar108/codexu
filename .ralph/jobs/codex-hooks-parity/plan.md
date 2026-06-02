# Implementation Plan: codex-hooks-parity (remaining halves)

<!-- ralph-meta {"overviewTaskId":"codex-hooks-parity"} -->

## Summary

Wire the remaining two halves of Gap 4 in `plans/codex-agent-parity-audit.md`. Auto-compact context-boundary parity shipped earlier (`620d31a8`); this plan ships:

1. **Turn-lifecycle parity** — publish `agentState.turnActive: true` on codex `task_started` and `false` on `task_complete` / `turn_aborted`, matching the visible primitive Claude's `Session.setTurnActive` produces.
2. **Permission-prompt push notification parity** — fire `session.sendPushEvent({ kind: 'permission', data: { ..., provider: 'codex' } })` in codex's permission handler pending-request branch, matching Claude's `permissionHandler.ts:222-231` emit-then-update ordering.

Deferred-switch protocol on codex remains explicitly out of scope per `packages/happy-cli/AGENTS.md` "Codex exclusion"; no `request-switch` / `cancel-pending-switch` RPCs and no `Session`-wrapper introduction on the codex path.

The two changes land as **a single commit** on `ralph/codex-hooks-parity`, with cross-package typecheck green and two new vitest fixtures (one per event path). The audit doc gets flipped to mark these halves shipped.

## Goal

A `happy codex` session has parity with `happy claude` on the two CLI-wire side effects of Claude's hook system that previously had no codex counterpart:

- The `agentState.turnActive` field, which any future consumer (mobile-app composer state, happy-agent monitor, dashboard "active" indicators) can rely on as a uniform agent-busy signal regardless of provider.
- The `push-event` of `kind: 'permission'`, which is the wire equivalent of Claude's `Notification` hook driving operator-visible permission-pending notifications.

Crucially, this plan does NOT add a `Session` wrapper for codex, does NOT introduce `request-switch`/`cancel-pending-switch` RPCs, and does NOT add a new `sessionEventSchema` discriminator. It is a strict additive parity ship using the existing `ApiSessionClient` surface.

## Scope

### In scope

- **Codex turn-lifecycle agent-state publication** in `packages/happy-cli/src/codex/runCodex.ts`. Two `session.updateAgentState(...)` calls, both inside the existing `setEventHandler` body. Unconditional on completion (no `if (thinking)` guard) to avoid stuck-true on duplicate or reattach events.
- **Codex permission push-event** in `packages/happy-cli/src/codex/utils/permissionHandler.ts`. One `this.session.sendPushEvent(...)` call in the pending-request branch of `handleToolCall`, mirroring Claude's emit-then-update ordering. Auto-approved tools (e.g., `change_title`) MUST NOT trigger the push, matching Claude's behavior (Claude's `permissionHandler.ts:222` is also gated by the same shouldAutoApprove path).
- **Two new vitest fixtures**:
  - `packages/happy-cli/src/codex/runCodex.turnLifecycle.test.ts` — drives the runCodex event handler with `task_started` / `task_complete` / `turn_aborted` sequences, asserts the `updateAgentState` mutator produces the expected `turnActive` transitions, including the out-of-order edge case.
  - `packages/happy-cli/src/codex/__tests__/permissionHandler.pushEvent.test.ts` — drives `CodexPermissionHandler.handleToolCall` for both an auto-approved tool name and a non-auto-approved one, asserts `sendPushEvent` is called exactly once with the right payload for the pending path and never for the auto-approval path.
- **One audit-doc update**: flip `plans/codex-agent-parity-audit.md` Gap 4 status header + remaining-sub-gaps paragraph to reflect what's now shipped.

### Out of scope (deferred, with rationale)

- **Deferred-switch protocol on codex.** AGENTS.md "Codex exclusion" is unambiguous: codex has no Claude-style `Session`/local-launcher/remote-launcher split, so the deferred-switch concept does not apply. A purpose-built Codex deferred-takeover model is tracked separately. Calling `currentSession?.onTurnStarted()` literally would crash on codex because codex's `session` is `ApiSessionClient`, not the `Session` wrapper.
- **Renderable permission-prompt boundary.** The audit doc punts on introducing a `sessionEventSchema.permission-prompt` discriminator because it would also require an app-side `BoundaryDivider` renderer. The `push-event` path this plan adds is the operator-visible notification surface; the chat-rendered boundary is a separate ticket.
- **`happy-agent` monitor `turnActive` consumer alignment.** Monitor reads `meta?.turnActive` (metadata) at `packages/happy-agent/src/monitor.ts:102`; Claude and (after this ship) codex both publish `state?.turnActive` (agentState). Monitor's `turnActive` branch is therefore never triggered for either provider. This is a pre-existing bug orthogonal to codex-hooks-parity and is flagged as a follow-up; fixing it inside this plan would expand scope and risk monitor-side regressions.
- **Gemini permission-push parity.** Gemini's `GeminiPermissionHandler` (extends the same `BasePermissionHandler`) also lacks the `sendPushEvent`. Moving the push into the base class would land gemini parity for free, but the task is scoped to codex. Flagged as a follow-up.
- **Auto-compact codex-internal compaction signal.** Already shipped in `620d31a8`. Regression test (`runCodex.contextCompacted.test.ts`) is in the suite and must stay green.

## Approach

### Change 1 — Turn-lifecycle agentState.turnActive

In `packages/happy-cli/src/codex/runCodex.ts`, locate the existing `setEventHandler` body around lines 745-882. The current code has two `task_started`/`task_complete`/`turn_aborted` clusters:

- Lines 777-797 — `messageBuffer.addMessage(...)` for UI status.
- Lines 799-814 — `thinking` toggle + `keepAliveIfOpen()` ping + `diffProcessor.reset()` on end.

Add a third site, right after the `thinking` cluster, that publishes `agentState.turnActive`:

```typescript
if (msg.type === 'task_started') {
    session.updateAgentState((currentState) => ({
        ...currentState,
        turnActive: true,
    }));
}
if (msg.type === 'task_complete' || msg.type === 'turn_aborted') {
    session.updateAgentState((currentState) => ({
        ...currentState,
        turnActive: false,
    }));
}
```

The completion publication is **deliberately not guarded by `if (thinking)`** so that a duplicate `task_complete`, an out-of-order completion (codex re-emits on reattach), or a `turn_aborted` without a preceding `task_started` still leaves `turnActive: false` published. The redundant write on the no-op path is a one-line agent-state mutator with optimistic concurrency in `updateAgentState`; cost is negligible.

Placement: immediately after the existing thinking-toggle block (after line 814) and before the `agent_reasoning_*` branches. This keeps lifecycle-related code grouped without disturbing the `mcpNotificationConsumer.handle(...)` / `agentTreeState.applyEvent(...)` ordering at the top of the handler.

### Change 2 — Permission push notification

In `packages/happy-cli/src/codex/utils/permissionHandler.ts`, locate `CodexPermissionHandler.handleToolCall` (lines 69-108). The pending-request branch (line 95 onward) currently:

1. Returns `new Promise<PermissionResult>((resolve, reject) => { ... })`.
2. Inside the promise: `this.pendingRequests.set(toolCallId, { resolve, reject, toolName, input })`.
3. Calls `this.addPendingRequestToState(toolCallId, toolName, input)`.

Add the push-event call **before** `addPendingRequestToState`, mirroring Claude's emit-then-update ordering at `claude/utils/permissionHandler.ts:222-238`:

```typescript
return new Promise<PermissionResult>((resolve, reject) => {
    this.pendingRequests.set(toolCallId, {
        resolve,
        reject,
        toolName,
        input,
    });

    // Parity with Claude's permission notification (claude/utils/permissionHandler.ts:222-231).
    // Provider-tagged push-event so the app can route a notification for codex
    // permission prompts the same way it routes Claude permission prompts.
    this.session.sendPushEvent({
        kind: 'permission',
        data: {
            sessionId: this.session.sessionId,
            requestId: toolCallId,
            tool: toolName,
            type: 'permission_request',
            provider: 'codex',
        },
    });

    this.addPendingRequestToState(toolCallId, toolName, input);

    logger.debug(`${this.getLogPrefix()} Permission request sent for tool: ${toolName} (${toolCallId})`);
});
```

The auto-approval branch (lines 74-93) MUST stay push-event-free — auto-approved tools like `change_title` are silent for the operator; firing a permission notification for them would create spurious mobile-app alerts. The existing `if (this.shouldAutoApprove(toolName, toolCallId))` early-return at line 74 is the natural gate.

`sendPushEvent` is fire-and-forget (`apiSession.ts:913` returns early if `!this.socket`); no try/catch needed.

### Change 3 — Audit-doc bookkeeping

Update `plans/codex-agent-parity-audit.md` Gap 4 (lines ~131-160) as the final hunk of the same commit:

- **Status header (line 133)** — REPLACE entirely (not append). Change from:
  > **Status:** Auto-compact context-boundary parity SHIPPED (commit on `ralph/codex-hooks-parity`). Turn-lifecycle (`onTurnStarted`/`onTurnCompleted`) and `Notification`-permission parity remain deferred per the codex deferred-switch exclusion in `packages/happy-cli/AGENTS.md` — see "Remaining sub-gaps" below.

  to:
  > **Status:** Auto-compact context-boundary parity SHIPPED in `620d31a8`. Turn-lifecycle (`agentState.turnActive` publication on `task_started`/`task_complete`/`turn_aborted`) and permission-push notification (`sendPushEvent({ kind: 'permission', provider: 'codex', ... })` in the codex permission handler pending-request branch) SHIPPED in this implementation commit. Deferred-switch protocol on codex remains deferred per `packages/happy-cli/AGENTS.md` "Codex exclusion"; renderable permission-prompt context-boundary (new `sessionEventSchema` discriminator + app `BoundaryDivider` renderer) remains deferred — see "Remaining sub-gaps" below.

- **"Current state: Codex side, post-ship" paragraph (line 144)** — REWRITE the paragraph in place. The existing prose claims turn-lifecycle "still only toggles `thinking`; no `session.onTurnStarted()`/`onTurnCompleted()` analog is wired" and "Permission-request events still flow only through `setApprovalHandler` without a separate `sendContextBoundary` signal" — both claims are FALSE post-ship and must be removed, not appended-to. Rewritten paragraph (single replacement of the whole "Codex side, post-ship" sentence onward, preserving the auto-compact wire description):
  > *Codex side, post-ship:* `runCodex.ts` event handler fans `context_compacted` events through `session.sendContextBoundary({ kind: 'autocompact', triggeredBy: 'system', at: Date.now() })`. The fan-out is wire-protocol-version-agnostic: `codexAppServerClient.handleRawNotification` translates the v2 `thread/compacted` notification (body `{ threadId, turnId }`) into a legacy-shape `{ type: 'context_compacted', thread_id, threadId, turn_id, turnId }` event, and the legacy `codex/event` path forwards `EventMsg::ContextCompacted` (wire tag `context_compacted`) verbatim. Both paths reach the same `sendContextBoundary` call site. Turn-lifecycle events now publish `agentState.turnActive` (true on `task_started`, false on `task_complete`/`turn_aborted`; the completion publication is unconditional so duplicate, out-of-order, or reattach events never leave the field stuck-true). The codex permission handler (`packages/happy-cli/src/codex/utils/permissionHandler.ts`) fires `session.sendPushEvent({ kind: 'permission', data: { sessionId, requestId, tool, type: 'permission_request', provider: 'codex' } })` for non-auto-approved tool calls, mirroring Claude's `permissionHandler.ts:222-231` emit-then-update ordering. Auto-approved tools (e.g., `change_title`) remain push-silent. The deferred-switch protocol (`Session.pendingSwitch` / `request-switch` RPCs) is intentionally NOT wired because codex has no Claude-style local-launcher/Session split (see "Codex exclusion" in `packages/happy-cli/AGENTS.md`). Permission-request events also do not emit a `sendContextBoundary` — introducing a renderable `permission-prompt` boundary would require a new `sessionContextBoundaryKindSchema` enum kind plus an app `BoundaryDivider` renderer; tracked separately.

- **"Remaining sub-gaps (deferred)" subsection (lines 146-148)** — rewrite the two bullets to reflect what's still deferred:
  - Drop the "Turn lifecycle" bullet entirely (no longer deferred at the `agentState.turnActive` level; deferred-switch protocol stays deferred under a separate bullet).
  - Reframe "Permission-request `Notification` parity" as "Renderable permission-prompt boundary" — the push-event half just landed; what remains deferred is the renderable chat divider, which would need a new `sessionEventSchema` kind and an app renderer.
  - Add a new "Deferred-switch protocol on codex" bullet (one sentence) pointing to `.ralph/jobs/preserve-turn-on-mode-switch/plan.md`.

- **"Effort" (line 152)** — append: "Turn-lifecycle + permission-push shipped (~1h)."

- **"Severity" (line 154)** — flip to: "Auto-compact + turn-lifecycle + permission-push Low post-ship. Deferred-switch protocol stays Medium for v2."

- **"Proposed fix site (historical)" (line 150)** — append a one-sentence acknowledgment that the turn-lifecycle and permission-push halves are now also wired on the codex side using the existing `ApiSessionClient` surface (no `Session` wrapper, no new schema).

Do NOT remove or rewrite the historical "Ralph-command shape" section — it's an audit artifact.

## Acceptance Criteria

Each criterion is verifiable with a single command. AC1–AC4 are the test-gated correctness bar; AC5–AC6 are the build-gated regression bar; AC7 is the doc-update bar.

> **Note on `pnpm --filter`**: the happy-cli package name is `"happy"` (see `packages/happy-cli/package.json`), NOT `"happy-cli"`. `pnpm --filter happy-cli ...` matches no projects and exits 0 silently — easy to mistake for a green run. Always use `pnpm --filter happy ...`. Paths inside `pnpm --filter happy exec vitest run <path>` are package-relative (rooted at `packages/happy-cli/`), so the file path inside the `exec` is `src/codex/...`, not `packages/happy-cli/src/codex/...`.

1. **AC1 (turn-lifecycle: task_started publishes turnActive=true).** Running `pnpm --filter happy exec vitest run src/codex/runCodex.turnLifecycle.test.ts` from the repo root passes a case named (or equivalent to) "publishes turnActive: true on task_started". The test captures every `updateAgentState` mutator call into a list, applies them in order to a base state of `{ controlledByUser: false }`, and asserts that after replaying the captured mutators following a single `{ type: 'task_started', turn_id: 'turn-1' }` event, the resulting state contains `turnActive === true`. (Replay-all-and-assert avoids brittleness from unrelated `updateAgentState` calls that may be added to the event handler in future commits.)

2. **AC2 (turn-lifecycle: task_complete publishes turnActive=false, unconditional).** The same test file passes a case that drives `{ type: 'task_complete', turn_id: 'turn-1' }` with NO preceding `task_started` (so `thinking` starts and remains `false`), captures and replays all `updateAgentState` mutators, and asserts the resulting state contains `turnActive === false`. This proves the completion publication is not guarded by `if (thinking)`.

3. **AC3 (turn-lifecycle: turn_aborted publishes turnActive=false).** A third case in the same file drives `{ type: 'task_started', turn_id: 'turn-2' }` then `{ type: 'turn_aborted', turn_id: 'turn-2' }` in order, captures and replays all mutators, and asserts the FINAL replayed state has `turnActive === false`. An intermediate replay after only the first event asserts `turnActive === true`.

4. **AC4 (permission-push: fires on pending, silent on auto-approve).** Running `pnpm --filter happy exec vitest run src/codex/__tests__/permissionHandler.pushEvent.test.ts` passes two cases:
   - Auto-approve case: `await handler.handleToolCall('call_change_title_1', 'change_title', { title: 'x' })` — asserts `sendPushEvent` was NOT called.
   - Pending case (mirrors the existing `keeps non-safe tools pending` test pattern at `__tests__/permissionHandler.test.ts:47-65` for proper promise cleanup):
     ```ts
     const pending = handler.handleToolCall('call_exec_123', 'CodexBash', { command: 'ls' });
     expect(sendPushEventMock).toHaveBeenCalledTimes(1);
     expect(sendPushEventMock).toHaveBeenCalledWith({
         kind: 'permission',
         data: {
             sessionId: 'sess-1',  // matches the createSessionMock sessionId
             requestId: 'call_exec_123',
             tool: 'CodexBash',
             type: 'permission_request',
             provider: 'codex',
         },
     });
     handler.abortAll();
     await expect(pending).resolves.toEqual({ decision: 'abort' });
     ```
     The `handler.abortAll()` + `await ... resolves` cleanup pattern is required to avoid leaking a dangling Promise in the test runner (and matches the existing tests in the same file). Note `CodexBash` (not `Bash`) matches the toolName mapped at `runCodex.ts:724-728` for exec-type approvals.

5. **AC5 (regression: auto-compact path still green AND the existing CodexPermissionHandler suite still green).** Running:
   - `pnpm --filter happy exec vitest run src/codex/runCodex.contextCompacted.test.ts` continues to pass both pre-existing cases (autocompact emit + negative case for unrelated events).
   - `pnpm --filter happy exec vitest run src/codex/__tests__/permissionHandler.test.ts` continues to pass ALL pre-existing cases. **This requires extending the existing `createSessionMock()` helper in that file to add `sendPushEvent: vi.fn()` and `sessionId: 'sess-1'`** — the production code change in Story B calls `this.session.sendPushEvent(...)` on the pending-request path, so cases like "keeps non-safe tools pending for user approval" (line 47) will throw `sendPushEvent is not a function` without the mock extension. The mock extension is part of Story B scope.

6. **AC6 (cross-package typecheck green).** From the repo root, `pnpm -r typecheck` returns exit code 0. (The happy-cli package script is named `typecheck` — see `packages/happy-cli/package.json`.) Required because both changes touch typed surfaces (`session.updateAgentState` callback signature and `session.sendPushEvent` payload shape).

7. **AC7 (audit-doc reflects ship).** `git diff plans/codex-agent-parity-audit.md` shows hunks that:
   - Rewrite the Gap 4 `**Status:**` line (line 133 in the pre-edit file) to mark turn-lifecycle and permission-push as SHIPPED in the implementation commit (use stable wording such as "SHIPPED in this implementation commit" — see "Single-commit SHA discipline" note below).
   - Rewrite the "Current state: Codex side, post-ship" paragraph (around line 144) so the stale claims that turn-lifecycle "still only toggles `thinking`" and permission requests "still flow only through `setApprovalHandler` without a separate `sendContextBoundary` signal" are REPLACED, not appended-to. The new paragraph must describe both new emissions explicitly.
   - Remove the "Turn lifecycle" bullet from the "Remaining sub-gaps (deferred)" subsection (lines ~146-148) and replace the "Permission-request `Notification` parity" bullet with a renamed "Renderable permission-prompt boundary" bullet (push half landed; renderable-divider half still deferred). Add a new "Deferred-switch protocol on codex" bullet pointing to `.ralph/jobs/preserve-turn-on-mode-switch/plan.md`.

### Single-commit SHA discipline

The task spec mandates a single commit. A commit cannot contain its own final SHA inside its own diff (the SHA changes when content changes), so the audit-doc edits MUST NOT reference the SHA. Use stable wording like "SHIPPED in this implementation commit" or "SHIPPED by the codex-hooks-parity implementation commit". The actual SHA is recorded post-merge by the bookkeeper in `.ralph-overview/data.json` `shipManifest.commits[]` — that's the canonical historical record, not the in-doc reference.

## Preliminary Story Decomposition

This work is small (~30 LoC production + ~120 LoC tests + ~30 LoC docs) and tightly coupled (the two changes share the same audit-doc update). One commit per the task spec. Decompose for **implementation phasing**, not parallel execution:

- **Story A — Turn-lifecycle wire + test.** Edit `runCodex.ts` to publish `agentState.turnActive`. Add `runCodex.turnLifecycle.test.ts`. Local vitest of just this file green. Satisfies AC1, AC2, AC3.
- **Story B — Permission push-event wire + test.** Edit `codex/utils/permissionHandler.ts` to fire `sendPushEvent`. Add `__tests__/permissionHandler.pushEvent.test.ts`. Local vitest of just this file green. Satisfies AC4.
- **Story C — Audit-doc update + full-package vitest + typecheck.** Apply the doc edits to `plans/codex-agent-parity-audit.md`. Run the full happy-cli vitest suite plus cross-package typecheck. Single commit with all three changes. Satisfies AC5, AC6, AC7.

Story A and Story B touch disjoint files and can be ordered either way. Story C is sequenced last because the audit-doc commit reference needs the implementation hunks to land first (or, equivalently, the SHA placeholder is filled in just before the final commit).

## Suggested Decomposition

This task is single-commit and small enough that **serial execution is preferred** — parallel decomposition would add coordination overhead that exceeds the implementation cost. The `suggested-decomposition.json` sidecar reflects this (one cluster covering all three stories).

If parallel execution were ever needed (e.g., a future amend that broke the changes into multiple commits), the natural split is Story A | Story B with Story C as a serial finalize step:

- Cluster 1 (parallel-safe): Story A (runCodex.ts + new lifecycle test file).
- Cluster 2 (parallel-safe, disjoint files): Story B (codex permission handler + new push-event test file).
- Cluster 3 (serial finalize, depends on 1 + 2): Story C (audit doc + suite typecheck + single commit).

## Open Questions / Follow-ups

The following are flagged in `research-brief.md` and are NOT addressed by this plan:

1. **happy-agent monitor `turnActive` consumer mismatch.** `monitor.ts:102` reads `meta?.turnActive` (metadata) instead of `state?.turnActive` (agentState). Claude and (after this ship) codex both publish to agentState. The monitor's `turnActive` branch is dead today; fixing it would benefit both providers and is the right home for a "uniform agent-busy classifier across providers" story.
2. **Gemini permission-push parity.** `GeminiPermissionHandler` (extends the same `BasePermissionHandler`) also lacks the `sendPushEvent` Claude has. A follow-up could either move the push into `BasePermissionHandler` (with a new abstract `getProvider()` method) or duplicate it in `GeminiPermissionHandler`. Doing it here would expand scope past codex parity.
3. **Renderable permission-prompt boundary.** Would need (a) a new `sessionEventSchema` discriminator (`permission-prompt` or similar), (b) an app `BoundaryDivider` renderer, and (c) a wire-test for cross-version compatibility. The audit doc explicitly punts this; it's the right shape for a future Gap 4 v2 ticket.
4. **Deferred-switch protocol on codex.** Tracked at `.ralph/jobs/preserve-turn-on-mode-switch/plan.md`. AGENTS.md "Codex exclusion" is the gate; lifting it requires a Codex `Session` wrapper or equivalent state-holder.

## Conflict / Sequencing Notes

- **Sequenced after** the earlier `ralph/codex-hooks-parity` autocompact ship (`620d31a8`) — already landed on main. No conflict.
- **Sequenced after** `codex-claude-md-autoload` and `codex-system-prompts` — both already landed per the task-spec conflict warning. No conflict in the files this plan touches.
- **Adjacent to** `Gap 5 — codex-slash-commands` (which depended on Gap 4's `context_compacted` plumbing and ALSO shipped at `a3f3d60e`). The slash-commands code shares the `userTriggeredCompactInFlight` flag in `runCodex.ts` but does not touch the turn-lifecycle event handler or the permission handler — no conflict.
- **Touches `packages/happy-cli/src/codex/runCodex.ts`.** Several other in-flight ralph jobs touch this file. Diff hunks for Story A are localized to a ~10-line window in the existing `setEventHandler` body and should rebase cleanly.

## Next Step

After this plan lands on `main`, the implementation handoff is:

```
/implement-with-ralph --from-plan .ralph/jobs/codex-hooks-parity/plan.md --autonomous
```

Single-commit bookkeeping: the lead should flip `.ralph-overview/data.json` `lifecycle` from `tracked` to `merged` AND append a `shipManifest` for this task once the impl commit lands on `origin/main`. The earlier `ac41c736` "partial ship" status (Gap 4 autocompact-only) is superseded; the new manifest should reference both the prior `620d31a8` autocompact commit AND this plan's impl commit as the full ship.
