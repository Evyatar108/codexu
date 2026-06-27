# Stories Outline: Repo-aware multi-repo plan splitter for ralph-orchestration

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Implement as TWO Ralph jobs: Increment 1 (US-001..US-003 → ship v5.61.0 + dogfood), then Increment 2 (US-004..US-008 → ship v5.62.0). Target repo for code = the `ai-developer-toolkit` submodule (`plugins/ralph/`); worktree inside that submodule; two-commit submodule flow.*

## US-001: Scope validator CLI
**Description:** As a lead/scaffolder, I want a CLI that rejects a job seed whose writable scope spans more than one repo, so a mis-scoped multi-repo seed never reaches an impl member.
**Increment:** 1
**Acceptance Criteria:**
- [ ] `plugins/ralph/src/validate-prd-scope.mjs` (ESM, `main(argv)` + auto-run, exit `0` OK / `1` IO-error / `2` cross-repo write).
- [ ] PRIMARY input is a structured per-job `writeScope` (array of repo-rooted writable paths); the validator asserts every `writeScope` path resolves under the single `prd.json.repoDir`, and any other mapped repo appears only in `additionalDirs[]`.
- [ ] PRD/plan prose path-scan is a SECONDARY warning layer (heuristic; documented limits).
- [ ] Fixture: single-repo seed → exit 0; seed with a writeScope/story path under an `additionalDirs`-only repo → exit 2 with a diagnostic naming the path + repo; malformed/missing PRD → exit 1.
- [ ] `tests/test-validate-prd-scope.mjs` green via `node plugins/ralph/tests/run.mjs`.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Per-repo template + $namespaced spawn convention docs
**Description:** As a lead, I want a documented per-repo job template + spawn convention so manual multi-repo splits encode scope in the per-repo PRD (not prose prohibitions) and codex members load the skill body instead of hand-rolling.
**Increment:** 1
**Acceptance Criteria:**
- [ ] `plugins/ralph/docs/multi-repo-split.md` documents: the per-repo plan/PRD template (`--target-repo` + `--job-dir`, other repos as read-only `additionalDirs`), the exact MANUAL spawn convention `$ralph-orchestration:implement-with-ralph --from-plan <perRepoPlan> --target-repo <repo>`, and the `validate-prd-scope.mjs` step.
- [ ] `plugins/ralph/AGENTS.md` references the new doc.
- [ ] `plugins/ralph/skills/implement-with-ralph/SKILL.md` carries a one-line cross-ref (do NOT touch the L215-224 `--target-repo`×`--parallel` rejection).
- [ ] NO codexu wrapper edits in this story (those are lead-owned ship steps).
**Dependencies:** None
**Estimated complexity:** small

## US-003: Increment-1 mirrors + version bump
**Description:** As a maintainer, I want Increment 1 shipped as v5.61.0 with mirrors and stamps in sync.
**Increment:** 1
**Acceptance Criteria:**
- [ ] Regenerate copilot + codex mirrors for the SKILL.md cross-ref: `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --write`.
- [ ] `plugins/ralph/CHANGELOG.md` v5.61.0 entry.
- [ ] Six version stamps → 5.61.0.
- [ ] `generate-copilot-artifacts.mjs --check && check-copilot-parity.mjs` pass; Codex Release Gate passes.
**Dependencies:** US-001, US-002
**Estimated complexity:** small

## US-004: repo-map + ship-order-manifest schemas
**Description:** As a scaffolder, I want machine-readable input/output schemas so repo selection and ship order are explicit, never inferred from prose.
**Increment:** 2
**Acceptance Criteria:**
- [ ] `plugins/ralph/schemas/repo-map-schema.json`: `{ repos: {<name>:<abspath>}, assignments: [{ repo, baseBranch, stories[], writeScope[], shipOrder }] }`.
- [ ] `plugins/ralph/schemas/ship-order-manifest-schema.json`: jobs in dependency order with `{ repoName, repoDir, jobDir, runCommand, shipGate[] (ordered) }` + a top-level reference to the lead ceremony.
**Dependencies:** US-003
**Estimated complexity:** small

