---
overviewTaskId: codex-v2-copilot-encrypted-subagent-handoff
uiUxJudgment: not-required
---

## Direction
D-001 — Provider-capability-aware plaintext V2 handoff with exact targeted wait. Make V2 message encoding truthful at the native schema/communication boundary for providers that cannot decrypt cross-child tool arguments, while independently making waits deterministic for an exact named task.

## Goal
Codex V2 subagents hosted through Copilot receive the delegated task as readable input, preserve the requested child model and reasoning effort, and return meaningful terminal output. A parent can wait for an exact V2 `task_name` without missing a child that completed before subscription. OpenAI and other encryption-capable providers retain encrypted V2 behavior, V1 remains unchanged, and the fix ships through a published Codex fork release proven by the installed Ralph 5.64 dogfood.

## Scope
### In Scope
- Add a provider capability (or one documented Copilot predicate for the smallest first release) that controls encrypted V2 tool-message support.
- Generate truthful Copilot V2 schemas and communication objects for `spawn_agent`, `send_message`, and `followup_task`: no `encrypted` marker and no plaintext stored under `encrypted_content`.
- Add an optional exact `task_name` target to V2 `wait_agent`; resolve the target, subscribe to its status watch first, inspect the receiver's current value, return immediately when already final, otherwise await that same receiver alongside user steering.
- Preserve omitted-target V2 semantics, V1 targetful behavior, and non-Copilot encrypted V2 behavior.
- Register every upstream-canonical fork edit with `// SANDBOX PATCH:` markers, `codex/docs/implementation/patch-surface.md` section 14 invariant/test coverage, and section 15 replant guidance.
- Run focused schema/encoding/wait/core tests and `cargo check --workspace`, then publish `0.141.0-copilot-api.4` through `codex/.claude/commands/publish-sandbox-patch.md`.
- Rerun the exact installed Ralph 5.64 dogfood using the published `.4` binary and retain raw parent/child evidence.

### Out of Scope
- Client-side decryption: the fork has neither the plaintext nor a key.
- Late generic transport rewrites in `core/src/client.rs` or `codex-api` that relabel plaintext as encrypted.
- Changing targetless wait to wake on any historical completion; stale open agents would create false wakes and loops.
- Treating `Completed(None)` as globally invalid. It remains a valid generic terminal state, but fails acceptance for a non-empty delegated canary.
- Silent V2-to-V1 emulation. V1 is an explicit, temporary, fail-closed rollback only.
- Reconstructing pre-`.4` ciphertext-only rollouts; affected work must be rerun or respawned from its original task source.

## Criteria
- Copilot V2 schema tests prove `spawn_agent`, `send_message`, and `followup_task` omit encrypted message annotations; encryption-capable providers retain them.
- Encoding tests prove Copilot emits `agent_message/input_text`, encryption-capable providers emit `encrypted_content`, and plaintext is never persisted under the encrypted field.
- A Copilot-ID integration test delegates a unique nonsecret canary with exact `gpt-5.6-sol`/`xhigh` routing and observes meaningful `Completed(Some(canary))` output.
- Exact-task wait tests cover a target already final before the call, completion racing between target resolution/subscription/current-value inspection, completion after the initial read, unrelated prior completions, user steering, timeout, and unchanged omitted-target behavior.
- V1 targetful tests and non-Copilot encrypted V2 wire tests remain green.
- Targeted crate tests and `cargo check --workspace` pass under the documented frozen iteration profile.
- The `.4` release follows the patched-submodule commit/tag, wrapper gitlink/tag, bundle publication, install, and launcher-smoke path in `codex/.claude/commands/publish-sandbox-patch.md`.
- Installed-host dogfood proves all four named child rollouts (`plan_researcher`, `plan_drafter`, `plan_initial_review`, and `plan_review_synthesis`) use Copilot with `gpt-5.6-sol`/`xhigh`, receive readable delegated tasks, return non-null meaningful output, and avoid 600000-ms wait timeouts; the separate outcome assertion requires all four expected Ralph role artifacts.

## Context
The raw failure separates two defects. The parent rollout spawned both children with exact `gpt-5.6-sol`/`xhigh`; both child rollouts retained that route but received only encrypted inter-agent content and completed in under one second without a final message. Current V2 source marks message schemas encrypted and forwards the resulting opaque value through `InterAgentCommunication::new_encrypted` without a decrypt path. The parent successfully consumed plaintext V2 completion notifications, disproving a blanket V2-message incompatibility.

The wait timeout is independent: each completion was already present in parent history before targetless wait began. An exact named wait can safely subscribe to the task's status watch before inspecting its current value; targetless “any completion” behavior cannot. `Completed(None)` describes what happened rather than causing it.

Prefer the smallest changes at existing upstream-canonical seams: provider capability/predicate, schema generation, shared V2 communication construction, and V2 wait spec/handler. Avoid broad protocol or transport rewrites unless a failing probe proves they are necessary. The decisive reference files for planning are:
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/`
- `codex/external/repos/codex-patched/codex-rs/model-provider-info/src/lib.rs`
- `codex/external/repos/codex-patched/codex-rs/core/tests/suite/subagent_notifications.rs`
- `codex/docs/implementation/patch-surface.md`
- `codex/.claude/commands/publish-sandbox-patch.md`

Open decisions for planning:
1. Is plaintext delegated-task visibility acceptable for Copilot? If encryption is non-negotiable, D-002 (a real Copilot service capability) becomes the primary direction.
2. Should `.4` introduce a general provider capability immediately, or use the existing reserved Copilot predicate and generalize later?
3. Keep Ralph 5.64 blocked until published `.4` acceptance, or allow only the explicit V1 rollback as an interim containment path?
