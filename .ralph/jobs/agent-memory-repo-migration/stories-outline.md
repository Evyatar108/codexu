# Stories Outline: agent-memory-repo-migration

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Move auto-memory files into `.agents/memory/`
**Description:** As the codexu bookkeeper, I want all 18 auto-memory files (MEMORY.md index + 17 memory entries) copied from the per-developer claude-code user-dir into the repo-tracked `.agents/memory/` directory so that the memories travel with git history and are readable by copilot sessions.
**Acceptance Criteria:**
- [ ] `D:/harness-efforts/codexu/.agents/memory/` exists and contains exactly 18 files matching the inventory in plan.md.
- [ ] Pre-commit privacy/secret scan over staged bodies (check `metadata.originSessionId`, embedded paths, tokens). Halt and surface if any sensitive value found.
- [ ] (Name, Hash) parity check between user-dir source and `.agents/memory/` returns empty diff (Compare-Object on pscustomobjects; not raw FileHashInfo).
- [ ] All 18 files committed to topic branch `ralph/agent-memory-repo-migration` with message `chore(.agents): seed memory directory from user-dir auto-memory`. Use `git add D:/harness-efforts/codexu/.agents/memory/` only — never `git add -A`.
- [ ] User-dir at `C:/Users/evmitran/.claude/projects/D--harness-efforts-codexu/memory/` is unchanged.
- [ ] `git log -1 --stat` shows only `.agents/memory/*.md` additions.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Wire AGENTS.md, CLAUDE.md, docs/fork-notes.md, plans/codexu-roadmap.md
**Description:** As a codexu reader (claude-code lead, copilot session, or future contributor), I want the repo's tracked guidance files to point at `.agents/memory/` with a curated high-priority TOC so I can find the bookkeeper memories without prior context, and so the operating manual (`plans/codexu-roadmap.md`) no longer points at the stale user-dir path.
**Acceptance Criteria:**
- [ ] `D:/harness-efforts/codexu/AGENTS.md` contains `## Auto-memory (codexu bookkeeper-scope)` section with scope-clarifying intro, pointer to `.agents/memory/MEMORY.md`, 5-8-entry curated TOC, and disclaimer that the TOC is a curated subset. NO `@`-include directives.
- [ ] `D:/harness-efforts/codexu/CLAUDE.md` (gitignored) contains the same section. Verification trail: impl member emits `Select-String -Path D:/harness-efforts/codexu/CLAUDE.md -Pattern '## Auto-memory'` output in mailbox report.
- [ ] `D:/harness-efforts/codexu/docs/fork-notes.md` contains `### Agent auto-memory (codexu bookkeeper)` subsection with convention description + the SAFE junction setup recipe (backup → compare → junction → verify → delete backup; NOT the unsafe rmdir+mklink two-liner).
- [ ] `D:/harness-efforts/codexu/plans/codexu-roadmap.md` lines 851-853 updated to reference `.agents/memory/`.
- [ ] AGENTS.md + docs/fork-notes.md + plans/codexu-roadmap.md committed with message `docs(agents): wire .agents/memory/ into AGENTS.md, fork-notes, and codexu-roadmap`. CLAUDE.md change NOT committed (gitignored).
- [ ] `git log -1 --stat` shows only those 3 files.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Replace user-dir with junction (deferrable)
**Description:** As the operator on this Windows 11 box, I want the per-developer user-dir at `C:/Users/evmitran/.claude/projects/D--harness-efforts-codexu/memory/` replaced by an NTFS junction pointing at `.agents/memory/` so that claude-code's existing auto-load contract continues to work and `.agents/memory/` becomes the single source of truth.
**Acceptance Criteria:**
- [ ] **Pre-swap parity check (CRITICAL).** Re-run the (Name, Hash) Compare-Object between user-dir and `.agents/memory/`. Halt on any diff — concurrent auto-memory writes between US-001 and now must be reconciled before the swap.
- [ ] Copilot Read test on `D:/harness-efforts/codexu/.agents/memory/MEMORY.md` succeeds (index lists 17 entries).
- [ ] Fresh claude-code session smoke test: ask to recall `feedback_phase_discipline_separate_members`; response mentions "one fresh ralph member per phase" or equivalent "never chain phases" guidance.
- [ ] User-dir renamed to `memory.bak`.
- [ ] `cmd /c mklink /J` junction created. `Get-Item` shows `LinkType = Junction` and `Target` matches `.agents/memory/`.
- [ ] Post-swap re-verification: same fresh-claude + copilot tests through the junction succeed. Restore from backup if either fails.
- [ ] Final pre-delete parity check: Compare-Object the junction-resolved path against `memory.bak`. Must match exactly.
- [ ] `memory.bak` removed.
- [ ] No git commits (filesystem-level, out of tree).
**Dependencies:** US-002 (so contributors who pull the repo can find the convention before the user-dir disappears)
**Estimated complexity:** small (but data-loss-risky if AC sequence is broken)
