# Research Brief: ralph-orchestration-worktree-conditional-submodule-init (D-001)

Seed direction: D-001 — Phase-aware escape hatch (`--no-submodule-init` flag + plan-default-skip) on `worktree-create.mjs`. Source: `.ralph/brainstorms/ralph-orchestration-worktree-conditional-submodule-init/{selected-direction.md,brainstorm-synthesis.md,brainstorm.json}` (shipped 2026-06-03 commit `75043065`).

Four research lenses ran in parallel against the plan worktree (`ralph/plan-ralph-orchestration-worktree-conditional-submodule-init`, forked from `origin/main`): researcher Explore agent, architect Explore agent, Codex CLI at xhigh effort, Copilot CLI at xhigh effort. All four converged on the same shape with a few non-overlapping corrections — notably the decompose-plan Step 5b spawn-site classification.

---

## Researcher Findings

### Primary touchpoint — `ai-developer-toolkit/plugins/ralph/src/worktree-create.mjs`

Ground-truth line refs (verified by direct read in the plan worktree):

| Element | Lines |
|---|---|
| `helpText` constant (CLI usage doc) | 16-40 |
| `main(argv, io)` entry | 42-57 |
| `createWorktree(opts, io)` | 59-126 |
| Reuse-path `runSubmoduleInit(worktreePath, io)` call | 88 |
| `finishResult(...)` (fresh-create path) | 128-140 |
| `finishResult`'s `submoduleInitRan` field | 138 |
| `parseArgs(argv)` | 142-174 |
| `runSubmoduleInit(worktreePath, io)` body | 259-296 |
| `lockParent` derivation (`~/.cache/ralph-orchestration`) | 260-261 |
| `lockDir` derivation (`submodule-init.lockd`) | 262 |
| `mkdirSync(lockParent, { recursive: true })` — first filesystem touch | 267 |
| `mkdirSync(lockDir)` — lock acquisition | 270 |
| `git ["submodule", "update", "--init", "--recursive"]` | 291 |
| Lock cleanup in `finally` | 294 |

Existing env knobs:
- `RALPH_SUBMODULE_LOCK_TIMEOUT_SECONDS` (default `600`) at line 263
- `RALPH_SUBMODULE_LOCK_STALE_SECONDS` (default `300`) at line 264

**No `--no-submodule-init` flag exists today; no `RALPH_NO_SUBMODULE_INIT` env var exists today.**

Critical observation (Codex lens, refined): `submoduleInitRan: true` currently means **"the `git submodule update` command was invoked,"** NOT **"the repo had submodules."** A consumer with no `.gitmodules` still returns `true` because git's no-op fast path is invisible to the caller. The new flag does NOT change this for the unflagged path; consumers without submodules still see the same `true` they get today.

### Existing tests

#### `tests/test-submodule-worktree-init.sh` (bash, ~325 lines)

Source-contract greps (lines ~156-209):
- Asserts plan-with-ralph SKILL.md mentions submodule init in its Phase 1B flow
- Asserts convert-to-ralph-prd Step 5 SKILL.md mentions submodule init
- Asserts decompose-plan Step 5b SKILL.md mentions submodule init
- Asserts Codex mirror at `.copilot-plugin/copilot-skills/plan-with-ralph` mentions it

Behavioral fixture (lines ~242-267):
- Creates a temp super-repo + a temp submodule-origin (file-protocol)
- Adds submodule at `external/test-submodule`
- Launches 8 worktrees in parallel via direct `git worktree add` + direct `git submodule update --init --recursive`
- Asserts each worktree has populated submodule content (status begins with a space, not `-`)

Other scenarios (lines ~269-323):
- No-submodule fast path (consumer repo without `.gitmodules`): runs `git submodule update --init --recursive`, asserts no stderr noise. This is the contract that backs the "no-op on non-codexu consumers" requirement.
- Stale lock recovery
- Missing-PID recovery
- Timeout override (env var honored)

