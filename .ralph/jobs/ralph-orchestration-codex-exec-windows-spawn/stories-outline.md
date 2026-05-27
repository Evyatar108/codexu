# Stories Outline: ralph-orchestration v5.45.1 — Windows codex/copilot spawn shell:true fix

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Add failing-first spawn-option and path-with-spaces tests for codex-exec and copilot-exec

**Description:** As a maintainer, I want regression tests that assert `shell: true` is set on the `codex-exec.mjs` and `copilot-exec.mjs` spawn calls (and that paths containing spaces are preserved in argv) so that the Windows ENOENT bug cannot re-regress silently and the cross-platform quoting risk is observable.

**Acceptance Criteria:**
- [ ] `plugins/ralph/tests/test-codex-exec.mjs` contains a new test that captures the spawn options bag from a happy-path `main()` invocation and asserts `opts.shell === true`. Platform-agnostic (no `process.platform` guard).
- [ ] `plugins/ralph/tests/test-copilot-exec.mjs` contains the equivalent assertion for the captured `spawnCommand` opts.
- [ ] `plugins/ralph/tests/test-codex-exec.mjs` contains a path-with-spaces smoke test: a prompt path or output path containing a literal space. The test asserts `main()` returns without throwing AND the captured spawn argv includes the path as a single argv element unchanged.
- [ ] `plugins/ralph/tests/test-copilot-exec.mjs` contains the same path-with-spaces smoke.
- [ ] Failing-first contract: running `node tests/run.mjs` at this commit (before US-002 patches) FAILS the `shell:true` assertions.
- [ ] Commit lands on the topic branch as `test(ralph): assert shell:true on codex/copilot CLI spawn (failing pre-fix)`.
- [ ] Typecheck (if applicable) passes.

**Dependencies:** None.
**Estimated complexity:** small

## US-002: Patch codex-exec.mjs and copilot-exec.mjs to set shell:true

**Description:** As a Windows user running Node 18.20.5+ / 20.18.1+ / 22.11.0+, I want the codex and copilot CLI invocations in ralph-orchestration v5.45.x to spawn successfully without needing the `CODEX_EXEC_SCRIPT` env-var workaround so that ralph iterations and Codex/Copilot review subagents work out of the box.

**Acceptance Criteria:**
- [ ] `plugins/ralph/src/codex-exec.mjs:63` spawn options bag includes `shell: true` on its own line inside the literal options object.
- [ ] `plugins/ralph/src/copilot-exec.mjs:243` `spawnCommand` options bag includes `shell: true` on its own line inside the literal options object.
- [ ] Each patched call site has a 3-line threat-model / scope comment immediately preceding the spawn call, with text matching the wording in the plan's Architecture section.
- [ ] `git diff origin/main -- plugins/ralph/src/codex-exec.mjs plugins/ralph/src/copilot-exec.mjs` shows ONLY the additive `shell: true` lines + the threat-model comments. No whitespace / reordering changes.
- [ ] Negative AC: `git diff origin/main -- plugins/ralph/src/{git,path-utils,ralph,review-loop}.mjs` shows no changes — the SKIP-listed sites must remain untouched.
- [ ] `node tests/run.mjs` from `plugins/ralph/` exits 0 — including the US-001 assertions, which now pass.
- [ ] Commit lands on the topic branch as `fix(ralph): shell:true for codex/copilot .cmd-shim spawn on Windows (CVE-2024-27980)`.
- [ ] Typecheck (if applicable) passes.

**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Version bump, CHANGELOG, and push to both remotes

**Description:** As a release coordinator, I want v5.45.1 stamped across the five release-manifest files, the CHANGELOG entry to document the narrow fix and the explicit rationale for the SKIP sites, and the topic branch pushed to both `origin` (Evyatar108) and `work` (gim-home) remotes so that the fix is consumable by both forks.

**Acceptance Criteria:**
- [ ] `plugins/ralph/.claude-plugin/plugin.json` shows `"version": "5.45.1"`.
- [ ] `plugins/ralph/.github/plugin/plugin.json` shows `"version": "5.45.1"`.
- [ ] `.claude-plugin/marketplace.json` ralph-orchestration entry shows `"version": "5.45.1"`.
- [ ] `.github/plugin/marketplace.json` ralph-orchestration entry shows `"version": "5.45.1"`.
- [ ] `.agents/plugins/marketplace.json` ralph-orchestration entry shows `"version": "5.45.1"`.
- [ ] `plugins/ralph/CHANGELOG.md` has a new `## v5.45.1` entry at the top with: (a) the Windows ENOENT bug being fixed for codex/copilot CLI invocation, (b) the two patched call sites listed by file:line, (c) explicit rationale that other spawn sites were left unpatched intentionally (target `.exe` binaries OR pass `## section-header` argv that would be re-parsed under shell), (d) the env-var workarounds (`CODEX_EXEC_SCRIPT` / `COPILOT_EXEC_SCRIPT`) being optional after this release, (e) five release stamps bumped.
- [ ] Topic branch (suggested name `ralph/codex-copilot-windows-spawn-v5451`) is pushed to both `origin` and `work`. `git ls-remote origin <branch>` and `git ls-remote work <branch>` both return a SHA.
- [ ] Commit lands as `release(ralph): v5.45.1 — Windows .cmd-shim spawn fix`.
- [ ] Typecheck (if applicable) passes.

**Dependencies:** US-002
**Estimated complexity:** small
