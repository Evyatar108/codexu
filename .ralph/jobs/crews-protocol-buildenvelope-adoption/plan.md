# Plan: crews-protocol-buildenvelope-adoption

**Task:** `crews-protocol-buildenvelope-adoption`
**Scope:** crews plugin (`D:/ai-developer-toolkit/plugins/crews/`)
**Planned at:** 2026-05-30
**Workflow:** Plan-direct → impl. Target crews version: 2.3.2.

---

## Scope reassessment vs original brainstorm

The original brainstorm `c52c0360` named four producer call sites still
ad-hoc as of pre-v2.3:

| Site (brainstorm) | Status post-v2.3.0 |
|---|---|
| `stop.js:782 appendOutbox` | **SHIPPED** — `stop.js:880-892` wraps the empty-body retry write in `buildOutboxRow`; `stop.js:1008-1028` routes the main terminal-batch write through `buildOutboxRow`. Additionally, `mailbox.js:appendOutboxBatch` (the chokepoint) internally calls `buildOutboxRow` on every entry. |
| `stop.js:831 appendSystemMailbox` | **SHIPPED** — `mailbox.js:appendSystemMailbox` (line 483) internally calls `buildEnvelope` for every cross-actor system notification. All seven kinds covered (join-crew, member-left, stop-request, ask-user-question, thread-fanout, member-reply, proactive-report) auto-validate. |
| `send-to-member.js:95 appendMailbox` | **SHIPPED** — `send-to-member.js:98` explicitly calls `buildEnvelope` before delegating to `appendMailbox`. |
| `send-to-thread.js writes` | **N/A** — thread-log entries (`threads.js:appendThread`) are deliberately not envelopes. They are entries in a shared message log (`messages.jsonl` per thread), not cross-actor delivery envelopes. The cross-actor delivery layer is the per-subscriber **fan-out**, which DOES go through `appendSystemMailbox` (validated). The thread-log entry shape (seq, id, writtenAt, from, message, replyTo, hops) has no `kind`/`summary` by design — see `protocol.md` §"v2.3.0 canonical envelope field addresses" which scopes the contract to mailbox/outbox writes. |

**Residual gaps after v2.3.0:**

1. **`appendMailbox` is not itself a chokepoint.** `mailbox.js:461 appendMailbox`
   delegates to `appendMailboxWithSender` without calling `buildEnvelope`.
   The only current external caller is `send-to-member.js`, which
   pre-validates explicitly. But this is a convention, not enforced —
   a future producer that calls `appendMailbox` directly would silently
   bypass validation, and grep won't catch it because `appendMailbox` is a
   public export. The asymmetry with `appendSystemMailbox` (which IS a
   self-validating chokepoint) is a foot-gun.
2. **No enforcement test exists.** The current envelope test suite
   (`tests/protocol-envelope-canonical.test.js`, `protocol-envelope-roundtrip.test.js`)
   validates the validator itself. Nothing asserts that every production
   producer path observably routes through `buildEnvelope`/`buildOutboxRow`
   at runtime. A new file added to `hooks/` that opens a mailbox/outbox
   file directly via `fs.appendFile` could bypass the entire framework
   silently.

**Verdict:** scope reduces to two small stories. **Not archived** — story 2
(enforcement test) is genuine future-drift insurance and the entire purpose
of the canonical-address work would erode over time without it. **Not
escalated to a multi-story plan** — both stories fit a single commit.
This plan exists primarily so the impl-phase member doesn't have to re-do
the post-v2.3.0 producer-site survey.

---

## Story 1 — make `appendMailbox` itself a self-validating chokepoint

**Why:** symmetry with `appendSystemMailbox`. Today the chokepoint set is
`{appendSystemMailbox, appendOutboxBatch, send-to-member.js}`. Moving the
`buildEnvelope` call into `appendMailbox` makes it `{appendSystemMailbox,
appendMailbox, appendOutboxBatch}` — exhaustive and indifferent to who calls.
Defensive change against future producers.

**Edit:** `plugins/crews/hooks/mailbox.js:461`. After `deriveSenderIdentity`
and before `appendMailboxWithSender`, add a `buildEnvelope({...})` call
that validates the producer-supplied shape using the same pattern as
`appendSystemMailbox` (lines 483-502): require `./protocol/envelope`,
construct the validation envelope from the message arg, discard the returned
object (routing fields are still filled by `appendMailboxWithSender`),
let strict-mode errors bubble up.

