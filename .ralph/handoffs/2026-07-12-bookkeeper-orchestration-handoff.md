# Bookkeeper / Orchestration Handoff - 2026-07-12

> Fresh lead: read `D:\harness-efforts\codexu\AGENTS.md` first, then this
> document. The operator explicitly wants **direct Task sub-agents**, not Crews
> plugin members, for the work described here.

## 1. Where we are right now

| Surface | Current state |
|---|---|
| codexu `main` | `127320c4bd75a76fe02a45ae98c471a3451c962a`; `origin/main` and `personal/main` match |
| Parent checkout | Heavily dirty from unrelated concurrent work: overview projections/data, task journals, plans, and submodule state. Do not stage, revert, or overwrite it wholesale. This handoff is intentionally uncommitted. |
| Ralph 5.64 toolkit candidate | Worktree `D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\ralph-model-routing-v564-hybrid`, branch `ralph/ralph-model-routing-v564-hybrid`, still based at `964c36f7`; 168 staged/unstaged/untracked entries and no implementation commit yet |
| Codex build-tier candidate | Worktree `D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m`, branch `ralph/codex-rs-core-change-incremental-build-over-30m`, clean at `d4398384ac8c4168ce494abdeacd1c77e4a53d0d` |
| Standalone routing plugin | Reviewed plan merged to codexu as `c8e9df142`; task is plan-ready but implementation is deliberately serialized behind Ralph 5.64 |
| Node-free Happy | J5 app/wire compatibility shipped as `e49e8237d`; umbrella task remains tracked because Codex J2/J3/J4/J6/J7 remain |
| Background agents | None. The PC restart cancelled the direct recovery agents; their filesystem work survived. |

Recent codexu commits:

- `127320c4b` `chore(overview): advance standalone routing policy`
- `c8e9df142` `plan: subagent-model-routing-policy-parity-v1.1`
- `733af26db` `chore(overview): advance Codex build-speed task`
- `9bc47cfae` `docs(plan): define codex core build verification tiers`
- `a950baf22` `chore(overview): record native Happy app compatibility ship`
- `e49e8237d` `feat: add native local Happy app compatibility`
- `954f6eb4e` `chore(overview): seed routing convergence work`
- `4cc121a83` `docs(plan): converge Ralph 5.64 model routing`

## 2. The problem in detail

The operator is advancing four connected workstreams:

1. **Ralph 5.64 exact model routing.** Every executable unit must route from
   structured purpose plus durable `uiUxJudgment`, with no prompt/file/UI-
   acceptance heuristics. The reviewed mapping is Luna medium for exploration,
   Sol xhigh for planning/research/review/orchestration, Sol medium for non-UI
   implementation/fix/update/refactor, and Opus 4.8 high for any executable
   unit requiring UI/UX judgment
   (`D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\plan.md:6-28`).

2. **Independent ordinary-subagent guidance.** The standalone
   `subagent-model-routing` plugin must express the same semantic mapping for
   ordinary Copilot `task(...)` and Codex `spawn_agent` children, but remain an
   advisory, fail-open SessionStart plugin with no Ralph dependency or PRD
   runtime
   (`D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\plan.md:6-21`).

3. **Codex verification latency.** The original "30+ minute verification"
   symptom is actually a warm optimized executable rebuild. Measured check
   tiers are much faster: 37.45s targeted core edit, 338.829s workspace check,
   versus about 31 minutes for a runnable build
   (`D:\harness-efforts\codexu\.ralph\jobs\codex-rs-core-change-incremental-build-over-30m\plan.md:11-29`).
   The implementation operationalizes those tiers rather than changing Cargo
   profiles or upstream Rust source.

4. **Node-free live Codex + Happy control.** The end goal is one live Codex TUI
   and the existing Happy web/app renderer controlling the same session with no
   `happy-cli` or Node happy-server runtime. P0 and J5 are done; the remaining
   Codex jobs are serialized J2 -> J3 -> J4 -> J6, then J7 owns final dogfood
   and the one codexu gitlink integration
   (`D:\harness-efforts\codexu\.ralph\jobs\codex-native-happy-server-local-web-dual-control\plan.md:91-128`).

