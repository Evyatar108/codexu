# Research Brief: crews v3.4 Stop-hook bundle (US-001 + US-002)

Compiled from 4 parallel research streams: researcher (explore), architect (explore), codex xhigh, copilot xhigh. Strong consensus across all sources.

---

## Researcher Findings (explore)

### US-001 `detector-broaden-infra-filter`

**`hooks/listener-protocol.js`:**
- `isListenerArmCall(cmd)` signature at `hooks/listener-protocol.js:113-116`.
- Existing regex patterns (verbatim):
  - `ARM_PATTERN_CREWS = /\bnode(?:\.exe)?\s+(?:(?:['"][^'"]*?|\S*)crews\.js['"]?|\$(?:env:)?CREWS_BIN|%CREWS_BIN%)\s+arm(?=\s|$)/i;` (`:110`)
  - `ARM_PATTERN_LEGACY = /\bnode(?:\.exe)?\s+(?:['"][^'"]*?|\S*)wait-for-message\.js(?=['"]?\s|['"]?$)/i;` (`:111`)
- `isListenerArmCall` is wrapped by `isListenerArmToolCall` at `:131-135`.
- Exports list at `:269-283` (new `isCrewsCliInfraCall` must be added here AND in `listener-protocol.test.js`'s pinned-exports assertion).

**`hooks/detect-active-bg.js`:**
- Purpose: Copilot `events.jsonl` background-task detector for the Stop `progress + no-bg` gate.
- Key exports: `detectActiveBg` plus helpers `readEvents`, `indexEvents`, `isActiveAt`, `compareTs`, `ASYNC_SHELL_TOOL_NAMES` (`:251-259`).
- LISTENER FILTER comment block: `:38-44`.
- Filter call site: `const isListener = isListenerArmCall(start.command);` at `:225-230`.
- US-001 change: import both predicates, use `isListenerArmCall(cmd) || isCrewsCliInfraCall(cmd)`.

**All `isListenerArmCall` consumers in `plugins/crews/` (must not regress):**
- `hooks/detect-active-bg.js:41-44, 79, 225` — bg detector filter (this is the only consumer being broadened via OR).
- `hooks/pre-tool-use.js:31-38, 69-79, 124-131` — **PreToolUse arm-call recognition.** This is the safety surface that REQUIRES `isListenerArmCall` to stay narrow. Broadening it would let `stop-member`, `clear-member`, etc. through the PreToolUse arm-first gate.
- Test consumers (must continue passing): `tests/briefing-render.test.js`, `tests/copilot-listener-arm-detection.test.js`, `tests/listener-protocol.test.js`, `tests/progress-bg-gate.test.js`.

**`tests/progress-bg-gate.test.js`:**
- Existing detector coverage IS here (no separate `tests/detect-active-bg.test.js` file exists). Extend this file rather than create a new one.
- Existing listener-filter cases (lines ~179-210 per codex) already cover `wait-for-message`, `crews.js arm`, `$env:CREWS_BIN arm`.
- US-001 needs new cases: `crews.js status`, `$env:CREWS_BIN status`, and a counterexample `node my-script.js`.
- Test fixture pattern: synthetic `events.jsonl` written line-by-line with `JSON.stringify(...) + '\n'` (`tests/progress-bg-gate.test.js:34-37`).

### US-002 `require-lead-listener-unconditionally`

**`hooks/stop.js`:**
- `LISTENER_REQUIRED_KINDS = new Set(['done', 'question', 'blocked'])` at `:71-73`.
- `shouldRequireArmedListener({ role, kind, queueDepth } = {})` body verbatim (`:111-115`):
  ```js
  if (role !== 'member' && role !== 'lead') return false;
  if (LISTENER_REQUIRED_KINDS.has(String(kind || ''))) return true;
  return Number.isFinite(queueDepth) && queueDepth > 0;
  ```
- `decideStopBlock` starts at `:637`; listener-gate check is at `:641-645`.
- `effectiveTurnKind(role, parsedKind)` at `:105-109` synthesizes `kind='progress'` for leads. **This means today's lead prose-only turn calls `shouldRequireArmedListener({role:'lead', kind:'progress', queueDepth:0})` → false (the bug).**
- Lead-asymmetry comment at `:674-675` ("Being a lead means staying reachable...") must be updated.
- `appendLog` is imported from `./mailbox` at `:4`; call signature is `appendLog(message, cwd)` (positional, cwd second). Examples in this file at `:659-662`, `:675-678`. Style: terse `tag: k=v ...` prefix.

**Test file reality check** (original spec mentioned files that don't exist):
- `tests/stop-hook.test.js` — **does not exist**.
- `tests/listener-arm-not-required.test.js` — **does not exist**.
- `tests/detect-active-bg.test.js` — **does not exist**.
- Actual test surface for US-002:
  - `tests/stop-decision.test.js` — pure-policy tests for `shouldRequireArmedListener` and `decideStopBlock`. Existing assertions today (per researcher):
    - member `kind='progress'`, `queueDepth=0` ⇒ exempt
    - member `kind='progress'`, `queueDepth=1` ⇒ requires listener
    - member `kind='done'`, `queueDepth=0` ⇒ requires listener
    - lead `kind='question'`, `queueDepth=0` ⇒ requires listener
  - `tests/stop-hook-defers-to-armed-listener.test.js` — member with `listenerState='armed'` + pending mailbox ⇒ Stop allows.
  - `tests/stop-hook-consumes-when-listener-exited.test.js` — member with `listenerState='exited'` + pending mailbox ⇒ Stop blocks + drains mailbox.
  - `tests/role-gate.test.js` — existing lead prose-only pass case at lines 101-117 per codex; **must change** so lead prose-only requires armed listener.
  - `tests/first-turn-listener-guard.test.js` — existing member `kind=progress` no-listener pass case at lines 121-137 per codex; **must continue passing** (member regression anchor).

### Shared scope

**`CHANGELOG.md`:**
- Format: plain semver, `## 3.3.0 - 2026-06-03` heading (NO `v` prefix).
- Style: narrative entries with bolded subheads like `**Rationale**`, `**Edit sites**`, `**Test changes**`.
- Top entries: 3.3.0, 3.2.0, 3.1.2, 3.1.1.
- No BREAKING/Added/Fixed section structure.

**`AGENTS.md` (plugins/crews/AGENTS.md) sections to amend:**
- `## v3.3.0 progress-bg gate bypass removal` (extend with v3.4.0 infra-filter note)
- `## Crews plugin invariants (v1.9.2)` (extend with lead-asymmetric listener rule)
- `## Crews stop-hook semantics (for reference)` (extend with v3.4 lead-listener-unconditional rule)
- `## v1.8.1 lead routine-kind footer exemption` (cross-reference; lead exemption from kind tag does NOT exempt from listener gate)
- `## v1.6.2 listener arm command shape` (cross-reference for the new infra detector regex)

**`.claude-plugin/plugin.json`:**
- Current `version`: `3.3.0`. Bump to `3.4.0` via the canonical script (next bullet).

**Version bump (canonical):**
- Run `node plugins/crews/scripts/bump-version.js 3.4.0` from `ai-developer-toolkit/`.
- Auto-updates: both plugin manifests (`.claude-plugin/plugin.json` AND `.github/plugin/plugin.json` per copilot research), three marketplace JSON indexes, and `tests/version.test.js`.

**Test runner / configs:**
- No `package.json` under `plugins/crews`. No `vitest.config.*` or `jest.config.*`.
- Test runner: `node tests/run.js` (from `plugins/crews/`, recursive `tests/**/*.test.js` discovery).
- Typecheck per touched JS file: `node --check <file>`.

**Naming/style conventions:**
- Hooks are CommonJS (`require(...)`, `module.exports`). NOT ESM.
- Test files: kebab-case `*.test.js`.
- Synthetic events fixture style: line-by-line `JSON.stringify(obj) + '\n'`.

---

## Architect Analysis (explore)

### US-001 architecture decisions

**Two-filter design is correct (not one broadened filter):**
- `pre-tool-use.js` uses `isListenerArmCall` as the SAFETY gate for actual listener-arm invocations (`hooks/pre-tool-use.js:65-79, 104-123`).
- `detect-active-bg.js` reuses the same detector for bg filtering (`:38-45, 79-80`).
- Keep `isListenerArmCall` narrow; add a SECOND predicate `isCrewsCliInfraCall` for infra noise. The OR-combination at the detect-active-bg call site is the design.

**Regex risk for the proposed `isCrewsCliInfraCall`:**
The naive form in the original spec — `(node|node.exe)\s+(\S*crews\.js|\$(env:)?CREWS_BIN|%CREWS_BIN%)\s+\S+` — would miss:
- Quoted `crews.js` paths with spaces (e.g. `node "C:/Program Files/.../crews.js" status`)
- PowerShell `&` invocation operator forms (e.g. `& node $env:CREWS_BIN status`)
- `pwsh`-spawned wrappers that don't start with `node`
- `npx crews ...` invocations
- Single vs double-quote variants around `$CREWS_BIN`

**Recommendation:** mirror the existing `ARM_PATTERN_CREWS` regex style — `\bnode(?:\.exe)?\s+(?:(?:['"][^'"]*?|\S*)crews\.js['"]?|\$(?:env:)?CREWS_BIN|%CREWS_BIN%)\s+\S+` (i.e., same `crews.js` quote-handling shape, but match any subcommand `\S+` instead of literal `arm`). Substring-style anchoring with `\b` is consistent with the existing detector; don't introduce `^` anchoring asymmetrically.

**Actual crews.js invocation shapes found in the codebase:**
- Briefing-recommended form for members: `node $CREWS_BIN arm ...`
- Resume-crew commentary: still references `wait-for-message.js`
- Test fixtures use forms: `node /p/wait-for-message.js ...`, `node 'C:/x/crews.js' arm ...`, `node $CREWS_BIN arm`, `node $env:CREWS_BIN arm`.

### US-002 architecture decisions

**Asymmetry is principled:**
- Leads are reachability points (their inbound mailbox is the only inbound work channel for the crew).
- Members are short-lived per-task workers; their progress-tag mid-stream is legitimately not a moment that requires an armed listener (next tool call re-arms via PreToolUse).
- `hooks/stop.js` already has lead-asymmetric branches (e.g., `effectiveTurnKind` synthesizes lead default kind; lead block prose differs at `:674-675`). The proposed change extends an existing pattern rather than introducing one.

**Impact on existing tests:**
- `tests/stop-decision.test.js` currently has at least one lead assertion that may need rephrasing: any test that asserts `shouldRequireArmedListener({role:'lead', kind:'progress', queueDepth:0}) === false` (the buggy behavior) flips to `true`. The lead `kind='question'` test continues to return `true` (no change in outcome, change in reason).
- `tests/role-gate.test.js` line ~101-117 lead prose-only pass case — must be updated to require armed listener.
- `tests/first-turn-listener-guard.test.js` line ~121-137 member `kind=progress` no-listener pass case — **regression anchor**, must continue passing.

**`appendLog` format examples in `hooks/stop.js`:**
- Style: `tag: k=v ...` prose prefix, positional cwd.
- Examples at `:659-662`, `:675-678`.
- New log message: `appendLog(\`stop: lead-listener-required name=\${name} crew=\${crew} actorState=\${actorState} listenerState=\${listenerState}\`, stateCwd);`

**Race window:**
The new gate closes the Stop-side window (lead prose-only with exited listener now blocks at Stop instead of silently passing). It does NOT close the entire race — if a message arrives 100ms after Stop reads an empty mailbox, PreToolUse still handles arming on the next tool call. The improvement is observability + reduced exited-window duration, not zero-race.

**Stop-hook ordering** (important for test design):
Listener reachability is evaluated BEFORE the progress-bg gate (`hooks/stop.js:1011-1037` vs `:1039-1107`). This means the US-002 change cannot accidentally interact with US-001 — they are sequential gates.

### Bundle architecture

**Parallelism within the bundle:**
- US-001 touches: `hooks/listener-protocol.js`, `hooks/detect-active-bg.js`, `tests/progress-bg-gate.test.js`, `tests/listener-protocol.test.js`.
- US-002 touches: `hooks/stop.js`, `tests/stop-decision.test.js`, `tests/role-gate.test.js`, `tests/first-turn-listener-guard.test.js`.
- Code/test files are **fully disjoint**. No file-level conflict between stories.

**Shared coordination touchpoints** (where parallel impl WOULD conflict):
- `CHANGELOG.md` (single new `## 3.4.0` block)
- `plugin.json` x 2 + 3 marketplace JSON indexes + `tests/version.test.js` (all auto-bumped by `scripts/bump-version.js`)
- `plugins/crews/AGENTS.md` (multiple sections need extending)

**Sequencing recommendation:**
Given the shared coordination files (5+ files auto-bumped by the version script + manual CHANGELOG + AGENTS), implementing the two stories in serial on ONE branch (`ralph/crews-v3.4-bundle`) is materially safer than two parallel branches that both bump the version. Single-branch serial is the recommended decomposition.

**Phase 5a/5b gates:**
- Typecheck: `node --check <each-changed-js-file>` (no package-level typecheck).
- Tests: focused first, then full suite (per codex):
  ```bash
  cd ai-developer-toolkit
  node plugins/crews/tests/run.js tests/listener-protocol.test.js tests/progress-bg-gate.test.js tests/stop-decision.test.js tests/role-gate.test.js tests/first-turn-listener-guard.test.js tests/version.test.js > /tmp/crews-v3.4-focused.out 2>&1
  node plugins/crews/tests/run.js > /tmp/crews-v3.4-full.out 2>&1
  ```

### Risk areas (architect-flagged)

- `hooks/pre-tool-use.js` MUST NOT regress on `isListenerArmCall` semantics. The two-filter design is the safeguard; impl must not "simplify" by removing the OR and broadening the original predicate.
- For strict manifest tests in US-002, `listenerState:'exited'` requires `lastListenerExitedAt`; `listenerState:'armed'` requires `lastListenerSpawnAt`. Test fixtures must populate these or the manifest schema validation will fail.
- Cross-fix masking risk: NONE detected. US-001 affects bg-gate false positives; US-002 affects lead-listener gate. They are sequential Stop-hook gates with no shared state.

---

## Codex Research (xhigh)

Codex confirmed all of the above and added:

- `hooks/stop.js` listener-armed gate call site at `:1011-1037`, progress-bg gate at `:1039-1107`, export list at `:1419-1423`.
- `effectiveTurnKind(role, parsedKind)` at `:105-109` synthesizes `kind='progress'` for leads (this is THE function that makes the bug manifest — the call into `shouldRequireArmedListener` arrives with `kind='progress'` not `kind=null`).
- `scripts/bump-version.js` updates: both plugin manifests, three marketplace indexes, and `tests/version.test.js` automatically.
- Codexu root `AGENTS.md` active-plugin-versions table must be updated when the submodule pointer is bumped (lead's responsibility per AGENTS.md ask-before-push rule).

**Codex's suggested verification command** (adopted):
```bash
cd ai-developer-toolkit
node plugins/crews/tests/run.js tests/listener-protocol.test.js tests/progress-bg-gate.test.js tests/stop-decision.test.js tests/role-gate.test.js tests/first-turn-listener-guard.test.js tests/version.test.js > /tmp/crews-v3.4-focused.out 2>&1
node plugins/crews/tests/run.js > /tmp/crews-v3.4-full.out 2>&1
```

**Codex's branch recommendation** (adopted): single branch `ralph/crews-v3.4-bundle` because both fixes share one `3.4.0` release.

---

## Copilot Research (xhigh)

Copilot confirmed the above and emphasized:
- `bump-version.js` updates **both** plugin manifests (`.claude-plugin/plugin.json` AND `.github/plugin/plugin.json`), three marketplace indexes, and `tests/version.test.js`.
- Progress-bg gate (`hooks/stop.js:~1086`) only applies to Copilot members with `kind=progress` — orthogonal to US-002 lead path.
- Implementation snippet for US-001 detect-active-bg.js filter:
  ```js
  const isListener = isListenerArmCall(start.command) || isCrewsCliInfraCall(start.command);
  ```

---

## Consolidated File List

### Files to MODIFY (US-001)
- `ai-developer-toolkit/plugins/crews/hooks/listener-protocol.js` — add `isCrewsCliInfraCall(cmd)` + export
- `ai-developer-toolkit/plugins/crews/hooks/detect-active-bg.js` — import second predicate, OR-combine at `:225`, update LISTENER FILTER comment at `:38-44`
- `ai-developer-toolkit/plugins/crews/tests/listener-protocol.test.js` — extend pinned-exports assertion at `:51-54`, add `isCrewsCliInfraCall` direct unit tests
- `ai-developer-toolkit/plugins/crews/tests/progress-bg-gate.test.js` — add detector cases for `crews.js status`, `$env:CREWS_BIN status`, counterexample `node my-script.js`

### Files to MODIFY (US-002)
- `ai-developer-toolkit/plugins/crews/hooks/stop.js` — short-circuit `role === 'lead'` in `shouldRequireArmedListener` (`:111-115`); add `appendLog` in `decideStopBlock` (`:637-679`) on lead-block path; update comment at `:674-675`
- `ai-developer-toolkit/plugins/crews/tests/stop-decision.test.js` — update lead assertions; add 3 new cases (lead exited→block, lead armed→pass, member progress→pass-through unchanged); assert new appendLog line emitted
- `ai-developer-toolkit/plugins/crews/tests/role-gate.test.js` — adjust lead prose-only case at `:101-117`
- `ai-developer-toolkit/plugins/crews/tests/first-turn-listener-guard.test.js` — keep as regression anchor (member behavior unchanged)

### Files to MODIFY (shared coordination — last writer if parallel)
- `ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json` — version `3.3.0` → `3.4.0` (via `bump-version.js`)
- `ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json` — same (via `bump-version.js`)
- Three marketplace JSON indexes (via `bump-version.js`)
- `ai-developer-toolkit/plugins/crews/tests/version.test.js` — pinned version assertion (via `bump-version.js`)
- `ai-developer-toolkit/plugins/crews/CHANGELOG.md` — new `## 3.4.0 - <date>` narrative block covering BOTH stories
- `ai-developer-toolkit/plugins/crews/AGENTS.md` — extend bg-gate, lead-listener, and stop-hook semantics sections

### Files NOT to touch
- `ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js` — do NOT broaden `isListenerArmCall` here; safety-critical
- Codexu root `CLAUDE.md` — gitignored; never `git add`
- Codexu root `AGENTS.md` active-plugin-versions table — lead handles on FF-merge per ask-before-push rule

### Reference-only (consumers that must keep passing)
- `ai-developer-toolkit/plugins/crews/tests/briefing-render.test.js`
- `ai-developer-toolkit/plugins/crews/tests/copilot-listener-arm-detection.test.js`
- `ai-developer-toolkit/plugins/crews/tests/stop-hook-defers-to-armed-listener.test.js`
- `ai-developer-toolkit/plugins/crews/tests/stop-hook-consumes-when-listener-exited.test.js`
