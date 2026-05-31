# Plan: Phase 3h-tail — codex-submodule seams for options-mode plugin

**Status:** plan only — no code changes in this commit
**Target consumer:** `packages/codexu-options-mode-plugin/` (Phase 3h shipped 2026-05-13)
**Submodule pinned at:** `558cd1388` (`pre-w5-pilot-snapshot-2026-05-21-40-g558cd1388`,
upstream rust-v0.135.0 base)
**Mandate:** "minimize upstream-canonical conflict surface" per `codex/CLAUDE.md` core
engineering tenant 1 + `plans/codexu-roadmap.md` § Phase 2 prerequisite.

This plan covers the two Phase 3h-tail deferred items left as workarounds when the
options-mode plugin shipped: a plugin-driven TUI statusline slot, and a way for the
plugin's `auto` mode to short-circuit `request_user_input` so an unattended session
doesn't stall waiting for a human.

---

## Executive summary

| Item | Verdict | Seam shape | Upstream conflict surface | Recommended ship |
|------|---------|------------|---------------------------|------------------|
| 1. Statusline plugin slot | **Defer / scope down** — overlay-only is not mechanically viable; minimum-viable upstream seam is non-trivial (~120–180 LoC across `tui` + new manifest field) and touches one of the codex tenets' "high-touch" files (`footer.rs`, `status_line_setup.rs`). | New `core-plugins::PluginManifest::statusline` field + `StatusLineItem::Plugin(String)` variant + dynamic-item path in renderer. | **High**: edits `tui/src/bottom_pane/status_line_setup.rs`, `tui/src/bottom_pane/status_surface_preview.rs`, `tui/src/bottom_pane/footer.rs`, plus 8–10 snapshot tests need re-baselining. | Hold for now; revisit when upstream proposes its own statusline-plugin API (active discussion area in v0.135.x). See "Item 1 detail" for what to do if the operator wants to ship anyway. |
| 2. `request_user_input` `pre_tool_use_payload()` override | **Ship — and the upstream seam is mostly already there.** The trait default in `core/src/tools/registry.rs` ALREADY emits PreToolUse for `request_user_input`. Two real gaps: (a) the plugin's `hooks.json` does not register PreToolUse with matcher `request_user_input`; (b) for the auto-respond-on-behalf-of-user semantics, `PreToolUseHookResult` needs a `SyntheticResponse(Value)` variant (~30 LoC in `core/src/hook_runtime.rs` + ~20 LoC in `core/src/tools/registry.rs`). | Plugin-side: extend `hooks.json`. Codex-side: extend `PreToolUseHookResult` with a third variant that becomes a synthetic `FunctionToolOutput` success. | **Low**: single enum variant + match arm in `hook_runtime.rs` and `registry.rs`. No tests deleted; new tests covering the new variant. | **Ship standalone in v0.135.x-copilot-api.N** (next codex release window). |

**Bundle-vs-split call: SPLIT.**
Ship Item 2 alone in the next codex release (`v0.135.x-copilot-api.N`). Hold Item 1 until upstream signals a direction. The two items are mechanically independent (Item 1 is renderer-side; Item 2 is hook-runtime-side), share no files, and Item 1's "high" conflict-surface budget is the dominant risk — bundling forces Item 2 to wait on Item 1.

**Per-tenet check:**
- Tenet 1 ("minimize conflict surface"): Item 2 stays under tenet 1.2 (small upstream-canonical edit at a single seam). Item 1 cannot stay under tenet 1.1 (overlay-only) without an upstream-driven scope-down — flagged for operator decision.
- Tenet 2 ("verify the seam before changing it"): both seams verified live in the pinned submodule (`558cd1388`); file:line evidence in the per-item detail below.
- Tenet 3 ("test invariants in-tree"): Item 2 adds one `core-plugins` invariant test (default-impl emits payload for `request_user_input`) and one `hooks` integration test for the new `SyntheticResponse` variant.

