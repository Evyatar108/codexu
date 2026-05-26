# plugin-scope-agents — Conflict-Surface Redesign Brainstorm

*Drafted 2026-05-25 by crew member `brainstorm-plugin-scope-redesign` (crew `ralph-pipeline`).*
*Scope: research-only spike. NO code changes. NO edits to `.ralph/jobs/plugin-scope-agents/plan.md`.*

The in-flight `plugin-scope-agents` plan (`.ralph/jobs/plugin-scope-agents/plan.md`)
modifies ~28 files inside `codex/external/repos/codex-patched/codex-rs/` — each one
becomes a `// SANDBOX PATCH: plugin-scope-axis` rebase-conflict marker against
openai/codex. Per `codex/CLAUDE.md` tenet #1 ("minimize upstream-canonical
conflict surface") and `plans/codexu-roadmap.md` §minimize-conflict-surface,
this brainstorm evaluates whether the goal is achievable with substantially
less upstream surgery.

**TL;DR — Recommended: Option A (subagent-config-time filter at
`build_agent_shared_config`).** Cuts the upstream footprint from ~28 files
to ~10–11 files and eliminates ALL signature-threading of
`PluginLoadContext` across the cache/manager path. The whole scope-filter
becomes a 3-to-5-line edit at one upstream function, calling a function in
the overlay crate that synthesizes an override `ConfigLayerStack` layer
disabling top-level-only plugins for subagent sessions. The current plan's
agent-spawner / `spawn_top_level_session` / `spawn_agent` gating half stays
unchanged.

---

## 1. Constraint analysis — what MUST live upstream

The goal (unchanged) is: subagents spawned via `multi_agents{,_v2}/spawn.rs`
must NOT see top-level-only plugins, AND a constrained `agent-spawner`
subagent must be able to ask the Happy daemon to spawn a top-level session.

### 1a. Forced-upstream items (cannot be moved to overlay)

| Surface | File:line evidence | Why upstream-only |
|---|---|---|
| Built-in `agent-spawner` role registration | `codex-rs/core/src/agent/role.rs` | `Role` enum + role-table are upstream-owned. Overlay cannot register new enum variants. |
| `spawn_top_level_session` tool registration | `codex-rs/tools/src/tool_config.rs` + `codex-rs/core/src/tools/spec_plan.rs` | The tool-registry struct + dispatch table are upstream; overlays can't extend dispatch. |
| `spawn_top_level_session` handler | new file under `codex-rs/core/src/tools/handlers/` | Handler trait + `handlers/mod.rs` re-exports are upstream. |
| `spawn_agent` exposure gating | `tools/src/tool_config.rs` + `core/src/tools/spec_plan.rs` + both `multi_agents{,_v2}/spawn.rs` (defensive reject) | Same as above. Gating MUST be in the spec/handler. |
| Workspace integration of new overlay crate | `codex-rs/Cargo.toml` + `Cargo.lock` + `core/Cargo.toml` | Workspace members + crate dependencies require upstream `Cargo.toml` edits. |

That floor is ~9 upstream files for the agent-spawner half plus
~3 files (workspace+core Cargo.toml + Cargo.lock) for the overlay crate
wiring. Roughly **12 upstream files are unavoidable** to achieve the goal.

### 1b. What the current plan ADDS on top of that floor (the surgery worth questioning)

The current plan threads a NEW parameter `PluginLoadContext` through every
caller of `PluginsManager::plugins_for_config()`. Verified inventory
(`git grep -n "plugins_for_config(" -- .` from `codex-rs/`):

```
chatgpt/src/connectors.rs:141
core-plugins/src/manager.rs:470            (definition)
core-plugins/src/manager_tests.rs:141, 357, 386, 1073, 1114, 1130
core/src/agent/role_tests.rs:659
core/src/config/mod.rs:1091                (Config::to_mcp_config)
core/src/connectors.rs:413
core/src/mcp_tool_call.rs:1023, 2068
core/src/mcp_tool_call_tests.rs:1942
core/src/session/mod.rs:479, 2743, 3376
core/src/session/tests.rs:3907, 5640
core/src/session/turn.rs:178, 1168
core/src/session/turn_context.rs:709
core/src/skills_watcher.rs:65
tui/src/app/background_requests.rs:395
```

