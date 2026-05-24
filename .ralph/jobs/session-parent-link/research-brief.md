# Research Brief — session-parent-link

## Researcher Findings

(See full agent output for complete detail; key items below.)

- **Metadata types** live in `packages/happy-app/sources/sync/storageTypes.ts:8-88` (`MetadataSchema`, `.strip()` default — forward-compatible) and `:130-163` (`Session` interface).
- **Composite ID convention** in `packages/happy-app/sources/sync/machineSessionId.ts`: format `${machineId}:${localSessionId}`. Helpers: `compositeSessionId()`, `parseCompositeSessionId()`, `localizeSessionPath()`. CLAUDE.md:210 mandates these for any parent/child refs in app-visible payloads.
- **applySessions reducer** at `packages/happy-app/sources/sync/storage.ts:395-570`. Preservation pattern (lines 413–447) already uses an `existing ?? incoming ?? saved` pattern for drafts/permission modes. The spread `...session` flows metadata through; new fields require no explicit preserve code provided the schema includes them — but the `undefined vs []` semantic for `spawnedChildren` does need explicit handling.
- **Backend persistence**: `packages/happy-server/prisma/schema.prisma:22-39` — `Session.metadata: String`, `metadataVersion: Int`. No structured columns. Metadata is opaque to server.
- **Wire/socket layer**: `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts:52-119` (`update-metadata` CAS), `packages/happy-server/sources/app/events/eventRouter.ts:43-77, 506` (echo `update-session`). Metadata is string passthrough.
- **MMKV persistence**: `packages/happy-app/sources/sync/persistence.ts` — only drafts, permission/model modes, last-seen seqs, pinned avatars. **Full Session map is NOT MMKV-persisted today.** Acceptance line about "MMKV round-trip" needs clarification.
- **Tests**: vitest, node env, `sources/_test-stubs/setup.ts` mocks RN. Existing specs: `storage.applySessions.spec.ts`, `ops.test.ts`, `machineFallbacks.test.ts`, `storageTypes.spec.ts`.
- **Typecheck**: per-package `pnpm typecheck` (tsc --noEmit). No root script. Must run for happy-app, happy-server, happy-cli.

## Architect Analysis

- **Decision: Option A (metadata-only)**. Rationale: server is dumb passthrough, metadata is opaque encrypted JSON, no multi-tenant indexing value, zero migration burden, backward compatible.
- **Risk: cycle prevention** (A → B → A) — recommends a `getSessionAncestry()` helper with visited Set + maxDepth safety.
- **Risk: undefined vs []** — explicit merge code in applySessions:
  ```ts
  spawnedChildren:
      incomingMetadata.spawnedChildren !== undefined
          ? incomingMetadata.spawnedChildren
          : existingMetadata?.spawnedChildren
  ```
- **Helper signatures** (proposed):
  - `getSessionParent(sid: string): Session | null`
  - `getSessionChildren(sid: string): Session[]`
  - (Optional) `getSessionAncestry(sid: string, maxDepth?: number): Session[]`
- **Cross-machine parent refs**: enforce same-machine via `parseCompositeSessionId()` (for now). Future: cross-daemon refs out of scope.
- **Risk: orphans on parent delete** — UI responsibility, not in scope.

## Codex Research

**Critical addition the Researcher/Architect missed:**

- **CLI Metadata type also needs the new fields**: `packages/happy-cli/src/api/types.ts:266`. The CLI is the producer of fork/spawn metadata via `createSessionMetadata.ts` and `ApiSessionClient.updateMetadata`. Without updating it, cross-package typecheck will fail.
- **Composite-id normalization at the inbound boundary**: `packages/happy-app/sources/sync/sync.ts:324` (`toCompositeSession()`) currently composites only `session.id`. Parent refs in metadata arrive bare (`abc` not `m1:abc`) and must be composited here. Same applies to `update-session` handler at `sync.ts:1816`.
- **Suggested schema**:
  ```ts
  parentSessionId: z.string().nullish(),
  spawnedChildren: z.array(z.string()).optional(),
  ```
- **Tests**: include `sessionUpdateMetadata()` preserving composite parent/child ids while localizing only the socket sid.

## Copilot Research

**Confirms Codex findings + extra clarity:**

- Same metadata-only recommendation. Same CLI type concern. Same `toCompositeSession()` normalization requirement.
- Notes `packages/happy-wire/src/messages.ts` — `UpdateSessionBodySchema` carries metadata as `VersionedEncryptedValue` (opaque). **No happy-wire change needed.**
- Notes `ops.test.ts` already enforces stripping composite prefix before `fork-into-worktree` RPC — pattern to follow.
- Recommends `createSessionMetadata.ts` (`packages/happy-cli/src/utils/`) is the right CLI write point to seed `parentSessionId` for child sessions, and `ApiSessionClient.updateMetadata(...)` CAS update for parent's `spawnedChildren` (post-spawn).
- Flags MMKV: "If acceptance literally requires app restart persistence without server refetch, that is new scope."

