# Stories Outline: Node-native cross-platform command-on-PATH resolver for ralph

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Target: the `ai-developer-toolkit` SUBMODULE (`plugins/ralph/`). Serial, single job.*

## US-001: Replace bash `command -v` preflight with a Node-native cross-platform resolver
**Description:** As a Windows ralph user, I want the iteration-engine availability preflight to detect an installed `codex` (shipped as `codex.ps1` / `codex.cmd` npm shims) so ralph does not silently downgrade `codex` → `copilot` on every run.
**Acceptance Criteria:**
- [ ] `commandOnPath` in `plugins/ralph/src/ralph.mjs` is rewritten as an **exported**, dependency-free, Node-native function with no `spawnSync`, no `bash`, no `command -v` — it probes the filesystem only.
- [ ] Windows branch: scans `PATH` (split on the platform-correct `delimiter`, selecting `path.win32` vs `path.posix` from the injected `platform`), checks candidate names = `command` + each extension in the UNION of normalized `PATHEXT` (entries lacking a leading dot are prefixed with `.`) and the explicit set `{"", .ps1, .cmd, .exe, .bat, .com}` (case-insensitive), guarding each hit with `statSync(...).isFile()`. A `codex.ps1`-only install resolves as present even though `.ps1` is absent from default `PATHEXT`.
- [ ] POSIX branch: scans `PATH` dirs (via `path.posix`), returns true only for an executable regular file (`accessSync(candidate, constants.X_OK)` + `isFile()`), preserving the PATH-dir scan without spawning a shell. cwd / empty-PATH-component lookup is intentionally NOT performed (documented).
- [ ] `env`/`platform`/fs-probe functions are injectable (defaults: `process.env`, `process.platform`, the real `existsSync`/`statSync`/`accessSync`) so both branches are unit-testable on one host OS without a real codex.
- [ ] Surrounding quotes are stripped from Windows `PATH` entries, and `PATH`/`PATHEXT` are read via case-insensitive env-key lookup so a plain injected `env` object works.
- [ ] Caller at `ralph.mjs:57` updated to `commandOnPath(command, { env })` (drop the now-unused `cwd`).
- [ ] `shellQuote` (`ralph.mjs:1247-1249`) is deleted; `grep -n shellQuote plugins/ralph/src/*.mjs` returns nothing.
- [ ] `import { win32 as winPath, posix as posixPath } from "node:path"` added; the existing `node:path` and `spawnSync` imports are retained (still used at `:702`, `:1209`).
- [ ] New `node:test` cases in `tests/test-ralph.mjs`: Windows-`.ps1`, Windows-`.cmd`, Windows-`PATHEXT-without-leading-dot`, Windows-quoted-PATH-dir, Windows-not-found, POSIX-found, POSIX-present-but-not-executable, POSIX-not-found, empty-PATH (all host-independent via injected `platform` + fake fs).
- [ ] Regression guard: a test asserts `plugins/ralph/src/ralph.mjs` source matches no `spawn(?:Sync)?\s*\(\s*["']bash["']` and contains no `command -v` (mirrors the existing `command -v jq` source-grep assert).
- [ ] Existing engine-preflight tests (which inject `commandExists`) stay green — the caller seam is unchanged.
- [ ] `node --check plugins/ralph/src/ralph.mjs` passes; `node --test plugins/ralph/tests/test-ralph.mjs` is green.
- [ ] Typecheck passes
**Dependencies:** None
**Estimated complexity:** small

## US-002: Bundle the companion test-path Windows codex-shim spawn fix
**Description:** As a Windows ralph maintainer, I want the opt-in live fan-out smoke to spawn `codex` via a Windows-resolvable mechanism so the `US-005` live-execute subtest stops failing with `ENOENT`.
**Acceptance Criteria:**
- [ ] `plugins/ralph/tests/test-codex-live-smoke.mjs` (`:216-225`) adds `shell:true` to the `spawnSync("codex", …)` so Windows resolves the `codex.cmd`/`codex.ps1` shim. The prompt is already passed on stdin (`input: smokePrompt`) and the argv are metachar-free flags, so `shell:true` introduces no `cmd.exe` re-parse hazard.
- [ ] OPTIONAL hardening: `codexAvailable()` (`:80-86`) also detects a `.ps1`-only install (it currently uses `where/which`, which finds `codex.cmd` but not a `.ps1`-only shim) — preferably by reusing the exported `commandOnPath`.
- [ ] The opt-in live smoke still SKIPs cleanly in the default gate (no regression to the default skip behavior; double-gated by `RALPH_CODEX_LIVE_SMOKE=1` + `RALPH_CODEX_LIVE_SMOKE_EXECUTE=1` + `codex` on PATH).
- [ ] Verification noted as source-assert + manual operator-run live smoke (NOT default CI), per the opt-in gating.
- [ ] Typecheck passes (`node --check plugins/ralph/tests/test-codex-live-smoke.mjs`)
**Dependencies:** None (file-disjoint from US-001)
**Estimated complexity:** small

## US-003: Release v5.57.0 — version stamps, marketplace sync, CHANGELOG, AGENTS.md note
**Description:** As a toolkit consumer, I want the bash-removal fix shipped as v5.57.0 with all version stamps and marketplace indexes in sync so `copilot plugin update` picks it up.
**Acceptance Criteria:**
- [ ] All six version stamps read `5.57.0`: `plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.github/plugin/plugin.json`, `plugins/ralph/.codex-plugin/plugin.json`, and the toolkit-root `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json` (ralph entry).
- [ ] `node tools/validate-codex-marketplace-policy.mjs` passes (policy enums valid across all three indexes).
- [ ] Copilot release gate passes: `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check && node plugins/ralph/scripts/check-copilot-parity.mjs` (no SKILL/agent prose changed → no regeneration expected; gate is clean).
- [ ] Codex release gate passes: `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=codex --check && node plugins/ralph/tests/test-codex-generator.mjs && node tools/validate-codex-marketplace-policy.mjs`.
- [ ] `plugins/ralph/CHANGELOG.md` gains a prepended `## v5.57.0` entry describing the bash-removal runtime fix (+ the bundled live-smoke shim fix).
- [ ] `plugins/ralph/AGENTS.md` gains a `## v5.57.0 Behavioral Additions` note stating the **default command-on-PATH preflight no longer shells out to bash** (explicit `.sh` engine-override scripts still run via bash through `engineSpawnCommand`), and summarizing the new resolver contract.
- [ ] The impl member does NOT touch any codexu file (codexu `AGENTS.md` active-plugin-versions table is the lead's pointer-bump commit).
- [ ] Typecheck passes
**Dependencies:** US-001, US-002
**Estimated complexity:** small
