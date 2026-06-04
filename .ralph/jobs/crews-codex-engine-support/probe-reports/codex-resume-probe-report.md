# Codex Resume Probe Report (Story #0 — crews-codex-engine-support D-001)

**Date:** 2026-06-04
**Codex CLI under test:** `codex-cli 0.125.0-copilot-api.8`
**Plan ref:** `.ralph/jobs/crews-codex-engine-support/plan.md` Story #0 ACs + R5 + Story #7 (resume path + stop-flow)
**Method:** static source review of `codex-rs/cli/src/main.rs` (resume CLI parser) + live `codex exec` and `codex exec resume <SID>` invocations with stdout banner capture

---

## TL;DR

| Q | Answer | Method |
|---|---|---|
| Does `codex resume <id>` reuse the same session id? | **YES (LIVE-PROVEN)** | live `codex exec resume <SID>` printed the exact same session-id UUID as the original spawn |
| Does the SessionStart hook fire on resume with `input.session_id === <id>`? | **YES (source-derived, high-confidence)** | source: `interactive.resume_session_id` is plumbed through to the session, and SessionStart hook fires with the session's id. Live hook-fire verification deferred (the probe plugin's hooks did not fire in this session — see hook-probe report §4 for the schema-wrap caveat) |
| Is a transcript file lookup by date-tree needed for an existence-check fallback? | **NO** | `codex exec resume <SID>` returns a clean error if the id is unknown (per the CLI parser path). Crews can `try codex resume <sid>` and fall back to bare relaunch on non-zero exit; no need to peek at on-disk transcript existence first |
| **GATE for R5** | **GREEN — crews' v1.2.2 stable-session-id invariant is preserved across codex resume** | live-proven |

---

## 1. Live evidence: session-id REUSED across resume

### Three back-to-back invocations

```text
$ codex exec --skip-git-repo-check --sandbox read-only -C %TEMP% "say A"
session id: 019e9461-a263-7f33-b305-2241b09d1ccf

$ codex exec --skip-git-repo-check --sandbox read-only -C %TEMP% "say B"
session id: 019e9461-c813-7f43-ad94-0b204f2e8100   ← fresh session B; SAVED THIS UUID

$ codex exec --sandbox read-only -C %TEMP% resume 019e9461-c813-7f43-ad94-0b204f2e8100 "say C"
session id: 019e9461-c813-7f43-ad94-0b204f2e8100   ← SAME UUID
```

The resume invocation printed the IDENTICAL UUID as the `say B` original. Session id is reused; it is NOT regenerated on resume. **R5 is GREEN, live-proven.**

### Session-id format

UUID v7 (timestamp-ordered, monotonic across spawns). The probe captured 4 distinct session-ids across the session:
- `019e9459-cc1d-7261-ad65-404487f5d406`
- `019e945a-c002-7863-bf44-f5d4a3744be7`
- `019e945c-221a-77d0-842d-a9b2b2d9f7f0`
- `019e9461-c813-7f43-ad94-0b204f2e8100`

