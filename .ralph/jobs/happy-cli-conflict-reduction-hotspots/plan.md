# Plan — happy-cli upstream conflict-surface reduction (KEEP/DISABLE + overlay seams)

**Job:** `happy-cli-conflict-reduction-hotspots`
**Worktree:** `D:/harness-efforts/codexu/.worktrees/plan-cli-reduce` — branch `ralph/plan-cli-reduce` (off `main` @ `2a670e71`)
**Template:** `.ralph/jobs/happy-upstream-m2-r8-app-ui-seams/plan.md` (R8) + M1 seam discipline (`packages/happy-cli/src/fork/`)
**Catalogue:** `docs/happy-patch-surface.md` §4 (HC-* rows)
**Status:** planning deliverable (markdown only — NO source edits, builds, or tests in this job)

---

## 1. Goal

Reduce the **effort and risk** of porting upstream happy-cli changes across the
**33 hard-conflict files (83 conflict hunks)** that collide when 3-way-merging the
fork's `packages/happy-cli/` against upstream `cli-1.1.10`.

Following the M1 (happy-cli seams) and R8 (happy-app UI seams) playbook: for every
divergence make a **KEEP / DISABLE-for-now / RESTORE-toward-upstream** decision,
assign a stable `HC-<n>` invariant ID, drop a `// FORK PATCH:` marker at each
conflict site, and — where a fork feature forms a coherent, cleanly-separable
cluster — **relocate it into a fork-owned module under `src/fork/`** with a thin
call-site seam (never inline edits).

### Honest framing (read this before estimating impact)

This job's realistic reduction is **modest, and dominated by *localization*, not
*elimination*** — exactly as M1 and R8 found. Two structural facts drive that:

1. **happy-cli conflicts are convergent-evolution, not stale drift.** Unlike
   happy-app (which had 12 already-extracted fork-only modules whose *inline
   call-sites* were the conflict source, cleanly seamable), the happy-cli hotspots
   are cases where **BOTH the fork AND upstream independently grew features in the
   SAME regions**: type-parameter changes threaded through generic classes
   (`MessageQueue2<T>`), interleaved protocol handlers (`apiSession`), and shared
   mechanisms both sides rewrote (Claude session-switch). These are largely **not
   cleanly relocatable** — you cannot lift the fork's half out because upstream's
   half occupies the same lines.

2. **M1 already proved seam-relocation removes ~zero conflict FILES.** M1 relocated
   `onCodexRun` / `onClaudeRun` / `onDaemonRun` / `onMachineRpc` into `src/fork/`;
   those files (`runCodex.ts`, `runClaude.ts`, `daemon/run.ts`, `apiMachine.ts`)
   **still appear in this 33-file list** with residual thin-seam hunks. The win was
   per-conflict *effort* (a 1-line seam re-point vs a blind logic re-derivation),
   not the file count.

So the **primary deliverable is a complete catalogue + markers** (HC-8..HC-19) that
converts every blind future port into a guided KEEP/DISABLE decision, plus **a
handful of genuine, low-risk reductions**: mechanical noise alignment, one R8-style
extraction (Claude deferred-switch), and one **operator-gated** convergence
(attachment model) that is the single biggest lever.

**Estimated reduction:** file count **33 → ~31–32**; hunk budget **83 → ~60–65** via
cataloguing + cosmetic alignment + the deferred-switch extraction alone, or
**→ ~50–55** IF the operator approves the attachment-model convergence (US-004).
Cataloguing does not shrink a *fresh* 3-way's raw marker count much; its value —
like M1 — is turning each surviving hunk from re-derivation into a decision.

---

## 2. Hard constraint — behavior-preserving CLI/protocol parity

Every story in this job is **behavior-preserving** unless it is the explicitly
operator-gated convergence (US-004). Concretely:

- No change to the wire protocol, RPC method names, session-log semantics, codec
  behavior, or CLI flag surface.
- Marker comments (`// FORK PATCH: …`) and module relocations must be **pure moves**:
  the emitted behavior of `happy`/`happy-dev` is byte-for-byte identical.
- Gate: `npm_config_script_shell=bash pnpm --filter happy test` stays green and
  `pnpm --filter happy typecheck` stays clean after every story (see §11).
