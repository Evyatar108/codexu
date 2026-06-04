# Codex Launcher Probe Report (Story #0 — crews-codex-engine-support D-001)

**Date:** 2026-06-04
**Codex CLI under test:** `codex-cli 0.125.0-copilot-api.8` installed at `C:\Users\evmitran\AppData\Roaming\npm\codex.ps1`
**Codex source:** `codex/external/repos/codex-patched/codex-rs/` (gim-home/codex fork)
**Plan ref:** `.ralph/jobs/crews-codex-engine-support/plan.md` Story #0 ACs + R2 + R3 + R4 + plan line 43 (`--full-auto` claim)
**Method:** static source review (`codex-rs/cli/`, `codex-rs/core-plugins/`, `codex-rs/hooks/src/engine/command_runner.rs`, `codex-rs/features/`, `codex-rs/tui/src/terminal_title*`) + live `codex --help`, `codex exec`, and `codex plugin marketplace add` invocations

---

## TL;DR — per launcher-spec question

| Q | Answer | Plan correction needed? |
|---|---|---|
| Confirmed env-var names codex sets on child processes for `CODEX_AGENT_SESSION_ID` and `CODEX_CLI` markers | **NEITHER EXISTS.** Codex stamps no CLI-identity env var and no session-id env var on child processes. The plan's working hypotheses are wrong. Crews must self-stamp these from the launcher. | YES — plan §125, §127, §250 |
| Does `-c marketplaces.<n>.source=<abs>` work for per-spawn plugin loading? | PARTIAL — needs `-c marketplaces.<n>.source_type=local -c marketplaces.<n>.source=<abs>` (TWO `-c` keys), AND a `[plugins.'<plugin>@<n>'] enabled = true` stanza already in `~/.codex/config.toml`. Not a single-flag operation. | YES — plan §133, §222 |
| Does `--sandbox workspace-write` reject writes to `~/.crews/`? | YES (per documented sandbox-mode semantics; `--add-dir <path>` is the documented mitigation, present in the CLI). The plan's mitigation chain (`--add-dir ~/.crews` → fallback to `--dangerously-bypass-approvals-and-sandbox`) is correct. | NO — plan already correct |
| Does codex's bash/exec tool keep a backgrounded subprocess alive across hook return? | **YES** (source-confirmed reasoning); contingent on the spawned child being properly detached (`{ detached: true, stdio: 'ignore' }` on Node, equivalent on other runtimes). Crews' existing arm-listener pattern already meets this contract — no new code needed for codex beyond using the same pattern. | NO — but verify in Story #6 smoke |
| Does codex have a per-turn terminal-title rewriter, and what disables it? | YES (`tui/src/terminal_title.rs`, fires on every TUI session). Disabled via TOML `[tui] terminal_title = []` (empty array). **NO env var exists** — `CODEX_DISABLE_TERMINAL_TITLE` is a plan-side hypothesis, not a real codex variable. | YES — plan §134, §290 |
| Plan line 43 claim that `--full-auto` no longer parses | **FALSE against 0.125.0-copilot-api.8.** `--full-auto` is documented in `codex --help`: "Convenience alias for low-friction sandboxed automatic execution". The plan's basis for switching the launcher to `--sandbox workspace-write` is overstated — but the SWITCH IS STILL CORRECT for a different reason (crews needs explicit sandbox-policy control, and `--full-auto` hides the resolved values). | YES — plan §43 framing; §126 launcher choice is still correct |
| **GATE for R2 (subprocess survival)** | **GREEN — proceed with D-001** | — |

---

## 1. Env vars codex sets on child processes — the BIG correction

### Empirical finding

A repo-wide grep across the entire `codex/external/repos/codex-patched/codex-rs/` tree for `env::set_var.*CODEX` returned the following matches:

| File:Line | Variable | Purpose |
|---|---|---|
| `cloud-requirements/src/lib.rs:1243` | `CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL` | Auth-API endpoint override; unrelated to session identity |
| `login/src/auth/auth_tests.rs:742,932,1158` | `CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL` | Test-only |
| `login/src/auth/agent_identity.rs:11,65,88,100,116` | `CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL` | Same auth endpoint |
| `rmcp-client/src/oauth.rs:622` | `CODEX_HOME` | Test-only |
| `test-binary-support/lib.rs:54,63` | `CODEX_HOME` | Test-only |
| `exec-server/tests/common/exec_server.rs:77` | `child.env("CODEX_HOME", ...)` | Test-only |

