# Implementation Plan: crews review-mail OVERVIEW/SUMMARY header

> Target: `crews` plugin in the **`ai-developer-toolkit` submodule**
> (`ai-developer-toolkit/plugins/crews/`). Plan-phase deliverable; the impl is a
> two-commit submodule flow (lead-owned at ship). All file paths below are
> relative to `ai-developer-toolkit/plugins/crews/` unless noted.

## 1. Problem

A crews lead/bookkeeper drains a member's mail by running
`node tools/crews.js review-mail <name> --crew <c> --cwd <d>`, **saves stdout to a
file**, and reads only the head (`Select-Object -First 30`) or greps. Proactive
review-mail batches can be 20–30 KB JSON with a **terminal report**
(`kind=done|question|blocked`) buried *after* many `progress` rows. A head-only
read misses the buried terminal report.

This is a documented, repeatedly-hit failure mode (crews/codexu memory
*"review-mail parsing"*: a `done` was missed after 21 `progress` rows because the
output was printed-then-truncated at 30; recurred several times in the 2026-06-09
session). The same blind-spot exists at the **listener wake** (`{type:"messages",
count:N}` one-liner gives no hint that an actionable item is inside) and at the
`/wake` delivery surface.

### Goal

Emit a **compact, self-contained OVERVIEW block at the TOP of review-mail output**
(and additively enrich the listener wake envelope) so a reader who sees only the
first ~15–25 lines, or only the one-line wake, NEVER misses a buried
`done|question|blocked|direct|escalate`. Robust against batches with 20+
`progress` rows. Plugin-side (crews) only. Machine-readability preserved (output
stays JSON).

## 2. Current behaviour (verified against source)

| Surface | File / site | Current output | Gap |
|---|---|---|---|
| CLI/slash `review-mail` | `hooks/commands/review-mail.js` `handler()` → `formatSuccess()` | `JSON.stringify({ name, crew, entries, cursor, warning }, null, 2)` | `entries[]` is a flat list; a terminal row can sit at index 22 behind 21 progress rows. Head-read misses it. |
| `/wake` | `hooks/user-prompt-submit.js` (~L77-78) | bare array `JSON.stringify(historyRows.map(formatReviewMailEntry), null, 2)` | no top summary; same buried-row problem; pinned by `tests/wake-explicit-only.test.js`. |
| Listener wake | `lib/listener-loop.js` `deliver(reason)` (~L443-481) | `{ type:'messages', count, name, crew, sessionId, via }` on stdout | one-liner gives no per-kind / actionable hint. **Invariant (`tests/listener.test.js:22`): `parsed['messages'] === undefined`** — stdout must carry NO bodies. |

Key shapes the plan relies on:

- `formatReviewMailEntry(row, opts)` returns `{ sender, kind, summary, excerpt,
  body, bodyResolution, inboxSeq, id, seq, consumedAt, [displayPrefix],
  [operatorDirectSummary], [collapsedCount, collapsedSeqs, collapsedIds] }`.
  `kind` comes from `rowKind(row) = row.kind || row.from.routingKind` — so a
  proactive expanded entry carries the **report** kind (`done`/`progress`/…),
  while a non-batch member-reply / direct row carries the **route** kind
  (`member-reply`, or `null` for legacy direct sends). `summary = row.summary ??
  null`.
- `expandReviewRows(row)` (review-mail.js) expands a proactive envelope's
  `payload.entries[]` into one display row per report **before** collapse +
  formatting, so the handler's `entries[]` already has the buried `done` as its
  own row with `kind:'done'`.
- Collapse (v3.6.3, `lib/collapse-review-rows.js` + `lib/collapse-key.js`,
  env-gated by `parseCollapseEnv()` / `CREWS_REVIEW_MAIL_COLLAPSE=off`) merges
  **consecutive** rows with the same `(sender, kind, bodyHash, summary)` and empty
  `replyTo`/`acks`/`decisions`. Because `kind` is part of the collapse key
  (`collapse-key.js:84-91`), a `done` can NEVER collapse into a `progress` run —
  the trailing-done robustness holds with collapse on or off.
