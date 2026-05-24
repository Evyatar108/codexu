# PRD: Realtime Sync Perf — Workstream 3 (Server Replay Buffer + Client lastSeenSeq Handshake)

## Introduction

Workstream 3 of `plans/realtime-sync-perf.md` eliminates the HTTP re-fetch fallback that happy-app currently performs on every Socket.IO reconnect (daemon restart, tunnel blip, app background). The server (each happy-server daemon) keeps an in-memory ring buffer of the last 1024 emitted `update` events plus a `currentSeq` integer; on reconnect, if the handshake carries `auth.lastSeenSeq`, the server replays buffered events with `seq > lastSeenSeq` honoring each entry's `recipientFilter`. When `lastSeenSeq` is older than the oldest buffered seq (or higher than `currentSeq`, indicating a daemon restart), the server emits a distinct `replay-overflow` socket event so the client falls back to HTTP.

Because each happy-cli daemon serves exactly one operator (one-user-per-daemon deployment invariant), server-side replay state is a flat array + single `currentSeq` integer — no userId-keying. The client persists `lastSeenUpdateSeqByMachineId: Record<string, number>` to MMKV (per-daemon, because happy-app talks to many independent daemons).

All of WS3 lands as a single commit on `main`. Stories below are review-time chunks within that single commit, not independent commits.

## Goals

- Eliminate unconditional `sessionsSync.invalidate()` (HTTP re-fetch) on every Socket.IO reconnect; fall back to HTTP only when replay overflows or on the very first connect to a new daemon.
- Add an in-memory replay buffer (cap-only retention, 1024 entries) inside each daemon's `EventRouter`, with a parallel `currentSeq` integer that survives the cap-only retention.
- Wire a per-daemon `lastSeenSeq` field through the Socket.IO handshake auth, with a monotonic-guarded MMKV persistence layer on the client side so out-of-order async update handlers cannot regress the stored value.
- Preserve `recipientFilter` correctness on replay so private session-scoped or machine-scoped updates are not re-emitted to connections that the original filter would have excluded.
- All unit tests pass; cross-package typechecks (happy-server, happy-cli, happy-agent, happy-wire, happy-app) stay green.

## User Stories

### US-001: Server ring buffer + currentSeq tracker in EventRouter

**Description:** As a happy-server daemon, I want to retain the last 1024 emitted `update` events (plus a parallel `currentSeq` integer) so that a reconnecting client can resume from a known `lastSeenSeq` without an HTTP re-fetch.

