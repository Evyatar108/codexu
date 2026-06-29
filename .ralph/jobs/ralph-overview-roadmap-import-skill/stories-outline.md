# Stories outline — `ralph-overview-roadmap-import-skill`

Single-job decomposition (one impl member). All work targets the
`ai-developer-toolkit/plugins/ralph-overview/` submodule. Stories are sequential;
no parallel-split needed (all touch the same plugin → same plugin.json/CHANGELOG/AGENTS).

## US-001 — Author `skills/import-roadmap/SKILL.md`
- Create `skills/import-roadmap/SKILL.md` modeled on `create-task/SKILL.md`.
- Front-matter: `name: import-roadmap`, description (bulk-file tracked tasks from a
  ROADMAP.md heading+bullet doc, dry-run preview, createOnly apply).
- Document the 5-phase contract: Parse → Dedup → Preview (editable proposed-tasks.json) →
  Confirm → Apply (fail-soft manifest). Resolve repo+plugin root via env (invariant 4).
- AC: file exists; no FORBIDDEN tokens (`Skill(`/`Agent(`/`BashOutput`/`run_in_background`/
  `Enter|ExitPlanMode`); parse/dedup/preview/confirm/apply phases present; reuses createOnly;
  ids validate `^[A-Za-z0-9_./-]+$`; cancel = no write; re-run idempotent.

## US-002 — Regenerate Copilot mirror
- Run `node scripts/generate-copilot-artifacts.mjs --write`; commit
  `.copilot-plugin/copilot-skills/import-roadmap/SKILL.md`.
- AC: mirror exists + matches discovery; `checkCopilotArtifacts` zero drift; mirror count = 6.

## US-003 — Version bump + 3 marketplace indexes + CHANGELOG
- Bump `.claude-plugin/plugin.json` 2.14.3 → 2.15.0 (minor: additive skill).
- Bump `version` in all three indexes (claude/github/agents); run
  `node tools/validate-codex-marketplace-policy.mjs`.
- Prepend `## [2.15.0]` Added section to `CHANGELOG.md`.
- AC: 4 files agree on 2.15.0; policy validator passes.

## US-004 — Docs: plugin AGENTS.md + codexu AGENTS.md table
- Plugin `AGENTS.md`: skill count 5→6, add import-roadmap to skill list.
- codexu `AGENTS.md`: active-plugin-versions table ralph-overview → 2.15.0.
- AC: tables consistent; CLAUDE.md NOT staged.

## Verification
- Manual smoke: 10-item fixture ROADMAP.md → preview 10 → confirm subset → createOnly,
  re-run = all skipped. Existing-id collision reported, not aborted. No data.json hand-edit.
- `npm test` (lib) green; copilot drift check green; policy validator green.
