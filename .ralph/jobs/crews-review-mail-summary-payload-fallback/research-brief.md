# Research Brief: crews-review-mail-summary-payload-fallback

## Researcher Findings (Claude Explore)

### Bug confirmation
The summary-drop bug is confirmed as a schema asymmetry between system-routed (member-reply, proactive-report) and direct-send (send-to-member, send-to-thread) envelope paths.

### Key files & line numbers

**Read-path (`D:/ai-developer-toolkit/plugins/crews/hooks/commands/review-mail.js:111`):**
```js
summary: row && row.summary !== undefined ? row.summary : null,
```
Reads top-level only; needs fallback to `row.payload?.summary`.

**Write-path (`D:/ai-developer-toolkit/plugins/crews/hooks/stop.js`):**
- Member-reply path lines 831–842: `appendSystemMailbox(addressedActor.name, crew, cwd, { kind, message, payload: { …, summary: effectiveSummary, kind } }, …)`
- Proactive-report path lines 858–882: `appendSystemMailbox(createdByLead, crew, cwd, { kind, message, payload }, …)` where `payload.summary = effectiveSummary`
- `effectiveSummary` defined at stop.js:778: `const effectiveSummary = tags.summary || synthesizeSummary(tags.body) || null;`

### Version stamp file list (current 1.7.2 → 1.7.3)
1. `D:/ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json` line 4
2. `D:/ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json` line 4
3. `D:/ai-developer-toolkit/.claude-plugin/marketplace.json` line 86
4. `D:/ai-developer-toolkit/.github/plugin/marketplace.json` (verify)
5. `D:/ai-developer-toolkit/.agents/plugins/marketplace.json` line 165

Plus: `D:/ai-developer-toolkit/plugins/crews/tests/version.test.js` carries the expected-version constant — must be bumped in the same change.

A bump helper exists: `node plugins/crews/scripts/bump-version.js 1.7.3` from repo root.

### Existing test infrastructure
**Test runner:** `node tests/run.js` from `plugins/crews/`. There is NO `package.json` and NO `npm test`. Worker-based parallel runner with 60s timeout / 10 concurrent default; serial denylist for lock-sensitive tests.

**review-mail-command.test.js:**
- `row()` fixture factory (lines 31–41) currently writes top-level `summary` only — does not exercise the production system-routed path.
- `seedActor()`, `writeHistory()`, `slash()` helpers (lines 12–47).
- Existing cross-actor system-routed fixture at lines 295–359 already seeds `payload.summary` but does NOT assert `entry.summary` — natural extension point.

**member-reply-notify.test.js:**
- Line ~88 asserts `note.payload.summary === 'answered 2+2'` only — does NOT call `formatReviewMailEntry`.
- Setup constructs envelope manually via `cfg.appendSystemMailbox()`.

### Documentation
- `D:/ai-developer-toolkit/plugins/crews/README.md` Mailboxes section describes review-mail output but does not mention `payload.summary` explicitly. CHANGELOG note is sufficient; README touch optional.
- `D:/ai-developer-toolkit/plugins/crews/CLAUDE.md` lines 607–614 explicitly document v1.3.5's deliberate non-lifting of payload.summary — this comment should be updated to reflect the v1.7.3 reversal.
- `docs/smoke-runbook.md` and `docs/copilot-port-design.md` reference review-mail but contain no schema docs.

### CHANGELOG format
v1.7.2 entry uses `## v1.7.2` heading, bullet points for changes, sub-bullets for scope/affected-tests. Same format applies to v1.7.3.

### Multi-remote pattern
Remotes: `origin = Evyatar108/ai-developer-toolkit`, `work = gim-home/ai-developer-toolkit`. Both pushed on release.

## Architect Analysis (Claude Explore)

### Bundling decision: Option A recommended
Single coordinated v1.7.3 patch — read fallback + write mirror together. Rationale:
- **Code surface**: ~10 LOC product change + ~50 LOC tests. Both halves are trivial.
- **Test coverage**: Single fixture (nested-summary scenario) exercises both halves.
- **Bisection clarity**: Single commit pins which side broke for any future regression.
- **Schema drift**: Eliminates the inconsistency window that Option B would leave between v1.7.3 and v1.7.4.
- **Coordination cost**: One ship, one CHANGELOG entry, one announcement.

### Read-path design validation
- `??` (nullish coalescing) is correct vs `||`: preserves explicit empty string `""` even though the current parser at hooks/mailbox.js:756 + stop.js:778 collapses `""` to `null` today via `||`. Using `??` is defensive future-proofing — costs nothing and aligns with the principle.
- Sole summary read in formatReviewMailEntry is line 111. No other fields have the same asymmetry (kind has `rowKind()` defensive fallback at lines 84–86; memberName/outboxSeq are intentionally payload-only).
- Recommend ending with `?? null` to preserve the explicit-null fallback that the current code provides.

### Write-side design validation
- `effectiveSummary` is in scope at both call sites (defined at stop.js:778).
- `appendSystemMailbox` (mailbox.js:466–481) does NOT destructure; it accepts arbitrary envelope fields and Object.assigns them into the envelope. No signature change needed.
- Other `appendSystemMailbox` caller: `hooks/threads.js:259` (thread-fanout) does not carry summary and is intentionally informational. No change needed.

### Risks (analyzed and dismissed)
- **No accidental summary exposure**: only member-reply and proactive-report set `payload.summary`. Thread-fanout doesn't.
- **No collision with existing top-level summary**: top-level summary is currently never set on system-routed envelopes.
- **No downstream consumer keyed on summary absence**: grep found no `!row.summary` / `row.summary === undefined` checks that would break.

