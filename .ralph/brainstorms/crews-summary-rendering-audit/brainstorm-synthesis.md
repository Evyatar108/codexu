Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

## Problem reframe

The brainstorm framing was "audit envelope fields for producer/consumer drift like the v1.7.3 summary bug." All three lenses agree the audit is *useful* but is the *wrong primary deliverable* on its own:

- **codex** grounds the work in existing crews schema machinery (`hooks/protocol/*.js` runtime validation with `CREWS_STRICT_SCHEMA=1`) and points out the plugin is plain CommonJS — TypeScript canonical types are not the cheapest convergence.
- **copilot** ranks audit value by operator-visible surface (review-mail render, list-members, stop-hook gates) rather than by field count; cosmetic drift is lower priority than routing/control drift.
- **devils-advocate** observes the dual-address pattern is **structurally pervasive** (`mailbox.js:466 appendSystemMailbox` writes both top-level and `payload.*`; `stop.js:778-840` explicitly mirrors `summary` and `kind`), but **summary is uniquely susceptible to SILENT drift** because empty-string renders fine; other drifted fields (kind, replyTo, decision) fail LOUDLY via review-gate filter, routing lookup, or stop-hook block. The audit treats fields symmetrically when the silent-vs-loud asymmetry is the real risk dimension.

All three lenses converge on: **a runtime schema contract enforcing canonical-per-field addresses, validated by a single CI round-trip test, leveraging the existing `hooks/protocol/*.js` machinery**, is the durable convergence — not a static one-shot grep catalog.

## Candidate directions

### D-001: Runtime schema contract + CI round-trip test (leveraging existing hooks/protocol/*.js)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: crews already ships `hooks/protocol/*.js` runtime schema validation gated by `CREWS_STRICT_SCHEMA=1`. Extending it to declare canonical addresses (top-level vs `payload.*`) per envelope field, plus one CI round-trip test that asserts every producer→consumer pair preserves each field's canonical address, prevents future drift on *all* fields with one mechanism. Codex anchors it in real existing code paths; copilot adds test-matrix scaffolding; DA frames it as the cheapest forward-compatible fix.
- Risks / friction: contract test fragile if canonical address is undecided (would accept either address, preserving drift). v1.7.3 shipped *both* read-fallback AND write-mirror — locking in "both addresses work forever" is its own clarity regression. Tests at `tests/proactive-report-notify.test.js:58` and `tests/member-reply-notify.test.js:89-91` codify `payload.kind`/`payload.replyToId` as canonical, while v1.7.3 codified top-level `summary` — the contract has to be reconciled per field, not universal.
- Cheapest validation: write the round-trip test for `summary` only first. If <50 LOC and it would have caught the original v1.7.2 bug retroactively, scale to other fields. If >200 LOC, the framing is wrong.
- Disconfirming observation: if `hooks/protocol/*.js` already covers system-mailbox envelope shape with `CREWS_STRICT_SCHEMA=1` and the v1.7.2 bug *wasn't* caught by it, then either the schema is too permissive or strict mode isn't on in CI — in which case schema extension won't help without also fixing the gate.

### D-002: Pick canonical-per-field, delete the mirror, share via envelope module
- Contributing lenses: [copilot, devils-advocate]
- Why this might work: the bug-source is the dual-address pattern itself. Pick ONE canonical address per field — payload-nested for system-mailbox (where tests already assert it for `kind`/`replyTo`), top-level for outbox (where `appendOutbox` naturally puts caller fields) — delete the mirror writes and the v1.7.3 consumer fallback. Centralize via a shared `hooks/protocol/envelope.js` reader/writer. Fewer addresses = no drift surface.
- Risks / friction: regression to silent-empty-summary if any producer is missed. Differing canonical addresses per envelope type (outbox top-level vs system-mailbox payload-nested) is itself confusing. May require rewriting 5-20 test assertions.
- Cheapest validation: one-day spike — pick payload-nested as canonical for system-mailbox, delete top-level mirrors in `stop.js:785/833`, delete fallback in `review-mail.js:111`, run the test suite. <5 broken tests = mechanical; 20+ = pattern too entrenched to remove.
- Disconfirming observation: if any external consumer (remote subscriber, downstream tool) can only see one address post-projection, removing the mirror breaks them silently.

