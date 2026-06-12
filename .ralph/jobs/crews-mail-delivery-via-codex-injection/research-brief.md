# Research Brief — crews-mail-delivery-via-codex-injection

## Researcher Findings

### Crews-side source-of-truth surfaces
- `ai-developer-toolkit\plugins\crews\hooks\mailbox.js:441-497` — `appendMailboxWithSender(...)` is the single durable-write chokepoint for `appendMailbox`, `appendSystemMailbox`, and `appendOperatorMailbox`, so it is the right place to emit a wake notification after a successful mailbox write.
- `ai-developer-toolkit\plugins\crews\hooks\mailbox.js:638-690` — `consumeMailbox(...)` owns draining and listener-epoch fencing. The wake path must never consume here.
- `ai-developer-toolkit\plugins\crews\hooks\commands\review-mail.js:220-310` — review-mail is the authoritative cursor-advance path (`lastReviewedSeq`, `lastReviewedAt`).
- `ai-developer-toolkit\plugins\crews\hooks\actors.js:1432-1474` — `markReviewed(...)` preserves the monotonic review cursor and reinforces that mailbox review, not wake delivery, is the ack path.
- `ai-developer-toolkit\plugins\crews\hooks\pre-tool-use.js:590-635` — current member reachability gate blocks unarmed actors and prefers review-mail-first when unread mail exists.
- `ai-developer-toolkit\plugins\crews\hooks\stop.js:745-752` — terminal turns and unresolved consumed mail still require an armed listener for members today.
- `ai-developer-toolkit\plugins\crews\hooks\protocol\review-required.js:50-65` — review-required semantics stay mailbox-driven and must be preserved.

### Crews Codex plugin shape today
- `ai-developer-toolkit\plugins\crews\.codex-plugin\plugin.json:1-19` — Codex manifest currently has hooks only; no `mcpServers`.
- `ai-developer-toolkit\plugins\crews\.codex-plugin\hooks\hooks.json:1-60` — Codex SessionStart / PreToolUse / Stop are already wired, so codex-only gate relaxation can stay inside the existing hook surfaces once a bridge capability exists.

### Codex-side queue and notification seams
- `codex\external\repos\codex-patched\codex-rs\features\src\lib.rs:1161-1170` — `Feature::McpServerNotifications` already exists, is experimental, and defaults off.
- `codex\external\repos\codex-patched\codex-rs\core\src\session\mcp.rs:345-364` — feature plumbing already threads the notification bridge into MCP startup.
- `codex\external\repos\codex-patched\codex-rs\rmcp-client\src\logging_client_handler.rs:58-177` — standard MCP server notifications are already bridged into `EventMsg::McpServerNotification`.
- `codex\external\repos\codex-patched\codex-rs\protocol\src\protocol.rs:2270-2294` — `McpNotificationKind` and `McpServerNotificationEvent` are already typed on the wire.
- `codex\external\repos\codex-patched\codex-rs\core\src\session\turn.rs:1370-1371` — raw Codex currently ignores `EventMsg::McpServerNotification(_)` in the native turn path.
- `codex\external\repos\codex-patched\codex-rs\core\src\session\input_queue.rs:82-92` — queued-next-turn input primitive.
- `codex\external\repos\codex-patched\codex-rs\core\src\unified_exec\async_watcher.rs:166-189` — exact precedent for "synthesize one next-turn prompt, queue it, then wake pending work."

### Prior-art durable-mailbox + wake split
- `packages\happy-cli\src\codex\mcpNotificationConsumer.ts:1-185` — Option-B-style notification-to-queue consumer shape: allowlisted notification kinds, optional debounce, prompt synthesis, no mailbox truth.
- `packages\happy-cli\src\codex\agentCommsBridge.ts:15-31` and `:140-220` — durable mailbox plus wake-hint pattern; watcher emits a hint, durable drain remains authoritative.
- `packages\happy-cli\src\agentComms\recovery.ts:1-61` — startup catch-up pattern: enqueue exactly one wake when unread durable entries already exist on startup.

## Architect Analysis

### Recommended architectural split
1. **Codex repo** — add a general notification-to-next-turn wake primitive keyed by MCP server name plus notification kind, reusing the existing `input_queue` + `request_pending_work_wake()` pattern.
2. **Crews plugin repo** — add the producer half: a Codex MCP server, mailbox-write wake emission, startup catch-up, and codex-only hook/briefing reachability changes.
3. **Integration story** — relax listener-armed requirements only when an explicit codex bridge capability is present; leave review-required and strict-ack unchanged.

