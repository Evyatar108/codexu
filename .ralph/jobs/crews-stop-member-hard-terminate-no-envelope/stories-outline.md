# Stories — crews stop-member hard-terminate

Three serial stories on a single impl job. Branch:
`ralph/crews-stop-member-hard-terminate-no-envelope`. Repo:
`Evyatar108/ai-developer-toolkit` (plugin `plugins/crews`).

---

## US-01 — Hard-terminate kill helper

**As** the crews plugin
**I want** a `hardTerminateMemberByLaunchPid(launcherPid, options)` helper
**so that** `stop-member` can kill a member's per-tab child process tree
without touching the shared `WindowsTerminal.exe` server.

### Files
- `hooks/actors.js` (new helper + `applyHardStopMember`; modify
  `stopMemberAsLead` / `stopMemberByOperator` to accept `{ soft }`).
- `hooks/config.js` (re-export `hardTerminateMemberByLaunchPid`).
- `hooks/protocol/manifest.js` (additive fields: `terminationKind`,
  `terminatedAt`, `terminatedPids`).
- `tests/stop-member-hard-terminate.test.js` (NEW; portable).
- `tests/stop-member-hard-terminate-wt-server-survives.test.js` (NEW;
  Windows-only, gated by `CREWS_WT_LIVE_TESTS=1`).

### Acceptance criteria
1. `hardTerminateMemberByLaunchPid` reads `<memberDir>/launcher.pid`,
   parses the JSON `{ pid, startedAt }`, walks descendants via
   `pwsh -NoProfile -Command '<inline BFS>'`, kills bottom-up via
   `Stop-Process -Force`, returns `{ launcher, descendants, wtServerPid }`.
2. Empty/missing `launcher.pid` returns
   `{ launcher: null, descendants: [], wtServerPid: null,
   reason: 'missing-launcher-pid' }` without throwing.
3. Recycled-PID guard: refuses to kill if the live process at
   `launcherPid` doesn't have our spawn-launcher script path in its
   `CommandLine`. Surfaces `PidRecycledRefuseToKillError`.
