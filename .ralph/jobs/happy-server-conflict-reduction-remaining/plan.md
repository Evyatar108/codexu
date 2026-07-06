# Remaining happy-server upstream conflict-surface reduction (KEEP / DISABLE / RESTORE / KEEP-DELETED triage + fork-overlay seams)

**Task:** `happy-server-conflict-reduction-remaining`
**Worktree:** `D:/harness-efforts/codexu/.worktrees/plan-server-reduce`, branch `ralph/plan-server-reduce` (off `main` @ `2a670e71`).
**Upstream target:** `cli-1.1.10` @ `71c417e1` (mirror `D:/harness-efforts/happy`). **Import anchor (BASE):** `cli-1.1.8` @ `b72fd811`.
**Scope:** happy-server only (`packages/happy-server/`). Markdown deliverable + behavior-preserving code seams. Read-only research verified against source.

---

## 1. Goal

happy-server is the **smallest** of the fork's per-package conflict surfaces vs `cli-1.1.10`: **9 hard-conflict files** (app 59 / cli 33 / **server 9** / agent 2 / wire 0 — `.ralph/investigations/happy-upstream-rebase-assessment-v2/findings.md` §2.2). M1 already relocated the **auth plane** into fork-owned modules (`sources/app/api/auth/forkAuthPlane.ts`, `remoteDeviceAuth.ts`, `loopbackCapability.ts`, `edgeAssertion.ts`, `sources/fork/operatorIdentityGate.ts`), so HS-1/HS-2/HS-3/HS-5 now register only a **thin seam call-site** conflict, and HS-4 (`v3SessionRoutes.ts`) **auto-merges clean** today.

This plan closes out the **remaining 9** by giving every one an explicit disposition — **KEEP** (fork logic → fork-owned module + `// FORK PATCH:` marker + thin seam), **DISABLE** (revert to upstream), **RESTORE-toward-upstream** (adopt upstream, conflict eliminated), or **KEEP-DELETED** (upstream code the fork deliberately removed; guard by absence) — and, where the M1 playbook applies, converts the biggest inline hunks (`api.ts` route-registration + CORS, `log.ts` quiet-logger) into thin fork-overlay seams.

**Honest framing (mirrors the M1 finding):** the surface is only 9 files and several are **load-bearing single-user structural removals** (`userId`/`Account` collapse — happy-server `AGENTS.md` hard rule) that **cannot be seamed away**. So the win is mostly **effort + regression-risk localization + full catalogue coverage**, not a large file-count drop. Concretely (see §6): **1 file cleanly eliminated** (`processImage.spec.ts`), **1 converted to take-ours** (`index.ts`), **3 materially shrunk** (`api.ts` 6→~2, `log.ts` 4→~1, `socket.ts` 3→~1), and **all 9 catalogued** (HS-9…HS-16) so the next intake is 100 % governed (vs ~55 % today).

### Reproduced conflict enumeration (true 3-way, LF-normalized)

`git merge-file -p --diff3 <ours> <cli-1.1.8 blob> <cli-1.1.10 blob>`; exit>0 = hard-conflict; hunk = `<<<<<<<` region count. **CRLF→LF normalization is mandatory** — without it the Windows worktree's CRLF makes every line differ and every file collapses to one whole-file conflict (this trap produced a spurious "20 files" before normalization).

| # | file (`packages/happy-server/…`) | hunks | fork↔up diff-hunks | catalogue today | M1-seamed? |
|---|---|---:|---:|---|---|
| 1 | `sources/app/api/api.ts` | **6** | 22 | HS-1, HS-2, HS-7 | partly (auth plane relocated; route-reg + CORS + `configureApi` still inline) |
| 2 | `package.json` | **5** | 23 | — | no (mechanical) |
| 3 | `sources/utils/log.ts` | **4** | 10 | — | no |
| 4 | `sources/app/api/socket.ts` | **3** | 27 | HS-3 (auth part auto-merges) | partly (auth seamed; residual = `userId` removal) |
| 5 | `sources/app/events/eventRouter.ts` | **2** | 35 | — | no |
| 6 | `sources/app/api/routes/pushRoutes.ts` | **1** | 20 | — | no |
| 7 | `sources/app/monitoring/metrics2.ts` | **1** | 3 | — (HS-6-driven) | no |
| 8 | `sources/index.ts` | **1** (add/add) | 5 | HS-5 (gate seamed) | partly (whole file fork-owned) |
| 9 | `sources/storage/processImage.spec.ts` | **1** | 4 | — | no |
| | **TOTAL** | **24** | | | |

