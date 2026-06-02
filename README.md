# codexu

> **Multi-device + multi-agent stack built around the codex engine.**
> CLI, app, server, and personal plugin — all consuming a patched
> codex fork as the runtime. The engine fork is pinned as a git submodule at
> [`codex/`](./codex) (target repo: `gim-home/codex`), and the shared agent
> tooling is pinned as [`ai-developer-toolkit/`](./ai-developer-toolkit).

> **Rebrand status (2026-05-03):** package-level rebrand from
> `happy-*` → `codexu-*` was attempted then reverted to enable a clean
> upstream merge with `slopus/happy`. Internal package directories
> (`packages/happy-{cli,app,server,agent,wire,app-logs}`) are
> intentionally back to their `happy-*` names. Re-attempt deferred until
> upstream merge cadence stabilizes (or until tracking is dropped). The
> NEW `packages/codexu-plugin/` and the `codexu` repo name itself stay.

## What this is

Codexu is the consumer-facing surface for a personal AI-coding stack:

- **happy-cli** (npm: `happy`) — terminal entry point + ink renderer;
  talks to a codex app-server over stdio/ws.
- **happy-app** — mobile + web client (Expo / React Native) that
  attaches to the same app-server from any device.
- **happy-server** — backend for cross-device sync and push.
- **happy-agent** — remote agent control CLI (create, send, monitor
  sessions).
- **happy-wire** (npm: `@slopus/happy-wire`) — shared zod schemas +
  message types.
- **codexu-plugin** — personal codex plugin (skills, hooks,
  AskUserQuestion-using workflows). Installed via `codex plugin
  marketplace add`. NEW; not part of upstream slopus/happy.

The codex engine lives in a separate private repo (`gim-home/codex`)
pinned as a git submodule at [`codex/`](./codex). The Ralph/crews/overview
plugin sources live in the [`ai-developer-toolkit/`](./ai-developer-toolkit)
submodule. On a fresh clone, run `git submodule update --init --recursive` to
populate both. The codex submodule requires authenticated access to the
`gim-home` GitHub org; the toolkit submodule is sourced from
`https://github.com/evmitran_microsoft/ai-developer-toolkit.git`. Local git
credentials must point at users with the needed repo access (e.g. via
`gh auth switch`).

[Evyatar108/codex-patched](https://github.com/Evyatar108/codex-patched)
remains as an optional public mirror for openai/codex absorption
tracking, but codexu does NOT pin it. Public-mirror sync (gim-home
→ codex-patched) is now a "nice to have" rather than a release
blocker.

## Roadmap

The big picture lives in
[`plans/codexu-roadmap.md`](plans/codexu-roadmap.md). It covers:

- multi-device session continuity (Phase 1b)
- personal codex plugin scaffolding (Phase 1c)
- codex divergences for `scope = "host"` plugins, AskUserQuestion, queueing
  (Phase 2)
- ralph + options-mode plugin migration to codex (Phase 3)
- coexistence verification (Phase 4)
- drop Claude Code (Phase 5)
- long-lived teammates (Phase 6)
- Claude-via-Copilot adapter (Phase 7, deferred)

### Roadmap viewer

The interactive roadmap viewer is generated from
[`.ralph-overview/data.json`](.ralph-overview/data.json). For local development with
Vite/HMR, run:

```bash
pnpm overview
```

The dev server listens on `http://localhost:5173`. To rebuild the static
single-file artifact at [`.ralph-overview/generated/overview.html`](.ralph-overview/generated/overview.html), run:

```bash
pnpm overview:build
```

## Heritage

Codexu is a fork of [slopus/happy](https://github.com/slopus/happy)
diverging toward a codex-only direction (GitHub-OAuth via Microsoft Dev
Tunnels replacing the encrypted relay; codex app-server replacing the
Claude Code wrapper as the primary runtime). Active upstream tracking
resumed 2026-05-03 — first sync absorbed 79 commits (codium plugin
system, theme system, Codex OAuth, `@pierre/diffs` rendering, model
adds, init-hang fix). Long-term divergence direction unchanged.

## Status

Pre-release. Personal use first. Public catalog promotion deferred until
content stabilizes.

## License

MIT — see [LICENSE](LICENSE).
