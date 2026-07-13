Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

## Evidence-grounded diagnosis

This is not a routing failure. The installed V2 command enabled MultiAgentV2 and exited successfully after 26m55s, but its acceptance summary found none of the expected Codex roles (`.ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/dogfood/codex-plan.command.json:9,15-17`; `installed-skill-dogfood-summary.json:3,6-7,77-78`). The parent spawned both children with `model:"gpt-5.6-sol"` and `reasoning_effort:"xhigh"` (`C:\Users\evmitran\.codex\sessions\2026\07\13\rollout-2026-07-13T09-26-53-019f5c4d-8bd2-7112-856d-5a8ddc6c22c4.jsonl:96,136`). Both child rollouts retained that routing, received only encrypted inter-agent content, and completed in under one second without a last agent message (`...09-29-34-019f5c4f-ff1d-7d82-833b-f3f157f28bef.jsonl:6-8`; `...09-40-28-019f5c59-f8c3-7392-9804-50beb008b9aa.jsonl:6-8`).

Source supports a narrow boundary defect. V2 marks the spawn, send, and follow-up message schemas `encrypted:true` (`codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:156-203,598-606`), then forwards the returned opaque value via `InterAgentCommunication::new_encrypted` and `agent_message.encrypted_content` without possessing plaintext or a key (`.../multi_agents_v2/spawn.rs:64-117`; `.../multi_agents_v2.rs:44-55`; `.../protocol/src/protocol.rs:686-760`). Copilot does process plaintext V2 agent messages—the parent consumed a plaintext completion notification at parent rollout line 102—so this is not a blanket V2-message incompatibility.

The wait timeout is independent. Completion was in parent history before each wait began (`parent rollout:102 before 110-111`; `142 before 145-146`). Targetless V2 wait observes pending or future mailbox activity after already-delivered input has been drained (`.../multi_agents_v2/wait.rs:44-99`; `.../session/input_queue.rs:221-240`). It therefore cannot reliably recover an already-completed fast child. `Completed(None)` is a valid generic terminal protocol state, mechanically produced by a message-less `TurnComplete` (`.../agent/status.rs:6-19`; `.../tasks/mod.rs:850-884`); it is nevertheless a failed acceptance outcome when a non-empty delegated canary was expected to return a meaningful result.

The source/raw-evidence conclusions above are not based only on a provisional retry note: the original Codex and Devil's Advocate lenses inspected the named dogfood, parent rollout, both child rollouts, and current source, and supplied the cited locations.

## Candidate directions

### D-001: Provider-capability-aware plaintext V2 handoff with exact targeted wait
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Merge the native encryption-boundary and tool-schema framings because they are the same architectural bet. For a provider that cannot decrypt encrypted tool arguments across child requests, omit the `encrypted` schema marker for all three V2 communication tools and construct truthful plaintext `InterAgentCommunication`; retain encrypted behavior elsewhere. Separately extend V2 `wait_agent` with an optional exact `task_name`: resolve the target, subscribe to its status watch first, read the receiver's current value, return immediately if final, otherwise await changes on that same receiver alongside user steering. This subscribe-first ordering closes the transition-between-check-and-subscribe race. Omitted-target behavior remains unchanged. The installed Ralph 5.64 recipe already uses task identity when the schema exposes it (`C:\Users\evmitran\.codex\plugins\cache\ai-developer-toolkit\ralph-orchestration\5.64.0\.codex-plugin\codex-skills\plan-with-ralph\SKILL.md:1557-1571`).
- Risks / friction: Copilot task text becomes plaintext in requests and local rollouts; that privacy trade-off must be explicit. A hard-coded Copilot branch may age worse than an explicit provider capability. Fixing spawn alone would leave `send_message` and `followup_task` broken. A targetless “return on any completed agent” change would be unsafe because stale open completions could cause false wakes and loops.
- Cheapest validation: With a disposable Copilot-ID provider, verify all three schemas omit `encrypted`, a unique nonsecret canary reaches the child as `agent_message/input_text`, and the child returns `Completed(Some(canary))`. Independently test a child already final before the wait call, a completion racing between target resolution/subscription/current-value inspection, and a completion after the initial read.
- Disconfirming observation: If Copilot still returns ciphertext after the marker is omitted, or a plaintext canary reaches the child but it still immediately completes without output, this boundary is insufficient. If exact status cannot be safely snapshotted without consuming unrelated activity, the targeted-wait part needs redesign, without invalidating the handoff fix.

### D-002: Preserve encryption through a real Copilot service capability
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: If encrypted delegated prompts are a hard requirement, the service that generates the ciphertext must support decrypting it when constructing the separate child request. A temporary host-adapter or alternate ordinary-string tool alias can diagnose whether encryption is keyed by schema marker, tool identity, or item type.
- Risks / friction: Codex has neither plaintext nor a decryption key, so a genuine fix likely lives outside this repository and cannot unblock Ralph on the fork's release schedule. A production adapter that strips schema markers late or rewrites `encrypted_content` to plaintext would mislabel stored data, weaken replay/debug semantics, and risk old ciphertext (`.../client.rs:783-823`; `.../agent/control.rs:754-758`). A wire alias also increases fork divergence across discovery, telemetry, hooks, and rendering.
- Cheapest validation: Send the same canary through the Copilot service as encrypted tool content and as ordinary `input_text`; confirm only the encrypted cross-child form fails. Use an alias/adapter solely as a probe, not as the production design.
- Disconfirming observation: If the service already demonstrates cross-child decryption and the child receives readable task text from the current encrypted schema, the native plaintext policy is solving the wrong boundary. Conversely, if the service cannot be changed or the fork controls no suitable host seam, this is not the smallest actionable fix.

