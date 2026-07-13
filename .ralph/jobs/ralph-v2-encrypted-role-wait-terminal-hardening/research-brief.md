# Ralph V2 Role/Wait/Terminal Hardening Research Brief

## Researcher Findings

# Phase-2 Research Brief: Ralph V2 Encrypted Role/Wait/Terminal Hardening

## Research metadata

- **Planning target:** Ralph `5.64.0` release candidate in
  `D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\publish-ralph-564`
- **Candidate branch/commit:** `release/ralph-564-publish` at `4100a48d`,
  including launch-evidence commit `48e63c0c`
- **Implementation repository:** `ai-developer-toolkit`
- **UI/UX judgment:** `not-required`
- **Runtime prerequisite:** overview task
  `codex-v2-copilot-encrypted-subagent-handoff` in the separate `codex`
  submodule/repository
- **Evidence root (read-only):**
  `D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\dogfood`

## 1. Executive conclusion

The failed installed-host run exposed two independent defects:

1. **Codex runtime defect (prerequisite):** V2 children received encrypted
   handoff content that they did not execute, completed with no final assistant
   message, and did not provide a usable completion notification to the later
   targetless wait. That native handoff/completion defect belongs to
   `codex-v2-copilot-encrypted-subagent-handoff`; it must not be worked around
   in Ralph.
2. **Ralph fail-open defect (this plan):** generated V2 recipes wait before
   inspecting `list_agents`, the installed telemetry derives roles from the
   encrypted `arguments.message`, terminal evidence does not reject a null
   final message, and the parent can replace failed delegated work inline and
   still exit `0`.

The Ralph correction is independently implementable and hermetically testable
before the Codex release. It should change V2 to:

`spawn_agent -> list_agents -> (only if waitable: targetless wait_agent -> list_agents) -> validate non-empty completed result + required artifacts`

It must fail the whole required delegation on null/blank completion, terminal
failure, timeout with a still-nonterminal child, missing/duplicate identity,
missing output artifact, malformed output, or wrong route/cardinality. It must
never authorize a parent-authored substitute. V1 remains the existing
`agent_id -> targeted wait -> status[id].completed -> close` flow.

Final installed-host acceptance is blocked until the prerequisite Codex build
is released and installed. A successful Ralph source test or an installed
Codex parent exit code of `0` is not final evidence.

## 2. Installed-host evidence and reconstructed failure

### 2.1 The candidate and launch were real

`installed-skill-dogfood-summary.json` records:

- installed Copilot and Codex manifests at `5.64.0`;
- Codex provenance from the installed marketplace cache;
- failure case `codex-quick-plan-sol-xhigh`; and
- exact error:
  `expected=plan_drafter,plan_initial_review,plan_researcher,plan_review_synthesis actual=`.

`codex-plan.command.json` proves the controlled invocation was not using the
hidden-metadata shorthand. Its ordered argv contains one intact pair:

```text
-c
features.multi_agent_v2={enabled=true,hide_spawn_agent_metadata=false}
```

The process nevertheless exited `0`. Therefore launch/schema exposure was not
the failure and exit zero was a false-success signal.

### 2.2 The parent violated required delegation

`codex-plan.jsonl` shows this sequence:

1. The parent spawned `/root/plan_researcher`, then immediately entered a
   targetless wait. Only after the full wait did it inspect state.
2. It wrote a local research-failure brief and continued:
   `"Because quick mode has no architect or external research lanes, I can
   proceed with an explicit research-failure brief."`
3. It spawned `/root/plan_drafter`, again waited before state inspection, and
   received no artifacts.
4. It explicitly switched to inline fallback:
   `"The normal artifact-producing children did not complete, so I'm
   switching to a conservative local completion path..."`
5. It locally wrote the draft plan, decomposition, primary review, review
   synthesis, findings manifest, finalized artifacts, and a plan commit.

The resulting probe artifacts confirm the substitution:

- `research-brief.md`: `plan_researcher timed out`
- `plan.md`: says the plan relies on local inspection after both researcher
  and drafter timeouts
- `primary-plan-review.md`: passes that locally produced plan
- `plan-review.md`: locally records consensus and no amendments

Neither required `plan_initial_review` nor `plan_review_synthesis` was spawned.
This is why the exact-four telemetry gate correctly failed even though the
parent returned success.

### 2.3 Why the role list was empty

The current PowerShell in `plugins/ralph/docs/model-routing-dogfood.md` sets
every request's `Role` by regexing:

```powershell
[regex]::Match([string]$arguments.message,
  '(?m)^RALPH_DISPATCH_ROLE=([a-z0-9_]+)\s*$')
```

V2 task content can be encrypted, so this is not a stable V2 telemetry field.
The request already has plaintext `arguments.task_name`; spawn output has
plaintext `output.task_name`; and the child session metadata has plaintext
`thread_spawn.agent_path`. Those three structural fields form the required V2
identity chain. V1 has no required `task_name`, so its existing plaintext
message marker can remain V1-only.

## 3. Verified Codex runtime contracts

These are reference contracts, not files for this Ralph implementation to
edit.

### 3.1 Spawn identity

From the Codex wrapper repository:

