import { describe, expect, it } from 'vitest';
import { filterMcpServersByToolGating } from './mcpServerGating';

// Gap 8 (codex-agent-parity-audit.md) — partial codex-side allowedTools /
// disallowedTools parity. Whole-server granularity; per-tool-within-server
// filtering is deferred to a follow-up overlay crate.

describe('filterMcpServersByToolGating (Gap 8)', () => {
    const servers = {
        happy: { command: 'happy-mcp' },
        github: { command: 'gh-mcp' },
        filesystem: { command: 'fs-mcp' },
    };

    it('returns mcpServers unchanged when both lists are absent', () => {
        const out = filterMcpServersByToolGating(servers, {});
        expect(out).toEqual(servers);
    });

    it('returns mcpServers unchanged when both lists are empty', () => {
        const out = filterMcpServersByToolGating(servers, { allowedTools: [], disallowedTools: [] });
        expect(out).toEqual(servers);
    });

    it('drops a whole server matched by the bare server name in disallowedTools', () => {
        const out = filterMcpServersByToolGating(servers, { disallowedTools: ['happy'] });
        expect(Object.keys(out)).toEqual(['github', 'filesystem']);
    });

    it('drops a whole server matched by <server>.* in disallowedTools (acceptance criterion)', () => {
        const out = filterMcpServersByToolGating(servers, { disallowedTools: ['happy.*'] });
        expect(Object.keys(out)).toEqual(['github', 'filesystem']);
    });

    it('does NOT drop a server when only a per-tool disallow pattern matches it', () => {
        // happy.someTool only forbids that single tool — the partial fix
        // intentionally cannot filter inside an MCP server, so over-dropping
        // the whole server here would be a regression.
        const out = filterMcpServersByToolGating(servers, { disallowedTools: ['happy.someTool'] });
        expect(Object.keys(out)).toEqual(['happy', 'github', 'filesystem']);
    });

    it('drops every server not mentioned by allowedTools when allowedTools is non-empty', () => {
        const out = filterMcpServersByToolGating(servers, { allowedTools: ['happy.*'] });
        expect(Object.keys(out)).toEqual(['happy']);
    });

    it('keeps a server when allowedTools mentions any of its tools', () => {
        // happy.someTool implies the happy server stays reachable so the
        // model can attempt that call — even though the partial filter
        // cannot restrict to only that tool.
        const out = filterMcpServersByToolGating(servers, { allowedTools: ['happy.someTool', 'github'] });
        expect(Object.keys(out)).toEqual(['happy', 'github']);
    });

    it('applies allow + deny together; explicit deny wins over implicit allow', () => {
        const out = filterMcpServersByToolGating(servers, {
            allowedTools: ['happy.*', 'github'],
            disallowedTools: ['github'],
        });
        expect(Object.keys(out)).toEqual(['happy']);
    });

    it('does not mutate the input object', () => {
        const input = { ...servers };
        filterMcpServersByToolGating(input, { disallowedTools: ['happy'] });
        expect(input).toEqual(servers);
    });
});
