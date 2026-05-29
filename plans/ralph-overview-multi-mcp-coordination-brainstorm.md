# ralph-overview multi-MCP coordination — brainstorm

**Status:** brainstorm-only — no code changes proposed in this commit.
**Crew member:** `brainstorm-overview-multi-mcp` in crew `ralph-pipeline`.
**Today:** 2026-05-26 — observed cascading watcher crash-loop in codexu repo with 3 concurrent Claude Code sessions.
**Plugin under review:** `ralph-overview` v2.0.3 at `D:/ai-developer-toolkit/plugins/ralph-overview/`.
**Sibling artifact precedent:** `plans/plugin-scope-agents-redesign-brainstorm.md` shipped at commit `2deb6c2b` as Phase 5a-equivalent.

---

## 1. Failure-mode analysis — the 3-MCP cascade

### 1.1 The actors

Three Claude Code sessions S_A, S_B, S_C concurrently open the codexu repo. Each session's MCP framework loads `ralph-overview` and instantiates a `WatcherSupervisor` (`tools/overview-mcp/src/watcher-supervisor.ts`). Call them M_A, M_B, M_C; each may spawn a child sync-ralph-state.mjs watcher W_x.

### 1.2 Exact code path that produces the cascade

Every supervisor's `start()` runs **unconditionally** (`watcher-supervisor.ts:84`):

```ts
async start(): Promise<WatcherSupervisorStartResult> {
  await cleanupOrphanParentHeartbeats(this.isPidReachable);
  await this.preflightReclaimStaleWatcher();         // ← line 84
  const externalOwner = await this.readFreshExternalOwner();
  if (externalOwner) { /* defer, become passive */ return ... }
  await fs.rm(this.ownerPath, { force: true });
  await this.startParentHeartbeat();
  const managed = this.spawnWatcher();
  return { spawned: true, pid: managed.pid };
}
```

`preflightReclaimStaleWatcher` (`watcher-supervisor.ts:105-142`) reads the owner marker, verifies the pid is alive, verifies the cmdline matches `sync-ralph-state.mjs --repo <our repoRoot>`, and **sends SIGTERM** — *with no check for whether the watcher belongs to a live peer MCP*.

This makes one fatal assumption (`watcher-supervisor.ts:83-85` doc comment):
> *"This is safe because no MCP server in OUR session has spawned a watcher yet (we're in start()).*"

The assumption is true for *our* session but says nothing about *peer* sessions. The reclaim was designed against orphan watchers from a dead prior session — the existence of a live peer was not modeled.

### 1.3 The cascade, step by step

| t (s) | Event |
|---|---|
| 0.0 | M_A.start(): no marker → no reclaim → spawn W_A. W_A.claimOwnerHeartbeat writes marker with `pid=W_A` (`watch-ralph-state.mjs:550-552`). |
| 1.0 | M_B.start(): marker fresh + W_A.pid alive + cmdline matches → **SIGTERM W_A** (`watcher-supervisor.ts:125`). Waits up to 3 s for death (PREFLIGHT_RECLAIM_WAIT_MS, line 21). `fs.rm(ownerPath)` (line 134). Spawn W_B → marker now `pid=W_B`. |
| 1.2 | M_A's `ProcessManager` resolves `W_A.exitPromise` → `handleWatcherExit('SIGTERM')` (line 247). retriesAttempted=0; schedule restart in `backoffMs[0]=2000ms`. |
| 3.2 | M_A respawns W_A'. W_A'.claimOwnerHeartbeat reads marker, sees `pid=W_B` fresh + alive → **throws EOWNER** (`watch-ralph-state.mjs:536-540`). W_A' exits with non-zero. |
| 3.3 | M_A.handleWatcherExit('code=1') again; backoffMs[1]=4 s. |
| 7.3 | W_A'' spawned → EOWNER → exit. backoffMs[2]=8 s. |
| 15.3 | W_A''' → EOWNER → exit. backoffMs[3]=16 s. |
| 31.3 | W_A'''' → EOWNER → exit. backoffMs[4]=32 s. |
| 63.3 | Final attempt → EOWNER → `writeFailureFlag` (`watcher-supervisor.ts:252`). M_A gives up. |
| ... | M_C joins at any point and re-runs the same kill-cycle on whichever watcher currently holds the marker, restarting the cascade for whoever just lost it. |

