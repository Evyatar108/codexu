# Research Brief — Workstream 3: Server-Side Replay Buffer + Client lastSeenSeq Handshake

## Researcher Findings

### Key reference docs
- `D:/harness-efforts/codexu/plans/realtime-sync-perf.md` §Workstream 3 — design intent, single-process constraint, Redis deferred.
- `D:/harness-efforts/codexu/packages/happy-server/CLAUDE.md` — Fastify/Socket.IO conventions; no explicit sync invariants section.
- `D:/harness-efforts/codexu/packages/happy-app/CLAUDE.md` — load-bearing sync invariants (see "Invariants" below).

### Server code
- `D:/harness-efforts/codexu/packages/happy-server/sources/app/events/eventRouter.ts`
  - `emitUpdate({ userId, payload, recipientFilter?, skipSenderConnection? })` (signature ~lines 222–227).
  - `UpdatePayload = { id, seq, body: { t, ...}, createdAt }` (~lines 191–199).
  - `EventRouterSink` is the in-process implementation; publishes via Socket.IO rooms. **No replay state today.**
- `D:/harness-efforts/codexu/packages/happy-server/sources/app/api/socket.ts`
  - Connection middleware reads `socket.handshake.auth.{clientType,sessionId,machineId,userId}` (lines 86–89). **No `lastSeenSeq` extraction yet.**
  - Connection handler installs scope-builder routing; recent commit `7ef13b21` consolidated session/machine routing into apiSocket scope builders.
  - Redis Streams adapter is **conditional on REDIS_URL**; single-process is the personal-fork default.
- `D:/harness-efforts/codexu/packages/happy-server/sources/storage/seq.ts`
  - `allocateUserSeq(_accountId)` — **ignores the accountId argument**; returns a process-global monotonic counter. Treat `payload.seq` as opaque account-global ordering only.
- `D:/harness-efforts/codexu/packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts` — emitUpdate call sites at lines 92, 164, 287 (each preceded by allocateUserSeq).
- Other emit producers: `sessionRoutes.ts`, `v3SessionRoutes.ts`, `machineUpdateHandler.ts`, `sessionDelete.ts`, `usernameUpdate.ts`. **Buffering inside `emitUpdate` itself captures all producers** — no per-call-site changes needed.
- `D:/harness-efforts/codexu/packages/happy-server/sources/utils/lru.ts` — `LRUSet<T>` exists but is access-recency, **not insertion-time**. Not suitable as-is for a time-windowed replay buffer.

### Client code
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/storage.ts` — Zustand store; no whole-store persistence wrapper. Field `lastSeenUpdateSeq` does not exist yet.
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/persistence.ts` — per-value MMKV `load*` / `save*` helpers. Follow the same shape.
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/socketOptions.ts` (lines 19–45) — `buildTunnelSocketOptions(...)` constructs the Socket.IO `auth` object at line 30 (current shape: `{ clientType, happyClient, machineId, ...socketAuthHeaders }`).
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/apiSocket.ts` — single socket per machine; auto-reconnect is disabled and manually re-driven; already imports `storage`. **Safe place to read `lastSeenUpdateSeq` and pass it into `buildTunnelSocketOptions`.**
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/sync.ts`
  - `handleUpdate(update, _, machineId)` (~line 1677) is the single chokepoint where account-global update.seq is observed; this is where to persist.
  - `apiSocket.onReconnected(...)` currently calls `sessionsSync.invalidate()` and `machinesSync.invalidate()` **unconditionally**. This is the perf win to claim — see Open Questions.
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/apiTypes.ts` — current `update` envelope schema **will reject `{ replayOverflow: true }`**; need a separate socket event name.

### Tests
- Server: `packages/happy-server/sources/app/events/eventRouter.test.ts` already has a `FakeIo` harness — best base for replay tests. Also `socket.spec.ts` for handshake/auth.
- Server uses `.spec.ts` AND `.test.ts` (mixed). Vitest config: `packages/happy-server/vitest.config.ts`, node env.
- Client: `sources/_test-stubs/setup.ts` stubs RN/MMKV. Existing tests: `socketOptions.test.ts`, `apiSocket.test.ts`, `storage.spec.ts`, `sync.test.ts`. Naming is mixed; storage uses `.spec.ts`, sync uses `.test.ts`.
- Client storage tests mock via `vi.mock('@/sync/storage')` to avoid pulling real MMKV.

