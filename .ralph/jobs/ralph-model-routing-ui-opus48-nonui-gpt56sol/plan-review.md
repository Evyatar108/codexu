# Phase-4 Plan Review: Ralph 5.64 Hybrid Model-Routing Convergence

## Review basis

- Released authoritative base: toolkit `964c36f7`
- Released routing commit: `37e03c05`
- Read-only strict-semantics reference: `267e7cd7`
- Common ancestor/overlap calculation: `10fcb5da`
- Remote follow-ups that must survive: `23c88e03`, `90f578fe`, `318a86d0`
- Historical 5.63 plan artifacts previously in this job directory
- Current released policy, wrappers, primary loop, review loop, schemas, generators, lowering, skills, generated artifacts, tests, and docs

This review was performed as non-UI planning/review work under the required GPT-5.6 Sol xhigh policy. No nested reviewer was used.

## Source verification

- `origin/main` and `gim-home/main` resolve to `964c36f7` in the inspected toolkit checkout.
- `964c36f7` has parents `37e03c05` and `318a86d0`.
- `10fcb5da` is the merge base of `964c36f7` and `267e7cd7`.
- The released/local feature overlap is exactly 88 paths.
- Released `model-routing-policy.mjs` preserves Luna medium, Sol xhigh, Sol medium, and Opus high, but uses prompt regex inference and keeps primary stories on Sol.
- Local `model-routing.mjs` supplies strict durable/migration behavior, but duplicates the policy and collapses non-UI category distinctions.
- Released Codex generation explicitly emits model and reasoning effort, including Opus high substitutions; the plan therefore keeps engine independent from route selection and makes live telemetry the release gate.

## Findings resolved

### F-001 — Critical: stale/local implementation base could revert released work

**Finding:** The historical plan was written against the local reference and could lead an implementer to branch from local toolkit `main` or cherry-pick `267e7cd7`, reverting the released 5.63 merge plus Crews/Overview follow-ups.

**Resolution:** The new plan requires a fresh toolkit worktree from current `origin/main`, containment of `964c36f7`, separate `origin`/`gim-home` verification, and read-only semantic inspection of `267e7cd7`.

### F-002 — High: two policy modules would violate the chosen architecture

**Finding:** The historical plan created `src/model-routing.mjs` beside released `src/model-routing-policy.mjs`.

**Resolution:** Extend the released module as the sole owner. The local module and local policy inventory are explicitly `SUPERSEDED`; only selected validators, migration behavior, and stable site IDs are ported.

### F-003 — High: strict local semantics erased released category/effort routing

**Finding:** A direct local port would route all non-UI work to Sol and lose Luna exploration and Sol xhigh planning/review.

**Resolution:** Purpose selects the released work category first. `not-required` preserves that category route; only explicit `required` overrides both model and effort to Opus high. The plan includes a six-cell exact matrix.

### F-004 — Critical: released primary UI stories remained Sol medium

**Finding:** Released `policyForPrimaryIteration()` always returns implementation/Sol medium and declares the UI override delegated-only.

**Resolution:** `src/ralph.mjs` must select the target story, resolve `primaryImplementation` plus its durable binary judgment, and route primary UI stories to Opus high. Primary non-UI remains Sol medium.

### F-005 — High: engine behavior was under-specified and the local rejection conflicted with released Codex routing

**Finding:** The local reference rejects Codex+required while released 5.63 deliberately emits explicit Opus model/effort in Codex v1/v2 spawn recipes.

**Resolution:** Engine is a host assertion, never a model selector. Both host paths receive the central route. Host/model unavailability fails with no fallback; installed Copilot and Codex telemetry is a release gate. No design-time downgrade or silent host switch is allowed.

### F-006 — High: prompt regex inference violated the operator's explicit-classification decision

**Finding:** Released UI override depends on `UI_CONTEXT`, `UI_WORK`, and `actualTask`.

**Resolution:** Delete those APIs and guidance. Registered sites supply structured purpose; durable artifacts supply judgment. Paired no-heuristic tests prove prompt words, files, frameworks, and acceptance surfaces cannot change a route.

### F-007 — High: mixed containers were not granular enough

**Finding:** A single call-level binary override can misroute a genuinely mixed fan-out.

**Resolution:** Every executable child/story has a binary value. Mixed phase configs persist a map keyed by stable dispatch-site ID. Autonomous execution fails if any required child mapping is absent.

### F-008 — High: migration UX did not fully distinguish autonomous and interactive execution