### 1.4 What `readFreshExternalOwner` *would* have done correctly

The deferral path (`watcher-supervisor.ts:168-194`) **already implements the correct passive-consumer behavior** when it reads a marker with `pid` fresh + alive: it returns `{spawned: false, reason: 'external-watcher-running', pid}` and starts `externalOwnerPollTimer` (line 219). The fatal flaw is that `preflightReclaimStaleWatcher` *kills the pid before `readFreshExternalOwner` can read it*. By the time the deferral check runs, the marker has been removed (line 134) and the peer's watcher has been SIGTERM'd.

### 1.5 Root cause, in one sentence

The supervisor cannot distinguish *"orphan watcher from a dead prior MCP session"* from *"live watcher of a peer MCP session"* — both look identical from the marker file (`{pid, startedAt, hostname}` — no MCP-parent identity field) — and it resolves the ambiguity by always killing.

---

## 2. Cross-platform FS primitive evaluation

The coordination needs three things: atomic-create, atomic-replace, and liveness signaling. The plugin already runs on Win/Linux/macOS (per cmdline lookup in `find-process-cmdline.ts:18-34`), so any primitive must portably cover all three.

| Primitive | Win32 (Node) | Linux | macOS | Portable? | Verdict |
|---|---|---|---|---|---|
| `fs.openSync(path, 'wx')` — atomic O_EXCL\|O_CREAT | ✓ | ✓ | ✓ | **yes** | First-writer-wins; second gets `EEXIST`. The cleanest portable atomic-create. |
| `fs.rename(tmp, target)` atomic-replace | ✓ (NTFS MoveFileEx) | ✓ | ✓ | **yes** | Already used at `watch-ralph-state.mjs:552`. **NOTE:** rename does NOT fail on existing target — it overwrites. Cannot serve as atomic-create. |
| `fs.link(src, target)` — POSIX "second-link trick" | partial (Node API limited cross-volume) | ✓ | ✓ | weak | Skip — not reliable on Windows. |
| `flock(2)` advisory lock | ✗ | ✓ | ✓ | no | Skip. |
| `LockFileEx` mandatory lock | ✓ | ✗ | ✗ | no | Windows-only; mandatory locks add deadlock risk. Skip. |
| Windows named mutex | ✓ | ✗ | ✗ | no | Skip. |
| `fs.utimes` mtime heartbeat | ✓ | ✓ | ✓ | **yes** | Already used at `watch-ralph-state.mjs:560-570`. Liveness signal. |
| `process.kill(pid, 0)` liveness | ✓ (Node maps to OpenProcess) | ✓ | ✓ | **yes** | Already used everywhere. |

**Conclusion:** the portable trio is **`openSync('wx')` + `rename` + `utimes`-mtime heartbeat + `kill(pid,0)`** — no native module or OS-specific lock required. The current code uses three of the four; the only missing one (`openSync('wx')`) is what would make atomic-create race-free.

### 2.1 Important Windows nuance — antivirus + tmp-file rename

Defender real-time scan can momentarily lock a freshly-written file. `rename(tmp, ownerPath)` on Windows occasionally throws `EPERM`/`EACCES` during this window. The current code does not retry. This is a separate latent bug (not part of the cascade) but worth fixing alongside any redesign — a 50 ms retry-once policy covers it. Track as RO-12 (new).

---

## 3. Option-by-option evaluation

### Option A — **Cooperative lease** (lead's sketch, refined)

**Mechanic.** Augment the owner marker with `parentMcpPid` and `parentHeartbeatPath`. Supervisors distinguish three cases on startup:

1. **No marker, or marker is stale (`mtime > OWNER_FRESH_MS`):** atomic-create the marker via `openSync('wx')`. If EEXIST → fell into case 2 between read and create; re-read and re-evaluate.
2. **Marker exists, watcher pid alive, `parentMcpPid` alive (or `parentHeartbeatPath` fresh):** *peer-owned* → become passive consumer. Poll externally; never kill.
3. **Marker exists, watcher pid alive, but `parentMcpPid` dead AND parent-heartbeat stale:** *orphan from dead prior session* → kill (current `preflightReclaim` behavior, but gated by parent-dead).