### Build / Monorepo
- `pnpm` mandatory; `pnpm-workspace.yaml`.
- TS path alias `@/`.
- Test command in feature-request:
  ```
  pnpm --filter '{packages/happy-server}' --filter '{packages/happy-app}' exec vitest run 2>&1 | tee /tmp/codexu-ws3.log
  ```
  Verified syntactically valid for pnpm. Note: `/tmp/` is fine in Git Bash on Windows but not from cmd.exe; the orchestrator should invoke from bash.

---

## Architect Analysis

### Integration points
- emitUpdate call sites (6+): all preceded by `allocateUserSeq` → `buildXUpdate(...)` → `emitUpdate`. Buffer append must occur **inside `emitUpdate`**, after the payload is built, before Socket.IO publish.
- Client update chokepoint: `sync.handleUpdate` (the feature wording "storage.applyUpdate" doesn't exist — there is no `applyUpdate` method; the actual sink is `applySessions` / `applyMachines` / `applyProfile`, all invoked from `handleUpdate`).
- Handshake injection: `socket.handshake.auth.lastSeenSeq` parsed in `socket.ts` connection middleware; replay logic invoked from connection handler after `eventRouter.addConnection`.

### Buffer design (recommended)
- **Data structure**: rotating-index fixed-size array per user (O(1) append, O(n≤1024) replay scan).
- **Placement**: module-scoped `Map<userId, UserEventBuffer>` next to `EventRouterSink`, accessed via methods on the sink.
- **Replay protocol**: emit each buffered event individually as `socket.emit('update', payload)` in ascending seq order. Reuses the existing wire schema and update path on the client — no new envelope to validate. (Batched `socket.emit('replay', [...])` was considered but requires a new schema and parallel handler in `sync.ts`.)
- **Overflow signal**: a separate event name, e.g. `socket.emit('replay-overflow', { replayOverflow: true, currentSeq })`. `apiTypes.ts` already rejects unknown update shapes, so this must be a distinct event.

### Risks
1. **Reorder pitfall** — `allocateUserSeq` must precede `emitUpdate`. Already true at every call site; the buffer append inside `emitUpdate` strictly comes after seq allocation.
2. **Memory leak on permanent disconnect** — buffer entry for a userId is never pruned. Mitigation: opportunistic eviction when buffer head age > MAX_REPLAY_AGE_MS at next append, plus optional eviction on last-connection-disconnect.
3. **Burst-after-reconnect ordering** — Socket.IO guarantees FIFO within a connection, so replay+live emit ordering is preserved if replay events are emitted synchronously before yielding the event loop.
4. **Timer-based eviction flake** — use `vi.useFakeTimers()` in tests.

---

## Codex Research

Independently confirmed:
- `allocateUserSeq` is process-global and ignores its argument.
- Emit producers include `sessionDelete.ts` and `usernameUpdate.ts` (additional to the architect's list).
- `apiTypes.ts` won't accept replayOverflow inside the existing `update` schema — use a distinct event.
- `socketOptions.ts` should **not** read `storage` directly to avoid an import cycle (`storage → sync → apiSocket → socketOptions → storage`). Pass `lastSeenSeq` as a parameter from `apiSocket.connect()`.
- **Multi-machine concern (NEW)**: the app maintains independent `apiSocket` instances per machine. A single global `lastSeenUpdateSeq` could conflate ordering signals from independent servers. Safer shape: `lastSeenUpdateSeqByEndpoint` or by machineId. (Counterpoint: in single-server personal-fork posture, one global seq is sufficient and simpler. See Open Question 2.)
- **Reconnect handler concern (NEW)**: current `sync.ts` `onReconnected` calls `sessionsSync.invalidate()` unconditionally. If untouched, replay buffer adds wire traffic but doesn't reduce HTTP load.

## Copilot Research

Independently confirmed the same key issues plus:
- The right design is to **gate the reconnect HTTP fallback** behind replay outcome — invalidate only on `replayOverflow` (or first connect with no `lastSeenSeq`). Otherwise the buffer is a wire optimization without a meaningful end-to-end perf win.
- `keepMachinesSync.invalidate()` on reconnect can stay — replay covers `update` events but not ephemerals/presence.
- Persist `lastSeenUpdateSeq` **after** an update is applied (not at raw socket receipt). Avoids persisting seqs for messages that failed validation.
- For tests, the existing `eventRouter.test.ts` FakeIo harness is the right base; no new test infra needed.

---

## Consensus across all 4 sources
1. **emitUpdate is the only server insertion point needed** — captures every producer.
2. **handleUpdate is the only client persistence point** — there is no `storage.applyUpdate`.
3. **socketOptions should not import storage** — pass `lastSeenSeq` from `apiSocket.connect()` to avoid cycle.
4. **replayOverflow must be a distinct socket event** — `apiTypes.ts` will reject it inside the update envelope.
5. **Retention rule is ambiguous** as written — flagged by 2/4 sources.
6. **Reconnect HTTP fallback in sync.ts must be gated on overflow** for the perf win to materialize — flagged by 2/4 sources.
7. **Multi-machine seq scoping** is a real design question — flagged by Codex.

## CLAUDE.md invariants quoted
From `packages/happy-app/CLAUDE.md`:
> `session.seq` is **session-local** (per-session message counter, server-side `allocateSessionSeq`). `updateData.seq` on a socket update event is the **account-global** update counter — only valid for ordering events on the wire. Never write `updateData.seq` into `session.seq`.

> Session/machine-scoped network calls MUST go through `apiSocket.forSession(sid)` / `apiSocket.forMachine(mid)` scope builders. There is no `apiSocket.request` / `apiSocket.emitWithAck` / `apiSocket.sessionRPC` / `apiSocket.machineRPC` — the scope builder makes that bug class inexpressible.

> Sync reducer batches must replay oldest-to-newest by `createdAt`.

---

## Consolidated File List

### Files to modify (server)
- `packages/happy-server/sources/app/events/eventRouter.ts` — add ring buffer + replay/overflow API.
- `packages/happy-server/sources/app/api/socket.ts` — parse `lastSeenSeq`, invoke replay on connect.
- `packages/happy-server/sources/app/events/eventRouter.test.ts` — replay + overflow tests.
- `packages/happy-server/sources/app/api/socket.spec.ts` — optional: extend handshake auth assertions.
- `packages/happy-server/CLAUDE.md` — document buffer + invariants.

### Files to modify (client)
- `packages/happy-app/sources/sync/storage.ts` — add `lastSeenUpdateSeq` to state, setter.
- `packages/happy-app/sources/sync/persistence.ts` — `loadLastSeenUpdateSeq`, `saveLastSeenUpdateSeq` MMKV helpers.
- `packages/happy-app/sources/sync/socketOptions.ts` — accept `lastSeenSeq` parameter, add to auth.
- `packages/happy-app/sources/sync/apiSocket.ts` — read `lastSeenUpdateSeq` from storage at connect-time and pass it in.
- `packages/happy-app/sources/sync/sync.ts` — persist on `handleUpdate`, handle `replay-overflow` event, gate `sessionsSync.invalidate()` in `onReconnected`.
- `packages/happy-app/sources/sync/socketOptions.test.ts` — assert auth contains `lastSeenSeq`.
- `packages/happy-app/sources/sync/storage.spec.ts` (or new `lastSeenSeq.test.ts`) — persistence test.
- `packages/happy-app/sources/sync/sync.test.ts` — replay-overflow listener + reconnect gating.
- `packages/happy-app/CLAUDE.md` — document invariant (lastSeenUpdateSeq is account-global, not session-local).

### Files to reference (do not modify)
- `packages/happy-server/sources/storage/seq.ts` — confirms allocateUserSeq is process-global; do NOT refactor in this WS.
- `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts`, `machineUpdateHandler.ts`, `routes/sessionRoutes.ts`, `routes/v3SessionRoutes.ts`, `app/session/sessionDelete.ts`, `app/user/usernameUpdate.ts` — emit producers; buffering inside emitUpdate covers all.
- `packages/happy-app/sources/sync/apiTypes.ts` — confirms replayOverflow needs a distinct event name.
- `packages/happy-server/sources/utils/lru.ts` — pattern reference only.
- `plans/realtime-sync-perf.md` — design context.

### Documentation to update
- `plans/realtime-sync-perf.md` §Workstream 3 — mark complete with implementation summary (single commit on main).
- `packages/happy-server/CLAUDE.md` — add "Ring buffer" section.
- `packages/happy-app/CLAUDE.md` — note `lastSeenUpdateSeq` and the reconnect-gating change.
