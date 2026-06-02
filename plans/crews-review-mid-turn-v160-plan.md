# crews-review-mid-turn — Implementation Plan

**Source brainstorm:** `D:/harness-efforts/codexu/plans/crews-review-required-mid-turn-brainstorm.md`
(committed at `cb10c6e7`).
**Target repo / worktree:** `./ai-developer-toolkit/plugins/crews/` (sibling
plugin repo, not codexu). All implementation work happens there.
**Bookkeeping commit (this plan only):** codexu, `origin/main`.
**Target release:** crews **v1.6.0** (minor — recommended). Patch (v1.5.7) is
the operator's alternative if the `progress` → review-required-set narrowing
is rolled back; see "Version bump decision" below.
**Status:** plan-only — no code changes in this run.
**Date:** 2026-05-26
**Author:** crew member `plan-crews-review-mid-turn` (crew `ralph-pipeline`).

---

## 1. Context

### What today's incident showed

On 2026-05-26 between `07:18:01Z` and `07:31:00Z` (`.crews/logs/crews.log` in
this workspace), the lead session `overview-bookkeeper` had unreviewed mail
delivered at `07:18:01Z` (`lastReviewRequiredSeq` stamped on its manifest),
then ran ~9 minutes of unimpeded mid-turn tool calls before finally invoking
`review-mail` at `07:27:32Z` under an operator nudge. Without that nudge the
gap would have extended to `07:31:00Z` for a full **13-minute mid-turn
invisibility window**.

Root cause (verbatim from brainstorm §1):

- **Stop hook** (`stop.js:602-614`) is the only review-required enforcement
  point in v1.5.6 — it fires on turn end only.
- **PreToolUse** (`pre-tool-use.js:390-403`) had its review-required check
  deliberately removed in v1.5.4 → v1.5.5 → v1.5.6 (the **CR-2 regex-bypass
  deadlock**: a regex miss on a legitimate `review-mail` command form
  rejected the very command the block reason suggested).
- **No PostToolUse hook** is registered in `hooks/hooks.json`.

The Stop-only design is sufficient for short turns but fails for the
autonomous-bookkeeper / long-investigation pattern that did not exist when
v1.5.6 was designed (brainstorm §2, "Is the rationale still load-bearing?":
claim (A) regex-bypass coupling **still applies**; claim (B) Stop alone
suffices is **refuted**).

### v1.5.6 design rationale recovery

Re-introducing PreToolUse enforcement (Option A) is on the table but would
re-introduce the byte-for-byte coupling between `buildReviewMailCommand`'s
emitted shapes and `isReviewMailCall`'s bypass regex. Option F bypasses
this trap entirely: PostToolUse never **gates** a tool call — it
**appends a reason** after the call, so there is no command-shape recognizer
to maintain. The agent can keep working; the model just sees a
"mid-turn nag" in its next observation cycle.

---

## 2. Recommended approach — Option F (PostToolUse advisory injection)

### Operator decisions baked into this plan

| # | Decision | Value |
|---|---|---|
| 1 | PostToolUse `decision: block` re-prompts the model with the reason appended? | **CONFIRMED viable.** Option F goes forward; no fallback to Option A required. |
| 2 | Nag rate-limit policy | **Once per `lastReviewRequiredSeq` bump.** Track via new manifest field `lastMidTurnNagSeq` — fire only when `lastMidTurnNagSeq < lastReviewRequiredSeq`. |
| 3 | `GRACE_MS` default | **30 seconds.** Fire if `(now − lastReviewRequiredDeliveryAt) > 30s` AND `lastReviewRequiredSeq > lastReviewedSeq` AND `lastMidTurnNagSeq < lastReviewRequiredSeq`. |
| 4 | Nag content | **Rich** — sender names + kinds, same shape as `reviewRequiredReason`. Reuse the existing reason-builder; prefix with `[mid-turn nag]` so the model can distinguish it from a Stop-time block. |
| 5 | Kinds in `DEFAULT_REVIEW_KINDS` | **Narrow to `['done', 'question', 'blocked']`** — `progress` drops out of the review-required set for **both** Stop (existing v1.5.6 behavior change) AND mid-turn nag (new). |
| 6 | Lead-only vs uniform | **Uniform.** PostToolUse applies to leads AND members. |
| 7 | Cross-plugin survey | **Required before implementation.** Findings below (US-006). |

### Why F over A (CR-2-safe by construction)

PostToolUse never blocks a tool call — it only re-prompts after. No
`isReviewMailCall`-style command-shape recognizer is needed, so the v1.5.4
→ v1.5.5 → v1.5.6 churn cannot recur. The agent observes the nag in the
next model step (in-band, in the context window — strongest signal of any
option evaluated). The cursor advances when `review-mail` runs; the next
PostToolUse sees `R ≤ V` and stays silent.

### High-level data flow