- Listener `deliver()` runs `consumeMailbox(...)` → `markExited(...)` → `appendLog`
  → `finish({type:'messages',...})`. The consumed `messages` are raw envelopes; a
  proactive batch is ONE envelope whose `payload.entries[]` holds the individual
  report kinds (so counting raw `message.kind` would mis-show a buried `done`
  batch as `{proactive-report:1}` — the listener must expand `payload.entries[]`
  to be useful).

## 3. Design (open questions resolved)

### (a) Flag vs default → **default-ON + env opt-out** `CREWS_REVIEW_MAIL_OVERVIEW=off`

The overview is emitted **by default** on every `review-mail` and `/wake` call —
a per-invocation flag the lead forgets defeats the robustness goal. The env
opt-out `CREWS_REVIEW_MAIL_OVERVIEW=off` (parsed case-insensitively, mirroring
`parseCollapseEnv()`) restores the **byte-identical pre-feature top-level shape**
on all three surfaces. This matches the established v3.6.3 collapse precedent
(default-on behavior + `=off` byte-identical guarantee). No CLI `--overview` flag
(keeps surface minimal; env knob is the documented escape hatch). A
`--summary-only`/quiet mode is explicitly **out of scope** (§7).

### (b) Enrich the listener wake envelope → **YES, additively, fail-open, counts-only**

The listener stdout envelope gains two additive fields: `kinds` (a per-literal-kind
count map) and `actionableCount` (number of non-`progress`, non-notification
entries). Computed via the **same shared helper** applied to the
`payload.entries`-expanded messages, so a buried `done` inside a proactive batch
shows as `kinds:{progress:21,done:1}` / `actionableCount:1` at the wake itself.
**Hard invariant preserved:** counts only, NEVER bodies/summaries — the
`tests/listener.test.js:22` `messages===undefined` assertion must still pass.
**Fail-open:** the enrichment is wrapped in `try/catch`; any throw omits
`kinds`/`actionableCount` and NEVER affects mail delivery (`consumeMailbox` /
`markExited` / `finish` run regardless). Gated by the same
`CREWS_REVIEW_MAIL_OVERVIEW=off` knob. This is the most delivery-sensitive change,
so it is isolated in its own story (US-004) and is independently shippable /
deferrable without touching US-001..US-003.

### (c) Overview field set + format

`formatSuccess` becomes
`JSON.stringify({ name, crew, overview, entries, cursor, warning }, null, 2)` with
`overview` the **first content key after `crew`** so a pretty-printed head-read
(2-space indent) shows the whole block within the first ~6–25 lines.

```jsonc
"overview": {
  "headline": "actionable=1 needsAction=1 | done=1 question=0 blocked=0 reply=1 direct=0 progress=21 | total=23 shown=3 | latest-actionable: done #417 impl-foo: migrated auth, 42 tests green",
  "totalEntries": 23,            // ORIGINAL count: sum of (collapsedCount||1) over display rows
  "shownRows": 3,                // display rows actually in entries[] (post-collapse)
  "senders": ["impl-foo"],       // unique sender names in the batch
  "counts": { "progress": 21, "done": 1, "member-reply": 1 },  // raw per-LITERAL-kind counts (lossless, summed by collapsedCount)
  "actionableCount": 2,          // # non-progress/non-notification entries (pre-cap)
  "needsActionCount": 1,         // subset of actionable where the sender is waiting on the lead
  "truncatedActionable": false,
  "actionable": [                // EVERY non-progress/non-notification entry, seq-ordered, first
    { "seq": 417, "sender": "impl-foo", "kind": "done",     "summary": "migrated auth, 42 tests green", "needsAction": false, "inboxSeq": 31 },
    { "seq": 410, "sender": "impl-foo", "kind": "question", "summary": "merge target: main or release-2.7?", "needsAction": true,  "inboxSeq": 30 }
  ]
}
```

