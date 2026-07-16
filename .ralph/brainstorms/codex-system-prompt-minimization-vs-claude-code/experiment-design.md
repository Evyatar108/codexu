# Controlled experiment and decision gates

This document specifies the experiment that may follow Phase-0
instrumentation. It is a design only. **No behavioral ablation or outbound
capture has run, and no causal claim is made.**

## 1. Sequence

1. **Phase 0 — instrument and characterize.** Capture metadata-only prompt
   layer HMACs, explicit model/catalog provenance, controlled versus
   expected-variant context inventories, logical Responses JSON, the final
   HTTP prepared application entity, and the final WebSocket application
   payload.
2. **Pilot — estimate variance.** Exercise the trace and grader rubric on
   non-held-out tasks. Do not use pilot outcomes for product conclusions.
3. **Preregister.** Freeze task strata, held-out suite, randomization,
   repetitions, graders, exclusion rules, metrics, non-inferiority margins,
   and power-based sample size.
4. **Run two separate 2^3 blocks.** Never pool fork fallback and upstream
   bundled Sol before block-specific analysis.
5. **Decide.** A safe compact profile requires all gates below. A default
   change is a later, separate decision.

## 2. Source blocks

### B-FORK-FALLBACK

- Wrapper: `3ff55692e7045e85ce78ebe8337ab40b55494c9c`
- Patched source: `587a6a8ab8948ff912b1f24a62833b277934302d`
- Requested model: `gpt-5.6-sol`
- Expected provenance: unknown Copilot slug synthesized from generic
  `models-manager/prompt.md`, `model_messages` absent. The current
  `used_fallback_model_metadata` boolean is `false` for this synthesized row
  and therefore is not a provenance discriminator.

At this fork pin, the Copilot translator can only clone a locally bundled slug
or synthesize an unknown remote slug; remote metadata cannot make Sol locally
bundled. If a trace/build reports bundled Sol under this block, invalidate the
run because the source/build pin is not the declared fork state.

### B-UPSTREAM-BUNDLED

- OpenAI Codex: exactly `800715d201651a2a07c2706dca10400109dae3d3`
- Requested model: `gpt-5.6-sol`
- Expected provenance: bundled model-specific Sol template.

`rust-v0.141.0` / `3fb81667...` is a historical upstream baseline with six
models and no Sol; it is not eligible for this bundled-Sol block. If a later
pin replaces `800715d2...`, repin the task and template hashes before running
the experiment. Never mix builds within a block.

## 3. Factorial cells

Full `2^3` factorial, eight cells per source block. Factors A and B use
block-specific directions because the generic fallback does not contain the
Sol UI-taste or anthropomorphic sections:

| Factor | B-FORK-FALLBACK levels | B-UPSTREAM-BUNDLED levels |
|---|---|---|
| A — fixed global UI taste | Absent, matching fallback baseline / add a hash-pinned matched global UI-taste section as a positive-control transplant | Present, matching Sol baseline / remove from base and expose equivalent guidance only through a conditional frontend/artifact-design skill on eligible tasks |
| B — anthropomorphic prose | Absent, matching fallback baseline / add a hash-pinned matched anthropomorphic section as a positive-control transplant | Present, matching Sol baseline / rewrite to neutral task-oriented collaboration language |
| C — behavioral prose density | Full generic fallback behavior / compact section-preserving generic behavior | Full Sol behavior / compact section-preserving Sol behavior |

The treatment text must be fixed and hash-pinned before the held-out run.
Treatments may touch only approved behavioral sections. Safety, tools, dynamic
context, provider mapping, personality machinery, and launcher rails are never
factors. Skill/plugin/extension machinery and every pre-existing capability
also remain fixed. Factor A has one explicit exception: a hash-pinned candidate
frontend-guidance skill and its task-eligibility activation are part of the
treatment manifest. No other skill content, inventory, or activation may
differ. Effects are interpreted within a source block. The positive-control
additions in the fallback block are not called “minimization,” and their
direction must not be pooled with the removal direction in the bundled block.

## 4. Frozen state manifest

Every run has a machine-validated manifest with two field classes:

1. **Controlled-stable semantic fields** must match within a block/cell.
2. **Expected-variant envelope fields** change in fresh sessions and are
   recorded only as typed markers plus HMAC-derived opaque values.

The manifest contains:

- binary/source commit and build identity;
- provider, endpoint class, exact model slug, service tier, and reasoning
  settings;
- catalog provenance (`bundled`, `copilot_synthesized`, or
  `generic_local_fallback`) and `comp_hash`;
- effective instruction source (`config_base_override`,
  `resumed_session_history`, or `resolved_model`) as a separate axis;