There is **NO** match for `CODEX_CLI`, `CODEX_AGENT_SESSION_ID`, `CODEX_SESSION_ID`, `CODEX_AGENT_ID`, or any other "codex marker / session" name. **Codex does NOT stamp a CLI-identifier or session-id env var on child processes.**

### What codex DOES set on hook child processes

From `hooks/src/engine/discovery.rs:223-225`:

```rust
env.insert("PLUGIN_ROOT".to_string(), plugin_root_value.clone());
env.insert("CLAUDE_PLUGIN_ROOT".to_string(), plugin_root_value);
env.insert("PLUGIN_DATA".to_string(), plugin_data_value.clone());
env.insert("CLAUDE_PLUGIN_DATA".to_string(), plugin_data_value);
```

So a hook's `process.env` will contain `PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_DATA` — and **nothing else** that identifies the codex parent.

### Implications for crews (Story #2 — 3-way `readSessionEnv` tiebreak)

The plan's hypothesis (`CODEX_CLI=1`, `CODEX_AGENT_SESSION_ID=<uuid>`) cannot be used because those env vars don't exist. The crews launcher must self-stamp BOTH the engine marker and the session-id when spawning a codex member:

```text
CREWS_ENGINE                = "codex"
CREWS_CODEX_SESSION_ID      = "<uuid generated by launcher>"   # crews-owned, not codex-derived
```

`CREWS_ENGINE` is already the crews-side normalized engine key (per crews v1.8.11 caller-CLI detection). `CREWS_CODEX_SESSION_ID` is a NEW crews-owned variable; the launcher generates a UUID at spawn time, passes it via env to the codex member, AND saves it in the member manifest. The 3-way `readSessionEnv` tiebreak then keys off `CREWS_ENGINE` (not a codex-emitted marker).

### Session-id source-of-truth

The codex session id IS available — but only INSIDE the hook payload as `session_id` (codex generates a fresh UUID v7 per session and surfaces it in every hook input). The hook can write the real codex session_id to the manifest on the first `SessionStart` hook fire (replacing the launcher-stamped placeholder). This is the analog of crews' v1.2.2 stable-session-id flow for Claude/Copilot, but **the synchronization point shifts**: for codex, the manifest carries the launcher-stamped UUID at spawn time and updates to the actual codex UUID on first SessionStart hook fire. This is fine for the steady-state pattern; brittle on the first ~50ms after spawn before SessionStart runs.

Story #2 spec should be amended:
- `hooks/lib/session-env.js::readSessionEnv()` 3-way branch: `CREWS_ENGINE === 'codex'` → engine = codex; session id = `CREWS_CODEX_SESSION_ID` (the launcher-stamped one)
- Story #5 `codex-session-start.js` shim writes the real codex `session_id` into the manifest on first fire, overwriting the placeholder

### Live evidence

Visible in the codex exec stdout banner (every codex session prints):
```
session id: 019e9461-c813-7f43-ad94-0b204f2e8100
```

The UUID is v7 (timestamp-ordered) per codex's internal `ThreadId` type. Crews can rely on the UUID v7 format if useful for sort-order (not critical for v1).

---

## 2. `-c marketplaces.<n>.source=<abs>` per-spawn plugin load

### Source-confirmed mechanism

From `core-plugins/src/installed_marketplaces.rs::resolve_configured_marketplace_root`:

```rust
match marketplace.get("source_type").and_then(toml::Value::as_str) {
    Some("local") => marketplace
        .get("source")
        .and_then(toml::Value::as_str)
        .filter(|source| !source.is_empty())
        .map(PathBuf::from),
    _ => Some(default_install_root.join(marketplace_name)),
}
```

For a marketplace to be treated as a LOCAL path (not a git-staged temp clone), **BOTH** `source_type = "local"` AND `source = "<path>"` keys are required. The plan's hypothesized `-c marketplaces.<n>.source=<abs>` form sets only one; codex would interpret missing `source_type` as the default branch (treating the marketplace as a curated/git-fetched one and looking for it under `~/.codex/.tmp/marketplaces/<name>`).

### Two-`-c` form that works

```text
codex exec \
  -c marketplaces.crews.source_type=local \
  -c "marketplaces.crews.source=\"<absolute-path>\"" \
  ...
```

(The `source` value must be quoted as a TOML string literal in the `-c` value.)

### Plugin enablement gap

