# Research Brief — crews-envelope-body-canonical-for-all-kinds

## Consensus across reviewers
- **Hard-block (option C), v1.8.0 minor** is the recommendation from Codex + Copilot.
- **Hybrid (b)+(d)+(a) v1.7.4 patch** (warn + auto-promote + docs) is the architect's recommendation.
- All 3 agree progress envelopes should be exempt by default.
- All 3 agree thresholds N=200 (summary cap) / M=50 (body floor) are reasonable defaults.

## Researcher Findings (file:line citations)

### Report-tag parser
- Lives in `hooks/mailbox.js:742-794` as `parseTurnTags(rawText)`. NOT in `hooks/protocol/report-tags.js` (that file only validates the parsed shape).
- Returns `{ kind, summary, body, replyTo, acks, decisions, ... }`. **body IS already captured** via regex strip of tags + whitespace normalize (lines 782-784).
- Called at `hooks/stop.js:633`.

### Stop hook
- `hooks/stop.js` is itself the Stop hook (918 lines). Entry: `handleInput()`.
- Parses tags at line 633; persists envelope at lines 782-789 via `appendOutbox(..., { kind, summary: effectiveSummary, message: tags.body, ... })`.
- `effectiveSummary` at line 778: `tags.summary || synthesizeSummary(tags.body) || null`. **User-supplied summary is never length-capped** — `synthesizeSummary` (in `hooks/mailbox.js:799-806`) only fires when summary omitted, and caps at 120 chars.
- Listener-arm hard-block precedent at lines 675-681 (v1.6.2 pattern: `out.stdout.write(JSON.stringify({ decision: 'block', reason }))`).
- Manifest `lastSummary` write at line 807.

### SessionStart briefing
- Single source: `hooks/briefing/template.js:109-129` (the `id: 'footer-tag'` section).
- Current wording (line 127): "Keep it ≤ ~120 chars." — soft guidance, no body-canonical rule.
- Engine-specific branching: lines 13-39 only for listener-arm prose; the footer-tag section is shared between Claude + Copilot.
- **Goldens to update:** `tests/golden/briefing-member.md`, `tests/golden/briefing-lead.md`.

### Envelope persistence
- `appendOutbox` defined in `hooks/mailbox.js:1006-1037`. Writes `{ seq, id, writtenAt, message (=tags.body), from, replyTo, hops, kind, summary }` to `<member>/outbox.jsonl`.
- Proactive-report system-mailbox header (stop.js:878-882) embeds `body` in the message text. v1.3.6 lossless-bodies fix.

### CLAUDE.md
- `D:/ai-developer-toolkit/plugins/crews/CLAUDE.md` is 139KB, ~1800 lines.
- Closest existing section: lines 550-589 (v1.3.6 lossless-bodies). No explicit "body is canonical for done/question/blocked" rule documented today.

### Tests
- Custom Node runner at `tests/run.js`. Not Jest/Vitest.
- Most-relevant existing tests:
  - `tests/stop-decision.test.js` (listener-armed gate, queueDepth)
  - `tests/protocol-report-tags.test.js`
  - `tests/stop-circuit-breaker.test.js` (consecutive block counter)
  - `tests/briefing-render.test.js`
  - `tests/version.test.js`
- Test pattern: `setupForceResponse({ prefix: 'crews-...-' })` → `writeTranscript` → `runStop` → `parseStopDecision`.

### Copilot mirror
- `.copilot-plugin/copilot-skills/` mirrors slash commands only.
- Briefing prose is shared via `hooks/copilot-session-start.js` → shared `briefing/template.js`. Single source.
- `hooks/copilot-stop.js` delegates to `hooks/stop.js`. Stop-hook changes apply to both engines.

### Version + CHANGELOG
- Currently v1.7.3 (`.claude-plugin/plugin.json:4`, `.github/plugin/plugin.json`, three repo-level marketplace files, and `tests/version.test.js`).
- Bump via `scripts/bump-version.js`.

### Existing thresholds + heuristics
- 120-char synthesis cap at `hooks/mailbox.js:799-806`.
- No long-summary detection anywhere; no body-floor check.

### lastSummary surfacing
- Displayed in `hooks/commands/status.js`, `hooks/actors.js`, `hooks/crews.js`, and `hooks/commands/review-mail.js:111`.
- review-mail summary fallback (v1.7.3): `row?.summary ?? row?.payload?.summary ?? null`.

