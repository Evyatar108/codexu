---
overviewTaskId: codex-marketplace-parse-robustness
selectedDirection: D-001
selectedBy: operator
selectedAt: 2026-06-05
---

# Selected Direction: D-001 — Toolkit-side marketplace-index policy schema guard

## Direction

Implement **D-001 only** from the `codex-marketplace-parse-robustness` brainstorm: a
producer-side schema guard, living entirely in the `ai-developer-toolkit` repository, that
validates every marketplace-index plugin entry's `policy` enum values against codex's accepted
enum sets **before any plugin release ships**. This is the ZERO-codex-conflict-surface direction —
no edits to the `codex/` submodule whatsoever.

**Operator decision (2026-06-05):** do D-001 (toolkit guard); **DROP** all codex-side directions:
- D-002 (upstream/fork codex partial-parse) — dropped.
- D-003 (TUI add-error detail surfacing) — dropped.
- D-004 (tolerant `#[serde(other)]` enum) — dropped.

The codex-side robustness work was judged net-negative as a fork patch (3-lens + Devil's-Advocate
consensus, `red_flag = true`); it is worth pursuing only as an upstream contribution, which is out
of scope for this task.

### Why D-001

The 2026-06-05 incident root cause was **our own bad data**: a `policy.authentication: "OFF"` value
in `.agents/plugins/marketplace.json`. Codex's parser (`core-plugins/src/marketplace.rs:401`) does a
single all-or-nothing `serde_json::from_str::<RawMarketplaceManifest>`; the two policy enums
(`MarketplacePluginInstallPolicy`, `MarketplacePluginAuthPolicy`) use `#[serde(rename)]` with **no**
`#[serde(other)]`, so one unknown enum value aborts the ENTIRE index parse and every other valid
plugin becomes unavailable, surfaced only as the masked TUI message `Failed to add marketplace.`
A producer guard at the layer we own prevents recurrence with zero rebase cost.

## Goal

Make it **impossible to ship** a marketplace index whose `policy.installation` or
`policy.authentication` value is not one of codex's accepted enum variants — so the exact
2026-06-05 failure (`authentication: "OFF"` → codex serde abort → `Failed to add marketplace.`)
can never reach a release again.

Concretely, after this work exists:
- A validation step runs before any plugin release and **fails the release** if any marketplace
  index entry carries an out-of-set policy value, with a precise, actionable error message.
- The same validation logic is independently runnable as a standalone check (no release ceremony
  required), so it can also serve a future CI / pre-commit hook without rework.
- The accepted-enum sets live in exactly ONE place in the toolkit so a future codex enum change is a
  one-line update, with an explicit comment documenting the coupling to codex's `marketplace.rs`.

## Scope

### In scope (toolkit-only — `ai-developer-toolkit` repo)
- **Validation logic:** a single source of truth for codex's accepted policy enum sets —
  `installation ∈ {NOT_AVAILABLE, AVAILABLE, INSTALLED_BY_DEFAULT}`,
  `authentication ∈ {ON_INSTALL, ON_USE}` (verified from
  `codex/external/repos/codex-patched/codex-rs/core-plugins/src/marketplace.rs`,
  `MarketplacePluginInstallPolicy` ~lines 90–99 and `MarketplacePluginAuthPolicy` ~lines 101–108).
  Implemented as a small, dependency-free Node module (matching the repo's plain-Node convention —
  no test framework, no root `package.json`).
- **Validation behavior:** iterate every entry of the codex index
  (`.agents/plugins/marketplace.json`) and validate its `policy.installation` and
  `policy.authentication` values against the accepted sets. **Fail with a precise message** naming:
  the plugin id, the field path (e.g. `plugins[<name>].policy.authentication`), the bad value, and
  the accepted set — matching the clarity of the codex CLI's own
  `unknown variant OFF, expected ON_INSTALL or ON_USE`.
- **Tolerate the policy-free indexes:** `.claude-plugin/marketplace.json` and
  `.github/plugin/marketplace.json` use the minimal installer schema with NO `policy` object; the
  guard must validate the codex index's policy values and **not** error merely because the other two
  indexes omit policy. (Decide in the plan whether the guard also sanity-checks
  cross-index entry-name/version sync, or strictly limits itself to policy-value validation — keep
  the core deliverable focused on the policy-value bug.)
- **Placement (decide + specify in the plan, recommend one or both):**
  - (a) Integrate the check into the `release-plugin` skill's Pre-flight
    (`.claude/skills/release-plugin/SKILL.md`) so a release is **blocked** on invalid policy values.
    `release-plugin` is the single gate every version bump flows through today.
  - (b) A standalone validator (the Node module above) runnable manually / in a future CI /
    pre-commit hook. NOTE: the toolkit has **no existing CI workflow** today, so (a) is the
    enforcement teeth now and (b) is the reusable engine + future-CI seam.
- **Fixtures + self-test:** add an **invalid** fixture (a marketplace index with
  `authentication: "OFF"`) and a **valid** fixture; prove the guard FAILS on the bad one (non-zero
  exit + precise message) and PASSES on the good one. Use the repo's plain-Node `.js` test
  convention.
- **Docs:** note the coupling to codex's `marketplace.rs` enums at the single-source-of-truth
  constant, and update `release-plugin` SKILL.md (and the relevant `AGENTS.md` notes) to reference
  the new guard.

### Out of scope (explicitly dropped by operator)
- **D-002** — any codex-side partial-parse / skip-and-warn change (upstream OR fork). No edits to
  the `codex/` submodule.
- **D-003** — codex TUI add-error detail surfacing.
- **D-004** — tolerant `#[serde(other)]` enum on the codex policy enums.
- Robustness for **third-party** marketplaces a codex user might add (the guard only protects
  indexes WE own/publish). That gap is a codex-side concern, intentionally not addressed here.
- Any new test framework, root `package.json`, husky/pre-commit infra, or CI workflow scaffolding
  beyond making the validator CI-ready.

## Criteria

- [ ] A single toolkit-owned constant/module defines codex's accepted policy enum sets
      (`installation ∈ {NOT_AVAILABLE, AVAILABLE, INSTALLED_BY_DEFAULT}`,
      `authentication ∈ {ON_INSTALL, ON_USE}`) with a comment documenting the `marketplace.rs`
      coupling; changing the accepted sets is a one-line edit in ONE place.
- [ ] Running the validator against the current real `.agents/plugins/marketplace.json` **passes**
      (all 14 entries are `AVAILABLE` / `ON_INSTALL` today).
- [ ] Running the validator against an invalid fixture containing `authentication: "OFF"` **fails**
      with a non-zero exit and a message naming the plugin id, the field path, the bad value
      (`OFF`), and the accepted set (`ON_INSTALL`, `ON_USE`).
- [ ] Running the validator against a valid fixture **passes**.
- [ ] The validator does NOT error on `.claude-plugin/marketplace.json` or
      `.github/plugin/marketplace.json` lacking a `policy` object.
- [ ] The `release-plugin` Pre-flight invokes the guard and aborts the release on any invalid
      policy value (chosen placement (a)); the standalone-runnable engine (placement (b)) exists and
      is documented as the future CI / pre-commit seam.
- [ ] A plain-Node self-test (repo convention) exercises both the invalid and valid fixtures and is
      runnable without a test framework or root `package.json`.
- [ ] ZERO changes under `codex/`; the entire change set is inside `ai-developer-toolkit`.
- [ ] Relevant docs (`release-plugin` SKILL.md and/or marketplace-index `AGENTS.md` notes) updated to
      reference the guard.
