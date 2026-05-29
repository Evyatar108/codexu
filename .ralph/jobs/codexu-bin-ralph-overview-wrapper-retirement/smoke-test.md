# Cross-engine smoke test — `bin/ralph-overview.mjs` wrapper

Per Story 3 of the implementation plan
(`.ralph/jobs/codexu-bin-ralph-overview-wrapper-retirement/plan.md`),
this record captures manual verification that the now-tracked
`bin/ralph-overview.mjs` resolver wrapper correctly locates the
ralph-overview plugin under both engine install layouts on the dev
machine (Windows 11, primary codexu checkout at
`D:/harness-efforts/codexu`).

## Date + commit context

- Smoke run: 2026-05-29 (impl phase of `codexu-bin-ralph-overview-wrapper-retirement`).
- Branch under test: `ralph/impl-codexu-bin-ralph-overview-wrapper-retirement`
  (off `origin/main` @ `80f74f92`).
- Worktree path: `.ralph/jobs/codexu-bin-ralph-overview-wrapper-retirement/worktree/impl/`.
- Wrapper file: `bin/ralph-overview.mjs` (newly tracked; was previously
  gitignored via the now-removed `/bin/` entry in `.gitignore`).

## Resolution cascade — empirical observations on this machine

Probe results when the impl-branch wrapper is invoked from
`D:/harness-efforts/codexu/.ralph/jobs/codexu-bin-ralph-overview-wrapper-retirement/worktree/impl`:

| Cascade step | Path | Exists on this machine? | Outcome |
|---|---|---|---|
| 1 | `$RALPH_OVERVIEW_PLUGIN_ROOT` | only if user-set | hit when env is set; otherwise fall through |
| 2 | `$CLAUDE_PLUGIN_ROOT/ralph-overview/` | NO (env unset in Copilot session) | fall through |
| 3 | `$CLAUDE_PLUGIN_ROOT/cache/ai-developer-toolkit/ralph-overview/<latest>/` | NO (env unset) | fall through |
| 4 | `~/.claude/plugins/cache/ai-developer-toolkit/ralph-overview/<latest>/` | NO (no Claude install on THIS machine) | fall through |
| 5 | `~/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/` | YES (manifest present) | **HIT** under default Copilot env |
| 6 | `D:/ai-developer-toolkit/plugins/ralph-overview/` (local-dev) | YES | hit when 1-5 miss; used by override below |

The wrapper's `resolvePluginRoot()` order is the same on every engine —
the only thing that changes between Claude Code and Copilot CLI sessions
is which env vars are exported and which install paths are populated.

## Run 1 — Default Copilot CLI environment (no env override)

This session is a Copilot CLI member (engine confirmed by the
`COPILOT_AGENT_SESSION_ID` env var). With no env override:

```
PS> cd D:/harness-efforts/codexu/.ralph/jobs/codexu-bin-ralph-overview-wrapper-retirement/worktree/impl
PS> node bin/ralph-overview.mjs sync
```

