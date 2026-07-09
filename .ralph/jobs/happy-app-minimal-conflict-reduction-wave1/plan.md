# Plan — Wave 1 MOVE refactors (`happy-app-minimal-conflict-reduction`)

**Job:** `happy-app-minimal-conflict-reduction-wave1`
**Phase:** PLAN (markdown-only; NO code)
**Worktree / branch:** `D:/harness-efforts/codexu/.worktrees/plan-app-wave1` on `ralph/plan-app-wave1` (off `main` @ `f65d67d9b`)
**Baseline:** `cli-1.1.10` (`71c417e1`) — **already fully merged into HEAD** (`git merge-base --is-ancestor cli-1.1.10 HEAD` = YES).
**Source brainstorm:** `.ralph/brainstorms/happy-app-minimal-conflict-reduction-inherit-upstream/brainstorm.md`
**Catalogue:** `docs/happy-patch-surface.md` §5 (HA rows), §1 (marker convention), §2 (buckets).

---

## TL;DR — the Wave 1 premise does not hold; scope is radically narrowed

I source-verified all nine Wave-1 candidate files with `git diff cli-1.1.10 HEAD`
(the fork's net divergence, because `cli-1.1.10` is the current merge-base).
**The brainstorm's Wave-1 premise — "these are clean additive-lists; revert the
canonical to `cli-1.1.10` to inherit upstream's newer entries while fork rows
move to a `sources/fork/` module" — is INCORRECT for 8 of the 9 files.**

Because `cli-1.1.10` is already merged, "revert canonical to `cli-1.1.10`" means
**adopt the `-` (upstream) side and drop the `+` (fork) side of `git diff cli-1.1.10 HEAD`.**
For 8 of 9 files that is a **regression** (it deletes fork-authored behavior and/or
**resurrects deliberately-removed upstream constructs**, including the E5 voice
`voiceUpsellOverride`), not an inherit. The catalogue (`docs/happy-patch-surface.md`
§5) already frames HA-30/31/33/40/46/47 as **"KEEP fork body; hand-port additive
upstream rows"** — i.e. a surgical additive hand-port, NOT a whole-file
revert-to-upstream MOVE. My verification confirms the catalogue, not the brainstorm.

**MOVE-eligibility test** (derived below): a file is Wave-1-MOVE-eligible **iff its
entire fork divergence is purely ADDITIVE** — the fork only *added* entries/consts,
*removed nothing* upstream-canonical, and *rewrote no* upstream function. You cannot
"move a removal to an overlay" (the canonical would re-include the removed construct,
resurrecting it) and you cannot express a rewritten resolver as a `[...upstream, ...fork]`
list concat.

Applying that test:

| Genuinely actionable in Wave 1 | Count |
|---|---|
| **HA-37** `autocomplete/suggestions.ts` — PARTIAL MOVE (extract the two e-ink numeric caps to a fork const module; `source` passthrough stays as HA-36 glue) | 1 (clean-ish) |
| **HA-40** `modelModeOptions.ts` — OPTIONAL two-row micro-ALIGN (adopt upstream `opus 4.8` label + re-add `xhigh` effort). Operator-gated. Does NOT reduce the file's conflict surface. | 1 (optional) |
| **Deferred** (entangled rewrite / fork-ahead / core sync schema / build config / resurrection hazard): HA-23, HA-30, HA-31, HA-33, HA-36, HA-40/41-resolvers, HA-46, HA-47 | 7 files |

**Net recommendation:** ship Wave 1 as **one clean story (HA-37 caps MOVE)** plus an
**optional operator-gated micro-ALIGN story (HA-40 opus-4.8 + xhigh)**. Defer the other
seven files to dedicated later waves; this plan gives each its correct future design so
those waves start with a head-start rather than a blank page. **Do NOT force whole-file
revert seams** on the deferred files — doing so drops fork behavior (the cardinal sin of
this whole workstream) and resurrects removed planes.

---

## §1 Method & diff-direction (read this before touching anything)

- **Command of record:** `git --no-pager diff cli-1.1.10 HEAD -- <path>`, with
  `git config core.autocrlf false` set this session for clean LF diffs.
- **Diff direction:** `-` lines = `cli-1.1.10` (upstream baseline). `+` lines = `HEAD`
  (fork). **"Revert canonical to `cli-1.1.10`" = adopt `-`, drop `+`.**
- **Why "revert-to-upstream" ≠ "inherit-upstream-feature" here:** `cli-1.1.10` is the
  *current merge-base*, already merged into HEAD. So `git diff cli-1.1.10 HEAD` is the
  fork's **net divergence**, not "upstream ahead of fork." A canonical revert *inherits*
  something only where the intake resolved take-ours and left the fork **behind** a newer
  upstream value (a `-`-side value that is genuinely newer than the fork's `+` value with
  no fork intent). In the entire Wave-1 set that is **exactly two list rows** in
  `modelModeOptions.ts` (opus `4.8` label + `xhigh` effort). Everywhere else the `+`
  (fork) side is deliberate fork behavior.
- **MOVE-eligibility test (the elegant core, corrected):** MOVE works for **purely
  additive** fork divergence — fork *appended* entries → move the appended entries to a
  `sources/fork/` overlay and let the canonical drop back to upstream shape + a
  `[...upstream, ...fork]` seam. MOVE does **NOT** work when the fork:
  - **removed** an upstream construct (moving a removal to an overlay would resurrect the
    construct → that is a **KEEP-DELETED guard**, not a MOVE), or
  - **rewrote** an upstream function's body/return (the canonical would revert to
    upstream's return value; you'd need a behavioral override seam, not a list concat →
    not a Wave-1 list-MOVE).

