# Security Review Context — phase-3h-options-mode-migration (round 1)

## Scope assessed

- New package `packages/codexu-options-mode-plugin/` (codex port of upstream options-mode Claude Code plugin).
- Three Node.js hooks: `hooks/config.js`, `hooks/stop.js`, `hooks/user-prompt-submit.js`, `hooks/session-start.js`.
- Two statusline scripts (deferred from registration but shipped): `apps/statusline/options-mode-statusline.sh`, `apps/statusline/options-mode-statusline.ps1`.
- Plugin manifests: `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, `hooks/hooks.json`.
- Test/smoke harness: `scripts/smoke.mjs`, `scripts/verify-static.mjs`, `tests/*.test.mjs`.
- Workspace plumbing: root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`.

## Threat-model boundary

- The plugin is loaded by codex into a trusted parent process. codex sets `${CLAUDE_PLUGIN_ROOT}` and `${PLUGIN_DATA}` env vars; the plugin must fail loud when `PLUGIN_DATA` is unset (INV-6).
- All state writes live under `PLUGIN_DATA` (a user-owned directory). The plan and CLAUDE.md explicitly declare any attacker with write access to `PLUGIN_DATA` as already-owning plugin state — no additional integrity claim is made past that boundary.
- No network, no shell-out (`exec`/`spawn`), no DOM/HTML rendering, no DB, no auth surface, no crypto-for-secrets. Crypto is used only for stable filename derivation (SHA-256 truncated to 32 hex chars).

## Hardening already in place (worth preserving in future edits)

- Symlink rejection: every read and write does `lstatSync(...).isSymbolicLink()` checks before opening, and opens with `O_NOFOLLOW` (when supported) plus `O_EXCL|0o600` for atomic create.
- Atomic rename: temp file `${process.pid}.${Date.now()}` written to the same directory, then `renameSync` swap. Documented TOCTOU acceptance is explicit (see `config.js:154-157` and `:217-222`) and references the CLAUDE.md threat-model boundary.
- Allow-listed values: every mode read (`_readFlagInternal`, `getDefaultModeRaw`) re-validates against `VALID_MODES = ['on','off','strict','auto']` after trimming/lowercasing. An attacker controlling flag-file contents cannot escape this allow-list.
- Bounded reads: flag reads are capped at `MAX_FLAG_BYTES=64`; logs rotate at `MAX_LOG_BYTES=65536`. Log lines have `[\r\n]+` collapsed before append (prevents log-injection / newline forgery).
- ANSI-strip on block reasons: `sanitizeReason` in `stop.js` strips ANSI CSI sequences and C0/C1 control chars from the `reason` field before emitting it to codex stdout — protects any TTY echo path.
- Path components from user-controlled inputs (`session_id`, `transcript_path`) never appear verbatim in paths; they are SHA-256 hashed and the resulting hex slice is the only path component. No traversal vector.

## Notable observations (informational, not findings)

- `escapeForBashSingleQuote` is exported but never called by any code in the diff. Not a security issue; potential future cleanup if hooks/manifest never end up shelling out.
- `pnpm-lock.yaml` surfaces a `deprecated: Potential CWE-502 - Update to 1.3.1 or higher` marker for `@ungap/structured-clone@1.3.0`. This pulls in from existing expo/hast transitive deps in `codexu-plugin` / `codium` and is preexisting on `main`; this PR did not introduce or upgrade that dep. Out of scope for this review; track separately if a workspace-wide refresh is wanted.
- SHA-256 truncated to 128 bits (32 hex chars) for filenames is collision-resistant enough for non-security use; a hash collision merely lets two sessions share a mode flag, which has no security boundary impact.

## Verdict

CLEAR. No fixable security findings on the new code introduced by this phase.