- prompt-profile and exact treatment-section hashes;
- Factor A candidate frontend-skill content hash, eligibility classification,
  and activation boolean;
- declared cache mode and previous-response state;
- context item sequence and role-shape hash;
- tool names, definitions, output schemas, and parallel-call metadata hash;
- permissions, sandbox, approval, collaboration, and plan-mode state hash;
- skills, plugins, extensions, repository/user instruction inventory, and
  environment truth hashes, with the Factor A candidate skill separated from
  the frozen pre-existing inventory;
- launcher/additional safety rail hash;
- final top-level instructions HMAC;
- logical serialized Responses JSON HMAC;
- for HTTP, the final prepared application-entity HMAC after compression and
  auth mutation, immediately before `transport.stream`;
- for WebSocket, the final serialized `Message::Text` application-payload
  HMAC immediately before send;
- a typed canonical experiment-projection HMAC that replaces only an explicit
  allowlist of volatile values with type markers.

Expected-variant fields include session/thread/turn/window identifiers,
traceparent/tracestate, request nonces, prompt-cache keys derived from fresh
thread ids, and timestamps. They do not need to equal across runs. Never emit
their raw values: correlate events with a random `runCorrelationId` and
HMAC-derived opaque event ids.

Reject a run if any controlled non-factor field or canonical projection differs
from its block/cell manifest. The full application-payload HMAC normally differs
across fresh sessions and is an integrity receipt for that run, not a
cross-run equality key. The only allowed dynamic-capability difference is the
declared Factor A candidate skill content/eligibility/activation. Do not
“adjust” contaminated runs statistically.

## 5. Privacy and trace handling

- Trace only metadata, byte counts, enums, booleans, typed markers, and HMACs.
- Use an explicit experiment key shared within one block. Keep the key outside
  the trace file.
- Never record raw prompt text, user messages, repository content, tool
  arguments, authorization material, headers, or query-bearing URLs.
- Write to an explicit local path. Default is off.
- Raw WebSocket frames, HTTP framing, TCP segments, and TLS records are out of
  scope. Per-message deflate and transport framing may be nondeterministic; the
  stable boundary is the serialized WebSocket application text.
- A trace failure must not block or alter the baseline request. It marks the
  run invalid.
- Test transport bytes are allowed only in synthetic fixtures with canary
  content; production/user payload bytes are never persisted.

## 6. Task suite

Stratify held-out tasks before randomization:

1. non-UI implementation;
2. debugging and root-cause analysis;
3. repository navigation and targeted refactor;
4. plan-only / no-mutation work;
5. frontend implementation and visual verification;
6. permission/safety-sensitive operations.

Tasks used to write treatment text, fixtures, or grader rubrics are excluded
from the held-out suite. Use a pilot to estimate task-level variance, then
calculate the main sample size. Do not choose sample size after viewing
held-out results.

## 7. Randomization and repetitions

- Start a fresh session for every task × cell × repetition. Fresh identifiers
  are expected variants, not frozen-state failures.
- Randomize cell order within each task and block.
- Balance order so no cell consistently benefits from warm caches, time of
  day, or grader order.
- Use at least two independent repetitions per task/cell in the pilot; the
  power calculation sets the main-run repetitions.
- Treat the task, not an individual repeated session, as the experimental
  unit. Repetitions are nested observations within task × cell.
- Run source blocks separately. Do not interleave binaries inside one block.
- Record failures and exclusions before unblinding.

## 8. Blinded evaluation

Graders receive task input, allowed repository state, final patch/result,
commands/tests, and normalized transcript evidence needed for scoring. They do
not receive:

- factor cell;
- source block;
- prompt text or length;
- hypothesis direction;
- token/latency measurements before quality scoring.

Use at least two independent graders for subjective dimensions and adjudicate
disagreements using a preregistered rule.

## 9. Metrics

Primary:

- task acceptance / tests pass;
- correctness and completeness;
- invalid tool calls and recovery failures;
- permission, safety, or plan-mode violations;
- regression severity.

Conditional primary for frontend stratum:

- functional browser verification;
- adherence to repository design system;
- visual hierarchy, accessibility, and non-template quality.

Secondary:

- input instruction tokens and total input tokens;
- wall latency and time to first useful action;
- number of turns and tool calls;
- unnecessary narration/repetition;
- user/maintainer preference when available.

Report effect sizes and confidence intervals, including A×B, A×C, B×C, and
A×B×C interactions. Analyze each source block before considering any pooled
model. Preregister one of:

- a mixed-effects model with fixed A/B/C effects and interactions plus task
  blocking/random effects and repetitions nested within task × cell; or
- task-cell aggregation followed by a task-blocked factorial analysis.

