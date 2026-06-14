# Research Brief: Anthropic `/model` stale cache

## Researcher Findings

The committed investigation at `D:\harness-efforts\codexu\.ralph\investigations\codex-anthropic-models-not-in-model-picker\findings.md` still matches current source.

### Cache read/write and freshness eligibility

- `codex-rs\models-manager\src\cache.rs:160-169` serializes `models_cache.json` with `fetched_at`, optional `etag`, optional `client_version`, and `models`; no provider or request-shaping identity is recorded.
- `codex-rs\models-manager\src\cache.rs:30-73` implements `ModelsCacheManager::load_fresh()`. A cache is usable when `client_version` matches and `is_fresh()` is true.
- `codex-rs\models-manager\src\cache.rs:76-92` writes the post-filtered `Vec<ModelInfo>` through `persist_cache()`.
- `codex-rs\models-manager\src\manager.rs:24-25` names the file `models_cache.json` and sets the default TTL to 300 seconds.

### `OnlineIfUncached` load-vs-fetch path

- `codex-rs\models-manager\src\manager.rs:270-300` implements `refresh_available_models()`. `RefreshStrategy::OnlineIfUncached` first calls `try_load_cache()` and returns without fetching on a hit.
- `codex-rs\models-manager\src\manager.rs:303-310` fetches via `endpoint_client.list_models()` and persists the returned list.
- `codex-rs\models-manager\src\manager.rs:355-379` applies a fresh cache directly to the active remote model list and has an existing TODO to include provider identity in cache eligibility.

### Anthropic gate and Copilot model filtering

- `codex-rs\core\src\config\mod.rs:2627-2630` installs the resolved `Feature::AnthropicModels` into the model-provider gate during config resolution.
- `codex-rs\model-provider\src\anthropic_gate.rs:35-45` exposes `install_anthropic_gate()` and `anthropic_models_resolved()`.
- `codex-rs\model-provider\src\copilot.rs:110-148` constructs the Copilot models manager and wraps it in `GatedModelsManager::wrap(..., anthropic_models_resolved())`.
- `codex-rs\model-provider\src\copilot_models_endpoint.rs:227-265` reads `anthropic_models_resolved()` before filtering the raw Copilot `/models` response; `/responses` rows pass in both states, and `/chat/completions` rows pass only when Anthropic is enabled.
- `codex-rs\model-provider\src\copilot\gated_models_manager.rs:31-78` filters Claude/Anthropic slugs and chat-completions routes from all read surfaces when disabled.

### Existing tests to extend

- `codex-rs\models-manager\src\manager_tests.rs:390-420` covers fresh cache reuse without a second fetch.
- `codex-rs\models-manager\src\manager_tests.rs:550-580` covers stale cache refetch.
- `codex-rs\models-manager\src\manager_tests.rs:583-614` covers client-version mismatch refetch.
- `codex-rs\model-provider\src\copilot_models_endpoint.rs:524-587` covers chat-only Claude admission and cache round-trip behavior at the endpoint translation layer.
- `codex-rs\core\tests\suite\models_cache_ttl.rs:45-147` and `codex-rs\app-server\tests\common\models_cache.rs:59-100` provide higher-level cache TTL helpers, but the minimal no-network regression fits best in `manager_tests.rs`.

## Architect Analysis

Recommended approach: **(a) include provider/request-shaping identity in cache eligibility metadata**. This uses the existing cache-miss path as the invalidation mechanism without adding a separate transition detector. Option (b) alone is broader than needed for a restart-time feature transition because the resolved feature gate is installed at startup; option (c) is only true in the sense that an identity mismatch causes the existing `OnlineIfUncached` refetch.

The exact seam should stay in `codex-models-manager`:

1. Add a small serializable cache identity type next to the cache schema.
2. Add an optional, defaulted `ModelsEndpointClient::cache_identity()` method so providers can describe request-shaping dimensions without making the manager depend on `codex-model-provider`.
3. Pass the expected identity into `load_fresh()` and `persist_cache()`.
4. Implement the identity in `CopilotModelsEndpoint` with provider id `copilot` and Anthropic gate state from `anthropic_models_resolved()`.

This is preferred over changing the TUI picker or `GatedModelsManager`: a feature-off cache has already lost chat-only Claude rows, so the on-state wrapper cannot reconstruct them. The cache must miss before the endpoint refilters the raw Copilot `/models` response.

## Codex Research

Not run as a separate Codex review in this member session. The committed read-only source investigation and fresh source re-check above provide the source-of-truth seams.

## Copilot Research

Two read-only Copilot explore agents re-verified the same seams and recommended the cache-identity approach. Key additional points:

- Existing cache compatibility is a risk; legacy cache files with no identity should remain usable for providers that do not supply an expected identity, but should miss when Copilot now supplies one.
- The steady-state test must prove that matching identity still avoids refetching within TTL.
- The new regression should use the existing mocked endpoint/fetch-count harness rather than the network.

## Consolidated File List

### Files to modify

- `codex\external\repos\codex-patched\codex-rs\models-manager\src\cache.rs`
- `codex\external\repos\codex-patched\codex-rs\models-manager\src\manager.rs`
- `codex\external\repos\codex-patched\codex-rs\models-manager\src\manager_tests.rs`
- `codex\external\repos\codex-patched\codex-rs\model-provider\src\copilot_models_endpoint.rs`
- `codex\docs\implementation\patch-surface.md`

### Files to avoid changing

- `codex\external\repos\codex-patched\codex-rs\tui\src\*` picker code
- `codex\external\repos\codex-patched\codex-rs\core\src\chat_transport.rs`
- `codex\external\repos\codex-patched\codex-rs\core\src\client.rs`

### Verification targets

- `codex-models-manager` unit tests for cache identity miss/hit.
- `codex-model-provider` unit tests for the Copilot endpoint identity and existing Anthropic filter guardrails.
- `codex-core` check because `/model` reaches the app-server/model-manager path during bootstrap.
