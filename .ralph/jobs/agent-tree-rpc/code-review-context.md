# Code Review Context — agent-tree-rpc

Patterns and conventions discovered during this review:

- **Codex v2 raw notification parsing lives at `handleRawNotification` (~line 324) in `codexAppServerClient.ts`, NOT at `handleNotification`.** The legacy `codex/event` path runs in parallel and is still active. Any new spawn-event branch must live in `handleRawNotification` and either dedup against legacy events or feed a deduping reducer (the agent-tree reducer uses `(callId, phase)` for this).

- **`AgentRegistry.live_agents()` semantics intentionally exclude the root thread** — the snapshot returned by `sessionGetAgentTree` carries only spawned children in `nodes`, with `edges` linking each child to its parent thread (root or another agent). Tests / consumers should not assume the root appears in `nodes`.

- **`receiverThreadIds` is multi-valued by protocol design** (`ThreadItem.ts:82-101` in the codex submodule). The current parser only reads `[0]`. Future fan-out code that touches collab tool calls should iterate the full array.

- **Reducer is single-writer synchronous.** `setEventHandler` callback in `runCodex.ts` is invoked sequentially by `CodexAppServerClient`; the reducer mutates state and emits deltas in the same step. Do not introduce `setImmediate` / `Promise.resolve().then(...)` ordering perturbations here; the dedup-by-`(callId, phase)` invariant assumes strict ordering.

- **`agent-tree-update` is intentionally NOT replayable** by the server-side `EventRouter`. Clients are expected to RPC `sessionGetAgentTree` on (re)connect, then forward-apply deltas using `delta.seq` as a monotonic guard. Do not add `agent-tree-update` to the replay buffer in `eventRouter.ts`.

- **Inbound CLI->server `agent-tree-update` frames intentionally omit `sessionId`** (the trusted sid comes from `connection.sessionId`). Outbound server->client frames add `sessionId` so user-scoped subscribers (events spanning multiple sessions) can demultiplex. Tests must respect this asymmetry.

- **Authorization gate is `connection.connectionType === 'session-scoped'`** in `sessionUpdateHandler.ts`. The single-user embedded-daemon posture means only the user's own CLI process holds a session-scoped connection; this gate is sufficient under that threat model and is asserted by `sessionUpdateHandler.test.ts`.

- **Reducer monotonic seq across array-returning `applyEvent`**: `closeAgent` can produce N `node-removed` deltas in a single `applyEvent` call (descendants-first then explicit target), and each carries its own `seq`. Consumers must apply each delta in array order; do not skip the inner-array seq counter.

- **`packages/happy-wire/dist/` is tracked** and must be regenerated when source exports change (per `packages/happy-wire/CLAUDE.md`). Use `pnpm --filter @slopus/happy-wire build` and `git add -f` for intended generated files. Cross-package consumers (happy-cli, happy-server) typecheck against committed dist, so missing dist regeneration breaks them.

- **CodexAppServerClient v2 `params.threadId` (camelCase) must be preserved on emitted `agent_message` events** so the reducer can update `lastTaskMessage` on the right child thread. This is asserted by the parser test and is a real production hazard if a future refactor drops the param.

- **legacy spawn-end protocol fields `new_agent_nickname` / `new_agent_role`** are documented in `codex-rs/protocol/src/protocol.rs` but the current reducer does not read them. See finding F-004.

- **Codex submodule `codex/external/repos/codex-patched/`** is READ-ONLY. Verify pre-commit with BOTH `git -C codex diff --name-only -- external/repos/codex-patched` and `git diff --submodule=diff -- codex` — the parent-repo diff alone only shows the submodule pointer.
