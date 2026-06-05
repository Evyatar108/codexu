# Stories Outline: Codex marketplace-index policy schema guard (D-001)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*
*All stories are in the `ai-developer-toolkit` repo — ZERO edits under `codex/`. Operator dropped codex-side directions D-002/D-003/D-004.*

## US-001: Validator module + CLI
**Description:** As a toolkit maintainer, I want a single dependency-free Node validator that checks every marketplace-index entry's `policy` enum values against codex's accepted enum sets, so a bad value can be caught before release.
**Files:** `ai-developer-toolkit/tools/validate-codex-marketplace-policy.mjs`
**Acceptance Criteria:**
- [ ] Exports one frozen single-source-of-truth constant `CODEX_MARKETPLACE_POLICY_ENUMS` with `installation: [NOT_AVAILABLE, AVAILABLE, INSTALLED_BY_DEFAULT]` and `authentication: [ON_INSTALL, ON_USE]`, preceded by a comment citing `codex/external/repos/codex-patched/codex-rs/core-plugins/src/marketplace.rs` (~L90-108) as the coupling source.
- [ ] Exposes a validation function (per-file + multi-file) and a CLI entry runnable directly: `node tools/validate-codex-marketplace-policy.mjs <files...>`, defaulting to the three indexes.
- [ ] A **missing** `policy` object, or a present `policy` object missing an individual field, is VALID (mirrors codex `#[serde(default)]`); the two policy-free indexes pass.
- [ ] A `policy` PRESENT but not a plain object (`null`/`[]`/`"OFF"`/number) is a violation.
- [ ] A present `installation`/`authentication` that is non-string or out-of-set is a violation; the message names the plugin id, field path `plugins[<name>].policy.<field>` (falling back to `plugins[<index>]` when `name` is absent), the bad value, and the accepted set — matching codex CLI clarity.
- [ ] All violations are collected and printed (not just the first); exit `1` if any, else `0`.
- [ ] Malformed/unparseable JSON or a missing file path fails with a non-zero exit and a message distinct from a policy violation.
- [ ] Running against the real three indexes from the toolkit repo root exits `0` today.
- [ ] Windows-safe (`node:fs` + `node:path`, no POSIX-separator assumptions); reads `tools/AGENTS.md` before adding the file.
- [ ] Typecheck/lint (if any) passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Fixtures + self-running test
**Description:** As a toolkit maintainer, I want valid + invalid fixtures and a plain-Node self-test, so the guard's fail/pass behavior is provable without a test framework.
**Files:** `ai-developer-toolkit/tools/fixtures/marketplace-policy-valid.json`, `ai-developer-toolkit/tools/fixtures/marketplace-policy-invalid-auth-off.json`, `ai-developer-toolkit/tools/fixtures/marketplace-policy-invalid-installation.json`, `ai-developer-toolkit/tools/validate-codex-marketplace-policy.test.mjs`
**Acceptance Criteria:**
- [ ] Invalid auth fixture (`authentication: "OFF"`) → CLI exits non-zero + message contains the plugin id, `policy.authentication`, `OFF`, and the accepted set.
- [ ] Invalid installation fixture (out-of-set `installation`) → CLI exits non-zero + installation accepted set in message.
- [ ] A non-object `policy` case → CLI exits non-zero naming the plugin.
- [ ] An entry with a bad value but no `name` → field path uses `plugins[<index>]`.
- [ ] Malformed-JSON case → non-zero, distinct-from-violation message.
- [ ] Valid fixture → CLI exits 0.
- [ ] BOTH policy-free indexes (`.claude-plugin/marketplace.json` AND `.github/plugin/marketplace.json`) → exit 0.
- [ ] Non-brittle smoke against the real `.agents/plugins/marketplace.json` → exit 0, asserting set-membership of every present policy value (NOT a hardcoded entry count, NOT assuming `ON_INSTALL` specifically).
- [ ] `node tools/validate-codex-marketplace-policy.test.mjs` runs with a bare `node` invocation (no framework, no `package.json`) and exits non-zero if any assertion fails.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Release-plugin Pre-flight wiring + docs
**Description:** As a toolkit maintainer, I want the release flow to block on invalid policy values and the docs to reference the guard, so a bad value can never ship through a release.
**Files:** `ai-developer-toolkit/.claude/skills/release-plugin/SKILL.md`, `ai-developer-toolkit/AGENTS.md`, `ai-developer-toolkit/docs/codex-plugins-local.md`
**Acceptance Criteria:**
- [ ] `release-plugin/SKILL.md` Pre-flight adds a step (after "confirm plugin exists in all three indexes", before any version-file edits) that runs `node tools/validate-codex-marketplace-policy.mjs .agents/plugins/marketplace.json .claude-plugin/marketplace.json .github/plugin/marketplace.json` from the repo root and **aborts the release on non-zero exit**.
- [ ] The SKILL.md line ~191 "It does not run tests" wording is reconciled (clarify it runs a fast schema *guard*, not the plugin test suite).
- [ ] Root `AGENTS.md` "keep the marketplace indexes in sync" section references the new guard + that release-plugin enforces it.
- [ ] `docs/codex-plugins-local.md` documents the policy-value guard and the `marketplace.rs` coupling.
**Dependencies:** US-001
**Estimated complexity:** small

## Ship step (lead/bookkeeper — not a story)
After US-001..US-003 land as a commit inside the `ai-developer-toolkit/` submodule, codexu records the updated `ai-developer-toolkit` submodule pointer as a **separate codexu commit** (two-commit submodule flow per codexu `AGENTS.md`). No unrelated parent changes staged.
