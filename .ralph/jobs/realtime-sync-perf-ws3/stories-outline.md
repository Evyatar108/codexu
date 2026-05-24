# Stories Outline: Realtime Sync Perf — WS3 Replay Buffer + lastSeenSeq Handshake

*Preliminary decomposition from `/plan-with-ralph`. Post-approval revision 2026-05-13: dropped userId-keying from server state per architectural simplification (one user per daemon). Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> **Single-commit deliverable.** Per the feature request and `plans/realtime-sync-perf.md` convention, all of WS3 lands as a single commit on `main`. The stories below are review-time chunks within that commit, not independent commits.

## US-001: Server ring buffer + currentSeq tracker in EventRouter
**Description:** As a happy-server daemon, I want to retain the last 1024 emitted `update` events (plus a parallel current-seq integer) so that a reconnecting client can resume from a known `lastSeenSeq` without an HTTP re-fetch. Because each daemon serves exactly one operator (one-user-per-daemon deployment invariant), no userId-keying is needed.
**Acceptance Criteria:**
- [ ] `eventRouter.ts` adds module-scoped state: a flat `replayBuffer: BufferedUpdate[]` (`BufferedUpdate = { payload, recipientFilter, createdAt }`) AND a module-scoped `let currentSeq = 0;` integer. Neither is keyed by userId.
- [ ] `appendToReplayBuffer(payload, recipientFilter)` is invoked inside `EventRouterSink.emitUpdate` strictly after seq allocation; pushes to the array, drops the oldest when `length > 1024`, and writes `currentSeq = payload.seq` in lockstep.
- [ ] `getReplayForConnection(lastSeenSeq, connection)` returns `{ events, overflow, currentSeq }` with overflow logic: `(currentSeq > 0 && lastSeenSeq > currentSeq)` OR `(buffer non-empty && lastSeenSeq < replayBuffer[0].payload.seq)`.
- [ ] Cap-only retention at 1024 entries (no age eviction).
- [ ] Private helper `doesFilterMatchConnection(filter, connection)` mirrors `getRoomsForFilter` mapping for all four `RecipientFilter` types; in-line cross-reference comment at both sites.
- [ ] Inline comment at the module-scoped declarations explains the flat-buffer rationale (one-user-per-daemon deployment invariant) and the consequence if that invariant is ever relaxed.
- [ ] Unit test: emit 10 events, reconnect with `lastSeenSeq=5` from user-scoped connection → events 6..10 returned in order; other previously-attached connections do not receive replay events.
- [ ] Unit test: emit 2000 events → buffer length is 1024, oldest seq is 977.
- [ ] Unit test: `lastSeenSeq=0` against buffer whose oldest is 977 → overflow=true with `currentSeq=2000`.
- [ ] Unit test: `recipientFilter` matrix — emit mix of all four filter types; reconnect with each of user/session/machine connection shapes → only matching entries returned.
- [ ] Unit test: daemon-restart shape — three cases: (i) buffer non-empty + `lastSeenSeq > currentSeq` → overflow; (ii) buffer force-cleared, `currentSeq` retained, `lastSeenSeq > currentSeq` → overflow; (iii) fresh daemon (buffer empty, `currentSeq === 0`), `lastSeenSeq=10` → no-op (not overflow).
- [ ] Typecheck green for `packages/happy-server`.
**Dependencies:** None.
**Estimated complexity:** medium

