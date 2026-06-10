# Stories Outline: Gate Anthropic/Claude transport behind an opt-in (default OFF)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Recommended execution: SERIAL (single interlocking codex-submodule change).*

## US-001: Opt-in gate helper + launcher config/env plumbing
**Description:** As a fork maintainer, I want a single process-wide gate resolver and a launcher config field so Anthropic support is opt-in (default OFF) via either an env var or a persistent flag.
**Acceptance Criteria:**
- [ ] New `codex-rs-overlay/codex-copilot/src/gate.rs` exposes `anthropic_models_enabled() -> bool`, reading `CODEX_ENABLE_ANTHROPIC` once via `OnceLock<bool>`; default `false`; accepts `on`/`1`/`true`/`yes` (case-insensitive) as enabled. Exported from `codex-copilot/src/lib.rs`.
- [ ] An env-free inner fn (e.g. `anthropic_gate_from_raw(Option<&str>) -> bool`) is unit-tested for default-off + each enabled spelling + disabled (no process-env mutation in tests).
- [ ] `SandboxConfig` in `codex-rs-overlay/codex-copilot-launcher/src/config.rs` gains `enable_anthropic: Option<bool>`, parsed from `~/.codex-copilot/config.toml`.
- [ ] Launcher `src/main.rs`: when `enable_anthropic == Some(true|false)` set `CODEX_ENABLE_ANTHROPIC=on|off`; when `None` do NOT write the env var (leave any caller-provided value intact). Tested both ways.
- [ ] Typecheck passes (`cargo check --workspace`); `just fmt`/`just fix -p codex-copilot -p codex-copilot-launcher` clean; `just test -p codex-copilot -p codex-copilot-launcher` passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Gate the live `/models` filter + `wire_route_for`
**Description:** As a default-off user, I want the live `/models` filter to drop chat-only Claude rows and never tag them to the chat wire unless opted in.
**Acceptance Criteria:**
- [ ] `model-provider/src/copilot_models_endpoint.rs`: the production caller (`is_chat_responses_picker_entry`) passes `anthropic_models_enabled()` instead of `CHAT_TRANSPORT_AVAILABLE`; the `is_picker_entry_with_transport(entry, bool)` param shape is preserved for env-free tests.
- [ ] `wire_route_for` is gated: when off it returns `ModelWireRoute::ProviderDefault` (no chat hint written into `translate_entry`/`synthesize_from_capabilities`); when on, unchanged.
- [ ] Extended `chat_transport_tests`: off => chat-only Claude row dropped + ProviderDefault; on => admitted + ChatCompletions. A GPT `/responses` row is admitted + ProviderDefault in both states.
- [ ] Literal bool callsites carry `/*anthropic_enabled*/` comments (argument-comment lint).
- [ ] Typecheck + `just test -p codex-model-provider` passes.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Cache-safe `GatedModelsManager` decorator
**Description:** As a default-off user, I want a stale `models_cache.json` (or config-supplied catalog) to never surface Claude rows in `/model` or sub-agent model validation.
**Acceptance Criteria:**
- [ ] New fork-local `GatedModelsManager` decorator (in `model-provider`) implements the `ModelsManager`/`SharedModelsManager` trait, delegates to an inner manager, and when off drops every `ModelInfo` with `wire_route == ModelWireRoute::ChatCompletions` from ALL remote-model read methods: `list_models`, `try_list_models`, `raw_model_catalog`, `get_remote_models`, `try_get_remote_models`; `get_model_info` for a Claude slug does not resolve a ChatCompletions hint.
- [ ] `copilot.rs::models_manager()` wraps the returned `SharedModelsManager` with the decorator in BOTH branches (the `OpenAiModelsManager` path AND the `StaticModelsManager`/`config_model_catalog` path).
- [ ] Upstream `models-manager` is left untouched (no SANDBOX PATCH there).
- [ ] Colocated tests: a cached/config `ChatCompletions` `ModelInfo` is excluded from every read method when off, included when on.
- [ ] Typecheck + `just test -p codex-model-provider` passes.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-004: Gate the `effective_wire_api` routing seam
**Description:** As a default-off user, I want a pinned/inherited/stale-cached Claude model to never reach the chat transport.
**Acceptance Criteria:**
- [ ] `core/src/chat_transport.rs::effective_wire_api` takes the resolved gate; when off it maps `ModelWireRoute::ChatCompletions -> provider_wire` (Responses for Copilot); when on, `-> WireApi::ChatCompletions`. `ProviderDefault` is unchanged in both states.
- [ ] `core/src/client.rs` (~:1585) passes `anthropic_models_enabled()` to `effective_wire_api`.
- [ ] Extended `chat_transport.rs` `mod tests`: off => `effective_wire_api(ChatCompletions, Responses, off) == Responses`; on => `ChatCompletions`. GPT (`ProviderDefault`) => `Responses` in both.
- [ ] Literal bool callsites carry `/*anthropic_enabled*/` comments.
- [ ] Typecheck + `just test -p codex-core` passes.
**Dependencies:** US-001
**Estimated complexity:** small

