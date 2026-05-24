# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Pre-Interview | Post-Interview | Gap Resolved? |
|-----------|---------------|----------------|---------------|
| Goal | clear | clear | yes |
| Scope | partial | clear | yes |
| Criteria | partial | clear | yes |

## Clarifications

### 1. Retention rule
- **Decision:** Cap-only — drop oldest when buffer length > MAX_REPLAY_BUFFER (1024).
- **Why:** Matches the 2000-event overflow acceptance test naturally; avoids fake-timer-driven flake. Age threshold (MAX_REPLAY_AGE_MS) becomes opportunistic eviction at append time (drop head if older than 60s), but is not load-bearing for overflow detection.
- **Spec reconciliation:** the "whichever is larger" wording in the original spec is ambiguous against the 2000-event test. Operator confirmed cap-only is the intended semantics.

### 2. Client lastSeenUpdateSeq scoping
- **Decision:** Per-machine map keyed by sourceMachineId: `lastSeenUpdateSeqByMachineId: Record<string, number>`.
- **Why:** Verified by three independent agents (Explore × 2 + Codex). The architecture is multi-daemon: each remote dev machine runs its own embedded happy-server daemon (`packages/happy-cli/src/daemon/dualListenerBinding.ts:56-73`). Each daemon has its own in-memory `allocateUserSeq` counter that ignores its accountId arg and resets on restart (`packages/happy-server/sources/storage/seq.ts:6,12-15`). The happy-app holds `Map<machineId, MachineConnection>` (`packages/happy-app/sources/sync/apiSocket.ts:39-40,136,226`) with one Socket.IO per daemon. `update.seq` values overlap across daemon processes. A single global lastSeenSeq would conflate independent seq streams; per-machine is required for correctness.
- **Per-chat NOT in scope:** per-chat backfill is already handled by the DB-backed `session.seq` pagination machinery (`allocateSessionSeq` in `packages/happy-server/sources/storage/seq.ts:17-25` + `sessionLastSeq` / `oldestLoadedSeq` in storage.ts + `fetchMessages` / `loadOlder` paths). It is reached via the overflow-fallback path (`replay-overflow` → `sessionsSync.invalidateAndAwait()` → per-session pagination). Adding per-chat slots to the handshake would (a) duplicate existing state and (b) violate the `updateData.seq` vs `session.seq` invariant in `packages/happy-app/CLAUDE.md:162-163`.

### 3. Reconnect HTTP fallback gating
- **Decision:** In scope. `apiSocket.onReconnected(machineId)` stops calling `sessionsSync.invalidate()` unconditionally. Falls back to HTTP only on `replay-overflow` event or first-connect (no `lastSeenSeq` in storage for that machineId). `machinesSync.invalidate()` stays unconditional (replay covers `update` events but not presence/ephemerals).
- **Why:** without this gating, the ring buffer is a wire-bytes optimization but the HTTP-fetch cost remains on every reconnect — the perf-plan's stated win does not materialize.

## Remaining Open Questions
- **Buffer eviction on permanent disconnect:** if a user's app uninstalls / never reconnects, their per-userId buffer entry persists for the daemon's lifetime. Acceptable for now (daemon is single-user single-process in personal-fork posture; restart clears state). Document in CLAUDE.md.
- **MAX_REPLAY_BUFFER tuning:** kept as a `const` for v1; can be promoted to env config in a follow-up if operator instrumentation shows the 1024 default is wrong.
- **Multi-replica deferral:** ring buffer is single-process state. Per-daemon Redis adapter exists for Socket.IO room delivery but does not coordinate buffers. Multi-replica per-daemon is not a current shape; cross-cluster Redis coordination is explicitly deferred per the spec.
