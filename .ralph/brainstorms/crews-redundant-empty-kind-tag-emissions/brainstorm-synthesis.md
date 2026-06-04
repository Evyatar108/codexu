Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

# Brainstorm Synthesis — eliminate redundant / empty-body `kind=done` and `kind=progress` envelopes from crews members

## Cross-lens framing

All three lenses converge on the same first-line judgment: the durable per-row outbox audit log is **NOT** the right surface to silently suppress; the lead-side review/display surface is. Codex and Copilot both recommend exact-duplicate collapse in `review-mail` as the first v1.x (deployed: v3.x) ship; Devil's Advocate accepts that displacement is safer than source-side censorship but raises a separate red flag — the brainstorm's pre-survey labelled candidates as "v1.x" while the installed crews is v3.x, and several pre-survey assumptions (fs.watch filtering, member system.notification exemption, body-canonical block, terminal-only proactive batching) are already implemented. The lenses also agree that v2 Option D (side-channel listener queue, per `crews/docs/architecture-refactor.md` Cause 5 + line 450 anti-refactor note) stays on the 2.0 roadmap — D-001 reduces lead noise but does not eliminate "listener-exit-as-wakeup → forced model turn → forced kind tag."

Devil's Advocate also corrected a key pre-survey error: `lib/listener-loop.js:213-216` already filters fs.watch events by inbox basename, and `deliver()` at lines 159-180 only exits on real messages — so candidate "listener wake-up filter" (orchestrator pre-survey #3) is mostly already implemented and is NOT a real v1.x candidate. That removed candidate space converged the lenses on the lead-side-display vs source-side-suppression vs telemetry-first axis.

## Ground-truth evidence (codex lens, in-repo sample)

Codex sampled the local ralph-pipeline `.crews/` state:
- 1086 outbox rows total
- 47 exact consecutive same-kind duplicates
- 245 stub-like rows by heuristic
- Confirmed the named member (`impl-worktree-conditional-narrow`) had seq 1 / seq 2 with identical body/summary/writtenAt — a verbatim duplicate `kind=done`, exactly matching the symptom in the brainstorm context.

This already partially answers Devil's Advocate's "instrument first" request: the dominant noise pattern IS exact-duplicate consecutive terminal rows. Near-similarity dedup is not needed for the first ship.

## Candidate directions

### D-001: Lead-side `review-mail` exact-duplicate collapse (recommended)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: leaves outbox.jsonl and mailbox-history.jsonl append-only (audit preserved); cursor advances past all collapsed rows as if individually reviewed; collapse keys on the narrowest safe tuple `(sender, kind, normalized body hash, summary)`; rows with any differing replyTo/acks/decisions are NEVER collapsed; collapsed group exposes `count`, seq range, and individual envelope ids in JSON output so operators can drill in. Per-collapse stderr warning + per-collapse `crews.log` entry give the telemetry Devil's Advocate asked for as a free byproduct.
- Risks / friction: pure display dedup is cosmetic if each duplicate already woke the lead's listener with a separate proactive notification; body-resolution fallback in `review-mail.js:99-118` can make distinct rows look identical (need to dedup on the actual delivered body, not the resolved-from-id fallback). Operators may stop inspecting expanded groups if collapse counts grow.
- Cheapest validation: run an offline collapse pass over the existing local outbox.jsonl/mailbox-history.jsonl samples; produce a raw-vs-collapsed diff report; verify zero rows with differing replyTo/acks/decisions get coalesced.
- Disconfirming observation: if expanded review-mail rows show most noise is direct, ack-sensitive mail rather than system-routed proactive-report/member-reply rows with duplicate `(memberName, outboxSeq, body-hash)` triples, display collapse has little UX impact.

### D-002: Telemetry-first causal split (instrument before further mitigation)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: classifies each noisy row by mechanism — same assistant turn with multiple report tags, multiple Stop retries, listener `error`/`timeout`/`arm-skipped`, system.notification ack, proactive terminal batch expansion, real lead reply. Listener exit types are already explicit in `listener-loop.js:140-179, 183-194`; Stop writes one v2 outbox row per kind-bearing report tag at `stop.js:1251-1306`; proactive notification packages unread terminal rows into `payload.entries` at `stop.js:1379-1418`. Body-hash + turn-boundary + retry + listener-exit logging is a small surface and clarifies whether further mitigations beyond D-001 are needed.
- Risks / friction: not a UX fix by itself; if shipped solo, operator still sees the noise. Best bundled into D-001's telemetry so it pays for itself.
- Cheapest validation: correlate `listener delivered/timeout/error/arm-skipped` log lines with member outbox seq deltas for the two observed cases and one fresh repro session.
- Disconfirming observation: if codex's already-sampled evidence (47 exact consecutive duplicates / 1086 rows) is sufficient to characterize the dominant pattern, further pre-ship instrumentation is overkill — fold the minimal-telemetry bits into D-001's per-collapse logging and ship.

