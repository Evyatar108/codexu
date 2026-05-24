# PRD: Codex Wire-Acceptance Spike

*Generated in autonomous mode from `plan.md` + `stories-outline.md`. Source-of-truth for stories: `stories-outline.md` (acceptance criteria copied verbatim).*

## Introduction

A short (~30-minute) research-only spike that connects to a real `codex app-server` over JSON-RPC stdio, issues three hand-crafted probes, captures the responses + downstream notifications, and appends a "Wire spike results" section to `plans/codex-agent-parity-audit.md` with definitive answers + payload evidence for three wire-acceptance questions blocking the Gap 2, Gap 3, and Gap 5 fix-PRs. No production code is modified. The spike artifact (`tasks/spikes/codex-wire-spike.mjs`) is committed alongside the audit-doc update so the findings are reproducible.

The three questions:

1. **Q1 (Gap 3 pre-flight):** Does `codex app-server` accept `{ type: "image", url: "data:image/png;base64,..." }` end-to-end (model API actually sees the image), or is the data: URL silently dropped vs. rejected? Same question for `localImage`.
2. **Q2 (Gap 2 pre-flight):** Does setting `config: { project_doc_fallback_filenames: ["CLAUDE.md", ...] }` on `thread/start` actually cause codex-core to load CLAUDE.md? Direct source-verification of `agents_md.rs:285-319` already shows hardcoded-`AGENTS.md`-prefix behavior; the spike empirically confirms this so the audit's recommendation can be corrected.
3. **Q3 (Gap 5 pre-flight):** Is happy-cli's top-level `compactPrompt: string | null` on `NewConversationParams` honored by the v0.125 server, or is it silently dropped because the server-side `ThreadStartParams` lacks the field and serde does not deny unknown fields? If silently dropped, the correct path is `config.compact_prompt` (which is where `compact_prompt` lives in the server-side `Config` struct).

## Goals

- Land empirical, payload-cited answers to Q1/Q2/Q3 in `plans/codex-agent-parity-audit.md`.
- Provide a re-runnable Node.js spike script (`tasks/spikes/codex-wire-spike.mjs`) — no `package.json` changes, no new deps — so future maintainers can re-spike on codex-version drift.
- Unblock the `codex-attachments`, `codex-claude-md-autoload`, and `codex-slash-commands` ralph commands by removing the speculative "Need to spike" / "Open question for operator" callouts in Gap 2, 3, 5.
- Update Gap 2's recommendation (`['CLAUDE.md', 'AGENTS.md']` works for CLAUDE-only projects but cannot achieve same-dir CLAUDE-first when AGENTS.md is present).
- Make zero production-code changes — the only files modified are the audit doc and the new spike script.

## User Stories

### US-001: Build spike harness and run Q2 (project_doc_fallback_filenames)

**Description:** As an audit-doc maintainer, I want a JSON-RPC spike harness against a real `codex app-server` that resolves Q2 (config knob `project_doc_fallback_filenames`) using the auth-free `ThreadStartResponse.instruction_sources` oracle, so that downstream Q1/Q3 probes can build on a derisked harness foundation.