But even with both `-c` flags, the plugin won't load until `[plugins.'<plugin>@<marketplace>'] enabled = true` exists in `~/.codex/config.toml`. There is NO CLI flag to enable a plugin per-spawn (no `codex plugin enable`, no `-c plugins.<id>.enabled=true` was tested live but the toggles.rs source suggests it should work as a `-c` override — recommend Story #4 verifies).

### Recommendation (matches plan Out-of-Scope D-001 minimalism)

For crews v1, the cleanest model is:

1. The crews installation step (manual once, or scripted by `node $CREWS_BIN install-codex`) adds the marketplace via `codex plugin marketplace add <crews-marketplace>` once per machine
2. The same step writes `[plugins.'crews@<marketplace-name>'] enabled = true` to `~/.codex/config.toml` once
3. The crews launcher does NOT need per-spawn `-c marketplaces.*` flags — it just spawns `codex` with the standard sandbox/cwd flags and codex picks up the pre-registered+pre-enabled plugin

This is the simpler model the brainstorm's D-005 minimalism advocated. Story #3 launcher should NOT plumb the `-c marketplaces.*` override unless a strong use-case emerges (e.g., per-spawn marketplace-version pinning).

### Live evidence

Successfully registered `probe-marketplace` via `codex plugin marketplace add C:/.../probe-marketplace`; resulting `~/.codex/config.toml` block:
```toml
[marketplaces.probe-marketplace]
last_updated = "2026-06-04T20:35:16Z"
source_type = "local"
source = '\\?\C:\Users\evmitran\AppData\Local\Temp\codex-probe\probe-marketplace'
```

Confirms the two-key requirement, AND confirms that `marketplace add` from a local path persists with `source_type = "local"` (the same TOML stanza form the launcher would need to construct manually).

---

## 3. `--sandbox workspace-write` rejection on `~/.crews/` writes (R3)

### Documented behavior

Per `codex --help`:
```
-s, --sandbox <SANDBOX_MODE>
        Select the sandbox policy to use when executing model-generated shell commands
        [possible values: read-only, workspace-write, danger-full-access]
```

The `workspace-write` policy permits writes only within the workspace root (the `-C/--cd <DIR>` directory). Writes to paths outside the workspace are rejected by the sandbox layer (Linux: bubblewrap/landlock; Windows: the codex windows-sandbox tooling that ships alongside `codex-core.exe` as `codex-windows-sandbox-setup.exe`).

### Documented mitigation: `--add-dir`

```
--add-dir <DIR>
        Additional directories that should be writable alongside the primary workspace
```

`--add-dir ~/.crews` (or wherever the crews data root lives) explicitly extends the workspace-write allowlist. This matches the plan's R3 mitigation exactly.

### Live evidence

A direct read of `~/.crews` writes via `codex exec` with `--sandbox workspace-write` and a workspace at `%TEMP%` was not attempted live in this session (it would require prompting codex to actually try the write and observing the sandbox refusal). The mitigation is well-documented in `codex --help` and the plan's chain (`--add-dir ~/.crews` first; fallback to `--dangerously-bypass-approvals-and-sandbox` if `--add-dir` is insufficient) is correct.

### Recommendation

Story #3 launcher always passes `--add-dir <crews-data-root>` alongside `--sandbox workspace-write`. Where `<crews-data-root>` resolves to `%USERPROFILE%\.crews` on Windows and `$HOME/.crews` on Unix.

---

## 4. Async-spawned subprocess survival across hook return (R2 — the GATE)

### How codex runs hook commands

From `hooks/src/engine/command_runner.rs::run_command` (lines 24-101):

```rust
let mut command = build_command(shell, handler);
command
    .current_dir(cwd)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

let mut child = match command.spawn() {
    Ok(child) => child,
    Err(err) => { /* failure path */ }
};
// ...write input_json to stdin...
match timeout(timeout_duration, child.wait_with_output()).await {
    Ok(Ok(output)) => CommandRunResult { stdout, stderr, exit_code, ... },
    /* timeout + error paths */
};
```

Three relevant guarantees:

1. **Piped stdio.** `Stdio::piped()` on stdin/stdout/stderr means the child process inherits open pipe handles. If the child spawns a grandchild that ALSO inherits those handles (default fd inheritance), the parent's `wait_with_output()` will block until ALL handles to those pipes are closed — even if the parent hook exits.
2. **`kill_on_drop(true).`** If codex drops the `Command` mid-flight (e.g., the entire codex process exits) the OS sends a kill signal to the immediate hook child. This does NOT propagate to grandchildren, BUT it does close the pipe handles from the immediate parent.
3. **`timeout` ceiling.** Hooks have a `handler.timeout_sec` ceiling (defaulting to whatever the per-hook `timeout` field specifies; the test fixtures showed values like 5-10s; probe used 10s). If the hook process doesn't return by then, codex kills it.

### Detached-child pattern (the path crews already uses for Claude/Copilot)

When a hook spawns a long-lived listener subprocess on Node:
```js
const child = spawn(process.execPath, [listenerScript, ...args], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});
child.unref();
```

`stdio: 'ignore'` redirects the child's stdin/stdout/stderr to `NUL` (Windows) or `/dev/null` (Unix). The child does NOT inherit the hook's pipe handles. When the hook's own process exits (returning to codex), codex's `wait_with_output()` sees the pipes close immediately and returns. The detached listener continues running with its own session — codex never sees it.

### Source-derived verdict for R2

**GREEN.** The same detached-subprocess pattern crews already uses for Claude/Copilot works for codex without modification, BECAUSE:
- Codex's `command_runner` does not Job-Object-confine hook children (no equivalent of the Windows Job Object policy used for tool-exec children in `core/src/spawn.rs`)
- The pipe-close-on-detach pattern works identically across all three engines
- Crews' existing `arm` listener already produces a detached process; codex's hook engine treats it the same way Claude/Copilot's do

### Live evidence (caveat)

The live R2 confirmation requires actually firing a hook and observing the detached listener's PID surviving the hook return. The probe plugin did not fire any hooks in this session (see hook-probe report §4 for the reason — `HooksFile` schema-wrap caveat). The source-derived conclusion is strong on its own, but Story #6 (briefing + listener-loop) MUST include a smoke test that spawns the arm listener from a codex `SessionStart` hook and verifies the listener PID is alive 2 seconds after the hook returns. If that smoke fails, R2 regresses to YELLOW and the plan must revisit polling-only delivery.

---

## 5. Terminal title rewriter (the `CODEX_DISABLE_TERMINAL_TITLE` question)

### What codex actually does

The codex TUI rewrites the terminal title on every redraw via `tui/src/terminal_title.rs`. Functions: `set_terminal_title`, `clear_terminal_title`, plus a `last_terminal_title` cache on `ChatWidget` to avoid duplicate OSC writes.

Examples of when the title changes:
- Initial title rendered at startup based on `config.tui_terminal_title` items
- Updates on activity (`activity` is a configurable title item; spins while working and shows "action required" when blocked on the user)
- The TUI re-emits the title for action-required state and an "animation" mode controlled by `config.animations`

### What disables it

Configuration is a TOML key `[tui] terminal_title = <Vec<String>>` (the items to render). From the source tests (`cli/src/doctor/title.rs::terminal_title_reports_disabled_configuration`):

```rust
configured_items: Some(Vec::new()),   // empty array → disabled
```

So `[tui] terminal_title = []` in `~/.codex/config.toml` disables the rewriter. **There is NO `CODEX_DISABLE_TERMINAL_TITLE` env var.** The plan's hypothesis (a hypothetical env var name) is wrong.

### Implication for crews

For crews' wt.exe tab title (`♙ <name> (<crew>)`), the launcher must:
- **EITHER** pass `-c "tui.terminal_title=[]"` on every `codex` spawn (per-session override)
- **OR** the crews install step writes `[tui] terminal_title = []` to `~/.codex/config.toml` once at install time (machine-wide override — possibly surprising to non-crews users; not recommended unless documented)

Recommendation: per-spawn `-c` form. Story #8 spec should drop the `CODEX_DISABLE_TERMINAL_TITLE` env stamp and replace with `-c tui.terminal_title=[]`.

### Live verification

