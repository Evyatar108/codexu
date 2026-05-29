## Direction

**D-001 — Runtime schema contract + CI round-trip test (leveraging existing `hooks/protocol/*.js`).**

All three lenses (codex, copilot, devils-advocate) converged on this as the durable convergence. The static catalog the spawn prompt asked for is included below, but the *recommended approach row* points at D-001 — extend the already-shipped `hooks/protocol/envelope.js` validator with canonical-per-field-address rules and enforce one CI round-trip test per producer→consumer pair, instead of layering another read-fallback or write-mirror onto v1.7.3.

## Goal

A crews-plugin envelope schema that declares ONE canonical address per field (top-level vs `payload.*`), enforced at producer write-time when `CREWS_STRICT_SCHEMA=1`, and validated by a CI round-trip test that asserts every (producer call-site, consumer code-path) pair preserves each field. v1.7.3's read-fallback + write-mirror for `summary` becomes the documented transition strategy; v1.8.x then either keeps the mirrors (canonical = top-level) or removes them (canonical = `payload.*`) per-field.

After this lands:
- `hooks/protocol/envelope.js` validates `summary`, `kind`, `replyTo`, `decision`, `ack`, `progressTail`, `reviewedSeq`, `bodyResolution` with explicit canonical addresses.
- `CREWS_STRICT_SCHEMA=1` runs in CI so any new producer that writes to a non-canonical address fails at build time.
- One contract test in `tests/protocol-envelope-roundtrip.test.js` covers all producer→consumer pairs for each field.
- The audit catalog below becomes the change-list for v1.8.x removal of either the consumer fallback or the producer mirror (one, not both).

## Scope

### In Scope

- Spawn a plan-phase member for `crews-protocol-envelope-canonical-fields` (the follow-on plan) that produces the schema extension + CI test design.
- Decide canonical address per field, justified by current test assertions + operator-visible behaviour. Default per-field decisions are listed in the catalog below.
- Add `tests/protocol-envelope-roundtrip.test.js` exercising one round-trip per (producer, consumer) pair.
- Enable `CREWS_STRICT_SCHEMA=1` in the crews-plugin CI workflow.
- Update `CHANGELOG.md` documenting the canonical-address decisions per field.

### Out of Scope

- Migrating crews to TypeScript or introducing a build step. The existing CommonJS schema validator is sufficient.
- Rewriting the storage shape on disk; envelope shape changes are read/write-only, not migration.
- Per-field follow-up implementation work — those become separate plan/impl tasks the bookkeeper queues from the "Per-field follow-up" section below.
- The other two parallel brainstorms (`crews-envelope-body-canonical-for-all-kinds`, `crews-lead-suppress-kind-tag`) — their selected directions will need to be cross-checked but are not blocked by this brainstorm.

## Criteria

- `hooks/protocol/envelope.js`'s `validateEnvelope` rejects an envelope that places `summary` at the non-canonical address when `CREWS_STRICT_SCHEMA=1`. (Today: only validates `kind`, `from`, `to`, `payload`, `replyTo`, `id`, `sentAt` — `summary` is not validated at all.)
- One CI workflow run with `CREWS_STRICT_SCHEMA=1` against the existing test suite — must pass green.
- `tests/protocol-envelope-roundtrip.test.js` instantiates each producer call-site (`stop.js:782 appendOutbox`, `stop.js:831 appendSystemMailbox`, `send-to-member.js:90`, `send-to-thread.js`) and asserts every consumer code-path (`review-mail.js:111 formatReviewMailEntry`, `mailbox.js:617 truncateProgressSummary`, `mailbox.js:713 formatOutboxEntries`, `format-progress-tail.js:15`, `briefing/template.js`) reads a non-empty value.
- A regression test that reproduces the original v1.7.2 summary-drop bug (member-reply envelope with summary only at `payload.summary`) and that test would have FAILED pre-v1.7.3 — locking the fix in place.
- The v1.7.3 dual-fix (read-fallback in `review-mail.js:111` AND write-mirror in `stop.js:833/840`) is consciously kept for ONE more minor (v1.8.x) with a deprecation note pointing at the canonical address; future minors remove the non-canonical path.

## Context

