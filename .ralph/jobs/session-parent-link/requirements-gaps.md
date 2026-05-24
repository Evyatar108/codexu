# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Pre-Interview | Post-Interview | Gap Resolved? |
|-----------|---------------|----------------|---------------|
| Goal | clear | clear | n/a |
| Scope | partial | partial (auto-inferred) | yes — via [INFERRED] |
| Criteria | partial | partial (auto-inferred) | yes — via [INFERRED] |

## Clarifications

User was not present at the gap-question step (auto mode). Recommended options recorded as inferences below; can be revisited at Phase 5 plan-approval gate.

- **CLI types inclusion**: [INFERRED — Recommended Option 1] Include `packages/happy-cli/src/api/types.ts` update in this commit. Rationale: research shows the CLI owns the `Metadata` type contract for session creation (`createSessionMetadata.ts`) and metadata writes (`ApiSessionClient.updateMetadata`). Without mirroring the new fields, cross-package typecheck would not be meaningful — a CLI build using a happy-app `Metadata` field it doesn't know about would either drop the field on stringify or fail Zod validation. The original prompt did not enumerate happy-cli, but the acceptance criterion "cross-package typecheck green" presumes type contracts stay aligned across all consumers. CLI write-surface changes (`createSessionMetadata.ts`, `apiSession.updateMetadata` post-spawn flow) are NOT included — they belong with the spawn-flow integration task.

- **Backend shape**: [INFERRED — Recommended Option 1] Metadata-only. Rationale: unanimous reviewer recommendation. Server treats `Session.metadata` as opaque JSON string with CAS version-locking already in place. Avoids a Prisma migration. Aligns with `packages/happy-server/CLAUDE.md` design — single-user embedded server, not multi-tenant.

- **MMKV scope**: [INFERRED — Recommended Option 1] Treat acceptance line as "Zustand store + server re-fetch round-trip preserves both fields." Rationale: `packages/happy-app/sources/sync/persistence.ts` does not persist the full sessions map today (only drafts, permission/model modes, replay seqs, pinned avatars). Adding full-map MMKV serialization is new scope not mentioned in the original prompt. Verification test will demonstrate the wire→reducer→store→re-fetch round-trip without touching persistence.

## Remaining Open Questions

1. The three [INFERRED] decisions above are non-blocking but should be confirmed at Phase 5 plan approval. If the operator disagrees, the plan needs revision before implementation.
2. `getSessionChildren` resolution strategy — explicit `spawnedChildren` field only, or also reverse-scan sessions where `metadata.parentSessionId === sid`? Plan recommends "explicit field only" for predictability; reverse-scan can be added later if a session writes its parent ref but the parent never publishes `spawnedChildren`.
3. Cycle prevention — added as a defensive check in helpers (`visited: Set<string>` + `maxDepth: 100`)? Or trust callers since UI is out of scope? Plan recommends defensive check with low overhead.
