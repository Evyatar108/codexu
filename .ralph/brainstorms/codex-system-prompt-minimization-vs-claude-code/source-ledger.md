# Source ledger

Task: `codex-system-prompt-minimization-vs-claude-code`
Research cutoff: 2026-07-16
Purpose: source-pinned factual support for the brainstorm. This is not a record
of a behavioral experiment.

## Provenance rules

Three evidence classes are intentionally separate:

1. **Fork-current source**: the exact gitlink chain checked by codexu.
2. **Fork-live-unverified**: only the installed binary identity was observed.
   No outbound request was captured, so its effective catalog and prompt are
   unknown.
3. **Upstream-current source**: tagged/current OpenAI Codex sources. These do
   not describe the older checked fork catalog unless a trace proves the live
   fork consumed equivalent remote metadata.

## Pin chain

| Layer | Pin | Verification |
|---|---|---|
| codexu | `f575ff28` | `git ls-tree f575ff28 codex` -> wrapper gitlink `3ff55692...` |
| fork wrapper | `3ff55692e7045e85ce78ebe8337ab40b55494c9c` | `git ls-tree 3ff55692 external/repos/codex-patched` -> patched gitlink `587a6a8...` |
| fork patched source | `587a6a8ab8948ff912b1f24a62833b277934302d` | local nested checkout and pinned GitHub blobs |
| upstream release | tag `rust-v0.141.0`, commit `3fb81667d30d9d24297216ea61fbfcc4351b2aa9` | Git tag resolution plus raw pinned files |
| upstream current inspected | `800715d201651a2a07c2706dca10400109dae3d3` | raw pinned files |
| Claude official | `c39cb0f14bfe8bb519bae5bfc55add6867c5e2ab` | official repository README |
| Piebald extraction | `e812fce2f9791aa6f051deda9838dbcb397381b2` | README plus pinned tree |
| tweakcc method | `f4e0b9402d482703eb967c7cc26b8f2a66e49e55` | extractor and patcher source |

## Fork-current findings

### Catalog and unknown Copilot model synthesis

- The patched catalog at `587a6a8...` has six slugs:
  `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2`,
  and `codex-auto-review`. It has no `gpt-5.6-sol`.
