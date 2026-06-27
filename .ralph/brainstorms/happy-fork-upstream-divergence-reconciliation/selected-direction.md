---
overviewTaskId: happy-fork-upstream-divergence-reconciliation
---

## Direction
D-002 — Restore upstream auth + E2E first (single-user-collapsed) as the reconciliation wedge.
Re-add the deleted bearer-token auth plane and E2E session-body encryption in an upstream-aligned,
single-operator-identity shape — gated by a default-off spike — so the same body of work
simultaneously (a) becomes the safe public-exposure boundary for the held
`remote-connectivity-single-user-public-evyatar-server` task and (b) is the first
divergence-reduction increment that de-risks the hottest merge-hostile files. This is the
recommended FIRST move inside the broader D-001 upstream-tracking strategy (see Context).

> All three lenses converged on this as the operator's stated and highest-leverage first step; the
> Devil's Advocate's caveat (the cheapest pure-exposure path is an edge with zero divergence
> reduction) is captured as the explicit fallback gate below.

## Goal
The codexu happy fork's per-daemon happy-server enforces a **fail-closed, single-operator
cryptographic auth boundary** on every tunnel-reachable surface (REST routes, Socket.IO websocket +
polling, and the pairing endpoint), and session message bodies are **end-to-end encrypted** again
(no plaintext at the server) — implemented by **re-importing upstream's auth plane + E2E in an
upstream-aligned shape collapsed to one operator identity**, behind a default-off flag, WITHOUT
breaking codex app-server streaming/replay, BOOX pairing, or reintroducing multi-tenant `userId`
scoping. Passing this also unblocks safe public exposure for the held public-server task.

## Scope
### In Scope
- A **go/no-go spike (default-off flag)** proving the approach on a minimal slice: a single-operator
  token gate on ONE protected REST route + the Socket.IO handshake, and `encrypt()`/`decrypt()` for
  ONE v3 session-message round-trip. Acceptance: unauthenticated `curl` denied; one CLI send/receive
  succeeds; one app reconnect succeeds; a codex stream is unaffected.
- Re-importing upstream `enableAuthentication.ts` + `verifyToken` (from `slopus/happy`
  `packages/happy-server`) collapsed to the single `tofuConfig.localUserId` operator identity; making
  `authenticateTunnel` fail-closed; restoring the fail-closed Socket.IO handshake (websocket AND
  polling).
- Restoring an authenticated pairing path in place of the unauthenticated `/pair/complete`
  self-enrollment.
- Re-wiring CLI `encrypt()` at the session send site (`apiSession.ts`) + symmetric `decrypt()`, keyed
  by the existing single operator keypair, reusing `packages/happy-agent/src/encryption.ts` /
  `session.ts`; the server stops mislabeling plaintext as `{t:'encrypted'}` (`v3SessionRoutes.ts`).
- Recording each restored surface as an entry in a new `docs/happy-patch-surface.md` invariant
  catalogue (KEEP vs KEEP-DELETED), so future upstream intakes know what to preserve.

### Out of Scope
- Restoring multi-tenant per-user `userId` data scoping (intentional single-tenant simplification —
  KEEP-DELETED; collapse to one identity instead).
- Re-adding the Sprint-E-deleted route modules (artifact, feed, voice, key-value, access-key,
  user/friends, usage, machine-directory).
- The full upstream-tracking cadence + subtree-baseline mechanics (that is D-001, a parallel/follow-on
  track — see Context); this seed only stands up the catalogue file, not the recurring intake.
- The actual public DNS/tunnel exposure on evyatar.dev (that is the held public-server task, which
  consumes this boundary).

## Criteria
- An unauthenticated request to any tunnel-reachable REST route, Socket.IO upgrade (websocket), and
  Socket.IO polling fallback is **rejected** when the flag is enabled; an authenticated single-operator
  request succeeds.
- A v3 session message posted by the CLI is stored as **ciphertext** at the server (not plaintext) and
  round-trips through `decrypt()` on receive; a server-side read of the row does not reveal cleartext.
- `/pair/complete` no longer hands out server key material to an unauthenticated caller.
- With the flag enabled, a codex app-server session streams end-to-end and a BOOX app pairs +
  reconnects successfully (no regression vs flag-off).
- The spike's go/no-go result is recorded; **if the spike fails** (needs multi-tenant `accountId`
  re-threading, breaks codex streaming, or can't gate both websocket and polling), the work pivots to
  the **edge-auth fallback (D-004)** for the public-exposure boundary and E2E is split into its own
  increment — this branch is documented, not silently dropped.
- `docs/happy-patch-surface.md` exists and records the restored auth/E2E surfaces plus the
  KEEP-DELETED single-tenant simplifications.

## Context
**Why this direction (synthesis highlights).** Source + `gh` verification reframed the premise:
upstream `slopus/happy` is an **active monorepo** (pushed 2026-06-27, 22k stars) with the **same
package set** as codexu and still maintains the deleted `enableAuthentication.ts` (its headline
feature list includes "encryption"). The fork deleted the auth plane (`enableAuthentication.ts`,
`auth.ts` `verifyToken`, fail-open socket; commits `25b9a573`/`48e16356`/`5c1b3953`) and dropped E2E
session bodies (`apiSession.ts:659` no `encrypt()`; `v3SessionRoutes.ts:166-168` cosmetic
`{t:'encrypted'}` label) — see `.ralph/investigations/happy-server-auth-fork-vs-upstream/findings.md`
for file:line. Restoring both in upstream-aligned single-user shape brings the **hottest
merge-hostile files** (`api.ts`, `socket.ts`, `auth.ts`, `pairRoutes.ts`, `v3SessionRoutes.ts`,
`apiSession.ts`) back toward vanilla, which is why it is the first divergence-reduction increment.

**Relation to the broader merge strategy (D-001).** There is **no git-DAG merge base** (codexu
bulk-imported happy at commit `7f178466`, 1163 files, no shared slopus ancestry), so ongoing upstream
sync must use a **subtree/baseline-replay** mechanism, not a codex-style DAG rebase. The full D-001
process (add the `slopus/happy` remote, establish the import baseline, produce a per-package conflict
heatmap, run a periodic per-release intake prioritizing `happy-app`) should run in parallel/after this
wedge; this seed only establishes the `docs/happy-patch-surface.md` catalogue that D-001 will grow.
The codex-fork analogy transfers its *discipline* (invariant catalogue + cadence) but NOT its
assumption that fork code can be isolated into separate overlay files — happy's divergence is inline
on shared deployment-model surfaces.

**Disconfirming observations to watch.** (1) If the spike needs broad multi-tenant `accountId`
re-threading or breaks codex streaming/replay, the in-app restore is not cheap → pivot to edge-auth
(D-004) for the boundary. (2) The cheapest path to *pure* safe public exposure is a Cloudflare
Access / mTLS edge with zero happy-server change — but it leaves the auth-plane divergence in place
forever, so it does not serve the operator's mergeability goal; it is the fallback, not the primary
plan.

**Keep-vs-restore quick reference** (full audit in `brainstorm-synthesis.md`): KEEP = embedded
single-user-per-daemon model, codex app-server + streaming, agent-comms fail-closed ingest, e-ink UX,
`codexu-plugin`/`codexu-options-mode-plugin`. RESTORE = bearer-token auth plane, E2E session bodies,
authenticated pairing. KEEP-DELETED = multi-tenant `userId` scoping + Sprint-E route modules.
