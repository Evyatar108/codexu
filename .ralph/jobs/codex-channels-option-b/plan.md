# Plan — codex-channels-option-b (notifications-to-prompt-queue)

**Decision context (2026-06-01):** Operator chose **Option B** from the three options surfaced during plan-codex-channels Stage B decision:
- ❌ Option A: ship Claude-Code-parity `experimental["codex/channel"]` framing (deferred — narrower applicability than the named use cases need).
- ✅ Option B: thin "notifications-to-prompt-queue" consumer on top of Stage A's `EventMsg::McpServerNotification`, happy-cli only, zero codex/ Rust conflict surface (this plan).
- ❌ Option C: defer entirely (rejected — file-watcher / dynamic-tool consumption is a real near-term want).

Original `codex-channels` task entry will be flipped to `deferred` with regressionReason "Option B chosen 2026-06-01; Stage A already covers the named use cases. Reopen if external-user chat-bridge use case lands."

**Scope mandate (re-stated):** zero edits under `codex/external/repos/codex-patched/` and zero new overlay crates. This is purely a TypeScript consumer in `D:/harness-efforts/happy/packages/happy-cli/src/codex/`, consuming the already-shipped `EventMsg::McpServerNotification` / `EventMsg::McpSamplingRequest` events. No new MCP wire methods, no new capability key, no codex protocol bump.

This is a **plan-lite** deliverable per operator instruction — single self-review pass, no 5-reviewer `/plan-with-ralph` ceremony.

---

## 1 · What Stage A already gives us (today, no new work)

Stage A (shipped 2026-05-31) added two `EventMsg` variants on the codex event stream, observable on the codex app-server `codex/event` notification channel:

| Variant | Serde tag (wire) | Fields |
|---|---|---|
| `EventMsg::McpServerNotification` | `mcp_server_notification` | `server_name: string`, `kind: McpNotificationKind` (snake_case: `progress` / `cancelled` / `resource_updated` / `resource_list_changed` / `tool_list_changed` / `prompt_list_changed` / `logging_message`), `params: serde_json::Value` (untyped pass-through of the rmcp notification payload) |
| `EventMsg::McpSamplingRequest` | `mcp_sampling_request` | `server_name: string`, `request_id: RequestId`, `params: serde_json::Value` (raw `CreateMessageRequestParams`) |

Source of truth: `codex/external/repos/codex-patched/codex-rs/protocol/src/protocol.rs:2257-2292`. The EventMsg enum is `#[serde(tag = "type", rename_all = "snake_case")]` per line 1154, so the wire `type` discriminators are exactly `mcp_server_notification` / `mcp_sampling_request`.

Both variants are **feature-gated by `Feature::McpServerNotifications` (default off)** on the codex side. The consumer (this plan) does not enable the feature itself — the user/operator enables it through codex config when they want notifications routed. Until then, no events arrive and this consumer is a no-op.

The events already fan out to app-server clients (happy-cli included) automatically because the EventMsg `#[derive(Serialize)]` path forwards them through `codex/event` notifications. Verified: happy-cli already routes the full `EventMsg` stream through `client.setEventHandler((msg) => ...)` in `D:/harness-efforts/happy/packages/happy-cli/src/codex/runCodex.ts:428`. New EventMsg variants flow through that handler as `msg = { type: "mcp_server_notification", server_name, kind, params }` without any wire-side change.

What Stage A does **not** do: turn any of these events into a prompt the agent reads on its next turn. That last-mile — the "notifications-to-prompt-queue" semantics — is what this plan adds.

---

## 2 · Integration point in happy-cli's existing input queue

Already mapped (`runCodex.ts:150-187`):

```ts
const messageQueue = new MessageQueue2<EnhancedMode>(...);

session.onUserMessage((message) => {
    ...
    messageQueue.push(message.content.text, enhancedMode);
});
```

`messageQueue` is drained by the main loop at `runCodex.ts:569` via `messageQueue.waitForMessagesAndGetAsString(waitSignal)`. The codex turn-loop reads one batched user message at a time.