---

## §2 Per-file findings (all 9, source-verified)

Legend — **Class**: `ADDITIVE` (pure append, MOVE-eligible) / `REWRITE` (fork rewrote
upstream fn) / `REMOVAL` (fork deleted upstream construct — resurrection hazard on revert)
/ `FORK-AHEAD` (fork authored code absent from `cli-1.1.10`) / `CONFIG` (fork-owned build
config). Most files are **mixed**.

### HA-37 — `components/autocomplete/suggestions.ts`  · 9Δ · **PARTIAL-MOVE (actionable)**
- **Divergence (verified):** fork added `export const MAX_COMMAND_SUGGESTIONS = 15`
  (upstream inline `limit: 50`), changed the command `limit: 50 → MAX_COMMAND_SUGGESTIONS`,
  changed the file-mention `limit: 50 → 5`, and added a `source: cmd.source` passthrough to
  `CommandSuggestion`.
- **Class:** the two numeric caps are **cleanly extractable** (fork intent = e-ink cap).
  The `source: cmd.source` line is **NOT** an isolated cap — it is glue for the fork's
  `CommandSource` badge system: `CommandSuggestion` (in `AgentInputSuggestionView.tsx`) now
  requires a non-optional `source: CommandSource` prop and renders plugin/skill badge icons,
  and `CommandSource` is a **type exported from `sync/suggestionCommands.ts`** (the
  wholesale-rewrite file deferred as HA-36). `suggestions.test.ts:29-51` has a dedicated
  "passes every command source through" test.
