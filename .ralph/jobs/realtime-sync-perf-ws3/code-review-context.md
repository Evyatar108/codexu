# Code Review Context (WS3)

Patterns and cross-cutting concerns observed during this review. Not findings — context for future reviewers / fixers.

## Codebase conventions touched by WS3

- **Server scope:** happy-server runs embedded inside each happy-cli daemon (one user per process). The `userId` plumbing throughout `packages/happy-server/sources/` is dead-weight tracked for cleanup as `userid-cleanup` in `plans/parallel-assignments.md` — WS3 must NOT re-key state by userId for the same reason. The flat replay buffer + single `currentSeq` integer in `eventRouter.ts:218-223` is the documented shape (see `packages/happy-server/CLAUDE.md` "Ring buffer replay state").
- **`allocateUserSeq` is process-global, in-memory, resets on daemon restart** (`packages/happy-server/sources/storage/seq.ts:6,12-15`). This is the structural reason `currentSeq` is module-scoped (not DB-backed) and why daemon-restart overflow (Risk #7) is detectable. The reset-on-restart property is also what creates F-001's recovery hazard.
- **`getRoomsForFilter` ↔ `doesFilterMatchConnection` parity** (eventRouter.ts:369-398). The pair must stay in lockstep — both have cross-reference comments. WS3 added `doesFilterMatchConnection` and the implementation is structurally correct, but any future addition of a `RecipientFilter` variant requires updating BOTH functions or replay will diverge from live publish.
- **`setLastSeenUpdateSeq` is the single monotonic gate** (`packages/happy-app/sources/sync/storage.ts:1050-1063`). The plan documents this as "load-bearing" — no caller needs its own Math.max. The corollary is that the setter is INVALID for the daemon-restart recovery case (F-001), because that case requires regression. The plan never resolved this tension and the implementation took the "always monotonic" path, leaving F-001 unmitigated.
- **`updateData.seq` (account-global per daemon) vs `session.seq` (session-local DB-backed)** are NEVER conflated in the touched code. WS3's lastSeenUpdateSeq tracks the former; pagination uses the latter. The inline NOTE comments at sync.ts:1745-1751 and sync.ts:1836-1837 enforce this invariant.

## Cross-cutting concerns

- **`.finally()` vs `.then()` semantics** (F-002): `.finally()` runs on both resolve and reject; `.then()` only on resolve. The new-message missing-session path at sync.ts:1721-1729 uses `.finally()`, which is correct ONLY if you want the persist to run regardless of whether the queued events applied. WS3's intent (per Risk #8) is the opposite: persist only after success. The `delete-session` and tail-deferred paths at sync.ts:1964 correctly use `.then()`.
- **addConnection-before-replay ordering** (F-003): The handshake replay logic was added to the connection handler AFTER `addConnection`. The plan diagrammed "parse auth.lastSeenSeq, invoke replay on connect" without specifying the ordering relative to room join. The implementation chose the natural read order (connect → join rooms → replay), which exposes the live-vs-replay race. A reviewer should look for similar ordering hazards anywhere `eventRouter.addConnection` is followed by a synchronous read from the router's mutable state.
- **Unhandled promise rejection consistency** (F-004): The codebase has two reference patterns — the replay-overflow handler at sync.ts:1645-1652 uses `.catch(...)` and is correct; the deferred-invalidate tail at sync.ts:1964-1966 omits `.catch()` and creates a hazard. A future audit should grep for `void.*\.then\(` without a corresponding `.catch` in sync.ts handlers.
- **Commit-scope discipline** (F-005): The plan and job CLAUDE.md explicitly require "ONE commit on `main`". The implementation bundled ~7 unrelated test-baseline fixes plus a source fix in `refreshClaim.ts`. The bundling is justified by the combined-Vitest gate (which required unrelated stale tests to pass before WS3's evidence could land), but the plan never licensed it. Future WS commits should call out "Also includes:" sections when this is unavoidable.

## Test coverage gaps (informational)

- F-001's daemon-restart-after-overflow regression case is not tested (no `sync.test.ts` case seeds a stored seq above the daemon's `currentSeq` and verifies recovery).
- F-002's "invalidateAndAwait rejects" and "replayed event hits still-missing drop" cases are not tested. The current sync.test.ts only covers the resolve path.
- F-003's addConnection ordering is not tested in `socket.spec.ts` — the suite asserts call argument shapes but not call order relative to addConnection.
- F-004 (unhandled rejection) is a property test — Vitest can assert via `process.once('unhandledRejection', ...)` but no such test exists.

## File relationships (touched by WS3)

- `eventRouter.ts` (server state + replay logic) ↔ `socket.ts` (handshake wiring) ↔ `eventRouter.test.ts` + `socket.spec.ts` (tests).
- `storage.ts` (state + monotonic setter) ↔ `persistence.ts` (MMKV load/save) ↔ `storageLastSeenUpdateSeq.test.ts` (storage tests).
- `socketOptions.ts` (handshake auth builder, no storage import — cycle-safe) ← `apiSocket.ts` (reads storage at connect, passes to socketOptions) ← `sync.ts` (registers replay-overflow handler, handleUpdate persist, onReconnected gating).
- `plans/realtime-sync-perf.md` (workstream tracker, footer placeholder issue F-006), `packages/happy-server/CLAUDE.md` + `packages/happy-app/CLAUDE.md` (doc updates from US-006).