**Important nuance (Codex lens):** This test exercises the inline `git submodule update` flow that lives in skill prose, NOT `worktree-create.mjs` directly. The behavioral fixture launches `git worktree add` itself — it does not invoke `node src/worktree-create.mjs`. So existing tests will continue to pass under D-001 unmodified; new test cases need to invoke the helper specifically.

#### `tests/worktree-create.test.mjs` (`node:test`, 5 tests)

1. Fresh path creates new branch/worktree
2. Existing branch reused with `--allow-existing-branch`
3. Stale worktree path pruned/retried
4. Missing start point falls back to default branch
5. Collisions use numeric suffixes

Invokes the helper via `worktreeCreateMain([...])` directly (no shell-out). **Current tests run against repos without submodules**, so they do not exercise `runSubmoduleInit` behavior end-to-end. Tests for the new flag/env will need to either (a) add fixture super-repo + submodule setup, or (b) assert at the helper level using a stub `runSubmoduleInit` if the helper is refactored to accept an io shim.

### Spawn-site audit

The brainstorm requires per-site assessment, not a blanket flip. Results:

| File | Line(s) | Phase | Default-skip? | Rationale |
|---|---|---|---|---|
| `skills/plan-with-ralph/SKILL.md` Phase 1B | 306-313 | plan | **YES** | Plan-phase worktrees write markdown deliverables; planning research/review never reads submodule code (see "Disconfirming check" below). This is the primary win site. |
| `skills/convert-to-ralph-prd/SKILL.md` Step 5 | ~150-158 | impl | NO | Impl worktree where the iteration agent runs `cargo` / `pnpm` / etc.; preserve v5.42.0 init-all safety. |
| `skills/decompose-plan/SKILL.md` Step 5b | 184-239 | impl | **N/A** | Step 5b uses **inline** `git worktree add` + inline locked submodule init, NOT `worktree-create.mjs`. The brainstorm's "audit decompose-plan" requirement is satisfied: there is nothing to wire here. (Codex + Copilot lenses both flagged this; researcher initially mis-classified it as a worktree-create.mjs callsite.) |
| `.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md` | (auto-generated mirror of plan-with-ralph) | plan | **YES** | Regenerated via `scripts/generate-copilot-artifacts.mjs --write` once the source mirror flips. |
| `.copilot-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md` | (auto-generated mirror) | impl | NO | Mirror of unchanged source. |
| `.copilot-plugin/internal-workflows/decompose-plan/SKILL.md` | (auto-generated mirror) | impl | **N/A** | Mirror of unchanged source. |
| `src/*.mjs` (recursive grep) | — | — | — | No other `worktree-create.mjs` callers in production code. |

**Test files referencing the helper:** `tests/worktree-create.test.mjs` and any new tests added under D-001 — these invoke it directly without phase semantics; they do NOT default-skip, they explicitly test both modes.

### Disconfirming check (Devil's Advocate's killing case)

The brainstorm's most-load-bearing assumption: plan-phase workers never need to read code inside the `ai-developer-toolkit/` or `codex/` submodule paths. If they do, defaulting plan worktrees to `--no-submodule-init` breaks planning.

Searched `plan-with-ralph/SKILL.md` for evidence of submodule-tree reads:
- Phase 2 research only invokes `codex-exec.mjs` / `copilot-exec.mjs` (lines 369-374, 385-390) with the feature-request body as input. The Explore agents (`researcher`, `architect`) are told to search `<PLAN_WORKTREE>` (lines 335-346), but the search target is the FEATURE'S touchpoint files — NOT submodule trees specifically.
- Phase 4 review uses `review-plan-initial.md` + review-loop against the draft plan (lines 618-659) — no submodule-tree reads.
- `--improve` flows read the existing plan and revise; no submodule code reads.

