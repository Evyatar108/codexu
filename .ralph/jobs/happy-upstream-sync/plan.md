# Implementation Plan: happy-upstream-sync (2026-05-30)

## Summary

Execute the `happy-upstream-sync` skill against the Evyatar108/happy fork
(working tree: `D:/harness-efforts/happy`) to absorb upstream
`slopus/happy` changes since the last sync on **2026-05-03**.

This is a recurring 2-4-week procedure; the SKILL.md at
`.agents/skills/happy-upstream-sync/SKILL.md` has the canonical
end-to-end steps. This plan is the per-run sizing + decomposition record.

**Important repo layout note (correction to the spawn prompt):** the
happy fork is **not** a submodule of codexu. It is an independent clone
at `D:/harness-efforts/happy` whose `origin` remote is `slopus/happy`
(upstream) and `fork` remote is `Evyatar108/happy`. The codexu repo has
its own `packages/happy-*` directories, but they are NOT a checkout of
the same code — the sync work happens entirely inside
`D:/harness-efforts/happy` on its `main` branch, and the codexu side
only carries the bookkeeping artifact (this plan + the
`.ralph-overview/data.json` ship row when the lead merges).

The four sync-trail docs the skill updates therefore all live in
`D:/harness-efforts/happy`, not in codexu:

1. `docs/fork-notes.md`
2. `docs/fork-roadmap.md` (note: the SKILL.md still says
   `plans/codexu-roadmap.md` — that file does NOT exist in the happy
   fork; it lives only in codexu. The happy-side roadmap is
   `docs/fork-roadmap.md`. **Follow-up for the SKILL.md**: correct
   this reference after the sync.)
3. `packages/happy-app/CHANGELOG.md`
4. `packages/happy-app/sources/changelog/changelog.json` (regenerate)

## Sync state (computed 2026-05-30)

| Field | Value |
|---|---|
| Last-synced upstream SHA (right-side parent of `25fe2cf3`) | `df4cdae8` |
| Last sync date | 2026-05-03 |
| **Latest upstream release** | `cli-1.1.8` (published 2026-04-27) — **predates our last sync**; not a useful anchor this round |
| Upstream `origin/main` HEAD (fetched 2026-05-30) | `21c6ced0` |
| **Sync target** | `origin/main` HEAD `21c6ced0` (no newer release exists) |
| Commits to triage (`df4cdae8..21c6ced0`, no-merges) | **160** |
| Files changed in the diff | 293 (+20,177 / −3,315) |

### Commit-verb distribution

| Verb | Count |
|---|---|
| fix | 71 |
| feat | 39 |
| docs | 11 |
| chore | 9 |
| perf | 6 |
| style | 3 |
| refactor | 1 |
| ci | 1 |
| test | 1 |
| (non-conventional) | 18 |

### Per-package commit incidence

| Package | Commits touching it | Files changed | Default heuristic verdict (per SKILL) |
|---|---|---|---|
| `packages/happy-app` | 99 | 141 | Mixed: Cherry-pick UI improvements; Manual for `sync/`, `MarkdownView`, `ToolDiffView`, `DiffView`, `ChatList`; Skip for areas we deleted |
| `packages/happy-cli` | 44 | 48 | Mixed: Skip for `src/api/` (auth/encryption deleted); Cherry-pick for other fixes |
| `packages/happy-server` | 24 | 29 | Mostly Skip (single-user embedded daemon; multi-tenant code is dead-weight) — but server is still LIVE in this fork, so verify each one rather than blanket-skip |
| `packages/codium` | 1 | 49 | Cherry-pick if applicable (our `packages/codium*` plugins co-exist) |
| `packages/happy-wire` | 2 | 2 | Likely Cherry-pick (protocol changes; verify wire compat) |
| `packages/happy-agent` | 2 | 2 | Likely Cherry-pick |
| `.agents/skills/` | 11 | 11 | Cherry-pick (skill text rarely conflicts) |
| `docs/` | 2 | 2 | Cherry-pick unless contradicts fork direction |
| `AGENTS.md` | 1 | 1 | Manual (we have a fork-divergent AGENTS.md) |
| `pnpm-lock.yaml` | 1 | 1 | Manual (regenerate after merge) |

