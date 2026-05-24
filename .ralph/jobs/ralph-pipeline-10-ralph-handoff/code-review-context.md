# Code Review Context — ralph-pipeline-10-ralph-handoff

## Scope and footprint

- Single new file: `plans/ralph-overview-task-id.md` (248 insertions, no other touches).
- INDEX (`plans/ralph-pipeline-INDEX.md`) audited and intentionally left unchanged. The only existing reference (line 127) is descriptive and contains the still-correct `overviewTaskId` field name — no version pin or filename divergence triggers an INDEX refresh per the plan's conditional AC.

## Patterns and conventions observed

- The doc deliberately mirrors the section ordering from the source plan's acceptance criteria (Sections 1-10) so each AC bullet maps to a numbered subsection in the doc. This makes verification straightforward but means narrative reorganizations would break the AC mapping.
- Plugin version pin convention: both cached (v5.32.0) and source-tree (v5.35.0) versions cited with a drift-reconciliation directive. Used here at lines 3-4 and re-cited at the bottom of Section 10.
- Field name `overviewTaskId` (camelCase, kebab-case CLI `--overview-task-id`) is used consistently across PRD, group, and brainstorm artifact sections.
- §3.5 is a "conditional patch site" pattern — it documents an inert-by-default patch and ties activation to a §6.1 resolution choice. Future doc edits should preserve the conditional contract.

## Gotchas / cross-cutting concerns to know

- **Brainstorm metadata is NOT the same compat surface as plan metadata.** §6.1's metadata-format dilemma exists because `implement-with-ralph` Phase 0 has a first-line check against `plan.md`. `selected-direction.md` is not consumed by Phase 0 and has no first-line constraint. Conflating these two surfaces (see finding F-001) is the most likely future drift.
- **Section 7 ordering convention.** Listing a "conditional prerequisite" as the last numbered item with an inline "must run before step N" qualifier is confusing. Future docs in this pipeline should use an unnumbered prerequisite or step-0 convention.
- **Plugin source vs cache split.** Reviews and patches must edit `D:/ai-developer-toolkit/plugins/ralph/`; the cache at `~/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/<version>/` is downstream. The doc surfaces this at §6.3 — the convention is repo-wide and applies to every Ralph-plugin-touching handoff doc.
- **Codex MCP transport noise.** Codex iteration logs include a benign `worker quit with fatal: Transport channel closed` line at the end of normal runs (visible in the iteration log tail). This is not a review failure signal — the review file still gets written.
