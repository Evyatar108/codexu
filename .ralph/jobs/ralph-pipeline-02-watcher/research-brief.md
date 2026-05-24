# Research Brief — Plan 02 Watcher Improve

## Researcher Findings (codebase + plan audit)

### Plan-referenced files — status

**EXIST:**
- `scripts/lib/sync-core.mjs` (exports: `walkRalphState`, `writeSidecar`, `resolveCrossKindPrecedence`, `pickMostRecentByMtime`, `_resetUnknownPhaseWarnings`)
- `scripts/lib/derive-ralph-stage.mjs` (canonical stage predicate; maps `terminalReason==='replan'` → `replan-pending`)
- `scripts/lib/default-config.mjs` (line 13: `lockFile`)
- `scripts/lib/resolve-config.mjs`
- `scripts/sync-ralph-state.mjs` (one-shot only; supports `--repo`, `--config`; no `--watch`, no lock yet)
- `tools/overview-viewer/vite.config.ts` (existing `overviewDataPlugin`; watches `plans/overview-data.js` via `server.watcher.add` and emits `overview-data:update`)
- `tools/overview-viewer/src/types.ts` (RalphStage union has all 10 stages incl. `replan-pending`)
- `plans/overview-ralph-state.{js,json}` (generated artifacts)
- `tools/overview-viewer/src/__tests__/ralphStage.test.ts`, `syncCore.test.ts`
- `tools/overview-viewer/vitest.config.ts` (split projects: ssr [node] + interactions [jsdom])
- `.ralph/overview-config.json` and `.ralph/overview-config.schema.json` (committed; includes `lockFile`, `watcher.ignored`)
- `scripts/lib/sync-core.d.mts` and TS ambient declarations in `tools/overview-viewer/src/__tests__/scripts.d.ts`

**MISSING (to create):**
- `scripts/lib/watch-ralph-state.mjs`
- `tools/overview-viewer/src/__tests__/ralphWatcher.test.ts` (RECOMMENDED — not appended to `ralphStage.test.ts`)

### Current watcher infrastructure
- Vite plugin uses `server.watcher.add(overviewDataPath)` (NOT chokidar directly). Plan 02 line 65 ("existing chokidar usage pattern in vite.config.ts") is **STALE**.
- No direct `chokidar` dependency; only transitive via `pnpm-lock.yaml`. Resolved version is chokidar@5.0.0 (ESM, glob inputs deprecated — watch directories, filter manually).
- Vite plugin `configureServer` hook is the auto-start integration point.

### Story scheduler / DAG state
- NO story-scheduler / DAG logic exists. Plan 02 incremental processing is per-slug, not a DAG.
- `sync-core.walkRalphState` is a full tree walk; Plan 02 must add `deriveOneSlug` + `mergeAndWrite`.

### Progress.json + lock file
- `progress.json` is NOT a thing here — `.ralph/jobs/*/job-state.json` is the canonical state file.
- Lock file: `config.lockFile` default `.ralph/overview-sync.lock`. Current Plan 01 one-shot has NO lock logic. Plan 02 introduces it.
- Plan 11 expects lock-file JSON content `{ pid, process, startedAt }` — Plan 02 currently only acquires the file handle without writing content. **STALE DESIGN; fix in Plan 02 from the start.**

### Overview viewer integration points
- Existing HMR event: `overview-data:update` (Vite plugin → WebSocket → `import.meta.hot.on` in App.tsx).
- Plan 02 mirrors with `overview-ralph-state:update`. Plan 03 subscribes on the React side.