**Acceptance Criteria:**
- [ ] `tasks/spikes/codex-wire-spike.mjs` exists; spawns `codex app-server` as a child process via `child_process.spawn` with auth-preserving isolated `CODEX_HOME=<fresh-tmpdir>/codex-home`: harness copies `auth.json` from the operator's real `CODEX_HOME` (env var first, else `~/.codex/`) into the tmpdir, leaves `config.toml` empty, falls back to `OPENAI_API_KEY` env passthrough if no auth.json. Harness also issues a startup `config/read { include_layers: true }` taint check and warns if a managed-config layer overrides `project_doc_fallback_filenames` or `compact_prompt` (managed-config is not isolatable on release `codex` binary per `app-server/src/main.rs:42-57,83-104` debug-only guards).
- [ ] Harness sends `initialize` with `capabilities: { experimentalApi: true }` and `notify('initialized')` before any `thread/start` (matches happy-cli's handshake at `codexAppServerClient.ts`).
- [ ] All three Q2 probes (3a CLAUDE-only with config knob, 3b CLAUDE-only without knob, 3c BOTH files present with `['CLAUDE.md','AGENTS.md']` knob) execute end-to-end and capture each `ThreadStartResponse.instruction_sources` array.
- [ ] Captured findings are written to an in-memory or scratch-file structure ready to be inlined into the audit doc in US-003.
- [ ] All RPC calls bounded by a 10-second timeout; script exits cleanly even when an RPC hangs (no `codex app-server` orphan after exit).
- [ ] `codex --version` output captured at spike runtime (for audit-doc header in US-003).
- [ ] Typecheck passes (script is `.mjs` so this means it parses and runs; no TypeScript involved).

### US-002: Q1 (image input shape) and Q3 (compactPrompt placement)

**Description:** As an audit-doc maintainer, I want the spike to definitively answer whether codex-core accepts data: URLs as image input AND whether happy-cli's top-level `compactPrompt` field is silently dropped vs. honored when nested under `config.compact_prompt`, with thread-scoped evidence — so that the `codex-attachments` and `codex-slash-commands` ralph commands can be written without false assumptions.

**Acceptance Criteria:**
- [ ] Q1: harness inlines a discriminating canary PNG (NOT a 1×1 transparent placeholder) — either a pre-rendered PNG containing visible text `SPIKE-CANARY-Q1-XJ7QK` OR a solid-color image with prompt designed to require image-read.
- [ ] Q1: harness sends `turn/start` with the `image` variant (`{ type: 'image', url: 'data:image/png;base64,...' }`) and captures `item/agentMessage/delta`/`item/completed`/`error`/`turn/completed` notifications. (`turn/completed` alone is lifecycle, not content — not sufficient evidence.)
- [ ] Q1: same probe repeated with `localImage` variant pointing at a tmpfile path.
- [ ] Q1: each variant produces one of three verdicts based on captured agent content: ✓ accepted / ⚠ silently dropped (agent says `NO IMAGE RECEIVED` or describes nothing) / ✗ rejected (JSON-RPC error captured).
- [ ] Q3: **oracle confirmed first.** Before writing the comparison probe, harness greps `app-server-protocol/src/protocol/v2/thread.rs` for `compact_prompt` to discover any cheaper thread-scoped read RPC. If none, harness uses `thread/compact/start` event capture (the only confirmed valid oracle — requires working auth). If auth is unavailable AND no cheap thread-scoped read RPC exists, Q3 records the static-source verdict ("`ThreadStartParams` lacks the field; serde doesn't deny_unknown_fields; top-level is dropped at deserialization") and notes that Q3 needs re-spiking with auth before Gap 5's wire-shape fix is finalized.
- [ ] Q3: harness runs two `thread/start` calls — one with top-level `compactPrompt: "CANARY-Q3-TOP-XJ7QK"`, one with nested `config: { compact_prompt: "CANARY-Q3-NESTED-XJ7QK" }` — and captures thread-scoped evidence (per the oracle above) of which canary is the live prompt-of-record for each.
- [ ] Q3 does NOT use `config/read` as a thread-scoped oracle (reads disk-layered config with no per-thread overrides, per `v2/config.rs:329-347` + `app-server/src/config_manager_service.rs:109-152`) AND does NOT use rollout-file grep (`compact_prompt` is NOT persisted in `SessionMeta` `protocol.rs:2704` nor `TurnContextItem` `protocol.rs:2808`; held only in runtime turn context `core/src/session/turn_context.rs:77`).
- [ ] All RPC and event-wait timeouts bounded (10 s response, 30 s turn-complete, 60 s thread-compacted).
- [ ] Typecheck passes.

### US-003: Append "Wire spike results" to plans/codex-agent-parity-audit.md

**Description:** As an audit-doc consumer (operator preparing follow-up ralph commands), I want a "Wire spike results" section with definitive answers + inline payload evidence + cross-references from the existing Gap 2/3/5 callouts, so that the `codex-attachments`, `codex-claude-md-autoload`, and `codex-slash-commands` ralph commands can be written with grounded wire-acceptance assumptions.

**Acceptance Criteria:**
- [ ] New section `## Wire spike results` is appended to `plans/codex-agent-parity-audit.md` AFTER the existing `## Open questions surfaced by this audit` section, with date + `codex --version` in the section header.
- [ ] Section contains three subsections: §1 (image input — Gap 3), §2 (project_doc_fallback — Gap 2), §3 (compactPrompt — Gap 5). Each subsection has: (a) the request payload(s) as fenced ```json blocks, (b) the response/notification evidence as fenced ```json blocks, (c) a verdict line in **bold**, (d) one-sentence implication for the corresponding Gap fix-PR.
- [ ] Cross-cutting verification block at audit-doc lines 351-356 is replaced with a single link to the new section.
- [ ] Gap 2 lines 95-101 (its "Open question for operator" + AGENTS.md/CLAUDE.md ordering recommendation) are updated to reflect the spike's source-verified resolution: same-directory CLAUDE-first cannot be achieved via `project_doc_fallback_filenames` (hardcoded `AGENTS.md` prefix in `agents_md.rs:285-319`); the audit's `['CLAUDE.md', 'AGENTS.md']` recommendation works ONLY for CLAUDE-only projects. Gap 2 (or a new gap) must propose an alternative path for mixed-files CLAUDE-first.
- [ ] Gap 3 lines 117 + 122 (the two "Need to spike codex acceptance of data URLs first" / "Pre-flight: spike whether codex-core accepts data: URLs" lines) are updated to either remove the spike-callout or replace with a link to §1.
- [ ] Gap 5 lines 165-179 (the `compactPrompt` plumbing discussion + ralph-command sketch) are updated to reflect Q3's finding. If happy-cli's top-level shape is wrong, the Gap 5 entry explicitly calls out fixing BOTH `packages/happy-cli/src/codex/codexAppServerTypes.ts:29` AND `packages/happy-cli/src/codex/codexAppServerClient.ts:1137`.
- [ ] `git diff` shows NO production-code changes — only `plans/codex-agent-parity-audit.md` modified and `tasks/spikes/codex-wire-spike.mjs` created.
- [ ] `.gitignore` decision documented: either `tasks/` is added (and `tasks/spikes/codex-wire-spike.mjs` is force-added with `git add -f`) or left alone (and `tasks/spikes/codex-wire-spike.mjs` is committed directly). PR description states which.
- [ ] Typecheck passes (no source code changed; this is a no-op for typecheck).

## Functional Requirements

- FR-1: Spike script lives at `tasks/spikes/codex-wire-spike.mjs` (Node.js ESM, single file, no new deps — built-ins only).
- FR-2: Script spawns `codex app-server` (stdio transport) with auth-preserving isolated `CODEX_HOME` (copies `auth.json` only, leaves `config.toml` empty).
- FR-3: Script issues `initialize` with `capabilities: { experimentalApi: true }` + `notify('initialized')` before any `thread/start`.
- FR-4: Script runs three Q2 probes (3a, 3b, 3c) using `ThreadStartResponse.instruction_sources` as the oracle — auth-free.
- FR-5: Script runs Q1 (image data: URL + localImage) using a discriminating canary PNG; captures `item/agentMessage/delta`/`item/completed`/`error`/`turn/completed` notifications.
- FR-6: Script runs Q3 (top-level `compactPrompt` vs nested `config.compact_prompt`) using `thread/compact/start` event capture as the oracle when auth is available; falls back to a static-source verdict when not.
- FR-7: Every RPC and event-wait is bounded by a timeout (10 s / 30 s / 60 s) so the script exits cleanly even when codex-app-server hangs.
- FR-8: Script captures `codex --version` for audit-doc header annotation.
- FR-9: Script issues a startup `config/read { include_layers: true }` taint check and surfaces a managed-config layer warning if one is present.
- FR-10: Findings are appended to `plans/codex-agent-parity-audit.md` as a new `## Wire spike results` section with three subsections (§1 image, §2 fallback, §3 compactPrompt); request payloads, responses, and notification excerpts are inlined as fenced ```json blocks (no separate `*-output.json` artifact).
- FR-11: Cross-references from existing Gap 2/3/5 callouts (audit-doc lines 95-101, 117, 122, 165-179, 351-356) are updated to point at the new section.
- FR-12: `git diff` after the spike lands shows NO files modified under `packages/` or `codex/`.

## Non-Goals (Out of Scope)

- Modifying `packages/happy-cli/src/codex/codexAppServerTypes.ts` or `codexAppServerClient.ts` (those changes belong to the Gap 2/3/5 fix-PRs this spike unblocks).
- Modifying the `codex/` submodule.
- Running the spike in CI (it requires logged-in codex auth + network).
- Implementing any Gap 2/3/5 fix.
- Spiking `/clear` semantics (the other half of Gap 5).
- Investigating any Gap other than 2, 3, 5.
- Adding a `package.json` lockfile change or any new runtime dep.

## Technical Considerations

- **Codex version drift:** installed `codex --version` is `0.125.0-copilot-api.8`; happy-cli's TS wire schema is cherry-picked from `0.107.0`. The spike must capture the runtime version so future maintainers can detect when a re-spike is warranted.
- **Managed-config layer not isolatable on release binary:** `CODEX_APP_SERVER_MANAGED_CONFIG_PATH` and `CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG` are `#[cfg(debug_assertions)]`-gated (`app-server/src/main.rs:42-57,83-104`). Detect via startup `config/read { include_layers: true }`; warn if present.
- **AGENTS.md hardcoded prefix:** `agents_md.rs:285-319` prepends `AGENTS.override.md` + `AGENTS.md` BEFORE the configured fallback list and per-directory breaks at first match. No `project_doc_fallback_filenames` value can make CLAUDE.md beat same-directory AGENTS.md — Q2 must empirically demonstrate this so the audit's `['CLAUDE.md', 'AGENTS.md']` recommendation can be corrected to "CLAUDE-only projects only".
- **`compact_prompt` oracle constraints:** `config/read` is NOT thread-scoped (no `threadId` param); rollout-file grep is invalid (`compact_prompt` is held only in runtime `core/src/session/turn_context.rs:77`, never persisted to `SessionMeta` or `TurnContextItem`). The only confirmed valid oracle is `thread/compact/start` event-stream capture, which requires working auth. If auth is unavailable, record the static-source verdict ("`ThreadStartParams` lacks the field; serde does not deny_unknown_fields; top-level silently dropped").
- **Auth preservation:** Copy `auth.json` only from the operator's real `CODEX_HOME` (env var first, else `~/.codex/`) into the spike's tmpdir; fall back to `OPENAI_API_KEY` passthrough if `auth.json` is missing.

## Success Metrics

- All three audit-doc subsections (§1, §2, §3) populated with payload-cited verdicts.
- Gap 2/3/5 open-question callouts in `plans/codex-agent-parity-audit.md` replaced with cross-references to the new section.
- `git diff` shows ZERO production-code changes (only `plans/codex-agent-parity-audit.md` modified and `tasks/spikes/codex-wire-spike.mjs` created).
- Spike script re-runnable: `node tasks/spikes/codex-wire-spike.mjs` reproduces the findings (modulo codex-version drift) without arguments or env setup beyond `codex` on PATH + configured auth.

## Open Questions

- If Q3 confirms top-level `compactPrompt` is silently dropped, should the Gap 5 ralph command also regenerate the TS wire shape from `codex app-server generate-ts` against `0.125.0` (vs hand-editing with a divergence comment)? Defer to Gap 5 scoping.
- Stdio vs ws transport: stdio is preferred for simplicity (no auth-token / port). If `codex app-server --listen stdio://` is unsupported in the installed version, fall back to ws on an ephemeral loopback port. Both yield identical wire-level findings.
