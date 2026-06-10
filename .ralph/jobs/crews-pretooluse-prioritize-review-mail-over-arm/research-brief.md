# Research Brief: crews-pretooluse-prioritize-review-mail-over-arm

Target: crews plugin (ai-developer-toolkit submodule) v3.19.1.
Source read from primary checkout: `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/`
(plan worktree submodule is uninitialized by design).

## Researcher Findings

### 1. Insertion site — `hooks/pre-tool-use.js::handleInput` tail (lines 456-526)
Order in the tail:
- `:456` `const listenerState = getListenerState(state.name, crew, cwd, { role: state.role });`
- `:457-463` listener-output-inspection bypass (BashOutput/read_bash → return)
- `:471-474` AskUserQuestion intercept (member only): `readManifest(...)` then `routeAskUserQuestionToLead(...)` → return
- `:475` `if (listenerState === 'armed') return; // allow`
- `:476` `const manifest = readManifest(state.name, crew, cwd) || {};`
- `:478-486` `buildListenerCommand({...})`
- `:498-512` engine-aware `armBlock` (copilot/codex async-shell vs claude Bash)
- `:513-524` plain arm `reason` ("BLOCKED: you must arm a background listener as your FIRST tool call ...")
- `:525` appendLog blocked
- `:526` `block(reason, out);`

In scope at the insertion point: `state` (name, role), `crew`, `cwd`, `manifest`, `out`, `toolName`, `data.session_id`.

### 2. `hooks/protocol/review-gate.js`
- `buildReviewRequiredReason(name, crew, cwd, role, manifest, opts)` at `:44-104` — **takes manifest as a param**, does NOT read it.
  - `:46-48` returns `null` when `lastReviewRequiredSeq <= lastReviewedSeq` (the seq predicate).
  - `:50-52` engine = manifest.engine ('copilot'/'codex' honored, else 'claude').
  - `:61` `useEnvBin = Boolean(process.env.CREWS_BIN)`.
  - `:62` `cmd = buildReviewMailCommand({ name, crew, stateCwd: cwd, role, engine, useEnvBin })`.
  - `:64-77` headline (sender names or saturated-history fallback — non-null either way).
  - `:85-92` engine-aware `armPrefix` (copilot/codex/claude prose).
  - `:94-103` returned multi-line string: `headline — inspect the mail before continuing.` / blank / armPrefix / blank / `  <cmd>` / blank / "Running this command advances your reviewed cursor; once the cursor catches up ... the next Stop will permit your turn to end."
- `reviewRequiredReason(name, crew, cwd, role, manifest)` at `:106-108`.
- `reviewMidTurnReason` at `:110-112`.
- **Exports (`:114-118`): only `parseReviewMode`, `reviewMidTurnReason`, `reviewRequiredReason`.** `buildReviewRequiredReason` is NOT exported → must call `reviewRequiredReason`.

### 3. `hooks/listener-protocol.js::buildReviewMailCommand` (lines 73-100)
- Claude + useEnvBin → `node $CREWS_BIN review-mail ...`
- Copilot/codex + useEnvBin → `node $env:CREWS_BIN review-mail ...`
- useEnvBin === false → absolute dispatcher path (`node '<.../crews.js>' review-mail ...`).
- Exported in `module.exports` (`:308-320`).

### 4. Canonical usage in `hooks/stop.js` (lines 931-943)
- `reviewManifest = readManifest(...) || {}` at `:933`.
- `const reviewReason = reviewRequiredReason(state.name, crew, cwd, state.role, reviewManifest);` at `:934`.
- Gated by `parseReviewMode(cwd)` (`enforce`/`advisory`/`off`).
NOTE: the new PreToolUse branch is the arm-first gate, NOT the review-required enforcement gate (which PreToolUse dropped in v1.5.6). It only reorders block-message guidance when unarmed AND mail pending. It does NOT re-introduce PreToolUse review-required enforcement, and does NOT consult CREWS_REVIEW_MODE (that gates Stop enforcement; the arm-first gate fires regardless).

