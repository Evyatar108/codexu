# Skill Suggestions

## Candidate: regen-copilot-mirrors
- Description: Codify the "after any plugin skill edit, regenerate Copilot mirrors and run drift-check" workflow for plugins that ship `dist/copilot/` mirrors (ralph-overview, ralph), so the v5.36.0 mirror-parity gate is satisfied automatically and reviewer-side findings like F-001 (un-substituted Skill(...) invocations) are caught before code review.
- Triggers: User edits any `plugins/<plugin>/skills/*/SKILL.md`, adds a new `skills/<name>/` directory, or modifies the plugin's `scripts/generate-copilot-artifacts.mjs`. Also when the user says "regenerate copilot mirrors", "drift-check mirrors", or "verify mirror parity".
- Target location: `plugins/ralph-overview/skills/regen-copilot-mirrors/SKILL.md` (and an analogous one under `plugins/ralph/skills/` if the Ralph generator should be invoked the same way).
- Evidence:
  - US-001 progress.txt entry (line 15): two-step `--write` then drift-check command pair.
  - US-004 progress.txt entry (line 66) and prd.json verifiedEvidence for US-004 AC4-AC6: same command pair plus source/mirror count parity check (`source=7 mirror=7`).
  - code-review-findings.json F-001 (High-Medium, Completeness): mirror generator copied verbatim, missing the substitution step the Ralph generator applies — exactly the kind of error a checklist skill prevents.
  - Commit `a438ef79` (`fix: [F-001] - apply Copilot substitutions in ralph-overview skill mirror generator`) implementing the substitution pass.
  - prd.json US-001 acceptance criterion: `templates/overview-config.template.json watcher.ignored ⊇ DEFAULT_IGNORED` — same "regenerate-and-verify-parity" shape, suggesting the pattern recurs across more than just SKILL.md mirrors.
- Rationale: The drift-check command surface and the v5.36.0 mirror-parity gate are not obvious to a fresh agent editing a SKILL.md, and missing the regen step produced a real High-promoted reviewer finding in this job. A short skill that lists the exact commands plus the source-vs-mirror count assertion turns a recurring two-step verification into a single trigger. Existing inventory does not cover this: `plugins/ralph-overview/skills/` ships `blocker-report`, `triage`, `work-on` (consumer-side task ops) and the new `overview-*` skills are user-facing scaffolding tools, not maintainer post-edit checks.

## Candidate: force-add-shipped-artifacts
- Description: Document and automate the "gitignored-but-intentionally-shipped" staging pattern for plugins where `bin/` and `dist/copilot/` are git-ignored at the repo root yet must be committed as plugin payload, requiring `git add -f <path>` before each release commit.
- Triggers: User edits any file under `plugins/<plugin>/bin/` or `plugins/<plugin>/dist/copilot/` and then stages a commit. Also when the user runs `/release-plugin` against ralph-overview, or asks "why is my dist/copilot change not showing in git status".
- Target location: `plugins/ralph-overview/skills/release-shipped-artifacts/SKILL.md` (plugin-local, since the ignore convention is ralph-overview-specific today) — or fold into the existing repo-level `/release-plugin` skill as an extra Step.
- Evidence:
  - progress.txt "Codebase Patterns" line 4: "ralph-overview ships intentional artifacts under repo-ignored `bin/` and `dist/copilot/`; use `git add -f` for those paths when updating the dispatcher or Copilot mirrors."
  - US-001 progress.txt "Learnings" (line 18): "The plugin's root `.gitignore` ignores `bin/` and `dist/`, so intentional shipped dispatcher/mirror artifacts need force-add staging."
  - US-004 commit `018369bc` and US-005 commit `f84debcb` both stage `dist/copilot/*` files that would otherwise be ignored.
- Rationale: This is a true footgun — `git status` silently omits these files and a fresh agent shipping a new skill would push a release commit missing the generated mirror, breaking the v5.36.0 parity gate at install time. The existing `/release-plugin` skill at `.claude/skills/release-plugin/SKILL.md` covers manifest/index/changelog/commit/push but does not call out the `git add -f` step for ignored-but-shipped paths. Either extending `/release-plugin` with a pre-commit "force-add ralph-overview shipped artifacts" step, or shipping a small standalone skill, would prevent the silent-omission failure mode. Lower signal than the mirror-regen candidate because it only surfaced in two progress entries (one explicit learning + one Codebase Pattern row) and never broke a verification gate in this job.