```
agent runs tool T
  ↓
post-tool-use.js fires:
  manifest = readManifest()
  R = manifest.lastReviewRequiredSeq
  V = manifest.lastReviewedSeq
  N = manifest.lastMidTurnNagSeq         ← NEW FIELD
  D = manifest.lastReviewRequiredDeliveryAt
  IF R > V AND R > N AND (now − D) > 30s:
      reason = reviewMidTurnReason(name, crew, cwd, role, manifest)
      updateManifest({ lastMidTurnNagSeq: R })  ← under lock
      emit { decision: 'block', reason: '[mid-turn nag] ' + reason }
  ELSE:
      no-op
```

The Stop hook's strict block (`stop.js:602-614`) is **unchanged** and remains
the final-checkpoint backstop — a turn still cannot end with the cursor
behind.

---

## 3. Cross-plugin PostToolUse survey

Surveyed `./ai-developer-toolkit/plugins/*/hooks/hooks.json` (15 plugins).

**Plugins that register PostToolUse today: 1 — `agent-peers`.**

```
plugins/agent-peers/hooks/hooks.json   matcher: Edit|Write|Bash|mcp__agent-peers__set_summary
                                       command: bash ${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-summary.sh
                                       timeout: 5
```

`plugins/agent-peers/hooks/post-tool-summary.sh` is a pure-bash counter that
emits a non-blocking `hookSpecificOutput.additionalContext` payload every
50 tool calls — it does **not** use `decision: block`. The two hooks are
not on a contention path: agent-peers reads/writes
`~/.claude/agent-peers/{cached-peer-id.txt, summary-counter.txt}`, while
crews would read/write `<stateCwd>/.crews/<crew>/actors/<name>.json`. No
file collision; no shared lock.

**Coexistence implications for crews PostToolUse:**

1. **Fire fast (≤ 5s timeout).** agent-peers already targets 5s with a
   pure-bash hook; crews must keep its Node-based hook well under the same
   ceiling. The existing PreToolUse hook proves Node + manifest-read fits
   in the 5s budget on Windows.
