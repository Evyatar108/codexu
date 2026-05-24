# PRD: Session Parent/Child Metadata Tracking

## Introduction

Add `parentSessionId?: string | null` and `spawnedChildren?: string[]` to the `Session` `Metadata` contract so the app can model parent-child session relationships without any UI work yet. This is the prerequisite for the upcoming `mobile-tree-view` task. Both fields are composite session IDs (`m1:abc` format) and live inside the existing opaque `metadata` JSON blob — the server stays a dumb passthrough.

The work touches three packages: `happy-app` (schema, sync.ts normalization, new helpers, tests), `happy-cli` (mirror the Metadata type so cross-package typecheck stays green), and `happy-server` (no source changes — confirmed via research). Single commit on `main`.

**Autonomous-mode assumptions:** The single feature description, plan, and stories outline are all available in `D:/harness-efforts/codexu/.ralph/jobs/session-parent-link/`. No clarifying questions were asked. The plan was already reviewed (manifest at `plan-review-findings.json`); F-001/F-004/F-005/F-009 are resolved consensus findings, F-002/F-003/F-015 are explicitly deferred to the spawn-flow integration follow-up.

## Goals

- Extend the `MetadataSchema` (app) and CLI `Metadata` type with `parentSessionId` and `spawnedChildren` fields (optional, nullish parent; optional array of strings).
- Introduce a single shared `normalizeMetadataParentChildRefs(raw, machineId)` helper in `sync.ts` and call it from both `toCompositeSession()` and the `update-session` socket handler so the two ingress paths cannot drift.
- Add two pure top-level helpers in `storage.ts`: `getSessionParent(sid)` and `getSessionChildren(sid)`.
- Comprehensive Vitest coverage: schema, applySessions no-preserve semantics, helpers, sync normalization (both fetch and live-update paths, including cross-machine and malformed inputs, idempotency).
- Update sync invariants in `packages/happy-app/CLAUDE.md` and flip the task status in three roadmap trackers.
- All work delivered as a single commit on `main`.

## User Stories

### US-001: Extend Metadata schema (app + CLI types)
**Description:** As the sync layer, I want the `Metadata` Zod schema and the CLI `Metadata` type to declare two new optional parent/child fields, so that the contract is in place before any wiring or helpers reference them.

**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/storageTypes.ts` `MetadataSchema` includes `parentSessionId: z.string().nullish()` and `spawnedChildren: z.array(z.string()).optional()`.
- [ ] `packages/happy-cli/src/api/types.ts` `Metadata` type includes `parentSessionId?: string | null` and `spawnedChildren?: string[]`.
- [ ] Schema does NOT inject a default (no `.default([])`); `undefined` is preserved on round-trip.
- [ ] `pnpm --filter happy-app typecheck` passes.
- [ ] `pnpm --filter happy-cli typecheck` passes.
- [ ] `pnpm --filter happy-wire typecheck` passes (sanity — no change expected).
- [ ] Typecheck passes.

### US-002: Shared composite-ID normalizer in sync.ts
**Description:** As the sync ingress layer, I want a single private helper that promotes bare parent/child refs in raw metadata to composite IDs (idempotent, shape-guarded), and I want both `toCompositeSession()` and the `update-session` handler to call it, so that the two ingress paths cannot drift.

**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/sync.ts` defines a private `normalizeMetadataParentChildRefs(raw: unknown, machineId: string | null): unknown` helper.
- [ ] Helper checks `typeof rawMetadata === 'object'`, guards `typeof parentSessionId === 'string'` and `Array.isArray(spawnedChildren)`, leaves malformed entries unchanged.
- [ ] Helper only promotes refs lacking `:`; already-composite refs pass through unchanged.
- [ ] Helper is idempotent: applying it twice yields the same result (deep-equal).
- [ ] `toCompositeSession()` (near line 324) calls the helper after `parsePlainJson` and before assembling the composite session.
- [ ] `update-session` handler (near line 1816) calls the helper using machineId resolution order: (1) in-store session's `metadata.machineId`; (2) `parseCompositeSessionId(sessionId).machineId`; (3) skip promotion (leave refs bare).
- [ ] Bare `parentSessionId: 'abc'` becomes `'m1:abc'` after normalization when `machineId='m1'`.
- [ ] Bare entries in `spawnedChildren` are promoted; already-composite entries pass through unchanged.
- [ ] Cross-machine ref `parentSessionId: 'm2:foo'` in a session owned by `m1` survives applySessions verbatim.
- [ ] Non-string `parentSessionId: 42` does not crash sync; it passes through and is dropped by `MetadataSchema.parse` downstream.
- [ ] Non-array `spawnedChildren: 'not-an-array'` does not crash sync.
- [ ] `pnpm --filter happy-app typecheck` passes.
- [ ] Typecheck passes.

