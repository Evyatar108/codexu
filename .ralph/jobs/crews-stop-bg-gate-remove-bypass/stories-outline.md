# Stories Outline: crews-stop-bg-gate-remove-bypass

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Reflects Phase 4 amendments: case-mapping correction (F-001), external test-file additions (F-002), Case 1 + skip-case reason-assertion updates (F-003), corrected `sanitizeReason` claims (F-004), CHANGELOG supersession (F-005), Case 6 deletion (F-006), and scoped push-ownership (F-007).*

## US-001: Remove the crews progress-bg-gate bypass tag entirely (ship v3.3.0)

**Description:** As an operator running the crews plugin on Copilot members, I want the v3.2.0 progress + no-bg gate bypass tag entirely removed in v3.3.0 so that models cannot self-attest their way past the gate and so that the block message stops teaching the bypass syntax as a default escape hatch.

**Acceptance Criteria:**

- [ ] `parseTurnReports` in `hooks/mailbox.js` no longer sets `out.bgTask`. Cross-grep across `hooks/` shows zero functional references to `background-task` / `background-agent` as a bare-token attribute parser. Doc-comment / CHANGELOG / AGENTS.md historical mentions are allowed. `hooks/detect-active-bg.js:1` keeps its file-mission comment ("background-task detector"). Test fixtures may retain the bypass strings as input to negative assertions.
- [ ] `hooks/stop.js`'s progress-bg gate trigger condition is `gateEnabled && isCopilot && isProgress && isMember && !isRetry && !isShuttingDown` (the `!hasBgTag` term is gone). The four-form `text.indexOf` legacy scan AND the deprecation-warning stderr write + crews.log entry block are deleted. The leading bypass-enumeration comment block is updated.
- [ ] The block-message string at `stop.js:1128` is exactly `kind=progress requires active background work (open subprocess). Use kind=question + reply-to to wait on the lead, kind=done to complete this turn, or kind=blocked to surface a problem.` (185 characters; `sanitizeReason` does not truncate). After emission the reason names `kind=question`, `kind=done`, AND `kind=blocked` AND does NOT contain `background-task`, `background-agent`, or `options-mode`.
- [ ] `hooks/detect-active-bg.js` header comment includes a new `STRUCTURAL COMPLETENESS` subsection: any real bg work is a subprocess at Stop time; any in-process wait blocks Stop from firing; therefore `nonListenerCount === 0 + kind=progress` is always a model error; if a false-block case appears, extend the detector, don't add a bypass. Line 130 bias-rationale comment updated to drop "bypass tag" wording.
- [ ] `tests/progress-bg-gate.test.js` Cases 4 (legacy XML), 4-new renamed to 4b (in-band crews-namespaced), and 5 (legacy CommonMark) all assert the gate FIRES on bypass-tag-bearing transcripts AND assert no stderr DEPRECATED text AND assert no `legacy options-mode bypass tag detected` crews.log entry. Cases 5-new / 5b (original) / 5c / 6 are DELETED. A shared `NEW_REASON_PREFIX = 'kind=progress requires active background work'` constant is used by all reason-text assertions.
- [ ] `tests/progress-bg-gate.test.js` Case 1 is updated: line 316 references the new prefix; line 318 `background-task` escape-hint assertion is DELETED; new asserts cover the three kind-alternative names AND `background-task` absence in the reason. Cases 3, 7, 7b, 8, 9 are scanned for old-message references (`'kind=progress needs active bg'`) and updated to use `NEW_REASON_PREFIX`.
- [ ] `tests/stop-flush-race-retry.test.js` F.1 (line 101) updated — either seed a real `asyncStart` bg event so kind=progress passes the v3.3.0 gate legitimately, OR swap to `kind=done` + armed-listener seed. F.6 (line 183) drops the bypass attribute (gate's `!isRetry` guard structurally exempts F.6 but updating is consistent).
- [ ] `tests/stop-allow-system-notification-boundary.test.js` Case A.6 (line 155) swap `<|report kind="progress" ... background-task|>` → `<|report kind="done" ...|>`. Armed-listener seed already present satisfies terminal-kind discipline.
- [ ] `AGENTS.md` v3.1.0 section's three bypass-related edits (lines 226-228, 236, 248-250) applied. New `## v3.3.0 progress-bg gate bypass removal` section added IMMEDIATELY ABOVE the existing `## v3.1.2 test-suite catchup` section (reverse-chronological). Content: structural argument, removed-surface enumeration, retained env knob (`CREWS_PROGRESS_BG_GATE=off`), "Why no bypass" subsection, edit sites, migration note (no deprecation cycle).
- [ ] `CHANGELOG.md` has new top-of-file v3.3.0 entry. Existing v3.2.0 entry's "removed in crews v4.0.0" forward-looking sentence gets a parenthetical supersession note pointing at v3.3.0.
- [ ] `node ai-developer-toolkit/plugins/crews/scripts/bump-version.js 3.3.0` was run. All 5 manifest files plus `tests/version.test.js` show `3.3.0`. `node ai-developer-toolkit/plugins/crews/tests/version.test.js` exits 0.
- [ ] `cd ai-developer-toolkit/plugins/crews && node tests/run.js 2>&1 | tee /tmp/crews-v3.3.0-tests.out` exits 0 with 100% pass count. Wall time under 90s on Windows at default concurrency.
- [ ] All changes committed to topic branch `ralph/crews-stop-bg-gate-remove-bypass` inside the toolkit submodule worktree at `ai-developer-toolkit/.worktrees/crews-stop-bg-gate-remove-bypass/`. Commit message is `crews(v3.3.0): remove progress-bg-gate bypass tag entirely` with the structural argument summary in the body. **Topic branch exists locally only**; pushing to toolkit remotes is operator-confirmed and lead-driven (NOT part of this AC per codexu AGENTS.md "ask before pushing to remotes" rule).
- [ ] Typecheck passes: `node --check` exits 0 for each modified JS file (`hooks/mailbox.js`, `hooks/stop.js`, `hooks/detect-active-bg.js`, `tests/progress-bg-gate.test.js`, `tests/stop-flush-race-retry.test.js`, `tests/stop-allow-system-notification-boundary.test.js`).

**Dependencies:** None

**Estimated complexity:** medium

The bulk of the work is mechanical removal + doc rewrites. Non-mechanical pieces:
1. Verifying Case 4 vs 4-new mapping by reading the actual file content (the task spec had this reversed; AC5 enumerates the correct flip).
2. Scanning `progress-bg-gate.test.js` for ALL old-message references, not just the obvious Cases 4-6 (Phase 4 review caught Case 1 + skip Cases 3/7/8/9 with the old prefix; AC6 covers).
3. Updating two external test files (`stop-flush-race-retry.test.js`, `stop-allow-system-notification-boundary.test.js`) whose bypass-tag fixtures break post-removal (AC7, AC8).
4. AGENTS.md v3.3.0 section placement (reverse-chronological → above v3.1.2 section).
5. CHANGELOG.md v3.2.0 entry supersession parenthetical (AC10's second clause).
