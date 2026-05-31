Lenses: ran=[devils-advocate]; synthesized-inline=[feasibility, product-reality]; skipped=[codex, copilot] (external CLI lenses not dispatched in this brainstorm run; the synthesizer represented "feasibility" and "product-reality" framings inline from concrete codebase context — see Codex/Copilot lens notes below)

The lens skips are intentional given the spawn-prompt's hard requirement to produce `selected-direction.md` in the same turn as the kind=done report (overriding SKILL Phase-4's interactive halt). The devil's-advocate lens (Anthropic general-purpose subagent, 23s) ran for real and is the load-bearing external perspective; its disconfirming observation reshaped the recommendation.

## Codex (feasibility) lens — inline

The obvious target is `ralph-overview` plugin (`C:/Users/evmitran/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/tools/overview-mcp/`). It already has a working MCP server with `overview.init`, `overview.parallel_ready_tasks`, `overview.validate_data`, `overview.watcher_status`. Adding a new tool is mechanically trivial: define an input schema in `src/schemas.ts`, add a handler under `src/tools/expand-task.ts`, register in `src/server.ts`. The plugin already reads `.ralph-overview/data.json` + `.ralph-overview/generated/snapshot.json` via `src/snapshot-reader.ts` — same code path can fetch one task by id. Cross-engine works automatically because both Claude Code and Copilot CLI load ralph-overview via marketplace registration (`enabledPlugins["ralph-overview@ai-developer-toolkit"]`). Implementation surface for a v1 expand-task tool: ~150–250 lines of TS + a small companion skill, no schema migration required if the tool is purely context-bundling.

## Copilot (product-reality) lens — inline

Operator's key criterion: "usable from any agent session." Three observed workflows feed this:

1. The overview-bookkeeper lead expanding a candidate task before deciding to spawn a member (the original triggering use-case 2026-05-31).
2. An impl member picking up a task and wanting upstream-conflict-surface context before editing.
3. A planner (`/plan-with-ralph`) wanting prerequisite + unblocks context to inform plan phasing.

All three need the SAME structured output: the 5 sections. None of them want a side-channel cache that goes stale — they want fresh, called at decision time. The dashboard rendering question is a distraction; expansions are inputs to human/agent decisions, not artifacts to display alongside kanban cards. The operator's existing `data.json` curation (descriptionHtml, prompts, kanbanCards) IS the dashboard-facing artifact; expansions are agent-facing.

## Devil's-Advocate lens — ran, JSON captured

Verbatim disconfirming observation: "If agents given a simple checked-in template plus data.json/snapshot context already produce consistently useful 5-section overviews, then a dedicated skill/MCP tool is solving a tooling preference, not a workflow gap."

Three contrarian directions: zero-code template doc; curated metadata over auto-discovery; on-demand only, no cache. All three challenge the obvious-looking path (extend ralph-overview + hybrid auto-discovery + both cache+on-demand + both MD+JSON). Red flag raised on internal consistency of operator's framing.

Questions left for synthesizer to not paper over: which exact decisions does expansion improve; which side wins when auto-discovery conflicts with curated data.json; does the tool enforce evidence or just generate prose; what invalidates cached expansions and who owns regeneration.

---

## Candidate Directions

### D-001: Zero-code template doc
- Contributing lenses: [devils-advocate]
- Why this might work: Lowest-cost path — add `.ralph-overview/task-expansion-template.md` (or `docs/task-expansion-template.md`) defining the 5 sections + evidence rubric. Bookkeeper instructs each session to read it before generating an expansion. Iterates faster than code, no MCP rebuild needed, no install-step on consumer machines.
- Risks / friction: Agents drift from the format without code-level enforcement. "Usable from any agent session" becomes "usable from any agent session if the operator remembers to point them at the template" — that's a discoverability tax the operator already pays today. Doesn't bundle the relevant context (data.json fields, git log, snapshot) — each session still does its own grep.
- Cheapest validation: Write the template, use it twice in real bookkeeper sessions, measure whether 5-section adherence improves vs the ad-hoc 2026-05-31 baseline. Cost: ~30 min.
- Disconfirming observation: If sessions need to be reminded to read the template every time, the "skill" framing was wrong — the gap is enforcement, not documentation.

### D-002: Extend ralph-overview with MCP tool + thin skill (full prose generation in-tool)
- Contributing lenses: [feasibility]
- Why this might work: Adds `overview.expand_task(taskId)` to overview-mcp; the tool itself synthesizes the 5-section Markdown by reading data.json, snapshot, git log, optional plan.md. Cross-engine free (MCP layer). Predictable output shape because the code controls section ordering and headers.
- Risks / friction: The MCP tool ends up running its own LLM call (or pulling in a templating layer) to generate prose from heterogeneous evidence — that's a meaningful new dep + cost surface in a plugin that today is pure deterministic data plumbing. Code-as-author loses the agent's interpretation layer (which is what made the 2026-05-31 bookkeeper expansion praise-worthy in the first place: human-style synthesis, not template-fill). And the prose-generating code is now the thing operators have to read to debug a misleading expansion.
- Cheapest validation: Spike the tool returning hardcoded sample prose for one task; have the operator compare against the 2026-05-31 reference. Cost: ~2 h.
- Disconfirming observation: If the tool's generated prose is consistently flatter / less insightful than what an agent writes from the same inputs, the synthesis layer belongs in the agent, not in the tool.

