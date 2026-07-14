# Stories Outline: Codex V2 Copilot Plaintext Subagent Handoff and Exact Wait

*Preliminary decomposition from `/plan-with-ralph`. The three repository-scoped implementation seeds are materialized under `scoped-plans/`; do not run this combined outline directly.*

## US-001: Add the general provider capability
**Description:** As a Codex provider integrator, I want a runtime capability for encrypted inter-agent messages so each provider can advertise truthful support.
**UI/UX judgment:** not-required
**Acceptance Criteria:**
- [ ] `ProviderCapabilities` defaults encrypted inter-agent messages to supported, Copilot overrides to unsupported, and Bedrock/default providers remain supported.
- [ ] No serialized provider-info, config, app-server, or protocol schema is widened.
- [ ] Focused provider tests pass.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Make V2 message schemas and runtime encoding truthful
**Description:** As a V2 collaboration user, I want spawn, send, and follow-up messages encoded according to provider capability so Copilot receives usable plaintext while capable providers stay encrypted.
**UI/UX judgment:** not-required
**Acceptance Criteria:**
- [ ] `spawn_agent`, `send_message`, and `followup_task` omit the encrypted schema field and emit nonempty `agent_message/input_text` for unsupported providers.
- [ ] Capable providers retain the encrypted schema and `encrypted_content`; plaintext is never stored under `encrypted_content`.
- [ ] One encoding mode is resolved once and shared by each tool's schema and handler.
- [ ] Model, effort, fork, queue, trigger, V1, and protocol behavior remain unchanged.
- [ ] Focused schema, planning, handler, encoding, and encrypted-wire tests pass.
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Add exact race-safe V2 task wait
**Description:** As a parent agent, I want `wait_agent` to target one exact V2 task so unrelated completions cannot satisfy role-specific orchestration.
**UI/UX judgment:** not-required
**Acceptance Criteria:**
- [ ] V2 accepts optional `task_name` and subscribes before reading current state from the same receiver.
- [ ] Exact waits preserve steering and timeout, ignore unrelated activity, and classify initial-subscription and channel-closure races without false `NotFound` success.
- [ ] Exact begin/end telemetry has one matching pair with equal sender/call IDs and target-only status; invalid non-UUID targets emit no wait events.
- [ ] The deterministic race/isolation/steering/timeout/closure matrix passes, including `Completed(None)`, nonexistent UUID, and resolve-then-remove.
- [ ] Omitted-target V2 and every V1 path remain green.
**Dependencies:** US-002
**Estimated complexity:** large

## US-004: Register, document, and validate the fork patch
**Description:** As a fork maintainer, I want invariant and replant documentation for the provider-aware handoff and exact wait so future rebases preserve the behavior.
**UI/UX judgment:** not-required
**Acceptance Criteria:**
- [ ] Every changed upstream-canonical logical block has exactly one applicable `// SANDBOX PATCH:` marker family.
- [ ] `multi_agent_v2_handoff.rs` guards both features and the extracted shared schema module leaves `multi_agents_spec.rs` at or below 800 lines.
- [ ] Patch-surface §14/§15, regression history, `codex/CLAUDE.md`, install, and developer guidance are current.
- [ ] The authoritative release command uses `just test`, project-relative evidence paths, and all canonical wrapper mirrors.
- [ ] `publish-npm.yml` retains only bundle/GitHub Release publication; active package-publication scans are clean.
- [ ] Wrapper invariant tests, audits, Phase 5a, and Phase 5b converge.
**Dependencies:** US-003
**Estimated complexity:** large

## US-005: Publish Codex 0.141.0-copilot-api.4
**Description:** As a release operator, I want a reviewed, candidate-bound `.4` release so installed acceptance tests the exact code and artifacts that were approved.
**UI/UX judgment:** not-required
**Acceptance Criteria:**
- [ ] PRD C first commits tested release schemas and validators; the lead performs no coding.
- [ ] Focused gates, frozen-profile workspace check, operator-approved complete `just test`, and all four release-binary builds pass.
- [ ] A prepublication receipt and operator approval bind the final nested SHA, exact wrapper candidate SHA, three wrapper mirrors, tags, asset, digest, and external actions.
- [ ] Wrapper `main` is fast-forwarded and SHA/ancestry-verified on `origin`, `work`, and `personal` before the immutable origin tag and GitHub Release are created.
- [ ] The release bundle contains four `.4` Codex binaries plus hash-verified `rg.exe`.
- [ ] Release validation passes and the receipt/evidence checkpoint is committed before installation is requested.
**Dependencies:** US-004
**Estimated complexity:** large

## US-006: Install and prove the exact Ralph 5.64 V2 dogfood
**Description:** As the operator, I want the published `.4` bundle installed and exercised through installed Ralph 5.64 so plaintext Copilot handoff and exact role waits are proven end to end.
**UI/UX judgment:** not-required
**Acceptance Criteria:**
- [ ] The operator-owned install receipt proves the exact asset, npm entry, PATH order, five-file vendor inventory, and `codex-cli 0.141.0-copilot-api.4`.
- [ ] Ralph plugin provenance binds an immutable source commit and package digest while permitting only the documented deterministic skills-path rewrite.
- [ ] The tracked task-local runner and static inputs match their prerequisite commit byte-for-byte before invocation.
- [ ] All four Ralph plan roles use Copilot `gpt-5.6-sol`/`xhigh`, receive nonsecret readable input, complete their exact targeted waits below 600000 ms, and produce meaningful role-specific evidence.
- [ ] Raw pre-`.4` evidence stays outside Git; only sanitized, scanned, hash-correlated derivatives are committed.
- [ ] Acceptance validation passes and authorizes parent closeout.
**Dependencies:** US-005
**Estimated complexity:** large

## US-007: Complete codexu pointer and blocker closeout
**Description:** As the bookkeeper lead, I want codexu to record the accepted release and unblock Ralph 5.64 only after every immutable receipt has been revalidated.
**UI/UX judgment:** not-required
**Acceptance Criteria:**
- [ ] A hash-bound lead-closeout request revalidates the wrapper release SHA, acceptance summary, and evidence checkpoint.
- [ ] Codexu advances its `codex` gitlink only to the accepted wrapper release commit.
- [ ] `node tools/data-edit.mjs` updates the correct hot or archived overview shard without raw edits.
- [ ] Ralph 5.64's Codex-runtime blocker is removed only after installed acceptance passes; the separate Ralph hardening task remains separate.
- [ ] Rollback instructions pin and verify the `.3` asset, tags, commits, gitlink, V2 containment, PATH/vendor state, and V1 canary.
**Dependencies:** US-006
**Estimated complexity:** medium
