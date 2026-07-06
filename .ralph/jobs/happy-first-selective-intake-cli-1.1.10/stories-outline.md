# Stories outline — First selective upstream intake of `cli-1.1.10`

**Task:** `happy-first-selective-intake-cli-1.1.10` · Plan: [`plan.md`](./plan.md) · Catalogue:
[`docs/happy-patch-surface.md`](../../../docs/happy-patch-surface.md)

Ship order **server → cli → app**. Each story is a self-contained commit set; the audit
(`node scripts/audit-happy-fork-patches.mjs`) must show **zero drift** before advancing. Auth-plane
server stories (S1/S2) are **not** parallelized. The §6 baseline advances to `cli-1.1.10` **only** at
`Sfin`. **Re-measure** the classification + merge-file at the start of each package (counts below are the
`a0a42f03` measurement and can drift).

Legend for dispositions: **KEEP** = keep fork, hand-port non-fork hunks · **KEEP-DELETED** = take-ours,
never resurrect · **RESTORE/adopt** = take upstream (deliberate, tested) · **auto** = clean auto-merge
(verify) · **clean-adopt** = fork==base, take upstream + typecheck.

---

## S0 — Intake prep + baseline (no package edits)

**Scope:** host setup + re-measure + the §6 merge-base correction (operator call #0).
**Acceptance criteria:**
- `git config merge.ours.driver true` set on the host; `git fetch --no-tags upstream-happy main` +
  `… tag cli-1.1.10` confirm `cli-1.1.10`=`71c417e1`, merge-base(HEAD,cli-1.1.10)=`df4cdae8`.
- `classify2.mjs` + `mergefile.mjs` re-run; current per-package hard-conflict counts recorded in the
  stage commit message (baseline 7/30/59).
- §6 "no merge-base" wording corrected to cite `df4cdae8` (reconciled with R5) — **docs only**, no
  behavior change.
**Gates:** classification reproduces; `node scripts/audit-happy-fork-patches.mjs` 0-drift.

---

## S1 — Server auth cluster (SERIALIZED)

**Scope:** `sources/app/api/api.ts` (HS-1/2/7/18, 6 hunks), `sources/app/api/socket.ts` (HS-3/9, 3 hunks).
**Recipe:** KEEP; start from OURS; hand-port only upstream's non-auth hunks. `installForkAuthPlane` stays
**before** `registerForkRoutes`; **no** per-request/per-socket `userId` reintroduced (HS-9); push getter
stays absent (HS-18 mirrors HC-18).
**Acceptance criteria:**
- api.ts/socket.ts compile; the fork route allowlist + CORS (`fork/registerForkRoutes.ts`,
  `fork/forkCors.ts`) unchanged; public-mode `onRequest` httpGuard still fronts every route.
- No `userId` threading, no `push()`/`pushClient`, no attachment routes reintroduced.
**Gates (FULL):** `pnpm --filter happy-server typecheck` + the **6-spec auth set** (`publicAuthGate`,
`remoteDeviceAuth`, `deviceEnrollment`, `socket`, `index`, `dualListenerBinding`) + audit 0-drift.
**Not parallel-safe.**

## S2 — Server non-auth hard-conflicts (after S1)

**Scope:** `utils/log.ts` (HS-11, 5), `app/events/eventRouter.ts` (HS-10, 2),
`app/api/routes/pushRoutes.ts` (HS-12, 1), `app/monitoring/metrics2.ts` (HS-13, 1), `package.json`
(HS-15, 5).
**Recipe:** KEEP each; log.ts reconciles onto upstream `pretty()`+`pino.multistream` (quiet-gate stays in
`fork/forkLogger.ts`); eventRouter keeps single-user room model (port only new event kinds); pushRoutes
KEEP fork route; metrics2 keeps exact `db.count()` + no `Account` gauge; package.json manual-3-way (keep
pkgroll packaging + fork deps; take dep bumps by hand; **Trap B** pin re-verify).
**Acceptance criteria:** all compile; metrics still 3-gauge (no Account); logger quiet-gate intact;
manifest keeps fork packaging; adopted dep bumps listed in commit message.
**Gates:** server typecheck + audit + **re-run the 6-spec auth set** (log/eventRouter touch startup).

## S3 — Server clean-auto + clean-adopt + gaps (after S1/S2; parallel-safe)

**Scope:**
- auto-merge (verify): `README.md`, `v3SessionRoutes.ts`+`.test.ts` (HS-4), `processImage.spec.ts` (HS-16
  RESTORE verbatim), **`app/session/sessionDelete.ts` (GAP)**, **`storage/files.ts` (GAP)**.
- clean-adopt: `.gitignore`, `deploy/handy.yaml`, `enableErrorHandlers.ts`, `monitoring/metrics.ts`,
  `standalone.ts`, `tsconfig.json`.
- add/add take-ours: `sources/index.ts` (HS-14).
- KEEP-DELETED: `routes/voiceRoutes.ts` (HS-7) — do not resurrect.
**Acceptance criteria:**
- The 2 gap files' auto-merge output verified behavior-correct; **HS rows added** for sessionDelete.ts +
  files.ts (findings rec #5); README/handy adopt clean; index.ts stays fork embedded-server entry;
  voiceRoutes remains absent.
**Gates:** server typecheck + audit 0-drift (audit must still recognize the new HS rows).

## S4 — Server upstream-new triage (parallel-safe)

**Scope:** the 11 upstream-new server files.
**Recipe:** **SKIP** `attachmentRoutes.ts`+`.spec.ts` (HS-7), `machinesRoutes.spec.ts` (HS-7),
`push/pushDispatch.ts` (account-based), `monitoring/metrics2.test.ts` (Account gauge, HS-13),
`bin/happy-server.cjs`+`bin/index.cjs`+`scripts/build-runtime.cjs` (packaging, HS-15).
**Operator call #2 (behavior-changing ADOPT):** `push/pushSend.ts` (no tenancy — lean ADOPT),
`app/standalone.spec.ts` (test for adopted standalone.ts — lean ADOPT), `push/focusTracker.ts` (userId —
lean SKIP/adapt). Record each decision.
**Gates:** server typecheck + audit 0-drift.

> **Server stage boundary — PAUSE for operator review before FF-merge to `main`** (first behavior-affecting
> intake; op calls #1/#2). Lead may drive S1–S4 to green on a `ralph/intake-cli-1.1.10-server` topic
> branch autonomously.

---

## S5 — CLI E2E-codec + queue (SERIALIZED core path)

**Scope:** `api/apiSession.ts` (HC-1/2/3, 11) + `.test.ts` (7); `utils/MessageQueue2.ts` (HC-8, 12) +
`.test.ts` (1).
**Recipe:** KEEP. apiSession stays plaintext-JSON codec via `sessionPayloadCodec.ts` (do **not** reinstate
`encrypt`/`decrypt` on send/live; the fetch-path asymmetry HC-3 stays **unfixed** — not an M1 fix).
MessageQueue2 keeps attachment-by-ref + consumption-ack delivery (US-004 convergence stays operator-gated,
default KEEP).
**Acceptance criteria:** send/live paths plaintext; no E2E reintroduced; queue delivery-receipt surface
intact.
**Gates:** `pnpm --filter happy typecheck` + `pnpm --filter happy test` (**no** `npm_config_script_shell=bash`).

## S6 — CLI claude/codex/daemon wiring (after S5, SERIALIZED)

**Scope:** HC-4 `codex/runCodex.ts`, HC-5 `claude/runClaude.ts`, HC-6 `daemon/run.ts`, HC-7
`api/apiMachine.ts`, HC-9 `sessionScanner.ts`(+test), HC-10 `claudeLocalLauncher.ts`+`session.ts`, HC-11
`claudeRemoteLauncher.ts`+`claudeRemote.ts`, HC-13 `sdk/query.ts`, HC-14 `commands/codexCommand.ts`(+test),
HC-15 `permissionHandler.ts`, HC-16 `sessionProtocolMapper.ts`, HC-19
`codex/codexAppServerClient.ts`(+test)+`executionPolicy.test.ts`.
**Recipe:** KEEP each; the R4 seams (`fork/onCodexRun.ts`, `fork/onClaudeRun.ts`, `fork/forkHooks.ts`)
stay — `runCodex/runClaude/run.ts/apiMachine.ts` remain thin delegating seams. Keep deferred-switch
(HC-10), consumption receipts (HC-11), per-query env (HC-13), ws-transport (HC-19).
**Acceptance criteria:** all compile; fork seams intact; ink/react not dragged into daemon startup graph.
**Gates:** cli typecheck + test.

## S7 — CLI config/metadata + manifest (after S6, SERIALIZED)

**Scope:** HC-12 `configuration.ts`+`serverConnectionErrors.test.ts`, HC-17 `createSessionMetadata.ts`(+test)
+`persistence.ts`+`registerCommonHandlers.ts`, HC-18 `api/api.ts` (guard-by-absence), `package.json`.
**Recipe:** KEEP; **`serverUrl` default `http://127.0.0.1:3005` MUST survive** (HC-12, architectural — never
take upstream's `https://api.cluster-fluster.com`). No `push()` on `ApiClient` (HC-18). package.json: **Trap
A** — do NOT re-sort `happy-server` dep; **Trap B** — re-verify fork pins by hand.
**Acceptance criteria:** HC-12 default asserted by `serverConnectionErrors.test.ts`; no push client; pins
re-verified; manifest keeps fork packaging.
**Gates:** cli typecheck + test.

## S8 — CLI clean-auto + clean-adopt + upstream-new (after S5–S7; parallel-safe)

**Scope:** 11 auto-merge (verify: README, runAcp, api/types, loop, sdk/types, sessionProtocolMapper.test,
codexAppServerTypes, executionPolicy, index, serverConnectionErrors, vitest.config); 14 clean-adopt; 39
upstream-new (triage — adopt bugfixes, SKIP anything threading userId/account/central-push).
**Acceptance criteria:** auto-merges compile + preserve fork behavior; upstream-new adopt/skip decisions
recorded; no central-push/multi-machine plane introduced.
**Gates:** cli typecheck + test + audit 0-drift.

> **CLI stage boundary — PAUSE for operator review before FF-merge** (op calls #7/#8). Lead may drive
> S5–S8 to green on a `ralph/intake-cli-1.1.10-cli` topic branch autonomously.

---

## A0 — App catalogue-extension (OPERATOR-REVIEWED; gates all app work)

**Scope:** add HA rows for the ~36 uncatalogued hard-conflict app files (top: `app/(app)/new/index.tsx`
20 hunks — fork 583 vs upstream 1851; the `sync/messageMeta*`+`sync/typesRaw` cluster; the tools cluster
`ToolView`/`CodexPatchView`/`PermissionFooter`; `ActiveSessionsGroupCompact`, `SessionsList`,
`useSessionQuickActions`, `apiSocket`, `suggestionCommands`, the `sync/*` type+persistence files, the
route `_layout.tsx`/`info.tsx` files, `SettingsView`, `FilesSidebar`, `modelModeOptions*`).
**Acceptance criteria:** each uncatalogued hard file classified KEEP vs adopt with a one-line rationale +
a new HA row (id, disposition, guard test); operator sign-off on the KEEP/adopt set. **No code edits** —
catalogue + design only.
**Gates:** catalogue review; audit 0-drift (new rows recognized). **Not parallel-safe** — gates A1–A5.

## A1 — App sync plane (HA-1/HA-2 — `start-from-OURS`)

**Scope:** `sync/sync.ts` (HA-1, 23), `sync/storage.ts` (HA-2, 24).
**Recipe:** §8 R5 exactly — start from OURS; prune unbacked upstream imports (`Encryption`/`apiFeed`/
`apiFriends`); take-ours `fetchMachines`/`sendMessage`/`fetchMessages` (`decodeApiMessages`, not
`decryptMessages`); take-ours multi-account removals (HA-1a/2a), tree-grouping, `userChosen`,
render-window fields. **HA-1b unread-tracking stays DEFERRED** (op call #6) — drop upstream's unread
additions.
**Acceptance criteria:** compile; grep `applyFriends`/`applyFeedItems`/`unreadSessionIds`/`friendTypes`
under `sources/sync` == **0** hits.
**Gates:** app typecheck + audit + HA-1/HA-2 guard specs (`messageWindow.spec`, `applyPrefetchedRange.spec`,
`machineFallbacks.test`, `storage.tree.spec`, `storagePermissionModeUserChosen.test`,
`encryptionDeletion.spec`). **Not parallel-safe.**

## A2 — App UI seams (catalogued HA rows)

**Scope:** HA-3 `reducer.ts`, HA-4 `SessionView.tsx`, HA-5 `ChatList.tsx`, HA-6 `AgentInput.tsx`, HA-8
`MarkdownView.tsx`+`parseMarkdownBlock.test.ts`, HA-9 `MessageView.tsx`, HA-10 `SidebarView.tsx`, HA-11
`SidebarNavigator.tsx`, HA-12 `ChatHeaderView.tsx`.
**Recipe:** KEEP; the R8 `sources/fork/{chat,message,agentInput,session}/*` seams + `RESTORE-R8*` markers
stay; hand-port only upstream's non-fork hunks. Preserve the e-ink toggles (chatToolGrouping default
`flat`, messageCommandChips default `false`) and the mic/voice inert-restore (HA-6).
**Acceptance criteria:** compile; markers intact (audit resolves each `(invariant HA-n)`); default
rendering behavior-identical for e-ink.
**Gates:** app typecheck + audit + the HA guard tests. **Not parallel-safe** (shared imports).

## A3 — App uncatalogued hard files (per A0 rulings)

**Scope:** `new/index.tsx` (KEEP — fork single-user new-session; hand-port non-account bugfixes) + the
~35 others per A0. **KEEP-DELETED guard** for the ~8 removed-plane files (`CLAUDE.md`, `user/[id].tsx`,
`secretKeyBackup.spec`, `encryption/base64`, `encryption/deriveKey`, `apiGithub.spec`,
`encryption/encryption`, `encryption/encryptor`) — never resurrect.
**Acceptance criteria:** compile; each new HA row's guard passes; resurrection grep == 0; no
encryption/multi-account/github plane reintroduced.
**Gates:** app typecheck + audit 0-drift + resurrection grep.

## A4 — App translations + `_default` (HA-7, manual)

**Scope:** the 10 locale files + `_default.ts`.
**Recipe:** manual 3-way (NOT merge=union — TS1117 risk); reconcile upstream's new keys against the R8
additions (toolGroup, chatToolGrouping, messageCommandChips, message.sentAsGoal).
**Acceptance criteria:** `sources/text/translations.test.ts` parity green; no duplicate keys.
**Gates:** app typecheck + parity test. **Parallel-safe after A2.**

## A5 — App clean-auto + clean-adopt + upstream-new (parallel-safe)

**Scope:** 17 auto-merge (verify), 37 clean-adopt, 62 upstream-new (+6 add/add).
**Recipe:** verify auto-merges (esp. any near removed planes); clean-adopt + typecheck; triage
upstream-new — adopt e-ink-compatible UI bugfixes, **SKIP** multi-account/encryption/github/realtime-voice
additions.
**Acceptance criteria:** compile; adopt/skip decisions recorded; no removed plane reintroduced.
**Gates:** app typecheck + audit 0-drift.

> **App stage boundary — operator-driven throughout** (A0 is an operator-reviewed design gate; A1–A5 run
> under operator review, not autonomous).

---

## Sfin — Finalize (advance baseline)

**Scope:** advance §6 baseline record → `cli-1.1.10` (`71c417e1`); update catalogue header + §9 cadence
note; re-tree-match if a tighter anchor appears.
**Acceptance criteria:** all three packages' full gates green; `node scripts/audit-happy-fork-patches.mjs
--strict` exits 0 (zero drift); §6 baseline = `cli-1.1.10`; the 3 post-tag `upstream-happy/main` commits
recorded as a follow-up task (op call #5).
**Gates:** full-package typecheck (all 3) + server auth 6-spec + `pnpm --filter happy test` + app parity +
`--strict` audit.

---

### Parallelization summary

- **Serialize:** S1→S2 (auth), S5→S6→S7 (cli core/session graph), A0→(A1,A2,A3) (catalogue gates app).
- **Parallel-safe:** S3/S4 (after S1/S2), S8 (after S5–S7), A4/A5 (after A2).
- **Stage boundaries pause for operator review** before FF-merge (server, cli) and throughout app.