**Acceptance Criteria:**
- [ ] `packages/happy-server/sources/app/events/eventRouter.ts` adds module-scoped state: a flat `replayBuffer: BufferedUpdate[]` where `BufferedUpdate = { payload: UpdatePayload; recipientFilter: RecipientFilter; createdAt: number }`, AND a module-scoped `let currentSeq = 0;` integer. Neither is keyed by userId.
- [ ] `appendToReplayBuffer(payload, recipientFilter)` is invoked inside `EventRouterSink.emitUpdate` strictly after seq allocation; pushes to the array with `createdAt = Date.now()`, drops the oldest element when `replayBuffer.length > 1024`, and writes `currentSeq = payload.seq` in lockstep with the append.
- [ ] When `emitUpdate` is called without an explicit `recipientFilter`, the same default applied at the live publish path (`{ type: 'all-user-authenticated-connections' }`) is stored in the buffer entry so replay matches the original broadcast.
- [ ] `getReplayForConnection(lastSeenSeq, connection)` returns `{ events: UpdatePayload[]; overflow: boolean; currentSeq: number }`. Overflow is true if `currentSeq > 0 && lastSeenSeq > currentSeq` (daemon-restart case) OR if the buffer is non-empty AND `lastSeenSeq < replayBuffer[0].payload.seq` (cap-overflow case). No-op (empty `events`, `overflow=false`) when `currentSeq === 0`, or when `lastSeenSeq >= currentSeq` and the buffer is empty, or when `lastSeenSeq >= replayBuffer[0].payload.seq` and `lastSeenSeq <= currentSeq` (resume-in-window case).
- [ ] Partial replay iterates buffered entries and includes a payload only when `entry.payload.seq > lastSeenSeq` AND `doesFilterMatchConnection(entry.recipientFilter, connection)` returns true.
- [ ] Private helper `doesFilterMatchConnection(filter, connection)` inside `EventRouterSink` mirrors the room-derivation logic in `getRoomsForFilter` exactly: `all-user-authenticated-connections` → always true; `user-scoped-only` → only `connection.connectionType === 'user-scoped'`; `all-interested-in-session` → user-scoped OR (session-scoped AND matching sessionId); `machine-scoped-only` → user-scoped OR (machine-scoped AND matching machineId). Cross-reference comments at both helper sites.
- [ ] Cap-only retention at 1024 entries (no age-eviction).
- [ ] Inline comment at the new append site: `// CRITICAL: replay buffer append must occur after allocateUserSeq has minted payload.seq — see Workstream 3.`
- [ ] Inline comment near the module-scoped declarations documents the flat-buffer rationale (one-user-per-daemon deployment invariant) and the consequence if that invariant is ever relaxed (must re-introduce userId-keying + per-account `allocateUserSeq`).
- [ ] Unit test in `eventRouter.test.ts`: emit 10 events with default filter; reconnect a user-scoped connection with `lastSeenSeq=5` → replay returns events 6..10 in ascending seq order; explicitly verify that other previously-attached connections do NOT receive the replay events.
- [ ] Unit test: emit 2000 events → buffer length is exactly 1024 and oldest entry's seq is `2000 - 1024 + 1 = 977`.
- [ ] Unit test: with buffer oldest seq 977 and `lastSeenSeq=0`, replay yields `overflow=true` with `currentSeq=2000` and no event payloads on the overflow path.
- [ ] Unit test (recipientFilter matrix): emit four events with filters `all-user-authenticated-connections`, `user-scoped-only`, `all-interested-in-session` (sessionId `s1`), `machine-scoped-only` (machineId `m1`). Replay against five connection shapes (user-scoped; session-scoped for `s1`; session-scoped for unrelated sessionId; machine-scoped for `m1`; machine-scoped for unrelated machineId) returns exactly the matching subsets (user-scoped gets all four; session-scoped-s1 gets all-user + all-interested-in-session; session-scoped-other gets only all-user; machine-scoped-m1 gets all-user + machine-scoped-only; machine-scoped-other gets only all-user).
- [ ] Unit test (daemon-restart shapes): (i) buffer non-empty + `lastSeenSeq > currentSeq` → overflow with correct `currentSeq`; (ii) buffer force-cleared in test harness while `currentSeq` retained, `lastSeenSeq > currentSeq` → overflow; (iii) fresh daemon (buffer empty, `currentSeq === 0`), `lastSeenSeq=10` → no-op (NOT overflow, since the daemon has never emitted during this incarnation).
- [ ] Existing eventRouter tests stay green.
- [ ] Typecheck passes for `packages/happy-server` (`pnpm --filter '{packages/happy-server}' exec tsc --noEmit`).
- [ ] Tests pass.

### US-002: Server socket handshake wiring + mandatory socket.spec.ts coverage

**Description:** As a happy-server daemon, I want to read `socket.handshake.auth.lastSeenSeq` on each connection and dispatch to the replay path so the buffer's behavior is reachable end-to-end through the public socket API.