- The fork-architecture invariants stay intact — in particular the **embedded
  per-daemon server default URL** (`configuration.ts`, HC-12) and the **removed
  push-notification client** (`api/api.ts`, HC-18) are load-bearing fork state, NOT
  drift to revert.

---

## 3. Verified research

### 3.1 Method (reproducible)

```
BASE   = b72fd811   (tag cli-1.1.8)   — merge baseline, in mirror D:/harness-efforts/happy
OURS   = fork worktree packages/happy-cli/   (this worktree, main @ 2a670e71)
THEIRS = 71c417e1    (tag cli-1.1.10)  — upstream intake target, same mirror

# extract BASE + THEIRS trees
git -C D:/harness-efforts/happy archive b72fd811 packages/happy-cli | tar -x -C _scratch/base
git -C D:/harness-efforts/happy archive 71c417e1 packages/happy-cli | tar -x -C _scratch/theirs

# per-file 3-way; a hard conflict = git merge-file exit>0; count '<<<<<<<' markers = hunks
git merge-file -p --diff3 <ours> _scratch/base/<f> _scratch/theirs/<f>   # add/add uses empty base
```

Skips binary/dist/lockfile/image paths. Rebase remains **impossible** (history-detached
vendored copy, no merge-base — see
`.ralph/investigations/happy-upstream-rebase-assessment-v2/findings.md`); selective
per-file 3-way port governed by `docs/happy-patch-surface.md` is the only intake path.
This matches the assessment's **33-file** CLI count.

### 3.2 The 33-file / 83-hunk breakdown

Legend — **C** = catalogued (has HC row + markers today); **U** = uncatalogued
(this job adds the HC row); **T** = test-follows-source (tracks its source file's HC
decision, no separate ID); **M** = mechanical.

