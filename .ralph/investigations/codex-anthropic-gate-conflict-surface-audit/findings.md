# Conflict-Surface Audit — `codex-anthropic-models-opt-in-gate` plan

**Date:** 2026-06-09
**Auditor:** `audit-gate-conflict` (read-only, validation-only — no impl, no plan edit)
**Plan audited:** `.ralph/jobs/codex-anthropic-models-opt-in-gate/plan.md` (+ `research-brief.md`)
**Operator goal:** minimize the codex fork's *upstream-canonical* conflict surface (what makes the next `/rebase-upstream` painful) before this codex-rs impl runs.
**Baseline for "upstream-canonical":** the upstream release the fork rebases onto, tag `rust-v0.135.0` (`f4a628f40`) in `external/repos/codex-patched`. A file/region present at that tag = upstream-canonical; absent = fork-added. The fork's `sandbox-patches` HEAD is `40accc502` (= the D-001 commit itself).

---

## TL;DR / VERDICT

**The plan is overlay-first and largely conflict-minimal, but it is NOT yet minimal — it opens net-new upstream-canonical surface that is fully avoidable.** Three concrete reductions take the net-new upstream-canonical conflict surface from **4 files / ~4 regions** down to **0 production lines + 0 new test files** (with one honest coverage tradeoff on the two integration tests).

Net-new upstream-canonical surface in the plan **as written**:

| File | Category | Net-new region | Already a D-001 patch region? | Reducible to 0? |
|---|---|---|---|---|
| `core/src/client.rs:1585` | C (upstream) | 1 line (arity change) | **YES** — inside the existing D-001 `// SANDBOX PATCH:` block | **YES** (resolve gate inside fork-exclusive `effective_wire_api`) |
| `model-provider/src/lib.rs` | C (upstream) | 1 `mod` line (decorator registration, *implied*) | NO (would be new) | **YES** (nest the module under fork-exclusive `copilot.rs`) |
| `core/src/tools/handlers/multi_agents_tests.rs` | C (upstream test) | new test fn(s), US-005 | **NO** — D-001 never touched this file | **YES** (decorator unit tests + structural overlay test) — *coverage tradeoff* |
| `tui/src/chatwidget/tests/popups_and_settings.rs` | C (upstream test) | new test fn, US-006 | **NO** — D-001 never touched this file | **YES** (decorator unit test + structural overlay test) — *coverage tradeoff* |

