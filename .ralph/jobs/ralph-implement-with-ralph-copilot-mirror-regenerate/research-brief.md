# Research Brief: ralph-implement-with-ralph-copilot-mirror-regenerate

## Researcher Findings

### Repo layout
- Target plugin repo (sibling): `D:/ai-developer-toolkit/` on branch `main` at `b2e4913d`.
- Codexu workspace (this repo): `D:/harness-efforts/codexu/` — host of the audit job + planning context.
- The implementation work targets the sibling repo. The plan committed here lives under codexu's `.ralph/jobs/`, but the impl member will operate on `D:/ai-developer-toolkit/`.

### Audit FAIL row that triggered this work
**Source:** `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md:105-111`
- **Row:** `ralph: copilot-skill-mirror-parity`
- **Status:** FAIL
- **Command:** `node plugins/ralph/scripts/check-copilot-parity.mjs` (PASSED) **AND** `grep -nE "\.sh\b" .copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md` (33 hits).
- **Observed:** "Generator parity script passed all assertions, but `implement-with-ralph` Copilot mirror still contains 33 `.sh` references including `ralph.sh`, `codex-exec.sh`, `drain-cascade.sh`, and `parse-not-tested-trailers.sh` prose. The plan says any `.sh` hit in this mirror is a FAIL row."
- **Follow-up filed:** "Batch 3: ralph-implement-skill-mirror-regenerate-2026-05-28" (this task).

### Exact stale-`.sh` inventory (mirror)

`D:/ai-developer-toolkit/plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md` — 33 `.sh\b` hits:

| Category | Hits | Lines | Replacement |
|---|---|---|---|
| `codex-exec.sh` | 1 | 1662 | `src/codex-exec.mjs` |
| `review-loop.sh` (pattern ref) | 1 | 1105 | `src/review-loop.mjs` |
| `drain-cascade.sh` | 2 | 507, 520 | `scripts/drain-cascade.mjs` |
| `lib/parse-not-tested-trailers.sh` | 1 | 444 | `src/parse-not-tested-trailers.mjs` |
| `ralph.sh` (system name + literal invocations + protocol) | 28 | 15, 30, 35, 36, 37, 92, 94, 139, 253, 316, 320, 437, 489, 643, 685, 691, 698, 712, 714, 716, 718, 736, 778, 786, 824, 837, 853, 892 | varies — see plan §Approach |
| **Total** | **33** |  | |

### Exact stale-`.sh` inventory (Claude source — must be cleaned too)

`D:/ai-developer-toolkit/plugins/ralph/skills/implement-with-ralph/SKILL.md` — 38 `.sh\b` hits (more than mirror because mirror was partially hand-cleaned in v5.46.0 release):
- `codex-exec.sh`: 2 (lines 1624, 1639)
- `copilot-exec.sh`: 2 (lines 1625, 1640)
- `review-loop.sh`: 5 hits
- `drain-cascade.sh`: 2 hits
- `ralph.sh`: 27 hits

Source must converge on zero `.sh\b` hits — otherwise the mirror will inherit staleness on the next regeneration.

## Architect Analysis

### Hand-fork pattern (critical)
`implement-with-ralph` is **NOT** in the auto-mirror list of `generate-copilot-artifacts.mjs`:
- `D:/ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs:37` `USER_SKILLS = ['brainstorm-with-ralph', 'plan-with-ralph', 'multi-model-investigate', 'prepare-handoff']`.
- `implement-with-ralph` is deliberately excluded because its Copilot mirror has structural divergences (async polling semantics, marker-file fallback, planning-engine appendix) tracked via 3 anchor exceptions in `.copilot-plugin/parity-exceptions.json:5-20`.
- **Implication:** Running `generate-copilot-artifacts.mjs --write` will NOT regenerate this mirror. The spawn prompt's Step 1 ("Run the generator") will produce no diff for implement-with-ralph. Hand-edits are required for BOTH the Claude source and the Copilot mirror in lockstep.