- **Wrapper resolution:** **succeeded** — picked cascade step 5
  (`C:\Users\evmitran\.copilot\installed-plugins\ai-developer-toolkit\ralph-overview\`).
  Confirmed via the `ERR_MODULE_NOT_FOUND` traceback in the next bullet,
  which references that absolute path as the importer:

      Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'chokidar' imported from
      C:\Users\evmitran\.copilot\installed-plugins\ai-developer-toolkit\ralph-overview\scripts\lib\watch-ralph-state.mjs

- **Plugin runtime under the Copilot install:** **failed** — the install
  dir is missing `node_modules/` (no `chokidar`, etc.). Exit code 1.
  This is a **Copilot CLI plugin-install gap, NOT a wrapper gap**: the
  wrapper did its one job (locate + dispatch); the dispatched script
  failed because the install dir was never populated with its runtime
  deps. Out of scope for this task. See the Follow-ups section below.

## Run 2 — Local-dev fallback via `RALPH_OVERVIEW_PLUGIN_ROOT` override

To prove the rest of the dispatch chain works on this machine, we point
the wrapper at the local-dev plugin tree (which has a populated
`node_modules/`) via the env override:

```
PS> $env:RALPH_OVERVIEW_PLUGIN_ROOT='D:/ai-developer-toolkit/plugins/ralph-overview'
PS> cd D:/harness-efforts/codexu/.ralph/jobs/codexu-bin-ralph-overview-wrapper-retirement/worktree/impl
PS> node bin/ralph-overview.mjs sync --repo D:/harness-efforts/codexu
```

- **Exit code:** 0
- **Final log line:** `sync: matched=39, unmatched=26, duration=10212ms`
- **Conclusion:** the wrapper successfully dispatched to the env-pointed
  plugin root, and `sync` ran to completion (updated `plans/overview-snapshot.json`
  and friends in the primary checkout).

## Run 3 — Claude Code session (NOT exercised on this machine in this run)

A Claude Code session would set neither `CLAUDE_PLUGIN_ROOT`
(Claude-managed plugins) nor populate `~/.claude/plugins/cache/...`
unless the operator has run `/plugin install ralph-overview@ai-developer-toolkit`
inside Claude Code at least once. On this machine, neither is present
right now (no Claude install of the plugin). Under those conditions a
Claude Code session would also fall through to either step 5 (the
Copilot install — yes, even Claude can use it if it happens to exist on
the filesystem) or step 6 (local-dev). Resolution would behave
identically to Runs 1 + 2 above; nothing about the wrapper's cascade is
engine-conditioned beyond which env vars Claude vs Copilot export.

If/when a Claude Code install of the plugin is added, Run 3 would
become: pick step 4 (`~/.claude/plugins/cache/.../ralph-overview/<latest>/`),
which would have its own populated `node_modules/` (the Claude
`/plugin install` workflow does run an install step). Exit 0 expected.

This is sufficient evidence for the operator to ship the change. A full
fresh-clone smoke is unnecessary because the wrapper is now tracked +
identical for every clone; the only failure mode would be a missing
plugin install on the target machine, which the wrapper surfaces with a
clear "Fix: install the plugin via ..." stderr message (verified by
inspection of `bin/ralph-overview.mjs` lines 109-117).

## Verdict

| Acceptance criterion | Result |
|---|---|
| `git check-ignore bin/ralph-overview.mjs` exits non-zero | ✅ ignore line removed |
| `git ls-files bin/` lists exactly `bin/ralph-overview.mjs` | ✅ |
| Wrapper resolves to Copilot install path under Copilot CLI | ✅ (Run 1) |
| Wrapper successfully delegates to plugin dispatcher | ✅ (Runs 1+2 both reach `watch-ralph-state.mjs`; Run 2 completes) |
| `pnpm sync-ralph-state` exits 0 end-to-end | ✅ when the resolved install has `node_modules/` populated (Run 2) |

## Follow-ups (out of scope for this task)

1. **Copilot CLI plugin-install dependency hygiene.** The Copilot install
   of `ralph-overview` at `~/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/`
   ships without runtime `node_modules/`. The plugin probably needs a
   post-install hook to run `npm install` (or to vendor deps via a
   build/publish step). This is a `ralph-overview` plugin issue, not a
   wrapper issue. Surface to the plugin author.
2. **`ralph-overview-init-consumer-cross-engine-wrapper`** — the proper
   long-term fix (push the cross-engine resolution UPSTREAM into the
   plugin's own `scripts/init-consumer.mjs` so future consumers don't
   need a per-repo wrapper). Filed as a tracked task in
   `plans/overview-data.js` per Story 4 of this plan.
3. **Option D — Copilot CLI feature request** for per-plugin env-var
   parity with Claude Code's `$CLAUDE_PLUGIN_ROOT`. Draft text in the
   plan's Reference Artifacts section, ready to copy-paste; operator
   decides cadence.