- [`models-manager/src/model_info.rs` lines 78-150](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/models-manager/src/model_info.rs#L78-L150)
  synthesizes a fallback `ModelInfo` from `prompt.md`; only named local
  personality fixtures get local `model_messages`.
- [`model-provider/src/copilot_models_endpoint.rs` lines 402-445](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/model-provider/src/copilot_models_endpoint.rs#L402-L445)
  preserves a bundled entry when the slug is known.
- [`model-provider/src/copilot_models_endpoint.rs` lines 447-550](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/model-provider/src/copilot_models_endpoint.rs#L447-L550)
  synthesizes an unknown Copilot slug with generic `BASE_INSTRUCTIONS` and
  `model_messages: None`.

The synthesized Copilot row sets `used_fallback_model_metadata: false`, just
as the bundled-clone path does. That existing boolean is not sufficient to
distinguish catalog provenance; Phase 0 needs an explicit
`catalogProvenance` enum.

Pinned catalog identity, computed over the raw Git blob bytes (not the
CRLF-converted worktree file):

- Git blob OID: `213fdcf6c42fe180e52ecf4a62fd1d94becfda44`
- SHA-256: `b21200fd39c430f750cf10030c13bb19a91fdbc07792abdbda09e0ce6479161a`

### Generic fallback versus GPT-5.5

- [`models-manager/prompt.md`](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/models-manager/prompt.md)
  tells the model to be concise, direct, and friendly.
- The checked `gpt-5.5` model-specific catalog text contains a detailed
  frontend/aesthetic checklist and richer Friendly personality overlay that
  are absent from the generic fallback.

Pinned generic-prompt identity, computed over the raw Git blob bytes:

- Git blob OID: `4886c7ef4455f27cb4201bdfcc988ed28f6e2252`
- SHA-256: `0fae66723e9ba38083bd5a26f83f5c6c944954daaea3436084ab75eb8fdf46c8`

### Personality and override semantics

- [`core/src/config/mod.rs` lines 3406-3412](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/core/src/config/mod.rs#L3406-L3412)
  resolves an unspecified personality to `Pragmatic` when personality is
  enabled.
- [`models-manager/src/model_info.rs` lines 69-74](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/models-manager/src/model_info.rs#L69-L74)
  applies `base_instructions` by replacing the base and clearing instruction
  messages entirely.
- [`core/src/session/mod.rs` lines 580-617](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/core/src/session/mod.rs#L580-L617)
  selects effective base instructions in priority order: config override,
  resumed-session history, then resolved model instructions. Phase 0 therefore
  needs a separate `effectiveInstructionSource` field; catalog provenance
  alone cannot describe the prompt source.
- [`core/src/session/mod.rs` lines 1231-1240](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/core/src/session/mod.rs#L1231-L1240)
  appends `additional_instructions` to the already resolved base prompt.

Conclusion: whole-base replacement and appended counter-instructions are not
safe section-minimization seams.

### Runtime layers that are outside the ablation surface

- [`core/src/client.rs` lines 807-831](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/core/src/client.rs#L807-L831)
  builds the typed `ResponsesApiRequest` from instructions, input, tools,
  parallel-tool metadata, reasoning, text controls, and provider capabilities.
- [`codex-api/src/common.rs` lines 182-239](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/codex-api/src/common.rs#L182-L239)
  defines the typed Responses payload and its WebSocket request conversion,
  including model, instructions, roles/input items, tools, parallel metadata,
  reasoning, cache key, and client metadata.
- [`core/src/agents_md.rs` lines 1-15](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/core/src/agents_md.rs#L1-L15)
  documents hierarchical repository instruction discovery.
- [`core/src/agents_md.rs` lines 43-81](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/core/src/agents_md.rs#L43-L81)
  combines host-provided user instructions with per-environment project
  instructions while retaining provenance.
- [`codex-copilot-launcher/src/safety_rails.rs` line 17](https://github.com/evmitran_microsoft/codexu-codex/blob/3ff55692e7045e85ce78ebe8337ab40b55494c9c/codex-rs-overlay/codex-copilot-launcher/src/safety_rails.rs#L17)
  supplies fork launcher safety rails that must remain unchanged.

### Transport-appropriate outbound application boundaries

- [`codex-api/src/endpoint/responses.rs` lines 71-99](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/codex-api/src/endpoint/responses.rs#L71-L99)
  serializes the logical typed HTTP request into `EncodedJsonBody`.
- [`codex-client/src/request.rs` lines 113-237](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/codex-client/src/request.rs#L113-L237)
  prepares the final HTTP application entity, including optional zstd request
  compression and content headers.
- [`codex-api/src/endpoint/session.rs` lines 122-149](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/codex-api/src/endpoint/session.rs#L122-L149)
  prepares once, applies auth, and then hands the request to
  `transport.stream`. Because auth may replace the request, the HTTP
  prepared-entity observation belongs after `apply_auth` and immediately
  before `transport.stream`.
- [`codex-api/src/endpoint/responses_websocket.rs` lines 757-792](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/codex-api/src/endpoint/responses_websocket.rs#L757-L792)
  serializes and hands a `Message::Text` application payload to the WebSocket
  stack.
- [`responses_websocket.rs` lines 507-513](https://github.com/evmitran_microsoft/codexu-codex-patched/blob/587a6a8ab8948ff912b1f24a62833b277934302d/codex-rs/codex-api/src/endpoint/responses_websocket.rs#L507-L513)
  enables per-message deflate, so compressed WebSocket frames are not
  equivalent to the serialized application text.

Phase 0 must name the boundaries precisely:

- logical Responses JSON;
- HTTP final prepared application entity after compression/auth;
- WebSocket final serialized application text before framing/compression.

Raw HTTP framing, WebSocket frames, TCP segments, and TLS records are out of
scope. Instrumentation must not add provider payload fields or alter any bytes.

## Fork-live-unverified observation

Observed locally:

```text
path=C:\.tools\.npm-global\codex.ps1
codex-cli 0.141.0-copilot-api.3
```

No session was run with request capture. The live binary's effective remote
catalog, cache, resolved instructions, transport, and outbound bytes remain
unknown. This is the primary reason Phase 0 is required.

## Upstream findings

[`rust-v0.141.0`](https://github.com/openai/codex/tree/3fb81667d30d9d24297216ea61fbfcc4351b2aa9)
has a six-model bundled catalog and no `gpt-5.6-sol`. The later inspected
commit
[`800715d2`](https://github.com/openai/codex/tree/800715d201651a2a07c2706dca10400109dae3d3)
has an eight-model catalog including `gpt-5.6-sol`.

The `800715d2` Sol entry has the following hashes, computed over the UTF-8
`JSON.stringify` serialization of the parsed entry (preserving file property
order) and over the UTF-8 instruction-template string, respectively:

- Catalog-entry SHA-256:
  `03859b2face3a8f5dc7534312509bf2c8937fc5c8ebf347a2ad9a9ac509fd27a`
- Instruction-template SHA-256:
  `e9778714d505f3dd04d44db4394024c5fab5bf6554fc9faa3cdf9cf776b63bb9`
- Empty `personality_default`, `personality_friendly`, and
  `personality_pragmatic` variables.
- No `{{ personality }}` placeholder in the template.
- Main-template wording that asserts tastes/preferences and another
  subjectivity.

Relevant source:

- [`models-manager/models.json` at rust-v0.141.0](https://github.com/openai/codex/blob/3fb81667d30d9d24297216ea61fbfcc4351b2aa9/codex-rs/models-manager/models.json#L4-L74)
- [`models-manager/models.json` at 800715d2](https://github.com/openai/codex/blob/800715d201651a2a07c2706dca10400109dae3d3/codex-rs/models-manager/models.json#L4-L74)

The hashes above apply only to the `800715d2` Sol entry/template. There is no
Sol entry to compare at `rust-v0.141.0`. This is upstream evidence only.

## Claude Code findings and limits

### Official repository limitation

The official
[`anthropics/claude-code` README at c39cb0f`](https://github.com/anthropics/claude-code/blob/c39cb0f14bfe8bb519bae5bfc55add6867c5e2ab/README.md)
contains installation, documentation, and plugin information, but not the
complete proprietary runtime prompt-construction implementation. Therefore
static third-party extraction can support catalog claims, not a fully verified
per-turn inclusion/order claim.

### Piebald catalog

The pinned
[`Piebald-AI/claude-code-system-prompts` README](https://github.com/Piebald-AI/claude-code-system-prompts/blob/e812fce2f9791aa6f051deda9838dbcb397381b2/README.md#L35-L65)
states:

- headline expansion from 350 to **515** prompts;
- Claude Code does not have one system-prompt string;
- large portions are conditionally included;
- tool, agent, and utility prompts are separate.

At the same pin, the indexed `system-prompts/*.md` tree contains **584** files:

| Prefix | Count |
|---|---:|
| `system-*` | 212 |
| `tool-*` | 148 |
| `data-*` | 88 |
| `skill-*` | 73 |
| `agent-*` | 63 |
| **Total** | **584** |

This internal count drift does not change the key correction: neither 515 nor
584 is the number of fragments included in every turn.

### Extraction and patching method

- [`tweakcc` README lines 160-163](https://github.com/Piebald-AI/tweakcc/blob/f4e0b9402d482703eb967c7cc26b8f2a66e49e55/README.md#L160-L163)
  says it patches Claude Code's minified compiled `cli.js`.
- [`README` lines 620-633](https://github.com/Piebald-AI/tweakcc/blob/f4e0b9402d482703eb967c7cc26b8f2a66e49e55/README.md#L620-L633)
  describes dynamic composition from smaller strings.
- [`promptExtractor.js` lines 101-140](https://github.com/Piebald-AI/tweakcc/blob/f4e0b9402d482703eb967c7cc26b8f2a66e49e55/tools/promptExtractor.js#L101-L140)
  parses compiled code and extracts string and template literals.
- [`systemPrompts.ts` lines 92-133](https://github.com/Piebald-AI/tweakcc/blob/f4e0b9402d482703eb967c7cc26b8f2a66e49e55/src/patches/systemPrompts.ts#L92-L133)
  loads prompt-specific regexes and matches them against compiled content.

Exact file paths may move between tweakcc releases; the commit pin is
authoritative.

### Conditional frontend guidance

- [`system-prompt-frontend-browser-verification.md`](https://github.com/Piebald-AI/claude-code-system-prompts/blob/e812fce2f9791aa6f051deda9838dbcb397381b2/system-prompts/system-prompt-frontend-browser-verification.md)
  begins “For UI or frontend changes,” making the browser-verification rule
  task-conditional.
- [`skill-artifact-design.md`](https://github.com/Piebald-AI/claude-code-system-prompts/blob/e812fce2f9791aa6f051deda9838dbcb397381b2/system-prompts/skill-artifact-design.md)
  contains detailed palette, typography, layout, theme, and anti-template
  aesthetics under an Artifact design skill.

This supports moving fixed UI taste to a conditional frontend/design skill,
not to generic AGENTS.md. AGENTS.md remains the home for repository-specific
design constraints.

### Anthropomorphism evidence-of-absence

A case-insensitive literal scan across all 584 pinned extracted markdown files
returned zero hits for:

- `vivid inner life`
- `another subjectivity`
- `tastes, preferences`
- `own way of seeing the world`
- `real presence rather than`
- `not a mirror`

This is evidence of absence for those phrases in the extracted catalog, not
proof that no analogous wording exists in proprietary runtime composition.

## What was not done

- No production prompt was edited.
- No live outbound request was captured.
- No prompt-profile implementation was written.
- No behavioral ablation or randomized experiment was run.
- No causal claim is made about prompt length, quality, latency, safety, or
  model capability.