Not run live (would require an interactive TUI session; codex exec doesn't render the title). Source confirmation is decisive — the rewriter is TOML-config-driven, no env path exists.

### Codex `exec` mode is NOT title-rewriting

`codex exec` is non-interactive (no TUI), so it does not invoke the title rewriter at all. The rewriter is a TUI-only concern. Crews members are spawned as interactive `codex` (not `codex exec`) per the plan's wt.exe tab model, so the rewriter IS in scope.

---

## 6. `--full-auto` parses on 0.125.0-copilot-api.8 — plan correction

The plan asserts at line 43: "Codex source shows top-level `codex --full-auto` no longer parses". This is **incorrect** against the installed CLI.

Live `codex --help` shows:
```
--full-auto
        Convenience alias for low-friction sandboxed automatic execution
```

So `--full-auto` IS a documented top-level flag. The plan's basis for switching to `--sandbox workspace-write` is overstated.

### But the launcher SWITCH is still correct, for a different reason

Crews needs **explicit, auditable** sandbox-policy control on the launcher command line, not a behind-the-scenes alias. `--full-auto`:
- Hides which sandbox mode and approval policy actually got applied
- Behaves like a "convenience" macro whose specific resolution may change across codex versions
- Doesn't compose cleanly with `--add-dir` (the docs don't promise that `--full-auto + --add-dir` is well-defined)

So the launcher should stick with explicit `--sandbox workspace-write --add-dir <crews-data-root>` as the plan specifies — **but the rationale in the plan should change** from "full-auto no longer parses" to "explicit flags are auditable and compose cleanly with --add-dir; --full-auto is a convenience alias whose resolution may change across versions". This is a docs/rationale fix, not a behavior fix.

### Verified CLI flag surface

The launcher MUST construct codex command lines using only documented flags. Verified live against 0.125.0-copilot-api.8 (`codex --help` + `codex exec --help` + `codex exec resume --help`):

```
codex [OPTIONS] [PROMPT]
codex [OPTIONS] <COMMAND> [ARGS]

Common options:
  -c, --config <key=value>            (multiple OK)
  --enable <FEATURE>                  (multiple OK)
  --disable <FEATURE>                 (multiple OK)
  -i, --image <FILE>...
  -m, --model <MODEL>
  --oss
  --local-provider <OSS_PROVIDER>
  -p, --profile <CONFIG_PROFILE>
  -s, --sandbox <read-only|workspace-write|danger-full-access>
  --full-auto                          ← AVAILABLE (plan said otherwise)
  --dangerously-bypass-approvals-and-sandbox
  -C, --cd <DIR>
  --add-dir <DIR>
  -a, --ask-for-approval <untrusted|on-failure|on-request|never>
  --search
  --no-alt-screen
  --skip-git-repo-check                ← REQUIRED if cwd is not a git repo
  -h, --help
  -V, --version

Subcommands: exec, review, login, logout, mcp, plugin, mcp-server, app-server, app,
             completion, sandbox, debug, apply, resume, fork, cloud, exec-server, features, help
```

Flags the plan referenced that DO NOT exist on this CLI version:
- `--name <name>` — plan correctly does NOT use this
- `--plugin-dir <dir>` — plan correctly does NOT use this
- `-i <input>` — `-i` IS present but maps to `--image`, NOT to a generic input file as the plan's launcher Story §126 could be misread

