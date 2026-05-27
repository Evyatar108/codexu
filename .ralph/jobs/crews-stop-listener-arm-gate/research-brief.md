# Research Brief — crews-stop-listener-arm-gate

## Researcher Findings (Agent 1)
See full output in /tmp; key file:line locations:

- **`hooks/stop.js`** — `decideStopBlock()` called at line 654; reads `listenerState` at line 587; manifest reads at 358, 450, 480, 524, 558, 663, 708. Kind-tag parse at line 617. Review-required gate 602-614. Missing-kind block 619-631. Strict-ack/resolution 710-734.
- **`hooks/pre-tool-use.js`** — `getListenerState()` at line 418; engine detection `manifest.engine === 'copilot'` at line 452.
- **`hooks/actor-state.js`** — canonical `getListenerState()` at lines 122-128; `deriveListenerState()` at 60-78; `isStaleArmedManifest()` at 84-97; `HEARTBEAT_STALE_MS_LOCAL = 5 * 60_000` at line 58.
- **`hooks/listener-protocol.js`** — `buildListenerCommand()` at lines 24-38 CURRENTLY emits `node 'wait-for-message.js' <name> --crew ...` (deprecated form, not `crews.js arm`).
- **`tools/crews.js`** — `arm` subcommand dispatched at lines 43-50 to `runListenerLoop()`.
- **`tests/stop-decision.test.js`** — fixture pattern at lines 10-71; uses `cfg.ensureActorDir()` + manifest injection.
- **`tests/first-turn-listener-guard.test.js`** — **CASE 4 (lines 120-138) asserts `kind=progress` unarmed BLOCKS**; this is explicit v1.0.6 design ("rule applies uniformly to all kinds") that **AC-2 reverses**.
- **`.claude-plugin/plugin.json`** + **`.github/plugin/plugin.json`** — both at v1.6.0.
- **`scripts/bump-version.js`** — single canonical version-bump script. Updates: `plugins/crews/.claude-plugin/plugin.json`, `plugins/crews/.github/plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`. **NOT** `tests/version.test.js` (that file pulls version from plugin.json at runtime).
- **`CHANGELOG.md`** at `plugins/crews/` — **DOES NOT EXIST**; would be a new file.

## Architect Analysis (Agent 2)
- The Stop hook's existing listener gate (`decideStopBlock` → `requireReachableForStop`) ALREADY blocks all kinds when listener unarmed. The feature is **narrowing** (carving out a `kind=progress` + `queueDepth=0` exemption), not adding a wholly new gate.
- No `queueDepth` field exists in manifest schema. Pending-outbound must be derived. Candidate helpers: `findPendingConsumedEntries()` (stop.js:128-144) returns unresolved consumed inbox rows; this signals "lead sent us mail we haven't replied to yet". Outbox-pending detection needs `readOutbox()` or `readSendHistoryTail()`.
- `agent-peers` plugin has NO Stop hook of its own; cross-plugin coexistence (AC-6) is structurally satisfied.
- Heartbeat staleness is uniformly 5 min via `HEARTBEAT_STALE_MS_LOCAL`; no divergence between PreToolUse and Stop.
- Recommended decomposition: A) hook + helper, B) tests, C) docs+version. Stories A and B share `stop.js` (logic vs test fixtures), so serial A → B → C.

## Codex Research
- Existing order in stop.js: ownership → opportunistic mailbox consume (if unarmed) → review-required gate → parse report tag → `decideStopBlock()` (listener gate, blocks ALL kinds) → strict-ack → outbox.
- Default review-required kinds in `protocol/review-required.js` are already narrowed to `done`, `question`, `blocked` (v1.6.0 excludes `progress` from review-required). The new feature parallels this narrowing for listener-armed.
- `buildListenerCommand()` emits deprecated `wait-for-message.js` form. **`isListenerArmCall()` / `isListenerArmToolCall()` already recognize `crews.js arm`** — so swapping the emitted form does not break detection.
- **`--name` flag is NOT declared** in `parseListenerArgs()` (lib/listener-loop.js); it happens to work because unknown flags are skipped and the value falls into positional. **Recommendation: emit `arm <name> --crew <crew> --cwd <cwd> --session-id <id>` (positional name)** rather than adding `--name` support. Spec's `--name <name>` example is inaccurate.
- Hook blocks are emitted as JSON to stdout with `{decision:'block', reason:'…'}`; tests expect process exit 0. The spec's "exit code 2" framing is informal — the canonical pattern is JSON-on-stdout.
- **`tests/first-turn-listener-guard.test.js` CASE 4 conflicts with AC-2** — must be updated, not just added to.
- **`tests/listener-protocol.test.js`** and **`tests/listener-protocol-shell-tools.test.js`** pin the current `buildListenerCommand()` output — both must be updated when the command form swaps.
- **`tests/version.test.js`** reads version from `plugin.json` at runtime — passes automatically after `bump-version.js`.

