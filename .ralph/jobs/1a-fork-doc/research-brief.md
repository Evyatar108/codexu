# Research brief — 1a-fork-doc (Phase 1a fork strategy commit)

## Researcher Findings (Explore agent)

**Target files exist and already partly cover this content:**
- `codex/CLAUDE.md` (149 lines): already has "Core engineering tenants" (lines 12-22) covering minimize-conflict-surface with explicit 3-tier placement preference, and references `patch-surface.md` §14/§15 + `codexu-roadmap.md` Phase 2 prerequisite. Already has "Consumer: codexu" pointer (lines 25-31). Already has "Subtree Cadence And Sibling Crates" (lines 106-112). **The new content should be additive — do not duplicate.**
- `codex/docs/implementation/architecture.md` (161 lines): has NO dedicated "Fork strategy" section. Currently focused on transport + security + launcher + distribution. Safe to add new top-level section.
- `codex/docs/implementation/patch-surface.md` (~1150 lines): §14 = invariant-to-test mapping (20 shipped invariants); §15 = subtree lag check + tag-pinning policy; §16 = plugin `.mcp.json` placeholder substitution. NO existing "upcoming patches" section.

**Other relevant files (read-only, do not edit):**
- `codex/AGENTS.override.md`: §"Core engineering tenants" is IDENTICAL to CLAUDE.md §12-22. AGENTS.override.md is plausibly the source of truth; CLAUDE.md mirrors.
- `codex/codex-rs-overlay/`: contains the three overlay crates the PRD cites (`codex-copilot`, `codex-copilot-launcher`, `codex-invariant-tests`). Working precedent confirmed.
- `codex/external/repos/codex-patched/`: git-subtree mirror root. Confirmed via subtree commit footer.
- `codex/.gitmodules` / codexu `.gitmodules`: submodule pointer is `gim-home/codex` (HTTPS).
- `codex/scripts/check_subtree_lag.sh`, `audit_invariants.sh`, `audit_network_calls.sh`: all exist; referenced by patch-surface.md.

**Codexu-side strategy doc assumptions** (`codexu/docs/plans/codex-fork-extension-strategy.md`) that the new codex docs MUST NOT invalidate:
1. Overlay-first design (Gate 1 — codex-rs-overlay/ is the default placement)
2. Subtree edits require upstream churn data (Gate 2 — <2 commits/month threshold)
3. Patch registration is load-bearing (Gate 3 — SANDBOX PATCH markers + §14/§15 entries + invariant tests)
4. Working precedents are `codex-copilot-launcher`, `codex-copilot`, `codex-invariant-tests`
5. Distribution-fragmentation question (`@openai/codex` vs `@gim-home/codex`) remains open

## Architect Analysis

**Three operator-facing choices identified:**

**Choice A — architecture.md placement of "Fork strategy" section:**
- A1 (recommended by architect & codex CLI): new top-level §"Fork strategy" sibling, slotted after §"Solution" before §"Traffic flow"
- A2: subsection under §"Solution"

**Choice B — patch-surface.md schema for upcoming Phase 2c/2d/7 patches:**
- B1 (architect): extend §14 invariant table with a Status column (active/upcoming) and add 3 rows
- B2 (codex CLI + copilot): new clearly-labeled "Upcoming roadmap-owned seams" or "Planned fork extensions" subsection (e.g., a new §17) keeping §14 as the shipped-invariants registry

**Choice C — subtree pull cadence policy:**
- C1 (architect): quarterly (1st Mon of Feb/May/Aug/Nov)
- C2: per-upstream-stable-release
- C3: opportunistic (Phase-driven only)
- C4 (implicit from codex CLI): defer fixed cadence; document only the procedural shape (stable tag, lag-check, operator-gated)

**Risks called out:**
1. Silent contradiction between codex-side and codexu-side docs if Gates 1-3 evolve in one but not the other → mitigation: explicit "authoritative source" assertion
2. Future Phase 2c/2d/7 patches landing without registering in §14/§15 → mitigation: PRD explicit on co-PR rule
3. RPC contract version mentioned in roadmap Phase 1a is NOT in this commit's scope — doc must say "this commit locks layout/cadence, NOT versioning"

## Codex Research