### 5. Test harness
- `tests/pre-tool-use-listener-output.test.js`: `runPreTool()` = spawnSync on `hooks/pre-tool-use.js`; `seedExitedMember()` = `cfg.ensureActorDir(...)` + `cfg.writeFlag(...)`. **Closest model for the new test.**
- `tests/review-gate.test.js`: spawnSync wrappers `runHook()`/`runStopHook()`; also calls `reviewRequiredReason(...)` directly (`:227-235`); `seedReviewRequired(...)` sets `lastReviewRequiredSeq: 2, lastReviewedSeq: 1`; `seedActor(...)` defaults `listenerState: 'armed'`. **In the serial denylist (`tests/run.js:57`).**
- `tests/pretooluse-ask-user-question.test.js`: mostly direct `simulatePreToolUse(...)`; helpers `createScenario`, `spawnLead`, `spawnMember`, `setListenerState`, `cfg.updateManifest`.

### 6. Manifest fields
- Listener state: `listenerState`, `lastListenerSpawnAt`, `lastListenerExitedAt` (via getListenerState/deriveListenerState).
- Review predicate: `lastReviewRequiredSeq`, `lastReviewedSeq`.
- To produce non-armed + review-pending: `listenerState: 'exited'` (or 'never-armed') + `lastReviewRequiredSeq > lastReviewedSeq`.

### 7. Test runner
- `node tests/run.js`, worker-per-file, parallel + serial tail. Serial denylist includes `review-gate.test.js`.
- `tests/version.test.js` pins the version literal.
- For "typecheck": crews has no tsconfig — use `node --check <changed .js>`.

### 8. Ship mechanics (impl phase, lead-owned)
- `scripts/bump-version.js <x.y.z>` stamps 6 files + `tests/version.test.js`:
  - `plugins/crews/.claude-plugin/plugin.json`, `plugins/crews/.github/plugin/plugin.json`, `plugins/crews/.codex-plugin/plugin.json`
  - `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`
- `CHANGELOG.md` and `AGENTS.md` both at `plugins/crews/`.

## Architect Analysis
- Best insertion: a new `if (...) { ...; return; }` after `:475` (armed early-return), before the plain arm block. Move/share the single `manifest` read so both the new branch and the plain arm block use one snapshot.
- Engine-awareness: PreToolUse has `state.role`, `crew`, `cwd`, `data.session_id`, `manifest.engine` — sufficient to call `reviewRequiredReason(state.name, crew, cwd, state.role, manifest)` identically to Stop.
- v3.4 lead-unconditional listener gate is in `stop.js` (`:114-130`, `:724-742`) — untouched by this change. Lead-with-pending-mail-and-exited-listener fires the new branch correctly; `reviewRequiredReason` is role-aware.
- Message contract: prefer (a) call `reviewRequiredReason(...)` + append a short "then arm against a clean mailbox" note (single source of truth for the engine-aware command). Do NOT hand-build the command in PreToolUse (divergence risk vs Stop).
- Null return → fall through to the existing plain arm block. Saturated-history returns non-null → still blocks with review-mail-first.
- Any existing test asserting the exact plain arm-block text for an unarmed + review-pending fixture must be updated.

## Codex/Copilot Research
Not run in Phase 2 (focused single-function change; multi-model budget invested in Phase 4 review,
which runs codex + copilot review in autonomous mode).

## Consolidated File List
### Files to modify
- `ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js` (insert review-mail-first branch; share manifest read; import `reviewRequiredReason`)
### Files to create
- `ai-developer-toolkit/plugins/crews/tests/pretooluse-review-mail-first.test.js` (new test)
### Files to audit/possibly update
- `ai-developer-toolkit/plugins/crews/tests/review-gate.test.js`, `tests/pre-tool-use-listener-output.test.js`, `tests/pretooluse-ask-user-question.test.js` (any plain-arm-block text assertion on an unarmed+review-pending fixture)
### Ship-phase files (lead-owned, note only)
- `scripts/bump-version.js` target set (6 stamps + version.test.js), `CHANGELOG.md`, `AGENTS.md`, 3 marketplace indexes
### Reuse (do not modify)
- `hooks/protocol/review-gate.js::reviewRequiredReason`, `hooks/listener-protocol.js::buildReviewMailCommand`, `hooks/protocol/review-required.js`
