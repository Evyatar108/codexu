# Research Brief — session-parent-link-writer

## Feature Request (verbatim)
See `feature-request.txt`. Summary: wire the CLI writer side for the `parentSessionId` + `spawnedChildren[]` metadata fields shipped read-only by commit `11c3eafb`. Today, schema accepts the fields and the read helpers work end-to-end, but no code populates them on the wire, so storage round-trips empty/null defaults forever.

---

## Researcher Findings

### What's already implemented (read side, shipped in 11c3eafb)

**Schema + types**:
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/storageTypes.ts:43-44` — `parentSessionId: z.string().nullish()`, `spawnedChildren: z.array(z.string()).optional()` on `MetadataSchema`.
- `D:/harness-efforts/codexu/packages/happy-cli/src/api/types.ts:679-680` — CLI `Metadata` type mirror with `parentSessionId?: string | null`, `spawnedChildren?: string[]`.

**Normalization (app side)**:
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/sync.ts:114-147` — `toCompositeRef()` + `normalizeMetadataParentChildRefs(raw, machineId)` private helpers. Bare ids → composite (`'abc'` → `'m1:abc'`); already-composite ids pass through.
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/sync.ts:634, 1851-1868` — called from `toCompositeSession()` and `update-session` handler. Promotion runs at ingress (initial fetch + live updates).

**Read helpers**:
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/storage.ts:1419-1438` — `getSessionParent(sid)`, `getSessionChildren(sid)`. Pure; return null/[]when missing.

**Sync invariants**:
- `D:/harness-efforts/codexu/packages/happy-app/CLAUDE.md:217-226` — composite-id requirement, server-authoritative semantics, normalization happens at ingress.

### What already exists on the writer side (partial)

- `D:/harness-efforts/codexu/packages/happy-cli/src/utils/createSessionMetadata.ts:72-98` — **ALREADY reads** `HAPPY_PARENT_SESSION_ID` env var and conditionally writes `parentSessionId` into the new session's metadata. **No changes needed here** (per architect's analysis).
- `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/forkSession.ts:177` — **ALREADY sets** `HAPPY_FORKED_FROM_SESSION_ID` env var on the spawned child process. **Gap**: does NOT also append the child's composite-sid into the parent's `spawnedChildren` after the child registers.
- `D:/harness-efforts/codexu/packages/happy-cli/src/api/apiSession.ts:993-1017` — `updateMetadata(handler: (Metadata) => Metadata): Promise<void>` already exists. CAS-style: handler receives current, returns new; transport is `socket.emitWithAck('update-metadata', { sid, expectedVersion, metadata: JSON.stringify(updated) })`; server responds `success | version-mismatch | error`; client retries via `backoff(...)` on version-mismatch.

### Already-shipped helpers (re-usable)

- `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/spawnSessionFromSession.ts:42-48` — `appendSpawnedChild(metadata, childCompositeSid)`: idempotent (uses `Array.includes`). **Already exists and is exported.**
- `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/spawnSessionFromSession.ts:50-86` — `validateSpawnAncestry(parentLocalId, machineId, getTrackedSession)`: parent-chain walk that rejects self-link, depth ≥ `MAX_SPAWN_DEPTH` (currently 10 — feature request asks for 16; reconcile). Already complete.
- `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/spawnSessionFromSession.ts:~150` — `updateParentMetadata(parentLocalId, tracked, patchFn)` — invokes `apiSession.updateMetadata` via temp `ApiSessionClient`. Used by `spawnSessionFromSessionHandler` at line 144 today.

### Composite-id system

- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/machineSessionId.ts` — `compositeSessionId()`, `parseCompositeSessionId()`. Format: `machineId:localId`.
- Storage canonical form: **always composite**. `metadata.parentSessionId` and `metadata.spawnedChildren[]` MUST be composite when written from CLI (the app ingress normalizes defensively, but CLI is the source).

### Test infrastructure (happy-cli)

- vitest. Existing tests near `daemon/forkSession.ts` and `daemon/spawnSessionFromSession.test.ts`. Pattern: `vi.spyOn(apiSession, 'updateMetadata')` or mock `ApiSessionClient` constructor for unit-level; integration tests use lightweight in-memory `TrackedSession` map.
- Existing read-side tests: `packages/happy-app/sources/sync/storage.parent-children.spec.ts`, `storage.applySessions.spec.ts`, `storageTypes.spec.ts`, `sync.test.ts` — comprehensive (round-trip, cross-machine, malformed input, idempotency, live updates).

### Cross-package typecheck

- `pnpm --filter happy-cli typecheck` and `pnpm --filter happy-app typecheck` (both run from repo root or from inside `packages/<pkg>/`).

### Plans & references

- `D:/harness-efforts/codexu/.ralph/jobs/session-parent-link/plan.md` — read-side plan, shipped. Open Questions #1 explicitly defers CLI writer wiring to "a separate writer task" (this one).
- `D:/harness-efforts/codexu/plans/agent-view-research.md:189-208` — §6 follow-up decomposition; marks `session-parent-link` as shipped (read side only).
- `D:/harness-efforts/codexu/plans/overview-data.js:1011-1021` — overview entry for `session-parent-link-writer`.

---

## Architect Analysis

### Three independent write points, three different lifecycles

#### Write Point A — happy-cli `daemon/forkSession.ts` (CLEAN — parent in env)
**File**: `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/forkSession.ts` (lines 63–200+).

**Lifecycle**: fork-session RPC from mobile → daemon spawns Codex subprocess with `HAPPY_FORKED_FROM_SESSION_ID=<parent-local-id>`.

**Gap**: parent's `spawnedChildren` is NOT updated post-spawn.

**Integration shape** (after successful spawn, around line ~180):
```typescript
if (childSessionResult.type === 'success') {
    const childCompositeSid = `${machineId}:${childSessionResult.sessionId}`;
    await updateParentMetadata(
        parentSessionId,
        tracked,
        (m) => appendSpawnedChild(m, childCompositeSid)
    );
}
```

`appendSpawnedChild` and `updateParentMetadata` both already exist in `spawnSessionFromSession.ts` (sibling file). No new helper needed; just import & call.

Note: `forkSession.ts` already sets the `HAPPY_FORKED_FROM_SESSION_ID` env var. The child reads this via `createSessionMetadata.ts` and writes `parentSessionId` to its own metadata at create. The forkSession addition is purely about updating the PARENT's `spawnedChildren`.

#### Write Point B — happy-cli daemon HTTP route `/spawn-session-from-session` (NEW HTTP HANDLER)
**File**: `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/controlServer.ts` (existing; needs new POST route).

**Lifecycle**: Codex Rust tool `spawn_top_level_session` → POST `HAPPY_DAEMON_CONTROL_URL/spawn-session-from-session` → daemon → spawn child → child reports back → daemon appends child to parent's `spawnedChildren`.

**Existing infrastructure**: `spawnSessionFromSessionHandler` in `apiMachine.ts:268-288` already does the work — it's invoked via RPC from the server today. The daemon's HTTP control server just needs a route that delegates to the same logic.

**Integration**:
```typescript
app.post('/spawn-session-from-session', async (req, res) => {
    const { parentSessionId: bareOrCompositeSid, config } = req.body;
    // normalize composite -> bare local id (validate machine match)
    // call spawnSessionFromSession(...) — already-tested function
    res.json(result);
});
```

Note: `spawnSessionFromSession` already calls `validateSpawnAncestry` + `appendSpawnedChild` via `updateParentMetadata`. The HTTP route is glue only.

**ASSUMPTION TO VERIFY**: The architect claims the HTTP `/spawn-session-from-session` route is missing today. Confirm before plan ships — recent git log shows `da9bec84 docs: [F-002] - add /spawn-session-from-session to daemon HTTP route enumeration` and `60bc4777 fix: [F-008] - eliminate spawn-from-session handler race in startDaemon`, which suggest the route exists. The plan must `grep '/spawn-session-from-session' packages/happy-cli/src/daemon/controlServer.ts` (or wherever the daemon control-server routes are mounted) early and treat this story as either "wire-up" or "no-op" depending on the answer.

#### Write Point C — happy-cli `codex/runCodex.ts` (NO NEW CODE NEEDED)
**Architect's finding**: `runCodex.ts` does not need changes. The Codex sub-agent spawn flow today is:
1. Codex Rust tool POSTs to daemon `/spawn-session-from-session`
2. Daemon route (Write Point B above) handles it
3. `spawnSessionFromSessionHandler` env-passes `HAPPY_PARENT_SESSION_ID=<parentCompositeSid>` to the child subprocess
4. Child reads env via `createSessionMetadata.ts`, sets `parentSessionId` at create
5. Parent's `spawnedChildren` is updated by the handler (same code path as Write Point B)

**Researcher's nuance**: confirm runCodex.ts does NOT need to bridge anything — the child subprocess gets `HAPPY_PARENT_SESSION_ID` directly from the daemon's `spawnSessionFromSession`, not via `runCodex.ts`. The plan must include a small verification story or step to confirm there isn't an additional code path inside `runCodex.ts` that spawns children outside the daemon route.

#### Write Point D — happy-app `sources/sync/ops.ts createSessionMetadata` (DEFERRED / OUT OF SCOPE)
**Architect's finding**: app-side `createSessionMetadata` for `spawn-from-app` is a separate task. The current feature is CLI-only.

**Decision in plan**: state explicitly that app-side spawn-from-app writer wiring is OUT OF SCOPE for this task, and link to the related future task in `plans/overview-data.js`.

### apiSession.updateMetadata semantics (confirmed)

- Partial-patch via handler function (caller returns full new metadata object).
- Full-document on wire (`JSON.stringify(updated)`).
- Optimistic concurrency (`expectedVersion`); server returns `version-mismatch` for re-read; client retries via `backoff(...)`.
- NOT array-append; caller must read-modify-write. `appendSpawnedChild` (idempotent via `includes`) handles this.
- Race safety: two writers racing to append two different children both succeed (one retries on version-mismatch, re-reads, re-merges).

### Cycle prevention (mostly already in place)

- Algorithm: `validateSpawnAncestry` walks up `metadata.parentSessionId` chain.
- Current limit: `MAX_SPAWN_DEPTH = 10` in `spawnSessionFromSession.ts`. Feature request says 16; reconcile in plan (recommend keeping 16 per feature request; bump the constant + comment with the limit).
- Cross-machine ancestors: walk stops (no visibility); not treated as cycle. Acceptable per design.
- Self-link (parent==child): rejected.
- Concurrent setters racing to set each other as parent: a known minor risk; both walks see no cycle at their time, both writes succeed → cycle exists in storage. App-layer must avoid; daemon writes deterministic cycle-check only.

### Composite ID canonical form (confirmed)

- Storage: **composite** (`machineId:localId`) for both `parentSessionId` and entries of `spawnedChildren`.
- App ingress defensively normalizes bare → composite via `normalizeMetadataParentChildRefs` (sync.ts:114-147).
- CLI MUST write composite. Bare local IDs in the daemon (e.g., `childSessionResult.sessionId`) must be composited with `machineId` before storing.

### Integration test design

- Test framework: vitest.
- Patterns: spy/mock `apiSession.updateMetadata`; in-memory `TrackedSession` map for `validateSpawnAncestry` callers.
- Two suites:
  1. Fork integration: simulate `HAPPY_FORKED_FROM_SESSION_ID` fork; assert child has composite `parentSessionId`, parent's `spawnedChildren` includes new sid (composite form).
  2. Cycle test: prepare tracked sessions forming a chain; attempt to set a new parent that creates a cycle (or exceeds depth 16); assert rejection (typed error).

### Risk areas

| Risk | Severity | Mitigation |
|---|---|---|
| Read-modify-write race on `spawnedChildren` | Low | Idempotent `appendSpawnedChild` (includes-check) + server version-mismatch retry |
| Existing sessions with NULL `parentSessionId` | Low | Read helpers already guard `?. ?? null`; covered in shipped tests |
| `/spawn-session-from-session` HTTP route MISSING in daemon control server | **HIGH if true** | Plan must verify first; story sized for either "wire-up" or "verify-no-op" |
| Sub-agent thread handoff in runCodex.ts has SECOND, undocumented spawn path | Medium | Plan must grep `runCodex.ts` for child-process spawning + verify it routes through daemon `/spawn-session-from-session` |
| `MAX_SPAWN_DEPTH` mismatch (10 vs 16) | Trivial | Bump constant from 10 → 16 with comment; update existing tests that assert depth=10 |
| Forward-compat for older read clients | Very Low | Optional fields; older clients ignore |

### Architect's suggested story decomposition

- **Story 1**: forkSession writer — append child to parent's `spawnedChildren` after spawn success.
- **Story 2**: daemon HTTP `/spawn-session-from-session` route (verify exists → if not, add it).
- **Story 3**: runCodex sub-agent verification — confirm no extra spawn path; add test if needed.
- Stories 1 & 2 can run in parallel; Story 3 depends on Story 2 (test verifies the route works for Codex's HTTP POST).
- **Pre-flight verification story** (not in architect's split, but the discrepancy with recent commits demands it): confirm exact state of daemon `/spawn-session-from-session` route + cycle-detection constants.

---

## Codex Research
Failed: `Error: failed to spawn codex: spawn codex ENOENT` (codex CLI accessible from interactive shell but not from `child_process` spawn under Git Bash on Windows; likely needs `.cmd` shim). Not blocking — researcher + architect agents covered the same surface.

## Copilot Research
Failed: `Error: Model "gpt-5.5" from --model flag is not available.` (model name in `copilot-exec.sh` is stale relative to the installed copilot CLI). Not blocking — researcher + architect agents covered the same surface.

---

## Consolidated File List

### Files to modify (implementation)
- `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/forkSession.ts` — add `updateParentMetadata(... appendSpawnedChild ...)` call after child-spawn success
- `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/spawnSessionFromSession.ts` — bump `MAX_SPAWN_DEPTH` 10 → 16 (with comment documenting the limit)
- `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/controlServer.ts` — verify-or-add POST `/spawn-session-from-session` HTTP route
- (probably nothing in `runCodex.ts`; story 3 verifies)

### Files to consult (reference, do not modify)
- `D:/harness-efforts/codexu/packages/happy-cli/src/utils/createSessionMetadata.ts` — child writes `parentSessionId` from env (already correct)
- `D:/harness-efforts/codexu/packages/happy-cli/src/api/apiSession.ts` (993-1017) — `updateMetadata` signature
- `D:/harness-efforts/codexu/packages/happy-cli/src/api/apiMachine.ts` (221-288) — RPC boundary validation reference
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/storage.ts` (1419-1438) — read helpers (verify integration tests still pass)
- `D:/harness-efforts/codexu/packages/happy-app/CLAUDE.md` (217-226) — sync invariants
- `D:/harness-efforts/codexu/packages/happy-app/sources/sync/machineSessionId.ts` — composite ID helpers
- `D:/harness-efforts/codexu/.ralph/jobs/session-parent-link/plan.md` — read-side plan with deferred Open Questions

### Test files to create / update
- `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/forkSession.test.ts` (new or extend) — integration test: fork via HAPPY_FORKED_FROM_SESSION_ID asserts parent's spawnedChildren updated + child has parentSessionId
- `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/spawnSessionFromSession.test.ts` (existing) — bump cycle-depth test to 16; add cycle-rejection test for transitive ancestor
- (optionally) `D:/harness-efforts/codexu/packages/happy-cli/src/daemon/controlServer.test.ts` — assert POST `/spawn-session-from-session` route exists and dispatches correctly

### Documentation to update
- `D:/harness-efforts/codexu/packages/happy-cli/CLAUDE.md` — note daemon HTTP `/spawn-session-from-session` route purpose (if newly added); document cycle-depth limit
- `D:/harness-efforts/codexu/packages/happy-app/CLAUDE.md` (217-226) — note that CLI write path now populates the fields, not just app ingress
- `D:/harness-efforts/codexu/.ralph/jobs/session-parent-link/plan.md` — append a back-reference noting the writer task shipped (informational; orchestrator may handle this in their wrap-up)