**Acceptance Criteria:**
- [ ] In `packages/happy-server/sources/app/api/socket.ts`, after the existing `eventRouter.addConnection` call in the connection handler, if `socket.handshake.auth.lastSeenSeq` is a finite number, call `eventRouter.getReplayForConnection(lastSeenSeq, connection)` passing the already-constructed `ClientConnection`.
- [ ] If the result's `overflow` is true, the connection emits exactly one `socket.emit('replay-overflow', { replayOverflow: true, currentSeq })` and no `update` events on that path.
- [ ] Otherwise, the connection emits each event with `socket.emit('update', evt)` in ascending seq order.
- [ ] Replay dispatch is supported for all three connection types (`user-scoped`, `session-scoped`, `machine-scoped`) because `doesFilterMatchConnection` already suppresses non-applicable entries.
- [ ] Grep verifies that the event name `'replay-overflow'` is not already used in either `packages/happy-server` or `packages/happy-app` before the new event is added.
- [ ] Unit test in `socket.spec.ts` (case i): a user-scoped connection with `auth.lastSeenSeq=5` against a buffer holding seqs 1..10 → `eventRouter.getReplayForConnection` is called exactly once with that `lastSeenSeq` (asserted via spy); `socket.emit('update', ...)` is called once per replayed event with seqs 6..10 in order; no `replay-overflow` is emitted.
- [ ] Unit test in `socket.spec.ts` (case ii): a connection whose handshake auth does NOT include `lastSeenSeq` (or whose value is non-finite / wrong type) → `getReplayForConnection` is NOT invoked and no `replay-overflow` event is emitted on that connection.
- [ ] Unit test in `socket.spec.ts` (case iii): a user-scoped connection with `auth.lastSeenSeq=5000` against a buffer whose oldest seq is 100 → exactly one `socket.emit('replay-overflow', { replayOverflow: true, currentSeq: <last emitted seq> })`; no `update` events on that path.
- [ ] Existing socket.spec.ts tests stay green.
- [ ] Typecheck passes for `packages/happy-server`.
- [ ] Tests pass.

### US-003: Client MMKV persistence — lastSeenUpdateSeqByMachineId + monotonic setter

**Description:** As happy-app, I want to persist the per-daemon highest applied `update.seq` to MMKV with a monotonic guarantee so that async out-of-order replay handlers cannot regress the stored value.

**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/storage.ts` adds `lastSeenUpdateSeqByMachineId: Record<string, number>` to `StorageState` and initializes it from MMKV via a new load helper.
- [ ] `setLastSeenUpdateSeq(machineId, seq)` setter implements `Math.max(state.lastSeenUpdateSeqByMachineId[machineId] ?? 0, seq)`. When the candidate seq is `<=` the existing value, the setter is a no-op on BOTH the zustand `set` and the MMKV `saveLastSeenUpdateSeqByMachineId` call.
- [ ] `packages/happy-app/sources/sync/persistence.ts` adds `loadLastSeenUpdateSeqByMachineId()` and `saveLastSeenUpdateSeqByMachineId(map)` following the existing per-key MMKV helper pattern.
- [ ] Unit test: the setter writes through to MMKV when the seq advances and `load*` returns the persisted map on the next call.
- [ ] Unit test (monotonic guarantee): call `setLastSeenUpdateSeq('mA', 10)` then `setLastSeenUpdateSeq('mA', 6)` → `storage.getState().lastSeenUpdateSeqByMachineId['mA'] === 10` AND the MMKV save helper was invoked exactly once (the regressing write is a no-op). Then call `setLastSeenUpdateSeq('mA', 11)` → value advances to `11` and MMKV save is invoked again.
- [ ] Typecheck passes for `packages/happy-app`.
- [ ] Tests pass.

### US-004: Client socketOptions parameter + apiSocket connect-time wiring

**Description:** As happy-app, I want each per-daemon socket's handshake auth to include its own daemon's last-seen seq so the server can replay correctly, without `socketOptions.ts` importing `storage` (avoiding a load-path cycle).

**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/socketOptions.ts` signature changes to `buildTunnelSocketOptions(credentials, machineId = credentials.machineId, lastSeenSeq?: number)`. The returned `auth` object includes `lastSeenSeq` only when the argument is defined and finite (no field when undefined).
- [ ] `socketOptions.ts` does NOT add an import of `storage.ts` (cycle risk verified by Codex review).
- [ ] In `packages/happy-app/sources/sync/apiSocket.ts` at the connect site (~line 217 in the existing `connect(machineId?)` loop), read `storage.getState().lastSeenUpdateSeqByMachineId[connection.config.credentials.machineId]` and pass it as the third argument to `buildTunnelSocketOptions`.
- [ ] Unit test (`socketOptions.test.ts`): `buildTunnelSocketOptions(creds, 'mA', 42)` returns an `auth` object with `lastSeenSeq: 42`. Same call with the third argument omitted produces an `auth` object without a `lastSeenSeq` field (back-compat).
- [ ] Unit test (`apiSocket.test.ts`): initialize two MachineConnections (A and B) and seed storage with `{ mA: 10, mB: 20 }`; call connect; assert each socket received its own per-machine seq in handshake auth (10 for A, 20 for B).
- [ ] Existing socketOptions and apiSocket tests stay green.
- [ ] Typecheck passes for `packages/happy-app`.
- [ ] Tests pass.