4. The walk NEVER enumerates ancestors of `launcherPid` (`wtServerPid` is
   the launcher's PPID, RECORDED but NOT killed).
5. `applyHardStopMember(target, lead, cwd, opts)`:
   - Same authorization preconditions as `applyStopMember` (caller
     verified `lead` is authorized).
   - Updates manifest under `withManifestLock`: sets
     `shutdownRequested=true`, `shutdownRequestedAt`,
     `shutdownRequestedBy`, `shutdownReason`,
     `lastListenerExitedAt`, `terminationKind='hard'`,
     `terminatedAt`, `terminatedPids`, `actorState='cleared'`.
   - Does NOT append a `stop-request` envelope to the mailbox.
   - Returns same shape as `applyStopMember` plus
     `{ terminationKind, terminatedPids }`.
6. `stopMemberAsLead(target, cwd, sessionId, opts)` and
   `stopMemberByOperator(target, cwd, leadName, crew, opts)` accept
   `opts.soft` (default `false`). When `false`, route to
   `applyHardStopMember`; when `true`, preserve the existing
   `applyStopMember` path verbatim.
7. `tests/stop-member-hard-terminate.test.js`: spawns a no-launch member
   (`CREWS_NO_LAUNCH=1`), writes a fake `launcher.pid` pointing at a
   `child_process.spawn('node', ['-e','setTimeout(()=>{},600000)'])`
   child the test owns, invokes `applyHardStopMember`, asserts (a)
   child PID is dead within 3 s, (b) manifest fields written as
   specified, (c) on non-Windows the test self-skips with a clear
   message ("hard-terminate currently requires Windows").
8. `tests/stop-member-hard-terminate-wt-server-survives.test.js`
   (gated): spawn a real wt tab, capture `WindowsTerminal.exe` PID,
   hard-terminate, assert WT PID still alive AND tab's OC.exe count
   dropped by exactly 1. Skips cleanly when `CREWS_WT_LIVE_TESTS` unset
   or non-Windows.

### Out of scope
- Slash/CLI surface (US-02).
- `CHANGELOG.md` and plugin `AGENTS.md` text (US-03).

### Risk
Medium. The descendant walk implemented in inline pwsh is the most
delicate piece. Mitigation: tests assert (a) descendant Node child is
dead and (b) WT server survives. Both signals are deterministic.

---

## US-02 — CLI + slash default flip; `--soft` opt-in

**As** the bookkeeper-lead
**I want** `/crews-stop-member <name>` (no flag) to hard-terminate
**so that** my common-case stop doesn't pay the round-trip cost.

### Files
- `hooks/commands/stop-member.js` (slash + CLI parsers; usage docs;
  parityVectors).
- `tests/stop-member-cli.test.js` (EXTEND: assert `--soft` flag parses;
  default routes to hard handler).

### Acceptance criteria
1. Slash form: `/stop-member <name> [reason text]` (default = hard).
   Slash form: `/stop-member <name> --soft [reason text]` opts into soft.
   `--soft` is the ONLY flag the slash form accepts; everything else is
   `reasonText`.
2. CLI form: `node tools/crews.js stop-member <name> --crew <crew>
   [--as <lead>] [--state-cwd <path>] [--cwd <workspace>]
   [--reason <text>] [--soft]`. Default = hard.
3. `USAGE` string updated to document `--soft` + new default + the
   safety guarantee one-liner ("hard-terminates the per-tab child
   process tree; never targets the WindowsTerminal.exe server").
4. `parityVectors` updated:
   - `/stop-member alice` ↔ `['alice','--crew','demo','--as','lead1']` →
     `{ name:'alice', reasonText:'', soft:false }`.
   - `/stop-member alice --soft please wrap up` ↔
     `['alice','--crew','demo','--as','lead1','--soft','--reason','please wrap up']`
     → `{ name:'alice', reasonText:'please wrap up', soft:true }`.
5. Slash handler routes to `stopMemberAsLead(name, cwd, sessionId,
   { reasonText, soft })`; CLI handler routes to
   `stopMemberByOperator(name, cwd, effectiveAs, crew,
   { reasonText, soft })`.
6. `formatSuccess`: for hard path, the human-readable response includes
   the descendant count, e.g.
   `/stop-member: alice hard-terminated in crew "demo" at <iso>
   (killed launcher + 3 descendants; WindowsTerminal.exe server
   PID 32460 untouched)`. For soft, preserves the existing wording.
7. Tests:
   - `parseSlash('/stop-member alice')` → `{ soft:false }`.
   - `parseSlash('/stop-member alice --soft please wrap up')` →
     `{ soft:true, reasonText:'please wrap up' }`.
   - `parseCli(['alice','--crew','demo','--as','lead1'])` →
     `{ soft:false }`.
   - `parseCli(['alice','--crew','demo','--as','lead1','--soft'])` →
     `{ soft:true }`.
   - Default route asserts `stopMemberAsLead` called with
     `{ soft:false }` (and `applyHardStopMember` is what runs).
   - `--soft` route asserts the legacy `applyStopMember` (mailbox-
     envelope) path runs and the envelope is appended.

### Out of scope
- Underlying kill helper (US-01).
- Docs (US-03).

### Risk
Low. Pure surface-layer flag-and-route work; tests deterministic.

---

## US-03 — Manifest schema docs, CHANGELOG, plugin AGENTS.md

**As** the plugin maintainer
**I want** the v1.9.0 release notes + manifest schema docs + AGENTS.md
to clearly describe the new behaviour + safety guarantee
**so that** consumers know hard is the new default and can opt back in
to soft if they really need to.

### Files
- `CHANGELOG.md` (new `## v1.9.0` section).
- `AGENTS.md` (plugin; update "Stop a member" section).
- `hooks/protocol/manifest.js` JSDoc / inline schema (additive
  termination fields documented).
- `tests/stop-member-cli.test.js` (verify divergenceCases mention
  `--soft`).

### Acceptance criteria
1. `## v1.9.0` CHANGELOG entry contains:
   - Round-trip-cost rationale + smoke-test reference (2026-05-29
     plan-ralph-overview seq-3 / seq-4 envelopes).
   - Explicit safety guarantee: "hard-terminate kills only the per-tab
     child process tree; the `WindowsTerminal.exe` server PID (and every
     other tab in every window) is never touched".
   - `--soft` opt-in description + the (open-ended) deprecation
     timeline.
   - Pointer to research-brief at
     `.ralph/jobs/crews-stop-member-hard-terminate-no-envelope/research-brief.md`
     (or its post-merge equivalent location if the plan kept a copy in
     the plugin repo's `docs/`).
   - Note that hard-terminate behaviour assumes Windows + Windows
     Terminal; non-Windows callers still get "spawn-member currently
     requires Windows" and now also get
     "hard-terminate currently requires Windows" if they reach the
     stop path.
2. Plugin `AGENTS.md` "Stop a member" section explains new default,
   safety guarantee, and `--soft` opt-in (matching the wording in the
   plan §6).
3. `manifest.js` JSDoc or inline schema comment lists the new
   `terminationKind`, `terminatedAt`, `terminatedPids` fields with
   their types and value sets (`terminationKind` ∈ `'hard' | 'soft'`).
4. `divergenceCases` in `stop-member.js` parityVectors mention
   `--soft` divergence (slash uses trailing positional; CLI uses
   `--soft` boolean).

### Out of scope
- Codexu `AGENTS.md` update (separate consumer-side follow-up, listed
  as a known follow-up).
- Drop-`-NoExit` change (separate follow-up).

### Risk
Low. Pure documentation. CHANGELOG.md / AGENTS.md aren't lint-gated.
