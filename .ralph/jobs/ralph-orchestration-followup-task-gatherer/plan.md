# Plan: Phase 5.5 `followup-task-gatherer` retrospective subagent

**Target plugin:** `ai-developer-toolkit/plugins/ralph/` (NB: in this fork the
plugin is named `ralph`, not `ralph-orchestration` — the older name in the
overview task title predates the rename).
**Target version:** v5.47.0 (minor bump — additive retrospective agent, no
API break).
**Job:** `ralph-orchestration-followup-task-gatherer`
**Plan worktree:** `D:/harness-efforts/codexu/.ralph/jobs/ralph-orchestration-followup-task-gatherer/worktree/plan`
**Plan branch:** `ralph/plan-ralph-orchestration-followup-task-gatherer`

---

## 1. Motivation

After every impl ship the bookkeeper manually scans the iteration artifacts
for "are there follow-up tasks worth tracking?" That manual scan is
high-leverage but easy to forget. Three concrete misses observed in the
2026-05-27 session are quoted in the overview task entry
(`ralph-overview` watcher two-statement-preamble limitation; 3 pre-existing
Windows test-isolation failures; cross-platform smoke for v5.45.1's
`shell:true` fix).

Automating it via a Phase 5.5 retrospective agent — sibling to the existing
`dsat-analyst` and `skill-suggester` — ensures every ship surfaces its loose
ends as a structured, bookkeeper-reviewable artifact.

---

## 2. Where Phase 5.5 fits

Phase 5.5 is **post-impl, post-review-fix, pre-terminal-Phase-6**. It runs
after Phase 5a (code review-fix convergence) and Phase 5b (docs review-fix
convergence) have both reached `clean` (or hit the soft-cap plateau).

Today it spawns two retrospective agents in parallel: `dsat-analyst` and
`skill-suggester`. Both are read-only retrospectives that write one
deliverable each into `<job_dir>/` and never gate `terminalReason`. They
share the same skip condition: if `has_prd_worthy` is true (set by 5a),
the whole of Phase 5.5 is skipped because the next Phase 6 exit will emit
`terminalReason = "replan"` and retrospective analysis is premature.

