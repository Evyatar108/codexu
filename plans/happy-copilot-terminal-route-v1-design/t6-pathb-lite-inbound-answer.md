# T6 Path B-lite — inbound-channel + lease-grant answer (unblocks `happy-mission-control-actor-v1`)

**Status:** Reply to `t6-pathb-lite-implementation-gap-report.md`. Both open
questions are answered with a source-verified recommendation and a revised
file-scope. Implementation can resume.

**Provenance:** read-only feasibility pass (GPT-5.6 Sol, max effort,
2026-08-01) against
`C:\efforts\copilot-agent-runtime\.worktrees\copilot-happy-interactive-embed-seam`,
branch `local/copilot-happy-interactive-embed-seam`. **Baseline discrepancy to
resolve on your side:** the gap report said the worktree was clean at
`8744bdd3c7`, but the investigation found HEAD `1f19c0c1ccd2` with 10 staged
product/test files, and `8744bdd3c7` absent locally AND from the fetched
remote. All citations below are against `1f19c0c1`. Before coding, restore or
rebase onto the commit that actually carries the
`happy-promote-classify-call-to-production` enforcement, re-check shifted
lines, and tell us which SHA is authoritative.

---

## Gap 1 answer: **Option B — new Happy-specific bespoke RPC methods**

### Why not Option A (reuse existing answer methods with lease reauthorization)

The four existing answer methods
(`session.permissions.handlePendingPermissionRequest`,
`session.ui.handlePendingElicitation`, `session.ui.handlePendingExitPlanMode`,
`session.ui.handlePendingUserInput`; registration
`core/generated/apiDispatch.ts:205-225`, impls
`sessionPermissionsApi.ts:297-364`, `sessionUiApi.ts:36-62`) are unsuitable:

1. They return bare `{success: boolean}` — cannot distinguish
   `already_resolved` from `not_pending` from lease/destructive/duplicate
   rejections.
2. The token gate receives only `(method, params)` — no connection identity,
   so a single-holder lease cannot be safely bound to a connection there.
3. Calling them directly bypasses the Happy actor's PromptManager delegation;
   with Mission Control active, the native request can resolve while MC's
   manager retains a stale local entry (the exact coexistence hazard the
   handoff doc §2.5 warned about).
4. Lease request/heartbeat/release have no existing methods anyway — A
   degenerates into a hybrid.
5. Adding `actionId`/richer results to schema methods causes generated-API
   churn (`core/generated/api.ts`).

### Why Option B is minimal — the dispatch layer needs NO changes

**Unknown method names already flow to the bespoke seam**: Rust
`engine.rs:736-757` → handler map `serverSeamHandlers.ts:46-50,109-139` →
typed result/error dispatch `serverSeamDispatch.ts:73-96,176-184`. The Rust
engine does not allowlist method names. Therefore `serverSeamDispatch.ts`,
`serverSeamHandlers.ts`, `engine.rs`, `protocol.rs`, `dispatch.rs`, and all
generated API files stay **untouched**.

The only missing injection point is `SDKServer.buildSeamHandlers()`
(`sdkServer.ts:3140-3168`) — which your fork branch already touches. Add a
narrow constructor option:

```ts
seamExtension?: {
  bespoke: Readonly<Record<string, BespokeMethodHandler>>;
  onConnectionClosed?(connection: SeamConnection): void;
}
```

Merge extension handlers **before** built-ins so fork code cannot shadow core
methods; fan out disconnect cleanup such that extension exceptions cannot
skip core cleanup.

### Method set + uniform result

```
happy.attach
happy.requestLease
happy.heartbeat
happy.releaseLease
happy.answerPrompt
happy.getControlState
```

All return a successful uniform domain result (reserve JSON-RPC errors for
malformed params / internal failure):

```ts
{
  actionId?: string;   // echoed — the phone-side ACK requires this
  outcome: "pending" | "applied" | "duplicate" | "already_resolved"
         | "out_of_scope" | "destructive_kind" | "no_lease"
         | "not_pending" | "rate_limited";
  // plus leaseId, expiresAt, heartbeatIntervalMs, retryAfterMs,
  // requestId as applicable
}
```

This satisfies the phone-side ACK's asks directly: `actionId` echo, stable
rejection enum, heartbeat/TTL values in the grant payload
(`t6-pathb-lite-phone-side-ack.md` §1.2, §1.3, §2). The existing boolean
token gate simply admits the exact `happy.*` names; ALL policy (lease, scope,
dedup, destructive-kind, attachment, rate limit) lives in the actor.

### Correction to the original handoff: answers should NOT go through CommandPoller

Verified: `CommandPoller` **discards** the return values of all four
`PromptManager` handlers (`commandPoller.ts:211-235`) and acks regardless
(`:190-207`) — it cannot produce an honest synchronous
`applied`/`already_resolved`/`not_pending` outcome.

For v1 `answer-prompts`, `happy.answerPrompt` should invoke the public
`PromptManager.handle*Response()` methods **directly** and map their
`ResolveOutcome`: `resolved-local`/`resolved-fallback` → `applied`,
`already-resolved` → `already_resolved`, `not-found` → `not_pending`.
`PromptManager` itself remains unmodified (`promptManager.ts:39-51,215-369`).
Keep `CommandPoller` unmodified and in reserve for later queued send/abort/
mode commands (those are out of v1 scope anyway).

