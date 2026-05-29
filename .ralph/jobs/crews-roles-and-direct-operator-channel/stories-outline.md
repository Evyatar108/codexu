# Stories Outline: Crews 3-Party Actor Model — Operator Role + Direct-Interaction Channel

*Preliminary decomposition from `/plan-with-ralph --from-brainstorm`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Foundation — auth policy + review-required protocol additions
**Description:** As an implementer, I want the `'operator-cli'` auth policy and the three new envelope kinds (`operator-direct`, `operator-direct-summary`, `escalate-to-operator`) registered in the review-required protocol, so that all downstream stories can rely on these primitives without touching them again.
**Acceptance Criteria:**
- [ ] `hooks/commands/auth-policies.js` exports `'operator-cli'` in `AUTH_POLICIES`. The policy resolves `operatorId` via the helper (added in US-006) lazily; for US-001 it's a no-op stub that simply does not require an actor session.
- [ ] `hooks/protocol/review-required.js` `DEFAULT_REVIEW_KINDS` includes `'operator-direct'`, `'operator-direct-summary'`, `'escalate-to-operator'` in addition to the existing `'done'`, `'question'`, `'blocked'`.
- [ ] Existing tests pass: `pnpm --filter crews test` exits 0 with no regressions in `tests/protocol-envelope.test.js`, `tests/review-mail-command.test.js`, `tests/send-to-member-authz.test.js`.
- [ ] New test: a fixture envelope with `kind: 'operator-direct'` and target role `'member'` returns `true` from `isReviewRequiredEnvelope`. Same for `'operator-direct-summary'` → `'lead'` and `'escalate-to-operator'` → both.
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Envelope schema + operator-source write path
**Description:** As an implementer, I want envelopes to persist `operatorId` and `operatorOriginCwd` fields end-to-end, and I want an `appendOperatorMailbox` helper for operator-source writes that bypass the actor-session check (analogous to the existing `appendSystemMailbox`), so that the operator-CLI commands have a write path.
**Acceptance Criteria:**
- [ ] `appendMailboxWithSender` accepts and persists `operatorId` and `operatorOriginCwd` on the envelope (they live on the envelope alongside `from`, NOT inside `from`).
- [ ] New `appendOperatorMailbox(name, crew, cwd, envelope, opts)` exported from `hooks/mailbox.js`. It sets `from: { role: 'operator', operatorId: opts.operatorId }`, stamps `operatorOriginCwd` on the envelope, and bypasses the `deriveSenderIdentity` flag check (same trust model as `appendSystemMailbox`).
- [ ] `appendActorSendHistory` is NOT called for operator-source writes (the operator has no manifest, no send-history file). Confirm this is correct via test fixture.
- [ ] `guard test`: `VALID_KINDS` is unchanged — still `['progress','done','question','blocked']`. New `tests/valid-kinds-unchanged.test.js` or extension to `tests/protocol-envelope.test.js`.
- [ ] New test: `tests/operator-mailbox-writepath.test.js` covers write → read of `operatorId`/`operatorOriginCwd` fields across the three new envelope kinds.
- [ ] Existing `appendMailbox`, `appendSystemMailbox`, `appendOutbox`, `consumeMailbox` callers' tests continue to pass.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-006: Operator-identity helper
**Description:** As an operator, I want my operator-id resolved transparently on first run (creating `~/.crews/operator-id` with a UUIDv4 at mode 0600) and reused on subsequent runs, with an opt-in override via `~/.crews/config.json`, so that my identity is captured in the audit log without exposing my email by default.
**Acceptance Criteria:**
- [ ] New `hooks/lib/operator-identity.js` exports `resolveOperatorId()`, `resolveOperatorOriginCwd()`.
- [ ] First call with no existing `~/.crews/operator-id`: creates the file (mode `0600`) containing a UUIDv4 from `crypto.randomUUID()`. Subsequent calls read it without rewriting.
- [ ] `~/.crews/config.json` with `{ operatorId: "explicit-value" }` takes precedence over the file. Documented in the README's privacy section.
- [ ] `git config user.email` is NEVER consulted by default. (Explicit guard in test: spy on child_process.execSync; assert no `git config` invocation.)
- [ ] `resolveOperatorOriginCwd()` returns `process.cwd()` at the time of CLI invocation (NOT the workspace state-cwd, which can differ).
- [ ] Tests cover: first-run file creation; second-run file reuse; config-override; mode check (on POSIX — Windows mode bits are best-effort, document a Windows-skip on the mode assertion).
- [ ] Typecheck passes.
**Dependencies:** US-001 (no hard code dependency; the helper is standalone, but ordered after US-001 so the auth-policy stub can be replaced with a real call).
**Estimated complexity:** small

