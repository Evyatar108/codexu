<!-- ralph-meta {"overviewTaskId":"codex-member-skips-implement-with-ralph-skill"} -->

# Stories Outline: codex-member-skips-implement-with-ralph-skill

Target repo: `ai-developer-toolkit` submodule, `plugins/crews/`. Serial single cluster
(US-002 dependsOn US-001). crews `3.15.0 → 3.16.0`. Lead serializes vs any other crews ship.

---

## US-001 — Verify the exact codex skill-mention token (gate)

**Goal:** Confirm what `$`-mention token resolves the `implement-with-ralph` SKILL.md under the
installed codex CLI, so the codexu lead knows the exact slug to write in spawn prompts and US-002
knows whether `:` namespacing must be exercised.

**Why first:** US-002's rewrite is a pure sigil swap that preserves the slug, so it does not hard-
depend on the token — but the token determines (a) the slug the lead writes after `/` and (b)
whether the namespaced `:` form must be covered by a test. Recording it now prevents a wrong-slug
spawn after ship.

**Acceptance criteria**
1. Run a one-line, NON-INTERACTIVE codex skill-list / mention probe against the installed codex
   CLI (e.g. the codex skill registry inspection used by `happy-probe-claude-sdk`-style probes, or
   a `codex exec`-level skill listing — NOT an interactive TUI session that can hang). Capture the
   exact registered mention token(s) for `implement-with-ralph` (and, for completeness,
   `plan-with-ralph` / `brainstorm-with-ralph`).
2. Record in `probe-report.md` under the job dir: the resolved token (expected
   `$implement-with-ralph` per `injection.rs` plain-name branch keying on the unique frontmatter
   `name:`), the exact probe command, codex version, and whether a namespaced
   (`$ralph-orchestration:implement-with-ralph`) form is the registered one.
3. State the verdict explicitly: which slug the codexu lead must write after `RUN: /` so the
   US-002 rewrite yields a token codex resolves.

**Out of scope:** any code change; any interactive codex session.

**Verification:** `probe-report.md` exists, cites the resolved token + method, and names the
lead-facing slug.

---

## US-002 — Engine-aware codex skill-mention rewrite in crews (core fix)  — dependsOn US-001

**Goal:** A codex member's spawn prompt carries a real `$`-mention so codex injects the skill
SKILL.md; Claude/Copilot prompts stay byte-identical.

