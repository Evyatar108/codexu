# Research Brief: Ralph plan/brainstorm unique staging path per member

## Researcher Findings

The collision surface is the staging-directory derivation documented in the Ralph skill sources and their Copilot mirrors:

- `D:\ai-developer-toolkit\plugins\ralph\skills\plan-with-ralph\SKILL.md`
- `D:\ai-developer-toolkit\plugins\ralph\.copilot-plugin\copilot-skills\plan-with-ralph\SKILL.md`
- `D:\ai-developer-toolkit\plugins\ralph\skills\brainstorm-with-ralph\SKILL.md`
- `D:\ai-developer-toolkit\plugins\ralph\.copilot-plugin\copilot-skills\brainstorm-with-ralph\SKILL.md`

`plan-with-ralph` still describes `session_id` as only a timestamp and stages files under `<JOBS_BASE>/.staging/<session_id>/`. That creates a same-second collision if multiple plan members derive the same timestamp in one crew. `brainstorm-with-ralph` currently uses `SESSION_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"`, which is PID-disambiguated but not human-readable per member and does not match the requested crew-member guarantee. Both skill surfaces should converge on one documented staging slug contract.

Relevant shared helper surface:

- `D:\ai-developer-toolkit\plugins\ralph\src\path-utils.mjs` already centralizes Ralph path helpers and exposes a CLI with `detect-repo-root`, `normalize-path`, `resolve-jobs-base`, and `resolve-brainstorms-base`.
- `D:\ai-developer-toolkit\plugins\ralph\tests\test-path-utils.mjs` covers path-utils exported helpers and CLI behavior with `node:test`.
- `D:\ai-developer-toolkit\plugins\ralph\scripts\generate-copilot-artifacts.mjs` regenerates Copilot skill mirrors from source skills; hand-forked Copilot surfaces must remain in parity.

Release/version surfaces:

- `D:\ai-developer-toolkit\plugins\ralph\CHANGELOG.md`
- `D:\ai-developer-toolkit\plugins\ralph\.claude-plugin\plugin.json`
- `D:\ai-developer-toolkit\plugins\ralph\.github\plugin\plugin.json`
- `D:\ai-developer-toolkit\.claude-plugin\marketplace.json`
- `D:\ai-developer-toolkit\.github\plugin\marketplace.json`

The current installed manifests show `5.46.2`; the changelog already has a planned `v5.46.3` section, so this patch should target `v5.46.3` without introducing a new minor version.

## Architect Analysis

The safest design is to introduce one small staging-slug helper instead of duplicating shell slug logic in two skills. The helper should keep timestamps first for human sorting, append a kebab-cased member slug for same-second uniqueness across crew members, and retain a deterministic fallback for non-crew invocations.

Proposed contract:

1. The helper generates a staging session slug shaped like `<utc-second>-<member-slug>`.
2. `member-slug` is resolved from the first available crew/member environment variable, with `RALPH_MEMBER_NAME` as an explicit Ralph-facing override if available.
3. If no member variable exists, fall back to the current process id or `solo-<pid>` so non-crew invocations remain collision-resistant.
4. Slug normalization is ASCII-only, lowercase, dash-separated, collapsed, trimmed, and capped to keep paths Windows-safe and readable.
5. The helper has a CLI entry point so SKILL.md inline shell blocks can call `node "$PLUGIN_DIR/src/staging-session.mjs" create` without shell-specific implementation details.

Risk areas:

- There is no existing documented Ralph member-name environment contract in `plugins/ralph`; implementation should accept multiple likely crew env names and document the precedence, not rely on a single unverified variable.
- Any downstream prose or tests that assume `.staging/<timestamp>/` must accept `.staging/<timestamp>-<member>/`.
- The Copilot mirror must be regenerated or updated in lockstep with the source skills so Claude and Copilot sessions behave the same.

## Consolidated File List

### Files to modify

- `plugins/ralph/src/staging-session.mjs` - new shared helper for member-aware staging slugs.
- `plugins/ralph/src/path-utils.mjs` - optional export/CLI integration if the helper is folded into path-utils instead of a dedicated module.
- `plugins/ralph/skills/plan-with-ralph/SKILL.md` - use the helper for `session_id` and update staging prose.
- `plugins/ralph/skills/brainstorm-with-ralph/SKILL.md` - use the same helper for `SESSION_ID`.
- `plugins/ralph/.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md` - regenerated/lockstep mirror.
- `plugins/ralph/.copilot-plugin/copilot-skills/brainstorm-with-ralph/SKILL.md` - regenerated/lockstep mirror.
- `plugins/ralph/CHANGELOG.md` - cite the same-second overwrite failure pattern and fix.
- `plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.github/plugin/plugin.json`, `D:\ai-developer-toolkit\.claude-plugin\marketplace.json`, `D:\ai-developer-toolkit\.github\plugin\marketplace.json` - version stamps if the release process requires all five to read `5.46.3`.

### Tests to add or update

- `plugins/ralph/tests/test-staging-session.mjs` - helper unit tests, including same-second distinct members.
- `plugins/ralph/tests/test-plan-with-ralph-suggested-decomposition.sh` or a new skill-contract test - grep/assert both plan and brainstorm skill docs invoke the helper and no longer describe bare timestamp-only staging.
- Existing full test runner: `node plugins/ralph/tests/run.mjs` from `D:\ai-developer-toolkit` if runtime permits; targeted helper test plus skill contract test is the minimum patch gate.

