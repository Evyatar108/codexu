Lenses: ran=[codex, copilot, devils-advocate, simplification, inventory]; skipped=[] (all five ran)

> Note on mechanics: the canonical `codex-exec.mjs` feasibility lens timed out (exit 124, no
> output) doing live repo exploration at xhigh. It was re-run as a `gpt-5.3-codex` Task-tool
> agent (genuine codex model) writing the same `codex-brainstorm.txt` artifact, so the `codex`
> lens is present and grounded. The `inventory` lens is the Claude general-purpose grep-grounding
> lens the brief requested; its counts are git-grep match-lines on tracked files in the codexu
> main checkout + `ai-developer-toolkit` submodule (the `codex/` submodule and
> `.ralph/jobs/*/worktree/**` excluded).

# Brainstorm synthesis — rename the "overview" concept

## The decision in one paragraph

The system currently called "overview" is **irreducibly two things fused**: an operator-AUTHORED
intent layer (`.ralph-overview/data.json` — planPrompts, kanban cards, scope, descriptions) and a
watcher-DERIVED runtime layer (`.ralph-overview/generated/ralph-state.{js,json}` — stage,
crewSessions, storyCompletion). Four of five lenses independently concluded that **no single word
fully describes a two-thing system** and that **a destructive project-wide rename is net-negative**:
the actionable hand-edit surface is ~5,884 occurrences (~575 effort units for a FULL rename), the
biggest costs (MCP namespace `mcp__ralph-overview__*`, the `ralph-overview` plugin package, the
`.ralph-overview/` data dir, the `bin/ralph-overview.mjs` wrapper + `RALPH_OVERVIEW_PLUGIN_ROOT`
env) are **published/cross-machine contracts the repo cannot atomically migrate**, and ~60k of the
~67k raw "overview" tokens live in **immutable `.ralph/` history** that no rename can ever reach —
so even a "full" rename produces a *permanent dual-vocabulary* repo. The convergent recommendation
is therefore **D-001: adopt "roadmap" as the canonical human-facing name, lead with a crisp
one-line definition + glossary, rename only the human-facing surfaces + add non-destructive
technical aliases, and keep the `ralph-overview` technical identity.** This delivers the operator's
actual goal ("a name that tells a contributor what the system IS") at ~200 units instead of ~575,
front-loads the highest-value cheap win, and leaves a clean additive path to deeper renaming only
if real demand emerges.

## Grounded numbers (inventory lens, grep-verified 2026-06-27)

| Metric | Value |
|---|---|
| Raw tracked "overview" match-lines (excl `codex/`) | **47,585** / 1,659 files |
| — frozen historical (`.ralph/jobs/**`, batch logs) | 40,669 (not edited) |
| — auto-regenerated (`generated/**`, `tasks/INDEX.md`) | 1,032 (not hand-edited) |
| — **actionable hand-edit subset** | **≈ 5,884** (codexu 2,224 + toolkit 3,660) |
| Distinct `Overview*` types | **22** (~788 uses; `OverviewData` 382, `OverviewTask` 142, `OverviewRalphState` 83, `OverviewConfig` 70) — centralized in `tools/overview-viewer/src/types.ts` |
| MCP tools (`overview.*`, namespace `mcp__ralph-overview__*`) | **11** |
| npm scripts via `bin/ralph-overview.mjs` | 6 (`overview`, `overview:dev`, `overview:build`, `overview:build:preview`, `sync-ralph-state`, `sync-ralph-state:watch`) |
| Prose/doc mentions (buckets 4+7, bulk-sed-able) | ≈ 3,064 hand edits (~52% of FULL cost) |

**Effort by scope option (units):** FULL ≈ **575** · PLUGIN-KEEPS-NAME ≈ **430** · SURFACE-ONLY ≈ **200** · ADDITIVE-ALIAS ≈ **40** (+188 prose deferred).

**Sequencing fact (verified):** the three "must-land-after" prerequisites
(`overview-data-dynamic-stages-schema`, `overview-data-ship-manifest`,
`overview-data-context-scalability`) are all `lifecycle: merged` in
`.ralph-overview/data.archived.json`. Constraint #5 is satisfied; the remaining sequencing concern
is branch-rebase churn against any *other* in-flight type-touching work (e.g. data-relocation /
multi-mcp), which only affects the deferred TS-type rename, not the cheap human-facing layer.

