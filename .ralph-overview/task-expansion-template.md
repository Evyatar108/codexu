# Task Expansion Template

> Use this template whenever an agent needs to produce a structured overview of
> a tracked task from `.ralph-overview/data.json`. Companion to the
> `overview.expand_task_context(taskId)` MCP tool exposed by the
> `ralph-overview` plugin: call the tool first to fetch a typed bundle of
> deterministic context (task entry, snapshot stage, recent commits,
> auto-discovered prereq/unblocks **candidates**, plan/brainstorm paths), then
> author the prose synthesis below.
>
> The five sections are a **contract**: every expansion must include all five
> with the H2 headings verbatim. The per-section guidance is non-normative but
> documents the evidence rubric every section should satisfy.

## Evidence Rubric (applies to all sections)

- **Cite source files** with repo-relative paths (e.g.
  `plugins/ralph-overview/tools/overview-mcp/src/server.ts:18`).
- **Link commits by full SHA**, not abbreviated hash, when referencing prior
  work (`recentCommits[].sha` is the full 40-char SHA).
- **Distinguish auto-discovered candidates from curated metadata.** Anything
  the tool labels `candidate: true` is heuristic — the prose must filter
  before asserting it as fact. Curated fields (`task.scope`, `lifecycle`,
  `shipManifest`, `prompts.*`) can be asserted directly.
- **Surface caveats verbatim** — if the bundle returned `caveats[]`, the
  expansion must reproduce or paraphrase each one (e.g. codex-submodule
  prereqs were not searched; git log timed out).
- **No invented prereqs / unblocks.** If the bundle's `prerequisitesCandidates`
  and `unblocksCandidates` are empty, the expansion's "Prerequisites" and
  "Unblocks" sections may be `_None auto-discovered; operator must curate
  manually._` — do not fabricate links.

## What it is

What the task ships, in two to four sentences. Lead with the user-visible
change or the artifact being produced. Draw from `task.command.descriptionHtml`
(strip tags), `task.command.prompts.plan` for the planned approach, and the
plan file at `planPath` when present. Avoid restating the task id verbatim —
the reader already knows it.

## Why it matters

The problem this task addresses, the cost of NOT doing it, and which downstream
work it unblocks. Pull from `task.scope` (what part of the system this touches),
recent operator commentary in `task.command.warnings`, and any context the
brainstorm document captures (at `brainstormPath`, when present). Anchor
the "why" to a concrete user (operator, lead, member) or a measurable cost
(rebase work, false-positive noise, time-to-publish), not to abstract quality
properties.

## Upstream-conflict surface

Which files / packages / submodules this task is expected to touch, and which
of those overlap with frequently-changed upstream code (codex-rs/, slopus/happy
files). Use the bundle's `task.scope` as the starting filter, then enumerate
specific files from `task.command.prompts.{plan, impl}` (these prompts typically
name file paths). When `task.scope` matches `/codex/`, mirror the bundle's
codex caveat — git log was not searched in the codex submodule, so the upstream
conflict surface inside `codex/external/repos/codex-patched/codex-rs/` must be
assessed by the agent independently. Conclude with a one-line risk label:
**low / medium / high** based on file overlap with shared/hot paths.

## Prerequisites

Tasks, commits, or external work that must land BEFORE this task can ship.
Render `prerequisitesCandidates[]` as a bulleted list with one line per
candidate showing `{ candidateTaskId or sha, heuristic, file }` and a
one-sentence "why this might be a prereq" filter. **Every bullet must be
prose-validated**: if you cannot justify why the heuristic match is a real
prereq (vs. a coincidental file-overlap), drop it. End with curated
prerequisites pulled from `task.command.warnings` or `task.command.prompts`
text if the operator named any. If no prereqs survive filtering and curation,
write `_None._`.

## Unblocks

Other tracked tasks that become actionable once this task ships. Render
`unblocksCandidates[]` similarly — each is a `lifecycle=tracked` task whose
prompts reference this task id. Validate by reading the candidate's
`prompts.{brainstorm, plan, impl}` (the tool returns task ids, not snippets;
the agent must read the candidate task's prompt text from `data.json` to
confirm) and surface the relationship in a one-sentence "X needs this because
Y" justification. If `unblocksCandidates` is empty and no curated `blocks[]`
fields exist on this task entry, write `_None auto-discovered._`.

---

_Tool contract: see `plugins/ralph-overview/skills/expand-task/SKILL.md` in
the `ralph-overview` plugin for the agent-facing usage of
`overview.expand_task_context(taskId)`. Bundle field provenance: every
non-`candidate` field is a verbatim read from `.ralph-overview/data.json`
or the merged snapshot; candidate fields are heuristic and must be
filtered._
