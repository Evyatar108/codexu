# Stories Outline: Ralph Plan Staging Unique Path Per Member

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Add member-aware staging session helper and wire both skills

**Description:** As a Ralph plan or brainstorm member, I want staging directories to include a stable member slug so that concurrent members spawned in the same wall-clock second cannot overwrite each other's staged files.

**Acceptance Criteria:**
- [ ] Add a shared Ralph helper that generates staging session slugs with timestamp-first, Windows-safe member disambiguation.
- [ ] The helper derives the member component from a documented environment-variable precedence chain and has a collision-resistant fallback for non-crew runs.
- [ ] `plan-with-ralph` uses the helper for `<JOBS_BASE>/.staging/<session_id>/`.
- [ ] `brainstorm-with-ralph` uses the same helper for `$JOBS_BASE/.staging/$SESSION_ID`.
- [ ] Claude source skills and Copilot skill mirrors are in lockstep.
- [ ] Typecheck or syntax checks pass for the new helper.

**Dependencies:** None
**Estimated complexity:** medium

## US-002: Add collision regression coverage and v5.46.3 release notes

**Description:** As a Ralph maintainer, I want tests and release notes to pin the same-second collision fix so future edits do not regress to timestamp-only staging paths.

**Acceptance Criteria:**
- [ ] Add a test fixture proving two different member names in the same wall-clock second produce distinct staging paths.
- [ ] Add coverage for slug normalization, empty/unsafe member names, and fallback behavior.
- [ ] Add skill contract coverage that both plan and brainstorm skills invoke the shared helper instead of documenting bare timestamp-only staging.
- [ ] Update `CHANGELOG.md` under `v5.46.3` to cite the 2026-05-28 same-second overwrite failure pattern.
- [ ] Update all required Ralph plugin version stamps to `5.46.3` if not already bumped by a previous v5.46.3 landing.
- [ ] Targeted tests pass.

**Dependencies:** US-001
**Estimated complexity:** small