### Per-bucket estimate (rough, pre-triage)

These are **planning estimates**, not commitments — the actual bucket
assignment happens commit-by-commit in step 4 of the skill.

| Bucket | Estimate | Reasoning |
|---|---|---|
| **Cherry-pick** | ~40–55 | Most of the 71 `fix` + 6 `perf` + skill/docs commits land here, minus those that touch deleted code |
| **Manual** | ~25–40 | UI changes in `MarkdownView`, `ToolDiffView`, `DiffView`, `ChatList`, `sync/`, sidebar, the `Codex-style sidebar / zen mode / unified header` feat (`4a5f91dc`), file-viewer/All-Files-sidebar feat (`f9e48b68`), desktop-UI redesign (`01e1e35a`) — these are headline upstream additions that likely fight our existing fork code |
| **Defer** | ~10–25 | Anything blocked on a related task; the desktop/Tauri pushes (`8e4118b0`), webapp zoom default (`58d5ecb8`), `expImageUpload` flag (`23d46136`), push-routing reshape (`2db77937`, `0c58ea71`) are candidates for "useful but want to evaluate separately" |
| **Skip** | ~40–60 | Multi-tenant server code, auth/encryption (philosophical divergence), release-CLI version bumps (`904c9417`, `05d2e723`, `5e6e28b2`), changes to code we deleted/replaced |

Net cherry-pick count expected to land between 40 and 55 — **above the
30-commit decomposition threshold the task brief flagged**.

## Decomposition recommendation

**Recommended: split into 3 batches** (not 1 monolithic execution), each
its own commit that's pushable + verifiable in isolation. Rationale:

1. **160 commits / 293 files is in the SKILL's "schedule a full day or
   split into batches" zone.**
2. **Expected cherry-pick count (~40–55) exceeds the 30-threshold** from
   the spawn-prompt brief.
3. The 2026-05-03 merge took **25 conflicts across 1,971 files** as a
   single batch; that was painful enough that splitting this one
   reduces both blast radius and time-to-recover when a batch's
   typecheck/vitest goes red.
4. Each batch can be its own PR/commit chain pushed to `fork/main` with
   its own sync-log update — partial progress is durable.

### Proposed batches (chronological-first, conflict-bounded)

The batches are **chronological** (oldest commits first). The split
points are chosen so each batch lands ~40–60 commits and ends at a
natural pause (a `Release CLI version 1.1.10-beta.N` commit) where the
upstream tree is in a known-good state.

| Batch | Upstream range | Approx commit count | Notable headline commits | Estimated conflict surface |
|---|---|---|---|---|
| **1 — pre-beta.6 (oldest 50)** | `df4cdae8..904c9417` | ~50 | Codex-style sidebar rewrite (`4a5f91dc`), file-viewer/All-Files tab (`f9e48b68`), desktop UI redesign (`01e1e35a`), push routing (`2db77937`/`0c58ea71`), file-conflict detection (`f3f9f72a`), `expImageUpload` flag (`23d46136`), Tauri Linux (`8e4118b0`), `groupToolCalls` default-off (`6f669691`), Safari zoom font fix (`cb2fc38b`), chat-title race fix (`972bcef1`) | **HIGH** — this is the headline UI batch; touches `ChatList`, sidebar, header — all areas we diverge on |
| **2 — beta.6 to mid-May fixes (next ~60)** | `904c9417..` (through ~`30a98abc` or similar mid-list pause) | ~50–60 | Codium projects integration (`511917e1`/`e1f2dca9`), webapp zoom (`58d5ecb8`), metric estimates (`18635e57`/`512e1b8d`), pino bun-sync (`31a6e4df`), `/sessions` skill (`0bfb7041`), Fabric chat-input clear (`a28b9a94`), changelog/skill docs | **MEDIUM** — Codium integration is fork-relevant (we have own codium plugins); server/CLI fixes mostly clean |
| **3 — final tail to `21c6ced0` (remaining ~50)** | `..21c6ced0` | ~50 | macOS signing entitlements (`4a64c66a`), Prisma engine bundle fix (`00725d20`), socket-reconnect fix (`c2b9e16a`), configurable agent defaults (`b042d834`), self-host server split (`d2d2f730`), publish-time checks (`21c6ced0`), build-metadata in settings (`17aa703f`), compact-session indicator (`b7297317`) | **LOW–MEDIUM** — server/CLI plumbing + macOS signing; few app-UI conflicts |

