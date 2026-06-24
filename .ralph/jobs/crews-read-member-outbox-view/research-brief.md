# Research Brief: read-member outbox-view ergonomics (crews D-001)

Repo for code changes: `ai-developer-toolkit` submodule, path
`plugins/crews/`. Plan deliverables are codexu-tracked under
`.ralph/jobs/crews-read-member-outbox-view/`. Source read at the PRIMARY
checkout (submodule initialized): `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews`.

## Researcher Findings (self, source-verified)

### Premise (confirmed): read-member already reads the OUTBOX
- `hooks/commands/read-member.js:92` — `const envelopes = readOutbox(name, crew, stateCwd);`
- `hooks/mailbox.js:821-824` — `readOutbox` reads `getOutboxPath(...)` via `readJsonLinesStrict`.
- `hooks/mailbox.js:975-986` — `formatOutboxEntries(name, crew, envelopes, baselineSeq)` renders
  `--- seq <n> · <writtenAt> · kind=<k>[ · summary="..."]` then `e.body || e.message || e.text`.
- `hooks/commands/review-mail.js:306-310` — review-mail (NOT read-member) reads inbox-history.
- Registry description today (`read-member.js:139`): "Lead-only command to pull new outbox
  envelopes from one member and advance the cursor." `roleVisibility: ['lead']` (`:141`).

### read-member.js handler shape (the surgical edit target)
`handler(ctx, args)` (`read-member.js:77-107`):
- Resolves `stateCwd`/`crew`; slash path asserts active lead session; cli path requires
  `--as <lead>` resolves to a lead (auth UNCHANGED — do not touch).
- `read-member.js:91-92` — `name = sanitizeName(args.name); const envelopes = readOutbox(...)`.
- `:93-97` — `cursor = readCursor(...)`; `baseline`: `--all` -> -Infinity; finite `--since` ->
  args.since; else cursor[name] || 0.
- `:99` — `const fresh = envelopes.filter(e => Number.isFinite(e.seq) && e.seq > baseline);`
- `:100-104` — **cursor advance** (default reads only): `if (!args.peek && !args.all &&
  !Number.isFinite(args.since) && fresh.length > 0) { maxSeq = max over fresh; cursor[name] =
  maxSeq; writeCursor(...) }`.
- `:106` — `return { name, crew, fresh, cursor, baseline, args };`
- `formatSuccess(result)` (`:116-123`): slash -> `formatOutboxEntries(...) + slashSuffix(result)`;
  cli `--pretty` -> `formatOutboxEntries(...)`; cli default -> `JSON.stringify(result.fresh,
  null, 2)`.
- `slashSuffix(result)` (`:109-114`): `--peek` / `--all`|`--since` -> "(cursor NOT advanced ...)";
  else `fresh.length>0 ? " (cursor advanced to seq N)" : ""`.

**Filter implementation (display-only):** rename the cursor-math variable to `freshAll` (= the
existing `fresh`), keep cursor advance computed over `freshAll`, then compute
`displayed = freshAll.filter(kindPredicate)`; return `displayed` for formatting and carry
`hiddenByFilter = freshAll.length - displayed.length` + `filtered` flag + (when advanced)
`cursorAdvancedTo`. This mirrors the review-mail collapse precedent exactly.

### review-mail DISPLAY-ONLY precedent (the cursor invariant)
- `review-mail.js:312-318` — comment: cursor advancement "operates on allRows — collapse can
  never affect lastReviewedSeq."
- `review-mail.js:319-341` — display rows are collapsed (display-only).
- `review-mail.js:348-352` — `reviewedSeq = allRows.reduce(max ...)` — advances over the
  UNFILTERED set, not the collapsed display rows.
This is the canonical pattern read-member's kind filter must copy: advance over `freshAll`.