> `sources/app/api/routes/v3SessionRoutes.ts` (HS-4) and `sources/app/monitoring/metrics.ts` **auto-merge clean** now and are NOT in the surface — do not touch them.

---

## 2. HARD CONSTRAINT — behavior-preserving + fail-closed public server

Every story is **behavior-preserving**: production request/socket behavior, the shipped **public-mode fail-closed** guarantees (global default-deny `onRequest` hook, Ed25519 device-proof, body-hash binding, Cloudflare-Access edge assertion, TOFU pinning — happy-server `AGENTS.md` → "Public-mode auth plane"), the **single-user embedded posture** (no per-request/per-socket `userId` threading), and the load-bearing **auth-plane install order** (`installForkAuthPlane` runs *before* route/socket registration — `api.ts` FORK-PATCH note; guards US-005 default-deny) all stay identical. Tests may change; prod behavior may not.

### HARD gate table

| Story class | Gate command (run from `packages/happy-server/`, all must pass) |
|---|---|
| **Auth-plane** (US-006 socket, US-007 api) | `pnpm --filter happy-server exec vitest run sources/app/api/publicAuthGate.spec.ts sources/app/api/auth/remoteDeviceAuth.spec.ts sources/app/api/deviceEnrollment.spec.ts sources/app/api/socket.spec.ts sources/index.spec.ts sources/dualListenerBinding.test.ts` **AND** `pnpm --filter happy-server typecheck` |
| **Presence-adjacent** (US-004 eventRouter/pushRoutes) | `pnpm --filter happy-server exec vitest run sources/app/api/socket.spec.ts sources/app/api/publicAuthGate.spec.ts` **AND** `pnpm --filter happy-server typecheck` |
| **Non-auth** (US-001, US-002, US-003, US-005, US-008) | targeted `vitest run <changed .spec.ts>` (if any) **AND** `pnpm --filter happy-server typecheck` |

All six auth-plane gate spec files were **confirmed present** in the worktree (`sources/app/api/publicAuthGate.spec.ts`, `sources/app/api/auth/remoteDeviceAuth.spec.ts`, `sources/app/api/deviceEnrollment.spec.ts`, `sources/app/api/socket.spec.ts`, `sources/index.spec.ts`, `sources/dualListenerBinding.test.ts`). `publicAuthGate.spec.ts` is the decisive default-deny route-inventory test (every un-allowlisted route → `401`) — it is the guard for any change to `api.ts` route registration.

---

## 3. Verified research (file:symbol) — per-file conflict anatomy

