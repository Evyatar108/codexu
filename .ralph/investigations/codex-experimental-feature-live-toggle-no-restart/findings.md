# Codex experimental feature live-toggle investigation

Read-only investigation for `investigate-feature-live-toggle` on 2026-06-14.

## Read-only guard snapshots

Commands captured at start and end:

```powershell
git -C 'D:\harness-efforts\codexu' status --porcelain
git -C 'D:\harness-efforts\codexu\codex' status --porcelain
git -C 'D:\harness-efforts\codexu\codex\external\repos\codex-patched' status --porcelain
```

### START snapshot

The shared codexu checkout was already dirty before this investigation. The
root `git status --porcelain` output contained 724 entries before the `codex`
separator; the first lines were generated/ralph/task state plus the modified
`codex` gitlink:

```text
 M .ralph-overview/generated/activity.jsonl
 M .ralph-overview/generated/dependency-graph.json
 M .ralph-overview/generated/overview.html
 M .ralph-overview/generated/ralph-state.js
 M .ralph-overview/generated/ralph-state.json
 M .ralph-overview/generated/recommendations.json
 M .ralph-overview/generated/snapshot.json
 M .ralph/brainstorms/crews-roles-and-direct-operator-channel/selected-direction.md
 M .ralph/jobs/codex-nonblocking-bg-completion-surfacing/plan.md
 M codex
 M tasks/INDEX.md
?? .ralph-overview/generated/active-tasks.json
?? .ralph-overview/generated/summary-projection.json
?? .ralph/brainstorms/codex-fork-install-script/selected-direction.md
?? .ralph/brainstorms/codex-member-skill-agent-subagent-fanout-d002/
...
?? tasks/codex-r2-iex-installer-auto-publish/
?? tasks/codex-revert-disable-paste-burst-default/
?? tasks/overview-parallel-ready-excludes-merged-lifecycle/
```

The nested repositories were:

```text
--- codex ---
?? .crews/
?? .ralph-overview/
?? .worktrees/
?? external/repos/codex-anthropic-models-opt-in-gate-worktree/
?? tasks/INDEX.md
--- codex-patched ---
?? .worktrees/
```

### END snapshot

The full root status remained large because of pre-existing unrelated
workspace dirt. The end check filtered the root output for the changed submodule
and this investigation path; it showed the pre-existing modified `codex`
gitlink plus the single allowed deliverable directory:

```text
 M codex
?? .ralph/investigations/codex-experimental-feature-live-toggle-no-restart/findings.md
```

The nested repository snapshots remained unchanged:

```text
--- codex ---
?? .crews/
?? .ralph-overview/
?? .worktrees/
?? external/repos/codex-anthropic-models-opt-in-gate-worktree/
?? tasks/INDEX.md
--- codex-patched ---
?? .worktrees/
```

## Model catalog lifecycle

Verdict: `/model` is bootstrap-frozen today. Opening `/model` does not call the
models manager or the Copilot `/models` endpoint; it clones a TUI-owned
`ModelCatalog` that was populated during TUI bootstrap.

```txt
User enters /model
|
+- ChatWidget slash dispatch
|  `- SlashCommand::Model -> self.open_model_popup()
|     codex-rs\tui\src\chatwidget\slash_dispatch.rs:203-205
|
+- ChatWidget::open_model_popup()
|  `- self.model_catalog.try_list_models()
|     codex-rs\tui\src\chatwidget\model_popups.rs:11-30
|
+- ModelCatalog::try_list_models()
|  `- Ok(self.models.clone())
|     type ModelCatalog { models: Vec<ModelPreset> }
|     codex-rs\tui\src\model_catalog.rs:4-16
|
`- source of that Vec<ModelPreset>
   +- AppServerSession::bootstrap(config)
   |  `- ClientRequest::ModelList { include_hidden: Some(true) }
   |     codex-rs\tui\src\app_server_session.rs:237-263
   +- App::run()
   |  `- Arc::new(ModelCatalog::new(available_models.clone()))
   |     codex-rs\tui\src\app.rs:754-795
   +- app-server catalog processor
   |  `- model/list -> CatalogRequestProcessor::list_models(...)
   |     codex-rs\app-server\src\request_processors\catalog_processor.rs:141-148
   +- app-server supported_models(...)
   |  `- thread_manager.list_models(RefreshStrategy::OnlineIfUncached)
   |     codex-rs\app-server\src\models.rs:12-22
   `- OpenAiModelsManager
      +- OnlineIfUncached: try_load_cache() first, fetch only on miss
      |  codex-rs\models-manager\src\manager.rs:297-305
      +- cache identity is evaluated in try_load_cache()
      |  codex-rs\models-manager\src\manager.rs:366-383
      `- cache load rejects version/identity/TTL mismatches
         codex-rs\models-manager\src\cache.rs:31-95
```

