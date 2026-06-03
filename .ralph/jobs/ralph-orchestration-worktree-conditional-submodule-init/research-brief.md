# Research Brief — Ralph worktree submodule-init OPT-IN (narrow re-plan)

## Context

Operator pivoted 2026-06-03T11:14 from the D-001 brainstorm direction
(`--no-submodule-init` flag + plan-default-skip + impl-default-init,
codified in the OFF-TARGET 130bbff7 plan with 9 stories + 13 ACs +
F-002 precedence stack + F-003 plan-skill flag + PRD-declared scope) to
a SIMPLER model:

- `runSubmoduleInit()` becomes a NO-OP by default for BOTH plan AND impl
  phases.
- Workers that actually need submodule code run
  `git submodule update --init <path>` themselves on demand.
- Add `--init-submodules` opt-in CLI flag on `worktree-create.mjs` for
  the rare wrapper-only-task case where the worktree-creator wants
  submodules eagerly initialized.
- NO precedence stack, NO PRD-declared scope, NO env-var handling, NO
  `convert-to-ralph-prd` Step 5 wiring, NO plan-with-ralph wiring.
- Drop the inline `git submodule update --init --recursive` block from
  `decompose-plan` Step 5b too (since impl-side parity is the whole
  point of the pivot — there is no longer ANY caller that defaults to
  init).
- Plugin v5.50.0 (sequential after v5.49.0, just shipped today as
  4d92f146 in the toolkit). v5.48 is intentionally skipped per the v5.49
  release note.

The brainstorm artifact at
`.ralph/brainstorms/ralph-orchestration-worktree-conditional-submodule-init/selected-direction.md`
is kept for context, but its directional recommendation (D-001) is
SUPERSEDED. The pivot is documented inline in the new plan.

## Why this re-plan is safe (key risks deferred to "Risk Areas")

The original brainstorm's killer disconfirming observation —
"plan-with-ralph's research/review may grep code inside the submodule
path for context lookup, and defaulting to skip would break planning"
— was reasoned through in the 130bbff7 plan and found NOT to apply:

- plan-with-ralph Phase 2 spawns Explore agents that search
  `<PLAN_WORKTREE>` (the worktree dir, not the submodule subtree as a
  separate input). When the touched code IS inside a submodule (like
  this very task targeting `ai-developer-toolkit/plugins/ralph`), the
  Explore agent still resolves paths under the worktree's submodule
  directory IF the submodule is initialized. With the new default, the
  agent will see an EMPTY submodule directory and have no source to
  search — Phase 2 returns an empty research brief, Phase 3 still
  drafts a plan from the feature description, and Phase 4 review still
  runs against the plan markdown.

The mitigation under the new model is on-demand: when an agent (plan
or impl) needs submodule code, it runs
`git submodule update --init <path>` from inside the worktree. This is
a 1-line user-visible recovery — the failure mode "I can't see the
submodule code" is obvious enough that the worker self-heals.

The 130bbff7 plan's 12-criterion safety net (lock-mtime check, env-var
truthy parsing, precedence-rule precedence stack, AGENTS.md 6-bullet
behavioral section, 4+ new test cases) is GONE under the pivot. The
narrow plan ships ~50 lines + docs + 2 test cases. The trade-off:
significantly less rope to hang ourselves with, at the cost of one
self-healing failure mode (an agent that needs submodule code and
discovers the dir is empty).

## Primary touchpoints

### Code

| File | Lines | Change |
|---|---|---|
| `ai-developer-toolkit/plugins/ralph/src/worktree-create.mjs` | 263-300 + parseArgs + finishResult + reuse-path | Add `--init-submodules` flag to parseArgs (default false); thread `opts.initSubmodules` through `runSubmoduleInit` via the existing reuse-path call site (line 92) and `finishResult` (line 142); early-return `false` from `runSubmoduleInit` when `!opts.initSubmodules` BEFORE any filesystem touch (the `mkdirSync(lockParent, …)` at line 271 must not run on the no-op path); update `helpText` to document the new flag. |
| `ai-developer-toolkit/plugins/ralph/skills/decompose-plan/SKILL.md` | ~197-245 | Delete the entire "After the worktree has been added or validly reused, initialize submodules under the shared cross-process lock …" paragraph + the inline bash block that acquires `~/.cache/ralph-orchestration/submodule-init.lockd` + runs `git submodule update --init --recursive`. Replace with a 1-paragraph note explaining that members needing submodule code run `git submodule update --init <path>` on demand. |
| `ai-developer-toolkit/plugins/ralph/.copilot-plugin/internal-workflows/decompose-plan/SKILL.md` | Mirror | Regenerated via `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --write`. Hand-edit is acceptable if generator drift is tracked elsewhere. |

`convert-to-ralph-prd` Step 5 and `plan-with-ralph` Phase 1B keep their
existing `worktree-create.mjs` invocations — neither needs editing,
because the runSubmoduleInit default is now no-op so omitting
`--init-submodules` produces the desired skip behavior. This is the
load-bearing simplicity of the pivot.

### Tests

| File | Change |
|---|---|
| `ai-developer-toolkit/plugins/ralph/tests/worktree-create.test.mjs` | Add 2 new `node:test` cases: (a) **default no-op** — invoke `createWorktree({ ... })` WITHOUT `initSubmodules`, assert `result.submoduleInitRan === false` and verify (via a spawn-spy or `git` stub) that no `git submodule` subprocess fires; (b) **opt-in init** — invoke with `initSubmodules: true`, assert `result.submoduleInitRan === true` and the subprocess fires. The existing tests at lines 21-37 already assert `submoduleInitRan: true` and will need an additive `initSubmodules: true` in those `createWorktree({ ... })` calls (the test fixture has no submodules so the `git submodule` no-op fast path still returns successfully — but the lock acquisition will run on those test cases, matching v5.46.3 behavior). |
| `ai-developer-toolkit/plugins/ralph/tests/test-submodule-worktree-init.sh` | Update existing behavioral cases to pass `--init-submodules` on the CLI when they expect `submoduleInitRan: true`. Add 1 new CLI-invoked case: default invocation (no flag) returns JSON with `submoduleInitRan: false`, asserts submodule dirs are EMPTY, and asserts the lockfile parent dir is not touched (mtime-stable). This file already has a complete super-repo + submodule fixture set; the new case piggybacks. |

