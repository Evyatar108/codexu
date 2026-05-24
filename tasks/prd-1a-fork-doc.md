# PRD: Phase 1a — Codex Fork-Strategy Documentation Commit

*Generated in autonomous mode from `D:/harness-efforts/codexu/.ralph/jobs/1a-fork-doc/plan.md` on 2026-05-13. Clarifying questions skipped; assumptions inferred from the plan and noted in section 7 (Technical Considerations).*

## 1. Introduction / Overview

The codexu project carries a *fork* of `openai/codex` and has been operating under an implicit "subtree mirror + overlay crates + submodule pin" layout for some time. The strategy is in effect (working tree state already matches it), but it is not written down as a single authoritative description, which means future agents working in either repo keep re-litigating placement decisions for new fork patches.

This feature commits the canonical fork-strategy description into the **codex submodule** as additive documentation edits, then bumps the codexu submodule pointer and records the decision in `codexu/plans/codexu-roadmap.md`. **No code, no tests, no protocol changes.** Three doc files are edited inside the codex submodule, one doc file is edited in codexu, and one gitlink (submodule pointer) is advanced.

The work is split into two stories so the autonomously-verifiable local doc work (US-001) does not collide with operator-gated remote-state changes (US-002).

## 2. Goals

- Make the implicit fork-layout strategy explicit and discoverable from canonical entry points in both repos.
- Lock the placement decision for Phase 1a so future patches default to the documented layout (overlay-first; subtree mirror for inner layer; submodule for outer layer) without re-deciding it.
- Cross-link codex-side and codexu-side strategy docs so an agent entering from either side finds a coherent contract.
- Preserve all existing open questions (W-5 subtree→submodule RFC; RPC contract versioning; subtree cadence frequency) — Phase 1a does NOT resolve them.
- Preserve the existing `AGENTS.override.md` ↔ `CLAUDE.md` tenets mirror by not editing either side of the mirrored section.
- Produce an auditable trail: a single commit on each repo with a scoped message, both operator-gated for remote push.

## 3. User Stories

### US-001: Local codex-side doc edits + local commit (autonomous)

**Description:** As a Ralph implementer agent, I want to apply the three additive codex-side doc edits in an isolated worktree and create a single local commit so the operator can review the diff before it leaves the workstation.

