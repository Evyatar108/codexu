# Brainstorm brief — happy-fork-upstream-divergence-reconciliation

## The strategic question (what to brainstorm)
The **codexu** monorepo vendors a heavily-modified fork of **slopus/happy** (packages `happy-server`,
`happy-cli`, `happy-app`, plus fork-added `happy-wire`, `happy-agent`, `codium`). The operator wants a
**divergence-management strategy** so the fork can KEEP MERGING upstream slopus/happy changes over time
(the way the **codex fork** does its periodic upstream-sync) WITHOUT losing the fork's genuinely-unique
value. Trigger: an investigation discovered the fork **deliberately deleted upstream's entire
bearer-token auth plane AND dropped E2E content encryption** — which both blocks safe public exposure
and signals heavy, merge-hostile divergence.

Deliver: (1) a divergence audit categorizing each material divergence as KEEP (fork-unique) vs
RESTORE/RECONCILE (divergence-debt); (2) a feasibility verdict on restoring upstream auth + E2E under
the fork's embedded single-user-per-daemon model; (3) a recommended merge/upstream-sync strategy
(rebase vs cherry-pick cadence vs seam/flag isolation vs re-fork) naming the highest-divergence files
and how to de-risk them; (4) how restoring auth+E2E doubles as the public-exposure boundary for the
HELD `remote-connectivity-single-user-public-evyatar-server` task AND a divergence-reduction step.
This is a STRATEGY question — weigh trade-offs; do NOT rubber-stamp "restore everything".

## Source-verified facts (cite these; verify against source, don't trust blindly)

### Divergence magnitude
- Fork commit volume over ~12 months: **happy-server 143, happy-cli 442, happy-app 631** commits.
- **No `slopus/happy` upstream remote is configured** in codexu (only `origin`=evmitran_microsoft,
  `personal`=Evyatar108). Upstream is vendored, not tracked — there is no live merge base today.
- The fork ran "Sprint A..E" structural surgery (see `packages/happy-server/AGENTS.md`): moved to an
  **embedded single-user-per-daemon** server (`createHappyServer()` + `dualListenerBinding()` in
  happy-cli), **dropped the multi-tenant hosted deployment**, and DELETED whole route modules
  (artifact, feed, voice, key-value, access-key, user/friends, usage, machine-directory).

### The deleted auth plane (divergence-debt candidate)
- `enableAuthentication.ts` is **absent** in the fork (present upstream: real `Authorization: Bearer`
  401 gate). Fork `app/auth/auth.ts` has **no `verifyToken`/`verifier`** (kept only createToken/
  createGithubToken/verifyGithubToken). `authenticateTunnel` is a literal **no-op** (`api.ts:79`);
  in tunnel mode `app.authenticate` IS that no-op so every "protected" route is ungated at the app layer.
- Socket.IO handshake is **fail-open** in tunnel mode (`socket.ts:61-95`); upstream is fail-closed
  token-required (`socket.ts:82-121`).
- Pairing: upstream's QR + per-user bearer-token flow (`/v1/auth/request` + `/v1/auth/response`) was
  REPLACED by a single **unauthenticated** `POST /pair/complete` that hands out server key material
  (`pairRoutes.ts:59-119`); upstream `pairRoutes.ts` doesn't exist (404). Trust boundary relocated to
  the **Dev Tunnels gateway** + a `127.0.0.1` bind (`assertOperatorIdentityGate`, `index.ts:101-108`).
- Fork git history makes the divergence explicit: `25b9a573` "drop multi-tenant userId scoping",
  `48e16356` "delete requireAccountIdForTunnel", `5c1b3953` "delete tunnel-claim minting".

### The dropped E2E (divergence-debt candidate)
- CLI sends session bodies as `JSON.stringify(content)` with **no `encrypt()`** (`apiSession.ts:659`;
  `encrypt` imported but never called); server stores them under a cosmetic `{t:'encrypted', c:<plaintext>}`
  label with no server crypto (`v3SessionRoutes.ts:166-168`); receive path `JSON.parse`s plaintext
  (`apiSession.ts:316`). So a hostile reader of the message routes/socket gets **plaintext agent
  conversations**. NOTE: machine `metadata`/`daemonState` ARE still TweetNaCl-encrypted, and
  `/agent-comms/ingest` IS fail-closed (pinned-peer + Ed25519 sig + ECDH unseal + spawn-approval) —
  so the fork did NOT drop ALL crypto, only session-body E2E.

### Fork-unique value (KEEP candidates)
- Embedded single-user-per-daemon architecture (no central broker) — operator-blessed, load-bearing
  for codex autoconnect (`remote_session` connects to `127.0.0.1:<tunnelPort>`).
