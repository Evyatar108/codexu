# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | Desired end state is concrete: the crews hook-timeout cascade is eliminated by L3 (dead-holder lock-steal, no-retry-under-lock, lock-free heartbeat stamp, reduced per-hook I/O), with L1/L2 as mitigations, the heartbeat AV-resilience preserved, and four named tests. |
| Scope | clear | The feature request + findings.md enumerate exact files and the L3/L1/L2 boundaries; out-of-scope (attached-shell reap, global budget shrink, lead-owned submodule push) is explicit. |
| Criteria | clear | Verifiable ACs: cascade-repro (immediate dead-PID steal), no-retry-under-lock, heartbeat-not-starved, file-op-count bound, plus timeout config + docs + green suite + version bump. |

## Remaining Open Questions
- L3b implementation shape (simpler single-attempt-fail-open vs release/reacquire/reread loop) — plan defaults to the simpler fail-open; recorded in plan Open Questions. [INFERRED]
- Exact heartbeat stamp file format/location and the exact minor version number — left to impl per convention. [INFERRED]
