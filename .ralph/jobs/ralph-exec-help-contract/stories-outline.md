# Stories Outline: ralph-exec-help-contract

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Add --help / -h handler to codex-exec.mjs
**Description:** As a verifier-script author, I want `node plugins/ralph/src/codex-exec.mjs --help` to exit 0 with usage text on stdout so that sanity probes do not fail before they can check anything.

**Acceptance Criteria:**
- [ ] `parseArgs()` in `D:/ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs` accepts `--help` and `-h` as the first switch case, sets `config.showHelp = true`, and **returns the config immediately before `validateConfig(config, opts)` runs** (so the help path bypasses required-arg validation).
- [ ] `main(argv, opts)` widens its opts signature to accept `stdout` (`const stdout = opts.stdout ?? process.stdout;`). When `config.showHelp` is true, `main()` writes the existing `usage()` output to `stdout` and returns 0 **before any other side effect** (no prompt read, no `codex` spawn).
- [ ] `node D:/ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs --help` exits 0 with non-empty stdout containing `Usage:`; stderr empty.
- [ ] `node D:/ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs -h` behaves identically: exit 0, non-empty stdout containing `Usage:`, stderr empty, no spawn.
- [ ] `test-codex-exec.mjs` gets a new in-process test (or two — one per flag) that invokes `main(["--help"], opts)` and `main(["-h"], opts)` with NO `--prompt` / `--output` args. Each asserts: `code === 0`, stdout non-empty and contains `Usage:`, stderr empty, spawn mock not called.
- [ ] `runMain()` helper is extended with an optional `stdout` sink defaulting to a no-op; existing tests not edited.
- [ ] Existing tests in `test-codex-exec.mjs` remain green after the change. Verification: `node --test D:/ai-developer-toolkit/plugins/ralph/tests/test-codex-exec.mjs`.
- [ ] Typecheck passes (no static type system on Node ESM — verification is `node --check D:/ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs`).

**Dependencies:** None
**Estimated complexity:** small

## US-002: Add --help / -h handler to copilot-exec.mjs
**Description:** As a verifier-script author, I want `node plugins/ralph/src/copilot-exec.mjs --help` to exit 0 with usage text on stdout so that sanity probes do not fail before they can check anything.

**Acceptance Criteria:**
- [ ] `parseArgs()` in `D:/ai-developer-toolkit/plugins/ralph/src/copilot-exec.mjs` accepts `--help` and `-h` as the first switch case, sets `config.showHelp = true`, and **returns the config immediately before the end-of-parser required-arg checks for `--prompt` / `--output` run** (so the help path bypasses required-arg validation).
- [ ] `main(argv, opts)` widens its opts signature to accept `stdout` (`const stdout = opts.stdout ?? process.stdout;`). When `config.showHelp` is true, `main()` writes the existing `USAGE` constant to `stdout` and returns 0 **before any side effect** (no temp directory creation via `mkdtempSync()`, no `openSync(output, "w")`, no `copilot` spawn).
- [ ] `node D:/ai-developer-toolkit/plugins/ralph/src/copilot-exec.mjs --help` exits 0 with non-empty stdout containing `Usage:`; stderr empty.
- [ ] `node D:/ai-developer-toolkit/plugins/ralph/src/copilot-exec.mjs -h` behaves identically: exit 0, non-empty stdout containing `Usage:`, stderr empty, no spawn.
- [ ] `test-copilot-exec.mjs` gets new in-process tests covering `--help` and `-h` with NO `--prompt` / `--output` args. Each asserts: `code === 0`, stdout non-empty and contains `Usage:`, stderr empty, spawn mock (`failSpawn`) not called.
- [ ] **fs-side-effect-free test (required):** `test-copilot-exec.mjs` adds at least one test that creates a pre-existing output file with known contents, records `statSync(output).mtimeMs`, sets `TMPDIR`/`TMP`/`TEMP` to a deliberately missing directory, and invokes BOTH `main(["--help", "--output", output], ...)` and `main(["--output", output, "--help"], ...)` with fresh output files. Each invocation asserts: code 0, stdout contains `Usage:`, stderr empty, spawn not called, output file contents unchanged, mtime unchanged. The invalid temp base proves `mkdtempSync()` was not reached; unchanged file content + mtime prove `openSync(outputFile, "w")` was not reached.
- [ ] `sink()` / `failSpawn` test harness is extended with an optional `stdout` sink defaulting to a no-op; existing tests not edited.
- [ ] Existing tests in `test-copilot-exec.mjs` remain green. Verification: `node --test D:/ai-developer-toolkit/plugins/ralph/tests/test-copilot-exec.mjs`.
- [ ] `node --check D:/ai-developer-toolkit/plugins/ralph/src/copilot-exec.mjs` passes.