The Option-B feature is a **second producer** for that same queue: when an `EventMsg::McpServerNotification` arrives that matches a configured routing rule, synthesize a prompt string and call `messageQueue.push(synthesizedText, enhancedMode)` with the current/default mode. The existing main-loop drain handles ordering, batching, and turn-boundary semantics — no changes there.

**Concurrency safety.** The push runs from the event handler (already on the same JS event-loop tick as user-message handling). `MessageQueue2.push` is the existing API used by `session.onUserMessage`. Same producer pattern, no new synchronization needed.

**Mid-turn behaviour.** This is the only design choice the operator question explicitly asked about — Claude-Code channels buffer mid-LLM-call and enqueue with `priority:"next"` between turns. **For this option-B consumer the semantics fall out for free**: `messageQueue.push` is non-blocking and orders by FIFO; the main loop only reads it between turns when it calls `waitForMessagesAndGetAsString` after `task_complete` / `turn_aborted` (`runCodex.ts:464-471`, `:569`). A notification arriving during an LLM call lands in the queue immediately but is read only on the next turn boundary. No new state machine. **No equivalent of channels' `priority:"next"` is needed** because there is only one priority lane today; if a true priority lane is wanted later, that becomes a `MessageQueue2` extension and is out of scope here.

---

## 3 · Routing config — which kinds go where

The seven `McpNotificationKind` values are not all equally useful as prompt-queue input. Default routing:

| Kind | Default route | Rationale |
|---|---|---|
| `progress` | display-only (log) | High-frequency telemetry, not actionable per-event. Operators can opt into prompt-queue routing for a specific server if they want progress visible to the LLM. |
| `cancelled` | display-only (log) | Cancellation already arrives at the agent through `turn_aborted` for the agent's own turn; server-side cancellation is informational. |
| `resource_updated` | prompt-queue (debounced) | "File X changed" — the file-watcher use case. Debounce 250 ms per resource URI to coalesce burst edits. |
| `resource_list_changed` | prompt-queue | New / removed resources — agent likely wants to know. |
| `tool_list_changed` | prompt-queue | Dynamic tool registration — explicitly named as a target use case in the original task brief. |
| `prompt_list_changed` | display-only (log) | Rarely actionable mid-conversation; flip to prompt-queue per-server if desired. |
| `logging_message` | display-only (log) | Server log lines are noise unless a specific server wants them surfaced; per-server opt-in. |

**Routing-rule shape (per-server overrides allowed):**

```ts
// happy-cli config (TBD: extend existing config surface;
// see Story 2 for the concrete location)
interface McpNotificationRoutingConfig {
    enabled: boolean;                    // master switch, default false
    defaults: Record<McpNotificationKindLower, RouteAction>;
    perServer?: Record<string, Partial<Record<McpNotificationKindLower, RouteAction>>>;
}

type RouteAction =
    | { type: 'display-only' }
    | { type: 'prompt-queue'; debounceMs?: number; template?: string };
```

`template` lets users customize the synthesized prompt text per kind. Default template (per kind):

| Kind | Default template |
|---|---|
| `resource_updated` | `[mcp:{server}] resource updated: {uri}` |
| `resource_list_changed` | `[mcp:{server}] resource list changed` |
| `tool_list_changed` | `[mcp:{server}] tool list changed; re-check available tools` |
| (per-server opt-in for the rest) | `[mcp:{server}] {kind}: {summary}` |

`{summary}` derives from `params` by best-effort key extraction (URI for resource events, top-level `level` + `data` for logging_message). Bounded to 200 chars to keep prompt context cheap.

**Master kill switch.** `enabled: false` (default) means the consumer is a no-op even if codex emits notifications. Users explicitly opt in. Matches the codex-side `Feature::McpServerNotifications` default-off posture: two independent off-by-default gates (one on each side of the wire).

---

## 4 · `McpSamplingRequest` — scope decision