### US-003: Storage helpers — getSessionParent, getSessionChildren
**Description:** As a future tree-view consumer, I want pure top-level helpers that resolve a session's parent and children against the current store, so that I can navigate parent/child relationships without re-implementing lookup logic.

**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/storage.ts` exports `getSessionParent(sid: string): Session | null` as a top-level function.
- [ ] `packages/happy-app/sources/sync/storage.ts` exports `getSessionChildren(sid: string): Session[]` as a top-level function.
- [ ] `getSessionParent` returns `null` when `parentSessionId` is `null`, `undefined`, or refers to a session not in the store.
- [ ] `getSessionChildren` returns resolved children in the order listed by `spawnedChildren`; missing children are filtered out (no placeholder); returns `[]` when `spawnedChildren` is `undefined` or empty.
- [ ] No changes to `applySessions` — metadata stays server-authoritative.
- [ ] Helpers are pure reads of `storage.getState()`; no side effects.
- [ ] `pnpm --filter happy-app typecheck` passes.
- [ ] Typecheck passes.

### US-004: Test coverage — schema, applySessions, helpers, sync normalization
**Description:** As CI, I want comprehensive Vitest coverage of the new schema, store helpers, applySessions no-preserve semantics, and sync.ts normalization (both fetch and update-session paths plus cross-machine, malformed, and idempotency cases), so that regressions are caught before they ship.

**Acceptance Criteria:**
- [ ] `packages/happy-app/sources/sync/storageTypes.spec.ts` covers: Metadata with both fields parses and round-trips; absence of `spawnedChildren` yields `undefined` (not `[]`); explicit `parentSessionId: null` is preserved.
- [ ] `packages/happy-app/sources/sync/storage.applySessions.spec.ts` covers: (a) incoming session with both fields persists into store; (b) incoming update with `spawnedChildren` omitted results in `spawnedChildren === undefined` (server-authoritative, no preservation, no `[]` backfill); (c) incoming `parentSessionId: null` is preserved.
- [ ] New file `packages/happy-app/sources/sync/storage.parent-children.spec.ts` covers `getSessionParent` and `getSessionChildren`: happy path; missing parent in store; missing children filtered out; `spawnedChildren: undefined`; `parentSessionId: null`; `parentSessionId: undefined`.
- [ ] `packages/happy-app/sources/sync/sync.test.ts` extends coverage (near the `update-session` harness at ~lines 652-703): (a) live update with bare `parentSessionId` is promoted to composite; (b) cross-machine `m2:foo` survives unchanged; (c) non-string `parentSessionId` does not crash; (d) non-array `spawnedChildren` does not crash; (e) re-emit is idempotent. Same coverage for the initial-fetch `toCompositeSession` path.
- [ ] Round-trip test (server re-fetch interpretation): build a Session with `parentSessionId='m1:abc'` and `spawnedChildren=['m1:def','m1:ghi']`, write through `applySessions`, read from store; simulate a subsequent fetch with the same metadata and write through `applySessions` again — both fields unchanged and helpers still resolve correctly. Persistence layer is NOT exercised.
- [ ] `pnpm --filter happy-app test sources/sync/` passes (new + existing).
- [ ] Typecheck passes.
- [ ] Tests pass.

### US-005: Documentation + roadmap status flips + single commit
**Description:** As an operator and future readers of the codebase, I want the new parent/child invariants documented in the app `CLAUDE.md` and the task status flipped to complete across all roadmap trackers, all delivered as a single commit on `main`.

**Acceptance Criteria:**
- [ ] `packages/happy-app/CLAUDE.md` gains a short paragraph (3-6 lines) under sync invariants describing: (a) parent/child refs live in `Metadata`; (b) refs are composite IDs; (c) normalization happens at ingress via the shared helper; (d) metadata is server-authoritative — no client overlay; (e) cross-machine refs are preserved verbatim.
- [ ] `plans/agent-view-research.md` §6 `session-parent-link` task is flipped to complete (match the file's existing convention).
- [ ] `plans/parallel-assignments.md` row for `session-parent-link` (lines 565-571) is flipped to complete.
- [ ] `plans/overview.html` `session-parent-link` task status attribute is updated from `b-inflight` to whatever the completed convention is in that file.
- [ ] All changes from US-001 through US-005 land as a single commit on `main` (no feature branch, no PR plumbing).
- [ ] Typecheck passes.

## Functional Requirements

- FR-1: `MetadataSchema` in `packages/happy-app/sources/sync/storageTypes.ts` must include `parentSessionId: z.string().nullish()` and `spawnedChildren: z.array(z.string()).optional()` with no default.
- FR-2: CLI `Metadata` in `packages/happy-cli/src/api/types.ts` must include `parentSessionId?: string | null` and `spawnedChildren?: string[]`.
- FR-3: `sync.ts` must define a private helper `normalizeMetadataParentChildRefs(raw, machineId)` and call it from both `toCompositeSession()` and the `update-session` socket handler.
- FR-4: Normalization must be defensive — `typeof === 'string'` and `Array.isArray` shape guards before promoting any ref.
- FR-5: Normalization must be idempotent — running it twice on the same metadata must produce the same result.
- FR-6: Normalization must only promote bare refs (no `:` in the string). Already-composite refs pass through unchanged.
- FR-7: The `update-session` handler's machineId resolution order is: (1) in-store session's `metadata.machineId`; (2) `parseCompositeSessionId(sessionId).machineId`; (3) skip promotion.
- FR-8: `applySessions` is unchanged. Metadata stays server-authoritative; incoming session with `spawnedChildren` omitted must result in `spawnedChildren === undefined` in the store (no `[]` backfill).
- FR-9: Cross-machine refs (`m2:foo` in an `m1` session) are preserved verbatim — no rejection, no rewrite.
- FR-10: `storage.ts` must export `getSessionParent(sid)` returning the parent `Session` or `null` (when `parentSessionId` is null/undefined/unknown).
- FR-11: `storage.ts` must export `getSessionChildren(sid)` returning resolved children in the order listed by `spawnedChildren`; missing children filtered out; returns `[]` when `spawnedChildren` is undefined or empty.
- FR-12: Vitest suite covers schema, applySessions semantics, helpers, sync normalization (both fetch and live-update paths, cross-machine, malformed, idempotency, round-trip).
- FR-13: Documentation updates: `packages/happy-app/CLAUDE.md` sync-invariants paragraph; `plans/agent-view-research.md` §6, `plans/parallel-assignments.md` row, `plans/overview.html` status — all flipped to complete.
- FR-14: All changes delivered as a single commit on `main`.

## Non-Goals (Out of Scope)

- **UI changes** — explicitly deferred to the `mobile-tree-view` task.
- **`applySessions` merge changes** — no special preservation logic; metadata is server-authoritative.
- **Server schema changes** — Prisma model untouched (`packages/happy-server/prisma/schema.prisma`).
- **Wire/protocol changes** — `happy-wire` untouched.
- **CLI spawn-flow writes** — `createSessionMetadata.ts`, `apiSession.updateMetadata` post-spawn, `daemon/forkSession.ts` (HAPPY_FORKED_FROM_SESSION_ID), and `codex/runCodex.ts` are not wired to populate the new fields. Separate spawn-flow integration task.
- **Full Session map MMKV persistence** — `persistence.ts` is not extended; app-restart persistence is out of scope.
- **Cross-machine ref rejection** — read-side preserves foreign refs verbatim. Write-side enforcement belongs to the spawn-flow task.
- **UI-driven cascading delete / orphan handling** — UI's concern.
- **Reverse-scan fallback in `getSessionChildren`** — explicit `spawnedChildren` only; can be added later if mobile-tree-view needs it.
- **Cycle detection** — read-only helpers cannot create cycles; write-time validation belongs to the spawn-flow task.

## Technical Considerations

- **Composite ID convention:** `${machineId}:${localSessionId}` (see `packages/happy-app/sources/sync/machineSessionId.ts`). Reuse `compositeSessionId()` and `parseCompositeSessionId()` helpers.
- **Ingress seams:** `sync.ts:324` (`toCompositeSession`) for initial fetch; `sync.ts:1816` (`update-session` handler) for live updates.
- **Metadata parsing:** `parsePlainJson(...)` produces loosely-typed objects. The normalizer must shape-check before reading any field.
- **MMKV persistence:** Confirmed at `packages/happy-app/sources/sync/persistence.ts` — the sessions map is NOT persisted. Round-trip means Zustand store + simulated server re-fetch, not app-restart.
- **Test stubs:** Vitest with node env; RN stubs at `packages/happy-app/sources/_test-stubs/setup.ts`. Existing relevant specs: `storage.applySessions.spec.ts`, `storageTypes.spec.ts`, `ops.test.ts`, `machineFallbacks.test.ts`. `sync.test.ts:652-703` already has an `update-session` harness.

## Risk Areas

1. **Composite-ID double-promotion** — `m1:m1:abc` is a corruption hazard. Mitigated by the `:`-guard in the normalizer; tested directly.
2. **Malformed metadata** — `parsePlainJson` produces loose objects. Mitigated by `typeof` + `Array.isArray` shape guards; tested.
3. **Cross-machine refs** — preserved verbatim, not rejected. Tested.
4. **Reverse-scan vs explicit children** — `getSessionChildren` returns only what `spawnedChildren` lists. Documented; can be relaxed later if mobile-tree-view needs it.
5. **Cycle hazard in parent chains** — not relevant to this read-only task; the spawn-flow task owns write-time prevention.
6. **Concurrent `spawnedChildren` CAS races** — flagged for the spawn-flow author; not addressed here.

## Success Metrics

- All five user stories' acceptance criteria pass.
- `pnpm --filter happy-app typecheck` passes.
- `pnpm --filter happy-cli typecheck` passes.
- `pnpm --filter happy-wire typecheck` passes.
- `pnpm --filter happy-server typecheck` passes (sanity check; no source changes).
- `pnpm --filter happy-app test sources/sync/` passes (new + existing).
- The feature is delivered as a single commit on `main`.
- The `mobile-tree-view` follow-up task can begin without additional schema changes.

## Open Questions

1. **CLI write surfaces deferred** — Confirmed at gap-assessment. The spawn-flow integration task (`session-parent-link-writer` or similar) will wire `createSessionMetadata.ts`, `apiSession.updateMetadata`, `daemon/forkSession.ts`, and `codex/runCodex.ts` to populate the new fields. Tracked in `plans/parallel-assignments.md` as a follow-up.
2. **MMKV persistence semantics** — Round-trip is interpreted as "Zustand store + simulated server re-fetch." `persistence.ts` is NOT modified. App-restart persistence is out of scope.
3. **`getSessionChildren` resolution strategy** — Explicit `spawnedChildren` field only (current plan). Reverse-scan fallback is a one-liner if mobile-tree-view needs it later.
4. **Cycle detection helper (`getSessionAncestry`)** — Deferred. Read-only helpers cannot create cycles; the future write path will need its own validation.
5. **Concurrent `spawnedChildren` CAS races** — Flagged for the spawn-flow author.
