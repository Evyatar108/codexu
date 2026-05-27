# Research Brief: agent-memory-repo-migration

## Researcher Findings (Claude Agent 1)

### .agents/ layout (existing convention)

- `D:/harness-efforts/codexu/.agents/skills/<name>/SKILL.md` — directory-per-skill, YAML frontmatter mandatory (name, description, optional tools/model/color/maxTurns). Some skills have supplementary peer files (e.g., `maintain/checkpoint.md`).
- `D:/harness-efforts/codexu/.agents/agents/<name>.md` — single-file agents with YAML frontmatter (example: `triage-issues-and-prs.md`).
- **Important correction to CLAUDE.md claim:** `.agents/skills/` contains **canonical content**, NOT pointers to `D:/ai-developer-toolkit/plugins/...`. The CLAUDE.md statement about pointer files describes a potential pattern that is NOT currently used in codexu.

### AGENTS.md current structure

- File: `D:/harness-efforts/codexu/AGENTS.md` (tracked).
- Sections (in order): Header → Fork context → Ralph pipeline context → Entry points table → Working preferences → Windows-specific cautions → Ralph-orchestration workflows → Upstream cherry-picking → Typed context boundaries.
- References `.agents/skills/*` via the Entry points table (lines 31-33) using explicit markdown links, NOT @-directives.
- No `@./` include directives anywhere in AGENTS.md. The only `@` patterns in the file are package references like `@slopus/happy-wire`.

### CLAUDE.md status

- File exists at `D:/harness-efforts/codexu/CLAUDE.md` but is **gitignored** (`.gitignore:67` excludes `CLAUDE.md`).
- Per AGENTS.md header: "Filed as `AGENTS.md` rather than `CLAUDE.md` because the upstream repo's `.gitignore` excludes root-level `CLAUDE.md`."
- The bookkeeper operating manual lives at this local-only CLAUDE.md. Updates to it are per-machine.

### Auto-memory user-dir (file count correction)

- Path: `C:/Users/evmitran/.claude/projects/D--harness-efforts-codexu/memory/`.
- **Actual count: 18 files** = `MEMORY.md` + 17 memory entries (16 feedback_*.md + 1 project_*.md). The feature-request prompt's "17 files" count is off by one.
- Memory file format: YAML frontmatter (`name`, `description`, `metadata.type`, `metadata.node_type: memory`) + markdown body using `[[wikilinks]]` (slug-based, resolves by filename — survives relocation).
- MEMORY.md index format: bulleted list `- [Title](filename.md) — one-line hook`. Links are **relative markdown paths**, NOT wikilinks, so they continue to resolve after a directory move as long as all files move together.

### docs/ directory

- `D:/harness-efforts/codexu/docs/fork-notes.md` (88.5 KB) — extensive fork documentation; no current mention of .agents/memory.
- `D:/harness-efforts/codexu/docs/CONTRIBUTING.md` (5.3 KB) — contributor onboarding doc.
- Subdirs: decisions/, experimental/, operations/, plans/, research/, spikes/, validation/.

### .gitignore relevant entries

- `CLAUDE.md` (line 67), `CLAUDE.local.md`, `.claude/CLAUDE.md`, `.claude/settings.local.json`, `.claude/*.lock`, `.claude/worktrees/`.
- `.agents/` is **not** in `.gitignore` — `.agents/memory/**` will be tracked normally.

### Migration script precedent

- `scripts/fork-setup/setup-services.ps1` — idempotent PowerShell pattern with prerequisites, error handling, colored output. Establishes the style if a migration script is added.

### README.md

- `D:/harness-efforts/codexu/README.md` — consumer-facing, no .agents/ references. `.agents/memory/` documentation belongs in AGENTS.md and docs/fork-notes.md, not README.md.

---

## Architect Analysis (Claude Agent 2)

### Auto-load mechanism (CRITICAL FINDING)

**claude-code auto-loads `MEMORY.md` from `C:/Users/evmitran/.claude/projects/<project-slug>/memory/MEMORY.md` ONLY.** It does NOT auto-discover `.agents/memory/MEMORY.md` from a repo. Evidence:

- Feature request line 8 + CLAUDE.md references confirm the user-dir contract.
- No tracked documentation in codexu references claude-code's auto-load behavior — it is implicit.
- AGENTS.md auto-load means agents discover it as a file to read; it does NOT support `@include` directives. The format originated with OpenAI/Continue and is plain markdown.

**Consequence:** Option (c) "replace" (delete user-dir, rely on AGENTS.md/CLAUDE.md auto-load to discover the new location) **is not viable** — claude-code will lose its auto-load contract and memories become manual-read-only.

### AGENTS.md @-directive support

- **Not supported.** No precedent in the codexu repo; AGENTS.md uses explicit markdown cross-references everywhere.
- Plan MUST fall back to **inline TOC + documented pointer** (no @-directive dependency).

### Symlink/junction on Windows

- **Use `mklink /J` (junction), not `mklink /D` (directory symlink).** Justification:
  1. Junctions work cross-drive (C: → D:) on NTFS.
  2. Junctions require **neither Admin nor Developer Mode**, unlike directory symlinks.
  3. The codexu repo already uses junctions extensively for cross-repo linking (`plans/codexu-roadmap.md:25,108-112,648` document existing junction-based workflows: `codexu/ralph`, `codexu/options-mode`, `codexu/inspirations/oh-my-codex`).
  4. NTFS-native, no special filesystem support needed.

