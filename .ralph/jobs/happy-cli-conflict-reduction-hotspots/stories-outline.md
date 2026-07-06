# Stories outline — happy-cli upstream conflict-surface reduction

**Job:** `happy-cli-conflict-reduction-hotspots` · companion to `plan.md`
**Hard constraint:** every story is **behavior-preserving** (byte-identical `happy`/
`happy-dev` behavior) EXCEPT US-004, which is explicitly operator-gated.
**Gate (per story, from repo root):**
`npm_config_script_shell=bash pnpm --filter happy test` **and**
`pnpm --filter happy typecheck` — both must stay green.
File-scoped fast gate: `pnpm --filter happy exec vitest run <paths>`.

Ship order:

```
US-000 ── first (unblocks all)
  ├─ US-001 ─┐ disjoint files → parallel-safe after US-000
  ├─ US-002 ─┤
  └─ US-003 ─┘
US-004 ── LAST, only on operator GO (rebases onto US-002/US-003)
```

---

## US-000 — Catalogue the uncatalogued hotspots + drop FORK PATCH markers (HC-8..HC-19)

**Type:** localization (docs + comments only) · **Behavior change:** none · **Deps:** none · **Unblocks:** US-001, US-002, US-003, US-004

**Scope:**
- Append rows **HC-8..HC-19** to `docs/happy-patch-surface.md` §4 with the exact
  file lists + KEEP/KEEP-DELETED/RESTORE decisions from plan §4. Leave HC-1..HC-7
  untouched.
- Add a `// FORK PATCH: [KEEP|KEEP-DELETED] <reason> (invariant HC-<n>)` marker at
  each conflict site in the **21 prod files**:
  - HC-8 `utils/MessageQueue2.ts`
  - HC-9 `claude/utils/sessionScanner.ts`
  - HC-10 `claude/claudeLocalLauncher.ts`, `claude/session.ts`
  - HC-11 `claude/claudeRemoteLauncher.ts`, `claude/claudeRemote.ts`
  - HC-12 `configuration.ts`
  - HC-13 `claude/sdk/query.ts`
  - HC-14 `commands/codexCommand.ts`
  - HC-15 `claude/utils/permissionHandler.ts`
  - HC-16 `claude/utils/sessionProtocolMapper.ts`
  - HC-17 `utils/createSessionMetadata.ts`, `persistence.ts`, `modules/common/registerCommonHandlers.ts`
  - HC-18 `api/api.ts` — marker where upstream's `push()` getter would land, noting
    **KEEP-DELETED: do not resurrect push client (no central server)**
  - HC-19 `codex/codexAppServerClient.ts`
  - (expand HC-1/2/3 markers in `api/apiSession.ts` to cover the 10 residual
    protocol sites)
- Add a one-line `// FORK PATCH: test tracks HC-<n>` breadcrumb to each of the **11
  test files** (`apiSession.test.ts`→2, `MessageQueue2.test.ts`→8,
  `sessionScanner.test.ts`→9, `claudeLocalLauncher.test.ts`→10,
  `claudeRemote.test.ts`→11, `codexCommand.test.ts`→14, `runClaude.test.ts`→5,
  `createSessionMetadata.test.ts`→17, `codexAppServerClient.test.ts`→19,
  `executionPolicy.test.ts`→19, `serverConnectionErrors.test.ts`→12).

**AC:**
1. `docs/happy-patch-surface.md` §4 has HC-8..HC-19 with correct file lists +
   decisions; HC-1..HC-7 unchanged.
2. Every listed prod file carries an HC-citing `// FORK PATCH:` marker at its
   conflict site(s); every listed test file carries a `test tracks HC-<n>` breadcrumb.
3. No non-comment/non-docs edits. `pnpm --filter happy typecheck` clean;
   `pnpm --filter happy test` green.

---

## US-001 — Mechanical noise alignment (package.json + import ordering)

**Type:** DISABLE-align (cosmetic) · **Behavior change:** none · **Deps:** US-000 · **Parallel-safe** with US-002/US-003 (disjoint files)

**Scope:**
- `packages/happy-cli/package.json`: normalize dep/version ordering toward upstream
  `cli-1.1.10` **only** where the fork does not require the delta; keep every
  fork-required dep/version. Goal: shrink the mechanical hunk toward auto-resolve.
- Review `.gitattributes` for a `merge=union`/normalization entry that would
  auto-resolve the version churn line if appropriate.
- Align import-line churn: `configuration.ts` (`chmodSync`/`readFileSync` import
  merge toward upstream order) and the `api/apiSession.ts` import block ordering —
  **imports only, no logic**.

**AC:**
1. `package.json` diff vs upstream reduced to genuinely fork-required deltas only.
2. `configuration.ts` **retains** the `http://127.0.0.1:3005` default (HC-12) — only
   the import statement ordering changes.
3. No behavior/logic change. `typecheck` clean; `test` green.

---

## US-002 — Extract Claude deferred-switch → `src/fork/claudeDeferredSwitch.ts` (HC-10)

**Type:** KEEP → relocate (R8-style seam) · **Behavior change:** none (pure move) · **Deps:** US-000 · **Parallel-safe** with US-001/US-003

**Scope:**
- Create `src/fork/claudeDeferredSwitch.ts` (header
  `// FORK PATCH: KEEP Claude deferred-switch protocol (invariant HC-10)`).