- **MOVE design (caps only):**
  1. New module `packages/happy-app/sources/fork/autocomplete/forkSuggestionLimits.ts`:
     ```ts
     // FORK PATCH: [MOVE-W1] e-ink autocomplete caps relocated from suggestions.ts (invariant HA-37)
     // Logic relocated to sources/fork/autocomplete/forkSuggestionLimits; see docs/happy-patch-surface.md §5.
     export const FORK_COMMAND_SUGGESTION_LIMIT = 15; // upstream default 50; capped for e-ink density
     export const FORK_FILE_MENTION_LIMIT = 5;        // upstream default 50; capped for e-ink density
     ```
  2. Canonical `suggestions.ts`:
     - `import { FORK_COMMAND_SUGGESTION_LIMIT, FORK_FILE_MENTION_LIMIT } from '@/fork/autocomplete/forkSuggestionLimits';`
     - **Re-export to preserve the public name the test imports** (`suggestions.test.ts:22,42`
       imports `MAX_COMMAND_SUGGESTIONS` from `./suggestions`):
       `export const MAX_COMMAND_SUGGESTIONS = FORK_COMMAND_SUGGESTION_LIMIT;`
     - Command call: `{ limit: MAX_COMMAND_SUGGESTIONS }` (unchanged reference).
     - File call: `{ limit: FORK_FILE_MENTION_LIMIT }`.
     - Add marker on the seam line:
       `// FORK PATCH: [MOVE-W1] suggestion caps relocated to sources/fork/autocomplete/forkSuggestionLimits (invariant HA-37)`
     - **KEEP `source: cmd.source,` inline, unchanged** — it belongs to the HA-36 source-badge
       cluster (deferred), has its own test, and must not be moved or removed here.
- **Behavior-identical?** YES. Caps stay 15 / 5; source passthrough unchanged. Only the
  numeric caps' *source location* changes.
- **Inherits upstream feature?** **NO.** This is a pure **conflict-reduction** relocation.
  We deliberately do NOT adopt upstream's `limit: 50` (that would regress e-ink density —
  see §6). The catalogue's HA-37 "operator-call: file-mention count (50)" is answered:
  **keep the fork's e-ink cap; do not adopt 50.**
- **Honest caveat (conflict-reduction is partial):** the canonical file still differs from
  `cli-1.1.10` via the `source: cmd.source` line until HA-36 lands, so this MOVE does **not**
  make the file merge-clean — it only isolates the numeric caps into a fork-owned single
  source of truth and gives HA-37 an auditable marker. Low leverage, but safe and correct.
- **Disposition:** catalogue HA-37 → **MOVE-W1** with inline marker (`✅`).

### HA-40 — `components/modelModeOptions.ts`  · 53Δ · **REWRITE (mostly defer) + 2-row ALIGN (optional)**
- **Divergence (verified):** three independent things:
  1. **Stale list rows (ALIGN-eligible):** `getClaudeModelModes` shows fork `opus 4.7`
     vs upstream `opus 4.8`; `getClaudeEffortLevels` shows the fork **dropped** `xhigh`
     that upstream has. These two rows are fork-**behind**-upstream with **no fork intent**
     (stale content the intake take-ours'd). Adopting upstream's values here **is** a
     genuine upstream-feature inherit.
  2. **Resolver rewrites (DEFER):** the fork rewrote `getDefaultModelKey` /
     `getDefaultPermissionModeKey` / `getDefaultEffortKey` to return deliberately
     **different** defaults than upstream's `getCodeAgentDefaults` (fork: model `default`,
     permission `default` — **no auto-`bypassPermissions`**, a deliberate safety posture;
     effort `high`. upstream: `opus` / `bypassPermissions` / `medium`). It also added
     `resolvePermissionModeForPicker` (**7 consumers** — `SessionView.tsx`,
     `fork-composer.tsx`, `spawn-child.tsx`, `useSessionContextDrawer.tsx`,
     `sessionInfoPermissionMode.ts`, + test) and a `getEffortLevelsForModel` rule
     (`if (modelKey === 'default') return []`).
- **Class:** MIXED — 2 rows ALIGN-eligible; the rest REWRITE (not additive → not a
  Wave-1 list-MOVE).
- **`agentDefaults.ts` is byte-identical** fork vs `cli-1.1.10` — the fork's
  `modelModeOptions.ts` deliberately bypasses it with hardcoded different defaults. This is
  **fork intent**, not convergent noise; do NOT "simplify" by reverting to `agentDefaults`.
- **Optional Wave-1 story (operator-gated):** adopt `opus 4.8` label + re-add `xhigh` in the
  two list-producing functions **only**. `modelModeOptions.test.ts` does **not** assert on
  `4.7`/`4.8`/`xhigh` (verified), so no test breakage. **This does NOT reduce the file's
  conflict surface** (the entangled resolvers remain) — it is a content-freshness ALIGN, not
  a MOVE. Flag as operator-decision (§9): expose `opus 4.8` label + a 5th `xhigh` effort tier
  on e-ink?