Field rules (settled):
- **`counts`** = raw map keyed by the literal `kind` string (lossless — nothing
  is hidden in an `other` bucket; review-required kinds like `member-reply`,
  `operator-direct`, `escalate-to-operator`, `member-crashed`, and `null`→`direct`
  all appear under their own key). Each entry contributes `collapsedCount || 1`
  so counts reflect the ORIGINAL pre-collapse totals, not display rows.
- **`totalEntries`** = `Σ(collapsedCount || 1)` (original count); **`shownRows`** =
  `entries.length` (display rows). Both surfaced so the lead can tell collapse
  happened.
- **`actionable`** = every entry whose kind ∉ `NON_ACTIONABLE_KINDS`
  (`{progress, thread-fanout, thread-notification, member-joined, member-left}`).
  Ordered by `seq` (then `inboxSeq`). Each row carries
  `{seq, sender, kind, summary, needsAction, inboxSeq}` plus `collapsedCount` when
  > 1. `summary` falls back to the first non-empty line of `body`/`excerpt`,
  trimmed to ≤ 140 chars, when `row.summary` is null.
- **`needsAction`** (per-row, finer "the sender is waiting on you" hint) = `kind ∈
  NEEDS_ACTION_KINDS` (`{question, blocked, direct, operator-direct,
  operator-direct-summary, escalate-to-operator, member-crashed}`); `done` and
  `member-reply` are actionable-to-show but `needsAction:false` (informational).
  `null` kind maps to `direct` for both bucketing and needsAction.
- **`headline`** = a single compact STRING (first field inside `overview`) so even
  a `grep '"headline"'` or a 5-line head-read flags actionable work. It is a JSON
  string value — NOT a non-JSON banner printed outside the object (machine-read
  preserved). Format:
  `actionable=<n> needsAction=<n> | done=<n> question=<n> blocked=<n> reply=<n> direct=<n> progress=<n> | total=<N> shown=<M> | latest-actionable: <kind> #<seq> <sender>: <summary≤80>` (or `latest-actionable: none` when no actionable entries).
- **Truncation (robustness for >cap actionable):** cap `actionable` at
  `OVERVIEW_ACTIONABLE_CAP = 100`. If `actionableCount > cap`, include the first
  `cap-1` PLUS **the last actionable entry** (so a trailing terminal is never lost
  to truncation) and set `truncatedActionable:true`. `actionableCount` always
  reflects the true (un-capped) count.

### (d) Robustness — every non-progress entry surfaced behind 20+ progress rows

The overview is computed from the **full** post-expand/post-collapse `entries`
array and placed FIRST in the serialized JSON. The `actionable[]` list is built by
**filtering the whole array** for non-progress kinds and re-ordering
actionable-first by seq — it does NOT depend on detail-list position. A
`21×progress + 1×done` batch therefore always yields `overview.counts.done === 1`,
`overview.actionableCount === 1`, and the `done` as `actionable[0]`, regardless of
collapse (kind is part of the collapse key, so the `done` can't be merged into the
progress run). This is the central regression the feature targets and is pinned by
a dedicated test (US-001 + US-002).

### (e) JSON-mode vs human-mode

`review-mail` / `/wake` emit **JSON** today and downstream consumers (the lead, its
grep/jq tooling) parse it. The overview is therefore a **structured JSON object**,
not prose — machine-readability is preserved and improved (`overview.counts.done`,
`overview.actionable[].kind` are grep/jq-addressable). The `headline` string gives
the human-glance affordance inside the JSON. No separate human/text rendering mode
is introduced (out of scope, §7).

### Shared helper — `lib/review-kind-summary.js` (pure, no IO)

Mirrors the `lib/collapse-*.js` precedent (pure leaf module, unit-tested directly,
NOT re-exported through `hooks/config.js`).