**Acceptance Criteria:**
- [ ] Codex worktree exists at `D:/harness-efforts/codexu/.ralph/jobs/1a-fork-doc/codex-worktree/` on branch `1a-fork-doc-strategy` based on `origin/main` of `gim-home/codex`.
- [ ] `codex/docs/implementation/architecture.md` has a new top-level heading `## Fork strategy` between `## Solution: …` and `## Traffic flow`. Verify: `grep -nE "^## (Solution|Fork strategy|Traffic flow)" architecture.md` returns the three headings in that exact order.
- [ ] The architecture.md TOC at L13-22 includes a new entry "Fork strategy" between "Solution" and "Traffic flow". Verify: `grep -n "Fork strategy" architecture.md` returns ≥ 2 lines (TOC entry + heading).
- [ ] The `## Fork strategy` section contains all of: conditional opening ("When this repository is consumed by codexu"), the two-layer outer/inner description, the overlay-crate names (`codex-copilot`, `codex-copilot-launcher`, `codex-invariant-tests`), a placement-ranking pointer to `CLAUDE.md` §"Core engineering tenants", prose cross-refs to "the codexu repo's `docs/plans/codex-fork-extension-strategy.md`" Gates 1–3 AND "the codexu repo's `plans/codexu-roadmap.md`", the procedural cadence note, the W-5 non-preemption sentence, and the RPC-versioning-out-of-scope sentence. Verify each phrase by grep (see plan §"Acceptance Criteria — US-001" for exact patterns).
- [ ] `codex/docs/implementation/patch-surface.md` has a new section `## 17. Upcoming roadmap-owned seams` inserted between the close of §16 and the duplicate-§11 appendix (~L971). Verify: `grep -c "17\. Upcoming roadmap-owned seams" patch-surface.md` = exactly 1; `grep -n "^## " patch-surface.md` shows the sequence `16. Plugin .mcp.json … → 17. Upcoming roadmap-owned seams → 11. TUI input latency …`.
- [ ] §17 contains an "advisory only" header note, a compact 3-row table covering plugin scoping (Phase 2c), AskUserQuestion (Phase 2d), Claude-via-Copilot adapter (Phase 7) — each tagged "Upcoming" — and a closing sentence about §14/§15 registration.
- [ ] `codex/CLAUDE.md` §"Consumer: codexu" gains exactly one new paragraph mentioning Phase 1a, `docs/implementation/architecture.md` §"Fork strategy", "the codexu repo's `plans/codexu-roadmap.md` §'Decisions made'", and "Gates 1–3".
- [ ] `codex/CLAUDE.md` §"Core engineering tenants" is BYTE-IDENTICAL to `origin/main`. Verify: `git -C <codex-worktree> diff origin/main -- CLAUDE.md` shows no hunks inside that section.
- [ ] Cross-references use prose pointers, NOT Markdown links into `codexu/*`. Verify: `grep -n "\[.*\](codexu/" architecture.md patch-surface.md CLAUDE.md` returns 0 matches.
- [ ] No content under `codex/external/repos/codex-patched/`, `codex/codex-rs-overlay/`, or `codex/AGENTS.override.md` is modified. Verify: `git -C <codex-worktree> diff --stat origin/main` shows EXACTLY 3 files: `docs/implementation/architecture.md`, `docs/implementation/patch-surface.md`, `CLAUDE.md`.
- [ ] Operator-review artifact written to `<job_dir>/operator-review-diff.txt` containing: `git diff --stat origin/main`, full `git diff origin/main` for each of the 3 files, the proposed commit message, and the proposed disposition for codexu-roadmap §"Decisions still open #1".
- [ ] Single commit on `1a-fork-doc-strategy` with subject `docs(fork-strategy): Phase 1a — lock subtree-mirror + overlay-crates layout`. Verify: `git -C <codex-worktree> show --stat HEAD` lists exactly the 3 expected paths.
- [ ] No new Rust source, scripts, or test files appear in the diff.

### US-002: Push + codexu pointer bump + roadmap decision (operator-gated)

**Description:** As the codexu operator, I want to gate the push to `gim-home/codex` and the parent-repo pointer bump so remote state changes only with explicit approval, and so the codexu pointer-bump commit is isolated from the unrelated dirty paths in the main codexu working tree.

**Acceptance Criteria:**
- [ ] Topic branch `1a-fork-doc-strategy` is pushed/PR'd to `gim-home/codex` per operator choice at step 8 (PR via `gh pr create --base main`, or direct fast-forward push).
- [ ] **Hard gate before pointer bump:** `git -C <codex-worktree> fetch origin && git -C <codex-worktree> merge-base --is-ancestor <commit-sha-from-US-001> origin/main` returns exit 0. Pointer bump does NOT proceed until this passes.
- [ ] Codexu pointer-bump worktree exists at `D:/harness-efforts/codexu/.ralph/jobs/1a-fork-doc/codexu-pointer-worktree/` on a clean `main` checkout, branch `1a-fork-doc-pointer-bump`.
- [ ] In that worktree, `git diff --cached --stat` shows EXACTLY 2 paths staged — `codex` (gitlink, new SHA = US-001 commit SHA) and `plans/codexu-roadmap.md`. No other paths.
- [ ] `plans/codexu-roadmap.md` §"Decisions made" gains a new dated entry (2026-05-13) for "Phase 1a — codex fork-layout strategy" that names: subtree mirror at `codex/external/repos/codex-patched/`, Rust workspace at `codex-rs/`, overlay crates at `codex/codex-rs-overlay/` (with precedents named), submodule pointer to `gim-home/codex`, procedural-only cadence policy, open W-5 RFC remaining open, RPC versioning out-of-scope, and the three new doc anchors.
- [ ] `plans/codexu-roadmap.md` §"Decisions still open #1" gains a forward-pointer line `**RESOLVED 2026-05-13** — see §'Decisions made' entry…` at the top; original entry text preserved unchanged below.
- [ ] Pointer-bump commit on codexu has subject `docs(roadmap): Phase 1a — record codex fork strategy + bump submodule pointer` and `git show --stat HEAD` lists EXACTLY 2 paths.
- [ ] Topic branch `1a-fork-doc-pointer-bump` is pushed/PR'd to codexu per operator choice at step 13.
- [ ] Both worktrees removed via `git worktree remove`, OR explicitly retained per ralph job policy. Topic branches may be deleted locally.