### Catalog — consumer reads of `summary` (file:line → address)

Canonical source: `D:/ai-developer-toolkit/plugins/crews/` at HEAD (v1.7.3, commit 05ef339d).

| File:line | Reads from | Renders to | Notes |
|---|---|---|---|
| `hooks/commands/review-mail.js:111` | `row?.summary ?? row?.payload?.summary` | `/crews:review-mail` JSON output → lead sees `entry.summary` | v1.7.3 fallback. The drift fix. |
| `hooks/format-progress-tail.js:15` | `entry.summary` (top-level on progress digest entry) | Progress-tail prose `(summary)` line | Reads top-level only; progress digest entries are PRE-FLATTENED by `mailbox.js:617`. |
| `hooks/mailbox.js:617` | `row.summary` (top-level on outbox row) | `progressTail.entries[].summary` digest entries | This is a *producer* of the digest envelope read by `format-progress-tail.js:15`. Reads top-level only. |
| `hooks/mailbox.js:713` | `e.summary` (top-level on outbox/mailbox row) | `formatOutboxEntries` text (`--all` peek view) | Reads top-level only. |
| `hooks/stop.js:246` | `entry.message \|\| entry.text \|\| entry.summary` | Pre-route body synthesis fallback chain | Reads top-level only. Tertiary; intentional fallback. |
| `hooks/stop.js:683` | `tags.summary` (parsed report tag) | Pre-write tags validation in stop hook | Reads from tag, not envelope. Out of scope. |
| `hooks/commands/status.js` | `lastSummary` (manifest field, not envelope) | `/status` text | Manifest-sourced, separate read path. Out of scope. |

### Catalog — producer writes of `summary` (file:line → address)

| File:line | Writes to | Notes |
|---|---|---|
| `hooks/stop.js:782` | `appendOutbox({seq, kind, summary, message, replyTo, sessionId})` — TOP-LEVEL only | Outbox row produced by member's `<\|report\|>` tag. No payload mirror. |
| `hooks/stop.js:831-842` | `appendSystemMailbox({kind, summary, message, payload:{summary, kind, ...}})` — TOP-LEVEL + nested `payload.summary` | v1.7.3 producer mirror. Both addresses populated. |
| `hooks/commands/send-to-member.js:95` | `appendMailbox({..., summary: result.summary})` — TOP-LEVEL only | Lead → member send; payload not touched. |
| `hooks/commands/send-to-thread.js` | Same shape as send-to-member; top-level summary | Not shown above; behavior parallel. |

### Drift findings

| (Producer, Consumer) | Producer address | Consumer address | Drift? | Severity |
|---|---|---|---|---|
| `stop.js:782 appendOutbox` → `review-mail.js:111` | top-level | top-level (or fallback to `payload.summary`) | No (top-level present) | OK |
| `stop.js:831 appendSystemMailbox` → `review-mail.js:111` | top-level + payload | top-level (fallback to payload) | No (after v1.7.3) | Was the original silent-drop bug pre-v1.7.3. |
| `stop.js:831 appendSystemMailbox` → `mailbox.js:713 formatOutboxEntries` | top-level + payload | top-level only | No (mirror writes top-level) | OK, but BREAKS if mirror removed without consumer update. |
| `stop.js:831 appendSystemMailbox` → `format-progress-tail.js:15` | top-level + payload | top-level via `mailbox.js:617` | No (mirror writes top-level) | Same brittleness as above. |
| `send-to-member.js:95` → `review-mail.js:111` | top-level | top-level | No | OK |

### Other envelope-field surveys

#### `kind`
- **Producers**: `stop.js:784` (top-level on outbox), `stop.js:832 + 841` (top-level + nested on system-mailbox).
- **Consumers**: `review-mail.js:84-85` (`row.kind \|\| row.from.kind`) — already has TWO-ADDRESS read fallback. `mailbox.js:614` (`row.kind`) on progress digest. Tests at `tests/proactive-report-notify.test.js:58` codify `payload.kind` as canonical.
- **Drift**: row.kind = report kind (`progress`/`question`/`done`/`blocked`/`member-reply`/...). row.from.kind = ROUTING kind (`system`/`thread-fanout`/`member-reply`/...). These are **two semantically distinct fields**, not drift. The catalog must NOT conflate them. Identified by codex lens — also raised by DA as a synthesis question.
- **Silent drop risk**: LOW. Mismatch fails review-gate filter loudly (no progress entries matched).
- **Recommended canonical**: `kind` at top-level for outbox; `kind` at top-level on the envelope + `from.kind` at top-level for routing (distinct field name). Do NOT consolidate.