---

## Surface evidence (Phase 1 — codex source probe)

All citations against submodule pin `558cd1388`, path
`codex/external/repos/codex-patched/codex-rs/`. Verified with `grep` and direct
`view`.

### Item 1 — statusline slot

- **`tui/src/bottom_pane/status_line_setup.rs:55–139`** — `pub(crate) enum StatusLineItem` is a closed enum with 25 hardcoded variants (Model, CurrentDir, GitBranch, ContextRemaining, TaskProgress, …). `#[derive(EnumIter, EnumString, Display, ...)]`; the SETUP picker enumerates `StatusLineItem::iter()` to build the multi-select UI.
- **`tui/src/bottom_pane/status_line_setup.rs:190–217`** — `preview_item()` maps each variant to a parallel closed enum `StatusSurfacePreviewItem` defined in `status_surface_preview.rs`. The renderer (`footer.rs` line 13) and the `status_compose` chatwidget read `StatusSurfacePreviewItem` to format the actual visible status line.
- **No plugin slot anywhere** — `grep -nE 'plugin|hook' tui/src/bottom_pane/status_line*.rs` returns zero matches. There is no extension point, no callback registry, no `Vec<Box<dyn StatusLineProvider>>`.
- **`core-plugins/src/manifest.rs:38–62`** — `PluginManifest` has fields: `name`, `version`, `description`, `paths`, `hooks`, `interface`. No `statusline` field.
- **Snapshot coverage** — at least 16 snapshot files under `tui/src/bottom_pane/snapshots/` and `tui/src/chatwidget/snapshots/` assert exact statusline rendering with hardcoded items (`footer_status_line_*`, `status_line_setup_popup_*`, `status_line_model_*`). Any enum widening re-baselines all of them.
- **Overlay viability check.** `codex-rs-overlay/` exists and already hosts `codex-copilot`, `codex-copilot-launcher`, `codex-invariant-tests`, `codex-plugin-scope`. **Overlay crates can add NEW code but cannot extend an upstream-canonical `pub(crate) enum` or hook into a private rendering path.** `StatusLineItem` is `pub(crate)`, so an overlay crate cannot even reference it from outside the `tui` crate. Conclusion: no overlay-only path. Any plugin slot requires the upstream-canonical edit.

### Item 2 — `request_user_input` PreToolUse override

- **`core/src/tools/handlers/request_user_input.rs:1–94`** — `RequestUserInputHandler` is a registered `ToolExecutor<ToolInvocation>` with `tool_name() = REQUEST_USER_INPUT_TOOL_NAME ("request_user_input")`. It calls `session.request_user_input(turn, call_id, args).await` at line 68 and serializes the `RequestUserInputResponse` into a `FunctionToolOutput`.
- **`core/src/tools/handlers/request_user_input_spec.rs:8`** — `pub const REQUEST_USER_INPUT_TOOL_NAME: &str = "request_user_input";` — this IS the tool name that flows through hook matchers.
- **`core/src/tools/registry.rs:101–110`** — the `CoreToolRuntime` trait has a **default implementation** of `pre_tool_use_payload()` that returns `Some(PreToolUsePayload { tool_name, tool_input })` for ANY tool with a `Function` payload:
  ```rust
  fn pre_tool_use_payload(&self, invocation: &ToolInvocation) -> Option<PreToolUsePayload> {
      let ToolPayload::Function { arguments } = &invocation.payload else {
          return None;
      };
      Some(PreToolUsePayload {
          tool_name: function_hook_tool_name(invocation),
          tool_input: function_hook_tool_input(arguments),
      })
  }
  ```
