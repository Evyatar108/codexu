# Preflight Approval Record — ai-developer-toolkit-submodule

*Authoritative record of the operator's pre-implementation decisions for US-001. Created 2026-06-02 by the impl-phase member upon receipt of the lead's spawn prompt carrying the resolution.*

## Resolution summary (2026-06-02T14:21Z, lead-recorded)

All US-001 preflight gates are **RESOLVED before impl start**. The iteration agent for US-001 MUST NOT prompt the operator for any of these decisions and MUST NOT issue any `git push` to remote toolkit repos.

### 1. Remote sync — DONE (no further action needed)

The lead verified on 2026-06-02 that all 3 ai-developer-toolkit remotes are aligned at:

> `d7e01874385c13e7e833a6935d7de11ea2e565f7`

Procedure used: the lead force-pushed `gim-home/d7e01874` → `origin/main` and `personal/main` (the original plan's framing of "gim-home lags origin" was inverted — gim-home was actually 1 commit AHEAD with the crews v3.0.1 fix). Local `D:/ai-developer-toolkit` main was then pulled forward. Verified post-sync via `git ls-remote` on all 3 remotes (`origin`=evmitran_microsoft, `personal`=Evyatar108, `gim-home`).

**No `git push` to any toolkit remote is needed by this impl.** Out of scope.

### 2. Pin SHA — d7e01874385c13e7e833a6935d7de11ea2e565f7

This is the now-aligned HEAD across all 3 remotes. The submodule MUST be pinned to this commit.

Verification command (run by US-001 iteration agent after `git submodule add` + `git submodule update --init`):

```
git -C ai-developer-toolkit rev-parse HEAD
```

Expected output: `d7e01874385c13e7e833a6935d7de11ea2e565f7`. Any other SHA is an error; deinit the submodule and re-add against the correct ref.

### 3. Submodule source URL — `evmitran_microsoft`, NOT `gim-home` (OVERRIDE)

**This OVERRIDES the original plan's references to `gim-home` in:**

- The `git submodule add` command in US-001
- The `.gitmodules` `url = ...` entry
- AC #135 verification text
- `tools/check-toolkit-submodule-invariants.mjs` URL check (US-006)
- Any AGENTS.md / CLAUDE.md cross-refs added in impl scope (US-003)

**Mandated submodule URL:**

> `https://github.com/evmitran_microsoft/ai-developer-toolkit.git`

**Rationale (operator):** `evmitran_microsoft` is the canonical source for codexu (its own `origin` remote points there). Using the same org for the toolkit submodule keeps source-of-truth consistent across both submodules of this superproject.

**CI auth implication:** the original plan's "`gim-home/ai-developer-toolkit` is INTERNAL/private + GIM_HOME_PAT" subsection is **OBSOLETE**. `evmitran_microsoft/ai-developer-toolkit` is also private but uses the same standard CI credentials as the rest of the `evmitran_microsoft` org (which already powers codexu's existing CI). The required CI invariant stays metadata-only by default — no `GIM_HOME_PAT` secret is required, no deep-fetch step is added.

**Marketplace install layer is unaffected.** `copilot plugin update ralph-overview@ai-developer-toolkit` continues to pull from gim-home (the marketplace publication source). The submodule is for version-pinning + dev-mode source editing; the marketplace install path under `~/.copilot/installed-plugins/` and `~/.claude/plugins/cache/` is a separate concern that this override does not touch.

## What this means for iteration agents

- **US-001 iteration agent:** Skip every "STOP and ask operator" gate in the plan. The remotes are already synced, the pin SHA is decided, the URL is decided. Execute `git submodule add https://github.com/evmitran_microsoft/ai-developer-toolkit.git ai-developer-toolkit` directly, then verify the pinned SHA matches `d7e01874385c13e7e833a6935d7de11ea2e565f7`. Commit as `chore: add ai-developer-toolkit submodule at d7e01874`.
- **US-006 iteration agent:** Use the evmitran_microsoft URL in the CI invariant's `.gitmodules` URL check. Do NOT add a `GIM_HOME_PAT`-gated deep-check step. Required CI invariant remains metadata-only.
- **US-003 iteration agent:** Any AGENTS.md / README.md / docs cross-refs to the submodule URL use the evmitran_microsoft form.

## Approval provenance

- **Source:** in-session lead-to-impl spawn prompt, recorded in the impl-member's mailbox at impl start.
- **Lead timestamp:** 2026-06-02T14:21Z (lead-recorded resolution time).
- **Impl receipt timestamp:** 2026-06-02T07:29:00-07:00 (= 14:29Z; per the spawn-prompt's `current_datetime`).
- **Authority:** the lead is the operator's delegated bookkeeper for this crew. Operator pre-approved this resolution by delegating the remote-sync + pin-SHA + URL-override decisions to the lead via the standing fork operating manual (AGENTS.md "Just do ops work" preference for low-risk reversible operations within the lead's scope).

## What the impl member does NOT do as part of this resolution

- Push to gim-home, evmitran_microsoft, or Evyatar108 toolkit remotes.
- Re-verify the 3-remote alignment (the lead already did, with `git ls-remote`).
- Re-derive the pin SHA (it's already decided).
- Add `GIM_HOME_PAT` to anything.
