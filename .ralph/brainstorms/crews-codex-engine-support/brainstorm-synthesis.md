Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

# Brainstorm Synthesis — `crews-codex-engine-support`

> Multi-lens brainstorm to add codex as the third supported engine in the
> crews plugin, alongside Claude (v1.0) and Copilot (v1.3.0).

## Operating mode

Full mode — all three lenses (Codex Feasibility, Copilot Product-Reality,
Devil's Advocate) returned well-formed JSON.

## Recommended direction

**D-001 — Minimal viable codex member, hook-enforced but skill-deferred.**
This direction was contributed by ALL THREE lenses (Codex, Copilot, and
Devil's Advocate independently named a minimal-first variant). The
3-lens convergence is the strongest available signal that the
Copilot-v1.3.0-comparable "12-story port" is too aggressive as the
first ship. D-001 isolates the question crews actually needs answered
first (can a codex process participate in the crew protocol AT ALL?)
from the harder follow-on questions (skill discovery, bg-liveness
detection, full slash-command surface, daemon-bridge inversion).

The Devil's Advocate flagged a `red_flag: true` against the operator's
framing — the contrarian argument is genuinely strong (codex exposes
mcp-server / app-server / exec-server / session DB / plugin
primitives that may eventually invite an inversion to "crews-as-codex-
MCP-client" rather than "codex-as-third-launcher-target"). D-001
preserves that future optionality because it doesn't lock crews into
parity-with-Claude/Copilot semantics for codex; it ships the smallest
hook-enforced footprint that proves the integration is viable.

## Candidate directions

### D-001: Minimal viable codex member — hook-enforced, skill-deferred
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work:
  - Each lens independently identified "minimal first" as the lowest-risk
    path. Codex lens called it "M effort" with the assumption that crews
    is preinstalled via marketplace; Copilot lens framed it as "prove one
    member can receive one mailbox message and return one done report";
    Devil's Advocate framed it as "ship a degraded transcript-only MVP
    before chasing parity."
  - The Devil's Advocate's "transcript-only" variant is too weak (loses
    listener-arm + report-tag enforcement which are non-negotiable for
    crew protocol integrity). The synthesized direction adopts hook
    enforcement as mandatory while deferring the 21-skill overlay,
    progress-bg detection, peer/thread parity tests, and resume-via-
    transcript-existence fallback.
  - Real-world precedent: the v1.3.0 Copilot port itself shipped without
    its v1.6.0 `postToolUse` hook, its v1.8.12 `COPILOT_DISABLE_TERMINAL_TITLE`
    env stamp, its v3.1.0 progress-bg gate, and its v3.4.0 detector-
    broaden-infra-filter — all of these were follow-on hardening releases.
    Codex can follow the same staircase: "minimal viable" → "parity
    surface" → "operational hardening" across 2-3 ships.
- Risks / friction:
  - Codex hook event names + stdin payload shape are PROBE-DATA-MISSING.
    The 9 existing `.codex-plugin/` overlays in this monorepo (ado,
    agent-peers, devui, dotnet, edge-browser, options-mode, seval,
    sharepoint-docs, teams) are the canonical source — but they only
    show codex hooks crews-equivalent isn't a guarantee. Pre-plan
    spike must enumerate the actual codex hook event names, payload
    shapes, and decision-honoring semantics by reading one of those
    9 overlays end-to-end. options-mode is the recommended source
    because it already uses PreToolUse blocking + SyntheticResponse,
    the same surface crews needs.
  - No `--plugin-dir` flag on codex CLI. Codex plugin discovery is
    via `~/.codex/config.toml` `[marketplaces.<n>]` entries that point
    at a local source. The MVP needs either (a) plugin preinstalled
    via marketplace + cache (the Codex-lens D1 assumption), (b)
    per-spawn `-c marketplaces.crews.source=<abs>` override (probable
    but requires marketplace-key naming convention to be stable), or
    (c) write `~/.codex/config.toml` at spawn time (mutates user
    config, the most invasive option). Pick (b) for the MVP if the
    `-c` override actually works; document the dev-loop tax.
  - No `--name` flag on codex CLI. The `♙ <name> (<crew>)` tab title
    pattern that v1.5.8 ships for Claude/Copilot needs a different
    channel: wt.exe `--title` at spawn (works for the initial frame),
    plus possibly an env var stamp the codex launcher can read to
    suppress its own per-turn title rewriting (analog to the v1.8.12
    `COPILOT_DISABLE_TERMINAL_TITLE`).
  - Plugin-cache caveat (codex/CLAUDE.md): "Plugin source edits do
    NOT propagate to the marketplace cache." Iteration during dev
    will require either editing `~/.codex/plugins/cache/<m>/<p>/<v>/`
    in place per turn OR a wrapper script that copies source →
    cache before launch. Without this, smoke tests can silently pass
    against stale cached code.
- Cheapest validation:
  - Pre-plan codex-hook probe spike: read `options-mode/.codex-plugin/`
    end-to-end. Capture (1) actual codex hook event names; (2)
    stdin payload shape; (3) outbound-decision shape (PreToolUseHookResult);
    (4) plugin manifest schema (scope.agent, hooks block, skills block);
    (5) how options-mode handles SessionStart-style state-write needs.
  - End-to-end smoke: spawn a codex member with a hardcoded prompt,
    assert (a) SessionStart-equivalent fires and writes a member
    manifest with `engine: 'codex'`; (b) PreToolUse arm-first gate
    blocks any non-listener-arm tool until the listener is armed;
    (c) member receives one mailbox message via the armed listener;
    (d) Stop hook validates a `<|report kind="done"|>` tag and
    advances `lastReviewedSeq`; (e) `stop-member <name>` cleanly
    terminates the codex tab without leaving an orphan launcher
    pwsh process.
- Disconfirming observation:
  - **If codex hooks cannot honor `{ decision: 'block' }` from the
    PreToolUse path** (the existing v1.3.0 lesson is that Copilot
    doesn't honor decision: block for built-in tools; v1.3.8 had
    to add a separate routing path), the MVP cannot enforce the
    crews listener-arm-first invariant. Without that invariant, a
    codex member cannot reliably participate. Falsifies the entire
    direction.
  - **If codex cannot keep a long-lived listener subprocess alive
    while idle** (the Copilot lens's stated unknown), the mailbox
    cannot deliver to an idle codex member. Falsifies the direction
    unless an alternative delivery surface exists (e.g., codex
    mcp-server poll loop).

### D-002: Full Claude/Copilot parity port — v1.3.0-comparable 12-story plan
- Contributing lenses: [codex, copilot]
- Why this might work:
  - Predictable scope shape (Copilot v1.3.0 is a working template).
    Codex lens called it "L effort"; Copilot lens estimated the
    parity surface end-to-end. If executed, this delivers
    "codex member behaves indistinguishably from Claude/Copilot member"
    in a single ship.
  - Avoids the "second-class engine" perception risk that D-001 carries.
    Operators can `/spawn-member --engine codex` and expect every
    slash command, every report-tag form, every resume path to work
    identically.
- Risks / friction:
  - Copilot lens called this out explicitly: "A parity promise creates
    a large surface area for trust failures: launcher argv, plugin
    install/cache behavior, 3-way env scrubbing, resume, hooks,
    skills, tests, and docs all need to work before users will rely
    on it for autonomous members." 12 stories likely understates real
    effort — see v1.3.0 history, where 12+ stories shipped and were
    followed by v1.3.2, v1.3.5, v1.3.6, v1.3.8, v1.3.10, v1.3.11,
    v1.3.12 within the first 3 weeks (each fixing a downstream
    regression caught in real use).
  - Devil's Advocate's silent-failure scenario applies in full force:
    "The port passes spawn/resume/mailbox smoke tests, but every hard
    problem is solved by brittle shims: mutating ~/.codex/config.toml,
    scraping date-tree transcripts, reverse-engineering hook payloads,
    and relying on terminal title/PID heuristics."
  - PROBE-DATA-MISSING for at least 5 of the 12 stories (codex hook
    event names, codex async-bash semantics, codex transcript event
    schema, codex slash-command discovery surface, codex skill
    discovery / SKILL.md format). Building parity-the-first-time-out
    without that data is a gamble.
- Cheapest validation:
  - Copilot lens specified: "Map the Copilot v1.3.0 story list to
    Codex-specific equivalents and mark each story as pure translation,
    blocked on probe data, or novel design; implement only one hook
    shim test and one launcher argv test first."
  - The plan-phase output for this direction MUST include the
    probe-data spike as Story #0 with a pass/fail gate; if too many
    stories are "blocked on probe data," fall back to D-001.
- Disconfirming observation:
  - If more than ~3 of the 12 stories require mutating global
    `~/.codex/config.toml`, novel design (no Copilot analog), or
    reverse-engineering an unstable codex surface, this direction
    becomes too risky for one ship and must be split — which
    converges on D-001 + D-004 anyway.

### D-003: Engine-identity refactor first — stamp manifest, retire env-as-truth
- Contributing lenses: [copilot, devils-advocate]
- Why this might work:
  - Devil's Advocate argued the 3-way env-tiebreak is a smell:
    "env-derived identity is ambient, inherited, and exactly the
    wrong place to decide which transcript format, hook dialect,
    and launcher semantics apply." The fix is to stamp engine identity
    explicitly at spawn time into the actor manifest and have hooks
    READ from the manifest rather than infer from ambient env. The
    existing crews v1.6.1 work ALREADY does some of this (manifest
    has `engine`; launchers scrub the opposite engine env), but the
    `readSessionEnv()` tiebreak in `hooks/lib/session-env.js` is
    still the authoritative source for hook-time engine derivation.
  - Copilot lens framed the same insight differently: "Refactor the
    existing engine selection into an engine-adapter table for Claude
    and Copilot only, then add a stub Codex adapter that fails with
    explicit missing capability diagnostics for hooks, launcher,
    session path, and skills."
  - Adding codex as a third entry on a clean adapter table is much
    safer than tacking it onto an env-driven 2-way tiebreak. If
    crews intends to ever support a 4th engine (Aider? Cursor?
    something not yet shipped?), this refactor is unavoidable
    eventually; doing it BEFORE codex is the cheapest moment.
- Risks / friction:
  - Pure-refactor ships are unpopular — no user-facing capability
    delivered. Copilot lens's adoption-friction note: "users may
    see it as architecture work unless it directly removes binary
    Claude/Copilot assumptions and lowers future engine costs."
  - The refactor touches `hooks/lib/session-env.js`, `RuntimeContext.fromCli`,
    `applyEnvRole`, every hook entry point — high blast radius. A bad
    refactor could regress existing Claude/Copilot members.
  - "Refactor first, add engine second" doubles the time-to-codex-MVP
    versus "add codex with surgical env extension, refactor later."
- Cheapest validation:
  - One-PR refactor that introduces an engine-adapter table for the
    EXISTING two engines (no behavior change), followed by a
    follow-up PR that adds codex as a third entry. The first PR is
    rejected if it requires more than ~200 LoC of churn or breaks
    any existing test.
- Disconfirming observation:
  - If the existing v1.6.1 manifest-engine + launcher-env-scrub design
    is already sufficient to disambiguate the 3-way case (just add
    `CODEX_AGENT_SESSION_ID` to `readSessionEnv()`'s tiebreak with
    `CODEX_CLI=1` as the marker), then this refactor is overkill —
    D-001 covers the codex-engine-add without it.

### D-004: Durable parity infrastructure — codex resume, transcript indexing, bg-liveness
- Contributing lenses: [codex]
- Why this might work:
  - Codex lens specifically called out that the HARD problems of the
    port are post-launcher: "Codex rollout JSONL files do not contain
    stable session ids, tool execution events, or shell start/exit
    markers sufficient for `resume-crew` and progress/background-
    liveness checks to locate and classify a member session."
  - This is the natural follow-up ship after D-001 lands. v3.1.0's
    progress-bg gate already covers Copilot only; codex joins that
    pattern as a separate ship.
  - Crews v1.2.2+ "claude --resume <id> reuses the same session id"
    semantics work because Claude has a stable per-session
    transcript at `~/.claude/projects/<encoded-cwd>/<id>.jsonl`.
    Codex's `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`
    date-tree IS addressable but requires a different lookup
    pattern; codex's `resume [SESSION_ID]` does support targeting a
    specific UUID, but the cwd-filtering behavior and `--all` flag
    suggest there's per-cwd indexing that crews needs to understand.
- Risks / friction:
  - Single-lens identification → less validation that this is the
    right SECOND ship vs. (a) codex-skill-overlay or (b) codex-MCP
    integration spike.
  - Codex `app-server` and `mcp-server` subcommands are explicitly
    marked `[experimental]` in `codex --help`. Building durable-parity
    infrastructure on experimental surfaces is bet-the-future.
- Cheapest validation:
  - After D-001 ships, run a codex member for a full day in real
    crews work. Catalog every "could not resume" / "could not
    detect liveness" / "could not stop cleanly" incident. The
    catalog is the D-004 plan input.
- Disconfirming observation:
  - If D-001's post-ship usage shows codex resume/liveness/stop work
    "well enough" without specialized infrastructure (e.g., the
    `codex resume --last` UX is good enough for crews' usage patterns,
    or codex's session DB exposes enough hooks for liveness), D-004
    collapses to documentation rather than a code ship.

### D-005: Inversion via codex MCP/app-server — bridge, not terminal
- Contributing lenses: [devils-advocate]
- Why this might work:
  - DA's strongest contrarian move: "Prototype crews as a codex
    MCP/app-server client or bridge first: have crews talk to a codex
    daemon/session API, send mailbox events as tool/server messages,
    and let codex-native state own resume/session identity. Only add
    terminal-tab spawning if the daemon path cannot satisfy idle
    mail delivery, stop, and transcript requirements."
  - If codex's daemon surface can address sessions, deliver async
    notifications, and expose session identity, this avoids the
    plugin-cache iteration tax entirely (no plugin install — crews
    is just a client of the daemon API). It also avoids hook
    reverse-engineering (codex's mcp-server protocol is documented).
- Risks / friction:
  - Codex `app-server` and `mcp-server` are `[experimental]` — bet-
    the-future on shifting APIs.
  - The relevant `codex-app-server-daemon-codexu-integration` task
    is currently "brainstorm-first, JUST FILED" — its conclusions
    will inform D-005's feasibility but DON'T BLOCK D-005's research
    spike.
  - "Inversion" likely requires substantial rework of the crews
    protocol layer (currently centered on hook-driven Stop/PreToolUse
    enforcement); the rework would invalidate or modify existing
    Claude/Copilot integrations.
- Cheapest validation:
  - 1-day research spike: read codex `mcp-server` + `app-server`
    docs, attempt to (a) start a codex session via the daemon API,
    (b) inject a "mailbox message" as a tool call, (c) receive a
    "report tag" as a tool output. If any of these is impossible,
    D-005 is research detour.
- Disconfirming observation:
  - DA's own listed: "If codex's MCP/app-server surfaces cannot
    create or address independent interactive sessions, cannot
    deliver asynchronous mailbox notifications, or cannot expose
    enough session identity for stop/resume, then inversion is a
    research detour rather than an MVP path."

## Cross-lens questions for the plan phase

These open questions came up across multiple lenses and must be
answered by the plan-phase research spike:

1. **What are codex's actual hook event names + payload shapes?**
   Verified ground truth requires reading `options-mode/.codex-plugin/`
   end-to-end or running `codex` with a logging-only hook attached.
2. **Does codex honor `{ decision: 'block' }` from PreToolUse for
   built-in tools** (bash, edit, etc.)? Or is there an analog of the
   v1.3.8 routing path needed?
3. **Can crews load a local plugin without mutating `~/.codex/config.toml`?**
   Probe `codex -c marketplaces.<n>.source=<abs-path>` viability.
4. **What env vars does codex set for child processes** of an interactive
   session — is there a `CODEX_AGENT_SESSION_ID` analog, and does codex
   set a `CODEX_CLI=1` marker?
5. **Does the codex listener-arm-equivalent (bash async mode) exist?**
   If codex's bash tool can run `node $CREWS_BIN arm ... &` and keep
   the subprocess alive across the hook return, the existing listener
   loop works as-is; if not, the listener needs a different delivery
   modality.
6. **Default permission mode for codex members.** `--full-auto`
   (low-friction sandboxed) vs `--dangerously-bypass-approvals-and-sandbox`
   (skip all sandboxing) — which matches the trust model crews
   assumes for spawned members?
7. **How does codex display agent name?** wt.exe tab title only?
   Console window title? Both? Is there a `CODEX_DISABLE_TERMINAL_TITLE`
   analog?

## Recommended next step

Run `/plan-with-ralph --from-brainstorm
.ralph/brainstorms/crews-codex-engine-support/` to convert D-001 into
a story-decomposed PRD. The plan phase should start with a Story #0
"Probe codex hook + plugin surface" gate; if probe data invalidates
D-001's hook-enforcement assumption, replan to D-005 (inversion) or
defer the project.

Operator note: this brainstorm carries Devil's Advocate `red_flag:
true` against the operator's framing. The contrarian argument (codex
exposes daemon/MCP surfaces that may be a better integration boundary
than launching codex as a terminal tab) is genuine. D-001's
hook-enforced-but-skill-deferred scope deliberately keeps the
inversion option open by minimizing crews-side codex assumptions —
but the plan phase should re-read DA-D5 (D-005 in this synthesis)
before locking in.
