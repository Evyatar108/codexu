Lenses: ran=[devils-advocate, codex, copilot]; skipped=[] (full mode)

# Brainstorm synthesis — happy-fork-upstream-divergence-reconciliation

**Question:** Recommend a divergence-management strategy so the **codexu** happy fork can keep
merging upstream **slopus/happy** changes (the way the codex fork does its upstream-sync) while
retaining genuinely-unique fork value — triggered by the discovery that the fork deleted upstream's
bearer-token auth plane and dropped E2E session-body encryption.

All three lenses (Codex feasibility, Copilot product-reality, Devil's-Advocate) plus a source +
GitHub verification pass converged on the **same three core strategies** (restore-auth+E2E wedge /
current-tree patch-surface cadence / re-fork-as-seams), and the Devil's Advocate added a decisive
reframe (the two goals are separable; the codex-overlay analogy is a category error).

---

## Executive recommendation (one line)

**Restore upstream auth + E2E in an upstream-aligned single-user shape (D-002) as the FIRST
patch-surface-tracked reconciliation increment — gated by a default-off spike — which simultaneously
unblocks the held public-server task AND de-risks the hottest merge-hostile files; stand up a happy
`patch-surface.md` invariant catalogue + subtree-baseline upstream cadence (D-001) around it; treat
re-fork (D-003) as a last resort and decline it by default.**

---

## What the verification changed about the premise (read this first)

Several premises in the seed were sharpened or corrected by source + `gh` verification:

1. **Upstream is an ACTIVE monorepo with the SAME package set as codexu.** `slopus/happy` (pushed
   2026-06-27, 22,246 stars, `packages/` + `Dockerfile.server` + `Dockerfile.webapp` +
   `pnpm-workspace.yaml`) contains exactly: `codium, happy-agent, happy-app-logs, happy-app,
   happy-cli, happy-server, happy-wire`. codexu has the same set **plus** only `codexu-plugin` and
   `codexu-options-mode-plugin`. **Correction:** `happy-wire`/`happy-agent`/`codium`/`happy-app-logs`
   are UPSTREAM packages, **not fork-added**. Fork value is in *modifications to shared packages*, not
   in new packages. (The deprecated standalone `slopus/happy-server` + `slopus/happy-cli` repos are
   frozen at 2026-02-14; the live upstream happy-server lives inside the monorepo.)
2. **Upstream still maintains the deleted code.** `slopus/happy/.../enableAuthentication.ts` still
   exists upstream, and upstream's own headline description is *"…with realtime voice, encryption and
   fully featured."* So the fork's auth/E2E deletions diverge from **live, actively-developed**
   upstream value — not from a dead branch.
3. **There is NO git-DAG merge base.** codexu bulk-imported happy (commit `7f178466` "fix: fix
   monorepo", **1163 files in one commit**, parent is a codexu commit). codexu's earliest SHA is not
   in slopus history. So `git merge-base` is empty *even though the trees are structurally identical*.
   A sibling **`Evyatar108/happy` IS a true fork of `slopus/happy`** (`fork:true`, parent
   `slopus/happy`) and retains ancestry — but codexu's vendored copy does not. **Implication:** the
   merge mechanism must be **subtree/baseline-replay**, not DAG rebase. This is the unscoped
   prerequisite the Devil's Advocate flagged.
4. **The codex-fork analogy is only partially transferable (category error).** codex stays mergeable
   because its fork code lives in *additive overlay crates* (`codex-rs-overlay/codex-happy`) and the
   inline edits are a small numbered `patch-surface.md` invariant set. The happy fork did the
   OPPOSITE — *inline deletion/rewrite* of the exact hot files (`api.ts`, `socket.ts`, `auth.ts`,
   `pairRoutes.ts`, `v3SessionRoutes.ts`, `index.ts`, `apiSession.ts`) that upstream keeps changing,
   because its core value (multi-tenant → single-user embedded) is a *deployment-model* change to
   shared surfaces, not an additive feature. Adopt codex's *discipline* (invariant catalogue +
   cadence), not its assumption that fork code can be isolated into separate files.

---

## Keep-vs-Restore divergence audit (three buckets, not two)

The binary "KEEP vs RESTORE" the seed asked for needs a **third bucket** — intentional deletions the
catalogue must protect from re-merge. All claims source-verified (see
`.ralph/investigations/happy-server-auth-fork-vs-upstream/findings.md` for file:line).

### (A) KEEP — fork-unique value (retain; document as intentional divergence)
- **Embedded single-user-per-daemon happy-server** (`createHappyServer()` + `dualListenerBinding.ts`;
  `packages/happy-server/AGENTS.md` "Architecture posture"). Operator-blessed, load-bearing for codex
  autoconnect (`remote_session` → `127.0.0.1:<tunnelPort>`).
- **codex app-server support + message-streaming improvements** (operator-named keepers).
- **codex/agent-comms integration** — incl. the genuinely fail-closed `/agent-comms/ingest` handler
  (pinned-peer + Ed25519 sig + ECDH unseal + spawn-approval, `ingestHandler.ts:31-67`).
- **e-ink/BOOX tablet UX** in happy-app (opt-in, default-off toggles per fork AGENTS.md).
- **Typed context-boundary wire events** (fork usage of the upstream `happy-wire` envelopes).
- **`codexu-plugin` + `codexu-options-mode-plugin`** — the only genuinely net-new top-level packages.

### (B) RESTORE — divergence-debt (re-add, in upstream-aligned single-user shape)
- **Bearer-token auth plane** — `enableAuthentication.ts` (deleted; upstream-active), `auth.ts`
  `verifyToken`/`verifier` (deleted), fail-closed socket handshake (fork is fail-open in tunnel mode,
  `socket.ts:61-95`). Commits `25b9a573`, `48e16356`, `5c1b3953`.
- **E2E session-body encryption** — CLI `encrypt()` at send (`apiSession.ts:659`, currently absent)
  + symmetric `decrypt()`; server stops mislabeling plaintext as `{t:'encrypted'}`
  (`v3SessionRoutes.ts:166-168`). **Reusable code exists in `packages/happy-agent/src/encryption.ts`
  + `session.ts`** (verified) — lowers the restore cost.
- **Unauthenticated `/pair/complete` self-enrollment** (`pairRoutes.ts:59-119`) — replace with an
  authenticated pairing bound to the single operator identity.

### (C) KEEP-DELETED — intentional single-tenant simplification (do NOT restore; protect from re-merge)
- **Multi-tenant per-user `userId` data scoping** (`25b9a573`). The single-user model intentionally
  collapses this. Auth must be restored **collapsed to one operator identity**, NOT as full
  multi-tenancy. This is the crux of the feasibility question below.
- **Deleted route modules** (artifact, feed, voice, key-value, access-key, user/friends, usage,
  machine-directory — Sprint E). Mostly intentional; the catalogue must record them so an upstream
  intake does not silently resurrect them.

The patch-surface catalogue's job is to make bucket (A) and bucket (C) *explicit and replant-aware*
so every upstream intake knows what to preserve and what to keep-deleted.

---

## Candidate directions

### D-001: Current-tree upstream cadence via a happy patch-surface catalogue + subtree baseline
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Lowest disruption — no re-fork, no feature freeze. Establishes the durable
  *process* (the operator's actual ask: "keep merging upstream"). Adopts the codex-fork discipline
  (numbered invariant catalogue + periodic intake) adapted to inline divergence. Concrete shape: add
  `slopus/happy` as a remote, establish a **synthetic subtree baseline** (identify the upstream commit
  codexu imported from, by tree-matching the 1163-file import or by date), replay upstream deltas
  per-package via `git merge -X subtree` / patch application, and prioritize `happy-app` (where
  upstream is most active).
- Risks / friction: Recurring conflict cost on the hot files (`api.ts`, `socket.ts`, `auth.ts`,
  `pairRoutes.ts`, `v3SessionRoutes.ts`, `apiSession.ts`). Relies on maintainer discipline; without a
  visible cadence the catalogue rots. The baseline-establishment is unscoped work.
- Cheapest validation: In a disposable branch add the upstream remote, diff fork vs upstream per
  package, run ONE trial intake window from the latest upstream release → produce a **per-package
  conflict heatmap + estimated hours/sync**. This single number decides whether broad cadence is
  credible vs selective cherry-pick.
- Disconfirming observation: If one intake window repeatedly reopens the same deleted
  auth/routes/user-scoping conflicts and costs more than hand-picking the few wanted fixes, broad
  cadence is not operationally credible on the current tree (→ fall to selective cherry-pick).

### D-002: Restore auth + E2E first (single-user-collapsed) as the reconciliation wedge
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: It is the operator's explicitly chosen approach, it unblocks the HELD
  `remote-connectivity-single-user-public-evyatar-server` task (concrete near-term value), it is the
  **highest-value divergence-reduction increment**, and — done in upstream-aligned shape — it brings
  the *hottest merge-hostile files* back toward vanilla, de-risking every future D-001 intake. Reuses
  upstream `enableAuthentication`/`verifyToken` (collapsed to the single `tofuConfig.localUserId`) and
  `packages/happy-agent/src/encryption.ts` for the E2E re-wire.
- Risks / friction: Touches fragile daily-use paths (pairing, Socket.IO websocket + polling, v3
  session routes, CLI send/receive, reconnect, codex streaming). One break in BOOX pairing or codex
  streaming and the operator disables it. Must avoid reintroducing multi-tenant `accountId` threading.
- Cheapest validation: A throwaway **spike behind a default-off flag** — single-operator token gate on
  ONE protected REST route + the Socket.IO handshake, and `encrypt`/`decrypt` for ONE v3 message
  round-trip. Validate: unauthenticated `curl` denied; one CLI send/receive; one app reconnect; codex
  stream unaffected. This is the **go/no-go gate** for the whole strategy.
- Disconfirming observation: If the spike needs broad multi-tenant `accountId` re-threading, breaks
  codex streaming/replay, or can't gate both websocket AND polling without invasive app changes, it is
  NOT a cheap wedge → fall back to edge-auth (D-004) for the security boundary and pursue E2E
  separately.

### D-003: Re-fork from current upstream and re-apply fork value behind seams/flags
- Contributing lenses: [codex, copilot]
- Why this might work: Cleanest *long-term* mergeability — re-vendor current `slopus/happy`, then
  re-introduce fork-unique behavior (single-user daemon, codex app-server, e-ink UX) behind config
  flags / adapter seams / separate modules so upstream files stay near-vanilla and future syncs are
  near-painless.
- Risks / friction: XL effort; delays feature work; risks regressing the operator's daily
  tablet/codex workflows; throws away ~1200+ commits of fork work for a payoff that is abstract until
  the first painless sync lands.
- Cheapest validation: Prototype ONE vertical slice on current upstream — embedded single-user daemon
  startup + one paired app connection + one codex/app-server session message + one e-ink-critical app
  path — with fork behavior behind explicit seams/flags.
- Disconfirming observation: If the minimal slice STILL needs wholesale rewrites of upstream auth,
  routing, event fan-out, and session storage rather than additive seams, the re-fork does not buy
  enough mergeability to justify the migration (the deployment-model change is inherently non-additive
  on shared surfaces).

### D-004: Decouple the goals — edge-auth for public exposure, cherry-pick-only for upstream
- Contributing lenses: [devils-advocate]
- Why this might work: The Devil's Advocate's core reframe — public-exposure safety (urgent) and
  long-term mergeability (a process) are **orthogonal** and need not share a solution. Cheapest safe
  exposure is an authenticating EDGE (Cloudflare Access / mTLS) in front of the UNCHANGED loopback
  server — **zero happy-server source change** (findings.md path D-002). Upstream intake becomes
  on-demand cherry-pick of specific wanted fixes, with no broad-sync commitment.
- Risks / friction: The edge does NOT reduce divergence — it leaves the auth-plane debt in place
  forever, so it does not serve the operator's stated mergeability goal. Adds a third-party trust
  boundary (and any vendor can policy-block, as Microsoft Dev Tunnels did). E2E session bodies stay
  plaintext at the server.
- Cheapest validation: Stand up Cloudflare Access in front of the loopback listener; confirm
  unauthenticated REST + Socket.IO (websocket AND polling) are denied and the BOOX app can
  obtain/store/refresh the edge credential.
- Disconfirming observation: If the operator genuinely wants *divergence reduction / mergeability*
  (they do — see the stored direction), the edge is a non-answer for that goal; it only solves
  exposure. It is the correct **fallback** when D-002's spike fails, not the primary strategy.

---

## Feasibility verdict — restore upstream auth + E2E under the single-user model

**FEASIBLE, with one hard gate.**

- **Auth (single-user-trivial part):** Re-import upstream's `enableAuthentication` + `verifyToken`,
  but collapse the multi-tenant token→`userId` mapping to a **single operator identity** (one token /
  one keypair = `tofuConfig.localUserId`). The single-user model means you do NOT need per-user DB
  scoping — just a fail-closed "is this THE operator" check. Must cover REST routes + Socket.IO
  websocket + polling fallback + `/pair/complete`. This is the part that is *easier* than upstream
  (one identity, no tenant scoping).
- **E2E (mechanically small):** Re-wire `encrypt()` at the CLI send site (`apiSession.ts`) +
  symmetric `decrypt()`, keyed by the existing single operator keypair; stop the server mislabeling
  plaintext. `packages/happy-agent/src/encryption.ts` + `session.ts` already contain reusable
  encryption code (verified), so this is re-activating call sites, not building crypto.
- **The hard gate (needs adapting / could break):** auth+E2E touch the SAME session routes + socket
  the codex app-server / streaming changes modified. The **spike is the go/no-go**: if single-user
  auth+E2E can't be added without breaking codex streaming/replay or reintroducing multi-tenant
  `accountId` threading, the in-app restore is not cheap → use edge-auth (D-004) for the boundary and
  treat E2E as a separate increment.
- **Does it collide with codex app-server / streaming?** Likely overlaps on `v3SessionRoutes.ts` +
  `socket.ts` + `apiSession.ts`. Manageable if auth is a thin fail-closed pre-handler and E2E is a
  send/receive transform that leaves the streaming envelope shape intact — but this is exactly what
  the spike must prove.

---

## Recommended sequenced strategy

1. **Run the auth+E2E restore spike (default-off flag)** — the go/no-go gate (D-002 cheapest
   validation). Cheapest, highest-information first move.
2. **Establish the upstream tracking baseline** — add `slopus/happy` remote, identify the import
   baseline, produce a **per-package conflict heatmap + hours/sync** (D-001 cheapest validation). This
   quantifies the mergeability problem and tells you if broad cadence beats cherry-pick.
3. **Restore auth+E2E in upstream-aligned single-user shape (D-002)** as the first
   patch-surface-tracked reconciliation — unblocks the public-server task AND de-risks the hottest
   files.
4. **Stand up `docs/happy-patch-surface.md`** (the invariant catalogue: KEEP + KEEP-DELETED buckets,
   replant notes) **+ a selective upstream-intake cadence (D-001)** targeting upstream releases,
   prioritizing `happy-app`.
5. **Re-evaluate D-003 (re-fork) ONLY if** step 2's heatmap shows the current tree is unmaintainable.
   Default: **decline the re-fork** (throws away ~1200+ commits for uncertain payoff).
- **Fallback:** if the step-1 spike FAILS, use **edge-auth (D-004)** to unblock public exposure
  immediately, and pursue divergence-reduction as a separate, slower track.

---

## Relation to the held public-server task

The held `remote-connectivity-single-user-public-evyatar-server` task's chosen approach is exactly
"restore upstream auth + re-add E2E." This brainstorm **confirms that is viable** and shows the
auth+E2E restore **IS** the public-exposure boundary (a fail-closed per-request/per-handshake verifier
covering REST + socket + `/pair/complete`, plus encrypted session bodies) **AND** the first
divergence-reduction increment. The two tasks therefore **share one body of work**: do the restore
once, in upstream-aligned single-user shape, and it serves both the public boundary and mergeability —
**provided D-002's spike passes.** If it does not, the public-server task takes the edge-auth path
(D-004) and divergence-reduction is pursued separately — the one case where the two goals split.

---

## Open questions for planning
- Is public exposure urgent enough to justify the security-first detour before broader upstream-sync
  hygiene? (If yes → D-002 first, as recommended.)
- Must happy-server itself carry the full verifier boundary, or is a third-party authenticating edge
  acceptable? (Edge = cheaper exposure, zero divergence reduction.)
- Minimum E2E guarantee: only session bodies, or also metadata / daemon-state / files / push payloads?
  (Metadata + daemon-state + agent-comms are already encrypted; session bodies are the gap.)
- What upstream commit is codexu's import baseline, and what is the per-package conflict budget/month
  before "broad cadence" is declared failed in favor of selective cherry-pick?
- Who owns keeping the KEEP / KEEP-DELETED catalogue current after each intake?
