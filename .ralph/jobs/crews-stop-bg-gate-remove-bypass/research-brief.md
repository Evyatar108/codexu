# Research Brief: crews-stop-bg-gate-remove-bypass

*Plan-phase researcher findings for v3.3.0 — remove the progress + no-bg gate bypass tag.*

## Researcher Findings

### Codebase layout

The crews plugin lives at `ai-developer-toolkit/plugins/crews/` (an in-tree submodule of codexu). The submodule currently sits at `58b4b882` (v3.2.0) on `main`.

Relevant files for this change:

- `ai-developer-toolkit/plugins/crews/hooks/mailbox.js`
  - Lines 896-909: `parseTurnReports` helper sets `out.bgTask` on each report based on a bare-token regex scan over the attrs region (with quoted-region stripping). Two regexes: `/\bbackground-task\b/i` and `/\bbackground-agent\b/i`.
  - Line 921: `parseTurnReports(rawText)` is the producer.
  - Line 948: `parseTurnTags(rawText)` re-uses `parseTurnReports` and exposes the resulting reports array. The `bgTask` field rides on each `out` object returned to the caller.
  - Line 1047: `parseTurnReports` is exported from the module.

- `ai-developer-toolkit/plugins/crews/hooks/stop.js`
  - Lines 1039-1136: the v3.1.0 "progress + no-bg gate" block.
  - Lines 1067-1076: comment block enumerating the bypass forms (5 total: 1 crews-namespaced in-band + 4 legacy `<options-mode>` and CommonMark forms).
  - Lines 1083: failure-mode comment mentions "kind change or background-task tag" as the recovery path.
  - Lines 1084-1114: the `hasBgTagFromCrews` / `hasBgTagFromLegacy` / `hasBgTag` variables, plus the deprecation-warning stderr write at lines 1107-1112.
  - Line 1116: the gate trigger condition (`gateEnabled && isCopilot && isProgress && isMember && !isRetry && !hasBgTag && !isShuttingDown`).
  - Line 1128: the block message text (the one being rewritten).

- `ai-developer-toolkit/plugins/crews/hooks/detect-active-bg.js`
  - Lines 1-52: header comment explaining the detector's contract, signal sources, correlation, listener filter, and soundness.
  - Lines 86-119: `indexEvents` — the actual detector core (start↔exit indexing by shellId).
  - Lines 122-149: `compareTs` + `isActiveAt` helpers.
  - Lines 130 mentions "bypass tag" in the bias rationale comment — needs touch-up.
  - Lines 151-onwards: `detectActiveBg` entry point + v3.2.0 retry-with-backoff.

- `ai-developer-toolkit/plugins/crews/tests/progress-bg-gate.test.js`
  - 593 lines total. Cases 1-3 cover block-no-bg / block-listener-only / pass-real-bg.
  - Cases 4 (lines 365-385), 4-new (387-409), 5 (411-426), 5-new (428-449), 5b (451-468), 5c (470-485): the bypass-tag coverage. These are the v3.2.0-era test cases.
  - Case 6 (487-509): quoted-region strip-quotes defense.
  - Case 7 / 7b (511-575): F.8 detect-active-bg retry-with-backoff flush race coverage — KEEP THESE.
  - Cases 8, 9: engine=claude skip, kind=question skip — KEEP.

- `ai-developer-toolkit/plugins/crews/AGENTS.md`
  - Section "v3.1.0 progress + no-bg gate (Copilot members)" starts ~line 178 and continues through line 301.
  - Lines 226-228: the bullet listing bypass conditions in the Trigger conditions enumeration.
  - Line 236: the quoted block-message text.
  - Lines 248-250: the failure-mode discussion ("agent recovers by emitting a kind change or bypass tag").
  - The spec's "lines 41, 51" references are wrong — those lines in the current file are about v3.1.2 test catchup, not the bg-gate. The bypass content lives at 226+ and 236+.

- `ai-developer-toolkit/plugins/crews/CHANGELOG.md`
  - 84421 bytes; v3.2.0 entry is the most recent. Need to add v3.3.0 entry at the top.

- Version stamps (per `scripts/bump-version.js`):
  - `ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json`
  - `ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json`
  - `ai-developer-toolkit/.claude-plugin/marketplace.json`
  - `ai-developer-toolkit/.github/plugin/marketplace.json`
  - `ai-developer-toolkit/.agents/plugins/marketplace.json`
  - `ai-developer-toolkit/plugins/crews/tests/version.test.js` (asserts literal version)

### Existing patterns to reuse

- **Bump script:** `node ai-developer-toolkit/plugins/crews/scripts/bump-version.js 3.3.0` updates all 5 stamps in one shot. The test `node plugins/crews/tests/version.test.js` then verifies. This is the documented canonical flow per AGENTS.md "Releasing a new crews version".

- **Test runner:** `node plugins/crews/tests/run.js` runs the full suite (~60s target on Windows at default concurrency). Each test runs in a fresh Worker thread. Per AGENTS.md repo-level guidance, save output to a file (`/tmp/crews-tests.out`) on first run.

