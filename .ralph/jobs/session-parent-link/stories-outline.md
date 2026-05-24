# Stories Outline: session-parent-link

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Extend Metadata schema (app + CLI types)
**Description:** As the sync layer, I want the `Metadata` Zod schema and the CLI `Metadata` type to declare two new optional parent/child fields, so that the contract is in place before any wiring or helpers reference them.
**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/storageTypes.ts` `MetadataSchema` includes `parentSessionId: z.string().nullish()` and `spawnedChildren: z.array(z.string()).optional()`.
- [ ] `packages/happy-cli/src/api/types.ts` `Metadata` type includes `parentSessionId?: string | null` and `spawnedChildren?: string[]`.
- [ ] Schema does NOT inject a default (no `.default([])`); `undefined` is preserved on round-trip.
- [ ] `pnpm --filter happy-app typecheck` passes.
- [ ] `pnpm --filter happy-cli typecheck` passes.
- [ ] `pnpm --filter happy-wire typecheck` passes (sanity — no change expected).
**Dependencies:** None.
**Estimated complexity:** small.

## US-002: Shared composite-ID normalizer in sync.ts
**Description:** As the sync ingress layer, I want a single private helper that promotes bare parent/child refs in raw metadata to composite IDs (idempotent, shape-guarded), and I want both `toCompositeSession()` and the `update-session` handler to call it, so that the two ingress paths cannot drift.
**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/sync.ts` has a private `normalizeMetadataParentChildRefs(raw: unknown, machineId: string | null): unknown` helper.
- [ ] Helper checks `typeof === 'object'`, guards `typeof parentSessionId === 'string'` and `Array.isArray(spawnedChildren)`, leaves malformed entries unchanged.
- [ ] Helper only promotes refs lacking `:`; already-composite refs pass through.
- [ ] `toCompositeSession()` (line ~324) calls the helper after `parsePlainJson` and before assembling the composite session.
- [ ] `update-session` handler (line ~1816) calls the helper using machineId resolution order: (1) in-store session's `metadata.machineId`; (2) `parseCompositeSessionId(sessionId).machineId`; (3) skip promotion.
- [ ] Helper is idempotent: `normalize(normalize(x, m), m) === normalize(x, m)` (deep-equal).
- [ ] `pnpm --filter happy-app typecheck` passes.
**Dependencies:** US-001.
**Estimated complexity:** medium.

## US-003: Storage helpers — getSessionParent, getSessionChildren
**Description:** As a future tree-view consumer, I want pure top-level helpers that resolve a session's parent and children against the current store, so that I can navigate parent/child relationships without re-implementing lookup logic.
**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/storage.ts` exports `getSessionParent(sid: string): Session | null` and `getSessionChildren(sid: string): Session[]` as top-level functions.
- [ ] `getSessionParent` returns `null` when `parentSessionId` is `null`, `undefined`, or refers to a session not in the store.
- [ ] `getSessionChildren` returns resolved children in the order listed by `spawnedChildren`; missing children are filtered out; returns `[]` when `spawnedChildren` is `undefined` or empty.
- [ ] No changes to `applySessions` — metadata stays server-authoritative.
- [ ] Helpers are pure reads of `storage.getState()`; no side effects.
- [ ] `pnpm --filter happy-app typecheck` passes.
**Dependencies:** US-001.
**Estimated complexity:** small.

## US-004: Test coverage — schema, applySessions, helpers, sync normalization
**Description:** As CI, I want comprehensive Vitest coverage of the new schema, store helpers, applySessions no-preserve semantics, and sync.ts normalization (both fetch and update-session paths plus cross-machine and malformed cases), so that regressions are caught before they ship.
**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/storageTypes.spec.ts` has a new case: Metadata with both fields parses and round-trips; absence of `spawnedChildren` yields `undefined`, not `[]`.
- [ ] `packages/happy-app/sources/sync/storage.applySessions.spec.ts` has new cases: (a) incoming session with both fields persists into store; (b) incoming update with `spawnedChildren` omitted results in `spawnedChildren === undefined` (server-authoritative; no preservation); (c) incoming `parentSessionId: null` is preserved.
- [ ] `packages/happy-app/sources/sync/storage.parent-children.spec.ts` (new file) covers: happy path; missing parent in store; missing children filtered; `spawnedChildren: undefined`; `parentSessionId: null`; `parentSessionId: undefined`.
- [ ] `packages/happy-app/sources/sync/sync.test.ts` extends coverage to: (a) bare `parentSessionId` is promoted to composite in `update-session`; (b) cross-machine `m2:foo` survives unchanged; (c) non-string `parentSessionId` does not crash; (d) non-array `spawnedChildren` does not crash; (e) idempotency on re-emit.
- [ ] `pnpm --filter happy-app test sources/sync/` passes.
**Dependencies:** US-001, US-002, US-003.
**Estimated complexity:** medium.

## US-005: Documentation + roadmap status flips
**Description:** As an operator and as future readers of the codebase, I want the new parent/child invariants documented in the app CLAUDE.md and the task status flipped to complete across all roadmap trackers, so that nothing drifts.
**Acceptance Criteria:**
- [ ] `packages/happy-app/CLAUDE.md` gains a short paragraph (3-6 lines) under sync invariants describing: (a) parent/child refs live in `Metadata`; (b) refs are composite IDs; (c) normalization happens at ingress via the shared helper; (d) metadata is server-authoritative — no client overlay; (e) cross-machine refs are preserved verbatim.
- [ ] `plans/agent-view-research.md` §6 `session-parent-link` task is flipped to complete (match existing format).
- [ ] `plans/parallel-assignments.md` (lines 565-571) `session-parent-link` row is flipped to complete.
- [ ] `plans/overview.html` `session-parent-link` task status attribute is updated (today: `b-inflight`) to whatever the completed convention is in that file.
- [ ] Single commit on `main` containing all changes from US-001 through US-005.
**Dependencies:** US-001, US-002, US-003, US-004.
**Estimated complexity:** small.
