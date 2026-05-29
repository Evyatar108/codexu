## Direction

D-001 — Formalize a 3-party actor model (operator ↔ lead ↔ member) with `lead` and `operator` as the canonical role terms, an additive envelope-kind family for operator-direct interaction, and a CLI-first direct-channel mechanism (with auto-detect deferred to v1.1). The lead-side surface is the existing `review-mail` inbox (with a visual flag) plus a `lastOperatorDirectAt` column in `list-members`. No new role-aware listener, manifest, or pointer index — operator stays outside the heartbeat model and is captured only as an `operatorId` audit field on envelopes.

## Goal

After this lands, the human operating a crews workspace has a defined, plumbed channel to interact with members directly without out-of-band, untyped prose:

- **Operator → member (direct):** `crews-operator-message <member> [--crew <auto-discover>] <text>` posts a typed `operator-direct` envelope into the member's inbox; the message is replayable, auditable, and lead-visible.
- **Operator → lead (briefing):** `crews-notify-lead --about <member> <summary>` posts an `operator-direct-summary` envelope into the lead's review queue so the lead can catch up on what just happened on the terminal.
- **Lead → operator (escalation):** `/crews-escalate-to-operator <member> --trigger <name>` emits a typed `escalate-to-operator` envelope that surfaces in the operator's CLI inbox AND the member's mailbox, telling both parties "go talk directly." The trigger is drawn from a named enum (`interactive-debug-needed`, `demo-required`, `paused-on-realtime-question`, `transcript-too-large-to-relay`, `tool-prompt-required`).
- **Member → lead (auto-summary):** when a member's turn was started by an `operator-direct` envelope, its next `<|report ...|>` tag MUST carry `operator-direct-summary="<short>"`. Lead's normal `/crews-review-mail` flow picks it up; no separate review category.
- **Lead/operator situational awareness:** `crews-list-members` (and slash equivalent) shows a `lastOperatorDirectAt` column. `review-mail` flags operator-direct entries with a visual prefix (e.g. `[op-direct]`).

The operator is named `operator`, the coordinator stays named `lead`. No rename churn. The plugin's vocabulary becomes: **operator** (the human, no manifest), **lead** (the coordinator agent, has manifest + listener), **member** (the worker agent, has manifest + listener).

## Scope

### In Scope (v1 — single landable change)

**Vocabulary + docs:**
- Adopt `operator` as the canonical term for the human in plugin docs, AGENTS.md operating manuals, hook output, and CLI help text. No rename of `lead` or `member`.
- Add an "Operator-direct interaction" section to the crews plugin README + `D:/ai-developer-toolkit/plugins/crews/CLAUDE.md`. Update codexu's `AGENTS.md` Bookkeeper section to reference the new envelope kinds and CLI commands.

**Mailbox / envelope schema (`plugins/crews/hooks/lib/...` or wherever envelope `kind` is enumerated):**
- Three new envelope kinds, additive, treated as first-class by `review-mail` and the manifest-level last-seen tracking:
  - `operator-direct` — operator → member message; body is the operator's typed text; routes to member inbox; lead receives a mirrored `operator-direct-summary` (or sees the original via the member's manifest's review queue).
  - `operator-direct-summary` — operator → lead briefing OR member → lead auto-summary, post-hoc context for the lead.
  - `escalate-to-operator` — lead → both (operator + member) — signals "switch to direct interaction." Carries `trigger` (enum) and optional `detail` text.
- Common envelope field additions: `operatorId` (opaque, captured at CLI invocation from `$USER` / `git config user.email` fallback / a one-time `~/.crews/operator-id` UUID — chosen at plan time), `operatorOriginCwd` (the directory the CLI was invoked from, for audit).
- `Mailbox` schema: extend the allowed-kind enum; reject envelopes whose `kind` isn't in the enum (backwards-compat: existing kinds unchanged).

