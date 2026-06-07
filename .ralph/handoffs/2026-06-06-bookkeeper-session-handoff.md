# Bookkeeper-Lead Handoff — 2026-06-06 end-of-session → fresh session

> Fresh bookkeeper: read in this order — (1) `AGENTS.md` (the "Bookkeeper
> operating invariants" section, esp. the NEW "Arm the lead listener
> INDEFINITELY" bullet), (2) `plans/codexu-roadmap.md` line ~292 onward (the
> 2026-06-06 entry + its **continuation** block), (3) this doc. You are the
> `overview-bookkeeper` lead of crew `ralph-pipeline`, running under Copilot
> CLI.

## 1. Where we are

A long two-phase session. This continuation phase shipped:

- **crews v3.8.0** — `crews-locks-retry-unknown-errno-4094` (lead-driven). Tolerate
  Windows `UNKNOWN`/errno-4094 as a transient `.crews` lock error. This was the
  exact bug that killed two brainstorm members earlier in the session. Toolkit
  `9dd06d99`, codexu `81739f3b`. **MERGED.**
- **crews v3.9.0** — `crews-arm-chaining-footgun-guard` (impl member). Fail-loud
  guard for the `arm | Out-Null` footgun. Toolkit `c95674a1`, codexu `ca69c534`.
  **MERGED.** (Impl commit `4c39d922` cherry-picked to main as `c95674a1`; the
  ship also reconciled a personal-only docs commit `dba2b217` onto all 3 toolkit
  remotes.)
- **2 brainstorms shipped + now PLAN-READY:**
  - `codex-ralph-member-multi-agent-adapter` → D-001 (codex target in ralph's
    `generate-copilot-artifacts.mjs`, gated on a D-003 retrieval spike). `053c3f4a`.
  - `ralph-overview-mcp-snapshot-sync-on-read` → D-001 (lifecycle-first
    sync-on-read). `2164c2c5`→`e6ce2c43`.
  - Both have a `command.prompts.plan` seed in `.ralph-overview/data.json`.
- **4 tasks filed (tracked):** `crews-member-crash-auto-notify-lead`,
  `ralph-copilot-exec-readonly-submodule-snapshot-cost`,
  `crews-listener-observability-logging`,
  `crews-bg-gate-recognize-background-subagents`.

Everything is pushed to **both** codexu remotes (`origin` evmitran_microsoft +
`personal` Evyatar108) and **all three** toolkit remotes (`origin` + `gim-home` +
`personal`). Latest codexu `main` before this handoff commit: `de574ab8`.

**Active plugin versions** (codexu AGENTS.md version table is the CI source of truth):
`crews 3.9.0`, `ralph-overview 2.9.0`, `ralph (ralph-orchestration) 5.51.0`.

No crew members are running (all stopped cleanly). The lead listener should be
armed **indefinitely** (no `--timeout-ms`) — see §4/§5.

## 2. Problem detail (what to do next)

The next parallel batch is the **two plan-phase members** for the brainstorms that
just shipped:

- `plan-adapter` → `/plan-with-ralph --from-brainstorm .ralph/brainstorms/codex-ralph-member-multi-agent-adapter/ "<seed in data.json prompts.plan>"`
  — story 1 MUST be the **D-003 result-retrieval spike** (go/no-go: can a parent
  codex 0.135 v2 member collect each child's full final JSON using only
  model-visible tools?). ralph-orchestration scope, v5.52.0.
- `plan-mcp-snapshot` → `/plan-with-ralph --from-brainstorm .ralph/brainstorms/ralph-overview-snapshot-freshness/ "<seed in data.json prompts.plan>"`
  — lifecycle-first sync-on-read in `parallel-ready-tasks.ts`. ralph-overview
  scope, v2.10.0.

The two plans target **different plugins** (ralph vs ralph-overview) and plans
only write to `.ralph/jobs/` (no version-file conflict), so they are
parallel-safe at the file level. **The constraint is RESOURCES, not surfaces** —
see §4 (the Copilot-lens submodule-snapshot cost) and §5.

Operator decision already on record (2026-06-06): spawn both plans **after** any
running impl ships, so max-2-heavy-concurrent. There is no impl running now, so
the two plans can go next.

## 3. Prior artifacts (read these for full context)

