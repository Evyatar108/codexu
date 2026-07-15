# VM Migration Handoff - 2026-07-14

## 1. Where we are right now

The workspace is frozen with no running subagents. The Happy/codexu root is
captured on `migration/vm-2026-07-14`; all source branches are pushed to
private repositories under `evmitran_microsoft`. The exact repositories,
branches, and immutable commits are recorded in
`docs/vm-migration-manifest.json:1-48`.

PRD B is not complete: code review is clean, docs review is pending at round
17, and F-021/F-022/F-023 remain open
(`.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-b/job-state.json:14-23`,
`.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-b/docs-review-findings.json:440-496`).
No release, tag, installation, or publication was performed
(`docs/vm-migration-manifest.json:46-53`).

## 2. The problem in detail

The immediate goal is to resume the current Ralph/Codex/Happy work from a new
VM without relying on this machine's unpushed branches, worktree metadata, or
large transient agent logs. The active implementation spans the Happy workspace
root, the Codex wrapper, nested Codex Rust source, and the Ralph toolkit. Their
roles and exact commits are listed in `docs/vm-migration-manifest.json:5-44`.

PRD B's contract still requires simultaneous clean code and docs review before
its receipt can be regenerated and independently verified
(`.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/scoped-plans/codex-wrapper-plan.md:45-58`).

## 3. Prior investigation artifacts

- `.ralph/handoffs/2026-07-12-bookkeeper-orchestration-handoff.md` - state before PRD A/B execution.
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-a/` - completed nested-source PRD A state and evidence.
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-b/` - current PRD B state, reviews, findings, and focused evidence.
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/receipts/` - PRD A receipt plus obsolete/rejected PRD B receipt.
- `docs/vm-migration-manifest.json` - machine-readable repository and commit inventory.
- `docs/vm-migration-smoke.json` - successful clean-clone restore proof.

## 4. Detailed findings with file:line evidence

### PRD B source state

The wrapper may write only the reviewed 17-path scope and must leave nested Rust
source read-only, with the nested gitlink unstaged
(`.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/scoped-plans/codex-wrapper-plan.md:21-29`).
The nested source must be checked out at
`6d73e16c44d65ac243834a942d7fab2c3b279221`
(`docs/vm-migration-manifest.json:24-29`).

### Review state

The durable orchestrator state records `phase=5b`, `code=clean`,
`docs=pending`, and `round=17`
(`.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-b/job-state.json:14-23`).

The remaining documentation findings are:

- F-021: production toolchain trust claims omit unverified preinstalled
  Windows runner LLVM/xwin inputs
  (`.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-b/docs-review-findings.json:440-456`).
- F-022: active rebase/agent guidance does not follow the new mutually
  exclusive Actions/manual publication branch
  (`.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-b/docs-review-findings.json:459-477`).
- F-023: submodule migration docs list the release-candidate steps in stale
  order
  (`.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-b/docs-review-findings.json:480-496`).

### Migration state

The root now points its Codex submodule at the private VM mirror
(`.gitmodules:1-6`). The restore script initializes both root submodules,
recreates the priority worktrees, switches the nested source branch, and fails
if the nested SHA differs from the required candidate
(`scripts/fork-setup/restore-vm-workspace.ps1:55-124`).
The same script completed from a fresh private clone and restored all six
recorded commits with the intentional unstaged wrapper gitlink
(`docs/vm-migration-manifest.json:55-60`;
`docs/vm-migration-smoke.json:1-20`).

## 5. Things to NOT do

- Do not publish Codex `.4` or Ralph 5.64; migration pushed branches only.
- Do not reuse the existing PRD B receipt. It predates the latest scope and
  commits; regenerate it only after clean code/docs convergence.
- Do not stage the PRD B nested gitlink. The dirty gitlink is intentional
  read-only source context.
- Do not force-push
  `ralph/plan-crews-codex-member-tab-title-not-renamed`. Its divergent local
  tip was preserved separately as
  `migration/local-ralph-plan-crews-codex-member-tab-title-not-renamed`.
- Do not restore excluded `lenses`, nested worktree directories, staging
  directories, or the temporary Python shim. They are transient and listed in
  `docs/vm-migration-manifest.json:46-53`.

## 6. Decision framework

| Choice | Outcome | Recommendation |
|---|---|---|
| Resume PRD B first | Preserves the current convergence chain and produces a valid immutable receipt | Recommended |
| Start PRD C | Violates the PRD B predecessor gate | Do not do |
| Publish releases | Exposes unverified docs/release state | Do not do |
| Resume build-time work in parallel | Safe after restore because its Codex worktree branch is separately mirrored | Optional after PRD B is stable |

## 7. Recommended sequencing

1. Clone the snapshot branch without recursively initializing the old URLs:
   `git clone --branch migration/vm-2026-07-14 https://github.com/evmitran_microsoft/codexu.git`.
