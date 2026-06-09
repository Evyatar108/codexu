<!-- ralph-meta {"overviewTaskId":"codex-member-skips-implement-with-ralph-skill"} -->

# Implementation Plan: codex crews members skip `/implement-with-ralph` (engine-aware skill-mention rewrite)

## Problem statement

A crews **codex** member handed a spawn prompt that ends with `RUN: /implement-with-ralph …`
does NOT run the skill — it implements the task **manually** (no worktree, no Phase 5a/5b
review convergence). On 2026-06-08 `impl-wrapper-jobb` (codex 0.135) committed `fd96f850`
directly in the lead's primary checkout on a branch with no worktree, flipping the lead off
`main`. The operator switched all impl members to Copilot as a stopgap (`--engine copilot`)
and filed this task to fix the root cause.

### Root cause (settled — read-only source investigation, NOT a guess)

`.ralph/investigations/codex-skips-implement-with-ralph/findings.md` (committed `1d92b185`)
established the mechanism from codex-fork **source** (file:line cited), which is stronger than
a single live smoke:

- Codex's skill-mention sigil is **`$`**, not `/` —
  `codex/external/repos/codex-patched/codex-rs/utils/plugins/src/mention_syntax.rs:4`
  (`pub const TOOL_MENTION_SIGIL: char = '$';`).
- Every user turn runs mention-detection → injection over the turn text —
  `core/src/session/turn.rs:504` (`collect_explicit_skill_mentions`) → `:522`
  (`build_skill_injections`) → `:536-538` (injects each resolved skill's full SKILL.md as a
  `<skill>` fragment).
- Mention-detection scans for the `$`-sigil token (or a structured skill-picker selection);
  there is **no `/`-form path** — `core-skills/src/injection.rs:254-312`, `:115-172`. In the
  codex TUI, `/` = built-in commands (`chat_composer.rs:1640`), `$` = skill popup (`:1642`).
- Only a resolved mention causes `build_skill_injections` to read the SKILL.md off disk and
  inject its `contents` — `injection.rs:38-69`. No mention ⇒ empty early-return ⇒ **the
  SKILL.md body (worktree + Phase 5a/5b contract) is never in context.**
- The crews launcher passes the spawn prompt as a **positional CLI arg** to codex —
  `plugins/crews/hooks/actors.js:228-229` (codex branch). So `RUN: /implement-with-ralph …`
  becomes the first user turn's `UserInput::Text`. A `/`-form resolves no mention; the model
  sees only the 1-line skill *advertisement* and a "implement task X per this plan" preamble,
  and does the path of least resistance — manual edits. That is exactly the `fd96f850`
  behavior.

The prior `codex-engine-ralph-member-enablement` "codex sees + runs ralph skills" claim only
ever exercised `/brainstorm-with-ralph` via a **direct `codex exec` probe** — `/implement-with-ralph`
through the crews `RUN:/skill` spawn path was never run live. This task fills exactly that gap.

## Goal

Make the crews spawn path **engine-aware** so a codex member's spawn prompt carries a real
codex `$`-mention, causing codex to inject the `/implement-with-ralph` (or any ralph skill)
SKILL.md and follow the worktree + Phase 5a/5b workflow — while Claude/Copilot members keep
the byte-identical `/`-form they already require. After this ships, the `CREWS_ENGINE=codex`
default is safe for impl members again.

## Selected approach (PRIMARY from the investigation; verified by this plan's research)

**A pure, engine-gated sigil swap `/<skill>` → `$<skill>` applied to the raw spawn prompt at
a single site inside `spawnMember`, before the launcher command is built.**

### Why this is the right design

1. **Decoupled from the exact registered token.** The rewrite preserves the skill *slug*
   verbatim and only swaps the leading `/` to `$`. It does NOT need to know whether codex
   registers the skill as `$implement-with-ralph` (bare) or `$ralph-orchestration:implement-with-ralph`
   (namespaced). Whatever slug the lead writes after the `/` is what codex receives after the
   `$`. The probe (Story 1) only determines what slug the *lead* must write — it does not gate
   the crews code.
