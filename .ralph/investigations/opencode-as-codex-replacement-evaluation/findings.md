# opencode as a codex-engine replacement for codexu — evaluation

**Date:** 2026-06-06
**Mode:** read-only strategic evaluation (no source modified in opencode, codex, or codexu)
**opencode tree:** `D:/harness-efforts/opencode` (`@opencode-ai/plugin` v1.16.2)
**codex fork:** `codexu/codex` = `0.135.0-copilot-api.1` (patched openai/codex)

---

## TL;DR recommendation: **VIABLE-WITH-WORK** (and surprisingly attractive for one of codex's two roles)

opencode is a credible engine substitute, but the answer splits cleanly by **which of codex's two roles** you mean:

| Role codex plays in codexu | opencode verdict |
|---|---|
| **A. happy-cli-driven programmatic engine** (`happy codex` → app-server over loopback ws; the SUPPORTED_AGENTS path) | **Viable-with-work.** opencode ships a documented headless server (HTTP + SSE + OpenAPI SDK), **native GitHub Copilot auth/transport**, MCP, skills, subagents, and a permission system. Main cost = rewriting `codexAppServerClient.ts` against a REST+SSE protocol instead of bidirectional JSON-RPC. |
| **B. crews/ralph interactive-member engine** (`--engine codex` bookkeeper/member with Claude-compat hooks) | **Not a drop-in; needs re-architecture.** opencode has tool-execution hooks (blocking-capable) + lifecycle events, but **no turn-end "Stop" blocking gate and no external-command hook model** — the exact primitives crews/ralph enforcement is built on. Note codex's own role B is currently *broken on Windows* anyway (see memory: crews codex launcher hard-exits). |

**The headline win:** opencode **already has, natively, the single largest thing the codex fork exists to patch in** — first-class GitHub Copilot support (OAuth device flow, `/models` fetch from `api.githubcopilot.com`, per-request header injection incl. `x-initiator`/vision/enterprise). The codex fork is literally named `…-copilot-api.1`; a large fraction of its patch surface (`model-provider/src/copilot*.rs`, `bearer_auth_provider.rs`, `codex-api/src/api_bridge.rs`, `CopilotHeaderSource`) is exactly this. Adopting opencode deletes that whole patch class.

**The headline risk:** the patch *problem* doesn't disappear, it **moves**. The codex fork's other big patch class is **network suppression** (kill analytics/telemetry/cloud-requirements/remote_control, redact secrets). opencode has its *own* outbound surfaces (session share to opencode.ai, mDNS discovery, installation auto-update, models.dev catalog fetch, OpenCode Zen/Go cloud) that a privacy-grade fork would have to audit and gate the same way. And the **make-or-break HOOKS gap** for role B is real.

---

## Make-or-break: the HOOKS verdict

**crews + ralph require a Claude-Code-style hook system: `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart` — implemented as external command hooks that can BLOCK.** The crews Stop hook blocks turn completion until the member emits a `<|report kind=…|>` tag and reviews mail; the PreToolUse hook blocks the next tool call until a listener is armed. That "block-and-force-continue" enforcement is the spine of the whole orchestration.

### What codex has (the fork patched it in)
A real Claude-compatible **command-hook crate**: `codex-rs/hooks/` with `HookEventName::PreToolUse` / `SessionStart` / etc. (`hooks/src/declarations.rs`, `config_rules.rs`), `core/src/hook_runtime.rs`, `hooks/src/events/pre_tool_use.rs` — all carrying `SANDBOX PATCH` markers. Memory confirms codex serializes shell hooks with Claude-compat `tool_name: "Bash"`. This is precisely the surface crews/ralph hook into.

### What opencode has
**In-process JS/TS plugin hooks**, fired via `plugin.trigger(...)` at fixed points in the engine (`packages/opencode/src/session/prompt.ts`, `tools.ts`, `llm/request.ts`, `compaction.ts`). The authoritative interface is `@opencode-ai/plugin/src/index.ts` → `interface Hooks`:

| opencode hook | Fires | Can block? | Maps to |
|---|---|---|---|
| `tool.execute.before(input,output)` | before each tool runs | **YES** — throw to deny (the `.env`-protection example throws) | `PreToolUse` ✓ |
| `tool.execute.after(input,output)` | after each tool | mutate output | `PostToolUse` ✓ |
| `permission.ask(input,{status})` | before gated action | YES — set `deny`/`allow` | extra gate |
| `command.execute.before` | before slash command | mutate | command interception |
| `chat.message` / `chat.params` / `chat.headers` | per turn/LLM call | mutate | request shaping |
| `event({event})` | **all** Bus events (`session.idle`, `session.created`, `session.deleted`, `tool.execute.*`, `permission.*`, …) | **NO — observational only** | weak `SessionStart`/`Stop`/`Notification` |
| `experimental.session.compacting` | before compaction | replace prompt | `PreCompact` ✓ |