That's **22 call sites across 14 files**, all touched solely to flow a
`PluginLoadContext` enum to the manager. Plus the parallel inventory for
`to_mcp_config(`: another 4–5 unique files (`core/src/mcp.rs`,
`core/src/session/mcp.rs`, `core/src/connectors.rs`,
`core/src/config/config_tests.rs`, `app-server/src/request_processors/mcp_processor.rs`).

These are the files we'd like to **avoid** touching. Each is a rebase-merge
risk because openai/codex evolves the same call graph independently
(per the spike in `plans/codex-child-spawn-tools.md`, upstream HEAD also
rewrites these call sites in v0.128+'s monolith refactor).

### 1c. The key insight — subagent Config has a single construction seam

`git grep` for the four subagent-config construction call sites:

```
core/src/tools/handlers/agent_jobs.rs:130                    → build_agent_spawn_config
core/src/tools/handlers/multi_agents/spawn.rs:84             → build_agent_spawn_config
core/src/tools/handlers/multi_agents_v2/spawn.rs:83          → build_agent_spawn_config
core/src/tools/handlers/multi_agents/resume_agent.rs:171     → build_agent_resume_config
```

Both helpers funnel into the SAME private function:

```rust
// codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_common.rs:225
fn build_agent_shared_config(turn: &TurnContext) -> Result<Config, FunctionCallError> {
    let base_config = turn.config.clone();
    let mut config = (*base_config).clone();
    config.model = Some(turn.model_info.slug.clone());
    // ...
    apply_spawn_agent_runtime_overrides(&mut config, turn)?;
    Ok(config)
}
```

**ALL subagent Config objects are constructed here.** If we add a
3-to-5-line call that mutates `config` to disable top-level-only plugins
BEFORE the function returns, every subagent inherits a Config that does
not see those plugins. The existing
`PluginsManager::plugins_for_config()` cache + signature + every caller
stay UNCHANGED, because the subagent's Config naturally produces a
different `version_for_toml(effective_config())` cache key
(`core-plugins/src/manager.rs:485`).

### 1d. The disable mechanism already exists

`codex-rs/core/src/plugins/discoverable.rs:36–56` already uses
`config.tool_suggest.disabled_tools` (filtered to `Plugin` kind) to filter
plugins by id. Per-plugin `enabled = false` is also a first-class TOML
config key (`core-plugins/src/manager.rs:231, 268, 1206, 1267, 1310`).
Either path is precedent for "this config disables this plugin."

`ConfigLayerStack` supports injected override layers via
`with_user_layer` / `with_user_config` / `with_user_layer_from`
(`codex-rs/config/src/state.rs:239–260`). The overlay crate can synthesize
a high-precedence layer like:

```toml
[plugins.ralph-orchestration]
enabled = false
[plugins.other-top-level-plugin]
enabled = false
```

…push it onto the subagent's stack, and the existing config-merge logic
disables those plugins naturally. Zero new disable-mechanism code is
needed upstream.

### 1e. Theoretical floor

The minimum upstream surface that achieves the FULL goal is:

- ~3 files of overlay+workspace wiring (Cargo.toml × 2, Cargo.lock)
- ~9 files for the agent-spawner half (role.rs, tool_config.rs,
  spec_plan.rs, handlers/mod.rs + new handler, both spawn.rs defensive
  rejects, multi_agents_common.rs helper if shared)
- **1 file (multi_agents_common.rs) for the scope filter itself** — a 3-to-5-line
  edit at `build_agent_shared_config` calling the overlay.

**Total floor: ~13 upstream files.** Current plan hits ~28. **The
delta (~15 files) is pure threading overhead that Option A eliminates.**

---

## 2. Option-by-option evaluation

### Option 1 (from seed) — single-seam overlay filter inside `plugins_for_config`

Insert one filter call inside `manager.rs::plugins_for_config_with_force_reload`
after the cached outcome is retrieved. Have the overlay crate derive context
from… something. The seed sketch hoped `SessionSource` would be in scope at
the manager level.

**Verdict — REJECTED.** `PluginsManager` is process-wide and holds no
session state. The manager only sees `PluginsConfigInput`, which carries
`ConfigLayerStack`, feature flags, and `chatgpt_base_url`
(`core-plugins/src/manager.rs:87–93`). `SessionSource` is NOT in scope —
the same manager serves both top-level and subagent calls. To derive
context the manager would need a new parameter, which means threading
through every call site — exactly what we're trying to avoid.

**File count:** ~22 files (no improvement over current plan minus 6 BUILD files).

**Conflict risk:** HIGH — every threaded call site is a rebase-merge risk.

---

### Option 2 (from seed) — phased work (escape hatch first, scope filter later)

Phase 2a ships just `agent-spawner` + `spawn_top_level_session` + `spawn_agent`
gating (~9 upstream files). Phase 2b adds the scope filter later.

**Verdict — PARTIAL FIT.** This is operationally reasonable if the operator
accepts that ralph-orchestration plugin keeps loading into subagents in
the interim (context bloat, slightly recursive risk if a subagent runs
ralph-orchestration commands). The escape hatch alone is independently
useful: a constrained subagent can request a top-level session for
operator-tier work without the operator manually launching one.

**File count Phase 2a:** ~9 upstream files. **File count Phase 2b:** depends
on the chosen filter design — minimum is +1 file if Phase 2b uses Option A.

**Conflict risk:** LOW for Phase 2a (no signature changes touched).
Phase 2b risk depends on its design.

**Drawback:** the goal isn't reached in one ship. If the operator wants
the security boundary enforced in the same release as the escape hatch
(so subagents lose `ralph-orchestration` and the operator's
`/implement-with-ralph` is unaffected), this isn't sufficient. The
recommendation is to ship Phase 2a + Phase 2b TOGETHER using Option A
for Phase 2b — that's effectively Option A below.

---

### Option 3 (from seed) — pre-filter at happy-cli launcher boundary

Have `packages/happy-cli/src/codex/runCodex.ts` set a per-session
plugin-discovery-path env (e.g., `CODEX_PLUGIN_DIR`) so subagent codex
processes start with a pre-filtered plugin directory.

**Verdict — REJECTED.** Plugins are NOT discovered via a directory env
var. The plugin set is configured via TOML `[plugins.<name>]` entries in
`~/.codex/config.toml` (the user layer of `ConfigLayerStack`). The
plugin loader (`core-plugins/src/loader.rs::load_plugins_from_layer_stack`,
called at `core-plugins/src/manager.rs:493`) iterates configured plugin
entries — it doesn't scan a directory. Even if such an env existed,
subagents share the parent codex process today: they don't relaunch
codex; they spawn within the same app-server (`multi_agents_v2/spawn.rs`
creates an in-process `AgentControl`). A per-process env var won't
discriminate.

**File count:** N/A — design is infeasible.

---

### Option A (NEW, RECOMMENDED) — subagent-config-time filter via override layer

**Design.** Add ONE call in `core/src/tools/handlers/multi_agents_common.rs::build_agent_shared_config`
after `apply_spawn_agent_runtime_overrides`:

```rust
// SANDBOX PATCH: plugin-scope-axis
codex_plugin_scope::apply_subagent_plugin_filter(&mut config);
```

The overlay crate `codex-plugin-scope` implements
`apply_subagent_plugin_filter` as:

1. Read `config.config_layer_stack.effective_config()` to discover the
   configured `[plugins.*]` entries (already in scope).
2. For each enabled plugin, resolve its install path
   (`~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`) and read
   `.codex-plugin/plugin.json` independently of upstream `manifest.rs`.
3. If `manifest.scope.agent == "top-level"`, accumulate that plugin's
   config key into a synthetic override TOML.
4. Build a one-shot override `ConfigLayerEntry` containing:
   `[plugins.<id>]\nenabled = false` for each top-level-only plugin.
5. Apply the override via `ConfigLayerStack::with_user_layer` (or a new
   thin overlay-side helper that pushes a synthetic high-precedence
   layer). The resulting stack is reassigned to `config.config_layer_stack`.

When the subagent later calls `Config::plugins_config_input()` →
`PluginsManager::plugins_for_config()`, the load function naturally sees
the disabled plugins and excludes them from `PluginLoadOutcome`. The cache
key (`version_for_toml`) differs from the parent's because the layer
stack differs, so top-level and subagent results coexist cleanly in cache.

**Upstream file count:**

| File | Edit |
|---|---|
| `codex-rs/Cargo.toml` | +1 workspace member, +1 `[workspace.dependencies]` entry |
| `codex-rs/Cargo.lock` | refresh |
| `codex-rs/core/Cargo.toml` | `codex-plugin-scope = { workspace = true }` |
| `core/src/tools/handlers/multi_agents_common.rs` | ~3-line filter call + `// SANDBOX PATCH:` marker |
| `core/src/agent/role.rs` | register `agent-spawner` |
| `tools/src/tool_config.rs` | gate `spawn_top_level_session` exposure on `SessionSource::SubAgent(... agent_role: Some("agent-spawner") ...)`; gate `spawn_agent` exposure on `TopLevel` context |
| `core/src/tools/spec_plan.rs` | register `spawn_top_level_session`; gate `spawn_agent` registration |
| `core/src/tools/handlers/mod.rs` | re-export new handler |
| `core/src/tools/handlers/spawn_top_level_session.rs` | NEW file (1 file, lives upstream because the handler trait is upstream-owned) |
| `core/src/tools/handlers/multi_agents/spawn.rs` | defensive reject for v1 + unit test |
| `core/src/tools/handlers/multi_agents_v2/spawn.rs` | defensive reject for v2 + unit test |
| **Total** | **11 upstream files** |

Plus the overlay crate itself (zero conflict surface):

| File | Purpose |
|---|---|
| `codex/codex-rs-overlay/codex-plugin-scope/Cargo.toml` | crate manifest |
| `codex/codex-rs-overlay/codex-plugin-scope/src/lib.rs` | re-exports |
| `codex/codex-rs-overlay/codex-plugin-scope/src/parser.rs` | manifest re-reader |
| `codex/codex-rs-overlay/codex-plugin-scope/src/filter.rs` | `apply_subagent_plugin_filter(&mut Config)` |
| `codex/codex-rs-overlay/codex-plugin-scope/tests/*.rs` | unit tests |
| `codex/codex-rs-overlay/codex-invariant-tests/tests/plugin_scope_filtering.rs` | source-pattern guard |

Plus happy-cli TS side (UNCHANGED from current plan): daemon HTTP
endpoint + env plumbing for `spawn_top_level_session`. No reductions
possible here because it's the operator-side of the escape hatch.

**Conflict risk:** LOW. `multi_agents_common.rs` is a fork-specific
co-evolution zone (the spike in `plans/codex-child-spawn-tools.md`
documents that this file is where `apply_spawn_agent_overrides` lives
and gets rebased; one more line there is on the existing patch path).
The other 10 upstream files are the same set Option B touches but with
~12 fewer files because we skip all 14 `plugins_for_config(` call sites
and all 5 `to_mcp_config(` call sites that don't independently need
changes.

**Operational drawbacks:**

1. **Filter runs on every subagent spawn.** Manifest re-parse cost: 1 disk
   read per configured plugin (typically <10 plugins). Mitigation: the
   overlay can cache parsed manifests in a `Lazy<RwLock<HashMap>>` keyed
   by plugin install path + mtime. <1 ms per spawn after warm.
2. **Cache memory doubles for subagent vs top-level.** Two
   `PluginLoadOutcome` entries instead of one. PluginLoadOutcome is
   small (~vector of plugin descriptors). Acceptable.
3. **Doesn't catch non-spawn subagent paths.** Verification needed: are
   there other code paths that create a subagent-context Session without
   going through `build_agent_shared_config`? The four call sites in §1c
   are exhaustive per `git grep`. **Action item:** the implementation
   story should re-run that grep at implementation time and assert
   coverage.
4. **`apply_subagent_plugin_filter` runs even when no top-level plugins
   are configured.** No-op cost is one HashMap lookup. Acceptable.

**Test coverage implications:**

- **Overlay unit tests** (zero upstream conflict): exhaustive coverage of
  the manifest re-parser, the override-layer synthesis, and the
  `PluginScope::allows(ctx)` predicate. These are the high-value tests.
- **Upstream integration test** in `multi_agents_tests.rs` (1 new test):
  spawn an agent with a parent config that enables a top-level-only test
  plugin; assert the child config has it disabled. This tests the seam,
  not the predicate.
- **Invariant test** in `codex-invariant-tests/tests/plugin_scope_filtering.rs`:
  source-pattern grep for the `// SANDBOX PATCH: plugin-scope-axis`
  marker in `multi_agents_common.rs`.

**Future-rebase friction estimate:** 1 line of conflict expected per
rebase (upstream edits to `build_agent_shared_config` are likely to
touch the area around the new call). The seam pattern is identical to
`apply_spawn_agent_overrides` which has rebased cleanly multiple times.

---

### Option B — the current plan (BASELINE, for comparison)

**File count:** ~28 upstream files (with the verified call-site inventory
in §1b plus the agent-spawner half).

**Conflict risk:** HIGH for the threaded files; LOW for the agent-spawner half.

**Future-rebase friction estimate:** 10–15 lines of conflict per rebase
(every `plugins_for_config(` signature mismatch is a separate conflict).

**Why we'd choose B anyway:** if there were a NECESSARY case in which
`plugins_for_config()` itself needs to discriminate context — e.g., a
background non-session caller that needs subagent filtering. The
inventory in §1b shows all current `plugins_for_config()` callers fall
into two camps: (a) session/turn-scoped, where Config already carries
the layer stack with our override; (b) tool-suggest / discoverability /
background / catalog paths that are inherently top-level and don't need
filtering. So Option A's "filter via Config at construction" covers
every real consumer.

---

### Option C (NEW) — `Config::plugin_load_context` field, no parameter threading

Add a field `plugin_load_context: PluginLoadContext` to `Config`
(default `TopLevel`). Propagate it through `Config::plugins_config_input()`
(add the field to `PluginsConfigInput`). At
`build_agent_shared_config`, set `config.plugin_load_context = Subagent`.
Inside `plugins_for_config_with_force_reload`, read the field from the
input and filter the outcome before caching.

**File count:** ~5 upstream files (Config, PluginsConfigInput,
`build_agent_shared_config`, `core-plugins/src/manager.rs`, manifest
re-parser hook). Plus the agent-spawner half (~9).

**Conflict risk:** MEDIUM. Adding a field to `Config` is invasive — every
test fixture that constructs `Config` directly needs the new field.
Looking at `config_tests.rs:3263+`, many fixtures use `Config::default()`
or builder patterns; if those exist, the impact is small. If they don't,
this could touch 10+ fixture files.

**Why Option A wins:** Option A doesn't add ANY field to `Config`. It
mutates `config.config_layer_stack` only — which is already mutated by
the existing `apply_spawn_agent_runtime_overrides`. The override layer
encodes the scope decision; no schema change to `Config` is needed. So
Option A is structurally cleaner AND smaller.

---

### Option D (NEW) — Filter at PluginLoadOutcome materialization sites

Drop the parameter from `plugins_for_config()` entirely. Instead, every
materialization site (Session creation, `to_mcp_config`, etc.) calls a
`PluginLoadOutcome::filter_for_scope(ctx)` extension trait from the
overlay crate.

**File count:** ~22 upstream files (same set of materialization sites
threaded by Option B). No improvement.

**Verdict — REJECTED.** Same threading problem as Option B with extra
indirection.

---

### Option E (NEW) — Subagent uses a separate `PluginsManager` instance

Give subagent sessions their OWN `PluginsManager` instance with a
restriction filter encoded at construction time.

**File count:** Looks small at first, but `PluginsManager` is held by
`PluginsService` / shared `Services` across the process
(`core/src/session/mcp.rs:289` references `self.services.plugins_manager`).
Splitting it per-context requires plumbing two managers through every
service, which is just a different threading problem.

**Verdict — REJECTED.** Threading replacement, not elimination.

---

## 3. Recommendation

**Adopt Option A.** Concrete delta against
`.ralph/jobs/plugin-scope-agents/plan.md`:

### 3a. Files to REMOVE from the "Modify — Upstream Rust" section

| File | Reason |
|---|---|
| `core-plugins/src/manager.rs` | Filter moves to overlay+spawn seam; manager untouched |
| `core/src/session/mod.rs` | No `PluginLoadContext` threading needed |
| `core/src/config/mod.rs` | `Config::to_mcp_config` untouched (still reads from layer stack) |
| `core/src/connectors.rs` | Untouched |
| `core/src/mcp.rs` | Untouched |
| `core/src/mcp_tool_call.rs` | Untouched |
| `core/src/skills_watcher.rs` | Untouched (skills-watcher is top-level only) |
| `core/src/session/{mcp,turn,turn_context}.rs` | Untouched |
| `core/src/{agent/role_tests,config/config_tests,mcp_tool_call_tests,session/tests}.rs` | Test edits not required because signatures unchanged |
| `app-server/src/request_processors/{mcp,catalog}_processor.rs` | Untouched |
| `chatgpt/src/connectors.rs` | Untouched |
| `tui/src/app/background_requests.rs` | Untouched |
| `core-plugins/src/loader_tests.rs` | Untouched (no new manifest field in upstream) |
| `BUILD.bazel` files | Verify-only; likely no-op for the spawn-seam-only edit |

### 3b. Files to KEEP / RETAIN from the current plan

| File | Reason |
|---|---|
| `codex-rs/Cargo.toml`, `codex-rs/Cargo.lock`, `core/Cargo.toml`, `tools/Cargo.toml` (if needed) | Workspace registration of overlay crate |
| `core/src/agent/role.rs` | `agent-spawner` role registration |
| `tools/src/tool_config.rs` | Tool exposure gating |
| `core/src/tools/spec_plan.rs` | Tool registration + `spawn_agent` gating |
| `core/src/tools/handlers/mod.rs` | Re-export |
| `core/src/tools/handlers/spawn_top_level_session.rs` (NEW) | Handler |
| `core/src/tools/handlers/multi_agents/spawn.rs` | Defensive reject for v1 |
| `core/src/tools/handlers/multi_agents_v2/spawn.rs` | Defensive reject for v2 |
| `core-plugins/src/manager_tests.rs` | Repurpose: this test now lives in `multi_agents_tests.rs` (test the spawn-seam filter, not the manager) |
| All `codex-rs-overlay/codex-plugin-scope/**/*` (NEW overlay crate) | Zero conflict surface |
| `codex-rs-overlay/codex-invariant-tests/tests/plugin_scope_filtering.rs` (NEW) | Source-pattern guard |
| All `packages/happy-cli/**` files | TS daemon HTTP + env plumbing unchanged |
| `packages/codexu-plugin/.codex-plugin/plugin.json` | Documentation fixture |
| `codex/docs/implementation/patch-surface.md` §14+§15 | Patch registration |

### 3c. Files to ADD (new from Option A)

| File | Purpose |
|---|---|
| `core/src/tools/handlers/multi_agents_common.rs` | Add the 3-to-5-line `apply_subagent_plugin_filter` call + `// SANDBOX PATCH: plugin-scope-axis` marker |
| `codex-rs-overlay/codex-plugin-scope/src/filter.rs` | The overlay-owned `apply_subagent_plugin_filter(&mut Config)` |
| `core/src/tools/handlers/multi_agents_tests.rs` | New integration test asserting child config has top-level-only plugin disabled |

### 3d. Story decomposition changes

The current plan's stories US-001 through US-008 collapse considerably:

- **US-001:** Scaffold overlay crate (unchanged in spirit; richer
  internals because filter logic now lives here).
- **US-002 (revised):** Subagent-config filter seam — edit
  `multi_agents_common.rs::build_agent_shared_config` to call
  `codex_plugin_scope::apply_subagent_plugin_filter(&mut config)`. Add
  integration test in `multi_agents_tests.rs`. Replaces the old US-002
  ("Manager filtering seam") + US-003 ("Call-site inventory + context
  plumbing") entirely. **(small)**
- **US-003:** `agent-spawner` role + `spawn_top_level_session` (unchanged).
- **US-004:** `spawn_agent` gating (unchanged from US-005 in current plan).
- **US-005:** happy-cli daemon HTTP + env plumbing (unchanged from US-006).
- **US-006:** Invariant test + patch-surface docs (unchanged from US-007).
- **US-007:** Local fixture plugin + cross-package typecheck (unchanged from US-008).

Net: **8 stories → 7 stories**, with US-002 going from ~14-file medium
story to ~3-file small story. Cluster decomposition simplifies — no
need for "rust-scope-machinery serial" because there's no parameter
threading.

### 3e. Acceptance-criteria changes

Drop from the AC section:

- "Before landing the signature change, `git grep -n 'plugins_for_config('` …" (no signature change anymore)
- "`// SANDBOX PATCH: plugin-scope-axis` markers appear in all upstream files edited (manager.rs, session/mod.rs, config/mod.rs, …)" → only marker required is in `multi_agents_common.rs` + the role/tool registration files

Add:

- "`build_agent_shared_config` in `core/src/tools/handlers/multi_agents_common.rs` calls `codex_plugin_scope::apply_subagent_plugin_filter(&mut config)` AFTER `apply_spawn_agent_runtime_overrides`, gated behind a `// SANDBOX PATCH: plugin-scope-axis` marker."
- "`multi_agents_tests.rs` contains an integration test asserting that a child config built from a parent config with an enabled top-level-only plugin has that plugin's entry disabled in `child.config_layer_stack.effective_config()`."
- "Overlay crate unit tests cover (a) parser deserialization of `scope.agent ∈ {top-level, subagent, both}`; (b) parser refuses unknown `scope.agent` values per F-012; (c) override-layer synthesis for an empty plugin list; (d) override-layer synthesis disables the right plugin ids."

### 3f. Risk-area changes

Drop:
- "Scope filter bypass via cached outcome (HIGH)" — no longer relevant because the cache is naturally keyed by the filtered layer stack.
- "Scope filter bypass via MCP forwarding (MEDIUM)" — no longer relevant because the subagent's Config never sees the top-level plugin's MCP servers; `to_mcp_config` iterates over the subagent-filtered `PluginLoadOutcome`.

Add:
- **Non-spawn subagent paths (LOW):** If a future code change creates a subagent-context Session WITHOUT going through `build_agent_shared_config`, the filter is bypassed. **Mitigation:** the invariant test in `codex-invariant-tests/tests/plugin_scope_filtering.rs` should assert `build_agent_shared_config` is the only caller-side seam for Config-from-parent-Config construction in subagent paths (source-pattern grep for `config.clone()` inside `multi_agents*` modules).

---

## 4. Open questions for the operator

1. **Adopt Option A or stay with current plan?** This is the headline
   decision. If yes, the in-flight `impl-plugin-scope-agents` member's
   plan should be paused and the redirect applied. If no, document the
   reason for posterity (this brainstorm doc serves as the "we considered
   it" record).

2. **Confirm `build_agent_shared_config` is exhaustive.** The four call
   sites in §1c are derived from `git grep` against the current pinned
   submodule. The implementer should rerun the grep at implementation
   time and either (a) add the call to any newly-discovered subagent
   construction path, or (b) document why no further paths can produce a
   subagent Config.

3. **Override-layer precedence.** The overlay crate must push the
   synthetic disable layer at a precedence ABOVE any user/project layer
   that might re-enable a plugin (otherwise a user `[plugins.x] enabled =
   true` would override the disable). `ConfigLayerStack` user-layer
   semantics suggest this works (the synthetic layer is pushed AFTER
   user load), but the implementer should write an explicit test where
   the parent config has `enabled = true` for a top-level-only plugin
   and assert the subagent override wins.

4. **Manifest cache lifecycle.** The overlay's manifest re-parser reads
   `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/.codex-plugin/plugin.json`
   on every subagent spawn unless cached. A simple `Lazy<RwLock<HashMap>>`
   in the overlay crate handles this. Should the operator be involved
   in cache-invalidation policy, or is "process lifetime" acceptable?
   (Recommendation: process-lifetime; matches today's plugin-cache
   semantics — see `~/.codex/plugins/cache` confusion-point in
   `D:/harness-efforts/codexu/CLAUDE.md`.)

5. **Phase 2c forward-compatibility.** The current plan uses nested
   `scope: { agent: "top-level" | "subagent" | "both" }` for forward
   compatibility with Phase 2c's planned `scope: { host, agent }` axis.
   Option A doesn't change that — the overlay parser still reads the
   nested form. Confirm Phase 2c still uses the same shape so this
   doesn't need re-design later.

---

## 5. References

- `.ralph/jobs/plugin-scope-agents/plan.md` (current plan)
- `plans/codex-child-spawn-tools.md` (prior spike; baseline for "top-level-only is supported")
- `codex/external/repos/codex-patched/codex-rs/core-plugins/src/manager.rs:87, 470, 480` (manager + PluginsConfigInput)
- `codex/external/repos/codex-patched/codex-rs/core-plugins/src/loader.rs:115, 502` (load entry points)
- `codex/external/repos/codex-patched/codex-rs/core/src/config/mod.rs:1076, 1086, 392` (Config + plugins_config_input + to_mcp_config)
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_common.rs:205, 214, 225, 281` (subagent Config construction + the existing precedent for `apply_spawn_agent_overrides`)
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs:84` + `multi_agents_v2/spawn.rs:83` (v1/v2 spawn paths)
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/resume_agent.rs:171` (resume path; also funnels through `build_agent_shared_config`)
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/agent_jobs.rs:130` (agent-jobs spawn path; also funnels through `build_agent_spawn_config`)
- `codex/external/repos/codex-patched/codex-rs/config/src/state.rs:181, 239–260` (ConfigLayerStack + `with_user_layer` precedent for override-layer injection)
- `codex/external/repos/codex-patched/codex-rs/core/src/plugins/discoverable.rs:36–56` (precedent: filter plugins by id at config-read time)
- `codex/external/repos/codex-patched/codex-rs/core-plugins/src/manager.rs:231, 268, 303, 1206, 1267, 1310` (precedent: per-plugin `enabled` is a first-class disable knob)
- `codex/CLAUDE.md` tenet 1 (minimize upstream-canonical conflict surface)
- `plans/codexu-roadmap.md` §minimize-conflict-surface (forking strategy)
