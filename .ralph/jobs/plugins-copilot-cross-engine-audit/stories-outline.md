# Stories Outline: plugins-copilot-cross-engine-audit

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-000: Preflight + topic-branch + worktree setup
**Description:** As an audit operator, I want a serial preflight gate that pins all version/SHA/CLI-cache state and creates the topic branch so US-001..003 operate against a stable, common snapshot.
**Acceptance Criteria:**
- [ ] Topic branch `ralph/plugins-copilot-cross-engine-audit` cut off `origin/main` in codexu.
- [ ] ai-developer-toolkit worktrees `audit-main-crews` and `audit-main-ralph` created at `origin/main` under `D:/ai-developer-toolkit/.worktrees/`.
- [ ] `preflight.json` written under `.ralph/jobs/plugins-copilot-cross-engine-audit/` with all 11 required keys (see AC-7).
- [ ] `preflight.json.crewsVersion` starts with `1.7.`; `ralphVersion == "5.46.0"`; `ralphOverviewVersion == "2.4.0"` (else STOP with `kind=question`).
- [ ] `preflight.json` committed on the topic branch with message `chore(audit): preflight.json captured`.
- [ ] Typecheck passes (N/A — no code changes; audit-only).
**Dependencies:** None
**Estimated complexity:** small

## US-001: crews v1.7.x Copilot parity audit
**Description:** As an audit operator, I want PASS/FAIL evidence for all 7 crews Copilot-specific behaviors (spawn-launcher, SessionStart sessionId, PreToolUse gate, Stop+kind-tag, PostToolUse nag, slash-commands, sessionId pointer restart) so the migration-go/no-go decision has runtime evidence under the Copilot engine.
**Acceptance Criteria:**
- [ ] Scratch crew booted with explicit `--state-cwd` under `.ralph/jobs/plugins-copilot-cross-engine-audit/scratch-crew/` (live codexu bookkeeper untouched).
- [ ] All 7 scenarios run; `crews-findings.md` contains ≥ 7 strict-template subsections.
- [ ] Evidence (launcher head, manifest snapshot, hook envelopes, nag prose, owner-snapshot) captured into `evidence/crews-*.txt` BEFORE scratch teardown.
- [ ] `evidence/worktree-clean-status-crews.txt` exists and is empty BEFORE `git worktree remove`.
- [ ] No edits in `D:/ai-developer-toolkit/.worktrees/audit-main-crews/` (read-only audit).
- [ ] AC-9 (crews), AC-10 (scratch-crew torn down), AC-12 (crews worktree clean+removed).
**Dependencies:** US-000
**Estimated complexity:** large

## US-002: ralph v5.46.0 Copilot parity audit
**Description:** As an audit operator, I want PASS/FAIL evidence for the 6 ralph runtime/static-flag-check scenarios under Copilot on Windows so the all-Node migration + shell:true fix can be migration-blessed.
**Acceptance Criteria:**
- [ ] All 6 direct-Node scenarios run (codex-exec, copilot-exec, minimal-codex smoke, minimal-copilot smoke, ralph.mjs --help + grep, check-copilot-parity + mirror-prose grep); each PASS/FAIL/NOT-TESTED captured.
- [ ] `ralph-findings.md` contains ≥ 6 strict-template subsections.
- [ ] Evidence (smoke command outputs, grep results, parity-check output) captured into `evidence/ralph-*.txt`.
- [ ] `evidence/worktree-clean-status-ralph.txt` exists and is empty BEFORE `git worktree remove`.
- [ ] Optional E2E /plan-with-ralph scenario either run (with capture) or marked NOT-TESTED with rationale.
- [ ] AC-9 (ralph), AC-10 (scratch-ralph-prompt torn down), AC-12 (ralph worktree clean+removed).
**Dependencies:** US-000
**Estimated complexity:** large

## US-003: ralph-overview v2.4.0 Copilot parity audit
**Description:** As an audit operator, I want PASS/FAIL evidence for the 3 ralph-overview MCP behaviors (plugin-manifest mcpServers discovery, workspace .mcp.json fallback, watcher auto-start) plus 2 side-checks under Copilot — with the operator's Copilot plugin cache fully restored at end-of-story.
**Acceptance Criteria:**
- [ ] ralph-overview installed into operator's Copilot plugin cache from `origin/main`; `copilotPluginListAfter` recorded into `preflight.json`.
- [ ] Scenario 1 (manifest-only) runs from `scratch-mcp-session/no-workspace-mcp/` with NO `.mcp.json` present.
- [ ] Scenarios 2-3 + side-checks run from `scratch-mcp-session/with-workspace-mcp/`.
- [ ] `ralph-overview-findings.md` contains ≥ 5 strict-template subsections (3 primary + 2 side-checks).
- [ ] Evidence (`copilot mcp list --json` output, owner-snapshot, plugin.json snippet) captured.
- [ ] ralph-overview uninstalled at end; `copilotPluginListRestored` recorded; matches `copilotPluginListBefore`.
- [ ] AC-9 (ralph-overview), AC-10 (scratch-mcp-session torn down), AC-13 (Copilot plugin cache restored).
**Dependencies:** US-000
**Estimated complexity:** medium

## US-004: audit-report aggregation + migration recommendation
**Description:** As the operator, I want one consolidated `audit-report.md` with a summary table, per-plugin sections, file:line evidence for every FAIL, and a single chosen migration recommendation (A/B/C) so I can make the bookkeeper-lead engine-migration decision.
**Acceptance Criteria:**
- [ ] `audit-report.md` exists at `.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md`.
- [ ] Opens with summary table whose first header row is `| Behavior | Status | Migration impact |`.
- [ ] Contains 3 plugin sections (`## crews v1.7.x`, `## ralph v5.46.0`, `## ralph-overview v2.4.0`); ≥ 18 `### ` subsections.
- [ ] Every subsection has exactly one `**Status:** PASS|FAIL|NOT-TESTED` line.
- [ ] Every FAIL row immediately followed by `**File:** <path>:<line>` then `**Follow-up:** <one-line-title>`.
- [ ] Ends with `## Migration recommendation` section containing exactly one of `(A)`, `(B)`, or `(C)` with rationale grounded in FAILs.
- [ ] AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-11.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** medium
