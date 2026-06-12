# Stories Outline: crews-mail-delivery-via-codex-injection

*Preliminary decomposition from `/plan-with-ralph`. This plan is dual-repo; the lead should split implementation across repo-scoped jobs rather than run one blind `/implement-with-ralph` chain.*

## US-001: Queue allowlisted MCP wakes into raw Codex
**Repo:** `codex\`

**Description:** As a codex member runtime, I want allowlisted MCP server notifications to become next-turn wake prompts so that raw codex sessions can react to crews mail without a listener subprocess.

**Acceptance Criteria:**
- [ ] The v1 route `{ server: "crews", kind: "logging_message" }` queues one next-turn wake prompt and calls `request_pending_work_wake()`.
- [ ] The wake consumer is invoked from the session event-dispatch path, not from `realtime_text_for_event()`.
- [ ] Non-allowlisted notifications and `Feature::McpServerNotifications == false` remain inert.
- [ ] Patch-surface docs/tests are updated for every upstream-canonical seam.
- [ ] Typecheck passes.

**Dependencies:** None
**Estimated complexity:** large

## US-002: Emit deduped crews wake notifications for codex members
**Repo:** `ai-developer-toolkit\plugins\crews\`

**Description:** As a codex crews member, I want durable mailbox state changes to emit a deduped wake hint so that codex can tell me to drain my mailbox without a listener subprocess.

**Acceptance Criteria:**
- [ ] The Codex plugin manifest points to `./.mcp.codex.json` and the plugin root exposes a stable stdio launch entrypoint.
- [ ] The MCP server watches durable mailbox/manifest state instead of relying on direct hook-to-server IPC.
- [ ] The server writes a current-session ready stamp after MCP initialization succeeds.
- [ ] The server emits one startup catch-up wake after initialization when unread mail already exists.
- [ ] The server emits one deduped wake per unread generation after durable state advances.
- [ ] The wake producer never drains mail or advances `lastReviewedSeq`.
- [ ] Typecheck passes.

**Dependencies:** None
**Estimated complexity:** medium

## US-003: Relax codex-only listener gates behind the bridge proof
**Repo:** `ai-developer-toolkit\plugins\crews\`

**Description:** As a codex crews member, I want the hook and briefing surfaces to treat the Codex wake bridge as my reachability mechanism so that I no longer have to arm a listener after every wake.

**Acceptance Criteria:**
- [ ] `hooks\actors.js` enables `features.mcp_server_notifications=true` on the codex launch path.
- [ ] PreToolUse and Stop branch on the ready-stamp proof, not on engine alone.
- [ ] Codex members with the proof stop receiving listener-arm requirements; codex members without it keep the old behavior.
- [ ] Review-required and strict-ack behavior stays unchanged.
- [ ] The crews version and marketplace stamps are updated through `scripts\bump-version.js`.
- [ ] Installed-path dogfood refreshes the codex-side plugin cache and proves wake -> review-mail drain -> no listener requirement.
- [ ] Typecheck passes.

**Dependencies:** US-001, US-002
**Estimated complexity:** medium