Stage A also added `EventMsg::McpSamplingRequest` (server asks the client's LLM to generate a message). This is **out of scope for Option B**:

1. Sampling requires a reply path back to the codex backend (`McpConnectionManager::resolve_sampling_request` per the Stage A doc-comment on `McpSamplingRequestEvent`). happy-cli does not have a turn-loop seam for "agent runs a sub-LLM turn driven by an external request" — adding one is well beyond plan-lite scope.
2. Sampling has real security implications (server-driven LLM token spend, prompt-injection vector). Stage A landed it as a typed event so future consumers *can* implement it; Option B chooses not to.

The plan-lite handler will **log-and-ignore** `mcp_sampling_request` events. A future task (suggested name: `codex-sampling-handler`) can build the reply path properly. Note in the source: "TODO(codex-sampling-handler): sampling responses are not yet wired through happy-cli; see plan.md §4." Operator can decide later whether to spawn that task.

---

## 5 · Story breakdown

Estimate: 3 stories, ~150-250 LoC of TS production code + ~100-150 LoC of tests, half-day to one-day impl wall-time.

### Story 1 — Routing config types + loader

**Files:**
- New: `D:/harness-efforts/happy/packages/happy-cli/src/codex/mcpNotificationRouting.ts` (config shape + defaults + per-kind validation).
- Edit: extend the existing happy-cli configuration loader to accept the new `mcpNotificationRouting` block. The exact loader location to be located by the impl member in `packages/happy-cli/src/configuration.ts` (verified to exist at `D:/harness-efforts/happy/packages/happy-cli/src/configuration.ts`) — that file owns the config schema today.
- Tests: `mcpNotificationRouting.test.ts` for default-merging, per-server override, validation of unknown kinds.

**Acceptance criteria:**
- AC1.1: With no config, `loadRouting()` returns `enabled: false` and the defaults table above.
- AC1.2: Per-server overrides override only the listed kinds; unspecified kinds inherit defaults.
- AC1.3: An unknown kind in user config produces a warn-log and is ignored (does not throw).
- AC1.4: `enabled: false` short-circuits all routing regardless of per-server entries.

### Story 2 — Notification consumer + prompt synthesis

**Files:**
- New: `D:/harness-efforts/happy/packages/happy-cli/src/codex/mcpNotificationConsumer.ts` (~80-120 LoC).
  - Exports `createMcpNotificationConsumer({ routing, messageQueue, currentMode })` returning a `(msg: EventMsg) => void` handler.
  - Handles `msg.type === 'mcp_server_notification'`: applies routing rule, debounces if configured, calls `messageQueue.push(synthesized, currentMode())`.
  - Handles `msg.type === 'mcp_sampling_request'`: logs once-per-server-per-session warning, returns. (Out of scope per §4.)
  - Ignores all other `msg.type` values.
- Edit: `D:/harness-efforts/happy/packages/happy-cli/src/codex/runCodex.ts` — wire the consumer into the existing `client.setEventHandler((msg) => ...)` block (`runCodex.ts:428`). Single call: `mcpConsumer(msg);` inserted near the top of the handler, before the existing display-mapping branches. No restructure of existing branches.
- Tests: `mcpNotificationConsumer.test.ts`:
  - AC2.1: `tool_list_changed` with default routing pushes a synthesized message.
  - AC2.2: `progress` with default routing does NOT push.
  - AC2.3: Per-server override of `progress` to `prompt-queue` DOES push for that server but not others.
  - AC2.4: `resource_updated` debouncing: 5 rapid pushes for the same URI within 250 ms collapse to 1 push.
  - AC2.5: `enabled: false` produces zero pushes regardless of incoming kinds.
  - AC2.6: `mcp_sampling_request` logs but does not throw and does not push.
  - AC2.7: Unknown `type` value (e.g., `mcp_future_kind`) is silently ignored.

### Story 3 — Wiring + integration smoke

**Files:**
- Edit: `D:/harness-efforts/happy/packages/happy-cli/src/codex/runCodex.ts` — construct the consumer once at runCodex start using the loaded routing config and a `currentMode` accessor that returns the current `EnhancedMode` (mirrors how user messages compute it at `runCodex.ts:160-185`).
- Edit: existing integration test `codex.integration.test.ts` to add a fixture that fakes a `codex/event` notification with `type: "mcp_server_notification"` and asserts the queue receives the synthesized push.
- No new test file in story 3; reuses the integration harness.

**Acceptance criteria:**
- AC3.1: With `enabled: true` and default routing, a synthetic `tool_list_changed` event delivered via the integration harness causes `messageQueue.push` to be observed before the next `waitForMessagesAndGetAsString` returns.
- AC3.2: `typecheck` passes for `packages/happy-cli` (`pnpm --filter happy-cli typecheck`).
- AC3.3: `pnpm --filter happy-cli test` passes the new test files.

### Out of scope (explicit deferrals)

- Reply-path wiring for `mcp_sampling_request` — separate future task.
- Channel-permission relay (`notifications/codex/channel/permission`) — that's Option A territory.
- Wire-level changes to codex protocol — zero by design.
- UI surface in happy-app (mobile) — read-only event already arrives; mobile rendering can be a follow-up if desired but is not blocking.
- A migration tool or auto-config: users opt in manually.

---

## 6 · Risk surface

| Risk | Mitigation |
|---|---|
| User accidentally enables a chatty progress server → prompt-queue spam → token cost | Default progress routing is `display-only`; per-server opt-in required; debounce defaults documented. |
| Notification arrives mid-turn → prompt-queue contains "stale" event by the time the next turn starts | Acceptable behavior per Claude-Code parity. Events queued mid-turn are read by the agent on the *next* turn, which is the right semantic — the LLM gets to react to "X happened during my last turn" on its next decision. |
| `params: serde_json::Value` is untyped — bad data crashes the consumer | Wrap template synthesis in try/catch; on synthesis error, fall back to `[mcp:{server}] {kind} (synthesis error: see logs)` and log. AC2.7 covers the unknown-`type` case; we should also add a sub-test for malformed `params`. |
| Per-server config keyed by `server_name`; if server name is renamed in MCP config, routing silently breaks | Logged when routing config references a server name that has never produced a notification in the session (best-effort warn after 30 s grace period). Acceptable: matches how other per-server config keys behave today. |
| Future Stage B (Option A channels) collision | None. Option A would add `EventMsg::McpChannelMessage` as a separate variant; this consumer dispatches on `msg.type` and ignores unknowns. Option A could land later without changing Option B. |

---

## 7 · Reversibility / follow-up

- **Reversibility:** removing this consumer is a single revert. It does not touch wire/protocol; it does not change any default behavior (off by default). No data migration needed.
- **Promotion to Option A:** if a real Slack/Telegram/SMS bridge use case lands, Option A becomes the right shape and this consumer continues to work alongside it (channels add new `EventMsg` variant; this consumer ignores unknown variants). The `codex-channels` task entry should remain `deferred-stage-A` (not deleted) for that future trigger.
- **Promotion of sampling handler:** suggested follow-up task `codex-sampling-handler` to wire the reply path properly. Out of scope here, mentioned in source TODO.

---

## 8 · Verification gates

Plan-lite mode — single self-review pass already done in §1-7. No multi-reviewer ceremony per operator instruction.

Impl gates (for the future impl member):
- `pnpm --filter happy-cli typecheck` — green.
- `pnpm --filter happy-cli test` — new test files green; existing tests unchanged.
- Manual smoke: build happy-cli, enable Stage A `Feature::McpServerNotifications` in a local codex config, register a test MCP server that emits a `tool_list_changed` notification, verify the synthesized prompt appears in the next turn's user-message context.

---

## 9 · References

- `plans/channels-research.md` §6.2 (Stage B sketch — context for the deferred Option A).
- `plans/channels-research.md` §1.2 (Claude-Code wire shape — context, not implementation reference).
- `codex/external/repos/codex-patched/codex-rs/protocol/src/protocol.rs:1154-1157` (EventMsg enum tag style).
- `codex/external/repos/codex-patched/codex-rs/protocol/src/protocol.rs:2257-2292` (Stage A variant definitions).
- `D:/harness-efforts/happy/packages/happy-cli/src/codex/runCodex.ts:150-187` (existing messageQueue producer pattern).
- `D:/harness-efforts/happy/packages/happy-cli/src/codex/runCodex.ts:428-520` (existing event handler — integration seam for Story 2/3).
- `D:/harness-efforts/happy/packages/happy-cli/src/codex/codexAppServerTypes.ts:156-160` (EventMsg TS type — already accepts unknown `type` strings, no schema bump needed).
