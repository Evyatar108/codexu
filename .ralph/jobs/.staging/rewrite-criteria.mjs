import fs from 'node:fs'

const prdPath = process.argv[2]
const prd = JSON.parse(fs.readFileSync(prdPath, 'utf8'))

const rewrites = {
  'US-002': [
    'scripts/lib/derive-next-command-cli.mjs exists. Reading plans/overview-snapshot.json, looking up --task <id>, resolving repoRoot via git rev-parse --show-toplevel, and writing NextCommand | null as JSON to stdout.',
    'Optional --snapshot <path> overrides the snapshot location.',
    'On no-match, exits non-zero with a stderr message naming the missing task id.',
    'CLI smoke: `node scripts/lib/derive-next-command-cli.mjs --task <known-task-id> --snapshot <fixture-snapshot.json>` exits 0 and stdout JSON-parses to an object with string fields `label` and `command`; running with --task <missing-id> exits non-zero.',
    'Vitest at scripts/lib/derive-next-command-cli.test.mjs covers at least 3 cases: happy-path --task on a fixture snapshot returns expected command; --snapshot override resolves to a custom file; --task missing exits non-zero with the task id in stderr. `pnpm test scripts/lib/derive-next-command-cli.test.mjs` passes.',
    'Typecheck passes.',
  ],
  'US-003': [
    '.claude/skills/work-on/SKILL.md exists with YAML frontmatter (name: work-on, description: ...).',
    'Body covers arg parsing (positional <task-id> exact case-insensitive match; --dry-run; --via-crew error for Plan 08); snapshot location; task resolution + picker on ambiguity; null-handling for shipped vs other stages; seed-prompt fallback; explicit skill-name mapping (/plan-with-ralph -> ralph-orchestration:plan-with-ralph etc.).',
    'Dry-run output verified deterministically: `node scripts/lib/derive-next-command-cli.mjs --task <fixture-id> --snapshot <fixture-snapshot.json>` returns the predicate-table command for the task stage as JSON. The /work-on skill body invokes this same CLI, so the CLI test in US-002 and the predicate test in US-001 transitively cover the dry-run output.',
    '`/work-on <known-id> --via-crew foo` errors with the exact string "crews delegation not yet implemented — wait for Plan 08." (assert by `grep -q "crews delegation not yet implemented" .claude/skills/work-on/SKILL.md` exit 0).',
    'Skill body content asserted by grep against `.claude/skills/work-on/SKILL.md`: `grep -q "name: work-on"`, `grep -q -- "--via-crew"`, `grep -q "ralph-orchestration:plan-with-ralph"` all return exit 0.',
    'Typecheck passes.',
  ],
  'US-004': [
    '.claude/skills/triage/SKILL.md exists with frontmatter and body.',
    'Reads snapshot.recommendations primarily; falls back to plans/overview-recommendations.json wrapper only when snapshot is missing (not when snapshot is present-but-empty).',
    'Renders numbered list with taskId, stage, score, reasons; prompts for picker; selecting a number invokes /work-on <id>.',
    '--limit N and --filter stage=<stage> flags supported.',
    'Behavior verified deterministically: skill body contains the documented snapshot-vs-wrapper fallback rule, the no-recommendations message string "no recommendations available", and the picker-to-/work-on chain instruction. Verified via grep against `.claude/skills/triage/SKILL.md`: `grep -q "snapshot.recommendations"`, `grep -q "no recommendations available"`, `grep -q -- "--limit"`, `grep -q "--filter stage="` all return exit 0.',
    'Typecheck passes.',
  ],
  'US-005': [
    '.claude/skills/blocker-report/SKILL.md exists with frontmatter and body.',
    'Filters snapshot.tasks for ralph.stage === "blocked", ralph.stage === "review-fix" with non-zero reviewOpenCount.code|docs (open Medium+ findings — wording must match), ralph.deferredQuestionsCount > 0 (gated; undefined treated as 0), and PRD userStories[].blocked === true.',
    'Renders entries with taskId, stage, jobDir, blocker summary, proposed action (/implement-with-ralph resume <jobSlug>). Picker chains into /work-on.',
    'Behavior verified deterministically: skill body contains the four filter clauses and the literal phrase "open Medium+ review findings" (NOT "Critical/High"). Verified via grep against `.claude/skills/blocker-report/SKILL.md`: `grep -q "blocked"`, `grep -q "reviewOpenCount"`, `grep -q "deferredQuestionsCount"`, `grep -q "open Medium+"` all return exit 0.',
    'Skill body contains the proposed-action template `/implement-with-ralph resume` and the picker-to-/work-on chain instruction. Verified via `grep -q "/implement-with-ralph resume"` and `grep -q "/work-on"` against `.claude/skills/blocker-report/SKILL.md` returning exit 0.',
    'Typecheck passes.',
  ],
}

for (const story of prd.userStories) {
  if (rewrites[story.id]) {
    story.acceptanceCriteria = rewrites[story.id]
  }
}

fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2) + '\n')
console.log('Rewrote criteria for:', Object.keys(rewrites).join(', '))
for (const story of prd.userStories) {
  console.log(`  ${story.id}: ${story.acceptanceCriteria.length} criteria`)
}
