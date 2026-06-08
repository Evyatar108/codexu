# Stories Outline: Codex iteration-engine runaway-spawn guard (no-collab iteration profile)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Serial single-member (same-plugin shared ship surfaces). US-001 is a hard GO/NO-GO gate.*

## US-001: GO/NO-GO spike — confirm codex collab-disable surface suppresses v1 spawn tools (GATE)
**Description:** As the impl team, I want empirical proof that `codex exec --disable multi_agent` (≡ `-c features.multi_agent=false`) suppresses the v1 Collab spawn-tool exposure on codex 0.135.0-copilot-api.1, and that replaying the known runaway (job `codex-ralph-member-multi-agent-adapter` US-002) no longer rabbit-holes, so the rest of the plan wires a confirmed mechanism (GO) — or stops and hands off to a separate codex fork-patch plan (NO-GO).
**Acceptance Criteria:**
- [ ] A `spike-verdict.json` is written recording GO/NO-GO, the confirmed disable surface, and `codex --version`.
- [ ] **Tool-suppression A/B (load-bearing):** a deterministic probe shows codex does NOT advertise/inject the v1 spawn tools (`spawn_agent`/`send_input`/`wait_agent`/`close_agent`) when the flag is set. Record at least one: (a) a `codex exec --disable multi_agent` transcript/tool-list with zero spawn-tool advertisements; OR (b) a `RUST_LOG` codex_core-debug sidecar showing `add_collaboration_tools` injected no spawn handlers; OR (c) an A/B pair (no-flag run DOES advertise them; flag run does not).
- [ ] **Replay (smoke, non-blocking):** replaying job `codex-ralph-member-multi-agent-adapter` US-002 under `iterationEngine=codex` + the flag does NOT reproduce the runaway (no codex child-fanout in the codex-exec subtree snapshot; iteration converges within a normal budget). Flaky model behavior does NOT fail this story by itself.
- [ ] If no flag/`-c` surface suppresses the v1 spawn tools, the verdict records NO-GO + reason and the plan STOPS (separate codex fork-patch plan follows; do NOT proceed to US-002).
- [ ] Any hung/timed-out codex lens/subprocess during the spike is reported to the lead (operator hung-lens rule); use `--timeout-ms 1200000` (≥20 min) on any codex invocation.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: `codex-exec.mjs` collab-suppression flag (default-off)
**Description:** As ralph, I want an opt-in `codex-exec.mjs` flag that appends the spike-confirmed disable surface so a caller can request a no-subagent codex exec, without changing any existing caller's behavior.
**Acceptance Criteria:**
- [ ] A new flag (e.g. `--suppress-subagents`, final name set in impl) is added to `codex-exec.mjs`; **default-off** (absent ⇒ argv byte-identical to today).
- [ ] With the flag set, the assembled codex argv contains the confirmed disable surface (prefer first-class `--disable multi_agent`; `-c features.multi_agent=false` is the documented equivalent; belt: `--disable enable_fanout`). **Unit test asserts the exact argv** (BLOCKING).
- [ ] Usage string updated; the injectable test surface (`main(argv, opts)`) stays hermetic.
- [ ] Typecheck / `node plugins/ralph/tests/run.mjs` green.
**Dependencies:** US-001 (GO)
**Estimated complexity:** small

