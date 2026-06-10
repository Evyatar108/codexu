# Stories Outline: Port the crews progress-bg Stop-hook gate to CODEX members

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> Single serial cluster (`codex-progress-bg-gate`) — all stories target the crews plugin and share
> `hooks/stop.js` + the version-stamp/changelog files, so they cannot run in parallel. Target version: **v3.21.0**
> (re-derive the next free minor at impl if another crews ship landed first). codexu root `CLAUDE.md` is
> gitignored — do NOT `git add` it; fork guidance edits go in crews `AGENTS.md`.

## US-001: codex bg-liveness detector (`hooks/detect-active-bg-codex.js`)
**Description:** As a crews maintainer, I want a sibling detector that reports active non-infra background work for
a codex member by parsing the codex rollout JSONL, so the Stop-hook progress-bg gate can cover codex exactly as it
covers Copilot.
**Acceptance Criteria:**
- [ ] New `hooks/detect-active-bg-codex.js` exports `detectActiveBgCodex({ transcriptPath, asOf })` returning
      `{ activeCount, nonListenerCount, samples, asOf }` (no subagent fields).
- [ ] Bounded, malformed-line-tolerant rollout read (mirrors `detect-active-bg.js::readEvents`).
- [ ] Current-turn boundary = index of the LAST `event_msg` with `payload.type === 'task_started'`.
- [ ] `execLaunch[call_id].cmd` recovered by `JSON.parse(payload.arguments).cmd` (tolerate parse failure → `cmd:null`).
- [ ] `awaitSession[call_id] = JSON.parse(payload.arguments).session_id` for `await_background_completion` calls.
- [ ] Output parsing reads `payload.output` (string). `/Process running with session ID (\d+)/` → RUNNING at this
      row; an `await` output for session N **lacking** that marker → TERMINAL (structural rule; no terminal-text
      enumeration). An `await` output **containing** the marker refreshes liveness at the current row.
- [ ] Liveness biased false-NEGATIVE: a session is active-non-infra iff its latest signal is RUNNING AND that
      signal's row index is after the current-turn boundary AND its `cmd` is resolvable and not
      `isListenerArmCall(cmd) || isCrewsCliInfraCall(cmd)` (reused verbatim from `hooks/listener-protocol.js`).
- [ ] `samples` use Copilot-parity shape `{ shellId: String(sessionId), toolName: 'exec_command', command, isListener }`.
- [ ] Module header documents the STRUCTURAL COMPLETENESS argument for codex (await blocks the turn ⇒ Stop only
      sees launch-then-end-without-await) mirroring `detect-active-bg.js:77-99`, and the NO-MODEL-BYPASS invariant.
- [ ] Unit tests over a committed real-shaped fixture `tests/fixtures/codex-rollout-bg.jsonl` cover: no-bg,
      listener-only (infra-filtered), fresh-running-this-turn, launched-then-exited, stale-prior-turn (BLOCK),
      await-refresh keeps-fresh (ALLOW), `payload.output` detects vs `payload.content` does NOT, JSON-string
      `arguments` parse + parse-failure tolerance.
- [ ] `node --check hooks/detect-active-bg-codex.js` passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: widen the `hooks/stop.js` progress-bg gate to codex
**Description:** As a crews maintainer, I want the Stop-hook progress-bg gate to fire for codex members (not just
Copilot), dispatching the codex detector and evaluating even on codex retries, so a codex member cannot
`kind=progress`-stall with no active background work.
**Acceptance Criteria:**
- [ ] `detectActiveBgCodex` imported at `stop.js:58` (second `require` for the new module).
- [ ] `isCodex = manifest.engine === 'codex'`; gate condition uses `(isCopilot || isCodex)` and `(isCodex || !isRetry)`.
- [ ] `sessionId = data.session_id || manifest.sessionId`; codex transcript resolution falls back to
      `resolveCodexTranscriptPath(sessionId)` (US-003); Copilot resolution unchanged.
- [ ] Per-engine dispatch inside the existing try/catch: `isCodex ? detectActiveBgCodex(...) : detectActiveBg(...)`.
- [ ] `:1203` log line is engine-aware (`engine=${manifest.engine}`).
- [ ] The gate's leading comment block (`~:1121`, `~:1155-1180`) is updated from "Copilot only / isRetry skips" to
      describe `copilot|codex` and the codex retry-evaluation behavior.
