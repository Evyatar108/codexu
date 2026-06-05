# Research Brief — codex-marketplace-parse-robustness (D-001, toolkit-only)

## Researcher Findings (Explore agent)
- **Three indexes** (in `ai-developer-toolkit/`):
  - `.agents/plugins/marketplace.json:1-181` — codex index. Entry shape: `name`,
    `source:{source,path}`, `policy:{installation,authentication}`, `category`, optional `version`.
    **Today all 14 entries are `installation: AVAILABLE` + `authentication: ON_INSTALL`** (no bad
    values currently shipped).
  - `.claude-plugin/marketplace.json:1-95` — minimal: `name`, `source`, `description`, `version`. No `policy`.
  - `.github/plugin/marketplace.json:1-95` — same minimal shape. No `policy`.
  - `.github/` contains only `acl/`, `copilot/`, `plugin/` — **no `.github/workflows/` (no CI)**.
- **Release gate:** `.claude/skills/release-plugin/SKILL.md:35-75`. Pre-flight = 3 steps:
  (1) clean-tree check for the 4 version files, (2) monotonic semver check, (3) confirm plugin
  exists in all 3 indexes via `jq`. Step 2 bumps all three indexes with `jq`. SKILL.md:191 states
  "It does not run tests."
- **Test convention:** plain Node, NO framework. `plugins/crews/tests/run.js` is a worker-thread
  runner discovering `*.test.js`. Sample `plugins/crews/tests/actor-state-helpers.test.js` uses
  `require('./lib/assert')` local helpers. Fixtures in `plugins/crews/tests/fixtures/`. No root or
  per-plugin `package.json` (`plugins/crews/AGENTS.md` confirms JS-only).
- **No existing marketplace validator** anywhere in the toolkit; release automation is version-bump only.
- **AGENTS sync rules:** root `AGENTS.md` + `.claude-plugin/AGENTS.md:1-14` + `.github/plugin/AGENTS.md:1-14`
  all mandate keeping the 3 indexes in sync (same entries/paths/versions).

## Architect Analysis (Explore agent)
- Recommends BOTH placements sharing ONE engine: (a) release-plugin Pre-flight wiring (the only real
  gate, since the skill is instruction-only it needs a script for teeth) + (b) standalone
  dependency-free Node module reusable from skill / future CI / manual runs.
- Module API: `INSTALLATION_VALUES`, `AUTHENTICATION_VALUES`, `validateMarketplaceIndex(filePath)`,
  per-entry validator; exit 0 pass / 1 on first violation; stderr message
  `plugins[<name>].policy.authentication: unknown variant OFF, expected ON_INSTALL or ON_USE`.
- SoT enum constants frozen in the module with a comment pointing at `marketplace.rs:90-108`.
- Edge cases: missing `policy` object = VALID (do not flag); non-string value = invalid; policy-free
  indexes pass; cross-index drift OUT of scope; use `path.resolve`/`fs` (Windows-safe); smoke against
  the REAL `.agents/plugins/marketplace.json` (expect pass, 14 entries).
- **Placement caveat (planner judgement):** both Explore agents suggested nesting under
  `plugins/crews/` purely to reuse `run.js`. REJECTED in the plan — a repo-wide release gate must not
  live inside an unrelated plugin. A repo-level self-running `.test.mjs` needs no external runner.

## Codex Research (gpt-5.5, xhigh)
- Independently recommends a **repo-level `tools/` home** (decoupled, dependency-free ESM):
  - `tools/validate-codex-marketplace-policy.mjs` (CLI, accepts file paths, defaults to the 3 indexes)
  - `tools/validate-codex-marketplace-policy.test.mjs` (self-running test)
  - `tools/fixtures/marketplace-policy-valid.json`
  - `tools/fixtures/marketplace-policy-invalid-auth-off.json`
- Single exported constant with `marketplace.rs` coupling comment directly above:
  ```js
  export const CODEX_MARKETPLACE_POLICY_ENUMS = {
    installation: ['NOT_AVAILABLE', 'AVAILABLE', 'INSTALLED_BY_DEFAULT'],
    authentication: ['ON_INSTALL', 'ON_USE'],
  };
  ```
- Multi-file CLI: treat missing `policy` as acceptable for policy-free indexes; enforce allowed
  values when policy is present / when validating the codex index. Error message includes plugin
  name, field path `plugins[crews].policy.authentication`, bad value, accepted values.
- Wire into `release-plugin` Pre-flight AFTER "confirm in all three indexes", BEFORE any edits.
- **Caught:** `release-plugin SKILL.md:191` "does not run tests" wording needs reconciling;
  `docs/codex-plugins-local.md:16` documents the codex index and should be updated; `.agents/plugins/`
  has no local `AGENTS.md` (add a short one OR keep notes in root docs to minimize new files).

## Copilot Research
- Still running past its window at draft time; non-blocking per skill. Not folded in. (Will be
  appended if it lands before finalize.)

## Consolidated File List
### Files to MODIFY
- `ai-developer-toolkit/.claude/skills/release-plugin/SKILL.md` — add Pre-flight validation step;
  reconcile the "does not run tests" line (191).
- `ai-developer-toolkit/AGENTS.md` — note the new guard in the "keep indexes in sync" section.
- `ai-developer-toolkit/docs/codex-plugins-local.md` — document the policy-value guard.
### Files to CREATE (recommended repo-level `tools/` home)
- `ai-developer-toolkit/tools/validate-codex-marketplace-policy.mjs` (CLI + SoT enums + engine)
- `ai-developer-toolkit/tools/validate-codex-marketplace-policy.test.mjs` (self-running test)
- `ai-developer-toolkit/tools/fixtures/marketplace-policy-valid.json`
- `ai-developer-toolkit/tools/fixtures/marketplace-policy-invalid-auth-off.json`
### Reference (READ-ONLY, do NOT edit)
- `codex/external/repos/codex-patched/codex-rs/core-plugins/src/marketplace.rs:90-108` — enum SoT.
- `ai-developer-toolkit/.agents/plugins/marketplace.json` — real index (smoke target, 14 entries).
