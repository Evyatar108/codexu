# Stories Outline: 1a-fork-doc — Codex fork strategy commit

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Codex-side doc edits + local commit (autonomous-verifiable)

**Description:** As a future codex/codexu contributor, I want the codex submodule's docs to clearly describe the locked fork-layout strategy so I do not have to re-litigate it across `architecture.md`, `patch-surface.md`, and `CLAUDE.md`.

**Acceptance Criteria:**
- [ ] Worktree exists at `D:/harness-efforts/codexu/.ralph/jobs/1a-fork-doc/codex-worktree/` on `1a-fork-doc-strategy` based on `origin/main` of `gim-home/codex`.
- [ ] `codex/docs/implementation/architecture.md` has a new top-level `## Fork strategy` heading between `## Solution: …` and `## Traffic flow`, AND a corresponding TOC entry at L13-22.
- [ ] The new architecture.md section contains: conditional "When this repository is consumed by codexu…" opening, two-layer outer/inner description, overlay-crate names, placement-ranking pointer to CLAUDE.md tenets, prose cross-refs to codexu's `codex-fork-extension-strategy.md` Gates 1–3 + codexu's `codexu-roadmap.md`, procedural-cadence note, W-5 non-preemption sentence, RPC-versioning-out-of-scope sentence.
- [ ] `codex/docs/implementation/patch-surface.md` has a new `## 17. Upcoming roadmap-owned seams` section inserted AFTER §16 close (~L968) and BEFORE the appendix beginning with duplicate `## 11. TUI input latency …` (~L971). Contains an advisory-only header note, a 3-row table (plugin scoping/Phase 2c, AskUserQuestion/Phase 2d, Claude-via-Copilot/Phase 7), and a closing sentence about §14/§15 registration on landing.
- [ ] `codex/CLAUDE.md`'s §"Consumer: codexu" (~L25-31) has one new paragraph mentioning Phase 1a, the architecture.md "Fork strategy" section, codexu's `codexu-roadmap.md` §"Decisions made", and Gates 1–3.
- [ ] `codex/CLAUDE.md`'s §"Core engineering tenants" is UNCHANGED (mirrors AGENTS.override.md).
- [ ] `codex/AGENTS.override.md` is unchanged.
- [ ] All cross-references to codexu/* are prose pointers, NOT Markdown links — verified via `grep -n "\[.*\](codexu/" <files>` returning 0 matches.
- [ ] `git -C <codex-worktree> diff --stat origin/main` shows exactly 3 modified files: `docs/implementation/architecture.md`, `docs/implementation/patch-surface.md`, `CLAUDE.md`.
- [ ] Step-6 operator-review artifact saved at `<job_dir>/operator-review-diff.txt` OR operator approval otherwise recorded.
- [ ] Single commit on `1a-fork-doc-strategy` with message `docs(fork-strategy): Phase 1a — lock subtree-mirror + overlay-crates layout`.
- [ ] No Rust source, scripts, or tests added.

**Dependencies:** None.
**Estimated complexity:** small.

## US-002: Push + codexu pointer bump + roadmap decision (operator-gated)

**Description:** As the operator, I want the codex commit pushed to `gim-home/codex`, the codexu submodule pointer bumped, and the codexu roadmap updated under §"Decisions made" — all in coordinated commits that don't sweep up the parent worktree's existing dirty state.

**Acceptance Criteria:**
- [ ] Topic branch `1a-fork-doc-strategy` pushed to `gim-home/codex` per operator's choice (PR or fast-forward).
- [ ] Hard gate: `git -C <codex-worktree> merge-base --is-ancestor <commit-sha-from-US-001> origin/main` returns exit 0 BEFORE codexu pointer bump proceeds.
- [ ] Dedicated codexu pointer-bump worktree exists at `D:/harness-efforts/codexu/.ralph/jobs/1a-fork-doc/codexu-pointer-worktree/` on branch `1a-fork-doc-pointer-bump` from a clean `main` checkout (NOT the dirty `D:/harness-efforts/codexu/` working tree).
- [ ] In the pointer-bump worktree: `git diff --cached --stat` shows EXACTLY 2 paths staged — `codex` (gitlink, with new SHA) and `plans/codexu-roadmap.md`. No other paths.
- [ ] `plans/codexu-roadmap.md` §"Decisions made" gains a new entry for Phase 1a (2026-05-13) naming the locked strategy components and the procedural-only cadence policy, and citing the open W-5 RFC + RPC-versioning-out-of-scope. References the three new codex doc anchors.
- [ ] `plans/codexu-roadmap.md` §"Decisions still open #1" has a "RESOLVED 2026-05-13" forward-pointer line; original entry text preserved.
- [ ] Pointer-bump commit has message `docs(roadmap): Phase 1a — record codex fork strategy + bump submodule pointer`; `git show --stat HEAD` lists EXACTLY 2 paths.
- [ ] `1a-fork-doc-pointer-bump` pushed/PR'd to codexu per operator choice.
- [ ] Worktrees cleaned up per ralph job policy.

**Dependencies:** US-001 (commit SHA reachable from gim-home/codex `origin/main`).
**Estimated complexity:** small.
