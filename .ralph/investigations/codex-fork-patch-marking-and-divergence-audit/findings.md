# Codex fork patch-marking + divergence audit

## Verdict

**Not sufficient.** The fork has a clear intended convention for divergence tracking, but the current registry is stale and does not cover most of the recent `.4` ship or the `.5` accumulation.

- **Intended contract:** upstream-canonical edits must carry a `// SANDBOX PATCH:` marker **and** land in `docs/implementation/patch-surface.md` with a §14 invariant row and a §15 replant note (`codex/CLAUDE.md:16-24`).
- **Canonical registry:** `docs/implementation/patch-surface.md` calls itself the authoritative reference for every fork change (`codex/docs/implementation/patch-surface.md:22-24`), and `/rebase-upstream` points conflict resolution at that file as the "full annotated change inventory" (`codex/.claude/commands/rebase-upstream.md:88-90`).
- **Current reality:** that registry is still stamped **"Last Updated: 2026-05-12"** and **"Applies to: 0.130.0-copilot-api.*"** (`codex/docs/implementation/patch-surface.md:1-4`), while the recent features audited here shipped in `0.135.0-copilot-api.3/.4` or are accumulating on `ralph/codex-v5-int`.

I found **8 gaps** across the recent patch set: some changes are source-marked but undocumented, some are undocumented and unmarked, and one older registry entry is now stale/wrong after the paste-burst revert.

## Convention and current machinery

### Marker convention

The fork's written rule is explicit: when an edit lands in upstream-canonical code under `external/repos/codex-patched/codex-rs/`, it should use a `// SANDBOX PATCH:` marker and be registered in `patch-surface.md` §14/§15 (`codex/CLAUDE.md:16-24`).

### Overlay mechanism

The current fork layout is:

- wrapper repo `codex/`
- inner patched-upstream submodule `external/repos/codex-patched/`
- fork-only overlay crates in `codex-rs-overlay/`

The overlay crates are workspace members referenced from the patched Rust workspace via relative paths, so fork-only code can live outside the upstream-owned tree while still building in one Cargo workspace (`codex/docs/implementation/architecture.md:63-74`). The rebase workflow depends on this layout and warns that the wrapper worktree must be used because `codex-rs/Cargo.toml` includes sibling overlay crates through `../../../../codex-rs-overlay/` (`codex/.claude/commands/rebase-upstream.md:27-31`).

### Divergence registry

There **is** a single intended canonical divergence registry today: `docs/implementation/patch-surface.md` (`codex/docs/implementation/patch-surface.md:22-24`, `codex/CLAUDE.md:74-76`, `codex/.claude/commands/rebase-upstream.md:88-90`).

But the automated static audit is **not** a full registry. `scripts/audit_network_calls.sh` only checks a bounded `KNOWN_PATCH_FILES` list plus a few overlay files, mostly for network-suppression and select security/fork seams (`codex/scripts/audit_network_calls.sh:32-80`). It does not enumerate recent TUI, resume-picker, hook-gating, or model-knob patches as a general maintained patch inventory.

## Recent patch set audited

### `.4` release tasks from codexu ship manifests

Recent merged codex tasks shipped on `2026-06-11` include:

- `codex-tui-agent-spawn-name-display` (`.ralph-overview/data.json` ship manifest output)
- `codex-tui-bg-completion-exec-cell-rendering`
- `codex-tui-focus-event-leak-input-corruption`
- `codex-context-window-tier-selection`
- `codex-nonblocking-bg-completion-surfacing`

And from the `.3` release in the same recent batch:

- `codex-anthropic-transport-no-text-output`
- `codex-anthropic-enable-flag`
- `codex-copilot-model-knobs-reasoning-context`
- `codex-knob-a-default-medium`
- `codex-disable-managed-hooks-by-default`
- `codex-revert-disable-paste-burst-default`

### `.5` accumulation branch

`ralph/codex-v5-int` currently carries at least:

- `e484d0e561` `perf(tui): /resume loads first page DB-only + lazy reconcile (avoid filesystem scan/repair)`
- `0f7bf5d46b` `feat(tui): show agent name (not guid) in wait + completion cells`

from the branch log at `codex/external/repos/codex-patched` (`git log ralph/codex-v5-int`).

## Coverage matrix

| Change | Source evidence | Marked as fork patch? | Documented in canonical registry? | Gap |
|---|---|---:|---:|---|
| Focus-event leak fix | `codex-rs/tui/src/tui.rs:248-256` | **Yes** | **No** | Source has `SANDBOX PATCH`, but `patch-surface.md` has no corresponding 0.135/v4 entry. |
| BG-completion exec-cell rendering | `codex-rs/tui/src/chatwidget/command_lifecycle.rs:154-160` | **Yes** | **No** | Marked inline, but no corresponding registry/replant entry. |
| Agent name display (spawn + remaining lifecycle cells) | `codex-rs/tui/src/chatwidget/tool_lifecycle.rs:117-143`, `codex-rs/tui/src/multi_agents.rs:334-341`, `codex-rs/tui/src/multi_agents.rs:475-490` | **No** | **No** | Behavior is present, but the touched TUI files carry no `SANDBOX PATCH` marker and the registry has no entry. |
| Knob B context-tier + status-line surfacing | `codex-rs/model-provider/src/copilot_models_endpoint.rs:251-255`, `:301-329`, `:363-379`; `codex-rs/tui/src/chatwidget/status_surfaces.rs:180-189` | **Yes** | **No** | Inline markers exist, but the registry does not describe this patch family. |
| Knob A reasoning threading + medium default | `codex-rs/core/src/client.rs:1641-1648`, `codex-rs/model-provider/src/copilot_models_endpoint.rs:372-380` | **Yes** | **No** | Source is marked, but `patch-surface.md` does not call out the reasoning-effort thread/default fix. |
| Anthropic opt-in + text rendering | `codex-rs/core/src/chat_transport.rs:1-20`, `:373-376`; `codex-rs/core/src/chat_transport/anthropic_sse.rs:1-20`; `codex-rs/core/src/config/mod.rs:2576-2591`; `codex/docs/implementation/patch-surface.md:814-821`, `1172-1249` | **Yes** | **Yes** | This is the best-covered recent patch family. |
| Nonblocking BG-completion surfacing / `Op::WakePendingWork` | `codex-rs/core/src/session/mod.rs:1110-1118`; `codex-rs/core/src/tasks/mod.rs:446-453`, `913-920`; `codex/docs/implementation/patch-surface.md:710-743`, `793-795` | **Yes** | **Yes** | Also properly covered. |
| Disable-managed-hooks-by-default | `codex-rs/hooks/src/managed_gate.rs:1-24`, `49-55`; `codex-rs/hooks/src/engine/mod.rs:144-150`; `codex-rs/core/src/config/mod.rs:2592-2600` | **Yes** | **No** | Clearly marked in source, but absent from the canonical registry. |
| `/resume` DB-only first page + lazy reconcile | `codex-rs/tui/src/resume_picker.rs:112-115`, `161-163`, `1320-1344`, `1731-1738`, `1930` | **No** | **No** | Current `.5` accumulation patch has no `SANDBOX PATCH` marker in `resume_picker.rs` and no registry entry. |
| Paste-burst default revert | `codex-rs/core/src/config/mod.rs:3576`; `codex/docs/implementation/patch-surface.md:651-684` | **No** | **Stale / wrong** | Current code is back to `unwrap_or(false)`, but the canonical registry still documents the old fork divergence (`unwrap_or(true)`). |

## What is and is not reliably tracked today

### Well-covered recent areas

Two recent patch families meet the intent reasonably well:

1. **Anthropic chat transport / opt-in gate** — marked in source and registered in §14/§15 (`codex/docs/implementation/patch-surface.md:814-821`, `1172-1249`).
2. **Background-process notification / nonblocking self-wake path** — marked in source and documented in §13 + invariants (`codex/docs/implementation/patch-surface.md:710-743`, `793-795`).

### Weakly covered recent areas

These recent changes are either missing markers, missing registry coverage, or both:

- Focus/PageDown leak fix
- BG completion exec-cell rendering
- Agent-name display in spawn/wait/completion cells
- Knob B context-tier/status-line work
- Knob A reasoning default/threading details
- Managed-hooks opt-in gate
- `/resume` DB-only first page + lazy reconcile
- Paste-burst revert (registry is stale)

### Why that matters for rebases

The rebase skill explicitly tells the operator to consult `patch-surface.md` as the "full annotated change inventory" (`codex/.claude/commands/rebase-upstream.md:88-90`). Today that is unsafe for the recent patch set because:

1. the document header is still pinned to the old `0.130.0-copilot-api.*` series (`codex/docs/implementation/patch-surface.md:1-4`);
2. the static audit only covers a subset of known patch files (`codex/scripts/audit_network_calls.sh:32-80`);
3. several live upstream-canonical edits exist only in source/history or codexu ship manifests, not in the canonical divergence ledger.

## Recommendation

### Immediate conclusion

**No: the current marking + documentation are not sufficient to reliably re-apply the full recent patch set on the next upstream rebase.**

The registry is authoritative in theory, but stale in practice for most `.4`/`.5` work.

### Concrete fix

File a follow-up implementation task that does all of the following in one pass:

1. **Refresh `docs/implementation/patch-surface.md` to the current release line**  
   Update the header from `0.130.0-copilot-api.*` to the current maintained series and add explicit coverage for the missing recent patch families above.

2. **Bring missing upstream-canonical edits into the written contract**  
   For each missing recent patch family, add:
   - a §14 invariant row,
   - a §15 replant note,
   - and any focused audit/test hook needed to keep it from silently dropping on rebase.

3. **Add missing `SANDBOX PATCH` markers where the code is currently unmarked**  
   Highest-priority candidates from this audit:
   - `codex-rs/tui/src/multi_agents.rs` / related agent-name-display seam
   - `codex-rs/tui/src/resume_picker.rs`
   - any current upstream-canonical paste-burst divergence if one remains after the revert (or, if the revert fully retired the patch, remove the stale patch-surface entry instead of re-marking code)

4. **Retire or correct stale registry entries**  
   The current paste-burst section still claims the fork default is `unwrap_or(true)` (`codex/docs/implementation/patch-surface.md:651-684`), but current code is `unwrap_or(false)` (`codex-rs/core/src/config/mod.rs:3576`). That mismatch must be corrected so the registry stops telling the rebase operator to re-apply a patch that is no longer live.

### Suggested follow-up task

Yes — this should be a dedicated follow-up impl task, because it spans:

- multiple upstream-canonical source files,
- `patch-surface.md`,
- likely `audit_invariants.sh` / other guards,
- and a reconciliation pass over which recent divergences are still live vs intentionally reverted.

## Read-only guard

### Start snapshot

- `codexu` root already had many pre-existing modified/untracked files; the root also already showed `M codex`.
- `codex/` already had pre-existing overlay edits and `M external/repos/codex-patched`.
- `codex/external/repos/codex-patched/` already had pre-existing `?? .worktrees/`.

Captured start output:

- root status preview at `C:\Users\evmitran\AppData\Local\Temp\copilot-tool-output-1781253470412-c19p6g.txt:1-140`
- codex status at `...c19p6g.txt:691-703`
- patched status at `...c19p6g.txt:704-705`

### End snapshot

Re-run the three required `git status --porcelain` commands after writing this file and confirm that the only **new** path introduced by this investigation is:

- `.ralph/investigations/codex-fork-patch-marking-and-divergence-audit/findings.md`
