# Research Brief: crews review-mail overview plan-conformance

## Researcher Findings (explore agent, gpt-5.4-mini)

### lib/review-kind-summary.js (SHIPPED v3.19.x)
- Exports: `ACTIONABLE_KINDS`, `buildReviewKindSummary`, `flattenEntries`, `reviewOverviewEnabled` (`lib/review-kind-summary.js:123-128`).
- `ACTIONABLE_KINDS` (allowlist) = blocked, direct, done, escalate, escalate-to-operator, message, operator-direct, operator-direct-summary, question (`:1-11`).
- `reviewOverviewEnabled(env)` reads `CREWS_REVIEW_MAIL_OVERVIEW`, trims/lowercases, off only for `off` (`:13-16`).
- `kindOf()` priority: `entry.kind` -> `entry.from.routingKind` -> `entry.payload.kind` -> `direct` for `from.role in {lead,member,peer}` or any `sender` -> `unknown` (`:18-30`).
- `senderOf()`: `entry.sender` -> `from` string -> `from.name` -> `from.triggeredBy` -> null (`:32-39`).
- `seqOf()`: `entry.seq` -> `entry.inboxSeq` -> null (`:41-46`).
- `buildReviewKindSummary(entries)` flattens FIRST, then returns `{ total, actionableCount, kinds, firstActionable, lastActionable, summary }` (`:75-98`).
- `flattenEntries()` expands `payload.entries[]`; each child gets `from: child.from||entry.from`, `inboxSeq: entry.seq||entry.inboxSeq`, `id: child.id||entry.id` (`:101-120`).

### Three consumer surfaces (exact wiring)
- `hooks/commands/review-mail.js`: imports `collapseReviewRows, expandReviewRows, buildReviewKindSummary, reviewOverviewEnabled` (`:22-26`). `handler()` does `rows.flatMap(expandReviewRows)` -> optional collapse -> formats entries -> `result.overview = buildReviewKindSummary(entries)` when enabled (`:235-258`, `:312-315`). `formatSuccess()` inserts `overview` FIRST before name/crew/entries/cursor/warning (`:319-327`). Module re-exports `formatReviewMailEntry, expandReviewRows, buildReviewKindSummary, reviewOverviewEnabled` (`:339-362`).
- `formatReviewMailEntry(row, opts)` returns `{ sender, kind, summary, excerpt, body, bodyResolution, inboxSeq, id, seq, consumedAt }` + conditional `reportId, outboxId, outboxSeq, displayPrefix, operatorDirectSummary, collapsedCount/collapsedSeqs/collapsedIds` (`:105-147`). collapsedCount present only when >1.
- `lib/expand-review-rows.js`: for `payload.entries[]` clones each child + adds `id, reportId, outboxId, outboxSeq, from, consumedAt, inboxSeq, payload`; else `[row]` (`:1-21`).
- `lib/collapse-review-rows.js`: consecutive same-key rows collapse; head rows size>1 get `_collapsedCount/_collapsedSeqs/_collapsedIds` (`:32-84`), surfaced by review-mail.js as `collapsedCount/...` (`:137-146`).
- `hooks/user-prompt-submit.js` `/wake`: `reviewOverviewEnabled() ? {overview: buildReviewKindSummary(entries), entries} : entries` (`:79-84`).
- `lib/listener-loop.js`: imports pair (`:14`). `deliver()` envelope `{type,count,name,crew,sessionId,via}` — NO `messages` field (`:474-481`). `if (reviewOverviewEnabled(env)) { envelope.kinds = overview.kinds; envelope.actionableCount = overview.actionableCount }` (`:482-486`). NOT wrapped in try/catch (NOT fail-open). Helper passed `env` arg.