### Recommended story decomposition
1. Read-path fallback + read-side regression test (independent)
2. Write-side member-reply lift (independent)
3. Write-side proactive-report lift (independent)
4. Formatter integration test (depends on 2 & 3)
5. CHANGELOG + version bump (depends on 1–4)

## Codex Research

### Critical correction
`hooks/lib/inbox-history.js` does NOT exist in this checkout. The seed feature-request listed it as a reference file but the actual implementation lives at `hooks/mailbox.js`. The plan must not reference inbox-history.js as a real path.

### Validation command correction
The seed's "npm test in plugins/crews exits 0" criterion is stale — there is no `package.json`. Use `cd D:/ai-developer-toolkit/plugins/crews && node tests/run.js`.

### Bump helper
`node plugins/crews/scripts/bump-version.js 1.7.3` from repo root touches all 5 release stamps in one command.

### Additional version stamp
`plugins/crews/tests/version.test.js` is part of the version-stamp set and is updated by the bump script.

### Integration test seeds
Real-stop-routing tests already exist and are natural assertion sites:
- `tests/integration/review-flow.test.js`
- `tests/integration/send-receive-reply-cycle.test.js`
- `tests/integration/proactive-report-progress-tail.test.js`
- `tests/integration/cli-spawn-proactive-report.test.js`

### Choice confirmation
Option A. `??` not `||`. Keep `payload.summary` for back-compat. Don't touch direct-send paths. Don't touch mailbox.js unless a test proves unavoidable.

## Copilot Research

Confirms Codex's correction: `hooks/lib/inbox-history.js` does not exist; the relevant file is `hooks/mailbox.js`.

### Additional test extension targets
- `tests/auto-derive-replyTo-same-turn.test.js` and `tests/force-response-replyTo-passes.test.js` exercise real stop.js member-reply routing — natural places for post-stop top-level summary assertions.
- `tests/proactive-report-notify.test.js` — natural place to assert proactive-report top-level summary.

### Recommended reader form
`row.summary ?? row.payload?.summary ?? null` — explicit-null final fallback preserves current null-return semantics for rows with neither field populated.

### CLAUDE.md update
Recent releases document operator-critical behavior in `plugins/crews/CLAUDE.md`. The v1.7.3 schema-uniformity change merits a top entry there alongside the CHANGELOG.

## Consolidated File List

### Files to modify (product code)
- `D:/ai-developer-toolkit/plugins/crews/hooks/commands/review-mail.js` — line 111 fallback
- `D:/ai-developer-toolkit/plugins/crews/hooks/stop.js` — lines ~831–842 and ~858–882 lift summary to envelope top level

### Files to modify (tests)
- `D:/ai-developer-toolkit/plugins/crews/tests/review-mail-command.test.js` — add nested-only fixture + assertion
- `D:/ai-developer-toolkit/plugins/crews/tests/member-reply-notify.test.js` — add formatter-surfaced summary assertion
- `D:/ai-developer-toolkit/plugins/crews/tests/proactive-report-notify.test.js` — add top-level summary assertion (file existence to be verified during impl)
- Optionally one integration test (`tests/integration/review-flow.test.js` or `send-receive-reply-cycle.test.js`) — assert real-stop-routed top-level summary

### Files to modify (release stamps)
- `D:/ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json`
- `D:/ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json`
- `D:/ai-developer-toolkit/.claude-plugin/marketplace.json`
- `D:/ai-developer-toolkit/.github/plugin/marketplace.json`
- `D:/ai-developer-toolkit/.agents/plugins/marketplace.json`
- `D:/ai-developer-toolkit/plugins/crews/tests/version.test.js`
- (All handled by `node plugins/crews/scripts/bump-version.js 1.7.3`)

### Files to modify (docs)
- `D:/ai-developer-toolkit/plugins/crews/CHANGELOG.md` — v1.7.3 entry
- `D:/ai-developer-toolkit/plugins/crews/CLAUDE.md` — update lines 607–614 to reflect v1.7.3 reversal of v1.3.5 non-lifting decision (and optionally add a top-of-file release note)

### Reference files (read-only context)
- `D:/harness-efforts/codexu/.ralph/investigations/crews-summary-attribute-drop/INVESTIGATION-RESULT.md`
- `D:/ai-developer-toolkit/plugins/crews/hooks/mailbox.js` (NOT `hooks/lib/inbox-history.js` — that file does not exist)
- `D:/ai-developer-toolkit/plugins/crews/CLAUDE.md` (protocol invariants)

## Consensus / Divergences

**Full consensus (4/4 sources):**
- Option A (coordinated v1.7.3 ship)
- `??` not `||`
- Read-path fallback at review-mail.js:111
- Write-side lift at both stop.js call sites
- 5 release stamps + bump script + version.test.js
- Test runner: `node tests/run.js` (not npm test)
- `hooks/lib/inbox-history.js` does NOT exist (seed wording was wrong)
- Don't touch direct-send paths
- Don't touch mailbox.js / appendSystemMailbox signature

**Divergences:**
- Reader form: Codex/Researcher say `row.summary ?? row.payload?.summary`; Copilot/Architect say add trailing `?? null`. The trailing-null form preserves current null-return semantics exactly. Plan adopts the trailing-null form.
- Test extension scope: minimal (Architect: 2 tests) vs broader (Copilot: 4+ tests including integration). Plan adopts a middle path: 1 unit test per call site + 1 formatter assertion + 1 optional integration assertion.

**Critical seed corrections to propagate into the plan:**
1. Drop the `hooks/lib/inbox-history.js` reference (file doesn't exist).
2. Replace "npm test in plugins/crews exits 0" with "`node tests/run.js` exits 0 from plugins/crews/".
3. Add `tests/version.test.js` to the version-stamp file list.
4. Mention the `bump-version.js` helper.