- `external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
  requires `SpawnAgentArgs.task_name`, creates a canonical `AgentPath`, and
  returns that path in `SpawnAgentResult.task_name`.
- The request role is the normalized leaf (`plan_researcher`); current output
  is canonical (`/root/plan_researcher`). The child rollout repeats the
  canonical path as
  `session_meta.payload.source.subagent.thread_spawn.agent_path`.

Ralph telemetry should require a bijection across those fields, not merely
accept whichever one happens to exist.

### 3.2 `list_agents` status and result

- `core/src/agent/control.rs` defines:
  `ListedAgent { agent_name, agent_status, last_task_message }`.
- `core/src/tools/handlers/multi_agents_v2/list_agents.rs` serializes the
  current list.
- `core/src/tools/handlers/multi_agents_spec.rs` declares `agent_name`,
  `agent_status`, and nullable `last_task_message` in the output schema.
- `protocol/src/protocol.rs` defines
  `AgentStatus::Completed(Option<String>)`.
- `core/src/agent/status.rs` maps `TurnComplete` to
  `AgentStatus::Completed(ev.last_agent_message.clone())`.

**Important distinction:** the final child answer is
`agent_status.completed`, originating from `last_agent_message`.
`last_task_message` is the most recent instruction sent *to* the child; it is
not the child result. `control.rs:last_task_message_from_communication`
intentionally returns `None` for encrypted communication. The corrected
recipe must continue to say **not** to use `last_task_message`, while explicitly
rejecting `agent_status.completed: null`, missing, or blank.

### 3.3 Targetless wait

`core/src/tools/handlers/multi_agents_v2/wait.rs` confirms:

- V2 accepts only optional `timeout_ms`;
- it waits for mailbox/steer activity, not a named child;
- its result contains only `{ message, timed_out }`, never the child answer;
- a timeout is logged as tool success; and
- completion content must be recovered separately through `list_agents`.

Therefore a targetless wait is only a blocking hint. It cannot be the source of
truth. State must be listed before waiting and listed again after every return,
including a timeout, to close the completion/timeout race.

## 4. Current Ralph behavior and exact correction

### 4.1 Authored lowering

In `plugins/ralph/scripts/codex-lowering.mjs`:

- `v2SingleDelegationSteps` currently emits
  `spawn -> wait -> list`.
- `v2FanoutSteps` currently emits all spawns, then
  `wait -> list`, and fails immediately on `timed_out`.
- `outputHandlingProse` describes contract validation, but the recipe does not
  make null completion and site-declared artifact absence explicit terminal
  failures.
- `singleDelegationRecipe`, `fanOutRecipe`, and
  `PROSE_SITE_INVENTORY` are the correct centralized seams. Do not patch seven
  generated skills independently.

Required V2 state machine:

1. Capture exactly one non-empty spawn identity per requested role.
2. Call `list_agents` before any targetless wait.
3. Match exactly one `agent_name` to the canonical spawn `task_name`.
4. For `completed` with a non-empty string, recover that string and validate
   the role's output contract and every required artifact.
5. For `pending_init` or `running`, call targetless `wait_agent`, then always
   list again. If the wait timed out but the post-wait list is now valid
   completed state, accept the completed state; if it is still waitable, fail
   at the existing timeout boundary.
6. Fail closed for `completed: null`, blank completion, `errored`, `shutdown`,
   `not_found`, interrupted one-shot work, missing/duplicate list rows, malformed
   result, or missing artifacts.
7. A fan-out succeeds only when every expected role satisfies the above;
   partial results are never synthesized.
8. On any required-child failure, stop the surrounding workflow before writing
   a substitute output or success artifact.

Keep the existing 600000 ms boundary unless a separate requirement changes it.
The issue is ordering and state authority, not timeout duration.

### 4.2 V1 preservation

Do not route V1 through the new V2 state machine. Preserve:

- identity by returned `agent_id`;
- `multi_agent_v1.wait_agent { targets: [...] }`;
- final text from `status[agent_id].completed`;
- explicit `multi_agent_v1.close_agent`;
- no `list_agents`, `followup_task`, `send_input`, or `resume_agent`;
- current V1 role marker parsing where the plaintext message remains
  available; and
- the same exact model/effort and cardinality assertions.

V1 should also reject null/blank `completed` and missing required artifacts,
but its sequencing/tool surface must not change.

### 4.3 Telemetry correction

In the PowerShell contract embedded in
`plugins/ralph/docs/model-routing-dogfood.md`:

- branch role derivation by detected surface;
- V2 `Role` comes from plaintext `arguments.task_name`;
- V1 `Role` may continue to come from `RALPH_DISPATCH_ROLE` in
  `arguments.message`;
- V2 must require:
  `arguments.task_name` leaf == `output.task_name` leaf ==
  `thread_spawn.agent_path` leaf;
- each request/output/child must participate in exactly one match;
- require exactly one successful `task_complete` and a non-null/non-blank
  `payload.last_agent_message` for each child;
- retain requested and effective model/effort equality;
- retain exact quick-plan roles and exact-one fixer/updater cardinality; and
- assert required final artifacts exist before a case passes.

The fixture must use an opaque/encrypted V2 `message` that contains no readable
role marker. A valid V2 case must still pass. V1 fixtures should retain the
marker and continue to pass unchanged.

## 5. Repository-relative surface inventory

Paths in sections 5.1-5.5 are relative to the
`ai-developer-toolkit` repository root.

### 5.1 Authored modify surfaces

| Path | Required change |
|---|---|
| `plugins/ralph/scripts/codex-lowering.mjs` | Change V2 single/fan-out ordering and fail-closed terminal/artifact/no-fallback prose. If required artifact checks differ by site, extend recipe/site metadata rather than adding ad hoc generated text. Preserve V1 builders. |
| `plugins/ralph/docs/model-routing-dogfood.md` | Correct V2 role correlation, final-message checks, artifact checks, no-inline contract, prerequisite sequencing, and explicit installed V1/V2 gates. This is the canonical source for the external runner. |
| `plugins/ralph/AGENTS.md` | Replace the present-tense `wait globally, correlate completion` description with list-first bounded recovery and document V2 structural role identity/null rejection. Preserve the launch-evidence and route policy contracts. |
| `plugins/ralph/CHANGELOG.md` | Amend the still-unreleased `v5.64.0` notes with the correction and prerequisite/final gate. No matching 5.64 tag exists in the candidate checkout. |
| `.claude/skills/release-plugin/SKILL.md` | Release-orchestration surface: make the existing Ralph 5.64 installed-host Step 9 explicitly wait for the prerequisite Codex release and require both V1 and V2 gates. Do not tag or advance the parent pointer on only one surface. |

### 5.2 Test modify surfaces

| Path | Required coverage |
|---|---|
| `plugins/ralph/tests/test-codex-generator.mjs` | Replace the currently pinned `spawn -> wait -> list` order with `spawn -> list -> wait -> list`; assert null/blank/terminal/missing-artifact failure text, post-timeout relist, no parent substitute, and byte-preserved V1 shape. |
| `plugins/ralph/tests/test-codex-live-smoke.mjs` | Its current regex also pins `spawn -> wait -> list`; make the static smoke assert list-before-wait and post-wait relist. Keep real execution opt-in. |
| `plugins/ralph/tests/test-model-routing-telemetry.mjs` | Add encrypted/opaque V2 message fixtures, V2 role derivation from `task_name`/`agent_path`, null/missing/blank `last_agent_message`, missing artifact, duplicate/wrong structural identity, exact role/cardinality, and V1 preservation cases. |
| `plugins/ralph/tests/fixtures/regression-smoke-phase-4/post-migration-caller-surface.txt` | Rebaseline only if the active authored docs/prose line shifts change the deterministic caller-surface grep. Review the diff; do not accept unrelated drift. |

### 5.3 Generated outputs

Regenerate these; do not hand-edit them:

- `plugins/ralph/.codex-plugin/codex-skills/brainstorm-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/implement-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/multi-model-investigate/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/plan-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/analyze-iteration/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/review-changes/SKILL.md`

The generator is
`plugins/ralph/scripts/generate-copilot-artifacts.mjs`; its
`expectedCodexOutputs` function is a reference surface, not an expected edit.
This correction is Codex-specific. Do not churn the hand-maintained Copilot
`implement-with-ralph` copy unless a shared authored change genuinely changes
its behavior.

### 5.4 Reference and regression surfaces

- `plugins/ralph/src/model-routing-policy.mjs` — sole route source; preserve:
  - planning/research/review: `gpt-5.6-sol`, `xhigh`
  - implementation/fix/update/refactor: `gpt-5.6-sol`, `medium`
  - exploration: `gpt-5.6-luna`, `medium`
  - explicit UI: `claude-opus-4.8`, `high`
- `plugins/ralph/tests/fixtures/codex-multi-agent-schemas/0.141-v1.json`
- `plugins/ralph/tests/fixtures/codex-multi-agent-schemas/0.141-v2.json`
- `plugins/ralph/tests/fixtures/codex-multi-agent-schemas/0.141-v2-hidden.json`
- `plugins/ralph/tests/test-codex-launch-evidence.mjs` — rerun because the
  canonical guide changes; command evidence must remain intact.
- `plugins/ralph/tests/test-model-routing.mjs` — six-stamp and release-skill
  regression coverage.
- `plugins/ralph/tests/test-regression-smoke-phase-4.mjs` — owns the caller
  baseline comparison.
- `plugins/ralph/scripts/check-copilot-parity.mjs`
- `tools/validate-codex-marketplace-policy.mjs`

### 5.5 Release/version surfaces

The six stamps are already `5.64.0` and should remain unchanged for this
pre-tag correction:

- `.agents/plugins/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.github/plugin/marketplace.json`
- `plugins/ralph/.claude-plugin/plugin.json`
- `plugins/ralph/.codex-plugin/plugin.json`
- `plugins/ralph/.github/plugin/plugin.json`

Do not create a `5.64.1`/`5.65.0` bump merely to correct this unpublished
candidate unless the release owner explicitly changes the release decision.
Do not update codexu's submodule pointer or root active-plugin-version table
until the final installed-host gate and publication closeout.

### 5.6 Separate Codex repository reference surfaces

Relative to the `codex` wrapper repository:

- `external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
- `external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/list_agents.rs`
- `external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
- `external/repos/codex-patched/codex-rs/core/src/agent/control.rs`
- `external/repos/codex-patched/codex-rs/core/src/agent/status.rs`
- `external/repos/codex-patched/codex-rs/core/src/agent/control_tests.rs`
- `external/repos/codex-patched/codex-rs/protocol/src/protocol.rs`

These support the diagnosis. The Ralph implementation must not edit them.
The prerequisite task needs its own Codex/submodule worktree, patch-surface
registration, tests, release, and wrapper pointer closeout.

## 6. Acceptance criteria for the implementation plan

1. Every generated V2 delegation recipe lists before its first targetless wait,
   lists after every wait return, and uses list state—not wait output—as the
   completion authority.
2. Already-completed V2 children are consumed without entering a stale wait.
3. V2 result recovery reads non-empty `agent_status.completed`; it never treats
   `last_task_message` as output.
4. `completed: null`, missing/blank completion, terminal failure, duplicate or
   missing identity, and timeout with a still-waitable child fail the required
   delegation.
5. Every site-declared output artifact is validated before downstream phases;
   missing artifacts fail even when a child reports completed.
6. Failure stops the surrounding workflow. Generated text contains no branch
   permitting local research, draft, review, synthesis, fixer, or updater
   substitution, and a regression test pins this.
7. V2 telemetry derives the dispatch role solely from structural
   `task_name`/`agent_path` fields; an opaque encrypted `arguments.message`
   fixture passes when structural evidence is correct.
8. Quick plan requires exactly one each of:
   `plan_researcher`, `plan_drafter`, `plan_initial_review`,
   `plan_review_synthesis`.
9. Fixer/updater probes retain exact-one cardinality. All cases retain exact
   requested/effective model and effort checks.
10. V1's namespaced, targeted-wait, `agent_id`, completed-result, and close
    sequence is unchanged and covered by positive and fail-closed fixtures.
11. All seven Codex generated outputs are regenerated and `--check` is clean;
    Copilot parity and the full Ralph Node suite remain green.
12. The v5.64 release remains blocked until a released/installed Codex build
    satisfying `codex-v2-copilot-encrypted-subagent-handoff` passes the final
    installed V1 and V2 gates.

## 7. Existing validation commands

Run from the `ai-developer-toolkit` candidate worktree root.

### Generate and targeted tests

```powershell
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --write
node --test `
  plugins/ralph/tests/test-codex-generator.mjs `
  plugins/ralph/tests/test-codex-live-smoke.mjs `
  plugins/ralph/tests/test-model-routing-telemetry.mjs `
  plugins/ralph/tests/test-codex-launch-evidence.mjs `
  plugins/ralph/tests/test-regression-smoke-phase-4.mjs `
  plugins/ralph/tests/test-model-routing.mjs
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --check
node plugins/ralph/scripts/check-copilot-parity.mjs
node tools/validate-codex-marketplace-policy.mjs
```

### Full Node regression

```powershell
node plugins/ralph/tests/run.mjs
```

`run.mjs` currently discovers `test-*.mjs`; it does not run the surviving
shell tests. If generated/shared surfaces change, run the relevant shell gate
through Git Bash, at minimum:

```bash
bash plugins/ralph/tests/test-copilot-generator.sh
```

### Baseline handling

`test-regression-smoke-phase-4.mjs` contains the canonical deterministic grep
that produces `post-migration-caller-surface.txt`. If it fails solely because
authored line numbers moved, rerun that exact grep through Git Bash into the
tracked fixture, inspect the diff, then rerun the test.

Do **not** casually run the entire legacy `capture-baselines.sh`: it rewrites
many unrelated fixtures and uses `mktemp`/`/tmp`. The current execution
environment forbids temporary-directory writes, and this task only needs the
caller-surface baseline.

## 8. Pre-prerequisite versus post-prerequisite work

### 8.1 May land before the Codex runtime release

- Ralph authored lowering/state-machine correction
- generated Codex recipe regeneration
- encrypted-message V2 telemetry fixtures
- null/blank completion and missing-artifact fixtures
- V1 preservation fixtures
- exact role/model/effort/cardinality assertions
- no-inline static/fail-closed regression coverage
- AGENTS, dogfood guide, release-skill prerequisite wording, changelog, and
  deterministic baseline updates
- all generation/parity/policy/Node tests

This work should be committed in an isolated `ai-developer-toolkit` worktree
based on the current release candidate (`4100a48d`), reviewed, and kept ready
for publication. It must not change the separate Codex source or codexu parent
pointer.

With the old broken Codex runtime, an optional negative source-candidate smoke
may prove the corrected Ralph parent fails nonzero and leaves no reviewed plan
commit after a null/failed child. That is useful no-inline evidence, but it is
not the final installed positive gate.

### 8.2 Must wait for `codex-v2-copilot-encrypted-subagent-handoff`

After that task has shipped a new Codex release and the real host has installed
it:

1. Publish/verify the reviewed Ralph `5.64.0` candidate at mandatory remotes as
   prescribed by `.claude/skills/release-plugin/SKILL.md`.
2. Refresh the real Copilot and Codex plugin installations from the published
   paths; source checkout execution is not evidence.
3. Run a **forced V1** Codex gate (V2 disabled/absent) and a **forced V2** gate
   (visible-routing inline table). Confirm the detected schemas really expose
   the intended surface.
4. For quick plan, require the exact four roles, exactly one child per role,
   non-empty final messages, all required artifacts, and exact Sol/xhigh
   requested/effective routing.
5. For fixer/updater probes, require exact-one child and the existing Sol
   medium / Opus high routes as applicable.
6. Require no timed-out/failed/incomplete child, no parent fallback evidence,
   process success, clean telemetry bijection, and complete command records.
7. Preserve sanitized V1/V2 JSONL, raw-session correlation evidence, command
   records, artifacts, and summaries under the active Ralph job.
8. Only then tag/release Ralph and update the codexu submodule pointer and
   active-plugin-version table.

## 9. Windows and PowerShell pitfalls

- The external runner must remain PowerShell 5.1 compatible; do not introduce
  PS7-only syntax.
- Native stderr can be promoted to `NativeCommandError` under
  `$ErrorActionPreference='Stop'`. Keep `Invoke-CapturedCommand`'s local
  `Continue` handling and `finally` finalization.
- Preserve command records as UTF-8 **without BOM** using
  `System.Text.UTF8Encoding($false)`.
- Preserve `-c` followed by one intact
  `features.multi_agent_v2={enabled=true,hide_spawn_agent_metadata=false}`
  argv value. Do not split the inline table or use the Boolean shorthand.
- PowerShell 5.1 native redirection may write captured JSONL as UTF-16LE.
  `Get-Content` handles it, but Node/shell consumers must not blindly assume
  UTF-8. Command-record encoding and event-stream encoding are separate
  contracts.
- Use `LastWriteTimeUtc` and normalize all bounds through
  `DateTimeOffset.UtcDateTime`; local-time comparisons can correlate stale
  sessions.
- `$HOME` and `$USERPROFILE` can differ. Preserve the optional
  `$CodexSessionRoot`, with `Join-Path $HOME '.codex\sessions'` as the current
  default.
- Use literal-path APIs for brackets and spaces. Escape single quotes when
  embedding Windows paths into generated PowerShell.
- Run `.sh` tests with Git Bash explicitly on Windows; bare `bash` may resolve
  to a broken WSL installation. Be mindful of MSYS path conversion.
- Keep evidence and scratch data under project/job directories; do not use
  `/tmp`, `%TEMP%`, or `mktemp` in this environment.

## 10. Risks and common implementation mistakes

1. **Confusing `last_task_message` with the answer.** It is input metadata and
   is deliberately null for encrypted communication. The answer is the
   optional payload inside `agent_status.completed`.
2. **Fixing only telemetry.** Structural roles would make the current children
   visible as roles, but Ralph would still accept null work and inline
   substitute unless recipes and terminal/artifact checks also change.
3. **Fixing only recipe order.** List-first prevents stale waits but does not
   repair the native encrypted handoff. Keep the runtime prerequisite.
4. **Treating `wait_agent` exit as completion.** V2 wait is targetless mailbox
   activity only. Always relist, even after timeout.
5. **Accepting `task_complete` without a message.** The observed native failure
   emits completion with null `last_agent_message`; event type alone is
   insufficient.
6. **Deriving V2 role from encrypted prose.** Do not decrypt, regex, or infer
   from `arguments.message`; use request `task_name`, spawn output
   `task_name`, and child `agent_path`.
7. **Weak identity comparison.** Request names are leaves while outputs/paths
   may be `/root/<leaf>`. Normalize deliberately, validate the legal name, and
   require exact one-to-one mapping; do not use substring matching.
8. **Regressing V1.** Do not add `list_agents` or targetless waiting to the
   namespaced V1 recipe.
9. **Checking only generic “artifact exists.”** Bind checks to each role's
   declared output path(s); stale artifacts from a previous run must not
   satisfy the gate.
10. **Hand-editing generated skills.** Change the lowering builder/inventory,
    regenerate, and use `--check`.
11. **Assuming exit zero proves delegation.** The failed run exited zero after
    writing a complete local plan. Exact child evidence and artifacts are the
    acceptance authority.
12. **Premature release closeout.** Do not tag, install as final, or advance the
    codexu pointer until both forced V1 and forced V2 installed gates pass on
    the prerequisite Codex release.


## Architect Analysis

# Architecture Analysis: Ralph V2 Encrypted-Role / Wait / Terminal Hardening

## 1. Decision summary

Implement the Ralph-side hardening as one surgical patch on top of the
unreleased Ralph 5.64 candidate at toolkit commit
`4100a48dfd676793bee6d4273c68c81662520b4d` (including launch-evidence
commits `48e63c0c` and `4100a48d`).

The patch has two independently reviewable concerns:

1. **Generated runtime instructions:** change the authored Codex lowering so
   V2 recipes perform `spawn_agent -> list_agents -> [wait_agent ->
   list_agents]*`, use the spawn-returned V2 task path as the exact lookup
   identity, and accept only a terminal `completed` state containing a
   non-empty final message. All other terminal states, `Completed(None)`,
   missing/blank output, missing required artifacts, or downstream inline
   fallback are hard failures.
2. **Installed telemetry:** derive V2 role identity from plaintext
   `spawn_agent.arguments.task_name`, bind it to the spawn result
   `task_name` and child rollout `agent_path`, and never inspect encrypted
   `arguments.message`. Retain the plaintext message marker only for V1,
   whose stable identity remains `agent_id`.

All Ralph source, generated artifacts, tests, documentation, and release-note
work can be completed now. Final V2 installed-host acceptance and every
release/pointer action remain blocked on
`codex-v2-copilot-encrypted-subagent-handoff`.

## 2. Evidence and current failure

### Candidate baseline

- Repository: `ai-developer-toolkit`
- Existing worktree:
  `ai-developer-toolkit/.worktrees/publish-ralph-564`
- Branch: `release/ralph-564-publish`
- Baseline HEAD: `4100a48d`
- `48e63c0c` added durable ordered Codex argv evidence.
- `4100a48d` made that evidence survive PowerShell 5.1 native stderr and
  nonzero process exits.
- The candidate is versioned `5.64.0` but is not yet eligible for a release
  tag.

### Failed installed-host evidence

Reference, do not rewrite:

- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/installed-skill-dogfood-summary.json`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan.command.json`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan.jsonl`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan.stderr.log`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan-probe/.ralph/jobs/codex-installed-route-plan/worktree/plan/.ralph/jobs/codex-installed-route-plan/research-brief.md`
- `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan-probe/.ralph/jobs/codex-installed-route-plan/worktree/plan/.ralph/jobs/codex-installed-route-plan/plan.md`