Each batch ends with: (a) typecheck + vitest gate per skill, (b)
sync-trail docs delta updated, (c) push to `fork/main`. Between
batches, the lead pauses to operator-confirm before spawning the next
impl member.

### Alternative (if operator wants single execution)

If the operator chooses to run as one monolithic batch despite the
size, the plan still works — but the SKILL's "for batches with
conflicts: prefer `git cherry-pick -n`" guidance becomes load-bearing,
and the sync-trail commit at the end will need a much longer per-commit
trail in `docs/fork-notes.md`.

## Stories for the impl phase

If the operator approves the **3-batch decomposition**, the impl spawn
becomes 3 sequential impl members, one per batch, each a 1-story PRD:

- `happy-upstream-sync-batch1-pre-beta6` — absorb `df4cdae8..904c9417`
- `happy-upstream-sync-batch2-mid-may` — absorb `904c9417..<midpoint>`
- `happy-upstream-sync-batch3-tail` — absorb `<midpoint>..21c6ced0`

Story shape for each batch:

> **Story:** Triage and absorb upstream commits in range
> `<left>..<right>` per `.agents/skills/happy-upstream-sync/SKILL.md`
> steps 3–8. Each commit must land in exactly one bucket
> (cherry-pick / manual / defer / skip) with a one-line rationale.
> Cherry-picks may be combined into `chore(upstream-sync): port
> slopus/happy <sha>..<sha>` groups when conflicts force `-n`. Update
> the four sync-trail docs in one trailing commit per batch.

**Acceptance criteria per batch:**

1. Every commit in `<left>..<right>` (no-merges) appears in the sync
   log under `docs/fork-notes.md` (or the per-batch sync-log section)
   with sha + verdict + one-line rationale.
2. **Typecheck** is green:
   ```bash
   pnpm --filter "{packages/happy-server}" --filter "{packages/happy-cli}" \
        --filter "{packages/happy-app}" --filter "{packages/happy-agent}" \
        --filter "{packages/happy-wire}" exec tsc --noEmit 2>&1 \
        | tee /tmp/codexu-upstream-sync-tc-batch<N>.log
   ```
3. **happy-app vitest** is green:
   ```bash
   pnpm --filter "{packages/happy-app}" exec vitest run 2>&1 \
        | tee /tmp/codexu-upstream-sync-tests-batch<N>.log
   ```
