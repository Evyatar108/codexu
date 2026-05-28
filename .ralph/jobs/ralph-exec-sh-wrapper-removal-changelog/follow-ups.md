# Follow-up tasks: post-v5.46.0 stale-`.sh`-prose cleanup

Filed by US-004 of `ralph-exec-sh-wrapper-removal-changelog` (plan at
`D:/harness-efforts/codexu/.ralph/jobs/ralph-exec-sh-wrapper-removal-changelog/plan.md`,
audit at `caller-sweep.md` sibling file). One markdown section per follow-up task; the
bookkeeper copies the `Suggested seed` block into the `command.prompts.plan` field of a
new entry in `plans/overview-data.js`. Schema-per-section:

```markdown
## ralph-<kebab-case-task-id>

**Summary:** <one sentence stating the desired outcome>

**Scope (files / lines):**
- `D:/.../path/to/file.md:L1-L20` — <one-line note on what is stale>
- `D:/.../path/to/other.md:L42` — <note>

**Cross-reference:** <link to audit-report.md / existing batch task / parent investigation, if any>

**Suggested seed (for overview-data.js prompts.plan):**
> <2-4 sentences the bookkeeper can paste into the next planning member's spawn prompt>
```

These follow-ups DO NOT belong in this PR; this PR is doc-only audit + advisory promotion.
Cleanup is deliberately deferred to separate plans so each surface is reviewed against the
current `.mjs` API contracts on its own.

## ralph-stale-sh-prose-cleanup-skills

**Summary:** Refresh operator-facing skill markdown and JSON schema descriptions under
`plugins/ralph/` so every prose reference to `codex-exec.sh` / `copilot-exec.sh` becomes
the `node plugins/ralph/src/<name>.mjs ...` form that v5.46.0 ships.

**Scope (files / lines):**

- `D:/ai-developer-toolkit/plugins/ralph/skills/implement-with-ralph/SKILL.md:1624,1625,1639,1640` — Appendix D "Iteration Engine" + "Planning engine" still says "via `codex-exec.sh`" / "via `copilot-exec.sh`"; operators copying the prose hit "No such file or directory" on v5.46.0+.
- `D:/ai-developer-toolkit/plugins/ralph/skills/multi-model-investigate/SKILL.md:146` — Round-2 prompt-assembly note references `codex-exec.sh` / `copilot-exec.sh` as the spawning targets.
- `D:/ai-developer-toolkit/plugins/ralph/skills/review-plan-with-ralph/SKILL.md:9-11` — plugin-path derivation comment still lists `codex-exec.sh` as a locatable artifact.
- `D:/ai-developer-toolkit/plugins/ralph/schemas/prd-schema.json:21,27` — `iterationEngine` and `planningEngine` description text says "(gpt-5.5 via codex-exec.sh)" / "(… via copilot-exec.sh)".

**Cross-reference:** `D:/harness-efforts/codexu/.ralph/jobs/ralph-exec-sh-wrapper-removal-changelog/caller-sweep.md` (the audit that catalogued these locations); `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md` (the upstream audit row that triggered this entire batch).

**Suggested seed (for overview-data.js prompts.plan):**

> /plan-with-ralph "Refresh stale `.sh` prose across operator-facing surfaces in `plugins/ralph/` so v5.46.0's all-Node migration is reflected in skill markdown and JSON schema descriptions. Files to touch: `skills/implement-with-ralph/SKILL.md:1624,1625,1639,1640` (Appendix D iteration + planning engine descriptions), `skills/multi-model-investigate/SKILL.md:146`, `skills/review-plan-with-ralph/SKILL.md:9-11`, `schemas/prd-schema.json:21,27`. Convert every `codex-exec.sh` / `copilot-exec.sh` reference to `node plugins/ralph/src/<name>.mjs ...`. Preserve the hermetic-test env-var note (`CODEX_EXEC_SCRIPT` / `COPILOT_EXEC_SCRIPT` still honored). Verify with `git grep -nE 'codex-exec\.sh|copilot-exec\.sh' plugins/ralph/skills plugins/ralph/schemas` reporting zero matches on the patched surfaces. Doc-only — no version bump unless paired with another change. Multi-remote push (origin + work). Phase 5a/5b internal to /implement-with-ralph."

## ralph-stale-sh-prose-cleanup-copilot-mirror

**Summary:** Regenerate the Copilot-mirror skill files under
`plugins/ralph/.copilot-plugin/copilot-skills/` so stale `.sh` references are dropped in
lockstep with the operator-facing skills cleanup. May be a duplicate of the audit-report's
Batch 3 candidate — the bookkeeper decides whether to dedupe.

**Scope (files / lines):**

- `D:/ai-developer-toolkit/plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md:1621-1640,1662` — copilot mirror copy of Appendix D iteration-engine prose.
- `D:/ai-developer-toolkit/plugins/ralph/.copilot-plugin/copilot-skills/multi-model-investigate/SKILL.md:146` — copilot mirror copy of the multi-model-investigate Round-2 note.