- **`RequestUserInputHandler` does NOT override** `pre_tool_use_payload()` (only `tool_name`, `spec`, and `handle` are present in the impl block — lines 25–87). It inherits the default. **The `pre_tool_use_payload()` override the codexu-options-mode README cites as missing is, in fact, present and emitting today.**
- **`core/src/tools/registry.rs:487–530`** — the tool dispatcher already invokes `run_pre_tool_use_hooks(...)` BEFORE every tool's `handle()` call, branching on:
  - `PreToolUseHookResult::Blocked(message)` → `FunctionCallError::RespondToModel(message)` (the model sees this as a tool error string)
  - `PreToolUseHookResult::Continue { updated_input: Some(_) }` → rewrites the tool input and proceeds to the handler
  - `PreToolUseHookResult::Continue { updated_input: None }` → proceeds untouched
- **`core/src/hook_runtime.rs:54–56`** — `enum PreToolUseHookResult { Continue { updated_input: Option<Value> }, Blocked(String) }`. **There is no synthetic-success variant** — a hook cannot return "use this Value as if the tool succeeded with it".
- **What the plugin actually wants (auto mode)** — when a turn ends with an `AskUserQuestion`/`request_user_input` call in auto mode, respond on behalf of the user with the FIRST option of each question so the agent loop continues. That requires the tool to return a structured `RequestUserInputResponse`, not an error string. `Blocked(text)` is the wrong shape — the model would see an error and likely re-ask.

---

## Item 1 detail — statusline plugin slot

### Recommended verdict: **DEFER**

The fork's existing workaround — in-band `additionalContext` prefix
`options-mode: <mode>` injected via `SessionStart` — is functional and ships
zero conflict surface. Replacing it with a real plugin slot requires a
substantial upstream-canonical edit with no overlay fallback. **This is the
exact "upstream-canonical edit only when the seam cannot be moved out"
scenario from tenet 1.3, but the consumer pain (a prefix in the prompt
header instead of a styled badge in the TUI footer) is low.**

### If the operator chooses to ship anyway

#### Minimum-viable upstream seam

1. **`core-plugins::PluginManifest`** (`core-plugins/src/manifest.rs:38`) — add
   ```rust
   pub statusline: Option<PluginManifestStatusline>,
   ```
   where `PluginManifestStatusline { command: String, refresh_secs: Option<u32> }`. ~40 LoC (struct + Raw mirror + JSON tag + serde wire test).
2. **`tui/src/bottom_pane/status_line_setup.rs:55`** — extend `StatusLineItem` with
   ```rust
   Plugin { plugin_id: String },
   ```
   The setup picker enumerates installed plugins via a new `PluginManifestRegistry` accessor. Strum derives become custom for the `Plugin` variant. ~30 LoC + per-variant updates to `description()` and `preview_item()` (~25 LoC).
3. **`tui/src/bottom_pane/status_surface_preview.rs`** — parallel `Plugin { id, value: String }` variant. ~15 LoC.
4. **Runtime fetcher** — new module `tui/src/plugin_statusline.rs` that spawns the manifest's `command`, caches the latest stdout line by `plugin_id`, refreshes on a `tokio::time::interval` of `refresh_secs`. ~80 LoC; new file (low conflict surface).
5. **Renderer** — `footer.rs` (line 13 region) reads the cache when rendering a `StatusSurfacePreviewItem::Plugin`. ~10 LoC.
6. **Snapshot tests** — re-baseline 16 existing snapshots + add 2 new ones for plugin-item rendering.

**Total budget estimate: ~120–180 LoC upstream-canonical + ~80 LoC overlay (new fetcher module COULD live in `codex-rs-overlay/codex-statusline-plugin-fetcher/` if we want).**

#### Why overlay-first does not work here
- `StatusLineItem` is `pub(crate)` in `tui`. An overlay crate cannot see it.
- The render path is owned by `footer.rs` (high-touch file per `external/repos/codex-patched/AGENTS.md` § "Avoid large modules"). No callback-style extension surface exists.
- `core-plugins::PluginManifest` is the canonical schema; adding a new optional field there is the only way the plugin layer surfaces a statusline command. Field addition is a `Serialize`/`Deserialize`-compatible change (Option), so the upstream-rebase conflict is limited to "we added one field" — Low conflict probability if we keep the field optional and last-position in the struct.

