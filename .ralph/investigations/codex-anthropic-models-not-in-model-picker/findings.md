# Anthropic models not appearing in `/model`

## G1 picker + filter

`/model` is a TUI popup over the app-server bootstrap catalog, not a live fetch when the command is typed. The slash dispatcher calls `open_model_popup()` for `SlashCommand::Model` (`codex-rs/tui/src/chatwidget/slash_dispatch.rs:203`-`codex-rs/tui/src/chatwidget/slash_dispatch.rs:205`). `open_model_popup()` reads `self.model_catalog.try_list_models()` and then opens the popup (`codex-rs/tui/src/chatwidget/model_popups.rs:11`-`codex-rs/tui/src/chatwidget/model_popups.rs:30`); `ModelCatalog` is just an in-memory vector clone (`codex-rs/tui/src/model_catalog.rs:9`-`codex-rs/tui/src/model_catalog.rs:16`).

That catalog is loaded at TUI bootstrap by app-server `model/list` with `include_hidden: Some(true)` (`codex-rs/tui/src/app_server_session.rs:237`-`codex-rs/tui/src/app_server_session.rs:263`) and then stored in `App` as `ModelCatalog::new(available_models.clone())` (`codex-rs/tui/src/app.rs:754`-`codex-rs/tui/src/app.rs:795`). App-server `model/list` calls `supported_models(...)` (`codex-rs/app-server/src/request_processors/catalog_processor.rs:141`-`codex-rs/app-server/src/request_processors/catalog_processor.rs:148`), and `supported_models` calls `thread_manager.list_models(RefreshStrategy::OnlineIfUncached)` (`codex-rs/app-server/src/models.rs:12`-`codex-rs/app-server/src/models.rs:22`).

For Copilot, the model manager is backed by `CopilotModelsEndpoint`, whose default base URL is `https://api.githubcopilot.com` (`codex-rs/model-provider/src/copilot.rs:132`-`codex-rs/model-provider/src/copilot.rs:140`). The endpoint fetches `MODELS_PATH = "/models"` and builds `https://api.githubcopilot.com/models` from the base URL plus path (`codex-rs/model-provider/src/copilot_models_endpoint.rs:52`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:56`, `codex-rs/model-provider/src/copilot_models_endpoint.rs:178`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:221`). The manager caches the translated list at `codex_home.join("models_cache.json")` (`codex-rs/models-manager/src/manager.rs:24`-`codex-rs/models-manager/src/manager.rs:25`, `codex-rs/models-manager/src/manager.rs:197`-`codex-rs/models-manager/src/manager.rs:205`).

The exact release filter is not `/responses`-only. It requires:

1. `entry.model_picker_enabled` (`codex-rs/model-provider/src/copilot_models_endpoint.rs:242`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:247`).
2. `capabilities.type == "chat"` or absent (`codex-rs/model-provider/src/copilot_models_endpoint.rs:248`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:255`).
3. `supported_endpoints` contains `/responses`, or, when Anthropic is enabled, contains `/chat/completions` (`codex-rs/model-provider/src/copilot_models_endpoint.rs:256`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:265`).

The header comment still says only `/responses` rows are surfaced (`codex-rs/model-provider/src/copilot_models_endpoint.rs:10`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:13`), but the executable filter has the Anthropic `/chat/completions` branch above.

## G2 feature effects

`Feature::AnthropicModels` is a default-off experimental feature named "Anthropic models" (`codex-rs/features/src/lib.rs:133`-`codex-rs/features/src/lib.rs:136`, `codex-rs/features/src/lib.rs:990`-`codex-rs/features/src/lib.rs:1000`). `--enable-anthropic` is only an alias that pushes `features.anthropic_models=true` into the normal config override path (`codex-rs/cli/src/main.rs:841`-`codex-rs/cli/src/main.rs:845`).

After config resolution, the final feature value is installed into a process-global model-provider gate (`codex-rs/core/src/config/mod.rs:2627`-`codex-rs/core/src/config/mod.rs:2630`). The gate stores and exposes that bit through `install_anthropic_gate()` and `anthropic_models_resolved()` (`codex-rs/model-provider/src/anthropic_gate.rs:35`-`codex-rs/model-provider/src/anthropic_gate.rs:45`).