**Cross-reference:** Batch 3: `ralph-implement-skill-mirror-regenerate-2026-05-28` (already proposed by `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md`). If that batch-3 task is still queued in `plans/overview-data.js`, the bookkeeper should merge this follow-up's scope into it rather than file a duplicate. The audit also flagged a `slash-commands-copilot` parity-check follow-up that should converge with this work.

**Suggested seed (for overview-data.js prompts.plan):**

> /plan-with-ralph "Regenerate the implement-with-ralph + multi-model-investigate Copilot-mirror skills under `plugins/ralph/.copilot-plugin/copilot-skills/**/SKILL.md` to drop stale `codex-exec.sh` / `copilot-exec.sh` prose left over from before the v5.46.0 all-Node migration. Run `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --write` to regenerate from the canonical source; hand-edit if the generator's hand-fork list excludes any of the files. Verify with `git grep -nE 'codex-exec\.sh|copilot-exec\.sh' plugins/ralph/.copilot-plugin/copilot-skills` reporting zero matches. Cross-reference Batch 3 `ralph-implement-skill-mirror-regenerate-2026-05-28` — if that task is still queued, merge scope into it instead of filing a duplicate. Add a smoke check that re-runs the generator and asserts no diff so future stale-drift trips a test. Multi-remote push (origin + work). Phase 5a/5b internal to /implement-with-ralph."

## ralph-claude-stale-sh-prose-cleanup

**Summary:** Refresh `D:/ai-developer-toolkit/plugins/ralph/CLAUDE.md` so its plugin-
architecture sections describe the v5.46.0 `.mjs`-only runtime. Preserve the version
history sections (above the v5.46.0 entry) as historical record; refresh the
forward-looking "current architecture" prose so a new contributor reading top-down sees
`node src/<name>.mjs` end-to-end.

