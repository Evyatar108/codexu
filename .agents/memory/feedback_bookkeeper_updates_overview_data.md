---
name: bookkeeper-updates-overview-data
description: "As the overview-bookkeeper lead, update plans/overview-data.js as tasks complete — don't wait for the user to ask. Flip lifecycle to merged, add mergeCommit, refresh lastTouchedAt. The watcher updates the sidecar automatically, but overview-data.js is hand-curated and goes stale otherwise."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

**Rule:** When a Ralph member terminates (terminal:complete or terminal:blocked) and lands its work on `origin/main`, update the corresponding task entry in `plans/overview-data.js`:

- `lifecycle: "tracked"` → `lifecycle: "merged"` (or `lifecycle: "archived"` for closed/superseded work that won't be reworked)
- Add `mergeCommit: "<sha>"` — single SHA, OR comma-separated for dual-repo work (codex topic + codexu pointer-bump). Precedent: `"mergeCommit": "e9fa64a0,d279d49d"` on the port-explorer-prompt entry.
- Refresh `lastTouchedAt: "<ISO-timestamp>"`

**Why:** The watcher's `plans/overview-ralph-state.js` mirrors `.ralph/jobs/<slug>/job-state.json` automatically, so the dashboard chips render correct stages. But the hand-curated `plans/overview-data.js` is the SOURCE OF TRUTH for stable task metadata (per-phase `command.prompts.{brainstorm,plan,impl}`, scope, kanbanCards). Its `lifecycle` field represents the bookkeeper's durable backlog/merge/archive view, and if it stays "tracked" forever, future agents querying overview-data directly (not through the snapshot) see stale state. Note: as of v2.3.0 (2026-05-27), `phase` was renamed to `lifecycle` with values `tracked`/`merged`/`archived` (replacing the old `plan-ready`/`shipped`/`closed`). The legacy `phase` key is read-tolerant for one minor (v2.3.x) via the alias window in the sync layer + viewer, but write-side must use `lifecycle`.

**How to apply:** Bundle bookkeeper updates into a single `chore(plans): update overview-data.js for shipped tasks` commit per batch — don't sprinkle one-line edits across the session. Push to origin/main.

**When NOT to update:** Don't flip `phase` until the work is actually on `origin/main`. A member reporting kind=done but having only pushed to a topic branch (e.g., dual-repo task where one repo's CI hasn't merged yet) still goes in as `phase: "shipped"` if both pushes are done and CI is green; if CI is red or unverified, leave the `phase` alone and add a comment about the in-flight CI state.

**Lesson learned 2026-05-25:** Operator caught me leaving overview-data.js stale for `userid-cleanup` after it shipped as `25b9a573` and for `codex-base-prompt-safety-rails` after both repos got pushed. Going forward, bake the bookkeeper update into the same turn that processes a member's terminal report.

Related: [[feedback_codex_fork_no_local_cargo]]