Why this matters: the current state contains valuable unmerged work in two
isolated worktrees. Treating either as complete, resetting either, or starting
the standalone plugin in parallel with Ralph would lose work or create release
conflicts.

## 3. Prior investigation and plan artifacts

- `D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\plan.md` - reviewed seven-story Ralph 5.64 semantic port plan.
- `D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\stories-outline.md` - exact story decomposition.
- `D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\plan-review.md` - 17 resolved plan-review findings.
- `D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\plan.md` - reviewed five-story standalone plugin plan.
- `D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\plan-review.md` - first review.
- `D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\plan-review-rereview.md` - clean re-review after three Medium fixes.
- `D:\harness-efforts\codexu\.ralph\brainstorms\codex-rs-core-change-incremental-build-over-30m\measurements.json` - original empirical build matrix.
- `D:\harness-efforts\codexu\.ralph\jobs\codex-rs-core-change-incremental-build-over-30m\plan.md` - reviewed six-story tiered-verifier plan.
- `D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\docs\implementation\build-perf-artifacts\` - current branch tests and live measurement evidence.
- `D:\harness-efforts\codexu\.ralph\jobs\codex-native-happy-server-local-web-dual-control\plan.md` - eight-job Node-free production plan.
- `D:\harness-efforts\codexu\.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\app-compat.json` - J5 production acceptance evidence.

## 4. Detailed findings with file:line evidence

### 4.1 Ralph 5.64 candidate is substantial but not committed

The toolkit worktree has 125 tracked files changed in the current diff
(approximately 9,278 insertions / 3,353 deletions) plus generated/untracked
files. The six Ralph version stamps already read `5.64.0`, but this is still a
working-tree candidate, not a release commit.

The implementation plan requires:

- seven stories in strict serial order
  (`D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\plan.md:487-499`);
- exact behavioral, no-heuristic, generation, historical-compatibility, and
  six-stamp tests
  (`D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\plan.md:501-593`);
- clean Phase 5a and 5b convergence before release
  (`D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\plan.md:607-622`).

The generic plugin boundary is load-bearing: no task-authored edits, imports,
generation, or test dependency under `plugins/subagent-model-routing/**`
(`D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\plan.md:484-485`,
`:574-579`). The current preservation check showed no diff under
`plugins/subagent-model-routing`, `plugins/crews`, or
`plugins/ralph-overview`; re-run it before committing.

The in-progress installed-host dogfood guide correctly requires real Copilot
and Codex telemetry rather than source argv/prose
(`D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\ralph-model-routing-v564-hybrid\plugins\ralph\docs\model-routing-dogfood.md:1-8`,
`:126-129`). Before release, verify its Copilot event-correlation block against
the actual event schema: it mixes `.data.toolCallId` / `.data.model` access
with `$started[0].agentId`
(`D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\ralph-model-routing-v564-hybrid\plugins\ralph\docs\model-routing-dogfood.md:407-435`).
Do not assume this block is correct without a real transcript.

### 4.2 Standalone routing plugin is planned, not implemented

The plugin must remain:

- advisory and parent-model-neutral
  (`D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\plan.md:8-21`);
- independent of Ralph, with no enforcement gate or cross-plugin reference
  (`D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\plan.md:256-285`);
- fail-open for malformed SessionStart input
  (`D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\plan.md:304-305`,
  `:340-342`);
- released as v1.1.0 across its five real stamps, without inventing a Claude
  runtime manifest
  (`D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\plan.md:343-351`).

All five stories share the same policy, snapshots, docs, and marketplace
indexes, so the plan explicitly requires one serial implementation job
(`D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\plan.md:364-399`).
Do not start it until Ralph 5.64 has landed and a fresh worktree can branch from
post-5.64 toolkit main.

### 4.3 Codex build-tier branch is clean but one acceptance probe is red

The clean topic branch contains the implementation from `51d144da96` through
`d4398384ac`. The latest focused commits are:

- `864aaea57e` - review convergence across commands, scripts, tests, and docs.
- `d4398384ac` - keep repeated measurement probes Cargo-fresh.

Live evidence at the current branch:

- targeted core edit: **43.462s**, threshold 120s, pass; probe restored clean
  (`D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\docs\implementation\build-perf-artifacts\final5-targeted-core-edit.json:1`);
- high-fanout workspace edit: **131.889s**, threshold 600s, pass; outer and
  nested repositories restored clean
  (`D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\docs\implementation\build-perf-artifacts\final5-workspace-high-edit.json:1`);
- final no-op targeted probe: **32.791s**, threshold 30s, **fail**
  (`D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\docs\implementation\build-perf-artifacts\final7-targeted-noop.json:1`).

Therefore do **not** mark the task shipped yet. A direct Sol xhigh recovery
agent must decide whether the 30-second no-op criterion needs a code fix, a
reproducible environment explanation plus reviewed threshold correction, or a
fresh valid rerun. It must not silently ignore the miss.

The focused Node suite passed 12/12
(`D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\docs\implementation\build-perf-artifacts\phase5a-node-tests.out:1-70`),
and the sccache path fixture passed
(`D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\docs\implementation\build-perf-artifacts\phase5a-shell-tests.out:1-10`).
The implementation plan forbids re-running 31-minute T3 or 58-minute T4 merely
to test dispatch
(`D:\harness-efforts\codexu\.ralph\jobs\codex-rs-core-change-incremental-build-over-30m\plan.md:649-652`).

After final acceptance, lead-owned closeout is Codex FF/push, parent gitlink
bump, overview bookkeeping, and archival of the stale unconditional cache-wipe
task
(`D:\harness-efforts\codexu\.ralph\jobs\codex-rs-core-change-incremental-build-over-30m\plan.md:697-725`).

### 4.4 Node-free Happy sequencing is already decided

The plan assigns separate repository-owned jobs and forbids intermediate
codexu gitlink updates:

- J2 authoritative request-disposition seam;
- J3 Rust server foundation;
- J4 native lifecycle/codec/identity/shutdown;
- J5 app/wire compatibility - already shipped;
- J6 dual-control arbitration and streaming;
- J7 final dogfood, evidence, docs, and the only parent gitlink integration.

The topology and dependencies are explicit
(`D:\harness-efforts\codexu\.ralph\jobs\codex-native-happy-server-local-web-dual-control\plan.md:91-128`).
The umbrella definition of done requires all eight jobs, Phase 5a/5b, P2
evidence, and proof that no happy-cli/Node happy-server process owns the plane
(`D:\harness-efforts\codexu\.ralph\jobs\codex-native-happy-server-local-web-dual-control\plan.md:1598-1600`).

## 5. Things to NOT do

1. **Do not use Crews members.** The operator explicitly corrected this:
   orchestration in this handoff uses direct `task(...)` sub-agents.
2. **Do not reset or clean the Ralph worktree.** Its 168 entries are the only
   surviving implementation state after the restart.
3. **Do not merge local toolkit `main` (`267e7cd7`) wholesale.** Ralph 5.64 was
   intentionally based on released remote `964c36f7`; the older local 5.63
   implementation had 50+ conflicts and is reference-only.
4. **Do not start standalone routing v1.1 in parallel with Ralph.** They share
   root AGENTS/marketplace/release surfaces.
5. **Do not claim Codex build tiers are green while the no-op evidence is
   32.791s against a 30s threshold.**
6. **Do not run T3/T4 to validate dispatcher behavior.** Use plan JSON and the
   committed slow-tier evidence.
7. **Do not edit or stage the current parent checkout broadly.** It contains
   unrelated concurrent changes. Never use `git add -A`.
8. **Do not mark an overview task merged before its implementation and parent
   integration are on the required remotes.**
9. **Do not conflate a UI acceptance surface with UI/UX work.** Architecture,
   protocol, server, runtime, build, and test work remain Sol unless the work
   itself requires UI/UX judgment.

## 6. Decision framework

| Decision | Recommended choice | Reason |
|---|---|---|
| Which implementation to recover first? | Ralph 5.64 | It has uncommitted state and blocks standalone routing v1.1. |
| Can Codex build tiers ship immediately? | No | Clean branch, but final no-op budget is red. Run a focused final recovery/review first. |
| How to publish Ralph with divergent local toolkit main? | Use a clean publication worktree/branch from `origin/main`, FF the reviewed topic commit, run installed-host dogfood, then push mandatory remotes | Avoids mixing local `267e7cd7` into the release. |
| When to implement standalone routing v1.1? | After Ralph 5.64 lands | Shared marketplace/root-doc release surfaces must serialize. |
| What Node-free job follows J5? | J2, then J3/J4/J6 serially | The plan freezes this dependency chain; J7 integrates only the final Codex SHA. |

## 7. Recommended sequencing

1. **Recover Ralph 5.64 with one direct sub-agent.**
   - Model: `gpt-5.6-sol`, reasoning effort `xhigh`.
   - Point it at
     `D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\ralph-model-routing-v564-hybrid`.
   - Instruct it to preserve the existing diff, inspect every staged/unstaged
     entry, remove only proven scratch output, finish tests/generation, resolve
     the dogfood event-schema question, run Phase 5a/5b, and commit locally.
   - Nested implementation/fixer/docs work follows the reviewed route:
     non-UI implementation Sol medium; planning/review Sol xhigh; UI judgment
     Opus high.

2. **Run a final direct review of the committed Ralph candidate.**
   - Confirm all six stamps are 5.64.0.
   - Run the exact commands at
     `D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\plan.md:583-593`.
   - Confirm zero diff under Crews, Overview, and standalone routing.

3. **Publish Ralph through a clean toolkit publication worktree.**
   - Do not merge through divergent local toolkit `main`.
   - FF the candidate from remote base, stage the exact committed candidate into
     installed Copilot/Codex roots, and execute
     `plugins\ralph\docs\model-routing-dogfood.md`.
   - `origin` and `gim-home` are mandatory; record any known `personal`
     repository-not-found failure.
   - Update codexu's toolkit gitlink and active-plugin-version table together
     only after installed telemetry passes.

4. **Implement standalone routing v1.1 with one fresh direct sub-agent.**
   - Branch from post-Ralph toolkit main.
   - Model: Sol xhigh for orchestration/review, Sol medium for implementation.
   - Use the five-story plan; keep the plugin independent and fail-open.
   - Release 1.1.0 only after its installed Copilot/Codex SessionStart dogfood.

5. **Close the Codex build-tier acceptance gap.**
   - Spawn one direct Sol xhigh recovery/review agent on the existing clean
     branch.
   - Diagnose the 32.791s no-op miss without rerunning T3/T4.
   - Require explicit reviewed disposition and clean Phase 5a/5b evidence.

6. **Ship Codex build tiers.**
   - FF the wrapper branch to Codex main and push all configured Codex remotes.
   - Because codexu primary is dirty, coordinate before the parent gitlink
     commit; prefer a clean isolated parent worktree and never overwrite the
     current dirty state.
   - Update the codexu gitlink, mark the task shipped, and archive
     `build-env-sccache-cache-wipe-and-rewarm` with the measured healthy-cache
     explanation.

7. **Resume Node-free Happy production.**
   - File/spawn J2 first; then J3, J4, J6, J7 in the reviewed sequence.
   - Keep Codex jobs serialized. J7 is the sole final codexu gitlink owner.

## 8. Open questions

1. Does the Copilot JSON event schema expose `agentId` at the event root or
   under `data`? The Ralph dogfood script must be validated against an actual
   transcript before release.
2. Why do repeated true no-op targeted checks remain slightly above 30 seconds
   while the original benchmark was 6.254 seconds? Is the fixed Cargo-fresh
   behavior intentionally doing extra work, or is there another avoidable
   overhead?
3. Which unrelated agent owns the current dirty codexu overview/task-journal
   changes, and when can the parent main checkout safely fast-forward after
   submodule ships?
4. Should the stale `initialStage: brainstorming` on the Ralph overview row be
   corrected when implementation ships? Lifecycle remains authoritative, but
   the phase label is visibly stale.
5. After Ralph 5.64 publication, should the old divergent toolkit worktree for
   commit `267e7cd7` be retained as historical reference or removed after
   verifying every selected semantic port?

## 9. Files referenced

### Canonical orchestration guidance

- `D:\harness-efforts\codexu\AGENTS.md` - bookkeeper, worktree, push, and direct
  sub-agent routing rules.

### Ralph 5.64

- `D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\plan.md`
- `D:\harness-efforts\codexu\.ralph\jobs\ralph-model-routing-ui-opus48-nonui-gpt56sol\stories-outline.md`
- `D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\ralph-model-routing-v564-hybrid\plugins\ralph\src\model-routing-policy.mjs`
- `D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\ralph-model-routing-v564-hybrid\plugins\ralph\docs\model-routing-dogfood.md`
- `D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\ralph-model-routing-v564-hybrid\plugins\ralph\AGENTS.md`

### Standalone ordinary-subagent routing

- `D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\plan.md`
- `D:\harness-efforts\codexu\.ralph\jobs\subagent-model-routing-policy-parity-v1.1\stories-outline.md`
- `D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\ralph-model-routing-v564-hybrid\plugins\subagent-model-routing\hooks\model-routing-policy.js`

### Codex build tiers

- `D:\harness-efforts\codexu\.ralph\jobs\codex-rs-core-change-incremental-build-over-30m\plan.md`
- `D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\scripts\verify-core-change.mjs`
- `D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\scripts\measure-build.ps1`
- `D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\docs\implementation\build-perf-baseline.json`
- `D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\docs\implementation\build-perf-artifacts\final5-targeted-core-edit.json`
- `D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\docs\implementation\build-perf-artifacts\final5-workspace-high-edit.json`
- `D:\harness-efforts\codexu\codex\.worktrees\codex-rs-core-change-incremental-build-over-30m\docs\implementation\build-perf-artifacts\final7-targeted-noop.json`

### Node-free Happy

- `D:\harness-efforts\codexu\.ralph\jobs\codex-native-happy-server-local-web-dual-control\plan.md`
- `D:\harness-efforts\codexu\.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\app-compat.json`
- `D:\harness-efforts\codexu\packages\happy-wire\src\localDeviceAuth.ts`
- `D:\harness-efforts\codexu\packages\happy-app\sources\sync\sessionOutputSnapshot.ts`

## 10. Constraints - do not violate

- Use direct Task sub-agents, not Crews members.
- Explicitly pass the model and reasoning effort:
  - exploration: `gpt-5.6-luna`, medium;
  - research: `gpt-5.6-sol`, xhigh;
  - orchestration: `gpt-5.6-sol`, xhigh;
  - non-UI design: `gpt-5.6-sol`, xhigh;
  - non-UI implementation: `gpt-5.6-sol`, medium;
  - UI implementation/design: `claude-opus-4.8`, high.
- Never substitute another named model silently.
- Preserve the current dirty parent checkout and the dirty Ralph worktree.
- Save expensive test output once and inspect the saved file; do not repeatedly
  rerun long suites.
- Use Git Bash explicitly for shell tests on Windows.
- Never push/tag/install from implementation sub-agents; publication is
  lead-owned.
- Push mandatory remotes in lockstep and verify remote heads.
- Never hand-edit generated overview sidecars.
- Use id-scoped overview tools/helpers and stage overview shards explicitly.
- Node-free Happy remains no-`happy-cli`, no Node happy-server runtime, default
  off, and per-daemon rather than central multi-tenant architecture.

## 11. Recommended single next action

Spawn one **direct** `general-purpose` Task agent with
`model="gpt-5.6-sol"` and `reasoning_effort="xhigh"` to recover the existing
Ralph 5.64 candidate in:

```text
D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\ralph-model-routing-v564-hybrid
```

The prompt must say: preserve all current changes; do not reset/clean; finish
the reviewed seven-story plan; validate the dogfood event schema using real
Copilot telemetry; run generation/parity/full tests with saved logs; converge
Phase 5a/5b; prove zero standalone-plugin/Crews/Overview diff; and create a
local commit without pushing.
