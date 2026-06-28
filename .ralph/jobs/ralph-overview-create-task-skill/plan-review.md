# Phase-4 Plan Review — ralph-overview-create-task-skill

Reviewer: rubber-duck sub-agent (Claude Opus 4.8), source-verified against
`ai-developer-toolkit/plugins/ralph-overview/`. Single round; converged.

## Load-bearing claims — all VERIFIED against source

| # | Claim | Verdict (citation) |
|---|-------|--------------------|
| 1 | `createOnly` guard in `applyVerb` is cold-shard-aware | ✅ `runVerbSplit` passes assembled hot+cold `beforeUnion` to `applyVerb` (`data-edit-core.mjs:357-358`); `runVerbLegacy` passes full set (`:323-324`) |
| 2 | `upsert-task` is insert-or-replace exit 0; invariant permits replace | ✅ `:135-151`; `validateInvariants` `wasPresent ? beforeCount : beforeCount+1` (`:192-198`) |
| 3 | `--create-only` should be boolean like `--force` (not VALUE_FLAGS) | ✅ `--force` → `flags.force = true` in `data-edit.mjs` parseArgs |
| 4 | MCP field add won't break `stdio-tools-list.test.ts` | ✅ descriptions are separate const `DATA_WRITE_TOOL_DESCRIPTIONS` (`data-write.ts:26-38`); test asserts name+description only. (`upsertTaskSchema` is `.strict()` → adding `createOnly` to the schema is mandatory) |
| 5 | FORBIDDEN list exact | ✅ `generate-copilot-artifacts.mjs:17` — but framing corrected (see L1) |
| 6 | `summary-projection.json` is the only cold-listing projection | ✅ `emit-projections.mjs:37,43,50` — but watcher-emitted/absent (see H1) |
| 7 | `upsert-task` does NOT auto-set `lastTouchedAt` | ✅ `:126-151` sets nothing (vs set-lifecycle `:69`, mark-shipped `:85`) |

CRITICAL findings: **none.** Core mechanism (D-002) confirmed correct, atomic,
cold-shard-aware.

## Findings + resolutions (folded into plan.md / stories-outline.md)

- **H1 (HIGH) — `summary-projection.json` is watcher-emitted and frequently
  absent** (absent in live codexu `.ralph-overview/` now; a throwaway-copy smoke
  won't have it). RESOLVED: plan §D step 2/3 + US-004 AC-3 + Common-mistakes now
  mandate graceful degradation (read `data.json`+`data.archived.json` directly,
  or skip the pre-check; never crash/hard-block). The core `createOnly` guard
  remains the real safety net.
- **M1 (MEDIUM) — roundtrip reject case can't reuse `assertByteParity()`**
  (it asserts the file CHANGED; `runCli` throws on non-zero exit). RESOLVED:
  Tests §4 + US-006 AC-4 now specify a dedicated assertion (both surfaces error;
  both files byte-identical to seed).
- **L1 (LOW) — real forbidden near-miss is `Skill(`, not `Agent(`**
  (`ask_user(`/`AskUserQuestion(`/`task(agent_type=)` are all safe). RESOLVED:
  §E + Common-mistakes reworded; added a note not to transcribe plan prose
  containing `Skill(` into the SKILL.md body.
- **L2 (LOW) — US-001 snippet redeclared `const index`** (collides with existing
  `:135`). RESOLVED: §A now reuses the existing `index`, no redeclaration.
- **L3 (LOW) — US-004 deps understated.** RESOLVED: deps now list US-001+002+003.
- **L4 (LOW) — skill count "4 → 5".** RESOLVED: US-007 AC-1 notes use "4 → 5",
  do not recount `skills/` dirs.

## Bottom line

No blocking issues. D-002 is the recommended direction; the one item that
genuinely risked the skill failing in practice (H1, missing projection) is now
handled. Plan is ready for `/implement-with-ralph` once the operator confirms the
D-002-vs-D-001 gating interpretation.