### US-005: Client handleUpdate persistence + replay-overflow handler + onReconnected gating

**Description:** As happy-app, I want `handleUpdate` to persist the last applied seq safely across both synchronous-apply and invalidate-deferred branches, install a `replay-overflow` handler that falls back to HTTP, and stop unconditionally calling `sessionsSync.invalidate()` on reconnect.

**Acceptance Criteria:**
- [ ] In `packages/happy-app/sources/sync/sync.ts`, `handleUpdate(update, isReplay, sourceMachineId)` persists `lastSeenUpdateSeqByMachineId[sourceMachineId] = updateData.seq` at the successful tail, gated on `sourceMachineId && typeof updateData.seq === 'number'`.
- [ ] For synchronous-apply branches (`update-session`, `update-account`, `update-machine`, `delete-machine`, and the `new-message` apply path against a known session), the persist call runs directly at the tail.
- [ ] For invalidate-deferred branches (`new-session` and `delete-session`), the existing fire-and-forget `sessionsSync.invalidate()` is replaced with `sessionsSync.invalidateAndAwait()`; the returned promise is captured locally and the tail-persist is chained via `deferredInvalidate.then(() => storage.getState().setLastSeenUpdateSeq(sourceMachineId, updateData.seq))`.
- [ ] For the `new-message` early-return-on-missing-session path (which already calls `invalidateAndAwait().finally(...)`), chain the persist inside that existing `.finally` (after the pending-replay loop) and `return` without falling through to the tail. When `isReplay === true` on that path, the existing log+drop behavior stays and no persist runs.
- [ ] Persistence is skipped on `safeParse` validation-error early return (no setter call).
- [ ] Replayed events (`isReplay === true`) that reach the successful tail DO persist.
- [ ] Inline comment at the tail-persist site explains why persist must run after the branch's effects (apply* sink OR invalidate fetch) have committed.
- [ ] `apiSocket.onMessage('replay-overflow', (data, machineId) => …)` handler is registered near the existing `onMessage('update', ...)` registration. Handler calls `this.sessionsSync.invalidateAndAwait()`; on resolve, if `typeof data?.currentSeq === 'number'`, calls `storage.getState().setLastSeenUpdateSeq(machineId, data.currentSeq)`. On rejection, the setter is NOT called.
- [ ] `apiSocket.onReconnected((machineId) => …)` body is rewritten: always call `this.machinesSync.invalidate()`; then read `storage.getState().lastSeenUpdateSeqByMachineId[machineId]` — if `undefined`, call `this.sessionsSync.invalidate()` (first-connect-per-daemon path); if a finite number, do NOT call `sessionsSync.invalidate()` (resume path relies on server replay or the `replay-overflow` handler).
- [ ] Inline comment in `onReconnected` references the WS3 gating decision.
- [ ] Unit test (synchronous-apply branch + new-session combined per F-012): invoke `Sync.handleUpdate` 3 times with seqs 1, 2, 3 and `sourceMachineId='mA'` covering `update-session` against a known session AND at least one `new-session` event; after each call, `storage.getState().lastSeenUpdateSeqByMachineId['mA']` equals the latest seq once the relevant promise (if any) has resolved.
- [ ] Unit test (invalidate-deferred branch): invoke `handleUpdate` with a `new-session` event and `sessionsSync.invalidateAndAwait` stubbed to return a pending promise; assert the setter has NOT been called yet. After resolving the promise, assert the setter has been called with the correct seq.
- [ ] Unit test (validation failure): invoke `handleUpdate` with a payload that fails `safeParse`; assert the setter is NOT called.
- [ ] Unit test (`replay-overflow` handler): receiving the event with `{ replayOverflow: true, currentSeq: 42 }` calls `sessionsSync.invalidateAndAwait`; on resolve, the setter is called with `42`. Per F-013, on rejection the setter is NOT called.
- [ ] Unit test (`onReconnected` first-connect branch): when `lastSeenUpdateSeqByMachineId[machineId]` is `undefined`, `sessionsSync.invalidate` is invoked exactly once AND `machinesSync.invalidate` is invoked exactly once.
- [ ] Unit test (`onReconnected` resume branch): when `lastSeenUpdateSeqByMachineId[machineId]` is a finite number (seed storage with e.g. `42`), `sessionsSync.invalidate` is NOT invoked (spy call count 0); `machinesSync.invalidate` is still invoked exactly once.
- [ ] Existing sync/socket tests stay green.
- [ ] Typecheck passes for `packages/happy-app`.
- [ ] Tests pass.

