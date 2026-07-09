# Stories outline — Wave 1 MOVE refactors (`happy-app-minimal-conflict-reduction-wave1`)

Companion to `plan.md`. Ordered safest → riskiest. **Source verification collapsed the
brainstorm's 9-file Wave 1 into 1 clean story + 1 optional operator-gated story; the other
7 files are explicitly deferred (not stories here).**

---

## Story table

| # | Story | File(s) | Class | Ship? | Inherits upstream? | e-ink | Gates |
|---|---|---|---|---|---|---|---|
| **W1-1** | Extract e-ink autocomplete caps to a fork const module | `sources/components/autocomplete/suggestions.ts` → new `sources/fork/autocomplete/forkSuggestionLimits.ts` | PARTIAL-MOVE (clean-ish) | **Yes** | No (keeps fork 15/5 caps) | Keep file-mention cap 5; do not adopt 50 | `suggestions.test.ts`, `suggestionCommands.test.ts` (regress), typecheck, `encryptionDeletion.spec.ts`, audit parity |
| **W1-2** | Two-row ALIGN: adopt upstream `opus 4.8` label + re-add `xhigh` effort | `sources/components/modelModeOptions.ts` (2 list functions only) | ALIGN (content adopt, not MOVE) | **Optional — operator-gated (§9.2)** | **Yes** (opus 4.8 + xhigh — the ONLY genuine inherit in Wave 1) | Picker shows 5th `xhigh` tier without overflow | `modelModeOptions.test.ts`, typecheck, `encryptionDeletion.spec.ts` |

---

## Story W1-1 — HA-37 autocomplete caps MOVE  *(clean-append: SAFE)*

**Goal:** relocate the two fork e-ink numeric caps out of the upstream-canonical
`suggestions.ts` into a fork overlay const module, establishing the
`sources/fork/autocomplete/` overlay + marker precedent, with byte-identical behavior.

**Acceptance criteria**
- [ ] New file `packages/happy-app/sources/fork/autocomplete/forkSuggestionLimits.ts` exports
      `FORK_COMMAND_SUGGESTION_LIMIT = 15` and `FORK_FILE_MENTION_LIMIT = 5`, with a
      `// FORK PATCH: [MOVE-W1] … (invariant HA-37)` header + relocation comment.
- [ ] `suggestions.ts` imports both consts; re-exports `MAX_COMMAND_SUGGESTIONS =
      FORK_COMMAND_SUGGESTION_LIMIT` (preserves the name `suggestions.test.ts` imports);
      command call uses `MAX_COMMAND_SUGGESTIONS`, file call uses `FORK_FILE_MENTION_LIMIT`.
- [ ] `source: cmd.source` passthrough is left **inline and unchanged** (HA-36 glue).
- [ ] Inline `[MOVE-W1] (invariant HA-37)` marker on the seam line in `suggestions.ts`.
- [ ] Catalogue HA-37 row flipped to `MOVE-W1`, marker column `✅`, note updated (§7).
- [ ] `pnpm --filter happy-app test -- suggestions.test.ts` green (caps 15, source test passes).
- [ ] `pnpm --filter happy-app test -- suggestionCommands.test.ts` green (HA-36 glue unbroken).
- [ ] `pnpm --filter happy-app typecheck` clean.
- [ ] `pnpm --filter happy-app test -- encryptionDeletion.spec.ts` green.
- [ ] `node scripts/audit-happy-fork-patches.mjs` shows zero drift for HA-37.
- [ ] Manual e-ink note: command list caps at 15, file-mention at 5.
- [ ] **No fork behavior dropped** (caps unchanged; source glue intact).

**Risk:** LOW. Purely additive relocation; the one trap is forgetting to re-export
`MAX_COMMAND_SUGGESTIONS` (breaks the test import) or accidentally removing `source:`.

---

## Story W1-2 — HA-40 opus-4.8 + xhigh two-row ALIGN  *(optional; operator-gated)*

**Goal:** adopt the two stale-but-inheritable upstream list rows so the fork picks up
upstream's `opus 4.8` label and `xhigh` effort tier — the only genuine upstream-feature
inherit in Wave 1. **Content adoption, not a MOVE; does not reduce the file's conflict
surface (resolvers stay fork-owned).**

**Precondition:** operator approves §9.2 (expose `opus 4.8` label + 5th `xhigh` effort tier
on e-ink). **Do not ship without the ruling.**

**Acceptance criteria**
- [ ] `getClaudeModelModes`: `opus` row label `4.7 → 4.8`.
- [ ] `getClaudeEffortLevels`: re-add `{ key: 'xhigh', name: 'xhigh' }` (upstream position).
- [ ] **No resolver touched** (`getDefault*`, `resolvePermissionModeForPicker`,
      `getEffortLevelsForModel` `default`-rule all unchanged — fork intent preserved).
- [ ] `pnpm --filter happy-app test -- modelModeOptions.test.ts` green (does not assert
      these rows; verified).
- [ ] `pnpm --filter happy-app typecheck` clean.
- [ ] `pnpm --filter happy-app test -- encryptionDeletion.spec.ts` green.
- [ ] Catalogue HA-40 note updated to record the align date; row stays `KEEP` (no MOVE marker).
- [ ] Manual e-ink note: effort picker shows 5 rows (incl. `xhigh`) without overflow.
- [ ] **No fork behavior dropped** (additive rows only; resolvers untouched).

**Risk:** LOW-MEDIUM. Trivial edit, but it is the only story that changes observable UX
(new label + new effort option), hence the operator gate.

---

## Explicitly DEFERRED (NOT Wave-1 stories — see plan §4 for future designs)

| HA | File | Reason |
|---|---|---|
| HA-40 (resolvers) | `modelModeOptions.ts` | REWRITE of default resolvers; 7 consumers; needs an override-seam MOVE + consumer validation |
| HA-36 | `sync/suggestionCommands.ts` | Wholesale REWRITE (source-classification) + `/goal` REMOVAL |
| HA-23 | `components/tools/views/_all.tsx` | FORK-AHEAD (fork authored TaskOutput/TaskStop/FileEdit) + `permissionFooter`/`FileView` REMOVAL; revert = pure regression |
| HA-30 | `sync/typesMessageMeta.ts` | Zod REWRITE; `effort` REMOVAL |
| HA-31 | `sync/storageTypes.ts` | Core `Metadata` REWRITE + REMOVAL; ACCEPT-tier |
| HA-33 | `sync/localSettings.ts` | Zod REWRITE + `voiceUpsellOverride`/`zenMode` REMOVAL — **resurrection hazard** |
| HA-46 | `app.config.js` | Fork-owned build CONFIG (`.js`, no marker) |
| HA-47 | `metro.config.js` | Fork-owned build CONFIG + REMOVAL; stale catalogue note to fix |

**Ship order:** W1-1 first (safe, no operator gate). W1-2 only after the §9.2 ruling. If the
operator declines both, Wave 1 produces no code and the finding itself (premise corrected;
7 files re-scoped into dedicated waves with designs) is the deliverable.