**Finding:** “Fail closed” alone did not explain how legacy workflows can proceed interactively without inference.

**Resolution:** The plan defines a canonical question, artifact/ID preview, per-child answers for mixed, atomic persistence, re-read validation, and exact autonomous migration errors. Existing metadata conflicts always reject.

### F-009 — High: review/fixer routing could over-route an entire mixed diff

**Finding:** Aggregate UI review is necessary when any UI story is represented, but applying that aggregate to every fixer would send unrelated non-UI fixes to Opus.

**Resolution:** Persist aggregate review classification and per-finding story/scope classification. Review may be Opus high while a non-UI finding's fixer remains Sol medium.

### F-010 — Medium: reviewer identity diverged between released and local branches

**Finding:** Released jobs write `copilot-secondary`; local reference renamed the slot to `copilot-primary` and normalized only `copilot-opus`.

**Resolution:** Keep released `copilot-secondary` for new writes. Normalize both historical `copilot-opus` and local-reference `copilot-primary` before dedupe/merge; retain historical `claude` readability.

### F-011 — High: generated/manual boundaries could invite hand-merging 50+ generated files

**Finding:** The 88-file overlap contains both authored sources and generated Copilot/Codex trees; the Copilot implementation skill is a special hand fork.

**Resolution:** The file-by-file matrix marks generated files `SUPERSEDED`, requires source-first regeneration, and calls out only `.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md` for manual reconciliation.

### F-012 — High: generic SessionStart routing plugin could be accidentally coupled

**Finding:** The released commit also contains independent `plugins/subagent-model-routing/**`, while local routing work has similarly named concepts.

**Resolution:** The plugin is explicitly out of scope and test-independent: no edits, imports, generation, fixtures, or Ralph test dependency. Preservation is checked manually with git diff, not through cross-plugin tests.

### F-013 — High: release preservation and remote semantics were incomplete

**Finding:** The historical plan targeted 5.63 and did not account for the concurrent 5.63 release, Crews 3.25.0, Overview 2.15.1+, or the current broken personal remote.

**Resolution:** Target is 5.64.0, all six stamps are named, remote trees are guarded, `origin` and `gim-home` are mandatory, and repository-not-found on `personal` is documented as nonblocking unless the operator changes the gate.

### F-014 — High: installed evidence could false-pass on argv or prose

**Finding:** Unit tests and wrapper argv do not prove the actual child model/effort selected by installed Copilot/Codex.

**Resolution:** Lead-owned dogfood must use installed plugin copies and capture actual start/completion telemetry for Luna medium, Sol xhigh, Sol medium, and Opus high, including primary UI. Source checkout or assistant prose is insufficient.

### F-015 — Medium: parent codexu closeout created a dual-repo PRD hazard

**Finding:** Treating the toolkit release and codexu gitlink update as one implementation story could cause `/implement-with-ralph` to silently omit one repository.

**Resolution:** Seven stories target only the toolkit. Parent gitlink/version-table update is a separate lead-owned ceremony after toolkit release and installed telemetry.

### F-016 — Medium: rollback could reintroduce unsafe behavior

**Finding:** A vague rollback might restore prompt heuristics, primary-Sol UI routing, or rewrite a published 5.64.0 tag.

**Resolution:** Before publication, abandon/revert and regenerate. After publication, forward-fix with a patch release; never force-rewrite. Policy failures remain fail-closed and return to the operator.

### F-017 — Medium: the overview implementation seed is stale

**Finding:** The tracked task's `command.prompts.impl` still instructs a future member to implement six stories and release 5.63.0, even though the operator selected seven-story 5.64 convergence. Editing overview data is outside this plan-only commit.

**Resolution:** The plan makes itself authoritative and adds a lead-owned pre-spawn action to refresh the seed through the canonical data-edit path. Until that bookkeeping change lands, the stale seed must not drive implementation.

## Phase-4 verdict

**Ready.**

- Seven serial toolkit stories.
- Seventeen findings resolved.
- Exact 88-file overlap matrix plus decisive non-overlap files.
- One central policy source.
- Primary UI Opus high and non-UI category efforts preserved.
- Structured mixed-child propagation and interactive/autonomous migration defined.
- Generated/manual boundaries, historical compatibility, six stamps, installed telemetry, parent closeout, rollback, and common mistakes covered.

No open design blocker remains. The installed Codex/Copilot model-availability check is intentionally a release gate: failure requires an operator decision and must not be hidden by fallback.