### US-006: Documentation updates

**Description:** As a future contributor or reviewer, I want the WS3 design, invariants, and accepted v1 trade-offs documented in the project's living docs.

**Acceptance Criteria:**
- [ ] `packages/happy-server/CLAUDE.md` gains a "Ring buffer" subsection documenting: the flat `BufferedUpdate[]` + `let currentSeq` shape (NOT keyed by userId); cap-only retention at 1024; single-process / cross-cluster Redis deferred; `allocateUserSeq` before `emitUpdate` ordering invariant; and the one-user-per-daemon deployment invariant with the escape-hatch note (re-introduce userId-keying + per-account `allocateUserSeq` if the invariant is ever relaxed). Cross-reference `packages/happy-cli/src/daemon/dualListenerBinding.ts` and `sources/storage/seq.ts`.
- [ ] `packages/happy-app/CLAUDE.md` gains a note documenting: `lastSeenUpdateSeqByMachineId` is per-daemon and tracks `updateData.seq` (account-global per daemon), not `session.seq`; the `onReconnected` gating change (invalidate iff stored seq is undefined; resume reconnects rely on server replay; cap-overflow triggers the `replay-overflow` handler); the **accepted per-event MMKV write rate** as a v1 trade-off (F-008) with the monotonic setter's no-op-on-regressing guard as the mitigation; and the asymmetric design (client IS per-machine because it talks to many daemons; server is NOT per-user because each daemon serves only its single owner).
- [ ] `plans/realtime-sync-perf.md` §Workstream 3 gains a footer line "Status: implemented YYYY-MM-DD in commit `<sha>`" with cross-references to the touched files.
- [ ] Typecheck passes (docs only — no code changes).

### US-007: Verification — combined test + cross-package typecheck

**Description:** As a reviewer, I want all WS3 tests across both packages to pass and cross-package typecheck baselines to stay green.

**Acceptance Criteria:**
- [ ] Combined vitest command runs cleanly from PowerShell-friendly path: `pnpm --filter '{packages/happy-server}' --filter '{packages/happy-app}' exec vitest run 2>&1 | tee ./tmp/codexu-ws3.log`.
- [ ] `tmp/` is present in `.gitignore` (add it if not).
- [ ] The vitest output preserved at `./tmp/codexu-ws3.log` ends with "0 failed".
- [ ] Cross-package typecheck baselines green: `pnpm --filter '{packages/happy-server}' exec tsc --noEmit`, `pnpm --filter '{packages/happy-cli}' exec tsc --noEmit`, `pnpm --filter '{packages/happy-agent}' exec tsc --noEmit`, `pnpm --filter '{packages/happy-wire}' exec tsc --noEmit`, `pnpm --filter '{packages/happy-app}' exec tsc --noEmit`.
- [ ] Single commit on `main` using the repo's `refactor(devtunnels): …` / `fix(devtunnels): …` convention (per `plans/realtime-sync-perf.md` after-step guidance).