Flags the plan does NOT mention that are useful for crews:
- `--no-alt-screen` — runs TUI in inline mode (preserving terminal scrollback). Crews may want this for wt.exe tabs so users can scroll back over the member's log. Recommend Story #8 considers this.
- `--ask-for-approval never` — explicit non-interactive mode (the plan implicitly relies on this via the `--sandbox` choice but doesn't pin it; recommend Story #3 stamps it).

### `codex exec resume` argument order

`--sandbox` must be on the parent `codex exec`, NOT on `codex exec resume`:
```bash
# WRONG: codex exec resume <SID> --sandbox read-only "prompt"  → error: unexpected argument '--sandbox'
# RIGHT: codex exec --sandbox read-only -C <cwd> resume <SID> "prompt"
```

The `resume` subcommand has its own flag set (`--last`, `--all`, `--enable`, `--disable`, `-c`) — no sandbox flag. This is documented in `codex exec resume --help`.

---

## 7. Live-probe trace (for reproducibility)

| # | Command | Outcome / Finding |
|---|---|---|
| 1 | `codex --version` | `codex-cli 0.125.0-copilot-api.8` |
| 2 | `codex --help` (and `codex exec --help`, `codex plugin marketplace --help`, `codex exec resume --help`) | Documented CLI surface in §6 |
| 3 | `codex plugin marketplace add C:/.../probe-marketplace` | Persisted `[marketplaces.probe-marketplace] source_type = "local"  source = '\\?\C:/...'` to `~/.codex/config.toml` |
| 4 | `codex exec --skip-git-repo-check --sandbox read-only -C %TEMP% "say probe-1"` | Banner prints `session id: <UUID v7>`; no `CODEX_*` env stamping observed (plugin hooks did not fire — see hook-probe report) |
| 5 | `Select-String "set_var.*CODEX" codex-rs/**/*.rs` | Confirms ZERO production-path `CODEX_CLI` / `CODEX_AGENT_SESSION_ID` `set_var` calls. Only `CODEX_HOME` (test) and `CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL` (auth) exist. |
| 6 | Inspect `hooks/src/engine/discovery.rs:223-225` | Codex sets `PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_DATA` on hook child env. NO codex-identity vars. |
| 7 | Inspect `tui/src/terminal_title.rs` references via grep | Title rewriter exists, TOML-config-driven (`config.tui_terminal_title`). No env-var disable path. |
| 8 | `codex exec --sandbox read-only -C %TEMP% resume <SID> "say C"` | Confirms session_id IS reused (banner shows same UUID); see resume probe report |

---

## 8. Cumulative plan corrections for the launcher path

In the same priority order as the hook report's §6, scoped to launcher concerns:

1. **(critical)** Story #2 spec: `readSessionEnv` for codex keys off `CREWS_ENGINE === 'codex'` and reads `CREWS_CODEX_SESSION_ID` (launcher-stamped UUID), NOT a hypothetical `CODEX_CLI` / `CODEX_AGENT_SESSION_ID`. Same `SESSION_ENV_KEYS` scrub list extends to `CREWS_CODEX_SESSION_ID`, not the codex-emitted names.
2. **(critical)** Story #3 launcher: REMOVE `-c marketplaces.<n>.source=<abs>` per-spawn override from the in-scope items. Replace with a one-time install step (manual or scripted) that persists the marketplace via `codex plugin marketplace add` + the `[plugins.'<plugin>@<marketplace>'] enabled = true` toggle. Document the install prereq in AGENTS.md.
3. **(critical)** Story #8 spec: REPLACE `CODEX_DISABLE_TERMINAL_TITLE` env stamp with `-c tui.terminal_title=[]` on every codex spawn.
4. **(medium)** Plan line 43: rewrite the rationale for `--sandbox workspace-write` (NOT because `--full-auto` doesn't parse — it does — but because explicit flags are auditable and compose cleanly with `--add-dir`).
5. **(medium)** Story #3 launcher: stamp `--ask-for-approval never` explicitly (the plan implies but doesn't pin it).
6. **(low/nice-to-have)** Story #8 may consider `--no-alt-screen` so wt.exe tab users can scroll back over the codex member's history; not a blocker.
7. **(medium)** Plan §250: codex hook env-stamping requirements. Each codex hook entrypoint sets `process.env.CREWS_ENGINE = 'codex'` and `process.env.CREWS_CODEX_SESSION_ID = manifest.sessionId` early (matching the copilot pattern), NOT codex's hypothetical session env (which doesn't exist).
8. **(low)** Story #7 spec: codex inner-PID Windows-image-name guard expects `codex.exe`. Verified: the installed CLI shim is `codex.ps1` invoking `codex-core.exe` (per the CLAUDE.md launcher mechanism) — the actual long-running inner process on Windows is `codex-core.exe`, NOT `codex.exe`. Crews' Windows inner-PID capture for the recycled-PID guard must accept `codex-core.exe`. (The launcher process is `pwsh` running `codex.ps1`; the wt.exe tab is the launcher pwsh; the inner LLM-driving binary is `codex-core.exe`.)

---

## 9. Open items for implementation

- **(must)** Story #3 smoke test: spawn a codex member via the launcher, verify `Get-Process codex-core` returns the inner PID and the launcher pwsh PID is distinct. Without this evidence the inner-PID capture in Story #7 will target the wrong process.
- **(should)** Verify `--add-dir <path>` semantics against `~/.crews` writes live — write a node script that attempts a `~/.crews/probe-r3-test.json` write under `codex exec --sandbox workspace-write --add-dir <home>/.crews -C <other-dir>` and observe whether the write succeeds.
- **(should)** Verify `[plugins.'<id>'] enabled = true` can be set via per-spawn `-c plugins.'crews@toolkit'.enabled=true` if needed; live unverified this session.
- **(deferred / non-blocking)** Audit the empirical R2 outcome with an actual codex spawn that invokes the arm listener from a codex hook — this gives the full live confirmation of detached-listener survival.