### parseSlash value-flag guard (the --since precedent for --kind)
`read-member.js:23-39`:
```
const tokens = prompt.split(/\s+/).slice(1);
const sinceIdx = tokens.indexOf('--since');
const sinceValueIdx = sinceIdx >= 0 ? sinceIdx + 1 : -1;
const sinceValue = sinceValueIdx >= 0 ? tokens[sinceValueIdx] : null;
const nameRaw = tokens.find((t, i) => !t.startsWith('--') && i !== sinceValueIdx);
```
For `--kind` add a symmetric `kindIdx`/`kindValueIdx`/`kindValue`, and extend the name finder:
`!t.startsWith('--') && i !== sinceValueIdx && i !== kindValueIdx`. `--no-progress` is boolean
(`tokens.includes('--no-progress')`) and needs no value-index guard.

### parseCli (parseCrewArgs flags schema)
`read-member.js:41-75` builds `parseCrewArgs(argv, { positional:[{name}], flags:{ crew, stateCwd,
asName, peek(bool), all(bool), since(string), pretty(bool) } })`. Add
`kind: { type: 'string', alias: '--kind' }` and `noProgress: { type: 'boolean',
alias: '--no-progress' }`. `parseCrewArgs` auto-rejects unknown flags
(`tools/lib/parse-crew-args.js:48-51`), so the existing unknown-flag test keeps passing. A value
flag at end-of-argv yields `flags[key] = undefined` (`parse-crew-args.js:54-57`) — distinguish
`undefined` (flag present, missing value -> throw CommandInputError) from `null` (flag absent).

### Outbox row schema (kind filter is safe)
`buildOutboxEntry` (`hooks/mailbox.js:745-766`): every v2 row carries `protocolVersion, seq, id,
writtenAt, kind, summary, body, message, from, replyTo, acks, decisions, hops`. So `row.kind`
is present. Decision: `--no-progress` == `row.kind !== 'progress'` (legacy/missing-kind rows are
shown — they are not progress); `--kind <list>` == `row.kind ∈ list` (legacy/missing-kind rows
excluded). Both flags together = AND (intersection). Valid kinds: `progress|done|question|blocked`.

### Discoverability mechanics (why D-002 is warranted)
- `tools/crews.js:11-16` — `cliSubcommands()` maps **`command.name` only**, never aliases, then
  `.sort()`. So an alias `read-member-reports` does NOT appear in `node tools/crews.js` top-level
  usage. CONFIRMED invisibility condition #1.
- `scripts/gen-skills.js:204-214` — `shippedCommands()`/`generatedSkills()` iterate `COMMANDS`
  (one SKILL.md per command NAME). An alias generates NO SKILL.md, so Copilot/Codex slash
  discoverability won't surface `/crews-read-member-reports` as its own skill. CONFIRMED
  invisibility condition #2.
- Alias dispatch requires BOTH: (a) `read-member.js` module export `aliases:['read-member-reports']`
  for `runtime.js:14-17` `promptMatches` (slash); (b) `registry.js:10` COMMAND_DEFINITIONS
  `aliases:['read-member-reports']` for `findCommand` (`registry.js:65-76`) used by both slash
  `findSlashCommand` and CLI `runCliCommand`.

Because BOTH brainstorm-named invisibility conditions are confirmed met, the brainstorm's own
criterion says fold in **D-002**: a thin first-class `read-member-reports` registry entry that
DELEGATES to read-member's handler/parser/formatter (no second outbox reader). This gives full
discoverability: appears in `tools/crews.js` help (cliSubcommands maps its name) AND generates
its own Claude + Copilot SKILL.md. Tradeoff: +1 command surface, +parity/registry-shape test
updates. The lighter alias-only path (D-001) remains the documented fallback if minimal surface
is preferred.

### Tests impacted (plugins/crews/tests/, run via tests/run.js)
- `command-compat-read-member.test.js` — extend: mixed-kind outbox rows; `--kind`/`--no-progress`
  in JSON + `--pretty`; cursor-advances-past-hidden-progress regression. (Note: this file asserts
  `read-member emits no appendLog line` — keep the filter path appendLog-free.)
