# Research Brief: codex member tab-title not renamed

Source read from the primary checkout `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/`
(the plan worktree has the `ai-developer-toolkit` submodule uninitialized). All line numbers
are approximate and MUST be re-pinned by the impl member — `hooks/actors.js` is ~3100 lines and
drifts; anchor edits on surrounding code, not raw line numbers.

## Consolidated File List

### Files to modify (impl)
- `hooks/actors.js` — `spawnMember` generated launcher `.ps1` template (add a codex-gated title-set line).
- `tests/codex-engine-field.test.js` — add a codex launcher title-set assertion.
- `tests/engine-field.test.js` and/or `tests/copilot-review-fixes.test.js` — add copilot+claude "unchanged / no codex title line" regression assertions.
- `CHANGELOG.md` — prepend the new version entry.
- `AGENTS.md` — update the v1.5.7 "does NOT re-stamp" note (line ~3854) + add a v3.x section.
- Version stamps via `scripts/bump-version.js` (6 files) + `tests/version.test.js`.

### Files to read for context (NOT modified by this fix)
- `hooks/actors.js` `buildLauncherCommand` (codex branch) and `buildLauncherInvocation` (codex branch) — confirm they are NOT touched.
- `hooks/terminal-title.js` — helper reference (`formatCrewTabTitle`, `buildOscTitle`, `ROLE_GLYPHS`).
- `codex/external/repos/codex-patched/codex-rs/tui/src/{terminal_title.rs, chatwidget/status_surfaces.rs, bottom_pane/title_setup.rs}` — the codex-side evidence (read-only; codex is NOT changed by this task).

## 1. spawnMember launcher template (`hooks/actors.js`)

VERIFIED directly:
- `const sessionDisplayName = `♙ ${safeName} (${safeCrew})`;` is computed EARLY (~actors.js:2450).
  This is the value claude/copilot pass to their engine `--name` flag, and it is byte-identical to `tabTitle`.
- `const scriptLines = [ ... ]` initial array (~actors.js:2464-2539) contains the per-engine branch
  `...(engine === 'copilot' ? [...] : engine === 'codex' ? [...] : [...])` (~2498-2538). The codex
  branch (~2516-2533) scrubs Claude/Copilot identity env vars + stamps `CREWS_CODEX_SESSION_ID`.
- `const launcherCommand = buildLauncherCommand(engine, {...})` (~2611).
- `scriptLines.push( ... )` (~2619-2639) appends: `launcher.pid` write, inner-pid-capture lines,
  `Set-Location '<physicalCwd>'` (~2625), `& ${launcherCommand}` (~2631), the `CREWS_KEEP_TAB_OPEN`
  branch, and `exit 0`.
- `const tabTitle = `♙ ${safeName} (${safeCrew})`;` is computed LATER (~actors.js:2670), in the
  wt.exe spawn section AFTER the noLaunch/platform guards. `wtArgs = ['-w', windowName, 'new-tab',
  '--title', tabTitle, 'pwsh', '-File', scriptPath]` (~2677).

CRITICAL SCOPE FACT (verified): `tabTitle` is defined AFTER `scriptLines.push`, so it is NOT in
scope when the launcher script lines are built. The launcher title-set must reference
`sessionDisplayName` (in scope, identical value `♙ ${safeName} (${safeCrew})`) or rebuild from
`safeName`/`safeCrew`. `psEscape`, `safeName`, `safeCrew`, `engine` are all in scope at the
scriptLines.push site.

## 2. buildLauncherCommand / buildLauncherInvocation codex branches

- `buildLauncherCommand` codex branch: `const ttyTitle = `-c 'tui.terminal_title=[]'`;` (~actors.js:371),
  emitted in both the resume and non-resume return paths (~376, ~379).
- `buildLauncherInvocation` codex branch: `argList.push('-c', 'tui.terminal_title=[]');` (~actors.js:447).
- Nothing else in actors.js consumes the codex `tui.terminal_title` value. THIS FIX DOES NOT TOUCH
  EITHER BUILDER — `tui.terminal_title=[]` stays exactly as-is (it is what keeps codex's rewriter
  disabled so the pwsh-set title persists).

## 3. terminal-title.js helpers
- `ROLE_GLYPHS = { lead: '\u2654', member: '\u2659' }` (member glyph ♙ U+2659).
- `formatCrewTabTitle('member', name, crew)` → `♙ ${name} (${crew})` (control chars stripped).
- `buildOscTitle(title)` → `\x1b]0;<sanitized>\x07`.
- `spawnMember` does NOT import these; it builds `tabTitle`/`sessionDisplayName` inline. To keep the
  launcher title-set byte-identical to the existing wt `--title`, prefer reusing the inline
  `sessionDisplayName` over introducing the helper (a helper import is optional DRY, not required).