- **Topic branch + worktree:** Per codexu AGENTS.md, impl-phase members create a `ralph/<task-id>` topic branch in `<toolkit-submodule>/.worktrees/<task-id>/` and commit there. The lead merges to toolkit `main`, pushes to all 3 toolkit remotes (origin/personal/gim-home), bumps the codexu submodule pointer, updates the AGENTS.md active-plugin-versions table (3.2.0 → 3.3.0), and runs `copilot plugin update` on the live session.

### Naming conventions

- Test files use kebab-case: `tests/progress-bg-gate.test.js`.
- AGENTS.md sections use `## vX.Y.Z <topic>` for release entries.
- CHANGELOG entries use `## vX.Y.Z (YYYY-MM-DD) — <topic>` (verify against existing format on first read).

### Build / test surface

- Plugin is pure JavaScript. No package.json at plugin root; `node --check <file>` is the typecheck per AGENTS.md.
- Test command: `cd ai-developer-toolkit/plugins/crews && node tests/run.js`.
- Pre-commit: full suite must pass under 60s on Windows at default concurrency.

## Architect Analysis

### Integration points

The v3.2.0 ship introduced two interlocking pieces of behavior:

1. **Flush-race fix** (the v3.2.0 primary, untouched by this plan): retry-with-backoff in `lastTurnAssistantText` (read path 1) and in `detectActiveBg` → `readEvents` (read path 2). Both paths protect against Copilot's events.jsonl flushing slowly relative to Stop-hook firing. This is the protection that *enables* the gate to be reliable. v3.3.0 must NOT touch this.

2. **Bypass tag** (the v3.2.0 secondary, REMOVED by this plan): the in-band crews-namespaced `background-task` bare-token attribute on a `<|report|>` tag, plus the four legacy `<options-mode>...</options-mode>` and CommonMark forms recognized for one deprecation cycle.

The structural argument for removing (2):

- The model is single-threaded relative to its tool call boundary. Any in-process "wait" pattern that doesn't spawn a subprocess MUST be expressed as a follow-up tool call. A follow-up tool call means Stop never fires — the gate is irrelevant for that pattern.
- A real bg subprocess (an async bash/powershell with `mode: async`) is what `detect-active-bg.js` detects via the `tool.execution_start` + `system.notification.shell_completed` pair on shellId. If a model legitimately has bg work pending, the detector sees it.
- The remaining case — `kind=progress` AND `nonListenerCount === 0` AND no bypass — is structurally always one of:
  - Wrong tag (model should have emitted `kind=question` to wait on the lead)
  - Spinning (the model's lazy "I'll just say I'm making progress" failure mode — the exact pattern the gate was created to catch)
  - Finished-and-forgot (model should have emitted `kind=done`)

In all three cases, blocking is correct behavior. Allowing a model-controlled bypass defeats the gate's purpose. The v3.2.0 block message at stop.js:1128 makes the situation worse by *teaching* the model to use the bypass.

The operator-controlled escape hatch (`CREWS_PROGRESS_BG_GATE=off`) stays — it's per-machine config the operator sets when they want to disable the gate entirely (e.g., during debugging of the gate itself, or in an environment where Copilot's events.jsonl signal is genuinely unreliable). The model can't set env vars, so it can't self-attest its way past this surface.

### Dependency graph

The bypass logic touches:

- **Producer:** `mailbox.js` `parseTurnReports` → adds `bgTask` field per report.
- **Consumer:** `stop.js` reads `parsedReports.reports.some(r => r && r.bgTask)` AND independently scans the raw text for 4 legacy form strings.
- **Tests:** `tests/progress-bg-gate.test.js` cases 4 / 4-new / 5 / 5-new / 5b / 5c.
- **Docs:** `AGENTS.md` v3.1.0 / v3.2.0 sections and `CHANGELOG.md`.

After removal:

- `parseTurnReports` is simplified — no quoted-region strip, no bgTask field. The `out` object loses one field.
- `stop.js` loses 18 lines (the 4-form text scan + the 2 hasBgTag locals + the deprecation-warning emit + the combined `hasBgTag` local).
- The trigger condition becomes `gateEnabled && isCopilot && isProgress && isMember && !isRetry && !isShuttingDown` (drop `!hasBgTag`).

No other module imports the `bgTask` field. Cross-grep confirms: only `stop.js` consumes it.

### Technical constraints

- The v3.2.0 retry-with-backoff in `detect-active-bg.js` must stay intact. It's orthogonal to the bypass and is the flush-race fix.
- The `parseTurnReports` function is exported and tested by other tests too. Removing `out.bgTask` is additive-safe (no other consumer reads it), but the producer-side `attrsOutsideQuotes` regex scan is what gets removed.
- The `tests/progress-bg-gate.test.js` Case 6 ("strip-quotes defense") tested that the quoted-region strip prevented a false-positive bypass match. With the bypass parser gone, that test becomes obsolete in its current form. The plan should repurpose Case 6 as the new "model spinning" case the spec calls for, per Story 8.