**The gap:** `session.idle` (the turn-boundary signal, emitted in `session/status.ts:44`) and `session.created`/`session.deleted` are **one-way Bus events delivered to the observational `event` hook**. There is **no `plugin.trigger("session.stop", …)` that the engine awaits and that can veto/continue the turn.** So:

- `PreToolUse`-style blocking → **available** (`tool.execute.before` throw).
- `PostToolUse` → **available** (`tool.execute.after`).
- `SessionStart` init logic → **available-ish** (plugin function body runs at startup; `session.created` observable).
- **`Stop` (turn-end BLOCKING gate) → MISSING.** No host primitive blocks turn completion to force a report tag / mail review / listener arm.

Second structural mismatch: opencode hooks are **in-process modules**, not **external command hooks** (Claude `settings.json` → spawn `hooks/*.js`). crews/ralph are *written as* Claude-Code/Copilot-CLI command-hook plugins. Porting them to opencode = rewriting them as opencode plugins **and** redesigning the Stop-enforcement from "block" to "observe-then-auto-remediate" (e.g., a plugin watches `session.idle` and auto-injects a continuation via `client.session.prompt({noReply})` / `tui.appendPrompt`). That is a redesign, not a port.

**HOOKS verdict:** opencode can *observe* every lifecycle event crews/ralph care about and can *block tool execution*, but it **cannot block turn completion**, and its hook model is in-process rather than external-command. For role B this is **make-or-break against a drop-in**; it is **surmountable with a crews/ralph re-architecture** (or by adding a Stop-trigger to opencode, which is a focused engine patch — ironically the kind of thing the codex fork already did).

---

## Capability matrix

| # | codexu need | codex-fork status | opencode status | Gap |
|---|---|---|---|---|
| 1 | **App-server / headless engine** happy-cli can drive over loopback | Upstream `app-server` crate (JSON-RPC 2.0 over stdio **or** loopback ws); fork relies on it + force-disables `remote_control` (3 layers) | **`opencode serve`** headless HTTP server, OpenAPI 3.1 spec at `/doc`, **SSE** event stream at `/event`, generated SDK (`@opencode-ai/sdk`), `prompt_async`, per-session permission-response endpoint, `OPENCODE_SERVER_PASSWORD` auth, binds `127.0.0.1` | **Protocol shape differs** (REST+SSE one-way vs bidirectional JSON-RPC). Functionally sufficient; requires a new driver. |
| 2 | **Lifecycle hooks** (Pre/PostToolUse, Stop, SessionStart) for crews+ralph | Full Claude-compat **command-hook** crate (`hooks/`, `hook_runtime.rs`) | In-process plugin hooks: `tool.execute.before/after` (blocking), `permission.ask`, `event` (observational). **No Stop-block; no external-command hooks** | **Make-or-break for role B.** PreToolUse/PostToolUse ✓; Stop ✗; SessionStart partial. |
| 3 | **Plugins + marketplace** | Patched `core-plugins/` + `marketplace.json` loader | Native: local (`.opencode/plugins/`, `~/.config/opencode/plugins/`) + **npm packages** auto-installed via Bun; documented load order | opencode plugin model ≠ codex/Claude plugin model; crews/ralph plugins would need a rewrite. No "marketplace" index, but npm is the registry. |
| 4 | **Skills** (`.claude/skills`, `.agents/skills`) | Patched CLAUDE.md auto-load + plugin scope | **Native and Claude/agent-compatible**: discovers `.opencode/skills`, **`.claude/skills`**, **`.agents/skills`** (project + global), `SKILL.md` frontmatter, `skill` tool, per-skill permissions | **Strong win** — codexu's existing `.agents/skills/` + `.claude/skills/` load unmodified. |
| 5 | **MCP servers** | rmcp client + substitution patches | Native local (stdio command) + remote (HTTP) MCP, **OAuth/DCR**, per-agent enable, glob disable, dynamic `POST /mcp` | Parity (arguably richer: built-in remote OAuth). |
| 6 | **Multi-agent / subagents** (cf. `multi_agents_v2`) | Patched subagent gate/filter on upstream `multi_agents_v2`; degraded under ralph multi-lens (tool-name mismatch) | Native **primary agents + subagents** (Build/Plan + General/Explore/Scout), `task` tool, `@`-mention, child sessions, **experimental native background subagents** (`OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`) | Good parity, native background subagents are a plus. Different tool name (`task`) → ralph multi-lens would need adapter, same class of issue as codex. |
| 7 | **Sandbox / OS-level confinement** | Upstream OS sandbox (seatbelt/landlock) + `SandboxMode`; happy drives via `initializeSandbox`/`SandboxConfig`; fork adds Windows job-object + network suppression | **Permission system only** (`allow`/`ask`/`deny`, granular bash/edit globs, `external_directory`, `doom_loop`). **No seatbelt/landlock/seccomp/sandbox-exec in core** (grep = 0 hits) | **Real gap.** opencode gates by prompt/policy, not OS isolation. happy's `safe-yolo`/sandbox modes that rely on codex `SandboxMode` have no OS-enforced equivalent. (opencode has a separate `containers` package for Docker-based isolation — heavier, different model.) |
| 8 | **Background / async shell** (cf. fork D-002 `await_background_completion`) | Patched unified-exec background completion | `task` background mode + `BackgroundJob` service; `shell` tool spawns `detached` on non-Windows. No 1:1 `await_background_completion` for inline bash | Partial parity; pattern differs. Not a blocker. |
| 9 | **Copilot-API provider** (codex = `…-copilot-api.1`) | **The fork's core purpose**: in-process Copilot transport, header injection, `/models` endpoint, `CopilotAuth` | **Native** `github-copilot` provider plugin (`plugin/github-copilot/copilot.ts`): OAuth device flow (+ GHE), live `/models` fetch, header injection (`x-initiator`, `User-Agent`, `Authorization`, `Copilot-Vision-Request`, `X-GitHub-Api-Version`), small/utility-model routing | **Biggest win.** Eliminates the fork's largest patch class. Uses AI-SDK `@ai-sdk/github-copilot`. |
| — | **Network suppression / privacy** (analytics, telemetry, cloud, remote_control off; secret redaction) | Extensive fork patches across `analytics/`, `cloud-*`, `backend-client/`, `remote_control` (3-layer), secret-`set_sensitive` inventory | opencode respects `HTTPS_PROXY`/`NO_PROXY`/`NODE_EXTRA_CA_CERTS`; but has **its own** outbound paths: session **share** (opencode.ai), **mDNS**, **auto-update**, **models.dev** catalog, Zen/Go cloud | **Patch problem moves, doesn't vanish.** A privacy-grade opencode fork must audit/gate these. No always-on chatgpt.com enrollment to fight (minor win). |