Each divergence below was read from the live `git merge-file --diff3` output at `2a670e71` (byte-identical to the findings' HEAD `58723b9e` — verified no drift on all 9 files).

### 3.1 `sources/app/api/api.ts` (6 hunks) — HS-1/HS-2 (seamed) + HS-7 (KEEP-DELETED) + fork CORS + fork `configureApi`
- **h1 imports** — fork imports `accountRoutes`, `machineSelfRoutes`; upstream imports `attachmentRoutes` (deleted route). → **HS-7 KEEP-DELETED**.
- **h2** — fork adds `interface ApiPaths extends LoopbackCapabilityPaths`; upstream adds `interface StartApiOptions` + `startApi(opts)` (self-host static-webapp option). → fork embedded-config surface (**KEEP**) vs upstream new feature (**DISABLE/decline**).
- **h3 CORS** — fork replaces `origin:'*'`/`allowedHeaders:'*'` with `parseCorsOrigins()` allowlist + explicit header allowlist (`X-Happy-Device-Proof`, `X-Happy-Pairing-Secret/Nonce`, `CF-Access-Client-*`, deliberately **excludes** `Cf-Access-Jwt-Assertion`); upstream only adds `PUT`. → **KEEP** (public-mode preflight security). `parseCorsOrigins` is already a fork helper (`sources/app/api/utils/parseCorsOrigins.ts`).
- **h4 auth install** — fork calls `installForkAuthPlane(fastifyApp, typed, tofuConfig, options)` (HS-1/HS-2 seam, already relocated); upstream calls `enableAuthentication(typed)` + adds `skipNotFoundHandler` for static dir. → **HS-1/HS-2 KEEP** (thin residual).
- **h5 route registration** — fork's curated `configureApi()` body (accountRoutes, machineSelfRoutes, pair/push/session/dev/version/v3 with public-mode gate) + `configureApi`/`startApi` split; upstream's full multi-tenant route list (`authRoutes`, `connectRoutes`, `machinesRoutes`, `artifactsRoutes`, `accessKeysRoutes`, `voiceRoutes`, `userRoutes`, `feedRoutes`, `kvRoutes`, `attachmentRoutes`) + static-webapp self-host block. → **HS-7 KEEP-DELETED** + fork embedded architecture (**KEEP**) + upstream static feature (**DISABLE/decline**). This is the biggest, densest hunk and the prime relocation target.

### 3.2 `sources/app/api/socket.ts` (3 hunks) — HS-3 auth auto-merges; residual = single-user `userId` removal
All three hunks are the identical pattern in the connection-registration payloads: **fork removed `userId`**, upstream **added `happyClient?`** alongside it (e.g. `{ sessionId }` vs base `{ userId, sessionId }` vs upstream `{ userId, sessionId, happyClient }`). → **KEEP-DELETED** (single-user collapse — happy-server `AGENTS.md`: "Do not reintroduce per-socket `userId` threading"). `happyClient` is a harmless optional telemetry field.

### 3.3 `sources/utils/log.ts` (4 hunks) — fork quiet-logger + `shutdownLogger` (KEEP)
- fork adds `isQuietLogger = process.env.HAPPY_SERVER_QUIET_LOGGER === 'true'` gate around the pino-pretty transport + `enabled: !isQuietLogger` on the root logger + `transport: transports.length > 0 ? … : undefined` (embedded-daemon quiet mode, set by `createApp` when `!enablePrettyLogs`);
- upstream **rewrites** the transport entirely to synchronous in-process `pretty()` + `pino.multistream` (fixes a `bun build --compile` single-file worker-thread crash);
- fork adds `shutdownLogger()` (pure ADD — base and upstream both just `}`).
→ genuine feature-drift overlap. **KEEP** fork behavior; the quiet-gate + `shutdownLogger` relocate cleanly to a fork module.

### 3.4 `sources/app/events/eventRouter.ts` (2 hunks) — single-user + fork agent-tree (KEEP + KEEP-DELETED)
- h1: fork **removed** the `userId: string` connection field; upstream **added** `happyClient?`. → **KEEP-DELETED** (single-user; consistent with the ring-buffer/no-userId posture in happy-server `AGENTS.md` → "Ring buffer replay state").
- h2: fork **adds** `emitAgentTreeUpdate({sessionId, delta, skipSenderConnection})` (fork agent-tree feature); upstream **adds** `hasActiveNonMachineSocket(userId)` presence query. Textually adjacent add/add — **both wanted** (KEEP fork method; upstream presence query is additive but `userId`-typed → adopt only if it does not reintroduce per-request `userId` threading).

### 3.5 `sources/app/api/routes/pushRoutes.ts` (1 hunk) — fork per-machine push (KEEP)
fork imports `TofuHandshakeConfig` + `listPushTokens/registerPushToken/unregisterPushToken` from `@/app/push/pushNotifications`; upstream imports `db`, `dispatchSessionEventPush`, `buildSessionEventEphemeral/eventRouter`. → fork rewrote push to the **server-owned per-machine** model (happy-server `AGENTS.md` item 8: "Push notifications are server-owned … store Expo tokens by local machine/device"). **KEEP**.

### 3.6 `sources/app/monitoring/metrics2.ts` (1 hunk) — HS-6-driven Account removal
fork **removed** `accountCount`/`db.account.count()` (no `Account` model — HS-6); upstream switched all counts to `getEstimatedRecordCount('"Table"')` (Postgres catalog-estimate perf, avoids full-scan once/min). → the fork's divergence is **purely HS-6 (schema collapse)**. **KEEP-DELETED** (guard by absence of `Account`); optionally **RESTORE-partial** (adopt upstream estimates minus the `'"Account"'` line) to shrink future drift.

### 3.7 `sources/index.ts` (1 hunk, add/add) — fork-owned embedded-server entry (KEEP-ours)
`index.ts` does **not exist in BASE `cli-1.1.8`** → add/add → whole-file single conflict. Fork's `index.ts` is the **embedded-server** entry (`createApp()`, `HappyServerConfig`, `bootstrapMachineForEmbedded`, HS-5 `assertOperatorIdentityGate` re-export). Upstream's same-named `index.ts` is a **different-purpose** package entry (`startServer()`, `runMigrations` re-export). The fork does **not need** upstream's file. → **KEEP-ours** (take-ours wholesale, do not merge); HS-5 gate seam already relocated.

### 3.8 `sources/storage/processImage.spec.ts` (1 hunk) — RESTORE (clean elimination)
Both sides rewrote the test from fixture-read to sharp-generated; they diverge on dimensions (fork 20×10 / upstream 200×100) and assertions (upstream asserts `pixels` length). **Verified `sources/storage/processImage.ts` is byte-identical to upstream `cli-1.1.10` (0 diff-hunks) and returns `pixels: data`.** So upstream's spec passes against the fork's impl. → **RESTORE-toward-upstream** (take upstream's spec verbatim) → **conflict eliminated**.

### 3.9 `package.json` (5 hunks) — mechanical build/packaging (KEEP)
`private` flag; `main`/`module`/`exports`/`files` (fork's pkgroll `dist/` embedded layout vs upstream's `bin/`+`webapp/` self-host layout); `build`/`typecheck` scripts (fork `pkgroll` vs upstream `build-runtime.cjs`+`bundle:webapp`); deps. Pure build-tooling drift from embedded-vs-standalone packaging. **KEEP** (mechanical; accept manual-merge; align deps opportunistically).

---

## 4. Invariant-ID assignment (new HS-* rows)

Assigned in `docs/happy-patch-surface.md` §3. Existing HS-1..HS-8 keep their IDs; the residual `api.ts` reductions extend HS-1/HS-2/HS-7 dispositions.

| invariant | file | class | disposition |
|---|---|---|---|
| HS-1, HS-2 (existing) | `app/api/api.ts` auth install | KEEP | thin seam residual (M1); no change beyond §5 |
| HS-3 (existing) | `app/api/socket.ts` auth dispatch | KEEP | already auto-merges; note residual is HS-9 |
| HS-5 (existing) | `index.ts` operator-identity gate | KEEP | already relocated; note whole-file HS-14 |
| HS-7 (existing) | `app/api/api.ts` route allowlist | KEEP-DELETED | extend: relocate curated route-reg + CORS to `sources/fork/` |
| **HS-9** | `app/api/socket.ts` connection data | KEEP-DELETED | single-user `userId` removal; adopt upstream `happyClient?` additively |
| **HS-10** | `app/events/eventRouter.ts` | KEEP + KEEP-DELETED | fork `emitAgentTreeUpdate` (KEEP) + single-user `userId` removal (KEEP-DELETED) |
| **HS-11** | `utils/log.ts` | KEEP | fork quiet-logger + `shutdownLogger` → `sources/fork/forkLogger.ts` seam |
| **HS-12** | `app/api/routes/pushRoutes.ts` | KEEP | fork per-machine server-owned push |
| **HS-13** | `app/monitoring/metrics2.ts` | KEEP-DELETED | HS-6-driven `Account`-count removal (guard by absence); optional RESTORE-partial estimates |
| **HS-14** | `index.ts` | KEEP-ours | fork-owned embedded-server entry; take-ours, do not merge |
| **HS-15** | `package.json` | KEEP (mechanical) | embedded pkgroll vs upstream bin/webapp packaging drift |
| **HS-16** | `storage/processImage.spec.ts` | RESTORE | take upstream spec verbatim (impl already == upstream) → conflict eliminated |

---

## 5. KEEP / DISABLE / RESTORE triage tables (per file, with seam design)

New fork-overlay modules land in `sources/fork/` (mirrors `packages/happy-cli/src/fork/`; `sources/fork/operatorIdentityGate.ts` already lives there). Existing fork helpers (`app/api/auth/*`, `app/api/utils/parseCorsOrigins.ts`) stay put.

### 5.1 `api.ts` (HS-1/HS-2/HS-7) — Δ6→~2
| # | divergence | file:symbol | disposition | seam / re-apply note | Δhunks |
|---|---|---|---|---|---|
| a | curated route registration block | `api.ts::configureApi` body ↔ deleted upstream routes | **KEEP-DELETED + KEEP** | Extract fork route-reg into `sources/fork/registerForkRoutes.ts` (`registerForkRoutes(typed, eventRouter, tofuConfig, options, publicAuthRuntime)`); `configureApi` calls it. **MUST** stay after `installForkAuthPlane` (install-order invariant). Marker `RESTORE-Rsrv1`. | 1→~1 (thin call) |
| b | CORS origin + header allowlist | `api.ts::configureApi` `@fastify/cors` register | **KEEP** | Extract to `sources/fork/forkCors.ts` (`installForkCors(app)`, wraps existing `parseCorsOrigins`); `configureApi` calls it. Marker `RESTORE-Rsrv1`. | 1→~0 |
| c | `installForkAuthPlane` call | `api.ts:130` (HS-1/HS-2) | **KEEP** | unchanged (already thin seam) | — |
| d | `ApiPaths`/`ConfigureApiOptions`/`configureApi`+`startApi` split | `api.ts` exported types | **KEEP** | fork embedded architecture; accept residual (function-signature surface, not seamable) | — |
| e | upstream `StartApiOptions` static-webapp + `attachmentRoutes` | upstream-only | **DISABLE / decline** | fork RN app is served separately; do not adopt. `attachmentRoutes` stays deleted (HS-7). | — |

### 5.2 `log.ts` (HS-11) — Δ4→~1
| # | divergence | disposition | seam note |
|---|---|---|---|
| a | `isQuietLogger` gate + `enabled`/conditional `transport` | **KEEP** | Move the quiet-mode delta into `sources/fork/forkLogger.ts` (`applyForkLoggerOptions(baseOptions)` / `buildForkStreams()`); reconcile onto upstream's `pretty()`+`multistream` shape so the quiet path composes with the Bun-safe streams. |
| b | `shutdownLogger()` | **KEEP** | pure ADD → move to `sources/fork/forkLogger.ts` and re-export from `log.ts` (thin). |

### 5.3 `socket.ts` (HS-9, auth-plane) — Δ3→~1
| divergence | disposition | note |
|---|---|---|
| `userId` removed from connection payloads | **KEEP-DELETED** | single-user; must NOT reintroduce `userId`. Adopt upstream `happyClient?` optional field additively (harmless telemetry) to shrink the delta. Re-run FULL auth gates. |

### 5.4 `eventRouter.ts` (HS-10) | `pushRoutes.ts` (HS-12) | `metrics2.ts` (HS-13)
| file | disposition | note |
|---|---|---|
| `eventRouter.ts` | **KEEP + KEEP-DELETED** | keep `emitAgentTreeUpdate`; keep `userId` removed; adopt upstream `hasActiveNonMachineSocket` presence query **only if** it can be expressed without per-request `userId` threading (else decline). |
| `pushRoutes.ts` | **KEEP** | fork per-machine server-owned push; catalogue only (no reduction — genuine architecture divergence). |
| `metrics2.ts` | **KEEP-DELETED** (recommended) | keep exact-count minus `Account` (lowest risk; single-user tables are tiny so the estimate perf win is negligible). **Alt: RESTORE-partial** — adopt upstream `getEstimatedRecordCount` for the 3 existing tables, drop `'"Account"'`. Either way the `Account` removal keeps a 1-hunk delta (HS-6-driven). |

### 5.5 `index.ts` (HS-14) | `processImage.spec.ts` (HS-16) | `package.json` (HS-15)
| file | disposition | note |
|---|---|---|
| `index.ts` | **KEEP-ours** | catalogue as fork-owned embedded entry; intake = take-ours, do not merge. Confirm HS-5 `RESTORE-R3-done` marker present. No code change. |
| `processImage.spec.ts` | **RESTORE** | replace fork spec with upstream `cli-1.1.10` spec verbatim → conflict **eliminated** (impl already identical). |
| `package.json` | **KEEP (mechanical)** | catalogue HS-15; accept manual-merge; align deps where trivially possible. |

---

## 6. Stories, acceptance criteria, ship order

8 stories, ordered **safest → riskiest** (non-auth cleanups first; auth-plane `socket.ts`/`api.ts` last). Each story that changes a file adds/updates its HS-* row in the SAME commit; US-008 is the consolidation sweep. Full ACs in `stories-outline.md`.

| order | story | file(s) | class | primary AC | reduction |
|---|---|---|---|---|---|
| 1 | **US-001** | `storage/processImage.spec.ts` | non-auth | replace with upstream spec verbatim; `vitest run …/processImage.spec.ts` green; add HS-16 | **eliminates 1 file** |
| 2 | **US-002** | `monitoring/metrics2.ts` | non-auth | keep exact-count minus `Account` (or RESTORE-partial estimates); typecheck; add HS-13 | governs (HS-6) |
| 3 | **US-003** | `utils/log.ts` + `sources/fork/forkLogger.ts` (new) | non-auth | relocate quiet-logger + `shutdownLogger`; reconcile onto upstream multistream; typecheck + log tests; add HS-11 | **4→~1** |
| 4 | **US-004** | `events/eventRouter.ts`, `routes/pushRoutes.ts` | presence-adjacent | keep agent-tree + `userId` removal; catalogue; adopt upstream additive fields only if no `userId` threading; socket+publicAuthGate specs + typecheck; add HS-10/HS-12 | governs |
| 5 | **US-005** | `index.ts` (doc/marker only) | non-auth | catalogue KEEP-ours; confirm HS-5 marker; `index.spec.ts` + typecheck; add HS-14 | **take-ours** |
| 6 | **US-006** | `app/api/socket.ts` + `sources/fork/` | **auth-plane** | keep `userId` removed, adopt `happyClient?`; **FULL 5 HARD gates**; add HS-9 | **3→~1** |
| 7 | **US-007** | `app/api/api.ts` + `sources/fork/registerForkRoutes.ts` + `sources/fork/forkCors.ts` (new) | **auth-plane** | relocate route-reg + CORS behind seams, preserve install order, decline static-webapp; **FULL 5 HARD gates** incl. `publicAuthGate` default-deny; extend HS-7/HS-1/HS-2 | **6→~2** |
| 8 | **US-008** | `package.json`, `docs/happy-patch-surface.md`, `packages/happy-server/AGENTS.md` | non-auth | catalogue HS-15; verify HS-9..HS-16 rows + §8 replant notes complete; add single-user socket/eventRouter connection-data note to AGENTS.md; typecheck | governs |

**Estimated reduction:** hard-conflict file count **9 → ~8** (`processImage.spec.ts` eliminated), plus **`index.ts` → take-ours** (removed from merge-effort though the add/add textually remains), plus **material hunk/effort reduction** on `api.ts` (6→~2), `log.ts` (4→~1), `socket.ts` (3→~1). **All 9 catalogued** (HS-9…HS-16 + extended HS-7/HS-1/HS-2) → next intake fully governed. Net conflict-hunk total **~24 → ~10**. This is deliberately M1-style **localization, not elimination** — the residual (`api.ts` architecture, `socket.ts`/`eventRouter.ts` single-user removals, `pushRoutes.ts`/`package.json` architecture) is genuine, load-bearing fork divergence.

---

## 7. Risks & common mistakes

- **CRLF trap (analysis).** The worktree is CRLF; upstream blobs are LF. Any re-measurement MUST normalize `\r\n`→`\n` before `git merge-file` or every file shows a false whole-file conflict. (This plan's numbers are LF-normalized.)
- **Install-order invariant (US-007).** `installForkAuthPlane` MUST run **before** `registerForkRoutes()` — the global default-deny `onRequest` hook must install before routes. `publicAuthGate.spec.ts` (route-inventory default-deny) is the guard; it is in the auth gate set. Do not reorder.
- **Never reintroduce `userId` (US-004, US-006).** The single-user collapse is a happy-server `AGENTS.md` hard rule. Adopting upstream's `happyClient?` is fine (optional, no tenant identity); adopting upstream's `hasActiveNonMachineSocket(userId)` / any `userId`-keyed structure is **not** unless it can be re-expressed process-locally. When in doubt, decline the upstream additive.
- **`shutdownLogger` wiring (US-003).** `shutdownLogger` is called from the daemon shutdown path — relocating it must preserve the export name from `utils/log.ts` (re-export) so callers are unbroken. Reconcile the quiet gate onto upstream's `multistream` shape, not the old threaded `transport` (which upstream removed for the Bun single-file build).
- **`index.ts` add/add (US-005).** Do not attempt to merge upstream's `index.ts` into the fork's — they are different files with the same name. Take-ours; this is a catalogue decision, not a code merge.
- **`metrics2.ts` estimate helper (US-002).** If choosing RESTORE-partial, `getEstimatedRecordCount` must exist/behave for PGlite (the fork's embedded DB), not just Postgres — verify before adopting, else keep exact-count.
- **`package.json` (US-008).** Do NOT blind-take upstream — the fork's pkgroll `dist/`/`exports` layout is load-bearing for the embedded `createHappyServer()` import path in happy-cli. Merge dep bumps only; keep fork packaging.
- **Scope creep.** Do not touch `v3SessionRoutes.ts` (HS-4, auto-merges) or `metrics.ts` (auto-merges). Only the 9 files above.

## 8. Gates (summary)

- **Auth-plane stories (US-006, US-007):** the full 6-spec vitest set + `typecheck` (see §2 table). `publicAuthGate.spec.ts` must show every un-allowlisted route → `401`.
- **All stories:** `pnpm --filter happy-server typecheck` green.
- **Behavior-preserving proof:** no prod-path behavior change; the auth-plane specs pin accept/reject; `socket.spec.ts` pins handshake; `index.spec.ts` pins embedded bootstrap.

## Appendix — reproducibility

- Enumeration: `git merge-file -p --diff3 <ours> <b72fd811 blob> <71c417e1 blob>` per file, **LF-normalized**, over `packages/happy-server` files present in both OURS and THEIRS with both differing from BASE. Add/add (no BASE) counted with empty base (`index.ts`).
- Mirror `D:/harness-efforts/happy` fetched only; refs `71c417e1` (cli-1.1.10), `b72fd811` (cli-1.1.8) confirmed present. Scratch analyzer deleted before commit.