The evidence establishes:

- The V2 inline table was passed correctly as one argv value:
  `features.multi_agent_v2={enabled=true,hide_spawn_agent_metadata=false}`.
- The Codex process exited `0`; launch quoting is not the root cause.
- The required quick-plan roles were all absent from the telemetry result.
- A child received an unusable encrypted handoff, completed almost
  immediately with no final message, and the targetless parent wait later
  timed out.
- The parent then performed local inspection and emitted plan artifacts
  anyway. That is an explicit fail-open fallback, not a degraded success.

### Codex source facts that constrain Ralph

Reference-only paths in the `codex` submodule:

- `external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
  - V2 accepts plaintext `task_name`.
  - It returns the canonical task path in `SpawnAgentResult.task_name`.
  - The initial operation currently crosses the runtime handoff seam owned by
    the prerequisite task.
- `external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/list_agents.rs`
  - Returns `agents[]` with `agent_name`, `agent_status`, and
    `last_task_message`.
- `external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
  - Codex 0.141 V2 wait is targetless.
  - It waits for new mailbox/steer activity; a completion notification that
    predates subscription can therefore be missed.
- `external/repos/codex-patched/codex-rs/core/src/agent/control.rs`
  - `ListedAgent.agent_name` is the canonical `agent_path`.
  - `last_task_message` is task input metadata, not final output.
