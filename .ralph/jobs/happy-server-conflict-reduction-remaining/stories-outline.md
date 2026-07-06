# Stories outline — `happy-server-conflict-reduction-remaining`

Behavior-preserving happy-server upstream conflict-surface reduction vs `cli-1.1.10`. 8 stories, safest → riskiest. Every code-touching story adds/updates its `HS-*` row in `docs/happy-patch-surface.md` in the same commit. Auth-plane stories (US-006, US-007) MUST re-run the FULL 5-gate vitest set (see plan §2). All stories MUST end `pnpm --filter happy-server typecheck` green. Never reintroduce `userId` threading; never weaken the public-mode fail-closed boundary; never touch `v3SessionRoutes.ts` or `metrics.ts` (they auto-merge).

Paths relative to `packages/happy-server/` unless noted.

---

## US-001 — `processImage.spec.ts` RESTORE-toward-upstream (eliminate conflict)
**Files:** `sources/storage/processImage.spec.ts`; `docs/happy-patch-surface.md` (HS-16).
**Class:** non-auth. **Reduction:** eliminates 1 hard-conflict file.

Context: `sources/storage/processImage.ts` is byte-identical to upstream `cli-1.1.10` (verified 0 diff-hunks; returns `pixels: data`). The fork's stale spec (20×10, `thumbhash.length`) diverges from upstream's (200×100, asserts `pixels` length). Adopting upstream's spec verbatim eliminates the conflict and passes against the fork's (already-upstream) impl.

**Acceptance criteria**
1. `sources/storage/processImage.spec.ts` replaced with the exact upstream `cli-1.1.10` file content (`git -C D:/harness-efforts/happy show 71c417e1:packages/happy-server/sources/storage/processImage.spec.ts`), preserving 4-space tabs.
2. `pnpm --filter happy-server exec vitest run sources/storage/processImage.spec.ts` → all green.
3. A fresh LF-normalized 3-way `git merge-file --diff3` of this file vs BASE/THEIRS now exits 0 (no conflict).
4. `docs/happy-patch-surface.md` gains an **HS-16** row (RESTORE; "impl already == upstream; test adopted verbatim → conflict eliminated").
5. `pnpm --filter happy-server typecheck` green.

---

## US-002 — `metrics2.ts` HS-6-driven Account removal (catalogue + optional RESTORE-partial)
**Files:** `sources/app/monitoring/metrics2.ts`; `docs/happy-patch-surface.md` (HS-13).
**Class:** non-auth. **Reduction:** governs (count unchanged; HS-6-driven).

Context: fork removed `accountCount`/`db.account.count()` (no `Account` model — HS-6). Upstream switched to `getEstimatedRecordCount('"Table"')` catalog estimates. Recommended: **KEEP exact-count minus `Account`** (lowest risk; single-user tables are tiny). Alt: RESTORE-partial (adopt estimates for `Session`/`SessionMessage`/`Machine`, drop `'"Account"'`) — only if `getEstimatedRecordCount` is verified to work on PGlite.

**Acceptance criteria**
1. `metrics2.ts` compiles and counts only the 3 fork-schema tables (`session`, `sessionMessage`, `machine`); no reference to `db.account` / `Account`.
2. If RESTORE-partial chosen: `getEstimatedRecordCount` confirmed present and PGlite-safe; else keep exact `db.*.count()`.
3. Behavior preserved: the metrics updater still populates the same 3 gauges; no new gauge, no `Account` gauge.
4. `docs/happy-patch-surface.md` gains an **HS-13** row (KEEP-DELETED, "HS-6-driven Account-count removal; guard by absence").
5. `pnpm --filter happy-server typecheck` green (+ any `metrics2` spec if present).

---

## US-003 — `log.ts` fork quiet-logger + `shutdownLogger` seam (KEEP)
**Files:** `sources/utils/log.ts`, `sources/fork/forkLogger.ts` (new); `docs/happy-patch-surface.md` (HS-11).
**Class:** non-auth. **Reduction:** 4 hunks → ~1.

Context: fork adds an `isQuietLogger` (`HAPPY_SERVER_QUIET_LOGGER`) gate + `enabled`/conditional-`transport` + `shutdownLogger()`. Upstream rewrote the transport to synchronous `pretty()`+`pino.multistream` (Bun single-file-compile fix). Relocate the fork delta into a fork module and reconcile onto upstream's multistream shape.

