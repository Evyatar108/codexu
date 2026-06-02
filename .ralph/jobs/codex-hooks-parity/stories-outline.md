# Stories Outline — codex-hooks-parity

Single-commit task; stories below are implementation phases inside that commit, not separable shipments. They map 1:1 to the "Preliminary Story Decomposition" in `plan.md`.

## Story A — Turn-lifecycle agentState.turnActive publication

**Files touched:**
- `packages/happy-cli/src/codex/runCodex.ts` — add two `session.updateAgentState(...)` calls inside the existing `setEventHandler` body (after the existing thinking-toggle block ~line 814, before the `agent_reasoning_*` branches).
- `packages/happy-cli/src/codex/runCodex.turnLifecycle.test.ts` — new vitest fixture, modeled on `runCodex.contextCompacted.test.ts` (which already exposes the registered `eventHandler` via `mocks.getEventHandler()` and `updateAgentState: vi.fn()`).

**Acceptance criteria** (full text in `plan.md`):
- AC1 — `task_started` mutator publishes `turnActive: true` starting from `{ controlledByUser: false }`.
- AC2 — `task_complete` (no preceding `task_started`) still publishes `turnActive: false` — proves unconditional completion publication.
- AC3 — `task_started` → `turn_aborted` sequence publishes `true` then `false` in order.

**Assertion shape (important):** capture all `updateAgentState(mutator)` calls into an array, apply the mutators in order to a base state, then assert the final state's `turnActive`. Do NOT assert on "last call" or "Nth call" indices — `runCodex.ts` is high-traffic and a future event-handler addition could insert unrelated `updateAgentState` calls on the same events and break a position-based test despite correct lifecycle behavior.

**Verification command:**
```bash
pnpm --filter happy exec vitest run src/codex/runCodex.turnLifecycle.test.ts
```

(Note: `--filter happy`, not `--filter happy-cli` — see plan.md "Note on `pnpm --filter`".)

**Effort:** ~10 LoC production + ~80 LoC test + boilerplate mocks. ~30 min.

**Risks:**
- The `updateAgentState` call site is inside the same `setEventHandler` body as several other event branches and adjacent in-flight ralph work (recent `c944d758` codex-channels-option-b ship and `e845ffc5` notification consumer both touched this file). Risk: rebase conflicts. Mitigation: lifecycle hunk goes after the thinking-toggle block specifically (not at the top of the handler), keeping it away from the `mcpNotificationConsumer.handle(...)` / `agentTreeState.applyEvent(...)` cluster at the start.
- The completion publication is unconditional (no `if (thinking)` guard). Risk: if a future change adds redundant `task_complete` events on every event tick, the test would not catch the perf regression but `vitest run` time would. Mitigated by the rubber-duck pass identifying this exact failure mode (stuck-true on missed `task_started`) as the reason for unconditional publish.

## Story B — Permission push-event for pending requests

**Files touched:**
- `packages/happy-cli/src/codex/utils/permissionHandler.ts` — one `this.session.sendPushEvent(...)` call before `addPendingRequestToState(...)` in the pending-request branch of `handleToolCall`.
- `packages/happy-cli/src/codex/__tests__/permissionHandler.test.ts` — **extend the existing `createSessionMock()` helper** (lines 10-25) to add `sendPushEvent: vi.fn()` and `sessionId: 'sess-1'`. Without this extension, the existing pending-request tests at lines 47-65, 67-80, and 82-95 fail with `sendPushEvent is not a function` once the production change lands.
- `packages/happy-cli/src/codex/__tests__/permissionHandler.pushEvent.test.ts` — new vitest fixture for the explicit push-event assertion. Its own `createSessionMock()` MUST also include `sendPushEvent: vi.fn()` and `sessionId: 'sess-1'`.

**Acceptance criteria** (full text in `plan.md`):
- AC4 — `sendPushEvent` NOT called for auto-approved tool `change_title`; called exactly once for a non-auto-approved tool with payload `{ kind: 'permission', data: { sessionId: 'sess-1', requestId: 'call_exec_123', tool: 'CodexBash', type: 'permission_request', provider: 'codex' } }`. Use `CodexBash` (not `Bash`) because that matches the `runCodex.ts:724` exec-type mapping.

