Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm synthesis: codex-anthropic-model-persists-without-enable-flag

## The bug (operator-reported 2026-06-10)
The active model persists across runs (`~/.codex/config.toml::model`), but the Anthropic gate
(`--enable-anthropic` / `features.anthropic_models` / env, default OFF) does NOT persist when set via
the **ephemeral flag/env**. So: enable Anthropic + pick `claude-opus-4.8` (persisted) → run again
WITHOUT the flag → persisted model is still `claude-opus-4.8` while the gate is OFF → the model is sent
to the default Responses API path → every message fails until the user manually changes the model.

## Decisive finding: the operator's exact desync is very likely ALREADY FIXED on api-3
The current codex submodule HEAD **is** `release/0.141.0-copilot-api.3` (the build the bug was hit on),
and a multi-layer **fail-closed reversion (behavior #2)** is already present:

- **Gate is process-global, never persisted** — `model-provider/src/anthropic_gate.rs` (`AtomicBool`,
  default `false`; `install_anthropic_gate` :37; `anthropic_models_resolved` :43), installed once per
  run from `Feature::AnthropicModels` at `core/src/config/mod.rs:2832`. `--enable-anthropic` folds to
  `-c features.anthropic_models=true` at `cli/src/main.rs:976`. Only the **config key** persists; the
  flag/env are per-run. This is *why* it desyncs — and is intentional per the experimental-feature
  design (default off, explicit opt-in per run).
- **Core fail-closed reversion** — `model-provider/src/copilot/gated_models_manager.rs`
  (`keep_model_slug:56`, `get_default_model:142`, `get_model_info:164`, `is_anthropic_model_slug:189`)
  replaces a persisted/inherited Claude slug with the filtered default when the gate is off (tests
  `:338`, `:352`). Consumed at session startup `core/src/session/mod.rs:564-573`; requests use the
  resolved `model_info.slug` at `core/src/client.rs:814-816`.
- **TUI startup reversion** — `tui/src/app_server_session.rs:1260` `bootstrap_default_model` +
  `is_unavailable_anthropic_model:1276` revert a persisted unavailable-Claude `config.model` to the
  safe catalog default.
- **Routing gate** — `core/src/chat_transport.rs:64-77` `effective_wire_api_gated` forces the provider
  wire (Responses) for a chat-hinted model when the gate is off. (Note: this only changes the *wire
  route*, not the model *slug* — so the reversion of the model identity, not routing, is what prevents
  the bad request.)

**Git timeline (the linchpin):** the bug was reported **2026-06-10**; the reversion defenses landed in
`9345bac3f3` ("Migrate fork flags to experimental features", **2026-06-13**) and `596352d5b3`
("fix(tui): live-toggle ...", **2026-06-14**) — **3-4 days AFTER the report**; the api-3 tag was
re-cut **2026-06-22** and includes them. The Devil's-Advocate lens verified the exec/headless,
stale-cache, and sub-agent paths all flow through the gated wrapper, and found **no still-open
/responses-bricking path on the built-in Copilot provider**.

This reframes the task from **net-new design** to **verify-and-harden**.

## The real remaining defect
The cold-startup substitution is **silent**: `config.toml::model` still says `claude-opus-4.8` while the
runtime quietly uses a fallback — unlike the live `/experimental` toggle path, which DOES message at
`tui/src/chatwidget/settings.rs:226-240` ("Model changed to {x} because the previous model is no longer
available."). `bootstrap_default_model` is silent, and the exec/headless path has no advisory at all.
There is also **no end-to-end regression test** reproducing the exact operator scenario.

---

### D-001: Verify-and-harden — keep behavior #2, add the missing advisory + regression tests [RECOMMENDED]
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: behavior #2 is already implemented and verified across the Copilot
  exec/TUI/cache/sub-agent surfaces; it keeps the gate authoritative and stays fully consistent with the
  experimental-feature design (gate default OFF; explicit opt-in). The only genuine gap is communication
  + a locking regression test.
- Scope:
  1. **Advisory on cold startup AND exec/headless** when the resolved active model != the persisted
     `config.model` because of the Anthropic gate. Mirror the existing live-toggle message; emit a
     `WarningEvent`/startup notice for non-TUI. Seams: `tui/src/app_server_session.rs:1260-1274`,
     `core/src/session/mod.rs:564-574`, `core/src/session/turn_context.rs:854-866`.
  2. **Leave `config.toml::model` untouched on disk** (preference preserved → re-enabling restores
     Claude). The advisory tells the user how to re-enable (`--enable-anthropic`, or persistently
     `features.anthropic_models = true` in `~/.codex/config.toml`).
  3. **End-to-end regression suite**: headless `exec` (assert outbound `/responses` body model is the
     fallback, not Claude), stale `models_cache.json` from a prior gate-on run, a direct
     app-server/turn-config bypass attempt, and an advisory assertion for both TUI cold start and exec.
  4. **Gating-invariant guard test** asserting that all production session + model-list construction
     flows through the Copilot `GatedModelsManager` wrapper (the single highest-risk assumption, fragile
     under future refactors because `SharedModelsManager` is passed around directly), and document the
     invariant: "gate is authoritative; the on-disk model is a preference, not necessarily runtime-active".
- Risks / friction: leaves an "invalid-looking" pair on disk (`model=claude` while gate off) so every
  cold start re-discovers and patches over it; users may be briefly surprised their configured Claude is
  not active even though it remains in config.toml — mitigated by the advisory.
- Cheapest validation: reproduce the exact scenario across TUI + exec + sub-agent with gate off and
  assert a supported default is used and a one-time actionable message appears.
- Disconfirming observation: if an end-to-end cold-start or exec/headless test with
  `model=claude-opus-4.8` + `features.anthropic_models=false` STILL sends a `claude-*` slug to
  `/responses`, then behavior #2 has a real hole and this direction must first close it (not just add the
  advisory).

### D-002: Couple-the-persists — persist canonical `features.anthropic_models=true` on Anthropic model selection (behavior #3)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: better preserves explicit user intent ("I picked Claude, keep Claude"). The two
  states never desync because selecting/persisting a Claude model also writes the **canonical feature
  key** (not an ad-hoc bool, so it stays consistent with the experimental-feature mechanism). Seams:
  `tui/src/app/config_update.rs:62-78`, `tui/src/app/event_dispatch.rs:858-864`, `features/src/lib.rs:1040-1042`.
- Risks / friction: changes persistent config as a **side effect of model selection** — a per-run
  `--enable-anthropic` user may be surprised their `config.toml` now durably enables an experimental
  provider; if the user later wants GPT they must also remove the feature; arguably consent-heavier than
  a per-run flag. Note the picker already only offers Claude when the gate is ON, so selection is a valid
  opt-in moment — but making it durable needs a clear UI notice ("Selecting Claude will persist
  `features.anthropic_models=true`").
- Cheapest validation: ask 3-5 fork users whether selecting Claude should permanently enable Anthropic;
  prototype only if expected.
- Disconfirming observation: a product rule that "selecting Claude during a one-run `--enable-anthropic`
  session must NOT write `features.anthropic_models=true`" rules this out.

### D-003: Selection-time fail-closed guard (behavior #4) — defense-in-depth only
- Contributing lenses: [codex, copilot]
- Why this might work: prevents future bad states by refusing to select/persist an Anthropic model when
  the gate-filtered catalog excludes it. Seams: `tui/src/chatwidget/model_popups.rs:571-573`,
  `tui/src/app/config_update.rs:62-78`, `core/src/tools/handlers/multi_agents_common.rs:354-365`.
- Risks / friction: does NOT repair the EXISTING persisted bad state (the reported repro selects Claude
  while the gate is ON, then desyncs on the next gate-off run), so it cannot be the primary fix; the
  picker already filters Claude when the gate is off, so much of this is redundant.
- Cheapest validation: a smoke test around the picker + config persistence confirming Claude cannot be
  selected/persisted when the gate-filtered catalog excludes it.
- Disconfirming observation: existing bad configs still fail on startup → runtime reconciliation (D-001)
  is still required regardless.

## Open questions carried forward
- Leave `config.toml::model` untouched (preference preserved; recurring silent mismatch) vs rewrite it
  (no mismatch; silent loss of the Claude preference)? Synthesis recommendation: **leave untouched + add
  the advisory** (D-001).
- Non-TUI/exec advisory shape: `WarningEvent`, stderr startup line, or both?
- Test breadth: one exact operator-scenario integration test, or separate coverage for TUI bootstrap,
  app-server `model/list`, exec, and sub-agent inherited-model paths (the lenses lean toward breadth)?
- Should an explicit `-m claude-*` with the gate off hard-error or follow the same silent-fallback rule?
