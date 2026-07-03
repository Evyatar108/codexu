# Stories outline — M0 (catalogue) + M1 (seam refactors)

Task: `happy-upstream-conflict-surface-and-merge-strategy` (M0 + M1).
All M1 stories are **behavior-preserving relocations** (pure move of fork logic into a fork-owned seam + a thin call-site, proven identical by before/after tests). Complexity: S ≈ ≤½ day, M ≈ 1–2 days.

Legend — Package: `srv`=happy-server, `cli`=happy-cli, `docs`=repo-root docs/scripts, `app`=happy-app (doc-only in M0).

---

## Milestone M0 — Baseline + `docs/happy-patch-surface.md` catalogue

### M0-S1 — Catalogue skeleton + marker convention  ·  Package: docs  ·  Complexity: S
Create `docs/happy-patch-surface.md` with: header (last-updated, baseline placeholder, upstream anchor `cli-1.1.10`/`71c417e1`, how-to-use-at-intake); **marker convention** `// FORK PATCH: [BUCKET] <reason> (invariant <ID>)` with JSX `{/* FORK PATCH */}` + Prisma `//` variants; the three **buckets** KEEP / KEEP-DELETED / RESTORE (with definitions); the empty **invariant-to-guard table** (`# | file:symbol (line hint) | bucket | invariant | marker? | test/guard | replant note`) — rows anchor on a stable symbol/function + marker, line is a drift-prone hint only; a per-surface replant-notes section; and an **ownership + cadence** line.
- **AC:** file exists; buckets + marker convention + table header + replant + ownership sections all present; marker id scheme documented (`HS-`/`HC-`/`HA-`); table columns anchor on symbol+marker (not bare line numbers).
- **Depends on:** none. (Blocks all other M0/M1 catalogue rows.)

### M0-S2 — Pin import baseline + record upstream mirror  ·  Package: docs  ·  Complexity: S
Tree-match a stable upstream file to pin codexu's import-baseline commit (replace the inferred ~2026-05-03 date). Add `slopus/happy` as a read-only codexu remote OR formally designate `D:/harness-efforts/happy` as the upstream mirror. Record the pinned baseline SHA + anchor release tag in the catalogue header.
- **AC:** catalogue header shows a real baseline SHA (method noted), the anchor tag, and the mirror/remote used; a documented `git` command reproduces a per-file 3-way against the baseline.
- **Depends on:** M0-S1.

### M0-S3 — `.gitattributes` for translations / dist / lockfiles  ·  Package: docs+app  ·  Complexity: S
Add `.gitattributes`: `packages/happy-app/sources/text/** merge=union`; tracked `**/dist/** merge=ours` (or gitignore) + lockfiles `merge=ours`. First verify the i18n loader tolerates duplicate keys (else note the fork-namespace-strings fallback as an open item). Document each rule + rationale in the catalogue.
- **AC:** `.gitattributes` present with the three rules; i18n-dedupe check recorded; catalogue `.gitattributes` policy section written.
- **Depends on:** M0-S1.

### M0-S4 — Catalogue + mark the happy-server auth/E2E/single-tenant/route surface  ·  Package: srv  ·  Complexity: M
Add `// FORK PATCH:` markers + catalogue rows for: `api.ts:78` (authenticateTunnel no-op, KEEP→RESTORE-R1), `api.ts:79` (authenticate selection), `api.ts:84-121` (public-mode block, KEEP — public server), `socket.ts:57-116` (handshake branches, KEEP→RESTORE-R1), `v3SessionRoutes.ts:166-169` (`{t:'encrypted'}` label, KEEP-DELETED server-crypto), `index.ts:101-135` (operator gate, KEEP→RESTORE-R3). Add **KEEP-DELETED** rows (guard = "must-not-be-registered/exist" test) for `prisma/schema.prisma` multi-tenant `userId` collapse and the Sprint-E deleted routes (artifact/feed/voice/kv/access-key/user-friends/usage/machine-directory + retired `/pair/start`,`/pair/status`). Cite the enforcing spec for each (`publicAuthGate.spec.ts`, `deviceEnrollment.spec.ts`, `socket.spec.ts`, `index.spec.ts`).
- **AC:** every listed hunk has a marker citing its invariant id; every row has an invariant + a test/guard reference + a replant note; KEEP-DELETED rows name a guard; `pnpm --filter happy-server build` still typechecks (comment-only edits).
- **Depends on:** M0-S1.