#### `replyTo` / `replyToId`
- **Producers**: `stop.js:787` (`replyTo` at top-level on outbox), `stop.js:839` (`payload.replyToId` on system-mailbox — note: different field NAME `replyToId` vs `replyTo`).
- **Consumers**: `tests/send-receive-reply-cycle.test.js:36` filters on `row.payload.replyToId`; `tests/spawn-prompt-notify.test.js:39` asserts `payload.replyToId`. No production consumer reads `replyTo` from system-mailbox envelopes — the field is consumed only via test assertions and `findActorBySendHistoryId` (which receives the value as a function arg, not via envelope read).
- **Drift**: `replyTo` (outbox top-level) vs `replyToId` (system-mailbox payload-nested) is **intentional field rename**, not drift. Two address AND two field names. Confusing but not buggy.
- **Silent drop risk**: NONE. If the rename breaks, routing lookup fails noisy (member-reply notification not delivered = no envelope at all, not empty render).
- **Recommended canonical**: keep both names but document the asymmetry in the contract; consider renaming `payload.replyToId` → `payload.replyTo` in v2.0.0 for consistency.

#### `decision`
- **Producers**: `stop.js:167` writes `decision` to mailbox decision rows via `appendMailboxDecisionRows`. Field lives on a dedicated decision-row shape, not on top-level mailbox envelope.
- **Consumers**: `stop.js:122-131, 167, 223` (gate logic), `tests/decision-*.test.js` (numerous). All read `row.decision` at top-level.
- **Drift**: NO drift candidate. Field lives at exactly ONE address (top-level on decision row), never seen on envelope.
- **Silent drop risk**: NONE.
- **Recommended canonical**: status quo; no follow-up needed.

#### `ack`
- **Producers**: `protocol/report-tags.js` parses `ack` from report tags. Surfaces as `tags.ack` in stop.js, transformed to `decision = 'ack-no-action'` on persist.
- **Consumers**: `force-response-*.test.js` series checks ack-tag behaviour; gate logic at `stop.js`.
- **Drift**: NO direct envelope field. Tag-only, transformed to `decision`.
- **Recommended canonical**: status quo; no follow-up needed.

#### `progressTail`
- **Producers**: `stop.js:871` writes `payload.progressTail = buildProgressTail(...)`. NESTED only.
- **Consumers**: `review-mail.js:105-107` reads `row.payload.progressTail`. `format-progress-tail.js:2` reads `payload.progressTail`. All consumers read NESTED — consistent.
- **Drift**: NONE.
- **Silent drop risk**: NONE.
- **Recommended canonical**: payload-nested. Document explicitly so future code doesn't try to surface `row.progressTail`.

#### `reviewedSeq`
- **Producers + Consumers**: manifest-resident field, not envelope. `withManifestLock(...)` + `updateManifest`. Out of envelope-schema scope.
- **Recommended canonical**: N/A.

#### `bodyResolution`
- **Producers**: `review-mail.js:114` SYNTHESIZES this client-side (`resolution.status`) from `resolveBodyFromOutbox`. Not a wire field.
- **Consumers**: appears in `formatReviewMailEntry` output → `/crews:review-mail` JSON.
- **Drift**: synthesized, not persisted. NO drift candidate.
- **Recommended canonical**: N/A.

### Summary of drift findings

**Only `summary` has the silent-drop pattern.** All other surveyed fields either:
- live at one canonical address consistently (`progressTail`, `decision`, `bodyResolution`),
- are intentionally two semantically distinct fields with similar names (`row.kind` vs `row.from.kind`),
- or fail LOUDLY on mismatch (`kind` review-gate filter, `replyTo` routing lookup).