So the prior finding is correct but incomplete for live-toggle purposes:
`/model` reads the TUI bootstrap catalog, not a live fetch; additionally, the
app-server-side models manager itself is created once when `ThreadManager` is
created (`build_models_manager(config, auth_manager.clone())` at
`codex-rs\core\src\thread_manager.rs:219-228` and stored at
`codex-rs\core\src\thread_manager.rs:270-275`).

## `/experimental` toggle runtime effect

The picker itself only mutates row-local UI state until the popup closes:

```txt
User opens /experimental
|
+- ChatWidget::open_experimental_popup()
|  +- FEATURES.iter()
|  +- spec.stage.experimental_menu_name()? / description()?
|  +- enabled: self.config.features.enabled(spec.id)
|  `- ExperimentalFeaturesView::new(...)
|     codex-rs\tui\src\chatwidget\settings_popups.rs:248-268
|
+- User presses Space
|  `- ExperimentalFeaturesView::toggle_selected()
|     `- item.enabled = !item.enabled
|        codex-rs\tui\src\bottom_pane\experimental_features_view.rs:151-159
|
`- User accepts/cancels popup
   `- ExperimentalFeaturesView::on_ctrl_c()
      `- AppEvent::UpdateFeatureFlags { updates: Vec<(Feature, bool)> }
         codex-rs\tui\src\bottom_pane\experimental_features_view.rs:193-203
```

The app event persists the feature update first, then applies a limited set of
runtime/UI patches:

```txt
AppEvent::UpdateFeatureFlags { updates }
|
+- App::update_feature_flags(app_server, updates)
|  +- next_config.features.set_enabled(feature, enabled)
|  |  codex-rs\tui\src\app\config_persistence.rs:361-376
|  +- config_edits.push(build_feature_enabled_edit(feature_key, effective_enabled))
|  |  codex-rs\tui\src\app\config_persistence.rs:443-446
|  +- write_config_batch(..., reload_user_config: true)
|  |  codex-rs\tui\src\app\config_persistence.rs:449-465
|  |  codex-rs\tui\src\config_update.rs:155-170
|  +- self.config = next_config
|  |  codex-rs\tui\src\app\config_persistence.rs:498-500
|  `- self.chat_widget.set_feature_enabled(feature, effective_enabled)
|     codex-rs\tui\src\app\config_persistence.rs:504-507
|
+- App-server config write side effect
|  +- ConfigRequestProcessor::batch_write_inner(...)
|  |  `- reload_user_config() when reload_user_config is true
|  |     codex-rs\app-server\src\request_processors\config_processor.rs:292-312
|  `- reload_user_config()
|     +- load_latest_config()
|     `- thread.refresh_runtime_config(next_config.clone()).await
|        codex-rs\app-server\src\request_processors\config_processor.rs:361-378
|
`- Core existing-session refresh boundary
   +- CodexThread::refresh_runtime_config(...)
   |  "Thread-scoped layers and session-static settings remain unchanged."
   |  codex-rs\core\src\codex_thread.rs:531-535
   `- Session::reload_user_config_layer() comment:
      "Derived config fields such as feature gates ... remain session-static."
      codex-rs\core\src\session\mod.rs:1568-1575
```