### M0-S5 — Catalogue + mark the happy-cli E2E + wiring hotspots  ·  Package: cli  ·  Complexity: M
Add markers + rows for: `apiSession.ts:659` (send plaintext, KEEP→RESTORE-R2), `:316` (live-receive), `:575` (fetch-decrypt asymmetry — note latent-bug), and the codex/daemon wiring blocks in `runCodex.ts`/`runClaude.ts`/`daemon/run.ts`/`apiMachine.ts` (KEEP→RESTORE-R4). Record the fork-exclusive overlay dirs (`src/codex`,`src/daemon`,`src/agentComms`,`src/tunnel`) as **zero-conflict** context rows (no markers — no upstream equivalent).
- **AC:** each hotspot marked + rowed with invariant + replant note; the E2E-asymmetry row documents send=plaintext / fetch=decrypt; `npm_config_script_shell=bash pnpm --filter happy test` still passes (comment-only edits).
- **Depends on:** M0-S1.

### M0-S6 — Doc-only inventory: happy-app hotspots + artifacts  ·  Package: docs(app read-only)  ·  Complexity: S
Catalogue (rows only, NO source markers — happy-app is not refactored in M1) the happy-app hotspots (`sync/sync.ts`, `sync/storage.ts`, `sync/reducer/reducer.ts`, `-session/SessionView.tsx`, `components/{ChatList,AgentInput}.tsx`, `text/_default.ts` + translations) as KEEP/manual-3-way, plus the fork-exclusive app dirs as zero-conflict. Note R5/R6/R8 as deferred (M2+).
- **AC:** happy-app hotspot rows present with the "durable manual-3-way cost center" note; no source edits under `packages/happy-app/`.
- **Depends on:** M0-S1.

### M0-S7 (optional if time) — Advisory marker-audit script  ·  Package: docs  ·  Complexity: S
`scripts/audit-happy-fork-patches.mjs`: grep happy-* for `// FORK PATCH:` markers, cross-check each against a catalogue row, report drift (orphan marker / stale row). Advisory (exit 0 + report) in M0.
- **AC:** script runs, reports zero drift on the M0-catalogued set; documented in the catalogue.
- **Depends on:** M0-S4, M0-S5.

---

## Milestone M1 — Seam refactors (behavior-preserving; happy-server + happy-cli)

### M1-S1 (R3) — Extract operator-identity gate to `fork/`  ·  Package: srv  ·  Complexity: S
Move `LOOPBACK_HOSTS` + `isLoopbackHost` + `assertOperatorIdentityGate` from `index.ts:87-135` to new `sources/fork/operatorIdentityGate.ts`; `index.ts` keeps the import + the single `assertOperatorIdentityGate(config)` call. Add the thin-seam `// FORK PATCH:` marker + flip the catalogue row RESTORE-R3 → done.
- **AC:** behavior identical — `index.spec.ts` + `dualListenerBinding.test.ts` pass unchanged (throw matrix: public-on-public-without-verifier/edge → throw; tunnel-on-public → throw; loopback/tunnel-on-loopback → ok); `index.ts` no longer contains the gate body.
- **Depends on:** M0-S4. **First M1 story** (establishes the `fork/` dir pattern).

### M1-S2 (R1a) — `api.ts` auth wiring → `forkAuthPlane` seam  ·  Package: srv  ·  Complexity: M
Relocate `authenticateTunnel` no-op + `authenticate` selection + the public-mode block (`parseAs:'buffer'` parser + `httpGuard` + `bodyHashGuard`) from `configureApi` into `sources/app/api/auth/forkAuthPlane.ts::installForkAuthPlane(fastifyApp, typed, tofuConfig, options)`; `api.ts` shrinks to a 1-line call. **Preflight first:** fetch upstream's real `enableAuthentication.ts` from the M0-S2 mirror + confirm it registers no active global hook before restoring it present-but-overlaid (RESTORE row); if it does register an active hook, keep it KEEP-DELETED instead. Preserve hook install order + single-user posture (no per-request `userId`).
- **AC (HARD gates, all must pass unchanged):** `publicAuthGate.spec.ts` (US-005 route inventory), `remoteDeviceAuth.spec.ts` (US-005a body-hash), `deviceEnrollment.spec.ts`, `corsAllowed.test.ts`; + new golden auth-decision tests (tunnel no-op / loopback token / public fail-closed) asserting identical accept/reject; `api.ts` auth region reduced to the seam call; restored upstream file (if RESTORE) proven dormant (no active hook/decorator runs in fork modes).
- **Depends on:** M1-S1 (pattern), M0-S4.

### M1-S3 (R1b) — `socket.ts` handshake branches → `auth/` helpers  ·  Package: srv  ·  Complexity: M
Relocate the loopback + public branch bodies of `createSocketAuthMiddleware` into `auth/` helpers (extend `loopbackCapability.ts`/`remoteDeviceAuth.ts`); `socket.ts` becomes a thin dispatcher.
- **AC (HARD gate):** `socket.spec.ts` passes unchanged (public device-proof on ws + polling; strict single-use nonce; fail-open tunnel branch stays closed); socket.ts inline auth footprint reduced.
- **Depends on:** M1-S2 (shared `forkAuthPlane`/helper shape).

