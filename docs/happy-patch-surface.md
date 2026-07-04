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

---

## 3. happy-server invariants (`HS-*`)

Paths relative to `packages/happy-server/sources/` unless noted. The fork's server is a **single-user,
self-hosted** server with an opt-in **public mode** (default-off) — the multi-tenant SaaS shape from
upstream is deliberately collapsed. See [`packages/happy-server/AGENTS.md`](../packages/happy-server/AGENTS.md).

| # | file:symbol (line hint) | bucket | invariant — why it must survive | marker? | test / guard | replant note |
|---|---|---|---|---|---|---|
| HS-1 | `app/api/auth/forkAuthPlane.ts` — `installForkAuthPlane` → `authenticateTunnel` / `authenticate` decorators (called from `app/api/api.ts`) | RESTORE-R1a-done | No-op tunnel authenticator + mode-selecting `authenticate` implement the fork's **single-user** auth plane; upstream ships a multi-tenant bearer verifier. Take-upstream reinstates per-request user auth. Relocated to fork-owned `auth/forkAuthPlane.ts` seam (M1-R1a), behavior-preserving (no per-request `userId`). | ✅ inline (fork-seam header + call-site) | `publicAuthGate.spec.ts`, `socket.spec.ts`, `forkAuthPlane.spec.ts` | [§8 R1](#r1--auth-plane-hs-1-hs-2-hs-3) |
| HS-2 | `app/api/auth/forkAuthPlane.ts` — `installForkAuthPlane` → public-mode block (called from `app/api/api.ts`) | RESTORE-R1a-done | Shipped public-server **fail-closed** boundary: buffer body parser (captures `rawBody` for the bodyHash), `onRequest` `httpGuard`, `preValidation` `bodyHashGuard`. Losing it fails **open** on public internet exposure. Relocated to fork-owned `auth/forkAuthPlane.ts` seam (M1-R1a), **hook install order preserved** (httpGuard before route registration), behavior-preserving. | ✅ inline (fork-seam header + call-site) | `publicAuthGate.spec.ts` (default-deny + body-hash), `deviceEnrollment.spec.ts`, `forkAuthPlane.spec.ts` | [§8 R1](#r1--auth-plane-hs-1-hs-2-hs-3) |
| HS-3 | `app/api/socket.ts:80` — `createSocketAuthMiddleware` → public / loopback branches | RESTORE-R1 | Fork's fail-closed **device-proof** Socket.IO handshake (public) + loopback-capability check. Upstream's middleware has neither; take-upstream fails open on the socket plane. | ✅ inline | `socket.spec.ts`, `remoteDeviceAuth.spec.ts` | [§8 R1](#r1--auth-plane-hs-1-hs-2-hs-3) |
| HS-4 | `app/api/routes/v3SessionRoutes.ts:166` — session-message `content` envelope | RESTORE-R2-done | Server persists `{ t:'encrypted', c }` but performs **no crypto**; the label is a **mislabel today** because the CLI sends plaintext (see `HC-1` / the fork codec seam `packages/happy-cli/src/api/sessionPayloadCodec.ts` `encodeOutgoing`). R2 server half; comment-only honesty caveat, no logic change. | ✅ inline | `v3SessionRoutes.test.ts` | [§8 R2](#r2-server-half--session-message-envelope-hs-4) |
| HS-5 | `fork/operatorIdentityGate.ts` — `LOOPBACK_HOSTS` / `isLoopbackHost` / `assertOperatorIdentityGate` (re-exported from `index.ts`) | RESTORE-R3-done | Bind-host **operator-identity gate**: refuses a non-loopback bind unless public-mode with a fail-closed device verifier **and** a Cloudflare Access edge expectation. The single-user server's core safety rail. Relocated to fork-owned `fork/` seam (M1-R3), behavior-preserving. | ✅ inline (fork-seam header + call-site) | `publicAuthGate.spec.ts`, unit assertions on `assertOperatorIdentityGate` | [§8 R3](#r3--operator-identity-gate-hs-5) |
| HS-6 | `prisma/schema.prisma` — multi-tenant identity models | KEEP-DELETED | Fork collapsed the multi-tenant identity graph: `model Account`, `AccountAuthRequest`, `AccountPushToken`, `UserRelationship`, `GithubUser` and every `accountId`/`userId` FK on `Session`/`Machine` are **removed** (single-user, one-process). Take-upstream resurrects multi-tenancy. | ❌ (nothing to mark) | schema carries no `User`/`Account` model; server compiles with **no** per-request `userId` threading (happy-server AGENTS.md hard rule) | [§8 guard-by-absence](#guard-by-absence-hs-6-hs-7) |
| HS-7 | `app/api/api.ts:140-154` — route-registration allowlist | KEEP-DELETED | Fork ships a **curated** single-user route surface. Upstream route files the fork removed MUST stay removed: `accessKeysRoutes`, `artifactsRoutes`, `attachmentRoutes`, `authRoutes`, `connectRoutes`, `feedRoutes`, `kvRoutes`, `userRoutes`, `voiceRoutes`, and multi-machine `machinesRoutes` (replaced by `machineSelfRoutes`). Take-upstream re-adds + re-registers them. | ❌ | `publicAuthGate.spec.ts` (default-deny denies any non-allowlisted path); the `api.ts` registration block **is** the allowlist | [§8 guard-by-absence](#guard-by-absence-hs-6-hs-7) |
| HS-8 | `app/api/utils/enableAuthentication.ts` — upstream `enableAuthentication` (decorates `authenticate` via `auth.verifyToken`) | KEEP-DELETED | Upstream's auth-enable helper decorates `authenticate` by calling `auth.verifyToken(token)` (multi-tenant bearer verification). The fork's `AuthModule` (`app/auth/auth.ts`) collapsed multi-tenant token verification and has **no** `verifyToken` (only `verifyGithubToken`/`createToken`/…). Evaluated for RESTORE (present-but-dormant) during M1-R1a — it registers no active global hook, only a per-request decorator — but restoring it **unmodified** fails `pnpm --filter happy-server typecheck` (`TS2339` `verifyToken`; tsconfig compiles all `sources/**/*`), and restoring it **modified** would defeat the anti-conflict purpose (still a rewrite conflict). So it stays deleted; the fork's auth plane routes through `auth/forkAuthPlane.ts` instead. Take-upstream re-adds it + reintroduces per-request user auth. | ❌ (nothing to mark) | server compiles with **no** `verifyToken` and no per-request `userId` threading; `forkAuthPlane.spec.ts` + `publicAuthGate.spec.ts` pin the fork auth plane's accept/reject | [§8 guard-by-absence](#guard-by-absence-hs-6-hs-7) |

## 4. happy-cli invariants (`HC-*`)

Paths relative to `packages/happy-cli/src/` unless noted. See [`packages/happy-cli/AGENTS.md`](../packages/happy-cli/AGENTS.md).

| # | file:symbol (line hint) | bucket | invariant — why it must survive | marker? | test / guard | replant note |
|---|---|---|---|---|---|---|
| HC-1 | `api/apiSession.ts:659` — `enqueueMessageWithDelivery` send path (via `api/sessionPayloadCodec.ts` `encodeOutgoing`) | RESTORE-R2-done | Fork serializes message content as **plaintext JSON** (`encodeOutgoing = JSON.stringify(content)` — the local `encrypted` name is a misnomer); no E2E encryption on send. Now routed through the fork codec seam `sessionPayloadCodec.ts` (behavior-preserving relocation, bytes unchanged). Take-upstream reinstates `encrypt()`. Pairs with the server's honest-only-if-encrypted `{t:'encrypted'}` label (`HS-4`). | ✅ inline | `api/sessionPayloadCodec.test.ts`, `api/apiSession.test.ts` | [§8 R2-cli](#r2-cli-half--e2e-codec-asymmetry-hc-1-hc-2-hc-3) |
| HC-2 | `api/apiSession.ts:316` — live-receive socket update (via `api/sessionPayloadCodec.ts` `decodeIncoming({source:'live'})`) | RESTORE-R2-done | Live-receive path treats `c` as **plaintext** (`decodeIncoming({source:'live'}) = JSON.parse(...content.c)`, no `decrypt()`), mirroring the plaintext send path. Now routed through the fork codec seam `sessionPayloadCodec.ts` (behavior-preserving relocation, bytes unchanged). Take-upstream reinstates decrypt-on-receive. | ✅ inline | `api/sessionPayloadCodec.test.ts`, `api/apiSession.test.ts` | [§8 R2-cli](#r2-cli-half--e2e-codec-asymmetry-hc-1-hc-2-hc-3) |
| HC-3 | `api/apiSession.ts:575` — fetch / cold-start replay path (via `api/sessionPayloadCodec.ts` `decodeIncoming({source:'fetch'})`) | RESTORE-R2-done | The fetch path **still calls `decrypt()`** (`decodeIncoming({source:'fetch'})`) while send + live-receive are plaintext — a **latent asymmetry**: fetched replay of plaintext messages fails to decode (`decrypt()` returns null **or throws** — e.g. `legacy` `bad nonce size` — variant/length dependent) and is dropped by the fetch call site's try/catch (logged "Failed to decrypt fetched message"). The R2 codec seam `sessionPayloadCodec.ts` unifies all three paths **without fixing this** — a real fix is a format change, out of M1 (do not "fix" one path in isolation). | ✅ inline | `api/sessionPayloadCodec.test.ts`, `api/apiSession.test.ts`, `api/apiSession.consumptionAckTimeout.test.ts` | [§8 R2-cli](#r2-cli-half--e2e-codec-asymmetry-hc-1-hc-2-hc-3) |
| HC-4 | `codex/runCodex.ts:78` — `runCodex` entry | RESTORE-R4 | Fork's codex agent-loop wiring is heavily rewritten vs upstream (embedded app-server, agent-tree, MCP notification routing, sandbox). One **entry-point** marker flags the seam; the body is ~entirely fork-owned. | ✅ inline (entry only) | `codex/runCodex.fork.test.ts`, `codex/runCodex.turnLifecycle.test.ts` | [§8 R4](#r4--codex--daemon-wiring-hc-4-hc-5-hc-6-hc-7) |
| HC-5 | `claude/runClaude.ts:60` — `runClaude` entry | RESTORE-R4 | Fork's claude agent-loop wiring diverges from upstream (hook server, permission handling, session protocol mapping). Entry-point marker only. | ✅ inline (entry only) | `claude/runClaude.test.ts` | [§8 R4](#r4--codex--daemon-wiring-hc-4-hc-5-hc-6-hc-7) |
| HC-6 | `fork/forkHooks.ts::onDaemonRun` (relocated from `daemon/run.ts`) | RESTORE-R4-done | Fork daemon **embeds the happy-server** and allocates loopback/tunnel/ingest ports (upstream daemon is a thin remote client). **Relocated behind `forkHooks.onDaemonRun()` (M1-S5 / R4a)** — `startDaemon` now calls one hook instead of carrying the inline block; the `daemon/` overlay bodies are unchanged. | ✅ `forkHooks.ts` header + `run.ts` call site | `fork/forkHooks.test.ts`, `daemon/daemon.integration.test.ts`, `daemon/run.spawnFromSession.test.ts` | [§8 R4](#r4--codex--daemon-wiring-hc-4-hc-5-hc-6-hc-7) |
| HC-7 | `api/apiMachine.ts:111` — `ApiMachineClient` class | RESTORE-R4 | Fork's machine client (embedded-server spawn + daemon RPC handlers) diverges from upstream's multi-machine model. Entry-point marker only. | ✅ inline (entry only) | `api/apiMachine.keepalive.test.ts`, `api/forkSession.rpc.test.ts` | [§8 R4](#r4--codex--daemon-wiring-hc-4-hc-5-hc-6-hc-7) |

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

| # | file:symbol | bucket | invariant — why it conflicts / must survive | marker? | test / guard | replant note |
|---|---|---|---|---|---|---|
| HA-1 | `sync/sync.ts` — top-level sync orchestrator | KEEP | Fork's single-user / embedded-server / loopback sync loop diverges broadly from upstream's multi-account sync. Conflicts on nearly every import; a **manual three-way merge** each time. | ❌ (doc-only in M0) | `pnpm typecheck`; `sync/*.spec.ts` (`messageWindow`, `applyPrefetchedRange`) | deferred M2+ (sync plane, ~R5) |
| HA-2 | `sync/storage.ts` — client session/message store | KEEP | Fork's storage shape tracks the collapsed single-user session model (no account graph). Large fork-owned surface. | ❌ (doc-only in M0) | `pnpm typecheck`; `sync/encryptionDeletion.spec.ts` | deferred M2+ (sync plane, ~R5) |
| HA-3 | `sync/reducer/reducer.ts` — message→event reducer | KEEP | Fork reducer carries the typed context-boundary handling and e-ink-friendly accumulation. Conflicts with upstream reducer changes. | ❌ (doc-only in M0) | `sync/reducer/reducer.spec.ts`, `messageToEvent.spec.ts` | deferred M2+ (sync plane, ~R5) |
| HA-4 | `-session/SessionView.tsx` — session screen | KEEP | Fork's chat surface is tuned for the **e-ink tablet** (static UI, no smooth-scroll/continuous repaint). Broadly rewritten vs upstream. | ❌ (doc-only in M0) | `pnpm typecheck`; visual/e-ink review | deferred M2+ (UI plane, ~R8) |
| HA-5 | `components/ChatList.tsx` — message list | KEEP | Fork's inverted-FlatList perf work + `BoundaryDivider` rendering (shipped upstream as PR #1154, but fork carries adjacent e-ink tuning). | ❌ (doc-only in M0) | `components/ChatList.preBoundaryHistory.test.tsx` | deferred M2+ (UI plane, ~R8) |
| HA-6 | `components/AgentInput.tsx` — composer | KEEP | Fork input diverges on modes/attachments/keyboard for the e-ink target. High-churn conflict surface. | ❌ (doc-only in M0) | `components/AgentInput.{mode,attachments,keyboard,activeRegression}.test.tsx` | deferred M2+ (UI plane, ~R8) |
| HA-7 | `text/_default.ts` + `text/translations/*.ts` — i18n | KEEP | Fork-added translation keys must survive import. **`merge=union` is UNSAFE here** (typed nested TS object modules; duplicate keys error `TS1117` and arrow-value splits break syntax — see §7). Merge is manual or via a future fork-namespaced strings file. | ❌ (doc-only in M0) | `text/translations.test.ts` (structural parity) | deferred M2+ (i18n plane, ~R6) |

---

## 6. Baseline record

| Field | Value |
|---|---|
| **Import baseline (inferred)** | `cli-1.1.8` → `b72fd8111a43395e9991cfbdabba36f5a3285e5e` (upstream `slopus/happy`, 2026-04-27) |
| **Latest upstream release / forward import target** | `cli-1.1.10` → `71c417e1092e73cf34eb24f9601d569394c1f359` (2026-06-23) |
| **Upstream mirror clone (read-only reference)** | `D:/harness-efforts/happy` — remotes: `origin` = `slopus/happy`, `fork` = `Evyatar108/happy` |

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
(pending)** does the same for `socket.ts` (HS-3), still `RESTORE-R1`. Note: upstream's dormant
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

---

## 9. Ownership & cadence

- **Owner**: the operator / whoever drives the next upstream import.
- **Cadence**: re-validate this catalogue on **every upstream import** (each `cli-*` bump). For each
  row: confirm the marker still grep-matches, the guard still passes, and the `file:symbol` anchor
  still exists. Re-tree-match the [§6 baseline](#6-baseline-record) if the import advances it.
- **When adding a row**: prefer the smallest-possible conflict surface first (overlay/seam placement,
  per the RESTORE bucket) before committing a new permanent inline KEEP. Mirror the codex tenant in
  [`codex/docs/implementation/patch-surface.md`](../codex/docs/implementation/patch-surface.md) §14.
- **Audit helper**: [`scripts/audit-happy-fork-patches.mjs`](../scripts/audit-happy-fork-patches.mjs)
  cross-checks the in-code `// FORK PATCH:` markers against this catalogue (advisory) — it flags orphan
  markers, undermarked rows, and unexpected markers on guard-by-absence rows. Run it from the repo root:
  `node scripts/audit-happy-fork-patches.mjs` (exits 0 + prints a report in M0; pass `--strict` to exit
  non-zero on drift for CI). As of M0 it reports **zero drift**: 12 markers in code (5 `HS-*`, 7 `HC-*`)
  match the 12 inline-marker rows; the 7 `HA-*` rows and `HS-6`/`HS-7`/`HS-8` are intentionally
  marker-free. (M1 relocations R1a/R3 move some `HS-*` markers behind fork seams but keep the row↔marker
  correspondence; re-run the audit to confirm zero drift after each.)
