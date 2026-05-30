# Stories Outline: Crews Orchestrator Tab Rename

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Shared lead title helper

**Description:** As the crews plugin, I want a shared helper for lead tab title formatting and best-effort terminal renaming so both assignment and SessionStart use the same title policy.

**Acceptance Criteria:**
- [ ] `hooks/terminal-title.js` or equivalent exports a formatter that returns `♔ <name> (<crew>)` for lead titles.
- [ ] The helper builds an OSC title sequence for immediate terminal feedback.
- [ ] The helper invokes `wt.exe -w 0 rename-tab <title>` with an argument array only when `process.platform === 'win32'` and `WT_SESSION` is present.
- [ ] The helper strips control characters from user-derived title text before emitting OSC or passing args to `wt.exe`.
- [ ] WT rename failures are logged via existing crews logging and do not throw through role assignment.
- [ ] Tests cover at least one `wt.exe` failure path, such as spawn error, missing executable, or non-zero exit, and prove role assignment still returns success.
- [ ] Unit tests cover title formatting, OSC construction, WT guard behavior, and spawn arguments.
- [ ] Typecheck/syntax checks pass.

**Dependencies:** None

**Estimated complexity:** medium

## US-002: Wire lead assignment and SessionStart

**Description:** As a crew lead, I want my already-running orchestrator tab renamed when I become or resume as lead so I can find the orchestrator tab beside member tabs.

**Acceptance Criteria:**
- [ ] Successful `/crews-assign-role lead --crew <crew> --name <name>` attempts the WT rename. It may include OSC in the returned text, but correctness cannot depend on OSC surviving slash-command JSON wrapping.
- [ ] `/crews-assign-role member`, `/crews-assign-role none`, and blocked reassignment paths do not invoke lead title renaming.
- [ ] SessionStart lead rehydration invokes the same helper for env bootstrap and existing lead flags.
- [ ] Existing member-side spawn tab naming in `hooks/actors.js` is untouched.
- [ ] Unit tests cover explicit lead assignment, SessionStart lead bootstrap, and at least one negative non-lead path.
- [ ] Typecheck/syntax checks pass.

**Dependencies:** US-001

**Estimated complexity:** medium

## US-003: Version, changelog, and smoke record

**Description:** As the plugin maintainer, I want release metadata and notes to describe the new lead title behavior and its smoke-test result so future operators know the intended mechanism and limitations.

**Acceptance Criteria:**
- [ ] `.claude-plugin/plugin.json` is bumped from `2.1.0` to `2.2.0`.
- [ ] `.github/plugin/plugin.json` is bumped from `2.1.0` to `2.2.0`.
- [ ] `CHANGELOG.md` has a `## 2.2.0 - 2026-05-30` entry describing lead tab renaming, Option C (OSC + WT rename), and why late `COPILOT_DISABLE_TERMINAL_TITLE` mutation is not used.
- [ ] CHANGELOG records a manual smoke test: fresh Copilot session, two WT tabs in the same window, `/crews-assign-role lead`, visible `♔ <name> (<crew>)` title on the intended active tab, and behavior after at least one subsequent tool call.
- [ ] If smoke finds `wt.exe rename-tab` does not persist over Copilot title updates, CHANGELOG records the limitation and required operator-level workaround, and the implementation does not claim persistence.

**Dependencies:** US-002

**Estimated complexity:** small
