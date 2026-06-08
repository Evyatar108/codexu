# Findings: codex members skip `/implement-with-ralph` (implement manually instead)

<!-- ralph-meta {"overviewTaskId":"codex-member-skips-implement-with-ralph-skill"} -->

*Read-only source investigation, 2026-06-08, by the `investigate-codex-skill` member (crew `ralph-pipeline`). No code modified. Operated under a pre/post working-tree snapshot guard (HEAD `17b1e2c5`; only pre-existing generated-sidecar churn present; this findings doc is the only intended addition). Conclusion is derived from codex-fork SOURCE (file:line cited), not from a live codex spawn — the mechanism is deterministic in source, which is stronger than a single live smoke for establishing root cause.*

---

## TL;DR — the root cause (one line)

**Codex injects a skill's body ONLY when the user-turn text contains a `$skill-name` mention (sigil `$`) or a structured skill-picker selection — NOT a `/slash` command; the crews spawn prompt ends with `RUN: /implement-with-ralph …`, so codex never injects the SKILL.md, the model sees only the skill's one-line advertisement, and it implements the task manually.**

Causal chain, all cited:
- Codex's skill-mention sigil is `$`, not `/` — `utils/plugins/src/mention_syntax.rs:4` (`pub const TOOL_MENTION_SIGIL: char = '$';`).
- Every user turn runs mention-detection then injection over the turn's text inputs — `core/src/session/turn.rs:504` (`collect_explicit_skill_mentions(&user_input, …)`) → `:522` (`build_skill_injections(…)`) → `:536-538` (injects each as a `<skill>` `SkillInstructions` fragment).
- Mention-detection scans text for the `$`-sigil token (or a structured `UserInput::Skill` selection); it has no `/`-form path — `core-skills/src/injection.rs:157-169` (text branch calls `extract_tool_mentions`), `:254-256` (`extract_tool_mentions` → `extract_tool_mentions_with_sigil(text, TOOL_MENTION_SIGIL)`), `:284-312` (scans for bytes equal to the `$` sigil), `:115-155` (structured `UserInput::Skill` path = the skill-picker).
- Only when a mention resolves does `build_skill_injections` read the SKILL.md off disk and inject its full `contents` — `core-skills/src/injection.rs:38-69`. No mention ⇒ `mentioned_skills.is_empty()` ⇒ early-return empty (`:38-40`) ⇒ **the SKILL.md body is never put in context.**

So `/implement-with-ralph` in the prompt is inert prose to codex. The model is left with only the skill *advertisement* (name + one-line description, injected separately as a `developer`-role list — `core/src/context/available_skills_instructions.rs:36-38`) plus a big member preamble that says "implement task X per this plan," and it does the path of least resistance: edits files directly with its shell/apply-patch tools. That is exactly the operator-observed behavior (impl-wrapper-jobb committed `fd96f850` directly with no worktree, no Phase 5a/5b).

---

## How Claude/Copilot differ (why the same prompt works there)

In Claude Code and Copilot CLI a `/skill-name` mention in the prompt is the native skill-invocation form: the client/model expands the `/`-named skill (Claude has a `Skill` tool; Copilot maps `/skill`), so the SKILL.md workflow is loaded and followed. Codex deliberately uses a **different** mention grammar:

- `$name` → **skill popup / skill injection** (`tui/src/bottom_pane/chat_composer.rs:2368` uses `current_prefixed_token(&textarea, '$', …)`; `:2464` `insert_text.strip_prefix('$')`; selecting one emits a structured `UserInput::Skill`, the `injection.rs:135` path).
- `/name` → **built-in TUI slash commands ONLY** (`/model`, `/init`, `/diff`, `/compact`, `/resume`, `/bt`, `/si`, `/fast`, …). The slash popup is `ActivePopup::Command` (`chat_composer.rs:1640`), entirely separate from `ActivePopup::Skill` (`:1642`). Skills are **not** in the `/` namespace, so `/implement-with-ralph` matches no built-in command and is submitted as plain text.

The crews launcher passes the spawn prompt as a positional CLI arg — `codex <sandbox> -c tui.terminal_title=[] '<initialPrompt>'` (`crews/hooks/actors.js:228-229`, codex branch at `:175`). That positional prompt becomes the first user-turn `UserInput::Text`. A `$implement-with-ralph` there *would* inject; a `/implement-with-ralph` there does not.

---

## Gap classification

Task offered four hypotheses. Verdict: **primarily (c), rooted in (b). NOT (a). NOT (d).**