- `external/repos/codex-patched/codex-rs/core/src/agent/status.rs`
  - A turn completion becomes `AgentStatus::Completed(last_agent_message)`.
- `external/repos/codex-patched/codex-rs/protocol/src/protocol.rs`
  - The terminal success-shaped variant is
    `Completed(Option<String>)`; `Completed(None)` is representable and is
    not useful work.

Ralph must not patch these files. They are owned by
`codex-v2-copilot-encrypted-subagent-handoff`.

## 3. Scope and non-goals

### In scope now

- V2 role/correlation correction in telemetry.
- List-before-wait V2 recipe generation for single and fan-out delegation.
- Non-empty final-message and site-specific artifact gates on V1 and V2.
- Explicit no-inline-fallback instructions.
- Regression tests and high-fidelity telemetry fixtures.
- Regeneration of Codex skill artifacts.
- Canonical dogfood documentation and the external runner contract.
- Ralph 5.64 behavioral/release notes.

### Out of scope

- Decrypting or changing the native Codex child handoff.
- Changing Codex wait/list/status APIs.
- Editing Claude or Copilot behavior.
- Adding a second executable orchestration layer to enforce prose recipes.
- Pushing, tagging, publishing, installing, or advancing submodule pointers.
- Renumbering the still-unreleased 5.64 candidate unless 5.64.0 is externally
  consumed before this patch lands.

## 4. Repository and worktree split

### Ralph lane

Create a dedicated toolkit worktree, rather than editing toolkit `main` or
sharing the existing publish worktree:

```text
Repository:
  ai-developer-toolkit/
Base:
  4100a48dfd676793bee6d4273c68c81662520b4d
Branch:
  ralph/ralph-v2-encrypted-role-wait-terminal-hardening
Worktree:
  ai-developer-toolkit/.worktrees/ralph-v2-encrypted-role-wait-terminal-hardening/
```

The resulting commit is merged into `release/ralph-564-publish` only after its
source gates pass. Starting from toolkit `main` would silently omit the
unpublished 5.64 routing, relocation, telemetry, and launch-evidence work.

### Codex prerequisite lane

The prerequisite runs independently under a Codex-owned worktree, for example:

```text
codex/.worktrees/codex-v2-copilot-encrypted-subagent-handoff/
```

Any inner `external/repos/codex-patched` edit follows the nested two-commit
flow: inner patched-Codex commit first, then Codex wrapper gitlink commit. Its
implementation and release are not part of this Ralph patch.

### Codexu evidence/release lane

- The concrete external runner is:
  `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/run-installed-skill-dogfood.ps1`.
- It is currently an untracked job artifact, not plugin source. The canonical
  authored contract remains
  `plugins/ralph/docs/model-routing-dogfood.md`.
- After a successful toolkit release, codexu records the
  `ai-developer-toolkit` submodule pointer and updates root `AGENTS.md`'s
  active-plugin-version table in a separate parent-repository commit.

## 5. Dependency graph and sequencing

```text
R1  Freeze baseline at toolkit 4100a48d
 |
 +--> R2  Author V2/V1 recipe hardening in codex-lowering.mjs
 |     |
 |     +--> R3  Regenerate all affected .codex-plugin SKILL.md files
 |     +--> R4  Generator structural/unit tests
 |
 +--> R5  Author telemetry identity/completion hardening
       |
       +--> R6  PowerShell replay fixtures/tests
       +--> R7  Canonical dogfood guide + external runner mirror
       +--> R8  Release notes + regression baseline
              |
              +--> R9  Ralph source/generation/parity/full-suite gates
                       |
                       +--> Ralph patch may land on release branch

C1  codex-v2-copilot-encrypted-subagent-handoff
 |
 +--> C2  Fixed Codex build/release installed as the real host
          |
          +--> G1  Installed V2 acceptance
          +--> G2  Installed V1 compatibility acceptance
                  |
                  +--> G3  Ralph 5.64 tag/publish
                          |
                          +--> G4  codexu toolkit pointer +
                                   active-version table
```

`R2..R9` and `C1..C2` may proceed in parallel because they are separate
repositories. `G1` and everything below it are strictly serial after both
lanes.

## 6. Authored versus generated boundaries

### Authored files to modify

All paths below are relative to the toolkit root.

| Path | Change |
|---|---|
| `plugins/ralph/scripts/codex-lowering.mjs` | Own the V2 list-before-wait algorithm, terminal classification, V1 non-empty completion rule, artifact failure wording, and no-inline-fallback invariant. |
| `plugins/ralph/tests/test-codex-generator.mjs` | Pin exact V2 ordering and failure semantics across every emitted recipe; retain V1 sequence and routing assertions. |
| `plugins/ralph/tests/test-model-routing-telemetry.mjs` | Change the inline raw-rollout fixture builder and PowerShell replay matrix for encrypted V2 messages, task identity, and non-empty terminal messages. |
| `plugins/ralph/docs/model-routing-dogfood.md` | Canonical PowerShell telemetry/runner contract, V1/V2 surface-specific gates, artifact checks, and release ordering. |
| `plugins/ralph/AGENTS.md` | Correct the 5.64 behavioral contract: V2 role is task-name based, list precedes targetless wait, and empty completion/fallback are failures. |
| `plugins/ralph/CHANGELOG.md` | Amend the unreleased 5.64 notes; do not claim installed V2 success until the prerequisite and gate pass. |
| `plugins/ralph/tests/fixtures/regression-smoke-phase-4/post-migration-caller-surface.txt` | Regenerate only if the deterministic caller-surface test changes because documentation line numbers moved. Never hand-edit guessed line numbers. |

No standalone telemetry fixture directory is required for this surgical
change. The existing `writeCodexFixture` builder in
`tests/test-model-routing-telemetry.mjs` already materializes realistic parent
and child rollout JSONL trees, bounded timestamps, cwd, and V1/V2 linkage. Add
new fixture modes there:

- opaque/encrypted V2 `message`;
- missing/wrong/duplicate V2 `arguments.task_name`;
- V2 output `task_name` / child `agent_path` mismatch;
- `task_complete.last_agent_message` missing, null, empty, and whitespace;
- V1 plaintext marker success and failure;
- missing required artifact / fallback artifact cases at the assertion layer.

The schema-only fixtures remain references and should not be overloaded with
rollout data:

- `plugins/ralph/tests/fixtures/codex-multi-agent-schemas/0.141-v2.json`
- `plugins/ralph/tests/fixtures/codex-multi-agent-schemas/0.141-v2-hidden.json`
- `plugins/ralph/tests/fixtures/codex-multi-agent-schemas/0.141-v1.json`

### Generated files

Run:

```text
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=codex --write
```

Do not edit these by hand:

- `plugins/ralph/.codex-plugin/codex-skills/implement-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/plan-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/multi-model-investigate/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/brainstorm-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/analyze-iteration/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/review-changes/SKILL.md`

Only files whose generated bytes change should appear in the diff. The
Claude sources under `plugins/ralph/claude-skills/` and the Copilot tree under
`plugins/ralph/.copilot-plugin/` should remain byte-identical.

### External runner mirror

After the guide is authoritative and tested, mirror its helper changes into:

- codexu
  `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/run-installed-skill-dogfood.ps1`

Do not copy changes in the reverse direction. Preserve the old failed summary
and command/session artifacts as regression evidence; write a new run summary
or archive the old run before rerunning.

### Reference-only implementation files

- `plugins/ralph/scripts/generate-copilot-artifacts.mjs`
- `plugins/ralph/src/model-routing-policy.mjs`
- `plugins/ralph/tests/test-codex-launch-evidence.mjs`
- `plugins/ralph/tests/test-regression-smoke-phase-4.mjs`
- `tools/validate-codex-marketplace-policy.mjs`

Modify them only if a real failing test demonstrates a missing integration;
do not broaden the patch preemptively.

## 7. V2 identity and terminal-state contract

### Identity layers

For each V2 spawn, keep these fields distinct:

1. **Role:** the plaintext requested
   `spawn_agent.arguments.task_name`, e.g. `plan_researcher`.
