# Stories Outline: ralph-exec-sh-wrapper-removal-changelog

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Promote v5.46.0 BREAKING CHANGE advisory in CHANGELOG.md
**Description:** As a downstream operator scanning the ralph CHANGELOG, I want the v5.46.0 shim removal flagged with a clearly-labeled, top-of-section BREAKING CHANGE bullet, so I notice the breakage before reading the full phase narrative.
**Acceptance Criteria:**
- [ ] `plugins/ralph/CHANGELOG.md` v5.46.0 section leads with a bold-led top bullet `- **BREAKING CHANGE (v5.46.0): bash entry-shims codex-exec.sh and copilot-exec.sh removed.**`.
- [ ] Bullet names the two shims explicitly + cross-references the line-7 bullet for the nine other Phase 2/3 entry-shims removed in v5.46.0.
- [ ] Bullet includes the migration command form: `node plugins/ralph/src/codex-exec.mjs ...` and `node plugins/ralph/src/copilot-exec.mjs ...`.
- [ ] Bullet includes the hermetic-test exemption: `CODEX_EXEC_SCRIPT` / `COPILOT_EXEC_SCRIPT` env vars still honored, extension-detected (`.sh` → `bash`, `.mjs` → `node`).
- [ ] Bullet cites the audit-report path: `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md`.
- [ ] Pre-existing line-24 advisory bullet is removed; line-7 enumeration bullet kept verbatim.
- [ ] No version bump in `plugins/ralph/.claude-plugin/plugin.json` (stays at `5.46.0`).
- [ ] Typecheck N/A (markdown only); commit succeeds with no docs-linter complaint.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Extend codex-exec.mjs / copilot-exec.mjs JSDoc headers with BREAKING-CHANGE pointer
**Description:** As a developer opening `src/codex-exec.mjs` or `src/copilot-exec.mjs` directly, I want a JSDoc `@see` line at the top of the existing header block that points to the CHANGELOG v5.46.0 BREAKING CHANGE entry, so I find the migration context without leaving the file.
**Acceptance Criteria:**
- [ ] `plugins/ralph/src/codex-exec.mjs` existing JSDoc header block is extended with an `@see CHANGELOG.md v5.46.0 — bash entry-shim 'codex-exec.sh' removed. Invoke via 'node plugins/ralph/src/codex-exec.mjs ...'.` line at the TOP of the JSDoc body (above the Phase 3 porting contract text).
- [ ] `plugins/ralph/src/copilot-exec.mjs` JSDoc header mirrors the same pattern, referencing `copilot-exec.sh` and `copilot-exec.mjs`.
- [ ] `@see` line lives INSIDE the existing JSDoc; no separate `//` comment prepended.
- [ ] Typecheck passes (no behavior change; comment-only edit).
**Dependencies:** US-001 (the bullet US-002 points to must exist first)
**Estimated complexity:** small

## US-003: Produce caller-sweep.md audit report
**Description:** As the lead bookkeeper / reviewer, I want a documented caller-sweep report at `.ralph/jobs/ralph-exec-sh-wrapper-removal-changelog/caller-sweep.md` that records the exact grep commands, the include/exclude heuristic, the findings table, and an explicit "zero active callers" statement, so I can confirm no consumer was missed.
**Acceptance Criteria:**
- [ ] File at `D:/harness-efforts/codexu/.ralph/jobs/ralph-exec-sh-wrapper-removal-changelog/caller-sweep.md` exists with required sections (Search scope / Grep commands / Heuristic / Findings / Active callers / Follow-up tasks filed).
- [ ] Grep commands are literal `git grep -nE 'codex-exec\.sh|copilot-exec\.sh'` runs per repo with output reproducible.
- [ ] EXCLUDE list explicitly named per plan (CHANGELOG.md, .agents/memory/feedback_*.md, .ralph/jobs/*/{plan,research-brief,...}.md, test fixtures, generated overview sidecars, test mocks).
- [ ] INCLUDE list explicitly named (skills, agents, schemas, app scripts, hand-edited docs, codexu-roadmap.md, hand-edited overview-data.js prose).
- [ ] Findings table covers every INCLUDE-list match with file:line + classification (HISTORICAL / DOCUMENTATION / STALE PROSE / TEST FIXTURE / ACTIVE CALLER).
- [ ] `## Active callers` section explicitly states ZERO and explains why CODEX_EXEC_SCRIPT / COPILOT_EXEC_SCRIPT don't count.
- [ ] `## Follow-up tasks filed` section links to `follow-ups.md`.
**Dependencies:** US-001 (audit report cites the CHANGELOG bullet by path; the two repo PRs can land in either order, but the citation is most meaningful once US-001 is on the topic branch)
**Estimated complexity:** small

## US-004: File follow-up tasks for STALE PROSE findings
**Description:** As the bookkeeper, I want a `follow-ups.md` with one section per identified stale-prose cluster, using a markdown schema the bookkeeper can paste into `plans/overview-data.js` prompt fields, so the cleanup work is queued without bloating this PR.
**Acceptance Criteria:**
- [ ] File at `D:/harness-efforts/codexu/.ralph/jobs/ralph-exec-sh-wrapper-removal-changelog/follow-ups.md` exists.
- [ ] Uses the schema from the plan: `## ralph-<id>` header per section, with Summary / Scope (files + lines) / Cross-reference / Suggested seed subsections.
- [ ] Four sections in order: `ralph-stale-sh-prose-cleanup-skills`, `ralph-stale-sh-prose-cleanup-copilot-mirror`, `ralph-claude-stale-sh-prose-cleanup`, `codexu-roadmap-stale-sh-refs`.
- [ ] Copilot-mirror section cross-references `Batch 3: ralph-implement-skill-mirror-regenerate-2026-05-28` from the audit-report.
- [ ] CLAUDE.md section lists FRESH `git grep -nE 'codex-exec\.sh|copilot-exec\.sh' plugins/ralph/CLAUDE.md` output (impl produces authoritative line list).
**Dependencies:** None (independent of US-001/002/003; can run in parallel)
**Estimated complexity:** small
