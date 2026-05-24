# Notepad: codex-wire-spike

## PERMANENT

- **Spike scope:** 30-minute pre-flight wire-acceptance spike against `codex app-server`. NO production code changes. Deliverable is `## Wire spike results` section appended to `plans/codex-agent-parity-audit.md` plus single throwaway Node script `tasks/spikes/codex-wire-spike.mjs`.
- **Three wire questions:** (Q1) does codex accept `InputItem { type: "image", url: "data:image/png;base64,..." }`? (Q2) does codex honor `config: { project_doc_fallback_filenames: [...] }`? (Q3) what does `compactPrompt` actually do?
- **Mode:** autonomous (user invoked `/implement-with-ralph` from options-mode-auto with no `--autonomous` flag; user not present → treat as autonomous per the mode-switching contract).
- **Plan-with-ralph passed 2 review rounds.** Critical Q3 oracle correctness verified directly against Rust sources before plan landed.

## User Preferences

(none yet)

## Deferred Questions

| # | Question | Story ID | Iter Asked | Answer | Iter Answered | Auto-Resolved |
|---|----------|----------|------------|--------|---------------|---------------|

## Story Doctor Log

(no interventions yet)

## Autonomous Decisions

- 2026-05-13: invoked in options-mode-auto, treating as autonomous mode (default behavior: 3 iterations per ralph.sh run, no user prompts).

## Working Notes

- 2026-05-13 12:55Z: Phase 0 complete. Plan verified at `D:/harness-efforts/codexu/.ralph/jobs/codex-wire-spike/plan.md`. Proceeding to Phase 2 (PRD generation).