Preregister the primary-outcome hierarchy and multiplicity handling. For
example, gate secondary outcomes behind primary non-inferiority and apply Holm
adjustment within each interaction family. Power on the task-level analysis,
not the raw session count.

## 10. Gates

### Instrumentation gate

Pass only if:

- disabled tracing is request-byte identical to baseline;
- for identical synthetic inputs, enabled tracing is byte-identical to
  disabled tracing at logical Responses JSON, final HTTP prepared entity, and
  final WebSocket application-text boundaries;
- HTTP prepared-entity HMAC matches independently observed synthetic transport
  bytes after compression/auth;
- WebSocket application-payload HMAC matches the exact synthetic
  `Message::Text` string;
- bundled and synthesized provenance fixtures are correct;
- privacy canary finds no raw sensitive content;
- selected HTTP/WebSocket path is fully covered or explicitly unsupported;
- controlled semantic repetitions produce stable non-factor and canonical
  projection hashes while expected-variant identifiers remain opaque.

### Compact-profile gate

Pass only if:

- no safety, permission, plan-mode, tool-schema, or runtime-contract
  regression occurs;
- correctness is inside preregistered non-inferiority margins;
- frontend conditional-skill treatment is non-inferior on frontend primary
  metrics;
- the candidate shows a material preregistered token, latency, or quality
  benefit;
- results hold for each model/catalog allowlist claimed by the profile;
- the proposed typed seam defaults to baseline and fails closed to unchanged
  baseline on all drift/anchor errors.

If a cell wins only in one source block, scope the future allowlist to that
exact model/catalog/template hash. Do not generalize.

### Default-change gate

Even after a compact profile passes:

1. ship it default-off;
2. dogfood through the real launcher/provider path;
3. retain one-step rollback to baseline;
4. observe at least one opt-in release without Medium+ regressions;
5. obtain a separate explicit decision per model/provider allowlist.

## 11. Fail-safe interpretation

- Unstable trace -> stop at Phase 0.
- No material benefit -> keep baseline.
- Mixed quality/safety result -> keep baseline and investigate the interaction.
- Drift between source and live catalog -> repin and rerun; never loosen
  allowlists.
- Claude static-extraction differences -> descriptive comparison only, never a
  causal explanation for Codex behavior.

## Exact plan-phase seed

```text
Plan only Phase 0 for task codex-system-prompt-minimization-vs-claude-code from .ralph/brainstorms/codex-system-prompt-minimization-vs-claude-code/brainstorm.json. Target an opt-in, metadata-only diagnostic that records post-model-resolution instruction-layer HMACs; a catalogProvenance enum such as bundled, copilot-synthesized, or local generic fallback; a separate effectiveInstructionSource enum that distinguishes config base override, resumed-session history, and resolved model instructions; and configured-versus-effective personality state. For HTTP, HMAC both logical serialized JSON and the final prepared application entity after compression/auth immediately before transport.stream; for WebSocket, HMAC the final serialized Message::Text application payload immediately before send. Do not claim visibility into WebSocket frames, TCP, TLS, or other raw wire bytes. Join events only with a random runCorrelationId and HMAC-derived opaque correlations; never emit raw session/thread/turn/window/trace/request ids. Record both the full per-run application-payload HMAC and a typed canonical experiment-projection HMAC that normalizes only an explicit allowlist of expected-variant identifiers/timestamps, so fresh sessions do not fail frozen-state checks. Preserve request bytes and every immutable runtime layer: tools/parallel metadata, permissions, collaboration and plan no-mutation, skills/plugins/extensions, repository/user instructions, environment truth, provider role mapping, personality machinery, and launcher safety rails. Prefer a fork overlay diagnostics crate/module with the smallest typed seams in upstream-owned model resolution, session instruction-source selection, core/client, endpoint/session, and WebSocket send code. Require default-off behavior, user-selected local output, no raw prompt/request/user/tool/secret content, a privacy canary, bundled-vs-synthesized catalog fixtures that prove used_fallback_model_metadata is not provenance, config/history/model effective-instruction-source fixtures, transport-appropriate capture tests, deterministic controlled-state drift checks, and byte-identical logical JSON/HTTP entity/WebSocket text with tracing enabled versus disabled for identical synthetic inputs. Do not edit prompt text, model catalogs, personality wording, defaults, or implement compact transforms. Treat the typed allowlisted post-resolution transform seam, UI-guidance move, anthropomorphism ablation, block-specific factorial experiment, and any default change as gated follow-up tasks. Produce plan.md, stories-outline.md, exact file/ownership conflict surface, tests, rollback, and acceptance mapping; stop after the plan phase.
```