4. The four sync-trail docs are updated (or staged for the final
   batch's trailing commit if the batches share one doc update).
5. `fork/main` advanced; commit message follows the SKILL's
   `chore(upstream-sync): absorb slopus/happy <range> (...)` template.

## Pitfalls (specific to this sync, from prior runs)

These are the SKILL's documented pitfalls, plus what to watch in this
particular 160-commit range:

1. **`react-native-reanimated` bumps** in this range will break the
   vitest RN stub (Flow `import typeof` leaks through). The diff
   inspection notes the upstream bumped `pnpm-lock.yaml` once — verify
   whether `react-native-reanimated` moved. If so, expect a
   test-setup follow-up after step 6.
2. **`MarkdownView` / `ToolDiffView` changes are Manual, not
   Cherry-pick.** The 2026-05-03 sync collapsed `ToolDiffView` into a
   single PierreDiff path; any upstream edits to those files need
   careful manual port. Same for `MarkdownView` (we kept
   `AnimatedMarkdownText`).
3. **The Codex-style sidebar / zen mode / unified header commit
   `4a5f91dc`** is the headline upstream UI restructure of this round.
   It almost certainly conflicts with our fork's three-state sidebar
   (`sidebarMode`) and chat-text-UX work. Treat it as **Manual** —
   read the upstream diff, decide what to port into our fork's
   sidebar/header components, and document the divergence.
4. **`f9e48b68` (file viewer + All Files sidebar tab)** and
   **`01e1e35a` (desktop UI redesign)** are large pure-additions that
   almost certainly land as **Cherry-pick** if they don't conflict
   with our fork, or as **Defer** if they need their own product-fit
   review first.
5. **The 4 canary tests from the 2026-05-03 sync** (`modeHacks`,
   `modelModeOptions`, `settings.spec`, `useSessionQuickActions`)
   must still pass after this round. Re-verify before each batch's
   final push.
6. **`docs/fork-notes.md` line 24** still mentions the stale
   `D:/h` worktree convention. Don't reintroduce stale paths from
   upstream `AGENTS.md` (`1` commit touches it).
7. **`packages/happy-server` (24 commits)** is the one area where
   SKILL.md says "likely Skip" but the fork now runs the server
   locally as a Windows Service — so server-side fixes (e.g. socket
   reconnect `c2b9e16a`, Prisma engine load `00725d20`, pino bun-sync
   `31a6e4df`, init-socket reconnect handling) may actually be
   **Cherry-pick or Manual** rather than Skip. Re-evaluate per-commit
   rather than blanket-skipping the area.

## Pre-flight checklist (lead runs before spawning first impl member)

- [ ] `D:/harness-efforts/happy` is clean (`git status` shows no
      uncommitted changes); `fork/main` is up to date and matches local
      `main`.
- [ ] `D:/harness-efforts/happy` is on `main` (not a feature branch).
- [ ] Baseline typecheck + vitest green on current `main` before any
      cherry-pick lands — capture to
      `/tmp/codexu-upstream-sync-baseline-{tc,tests}.log`. If baseline
      is red, **stop and triage that first** — the sync's gates will
      misattribute.
- [ ] Operator has confirmed the 3-batch decomposition (or chosen
      monolithic).
- [ ] An impl-phase member is spawned per batch, sequentially, NOT in
      parallel — they share the same target branch `main` in
      `D:/harness-efforts/happy`.

## Reference artifacts

- Full commit list (160 SHAs):
  `.ralph/jobs/happy-upstream-sync/commits-to-triage.log` in this
  branch (committed alongside this plan).
- Skill: `.agents/skills/happy-upstream-sync/SKILL.md` (in
  D:/harness-efforts/happy — same path also exists in codexu but the
  happy-side copy is the canonical procedure).
- Previous sync record:
  `D:/harness-efforts/codexu/plans/codexu-roadmap.md` lines 40–75
  (this stays in codexu).
- Previous merge commit: `25fe2cf3` in codexu (the merge that absorbed
  79 commits); upstream-side parent `df4cdae8` is this run's left
  bound.

## Bookkeeper handoff (ship-time, per fork-level AGENTS.md)

When all 3 batches are merged to `fork/main` (or the single monolithic
batch is), the lead updates `.ralph-overview/data.json` in codexu:

- `lifecycle: "tracked"` → `"merged"` for the `happy-upstream-sync`
  task row.
- `shipManifest`: `shippedAt`, multi-paragraph `summary` covering
  the batch ranges + headline upstream additions, and `commits[]` rows
  for each batch's merge SHA — these live in
  `Evyatar108/happy`, so each row should set
  `repo: "Evyatar108/happy"`.
- `lastTouchedAt` refreshed to ship time.

Note that the **ship commits live in the happy fork, not in codexu**.
This plan and any `.ralph/jobs/happy-upstream-sync/` artifacts are the
only codexu-side trail.

## Suggested Decomposition

For `/implement-with-ralph --parallel`: **do NOT parallelize.** The
three batches must run **sequentially** because each batch's
typecheck/vitest gate depends on the previous batch's commits being on
`main`. Parallel execution would mean batches 2 and 3 are typechecking
against pre-batch-1 `main`, which defeats the gate.

Recommended `/implement-with-ralph` invocation pattern instead:

1. Spawn `impl-happy-upstream-sync-batch1-pre-beta6` (impl phase, 1
   story).
2. After it ships and the lead pushes `fork/main`, spawn
   `impl-happy-upstream-sync-batch2-mid-may`.
3. After batch 2 ships, spawn `impl-happy-upstream-sync-batch3-tail`.
4. After batch 3 ships, the lead does the codexu-side bookkeeping per
   above.

```json
{
  "parallelizable": false,
  "reason": "Sequential batches over a shared target branch; each batch's typecheck/vitest gate depends on the previous batch's commits being on main"
}
```
