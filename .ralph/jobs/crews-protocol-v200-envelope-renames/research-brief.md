# Research Brief — Crews Protocol v3.0.0 Envelope Field Renames

## Researcher Findings

See `feature-request.txt` for the rename targets. The researcher agent
enumerated:

- **Total matches**:
  - `from.kind`: 70 in `D:/ai-developer-toolkit/plugins/crews`; 7 in
    `D:/harness-efforts/codexu` (backlog text only).
  - `replyToId`: 36 in `D:/ai-developer-toolkit/plugins/crews`; 8 in
    codexu (backlog text only).
  - Zero matches in `plugins/ralph`, `plugins/ralph-overview`, or any
    other plugin under `D:/ai-developer-toolkit/plugins/`.
- **Producers (set `from.kind`)**: `hooks/stop.js:1077-1087`
  (`appendSystemMailbox` member-reply synthesis); plus test fixtures
  in `tests/protocol-envelope-roundtrip.test.js` and
  `tests/protocol-envelope-canonical.test.js`.
- **Producers (set `payload.replyToId`)**: same `hooks/stop.js:1077-1087`
  call; plus the test files listed in the plan's "Test surface" section.
- **Consumers (read `from.kind`)**: `hooks/protocol/envelope.js:171-175`
  (dispatch), `:148-150` (validator), `hooks/commands/review-mail.js:84-88`
  (rowKind fallback), `hooks/stop.js:208-209` (ACK_EXEMPT gate),
  `hooks/stop.js:265` (member-question-request branch),
  `hooks/protocol/review-required.js:14`.
- **Consumers (read `payload.replyToId`)**: `hooks/protocol/envelope.js:73-80`
  (PAYLOAD_RULES required), `:105-112` (CANONICAL_ADDRESSES).
- **Shape complexity**: both fields are direct property access only — no
  computed/dynamic access, no destructuring rename hazards.
- **Test surface**: ~25 test files reference these fields. The matrix
  test is `tests/protocol-envelope-enforcement.test.js` (174 lines,
  v2.3.2-era; monkey-patches `buildEnvelope`/`buildOutboxRow` and drives
  every in-process producer).

## Architect Analysis

- **Recommendation: v3.0.0, bundled, atomic.** Both fields are breaking
  schema shape changes; the canonical-address schema treats them as
  distinct fields with strict enforcement.
- **Why major, not minor**: schema is breaking; CHANGELOG cadence shows
  past breaking changes (`2.0.0`) shipped as atomic major bumps, not
  alias bridges.
- **Why atomic, not aliased**: `CREWS_STRICT_SCHEMA=1` is the default in
  v2.4.0, so dual-emit fights the schema. Marketplace consumers install
  `@latest`, so alias offers zero protection.
- **Why bundled, not split**: both renames touch the same protocol
  envelope family + same validator + same test surface. One breaking
  bump is cleaner than two staged trains.
- **Schema enforcement coupling**: schema (`envelope.js` —
  `PAYLOAD_RULES`, `CANONICAL_ADDRESSES`, `validateFromSubfields`,
  `validatePayloadRules`), emitter (`stop.js` member-reply synth), and
  consumers (validator + `review-mail.js`) must land in the same commit.
- **Marketplace version pin**: `D:/ai-developer-toolkit/.claude-plugin/marketplace.json:83-87`
  references the crews-plugin version; must be bumped alongside
  `plugin.json`.
- **No manifest persistence**: codex research confirmed `from.kind` /
  `payload.replyToId` are not in manifest state files (verified via
  `tests/protocol-manifest.test.js` surface).
- **Risk: subprocess hooks** (`stop.js`, `pre-tool-use.js`) are not
  visible to the in-process enforcement test but are covered transitively
  by hook tests under `CREWS_STRICT_ENVELOPE=1` (also enabled by default
  in v2.4.0).
- **Suggested decomposition**: single PR, multi-commit; story split
  `schema → emitters/consumers → tests/fixtures → docs/changelog`.

## Codex Research

(Same direction as architect; key independent findings:)

- Confirmed plugin version `2.4.0` in
  `D:/ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json:1`.
