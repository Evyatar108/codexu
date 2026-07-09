# How Happy drives each agent — live-TUI dual-control vs headless-spawn

**Investigation date:** 2026-07-08
**Scope:** Read-only source investigation of `codexu` (`packages/happy-cli/`,
`codex/` submodule) + the fetched `upstream-happy/main` ref (`slopus/happy`).
No source modified; no git write/checkout/commit run. Only this findings file
was written.

**Operator's goal being tested:** a *live, interactive codex CLI/TUI session on
the PC that the human types into directly*, which is **simultaneously**
observable + controllable from the Happy app — the **same** session,
**dual-controlled**. Operator thesis: an *app-server / event-bus* integration
enables this; an *SDK* (spawn-a-fresh-headless-agent) integration structurally
cannot.

---

## 1. Per-agent × per-repo matrix

Legend for "dual-control" column: **YES** = a human can have a live interactive
terminal session of that agent open on the PC AND the app drives/observes the
**same** running instance simultaneously. **NO** = the app spawns/owns a
headless process (no human at a terminal for that instance), or control is a
mutually-exclusive handoff rather than simultaneous.

| Agent | Repo | Integration mechanism | Headless-spawn or live-attach? | Live-TUI dual-control? | Key evidence (file:line) |
|---|---|---|---|---|---|
| **codex** | **fork `packages/happy-cli`** | Spawns the **`codex app-server` binary** (v2 JSON-RPC 2.0), transport = loopback **ws** default / **stdio** fallback. NOT the codex SDK. | **Headless-spawn** (app owns the backend). ws mode can reattach to a *previously happy-spawned* app-server via a discovery file — still happy-owned, still headless. | **NO** — `codex app-server` is a headless JSON-RPC backend with no human TTY. | `codex/codexAppServerClient.ts:8-13` (rejects `@openai/codex-sdk`), `:21` (`cross-spawn`), `:1148-1149` (stdio `app-server --listen stdio://`), `:1223-1237` (ws `app-server --listen ws://127.0.0.1:<port> --ws-auth ...`), `tryReattach` `:1004-1080` + `codexAppServerDiscovery.ts` (reattach to happy-spawned server) |
| **codex** | **fork `codex/` native `codex-happy` overlay** (`/remote on`) — *separate integration, NOT happy-cli* | Rust overlay **taps codex's own in-process app-server event stream** and speaks the Happy wire protocol directly to a loopback happy-server. No `codex app-server` binary, no happy-cli at runtime. | **Live-attach** — subscribes a second consumer to the *running TUI's* event bus + holds an inbound request handle. | **YES** — this is the only path where a human types into a live codex TUI while the app observes+controls the same session. Fork-exclusive. | `codex/codex-rs-overlay/codex-happy/src/attach.rs:1-3`; `tui/src/app.rs:1264` (`happy_tap` fanout of every `AppServerEvent`), `:1053` (inbound request handle), `:1034-1038` (`RemoteSession` gate); default OFF `features/src/lib.rs:1107-1114`. Full prior investigation: `.ralph/investigations/codex-appserver-vs-happy-wiring/findings.md` |
| **codex** | **upstream `slopus/happy`** | Spawns the **`codex app-server` binary**, **stdio-only** (`--listen stdio://`). No ws transport, no discovery file, no cross-process reattach. | **Headless-spawn**, fully **foreground-owned** (dies with happy-cli). | **NO** — headless backend; no live-TUI attach and no native overlay in this repo. | `git show upstream-happy/main:packages/happy-cli/src/codex/codexAppServerClient.ts` → only `app-server --listen stdio://` + `cross-spawn`; `codexAppServerDiscovery.ts` **absent** upstream; no `codex-happy`/`codex-rs-overlay`/`remote_session` anywhere in `upstream-happy/main` tree |
| **claude** | **fork `packages/happy-cli`** | Two mutually-exclusive modes: **local** = spawns the real `claude` CLI as a child with the **TTY inherited** (live interactive terminal); **remote** = **`@anthropic-ai/claude-agent-sdk` `query()`** (headless SDK, mobile-driven). | Local = live child TUI (app **observes** via JSONL snoop). Remote = headless SDK process. | **NO (partial)** — local gives live-TUI + observe, but *controlling* from the app requires a **switch to remote mode** (handoff); the two are never simultaneous on the same instance. | `claude/sdk/query.ts:6` (`@anthropic-ai/claude-agent-sdk` `sdkQuery`); `claude/claudeLocal.ts:1` (`cross-spawn`), `:316` (`stdio:['inherit','inherit','inherit','pipe']` → live TTY); `claude/loop.ts:78-116` (mutually-exclusive `local`↔`remote` `switch`) |
| **claude** | **upstream `slopus/happy`** | Same architecture: `@anthropic-ai/claude-agent-sdk` (SDK, remote) + `cross-spawn` local CLI. (Fork adds only patches, e.g. per-query env passthrough.) | Local = live child TUI + observe; remote = headless SDK. | **NO (partial)** — identical local/remote handoff model; no simultaneous dual-control. | `git show upstream-happy/main:packages/happy-cli/package.json` → `@anthropic-ai/claude-agent-sdk ^0.3.179` (fork pins `^0.2.96`), `cross-spawn ^7.0.6`; same `codex`/`claude` dir layout |