### M1-S4 (R2) — Session-payload codec seam (relocation only, no format change)  ·  Package: cli (+srv label)  ·  Complexity: M
New `packages/happy-cli/src/api/sessionPayloadCodec.ts` with `encodeOutgoing` = `JSON.stringify` (plaintext, today's bytes) and `decodeIncoming(raw,{source})` = `JSON.parse` (live) / `decrypt(...)` (fetch) — reproducing the current asymmetry verbatim. Route `apiSession.ts:659/316/575` through it. Add an honest `// FORK PATCH:` marker on the `v3SessionRoutes.ts:166-169` `{t:'encrypted'}` label. **No wire/at-rest format change.**
- **AC:** round-trip golden tests prove `encodeOutgoing`/`decodeIncoming` are byte-identical to the pre-refactor inline code for both paths; a regression test pins that send emits plaintext (documents the current contract so a future E2E flip is a deliberate change); `apiSession.ts` diff-vs-upstream on those sites shrinks; existing `apiSession` tests green.
- **Depends on:** M0-S5. **Independent of R1/R3.**

### M1-S5 (R4a) — `daemon/run.ts` inline wiring → `forkHooks.onDaemonRun`  ·  Package: cli  ·  Complexity: M
New `packages/happy-cli/src/fork/forkHooks.ts`; move the `daemon/run.ts` inline fork block into `onDaemonRun(...)` delegating to existing `src/daemon/` overlay bodies; `run.ts` calls the hook. No overlay-body edits.
- **AC:** wiring test asserts `onDaemonRun` is invoked with identical args + side-effects; daemon startup behavior unchanged; run.ts inline fork footprint reduced to the hook call.
- **Depends on:** M0-S5. **Independent of R1/R2/R3.**

### M1-S6 (R4b) — `runCodex.ts` inline wiring → `forkHooks.onCodexRun`  ·  Package: cli  ·  Complexity: M
Move `runCodex.ts` inline fork block into `forkHooks.onCodexRun(...)` delegating to `src/codex/` overlays; `runCodex.ts` calls the hook.
- **AC:** wiring test (identical args/side-effects); `src/codex/codex.integration.test.ts` green under `RUN_INTEGRATION=1 RUN_CODEX_INTEGRATION=1`; runCodex.ts footprint reduced.
- **Depends on:** M1-S5 (shared `forkHooks` module). Can also land before/independent if `forkHooks.ts` is created here.

### M1-S7 (R4c) — `runClaude.ts` + `apiMachine.ts` inline wiring → `forkHooks`  ·  Package: cli  ·  Complexity: M
Move `runClaude.ts` block → `onClaudeRun`; `apiMachine.ts` block → `onMachineRpc`; both delegate to overlays.
- **AC:** wiring tests (identical args/side-effects); `src/claude/claude.integration.test.ts` green under `RUN_INTEGRATION=1`; footprints reduced.
- **Depends on:** M1-S5 (shared `forkHooks` module).

---

## Dependency / ship order

```
M0-S1 ─┬─ M0-S2
       ├─ M0-S3
       ├─ M0-S4 ── M1-S1 ── M1-S2 ── M1-S3         (R3 → R1a → R1b, serialize: shared srv auth files)
       ├─ M0-S5 ─┬ M1-S4                            (R2, independent)
       │         └ M1-S5 ─┬ M1-S6                   (R4a → R4b/c, shared forkHooks.ts)
       │                  └ M1-S7
       ├─ M0-S6
       └─ M0-S7 (needs S4+S5)
```

- **M0 first** (S1 gates everything; S2/S3/S4/S5/S6 then S7). Comment/doc-only → low risk, ships as one or two commits.
- **M1 parallelizable across three disjoint tracks** once M0 lands: (A) srv-auth serial chain R3→R1a→R1b (they touch shared happy-server auth files); (B) cli-codec R2 (standalone); (C) cli-wiring R4a→R4b/R4c (shared `forkHooks.ts`). Tracks A/B/C touch disjoint files and can proceed independently.
- Each M1 story is independently shippable (pure relocation + green tests). Auth-plane stories (S1/S2/S3) gate on the five HARD public-server specs.

## Story count
- **M0:** 7 (S1–S7; S7 optional).
- **M1:** 7 (S1–S7 = R3, R1a, R1b, R2, R4a, R4b, R4c).
- **Total:** 14 (13 if M0-S7 deferred).
