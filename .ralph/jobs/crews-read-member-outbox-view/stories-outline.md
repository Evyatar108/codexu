# Stories Outline: read-member outbox-view ergonomics (crews D-001 + D-002)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*
*Single serial cluster `read-member-outbox-view` (same-plugin; cannot parallelize — see plan Suggested Decomposition).*

## US-001: `--kind` / `--no-progress` parsing
**Description:** As a lead reviewing a member's sent reports, I want `--kind <k[,k...]>` and `--no-progress` flags parsed on both the slash and CLI surfaces of `read-member`, so I can ask for a filtered view.
**Acceptance Criteria:**
- [ ] `parseSlash` (read-member.js:23-39) gains a `--kind` value-index guard symmetric to `--since`: compute `kindIdx`/`kindValueIdx` and extend the positional name finder to `!t.startsWith('--') && i !== sinceValueIdx && i !== kindValueIdx`. `--no-progress` is a boolean token.
- [ ] `parseCli` (read-member.js:41-75) adds `kind: { type: 'string', alias: '--kind' }` and `noProgress: { type: 'boolean', alias: '--no-progress' }` to the `parseCrewArgs` flags schema.
- [ ] `--kind` accepts comma-separated tokens; each is validated against `{progress,done,question,blocked}`. An invalid token throws `CommandInputError`. A `--kind` flag with no value (parseCrewArgs yields `undefined`) throws `CommandInputError`.
- [ ] Existing unknown-flag rejection still fires (`command-args-parity.test.js` `read-member` `--unknown-flag` throws).
- [ ] Both parsed args carry `kinds` (normalized array or null) and `noProgress` (bool) for the handler.
- [ ] Typecheck passes (`node --check`).
**Dependencies:** None
**Estimated complexity:** small

## US-002: display-only filter in handler (cursor advances over the unfiltered fresh set)
**Description:** As a lead, I want filtered rows rendered while the per-crew cursor still advances over the full fresh set, so filtered-out progress rows never resurface on a later default read.
**Acceptance Criteria:**
- [ ] In `handler` (read-member.js:77-107), the existing `fresh` becomes `freshAll`; the cursor-advance block (currently :100-104) keeps computing `max(freshAll.seq)` and writing the cursor on default (non `--peek`/`--all`/`--since`) reads ONLY.
- [ ] `displayed = freshAll.filter(predicate)` where the predicate ANDs: `--kind` -> `row.kind ∈ kinds`; `--no-progress` -> `row.kind !== 'progress'`. With no filter, `displayed === freshAll`.
- [ ] `--no-progress` shows legacy/missing-kind rows (they are not `'progress'`); `--kind <list>` excludes legacy/missing-kind rows.
- [ ] Handler returns `{ name, crew, fresh: displayed, freshAll, cursor, baseline, args, filtered, hiddenByFilter, cursorAdvancedTo }`.
- [ ] Regression: a DEFAULT `--no-progress` read over an outbox of progress+done rows advances the cursor to `max(freshAll.seq)`; a SUBSEQUENT default read returns no rows (hidden progress rows do NOT resurface). Mirrors review-mail.js:348-352.
- [ ] `read-member` still emits no `appendLog` line (`command-compat-read-member.test.js:85`).
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: hidden-by-filter disclosure across all three surfaces
**Description:** As a lead, I want the response to disclose when a filter hid rows while the cursor advanced, so an empty/partial result is never mistaken for "nothing was sent".
**Acceptance Criteria:**
- [ ] Slash `formatSuccess`/`slashSuffix`: when `hiddenByFilter > 0`, append a note (e.g. `[N hidden by filter]`); when `displayed` is empty but `freshAll` was non-empty, render "no matching envelopes; cursor advanced to seq N" instead of the misleading bare "(no new envelopes...)" line.
- [ ] CLI `--pretty`: same inline disclosure appended to `formatOutboxEntries` output.
- [ ] CLI default JSON: when NO filter flag is present, output the byte-identical bare array `JSON.stringify(fresh, null, 2)` (unchanged contract). When a filter flag IS present, output an additive object `{ fresh: displayed, filteredKinds, hiddenByFilter, cursorAdvancedTo }`.
- [ ] `cursorAdvancedTo` is the advanced seq on a default read, else null.
- [ ] Typecheck passes.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: D-002 first-class delegating `read-member-reports` command
**Description:** As a lead/user, I want a discoverable `read-member-reports` command (visible in CLI help + per-engine skills) that does exactly what `read-member` does, so the "view a member's sent reports" capability is findable by name.
**Acceptance Criteria:**
- [ ] Refactor read-member into a small command factory / shared core parameterized by command
  identity (extract the parse/filter/cursor/handler/format LOGIC once). New
  `hooks/commands/read-member-reports.js` builds its surfaces + module exports from that core with
  its OWN `name: 'read-member-reports'`, `description`, `usage`, `surfaces.cli.usage`, slash usage,
  and error-prefix strings (NO forked outbox reader). `roleVisibility: ['lead']`.
- [ ] `read-member-reports --help` (and slash usage/error text) say `read-member-reports`, not
  `read-member` (runtime.js:59-61 uses `surface.usage`; read-member's reused parseSlash/formatError
  hard-code `/read-member` at :29-31 / :125-129 — the factory must override these).
- [ ] Registered in `hooks/commands/registry.js` `COMMAND_DEFINITIONS`.
- [ ] Dispatches on slash (`/read-member-reports`, `/crews:read-member-reports`, Copilot
  `/crews-read-member-reports`) and CLI (`node tools/crews.js read-member-reports ...`), and appears
  in `tools/crews.js` top-level help (`cliSubcommands`).