2. **Canonical task identity:** the successful spawn output's non-empty
   `task_name`, e.g. `/root/plan_researcher`.
3. **Child identity:** the child rollout's
   `session_meta.payload.source.subagent.thread_spawn.agent_path`.
4. **List identity:** `list_agents.agents[].agent_name`.

Required relations:

- Requested role is non-empty, matches `[a-z0-9_]+`, and is unique within the
  bounded dispatch.
- The leaf of the spawn output's canonical task identity equals the requested
  role.
- Child `agent_path` exactly equals the spawn output identity.
- `list_agents.agent_name` exactly equals the spawn output identity.
- Exactly one spawn request, one output, one child rollout, and one list entry
  participate in each binding.

Do not construct `/root/<role>` in Ralph and do not match by leaf alone. Use
the spawn-returned canonical identity exactly; the leaf comparison is an
additional role assertion, not a correlation substitute.

`arguments.message` is task payload only. On V2 it may be opaque ciphertext,
must not be regex-parsed, and has no role-bearing acceptance value.

### V2 single-delegation state machine

Generated Variant A must specify this order:

1. Resolve and validate the exact route and V2 schema.
2. Spawn with plaintext `task_name`, payload `message`, `fork_turns: "none"`,
   and exact model/effort.
3. Require one non-empty spawn-returned canonical task identity and validate
   its role leaf.
4. **Call `list_agents` immediately, before any targetless wait.**
5. Select exactly one list row by exact canonical identity.
6. Classify the target state:
   - `completed` with a non-empty, non-whitespace string: candidate success;
   - `completed: null`, missing payload, empty string, or whitespace:
     hard failure;
   - `errored`, `shutdown`, or `not_found`: hard failure;
   - `pending_init`, `running`, or `interrupted`: nonterminal.
7. If nonterminal, call targetless `wait_agent {timeout_ms: 600000}`.
   `timed_out: true` is a hard failure. After any other wake, return to step
   4 and re-list; never infer which child caused a global wake.
8. Apply the site-specific output/artifact contract.
9. Only after steps 6 and 8 succeed may the parent consume the result or
   produce a downstream success artifact.
10. Close only when the exposed schema has `close_agent`; 0.141 V2 has none.

This fixes the stale-notification race without changing Codex. A child already
terminal before the parent subscribes is harvested at step 4 and never enters
`wait_agent`.

### V2 fan-out state machine

- Spawn the declared bounded cardinality in one batch.
- Validate unique returned identities before waiting.
- List immediately and classify every captured identity.
- Fail the entire fan-out on any spawn error, duplicate/missing identity,
  ambiguous list match, terminal failure, empty completion, timeout, or output
  contract failure.
- Harvest already-completed children and wait only while at least one captured
  child is nonterminal.
- After every global wake, re-list all unresolved children.
- Partial results are never passed to synthesis.
- Unrelated pre-existing list rows are not substitutes for captured children;
  the recipe's cardinality is over the exact captured identity set.

### Terminal and output invariants shared with V1

Terminal state is necessary but not sufficient. Success requires:

1. a completed state;
2. a non-empty final assistant message;
3. the declared output format;
4. every named durable artifact present, non-empty, and structurally valid;
5. no failed child in the same bounded dispatch.

Site contracts remain:

- JSON lens: parse the complete final message as one JSON object.
- Prose/text: require non-whitespace final prose.
- Review: require non-whitespace prose, one `<review-meta>` trailer, and the
  exact findings JSON file.
- Artifact: require non-whitespace final summary/path and every artifact named
  in that recipe's input contract.

Any failure stops the surrounding phase. The generated instruction must say
explicitly: do not redo the delegated work inline, do not synthesize from
partial results, do not write/accept a phase success artifact, and do not
continue to the next phase.

## 8. V1 compatibility strategy

V1 remains a separate branch selected by tool presence:

- `multi_agent_v1.spawn_agent`
- `multi_agent_v1.wait_agent`
- `multi_agent_v1.close_agent`
- no V2 `list_agents` discriminator

Preserve:

- exact `agent_id` correlation;
- targeted `wait_agent {targets:[agent_id]}`;
- plaintext `RALPH_DISPATCH_ROLE=<role>` parsing from V1
  `arguments.message`;
- exact requested/effective model and effort;
- exact child cardinality;
- required close operation.

Harden V1 in parallel with V2:

- `status[agent_id].completed` must contain a non-empty, non-whitespace final
  message;
- null/missing/blank completed output, timeout, errored/aborted status, or
  missing artifacts fail;
- no inline parent fallback.

Do not force V1 through V2 `task_name`, `agent_path`, or `list_agents`.
Conversely, never accept a V1 message marker as V2 role proof.

## 9. Telemetry and external runner design

### `Get-CodexChildRollouts`

Update the PowerShell function in the guide, then mirror it to the runner:

1. Parse every parent `spawn_agent` request/output pair.
2. Determine the surface from the exclusive output identity:
   - V1: `agent_id`;
   - V2: `task_name`;
   - both/neither: fail.
3. V2:
   - require plaintext `arguments.task_name`;
   - set `Role` from that field;
   - ignore `arguments.message`;
   - require output task-name leaf equals the requested role;
   - correlate output task name exactly to child `agent_path`.
4. V1:
   - require one plaintext `RALPH_DISPATCH_ROLE` marker in
     `arguments.message`;
   - set `Role` from that marker;
   - correlate by `agent_id`.
5. Require one child `turn_context` and exact effective route.
6. Require exactly one `event_msg/task_complete`, no failed/aborted event, and
   a non-empty `task_complete.last_agent_message`.
7. Keep the full request/child bijection and duplicate/extra-child rejection.
8. Return only metadata about the final message (for example byte/character
   length or a hash), not its text, in summary evidence.

Add an explicit `$ExpectedSurface` parameter to installed assertions. A V2
case must fail if the actual run silently selected V1, and vice versa.

### Site-specific artifact assertions

Keep generic rollout correlation independent of workflow paths. Layer exact
artifact checks in `Assert-CodexPlanRoutes` and the single-agent probe cases.

For the current quick-plan probe, resolve:

```text
<probe>/.ralph/jobs/codex-installed-route-plan/worktree/plan/
  .ralph/jobs/codex-installed-route-plan/
```

Require these non-empty final artifacts:

- `research-brief.md`
- `suggested-decomposition.json` (valid JSON)
- `primary-plan-review.md`
- `plan-review.md`
- `plan-review-findings.json` (valid schema-shaped JSON)
- `plan.md`
- `stories-outline.md`

For exact-one fixer/updater probes, require their expected probe file and
content, not merely successful telemetry.

### Installed evidence shape

Each case must preserve:

- `codex-<case>.command.json`;
- stdout JSONL and stderr log;
- UTC bounds and cwd;
- copied parent/child rollout JSONL;
- expected and actual surface;
- requested role/model/effort;
- effective model/effort;
- final-message-present metadata;
- required artifact paths plus hashes;
- installed Codex and Ralph versions/provenance.

Keep the existing command record schema and UTF-8-no-BOM finalization from
`48e63c0c`/`4100a48d`.

## 10. Test pyramid

Run commands from the toolkit worktree root.

### Layer 1: generator/unit structure

Modify `plugins/ralph/tests/test-codex-generator.mjs` to prove:

- every V2 Variant A contains first-list-before-first-wait ordering;
- each nonterminal loop re-lists after wait;
- `last_task_message` is explicitly prohibited as final output;
- `Completed(None)`, null/blank final messages, terminal failures, missing
  artifacts, and inline fallback are explicitly rejected;
- fan-out has all-or-nothing behavior;
- V1 remains spawn -> targeted wait -> completed payload -> close;
- model/effort and task-name routing assertions remain unchanged.

Command:

```text
node --test plugins/ralph/tests/test-codex-generator.mjs
```

### Layer 2: telemetry replay

Modify the fixture builder in
`plugins/ralph/tests/test-model-routing-telemetry.mjs`.

Positive cases:

- V2 opaque/encrypted `message` + valid plaintext task name/path succeeds.
- V1 plaintext message marker + `agent_id` succeeds.
- V1 and V2 exact-one cases succeed.

Negative cases for both surfaces where applicable:

- missing, null, empty, or whitespace `last_agent_message`;
- missing or duplicate completion;
- failed/aborted child;
- missing/wrong requested route;
- missing/wrong effective route;
- missing/duplicate/extra child;
- missing required artifact.

Additional V2 negatives:

- missing/invalid/duplicate `arguments.task_name`;
- spawn output role-leaf mismatch;
- output `task_name` / child `agent_path` mismatch;
- encrypted message contains no role marker (must still pass when task identity
  is valid);
- a misleading plaintext-looking message marker must not override task name.

Additional V1 negative:

- missing/duplicate/wrong message role marker.

Command:

```text
node --test plugins/ralph/tests/test-model-routing-telemetry.mjs
```

### Layer 3: launch-evidence and regression guards

Commands:

```text
node --test plugins/ralph/tests/test-codex-launch-evidence.mjs
node --test plugins/ralph/tests/test-regression-smoke-phase-4.mjs
```