**CLI (`plugins/crews/tools/crews.js`):**
- `crews-operator-message <member> [--crew <name>] [--reply-to <id>] <text>` — posts an `operator-direct` envelope to the named member. Auto-discovers the crew from cwd via the existing `.crews/state/` resolution pattern (same as `send-to-member`). Captures `operatorId` + `operatorOriginCwd`.
- `crews-notify-lead [--crew <name>] [--about <member>] <summary>` — posts an `operator-direct-summary` envelope to the lead's queue with `operatorId` populated. `--about` is optional; when absent the envelope is a general operator-to-lead note.
- `crews-inbox [--crew <name>] [--all-crews]` — new operator-facing command listing pending `escalate-to-operator` envelopes across the operator's discoverable crews. Read-only; no consume side effect (escalations stay live until the lead clears them or the underlying member resolves).
- All three commands print the canonical envelope id on success so the operator can paste it into other tools or `--reply-to` it later.

**Slash skill (lead-facing):**
- `/crews-escalate-to-operator <member> --trigger <name> [--detail "..."]` — emits the `escalate-to-operator` envelope and prints a one-line "tell the operator: <message>" prompt the lead can pass through verbatim.

**Hooks:**
- Member's PostToolUse hook (both Claude `hooks/post-tool-use.js` and Copilot `.copilot-plugin/copilot-hooks/post-tool-use.js`): when an `operator-direct` envelope was just consumed in this turn, set a manifest field `lastTurnMeta.operatorDirect = true` so the Stop hook can advisory-nag if the member's next `<|report ...|>` tag is missing the `operator-direct-summary` attribute. Advisory only — never hard-block, because operator behavior shouldn't penalize the member.
- Stop hook: if `lastTurnMeta.operatorDirect === true` and the emitted `<|report ...|>` lacks `operator-direct-summary`, print a one-line advisory ("This turn was triggered by operator-direct input; consider adding `operator-direct-summary` for lead visibility.") and let the turn through.
- `list-members` (Node CLI in `tools/list-members.js` plus the slash variant): include `lastOperatorDirectAt` (timestamp) from the member manifest. Display in the table.
- `review-mail`: visually flag `operator-direct`, `operator-direct-summary`, and `escalate-to-operator` envelopes with a `[op-direct]` / `[op-brief]` / `[escalate]` prefix in the rendered output. No separate review category, no separate cursor — they ride on the existing review-mail cursor and lock semantics.

**Backwards-compat smoke test:**
- A v1.7.x lead session reading a mailbox containing v1.8.x envelopes (operator-direct family) must not crash. Old `review-mail` renders unknown kinds with their body intact; the new kinds added to the schema enum take the same code path.

### Out of Scope (v1.1+ follow-ups)

- **Auto-detect via stdin source / PostToolUse heuristic (Axis 2 path B).** A heuristic flag like "the first user message of this turn arrived locally rather than via mailbox delivery → infer operator-direct" is plausible but has a large false-positive surface (session start, member already mid-task with no inbound mail, autonomous resume). Ship the explicit CLI in v1, gather data on how often operators forget to use it, then ship B in v1.1 as an opt-in crew-level config (`crew.json: { operatorDirectInferenceEnabled: true }`).
- **Magic-prefix path D (`OPERATOR:` at start of first message)** is discoverability-poor and would leak into transcripts. Not pursued.
- **Renaming `lead` → `orchestrator` / `coordinator` / `scrum-master`.** The token is in active use across hooks, CLI, manifests, slash commands, AGENTS.md, and operator memory. Rename would be pure churn for no semantic improvement.
- **Naming `operator` something else (`principal`, `owner`, `director`, `human`).** `operator` already lives in codexu's bookkeeper docs and in human-prose operator memory; the alternatives have known collisions (`principal` is auth/IAM, `owner` is git/file, `director` is org-charty, `human` is ambiguous in agent-as-actor context).
- **A real operator manifest, listener, or sessionId pointer.** The operator stays outside the heartbeat model; identity is captured only as the audit-only `operatorId` field on envelopes. Adding a manifest for the operator would invite "operator-as-fake-member" anti-pattern and require new lifecycle plumbing that the v1 design explicitly avoids.
- **Desktop notifications / OS toasts for `escalate-to-operator`.** Out of scope; document as a follow-up. `crews-inbox` is the v1 surface.
- **Operator-direct extended to interact with the lead's own session** (operator goes direct to lead's terminal). Same underlying mechanism, but a v1 design decision is needed; defer to planner. Probably yes, with `crews-operator-message --to-lead --crew <name>` as the variant.
- **Cross-workspace operator identity.** An operator working in two parallel workspaces gets two `operatorId` values (one per workspace UUID). Unifying them is a v2 concern.

