# ralph v5.46.0 Copilot parity findings

Audit target: `D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph` at `b2e4913d6862b03f79843942b615f4231aeebbfe`.

### codex-exec-shell-true

**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs --help`; `grep -n "shell: true" D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs`
**Observed:** `codex-exec.mjs --help` returned exit 1 with usage plus `Error: unknown argument: --help`; the trusted Codex spawn site still contains `shell: true` at line 74 with the Windows `.cmd` shim rationale in nearby comments.
**Evidence file:** `evidence/ralph-help-output.txt`; `evidence/ralph-codex-shell-grep.txt`; `evidence/ralph-codex-shell-context.txt`
**Status:** FAIL
**File:** `D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs:148`
**Follow-up:** Batch 3: align codex-exec --help contract with audit/verifier expectations.

### copilot-exec-shell-true

**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs --help`; `grep -n "shell: true" D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs`
**Observed:** `copilot-exec.mjs --help` returned exit 1 with usage plus `Error: unknown argument: --help`; the trusted Copilot spawn site still contains `shell: true` at line 255 with the Windows `.cmd` shim rationale in nearby comments.
**Evidence file:** `evidence/ralph-help-output.txt`; `evidence/ralph-copilot-shell-grep.txt`; `evidence/ralph-copilot-shell-context.txt`
**Status:** FAIL
**File:** `D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs:196`
**Follow-up:** Batch 3: align copilot-exec --help contract with audit/verifier expectations.

### minimal-codex-exec-smoke

**Command:** `bash D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/codex-exec.sh --prompt .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/prompt.txt --output .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/codex-output.txt --effort low --text "echo hello"`; fallback `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs --prompt ... --output ... --effort low --text "echo hello"`
**Observed:** The planned bash shim command failed with exit 127 because `codex-exec.sh` is absent in v5.46.0; the direct Node fallback exited 0 and wrote a 16-byte non-empty output file containing `hello from smoke`.
**Evidence file:** `evidence/ralph-smoke-output.txt`; `evidence/ralph-direct-smoke-output.txt`; `evidence/ralph-root-listing.txt`
**Status:** PASS

### minimal-copilot-exec-smoke

**Command:** `bash D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/copilot-exec.sh --prompt .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/prompt.txt --output .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/copilot-output.txt --effort low --text "echo hello"`; fallback `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs --prompt ... --output ... --effort low --text "echo hello"`
**Observed:** The planned bash shim command failed with exit 127 because `copilot-exec.sh` is absent in v5.46.0; the direct Node fallback exited 0 and wrote a 107-byte non-empty output file ending with `hello from smoke`.
**Evidence file:** `evidence/ralph-smoke-output.txt`; `evidence/ralph-direct-smoke-output.txt`; `evidence/ralph-root-listing.txt`
**Status:** PASS

### ralph-mjs-iterates-codex

**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/ralph.mjs --help`; inspect `resolveEngineScript()` / `engineSpawnCommand()` in `src/ralph.mjs`
**Observed:** `ralph.mjs --help` returned exit 0. `resolveEngineScript()` defaults to `join(PLUGIN_DIR, "src", `${engine}-exec.mjs`)`, and `engineSpawnCommand()` dispatches `.mjs` scripts through `node`; non-`.mjs` env overrides still dispatch through `bash`.
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
