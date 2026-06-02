---
name: diagnose-codex-stream-cut
description: Triage runbook for user reports of "codex response stopped mid-stream" or "TUI froze in the middle of generating". Walks through enabling the opt-in CODEX_STREAM_TRACE=1 + CODEX_SHUTDOWN_TRACE=1 instrumentation, reproducing the failure, interpreting the JSONL sidecar at ~/.codex/sessions/<id>/stream-cut-dump.jsonl, and mapping the classified cause to a suspect ranking. Use whenever a user reports any flavor of mid-response truncation in the codex fork (Evyatar108/codex via gim-home/codex). NOT for clean turn-end behavior or full upstream issues — those go through the standard /audit or /runtime-audit flow.
---

# Diagnose codex stream-cut

A user reports "codex response stops mid-stream" or "TUI just sat there for a while then exited" or "got half a response and nothing more". This skill walks through the operational triage flow added in the `codex-stream-cut-diagnostics` ship (2026-06-01, inner SHA `69a2108a7`, wrapper SHA `7b6387340`, codexu pointer `28f78ca0`).

## When to invoke

- User reports mid-response truncation in `codex` (interactive TUI) OR `codex exec` (one-shot CLI).
- A bookkeeper-lead or operator triages a stream-cut bug report.
- A `codex` fork user attaches a `stream-cut-dump.jsonl` sidecar to a bug report and you need to interpret it.

Do NOT invoke for:
- Clean turn end (no truncation symptom).
- Upstream `openai/codex` bugs — those go through the upstream issue tracker.
- Build / install / login failures — those have their own flows (`/audit`, `/verify`).

## Step 1 — gather symptom shape

Before any instrumentation, ask the user (or extract from their report):

| Question | Why it matters |
|---|---|
| Interactive TUI (`codex`) or one-shot (`codex exec`)? | `codex exec` does NOT retry 401/403 (CLAUDE.md confusion-point) — auth-expiry is a likely fork-side cause here. |
| Always at the same point in a response, or random? | Same-point → token-budget / server-side timeout. Random → SSE flake or network. |
| During text streaming, or after a tool call? | After tool call → suspect Windows Job Object (`spawn.rs::attach_windows_job`). During text → SSE flake. |
| Any MCP servers configured? (`~/.codex/config.toml`) | Boosts suspect for Stage A `EventMsg::McpServerNotification` fanout (shipped 2026-06-01, low test coverage). |
| Behind a corporate proxy / VPN / Defender? | Boosts SSE-cut probability. |
| Output something specific about which model? | Some Copilot model variants have known server-side timeout quirks. |

Record this in your bug-triage notes BEFORE instrumenting. The cause classification produced in Step 4 is only meaningful against a known symptom shape.

## Step 2 — instrument the user (or local repro)

Have the user (or yourself, if reproducing locally) set the diagnostics env BEFORE invoking codex:

**PowerShell:**
```powershell
$env:CODEX_STREAM_TRACE = "1"        # enable stream-cut classifier + sidecar dump
$env:CODEX_SHUTDOWN_TRACE = "1"      # also Job Object close attribution (tool-exec hangs)
$env:RUST_LOG = "codex_stream_diagnostics=debug,codex_core=info"
codex.exe                            # or `codex.exe exec <prompt>` for the one-shot path
```

**Bash / Git Bash:**
```bash
export CODEX_STREAM_TRACE=1
export CODEX_SHUTDOWN_TRACE=1
export RUST_LOG=codex_stream_diagnostics=debug,codex_core=info
codex                                # or `codex exec <prompt>`
```

The env vars are zero-overhead when unset — the user can leave them set permanently if they want diagnostics on every session. Confirmed safe (no customer-data leakage, see Step 5 privacy guarantees).

## Step 3 — reproduce the cut

Have the user reproduce the failure with the env vars set. The classifier emits a tracing event AND writes a JSONL sidecar regardless of whether the cause is benign (clean EOF) or abnormal (silent end). Look at:

- **stderr tracing output:** `[copilot-stream-end] cause=<...> bytes_streamed=<n> events_streamed=<n> last_event_kind=<variant-name> turn_id=<hashed>` on EVERY turn termination
- **Sidecar file:** `~/.codex/sessions/<session-id>/stream-cut-dump.jsonl` written ONLY on abnormal termination (cause ≠ `completed`)

If no sidecar file appears after a reported cut, that's diagnostic in itself — either the cut was actually a clean end (user perceived it as cut but server sent `Completed`) OR the diagnostics didn't activate (env not set / not picked up by the codex-core subprocess — recheck Step 2).

## Step 4 — classify the cause + map to suspect

Open the sidecar JSONL. First line is the `stream-end` record. Map the `cause` field:

