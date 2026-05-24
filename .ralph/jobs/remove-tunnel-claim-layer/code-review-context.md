# Code Review Context: remove-tunnel-claim-layer

## Codebase Patterns Confirmed

- **Server `request.userId`** is consistently the identity surface across `sessionRoutes.ts`, `v3SessionRoutes.ts`, `accountRoutes.ts`, and the loopback path (`loopbackCapability.ts:34` sets `request.userId = localUserId`). The collapse from `request.accountId` is complete in production code.
- **Two-gate model on the server** is now: `authenticateTunnel` (sets `request.userId = tofuConfig.localUserId` with no header check — relies on Dev Tunnels gateway / `127.0.0.1` bind) vs `verifyLoopbackCapability` (reads `loopback-cap.txt` capability token). `api.ts:81` selects per `options.auth === "loopback"`. Server binds `127.0.0.1` by default (`index.ts:174`), addressing the "trust boundary" concern raised by copilot.
- **Socket auth middleware** (`socket.ts:56-97`) mirrors the HTTP pattern: only loopback validates a capability token; tunnel branch trusts the gateway and sets `socket.data.userId = tofuConfig.localUserId`.
- **CORS `allowedHeaders`** in both `api.ts:62` and `socket.ts:106` now lists `['X-Tunnel-Authorization', 'X-Loopback-Capability', 'X-Happy-Client', 'Content-Type']` — `X-Codexu-Authorization` removed.

## Prisma DB Column `accountId` Persists

The Prisma `Session.accountId` and related columns are *not* the same thing as the deleted in-memory `request.accountId`. They survive (per plan: "No DB migration"). Test files under `packages/happy-server/sources/app/api/routes/v3SessionRoutes.test.ts` and `sources/app/api/socket/sessionMessageRangeHandler.test.ts` still use `accountId` as a fake-state field name on seed inputs — this is correct, matches the DB schema, and is unrelated to the tunnel-claim removal.

## Cross-Package Grep Gap

Iter-6's Quality Gate scoped the cross-cutting grep to `docs plans packages/*/CLAUDE.md`, which missed:

- `packages/happy-cli/src/types/happy-server.d.ts` (ambient type for retired export)
- `packages/happy-cli/src/daemon/daemon.integration.test.ts` (live claim-minting code in a test file)
- `packages/happy-app/scripts/check-sprint-a-gate.mjs` (gate script asserts retired symbol exists)
- `packages/happy-app/scripts/verify-refresh-supported.mjs` (decoder for retired wire field)

The plan's grep ACs (lines 168-171) target `packages/` broadly — running them with the wider scope would have caught all four. Recommend tightening the orchestrator's Quality Gate grep scope for similar removal stories.

## Credential Round-Trip Hazard (cross-package)

`packages/happy-app/sources/auth/tokenStorage.ts` `isAuthCredentials` and `packages/happy-agent/src/auth.ts` `discoverAuthorizedMachines` both spread server-returned or stored objects without field-allowlist projection. If a stale on-disk credential blob or a still-deployed old server includes `tunnelClaim`/`accountId`, those fields ride along through subsequent reads/writes. The plan's "no NEW writes include the field" invariant is therefore violated indirectly. See findings F-004 and F-005.

## happy-agent `dist/` Status

The `dist/` artifacts in `packages/happy-agent/dist/` were force-added in iter-5 (US-005) per progress.txt and contain no `tunnelClaim`/`X-Codexu-Authorization` strings (verified via grep on `packages/happy-agent/dist/`). Rebuild gate held.

## Loopback Capability Coverage

`packages/happy-server/sources/app/api/socket.spec.ts:104-159` and `packages/happy-server/sources/app/api/auth/loopbackCapability.test.ts` both assert the rejection path for missing/invalid capability tokens. The plan's risk note "loopback rejection must not weaken" is addressed by these tests.

## Out-of-Scope Test Changes

Per Codex review, two iter-3 test edits are unrelated to claim removal:
- `AgentInput.activeRegression.test.tsx:169` (active-mode voice mic regression flipped present→absent)
- `profile.test.ts:23` (accepted old local profile shape)

These look like opportunistic baseline cleanup and should ideally be a separate commit; see finding F-006.
