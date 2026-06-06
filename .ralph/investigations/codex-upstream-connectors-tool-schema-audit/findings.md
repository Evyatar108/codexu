# codex v134 "connector tool schemas" — what connectors are + fork relevance

**Task:** `codex-upstream-connectors-tool-schema-audit`
**Date:** 2026-06-06
**Mode:** read-only investigation (no source modified)
**Codex tree:** `codex/external/repos/codex-patched/codex-rs` @ submodule (rebased onto upstream `rust-v0.135.0`, so the v134 change is present)

---

## Question

> codex v134 changelog: *"Made connector tool schemas more reliable by preserving
> local `$defs`/`$ref` structures and compacting oversized schemas before exposure."*
> What ARE codex connectors (vs MCP servers / plugins / tools)? And does the fork /
> happy integration expose or consume connector tool schemas?

(The changelog's mangled `\/\` is the JSON-Schema `$defs`/`$ref` local-reference
tokens — see the `sanitize_json_schema` doc comment quoted below.)

---

## TL;DR verdict

**Fork relevance: effectively NONE for the connector-specific framing; LOW/benign for
the underlying schema-compaction code.**

- **Connectors** are **ChatGPT "Apps"** — first-party hosted integrations (Gmail,
  GitHub, Notion, etc.) discovered from the ChatGPT *connector directory* and exposed
  to the model as MCP tools through a host-owned, in-process MCP server named
  `codex_apps`. They are a distinct concept from user-configured **MCP servers**,
  **plugins**, and individual **tools** (see the taxonomy table below).
- The whole connectors/Apps path is **gated on ChatGPT-backend auth**
  (`auth.uses_codex_backend()` → true only for `Chatgpt | ChatgptAuthTokens |
  AgentIdentity`). **This fork is Copilot-only**; `CopilotModelsEndpoint::uses_codex_backend()`
  hard-returns `false` and Copilot auth is never a ChatGPT variant. The `codex_apps`
  MCP server is therefore **never injected**, no connector directory is ever fetched,
  and **no connector tool schema is ever produced or consumed** in fork operation.
- The v134 *implementation* (`compact_large_tool_schema` in `codex-tools`) lives in the
  **generic** MCP tool-schema parser (`parse_tool_input_schema`), which runs for **every**
  MCP tool — including ordinary user-configured MCP servers and happy-cli's own
  `changeTitle` tool. So the fork inherits the robustness improvement for regular MCP
  tools, but this is a general MCP-hygiene win, not a connector feature. It is
  best-effort and only triggers for schemas > 4 000 normalized bytes, so it is inert
  for happy-cli's tiny schemas.
- **No fork patch touches any of this code.** Zero `// SANDBOX PATCH:` markers in
  `tools/src/json_schema.rs`, the `connectors/` crate, `core/src/connectors.rs`, or
  `codex-mcp/src/codex_apps.rs`. Nothing to replant on rebase.

---

## 1. What a "connector" IS (and how it differs from MCP servers / plugins / tools)

A **connector** = a **ChatGPT App**: an OpenAI-hosted third-party integration that the
signed-in ChatGPT user has enabled in their account. Codex pulls the user's enabled apps
from the ChatGPT **connector directory** and surfaces each app's actions to the model.

Evidence — the dedicated `codex-connectors` crate fetches an app directory keyed by the
ChatGPT account:

- `connectors/src/lib.rs:24-46` — `ConnectorDirectoryCacheKey { chatgpt_base_url,
  account_id, chatgpt_user_id, is_workspace_account }`.
- `connectors/src/lib.rs:58-81` — `DirectoryListResponse { apps: Vec<DirectoryApp> }`;
  each `DirectoryApp` carries `id, name, branding, logo_url, distribution_channel,
  visibility` — i.e. an app-store listing, not a local process.
- `core/src/connectors.rs:50-57` — `AppToolApproval`/`enabled` per connector;
  `:166` gates on `config.features.enabled(Feature::Apps)`;
  `:148` gates on `auth.uses_codex_backend()`.

How a connector's tools reach the model — via a **host-owned in-process MCP server**:

- `codex-mcp/src/codex_apps.rs:4-6` (module doc): *"connectors: cache scoping by
  authenticated user … the normalization that turns app connector/tool metadata into
  model-visible MCP callable names."*
- `codex-mcp/src/codex_apps.rs:88-120` `model_visible_codex_apps_tool_name(...)` —
  prefixes/sanitizes `{connector_name}_{tool}` into an MCP callable name.