- **Defer:** the resolver MOVE (extract fork defaults + `resolvePermissionModeForPicker`
  into `sources/fork/modelMode/*` behind an override seam, validate all 7 consumers) to a
  dedicated later wave. Correct future design in §4.

### HA-41 — `components/modelModeOptions.test.ts` · **tracks HA-40**
- The model-catalogue guard test. No independent action; if the HA-40 two-row ALIGN ships,
  keep this test green (it does not assert the changed rows). Catalogue row stays coupled to
  HA-40's disposition.

### HA-36 — `sync/suggestionCommands.ts`  · 192Δ · **REWRITE + REMOVAL → DEFER**
- **Divergence (verified):** wholesale fork rewrite — a `CommandSource` classification
  system (`native-prompt` / `native-local` / `skill` / `plugin` / `app-synthetic`) with
  `NATIVE_PROMPT_COMMANDS` / `APP_SYNTHETIC_COMMANDS` / `classifyCommand` / `buildCommandItem`,
  and a rewritten `getCommandsFromSession`. Fork **dropped** `cli-1.1.10`'s default
  `{ command: 'goal' }` command.
- **Class:** REWRITE + REMOVAL. Reverting drops the whole classification system (breaking
  the HA-37 `source` badge glue and its test) **and resurrects `/goal`** (fork-dropped,
  unsupported). Load-bearing (documented in `packages/happy-app/AGENTS.md` app-synthetic
  command rules).
- **Disposition:** **DEFER.** Not a Wave-1 list-MOVE. Correct future design in §4.

### HA-23 — `components/tools/views/_all.tsx`  · 14Δ · **FORK-AHEAD + REMOVAL → DEFER**
- **Divergence (verified):** **inverted premise.** The fork **authored** `TaskOutputView` /
  `TaskStopView` / `FileEditView` (commits `543e94fed` / `9db1b7b0c` / `33cc03bb8` =
  US-004/005/003 "un-minimal"); **those files do not exist in `cli-1.1.10`**
  (`git cat-file -e` = absent). The fork is **ahead** of `cli-1.1.10` here, not behind. The
  fork also dropped upstream's `permissionFooter` prop threading + `FileView` renderer.
- **Class:** FORK-AHEAD + REMOVAL. Reverting to `cli-1.1.10` is a **pure regression**
  (deletes the fork's authored renderers, resurrects `permissionFooter` + `FileView`).
  **Nothing to inherit.**
- **Disposition:** **DEFER.** If the operator wants upstream's `FileView` + `permissionFooter`,
  that is a surgical **additive hand-port** (register one renderer, thread one prop), NOT a
  whole-file revert. Operator-call (§9). Correct future design in §4.

### HA-30 — `sync/typesMessageMeta.ts`  · 13Δ · **REWRITE + REMOVAL → DEFER**
- **Divergence (verified):** Zod schema rewrite — fork added `thinkingLevel` /
  `capabilities.deferredSwitch` / `attachmentRefs` / `contextBoundaryFallback` and
  **removed** upstream's `effort`. Load-bearing (attachment pipeline, switch-mode,
  typed context-boundary).
- **Catalogue framing:** "adopt additive `effort`" — but the fork deliberately replaced
  `effort` with `thinkingLevel`, so this is a hand-port judgement call, not a clean append.
- **Disposition:** **DEFER.** Not additive-only. If `effort` is wanted, hand-port the single
  field (operator/internal call), do not revert the schema.

### HA-31 — `sync/storageTypes.ts`  · 124Δ · **REWRITE + REMOVAL → DEFER (ACCEPT-tier)**
- **Divergence (verified):** the core persisted `Metadata` schema, heavily divergent — fork
  added `codexSession` / `latestBoundary` / `plugins` / `agents` / `mcpServers` union / etc.
  and **removed** `forkedFromMessageId` + the `AgentGoal*` schemas.