| # | file (`packages/happy-cli/src/…` unless noted) | hunks | state | divergence (fork ⟂ upstream) |
|---|---|---:|:--:|---|
| 1 | `utils/MessageQueue2.ts` | 12 | **U → HC-8** | attach-by-**ref** (`MessageQueueAttachment{type,ref,mimeType}`) + consumption-ack (`MessageDelivery`, `consumedMessages`) **vs** upstream inline-bytes `PendingAttachment{data:Uint8Array,mimeType,name}` |
| 2 | `api/apiSession.ts` | 11 | **C (HC-1/2/3)** | codec relocated = 1 hunk; 10 residual: consumption-ack + `AgentConfiguration` (live drawer) + `AgentTreeDelta` + context-boundary **vs** upstream `FileEventMessage` + `enqueueSessionProtocolEnvelopes` refactor |
| 3 | `api/apiSession.test.ts` | 7 | **T (→2)** | mirrors #2 |
| 4 | `claude/utils/sessionScanner.ts` | 6 | **U → HC-9** | fork `normalizeSessionLogMessage` (title normalization) + `getSessionLogMessageKey` rename **vs** upstream entries/`transcript-event`/`claudeGoalStatus` restructure |
| 5 | `claude/claudeLocalLauncher.ts` | 4 | **U → HC-10** | fork **deferred-switch** (`performSwitch`, `request-switch` RPC, `setPendingSwitch`, `closeClaudeSessionTurn`) + summary-forward (removed "Block SDK summary" filter) **vs** upstream `doSwitch`/`onAbort` |
| 6 | `api/apiMachine.ts` | 3 | **C (HC-7)** | `onMachineRpc` relocated; residual `ForkSessionOptions` + resume-support threading |
| 7 | `claude/claudeRemoteLauncher.ts` | 3 | **U → HC-11** | fork `emitConsumptionReceipts`, `MessageBatch`, `ClaudeRemoteQueuedMessage` **vs** upstream per-message attachments |
| 8 | `claude/runClaude.ts` | 3 | **C (HC-5)** | `onClaudeRun` seam residual (thin-only) |
| 9 | `claude/sdk/query.ts` | 3 | **U → HC-13** | fork SDK **env passthrough** (`opts.env`) **vs** upstream `effort` reorg |
| 10 | `codex/codexAppServerClient.test.ts` | 3 | **T** | mirrors #24 |
| 11 | `claude/claudeRemote.ts` | 2 | **U → HC-11** | queued-message type (consumption-ack) — same cluster as #7 |
| 12 | `codex/runCodex.ts` | 2 | **C (HC-4)** | `onCodexRun` seam residual (thin-only) |
| 13 | `commands/codexCommand.test.ts` | 2 | **T (→14)** | mirrors #14 |
| 14 | `commands/codexCommand.ts` | 2 | **U → HC-14** | fork arg parsing (`--effort`, `--idle-timeout`, resume) **vs** upstream consolidated `codexArgs`+`permissionMode` |
| 15 | `configuration.ts` | 2 | **U → HC-12** | **embedded-server default URL** `http://127.0.0.1:3005` **vs** upstream `https://api.cluster-fluster.com`; + `chmodSync` import churn |
| 16 | `api/api.ts` | 1 | **U → HC-18** | fork removed **push-notification client** (no central server) — KEEP-**DELETED** |
| 17 | `claude/claudeLocalLauncher.test.ts` | 1 (add/add) | **T (→10)** | mirrors #5 |
| 18 | `claude/claudeRemote.test.ts` | 1 (add/add) | **T (→11)** | mirrors #7/#11 |
| 19 | `claude/runClaude.test.ts` | 1 (add/add) | **T (→5)** | mirrors #8 |
| 20 | `claude/session.ts` | 1 | **U → HC-10** | `pendingSwitch` state — same cluster as #5 |
| 21 | `claude/utils/permissionHandler.ts` | 1 | **U → HC-15** | fork `reset({clearAllowlist})` (session-allowlist) **vs** upstream `reset(reason)` |
| 22 | `claude/utils/sessionProtocolMapper.ts` | 1 | **U → HC-16** | fork context-boundary `boundaries` intents **vs** upstream `claudeUuid` |
| 23 | `claude/utils/sessionScanner.test.ts` | 1 | **T (→9)** | mirrors #4 |
| 24 | `codex/codexAppServerClient.ts` | 1 | **U → HC-19** | fork ws-transport client feature (1-hunk overlap) |
| 25 | `codex/__tests__/executionPolicy.test.ts` | 1 | **T** | mirrors codex policy |
| 26 | `daemon/run.ts` | 1 | **C (HC-6)** | `onDaemonRun` seam residual (spawn cmd) |
| 27 | `modules/common/registerCommonHandlers.ts` | 1 | **U → HC-17** | fork `model`/`permissionMode` spawn metadata |
| 28 | `persistence.ts` | 1 | **U → HC-17** | fork codex-MCP routing config + `Credentials` fields |
| 29 | `utils/createSessionMetadata.test.ts` | 1 | **T (→17)** | mirrors #30 |
| 30 | `utils/createSessionMetadata.ts` | 1 | **U → HC-17** | fork spawn-ancestry `parentSessionId` |
| 31 | `utils/MessageQueue2.test.ts` | 1 | **T (→8)** | mirrors #1 |
| 32 | `utils/serverConnectionErrors.test.ts` | 1 | **T** | server-URL/error-shape follows HC-12 |
| 33 | `packages/happy-cli/package.json` | 1 | **M** | mechanical version/dep churn (non-src) |

**Totals:** 33 files, **83 hunks** (82 in `src/` + 1 in `package.json`).
Breakdown by role: **21 prod-source files / 62 hunks**, **11 test files / 20 hunks**,
**1 mechanical / 1 hunk**.

### 3.3 Fork infra verified present (relocation targets already exist)

- `src/fork/` holds M1 seam modules: `forkHooks.ts`, `onClaudeRun.ts`,
  `onCodexRun.ts` (+ test). `api/sessionPayloadCodec.ts` holds HC-1/2/3.