**Verdict: no evidence that planning needs initialized submodules.** The brainstorm's disconfirming-observation risk is real (a planning task ABOUT submodule code would still want to read it), but the v5.48.0 plan must include criteria 12 of the brainstorm — a post-ship smoke spawn that proves at least one representative plan completes its research/review phases without referencing missing submodule code.

The escape valve for "this plan-phase actually needs submodule content" is identical to the operator override: pass `--init-submodules <list>` (if shipped as part of the two-flag shape) or simply do not pass `--no-submodule-init` for that specific spawn. The default-skip wire-up is a default, not a lock.

### Copilot mirror parity

Source files that will need regeneration:
- `ai-developer-toolkit/plugins/ralph/.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md`
- `ai-developer-toolkit/plugins/ralph/.copilot-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md`
- `ai-developer-toolkit/plugins/ralph/.copilot-plugin/internal-workflows/decompose-plan/SKILL.md` (no behavior change; only AGENTS.md addition may touch it)

Generation + parity gate:
- Regenerate: `node ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs --write`
- Gate: `node ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs --check && node ai-developer-toolkit/plugins/ralph/scripts/check-copilot-parity.mjs`

### Plugin version + manifests (5 stamp locations)

Current version is `5.47.0` across all 5 locations (per researcher + Codex + Copilot lens consensus). The brainstorm scope says "next available — suggested v5.47.0"; that's stale. The correct bump is **v5.48.0**:

| File | Current | Target |
|---|---|---|
| `ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json` | `5.47.0` | `5.48.0` |
| `ai-developer-toolkit/plugins/ralph/.github/plugin/plugin.json` | `5.47.0` | `5.48.0` |
| `ai-developer-toolkit/.claude-plugin/marketplace.json` (plugin entry) | `5.47.0` | `5.48.0` |
| `ai-developer-toolkit/.github/plugin/marketplace.json` (plugin entry) | `5.47.0` | `5.48.0` |
| `ai-developer-toolkit/.agents/plugins/marketplace.json` (plugin entry) | `5.47.0` | `5.48.0` |

### AGENTS.md style

Reference: `ai-developer-toolkit/plugins/ralph/AGENTS.md` `## v5.42.0 Behavioral Additions` (the section that introduced the unconditional-init contract D-001 relaxes). Style: short prose bullets, explicit "what changed," "env knobs," "test gate," "release reminder." The v5.48.0 section must reference v5.42.0 explicitly to document why plan-phase is the safe relaxation surface.

---

## Architect Analysis

### Integration points

`runSubmoduleInit()` has two callers in `createWorktree()`:
1. **Reuse path** (line 88): `submoduleInitRan: runSubmoduleInit(worktreePath, io)` inside the result object literal when an existing valid worktree is detected.
2. **Fresh-create path** (line 138, via `finishResult`): same shape, called after `git worktree add` succeeds.

Both call sites must observe the skip — passing `opts` through. The current signature `runSubmoduleInit(worktreePath, io)` needs to become `runSubmoduleInit(worktreePath, io, opts)`, and both callers need to thread `opts` down.

### CLI flag schema design — recommendation: **two-flag forward-compatible shape, but ship ONLY `--no-submodule-init` in D-001**

The architect lens and the brainstorm both flagged the open question: single boolean vs single mode-enum vs two-flag composable shape. For D-001 specifically:

- **Ship now:** `--no-submodule-init` (boolean, default `false`) + `RALPH_NO_SUBMODULE_INIT` env var.
- **Do NOT ship now:** `--init-submodules <list>` is deferred to D-002; do not stub a `--submodule-init=mode` flag.
- **Forward-compat hook:** the new boolean is *additive* in `parseArgs` — adding `--init-submodules <list>` later requires only a new case in the switch and no semantic change to `--no-submodule-init`. The two-flag composition (operator passes both: `--no-submodule-init --init-submodules codex` could mean "skip by default but init this specific one") is a future concern; for D-001 the criteria only require the binary skip.