**Acceptance criteria**
1. **Helper:** add a pure, exported `rewriteCodexSkillMention(prompt)` in
   `plugins/crews/hooks/actors.js` implementing the rewrite contract from `plan.md`:
   - Primary anchor `RUN:` (case-insensitive) + optional inline-ws/single newline (`\r?\n`, CRLF-
     aware) + `/<token>` → swap leading `/`→`$`.
   - Fallback anchor: a `/<token>` that is the first non-whitespace on a line (CRLF-aware).
   - Token char class `[A-Za-z][A-Za-z0-9_-]*(:[A-Za-z0-9_-]+)?` (kebab + optional `:` namespace).
   - Post-token boundary `(?=\s|$)` so a path-like `/usr/bin/x` (token followed by `/`) is NOT
     rewritten.
   - Rewrites only the FIRST skill-invocation occurrence; leaves an already-`$` prompt unchanged.
   Export from `actors.js`; the test `require`s it from `actors.js` directly (do NOT add a
   `config.js` re-export — that would break `tests/split-export-compat.test.js`; if one is added,
   update that snapshot's `EXPECTED` + count in the same commit).
2. **Wire-in:** in `spawnMember`, immediately after `const engine = normalizeEngine(engineSource)`
   (`actors.js:~2242`) and BEFORE the prompt is passed to `buildLauncherCommand` (`:2454`):
   `if (engine === 'codex') initialPrompt = rewriteCodexSkillMention(initialPrompt);`
   Operate on the RAW prompt (before `psEscape`). Do NOT touch `buildLauncherCommand` /
   `buildLauncherInvocation`, the spawn-prompt forensic envelope, or claude/copilot paths.
3. **Pure-fn unit tests** (new `tests/codex-skill-mention-rewrite.test.js`): `RUN: /implement-with-ralph --from-plan p --autonomous`
   → `$implement-with-ralph …`; `RUN:\n/plan-with-ralph x` → `$plan-with-ralph x`; CRLF
   `RUN:\r\n/plan-with-ralph x` → `$plan-with-ralph x`; namespaced
   `RUN: /ralph-orchestration:implement-with-ralph` → `$ralph-orchestration:implement-with-ralph`;
   line-anchored fallback (no `RUN:`, line starts `/implement-with-ralph`) rewrites; a mid-line
   path/flag (`see /usr/bin/x` or `--from-plan /a/b`) is left intact; a LINE-START path
   (`/usr/bin/x` on its own line) is left intact (post-token boundary); an already-`$` prompt is
   unchanged; a non-skill `RUN:` with no slash is unchanged.
4. **spawnMember integration test** (same file or a sibling, using `noLaunch:true` /
   `CREWS_NO_LAUNCH=1`): with a MINIMAL prompt (only `RUN: /implement-with-ralph --autonomous`, so
   the RUN: line is the sole skill-token occurrence),
   `spawnMember('m','demo',cwd,minimalPrompt,{engine:'codex',noLaunch:true,sessionId})` writes a
   launcher script whose body contains `$implement-with-ralph` and NOT the `/`-form; the SAME
   prompt with `engine:'claude'` and `engine:'copilot'` produces a script containing
   `/implement-with-ralph` (no `$`-form). Assert by reading the returned `scriptPath`. (Use the
   minimal prompt — a realistic preamble's prose mentions `/implement-with-ralph` elsewhere and
   would false-fail a whole-script absence check.)
5. **Version bump:** `node plugins/crews/scripts/bump-version.js 3.16.0` (6 stamps) +
   `tests/version.test.js` green at `3.16.0`.
6. **Docs:** prepend a `## v3.16.0 …` section to `plugins/crews/AGENTS.md` documenting the
   engine-aware codex skill-mention rewrite (mechanism, the single `spawnMember` site, the
   PS single-quote `$`-survival gotcha, the "forensic envelope keeps `/`" note, and the
   "don't put the swap in the launcher builders" gotcha) and a `## 3.16.0 - <date>` entry to
   `plugins/crews/CHANGELOG.md`.
7. **Full suite green:** `node plugins/crews/tests/run.js` passes (run from a clean env per crews
   AGENTS.md "Test cadence" — clear inherited `CREWS_*` + agent-session env). `node --check` on
   every touched JS file.

**Out of scope (LEAD post-ship):** codexu `AGENTS.md` re-enablement note, `CREWS_ENGINE=codex`
re-validation, `.ralph-overview/data.json` bookkeeping, memory flip, submodule-pointer bump,
3-remote push. Do NOT `git add CLAUDE.md`.

**Verification:** all of AC3/AC4/AC5/AC7 green; AGENTS.md + CHANGELOG updated.

---

## Notes for the impl member

- Commit on a **submodule** topic branch `ralph/<task-id>` inside an
  `ai-developer-toolkit/.worktrees/<task-id>` worktree; the LEAD does FF-merge + push to the 3
  remotes. (This is the IMPL phase's submodule worktree — distinct from THIS plan worktree, which
  is a codexu worktree.)
- The fix is small and cohesive — both stories ship in ONE impl member, serially.
- If the US-001 probe is blocked (codex unavailable / interactive-only), proceed with US-002 using
  the `$implement-with-ralph` bare form (source-evidence default) and mark the namespaced-`:` test
  as a hardening case; record the probe gap in the done report so the lead can verify the slug
  before re-enabling `CREWS_ENGINE=codex`.
