# Stories Outline: crews v3.4 Stop-hook Bundle

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: detector-broaden-infra-filter

**Description:** As a crews-plugin operator, I want the progress-bg-gate detector to recognize ALL crews-CLI subcommands as infrastructure noise (not just `arm`), so a forgotten async `crews.js status` or `crews.js review-mail` at SessionStart does not let a prose-only `kind=progress` turn pass the Stop hook with `nonListenerCount=1`.

**Acceptance Criteria:**
- [ ] `ai-developer-toolkit/plugins/crews/hooks/listener-protocol.js` adds a new `INFRA_PATTERN_CREWS` regex constant and a new `function isCrewsCliInfraCall(cmd)` that mirrors the `ARM_PATTERN_CREWS` shape (`\bnode(?:\.exe)?\s+(?:(?:['"][^'"]*?|\S*)crews\.js['"]?|\$(?:env:)?CREWS_BIN|%CREWS_BIN%)\s+\S+/i`) but matches any subcommand `\S+` instead of literal `arm`. The new helper is exported alongside `isListenerArmCall`.
- [ ] `ARM_PATTERN_CREWS`, `ARM_PATTERN_LEGACY`, and the body of `isListenerArmCall` are unchanged (byte-identical via `git diff`).
- [ ] `ai-developer-toolkit/plugins/crews/hooks/detect-active-bg.js` imports both predicates from `./listener-protocol` and OR-combines them at the filter call site (`:225`): `const isListener = isListenerArmCall(start.command) || isCrewsCliInfraCall(start.command);`. The LISTENER FILTER header comment (`:38-44`) is updated to document the new two-predicate semantics.
- [ ] `ai-developer-toolkit/plugins/crews/hooks/stop.js` explanatory comment around `:1058` (which describes the detector's listener-arm filter) is updated to mention crews-CLI-infra calls (comment-only change in stop.js for US-001).
- [ ] `ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js` is byte-identical to the pre-change version (`git diff` returns empty). This proves the PreToolUse safety surface is untouched.
- [ ] `ai-developer-toolkit/plugins/crews/tests/listener-protocol.test.js` extended pinned-exports assertion includes `isCrewsCliInfraCall`. New direct predicate unit tests cover:
  - Positive: `node /path/crews.js status`, `node "C:/x y/crews.js" review-mail` (quoted path), `node $CREWS_BIN status` (bash form, no env: prefix), `node $env:CREWS_BIN stop-member foo` (PowerShell form), `node %CREWS_BIN% list-members` (cmd.exe form).
  - Negative: `node my-script.js`, `node /path/crews.js` (missing subcommand), `npx crews status` (intentionally out of scope), empty string, undefined.
- [ ] `ai-developer-toolkit/plugins/crews/tests/progress-bg-gate.test.js` has new detector cases near the existing listener-filter block (`:179-210`):
  - Async `node /path/crews.js status --as foo` + no `shell_completed` → `detectActiveBg(...).nonListenerCount === 0`.
  - Async `node $env:CREWS_BIN status` + no `shell_completed` → `nonListenerCount === 0`.
  - Async `node $CREWS_BIN status` (bash form) + no `shell_completed` → `nonListenerCount === 0`.
  - Counter-example: async `node my-script.js` + no completion → `nonListenerCount === 1`.
- [ ] `node --check ai-developer-toolkit/plugins/crews/hooks/listener-protocol.js` exits 0.
- [ ] `node --check ai-developer-toolkit/plugins/crews/hooks/detect-active-bg.js` exits 0.
- [ ] Focused tests pass and output is saved: from the codexu worktree root in PowerShell, `cd ai-developer-toolkit; node plugins/crews/tests/run.js tests/listener-protocol.test.js tests/progress-bg-gate.test.js 2>&1 | Tee-Object -FilePath D:/harness-efforts/codexu/.ralph/jobs/crews-v3.4-bundle/test-output-us-001-focused.log; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }` exits 0.

**Dependencies:** None
**Estimated complexity:** small

## US-002: require-lead-listener-unconditionally

**Description:** As a crews-plugin lead operator, I want the Stop hook to require an armed listener on EVERY end-of-turn for leads (regardless of kind / queueDepth), so the lead's incoming mailbox is never silently exited between mail deliveries. Today a lead's listener can drift to `exited` state for several minutes after a `kind=done` member delivery, with no Stop-hook block, until PreToolUse fires on the next tool call.

**Acceptance Criteria:**
- [ ] `ai-developer-toolkit/plugins/crews/hooks/stop.js` `shouldRequireArmedListener({ role, kind, queueDepth })` (`:111-115`) has the lead short-circuit immediately after the unknown-role guard:
  ```js
  if (role !== 'member' && role !== 'lead') return false;
  if (role === 'lead') return true;
  if (LISTENER_REQUIRED_KINDS.has(String(kind || ''))) return true;
  return Number.isFinite(queueDepth) && queueDepth > 0;
  ```
- [ ] `ai-developer-toolkit/plugins/crews/hooks/stop.js` `decideStopBlock` (`:637`) emits a new structured log line on the lead-block path using the existing `ctx` and `decision` scope:
  ```js
  appendLog(
    `stop: lead-listener-required name=${ctx.flag.name} crew=${ctx.crew} actorState=${decision.state.actorState} listenerState=${decision.state.listenerState}`,
    ctx.stateCwd
  );
  ```
  The call is placed inside the existing `if (ctx.flag.role === 'lead')` lead-branch that appends lead-specific prose after the shared listener-block log, before the common return. The new log signature `stop: lead-listener-required` is verifiable by grep on the locator log.
- [ ] In-source comment at `stop.js:~674-675` updated to document the v3.4 lead-unconditional gate (e.g. "leads always require an armed listener at end-of-turn; this is enforced unconditionally regardless of kind/queueDepth so the lead mailbox is never silently exited between mail deliveries").
- [ ] `ai-developer-toolkit/plugins/crews/tests/stop-decision.test.js`:
  - Pure-policy assertions:
    - Lead `kind='progress'`, `queueDepth=0` ⇒ requires listener (NEW — was false under the bug).
    - Lead `kind='question'`, `queueDepth=0` ⇒ requires listener (outcome unchanged).
    - Lead any kind, any queueDepth ⇒ requires listener (asymmetric short-circuit).
    - Member `kind='progress'`, `queueDepth=0` ⇒ exempt (regression anchor).
    - Member `kind='progress'`, `queueDepth=1` ⇒ requires listener (unchanged).
    - Member `kind='done'`, `queueDepth=0` ⇒ requires listener (unchanged).
  - Three new integration cases for `decideStopBlock`:
    (a) lead prose-only, `queueDepth=0`, `manifest.listenerState='exited'` (with `lastListenerExitedAt`) → returns block; `stop: lead-listener-required` substring present in locator log.
    (b) lead prose-only, `queueDepth=0`, `manifest.listenerState='armed'` (with `lastListenerSpawnAt`) → allows; `stop: lead-listener-required` substring NOT present in locator log.
    (c) member `kind=progress`, `queueDepth=0`, `listenerState='exited'` → existing pass-through behavior (regression anchor); `stop: lead-listener-required` substring NOT present.
- [ ] `ai-developer-toolkit/plugins/crews/tests/role-gate.test.js` lead prose-only case at `:101-117` updated to assert the new "requires armed listener" behavior.
- [ ] `ai-developer-toolkit/plugins/crews/tests/first-turn-listener-guard.test.js` member `kind=progress` no-listener pass case at `:121-137` continues to pass unchanged (member regression anchor).
- [ ] `node --check ai-developer-toolkit/plugins/crews/hooks/stop.js` exits 0.
- [ ] Focused tests pass and output saved: `cd ai-developer-toolkit; node plugins/crews/tests/run.js tests/stop-decision.test.js tests/role-gate.test.js tests/first-turn-listener-guard.test.js 2>&1 | Tee-Object -FilePath D:/harness-efforts/codexu/.ralph/jobs/crews-v3.4-bundle/test-output-us-002-focused.log; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }` exits 0.

**Dependencies:** US-001 (serial bundle ordering — share the same toolkit branch + last-writer coordination commit).
**Estimated complexity:** small

## Bundle coordination (tail of US-002 OR synthetic third story)

**Description:** Coordinate the v3.4.0 release artifacts so both stories ship in one toolkit submodule commit.

**Acceptance Criteria:**
- [ ] `node plugins/crews/scripts/bump-version.js 3.4.0` has been run from `ai-developer-toolkit/`. The script auto-updates both plugin manifests (`.claude-plugin/plugin.json` AND `.github/plugin/plugin.json`), three marketplace JSON indexes, and `tests/version.test.js`.
- [ ] Both manifests show `"version": "3.4.0"`.
- [ ] `ai-developer-toolkit/plugins/crews/CHANGELOG.md` has a new `## 3.4.0 - <YYYY-MM-DD>` block (plain semver, no `v` prefix, narrative style with bolded subheads matching the existing 3.3.0 entry). Block covers BOTH stories with sections including **Rationale** (both real-world incidents — 15:45 brainstorm-member infra leak; 16:39 lead listener exited window), **Edit sites** (file list per story), **Test changes**. Does NOT overclaim "race-free" for US-002 (the Stop-side gap is closed; PreToolUse still handles 100ms-late mailbox arrivals).
- [ ] `ai-developer-toolkit/plugins/crews/AGENTS.md` documentation updates in:
  - `## v3.3.0 progress-bg gate bypass removal` — one-line v3.4.0 follow-up note about the bg-gate's infrastructure filter now recognizing ALL crews CLI subcommands.
  - `## Crews plugin invariants (v1.9.2)` — one-line note about the new lead-vs-member listener asymmetry.
  - `## Crews stop-hook semantics (for reference)` — extension covering the new lead-block path and the new `stop: lead-listener-required` log signature.
  - Brief reference to the 16:39 incident (lead's listener exited after a member's `kind=done` delivery; ~3 minutes elapsed before PreToolUse fired the arm-block) as the motivating example for US-002.
- [ ] Full toolkit test suite passes with output saved: `cd ai-developer-toolkit; node plugins/crews/tests/run.js 2>&1 | Tee-Object -FilePath D:/harness-efforts/codexu/.ralph/jobs/crews-v3.4-bundle/test-output-full.log; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }` exits 0.
- [ ] Branch `ralph/crews-v3.4-bundle` exists LOCALLY in the toolkit submodule with the bundle commits. Verify: `git -C ai-developer-toolkit branch --list ralph/crews-v3.4-bundle` returns the branch name; `git -C ai-developer-toolkit ls-remote origin ralph/crews-v3.4-bundle` returns empty (no remote push). Lead handles pushes to origin / personal / gim-home per AGENTS.md ask-before-push rule.
- [ ] codexu root `CLAUDE.md` is NOT staged in any commit (gitignored — verify with `git status --ignored` in the codexu worktree).

**Dependencies:** US-001, US-002
**Estimated complexity:** small
