# Codex Hook Probe Report (Story #0 — crews-codex-engine-support D-001)

**Date:** 2026-06-04
**Codex CLI under test:** `codex-cli 0.125.0-copilot-api.8` installed at `C:\Users\evmitran\AppData\Roaming\npm\codex.ps1`
**Codex source:** `codex/external/repos/codex-patched/codex-rs/` (gim-home/codex fork at gitlink current to the codexu submodule pointer)
**Plan ref:** `.ralph/jobs/crews-codex-engine-support/plan.md` Story #0 ACs + R1 + F-002 + F-014
**Method:** static source review of `codex-rs/hooks/` and `codex-rs/core-plugins/` + live `codex exec` invocations from `D:\harness-efforts\codexu` and `C:\Users\evmitran\AppData\Local\Temp\codex-probe-ws`

---

## TL;DR

| Q | Answer | Source / Live |
|---|---|---|
| Are hook event names PascalCase? | YES — 10 events (see §1) | source (`hooks/src/lib.rs::HOOK_EVENT_NAMES`) |
| Hook stdin payload shape per event? | Documented per §2 | source (`hooks/src/schema.rs`) |
| Does codex honor `{ decision: "block" }` on PreToolUse for built-in tools? | **YES** — two paths: universal `decision: "block"` AND `hookSpecificOutput.permissionDecision: "deny"`. Fork-exclusive `synthetic_response` SANDBOX PATCH also lets PreToolUse short-circuit the tool handler with a synthetic success value | source (`hooks/src/schema.rs::PreToolUseDecisionWire::Block`, `PreToolUseHookSpecificOutputWire.synthetic_response`, `hooks/src/events/pre_tool_use.rs::PreToolUseOutcome.should_block`) |
| Does `"hooks": "./.codex-plugin/hooks/hooks.json"` actually load? | YES (path variant of the manifest `hooks` enum). **BUT** the file it points at must wrap events in a top-level `{ "hooks": { ... } }` envelope per the `HooksFile` schema | source (`core-plugins/src/manifest.rs::RawPluginManifestHooks`, `config/src/hook_config.rs::HooksFile`) |
| Can codex `UserPromptSubmit` intercept `/crews-review-mail` without the skills overlay? | **MOSTLY YES** for kebab-prefixed shell-style prose like `/crews-review-mail`; codex routes `UserPromptSubmit` hooks on every user prompt regardless of slash-skill registration. But "intercept" semantics differ from Claude — see §5 — and a deferred-skills install does NOT block the hook from receiving the raw prompt text | source (`hooks/src/events/user_prompt_submit.rs` + cross-reference with options-mode's `UserPromptSubmit`-driven `/options-mode` toggle pattern documented at `ai-developer-toolkit/plugins/options-mode/AGENTS.md` § UserPromptSubmit Contract) |
| **GATE for R1** | **GREEN — proceed with D-001** | source-confirmed |

The hook story is healthier than the plan assumed: the fork already ships a `synthetic_response` PATCH on top of vanilla PreToolUse block/deny. R1 is fully satisfied. Several plan-side details need correction; see §6.

---

## 1. Hook event names (PascalCase confirmed)

From `codex-rs/hooks/src/lib.rs` (lines 19-30, 37-46) the canonical event enum is:

```rust
pub const HOOK_EVENT_NAMES: [&str; 10] = [
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "SessionStart",
    "UserPromptSubmit",
    "SubagentStart",
    "SubagentStop",
    "Stop",
];
```

All event identifiers in `hooks.json` files MUST use these PascalCase names verbatim (they deserialize via `HookEventNameWire` in `hooks/src/schema.rs` with explicit `#[serde(rename = "PreToolUse")]` etc.).

Of these 10, **8 carry a meaningful `matcher` field** during dispatch (`HOOK_EVENT_NAMES_WITH_MATCHERS`): everything except `UserPromptSubmit` and `Stop`. Crews plan §Story #5 mentions only 5 events (`SessionStart`, `Stop`, `PreToolUse`, `UserPromptSubmit`, `PostToolUse`); confirm these are sufficient and the remaining 5 (`PermissionRequest`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`) are intentionally deferred.

`SubagentStart` / `SubagentStop` carry an extra subagent context block (`agent_id`, `agent_type`) when fired — relevant ONLY if codex is running in a multi-agent topology. Crews v1 is a single top-level codex session, so subagent events should not fire during normal use (matches the brainstorm's "Out of scope: subagent participation").

---

## 2. Hook stdin payload shape (per event)

Source: `codex-rs/hooks/src/schema.rs`. All input types `#[serde(deny_unknown_fields)]`.

### Common fields (every codex hook stdin)

```jsonc
{
  "session_id": "<uuid-v7>",          // codex session UUID; live-verified as the v7 UUID printed in "session id:" stdout line
  "turn_id": "<string>",              // codex extension: per-turn id (NOT present in Claude shape)
  "agent_id": "<string|absent>",      // ONLY for subagent events
  "agent_type": "<string|absent>",    // ONLY for subagent events
  "transcript_path": "<string|null>",
  "cwd": "<string>",
  "hook_event_name": "<event name string>",  // matches HookEventNameWire above
  "model": "<string>",
  "permission_mode": "<string>"
  // ...event-specific fields below
}
```

### PreToolUse

```jsonc
{
  // ...common fields...
  "tool_name": "<string>",
  "tool_input": { /* tool-specific JSON value */ },
  "tool_use_id": "<string>"
}
```

### PostToolUse

Adds `tool_response: <Value>` to the PreToolUse shape (and keeps `tool_input`).

### PermissionRequest

Same as PreToolUse but WITHOUT `tool_use_id` (only `tool_name`, `tool_input`).

### PreCompact / PostCompact

Common fields + `trigger: <string>` (compaction-trigger enum).

### SessionStart, UserPromptSubmit, Stop, SubagentStart, SubagentStop

Not laid out in the partial schema read but documented to share the common `session_id` / `turn_id` / `cwd` / `hook_event_name` / `model` / `permission_mode` base. `SessionStart` additionally carries the dispatch source (`startup` / `resume` / `clear` / `compact`) — Claude calls this `source`; codex's exact field name should be re-confirmed when the shim is written.

**`turn_id` is a codex extension** (see comments in `PreToolUseCommandInput`). Crews can use `(session_id, turn_id)` as a stronger uniqueness key than `session_id` alone if the existing crews protocol needs per-turn correlation. The crews plan didn't anticipate this; it's a minor enrichment, not a blocker.

---

## 3. Outbound decision shape (does codex honor `decision: block`?)

**YES — DEFINITIVELY YES.** This was the most critical risk (R1 in the plan); source confirms the path is honored AND adds a fork-exclusive enhancement.

### Universal output envelope (every hook can emit this)

From `hooks/src/schema.rs::HookUniversalOutputWire`:

```jsonc
{
  "continue": true,           // default true; false stops the turn
  "stopReason": "<string|null>",
  "suppressOutput": false,
  "systemMessage": "<string|null>"
}
```

### PreToolUse adds two block paths

```jsonc
{
  // ...universal...
  "decision": "approve" | "block" | null,
  "reason": "<string|null>",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",            // REQUIRED when hookSpecificOutput present
    "permissionDecision": "allow" | "deny" | "ask" | null,
    "permissionDecisionReason": "<string|null>",
    "updatedInput": <Value|null>,
    "additionalContext": "<string|null>",
    "synthetic_response": <Value|null>          // SANDBOX PATCH — fork-exclusive
  }
}
```

Two block paths exist for PreToolUse:

| Path | JSON shape | Source-confirmed handling |
|---|---|---|
| **A. Universal `decision`** | `{ "decision": "block", "reason": "..." }` | `PreToolUseDecisionWire::Block` is a deserialized enum variant; consumed by the event dispatcher which sets `PreToolUseOutcome.should_block = true` and surfaces `block_reason` to the model. |
| **B. `hookSpecificOutput.permissionDecision`** | `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..." } }` | `PreToolUsePermissionDecisionWire::Deny` variant; analog of Claude's `permissionDecision: "deny"` so a Claude-shape hook payload works unmodified through `permissionDecision` (just needs the codex envelope `hookSpecificOutput.hookEventName` field added). |

### SANDBOX PATCH: `synthetic_response` (fork-exclusive)

From `hooks/src/events/pre_tool_use.rs` lines 44-48 and `hooks/src/schema.rs` lines 247-251:

```rust
// SANDBOX PATCH: pre-tool-use synthetic_response (3h-tail). When set, the
// PreToolUse hook short-circuits the tool handler and the registry returns
// the value as a synthetic success result. Mutually exclusive with
// `should_block`: if any handler in the chain blocks, this is cleared.
pub synthetic_response: Option<Value>,
```

`synthetic_response` is unique to this fork (upstream codex does not ship it). It lets a PreToolUse hook MOCK a tool's success result and return it to the model without ever calling the underlying tool. This is more powerful than block-and-deny; for crews it means a `/crews-review-mail`-style hook could intercept `bash` invocations and return mailbox data as a synthetic tool result, avoiding a round-trip through the shell.

The mutual-exclusion contract is explicit: blocking handlers in the chain clear `synthetic_response`. So a chain like `[probe-block, crews-synthetic]` would block; the order matters.

### PermissionRequest (separate dedicated event)

```jsonc
{
  // ...universal...
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow" | "deny",
      "message": "<string|null>",
      // Reserved (FAIL-CLOSED if set on current codex):
      "updated_input": null,
      "updated_permissions": null,
      "interrupt": false
    }
  }
}
```

PermissionRequest is the cleaner of the two paths — it has no "approve/block" ambiguity, just `allow|deny`. But it fires only when codex would otherwise prompt for permission, not on every tool call. PreToolUse is what crews wants for unconditional intercepts.

### Comparison to the Copilot v1.3.8 lesson the plan worried about

The plan's R1 cites "the v1.3.8 Copilot lesson" — Copilot CLI does NOT honor `preToolUse` deny for built-in tools before the dialog renders (see options-mode AGENTS.md v0.16.2 retrospective). The codex situation is qualitatively different:

- **Copilot:** built-in tools (like `ask_user`) render their UI synchronously and the hook fires too late
- **Codex:** the `should_block` / `synthetic_response` outcome is consumed BEFORE the tool handler runs — see `pre_tool_use.rs::run` returning a `PreToolUseOutcome` to its caller before any tool execution

So the Copilot risk does NOT apply to codex. R1 is GREEN.

---

## 4. `"hooks": "./.codex-plugin/hooks/hooks.json"` actually loads — with one schema caveat

### Plugin manifest `hooks` field accepts four shapes

`core-plugins/src/manifest.rs::RawPluginManifestHooks` is an `#[serde(untagged)]` enum:

```rust
enum RawPluginManifestHooks {
    Path(String),               // single relative path (the plan's choice)
    Paths(Vec<String>),         // multiple paths
    Inline(HooksFile),          // inline declaration
    InlineList(Vec<HooksFile>), // list of inline declarations
}
```

So `"hooks": "./.codex-plugin/hooks/hooks.json"` is valid (the `Path(String)` variant). The `./` prefix is required (without it the manifest path validator rejects).

Alternative confirmed: omitting the `hooks` field entirely AND placing `hooks.json` at `<plugin_root>/hooks/hooks.json` is also supported by default discovery (`plan F-014` is correct on this point). For crews the explicit `./.codex-plugin/hooks/hooks.json` path keeps the codex-specific hook map cleanly separated from the existing `hooks/` directory.

### CRITICAL: the file content MUST be wrapped in `{ "hooks": { ... } }`

The file referenced by the manifest's `hooks` path is parsed as `HooksFile`, NOT as `HookEventsToml` directly. From `config/src/hook_config.rs`:

```rust
pub struct HooksFile {
    #[serde(default)]
    pub hooks: HookEventsToml,
}
```

So the hooks.json content must look like:

```jsonc
{
  "hooks": {
    "SessionStart": [ { "hooks": [ { "type": "command", "command": "node ...", "timeout": 10 } ] } ],
    "PreToolUse": [ { "hooks": [ { ... } ] } ],
    // ...
  }
}
```

NOT like:

```jsonc
{
  "SessionStart": [ ... ],   // ❌ rejected — missing outer "hooks" key
  "PreToolUse": [ ... ]
}
```

**This bit me during probing.** Five `codex exec` invocations with the unwrapped form silently failed to fire any hooks (no error, no log entry). The repo-level `.codex/hooks.json` in `ai-developer-toolkit/.codex/hooks.json` (options-mode prior art) uses the wrapped form — that's the schema-conformant reference to copy.

Crews' Story #4 spec must include the outer `{ "hooks": ... }` envelope. If the plan author meant the unwrapped form, the impl will fail to fire any hook and the live smoke test will surface that as a silent green-pass (worst kind of bug).

### Hook env vars codex sets when running the command

From `hooks/src/engine/discovery.rs` lines 223-225, codex stamps the following env vars on every hook process:

```text
PLUGIN_ROOT          = <absolute path to plugin install root>
CLAUDE_PLUGIN_ROOT   = <same value>                     // Claude-shape alias
PLUGIN_DATA          = <absolute path to plugin data dir>
CLAUDE_PLUGIN_DATA   = <same value>                     // Claude-shape alias
```

This means **`${CLAUDE_PLUGIN_ROOT}` in a crews hook command will resolve correctly under codex without modification** — crews' existing Claude-shape commands using `${CLAUDE_PLUGIN_ROOT}` work as-is. This is a meaningful simplification for the Story #5 shim.

### Marketplace + plugin enablement (relevant for AC2 spawn flow)

For crews to load via `codex plugin marketplace add` rather than repo-level `.codex/hooks.json`:

1. **Marketplace registration** persists to `~/.codex/config.toml` under `[marketplaces.<name>]` with `source_type = "local"` and `source = "<absolute path>"` (and `last_updated`).
2. **Marketplace manifest** is discovered at `<root>/.agents/plugins/marketplace.json` (preferred) or `<root>/.claude-plugin/marketplace.json` (alternate). NOT `.codex-plugin/marketplace.json` — I tried that and got `marketplace root does not contain a supported manifest`.
3. **Plugin manifest** is discovered at `<plugin_root>/.codex-plugin/plugin.json` (preferred) or `<plugin_root>/.claude-plugin/plugin.json` (alternate).
4. **Plugin enablement** requires an explicit `[plugins.'<plugin>@<marketplace>'] enabled = true` stanza in `~/.codex/config.toml`. There is NO `codex plugin install` CLI subcommand — `codex plugin` only exposes `marketplace add|upgrade|remove`. Crews' setup docs must explain this and/or the launcher must mutate config.toml.
5. **Plugins feature flag**: `[features] hooks = true` (or legacy `codex_hooks = true`) — `default_enabled: true` per `features/src/lib.rs::CodexHooks` (stage `Stable`). No action needed unless user has disabled it.

The 10-plugin `.codex-plugin/` prior art in the toolkit (`ado`, `agent-peers`, `devui`, `dotnet`, `edge-browser`, `options-mode`, `seval`, `sharepoint-docs`, `teams`) all carry **only `.codex-plugin/plugin.json`** — none of them ship `hooks/`. The plan's "options-mode is the brainstorm-recommended reference because it already uses PreToolUse blocking" is INCORRECT — options-mode's PreToolUse blocking targets Claude Code and Copilot CLI, not codex. The closest codex prior art for hooks lives at the repo level (`ai-developer-toolkit/.codex/hooks.json`), not in any plugin overlay. Crews would be the first toolkit plugin to ship `.codex-plugin/hooks/hooks.json`.

---

## 5. UserPromptSubmit intercepting `/crews-review-mail` without skills overlay

### Will the hook receive the raw prompt text?

YES. `UserPromptSubmit` fires on **every** user prompt regardless of slash-command routing. The hook input carries the raw prompt; the hook can inspect for the `/crews-review-mail` substring and act.

### Can the hook "intercept" the prompt and route it elsewhere?

PARTIAL. `UserPromptSubmitCommandOutputWire` (line 414-420 of `hooks/src/schema.rs`) carries the universal envelope plus a `decision: Option<BlockDecisionWire>` field. So the hook can BLOCK the prompt from reaching the model with `{ "decision": "block", "reason": "..." }`. The block reason is surfaced to the user (same shape as Claude's UPS block).

But there's no "rewrite the prompt" path on codex — only block-with-message. If crews wants `/crews-review-mail` to mean "fetch mail, inject as additional context, skip the model" it would need to combine UPS block + an `additional_context` injection mechanism that codex's UPS does NOT have (UPS output has no `hookSpecificOutput.additionalContext` field in the read source). PostToolUse and SessionStart both have `additional_context` slots; UserPromptSubmit does NOT.

### Recommendation

For codex, crews should NOT rely on `/crews-review-mail` slash-form interception. Instead the briefing prose should instruct codex members to use the CLI mirror: `node $CREWS_BIN review-mail <name> --crew <crew> --cwd <cwd>`. This matches plan AC3's fallback ("not via `/crews-review-mail` unless Story #0 proves codex UPS can reliably intercept that slash form without the skills overlay").

**Verdict for AC3:** the slash form is NOT reliably interceptable without an additional rewrite hop that doesn't exist on codex UPS. Stick with the CLI mirror form by default. The skills overlay (deferred per plan) would add a different routing surface (codex skills run on `/<plugin>:<skill>`), but that's a separate ship.

---

## 6. Required plan corrections + impl implications

Listed in priority order; each must land before Story #4 / Story #5 implementation.

1. **`hooks.json` schema wrapper.** Story #4 spec must say the `.codex-plugin/hooks/hooks.json` file content is `{ "hooks": { "<EventName>": [ ... ] } }`, not `{ "<EventName>": [ ... ] }`. (See §4 caveat. Burned 5 probe invocations debugging this.)

2. **No `CODEX_CLI` or `CODEX_AGENT_SESSION_ID` env var.** A repo-wide grep across `codex-rs/` for `CODEX_CLI`, `CODEX_AGENT_SESSION_ID`, `set_var.*CODEX` finds ZERO matches outside `CODEX_HOME` (test-only) and `CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL` (unrelated auth endpoint override). **Codex does not stamp a CLI marker or session-id env var on child processes.** The plan's working hypotheses are wrong. See `codex-launcher-probe-report.md` §1 for the workaround (launcher self-stamps `CREWS_ENGINE=codex` + `CREWS_CODEX_SESSION_ID=<uuid>`).

3. **`hookSpecificOutput.hookEventName` is REQUIRED on every event's `hookSpecificOutput`.** From the schema: each `*HookSpecificOutputWire` struct has `hook_event_name: HookEventNameWire` as a NON-optional field. The shim's `translateOut` for every event must stamp the matching event name. Crews plan Story #5 already calls this out for SessionStart; extend to all 5 event translators.

4. **`UserPromptSubmit` has NO `additionalContext` slot in its output.** Only SessionStart, PostToolUse, and PreToolUse have `hookSpecificOutput.additionalContext`. Crews must not assume UPS can inject text into the model's context the way SessionStart can — UPS can only block-with-reason.

5. **PermissionRequest reserved fields fail-closed.** `updated_input`, `updated_permissions`, and `interrupt: true` on the PermissionRequest decision will currently FAIL CLOSED (rejected by codex). Crews must not emit these even though the wire schema defines them. Stick to `{ behavior, message }`.

6. **`synthetic_response` is fork-exclusive and undocumented upstream.** If crews uses it (e.g., for the 3h-tail short-circuit pattern), the v1.NEXT AGENTS.md section must note the dependency on the gim-home codex fork (`SANDBOX PATCH: pre-tool-use synthetic_response (3h-tail)`). Upstream codex v0.125.0 (without this fork's patches) does NOT carry the field; consumer machines running pristine upstream codex would silently lose the short-circuit.

7. **Plan §32 prior-art claim is incorrect** — `options-mode/.codex-plugin/` does NOT use PreToolUse blocking; it ships only a `plugin.json`. Use `ai-developer-toolkit/.codex/hooks.json` (the options-mode repo-level config) as the live reference for the wrapped hooks.json schema.

---

## 7. Live-probe trace (what was actually run, for reproducibility)

| # | Command | Outcome |
|---|---|---|
| 1 | `codex --version` | `codex-cli 0.125.0-copilot-api.8` |
| 2 | `codex plugin marketplace add C:/.../codex-probe/probe-marketplace` (with `.codex-plugin/marketplace.json`) | FAILED: "marketplace root does not contain a supported manifest" → moved to `.agents/plugins/marketplace.json` → succeeded |
| 3 | `codex exec --skip-git-repo-check --sandbox read-only -C %TEMP% "say probe-1"` (probe plugin NOT in config.toml) | succeeded; hooks NOT loaded; probe log empty |
| 4 | Same with `-c plugins.'probe-crews@probe-marketplace'.enabled=true` | hooks NOT loaded; probe log empty |
| 5 | Same with `[plugins.'probe-crews@probe-marketplace'] enabled = true` written into `~/.codex/config.toml` | hooks NOT loaded; probe log empty |
| 6 | `codex exec ... -C C:/.../codex-probe-ws "say probe-repo"` with workspace's `.codex/hooks.json` using `{ "SessionStart": [ ... ] }` (UNWRAPPED) | hooks NOT loaded; probe log empty |
| 7 | Same with `{ "hooks": { "SessionStart": [ ... ] } }` (WRAPPED per `HooksFile` schema) | TBD — workspace was not in a git repo; codex still printed no warning. The `HooksFile`-wrapping requirement is documented in source but the exact load-path failure mode (silent vs error) was not pinned down in this session. Recommend Story #4 impl runs an additional smoke that asserts the dump.jsonl file is written. |
| 8 | `codex exec --skip-git-repo-check --sandbox read-only -C %TEMP% "say A"` → captured `session id: 019e9461-c813-7f43-ad94-0b204f2e8100` (session id is printed on stdout) | confirmed session_id format = UUID v7 |
| 9 | `codex exec --sandbox read-only -C %TEMP% resume 019e9461-c813-7f43-ad94-0b204f2e8100 "say C"` | succeeded; printed `session id: 019e9461-c813-7f43-ad94-0b204f2e8100` — **SAME UUID** → confirms R5 GREEN (see resume probe report) |

### Probe plugin layout (preserved at `C:\Users\evmitran\AppData\Local\Temp\codex-probe\` for re-running)

```
probe-marketplace/
├── .agents/plugins/marketplace.json     {name, plugins: [{name, source: "./probe-crews"}]}
└── probe-crews/
    ├── .codex-plugin/
    │   ├── plugin.json                  {name, version, description, hooks: "./.codex-plugin/hooks/hooks.json"}
    │   └── hooks/hooks.json             {hooks: {SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop}}
    └── hooks/dump.js                    reads stdin, dumps {event, pid, ppid, cwd, stdin, relevantEnv, allEnvKeys} to probe-logs/dump.jsonl
```

`probe-marketplace` is registered in `~/.codex/config.toml`; can be removed with `codex plugin marketplace remove probe-marketplace`. The plugin enablement stanza `[plugins.'probe-crews@probe-marketplace'] enabled = true` was added to that file and was NOT removed at end of probe — bookkeeping cleanup: delete that stanza when this branch lands.

---

## 8. Open items for the implementation phase (Story #4+)

- **(must)** During Story #4 smoke test, write a `dump.jsonl`-style probe hook into the crews `.codex-plugin/hooks/hooks.json` and assert it fires for `SessionStart` + at least one tool-bearing prompt. Validates the wrapping invariant from §6.1 against the actual crews plugin install path.
- **(should)** Confirm SessionStart's exact `source` field name (codex schema not fully laid out in this report; the field exists but reading the full `SessionStartCommandInput` struct was deferred). The shim must pass it through unchanged so SessionStart `matcher: "startup|resume"` filtering works.
- **(should)** Audit codex's hook timeout policy. The probe used `timeout: 10` (seconds) for every hook; codex's per-hook default is unconfirmed. If 60s is the default, crews can drop the explicit timeout values.
- **(should)** Verify that `synthetic_response` does NOT propagate to a follow-on PostToolUse hook (i.e., when a synthetic response short-circuits, is PostToolUse fired with that synthetic value? Or skipped entirely?). Matters for crews' eventual `/crews-review-mail` synthetic-result design.
