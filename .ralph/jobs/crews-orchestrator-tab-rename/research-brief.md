# Research Brief: Crews Orchestrator Tab Rename

## Feature Request

When a crew lead is assigned to an existing terminal session, rename the host Windows Terminal tab to:

```text
♔ <name> (<crew>)
```

This should mirror member tabs, which are created as `♙ <name> (<crew>)`.

## Relevant Files

### Files to modify

- `D:/ai-developer-toolkit/plugins/crews/hooks/commands/assign-role.js`
  - Explicit `/assign-role lead --crew <crew> --name <name>` path.
  - Calls `assignRole`, upserts lead registry, and returns lead context.
- `D:/ai-developer-toolkit/plugins/crews/hooks/session-start.js`
  - SessionStart lead rehydration path.
  - Handles `CREWS_ROLE=lead` env bootstrap and existing lead flags.
- `D:/ai-developer-toolkit/plugins/crews/hooks/terminal-title.js` (new)
  - Shared helper for title formatting and best-effort terminal rename.
- `D:/ai-developer-toolkit/plugins/crews/CHANGELOG.md`
  - Current top version is `2.1.0 - 2026-05-30`.
- `D:/ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json`
  - Current version `2.1.0`.
- `D:/ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json`
  - Current version `2.1.0`.

### Existing member-side precedent

- `D:/ai-developer-toolkit/plugins/crews/hooks/actors.js`
  - `sessionDisplayName = ♙ <name> (<crew>)`
  - `tabTitle = ♙ <name> (<crew>)`
  - `wt.exe -w <windowName> new-tab --title <tabTitle> ...`
  - Copilot launchers stamp `$env:COPILOT_DISABLE_TERMINAL_TITLE = '1'` before launching Copilot.
- `D:/ai-developer-toolkit/plugins/crews/AGENTS.md`
  - Documents why Copilot title suppression must happen before process startup.
- `D:/ai-developer-toolkit/plugins/crews/tests/copilot-review-fixes.test.js`
  - Existing coverage for Copilot launcher title suppression.

### Test surfaces

- `D:/ai-developer-toolkit/plugins/crews/tests/assign-role-flag.test.js`
- `D:/ai-developer-toolkit/plugins/crews/tests/assign-role-reassignment-guard.test.js`
- `D:/ai-developer-toolkit/plugins/crews/tests/session-start-lead-bootstrap.test.js`

## Mechanism Assessment

### Option A: OSC only

Pros: simple, cross-terminal, no subprocess. Cons: Copilot can continue writing per-intent OSC titles in an already-running process. Existing member-side research shows the env var that suppresses this is startup-only. In the slash command path, output is JSON-wrapped before the host displays it, so raw OSC may be escaped instead of executed. OSC-only is therefore too weak for the persistence acceptance criterion.

### Option B: `wt.exe rename-tab` only

Pros: uses Windows Terminal's own tab rename surface and should behave like a user manual rename. Cons: no immediate fallback for non-WT terminals and no visible update if `wt.exe` is absent or unsupported. It also needs guardrails so non-WT shells do not rename the last-focused WT window accidentally.

### Option C: OSC + `wt.exe rename-tab` (recommended)

Pros: durable WT title override for the explicit assignment path, direct-stdout OSC fallback for SessionStart/non-WT terminals, graceful degradation outside WT. Cons: needs careful best-effort error handling and manual smoke validation that the WT override targets the intended active tab and survives subsequent Copilot title writes.

### Option D: Document-only/manual rename

Rejected. The operator requested automatic lead/orchestrator tab naming.

## Constraints and Policies

- Emit only on role transition/assignment and SessionStart lead rehydration. Do not run on every listener heartbeat. SessionStart rehydration intentionally reapplies the lead identity on every lead session start/resume.
- Do not attempt to mutate `COPILOT_DISABLE_TERMINAL_TITLE` for an already-running lead process; it is read at Copilot startup.
- Use argument arrays for `wt.exe`; do not build shell command strings with user-controlled names.
- Guard WT rename with `process.platform === 'win32'` and `WT_SESSION`.
- Allow `/crews-assign-role none` to leave the last title in place for this release.

## Validation Plan

- `node --check hooks/terminal-title.js hooks/commands/assign-role.js hooks/session-start.js`
- `node tests/assign-role-tab-title.test.js`
- `node tests/session-start-lead-bootstrap.test.js`
- `node tests/assign-role-flag.test.js`
- Manual smoke in a fresh Copilot session inside Windows Terminal:
  1. Run `/crews-assign-role lead --crew smoke --name orchestrator`.
  2. Confirm tab title becomes `♔ orchestrator (smoke)` within about 1 second.
  3. Include a second tab in the same WT window and verify the active lead tab, not the neighbor, is renamed.
  4. Run one subsequent Copilot tool call.
  5. Confirm title persists and does not revert to per-intent text, or record the clobbering limitation and required operator-level workaround.
