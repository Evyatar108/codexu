# Code Review Context (job ralph-pipeline-09-mcp)

## Patterns observed

- The repo's MCP packages use `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`, with stdio transport wired in `src/index.ts` and tool handlers returning `{ content: [{ type: 'text', text }] }`. The new `tools/overview-mcp/src/server.ts` matches that contract via `toToolResult()` in `tools/read-only.ts`.
- All path resolution flows through `scripts/lib/resolve-config.mjs` (`config.outputs.snapshot`, `config.dataFile`, `config.outputs.sidecarJson`, `config.outputs.recommendationsJson`, `config.crewsRoot`) — no hard-coded `plans/*` paths anywhere in the new package.
- `scripts/lib/append-journal.mjs` was extended additively: `appendJournalEntry()` (stage transitions) and `formatJournalLine()` are unchanged; new `appendJournalNote()` formats `- <ts>  note: <body>` with `\n  ` continuation, and `assertSafeTaskId` is now exported for shared validation.
- TypeScript/Zod surface uses `zod/v3` compatibility shim from `@modelcontextprotocol/sdk/server/zod-compat.js` even though the package depends on `zod@^4.1.13`. This works because the SDK accepts both shapes; flagged below as a quality concern.

## Cross-cutting concerns

- `SnapshotReader` (`tools/overview-mcp/src/snapshot-reader.ts`) uses a single torn-write retry (100ms) before falling back to cached/null. Plan called for up to three retries.
- `tools/overview-mcp/src/types.ts` re-declares `Snapshot`, `SnapshotTask`, `Recommendation`, etc. locally instead of `type`-only-importing from `tools/overview-viewer/src/types.ts`. Mild drift risk.
- The `transcriptPath` flow for `get_transcript` depends on `discoverCrewSessions()` propagating it from the manifest (verified — `crews-cross-walk.mjs:209,221`), and `listCrewSessions` keeps it via the `...entry` spread. The risk surfaces only when the snapshot's cached `crewSessions` entry was emitted before the manifest gained a `transcriptPath`; `liveFields()` does not re-introduce it.
- `recommendationsJson` fallback parser accepts both `Array<Recommendation>` and `{ recommendations: [...] }` shapes — defensive but undocumented.

## File relationships

- `tools/overview-mcp/src/tools/get-transcript.ts` calls `listCrewSessions(context, {})` (full discovery) to map `sessionId -> transcriptPath`, sharing the 500ms `WeakMap` cache.
- `tools/overview-mcp/src/tools/invoke-next.ts` uses dynamic `import()` for `scripts/lib/work-on-via-crew.mjs` per F-007, and the test seam (`__setWorkOnViaCrewModuleLoaderForTest`) replaces the loader.
- `tools/overview-mcp/src/utils/set-override-edit.ts` is a pure source-string splice helper; `tools/set-override.ts` re-parses the edited source via `parseOverviewDataAssignment()` before writing — good defensive layering.