## US-005: Sub-agent gating acceptance tests (v1 + v2)
**Description:** As a default-off user, I want spawn_agent children (v1 and v2) unable to use Claude, whether explicitly requested or inherited.
**Acceptance Criteria:**
- [ ] Tests in `core/src/tools/handlers/multi_agents_tests.rs`: with gate off, a v1 (`multi_agent_v1.spawn_agent`) AND a v2 (`spawn_agent`) child requesting a Claude model via the explicit `model` param is rejected with "Unknown model ... for spawn_agent" (because the gated `list_models`/`available_models` excludes it).
- [ ] Inherited path: a child inheriting a pinned Claude `config.model` resolves through `effective_wire_api(ChatCompletions, Responses, /*off*/) == Responses` and issues NO `/chat/completions` request (the `stream` dispatch never enters the chat arm).
- [ ] With gate on, a child may select/use a Claude model.
- [ ] If a production gap surfaces (e.g. a child error message), the minimal fix lands here or in US-004 (no scope creep otherwise).
- [ ] Typecheck + `just test -p codex-core` passes.
**Dependencies:** US-002, US-003, US-004
**Estimated complexity:** medium

## US-006: `/model` picker test (both states) + GPT `/responses`-unchanged test
**Description:** As a default-off user, I want Claude absent from the `/model` picker and GPT `/responses` provably unaffected.
**Acceptance Criteria:**
- [ ] TUI test (building on `tui/src/chatwidget/tests/popups_and_settings.rs` `model_picker_hides_show_in_picker_false_models_from_cache`): with gate off, the `/model` picker (reading `try_list_models`) lists no Claude rows; with gate on, Claude rows appear/are selectable.
- [ ] GPT-unchanged test: a GPT row is admitted identically in both states, carries `wire_route==ProviderDefault`, and `effective_wire_api(ProviderDefault, Responses, on|off) == Responses` in both; where an existing request-construction test exists, the serialized `/responses` body for a GPT turn is identical across gate states.
- [ ] Typecheck + `just test -p codex-tui` (and `-p codex-core` if the GPT test lives there) passes.
**Dependencies:** US-002, US-003, US-004
**Estimated complexity:** medium

## US-007: patch-surface invariants + replant + doc-drift fix
**Description:** As a fork maintainer, I want the rebase ledger to capture the opt-in gate so it survives upstream rebases.
**Acceptance Criteria:**
- [ ] `codex/docs/implementation/patch-surface.md` §14: invariant 34 (filter guardrail) + invariant 35 (routing seam) updated to reflect the gate (default-off); a NEW invariant added: "Anthropic/Claude transport is opt-in default-off across all four surfaces (live filter, gated models-manager, routing, sub-agents); GPT `/responses` unchanged in both states", each with its enforcing test/guard.
- [ ] §15 replant note added for the gate (overlay helper + launcher field + the three gate points), with `// SANDBOX PATCH:` markers on every upstream-canonical edited line.
- [ ] The drifted routing-test path noted in review (docs referenced a path that moved to `core/src/chat_transport.rs`) is corrected.
- [ ] `scripts/audit_network_calls.sh` + `scripts/audit_invariants.sh` clean (no new egress host/path).
**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006
**Estimated complexity:** small