`ChatWidget::set_feature_enabled()` is a set of bespoke live handlers, not a
generic hot-reload framework. It updates config and handles features such as
realtime, fast mode, personality, plugins, goals, mentions v2, prevent sleep,
and Windows sandbox UI (`codex-rs\tui\src\chatwidget\settings.rs:70-132`).
Notably, it does not currently handle `AnthropicModels`,
`LegacyPasteBurstHeuristic`, or `UserMessageStyling`.

## Anthropic gate capture point

The Anthropic bit has both live-readable and snapshotted/captured surfaces.

Live-readable:

- `install_anthropic_gate(enabled)` stores an `AtomicBool`, and
  `anthropic_models_resolved()` loads it (`codex-rs\model-provider\src\anthropic_gate.rs:1-45`).
- Config build installs the final resolved feature bit into that gate
  (`codex-rs\core\src\config\mod.rs:2627-2630`).
- `CopilotModelsEndpoint::cache_identity()` reads
  `anthropic_models_resolved()` and adds
  `request_shape["anthropic_models"]` to the model cache identity
  (`codex-rs\model-provider\src\copilot_models_endpoint.rs:175-183`).
- `CopilotModelsEndpoint::list_models()` reads
  `anthropic_models_resolved()` immediately before filtering/translation
  (`codex-rs\model-provider\src\copilot_models_endpoint.rs:238-244`), and
  admits `/chat/completions` rows only when the argument is true
  (`codex-rs\model-provider\src\copilot_models_endpoint.rs:253-276`).
- Request routing also reads the atomic gate on use via
  `effective_wire_api(...)` (`codex-rs\core\src\chat_transport.rs:58-75`, per
  the prior investigation).

Captured/snapshotted:

- `CopilotModelProvider::models_manager(...)` wraps both static and live
  managers with `GatedModelsManager::wrap(..., anthropic_models_resolved())`
  (`codex-rs\model-provider\src\copilot.rs:122-148`).
- `GatedModelsManager` stores `anthropic_enabled: bool` and uses that captured
  bool for every `list_models`, `raw_model_catalog`, `get_remote_models`, and
  `try_list_models` read (`codex-rs\model-provider\src\copilot\gated_models_manager.rs:17-29`,
  `codex-rs\model-provider\src\copilot\gated_models_manager.rs:31-44`,
  `codex-rs\model-provider\src\copilot\gated_models_manager.rs:57-90`).
- `ThreadManager` builds and stores one shared models manager at construction
  (`codex-rs\core\src\thread_manager.rs:219-228`,
  `codex-rs\core\src\thread_manager.rs:270-275`).
- `Session` stores `features: ManagedFeatures` with the comment "invariant for
  the lifetime of the session" (`codex-rs\core\src\session\session.rs:30-32`)
  and initializes it from `config.features.clone()`
  (`codex-rs\core\src\session\session.rs:1074-1084`).
- TUI `/model` stores a separate `Arc<ModelCatalog>` created at bootstrap
  (`codex-rs\tui\src\app.rs:480-487`,
  `codex-rs\tui\src\app.rs:754-795`; `ChatWidget` holds its own
  `Arc<ModelCatalog>` at `codex-rs\tui\src\chatwidget.rs:486`).

Therefore: after the c7cf5413-style cache identity fix, the endpoint side is
ready for gate-aware refetches, but simply re-calling
`thread_manager.list_models(OnlineIfUncached)` on the existing manager is not
sufficient if the manager was constructed while Anthropic was off. The endpoint
would see the new identity, but the captured `GatedModelsManager` would still
filter Claude/chat-completions rows out.

## Anthropic model gate live-refresh feasibility

Feasible: yes, but it is not live today.

The minimal reliable hook is:

```txt
/experimental accepts Feature::AnthropicModels change
|
+- App::update_feature_flags(...)
|  `- after config write succeeds and app-server reload_user_config() has
|     rebuilt Config, the process-global anthropic gate has been reinstalled
|     by ConfigBuilder (core\src\config\mod.rs:2627-2630)
|
+- Refresh/rebuild model manager gate
|  Option A (narrowest model-provider patch):
|    make GatedModelsManager read anthropic_models_resolved() per filter call
|    instead of capturing bool at construction.
|  Option B (larger app-server/core patch):
|    rebuild/swap ThreadManager.models_manager after feature reload.
|
+- Re-run app-server model/list
|  `- ClientRequest::ModelList { include_hidden: Some(true) }
|     same path as bootstrap: tui\src\app_server_session.rs:237-263
|
+- Replace TUI catalog
|  +- App.model_catalog = Arc::new(ModelCatalog::new(models.clone()))
|  +- ChatWidget.model_catalog = same Arc
|  +- sync model-dependent surfaces that read model_catalog
|  `- request redraw / optionally reopen /model if the picker is open
|
`- Result
   +- enable: identity false->true misses cache and fetches/filter-admits Claude
   +- disable: identity true->false misses cache and/or dynamic gate filters Claude
```

Implementation surface:

1. `model-provider/src/copilot/gated_models_manager.rs`: prefer Option A,
   replacing the captured bool with a live read. This is a fork patch, but it is
   local to an already fork-specific gate decorator and avoids threading a
   models-manager rebuild through app-server/core.
2. `tui/src/app/config_persistence.rs` plus a small app event/helper: after a
   successful `Feature::AnthropicModels` update, request fresh `model/list` and
   rebuild the TUI `ModelCatalog`.
3. `tui/src/app_server_session.rs`: likely add a `refresh_models()` helper that
   shares the bootstrap `ModelList` mapping code instead of duplicating it.
4. `tui/src/chatwidget/settings.rs` or a small model-catalog setter: add a
   `set_model_catalog(Arc<ModelCatalog>)` helper that refreshes model-dependent
   surfaces.

This is a targeted plan/small implementation, not a brainstorm. The seam is
concrete, but it crosses model-provider plus TUI/app-server-session ownership
and needs tests for:

- enable Anthropic -> `/model` catalog gains Claude without process restart;
- disable Anthropic -> `/model` catalog drops Claude without process restart;
- cache identity mismatch causes refresh rather than stale cache reuse;
- existing selected Claude model behavior when disabling, because bootstrap has
  `bootstrap_default_model()` protection for unavailable Claude
  (`codex-rs\tui\src\app_server_session.rs:1220-1246`) but a mid-session
  disable would need an equivalent current-model fallback or warning.

## Feature hot-reload classification

### Fork-specific / sandbox-patch features