2. **Fail open on any error.** Mirror the existing Claude-side / Copilot-side
   wrappers (PreToolUse's `try/catch` around `handleInput`): a hook crash
   must not stop the agent. Use the same `FAIL_CLOSED_ERRORS` set only for
   the narrow fail-closed cases (e.g. `TamperedFileError`).
3. **No matcher field.** crews PostToolUse needs to fire on every tool call
   (the nag is about agent state, not about a specific tool). agent-peers
   uses a matcher restriction; crews intentionally won't, mirroring its
   own PreToolUse registration (no matcher → fires on every tool).
4. **Output channel choice.** crews uses `decision: block` (re-prompts the
   model) per operator decision #1. agent-peers uses
   `hookSpecificOutput.additionalContext` (next-turn context injection) — a
   gentler shape. The Copilot shim must mirror the crews choice; see US-005
   for the Copilot translation contract.

**Verdict:** safe to add PostToolUse; no conflicts. The plan's US-006
adds an explicit integration test that the two PostToolUse hooks coexist
when both plugins are installed (matters because a future operator could
run crews + agent-peers in the same workspace).

---

## 4. Files to modify / create

All paths under `./ai-developer-toolkit/plugins/crews/` unless prefixed
with `codexu/`.

### New files

- `hooks/post-tool-use.js` — entrypoint for Claude Code's PostToolUse
  surface (US-001 + US-003).
- `hooks/copilot-post-tool-use.js` — Copilot shim mirroring
  `copilot-pre-tool-use.js` (US-005).
- `tests/post-tool-use.test.js` — unit tests for the hook handler
  (manifest reads, seq/grace gating, nag firing) (US-003, US-008).

### Modified files

- `hooks/hooks.json` — register PostToolUse (US-001).
- `.copilot-plugin/hooks/hooks.json` (if it exists for Copilot — verify
  during US-005) — mirror the registration with the Copilot shim entry.
- `hooks/protocol/review-gate.js` — add `reviewMidTurnReason(name, crew,
  cwd, role, manifest)` helper (US-002). Reuses `readInboxHistorySince` +
  `filterReviewRequired` + `senderNames` from the existing
  `reviewRequiredReason` so sender/kind enumeration stays single-source.
- `hooks/protocol/review-required.js` — narrow `DEFAULT_REVIEW_KINDS` from
  `['done', 'question', 'blocked', 'progress']` to `['done', 'question',
  'blocked']` (US-004).
- `hooks/protocol/manifest.js` — declare new manifest field
  `lastMidTurnNagSeq` (number, nullable). Bump `manifestFields.length`
  from 40 → 41. Add `lastMidTurnNagSeq` to `numberFields`. (US-003.)
- `tests/protocol-manifest.test.js` — update `manifestFields.length`
  assertion (40 → 41), add field-presence + `numberFields` membership
  assertions for `lastMidTurnNagSeq` (US-003).
- `hooks/stop.js` — **no functional change.** `reviewRequiredReason` reuses
  `reviewKindsFromEnv()` which delegates to `DEFAULT_REVIEW_KINDS`, so the
  narrowing in US-004 automatically takes effect at Stop too. Verify no
  hardcoded `'progress'` reference elsewhere in the file. (US-004.)
- `tests/integration/review-flow.test.js` — currently asserts Stop blocks
  on `kind: 'progress'` (line 29). Update the test data to use `kind:
  'done'` (or similar) since `progress` will no longer trigger
  review-required. Add new scenarios for mid-turn nag (US-008).
- `tests/review-required-predicate.test.js` — update predicate-level
  assertions about `progress` (US-004).
- `tests/review-gate.test.js` — add coverage for `reviewMidTurnReason`
  shape (US-008).
- `README.md` — document the new PostToolUse hook, the `GRACE_MS`
  override (`CREWS_REVIEW_MID_TURN_GRACE_MS`), the once-per-seq nag
  policy, and the `progress`-no-longer-review-required behavior change
  (US-007).
- `CLAUDE.md` (crews plugin) — add a `## v1.6.0` (or `## v1.5.7`)
  section narrating the PostToolUse mid-turn nag + the kinds narrowing
  + the CR-2-safety property of PostToolUse vs PreToolUse (US-007).
- `.claude-plugin/plugin.json` — version bump (US-009).
- `.github/plugin/plugin.json` — version bump (US-009).
- Marketplace index files (`.claude-plugin/marketplace.json`,
  `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`)
  — version bump via `scripts/bump-version.js` (US-009).
- `codexu/CLAUDE.md` — update the "Crews-plugin invariants (v1.5.6)"
  section to v1.6.0 (US-007). Describe: "Stop hook is strict; PostToolUse
  runs an advisory nag at >30s mid-turn; `progress` no longer
  review-required."
- `codexu/MEMORY.md` and `codexu/memory/feedback_*.md` — no automatic
  changes from implementation, but operators should note that the
  `feedback_check_mailbox_after_tool_bursts.md` memory is **partially
  superseded** by the new hook (the hook does the check; the human-side
  rule about reviewing mid-burst becomes secondary). Out of scope for
  implementation; flag for operator on plan acceptance.

### Reference files (read-only — for implementers)

- `hooks/pre-tool-use.js:380-477` — pattern for manifest-read + decision
  emission inside a hook handler.
- `hooks/pre-tool-use.js:418` — `getListenerState` call site, illustrates
  the existing manifest-read cost on the PreToolUse path.
- `hooks/protocol/review-gate.js:39-85` — `reviewRequiredReason` is the
  template for the new `reviewMidTurnReason`; reuse `readInboxHistorySince`,
  `filterReviewRequired`, `senderNames`, `buildReviewMailCommand`.
- `hooks/protocol/review-required.js:1` — DEFAULT_REVIEW_KINDS declaration
  site.
- `hooks/protocol/manifest.js:5-46` — manifest schema declaration.
- `hooks/mailbox.js:500-528` — `consumeMailbox` writes
  `lastReviewRequiredSeq` + `lastReviewRequiredDeliveryAt` under the
  manifest lock. **The new `lastMidTurnNagSeq` write must use the same
  lock pattern** (`withManifestLock` + `updateManifest`).
- `hooks/copilot-shim.js` — `copilotToClaudePreToolUseInput` and
  `claudeDecisionToCopilot` are the reference for the Copilot shim
  contract; US-005 extends this surface.
- `hooks/copilot-pre-tool-use.js` — closest sibling for the new
  `copilot-post-tool-use.js`. Mirror its `try/catch` + `surface` arg
  shape.
- `plugins/agent-peers/hooks/hooks.json` + `hooks/post-tool-summary.sh`
  — only other PostToolUse registration in the plugins ecosystem.
  Reference for the coexistence test in US-006.

---

## 5. User stories

| ID | Title | Size | Depends on |
|---|---|---|---|
| US-001 | Register PostToolUse + skeleton handler | S | — |
| US-002 | Add `reviewMidTurnReason` helper | S | US-001 |
| US-003 | Implement PostToolUse handler logic + `lastMidTurnNagSeq` field | M | US-001, US-002 |
| US-004 | Narrow `DEFAULT_REVIEW_KINDS` (drop `progress`) | S | — |
| US-005 | Copilot shim for PostToolUse | S | US-003 |
| US-006 | Cross-plugin PostToolUse coexistence test | S | US-003 |
| US-007 | README + plugin CLAUDE.md + codexu CLAUDE.md docs | S | US-003, US-004, US-005 |
| US-008 | Integration tests: mid-turn nag, once-per-seq, grace window | M | US-003 |
| US-009 | Version bump + CHANGELOG-equivalent CLAUDE.md entry | S | US-001..US-008 |

**Estimated total patch size:** ~300–400 lines new code (one new hook file +
helper + Copilot shim + tests + docs), zero deletions in production code
(US-004 is a one-liner data change; the v1.5.6 PreToolUse comment block
stays untouched).

### US-001 — Register PostToolUse + skeleton handler

**Acceptance criteria:**

1. `hooks/hooks.json` contains a `PostToolUse` registration pointing at
   `node ${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js` with `timeout: 5`,
   **no matcher** (fires on every tool call). Format matches the existing
   PreToolUse entry.
2. `hooks/post-tool-use.js` exists. Skeleton-only: reads stdin, parses
   JSON, exits 0 with `{}` stdout. Wraps in `try/catch` that logs to
   `appendLog` and exits 0 on any error (fail-open).
3. Test: a new `tests/post-tool-use.test.js` spawns the script with a
   valid PostToolUse stdin shape, asserts exit 0 + empty `{}` envelope.
4. Existing tests still green (skeleton has no side effects).

**Files changed:** `hooks/hooks.json`, `hooks/post-tool-use.js` (new),
`tests/post-tool-use.test.js` (new).

### US-002 — Add `reviewMidTurnReason` helper

**Acceptance criteria:**

1. `hooks/protocol/review-gate.js` exports a new function
   `reviewMidTurnReason(name, crew, cwd, role, manifest)`.
2. Reuses `readInboxHistorySince(name, crew, cwd, lastReviewed, LIMIT)`,
   `filterReviewRequired(rows, role, { kinds: reviewKindsFromEnv() })`,
   and `senderNames(rows)` — the same primitives that `reviewRequiredReason`
   uses. No duplication.
3. Returns `null` when `R ≤ V` (parallel to the existing helper's null
   path).
4. Returns a multi-line reason string when `R > V`. First line begins with
   `[mid-turn nag] ` followed by the same headline shape as
   `reviewRequiredReason` (e.g. `[mid-turn nag] review-required:
   unreviewed delivery from sender alice — inspect the mail before
   continuing.`). Second line is the literal Bash command from
   `buildReviewMailCommand` (same renderer; do NOT reimplement).
5. Unit test in `tests/review-gate.test.js` (extending the existing
   `engineCase` table): assert null when cursor up-to-date; assert prefix
   `[mid-turn nag] ` present otherwise; assert sender names present in
   reason; assert reason contains the `node … review-mail …` substring.

**Files changed:** `hooks/protocol/review-gate.js`,
`tests/review-gate.test.js`.

### US-003 — PostToolUse handler logic + `lastMidTurnNagSeq` field

**Acceptance criteria:**

1. `hooks/protocol/manifest.js`: add `lastMidTurnNagSeq` to
   `manifestFields` (now length 41); add it to `numberFields`. No
   change to validators beyond the array length.
2. `tests/protocol-manifest.test.js`: bump assertion to 41; add
   `manifestFields.includes('lastMidTurnNagSeq')` + numberFields
   membership.
3. `hooks/post-tool-use.js` (replacing skeleton from US-001): full
   handler.
   - Read stdin → `{ session_id, cwd, tool_name, tool_input }`.
   - Construct `RuntimeContext.fromHook(stdin)` (same pattern as
     PreToolUse).
   - Resolve `state = resolveActorState(ctx)` (same helper PreToolUse
     uses).
   - **Honor `CREWS_REVIEW_MODE`**: if `parseReviewMode(cwd) === 'off'`,
     exit `{}` immediately.
   - Read manifest. Compute `R = lastReviewRequiredSeq`,
     `V = lastReviewedSeq`, `N = lastMidTurnNagSeq || 0`,
     `D = lastReviewRequiredDeliveryAt`.
   - Read grace from env: `GRACE_MS = parseInt(process.env.
     CREWS_REVIEW_MID_TURN_GRACE_MS, 10) || 30000`.
   - Fire condition: `R > V` AND `R > N` AND `(Date.now() − Date.parse(D))
     > GRACE_MS`.
   - On fire: call `reviewMidTurnReason`, write
     `{ decision: 'block', reason: '[mid-turn nag] ' + reason }` to
     stdout, then under `withManifestLock` call `updateManifest({
     lastMidTurnNagSeq: R })`. **Atomic order matters:** write the
     manifest update BEFORE emitting stdout so the model never sees
     a nag whose seq isn't already recorded. (See "Common Mistakes"
     below for rationale.)
   - On no-fire: write `{}`. (advisory mode behavior: write reason to
     stderr but not to stdout — mirrors existing `parseReviewMode`
     handling in Stop.)
   - `try/catch` around the entire body; on caught error
     `appendLog(...)` + write `{}` (fail-open).