Rationale: ship the minimum to gather telemetry per the brainstorm's staged-rollout argument. Don't grow a multi-mode CLI before there's evidence it pays for itself.

### Env-var precedence + truthy parsing — recommendation: **CLI > env > default**, helper-centralized parse

```js
function parseTruthyEnv(value) {
  if (value == null) return false;
  return /^(1|true|yes)$/i.test(String(value).trim());
}

function shouldSkipSubmoduleInit(opts, env = process.env) {
  if (opts.noSubmoduleInit) return true;
  return parseTruthyEnv(env.RALPH_NO_SUBMODULE_INIT);
}
```

Behavior:
- Truthy env values (`1`, `true`, `yes`, case-insensitive after trim): skip if no CLI override.
- Falsy or absent (`0`, `false`, `no`, empty string, undefined): preserve default init.
- CLI flag wins over env: even `RALPH_NO_SUBMODULE_INIT=0` does NOT override a passed `--no-submodule-init` (CLI is more specific). (But the brainstorm criteria don't actually test the negative-override case; CLI-wins is enough.)

### Skip-without-lock semantics

Critical constraint from brainstorm Criterion 1: "no `~/.cache/ralph-orchestration/submodule-init.lockd` was created during this invocation (asserted by mtime check on the lock-parent dir before/after)."

The lock-parent dir (`~/.cache/ralph-orchestration`) is created by `mkdirSync(lockParent, { recursive: true })` at line 267 — **the very first filesystem write in `runSubmoduleInit()`**. The skip early-return MUST happen before line 267. Recommended placement: at the very top of `runSubmoduleInit`, before any path derivation that would be observable.

Implementation skeleton:

```js
function runSubmoduleInit(worktreePath, io, opts = {}) {
  if (shouldSkipSubmoduleInit(opts)) {
    io.stderr.write(`Skipping submodule init for ${normalizePath(worktreePath)} (--no-submodule-init or RALPH_NO_SUBMODULE_INIT)\n`);
    return false;
  }
  // ... existing body unchanged starting at current line 260
}
```

### Spawn-site wire-up strategy

Per the brainstorm, each callsite gets a per-site decision (skip vs preserve). The only production callsite that flips today is **plan-with-ralph Phase 1B**. The codexu `bin/ralph-overview.mjs` wrapper does not call worktree-create.mjs. There are no other plan-phase production callsites in the plugin source.

The plan should explicitly list every callsite in a table for the impl member to verify; criteria require this audit.

### Test gate design

3 new positive cases + 1 regression case minimum, in BOTH test files:

| Case | Setup | Assertion |
|---|---|---|
| flag-only | invoke with `--no-submodule-init` (no env) | exit 0; `submoduleInitRan: false`; lock-parent mtime unchanged; submodule status begins with `-` |
| env-only | invoke without flag; set `RALPH_NO_SUBMODULE_INIT=1` (case variants: `True`, `YES`, `yes`) | same as flag-only |
| flag + env | both signals set | same as flag-only (both produce same outcome) |
| default-unchanged regression | invoke without flag, no env, repo has submodules | exit 0; `submoduleInitRan: true`; lock acquired+released; submodule populated (status begins with space) |

**Architect recommendation: independent bash/node fixture setup.** The two test layers exercise different boundaries (bash exercises CLI subprocess + sh interaction; node exercises function-level behavior). Sharing fixtures couples them artificially. Each test file builds its own super-repo + submodule-origin in a tempdir.

**Windows note:** The bash test requires Git Bash on Windows (it's in the surviving-bash-test list per v5.46.0 contract). Node test is the cross-platform coverage. For local file-protocol submodules, both test files need `git -c protocol.file.allow=always` (Codex lens flagged this).

**Env isolation:** Node tests MUST clear `RALPH_NO_SUBMODULE_INIT` before each case (a developer's shell may have it set), and the helper should accept an explicit `env` parameter so tests can pass a controlled bag.

### Two-commit submodule pattern

Per codexu AGENTS.md "Worktree placement convention" and the brainstorm's Criterion 11:

1. **Toolkit commit** (inside `ai-developer-toolkit/`): all `worktree-create.mjs` changes, test additions, SKILL.md edits (Claude source + Copilot mirrors), AGENTS.md addition, and 5-stamp version bump to v5.48.0. Push to `origin`, `personal`, AND `gim-home` (marketplace consumers fetch from `gim-home`).
2. **Codexu parent commit**: submodule pointer bump only (`git add ai-developer-toolkit && git commit`), plus the version-table refresh in codexu's root `AGENTS.md` (the `## Active plugin versions` block has a `ralph (ralph-orchestration)` row that needs the v5.48.0 stamp).

This is the standard fork submodule pattern (codexu AGENTS.md "Submodule edits require two commits" + "Update active plugin versions table"). The impl member MUST keep them split.

### Risk areas / disconfirming observation

| Risk | Severity | Mitigation in plan |
|---|---|---|
| Plan-phase actually needs submodule content for research | Medium | Criterion 12 smoke spawn validates against at least one representative case post-ship. Operator can omit the flag for known-needs-submodule planning tasks. |
| Operator forgets manual flag for narrow impl spawn → no savings | Low | Out of scope for D-001 (explicit). D-002 future work covers the operator-forgetting failure mode via PRD-declared scope. |
| Worktree-reuse branch semantically diverges | Medium-Low | Both callers receive `opts`; both observe the skip. Test gate covers both paths. |
| `parseTruthyEnv` regex misclassifies edge cases | Low | Whitelist of `1|true|yes` is conservative; anything else is "do not skip". |
| Lock-skip means new code path that bypasses error reporting | Low | The skip path writes a single stderr line so spawn-prompt forensics show that the skip happened. |
| `submoduleInitRan: false` is observed by some downstream consumer that interprets it as "init failed" | Low | The field name is unambiguous and the brainstorm's Criterion 1 explicitly sets the semantic. No consumer in the current codebase reads this field beyond test assertions. |

### Non-codexu-consumer no-op contract

Verified against `tests/test-submodule-worktree-init.sh` lines 269-276: a consumer repo without `.gitmodules` runs `git submodule update --init --recursive` as a no-op (no stderr noise, success exit). The new flag layer wraps that — when neither flag nor env is set, behavior is byte-identical to v5.46.0 for non-codexu consumers. **Constraint met.**

---

## Codex Research (gpt-5.5, xhigh)

Full output at `<STAGING>/codex-research.txt`. Key contributions not already captured above:

- **Plugin version is already 5.47.0**, so next bump is **5.48.0** (correcting brainstorm's v5.4X.0 placeholder).
- **`submoduleInitRan: true` means "command was invoked"**, not "repo had submodules". Critical semantic clarification.
- **`decompose-plan` Step 5b uses inline `git worktree add`** + inline locked submodule init, NOT `worktree-create.mjs`. The brainstorm scope item "Codexu-relevant plan-worktree paths in `skills/decompose-plan/SKILL.md`" reduces to "verify there is nothing to wire" — and the answer is confirmed: nothing to wire.
- **Local file-protocol submodules need `protocol.file.allow=always`** for `git submodule update` to work in tests; this is a real footgun.
- **Refactor `runSubmoduleInit` signature to accept `opts`** so both callers thread it through cleanly. Avoid module-global state.
- **Run parity commands from `ai-developer-toolkit` working dir**, because `plugins/ralph/scripts/...` paths are toolkit-root relative.

---

## Copilot Research (claude-opus equivalent via copilot-exec, xhigh)

Full output at `<STAGING>/copilot-research.txt`. Reinforces the Codex findings; key complementary points:

- **Node test env isolation**: `process.env.RALPH_NO_SUBMODULE_INIT` must be cleared per-test or a developer's shell var leaks into the baseline test and breaks it.
- **CLI flag listing in `helpText`**: `--no-submodule-init` must appear in the helpText block (lines 16-40) so `--help` documents it.
- **`shouldSkipSubmoduleInit(opts, env = process.env)`** signature explicitly accepts env for testability.
- **AGENTS.md style match**: v5.48.0 Behavioral Additions should follow v5.42.0's bullet format exactly.
- **Marketplace indexes must stay synchronized** across Claude, Copilot, AND Codex layouts — confirms researcher's 5-stamp count.

---

## Consolidated File List

### Files to modify (toolkit-side)

- `ai-developer-toolkit/plugins/ralph/src/worktree-create.mjs` — add flag to `parseArgs`, helper `shouldSkipSubmoduleInit(opts, env)`, thread `opts` into `runSubmoduleInit`, short-circuit before line 267, update `helpText` (lines 16-40), update success-JSON shape doc in helpText
- `ai-developer-toolkit/plugins/ralph/skills/plan-with-ralph/SKILL.md` — Phase 1B (lines 306-313): add `--no-submodule-init \` to the `worktree-create.mjs` invocation; update prose around line 323 that currently says "initializes submodules under the shared Ralph lock"
- `ai-developer-toolkit/plugins/ralph/.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md` — regenerated mirror (no hand edit)
- `ai-developer-toolkit/plugins/ralph/tests/worktree-create.test.mjs` — 4 new test cases (flag-only, env-only, flag+env, default regression)
- `ai-developer-toolkit/plugins/ralph/tests/test-submodule-worktree-init.sh` — 4 new behavioral cases invoking `node src/worktree-create.mjs` against a fixture repo with a declared submodule
- `ai-developer-toolkit/plugins/ralph/AGENTS.md` — new `## v5.48.0 Behavioral Additions` section
- `ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json` — bump `version` to `5.48.0`
- `ai-developer-toolkit/plugins/ralph/.github/plugin/plugin.json` — bump `version` to `5.48.0`
- `ai-developer-toolkit/.claude-plugin/marketplace.json` — bump ralph entry `version` to `5.48.0`
- `ai-developer-toolkit/.github/plugin/marketplace.json` — bump ralph entry `version` to `5.48.0`
- `ai-developer-toolkit/.agents/plugins/marketplace.json` — bump ralph entry `version` to `5.48.0`

### Files to modify (codexu-side, second commit)

- `ai-developer-toolkit` submodule pointer bump
- Codexu root `AGENTS.md` — update `## Active plugin versions` table entry for `ralph (ralph-orchestration)` from `5.47.0` to `5.48.0`

### Files NOT to modify

- `ai-developer-toolkit/plugins/ralph/skills/convert-to-ralph-prd/SKILL.md` (impl-phase, preserve init-all)
- `ai-developer-toolkit/plugins/ralph/skills/decompose-plan/SKILL.md` (uses inline `git worktree add`, not the helper)
- `.copilot-plugin/internal-workflows/{convert-to-ralph-prd,decompose-plan}/SKILL.md` (no source change → no regen change for these files; only the plan-with-ralph mirror flips)

### Test commands

- `node --test ai-developer-toolkit/plugins/ralph/tests/worktree-create.test.mjs`
- `bash ai-developer-toolkit/plugins/ralph/tests/test-submodule-worktree-init.sh` (Git Bash on Windows)
- `node ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs --check`
- `node ai-developer-toolkit/plugins/ralph/scripts/check-copilot-parity.mjs`
- Post-ship smoke (Criterion 12): spawn one codexu plan-phase crew member via `/plan-with-ralph` on a small fuzzy idea; observe `worktree-create.mjs` returned `submoduleInitRan: false` and the plan completes without missing-submodule errors.
