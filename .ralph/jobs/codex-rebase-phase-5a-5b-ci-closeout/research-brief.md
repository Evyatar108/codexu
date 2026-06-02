# Research Brief — codex-rebase-phase-5a-5b-ci-closeout

*Compiled from Phase 2 parallel research (researcher + architect explore agents). Codex/Copilot research subagents were skipped in Phase 2 (doc-only scope) but both were used as full plan reviewers in Phase 4.*

## Researcher Findings

### 1. `codex/.claude/commands/rebase-upstream.md`

- 30 KB, 332 lines. Numbered workflow `0..13`. Step **5** is the existing "Local `cargo check` loop" (lines 48-56), per-crate only. Step **6** commits + force-pushes sandbox-patches. Steps **9-13** are post-build audit/tag/publish/smoke.
- `## Build step` line 154 already carries the load-bearing policy `Do NOT run cargo test --workspace locally ... Use cargo check --workspace as the local gate ... rely on .github/workflows/invariant-check.yml ... for the full coverage signal`.
- `## Audit gate` (line 168) + `### Silent-drop checklist` (line 195) are existing post-build verification gates.
- Phase 5a/5b insertion point: after step 5 + before step 6 for the gate; wrapping steps 9-13 for CI closeout. No literal "Phase 5a"/"Phase 5b" heading in any codex-side doc yet.
- Sub-skill refs: links `publish-sandbox-patch.md`; sibling `sync-upstream.md` exists but no nested sub-skill tree.

### 2. `codex/CLAUDE.md` ↔ `codex/AGENTS.override.md` mirror

- Both files carry an identical `cargo test --workspace is for CI, not local iteration agents` bullet at lines 95-101 in `## Confusion points and common mistakes`. Phrasing: `cargo check --workspace (~6 min, the standard typecheck gate)`.
- Section style: `## Confusion points and common mistakes` H2 + dash bullets with `**bold lead-ins**`.
- **No drift on this topic**: AGENTS.override.md was specifically mirrored from CLAUDE.md by codex commit `aec77126d` to fix a one-side-only update bug.

### 3. Related command docs

- `publish-sandbox-patch.md` — references `cargo check -p codex-core` and release build; explicitly says audits are NOT part of the sandbox-patch flow. Push/publish flow commits inside submodule, then wrapper gitlink, then tag/push.
- `sync-upstream.md` — submodule update + audit only; no cargo gate.
- `docs/implementation/patch-surface.md` §15 — rebase-resume / upstream squash workflow includes per-crate `cargo check -p codex-core --lib` and replant notes.

### 4. Fork-level `AGENTS.md` cross-ref site

- `### Codex submodule build situation` block (lines 221-236 in worktree checkout) already references `cargo check --workspace` as "the standard Phase-5a typecheck gate per `codex/CLAUDE.md`" + workspace-parse preflight.
- `### Architectural-fix preference` block (lines 237-246) — separate concern; not a cross-ref candidate for this work.
- Style: `###` heading + short `- **bold lead-in**` bullets.

### 5. CI ground truth (`codex/.github/workflows/invariant-check.yml`)

- Matrix: `ubuntu-latest` + `windows-latest`, 6h timeout.
- Cargo invocation: `cargo test --workspace` from `external/repos/codex-patched/codex-rs`.
- Triggers: `push: branches: [main, codex-patched/**]` AND `pull_request: branches: [main, codex-patched/**]`.
- Checkout: `submodules: recursive` — wrapper-commit on `gim-home/codex@main` that bumps the submodule gitlink triggers CI that fetches the new sandbox-patches SHA and tests it. This is the canonical workspace-coverage gate.
- Force-push to `sandbox-patches` on `Evyatar108/codex-openai-fork` alone does NOT trigger invariant-check (different repo). That repo's `rust-ci` is PR-only; `rust-ci-full` triggers only on `push: main` or `**full-ci**` branches.

### 6. Ship/lesson artifacts

- `plans/codexu-roadmap.md` lines 181-182 — Ship #41 "codex-rebase-debt lesson" paragraph: *Future rebase policy: `cargo check --workspace` MUST run as a hard gate before sandbox-patches push. Split into "merge upstream (incomplete)" + "post-merge reconciliation (workspace green)" commits if needed.*
- `.ralph-overview/data.json` `escalate-gim-home-actions-policy` entry: `id`, `scope: "codex|ops"`, `lifecycle: "tracked"`, `status: "blocked"`, `lastTouchedAt`, `kanbanCards`, `command{name, descriptionHtml, warnings, prompts}`. `descriptionHtml` says org-level Actions policy blocks all workflow dispatches; `warnings[0]` documents operator-only fix at `https://github.com/organizations/gim-home/settings/actions`.
- `.ralph-overview/data.json` `codex-rebase-phase-5a-5b-ci-closeout` entry: `scope: "codex"`, `lifecycle: "tracked"`, `status: "ok"`, `warnings: []`, `command.prompts.plan` only (no `prompts.impl`).