- Relocate from `claude/claudeLocalLauncher.ts` + `claude/session.ts`:
  `performSwitch`, the `request-switch` / `cancel-pending-switch` RPC registration,
  `setPendingSwitch` / `pendingSwitch` state accessors, `closeClaudeSessionTurn`.
- Replace the inline logic with thin seam calls
  (`installClaudeDeferredSwitch(session, api)` + a pending-state accessor), each
  carrying an HC-10 marker.
- Preserve the SDK-summary forwarding behavior (fork removed upstream's "Block SDK
  summary messages" filter — keep it forwarded).

**AC:**
1. `src/fork/claudeDeferredSwitch.ts` exists with HC-10 header; call sites in
   `claudeLocalLauncher.ts` + `session.ts` are thin seams with HC-10 markers.
2. Emitted behavior identical — deferred-switch RPC + turn finalization unchanged;
   `claudeLocalLauncher.test.ts` green.
3. **Fallback allowed:** if extraction entangles upstream Stop/Notification hook
   wiring, record catalogue-only (leave the logic in place with HC-10 markers) + a
   one-paragraph rationale in the ship note. Either outcome satisfies this story.
4. `typecheck` clean; full `pnpm --filter happy test` green.

---

## US-003 — MessageQueue2 object-literal field-order alignment (HC-8 cosmetic slice)

**Type:** DISABLE-align (cosmetic) · **Behavior change:** none · **Deps:** US-000 · **Parallel-safe** with US-001/US-002

**Scope:**
- In `utils/MessageQueue2.ts` conflicts C4/C6/C12, reorder the fork's object-literal
  fields so upstream-shared fields (`isolate`, `attachments`) appear **in upstream's
  order first**, with fork-only fields (`delivery`, `consumedMessages`) **appended
  last**. This collapses the ordering-only portion of each hunk so only the true
  value-diff remains.
- Pure reorder — do NOT change any field value or type. Keep HC-8 markers.

**AC:**
1. The three literals emit identical objects (verified by `MessageQueue2.test.ts`
   green) — only source field order changed.
2. A fresh 3-way (plan §3.1) shows C4/C6/C12 shrunk to value-only diffs.
3. `typecheck` clean; `test` green.

---

## US-004 — [OPERATOR-GATED] Attachment-model convergence (HC-8 RESTORE-toward-upstream)

**Type:** RESTORE-toward-upstream · **Behavior change:** YES (observable) · **Deps:** US-000, US-002, US-003 · **Ships LAST, only on explicit operator GO**

**Scope (only if operator approves):**
- Adopt upstream's inline-bytes `PendingAttachment{data:Uint8Array, mimeType, name}`
  model in `utils/MessageQueue2.ts`, `claude/claudeRemoteLauncher.ts`, and
  `api/apiSession.ts` file-events, retiring the fork's ref-based
  `MessageQueueAttachment{type, ref, mimeType}` + `.happy/attachments/*` writeFile-RPC
  indirection.
- Update HC-8 catalogue row from KEEP to RESTORE with the convergence date +
  rationale; update the affected `// FORK PATCH:` markers.
- Re-run the attachment path end-to-end (send + receive with an attachment).

**Default if undecided:** **KEEP** — do nothing (US-000 markers already document HC-8).
No code change ships without operator GO recorded in the job log.

**AC:**
1. Operator GO recorded in the job log BEFORE any code change.
2. Attachment send/receive works with upstream's inline-bytes model; the ref-based
   `.happy/attachments/*` path is fully removed (no dead code).
3. `MessageQueue2.test.ts` + `apiSession.test.ts` updated + green; full
   `pnpm --filter happy test` green; `typecheck` clean.
4. Fresh 3-way shows the HC-8 cluster reduced by ~6–10 hunks.

---

## Coverage check — every conflict file maps to a story

| story | files touched |
|---|---|
| US-000 | all 21 prod files (markers) + all 11 test files (breadcrumbs) + `docs/happy-patch-surface.md` |
| US-001 | `package.json`, `configuration.ts` (imports), `api/apiSession.ts` (imports), `.gitattributes` |
| US-002 | `claude/claudeLocalLauncher.ts`, `claude/session.ts`, **new** `src/fork/claudeDeferredSwitch.ts` |
| US-003 | `utils/MessageQueue2.ts` (field order) |
| US-004 | `utils/MessageQueue2.ts`, `claude/claudeRemoteLauncher.ts`, `api/apiSession.ts` (attachment model) — *gated* |

Files whose ONLY treatment is US-000 cataloguing (KEEP + marker, no further change):
`apiMachine.ts`, `runClaude.ts`, `runCodex.ts`, `daemon/run.ts` (HC-4/5/6/7 residual,
already thin), `sessionScanner.ts` (HC-9), `claudeRemote.ts` (HC-11), `sdk/query.ts`
(HC-13), `codexCommand.ts` (HC-14), `permissionHandler.ts` (HC-15),
`sessionProtocolMapper.ts` (HC-16), `createSessionMetadata.ts` / `persistence.ts` /
`registerCommonHandlers.ts` (HC-17), `api/api.ts` (HC-18 KEEP-DELETED),
`codexAppServerClient.ts` (HC-19), and all 11 test files. This is the honest
majority: **most CLI hotspots are catalogue-only** because their divergence is
load-bearing convergent-evolution, not extractable or revertible.