### Dependency tell (fastest SDK-vs-not signal)
- `packages/happy-cli/package.json` (fork) deps: `@anthropic-ai/claude-agent-sdk ^0.2.96`, `@agentclientprotocol/sdk ^0.14.1`, `cross-spawn ^7.0.6`, **no `@openai/codex-sdk`**.
- Upstream deps: `@anthropic-ai/claude-agent-sdk ^0.3.179`, same `@agentclientprotocol/sdk` + `cross-spawn`, **no `@openai/codex-sdk`**.
- Neither repo depends on the codex SDK. Codex is driven by spawning the
  `codex app-server` **binary** and speaking JSON-RPC to it.

---

## 2. Direct answer to the operator's goal

**Which integration achieves "live codex TUI on the PC + app control of the
SAME session, simultaneously"?** Exactly one: the **fork's native `codex-happy`
overlay** in the `codex/` submodule, activated by `/remote on`
(`Feature::RemoteSession`, default-off). It works precisely because it **taps
the already-running TUI's in-process app-server event bus** and holds an inbound
request handle — the human keeps typing in the TUI while the app observes and
injects (`codex/codex-rs-overlay/codex-happy/src/attach.rs:1-3`;
`tui/src/app.rs:1053,1264`).

**Is that fork-exclusive today? YES.** Upstream `slopus/happy` has no
`codex-happy` overlay, no `codex-rs-overlay`, and no `remote_session` feature
anywhere in `upstream-happy/main`. Upstream's *only* codex integration is
happy-cli spawning a **headless, foreground-owned `codex app-server`** over
stdio — no human-typed live TUI is involved in that instance, so it cannot
deliver dual-control of a session the human is also driving.

**What neither happy-cli path (fork or upstream) delivers:** happy-cli's own
codex integration — even in the fork with ws reattach — always **spawns/owns a
headless `codex app-server` backend**. There is no human at a terminal for that
process. happy-cli never attaches to an externally-running interactive codex TUI
that a human started; it is always the owner/spawner of a headless backend.
(The ws "reattach" reconnects to an app-server *happy-cli itself* spawned
earlier, recorded in `~/.happy/codex-active-<cwdHash>.json` — not a user's TUI.)

---

## 3. The SDK-vs-app-server clarification (confirm/correct the thesis)

The operator's thesis is **directionally correct but needs one refinement**:

- **SDK path = headless-only, cannot dual-control (CONFIRMED).**
  - *Claude:* `@anthropic-ai/claude-agent-sdk` `query()` spawns/owns a headless
    agent that produces a stream; the app is the sole driver
    (`claude/sdk/query.ts`). No human-typed live TUI shares that instance.
  - *Codex:* the codex SDK (`@openai/codex-sdk`) is **explicitly rejected** in
    the source because it "only wraps `codex exec` (non-interactive,
    fire-and-forget) ... NO support for app-server, interactive approvals, or
    bidirectional JSON-RPC" (`codex/codexAppServerClient.ts:8-13`). Neither repo
    ships it.

- **app-server path — the refinement: NOT automatically dual-control; it
  depends on *whether you spawn the server or tap a running one*.**
  - happy-cli spawns the **`codex app-server` binary as a headless child it
    owns** (fork ws/stdio, upstream stdio). That is app-server-style
    (bidirectional JSON-RPC, live approvals) yet still **headless** — there is
    no human TUI on that instance. So "app-server" alone does *not* grant
    dual-control.
  - The dual-control property comes specifically from the **event-bus tap of a
    live TUI**: the fork's `codex-happy` overlay subscribes to the *running*
    TUI's in-process app-server event stream and injects control back
    (`tui/src/app.rs:1264` fanout + `:1053` request handle). That is the only
    thing that lets the human keep typing while the app co-drives.

**Net:** SDK ⇒ always headless, never dual-control (thesis confirmed).
app-server ⇒ enables the bidirectional/approval plumbing, but dual-control of a
human-typed session requires **attaching to a live TUI's event bus** (the fork
overlay), not merely spawning the `app-server` binary (what happy-cli does).

---

## 4. Evidence appendix (commands + key outputs)

**Fork happy-cli deps** — `view packages/happy-cli/package.json`:
`@anthropic-ai/claude-agent-sdk ^0.2.96`, `@agentclientprotocol/sdk ^0.14.1`,
`cross-spawn ^7.0.6`; no `@openai/codex-sdk`.

