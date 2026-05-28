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

**Scope (files / lines):** authoritative `git grep -nE 'codex-exec\.sh|copilot-exec\.sh'
plugins/ralph/CLAUDE.md` (run from `D:/ai-developer-toolkit-worktrees/ralph-exec-sh-
wrapper-removal-changelog/` against branch `ralph/ralph-exec-sh-wrapper-removal-changelog`
at HEAD = `origin/main` + this task's branch tip) produced the following matches:

- `plugins/ralph/CLAUDE.md:24` — v5.46.0 enumeration (KEEP AS-IS — historically accurate).
- `plugins/ralph/CLAUDE.md:52,53` — "Runtime body" table rows. KEEP (these describe the deletion accurately).
- `plugins/ralph/CLAUDE.md:69` — v5.34.0-era "Phase 3" prose. STALE: v5.46.0 deleted the thin shims described here.
- `plugins/ralph/CLAUDE.md:83,84` — "Backward-compatible shim only" table rows. STALE: shims removed in v5.46.0.
- `plugins/ralph/CLAUDE.md:179` — v5.33.0 release note describing the four claude → copilot-exec.sh re-routes. STALE FORWARD: the runtime path is now `node src/copilot-exec.mjs`.
- `plugins/ralph/CLAUDE.md:187` — v5.33.0 schema-prose snippet. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:189` — v5.33.0 `copilot-exec.sh --model` description. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:195` — v5.33.0 prompts/copilot.md note referencing `copilot-exec.sh`. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:204,205` — v5.34.0 review-loop / plan-reviewer Codex-path description. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:210` — test description still naming `.sh` scripts. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:221,224` — v5.32.0 `copilot-exec.sh` parity-bump note. KEEP as version history.
- `plugins/ralph/CLAUDE.md:230,232` — v5.31.0 multi-model-investigate skill description. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:279` — severity-rubric two-way operationalization. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:325,326,346,347` — v5.21.0 / v5.22.0 release-note Codex bumps. KEEP as version history.
- `plugins/ralph/CLAUDE.md:388` — v5.34.0 review-loop commit-attribution note. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:417` — `prompts/copilot.md` description. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:671,672` — Appendix D iteration engine descriptions (same content as `skills/implement-with-ralph/SKILL.md:1624,1625`). STALE FORWARD.
- `plugins/ralph/CLAUDE.md:789,790` — "Plugin files" table rows still describing the deleted shims as "Thin bash shim". STALE FORWARD.
- `plugins/ralph/CLAUDE.md:806,807,808,809` — agent prompt copy-target table rows. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:860,862,887` — plan-with-ralph Phase 2/4 + prompt-template descriptions. STALE FORWARD.
- `plugins/ralph/CLAUDE.md:996` — `jq` prerequisites note that lists the deleted shims. STALE FORWARD.

The rule of thumb for the follow-up: lines INSIDE a `## v5.<N>.0` release-note block
ABOVE v5.46.0 stay as version history. Lines OUTSIDE the release-note blocks (current
architecture tables, Appendix D, file-purpose tables, prerequisites) get updated to the
post-v5.46.0 `.mjs` reality.

**Cross-reference:** `caller-sweep.md` (sibling); `audit-report.md` Batch 3 row.

**Suggested seed (for overview-data.js prompts.plan):**

> /plan-with-ralph "Refresh `D:/ai-developer-toolkit/plugins/ralph/CLAUDE.md` post-v5.46.0 so plugin-architecture sections (file-purpose tables, Appendix D iteration-engine prose, prerequisites) describe the `.mjs`-only runtime. Preserve release-note blocks above v5.46.0 verbatim as version history. Lines to update (from `D:/harness-efforts/codexu/.ralph/jobs/ralph-exec-sh-wrapper-removal-changelog/follow-ups.md` STALE-FORWARD enumeration): 69, 83-84, 179, 187, 189, 195, 204-205, 210, 230, 232, 279, 388, 417, 671-672, 789-790, 806-809, 860, 862, 887, 996. Lines to KEEP as historical record: 24, 52-53, 221, 224, 325-326, 346-347. Verify with `git grep -nE 'codex-exec\.sh|copilot-exec\.sh' plugins/ralph/CLAUDE.md` reporting only the KEEP-lines (and the v5.46.0 BREAKING CHANGE prose if added). Multi-remote push (origin + work). Phase 5a/5b internal to /implement-with-ralph."

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
