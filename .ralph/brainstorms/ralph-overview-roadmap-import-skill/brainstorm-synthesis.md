Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Roadmap-import skill for ralph-overview — synthesis

All three lenses agree the feature is feasible and that the cheapest version is a
**guided skill that reuses the existing `/create-task` createOnly write path**, NOT a
new batch writer. The Devil's Advocate raised one load-bearing, source-verified red flag
that reshapes the apply contract: `data-edit-core.runVerb upsert-task` mutates exactly ONE
task per lock/serialize/atomicWrite cycle — there is no batch transaction. Bulk import is
therefore N sequential whole-shard rewrites; a mid-batch `createOnly` throw commits M tasks
then aborts, and re-running is blocked by the already-written ids. The cheapest version must
be **fail-soft (skip-existing, continue), deterministic-kebab, idempotent re-run**, or it is
worse than N manual `/create-task` calls. Second verified concern: a kebab heading yields an
id + a problem-statement card but NO `prompts.{brainstorm,plan}` — imported items are inert
stubs unless an operator curates scope + a seed prompt. So a curate/preview gate is mandatory.

### D-001: Skill-only single-format checkbox/heading importer (reuse create-task path)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Mirrors `/create-task` (canonical shape, hot+cold precheck, overview.upsert_task createOnly + `data-edit upsert-task --create-only` fallback) but bulk from ONE format (ROADMAP.md `##`/`-`/`- [ ]` lines). No new core code, no new dispatcher subcommand, no markdown dep — agent parses inline. Reusable marketplace skill, complements not replaces /create-task.
- Risks / friction: prose-heavy roadmaps yield bad ids/scopes; needs heading→scope rule; inert stubs without prompts.
- Cheapest validation: dry-run against 3 real ROADMAP.md files; count manual edits needed before confirm.
- Disconfirming observation: if agents can't reliably run multiple confirmed upsert calls from a skill, a CLI is needed (see D-004).

### D-002: Mandatory dry-run preview + editable proposed-tasks.json curate gate
- Contributing lenses: [copilot, devils-advocate]
- Why this might work: Non-writing pass normalizes candidates, runs dedup against hot+cold, emits exact createOnly ops to an editable proposed-tasks.json; operator prunes/edits scope + seeds prompts before any write. Converts inert stubs into trackable tasks; builds trust.
- Risks: review can take as long as manual creation; noisy dedup warnings.
- Cheapest validation: preview-only command on a 10-item roadmap; ask operator to approve 5.
- Disconfirming: users still prefer one-by-one if cleanup ≈ manual effort.

### D-003: Idempotent fail-soft batch apply with manifest (skip-existing, continue)
- Contributing lenses: [devils-advocate]
- Why this might work: Precheck hot+cold, CONTINUE on per-item createOnly reject (never abort), print created/skipped/collided/invalid manifest; deterministic kebab → re-run is no-op. The only safe apply contract given no batch transaction.
- Risks: defining "1 of 20 fails after confirm" behavior; collision disambiguation beyond hard-reject.
- Disconfirming: without skip+continue, mid-batch throw leaves partial set blocking retry.

### D-004: Deterministic import-roadmap CLI + lib + thin skill wrapper
- Contributing lenses: [codex]
- Why: testable scripts/lib/import-roadmap.mjs + bin subcommand + machine dry-run. Overbuild for v1; defer until skill fragility proven.

### D-005: GitHub issues + markdown tables deferred behind same canonical writer
- Contributing lenses: [codex, copilot]
- Why defer: gh auth/remote/pagination/rate-limits = scope creep; issues are arguably the better tracker. Accept only operator-supplied JSON export later if needed.

## Recommendation
D-001 is the wedge, but it MUST absorb D-002 (preview+edit gate) and D-003 (fail-soft idempotent apply) as built-in requirements — they are correctness/usability invariants, not separate phases. Defer D-004 and D-005.