### Test surface (OLD-schema pins that must change)
- `tests/review-kind-summary.test.js:14-27`: pins `total`, `actionableCount`, `kinds`, `firstActionable{index,kind,sender,summary,seq,id}`, `lastActionable.index`, `summary.includes('firstActionable=#22 done')`. `:59-62` pins `reviewOverviewEnabled` on/off.
- `tests/review-mail-command.test.js:99-108`: pins `result.overview.total/actionableCount/kinds/firstActionable.index/firstActionable.kind`. `:126-129`: off-mode byte-shape `Object.keys === ['name','crew','entries','cursor','warning','args']` + `off.overview === undefined`.
- `tests/wake-explicit-only.test.js:64`: `wakeBody.overview.actionableCount === 1`. `:80`: off bare array.
- `tests/listener.test.js:22-24`: `parsed['messages'] === undefined`, `parsed.actionableCount === 2`, `parsed.kinds.direct === 2`. `:63-65`: off-mode `messages/kinds/actionableCount` all undefined.
- **NEW (beyond original plan) consumers also pinning listener/overview output:**
  - `tests/listener-delivery-observability.test.js:89-95` (v3.12.0): listener envelope `actionableCount` / `kinds.done` assertions.
  - `tests/command-args-parity.test.js`: `manifestResolvedJson.overview.actionableCount` + off-mode `overview === undefined`.
  - `tests/integration/proactive-done-silent-miss.test.js:62-70` (v3.19.1): `/wake` overview assertions.

### tests/run.js + version
- `tests/run.js` discovers `*.test.js`, skips `lib/` (`:122-136`); parallel + serial denylist (`:85-103,289-305`).
- `tests/version.test.js` pins `VERSION='3.19.1'` (`:4-42`).
- `scripts/bump-version.js` stamps 6 files: 3 plugin manifests + 3 marketplace indexes (`:14-21,45-65`).
- `.claude-plugin/plugin.json` version `3.19.1`. CHANGELOG top `## 3.19.1 - 2026-06-10`. AGENTS.md per-version sections `## v3.19.1 proactive terminal review expansion`.

## Architect / Copilot Research
- Target richer schema is INCOMPATIBLE with current `buildReviewKindSummary` result. Recommends single policy module exporting `NON_ACTIONABLE_KINDS, NEEDS_ACTION_KINDS, OVERVIEW_ACTIONABLE_CAP, parseOverviewEnv, computeReviewKindSummary, expandMessagesToKindRecords`; keep `buildReviewKindSummary`/`flattenEntries`/`reviewOverviewEnabled` as compat aliases.
- Wire review-mail/`/wake` to compute from already-formatted `entries`; wire listener as raw `messages -> expandMessagesToKindRecords -> computeReviewKindSummary`, set `envelope.kinds = overview.counts` + `actionableCount` inside fail-open try/catch.
- Invariants: `CREWS_REVIEW_MAIL_OVERVIEW=off` omits overview on all 3 surfaces; listener never carries bodies (`messages===undefined`); counts use `collapsedCount||1`; actionable policy = denylist; mandatory new 3+-distinct-actionable regression test.

## Codex Research
- Not run: codex-exec hung on Windows (~9 min, no output) and was stopped. The other two research lanes + the original approved plan fully cover the contract.

## Consolidated File List
### Files to modify (code)
- `lib/review-kind-summary.js` (main rewrite)
- `hooks/commands/review-mail.js` (rewire handler + re-exports)
- `hooks/user-prompt-submit.js` (`/wake` rewire)
- `lib/listener-loop.js` (`deliver()` rewire: counts + fail-open)
### Files to modify (tests)
- `tests/review-kind-summary.test.js` (rewrite to new schema + mandatory 3-distinct-actionable test)
- `tests/review-mail-command.test.js`
- `tests/wake-explicit-only.test.js`
- `tests/listener.test.js`
- `tests/listener-delivery-observability.test.js` (NEW consumer)
- `tests/command-args-parity.test.js` (NEW consumer)
- `tests/integration/proactive-done-silent-miss.test.js` (NEW consumer)
- `tests/version.test.js` (version bump literal — via script)
### Release/docs
- `scripts/bump-version.js` run (6 stamps), `CHANGELOG.md`, `AGENTS.md`
### Reference (read-only)
- `lib/expand-review-rows.js`, `lib/collapse-review-rows.js`, `lib/collapse-key.js`
- `.ralph/jobs/crews-review-mail-overview-summary-header/plan.md` (approved target contract)