## US-003: Operator CLI commands (operator-message, notify-lead, inbox)
**Description:** As an operator, I want `crews-operator-message`, `crews-notify-lead`, and `crews-inbox` CLI commands so I can interact with members and the lead through typed, audited envelopes from any terminal.
**Acceptance Criteria:**
- [ ] `hooks/commands/operator-message.js` implements `crews-operator-message <member> [--crew <name>] [--reply-to <id>] <text>`. Auto-discovers crew via existing `state-cwd-locator.js` when `--crew` is absent. Uses `appendOperatorMailbox` to post `{ kind: 'operator-direct', operatorId, operatorOriginCwd, message }`. Prints envelope id on stdout (JSON for CLI, plain text for any future slash form — slash NOT exposed in v1).
- [ ] `hooks/commands/notify-lead.js` implements `crews-notify-lead [--crew <name>] [--about <member>] <summary>`. Resolves the lead via the existing leads-registry (`hooks/leads-registry.js`). Posts `{ kind: 'operator-direct-summary', operatorId, operatorOriginCwd, aboutMember?, summary, message: summary }`. `--about` is OPTIONAL; envelope omits `aboutMember` when absent.
- [ ] `hooks/commands/inbox.js` implements `crews-inbox [--crew <name>] [--all-crews]`. Reads each lead's outbox (filtered to `kind === 'escalate-to-operator'`) across discoverable crews. Default scope is single-crew (cwd-discovery); `--all-crews` widens to every crew under `<stateCwd>/.crews/state/`. Read-only by default; supports `--dismiss <id>` which appends a dismissal envelope (per Open Question 4).
- [ ] All three commands use the `'operator-cli'` auth policy.
- [ ] Registered in `hooks/commands/registry.js` with `surfaces.cli.enabled = true`, `surfaces.slash.enabled = false`, `roleVisibility: []` (operator is not a slash-visible role).
- [ ] Tests: `tests/operator-message-cli.test.js`, `tests/notify-lead-cli.test.js`, `tests/inbox-cli.test.js`. Each covers happy path; operator-message covers auto-discovery vs explicit `--crew`; notify-lead covers with/without `--about`; inbox covers single-crew and `--all-crews`.
- [ ] Typecheck passes.
**Dependencies:** US-001, US-002, US-006
**Estimated complexity:** large

## US-004: Lead slash escalate-to-operator
**Description:** As a lead, I want `/crews-escalate-to-operator <member> --trigger <name> [--detail "..."]` so I can signal "go talk directly" to both the operator and the member through a typed envelope.
**Acceptance Criteria:**
- [ ] `hooks/commands/escalate-to-operator.js` implements both the slash form (`/crews-escalate-to-operator`) and a CLI mirror. Slash form uses `'active-lead-session'` auth.
- [ ] Dual-write: appends the envelope to the lead's own outbox (so `crews-inbox` can find it) AND calls `appendMailbox(memberName, crew, ..., envelope)` so the named member receives a mailbox notification.
- [ ] Trigger validation is ADVISORY: canonical triggers (`interactive-debug-needed`, `demo-required`, `paused-on-realtime-question`, `transcript-too-large-to-relay`, `tool-prompt-required`) are accepted silently; non-canonical triggers are accepted but emit a one-line stderr warning naming the canonical set.
- [ ] `--detail "..."` is OPTIONAL; envelope omits the field when absent.
- [ ] Prints a "tell the operator: …" one-line prompt the lead can pass through to the human verbatim (per D-001 §41).
- [ ] Registered in `hooks/commands/registry.js` with `surfaces.slash.enabled = true`, `roleVisibility: ['lead']`, `surfaces.cli.enabled = true` (CLI mirror for external scripting).
- [ ] Test: `tests/escalate-to-operator-cli.test.js` covers dual-write, canonical-trigger silent accept, non-canonical trigger warn-then-accept, with/without `--detail`.
- [ ] Typecheck passes.
**Dependencies:** US-001, US-002
**Estimated complexity:** medium

