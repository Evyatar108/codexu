# Code Review Context — overview-data-split

Patterns discovered while reviewing the merged work in `plans/overview-data.js` + `plans/overview.html` render pipeline.

## Trusted-HTML escape hatch

The data file passes rich card-meta HTML through `cardData.html`, `warning.html`,
`node.html`, `phase.headerHtml`, and `task.command.descriptionHtml` into the
DOM via `innerHTML`. This is documented in plan Risk #9 as deliberate trust:
the data file is operator/agent-authored, not user-input. The original
`plans/overview.html` rows were similarly hand-authored HTML, so the trust
model is unchanged in practice.

The single XSS-sensitive surface that does NOT use `innerHTML` is
`task.command.planPrompt` — rendered via `pre.textContent = task.command.planPrompt`
at `plans/overview.html:1371`. This is critical: the prompt strings contain
shell metacharacters that must round-trip verbatim for copy/paste to work.

Future maintainers must NOT switch this line to `innerHTML` or template-string
interpolation — see AC line ~232 in `.ralph/job-groups/overview-data-split/plan.md`.

## Render-order coupling

`renderTasks()` and `renderPhaseTree()` run synchronously at the top of the
inline `<script>` body. Every downstream IIFE (renderPhaseBadges,
injectTaskScopeChips, classifyAndOrderCmds, injectCopyNameButtons,
injectWorkstreamPills, populateKanbanCount, populateRalphCount, persistDetails,
filter init, URL banner, applyFilter, injectSpawnRelationships, injectRunHistory,
buildTodayPanel) assumes the DOM is fully populated when it executes.

A console-invoked `renderTasks()` re-runs only the render step — none of the
enrichment IIFEs re-fire — so the rerender path is destructive for manual
debugging. Copilot flagged this; F-010.

## State coupling between `tasks[].phase` and `phaseTree[].nodes[].state`

The CSS state classes (`open|deferred|donefade|closed`) on phase-tree task-ref
nodes are stored independently of `tasks[].phase`. Flipping `phase` on a task
does NOT update the corresponding phase-tree pill's `state`. This is by design
in the schema (phase-tree carries presentation; tasks carry workflow state),
but it breaks the "edit one entry" bookkeeper-workflow AC. F-009 tracks this.

## Bookkeeper authoring contract

`.agents/skills/roadmap-and-overview/SKILL.md` Procedures A/B/D/E reference
fields that don't exist on the live data: `title`, `command.summaryHtml`,
`lastTouchedAt`. The contract is forward-looking but not realized — agents
copying the SKILL.md example into a new task will produce entries inconsistent
with the existing 49. Tracked as F-001 (`lastTouchedAt`), F-003 (`title` +
`summaryHtml` + `lastTouchedAt` consistency), F-004 (`task.title` fallback in
renderPhaseTree).

## File overlap risk realized

US-003 (full task port) and US-004 (phase tree port) both wrote to
`plans/overview-data.js` and `plans/overview.html` in parallel worktrees, with
file-overlap risk documented in plan Risk #8. The merge appears clean — no
phantom edits, no duplicated declarations, no order ambiguity in the final
file. The orchestrator's sequential-merge strategy held up.

## Stale-instruction sweep was incomplete

Codex + Copilot both flagged that `plans/overview-data.js` contains four
`planPrompt` strings that still tell future agents to edit
`plans/overview.html`'s `roadmap-data` JSON block (F-002 / F-008). Copilot
extended the sweep to surface additional hits in `plans/parallel-assignments.md`
(:133, :445) and `plans/crews-integration.md:3`. The US-005 docs-sweep did not
catch these because the planPrompt strings live in the data file, not in the
markdown docs the sweep targeted.

## Render path is innerHTML-heavy, but data is the trust boundary

Six `innerHTML` writes in the new render path (`plans/overview.html:1299, 1334,
1352, 1361, 1420, 1446`). All sources are fields of `window.OVERVIEW_DATA`,
which is loaded synchronously from `plans/overview-data.js` via a `<script src>`
tag with no fetch / no remote origin. No URL params, no localStorage values, no
user-controlled strings feed into these `innerHTML` writes. The trust model is
sound for the on-disk `file://` use case; if this page is ever served over HTTP
to multiple users, the trust assumption must be re-examined.