## Criteria

Verifiable success conditions (these seed the plan's Acceptance Criteria):

1. **Envelope kinds round-trip:** `operator-direct`, `operator-direct-summary`, and `escalate-to-operator` appear in the mailbox schema's allowed-kind enum, pass through write→read in `crews.js review-mail`, and persist `operatorId` + `operatorOriginCwd` fields end-to-end. Test fixture covers each kind.
2. **`crews-operator-message`** from any cwd inside a known crew (auto-discovery) posts the envelope into the target member's inbox AND increments the member's manifest `lastOperatorDirectAt`. Returns the envelope id on stdout.
3. **`crews-operator-message --crew <name>`** works when invoked from a cwd outside any crew (explicit crew name overrides auto-discovery).
4. **`crews-notify-lead --about <member> "summary"`** posts an `operator-direct-summary` envelope into the lead's queue with `operatorId` populated. Visible in lead's `/crews-review-mail` with the `[op-brief]` prefix.
5. **`/crews-escalate-to-operator <member> --trigger interactive-debug-needed --detail "..."`** emits the envelope; it surfaces in both `crews-inbox` (operator-facing) and the member's mailbox. The trigger value is validated against the named enum; invalid triggers are rejected with an actionable error.
6. **Member's `<|report ...|>` parser accepts `operator-direct-summary="<short>"`** as an additional attribute on `progress`, `done`, `question`, `blocked` kinds; the field is propagated into the manifest's `lastReport` and into the lead's review-mail display.
7. **PostToolUse hook (both Claude AND Copilot)** sets `lastTurnMeta.operatorDirect = true` when an `operator-direct` envelope was consumed in the turn. Test fixtures cover both engine paths (per the recent cross-engine migration audit's parity requirement).
8. **Stop hook advisory-nag** (not hard-block) fires when `lastTurnMeta.operatorDirect === true` and the emitted report lacks `operator-direct-summary`. Advisory output goes to stderr; exit status remains 0.
9. **`crews-list-members`** (Node CLI + slash) renders a `lastOperatorDirectAt` column. Empty when the member has never received an operator-direct message.
10. **`review-mail` visual flags:** the three new envelope kinds render with their prefixes (`[op-direct]`, `[op-brief]`, `[escalate]`) — verifiable via snapshot or string-contains assertion on the rendered output.
11. **Backwards-compat smoke:** a session running v1.7.x crews reading a mailbox with v1.8.x operator-direct envelopes does not crash, surfaces the unknown body, and does not corrupt the review-mail cursor. Tested via a fixture mailbox written by the v1.8.x writer and read by a v1.7.x reader.
12. **Listener-arm gate (v1.6.2) and sessionId pointer index (v1.7.x) unchanged:** test that arming, manifest writes, pointer-index reads continue to pass their existing tests after the schema additions. No existing tests regress.
13. **Bookkeeper-lead operating model unchanged:** the existing `spawn-member`, `review-mail`, `stop-member` flow keeps working; the only additive surface for the bookkeeper is the new `[escalate]` / `[op-brief]` / `[op-direct]` items appearing in review-mail and the `lastOperatorDirectAt` column in `list-members`. AGENTS.md update is documentation-only.
14. **Auto-discovery** for `crews-operator-message`, `crews-notify-lead`, and `crews-inbox` uses the same cwd → `.crews/state/` resolution pattern as the existing `send-to-member` command; the test suite that covers the existing pattern is extended to cover the new commands.

## Context

### Synthesis highlights across the five axes

- **Axis 1 (Naming):** Keep `lead`. Adopt `operator` for the human. Both terms have least conflict with existing plugin / Claude Code / Copilot vocabulary and read naturally in prose. `lead` rename is pure churn; the four alternatives for `operator` (`principal`, `owner`, `director`, `human`) each have known collisions or readability problems.
- **Axis 2 (Direct channel mechanism):** CLI-first (option C) in v1; auto-detect (option B) is a v1.1 opt-in. Hybrid B+C was tempting but B's false-positive surface (first-turn-with-no-inbound-mail is also the normal session-start case) means shipping it default-on would create noise. The CLI captures intent unambiguously and works from any terminal; B's value is catching the casual operator who doesn't bother with the CLI, which we can layer in once we've seen real data on how often that happens.
- **Axis 3 (Escalation triggers):** Named enum (`interactive-debug-needed`, `demo-required`, `paused-on-realtime-question`, `transcript-too-large-to-relay`, `tool-prompt-required`) on a new `escalate-to-operator` envelope kind. Lead-facing slash command `/crews-escalate-to-operator`. The named enum is preferable to free-form text because it lets the operator-facing CLI (`crews-inbox`) sort and filter, and because it documents the canonical operator-escalation patterns so leads learn when to use them.
- **Axis 4 (Operator → lead notify):** Hybrid Q + P. Q (member auto-summary on next turn via `operator-direct-summary` attribute on the report tag) is the default low-friction path — the lead's normal review-mail flow picks it up without operator action. P (`crews-notify-lead` CLI) is the explicit override when the operator wants to brief the lead BEFORE the member's next turn or wants to add context the member missed. R (dashboard column) is layered on top as situational awareness, NOT as the primary action surface.
- **Axis 5 (Lead-side surface):** Both inbox + dashboard, NOT a separate `/crews:review-operator-direct` category. Separate categories fragment lead attention; merging into the existing inbox with a visual flag (`[op-direct]`, `[op-brief]`, `[escalate]`) preserves the lead's existing workflow. Dashboard column (`lastOperatorDirectAt` in `list-members`) is passive situational awareness.

### Disconfirming observations to carry forward

- **Operator-direct may not be a high-traffic surface.** If real operators rarely use the CLI (because typing into the member terminal is just easier), the value proposition collapses. Mitigation: v1.1 auto-detect (Path B) layered on top once we have data; until then, the v1 surface is at worst a no-op and at best captures the deliberate operator interactions cleanly. We do NOT build heavy infra (operator manifest, listener) speculatively.
- **Cross-engine hook parity is non-trivial.** The recent migration audit showed that Claude and Copilot hook surfaces diverge on stdin/env semantics. Adding PostToolUse hook behavior in both engines for the `operatorDirect` manifest write doubles the surface; the plan must include explicit cross-engine fixture tests, not rely on visual code review.
- **Named-trigger enum may not generalize.** The five proposed triggers cover the cases the brainstorm prompt enumerated, but real operator escalations may not fit. Mitigation: ship the enum as advisory (CLI accepts unknown triggers but warns), so we can collect telemetry on the long tail before deciding whether to extend or replace the enum. Alternatively, accept arbitrary `trigger` strings in v1 and document the canonical names — that's safer.
- **`operatorId` provenance is a privacy decision, not just an implementation detail.** Using `git config user.email` exposes the operator's identity into the audit log; using a workspace-local UUID is opaque but breaks cross-workspace correlation. The planner needs to surface this as an explicit decision rather than defaulting silently. Default proposal: opaque UUID stored at `~/.crews/operator-id` on first invocation; operator can opt into email-based identity via `~/.crews/config.json`.
- **The "operator goes direct to lead" case is unaddressed in v1.** A v1.1 follow-up adds `--to-lead` to `crews-operator-message`. Listed as out-of-scope explicitly so the planner doesn't silently absorb it into v1 scope.

### Open questions for the planner

1. **`operatorId` provenance** — opaque UUID at `~/.crews/operator-id` vs `git config user.email` vs `$USER`. Recommend opaque UUID by default; document the trade-off and the opt-in for email-based identity.
2. **Trigger enum: strict or advisory.** Strict (reject unknown triggers) forces the operator escalation vocabulary to stay disciplined; advisory (warn but accept) collects long-tail data. Recommend advisory in v1 so we learn what real operators want.
3. **`crews-notify-lead` without `--about`** — accept general operator-to-lead notes? Recommend yes; the envelope still routes to the lead's review queue, just without `aboutMember`.
4. **`crews-inbox` scope** — single crew (default to cwd-discovery) vs `--all-crews`. Recommend both, with single-crew as default for parity with the existing CLI commands.
5. **Hard-block vs advisory-nag** on missing `operator-direct-summary` after an `operator-direct` turn. Recommend advisory-nag only — hard-blocking would penalize the member for operator behavior. The Stop hook's existing kind-tag hard-block stays unchanged; this is a separate, weaker check.
6. **Does the v1 schema enum addition need a migration version bump in the manifest?** The plugin version bump (1.8.10 → 1.9.0) is clear, but if any manifest persists envelope kinds in a versioned schema marker, that needs a coordinated bump too. Planner should audit `hooks/lib/*` for any `schemaVersion` constants.
7. **Should `escalate-to-operator` carry a TTL or auto-clear policy?** If the lead escalates but the operator doesn't act, when does the escalation expire from `crews-inbox`? Recommend: stays live until either the operator dismisses it (`crews-inbox --dismiss <id>`) or the underlying member emits `kind=done` / `kind=question` clearing the original blocker. Planner to confirm.

### Migration story

- **Plugin version:** bump `plugins/crews/.claude-plugin/plugin.json` from 1.8.10 → 1.9.0 (minor — additive, no breaking changes).
- **Existing v1.7.x sessions:** continue working unmodified. They simply don't emit or receive operator-direct envelopes; if they receive one (mixed-version workspace), `review-mail` renders the body with the unknown kind label. Smoke test in Criterion 11 covers this.
- **Existing v1.8.x → v1.9.x:** zero-touch. Mailbox files written by v1.9.x are valid v1.8.x mailboxes plus new kinds. No schema field renames, no manifest layout changes.
- **AGENTS.md (codexu fork):** add a "Operator-direct interaction" subsection under the Bookkeeper invariants. Reference the new envelope kinds, the three CLI commands (`crews-operator-message`, `crews-notify-lead`, `crews-inbox`), the lead slash command (`/crews-escalate-to-operator`), and the named-trigger enum. Update the auto-memory note `feedback_check_mailbox_after_tool_bursts` to mention that operator-direct envelopes are also a peek trigger.
- **Bookkeeper operating model:** no dramatic change. The bookkeeper continues to spawn/monitor/stop members. New surfaces (`[escalate]` items, `[op-brief]` items, `lastOperatorDirectAt` column) appear in the existing review-mail and list-members flows. Decision-relayer prose ("operator says X to member Y") becomes a typed envelope, which is a strict win for forensics.

### Smoke-test observations (Copilot engine for crews)

This brainstorm was driven by the Copilot CLI engine and the crews plugin's Copilot mirrors. Anomalies observed during this session:

- **PreToolUse listener-arm gate fired correctly** on the very first non-arm tool call (`report_intent`, `powershell`, `glob` were all blocked simultaneously with the same diagnostic). The diagnostic message is clear and actionable.
- **Listener arm command worked first try** as an async background tool with no hook complaints once armed.
- **The spawn prompt's instruction to "produce ONLY selected-direction.md"** is in tension with the `/brainstorm-with-ralph` skill SKILL.md which expects a full Phase 1–5 lifecycle (codex + copilot + devil's advocate lens agents, staging dir, breadcrumb, etc.). I interpreted the spawn prompt as authoritative and did the brainstorm reasoning directly (single-agent across the five axes documented in the spawn prompt) rather than running the lens-agent ceremony. Worth flagging for the lead: if smoke-test fidelity requires running the actual skill, the spawn prompt should not say "produce ONLY".
- **No other anomalies** — slash commands, file edits, view, glob, and async powershell all behaved consistently with the documented contract.
