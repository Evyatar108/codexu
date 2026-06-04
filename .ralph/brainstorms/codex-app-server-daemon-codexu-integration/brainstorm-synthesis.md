Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

The Codex lens (which actually probed the repo) made the most important framing correction: the fuzzy idea's premise — that "the integration is minimal and reactive ... lifecycle is undefined" — is partially stale. `packages/happy-cli/src/codex/codexAppServerDiscovery.ts` and `codexAppServerClient.ts` already implement loopback-WebSocket discovery keyed by `realpath(cwd)` under `HAPPY_HOME`, a spawn/reattach lock, detached child processes that survive foreground CLI exit, and a `happySessionId` mismatch guard that terminates stale servers. Codex also discovered that there IS a Rust `app-server-daemon` crate upstream — but its README and code declare lifecycle Unix-only, which is a hard blocker on the Windows-first dev box. The Copilot lens converged independently on "observability + discovery + minimal supervision first, multiplexing later, and only with identity isolation." The Devil's Advocate lens went further with the contrarian "instrument-before-supervising" framing and warned that multi-client sharing would silently break per-session isolation that codexu currently relies on by accident. Three lenses on three directions, with one direction (Rust daemon adoption) explicitly flagged as deferred.

### D-001: Harden happy-cli-owned discovery, lifecycle, and observability
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: The 70% solution already exists in `packages/happy-cli/src/codex/` — discovery, locking, detachment. Hardening this surface plus adding a `happy codex doctor`/`status` command (sidecar metadata: pid, endpoint, last health check, clients, last-active-at, exit reason) closes the operator-visible gaps in observability and lifecycle without touching the codex Rust submodule. Reuses existing TypeScript infrastructure, no upstream-conflict surface, fits the Windows-first constraint.
- Risks / friction: Operators must adopt a new status command for it to pay back; risk of becoming another sidecar nobody checks. Also, "minimal supervision" (lazy reconnect / proactive auto-restart) is where YAGNI bites — Devil's Advocate's warning applies: do not build a supervisor that masks crashes by auto-restarting and losing session state.
- Cheapest validation: Ship `happy codex doctor` + structured sidecar logging (spawn/disconnect/exit code/RSS/cold-start ms/last-client) WITHOUT changing process ownership. After two weeks of operator usage, decide from telemetry whether proactive supervision is worth building.
- Disconfirming observation: If existing happy-cli traces show repeated unexplained codex app-server exits or 10-15s cold-start waits on normal reconnects that observability alone cannot resolve, then proactive supervision must be brought in earlier.

### D-002: Identity-scoped multi-client sharing (gated on isolation proof)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Local happy-cli + remote happy-server-driven mobile clients both pay the ~1GB RSS + ~10-15s warm cost per separate daemon. Codex's `app-server` already supports multiple WebSocket clients in principle; the gap is policy: which clients are allowed to share, and what isolation guarantees does the protocol actually provide?
- Risks / friction: This is where the operator's framing collides with reality. Devil's Advocate is correct: a shared daemon may leak cached tool permissions, MCP handles, OAuth tokens, or cwd-specific file handles across sessions. Today's `happySessionId` mismatch guard intentionally terminates stale servers, which is the SAFE-by-default behavior we are tempted to relax. Loosening it without a proof of per-session isolation in the codex protocol creates silent multi-tenant bugs.
- Cheapest validation: Two-Happy-session smoke test before any code change — drive two distinct happy-cli sessions against one app-server with distinct identities and see whether approval requests, thread subscriptions, or Codex account state leak. If yes, this direction is impl-deferred. If no (or only for narrow same-identity reattach), file a small same-identity reattach feature task.
- Disconfirming observation: If the smoke test shows any cross-session state leakage, the entire multi-client-sharing direction stays in brainstorm-only / impl-deferred status until the codex protocol provides per-session isolation guarantees.

