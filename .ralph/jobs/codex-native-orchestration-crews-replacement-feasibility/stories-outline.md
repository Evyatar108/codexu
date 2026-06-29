# Stories Outline: Native-codex inject endpoint — daemon-owned, hook-free crews shrink

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan`. THREE repos — split per `docs/multi-repo-split.md`. US-000 is a BLOCKING gate.*

## US-000: feasibility/seam spike + D-003 decision gate
**Description:** As a fork maintainer, I want a 1-2 day spike that proves how a daemon injects steer+wake into a native codex member, before committing to any codex patch.
**Acceptance Criteria:**
- [ ] Spike PROVES one path: (a) app-server `thread/inject_items`+`turn/steer` over loopback ws drives steer AND idle-wake (likely zero core patch); else (b) `pub` core wake wrapper; else (c) overlay listener. Decision recorded with evidence file:line.
- [ ] GO/NO-GO vs D-003 (file-ownership-only, keep hooks) documented; if NO-GO, stop and ship D-003.
- [ ] Confirms tui seam is OUTBOUND only (no Arc<Session>); injection sink chosen in core/app-server. Typecheck passes.
**Dependencies:** None · **Complexity:** medium · **Repo:** codex submodule (read) + happy-cli probe

## US-001: codex inject reach (gated on US-000=b/c only) + Windows transport auth
**Description:** If reuse path insufficient, expose a `pub` wake wrapper (default-off `LoopbackInject`) or overlay listener; secure the local endpoint.
**Acceptance Criteria:**
- [ ] Only if US-000 picks b/c: wake reachable from daemon; `LoopbackInject` default-off; `cargo check --workspace` passes; patch-surface.md invariant added.
- [ ] Local inject endpoint authed (named-pipe ACL Windows / capability-token, mirror codex ws-auth); no unauth injection.
**Dependencies:** US-000 · **Complexity:** large · **Repo:** codex submodule

## US-002: daemon inject client (stateless steer/wake)
**Acceptance Criteria:**
- [ ] `injectClient.ts` issues steer (RUNNING) and wake (IDLE); endpoint discovery + reconnect; typecheck + unit pass.
**Dependencies:** US-000 · **Complexity:** medium · **Repo:** happy-cli

## US-003: daemon reads AppServerEvent + member identity registration
**Acceptance Criteria:**
- [ ] Identity registration on member start; kind-tag/turn/crash derived from `TurnStarted/Completed`+`ItemStarted/Completed`; process-liveness crash check. Typecheck + unit pass.
**Dependencies:** US-002 · **Complexity:** medium · **Repo:** happy-cli

## US-004: daemon sole-writer + writer inventory (drop locks)
**Acceptance Criteria:**
- [ ] Writer inventory proves NO writer outside daemon (consumer bridge/ingest/crews stop/review-mail/session-start/crash-sweep); pending→injected→observed cursor only advances on observed; zero `.lock`. Tests green.
**Dependencies:** US-003 · **Complexity:** large · **Repo:** happy-cli

## US-005: daemon SPOF recovery
**Acceptance Criteria:**
- [ ] Daemon restart re-injects only un-observed mail (no dup); integration test green. Typecheck passes.
**Dependencies:** US-004 · **Complexity:** medium · **Repo:** happy-cli

## US-006: drop ALL crews hooks behind flag
**Acceptance Criteria:**
- [ ] Remove pre/post/stop/session-start **+ user-prompt-submit + codex-* + listener-protocol** under `CREWS_DAEMON_INJECT`; slash-cmd dispatch rehomed to daemon; native spawn kept; `run.js` tests green; no hard turn-veto. Typecheck passes.
**Dependencies:** US-005 · **Complexity:** large · **Repo:** ai-developer-toolkit

## US-007: pilot ONE fan-out (e2e)
**Acceptance Criteria:**
- [ ] One real fan-out: member injected RUNNING steer + IDLE wake, daemon restart, no dup, zero .lock, zero crews hook registration, Windows transport. D-003 retreat doc'd. Typecheck passes.
**Dependencies:** US-006 · **Complexity:** medium · **Repo:** ai-developer-toolkit
