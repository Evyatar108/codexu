# Happy Patch Surface vs Upstream (slopus/happy)

**Last Updated**: 2026-06-30
**Import baseline (inferred)**: `cli-1.1.8` @ `b72fd8111a43395e9991cfbdabba36f5a3285e5e` (upstream `slopus/happy`, 2026-04-27) — see [§6 Baseline record](#6-baseline-record).
**Latest upstream release (forward target)**: `cli-1.1.10` @ `71c417e1092e73cf34eb24f9601d569394c1f359` (2026-06-23).

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
| HS-7 | `app/api/api.ts:140-154` — route-registration allowlist | KEEP-DELETED | Fork ships a **curated** single-user route surface. Upstream route files the fork removed MUST stay removed: `accessKeysRoutes`, `artifactsRoutes`, `attachmentRoutes`, `authRoutes`, `connectRoutes`, `feedRoutes`, `kvRoutes`, `userRoutes`, `voiceRoutes`, and multi-machine `machinesRoutes` (replaced by `machineSelfRoutes`). Take-upstream re-adds + re-registers them. | ❌ | `publicAuthGate.spec.ts` (default-deny denies any non-allowlisted path); the `api.ts` registration block **is** the allowlist | [§8 guard-by-absence](#guard-by-absence-hs-6-hs-7) |
| HS-8 | `app/api/utils/enableAuthentication.ts` — upstream `enableAuthentication` (decorates `authenticate` via `auth.verifyToken`) | KEEP-DELETED | Upstream's auth-enable helper decorates `authenticate` by calling `auth.verifyToken(token)` (multi-tenant bearer verification). The fork's `AuthModule` (`app/auth/auth.ts`) collapsed multi-tenant token verification and has **no** `verifyToken` (only `verifyGithubToken`/`createToken`/…). Evaluated for RESTORE (present-but-dormant) during M1-R1a — it registers no active global hook, only a per-request decorator — but restoring it **unmodified** fails `pnpm --filter happy-server typecheck` (`TS2339` `verifyToken`; tsconfig compiles all `sources/**/*`), and restoring it **modified** would defeat the anti-conflict purpose (still a rewrite conflict). So it stays deleted; the fork's auth plane routes through `auth/forkAuthPlane.ts` instead. Take-upstream re-adds it + reintroduces per-request user auth. | ❌ (nothing to mark) | server compiles with **no** `verifyToken` and no per-request `userId` threading; `forkAuthPlane.spec.ts` + `publicAuthGate.spec.ts` pin the fork auth plane's accept/reject | [§8 guard-by-absence](#guard-by-absence-hs-6-hs-7) |
| HS-11 | `fork/forkLogger.ts` — `isQuietLogger` / `buildForkLoggerStreams` / `applyForkLoggerOptions` / `createShutdownLogger` (composed in `utils/log.ts`) | KEEP | Embedded-daemon **quiet-logger** gate + the fork-only `shutdownLogger` export. When happy-cli embeds happy-server it sets `HAPPY_SERVER_QUIET_LOGGER=true` (see `index.ts`), which drops the pretty stdout stream **and** disables the root logger so the embedded daemon is silent; `shutdownLogger` flushes + ends the logger(s) on daemon shutdown. Upstream has **neither**. Relocated to a fork seam and reconciled onto upstream's Bun-safe `pretty()`+`pino.multistream` shape — behavior-preserving (non-quiet == upstream exactly; quiet drops pretty + disables the root logger; the optional file-only logger keeps the upstream shape). Take-upstream drops quiet mode + `shutdownLogger`. | ✅ inline (fork-seam header + call-sites) | `pnpm --filter happy-server typecheck` (no log spec); `index.spec.ts` boots the embedded server under quiet mode | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |
| HS-13 | `app/monitoring/metrics2.ts` — `updateDatabaseMetrics` DB-count gauges | KEEP-DELETED | HS-6-driven: the multi-tenant `Account` model is removed (single-user), so the updater counts **only** the 3 fork-schema tables (`session`, `sessionMessage`, `machine`) and emits **no** `accounts` gauge. Exact `db.*.count()` is kept (single-user tables are tiny); upstream's `getEstimatedRecordCount` (`pg_class`/`reltuples` catalog estimate) is **declined** — it references the removed `"Account"` table and targets Postgres, not the fork's embedded PGlite. Take-upstream resurrects the `Account` count. | ❌ (guard by absence) | server compiles with **no** `db.account` reference and no `accounts` gauge label; `updateDatabaseMetrics` sets exactly the 3 fork-schema gauges | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |
| HS-16 | `storage/processImage.spec.ts` — image-resize test | RESTORE | Fork's stale spec (20×10 fixture, `thumbhash.length`) diverged from upstream's (200×100, asserts `pixels` length) while `storage/processImage.ts` is **byte-identical to upstream `cli-1.1.10`** (0 diff-hunks; returns `pixels: data`). Adopting upstream's spec **verbatim** passes against the fork's already-upstream impl and **eliminates the hard-conflict** — this is a test-only RESTORE, not a behavior change. | ❌ (adopted upstream verbatim; no fork delta to mark) | `processImage.spec.ts` (upstream assertions: format/width/height/thumbhash/`pixels` length) | [§8 Rsrv](#rsrv--happy-server-conflict-surface-reduction-hs-9hs-16) |

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
> RESTORE-R8 targets for later stages; `HA-9`–`HA-12` are added below as planned inventory. `HA-1`/`HA-2`/`HA-3`
> (sync) and `HA-7` (i18n) remain doc-only for now.

| # | file:symbol | bucket | invariant — why it conflicts / must survive | marker? | test / guard | replant note |
|---|---|---|---|---|---|---|
| HA-1 | `sync/sync.ts` — top-level sync orchestrator | KEEP | Fork's single-user / embedded-server / loopback sync loop diverges broadly from upstream's multi-account sync. Conflicts on nearly every import; a **manual three-way merge** each time. | ❌ (doc-only in M0) | `pnpm typecheck`; `sync/*.spec.ts` (`messageWindow`, `applyPrefetchedRange`) | deferred M2+ (sync plane, ~R5) |
| HA-2 | `sync/storage.ts` — client session/message store | KEEP | Fork's storage shape tracks the collapsed single-user session model (no account graph). Large fork-owned surface. | ❌ (doc-only in M0) | `pnpm typecheck`; `sync/encryptionDeletion.spec.ts` | deferred M2+ (sync plane, ~R5) |
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

---

## 6. Baseline record

| Field | Value |
|---|---|
| **Import baseline (inferred)** | `cli-1.1.8` → `b72fd8111a43395e9991cfbdabba36f5a3285e5e` (upstream `slopus/happy`, 2026-04-27) |
| **Latest upstream release / forward import target** | `cli-1.1.10` → `71c417e1092e73cf34eb24f9601d569394c1f359` (2026-06-23) |
| **Upstream mirror clone (read-only reference)** | `D:/harness-efforts/happy` — remotes: `origin` = `slopus/happy`, `fork` = `Evyatar108/happy` |
| **In-repo upstream remote (permanent — PRIMARY reference)** | codexu remote **`upstream-happy`** = `slopus/happy`; fetched refs `upstream-happy/main` (`d2ef88de`) + tag `cli-1.1.10` (`71c417e1`). 3-way diffs + intake run **directly in codexu** — `git show cli-1.1.10:<path>`, `git merge-file` — no external mirror dependency. Refresh per upstream release: `git fetch --no-tags upstream-happy main` + `git fetch --no-tags upstream-happy tag <new-tag>`. |

**Why the baseline is *inferred*, not an exact merge-base.** codexu vendors happy as a
**history-detached copy**: there is no shared commit history with `slopus/happy`, so no `git merge-base`
exists. An exact per-file tree-match is also not achievable — an 8-file sample of upstream-canonical
files (`packages/happy-wire/src/index.ts`, `.../text/translations/pl.ts`,
`.../components/StyledText.tsx`, `packages/happy-cli/src/index.ts`,
`.../happy-server/.../v3SessionRoutes.ts`, `docs/README.md`, `README.md`, `.../theme.ts`) matched
**0/8** byte-for-byte against *either* `cli-1.1.8` or `cli-1.1.10`, confirming the fork has diverged
across the board (even "stable" files are fork-touched). The pin is therefore a **temporal/release
anchor**, not a merge-base.

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

## 9. Ownership & cadence

- **Owner**: the operator / whoever drives the next upstream import.
- **Cadence**: re-validate this catalogue on **every upstream import** (each `cli-*` bump). For each
  row: confirm the marker still grep-matches, the guard still passes, and the `file:symbol` anchor
  still exists. Re-tree-match the [§6 baseline](#6-baseline-record) if the import advances it.
- **Per-release intake loop** (concrete): (1) `git fetch --no-tags upstream-happy main` + `git fetch --no-tags upstream-happy tag <new-cli-tag>` (the permanent in-repo `upstream-happy` remote — [§6](#6-baseline-record)); (2) diff the new tag vs the current baseline per package to refresh the conflict heatmap (`git diff <baseline>..<new-tag> -- packages/happy-*` / per-file `git merge-file`); (3) run any pending **reduction** passes (keep/disable triage + overlay seams) for the hottest files first — see the `happy-{cli,server}-conflict-reduction-*` + `happy-app-r5-*` tasks; (4) ensure `git config merge.ours.driver true` is set on the host (§7); (5) selective per-file 3-way **intake** server→cli→app, carrying fork-only trees (`codex/`, `agentComms/`, `tunnel/`, `daemon/`, `sources/fork/`) forward untouched and applying each row's KEEP / KEEP-DELETED / RESTORE / `merge=ours` rule; (6) re-run each package's gates + `node scripts/audit-happy-fork-patches.mjs`; (7) advance the [§6 baseline](#6-baseline-record) to the imported tag.
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