---

## Candidate directions

### D-001: "Roadmap" canonical name + define-first + surface/additive scope (keep technical identity) — RECOMMENDED
- Contributing lenses: [codex, copilot, devils-advocate, simplification, inventory]
- **What it is:** Adopt **"roadmap"** as the canonical concept word in human-facing surfaces.
  Ship FIRST a one-line system definition + a glossary that maps the legacy word to the concept and
  names the two layers precisely (the **two-part vocabulary** from the simplification lens:
  *roadmap* = operator-authored intent in `data.json`; *status / pipeline-state* = watcher-derived
  runtime in `generated/ralph-state`). Then rename the human-facing surfaces (docs prose, the
  `overview-bookkeeper` role → e.g. `roadmap-bookkeeper`, the viewer `<title>`/header, additive npm
  script aliases). Add **non-destructive technical aliases** where cheap (dual-register MCP tool
  names, `export type New = Old`, dual-read env var, data-dir fallback resolution). **Keep** the
  `ralph-overview` plugin/npm/marketplace name, the `mcp__ralph-overview__*` namespace as the
  primary, the `.ralph-overview/` data dir, and the `Overview*` code types.
- **Scope mapping:** blend of option **2 (surface-only, ≈200u)** + option **4 (additive-alias,
  ≈40u)**; explicitly NOT option 1 (full, 575u). Borrows option 3's "keep the package name".
- Why this might work: delivers the operator's intent (a self-describing name + a contributor can
  now say in one sentence what the system is) at ~200–240 units, front-loaded on the cheapest,
  highest-clarity edits, with zero broken contracts and a clean upgrade path.
- Risks / friction: dual vocabulary during transition (UI/docs say "roadmap", tool ids/paths still
  say "overview") — the glossary is what keeps that from re-confusing newcomers; "roadmap" cues the
  authored half and under-describes the runtime half (mitigated by the two-part glossary vocab);
  slight collision with the static `plans/codexu-roadmap.md` doc (qualify as "Ralph Roadmap").
- Cheapest validation: write the one-line definition + glossary + the renamed viewer header on a
  throwaway branch, show it to one fresh contributor/agent, and check they can state what the system
  is and is NOT without seeing the old wording.
- Disconfirming observation: if fresh readers, AFTER the glossary, still mis-scope the system (call
  it a static planning doc, miss the runtime half), the word itself is not the blocker and the
  rename earns neither D-001 nor a heavier scope.

### D-002: Full hard rename to "roadmap" via additive aliases over 2 minors (clean-end-state maximalist)
- Contributing lenses: [codex, copilot, inventory]
- What it is: rename EVERYTHING incl. the plugin package, `mcp__ralph-overview__*` namespace, the
  `.ralph-overview/` data dir, the 22 `Overview*` types, the wrapper + env var — shipped additively
  (old names keep working as aliases) and deprecated over two minors. ~575 units FULL (+aliasing
  overhead); the "PLUGIN-KEEPS-NAME" partial variant is ~430.
- Why it might work: only path to a single-vocabulary end-state in *live* (non-history) surfaces;
  satisfies an operator who is irritated by seeing `mcp__ralph-overview__*` / `.ralph-overview/` in
  every transcript.
- Risks / friction: **cannot be atomically safe** — `enabledPlugins["ralph-overview@…"]` and MCP
  prefix references live in per-machine `~/.copilot|~/.claude/settings.json` the repo can't migrate;
  a hard cutover silently breaks the plugin (tools vanish, no error) until each machine re-installs;
  doubles maintained surface during the window; the 60k immutable `.ralph/` tokens keep the old word
  alive forever, so "clean end-state" is unreachable in principle.
- Cheapest validation: dual-register the 11 MCP tools + a viewer redirect on one release; measure
  whether the OLD names stop appearing in live surfaces after one deprecation window.
- Disconfirming observation: if usage after one window shows the old name genuinely gone from live
  surfaces, the "permanent dual-vocabulary" fear is overblown and this is merely temporarily ugly.

### D-003: Glossary-only / no rename (the 5%-effort floor)
- Contributing lenses: [devils-advocate, simplification]
- What it is: change ZERO interfaces; add a one-sentence tagline + a glossary mapping "overview" →
  the concept + a "what it is / what it is NOT" box (NOT an exec summary, NOT an arch diagram, NOT a
  status report). Optionally rename the single most operator-facing string only. ~10–40 units.