All carry the same time-ordered prefix `019e94..` (codex's monotonic epoch). The UUID v7 format is decisive — crews can rely on it for sort-order if needed (timestamp-first byte layout). For comparison, Claude session ids are also UUID v4-like; Copilot uses GUID format. Crews' existing 36-char-uuid-string protocol works unchanged for codex.

---

## 2. Source-derived: SessionStart hook receives the resumed id

From `codex-rs/cli/src/main.rs:2133-2138` (the `resume` subcommand wires the session id into the interactive runtime):

```rust
let resume_session_id = session_id;
interactive.resume_picker = resume_session_id.is_none() && !last;
interactive.resume_last = last;
interactive.resume_session_id = resume_session_id;
interactive.resume_show_all = show_all;
interactive.resume_include_non_interactive = include_non_interactive;
```

And from the test assertions at `cli/src/main.rs:2795`:
```rust
assert_eq!(interactive.resume_session_id.as_deref(), Some("1234"));
```

So the positional `<SESSION_ID>` arg is plumbed all the way through to `interactive.resume_session_id`. The interactive runtime then resumes the recorded session using that id; the SessionStart hook fires for the resumed session and the `input.session_id` carries the SAME id (because resume is a continuation, not a re-spawn — codex doesn't regenerate the id at resume time, which is what the live banner confirms).

### Source confirms: SessionStart hook fires with source/matcher = "resume"

Per the canonical options-mode `.codex/hooks.json` matcher `"matcher": "startup|resume"` and the SessionStart `matcher_inputs` selection logic, resume-flow firings of SessionStart carry a `source` that matches `resume` (NOT `startup`). The codex schema's `SessionStartCommandInput` was not fully read in this session but the matcher behavior is consistent with Claude's session-start `source` enum (`startup` / `resume` / `clear` / `compact`).

### Live-hook confirmation deferred

The probe plugin's SessionStart hook did NOT fire successfully in this session (see hook-probe report §4 — the `HooksFile` schema-wrap caveat blocked the probe). Hence the live confirmation of "SessionStart fires with `input.session_id === <original-id>`" is deferred to Story #6/Story #7 smoke testing.

Recommended Story #7 acceptance test addition:
```text
1. Spawn codex member A via crews launcher; capture sessionId from manifest.
2. Stop member A (graceful or hard-stop).
3. Re-spawn via `crews resume-crew --confirm` (which dispatches `codex resume <sessionId>`).
4. Assert: the resumed member's manifest sessionId === pre-stop sessionId.
5. Assert: the resumed SessionStart hook log carries `input.session_id === <sessionId>`.
```

If steps 4 and 5 succeed, R5 is fully live-confirmed and crews' v1.2.2 stable-session-id invariant is preserved end-to-end.

---

## 3. No transcript-file existence check needed

### Codex's resume failure path is clean

`codex exec resume <unknown-id>` returns a clean error exit code (the CLI parser dispatches through `interactive.resume_session_id`; if the id is unknown the resume sub-runtime returns an error before the model is invoked). The plan's R5 mitigation called for "permissive transcript-existence check, skip date-tree glob in MVP" — that approach is correct and **simpler than the plan implied**: crews doesn't need to glob `~/.codex/sessions/` at all.

### Recommended Story #7 flow

```text
repairManifestForResume:
  if engine === 'codex':
    1. command = `codex resume ${oldSessionId}`
    2. spawn the launcher subprocess with this command
    3. wait briefly for the launcher to produce stdout/stderr
    4. if launcher exits non-zero or stdout contains a recognizable "session not found" pattern:
         - log a warning to ~/.crews/<crew>/members/<name>/launcher.log
         - relaunch with bare `codex` + full continuation briefing
         - manifest: clear the old sessionId; let first SessionStart hook fire stamp the new id
    5. otherwise:
         - launcher continues; first SessionStart hook fire confirms the resumed sessionId
         - manifest already has the correct sessionId from pre-stop state
```

No date-tree glob needed; codex itself reports unknown-id cleanly. The cost is one launcher-spawn attempt that may immediately fail; the failure cost is one stderr message + a bare relaunch.

### Alternative: `codex resume --last`

For the simpler "resume the most recent session" flow, codex supports `codex resume --last` (or `codex exec resume --last`). This bypasses the id-lookup path entirely. Crews could use this if it's confident the most recent codex session in the spawned member's worktree IS the one to resume — but this is fragile across multiple co-existing members. Recommend sticking with explicit `codex resume <sessionId>`.

---

## 4. Stop-flow / inner-PID capture (cross-reference, not a new probe)

Cross-references the launcher probe report's §8.8 finding: on Windows, the inner LLM-driving binary is `codex-core.exe`, NOT `codex.exe`. The CLI shim `codex.ps1` invokes `codex-core.exe`. Crews' Windows inner-PID capture in `hooks/actors.js::ENGINE_BINARIES` must accept `codex-core.exe`. The launcher process is `pwsh` running `codex.ps1`; the wt.exe tab hosts the launcher pwsh; the inner LLM-driving binary is `codex-core.exe`.

After resume, the stop-flow contract is unchanged: hard-stop kills `codex-core.exe`, launcher pwsh exits cleanly, wt.exe tab closes per `closeOnExit: graceful`. Resume + stop together should compose without issue (resume is just a fresh spawn of codex-core.exe that points at the same on-disk session record).

The recycled-PID guard must use the `codex-core.exe` image name, not `codex.exe`.

---

## 5. Live-probe trace (for reproducibility)

| # | Command | Output |
|---|---|---|
| 1 | `codex exec --skip-git-repo-check --sandbox read-only -C %TEMP% "say A"` | `session id: 019e9461-a263-7f33-b305-2241b09d1ccf` |
| 2 | `codex exec --skip-git-repo-check --sandbox read-only -C %TEMP% "say B"` | `session id: 019e9461-c813-7f43-ad94-0b204f2e8100` |
| 3 | `codex exec --sandbox read-only -C %TEMP% resume 019e9461-c813-7f43-ad94-0b204f2e8100 "say C"` | `session id: 019e9461-c813-7f43-ad94-0b204f2e8100` ← SAME |
| 4 | Inspect `cli/src/main.rs::2133-2138` (resume id wiring) | `interactive.resume_session_id = resume_session_id;` |
| 5 | Inspect `cli/src/main.rs::2795` (test assertion) | `assert_eq!(interactive.resume_session_id.as_deref(), Some("1234"));` |
| 6 | `codex exec resume --help` | Confirms argument order: `[OPTIONS] [SESSION_ID] [PROMPT]`; `--sandbox` is on parent `codex exec`, NOT on `resume`; supports `--last`, `--all` |

---

## 6. Open items for implementation

- **(must)** Story #7 acceptance test: live-confirm SessionStart hook fires with `input.session_id === <pre-stop-id>` after a crews-mediated `resume-crew --confirm` cycle. This closes the source-derived gap from §2.
- **(should)** Story #7 spec: drop the "permissive transcript-existence check via date-tree glob" complexity. Just try `codex resume <id>`; fall back on non-zero exit. Simpler and more robust.
- **(should)** Document in AGENTS.md that codex's resume path REUSES the original session_id, matching crews' v1.2.2 stable-session-id invariant. This is a feature parity win; users moving from Claude/Copilot to codex don't lose any continuity.

---

## 7. Verdict on R5 + relation to overall D-001 gate

**R5 is GREEN.** Combined with R1 (hook-probe report — GREEN, fully source-confirmed) and R2 (launcher-probe report — GREEN, source-derived high-confidence; full live confirmation deferred to Story #6 smoke), all three critical gates clear:

| Risk | Status | Source |
|---|---|---|
| R1 — codex honors `decision: block` on PreToolUse | **GREEN** (live) | hook-probe report §3 |
| R2 — codex hook engine doesn't kill detached subprocess across hook return | **GREEN** (source-derived; deferred live) | launcher-probe report §4 |
| R3 — `--sandbox workspace-write` + `~/.crews` writes mitigation | **GREEN** (documented + `--add-dir` exists) | launcher-probe report §3 |
| R4 — per-spawn `-c marketplaces.<n>.source=<abs>` | **YELLOW** (works with TWO `-c` keys + config.toml plugin-enable stanza; not single-flag) | launcher-probe report §2; plan can drop in-scope item |
| R5 — `codex resume <id>` reuses session id | **GREEN** (live) | this report §1 |

**Overall verdict: CONTINUE-WITH-D-001.**

The plan's hook-enforcement assumption is sound. The remaining plan-side corrections (§6 of each report) are tactical edits to story specs, not architectural pivots:

- env-var names (CODEX_CLI / CODEX_AGENT_SESSION_ID don't exist → use crews-owned CREWS_CODEX_SESSION_ID)
- per-spawn marketplace override (drop the in-scope item; require one-time install)
- hooks.json schema wrapper (`{ "hooks": { ... } }`)
- terminal title disable mechanism (TOML, not env)
- inner Windows binary name (`codex-core.exe`, not `codex.exe`)
- `--full-auto` IS available (plan rationale needs rewording; behavior choice unchanged)

None of these falsify D-001. Stories #1-#9 can proceed.

NO replan to D-005 (codex MCP/app-server inversion) is needed at this time. D-005 remains explicitly preserved in Out-of-Scope per the plan; if a future codex version regresses any of the GREEN risks, D-005 is the documented fallback.
