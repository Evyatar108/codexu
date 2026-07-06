# `sources/fork/` — happy-app fork overlay modules

This directory is the happy-app analog of the codex engine's overlay-crate +
`// SANDBOX PATCH:` discipline, and of `packages/happy-cli/src/fork/` /
`packages/happy-server/sources/fork/` in this repo.

## Why this exists

The fork ([Evyatar108/happy](https://github.com/Evyatar108/happy)) targets an
Android e-ink tablet and carries UX/perf divergences from upstream
(`slopus/happy`). Every one of those divergences that lives *inline* inside an
upstream-canonical component becomes a merge-conflict hotspot the next time we
rebase onto upstream.

To keep the conflict surface small, the fork's divergent logic is **relocated
into fork-owned modules under `sources/fork/`**, and the upstream-canonical
component keeps only a **thin seam call** plus a single `// FORK PATCH: [R8...]`
marker. The canonical file therefore stays close to upstream shape, so an
upstream rebase touches it minimally (ideally not at all), and the fork logic
is quarantined where upstream never edits.

This is the "seam extraction" pattern:

```
upstream-canonical file  ──(thin seam call + // FORK PATCH marker)──▶  sources/fork/<area>/<module>
```

## Marker convention

A relocated divergence leaves exactly one representative marker at the seam
entry point in the canonical file:

```ts
// FORK PATCH: [RESTORE-R8<x>] <one-line reason> (invariant HA-<n>)
// Logic relocated to sources/fork/<area>/<module>; see docs/happy-patch-surface.md.
```

The `(invariant HA-<n>)` token stays on the same line as `FORK PATCH:` so the
[`scripts/audit-happy-fork-patches.mjs`](../../../../scripts/audit-happy-fork-patches.mjs)
cross-check resolves the invariant ID from the marker line itself.

- `[RESTORE-R8d]` = "this hunk is a fork DIVERGENCE; to return to upstream,
  DELETE the seam and re-inline nothing (the fork owns the behavior)". It is the
  happy-app counterpart of the server/cli `[RESTORE-R3-done]` style markers.
- One marker per largely-rewritten file (not one per moved symbol).

## Layout

R8 stage 1 introduces the `markdown/` overlay (MarkdownView, catalogue HA-8);
R8 stage 2 adds the `chat/` overlay (ChatList, catalogue HA-5); R8 stage 3
adds the `message/` overlay (MessageView, catalogue HA-9); R8 stage 4 adds the
`agentInput/` overlay (AgentInput, catalogue HA-6):

| Subdir | Overlay for | Catalogue rows |
|---|---|---|
| `markdown/` | `components/markdown/MarkdownView.tsx` | HA-8 |
| `chat/` | `components/ChatList.tsx` | HA-5 |
| `message/` | `components/MessageView.tsx` | HA-9 |
| `agentInput/` | `components/AgentInput.tsx` | HA-6 |

Later R8 stages add sibling overlays as they land (e.g. `session/` for
SessionView, `sidebar/` for the sidebar trio).
Create a sibling subdir when the stage that needs it lands — do not scaffold
empty directories ahead of use.

## Source of truth

The full KEEP / DISABLE / KEEP-DELETED catalogue for every fork divergence
(happy-app HA-*, happy-server HS-*, happy-cli HC-*) lives in
[`docs/happy-patch-surface.md`](../../../../docs/happy-patch-surface.md). Every
module in this directory is cross-referenced from an HA-5 / HA-6 / HA-8 / HA-9 row there.
