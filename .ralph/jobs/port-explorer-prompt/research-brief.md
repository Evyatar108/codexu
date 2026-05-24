# Research Brief: Fill explorer.toml for built-in `explorer` role

## Researcher Findings

**Target stub:** `D:/harness-efforts/codexu/codex/external/repos/codex-patched/codex-rs/core/src/agent/builtins/explorer.toml` — confirmed **0 bytes**, file exists.

**Sibling TOML (awaiter.toml, the structural template):**
```toml
background_terminal_max_timeout = 3600000
model_reasoning_effort = "low"
developer_instructions="""You are an awaiter. ...
"""
```
Full 36-line template available. Schema confirms `developer_instructions` carries the prompt body; `model`, `model_reasoning_effort`, `sandbox_mode`, `permission_profile`, `background_terminal_max_timeout`, `instructions` are all optional.

**role.rs wiring (verified):**
- Lines 368-380: built-in `explorer` already registered in `configs()` BTreeMap with `config_file: Some("explorer.toml")` and a description string.
- Lines 420-428: `config_file_contents()` already has `const EXPLORER: &str = include_str!("builtins/explorer.toml")` and the `"explorer.toml" => Some(EXPLORER)` match arm. **No role.rs edit needed.**

**Tests:**
- `core/src/agent/role_tests.rs:92-105` — `apply_empty_explorer_role_preserves_current_model_and_reasoning_effort()` currently passes BECAUSE the file is empty. **This test name and assertion will become stale once we add content.** Plan must update it.
- `core/src/agent/role_tests.rs:770-775` — `built_in_config_file_contents_resolves_explorer_only()` already validates that `explorer.toml` resolves via `include_str!`.
- `core/src/agent/role_tests.rs:78-89` — `#[ignore]`'d test `apply_explorer_role_sets_model_and_adds_session_flags_layer()` could optionally be un-ignored.
- `core/src/tools/handlers/multi_agents_tests.rs` — `spawn_agent_uses_explorer_role_and_preserves_approval_policy()` confirms explorer is already spawnable.

**Inspiration source — `D:/harness-efforts/claude-code/worktrees/main/src/tools/AgentTool/built-in/exploreAgent.ts`** (lines 24-56, system prompt to paraphrase):

```
You are a file search specialist for Claude Code, Anthropic's official CLI for Claude. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools - attempting to edit files will fail.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
[glob guidance — conditionally Glob tool or bash find]
[grep guidance — conditionally Grep tool or bash grep]
- Use [FileRead] when you know the specific file path you need to read
- Use [Bash] ONLY for read-only operations (ls, git status, git log, git diff, find[, grep], cat, head, tail)
- NEVER use [Bash] for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification
- Adapt your search approach based on the thoroughness level specified by the caller
- Communicate your final report directly as a regular message — do NOT attempt to create files

NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:
- Make efficient use of the tools that you have at your disposal: be smart about how you search for files and implementations
- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files

Complete the user's search request efficiently and report your findings clearly.
```