**Integration:** `followup-task-gatherer` joins that same parallel batch as
a **third** read-only agent. It does NOT gate Phase 6. It honors the same
skip condition (`has_prd_worthy` → skip). Wall time should not extend
materially because the three agents run concurrently in a single assistant
message (Ralph's parallel-Agent contract).

```
Phase 5b clean ──▶ Phase 5.5 (parallel: dsat-analyst + skill-suggester + followup-task-gatherer) ──▶ Phase 6 terminal-complete
                            │
                            └── skip if has_prd_worthy → Phase 6 → terminalReason="replan"
```

---

## 3. Input signal sources

The agent reads only the following artifacts (graceful skip when absent —
mirror the resilience pattern in `dsat-analyst.md` lines 28–35).

### 3.1 Single-job inputs (from `<job_dir>/`)

| Source | Signal extracted | Notes |
|---|---|---|
| `code-review-findings.json` | `findings[]` with `status == "wont_fix"` | Each becomes a candidate follow-up — the reviewer explicitly flagged it as out-of-scope-for-this-impl. Use `relevantFiles` and `suggestedFix` to populate the suggestion body. |
| `code-review-findings.json` | `findings[]` with `status == "open"` AND the review log shows a soft-cap / plateau exit | Open findings that survived all convergence rounds — the impl could not converge on a fix in-scope. |
| `docs-review-findings.json` | Same `wont_fix` + plateau-`open` signals as above | Phase 5b emits no `prd-worthy`; wont_fix is the only way to defer docs work. |
| `notepad.md` `## Deferred Questions` table | Rows where the question was auto-resolved by the orchestrator without operator input | High-signal — the orchestrator made a judgment call. Worth tracking even when the impl succeeded. |
| `notepad.md` `## Open Questions` section | Any unanswered question still present at terminal | Almost always a follow-up candidate. |
| `notepad.md` `## Story Doctor Log` | Stories with intervention type `SKIP` | A SKIP is explicit "do this in a future task" signal. Always becomes a suggestion. |
| `progress.txt` `## Orchestrator Notes` | Lines that describe deferred / future / out-of-scope work | Pattern-match liberally; the agent's prompt enumerates trigger phrases. |
| `prd.json` stories | `status == "skipped"` with Story Doctor metadata | Same signal as the notepad SKIP rows; cross-check for consistency. |
| `git diff <baseBranch>...HEAD --name-only` | High-level file inventory | Used only as context for the agent's rationale (which areas changed → which surface is "warm" for follow-ups). |
| `git log <baseBranch>..HEAD --format=%H%n%B` | Commit trailers (`Constraint:`, `Rejected:`, `Not-tested:`) | `Not-tested:` trailers are direct follow-up candidates ("add the test"); `Rejected:` trailers may indicate deferred alternatives worth revisiting. |

### 3.2 Sources explicitly NOT consumed

- `dsat-report.md` and `skill-suggestions.md` — sibling retrospectives.
  Inheriting their conclusions would couple this agent to siblings that
  run in parallel and may not exist yet. The skill-suggester pattern
  explicitly forbids reading dsat-report.md (line 30 of `skill-suggester.md`);
  follow this same separation.
- `refactoring-agent` output — refactoring runs during impl, not Phase 5.5.
  Its work is already in the diff.

### 3.3 Group mode

When `group.json` exists in the job/group directory, aggregate the
single-job sources across all member jobs. Each member job has its own
`code-review-findings.json`, `docs-review-findings.json`, `notepad.md`,
`progress.txt`, and `prd.json`. The agent walks `group.json.members[]`
to discover them. Suggestions tag their `sourceFinding.reference` with
the member job slug so the bookkeeper can trace it back.

---

## 4. Output schema

The agent writes **two** sibling artifacts, mirroring `skill-suggester`'s
markdown + JSON convention (see `skill-suggester.md` lines 60–63 for the
existing precedent).

### 4.1 `<job_dir>/followup-suggestions.json` (machine-readable)

Wrap the array in an object — same shape as
`skill-suggestions.json` (`{ "candidates": [...] }`):

```json
{
  "generatedAt": "2026-05-30T...",
  "jobSlug": "<job-slug-or-group-slug>",
  "mode": "single" | "group",
  "suggestions": [
    {
      "id": "kebab-case-suggested-task-id",
      "scope": "ralph | crews | ralph-overview | codexu | codex | happy-app | happy-server | happy-cli | other",
      "lifecycle": "tracked",
      "rationale": "1-3 sentence why this is worth tracking",
      "sourceFinding": {
        "type": "wont_fix_finding | plateau_open_finding | deferred_question | open_question | story_doctor_skip | orchestrator_note | not_tested_trailer | rejected_trailer",
        "reference": "F-002 (code-review-findings.json) | notepad.md ## Open Questions:3 | prd.json stories[4].status==skipped | commit abc1234 trailer Not-tested",
        "memberJobSlug": "<slug or null>",
        "excerpt": "verbatim quote of the source (truncate to 500 chars max)"
      },
      "suggestedPrompts": {
        "brainstorm": "string or null",
        "plan": "string or null"
      },
      "recommendedPhase": "brainstorm | plan",
      "estimatedSize": "S | M | L",
      "dependencies": ["other-task-id", "..."]
    }
  ]
}
```

**Schema rules.** Every suggestion MUST have: `id`, `scope`, `lifecycle`,
`rationale`, `sourceFinding`, `recommendedPhase`. At least one of
`suggestedPrompts.brainstorm` / `suggestedPrompts.plan` MUST be non-null;
which one is populated is driven by `recommendedPhase`. `estimatedSize`
and `dependencies` are advisory; missing means "unknown".

**Empty-result contract.** When zero candidates are found, the file is
still written with `"suggestions": []`. Mirror skill-suggester's empty
contract (`skill-suggester.md` lines 64–80).

### 4.2 `<job_dir>/followup-suggestions.md` (human-readable)

```markdown
# Follow-up Task Suggestions

## Candidate: <suggested-id>
- Scope: <scope>
- Recommended phase: <brainstorm | plan>
- Estimated size: <S | M | L>
- Rationale: <prose>
- Source: <type> — <reference> (member: <slug or n/a>)
  > <excerpt>
- Suggested prompt (<phase>):
  ```
  <prompt body>
  ```
```

Empty-result body: a single line `No follow-up task candidates identified for this job.` with trailing newline.

### 4.3 Schema file: `schemas/followup-suggestions-schema.json`

Add a JSON Schema (draft-07) under `plugins/ralph/schemas/` mirroring the
two-file pattern of the other schemas (group, prd, review-findings). Used
by the Phase 5.5 step to validate the agent output before counting it.

### 4.4 Why structured JSON suggestions, NOT a `.ralph-overview/data.json` patch hunk

Two options were considered: emit a structured `followup-suggestions.json`,
OR emit a JSON-patch / unified-diff hunk that the bookkeeper applies to
`.ralph-overview/data.json` directly. Choosing structured suggestions:

1. **Hand-curated invariant** (codexu `AGENTS.md` / CLAUDE.md): the lead
   explicitly hand-curates `.ralph-overview/data.json`. Auto-generated
   patches would erode this — the lead's job IS the judgment call.
2. **Cross-consumer portability.** `ralph` is a generic plugin; not every
   consumer has a `.ralph-overview/data.json`. Other consumers (e.g.,
   non-codexu installs) want a structured artifact they can route to their
   own backlog tool. Patch-hunks lock in codexu's schema.
3. **Schema drift.** `.ralph-overview/data.json`'s task shape evolves
   (e.g., the recent `lifecycle` field addition, the in-flight
   `overview-data-dynamic-stages-schema` work). Suggestions surviving as
   structured intent is more robust to that drift than syntactic patches.

The bookkeeper's path to incorporation: read `followup-suggestions.md`
in review-mail, decide which to track, hand-edit `.ralph-overview/data.json`
with chosen suggestions. A future MCP tool
(`overview.suggest_followups({jobId})`) — explicitly out of scope for
v1 — could automate the transcription with operator confirm.

---

## 5. Agent definition: `agents/followup-task-gatherer.md`

Drop-in sibling to `agents/dsat-analyst.md` and `agents/skill-suggester.md`.
Structure follows skill-suggester (the closer behavioral parallel):

- Front-matter: `name: followup-task-gatherer`,
  `description: Post-job retrospective that surfaces NEW follow-up task
  candidates from a Ralph job's wont_fix findings, deferred questions,
  open questions, Story Doctor SKIPs, and not-tested commit trailers.
  Output is advisory only.`, `model: opus`.
- Inputs section: job/group dir + working dir (for `git log` / `git diff`).
- Existing-task de-dup paragraph: best-effort read of
  `<work_dir>/.ralph-overview/data.json` IF present (graceful skip on
  any read or parse error — many consumers will not have this file).
  Suppress candidates whose proposed `id` already appears as a tracked
  or merged task. Mention the de-dup in the suggestion's rationale when
  a near-miss was suppressed.
- Signal heuristics: enumerate the eight `sourceFinding.type` values
  from §4.1.
- Output contract: persist `followup-suggestions.json` and
  `followup-suggestions.md` to `<job_dir>` before returning; final
  message returns only paths + 1–2 sentence summary.
- Constraints: read-only on plugin files; no writes outside `<job_dir>`
  (or `<group_dir>` in group mode); MUST NOT modify
  `.ralph-overview/data.json` (call this out explicitly because the
  agent reads it for de-dup).
- Plugin version line at the top of the markdown output, mirroring
  `dsat-analyst.md` lines 42–46 — read `<pluginRoot>/.claude-plugin/plugin.json`
  `version` field.

---

## 6. Skill integration: `skills/implement-with-ralph/SKILL.md` Phase 5.5

Two edit points (single-job mode + group mode), mirroring the existing
parallel-batch shape (lines 1208–1245 of the current SKILL.md):

### 6.1 Single-job mode (around line 1211)

Change the parallel-batch from 2 → 3 Agent calls in the same assistant
message:

```
Agent(subagent_type="dsat-analyst", prompt="...")
Agent(subagent_type="skill-suggester", prompt="...")
Agent(subagent_type="followup-task-gatherer",
      prompt="Job directory: <job_dir>\nPlugin root: <pluginRoot>\nWorking directory: <work_dir>")
```

After the parallel batch, add a new step (sibling to the existing
skill-suggester count append):

```
followup_count = jq '.suggestions | length' <job_dir>/followup-suggestions.json
Append to <job_dir>/notepad.md under "## Working Notes":
  Phase 5.5 - Follow-up suggestions: <N> candidate(s). See <job_dir>/followup-suggestions.md.
```

Same non-idempotent-append rationale documented for skill-suggester
(line 1224) applies — Phase 5.5 may run multiple times across
`--run-only` resumes; each run's count is a useful timeline entry.

### 6.2 Group mode (around line 1230)

Symmetric change: add `followup-task-gatherer` to the parallel-batch
with `Mode: group\nJob directory: <group_dir>\n...`. Add the same
count-append to `<group_dir>/notepad.md`.

### 6.3 Dashboard step (around line 1248)

Extend the "DSAT summary counts in the Review Status section" to also
include the follow-up suggestion count. Single-line change.

### 6.4 No new state-machine writes

`followup-task-gatherer` does not gate any phase transition, does not
write `orchestrator.review.*`, does not influence `terminalReason`. The
existing Phase 5.5 Entry/Exit writes (Step 0) and Phase 6 advisory
append are untouched.

---

## 7. Bookkeeper integration

No code changes outside the plugin. The bookkeeper workflow
absorbs the new artifact via two existing channels:

1. **Notepad pointer.** Phase 5.5 now appends a `Phase 5.5 - Follow-up
   suggestions: <N> candidate(s). See <path>.` line. The bookkeeper
   already reads notepad.md when reviewing a `kind=done` member ship
   — the new line shows up there automatically.
2. **Dashboard count.** The Review Status section of `<job_dir>/dashboard.md`
   gains a follow-up count alongside the existing DSAT counts, making
   the signal visible in the dashboard view without opening the JSON.

Bookkeeper's manual flow on ship:
- Read `<job_dir>/followup-suggestions.md`.
- For each candidate: decide track / discard / merge-into-existing.
- For tracked candidates: hand-add an entry to `.ralph-overview/data.json`
  using the suggestion's `id`, `scope`, `lifecycle: "tracked"`,
  `command.prompts.<recommendedPhase>` populated from
  `suggestedPrompts.<recommendedPhase>`.
- Bundle bookkeeping into the same
  `chore(overview): update data for shipped tasks` commit the lead
  already makes per the AGENTS.md operating manual.

No documentation change required in codexu's `AGENTS.md` for v1 — the
bookkeeper flow already includes "scan iteration artifacts for
follow-ups" as an implicit step. A note may be added in a future codexu
documentation pass, but it is out of scope for this plan.

---

## 8. Tests

The existing `dsat-analyst.md` and `skill-suggester.md` agents ship
with no Node unit tests (they are LLM-driven). Tests for this agent
follow the same precedent but the JSON output gives us cheap deterministic
hooks:

### 8.1 Schema validation test — `tests/test-followup-suggestions-schema.mjs`

Node `--test` runner test (matches the `test-*.mjs` glob in
`tests/run.mjs`). Loads each fixture's expected
`followup-suggestions.json` and validates it against
`schemas/followup-suggestions-schema.json` via `ajv`. Fails fast on any
schema violation. Covers the empty-result contract too.

### 8.2 Fixtures under `tests/fixtures/followup-task-gatherer/`

| Fixture | Inputs | Expected outcome |
|---|---|---|
| `empty/` | `code-review-findings.json` and `docs-review-findings.json` with no `wont_fix` rows, notepad.md with no Open Questions, prd.json with no skipped stories. | `suggestions: []`, empty-result markdown body. |
| `wont-fix-only/` | One `wont_fix` finding (F-002) in `docs-review-findings.json`. | One suggestion with `sourceFinding.type == "wont_fix_finding"` and `sourceFinding.reference` containing `F-002`. |
| `open-question/` | notepad.md with an unanswered `## Open Questions` entry. | One suggestion with `sourceFinding.type == "open_question"`. |
| `story-doctor-skip/` | prd.json with one skipped story + Story Doctor Log row. | One suggestion with `sourceFinding.type == "story_doctor_skip"`. |
| `group-mode/` | `group.json` plus two member-job subdirs each with one `wont_fix`. | Two suggestions, each tagged with the originating member-job slug in `memberJobSlug`. |

Each fixture has both the raw inputs AND the expected
`followup-suggestions.json` to round-trip through schema validation.

### 8.3 Integration smoke (manual)

Spawn a small real impl job (e.g., a 1-story trivial change) end-to-end
with `--autonomous`, confirm Phase 5.5 emits all THREE artifacts
(`dsat-report.md`, `skill-suggestions.md`, `followup-suggestions.md`)
and that the wall time delta vs the v5.46.3 baseline is ≤ 2 minutes
(the new agent runs in parallel; should not extend the critical path).
Documented as a manual one-time verification, NOT a regression-gated
test, because real LLM agent runs are non-deterministic.

### 8.4 No e2e regression-smoke.sh change required

`tests/run-regression-smoke.sh` and its phased fixtures (regression-smoke,
regression-smoke-phase-{2,3,4}) test the orchestrator state machine, not
LLM agent outputs. They do not invoke real subagents. The new agent
inherits the same exemption pattern as dsat-analyst and skill-suggester
(neither appears in the smoke harness).

---

## 9. Suggested Decomposition (stories outline)

Sized for `/implement-with-ralph` — see also
`suggested-decomposition.json` sibling artifact in this same job dir.

| Story | Title | Surface | Approx LOC |
|---|---|---|---|
| S1 | Add `schemas/followup-suggestions-schema.json` + JSON Schema unit test | `plugins/ralph/schemas/`, `plugins/ralph/tests/test-followup-suggestions-schema.mjs` | ~150 |
| S2 | Add `agents/followup-task-gatherer.md` agent definition | `plugins/ralph/agents/followup-task-gatherer.md` | ~180 |
| S3 | Wire Phase 5.5 single-job + group-mode parallel batch in `implement-with-ralph` SKILL.md, including notepad and dashboard count-append edits | `plugins/ralph/skills/implement-with-ralph/SKILL.md` (2 sections) | ~60 |
| S4 | Add 5 fixtures under `tests/fixtures/followup-task-gatherer/` (empty, wont-fix-only, open-question, story-doctor-skip, group-mode) | `plugins/ralph/tests/fixtures/followup-task-gatherer/**` | ~250 |
| S5 | Version bump + CHANGELOG entry — `plugin.json` and `package.json` → v5.47.0; CHANGELOG.md narrative entry | `plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.copilot-plugin/plugin.json` (if symlinked, both), `plugins/ralph/package.json`, `plugins/ralph/CHANGELOG.md` | ~40 |

Stories S1, S2, S4 are file-disjoint and can run in parallel. S3
depends on S2 (references the agent name). S5 depends on S1–S4 landing
(version bump captures the full feature). Total: ~680 LOC, well within
a single autonomous run.

Suggested order: `[S1, S2, S4] (parallel) → S3 → S5`.

---

## 10. Acceptance criteria

Lifted from the overview task entry's AC-1..AC-7 with two clarifications:

- **AC-1.** After Phase 5.5 retrospective on a test impl run,
  `<job_dir>/followup-suggestions.json` exists and validates against
  `schemas/followup-suggestions-schema.json`.
- **AC-2.** When the impl has zero `wont_fix`/plateau-`open` findings,
  zero notepad Open Questions, zero Story Doctor SKIPs, and zero
  `Not-tested:` trailers, `suggestions[]` is empty (no false
  positives) and the markdown body is the documented empty-result
  string with trailing newline.
- **AC-3.** When the impl has a Phase 5b `wont_fix` finding (sample
  fixture), `suggestions[]` contains at least one entry with
  `sourceFinding.type == "wont_fix_finding"` and `sourceFinding.reference`
  containing the finding ID.
- **AC-4.** When notepad.md `## Open Questions` contains an unanswered
  question, it appears as a suggestion with `sourceFinding.type == "open_question"`.
- **AC-5.** dsat-analyst + skill-suggester continue to run unchanged
  (regression check — verified by inspecting Phase 5.5 SKILL.md diff
  and confirming the existing two `Agent(...)` calls are byte-identical
  except for the added third call).
- **AC-6.** Phase 5.5 wall time delta vs v5.46.3 baseline is ≤ 2 minutes
  on a small representative impl job (the third agent runs in parallel;
  this is asserted by the manual smoke in §8.3, NOT a unit test).
- **AC-7.** `followup-suggestions.json` and `followup-suggestions.md` are
  TRACKED (not gitignored) at the `.ralph/jobs/` level — history is
  useful and the files are small. This matches today's tracking of
  `dsat-report.md` and `skill-suggestions.md`. Verify `.gitignore`
  in both `plugins/ralph/` and the consumer repo do not exclude them.

Plus two additional ACs the plan adds:

- **AC-8 (de-dup).** When `.ralph-overview/data.json` exists in
  `<work_dir>` and contains a task whose `id` matches a candidate's
  proposed `id`, that candidate is suppressed AND a `noteOnSuppression`
  field is added to a sibling `followup-suggestions-suppressed.json`
  for operator audit. (Optional — implement only if it falls out
  trivially from the agent's prompt; advisory if it adds complexity.)
- **AC-9 (skip when has_prd_worthy).** When Phase 5.5 is skipped
  because `has_prd_worthy == true`, no `followup-suggestions.*`
  artifacts are written. Matches the existing skip semantics for
  dsat-analyst and skill-suggester.

---

## 11. Open questions for the implementer / lead

1. **Suggestion `id` collision policy** (AC-8). De-dup against
   `.ralph-overview/data.json` is sketched as advisory. If the
   implementer finds it adds non-trivial complexity, drop AC-8 and
   document the omission — the bookkeeper review step catches
   duplicates manually anyway.
2. **Plateau-`open` detection.** The plan calls for distinguishing
   `wont_fix` (explicit defer) from `open` AT plateau exit (implicit
   defer). Detecting "plateau exit" requires reading the review-log
   or counting convergence rounds — see `<job_dir>/review-log.json`
   and `<job_dir>/code-review-findings.json.reviewCycle`. If the agent
   prompt cannot reliably distinguish these in opus's context window,
   the safer fallback is "report all `wont_fix` only, document
   plateau-open as a known v2 enhancement".
3. **Suggested-prompt quality.** `suggestedPrompts.plan` / `.brainstorm`
   are LLM-generated. They are advisory only — the bookkeeper will
   rewrite them. Don't over-invest in prompt-quality heuristics; a
   one-sentence stub is fine for v1.

---

## 12. Out of scope

- MCP tool `overview.suggest_followups({jobId})` for operator-confirm
  bulk-add into `.ralph-overview/data.json`. v2 enhancement.
- Auto-writing into `.ralph-overview/data.json`. Explicitly preserved
  invariant.
- Cross-job aggregation (e.g., "this is the 3rd time test-isolation
  follow-ups have been suggested"). v2.
- Re-enabling Phase 5c security review (separate plan; orthogonal).
- Hooking the new artifact into the `ralph-overview` viewer
  (`tools/overview-viewer/`). The viewer reads the watcher-generated
  snapshot; surfacing follow-up counts there is a follow-up
  follow-up. v2.

---

## 13. Reference artifacts

- Sibling agents: `plugins/ralph/agents/dsat-analyst.md`,
  `plugins/ralph/agents/skill-suggester.md`.
- Phase 5.5 wire-up: `plugins/ralph/skills/implement-with-ralph/SKILL.md`
  lines 1201–1250.
- Findings schema: `plugins/ralph/schemas/review-findings-schema.json`.
- Overview task entry that requested this work:
  `.ralph-overview/data.json` task id
  `ralph-orchestration-followup-task-gatherer` (lines 1364–1383 at the
  time of planning).
- Plugin version at plan time: `v5.46.3`. Target: `v5.47.0` (minor bump).