- [ ] NO new model-settable bypass tag; only `CREWS_PROGRESS_BG_GATE=off` disables the gate (v3.3.0 invariant).
- [ ] Stop-subprocess e2e tests (via `tests/lib/force-response.js::runStop`) for the codex BLOCK/ALLOW matrix, plus
      a codex round-trip e2e through `hooks/codex-stop.js` (`codexToClaudeStopInput` → `handleInput` →
      `claudeDecisionToCodex`) asserting `stop_hook_active` re-evaluation (no bypass) and correct envelope wrapping.
- [ ] Existing `tests/progress-bg-gate.test.js` Copilot cases stay green; Copilot log line stays `engine=copilot`;
      Claude members remain skipped; the codex import path is NOT exercised for `engine === 'copilot'`.
- [ ] `node --check hooks/stop.js` passes.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: codex transcript-path fallback (`resolveCodexTranscriptPath`)
**Description:** As a crews maintainer, I want a robust last-resort to locate the codex rollout when the Stop input
lacks `transcript_path`, so the gate still works (or fails open) instead of silently mis-targeting.
**Acceptance Criteria:**
- [ ] `resolveCodexTranscriptPath(sessionId)` globs `~/.codex/sessions/**/rollout-*-<sessionId>.jsonl` across the
      date-tree (`os.homedir()`-resolved); null/empty `sessionId` → null.
- [ ] Multiple matches → pick the latest embedded ISO timestamp from the `rollout-<ISO-ts>-<id>` filename (tie →
      newest mtime); validate readable + non-empty, else null.
- [ ] Wired into `stop.js` codex transcript resolution only (Copilot path unchanged); a null result leaves
      `transcriptPath` null ⇒ gate SKIPPED (failure-open).
- [ ] Failure-contract tests: missing path → skip; non-null unreadable/empty/all-malformed → BLOCK; multiple-match
      selection; no-match → skip.
- [ ] `node --check` passes on the touched files.
**Dependencies:** US-002
**Estimated complexity:** small

## US-004: docs + version bump (v3.21.0)
**Description:** As a crews maintainer, I want the version, marketplace indexes, AGENTS.md, and CHANGELOG updated so
the feature ships consistently across all three engines' manifests.
**Acceptance Criteria:**
- [ ] `node scripts/bump-version.js 3.21.0` stamps all 6 files (3 plugin manifests + 3 marketplace indexes) and
      updates `tests/version.test.js`; re-derive the next free minor if main advanced past v3.20.0.
- [ ] crews `AGENTS.md` gains a `## v3.21.0 codex progress-bg gate` section documenting the new detector, the gate
      widening, the freshness rule, the failure contract, and the common-mistake gotchas (`payload.output` not
      `content`; JSON-string `arguments`; drop `!isRetry` for codex; do NOT weaken the freshness rule).
- [ ] `CHANGELOG.md` gains a prepended `## 3.21.0` entry.
- [ ] `node tests/version.test.js` passes.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** small

## US-005: LIVE codex dogfood (acceptance — lead-coordinated, post-merge)
**Description:** As the operator/lead, I want a live codex dogfood proving the 5-case matrix against the INSTALLED
plugin, because green unit tests are not sufficient (the v3.16.0/3.17.0 lesson).
**Acceptance Criteria:**
- [ ] Submodule merged/pushed and `copilot plugin update` pulled the new crews build (lead-owned ship ceremony).
- [ ] Spawn a codex member via crews and drive all 5 cases; capture per-case evidence under
      `.ralph/jobs/crews-codex-progress-bg-gate-stall-detection/dogfood/`:
      (1) no bg + `kind=progress` ⇒ BLOCK (`crews.log` `engine=codex active=0 nonListener=0` + Stop block reason);
      (2) listener-only ⇒ BLOCK (`active=1 nonListener=0`);
      (3) fresh non-infra `exec_command` this turn ⇒ ALLOW (`nonListener>=1`, no block);
      (4) launched-then-exited-before-Stop ⇒ BLOCK (`nonListener=0`);
      (5) stale prior-turn, no fresh re-touch ⇒ BLOCK (`nonListener=0`).
- [ ] The dogfood transcript slice + `crews.log` excerpts are saved as the acceptance artifact before flipping the
      task `merged`.
**Dependencies:** US-001, US-002, US-003, US-004 (+ ship + plugin update)
**Estimated complexity:** medium
