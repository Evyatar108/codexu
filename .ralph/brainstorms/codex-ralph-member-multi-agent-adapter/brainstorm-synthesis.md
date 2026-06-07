Lenses: ran=[codex, devils-advocate]; skipped=[copilot] (deliberately skipped for resource-safety)

> The Copilot "Product-Reality Challenger" lens was deliberately skipped this round. `copilot-exec --read-only` byte-snapshots both submodule trees (`codex/`, `ai-developer-toolkit/`) into memory to power its revert guard; running that concurrently is the most plausible cause of the r1/r2 resource deaths on this box, and the copilot lens (product/adoption framing) is the least decision-relevant for an internal-tooling plumbing change. Two usable lenses (codex Feasibility-Mapper + Devil's Advocate) remain, which is sufficient for a confident recommendation. The product/adoption axis is partially covered by Devil's Advocate D-004 (the opportunity-cost null option).

# Brainstorm synthesis — codex-ralph-member-multi-agent-adapter

**Idea:** Make codex-engine Ralph members run NON-degraded multi-lens brainstorm/review by extending the EXISTING harness-aware tool-mention seam to a third harness (codex) — operator-directed, NOT a bespoke runtime adapter.

## STEP 1 result — the harness-aware seam (located, both lenses agree)

The seam is **`plugins/ralph/scripts/generate-copilot-artifacts.mjs`** in the **ralph-orchestration** plugin (mirrored from `ai-developer-toolkit/plugins/ralph/`). It is a **build-time single-source generator**: the Claude Code `skills/<name>/SKILL.md` + `agents/<name>.md` are canonical, and the Copilot-flavored `.copilot-plugin/...` artifacts are *generated* by an ordered list of regex `SUBSTITUTIONS` (notably `agent-dispatch`: `Agent(subagent_type="X")` → `task(agent_type="x")`), guarded by an `assertNoForbidden` token gate and a `check-copilot-parity.mjs` drift check. **There is no runtime harness detection** — harness-awareness is baked at generation time; the active harness is chosen by which manifest dir the engine loads (`.claude-plugin` vs `.copilot-plugin`). Codex would be a third generated target. **crews does not own this seam; ralph-orchestration does.**

## Cross-lens convergence (the decision-shaping findings)

1. **The seam is the right layer, but a pure regex token-swap is NOT sufficient for codex.** Claude→Copilot works because `Agent` and `task` are near-isomorphic synchronous "spawn → await result text" calls. Codex is non-isomorphic: `spawn_agent` returns a *task-path* (not the answer), `wait_agent` returns only `{completed|timed_out}`, and child output is surfaced out-of-band. One `Agent(...)` call must lower to a **spawn → trigger (`followup_task`) → wait → collect → validate-JSON → close** state machine, not a one-liner. (codex D-001 "explicit spawn-wait-collect recipe"; DA "explicit state machine… not a one-line regex").
2. **The single load-bearing risk is RESULT COLLECTION, not spawn.** Top-level codex members already CAN spawn (the subagent gate only blocks depth-2). The unknown both lenses flag as gating: can a parent codex model recover each child's *full* final JSON using only model-visible tools (`list_agents` / message stream), or does reliable collection require out-of-band app-server/event-stream code? If the latter, the build-time prompt/artifact layer is the WRONG layer. (codex D-001 Q2; DA D-003 in full; corroborated by findings §7's recommended `multi_agent_v2=true` probe).
3. **Under-prompting must be fixed in the emitted block, not assumed away.** codex v1 actively gates spawning ("only if the user explicitly asks"); v2 is silent. The codex artifact must inject explicit when-to-delegate trigger guidance, and a plan must verify generated Ralph instructions actually count as "the user asked" under a v1 member (or mandate v2). (findings: subagent-prompt-trigger).
4. **v1 vs v2 target:** stock codex = v1 (`spawn_agent`/`send_input`/`resume_agent`); v2 (`spawn_agent`/`followup_task`/`wait_agent`/`list_agents`, task-path identities) is opt-in via `features.multi_agent_v2=true`. The codex lens leans v1-first/v2-opt-in; the DA leans v2 (cleaner collection surface). The recommendation below targets **v2** because the spawn→collect recipe is materially cleaner there, and couples the toggle to `codex-engine-ralph-member-enablement`.

## Candidate directions

### D-001: Codex generated target emitting an explicit spawn→trigger→wait→collect recipe, gated by a result-retrieval spike
- Contributing lenses: [codex, devils-advocate]
- Why this might work: Keeps all divergence plugin-side in the toolkit submodule the fork already owns (zero codex source patch), exactly matching the operator's "extend the existing seam, not a runtime adapter" steer and the investigations' "leverage = plugin-side" conclusion. The generator already has the substitution+parity machinery; adding a codex target reuses it. By emitting a *recipe/state machine* (spawn → `followup_task` → `wait_agent` → collect via `list_agents`/stream → validate JSON → `close_agent`, with fail-hard on timeout/missing-lens) plus injected when-to-delegate guidance, it addresses both the async-semantics gap and the under-prompting gap.
- Risks / friction: The `assertNoForbidden`/parity checker only sees strings — a generated codex artifact can pass token checks yet be semantically wrong (DA silent-failure). Depends on the parent model reliably remembering stateful task-paths and assembling results — instruction text, not an adapter. v1-vs-v2 chosen at generation time may not match the runtime config a member actually receives.
- Cheapest validation: D-003 (the disposable v2 retrieval spike) — this direction should be GATED on it.
- Disconfirming observation: If codex 0.135 cannot expose child final answers to the parent through model-visible tools (requires app-server/event-stream code outside the prompt), the build-time artifact layer is wrong and this must pivot to a runtime bridge or defer.

