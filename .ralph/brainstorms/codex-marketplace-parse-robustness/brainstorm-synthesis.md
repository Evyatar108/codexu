Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm synthesis — codex-marketplace-parse-robustness

## Problem (verified against real source)

Adding a marketplace whose index contains ONE plugin entry with an unknown policy enum value
(the 2026-06-05 incident: `policy.authentication: "OFF"`) makes codex's parser abort the ENTIRE
index, so every other valid plugin also becomes unavailable. The masked TUI error
("Failed to add marketplace.") hid the precise serde detail the CLI already prints.

Ground truth (`external/repos/codex-patched/codex-rs/core-plugins/src/marketplace.rs`):
- `load_raw_marketplace_manifest:401` does a single all-or-nothing
  `serde_json::from_str::<RawMarketplaceManifest>(&contents)`.
- The two policy enums (`MarketplacePluginInstallPolicy`, `MarketplacePluginAuthPolicy`, ~90-108)
  are upstream-canonical, use `#[serde(rename)]`, and have NO `#[serde(other)]`. Their `From` impls
  to the protocol enums are exhaustive and the protocol enums have no Unknown variant.
- `#[serde(default)]` on the policy fields rescues MISSING fields only, never unknown VALUES.
- A per-entry **skip-and-warn precedent already exists** in `load_marketplace:282-300`
  (`InvalidPlugin` → `warn!` + `continue`) and `resolve_supported_plugin_source:448`, but it runs
  AFTER the all-or-nothing `from_str`, so policy-value errors never reach it.
- The Raw deserialize structs (~717-752) are PRIVATE to the `codex-core-plugins` crate.
- TUI: `tui/src/app/background_requests.rs:186` formats the error WITH detail, but
  `tui/src/chatwidget/plugins.rs:1271 marketplace_add_error_popup_params` takes no error argument and
  hardcodes a generic string — even though its sibling `marketplace_load_error_popup_params:1263`
  already renders `err.to_string()` as the item description.

**Overlay-feasibility verdict (verified):** a clean ZERO-conflict `codex-rs-overlay/` crate is NOT
possible for any codex-side parse fix, because (a) the Raw structs are private to core-plugins so an
overlay helper can't deserialize them without re-declaring the schema (drift risk), (b) the serde
derives live on upstream enums, and (c) the TUI render seam is in-crate. Therefore every codex-side
direction (B/C/D) is an INLINE upstream edit carrying the full SANDBOX PATCH ceremony
(`// SANDBOX PATCH:` marker + patch-surface.md §14 invariant row + §15 replant note + enforcing test)
= ongoing `/rebase-upstream` cost. Only the toolkit-side direction has zero codex conflict surface.

## Lens convergence

All three lenses independently agreed on the same posture:
1. **Producer guard now** (zero codex conflict) is the primary fix — the defect was our own data.
2. **Codex partial-parse** is the principled robustness fix but should be **upstream-first**, not
   carried as a fork patch.
3. **Tolerant enum** is mechanically easy but **semantically worst** (silently accepts a malformed
   security-relevant `authentication` value) — not recommended.
4. **TUI error surfacing** is a real masking bug worth fixing but is diagnosis-only and better
   upstreamed.

The Devil's Advocate set `red_flag = true`: fork-local codex hardening is net-negative versus the
toolkit guard alone, and added a sharp observation — a `warn!`-and-skip silently dropped plugin may
be just as confusing to a user as the current all-or-nothing failure, because `warn!` goes to
tracing/stderr, not the TUI.

---

## Candidate directions

### D-001: Toolkit-side pre-release / CI / pre-commit schema guard
- Contributing lenses: [codex, copilot, devils-advocate]
- Conflict-surface tier: **ZERO** (lives in `ai-developer-toolkit`, no codex edit).
- Rebase-cost note: no `/rebase-upstream` ceremony; all cost stays in toolkit-owned validation.
- Why this might work: the bad value originated in OUR repo, which owns all three marketplace
  indexes (`.claude-plugin/`, `.github/plugin/`, `.agents/plugins/`). A guard that validates every
  `authentication` + `installation` value against codex's accepted enum set
  (`installation ∈ {NOT_AVAILABLE, AVAILABLE, INSTALLED_BY_DEFAULT}`,
  `authentication ∈ {ON_INSTALL, ON_USE}`) before publish prevents the exact failure with zero codex
  conflict surface. Candidate homes: the toolkit `release-plugin` skill, a toolkit unit test, or a
  pre-commit hook (decision for the plan phase).
- Risks / friction: only protects marketplaces WE own; a third-party marketplace with one bad entry
  still trips codex's all-or-nothing parser. Must cover every bypass/publish path or it is
  insufficient.
- Cheapest validation: add an invalid fixture (`authentication: "OFF"`) and prove the toolkit
  check/release command fails, naming the plugin id, field path, bad value, and the accepted set.
- Disconfirming observation: if codex users routinely add third-party marketplaces, this fixes our
  release hygiene but not the product robustness gap.

### D-002: Upstream-first codex partial-parse (skip-and-warn bad entries)
- Contributing lenses: [codex, copilot, devils-advocate]
- Conflict-surface tier: **ZERO if pursued upstream-only; INLINE if carried in the fork** (a
  two-stage rewrite of the single `load_raw_marketplace_manifest` function body).
- Rebase-cost note: best path avoids fork rebase cost entirely; a fork-local carry is a perpetual
  SANDBOX PATCH site on a function upstream may itself refactor.