---

## "opencode already has X that we patched into codex" — wins

1. **GitHub Copilot transport (capability 9).** Native `github-copilot` provider: device-flow OAuth, enterprise, live `/models`, full header injection, vision, utility-model routing. This is the codex fork's single biggest patch class — **gone**.
2. **Skills with `.claude/` + `.agents/` compatibility (capability 4).** codexu's `.agents/skills/` and `.claude/skills/` are discovered natively; no CLAUDE.md-auto-load launcher patch needed.
3. **Headless server + typed SDK (capability 1).** First-class, documented, OpenAPI-generated SDK + SSE — cleaner than hand-rolling against codex's app-server README. (codex's app-server is upstream, but the fork still hand-rolls `codexAppServerClient.ts`; opencode ships the client.)
4. **Native plugins via npm + remote MCP with OAuth (capabilities 3, 5).**
5. **Native background subagents (capabilities 6, 8).** `task background=true` + `BackgroundJob` service are first-class.
6. **No chatgpt.com remote-control enrollment to disable.** codex's 3-layer `remote_control` force-disable has no opencode analogue (opencode's remote-drive is the local `/tui` control endpoints, opt-in).

## "codexu needs Y that opencode lacks" — gaps

1. **Turn-end `Stop` blocking hook (capability 2) — CRITICAL for role B.** No host primitive halts turn completion. crews/ralph enforcement (kind-tag gate, mail-review gate, listener-arm gate) has nothing to hang on. Workaround = re-architect to observe-`session.idle`-and-auto-remediate, or add a `Stop` trigger to opencode.
2. **External-command hook model (capability 2).** opencode hooks are in-process modules. crews/ralph (Claude/Copilot command-hook plugins) require a full rewrite as opencode plugins.
3. **OS-level sandbox (capability 7).** No seatbelt/landlock/seccomp. happy's sandbox-mode contract (driven by codex `SandboxMode`) downgrades to prompt-based permissioning, or needs the heavier `containers` model.
4. **Bidirectional JSON-RPC approval routing (capability 1).** happy-cli's whole reason for hand-rolling `codexAppServerClient.ts` is interactive approval callbacks (`exec:request`, `patch:request`, `mcp:call`). opencode does this via REST `POST /session/:id/permissions/:permissionID` + `permission.asked` SSE events — capable, but a **different protocol** = rewrite, plus re-validating the loopback capability-token security model (opencode uses `OPENCODE_SERVER_PASSWORD` basic-auth, not per-spawn SHA-256 tokens).
5. **New network-suppression patch set.** Share/mDNS/auto-update/models.dev/Zen must be gated for a privacy-grade fork.
6. **Runtime: Bun/TypeScript vs Rust.** opencode runs on Bun; codexu's Windows e-ink + MAX_PATH + service constraints, and happy-cli's process-lifecycle assumptions (discovery file, job-object shutdown), are tuned to the codex Rust binary. New runtime = new operational surface to validate on the target tablet/Windows box.