## 4. Tests
- `tests/codex-engine-field.test.js` (THE codex launcher-script test): spawns `spawnMember('alice',
  'demo', cwd, 'hello', { engine: 'codex', noLaunch: true })`, reads `result.scriptPath`, regex-asserts
  the script — including `ok(/-c 'tui\.terminal_title=\[\]'/.test(script), ...)` (~line 79-80). Block at
  lines ~50-90 is the home for a NEW assertion: the codex launcher script contains the WindowTitle-set
  with `♙ alice (demo)`. The env-scrub blocks (~109-153) are the reciprocal-engine coverage.
- `tests/engine-field.test.js` — copilot (~27-33) + claude (~36-49) launcher-script assertions; the
  natural home for "copilot/claude launcher does NOT contain the codex WindowTitle line".
- `tests/copilot-review-fixes.test.js` — pins engine-asymmetric launcher bytes (copilot stamps
  `COPILOT_DISABLE_TERMINAL_TITLE=1` ~302; claude must NOT ~327; codex scrubs it ~364). Another valid
  home for the copilot/claude "no codex title-set line" regression.
- `tests/launcher-pid.test.js` — launcher script ordering / `exit 0` / no `-NoExit` (~22-49); confirms
  the script-inspection-under-noLaunch pattern.
- Expected launcher literal for the codex test (member `alice`, crew `demo`): `♙ alice (demo)`.

## 5. Ship checklist
- `scripts/bump-version.js` writes exactly 6 files (`bump-version.js:14-21,47-65`): the 3 plugin
  manifests (`.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json`)
  + 3 marketplace indexes (`.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`,
  `.agents/plugins/marketplace.json`), and updates the pinned literal in `tests/version.test.js`.
- `CHANGELOG.md` present at plugin root (manual prepend).
- `AGENTS.md:3854` — the v1.5.7 bullet: "The launcher `.ps1` does NOT re-stamp the title via
  `$Host.UI.RawUI.WindowTitle`. The CLI (claude/copilot) may overwrite the console title mid-session..."
  NOTE (researcher flag): this is written as a GENERAL v1.5.7 limitation, not a codex-specific rule.
  The note update must be precise: codex now DOES re-stamp; claude/copilot still rely on the engine's
  own OSC emission. Add a v3.x section documenting the codex re-stamp; reword (don't delete) the v1.5.7
  note so it remains accurate for claude/copilot.

## 6. Test runner / typecheck
- Full crew suite: `cd plugins/crews && node tests/run.js` (one fresh worker per test file; targets <60s
  on Windows at default concurrency). On this Windows box, prepend `C:\Program Files\Git\bin` to PATH so
  the bash-stub tests don't hang on WSL bash (per a stored repo memory). The new title test is pure-JS
  (no bash), so it is unaffected.
- JS typecheck gate (crews has no package.json/tsconfig): `node --check <changed-js-file>`.

## Architect risk assessment (corroborated)
- Edit is fully contained in `spawnMember` scriptLines; the two launcher builders are NOT touched, so
  the "keep both builders in sync" invariant is trivially satisfied (no builder change).
- Sibling task `crews-pidalive-false-positive-recycled-pid` edits the recycle-guard region
  (`verifyLauncherRecycleSafety`, ~actors.js:2320-2358), disjoint from the scriptLines region
  (~2464-2639). Low merge-conflict likelihood, but the impl MUST rebase onto whichever of the two
  ships first (same file).
- inner-pid-capture helper runs as a separate hidden pwsh; the title-set runs in the visible launcher
  pwsh. No interaction. No interaction with `CREWS_KEEP_TAB_OPEN` / `exit 0`.
- Resume path (`/resume-crew --confirm`) re-enters `spawnMember`, so the codex title-set is applied to
  resumed tabs for free (same as the existing wt `--title`).

## codex-side evidence (read-only; codex is NOT changed)
- `bottom_pane/title_setup.rs:37-87` — `TerminalTitleItem` is a fixed `EnumString` allowlist
  (app-name/project/spinner/status/thread/git-branch/...); NO free-text literal → approach (2) infeasible.
- `chatwidget/status_surfaces.rs:211-219` — empty `terminal_title` selections call
  `clear_managed_terminal_title()`, which is guarded `if self.last_terminal_title.is_some()` (None at
  startup) → with `terminal_title=[]` codex emits NO OSC title at all (no set, no clear).
- `chatwidget/status_surfaces.rs:230-253` — non-empty templates render + `set_terminal_title` per refresh
  (and animate), so a non-empty template would clobber the wt title with codex's own content.
- `terminal_title.rs:56-80` — set/clear write OSC 0 (`\x1b]0;...\x07`).
Conclusion: approach (1) (pwsh sets the title; codex stays silent) is correct and robust; approach (2)
is impossible.