### Docs

| File | Change |
|---|---|
| `ai-developer-toolkit/plugins/ralph/AGENTS.md` | Add a new `## v5.50.0 Behavioral Additions` section above the existing `## v5.49.0` section. 4-6 bullets explaining: (1) the pivot from v5.42.0 unconditional-init; (2) the new `--init-submodules` opt-in flag and its rare-use intent (wrapper-only-task case); (3) the explicit NON-changes (no precedence stack, no env var, no PRD scope, no convert-to-ralph-prd Step 5 wiring, no plan-with-ralph wiring); (4) decompose-plan Step 5b inline-init block removed (parity with worktree-create.mjs no-op default); (5) self-heal contract: workers that need submodule code run `git submodule update --init <path>` from inside their worktree on demand. |
| `ai-developer-toolkit/plugins/ralph/CHANGELOG.md` | Add `## v5.50.0` entry at the top of the file (above the `## v5.49.0` entry already present). Mirror the AGENTS.md bullets in CHANGELOG style — concise but explicit that this PIVOTS the v5.42.0 behavior. |

### Version stamps (5 files, lockstep bump 5.49.0 → 5.50.0)

1. `ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json`
2. `ai-developer-toolkit/plugins/ralph/.github/plugin/plugin.json`
3. `ai-developer-toolkit/.claude-plugin/marketplace.json` (ralph entry)
4. `ai-developer-toolkit/.github/plugin/marketplace.json` (ralph entry)
5. `ai-developer-toolkit/.agents/plugins/marketplace.json` (ralph entry)

## Codexu-side commit

Single commit on a topic branch in codexu:

- Submodule pointer bump (the `ai-developer-toolkit` gitlink → toolkit
  `main` after the lead's FF-merge).
- Codexu root `AGENTS.md` `## Active plugin versions` table — update
  the `ralph (ralph-orchestration)` row from `5.49.0` to `5.50.0`.

Topic branch name: `ralph/plan-worktree-conditional-narrow` (per
operator). The lead handles FF-merge + multi-remote push per the
codexu `AGENTS.md` ask-before-pushing rule and the canonical
`## Multi-repo wrapper-to-submodule ship ceremony` in
`plugins/ralph/AGENTS.md`.

## Naming convention check

- Flag name `--init-submodules` is consistent with other boolean
  opt-in flags in `worktree-create.mjs::parseArgs` (e.g.
  `--allow-existing-branch`). Camel-case opts key:
  `opts.initSubmodules`. Default: `false`.
- The `submoduleInitRan` JSON field name is PRESERVED — no rename. The
  semantic is identical: "did `git submodule update --init --recursive`
  fire on this invocation?" Just defaults to `false` instead of `true`.
- Public test fixture protocol guidance (existing
  `tests/test-submodule-worktree-init.sh` already uses
  `protocol.file.allow=always` at super-repo level) is unchanged.

## Test infrastructure

- `node --test plugins/ralph/tests/worktree-create.test.mjs` — runs
  via the auto-discovery glob in `tests/run.mjs`.
- `bash plugins/ralph/tests/test-submodule-worktree-init.sh` — already
  requires Git Bash / WSL on Windows (per v5.46.0 surviving-bash-tests
  list); no host-shell change.
- `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check`
  must pass after the decompose-plan SKILL.md edit (it auto-discovers
  internal-workflow files and asserts mirror parity).
- `node plugins/ralph/scripts/check-copilot-parity.mjs` must pass
  (covers hand-fork anchors + forbidden Claude-only tokens; the
  decompose-plan internal-workflow is auto-generated so no
  `parity-exceptions.json` entry should be needed unless the generator
  flips the diff for some unrelated reason).

## Out of scope (deferred to follow-ups, not blocking this ship)

- Env-var support (`RALPH_INIT_SUBMODULES=1`) — operator explicitly
  excluded.
- Precedence stack (`--require-submodule-init` impl-side override) —
  operator explicitly excluded.
- PRD-declared `submodulesNeeded` field — operator excluded; D-002 in
  the brainstorm artifacts addresses this if telemetry later motivates
  it.
- Auto-derive submodule scope from plan grep — D-002 territory.
- Self-heal recovery in iteration agent / story-doctor — D-003
  territory.
- Per-spawn timing instrumentation JSONL — D-004 territory.
- Smoke spawn after merge — the lead can run a fresh
  `/plan-with-ralph` against any small fuzzy idea and confirm
  `submoduleInitRan: false` in the staging worktree-result.json. Out
  of scope for this plan to schedule; the lead owns post-ship smoke.

## Consumer impact (non-codexu)

The plugin powers other consumers besides codexu. The new default IS a
behavior change for those consumers — anyone whose flow relied on
`worktree-create.mjs` to populate submodules now needs to either pass
`--init-submodules` or run `git submodule update --init <path>` on
demand. For consumers WITHOUT submodules (no `.gitmodules` file), there
is zero visible change — the prior `git submodule update --init
--recursive` was already a no-op there, and the new path skips the
lock entirely which is an unobservable speedup.

The v5.50.0 CHANGELOG entry must explicitly call out this behavior
change so consumers reading the changelog before upgrading know to
audit their flows.
