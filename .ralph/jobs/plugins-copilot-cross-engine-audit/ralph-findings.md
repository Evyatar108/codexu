# ralph v5.46.0 Copilot parity findings

Audit target: `D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph` at `b2e4913d6862b03f79843942b615f4231aeebbfe`.

### codex-exec-shell-true

**Command:** `grep -n "shell: true" D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs`
**Observed:** The trusted Codex spawn site contains `shell: true` at line 74 with the Windows `.cmd` shim rationale in nearby comments. The property is present and load-bearing for the migration path.
**Evidence file:** `evidence/ralph-codex-shell-grep.txt`; `evidence/ralph-codex-shell-context.txt`
**Status:** PASS

### codex-exec-help-contract

**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs --help`
**Observed:** `codex-exec.mjs --help` returned exit 1 with usage plus `Error: unknown argument: --help`. The `--help` flag is not handled; audit/verifier scripts that probe the help contract will see a non-zero exit.
**Evidence file:** `evidence/ralph-help-output.txt`
**Status:** FAIL
**File:** `D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs:148`
**Follow-up:** Batch 3: align codex-exec --help contract with audit/verifier expectations.

### copilot-exec-shell-true

**Command:** `grep -n "shell: true" D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs`
**Observed:** The trusted Copilot spawn site contains `shell: true` at line 255 with the Windows `.cmd` shim rationale in nearby comments. The property is present and load-bearing for the migration path.
**Evidence file:** `evidence/ralph-copilot-shell-grep.txt`; `evidence/ralph-copilot-shell-context.txt`
**Status:** PASS

### copilot-exec-help-contract

**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs --help`
**Observed:** `copilot-exec.mjs --help` returned exit 1 with usage plus `Error: unknown argument: --help`. The `--help` flag is not handled; audit/verifier scripts that probe the help contract will see a non-zero exit.
**Evidence file:** `evidence/ralph-help-output.txt`
**Status:** FAIL
**File:** `D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs:196`
**Follow-up:** Batch 3: align copilot-exec --help contract with audit/verifier expectations.

### codex-exec-node-smoke

**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs --prompt .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/prompt.txt --output .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/codex-output.txt --effort low --text "echo hello"`
**Observed:** The direct Node invocation exited 0 and wrote a 16-byte non-empty output file containing `hello from smoke`. The `.mjs` call site is functional in v5.46.0.
**Evidence file:** `evidence/ralph-direct-smoke-output.txt`
**Status:** PASS

### codex-exec-sh-wrapper-absent

**Command:** `bash D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/codex-exec.sh --prompt .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/prompt.txt --output .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/codex-output.txt --effort low --text "echo hello"`
**Observed:** The bash shim command failed with exit 127 because `codex-exec.sh` is absent in v5.46.0. Any caller that references the `.sh` wrapper by path will fail with command-not-found.
**Evidence file:** `evidence/ralph-smoke-output.txt`; `evidence/ralph-root-listing.txt`
**Status:** FAIL
**File:** `D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph`
**Follow-up:** Batch 3: document v5.46.0 wrapper-removal in CHANGELOG and verify no remaining callers expect `codex-exec.sh`.

### copilot-exec-node-smoke

**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs --prompt .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/prompt.txt --output .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/copilot-output.txt --effort low --text "echo hello"`
**Observed:** The direct Node invocation exited 0 and wrote a 107-byte non-empty output file ending with `hello from smoke`. The `.mjs` call site is functional in v5.46.0.
**Evidence file:** `evidence/ralph-direct-smoke-output.txt`
**Status:** PASS

### copilot-exec-sh-wrapper-absent

**Command:** `bash D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/copilot-exec.sh --prompt .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/prompt.txt --output .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/copilot-output.txt --effort low --text "echo hello"`
**Observed:** The bash shim command failed with exit 127 because `copilot-exec.sh` is absent in v5.46.0. Any caller that references the `.sh` wrapper by path will fail with command-not-found.
**Evidence file:** `evidence/ralph-smoke-output.txt`; `evidence/ralph-root-listing.txt`
**Status:** FAIL
**File:** `D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph`
**Follow-up:** Batch 3: document v5.46.0 wrapper-removal in CHANGELOG and verify no remaining callers expect `copilot-exec.sh`.

### ralph-mjs-iterates-codex

**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/ralph.mjs --help`; inspect `resolveEngineScript()` / `engineSpawnCommand()` in `src/ralph.mjs`; `grep -nE "(codex-exec\.mjs|copilot-exec\.mjs)" D:/ai-developer-toolkit/plugins/ralph/src/ralph.mjs` (re-run against origin/main at b2e4913d during F-003 fix)
**Observed:** `ralph.mjs --help` returned exit 0. `resolveEngineScript()` defaults to `join(PLUGIN_DIR, "src", `${engine}-exec.mjs`)`, and `engineSpawnCommand()` dispatches `.mjs` scripts through `node`; non-`.mjs` env overrides still dispatch through `bash`. The grep against origin/main returned only one literal hit (line 885, a deprecation warning string); `resolveEngineScript()` at lines 978-986 constructs the exec path via a `${engine}-exec.mjs` template literal rather than hardcoding the filenames, so those call sites are in ralph-engine-wrapper-context.txt.
**Evidence file:** `evidence/ralph-ralph-help-output.txt`; `evidence/ralph-engine-wrapper-context.txt`; `evidence/ralph-engine-wrapper-grep.txt`
**Status:** PASS

### copilot-skill-mirror-parity

**Command:** `cd D:/ai-developer-toolkit/.worktrees/audit-main-ralph && node plugins/ralph/scripts/check-copilot-parity.mjs`; `grep -nE "\.sh\b" D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md`
**Observed:** The generator parity script passed all assertions, but the `implement-with-ralph` Copilot mirror still contains 33 `.sh` references including `ralph.sh`, `codex-exec.sh`, `drain-cascade.sh`, and `parse-not-tested-trailers.sh` prose. The plan says any `.sh` hit in this mirror is a FAIL row.
**Evidence file:** `evidence/ralph-parity-output.txt`; `evidence/ralph-implement-skill-sh-grep.txt`
**Status:** FAIL
**File:** `D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md:15`
**Follow-up:** Batch 3: ralph-implement-skill-mirror-regenerate-2026-05-28.

### optional-e2e-plan-with-ralph-smoke

**Command:** N/A
**Observed:** SKIPPED: scenarios 1-6 were executed and the lighter direct Node runtime smokes for both Codex and Copilot produced non-empty output; the optional full `/plan-with-ralph` Copilot lead smoke is slower and not needed to disambiguate static runtime wrapper behavior in this audit iteration.
**Evidence file:** `evidence/ralph-direct-smoke-output.txt`; `evidence/ralph-parity-output.txt`
**Status:** NOT-TESTED