**Backward compat with v2.0.3 markers** (no `parentMcpPid` field): treat as "unknown owner". Honor the existing mtime heartbeat — if marker mtime is fresh AND watcher pid alive AND cmdline matches, **defer** (do not kill — flips the current default). Within 10 s of first v2.0.4 supervisor starting, the legacy marker is replaced by a v2.0.4 marker via the next heartbeat refresh, and the ambiguity resolves itself.

**Race conditions.**

- **Cold-start of 3 MCPs within 100 ms:** all three see no marker. All three call `openSync(ownerPath, 'wx')`. Exactly one succeeds; the other two get EEXIST → re-read → become passive. Race-free as long as we *do not* use `rename` for the first-writer step.
- **Two passive MCPs racing to take over a stale marker:** same primitive; only one wins the `openSync('wx')` after `fs.rm` of the stale marker. Loser retries on the next poll tick and becomes passive again.
- **Owner watcher dies mid-tick, marker still fresh by mtime:** mtime ages out within `OWNER_FRESH_MS=10s`. Passive MCP's `externalOwnerPollTimer` (2 s default) detects stale → takeover. Recovery time: 10–12 s worst case.

**Recovery time.** Owner dies → marker freshness check fails after ≤ 10 s → next passive poll (≤ 2 s) → takeover. **Worst case ≈ 12 s; typical ≈ 6 s.** Meets the ≤ 30 s target.

**Implementation cost.**

| File | Change |
|---|---|
| `scripts/lib/watch-ralph-state.mjs` | (1) `ownerMetadata` adds `parentMcpPid` (env `RALPH_OVERVIEW_MCP_PARENT_PID`) + `parentHeartbeatPath` (env `RALPH_OVERVIEW_MCP_HEARTBEAT`). (2) `claimOwnerHeartbeat` switches the tmp+rename to `openSync('wx')` for atomic create; only falls back to write+rename when explicitly *replacing* a known-stale marker. (3) When EOWNER would be thrown, include `parentMcpPid` and `parentHeartbeatPath` in the error payload so the supervisor can decide quickly. |
| `tools/overview-mcp/src/watcher-supervisor.ts` | (1) Replace `preflightReclaimStaleWatcher` with `evaluateMarkerForReclaim` that returns one of `{kind:'absent'} \| {kind:'peer-owned', pid, parentMcpPid} \| {kind:'orphan', pid}`. Only the orphan case triggers SIGTERM. (2) Pipe `parentMcpPid` and `parentHeartbeatPath` into the spawned watcher's env (already done) AND into the call so `claimOwnerHeartbeat` writes them into the marker. (3) `handleWatcherExit`: if the watcher exited with EOWNER, **stop retrying** — re-read marker, become passive via `readFreshExternalOwner` path. Reset `retriesAttempted` to 0 so we can retry later if the peer dies. (4) `externalOwnerPollTimer`: on takeover attempt, use `openSync('wx')` after `fs.rm`; on EEXIST fall back to passive. |
| `tools/overview-mcp/src/watcher-supervisor.test.ts` | Add cases: cold-start 3 supervisors → exactly one spawns; orphan reclaim still works (synthesize dead `parentMcpPid`); peer survives reclaim attempts. |
| `CHANGELOG.md` | v2.0.4 entry. |
| `tools/overview-mcp/src/__tests__/process-manager.test.ts` | No change — process-manager API unchanged. |

Estimated diff: **~250–350 lines across ~3 files**. No new files.

**Backward compat.** v2.0.3 markers (no parentMcpPid) are read as "legacy" → mtime+pid liveness only; passive deferral is the default. No operator action required. After ~10 s, all live MCPs have refreshed the marker with v2.0.4 fields.

**Pros.**
- Smallest delta against v2.0.3.
- Re-uses every primitive the plugin already understands.
- The `overview-reset` skill becomes redundant for the common case (peer-collision); only retained for truly-broken states (manual `pnpm sync-ralph-state:watch` orphans, etc.).
- Cmdline match (`isOurWatcherCmdline`) becomes a defense-in-depth check on the orphan path only — not the primary decision criterion.

**Cons.**
- Marker file format change (additive, JSON-tolerant — small surface).
- A passive MCP doesn't write sidecars, so dev-server-started-on-passive-MCP has to also work — but v2.0.3 *already* implements file-only HMR fallback for the dev server (`CHANGELOG.md` v2.0.3). Composes cleanly.

---