| Hyp | Statement | Verdict |
|---|---|---|
| (a) | Skill not exposed to codex at all | **REJECTED.** The `.codex-plugin/` overlay exists (`plugins/ralph/.codex-plugin/codex-skills/implement-with-ralph/SKILL.md`, registered via `plugin.json` `"skills":"./codex-skills/"`); the prior enablement spike confirmed all 15 `ralph-orchestration:*` skills *advertise* under codex. Exposure ≠ dispatch. |
| (b) | Codex slash/skill handling differs; an initial-prompt slash command is not dispatched | **TRUE — the structural cause.** Codex's invocation grammar is `$`-mention / skill-picker, not `/slash` (`mention_syntax.rs:4`; `chat_composer.rs:1640 vs 1642`). A `/skill` is never a skill dispatch in codex. |
| (c) | The crews spawn-prompt format (`RUN: /skill …`) does not trigger codex skill invocation | **TRUE — the proximate cause.** The spawn-prompt token is the Claude/Copilot `/`-form; codex needs `$implement-with-ralph` (or a structured selection) for `turn.rs:504` to resolve a mention. With `/`, `collect_explicit_skill_mentions` returns empty and nothing is injected. |
| (d) | The codex-skills lowering is incomplete for implement-with-ralph specifically | **REJECTED as the cause.** The lowered `implement-with-ralph/SKILL.md` exists and is structurally complete (187 KB; same frontmatter shape as the brainstorm skill that ran live). If injected it would execute (degraded per F1/F2, but it would run). The bug is *dispatch*, not *lowering*. |

The brainstorm-vs-implement asymmetry the task flagged is **not** a lowering-completeness difference. Both skills are lowered and both fail identical dispatch if invoked via `/`. The prior smoke's brainstorm "success" came from a different invocation path (see below), not from brainstorm being lowered "more completely."

---

## Cross-reference: the prior "codex runs ralph skills" claim is narrower than it reads

`.ralph/jobs/codex-engine-ralph-member-enablement/findings.md` is the source of the "codex sees + runs ralph skills" claim. Reading it precisely:

- **`implement-with-ralph` was NEVER run live under codex** — row 7 ("NOT RUN LIVE (scoped out)") and the Limitations section ("`plan-with-ralph` / `implement-with-ralph` were not run live — characterized analytically"). So the claim it covers `implement-with-ralph` end-to-end is **unsupported**; only `brainstorm-with-ralph` was executed (row 3).
- The brainstorm live run was a **direct `codex exec` probe**, not a crews `--engine codex` member spawn — row 6 explicitly records the interactive crews-member lifecycle as "NOT autonomously driveable … indirectly validated." So the brainstorm success did **not** exercise the `RUN: /implement-with-ralph`-style spawn-prompt path at all. It was invoked under controlled probe conditions where the skill was actually loaded.
- Net: the prior finding established **skill advertisement + one direct-exec brainstorm run**. It did **not** establish that a crews-spawned codex member, handed a `RUN: /skill …` prompt, dispatches the skill. This investigation fills exactly that gap — and the answer is no.

---

## Verdict: can codex be made to reliably invoke `/implement-with-ralph` (incl. Phase 5a/5b)?

**Yes — reliably and deterministically — but only by feeding codex its own mention grammar instead of the `/`-form.** Because the SKILL.md body is what carries the worktree-management + Phase 5a (code review-fix convergence) + Phase 5b (docs review-fix convergence) contract, and that body is only injected on a resolved `$`-mention/skill-selection, the fix must make the codex member's first user turn carry a real codex skill mention. With that, `turn.rs:522` injects the full implement-with-ralph SKILL.md and the model follows the worktree + Phase 5a/5b workflow.

Caveat the fix must respect: even injected, codex execution of `implement-with-ralph` is **degraded-but-functional** per the prior spike — F1 (no `invoke_skill`, internal workflows are inline-read), F2 (generic `multi_agent_v2` spawns, no typed-agent registry). Those are quality gaps, not dispatch gaps; they do not block worktree/Phase-5a/5b adherence, which all live in the orchestrator SKILL.md prose itself.

---

## Recommended fix direction (ranked; this is investigation-only — no fix attempted)