### Seam-placement guidance for Codex
- **Preferred placement:** overlay-first logic plus a tiny session-side seam. Keep most logic in a new overlay crate or new helper module, and touch upstream-canonical code only where Codex must observe `EventMsg::McpServerNotification` and hand it to the queue/wake helper.
- **Avoid:** growing `core\src\session\turn.rs` into the actual consumer logic. `realtime_text_for_event(...)` is the current drop site, but it is a UI-text sink, not the best place to own queueing behavior.
- **Bookkeeping obligation:** every unavoidable upstream-canonical edit must carry `// SANDBOX PATCH:` markers and a new/updated row in `codex\docs\implementation\patch-surface.md` section 14 plus a replant note in section 15.

### Option A vs Option B
- **Option A — `notifications/resources/updated` + `resources/subscribe`:**
  - Best semantics: models "mailbox resource changed."
  - Requires new Codex client-side `resources/subscribe` plumbing because `rmcp_client.rs` exposes `read_resource(...)` and `send_custom_request(...)` but no typed subscribe helper.
  - Higher Codex conflict surface.
- **Option B — `notifications/message`:**
  - Smallest first ship: Codex already forwards logging notifications.
  - No subscribe plumbing required.
  - Weaker semantics: "a log-worthy mailbox change happened," not "resource X changed."

### Scope recommendation
- **Recommended v1 scope:** codex members only, not codex leads.
- **Recommended producer choice for v1:** Option B (`notifications/message`) to minimize the new Codex fork seam while still meeting the listenerless wake goal.
- **Recommended Codex consumer scope:** general wake primitive with an explicit allowlist of `{ serverName, notificationKind }`, with crews as the first consumer.

## Codex Research

The Codex research lane confirmed three important implementation details:
- `codex-mcp-notification-bridge` already exists as the Stage-A ingress overlay, so the wake consumer should extend that existing surface instead of creating a second parallel bridge crate.
- `core-plugins` expects Codex plugin MCP wiring via a path string on `plugin.json` (`"mcpServers": "./.mcp.codex.json"`), not an inline MCP server object under `.codex-plugin`.
- The consumer should live in the session event path with access to `input_queue` and `request_pending_work_wake()`, not in `realtime_text_for_event()`.

Key artifact: `D:\harness-efforts\codexu\.ralph\jobs\.staging\20260612T094026Z-plan-mailinject-9c28d688\codex-research.txt`.

## Copilot Research

The Copilot research lane independently converged on the same split:
- use `appendMailboxWithSender(...)` as the producer chokepoint,
- keep `review-mail` / `markReviewed` as the sole ack path,
- prefer overlay/new-file placement for the Codex consumer seam,
- treat Option A as semantically best but larger,
- and document a two-repo implementation order where hook-gate relaxation comes after the producer and consumer exist.

Key artifact: `D:\harness-efforts\codexu\.ralph\jobs\.staging\20260612T094026Z-plan-mailinject-9c28d688\copilot-research.txt`.

## Consolidated File List

### Codex files to modify
- `codex\external\repos\codex-patched\codex-rs\core\src\session\turn.rs`
- `codex\external\repos\codex-patched\codex-rs\core\src\session\input_queue.rs` (reuse only; likely no logic change)
- `codex\external\repos\codex-patched\codex-rs\core\src\unified_exec\async_watcher.rs` (reuse only; precedent)
- `codex\external\repos\codex-patched\codex-rs\features\src\lib.rs` (likely no logic change; feature reused)
- `codex\docs\implementation\patch-surface.md`
- `codex\codex-rs-overlay\...` (new overlay helper or invariant test crate entry)

### Crews files to modify
- `ai-developer-toolkit\plugins\crews\.codex-plugin\plugin.json`
- `ai-developer-toolkit\plugins\crews\.codex-plugin\.mcp.codex.json` (new)
- `ai-developer-toolkit\plugins\crews\hooks\mailbox.js`
- `ai-developer-toolkit\plugins\crews\hooks\session-start.js`
- `ai-developer-toolkit\plugins\crews\hooks\pre-tool-use.js`
- `ai-developer-toolkit\plugins\crews\hooks\stop.js`
- `ai-developer-toolkit\plugins\crews\hooks\briefing\template.js`
- `ai-developer-toolkit\plugins\crews\hooks\briefing\continuation.js`
- `ai-developer-toolkit\plugins\crews\AGENTS.md`
- `ai-developer-toolkit\plugins\crews\CHANGELOG.md`

### Existing patterns to reuse
- `packages\happy-cli\src\codex\mcpNotificationConsumer.ts`
- `packages\happy-cli\src\codex\agentCommsBridge.ts`
- `packages\happy-cli\src\agentComms\recovery.ts`

### Tests / validation surfaces
- `codex\external\repos\codex-patched\codex-rs\core\src\session\tests.rs`
- `codex\codex-rs-overlay\codex-invariant-tests\tests\mcp_server_notifications.rs`
- `ai-developer-toolkit\plugins\crews\tests\*.test.js`
