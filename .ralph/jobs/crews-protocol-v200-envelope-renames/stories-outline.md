# Stories Outline: Crews Protocol v3.0.0 Envelope Field Renames

*Preliminary decomposition from `/plan-with-ralph`. Feed to
`/implement-with-ralph --from-plan` for PRD generation.*

All six stories land in a single PR (atomic breaking rename). Story
boundaries are review/parallelism conveniences, not independent ship
units.

## US-001: Schema rename + new explicit-rejection rules

**Description:** As a crews schema maintainer, I want the canonical-address
registry and the validator to use `from.routingKind` and `payload.replyTo`
AND to actively reject the legacy names, so that a silent regression
where a future producer reintroduces `from.kind` or `payload.replyToId`
is caught at the validator gate, not only at producer-fixture assertion
time.

**Acceptance Criteria:**
- [ ] In `D:/ai-developer-toolkit/plugins/crews/hooks/protocol/envelope.js`:
  - `PAYLOAD_RULES['member-reply'].required` has `replyTo: 'string'`
    (not `replyToId`).
  - `PAYLOAD_RULES['member-reply'].forbidden = { replyToId: true }`
    is added.
  - `validatePayloadRules` honours the new `forbidden` clause and emits
    `envelope.payload.replyToId forbidden for kind=member-reply
    (renamed to replyTo in v3.0.0)` via `fail()`.
  - `CANONICAL_ADDRESSES` has `'from.routingKind'` and `'payload.replyTo'`
    keys; the legacy keys are gone.
  - `validateFromSubfields` (a) validates `from.routingKind` as the new
    name (same kindEnum or null check), AND (b) emits an explicit
    rejection via `fail()` if `from.kind` is present on the input
    (with a message naming the rename so operators know what changed).
  - `validatePayloadRules` reads `env.from.routingKind` (was
    `env.from.kind` at line 171).
  - Module-level CANONICAL ADDRESS CONTRACT comment block (lines 3–35)
    and the `kindEnum` comment at line 40 are updated to reference the
    new field names; the "kept at its current address" note for
    `payload.replyToId` is removed.
- [ ] Acceptance gate AC-15 (manifest-persistence preflight) ran clean
      before US-001 started; zero hits in manifest-touching files.
- [ ] `canonicalAddressFor('from.kind')` and
      `canonicalAddressFor('payload.replyToId')` return `null`.
- [ ] `canonicalAddressFor('from.routingKind')` returns
      `'env.from.routingKind'`.
- [ ] `canonicalAddressFor('payload.replyTo')` returns
      `'env.payload.replyTo'`.
- [ ] Typecheck passes (`node tests/run.js` envelope-only subset).

**Dependencies:** None (gates everything else).
**Estimated complexity:** medium

## US-002: Producer chokepoint + direct payload setters

**Description:** As a system-mailbox producer, I want
`appendSystemMailbox()` to write the routing identity into
`from.routingKind` (not `from.kind`), AND the member-reply notify call
site to put the replied-to id at `payload.replyTo` (not
`payload.replyToId`), so that every production write conforms to the
v3.0.0 wire shape.

**Acceptance Criteria:**
- [ ] In `D:/ai-developer-toolkit/plugins/crews/hooks/mailbox.js`,
      `appendSystemMailbox()` (lines 501–531) writes the routing kind
      to `from.routingKind` at BOTH the local `from` object construction
      site (currently line 505) AND the inline `buildEnvelope({ from: {
      ... } })` call (currently line 526). Caller-facing `opts.kind`
      stays the same — only the wire-shape field name changes.
- [ ] In `D:/ai-developer-toolkit/plugins/crews/hooks/stop.js:1085`,
      the member-reply notify call site sets `payload: { ..., replyTo:
      row.replyTo, ... }` (not `replyToId: row.replyTo`). The
      `kind: 'member-reply'` `opts` value at line 1089 is unchanged
      (caller-facing routing-intent API; written into `from.routingKind`
      by `appendSystemMailbox`).
- [ ] No other line of `mailbox.js` or `stop.js` (in the regions this
      story owns) still references the legacy names.
- [ ] Typecheck passes.

**Dependencies:** US-001 (validator/schema must accept the new names
  AND reject the legacy names first).
**Estimated complexity:** small

## US-003: Non-test consumer rename

**Description:** As a crews consumer (review-mail surface, ack-gate,
question-routing branch, review-required predicate), I want every read
of `from.kind` to become a read of `from.routingKind`, so that
post-rename rows are correctly routed and surfaced.

**Acceptance Criteria:**
- [ ] `hooks/protocol/review-required.js:14` (or the actual line —
      verify) reads `envelope.from.routingKind` instead of
      `envelope.from.kind`.
- [ ] `hooks/commands/review-mail.js:84–88` `rowKind()` fallback reads
      `row.from.routingKind`.
- [ ] `hooks/stop.js:208–209` `ACK_EXEMPT_KINDS.has(entry.from.routingKind)`.
- [ ] `hooks/stop.js:265` `entry.from.routingKind === 'member-question-request'`.
- [ ] No other consumer of `from.kind` remains in `hooks/**` (verified
      by `rg -n 'from\.kind' hooks/`).
- [ ] Typecheck passes.

**Dependencies:** US-001, US-002.
**Estimated complexity:** small

## US-004: Test + fixture migration (producer-path matrix)

**Description:** As a CI maintainer, I want every test fixture and
assertion that references the legacy field names migrated to the new
names, AND I want the v2.3.2 enforcement test extended with positive +
negative per-path assertions, so that strict-mode CI is the gate that
catches any future regression.