### D-003: Defer Rust app-server-daemon adoption; track upstream
- Contributing lenses: [codex, devils-advocate]
- Why this might work: The upstream codex Rust `app-server-daemon` is the "proper" place to put lifecycle, supervision, and discovery semantics — but it is Unix-only today and would force sandbox-patches that fight every 2-4-week upstream sync. The discipline call is to NOT carry shadow-fork daemon policy in the codex submodule. Instead, codexu owns the happy-cli adapter, and we let upstream evolve the Rust daemon shape.
- Risks / friction: This is a "not yet, here's why" direction — its value is preventing scope creep on more aggressive proposals. The risk is that operators feel the pain before upstream ships, but D-001 plus D-002-when-safe should absorb most pain without daemon-level work.
- Cheapest validation: File a `codex-app-server-daemon-windows-upstream-watch` brainstorm-only task that just tracks upstream's Windows-support roadmap and revisits this every 2 syncs. No impl work in codexu/codex submodules until either (a) upstream ships Windows lifecycle, or (b) D-001 telemetry proves a recurring user-visible failure that adapter-layer changes cannot fix.
- Disconfirming observation: If upstream codex announces a Windows daemon roadmap, OR D-001 telemetry shows happy-cli-layer fixes are inadequate within ~1 month of shipping, revisit and consider partial adoption (e.g., just the discovery protocol overlay).

### D-004: Instrument-only measurement-first task
- Contributing lenses: [devils-advocate]
- Why this might work: Devil's Advocate's strongest move — before deciding which gap to prosecute, prove which one actually hurts. This direction proposes a 1-week scoped task that adds nothing but telemetry (spawn count, cold-start ms, RSS at exit, crash signature, last-client age, restart attempts if any) to happy-cli and happy-server's codex-spawn code paths. NO behavior change. NO daemon-mode changes.
- Risks / friction: Operator may see this as stalling. Mitigation: limit to a 1-week scope and lock the deliverable to "telemetry dashboard query + 1-week observation window report."
- Cheapest validation: The task IS the cheapest validation — it tells us whether D-001's supervision sub-feature is YAGNI or load-bearing, and whether D-002's RSS savings are actually material vs. the isolation risk.
- Disconfirming observation: If existing telemetry (happy-server logs, happy-cli traces) already provides enough signal to skip this step, fold the measurement into D-001's "before/after" gate and don't track separately.

---

**Synthesis recommendation:** D-001 is the unambiguous "do first." It has the strongest multi-lens convergence, the lowest upstream-conflict surface, the clearest cheapest-validation step, and it produces the telemetry foundation that informs whether D-002 is ever worth pursuing. D-002 stays tracked but explicitly gated. D-003 is the explicit "do not pursue yet" call (file as upstream-watch brainstorm). D-004 is folded as the first sub-story of D-001 rather than tracked separately.

**Follow-up tasks the bookkeeper should file after this brainstorm ships:**

1. `codex-daemon-happy-cli-doctor-and-telemetry` (impl-worthy, P1) — implements D-001 + folds in D-004. Scope: `happy codex doctor` command, sidecar metadata file under `HAPPY_HOME`, structured spawn/exit/cold-start/RSS logging. NO new supervision, NO multiplexing.

2. `codex-daemon-isolation-smoke-test` (brainstorm/research, P2) — implements D-002's cheapest validation: a two-session smoke test to determine whether the codex app-server protocol actually isolates sessions. Output is a written finding (impl-worthy or impl-deferred), not code.

3. `codex-daemon-upstream-windows-watch` (brainstorm-only, P3) — implements D-003. Just a tracked task that revisits upstream's Windows roadmap every 2 sync cycles. No impl.

4. (Conditional, only if #2 finds isolation is safe) `codex-daemon-same-identity-reattach` (impl-worthy, P4) — narrow scope: relax `happySessionId` mismatch ONLY for same-identity reattach, no cross-identity sharing.

5. (Existing) `codex-app-server-idle-timeout` (already tracked, brainstorm-only) — explicitly absorbed by D-001's lifecycle telemetry; consider closing as duplicate or promoting to plan once D-001 ships with the observability data needed to choose a timeout policy.

**Out of scope for this brainstorm:**
- Supervision / auto-restart (deferred until D-004 telemetry proves it matters)
- Cross-machine discovery (happy-server remote → local codex daemon over tunnel)
- Daemon-side context sharing / conversation reuse across sessions
- Adopting the Rust `app-server-daemon` crate
- Auth/identity unification across happy-server-spawned vs. happy-cli-spawned daemons (waits for D-002 finding)