If the caller-surface baseline changes, regenerate the exact sorted grep output
defined in `test-regression-smoke-phase-4.mjs` into
`tests/fixtures/regression-smoke-phase-4/post-migration-caller-surface.txt`.
Do not run the broad legacy `capture-baselines.sh` merely to update this file;
it uses `/tmp`/`mktemp` and rewrites unrelated fixtures.

### Layer 4: generated/parity/release gates

```text
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=codex --write
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --check
node plugins/ralph/scripts/check-copilot-parity.mjs
node --test plugins/ralph/tests/test-codex-generator.mjs
node tools/validate-codex-marketplace-policy.mjs
```

Then run the existing full Ralph test set. In PowerShell, avoid relying on
shell wildcard behavior:

```powershell
$tests = Get-ChildItem -LiteralPath plugins\ralph\tests -Filter *.mjs -File
node --test @($tests.FullName)
```

The opt-in live smoke is supplementary and does not replace installed
acceptance:

```text
node --test plugins/ralph/tests/test-codex-live-smoke.mjs
```

### Layer 5: installed-host acceptance (blocked)

This layer starts only after the Codex prerequisite release is installed.

Required Codex cases:

| Surface | Case | Expected |
|---|---|---|
| V2 | quick plan | Exactly the four plan roles, all Sol/xhigh, non-empty child messages, complete plan artifact set |
| V1 | quick plan | Same roles/routes/artifacts through V1 `agent_id` |
| V2 | code-fixer | Exactly one `code_fixer`, Sol/medium, expected output file |
| V1 | code-fixer | Same through V1 |
| V2 | docs-updater | Exactly one `docs_updater`, Opus 4.8/high, expected output file |
| V1 | docs-updater | Same through V1 |

V2 launches must record `-c` immediately followed by the one intact inline
table value. V1 launches must explicitly force/verify V2 disabled rather than
assuming operator configuration, and telemetry must prove the V1 surface was
actually selected.

Retain the existing Copilot, primary-route, Luna wrapper, hidden-schema
fail-closed, and command-capture cases. The final summary passes only if every
case passes; process exit `0` alone is never sufficient.

## 11. Acceptance split

### Ralph work that can pass now

1. The authored V2 recipe lists before waiting and re-lists after each wake.
2. Generated V2 single/fan-out recipes use exact spawn-returned identity.
3. V1 generated behavior and model/effort routing remain intact.
4. Both surfaces reject null/missing/blank final messages and missing
   artifacts.
5. Generated instructions prohibit inline fallback and downstream success
   artifacts after child failure.
6. V2 telemetry passes with an opaque encrypted `message` and valid
   task-name/path identity.
7. V2 telemetry no longer contains role extraction from `arguments.message`.
8. Requested/effective route, cardinality, cwd, time-window, completion, and
   bijection checks remain fail closed.
9. Generated artifacts, parity, marketplace policy, regression tests, and the
   full Ralph source suite pass.
10. The unreleased 5.64 docs accurately describe the new contract and state
    the live prerequisite.

### Acceptance blocked on Codex

1. A real V2 child receives and executes the delegated task on the Copilot
   host.
2. The child returns `Completed(Some(non-empty-message))`.
3. A child that finishes before the parent waits is harvested by the initial
   list and does not trigger a stale wait timeout.
4. The real quick-plan workflow produces exactly four successful delegated
   roles without parent inline fallback.
5. Required plan artifacts are attributable to successful delegated phases.
6. The installed V1/V2 matrix passes on the fixed Codex release.
7. Ralph 5.64 may be tagged/published.
8. Codexu may advance its toolkit pointer and active-version table.

Until all blocked criteria pass, the task may report “Ralph code complete,
release blocked,” but not “Ralph 5.64 shipped.”

## 12. Release/version surfaces and ordering

The candidate already carries six `5.64.0` stamps:

- `.claude-plugin/marketplace.json`
- `.github/plugin/marketplace.json`
- `.agents/plugins/marketplace.json`
- `plugins/ralph/.claude-plugin/plugin.json`
- `plugins/ralph/.github/plugin/plugin.json`
- `plugins/ralph/.codex-plugin/plugin.json`

Because 5.64.0 is still unreleased, keep these values unchanged and verify
parity. If external publication makes 5.64.0 immutable before this patch
lands, bump all six together to 5.64.1; never update only the three plugin
manifests or only the marketplace indexes.

Release order:

1. Land Ralph hardening on the release branch; no tag.
2. Land/release/install the fixed Codex prerequisite.
3. Stage the exact Ralph candidate in the real Copilot and Codex installed
   layouts, recording provenance.
4. Run the complete installed matrix and preserve evidence.
5. Require one all-pass summary reviewed against command/session artifacts.
6. Only then tag/push/publish Ralph 5.64.
7. Refresh installed marketplace copies and run a minimal post-publication
   installed smoke.
8. Advance `ai-developer-toolkit` in codexu.
9. Update codexu root `AGENTS.md` active-plugin version in the same parent
   commit.

The old failed dogfood remains evidence and must not be overwritten or
relabelled as passing.

## 13. Parallelization and shared-surface hazards

- **Same-plugin serialization:** all Ralph work shares
  `codex-lowering.mjs`, generated Codex files, `AGENTS.md`, `CHANGELOG.md`,
  and version surfaces. Do not run a second Ralph 5.64 implementation in
  parallel.
- **Generator ownership:** one writer owns authored lowering and regeneration.
  Manual edits to generated skills will be overwritten.
- **Guide/runner duplication:** update and test the guide first, then mirror
  into the external runner. Parallel edits will drift.
- **Candidate-base hazard:** toolkit `main` is behind the release candidate;
  base on `4100a48d`.
- **Codex/Ralph boundary:** Codex runtime work and Ralph work are repository
  disjoint, but live acceptance is not parallelizable with an unfixed or
  uninstalled Codex build.
- **Baseline churn:** top-of-file additions in `AGENTS.md`/dogfood docs can
  shift line-number fixtures even when behavior is unchanged. Inspect and
  regenerate only the deterministic baseline.
- **Installed-cache hazard:** source worktree edits do not update
  `~/.codex/plugins/cache/...`; installed acceptance must record the exact
  staged install path and version.
- **Evidence-window collision:** do not run V1 and V2 dogfoods concurrently
  against one session root/cwd. Their timestamp/cwd scans can become
  ambiguous.

## 14. Windows and PowerShell pitfalls

- Use Windows paths and `-LiteralPath`; wildcard/case/path normalization can
  otherwise bind the wrong session.
- Preserve
  `features.multi_agent_v2={enabled=true,hide_spawn_agent_metadata=false}` as
  one argument immediately after `-c`. Do not interpolate it through an
  unquoted command string.
- PowerShell 5.1 can promote native stderr to `NativeCommandError` when
  `$ErrorActionPreference='Stop'`. Keep the local `Continue` scope and always
  finalize command evidence in `finally`.
- Capture `$LASTEXITCODE` immediately after the native process.
- Use `System.Text.UTF8Encoding($false)` for JSON/JSONL; PowerShell 5.1
  `-Encoding UTF8` writes a BOM.
- Use `LastWriteTimeUtc` and normalize inputs through `DateTimeOffset` before
  session-window comparisons.
- PowerShell arrays unwrap single values. Wrap function results with `@(...)`
  and preserve arrays intentionally when returning candidate row sets.
- Under strict mode, test property existence before dereferencing optional
  rollout fields; null completion is expected negative data, not a script
  crash.
- Invoke Bash explicitly for Bash-based release gates. Do not assume
  PowerShell regex/pipe quoting matches Git Bash.
- Do not use `/tmp`, `mktemp`, or the broad legacy capture script. Keep test
  scratch directories under the repository's existing test-local pattern.
- Avoid deep additional worktree/evidence nesting where possible; the current
  dogfood path is already close to Windows path-length limits.
- Do not rebuild while a Codex process has the target executable locked.

## 15. Common implementation mistakes

1. Parsing `RALPH_DISPATCH_ROLE` from V2 `arguments.message`.
2. Treating `last_task_message` as child output.
3. Waiting before the first list.
4. Treating the presence of a `completed` variant as success when its payload
   is null or blank.
5. Correlating by role leaf instead of exact spawn-returned canonical path.
6. Allowing either surface in a surface-specific installed gate.
7. Accepting correct model/effort while ignoring wrong cardinality or missing
   artifacts.
8. Continuing inline after a delegation failure because a parent can still
   produce plausible prose.
9. Editing generated `.codex-plugin` skills directly.
10. Updating only some of the six version stamps.
11. Running acceptance from the source tree instead of the installed plugin
    cache.
12. Starting the patch from toolkit `main` instead of the 5.64 candidate.

## 16. Rollback

The Ralph patch is recipe, test, documentation, and generated-artifact only.
Before release it can be rolled back by reverting its toolkit commit and
regenerating the Codex target from the restored authored lowering.

Do not roll back by restoring only generated skill files; that creates authored
versus generated drift. A failed installed gate leaves the release branch
untagged, the six version stamps at the unreleased candidate value, and the
codexu submodule pointer unchanged.


## Codex Research

### Codebase Architecture

