# Stories Outline: Crews Stop Hook — Listener-Armed Invariant Hardening (v1.6.2)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Narrow Stop-hook listener-armed gate + harden stale-armed + swap arm-command form

**Description:** As the crews plugin author, I want the Stop hook to narrow its listener-armed gate so `kind=progress` with `queueDepth=0` passes (while terminal kinds still gate), emit the canonical `crews.js arm` form in block reasons, and ensure post-sync-review-mail stale-armed manifests don't evade the gate.

**Acceptance Criteria:**
- [ ] **Pre-implementation investigation**: write `<job_dir>/notepad.md` documenting the stale-armed root-cause reproduction. Trigger sync review-mail in a test harness; capture the post-review-mail manifest state; decide whether `actor-state.js::deriveListenerState()` returns `'armed'` while the listener process is dead. Decision: include `actor-state.js` hardening in US-001 if a hole exists.
- [ ] **AC-1**: Stop hook emits a JSON block on stdout with the literal `node '<plugin>/tools/crews.js' arm <name> --crew <crew> --cwd <cwd> --session-id <session-id>` command (positional `<name>`, NOT `--name`).
- [ ] **AC-2**: `kind=progress` + `queueDepth=0` (i.e., `evaluateConsumedResolutions().unresolved.length === 0`) — no listener-related block emitted.
- [ ] **AC-3**: `kind ∈ {done,question,blocked}` requires armed listener regardless of `queueDepth`.
- [ ] **AC-7**: `buildListenerCommand()` swap from `wait-for-message.js` → `crews.js arm`; `isListenerArmCall()` / `isListenerArmToolCall()` still recognize the new form (no regression in arm-detection at `pre-tool-use.js:440`, `stop.js:346`, `commands/resume-crew.js:353`).
- [ ] **AC-9**: After a synchronous review-mail call mutates the manifest, `deriveListenerState()` returns non-armed when the listener process is dead, even if heartbeat was just touched. Test fixture seeds post-review-mail stale-armed manifest AND verifies `decideStopBlock` returns a block.
- [ ] **F-006 reorder**: move `findPendingConsumedEntries()` + `evaluateConsumedResolutions()` BEFORE `decideStopBlock()`, OR pass `queueDepth` as a parameter into `decideStopBlock()`. Preserve existing strict-ack behavior at `stop.js:710-734`.
- [ ] **F-005 correction**: do not propagate the false claim that `CREWS_REVIEW_MODE=off` disables the listener-armed gate.
- [ ] Typecheck / lint baseline: `node plugins/crews/tests/run.js` continues to pass for unrelated test files.
- [ ] Targeted tests pass: `node plugins/crews/tests/run.js stop-decision.test.js listener-protocol.test.js listener-protocol-shell-tools.test.js`.

**Dependencies:** None
**Estimated complexity:** medium

---

## US-002: Test fixtures (AC-4 + CASE 4 inversion + buildListenerCommand callers)

**Description:** As the crews plugin maintainer, I want comprehensive test coverage for the v1.6.2 narrowing + arm-command form swap so future regressions are caught before merge.

**Acceptance Criteria:**
- [ ] **AC-4**: `tests/stop-decision.test.js` adds 3 new fixtures:
  - `kind=done unarmed → BLOCKED` (queueDepth ignored).
  - `kind=progress unarmed + queueDepth=0 → OK`.
  - `kind=done unarmed + queueDepth=0 → BLOCKED` (verifies kind alone gates).
- [ ] **F-007 fixture setup**: fixtures use realistic inbox-history setup (via `appendInboxHistory`, `consumeMailbox`, or equivalent) — not just manifest-field injection.
- [ ] **AC-2 / CASE 4 inversion**: `tests/first-turn-listener-guard.test.js` CASE 4 (currently asserts progress-unarmed BLOCKS) is inverted to assert progress-unarmed + `queueDepth=0` OK. CASE 1, 2, 3, 5, 6 continue to pass unchanged.
- [ ] **F-010 reframe**: AC-2 test fixture observes "no JSON block emitted with listener/arm in reason" — not "no internal listener-state check."
- [ ] **F-009 verification**: AC-6 either gets a fixture (run Stop hook with another plugin's hook dir present, assert no spurious block) OR is demoted to a documentation note in plan/CLAUDE.md.
- [ ] **F-002 (cascade from US-001)**: update tests pinned to old `buildListenerCommand()` output:
  - `tests/listener-protocol.test.js`
  - `tests/listener-protocol-shell-tools.test.js`
  - `tests/briefing-render.test.js` (lines 24-25, 33, 91-92 pin `wait-for-message.js`)
  - `tests/continuation-briefing.test.js` (line 41 pins `'legacy/wait-for-message.js'` — may be intentional as legacy fixture; verify)
  - `tests/copilot-listener-arm-detection.test.js` (lines 10-11 pin `wait-for-message.js`)
  - `tests/copilot-briefing.test.js` (line 12 pins `LISTENER_PATH = '/p/wait-for-message.js'`)
  - `tests/briefing-structure.test.js` (lines 31-32 pin path)
  - `tests/mark-arm-intent.test.js` (verify any pinned arm-command form)
- [ ] **AC-5**: full suite passes via `node plugins/crews/tests/run.js`.

**Dependencies:** US-001
**Estimated complexity:** small-to-medium (many test files to touch but each is mechanical)

---

## US-003: Docs, CHANGELOG, version bump

**Description:** As an operator reading the plugin docs, I want CLAUDE.md to document the v1.6.2 narrowing and a CHANGELOG entry so I know what changed.

**Acceptance Criteria:**
- [ ] **AC-8**: `plugins/crews/CHANGELOG.md` created (does not exist today). Include a "v1.6.2" entry describing the narrowing + arm-command form swap. If v1.6.1 lands first on `origin/main`, add a v1.6.1 entry between v1.6.0 and v1.6.2.
- [ ] **CLAUDE.md** updated to document the new Stop-hook invariant. Add a paragraph after the existing "Stop hook gates" section explaining the `kind=progress` + `queueDepth=0` exemption and AC-9 (stale-armed hardening, if applicable).
- [ ] **Version bump** via `node plugins/crews/scripts/bump-version.js 1.6.2`. Verify the script updates ALL 6 files: `.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`, **`tests/version.test.js`**.
- [ ] `node plugins/crews/tests/run.js version.test.js` passes after bump (the pinned `VERSION` literal is rewritten by the script).
- [ ] **F-005 correction propagation**: do not mention `CREWS_REVIEW_MODE=off` as a listener-armed disable in CLAUDE.md or CHANGELOG.
- [ ] **Open Question #1 resolution**: rebase onto current `origin/main` immediately before merging. If `origin/main` is at v1.6.0 (v1.6.1 not yet landed), surface a `kind=question` to the operator for decision.

**Dependencies:** US-001, US-002
**Estimated complexity:** small