### D-003: Targeted audit ranked by operator-visible failure surface
- Contributing lenses: [codex, copilot]
- Why this might work: the spawn prompt explicitly asks for a catalog deliverable. Performing the grep pass + classifying by visible surface (review-mail render, list-members, briefing, progress tail, stop-hook gate) gives the bookkeeper a prioritized backlog of per-field follow-up tasks without committing to a structural fix yet. Codex enumerates the exact file:line ranges to scan; copilot adds the operator-impact lens.
- Risks / friction: catalog ships and someone adds a new field tomorrow — a static one-time audit doesn't prevent the next drift. If most consumers already normalize via spread/Object.assign, the grep won't be authoritative without AST tracing.
- Cheapest validation: grep all 8 named fields (summary, kind, replyTo, decision, ack, progressTail, reviewedSeq, bodyResolution) and classify only the first 10 mismatches by visible surface. If clustered in 1-2 fields, audit is right; if scattered, contract-first (D-001) is justified.
- Disconfirming observation: if nearly all consumers already normalize payload + top-level fields, or mismatches are confined to debug-only output, the broad audit isn't worth shipping.

### D-004: Central consumer normalizer with field-aware read fallbacks
- Contributing lenses: [codex]
- Why this might work: extend the v1.7.3 `review-mail.js:111` fallback pattern (`row.summary ?? row.payload.summary`) to every consumer of every field that drifts, via a centralized `hooks/protocol/envelope-view.js` reader that handles per-field fallback rules. Lowest disruption to producers; no test churn.
- Risks / friction: blurs important distinctions (codex flags `row.kind` as report kind vs `row.from.kind` as routing kind — these are two semantic fields, not drift). Generic fallback accessor would mask intentional schema differences.
- Cheapest validation: prototype the normalizer for `summary` + `kind` + `replyTo`, convert review-mail and list-members to use it, run the test suite.
- Disconfirming observation: if the audit shows that the dual-address pattern carries *different semantics* on different fields (not just drift), a generic fallback is the wrong tool.

### D-005: Contract-first spec written before any audit
- Contributing lenses: [devils-advocate]
- Why this might work: write a single `docs/envelope-contract.md` (or `hooks/protocol/contracts/envelope.json` schema) declaring the canonical address for every field and a one-line consumer-render rule per field. Then any code reading from the non-canonical address is by definition a bug, audit-or-not. Spec ahead of grep survives future field additions.
- Risks / friction: a contract without consensus produces a paper that ships and is then ignored — same outcome as the catalog. Drifts from code unless CI enforces it (which collapses this into D-001).
- Cheapest validation: spike the contract for 5 fields (summary, kind, replyTo, decision, progressTail) and grep all consumers. If divergences cluster (1-2 fields), audit (D-003) is the right tool; if scattered (every field has 2+ divergent consumers), contract-first is justified.
- Disconfirming observation: if the team can't agree on a canonical address for `summary` (some consumers want it as header, others as payload tied to kind), a single contract is premature.

## Open questions

- Is `hooks/protocol/*.js` schema validation already in CI under `CREWS_STRICT_SCHEMA=1`? If yes, why didn't it catch v1.7.2 summary-drop? If no, enabling it is part of the answer.
- Should canonical address be the SAME across `appendOutbox` and `appendSystemMailbox` (one global rule) or PER-ENVELOPE-TYPE (outbox top-level, system-mailbox payload-nested)?
- Does v1.7.3 keeping BOTH read-fallback AND write-mirror create a third drift source? Should one be reverted in v1.7.4 once the audit picks a winner?
- Are `row.kind` (report kind) and `row.from.kind` (routing kind) two semantically distinct fields, or one drift candidate?
- Should Copilot scope include only `hooks/copilot-*.js` envelopes, or also generated `.copilot-plugin/` skill wrappers?

## Recommendation

**D-001** (Runtime schema contract + CI round-trip test). All three lenses agree on this as the durable convergence. The audit (D-003) is the *immediate* artifact the spawn prompt asks for, but the audit's *recommended approach* row should point to D-001 as the next plan to spawn. D-002 (delete the mirror) is the strongest competitor and should be reconsidered if the audit shows the dual-address pattern is shallow (<5 producer call-sites).
