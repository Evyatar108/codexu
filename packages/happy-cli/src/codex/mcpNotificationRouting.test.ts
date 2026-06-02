/**
 * Story 1 unit tests for codex MCP-notification routing config.
 *
 * Covers AC1.1 (defaults), AC1.2 (per-server override), AC1.3 (unknown
 * kind warns and is dropped), AC1.4 (enabled:false short-circuits).
 *
 * Plan: .ralph/jobs/codex-channels-option-b/plan.md §5 (Story 1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    DEFAULT_MCP_NOTIFICATION_ROUTING,
    extractNotificationSummary,
    loadMcpNotificationRouting,
    MCP_NOTIFICATION_KINDS,
    renderNotificationTemplate,
    resolveRoute,
} from './mcpNotificationRouting';

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    },
}));

describe('loadMcpNotificationRouting', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // AC1.1
    it('returns disabled config with full default routing table when input is undefined', () => {
        const config = loadMcpNotificationRouting(undefined);
        expect(config.enabled).toBe(false);
        for (const kind of MCP_NOTIFICATION_KINDS) {
            expect(config.defaults[kind]).toEqual(DEFAULT_MCP_NOTIFICATION_ROUTING[kind]);
        }
        expect(config.perServer).toEqual({});
    });

    it('returns disabled config when input is null or non-object', () => {
        expect(loadMcpNotificationRouting(null).enabled).toBe(false);
        expect(loadMcpNotificationRouting('garbage').enabled).toBe(false);
        expect(loadMcpNotificationRouting(42).enabled).toBe(false);
    });

    // AC1.2
    it('per-server overrides only the listed kinds; other kinds inherit defaults', () => {
        const config = loadMcpNotificationRouting({
            enabled: true,
            perServer: {
                'filewatch-server': {
                    progress: { type: 'prompt-queue' },
                },
            },
        });
        expect(resolveRoute(config, 'filewatch-server', 'progress')).toEqual({ type: 'prompt-queue' });
        // progress for a different server still uses the default (display-only)
        expect(resolveRoute(config, 'other-server', 'progress')).toEqual({ type: 'display-only' });
        // Unlisted kinds on the override server still inherit defaults
        expect(resolveRoute(config, 'filewatch-server', 'tool_list_changed')).toEqual(
            DEFAULT_MCP_NOTIFICATION_ROUTING.tool_list_changed,
        );
    });

    it('user defaults overlay onto built-in defaults; unspecified kinds keep built-ins', () => {
        const config = loadMcpNotificationRouting({
            enabled: true,
            defaults: {
                progress: { type: 'prompt-queue', debounceMs: 1000 },
            },
        });
        expect(config.defaults.progress).toEqual({ type: 'prompt-queue', debounceMs: 1000 });
        // unchanged
        expect(config.defaults.cancelled).toEqual(DEFAULT_MCP_NOTIFICATION_ROUTING.cancelled);
        expect(config.defaults.tool_list_changed).toEqual(
            DEFAULT_MCP_NOTIFICATION_ROUTING.tool_list_changed,
        );
    });

    // AC1.3
    it('unknown kinds in user config are warn-logged and ignored (no throw)', async () => {
        const { logger } = await import('@/ui/logger');
        const debugSpy = logger.debug as ReturnType<typeof vi.fn>;
        expect(() => {
            loadMcpNotificationRouting({
                enabled: true,
                defaults: {
                    progress: { type: 'prompt-queue' },
                    completely_new_kind: { type: 'prompt-queue' },
                },
                perServer: {
                    foo: {
                        another_bogus_kind: { type: 'display-only' },
                    },
                },
            });
        }).not.toThrow();
        const messages = debugSpy.mock.calls.map((c) => String(c[0]));
        expect(messages.some((m) => m.includes('completely_new_kind'))).toBe(true);
        expect(messages.some((m) => m.includes('another_bogus_kind'))).toBe(true);
    });

    it('malformed route entries are dropped silently rather than throwing', () => {
        const config = loadMcpNotificationRouting({
            enabled: true,
            defaults: {
                // wrong type, no `type` field at all, etc.
                progress: { foo: 'bar' },
                cancelled: 'not-an-object',
                resource_updated: { type: 'invented-mode' },
            },
        });
        // All three rejects → defaults preserved.
        expect(config.defaults.progress).toEqual(DEFAULT_MCP_NOTIFICATION_ROUTING.progress);
        expect(config.defaults.cancelled).toEqual(DEFAULT_MCP_NOTIFICATION_ROUTING.cancelled);
        expect(config.defaults.resource_updated).toEqual(
            DEFAULT_MCP_NOTIFICATION_ROUTING.resource_updated,
        );
    });

    // AC1.4 — short-circuit semantics are enforced by the consumer, but the
    // config object itself must still hand back the overrides faithfully so
    // a UI / debug tool can inspect them even when disabled.
    it('enabled:false preserves per-server overrides in the parsed config', () => {
        const config = loadMcpNotificationRouting({
            enabled: false,
            perServer: {
                'srv-1': { tool_list_changed: { type: 'display-only' } },
            },
        });
        expect(config.enabled).toBe(false);
        expect(config.perServer['srv-1']?.tool_list_changed).toEqual({ type: 'display-only' });
    });

    it('prompt-queue routes accept debounceMs and template as optional fields', () => {
        const config = loadMcpNotificationRouting({
            enabled: true,
            defaults: {
                resource_updated: {
                    type: 'prompt-queue',
                    debounceMs: 500,
                    template: 'custom {server}/{uri}',
                },
            },
        });
        const route = config.defaults.resource_updated;
        expect(route.type).toBe('prompt-queue');
        if (route.type !== 'prompt-queue') throw new Error('unreachable');
        expect(route.debounceMs).toBe(500);
        expect(route.template).toBe('custom {server}/{uri}');
    });

    it('debounceMs is coerced to undefined when negative or non-numeric', () => {
        const config = loadMcpNotificationRouting({
            enabled: true,
            defaults: {
                resource_updated: {
                    type: 'prompt-queue',
                    debounceMs: -1,
                },
                tool_list_changed: {
                    type: 'prompt-queue',
                    debounceMs: 'soon',
                },
            },
        });
        if (config.defaults.resource_updated.type !== 'prompt-queue') throw new Error('unreachable');
        if (config.defaults.tool_list_changed.type !== 'prompt-queue') throw new Error('unreachable');
        expect(config.defaults.resource_updated.debounceMs).toBeUndefined();
        expect(config.defaults.tool_list_changed.debounceMs).toBeUndefined();
    });
});

describe('extractNotificationSummary', () => {
    it('extracts uri for resource_updated', () => {
        expect(extractNotificationSummary('resource_updated', { uri: 'file:///a/b.txt' })).toBe(
            'file:///a/b.txt',
        );
    });

    it('formats logging_message as "level: data"', () => {
        expect(
            extractNotificationSummary('logging_message', { level: 'warn', data: 'oops' }),
        ).toBe('warn: oops');
    });

    it('formats progress with token and total', () => {
        expect(
            extractNotificationSummary('progress', {
                progressToken: 'job-1',
                progress: 5,
                total: 10,
            }),
        ).toBe('job-1 5/10');
    });

    it('returns empty string when params is missing', () => {
        expect(extractNotificationSummary('progress', undefined)).toBe('');
        expect(extractNotificationSummary('progress', null)).toBe('');
    });

    it('caps long output at 200 chars (with ellipsis)', () => {
        const longUri = `file:///${'x'.repeat(500)}`;
        const summary = extractNotificationSummary('resource_updated', { uri: longUri });
        expect(summary.length).toBeLessThanOrEqual(200);
        expect(summary.endsWith('…')).toBe(true);
    });

    it('collapses internal whitespace to single spaces', () => {
        expect(
            extractNotificationSummary('logging_message', {
                level: 'info',
                data: 'a   b\n c\t d',
            }),
        ).toBe('info: a b c d');
    });
});

describe('renderNotificationTemplate', () => {
    it('substitutes {server}, {kind}, {uri}, {summary} placeholders', () => {
        const out = renderNotificationTemplate(
            '[mcp:{server}] {kind} -> {uri} ({summary})',
            'srv-x',
            'resource_updated',
            { uri: 'file:///z.md' },
        );
        expect(out).toBe('[mcp:srv-x] resource_updated -> file:///z.md (file:///z.md)');
    });

    it('uses the fallback template when no template is provided', () => {
        const out = renderNotificationTemplate(undefined, 'srv-y', 'progress', {
            progressToken: 't',
            progress: 1,
            total: 4,
        });
        expect(out).toBe('[mcp:srv-y] progress: t 1/4');
    });

    it('renders empty uri when params has no uri field', () => {
        const out = renderNotificationTemplate(
            '{server}|{uri}',
            's',
            'tool_list_changed',
            {},
        );
        expect(out).toBe('s|');
    });
});