- **Target repository:** `D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\publish-ralph-564`, currently at `4100a48d`, following `48e63c0c`.
- Ralph is a **Node.js 20+ ESM plugin**. Runtime and transformation code uses `.mjs`; workflows are authored as Markdown skills.
- Canonical sources live under:
  - `plugins/ralph/claude-skills/`
  - `plugins/ralph/agents/`
  - `plugins/ralph/scripts/`
- `plugins/ralph/scripts/generate-copilot-artifacts.mjs` mechanically generates `.copilot-plugin/` and `.codex-plugin/`. Generated files must not be hand-edited.
- Codex-specific rewriting is centralized in `plugins/ralph/scripts/codex-lowering.mjs`.
- Tests use Node’s built-in test runner, PowerShell subprocess fixtures, and a smaller Bash regression layer. There is no repository-root `package.json`; commands run directly with `node`.
- The installed-host harness is external/job-local: `.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/run-installed-skill-dogfood.ps1`.

### Feature-Relevant Code

**Observed failure**

- `dogfood/codex-plan.jsonl.command.json` launched Codex V2 with the correct explicit schema exposure.
- The parent rollout spawned `plan_researcher` and `plan_drafter` with exact `gpt-5.6-sol` / `xhigh`, but `arguments.message` was encrypted ciphertext.
- Spawn outputs returned plaintext `/root/plan_researcher` and `/root/plan_drafter`.
- Both children completed in approximately one second with:
  - exact effective model/effort;
  - `task_complete.last_agent_message: null`;
  - zero assistant messages;
  - `list_agents.agent_status.completed: null`.
- Each subsequent targetless `wait_agent {timeout_ms:600000}` timed out. The parent then produced plan artifacts inline.
- `installed-skill-dogfood-summary.json` failed because role extraction still parsed encrypted `arguments.message`, yielding no roles.

**Authored behavior**

- `plugins/ralph/scripts/codex-lowering.mjs:274` — V1/V2 surface detection.
- `plugins/ralph/scripts/codex-lowering.mjs:311` — shared fail-closed operational prose.
- `plugins/ralph/scripts/codex-lowering.mjs:445` — V2 single-child sequence currently waits before `list_agents`.
- `plugins/ralph/scripts/codex-lowering.mjs:499` — V2 fan-out sequence also waits before inspecting terminal state.
- `plugins/ralph/scripts/codex-lowering.mjs:635` — single-delegation role marker generation.
- `plugins/ralph/claude-skills/plan-with-ralph/SKILL.md:526` and `plugins/ralph/claude-skills/plan-with-ralph/SKILL.md:541` contain generic research fallback language that remains unsafe when copied into the Codex artifact.

**Telemetry contract**

- `plugins/ralph/docs/model-routing-dogfood.md:654` — canonical `Get-CodexChildRollouts` PowerShell implementation.
- `plugins/ralph/docs/model-routing-dogfood.md:734` incorrectly derives every role from `arguments.message`.
- `plugins/ralph/docs/model-routing-dogfood.md:753` already exposes V2 `agent_path`.
- `plugins/ralph/docs/model-routing-dogfood.md:776` checks task completion but not non-null `last_agent_message`.
- `plugins/ralph/docs/model-routing-dogfood.md:813` preserves exact role/model/effort/cardinality assertions.
- The external `dogfood/run-installed-skill-dogfood.ps1` duplicates this contract and must be refreshed for installed acceptance.

**Tests and baselines**