## Consensus (2+ reviewers)

1. **Use metadata-only, not DB columns.** [all 4]
2. **Add `parentSessionId?: string` (nullish) and `spawnedChildren?: string[]` to `MetadataSchema`** in `storageTypes.ts`. [all 4]
3. **No server schema or wire protocol changes.** [all 4]
4. **Add `getSessionParent` and `getSessionChildren` pure helpers** in `storage.ts`. [all 4]
5. **Respect undefined vs [] semantic** in applySessions merge. [all 4]
6. **Cross-package coverage**: CLI Metadata type at `packages/happy-cli/src/api/types.ts:266` also needs the fields. [Codex + Copilot]
7. **Normalize parent/child composite IDs at the inbound boundary** (`toCompositeSession()` and `update-session` handler in `sync.ts`). [Codex + Copilot]

## Divergences

- **MMKV acceptance criterion interpretation** [Codex, Copilot vs feature request]: Full Session map is not MMKV-persisted today. Acceptance line "server → app → MMKV → re-fetch" is ambiguous. Two interpretations:
  - (a) "Round-trip through Zustand store + server re-fetch" — feasible today, no MMKV work.
  - (b) "App restart persistence via MMKV" — new scope, requires adding session-map MMKV serialization.
- **Helper API ergonomics** [Architect vs Codex/Researcher]:
  - Architect: helpers take optional `state?: StorageState` param for testability; recommends adding `getSessionAncestry()` with cycle detection.
  - Codex/Researcher: simpler `(sid: string) => Session | null` and `(sid: string) => Session[]` reading current store state.
- **spawnedChildren resolution strategy** [Codex vs others]:
  - Codex suggests: if `spawnedChildren` is defined, return those; if undefined, reverse-scan `metadata.parentSessionId === sid`.
  - Others: only use the explicit `spawnedChildren` field.
- **CLI metadata write surface**:
  - Copilot: post-spawn `updateMetadata` CAS for parent's children list.
  - Other reviewers: not explicitly addressed (deferred to a later mobile-tree-view task).

## Consolidated File List

**Files to modify (in-scope this task):**
- `packages/happy-app/sources/sync/storageTypes.ts` — `MetadataSchema` (+2 fields)
- `packages/happy-app/sources/sync/storage.ts` — `applySessions` merge + new helpers `getSessionParent`/`getSessionChildren`
- `packages/happy-app/sources/sync/sync.ts` — `toCompositeSession()` and `update-session` handler to normalize parent/child IDs (bare→composite)
- `packages/happy-cli/src/api/types.ts` — CLI `Metadata` type mirror

**Files to use as reference:**
- `packages/happy-app/sources/sync/machineSessionId.ts` — composite ID helpers
- `packages/happy-app/sources/sync/ops.ts:397` — `sessionUpdateMetadata()` pattern
- `packages/happy-app/sources/sync/persistence.ts` — MMKV usage patterns
- `packages/happy-app/CLAUDE.md` — sync invariants (lines 150–210)
- `packages/happy-server/CLAUDE.md` — server architecture
- `packages/happy-server/prisma/schema.prisma:22-39` — confirm no schema changes
- `packages/happy-server/sources/app/api/routes/sessionRoutes.ts:15` — metadata pass-through
- `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts:52-119` — CAS update
- `packages/happy-server/sources/app/events/eventRouter.ts:43-77, 506` — `update-session` echo
- `packages/happy-wire/src/messages.ts` — confirm no shared-wire change
- `packages/happy-cli/src/utils/createSessionMetadata.ts` — initial metadata factory (reference for future task)
- `packages/happy-cli/src/api/apiSession.ts` — `updateMetadata` write surface (reference for future task)

**Test files to add or extend:**
- `packages/happy-app/sources/sync/storageTypes.spec.ts` — schema covers new fields
- `packages/happy-app/sources/sync/storage.applySessions.spec.ts` — preserve merge semantics
- `packages/happy-app/sources/sync/storage.parent-children.spec.ts` (new) — helper tests
- (Optional) `packages/happy-app/sources/sync/sync.test.ts` — composite-id normalization on inbound update

**Documentation to update:**
- `packages/happy-app/CLAUDE.md` — add a brief note under sync invariants about parent/child composite-id refs in metadata
- `plans/agent-view-research.md` — mark §6 `session-parent-link` task as complete after merge

**Build / typecheck commands:**
- `pnpm --filter happy-app typecheck`
- `pnpm --filter happy-server typecheck`
- `pnpm --filter happy-cli typecheck`
- `pnpm --filter happy-wire typecheck`
- `pnpm --filter happy-app test sources/sync/`