**Critical accuracy point:** Subtree ROOT is `external/repos/codex-patched/`, NOT `codex-rs/`. `codex-rs/` is the Rust workspace inside the subtree. PRD's wording must be tightened — say "codex-rs/ is the Rust workspace inside the subtree mirrored at external/repos/codex-patched/".

**Workspace-reference detail:** subtree workspace at `external/repos/codex-patched/codex-rs/Cargo.toml` references overlay crates via relative paths like `../../../../codex-rs-overlay/codex-copilot`. This is the literal Cargo binding.

**Constraint flagged:** codexu worktree is currently dirty (M codex, M packages/happy-agent/dist/*). Implementer must NOT overwrite unrelated existing changes when bumping submodule pointer.

**Suggested wording option for operator surfacing:**
1. Strict: subtree root = `external/repos/codex-patched/`
2. Loose: roadmap's existing phrasing treats `external/repos/codex-patched/codex-rs/` as the practical Rust patch surface

Codex recommends Option 1 (strict) for these docs since they're meant to be canonical.

## Copilot Research

**Critical framing point:** Codex repo is ALSO used standalone (not always via codexu submodule). Its own docs assume standalone usage. The new "Fork strategy" content should use CONDITIONAL language: "When consumed by codexu, codex/ is a git submodule of codexu pinned to gim-home/codex..." — NOT unconditionally state that codex IS a submodule.

**Open RFC must not be preempted:** `codex/docs/plans/reduce-conflict-surface.md` W-5 contains an active future proposal to convert `external/repos/codex-patched/` from a git SUBTREE to a git SUBMODULE. The new docs must:
- Document current reality (subtree, today)
- NOT close the W-5 RFC by accident
- Explicitly say "current strategy" / "today's layout"

**Two-layer relationship to keep separate:**
- Outer layer: codexu → codex (submodule, gim-home/codex)
- Inner layer: codex → openai/codex (subtree, today — W-5 open)

**Patch-surface.md framing:** patch-surface.md is "the authoritative reference for every change we carry." Planned/upcoming work should be in a clearly labeled separate subsection ("Upcoming roadmap-owned seams" / "Planned fork extensions"), NOT mixed into §1-§16 shipped tables.

**CLAUDE.md edit guidance:** "small top-of-file pointer, not a rewrite" — the file already has the pointer and the tenet. Make it Phase-1a-aware (mention this commit locks the strategy) without duplicating policy text.

## Consolidated File List

**Files to modify (inside codex submodule worktree):**
- `codex/docs/implementation/architecture.md` (new top-level §"Fork strategy")
- `codex/docs/implementation/patch-surface.md` (new "Upcoming roadmap-owned seams" subsection, likely §17)
- `codex/CLAUDE.md` (small additive pointer linking Phase 1a + minimize-conflict-surface tenet to roadmap)

**File to modify in codexu (separate commit on codexu main):**
- `plans/codexu-roadmap.md` (add "Decision made" entry locking the strategy; flag codex submodule pointer bump in same commit)

**Read-only references (do NOT edit):**
- `codex/AGENTS.override.md` (tenets source of truth — mirror, don't duplicate)
- `codex/docs/plans/reduce-conflict-surface.md` (open W-5 RFC about subtree→submodule)
- `codex/docs/README.md`, `codex/.claude/commands/sync-upstream.md`, `codex/.claude/commands/rebase-upstream.md`
- `codex/plans/codex-source-patching.md` (historical context)
- `codex/docs/implementation/regression-history.md`
- `codex/scripts/check_subtree_lag.sh`, `audit_invariants.sh`, `audit_network_calls.sh`
- `codexu/docs/plans/codex-fork-extension-strategy.md` (consumer-side gates)
- `codexu/plans/codexu-roadmap.md` §"Phase 1a", §"Codex changes — minimize upstream conflict surface", §"Decisions still open #1", §"Decisions made"

**Workflow files referenced (the worktree workflow itself):**
- New worktree at `.ralph/jobs/1a-fork-doc/codex-worktree/` (off gim-home/codex main)
- Topic branch in codex submodule (e.g., `1a-fork-doc-strategy`)
- Push to gim-home/codex
- Separate commit on codexu main bumping submodule pointer + roadmap entry