- `plans/codexu-roadmap.md` — 2026-06-06 entry (line ~292) + continuation block
  (ships #58–61 + filed-tasks row + lessons).
- `.ralph/brainstorms/codex-ralph-member-multi-agent-adapter/` — adapter D-001
  (`selected-direction.md`, `brainstorm-synthesis.md`, `brainstorm.json`).
- `.ralph/brainstorms/ralph-overview-snapshot-freshness/` — mcp-snapshot D-001
  (note: dir name differs from the task id).
- `.ralph/jobs/crews-arm-chaining-footgun-guard/` — the shipped arm-guard plan +
  Phase-4 review artifacts (reference for how a crews impl is structured).
- `ai-developer-toolkit/plugins/crews/AGENTS.md` — v3.8.0 + v3.9.0 sections
  (the locks fix + arm fail-loud guard, with gotchas).
- This session's prior summary checkpoints under the session-state folder.

## 4. Findings with evidence (load-bearing)

- **The "listener missed a delivery" report was a self-inflicted `--timeout-ms`,
  NOT a crews bug.** Hard evidence: `crews.log` showed `lead-listener-29` timed
  out at `02:03:43` (`waitedMs=1200777`, the full 20 min I passed). The impl's
  done report was written to the mailbox at `02:03:45` (`mailbox-history.jsonl`
  seq 417 `sentAt`) — **2 seconds into the un-armed gap** — and was caught by the
  next arm's `via=initial` scan at `02:04:20`. There was **no**
  `orphan-consume-refused` (so not an epoch race), and an earlier indefinite
  listener (`lead-listener-27`) delivered `via=watch` in real time at `01:40:44`.
  The watch/poll paths are fine; the only cause was the self-imposed timeout
  expiring into a gap. **Always arm indefinitely (§5).**
- **The crews v3.8.0 lock fix held in production.** Two concurrent multi-lens
  brainstorms + one impl ran to completion this phase. The 2026-06-06 r1/r2
  member deaths (UNKNOWN-lock crash) did not recur.
- **A SECOND concurrency-death cause exists (filed, unfixed):** the adapter
  brainstorm member found that ralph's Copilot lens runs `copilot-exec
  --read-only`, whose `captureManifest` revert-guard **byte-reads both
  multi-GB submodule trees** (`codex/` Rust tree + `ai-developer-toolkit/`) into
  memory. Running two concurrently is the likely resource-exhaustion trigger for
  the r1/r2 deaths (the codex lens has no such guard and stayed healthy; a
  partial-mode brainstorm that SKIPPED the Copilot lens succeeded). Filed
  `ralph-copilot-exec-readonly-submodule-snapshot-cost`. **Until this is fixed,
  be cautious running 2+ concurrent members that each launch a Copilot lens.**
- **Dual-writer brainstorm-on-main hazard observed.** The adapter member
  committed directly on the lead's primary-dir `main` (`053c3f4a`); the
  mcp-snapshot member correctly used a worktree+topic-branch (`2164c2c5`, pushed
  to origin, FF/cherry-picked by the lead). Both landed, but the worktree pattern
  is the safe one (already the codified plan-phase rule in AGENTS.md).

## 5. Things to NOT do (anti-patterns observed)

- **Don't pass `--timeout-ms` to the lead listener.** Arm indefinitely with the
  exact hook-provided command (`node <crews-bin> arm overview-bookkeeper --crew
  ralph-pipeline --cwd D:/harness-efforts/codexu --session-id <id>`). The
  PreToolUse block hands you this command verbatim — use it.
- **Don't run 2+ concurrent Copilot-lens-heavy members** (two multi-lens
  brainstorms/plans) until `ralph-copilot-exec-readonly-submodule-snapshot-cost`
  is fixed. If you must, instruct members to run partial-mode (skip the Copilot
  lens, like the adapter brainstorm did).
- **Don't let a plan/brainstorm member commit on the lead's primary-dir `main`.**
  Members use a worktree + topic branch; the lead FF/cherry-picks.
- **Don't `git add CLAUDE.md`** (gitignored) and **don't `git add -A`** in a
  bookkeeping commit — stage `.ralph-overview/data.json` (and other files)
  explicitly.
- **Don't hand-edit `.ralph-overview/data.json` with non-unique anchors** — use
  id-keyed Node scripts in `.ralph/scratch/`, JSON.parse-check + count-guard
  before every commit (the round-trip `JSON.stringify(d,null,2)+'\n'` is
  byte-identical, verified).

## 6. Decision framework

- **Stage selection (brainstorm/plan/impl):** fuzzy goal / competing approaches →
  brainstorm; concrete seed with file paths → plan; committed+reviewed plan →
  impl. Both pending tasks are PLAN stage (brainstorm shipped).
- **Concurrency ceiling:** ~2 heavy (multi-lens) members. An impl is medium. The
  Copilot-lens resource bug (§4) tightens this further until fixed.
- **Disjoint-surface check before parallel spawn:** repo → plugin → cross-cutting
  docs. Same-plugin impls conflict on version files; serialize them. (The two
  plans are different plugins → safe.)
- **Lifecycle bookkeeping:** flip `lifecycle: merged` + add `shipManifest` only
  when the work is on `origin/main`. Brainstorm/plan ships stay `tracked` with a
  `cmd-ok` "shipped @ SHA" card + the next-phase prompt seed.

## 7. Recommended sequencing (the single most useful section)

1. **Arm the lead listener INDEFINITELY** (no `--timeout-ms`), then for the batch:
2. **Spawn `plan-adapter`** (`/plan-with-ralph --from-brainstorm
   .ralph/brainstorms/codex-ralph-member-multi-agent-adapter/`). Verify it
   registers healthy (one-shot `list-members`, not a poll loop).
3. **Spawn `plan-mcp-snapshot`** (`/plan-with-ralph --from-brainstorm
   .ralph/brainstorms/ralph-overview-snapshot-freshness/`). Stagger slightly after
   #2 so the two Copilot lenses don't fan out simultaneously (§4 resource note).
4. **Wait via the armed listener** (never poll). On each `done`:
   - Review-mail → verify the plan commit/branch → FF/cherry-pick to main → push
     **both** codexu remotes → stop the member → bookkeep data.json (add a "Plan
     shipped @ SHA" card + `prompts.impl` seed; stays `tracked`).
5. When both plans are shipped + reviewed, the next batch is the two **impls**
   (ralph v5.52.0 + ralph-overview v2.10.0 — different plugins, parallel-safe).
6. **Strategic interleave:** consider prioritizing
   `ralph-copilot-exec-readonly-submodule-snapshot-cost` (brainstorm) soon — it
   unblocks safe concurrent heavy batches.

## 8. Open questions for operator

- **`crews-bg-gate-recognize-background-subagents`** — is it worth changing the
  bg-gate to recognize background Task/sub-agents as "active work", or is forcing
  a synchronous wait (the current effect) the right design? The arm-guard member
  self-recovered and judged the block "correct-but-coarse." Filed as a brainstorm;
  operator's call on priority.
- **When to try codex as the member engine again** — currently copilot for all
  members (operator deferred codex). The adapter D-001 + D-003 spike are the path
  to non-degraded codex multi-lens.
- **`ralph-copilot-exec-readonly-submodule-snapshot-cost` priority** — fix before
  or after the two plan ships?

## 9. Files referenced

- `.ralph-overview/data.json` — task source of truth (180 tasks).
- `AGENTS.md` — bookkeeper operating manual + version table + the new
  arm-indefinitely bullet.
- `plans/codexu-roadmap.md` — session log (continuation block at ~line 316+).
- `ai-developer-toolkit/plugins/crews/{lib/listener-loop.js,hooks/{locks,safe-io}.js}`
  — the v3.8.0/v3.9.0 edit sites.
- `.crews/logs/crews.log` + `.crews/crews/ralph-pipeline/leads/overview-bookkeeper/mailbox-history.jsonl`
  — listener-timeout evidence (§4).

## 10. Constraints

- **Windows + Git Bash + PowerShell 5.1.** Prepend `C:\Program Files\Git\bin` to
  PATH when running the crews/ralph node test suites (WSL `bash` hangs).
- **Multi-remote push discipline.** codexu: `origin` (evmitran_microsoft) +
  `personal` (Evyatar108, needs `gh auth switch`). Toolkit: `origin` + `gim-home`
  (both evmitran_microsoft) + `personal` (Evyatar108). Surface stale remotes —
  `dba2b217` was personal-only this session and had to be reconciled.
- **EOL:** codexu `.md`/data.json are CRLF-on-disk / LF-in-repo (autocrlf=true).
  After staging, compare `git diff --cached --numstat` vs `--ignore-cr-at-eol
  --numstat`; equal = clean (no whole-file flip).
- **The `credential-manager-core is not a git command` warning is benign** — pushes
  still succeed (filter it from output).

## 11. Recommended single next action

**Arm the lead listener indefinitely (no `--timeout-ms`), then spawn
`plan-adapter` via `/plan-with-ralph --from-brainstorm
.ralph/brainstorms/codex-ralph-member-multi-agent-adapter/` with story 1 = the
D-003 retrieval spike (go/no-go).** Then stagger-spawn `plan-mcp-snapshot`, and
wait on the armed listener for their `done` reports — no polling.