- **14 existing `FORK PATCH` markers** across 8 files (apiSession ×3, apiMachine ×2,
  runClaude ×1, runCodex ×1, daemon/run ×1, fork/* headers ×6).
- Deferred-switch symbols confirmed: 17 refs in `claudeLocalLauncher.ts`, 7 in
  `session.ts` → coherent cluster (HC-10 extraction candidate).
- Consumption-ack symbols confirmed: 16 refs in `MessageQueue2.ts` (HC-8).
- `api/api.ts` has **no** `pushClient`/`push()` → fork removal verified (HC-18
  KEEP-DELETED; importer must NOT resurrect upstream's push getter).

---

## 4. Invariant-ID assignment (catalogue update — `docs/happy-patch-surface.md` §4)

New rows to append to the HC-* table (existing rows HC-1..HC-7 unchanged):

| HC | file(s) | feature (fork behavior to preserve) | decision |
|---|---|---|---|
| **HC-8** | `utils/MessageQueue2.ts`, `utils/MessageQueue2.test.ts` | attachment-by-**ref** + consumption-ack delivery tracking (`MessageDelivery`, `consumedMessages`) | **KEEP** — *operator-gated convergence in US-004* |
| **HC-9** | `claude/utils/sessionScanner.ts` (+ `.test.ts`) | session-log **title normalization** (`normalizeSessionLogMessage`) + key helper | **KEEP** |
| **HC-10** | `claude/claudeLocalLauncher.ts`, `claude/session.ts` (+ launcher `.test.ts`) | Claude **deferred-switch** protocol + SDK-summary forwarding | **KEEP** → *extract to `src/fork/claudeDeferredSwitch.ts`* (US-002) |
| **HC-11** | `claude/claudeRemoteLauncher.ts`, `claude/claudeRemote.ts` (+ `.test.ts`) | remote consumption-receipt emission + queued-message batch type | **KEEP** |
| **HC-12** | `configuration.ts` (+ `utils/serverConnectionErrors.test.ts`) | **embedded per-daemon server default URL** `http://127.0.0.1:3005` | **KEEP** (load-bearing fork architecture) |
| **HC-13** | `claude/sdk/query.ts` | Claude-SDK **env passthrough** (`opts.env`) | **KEEP** |
| **HC-14** | `commands/codexCommand.ts` (+ `.test.ts`) | fork codex arg parsing (`--effort`, `--idle-timeout`, resume) | **KEEP** |
| **HC-15** | `claude/utils/permissionHandler.ts` | session-allowlist reset (`reset({clearAllowlist})`) | **KEEP** |
| **HC-16** | `claude/utils/sessionProtocolMapper.ts` | context-boundary intents (`boundaries`) | **KEEP** |
| **HC-17** | `utils/createSessionMetadata.ts`, `persistence.ts`, `modules/common/registerCommonHandlers.ts` (+ `createSessionMetadata.test.ts`) | spawn-ancestry (`parentSessionId`), codex-MCP routing config, spawn `model`/`permissionMode` metadata | **KEEP** (small additive) |
| **HC-18** | `api/api.ts` | push-notification client **removed** (no central server) | **KEEP-DELETED** |
| **HC-19** | `codex/codexAppServerClient.ts` (+ `.test.ts`, `executionPolicy.test.ts`) | codex ws-transport app-server client | **KEEP** |

Marker convention (unchanged from §1 of the catalogue):
`// FORK PATCH: [KEEP|KEEP-DELETED|RESTORE] <one-line reason> (invariant HC-<n>)`.
Test files carry a one-line `// FORK PATCH: test tracks HC-<n>` breadcrumb so a future
porter knows the test's divergence follows its source's decision — they get **no
separate HC ID**.

---

## 5. KEEP / DISABLE / RESTORE triage

Split across all 33 files: **KEEP** 30 (28 prod+test tracked as KEEP, incl.
HC-18 KEEP-DELETED), **RESTORE-toward-upstream** 1 (HC-8 attachment model —
operator-gated), **DISABLE/mechanical alignment** 2 (`package.json` + cosmetic
import/field-order slices — behavior-preserving, no feature removed). There are
**no true DISABLE-a-fork-feature** candidates: every fork divergence here is a
load-bearing feature, which is itself the honest finding (CLI drift is not
gratuitous the way some app UI drift was).

| divergence | file:symbol | K/D/R | rationale | seam design / revert recipe | est. hunk Δ | operator-decision? |
|---|---|:--:|---|---|---:|:--:|
| attachment model (ref vs inline-bytes) + consumption-ack | `MessageQueue2.ts`: `MessageQueueAttachment`, `MessageDelivery`, `consumedMessages` | **KEEP** (US-004: **RESTORE**?) | ref-indirection powers `.happy/attachments/*` writeFile-RPC; consumption-ack is load-bearing | catalogue HC-8 + markers; US-004 *optionally* adopts upstream `PendingAttachment` inline-bytes | −2 (catalogue) / **−6..−10 (if converged)** | **YES** (US-004) |
| object-literal field ordering | `MessageQueue2.ts` C4/C6/C12 (`{isolate, attachments, delivery}` vs `{isolate, attachments}`) | **DISABLE-align** | pure cosmetic ordering; align shared fields to upstream order | reorder fork fields → upstream sequence, append fork-only fields last | −2..−3 | no |
| codec + protocol residual | `apiSession.ts`: consumption-ack, `AgentConfiguration`, `AgentTreeDelta`, boundary | **KEEP** | HC-1/2/3 already relocated codec; rest interleaves upstream `enqueueSessionProtocolEnvelopes` | expand HC-1/2/3 markers to cover residual sites; careful-merge residual (R5 analog) | 0 (localize only) | no |
| title normalization + key helper | `sessionScanner.ts`: `normalizeSessionLogMessage`, `getSessionLogMessageKey` | **KEEP** | title normalization is a documented fork behavior (CLI AGENTS.md) | catalogue HC-9 + markers; helper-rename left as-is (upstream renamed too) | −1 (localize) | no |
| deferred-switch + summary forward | `claudeLocalLauncher.ts` + `session.ts`: `performSwitch`, `request-switch`, `setPendingSwitch`, `pendingSwitch` | **KEEP → extract** | coherent, separable fork cluster (17+7 refs) = best R8-style extraction | relocate to `src/fork/claudeDeferredSwitch.ts`; thin seams call fork fns | −2..−3 | no |
| remote consumption-receipts | `claudeRemoteLauncher.ts` + `claudeRemote.ts`: `emitConsumptionReceipts`, `MessageBatch` | **KEEP** | ties to HC-8 delivery-tracking | catalogue HC-11 + markers | −1 (localize) | no |
| SDK env passthrough | `claude/sdk/query.ts`: `opts.env` | **KEEP** | fork feature (env injection to Claude SDK) | catalogue HC-13 + markers | −1 (localize) | no |
| embedded-server default URL | `configuration.ts`: `serverUrl` default | **KEEP** | **load-bearing** fork architecture (per-daemon `127.0.0.1:3005`) | catalogue HC-12 + marker; align only the `chmodSync`/`readFileSync` import churn | −1 (import align) | no |
| codex arg parsing | `codexCommand.ts`: `--effort`, `--idle-timeout`, resume | **KEEP** | fork codex UX features | catalogue HC-14 + markers | 0 (localize) | no |
| session-allowlist reset | `permissionHandler.ts`: `reset({clearAllowlist})` | **KEEP** | fork session-allowlist feature | catalogue HC-15 + marker | 0 | no |
| context-boundary intents | `sessionProtocolMapper.ts`: `boundaries` | **KEEP** | typed context-boundary (fork wire feature) | catalogue HC-16 + marker | 0 | no |
| spawn metadata (ancestry/model/routing) | `createSessionMetadata.ts`, `persistence.ts`, `registerCommonHandlers.ts` | **KEEP** | small additive fork fields | catalogue HC-17 + markers | 0 | no |
| push-client removed | `api/api.ts`: (absent `push()`) | **KEEP-DELETED** | fork has no central server → no push infra | catalogue HC-18 + a marker where upstream's `push()` would land; **do NOT resurrect** | 0 (guard) | no |
| ws-transport client | `codexAppServerClient.ts` | **KEEP** | fork codex app-server ws feature | catalogue HC-19 + marker | 0 | no |
| version/dep churn | `package.json` | **DISABLE-align** | mechanical; align dep block toward upstream where fork doesn't need the delta; add `.gitattributes` normalization if it helps | revert cosmetic dep-order/version noise; keep fork-required deps | −1 (possible auto-resolve) | no |
| test-follows-source (×11) | `*.test.ts` | **KEEP** | tests mirror their source's divergence | one-line `// FORK PATCH: test tracks HC-<n>` breadcrumb each | 0 (localize) | no |

---

## 6. Fork-owned module extraction design (the one genuine R8-style seam)

**`src/fork/claudeDeferredSwitch.ts`** (HC-10) — the deferred-switch cluster is the
only happy-cli hotspot that is *coherent AND cleanly separable* enough to justify
relocation (mirrors M1's `onClaudeRun`/`onCodexRun`).

- **Relocate:** `performSwitch(...)`, the `request-switch` / `cancel-pending-switch`
  RPC registration, `setPendingSwitch` / `pendingSwitch` state, and
  `closeClaudeSessionTurn` turn-finalization into the new module.
- **Seam:** `claudeLocalLauncher.ts` calls `installClaudeDeferredSwitch(session, api)`
  (returns the handlers it needs); `session.ts` reads/writes pending state through a
  thin accessor. No behavior change — a pure move.
- **Marker:** module header + each thin seam gets
  `// FORK PATCH: KEEP Claude deferred-switch protocol (invariant HC-10)`.
- **Confidence:** MEDIUM (lower than R8's UI extractions). Upstream rewrote the SAME
  switch mechanism (`doSwitch`/`onAbort`), so the seam boundary interleaves with
  upstream lifecycle hooks. If extraction proves to entangle upstream's Stop/
  Notification hook wiring, **fall back to catalogue-only** (markers on the existing
  sites) — do NOT force a fragile extraction. This fallback is explicitly allowed in
  US-002's AC.

No other hotspot is proposed for extraction: `MessageQueue2<T>` type-parameter
threading, `apiSession` protocol interleave, and `sessionScanner` restructure are
all convergent-in-place (the fork's half cannot be lifted without dragging
upstream's half).

---

## 7. Behavior-preserving stories (see `stories-outline.md` for full AC)

- **US-000 — Catalogue + markers (HC-8..HC-19).** Add the 12 new HC rows to
  `docs/happy-patch-surface.md` §4; drop `// FORK PATCH:` markers at each conflict
  site across the 21 prod files + one-line breadcrumbs on the 11 test files. Pure
  comments + docs → behavior-preserving. **Unblocks everything.** *Biggest single
  deliverable* (the M1-localization value).
- **US-001 — Mechanical noise alignment.** `package.json` dep/version-order
  normalization toward upstream where the fork doesn't need the delta; `.gitattributes`
  review; cosmetic import-line alignment in `configuration.ts` (`chmodSync`/
  `readFileSync`) and `apiSession.ts` import block. No feature change. Disjoint from
  US-002/US-004.
- **US-002 — Extract Claude deferred-switch → `src/fork/claudeDeferredSwitch.ts`
  (HC-10).** The one R8-style relocation. Thin seams in `claudeLocalLauncher.ts` +
  `session.ts`. Fallback to catalogue-only if entangled (AC-permitted).
- **US-003 — MessageQueue2 field-order alignment (HC-8, cosmetic slice).** Reorder
  fork-only object-literal fields to *append* after upstream-shared fields
  (`{isolate, attachments, …fork}`), shrinking C4/C6/C12 to true value-diffs only.
  No type/behavior change. Depends on US-000 (markers present).
- **US-004 — [OPERATOR-GATED] Attachment-model convergence (HC-8 RESTORE).** IF the
  operator approves: adopt upstream's inline-bytes `PendingAttachment` model in
  `MessageQueue2.ts` + `claudeRemoteLauncher.ts` + `apiSession.ts` file-events,
  retiring the fork's ref-based `.happy/attachments/*` indirection. This is the
  single biggest hunk reduction (**−6..−10**) but **changes observable attachment
  behavior**, so it does not ship without an explicit operator decision. Default if
  undecided: **KEEP** (US-000 markers already in place; no code change).

**Ship order & parallelism:**

```
US-000  (catalogue + markers)          ── ships first; unblocks all
   ├─ US-001  (mechanical/import align) ─┐  disjoint files → parallel-safe
   ├─ US-002  (deferred-switch extract) ─┤  (launcher/session vs package.json/config)
   └─ US-003  (MQ2 field-order align)   ─┘
US-004  (operator-gated convergence)   ── LAST; only after operator GO; touches MQ2 + apiSession + remoteLauncher
```

US-002 (claudeLocalLauncher, session) and US-003/US-004 (MessageQueue2, apiSession,
claudeRemoteLauncher) touch disjoint files *except* both ultimately relate to the
consumption-ack surface — so **US-004 ships last and rebases onto US-002/US-003**.
US-001 is fully disjoint (package.json/configuration imports) and can land any time
after US-000.

---

## 8. i18n

**N/A.** happy-cli has no user-facing translation surface; no `translations.ts`
touch. (Called out explicitly because the R8 template has an i18n section — for the
CLI it is empty by design.)

---

## 9. Estimated conflict-surface reduction

| lever | files Δ | hunks Δ | gated? |
|---|---:|---:|:--:|
| US-000 catalogue + markers (localization; M1-style — converts blind ports to decisions) | 0 | ~−5 (residual sites collapse under expanded markers) | no |
| US-001 mechanical (`package.json` + import align) | **−1** (package.json may auto-resolve) | ~−3 | no |
| US-002 deferred-switch extraction | 0 | ~−2..−3 | no |
| US-003 MQ2 field-order alignment | 0 | ~−2..−3 | no |
| **subtotal (no operator gate)** | **~−1..−2** | **~−12..−14** | — |
| US-004 attachment-model convergence | ~−1 (MQ2.test may simplify) | **~−6..−10** | **YES** |
| **subtotal (with operator GO)** | **~−2..−3** | **~−18..−24** | — |

**Bottom line:**
- Without operator gate: **33 → ~31–32 files**, **83 → ~65–70 hunks** (mostly
  *localized*, per M1's proven pattern — the real win is per-conflict effort).
- With US-004 operator GO: **83 → ~55–60 hunks**.

This is deliberately conservative and consistent with M1 (seam relocation removed ~0
files) and R8 (SYNC-R5 residual stayed convergent). **Do not over-promise file-count
reduction** — the value proposition is a fully-catalogued, marker-guided intake, not
a shrunken file list.

---

## 10. Risks & open questions

- **R1 — Deferred-switch extraction entanglement (US-002).** Upstream rewrote the
  same switch mechanism; the seam may interleave with upstream Stop/Notification hook
  wiring. *Mitigation:* AC permits catalogue-only fallback; do not force a fragile
  move.
- **R2 — Field-order alignment masks a real diff (US-003).** Reordering must be a
  *pure* reorder — verify the fork-only fields (`delivery`, `consumedMessages`) are
  genuinely additive, not value-changing an upstream field. *Mitigation:* typecheck +
  MessageQueue2.test must stay green; diff-review each reordered literal.
- **R3 — Attachment convergence scope creep (US-004).** Retiring ref-indirection
  touches the `.happy/attachments/*` writeFile-RPC path and its tests. *Mitigation:*
  operator-gated; default KEEP; if approved, scope strictly to the model swap and
  re-run the attachment test suite.
- **R4 — Test-follows-source drift.** Test conflicts (20 hunks) resolve by mirroring
  their source's HC decision; a porter who resolves the source but blind-merges the
  test can desync. *Mitigation:* the `// FORK PATCH: test tracks HC-<n>` breadcrumbs.
- **Open question (operator):** US-004 — converge attachment model to upstream
  inline-bytes, or KEEP the fork's ref-based `.happy/attachments/*` model? This is the
  **only** genuine operator-decision in the job. Recommendation: **converge** if the
  ref-indirection is not required by another fork consumer (biggest reduction);
  otherwise KEEP. All other calls are made autonomously (KEEP + catalogue).

---

## 11. Acceptance criteria & gates

Per-story gate (run from repo root; happy-cli package filter is `happy`):

```
npm_config_script_shell=bash pnpm --filter happy test          # full happy-cli suite green
pnpm --filter happy typecheck                                  # clean
```

File-scoped fast gate while iterating:

```
pnpm --filter happy exec vitest run src/utils/MessageQueue2.test.ts src/api/apiSession.test.ts …
```

Global acceptance for the job:

1. `docs/happy-patch-surface.md` §4 carries HC-8..HC-19 with correct file lists +
   decisions; existing HC-1..HC-7 unchanged.
2. Every one of the 21 prod conflict files carries a `// FORK PATCH:` marker citing
   its HC id at each conflict site; every one of the 11 test files carries a
   `test tracks HC-<n>` breadcrumb.
3. `src/fork/claudeDeferredSwitch.ts` exists with HC-10 header **OR** US-002 recorded
   the catalogue-only fallback with rationale.
4. Behavior parity: `pnpm --filter happy test` + `typecheck` green after every story;
   no wire-protocol/RPC/flag/codec change (except US-004 if operator-approved).
5. A fresh 3-way (§3.1 method) re-run shows the hunk budget moved into the §9 range;
   record the before/after count in the ship note.
6. US-004 is **not** merged without an explicit operator GO recorded in the job log.

---

## 12. Deliverables

**This planning job produces exactly two markdown files** (no source edits/builds/
tests):

- `.ralph/jobs/happy-cli-conflict-reduction-hotspots/plan.md` (this file)
- `.ralph/jobs/happy-cli-conflict-reduction-hotspots/stories-outline.md`

The implementation stories (US-000..US-004) are executed in a *separate* impl job.