**Pending-Promise cleanup pattern (required):** follow the existing test at `__tests__/permissionHandler.test.ts:47-65`:
```ts
const pending = handler.handleToolCall('call_exec_123', 'CodexBash', { command: 'ls' });
expect(sendPushEventMock).toHaveBeenCalledTimes(1);
expect(sendPushEventMock).toHaveBeenCalledWith({ /* ... */ });
handler.abortAll();
await expect(pending).resolves.toEqual({ decision: 'abort' });
```
The `abortAll() + await ... resolves` cleanup is required so the Promise resolver doesn't leak into the test runner.

**Verification commands:**
```bash
# New push-event test
pnpm --filter happy exec vitest run src/codex/__tests__/permissionHandler.pushEvent.test.ts

# Regression: existing permission handler tests with the extended mock
pnpm --filter happy exec vitest run src/codex/__tests__/permissionHandler.test.ts
```

**Effort:** ~10 LoC production + ~60 LoC new test + ~3 LoC mock extension. ~30 min.

**Risks:**
- The push-event ordering matters: emit BEFORE `addPendingRequestToState` to match Claude's `permissionHandler.ts:222-238`. Reversed ordering wouldn't change visible behavior today but could confuse a future server-side consumer that expects the push as the "create" signal and the state mutation as the "update" signal. Mitigated by deliberate ordering choice + comment-in-code.
- The auto-approval gate is at the top of `handleToolCall` (line 74); putting the push inside the pending-Promise branch (line 95) inherently keeps it gated. Risk: if a future refactor moves auto-approve logic into the Promise body, the gate could be lost. Mitigated by the new test fixture explicitly asserting the auto-approval case is push-silent.
- **Mock extension is a load-bearing scope item** for Story B. Forgetting it breaks the existing permission handler test suite (AC5).

## Story C — Audit-doc bookkeeping + cross-package verification + single-commit ship

**Files touched:**
- `plans/codex-agent-parity-audit.md` — Gap 4 status header (line 133), "Current state: Codex side, post-ship" paragraph (line 144), "Remaining sub-gaps" subsection (lines 146-148), Effort (152), Severity (154), and historical "Proposed fix site" footnote (150). Full edit map in `plan.md` § "Change 3 — Audit-doc bookkeeping". The doc edits REWRITE the stale claims about turn-lifecycle and permission-flow; they do NOT append to them.

**Acceptance criteria** (full text in `plan.md`):
- AC5 — `runCodex.contextCompacted.test.ts` continues passing (auto-compact regression bar) AND the existing `__tests__/permissionHandler.test.ts` continues passing (proves Story B's mock extension landed).
- AC6 — Cross-package typecheck green: `pnpm -r typecheck` exit 0.
- AC7 — Audit doc reflects ship: `git diff plans/codex-agent-parity-audit.md` shows the Gap 4 section reshaped per plan.md.

**Verification commands (single commit covers all three changes):**
```bash
# Full happy-cli vitest suite covers AC1-AC5 in one go
pnpm --filter happy exec vitest run

# Cross-package typecheck (AC6)
pnpm -r typecheck

# Audit doc sanity (AC7) — read the diff
git diff plans/codex-agent-parity-audit.md
```

**Effort:** ~30 LoC doc edits + suite run (~2-5 min) + typecheck run (~30s-1min) + commit. ~20 min.

**Risks:**
- **Cannot reference the commit's own SHA in the same commit's diff.** The doc MUST use stable wording like "SHIPPED in this implementation commit" — see plan.md "Single-commit SHA discipline" note. The actual SHA is recorded post-merge by the bookkeeper in `.ralph-overview/data.json` `shipManifest.commits[]`.
- Single-commit constraint per the task spec. Risk: if pre-commit hooks fail mid-attempt, partial state could leak into a follow-up commit. Mitigated by `git status` check before commit and `git reset --soft HEAD~1` recovery if needed.
