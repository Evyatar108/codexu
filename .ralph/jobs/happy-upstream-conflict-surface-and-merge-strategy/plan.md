# Plan — Happy ⇄ upstream conflict-surface paydown: M0 (catalogue) + M1 (seam refactors)

**Task:** `happy-upstream-conflict-surface-and-merge-strategy` (M0 + M1 only)
**Mode:** planning deliverable — read-only research performed; NO code edited, NO commit.
**Author:** impl/plan member. **Date:** 2026-07-02.
**Builds on:** `.ralph/investigations/happy-upstream-conflict-surface/{findings.md,summary.json}` (the ranked conflict heatmap + refactor recs). This plan turns that assessment's M0/M1 milestones into shippable, behavior-preserving stories.

---

## 1. Goal & framing

Shrink the merge-conflict surface between the fork's `packages/happy-*` and upstream `slopus/happy` so future **selective cherry-pick intake** (the only viable topology — see §2) is smoother, **without changing any current fork behavior**.

- **M0 — Baseline + `docs/happy-patch-surface.md` invariant catalogue.** Make the conflict surface explicit and navigable: inventory the strategically-significant fork inline edits to upstream-canonical happy files, each with a `// FORK PATCH:` marker, a one-line invariant, an enforcing test/guard where feasible, and a replant note. Mirror the discipline of `codex/docs/implementation/patch-surface.md` (§14 invariant-to-test table + §15 replant notes + `// SANDBOX PATCH:` markers) adapted for happy/TypeScript.
- **M1 — Relocate the highest-conflict inline edits into fork-EXCLUSIVE seams** so the upstream-canonical files return close to canonical and stop conflicting. Priority R1→R4 from the assessment (all **happy-server + happy-cli**; happy-app refactors are M2+ and out of scope here).

**Everything in M1 is a behavior-preserving relocation.** Each refactor moves fork logic out of an upstream-canonical file into a fork-owned module + a thin call-site seam, and proves identical observable behavior with tests. This is conflict-surface reduction, not a feature change.

### HARD CONSTRAINT — do NOT regress the shipped single-user public server

The single-user **public** happy-server (`options.auth === "public"`: fail-closed Ed25519 device-proof verifier, global default-deny `onRequest` hook, body-hash binding, `/pair/complete` TOFU device enrollment, Cloudflare Access edge, `CloudflareTunnelDaemonProvider`) has **shipped, is live, and was security-reviewed** (`packages/happy-server/AGENTS.md` → "Public-mode auth plane"; `packages/happy-cli/AGENTS.md` → "Cloudflare public tunnel"). M1's "restore upstream auth/E2E" means: keep upstream's auth/E2E **code paths present** (so they stop being delete/rewrite conflicts) and express the fork's single-user + public-verifier behavior as an **overlay/seam on top** — NOT deleting or weakening public-server security. Every M1 story touching the auth plane MUST keep the public-mode fail-closed guarantees intact and re-run these existing specs as acceptance gates:

| Gate | Spec file | What it proves |
|---|---|---|
| **US-005 route inventory (THE GATE)** | `packages/happy-server/sources/app/api/publicAuthGate.spec.ts` | Derives the route inventory from the **live Fastify app** (`onRoute` hook) and asserts EVERY registered route rejects an unauthenticated request with `401` and leaks no key material; a positive control (valid edge + device proof) proves the 401s are meaningful. |
| **US-005a body-hash** | `packages/happy-server/sources/app/api/auth/remoteDeviceAuth.spec.ts` + `publicAuthGate.spec.ts` | `preValidation` body-hash guard recomputes raw-body SHA-256 and rejects (`401`) on mismatch / uncaptured body. |
| **Device enrollment / TOFU** | `packages/happy-server/sources/app/api/deviceEnrollment.spec.ts` | `/pair/complete` pairing-window + secret + single-use nonce; TOFU-pins Ed25519 device key; conflicting key for a pinned id → `409`. |
| **Socket handshake fail-closed** | `packages/happy-server/sources/app/api/socket.spec.ts` | Public device-proof required on both websocket + polling transports; old fail-open tunnel branch stays closed; strict single-use nonce. |
| **Operator-identity bind gate** | `packages/happy-server/sources/index.spec.ts` + `dualListenerBinding.test.ts` | Public bind to a non-loopback host is refused without a verifier + edge expectation; tunnel bind to a public host is refused. |