### Stale assumptions in existing Plan 02
1. **Line 65** "existing chokidar usage pattern" — Vite uses internal watcher, not chokidar. Reword: "the existing `overviewDataPlugin` `server.watcher.add()` pattern."
2. **Line 78** watches `.ralph/brainstorms/*/selected-direction.md` — `sync-core.walkRalphState` does NOT read this file. Remove from watched paths or document why.
3. **Line 84-89** excludes list — missing `.crews/logs/**` and `.crews/spawn-launchers/**` which `default-config.mjs` already includes. Make watcher use `config.watcher.ignored` rather than hardcode.
4. **Lines 50-53** CLI/`start()` double cold-start — plan says CLI runs one-shot then calls `start`; watcher `start` also cold-starts. Pick one: `start()` owns cold-start.
5. **Line 100** lock-file: write JSON `{ pid, process, startedAt }` for Plan 11 compatibility (not 0-byte sentinel).
6. **Lines 151/D** "one-shot may succeed if lock acquired between watcher ticks" — watcher should hold lock for its lifetime, so one-shot must fail fast while watcher runs. Fix verification.
7. **Line 52** `deriveOneSlug` naive signature — must preserve duplicate-within-kind collapse and cross-kind precedence (`job > group > brainstorm`). If a winning job is deleted, a shadowed group/brainstorm must be promoted. Recommend extracting `readBundleForSlug` + `deriveAffectedTaskUpdate` helpers.
8. **Line 139** unlink behavior too broad — deleting only `job-state.json` should NOT always remove the task; if `prd.json` remains, derive `plan-ready`. Only deleting the slug directory OR all meaningful files removes the entry.
9. **Line 46/122** tests appended to `ralphStage.test.ts` — separate file `ralphWatcher.test.ts` is cleaner.
10. **Line 64** stale-RUNNING reference to `sync_job_statuses.sh` says 60 min — actual file uses 30-min mtime threshold. (Watcher's 60s lock TTL is unrelated; keep 60s.)
11. **Line 71** `tools/overview-viewer/vite.config.ts` is TypeScript and typechecked. Dynamic-import of `.mjs` may require `.d.mts` for type-checking; or use `// @ts-ignore` at the import (less clean).
12. **Line 28** parse-error handling — sync-core currently ignores malformed `group.json` while other JSON files log unmatched. Plan 02 watcher resilience requires consistency; either fix sync-core OR document accepted asymmetry.

### Downstream plans that reference Plan 02
- **Plan 03 (UI chip)** — subscribes to `overview-ralph-state:update` HMR event.
- **Plan 05 (agent exports)** — extends `mergeAndWrite` flow; needs `prevStage` snapshot (in-memory `currentState`).
- **Plan 06 (skills)** — reads lock file (presence + mtime freshness for "stale >2min" check).
- **Plan 08 (crews)** — extends watched paths (`.crews/crews/*/members/*/manifest.json`, `.crews/sessions-configs/*`); shares lock; calls `discoverCrewSessions` within debounce tick.
- **Plan 09 (mcp)** — reads `plans/overview-ralph-state.json`.
- **Plan 10 (ralph-handoff)** — independent.
- **Plan 11 (mcp ops tools)** — `sync.watch_status` reads lock-file JSON metadata (PID/process). **Strong contract dependency.**
- **Plan 12 (plugin packaging)** — needs config-driven paths, no hardcodes.
- **`plans/ralph-pipeline-INDEX.md`** — Source-of-truth modules table, DAG diagram.

### Reusable patterns
- `atomicWriteFile` + `renameWithRetry` in `sync-core.mjs` lines 141-178 — REUSE for lock-file write and sidecar updates.
- JSON parse-error pattern in sync-core lines 192-210 — REUSE for `deriveOneSlug` malformed-file handling.
- `loadConfig` + `default-config.mjs` — single config source.
- Built-in `setTimeout` + `Set<string>` for debounce; no need for `lodash.debounce`.

### Test + build infrastructure
- pnpm 10.11.0. `pnpm sync-ralph-state` (one-shot), `pnpm overview` (Vite dev), `pnpm --filter @codexu/overview-viewer test`, `... typecheck`.
- Vitest split projects: ssr (node) + interactions (jsdom). Watcher tests go into ssr (node).
- Missing `pnpm sync-ralph-state:watch` — Plan 02 adds.
- Windows: forward-slash normalization in paths; chokidar handles platform fs.watch quirks.

---

## Architect Analysis (integration + risk)

### Integration points
| Boundary | Plan 02 → Plan X | Contract | Risk |
|---|---|---|---|
| HMR event | 02 → 03 | `onWrite()` fires `overview-ralph-state:update` over `server.ws` | Low |
| Lock-file metadata | 02 → 11 | Lock carries JSON `{ pid, process, startedAt }` | **Medium — needs Plan 02 implementation now** |
| `currentState` for prevStage | 02 → 05 | Watcher keeps in-memory `currentState`; Plan 05 reads pre-merge | Low |
| Config-driven paths | 02 → 05, 08, 11 | All read `config.*` via `loadConfig` | Low |
| Crew-session merge order | 02 ↔ 08 | Cross-walk after Ralph derivation, before sidecar write | Medium |
| Watched-paths extensibility | 02 → 08, 12 | Use `config.watcher.ignored` (merged with defaults) | Low |
| Lock contention | 02 ↔ 08 | Both acquire `config.lockFile`; mtime stale-recovery 60s | Medium (subcommand latency) |
| Worktree isolation | 02 only | Watch root = main repo `.ralph/`, exclude `.worktrees/**` and `.ralph/jobs/*/worktree/**` | Low |

### Dependency graph (excerpt)
```
01-foundation → 02-watcher → (03 UI, 05 exports, 08 crews, 11 mcp-ops)
                                                  ↘ 09 mcp → 11
```
Plan 02 is unblocking for live UX but not strictly required for any plan's feature logic.

### Technical constraints
- **Windows fs.watch quirks** — chokidar's `awaitWriteFinish` is required to handle Ralph's tmp+rename atomic writes.
- **Debounce** — default 2000ms, clamp `[500, 30000]`. Plan 08 subcommand latency = up to debounce window.
- **Worktree fan-out** — exclude `.ralph/jobs/*/worktree/**` and `.worktrees/**`; walk-root is exactly `<repoRoot>/.ralph/`.
- **Codex/Copilot child processes** spawned by ralph.sh write `job-state.json`; chokidar picks up; no special handling.

### Worktree directive — VERIFIED ✓
Existing plan line 3 explicitly states branch `ralph-pipeline-02-watcher`, worktree at `.ralph/jobs/ralph-pipeline-02-watcher/worktree/`, "Do NOT edit `main` directly." Commit 8a718c35 confirmed.

### Risk areas
1. Race on `job-state.json` mid-write — mitigated by `awaitWriteFinish`.
2. Multiple ralph orchestrators (crews) — per-worktree `.ralph/` is isolated; main-repo watcher sees post-merge state.
3. Stale lock if watcher crashes — 60s mtime recovery; `finally` releases.
4. Sync-watch lockFile collisions — one-shot must fail fast with watcher running (fix existing plan).
5. Cross-kind precedence on deletion — naive `deriveOneSlug` can lose entries that should be promoted.

### Architectural recommendations
1. Make `watch-ralph-state.mjs.start()` async; return after cold-start completes.
2. Write lock-file JSON metadata immediately (Plan 11 compat).
3. Extract `readBundleForSlug` + `deriveAffectedTaskUpdate` helpers in sync-core, with bundle-cache for cross-kind promotion.
4. Maintain `currentState: OverviewRalphState` in watcher process memory for Plan 05.
5. Track `consecutiveFailures: Map<slug, number>` — warning at 10.
6. Vite-plugin teardown: small grace period before lock release.
7. Drive watched-paths & ignores from `config.watcher.*` (default config already includes `.crews/logs/**` and `.crews/spawn-launchers/**`).
8. Config-driven debounce default; CLI flag overrides config.
9. `mergeAndWrite` accepts optional emitter hooks for Plan 05/08 extensibility.

---

## Codex Research

Highlights:
- `chokidar@5.0.0` is the resolved transitive version; add explicit dep. v4+ glob inputs deprecated — watch directories, filter manually.
- `tools/overview-viewer/vite.config.ts` is TypeScript; dynamic import of `.mjs` may need `.d.mts`.
- `start()` cannot both return immediately AND complete cold-start — make it `async start(...) → Promise<WatchHandle>`.
- Pick a single cold-start owner — `start()` owns it; CLI just calls `start`.
- Lock semantics: watcher must hold lock for its entire lifetime; one-shot must fail fast while watcher runs.
- Write lock-file JSON content from day one for Plan 11.
- Incremental deletion behavior: only remove the task entry when slug directory OR all meaningful files are gone; if just `job-state.json` is removed, re-derive from remaining files (e.g., prd.json → plan-ready).
- Tests in `tools/overview-viewer/src/__tests__/ralphWatcher.test.ts` (new file); or ensure `scripts/lib/sync-core.test.mjs` is actually run by a root test script.
- Refactor sync-core: `readBundleForSlug`, `buildStateFromBundles`, `deriveAffectedTaskUpdate`.
- Add `.d.mts` declarations for new exports.
- Cascade should extend to `plans/ralph-pipeline-INDEX.md` plus all "Hand-off" plans (03–12).

---

## Copilot Research

Highlights:
- `scripts/lib/sync-core.mjs` exports listed match codex's audit.
- `chokidar` v4+ — do not rely on glob inputs.
- Incremental re-derivation tricky: single slug change can reveal another slug for the same task. Plan must require maintaining/recomputing the **affected task candidate set**, not blindly replacing by slug.
- Parse-error handling uneven in sync-core: `group.json` currently ignored where other files log unmatched. Fix consistency in watcher resilience scope OR document.
- Add `.d.mts` declarations for `watch-ralph-state.mjs` and new sync-core exports.
- Drop `selected-direction.md` from watched paths.
- Watcher tests → separate `ralphWatcher.test.ts`.

---

## Consolidated File List

### Files to MODIFY in worktree
- `scripts/sync-ralph-state.mjs` — add `--watch`, `--debounce-ms <N>`, signal handlers
- `scripts/lib/sync-core.mjs` — add `deriveOneSlug`, `mergeAndWrite`, optionally `readBundleForSlug`/`deriveAffectedTaskUpdate` helpers
- `scripts/lib/sync-core.d.mts` — declare new exports
- `tools/overview-viewer/vite.config.ts` — auto-start watcher in `configureServer`
- `package.json` (root) — add `sync-ralph-state:watch` script + chokidar direct dep

### Files to CREATE in worktree
- `scripts/lib/watch-ralph-state.mjs`
- `scripts/lib/watch-ralph-state.d.mts`
- `tools/overview-viewer/src/__tests__/ralphWatcher.test.ts`

### Files to READ for reference (not modified)
- `scripts/lib/derive-ralph-stage.mjs`
- `scripts/lib/default-config.mjs`
- `scripts/lib/resolve-config.mjs`
- `tools/overview-viewer/src/types.ts`
- `tools/overview-viewer/vite.config.ts` (existing `overviewDataPlugin` pattern)
- `tools/overview-viewer/CLAUDE.md` (HMR mechanism)
- `tools/overview-viewer/vitest.config.ts` (test project split)

### Downstream cascade targets (audit after Phase 6)
- `plans/ralph-pipeline-INDEX.md`
- `plans/ralph-pipeline-03-ui-chip.md`
- `plans/ralph-pipeline-04-pipeline-overview.md`
- `plans/ralph-pipeline-05-agent-exports.md`
- `plans/ralph-pipeline-06-skills.md`
- `plans/ralph-pipeline-07-context.md`
- `plans/ralph-pipeline-08-crews.md`
- `plans/ralph-pipeline-09-mcp.md`
- `plans/ralph-pipeline-10-ralph-handoff.md`
- `plans/ralph-pipeline-11-mcp-operational-tools.md`
- `plans/ralph-pipeline-12-package-as-plugin.md`