The feature does change the list path. `CopilotModelsEndpoint::list_models()` reads `anthropic_models_resolved()` before filtering and translating entries (`codex-rs/model-provider/src/copilot_models_endpoint.rs:227`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:233`). With the feature enabled, chat-only Claude rows pass the filter via `has_responses || (anthropic_enabled && has_chat)` (`codex-rs/model-provider/src/copilot_models_endpoint.rs:256`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:265`), and `wire_route_for()` marks chat-only rows as `ModelWireRoute::ChatCompletions` (`codex-rs/model-provider/src/copilot_models_endpoint.rs:267`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:283`). Tests encode this expected behavior for `claude-sonnet-4.6`: hidden when off, admitted and chat-routed when on (`codex-rs/model-provider/src/copilot_models_endpoint.rs:524`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:545`).

There is also a second gate on model-manager reads. The Copilot provider wraps both configured static catalogs and the live OpenAI/Copilot manager in `GatedModelsManager` with `anthropic_models_resolved()` (`codex-rs/model-provider/src/copilot.rs:122`-`codex-rs/model-provider/src/copilot.rs:129`, `codex-rs/model-provider/src/copilot.rs:141`-`codex-rs/model-provider/src/copilot.rs:148`). That wrapper drops Claude/Anthropic slugs and chat-completions routes when disabled (`codex-rs/model-provider/src/copilot/gated_models_manager.rs:31`-`codex-rs/model-provider/src/copilot/gated_models_manager.rs:44`) and filters all catalog read methods used by picker/list/cache surfaces (`codex-rs/model-provider/src/copilot/gated_models_manager.rs:57`-`codex-rs/model-provider/src/copilot/gated_models_manager.rs:78`, `codex-rs/model-provider/src/copilot/gated_models_manager.rs:135`-`codex-rs/model-provider/src/copilot/gated_models_manager.rs:143`). Its tests show off-state `try_list_models()` returns only GPT and on-state preserves `claude-sonnet-4.6` (`codex-rs/model-provider/src/copilot/gated_models_manager.rs:217`-`codex-rs/model-provider/src/copilot/gated_models_manager.rs:255`).

On the request side, the same feature gates routing: `effective_wire_api()` reads `anthropic_models_resolved()` (`codex-rs/core/src/chat_transport.rs:58`-`codex-rs/core/src/chat_transport.rs:65`), and only maps `ModelWireRoute::ChatCompletions` to `WireApi::ChatCompletions` when enabled (`codex-rs/core/src/chat_transport.rs:67`-`codex-rs/core/src/chat_transport.rs:75`). The client dispatches that effective wire API, using the Responses path for `WireApi::Responses` and the Copilot chat-completions transport for `WireApi::ChatCompletions` (`codex-rs/core/src/client.rs:1582`-`codex-rs/core/src/client.rs:1628`).

So this is not a pure wiring gap where the feature only arms request transport. The feature is wired into both list admission and request routing. The bug is that `/model` can reuse a stale post-filter cache generated while the feature was off.

## G3 Claude in response + filter

The code does not add a hard-coded Claude catalog. Claude must be present in the Copilot `/models` response or in `models_cache.json`, because the bundled catalog is merely the initial local model source (`codex-rs/models-manager/src/manager.rs:197`-`codex-rs/models-manager/src/manager.rs:207`) and fetched rows are merged into that list (`codex-rs/models-manager/src/manager.rs:341`-`codex-rs/models-manager/src/manager.rs:352`).

If Copilot returns a Claude row while the feature is on, this release will show it if:

1. `model_picker_enabled` is true.
2. `capabilities.type` is `"chat"` or absent.
3. `supported_endpoints` contains `/chat/completions` or `/responses`.

That is the executable predicate at `codex-rs/model-provider/src/copilot_models_endpoint.rs:242`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:265`. A returned Claude row can still be excluded if any of those fields fails: picker disabled, non-chat type, or no `/chat/completions`/`/responses` endpoint.

Bundled metadata should not be the hiding layer for returned rows. If a returned slug matches bundled metadata, translation clones the bundled `ModelInfo` but forces `visibility = ModelVisibility::List` and applies the row's wire route (`codex-rs/model-provider/src/copilot_models_endpoint.rs:364`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:397`). If a returned slug is not bundled, it is synthesized with `visibility: ModelVisibility::List` and `supported_in_api: true` (`codex-rs/model-provider/src/copilot_models_endpoint.rs:399`-`codex-rs/model-provider/src/copilot_models_endpoint.rs:499`).

This part remains runtime/account-dependent. If, after a forced refetch with the feature enabled, `~/.codex/models_cache.json` still has no Claude/Anthropic rows, then either the operator's Copilot account did not receive Claude rows from `GET /models`, or the raw rows failed one of the three filter fields above.

## G4 config vs picker + cache

