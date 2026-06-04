# Research Brief — crews-redundant-empty-kind-tag-emissions (D-001)

Compiled 2026-06-04 from 4 parallel research streams (Claude researcher, Claude architect, Codex `gpt-5.5`, Copilot — last one timed out and excluded; the other three converge cleanly).

## Researcher Findings

Validated brainstorm line references against deployed crews **v3.5.0** at `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/`:

- `hooks/commands/review-mail.js:99-118` — `formatReviewMailEntry`. Body-resolution fallback at `100-101`: `const body = resolution.status === 'ok' ? resolution.body : bodyText(row);`. **Pre-fallback delivered body is available via `bodyText(row)` (lines 91-97)** — this is the correct source for the collapse-key body hash per the brainstorm's warning.
- `hooks/commands/review-mail.js:121-135` — `expandReviewRows`. Flattens `payload.entries[]` proactive-batch entries into leaf rows, preserving `entry.body`, `replyTo`, `acks`, `decisions`, `seq`, and adding `inboxSeq`.
- `hooks/commands/review-mail.js:193-209` — `handler`. The plug-in point: rows are read at 193, filtered at 194, expanded+formatted at 199 (`rows.flatMap(...expandReviewRows...).map(...formatReviewMailEntry...)`), cursor advanced from `allRows` (not displayed rows) at 205-209.
- `hooks/stop.js:939-958` — member `system.notification` no-kind exemption. Current.
- `hooks/stop.js:1017-1037` — body-canonical block (brainstorm said `1143-1215`; stale).
- `hooks/stop.js:1251-1306` — outbox row construction per report; `appendOutboxBatch` writes durably. Current.
- `hooks/stop.js:1379-1418` — proactive-routing path. `terminalRows` filtered, `selectTerminalOutboxBatch` collects unread up to latest terminal, `payload.entries[]` shaped at 1387-1397, `appendSystemMailbox` writes the wake-up envelope to the lead.
- `hooks/mailbox.js:723` — `selectTerminalOutboxBatch(name, crew, cwd, baselineSeq)`. **Does NOT dedup.** Returns unread rows through latest terminal in order.
- `lib/listener-loop.js:219-240` — `deliver()` only exits on `messages.length > 0`. `272-275` — `fs.watch` with basename filter (brainstorm said `213-216`; stale).
- `hooks/resolve-body.js` (47 lines) — already a standalone helper. Returns `{status, body, error?}` with discriminated states `not-applicable | outbox-unreadable | seq-not-found | seq-found-empty | ok`.

## Architect Analysis

- **Best plug-in point**: a new pass **between** `rows = ...filter(...)` (line 195) and `entries = rows.flatMap(...)` (line 199) in `review-mail.js`. `formatReviewMailEntry` is single-row; collapse must operate on the list.
- **Cursor preservation**: `lastReviewedSeq` already computes from `allRows` (the un-collapsed list at line 205-209). Collapse naturally preserves cursor semantics.
- **Body fallback hazard confirmed**: at the call site only `row` is available; the pre-fallback body must be re-derived via `bodyText(row)` before calling `resolveBodyFromOutbox`.
- **Helper module vs inline**: prefer a new helper `lib/collapse-review-rows.js` so the same logic can be unit-tested separately and (optionally) reused on `payload.entries[]` if needed.
- **JSON output shape change**: adding `collapsedCount / collapsedSeqs / collapsedIds` extends the contract. `tests/command-args-parity.test.js` pins the key order at lines 191-196 and will need updating in the same story.
- **Stderr warning**: the slash/CLI `runCliCommand` path only writes to stdout via `formatSuccess`. Per-collapse stderr requires either an explicit `process.stderr.write()` inside the handler (bypassing the formatSuccess contract) or a small runtime extension to support a warnings channel.

## Codex Research (`gpt-5.5`, xhigh)

Convergent with researcher + architect. Additional constraints flagged:

- **Empty-metadata predicate must also check `payload.replyToId` and `payload.replyTo`** (legacy v3.0.0 rename — see plugin AGENTS.md), not just top-level `replyTo`. Otherwise system-routed envelopes that carry their reply-target in `payload` would be falsely collapsed.
- **No normalized boolean parser exists** — inline lowercase compare (e.g. `String(env).trim().toLowerCase() !== 'off'`) is the convention. Body-canonical uses this at `stop.js:158-160`; post-tool-use uses `=== 'off'` at `:72`.
- **Runtime plugin-version read does not exist**. Only `tests/version.test.js` reads `.claude-plugin/plugin.json` directly. The plan must add a tiny `lib/version.js` helper (use `getPluginRoot()` from `hooks/paths.js:50`).
- **`appendLog(line, cwd)`** stamps `[ISO] ${line}` and silently swallows errors. Conventions: grep-able key=value text (e.g. `review-mail: bodyResolution=... for memberName=... outboxSeq=...`). NOT JSON.
- **Apply collapse to expanded `payload.entries[]` leaf rows** (per `expandReviewRows`), but do NOT touch `outbox.jsonl`, `mailbox-history.jsonl`, payload batches, or cursor code.