#### Upstream-canonical edit budget (if shipping)

| File | LoC delta | Why this can't go in overlay | Re-conflict probability per rebase | Fallback if upstream refactors |
|------|-----------|------------------------------|------------------------------------|---------------------------------|
| `core-plugins/src/manifest.rs` | +40 | Manifest is the schema; consumers across `tui`, `core`, `core-plugins` read it directly. No overlay path. | **Low** — additive optional field, last position. | Re-add field after upstream patches; serde-default keeps old manifests parsing. |
| `tui/src/bottom_pane/status_line_setup.rs` | +50 | Closed `pub(crate) enum`; cannot extend from overlay. | **Medium** — upstream is actively adding `StatusLineItem` variants (added `TaskProgress`, `FastMode`, `RawOutput`, `BranchChanges` in recent versions). Variant insertion order conflicts likely. | Re-port `Plugin` variant; strum derives auto-pick up new ordering. |
| `tui/src/bottom_pane/status_surface_preview.rs` | +15 | Parallel closed enum to the above. | **Medium** — same churn pattern. | Re-port. |
| `tui/src/bottom_pane/footer.rs` | +10 | High-touch file per upstream `AGENTS.md`. | **High** — every rebase touches it. | Re-port render-arm; protected by a new snapshot test that fails loud. |
| 16 snapshot files | re-baselined | UI rendering. | **High** — any upstream UI change diffs them. | Re-bake during rebase. |

**Invariant register (`docs/implementation/patch-surface.md` §14 entry to add):**
- *Invariant N*: `StatusLineItem::Plugin` and `StatusSurfacePreviewItem::Plugin` variants exist and are reachable from `core-plugins::PluginManifest::statusline`.
- *Enforcing test*: new `codex-rs-overlay/codex-invariant-tests/src/statusline_plugin.rs` — parses a fixture manifest with `statusline: { command: "echo hi" }`, asserts the variant exists and renders.

### Operator decision required for Item 1
**SURFACE TO OPERATOR before any implementation:**
- Default = **defer** (keep in-band prefix workaround; revisit when upstream proposes its own API).
- Alternative = ship the ~120–180 LoC upstream-canonical edit with snapshot re-baseline and the §14 invariant entry. Pre-commit a §15 rebase-replant note ("if upstream adds `StatusLineItem::*` variants, re-order our `Plugin` variant last and re-bake snapshots").

---

## Item 2 detail — `request_user_input` PreToolUse + auto-respond seam

### Recommended verdict: **SHIP** in next codex release window

### Story breakdown

#### Story 2.1 — Codex-side: extend `PreToolUseHookResult` with `SyntheticResponse(Value)` variant

**Files (all upstream-canonical edits at tenet 1.2 — small edits at a single seam):**

1. **`core/src/hook_runtime.rs:54–56`** — extend the enum:
   ```rust
   pub(crate) enum PreToolUseHookResult {
       Continue { updated_input: Option<Value> },
       Blocked(String),
       SyntheticResponse(Value),  // NEW: hook returns the value as if the tool succeeded
   }
   ```
   And in `run_pre_tool_use_hooks` (lines 160–215), recognize a new hook output sentinel — when the hook's stdout JSON contains `{ "syntheticResponse": <value> }`, emit `SyntheticResponse(value)`. ~25 LoC.

2. **`core/src/tools/registry.rs:487–531`** — add the third match arm:
   ```rust
   PreToolUseHookResult::SyntheticResponse(value) => {
       let content = serde_json::to_string(&value).map_err(|e| FunctionCallError::Fatal(...))?;
       notify_tool_finish(&invocation, ToolCallOutcome::Succeeded).await;
       return Ok(boxed_tool_output(FunctionToolOutput::from_text(content, Some(true))));
   }
   ```
   ~15 LoC. The arm short-circuits the handler entirely — the synthetic value reaches the model as a successful tool result.