## Functional Requirements

- FR-1: Each happy-server daemon maintains a module-scoped flat ring buffer of `BufferedUpdate` entries (cap 1024, cap-only retention) and a module-scoped `currentSeq` integer that advances on every `emitUpdate`.
- FR-2: `EventRouterSink.emitUpdate` appends to the ring buffer strictly after `allocateUserSeq` has minted the seq, using the same resolved `recipientFilter` (default `{ type: 'all-user-authenticated-connections' }`) that drives the live publish path.
- FR-3: `EventRouterSink.getReplayForConnection(lastSeenSeq, connection)` returns `{ events, overflow, currentSeq }`. Overflow is true on cap-overflow (`buffer non-empty && lastSeenSeq < replayBuffer[0].payload.seq`) OR daemon-restart (`currentSeq > 0 && lastSeenSeq > currentSeq`). Non-overflow returns the subset of buffered entries with `payload.seq > lastSeenSeq` whose stored `recipientFilter` matches the reconnecting connection via `doesFilterMatchConnection`.
- FR-4: `doesFilterMatchConnection(filter, connection)` mirrors `getRoomsForFilter`'s room-derivation rules for all four `RecipientFilter` types. Cross-reference comments at both sites enforce the lockstep invariant.
- FR-5: The socket connection handler in `socket.ts` reads `socket.handshake.auth.lastSeenSeq`. If finite, it calls `getReplayForConnection(lastSeenSeq, connection)` and either emits exactly one `replay-overflow` event with `{ replayOverflow: true, currentSeq }` (on overflow) or emits `socket.emit('update', evt)` for each returned event in ascending seq order.
- FR-6: The client persists `lastSeenUpdateSeqByMachineId: Record<string, number>` in MMKV via `storage.ts` + `persistence.ts`. The setter is `Math.max`-gated (regressing writes are no-ops on both zustand and MMKV) and write-through to MMKV only happens when the value advances.
- FR-7: `buildTunnelSocketOptions(credentials, machineId, lastSeenSeq?)` includes `lastSeenSeq` in `auth` only when defined and finite. `apiSocket.connect()` reads `storage.getState().lastSeenUpdateSeqByMachineId[machineId]` at connect time and passes it through. `socketOptions.ts` does not import `storage.ts`.
- FR-8: `Sync.handleUpdate` persists the seq at the successful tail. Synchronous-apply branches persist directly; invalidate-deferred branches (`new-session`, `delete-session`) switch to `invalidateAndAwait()` and chain the persist via `.then(...)`. The `new-message` early-return-on-missing-session path chains the persist inside the existing `.finally(...)`. Validation-error early returns do NOT persist. Replayed events that reach the tail DO persist.
- FR-9: `apiSocket.onMessage('replay-overflow', …)` calls `sessionsSync.invalidateAndAwait()`; on resolve, calls `setLastSeenUpdateSeq(machineId, data.currentSeq)`; on rejection, does NOT update the seq.
- FR-10: `apiSocket.onReconnected(machineId)` always calls `machinesSync.invalidate()`. It calls `sessionsSync.invalidate()` iff `storage.getState().lastSeenUpdateSeqByMachineId[machineId]` is `undefined` (first-connect-per-daemon); otherwise it does NOT call `sessionsSync.invalidate()`.
- FR-11: All of WS3 lands as a single commit on `main` (no feature branch, no worktree). The commit message follows the repo's `refactor(devtunnels): …` / `fix(devtunnels): …` convention.

## Non-Goals (Out of Scope)