### D-003: New dedicated plugin under D:/ai-developer-toolkit/plugins/task-expansion/
- Contributing lenses: [feasibility]
- Why this might work: Clean separation, doesn't bloat ralph-overview, plugin lifecycle (versioning, CHANGELOG, install) is independent.
- Risks / friction: Duplicates ralph-overview's data.json + snapshot readers (or takes ralph-overview as a peer dep, which the plugin system doesn't really support). Adds an install step on every consumer machine (`copilot plugin install task-expansion@ai-developer-toolkit`) for a feature with one consumer (the codexu bookkeeper). Plugin registration is the highest-friction part of any change in this ecosystem — adding a new plugin just for context-bundling-plus-a-template is over-architected.
- Cheapest validation: Stand up an empty plugin scaffold and measure registration overhead. Cost: ~3 h.
- Disconfirming observation: If the plugin needs to peer-import ralph-overview's readers, it's not actually independent and should just be a tool inside ralph-overview.

### D-004: Hybrid — checked-in template + thin context-bundling MCP tool (no prose generation in code) ⭐
- Contributing lenses: [devils-advocate, feasibility, product-reality]
- Why this might work: Splits the problem along the right seam. The TEMPLATE (`.ralph-overview/task-expansion-template.md`, checked into codexu) owns the format contract — the 5 sections, headers, evidence rubric, and a one-paragraph "how to use the bundled context" guide. The MCP tool (`overview.expand_task_context(taskId)` added to overview-mcp) owns the CONTEXT BUNDLE — it returns structured JSON: the task entry from data.json (descriptionHtml, prompts, kanbanCards, lifecycle, status), `prerequisitesCandidates[]` (auto-derived heuristic — explained below), `unblocksCandidates[]` (inverse of prerequisitesCandidates against tracked tasks), recent git log entries matching the task id, the watcher-snapshot stage if any, and pointers to plan.md / brainstorm artifacts if they exist on disk. The agent does the prose synthesis using the template + bundle. Curated `unblocks` / `unblockedBy` schema fields on TaskSchema are deferred to a Phase 2 follow-up — v1 keeps auto-discovery advisory ("candidates", explicitly).
- Risks / friction: Agent still has to follow the template — but the bundle includes a `templatePath` field pointing at the checked-in template, so the agent reads it first thing. Auto-discovery heuristic might surface noise (commits that mention the task id but aren't really prerequisites); v1 labels every entry "candidate" and lets the agent filter. The skill side is thin: a `/expand-task <id>` skill (or just a documented invocation pattern) that calls the MCP tool and tells the agent to use the bundle + template.
- Cheapest validation: Implement the MCP tool returning the bundle for one task id; have the bookkeeper run it and write an expansion using the bundle + template; compare to the 2026-05-31 reference. Cost: ~4 h for tool + ~1 h for template + ~30 min validation.
- Disconfirming observation: If the auto-derived `prerequisitesCandidates` are wrong more often than right (>50% noise) on the first three real expansions, drop auto-discovery from v1 and rely entirely on operator-curated `unblocks` / `unblockedBy` fields (promoted from Phase 2 to v1).

### D-005: Curated metadata only — extend TaskSchema with `unblocks` / `unblockedBy` fields, no MCP tool
- Contributing lenses: [devils-advocate]
- Why this might work: Devil's advocate point 2 — prerequisites/unblocks are strategic project knowledge, not file facts. Operator already curates everything else in data.json; adding two optional `string[]` fields is one zod schema edit + bookkeeper discipline. Combined with a checked-in template, the operator has full control over what shows up in any expansion.
- Risks / friction: Requires up-front curation labor across the existing ~70+ tracked tasks; new tasks need fields filled in at creation time (which the bookkeeper would have to remember). No automation surface — agents still have to manually pull data.json fields together (no context bundle).
- Cheapest validation: Add the schema fields, populate them for 5 tasks, have an agent generate an expansion using only data.json + a template. Cost: ~1 h.
- Disconfirming observation: If the operator stalls on populating the fields for more than two weeks, this is a workflow that doesn't fit and we should fall back to auto-discovery.

---

## Recommendation

**D-004** — hybrid template + thin context-bundling MCP tool — clearly leads.

It is the only direction that satisfies all five lens-derived constraints simultaneously:
- (devil's advocate, point 1) Template owns format; code doesn't try to author prose.
- (devil's advocate, point 2) Operator-curated `data.json` remains authoritative; auto-discovery is explicitly advisory ("candidates").
- (devil's advocate, point 3) No cache; expansions are fresh on demand.
- (feasibility) Implementable as one TS file in overview-mcp + one markdown template + one tiny skill.
- (product-reality) "Usable from any agent session" via MCP tool layer (already cross-engine).

The Phase-2 follow-up (curated `unblocks` / `unblockedBy` schema fields) is the natural escape hatch if auto-discovery proves noisy in practice, per the D-004 disconfirming observation.

D-005 (curated-only) is the strong fallback if D-004's auto-discovery heuristic fails the first three real expansions. D-001 (template-only) is rejected because it doesn't bundle context — every session would re-grep data.json + git log, which is exactly the toil the skill should eliminate. D-002 (prose-in-tool) is rejected because it pushes synthesis into deterministic code that loses the interpretive quality the operator praised. D-003 (new plugin) is rejected as over-architected for one consumer.
