# CLAUDE.md

This repo normally uses `AGENTS.md` for fork-level guidance because root `CLAUDE.md` is ignored upstream. This file exists for local Claude Code sessions and carries the ralph-overview v2.1.0 coordination notes that are easy to miss.

## Common confusion points

- N concurrent Claude Code sessions per repo is supported as of ralph-overview v2.1.0; the first MCP to claim the marker becomes the active watcher; other MCPs are passive consumers. Use the `mcp__ralph-overview__overview_watcher_status` tool to check active-vs-passive state. The dev server is operator-launched via `pnpm overview:dev` from the codexu root, NOT via an MCP tool (`overview.dev_server.*` was removed in v2.1.0).
