# Increment-2 Frequency-Check Gate

Source: `.ralph-overview/data.json` (hot) + `.ralph-overview/data.archived.json` (cold),
shipManifest.commits[].repo over all 144 shipped-with-commits tasks (of 312 total).

## Classification
- **Category A — genuine 2+ repo SUBSTANTIVE write** (both repos get non-pointer-bump commits): **57**
- **Category B — submodule code-write + pointer-bump-only parent** (parent commit is the lead gitlink bump, NOT a Ralph story): **36**
- Single-repo: 51

Pointer-bump detection: oneLine matches `bump|update .*(pointer|gitlink|submodule)|chore(...): bump`.

## Verdict: Increment 2 IS justified by frequency
The brainstorm's disconfirming condition — "if truly-multi-repo plans are rare, ship
Increment 1 and defer Increment 2" — is **FALSE**. Genuine multi-repo writes recur
frequently (57 all-time; ~14 of the last 30 ships).

## Dominant beneficiary = the codex NESTED two-repo case (NOT the simple submodule+wrapper)
Most Category-A tasks are `codex-patched (inner, branch sandbox-patches) + codex (wrapper, branch main)`:
- code in inner `external/repos/codex-patched/codex-rs/...` (off `sandbox-patches`)
- docs in wrapper `codex/docs/implementation/patch-surface.md` (off `main`)
Examples (recent): codex-anthropic-model-persists, codex-autoconnect-interactive-self-onboard,
codex-hook-executor-windows-native-shell, codex-fork-flags-to-experimental-features-migration,
the whole 2026-06-11/12 TUI batch, codex-upstream-rebase-to-0.140/0.141.

The simple `ai-developer-toolkit + codexu` pairs are MOSTLY Category B (toolkit code + codexu
pointer bump = lead ceremony), already served by single-repo impl + lead bump.

## Planning implications
1. Increment 2's primary topology to support is the **codex nested 2-repo** (submodule-of-submodule,
   inner on a non-main branch `sandbox-patches`, wrapper on `main`), NOT just sibling submodule+wrapper.
   This is HARDER than the brainstorm's running example and must be called out explicitly.
2. Category B (pointer-bump parent) does NOT need the scaffolder to emit a parent "story" — the
   parent commit is the lead-owned gitlink bump. The ship-order manifest encodes it as a LEAD gate.
3. Increment 1 (template + $namespaced convention + validator) still ships FIRST: it is the
   immediate fix for the 2026-06-09 codex hand-roll and de-risks Increment 2.
4. Frequency justifies COMMITTING to Increment 2 (not deferring indefinitely), but staged after Inc 1.
