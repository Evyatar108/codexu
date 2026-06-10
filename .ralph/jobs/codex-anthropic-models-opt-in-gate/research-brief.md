# Research Brief: codex-anthropic-models-opt-in-gate

## Researcher Findings (explore agent, source-cited)

### 1. /models filter + wire-route tagging
`model-provider/src/copilot_models_endpoint.rs`
- `:53-62` `CHAT_TRANSPORT_AVAILABLE: bool = true` (the existing hidden-until-transport guardrail const)
- `:213-241` `is_chat_responses_picker_entry(entry)` -> `is_picker_entry_with_transport(entry, CHAT_TRANSPORT_AVAILABLE)`; admit = `has_responses || (chat_transport_available && has_chat)`
- `:245-259` `wire_route_for(entry)` -> `ChatCompletions` when `has_chat && !has_responses`, else `ProviderDefault`
- `:261-276` `translate_entry`, `:278-347` `synthesize_from_capabilities` (tag `info.wire_route`)
- `:361-420` `#[cfg(test)] mod chat_transport_tests`: `chat_only_row_hidden_until_transport_available` (already PARAMETRIZES the bool: `is_picker_entry_with_transport(&row, false/true)`), `wire_route_survives_models_cache_round_trip`

### 2. Routing seam
- `core/src/chat_transport.rs:51-60` `effective_wire_api(route, provider_wire)` (maps `ChatCompletions->WireApi::ChatCompletions`, else provider_wire)
- `core/src/chat_transport.rs:277-312` `#[cfg(test)] mod tests`: `routing_maps_hint_to_effective_wire`, `usage_maps_to_token_usage`
- `core/src/client.rs:1585` `effective_wire_api(...)` call; `:1627-1646` `WireApi::ChatCompletions =>` dispatch arm -> `stream_chat_completions(...)`

### 3. /model picker chain
- `tui/src/chatwidget/model_popups.rs:20-30` `self.model_catalog.try_list_models()`; `:72-77` picker filters `preset.show_in_picker`
- `tui/src/model_catalog.rs:5-16` `ModelCatalog` stores `Vec<ModelPreset>`
- `tui/src/app.rs:756,782` `available_models = bootstrap.available_models`; `ModelCatalog::new(available_models.clone())`
- Existing test: `tui/src/chatwidget/tests/popups_and_settings.rs:2337` `model_picker_hides_show_in_picker_false_models_from_cache`
- => /model is populated from the same models-manager catalog; gating the catalog removes Claude from /model transitively.

### 4. Sub-agent model resolution (v1 + v2 share the seam)
- `core/src/tools/handlers/multi_agents_common.rs:290-301` `reject_full_fork_spawn_overrides` (full-history fork rejects model/effort/agent_type override)
- `:339-387` `apply_requested_spawn_agent_model_overrides`; `available_models` from `session.services.models_manager.list_models(RefreshStrategy::Offline)` at `:351-355`
- `:445-463` `find_spawn_agent_model_name` rejection: `RespondToModel("Unknown model `{requested_model}` for spawn_agent. Available models: {available}")`
- Call sites: `multi_agents/spawn.rs:98-111` (v1), `multi_agents_v2/spawn.rs:97-110` (v2)
- Child inheritance: `build_agent_shared_config` sets `config.model = Some(turn.model_info.slug.clone())`
- Existing tests in `multi_agents_tests.rs`: `spawn_agent_fork_context_rejects_child_model_overrides`, `multi_agent_v2_spawn_defaults_to_full_fork_and_rejects_child_model_overrides`, `spawn_agent_service_tier_override_validates_the_effective_child_model`, `spawn_agent_errors_when_manager_dropped`, `spawn_agent_rejects_from_subagent_context`, `multi_agent_v2_spawn_agent_rejects_from_subagent_context`

### 5. Mechanism precedent (launcher config -> env var)
- `codex-rs-overlay/codex-copilot-launcher/src/config.rs:3-6,18-23,74-113` `SandboxConfig.style_user_messages` field + `provider_config_flags()`; `-c features.remote_control=false` at `:84`
- `codex-rs-overlay/codex-copilot-launcher/src/main.rs:93-112` sets `std::env::set_var("CODEX_TUI_USER_MESSAGE_STYLE", value)` at `:111`
- `tui/src/style.rs:125-138` `user_message_styling_enabled()` caches the env read in `OnceLock<bool>`

### 6. Overlay crate `codex-rs-overlay/codex-copilot/` (proposed gate-helper home)
- Files: `auth.rs`, `chat_completions.rs`, `header_source.rs`, `lib.rs`, `paths.rs`, `payload.rs`
- `lib.rs:1-16` exports `CopilotAuth`, `ChatSseParser`, `ChatStreamEvent`, `ChatUsage`, `send_chat_request`, `CopilotHeaderSource`, `ChatBuildError`, `ChatRequestBody`, `build_chat_request_body`