### D-003: Source-side Stop-hook exact-duplicate suppression
- Contributing lenses: [codex, copilot]
- Why this might work: prevents the duplicate envelope from ever entering the outbox/mailbox-history, so lead-side noise reduction is structural (not display-only); narrowest possible scope is "exact duplicate `kind=done|progress` with same sender, body hash, summary, and zero replyTo/acks/decisions, vs the most recent prior report in the same actor's outbox."
- Risks / friction: re-introduces the silent-censor failure mode that the v1.4.x crews team explicitly fixed; can corrupt cursor/audit expectations if `lastSeq` is skipped; risk of swallowing intentional retries after a delivery failure; both lenses recommending it pair it with a stderr warning + `CREWS_DEDUP_KIND_EMITS=off` env switch + `crews.log` telemetry per suppression.
- Cheapest validation: ship it dry-run / log-only first (Copilot D-002 cheapest_validation suggestion) — Stop hook detects the suppress-able pattern and logs "would suppress" without actually skipping the outbox write. Measure over several real sessions; only flip to live suppression after the dry-run confirms zero false positives.
- Disconfirming observation: if duplicate rows often carry distinct replyTo/acks/decisions, or if repeated identical terminal reports are intentional retries after delivery failures, source suppression is unsafe.

### D-004: First-class no-op / terminal-finality kind (defer until D-001 lands)
- Contributing lenses: [devils-advocate]
- Why this might work: addresses the root design smell — the kind-bearing outbox row is overloaded as Stop-hook liveness proof + durable audit + lead notification. Either extend the existing v3.2 member `system.notification` no-kind exemption (`stop.js:939-958`) to also cover "no inbox delta since last turn + lastKind=done" idle wake-ups, OR introduce a new explicit `noop` / `ack` kind that doesn't trigger outbox write, doesn't wake leads, but satisfies the Stop hook's "every turn must end with a tag" contract.
- Risks / friction: highest risk of breaking the kind-tag invariant that proactive-routing (v1.2.11+) and circuit-breaker logic depend on; if the no-op detector runs before strict-ack resolution it lets members ignore consumed lead mail; if it keys only on boundary type it can suppress a genuine answer interleaved after a system.notification (the exact caveat documented in `stop.js:947-950`); a new `noop` kind adds schema + prompt surface and may teach models to under-report real progress.
- Cheapest validation: study D-001's per-collapse telemetry for ~2 weeks of sessions; if a clear "lastKind=done + zero inbox delta + zero strict-ack-pending" pattern dominates the surviving noise, D-004's no-op exemption is well-scoped; otherwise the noise is not from this pattern and D-004 is the wrong tool.
- Disconfirming observation: if observed noisy rows after D-001 lands all contain substantive bodies or actionable replyTo/ack metadata, treating them as no-op is wrong; the fix belongs in lead display or in terminal-state workflow, not member exemption.

## Verdict on v2 Option D (side-channel listener queue)

All three lenses agree v2 Option D stays on the 2.0 roadmap. D-001 + telemetry-rich logging eliminate the lead-side review pain, but they do NOT eliminate:
- model-operated re-arm turns (Devil's Advocate)
- listener-exit-as-wakeup forcing a model turn that forces a kind tag (orchestrator)
- duplicate report tags emitted within a single model turn (Devil's Advocate: "Option D would not by itself prevent a model from emitting duplicate done tags")

So D-001 is independent of the v2 roadmap; it reduces a different problem (lead's review surface) without precluding or replacing the v2 architectural rework.

## Open questions for the planning phase

- Should D-001 collapse be exact `(sender, kind, normalized body+summary+replyTo+ackSet hash)` only — refusing any near-similarity match in v1.x for safety?
- Should collapsed rows expose `collapsedCount`, `collapsedSeqs`, and `collapsedIds` in the review-mail JSON output, accepting a documented output shape change?
- Is it acceptable that `outbox.jsonl` and `mailbox-history.jsonl` keep the duplicate audit rows while review-mail advances the cursor past all collapsed rows? (Lenses agree: yes — preserves grep-ability and reversibility.)
- Does the collapse pass need to dedup across `payload.entries` batches in proactive-routing notifications (`stop.js:1379-1418`) as well, or only at the leaf row level in `review-mail.js`? (Devil's Advocate flag.)
- For each duplicate observed in the original cases, was it (a) one assistant turn with multiple report tags, (b) multiple assistant turns, (c) a Stop retry, or (d) review-mail expansion of one `payload.entries` batch? — D-002 telemetry will answer; D-001 collapse rules must remain safe under all four.
- Should `kind=done` be modeled as a terminal state transition after which idle member turns are no-op until new lead mail (D-004's framing), or as a repeatable per-turn report? — defer until D-001 ships and the residual noise is quantified.
- Which exact crews versions produced the original Case A (codexu v5.50 impl member) and Case B (seval-540475 summarizer-behavior member)? Do they include `stop.js:939-958` and the terminal-only proactive batching path? — version capture is mandatory for the plan-phase, since pre-survey's "v1.x" framing is anachronistic.