3. **`hooks/src/engine/output_parser.rs`** — recognize `syntheticResponse` in PreToolUse hook stdout. ~20 LoC. (The hook protocol already carries JSON-shaped continuations; this is an additive sentinel field.)

4. **`hooks/src/events/pre_tool_use.rs`** — extend `PreToolUseOutcome` with `synthetic_response: Option<Value>` field; thread it through `run()`. ~15 LoC.

5. **Test coverage**:
   - Unit test in `core/src/tools/registry.rs`'s test module: `synthetic_response_short_circuits_handler` — registers a fake tool whose handler panics, registers a hook that emits `SyntheticResponse(json!({"answer": "test"}))`, asserts handler never runs and result equals the synthetic value. ~40 LoC.
   - Integration test in `hooks/src/events/pre_tool_use.rs` tests module: hook command outputs `{"syntheticResponse": {...}}` JSON → `PreToolUseOutcome.synthetic_response.is_some()`. ~30 LoC.
   - Invariant test (new) in `codex-rs-overlay/codex-invariant-tests/src/synthetic_response.rs`: end-to-end — register PreToolUse hook for `request_user_input`, fire a `RequestUserInputArgs`, assert the model sees a normal `RequestUserInputResponse` JSON without the tool's internal dispatch ever calling `session.request_user_input()`. ~60 LoC.

**Upstream-canonical edit budget:**

| File | LoC delta | Why this can't go in overlay | Re-conflict probability | Fallback |
|------|-----------|------------------------------|-------------------------|----------|
| `core/src/hook_runtime.rs` | +25 | Enum is private to `core`; `pub(crate)`. Match-arm dispatch is owned by the same crate. | **Low** — file is stable. Last touched in v0.128.0 for `PreCompactHookOutcome` reorg. | Re-add variant; strum-style no derives, plain match expansion. |
| `core/src/tools/registry.rs` | +15 | Tool dispatcher is upstream-owned. | **Low** — match arms are additive; upstream rarely refactors the if-let block at line 487. | Re-add arm; covered by the invariant test. |
| `hooks/src/engine/output_parser.rs` | +20 | Hook stdout parsing is upstream-owned. | **Low** — additive sentinel field. | Re-add parse rule. |
| `hooks/src/events/pre_tool_use.rs` | +15 | `PreToolUseOutcome` is the hook event type. | **Low** — additive field. | Re-add field with serde default. |

**Total upstream-canonical edit budget: ~75 LoC + ~130 LoC test code. Zero touch on the `tui` crate. Zero snapshot test re-baselining.**

**`// SANDBOX PATCH:` markers + `patch-surface.md` §14 invariant register entry** required per `codex/CLAUDE.md` tenet 1: one §14 entry stating "PreToolUseHookResult has a SyntheticResponse variant that short-circuits the tool handler with a synthetic success value" — enforced by the invariant test in `codex-rs-overlay/codex-invariant-tests/src/synthetic_response.rs`.

#### Story 2.2 — Plugin-side: register PreToolUse hook in `codexu-options-mode-plugin`

**Files (all codexu-side, zero codex impact):**

1. **`packages/codexu-options-mode-plugin/hooks/hooks.json`** — add:
   ```jsonc
   {
     "matcher": "request_user_input",
     "hooks": [
       { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.js" }
     ]
   }
   ```
   under a new `PreToolUse` array. ~10 LoC.

2. **`packages/codexu-options-mode-plugin/hooks/pre-tool-use.js`** (NEW, ~70 LoC) — reads `tool_input` (the `RequestUserInputArgs`), reads PLUGIN_DATA config for current mode. If mode != `auto`, outputs `{}` (no-op, hook returns `Continue { updated_input: None }`). If mode == `auto`, builds a synthetic `RequestUserInputResponse` by selecting the first option for each question and outputs `{ "syntheticResponse": { "responses": [...] } }`.