- Confirmed CANONICAL ADDRESSES live in `envelope.js:105-112`.
- Confirmed `validatePayloadRules()` at `:170-186` already has a local
  variable `routingKind` derived from `env.from.kind` — naming the
  field `routingKind` aligns with existing in-code terminology.
- Suggested new wire shape with explicit `from: { role, routingKind,
  triggeredBy, name, crew }` and `payload: { replyTo, memberName,
  outboxSeq, outboxId }`.
- Recommended **positive + negative** assertions per producer path in
  the matrix test (assert new shape written, assert old name absent
  from written row).
- No `CLAUDE.md` found in the crews checkout (gitignored sibling does
  not exist).

## Copilot Research

Failed: output was model-self-introspection commentary, not actual
codebase research. Discarded; redundant with the other three sources
anyway.

## Consolidated File List

### Files to modify (crews plugin)

- `D:/ai-developer-toolkit/plugins/crews/hooks/protocol/envelope.js`
  (schema + factories — single edit chokepoint).
- `D:/ai-developer-toolkit/plugins/crews/hooks/stop.js` (producer +
  ack-gate consumer + question-routing consumer).
- `D:/ai-developer-toolkit/plugins/crews/hooks/commands/review-mail.js`
  (rowKind fallback).
- `D:/ai-developer-toolkit/plugins/crews/hooks/protocol/review-required.js`
  (envelope.from.kind consumer).
- `D:/ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json`
  (version bump 2.4.0 → 3.0.0).
- `D:/ai-developer-toolkit/plugins/crews/docs/protocol.md` (canonical
  address table + examples).
- `D:/ai-developer-toolkit/plugins/crews/AGENTS.md` (agent-facing notes).
- `D:/ai-developer-toolkit/plugins/crews/CHANGELOG.md` (new v3.0.0 entry
  with BREAKING markers).
- `D:/ai-developer-toolkit/plugins/crews/PLAN-1.0-crews.md` (only if
  outdated reference would mislead — verify during implementation).

### Files to modify (marketplace)

- `D:/ai-developer-toolkit/.claude-plugin/marketplace.json` (crews-plugin
  version bump).

### Files to modify (crews tests, 26 files)

- `tests/protocol-envelope-enforcement.test.js` (load-bearing matrix test —
  add negative assertions).
- `tests/protocol-envelope-canonical.test.js`
- `tests/protocol-envelope-roundtrip.test.js`
- `tests/force-response-exempt-kinds.test.js`
- `tests/fanout.test.js`
- `tests/join-crew-notify-leads.test.js`
- `tests/leave-crew-notify-lead.test.js`
- `tests/pretooluse-ask-user-question.test.js`
- `tests/proactive-report-notify.test.js`
- `tests/spawn-prompt-notify.test.js`
- `tests/stop-member-cli.test.js`
- `tests/stop-member-hard-terminate.test.js`
- `tests/stop-member-reason.test.js`
- `tests/stop-member-wake.test.js`
- `tests/stop-member.test.js`
- `tests/system-mailbox.test.js`
- `tests/v1_3_6-lossless-bodies.test.js`
- `tests/member-reply-notify.test.js`
- `tests/auto-derive-replyTo-same-turn.test.js`
- `tests/integration/member-question-to-lead.test.js`
- `tests/integration/review-flow.test.js`
- `tests/integration/send-receive-reply-cycle.test.js`
- `tests/integration/spawn-prompt-notify.test.js`
- `tests/integration/leave-crew-notify-lead.test.js`
- `tests/integration/cli-spawn-proactive-report.test.js`
- `tests/integration/locator-worktree-cwd-drift.test.js`
- `tests/integration/proactive-report-progress-tail.test.js`

### Files NOT to modify (historical artifacts, dated context)

- `D:/harness-efforts/codexu/.ralph/jobs/crews-protocol-envelope-canonical-fields/*`
- `D:/harness-efforts/codexu/.ralph/jobs/crews-envelope-summary-canonical-cleanup/*`
- `D:/harness-efforts/codexu/.ralph-overview/data.json` (task-text reference)
- `D:/harness-efforts/codexu/.ralph-overview/generated/snapshot.json`
  (regenerated automatically from data.json)