### Existing parity gate (Assertions A–E)
`D:/ai-developer-toolkit/plugins/ralph/scripts/check-copilot-parity.mjs`:
- **A:** Generated artifacts (auto-mirrored skills + internal workflows + agents) match generator output.
- **B/C/D:** Hand-fork anchor tracking — every Claude H2/H3 header has a Copilot anchor or is declared in `parity-exceptions.json`; no stale anchors; Copilot-only H4+ headers declared.
- **E:** Forbidden Copilot tokens absent: `Skill(`, `Agent(`, `BashOutput`, `run_in_background`, `<options-mode>`, `--add-dir`, `mcp__`.

**Gap:** No assertion forbids `.sh\b` references in skill-mirror prose. This is the gap that lets stale-shim prose ship.

### Other Copilot mirrors and their staleness
- `plan-with-ralph` (auto-mirrored): source and mirror both contain 10 stale `.sh` refs (`review-loop.sh` ×5, `codex-exec.sh`/`copilot-exec.sh` ×various). Not flagged by the audit (the audit row was specifically scoped to `implement-with-ralph`).
- `brainstorm-with-ralph`, `multi-model-investigate`, `prepare-handoff` (auto-mirrored): staleness mirrors source state; not in scope of this task.
- **Out of scope for this plan:** other mirrors. Plan only touches implement-with-ralph + the parity-gate to prevent recurrence. A follow-up could broaden the gate to all skills, but per spawn prompt "do not block on other 3 plans," keep scope tight.

### v5.46.0 release-stamp surface (from CHANGELOG.md tail)
"Bumps all five release stamps to `5.46.0`":
1. `plugins/ralph/.claude-plugin/plugin.json`
2. `plugins/ralph/.github/plugin/plugin.json`
3. `.claude-plugin/marketplace.json`
4. `.github/plugin/marketplace.json`
5. `.agents/plugins/marketplace.json`

### Git remotes (for "multi-remote push")
Run `git remote -v` in `D:/ai-developer-toolkit/` — at last check the repo has `origin` (github.com/...) plus a secondary remote. Impl member must verify and push to all configured remotes.

## Codex Research
Skipped — already had complete inventory from direct file inspection. Codex re-validation can run as part of the Phase 4 plan review.

## Copilot Research
Skipped — same reason. Copilot re-validation as part of Phase 4 plan review.

## Consolidated File List

### Files to modify (D:/ai-developer-toolkit/)
1. `plugins/ralph/skills/implement-with-ralph/SKILL.md` — drop all 38 `.sh\b` refs; replace per the table above.
2. `plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md` — drop all 33 `.sh\b` refs in lockstep; preserve Copilot-specific divergences (Phase 3 async polling, marker file fallback, planning-engine appendix).
3. `plugins/ralph/scripts/check-copilot-parity.mjs` — add Assertion F: no `.sh\b` references in `implement-with-ralph` Copilot mirror (and Claude source). Exemption mechanism to allow `parity-exceptions.json` to whitelist specific historically-justified survivors if needed (none expected initially).
4. `plugins/ralph/tests/test-copilot-generator.sh` OR new `plugins/ralph/tests/test-no-stale-sh-refs.mjs` — add staleness regression test. Choice between modifying existing or new file depends on whether the existing test exercises the parity script's full assertion set (it does not — separate test recommended).
5. `plugins/ralph/CHANGELOG.md` — add v5.46.1 patch entry.
6. Five release stamps (per CHANGELOG v5.46.0 listing) — bump to `5.46.1`:
   - `plugins/ralph/.claude-plugin/plugin.json`
   - `plugins/ralph/.github/plugin/plugin.json`
   - `.claude-plugin/marketplace.json`
   - `.github/plugin/marketplace.json`
   - `.agents/plugins/marketplace.json`

### Reference files (read-only, evidence/context)
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md:105-111` — the FAIL row.
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/plan.md` — audit plan with FAIL bar definition.
- `D:/ai-developer-toolkit/plugins/ralph/CHANGELOG.md:1-30` — v5.46.0 entry describing the migration that created the staleness.
- `D:/ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs` — generator (read to confirm hand-fork status).
- `D:/ai-developer-toolkit/plugins/ralph/.copilot-plugin/parity-exceptions.json:5-20` — existing exception structure for the hand-fork.

### Documentation to update
- `D:/ai-developer-toolkit/plugins/ralph/CHANGELOG.md` — v5.46.1 entry.
- No README or docs/ updates needed (the staleness is contained to SKILL.md prose + parity check).