2. Run
   `powershell -ExecutionPolicy Bypass -File scripts\fork-setup\restore-vm-workspace.ps1`.
3. Verify the repositories and commits against
   `docs/vm-migration-manifest.json:5-35`.
4. Read PRD B state and findings, then fix F-021/F-022/F-023 only.
5. Re-run docs review on the exact 17-path diff. If docs changes alter release
   behavior materially, re-run code review too.
6. Require code/docs clean simultaneously, rerun final tests/audits, regenerate
   the PRD B receipt, and require independent `RECEIPT_VERIFIED`.
7. Only then begin PRD C. Release publication remains a later lead-owned step.

## 8. Open questions

- Whether fixing F-022 changes only prose or materially changes executable
  release control flow; if executable behavior changes, code review must run
  again.
- Whether the new VM's Windows runner/toolchain differs enough to require
  rerunning resource-safe focused tests before receipt generation.
- Whether the build-time worktree should resume in parallel immediately or
  wait until PRD B receipt verification.

## 9. Files referenced

### Migration

- `docs/vm-migration-manifest.json` - repository, branch, commit, and preservation inventory.
- `docs/vm-migration-smoke.json` - clean-clone restore result and restored SHAs.
- `scripts/fork-setup/restore-vm-workspace.ps1` - idempotent VM restore script.
- `.gitmodules` - private root submodule URLs.

### PRD B

- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-b/job-state.json` - current orchestrator state.
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff-prd-b/docs-review-findings.json` - open F-021/F-022/F-023.
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/scoped-plans/codex-wrapper-plan.md` - immutable scope and receipt contract.
- `.ralph/jobs/codex-v2-copilot-encrypted-subagent-handoff/receipts/` - predecessor and obsolete receipt artifacts.

## 10. Constraints (do not violate)

- The Happy workspace is the `codexu` root repository; no separate Happy
  submodule is required.
- Keep all migration repositories private under `evmitran_microsoft`.
- Never push release tags during migration.
- Preserve exact branch commits from `docs/vm-migration-manifest.json`.
- Keep nested source at `6d73e16c44d65ac243834a942d7fab2c3b279221`
  and leave the wrapper gitlink unstaged.
- Use the resource-safe focused invariant command with `CARGO_BUILD_JOBS=1`.

## 11. Recommended single next action

On the VM, clone `migration/vm-2026-07-14` and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\fork-setup\restore-vm-workspace.ps1
```

Then verify `codex\.worktrees\codex-v2-copilot-encrypted-subagent-handoff\external\repos\codex-patched`
is on `6d73e16c44d65ac243834a942d7fab2c3b279221` before changing any file.

## Bootstrap automation update

The legacy restore command now delegates to
`scripts\fork-setup\bootstrap-vm.ps1 -RestoreWorkspace`. The orchestrator
validates every recorded worktree branch and SHA, restores the toolkit routing
worktree omitted by the original script, and initializes nested submodules
recursively. Its read-only acceptance mode is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fork-setup\bootstrap-vm.ps1 -ValidateOnly
```

Toolchains, Happy source linking, plugin allowlisting, Android, Codex caches,
and operator gates are documented in `docs\vm-bootstrap.md`. PRD B remains
paused and unpublished. Validation does not mutate its worktrees. Local-only
package/plugin fixes are publication gates or operator-supplied inputs, never
invented remote refs.