4. Unit tests in `tests/post-tool-use.test.js`:
   - cursor up-to-date → `{}` envelope.
   - cursor behind, fresh delivery (`age < 30s`) → `{}`.
   - cursor behind, `age > 30s`, `N < R` → `decision: block` envelope
     with `[mid-turn nag]` prefix; manifest's `lastMidTurnNagSeq`
     advanced to `R`.
   - cursor behind, `age > 30s`, `N === R` (already nagged for this
     seq) → `{}`.
   - new envelope arrives (R advances), `age > 30s` → re-fires.
   - `CREWS_REVIEW_MODE=off` → `{}` regardless.
   - `CREWS_REVIEW_MID_TURN_GRACE_MS=120000` env override is honored.
   - Manifest-read failure → `{}` (fail-open), no throw.

**Files changed:** `hooks/protocol/manifest.js`,
`tests/protocol-manifest.test.js`, `hooks/post-tool-use.js`,
`tests/post-tool-use.test.js`.

### US-004 — Narrow `DEFAULT_REVIEW_KINDS` (drop `progress`)

**Behavior change — operator-visible.** Pre-v1.6.0, a `kind: progress`
envelope delivered to a recipient stamped `lastReviewRequiredSeq` and
the Stop hook blocked turn-end until reviewed. v1.6.0 narrows the set
so only `done`, `question`, `blocked` trigger the review-required gate.
**Both Stop AND the new PostToolUse hook** inherit this narrowing
because both call `filterReviewRequired(rows, role, { kinds:
reviewKindsFromEnv() })`.