### Option B — **Standalone watcher daemon outside MCP**

**Mechanic.** Convert sync-ralph-state.mjs from MCP-child to system daemon. First-arrival MCP `spawn(..., {detached: true, stdio: 'ignore'}).unref()`. Daemon polls all `watcher-parent-*.owner` files; self-exits when none are fresh for ≥ 30 s.

**Race conditions.** Same cold-start race as Option A; solved with the same `openSync('wx')` primitive. Daemon-self-exit-while-MCP-starting race: handled by daemon checking parent-heartbeat existence *atomically with* re-acquiring the marker.

**Recovery time.** Daemon dies → next MCP heartbeat tick (2 s) notices marker stale → respawn. ≈ 2–4 s. Slightly faster than A.

**Implementation cost.**

| File | Change |
|---|---|
| `scripts/sync-ralph-state.mjs` | Add `--daemon` mode that disowns from parent (writes pidfile + survives parent death) and polls parent-heartbeat directory for last-MCP-alive signal. |
| `tools/overview-mcp/src/watcher-supervisor.ts` | Rewrite: no more `ManagedProcess` lifecycle for the watcher; instead spawn detached + forget. `handleWatcherExit` path eliminated. New `ensureDaemonAlive` poll. |
| `tools/overview-mcp/src/process-manager.ts` | Possibly: extend to support a `detached` spawn mode that doesn't follow exit. |
| `bin/ralph-overview.mjs` | Add `daemon` subcommand. |
| `CHANGELOG.md` | v3.0.0 (semver-breaking due to lifecycle inversion). |

Estimated diff: **~600–900 lines across ~5 files**, plus rewriting all watcher-supervisor tests.

**Pros.**
- Cleanest mental model: 1 watcher, all MCPs are pure consumers.
- Daemon survives MCP restarts cleanly (no respawn churn).
- Faster recovery.

**Cons.**
- **Windows detached spawn is subtly different from Unix.** `detached: true, stdio: 'ignore'` works, but the daemon process gets reparented to PID 1 on Unix vs. inherits Win32 console handle weirdness on Windows. The current `startParentLivenessMonitor` (`sync-ralph-state.mjs:207-224`) is already prepared for both — but daemon-self-exit logic adds a new state machine to test on three OSes.
- **Detached zombie risk.** If daemon-self-exit logic has a bug, the daemon can outlive *every* MCP session. Users would notice `node` processes in their task manager and ask why.
- **Larger surface to test.** `~30%` of overall watcher LOC touched.
- Semver-breaking. New install guide. Operators with `pnpm sync-ralph-state:watch` workflows have to migrate.

---

### Option C — **In-process watcher + IPC broadcast**

**Mechanic.** Active MCP runs watcher *in-process* (no child fork). Peers connect over named pipe (Windows) / Unix domain socket and subscribe to write events.

**Race conditions.** Same `openSync('wx')` first-writer-wins for the IPC server endpoint.

**Recovery time.** Owner MCP dies → socket disappears immediately → peers detect → race to take over (atomic-create). **Fastest of any option (≈ 1 s).**

**Implementation cost.**

| File | Change |
|---|---|
| `tools/overview-mcp/src/server.ts` | Spawn watcher in-process (in current MCP node — no fork). |
| `tools/overview-mcp/src/watcher-supervisor.ts` | Becomes `ipc-client.ts` for the passive case; `ipc-server.ts` for active. |
| **New** `tools/overview-mcp/src/ipc-transport.ts` | Cross-platform IPC: named pipe on Win32 (`\\.\pipe\ralph-overview-<hash>`), Unix socket on Unix (`/tmp/ralph-overview-<hash>.sock` or `<repo>/.ralph/overview-ipc.sock`). |
| `tools/overview-viewer/` | Dev server has to consume from IPC too, not just file-watching the sidecar. |
| `CHANGELOG.md` | v3.0.0. |

Estimated diff: **~1200+ lines, plus a new IPC test matrix**. Roughly 2–3 weeks of focused work.

**Pros.**
- Push semantics; no polling.
- Fast failover.
- Watcher is in the *same* process as the MCP that owns it → simpler debugging.

**Cons.**
- Big-bang rewrite. Multiplies the test matrix (Win named-pipe vs Unix socket vs viewer-as-consumer).
- Loses the failure isolation of process-per-watcher (an in-process watcher exception now crashes the MCP).
- Out of proportion to the bug we're fixing.