### 7. Feature/config conventions
- `features/src/lib.rs:75-262` `Feature` enum; `:575-583` `feature_for_key()`; `:597-608` `FeaturesToml`; `:684-703` `FeatureToml<T>`. **No env-var override path for features** (TOML/CLI only) — so a Feature flag would NOT reach the model-provider crate without plumbing.
- `core/src/config/mod.rs:956-963` ConfigToml `features: ManagedFeatures` etc. A new ConfigToml field requires `just write-config-schema`.

### 8. US-001 spike + contract tests
- Spike (present in codexu primary checkout): `.ralph/jobs/codex-anthropic-models-support/spike/{spike-report.md,spike-summary.json,spike.js,mapped/flow1-5.events.json,raw/flow1-5.sse.txt}`
- Overlay contract tests: `codex-rs-overlay/codex-copilot/src/chat_completions.rs` (parser/stream tests); `codex-rs-overlay/codex-invariant-tests/tests/*.rs`
- Core e2e: `core/tests/suite/chat_completions.rs` (per patch-surface inv 37)

## Architect Analysis (explore agent)
- **Mechanism recommendation: Option 1 (env var read once in an overlay OnceLock helper, passed as a plain bool to seams).** Least upstream conflict; `model-provider` has NO Config/FeatureSet surface (`CopilotModelsEndpoint::new(base_url, auth)` only) and `core::client::stream` has only `model_info`+`provider_wire`. Feature-flag (Option 2) and config.toml field (Option 3) both require threading config through models-manager/provider/client = much larger conflict surface; Option 3 also needs `just write-config-schema`.
- **Surfaces:** (a) replace `CHAT_TRANSPORT_AVAILABLE` in the filter; (b) gate BOTH `wire_route_for` (source hint) AND `effective_wire_api` (hard defense vs stale cache / manual pin); (c) transitive via the catalog (no separate edit); (d) explicit override closed by filtered `available_models`, inherited closed by routing gate.
- **Conflict classification:** new overlay file (zero conflict) for the helper; 1-3 line seam edits in `copilot_models_endpoint.rs` + `chat_transport.rs`; no broad inline edits. Modifies D-001 invariants 34 (filter guardrail) + 35 (routing); adds a new opt-in-default-off invariant.
- **Risks:** stale `models_cache.json` ChatCompletions hint; config.model-pinned Claude; parent/child env consistency (resolve once, pass bool); test env-mutation (pass bool from above); GPT /responses unaffected (filter only touches chat-only rows).

## Copilot Analysis (copilot-exec)
- Confirms all seams. Adds the key refinement: **a cache-safe catalog/list-layer filter** — filtering only the LIVE `/models` is insufficient because a stale `models_cache.json` (written during an ON session) can preserve `wire_route==ChatCompletions` rows. Filter `ModelInfo` with `wire_route==ChatCompletions` when off at the models-manager output layer (wired in `copilot.rs::models_manager`), covering `list_models` (so `/model` AND spawn `available_models` are clean). Then routing gate in `effective_wire_api` is the final fail-closed defense.
- Confirms `build_agent_shared_config` child inheritance, launcher precedent, and that launcher config (`~/.codex-copilot/config.toml`) is SEPARATE from ConfigToml so `just write-config-schema` is NOT needed for a launcher-only field.
- Notes doc drift: patch-surface references a routing test path that has drifted to `core/src/chat_transport.rs`.

## Codex Analysis (codex-exec)
- Not run: codex-exec hung on Windows (~10 min, no output) and was stopped. Findings fully covered by the three other sources + direct source tracing.

## Consolidated File List
### Files to modify (production)
- `codex-rs-overlay/codex-copilot/src/lib.rs` (+ new `gate.rs`) — env gate helper
- `codex-rs-overlay/codex-copilot-launcher/src/config.rs` — `enable_anthropic` config field
- `codex-rs-overlay/codex-copilot-launcher/src/main.rs` — set `CODEX_ENABLE_ANTHROPIC` env
- `model-provider/src/copilot_models_endpoint.rs` — gate filter + `wire_route_for`
- `model-provider/src/copilot.rs` — wire the cache-safe list filter into `models_manager`
- new `model-provider/src/<copilot_models_filter>.rs` — cache-safe `wire_route==ChatCompletions` drop when off
- `core/src/chat_transport.rs` — gate `effective_wire_api`
- `core/src/client.rs:1585` — pass gate to `effective_wire_api`
### Test files
- `model-provider/src/copilot_models_endpoint.rs` (`chat_transport_tests`)
- `core/src/chat_transport.rs` (`mod tests`)
- `core/src/tools/handlers/multi_agents_tests.rs` (v1+v2 spawn override)
- `tui/src/chatwidget/tests/popups_and_settings.rs` (/model picker)
- (cache-safe filter unit test, colocated)
### Docs
- `codex/docs/implementation/patch-surface.md` §14 inv 34/35 + new invariant + §15 replant
