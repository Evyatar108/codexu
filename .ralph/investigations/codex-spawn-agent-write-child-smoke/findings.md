# Smoke: codex `spawn_agent` write-child (D-002 go/no-go)

**Task:** `codex-member-skill-agent-subagent-fanout` (D-002 gate)
**Date:** 2026-06-09
**Engine:** codex-cli `0.135.0-copilot-api.1`
**Author:** crews member `spike-spawnagent-smoke` (ralph-pipeline)

## VERDICT: **GO** — all 5 capabilities pass

A codex `spawn_agent` child (multi_agent_v2) CAN serve as a write/review subagent
for ralph. A single `codex exec` top-level agent spawned a write-child that edited
a file, committed it, and the commit + edit were parent-visible after the child
exited, with the child's structured `<review-meta>` output recovered back to the
parent. D-002 (native-first / codex-purity write-children) is **feasible as-is**.

## The 5 capabilities — pass/fail with evidence

| # | Capability | Result | Evidence |
|---|---|---|---|
| 1 | Child runs with WRITE access to the work_dir | PASS | child edited `target.txt` in the scratch repo cwd |
| 2 | Child makes a file EDIT | PASS | `target.txt | 3 ++- · 1 file changed, 2 insertions(+), 1 deletion(-)` |
| 3 | Child COMMITs it (git commit in the worktree) | PASS | commit `00a4983b6f13807e65a78cf818ad7f7719368860` |
| 4 | Edit + commit PARENT-VISIBLE after child exits | PASS | parent's OWN read-only `git log`/`git show` after child done shows `00a4983`; lead-side independent re-inspection confirms |
| 5 | Child emits PARSEABLE output recovered by parent | PASS | parent recovered the verbatim `<review-meta>{...}</review-meta>` via `list_agents` → final answer + `-o` last-message file |

### Commit SHA (the child's write)

```
00a4983b6f13807e65a78cf818ad7f7719368860  child write smoke: EDITED_BY_SPAWN_AGENT_CHILD_7Q2X
ccb1eea...                                 initial scratch commit (parent baseline)
```

### Parsed child output (capability 5), recovered by the parent

```
<review-meta>{"wrote_file": true, "committed": true, "commit_sha": "00a4983b6f13807e65a78cf818ad7f7719368860", "child_id": "write_child"}</review-meta>
```

### `target.txt` after the run (lead-side independent inspection — NOT agent self-report)

```
ORIGINAL CONTENT - line to be edited by the child
EDITED_BY_SPAWN_AGENT_CHILD_7Q2X
```

## Smoke mechanics

- **Scratch repo (isolated):** a fresh `git init` repo in `%TEMP%\spawn-agent-smoke`
  with a baseline commit `ccb1eea` containing `target.txt` (sentinel `ORIGINAL
  CONTENT`) and `README.md`. Fully separate from the codexu tree so nothing
  confounds the evidence.
- **Invocation:** `codex exec -C <scratch> --json -c features.multi_agent_v2=true
  --dangerously-bypass-approvals-and-sandbox -o last-message.txt <prompt>`.
  `CODEX_EXEC_TIMEOUT_MS=1200000` (User-level) confirmed; the wall-clock run was
  ~2m19s (10:02:56 → 10:05:15), well under the timeout. Git Bash put first on PATH.
- **Prompt design (forces the write-child path, rules out parent doing the write):**
  the top-level agent was told it MUST delegate, must NOT edit files or create
  commits itself, and its only job is delegate → `wait_agent` → `list_agents` →
  report. Only read-only `git log`/`git show` were permitted to the parent. So the
  appearance of commit `00a4983` proves the *child* performed the write+commit.
- **Transcript:** full JSONL event log at
  `codex-exec-transcript.jsonl` (this dir); prompt at `smoke-prompt.txt`.

### Transcript trace (key events)

1. `spawn_agent` `tool` call, `task_name: write_child`, child thread
   `019ead56-dd0b-...` created (parent thread `019ead56-718d-...`).
2. parent `wait` tool call → child completes.
3. parent runs read-only `git log --oneline -5` →
   `00a4983 child write smoke: EDITED_BY_SPAWN_AGENT_CHILD_7Q2X` on top of baseline.