---

## 2. Topology (why this is selective cherry-pick, not a rebase) — recap

From the assessment (`findings.md §1`, verified there, not re-litigated here): codexu's `packages/happy-*` is a **vendored, history-detached copy** with **NO git merge-base** with `slopus/happy` (upstream HEAD `f6adffb4` / release `cli-1.1.10` `71c417e1`). The standalone `Evyatar108/happy` clone is a true fork but **frozen at 2026-05-02** and lacks all codexu-era work. Therefore upstream intake must be **selective cherry-pick / manual port**, governed by a catalogue — not a DAG rebase (impossible) and not a single big-bang 3-way merge (**187 hard-conflict files**: happy-app 101, happy-cli 58, happy-server 23). M0+M1 are the first two milestones that shrink that 187 before the first intake (M2+).

---

## 3. Verified research (current fork state, file:line)

I re-verified the ranked hotspots against the live tree (they had drifted from the assessment's snapshot — the public-server work has since landed):

### 3a. happy-server auth plane (R1 target)
- `packages/happy-server/sources/app/api/api.ts:78` — `typed.decorate('authenticateTunnel', async function (_request: any) {});` — **no-op** tunnel authenticator (identity collapses to `tofuConfig.localUserId`).
- `api.ts:79` — `typed.decorate('authenticate', options.auth === "loopback" ? typed.verifyLoopbackCapability : typed.authenticateTunnel);` — fork-owned mode selection.
- `api.ts:84-121` — public-mode block: throws if `publicAuth` missing; installs `parseAs:'buffer'` content-type parser (captures `request.rawBody`), `onRequest` `publicAuthRuntime.httpGuard`, `preValidation` `publicAuthRuntime.bodyHashGuard`. **This is shipped public-server security — must be preserved verbatim in behavior.**
- `api.ts:49` — `auth?: "tunnel" | "loopback" | "public"` (the mode enum). `configureApi(app, tofuConfig, options)` is the fork's single entry.
- `packages/happy-server/sources/app/api/socket.ts:57-116` — `createSocketAuthMiddleware(tofuConfig, socketOptions)`: loopback capability-token branch (`:63-72`) + public device-proof fail-closed branch (`:80-98`, `runtime.verifySocketHandshake`).
- `packages/happy-server/sources/app/auth/auth.ts` — module-level auth (`auth.init()` / `auth.shutdown()`, imported at `index.ts:159`); this is where upstream's token verification (`verifyToken`) was collapsed. (Distinct from `app/api/auth/*`.)
- Fork-owned auth helpers already isolated under `packages/happy-server/sources/app/api/auth/`: `loopbackCapability.ts`, `remoteDeviceAuth.ts` (+ specs). **The overlay dir already exists** — R1 extends it, it does not invent it.

### 3b. happy-server operator-identity gate (R3 target)
- `packages/happy-server/sources/index.ts:101-135` — `assertOperatorIdentityGate(config)` (public-vs-tunnel bind-host gate). `index.ts:87-99` — `LOOPBACK_HOSTS` + `isLoopbackHost`. Called once at `index.ts:138` inside `createApp`. index.ts is 217 lines and is substantially fork-owned (the whole embedded `createApp`/`createHappyServer`/`bootstrapMachineForEmbedded` bootstrap), so R3's win is moderate but clean.

### 3c. happy-server session-message label (R2 server half)
- `packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts:166-169` — writes `content: { t: 'encrypted', c: message.content }` where `message.content` is the client-supplied string. The server does no crypto; the `t:'encrypted'` label is **honest only if the client actually encrypted**. Today the CLI client sends plaintext (see 3d), so the label is a **mislabel**.

### 3d. happy-cli E2E asymmetry (R2 target) — the subtle one
`packages/happy-cli/src/api/apiSession.ts`:
- `:5` — `import { decodeBase64, decrypt, encodeBase64, encrypt } from './encryption';` (`encrypt`/`decrypt` are **real crypto** — tweetnacl secretbox / AES-256-GCM in `src/api/encryption.ts`; NOT identity pass-throughs).
- `:659` — **send** path `enqueueMessageWithDelivery`: `const encrypted = JSON.stringify(content);` → outbox → stored server-side as `{t:'encrypted', c:<plaintext-json>}`. **`encrypt()` is NOT called at send.**
- `:316` — **live-socket receive**: `const body = JSON.parse(data.body.message.content.c);` — plaintext parse (consistent with plaintext send).
- `:575` — **fetched-message receive** (reconnect catch-up): `const body = decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(message.content.c));` inside a try/catch that logs `"Failed to decrypt fetched message"` and skips. Against plaintext-sent messages this `decrypt()` returns `null`/throws → **the catch-up path silently drops fork-sent messages.** This is a latent bug AND the exact conflict/divergence R2 addresses.
- `:342`, `:1039` — `agentState` fields DO round-trip through `decrypt()`. So the file mixes encrypted (agentState) and plaintext (message bodies), which is why upstream's uniform `encrypt()/decrypt()` shape conflicts.

**Consequence for R2:** literally "re-activating encryption on message bodies" is a **behavior + data-format change** (at-rest bytes flip plaintext→ciphertext; old plaintext won't decrypt; single-user cross-device key distribution must be verified). That is NOT behavior-preserving and is therefore **out of M1** (see §5 R2 and §9 open questions). M1's behavior-preserving move is to route all four sites through one fork-owned codec seam that reproduces **today's exact bytes**, shrinking the `apiSession.ts` diff without changing the wire/at-rest format.

### 3e. happy-cli codex/daemon wiring (R4 target)
- Inline fork blocks in `packages/happy-cli/src/codex/runCodex.ts`, `src/claude/runClaude.ts`, `src/daemon/run.ts`, `src/api/apiMachine.ts` on upstream-hot files. Fork-exclusive overlay dirs already exist and carry the feature bodies: `src/codex/` (41 files), `src/daemon/` (30 net-new), `src/agentComms/` (33), `src/tunnel/` (13). happy-cli AGENTS.md already states "Keep `run.ts` as dependency wiring only" for agent-comms — R4 generalizes that discipline to the codex/claude/machine wiring.

### 3f. Baseline / infra facts
- No `docs/happy-patch-surface.md` exists yet. No `.gitattributes` at repo root or in `packages/happy-app/`.
- codexu remotes: `origin=evmitran_microsoft/codexu`, `personal=Evyatar108/codexu`. Upstream `slopus/happy` is NOT a remote; the mirror clone is `D:/harness-efforts/happy` (remote `origin=slopus/happy`).

---

## 4. M0 — Baseline + `docs/happy-patch-surface.md` catalogue

### 4.1 Deliverable: `docs/happy-patch-surface.md` (repo-root docs, new)

Mirrors the codex model. Structure:

1. **Header** — last-updated; import-baseline SHA (pinned in M0-S2); upstream anchor (`cli-1.1.10` / `71c417e1`); a one-paragraph "how to use during intake."
2. **Marker convention** (the agreed marker) — see 4.2.
3. **Buckets** (the organizing idea, adapted from codex's ledger):
   - **KEEP** — intentional fork inline edits on upstream-canonical files that must survive every intake (e.g. api.ts auth-mode wiring, socket handshake, e-ink branches, codex/daemon wiring). Each is a candidate for M1+ seam-extraction.
   - **KEEP-DELETED** — upstream code the fork intentionally removed and must protect from re-introduction on merge (e.g. `prisma/schema.prisma` multi-tenant `userId` scoping; the routes deleted in Sprint E: artifact/feed/voice/key-value/access-key/user-friends/usage/machine-directory; the retired `/pair/start`+`/pair/status` device flow). Deletions have no line to mark → guarded by a "must NOT exist / must NOT be registered" test.
   - **RESTORE** — divergences the fork WANTS to bring back toward upstream shape to shrink conflict (the M1 targets: R1 auth wiring, R2 E2E codec shape, R3 identity-gate extraction, R4 wiring hooks). Once relocated behind a seam, the entry moves KEEP→RESTORE-done.
4. **Invariant-to-guard table** (the §14 analog) — columns: `# | file:symbol (line hint) | bucket | one-line invariant | marker present? | enforcing test/guard | replant note`. **Anchor each row on a stable symbol/function + its `// FORK PATCH:` marker, with the line number only as a hint** — line numbers drift as edits land and across intakes; the marker + symbol are the durable anchor (this is how codex's `patch-surface.md` survives rebases).
5. **Per-surface replant notes** (the §15 analog) — for each hotspot: what the fork changed, why, and the exact re-apply recipe for the next intake (e.g. "on `api.ts` intake: upstream re-emits `enableAuthentication(typed)`; re-route the `authenticate` decorator through `installForkAuthPlane(...)` instead — see M1-S2").
6. **`.gitattributes` policy** (from M0-S3) + **baseline record** (from M0-S2) + **ownership & cadence** (named owner; per-release or 4-weekly).

### 4.2 Marker convention (chosen)

**`// FORK PATCH:`** — parallel to codex's `// SANDBOX PATCH:`. Placed on the edited line(s) of an intentional, must-survive upstream-canonical hunk, with a short reason, e.g.:

```ts
// FORK PATCH: [KEEP] single-user tunnel authenticator is a no-op; identity collapses
// to tofuConfig.localUserId (embedded per-daemon server, one user per process). See
// docs/happy-patch-surface.md invariant HS-1.
typed.decorate('authenticateTunnel', async function (_request: any) {});
```

JSX/TSX-region variant: `{/* FORK PATCH: ... */}`. Prisma uses `//`. Each marker cites its catalogue invariant id (`HS-<n>` for happy-server, `HC-<n>` happy-cli, `HA-<n>` happy-app).

**Scope discipline (important, and an explicit design decision):** a `// FORK PATCH:` comment *itself adds a line of diff vs upstream* — so markers are **reserved for intentional, must-survive divergences**, NOT for the ~359 mechanically-modified files (import reorders, incidental formatting). Marking all 359 would (a) be a multi-week churn job and (b) enlarge the very diffs we're trying to keep small. This matches the codex model (it catalogues ~75 intentional patch families, not every changed line). M0 therefore fully catalogues + marks the **strategically-significant surface** (the ranked hotspots + the auth/E2E/single-tenant/route surface + the KEEP-DELETED protections) and documents a **long-tail intake process**: the catalogue grows incrementally at each intake (M2+), exactly as codex's grows per rebase.

### 4.3 Enforcing guard (advisory audit)

A small Node script `scripts/audit-happy-fork-patches.mjs` that (1) greps the happy-* trees for `// FORK PATCH:` markers, (2) cross-checks each against a catalogue row (marker↔invariant-id consistency), and (3) reports drift (marker without a row, or a row whose cited file:line no longer contains the marker). Advisory (non-failing) in M0; can be promoted to a CI gate later. This is the happy analog of codex's `scripts/audit_invariants.sh` marker check.

### 4.4 `.gitattributes` (M0-S3)

- `packages/happy-app/sources/text/** merge=union` — collapses the ~10 recurring mechanical translation conflicts (verify the i18n loader tolerates duplicate keys first; if not, prefer a separate fork-namespace strings file — open question).
- `**/dist/** merge=ours` (or gitignore tracked `dist/`) + lockfiles `merge=ours` — removes generated-artifact conflict noise (happy-wire/happy-agent tracked `dist/`).
- Document each rule + rationale in the catalogue.

### 4.5 Baseline record (M0-S2)

Pin codexu's import-baseline commit by **tree-matching a stable upstream file** (the ~2026-05-03 / `cli-1.1.8`-era state is currently only inferred). Add `slopus/happy` as a codexu remote (read-only) OR formally designate `D:/harness-efforts/happy` as the upstream mirror, and record the pinned baseline SHA + the anchor release tag in the catalogue so per-file 3-way `git checkout -p` / cherry-pick becomes possible at intake time.

---

## 5. M1 — Seam refactors (behavior-preserving), per hotspot

General pattern for every M1 story: **(inline fork logic in upstream-canonical file) → (fork-owned module body) + (1–3 line call-site seam)**, with before/after tests proving identical observable behavior, and a catalogue row + `// FORK PATCH:` marker on the remaining thin seam.

### R3 (do first — smallest, establishes the `fork/` dir pattern) — extract operator-identity gate
- **From:** `packages/happy-server/sources/index.ts:87-135` (`LOOPBACK_HOSTS`, `isLoopbackHost`, `assertOperatorIdentityGate`).
- **To:** new fork-owned `packages/happy-server/sources/fork/operatorIdentityGate.ts` exporting `assertOperatorIdentityGate` (+ `isLoopbackHost`). `index.ts` keeps `import { assertOperatorIdentityGate } from "./fork/operatorIdentityGate";` and the single `assertOperatorIdentityGate(config);` call at `createApp`. Pure move.
- **Behavior-preserving proof:** the throw/no-throw matrix is unchanged — reuse/extend `index.spec.ts` + `dualListenerBinding.test.ts` (public-bound-to-public with/without verifier+edge → throw; tunnel-bound-to-public → throw; loopback/tunnel-on-loopback → ok).
- **Complexity:** S. **Package:** happy-server.

### R1 — restore upstream auth shape; fork single-user + public as overlay
Two stories (api half + socket half) so each is independently shippable and each keeps its own acceptance gate green.

- **R1a (`api.ts`).** **Preflight (first sub-step):** fetch upstream's actual `enableAuthentication.ts` (or its current equivalent) from the M0-S2 mirror and confirm its real shape/location before designing the restore — do NOT assume the assessment's snapshot; verify it registers no global hook/decorator that would run (and interfere) in the fork's tunnel/loopback/public modes. Then relocate the fork's auth-decorator wiring — `authenticateTunnel` no-op, `authenticate` mode-selection, and the entire public-mode block (`parseAs:'buffer'` parser + `httpGuard` + `bodyHashGuard` install) — out of `configureApi`'s inline body into a fork-owned `packages/happy-server/sources/app/api/auth/forkAuthPlane.ts` exporting a single `installForkAuthPlane(fastifyApp, typed, tofuConfig, options)`. `api.ts` shrinks to `installForkAuthPlane(fastifyApp, typed, tofuConfig, options);` (a 1-line seam), returning its auth region toward upstream shape. **Restore upstream `enableAuthentication.ts` as present-but-overlaid** (catalogue RESTORE): re-add upstream's file unmodified so it stops being a delete/rewrite conflict, but the fork's runtime path routes through `installForkAuthPlane` — upstream's multi-tenant bearer verifier is present-but-dormant (single-user, one-process posture per happy-server AGENTS.md; do NOT reintroduce per-request `userId` threading). **If the preflight shows upstream's file registers an active global hook, keep it KEEP-DELETED instead of restoring it** (accept the delete-conflict) rather than risk an interfering dormant path — decide at R1a time.
  - **Behavior-preserving proof + HARD gate:** re-run `publicAuthGate.spec.ts` (US-005), `remoteDeviceAuth.spec.ts` (US-005a body-hash), `deviceEnrollment.spec.ts`, `corsAllowed.test.ts`. Add golden auth-decision tests (tunnel→no-op collapse; loopback→capability check; public→fail-closed) asserting identical accept/reject vs pre-refactor. **The public-mode fail-closed hooks must install in the same order (`onRequest` before route registration; `preValidation` body-hash) — verified by US-005.**
  - **Complexity:** M. **Package:** happy-server.

- **R1b (`socket.ts`).** Relocate the `createSocketAuthMiddleware` loopback + public branch bodies into `auth/` helpers (extend the existing `loopbackCapability.ts` / `remoteDeviceAuth.ts`), leaving `socket.ts` a thin dispatcher. Shrinks socket.ts's inline auth footprint.
  - **Behavior-preserving proof + HARD gate:** re-run `socket.spec.ts` (public device-proof on ws + polling; strict single-use nonce; fail-open tunnel branch stays closed).
  - **Complexity:** M. **Package:** happy-server. **Depends on:** R1a (shared `forkAuthPlane`/helper module shape).

### R2 — session-payload codec seam (behavior-preserving relocation ONLY)
- **From:** `apiSession.ts:659` (send `JSON.stringify`), `:316` (live-receive `JSON.parse`), `:575` (fetch-receive `decrypt`), and the `v3SessionRoutes.ts:166-169` `{t:'encrypted'}` label.
- **To:** a fork-owned `packages/happy-cli/src/api/sessionPayloadCodec.ts` exporting `encodeOutgoing(content)` and `decodeIncoming(raw, { source })`. **These reproduce TODAY'S EXACT BYTES:** `encodeOutgoing = JSON.stringify` (plaintext), `decodeIncoming(live) = JSON.parse`, `decodeIncoming(fetch) = decrypt(...)` (preserving the current asymmetry verbatim). Route the three `apiSession.ts` sites through the codec so the call-site *shape* matches upstream's `encrypt()/decrypt()` positions, shrinking the diff, **without changing the wire/at-rest format**. On the server, add an honest `// FORK PATCH:` marker on the `v3SessionRoutes.ts` `{t:'encrypted'}` label documenting that the server stores client bytes verbatim and does no crypto (catalogue KEEP-DELETED for server-side crypto).
  - **Behavior-preserving proof:** round-trip golden tests asserting `encodeOutgoing`/`decodeIncoming` produce byte-identical output to the current inline code for both the plaintext-live and decrypt-fetch paths; a regression test pinning that the send path emits plaintext (documenting the current contract) so a future E2E flip is a deliberate, reviewed change. **No data-format change.**
  - **Explicitly NOT in R2/M1:** actually re-enabling E2E encryption on message bodies (the `encrypt()`-at-send flip). That is behavior + at-rest-format changing (old plaintext won't decrypt; needs a single-user cross-device key-distribution + migration design). Deferred — see §9 open questions. R2 as scoped keeps the fetch-path latent-bug behavior *exactly as-is* (relocated, documented) rather than silently "fixing" it, because fixing it changes observable behavior.
  - **Complexity:** M. **Packages:** happy-cli (primary) + happy-server (label marker only).

### R4 — codex/daemon wiring → `forkHooks.onXxx()` (split into smallest safe stages)
- **From:** inline fork blocks in `runCodex.ts`, `runClaude.ts`, `daemon/run.ts`, `apiMachine.ts`.
- **To:** a fork-owned `packages/happy-cli/src/fork/forkHooks.ts` exposing `onDaemonRun(...)`, `onCodexRun(...)`, `onClaudeRun(...)`, `onMachineRpc(...)` whose bodies delegate to the already-isolated `src/codex/` / `src/daemon/` overlays. Each upstream-hot file calls one hook instead of carrying the inline block.
- **Staged (each independently shippable, behavior-preserving, any order):**
  - **R4a** `daemon/run.ts` → `onDaemonRun` (largest wiring surface; happy-cli AGENTS.md already wants run.ts to be wiring-only).
  - **R4b** `runCodex.ts` → `onCodexRun`.
  - **R4c** `runClaude.ts` → `onClaudeRun` + `apiMachine.ts` → `onMachineRpc` (grouped; smaller edits).
- **Behavior-preserving proof:** wiring tests asserting the hook is invoked with the same arguments and the same side-effects as the inline block; the existing codex/claude integration tests (`src/codex/codex.integration.test.ts`, `src/claude/claude.integration.test.ts`, gated behind `RUN_INTEGRATION=1`) stay green. **Do not** change the fork-exclusive overlay bodies — only move the call boundary.
- **Complexity:** M per stage. **Package:** happy-cli.

---

## 6. Scope

**IN (M0):** `docs/happy-patch-surface.md` skeleton + marker convention + buckets + invariant table; baseline pin + upstream mirror/remote; `.gitattributes`; advisory marker-audit script; full catalogue + `// FORK PATCH:` markers on the **strategically-significant surface** (happy-server auth/E2E/single-tenant/route surface + happy-cli E2E/wiring hotspots); doc-only inventory of happy-app hotspots + fork-exclusive zero-conflict dirs + generated-artifact surface.

**IN (M1):** R3 (identity-gate extraction), R1a/R1b (auth wiring → seam, upstream auth restored-as-overlay), R2 (payload-codec seam, behavior-preserving relocation only), R4a/R4b/R4c (wiring → forkHooks). All happy-server + happy-cli, all behavior-preserving.

**OUT (deferred to M2+ / separate tasks):**
- Any happy-app refactor (R5 e-ink hooks, R6 translation namespace, R8 sync/reducer residual) — M0 only *inventories* happy-app; no app source edits.
- The first actual upstream **intake** (cherry-pick/port) — that is M2+.
- **Re-enabling real E2E encryption** on message bodies (behavior + data-format change) — explicitly deferred (see §9).
- Exhaustively marking all 359 inline-modified files — replaced by the long-tail per-intake process.
- prisma `schema.prisma` overlay — not overlay-able (single file); KEEP-DELETED catalogue entry + guard only.

---

## 7. Risk areas

1. **Regressing the public server (highest).** R1a/R1b/R3 touch the auth/bind plane. Mitigation: every such story re-runs the five HARD gates in §1 (US-005 route inventory, US-005a body-hash, device enrollment, socket handshake, operator-identity bind gate) and adds golden accept/reject tests; the public-mode `onRequest`/`preValidation` hook install order must be preserved (US-005 verifies default-deny). No story may weaken fail-closed behavior or reintroduce per-request `userId` threading (happy-server AGENTS.md hard rule).
2. **Silently changing E2E behavior (R2).** Mitigation: R2 is a *pure relocation* that preserves today's exact bytes (plaintext send, asymmetric fetch-decrypt); the real-encryption flip is out of scope with an explicit open question + a regression test pinning the current plaintext-send contract.
3. **Behavior drift in a "pure" relocation.** Mitigation: before/after golden tests for each refactor; no overlay-body edits in R4 (only the call boundary moves).
4. **Import-baseline imprecision.** Mitigation: M0-S2 pins the baseline by tree-matching a stable file rather than trusting the inferred date.
5. **`.gitattributes merge=union` duplicate translation keys.** Mitigation: verify the i18n loader dedupes before enabling; else fall back to a fork-namespace strings file (open question).
6. **Marker churn irony** (markers add diff to files we want close to upstream). Mitigation: reserve markers for intentional must-survive hunks; long-tail catalogued in aggregate.
7. **Catalogue rot.** Mitigation: named owner + cadence recorded in the doc; advisory audit script flags marker/row drift.

---

## 8. Acceptance criteria

**M0:**
- `docs/happy-patch-surface.md` exists with: marker convention (`// FORK PATCH:` + JSX/Prisma variants), the three buckets (KEEP / KEEP-DELETED / RESTORE), the invariant-to-guard table populated for the strategically-significant surface, per-surface replant notes, the pinned import-baseline SHA + upstream anchor, the `.gitattributes` policy, and an ownership+cadence line.
- `// FORK PATCH:` markers present on: `api.ts` auth wiring, `socket.ts` handshake branches, `v3SessionRoutes.ts` label, `index.ts` identity gate, and the happy-cli send/receive/wiring hotspots — each citing its catalogue invariant id.
- KEEP-DELETED entries for schema.prisma multi-tenant collapse + the Sprint E route deletions, each with a "must-not-be-registered/exist" guard reference.
- `.gitattributes` added (translations `merge=union`, tracked `dist/` + lockfiles `merge=ours`).
- `scripts/audit-happy-fork-patches.mjs` runs, reports zero drift on the catalogued set.
- Baseline pinned + upstream mirror/remote recorded.

**M1 (per story):** the upstream-canonical file's fork footprint is reduced to a thin seam; the fork logic lives in a fork-owned module; behavior is proven identical by before/after tests; **and, for any auth-plane story, all five HARD gates in §1 pass unchanged.** R2 additionally proves byte-identical wire/at-rest output and does NOT change the message format.

---

## 9. Open questions (surface to operator)

1. **Auth/E2E-overlay design tension (the central one).** R2 "re-activate encrypt()/decrypt()" as literally worded is behavior-changing (plaintext→ciphertext at rest; old messages undecryptable; single-user cross-device key distribution unverified). This plan scopes R2 as a **behavior-preserving codec relocation** and defers real E2E re-enablement to a separate, explicitly behavior-changing milestone with a migration + key-distribution design. **Confirm this split** — or, if the operator wants real E2E now, R2 becomes a larger data-migration story (not a pure relocation) with its own rollout/back-compat plan and its own risk profile.
2. **R1 "restore upstream `enableAuthentication` verbatim"** — do we actually re-add upstream's (present-but-dormant) bearer verifier file to reduce delete-conflict, accepting a dead code path in a single-user server? Or catalogue it KEEP-DELETED and accept the delete-conflict at intake? This plan assumes present-but-overlaid (RESTORE); confirm.
3. **The fetch-path latent bug** (`apiSession.ts:575` decrypt-on-plaintext silently drops catch-up messages): R2 preserves it exactly (it's out of a behavior-preserving refactor's remit to fix). Should a *separate* bug-fix task address it? (It may be masked today by the live-socket path being primary.)
4. **`.gitattributes merge=union` on translations** — does the i18n loader dedupe duplicate keys, or do we need a fork-namespace strings file instead?
5. **Import-baseline SHA** — needs tree-match pinning in M0-S2 (currently inferred).
6. **Catalogue ownership** — who runs per-intake catalogue maintenance + the cadence? Without a named owner the catalogue rots.
7. **happy-cli `src/codex/*` proximity to upstream-active files** — if upstream ships its own codex/ACP work, R4 hook-extraction gets more urgent; monitor.

---

## 10. Build / test plan per package

**happy-server** (4-space tabs, `.spec.ts`/`.test.ts`, pnpm):
- Typecheck: `pnpm --filter happy-server build` (tsc).
- Targeted tests (fast, the ones that matter for M1): `pnpm --filter happy-server exec vitest run sources/app/api/publicAuthGate.spec.ts sources/app/api/auth/remoteDeviceAuth.spec.ts sources/app/api/deviceEnrollment.spec.ts sources/app/api/socket.spec.ts sources/index.spec.ts sources/dualListenerBinding.test.ts sources/app/api/routes/v3SessionRoutes.test.ts`.
- Full suite before ship: `pnpm --filter happy-server test`.

**happy-cli** (pnpm; Windows/Git Bash quirk):
- File-scoped: `pnpm --filter happy exec vitest run src/api/sessionPayloadCodec.test.ts src/api/apiSession.test.ts` (+ forkHooks wiring tests).
- Package suite: `npm_config_script_shell=bash pnpm --filter happy test` (deterministic unit project; integration projects need `RUN_INTEGRATION=1` + prerequisites).
- R4 integration sanity (optional, gated): `RUN_INTEGRATION=1 RUN_CODEX_INTEGRATION=1 ...` for codex/claude integration files.

**happy-app:** no source edits in M0/M1. M0 doc-inventory only; no build/test needed beyond the existing typecheck if the `.gitattributes`/translation-namespace question is exercised.

**Repo-level:** `node scripts/audit-happy-fork-patches.mjs` (advisory) after M0.

Capture long/expensive suite output to a file once, then grep it (per fork AGENTS.md), rather than re-running.