### D-002: Engine-neutral delegation macro/helper expanded per harness, with per-engine contract tests
- Contributing lenses: [codex, devils-advocate]
- Why this might work: Replaces the ad-hoc per-call regex with a named, engine-neutral "delegation" construct in the canonical source that the generator *lowers* per harness (Claude→`Task`, Copilot→`task`, codex→spawn/collect state machine), backed by per-engine contract tests. This is the "proper" long-term shape both lenses gesture at (codex D-003; DA "minimum viable shape") and the only form that keeps three harnesses from drifting semantically.
- Risks / friction: XL effort. Touches canonical Claude skill prose; if that prose must stay directly runnable as plain Claude-Code markdown (no macro syntax), this is too invasive now. Over-engineering risk if codex support never proves valuable.
- Cheapest validation: Confirm how many Ralph fan-out sites exist and whether the Claude source can tolerate a macro form without losing readability; otherwise D-001's per-target approach is the pragmatic first step.
- Disconfirming observation: If Claude source must remain macro-free plain markdown, this direction is ruled out for the immediate enablement.

### D-003: Disposable `multi_agent_v2=true` result-retrieval spike BEFORE any generator change (the prerequisite gate)
- Contributing lenses: [devils-advocate] (codex lens + findings §7 corroborate the underlying concern)
- Why this might work: De-risks the single largest unknown (convergence point #2) for near-zero cost. Enable `multi_agent_v2` for one member; spawn 2-3 children with unique task-names each required to emit JSON; `wait_agent`; retrieve each FULL final answer using only model-visible tools; validate JSON; force one timeout and confirm fail-hard/mark-missing behavior; `close_agent`. Optionally use v2 `root_agent_usage_hint_text`/`usage_hint_text` to isolate prompt-trigger feasibility from generator architecture.
- Risks / friction: Not a deliverable by itself — it gates D-001 rather than shipping it. Needs the `features.multi_agent_v2` plumbing path (`buildThreadConfig()` in happy-cli, or `~/.codex/config.toml`) audited.
- Cheapest validation: This *is* the cheap validation.
- Disconfirming observation: If the parent cannot recover full child outputs without out-of-band code, that result kills D-001's premise and points to D-004/D-005.

### D-004: Keep codex out of Ralph orchestration; treat it as target-runtime + specialist worker only (null option)
- Contributing lenses: [devils-advocate]
- Why this might work: Claude/Copilot already provide the synchronous contract Ralph was designed around. Codex adds v1/v2 branching, async semantics, prompt-trigger fragility, orphan-agent cleanup, and a third drift surface. Running Ralph fan-out under Claude/Copilot and spawning codex only for codex-specific execution may be simpler and more reliable. The better invariant may be *quality* parity, not every engine running every phase natively.
- Risks / friction: Preserves a visible gap (codex members stay degraded for multi-lens phases). Punts on operator intent.
- Cheapest validation: Identify a concrete workflow that actually requires codex *itself* to run Ralph brainstorm/review; if none exists, this option strengthens.
- Disconfirming observation: A clear workflow that needs codex-native Ralph fan-out (e.g., codex-only environments) would defeat this.

### D-005: Hand-author codex skill/agent variants beside Claude/Copilot (stopgap)
- Contributing lenses: [codex]
- Why this might work: Fastest path to *some* codex multi-lens for the narrow brainstorm/review skills, without touching the generator.
- Risks / friction: Immediate parity drift with no generator gate; a third hand-maintained harness surface maintainers must keep in sync. codex's own disconfirming note rules this out if many skills carry `Agent(...)` prose.
- Cheapest validation: Count `Agent(subagent_type=...)` occurrences across Ralph skills; if more than a couple, reject.
- Disconfirming observation: Any non-trivial number of fan-out sites makes hand-authored copies a drift liability.

## Recommendation

**D-001**, explicitly **gated by D-003**. This honors the operator's steer (extend the existing build-time seam in **ralph-orchestration**; no runtime adapter; plugin-side only) while incorporating the critical risk both lenses raised: a pure regex token-swap is insufficient, so the codex target must emit a spawn→trigger→wait→collect *recipe* with fail-hard handling and injected delegation guidance — and that whole premise hinges on result-collection feasibility, which the cheap D-003 v2 spike must validate first. Target **v2** (`features.multi_agent_v2=true`), coordinated with `codex-engine-ralph-member-enablement`. **Seam owner: ralph-orchestration. Version-bump target: ralph-orchestration 5.52.0** (minor — new generated harness surface + behavior change, not a breaking API change).

A plan for D-001 should open with the D-003 spike as story 1 and treat its outcome as a go/no-go for the remaining generator work.
