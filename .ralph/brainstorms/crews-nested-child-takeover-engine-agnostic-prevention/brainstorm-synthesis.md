Lenses: ran=[devils-advocate, codex, copilot]; skipped=[] (source-driven synthesis from crews+ralph code)

# Brainstorm synthesis — crews nested child takeover engine-agnostic prevention

**Task:** `crews-nested-child-takeover-engine-agnostic-prevention`

**Problem framing.** Nested child processes launched by a crews member inherit the parent's `CREWS_*` role env, then fire SessionStart and attempt a role claim under the child's own `session_id`. In crews, the claim path reads `CREWS_ROLE`, `CREWS_NAME`, and `CREWS_CREW` (`plugins/crews/hooks/session-start.js:77-82`) and resolves state scope from `CREWS_STATE_CWD` (`plugins/crews/hooks/runtime-context.js:106-109`, `plugins/crews/hooks/paths.js:31-44`). The member launcher explicitly exports those vars (`plugins/crews/hooks/actors.js:2719-2729`), so any unsanitized descendant can present as the parent identity.

The current 3.21.4/3.21.5 guards are defensive but late: GAP2 in `applyEnvRole` is engine-mismatch only (`session-start.js:101-117`) and does not trigger for same-engine nesting; same-engine protection depends on GAP1 live-tab refusal in `assignMemberRole` (`actors.js:1039-1080`). That means same-engine nested children still reach claim logic and rely on liveness classification instead of being prevented at spawn boundary.

## Direction options

### D-001: Primary spawn-site env sanitization in ralph + crews ancestry defense-in-depth
- Contributing lenses: [devils-advocate, codex, copilot]
- Why this might work:
  - **Primary prevention**: strip crews identity vars before nested engine/lens spawns in ralph so child SessionStart has no claimable identity.
    - Implementer loop path: `ralph.mjs` passes inherited env into iteration child (`src/ralph.mjs:53,203-214,918-970`), `codex-exec.mjs` clones full env in `buildChildEnv` (`src/codex-exec.mjs:99,139,186-190,386-394`), and `copilot-exec.mjs` forwards inherited env to child (`src/copilot-exec.mjs:155-163,255-263,435-447`).
    - Lens fanout paths: brainstorm and plan skills invoke `node "$PLUGIN_DIR/src/codex-exec.mjs"` / `copilot-exec.mjs` from member context (`skills/brainstorm-with-ralph/SKILL.md:131-157`, `skills/plan-with-ralph/SKILL.md:670-704`), so they inherit parent `CREWS_*` unless explicitly scrubbed.
  - **Defense in depth**: add a nested-child ancestry refusal in crews SessionStart/assign path using existing process ancestry primitives, not engine checks:
    - `describeProcess` exposes `parentProcessId` (`hooks/actors.js:2229-2244`).
    - `resolveLauncherChildAncestor` already proves descends-from-launcher (`hooks/actors.js:2350-2384`).
    - New rule: if incoming process descends from currently bound member launcher and `sessionId` differs, decline regardless of engine.
- Risks / friction:
  - Requires coordinated changes across **both plugins** (`ralph` spawn env and `crews` guard), so ship sequencing must avoid same-plugin version collisions and include a cross-plugin integration test pass.
  - Must preserve legitimate same-tab `/clear` reclaim (`actors.js:1042-1072`) and first-bind safety (`actors.js:1011-1019`, tests A4/A4b).
- Cheapest validation:
  - Same-engine dogfood: codex member -> codex iteration with no manifest takeover and successful `done` delivery.
  - Cross-engine dogfood: copilot member -> codex iteration still blocked from takeover.
  - Brainstorm/plan lens dogfood: codex/coplan lens children do not claim member role.
- Disconfirming observation:
  - If a required nested spawn path cannot be sanitized (architecturally unavoidable env inheritance), ancestry guard must become the hard gate and sanitization remains best-effort.

### D-002: Marker-only suppression (`CREWS_SUPPRESS_CLAIM=1`) on nested children
- Contributing lenses: [devils-advocate, copilot]
- Why this might work:
  - Minimal crews change: SessionStart short-circuits role claim when marker is set.
  - Minimal ralph change: set marker on codex-exec/copilot-exec/plan/brainstorm lens spawns.
- Risks / friction:
  - Coverage risk: every current and future nested spawn site must set marker correctly; one miss reopens hijack.
  - Spoofability concerns: marker is advisory env state, not structural process proof.
- Cheapest validation:
  - Inventory all spawn sites and assert marker presence in unit tests for each.
- Disconfirming observation:
  - Any nested path outside ralph-controlled spawns that can still claim role makes this insufficient as sole guard.

### D-003: Crews-only hardening (lean on GAP1; de-emphasize GAP2)
- Contributing lenses: [codex]
- Why this might work:
  - No ralph changes; rely on live-owner/session guard (`actors.js:1039-1080`) plus additional liveness/ancestry hardening.
- Risks / friction:
  - Leaves source leak in place (children still present parent identity env and attempt claims).
  - More race/observability sensitivity than spawn-boundary prevention, especially if liveness is unavailable/unreliable.
- Cheapest validation:
  - Stress tests with repeated nested spawns under load, listener churn, and stale heartbeat windows.
- Disconfirming observation:
  - Any reproducible same-engine takeover with uncertain liveness signals invalidates crews-only strategy.

## Recommendation

**Recommended: D-001** — make spawn-site env sanitization the primary prevention and add ancestry-based refusal in crews as defense-in-depth.

This directly addresses the operator constraint ("same engine is possible") because it does not depend on engine mismatch at all. The child never gets claim identity at the source, and even if a spawn path is missed, ancestry refusal blocks nested claims structurally.

## Required env identity inventory (what to sanitize)

For nested children, treat these as role-claim sensitive and remove/rename in child env:
- `CREWS_ROLE`, `CREWS_NAME`, `CREWS_CREW` (claim identity inputs in `session-start.js:77-82`)
- `CREWS_STATE_CWD` (routes child to parent's state root via `runtime-context.js:106-109`)
- `CREWS_BOOTSTRAP_REPLY_TO` (avoid accidental bootstrap history side effects, `session-start.js:313-331`)
- keep non-identity operational knobs only if needed (`CREWS_ENGINE` is not identity by itself; it is used for engine tagging/guards)

`CREWS_CODEX_SESSION_ID` is session-env detection for CLI identity (`hooks/lib/session-env.js:20-40`), but SessionStart claim authority is still `data.session_id` + `CREWS_ROLE/NAME/CREW`; sanitize it together with role vars on nested children to avoid ambiguous identity context.

## Story outline for follow-on plan

1. **Ralph spawn-env sanitizer utility**: introduce centralized helper (used by `ralph.mjs`, `codex-exec.mjs`, `copilot-exec.mjs`, and review/lens spawn points) that removes crews claim env for nested runs.
2. **Wire sanitizer to all nested spawn sites**: implementer iterations + brainstorm/plan/review lens child launches.
3. **Crews ancestry guard**: add engine-agnostic nested-child refusal in SessionStart/assign path using launcher ancestry resolution.
4. **Tests**:
   - Ralph unit tests for child env scrub coverage per spawn site.
   - Crews tests for ancestry decline + non-regression for same-tab `/clear`, first bind, recoverable dead takeover.
   - End-to-end dogfood acceptance (same-engine codex case mandatory).
5. **Ship sequencing note**:
   - Because this touches both `plugins/ralph` and `plugins/crews`, sequence as two coordinated plugin bumps; if there is an in-flight same-plugin impl (`impl-sscaveats`) serialize crews-side landing to avoid version-file conflicts.