- `codex-mcp/src/mcp/mod.rs:217-229` `with_codex_apps_mcp(...)` — **inserts** the synthetic
  server `CODEX_APPS_MCP_SERVER_NAME` (`codex_apps`) into the effective MCP server map
  **iff** `host_owned_codex_apps_enabled(config, auth)`, else **removes** it.
- `codex-mcp/src/mcp/mod.rs:233-235`
  `host_owned_codex_apps_enabled = config.apps_enabled && auth.is_some_and(CodexAuth::uses_codex_backend)`.

**Taxonomy — four distinct concepts:**

| Concept | What it is | Source / lifecycle |
|---|---|---|
| **Connector** (ChatGPT App) | OpenAI-hosted 3rd-party integration enabled in the user's ChatGPT account | Fetched from ChatGPT connector *directory*; surfaced via the host-owned `codex_apps` MCP server. ChatGPT-auth-only. |
| **MCP server** | A user-configured external process / URL speaking MCP | `~/.codex/config.toml [mcp_servers.*]`; spawned/connected by codex. |
| **Plugin** | A codex marketplace plugin (skills/commands/MCP bundles) | `core-plugins/` marketplace install. |
| **Tool** | A single model-callable function (built-in like `shell`, or one tool of an MCP server / connector) | Registered in the tool router; schema parsed by `codex-tools`. |

So connectors are *built on top of* the MCP transport (they appear to the model as MCP
tools under the `codex_apps` server), but the **connector concept itself** = the ChatGPT
Apps directory + per-app auth/approval, which is orthogonal to user MCP servers, plugins,
and individual tools.

## 2. The v134 change — what it does and what it fixed

The connector tools' input schemas come from the upstream ChatGPT Apps service and can be
large/complex (deep nesting, big `$defs` tables). Before exposing them to the model they
pass through the **shared tool-schema parser** in the `codex-tools` crate. v134 hardened
that parser in two ways:

**(a) Preserve local `$defs`/`$ref` structures** (the changelog's "local `\/\` structures"):

- `tools/src/json_schema.rs:399-407` `sanitize_json_schema` doc:
  *"Preserves `$ref` and reachable local `$defs` / `definitions`."*
- `tools/src/json_schema.rs:564-581` `collect_reachable_definitions` + `:543-562`
  `prune_schema_table` — keep only the `$defs`/`definitions` entries actually reachable
  from a `$ref`, dropping unreachable ones (shrinks the schema without breaking refs).
- `tools/src/json_schema.rs:641-659` `parse_local_definition_ref` — parses
  `#/$defs/Name`-style local pointers and (per the inline comment at `:652-653`) keeps the
  **parent** definition reachable for nested refs like `#/$defs/User/properties/name`
  that the Responses API non-strict mode allows. This is the "don't mangle local refs"
  fix: previously a ref to a pruned/missing definition could yield an invalid schema.

**(b) Compact oversized schemas before exposure** — best-effort, increasingly lossy passes
run only while the schema is over budget:

- `tools/src/json_schema.rs:190-214` — budget `MAX_COMPACT_TOOL_SCHEMA_BYTES = 4_000`
  (a cheap byte proxy for the ~1k-token schema budget); passes run in order:
  1. `strip_schema_descriptions` (drop `description` text),
  2. `drop_schema_definitions` (rewrite local definition `$ref`s to `{}` **first**, at
     `:330-369`, so downstream behavior doesn't depend on how a parser treats refs to
     missing defs — *then* remove the `$defs`/`definitions` tables),
  3. `collapse_deep_schema_objects_from_root` (replace complex objects below
     `MAX_COMPACT_TOOL_SCHEMA_DEPTH = 2` with `{}`).
- `tools/src/json_schema.rs:199-206` `compact_large_tool_schema` stops at the first pass
  that brings the schema under budget — it preserves the **top-level argument surface**
  and only sheds detail when forced.

**Entry points** (`tools/src/json_schema.rs:158-170`):
- `parse_tool_input_schema` — runs sanitize → prune → **compaction** (used for
  untrusted/external tool schemas, incl. connector and user MCP tools).
- `parse_tool_input_schema_without_compaction` — sanitize → prune only (used for trusted
  first-party schemas, e.g. `ext/web-search`).

**Bug fixed:** large/complex connector (ChatGPT App) tool schemas could (i) break when a
local `$ref` pointed at a definition that sanitization/pruning had altered, and (ii) blow
the model's tool-schema token budget. v134 makes them *reliable* by keeping local refs
valid and deterministically compacting anything over ~4 KB before the model sees it.

## 3. How a connector tool schema actually reaches the parser

All MCP tools (connector or otherwise) are normalized by `parse_mcp_tool`:

- `tools/src/mcp_tool.rs:6-37` `parse_mcp_tool(tool: &rmcp::model::Tool)` →
  `parse_tool_input_schema(&serialized_input_schema)?` (line 21) → compaction runs here.

So a connector's tools, served through the `codex_apps` MCP server, are parsed by the
**same** generic path as any other MCP server's tools. There is no connector-only schema
code path; the v134 win is entirely inside the shared `codex-tools` parser.

## 4. Fork relevance — confirmed LOW/NONE

**4a. Connectors are never materialized under Copilot auth.**

- `login/src/auth/manager.rs:293-298` `CodexAuth::uses_codex_backend()` →
  `matches!(self, Chatgpt | ChatgptAuthTokens | AgentIdentity)`. Copilot auth is none of
  these.
- `model-provider/src/copilot_models_endpoint.rs:130-132`
  `CopilotModelsEndpoint::uses_codex_backend()` → **`false`** (hard-coded).
- `codex-mcp/src/mcp/mod.rs:222-229` — because `host_owned_codex_apps_enabled` is false,
  `with_codex_apps_mcp` **removes** `codex_apps` from the effective MCP server set. The
  connector directory fetch (`core/src/connectors.rs:148`,`:166`) short-circuits the same
  way. → **No connector, no connector tool, no connector tool schema, ever, in the fork.**
- This dovetails with the fork's existing posture: ChatGPT/remote-control paths are
  force-disabled (see `codex/CLAUDE.md` → "Remote control is force-disabled at THREE
  layers"); the connector subsystem rides the same ChatGPT-backend rails and is inert for
  the same reason — **without any fork patch being required**, because the upstream auth
  gate already excludes Copilot.

**4b. The generic compaction code DOES run for the fork's regular MCP tools — benignly.**

- Any user-configured MCP server's tools, and happy-cli's own injected MCP tool, go
  through `parse_mcp_tool` → `parse_tool_input_schema` → `compact_large_tool_schema`.
- happy-cli only injects one tiny tool: `happyMcpStdioBridge.ts:72` `changeTitle` with a
  single-string `inputSchema` — far under the 4 000-byte budget, so compaction never
  triggers. happy-cli does **not** read/consume connector or `codex_apps` schemas
  (`grep` over `packages/happy-cli` for `connector|codex_apps|apps_enabled` → 0 hits;
  the only `inputSchema`/`input_schema` hits are happy-cli *defining* its own tool).
- Net: the fork passively benefits from more-robust MCP tool-schema handling for real
  MCP servers, but there is no connector-specific surface to worry about.

**4c. No patch surface / nothing to replant.**

- No `// SANDBOX PATCH:` markers in `tools/src/json_schema.rs`, `tools/src/mcp_tool.rs`,
  the `connectors/` crate, `core/src/connectors.rs`, or `codex-mcp/src/codex_apps.rs`.
- The v134 change arrived purely as part of the `rust-v0.135.0` upstream merge
  (`git log` on `tools/src/json_schema.rs`: `03fe64287 rebase: merge upstream
  rust-v0.135.0 into sandbox-patches`, on top of upstream `44d28f500 codex-tools: extract
  shared tool schema parsing` and `ea516f9a4 Support anyOf and enum in JsonSchema`).
- **Rebase action items: none.** This is upstream-canonical code with no fork edits; future
  rebases carry it forward untouched.

---

## Files inspected (evidence index)

| File | Lines | Relevance |
|---|---|---|
| `connectors/src/lib.rs` | 24-81 | Connector = ChatGPT App directory listing, keyed by ChatGPT account |
| `core/src/connectors.rs` | 50-57, 140-178 | `Feature::Apps` + `uses_codex_backend` gating |
| `codex-mcp/src/mcp/mod.rs` | 217-235 | `codex_apps` MCP server injected only for ChatGPT-backend auth |
| `codex-mcp/src/codex_apps.rs` | 4-6, 62-130 | Connector→MCP-callable-name normalization; cache |
| `tools/src/json_schema.rs` | 158-214, 330-407, 543-659 | The v134 change: ref-preservation + compaction passes |
| `tools/src/mcp_tool.rs` | 6-37 | Generic MCP tool path that calls the compacting parser |
| `features/src/lib.rs` | 132-138, 343-345, 958-960 | `Feature::Apps` (Stable) + `apps_enabled_for_auth` |
| `login/src/auth/manager.rs` | 289-298 | `uses_codex_backend` = ChatGPT-only |
| `model-provider/src/copilot_models_endpoint.rs` | 130-132 | Copilot `uses_codex_backend() == false` |
| `packages/happy-cli/src/codex/happyMcpStdioBridge.ts` | 72-74 | happy-cli defines its own tiny MCP tool; no connector consumption |