- **Class:** REWRITE + REMOVAL, core sync surface. Reverting = massive regression.
- **Disposition:** **DEFER — definitively not Wave 1.** This is ACCEPT-tier (too entangled to
  MOVE cheaply). Additive upstream schemas (`forkedFromMessageId`, `AgentGoalStatusSchema`)
  are a surgical hand-port only if the fork actually wants them.

### HA-33 — `sync/localSettings.ts`  · 25Δ · **REWRITE + REMOVAL → DEFER (resurrection hazard)**
- **Divergence (verified):** fork added ~10 e-ink settings (`chatFontScale` /
  `chatToolGrouping` / `messageCommandChips` / `enableSocketRangeFetch` / `sidebarMode` /
  …) and **removed** `voiceUpsellOverride` (**E5 voice plane — KEEP-DELETED!**) and `zenMode`.
- **Class:** REWRITE + REMOVAL. **Reverting the whole file resurrects `voiceUpsellOverride`**,
  re-introducing the deleted voice plane.
- **⚠️ Guard gap:** the mandatory `sync/encryptionDeletion.spec.ts` guard checks the
  removed API planes (`apiVoice` / `apiGithub` / …) but may **not** catch a resurrected
  **settings field** (`voiceUpsellOverride`). Flag this as a real guard hole — do NOT rely on
  that spec to catch a `localSettings.ts` revert.
- **Disposition:** **DEFER.** The catalogue's "adopt additive `zenMode`" is a single-field
  hand-port decision (does the fork want `zenMode` given its own `sidebarMode`? — §9), NOT a
  whole-file MOVE/revert.

### HA-46 — `app.config.js` (pkg root)  · 120Δ · **CONFIG → DEFER**
- **Divergence (verified):** fork-owned build config — bundle id
  `com.ex3ndr.happy → com.evyatar109.happy`, removed the EAS/updates block, added CHANGELOG
  version derivation. Reverting breaks the Android release pipeline.
- **Class:** CONFIG (`.js`, not audit-scanned — no marker possible). Not a const-list.
- **Disposition:** **DEFER.** Additive upstream keys (`buildCommitSha`, iOS
  `NSAppTransportSecurity`) are a hand-port only.

### HA-47 — `metro.config.js` (pkg root)  · 43Δ · **CONFIG + REMOVAL → DEFER**
- **Divergence (verified):** fork-owned build config — fork **replaced** `cli-1.1.10`'s
  `src-tauri` blockList + preact-singleton resolver with a **test-file blockList** (load-bearing:
  without it Expo Router picks up `*.test.ts` as routes and Metro crashes).
- **⚠️ Catalogue mismatch:** catalogue HA-47 claims the fork "keeps Tauri exclusion + preact
  singleton," but HEAD does **not** contain them (they are on the `-`/`cli-1.1.10` side). The
  catalogue note is **stale** — flag for correction. Reverting would drop the test-file
  blockList (breakage) and re-add the Tauri/preact resolver.
- **Class:** CONFIG + REMOVAL. Disposition: **DEFER.**

---

## §3 Actionable Wave-1 stories (the narrowed set)

See `stories-outline.md` for the full table. Summary:

- **Story W1-1 (ship):** HA-37 `suggestions.ts` — extract the two e-ink numeric caps to
  `sources/fork/autocomplete/forkSuggestionLimits.ts`; re-export `MAX_COMMAND_SUGGESTIONS`;
  keep `source: cmd.source` inline; add the `[MOVE-W1]` marker; flip catalogue HA-37 to
  MOVE-W1 (`✅`). **Behavior-identical, safe, low-leverage.**
- **Story W1-2 (optional, operator-gated):** HA-40 `modelModeOptions.ts` — adopt upstream
  `opus 4.8` label + re-add `xhigh` effort in the two list functions **only**. Genuine
  upstream-feature inherit; does **not** reduce conflict surface; leaves resolvers untouched.
  Requires the §9 operator ruling.

Everything else is **deferred** (§4) — do NOT implement in Wave 1.