**Acceptance criteria:**

1. `hooks/protocol/review-required.js:1` — change
   `DEFAULT_REVIEW_KINDS = Object.freeze(['done', 'question', 'blocked',
   'progress'])` to `Object.freeze(['done', 'question', 'blocked'])`.
2. `tests/review-required-predicate.test.js` — any test that previously
   asserted `progress` triggers the gate must invert (now asserts `progress`
   does NOT trigger it). Add an explicit "narrowed set" assertion listing
   the three remaining kinds.
3. `tests/integration/review-flow.test.js` — the
   `assertStopReviewGateBlocks` helper at line 29 currently uses
   `kind: 'progress'` in its blocked-report tags. Change the helper's
   trigger envelope to `kind: 'done'` (or `'question'`) so the test still
   exercises the gate.
4. `hooks/mailbox.js:512` — no functional change (the call to
   `isReviewRequiredEnvelope` already pulls `reviewKindsFromEnv()` from
   the predicate module; the narrowing flows through).
5. `hooks/protocol/review-required.js::isReviewRequiredEnvelope` already
   has the `'direct'` carve-out — operators cannot bypass review-required
   by sending a `kind: direct` envelope. The narrowing does not touch
   this; explicit test that direct-sends remain review-required.
6. Sanity: grep the entire `plugins/crews/` tree for the literal
   `'progress'` string under `hooks/` and `tests/` — every remaining
   occurrence must be a manifest-state value (`lastKind: 'progress'`) or
   a kind-tag value being emitted (NOT a review-required-set claim).

**Files changed:** `hooks/protocol/review-required.js`,
`tests/review-required-predicate.test.js`,
`tests/integration/review-flow.test.js`.

### US-005 — Copilot shim for PostToolUse

**Acceptance criteria:**

1. `hooks/copilot-shim.js`: add `copilotToClaudePostToolUseInput(stdin)`
   alongside the existing `copilotToClaudePreToolUseInput`. Maps
   Copilot's PostToolUse stdin (`{ sessionId, cwd, toolName, toolArgs,
   toolResult? }`) to Claude's PostToolUse shape (`{ session_id, cwd,
   tool_name, tool_input, tool_response? }`). Confirm the exact Copilot
   PostToolUse stdin shape during implementation by reading
   `options-mode/hooks/` or `agent-peers/hooks/` — both serve as
   reference points.
2. `claudeDecisionToCopilot(claude, opts)` already handles the
   `decision: block` shape for `surface: 'preToolUse'` and `'agentStop'`.
   Extend it to accept `surface: 'postToolUse'` — emit `decision: block`
   + `reason` (no `permissionDecision*` fields; those are preToolUse-only,
   per the existing copilot-shim comment).
3. New file `hooks/copilot-post-tool-use.js`: mirrors
   `copilot-pre-tool-use.js` exactly — translates stdin, calls
   `post-tool-use.js::handleInput`, captures stdout, translates the
   decision back via `claudeDecisionToCopilot(parsed, { surface:
   'postToolUse' })`.
4. `hooks/post-tool-use.js` exports `handleInput({ input, io })` (same
   signature pattern as `pre-tool-use.js`) so the Copilot shim can call
   it directly without subprocess spawn.
5. **Copilot plugin manifest:** if a separate Copilot `hooks.json` lives
   at `.copilot-plugin/hooks/hooks.json` or similar (verify location at
   implementation time — Copilot plugin hooks live in a parallel tree),
   register `postToolUse` with `bash ... copilot-post-tool-use.js`. If
   no separate manifest exists, document this as a follow-up.
6. `tests/copilot-shim.test.js` adds: PostToolUse inbound translation
   shape + outbound `{ decision: block, reason, block: true, blockReason
   }` (no `permissionDecision*`). End-to-end spawn test under
   `tests/copilot-review-fixes.test.js` (or a new
   `tests/copilot-post-tool-use.test.js`) — spawn the Copilot shim with
   a manifest where the cursor is behind, assert the translated envelope.

**Files changed:** `hooks/copilot-shim.js`,
`hooks/copilot-post-tool-use.js` (new), `tests/copilot-shim.test.js`,
`tests/copilot-post-tool-use.test.js` (new) or extension to
`tests/copilot-review-fixes.test.js`.

### US-006 — Cross-plugin PostToolUse coexistence

**Acceptance criteria:**

1. New test `tests/integration/post-tool-use-coexistence.test.js`:
   simulates a workspace where both crews PostToolUse and an
   agent-peers-shape PostToolUse are registered. Assert that crews'
   hook fires and emits its envelope without contention on the
   manifest lock (no shared file path).
2. Document the survey result + the no-contention finding in
   `CLAUDE.md` v1.6.0 section (US-007). The survey itself is in
   §3 of this plan; the implementation just needs to verify the
   regression test runs green.
3. **Performance budget:** add a microbenchmark to
   `tests/post-tool-use.test.js` that runs the handler 1000 times
   and asserts a median wall time ≤ 50ms (well under the 5s hook
   timeout). Document the actual median in the CLAUDE.md v1.6.0
   section so future regressions are detectable.

**Files changed:**
`tests/integration/post-tool-use-coexistence.test.js` (new),
microbenchmark in `tests/post-tool-use.test.js`.

### US-007 — Documentation updates

**Acceptance criteria:**

1. `README.md` (crews plugin): new section "Mid-turn review-required nag"
   under the existing review-required documentation. Document:
   - the PostToolUse hook registration,
   - `CREWS_REVIEW_MID_TURN_GRACE_MS` env override (default 30000),
   - the once-per-`lastReviewRequiredSeq`-bump nag policy,
   - the new manifest field `lastMidTurnNagSeq`,
   - the `progress`-no-longer-review-required behavior change.
2. `CLAUDE.md` (crews plugin): add `## v1.6.0` (or v1.5.7) section
   above the v1.5.6 section. Narrate (in the same style as existing
   sections):
   - **What changed:** PostToolUse advisory injection + kinds
     narrowing.
   - **Why PostToolUse, not PreToolUse:** CR-2-safety — no
     command-shape recognizer is reintroduced.
   - **Common-mistake gotcha:** "Do NOT add a regex bypass to
     PostToolUse. The hook only re-prompts; the cursor advances via
     the existing `review-mail` script's `markReviewed` side effect.
     If a future maintainer is tempted to add an `isReviewMailCall`
     bypass for performance, stop — the CR-2 lesson applies."
   - **Common-mistake gotcha:** "`lastMidTurnNagSeq` must be written
     under `withManifestLock` BEFORE the stdout envelope is emitted.
     If the order is reversed, two PostToolUse fires can race — both
     read N < R, both emit a nag, only one wins the manifest write."
   - **Common-mistake gotcha:** "`progress` envelopes no longer
     trigger the review-required gate at Stop. If a test fails because
     a previously-blocking `progress` send now slips through, the test
     should update its envelope kind to `done` or `question`. Do not
     re-add `progress` to `DEFAULT_REVIEW_KINDS`."
