Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (all three lenses produced usable output; copilot was re-run from the crews plugin dir after a read-only snapshot-budget failure at the codexu root caused by `.xwin-cache`).

# Brainstorm synthesis — crews-read-member-outbox-view

## Premise correction (the load-bearing finding — all three lenses + direct source agree)

The task was filed with a "VERIFIED CURRENT STATE" claim that the existing
`read-member <name>` command reads the member's **INBOX/mailbox-history** (what it
RECEIVED from the lead), and therefore "there is no command for the outbox/sent
direction." **This is false.** `read-member` ALREADY reads the member's **OUTBOX**
(its SENT reports). Verified independently by all three lenses against source:

- `ai-developer-toolkit/plugins/crews/hooks/commands/read-member.js:92` — handler does `const envelopes = readOutbox(name, crew, stateCwd);`
- `ai-developer-toolkit/plugins/crews/hooks/mailbox.js:821-824` — `readOutbox` reads `getOutboxPath(...)` via `readJsonLinesStrict`.
- `ai-developer-toolkit/plugins/crews/hooks/paths.js:215-218` — `getOutboxPath` → `<actorDir>/outbox.jsonl`; `getInboxHistoryPath` (paths.js:220-223) → `mailbox-history.jsonl` (a DIFFERENT file read by `review-mail`, NOT by `read-member`).
- `ai-developer-toolkit/plugins/crews/hooks/mailbox.js:975-986` — `formatOutboxEntries` renders `seq · writtenAt · kind=<k> · summary="..."` + body (used by `--pretty` and the slash surface).
- Registry description (`read-member.js:139`): "Lead-only command to pull new outbox envelopes from one member and advance the cursor."
- `review-mail`, NOT `read-member`, reads the inbox history (`review-mail.js:306-310`).

So `read-member <name> --all --pretty` (or `--peek --pretty`) ALREADY views a
member's sent reports — including all four kinds — in human-readable form. The
four modes (read-member.js:95-121): default advances a per-crew cursor to the max
fresh seq (incremental review); `--peek` does not advance; `--all` shows everything;
`--since N` from baseline N; `--pretty` switches CLI from JSON to `formatOutboxEntries`.
`read-member` is LEAD-ONLY by design (crews has no peer-to-peer; members coordinate
via the lead; `send-to-peer` was removed in v1.3.10).

## So what is the REAL problem? Discoverability + progress-noise filtering.

1. **Discoverability / naming.** "read-member" reads as "read what the member
   RECEIVED." An experienced operator literally misfiled this task believing it
   reads the inbox. The help/description use the word "outbox envelopes" — jargon,
   not "the reports this member SENT."
2. **No kind filtering.** crews v2 writes one outbox row per kind-bearing report
   tag, and `progress` is high-volume. A **live member outbox was 989,598 bytes
   containing 147 `progress` rows and exactly 1 `done` row** (devils-advocate lens,
   verified on disk). Viewing only `done`/`question`/`blocked` is the actual
   ergonomic need; there is no `--kind`/`--no-progress` filter today
   (read-member.js:15-18, :41-74).
3. **Minor:** the default cursor-advance is a review-flow side effect (ad-hoc
   viewing wants `--peek`/`--all`), and the CLI default is indented JSON (`--pretty`
   is the human form). These are documentation/ergonomics, not missing capability.

## Cross-lens agreement

