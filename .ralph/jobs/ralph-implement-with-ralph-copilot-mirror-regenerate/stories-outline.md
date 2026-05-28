# Stories Outline: ralph-implement-with-ralph-copilot-mirror-regenerate

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Reword stale `.sh\b` refs in implement-with-ralph Claude source

**Description:** As a Ralph plugin maintainer, I want the implement-with-ralph Claude source SKILL.md to have zero references to deleted bash shims so operators following the docs hit live `.mjs` paths instead of "no such file or directory."

**Acceptance Criteria:**
- [ ] From the worktree: `grep -cE '\.sh\b' plugins/ralph/skills/implement-with-ralph/SKILL.md` returns `0`
- [ ] Every replacement was made per the reword playbook table in plan §Approach; no historical-only `ralph.sh` sentences left over
- [ ] `node plugins/ralph/scripts/check-copilot-parity.mjs` still passes (assertions A–E green; no H2/H3 headers removed or renamed without updating the mirror)
- [ ] `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check` still passes (auto-mirrored skills not affected)
- [ ] Typecheck / lint not applicable (markdown change). Optionally: `node plugins/ralph/tests/run.mjs` exits 0 to confirm no regression.
- [ ] Commit message references the FAIL row: `[US-001] reword stale .sh refs in implement-with-ralph Claude source — closes copilot-skill-mirror-parity FAIL row`

**Dependencies:** None

**Estimated complexity:** medium (38 hits across ~1722 lines — each requires a contextual reword decision)

---

## US-002: Reword stale `.sh\b` refs in implement-with-ralph Copilot mirror (lockstep)

**Description:** As a Copilot-CLI user, I want the implement-with-ralph SKILL.md mirror to have zero references to deleted bash shims so the example commands I copy actually work.

**Acceptance Criteria:**
- [ ] From the worktree: `grep -cE '\.sh\b' plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md` returns `0`
- [ ] All Copilot-specific divergences preserved (Phase 3 async polling block, Terminal Marker File Fallback block, Planning engine appendix per `parity-exceptions.json:5-20`)
- [ ] `node plugins/ralph/scripts/check-copilot-parity.mjs` passes (anchors stay live — assertions A–E green)
- [ ] No edits to files outside the mirror SKILL.md
- [ ] Commit: `[US-002] reword stale .sh refs in implement-with-ralph Copilot mirror — lockstep with US-001`

**Dependencies:** US-001 (mirror anchors track source headers; running serially avoids drift mid-iteration)

**Estimated complexity:** medium (33 hits, must preserve Copilot-specific divergences)

---

## US-003: Add Assertion F (no stale `.sh\b`) + node:test

**Description:** As a Ralph plugin maintainer, I want the parity gate to refuse a release that re-introduces stale `.sh` refs in either surface of implement-with-ralph, so future migrations cannot regress this row.

**Acceptance Criteria:**
- [ ] `scripts/check-copilot-parity.mjs` adds and `export`s an async function `assertNoStaleShRefs(repoRoot, exceptions)` that uses `fs/promises` (matching the existing module style)
- [ ] The bottom of `check-copilot-parity.mjs` is refactored to guard the CLI entry with the `argvPath/modulePath` pattern from `generate-copilot-artifacts.mjs`, so importing the module does not auto-run `main()`
- [ ] `main()` is updated to call `await assertNoStaleShRefs(repoRoot, exceptions)` after `await assertionE()`
- [ ] `parity-exceptions.json` has a `staleShAllowList` field — an empty array `[]` initially. Each future entry has shape `{"path": "...", "line": <int>, "reason": "..."}`.
- [ ] `tests/test-no-stale-sh-refs.mjs` exists. Format: `node:test`. Covers three cases per plan §Testing strategy: (a) live happy path, (b) injected unallowed hit rejects, (c) injected allowed hit passes. Fixture writes go to `os.tmpdir()`; cleanup in `test.after`.
- [ ] `node plugins/ralph/tests/test-no-stale-sh-refs.mjs` exits 0 from the worktree root.
- [ ] `node plugins/ralph/tests/run.mjs` exits 0 (full suite green; the new file is auto-discovered).
- [ ] `node plugins/ralph/scripts/check-copilot-parity.mjs` exits 0 (assertions A–F green against the live cleaned surfaces).
- [ ] Commit: `[US-003] add Assertion F + node:test for stale .sh regression`

**Dependencies:** US-001, US-002 (gate must pass against cleaned surfaces)

**Estimated complexity:** small (one new function, one new test file, minor refactor of script CLI guard)

---

## US-004: Ship v5.46.1 (CHANGELOG + five stamps)

**Description:** As a Ralph plugin consumer, I want a v5.46.1 release that surfaces the mirror-staleness fix and its parity-gate so I can pull the patch via the marketplace.

**Acceptance Criteria:**
- [ ] `plugins/ralph/CHANGELOG.md` has a v5.46.1 entry at the top, matching the template in plan §"CHANGELOG entry (v5.46.1)"
- [ ] All five release stamps read `5.46.1` per plan AC-7. Per-file `grep -nE '5\.46\.[01]'` returns exactly one `5.46.1` line and zero `5.46.0` lines:
  - `plugins/ralph/.claude-plugin/plugin.json`
  - `plugins/ralph/.github/plugin/plugin.json`
  - `.claude-plugin/marketplace.json`
  - `.github/plugin/marketplace.json`
  - `.agents/plugins/marketplace.json`
- [ ] `node plugins/ralph/scripts/check-copilot-parity.mjs` and `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check` both exit 0 after the version bump
- [ ] Commit: `[US-004] release v5.46.1 — close copilot-skill-mirror-parity FAIL row`

**Dependencies:** US-001, US-002, US-003

**Estimated complexity:** small

---

## US-005: Multi-remote push + verification re-run + Phase 5a/5b review-fix

**Description:** As the bookkeeper lead, I want the topic branch pushed to every configured remote (`origin` and `work`), the audit's exact grep re-run for evidence, AND the Phase 5a code-review + Phase 5b docs-review convergence loops complete before terminal so the lead can cherry-pick safely.

**Acceptance Criteria:**
- [ ] Phase 5a code-review converges: `code-reviewer` agent run; findings written to `code-review-findings.json`; `code-fixer` loop runs until all Critical/High findings are `fixed` or `wont_fix` (documented). No open Critical findings at terminal.
- [ ] Phase 5b docs-review converges: `docs-reviewer` agent run; findings written to `docs-review-findings.json`; `docs-updater` loop runs until convergence. No open Critical findings at terminal.
- [ ] `git remote -v` confirms `origin` and `work` configured
- [ ] Explicit per-remote push loop succeeds for BOTH remotes (see plan Risk Areas §7 for the exact loop). If either push fails, surface `kind=question` to the lead instead of retrying silently
- [ ] From the worktree, after the push: `grep -nE '\.sh\b' plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md` returns no output (matches the audit's exact PASS criterion at audit-report.md:106)
- [ ] `node plugins/ralph/scripts/check-copilot-parity.mjs` and `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check` both exit 0 from the worktree, post-push
- [ ] Topic branch present on both `origin` and `work` remotes
- [ ] Commit: `[US-005] verify + push v5.46.1`

**Dependencies:** US-001, US-002, US-003, US-004

**Estimated complexity:** small