### Suggested implementation approach

Single story bundle. The change is small (~40 lines deleted, ~10 lines added, ~70 lines of docs/test updates) and tightly coupled — splitting into multiple stories would create awkward intermediate states (e.g., parser removed but consumer still references `bgTask`). One story, one commit, three review-fix loops as needed.

Ordering within the story:

1. Edit `hooks/mailbox.js` to remove `bgTask` parsing.
2. Edit `hooks/stop.js` to remove the legacy-form scan, hasBgTag locals, deprecation warning, and update the block message text.
3. Edit `hooks/detect-active-bg.js` header comment to add the structural argument.
4. Edit `tests/progress-bg-gate.test.js` to flip cases 4, 4-new, 5, 5-new, 5b, 5c, 6 to the new contract; add a synthetic "model spinning" case.
5. Edit `AGENTS.md` to remove bypass content + add the "Why no bypass" subsection.
6. Edit `CHANGELOG.md` with v3.3.0 entry.
7. Run `node scripts/bump-version.js 3.3.0` to stamp all 5 manifest files + the version test.
8. Run `node tests/run.js` to verify all tests pass under 60s.
9. Commit.

### Risk areas

- **Test rewrite scope.** Cases 4 / 4-new / 5 / 5-new / 5b / 5c currently exercise *positive* bypass behavior. Flipping them to *negative* requires careful re-baselining of the expected block message and the absence of deprecation warning. The `bg-gate-deprecation-both-` fixture (Case 5b) needs special attention — it currently asserts no warning fires when both forms coexist; the new contract is "no warning ever fires because the warning path was removed."

- **Documentation drift.** AGENTS.md v3.2.0 section discusses the bypass rename rationale. The v3.3.0 section should either supersede or annotate the v3.2.0 narrative so future readers don't get confused. Recommendation: keep the v3.2.0 section as historical record (per the AGENTS.md convention) and add a clear v3.3.0 section that says "v3.2.0's bypass form is removed; see structural argument below."

- **Migration story for users currently emitting the bypass.** Per the spec, no deprecation cycle — the in-band form is <24h old, and the legacy forms were already deprecated. Any model that emits a bypass tag in a v3.3.0 session will see the gate fire and the new block message; the message will not mention any bypass option, only the three correct kind alternatives.

- **Multi-repo coordination.** Per codexu AGENTS.md, the impl member commits inside the toolkit submodule's `.worktrees/crews-stop-bg-gate-remove-bypass/` checkout on branch `ralph/crews-stop-bg-gate-remove-bypass`. After ship: the lead merges to toolkit main, pushes to origin/personal/gim-home, then commits the codexu submodule pointer bump + active-plugin-versions table update + runs `copilot plugin update`.

## Codex Research

*Skipped — orchestrator chose to ship from existing context rather than spawn parallel external research for this surgical, well-scoped change. Phase 4 multi-model review preserves the cross-model gate.*

## Copilot Research

*Skipped — same rationale as Codex.*

## Consolidated File List

### Files to modify (toolkit submodule)

- `plugins/crews/hooks/mailbox.js` — remove `bgTask` field from `parseTurnReports`
- `plugins/crews/hooks/stop.js` — remove legacy-form text scan, hasBgTag locals, deprecation warning; rewrite block message; update bypass-conditions comment block
- `plugins/crews/hooks/detect-active-bg.js` — add structural-argument subsection to header comment
- `plugins/crews/tests/progress-bg-gate.test.js` — flip cases 4 / 4-new / 5 / 5-new / 5b / 5c; add synthetic "model spinning" case; repurpose Case 6
- `plugins/crews/AGENTS.md` — remove bypass content from v3.1.0 section + add v3.3.0 section with structural argument
- `plugins/crews/CHANGELOG.md` — v3.3.0 entry
- `plugins/crews/.claude-plugin/plugin.json` — version stamp (via bump-version.js)
- `plugins/crews/.github/plugin/plugin.json` — version stamp (via bump-version.js)
- `.claude-plugin/marketplace.json` — version stamp (via bump-version.js)
- `.github/plugin/marketplace.json` — version stamp (via bump-version.js)
- `.agents/plugins/marketplace.json` — version stamp (via bump-version.js)
- `plugins/crews/tests/version.test.js` — literal version assertion (via bump-version.js)

### Files to modify (codexu, after lead merges toolkit)

- `ai-developer-toolkit` submodule pointer bump (single SHA update)
- `AGENTS.md` — bump active-plugin-versions table row for `crews` from `3.2.0` to `3.3.0`

### Test command

- `cd ai-developer-toolkit/plugins/crews && node tests/run.js 2>&1 | tee /tmp/crews-tests.out`
- `node ai-developer-toolkit/plugins/crews/tests/version.test.js`