### Migration mode decision (a vs c)

| Mode | Pros | Cons | Verdict |
|---|---|---|---|
| **(a) move-and-link** | Preserves claude-code auto-load contract; no behavior change | Adds per-developer Windows-specific junction setup; Mac/Linux operators need different setup if they ever appear | **RECOMMENDED** |
| (c) replace | Cleaner long-term, fully Git-tracked | **Breaks claude-code auto-load** — operator must manually read MEMORY.md at session start | NOT VIABLE |

**Decision: option (a) move-and-link with NTFS junction.**

### Integration points (consumption paths)

Memory consumption is **documentation-driven, not code-driven**:

1. `D:/harness-efforts/codexu/CLAUDE.md` (lines 24, 68, 194) — inline wikilink references; works after migration as long as the index file is reachable.
2. `plans/codexu-roadmap.md:852` — documents current user-dir path (UPDATE post-migration).
3. `plans/in-flight-2026-05-26.md:88` — lists auto-memory as a dependency.
4. `.ralph/jobs/*/plan.md` — Ralph jobs reference memory entries by slug.
5. **No automation reads the memory directory path.** No code in `packages/`, `scripts/`, or `tools/` is affected by the path change.

### Risks

1. **Concurrent edits:** The lead session may be writing to memory during migration. Mitigation: copy first (US001), keep user-dir intact until US003.
2. **Memory loss if junction creation fails:** Don't delete user-dir until verified. US003 defers cleanup; do verification in a fresh claude-code session BEFORE deletion.
3. **AGENTS.md TOC staleness:** The inline TOC will go stale as new memories are added. Mitigation: note "this is a curated subset; see MEMORY.md for the full list."
4. **Wikilink resolution:** Wikilinks resolve by slug filename, so moving all files together preserves resolution. Verified.

---

## Codex Research (xhigh)

- Confirms `.agents/memory/` is natural sibling to `.agents/skills/` and `.agents/agents/`.
- Confirms 18-file count (MEMORY.md + 17 entries). Plan acceptance language must say "18 files" not "17".
- AGENTS.md `@`-include directive support: **no repo precedent found**. Do not depend on it.
- Worktree dirty status: implementation should stage only `.agents/memory/**`, `AGENTS.md`, `docs/fork-notes.md`, and optionally local-only `CLAUDE.md`. Do not let unrelated `.ralph/`, `plans/`, `tasks/`, or submodule changes leak in.
- Windows symlink path: prefer PowerShell `New-Item -ItemType SymbolicLink` if available, or `cmd /c mklink /J` directory junction.
- Recommends **mode (a) move-and-link**.
- Suggests: rename old user-dir as backup BEFORE creating junction (extra safety net for US003).

## Copilot Research (xhigh)

- Confirms `.agents/memory/` does not exist yet.
- Confirms 18-file count (MEMORY.md + 17 entries) and flags the "17 files total" prompt count as off-by-one.
- Confirms CLAUDE.md is gitignored and only AGENTS.md can carry tracked guidance.
- Confirms no AGENTS.md `@`-include directive precedent in the repo.
- Notes `plans/codexu-roadmap.md` lines 851-853 still reference the old user-dir memory path → UPDATE post-migration.
- Recommends **mode (a) move-and-link** with the same 3-story decomposition.

---

## Consolidated File List

### Files to modify
- `D:/harness-efforts/codexu/AGENTS.md` — add Auto-memory section with inline TOC + pointer to `.agents/memory/MEMORY.md`.
- `D:/harness-efforts/codexu/CLAUDE.md` — mirror the Auto-memory section (gitignored, local-only).
- `D:/harness-efforts/codexu/docs/fork-notes.md` — add a short subsection documenting the `.agents/memory/` convention + `mklink /J` setup recipe.
- `D:/harness-efforts/codexu/plans/codexu-roadmap.md` (lines 851-853) — update the user-dir reference to the new `.agents/memory/` location (deferrable; bookkeeper data, low blast radius).

### Files to create
- `D:/harness-efforts/codexu/.agents/memory/MEMORY.md` — index, moved from user-dir.
- `D:/harness-efforts/codexu/.agents/memory/feedback_*.md` (16 files) — moved from user-dir.
- `D:/harness-efforts/codexu/.agents/memory/project_crews_v153_stale_armed_fix.md` — moved from user-dir.

### Reference files (existing)
- `D:/harness-efforts/codexu/.agents/skills/maintain/SKILL.md` — directory-per-skill convention model.
- `D:/harness-efforts/codexu/.agents/agents/triage-issues-and-prs.md` — agent-file pattern.
- `D:/harness-efforts/codexu/AGENTS.md` (header) — explains AGENTS.md vs CLAUDE.md rationale.
- `D:/harness-efforts/codexu/scripts/fork-setup/setup-services.ps1` — idempotent script style.
- `D:/harness-efforts/codexu/.gitignore` — confirms `.agents/` is tracked, CLAUDE.md is not.

### Build/config
- None. No build steps, no package code, no typecheck/vitest impact.