---

## §4 Deferred files — correct future-wave designs (so later waves start ahead)

| HA | File | Why deferred | Correct future action (dedicated wave) |
|---|---|---|---|
| HA-40 (resolvers) | `modelModeOptions.ts` | REWRITE of default resolvers; 7 consumers | Extract fork defaults + `resolvePermissionModeForPicker` + the `default`-model effort rule into `sources/fork/modelMode/forkModelDefaults.ts` behind an **override seam** the canonical calls; validate all 7 consumers still resolve; keep the fork's no-auto-bypass safety posture. Behavioral MOVE, not a list concat. |
| HA-36 | `sync/suggestionCommands.ts` | REWRITE (source-classification) + `/goal` REMOVAL | MOVE the `CommandSource` classification + `NATIVE_PROMPT_COMMANDS`/`APP_SYNTHETIC_COMMANDS`/`classifyCommand` into `sources/fork/sync/forkSuggestionCommands.ts`; canonical `getCommandsFromSession` calls a fork post-processor; keep `/goal` removed (KEEP-DELETED guard). Unblocks HA-37's `source` glue becoming merge-clean. |
| HA-23 | `components/tools/views/_all.tsx` | FORK-AHEAD (fork authored renderers) + REMOVAL | Forward-only: register fork renderers via a `sources/fork/tools/forkToolViews.ts` registry-merge seam so future upstream renderer additions merge cleanly. Separately decide (operator) whether to additively hand-port upstream's `FileView` + `permissionFooter`. |
| HA-30 | `sync/typesMessageMeta.ts` | Zod REWRITE + `effort` REMOVAL | Not cheaply MOVE-able (schema is one object). Treat as KEEP + optional additive hand-port of `effort` if wanted. Candidate for an ACCEPT ruling. |
| HA-31 | `sync/storageTypes.ts` | Core `Metadata` REWRITE + REMOVAL | ACCEPT-tier. Keep fork body; hand-port additive upstream schemas only if the fork wants them. Not a MOVE. |
| HA-33 | `sync/localSettings.ts` | Zod REWRITE + `voiceUpsellOverride`/`zenMode` REMOVAL (resurrection hazard) | Keep fork body. MOVE the ~10 e-ink settings into a fork settings-extension module only if a clean Zod `.merge()` seam is feasible; **never** whole-file revert (resurrects `voiceUpsellOverride`). Decide `zenMode` adoption separately. |
| HA-46 | `app.config.js` | Fork-owned build CONFIG (`.js`, no marker) | Keep fork body; hand-port additive upstream keys (`buildCommitSha`, iOS ATS). Not a const-list MOVE. |
| HA-47 | `metro.config.js` | Fork-owned build CONFIG + REMOVAL; stale catalogue note | Keep fork body (test-file blockList is load-bearing); correct the stale catalogue note. Not a MOVE. |

---

## §5 Inherited-upstream confirmation (corrected)

The brainstorm claimed "Wave 1 actually TURNS ON these upstream features (opus-4.8/xhigh,
/goal+skills, new tool views, mention logic)." **Source verification corrects this:**

- **Story W1-1 (HA-37 caps MOVE) inherits NOTHING** — it deliberately keeps the fork's
  e-ink caps (15 / 5) and does not adopt upstream's `50`. Pure conflict-reduction.
- **Story W1-2 (HA-40 two-row ALIGN) is the ONLY genuine upstream-feature inherit** in the
  entire Wave-1 set: adopting `opus 4.8` (label) + `xhigh` (5th effort tier). And it is an
  ALIGN (adopt-upstream content), **not** a MOVE.
- **All other candidate "features"** (`/goal` + skills slash, upstream tool renderers /
  `FileView`, upstream mention logic, `zenMode`, `effort`, `buildCommitSha`) are **NOT**
  inherited by any Wave-1 action, because those files are deferred. Where the fork removed
  or rewrote the upstream construct, a canonical revert would **regress** fork behavior, not
  "turn on" a feature. Adopting any of them is a **surgical additive hand-port** in a later
  wave, gated on the §9 operator calls.