- [ ] Carries the same `--kind`/`--no-progress` filters (shared core).
- [ ] New dispatcher/delegation test: `read-member` and `read-member-reports` produce equivalent
  filtered output AND `read-member-reports --help` shows its own identity.
- [ ] `command-registry-shape.test.js` `listCommands('lead', {})` expected array updated (after
  `read-member`).
- [ ] `dispatcher-help.test.js` `CLI_SUBCOMMANDS` `deepEqual` expected array updated (sorted).
- [ ] (Fallback path if operator chooses minimal surface: instead of the new module + factory, set
  `aliases:['read-member-reports']` on BOTH the `read-member.js` module export and the
  `registry.js` read-member definition; drop the factory, the two pinned-array updates, and the
  dispatcher test. See plan Open Question #1.)
- [ ] Typecheck passes.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** medium

## US-005: wording rewrite + SKILL.md regeneration
**Description:** As an operator, I want the description/usage/SKILL.md to say "the reports this member SENT / member output / outbox.jsonl" so nobody misfiles this as an inbox reader again.
**Acceptance Criteria:**
- [ ] `read-member.js` `description` (:139) and `usage` (:140 + the `USAGE` block :15-21) rewritten to "sent reports / member output / `outbox.jsonl`", including examples `read-member alice --no-progress --pretty` and `/crews:read-member alice --kind done,question,blocked`. Same for `read-member-reports`.
- [ ] `node plugins/crews/scripts/gen-skills.js` (write mode) re-run; `skills/read-member/SKILL.md`, `.copilot-plugin/copilot-skills/read-member/SKILL.md`, and the new `read-member-reports` skill dirs (both engines) are present and match.
- [ ] `node plugins/crews/scripts/gen-skills.js --check` passes (no drift).
- [ ] `tests/golden/briefing-lead.md` REGENERATED — the lead cheat-sheet renders `${usage} — ${description}` per lead-visible command, so the reworded `read-member` line + the new `read-member-reports` line change it; `tests/briefing-render.test.js` passes. (`briefing-member.md` unchanged — both commands are lead-only.)
- [ ] Typecheck passes.
**Dependencies:** US-004
**Estimated complexity:** small

## US-006: AGENTS.md section + version bump
**Description:** As a maintainer, I want a crews AGENTS.md version section and the 6-stamp version bump so the release is documented and consistent.
**Acceptance Criteria:**
- [ ] New version section in `plugins/crews/AGENTS.md` documenting the `--kind`/`--no-progress` filters (display-only, cursor-over-freshAll invariant), the "sent reports / outbox" wording, the `read-member-reports` surface, and the common-mistake gotchas (don't move cursor onto the filtered set; don't break the default JSON-array shape; don't fork a second outbox reader; D-002 shares logic but owns its identity strings).
- [ ] `plugins/crews/CHANGELOG.md` prepended with a `## 3.24.0` entry (CHANGELOG + AGENTS stay in lockstep per crews release convention; current head `## 3.23.2`).
- [ ] `node plugins/crews/scripts/bump-version.js 3.24.0` run (minor bump — additive; 3.23.2 -> 3.24.0) updating all 6 stamps; `tests/version.test.js` passes.
- [ ] Edits go in `plugins/crews/AGENTS.md` only — NOT codexu root AGENTS.md/CLAUDE.md.
- [ ] Typecheck passes.
**Dependencies:** US-005
**Estimated complexity:** small

## US-007: tests + full-suite green
**Description:** As a maintainer, I want comprehensive tests so the filter behavior, cursor invariant, disclosure, parsing guards, and delegation are locked.
**Acceptance Criteria:**
- [ ] `command-compat-read-member.test.js`: mixed-kind outbox rows; `--kind`/`--no-progress` in JSON + `--pretty`; `--kind done --no-progress` AND behavior; legacy/missing-kind contract (shown by `--no-progress`, excluded by `--kind`); `--kind` combined with `--all`/`--since`/`--peek`; empty-outbox case; cursor-advances-past-hidden-progress regression (default read after a filtered default read returns nothing).
- [ ] `command-args-parity.test.js`: new flags accepted; unknown-flag rejection still fires; slash-parser cases `/read-member --kind question alice`, `/read-member alice --kind question`, missing `--kind` value (throws), `--since 5 --kind done alice` (binds `alice`).
- [ ] Footgun: a filter hiding all fresh rows discloses `hiddenByFilter`/cursor-advanced in JSON object + slash/pretty text.
- [ ] Default unfiltered CLI call still returns the byte-identical bare JSON array on STDOUT.
- [ ] D-002 delegation/identity dispatcher test (US-004) + the two pinned-array updates + the regenerated `tests/golden/briefing-lead.md` (US-005).
- [ ] Tests run via `plugins/crews/tests/run.js` (clear inherited `CREWS_*` per repo convention); FIRST full run tee'd to `test-output-read-member-outbox-view.log`; full suite passes (target < 60s on Windows at default concurrency). RUN the full suite and update ANY pinned command-list / skill-presence / golden assertion that breaks — the suite is the source of truth (known breakers: registry-shape lead list, dispatcher-help CLI_SUBCOMMANDS, briefing-lead.md golden, gen-skills --check; NOT auto-broken: dispatcher-routes/shim-deprecation/cheatsheet/tool-help/command-compat-list-members).
- [ ] Typecheck passes on every changed `.js` file.
**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006
**Estimated complexity:** medium