**Compatibility:** because `send-to-member.js` ALREADY pre-validates with the
same factory, the new call inside `appendMailbox` will run a second
validation pass for that caller — idempotent, no error. The validator is
pure and side-effect-free apart from the `schema-warning:` log line, which
is debounced upstream. Safe.

**Caveat:** the `appendMailbox` API accepts both a string (`{ message }`
shorthand) and an envelope object. The new validation pass must mirror the
existing `typeof message === 'string'` branch (mailbox.js:437-439) so a
string message validates as `{ kind: 'message', from: sender, ... }`. Use
`envelope.kind || opts.kind || 'message'` for env.kind precedence,
mirroring the `envelope.kind || opts.kind || 'thread-fanout'` precedence in
`appendSystemMailbox`.

**Acceptance:**
- `appendMailbox` calls `buildEnvelope` before delegating, for every input
  shape (string and object).
- Existing `send-to-member.js` callers continue to pass (the explicit
  pre-validation call is now redundant but kept for clarity — leave a
  comment noting the second validator pass is intentional).
- All existing tests under `plugins/crews/tests/` continue to pass.
- Under `CREWS_STRICT_ENVELOPE=1` (set by `tests/run.js`), a producer that
  passes an envelope with `payload.summary` set and top-level `summary`
  unset MUST throw, including via the `appendMailbox` path.

---

## Story 2 — runtime enforcement test for buildEnvelope/buildOutboxRow adoption

**Why:** the chokepoint architecture relies on convention. A new
`hooks/some-new-feature.js` could open `mailbox.json` directly with
`fs.appendFileSync` and silently skip every validator. The
canonical-address contract has no teeth until a test enforces "every
mailbox/outbox write went through the factory."

**Approach: runtime monkey-patch + producer-API drive.**

Static (grep/AST) checks are brittle and high-false-positive: they would
trip on `fs.appendFileSync` calls in `mailbox.js` itself (legitimate),
test fixtures, scripts/, etc. A runtime test that monkey-patches
`buildEnvelope` and `buildOutboxRow` to increment counters, then drives
every public producer API and asserts both counters incremented per-call,
is more robust:

```
// tests/protocol-envelope-enforcement.test.js
const envelope = require('../hooks/protocol/envelope');
let buildEnvelopeCalls = 0;
let buildOutboxRowCalls = 0;
const origBE = envelope.buildEnvelope;
const origBOR = envelope.buildOutboxRow;
envelope.buildEnvelope = function (...args) { buildEnvelopeCalls++; return origBE.apply(this, args); };
envelope.buildOutboxRow = function (...args) { buildOutboxRowCalls++; return origBOR.apply(this, args); };

// For each (producer, expected counter increment) pair, drive the
// producer and assert the counter went up.
//
// Test matrix (covers every cross-actor write path documented in
// v2.3.0 CHANGELOG):
//   1. appendMailbox(name, crew, cwd, "hello string")           -> buildEnvelope +1
//   2. appendMailbox(name, crew, cwd, { message: "obj", kind: "message" })
//                                                                -> buildEnvelope +1
//   3. appendSystemMailbox(name, crew, cwd, {...}, { kind: 'member-joined' })
//                                                                -> buildEnvelope +1
//   4. appendOutbox(name, crew, {kind: 'progress', summary: 'x', body: ''}, cwd)
//                                                                -> buildOutboxRow +1
//   5. appendOutboxBatch(name, crew, [row1, row2], cwd)          -> buildOutboxRow +2
//   6. send-to-member CLI entry (handler({}, args))              -> buildEnvelope +2 (explicit + chokepoint after story 1)
//   7. threads.fanoutThreadNotifications(...) with 2 subscribers -> buildEnvelope +2
//   8. stop.js empty-body retry path (handleInput simulating turn-end on empty body)
//                                                                -> buildOutboxRow +1 (factory pre-validate) + 1 (chokepoint) = >=1
//   9. stop.js terminal-batch path (handleInput with one report tag)
//                                                                -> buildOutboxRow >=1
//  10. pre-tool-use.js ask-user-question intercept (driven via the public hook entry) -> buildEnvelope +1
//
// Assertions are >= rather than == because some paths legitimately
// double-validate (factory pre-call + chokepoint internal call). The
// counter going to 0 is what catches bypass.
```