- Why this might work: replace the single `from_str::<RawMarketplaceManifest>` with a two-stage parse
  — deserialize top-level `name`/`interface`, keep `plugins` as `Vec<serde_json::Value>`, then loop
  `serde_json::from_value::<RawMarketplaceManifestPlugin>(entry)`, `warn!`-and-skip on per-entry
  error so valid plugins survive. This is the most principled robustness fix and directly extends the
  skip-and-warn pattern the codebase already uses in `load_marketplace`. Because the behavior is
  generally useful (not Copilot-specific), it is a strong candidate for an upstream openai/codex
  issue/PR, which would give the fork the robustness canonically with no rebase cost.
- Risks / friction: touches an upstream-canonical function body; must preserve `InvalidMarketplaceFile`
  behavior for genuinely malformed top-level JSON; warnings may be invisible in the TUI (a silently
  dropped plugin can still confuse users — pair with D-003 if pursued). Upstream may reject tolerant
  parsing on trust/atomicity grounds.
- Cheapest validation: draft a minimal upstream issue/PR with one failing test — a manifest with
  [valid, bad-`authentication:"OFF"`, valid]; expected result is the two valid plugins load and the
  bad entry is warned/skipped, while top-level malformed JSON still returns `InvalidMarketplaceFile`.
- Disconfirming observation: if upstream maintainers state manifests must be atomic for
  trust/security guarantees, partial-parse is the wrong consumer semantic. (Note: the existing
  per-entry skip-and-warn in `load_marketplace` is evidence AGAINST a strict-atomicity intent.)

### D-003: TUI add-error detail surfacing (diagnosis-only)
- Contributing lenses: [copilot, devils-advocate] (corroborated by the code investigation; the codex
  lens folded this into context)
- Conflict-surface tier: **INLINE** (small upstream-canonical TUI render edit).
- Rebase-cost note: perpetual rebase friction for a UX-only win; better upstreamed than fork-carried,
  and the TUI/chatwidget area is high-churn.
- Why this might work: the masked error cost real debugging time on 2026-06-05. The fix is small and
  mirrors an EXISTING in-file pattern — `marketplace_add_error_popup_params:1271` simply needs to
  accept the error and render `err.to_string()` as a `SelectionItem.description`, exactly as its
  sibling `marketplace_load_error_popup_params:1263` already does. The detail is already available at
  `background_requests.rs:186`.
- Risks / friction: does NOT improve robustness — a marketplace with one bad entry still cannot be
  added; it only makes the failure diagnosable. Still an inline upstream edit.
- Cheapest validation: reproduce with the bad manifest and confirm the TUI renders
  `unknown variant OFF, expected ON_INSTALL/ON_USE` instead of only "Failed to add marketplace."
- Disconfirming observation: the CLI already prints the precise error, so if the real operator flow
  exposes CLI logs, the TUI patch may not justify ongoing fork ceremony on its own.

### D-004: Tolerant enum via `#[serde(other)]` → safe default (NOT recommended)
- Contributing lenses: [codex] (explicitly as the option to avoid); echoed by copilot/devils-advocate
  via the "fail-closed" question.
- Conflict-surface tier: **INLINE** (enum-body + exhaustive `From`-impl edits on 2 upstream enums).
- Rebase-cost note: small diff but high SEMANTIC ownership cost — it changes how malformed
  security-relevant policy data is interpreted, forever.
- Why this might work: mechanically `#[serde(other)] Unknown` is feasible (both are unit-variant
  enums); unknown values would parse instead of aborting.
- Risks / friction: `authentication` is security-adjacent; mapping `"OFF"` to a silent default
  (`OnInstall`/`OnUse`) accepts invalid policy data rather than failing safe. Strictly weaker than
  per-entry skip-and-warn (D-002), which drops only the bad plugin. Also requires editing the
  exhaustive `From` matches.
- Cheapest validation: prototype the catch-all, confirm `"OFF"` parses, inspect the resulting
  protocol policy — if the only mapping is a silent default, reject in favor of D-002.
- Disconfirming observation: only attractive if a product requirement explicitly mandates "unknown
  policy values must preserve marketplace availability and must not drop plugins" — no such
  requirement is evident.

---

## Recommended direction (HOLD for operator)

**Primary: D-001 (toolkit-side schema guard) — ship now, ZERO codex conflict surface.** It fixes the
actual root cause of the incident (we shipped invalid data) at the layer we own.

The full recommended posture is layered:
- **D-001 now** — the confident lead; prevents recurrence with zero rebase cost.
- **D-002 upstream-first** — if genuine codex parser robustness is wanted (e.g., for third-party
  marketplaces), propose it to openai/codex rather than carrying a fork patch, so the fork gains it
  canonically at zero rebase cost. Pair with D-003 so a skipped plugin is visible, not silent.
- **D-003 upstream-first** — a real, small masking-bug fix; valuable but diagnosis-only.
- **D-004 — do not pursue**; semantically worse than D-002 for a security-relevant field.

This reflects a 3-lens + Devil's-Advocate consensus (`red_flag = true`) that **fork-local** codex
hardening is net-negative versus the toolkit guard. The codex-side robustness work is worth doing
**only as an upstream contribution**, not as a perpetual fork patch.

## Open questions for the operator
1. Scope: are we protecting only OUR marketplace, or do we care about arbitrary third-party
   marketplaces a codex user might add? (If only ours, D-001 alone suffices.)
2. Should unknown `authentication` values always fail closed (drop the plugin) rather than be
   silently defaulted? (Favors D-002 over D-004.)
3. Must a skipped/dropped plugin be VISIBLE in the TUI (not just `warn!` to tracing)? (Couples
   D-002 with D-003.)
4. Are we willing to upstream the codex-side change instead of carrying it locally?