## US-002: Server socket handshake wiring + mandatory socket.spec.ts coverage
**Description:** As a happy-server daemon, I want to read `socket.handshake.auth.lastSeenSeq` on connect and dispatch to the replay path so the buffer's behavior is reachable end-to-end.
**Acceptance Criteria:**
- [ ] `socket.ts` connection handler (after `eventRouter.addConnection`): if `socket.handshake.auth.lastSeenSeq` is a finite number, call `eventRouter.getReplayForConnection(lastSeenSeq, connection)`; on overflow, `socket.emit('replay-overflow', { replayOverflow: true, currentSeq })`; else emit each event with `socket.emit('update', evt)` in seq order.
- [ ] Supported for all three connection types (user/session/machine-scoped) since filter matching now suppresses non-applicable entries.
- [ ] `socket.spec.ts` (**mandatory** per F-007): three test cases — (i) `auth.lastSeenSeq=5` against buffer 1..10 → `getReplayForConnection` called once + update emit for 6..10 in order + no overflow; (ii) no `auth.lastSeenSeq` → `getReplayForConnection` not called + no replay-overflow; (iii) `auth.lastSeenSeq=5000` vs buffer oldest=100 → `replay-overflow` emit with `{ replayOverflow: true, currentSeq }`, no update emits.
- [ ] Existing socket.spec.ts tests stay green.
- [ ] Grep verifies `'replay-overflow'` event name is not already used.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Client MMKV persistence — lastSeenUpdateSeqByMachineId + monotonic setter
**Description:** As happy-app, I want to persist the per-daemon highest applied `update.seq` to MMKV with a monotonic guarantee so async out-of-order replay handlers cannot regress the stored value. Client state is per-machine because happy-app talks to many independent daemons (each with its own seq counter).
**Acceptance Criteria:**
- [ ] `storage.ts` adds `lastSeenUpdateSeqByMachineId: Record<string, number>` to `StorageState`; initialized from MMKV via new load helper.
- [ ] `setLastSeenUpdateSeq(machineId, seq)` setter implements `Math.max(existing ?? 0, seq)`; writes through to MMKV only when the value actually advances (regressing/duplicate writes are no-ops on both zustand and MMKV).
- [ ] `persistence.ts` adds `loadLastSeenUpdateSeqByMachineId()` and `saveLastSeenUpdateSeqByMachineId(map)` following the existing per-key helper pattern.
- [ ] Unit test: setter writes to MMKV and load returns the persisted map.
- [ ] Unit test: monotonic guarantee — write 10 then 6, value stays 10, MMKV saved exactly once; write 11, value advances to 11, MMKV saved.
**Dependencies:** None.
**Estimated complexity:** small

## US-004: Client socketOptions parameter + apiSocket connect-time wiring
**Description:** As happy-app, I want each per-daemon socket's handshake auth to include its own daemon's last-seen seq so the server can replay correctly without the client importing storage from socketOptions.
**Acceptance Criteria:**
- [ ] `socketOptions.ts` signature changes to `buildTunnelSocketOptions(credentials, machineId = credentials.machineId, lastSeenSeq?: number)`. Auth object includes `lastSeenSeq` only when defined and finite.
- [ ] `apiSocket.ts` at connect site reads `storage.getState().lastSeenUpdateSeqByMachineId[connection.config.credentials.machineId]` and passes it as the third argument. No new storage import — `storage` is already in apiSocket.
- [ ] Unit test (`socketOptions.test.ts`): `buildTunnelSocketOptions(creds, 'mA', 42)` returns auth with `lastSeenSeq: 42`; same call with `lastSeenSeq` undefined produces auth without the field (back-compat).
- [ ] Unit test (`apiSocket.test.ts`, per F-015): initialize two MachineConnections (A and B); seed storage `{ A: 10, B: 20 }`; call connect; assert each socket received its own per-machine seq (10 for A, 20 for B).
**Dependencies:** US-003
**Estimated complexity:** small