## US-005: Scaffolder CLI + thin skill
**Description:** As a lead, I want a CLI that splits one plan + repo-map into N scoped single-repo job seeds plus a ship-order manifest, so multi-repo plans run via the existing single-repo flow with no hand-roll.
**Increment:** 2
**Acceptance Criteria:**
- [ ] `plugins/ralph/src/scaffold-multi-repo-jobs.mjs` (load-bearing CLI). Per repo cluster: create worktree via `worktree-create.mjs --target-repo <repo> --start-point <baseBranch> --branch ralph/<plan>-<repo-slug>`; write scoped per-repo plan excerpt; `convert-to-ralph-prd --batch --target-repo <repo> --job-dir <central> --worktree-path <wt> --branch <br>`; POST-PROCESS the generated `prd.json` to inject `additionalDirs[]` (other repos) + structured `writeScope` (because `--batch` cannot set `additionalDirs`); run `validate-prd-scope.mjs` as a HARD gate.
- [ ] Emits `ship-order-manifest.json` (validates against schema) with each `runCommand` = `$ralph-orchestration:implement-with-ralph --run-only --job <jobDir> --autonomous` (NOT `--from-plan` — would overwrite the pre-seeded prd.json). Records manifest path in each seed's prd.json/notepad for discoverability.
- [ ] Thin `plugins/ralph/skills/scaffold-multi-repo-jobs/SKILL.md` wrapper over the CLI (cross-engine-clean prose; no `CODEX_FORBIDDEN` tokens).
- [ ] NO automated cross-repo push / pointer-bump / rollback (those appear only in manifest text).
**Dependencies:** US-004
**Estimated complexity:** large

## US-006: Codex nested-topology support
**Description:** As a codex impl member, I want the scaffolder to handle the nested codex two-repo case (inner `codex-patched` on `sandbox-patches` + wrapper on `main`) so the dominant real multi-repo case is supported end to end.
**Increment:** 2
**Acceptance Criteria:**
- [ ] Scaffolder honors per-assignment `baseBranch` via `--start-point` and arbitrary nesting depth.
- [ ] The manifest's inner-job `shipGate` encodes the EXACT ordered sequence: member inner-worktree push (`git push origin HEAD:sandbox-patches`) → inner SHA reachable on `sandbox-patches` → canonical inner FF → wrapper docs/gitlink commit on `main` → push wrapper remotes.
- [ ] Docs note that Phase 6 auto submodule-ship detection does NOT fire for a submodule-of-a-submodule, so the manifest is the source of truth for the nested case.
**Dependencies:** US-005
**Estimated complexity:** medium

## US-007: Scaffolder + validator + nested tests
**Description:** As a maintainer, I want fixture tests proving deterministic, safe generation.
**Increment:** 2
**Acceptance Criteria:**
- [ ] 2-repo split fixture → 2 valid scoped `prd.json` (correct `repoDir`, `additionalDirs`, `writeScope`) + a schema-valid manifest; each seed passes `validate-prd-scope.mjs`.
- [ ] Codex nested fixture (inner sandbox-patches + wrapper main) → correct per-repo `--start-point` + the ordered nested `shipGate`.
- [ ] Run command asserted to contain `--run-only --job` and NOT `--from-plan`.
- [ ] A `git push`/pointer-bump/rollback-absence assertion via mocked `execFileSync`/`spawn`.
- [ ] Emitted repo-map + manifest validate against their schemas.
- [ ] `tests/test-scaffold-multi-repo-jobs.mjs` green.
**Dependencies:** US-005, US-006
**Estimated complexity:** medium

## US-008: Increment-2 register + mirrors + version bump
**Description:** As a maintainer, I want Increment 2 shipped as v5.62.0 with the skill registered, mirrored, and gates green.
**Increment:** 2
**Acceptance Criteria:**
- [ ] Register `scaffold-multi-repo-jobs` in `generate-copilot-artifacts.mjs`; if it adds any `Agent(`/prose-delegation sites, update `AGENT_SITE_INVENTORY`/`PROSE_SITE_INVENTORY` in the same commit (no generator-test inventory drift).
- [ ] Regenerate copilot + codex mirrors; Codex + Copilot Release Gates green.
- [ ] `plugins/ralph/CHANGELOG.md` + `plugins/ralph/AGENTS.md` (scaffolder + UNCHANGED ship ceremony) updated.
- [ ] Six version stamps → 5.62.0.
- [ ] Capture codex skill-list/registry probe evidence that `$ralph-orchestration:implement-with-ralph` loads the skill body (AC6 evidence).
**Dependencies:** US-005, US-006, US-007
**Estimated complexity:** medium
