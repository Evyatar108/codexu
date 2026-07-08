# Happy Patch Surface vs Upstream (slopus/happy)

**Last Updated**: 2026-07-07
**Import baseline**: `cli-1.1.10` @ `71c417e1092e73cf34eb24f9601d569394c1f359` (upstream `slopus/happy`, 2026-06-23) — **imported via the first selective intake, 2026-07-07** (server+cli+app; see [§6 Baseline record](#6-baseline-record)). Prior baseline was the inferred `cli-1.1.8`.
**Forward target (next intake)**: `upstream-happy/main` @ `d2ef88de` (3 commits past `cli-1.1.10`), or the next upstream `cli-*` release.

> Sibling reference: [`codex/docs/implementation/patch-surface.md`](../codex/docs/implementation/patch-surface.md) — the mature model this catalogue mirrors (marker discipline, invariant-to-guard table, replant notes). Read its §14/§15 before adding a row here.

This is the authoritative reference for the **strategically-significant** changes the fork carries on
top of upstream `slopus/happy`. It is deliberately **not** a per-file diff of all ~359 modified files —
markers add diff noise, so they are reserved for the must-survive fork edits and the deliberate
deletions that a naive upstream merge would silently regress. Consult (and update) this document when:

- **Importing a newer upstream** (`cli-1.1.10` and beyond): every KEEP/RESTORE row is a hunk a
  take-upstream merge would revert; every KEEP-DELETED row is a construct a take-upstream merge would
  resurrect. Walk the table before resolving conflicts.
- **Auditing for a fork regression**: if fork behavior broke after a sync, a row here names the guard
  (spec/typecheck) that should have caught it.
- **Onboarding**: the buckets below explain *why* the fork diverges where it does.

Unless a row says otherwise, server paths are relative to `packages/happy-server/sources/`, CLI paths
to `packages/happy-cli/src/`, and app paths to `packages/happy-app/sources/`.

---

## 1. Marker convention

Strategically-significant fork hunks in **upstream-canonical files** carry an in-code marker so the
next importer can find them by grep, not by memory. The canonical form is:

```
// FORK PATCH: [KEEP|KEEP-DELETED|RESTORE] <short reason> (invariant <ID>)
```

Language/context variants (same tokens, comment syntax adapted):

| Context | Marker form |
|---|---|
| TS / JS (`.ts`, `.tsx` non-JSX position) | `// FORK PATCH: [BUCKET] <reason> (invariant <ID>)` |
| JSX (inside markup) | `{/* FORK PATCH: [BUCKET] <reason> (invariant <ID>) */}` |
| Prisma schema (`.prisma`) | `// FORK PATCH: [BUCKET] <reason> (invariant <ID>)` |

Rules:

- **Markers are comment-only.** Adding/removing a marker never changes behavior. (This whole milestone,
  M0, is markers + docs + `.gitattributes` — zero behavior change.)
- **One marker per hunk, at the hunk's anchor** (the function/branch/statement it guards), not on every
  line. For a file the fork has largely rewritten (e.g. the R4 CLI wiring files), place **one
  representative marker at the entry point** and let this catalogue carry the detail — dozens of
  per-line markers would recreate the diff noise the convention exists to avoid.
- **Every marker cites its catalogue invariant `<ID>`.** The ID scheme is package-scoped:
  - `HS-<n>` — happy-**s**erver
  - `HC-<n>` — happy-**c**li
  - `HA-<n>` — happy-**a**pp
- **KEEP-DELETED rows have no marker** (there is no line to mark — the code is *gone*). Their guard is a
  "must-not-exist" test; the catalogue row is the only durable record.
- **Line numbers are hints only.** They drift. The `file:symbol` anchor + the marker text are the
  durable locators; re-grep the marker after any import.

## 2. Buckets

| Bucket | Meaning | Merge hazard if lost | Marker? |
|---|---|---|---|
| **KEEP** | A fork modification to an upstream-canonical file whose *current form must survive* an upstream import. | Take-upstream silently **reverts fork behavior**. | Yes — on the hunk. |
| **KEEP-DELETED** | An upstream construct (route, model field, symbol) the fork **deliberately removed** and that must **stay removed**. | Take-upstream silently **resurrects** the deleted construct. | No (nothing to mark) — guard is a negative "must-not-exist" test. |
| **RESTORE** | A KEEP hunk that milestone **M1 (seam relocations R1–R4)** will move behind a fork seam/overlay to shrink the conflict surface. Until M1 lands it behaves exactly like KEEP. | Same as KEEP; additionally, the marker names the target relocation (`RESTORE-R<n>`) so M1 has a labeled anchor. | Yes — with the `RESTORE-R<n>` tag. |

> **M0 scope note.** This milestone (M0) only *annotates* the RESTORE hunks; it does **not** relocate
> them. The actual seam relocations R1–R4 are milestone **M1** and are explicitly out of scope here.
> See [`.ralph/jobs/happy-upstream-conflict-surface-and-merge-strategy/plan.md`](../.ralph/jobs/happy-upstream-conflict-surface-and-merge-strategy/plan.md) §5.

> **R8 extends RESTORE to happy-app + adds a DISABLE decision.** The M2 **R8** milestone actually
> *relocates* the happy-app `HA-*` KEEP hunks into `sources/fork/` overlays (see
> [§8 R8](#r8--happy-app-ui-seams-ha-8-markdownview-stage-1)). Its markers use a **per-file** tag
> `RESTORE-R8<x>` (e.g. `RESTORE-R8d` = MarkdownView / HA-8). For a few feature-drift hunks R8 instead
> chooses **DISABLE** = revert the hunk to upstream shape, dropping the fork tweak and recording a
> re-apply recipe in the R8 note rather than carrying a seam. DISABLE hunks keep **no marker** (the
> fork behavior is gone); the catalogue row is the durable record.

---

## 3. happy-server invariants (`HS-*`)

Paths relative to `packages/happy-server/sources/` unless noted. The fork's server is a **single-user,
self-hosted** server with an opt-in **public mode** (default-off) — the multi-tenant SaaS shape from
upstream is deliberately collapsed. See [`packages/happy-server/AGENTS.md`](../packages/happy-server/AGENTS.md).

| # | file:symbol (line hint) | bucket | invariant — why it must survive | marker? | test / guard | replant note |
|---|---|---|---|---|---|---|
| HS-1 | `app/api/auth/forkAuthPlane.ts` — `installForkAuthPlane` → `authenticateTunnel` / `authenticate` decorators (called from `app/api/api.ts`) | RESTORE-R1a-done | No-op tunnel authenticator + mode-selecting `authenticate` implement the fork's **single-user** auth plane; upstream ships a multi-tenant bearer verifier. Take-upstream reinstates per-request user auth. Relocated to fork-owned `auth/forkAuthPlane.ts` seam (M1-R1a), behavior-preserving (no per-request `userId`). | ✅ inline (fork-seam header + call-site) | `publicAuthGate.spec.ts`, `socket.spec.ts`, `forkAuthPlane.spec.ts` | [§8 R1](#r1--auth-plane-hs-1-hs-2-hs-3) |
| HS-2 | `app/api/auth/forkAuthPlane.ts` — `installForkAuthPlane` → public-mode block (called from `app/api/api.ts`) | RESTORE-R1a-done | Shipped public-server **fail-closed** boundary: buffer body parser (captures `rawBody` for the bodyHash), `onRequest` `httpGuard`, `preValidation` `bodyHashGuard`. Losing it fails **open** on public internet exposure. Relocated to fork-owned `auth/forkAuthPlane.ts` seam (M1-R1a), **hook install order preserved** (httpGuard before route registration), behavior-preserving. | ✅ inline (fork-seam header + call-site) | `publicAuthGate.spec.ts` (default-deny + body-hash), `deviceEnrollment.spec.ts`, `forkAuthPlane.spec.ts` | [§8 R1](#r1--auth-plane-hs-1-hs-2-hs-3) |
| HS-3 | `app/api/auth/{loopbackCapability,remoteDeviceAuth}.ts` — `makeLoopbackSocketVerifier` / `verifyPublicSocketHandshake` (dispatched from `app/api/socket.ts` `createSocketAuthMiddleware`) | RESTORE-R1b-done | Fork's fail-closed **device-proof** Socket.IO handshake (public) + loopback-capability check; upstream's middleware has neither, so take-upstream fails open on the socket plane. Relocated to fork-owned `auth/` helper seams (M1-R1b), leaving `socket.ts` a thin dispatcher — behavior-preserving (device-proof required on ws + polling, strict single-use nonce, fail-open tunnel branch stays closed; no per-request `userId`). | ✅ inline (fork-seam helpers + dispatcher) | `socket.spec.ts`, `remoteDeviceAuth.spec.ts` | [§8 R1](#r1--auth-plane-hs-1-hs-2-hs-3) |
| HS-4 | `app/api/routes/v3SessionRoutes.ts:166` — session-message `content` envelope | RESTORE-R2-done | Server persists `{ t:'encrypted', c }` but performs **no crypto**; the label is a **mislabel today** because the CLI sends plaintext (see `HC-1` / the fork codec seam `packages/happy-cli/src/api/sessionPayloadCodec.ts` `encodeOutgoing`). R2 server half; comment-only honesty caveat, no logic change. | ✅ inline | `v3SessionRoutes.test.ts` | [§8 R2](#r2-server-half--session-message-envelope-hs-4) |
| HS-5 | `fork/operatorIdentityGate.ts` — `LOOPBACK_HOSTS` / `isLoopbackHost` / `assertOperatorIdentityGate` (re-exported from `index.ts`) | RESTORE-R3-done | Bind-host **operator-identity gate**: refuses a non-loopback bind unless public-mode with a fail-closed device verifier **and** a Cloudflare Access edge expectation. The single-user server's core safety rail. Relocated to fork-owned `fork/` seam (M1-R3), behavior-preserving. | ✅ inline (fork-seam header + call-site) | `publicAuthGate.spec.ts`, unit assertions on `assertOperatorIdentityGate` | [§8 R3](#r3--operator-identity-gate-hs-5) |
| HS-6 | `prisma/schema.prisma` — multi-tenant identity models | KEEP-DELETED | Fork collapsed the multi-tenant identity graph: `model Account`, `AccountAuthRequest`, `AccountPushToken`, `UserRelationship`, `GithubUser` and every `accountId`/`userId` FK on `Session`/`Machine` are **removed** (single-user, one-process). Take-upstream resurrects multi-tenancy. | ❌ (nothing to mark) | schema carries no `User`/`Account` model; server compiles with **no** per-request `userId` threading (happy-server AGENTS.md hard rule) | [§8 guard-by-absence](#guard-by-absence-hs-6-hs-7) |
| HS-7 | `fork/registerForkRoutes.ts:registerForkRoutes` + `fork/forkCors.ts:installForkCors` (relocated from `app/api/api.ts:configureApi`) — route-registration allowlist + CORS policy | KEEP-DELETED | Fork ships a **curated** single-user route surface, now relocated into fork-owned seams so `configureApi` stops being a merge-conflict hotspot. `registerForkRoutes` **is** the route allowlist; the removed upstream route files MUST stay removed: `accessKeysRoutes`, `artifactsRoutes`, `attachmentRoutes`, `authRoutes`, `connectRoutes`, `feedRoutes`, `kvRoutes`, `userRoutes`, `voiceRoutes`, and multi-machine `machinesRoutes` (replaced by `machineSelfRoutes`). `installForkCors` holds the fork CORS header allowlist. Relocation is behavior-preserving: identical routes/CORS on identical listeners, and `installForkAuthPlane` still runs BEFORE `registerForkRoutes` so the public-mode `onRequest` httpGuard fronts every route (default-deny). Take-upstream re-adds + re-registers the removed routes. | ✅ | `publicAuthGate.spec.ts` (default-deny denies any non-allowlisted path); the `registerForkRoutes` seam **is** the allowlist | [§8 guard-by-absence](#guard-by-absence-hs-6-hs-7) |
| HS-8 | `app/api/utils/enableAuthentication.ts` — upstream `enableAuthentication` (decorates `authenticate` via `auth.verifyToken`) | KEEP-DELETED | Upstream's auth-enable helper decorates `authenticate` by calling `auth.verifyToken(token)` (multi-tenant bearer verification). The fork's `AuthModule` (`app/auth/auth.ts`) collapsed multi-tenant token verification and has **no** `verifyToken` (only `verifyGithubToken`/`createToken`/…). Evaluated for RESTORE (present-but-dormant) during M1-R1a — it registers no active global hook, only a per-request decorator — but restoring it **unmodified** fails `pnpm --filter happy-server typecheck` (`TS2339` `verifyToken`; tsconfig compiles all `sources/**/*`), and restoring it **modified** would defeat the anti-conflict purpose (still a rewrite conflict). So it stays deleted; the fork's auth plane routes through `auth/forkAuthPlane.ts` instead. Take-upstream re-adds it + reintroduces per-request user auth. | ❌ (nothing to mark) | server compiles with **no** `verifyToken` and no per-request `userId` threading; `forkAuthPlane.spec.ts` + `publicAuthGate.spec.ts` pin the fork auth plane's accept/reject | [§8 guard-by-absence](#guard-by-absence-hs-6-hs-7) |
| HS-9 | `app/api/socket.ts` — connection registration (the `io.on('connection')` connection objects) | KEEP-DELETED | Single-user socket connection data: the connection objects carry **no per-socket `userId`** (single-user, happy-server `AGENTS.md` hard rule — `addConnection(connection)`, not upstream's `addConnection(userId, connection)`). Upstream's optional `happyClient?` telemetry field **is adopted additively** on the connection payloads (and the `ClientConnection` interfaces) so the three connection-registration blocks converge onto upstream — the `userId` removal is the only residual delta, which a future 3-way merge resolves as an ours-only deletion. The HS-3 fail-closed handshake dispatch is unchanged. Take-upstream re-threads per-socket `userId`. | ✅ inline (single-user connection data) | `socket.spec.ts` (connection registration + fail-closed device-proof handshake), `publicAuthGate.spec.ts` | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |
| HS-10 | `app/events/eventRouter.ts` — single-user room model (`addConnection` / `getRoomsForFilter`) + `emitAgentTreeUpdate` | KEEP + KEEP-DELETED | The fork's event router is a **single-user** rewrite: connections carry **no per-connection `userId`** and there are **no `user:${userId}` rooms** (rooms are `authenticated` / `user-scoped` / `session:` / `machine:`), and it adds the fork-only `emitAgentTreeUpdate` (session-scoped `@slopus/happy-wire` `AgentTreeDelta` fan-out, consumed by `app/api/socket/sessionUpdateHandler`). Upstream's userId-keyed rooms + `hasActiveNonMachineSocket(userId)` presence query are **declined** — no fork caller, and they resurrect the user-keyed room graph the single-user server removed. Take-upstream re-threads per-connection `userId`. | ✅ inline (single-user room model + `emitAgentTreeUpdate`) | `eventRouter.test.ts`, `socket.spec.ts`, `sessionUpdateHandler.test.ts`; server compiles with no per-connection `userId` | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |
| HS-11 | `fork/forkLogger.ts` — `isQuietLogger` / `buildForkLoggerStreams` / `applyForkLoggerOptions` / `createShutdownLogger` (composed in `utils/log.ts`) | KEEP | Embedded-daemon **quiet-logger** gate + the fork-only `shutdownLogger` export. When happy-cli embeds happy-server it sets `HAPPY_SERVER_QUIET_LOGGER=true` (see `index.ts`), which drops the pretty stdout stream **and** disables the root logger so the embedded daemon is silent; `shutdownLogger` flushes + ends the logger(s) on daemon shutdown. Upstream has **neither**. Relocated to a fork seam and reconciled onto upstream's Bun-safe `pretty()`+`pino.multistream` shape — behavior-preserving (non-quiet == upstream exactly; quiet drops pretty + disables the root logger; the optional file-only logger keeps the upstream shape). Take-upstream drops quiet mode + `shutdownLogger`. | ✅ inline (fork-seam header + call-sites) | `pnpm --filter happy-server typecheck` (no log spec); `index.spec.ts` boots the embedded server under quiet mode | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |
| HS-12 | `app/api/routes/pushRoutes.ts` — `pushRoutes(app, tofuConfig)` server-owned per-machine push | KEEP | Fork's **server-owned per-machine** push registration (single-user): tokens keyed by `tofuConfig.localUserId` as `machineId` via `@/app/push/pushNotifications` (`registerPushToken` / `unregisterPushToken` / `listPushTokens`), plus the extra `/push/register` route. Upstream's multi-tenant `request.userId` + `db.accountPushToken` (`accountId`) wiring stays **removed** with the deleted `Account`/`AccountPushToken` models (HS-6). Take-upstream re-adds per-account push tokens. | ✅ inline (fork route entry) | server compiles with no `db.accountPushToken` / `request.userId`; `publicAuthGate.spec.ts` (routes gated behind `app.authenticate`) | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |
| HS-13 | `app/monitoring/metrics2.ts` — `updateDatabaseMetrics` DB-count gauges | KEEP-DELETED | HS-6-driven: the multi-tenant `Account` model is removed (single-user), so the updater counts **only** the 3 fork-schema tables (`session`, `sessionMessage`, `machine`) and emits **no** `accounts` gauge. Exact `db.*.count()` is kept (single-user tables are tiny); upstream's `getEstimatedRecordCount` (`pg_class`/`reltuples` catalog estimate) is **declined** — it references the removed `"Account"` table and targets Postgres, not the fork's embedded PGlite. Take-upstream resurrects the `Account` count. | ❌ (guard by absence) | server compiles with **no** `db.account` reference and no `accounts` gauge label; `updateDatabaseMetrics` sets exactly the 3 fork-schema gauges | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |
| HS-14 | `index.ts` — fork embedded-server entry (`createApp` / `HappyServerConfig` / `bootstrapMachineForEmbedded`) | KEEP-ours | Fork's `index.ts` is the **embedded-server entry** (`createApp`, `HappyServerConfig`, `bootstrapMachineForEmbedded`, the HS-5 operator-identity gate re-export, and the `HAPPY_SERVER_QUIET_LOGGER` bootstrap that drives HS-11). Upstream's same-named file is a **different-purpose package entry** (`startApi` / `StartApiOptions`, top-level bootstrap) — an **add/add** divergence. Intake = **take-ours, do not merge**: upstream's entry does not fit the embedded single-user server. Take-upstream would replace the embedded entry wholesale. | ❌ (whole-file fork-owned, take-ours; the HS-5 re-export marker inside is catalogued under HS-5) | `index.spec.ts` (boots the embedded server, asserts the operator-identity gate + dual-listener binding) | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |
| HS-15 | `package.json` — embedded pkgroll packaging + fork dependency set | KEEP (mechanical) | Fork's `package.json` uses an **embedded pkgroll `dist/` layout** (`main`/`module`/`exports`/`files` + `build` scripts producing a library-style bundle) instead of upstream's `bin/`+`webapp/` app packaging, and carries fork-only deps (auth/crypto: `@noble/ed25519`, `@noble/hashes`, `jose`, `@octokit/webhooks`; tooling: `tsx`, `vitest`, `vite-tsconfig-paths`). Upstream-only `@fastify/static` is **declined** — the fork serves no bundled webapp (see HS-7). Version diffs are intentional, **not** trivially-alignable bumps: the fork pins `pino`/`chalk` exactly and stays on `zod` v3 / `prisma` 6.11 / `fastify-type-provider-zod` v4, whereas upstream's `zod` v4 / `prisma` 6.19 / `fastify-type-provider-zod` v6 are breaking major bumps that are not behavior-preserving. Intake = **accept manual-merge**: take dep bumps deliberately (each with its own testing), keep fork packaging + fork-only deps. | ❌ (`package.json` is not scanned by the marker audit — `.ts`/`.tsx`/`.mts`/`.cts`/`.prisma` only) | manual review at intake; `pnpm --filter happy-server typecheck` + the auth-plane vitest set exercise the pinned dep versions | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |
| HS-16 | `storage/processImage.spec.ts` — image-resize test | RESTORE | Fork's stale spec (20×10 fixture, `thumbhash.length`) diverged from upstream's (200×100, asserts `pixels` length) while `storage/processImage.ts` is **byte-identical to upstream `cli-1.1.10`** (0 diff-hunks; returns `pixels: data`). Adopting upstream's spec **verbatim** passes against the fork's already-upstream impl and **eliminates the hard-conflict** — this is a test-only RESTORE, not a behavior change. | ❌ (adopted upstream verbatim; no fork delta to mark) | `processImage.spec.ts` (upstream assertions: format/width/height/thumbhash/`pixels` length) | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |
| HS-17 | `storage/files.ts` — `deleteSessionAttachments(sessionId)` | KEEP (adopt-adapted) | Fork adopted upstream's `cli-1.1.10` session-attachment storage GC helper, **adapted to the fork's lazy `configureFilesFromEnv()` init**. Upstream reads S3/local config at module load; the fork defers storage configuration to first use, so the helper must prime `configureFilesFromEnv()` before reading `useLocalStorage`/`s3client`/`s3bucket`. A blind take-upstream drops that prime call and leaves storage uninitialised (defaults to local, wrong for S3 deployments). Uses only existing fork storage primitives; **no tenancy, no account/userId**. Found as an unclassified gap file during the first cli-1.1.10 intake (S3). | ✅ inline | `pnpm --filter happy-server typecheck` (helper compiles against the fork's storage-config surface); live caller is `sessionDelete.ts` (HS-18) | first `cli-1.1.10` intake — S3 gap (findings rec #5) |
| HS-18 | `app/session/sessionDelete.ts` — after-tx `deleteSessionAttachments` cleanup | KEEP (adopt-adapted) | Fork adopted upstream's `cli-1.1.10` attachment-GC-on-delete (a non-fatal try/catch in the after-commit hook), **adapted to single-user logging — no `userId`/`ctx.uid`**. The account plane and the `Context` param were removed with the multi-tenant identity graph (HS-6), so `sessionDelete` is `sessionDelete(sessionId, eventRouter)`. A blind take-upstream reintroduces `ctx.uid` in the cleanup log calls, which does not compile against the fork's single-user signature. Behaviour is additive: on delete, orphaned session blobs are GC'd. Found as an unclassified gap file during the first cli-1.1.10 intake (S3). | ✅ inline | `pnpm --filter happy-server typecheck` (single-user signature, no `ctx`); calls `deleteSessionAttachments` (HS-17) | first `cli-1.1.10` intake — S3 gap (findings rec #5) |

## 4. happy-cli invariants (`HC-*`)

Paths relative to `packages/happy-cli/src/` unless noted. See [`packages/happy-cli/AGENTS.md`](../packages/happy-cli/AGENTS.md).

| # | file:symbol (line hint) | bucket | invariant — why it must survive | marker? | test / guard | replant note |
|---|---|---|---|---|---|---|
| HC-1 | `api/apiSession.ts:659` — `enqueueMessageWithDelivery` send path (via `api/sessionPayloadCodec.ts` `encodeOutgoing`) | RESTORE-R2-done | Fork serializes message content as **plaintext JSON** (`encodeOutgoing = JSON.stringify(content)` — the local `encrypted` name is a misnomer); no E2E encryption on send. Now routed through the fork codec seam `sessionPayloadCodec.ts` (behavior-preserving relocation, bytes unchanged). Take-upstream reinstates `encrypt()`. Pairs with the server's honest-only-if-encrypted `{t:'encrypted'}` label (`HS-4`). | ✅ inline | `api/sessionPayloadCodec.test.ts`, `api/apiSession.test.ts` | [§8 R2-cli](#r2-cli-half--e2e-codec-asymmetry-hc-1-hc-2-hc-3) |
| HC-2 | `api/apiSession.ts:316` — live-receive socket update (via `api/sessionPayloadCodec.ts` `decodeIncoming({source:'live'})`) | RESTORE-R2-done | Live-receive path treats `c` as **plaintext** (`decodeIncoming({source:'live'}) = JSON.parse(...content.c)`, no `decrypt()`), mirroring the plaintext send path. Now routed through the fork codec seam `sessionPayloadCodec.ts` (behavior-preserving relocation, bytes unchanged). Take-upstream reinstates decrypt-on-receive. | ✅ inline | `api/sessionPayloadCodec.test.ts`, `api/apiSession.test.ts` | [§8 R2-cli](#r2-cli-half--e2e-codec-asymmetry-hc-1-hc-2-hc-3) |
| HC-3 | `api/apiSession.ts:575` — fetch / cold-start replay path (via `api/sessionPayloadCodec.ts` `decodeIncoming({source:'fetch'})`) | RESTORE-R2-done | The fetch path **still calls `decrypt()`** (`decodeIncoming({source:'fetch'})`) while send + live-receive are plaintext — a **latent asymmetry**: fetched replay of plaintext messages fails to decode (`decrypt()` returns null **or throws** — e.g. `legacy` `bad nonce size` — variant/length dependent) and is dropped by the fetch call site's try/catch (logged "Failed to decrypt fetched message"). The R2 codec seam `sessionPayloadCodec.ts` unifies all three paths **without fixing this** — a real fix is a format change, out of M1 (do not "fix" one path in isolation). | ✅ inline | `api/sessionPayloadCodec.test.ts`, `api/apiSession.test.ts`, `api/apiSession.consumptionAckTimeout.test.ts` | [§8 R2-cli](#r2-cli-half--e2e-codec-asymmetry-hc-1-hc-2-hc-3) |
| HC-4 | `fork/onCodexRun.ts::onCodexRun` (relocated from `codex/runCodex.ts`) | RESTORE-R4-done | Fork's codex agent-loop wiring is heavily rewritten vs upstream (embedded app-server, agent-tree, MCP notification routing, sandbox). **Relocated behind `onCodexRun()` (M1-S6 / R4b)** — `runCodex.ts` is now a thin upstream-shaped seam that delegates to `fork/onCodexRun.ts`; the `codex/` overlay bodies are unchanged. *Thin reduction only* — the codex entry body is ~entirely fork-owned end to end, so the seam relocates the whole entry rather than splitting a discrete inline block. Placed in its own `fork/onCodexRun.ts` module (a `forkHooks` sibling, not inside `forkHooks.ts`) so ink/react is not dragged into the daemon startup graph. | ✅ `onCodexRun.ts` header + `runCodex.ts` call site | `codex/runCodex.fork.test.ts`, `codex/runCodex.turnLifecycle.test.ts`, `codex/runCodex.delegation.test.ts` | [§8 R4](#r4--codex--daemon-wiring-hc-4-hc-5-hc-6-hc-7) |
| HC-5 | `fork/onClaudeRun.ts::onClaudeRun` (relocated from `claude/runClaude.ts`) | RESTORE-R4-done | Fork's claude agent-loop wiring diverges from upstream (hook server, permission handling, session protocol mapping). **Relocated behind `onClaudeRun()` (M1-S7 / R4c-i)** — `runClaude.ts` is now a thin upstream-shaped seam that delegates to `fork/onClaudeRun.ts`; the `claude/` overlay bodies are unchanged. *Thin reduction only* — the claude entry body is ~entirely fork-owned end to end. Placed in its own `fork/onClaudeRun.ts` module (a `forkHooks` sibling, not inside `forkHooks.ts`) so ink/react is not dragged into the daemon startup graph. | ✅ `onClaudeRun.ts` header + `runClaude.ts` call site | `claude/runClaude.test.ts`, `claude/runClaude.delegation.test.ts` | [§8 R4](#r4--codex--daemon-wiring-hc-4-hc-5-hc-6-hc-7) |
| HC-6 | `fork/forkHooks.ts::onDaemonRun` (relocated from `daemon/run.ts`) | RESTORE-R4-done | Fork daemon **embeds the happy-server** and allocates loopback/tunnel/ingest ports (upstream daemon is a thin remote client). **Relocated behind `forkHooks.onDaemonRun()` (M1-S5 / R4a)** — `startDaemon` now calls one hook instead of carrying the inline block; the `daemon/` overlay bodies are unchanged. | ✅ `forkHooks.ts` header + `run.ts` call site | `fork/forkHooks.test.ts`, `daemon/daemon.integration.test.ts`, `daemon/run.spawnFromSession.test.ts` | [§8 R4](#r4--codex--daemon-wiring-hc-4-hc-5-hc-6-hc-7) |
| HC-7 | `fork/forkHooks.ts::onMachineRpc` (relocated from `api/apiMachine.ts`) | RESTORE-R4-done | Fork's machine client (embedded-server spawn + daemon RPC handlers) diverges from upstream's multi-machine model. **Relocated behind `forkHooks.onMachineRpc()` (M1-S7 / R4c-ii)** — `ApiMachineClient.setRPCHandlers` now calls one hook instead of carrying the inline RPC-registration block; the `daemon/` + `codex/` validators it delegates to are unchanged. | ✅ `forkHooks.ts` header + `apiMachine.ts` call site | `api/apiMachine.keepalive.test.ts`, `api/forkSession.rpc.test.ts`, `fork/forkHooks.test.ts` | [§8 R4](#r4--codex--daemon-wiring-hc-4-hc-5-hc-6-hc-7) |
| HC-8 | `utils/MessageQueue2.ts` — `MessageQueueAttachment{type,ref,mimeType}`, `MessageDelivery`, `MessageBatch.consumedMessages` | KEEP | Fork models attachments **by ref** (`{type, ref, mimeType}`, ref-indirection powers the `.happy/attachments/*` writeFile-RPC path) and tracks **consumption-ack delivery** (`MessageDelivery`, `consumedMessages`); upstream uses inline-bytes `PendingAttachment{data, mimeType, name}` with no delivery-receipt surface. Convergence toward upstream inline-bytes is **operator-gated (US-004)**; default KEEP. | ✅ inline | `utils/MessageQueue2.test.ts` | US-004 optionally RESTOREs upstream `PendingAttachment` inline-bytes; US-003 aligned field order only. |
| HC-9 | `claude/utils/sessionScanner.ts` — `normalizeSessionLogMessage`, `getSessionLogMessageKey` | KEEP | Fork normalizes session-log message titles (`normalizeSessionLogMessage`) and keys entries via `getSessionLogMessageKey`; upstream restructured to entries/`transcript-event`/`claudeGoalStatus`. Documented fork behavior (CLI AGENTS.md). | ✅ inline | `claude/utils/sessionScanner.test.ts` | Localize only; helper-rename left as-is (upstream renamed too). |
| HC-10 | `claude/claudeLocalLauncher.ts` (`performSwitch`, `request-switch`/`cancel-pending-switch` RPC), `claude/session.ts` (`pendingSwitch`) | KEEP | Fork Claude **deferred-switch** protocol (`performSwitch`; `pendingSwitch`/`deferredSwitchCompleting`/`switchFired`; `request-switch`/`cancel-pending-switch` RPC; `closeClaudeSessionTurn`) plus **SDK-summary forwarding** (upstream's "Block SDK summary messages" filter is intentionally removed); upstream uses `doSwitch`/`onAbort`. | ✅ inline | `claude/claudeLocalLauncher.test.ts`, `claude/session.test.ts` | US-002 extracts to `src/fork/claudeDeferredSwitch.ts` (or catalogue-only fallback if hook wiring entangles). |
| HC-11 | `claude/claudeRemoteLauncher.ts` (`emitConsumptionReceipts`, `MessageBatch`), `claude/claudeRemote.ts` (`ClaudeRemoteQueuedMessage`) | KEEP | Fork remote path emits **consumption receipts** (`emitConsumptionReceipts` over `MessageBatch.consumedMessages`) and carries an attachment-by-ref queued-message type; ties to HC-8 delivery tracking. Upstream sends per-message inline attachments with no consumption-ack. | ✅ inline | `claude/claudeRemote.test.ts` | Pairs with HC-8; converge only if HC-8 converges. |
| HC-12 | `configuration.ts` — `serverUrl` default (`http://127.0.0.1:3005`) | KEEP | **Load-bearing** embedded per-daemon server default URL `http://127.0.0.1:3005`; upstream defaults to `https://api.cluster-fluster.com`. The fork has no central server (distributed per-daemon) so this default MUST survive. US-001 aligns only the `chmodSync`/`readFileSync` import churn, never the default. | ✅ inline | `utils/serverConnectionErrors.test.ts` | Never take-upstream; architectural. |
| HC-13 | `claude/sdk/query.ts` — `opts.env` passthrough (`sdkOptions.env = env`) | KEEP | Fork injects per-query env into the Claude SDK (`opts.env` merged over `process.env`); upstream has no per-query env injection (its diff is an `effort` reorg). | ✅ inline | covered via claude launcher integration | Localize; fork feature. |
| HC-14 | `commands/codexCommand.ts` — `--effort`/`--idle-timeout`/resume flag extractors | KEEP | Fork codex arg parsing (`--effort`, `--idle-timeout`, resume/model/permission-mode/transport/project-doc flag extractors); upstream consolidates into `codexArgs` + `permissionMode`. | ✅ inline | `commands/codexCommand.test.ts` | Localize; fork codex UX. |
| HC-15 | `claude/utils/permissionHandler.ts` — `reset({clearAllowlist})` | KEEP | Session-allowlist reset signature (`reset({clearAllowlist})`) — the allowlist survives non-session resets; upstream uses `reset(reason)` with no session-allowlist concept. | ✅ inline | covered via claude launcher tests | Localize. |
| HC-16 | `claude/utils/sessionProtocolMapper.ts` — `boundaries` intents | KEEP | Typed context-boundary intents (`boundaries`, `detectWrappedSlashCommandBoundary`, `planModeBoundaryForTool`) for `/clear`,`/compact` and plan-mode transitions; upstream keys on `claudeUuid` with no boundary intents. | ✅ inline | covered via sessionProtocolMapper usage | Fork wire feature. |
| HC-17 | `utils/createSessionMetadata.ts` (`parentSessionId`), `persistence.ts` (`mcpNotificationRouting`), `modules/common/registerCommonHandlers.ts` (`model`/`permissionMode`) | KEEP | Small **additive** fork spawn-metadata: spawn-ancestry `parentSessionId` (from `HAPPY_PARENT_SESSION_ID`), opaque codex-MCP notification routing config, and `model`/`permissionMode`/`effortLevel` spawn fields; upstream omits all three. | ✅ inline | `utils/createSessionMetadata.test.ts` | Additive; low-conflict. |
| HC-18 | `api/api.ts` — tripwire where upstream's `push()` getter would land (fork **absent** `push()`/`pushClient`) | KEEP-DELETED | Fork **removed** the push-notification client (upstream's `push(): PushNotificationClient` getter + `pushClient` + vendor-token/deactivate helpers). The fork has NO central server (distributed per-daemon) so there is no push infra. **Do NOT resurrect** on upstream intake. | ✅ inline | guard-by-absence (no `push()` on `ApiClient`) | Never resurrect the push client. |
| HC-19 | `codex/codexAppServerClient.ts` — `ws` default transport | KEEP | Fork codex **ws-transport** app-server client (`ws` default transport + `createWsTransport` + discovery-lock + `--ws-auth`→stdio fallback); upstream is stdio-only. | ✅ inline | `codex/codexAppServerClient.test.ts`, `codex/__tests__/executionPolicy.test.ts` | Fork codex feature. |

### Zero-conflict overlay directories (context only — NO markers)

Large parts of the fork's happy-cli surface live in directories that upstream **does not have at all**
(fork-only features). They never three-way-conflict — an import cannot touch a file upstream lacks — so
they get **no markers** and only a context row here. If upstream ever introduces a same-named dir, revisit.

| overlay dir (under `packages/happy-cli/src/`) | upstream-canonical files | fork-only files | conflict risk |
|---|---:|---:|---|
| `codex/` | 20 | 41 | Canonical files (`runCodex.ts` etc.) are catalogued as `HC-4`; the 41 fork-only files are zero-conflict. |
| `daemon/` | 12 | 30 | `run.ts` etc. catalogued as `HC-6`; the 30 fork-only files are zero-conflict. |
| `agentComms/` | 0 | 33 | Entire dir is fork-only (Scope-A mailbox/peer transport) — zero-conflict. |
| `tunnel/` | 0 | 13 | Entire dir is fork-only (cloudflare/dev-tunnel providers) — zero-conflict. |
| **total fork-only** | — | **117** | No markers; import-safe by construction. |

### happy-cli manifest & import divergence is fork-required-only (conflict-irreducible)

The `packages/happy-cli/` files that most often show noisy upstream diffs —
`package.json`, `configuration.ts`, and `api/apiSession.ts` — were audited
against a real 3-way merge (base `cli-1.1.7`, theirs `cli-1.1.10`, ours
`main`) to find any *mechanical* noise whose removal would shrink the conflict
surface. **There is none**: every remaining delta is fork-required, so no
behavior-preserving reorder reduces the conflict count. Two non-obvious traps
were found and are recorded here so future rebasers don't re-introduce them:

- **`package.json` — two irreducible conflict regions, both fork-required:**
  the `version` string and the fork-simplified `scripts` block. Everything
  else in the manifest merges cleanly.
  - **Trap A — do NOT alphabetically re-sort `happy-server`.** The
    `happy-server` workspace dependency is a pure fork addition. At its
    current position (immediately after `@stablelib/hex`, bordered by
    version-*unchanged* lines) it merges with **zero** conflict. Moving it to
    the "correct" alphabetical slot places it adjacent to
    `fastify-type-provider-zod` — a line upstream version-bumped
    (`4.0.2` → `^6.1.0`) — which fuses the insertion into that change region
    and manufactures a spurious extra conflict hunk. Leave it where it is.
  - **Trap B — silent version-pin merge.** The fork holds several deps below
    upstream (`@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`,
    `fastify-type-provider-zod`, `zod`). Because these pins equal the pre-fork
    base, a 3-way merge takes upstream's newer version **cleanly (no conflict
    is raised)** and silently drops the fork's pin. Re-verify these pins by
    hand after every upstream sync — the merge tool will not flag them.
- **`configuration.ts` / `api/apiSession.ts` — divergence is feature-driven
  imports only** (e.g. `chmodSync`, `sessionPayloadCodec`, `daemonClient`),
  not reorderable noise; reordering them is neutral-to-negative on the
  conflict count. `configuration.ts` retains the fork
  `http://127.0.0.1:3005` default (invariant HC-12).

## 5. happy-app inventory (`HA-*`)

Paths relative to `packages/happy-app/sources/` unless noted. See [`packages/happy-app/AGENTS.md`](../packages/happy-app/AGENTS.md).

> **Doc-only in M0.** The app hotspots below are the durable **manual three-way-merge cost centers**
> (large fork-rewritten files that conflict on nearly every import). M0 does **not** add source markers
> to them — the marker ROI is low on files that are already ~entirely fork-owned, and the merge is
> manual regardless. They are catalogued here so the importer knows to budget three-way-merge time,
> and so M2+ relocations (R5/R6/R8) have a starting inventory.

> **R8 stage 1 update.** `HA-8` (MarkdownView) has begun relocating under **R8** (M2) — its KEEP hunks
> now live in `sources/fork/markdown/*` behind a `RESTORE-R8d` seam (see
> [§8 R8](#r8--happy-app-ui-seams-ha-8-markdownview-stage-1)). `HA-4`/`HA-5`/`HA-6` are re-scoped to
> RESTORE-R8 targets for later stages; `HA-9`–`HA-12` are added below as planned inventory. `HA-3`
> (sync reducer) and `HA-7` (i18n) remain doc-only for now.

> **R5 update (sync-plane residual).** `HA-1` (`sync/sync.ts`) and `HA-2` (`sync/storage.ts`) now carry
> **inline KEEP + KEEP-DELETED markers** (see [§8 R5](#r5--happy-app-sync-plane-ha-1-ha-2)). The brainstorm's
> honest verdict was **no clean seam / file reduction is achievable** — both files are permanent
> **manual-three-way clusters** by convergent evolution, so R5 is a *catalogue formalization* (markers +
> intake recipe), **not** a relocation. The removed multi-account plane is recorded as `HA-1a`/`HA-2a`
> (KEEP-DELETED); upstream's unread-tracking is recorded as `HA-1b` (RESTORE?, deferred / e-ink-gated).

> **A0 update (`cli-1.1.10` intake — uncatalogued hard-conflict extension).** Rows **`HA-13`…`HA-52`** below
> catalogue the app files that hard-three-way-conflict against `cli-1.1.10` (`git merge-file --diff3` exit>0,
> CRLF→LF normalized; BASE `cli-1.1.8`, THEIRS `cli-1.1.10`, OURS = fork HEAD) but were **not** yet in this
> inventory. The app hard set is **59 files = 23 already catalogued (HA-1…HA-12) + 35 newly-catalogued
> diverged files (HA-13…HA-47) + 1 `package.json` (HA-48, §7-governed) + 8 fork-deleted resurrection
> hazards (HA-49…HA-52, grouped by plane)**. **All are catalogue-only** (❌ marker column — A0 adds NO inline
> marker; markers land at the A1–A5 code stages after operator sign-off). Every newly-catalogued diverged
> file classified **KEEP** or **KEEP + adopt(?)** — **none** is a wholesale adopt-upstream RESTORE. The
> `KEEP + adopt?` rows that change **observable app behavior** are flagged **operator-call** and enumerated
> in [§5 A0 decision table](#app-intake--uncatalogued-hard-conflict-classification-a0). **This block gates
> A1–A5 — do not begin the app code stages until the operator signs off the adopt-set.**

| # | file:symbol | bucket | invariant — why it conflicts / must survive | marker? | test / guard | replant note |
|---|---|---|---|---|---|---|
| HA-1 | `sync/sync.ts` — `Sync` class (single-user sync orchestrator) | KEEP | Fork's single-user / embedded-server / loopback `Sync` class diverges broadly from upstream's multi-account sync. **Convergent evolution**, not liftable fork blocks: both sides independently rewrote `sendMessage`, `fetchMessages`, `fetchMachines`, and the socket update-handlers, so it is a permanent **manual three-way merge** (22 conflict hunks vs `cli-1.1.10`). Extractable helpers already live in zero-conflict fork-only modules (see the sync-plane overlay note below); only the call sites conflict. | ✅ inline — `[KEEP]` cluster-head at `class Sync` + `[KEEP-DELETED]` multi-account anchor (both cite HA-1) | `pnpm --filter happy-app typecheck`; `sync/messageWindow.spec.ts`, `sync/applyPrefetchedRange.spec.ts`, `sync/machineFallbacks.test.ts` | start-from-OURS — [§8 R5](#r5--happy-app-sync-plane-ha-1-ha-2) intake recipe |
| HA-1a | `sync/sync.ts` — multi-account plane (removed) | KEEP-DELETED | Fork **removed** the multi-account plane: friends/users/feed/artifacts state, the `apiFeed`/`apiFriends` imports, and the feed-event filter (`friend_request`/`friend_accepted`) inside `syncSettings`. A take-upstream merge silently **resurrects** them. Verified 0 `applyFriends`/`applyFeedItems`/`friendTypes` refs in the fork. | ❌ (guard by absence — annotated by the `[KEEP-DELETED]` marker at the `class Sync` head, which cites numeric parent HA-1; the audit scans numeric IDs only) | `pnpm --filter happy-app typecheck`; grep `applyFriends` / `applyFeedItems` / `friendTypes` == 0 hits | take-ours, mechanical — [§8 R5](#r5--happy-app-sync-plane-ha-1-ha-2) |
| HA-2 | `sync/storage.ts` — Zustand session/message store | KEEP | Fork's single-user Zustand store (one `create()` closure) diverges broadly: parent/children DFS tree-grouping (`buildSessionRowData`/`buildSessionListViewData`, `TreeSessionRowData`), `userChosen` sticky permission mode, pinned avatars + tree-expanded persistence, and render-window older-message pagination fields. **Convergent evolution** with upstream's unread-tracking rewrite of the same functions — permanent **manual three-way merge** (24 conflict hunks vs `cli-1.1.10`); the store closure cannot be relocated behind a seam. | ✅ inline — `[KEEP]` cluster-head at `create<StorageState>()` + `[KEEP-DELETED]` multi-account anchor at `interface StorageState` (both cite HA-2) | `pnpm --filter happy-app typecheck`; `sync/storage.tree.spec.ts`, `sync/storagePermissionModeUserChosen.test.ts`, `sync/encryptionDeletion.spec.ts` | start-from-OURS — [§8 R5](#r5--happy-app-sync-plane-ha-1-ha-2) intake recipe |
| HA-2a | `sync/storage.ts` — multi-account store (removed) | KEEP-DELETED | Fork **removed** the multi-account store surface: friends/users/feed/artifacts state+methods+hooks and the `realtimeMode` debounce. A take-upstream merge silently **resurrects** them (and re-adds upstream's unread-tracking — see HA-1b). Verified 0 `unreadSessionIds`/`applyFriends` refs in the fork. | ❌ (guard by absence — annotated by the `[KEEP-DELETED]` marker at the `StorageState` interface, which cites numeric parent HA-2) | `pnpm --filter happy-app typecheck`; grep `unreadSessionIds` / `applyFriends` == 0 hits | take-ours, mechanical — [§8 R5](#r5--happy-app-sync-plane-ha-1-ha-2) |
| HA-1b | `sync/sync.ts` + `sync/storage.ts` — upstream unread-tracking (absent) | RESTORE? (operator-gated) | Upstream's unread-session tracking (`unreadSessionIds`/`currentViewingSessionId`, `markSessionRead`/`markSessionUnread`/`useIsSessionUnread`, web `webTabTitle`, reconnect `sendAppState(getCurrentAppState())`) — the fork **lacks it entirely**. Adopting it would shrink future conflict but is **entangled**: the `unreadSessionIds` param threads through the exact tree-grouping functions the fork rewrote (adopt-with-manual-merge), and unread badges add e-ink repaint churn. **DEFER (lean no for e-ink)**; if adopted, file its own task with a default-`false` toggle + e-ink perf pass. | ❌ (not adopted — no fork code to mark) | n/a until adopted | if not adopted, drop upstream's unread additions each intake — [§8 R5](#r5--happy-app-sync-plane-ha-1-ha-2) |
| HA-3 | `sync/reducer/reducer.ts` — message→event reducer | KEEP | Fork reducer carries the typed context-boundary handling and e-ink-friendly accumulation. Conflicts with upstream reducer changes. | ❌ (doc-only in M0) | `sync/reducer/reducer.spec.ts`, `messageToEvent.spec.ts` | deferred M2+ (sync plane, ~R5) |
| HA-4 | `-session/SessionView.tsx` — session screen | KEEP | Fork's chat surface is tuned for the **e-ink tablet** (static UI, no smooth-scroll/continuous repaint). Broadly rewritten vs upstream. | ✅ `RESTORE-R8a` | `pnpm typecheck`; `-session/SessionView.fileRoute.test.tsx`, `-session/SessionView.intercept.test.ts`, `sync/machineFallbacks.test.ts`, `sync/sync.test.ts` (send call-site audit) | **R8 stage 5 DONE** — 4a–4h KEEP-relocated to `sources/fork/session/*` (composer + pre-send intercept, boundary advisory, context drawer, sidebar, header surfaces); 4i DISABLE deferred; 4j/4k/4l (send-policy / permission-model-effort / visibility sync) KEEP-in-place as **SYNC-R5 residual**; voice-runtime + fork-from-message **out-of-scope / inert**. See [§8 R8 stage 5](#stage-5-this-ship--ha-4--sessionsessionviewtsx). |
| HA-5 | `components/ChatList.tsx` — message list | KEEP + RESTORE-grouping | Fork's inverted-FlatList perf work + `BoundaryDivider` rendering (shipped upstream as PR #1154, but fork carries adjacent e-ink tuning) **plus** upstream's tool-call/agent-work grouping restored behind a default-flat toggle (operator call #2). | ✅ `RESTORE-R8b` | `components/ChatList.{preBoundaryHistory,viewableItemsAdapter,pageTurn,toolGroupingToggle}.test.*`; `hooks/useGroupedMessages.test.ts` | **R8 stage 2 DONE** — flat e-ink body KEEP-relocated to `sources/fork/chat/*` (5a FlatList tuning, pinch-zoom, page-turn); upstream grouping restored (`useGroupedMessages`, `ToolGroupView`) behind `chatToolGrouping` local setting (**default `'flat'`** = behavior-identical). See [§8 R8 stage 2](#stage-2-this-ship--ha-5-componentschatlisttsx). |
| HA-6 | `components/AgentInput.tsx` — composer | KEEP + RESTORE-voice | Fork input diverges on modes/attachments/keyboard for the e-ink target (fork-introduced keyboard/focus reducer + in-composer text-size/chat-width choosers) **plus** upstream's mic/voice input restored (operator call #4). High-churn conflict surface. | ✅ `RESTORE-R8c` | `components/AgentInput.{mode,attachments,keyboard,activeRegression}.test.tsx`; `fork/agentInput/keyboardStateMachine.test.ts` | **R8 stage 4 DONE** — keyboard state machine + text-size/chat-width overlays KEEP-relocated to `sources/fork/agentInput/*`; upstream mic/voice RESTORED (inert until a parent wires `onMicPress`); attachment rewrite + controlled-mode KEEP-in-place; SYNC-R5 send-policy/reducer KEEP-in-place (R5-residual). See [§8 R8 stage 4](#stage-4-this-ship--ha-6-componentsagentinputtsx). |
| HA-7 | `text/_default.ts` + `text/translations/*.ts` — i18n | KEEP | Fork-added translation keys must survive import. **`merge=union` is UNSAFE here** (typed nested TS object modules; duplicate keys error `TS1117` and arrow-value splits break syntax — see §7). Merge is manual or via a future fork-namespaced strings file. | ❌ (doc-only in M0) | `text/translations.test.ts` (structural parity) | deferred M2+ (i18n plane, ~R6) |
| HA-8 | `components/markdown/MarkdownView.tsx` — markdown renderer | KEEP | Fork's e-ink markdown rendering (option cards, contrast-safe code/text-weight styling, font-scale wrapper) + fork features (Claude meta-tag pills, session-file autolinking, internal file-link nav, session-aware image loading). Conflicts on nearly every import. | ✅ `RESTORE-R8d` | `components/markdown/*.test.ts` (parseMarkdown, parseMarkdownBlock, processClaudeMetaTags, skillBody, linkUtils) | **R8 stage 1 DONE** — 8a–8h KEEP-relocated to `sources/fork/markdown/*`; 8j KEEP-in-place; 8i DISABLE deferred to US-001. See [§8 R8](#r8--happy-app-ui-seams-ha-8-markdownview-stage-1). |
| HA-9 | `components/MessageView.tsx` — message renderer | KEEP + RESTORE-chips | Fork's **e-ink user-message band** (grey fill, no bubble `paddingVertical`) + skillBody suppression, chatBodyWidth, boundary divider, attachment chips, nested-depth cap; **plus** upstream's goal/command chips + fork-from-message long-press restored behind a default-off toggle (operator call #3 "KEEP BOTH"). | ✅ `RESTORE-R8e` | `components/MessageView.{attachments,nestedChildren,commandChips}.test.*`; `components/parseLocalCommandMessage.spec.ts` | **R8 stage 3 DONE** — e-ink features KEEP-relocated to `sources/fork/message/*` (band styles, attachment chips, nested-depth cap); upstream goal/command chips (`parseLocalCommandMessage`) + fork-from-message long-press RESTORED behind `messageCommandChips` local setting (**default `false`** = behavior-identical). Composer-side pre-send intercept untouched. fork-from-message parent wiring deferred to the SessionView stage (HA-4). See [§8 R8 stage 3](#stage-3-this-ship--ha-9-componentsmessageviewtsx). |
| HA-10 | `components/SidebarView.tsx` — sidebar screen | KEEP | Fork's collapsible sidebar is a near-total rewrite (280 vs 97 upstream) for the tablet; upstream's same-named file is a DIFFERENT feature (new-session right sidebar). | ❌ (merge=ours shim — no inline marker) | intake: keep-ours via `.gitattributes` | **R8 stage 6 DONE** — operator call #1 = KEEP-as-shim. `.gitattributes merge=ours` keeps the fork version on import; do not adopt upstream's new-session sidebar. Requires `git config merge.ours.driver true` on import host (§7). |
| HA-11 | `components/SidebarNavigator.tsx` — sidebar nav | KEEP | Fork simplified the navigator (125 vs 175 upstream); paired with HA-10; upstream's same-named file is the new-session-sidebar nav. | ❌ (merge=ours shim — no inline marker) | intake: keep-ours via `.gitattributes` | **R8 stage 6 DONE** — operator call #1 = KEEP-as-shim; paired with HA-10. |
| HA-12 | `components/ChatHeaderView.tsx` — chat header | KEEP | Fork's sidebar-restore control + avatar-header redesign (324 vs 176 upstream). | ❌ (merge=ours shim — no inline marker) | intake: keep-ours via `.gitattributes` | **R8 stage 6 DONE** — operator call #1 = KEEP-as-shim (kept the whole fork header incl. the avatar redesign, rather than the selective restore-control-only seam). |
| HA-13 | `app/(app)/new/index.tsx` — new-session screen | KEEP + adopt | Fork new-session composer diverges for the e-ink / remote-daemon target (fork input stack + machine/agent pickers); upstream rewrote the unified composer (20 hunks; fork 583 vs upstream 1851 lines). Only the internal PromptInput keystroke-isolation refactor is a safe hand-port. | ❌ catalogue-only (marker at code stage) | `app/(app)/new/index.unifiedComposer.test.ts` | A0 (`cli-1.1.10`) — KEEP fork body; hand-port keystroke-isolation only, drop upstream multi-account/agent hunks. Internal (no op-call). |
| HA-14 | `components/ActiveSessionsGroupCompact.tsx` — compact session group | KEEP | Fork renders the tablet DFS parent/child session tree (fork-only grouping); upstream diverged on multi-account/unread rendering of the same component. | ❌ catalogue-only (marker at code stage) | `components/ActiveSessionsGroupCompact.dfs-order.spec.tsx` | A0 — KEEP fork body; drop upstream unread hunks. |
| HA-15 | `components/SessionsList.tsx` — session list | KEEP + adopt | Fork's e-ink session list (DFS tree rows, no unread badges); upstream added unread badges + a FlatList selection-stability fix. Adopt the selection-stability hunk only. | ❌ catalogue-only (marker at code stage) | `components/SessionsList.test.tsx` | A0 — KEEP fork body; hand-port FlatList selection-stability, skip unread badges. Internal (no op-call). |
| HA-16 | `hooks/useSessionQuickActions.ts` — quick-action menu | KEEP + adopt? | Fork quick-actions target single-user/e-ink; upstream reworked `resolveMessageModeMeta` (resume model/permission defaults). Adopting changes the model/permission preset applied on session resume. | ❌ catalogue-only (marker at code stage) | `hooks/useSessionQuickActions.test.tsx` | A0 — **operator-call**: adopting alters resume model/permission defaults. Default lean KEEP fork. |
| HA-17 | `app/(app)/_layout.tsx` — app route-group layout | KEEP + adopt? | Fork route tree omits multi-account/github/feed screens; upstream added a new settings/agents route. Adopting makes a new settings route reachable. | ❌ catalogue-only (marker at code stage) | add at code stage: settings-route registry test; interim `sync/encryptionDeletion.spec.ts` (removed-plane absence) + `pnpm --filter happy-app typecheck` | A0 — **operator-call**: new settings/agents route becomes visible. |
| HA-18 | `app/_layout.tsx` — root layout | KEEP + adopt? | Fork root layout drops the encryption/multi-account bootstrap and tunes push for the remote daemon; upstream added foreground-push suppression, a messages notification channel, and browser keyboard shortcuts. | ❌ catalogue-only (marker at code stage) | `sync/encryptionDeletion.spec.ts`, `auth/tokenStorage.test.ts` | A0 — **operator-call**: foreground-push suppression / messages channel / browser shortcuts change observable behavior. |
| HA-19 | `app/(app)/session/[id]/info.tsx` — session-info screen | KEEP + adopt? | Fork session-info screen is single-user/e-ink; upstream added parent-session navigation. Adopting adds a parent-session nav affordance. | ❌ catalogue-only (marker at code stage) | `utils/sessionInfoPermissionMode.test.ts` | A0 — **operator-call**: parent-session nav becomes visible. |
| HA-20 | `components/tools/ToolView.tsx` — tool-card frame | KEEP + adopt? | Fork tool card is e-ink-tuned (static, contrast-safe); upstream reworked compact/header `toolDisplay` layout. Adopting changes tool-card layout. | ❌ catalogue-only (marker at code stage) | `components/tools/ToolView.completedPolish.test.ts` | A0 — **operator-call**: tool-card compact/header layout change. |
| HA-21 | `components/tools/views/CodexPatchView.tsx` — codex patch view | KEEP + adopt? | Fork-owned codex patch renderer (fork feature); upstream added patch-shape normalization (`materializeUnifiedDiffPatch`) + collapsed/embedded patch UI. | ❌ catalogue-only (marker at code stage) | `components/tools/views/CodexPatchView.test.tsx` | A0 — **operator-call**: collapsed/embedded patch UI change. Hand-port normalization carefully (codex feature). |
| HA-22 | `components/tools/PermissionFooter.tsx` — permission footer | KEEP | Fork permission footer matches the e-ink permission-mode model; conflicts on shared imports with upstream. | ❌ catalogue-only (marker at code stage) | `components/tools/ToolView.completedPolish.test.ts` | A0 — KEEP fork body. |
| HA-23 | `components/tools/views/_all.tsx` — tool-view registry | KEEP + adopt? | Fork tool-view registry wires fork-only views; upstream added a `permissionFooter` prop threading + a new `FileView` renderer. Adopting registers a new file renderer. | ❌ catalogue-only (marker at code stage) | `components/tools/FileEditView.test.ts`, `components/tools/views/EditView.test.tsx` | A0 — **operator-call**: new FileView renderer registered. |
| HA-24 | `components/diff/PierreDiffView.tsx` — diff view | KEEP + adopt | Fork diff view is e-ink-styled; upstream added an additive `expandUnchanged` prop. Adopt the additive prop only. | ❌ catalogue-only (marker at code stage) | `components/diff/CollapsibleDiffPreview.test.tsx` | A0 — KEEP fork body; hand-port additive `expandUnchanged`. Internal (no op-call). |
| HA-25 | `sync/apiSocket.ts` — socket client | KEEP + adopt? | Fork socket client targets the loopback/remote daemon; upstream added an `sendAppState`/`appState` handshake used for push suppression. Adopting changes push/appState behavior. | ❌ catalogue-only (marker at code stage) | `sync/apiSocket.test.ts` | A0 — **operator-call**: appState handshake / push suppression. Entangled with HA-18, HA-1b. |
| HA-26 | `sync/ops.ts` — RPC op builders | KEEP + adopt | Fork op set diverges (daemon/codex ops); upstream added spawn-lineage fields, rewind/fork RPCs, and `sessionGoalAction` (additive builders). | ❌ catalogue-only (marker at code stage) | `sync/ops.test.ts` | A0 — KEEP fork body; hand-port additive op builders. Internal (no op-call). |
| HA-27 | `sync/typesRaw.ts` — wire types | KEEP + adopt? | Fork raw wire types drop encryption/multi-account; upstream added `thumbhash`, `claudeUuid`, `codexItemId`, and file-event tool-result shapes. The file-event addition changes attachment rendering. | ❌ catalogue-only (marker at code stage) | `sync/typesRaw.spec.ts`, `sync/typesRaw.lifecycleState.test.ts` | A0 — **operator-call**: file-event attachment rendering. Additive fields otherwise safe. |
| HA-28 | `sync/messageMeta.ts` — outgoing message metadata | KEEP + adopt? | Fork metadata carries codex/e-ink fields; upstream added `agentDefaultOverrides`. Fork maps upstream `effort` → fork `thinkingLevel`, so adopting requires the mapping and changes outgoing metadata. | ❌ catalogue-only (marker at code stage) | `sync/messageMeta.test.ts` | A0 — **operator-call**: outgoing metadata (effort→thinkingLevel mapping). |
| HA-29 | `sync/messageMeta.test.ts` — messageMeta guard | KEEP + adopt | Mirrors HA-28; adopt only the assertions matching accepted HA-28 hunks. | ❌ catalogue-only (marker at code stage) | self (`sync/messageMeta.test.ts`) | A0 — KEEP; track HA-28 decision. |
| HA-30 | `sync/typesMessageMeta.ts` — message-meta types | KEEP + adopt | Fork meta types; upstream added an additive `effort` field. Adopt additive field only. | ❌ catalogue-only (marker at code stage) | `sync/typesMessageMeta.test.ts` | A0 — KEEP fork body; hand-port additive `effort`. Internal (no op-call). |
| HA-31 | `sync/storageTypes.ts` — persisted store types | KEEP + adopt | Fork store types (tree/permission fields); upstream added `forkedFromMessageId` + `AgentGoalStatusSchema` (additive). | ❌ catalogue-only (marker at code stage) | `sync/storageTypes.spec.ts` | A0 — KEEP fork body; hand-port additive schemas. Internal (no op-call). |
| HA-32 | `sync/storageTypes.spec.ts` — storageTypes guard | KEEP + adopt | Mirrors HA-31; adopt assertions for accepted additive fields. | ❌ catalogue-only (marker at code stage) | self (`sync/storageTypes.spec.ts`) | A0 — KEEP; track HA-31 decision. |
| HA-33 | `sync/localSettings.ts` — device-local settings | KEEP + adopt | Fork local settings (e-ink toggles, chatToolGrouping); upstream added an additive `zenMode`. Adopt additive field only. | ❌ catalogue-only (marker at code stage) | `sync/settings.spec.ts`; `pnpm --filter happy-app typecheck` | A0 — KEEP fork body; hand-port additive `zenMode`. Internal (no op-call). |
| HA-34 | `sync/persistence.ts` — store persistence | KEEP | Fork persistence drops the encryption/multi-account persisted planes and keeps tree-expanded state; take-upstream resurrects removed planes. | ❌ catalogue-only (marker at code stage) | `sync/encryptionDeletion.spec.ts`, `sync/persistence.tree-expanded.spec.ts` | A0 — KEEP fork body (guard-by-absence adjacent). |
| HA-35 | `sync/settings.spec.ts` — settings guard | KEEP + adopt | Mirrors the settings additive-field decisions (HA-33 zenMode etc). | ❌ catalogue-only (marker at code stage) | self (`sync/settings.spec.ts`) | A0 — KEEP; track HA-33 decision. |
| HA-36 | `sync/suggestionCommands.ts` — slash-command suggestions | KEEP + adopt? | Fork slash set (codex/daemon); upstream added `/goal` + `metadata.skills` suggestions. Adopting changes the visible slash-suggestion list. | ❌ catalogue-only (marker at code stage) | `sync/suggestionCommands.test.ts` | A0 — **operator-call**: new `/goal` + skills slash suggestions. |
| HA-37 | `components/autocomplete/suggestions.ts` — mention autocomplete | KEEP + adopt? | Fork autocomplete tuned for e-ink; upstream changed the file-mention limit to 50. Adopting changes the suggestion-list length. | ❌ catalogue-only (marker at code stage) | `components/autocomplete/suggestions.test.ts` | A0 — **operator-call**: file-mention suggestion count (50). |
| HA-38 | `components/SettingsView.tsx` — settings screen | KEEP + adopt? | Fork settings screen removes multi-account/github/encryption rows and adds e-ink controls; upstream added `openExternalUrl`, a version-detail row, and an Agent Defaults section. Adopting adds visible rows. | ❌ catalogue-only (marker at code stage) | `components/SettingsView.test.tsx`, `sync/encryptionDeletion.spec.ts` | A0 — **operator-call**: version / Agent-Defaults rows. Defer Agent Defaults; keep guard-by-absence for removed rows. |
| HA-39 | `components/FilesSidebar.tsx` — files sidebar | KEEP + adopt? | Fork files sidebar is e-ink-laid-out; upstream added an all-files mode, Windows path splitting, and per-file line totals. Adopting changes sidebar modes/layout. | ❌ catalogue-only (marker at code stage) | `components/FilesSidebar.test.tsx` | A0 — **operator-call**: sidebar all-files mode / layout. |
| HA-40 | `components/modelModeOptions.ts` — model catalogue | KEEP + adopt | Fork model list (codex + fork defaults); upstream added Claude opus 4.8 + an `xhigh` effort tier (additive catalogue rows). | ❌ catalogue-only (marker at code stage) | `components/modelModeOptions.test.ts` | A0 — KEEP fork body; hand-port additive model/effort rows. Internal (no op-call). |
| HA-41 | `components/modelModeOptions.test.ts` — model-catalogue guard | KEEP + adopt | Mirrors HA-40 additive rows. | ❌ catalogue-only (marker at code stage) | self (`components/modelModeOptions.test.ts`) | A0 — KEEP; track HA-40 decision. |
| HA-42 | `hooks/useDemoMessages.ts` — demo / onboarding messages | KEEP | Fork demo content diverges; upstream demo rewrite conflicts. Fork-owned, no behavior contract. | ❌ catalogue-only (marker at code stage) | `pnpm --filter happy-app typecheck` | A0 — KEEP fork body. |
| HA-43 | `changelog/changelog.json` (pkg root) — fork changelog data | KEEP | Fork-owned versioned changelog history; take-upstream overwrites fork release notes. | ❌ catalogue-only (marker at code stage) | n/a (fork-owned data; consumed by `scripts/parseChangelog.ts`) | A0 — KEEP fork file wholesale. Not audit-scanned (`.json`). |
| HA-44 | `CHANGELOG.md` (pkg root) — fork changelog | KEEP | Fork-owned changelog; take-upstream overwrites fork history. | ❌ catalogue-only (marker at code stage) | n/a (fork-owned doc) | A0 — KEEP fork file wholesale. Not audit-scanned (`.md`). |
| HA-45 | `scripts/parseChangelog.ts` (pkg root) — changelog parser | KEEP | Fork's versioned-changelog parser (fork feature); upstream parser diverges. | ❌ catalogue-only (marker at code stage) | `pnpm --filter happy-app typecheck` | A0 — KEEP fork body. Under `scripts/` (outside the audit scan root). |
| HA-46 | `app.config.js` (pkg root) — Expo app config | KEEP + adopt | Fork build config (bundle ids, remote-daemon); upstream added `buildCommitSha` + iOS `NSAppTransportSecurity`. Adopt additive config only. | ❌ catalogue-only (marker at code stage) | `pnpm --filter happy-app typecheck` / build | A0 — KEEP fork body; hand-port additive config keys. Not audit-scanned (`.js`). |
| HA-47 | `metro.config.js` (pkg root) — Metro bundler config | KEEP + adopt | Fork Metro config (Tauri exclusion, preact singleton for the desktop/e-ink build); upstream diverged on resolver config. | ❌ catalogue-only (marker at code stage) | `pnpm --filter happy-app typecheck` / build | A0 — KEEP fork body; hand-port only non-conflicting resolver hunks. Not audit-scanned (`.js`). |
| HA-48 | `package.json` (pkg root) — app manifest | KEEP | Deps/scripts diverge every intake; **no merge driver** — resolved by manual 3-way per §7 (mirrors server HS-15). Keep fork deps; hand-add upstream's new prod deps only. | ❌ catalogue-only (marker at code stage) | `pnpm --filter happy-app typecheck`; `pnpm install` | A0 — KEEP + manual-3-way per [§7 package.json churn](#packagejson-churn-no-merge-driver--resolved-manual-3-way-is-correct). Not audit-scanned. |
| HA-49 | `encryption/base64.ts`, `encryption/deriveKey.ts`, `sync/encryption/encryption.ts`, `sync/encryption/encryptor.ts`, `auth/secretKeyBackup.spec.ts` — E2E encryption plane (removed) | KEEP-DELETED | Fork **deleted** the end-to-end encryption plane (key derivation, base64 codec, encryptor, secret-key backup); upstream `cli-1.1.10` still ships them. A take-theirs merge **resurrects** the plane. **Resurrection hazard — NEVER take-theirs.** | ❌ (guard by absence — no code to mark) | `sync/encryptionDeletion.spec.ts` (asserts `@/encryption/` + `@/sync/encryption/` import absence) + per-file `Test-Path` == false | A0 — take-ours / keep-deleted, mechanical. Drop upstream re-adds every intake. |
| HA-50 | `app/(app)/user/[id].tsx` — other-user profile screen (removed) | KEEP-DELETED | Fork is **single-user** and **deleted** the multi-account other-user profile screen; upstream still ships it. Take-theirs resurrects the multi-account plane. **Resurrection hazard — NEVER take-theirs.** | ❌ (guard by absence — no code to mark) | `sync/encryptionDeletion.spec.ts` (multi-account/friends absence) + file-absence | A0 — take-ours / keep-deleted, mechanical. |
| HA-51 | `sync/apiGithub.spec.ts` — GitHub-connect plane (removed) | KEEP-DELETED | Fork **removed** the GitHub-connect plane; upstream still ships `apiGithub`. Take-theirs resurrects it (and its `apiGithub` import). **Resurrection hazard — NEVER take-theirs.** | ❌ (guard by absence — no code to mark) | `sync/encryptionDeletion.spec.ts` (asserts `apiGithub` absence) + file-absence | A0 — take-ours / keep-deleted, mechanical. |
| HA-52 | `CLAUDE.md` (pkg root) — upstream per-package agent doc (removed) | KEEP-DELETED | Fork renamed the per-package agent guidance to `packages/happy-app/AGENTS.md`; upstream still ships `CLAUDE.md`. Take-theirs re-adds a stale duplicate that diverges from `AGENTS.md`. **Keep deleted.** | ❌ (guard by absence — no code to mark) | file-absence (`Test-Path packages/happy-app/CLAUDE.md` == false); `packages/happy-app/AGENTS.md` present | A0 — take-ours / keep-deleted. Docs-only (low risk) but avoid a duplicate divergent guidance doc. |

> **Sync-plane fork-only overlay (zero-conflict, import-safe — context only, NO markers).** The R5
> conflict is entirely in the `sync/sync.ts` and `sync/storage.ts` **call sites** that wire in these
> fork-only sync modules — the modules themselves never three-way-conflict and need no seam work:
> `sync/paginationMath.ts`, `sync/prefetchManager.ts`, `sync/messageWindow.ts`,
> `sync/applyPrefetchedRange.ts`, `sync/machineSessionId.ts`, `sync/sessionGroupOrdering.ts`,
> `sync/slashCommandIntercept.ts`, `sync/socketOptions.ts`, `sync/tunnelProvider.ts`. Because the
> extractable logic already lives here, R5 is a *marker + intake-recipe* formalization, not a relocation.

### Zero-conflict overlay directories (happy-app — context only, NO markers)

The happy-app fork overlay lives under [`packages/happy-app/sources/fork/`](../packages/happy-app/sources/fork/README.md).
Files there are **fork-only** (upstream has no `sources/fork/`), so they never three-way-conflict and carry
**no markers** — only the canonical seam in the upstream-canonical file carries the `RESTORE-R8<x>` marker. As
each R8 stage lands it adds a sibling subdir; empty dirs are **not** scaffolded ahead of use.

| overlay subdir (under `packages/happy-app/sources/fork/`) | overlay for | catalogue rows | status |
|---|---|---|---|
| `markdown/` | `components/markdown/MarkdownView.tsx` | HA-8 | **R8 stage 1 (this ship)** |
| `session/` | `-session/SessionView.tsx`, `components/ChatHeaderView.tsx` | HA-4, HA-12 | planned (later R8 stage) |
| `chat/` | `components/ChatList.tsx` | HA-5 | **R8 stage 2 (this ship)** |
| `message/` | `components/MessageView.tsx` | HA-9 | **R8 stage 3 (this ship)** |
| `composer/` (dir name `agentInput/`) | `components/AgentInput.tsx` | HA-6 | **R8 stage 4 (this ship)** |
| _(no overlay — `merge=ours` shim)_ | `components/SidebarView.tsx`, `components/SidebarNavigator.tsx`, `components/ChatHeaderView.tsx` | HA-10, HA-11, HA-12 | **R8 stage 6 DONE** — `.gitattributes merge=ours` (files kept in place, not relocated) |

### App intake — uncatalogued hard-conflict classification (A0)

**Scope.** Stage **A0** of the first selective intake of `cli-1.1.10` (task
`happy-first-selective-intake-cli-1.1.10`). A0 is **catalogue / design only — ZERO edits to
`packages/happy-app/sources/`**. It classifies every app file that hard-three-way-conflicts against
`cli-1.1.10` so the app intake is 100% governed before the A1–A5 code stages. **Method:** for each file in
`git diff --name-only cli-1.1.8 cli-1.1.10 -- packages/happy-app/sources`, keep only files where the fork
HEAD blob also diverged from `cli-1.1.8`, then run `git merge-file -p --diff3 <ours> <base> <theirs>`
(CRLF→LF normalized — the Windows CRLF trap) and keep exit>0 (hard conflict).

**The app hard set = 59 files.** 23 already catalogued (HA-1…HA-12), 35 newly-catalogued diverged files
(HA-13…HA-47), 1 `package.json` (HA-48, §7-governed), 8 fork-deleted resurrection hazards (HA-49…HA-52,
4 plane-grouped rows). **Split:** KEEP **8** · KEEP + adopt (mechanical/additive, no sign-off) **14** ·
KEEP + adopt? (operator-call) **14** · KEEP-DELETED **8 files** (4 rows). **No file classified wholesale
adopt-upstream RESTORE** — every diverged file keeps the fork body; only specific upstream hunks are
hand-port candidates at the code stage.

**Operator sign-off required — 14 `KEEP + adopt?` calls (adopting changes observable app behavior).**
A1–A5 must NOT begin until the operator rules ADOPT or DROP on each:

| catalogue row | file | if ADOPTED, observable change | default lean |
|---|---|---|---|
| `HA-16` | `hooks/useSessionQuickActions.ts` | resume applies upstream model/permission defaults | KEEP fork |
| `HA-17` | `app/(app)/_layout.tsx` | new settings/agents route becomes reachable | KEEP fork |
| `HA-18` | `app/_layout.tsx` | foreground-push suppression + messages channel + browser shortcuts | KEEP fork (e-ink/daemon) |
| `HA-19` | `app/(app)/session/[id]/info.tsx` | parent-session nav affordance appears | KEEP fork |
| `HA-20` | `components/tools/ToolView.tsx` | tool-card compact/header layout changes | KEEP fork (e-ink) |
| `HA-21` | `components/tools/views/CodexPatchView.tsx` | collapsed/embedded patch UI + patch normalization | operator (codex feature) |
| `HA-23` | `components/tools/views/_all.tsx` | new FileView renderer registered | operator |
| `HA-25` | `sync/apiSocket.ts` | appState handshake / push suppression | KEEP fork (entangled w/ HA-18, HA-1b) |
| `HA-27` | `sync/typesRaw.ts` | file-event attachments render | operator (additive fields otherwise safe) |
| `HA-28` | `sync/messageMeta.ts` | outgoing metadata gains agentDefaultOverrides (effort→thinkingLevel) | KEEP fork mapping |
| `HA-36` | `sync/suggestionCommands.ts` | `/goal` + skills slash suggestions appear | operator |
| `HA-37` | `components/autocomplete/suggestions.ts` | file-mention suggestion count → 50 | operator |
| `HA-38` | `components/SettingsView.tsx` | version-detail row + Agent Defaults section appear | KEEP fork; defer Agent Defaults |
| `HA-39` | `components/FilesSidebar.tsx` | all-files mode + path/line-total layout | KEEP fork (e-ink layout) |

**Resurrection hazards — 8 fork-deleted files, KEEP-DELETED (NEVER take-theirs).** Guard = the existing
`sources/sync/encryptionDeletion.spec.ts` (asserts absence of the encryption / github / multi-account planes
via `apiGithub|apiArtifacts|apiFeed|@/encryption/|@/sync/encryption/` grep == 0) + per-file `Test-Path`
== false. All 8 confirmed absent at A0:

1. `sources/encryption/base64.ts` — encryption plane (`HA-49`)
2. `sources/encryption/deriveKey.ts` — encryption plane (`HA-49`)
3. `sources/sync/encryption/encryption.ts` — encryption plane (`HA-49`)
4. `sources/sync/encryption/encryptor.ts` — encryption plane (`HA-49`)
5. `sources/auth/secretKeyBackup.spec.ts` — E2E secret-key backup (`HA-49`)
6. `sources/app/(app)/user/[id].tsx` — multi-account other-user profile (`HA-50`)
7. `sources/sync/apiGithub.spec.ts` — GitHub-connect plane (`HA-51`)
8. `packages/happy-app/CLAUDE.md` — upstream per-package doc; fork uses `AGENTS.md` (`HA-52`)

**Mechanical `KEEP + adopt` (14 — no sign-off; additive/internal hand-ports at the code stage):** `HA-13`,
`HA-15`, `HA-24`, `HA-26`, `HA-29`, `HA-30`, `HA-31`, `HA-32`, `HA-33`, `HA-35`, `HA-40`, `HA-41`, `HA-46`,
`HA-47`. *(Test rows `HA-29`/`HA-32`/`HA-35`/`HA-41` mirror their subject's decision.)*

**Pure `KEEP` (8 — keep fork wholesale):** `HA-14`, `HA-22`, `HA-34`, `HA-42`, `HA-43`, `HA-44`, `HA-45`,
`HA-48` (`package.json`, via §7 manual-3-way).

**Audit note.** All HA-13…HA-52 rows are **catalogue-only** (❌ marker column, no `✅`), so
`node scripts/audit-happy-fork-patches.mjs` stays **zero-drift** — no inline marker is claimed and none
exists in `sources/` yet. Markers are added per-file at the A1–A5 code stages (same pattern as the
`merge=ours` HA-10/11/12 rows). Six of the catalogued files are outside the audit's scan set
(`.ts`/`.tsx`/`.mts`/`.cts`/`.prisma` under the package `sources/` root): `changelog/changelog.json`,
`CHANGELOG.md`, `app.config.js`, `metro.config.js`, `scripts/parseChangelog.ts`, and `package.json` — they
are catalogued here for governance but never audit-scanned.

**No `REVIEW:` items** — every uncatalogued hard-conflict file classified cleanly.

---

## 6. Baseline record

| Field | Value |
|---|---|
| **Import baseline (imported 2026-07-07; merge-lineage anchored 2026-07-08)** | `cli-1.1.10` → `71c417e1092e73cf34eb24f9601d569394c1f359` (upstream `slopus/happy`, 2026-06-23). First imported via the **selective intake** (server `52df4e2d` + cli `c815c581` + app `41f6b677b`), then **anchored as a true merge ancestor** via a `git merge -s ours cli-1.1.10` lineage commit **`761518813`** (zero content change — the ours strategy kept the fork tree byte-identical; the merge only advances the merge-base). `git merge-base HEAD cli-1.1.10` is now `71c417e1` itself. Prior inferred baseline: `cli-1.1.8` (`b72fd8111a43395e9991cfbdabba36f5a3285e5e`). |
| **Forward import target (next intake)** | The next upstream `cli-*` release, or `upstream-happy/main`. Because cli-1.1.10 is now a merged ancestor, the next `git merge` reconciles **only the new-release delta** (the incremental cadence — see [§9](#9-ownership--cadence)). The 3 post-tag commits past cli-1.1.10 were folded in as the first incremental-merge demo (see §9). |
| **Upstream mirror clone (read-only reference)** | `D:/harness-efforts/happy` — remotes: `origin` = `slopus/happy`, `fork` = `Evyatar108/happy` |
| **In-repo upstream remote (permanent — PRIMARY reference)** | codexu remote **`upstream-happy`** = `slopus/happy`; fetched refs `upstream-happy/main` (`d2ef88de`) + tag `cli-1.1.10` (`71c417e1`). 3-way diffs + intake run **directly in codexu** — `git show cli-1.1.10:<path>`, `git merge-file` — no external mirror dependency. Refresh per upstream release: `git fetch --no-tags upstream-happy main` + `git fetch --no-tags upstream-happy tag <new-tag>`. |

**A real merge-base DOES exist (corrected 2026-07-06).** An earlier assessment claimed codexu vendors
happy as a "history-detached copy" with no `git merge-base` — **that was wrong**, an artifact of
computing `git merge-base` *before* the permanent `upstream-happy` remote/objects were fetched (§6
in-repo remote row; task `happy-upstream-permanent-remote-and-cadence`). With upstream's objects
present, `git merge-base HEAD cli-1.1.10` = **`df4cdae8`** (`git describe` = `cli-1.1.8-4-gdf4cdae8e`,
i.e. 4 commits after `cli-1.1.8`), and it is a genuine ancestor of **both** fork HEAD (2542 fork-side
commits) and `cli-1.1.10` (213 upstream-side commits). So codexu's `packages/happy-*` **does** share
git history with `slopus/happy`, and a real `git merge`/`git rebase` of upstream is **topologically
possible** (git would auto-resolve the clean files and surface only the ~96 catalogued hard-conflicts +
apply the `.gitattributes merge=ours` drivers). The selective per-file approach is still a *valid*
option, but it is a **choice**, not a topological necessity.

**Classification anchor: `cli-1.1.8` for the first intake; `cli-1.1.10` going forward.** The **first**
intake (2026-07-07) classified each file against the **release anchor** `cli-1.1.8` (BASE) → `cli-1.1.10`
(THEIRS) → fork HEAD (OURS), because `cli-1.1.8` was the tightest *release* the vendored tree was
imported at (the `df4cdae8` true merge-base is only 4 commits later and the classification is
base-neutral between them). **Now that `cli-1.1.10` has been imported, the next intake's BASE anchor
advances to `cli-1.1.10`** (THEIRS = the next upstream release, OURS = fork HEAD). An exact per-file
tree-match is not achievable — an 8-file sample of upstream-canonical files
(`packages/happy-wire/src/index.ts`, `.../text/translations/pl.ts`, `.../components/StyledText.tsx`,
`packages/happy-cli/src/index.ts`, `.../happy-server/.../v3SessionRoutes.ts`, `docs/README.md`,
`README.md`, `.../theme.ts`) matched **0/8** byte-for-byte against *either* `cli-1.1.8` or `cli-1.1.10`,
confirming the fork has diverged across the board (even "stable" files are fork-touched). The pin is a
**release anchor** used for 3-way classification, distinct from the `df4cdae8` topological merge-base.

**How the anchor was chosen.** The conflict-surface investigation
([`.ralph/investigations/happy-upstream-conflict-surface/`](../.ralph/investigations/happy-upstream-conflict-surface/))
dated the vendored import at ~2026-05-03. `cli-1.1.8` (2026-04-27) is the last upstream release at or
before that date; the upstream release cadence around the import was `cli-1.1.7` (2026-04-20) →
`cli-1.1.8` (2026-04-27) → `cli-1.1.10` (2026-06-23). **There is no `cli-1.1.9` tag** (the
`cli-v1.1.8-evy.*` tags in the mirror are *fork* tags, not upstream). So `cli-1.1.8` is the tightest
defensible upstream anchor for the imported tree.

**Corroborating signal.** The fork's own `packages/happy-cli/package.json` version is
`happy@1.1.8-evy.11` — a fork-suffixed derivative of upstream `1.1.8`, directly consistent with a
`cli-1.1.8` import base (independent of the tree-sampling above).

**SHA-resolution gotcha.** `gh api repos/slopus/happy/releases/tags/cli-1.1.10` returns
`target_commitish: "main"` (the release's *branch*, not its commit). Resolve exact release SHAs via the
mirror clone's tags (`git -C D:/harness-efforts/happy rev-list -n1 <tag>`), **not** the API
`target_commitish`.

**On the next import**, re-run the sampling against the new upstream tag and, if a tighter anchor can be
tree-matched, update this record + the header + the [§9 cadence](#9-ownership--cadence) note.


## 7. `.gitattributes` merge policy

The repo-root [`.gitattributes`](../.gitattributes) carries the fork's import-merge strategies.

| Path pattern | Strategy | Rationale |
|---|---|---|
| `pnpm-lock.yaml` | `merge=ours` | Tracked by **both** upstream and the fork; conflicts on nearly every import. On import (fork = "ours") we keep the fork lockfile and re-run `pnpm install`. High-value rule. |
| `packages/happy-wire/dist/**`, `packages/happy-agent/dist/**` | `merge=ours` (defensive) | Committed build outputs. **Upstream tracks 0 dist files** (it gitignores `dist/`), so these do not actually conflict on an upstream import — the rule is belt-and-suspenders in case upstream ever starts tracking them. |
| `packages/happy-app/sources/text/**` | **NOT `merge=union`** — deliberately omitted | See the i18n dedupe finding below. |
| `**/package.json` (all packages) | **No merge driver** — normal manual 3-way | See the package.json finding below. `union` produces invalid JSON; `merge=ours` would discard wanted upstream dep bumps; **field/dep reordering is counterproductive** (proven by happy-cli US-001). |

### Required one-time setup (`merge=ours` driver)

Git has **no built-in `ours` merge driver**; `.gitattributes merge=ours` is inert until the driver is
defined in repo-local config (which is **not** committed). On the import host, run once:

```bash
git config merge.ours.driver true
```

Without it, the `merge=ours` lines fall back to a normal 3-way merge (git prints a
"merge driver ours not defined" warning). Add this to the import runbook.

### i18n dedupe finding (open question #4 — resolved: `merge=union` is UNSAFE)

The plan floated `packages/happy-app/sources/text/** merge=union` to auto-collapse the recurring
mechanical translation conflicts. **Verified unsafe — not applied.** Evidence:

- The translation files are **typed nested TS object modules** (`sources/text/_default.ts` +
  `sources/text/translations/<code>.ts`), each constrained to `TranslationStructure` and cross-checked
  by a parity test (`sources/text/translations.test.ts`). They are **not** flat key=value resource
  files (`.properties` / `strings.xml`) where `union` is idiomatic.
- **`tsc --strict` rejects duplicate object-literal keys with error `TS1117`** ("An object literal
  cannot have multiple properties with the same name") — empirically confirmed in this worktree. A
  `union` merge that concatenates both sides of a conflicting hunk readily produces duplicate keys,
  which then **fail the type build**.
- The runtime loader (`t(...)` in `sources/text/index.ts`) navigates the object by dot-path with JS
  last-wins semantics, so it *would* tolerate duplicate keys **at runtime** — but the build (`tsc`) and
  the parity test gate first, so runtime tolerance is moot.
- `union` also concatenates hunks blindly, so a conflict spanning a multi-line arrow-function
  translation value can splice two partial fragments into **syntactically invalid** TS.

**Direction (deferred to M2+, tracked as R6).** The correct fix for translation-merge churn is a
**fork-namespace strings file** (fork-added keys live in a separate module the importer never
conflicts on), not a mechanical union merge. Until then, translation conflicts are resolved by the
normal manual three-way merge (see the [§5 happy-app inventory](#5-happy-app-inventory-ha) `HA-7` row).

### package.json churn (no merge driver — resolved: manual 3-way is correct)

The re-scoped gitattributes task evaluated whether `**/package.json` should get a merge driver to
auto-collapse the recurring manifest conflicts. **Verified: no merge driver is appropriate — leave
package.json as a normal manual three-way merge.** Evidence:

- **`merge=union` is unsafe (same class as the i18n case).** package.json is JSON; a union merge blindly
  concatenates both sides of a conflicting hunk, readily producing **duplicate keys** (invalid per the
  JSON object model / rejected by the manifest parser) or **spliced partial fragments** (syntactically
  invalid JSON). The churn is not the flat, append-only shape where `union` is idiomatic.
- **`merge=ours` is too aggressive.** Taking the fork manifest wholesale on import would silently
  **discard upstream dependency bumps we may want** to adopt deliberately (each with its own testing —
  see [HS-15](#5-happy-server-inventory-hs) for the happy-server posture: "accept manual-merge, take dep
  bumps deliberately"). The fork intentionally pins several deps below upstream (e.g. `zod` v3 vs v4,
  `prisma` 6.11 vs 6.19), so a blanket take-ours would hide those decisions.
- **Field/dep *reordering* toward upstream is counterproductive — do NOT do it.** happy-cli **US-001**
  (`430968089`) empirically proved that alphabetically re-sorting deps *manufactures* extra conflicts:
  re-sorting put `happy-server` adjacent to the version-bumped `fastify-type-provider-zod` line, growing
  the conflict from 2→3 hunks / 43→49 lines; the reorder was reverted. The two irreducible conflict
  regions are **fork-required, not reorderable noise** — see the
  [§4 happy-cli manifest finding](#happy-cli-manifest--import-divergence-is-fork-required-only-conflict-irreducible)
  (Trap A — do not re-sort; Trap B — silent version-pin merge).

**Direction.** package.json conflicts are resolved by the normal manual three-way merge at each import:
keep the fork packaging + fork-only deps, and take upstream dependency bumps one at a time with testing.
No `.gitattributes` entry beyond the documentation row above.

### gitignore-alignment note (deferred)

`packages/happy-wire/dist/**` and `packages/happy-agent/dist/**` are **tracked despite** the root
`.gitignore` `dist/` rule (they were force-added so workspace consumers get prebuilt output without a
build step; upstream does not do this). Aligning that inconsistency (untracking + relying on a build
step, or force-tracking explicitly) is a **packaging change** and is out of scope for M0 (docs +
markers + attributes, no behavior change). Flagged here for a later milestone.


## 8. Replant notes

Per-surface prose on *how* to re-apply the RESTORE hunks when their file has moved or been rewritten
upstream. (KEEP hunks that are stable enough to re-anchor by grep alone do not need a note.)

### R1 — auth plane (HS-1, HS-2, HS-3)

On import, upstream's `api.ts` auth region and `socket.ts` middleware will look very different
(multi-tenant bearer verifier; no device-proof). Re-grep the `RESTORE-R1a-done` markers (api.ts auth
wiring, now in `auth/forkAuthPlane.ts`) and the remaining `RESTORE-R1` marker (socket.ts), then re-apply:
keep the no-op `authenticateTunnel`, the mode-selecting `authenticate`, the **entire** public-mode block
(buffer parser + `httpGuard` + `bodyHashGuard`, install order preserved), and the socket public +
loopback branches. **Do not reintroduce per-request `userId` threading.** **M1-R1a (done)** relocated the
`api.ts` auth wiring (HS-1, HS-2) into
`packages/happy-server/sources/app/api/auth/forkAuthPlane.ts` (extending the existing
`auth/loopbackCapability.ts` / `auth/remoteDeviceAuth.ts` overlay), after which the `api.ts` auth region
is a 1-line `installForkAuthPlane(...)` seam call — those rows are now `RESTORE-R1a-done`. **M1-R1b
(done)** did the same for `socket.ts` (HS-3): the loopback + public device-proof branch bodies moved into
`auth/loopbackCapability.ts` (`makeLoopbackSocketVerifier`) + `auth/remoteDeviceAuth.ts`
(`verifyPublicSocketHandshake`), leaving `createSocketAuthMiddleware` a thin dispatcher — that row is now
`RESTORE-R1b-done`. Note: upstream's dormant
`app/api/utils/enableAuthentication.ts` (`auth.verifyToken`) stays **KEEP-DELETED** (HS-8) — the fork's
`AuthModule` has no `verifyToken`, so restoring it would break typecheck. Re-run the five HARD gates (route
inventory, body-hash, device enrollment, socket handshake, bind gate) before and after.

### R2 (server half) — session-message envelope (HS-4)

The `{ t:'encrypted', c }` envelope shape must survive — it is the at-rest / wire format the app and CLI
expect. The server does **no** crypto; the label's honesty depends on the CLI (`HC-1`/`HC-2`/`HC-3`),
which today sends plaintext — so the `t:'encrypted'` label is a **mislabel today**. **Do not "fix" the
label to `{ t:'plain' }` on import** — that breaks the app decoder path and the envelope contract. M1-R2
routed the CLI half behind the fork codec seam `packages/happy-cli/src/api/sessionPayloadCodec.ts`
(`encodeOutgoing` / `decodeIncoming`) and documents the asymmetry **without changing bytes**; actually
re-enabling encryption is a separate behavior-changing milestone (see plan §9 open questions).

### R3 — operator-identity gate (HS-5)

`index.ts` is substantially fork-owned (the whole embedded `createApp` / bootstrap). The gate must run
once at `createApp` entry. Re-apply the loopback host set + `isLoopbackHost` + `assertOperatorIdentityGate`
and its single call site. M1-R3 extracts these into a fork `fork/` module — the smallest, first M1 seam
(it establishes the `fork/` dir pattern the other seams follow).

### Guard-by-absence (HS-6, HS-7)

These rows have **no marker** (the code is gone). On import, a take-upstream 3-way merge will try to
re-add the deleted models/routes as "upstream additions" — **reject those hunks.** The durable guards
are: the prisma schema's shape (no `User`/`Account`), the `api.ts` route-registration allowlist, and
`publicAuthGate.spec.ts` default-deny. If any deleted construct sneaks back, those should fail (or the
importer catches it against these rows). HS-8 (upstream `enableAuthentication.ts` / `auth.verifyToken`)
is the same shape: the fork's `AuthModule` has no `verifyToken`, so the durable guard is that the server
typechecks with `verifyToken` absent — reject any take-upstream hunk that re-adds the helper.

### R2 (cli half) — E2E codec asymmetry (HC-1, HC-2, HC-3)

The fork simplified the single-user loopback path by sending/receiving message content as **plaintext
JSON**, but left the **fetch/cold-start** path calling `decrypt()`. On import, re-grep the three
`RESTORE-R2-done` markers in `apiSession.ts` and keep the plaintext send (`HC-1`) + plaintext live-receive
(`HC-2`); **do not** let take-upstream reinstate `encrypt()`/`decrypt()` on those two paths in isolation.
The fetch path (`HC-3`) is the odd one out — a **latent bug**, not a feature: fetched replay of a
plaintext message fails to decode in `decrypt()` (returns null **or throws** — variant/length dependent,
e.g. `legacy` `bad nonce size`) and is silently dropped by the fetch call site's try/catch. M1-R2 relocated
all three paths behind the fork codec seam `packages/happy-cli/src/api/sessionPayloadCodec.ts`
(`encodeOutgoing` / `decodeIncoming({ source: 'live' | 'fetch' })`) — a **behavior-preserving** move that
reproduces today's exact bytes and preserves the HC-3 silent-drop verbatim (golden round-trip tests in
`api/sessionPayloadCodec.test.ts` pin it), at which point the asymmetry is fixable in one place.
Re-enabling real E2E encryption is a separate behavior-changing milestone (see plan §9). The server half
is `HS-4`.

### R4 — codex / daemon wiring (HC-4, HC-5, HC-6, HC-7)

These four entry points (`runCodex`, `runClaude`, `startDaemon`, `ApiMachineClient`) are heavily
fork-rewritten — hundreds of diverged lines each, not a hunk. The single entry-point marker is a
**breadcrumb**, not a full patch record: on import these files are a **manual three-way merge** regardless
(budget time for it). M1-R4 relocates the fork-specific wiring behind `forkHooks.onCodex()` /
`onClaude()` / `onDaemonRun()` / `onMachine()` so the entry functions shrink toward the upstream shape and
the fork logic lives in one `forkHooks` module. The 117 fork-only files under `codex/`, `daemon/`,
`agentComms/`, and `tunnel/` (see §4) are **not** part of R4 — they are zero-conflict by construction and
need no relocation.

### R8 — happy-app UI seams (HA-8 MarkdownView; stage 1)

**Milestone M2.** R8 relocates the happy-app UI hotspots (`HA-4`, `HA-5`, `HA-6`, `HA-8`, `HA-9`, and the
sidebar trio `HA-10`/`HA-11`/`HA-12`) out of the upstream-canonical components into fork-owned overlays under
[`packages/happy-app/sources/fork/`](../packages/happy-app/sources/fork/README.md), leaving a thin seam call +
a per-file `RESTORE-R8<x>` marker in the canonical file. It is the happy-app analog of the server/CLI R1–R4
seam relocations and of codex's overlay-crate + `// SANDBOX PATCH:` discipline.

Per-file marker letters: `R8a` SessionView (HA-4), `R8b` ChatList (HA-5), `R8c` AgentInput (HA-6),
`R8d` MarkdownView (HA-8), `R8e` MessageView (HA-9). The sidebar trio (HA-10/11/12) uses full-relocation
re-export shims + `.gitattributes merge=ours` (or DISABLE), operator-gated (call #1).

**Buckets R8 uses** (in addition to KEEP-DELETED):

- **KEEP (seam-extract):** relocate the fork body into `sources/fork/<area>/<module>`; the canonical file
  keeps a thin seam call + one `RESTORE-R8<x>` marker. Behavior-identical.
- **DISABLE (revert-to-upstream):** revert the hunk to the upstream `cli-1.1.10` shape, dropping the fork
  tweak. **No marker** (the fork behavior is gone); the row records a **re-apply recipe**.

#### Stage 1 (this ship) — HA-8 `components/markdown/MarkdownView.tsx`

Upstream reference: `cli-1.1.10` (`slopus/happy@71c417e1`). The fork MarkdownView diverged across 10
sub-areas (8a–8j, ~25 hunks). Stage 1 (US-000 scaffold + US-003 KEEP extraction) relocates the KEEP hunks;
the two DISABLE candidates (8i, 8j) are handled as noted. New overlay modules live under
`packages/happy-app/sources/fork/markdown/`.

| hunk | divergence | decision | landing (this stage) |
|---|---|---|---|
| 8a | e-ink option cards | **KEEP** | `sources/fork/markdown/optionCardStyles.ts` + `ForkOptionsBlock.tsx`; canonical renders `<ForkOptionsBlock>`. |
| 8b | contrast-safe code-block / text-weight styling | **KEEP** | `sources/fork/markdown/einkMarkdownStyles.ts` (`einkTextWeightStyles`, `einkCodeSpanStyle`); referenced *inside* the canonical `StyleSheet.create` so the `bold`/`semibold`/`code` keys still resolve for the dynamic span-style lookup. |
| 8c | Claude meta-tags → task-notification pills | **KEEP** | Already fork-only helpers (`processClaudeMetaTags`, `TaskNotificationPill`); canonical keeps the thin pre-process seam call. |
| 8d | session-file autolinking | **KEEP** | `sources/fork/markdown/sessionFileAutolink.ts` (`addSessionFileLinks`); canonical seam call. |
| 8e | internal file-link navigation | **KEEP** | `sources/fork/markdown/useMarkdownLinkNav.ts`; canonical uses `useMarkdownLinkNav(props.sessionId)`. |
| 8f | session-aware image loading (`sessionReadFile`) | **KEEP** | `sources/fork/markdown/SessionAwareImage.tsx` (`SessionImageBlock` + image styles); canonical `RenderImageBlock` delegates. |
| 8g | animated font-scale wrapper (`useChatFontScale`) | **KEEP** | `sources/fork/markdown/AnimatedMarkdownText.tsx`; canonical text render uses it. |
| 8h | code-block text scaling | **KEEP** | `einkCodeSpanStyle` in `einkMarkdownStyles.ts` (part of 8b) + the existing `useChatScaledStyles` seam. |
| 8i | list rendering simplified to inline bullets | **DISABLE (DEFERRED to US-001)** | Not done this stage — see parser-coupling note below. |
| 8j | table link-trust propagation | **KEEP (conditional-resolved)** | Kept because 8d/8e autolink is kept (plan §5.4: "Revert if 8d/8e deferred; else KEEP"). Stays inline in `RenderTableBlock`. |

**Stage-1 net:** **8 KEEP seam-extractions** (8a, 8b, 8c, 8d, 8e, 8f, 8g, 8h) into `sources/fork/markdown/*`
+ **1 KEEP-in-place** (8j) + **1 DISABLE deferred** (8i). `MarkdownView.tsx` returns *toward* upstream shape
(its diff vs upstream is now thin seam calls + one marker block, not large inline style/render bodies);
rendering is behavior-identical. **Actual DISABLE reverts this stage = 0** (8i deferred, 8j kept) — the
plan's "~2 DISABLE" applies to US-001, not US-003.

**8i DISABLE — deferred to US-001, with re-apply recipe.** 8i cannot be reverted in isolation this stage
without breaking typecheck: the fork's `components/markdown/parseMarkdown.ts` emits
`list.items: MarkdownSpan[][]` and `numbered-list.items: {number, spans}[]` (no per-item `depth`), whereas
the upstream `cli-1.1.10` `RenderListBlock`/`RenderNumberedListBlock` read `item.depth`. A byte-for-byte
upstream revert of the list renderers therefore also requires reverting `parseMarkdown.ts` to the upstream
`{depth, spans}` item shape — an out-of-scope, non-behavior-preserving parser change. US-001 (the grouped
DISABLE-reverts story, gated on operator calls #6/#7 per `stories-outline.md`) owns the paired
`parseMarkdown.ts` + list-renderer revert. **Re-apply recipe** (if the fork later wants the inline-bullet
simplification back after US-001): re-inline the simplified list renderers that map `MarkdownSpan[][]`
directly to bulleted `<Text>` rows (dropping `item.depth`), keeping the fork `parseMarkdown.ts` list-item
shape.

#### Stage 2 (this ship) — HA-5 `components/ChatList.tsx`

Upstream reference: `cli-1.1.10` (`slopus/happy@71c417e1`). The fork had **deleted** upstream's tool-call
grouping (`useGroupedMessages`, `ToolGroupView`/`AgentWorkGroupView`, collapse-state) in favor of a flat
e-ink render where every message is its own inverted-`FlatList` row. Stage 2 implements **operator call #2**
(restore grouping as a toggle, default preserves flat) and **operator call #5** (keep the e-ink features as
minimal fork-owned seams).

- **RESTORE (upstream grouping, opt-in):** `sources/hooks/useGroupedMessages.ts` (+`.test.ts`),
  `sources/components/ToolGroupView.tsx`, and `sources/utils/toolDisplay.ts` are restored verbatim from
  upstream (they carry **no** `FORK PATCH` marker — they are upstream-canonical, not fork divergences).
  `ChatList.tsx` regains the upstream grouped render path (`ChatListGrouped` → `ChatListInternal`:
  collapse-state, AppState/latest-user auto-collapse, `ToolGroupView`/`AgentWorkGroupView`/`MessageView`
  `renderItem`). Minimal fork adaptations (noted inline): fork storage-based older-loading
  (`sync.loadOlder`, `useSessionMessages` → `{messages, isLoaded}`), `chatBodyWidth` threaded to
  `MessageView` (a required fork prop). **Not restored** (out of scope for call #2, stays KEEP-DELETED):
  fork-from-message quick-actions; grouped mode has **no** `BoundaryDivider` support (upstream grouping
  never had it — dividers remain a flat-path-only fork feature) and does **no** render-window / prefetch
  reporting.
- **KEEP (e-ink flat body, relocated to seams):** the entire current flat `ChatList` body moves to
  `sources/fork/chat/ForkFlatChatList.tsx`, consuming three new seam modules — `chatListEinkProps.ts`
  (5a FlatList tuning: `windowSize=21`, `removeClippedSubviews=false`, `maxToRenderPerBatch=4`, MVCP),
  `usePinchFontScale.ts` (pinch-zoom font preview), and `usePageTurnScroll.ts` (paginated page-turn
  scroll). Each fork/chat module + the `ChatList.tsx` toggle seam carries a `RESTORE-R8b … (invariant HA-5)`
  marker.
- **Toggle:** `chatToolGrouping: 'flat' | 'grouped'` in `LocalSettingsSchema` (**default `'flat'`**),
  surfaced in Settings → Appearance next to the other chat toggles. `ChatList` reads the setting and
  conditionally renders `<ChatListGrouped>` (grouped) or `<ForkFlatChatList>` (flat) — each a standalone
  component with unconditional hooks, so the wrapper never violates Rules-of-Hooks.

**Stage-2 net:** `ChatList.tsx` returns *toward* upstream shape (it regains the grouped path; the flat body
is relocated behind a seam), while the **default rendering is behavior-identical** (flat) because
`chatToolGrouping` defaults to `'flat'`. New overlay modules live under `packages/happy-app/sources/fork/chat/`.
i18n: the deleted `toolGroup` block (9 keys) is restored to `_default.ts` + all 10 locales (reused from
upstream translations), plus two new `settingsAppearance.chatToolGrouping{Title,Description}` keys.

#### Stage 3 (this ship) — HA-9 `components/MessageView.tsx`

Upstream reference: `cli-1.1.10` (`slopus/happy@71c417e1`). The fork had **deleted** upstream's view-side
slash-command / goal chips (`parseLocalCommandMessage`, `isUserSlashCommandEcho`) and the fork-from-message
long-press (`onForkFromUserMessage`), rendering every user message as a flat e-ink band and moving command
handling to a composer-side pre-send intercept (`usePreSendCommand`/`slashCommandIntercept.ts`). Stage 3
implements **operator call #3 "KEEP BOTH"** (restore the upstream chips + long-press behind a default-off
toggle so both mechanisms can be experimented with) and **operator call #5** (keep the e-ink features as
minimal fork-owned seams).

- **RESTORE (upstream chips + fork-from-message, opt-in):** `sources/components/parseLocalCommandMessage.ts`
  (+`.spec.ts`) is restored **verbatim** from upstream (pure parser, no RN deps — carries **no** `FORK PATCH`
  marker; it is upstream-canonical, not a fork divergence). `MessageView.tsx`'s `UserTextBlock` regains the
  upstream render path: `<local-command-caveat>`/goal-confirmation suppression, the raw-echo hide
  (`isUserSlashCommandEcho`, Claude-flavor-gated), the goal-run chip (goal bubble + "Sent as goal" caption),
  the command-run chip (`/name` + optional args bubble), and the plain long-press bubble. Minimal fork
  adaptation (noted inline): the fork's flattened `UserTextMessage` has no `claudeUuid`/`codexItemId` rewind
  anchors, so `rewindPointId` is `undefined` and `canFork` reduces to Codex-flavor sessions **and** a
  parent-provided `onForkFromUserMessage` — which is **not wired this stage** (deferred to the SessionView
  stage, HA-4), so fork-from-message is inert (no `onLongPress`) by default.
- **KEEP (e-ink features, relocated to seams):** the flat user-message band styles move to
  `sources/fork/message/einkMessageStyles.ts`, the paperclip attachment-chip row to
  `sources/fork/message/MessageAttachmentChips.tsx`, and the nested tool-call depth cap
  (`MAX_NESTED_CHILD_DEPTH` + `countNestedSteps`) to `sources/fork/message/nestedStepsCap.ts`. Each carries a
  `RESTORE-R8e … (invariant HA-9)` marker, and `MessageView.tsx` carries one representative marker at the
  import seam. KEEP-in-place (already thin, not relocated): skillBody suppression (`isSkillBodyMessage`, 9b),
  `chatBodyWidth` threading + `messageContentWidthStyle` (9c), the `context-boundary` → `BoundaryDivider`
  branch (9d), and the `AgentEventText`/`NestedStepsSummary` font-scale wrappers (9g). The `NestedStepsSummary`
  component + `ToolCallBlock` nested-children delegation stay inline (upstream `ToolCallBlock` has no nesting
  at all — the whole feature is fork divergence).
- **Toggle:** `messageCommandChips: boolean` in `LocalSettingsSchema` (**default `false`**), surfaced in
  Settings → Appearance next to "Group Tool Calls". `UserTextBlock` reads it (hook called unconditionally
  before the skillBody guard) and branches: OFF → the fork e-ink band (`einkMessageStyles` +
  `MessageAttachmentChips`); ON → the upstream chip path. The fork's composer-side pre-send intercept is a
  **separate** mechanism and is untouched — the two coexist by design.

**Stage-3 net:** `MessageView.tsx` returns *toward* upstream shape (it regains the chip/long-press render
body; the e-ink body is relocated behind seams), while the **default rendering is behavior-identical** (flat
band) because `messageCommandChips` defaults to `false`. New overlay modules live under
`packages/happy-app/sources/fork/message/`. i18n: one restored `message.sentAsGoal` key + two new
`settingsAppearance.messageCommandChips{Title,Description}` keys added to `_default.ts` + all 10 locales.
**Deviation from plan (operator call #3 overrides plan's 9f KEEP-DELETED):** the plan listed 9f
(goal/command chips + fork-from-message) as KEEP-DELETED; operator call #3 supersedes it with KEEP-BOTH
(restore behind a default-off toggle). **Deferred:** fork-from-message parent wiring (ChatList/SessionView)
is out of scope this stage and lands with HA-4.

#### Stage 4 (this ship) — HA-6 `components/AgentInput.tsx`

Upstream reference: `cli-1.1.10` (`slopus/happy@71c417e1`). AgentInput is the largest happy-app
conflict surface (fork ~1847 lines vs upstream ~1389; **both** the fork and upstream heavily rewrote
it — upstream added +408/−236 between 1.1.8→1.1.10). Stage 4 implements **operator call #4** (restore
upstream's removed mic/voice input), **operator call #6** (keep the fork-introduced keyboard state
machine via a seam), and **operator call #5** (keep the e-ink text-size/chat-width choosers as
minimal fork-owned seams).

- **RESTORE (upstream mic/voice, operator call #4):** the fork had **deleted** upstream's mic/voice
  affordance. It is restored **from upstream** into `AgentInput.tsx`: the `onMicPress?`/`isMicActive?`
  props, the `import { Image } from 'expo-image'`, the `canPressSendButton` mic branch, the
  `handleSendPress` "empty composer + mic → `onMicPress()`" branch, the send-button active-style
  condition, and the send-button **voice icon** (upstream's inline
  `require('@/assets/images/icon-voice-white.png')` relocated behind the fork seam
  `sources/fork/agentInput/voiceIcon.ts` — a lazy `getVoiceMicIcon()` accessor — with
  `tintColor`, `testID="agent-input-voice-mic"` added as the sole fork adaptation for testability). The
  seam exists because esbuild leaves the inline `require()` untransformed, so under the Vitest node
  runner it hits Node's `createRequire` (which cannot resolve the `@/` alias or a `.png`) and
  `vi.mock('@/assets/...png')` — which only intercepts ESM imports — never applies; routing the asset
  through an ESM module boundary lets the render test mock it deterministically. This
  is **UI-only** — the voice runtime/permission plumbing lives in the caller (`SessionView`, HA-4), so
  mic/voice is **inert-but-present** until a parent wires `onMicPress`. No i18n added (upstream had no
  label; the icon carries the affordance). These sites carry lightweight `R8c RESTORE` comments (not
  `FORK PATCH` markers — they are upstream-canonical returns, not fork divergences), covered by the
  representative import-seam marker.
- **KEEP (keyboard state machine, operator call #6):** the fork-introduced
  `AgentInputKeyboardState`/`AgentInputKeyboardAction`/`initialAgentInputKeyboardState`/
  `reduceAgentInputKeyboardState` reducer (textarea ↔ firstOverlayControl focus + picker/autocomplete
  flags; **absent** from cli-1.1.8 and cli-1.1.10) is relocated **verbatim** to
  `sources/fork/agentInput/keyboardStateMachine.ts`. `AgentInput.tsx` re-exports the four symbols so
  `AgentInput.keyboard.test.tsx` (which imports them from `./AgentInput`) keeps passing. This is a
  **pure move** — the transition table is byte-identical; a new `fork/agentInput/keyboardStateMachine.test.ts`
  pins the transitions and `AgentInput.keyboard.test.tsx` asserts the re-export is identity-equal.
- **KEEP (e-ink overlays, operator call #5):** the fork-only in-composer **text-size** picker (discrete
  `CHAT_FONT_SCALE_STEPS` chips) and the tablet-only **chat-width** picker (margin chips) — with their
  dedicated styles (`textSizeOverlay`/`textSizeChipsRow`/`textSizeChip`) — move to
  `sources/fork/agentInput/ComposerLayoutOverlays.tsx` as a stateless presentational component.
  `AgentInput.tsx` renders `<ComposerLayoutOverlays />` at the same JSX position and owns the
  visibility/values/handlers, so the rendered tree + styles are byte-identical. The **shared** overlay
  styles (`overlayBackdrop`/`overlaySection`/`overlaySectionTitle`) stay in `AgentInput.tsx` because the
  settings overlay also uses them; the fork module replicates the ones it needs in its own stylesheet.
  Existing i18n keys (`agentInput.textSize.title`, `agentInput.chatWidth.title`) are reused — no new keys.
- **KEEP-in-place (not relocated this stage):** the fork's **attachment rewrite** already delegates to
  external modules (`@/hooks/useFileAttachment` + `@/components/composer/AttachmentChip`), so it is thin
  and stays inline. The **controlled-composer mode** + `selectAgentInputRenderConfig(mode)` render-config
  selector stay inline (single centralized `mode` decision, guarded by `AgentInput.mode.test.tsx`). The
  **SYNC-R5 send-policy/reducer** plumbing (`submitSend`/`when-idle` switch-mode, block-send guard) is
  deeply interwoven with upstream's own send rewrite and is **KEEP-in-place, marked R5-residual** — it is
  NOT seamed this stage (per operator guidance: don't try to fully seam the send-policy plumbing here; it
  belongs to the SYNC-R5 plane).

**Stage-4 net:** `AgentInput.tsx` returns *toward* upstream shape (mic/voice restored inline; the
fork-introduced keyboard reducer + e-ink overlays relocated behind seams under
`sources/fork/agentInput/*`), while **default rendering is behavior-identical** for existing callers
(no parent wires `onMicPress` yet, so the voice affordance is inert; the keyboard reducer + overlays are
pure moves). One representative `RESTORE-R8c … (invariant HA-6)` marker sits at the import seam in
`AgentInput.tsx`; the three fork modules (`keyboardStateMachine.ts`, `ComposerLayoutOverlays.tsx`,
`voiceIcon.ts`) each carry their own `RESTORE-R8c … (invariant HA-6)` marker.
**Deviation from plan (operator call #4 overrides plan's 6g KEEP-DELETED):** the plan listed mic/voice
(HA-6 row 6g) as KEEP-DELETED; operator call #4 supersedes it with RESTORE-from-upstream. **R5-residual:**
the send-policy/switch-mode reducer is explicitly left in place, not seamed, this stage.

---

#### Stage 5 (this ship) — HA-4 `-session/SessionView.tsx`

Upstream reference: `cli-1.1.10` (`slopus/happy@71c417e1`). SessionView is the fork's session
**container** — it composes the header, chat list, composer, context drawer, and (on desktop/web) the
collapsible files sidebar. Stage 5 reduces its conflict surface by relocating the fork's e-ink / composer
divergences into per-feature fork-owned modules under `sources/fork/session/*`, leaving `SessionView.tsx`
with thin seam calls and one representative `RESTORE-R8a … (invariant HA-4)` marker per seam. **This is a
behavior-preserving refactor** — the rendered tree, composer behavior, and pre-send intercept are
byte-identical; SessionView.tsx moves *toward* upstream shape.

- **KEEP (seams relocated to `sources/fork/session/*`):**
  - **4a — collapsible files sidebar → `useSessionSidebar.tsx`:** the desktop/web two-pane layout, the
    reanimated collapse animation, the `sidebarCollapsed` local-setting toggle, the file-open router push,
    and the Pierre-diff prefetch. SessionView threads `showSidebar`/`sidebarCollapsed`/`toggleSidebar`
    into the header and wraps its main content via `sidebar.wrapWithSidebar(...)`. Pairs with the sidebar
    trio stage (HA-10/11/12).
  - **4b/4c — header surfaces + web avatar-actions → `SessionHeaderSurfaces.tsx`:** the landscape
    status-bar shadow, the `<ChatHeaderView>` block (fork sidebar-toggle + web avatar-menu entrypoint +
    path-surface subtitle), and the web `<SessionActionsPopover>` — including the shared
    `sessionActionsAnchor` state that couples them.
  - **4d/4e — controlled-draft composer + pre-send intercept + attachment pipeline → `useForkComposer.ts`
    (+ pure `forkComposerSend.ts`):** the `message` draft state/refs, the `useDraft` auto-save, the
    `usePreSendCommand` slash-command **pre-send intercept**, the compose-start tracking, and the full
    `onSend` handler (attachment dedupe → upload → send, with optimistic draft-clear + rollback).
    SessionView spreads `{...composer.inputProps}` onto `<AgentInput>`. The `onSend` body lives in the
    RN-free `forkComposerSend.ts` runner so `useForkComposer.test.ts` can exercise the real intercept +
    attachment logic under the Vitest node runner. `getCanSendWhenIdle` moved here and is **re-exported**
    from `SessionView.tsx` for back-compat.
  - **4f — context drawer + archived-resume → `useSessionContextDrawer.tsx`:** the drawer display
    model/permission modes, the machine name, the fork-composer entrypoint (`handleForkPress`), the
    quick-action / resume wiring, the inactive-archived detection, and the `<SessionContextDrawer>` +
    `<InactiveArchivedHint>` nodes.
  - **4g — cross-device boundary advisory → `useBoundaryAdvisory.tsx`:** the `shouldShowBoundaryAdvisory`
    visibility gate (comparing the latest context-boundary against the compose-start timestamp owned by
    `useForkComposer`) + the advisory pill.
  - **4h — chat-width helper:** already a hook (`useChatWidth`) consumed by the in-file `CenteredInputWidth`
    helper; kept as a 1-line seam call with a marker comment (no extraction needed).
- **KEEP-in-place (SYNC-R5 residual — NOT seamed this stage):** **4j** local-Claude idle-send /
  pending-switch controls (`PendingSwitchBanner`, `handleAbortPress`, `requestSwitch`/`cancelPendingSwitch`),
  **4k** active-composer permission/model/effort resolution + `emitActiveAgentConfigurationSelection`
  callbacks, and **4l** session-visibility sync (`onSessionVisible`/`gitStatusSync`,
  `onActiveSessionChanged`). These are deeply interwoven with upstream's send rewrite and belong to the
  SYNC-R5 plane; they carry **plain** `// SYNC-R5 residual` comments (no `FORK PATCH:` token), so the audit
  ignores them (stage-4 precedent).
- **4i DISABLE — deferred:** restoring upstream's overlay file-viewer is a feature restore, out of scope
  for this conflict-reduction stage.

**Out-of-scope / inert (unchanged this stage):** the fork removed upstream's **voice/realtime** subsystem
(`@/realtime/RealtimeSession`, `voiceHooks`, `VoiceAssistantStatusBar`, ElevenLabs); SessionView does **not**
import `@/realtime/*` and leaves the AgentInput mic affordance **inert** (no `onMicPress` wired — a full
voice-runtime restore is a separate follow-up). **fork-from-message** uses the fork's own flow
(`app/(app)/session/[id]/fork-composer.tsx` via `handleForkPress` in the context-drawer seam), so
upstream's `DuplicateSheet` / `onForkFromUserMessage` stays **inert/undefined**.

**Stage-5 net:** `SessionView.tsx` returns *toward* upstream shape (fork e-ink/composer divergences
relocated behind seams under `sources/fork/session/*`) while **rendering + composer behavior are
behavior-identical**. Seam markers: one representative `RESTORE-R8a … (invariant HA-4)` at the import seam
in `SessionView.tsx` (plus per-feature seam markers at each call site and the chat-width helper); the six
fork modules (`useForkComposer.ts`, `forkComposerSend.ts`, `useBoundaryAdvisory.tsx`,
`useSessionContextDrawer.tsx`, `useSessionSidebar.tsx`, `SessionHeaderSurfaces.tsx`) each carry their own
`RESTORE-R8a … (invariant HA-4)` marker. **Deviations from plan:** 4f/4g extracted as `.tsx` (they return
JSX) rather than `.ts` as the plan literally wrote; 4e's attachment pipeline folded into
`useForkComposer.onSend` (+ the pure `forkComposerSend.ts` runner) instead of a separate
`sources/fork/composer/useFileAttachment.ts`; compose-start tracking lives with `useForkComposer` (consumed
by `useBoundaryAdvisory`). The two `sync.sendMessage` / machine-fallback source-audit guards
(`sync/sync.test.ts`, `sync/machineFallbacks.test.ts`) were repointed to the relocated call sites.

---

### R5 — happy-app sync plane (HA-1, HA-2)

**Goal:** *govern* (not eliminate) the fork's residual sync-plane divergence vs upstream so the next
`cli-1.1.x` intake of `sync/sync.ts` (22 conflict hunks) + `sync/storage.ts` (24 conflict hunks) is a
repeatable recipe rather than a from-scratch re-merge. The brainstorm's honest verdict is **no clean
seam / file reduction is achievable** — both files are permanent **manual-three-way clusters** by
convergent evolution (the extractable helpers already live in zero-conflict fork-only `sync/*` modules;
only the call sites conflict). This subsection is the replant anchor for **HA-1**/**HA-1a** (sync.ts) and
**HA-2**/**HA-2a** (storage.ts), plus the deferred **HA-1b** (RESTORE?, unread-tracking). All five rows
link here. Verified against the in-repo `cli-1.1.10` blobs (`git show cli-1.1.10:packages/happy-app/sources/sync/sync.ts`);
BASE = true merge-base `cli-1.1.7-89-gdf4cdae8` (not add/add — both files exist at the same path).

**Cluster triage:**

| cluster | file | disposition | intake action |
|---|---|---|---|
| multi-account graph (friends/users/feed/artifacts) | both | **KEEP-DELETED** | take-ours (mechanical); never re-add upstream's re-introductions — HA-1a / HA-2a |
| render-window pagination (`hasOlder`/`renderWindow`/prefetch) | both | manual-3-way (KEEP) | take-ours the call sites; helpers already in `messageWindow`/`prefetchManager`/`applyPrefetchedRange`/`paginationMath` |
| `sendMessage` (deferred-switch, optimistic placeholder) | sync.ts | manual-3-way (KEEP) | take-ours; re-apply upstream *non-account* bugfixes by hand |
| `fetchMessages` (no-E2E) | sync.ts | manual-3-way (KEEP) | take-ours; decode via `decodeApiMessages`, **NOT** upstream `decryptMessages` |
| `fetchMachines` (loopback/tunnel single-user) | sync.ts | manual-3-way (KEEP) | take-ours; keep the loopback/tunnel fallback (guard `machineFallbacks.test.ts`) |
| socket update-handlers (optimistic-placeholder) | sync.ts | manual-3-way (KEEP) | take-ours; port only upstream's new event *kinds* by hand |
| tree-grouping (`buildSessionRowData`/`buildSessionListViewData`, `TreeSessionRowData`) | storage.ts | manual-3-way (KEEP) | take-ours; guard `storage.tree.spec.ts`, `storage.parent-children.spec.ts` |
| `userChosen` sticky permission mode | storage.ts | manual-3-way (KEEP) | take-ours; guard `storagePermissionModeUserChosen.test.ts` |
| `settingsToSyncPayload` (PUT-based `syncSettings`) | sync.ts | RESTORE? / manual | evaluate upstream's payload shape; the fork drops the feed-event filter — keep dropped (HA-1a) |
| machine-resilience additions | sync.ts | RESTORE? / manual | operator-gated; adopt only with the loopback fallback preserved |
| unread-tracking (`unreadSessionIds`, `markSessionRead`, `webTabTitle`) | both | **RESTORE? — DEFERRED** | fork lacks it; do NOT adopt without a task (entangled with tree-grouping + e-ink repaint churn) — HA-1b |

**Recipe (both files — `start-from-OURS`):**

1. **Start from OURS** (`git checkout --ours` the two files), then cherry-pick upstream's *non-account*
   changes by hand — never `--theirs` wholesale (that resurrects the multi-account plane; see HA-1a/HA-2a).
2. **`sync/sync.ts`:** prune any upstream imports with no fork backing module (`Encryption`, `apiFeed`,
   `apiFriends`). Take-ours `fetchMachines` (loopback/tunnel), `sendMessage` (deferred-switch), and
   `fetchMessages` (decode via `decodeApiMessages`, not `decryptMessages`). Evaluate — do not auto-adopt —
   any upstream `awaitQueue`/race-ordering port.
3. **`sync/storage.ts`:** take-ours the multi-account removals (HA-2a), the tree-grouping functions,
   `userChosen` permission mode, and the render-window pagination fields. If upstream's unread-tracking is
   adopted later (HA-1b), rethread the `unreadSessionIds` param through the tree-grouping functions by hand
   under a default-`false` toggle + an e-ink perf pass.
4. **Verify absence:** grep `applyFriends`, `applyFeedItems`, and `unreadSessionIds` under
   `packages/happy-app/sources/sync` must return **0** hits unless HA-1b was intentionally adopted.
5. **Gate:** `pnpm --filter happy-app typecheck` + `node scripts/audit-happy-fork-patches.mjs` (zero drift)
   + the sync specs listed in the HA-1/HA-2 guard columns.

---

### Rsrv — happy-server conflict-surface reduction (HS-9…HS-16)

**Goal:** localize (not eliminate) the fork's residual happy-server divergence vs upstream so the next
`cli-1.1.x` intake is fully *governed* — every hard-conflict block is either catalogued with a marker or
provably a whole-file take-ours. This subsection is the replant anchor for **HS-9…HS-16**; all eight rows
link here.

- **HS-9 (`app/api/socket.ts` connection data) + HS-10 (`app/events/eventRouter.ts` single-user room model):**
  the socket/eventRouter connection payloads intentionally **omit `userId`** (single-user posture — the fork
  collapses identity to `tofuConfig.localUserId`). US-006 adopted upstream's optional `happyClient?` field
  *additively* so a future 3-way merge resolves the `userId` removal as an ours-only deletion. **Intake rule:
  never reintroduce per-request/per-socket `userId` threading.**
- **HS-11 (`utils/log.ts` + `sources/fork/forkLogger.ts`):** the quiet-logger gate + `shutdownLogger` moved
  into a fork seam so `log.ts` reconciles onto upstream's `pretty()` + `pino.multistream` shape.
- **HS-12 (`routes/pushRoutes.ts`):** KEEP marker only — fork-owned single-user push route.
- **HS-13 (`monitoring/metrics2.ts`):** removed the vestigial `Account` gauge; kept exact `db.count()` (declined
  upstream's PGlite-unsafe `getEstimatedRecordCount`).
- **HS-14 (`index.ts`):** whole-file **take-ours** embedded-server entry (see the HS-14 row).
- **HS-15 (`package.json`):** KEEP mechanical — embedded pkgroll packaging + fork-only deps; dep bumps taken
  deliberately at intake, not auto-merged.
- **HS-16 (`storage/processImage.spec.ts`):** RESTORE — adopted upstream's spec verbatim, eliminating the
  add/add conflict against the already-upstream impl.

**HS-7 extension (route allowlist + CORS):** US-007 relocated the fork's curated route registration into
`sources/fork/registerForkRoutes.ts` and the CORS policy into `sources/fork/forkCors.ts`, shrinking
`app/api/api.ts:configureApi` toward upstream shape. Behavior-preserving: identical routes/CORS on identical
listeners, and `installForkAuthPlane` still runs **before** `registerForkRoutes` so the public-mode
`onRequest` httpGuard fronts every route (default-deny). See the HS-7 row and [§8 Guard-by-absence](#guard-by-absence-hs-6-hs-7).

**Net:** hard-conflict file count 9 → ~8 (`processImage.spec.ts` eliminated) + `index.ts` → take-ours, with
material hunk reduction on `api.ts` (6 → ~2), `log.ts` (4 → ~1), and `socket.ts` (3 → ~1). This is deliberate
M1-style localization — the residual (single-user removals, embedded packaging, fork route architecture) is
genuine, load-bearing fork divergence.

---

## 9. Ownership & cadence

- **Owner**: the operator / whoever drives the next upstream import.
- **Cadence**: re-validate this catalogue on **every upstream import** (each `cli-*` bump). For each
  row: confirm the marker still grep-matches, the guard still passes, and the `file:symbol` anchor
  still exists. Re-tree-match the [§6 baseline](#6-baseline-record) if the import advances it.
- **Per-release intake loop — now a REAL `git merge` (incremental cadence, adopted 2026-07-08).**
  As of the `761518813` lineage anchor ([§6](#6-baseline-record)), cli-1.1.10 is a **merged ancestor**,
  so upstream tracking is a real `git merge` that reconciles **only the new-release delta** — no more
  full-tree selective re-derivation. The loop: (1) `git fetch --no-tags upstream-happy main` +
  `git fetch --no-tags upstream-happy tag <new-cli-tag>`; (2) ensure `git config merge.ours.driver true`
  is set on the host (§7 — the `.gitattributes merge=ours` drivers auto-resolve lockfile/dist/sidebar-trio);
  (3) on a topic branch, `git merge <new-cli-tag>` — git auto-merges everything the fork never diverged
  on and surfaces **only** the catalogued conflict files (the ~dozen convergent sync-core files + the
  KEEP/KEEP-DELETED rows); (4) resolve each conflict per its catalogue row — **take-ours** for
  KEEP/KEEP-DELETED/manual-3-way, **spot-adopt** upstream hunks for any feature you want (this is where
  upstream features are pulled in — see the `happy-app-upstream-feature-opt-ins-*` follow-ups); (5)
  re-run each package's gates + `node scripts/audit-happy-fork-patches.mjs`; (6) commit the merge and
  advance the [§6 baseline](#6-baseline-record) to the imported tag. **The convergent core files
  (`sync.ts`, `storage.ts`, `new/index.tsx`, `MessageQueue2.ts`) conflict on every merge and are
  resolved take-ours by design** — upstream happy's sync plane is seam-less, so they are permanent
  manual-3-way (see the `happy-fork-make-truly-rebasable-on-upstream` brainstorm). Everything else flows
  in cleanly. The **selective per-file 3-way cherry-pick** described previously is now only a fallback
  for a from-scratch re-baseline; normal cadence is the `git merge` above.
- **When adding a row**: prefer the smallest-possible conflict surface first (overlay/seam placement,
  per the RESTORE bucket) before committing a new permanent inline KEEP. Mirror the codex tenant in
  [`codex/docs/implementation/patch-surface.md`](../codex/docs/implementation/patch-surface.md) §14.
- **Audit helper**: [`scripts/audit-happy-fork-patches.mjs`](../scripts/audit-happy-fork-patches.mjs)
  cross-checks the in-code `// FORK PATCH:` markers against this catalogue (advisory) — it flags orphan
  markers, undermarked rows, and unexpected markers on guard-by-absence rows. Run it from the repo root:
  `node scripts/audit-happy-fork-patches.mjs` (exits 0 + prints a report in M0; pass `--strict` to exit
  non-zero on drift for CI). As of **R8 stage 5**, five happy-app rows carry inline markers — `HA-8`
  (MarkdownView, `RESTORE-R8d`), `HA-5` (ChatList, `RESTORE-R8b`), `HA-9` (MessageView, `RESTORE-R8e`),
  `HA-6` (AgentInput, `RESTORE-R8c`), and `HA-4` (SessionView, `RESTORE-R8a`) — each with one marker at
  the canonical import seam plus one per relocated `sources/fork/<area>/*` module, all citing
  `(invariant HA-<n>)` on the marker line so the audit resolves the ID. The remaining `HA-*` rows are
  intentionally marker-free: `HA-1`/`HA-2`/`HA-3` (sync plane) and `HA-7` (i18n) stay doc-only, and the
  sidebar trio `HA-10`/`HA-11`/`HA-12` remain marker-free until their R8 stage lands. The `HS-*`/`HC-*`
  marker set is unchanged (M1 relocations R1a/R3/R4 keep the row↔marker correspondence). Re-run the audit
  after each import to confirm zero drift.
