# Stories Outline: crews-protocol-envelope-canonical-fields

*Generated alongside `plan.md`. Source of truth: the plan's "Preliminary Story Decomposition" and "Acceptance Criteria" sections.*

## S1 — Extend `validateEnvelope` with canonical-address rules + `buildOutboxRow` factory

**Goal:** Add per-field canonical-address rules to `hooks/protocol/envelope.js` and introduce a `buildOutboxRow({seq, kind, summary, message, replyTo, sessionId, hops})` factory that wraps `validateOutboxRow(row, { strict: true })`. NO producer call-site changes yet — this story stands up the contract; later stories enforce it.

**Files:**
- `hooks/protocol/envelope.js` — extend `validateEnvelope` with: (a) `summary` validation (canonical top-level, with strict-mode rejection when `payload.summary` is set and top-level absent), (b) per-kind `payload` subfield rules from the plan table, (c) `from` subfield validation. Add `buildOutboxRow` factory. Add `canonicalAddressFor(field, envelopeKind)` helper exported for tests/docs. Make `buildEnvelope` read `process.env.CREWS_STRICT_SCHEMA` rather than passing unconditional strict.
- `tests/protocol-envelope-canonical.test.js` (NEW) — one assertion per validator rule. Must include named tests:
  - "summary canonical top-level rejects payload.summary-only"
  - "kind asymmetry preserved (env.kind ≠ env.from.kind validates clean)"
  - "replyTo asymmetry preserved (top-level replyTo on outbox AND payload.replyToId on system-mailbox member-reply BOTH validate)"
  - One required/forbidden assertion pair per kind in the plan's per-kind payload rules table.
  - "production fail-open vs CI fail-closed" — same malformed envelope passes write under `CREWS_STRICT_SCHEMA=` unset (warn-only), throws under `CREWS_STRICT_SCHEMA=1`.

**Acceptance:** Plan criteria 1, 6, 7, 9. `node tests/run.js tests/protocol-envelope-canonical.test.js` exits zero. Full `node tests/run.js` still exits zero (no producer changes yet means no behavioral diff).

**Out of scope:** producer wrapping; CI flip.

## S2 — Route `appendSystemMailbox` chokepoint through `buildEnvelope`

**Goal:** Single-point change in `hooks/mailbox.js` that makes 7 of 11 producer call-sites (join-crew, member-left, lead-stopped-you, ask-user-question, thread-fanout, member-reply notify, proactive-report fanout) flow through the new validator.

**Files:**
- `hooks/mailbox.js` — `appendSystemMailbox(name, crew, cwd, messageOrEnvelope, opts)` constructs the envelope via `buildEnvelope({kind, from, to: name, payload, replyTo, sentAt})` before invoking `appendMailboxWithSender`. The existing normalization (string → `{message}`, `from` merge from opts) happens BEFORE the `buildEnvelope` call.
- `hooks/mailbox.js` — `appendOutboxBatch` calls `buildOutboxRow` per row instead of inline `validateOutboxRow(persisted, { cwd, strict: false })`.

**Acceptance:** Plan criterion 2 (partial — 7 of 11 producers). All existing producer tests (`tests/proactive-report-notify.test.js`, `tests/threads-*.test.js`, `tests/member-joined-*.test.js`, etc.) still green. New round-trip tests in S5 will exercise these paths; S2's acceptance is no-regression.

## S3 — Route remaining 4 producer call-sites individually

**Goal:** Wrap the producers that don't flow through `appendSystemMailbox`.

**Files:**
- `hooks/stop.js:~782` (canonical report-tag outbox write) — construct row via `buildOutboxRow` before `appendOutbox`.
- `hooks/stop.js:839` (empty-body-on-retry outbox write) — same.
- `hooks/commands/send-to-member.js:93` — construct envelope via `buildEnvelope` before `appendMailbox`.
- `hooks/commands/send-to-thread.js` — parallel change.

**Acceptance:** Plan criteria 2 (full) + 3. `rg "buildOutboxRow\(" hooks/stop.js` returns 2 hits; `rg "buildEnvelope\(" hooks/commands/send-to-member.js hooks/commands/send-to-thread.js` returns ≥ 1 hit each. All existing send-to-member / send-to-thread / stop-related tests pass unchanged.

## S4 — Enable `CREWS_STRICT_SCHEMA=1` in `tests/run.js`

**Goal:** Flip the test runner to fail-closed on schema violations.