| Point | codex | copilot | devils-advocate |
|---|---|---|---|
| Premise false (read-member reads outbox) | ✔ | ✔ | ✔ |
| `red_flag` | true | true | true |
| Recommend: evolve read-member (filters + wording), NOT a new data path | ✔ | ✔ | ✔ |
| Reject `--sent`/`--output` mode (entrenches the false premise) | ✔ | ✔ | ✔ |
| Filtering is DISPLAY-ONLY; cursor advances over the unfiltered fresh set | ✔ | ✔ | ✔ |
| Member outbox is the authoritative source (don't merge mailbox-history for v1) | ✔ | ✔ | ✔ |
| `--kind` value-flag needs the parseSlash value-index guard like `--since` | ✔ | — | (implied) |

---

### D-001: Evolve `read-member` — display-only kind filters + explicit "sent-report" wording + clarifying alias  **(RECOMMENDED)**
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: It fixes the *actual* operator pain (discoverability + progress noise) on the surface that already exists, with zero new state semantics, preserving lead-only review flow, cursor semantics, and slash/CLI parity. Concretely:
  - Add `--kind <k[,k...]>` (accepts `progress|done|question|blocked`) and `--no-progress` as **display-only** filters. Compute `freshAll` from the existing baseline rules; render only the kind-matching rows; on a default (non-`--peek`/`--all`/`--since`) read, **advance the per-crew cursor to `max(freshAll.seq)`, NOT `max(displayedRows.seq)`** so filtered-out progress rows never resurface. This mirrors the `review-mail` display-only collapse precedent (collapse at `review-mail.js:312-318`; cursor advances from `allRows` at `review-mail.js:348-352`).
  - Rewrite usage/description/generated SKILL.md/AGENTS wording to say "the reports this member **SENT** / member **output** / `outbox.jsonl`," with examples `read-member alice --no-progress --pretty` and `/crews:read-member alice --kind done,question,blocked`.
  - Add a clarifying registry alias (e.g. `read-member-reports`) so the name itself signals intent. Registry aliases dispatch to the same loader (`registry.js:65-75`) and slash matching checks `command.aliases` (`runtime.js:14-17`).
- Risks / friction:
  - **Alias may be invisible in CLI top-level help:** `tools/crews.js` lists only `command.name` values (`crews.js:11-15`), so `read-member-reports` won't appear in the subcommand list unless help generation is enhanced. (This is the main reason D-002 exists.)
  - **`--kind` parseSlash guard:** any new value-flag must skip its value when finding the positional member name, exactly as `--since` already does (read-member.js:23-37; fix commit `479be1b2`). Missing this re-introduces "flag value mistaken for member name."
  - **Footgun (from devils-advocate + codex):** when a filter hides ALL fresh rows while the cursor still advances, the response MUST disclose that rows were hidden (e.g. a `hiddenByFilter` count / "no matching envelopes; cursor advanced to seq N") so the operator isn't misled into thinking nothing was sent.
  - **Do not break the default CLI JSON-array shape** for unfiltered calls (scripts may depend on it); add filter fields additively.
- Cheapest validation: unit tests on the existing `read-member` test surface (see test plan) seeding mixed-kind outbox rows; assert `--no-progress`/`--kind` show only matching rows in both JSON and `--pretty`, and a cursor-regression test that a default `--no-progress` read advances past hidden progress rows so a later default read doesn't resurface them.
- Disconfirming observation: if operators actually want "what reached the LEAD and when it was reviewed/acked" (delivery/consume timestamps), outbox filtering is insufficient — that's a joined forensic view (see D-003), not a member-outbox filter.

### D-002: First-class `read-member-reports` command as a thin delegating wrapper  **(discoverability fallback / alternative to the D-001 alias)**
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Maximizes discoverability — a real registered command appears in `tools/crews.js` top-level help/autocomplete AND generates its own SKILL.md (Claude colon + Copilot/Codex kebab), so a user who never knew `read-member` exists can find it. It would carry the same `--kind`/`--no-progress` filters from D-001.
- Risks / friction: Adds a 12th command surface, more parity tests, and a real drift risk: `read-member` and `read-member-reports` MUST share one handler/parser/formatter (delegate, don't fork a second outbox reader) or their cursor/auth semantics will diverge.
- Cheapest validation: registry/dispatcher tests that the new command name reaches the shared handler; generated-skill presence check after `scripts/gen-skills.js`.
- Disconfirming observation: if the D-001 alias + improved wording already make the existing command discoverable enough in practice, this is pure added surface for no new capability.
- Relationship to D-001: This is a *discoverability dial*, not a competing design. Ship D-001's filters regardless; choose between "alias (cheap, may be invisible in CLI help)" and "first-class command (more surface, fully discoverable)" based on whether Copilot/Codex slash UX + CLI help actually surface aliases.

### D-003: Optional forensic delivery-context view (join member outbox + lead mailbox-history)  **(deferred — only if the real goal is delivery/review timestamps)**
- Contributing lenses: [codex, devils-advocate]
- Why this might work: If the operator's true unmet need is "what did member X send, *and did it reach the lead, when was it reviewed/acked*," the member outbox alone lacks delivery/consume metadata. The lead's `mailbox-history.jsonl` carries `consumedAt`/`inboxSeq` and the proactive-report payload back-references (`outboxId`/`outboxSeq`/`reportId`), so a join could annotate each sent report with delivery/review status.
- Risks / friction: Progress-only rows may have NO corresponding lead mailbox-history row (only terminal/proactive kinds route to the lead), so the join is partial. **Do not join by `seq` alone — inbox seq and outbox seq are different numberings.** Significantly more surface than D-001.
- Cheapest validation: confirm with the operator whether delivery/review timestamps are actually wanted before building anything; if not, skip.
- Disconfirming observation: the operator's stated ask ("view what a member SENT, vs the lead's aggregated history") points AWAY from a lead-history join — they want the per-member sent log, which is exactly the member outbox.

---

### Explicitly rejected (consensus across all three lenses)
- **Add a `--sent`/`--output` MODE to `read-member`.** read-member's DEFAULT is ALREADY the sent/outbox direction; a `--sent` flag implies the default reads something else (the inbox), which actively ENTRENCHES the very misconception that caused this task to be misfiled. If a self-documenting token is ever wanted, at most make `--sent` a no-op alias whose help says "implied; read-member always reads sent reports" — but clearer naming + filters (D-001) is strictly better.
- **Docs-only / skill-only ergonomics with no filter.** Too weak: the progress-noise problem (147:1 progress:done) remains; the operator still has to scan or hand-filter JSONL.

## Recommended direction
**D-001** — Evolve `read-member` with display-only `--kind`/`--no-progress` filters
(cursor advances over the unfiltered fresh set; disclose hidden-by-filter), explicit
"sent-report / member output / outbox" wording across description + usage + generated
SKILL.md + AGENTS.md, and a clarifying alias (`read-member-reports`). Treat D-002
(first-class command) as the discoverability dial to turn up only if the alias proves
invisible in Copilot/Codex slash UX or CLI help; treat D-003 (forensic join) as a
separate, deferred follow-up gated on the operator actually wanting delivery/review
timestamps.

## Implementation surface (for the planner)
- Edit sites: `read-member.js` (parseSlash value-index guard for `--kind`; parseCli flags; handler display-filter after `fresh`/cursor computation; description/usage; module-level `roleVisibility`/auth unchanged), `registry.js:10` (alias array, currently `[]`), `scripts/gen-skills.js` (regenerate both Claude + Copilot SKILL.md).
- Filtering is DISPLAY-ONLY; cursor math stays on `freshAll` (read-member.js:95-104). Precedent: review-mail collapse (`review-mail.js:312-318`, `:348-352`).
- Tests via `plugins/crews/tests/run.js` (one worker per file; scrubs inherited `CREWS_*` + session env). Extend `tests/command-compat-read-member.test.js` (mixed-kind outbox rows; `--kind`/`--no-progress` in JSON + `--pretty`; cursor-advances-past-hidden-progress regression), `tests/command-args-parity.test.js` (new flags + unknown-flag rejection), plus slash-parser cases (`/read-member --kind question alice`, `/read-member alice --kind question`, missing `--kind` value, `--since 5 --kind done alice`) and an alias registry/dispatcher test if D-002's alias is adopted.

## Open questions for planning / operator
1. **Alias vs first-class command (the main decision):** is a clarifying alias enough, or is a registered `read-member-reports` command required so it surfaces in `tools/crews.js` help + generates its own Copilot/Codex skill? (`tools/crews.js:11-15` lists names, not aliases.)
2. Should docs steer operators to `--all --pretty` or `--peek --pretty` as the default "show me what this member sent" invocation?
3. Should `--kind` accept comma-separated multi-kind values, or stay repeatable/single? (slash parsing simplicity.)
4. Should `--no-progress` mean exactly `kind !== 'progress'`, or also suppress missing/legacy-kind rows?
5. Are member `writtenAt` + member seq sufficient for v1, or do operators need delivery/consume timestamps (→ D-003)?