**Acceptance criteria**
1. New `sources/fork/forkLogger.ts` owns the quiet-mode delta (e.g. `applyForkLoggerOptions()` / `buildForkStreams()`) and `shutdownLogger()`, with a `// FORK PATCH: [HS-11]` header.
2. `sources/utils/log.ts` adopts upstream's `pretty()`+`multistream` base shape and calls the fork seam for the quiet gate; re-exports `shutdownLogger` (export name unchanged so daemon-shutdown callers are unbroken).
3. Quiet mode behavior preserved: with `HAPPY_SERVER_QUIET_LOGGER=true` the pretty stream is suppressed and the root logger is disabled/quiet exactly as before; with it unset, pretty logging works (bundled and from-source).
4. `shutdownLogger()` still flushes + ends the logger(s) identically.
5. `docs/happy-patch-surface.md` gains an **HS-11** row; `pnpm --filter happy-server typecheck` green + any log-related spec passes.

---

## US-004 — `eventRouter.ts` + `pushRoutes.ts` catalogue (KEEP / KEEP-DELETED)
**Files:** `sources/app/events/eventRouter.ts`, `sources/app/api/routes/pushRoutes.ts`; `docs/happy-patch-surface.md` (HS-10, HS-12).
**Class:** presence-adjacent (gates: `socket.spec.ts` + `publicAuthGate.spec.ts` + typecheck).
**Reduction:** governs.

Context: `eventRouter.ts` = fork `emitAgentTreeUpdate` (KEEP) + single-user `userId` removal (KEEP-DELETED) textually adjacent to upstream's new `hasActiveNonMachineSocket(userId)` presence query. `pushRoutes.ts` = fork per-machine server-owned push (KEEP).

**Acceptance criteria**
1. `eventRouter.ts`: fork `emitAgentTreeUpdate` retained; the removed `userId` connection field stays removed (no per-connection `userId`). If upstream's `hasActiveNonMachineSocket` is adopted, it MUST be re-expressed without per-request `userId` threading (process-local rooms) or explicitly declined with a `// FORK PATCH:` note.
2. `pushRoutes.ts`: fork per-machine push imports/handlers retained; no re-introduction of the upstream multi-tenant push wiring.
3. Both files gain/keep `// FORK PATCH:` markers pointing at HS-10 / HS-12.
4. `docs/happy-patch-surface.md` gains **HS-10** (KEEP + KEEP-DELETED) and **HS-12** (KEEP) rows.
5. Gates: `pnpm --filter happy-server exec vitest run sources/app/api/socket.spec.ts sources/app/api/publicAuthGate.spec.ts` green + `pnpm --filter happy-server typecheck` green.

---

## US-005 — `index.ts` catalogue as fork-owned KEEP-ours
**Files:** `sources/index.ts` (marker/comment only), `docs/happy-patch-surface.md` (HS-14).
**Class:** non-auth. **Reduction:** take-ours (removed from merge-effort).

Context: fork `index.ts` is the embedded-server entry (`createApp`, `HappyServerConfig`, `bootstrapMachineForEmbedded`, HS-5 gate re-export); upstream's same-named file is a different-purpose package entry (add/add). Fork does not need upstream's.

**Acceptance criteria**
1. `docs/happy-patch-surface.md` gains an **HS-14** row: "fork-owned embedded-server entry; add/add vs upstream's package entry; intake = take-ours, do not merge."
2. Confirm the existing HS-5 `// FORK PATCH: [RESTORE-R3-done]` marker (operator-identity gate re-export) is present and correct in `index.ts`; no logic change.
3. No behavior change; `pnpm --filter happy-server exec vitest run sources/index.spec.ts` green; `pnpm --filter happy-server typecheck` green.

---

## US-006 — `socket.ts` single-user connection data (adopt `happyClient?`, keep `userId` removed) — AUTH-PLANE
**Files:** `sources/app/api/socket.ts`; `docs/happy-patch-surface.md` (HS-9).
**Class:** **auth-plane** — FULL 5-gate set. **Reduction:** 3 hunks → ~1.

Context: three connection-registration hunks share the pattern "fork removed `userId`, upstream added `happyClient?`". Keep `userId` removed (single-user); adopt the harmless optional `happyClient` telemetry field to shrink the delta.

