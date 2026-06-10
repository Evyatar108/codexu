# Stories Outline: Fix codex crew member wt.exe tab title not maintained

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> All paths are relative to the `ai-developer-toolkit/plugins/crews/` SUBMODULE of codexu. Edit the
> PLUGIN `AGENTS.md`/`CHANGELOG.md`, never the codexu root ones. Never `git add` the gitignored codexu
> root `CLAUDE.md`. The impl must rebase onto the sibling task
> `crews-pidalive-false-positive-recycled-pid` if that ships first (both edit `hooks/actors.js`).

## US-001: Maintain the codex member tab title in the generated launcher
**Description:** As an operator running codex crew members, I want the wt.exe tab to stay renamed to
`♙ <name> (<crew>)` through codex startup and turns (like copilot/claude tabs), so I can tell member
tabs apart at a glance instead of seeing "Windows PowerShell".
**Acceptance Criteria:**
- [ ] In `hooks/actors.js` `spawnMember`, the generated launcher `.ps1` sets the console/tab title to
      `♙ <name> (<crew>)` via `$Host.UI.RawUI.WindowTitle` (recommended; `[Console]::Title` or an OSC
      write are acceptable fallbacks). The line is gated `engine === 'codex'` and uses
      `sessionDisplayName` (in scope; NOT `tabTitle`, which is defined later).
- [ ] The title-set line is positioned BEFORE `& ${launcherCommand}` (i.e. before `& codex`) in the
      generated script.
- [ ] `buildLauncherCommand` and `buildLauncherInvocation` are UNCHANGED; the codex launcher still
      emits `-c 'tui.terminal_title=[]'`.
- [ ] `tests/codex-engine-field.test.js` asserts BOTH (a) the codex launcher script sets the title to
      `♙ alice (demo)` AND (b) an ordering assertion that the title-set line index < the `& codex` index.
- [ ] `tests/engine-field.test.js` and/or `tests/copilot-review-fixes.test.js` assert that BOTH the
      copilot AND the claude launcher scripts contain NO occurrence of the chosen title-set mechanism
      string (no codex title-set line leaks into copilot/claude).
- [ ] `node --check hooks/actors.js` passes; `node --check` on each changed test file passes.
- [ ] `node tests/run.js` is green (run with `C:\Program Files\Git\bin` first on PATH so bash-stub
      tests don't hang on WSL bash).
- [ ] Typecheck passes (`node --check` on changed JS — crews has no package.json/tsconfig).
**Dependencies:** None
**Estimated complexity:** small

## US-002: Version bump + docs (CHANGELOG + AGENTS.md note)
**Description:** As a maintainer, I want the crews version bumped and the docs updated so the codex
title fix ships cleanly and the stale v1.5.7 "does NOT re-stamp" note is corrected.
**Acceptance Criteria:**
- [ ] `node plugins/crews/scripts/bump-version.js <new-version>` run, where `<new-version>` is the next
      available patch (3.19.2 if this ships first, else 3.19.3 — pick the free version at ship time
      after rebasing onto the sibling task). It updates the 6 stamp files (3 plugin manifests + 3
      marketplace indexes) + the pinned literal in `tests/version.test.js`.
- [ ] `tests/version.test.js` passes; all 6 stamp files carry the new version.
- [ ] `CHANGELOG.md` (the PLUGIN one) has a `## <new-version>` entry describing the codex tab-title fix.
- [ ] `AGENTS.md` (the PLUGIN one): the v1.5.7 "does NOT re-stamp the title via `$Host.UI.RawUI.WindowTitle`"
      bullet (~line 3854) is reworded so it stays accurate for claude/copilot and notes the codex
      exception; AND a new `## v3.x` section documents the codex launcher title re-stamp (rationale:
      codex's rewriter is disabled via `tui.terminal_title=[]`; the `sessionDisplayName`-not-`tabTitle`
      scope detail; the `engine === 'codex'` gate; the chosen mechanism; and the live-smoke record).
- [ ] Typecheck passes (`node --check` on any changed JS).
**Dependencies:** US-001
**Estimated complexity:** small

## Manual acceptance (NOT an automated story — lead/operator performs at/after ship)
- A LIVE codex member spawn visually confirms the wt tab reads `♙ <name> (<crew>)` and STAYS that way
  through codex's ~60–90s startup AND a few turns. Exit-code-only smoke is a FALSE POSITIVE for
  tab-title bugs (the v2.2.0/v3.1.1 wt rename-tab lesson). Record the outcome (pass/fail + chosen
  mechanism + observations) in the impl `kind=done` report and the AGENTS.md v3.x note / ship notes.