4. parent runs `git show --stat HEAD` → commit `00a4983...`, `target.txt` changed.
5. parent final answer carries the child's verbatim `<review-meta>` block.
6. `turn.completed`, exit code 0.

## Why this works (architecture) — for the D-002 plan

codex multi_agent_v2 children are **in-process sub-conversation threads sharing the
parent's working directory / host filesystem** — there is NO separate sandboxed or
container workspace per child. That is precisely why the child's write+commit are
parent-visible immediately with zero merge/IPC/worktree-sync step. The v2
spawn_agent tool description states the child "will have the same tools as you" and
"its final answer will be provided to you when it finishes"
(`codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:717-722`),
and the coding-delegation guidance tells the child to "edit files directly in its
forked workspace and list the file paths it changed in the final answer"
(`multi_agents_spec.rs:681`). Under `--dangerously-bypass-approvals-and-sandbox` the
child inherits the parent's full write+exec tool surface (the child config is built
from the parent turn in `spawn.rs:92-120`).

**D-002 design implication (not a blocker):** because all children share ONE working
tree, concurrent write-children must have **disjoint write sets** — exactly what the
upstream tool description already advises (`multi_agents_spec.rs:682`: "decompose work
so each delegated task has a disjoint write set"). Sequential write-children (the
ralph code-fixer / docs-updater convergence sites are inherently sequential per
finding) are trivially safe.

## Schema-staleness side finding: **CONFIRMED at source**

The shipped read-lens recipe emits `spawn_agent` WITHOUT the required `message`
field:

- Recipe (`ai-developer-toolkit/plugins/ralph/scripts/codex-lowering.mjs:287-296`)
  emits `spawn_agent { task_name: <type>, fork_turns: "none" }` and defers the task
  prompt to a separate `followup_task` step.
- Source (`codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:251-262`):
  `struct SpawnAgentArgs` has `message: String` (required, line 254) and
  `task_name: String` (required, line 255) under `#[serde(deny_unknown_fields)]`
  (line 252). The handler treats `message` as the child's initial task —
  `parse_collab_input(Some(args.message), None)` at `spawn.rs:73`. The v2 schema
  exposes `message` as a property (`multi_agents_spec.rs:586-589`).

So a literal emission of the recipe's `spawn_agent { task_name, fork_turns }` (no
`message`) is **schema-invalid** — serde would reject it with a missing-`message`
error; the recipe relies on the model improvising a `message` from the tool schema.
The working pattern (validated by THIS smoke) is to pass `message` (the child's
task) directly on `spawn_agent`. **Recommendation:** fix the lowering recipe to put
the subagent prompt in `spawn_agent.message`, OR file a follow-up bug. (Already
captured in the brainstorm's Criteria as a required fix / follow-up.)

## Scope caveats (what this smoke does and does NOT prove)

- DOES prove the load-bearing D-002 primitives: write + commit + parent-visibility +
  parseable-output recovery, on the live `0.135.0-copilot-api.1` engine.
- Does NOT prove reviewer FIDELITY (e.g. a real `<review-meta>` produced from an
  actual code review of a large diff, or a multi-round 5a/5b convergence loop). That
  belongs to the D-002 plan + a real codex-member `/implement-with-ralph` dogfood,
  not this cheap gate.
- Subagents cannot spawn grandchildren in this fork (SANDBOX PATCH gate at
  `spawn.rs:57-63`); single-level fan-out only. Not a constraint for the
  code-fixer/docs-updater/reviewer sites (all single-level).
- Default copilot model + trivial single-file edit were used deliberately to isolate
  the capability question.

## Recommendation

**Proceed to a D-002 plan.** The native `spawn_agent` write-child is proven viable on
the current engine; the cheap gate that XL-effort D-002 was blocked on is now GREEN.
No need to fall back to D-001 (hybrid copilot-exec) or D-004 (manual+hardened
evidence) on feasibility grounds. The D-002 plan must still (a) fix the schema-stale
recipe to pass `message`, (b) encode the shared-working-tree disjoint-write-set rule
for any parallel write-children, and (c) gate ship on a real codex-member full
`/implement-with-ralph` dogfood proving reviewer fidelity end to end.