Everything else in the plan is category **A** (overlay, zero conflict) or **B** (fork-exclusive file in an upstream crate, no content-merge conflict). **MUST-ADOPT:** the two production reductions (client.rs untouched + decorator nested in copilot.rs) — they have **zero** coverage cost. **SHOULD-ADOPT:** moving US-005/US-006 integration tests out of the two upstream-canonical test files (coverage tradeoff noted below; the operator's stated priority is conflict-surface minimization, which favors moving them).

---

## 1. A/B/C classification of every file the plan creates/modifies

Legend:
- **(A) OVERLAY-exclusive** — lives under `codex/codex-rs-overlay/...` (fork-only crate in the *wrapper* repo). ZERO upstream-canonical conflict surface.
- **(B) FORK-EXCLUSIVE file in an upstream crate** — a `.rs` file that exists ONLY in the fork (absent at `rust-v0.135.0`), living inside an upstream crate dir under `codex-patched/codex-rs/<crate>/`. No content-merge conflict; the only conflict candidate is its **`mod` registration line** in an upstream-canonical parent.
- **(C) UPSTREAM-CANONICAL** — file present at `rust-v0.135.0`. Real conflict surface when edited.

> **Architecture note (the plan's paths are real, just two-layered):** there is no `codex-rs-overlay/` dir under `codex-patched/codex-rs/`. The overlay crates live in the **wrapper** repo at `D:/harness-efforts/codexu/codex/codex-rs-overlay/` (`codex-copilot/`, `codex-copilot-launcher/`, `codex-invariant-tests/`, `codex-stream-diagnostics/`). The patched codex tree is the separate inner git repo at `codex/external/repos/codex-patched/` (remotes: `origin=Evyatar108/codex-openai-fork`, `upstream=openai/codex`). Confirmed `codex/codex-rs-overlay/codex-copilot/src/` exists with `auth.rs, chat_completions.rs, header_source.rs, lib.rs, paths.rs, payload.rs`. This matches `codex/CLAUDE.md` tenet 1 ("New file under `codex-rs-overlay/` … zero conflict surface") and patch-surface.md §15 D-001 replant L1173-1175 ("keeps the bulk of its code in the fork-exclusive overlay crate `codex-rs-overlay/codex-copilot/` (zero upstream-canonical conflict surface)").

### Production files

| # | Plan file (op) | Actual location | Category | Conflict surface | Evidence |
|---|---|---|---|---|---|
| 1 | `codex-rs-overlay/codex-copilot/src/gate.rs` (CREATE) | wrapper `codex/codex-rs-overlay/codex-copilot/src/` | **A** | none | overlay crate dir confirmed present |
| 2 | `codex-rs-overlay/codex-copilot/src/lib.rs` (MODIFY) | same crate | **A** | none | `codex/codex-rs-overlay/codex-copilot/src/lib.rs` |
| 3 | `codex-rs-overlay/codex-copilot-launcher/src/config.rs` (MODIFY) | wrapper launcher crate | **A** | none | `codex/codex-rs-overlay/codex-copilot-launcher/` |
| 4 | `codex-rs-overlay/codex-copilot-launcher/src/main.rs` (MODIFY) | same | **A** | none | precedent `style_user_messages`→`CODEX_TUI_USER_MESSAGE_STYLE` (research-brief §5) |
| 5 | `model-provider/src/copilot_models_endpoint.rs` (MODIFY: gate filter + `wire_route_for`) | `codex-patched/codex-rs/model-provider/src/` | **B** | none (whole file fork-owned) | FORK-ADDED — absent at `rust-v0.135.0`; first added by `b9a8f454f fix(copilot): live-fetch /models` |
| 6 | `model-provider/src/copilot.rs` (MODIFY: wrap `models_manager` with decorator) | same | **B** | none (whole file fork-owned) | FORK-ADDED — absent at `rust-v0.135.0`; first added by `a45d5d741 feat(F-2): port Copilot auth` |
| 7 | `model-provider/src/gated_models_manager.rs` (CREATE) | same crate (new) | **B** (file) **+ C (1 line, IF registered in `lib.rs`)** | the **`mod` registration** is the only conflict candidate | `model-provider/src/lib.rs` IS upstream-canonical (present at baseline) — see Reduction R2 |
| 8 | `core/src/chat_transport.rs` (MODIFY: gate `effective_wire_api`) | `codex-patched/codex-rs/core/src/` | **B** | none (whole file fork-owned) | FORK-ADDED — absent at baseline; added by D-001 `40accc502` (312 lines, NEW) |
| 9 | `core/src/client.rs` (~:1585) (MODIFY: pass gate) | same | **C** | 1 line, **inside the existing D-001 SANDBOX PATCH block** | present at baseline; D-001 patched :1582-1585 with `// SANDBOX PATCH: D-001. Per-model routing…` — see §3 + Reduction R1 |

### Test files

| # | Plan test file (op) | Category | Conflict surface | Evidence |
|---|---|---|---|---|
| 10 | `model-provider/src/copilot_models_endpoint.rs` (`chat_transport_tests`) | **B** | none | colocated in the fork-added file (#5) |
| 11 | `core/src/chat_transport.rs` (`mod tests`) | **B** | none | colocated in the fork-added file (#8); existing test callsites at :286/:291/:296 |
| 12 | `core/src/tools/handlers/multi_agents_tests.rs` (US-005 v1+v2 spawn override) | **C** | **NEW upstream-canonical** — D-001 never touched this file | present at baseline; D-001 stat does NOT list it; the existing `spawn_agent_fork_context_rejects_*`/`multi_agent_v2_*` tests (:320/:354/:434/:475) are **upstream** tests of codex's conversation-*fork* concept (present at baseline), NOT fork additions; **0** `// SANDBOX PATCH:` markers in the file |
| 13 | `tui/src/chatwidget/tests/popups_and_settings.rs` (US-006 picker) | **C** | **NEW upstream-canonical** — D-001 never touched this file | present at baseline; `model_picker_hides_show_in_picker_false_models_from_cache` (:2337) is an **upstream** test (present at baseline); **0** `// SANDBOX PATCH:` markers |

### Docs

| # | Plan file | Category | Conflict surface |
|---|---|---|---|
| 14 | `codex/docs/implementation/patch-surface.md` (§14 + §15) | wrapper-owned doc (fork-exclusive) | none — it is THE fork's own patch ledger, never in upstream |

---

## 2. NET-NEW upstream-canonical conflict surface (beyond what D-001 already established)

D-001's upstream-canonical footprint (the baseline this plan extends), from the `40accc502` diff + commit message + patch-surface §14 inv 32-38 / §15 replant:
- `model-provider-info/src/lib.rs` — `WireApi::ChatCompletions` variant (inv 32)
- `config/src/thread_config/remote.rs` — `proto_wire_api` arm (§15 L1187-1189)
- `protocol/src/openai_models.rs` — `ModelWireRoute` enum + `wire_route` field + constructor fan-out (inv 33, §15 L1193-1196)
- `models-manager/src/model_info.rs` — wire_route literal fan-out (§15 L1196)
- `core/src/client.rs` — `effective_wire_api` callsite (:1582-1585) + the `WireApi::ChatCompletions` dispatch arm (:1621+) (inv 35) — **both `// SANDBOX PATCH: D-001`-marked**
- `core/src/lib.rs` — `mod chat_transport;` registration (`// SANDBOX PATCH: D-001 …`)

**This gate plan touches NONE of the D-001 enum/protocol seams.** Its only intersection with D-001 upstream-canonical surface is `core/src/client.rs:1585`, and it adds the following NET-NEW surface:

| Metric | As-written (no reductions) | With MUST-ADOPT reductions |
|---|---|---|
| Net-new upstream-canonical **files** touched | **4** (`client.rs`, `lib.rs`*, `multi_agents_tests.rs`, `popups_and_settings.rs`) | **0** |
| Net-new upstream-canonical **edit regions** | **~4** (1 in client.rs *inside existing D-001 block*; 1 `mod` line in lib.rs; ≥1 test region in each of the 2 test files) | **0** |
| Net-new upstream-canonical **lines (production)** | **~2** (client.rs arity +0/-1/+1; lib.rs `mod` +1) | **0** |
| Net-new upstream-canonical **test files** D-001 never owned | **2** (`multi_agents_tests.rs`, `popups_and_settings.rs`) | **0** (with coverage tradeoff) |
| Edits **inside an existing D-001 SANDBOX PATCH block** | `client.rs:1585` only | n/a |

\* `model-provider/src/lib.rs` is only touched if the new decorator module is registered there (the plan implies a top-level `model-provider/src/gated_models_manager.rs`, which needs a `mod` line somewhere). It is avoidable — see R2.

**Of the as-written net-new surface, only `client.rs:1585` is inside an existing D-001 patch region; the other three (`lib.rs` mod line, and the two test files) would be BRAND-NEW upstream-canonical conflict points that D-001 did not create.** The two test files are the single biggest avoidable contribution.

---

## 3. The `client.rs:1585` region — already a D-001 SANDBOX PATCH

D-001 (`40accc502`) patched `core/src/client.rs` with TWO marked regions (verbatim from `git show 40accc502 -- codex-rs/core/src/client.rs`):

```rust
// :1582-1585
let provider_wire = self.client.state.provider.info().wire_api;
// SANDBOX PATCH: D-001. Per-model routing: map the protocol-local route hint
// to the effective wire (the only place WireApi is derived from wire_route).
let wire_api = crate::chat_transport::effective_wire_api(model_info.wire_route, provider_wire);
```
```rust
// :1621+
// SANDBOX PATCH: D-001 chat-completions dispatch arm. …
WireApi::ChatCompletions => { … crate::chat_transport::stream_chat_completions(…) }
```

The plan's gate edit ("pass the resolved gate to `effective_wire_api`") modifies the line at :1585 — i.e. it **extends an existing D-001 patch region rather than opening a new one.** It does not increase the *region count* on client.rs (D-001 already owns this exact line as a conflict candidate). But it is still avoidable entirely (R1).

`effective_wire_api` callsites (full enumeration, ripgrep):
- `core/src/client.rs:1585` — **C**, production, inside the existing D-001 patch.
- `core/src/chat_transport.rs:55` — **B**, the `pub(crate) fn` definition (fork file).
- `core/src/chat_transport.rs:286/291/296` — **B**, the `mod tests` callsites (fork file).

So a signature change to `effective_wire_api` forces edits to: the def (B), the 3 test callsites (B), and the **one** production callsite client.rs:1585 (C). The single upstream-canonical touch is client.rs:1585.

---

## 4. Reduction proposals

### R1 — MUST-ADOPT: resolve the routing gate *inside* the fork-exclusive `effective_wire_api`; leave `client.rs:1585` byte-unchanged

`effective_wire_api` lives in `core/src/chat_transport.rs` (category **B**, fork-exclusive). Instead of widening its signature and threading the bool from the upstream-canonical `client.rs` callsite, keep the **2-arg public wrapper byte-identical to D-001** and add a 3-arg *inner* testable fn that the production wrapper feeds from the overlay helper:

```rust
// chat_transport.rs  (fork-exclusive — zero upstream surface)
pub(crate) fn effective_wire_api(route: ModelWireRoute, provider_wire: WireApi) -> WireApi {
    effective_wire_api_gated(route, provider_wire, codex_copilot::anthropic_models_enabled())
}
fn effective_wire_api_gated(route: ModelWireRoute, provider_wire: WireApi, anthropic_enabled: bool) -> WireApi { … }
```

- `client.rs:1585` keeps calling `effective_wire_api(model_info.wire_route, provider_wire)` — **unchanged from D-001** → the only upstream-canonical production edit drops to **0 lines**.
- The `mod tests` callsites (:286/:291/:296) call `effective_wire_api_gated(route, provider_wire, /*anthropic_enabled*/ false|true)` → **tests stay env-free** (honors `codex-patched/AGENTS.md` "avoid mutating process env in tests; pass environment-derived flags from above").
- Compatible with the plan's own AC #3/#6, which already assert the gate via a 3-arg `effective_wire_api(ChatCompletions, Responses, /*off*/)` form — that 3-arg form simply becomes the inner `effective_wire_api_gated`.
- Honors `codex-patched/AGENTS.md` `argument_comment_lint` (`/*anthropic_enabled*/` on the literal bool).

**Effect:** removes the plan's only upstream-canonical *production* edit. No coverage cost.

### R2 — MUST-ADOPT: register the `GatedModelsManager` module under fork-exclusive `copilot.rs`, never in `model-provider/src/lib.rs`

`model-provider/src/lib.rs` is **upstream-canonical** (present at `rust-v0.135.0`). It already carries a D-001-era Copilot `mod` block as a `// SANDBOX PATCH:` (lines 4-12):

```rust
// model-provider/src/lib.rs
mod amazon_bedrock;
mod auth;
mod bearer_auth_provider;
// SANDBOX PATCH: Copilot session routing lives in `copilot.rs` …
mod copilot;
mod copilot_models_endpoint;
```

A naive `mod gated_models_manager;` added at crate root (lib.rs) is a **net-new upstream-canonical line**. Avoid it: place the decorator at `model-provider/src/copilot/gated_models_manager.rs` and declare `mod gated_models_manager;` **inside the fork-exclusive `copilot.rs`** (a flat file today; the wrap point `models_manager()` is at `copilot.rs:109-137`, wrapping `StaticModelsManager::new(…)` :122 and `OpenAiModelsManager::new(…)` :137). The module then resolves under `copilot/` with **zero** edit to `lib.rs`.

- If even a child-`mod` line is undesirable, the decorator (a `SharedModelsManager`/`Arc<dyn …>` wrapper) is small and cohesive enough to live as a private item *inside* `copilot.rs` — still zero `lib.rs` touch. (Weigh against `codex-patched/AGENTS.md` "avoid growing files >500 LoC / prefer new modules"; the nested-file form satisfies both.)

**Effect:** removes the (implied) net-new `lib.rs` mod line. No coverage cost. **The plan should state this explicitly** so the implementer does not default to a crate-root registration.

### R3 — SHOULD-ADOPT: keep US-005/US-006 invariant proof in fork-exclusive files; do not edit the two upstream-canonical test files

`core/src/tools/handlers/multi_agents_tests.rs` and `tui/src/chatwidget/tests/popups_and_settings.rs` are **upstream-canonical** and were **NOT touched by D-001** (verified: neither appears in the `40accc502` stat; both, and the specific tests the plan extends, exist at `rust-v0.135.0`; both have 0 `// SANDBOX PATCH:` markers). Editing them opens **two brand-new upstream-canonical conflict files** that the fork does not currently own at all in this feature area.

The gate's sub-agent (US-005) and `/model` picker (US-006) behaviors are **transitive consequences of gate point 2** (the `GatedModelsManager` decorator filtering `list_models`/`try_list_models`): the picker reads `try_list_models`; the spawn-override path reads `list_models`/`available_models` (research-brief §3, §4). So the invariant is fully provable WITHOUT the upstream-canonical integration tests:

1. **Colocated decorator unit tests in the fork-exclusive `gated_models_manager.rs` (B):** assert every gated read method (`list_models`, `try_list_models`, `raw_model_catalog`, `get_remote_models`, `try_get_remote_models`) drops `wire_route==ChatCompletions` rows when off and keeps them when on (plan AC #4 already specifies these). This *is* the picker-hides-Claude and spawn-rejects-Claude proof at the seam both surfaces consume.
2. **Colocated routing unit test in fork-exclusive `chat_transport.rs` (B):** `effective_wire_api_gated(ChatCompletions, Responses, false) == Responses` (inherited/pinned-Claude fail-closed, AC #3/#6).
3. **Optional structural invariant in the fork-exclusive `codex-rs-overlay/codex-invariant-tests/` crate (A):** that crate is `include_str!`-based STRUCTURAL-only (its dev-deps are `codex-features/codex-protocol/serde_json/...`, NOT `codex-core`; e.g. `tests/plugin_scope_filtering.rs` greps source text), so it CANNOT drive a live spawn/TUI session — but it CAN assert the gate is wired at all four seams and that `client.rs:1585` stays unchanged. `codex/CLAUDE.md` ("Submodule Cadence" §) explicitly designates this crate for "D-001 invariant tests that should not widen upstream crate APIs."

**Honest tradeoff:** the upstream-canonical integration tests exercise the *real* wiring (a real session spawn in `multi_agents_tests.rs`; the real TUI catalog in `popups_and_settings.rs`) that decorator unit tests + structural text-asserts do not fully reproduce. Dropping them trades a layer of end-to-end coverage for zero net-new upstream-canonical conflict surface. Because the operator's **explicit** priority here is conflict-surface minimization, R3 leans toward moving them out; if the impl wants belt-and-suspenders e2e coverage, prefer adding it as a fork-exclusive `core/tests/suite/chat_completions.rs`-style test (patch-surface inv 37 already cites that file as a D-001-owned e2e home) over editing the two upstream-canonical test files.

### Non-reductions (already minimal — no action)

- Gate point 1 (filter + `wire_route_for` in `copilot_models_endpoint.rs`) and gate point 2 (decorator wrap in `copilot.rs`) are entirely in **B** files — zero upstream surface regardless of how the gate bool is read. ✔
- The launcher/env mechanism is entirely **A** (overlay). ✔ The plan correctly rejected a `ConfigToml`/`FeatureSet` field (would thread config through upstream-canonical models-manager/provider/client — much larger **C** surface; research-brief §7, plan "Technical Constraints").
- patch-surface.md edits (US-007) are wrapper-owned doc — no upstream surface. ✔ (US-007 should also correct inv 35's drifted test path: it cites `core/src/client_tests.rs::chat_hint_routes_to_chat_completions`, but the routing test actually lives in `core/src/chat_transport.rs` `mod tests` — research-brief / Copilot review already flagged this.)

---

## 5. Verdict (answer to the task's 4 questions)

1. **Classification:** done above — 8 production + 4 test + 1 doc entries. A (overlay) ×6, B (fork-exclusive in upstream crate) ×6, C (upstream-canonical) ×4 (`client.rs`, implied `lib.rs`, `multi_agents_tests.rs`, `popups_and_settings.rs`); doc ×1.
2. **Net-new upstream-canonical surface (as written):** ~**4 files / ~4 regions / ~2 production lines + 2 new test files**. Only `client.rs:1585` is inside an existing D-001 SANDBOX PATCH block; the `lib.rs` mod line and the two test-file edits would be brand-new upstream-canonical conflict points.
3. **Reductions:** R1 (gate inside `effective_wire_api` → client.rs unchanged), R2 (decorator mod under `copilot.rs` → lib.rs unchanged), R3 (US-005/US-006 proof in fork files + overlay → the two upstream-canonical test files untouched).
4. **VERDICT: NOT yet conflict-minimal — adopt R1 + R2 (MUST; zero coverage cost) and R3 (SHOULD; one coverage tradeoff).** With R1+R2+R3 the plan's net-new upstream-canonical conflict surface goes to **0 production lines and 0 new test files** — every gate edit then lands in overlay (A) or fork-exclusive (B) code, and the lone D-001 patch region (`client.rs:1585`) is left byte-identical. The plan's foundation (overlay helper + env var + launcher field + decorator + routing gate) is sound and correctly overlay-first; these are seam-placement refinements, not a redesign.

### MUST-ADOPT, plan-amendable items
- **R1:** Change "Modify `core/src/client.rs` (~:1585) — pass the resolved gate" → "Leave `core/src/client.rs` byte-unchanged; resolve the gate inside `chat_transport.rs::effective_wire_api` via a 2-arg public wrapper delegating to a 3-arg `effective_wire_api_gated(route, provider_wire, anthropic_enabled)` inner fn." Drop `client.rs` from the Files-to-Modify list.
- **R2:** Add to Files-to-Create/Modify: "Register the decorator as `mod gated_models_manager;` **inside `model-provider/src/copilot.rs`** (file at `model-provider/src/copilot/gated_models_manager.rs`); do NOT add a `mod` line to the upstream-canonical `model-provider/src/lib.rs`."

### SHOULD-ADOPT, plan-amendable item
- **R3:** Re-scope US-005/US-006 to prove the gate via colocated decorator unit tests (`gated_models_manager.rs`) + routing unit test (`chat_transport.rs`) + an optional structural test in `codex-rs-overlay/codex-invariant-tests/`; remove the edits to `core/src/tools/handlers/multi_agents_tests.rs` and `tui/src/chatwidget/tests/popups_and_settings.rs`. If e2e coverage is wanted, add it in a fork-owned `core/tests/suite/` test, not in the two upstream-canonical test files.

---

## Appendix — verification commands (read-only, run from `codex/external/repos/codex-patched`)

- Baseline classification: `git cat-file -e rust-v0.135.0:codex-rs/<path>` (exit 0 = upstream-canonical; non-0 = fork-added).
- D-001 footprint: `git show --stat 40accc502`; `git show 40accc502 -- codex-rs/core/src/client.rs` (SANDBOX PATCH regions); `git show 40accc502 -- codex-rs/core/src/lib.rs`.
- File origin: `git log --oneline --diff-filter=A -- codex-rs/<path>` (`copilot_models_endpoint.rs`←`b9a8f454f`; `copilot.rs`←`a45d5d741`; `chat_transport.rs`←`40accc502`).
- Callsites: `rg effective_wire_api codex-rs` (1 prod in client.rs:1585; def + 3 tests in chat_transport.rs).
- Mod block: `model-provider/src/lib.rs:4-12` (existing SANDBOX PATCH copilot mod block).
- Invariants: `docs/implementation/patch-surface.md` §14 rows 32-38 (L814-820); §15 D-001 replant (L1171-1212).
- Overlay test crate shape: `codex-rs-overlay/codex-invariant-tests/Cargo.toml` (no `codex-core` dep) + `tests/plugin_scope_filtering.rs:1-2` ("STRUCTURAL-ONLY INVARIANT TEST", `include_str!`).
