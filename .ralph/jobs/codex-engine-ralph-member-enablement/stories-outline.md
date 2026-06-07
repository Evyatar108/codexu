# Stories Outline: Enable & Validate codex-engine Ralph Members (Spike)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> This is a sequential live-probe spike. Every story mutates/observes the SAME single codex environment and
> the SAME `findings.md`; run strictly serial (one cluster — see `suggested-decomposition.json`). The
> acceptance is an OR at the outcome level (works end-to-end OR enumerated blockers), with `findings.md`
> required in BOTH branches. The expected realistic outcome is enumerated blockers + a remediation path, not
> a fully-green end-to-end run.

## US-001: Refresh codex plugin cache from the local-source marketplace
**Description:** As the impl agent, I want to refresh the stale codex plugin-cache installs (crews 3.6.2→3.12.0,
ralph-orchestration 5.50.0→5.52.0; optionally install ralph-overview) from the LOCAL-SOURCE
`ai-developer-toolkit` marketplace, so the codex member runs current plugin code.
**Acceptance Criteria:**
- [ ] PRE-state snapshot captured: cache version subdirs under `~/.codex/plugins/cache/ai-developer-toolkit/`
      and the `[plugins."*@ai-developer-toolkit"]` stanzas in `~/.codex/config.toml`.
- [ ] `codex plugin add crews@ai-developer-toolkit` and `codex plugin add ralph-orchestration@ai-developer-toolkit`
      run successfully from the local-source marketplace (NEVER a git-source marketplace).
- [ ] POST-state shows `~/.codex/plugins/cache/ai-developer-toolkit/crews/3.12.0/` and `.../ralph-orchestration/5.52.0/`
      and the config stanzas remain enabled (hook trust re-approved if prompted). Evidence is the cache subdirs +
      config stanzas, NOT `codex plugin list`.
- [ ] PRE/POST snapshots recorded for the findings doc.
- [ ] Typecheck passes (N/A — no source change; this is an ops gate).
**Dependencies:** None
**Estimated complexity:** small

## US-002: Restart into a fresh codex thread and capture skill advertisement
**Description:** As the impl agent, I want to verify (in a thread started AFTER the refresh) whether codex
advertises the `ralph-orchestration:*` skills, so I confirm loading independently of execution.
**Acceptance Criteria:**
- [ ] A fresh codex thread/session is started AFTER US-001 (plugin-cache refresh does not reload an open session).
- [ ] An explicit transcript excerpt of codex's skill-discovery output (startup skill-list and/or `/`-command
      listing) is captured into the findings doc.
- [ ] The resolved discovery path is recorded (codex uses `.codex-plugin/plugin.json` first, falls back to
      ralph's `.claude-plugin/plugin.json` + default `skills/` root).
- [ ] The finding explicitly notes "advertised ≠ executes correctly".
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Primitive-free crews codex member lifecycle smoke (NO ralph)
**Description:** As the lead, I want to spawn a `--engine codex` crews member that ONLY arms its listener and
emits a `kind=done` report (no ralph skill), so crews-codex membership is validated in isolation from ralph
primitive gaps.
**Acceptance Criteria:**
- [ ] A `--engine codex` member is spawned on a THROWAWAY task with prompt "arm listener + emit kind=done; no
      ralph"; the launcher gate (member starts, codex-core stable PID) is recorded.
- [ ] The crews `codex-session-start.js` arms the listener and the member's `kind=done` reaches the lead mailbox;
      `/crews:stop-member` cleanly closes the tab — each sub-gate recorded.
- [ ] Autonomous-vs-interactive driving contract honored: if the wt.exe TUI spawn cannot be driven
      autonomously, the exact interactive-driving blocker is recorded and the gate STOPS (no silent hang); the
      operator's manual-driving result is captured instead.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: Attempt /brainstorm-with-ralph on a throwaway idea
**Description:** As the impl agent, I want a codex member to attempt `/brainstorm-with-ralph` on a trivial
throwaway idea, so I capture how far a real ralph workflow gets under codex.
**Acceptance Criteria:**
- [ ] Runs only after US-003 passes (lifecycle isolated first).
- [ ] Gate-by-gate progress + the exact degradation/failure point recorded (brainstorm uses `Agent(run_in_background)`
      + background `Bash` = F2/F3, expected to degrade).
- [ ] 10-minute hard timebox honored; on timeout/hang the run is killed and recorded NOT-COMPLETED with the captured tail.
**Dependencies:** US-003
**Estimated complexity:** medium

## US-005: Degradation probe — tiny /plan-with-ralph under codex
**Description:** As the impl agent, I want to probe a tiny throwaway `/plan-with-ralph` under codex, so I
characterize the F1 (skill chaining) / F2 (typed subagents) gaps with concrete evidence.
**Acceptance Criteria:**
- [ ] A tiny throwaway `/plan-with-ralph` is attempted; the exact failure mode (which tool call fails / what
      codex emits) is captured, OR a hang is recorded.
- [ ] 10-minute hard timebox honored (the codex-exec recursion hang observed during planning makes unbounded runs unsafe).
- [ ] stdout/stderr/transcript excerpts saved into the findings doc; NOT-REACHED/HUNG marked with the blocking earlier gate if applicable.
**Dependencies:** US-004
**Estimated complexity:** medium

## US-006: Write findings.md and clean up
**Description:** As the operator, I want a findings doc enumerating what works/breaks with root causes + a
remediation path, and the throwaway artifacts removed, so the spike de-risks the downstream
`crews-target-engine-plugin-provisioning` automation design.
**Acceptance Criteria:**
- [ ] `.ralph/jobs/codex-engine-ralph-member-enablement/findings.md` exists with a works/partially/breaks matrix
      across {install/refresh, fresh-thread skill advertisement, member start, listener/Stop lifecycle,
      /brainstorm-with-ralph, /plan-with-ralph, codex-exec recursion, MCP}, a root cause per broken row, the
      PRE/POST codex cache+config snapshots, and codex/Windows operational notes (cache-not-source, fresh-thread,
      `codex plugin list`≠install-state, bash-tests-only, codex-exec hang, MAX_PATH, interactive-spawn driving).
- [ ] Two remediation tracks documented with concrete file pointers: Track A (extend
      `plugins/ralph/scripts/generate-copilot-artifacts.mjs` to emit a `.codex-plugin` ralph overlay, mirroring
      `plugins/crews/.codex-plugin/`) and Track B (implement `codex/tasks/prd-plugin-parity-skill-agent-streaming.md`
      Features 1-3). Cross-references to that PRD and `crews-target-engine-plugin-provisioning` included.
- [ ] Throwaway task artifacts under `.ralph/jobs/`/`.ralph/brainstorms/` deleted before the final commit;
      final committed diff = `findings.md` (+ optional one-line `docs/fork-roadmap.md` follow-up) ONLY. No
      plugin/engine source modified; no version bumped.
**Dependencies:** US-002, US-003, US-004, US-005
**Estimated complexity:** medium