`config.toml` natively supports `model = "..."` through `ConfigToml::model` (`codex-rs/config/src/config_toml.rs:135`-`codex-rs/config/src/config_toml.rs:140`), and config resolution uses the CLI/model override or that config field (`codex-rs/core/src/config/mod.rs:3213`-`codex-rs/core/src/config/mod.rs:3216`). But the source does not treat Claude as config-only. The local patch notes explicitly say the Anthropic feature should be the single authority and stale persisted Claude should not keep Claude visible when the feature is off (`docs/implementation/patch-surface.md:51`-`docs/implementation/patch-surface.md:83`).

The TUI actually defends against config-only Claude if the catalog lacks the model. During bootstrap, `bootstrap_default_model()` preserves a configured model unless it is a Claude/Anthropic slug absent from `available_models`; absent Claude falls back to the catalog default (`codex-rs/tui/src/app_server_session.rs:1216`-`codex-rs/tui/src/app_server_session.rs:1246`). `App::run()` re-applies that same check to `config.model` and replaces the in-memory model with the resolved catalog default when needed (`codex-rs/tui/src/app.rs:781`-`codex-rs/tui/src/app.rs:792`). Therefore, setting `model = "claude-..."` is not the intended workaround for a missing picker row in TUI; the row must be in the feature-enabled catalog.

The cache explains why a full restart did not necessarily help. The cache TTL is 300 seconds (`codex-rs/models-manager/src/manager.rs:24`-`codex-rs/models-manager/src/manager.rs:25`). `model/list` uses `RefreshStrategy::OnlineIfUncached` (`codex-rs/app-server/src/models.rs:12`-`codex-rs/app-server/src/models.rs:18`). Under that strategy, `OpenAiModelsManager` tries `try_load_cache()` first and returns without fetching if the cache is fresh (`codex-rs/models-manager/src/manager.rs:281`-`codex-rs/models-manager/src/manager.rs:295`). A fresh cache only checks client version and age (`codex-rs/models-manager/src/cache.rs:30`-`codex-rs/models-manager/src/cache.rs:73`); it does not include the Anthropic feature value. The loaded cache is then applied directly (`codex-rs/models-manager/src/manager.rs:355`-`codex-rs/models-manager/src/manager.rs:379`).

Because `CopilotModelsEndpoint` persists the already-filtered translated list (`codex-rs/models-manager/src/manager.rs:303`-`codex-rs/models-manager/src/manager.rs:310`), a cache created with Anthropic off contains no chat-only Claude rows. Restarting with Anthropic on within the 5-minute TTL can reuse that feature-off cache; the on-state gate cannot re-add rows that were never cached.

## G5 verdict + fix direction

Verdict: **BUG**, specifically a cache invalidation/refresh bug at the model catalog seam. It is not expected config-only behavior, and it is not a missing feature-to-picker wire. The source intends `Feature::AnthropicModels` to affect `/model`: it admits chat-only Claude rows in the Copilot endpoint and stops the gate wrapper from filtering them. But `/model` is backed by the bootstrap `model/list` catalog, and `model/list` can reuse a fresh `models_cache.json` generated with Anthropic disabled.

Minimal fix direction: make the model cache key/metadata include the Anthropic gate state, or bypass/refresh the cache when the resolved Anthropic feature value changes. The lowest-conflict surface is the model-provider/models-manager seam, not TUI: either pass provider-specific cache identity/features into `ModelsCacheManager::load_fresh()`/`persist_cache()`, or make Copilot's `OnlineIfUncached` path miss the cache when `anthropic_models_resolved()` is true and the cache lacks a matching gate marker. This also aligns with the existing TODO to include provider identity in cache eligibility (`codex-rs/models-manager/src/manager.rs:355`-`codex-rs/models-manager/src/manager.rs:363`) and avoids growing `codex-core` unnecessarily (the repo guidance says to resist adding code to `codex-core`, `AGENTS.md:66`-`AGENTS.md:77`).

Operator runtime check:

1. Inspect `%USERPROFILE%\.codex\models_cache.json` for `claude`/`anthropic` and its `fetched_at`. If it was fetched within 300 seconds before/after enabling the feature and has no Claude rows, this bug explains restart-not-helping.
2. Delete or rename `%USERPROFILE%\.codex\models_cache.json` (or wait >5 minutes), restart with `features.anthropic_models = true`, then inspect `/model` and the regenerated cache.
3. If the regenerated cache still has no Claude rows, capture the raw Copilot `GET https://api.githubcopilot.com/models` response using the same Copilot auth headers and inspect Claude entries for `model_picker_enabled`, `capabilities.type`, and `supported_endpoints`. With this release, rows passing the three-field predicate above should appear in `/model`.