## Local Corpus Measurement (preliminary)

Ran a heuristic dedup pass over `.crews/crews/ralph-pipeline/**/mailbox-history.jsonl`:

```
files: 194 (83 non-empty)
total_rows: 498
extra_consecutive_dups: 5
groups_of_3+: 0
```

Outbox totals: 194 files, 1,837 rows (much larger, but outbox is NOT the lead's review surface).

**Significant disconfirming observation per brainstorm § "Disconfirming observations to watch for in planning":**

> "If the offline measurement shows that most "duplicate" rows actually carry differing replyTo/acks/decisions when read against the live `mailbox-history.jsonl` (not the heuristic body-only count codex used), the collapse pass will hit very few rows and D-001's UX impact will be small. In that case the plan should re-rank toward D-003 or D-004 — but only AFTER the measurement; never speculatively."

The ~1% extra-dups-per-row figure (5/498) is below the brainstorm's hoped-for "≥ 30% reduction" target. Two interpretations:

1. **Re-rank**: defer D-001 in favor of D-003 (source-side suppression) or D-004 (no-op kind) which would have higher signal-per-noise.
2. **Re-frame**: ship D-001 anyway because (a) the bundled D-002 telemetry is the primary value, not the collapse, (b) the heuristic measurement may under-count (key may be missing `from.kind` fallback paths and may not match the eventual implementation's normalized hash), and (c) the cost of D-001 is low and it ships a generic structural improvement to the lead's review surface that doesn't preclude D-003/D-004 later.

The plan recommends option 2 (ship), with US-001 doing a rigorous offline measurement against the actual implementation's collapse logic to either confirm the heuristic finding or revise it upward. US-001 is the gate: if measured reduction is < 5% AND the bundled D-002 telemetry doesn't surface a clear pattern, the operator can decide to halt before US-002+ ships.

## Consolidated File List

### Files to MODIFY (in `ai-developer-toolkit/plugins/crews/`)

- `hooks/commands/review-mail.js` — wire collapse pass into handler at line 199; `formatReviewMailEntry` extended with `collapsedCount/collapsedSeqs/collapsedIds`
- `tests/review-mail-command.test.js` — extend with collapse coverage (10+ cases)
- `tests/strict-ack-review-mail.test.js` — verify cursor preservation; NO modification of existing assertions
- `tests/command-args-parity.test.js` — update key-order pin at lines 191-196 to include new fields
- `.claude-plugin/plugin.json` + `.github/plugin/plugin.json` — version 3.5.0 → 3.6.0
- `tests/version.test.js` — version pin update
- `CHANGELOG.md` — prepend `## 3.6.0 - <date>` entry
- `AGENTS.md` (plugin-level) — prepend new v3.6.0 section

### Files to CREATE (in `ai-developer-toolkit/plugins/crews/`)

- `lib/collapse-review-rows.js` — pure collapse helper (~80-120 lines)
- `lib/version.js` — runtime plugin-version reader (~15-25 lines)
- `tests/collapse-review-rows.test.js` — unit tests for the collapse helper (~16+ cases)
- `tests/version-runtime.test.js` — runtime version reader test

### Files to MODIFY (elsewhere in codexu)

- Three marketplace indexes (per AGENTS.md "Plugin Marketplace"):
  - `ai-developer-toolkit/.claude-plugin/marketplace.json`
  - `ai-developer-toolkit/.github/plugin/marketplace.json`
  - `ai-developer-toolkit/.agents/plugins/marketplace.json`
- `AGENTS.md` (codexu root) — `## Active plugin versions` table row for `crews`

### Files OUT of scope (never written)

- `hooks/stop.js` (proactive-routing batch dedup deferred per brainstorm Out-of-Scope; covered by US-010 documenting the deferral)
- `hooks/mailbox.js` (no changes to durable writers — preserves audit log)
- `outbox.jsonl` / `mailbox-history.jsonl` file formats (untouched)
- `hooks/resolve-body.js` (already discriminated; no changes needed)