| Feature | Current live behavior | Classification | Evidence |
| --- | --- | --- | --- |
| `AnthropicModels` | Config write can reinstall the process-global gate, and endpoint cache/list reads the gate live, but `/model` uses bootstrap `ModelCatalog` and `GatedModelsManager` captures the gate at manager construction. | Feasible with targeted refresh hook; not live today. | Atomic gate `model-provider\src\anthropic_gate.rs:35-45`; endpoint identity/list reads `model-provider\src\copilot_models_endpoint.rs:175-183,238-244`; captured wrapper `model-provider\src\copilot\gated_models_manager.rs:17-29`; bootstrap catalog `tui\src\app.rs:754-795`. |
| `LegacyPasteBurstHeuristic` | Config derives `disable_paste_burst = !features.enabled(...)`, and the composer receives that bool only at construction. `set_feature_enabled()` has no handler for it. | Feasible small TUI hook; not live today. | Config derivation `core\src\config\mod.rs:2631-2633`; constructor passes `disable_paste_burst` at `tui\src\chatwidget\constructor.rs:100-107`; composer has safe setter `set_disable_paste_burst()` at `tui\src\bottom_pane\chat_composer.rs:922-949`. |
| `UserMessageStyling` | Style uses an atomic gate, but it is installed only during `ChatWidget` construction. The toggle handler does not call it. | Feasible small TUI hook; not live today. | Constructor installs `tui\src\chatwidget\constructor.rs:37-40`; style gate `tui\src\style.rs:56-83`; no handler in `set_feature_enabled()` at `tui\src\chatwidget\settings.rs:70-132`. |
| `AutoLoadClaudeMd` | `AgentsMdManager` consults the feature when building candidate instruction filenames during session spawn; user instructions are computed before session creation. | Restart/new-session bound for existing conversation. | Candidate filenames read `core\src\agents_md.rs:336-355`; spawn computes user instructions at `core\src\session\mod.rs:498-506`; session config stores instructions at `core\src\session\mod.rs:603-624`. |
| `ManagedHooks` | Hook list/build uses the feature, and app-server config reload rebuilds hooks, but core refresh comments explicitly keep derived feature gates session-static. | New-session bound today; feasible only with broader feature re-derive/session-refresh work. | Hook list gate `app-server\src\request_processors\catalog_processor.rs:623-633`; session hook build gate `core\src\session\mod.rs:3379-3405`; refresh boundary `core\src\session\mod.rs:1568-1575`. |
| `WindowsGitBashShell` | Consumed while selecting the session shell at session creation. | Inherently new-session bound. | Shell selection gate `core\src\session\session.rs:840-866`. |

### Currently visible `/experimental` menu features

| Feature | Current live behavior | Classification | Evidence |
| --- | --- | --- | --- |
| `BackgroundProcessNotification` | Core checks `Session.enabled(...)`, and `Session.features` is lifetime-invariant. | New-session bound today; feasible only with mutable/session-live features. | Registry `features\src\lib.rs:765-775`; session feature invariant `core\src\session\session.rs:30-32`; consumers `core\src\unified_exec\async_watcher.rs:169-173`, `core\src\tasks\mod.rs:937-939`. |
| `TerminalResizeReflow` | TUI reads `self.config.features.enabled(...)`; app toggle updates `self.config` and chat widget config. | Already effectively live for future resize/reflow decisions. | Registry `features\src\lib.rs:813-821`; reader `tui\src\app\resize_reflow.rs:108-116`; app updates config/widget at `tui\src\app\config_persistence.rs:498-507`. |
| `RetainedTranscriptViewport` | Same TUI config path as resize reflow; future render/replay decisions read current widget config. | Already effectively live for future rendering decisions. | Registry `features\src\lib.rs:823-831`; reader `tui\src\app\resize_reflow.rs:112-116`; retained renderer path `tui\src\chatwidget\rendering.rs:61-73,125-139`. |
| `MemoryTool` | TUI shows an enable notice live, but core turn/session memory behavior reads session/turn feature snapshots. | Partially live UI; core behavior new-session/new-turn-snapshot bound today. | Registry `features\src\lib.rs:875-883`; notice path `tui\src\app\config_persistence.rs:498-510`; core reads `core\src\tasks\mod.rs:761-765,868-872`. |
| `NetworkProxy` | Resolved to config/network-proxy state during config build and permission-profile config derivation; announcement already says restart. | Restart/new-session bound unless network-proxy/session refresh is broadened. | Registry/announcement `features\src\lib.rs:969-977`; config resolves `enable_network_proxy` at `core\src\config\mod.rs:2631`; permission profile applies it at `core\src\config\mod.rs:3754-3768`. |
| `AnthropicModels` | See fork table. | Feasible targeted hook; not live today. | See above. |
| `AutoLoadClaudeMd` | See fork table. | Restart/new-session bound. | See above. |
| `LegacyPasteBurstHeuristic` | See fork table. | Feasible small TUI hook; not live today. | See above. |
| `UserMessageStyling` | See fork table. | Feasible small TUI hook; not live today. | See above. |
| `ExternalMigration` | Checked only during startup/trust NUX. | Restart/startup bound. | Registry `features\src\lib.rs:1171-1179`; startup gate `tui\src\external_agent_config_migration_startup.rs:28-33`. |
| `MentionsV2` | `set_feature_enabled()` calls `sync_mentions_v2_enabled()`, which updates the bottom-pane composer flag. | Already live. | Registry `features\src\lib.rs:1199-1207`; handler `tui\src\chatwidget\settings.rs:113-115`; sync `tui\src\chatwidget\settings.rs:328-330`; composer flag reads `tui\src\bottom_pane\chat_composer.rs:593-594,1537-1538,2360-2361`. |
| `McpServerNotifications` | Passed into MCP connection manager construction/refresh from config, but existing session features remain static. | New-session/MCP-refresh bound today; feasible with targeted MCP refresh plus feature rederive, not generic-live today. | Registry `features\src\lib.rs:1250-1260`; session init pass-through `core\src\session\session.rs:1188-1200`; MCP refresh pass-through `core\src\session\mcp.rs:355-365`; session feature refresh boundary `core\src\session\mod.rs:1568-1575`. |
| `PreventIdleSleep` | `set_feature_enabled()` immediately calls `turn_lifecycle.set_prevent_idle_sleep(enabled)`. | Already live. | Registry `features\src\lib.rs:1303-1320`; constructor seed `tui\src\chatwidget\constructor.rs:37,147`; live handler `tui\src\chatwidget\settings.rs:116-118`. |