**Bottom line:** Wave 1 does not "turn on all upstream features." At most it turns on the
`opus 4.8` label + `xhigh` effort tier (Story W1-2), if the operator approves.

---

## §6 e-ink checks

- **`xhigh` effort tier (Story W1-2):** adds a 5th effort option to the Claude picker. Minor;
  static list row, no animation. **e-ink-safe.** Spot-check the picker renders 5 rows without
  layout overflow on the tablet (webapp fine for debugging, per operator).
- **`opus 4.8` label (Story W1-2):** pure text-label change. e-ink-safe.
- **HA-37 file-mention cap:** **must stay 5** (fork e-ink density). The MOVE keeps 5; do NOT
  adopt upstream's 50 (a 50-item mention list is e-ink-hostile — long repaint, scroll
  thrash). This is the one active e-ink guard in Wave 1.
- **Deferred-file e-ink risks (for later waves, noted now):** upstream's `FileView` /
  `permissionFooter` (HA-23) and any animated tool cards would need an e-ink spot-check and a
  default-off suppression toggle if they animate. Not in scope for Wave 1.

---

## §7 Catalogue updates & marker↔catalogue parity

`scripts/audit-happy-fork-patches.mjs` (repo root; advisory, `--strict` for CI) cross-checks
`// FORK PATCH: … (invariant HA-N)` markers in code against `docs/happy-patch-surface.md`
rows. The `(invariant HA-N)` token **must be on the same line** as `FORK PATCH:`. `.js`
files (HA-46/47) are **not** scanned.

- **HA-37:** flip the catalogue row from `KEEP + adopt?` / `❌ catalogue-only` to
  **`MOVE-W1`** with marker column **`✅`** (an inline marker now exists in both
  `suggestions.ts` and the new `forkSuggestionLimits.ts`). Update the note to: "e-ink caps
  relocated to `sources/fork/autocomplete/forkSuggestionLimits`; `source` passthrough stays
  as HA-36 glue." Update the `file` column to include the fork module path if the row format
  allows.
- **HA-40 (if Story W1-2 ships):** stays `KEEP` (no MOVE marker — the two-row ALIGN is
  content adoption, not a relocation). Update the note to record "opus 4.8 + xhigh aligned to
  upstream `<date>`; resolvers remain fork-owned (deferred MOVE)."