- Per-chat handshake state (already covered by existing `session.seq` pagination on overflow fallback).
- Cross-daemon / cross-cluster Redis coordination of buffers.
- Promoting `MAX_REPLAY_BUFFER` to an env-config knob.
- Refactoring `allocateUserSeq` to be per-account or DB-backed.
- UserId-keyed replay state (`Map<userId, ...>`) — out of scope per the one-user-per-daemon simplification.
- Opportunistic age-eviction (60s drop-from-head). Cap-only retention is the single retention mechanism.
- Workstream 4 (socket-only `fetchSessions` replacement).
- Eviction policy on permanent user disconnect or app uninstall.
- Calling `machinesSync.invalidate()` from inside the `replay-overflow` handler (advisory F-018, not adopted in v1).

## Technical Considerations

- **One-user-per-daemon deployment invariant.** Each happy-cli daemon binds its embedded happy-server to a single operator's identity (`packages/happy-cli/src/daemon/dualListenerBinding.ts:36-73`). `allocateUserSeq` is module-global and ignores its `_accountId` argument (`packages/happy-server/sources/storage/seq.ts:6,12-15`). Together these license the flat (non-keyed) replay state.
- **No reordering of `allocateUserSeq` and `emitUpdate`.** Buffer append goes inside `emitUpdate`, strictly after seq allocation. Document with an inline comment at the new append site.
- **`socketOptions.ts` must not import `storage.ts`.** The load path is storage → sync → apiSocket → socketOptions; importing storage from socketOptions reintroduces the cycle. Pass `lastSeenSeq` as a parameter from `apiSocket.connect()`.
- **`replay-overflow` is out-of-band.** It does not ride inside an `update` envelope and does not need a zod schema in `apiTypes.ts`. The client handler registers via `apiSocket.onMessage('replay-overflow', ...)` and the payload is a plain `{ replayOverflow: true, currentSeq: number }`.
- **Monotonic setter is load-bearing.** The socket dispatch path does not await `handleUpdate`, so async tail-persist calls for seqs 6..10 can complete out of order. A blind setter could regress the stored value. The `Math.max`-gated setter lives centrally in `storage.ts` so no call site needs its own guard.
- **Persist-after-effects rule.** Persisting at the tail of `handleUpdate` is safe for synchronous-apply branches; for `new-session` / `delete-session` / `new-message`-missing-session paths the data fetch happens inside a deferred `invalidate` promise, so the persist must chain on `.then(...)` / `.finally(...)`. Persisting earlier permanently skips the update on the next reconnect.
- **Daemon-restart seq reset.** `allocateUserSeq` resets to 0 on daemon restart. The `currentSeq` module-scoped tracker makes `lastSeenSeq > currentSeq → overflow` decisive even when the buffer is empty (immediately post-restart before any new emit).
- **`recipientFilter` lockstep.** `doesFilterMatchConnection` must mirror `getRoomsForFilter` exactly — cross-reference comments at both sites are required.

## Success Metrics

- Reconnects with a stored `lastSeenSeq` no longer trigger HTTP refresh in the steady-state (verified via the resume-branch unit test on `onReconnected`).
- Replay correctness: the recipientFilter matrix test covers every connection-type × filter-type combination.
- All unit tests across `packages/happy-server` and `packages/happy-app` pass; cross-package typechecks stay green.
- WS3 ships as a single commit on `main` matching the repo's `refactor(devtunnels): …` / `fix(devtunnels): …` convention.

## Open Questions

- **Daemon-restart seq reset:** plan adopts `lastSeenSeq > currentSeq → overflow`. If operator instrumentation later shows this is too aggressive, a `seqEpoch` field in the handshake is the follow-up.
- **`replay-overflow` event name:** assumed unused; verify with grep during US-002. If collision exists, rename (e.g., `update-replay-overflow`).
- **MAX_REPLAY_BUFFER tuning:** kept at 1024 const; promotable to env config if v1 measurement shows it is wrong.
- **One-user-per-daemon invariant:** if happy-server ever supports multi-operator deployments, re-introduce userId-keying on the buffer + `currentSeq` and refactor `allocateUserSeq` to be per-account.
