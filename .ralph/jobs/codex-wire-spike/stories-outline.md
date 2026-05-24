# Stories Outline: Codex Wire-Acceptance Spike

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Build spike harness and run Q2 (project_doc_fallback_filenames)

**Description:** As an audit-doc maintainer, I want a JSON-RPC spike harness against a real `codex app-server` that resolves Q2 (config knob `project_doc_fallback_filenames`) using the auth-free `ThreadStartResponse.instruction_sources` oracle, so that downstream Q1/Q3 probes can build on a derisked harness foundation.

**Acceptance Criteria:**
- [ ] `tasks/spikes/codex-wire-spike.mjs` exists; spawns `codex app-server` as a child process via `child_process.spawn` with auth-preserving isolated `CODEX_HOME=<fresh-tmpdir>/codex-home`: harness copies `auth.json` from the operator's real `CODEX_HOME` (env var first, else `~/.codex/`) into the tmpdir, leaves `config.toml` empty, falls back to `OPENAI_API_KEY` env passthrough if no auth.json. Harness also issues a startup `config/read { include_layers: true }` taint check and warns if a managed-config layer overrides `project_doc_fallback_filenames` or `compact_prompt` (managed-config is not isolatable on release `codex` binary per `app-server/src/main.rs:42-57,83-104` debug-only guards).
- [ ] Harness sends `initialize` with `capabilities: { experimentalApi: true }` and `notify('initialized')` before any `thread/start` (matches happy-cli's handshake at `codexAppServerClient.ts`).
- [ ] All three Q2 probes (3a CLAUDE-only with config knob, 3b CLAUDE-only without knob, 3c BOTH files present with `['CLAUDE.md','AGENTS.md']` knob) execute end-to-end and capture each `ThreadStartResponse.instruction_sources` array.
- [ ] Captured findings are written to an in-memory or scratch-file structure ready to be inlined into the audit doc in US-003.
- [ ] All RPC calls bounded by a 10-second timeout; script exits cleanly even when an RPC hangs (no `codex app-server` orphan after exit).
- [ ] `codex --version` output captured at spike runtime (for audit-doc header in US-003).
- [ ] Typecheck passes (script is `.mjs` so this means it parses and runs; no TypeScript involved).

**Dependencies:** None
**Estimated complexity:** small (~150 lines of Node, ~20 min)

## US-002: Q1 (image input shape) and Q3 (compactPrompt placement)

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

**Dependencies:** US-001
**Estimated complexity:** medium (~100 additional lines + canary-PNG asset; depends on US-001's harness)

## US-003: Append "Wire spike results" to plans/codex-agent-parity-audit.md

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

**Dependencies:** US-001, US-002
**Estimated complexity:** small (~30 min — copying captured payloads into markdown + cross-reference updates)
