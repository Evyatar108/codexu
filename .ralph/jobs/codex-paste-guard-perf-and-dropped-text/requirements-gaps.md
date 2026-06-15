# Requirements Gaps Assessment

## Dimension Ratings

| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | Make the existing non-bracketed paste-burst heuristic robust enough for Windows Terminal by removing normal typing latency and preventing slow multiline paste streams from splitting or submitting early. |
| Scope | clear | Scope is limited to the robustness half of `codex-paste-guard-perf-and-dropped-text`; the Windows default-on flip has already shipped, and true bracketed paste on Windows is explicitly out of scope. |
| Criteria | clear | The prompt provides measurable outcomes: no added single-keystroke latency/redraw delay, slow multiline paste captured as one group, no early submit, feature remains behind `LegacyPasteBurstHeuristic`, and bracketed paste/non-Windows defaults are unchanged. |

## Clarifications

No questions needed. The member prompt supplied concrete scope, source-of-truth investigations, target files, constraints, and acceptance criteria.

## Remaining Open Questions

- Exact timeout constants should be finalized during implementation with tests. The plan recommends a two-window model (`settle` and `rearm`) but leaves the final millisecond values to implementation evidence.
- A delimiter-free heuristic cannot prove that two events separated by an arbitrary long pause belong to the same physical paste. The goal is robust practical handling for slow terminal/PTY delivery within a bounded rearm window, plus no lossy early flush when a likely-continuation input is already being processed.
