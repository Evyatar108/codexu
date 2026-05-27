# Research Brief — ralph-orchestration v5.45.1 Windows spawn fix

## Consolidated File List

**Files to modify (production source):**
- `D:/ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs` (line 63: spawn("codex", ...))
- `D:/ai-developer-toolkit/plugins/ralph/src/copilot-exec.mjs` (line 243: spawnCommand(command, ...))

**Files to modify (tests):**
- `D:/ai-developer-toolkit/plugins/ralph/tests/test-codex-exec.mjs`
- `D:/ai-developer-toolkit/plugins/ralph/tests/test-copilot-exec.mjs`

**Files to modify (release stamps):**
- `D:/ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json`
- `D:/ai-developer-toolkit/plugins/ralph/.github/plugin/plugin.json`
- `D:/ai-developer-toolkit/.claude-plugin/marketplace.json`
- `D:/ai-developer-toolkit/.github/plugin/marketplace.json`
- `D:/ai-developer-toolkit/.agents/plugins/marketplace.json`

**Files to modify (docs):**
- `D:/ai-developer-toolkit/plugins/ralph/CHANGELOG.md`

**Reference files (read-only — must NOT be patched, per Bug Surface Audit):**
- `D:/ai-developer-toolkit/plugins/ralph/src/ralph.mjs` (lines 702, 967+1095, 1175, 1200 — all SKIP; section-header argv hazard at :967)
- `D:/ai-developer-toolkit/plugins/ralph/src/review-loop.mjs` (lines 544, 891 — both SKIP; same section-header hazard)
- `D:/ai-developer-toolkit/plugins/ralph/src/git.mjs` (line 8 — SKIP; git.exe + commit-message argv hazard)
- `D:/ai-developer-toolkit/plugins/ralph/src/path-utils.mjs` (line 112 — SKIP; git.exe)

**Test infrastructure reference:**
- `D:/ai-developer-toolkit/plugins/ralph/tests/run.mjs` — discovers and runs all `test-*.mjs` files via `node --test`
- `D:/ai-developer-toolkit/plugins/ralph/tests/test-codex-exec.mjs` already uses EventEmitter-based spawn injection via `opts.spawn`, captures `spawnCalls` array — extend this pattern for shell:true assertions
- `D:/ai-developer-toolkit/plugins/ralph/tests/test-copilot-exec.mjs` follows same pattern

## Researcher Findings

The bug surface was enumerated by:
1. Direct `git show origin/main:plugins/ralph/src/<name>.mjs` reads.
2. Recursive `grep` over `spawn|spawnSync|execFile|execFileSync` across `plugins/ralph/src/*.mjs`.
3. Cross-validation by an Explore agent — confirmed all 10 production sites including the originally-missed `path-utils.mjs:112`.
4. Multi-model review (Claude, Codex, Copilot in parallel) on the initial draft plan — all three converged on the same critical scope-narrowing finding.

10 production sites total; 2 require patching, 8 must remain untouched. See draft-plan.md "Bug Surface Audit" table for per-site reasoning.

## Architect Analysis

**Decision: narrow `shell: true` to the two `.cmd`-shim invocations only.**

Root cause is CreateProcess's refusal to resolve `.cmd` files without shell context (Node CVE-2024-27980 patch). `.exe` resolution is unaffected. Patching `.exe`-target sites would either be no-op-with-cost (extra `/bin/sh -c` fork on POSIX, extra `cmd.exe /d /s /c` wrap on Windows) or, worse, actively corrupt argv that contains `##`-prefixed strings (section headers passed to bash) or spaces (commit messages passed to git).

Pre-existing shell-dependency parity is preserved: the v5.44 bash wrappers (`codex-exec.sh`, `copilot-exec.sh`) already required `/bin/sh` on POSIX and `cmd.exe` on Windows. The narrow fix re-uses that same shell dependency in exactly the two places it's needed.

## Codex Plan Review

See `codex-plan-review.txt`. Critical finding (F-001): the initial draft's universal-`shell:true` approach would break the `## section` header argv path on POSIX. Independently flagged the missed `path-utils.mjs:112` site (F-002). Recommended narrowing to the two CLI shim invocations.

## Copilot Plan Review

See `copilot-plan-review.txt`. Independently agreed with all of Codex's critical findings. Additionally recommended tests-first ordering (F-005) and promoting path-with-spaces from optional to required AC (F-007). Both adopted.

## Findings convergence

7 findings (4 consensus, 2 single-source, 1 medium ack) all marked resolved in `plan-review-findings.json` after the plan was rewritten with the narrow-fix scope.