---

## Biggest risks

1. **HOOKS (role B).** If the goal includes replacing codex *as a crews/ralph member engine*, the missing Stop-block + in-process-only hook model is the dominant risk. Mitigated only by re-architecting crews/ralph or patching opencode — i.e., trading codex's patch debt for a new (smaller) opencode patch debt.
2. **Protocol rewrite of `codexAppServerClient.ts`.** The most security-sensitive, most-tested file in happy-cli's codex path (loopback auth, discovery, force-restart invariants, approval snapshots). A REST+SSE rewrite must re-establish every invariant in `packages/happy-cli/AGENTS.md` "Codex Transport Security Model".
3. **Sandbox downgrade.** Losing OS-level confinement may be unacceptable for happy's `safe-yolo`/sandboxed remote-control story; permission-prompt gating is weaker than seatbelt/landlock.
4. **Patch-surface transfer.** Net patch burden may not drop as much as the Copilot win suggests, once you re-audit opencode's outbound surfaces and re-add a Stop-hook + sandbox story.
5. **Two-engine divergence cost.** codexu already supports claude/codex/gemini/openclaw; adding opencode (or swapping codex→opencode) multiplies the per-agent integration/test matrix in happy-cli (`*.integration.test.ts`).

---

## Suggested next step

**Run a narrowly-scoped spike, not a migration.** Concretely:

1. **Prove the programmatic-engine path (role A) end-to-end (highest ROI, lowest risk):** stand up `opencode serve` on loopback, authenticate the **native github-copilot** provider, and from a throwaway Node script: create a session → `prompt_async` → subscribe `GET /event` (SSE) → catch a `permission.asked` for a `bash`/`edit` tool → respond via `POST /session/:id/permissions/:permissionID`. This validates the *exact* loop `codexAppServerClient.ts` would be rewritten around, and confirms the Copilot win is real with codexu's auth. Time-box ~1 day.
2. **Decide role B explicitly with the operator.** If opencode is *only* meant to be the happy-cli agent (role A), the HOOKS gap is irrelevant and this is **viable-with-work**. If it must also be a crews/ralph member engine (role B), file a follow-up to either (a) add a `Stop`-trigger + external-command-hook shim to an opencode fork, or (b) re-architect crews/ralph enforcement to opencode's observe-and-remediate event model — both are non-trivial and should be their own brainstorm.
3. **Do NOT delete codex's patch lessons.** Even on adoption, the network-suppression audit, secret-redaction inventory, and loopback-auth model from `codex/CLAUDE.md` are the checklist to re-apply to opencode.

**Bottom line:** opencode is *viable-with-work* as codex's programmatic engine and would erase the fork's largest patch class (Copilot) — but it is *not a drop-in for crews/ralph* because it lacks a turn-end blocking hook and an external-command hook model, and it trades codex's OS sandbox + network-suppression patches for a new (smaller) opencode patch set. Recommend the role-A spike before any commitment.

---

### Evidence index (file:line)
- opencode server/SSE/SDK: `packages/web/src/content/docs/server.mdx`, `sdk.mdx`
- opencode hook interface (authoritative): `packages/plugin/src/index.ts` (`interface Hooks`)
- opencode hook firing sites / `session.idle` event: `packages/opencode/src/session/{prompt.ts,tools.ts,status.ts,llm/request.ts,compaction.ts}`
- opencode native Copilot: `packages/opencode/src/plugin/github-copilot/copilot.ts`
- opencode skills (.claude/.agents compat): `packages/web/src/content/docs/skills.mdx`
- opencode MCP / permissions / agents / network: `packages/web/src/content/docs/{mcp-servers,permissions,agents,network}.mdx`
- opencode no OS sandbox: grep `seatbelt|landlock|seccomp|sandbox-exec` in `packages/opencode/src` = 0
- opencode background subagents: `packages/opencode/src/tool/task.ts`, `tool/shell.ts`
- codex fork patch inventory: `codex/CLAUDE.md`; `SANDBOX PATCH` markers across `codex/external/repos/codex-patched/codex-rs/**`
- codex Claude-compat hook crate: `codex-rs/hooks/src/{declarations.rs,config_rules.rs,events/pre_tool_use.rs}`, `core/src/hook_runtime.rs`
- happy-cli codex driver (rewrite target): `packages/happy-cli/src/codex/codexAppServerClient.ts`; security model in `packages/happy-cli/AGENTS.md`
