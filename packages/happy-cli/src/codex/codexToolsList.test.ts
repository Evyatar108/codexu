import { describe, expect, it } from 'vitest';
import { synthesizeCodexTools } from './codexToolsList';

// Gap 12 (codex-agent-parity-audit.md) — codex has no system.init tools[]
// equivalent, so happy-cli synthesizes one from the resolved mcpServers
// keys plus the codex built-ins (shell, apply_patch, update_plan).

describe('synthesizeCodexTools (Gap 12)', () => {
    it('returns codex built-ins plus mcp server keys', () => {
        const tools = synthesizeCodexTools({
            happy: { command: 'happy-mcp' },
            github: { command: 'gh-mcp' },
        });
        // Acceptance: at least the happy bridge plus codex built-ins.
        expect(tools).toContain('happy');
        expect(tools).toContain('shell');
        expect(tools).toContain('apply_patch');
        expect(tools).toContain('update_plan');
        expect(tools).toContain('github');
    });

    it('includes only built-ins when mcpServers is empty', () => {
        expect(synthesizeCodexTools({})).toEqual(['shell', 'apply_patch', 'update_plan']);
    });

    it('places built-ins first in deterministic order', () => {
        const tools = synthesizeCodexTools({ zeta: {}, alpha: {} });
        expect(tools.slice(0, 3)).toEqual(['shell', 'apply_patch', 'update_plan']);
        // mcp keys sorted lexically after built-ins (deterministic for metadata diffing).
        expect(tools.slice(3)).toEqual(['alpha', 'zeta']);
    });

    it('de-duplicates if an mcp server name collides with a built-in', () => {
        const tools = synthesizeCodexTools({ shell: { command: 'fake' }, custom: {} });
        const shellCount = tools.filter((t) => t === 'shell').length;
        expect(shellCount).toBe(1);
        expect(tools).toContain('custom');
    });
});
