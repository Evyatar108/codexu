# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | Seed states the desired end state precisely: a `--engine codex` crews member runs a real ralph workflow end-to-end, OR blockers are enumerated with root causes + remediation, producing a findings doc. |
| Scope | clear | Seed enumerates the 5 concrete steps (install/refresh from local-source marketplace, verify skill loading, validate end-to-end, document). Research sharpened the boundary: refresh-stale (not fresh-install) + the real blocker is codex harness-primitive parity, scoped out as follow-up. |
| Criteria | clear | Seed gives an explicit OR acceptance ("completes a real ralph phase end-to-end OR blockers enumerated + remediation path + findings doc"). Plan made each gate's evidence verifiable. |

## Clarifications
No questions needed — all three dimensions were clear from the detailed seed. Research-phase ground truth
corrected two seed assumptions (recorded in the plan Overview): (1) ralph-orchestration is ALREADY installed
in codex (cache v5.50.0), so the task is refresh-stale not fresh-install; (2) the "ralph bash-orientation"
concern is largely stale — ralph v5.46.0 deleted all `.sh` runtime (pure Node ESM now). The real blocker
surfaced by research is codex's lack of three harness primitives (skill chaining, typed subagents, streaming
background output), already scoped in `codex/tasks/prd-plugin-parity-skill-agent-streaming.md`.

## Remaining Open Questions
- Remediation track selection (plugin `.codex-plugin` overlay vs engine parity vs both) — deferred to the
  operator after the spike's findings; the spike characterizes which workflows need which track.
- ralph-overview install + cache pruning + codex-exec hang root cause — recorded as Open Questions in the plan.