3. `D:/harness-efforts/codexu/CLAUDE.md` "Crews-plugin invariants" section:
   update v1.5.6 → v1.6.0. Replace the existing bullet about Stop being
   the only enforcement point with: "Stop hook strict; PostToolUse runs
   an advisory nag at >30s mid-turn. `progress` envelopes do not trigger
   review-required at either gate."

**Files changed:** `crews/README.md`, `crews/CLAUDE.md`,
`codexu/CLAUDE.md`.

### US-008 — Integration tests for mid-turn nag

**Acceptance criteria:**

1. New scenario in `tests/integration/review-flow.test.js` (or a new
   `tests/integration/post-tool-use-nag.test.js`):
   - Setup: lead `L` with no unreviewed mail. Send a `kind: question`
     to `L`. Run listener; mail delivered; `lastReviewRequiredSeq`
     stamped at e.g. seq=5. Note `lastReviewRequiredDeliveryAt` D.
   - **Fresh-delivery scenario** (`age < 30s`): immediately simulate
     PostToolUse; expect `{}` envelope.
   - **Age-pass scenario** (`age > 30s`, faked by manifest patch on D):
     simulate PostToolUse; expect `decision: block` with `[mid-turn
     nag]` prefix + sender name + the review-mail command.
   - **Once-per-seq scenario** (continuation of age-pass): immediately
     simulate another PostToolUse without intervening review-mail.
     Expect `{}` (nag already fired for this seq).
   - **Cursor-catch-up scenario**: lead runs review-mail; cursor
     advances. Simulate PostToolUse: `{}`.
   - **New-mail scenario**: deliver another `kind: question` (seq=6,
     fresh D). Wait > grace. Simulate PostToolUse: nag fires again
     (N=5 < R=6).
   - **Stop hook still strict**: with cursor behind, simulate Stop
     turn with `kind: progress` body — Stop should block (helper
     `assertStopReviewGateBlocks` from updated US-004 with non-progress
     trigger envelope; this assertion just confirms Stop's existing
     behavior).