**Fork codex driver** — `grep -n 'spawn|app-server|codex-sdk|@openai'
packages/happy-cli/src/codex/codexAppServerClient.ts`:
- `:8-13` — SDK rejection rationale.
- `:21` — `import { spawn as crossSpawn } from 'cross-spawn'`.
- `:1148-1149` — `let args = ['app-server', '--listen', 'stdio://']`.
- `:1223-1237` — ws spawn args: `app-server --listen ws://127.0.0.1:<port>
  --ws-auth capability-token --ws-token-sha256 <hex>`.
- `tryReattach` `:1004-1080` — reattach to a happy-spawned app-server recorded
  in the discovery file (`codexAppServerDiscovery.ts`: `CodexDiscoveryRecord`
  with `pid/port/capabilityToken/happyCliVersion/transport:'ws'`).

**Fork claude driver** —
- `claude/sdk/query.ts:6` — `import { query as sdkQuery } from
  '@anthropic-ai/claude-agent-sdk'`.
- `claude/claudeLocal.ts:1` — `import { spawn as crossSpawn } from 'cross-spawn'`;
  `:311-322` — `crossSpawn('node', [claudeCliPath, ...args], { stdio:
  ['inherit','inherit','inherit','pipe'], ... })` (TTY inherited → live
  interactive terminal; fd3 piped for thinking telemetry only).
- `claude/loop.ts:78-116` — `while(true)` with `switch(mode)` over
  `'local' | 'remote'`; transitions are `case 'switch'` handoffs — the modes are
  mutually exclusive, never simultaneous.

**Fork codex native overlay** (prior investigation, re-verified paths):
`codex/codex-rs-overlay/codex-happy/src/attach.rs:1-3` ("bridge codex's
in-process app-server to a native Happy session, no happy-cli at runtime");
`codex/.../tui/src/app.rs:1264` (`happy_tap` fanout of every `AppServerEvent`),
`:1053` (inbound request handle), `:1034-1038` (`Feature::RemoteSession` gate);
`features/src/lib.rs:1107-1114` (`remote_session` `default_enabled: false`).
See `.ralph/investigations/codex-appserver-vs-happy-wiring/findings.md`.

**Upstream verification** (read-only against the fetched `upstream-happy` remote):
- `git branch -r | Select-String upstream-happy` → `upstream-happy/main` present.
- `git show upstream-happy/main:packages/happy-cli/package.json` →
  `@anthropic-ai/claude-agent-sdk ^0.3.179`, `@agentclientprotocol/sdk ^0.14.1`,
  `cross-spawn ^7.0.6`; no `@openai/codex-sdk`.
- `git show upstream-happy/main:packages/happy-cli/src/codex/codexAppServerClient.ts
  | Select-String 'spawn|app-server|stdio|--listen|ws://|--ws-auth'` → only
  `app-server --listen stdio://` + `crossSpawn`; **no ws / no `--ws-auth`**.
- `git ls-tree -r --name-only upstream-happy/main --
  packages/happy-cli/src/codex/codexAppServerDiscovery.ts` → **empty** (file
  does not exist upstream ⇒ no reattach/discovery).
- `git ls-tree -r --name-only upstream-happy/main | Select-String
  'codex-happy|codex-rs-overlay|remote_session'` → **empty** (no native overlay
  upstream).

**What I could NOT verify:** runtime behavior (no builds/execution run — pure
source read, per scope). The upstream claim rests on `upstream-happy/main` as
fetched locally; other upstream branches (e.g. `acpx-rewrite`,
`ex3ndr/acp-agents-clean`) were not inspected and could differ, but `main` is
the shipping surface.

---

## Bottom line

The operator's goal — a **live codex TUI on the PC that the human types into,
co-driven by the Happy app on the same session** — is served **only** by the
fork's native `codex-happy` overlay (`/remote on`, `Feature::RemoteSession`),
which taps the running TUI's in-process app-server event bus and holds an
inbound control handle (`codex/.../tui/src/app.rs:1053,1264`;
`codex-happy/src/attach.rs:1-3`). This is **fork-exclusive**: upstream
`slopus/happy` has no such overlay and drives codex only by spawning a
**headless, stdio-only, foreground-owned `codex app-server`** child. The
operator's thesis holds — **every SDK path is headless-only and can't
dual-control** (Claude Agent SDK; and the codex SDK is explicitly rejected as
`exec`-only at `codexAppServerClient.ts:8-13`) — with one refinement: **spawning
the `codex app-server` binary (what happy-cli does, fork and upstream) is
app-server-style but still headless**; dual-control specifically requires
**attaching to a live TUI's event bus**, which is exactly and only what the fork
overlay does.