## US-003: `ralph.mjs` `runEngineIteration` wiring — codex iteration only (mode separation)
**Description:** As ralph, I want the suppression flag passed ONLY for the codex single-story iteration, so collaboration stays available for lenses and codex members.
**Acceptance Criteria:**
- [ ] `runEngineIteration` passes the new flag to `codex-exec.mjs` **only when `engine === "codex"`** (the iteration path); copilot iterations and direct lens/member callers do NOT get it.
- [ ] **Mode-separation regression test (BLOCKING):** codex iteration → flag present; copilot iteration → absent; direct `codex-exec.mjs` lens caller → absent.
- [ ] The v5.53.0 `codex-lowering.mjs` generator output is unchanged — assert the generated `.codex-plugin/` fan-out recipe is byte-identical pre/post (members/lenses keep multi_agent_v2).
- [ ] `node plugins/ralph/tests/run.mjs` green.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: `prompts/codex.md` anti-spawn guidance (advisory)
**Description:** As a defense-in-depth layer, I want explicit anti-spawn guidance in the codex iteration prompt so the model is also told not to spawn sub-agents during a single-story iteration.
**Acceptance Criteria:**
- [ ] `prompts/codex.md` carries explicit guidance: do NOT spawn sub-agents / collaboration threads during a single-story iteration.
- [ ] The durable-memory marker block (`<!-- DURABLE-MEMORY-V1 -->`) parity codex.md ↔ copilot.md stays green (`tests/test-durable-memory-smoke.sh` — Git Bash first on PATH).
- [ ] Typecheck passes.
**Dependencies:** US-001 (GO)
**Estimated complexity:** small

## US-005: D-002 — copilot documented impl iterationEngine (policy/docs-only)
**Description:** As the operator, I want copilot documented as the recommended/supported impl `iterationEngine` with codex re-graduation criteria, WITHOUT a schema-default flip, so the interim policy is clear while codex iterations are gated by the no-collab profile.
**Acceptance Criteria:**
- [ ] `plugins/ralph/AGENTS.md` + `CHANGELOG.md` state in prose that copilot is the recommended/supported impl `iterationEngine`, that codex iterations are gated by the no-collab profile, and document concrete **codex re-graduation criteria** (e.g. N consecutive clean single-story codex iterations with zero spawn-tool advertisement; set N in impl).
- [ ] create-prd / convert-to-ralph-prd skill prose notes copilot as the recommended impl engine.
- [ ] **Explicit non-change:** `prd-schema.json` `iterationEngine` default REMAINS `"codex"` (no schema/converter default flip). A test or grep guard confirms the default is unchanged.
- [ ] Typecheck passes.
**Dependencies:** US-001 (GO)
**Estimated complexity:** small

## US-006: Ship — version bump, docs, regenerate artifacts, gates, tests
**Description:** As a maintainer, I want the ralph plugin shipped with all 6 version stamps in sync, regenerated copilot+codex artifacts, and all release gates green.
**Acceptance Criteria:**
- [ ] **No wall-clock circuit-breaker** added to the iteration path (review the diff).
- [ ] 6 version stamps bumped in sync (next ralph version after 5.54.0 — 5.55.0 at planning time; confirm not-taken at ship): `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.github/plugin/plugin.json`, `plugins/ralph/.codex-plugin/plugin.json`.
- [ ] `AGENTS.md` behavioral section + `CHANGELOG.md` entry added.
- [ ] `.copilot-plugin/` + `.codex-plugin/` regenerated via `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --write`.
- [ ] Release gates green: `generate-copilot-artifacts.mjs --check`, `check-copilot-parity.mjs`, `--target=codex --check`, `test-codex-generator.mjs`, `node tools/validate-codex-marketplace-policy.mjs`, and `node plugins/ralph/tests/run.mjs`.
- [ ] codexu parent: active-plugin-versions table bumped in the same commit as the `ai-developer-toolkit` submodule pointer; codexu `CLAUDE.md` NOT touched.
**Dependencies:** US-002, US-003, US-004, US-005
**Estimated complexity:** medium

---

## NO-GO branch (NOT a story in this job)
If US-001 records a config-disable NO-GO, the impl stops at the verdict. The codex fork patch — gating `add_collaboration_tools` at `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:639` behind a config/env, with `// SANDBOX PATCH:` marker + `patch-surface.md` §14/§15, `cargo check --workspace` gate, and the multi-level submodule two-commit flow — is a SEPARATE codex-targeted plan/job the lead spawns (dual-repo rule). It is described in `plan.md` for handoff continuity only.