2. Member-side scenario: same flow but for a member receiving lead
   mail. Asserts uniform behavior (decision #6).

**Files changed:**
`tests/integration/review-flow.test.js` (extend) OR new
`tests/integration/post-tool-use-nag.test.js`.

### US-009 — Version bump + CLAUDE.md release notes

**Decision required at plan-review time: v1.5.7 (patch) or v1.6.0 (minor)?**

Recommendation: **v1.6.0 (minor)**. Reasons:

- US-004 removes `progress` from `DEFAULT_REVIEW_KINDS` — an
  operator-visible behavior change at the Stop hook (turn-end no longer
  blocks on unread `progress` envelopes).
- US-001 adds a new hook surface — a new ambient interaction the
  operator did not previously opt into.
- US-003 adds a new manifest field — `manifestFields.length` 40 → 41
  (an asserted invariant in `protocol-manifest.test.js`).

If the operator wants to keep `progress` in `DEFAULT_REVIEW_KINDS`,
this drops to v1.5.7 (no behavior change at Stop) and US-004 is
removed from scope.

**Acceptance criteria:**

1. Run `node plugins/crews/scripts/bump-version.js 1.6.0` (or `1.5.7`).
   Verify both `plugin.json` files and the three marketplace indexes
   updated.
2. `tests/version.test.js` updated to expect the new version string.
3. CLAUDE.md v1.6.0 section (added in US-007) updated with the final
   chosen version number.

**Files changed:** the five files in `pinnedFiles` of
`scripts/bump-version.js`, `tests/version.test.js`, `CLAUDE.md`.

---

## 6. Common mistakes / confusion points

### Mistake 1 — Don't add a command-shape regex bypass to PostToolUse

PostToolUse never *blocks* a tool call — it *appends a reason*. There
is no need for `isReviewMailCall` here. If a future maintainer "optimizes"
by adding a regex to skip the nag when the *current* tool call is
`review-mail`, they re-introduce the CR-2 trap. The right invariant is:
**PostToolUse fires regardless of which tool ran**; the cursor advances
when `review-mail`'s `markReviewed` side effect lands; the *next*
PostToolUse sees `R ≤ V` and stays silent. That's the natural
self-correction; do not pre-empt it.

### Mistake 2 — Don't reverse the manifest-write / stdout-emit order

The PostToolUse fire path is:

```
1. read manifest
2. compute fire condition
3. updateManifest({ lastMidTurnNagSeq: R })   // under lock
4. stdout.write({ decision: block, reason })
```

If steps 3 and 4 are reversed, two concurrent PostToolUse hooks (e.g.
two tool calls firing in quick succession, both seeing `N < R`) can
each emit a nag before either writes the manifest update. The agent
sees two nags for the same seq — annoying, and a violation of decision
#2 (once per `lastReviewRequiredSeq` bump).

This isn't a hypothetical: Claude Code can batch tool calls in a single
turn, and PostToolUse fires after each. The lock is essential.

### Mistake 3 — Don't re-add `progress` to `DEFAULT_REVIEW_KINDS`

The narrowing in US-004 is intentional and operator-decided. If a test
fails because a previously-blocking `progress` envelope now slips through,
update the test's envelope kind (e.g. `progress` → `done`) rather than
restoring the old set. The narrowing applies to both Stop and PostToolUse;
re-adding `progress` would resurrect the over-aggressive Stop block for
purely informational `progress` updates.

### Mistake 4 — The mid-turn nag and the Stop block coexist; don't conflate

A turn that begins with the cursor behind will see:
- PostToolUse nag at +30s (informational; agent can keep working).
- Stop block at turn-end (still strict; agent cannot end the turn).

These are independent. The nag does NOT advance the cursor; only the
agent running `review-mail` does. If an implementer is tempted to
"auto-advance the cursor on nag" (Option C tension from the brainstorm),
stop — that's the half-measure the brainstorm explicitly rejected.

### Mistake 5 — `lastMidTurnNagSeq` is monotonic; never decrement

If a future incident produces a stale manifest write with
`lastMidTurnNagSeq` > `lastReviewRequiredSeq`, the hook stays silent —
which is the safe failure mode. Do not "fix" this by decrementing
`lastMidTurnNagSeq`. The cursor advances when new mail arrives
(`lastReviewRequiredSeq` bumps); the comparison `R > N` resumes
nagging naturally.

### Mistake 6 — Don't add a PostToolUse matcher

agent-peers uses a matcher (`Edit|Write|Bash|...`). crews must NOT —
the nag is about agent state, not a specific tool. A matcher would
silently disable the nag whenever the agent is reading files (`Read`,
`Grep`, `Glob`), which is exactly the long-investigation case the nag
is designed for.

### Mistake 7 — Copilot shim emits NO `permissionDecision*` for PostToolUse

`permissionDecision` / `permissionDecisionReason` are preToolUse-specific
in Copilot's hook protocol (per the existing `copilot-shim.js` comment).
PostToolUse emits `{ decision, reason, block, blockReason }` only. The
new `surface: 'postToolUse'` branch in `claudeDecisionToCopilot` must
mirror the `surface: 'agentStop'` branch, NOT the preToolUse branch.

### Confusion point 1 — Two manifest fields look similar but mean different things

- `lastReviewRequiredSeq` (R) — set by `consumeMailbox` on delivery.
- `lastReviewedSeq` (V) — advanced by the `review-mail` script.
- `lastMidTurnNagSeq` (N) — advanced by PostToolUse when it fires a nag.
- `lastReviewRequiredDeliveryAt` (D) — timestamp of the most recent R bump.

Don't conflate N and V. V being equal to R means "the agent has
acknowledged the mail content." N being equal to R means "the agent has
been told the mail exists." A turn can have N = R and V < R: the agent
was nagged but hasn't yet reviewed.

### Confusion point 2 — Stop is unchanged; only the gate's *kinds* set narrows

Stop's review-required block at `stop.js:602-614` is **not modified**
by this plan. It will keep firing whenever `R > V`. The behavior change
at Stop is purely from US-004's `DEFAULT_REVIEW_KINDS` narrowing —
`progress` envelopes no longer bump R in the first place, so Stop has
nothing to block on for those. That's a data-flow change, not a code
change in `stop.js`.

### Confusion point 3 — `codexu/CLAUDE.md` says "Crews v1.5.6"; this plan updates that

The codexu repo's CLAUDE.md narrates "Stop hook gates turn completion."
Once the implementation ships, that section's v1.5.6 reference becomes
stale. US-007 explicitly updates it. Do not let the codexu CLAUDE.md
update slip — bookkeeper memory references it directly
(`feedback_check_mailbox_after_tool_bursts.md`).

### Confusion point 4 — `agent-peers` PostToolUse uses additionalContext, not decision: block

When verifying coexistence (US-006), don't be confused by the different
output shapes. agent-peers emits
`hookSpecificOutput.additionalContext` (next-turn context injection);
crews emits `decision: block` (re-prompt). Both are valid Claude Code
hook outputs; they target different model-attention surfaces. The
coexistence test should not assert agent-peers' shape — only that the
crews hook's behavior is correct independent of agent-peers' presence.

---

## 7. Verification

After all stories ship and tests pass, the implementer should
hand-verify the following on a real long-turn lead session:

1. **30s grace window:** spawn a lead, send it a `kind: question`,
   immediately observe the lead's next tool call — expect NO nag
   (delivery just happened, age < 30s).
2. **Nag fires after 30s:** wait > 30s, observe the lead's next
   tool call — expect a `[mid-turn nag]` reason appended to the
   tool result; lead can choose to interleave `review-mail`.
3. **Once-per-seq:** without running `review-mail`, observe the
   next tool call — expect NO nag (N = R).
4. **Catch-up:** lead runs `review-mail`; cursor advances; observe
   next tool call — expect NO nag (R ≤ V).
5. **New mail re-nags:** send another `kind: question`; wait > 30s;
   observe next tool call — expect nag (N < R again).
6. **Stop still strict:** without running `review-mail` after step 5,
   try to end the turn with `kind: progress` — expect Stop block.
7. **`progress` no longer blocks:** in a fresh session with no
   unreviewed mail, send a `kind: progress` envelope; observe Stop
   on a `kind: progress` turn-end — expect Stop to permit (since
   `progress` is no longer in `DEFAULT_REVIEW_KINDS`).
8. **Performance:** with `CREWS_REVIEW_MID_TURN_GRACE_MS=0` (forces
   every PostToolUse to fire), run a 50-tool-call burst — assert no
   visible per-call latency degradation beyond the existing PreToolUse
   path. (PostToolUse runs less critically than PreToolUse — a slow
   hook only delays the next model step, doesn't block a tool.)
9. **CREWS_REVIEW_MODE=off:** assert that the nag is fully disabled
   (existing operator escape valve).
10. **Cross-plugin coexistence:** with agent-peers also installed, run
    a tool burst — assert both hooks fire independently, no manifest
    contention, both observable in the model context.

---

## 8. Out of scope (deferred)

- **Auto-advance cursor on nag** (Option C from brainstorm) —
  explicitly rejected; not in this plan.
- **PreToolUse re-introduction** (Option A from brainstorm) —
  explicitly rejected on CR-2 grounds; not in this plan unless Option F
  fails at deployment-shape verification.
- **Operator-visible CLI to inspect `lastMidTurnNagSeq`** — could be
  exposed via `list-members` or a new `status` field; deferred.
- **Telemetry on nag fire rate** — would help tune `GRACE_MS` and
  inform whether 30s is the right default. Deferred to a follow-up
  release after one week of v1.6.0 deployment.
- **Bookkeeper-memory cleanup** (`codexu/memory/feedback_check_mailbox_
  after_tool_bursts.md` becomes partially superseded). Flag for the
  operator at plan-review time; not part of implementation.

---

## 9. References

- Brainstorm: `D:/harness-efforts/codexu/plans/crews-review-required-mid-turn-brainstorm.md` (committed at `cb10c6e7`).
- Incident log: `D:/harness-efforts/codexu/.crews/logs/crews.log` (07:14:40Z → 07:31:00Z window on 2026-05-26).
- v1.5.6 enforcement code paths: `hooks/stop.js:602-614`, `hooks/pre-tool-use.js:390-403`, `hooks/protocol/review-gate.js:39-85`, `hooks/protocol/review-required.js:1`, `hooks/mailbox.js:508-525`.
- Copilot shim contract: `hooks/copilot-shim.js`, `hooks/copilot-pre-tool-use.js`.
- Manifest schema: `hooks/protocol/manifest.js:5-46`.
- Version bump script: `scripts/bump-version.js`.
- Cross-plugin survey: `./ai-developer-toolkit/plugins/agent-peers/hooks/hooks.json` + `hooks/post-tool-summary.sh` (only other PostToolUse registration in the ecosystem).
- CR-2 history: `./ai-developer-toolkit/GAPS-FROM-2026-05-25-26-SESSION.md` "CR-2 (FIXED v1.5.4/5/6)".