**Files:**
- `tests/run.js` — set `CREWS_STRICT_SCHEMA=1` in the env passed to each `Worker` (extend the existing env construction; don't mutate `process.env` of the parent). Document a per-test opt-out hook (e.g., a per-test `// strict-schema-opt-out` sentinel parsed by the runner, OR a per-worker env override the test sets via `process.env.CREWS_STRICT_SCHEMA = '0'` at the top of its file).
- `README.md` — update the `CREWS_STRICT_SCHEMA=1` entry near line 204 to reflect "required in CI test runner; production defaults to fail-open through v2.3.x for backward compat."

**Acceptance:** Plan criterion 4. `node tests/run.js` exits zero with all 218+ tests green. Any test that fails because it intentionally writes malformed input gets a per-test opt-out with a documenting comment.

**Risk:** Risk R1 in the plan — this story may surface pre-existing producer-shape bugs. Each surfaced failure is either (a) a real bug to fix in S2/S3 (impl member should backport the fix to those stories), or (b) an intentional-malformed-input test that needs the opt-out.

## S5 — Round-trip contract tests per (producer, consumer) pair

**Goal:** Lock the canonical-address contract in place at the wire level.

**Files:**
- `tests/protocol-envelope-roundtrip.test.js` (NEW) — for each pair below, construct a real envelope via the producer code path against a tempdir, read it back via the consumer code path, assert the field value survives non-empty:
  - `stop.js:782 appendOutbox` → `review-mail.js:111` (summary, kind, replyTo)
  - `stop.js:~831 appendSystemMailbox` → `review-mail.js:111` (summary; specifically exercise both the canonical-address read AND the v1.7.3 fallback path)
  - `stop.js:~831 appendSystemMailbox` → `mailbox.js:713 formatOutboxEntries` (summary top-level)
  - `stop.js:~831 appendSystemMailbox` → `format-progress-tail.js:15` via `mailbox.js:617` digest builder (summary top-level on digest entry)
  - `send-to-member.js:93` → `review-mail.js:111` (summary)
  - `stop.js:1006 appendSystemMailbox` (member-reply notify) → `findActorBySendHistoryId` consumer (payload.replyToId)
  - `stop.js:871` proactive-report with `payload.progressTail` → `review-mail.js:105` + `format-progress-tail.js:2` (nested-only)
  - `mailbox.js:appendOutboxBatch` strict-mode regression: write a malformed row with `summary: 123` (number), assert it throws under `CREWS_STRICT_SCHEMA=1`.

**Acceptance:** Plan criterion 4 (new file green) + criterion 10 (no regressions).

**Pattern:** mirror `tests/protocol-v2-per-report-outbox.test.js` for the harness shape (tempdir setup, `spawnSync` invocation of `hooks/stop.js`, JSON parsing of output).

## S6 — v1.7.2 summary-drop regression test

**Goal:** Lock the v1.7.2 silent-drop fix in place; would have failed pre-v1.7.3.

**Files:**
- `tests/protocol-envelope-roundtrip.test.js` (extend; can ship in same commit as S5) — assertion block: construct an envelope on disk with `payload.summary: 'expected'` ONLY (no top-level `summary`) via direct JSONL write, run `review-mail`, assert the entry surfaces with `summary === 'expected'` (the v1.7.3 fallback) AND assert a `schema-warning:` log line was emitted naming the non-canonical address. Comment the block: "// v1.7.2 summary-drop regression — would have FAILED pre-v1.7.3."

**Acceptance:** Plan criterion 5.

## S7 — Documentation + version bump + (stretch) GitHub Actions

**Goal:** Make the canonical-address contract discoverable and version-stamped.

**Files:**
- `docs/protocol.md` — append "Canonical envelope field addresses" section with the per-field table (verbatim from plan) and the per-kind `payload` rule table.
- `README.md` — update `CREWS_STRICT_SCHEMA=1` entry (line ~204) to reflect required-in-CI + production fail-open through v2.3.x.
- `CHANGELOG.md` — v2.3.0 entry documenting: (a) canonical-address contract, (b) `payload.summary` deprecation timeline, (c) forward pointer to `crews-envelope-summary-canonical-cleanup` for the cleanup, (d) note that the v1.7.3 dual-fix is preserved this minor.
- Run `node plugins/crews/scripts/bump-version.js 2.3.0` per release runbook.
- Run `node plugins/crews/tests/version.test.js` to verify all 6 manifest files agree.
- **Stretch (operator-confirmed):** `.github/workflows/crews-tests.yml` (at ai-developer-toolkit root) — PR workflow that runs `node plugins/crews/tests/run.js` with `CREWS_STRICT_SCHEMA=1` on PRs touching `plugins/crews/**`.

**Acceptance:** Plan criterion 8 (+ criterion 11 if stretch).

## Story Dependencies

- S1 has no dependencies.
- S2 depends on S1 (validator must exist to be called).
- S3 depends on S1 (same reason).
- S4 depends on S2 + S3 (without producer wrapping, strict mode catches pre-existing malformed writes that the impl member would otherwise spend iterations attributing to their own edits).
- S5 depends on S2 + S3 (round-trip tests exercise the wrapped producers).
- S6 can ship in S5's commit.
- S7 depends on the final test count (run after S4–S6).

## Estimated Iterations

5–7 total iterations for a single impl member running `/implement-with-ralph --autonomous`:

- S1 → 2 iterations (validator extension is the biggest unit).
- S2 → 1 iteration.
- S3 → 1 iteration.
- S4 → 1 iteration (may slip to 2 if R1 surfaces multiple pre-existing malformed-input tests).
- S5 + S6 → 1 iteration (one commit).
- S7 → 1 iteration.

## Out-of-Scope (Plan Reference)

See plan's "Out of Scope" section. Specifically NOT in any story:
- Removing the v1.7.3 dual-fix (`crews-envelope-summary-canonical-cleanup`).
- Renaming `payload.replyToId` to `payload.replyTo` (`crews-envelope-replyto-field-name-unification`).
- Renaming `row.from.kind` to `row.from.routingKind` (`crews-envelope-kind-routing-rename`).
- TypeScript / build-step changes.
- On-disk JSONL format migration.