- `NON_ACTIONABLE_KINDS`, `NEEDS_ACTION_KINDS` — exported Sets (the literal-kind
  policy lives in ONE place).
- `parseOverviewEnv(env = process.env)` → `{ enabled }` (`enabled=false` only when
  `CREWS_REVIEW_MAIL_OVERVIEW` lowercases/trims to `off`).
- `computeReviewKindSummary(records, opts?)` → the `overview` object above.
  `records` = lightweight `[{ seq, sender, kind, summary, inboxSeq?, collapsedCount? }]`.
  Pure; tolerant of `null`/missing fields (null kind → `direct`; null summary →
  `''`). `opts.cap` defaults to `OVERVIEW_ACTIONABLE_CAP`.
- `expandMessagesToKindRecords(messages)` → pure; flattens raw consumed envelopes
  into `[{seq, sender, kind, summary}]`, expanding proactive `payload.entries[]`
  the same way `expandReviewRows` does (report kind + report seq per entry; the
  wrapper's own kind for non-batch rows). **Listener-only** — `review-mail`/`/wake`
  feed their already-formatted `entries` straight in, so the overview always
  matches the detail rows shown.

Consumers:
- `review-mail.js handler()`: `const overview = parseOverviewEnv().enabled ?
  computeReviewKindSummary(entries) : null;` thread into the result;
  `formatSuccess` includes `overview` only when non-null (env-off ⇒ key absent ⇒
  byte-identical pre-feature shape).
- `user-prompt-submit.js` `/wake`: when enabled, emit `{ overview, entries }`; when
  `=off`, emit the bare array exactly as today.
- `lib/listener-loop.js deliver()`: when enabled, `try { const recs =
  expandMessagesToKindRecords(messages); const s =
  computeReviewKindSummary(recs); env.kinds = s.counts; env.actionableCount =
  s.actionableCount; } catch (_) { /* fail-open: omit, never block delivery */ }`.

## 4. Files to create / modify (all under `ai-developer-toolkit/plugins/crews/`)

| Action | File | Change |
|---|---|---|
| **CREATE** | `lib/review-kind-summary.js` | pure helper (see §3); exports `computeReviewKindSummary`, `expandMessagesToKindRecords`, `parseOverviewEnv`, `NON_ACTIONABLE_KINDS`, `NEEDS_ACTION_KINDS`, `OVERVIEW_ACTIONABLE_CAP`. |
| MODIFY | `hooks/commands/review-mail.js` | import helper; compute `overview` from `entries` in `handler()`; thread into the returned result + `formatSuccess` (default-on, env-off ⇒ key absent). No change to cursor-advance, collapse, or entry shape. |
| MODIFY | `hooks/user-prompt-submit.js` | `/wake` delivery: wrap `{ overview, entries }` when enabled; bare array when `=off`. |
| MODIFY | `lib/listener-loop.js` | additive `kinds` + `actionableCount` on the `deliver()` stdout envelope, fail-open, counts-only, env-gated. |
| **CREATE** | `tests/review-kind-summary.test.js` | pure-helper unit tests (see §5). |
| MODIFY | `tests/review-mail-command.test.js` | overview-on default + 21-progress+1-done + collapse-on/off + bucketing + env-off byte-identical top-level shape. |
| MODIFY | `tests/wake-explicit-only.test.js` | wake-overview-on default + env-off bare-array byte-identical. |
| MODIFY | `tests/listener.test.js` | envelope carries `kinds` + `actionableCount`; `messages===undefined` STILL holds; proactive-batch expansion; env-off minimal envelope. |
| MODIFY | `CHANGELOG.md` | prepend `## 3.19.0` entry. |
| MODIFY | `AGENTS.md` | prepend a `## v3.19.0 review-mail overview header` section (edit sites, env knob, invariants, gotchas) per the plugin's per-version-section convention. |
| MODIFY (script-driven) | `.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json`, root `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `tests/version.test.js` | `node plugins/crews/scripts/bump-version.js 3.19.0` (6 stamps + version test). |

## 5. Test plan (the regression the feature targets is mandatory)

`tests/review-kind-summary.test.js` (pure, fast):
- 21×`progress` + 1 trailing `done` ⇒ `counts.done===1`, `actionableCount===1`,
  `actionable[0].kind==='done'`, `actionable[0].seq` = the done's seq. **The core
  regression.**
- bucket coverage: `done`/`question`/`blocked`/`progress`/`member-reply`/`direct`
  (kind `null` ⇒ `direct`)/`operator-direct`/`escalate-to-operator`/`member-crashed`
  each land under their own `counts` key and (except progress) appear in
  `actionable`; notification kinds (`thread-fanout`, `member-joined`, …) are NOT
  actionable.
- `needsAction` predicate: true for question/blocked/direct/operator-direct/
  escalate/member-crashed; false for done/member-reply/progress.
- `collapsedCount`: a collapsed head row with `collapsedCount:5` contributes 5 to
  `counts`/`totalEntries` and carries `collapsedCount` into its actionable item;
  `shownRows` counts display rows.
- truncation: > cap actionable ⇒ `truncatedActionable:true`, length `=== cap`,
  the LAST actionable entry is present, `actionableCount` = true count.
- `headline` shape: contains `actionable=`, `done=`, `latest-actionable:`; `none`
  when no actionable entries.
- `expandMessagesToKindRecords`: a proactive envelope with
  `payload.entries:[{seq,kind:'progress'}×21, {seq,kind:'done'}]` expands to 22
  records with the right kinds/seqs; a non-batch member-reply / direct stays one
  record with its route kind.
- `parseOverviewEnv`: `off`/`OFF`/` off ` ⇒ disabled; unset/`on`/anything else ⇒
  enabled.

`tests/review-mail-command.test.js`: default run includes `overview` as first
content key with correct counts; 21-progress+1-done end-to-end surfaces the done
in `overview`; collapse on vs off both surface it; `CREWS_REVIEW_MAIL_OVERVIEW=off`
⇒ output has NO `overview` key and is byte-identical to current; cursor-advance
unchanged in all cases.

`tests/wake-explicit-only.test.js`: default `/wake` body = `{overview, entries}`;
`=off` ⇒ bare array byte-identical to current; the existing explicit-only / drain
semantics unchanged.

`tests/listener.test.js`: envelope carries `kinds` + `actionableCount`;
`parsed['messages'] === undefined` STILL asserted; a proactive batch shows the
expanded per-kind counts; `=off` ⇒ envelope has neither `kinds` nor
`actionableCount` (minimal shape preserved). Add a fail-open assertion (malformed
message ⇒ delivery still emits `{type:'messages',count}` without `kinds`).

Run gate: `cd ai-developer-toolkit/plugins/crews && node tests/run.js` green
(Windows: prepend `C:\Program Files\Git\bin` to PATH for the bash-stub tests).
`node tests/version.test.js` green after the bump. `node --check` on each changed
`.js` (the plugin has no tsconfig; `node --check` is the typecheck per crews
AGENTS.md).

## 6. Acceptance criteria

- **AC1** `lib/review-kind-summary.js` exists and exports the documented pure
  surface; all `tests/review-kind-summary.test.js` cases pass, including the
  21×progress+1×done regression (`overview.actionable[0].kind==='done'`).
- **AC2** Default `review-mail` output is `{name, crew, overview, entries, cursor,
  warning}` with `overview` before `entries`; for a 21-progress+1-done batch a
  read of only the first 25 lines of the pretty-printed JSON contains the `done`
  (in `overview.headline` and `overview.actionable`). Verified by a test that
  slices the serialized output.
- **AC3** `CREWS_REVIEW_MAIL_OVERVIEW=off` produces output with NO `overview` key,
  byte-identical to pre-feature `review-mail`; `/wake` emits the bare array
  byte-identical to pre-feature; listener envelope omits `kinds`/`actionableCount`.
  Pinned by tests on all three surfaces.
- **AC4** Listener stdout envelope carries additive `kinds` (per-kind counts, with
  proactive `payload.entries[]` expanded) + `actionableCount`, while
  `parsed['messages'] === undefined` still holds; enrichment is fail-open (a thrown
  summary computation never blocks delivery — covered by a test).
- **AC5** `counts` is a lossless per-literal-kind map (no `other` bucket);
  `member-reply`, `operator-direct`, `escalate-to-operator`, `member-crashed`, and
  `null`→`direct` each appear under their own key and (except progress/notifications)
  in `actionable`.
- **AC6** Collapse interaction correct: counts/`totalEntries` reflect ORIGINAL
  pre-collapse totals via `collapsedCount`; `shownRows` = display rows; a trailing
  `done` is never collapsed into a progress run.
- **AC7** crews version is `3.19.0` across all 6 stamps; `tests/version.test.js`
  passes; CHANGELOG `## 3.19.0` entry and AGENTS.md `## v3.19.0 …` section added;
  marketplace indexes synced (all via `scripts/bump-version.js 3.19.0`).
- **AC8** Full `node tests/run.js` suite green at default concurrency; `node
  --check` clean on every changed `.js`. No change to cursor-advance,
  collapse semantics, mailbox drain, or the entry JSON shape.

## 7. Out of scope / deferred (with rationale)

- **`--summary-only` / quiet CLI mode** (emit ONLY the overview, drop `entries`).
  Useful to shrink saved output, but adds a conditional output shape + test
  surface; the overview-at-top already solves the head-read miss. Future ergonomic
  add.
- **Human/prose rendering mode.** All consumers parse JSON; the `headline` string
  gives the glance affordance. A text mode is a larger, separate change.
- **Per-lead / cross-device summary aggregation.** Out of the review-mail surface.
- **Touching cursor-advance, collapse, mailbox drain, or epoch/consume logic.**
  The feature is purely additive read-side rendering; the load-bearing delivery
  path is only touched by the fail-open, counts-only US-004 enrichment.

## 8. Risks

- **R1 Listener delivery regression.** `lib/listener-loop.js deliver()` is
  load-bearing (epoch/consume). Mitigation: enrichment is fail-open (try/catch
  after consume), counts-only, env-gated, and isolated in US-004 — the operator can
  ship US-001..US-003 (the primary fix) and defer US-004 if any listener risk
  surfaces. The `messages===undefined` test is the guard.
- **R2 Top-level shape break for a machine consumer.** Adding `overview` changes
  the top-level key set. Mitigation: `CREWS_REVIEW_MAIL_OVERVIEW=off` byte-identical
  guarantee + tests pinning it; no known consumer reads review-mail by fixed key
  set (they read `entries`/`cursor` by name).
- **R3 `/wake` compat.** `tests/wake-explicit-only.test.js` pins the bare-array
  shape. Mitigation: the env-off branch keeps it byte-identical and the test is
  updated to assert both branches.
- **R4 Kind drift.** New envelope kinds could fall outside the policy Sets.
  Mitigation: `counts` is a lossless literal-kind map (new kinds always appear);
  only the actionable/needsAction CLASSIFICATION of a brand-new kind would need a
  Set update — and the default (non-progress ⇒ actionable) fails safe toward
  surfacing.

## 9. Implementation order

US-001 (pure helper + its tests) → US-002 (review-mail wiring + tests) → US-003
(`/wake` wiring + test) → US-004 (listener enrichment + test, independently
deferrable) → US-005 (version bump + CHANGELOG + AGENTS.md + marketplace sync).
US-002/003/004 each depend only on US-001. US-005 last (depends on all code
landing). See `stories-outline.md` for the per-story breakdown.