Brand strings to replace: "Claude Code, Anthropic's official CLI for Claude" → "the codex agent". Tool name list (Glob/Grep/FileRead/Bash) should be replaced with capability descriptions (per native-agent-parity.md §2.1 guidance, since codex's tool surface differs).

**Plans cited:**
- `plans/native-agent-parity.md` §2.1 (lines 70-86): explicit guidance to drop brand refs, drop tool-name list (replace with capability descriptions), map `omitClaudeMd` semantics.
- `plans/native-agent-parity.md` §4 (lines 187-208): license posture — paraphrase prose, do not copy paragraphs, replace product names, cite inspiration in comment header, operator review before merge.
- `plans/codexu-roadmap.md` "minimize-conflict-surface" tenet (lines 190-192, 1403-1405): keep deltas to upstream-canonical files small. This work is safe — touches only a new-content file under `builtins/`; the wiring already exists.

**Submodule state (verified via `git -C codex/external/repos/codex-patched/`):**
- Remote `origin` = `https://github.com/gim-home/codex.git` (fetch + push). **Already correct for the requested push target.** No separate `gim-home` remote exists; `origin` IS gim-home/codex.
- Working tree: clean.
- HEAD: detached (typical submodule state).
- Codexu superproject `git submodule status` shows `+ed5d2fd...` — i.e., submodule is already at a different commit than `.gitmodules` records. The user's `git status` at session start shows `M codex` — there's already a pending submodule pointer change. Plan must address this: either bundle the new pointer with the existing one, or rebase atop it cleanly.

**Worktree convention:** Existing `.worktrees/codex-mcp-discovery/`, `.worktrees/session-role-pill/` are full codexu checkouts. The feature request asks for a **codex-submodule** worktree under `.ralph/jobs/<job>/codex-worktree/` — that path is non-standard but git-compatible.

**`codex exec` smoke test:** No direct `--role explorer` CLI flag in `exec/src/cli.rs`. Smoke is invoked via parent agent that calls `spawn_agent` with `agent_type: "explorer"`. Caveat: `docs/workflows/codex-cli-git-bash-diagnostic.md` notes `codex exec --sandbox read-only` can fail silently — plan should pick the invocation carefully.

## Architect Analysis

**TOML schema (from `config/src/config_toml.rs:668-681` and `core/src/config/agent_roles.rs:360-383`):**
- Required (per user-role parse path): `developer_instructions` (non-blank).
- **Important nuance flagged by Codex research:** built-in role files are loaded in `role.rs` as raw `ConfigToml` via `include_str!`, NOT through `parse_agent_role_file_contents()`. So the non-blank validation is NOT automatically exercised for built-ins. A tiny new test should guard the invariant.
- Optional fields worth setting: `model_reasoning_effort = "low"` (matches Claude's "fast agent" intent), `sandbox_mode = "read-only"` (real runtime enforcement; complements the prompt prose).
- Codex research suggests `project_doc_fallback_filenames = []` as a codex-native analog for `omitClaudeMd: true`. Verify config arrays replace rather than merge at the role layer before adopting.

**Compile-time vs runtime:** `include_str!` is compile-time. Malformed TOML → `cargo build` fails immediately. `cargo check -p codex-core` is enough to catch syntax errors.

**License paraphrase rules (§4 summary):**
- Rewrite all prose (no verbatim spans > ~5 consecutive words).
- Replace product names (no "Claude Code", "Anthropic's CLI").
- Replace specific Claude tool names with capability descriptions OR codex tool names (verify against `core/src/tools/handlers/`).
- Preserve functional patterns: READ-ONLY enforcement contract, prohibition list structure, parallel-tool guidance, "report as a regular message" pattern.
- Comment header at top: `# Inspired by the design of Claude Code's built-in Explore subagent; prose rewritten for codex.` (single line, TOML `#` comment).

**Risk areas:**
1. **License compliance (HIGH, gating):** manual operator review required before any commit. Plan must surface paraphrased output BEFORE the submodule commit step.
2. **Submodule pointer ordering (MODERATE):** push to gim-home/codex first, THEN bump codexu pointer. If pointer is bumped first, clones break. The existing `M codex` in the user's working tree complicates this — see "Submodule state" above; plan must reconcile.
3. **Stale test (LOW):** `apply_empty_explorer_role_preserves_current_model_and_reasoning_effort` name becomes a lie once the file is non-empty. Either rename + adapt the assertion, or replace it.
4. **Smoke-test caveat (LOW):** `codex exec --sandbox read-only` is known to fail silently in this repo's diagnostic doc. Use a parent-agent + spawn_agent flow instead of a direct CLI flag.
5. **Worktree cleanup (LOW):** ephemeral, document in plan.

## Codex Research

(Already incorporated above.) Key additions:
- Built-ins skip the validate-non-blank path → add a tiny invariant test.
- `sandbox_mode = "read-only"` is the natural codex mechanism if we want real read-only enforcement beyond prose.
- `project_doc_fallback_filenames = []` as `omitClaudeMd` analog.

## Copilot Research

(Already incorporated above.) Key additions:
- `codex exec --sandbox read-only` is documented as problematic per `docs/workflows/codex-cli-git-bash-diagnostic.md`. Smoke must use spawn-agent path.
- Plan should explicitly decide whether to update `codex/docs/implementation/patch-surface.md` — fork guidance expects upstream-canonical edits to be documented.
- Note: Copilot couldn't open the exploreAgent.ts inspiration file directly; relied on plans/native-agent-parity.md summary. Researcher (above) DID quote the prompt verbatim, which is what we'll paraphrase against.

## Consolidated File List

### Files to modify (codex submodule, inside the codex worktree)
- `codex-rs/core/src/agent/builtins/explorer.toml` — **primary edit (currently 0 bytes)**
- `codex-rs/core/src/agent/role_tests.rs` (~line 92-105) — update or replace `apply_empty_explorer_role_preserves_current_model_and_reasoning_effort` test; optionally add a new tiny "explorer has non-blank developer_instructions" assertion

### Optional documentation update (codex submodule)
- `codex/docs/implementation/patch-surface.md` — note new content in `builtins/explorer.toml` per fork-guidance expectation

### Files to modify (codexu superproject)
- The `codex` submodule pointer (no file edits in codexu — just the pointer bump via `git add codex` + commit). The existing `M codex` state in the working tree must be reconciled first.

### Reference files (read-only, do not modify)
- `codex-rs/core/src/agent/role.rs` (lines 368-380, 420-428) — confirms wiring; no edit
- `codex-rs/core/src/agent/builtins/awaiter.toml` (lines 1-36) — TOML schema template
- `codex-rs/config/src/config_toml.rs` (lines 668-681) — `AgentRoleToml` schema
- `codex-rs/core/src/config/agent_roles.rs` (lines 360-383, 711-791) — validation rules, sandbox_mode mapping
- `D:/harness-efforts/claude-code/worktrees/main/src/tools/AgentTool/built-in/exploreAgent.ts` (lines 24-56) — inspiration prompt
- `plans/native-agent-parity.md` §2.1 (lines 70-86), §4 (lines 187-208)
- `plans/codexu-roadmap.md` (lines 190-192, 1403-1405) — minimize-conflict-surface
- `codex/CLAUDE.md` — fork engineering tenets
- `codex/docs/workflows/codex-cli-git-bash-diagnostic.md` — smoke-test caveat for `codex exec --sandbox read-only`

### Test files exercised
- `cargo check -p codex-core` (fast syntax validation)
- `cargo build --workspace` from `codex-rs/` (full acceptance)
- `cargo test -p codex-core explorer` (existing + new tests)
- Manual `codex exec` smoke via parent + `spawn_agent`