**Setup harness:** stand up a tmpdir crew, register a lead + member via
`actors.applyJoinCrew` / equivalent, then exercise each producer. Reuse
fixture patterns from `tests/protocol-envelope-roundtrip.test.js` which
already does end-to-end producer→consumer wiring.

**Acceptance:**
- New test file `tests/protocol-envelope-enforcement.test.js`.
- Each of the 10 producer paths above is driven through its public API
  (not via direct call to the chokepoint).
- For each path, `buildEnvelope` OR `buildOutboxRow` counter (whichever
  is canonical for that path) MUST have incremented by at least 1.
- Counter at start of each subtest reset to 0; assertion isolated per
  producer path.
- Test passes against current `main` (sanity check that the v2.3.0
  adoption is complete) AND against story 1's `appendMailbox` change.
- Test would FAIL if someone deletes the `buildEnvelope` call from
  `appendSystemMailbox` or `appendOutboxBatch` (regression catch).
- Add the test file to `tests/run.js` if it uses the runner's auto-discovery
  pattern; otherwise verify it picks up automatically.

**Risk:** monkey-patching the require-cache works for the validator because
all production callers `require('./protocol/envelope')` lazily inside
function bodies (verified: `mailbox.js:484`, `mailbox.js:611`,
`stop.js:884`). A producer that hoisted the require to module top would
miss the patch. Mitigation: test requires `envelope` first, mutates the
exports object in place (the export object is shared across require
sites because Node's require cache is module-scoped), then loads
producers. Run the test in a child process or with `delete require.cache`
between subtests if cross-subtest contamination appears.

---

## Out of scope (deliberately deferred)

- **Thread-log entry envelope schema.** `appendThread` writes entries
  without `kind`/`summary` by design. Adding a thread-message schema is a
  separate decision — likely **never**, because thread messages are a
  shared log not cross-actor delivery; the cross-actor part (per-subscriber
  fan-out) is already covered by `appendSystemMailbox`.
- **Static AST check.** Considered (`@babel/parser` scan of `hooks/**.js`
  for `fs.appendFileSync(.*mailbox|.*outbox` outside `mailbox.js`).
  Rejected because the runtime monkey-patch test in story 2 catches the
  same class of bug with far less brittleness (no false positives on
  legitimate fs.appendFileSync usage in mailbox.js itself, no parser-version
  fragility, no Windows path edge cases).
- **`CREWS_STRICT_ENVELOPE` default-on in production.** The v2.3.0 plan
  explicitly chose warn-only in production (Risk R2: production fail-open).
  Re-evaluating that tradeoff is a separate task once 1-2 release cycles
  of warn-only telemetry have accumulated.

---

## Workflow & verification

1. Bump version `2.3.1` → `2.3.2` in `plugins/crews/.claude-plugin/plugin.json`
   and `plugins/crews/.github/plugin/plugin.json`. Sync the
   `marketplace.json` triplet (`.agents/`, `.claude-plugin/`, `.github/plugin/`)
   per the v2.3.0 commit pattern.
2. Update `plugins/crews/CHANGELOG.md` with a 2.3.2 section noting:
   (a) `appendMailbox` is now a self-validating chokepoint,
   (b) enforcement test added,
   (c) link to this plan.
3. Run `cd plugins/crews && node tests/run.js` from the impl worktree.
   The runner sets `CREWS_STRICT_ENVELOPE=1` by default (line 21 of
   `run.js` per the v2.3.0 commit) so the new test runs in strict mode
   automatically.
4. Commit on `ralph/<task-id>` topic branch with a single squash commit.
   Lead FF-merges + pushes to both remotes (origin, gim-home — gim-home
   is critical so `copilot plugin update` sees the bump).
5. Update `.ralph-overview/data.json` lifecycle → `merged` post-ship.

**Estimated impl size:** ~30 lines in `mailbox.js`, ~200 lines of test
file. Single iteration likely sufficient.