## 4. Functional Requirements

- **FR-1:** A `git worktree add` MUST be performed from inside the codex submodule's git context (metadata at `D:/harness-efforts/codexu/.git/modules/codex`) to create `D:/harness-efforts/codexu/.ralph/jobs/1a-fork-doc/codex-worktree/` on a new branch `1a-fork-doc-strategy` rooted at `origin/main` of `gim-home/codex`.
- **FR-2:** The system MUST edit `codex/docs/implementation/architecture.md` to (a) add a TOC entry "Fork strategy" between existing "Solution" and "Traffic flow" entries (L13-22 range), and (b) insert a new `## Fork strategy` top-level section at the corresponding body position.
- **FR-3:** The `## Fork strategy` body MUST contain a conditional opening line, an inner-layer description of the subtree mirror, an overlay-crates paragraph naming the three precedent crates, a placement-ranking pointer to CLAUDE.md tenets (NOT a duplicate of the tenets), prose cross-references to both codexu-side strategy docs, a procedural cadence note (no fixed frequency), a W-5 non-preemption sentence, and an RPC-versioning-out-of-scope sentence.
- **FR-4:** The system MUST insert a new `## 17. Upcoming roadmap-owned seams` section in `codex/docs/implementation/patch-surface.md` immediately after the close of `## 16. Plugin .mcp.json placeholder substitution` (~L968) and BEFORE the appendix sections starting with the duplicate `## 11. TUI input latency …` (~L971).
- **FR-5:** §17 MUST contain an "advisory only" header note, a 3-row table with columns `Patch | Codexu phase | Default placement | Status | Notes` (rows for plugin scoping/Phase 2c, AskUserQuestion/Phase 2d, Claude-via-Copilot/Phase 7), and a closing sentence describing the §14/§15 registration requirement.
- **FR-6:** The system MUST append exactly one paragraph to `codex/CLAUDE.md` §"Consumer: codexu" (~L25-31). The paragraph MUST mention Phase 1a (dated 2026-05-13), the architecture §"Fork strategy" anchor, the codexu roadmap §"Decisions made" anchor, and Gates 1–3.
- **FR-7:** The system MUST NOT modify the §"Core engineering tenants" section of `codex/CLAUDE.md`. Verification: `git diff origin/main -- CLAUDE.md` shows zero hunks intersecting that section.
- **FR-8:** All cross-repo references (codex → codexu) MUST use prose pointers (e.g., "the codexu repo's `docs/plans/codex-fork-extension-strategy.md`"). The system MUST NOT introduce Markdown link syntax pointing at `codexu/*` paths.
- **FR-9:** Before creating the codex commit, the system MUST write a diff artifact to `<job_dir>/operator-review-diff.txt` containing `git diff --stat origin/main`, the full per-file `git diff origin/main`, the proposed commit message, and the proposed disposition for `Decisions still open #1`.
- **FR-10:** The system MUST create a single commit on `1a-fork-doc-strategy` with subject `docs(fork-strategy): Phase 1a — lock subtree-mirror + overlay-crates layout`. `git show --stat HEAD` MUST list exactly three paths: `docs/implementation/architecture.md`, `docs/implementation/patch-surface.md`, `CLAUDE.md`.
- **FR-11:** The system MUST halt before pushing the codex commit and surface two operator-choice push options: (a) `gh pr create --base main` against `gim-home/codex` then wait for merge; (b) direct push to `main` (fast-forward).
- **FR-12:** Before the codexu pointer bump, the system MUST verify `git -C <codex-worktree> fetch origin && git merge-base --is-ancestor <commit-sha> origin/main` returns exit 0. If it does not, the system MUST halt and wait.
- **FR-13:** The system MUST create a *clean* second worktree at `D:/harness-efforts/codexu/.ralph/jobs/1a-fork-doc/codexu-pointer-worktree/` on branch `1a-fork-doc-pointer-bump` rooted at codexu's `main`. The pointer bump and the roadmap edit MUST happen ONLY in this clean worktree (NOT in `D:/harness-efforts/codexu/` directly, which has unrelated dirty paths).
- **FR-14:** In the clean worktree, the system MUST update the codex submodule pointer to the SHA from FR-10 via `git -C <worktree>/codex fetch origin && git -C <worktree>/codex checkout <sha>`.
- **FR-15:** In the clean worktree, the system MUST add a new dated entry (2026-05-13) at the bottom of §"Decisions made" in `plans/codexu-roadmap.md` describing the locked strategy. The entry MUST name: the subtree mirror path, the Rust workspace path, the overlay-crates directory and the three precedent crate names, the submodule pointer to `gim-home/codex`, the procedural-cadence-only policy, the open W-5 RFC, the RPC-versioning out-of-scope statement, and the three new codex doc anchors.
- **FR-16:** In the clean worktree, the system MUST prepend a `**RESOLVED 2026-05-13**` forward-pointer line to §"Decisions still open #1" and preserve the original entry text unchanged below.
- **FR-17:** The system MUST verify `git diff --cached --stat` shows exactly 2 staged paths (`codex` gitlink + `plans/codexu-roadmap.md`) before committing.
- **FR-18:** The system MUST commit on `1a-fork-doc-pointer-bump` with subject `docs(roadmap): Phase 1a — record codex fork strategy + bump submodule pointer`. `git show --stat HEAD` MUST list exactly two paths.
- **FR-19:** The system MUST halt and surface the codexu commit + diff for operator approval before any push.
- **FR-20:** After both pushes land, the system MUST run `git worktree remove` against both worktree paths (or explicitly retain them per ralph job policy).