- `command-args-parity.test.js` — extend: new flags accepted; unknown-flag rejection still fires
  (line 124 currently `readMember.surfaces.cli.parseArgs(['alice','--unknown-flag'])` throws);
  slash-parser cases (`/read-member --kind question alice`, `/read-member alice --kind question`,
  missing `--kind` value, `--since 5 --kind done alice`). NOTE: `bothSurfaceMutating` count===10
  (line 39) and `us005ReadOnlyCli` set both EXCLUDE read-member (auth shapes differ), so a new
  read-only `read-member-reports` is NOT auto-added to either — no count break there, but add a
  dedicated dispatcher test.
- `command-registry-shape.test.js:76-97` — `listCommands('lead', {})` pins the EXACT lead-visible
  command array. A new lead-visible `read-member-reports` MUST be inserted into this expected
  array (after `read-member`). `listCommands('member', {})` (member array) is unaffected
  (read-member-reports is lead-only). This is one of two hard test-updates if D-002 is adopted.
- `dispatcher-help.test.js` — `CLI_SUBCOMMANDS` is `COMMANDS.filter(cli enabled).map(name).sort()`
  and is asserted with `deepEqual([...])`. A first-class cli-enabled `read-member-reports` appears
  here and MUST be added to the expected array (sorted position right after `read-member`). The
  test also runs `--help` for each subcommand, so the delegating command needs a working
  usage/`--help` (delegation provides it). Second hard test-update for D-002.
- `briefing-discoverability.test.js` — skill-count LOWER bound (">= 19/20"); adding a skill stays
  above, no break. (Verify exact bound at impl.)
- `version.test.js` — only the version-string bump (6 stamps).

### Wording rewrite + regeneration
- `read-member.js` `description` (`:139`) and `usage` (`:140`, `:15-21` USAGE) -> "the reports
  this member SENT / member output / outbox.jsonl", with examples
  `read-member alice --no-progress --pretty` and `/crews:read-member alice --kind done,question,blocked`.
- Run `node plugins/crews/scripts/gen-skills.js` (write mode) to regenerate both
  `skills/read-member/SKILL.md` and `.copilot-plugin/copilot-skills/read-member/SKILL.md` (and the
  new `read-member-reports` skill dirs if D-002). The `--check` mode in CI (gen-skills.js:245-258)
  fails if SKILL.md drifts, so regeneration is mandatory.
- `plugins/crews/AGENTS.md` — add a new version section documenting the filter + wording + the
  read-member-reports surface.
- Version bump via `node plugins/crews/scripts/bump-version.js <x.y.z>` (6 stamps:
  `.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json`, 3
  marketplace indexes) + `tests/version.test.js`.

## Architect Analysis
The change is additive and display-only. The single load-bearing invariant is "cursor advances
over the unfiltered fresh set" — wired by keeping the existing cursor-advance math on `freshAll`
and only filtering the OUTPUT. The footgun disclosure must reach all three output surfaces
(slash text, cli `--pretty` text, cli default JSON). The default unfiltered CLI JSON-array shape
must stay byte-identical (scripts depend on it); filter metadata is added only when a filter flag
is present. Auth/roleVisibility are untouched. D-002's delegating command must reuse the SAME
parse/handler/format functions — never fork a second outbox reader (drift risk on cursor/auth).

## Open Questions / Decisions
1. **D-001 alias vs D-002 first-class command** — RECOMMEND D-002 (first-class delegating
   command) because both brainstorm-named invisibility conditions (CLI help + per-engine skill)
   are confirmed met. Alias-only is the documented fallback. (The one extra test cost is the
   command-registry-shape lead array.)
2. `--no-progress` semantics — DECIDED: exactly `kind !== 'progress'` (legacy/missing-kind rows
   shown). `--kind <list>` excludes legacy/missing-kind rows. Both together = AND.
3. `--kind` value form — DECIDED: comma-separated multi-kind (`--kind done,question,blocked`),
   matching the operator seed example.
4. CLI default-JSON disclosure shape — DECIDED: unfiltered -> bare array (unchanged); filtered ->
   additive object `{ fresh: displayed, filteredKinds, hiddenByFilter, cursorAdvancedTo }`.
