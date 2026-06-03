# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | Two specific bug post-mortems with proposed fixes — desired end state is fully concrete |
| Scope | clear | Each story has explicit file list + scope-out (do NOT broaden isListenerArmCall, do NOT touch pre-tool-use.js semantics, do NOT add CLAUDE.md). Research clarified that some originally-named test files don't exist; the canonical equivalents are documented in research-brief.md |
| Criteria | clear | Per-story acceptance criteria are testable: (US-001) new tests for status-call filtering + counter-example pass; (US-002) lead exited→block, lead armed→pass, member progress→unchanged; full toolkit test suite green; version bumped to 3.4.0 via canonical script; CHANGELOG + AGENTS updated |

## Remaining Open Questions

1. **Single branch vs. two-branch parallel impl?** Recommended decomposition is serial on one branch (`ralph/crews-v3.4-bundle`) because the version-bump script touches 5+ shared files and CHANGELOG/AGENTS are hand-edited. Plan codifies this as Cluster 2 depends on Cluster 1; operator can override to single-bundle-single-impl-member if preferred.

2. **Order: US-001 first or US-002 first?** No strict ordering requirement (sequential Stop-hook gates with no shared state per architect). US-001 first is recommended because it has fewer test-fixture rewrites (US-002 requires updating several existing lead assertions in stop-decision/role-gate). Last cluster owns the version bump + CHANGELOG/AGENTS coordination.

3. **Where to place `isCrewsCliInfraCall` regex polish.** Research surfaced edge cases the original spec's regex would miss (PowerShell `&` invocation, `pwsh` wrappers, `npx crews`, quoted paths with spaces). [INFERRED] Plan adopts the existing `ARM_PATTERN_CREWS` regex shape (mirrors quote-handling + `\b...\s+\S+` substring matching) rather than the loose form. Anchored on `\bnode(?:\.exe)?` for consistency.

4. **AGENTS.md amendments are documentation-only and low-risk.** [INFERRED] Plan lists the specific sections to extend (`## v3.3.0 progress-bg gate bypass removal`, `## Crews plugin invariants (v1.9.2)`, `## Crews stop-hook semantics (for reference)`) but does not pre-draft the prose; impl member writes it.
