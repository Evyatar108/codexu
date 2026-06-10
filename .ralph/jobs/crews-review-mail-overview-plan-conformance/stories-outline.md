# Stories Outline: crews review-mail OVERVIEW plan-conformance

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> Target: `ai-developer-toolkit/plugins/crews/` (crews plugin, submodule). crews
> v3.19.1 -> 3.20.0. Run SERIALLY in one impl job (US-001 first) — all stories share
> `lib/review-kind-summary.js` + the release/doc files, so parallel = conflict.

## US-001: Rewrite `lib/review-kind-summary.js` to the approved lossless schema
**Description:** As a crews lead draining mail, I want the overview helper to emit the full approved lossless schema (headline, totalEntries, shownRows, senders, counts, actionableCount, needsActionCount, truncatedActionable, actionable[]) so that every non-progress entry is surfaced, not just the first and last.
**Acceptance Criteria:**
- [ ] `lib/review-kind-summary.js` exports `NON_ACTIONABLE_KINDS`, `NEEDS_ACTION_KINDS`, `OVERVIEW_ACTIONABLE_CAP` (=100), `parseOverviewEnv(env)`, `computeReviewKindSummary(records, opts?)`, `expandMessagesToKindRecords(messages)`.
- [ ] Back-compat aliases kept: `reviewOverviewEnabled(env)` = `parseOverviewEnv(env).enabled`; `buildReviewKindSummary(input)` = `computeReviewKindSummary(expandMessagesToKindRecords(input))` (returns NEW shape); `flattenEntries` = `expandMessagesToKindRecords`. `ACTIONABLE_KINDS` removed.
- [ ] `computeReviewKindSummary` returns `{ headline, totalEntries, shownRows, senders, counts, actionableCount, needsActionCount, truncatedActionable, actionable[] }` with `headline` as the FIRST key. `counts` is lossless per-literal-kind weighted by `collapsedCount||1` (no `other` bucket); null/empty kind -> `direct`.
- [ ] `actionable[]` = every record whose kind is NOT in `NON_ACTIONABLE_KINDS`, seq-ordered (tiebreak inboxSeq then input index), each `{ seq, sender, kind, summary, needsAction, inboxSeq }` (+ `collapsedCount` when >1). `needsAction` = kind in `NEEDS_ACTION_KINDS`.
- [ ] `actionableCount`/`needsActionCount` are DISPLAY-ROW counts (pre-cap); `counts`/`totalEntries` are collapsedCount-weighted originals (AC7b). Truncation: `actionableCount > cap` -> `actionable.length === cap` (first cap-1 + the LAST), `truncatedActionable: true`; else full list, `false`.
- [ ] `tests/review-kind-summary.test.js` rewritten: central 21×progress+1×done (counts.done===1, actionableCount===1, actionable[0].kind==='done', actionable[0].seq===done's seq); MANDATORY 3-distinct-actionable (question@10, blocked@20, done@30 interleaved with progress -> all three in actionable[], seq-ordered, correct needsAction); collapsed-actionable (collapsedCount:3 -> counts===3, actionableCount===1, actionable[0].collapsedCount===3); cap-keep-last (>100 actionable -> length===100, last present, actionableCount = true count); headline shape (contains `actionable=`, `done=`, `latest-actionable:`; `none` when empty); `expandMessagesToKindRecords` proactive-batch expansion; `parseOverviewEnv` off/OFF/" off " disabled, unset/on enabled.
- [ ] `node --check lib/review-kind-summary.js` clean; `node tests/review-kind-summary.test.js` passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Rewire `review-mail` consumer + tests
**Description:** As a crews lead, I want `review-mail` JSON to carry the full approved overview as its first key so a head-read never misses a buried actionable entry.
**Acceptance Criteria:**
- [ ] `hooks/commands/review-mail.js` imports + calls `computeReviewKindSummary(entries)` when `parseOverviewEnv().enabled`; `overview` stays the FIRST key in `formatSuccess`. Module re-exports updated to include `computeReviewKindSummary`/`parseOverviewEnv` (keep `buildReviewKindSummary`/`reviewOverviewEnabled` aliases). No change to cursor-advance/collapse/entry shape.
- [ ] `tests/review-mail-command.test.js`: default output has `overview` (new fields) before `name`; 21-progress+1-done end-to-end surfaces the done in `overview.headline` + `overview.actionable`; collapse on/off both surface it; `CREWS_REVIEW_MAIL_OVERVIEW=off` -> NO `overview` key, top-level `Object.keys` byte-identical to pre-feature, cursor-advance unchanged. A test slices the first ~25 lines of the serialized JSON and asserts the `done` is present.
- [ ] `tests/command-args-parity.test.js` re-verified/adjusted (`overview.actionableCount` + off-mode `overview === undefined`).
- [ ] `node --check hooks/commands/review-mail.js` clean.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Rewire `/wake` consumer + tests
**Description:** As a crews lead, I want `/wake` delivery to carry the same approved overview so explicit wake drains surface every actionable entry.
**Acceptance Criteria:**
- [ ] `hooks/user-prompt-submit.js` `/wake`: `parseOverviewEnv().enabled ? {overview: computeReviewKindSummary(entries), entries} : entries`.
- [ ] `tests/wake-explicit-only.test.js`: default `/wake` body `{overview, entries}` with new fields (actionableCount + actionable[]); `=off` -> bare array byte-identical; explicit-only/drain semantics unchanged.
- [ ] `tests/integration/proactive-done-silent-miss.test.js` re-verified/adjusted to the new `/wake` overview schema (the buried-done is in `overview.actionable`).
- [ ] `node --check hooks/user-prompt-submit.js` clean.
**Dependencies:** US-001
**Estimated complexity:** small

## US-004: Rewire listener `deliver()` (counts-only, fail-open) + tests
**Description:** As a crews lead, I want the listener wake envelope to carry lossless per-kind counts + actionableCount (counts-only, body-free, fail-open) so the one-line wake hints that an actionable item is buried inside.
**Acceptance Criteria:**
- [ ] `lib/listener-loop.js` `deliver()`: when `parseOverviewEnv(env).enabled`, inside a try/catch (fail-open), `const records = expandMessagesToKindRecords(messages); const overview = computeReviewKindSummary(records); envelope.kinds = overview.counts; envelope.actionableCount = overview.actionableCount;`. `messages` is NEVER added; consume/markExited/finish run regardless.
- [ ] `tests/listener.test.js`: envelope carries `kinds` (lossless counts) + `actionableCount`; `parsed['messages'] === undefined` STILL holds; proactive `payload.entries[]` expanded into per-kind counts; `=off` -> envelope omits `kinds`/`actionableCount`; a malformed-message fail-open case -> delivery still emits `{type:'messages',count}` without `kinds`.
- [ ] `tests/listener-delivery-observability.test.js` re-verified/adjusted (`kinds.done`/`actionableCount` under lossless counts).
- [ ] `node --check lib/listener-loop.js` clean.
**Dependencies:** US-001
**Estimated complexity:** small

## US-005: Version bump 3.20.0 + marketplace sync + CHANGELOG + AGENTS.md + full suite green
**Description:** As a maintainer, I want the conformance shipped as crews 3.20.0 with synced indexes and documentation of the overview shape change so consumers pick it up and future agents understand the schema.
**Acceptance Criteria:**
- [ ] `node scripts/bump-version.js 3.20.0` run; all 6 stamps + `tests/version.test.js` literal == `3.20.0`; `node tests/version.test.js` passes; Codex marketplace policy enums valid.
- [ ] `CHANGELOG.md` prepends a `## 3.20.0` entry documenting the overview shape change + the old->new field rename map (total->totalEntries, kinds->counts, summary->headline, firstActionable/lastActionable->actionable[]) + the kept function-name aliases + the listener counts-only/fail-open change.
- [ ] `AGENTS.md` (plugin) prepends a `## v3.20.0 review-mail overview conformance` section: edit sites, the new schema, the denylist policy, the display-row-vs-weighted semantics (AC7b), the fail-open listener enrichment, the kept aliases, and the common-mistake gotchas.
- [ ] Full `node tests/run.js` green at default concurrency (Windows: prepend `C:\Program Files\Git\bin` to PATH); `node --check` clean on every changed `.js`.
**Dependencies:** US-001, US-002, US-003, US-004
**Estimated complexity:** small