This validates the devil's-advocate observation that the brainstorm's "broad drift on other fields" premise is **partially false**: summary is the singular silent-drop field. The audit is therefore best framed as a *preventive* contract test — D-001 — rather than as a backlog of per-field bug fixes.

### Key existing-machinery observation

`hooks/protocol/envelope.js` SHIPS a `validateEnvelope()` validator with `CREWS_STRICT_SCHEMA=1` enforcement (`envelope.js:21-44`), and a `buildEnvelope()` factory at line 47. **BUT — a grep across `hooks/**/*.js` shows ZERO call-sites of either function from production code.** The schema validator exists but is dead code. This is the root cause that allowed v1.7.2 summary-drop to ship: the schema framework was built, but producers (`stop.js:782`, `stop.js:831`, `send-to-member.js:95`) construct envelope objects ad-hoc without routing through `buildEnvelope()`.

D-001's first concrete step is therefore: **route all producer call-sites through `buildEnvelope()`, then extend `validateEnvelope()` with canonical-address rules per field**. The CI round-trip test then becomes a thin wrapper around already-existing schema machinery.

### Per-field follow-up tasks (bookkeeper backlog seeds)

The bookkeeper should add these as new overview tasks once D-001 ships:

1. **`crews-envelope-summary-canonical-cleanup`** — after D-001, decide canonical address for `summary` (recommend: top-level) and remove the OTHER half of v1.7.3's fix. Either delete the consumer fallback in `review-mail.js:111` OR delete the producer mirror in `stop.js:840`. Not both. Owner-decision required.
2. **`crews-envelope-kind-routing-rename`** — rename `row.from.kind` to `row.from.routingKind` so it's never confused with `row.kind` (report kind). Update `review-mail.js:85`, manifest reads, all tests. Breaking change → v2.0.0.
3. **`crews-envelope-replyto-field-name-unification`** — rename `payload.replyToId` → `payload.replyTo` to match outbox top-level field name. Breaking change → v2.0.0.
4. **`crews-protocol-strict-schema-ci`** — enable `CREWS_STRICT_SCHEMA=1` in the crews-plugin CI workflow. This is a prerequisite for D-001 and arguably the smallest standalone follow-up.
5. **`crews-protocol-buildenvelope-adoption`** — route `stop.js:782 appendOutbox`, `stop.js:831 appendSystemMailbox`, `send-to-member.js:95 appendMailbox`, `send-to-thread.js` writes through `buildEnvelope()`. Prerequisite for D-001's validation rules to have any teeth.

### Open questions for the operator

- Confirm v1.7.3 keeping BOTH the read-fallback (`review-mail.js:111`) AND the write-mirror (`stop.js:833/840`) is intentional through v1.8.x, with one of them removed in v1.9.x once D-001 picks a canonical address. (Yes/No.)
- Confirm canonical default per field — current proposal: `summary` top-level, `kind` top-level, `replyTo` top-level on outbox + `payload.replyToId` on system-mailbox kept as-is (intentional asymmetry), `progressTail` payload-nested. Override?
- Confirm `crews-protocol-strict-schema-ci` (follow-up #4) is the right scope for an immediate fast-follow plan, separate from the larger D-001 plan.

### Disconfirming observation that would falsify D-001

If `hooks/protocol/*.js` is *already* running with `CREWS_STRICT_SCHEMA=1` in CI today (i.e. follow-up #4 is already done), and v1.7.2 summary-drop STILL escaped, then extending the validator without first auditing why it didn't catch the bug is premature. Check `.github/workflows/*` in the canonical crews repo before committing to D-001's plan.

### Brainstorm scope coordination

The other two parallel brainstorms must be cross-checked before the D-001 plan starts:

- **`crews-envelope-body-canonical-for-all-kinds`** — picks canonical for envelope BODY field (`message` vs `body` vs `text`). D-001's `buildEnvelope()` adoption should be sequenced after that brainstorm's body decision, since the schema extension covers both at once.
- **`crews-lead-suppress-kind-tag`** — touches `kind` semantics. D-001's per-field decisions for `kind` and `row.from.kind` must align with that brainstorm's outcome.

Synthesis full text: `brainstorm-synthesis.md` (this directory). Machine-readable manifest: `brainstorm.json` (this directory).