3. **`packages/codexu-options-mode-plugin/tests/pre-tool-use.test.ts`** (NEW, ~120 LoC) — vitest cases: mode-off no-op; mode-on no-op (only `auto` intercepts); mode-auto picks first option; mode-auto with empty options → no-op + warning.

4. **`packages/codexu-options-mode-plugin/README.md`** — remove the "PreToolUse AskUserQuestion auto-intercept is deferred" gap line; add a §"Auto mode" subsection documenting the new behavior and the minimum codex version required (`v0.135.x-copilot-api.N` once Story 2.1 ships).

#### Story 2.3 — Smoke + version pin

1. **`packages/codexu-options-mode-plugin/scripts/smoke.mjs`** — add a smoke case that mocks PreToolUse hook input and asserts the script emits the right `syntheticResponse` shape.
2. **`packages/codexu-options-mode-plugin/.codex-plugin/plugin.json`** — bump `codexVersion` minimum to the release that ships Story 2.1.

### Why split Story 2 across two commits, not bundle
Story 2.1 lands in the **codex submodule** (separate repo `gim-home/codex`); Story 2.2/2.3 land in **codexu**. They cannot be one commit. The codexu submodule-pointer bump that picks up Story 2.1 lands AFTER `v0.135.x-copilot-api.N` is published, in the same codexu commit that ships Story 2.2.

---

## Bundle-vs-split call (final)

**SPLIT** into three independent ships:

1. **Item 2 Story 2.1** — codex submodule (`gim-home/codex`): `v0.135.x-copilot-api.N` release with `PreToolUseHookResult::SyntheticResponse` variant. Single PR, no UI changes, four touched files, ~75 LoC + ~130 LoC tests.
2. **Item 2 Story 2.2 + 2.3** — codexu repo: plugin hooks.json + pre-tool-use.js + tests + README update + plugin.json version bump pointing at the new codex release. Single PR.
3. **Item 1** — held. Re-evaluate after the next two upstream codex releases to see if upstream proposes its own plugin-statusline API (active topic per the `StatusLineItem` churn pattern visible in v0.133 → v0.135).

**Why not bundle Item 1 with Item 2:** The two items share zero files, zero test surface, zero risk vectors. Item 1's "High" conflict-surface budget is the dominant risk — bundling forces Item 2 (low risk, ready to ship) to wait on Item 1 (which may not ship at all if the operator chooses defer). Splitting is the strictly-dominated choice.

**Why not bundle Story 2.1 + 2.2/2.3 across the repo boundary:** mechanical — they're in different git repos. Story 2.2/2.3 cannot be tested end-to-end until Story 2.1 is in a published codex release.

---

## CI gating

Per `codex/CLAUDE.md` § "cargo test --workspace is for CI, not local iteration":

### Local (Item 2 Story 2.1)
- `cd codex/external/repos/codex-patched/codex-rs && cargo check --workspace` (the standard typecheck gate; ~6 min).
- `cargo test -p codex-core` (covers `core/src/tools/registry.rs` and `core/src/hook_runtime.rs` unit tests, including the new `synthetic_response_short_circuits_handler`).
- `cargo test -p codex-hooks` (covers `hooks/src/engine/output_parser.rs` and `hooks/src/events/pre_tool_use.rs` units).
- `cargo test -p codex-invariant-tests` (the new `synthetic_response.rs` invariant).
- `cd codex && bash scripts/audit_network_calls.sh` (no new endpoints; this is a hook-runtime change, but run anyway per tenet 1 hygiene).

### CI (Item 2 Story 2.1)
- `.github/workflows/invariant-check.yml` on `gim-home/codex` runs `cargo test --workspace` on `ubuntu-latest` + `windows-latest`. This is the authoritative gate for Story 2.1's enum-variant addition (catches any consumer of `PreToolUseHookResult` we missed during the edit).
- `.github/workflows/publish-npm.yml` builds + publishes `v0.135.x-copilot-api.N` after the PR merges. Manual trigger.

