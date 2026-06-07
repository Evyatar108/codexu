# Research Brief: crews-listener-observability-logging

## Researcher Findings (self, direct read of primary checkout)
- `lib/listener-loop.js`: `runListenerLoop` ~L139; `timeoutMs` ~L147 (can be `null`);
  `const start = Date.now()` ~L164; `deliver(reason)` ~L331 logs `listener delivered name=.. crew=.. via=.. count=..` ~L347;
  `bail(reason)` ~L359 logs `listener timeout name=.. crew=.. reason=.. waitedMs=..` ~L362.
  Exports ~L403-409 (USAGE, parseListenerArgs, runListenerLoop, isStdoutNonInteractive, formatNoNewListenerAdvisory).
- `hooks/mailbox.js`: `appendMailboxWithSender` ~L403 = shared chokepoint for appendMailbox (~L449),
  appendSystemMailbox (~L489), appendOperatorMailbox (~L542). Reads recipient `manifest` ~L411 inside mailbox
  lock, before `writeJsonAtomic` ~L439. `envelope.sentAt` stamped ISO ~L433. `appendLog(line, cwd)` ~L926.
- `hooks/actor-state.js`: `deriveListenerState(manifest)` ~L60; demotes stale-armed→exited via isProcessAlive/heartbeat.
  Valid states: never-armed | armed | exited | recoverable.
- `hooks/protocol/manifest.js`: no `armedAt` field; only lastListenerSpawnAt/lastHeartbeatAt.
- Version: current 3.10.0; `scripts/bump-version.js` stamps 3 plugin manifests + 3 marketplace indexes +
  tests/version.test.js; CHANGELOG.md manual. crews = JS-only, "typecheck" = `node --check`; suite = `node tests/run.js`.

## Architect Analysis (self)
- Lowest-risk site for change 2 is the shared `appendMailboxWithSender` chokepoint (manifest already in hand,
  inside the existing mailbox lock — no new lock, no second read, covers all 3 append fns).
- For armedAtAgeMs, use loop-local `start`, NOT manifest.lastListenerSpawnAt (heartbeat-refreshed).
- Extract two pure exported helpers for unit-testability: computeOldestMsgAgeMs + isQueuedWhileUnarmed.

## Codex Research (gpt-5.5, xhigh)
- Confirms chokepoint + start-as-armedAt + timeoutMs-null + appendLog best-effort (rotates 64KB, swallows errors).
- "Do not add manifest locks in the append path"; reuse the mailbox-lock-held manifest read.
- kind derivation: `envelope.kind || opts.kind || sender.routingKind || 'message'`.
- Tests cover oldest-age helper + unarmed-vs-armed queued logging across appendMailbox AND appendSystemMailbox.
- Suggested version 3.10.1 (patch) — divergence from self/plan 3.11.0 (minor); captured as Open Question Q3.

## Copilot Research (gpt-5.4, xhigh)
- Confirms all primary edit points + that lastListenerSpawnAt is heartbeat-refreshed (use loop `start`).
- consume-mailbox-epoch-fence.test.js is the canonical pattern for asserting crews.log lines.
- Logging is observability-only; do not change delivery/drain/timeout/mailbox/version behavior.

## Consolidated File List
### Files to modify (ai-developer-toolkit submodule)
- plugins/crews/lib/listener-loop.js (changes 1 & 3 + computeOldestMsgAgeMs export)
- plugins/crews/hooks/mailbox.js (change 2 + isQueuedWhileUnarmed export)
- plugins/crews/tests/listener-delivery-observability.test.js (NEW)
- 6 version stamps via scripts/bump-version.js 3.11.0 + tests/version.test.js
- plugins/crews/CHANGELOG.md (## 3.11.0) + plugins/crews/AGENTS.md (## v3.11.0)
### codexu (ship-phase pointer commit)
- AGENTS.md active-plugin-versions table; ai-developer-toolkit submodule gitlink
### Reference (read-only)
- hooks/actor-state.js (deriveListenerState), hooks/config.js (appendLog re-export),
  tests/consume-mailbox-epoch-fence.test.js (log-assert pattern)