1. **PRIMARY — engine-aware spawn-prompt token (cheapest, deterministic, no engine rebuild).**
   Render the impl spawn prompt's invocation line per target engine: keep `RUN: /implement-with-ralph --from-plan … --autonomous` for Claude/Copilot, but for codex emit a real codex mention as the FINAL user-turn text, e.g. `RUN: $implement-with-ralph --from-plan … --autonomous` (the `$`-sigil mention `collect_explicit_skill_mentions`/`turn.rs:504` resolves). The plain-name path requires the name be unambiguous (`injection.rs:374-390`, `skill_count == 1`) — `implement-with-ralph` is unique, so `$implement-with-ralph` should resolve; verify the exact registered token codex advertises (`$implement-with-ralph` vs `$ralph-orchestration:implement-with-ralph`) with a one-line `codex` skill-list probe before locking it in (the mention name-char set includes `:` — `injection.rs:507`). Owner surface: the bookkeeper spawn-prompt template in codexu `AGENTS.md` ("Spawn-prompt preamble template") and/or the crews launcher if it is made to translate the token by `engine`.

2. **SECONDARY — structured skill pre-selection at spawn.**
   If/when crews can pass a structured `UserInput::Skill { name, path }` (the skill-picker path, `injection.rs:135-155`) for codex members, that injects the SKILL.md without depending on the model emitting any token. More robust than text-mention but needs a crews/codex plumbing seam that does not exist today via the positional-prompt launcher.

3. **TERTIARY / engine-side — make codex treat a `/skill` (or an explicit "invoke skill X" directive) as a skill mention.**
   A fork patch could map the `/`-form (or an instruction-detector) onto skill injection so the Claude/Copilot-shaped prompt works unmodified across engines. Highest blast radius (touches `core-skills` mention grammar + must clear the codex fork's overlay-first conflict-surface gates per `codex/CLAUDE.md` tenet 1) and unnecessary if option 1 suffices. Not recommended unless cross-engine prompt uniformity becomes a hard requirement.

**Do NOT** "fix" this by relying on a prose directive like "invoke the implement-with-ralph skill" and trusting the model to read the SKILL.md — that is the exact path that already failed (manual implementation). The deterministic lever is getting the SKILL.md body injected via a resolved mention BEFORE the model acts.

---

## Evidence index (file:line)

- `codex/external/repos/codex-patched/codex-rs/utils/plugins/src/mention_syntax.rs:4` — `TOOL_MENTION_SIGIL = '$'` (skill mention is `$`, not `/`).
- `…/codex-rs/core/src/session/turn.rs:504,522,536-538` — per-turn mention-collect → inject → `<skill>` fragment.
- `…/codex-rs/core-skills/src/injection.rs:38-69` — `build_skill_injections` reads & injects SKILL.md contents only for resolved mentions; `:38-40` empty-early-return.
- `…/codex-rs/core-skills/src/injection.rs:115-172` — `collect_explicit_skill_mentions` (structured `UserInput::Skill` at `:135`; text `$`-scan at `:157-169`).
- `…/codex-rs/core-skills/src/injection.rs:254-312,484` — `extract_tool_mentions` scans for the `$` sigil byte (test helper at `:484` scans `b'$'`).
- `…/codex-rs/core/src/context/available_skills_instructions.rs:36-38` — skill *advertisement* (name+desc) injected separately as `developer`-role list; this is all the model has without an injection.
- `…/codex-rs/tui/src/bottom_pane/chat_composer.rs:1640,1642,2368,2464` — `/` → `ActivePopup::Command` (built-ins); `$` → `ActivePopup::Skill`; skill token strips `$`.
- `ai-developer-toolkit/plugins/crews/hooks/actors.js:175,228-229` — codex member launched as `codex <sandbox> -c tui.terminal_title=[] '<initialPrompt>'` (positional prompt → first user turn).
- `ai-developer-toolkit/plugins/ralph/.codex-plugin/codex-skills/implement-with-ralph/SKILL.md` — the lowered skill exists & is structurally complete (rejects hyp (d) as cause).
- `.ralph/jobs/codex-engine-ralph-member-enablement/findings.md` rows 3/6/7 + Limitations — brainstorm ran live via direct `codex exec`; implement-with-ralph NOT run live; crews codex-member lifecycle not driven.

## Honest scope notes

- No live codex spawn was performed (read-only member; live `multi_agent_v2` codex spawns are heavy/crash-prone per repo memory, and a non-lead member cannot drive an interactive `--engine codex` member). The root cause is established from deterministic source paths, which pin the mechanism without a probe.
- The exact `$`-mention token that resolves (`$implement-with-ralph` vs a namespaced form) should be confirmed with a single `codex` skill-list probe before the PRIMARY fix is committed; the resolution logic (`injection.rs:345-396`) keys on `skill.name` (frontmatter `implement-with-ralph`) for the plain-name branch and on the `SKILL.md` path for the linked-mention branch.