## US-005: Member tag attribute + auto-summary plumbing
**Description:** As a lead, I want member `<|report ...|>` tags to be able to carry `operator-direct-summary="<short>"` and have that summary surface in `review-mail`, and I want a stderr advisory-nag when a member's turn was started by an `operator-direct` envelope but the report tag lacks the summary attribute.
**Acceptance Criteria:**
- [ ] `parseTurnTags` in `hooks/mailbox.js` extracts `operator-direct-summary` attribute (case-insensitive regex matching the existing `summary` / `reply-to` / `ack` / `decision` / `reason` attribute pattern) on all four kinds (`progress`, `done`, `question`, `blocked`). The function's return value gains an `operatorDirectSummary: string | null` field.
- [ ] The stop hook (Claude side: `hooks/stop.js`) writes `operatorDirectSummary` into the outbox envelope that propagates the member's report to the lead. Field name on the envelope: `operatorDirectSummary`.
- [ ] `consumeMailbox` writes `manifest.lastTurnMeta.operatorDirect = true` when any drained envelope has `kind === 'operator-direct'`. Same code path sets `manifest.lastOperatorDirectAt = <ISO timestamp>` (the timestamp of consumption). Both updates land in the existing manifest patch under `withManifestLock`.
- [ ] Both stop hooks (`hooks/stop.js`, `hooks/copilot-stop.js`) read `manifest.lastTurnMeta.operatorDirect`. If `true` AND the emitted `<|report ...|>` tag lacks `operator-direct-summary`, write to stderr exactly: `This turn was triggered by operator-direct input; consider adding operator-direct-summary="<short>" for lead visibility.` and continue with exit code 0 (advisory, never hard-block).
- [ ] After the stop hook writes the report (or fires the nag), `manifest.lastTurnMeta.operatorDirect` is cleared to `false` (or the key removed) so the next turn starts clean. Race-safe via `withManifestLock`.
- [ ] Refactor the shared advisory-nag logic into a single helper (`hooks/lib/operator-direct-nag.js` or via `hooks/copilot-shim.js`) so Claude and Copilot stop hooks call the same code. (If refactor proves too invasive, fall back to duplication with a parity test — see Open Question 3.)
- [ ] Cross-engine fixture test: same simulated turn input, run through both stop-hook entry points, asserts identical stderr output and exit codes.
- [ ] Tests: `tests/operator-direct-summary-tag.test.js`, `tests/lasturnmeta-operator-direct.test.js` (including cross-engine assertion block).
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** large

## US-007: Visual surfacing + backwards-compat smoke + docs + version bump
**Description:** As a lead/operator, I want the new envelope kinds visually flagged in `review-mail` and `list-members`, and I want plugin docs + version metadata to reflect the new 1.9.0 surface, and I want a backwards-compat smoke test to prove v1.8.x readers don't crash on v1.9.x envelopes.
**Acceptance Criteria:**
- [ ] New `hooks/lib/envelope-kind-prefix.js` exports `envelopeKindPrefix(kind)` returning `'[op-direct]'`, `'[op-brief]'`, `'[escalate]'`, or `''`.
- [ ] `hooks/commands/review-mail.js` calls the helper. `formatReviewMailEntry` returns a new `displayPrefix: string` field (empty string when no prefix). `formatSuccess` concatenates `displayPrefix + ' ' + summary` for human display while leaving `summary` clean for JSON consumers.
- [ ] `hooks/crews.js` `snapshotCrew` reads `lastOperatorDirectAt` from each member's manifest.
- [ ] `hooks/actors.js` `formatMemberList` adds a "Last op-direct" column to the pretty-print table. JSON output (`pretty=false`) includes the field automatically.
- [ ] Cross-engine hook parity test: simulated turn run through both stop-hook entry points produces identical stderr advisory output. (Test file may be the same as US-005's `tests/lasturnmeta-operator-direct.test.js`.)
- [ ] Backwards-compat smoke: `tests/backwards-compat-v18x-reader.test.js` writes a fixture mailbox containing one envelope of each new kind using the v1.9.x writer, then runs the v1.8.x `consumeMailbox` and `formatReviewMailEntry` code paths against it. Asserts: no exception, body intact, `review-mail` rows include each new kind string. (Practically: import the current code at HEAD as the "writer" and import the v1.8.x code via a vendored fixture or git-show-pinned dependency — implementer's call which approach is cleanest.)
- [ ] `.claude-plugin/plugin.json` version bumped to `1.9.0`.
- [ ] `CHANGELOG.md` has a `## 1.9.0` entry summarizing: new envelope kinds, new CLI commands, new lead slash, new manifest fields, new tag attribute, no breaking changes, additive backwards-compat with v1.7.x/v1.8.x readers.
- [ ] `README.md` has a new "Operator-direct interaction" section between "Turn-End Reports" and "STRICT-ACK contract & decision verbs" sections. Covers the three CLI commands, the lead slash, the named-trigger enum, the tag attribute, and the `[op-*]` prefixes. Includes a privacy note about `operatorId`.
- [ ] Plugin `AGENTS.md` and codexu `D:/harness-efforts/codexu/AGENTS.md` updated per the plan's "Modified files" list.
- [ ] Tests pass; typecheck passes; no regressions on existing tests.
**Dependencies:** US-003, US-004, US-005
**Estimated complexity:** large