**Dependencies:** None (can run in parallel with US-001)
**Estimated complexity:** small

## US-003: v5.46.1 release stamp bump + CHANGELOG + verification
**Description:** As a plugin maintainer, I want the patch release to ship as v5.46.1 across all five release stamps and CHANGELOG so that downstream consumers and the marketplace resolve the new wrappers.

**Acceptance Criteria:**
- [ ] `D:/ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json` `version` field set to `"5.46.1"`.
- [ ] `D:/ai-developer-toolkit/plugins/ralph/.github/plugin/plugin.json` `version` field set to `"5.46.1"`.
- [ ] `D:/ai-developer-toolkit/.claude-plugin/marketplace.json` ralph-orchestration entry version set to `"5.46.1"`.
- [ ] `D:/ai-developer-toolkit/.github/plugin/marketplace.json` ralph-orchestration entry version set to `"5.46.1"`.
- [ ] `D:/ai-developer-toolkit/.agents/plugins/marketplace.json` ralph-orchestration entry version set to `"5.46.1"`.
- [ ] `D:/ai-developer-toolkit/plugins/ralph/CHANGELOG.md` has a new `## v5.46.1` section prepended at the top with 3 bullets describing the --help contract fix, the new tests, and the five-release-stamp bump.
- [ ] Anchored verification passes:
  - `grep -nE '"version"[[:space:]]*:[[:space:]]*"5\.46\.1"' plugins/ralph/.claude-plugin/plugin.json plugins/ralph/.github/plugin/plugin.json` returns one match per plugin manifest.
  - `jq -r '.plugins[] | select(.name == "ralph-orchestration" and .source == "./plugins/ralph") | .version' .claude-plugin/marketplace.json .github/plugin/marketplace.json` returns `5.46.1` for both Claude/Copilot marketplace entries.
  - `jq -r '.plugins[] | select(.name == "ralph-orchestration" and .source.path == "./plugins/ralph") | .version' .agents/plugins/marketplace.json` returns `5.46.1` for the agent marketplace entry.
- [ ] Inverse-check passes: `grep -nE '"version"[[:space:]]*:[[:space:]]*"5\.46\.0"' plugins/ralph/.claude-plugin/plugin.json plugins/ralph/.github/plugin/plugin.json .claude-plugin/marketplace.json .github/plugin/marketplace.json .agents/plugins/marketplace.json` returns zero hits.
- [ ] `node D:/ai-developer-toolkit/plugins/ralph/tests/run.mjs` runs full suite green.
- [ ] Direct CLI smoke passes: `node D:/ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs --help` AND `node D:/ai-developer-toolkit/plugins/ralph/src/copilot-exec.mjs --help` both exit 0 with non-empty stdout.
- [ ] **Release handoff (NOT a push):** impl member commits all changes to topic branch `ralph/ralph-exec-help-contract` in a worktree off `main` in `D:/ai-developer-toolkit/`, runs all verification commands above with passing output, then STOPS and surfaces a `kind=question` to the operator with the branch name, commit SHA, and a summary of changes — requesting explicit confirmation before any `git push` to `origin` and `work`. The impl member must NOT push autonomously.

**Dependencies:** US-001, US-002
**Estimated complexity:** small