| `cause` value | What it means | Top suspect |
|---|---|---|
| `completed` | Clean `ResponseEvent::Completed` arrived. NOT a cut. | None — user misperception OR upstream tool-result formatting issue. Re-check Step 1 symptom shape. |
| `eof-before-completed` | `stream.next()` returned `None` BEFORE `Completed`. Server FIN'd the SSE stream early. | **SSE-cut** — Copilot Responses API server-side timeout, proxy injection, HTTP/2 RST_STREAM, idle disconnect. Most common fork-relevant cause. Check `bytes_streamed` — if low (<10 KB) suspect immediate auth-expiry or rate-limit; if high (>100 KB) suspect long-response server timeout. |
| `provider-error` | `stream.next()` returned `Some(Err(...))`. Look at the error variant. | Check `http_status` + `io_error_kind` in the sidecar. 401/403 → bearer-expiry race (CLAUDE.md confusion-point: `codex exec` doesn't retry, TUI retries up to 2x). 5xx → Copilot upstream. ConnectionReset / BrokenPipe → network/proxy. |
| `client-cancel` | User pressed Ctrl-C / Esc / TUI dismissed turn. | None — user-initiated. Not a bug. |
| `unfinalized` | `StreamCutTracker` Drop ran without explicit `finish_with()`. | **Programming error in OUR fork code**, not a stream cut. File as a separate bug — we missed a code path. Indicates a divergent return-or-break in `turn.rs` that doesn't go through the classifier. |
| `io-error` | Tokio-level IO error consuming the response body bytes. | Network / proxy layer below HTTP. Check `io_error_kind` field. |
| `timeout` | Stream consumer timeout fired. | Lower-level than the others; usually proxied through `io-error` so this is rare. |

For tool-exec hang specifically (user reported "TUI froze after the model invoked a tool"), grep the captured stderr for the `[shutdown-trace] copilot-job-object` breadcrumbs to determine which of the three Job Object lifecycle states the hang occurred in:

| Breadcrumb pattern | State |
|---|---|
| Neither `watcher-installed` nor `close` | Watcher never installed — bug in `attach_windows_job` |
| `watcher-installed pid=N` but no `close` | Watcher installed but never fired — child process leak or stuck await |
| Both `watcher-installed` and `close` | Job closed cleanly — hang is NOT in the Job Object layer; look upstream |

## Step 5 — privacy & safe attachment

The sidecar file is designed to be **safe to attach to a public bug report**. The privacy canary (`codex-rs-overlay/codex-stream-diagnostics/tests/privacy_canary.rs`) is a HARD build gate that asserts no customer data ever leaks:

- ✅ Variant names: yes (`OutputTextDelta`, `ToolCallInputDelta`, etc.)
- ✅ Byte counts + sequence numbers + timestamps: yes
- ✅ Hashed session_id / turn_id (FNV-1a): yes
- ❌ Event payload text: never
- ❌ Tool call arguments: never
- ❌ Tool call results: never
- ❌ User prompt content: never
- ❌ Verbatim session/turn IDs: never (FNV-1a hashed before persistence)

If you ever see customer-looking data in a sidecar file, that's a real privacy bug and should be filed IMMEDIATELY at high priority — the canary test should have prevented it.

## Step 6 — file a bug or close

Map classifier output to action:

- **`completed` cause + user reports cut:** misperception OR upstream Copilot formatting issue. Reproduce manually with the same prompt + model. If consistent, file an upstream `openai/codex` issue.
- **`eof-before-completed` + corporate proxy/VPN:** likely environment, not fork bug. Document workaround (different network) and watch for recurrence.
- **`eof-before-completed` + clean environment + same prompt + reproducible:** likely Copilot Responses API server-side timeout. File as `codex` upstream-or-Copilot-API bug.
- **`provider-error` 401/403 + `codex exec`:** known limitation (CLAUDE.md confusion-point — `codex exec` one-shot does NOT retry). File as fork follow-up: "extend `copilot_auth_retries` to one-shot `responses_cmd::run_responses_with_auth`".
- **`unfinalized`:** OUR bug. Open a tracked task `codex-stream-diagnostics-missing-finalize-at-<path>` and fix the divergent return-or-break in `turn.rs`.
- **Job Object hang (watcher-installed but never closed):** OUR bug. File `codex-rs-spawn-job-object-watcher-leak`.

## References

- Inner SHA: `69a2108a7c` on `Evyatar108/codex-openai-fork::sandbox-patches`
- Wrapper SHA: `7b6387340` on `gim-home/codex::main`
- Codexu submodule pointer: `28f78ca0` on `Evyatar108/codexu::main`
- Patch-surface invariant 30 + §15 replant: `codex/docs/implementation/patch-surface.md`
- Privacy canary test: `codex/codex-rs-overlay/codex-stream-diagnostics/tests/privacy_canary.rs`
- Confusion-point bullets: `codex/CLAUDE.md` + `codex/AGENTS.override.md` (search for `CODEX_STREAM_TRACE`)
- Original user report bookkeeping: `.ralph-overview/data.json::codex-stream-cut-diagnostics` (lifecycle=merged)