- **codex app-server support** + **message-streaming improvements** (operator named both as keepers).
- codex/agent-comms integration; fork-added packages `happy-wire` (typed `context-boundary` etc.
  envelopes), `happy-agent`, `codium`. The e-ink/tablet (BOOX) UX work in happy-app.

## Reference model the operator wants to emulate: the CODEX fork's upstream-sync
The codex submodule fork (`codex/`) stays mergeable with upstream openai/codex via a disciplined
patch-surface model, NOT inline rewrites:
- `codex/docs/implementation/patch-surface.md` — a numbered **invariant catalogue** (1..N) documenting
  every unavoidable inline edit to upstream files, with replant instructions on each rebase.
- **Overlay crates** (`codex/codex-rs-overlay/codex-happy`) keep fork-unique code in SEPARATE additive
  files/crates so upstream files stay near-vanilla and rebase cleanly.
- A `sandbox-patches` branch + a `/rebase-upstream` skill drive periodic rebases onto upstream tags;
  Phase-5a `cargo check --workspace` gates each replant.
- Fork-divergent behavior is gated via codex's **experimental-features** mechanism (default-off flags),
  not ad-hoc inline edits.
The happy fork did the OPPOSITE: it deleted/rewrote upstream files in place (auth plane, route modules,
pairing), which is what makes it merge-hostile. The core tension to resolve: the happy fork's value is
largely a *deployment-model* change (multi-tenant -> single-user embedded) that touches the SAME files
upstream keeps changing, so seam-isolation is harder than codex's additive-overlay case.

## Directions to weigh (do not just pick one — pressure-test all)
1. **Re-fork + re-apply as overlays/seams**: re-vendor current upstream slopus/happy, then re-introduce
   fork-unique changes behind config flags / adapter seams / separate modules so upstream files stay
   close to vanilla; restore upstream auth+E2E as the single-user-adapted boundary. (Codex-overlay analogy.)
2. **Establish an upstream remote + periodic rebase/cherry-pick cadence** (codex `/rebase-upstream`
   analogy) on the CURRENT heavily-diverged tree, with a happy-side `patch-surface.md` invariant
   catalogue documenting the deletions/rewrites so each sync knows what to replant. (Cheaper now,
   but every sync fights the same merge-hostile files.)
3. **Restore-auth+E2E-first as a divergence-reduction wedge**: treat re-adding upstream's auth plane +
   E2E (single-user-collapsed) as the FIRST reconciliation step — it simultaneously unblocks the public
   server task and shrinks the highest-value divergence, establishing the merge discipline incrementally.
4. **Accept divergence / selective cherry-pick only**: stop trying to track upstream broadly; cherry-pick
   only specific upstream fixes/features on demand. (Lowest effort, highest long-term drift.)

## Feasibility sub-question: restore upstream auth + E2E under single-user model
- Upstream auth is a multi-tenant GitHub-OAuth account system whose safety comes from per-user DB
  **data scoping** (also deleted by the fork). What is SINGLE-USER-TRIVIAL (collapse to one identity /
  one token / one keypair) vs what genuinely needs adapting? Does restoring auth+E2E collide with the
  codex app-server / streaming changes (which touch session routes + socket)?
- E2E: the client encryption key + envelope format still exist in happy-wire / privacy-kit; the fork
  removed only the call sites. Is re-adding `encrypt()` at the CLI send site + `decrypt()` symmetric on
  the app, keyed by the existing single operator keypair, the minimal restore?

## Key absolute paths to verify (read these)
- Investigation (most important): `D:/harness-efforts/codexu/.ralph/investigations/happy-server-auth-fork-vs-upstream/findings.md`
- Fork server: `D:/harness-efforts/codexu/packages/happy-server/sources/app/api/api.ts`,
  `.../app/auth/auth.ts`, `.../app/api/socket.ts`, `.../app/api/routes/pairRoutes.ts`,
  `.../app/api/routes/v3SessionRoutes.ts`, `.../index.ts`, `packages/happy-server/AGENTS.md`
- Fork CLI: `D:/harness-efforts/codexu/packages/happy-cli/src/api/apiSession.ts`,
  `.../src/daemon/dualListenerBinding.ts`
- Fork-added: `D:/harness-efforts/codexu/packages/happy-wire/`, `packages/happy-agent/`
- Codex reference model: `D:/harness-efforts/codexu/codex/docs/implementation/patch-surface.md`,
  `codex/.claude/commands/rebase-upstream.md`
- Upstream for comparison: fetch via `gh api repos/slopus/happy/contents/packages/happy-server/sources/app/api/...`