**Acceptance Criteria:**
- [ ] All ~33 test files enumerated in plan §Files to Modify (Tests)
      reference `from.routingKind` and `payload.replyTo` in fixtures and
      assertions; zero references to legacy names except in deliberate
      negative-assertion code (see US-005).
- [ ] `tests/protocol-envelope-enforcement.test.js`:
  - Each producer-path subtest asserts the written row's
    `from.routingKind` is the expected value (positive).
  - Each producer-path subtest asserts the written row's `from.kind`
    is `undefined` (negative; catches a dual-emit regression).
  - For member-reply-producing paths ONLY (not every producer):
    asserts `payload.replyTo` equals the expected id AND
    `payload.replyToId` is `undefined`.
- [ ] `node tests/run.js` passes with `CREWS_STRICT_SCHEMA=1` (the
      default). Zero failures. Zero `schema-warning:` lines emitted.
- [ ] Implementer ran a pre-commit grep
      `rg -l 'from\.kind|replyToId|from:\s*\{[^}]*kind|payload:\s*\{[^}]*replyToId'
      D:/ai-developer-toolkit/plugins/crews/ -g '!CHANGELOG.md'
      -g '!PLAN-1.0-crews.md'` and the result was empty (or only test
      negative-assertion code).

**Dependencies:** US-001, US-002, US-003.
**Estimated complexity:** large

## US-005: Validator strict-rejection tests

**Description:** As a regression-guard maintainer, I want explicit
unit tests that feed the validator legacy-named fields and assert it
throws under strict mode, so that a future producer reintroducing the
old name is caught at the schema gate, not only by producer-fixture
assertions.

**Acceptance Criteria:**
- [ ] In `tests/protocol-envelope-canonical.test.js` (or a new sibling
      file `tests/protocol-envelope-strict-rejection.test.js`), a new
      test bloc:
  - Constructs a minimal valid envelope and adds `from.kind: 'member-reply'`.
    Calls `validateEnvelope(env, { strict: true })`. Asserts it throws
    with a message naming `from.kind` and pointing at the rename.
  - Constructs a minimal member-reply envelope with
    `payload.replyToId: 'some-id'` (and the required `payload.replyTo`
    is present too — so this test isolates the forbidden clause).
    Calls `validateEnvelope(env, { strict: true })`. Asserts it throws
    with a message naming `payload.replyToId` and pointing at the
    rename.
  - Warn-mode counterparts: same envelopes, with `{ strict: false }`,
    assert validator returns false AND `schema-warning:` log line was
    emitted (check via the log file at `.crews/<crew>/.log` or the
    in-process log spy if available).
- [ ] These tests run under `node tests/run.js` and pass.
- [ ] These tests would FAIL if the `forbidden` clause is removed from
      `PAYLOAD_RULES` or the explicit `from.kind` rejection is removed
      from `validateFromSubfields` (a deliberate "guard the guard"
      property; implementer verifies by temporarily removing the
      rules in a scratch branch).

**Dependencies:** US-001.
**Estimated complexity:** small

## US-006: Documentation + CHANGELOG + version bump

**Description:** As an operator and a downstream consumer, I want the
docs, changelog, and every version-stamp file to reflect v3.0.0 with
explicit `BREAKING:` markers and an operator-upgrade note about
mid-flight crews, so that the rename is discoverable, the version
sync is intact, and operators know to restart crews before upgrading.

**Acceptance Criteria:**
- [ ] `docs/protocol.md` canonical address table + inline examples
      reflect `from.routingKind` and `payload.replyTo`.
- [ ] `AGENTS.md` agent-facing protocol notes reflect the new names.
- [ ] `README.md` — if it names either field directly, references the
      new name (otherwise unchanged).
- [ ] `CHANGELOG.md` has a new `## 3.0.0 - <date>` entry with:
  - Two explicit `BREAKING:` markers, one per rename, naming the old
    AND new field address.
  - Operator-upgrade note: "On crews you intend to keep mid-flight
    after upgrade, run `/crews-leave-crew` (or wipe
    `.crews/<crew>/inbox/`) before upgrading — stale on-disk
    inbox-history JSONL rows carry the legacy field shape and are not
    back-readable by v3.0.0 consumers. CI's strict-mode gate
    guarantees no production code path reads the legacy names, so the
    only visible impact is one-time stale-row surfacing on first
    post-upgrade `/crews-review-mail`."
  - Migration guidance for any out-of-tree consumer (rename
    `row.from.kind` → `row.from.routingKind`; rename
    `payload.replyToId` → `payload.replyTo`).
- [ ] `PLAN-1.0-crews.md` has a one-line top-of-file note pointing to
      the v3.0.0 rename; its body is otherwise unchanged.
- [ ] All 5 version-stamp files carry `"version": "3.0.0"`:
  - `plugins/crews/.claude-plugin/plugin.json`
  - `plugins/crews/.github/plugin/plugin.json`
  - root `.claude-plugin/marketplace.json` (the crews-plugin entry)
  - `.github/plugin/marketplace.json` (the crews-plugin entry)
  - `.agents/plugins/marketplace.json` (the crews-plugin entry)
- [ ] `tests/version.test.js` `VERSION` literal at line 4 is `'3.0.0'`.
- [ ] `node tests/run.js` passes (the version test enforces all 5
      stamp files + the literal in sync).

**Dependencies:** US-001 through US-005 (docs describe shipped reality).
**Estimated complexity:** medium
