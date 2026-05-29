---
name: overview-reset
description: Hard-reset the ralph-overview watcher state when sessions get tangled. Kills any orphan sync-ralph-state.mjs watcher process for THIS repo, removes the owner-marker lease at .ralph-overview/generated/.lock/watcher.owner, and prepares for a clean MCP watcher or operator-launched dev-server restart. Use when stale outputs keep getting re-emitted by an old watcher, or when /list-jobs / overview_parallel_ready_tasks return stale data after a session restart.
---

# Skill: overview-reset

Operator-facing **emergency** skill for the bookkeeper/scrum-master lead
(see `D:/harness-efforts/codexu/CLAUDE.md`). Run this when the ralph-overview
watcher state is wedged — typically symptoms:

- `overview-data.json` (removed in plugin v2.0.1) keeps reappearing in `plans/`
- Sync results stale despite editing `.ralph/jobs/*/job-state.json`
- Two or more `sync-ralph-state.mjs` processes visible in `tasklist`/`ps`
- `mcp__ralph-overview__overview_parallel_ready_tasks` returns a `snapshotStaleSince`
  timestamp older than the most recent member terminal write (watcher froze
  mid-tick)

This skill resets the WATCHER. It does NOT touch `.ralph-overview/data.json` —
that's hand-curated by the bookkeeper lead. If your symptom is "task entries
in `.ralph-overview/data.json` are stale (still say `phase: plan-ready` after a ship)",
that's a bookkeeper-update miss, not a watcher problem; see the bookkeeper
duties in `CLAUDE.md` and the `feedback_bookkeeper_updates_overview_data`
auto-memory entry.

The plugin's own auto-cleanup (cooperative lease, per-MCP-pid heartbeat, and orphan-only reclaim in v2.1.0+) handles the common MCP peer-collision cases. This skill is the manual escape hatch when auto-cleanup cannot prove ownership — e.g. watchers spawned outside MCP (`pnpm sync-ralph-state:watch` manually), or watchers whose cmdline doesn't match the conservative `--repo <this-repo>` criteria.

## Run these steps in order:

### 1. Find every sync-ralph-state.mjs process for THIS repo and kill them

Windows (PowerShell):

```powershell
$repo = (Get-Location).Path
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object {
    $_.CommandLine -like '*sync-ralph-state.mjs*' -and
    $_.CommandLine -like "*--repo $repo*"
  } |
  ForEach-Object {
    "killing watcher pid $($_.ProcessId): $($_.CommandLine)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
```

Linux/macOS (bash):

```bash
REPO="$(pwd)"
ps -ef | grep '[s]ync-ralph-state\.mjs' | grep -F -- "--repo $REPO" | awk '{print $2}' | xargs -r kill -TERM
sleep 1
ps -ef | grep '[s]ync-ralph-state\.mjs' | grep -F -- "--repo $REPO" | awk '{print $2}' | xargs -r kill -KILL  # only if SIGTERM didn't take
```

The `--repo <this-repo>` filter is critical — don't kill watchers for OTHER repos open in different Claude Code sessions.

### 2. Remove the owner-marker lease

```
rm .ralph-overview/generated/.lock/watcher.owner
```

(The MCP server's preflight reclaim usually cleans this up, but the file may stay if cleanup failed.)

### 3. Optionally sweep orphan parent-heartbeat files

The plugin v2.1.0+ does this on every MCP startup, but you can force it now:

Windows:
```powershell
Get-ChildItem "$env:USERPROFILE\.cache\ralph-overview-mcp\watcher-parent-*.owner" -ErrorAction SilentlyContinue |
  ForEach-Object {
    if ($_.Name -match 'watcher-parent-(\d+)\.owner') {
      $pid = [int]$Matches[1]
      if (-not (Get-Process -Id $pid -ErrorAction SilentlyContinue)) {
        Remove-Item $_.FullName -Force
      }
    }
  }
```

Linux/macOS:
```bash
for f in ~/.cache/ralph-overview-mcp/watcher-parent-*.owner; do
  [ -f "$f" ] || continue
  pid="${f##*-}"; pid="${pid%.owner}"
  kill -0 "$pid" 2>/dev/null || rm -f "$f"
done
```

### 4. Restart the watcher / dev server

Either:
- Wait ~10s and the MCP server will auto-respawn the watcher (it polls for the owner-marker going stale)
- OR run `pnpm overview:dev` from the codexu root to start the operator-managed viewer dev server
- OR run `pnpm sync-ralph-state` to trigger a one-shot sync without a long-running watcher

## When NOT to use this skill

- **Routine session restarts** — v2.0.2 auto-handles those. If you find yourself running this skill on every session start, file an issue against `ralph-overview` because the auto-cleanup isn't catching your case.
- **For non-overview-bookkeeper repos** — this skill is repo-local (lives in `.claude/skills/`); it operates on `(pwd)` and won't reach watchers in sibling repos. If you have watchers across multiple repos that need cleaning, run this skill in each repo.
- **When the dev server is healthy** — killing watchers mid-flight will trigger an EXIT crash + backoff restart, briefly losing watcher state. Only run when the state is already wedged.

## Implementation notes

- **v2.1.0 boundary:** MCP peers now coordinate with a cooperative owner marker, so a 3-MCP peer-collision cascade should leave one active watcher and passive consumers instead of requiring this reset skill. Use this skill for stale non-MCP-spawned watchers such as manual `pnpm sync-ralph-state:watch` processes, or for orphan cases that the supervisor cannot prove safely. The operator-launched dev server still has the v2.0.3 file-only HMR fallback when another watcher holds the lease; it is a consumer in that mode, not the sidecar writer.
- The owner-marker uses an mtime + heartbeat scheme. The `OWNER_FRESH_MS` is 10s (in `watch-ralph-state.mjs`); a stale marker is auto-evicted on next claim attempt.