## Change surface and conflict assessment

### Narrow high-value Anthropic `/model` live refresh

Recommended shape: a small targeted implementation plan, not a brainstorm.

Lowest-conflict path:

1. Keep the existing cache-identity fix.
2. Change the fork-specific `GatedModelsManager` decorator to read the
   `AnthropicModels` gate live (or otherwise update its captured gate) so a
   post-toggle `list_models()` cannot be defeated by the old captured bool.
3. Add an `AnthropicModels` branch in `App::update_feature_flags()` after the
   config write succeeds.
4. That branch should call a new `AppServerSession` helper that performs the
   same `model/list` request/mapping as bootstrap, then swap `App.model_catalog`
   and `ChatWidget.model_catalog`, refresh model-dependent surfaces, and redraw
   or reopen `/model` if appropriate.

Upstream conflict: moderate-low. The model-provider edit is in fork-specific
Copilot gating code. The TUI/app-server-session edits touch upstream-canonical
TUI ownership code but can be kept to a small helper plus one event branch.
Avoid adding general feature-observer machinery to `codex-core`.

### General "feature toggles apply live" framework

Not recommended as a quick fix. A general framework would need:

- feature metadata declaring live strategy (`tui-only`, `model-catalog-refresh`,
  `new-session-only`, `restart-only`, etc.);
- a subscriber/handler registry for TUI, app-server, core session, models
  manager, MCP manager, hook engine, and network proxy;
- a change to the current core invariant that `Session.features` is lifetime
  static (`core\src\session\session.rs:30-32`);
- a safe way to re-derive config fields that `refresh_runtime_config()` says are
  currently session-static (`core\src\session\mod.rs:1568-1575`);
- per-feature tests proving toggle-on and toggle-off behavior in active
  sessions.

Upstream conflict: high. It crosses core session semantics, app-server config
refresh, TUI event dispatch, and several feature-specific subsystems. The
feature surface is heterogeneous enough that a general promise would be easy to
overstate and hard to maintain.

## Recommendation

Implement the Anthropic model gate as a targeted model-catalog refresh, and
consider separate small follow-ups for `UserMessageStyling` and
`LegacyPasteBurstHeuristic` if the operator wants those to feel live too. Do
not build a general "all experimental toggles hot-reload" framework yet.

For the operator request "can we allow enabling/disabling without requiring a
restart?": for the Anthropic `/model` case, yes, but not by the current
implementation. The precise missing pieces are a live/dynamic Anthropic gate in
the models-manager decorator plus a TUI/app-server model-list refresh that
replaces the bootstrap `ModelCatalog`.