---

### Option D — **Per-session on-demand walk** (no long-running watcher)

**Mechanic.** Delete the watcher entirely. Each MCP tool call walks `.ralph/` fresh.

**Pros.** Zero coordination. Trivially race-free.

**Cons.** **Disqualifying.** Per `CLAUDE.md` F-015 (`watch-ralph-state.mjs:50-54`):

> *"Under heavy consumer repos (1.9M+ files across job worktree variants) the `ready` event never fires. The depth caps are correctness contracts, not optimization."*

The watcher exists to amortize the directory walk away from per-tool-call latency. Removing it would make every `overview_parallel_ready_tasks` call walk that subtree from cold, which is unworkable. **Not viable.**

---

### Option E — **OS-native locks**

**E1 (`flock` + `LockFileEx`):** requires native bindings or a `node-gyp` add-on. Disqualifying for a Node-pure plugin.

**E2 (`openSync(ownerPath, 'wx')` held open for watcher lifetime, no `unlink` until clean shutdown):** this is **a sub-variant of Option A** — same atomic-create primitive, but with the file descriptor held open and the marker carrying just `pid` (cleanup-by-pid-liveness rather than mtime heartbeat).

**Pros over A.** Marker can never be "stale but pid alive" — file existence ≡ owner alive (almost).

**Cons over A.** Holding the fd open through a SIGKILL still leaves the marker on disk → still need pid-liveness check on takeover. So we save no logic, but we lose the mtime-based 1 Hz freshness probe that's useful for monitoring/debugging (e.g., `overview_watcher_status` MCP tool, currently missing per RO-9). **Marginal; not worth carrying as a separate option.** Fold into A.

---

## 4. Recommendation — **Option A (Cooperative lease)**

### 4.1 Why

| Criterion | A | B | C | D |
|---|---|---|---|---|
| Race-free under 3-MCP cold start | ✓ | ✓ | ✓ | ✓ |
| Recovery ≤ 30 s | ✓ (≈ 12 s) | ✓ (≈ 4 s) | ✓ (≈ 1 s) | n/a |
| Cross-platform low risk | ✓ | ⚠ Windows detached subtle | ⚠ Win named-pipe surface | ✓ |
| Backward compat with v2.0.3 markers | ✓ additive | ⚠ semver-break | ⚠ semver-break | n/a |
| Code surface | ~3 files, ~300 LOC | ~5 files, ~800 LOC | ~6 files, ~1200 LOC | huge negative |
| Composes with v2.0.3 dev-server fallback | ✓ | rewrite needed | rewrite needed | n/a |
| Test surface increase | small | medium-large | large | n/a |

Option A is the **only** option that fixes the cascade without semver-breaking the plugin and without inventing new transport surface. B is appealing in the long term but is a 3× larger change than the bug warrants; carry it as a v3 roadmap entry. C is overkill. D is disqualifying. E folds into A.

### 4.2 Concrete delta against v2.0.3

(Per-file change descriptions; no code in this doc.)

1. **`scripts/lib/watch-ralph-state.mjs`** —
   - `claimOwnerHeartbeat()` (lines 518-553): introduce `tryAtomicClaim` helper that uses `fs.openSync(ownerPath, 'wx')`. On EEXIST, re-read the marker and decide: peer (defer with EOWNER), orphan (clear + retry), or self-race (one of our siblings wrote first; defer).
   - Owner marker JSON gains `{parentMcpPid, parentHeartbeatPath}` from env. Both are optional for back-compat readers.
   - EOWNER `Error` object gains `peerParentMcpPid` and `peerParentHeartbeatPath` properties so the supervisor can decide whether to retry later.

2. **`tools/overview-mcp/src/watcher-supervisor.ts`** —
   - Replace `preflightReclaimStaleWatcher` (lines 105-142) with `evaluateMarker(): {kind:'absent'|'peer-owned'|'orphan'}`. Orphan path only when watcher pid alive AND parentMcpPid dead AND parent-heartbeat stale.
   - `handleWatcherExit` (lines 247-268): inspect last stderr/exit signal for EOWNER signature. On EOWNER, switch to passive mode (start `externalOwnerPollTimer`) instead of exponential backoff. On non-EOWNER crash, keep current backoff behavior.
   - `externalOwnerPollTimer` takeover step (lines 219-240): replace the unconditional `fs.rm + spawnWatcher` with `tryAtomicClaim` so that two passive MCPs racing to take over a freshly-vacated marker still produce exactly one new owner.
   - New `WatcherSupervisorStartResult` variant `{spawned: false, reason: 'peer-owned', pid, peerParentMcpPid}` to expose the multi-MCP state to MCP-tool callers (so they can surface "passive" to the agent if asked).

