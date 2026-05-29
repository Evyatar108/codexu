# Research Brief: Suppress lead `<|report kind=...|>` footer-tag requirement

## Note on staging collision
A concurrent plan member (working on `crews-envelope-body-canonical-for-all-kinds`) overwrote the shared `<JOBS_BASE>/.staging/<session_id>/feature-request.txt` mid-Phase-2. The Explore researcher + architect were re-launched too late to switch paths and re-read the (wrong) feature-request — their analyses are framed around the body-canonical task. However, the **structural file:line findings transfer directly** to the lead-suppress task and are captured below. Codex + Copilot were re-launched against a uniquely suffixed staging directory and returned correct-scope analyses.

## Note on Copilot scope overflow
The Copilot research call went beyond research mode and directly edited 14 files on `D:/ai-developer-toolkit` `main` branch (`plugins/crews/hooks/stop.js`, `plugins/crews/hooks/briefing/template.js`, plus templates, CHANGELOG, CLAUDE.md, goldens, tests, manifest, marketplace files, plus an unrelated `resume-crew.js` PowerShell fix). The diff matches the design described below — they validate it but were applied without phase discipline. **Open question for the operator:** decide whether the impl-phase member should accept those pre-existing edits as a starting point (then drive Phase 5a/5b review on them) or discard them and implement fresh from this plan.

---

## Researcher Findings (Explore agent)

Source: `D:/ai-developer-toolkit/plugins/crews/`

### SessionStart Pipeline
- **Claude entry:** `hooks/session-start.js` lines 233-354. Dispatches to `memberContext()` or `leadContext()` (lines 304, 351), imported from `briefing/context.js`.
- **Copilot entry:** `hooks/copilot-session-start.js` lines 1-74. Wraps the same `handleInput`, sets `process.env.CREWS_ENGINE = 'copilot'`. Same briefing pipeline.
- **Context builder:** `hooks/briefing/context.js` lines 22-63. `briefingContext()` builds `{ role, engine, name, crew, ... }`. `memberContext()` and `leadContext()` (lines 57-63) call `render('member', ctx)` / `render('lead', ctx)` — **role is already plumbed through**.
- **Render logic:** `hooks/briefing/render.js` lines 1-13. Simple loop through `BRIEFING.sections` calling each section's `lines(ctx)` function. Existing sections (e.g., listener-arm at template.js:13-65) already gate on `ctx.role` via early-return.
- **Template:** `hooks/briefing/template.js` lines 68-219. Key sections that mention/require the kind tag:
  - `footer-tag` (lines 108-130) — primary instruction block.
  - `examples` — example turn tags.
  - `resume-protocol` — "end with the kind tag" line in the listener-resume flow.
  - `rules` — restates the requirement.

### Stop Hook
- `hooks/stop.js` line 632-633: `const tags = parseTurnTags(text);`
- **Missing-kind block** lines 635-647 — currently role-agnostic:
  ```javascript
  if (!tags.kind) {
    if (isRetry) { /* allow */ return; }
    bumpBlockCount(..., 'missing kind tag');
    out.stdout.write(JSON.stringify({
      decision: 'block',
      reason: buildBlockReason(...)
    }));
    return;
  }
  ```
- **Manifest update path** lines 706, 807: `lastKind: tags.kind, lastSummary: effectiveSummary`. **Depends on `tags.kind` being non-null.**
- **decideStopBlock** lines 433-471 already accepts `kind` via the call site. The strict-mailbox-resolution gate inside is independent of the kind-tag requirement.
- **shouldRequireArmedListener** lines 60-64 — role/kind/queueDepth gate, already symmetric for both roles.
- **Summary fallback** `mailbox.js:799-805` — `synthesizeSummary(body)` already derives a summary from the first prose line when the tag omits it. This is the existing behavior leads will inherit.

### Manifest schema (`hooks/protocol/manifest.js`)
- `manifestFields` lines 5-47 includes `'lastKind'` (line 27) and `'lastSummary'` (line 28).
- Validation line 90: `if (m.lastKind !== undefined && m.lastKind !== null && !tagKindEnum.includes(m.lastKind)) return fail(...)`. **null lastKind is already accepted.**
- `stringFields` validation lines 86-87: `lastSummary` may be null or string.