**Acceptance criteria**
1. `socket.ts` connection payloads adopt upstream's optional `happyClient?` field where present, WITHOUT reintroducing `userId`.
2. The HS-3 auth dispatch (already seamed) is unchanged; no change to `installForkAuthPlane` / `createSocketAuthMiddleware` behavior.
3. `// FORK PATCH: [HS-9]` marker on the single-user connection-data divergence.
4. `docs/happy-patch-surface.md` gains an **HS-9** row (KEEP-DELETED single-user + additive `happyClient`).
5. **FULL HARD gates green:** `pnpm --filter happy-server exec vitest run sources/app/api/publicAuthGate.spec.ts sources/app/api/auth/remoteDeviceAuth.spec.ts sources/app/api/deviceEnrollment.spec.ts sources/app/api/socket.spec.ts sources/index.spec.ts sources/dualListenerBinding.test.ts` + `pnpm --filter happy-server typecheck`.
6. Public-mode fail-closed socket handshake (device-proof on ws + polling, strict single-use nonce) unchanged — `socket.spec.ts` proves it.

---

## US-007 — `api.ts` relocate route-registration + CORS behind fork seams — AUTH-PLANE
**Files:** `sources/app/api/api.ts`, `sources/fork/registerForkRoutes.ts` (new), `sources/fork/forkCors.ts` (new); `docs/happy-patch-surface.md` (HS-7 + HS-1/HS-2 disposition).
**Class:** **auth-plane** — FULL 5-gate set. **Reduction:** 6 hunks → ~2.

Context: the densest file. Relocate the fork's curated route-registration block (h5) into `registerForkRoutes()` and the CORS origin+header allowlist (h3) into `installForkCors()`, leaving thin call-sites — mirroring M1's auth-plane relocation. Decline upstream's new self-host static-webapp feature + `attachmentRoutes` (HS-7 KEEP-DELETED).

**Acceptance criteria**
1. New `sources/fork/registerForkRoutes.ts` (`registerForkRoutes(typed, eventRouter, tofuConfig, options, publicAuthRuntime)`) contains the exact fork route set (accountRoutes, machineSelfRoutes, pairRoutes with public-mode gate, pushRoutes, sessionRoutes, devRoutes, versionRoutes, v3SessionRoutes) with a `// FORK PATCH: [HS-7]` header; `configureApi` calls it.
2. New `sources/fork/forkCors.ts` (`installForkCors(app)`) contains the fork origin allowlist (via existing `parseCorsOrigins`) + explicit header allowlist (including device-proof/pairing headers, EXCLUDING `Cf-Access-Jwt-Assertion`) with `// FORK PATCH:` header; `configureApi` calls it.
3. **Install order preserved:** `installForkAuthPlane(...)` still runs BEFORE `registerForkRoutes(...)` (global default-deny hook installs before routes). No route added to the public surface without a policy.
4. Upstream self-host static-webapp block + `StartApiOptions` + `attachmentRoutes` NOT adopted (declined; `attachmentRoutes` stays deleted per HS-7).
5. Behavior preserved: identical routes registered on identical listeners (tunnel vs loopback gating unchanged); CORS preflight behavior byte-identical.
6. `docs/happy-patch-surface.md` HS-7 disposition extended (route-reg + CORS relocated to `sources/fork/`); HS-1/HS-2 notes confirm thin seam.
7. **FULL HARD gates green** (the same 6-spec set as US-006) + `typecheck`. `publicAuthGate.spec.ts` MUST show every un-allowlisted route → `401` (default-deny intact).

---

## US-008 — `package.json` mechanical + docs/AGENTS.md consolidation sweep
**Files:** `package.json`; `docs/happy-patch-surface.md`; `packages/happy-server/AGENTS.md`.
**Class:** non-auth. **Reduction:** governs.

**Acceptance criteria**
1. `docs/happy-patch-surface.md` gains an **HS-15** row for `package.json` (KEEP mechanical: embedded pkgroll `dist/` layout vs upstream `bin/`+`webapp/`; merge dep bumps only, keep fork packaging).
2. Catalogue completeness verified: HS-9…HS-16 rows all present + §8 "Replant notes" gains a short happy-server-server-reduction subsection; no stale claim that server = "9 uncatalogued".
3. `packages/happy-server/AGENTS.md` gains a one-line note under the single-user posture section: the socket/eventRouter connection payloads intentionally omit `userId` (points at HS-9/HS-10) so future intake keeps them removed.
4. `package.json` unchanged except any trivially-alignable dep bumps (fork's `main`/`module`/`exports`/`files`/scripts layout preserved).
5. `pnpm --filter happy-server typecheck` green.

---

## Ship order & parallelism
Serial, safest → riskiest: **US-001 → US-002 → US-003 → US-004 → US-005 → US-006 → US-007 → US-008**. US-006 and US-007 are auth-plane and both touch the request/socket boundary — do NOT parallelize them with each other. US-001/US-002/US-003/US-005 are independent-surface and could batch, but the whole set is small enough to run serially in one impl member. Each story is a self-contained commit (code + its HS-* row).