3. **`tools/overview-mcp/src/watcher-supervisor.test.ts`** — add three cases:
   - Cold-start 3 supervisors within 50 ms; exactly one returns `{spawned:true}`, the others `{spawned:false, reason:'peer-owned'}`.
   - Orphan reclaim: synthesize marker with dead `parentMcpPid` and live watcher pid (mock); supervisor reclaims by SIGTERM and spawns.
   - Peer survives reclaim attempts: synthesize live peer (live pid + live parent-heartbeat); new supervisor must NOT SIGTERM.

4. **`CHANGELOG.md`** — v2.0.4 entry under `Changed/Fixed`. Document the new marker fields as additive; note that the v2.0.2 preflight-reclaim behavior is **narrowed** (only kills proven orphans).

5. **`docs/installation.md` and/or `docs/extending.md`** — add a "Multi-MCP coordination" subsection explaining N concurrent sessions per repo is supported; exactly one is active, the rest are passive consumers reading sidecars.

6. **`.claude/skills/overview-reset/SKILL.md` in codexu** (and any consumer with the same skill) — soften "Run this every time you see EOWNER" to "Run this only when the marker survives ≥ 30 s without an active MCP." After v2.0.4, the common case (peer-collision) does not need the skill at all.

### 4.3 What the bookkeeper's CLAUDE.md changes to

The "Bash sessions default to codex submodule" and "watcher generates ralph-state.{js,json}" guidance is unchanged. The only operator-visible change is that the `overview-reset` escape hatch becomes rare-use rather than routine. Add one sentence to `D:/harness-efforts/codexu/CLAUDE.md` "Common confusion points" noting "N concurrent Claude Code sessions per repo is supported as of ralph-overview v2.0.4; only one writes sidecars at a time, others read."

---

## 5. Lens passes — devil's-advocate, product-reality, simplification

### 5.1 Devil's advocate

- **Q:** "If preflight reclaim is correct for orphans, won't a malicious / accidentally-misconfigured peer-with-zombie-parent let an orphan watcher live forever?"
  **A:** Yes — and that's already true in v2.0.3 when the cmdline check fails (e.g., manual `pnpm sync-ralph-state:watch` invocation). The `overview-reset` skill remains as the manual escape hatch for this case. The redesign does not regress this; it narrows the kill window from "kills peers too" to "doesn't kill peers".

- **Q:** "Does adding `parentMcpPid` to the marker leak info into git-checked-in state?"
  **A:** No. `.ralph-overview/generated/.lock/watcher.owner` is local-only — created at runtime, gitignored alongside the rest of `.ralph/`. Existing fields already include `pid` and `hostname`; adding `parentMcpPid` is the same privacy class.

- **Q:** "What about cross-machine NFS mounts of a shared repo? Pids are meaningless across hosts."
  **A:** The marker carries `hostname`. Add a guard: if marker `hostname !== os.hostname()`, treat it as `{kind:'foreign-host'}` and defer (do not kill, do not try to take over). v2.0.3 already records hostname but does not use it — this is a low-cost defensive widening.

- **Q:** "The new logic still SIGTERMs orphans. What if the operator does NOT want any process killing, ever?"
  **A:** Add an env flag `RALPH_OVERVIEW_NO_KILL=1` that disables the orphan-reclaim branch entirely — orphans are then surfaced as a warning in the MCP tool envelope and the operator runs `overview-reset` manually. Defaults to *off* (current kill-on-orphan behavior preserved). Listed under §6 open questions because it's not strictly required to fix the cascade.

### 5.2 Product reality

- The audience for this fix is the operator running 2–4 concurrent sessions per repo (which is the documented bookkeeper-spawning-Ralph-members workflow). It is *not* a server-side multi-tenant scenario. Optimizing for "the common case is 1, the supported max is ~5" — Option A's polling-based takeover is well within the latency budget that any operator would tolerate.
- The MCP server is invoked from `launch.cjs` per-session — there's no shared-MCP-host mode. So "MCP coordination" really means "OS-level process coordination" which is exactly what Option A targets.