- **HA-41:** no change beyond tracking HA-40.
- **All deferred rows (HA-23/30/31/33/36/46/47):** **no catalogue change in Wave 1** — they
  keep their current `KEEP`/`KEEP-DELETED` disposition. (Correct the stale HA-47 "keeps Tauri
  + preact" note as a small follow-up, out of Wave-1 scope.)
- **Parity gate:** after Story W1-1, run the audit and confirm HA-37 shows **no drift**
  (marker present ↔ row `✅`). No orphan/undermarked entries introduced.

---

## §8 Gates

Run from the worktree; capture long output once and grep (per fork ops convention).

| Gate | Command | Applies to |
|---|---|---|
| Autocomplete suggestions test | `pnpm --filter happy-app test -- suggestions.test.ts` | W1-1 |
| Model-mode test | `pnpm --filter happy-app test -- modelModeOptions.test.ts` | W1-2 |
| Suggestion-commands test (regression) | `pnpm --filter happy-app test -- suggestionCommands.test.ts` | W1-1 (HA-36 glue unbroken) |
| Tool-view tests (regression) | `pnpm --filter happy-app test -- components/tools` | sanity (HA-23 untouched) |
| Typecheck | `pnpm --filter happy-app typecheck` | both |
| **Encryption-deletion guard (MANDATORY)** | `pnpm --filter happy-app test -- encryptionDeletion.spec.ts` | both — confirm no removed plane resurrected. **Note the guard-gap:** it may not catch a `localSettings.voiceUpsellOverride` resurrection, but Wave 1 does not touch `localSettings.ts`, so the gap is not exercised here. |
| Marker/catalogue parity | `node scripts/audit-happy-fork-patches.mjs` (add `--strict` locally) | W1-1 (expect zero drift) |
| **e-ink spot-check (MANDATORY note)** | Manual: command-suggestion list still caps at 15, file-mention at 5; (W1-2) picker shows opus 4.8 + a 5th `xhigh` tier without overflow. Webapp acceptable for debugging. | both |

---

## §9 Operator-decision calls

1. **Ship Wave 1 at all, given it is essentially one low-leverage file?** Story W1-1 (HA-37
   caps MOVE) is safe and correct but yields marginal conflict-reduction (the `source` line
   keeps the file diverging until HA-36). Options: (a) ship W1-1 anyway to establish the
   `sources/fork/autocomplete/` overlay + marker precedent; (b) fold HA-37 into the future
   HA-36 wave and ship no standalone Wave 1. **Recommendation: (a)** — cheap, safe, sets the
   overlay precedent.
2. **HA-40 two-row ALIGN — adopt upstream `opus 4.8` label + `xhigh` 5th effort tier?**
   Genuine upstream inherit; e-ink-safe; no test breakage; but does not reduce conflict
   surface. **Recommendation: yes** (it is the operator's stated "have all upstream features"
   goal, delivered for the one place it actually applies), pending the e-ink 5-row spot-check.
3. **HA-23 — additively hand-port upstream's `FileView` + `permissionFooter`?** Separate from
   the deferred forward-only registry MOVE. Registers a new file renderer + threads a footer
   prop. Operator-call per catalogue. **Recommendation: defer to the HA-23 wave.**
4. **HA-33 — adopt upstream `zenMode` given the fork's own `sidebarMode` overlap?** Single-field
   hand-port; possible redundancy with fork UI. **Recommendation: defer; evaluate in the HA-33
   wave.**
5. **Deferral of 7 files acknowledged?** Confirm the operator accepts that Wave 1, as the
   brainstorm scoped it, does not exist as a clean additive-list cluster, and that HA-23/30/31/
   33/36/40-resolvers/46/47 move to dedicated later waves with the §4 designs.

---

## §10 Fork-behavior-preservation confirmation

**Nothing fork-authored is dropped by this plan.**
- Story W1-1 relocates two numeric caps into a fork module and keeps them at 15 / 5; the
  `source` badge glue stays inline; behavior is byte-for-byte identical.
- Story W1-2 only *adds* upstream content (opus 4.8 label + `xhigh` row); it removes no fork
  behavior and touches no resolver.
- Every file whose revert would drop fork behavior or resurrect a removed construct
  (especially `localSettings.ts` → `voiceUpsellOverride`, `_all.tsx` → `permissionFooter`/
  `FileView`, `suggestionCommands.ts` → `/goal`) is **explicitly deferred, not reverted.**

---

## §11 Risks & common mistakes (for the impl agent)

- **Do NOT whole-file `git checkout cli-1.1.10 -- <path>`** on any deferred file. It looks
  like "revert to upstream to inherit" but here it drops fork behavior and resurrects removed
  constructs. Only the two named list rows in `modelModeOptions.ts` are safe to align.
- **Keep `source: cmd.source` inline in `suggestions.ts`** — it is HA-36 glue with its own
  test; moving/removing it breaks the command-source-badge feature.
- **Re-export `MAX_COMMAND_SUGGESTIONS` from `suggestions.ts`** — `suggestions.test.ts`
  imports it from `./suggestions`; renaming-only-to-the-fork-module breaks the test import.
- **Marker token placement:** `(invariant HA-37)` must be on the same physical line as
  `FORK PATCH:` or the audit will not resolve it.
- **`git add` explicitly** (never `-A`) — do not stage generated sidecars or `CLAUDE.md`.
- **`app.config.js` / `metro.config.js` are not audit-scanned** (`.js`) — no marker possible;
  any future action there is catalogue-note-only.
- **Windows/PowerShell:** keep `git config core.autocrlf false` for clean diffs; use
  `git --no-pager`.