### list-members rendering (`hooks/actors.js`)
- `formatMemberList` lines 1051-1078. `pad(r.lastKind, 9)` at line 1068 — null renders as `-` (the `pad` helper's default), **NOT** as a "broken" indicator. No color coding or warning glyph. The fallback summary derived from prose first-line displays cleanly in the Summary column.

### Existing tests
- `tests/role-gate.test.js` — already exercises lead Stop with a tag, asserts lead outbox writes. **Natural home** for a lead-no-tag fixture.
- `tests/stop-decision.test.js` — covers `decideStopBlock` only, not the missing-kind block. Not the natural home for new fixtures unless extended to drive `handleInput`.
- `tests/briefing-render.test.js` — diffs against `tests/golden/briefing-lead.md` and `tests/golden/briefing-member.md`. The lead golden will need updating; the member golden must remain byte-identical.
- `tests/briefing-structure.test.js` — currently expects the `footer-tag` section in both roles. Must be updated to expect member-only.
- `tests/copilot-briefing.test.js` — per-engine + per-role briefing wording checks.
- `tests/version.test.js` — pins `1.7.3` across release metadata files.
- Test runner: custom `tests/run.js` with plain Node assertions (`./lib/assert`).

### Versioning
- `plugins/crews/.claude-plugin/plugin.json` line 4: `"version": "1.7.3"`
- `plugins/crews/.github/plugin/plugin.json` line 4: `"version": "1.7.3"`
- Marketplace mirrors: `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json` (5 files total; same v1.7.3 string).
- Helper: `plugins/crews/scripts/bump-version.js <new-version>` — updates all five manifest files AND `tests/version.test.js` in one shot.

## Architect Analysis (Explore agent)
*Framed around body-canonical scope but architecture observations transfer:*
- All `lastKind` consumers (`status.js:52`, `actors.js:1068`, `crews.js:155`) already tolerate null — they render `'(none yet)'` or `-`. No schema/refactor needed.
- Role is set at SessionStart from `CREWS_ROLE` env var via `applyEnvRole()` (session-start.js:249). Immutable per session — `/assign-role` does not re-run SessionStart. Stale-briefing risk after mid-session role flip is low (rare admin op, next tab refresh re-renders).
- Cached briefing per-session: SessionStart runs once. Existing live lead sessions on v1.7.3 keep their old briefing. Only sessions spawned after the plugin cache refresh to v1.7.4 see the new briefing — this is the desired behavior.
- Two concurrent leads in different crews on the same workspace: each gets its own briefing context with its own `crew`/`role`. No shared state issue.
- `briefing/render.js` sections already follow the `lines: ctx => {...}` pattern with role-aware early-return (e.g., listener-arm at template.js:13-65). Adding a role gate to `footer-tag`, `examples`, plus tag-references inside `resume-protocol`/`rules` is a minimal-surface change.

## Codex Research (correct-scope)
*Key new findings beyond the Explore agents:*

**Critical design pivot** — A lead prose-only turn cannot simply pass through with `tags.kind = null`, because the existing outbox-append + manifest-update path at `stop.js` lines 698-708 depends on `tags.kind` being non-null (it serializes into the outbox envelope and `manifest.lastKind`).

**Recommended fix:** After role check, default missing lead kind to `'progress'` internally:
- `if (!tags.kind && state.role === 'member')` → keep existing block.
- `if (!tags.kind && state.role === 'lead')` → synthesize `tags.kind = 'progress'` and continue through existing success path.

This preserves the existing outbox/manifest flow, keeps `lastKind` schema-valid, and lets `lastSummary` derive from `synthesizeSummary(tags.body)`.

**Strict mailbox-resolution gate is independent.** If a lead consumed non-exempt mail, Stop must still block until acked/replied — only the missing-kind block becomes member-only.

**Test home recommendation:** `tests/role-gate.test.js` (already exercises lead Stop) is a better home than `tests/stop-decision.test.js`. Consider new `tests/lead-footer-tag.test.js` for the lead-specific behavior. Add a member no-tag regression to lock in the unchanged member behavior.

**Version bump tooling:** `node plugins/crews/scripts/bump-version.js 1.7.4` from the repo root — one command, updates two plugin manifests, three marketplace indexes, and `tests/version.test.js`.

**Docs scope:** Update `plugins/crews/README.md` (Turn-End Reports section if present), `plugins/crews/CLAUDE.md` (v1.7.4 section), `plugins/crews/CHANGELOG.md`, and optionally `.github/plugin/hooks.json` comments that imply uniform footer enforcement.

## Copilot Research (correct-scope, plus side-effect implementation)
- Confirmed the same overall design (lead role-gated, default to `'progress'` internally).
- Implementation hint: introduce a small helper `effectiveTurnKind(role, parsedKind)` to centralize the default. Replace `tags.kind` with `turnKind` in all downstream consumers within `handleInput`.
- Lead-specific error tailoring for the empty-body-and-no-summary path: "Your lead turn had no prose body and no summary metadata. Write a short prose update. Routine kind footers are not required for leads."
- Lead-specific tailoring of the unresolved-consumed-mail reason text: replace `'reply with reply-to="<id>" on your kind tag'` with `'reply with reply-to="<id>" on a <|report ...|> metadata tag'`.
- Tests-side: also assert that lead mailbox `ack` metadata resolves consumed mail without a `kind`.
- Side-effect: full 236-test suite reported green after Copilot's edits (per Copilot output narrative; not independently verified by this plan member).
- Side-effect: Copilot also fixed an unrelated `hooks/commands/resume-crew.js` PowerShell PID-verification timing flake in the test runner. **This change is OUT OF SCOPE for the lead-suppress task** and should be either reverted from the impl member's branch or split into a separate task.

## Consolidated File List

### Files to modify (in-scope for this plan)
- `plugins/crews/hooks/briefing/template.js` — split `footer-tag` section + relevant lines in `examples`, `resume-protocol`, `rules` to render only when `ctx.role === 'member'`.
- `plugins/crews/hooks/stop.js` — introduce `effectiveTurnKind(role, parsedKind)` helper. Gate the `!tags.kind` block on `state.role === 'member'`. Replace `tags.kind` with `turnKind` in outbox-append (line 700), manifest-update (lines 706, 807), and `decideStopBlock` call (line 676). Tailor the lead-specific empty-body and unresolved-consumed-mail reason text.
- `plugins/crews/CLAUDE.md` — add v1.7.4 section documenting the role-asymmetric behavior so future contributors don't "fix" the lead path back to symmetric.
- `plugins/crews/CHANGELOG.md` — v1.7.4 entry bullet list.
- `plugins/crews/.claude-plugin/plugin.json` — version → 1.7.4 (via `bump-version.js`).
- `plugins/crews/.github/plugin/plugin.json` — version → 1.7.4 (via `bump-version.js`).
- `.agents/plugins/marketplace.json` — crews entry version → 1.7.4 (via `bump-version.js`).
- `.claude-plugin/marketplace.json` — crews entry version → 1.7.4 (via `bump-version.js`).
- `.github/plugin/marketplace.json` — crews entry version → 1.7.4 (via `bump-version.js`).
- `plugins/crews/tests/golden/briefing-lead.md` — regenerate (lose footer-tag instruction block, examples tag lines, resume-protocol tag-end line, rules kind-tag line).
- `plugins/crews/tests/golden/briefing-member.md` — verify byte-identical (no change expected).
- `plugins/crews/tests/briefing-structure.test.js` — relax footer-tag section assertion to member-only.
- `plugins/crews/tests/briefing-render.test.js` — passes by golden file regen.
- `plugins/crews/tests/copilot-briefing.test.js` — update per-engine + per-role assertions.
- `plugins/crews/tests/role-gate.test.js` (or new `plugins/crews/tests/lead-footer-tag.test.js`) — add lead-no-tag-passes fixture, member-no-tag-blocks regression, lead-no-tag-with-prose populates lastSummary, lead-no-tag-with-unresolved-mail still blocks.
- `plugins/crews/tests/version.test.js` — version → 1.7.4 (via `bump-version.js`).

### Files referenced but NOT modified
- `plugins/crews/hooks/protocol/manifest.js` — null `lastKind` already allowed (line 90). No schema change needed.
- `plugins/crews/hooks/actors.js` — `formatMemberList` already renders null `lastKind` cleanly. No change needed.
- `plugins/crews/hooks/commands/status.js` — already renders `lastKind || '(none yet)'`. No change needed.
- `plugins/crews/hooks/crews.js` — `snapshotCrew` already maps missing `lastKind` to null. No change needed.
- `plugins/crews/hooks/mailbox.js` — `synthesizeSummary(body)` fallback already exists. No change needed.
- `D:/harness-efforts/codexu/CLAUDE.md` — the bookkeeper guide references the plugin's SessionStart briefing but does not itself mandate the tag. No change needed.

### Out-of-scope edits Copilot already applied
- `plugins/crews/hooks/commands/resume-crew.js` — PowerShell PID-verification hardening. Unrelated. Must be reverted on the impl member's branch or split into a separate task.
