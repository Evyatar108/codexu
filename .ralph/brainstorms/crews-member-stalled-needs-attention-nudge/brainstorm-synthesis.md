Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode — all three lenses produced usable, repo-grounded output; codex did NOT hang this run, the v5.54.0 fd-backed capture fix held).

# Brainstorm synthesis — member-needs-attention: detect a STALLED crews member and nudge

**Task:** `crews-member-stalled-needs-attention-nudge` (crews plugin, `ai-developer-toolkit` submodule). This is the **deferred stalled/idle half** of `crews-member-crash-auto-notify-lead`. That sibling task shipped hard-dead-only (operator-scoped to high-confidence `dead`) and explicitly punted the 9h-dark stalled case to *this* task, even pre-sketching its shape ("a different event `member-needs-attention`/`member-stalled`, longer threshold, explicit healthy-idle carve-out, weaker default action — a gentle auto-nudge, not a crash page").

## The gap (confirmed against source)

`getMemberHealth` (`hooks/health.js`) classifies the stall state — `pidAlive===true` + heartbeat **fresh** (the ~10s listener heartbeat keeps ticking) + `lastTurnAt` **frozen** past a long threshold — as `alive`/`quiet`, **not** `dead`. The crash-notify sweep fires only on `dead`, so it structurally never sees a stall. The motivating incident (2026-06-07): an impl-adapter member went ~9h dark in exactly this state; ended a turn on a `progress` checkpoint, then idled, never took another turn. A manual lead nudge (appending a poke to the member mailbox to wake its armed listener) revived it.

## ⚠️ The cross-lens consensus that reshapes the seed's carve-out

All three lenses **independently converge** on one non-obvious point: **stale `lastTurnAt` alone is not actionable; the high-precision stall signature is `lastKind==='progress'` + old `lastTurnAt`** (AND `pidAlive` AND fresh heartbeat AND `listenerState==='armed'` AND `queuedMailboxCount===0` AND `unreviewedReviewRequired===0` AND no active non-listener background subprocess where observable).

This **INVERTS** the naive carve-out in the seed (`... AND lastKind!=='progress'`). The seed treated `progress` as something to exclude; the lenses agree it is the **discriminator that identifies the stall**:

- A member that ended on `done` is healthy-complete (idle waiting for the next assignment).
- A member that ended on `question`/`blocked`, or has consumed mail awaiting a reply, is **legitimately waiting on the lead** — not stalled.
- The motivating incident ended **on `progress`** — it claimed ongoing work and then never continued. That semantic contradiction (claimed continuing work + parked on an armed listener + no bg work + no pending lead response) is the actual signal.

**Source caveat both codex and devils-advocate caught (verified):** `getMemberHealth` today returns `lastTurnAt` (`hooks/health.js:90`) but does **NOT** return `lastKind`/`lastSeq`. So the detector must either extend `getMemberHealth` to surface `lastKind`/`lastSeq`/`lastObservedAssistantMessageId`, or read the member manifest directly. This is a concrete, small prerequisite, not a blocker.

## Candidate directions (the RESPONSE — the primary product choice)

### D-001: Lead-only stalled-progress notification (RECOMMENDED v1 core)
- Contributing lenses: [codex, copilot, devils-advocate]
- **What:** Ride the crash-notify sweep substrate (throttled heartbeat-tick monitor in the lead listener + lead turn-boundary sweep). On a member matching the high-precision progress-stall signature past a long, configurable threshold, append a **new `member-needs-attention` system envelope** to the **lead's** mailbox (via `appendSystemMailbox`, modeled on `member-left`). The lead — a human or an autonomous bookkeeper on its own armed listener — wakes, glances, and **decides** whether to nudge/investigate. No automatic action on the member.
- **Why this might work:** Lowest blast radius. A **false** stall notification is cheap (the lead ignores it); a false *auto-nudge* (D-002) interrupts a healthy member and burns a paid turn. Matches the operator's demonstrated conservatism (crash-notify shipped hard-dead-only specifically to avoid false alarms). Reuses the trusted mailbox/review channel end-to-end. The manual lead nudge that revived impl-adapter already proves the human-in-the-loop recovery path works.
- **Risks / friction:** Still a *suspicion* signal — if it fires on healthy-idle members it becomes another noisy review-required stream and the lead trains to ignore it (alert fatigue), losing the one real stall. Mitigated by the strict signature + default-off + the mandatory dry-run gate (below).
- **Cheapest validation:** A `--dry-run`/log-only diagnostic command that lists members matching the predicate over current `.crews` manifests + `crews.log` history; manually label each as genuinely-stalled vs healthy. Ship notifications only after dry-run shows the signature is rare in healthy sessions.
- **Disconfirming observation:** If dry-run finds many healthy members with `lastKind==='progress'` + old `lastTurnAt` + empty mail, the predicate is too noisy even for a notification — keep it default-off / operator-command-only.