- Why it might work: the lenses argue the real onboarding friction is *conceptual* (the two-file
  split + the three independent phase axes), which a rename relabels but never explains; a glossary
  is the disambiguation the operator says a newcomer lacks, at one commit and zero churn.
- Risks / friction: leaves the *daily speech* burden untouched — the operator keeps saying a word
  that doesn't self-describe, which was the original complaint; this is exactly the gap D-001 closes
  by also adopting "roadmap" in speech/docs.
- Cheapest validation: add the glossary; ask whether the operator's complaint was about docs lacking
  a definition or about the word itself in conversation/prompts.
- Disconfirming observation: if the irritation is the WORD in speech (not missing docs), glossary-
  only under-delivers — which is why D-001 (glossary + human-facing "roadmap") is preferred over it.
- **Relationship to D-001:** D-003 is folded into D-001 as its *first phase*; D-001 is "D-003 plus
  adopt the new word where humans read/speak it."

### D-004: Two-part layer vocabulary — "roadmap" (authored) + "status" (derived)
- Contributing lenses: [simplification]
- What it is: instead of (or alongside) a single umbrella rename, name the two LAYERS precisely so
  the words teach the source-of-truth boundary: *roadmap* = the hand-authored `data.json`; *status /
  pipeline-state* = the watcher-derived `generated/ralph-state`. The merged surface stays a thin
  compositional label ("the roadmap" / "roadmap board").
- Why it might work: the only option that genuinely shortens onboarding because the two words ARE
  the explanation — it removes the "wait, it's two things" surprise entirely.
- Risks / friction: introduces THREE nouns to learn (roadmap, status, merged surface) and when to
  use each; a single stable token is cheaper in the many agent prompts.
- Cheapest validation: draft the glossary using the two-part vocab and see whether contributors
  describe the boundary correctly.
- Disconfirming observation: if agent-prompt stability matters more than human evocativeness, the
  extra nouns raise coordination burden — the opposite of simplification.
- **Relationship to D-001:** D-004's two-part vocabulary is ADOPTED inside D-001's glossary; D-001 is
  the packaging that makes D-004 land without renaming the umbrella token destructively.

---

## Cross-lens agreements and tensions

**Agreements (high confidence):**
- "roadmap" is the strongest single conceptual word (captures the dominant authored-intent half).
- A FULL destructive rename is not worth it; the published/cross-machine contracts (MCP namespace,
  plugin package, data dir, wrapper, env) are the expensive ~107 units that carry ~all the risk and
  cannot be migrated atomically from inside the repo.
- The cheap, high-value win is a definition + glossary; it should ship first regardless of scope.
- The cheap human-facing layer (prose, role, script/MCP aliases) is schema-independent and can land
  now (the three prerequisite schema tasks are already merged).

**Tensions the operator must resolve:**
- One umbrella word vs. the two-part vocabulary (D-001 resolves this by using "roadmap" as the
  umbrella AND the two-part vocab in the glossary).
- Whose burden to minimize — human contributors (favor evocative "roadmap"/"board") vs. agent
  prompts (favor a single stable token). D-001 keeps the stable technical token ("overview"/
  `ralph-overview`) for agents while giving humans "roadmap".
- Is the operator's objection to the word in HUMAN surfaces (cheap, one safe PR) or MACHINE
  interfaces (expensive, cross-machine, non-atomic)? D-001 assumes the former; if the latter, D-002
  is required and the migration runbook is mandatory.

## Open questions carried to planning
1. Confirm the canonical word is **roadmap** (vs. "board", the simplification lens's least-bad
   single word because a kanban board natively implies cards + lanes = intent + state).
2. Rename the `overview-bookkeeper` role to `roadmap-bookkeeper` in this pass, or defer (it appears
   in live `.crews/` state and ~95 doc refs)?
3. Adopt the two-part glossary vocab (roadmap + status) as the canonical layer names?
4. For technical aliases: dual-register the 11 MCP tools now (additive, ~16u) or leave MCP entirely
   on "overview" and only rename human surfaces?
5. Confirm the operator accepts permanent dual-vocabulary (live "roadmap" + frozen "overview" in
   `.ralph/` history) — the unavoidable end-state of any scope short of the impossible full rename.