**Scope (files / lines):** the authoritative grep is
`git grep -nE 'codex-exec\.sh|copilot-exec\.sh' plugins/ralph/CLAUDE.md` (run from
`D:/ai-developer-toolkit-worktrees/ralph-exec-sh-wrapper-removal-changelog/` against
branch `ralph/ralph-exec-sh-wrapper-removal-changelog` at HEAD = `origin/main` + this
task's branch tip). The follow-up surface (lines the next planning member edits) is the
STALE-FORWARD set in the **Classification notes** subsection below; the KEEP set is listed
there for context and explicitly NOT in scope.

- `plugins/ralph/CLAUDE.md:417` — `prompts/copilot.md` description in "What's in this plugin" section.
- `plugins/ralph/CLAUDE.md:671,672` — Appendix D iteration-engine descriptions (mirror `skills/implement-with-ralph/SKILL.md:1624,1625`).
- `plugins/ralph/CLAUDE.md:789,790` — "Key files" table rows describing the removed shims as "Thin bash shim".
- `plugins/ralph/CLAUDE.md:806,807,808,809` — "Key files" agent-prompt copy-target rows referencing `codex-exec.sh` / `copilot-exec.sh`.
- `plugins/ralph/CLAUDE.md:860,862` — "Multi-model planning" Phase 2/4 wrapper-invocation prose.
- `plugins/ralph/CLAUDE.md:887` — "Multi-model review" prompt-template note referencing the removed shims.
- `plugins/ralph/CLAUDE.md:996` — "Prerequisites" `jq` line listing the deleted shims as exceptions.

**Classification notes (rule + per-line verdicts):**

Rule of thumb: lines INSIDE any pre-v5.46.0 release-note block (`## v5.<N>.<N>
Behavioral Additions`, irrespective of physical position in the reverse-chronological
file) describe what shipped in that release and stay as historical record. Lines OUTSIDE
all release-note blocks (the architectural sections "What's in this plugin", "Key files",
"Multi-model planning", "Multi-model review", "Prerequisites", etc.) describe current
behavior and get updated to the post-v5.46.0 `.mjs` reality.

KEEP-as-historical (do NOT edit in the follow-up):

- `:24` — v5.46.0 enumeration of the eleven removed shims; canonical and current.
- `:52,53` — v5.46.0 "Key Files Addendum" rows describing the deletion accurately.
- `:69` — inside v5.45.0 block (file lines 65-89); describes the v5.45.0 thin-shim state.
- `:83,84` — inside v5.45.0 block; "Backward-compatible shim only" rows accurate at v5.45.0.
- `:179,187,189,195` — inside v5.35.0 block (file lines 177-200); v5.35.0 release prose.
- `:204,205,210` — inside v5.34.0 block (file lines 201-212); v5.34.0 release prose.
- `:221,224` — inside v5.32.0 block (file lines 219-227); v5.32.0 parity bump.
- `:230,232` — inside v5.31.0 block (file lines 228-234); v5.31.0 skill release prose.
- `:279` — inside v5.26.0 block (file lines 277-285); v5.26.0 severity-rubric release.
- `:325,326,346,347` — inside v5.23.0 / v5.21.0 blocks; release-note bumps.
- `:388` — inside v5.16.0 block (file lines 385-390); v5.16.0 release prose.

STALE-FORWARD (DO update in the follow-up): the lines enumerated in the bullet list
above. All sit in architectural sections OUTSIDE any release-note block. Verify via
`awk '/^## v5\\./ {print NR": "$0}' plugins/ralph/CLAUDE.md` — release-note blocks span
file lines 15 through ~390; lines 391+ are architectural sections.

**Cross-reference:** `caller-sweep.md` (sibling); `audit-report.md` Batch 3 row.

**Suggested seed (for overview-data.js prompts.plan):**

> /plan-with-ralph "Refresh `D:/ai-developer-toolkit/plugins/ralph/CLAUDE.md` post-v5.46.0 so the architectural sections OUTSIDE any release-note block (file-purpose tables, Appendix D iteration-engine prose, Prerequisites) describe the `.mjs`-only runtime. Preserve every pre-v5.46.0 release-note block verbatim as historical record — those blocks describe what shipped at each prior release. Lines to UPDATE (STALE-FORWARD, all in architectural sections, see `D:/harness-efforts/codexu/.ralph/jobs/ralph-exec-sh-wrapper-removal-changelog/follow-ups.md` Scope subsection): 417, 671-672, 789-790, 806-809, 860, 862, 887, 996. Lines to KEEP as historical record (inside release-note blocks; do NOT edit): 24, 52-53, 69, 83-84, 179, 187, 189, 195, 204-205, 210, 221, 224, 230, 232, 279, 325-326, 346-347, 388. Verify the architectural-section flip with `awk '/^## v5\\./ {print NR}' plugins/ralph/CLAUDE.md | tail -1` (last release-note block starts before file line ~390; lines >390 are architectural) and `git grep -nE 'codex-exec\\.sh|copilot-exec\\.sh' plugins/ralph/CLAUDE.md` should drop to only the KEEP-line set (plus any v5.46.0 BREAKING CHANGE prose added in lockstep with the CLAUDE.md refresh). Multi-remote push (origin + work). Phase 5a/5b internal to /implement-with-ralph."

## codexu-roadmap-stale-sh-refs

**Summary:** Refresh `D:/harness-efforts/codexu/plans/codexu-roadmap.md` §Phase 3d (and
associated 4l + Phase 3e cross-references) so the "Today: ralph orchestrator skill runs
`bash → codex-exec.sh`" baseline is updated to "Today: ralph orchestrator skill runs
`node plugins/ralph/src/codex-exec.mjs`". Preserve the §Phase 3d migration narrative
(replacing the subprocess pattern with codex native `spawn-agent-role`) — only the
baseline framing has changed.

**Scope (files / lines):**

- `D:/harness-efforts/codexu/plans/codexu-roadmap.md:146,1220,1226,1293,1392,2232,2333,2335,2375,2376,2382,2387,2399,2407,2410,2413,2427,2687,2711,2716,2940,3030,3137,3222,3452` — Phase 3d / 3e / 4l prose still uses the deleted `.sh` shims as the "today" baseline. The migration goal (replace subprocess pattern with native spawn) remains valid; only the baseline framing needs to flip.
- `D:/harness-efforts/codexu/plans/overview-data.js:475,488` — Phase 3d card descriptionHtml + `prompts.plan` seed reference `codex-exec.sh` as the "Today" baseline. Refresh in lockstep with the roadmap section.

**Cross-reference:** `caller-sweep.md` (sibling); the `plugins-copilot-cross-engine-audit` Phase 3d row.

**Suggested seed (for overview-data.js prompts.plan):**

> /plan-with-ralph "Refresh §Phase 3d / §Phase 3e / §4l of `D:/harness-efforts/codexu/plans/codexu-roadmap.md` so the 'Today: bash → codex-exec.sh' baseline framing flips to 'Today: node plugins/ralph/src/codex-exec.mjs ...' (v5.46.0 shipped the all-Node migration). PRESERVE the §Phase 3d migration goal (replace subprocess pattern with codex native `spawn-agent-role`); only the baseline framing changes. Refresh `plans/overview-data.js:475,488` (Phase 3d card descriptionHtml + prompts.plan seed) in lockstep so the overview viewer matches. Update §Phase 3e references that depended on the `.sh` framing as well. Use `git grep -nE 'codex-exec\.sh|copilot-exec\.sh' plans/codexu-roadmap.md plans/overview-data.js` as the verification step; expected post-fix matches drop from 25+ to single-digit historical-only mentions. codexu repo has one remote (origin) — single push, but operator-gated per AGENTS.md. Phase 5a/5b internal to /implement-with-ralph."