### D-002: Escalating nudge-then-notify (auto-nudge first, escalate to lead if still frozen)
- Contributing lenses: [codex, copilot, devils-advocate]
- **What:** On the same signature, first append a **gentle poke envelope to the member's OWN mailbox** to wake its armed listener (exactly the manual nudge that revived impl-adapter). If `lastTurnAt` has not advanced after a **second** threshold, escalate to a `member-needs-attention` lead notification. One automatic poke per frozen turn — never repeated.
- **Why this might work:** Self-heals the common case without lead involvement; near the actual end-state the operator wants (the member resuming).
- **Risks / friction:** (1) **Loop risk** — poke wakes the listener → member emits another `progress` checkpoint → listener re-arms → detector pokes again. The latch MUST key on `lastTurnAt`/`lastSeq` so a poke that produced *only another progress checkpoint with no real advance* does not re-fire indefinitely. (2) A false poke wakes a healthy parked member into a paid no-op turn ("I'm waiting on you"). (3) The poke text must be carefully worded so the model wakes and re-checks its own state **without** misreading it as substantive lead instructions or starting unrelated work.
- **Cheapest validation:** Prototype the poke as an explicit **manual** `nudge-member` command first; measure whether stalled members resume and whether healthy armed-idle members take needless turns when poked. Only then automate.
- **Disconfirming observation:** If one gentle poke doesn't produce a new `lastTurnAt` in a short window, a second won't either (escalate to lead instead). If pokes commonly revive members that ended on `done`/`question`, the classifier is wrong (it's reviving healthy waits).

### D-003: Prevent the ambiguous progress-idle state at the source / explicit progress-state contract
- Contributing lenses: [copilot, devils-advocate]
- **What:** A reframe — fix the root cause rather than detect it hours later. Two flavors: (a) **Stop-time discipline** — strengthen the progress-without-bg gate so a member may end a turn `progress` only with provable active background work or an explicit engine-supported wait primitive; otherwise it must report `question`/`done`/`blocked`. (b) **Richer manifest contract** — a new explicit field (e.g. `expectedNextActor` / `progressDisposition`) written by Stop/turn-observability that distinguishes `progress-awaiting-tool` vs `progress-awaiting-lead` vs `progress-continuing`, so "is this a stall?" is a lookup, not a guess.
- **Why this might work:** Removes the ambiguity instead of pattern-matching it. Copilot already encodes flavor (a) for itself via `detect-active-bg.js` (the v3.1.0 progress-bg gate).
- **Risks / friction:** **Cross-engine parity is the blocker** — `detect-active-bg` is Copilot-only/transcript-dependent; faking parity for Claude/Codex either blocks legitimate long synchronous tool calls (fail-closed strands members) or fails open (doesn't prevent the ambiguity). Richer-contract flavor is a slower protocol rollout; older sessions won't emit it. Bigger lift than D-001/D-002.
- **Cheapest validation:** Instrument Stop-time outcomes — log every turn that writes `lastKind==='progress'` with `listenerState==='armed'` and `nonListenerCount===0/unknown`. If most suspicious cases come from one engine or one Ralph prompt pattern, fix that prompt/gate first.
- **Disconfirming observation:** If the stalled member actually *did* have real active work the detector couldn't see, the problem is missing bg observability, not attention nudging — a nudge would paper over a telemetry gap.

> **Layered reading:** D-001 is the safe v1 core (visibility before interruption). D-002 is the higher-automation phase-2 once the signature is proven low-false-positive. D-003 is the deeper, more durable fix that removes the ambiguity D-001/D-002 must pattern-match — worth filing as a parallel/longer-horizon track, especially the cross-engine active-bg observability gap it exposes.

## Cross-cutting decisions (apply to whichever response is chosen)

1. **Default-OFF (all three lenses).** The false-positive symmetry (healthy-armed-idle ≈ stall) plus operator conservatism makes default-on unsafe. Gate via env var and/or crew setting; decide which.
2. **Dry-run / log-only FIRST, before wiring any `appendSystemMailbox` writes (all three lenses).** Plus a **replay of the 2026-06-07 incident** from saved manifest/log rows to prove the predicate fires **exactly once** there, and does **not** classify hard-dead as stalled nor healthy-idle as stalled. This is the single highest-value validation step and should be an explicit acceptance criterion.
3. **Three-valued active-bg signal (`yes`/`no`/`unknown`), not boolean.** `detect-active-bg.js` is Copilot-only and transcript-path dependent. For Claude/Codex, active-bg is `unknown` → choose **notify-only** with a **longer** threshold; never **auto-nudge** on `unknown`. `unknown` must be a first-class state so the engine-agnostic sweep doesn't silently bias.
4. **New `member-needs-attention` ENVELOPE kind** (distinct from a turn-tag report kind — `kindEnum` in `hooks/protocol/envelope.js:63-88` vs the report `VALID_KINDS`). Modeled on `member-left`: add to `kindEnum`; add to `DEFAULT_REVIEW_KINDS` (`hooks/protocol/review-required.js:1-12`) so it surfaces in `/crews-review-mail` and bumps `lastReviewRequiredSeq`; add to the strict-ack auto-exempt set (`hooks/stop.js` `ACK_EXEMPT_KINDS`) so it's notification-only (no ack chore) — i.e. **review-required AND strict-ack-exempt**. Add a `PAYLOAD_RULES` entry if it carries required fields. If D-002 ships, consider whether the member-mailbox poke is a *separate* envelope kind from the lead notification.
5. **Generation-scoped dedupe latch (reuse crash-notify's design), keyed to include the frozen turn.** Candidate key: `{ memberName, crew, sessionId/takeoverAt, lastTurnAt, lastSeq/lastObservedAssistantMessageId, reason }`. It MUST reset when `lastTurnAt` advances (so a member that resumes and later re-stalls re-fires), and via `repairManifestForResume` (`hooks/commands/resume-crew.js`) + `clear-member` cleanup — but NOT on every heartbeat. A bare boolean either over-dedupes across resumes or under-dedupes across an unchanged frozen turn.
6. **Reuse the crash-notify sweep substrate — do NOT reinvent the periodic hook.** The throttled heartbeat-tick monitor in the lead listener (`lib/listener-loop.js` heartbeat `setInterval`, the only periodic hook while a lead idles on an indefinitely-armed `timeoutMs===null` listener) + the lead turn-boundary sweep are the shared base. The stall classifier + response is a *consumer* of that substrate. Sweeps must stay throttled + best-effort so heartbeat writes / mail delivery are never delayed.

## Dependency & sequencing note

This feature **depends on** `crews-member-crash-auto-notify-lead` landing first (or a co-design of the shared sweep/latch/envelope plumbing). If crash-notify is not yet merged, planning should either sequence behind it or scope the shared substrate into this task. The stall classifier reuses: the sweep home, the latch pattern, the `appendSystemMailbox` delivery seam, and the `member-left`-style envelope semantics.

## Recommendation

**D-001 (lead-only stalled-progress notification)** as the v1 core — default-OFF, gated on the high-precision `lastKind==='progress'` + frozen-`lastTurnAt` signature with the full healthy-idle carve-out, and **gated behind a MANDATORY dry-run validation** (incl. the 2026-06-07 incident replay) before any live `appendSystemMailbox` write. It is the only option all three lenses endorse as safe-to-ship-first, it has the smallest blast radius, and a false positive is cheap. **D-002 (escalating auto-nudge)** is the natural phase-2 once dry-run proves the signature is low-false-positive — start its nudge as a manual command. **D-003 (prevent-at-source / explicit progress contract)** is the deeper fix worth a parallel track, primarily to close the cross-engine active-bg observability gap.

## Open questions to carry into planning

1. **`lastKind==='progress'` as the primary stall signature** — confirmed by all three lenses — or one weighted signal among several? (Dry-run answers this.)
2. What **threshold** would have caught the 9-hour incident without flagging ordinary long-running implementation sessions? Single threshold, or per-engine (longer for `unknown`-active-bg engines)?
3. **Active-bg as three-valued (`yes`/`no`/`unknown`)** — is "no active bg" a hard requirement for *any* action, or only for auto-nudge, while a lead *notification* can tolerate `unknown`?
4. **Response choice:** lead-notify-only (D-001), escalating auto-nudge (D-002), or both — and is any automatic member-mailbox poke acceptable, or must every intervention be lead-confirmed?
5. **Envelope semantics:** one `member-needs-attention` kind (review-required + strict-ack-exempt, like `member-left`), or two kinds (lead notification vs member-mailbox poke)? Exact `kindEnum` + `DEFAULT_REVIEW_KINDS` + `ACK_EXEMPT_KINDS` decisions.
6. **Latch generation key + reset wiring** — exact key, and reset on `lastTurnAt` advance + `repairManifestForResume` + `clear-member` (not on heartbeat).
7. **Prerequisite:** extend `getMemberHealth` to surface `lastKind`/`lastSeq`/`lastObservedAssistantMessageId`, or read the manifest directly in the sweeper? (`getMemberHealth` returns `lastTurnAt` but not `lastKind` today.)
8. **Default-off mechanism:** env var only, crew setting, or both? And the dry-run/replay acceptance criterion: prove the predicate fires exactly once on the 2026-06-07 incident and zero times on healthy-idle / hard-dead.
9. **Poke text (if D-002):** exact member-mailbox envelope wording that wakes the armed listener and makes the model re-check its own state **without** misreading it as substantive lead instructions or starting unrelated work.
10. **Sequencing vs crash-notify:** land behind `crews-member-crash-auto-notify-lead`, or fold the shared sweep/latch/envelope substrate into this task?