## 5. Non-Goals (Out of Scope)

- Any code change (Rust, scripts, configs).
- Any test addition or test infrastructure change.
- Editing `codex/external/repos/codex-patched/**` (upstream subtree mirror).
- Editing `codex/codex-rs-overlay/**` (overlay crates).
- Editing `codex/AGENTS.override.md` (tenets source of truth).
- Editing the §"Core engineering tenants" section of `codex/CLAUDE.md` (mirrors AGENTS.override.md).
- Resolving the open W-5 RFC at `codex/docs/plans/reduce-conflict-surface.md` (subtree→submodule conversion for inner layer).
- Locking a fixed cadence frequency for subtree pulls — procedural shape only.
- RPC contract versioning (mentioned in codexu Phase 1a as future work; deferred).
- Migrating `codexu/docs/plans/codex-fork-extension-strategy.md` content into the codex submodule — it stays codexu-side and codex docs only reference it.
- Adding §14 invariant rows or §15 rebase-replant entries for the three Phase 2c/2d/7 patches listed in §17 — those land in their respective implementation PRs.
- Staging any unrelated dirty paths from the main codexu working tree (`packages/happy-agent/dist/*`, etc.) into the pointer-bump commit.
- Deciding the canonical between `AGENTS.override.md` and `CLAUDE.md` for tenets — a separate doc-consistency PR.

## 6. Design Considerations

- All edits are prose Markdown. No new components, no styling.
- §17 in `patch-surface.md` is intentionally lightweight (header note + 3-row table + closing sentence) to preserve §14's "shipped-invariants registry" semantics. Copilot reviewer raised a high-severity registry-pollution concern; the mitigation is the explicit "advisory only" framing and keeping §17 compact.
- The architecture.md "Fork strategy" section is placed as a peer-level top-level heading (between Solution and Traffic flow), NOT a subsection of Solution. Architect + Codex agreed fork strategy is foundational architectural context deserving peer-level emphasis.
- Cross-references between repos use prose pointers because Markdown links resolve only when both repos are colocated; the codex repo is also used standalone.

## 7. Technical Considerations