### 5.3 Simplification

- The redesign **removes** one branch (`preflightReclaimStaleWatcher` was 38 lines; replacement is similar size but with clearer semantics). Net code-mass change is small.
- The redesign **deletes the need** for the `overview-reset` skill in the common case — a documentation/operator-UX simplification more than a code one.
- The cmdline-match check (`isOurWatcherCmdline` lines 335-342) becomes a *defense-in-depth* guard on the orphan-kill path only, rather than the primary "is this our watcher" test. Less load-bearing.

---

## 6. Open questions for the operator

1. **`RALPH_OVERVIEW_NO_KILL=1` env-flag escape hatch:** include in the v2.0.4 cut, or hold for a later minor?
   *Recommendation:* hold. Not needed to fix the cascade; adds a flag-surface to test.

2. **`overview_watcher_status` MCP tool (RO-9):** ship alongside v2.0.4 so the agent can introspect "am I active or passive"?
   *Recommendation:* yes — small additional tool, makes the passive-consumer state visible to agents (otherwise they have no way to tell). Surface `{ active: boolean, ownerPid: number, ownerParentMcpPid?: number, ownerSince: string, snapshotStaleSince?: string }`.

3. **Dev-server-from-passive-MCP behavior:** the v2.0.3 file-only HMR fallback exists for the same active-watcher-already-running case. Confirm that the file-only HMR mode is the desired UX for a passive MCP's dev server too (rather than refusing to start). Reading `CHANGELOG.md` v2.0.3, the fallback is automatic — should compose cleanly, but worth verifying in an integration test.

4. **`hostname` cross-machine guard:** ship as part of v2.0.4 (safe addition) or document-only ("multi-MCP is single-host only")?
   *Recommendation:* ship — 5 lines of code, prevents a sharp edge.

5. **Recommended bump:** v2.0.4 (patch) or v2.1.0 (minor)?
   *Recommendation:* v2.1.0 — the additive marker fields and the new MCP tool (`overview_watcher_status`) are user-visible enough to warrant the minor bump. v2.0.4 patch if we hold the new tool for later.

6. **Should `WatcherSupervisor.preflightReclaimStaleWatcher` test be ported (vs. rewritten)?** It currently asserts the kill-on-cmdline-match behavior; that behavior is intentionally narrowed in this design. The test should be rewritten to assert the *new* "kill only orphans, not peers" contract.

---

## 7. Out of scope (do not bundle into v2.0.4)

- **RO-3 (`crewSessions` cross-walk holes), RO-4 (outcome lag), RO-5 (lead session bleed-through), RO-6 (stage key semantics), RO-7 (`watcherFailure` field is historical), RO-8 (snapshotStaleSince auto-recovery), RO-10 (overview.init / overview.upsert_task / overview.mark_shipped agent-callable bookkeeper tools).** These are independent and should remain in their own respective brainstorm/plan threads.
- **CR-4, CR-5, CR-6, CR-7** (crews-plugin gaps) — unrelated to ralph-overview.

---

## 8. Summary

The v2.0.3 cascading-crash bug is caused by `WatcherSupervisor.preflightReclaimStaleWatcher` killing any watcher matching `sync-ralph-state.mjs --repo <repoRoot>` without checking whether the watcher's parent MCP is a *live peer* vs. *dead prior session*. The fix is to:

1. Record `parentMcpPid` + `parentHeartbeatPath` in the owner marker.
2. Narrow the SIGTERM path to fire only when the parent MCP is provably dead.
3. Use `openSync('wx')` for atomic claim instead of `rename`-clobber.
4. On EOWNER from a spawned watcher, become passive (don't backoff-respawn).
5. Add `hostname` cross-machine guard.

This is **Option A, the cooperative lease**, in roughly **300 LOC across 3 files** with additive marker-format changes. It composes cleanly with the v2.0.3 dev-server file-only HMR fallback. Zero operator action required for migration. The `overview-reset` skill becomes rare-use rather than routine.

Suggested release: **ralph-overview v2.1.0** (paired with new `overview_watcher_status` MCP tool to surface passive-vs-active state to agents).