### D-003: Explicit V1 containment fallback
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: V1 uses a normal plaintext message, preserves explicit model/reasoning overrides, and avoids the race by obtaining the target status watch before reading its current value (`.../multi_agents_spec.rs:554-590`; `.../multi_agents/spawn.rs:58-141`; `.../multi_agents/wait.rs:114-123`). Ralph 5.64 already documents a V1 recipe and fail-closed V2 disablement (`.../plan-with-ralph/SKILL.md:1500-1506,1573-1593`), making this a credible immediate operational rollback and control case.
- Risks / friction: It does not repair V2. Silent downgrade is unsafe because V1/V2 tool names, identifiers, fork fields, outputs, lifecycle, and wait result shapes differ. It may lose V2-only behavior and conceal a provider regression.
- Cheapest validation: Rerun the exact installed Ralph dogfood with V2 explicitly disabled; require exact gpt-5.6-sol/xhigh children, non-empty completion messages, expected role artifacts, and no ten-minute waits.
- Disconfirming observation: If V1 loses exact routing, also yields empty children, or cannot produce the expected Ralph artifacts, it is not a safe containment path. A successful run still does not replace D-001.

## Recommendation

Choose D-001. It is the smallest architecturally truthful fork fix: make encoding reflect a provider capability at the schema/communication creation boundary, not in generic response serialization, and add a narrowly target-aware wait rather than changing targetless semantics. Implement the handoff and wait corrections as independently testable changes; neither test should use the other to pass. Cover spawn, send, and follow-up together. Prefer an explicit provider capability over scattered `is_copilot()` checks, though the existing reserved-ID predicate at `model-provider-info/src/lib.rs:435-445` is acceptable for the smallest first release if documented.

D-003 is the fail-closed rollback while the patch is built and the acceptance control for the release. D-002 remains the only primary direction if encrypted Copilot delegated prompts are non-negotiable, but it is not the smallest fix under repository control.

## Release path

Keep the conflict budget on existing upstream-canonical seams: provider capability in `model-provider-info`, provider-aware schema generation in `core/src/tools/spec_plan.rs` / `multi_agents_spec.rs`, shared V2 communication construction in the V2 handlers/message helper, and optional exact targeting in the V2 wait spec/handler. Avoid `core/src/client.rs`, `codex-api`, broad protocol rewrites, or generic transport mutation unless a failing probe proves they are necessary. Mark the fork edits `// SANDBOX PATCH`; update `docs/implementation/patch-surface.md` §14 invariants/tests and §15 replant guidance.

After targeted tests and `cargo check --workspace`, bump the current `0.141.0-copilot-api.3` to `0.141.0-copilot-api.4`, then use `codex/.claude/commands/publish-sandbox-patch.md:1-18,116-129,175-250,252-490` for patched-source commit/tag, wrapper gitlink update, bundle/release publication, and launcher smoke. Acceptance must use the published installed `.4` binary and installed Ralph 5.64 cache, not only a source checkout.

## Decisive tests

1. Schema unit tests: Copilot omits `encrypted` for V2 spawn/send/follow-up; OpenAI and other providers retain it.
2. Encoding unit tests: Copilot creates `agent_message/input_text`; encrypted providers create `encrypted_content`; plaintext is never stored under the encrypted field.
3. Core integration: a Copilot-ID provider receives a unique nonsecret delegated canary, exact gpt-5.6-sol/xhigh routing, and returns a meaningful final answer observed as `Completed(Some(canary))`. The existing encrypted-shape/empty-child mock (`core/tests/suite/subagent_notifications.rs:1026-1097`) is not sufficient.
4. Wait integration: target already final before the call, completion concurrent with target resolution/subscription/current-value inspection, completion after the initial read, unrelated prior completions, user steering, timeout, and omitted-target legacy behavior.
5. Compatibility: unchanged V1 targetful behavior and unchanged non-Copilot encrypted V2 wire behavior.
6. Published installed-host dogfood: rerun the exact Ralph command; raw children must show Copilot provider, gpt-5.6-sol/xhigh, readable canary task, non-null final output, no 600000-ms timeout, and all four expected role artifacts.

## Compatibility/recovery

V1 remains unchanged and is the explicit temporary fallback. Non-Copilot V2 retains encrypted schema and wire behavior. Copilot V2 changes only the unsupported message encoding plus the additive optional wait target; old targetless callers retain their present semantics. Pre-`.4` ciphertext-only child rollouts cannot be reconstructed locally because the fork has no key or plaintext. Do not reinterpret or migrate those records; mark them affected and rerun/respawn from the original task source. Fail closed with a clear diagnostic if plaintext policy is disabled and host decryption is unavailable.

## Open decisions

- Is plaintext delegated-task visibility acceptable for Copilot, or is encrypted handoff a hard security requirement that forces D-002?
- Should the provider model expose a general encrypted-tool-argument capability now, or use the existing Copilot predicate for `.4` and generalize later?
- Ship optional exact `task_name` wait in `.4` as recommended, or defer it only if repeated realistic plaintext installed-host runs prove Ralph never encounters the race?
- Keep Ralph 5.64 blocked pending published `.4` acceptance, or permit only the explicit V1 rollback in the interim?
- Should a separate service issue track native Copilot encrypted cross-child support without blocking the fork fix?