**Interop consequence (good news, phone side already notified):** the
"up to ~3 s pickup" latency in `t6-pathb-lite-phone-side-requirements.md` §5
is now stale **for prompt answers** — they apply synchronously. The phone's
optimistic-UI pattern still stands (it's correct regardless), but confirmation
will arrive much faster than documented. If you later route any command kind
through CommandPoller, return `"pending"`/`"queued"` for those, not
`"applied"`.

---

## Gap 2 answer: **Option ii — separate slash-command module** (not app.tsx, not synthetic prompts)

### The pattern exists

Standalone command modules are supported with a small central insertion:
`SlashCommand` contract `commands/slashCommands.ts:988-1003`; standalone
example `commands/everyCommand.ts:9-42`; imports `slashCommands.ts:120-122`;
central registry `slashCommands.ts:5552-5624`; built-in/skill/SDK merge
`hooks/useSlashCommands.ts:1101-1118`.

Create `commands/happyCommand.ts`:

```
/happy status
/happy grant <request-id>
/happy deny <request-id>
/happy release
```

It resolves the process-local active actor through a tiny registration
accessor; `createBuiltInSlashCommands()` includes it **only while a Happy
actor is registered**, so the default-off route exposes no command at all.

### Keystroke revocation without app.tsx

The actor subscribes directly to the process-wide terminal's `"key"` and
`"paste"` events and synchronously revokes the lease — the event surface is
public (`terminal/terminal.ts:1028-1033`; subscription/cleanup pattern at
`hooks/useInput.ts:95-138`). This avoids `app.tsx` entirely AND guarantees
the grant-command's own Enter keystroke is processed before the new lease is
installed (no self-revocation race).

### Why not the alternatives

- **(i) app.tsx branch:** ~8-15 LOC for the key branch but command
  discovery/help/state plumbing grows the real footprint; unnecessary given
  (ii) exists.
- **(iii) synthetic pending request through the prompt machinery:**
  mechanically possible (`Session.requestPermissionDirect()`
  `session.ts:5654-5667`; store `pendingRequestStore.ts:248-261`; renders via
  `app.tsx:2329-2373` + `PermissionDialogsRouter.tsx:356-390`) **but
  policy-unsafe**: that flow is wrapped into the active Mission Control
  PromptManager (`app.tsx:2347-2368`) and answerable by SDK permission
  providers — i.e. the lease grant would NOT be terminal-only, violating the
  core T6 invariant. A custom-tool prompt also offers persistent approval.
  Rejected.

### Terminal surface

There is no "Happy attached" UI today (startup only logs
`Server listening on port …`, `interactiveMode.ts:654-658`). The actor should
emit timeline `session.info` events for lease request/grant/revoke, and
`/happy status` gives explicit state on demand.

---

## Revised production file-scope (supersedes handoff §3 table)

| File | Change | Est. LOC | Commits/90d |
|---|---|---:|---:|
| `src/cli/happyMissionControlActor.ts` (new) | Actor: RPC handlers, lease state machine, dedup/rate limits, PromptManager routing, terminal-event revocation | 300–450 | 0 |
| `src/cli/embeddedServer.ts` | Construct/inject actor; attach/swap/detach/dispose; admit exact `happy.*` names in the token gate | 35–55 | 23 |
| `src/core/sdkServer.ts` | **Narrow additive:** optional `seamExtension` bespoke-handler injection + disconnect callback in `buildSeamHandlers()` | 15–25 | 136 |
| `src/cli/commands/happyCommand.ts` (new) | `/happy status/grant/deny/release` | 50–80 | 0 |
| `src/cli/commands/slashCommands.ts` | **Narrow additive:** import + conditional registry entry | 3–6 | 142 |
| `src/cli/commands/slashCommandNames.ts` | Optional `/happy` constant | 1 | 27 |

Tests: new actor/command tests + narrow additions to
`test/cli/embeddedServer.test.ts` and the Happy inbound-surface test from the
read-only-enforcement task.

**Must-not-modify updates:** `sdkServer.ts` and `slashCommands.ts` move from
"must not modify" to **narrow additive change** (bounded to the exact diffs
above). Still untouched: `app.tsx`, `promptManager.ts`, `commandPoller.ts`,
`remoteSessionExporter.ts`, `remoteExportContracts.ts`,
`serverSeamDispatch.ts`, `serverSeamHandlers.ts`, all Rust JSON-RPC files,
all generated API files.

## Residual risks / implementation notes

1. **Resolve the baseline discrepancy first** (`8744bdd3c7` vs `1f19c0c1` —
   see Provenance above); re-verify cited lines after restoring the
   enforcement commit.
2. Bind leases to (connection ID × foreground-session generation); revoke on
   disconnect, session switch, expiry, or any terminal input.
3. Multiple pending requests: require explicit request IDs; never grant an
   arbitrary "first" request.
4. Destructive-kind classifier is a policy input — **fail closed on unknown
   kinds** (reject as `destructive_kind`).
5. The process-local actor registry must return an idempotent unregister
   callback (test-singleton hygiene).
6. Acceptance criteria in `t6-pathb-lite-handoff.md` §6 all still apply; add
   one: `/happy grant` is the ONLY grant path, and a synthetic/SDK-originated
   grant attempt must be impossible by construction.
