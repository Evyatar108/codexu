# Stories Outline: Codex generated target for Ralph multi-lens fan-out (D-001), gated by the D-003 retrieval spike

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> **Hard gate:** US-001 is a go/no-go spike. US-002–US-006 MUST NOT start unless `spike-verdict.json.verdict === "GO"`. A `NO-GO` verdict is a terminal blocked/replan outcome (record verdict + pivot, stop, surface to operator) — NOT a passed story. Strictly serial chain.

## US-001: D-003 result-retrieval feasibility spike (go/no-go gate)
**Description:** As the ralph maintainer, I want a disposable codex 0.135 `multi_agent_v2=true` probe so that I know — before writing any generator code — whether a parent codex member can collect each child's FULL final answer as JSON using ONLY model-visible tools.
**Acceptance Criteria:**
- [ ] Enable `features.multi_agent_v2=true` for ONE codex 0.135 member; record the enablement path used (`buildThreadConfig()` in `packages/happy-cli/src/codex/codexAppServerClient.ts` vs `~/.codex/config.toml`).
- [ ] Retrieval uses ONLY `spawn_agent`/`followup_task`/`wait_agent`/`list_agents`/`close_agent`; reading shell output, session rollout files, app-server logs, or the raw event stream is forbidden (would be a false GO).
- [ ] Spawn 2 successful children + 1 timeout child. Each successful child emits a deterministic JSON object with a ≥32 KiB payload + a parent-supplied nonce + a SHA-256 checksum.
- [ ] Recover each successful child's final answer and validate EXACT equality vs canonical `JSON.stringify` (no fences) + checksum + nonce match. Record raw `list_agents` output and state which field carried the full text (hypothesis: `agent_status = Completed(<final assistant message>)` vs `last_task_message` = instruction only). Truncated/summary/mismatch = FAIL.
- [ ] Induce the timeout child via short `wait_agent(timeout_ms)`; confirm fail-hard / mark-missing, no synthesized partial.
- [ ] `close_agent` all children.
- [ ] Write `<job_dir>/spike-verdict.json` = `{ verdict, retrievalMechanism, payloadBytes, checksumVerified, evidence, timeoutBehavior, enablementPath }`. GO iff all answers recovered model-side + checksum-verified + timeout failed hard; else NO-GO.
- [ ] On NO-GO: record verdict + recommended pivot (P1 runtime bridge / P2 defer), mark the job blocked (or terminal replan), STOP, surface to operator. Do NOT mark passed; do NOT start US-002.
- [ ] Typecheck passes (for any probe code committed).
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Generator — codex third target + dual lowering
**Description:** As a codex Ralph member, I want generated codex-flavored skill artifacts so that `Agent(...)` calls are lowered to codex-native form instead of degrading.
**Acceptance Criteria:**
- [ ] `generate-copilot-artifacts.mjs --write` adds a codex target via `expectedOutputs()` producing codex artifacts.
- [ ] TWO lowering shapes: (a) multi-lens fan-out → `spawn_agent → followup_task → wait_agent → collect → validate-JSON → close_agent` (fail-hard on timeout/malformed-JSON/collision/orphan); (b) single-agent delegation → `spawn_agent → followup_task → wait_agent → collect-one → close_agent`.
- [ ] Full `Agent(` inventory: every site (fan-out + the 9× `implement-with-ralph` / 2× `convert-to-ralph-prd` single-agent calls) assigned a shape OR a declared exception (e.g. CLI-fan-out `multi-model-investigate`). No `Agent(` token leaks (codex analog of `assertNoForbidden`).
- [ ] `implement-with-ralph` coverage decision (generated vs hand-fork like Copilot) recorded; all its `Agent(` sites covered/excepted.
- [ ] Lowering is block-level (balanced call capture or marker), not a start-anchored regex.
- [ ] Guard: do not start unless `spike-verdict.json.verdict === "GO"`. Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: When-to-delegate guidance + in-artifact v1/v2 preflight
**Description:** As a codex member, I want explicit delegation triggers and a v2 preflight in the generated artifact so that I actually delegate (codex v1 suppresses spawning; v2 is silent) and fail clearly on a misconfigured runtime.
**Acceptance Criteria:**
- [ ] Generated codex artifacts contain explicit when-to-delegate trigger guidance (verified by reading the generated SKILL.md, not just a token gate).
- [ ] In-artifact v1/v2 preflight: if `followup_task`/`wait_agent`/`list_agents` are unavailable, STOP with a clear `multi_agent_v2`-config error rather than degrade silently.
- [ ] Guard: do not start unless GO. Typecheck passes.
**Dependencies:** US-002
**Estimated complexity:** small

## US-004: Codex discovery/manifest (reuse existing convention)
**Description:** As a codex member, I want ralph registered as a codex plugin so that the generated codex skills are discoverable and loadable.
**Acceptance Criteria:**
- [ ] Add `plugins/ralph/.codex-plugin/plugin.json` following the existing convention (10 other toolkit plugins ship one), pointing `skills` at the generated codex skills dir.
- [ ] Register/verify via `.agents/plugins/marketplace.json`; policy enums still pass `tools/validate-codex-marketplace-policy.mjs`.
- [ ] Validate a codex member can resolve and load at least one generated codex skill.
- [ ] Guard: do not start unless GO. Typecheck passes.
**Dependencies:** US-003
**Estimated complexity:** medium

## US-005: Codex `--check`/parity + behavioral + drift guard + live smoke
**Description:** As a maintainer, I want behavioral validation (not just token checks) so that a semantically-wrong codex artifact cannot pass the gate.
**Acceptance Criteria:**
- [ ] Codex `--check`/parity passes with zero drift AND FAILS when the codex artifact root/files are absent (not vacuous-pass like the Copilot `--check`, `generate-copilot-artifacts.mjs:262-267`).
- [ ] Behavioral shape test: correct sequence per shape + delegation trigger + v1/v2 preflight. Cross-platform via `node:test` where feasible.
- [ ] Drift guard: a test FAILS when ANY new source `Agent(` site (fan-out or single) lacks a codex lowering/exception.
- [ ] Live smoke (after discovery): executes the GENERATED codex fan-out via the real `codex` CLI under `multi_agent_v2=true` (concurrent spawn, exact JSON collection, induced-timeout fail-hard, cleanup); SKIPs cleanly when `codex` is unavailable; writes a transcript to a named job-dir path. Release-gate-vs-manual status stated.
- [ ] Guard: do not start unless GO. Typecheck passes.
**Dependencies:** US-004
**Estimated complexity:** large

## US-006: Version bump 5.52.0 + docs + ship
**Description:** As a maintainer, I want the version bumped and shipped via submodule discipline so that consumers pick up the codex target.
**Acceptance Criteria:**
- [ ] Bump 5.52.0 across SIX surfaces: `plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.github/plugin/plugin.json`, the NEW `plugins/ralph/.codex-plugin/plugin.json`, and the three marketplace indexes (`.claude-plugin/`, `.github/plugin/`, `.agents/plugins/`). Keep any version-parity test in lockstep.
- [ ] Update `plugins/ralph/CHANGELOG.md` + `plugins/ralph/AGENTS.md` + codexu `AGENTS.md` active-plugin-versions table.
- [ ] Extend the release gate to run the codex `--check` alongside the Copilot one.
- [ ] Submodule committed/pushed first, then codexu pointer bumped (two-commit discipline). No `codex/` change. Do NOT stage gitignored `CLAUDE.md`.
- [ ] Guard: do not start unless GO. Typecheck/tests pass.
**Dependencies:** US-005
**Estimated complexity:** medium