### 7. Edit conventions

- Codexu wrapper commits: `chore(codex): bump pointer to <sha> (...)`. Doc-sync commits often pair with pointer bumps as separate codex submodule commits (`docs(AGENTS.override): mirror CLAUDE.md ...`).
- Inside codex submodule: `docs(AGENTS.override): ...`, `docs(CLAUDE): ...` patterns; docs usually committed before the wrapper pointer bump.
- No literal `Phase 5a` / `Phase 5b` heading in any codex-side doc as of HEAD — this plan introduces the terminology.

## Architect Analysis

### Integration points

- **Canonical source**: `codex/.claude/commands/rebase-upstream.md` — protocol body lives here.
- **Mirror pointers** (lockstep): `codex/CLAUDE.md` + `codex/AGENTS.override.md` at line ~101 in `## Confusion points and common mistakes`.
- **Codexu cross-ref**: `AGENTS.md` "Codex submodule build situation" block.
- **Task-state**: `.ralph-overview/data.json` task-entry warnings row + `escalate-gim-home-actions-policy` kanbanCards cross-link.
- **Post-ship only** (NOT in impl scope): `plans/codexu-roadmap.md` ship-log row by bookkeeper.

### Dependency order

1. `rebase-upstream.md` first (source of truth).
2. `CLAUDE.md` + `AGENTS.override.md` in the same codex commit.
3. Codexu-side `AGENTS.md` cross-ref + `.ralph-overview/data.json` warnings + regenerated sidecars + codex submodule pointer bump in the codexu commit.
4. Post-ship roadmap row by bookkeeper after merge.

### Technical constraints

- Two-repo edit boundary (codex submodule + codexu repo).
- Mirror lockstep on CLAUDE.md ↔ AGENTS.override.md edits.
- Org-policy block means Phase 5b "real CI green" unachievable today; interim-closeout path required with concrete sunset trigger.
- Split-commit fallback needs explicit force-push-with-lease commands AND a wrapper-side gitlink-target safety check (`(incomplete)` marker grep at bump time).

### Suggested implementation approach

- Single Ralph story (doc-only, tightly-coupled lockstep + canonical-source dependency).
- Autonomous mode; Phase 4 review IS worth running (load-bearing protocol).
- Working order: source-of-truth file first, mirror pointers second, codexu cross-ref + bookkeeping last.

### Risk areas

- Future rebase agents bypassing the gate even after it's documented (the previous rebase commit message documented the punt explicitly and shipped anyway — additional enforcement leverage via the wrapper-side gitlink safety check is the lightweight extra layer added in v2).
- CLAUDE.md ↔ AGENTS.override.md drift — explicit AC for byte-identical full-bullet diff.
- Org-policy unblock timing — concrete bookkeeper sunset checklist with `workflow_dispatch` command + amendment rule.
- One-sided codexu task-state updates — substring AC instead of count AC.

### Reuse opportunities

- Extend `rebase-upstream.md` rather than add a separate appendix (chosen approach).
- Reference existing `## Build step`, `## Audit gate`, `### Pre-tag runtime smoke` sections from Phase 5a/5b headers rather than restating their content (chosen approach; cross-references at top of each new section).

## Consolidated File List

### Files to modify (in impl scope)

- `codex/.claude/commands/rebase-upstream.md` — inline-amend step 5 + step 6; add `## Phase 5a` + `## Phase 5b` H2 sections.
- `codex/CLAUDE.md` — one bullet at `## Confusion points and common mistakes` line ~101.
- `codex/AGENTS.override.md` — byte-identical bullet at the same site.
- `D:/harness-efforts/codexu/AGENTS.md` — one bullet in `### Codex submodule build situation`.
- `D:/harness-efforts/codexu/.ralph-overview/data.json` — `codex-rebase-phase-5a-5b-ci-closeout.command.warnings[]` row + `lastTouchedAt`; `escalate-gim-home-actions-policy.kanbanCards[]` cross-link row.
- `D:/harness-efforts/codexu/.ralph-overview/generated/snapshot.json` (auto-regenerated by `node bin/ralph-overview.mjs sync`).

### Files NOT to touch (in impl scope)

- `plans/codexu-roadmap.md` (post-ship by bookkeeper).
- Anything matching `*.rs`, `*.toml`, `*.yml`, `*.yaml`, `*.sh`, `*.ps1`.
- Codexu root `CLAUDE.md` (gitignored).

### Bookkeeper pre-spawn (outside impl scope)

- Add `command.prompts.impl` seed to `.ralph-overview/data.json` for the task BEFORE spawning the impl member.

### CI infrastructure references (read-only for plan verification)

- `codex/.github/workflows/invariant-check.yml` (lines 3-7 triggers; lines 21-25 matrix; lines 123-139 cargo invocation).
- `escalate-gim-home-actions-policy` task in `.ralph-overview/data.json`.