### Local (Item 2 Story 2.2/2.3)
- `pnpm install`
- `pnpm --filter '{packages/codexu-options-mode-plugin}' typecheck`
- `pnpm --filter '{packages/codexu-options-mode-plugin}' test` (vitest, includes the new `pre-tool-use.test.ts`).
- `node packages/codexu-options-mode-plugin/scripts/smoke.mjs` (covers the new smoke case).
- Manual end-to-end: register the plugin via `codex plugin marketplace add ./packages/codexu-options-mode-plugin`, enter `/options-mode auto`, prompt the agent to call `request_user_input` with two options, observe that the agent loop continues without prompting the user.

### CI (Item 2 Story 2.2/2.3)
- codexu CI runs `pnpm typecheck` + `pnpm test` across the workspace; the new plugin tests participate automatically.

---

## Operator decision surface (REQUIRED BEFORE IMPLEMENTATION)

The following decisions cannot be made by the impl agent; the bookkeeper must
relay these to the operator and get an explicit yes/no on each:

### D1 — Ship Item 1 at all?
- **Default = NO.** Defer until upstream proposes a statusline-plugin API.
- **YES path:** accept the ~120–180 LoC upstream-canonical edit + 16 snapshot re-bakes; pre-commit the §14 invariant register entry; accept the "Medium / High" re-conflict probabilities documented above.

### D2 — Item 2 hook-result variant name and protocol shape
- Recommendation: **`PreToolUseHookResult::SyntheticResponse(Value)`** with hook-stdout sentinel `{"syntheticResponse": <value>}`.
- Alternative: `SyntheticToolResult(Value)` with sentinel `{"toolResult": <value>}` — more generic if we want to reuse the same protocol for `PostToolUse` later.
- Decision: pick a name now to avoid bikeshedding mid-impl.

### D3 — Item 2 default behavior when `args.questions[i].options` is empty
- Recommendation: **emit a warning to stderr, return `Continue { updated_input: None }`** (no-op, fall through to the human-input path). Defending: zero-option questions are malformed model output; auto-mode should not invent options.
- Alternative: error out the tool with `Blocked("auto mode requires non-empty options")` so the model gets feedback to retry with options.
- Decision: pick a default behavior contract; document in README.

### D4 — Item 2 release-version pin
- The codexu plugin's `plugin.json` will list a minimum codex version. Story 2.1 ships in codex `v0.135.x-copilot-api.N` — the exact `N` is set at codex release time. Story 2.2/2.3's PR should land WITH the minimum-version bump in the same commit so users on older codex see a clean version-skew error rather than a silent feature gap.
- Decision: confirm the codex release flow (`/publish-sandbox-patch` in `codex/`) is the path, and that the next available `N` is the target.

---

## Reference artifacts

- `codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/status_line_setup.rs:55` — closed `StatusLineItem` enum.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/request_user_input.rs:24` — `RequestUserInputHandler` impl block (no `pre_tool_use_payload` override).
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/registry.rs:101` — default `pre_tool_use_payload()` returning `Some(...)`.
- `codex/external/repos/codex-patched/codex-rs/core/src/hook_runtime.rs:54` — `PreToolUseHookResult` enum.
- `codex/external/repos/codex-patched/codex-rs/core/src/tools/registry.rs:487` — tool dispatch site invoking `run_pre_tool_use_hooks`.
- `packages/codexu-options-mode-plugin/README.md:62–66` — current "Known Gaps" block listing the two deferred items.
- `plans/codexu-roadmap.md` § "Codex changes — minimize upstream conflict surface" — tenet authority.
- `codex/CLAUDE.md` § "Core engineering tenants" — tenet 1/2/3 authority.
- `codex/docs/implementation/patch-surface.md` §14 — invariant register location.
- `codex/docs/implementation/patch-surface.md` §15 — rebase-replant note location.