## Architect Analysis — recommended hybrid (B)+(D)+(A) v1.7.4

- (A) docs clarification in `briefing/template.js`, `CLAUDE.md`, new `docs/protocol.md`.
- (B) non-blocking stderr warning when `summary.length > N && body.length < M` for `{done, question, blocked}`.
- (D) auto-promote `message = summary + "\n\n" + body` before `appendOutbox()` when condition met.
- Configurable via env vars `CREWS_BODY_CANONICAL_SUMMARY_CAP=200`, `CREWS_BODY_CANONICAL_BODY_FLOOR=50`, `CREWS_BODY_CANONICAL_ENFORCE=block`.
- Optional v1.8.0 follow-up to flip default to hard block.

Rationale: non-breaking; auto-promote prevents accidental data loss in the audit trail; warning trains members.

## Codex Research — recommends hard-block, v1.8.0

> "Use hard-block enforcement for done, question, and blocked; exempt progress by default... non-blocking warn option is weaker than it sounds: existing advisory paths sometimes write to stderr, but that is not as reliable as a transcript-visible model instruction across Claude and Copilot. A hard block fits the existing Stop-hook contract best."

Key points:
- Helper `detectLazySummary(tags, { summaryLimit: 200, bodyMinimum: 50, kinds })`.
- Wire after `parseTurnTags()` and the missing-kind block, before `appendOutbox()`.
- New `docs/protocol.md` is reasonable (no such file today).
- Bump via `scripts/bump-version.js` to 1.8.0.
- Update goldens `tests/golden/briefing-{member,lead}.md`.

## Copilot Research — also recommends hard-block

- Enforcement point: `hooks/stop.js`, before outbox persistence (NOT inside `appendOutbox` because programmatic sends should bypass).
- `progress` exempt; gating progress would create noise.
- "Long summary plus stub body blocks" is a recommended test case.
- "Summary-only reports must block."
- Error copy should be actionable.

## Divergence summary

| Reviewer | Option | Version | Reasoning |
|---|---|---|---|
| Codex | (C) hard-block | v1.8.0 | "warn weaker than sounds; hard block fits Stop-hook contract" |
| Copilot | (C) hard-block | v1.8.0 | "summary-only reports must block" |
| Architect | (B)+(D)+(A) hybrid | v1.7.4 | Non-breaking phasing; can upgrade later |

Operator's prior auto-memory `feedback_fix_architecture_not_workarounds`: prefers architectural fixes over workarounds. Architect's (B) warn is closer to a workaround (members can ignore); (D) auto-promote silently mutates the audit trail.

## Consolidated File List

**Files to modify:**
- `D:/ai-developer-toolkit/plugins/crews/hooks/stop.js` (new gate + helper)
- `D:/ai-developer-toolkit/plugins/crews/hooks/protocol/report-tags.js` (export new helper / constants)
- `D:/ai-developer-toolkit/plugins/crews/hooks/briefing/template.js` (footer-tag clarification)
- `D:/ai-developer-toolkit/plugins/crews/CLAUDE.md` (new body-canonical section)
- `D:/ai-developer-toolkit/plugins/crews/README.md` (brief mention)
- `D:/ai-developer-toolkit/plugins/crews/CHANGELOG.md` (v1.8.0 entry)
- `D:/ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json` (version)
- `D:/ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json` (version)
- Three repo-level marketplace files (pin version) — discoverable via bump-version.js
- `D:/ai-developer-toolkit/plugins/crews/tests/version.test.js` (pinned)
- `D:/ai-developer-toolkit/plugins/crews/tests/golden/briefing-member.md`
- `D:/ai-developer-toolkit/plugins/crews/tests/golden/briefing-lead.md`

**Files to create:**
- `D:/ai-developer-toolkit/plugins/crews/docs/protocol.md` (new doc — body-canonical rule)
- `D:/ai-developer-toolkit/plugins/crews/tests/stop-body-canonical.test.js` (new test file)

**Reference files (use as patterns):**
- `D:/ai-developer-toolkit/plugins/crews/tests/stop-decision.test.js`
- `D:/ai-developer-toolkit/plugins/crews/tests/protocol-report-tags.test.js`
- `D:/ai-developer-toolkit/plugins/crews/hooks/mailbox.js:742-806`
- `D:/ai-developer-toolkit/plugins/crews/tests/lib/force-response.js`
- `D:/ai-developer-toolkit/plugins/crews/scripts/bump-version.js`