## US-005: Client handleUpdate persistence + replay-overflow handler + onReconnected gating
**Description:** As happy-app, I want `handleUpdate` to persist the last applied seq safely across both synchronous-apply and invalidate-deferred branches, install a `replay-overflow` handler that falls back to HTTP, and stop unconditionally calling `sessionsSync.invalidate()` on reconnect.
**Acceptance Criteria:**
- [ ] `handleUpdate(update, isReplay, sourceMachineId)`: persist `lastSeenUpdateSeqByMachineId[sourceMachineId] = updateData.seq` at the successful tail. For synchronous-apply branches (`update-session`, `update-account`, `update-machine`, `delete-*`, `new-message` against a known session), persist directly. For invalidate-deferred branches (`new-session`, `new-message` against an unknown session): switch the existing fire-and-forget `sessionsSync.invalidate()` to `sessionsSync.invalidateAndAwait()` and chain the persist on `.then(...)`. Persistence is skipped on `safeParse` validation-error early return.
- [ ] `apiSocket.onMessage('replay-overflow', (data, machineId) => …)` handler: calls `sessionsSync.invalidateAndAwait()`; on resolve, updates `lastSeenUpdateSeqByMachineId[machineId] = data.currentSeq`. On rejection, the seq is NOT updated.
- [ ] `apiSocket.onReconnected(machineId)` rewritten: always calls `machinesSync.invalidate()`; calls `sessionsSync.invalidate()` IFF `storage.getState().lastSeenUpdateSeqByMachineId[machineId]` is undefined; otherwise no-op for sessions.
- [ ] Unit test: synchronous-apply branch — handleUpdate 3× with seqs 1, 2, 3 against a known session; setter sees each. Per F-012, also include one `new-session` event in the sequence to cover both branches in the same test.
- [ ] Unit test: invalidate-deferred branch — handleUpdate with `new-session` event; with pending invalidateAndAwait promise, setter has NOT fired; on resolve, setter has fired with the correct seq.
- [ ] Unit test: validation failure — handleUpdate with malformed payload; setter does NOT fire.
- [ ] Unit test: `replay-overflow` handler triggers `sessionsSync.invalidateAndAwait`; on resolve, setter fires with `currentSeq`. Per F-013, on rejection assert setter is NOT called.
- [ ] Unit test: `onReconnected` first-connect branch — slot undefined → `sessionsSync.invalidate` fires exactly once + `machinesSync.invalidate` fires.
- [ ] Unit test: `onReconnected` resume branch — slot is `42` → `sessionsSync.invalidate` does NOT fire (spy call count 0) + `machinesSync.invalidate` fires.
**Dependencies:** US-003, US-004
**Estimated complexity:** large

## US-006: Documentation updates
**Description:** As a future contributor / reviewer, I want the WS3 design, invariants, and accepted v1 trade-offs documented in the project's living docs.
**Acceptance Criteria:**
- [ ] `packages/happy-server/CLAUDE.md` — add "Ring buffer" subsection: state shape (flat `BufferedUpdate[]` + `let currentSeq` integer, NOT keyed by userId), cap-only retention rule, single-process / cross-cluster deferred note, allocateUserSeq-before-emitUpdate ordering invariant, one-user-per-daemon deployment invariant + escape hatches (re-introduce userId-keying + per-account `allocateUserSeq`) if invariant is ever relaxed.
- [ ] `packages/happy-app/CLAUDE.md` — note `lastSeenUpdateSeqByMachineId` is per-daemon, tracks `updateData.seq` (account-global per daemon), not `session.seq`. Document the `onReconnected` gating change. Document the **accepted per-event MMKV write rate** as a v1 trade-off (F-008 acceptance), with the monotonic setter's no-op-on-regressing guard as the mitigation. Note the asymmetric design: client IS per-machine (talks to many daemons, each independent seq) but server is NOT per-user (each daemon serves one user).
- [ ] `plans/realtime-sync-perf.md` §Workstream 3 — append "Status: implemented YYYY-MM-DD in commit `<sha>`" footer cross-referencing touched files.
**Dependencies:** US-001..US-005 (docs reflect what landed)
**Estimated complexity:** small

## US-007: Verification — combined test + cross-package typecheck
**Description:** As a reviewer, I want all WS3 tests across both packages to pass and cross-package typecheck baselines to stay green.
**Acceptance Criteria:**
- [ ] Combined vitest command runs cleanly:
  ```bash
  pnpm --filter '{packages/happy-server}' --filter '{packages/happy-app}' exec vitest run 2>&1 | tee ./tmp/codexu-ws3.log
  ```
  (per F-014: repo-relative `./tmp/codexu-ws3.log` is Windows-compatible from PowerShell; add `tmp/` to `.gitignore` if not already present).
- [ ] All vitest output ends with "0 failed".
- [ ] Cross-package typecheck baselines green: `happy-server`, `happy-cli`, `happy-agent`, `happy-wire`, `happy-app`.
- [ ] Single commit on `main` with message following the repo's `fix(devtunnels): …` / `refactor(devtunnels): …` convention.
**Dependencies:** US-001..US-006
**Estimated complexity:** small