- `plugins/ralph/tests/test-codex-generator.mjs` — recipe ordering, V1/V2 parity, no-inline-fallback, task-name and artifact-contract assertions.
- `plugins/ralph/tests/test-model-routing-telemetry.mjs:182` — synthetic V1/V2 rollout fixture. Its V2 message is currently plaintext and successful completion lacks realistic `last_agent_message`.
- `plugins/ralph/tests/test-regression-smoke-phase-4.mjs:614`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-4/post-migration-caller-surface.txt`
- Release documentation:
  - `plugins/ralph/AGENTS.md`
  - `plugins/ralph/CHANGELOG.md`

Generation affects these recipe-bearing files:

- `plugins/ralph/.codex-plugin/codex-skills/brainstorm-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/implement-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/multi-model-investigate/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/plan-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/analyze-iteration/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/review-changes/SKILL.md`

### Technical Constraints

- Preserve **V1 Collab**: role marker from plaintext V1 `message`, `agent_id` correlation, targeted wait, and close.
- For **V2**, role identity must come from plaintext `arguments.task_name`, returned `output.task_name`, and child `agent_path`. Do not decrypt or inspect `arguments.message`.
- Input `task_name` is underscore-normalized; output and `agent_path` may be canonical `/root/<role>` paths. Compare canonical leaf/path consistently.
- Preserve exact requested/effective model, effort, child cardinality, parent-child bijection, cwd, and completion-count checks.
- `Completed(None)`, null/blank `last_agent_message`, missing artifacts, timeout, or failed state must terminate the workflow. Parent execution cannot replace child output.
- Codex 0.141 V2 has targetless waits and no close tool. Therefore `list_agents` must be consulted **before** waiting.
- PowerShell tests intentionally exercise Windows PowerShell 5.1. Keep standalone `.ps1` changes ASCII-safe and UTF-8-no-BOM where command evidence requires it.
- Session filenames do not reliably communicate UTC time; correlate using embedded timestamps and bounded cwd/thread IDs.
- The long Windows paths are already near practical limits. Do not add unnecessary nested fixture directories.
- Ralph changes can merge independently. Final installed V2 acceptance remains blocked on `codex-v2-copilot-encrypted-subagent-handoff`; this task must not modify the Codex runtime as a workaround.

### Implementation Suggestions

1. **Correct V2 recipe sequencing**
   - After every spawn batch, call `list_agents` immediately.
   - Match exact returned identity.
   - Treat non-empty `agent_status.completed` as success.
   - Treat `completed: null`, failed/cancelled state, missing identity, or missing output as hard failure.
   - Call targetless `wait_agent` only while at least one matched child is genuinely running.
   - Re-list after each wait; never wait when all requested children are already terminal.

2. **Strengthen output boundaries**
   - Require a non-empty final child result and every named durable artifact.
   - Add explicit prose prohibiting the parent from researching, drafting, reviewing, synthesizing, or writing substitute artifacts after child failure.
   - Use Codex-specific lowering substitutions to neutralize the generic research fallback without changing Claude/Copilot behavior.

3. **Fix telemetry correlation**
   - V1: retain `RALPH_DISPATCH_ROLE` parsing.
   - V2: require valid input `task_name`; require returned `task_name` and child `agent_path` to identify the same role; never parse `message`.
   - Require exactly one `task_complete` with non-empty `last_agent_message`.
   - Extend the fixture so V2 uses opaque encrypted-looking message text and includes negative cases for null/empty completion and path/task mismatch.

4. **Installed gate separation**
   - Land source, generated artifacts, tests, documentation, and baselines first.
   - Update the job-local runner only as the external acceptance harness.
   - Run installed V1 acceptance immediately.
   - Run installed V2 acceptance only after the Codex prerequisite ships; no tag or publication before both pass.

**Acceptance criteria**

- V2 encrypted messages never affect role extraction.
- V2 already-terminal children cause zero additional targetless waits.
- `Completed(None)`, null final message, absent artifact, or inline fallback fails.
- V1 and V2 retain exact model/effort/cardinality and bijection validation.
- All seven generated Codex recipe files reflect the new ordering.
- Source gates pass:

```text
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=codex --write
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --check
node --test plugins/ralph/tests/test-codex-generator.mjs
node --test plugins/ralph/tests/test-model-routing-telemetry.mjs
node --test plugins/ralph/tests/test-regression-smoke-phase-4.mjs
node plugins/ralph/scripts/check-copilot-parity.mjs
node tools/validate-codex-marketplace-policy.mjs
node plugins/ralph/tests/run.mjs
```

- Final release evidence contains successful installed Copilot, Codex V1, and prerequisite-fixed Codex V2 runs with non-null child output and required artifacts.

## Copilot Research

I’m loading the task brief and repository state before acting.

The brief targets Ralph’s toolkit worktree and installed-host dogfood evidence; I’m mapping those artifacts and governing guidance next.

Direct access to the sibling evidence/worktree is restricted in this execution context, so I’m checking the plan worktree’s tracked mirrors and local Git objects without bypassing that boundary.

I found the prior plan artifacts locally. I’m now resolving the candidate toolkit commits through GitHub and tracing their generated/runtime surfaces.

The candidate SHAs are local-only and unavailable through GitHub; I’m grounding the analysis in the committed convergence plan, current released toolkit sources, and tracked prerequisite artifacts, while preserving that evidence limitation explicitly.

The released toolkit head is newer than the original 5.64 plan. I’m inventorying its current Ralph sources/tests and the installed-runner contract so the correction plan is surgical rather than replaying the old matrix.

The correction depends on Codex V2’s actual tool/event contract, so I’m verifying the plaintext identity and terminal-state fields against the fork source.

The fork wrapper pins `Evyatar108/codex-openai-fork` at `587a6a8a`; I’m reading the exact V2 wait/list/spawn implementation at that pinned runtime.

The codexu repo has a release branch that may pin the local toolkit candidate; I’m checking its gitlink and any tracked release evidence without touching the worktree.

I’ve confirmed the runtime mismatch: V2 `wait_agent` is targetless, `message` is encrypted, and `list_agents.agent_status.completed` explicitly permits null. I’m enumerating every generated artifact and baseline that encodes the stale contract.

I’m pinning the expected V2 role set and artifact obligations from the generated quick-plan recipe so the acceptance criteria can assert exact cardinality rather than “some completed children.”

A key additional issue is visible: current plan recipes emit `task_name: "general_purpose"` for every distinct role. I’m tracing the central dispatch-site IDs so the plan can require unique plaintext V2 role names without changing agent type or routing.

### Codebase Architecture

Ralph is a Node 20+/ESM plugin in the `ai-developer-toolkit` submodule. Authored sources live under `plugins/ralph/{src,scripts,skills,agents,docs}`; `scripts/generate-copilot-artifacts.mjs` and `scripts/codex-lowering.mjs` produce `.copilot-plugin/**` and `.codex-plugin/**`. Tests use Node’s built-in test runner plus shell/PowerShell contract tests.

Implementation belongs only in `D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\publish-ralph-564`, continuing from candidate HEAD `4100a48d` including `48e63c0c`. Do not edit codexu or the Codex submodule, push, tag, or install.

### Feature-Relevant Code

Primary authored change:

- `plugins/ralph/scripts/codex-lowering.mjs`
  - `v2SingleDelegationSteps()` and `v2FanoutSteps()` currently emit targeted-looking `wait_agent { agent_name }`, then `list_agents`.
  - `PROSE_SITE_INVENTORY` has stable role-bearing `siteId` values but emits generic `taskName: "general-purpose"`.
  - `AGENT_SITE_INVENTORY`, `singleDelegationRecipe()`, `fanOutRecipe()`, and `outputHandlingProse()` are the natural integration points.

Regenerated outputs containing V2 recipes:

- `plugins/ralph/.codex-plugin/codex-skills/{brainstorm-with-ralph,implement-with-ralph,multi-model-investigate,plan-with-ralph}/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/{analyze-iteration,convert-to-ralph-prd,review-changes}/SKILL.md`

Tests and evidence:

- `plugins/ralph/tests/test-codex-generator.mjs`
- `plugins/ralph/tests/test-model-routing-telemetry.mjs`
- `plugins/ralph/tests/test-model-routing.mjs`
- `plugins/ralph/tests/test-regression-smoke-phase-4.mjs`
- `plugins/ralph/tests/fixtures/model-routing/**`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-4/post-migration-caller-surface.txt` if regenerated source references alter it
- `plugins/ralph/docs/model-routing-dogfood.md`, especially `Invoke-CodexInstalledSkill`, `Assert-CodexInstalledRoute`, and `Assert-CodexPlanRoutes`
- `plugins/ralph/CHANGELOG.md`
- `plugins/ralph/AGENTS.md`

### Technical Constraints

Pinned Codex V2 behavior is decisive:

- `spawn_agent.message` is schema-encrypted. It cannot identify a role in external telemetry.
- V2 requires plaintext `task_name`; spawn returns the canonical task path as `task_name`.
- `list_agents` returns canonical `agent_name`/agent path and `agent_status`.
- V2 `wait_agent` is targetless, accepts only `timeout_ms`, and returns no child content.
- Final output is `agent_status.completed`, whose value may legally be null (`Completed(None)`).
- `last_task_message` is the latest instruction, not the final response.
- V1 remains a separate namespaced contract: targeted `multi_agent_v1.wait_agent`, then `status[id].completed`.

The current generic `general_purpose` V2 names are unsuitable for role/cardinality correlation. Role identity must be a deterministic lowercase/underscore name derived from the registered dispatch site, while agent type remains independently responsible for routing/instructions.

Ralph can land fail-closed lowering/tests before `codex-v2-copilot-encrypted-subagent-handoff`. That Codex task is required only for successful final installed V2 acceptance. Ralph 5.64.0 is untagged, so update its existing release entry rather than introducing 5.64.1.

### Implementation Suggestions

1. Separate `agentType` from V2 `roleTaskName`. Derive unique task names from stable site IDs, such as `plan_with_ralph_researcher`, while preserving existing model, effort, UI classification, and recipe cardinality.
2. Replace V2 lifecycle prose with:
   - spawn and capture returned canonical `task_name`;
   - call `list_agents` before waiting;
   - match each expected role by exact returned task path;
   - if all are terminal, skip waiting;
   - otherwise call targetless `wait_agent { timeout_ms }`, re-list, and repeat until terminal or timeout;
   - fail on missing/duplicate roles, `completed: null`, errored/shutdown/not-found status, timeout, or empty required output.
3. Keep V1 lowering byte-semantically unchanged.
4. Strengthen existing output contracts: required artifact absence or invalid final output must stop the workflow. Explicitly prohibit parent synthesis, artifact writing, or other inline fallback after child failure.
5. Update dogfood/runner correlation to use V2 `task_name`/`agent_path`, never encrypted `arguments.message`. Assert the exact expected role set, cardinality, per-role model/effort, non-null completion, required artifacts, and successful child lifecycle.
6. Add fixtures for encrypted-message success, already-terminal-before-wait, missing/extra/duplicate roles, `Completed(None)`, null session `last_agent_message`, missing artifacts, and attempted inline fallback.
7. Preserve current exact-route tests: Luna medium, Sol xhigh, Sol medium, Opus high, plus both V1 and V2 generated cardinalities.

Run:

```powershell
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --write
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --check
node plugins/ralph/scripts/check-copilot-parity.mjs
node plugins/ralph/tests/test-codex-generator.mjs
node plugins/ralph/tests/test-model-routing-telemetry.mjs
node plugins/ralph/tests/test-model-routing.mjs
node plugins/ralph/tests/test-regression-smoke-phase-4.mjs
bash plugins/ralph/tests/test-copilot-generator.sh
node tools/validate-codex-marketplace-policy.mjs
node plugins/ralph/tests/run.mjs
```

Final release gates must run the installed skill through Codex V1 and V2. V2 must retain encrypted payloads yet correlate every role through plaintext task paths, skip stale waits for already-terminal children, produce non-null completions and required artifacts, and show no inline fallback. V2 success remains blocked until the Codex runtime prerequisite ships; V1 and all source-level Ralph gates can pass first.



## Consolidated File List

### Files to modify in `ai-developer-toolkit`
- `plugins/ralph/scripts/codex-lowering.mjs`
- `plugins/ralph/tests/test-codex-generator.mjs`
- `plugins/ralph/tests/test-codex-live-smoke.mjs` (static recipe assertions; live execution remains opt-in)
- `plugins/ralph/tests/test-model-routing-telemetry.mjs`
- `plugins/ralph/docs/model-routing-dogfood.md`
- `plugins/ralph/AGENTS.md`
- `plugins/ralph/CHANGELOG.md`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-4/post-migration-caller-surface.txt` only when deterministic recapture proves line drift
- `.claude/skills/release-plugin/SKILL.md` only for the release prerequisite/final V1+V2 gate contract

### Generated files (regenerate, never hand-edit)
- `plugins/ralph/.codex-plugin/codex-skills/brainstorm-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/implement-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/multi-model-investigate/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/plan-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/analyze-iteration/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/review-changes/SKILL.md`

### External installed-runner contract
- `D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\dogfood\run-installed-skill-dogfood.ps1` (mirror the canonical guide after it is authoritative; preserve failed evidence and create a new run summary)

### Reference/test/release surfaces
- `plugins/ralph/scripts/generate-copilot-artifacts.mjs`
- `plugins/ralph/src/model-routing-policy.mjs`
- `plugins/ralph/tests/test-codex-launch-evidence.mjs`
- `plugins/ralph/tests/test-model-routing.mjs`
- `plugins/ralph/tests/test-regression-smoke-phase-4.mjs`
- `plugins/ralph/tests/fixtures/codex-multi-agent-schemas/{0.141-v1.json,0.141-v2.json,0.141-v2-hidden.json}`
- `plugins/ralph/scripts/check-copilot-parity.mjs`
- `tools/validate-codex-marketplace-policy.mjs`
- Six 5.64 version stamps in the three marketplace indexes and three Ralph manifests (verify unchanged unless 5.64.0 becomes immutable before this patch)

### Codex prerequisite reference only (do not modify in Ralph job)
- `external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/{spawn.rs,wait.rs,list_agents.rs}`
- `external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
- `external/repos/codex-patched/codex-rs/core/src/agent/{control.rs,status.rs,control_tests.rs}`
- `external/repos/codex-patched/codex-rs/protocol/src/protocol.rs`

### Evidence limitation / reconciliation
- The Copilot host lane reported it could not directly traverse the sibling candidate/evidence paths and relied on tracked mirrors/current source. Treat its unique-task-name suggestion as advisory only: the primary researcher, architect, and Codex lane verified the current candidate and agree that V2 request `task_name`, spawn-output canonical `task_name`, and child `agent_path` are the structural identity chain. The plan must require exact role names/cardinality without inventing a new naming policy unless candidate tests demonstrate the current names are non-unique.