2. **Single deterministic site.** `spawnMember` (`actors.js:2225`) resolves the authoritative
   `engine` via the v1.8.11 precedence chain at `:2237-2242`, then passes `initialPrompt` to
   `buildLauncherCommand` at `:2454`. Inserting the rewrite immediately after `:2242`
   (operating on the **raw** prompt, before `psEscape`) covers **every** real spawn path —
   `/spawn-member` slash, the `spawn-member.js` CLI mirror, and `bootstrap-crew.js:217` — all of
   which funnel through `spawnMember`. (`spawnMember` is the only caller of `buildLauncherCommand`
   on the launch path; `buildLauncherInvocation` at `:249` is **test-only** — no real launch uses
   it — so the two launcher builders stay byte-identical and the rewrite lives upstream of both.)
3. **Operates on the raw prompt → no escaping interaction.** Doing the swap before `psEscape`
   (which doubles single quotes) means the `/`→`$` regex never touches quote-escaping. The codex
   positional arg is emitted single-quoted (`'${initialPromptEscaped}'`, `actors.js:228`), and a
   PowerShell **single-quoted** string does NOT interpolate `$`, so `'$implement-with-ralph …'`
   reaches codex literally. (Gotcha #1 below.)
4. **Forensics keep the original `/` form.** The spawn-prompt outbox envelope is written in
   `spawn-member.js:180-181` from `args.initialPrompt` (the original) BEFORE `spawnMember` runs,
   so the audit trail records the lead's `/`-intent while codex receives the `$`-form. This is
   the desired split — no extra change needed.

### Rewrite contract (precise)

A new pure helper, `rewriteCodexSkillMention(prompt)` (exported from `actors.js` and re-exported
from `config.js` for tests), applied at the `spawnMember` site **only when `engine === 'codex'`**:

- **Anchor:** the documented crews/codexu spawn convention `RUN:` directive. Match a `RUN:`
  marker (case-insensitive) followed by optional inline whitespace and/or a single newline, then
  a `/<skill-token>`; rewrite that single leading `/` to `$`. This is the narrowest match and
  exactly mirrors the spawn-prompt-preamble template in codexu `AGENTS.md`
  ("Spawn-prompt preamble template" — `RUN: /implement-with-ralph …` / `RUN:\n/plan-with-ralph …`).
- **CRLF-aware:** the optional newline after `RUN:` is `\r?\n` (the codexu prompts can arrive with
  Windows CRLF). Do NOT assume `\n`-only. (Plan-review finding — MED.)
- **Fallback anchor (defensive):** if no `RUN:`-anchored match exists, rewrite a `/<skill-token>`
  that is the first non-whitespace content of a line (line-anchored, CRLF-aware). This keeps the
  helper robust to prompts that omit `RUN:` while still avoiding mid-line slashes.
- **Skill-token char class:** `[A-Za-z][A-Za-z0-9_-]*(:[A-Za-z0-9_-]+)?` — kebab slug with an
  OPTIONAL `:` namespace segment, so BOTH `implement-with-ralph` and
  `ralph-orchestration:implement-with-ralph` are handled (the mention name-char set in codex
  includes `:` per `injection.rs:507`). Hyphenated multi-segment slugs (`implement-with-ralph`)
  match.
- **Post-token boundary (anti-false-rewrite):** the matched skill token MUST be followed by
  whitespace or end-of-string — i.e. a trailing `(?=\s|$)` lookahead. This is what prevents a
  line-anchored path like `/usr/bin/x` from becoming `$usr/bin/x` (the token `usr` is followed by
  `/`, not whitespace/end, so the boundary fails and no rewrite occurs). A real skill invocation
  is always followed by a space (args) or a line end. (Plan-review finding — MED.)
- **Single rewrite:** rewrite only the FIRST skill-invocation occurrence (the spawn convention
  emits exactly one). Do not globally replace every `/word` in the prompt.
- **Idempotent + non-codex identity:** for claude/copilot the helper is never called (engine gate
  at the call site), so the prompt is byte-identical. A prompt already carrying `$<skill>` is left
  unchanged (no `/` to rewrite).

### Where the rewrite does NOT go (rejected placements, with rationale)

- **NOT in the lead's spawn-prompt prose (doc-only "tell the lead to write `$` for codex").**
  Rejected: non-deterministic (depends on the model remembering), and the investigation explicitly
  warns against trusting prose directives — that is the path that already failed.
- **NOT inside `buildLauncherCommand` / `buildLauncherInvocation`.** Those two builders must stay
  in sync (v1.9.0 convention) and operate on the already-`psEscape`d prompt; putting the swap
  there would (a) duplicate it across two functions and (b) run it against the escaped string.
  Upstream-of-both in `spawnMember` on the raw prompt is cleaner and single-source.
- **NOT in crews SessionStart.** By SessionStart the codex session has already consumed the
  positional prompt as its first user turn; rewriting there is too late.

### Secondary / tertiary options (documented, NOT implemented)

- **Secondary — structured skill pre-selection at spawn** (`UserInput::Skill { name, path }`, the
  skill-picker path `injection.rs:135-155`): more robust (injects without the model emitting any
  token) but needs a crews↔codex plumbing seam that does not exist via the positional-prompt
  launcher today. Deferred; revisit only if the text-mention proves flaky in the field.
- **Tertiary — fork-patch codex to treat `/skill` as a mention:** highest blast radius (touches
  `core-skills` mention grammar, must clear the codex fork's overlay-first conflict-surface
  gates per `codex/CLAUDE.md` tenet 1) and unnecessary if the sigil swap suffices. Last resort.

## Target repo / scope

- **Repo:** the `ai-developer-toolkit` submodule, `plugins/crews/` ONLY. This is the **same
  plugin** as the already-shipped `crews-remove-resume-crew-command` (v3.15.0 @ `04eb6bc7`), so
  the lead must **serialize** any further crews ship (same `plugin.json` + AGENTS.md + CHANGELOG +
  marketplace-index write surface).
- **Version bump:** crews `3.15.0 → 3.16.0` via `node plugins/crews/scripts/bump-version.js 3.16.0`
  (6 stamps: 3 plugin manifests + 3 marketplace indexes) + `tests/version.test.js` pin.
- **Submodule two-commit flow + 3-remote push** (`origin`, `personal`, `gim-home`) is the LEAD's
  ship ceremony — out of impl scope (the impl member commits on a submodule topic branch only).

## Out of scope (LEAD-owned post-ship, NOT impl stories)

These touch the **codexu parent repo** / lead-owned state and are explicitly deferred to the lead:

1. **codexu `AGENTS.md`** re-enablement note: codex impl members are driveable again; the lead
   writes `/skill` and crews rewrites to `$skill` for codex; re-validate `CREWS_ENGINE=codex` as
   the impl default. (Today's memory: impl members run on copilot until this ships.)
2. **`.ralph-overview/data.json`** bookkeeping (`lifecycle → merged`, `shipManifest`) on ship —
   lead-owned per the bookkeeper invariants.
3. **Memory update** flipping "codex members skip /implement-with-ralph → run copilot" once the
   fix is validated by a live codex impl smoke.
4. The parent codexu **submodule-pointer bump** + wrapper docs — the lead's multi-repo ship
   ceremony.

## Acceptance-criteria themes (full text in `stories-outline.md`)

- **US-001 (gate):** A one-line codex skill-list probe confirms the exact registered mention
  token for `implement-with-ralph` (expected `$implement-with-ralph`; record the actual). Output:
  `probe-report.md` under the job dir citing the resolved token + method. If the token is
  namespaced, US-002's char class (already `:`-tolerant) covers it; record which slug the lead
  must write.
- **US-002 (core):** `rewriteCodexSkillMention` helper + `spawnMember` engine-gated wire-in;
  pure-fn unit tests (codex `RUN: /x` → `$x`; `RUN:\n/x` → `$x`; namespaced `:` slug; line-anchored
  fallback; no-`RUN:` mid-line slash left intact; already-`$` idempotent) + a `CREWS_NO_LAUNCH=1`
  spawnMember integration test (codex launcher script contains `$implement-with-ralph`; claude AND
  copilot scripts contain `/implement-with-ralph`); crews `3.16.0` version bump (6 stamps +
  `version.test.js`); crews `AGENTS.md` v3.16.0 section + `CHANGELOG.md` entry. Full suite green
  via `node plugins/crews/tests/run.js`.

## Verification

- `node plugins/crews/tests/run.js` (full suite, <90s Windows) — all green, including the new
  test file. Run from a clean env (clear inherited `CREWS_*` + agent-session env per crews
  AGENTS.md "Test cadence").
- `node --check` on every touched JS file (crews has no package-level typecheck).
- `node plugins/crews/tests/version.test.js` confirms all 6 stamps at `3.16.0`.
- US-001 probe-report committed as evidence of the resolved codex token.
- (Lead, post-ship) a live codex impl smoke confirming a codex member now opens a worktree and
  runs Phase 5a/5b — the ultimate proof; gates the memory flip.

## Test seam (confirmed by research)

`spawnMember(name, crew, cwd, initialPrompt, { engine, noLaunch:true, sessionId })` (or
`CREWS_NO_LAUNCH=1`) writes the launcher `.ps1` to `scriptPath` and returns
`{ ok:true, pid:null, scriptPath, noLaunch:true }` WITHOUT spawning `wt.exe`
(`actors.js:2489-2491`). The integration test reads `scriptPath` and asserts the embedded
launcher command (`& <launcherCommand>`, `actors.js:2468`) carries the expected sigil per engine.

## Gotchas (carry into impl)

1. **PowerShell single-quote preserves `$`.** The codex positional is `'${initialPromptEscaped}'`
   — single-quoted, so `$implement-with-ralph` is literal (NOT a PS variable). Do the swap on the
   RAW prompt before `psEscape`. A double-quoted emission would break this; do not change the
   launcher's single-quoting.
2. **Engine gate at the call site, not inside the helper's regex.** Claude/copilot must be
   byte-identical; gate with `if (engine === 'codex')` in `spawnMember` so the helper never runs
   for them.
3. **Don't rewrite every `/token`.** Anchor on `RUN:` (primary) / line-start (fallback) and the
   kebab-skill char class so file paths / URLs / flags like `--from-plan` are untouched.
4. **`buildLauncherInvocation` is test-only** — the existing `codex-engine-field.test.js` /
   `codex-spawn-bypass-guard.test.js` assert launcher FLAGS via it, not prompt content; leave them
   unaffected. Put the new prompt assertion against `spawnMember` (via `CREWS_NO_LAUNCH`) or the
   pure helper, not via `buildLauncherInvocation`.
5. **Version bump uses the script.** `node plugins/crews/scripts/bump-version.js 3.16.0` writes all
   6 stamps; hand-editing reliably misses the codex/copilot manifest. `version.test.js` is the gate.
6. **codexu root `CLAUDE.md` is gitignored** — do NOT `git add CLAUDE.md`; fork guidance edits go
   in codexu `AGENTS.md` (lead-owned, out of impl scope here).
7. **`config.js` re-export breaks the split-export snapshot.** `tests/split-export-compat.test.js`
   pins the exact `hooks/config.js` export surface. PREFER exporting `rewriteCodexSkillMention` from
   `actors.js` only and `require('../hooks/actors')` directly in the new test — that avoids the
   snapshot churn entirely. If a `config.js` re-export IS added, the split-export `EXPECTED` set +
   count MUST be updated in the same commit. (Plan-review finding — MED.)
8. **Keep the "NOT slash-form" integration assertion narrow.** A realistic spawn preamble contains
   prose like "The /implement-with-ralph skill manages the worktree …", so asserting the launcher
   script contains NO `/implement-with-ralph` ANYWHERE would false-fail even when the `RUN:` line is
   correctly rewritten. Use a MINIMAL prompt (only the `RUN: /implement-with-ralph --autonomous`
   line) for the codex/claude/copilot launcher-script assertions, OR assert the `RUN:`-segment
   specifically — not a whole-script absence. (Plan-review finding — LOW.)

## Suggested Decomposition

Single serial cluster. US-002 dependsOn US-001 (the probe records the slug the lead writes and
confirms the `:`-namespacing need). Both stories touch the same plugin (`plugins/crews/`) and the
same version-stamp files, so they are NOT parallelizable — one impl member, serial. No second
cluster.