**Assumptions made in autonomous mode (re-surface to operator at step 6 if any look wrong):**
- Default for `Decisions still open #1` disposition: keep original entry, prepend forward-pointer line. Alternative (strikethrough/delete) was considered and rejected for history preservation.
- Default for subtree pull cadence: procedural shape only (stable tag + lag-check + operator-gated frequency). No fixed frequency locked.
- Default for push approach: deferred to operator at steps 8 and 13. Plan does NOT prescribe PR vs fast-forward.

**Worktree topology (critical):**
- The codex submodule's git metadata lives at `D:/harness-efforts/codexu/.git/modules/codex`. `git worktree add` from within the codex submodule's git context handles this correctly.
- The main codexu working tree at `D:/harness-efforts/codexu/` is currently dirty (`codex` pointer, `plans/codexu-roadmap.md`, `packages/happy-agent/dist/*`). The clean US-002 worktree sidesteps this entirely.

**Pre-flight check:**
- Run `git -C D:/harness-efforts/codexu status` before starting and confirm none of the existing dirty paths conflict with this plan's scope. If conflicts exist, halt and surface to operator.

**Precise insertion-point in patch-surface.md (~1150 lines):**
- After `## 16. Plugin \`.mcp.json\` placeholder substitution` close (~L968).
- BEFORE the appendix that begins with the duplicate `## 11. TUI input latency …` (~L971), then continues with `## Conflict-resolution guide for upstream rebase` (~L1008) and `## Security Posture` (~L1133).

**TOC update in architecture.md:**
- TOC lives at L13-22. New "Fork strategy" entry goes between existing "Solution" and "Traffic flow" entries. Verifier: `grep -n "Fork strategy" architecture.md` returns ≥ 2 lines.

**Cross-references to validate exist (do NOT modify these files):**
- `codex/AGENTS.override.md` — tenets source of truth.
- `codex/docs/plans/reduce-conflict-surface.md` — open W-5 RFC.
- `codex/docs/plans/codex-source-patching.md` — historical context.
- `codex/docs/implementation/regression-history.md` — cited for "Silent-drop patches recovered" reference in §17 closing sentence.
- `codex/scripts/check_subtree_lag.sh` — referenced from `## Fork strategy`.
- `codexu/docs/plans/codex-fork-extension-strategy.md` — consumer contract (Gates 1–3).

## 8. Success Metrics

- A grep for "Fork strategy" across the three codex doc files returns hits in each, demonstrating coverage.
- A grep for "Phase 1a" across `codex/CLAUDE.md`, `codex/docs/implementation/architecture.md`, `codex/docs/implementation/patch-surface.md`, and `codexu/plans/codexu-roadmap.md` confirms the decision is cross-linked from all four canonical entry points.
- A future agent landing in either repo can navigate from any of those four files to the others via the documented prose pointers in zero or one hop.
- `git -C codex diff --stat origin/main` after US-001 lists exactly 3 paths (no scope creep).
- `git -C codexu show --stat HEAD` after US-002 lists exactly 2 paths (no unrelated dirty hunks).
- Both topic branches land via operator-approved paths and the codexu pointer bump references a SHA already on `gim-home/codex` `main` (the hard gate at FR-12 passes).

## 9. Open Questions

1. **Cadence frequency locking** — deferred. Revisit after the first real subtree pull on the locked-strategy infrastructure (likely after the first Phase 2c/2d patch lands).
2. **PR vs fast-forward on `gim-home/codex`** — operator picks at step 8.
3. **PR vs fast-forward on codexu** — operator picks at step 13.
4. **Keep or strikethrough `Decisions still open #1` original text** — default: keep with forward-pointer. Revisit at step 6 if operator wants it removed.
5. **AGENTS.override.md vs CLAUDE.md canonical for tenets** — explicitly out of scope for Phase 1a. Future doc-consistency PR.

## Source Plan

This PRD is derived from `D:/harness-efforts/codexu/.ralph/jobs/1a-fork-doc/plan.md`. The plan contains the full step-by-step procedure (steps 1–14), risk areas (10 items), operator-choice matrix, and detailed acceptance criteria. Implementers should treat the plan as the authoritative procedural reference; this PRD captures the contractual requirements and acceptance criteria in story form for the Ralph orchestration pipeline.