## Copilot Research
- Confirms all above. Adds: `decideStopBlock()` currently calls `requireReachableForStop()` and blocks all kinds for active lead/member.
- Confirms `--name` is not in `listener-loop.js` arg parser or `listener-protocol.js::parseArmIdentity()`.
- Confirms `plugins/crews/CHANGELOG.md` does not exist; creating it is a deliberate new artifact.
- Suggests: small predicate `shouldRequireArmedListener({ role, kind, queueDepth })` returning true for active `lead`/`member` when `kind ∈ {done,question,blocked}` OR `queueDepth > 0`. Call `decideStopBlock()` only when predicate is true.

## Consensus Findings (3+ reviewers agree)
1. **The existing gate ALREADY fires** — the feature is narrowing + hardening, not new addition.
2. **`buildListenerCommand()` swap from `wait-for-message.js` → `crews.js arm` is REQUIRED for AC-1** to emit canonical arm command.
3. **`--name` flag does not exist** in the arm subcommand parser; use positional name.
4. **`first-turn-listener-guard.test.js` CASE 4 contradicts AC-2** and must be replaced/inverted.
5. **`listener-protocol*.test.js` pins old command form** — must update along with `buildListenerCommand()` swap.
6. **`bump-version.js` is the canonical version-bump path** — touches 5 JSON files, not the 1 the spec mentions.
7. **`CHANGELOG.md` does NOT exist** at `plugins/crews/` — creating it is a new artifact.
8. **Operator's actual bug** (listener-not-rearmed after sync review-mail) likely involves **stale `listenerState='armed'` in manifest** while listener process is dead. `deriveListenerState()` has stale detection (heartbeat 5min + PID liveness), so if the gate passes "armed" despite a dead listener, that's a separate hardening issue beyond the spec's ACs. Flag as Open Question.

## Open Divergences
- **Codex** suggested predicate-based gating with explicit `queueDepth` parameter passed into `decideStopBlock`. **Architect** suggested an inline check + reuse of `findPendingConsumedEntries()`. Resolve: predicate-based is cleaner for tests (AC-4 wants fixtures with explicit `queueDepth`).
- **Architect** raised question on copilot-specific error prose (PowerShell vs bash). **Codex** notes engine-aware logic already exists at stop.js:359 and `buildReviewMailCommand` engine branch (listener-protocol.js:63-77). Resolve: mirror the existing engine-aware pattern.

## Consolidated File List

### Files to modify (impl)
- `D:/ai-developer-toolkit/plugins/crews/hooks/stop.js` — narrow gate + queueDepth predicate
- `D:/ai-developer-toolkit/plugins/crews/hooks/listener-protocol.js` — `buildListenerCommand()` → emit `crews.js arm`; `requireReachableForStop()` may absorb the predicate
- `D:/ai-developer-toolkit/plugins/crews/hooks/actor-state.js` — possibly harden stale-armed detection (Open Question)

### Files to modify (tests)
- `D:/ai-developer-toolkit/plugins/crews/tests/stop-decision.test.js` — add 3 fixtures (AC-4)
- `D:/ai-developer-toolkit/plugins/crews/tests/first-turn-listener-guard.test.js` — invert CASE 4 (progress unarmed = OK)
- `D:/ai-developer-toolkit/plugins/crews/tests/listener-protocol.test.js` — update arm-command form assertions
- `D:/ai-developer-toolkit/plugins/crews/tests/listener-protocol-shell-tools.test.js` — update arm-command form assertions

### Files to modify (docs / version)
- `D:/ai-developer-toolkit/plugins/crews/CLAUDE.md` — document new Stop-hook invariant + progress exemption
- `D:/ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json` — via `bump-version.js`
- `D:/ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json` — via `bump-version.js`
- `D:/ai-developer-toolkit/.claude-plugin/marketplace.json` — via `bump-version.js`
- `D:/ai-developer-toolkit/.github/plugin/marketplace.json` — via `bump-version.js`
- `D:/ai-developer-toolkit/.agents/plugins/marketplace.json` — via `bump-version.js`

### Files to create
- `D:/ai-developer-toolkit/plugins/crews/CHANGELOG.md` — new file with v1.6.2 entry (or v1.6.0 + v1.6.2 baseline)

### Reference files (read-only context)
- `D:/ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js` — mirror its `getListenerState()` pattern
- `D:/ai-developer-toolkit/plugins/crews/hooks/protocol/review-required.js` — mirror its narrowing of review-required kinds (template for our narrowing)
- `D:/ai-developer-toolkit/plugins/crews/hooks/protocol/review-gate.js` — pattern for emitting `{decision:'block', reason}` with canonical arm command
- `D:/ai-developer-toolkit/plugins/crews/lib/listener-loop.js` — `parseListenerArgs()` confirms positional name (no `--name`)
- `D:/ai-developer-toolkit/plugins/crews/scripts/bump-version.js` — version-bump script

### Version-coordination note
**v1.6.1 is in flight on sibling worktrees** (`.worktrees/ralph-orchestration-codex-exec-windows-spawn/`, `.worktrees/overview-data-dynamic-stages-schema/`) but has NOT yet landed on `origin/main` (still 1.6.0). The spec's v1.6.2 target assumes v1.6.1 lands first. If this impl ships before v1.6.1, the bump must be 1.6.0 → 1.6.2 (skipping 1.6.1) — or it should coordinate so this lands as v1.6.1 instead. Open Question for operator.
