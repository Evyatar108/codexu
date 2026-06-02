/**
 * Story 2 unit tests for the codex MCP-notification consumer.
 *
 * Covers AC2.1–AC2.7 from
 * `.ralph/jobs/codex-channels-option-b/plan.md` §5.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMcpNotificationConsumer, type PromptQueuePusher } from './mcpNotificationConsumer';
import {
    loadMcpNotificationRouting,
    type McpNotificationRoutingConfig,
} from './mcpNotificationRouting';

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    },
}));

interface FakeMode {
    permissionMode: 'default';
}

type Pushed = { message: string; mode: FakeMode };

function makeQueue(): { pushes: Pushed[]; queue: PromptQueuePusher<FakeMode> } {
    const pushes: Pushed[] = [];
    return {
        pushes,
        queue: {
            push(message, mode) {
                pushes.push({ message, mode });
            },
        },
    };
}

function makeMode(): () => FakeMode {
    return () => ({ permissionMode: 'default' });
}

// All ACs except 2.4 use the real-time default clock; 2.4 swaps in fake timers.

describe('createMcpNotificationConsumer', () => {
    let enabledRouting: McpNotificationRoutingConfig;
    beforeEach(() => {
        vi.clearAllMocks();
        enabledRouting = loadMcpNotificationRouting({ enabled: true });
    });

    // AC2.1
    it('tool_list_changed with default routing pushes a synthesized message', () => {
        const { pushes, queue } = makeQueue();
        const consumer = createMcpNotificationConsumer({
            routing: enabledRouting,
            messageQueue: queue,
            currentMode: makeMode(),
        });
        consumer.handle({
            type: 'mcp_server_notification',
            server_name: 'tools-srv',
            kind: 'tool_list_changed',
            params: {},
        });
        expect(pushes).toHaveLength(1);
        expect(pushes[0].message).toBe('[mcp:tools-srv] tool list changed; re-check available tools');
        expect(pushes[0].mode.permissionMode).toBe('default');
    });

    // AC2.2
    it('progress with default routing does not push', () => {
        const { pushes, queue } = makeQueue();
        const consumer = createMcpNotificationConsumer({
            routing: enabledRouting,
            messageQueue: queue,
            currentMode: makeMode(),
        });
        consumer.handle({
            type: 'mcp_server_notification',
            server_name: 'noisy-srv',
            kind: 'progress',
            params: { progress: 1, total: 10 },
        });
        expect(pushes).toHaveLength(0);
    });

    // AC2.3
    it('per-server override of progress to prompt-queue pushes for that server only', () => {
        const routing = loadMcpNotificationRouting({
            enabled: true,
            perServer: {
                'opt-in-srv': {
                    progress: {
                        type: 'prompt-queue',
                        template: '[{server}] progress {summary}',
                    },
                },
            },
        });
        const { pushes, queue } = makeQueue();
        const consumer = createMcpNotificationConsumer({
            routing,
            messageQueue: queue,
            currentMode: makeMode(),
        });
        consumer.handle({
            type: 'mcp_server_notification',
            server_name: 'opt-in-srv',
            kind: 'progress',
            params: { progressToken: 'tok', progress: 2, total: 5 },
        });
        consumer.handle({
            type: 'mcp_server_notification',
            server_name: 'other-srv',
            kind: 'progress',
            params: { progressToken: 'tok', progress: 3 },
        });
        expect(pushes).toHaveLength(1);
        expect(pushes[0].message).toBe('[opt-in-srv] progress tok 2/5');
    });

    // AC2.4
    it('resource_updated debouncing collapses 5 rapid pushes for the same URI within 250ms into 1', () => {
        vi.useFakeTimers();
        try {
            const { pushes, queue } = makeQueue();
            const consumer = createMcpNotificationConsumer({
                routing: enabledRouting,
                messageQueue: queue,
                currentMode: makeMode(),
            });
            for (let i = 0; i < 5; i += 1) {
                consumer.handle({
                    type: 'mcp_server_notification',
                    server_name: 'fs-srv',
                    kind: 'resource_updated',
                    params: { uri: 'file:///workspace/notes.md' },
                });
                // Each within the 250 ms window — each call resets the timer.
                vi.advanceTimersByTime(40);
            }
            // Still inside the debounce window of the most recent push.
            expect(pushes).toHaveLength(0);
            // Cross the 250 ms boundary.
            vi.advanceTimersByTime(300);
            expect(pushes).toHaveLength(1);
            expect(pushes[0].message).toBe(
                '[mcp:fs-srv] resource updated: file:///workspace/notes.md',
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('resource_updated debouncing keys by URI: distinct URIs each fire after their own delay', () => {
        vi.useFakeTimers();
        try {
            const { pushes, queue } = makeQueue();
            const consumer = createMcpNotificationConsumer({
                routing: enabledRouting,
                messageQueue: queue,
                currentMode: makeMode(),
            });
            consumer.handle({
                type: 'mcp_server_notification',
                server_name: 'fs-srv',
                kind: 'resource_updated',
                params: { uri: 'file:///a.txt' },
            });
            consumer.handle({
                type: 'mcp_server_notification',
                server_name: 'fs-srv',
                kind: 'resource_updated',
                params: { uri: 'file:///b.txt' },
            });
            vi.advanceTimersByTime(300);
            expect(pushes.map((p) => p.message).sort()).toEqual([
                '[mcp:fs-srv] resource updated: file:///a.txt',
                '[mcp:fs-srv] resource updated: file:///b.txt',
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    // AC2.5
    it('enabled:false produces zero pushes regardless of incoming kinds', () => {
        const disabled = loadMcpNotificationRouting({
            enabled: false,
            perServer: {
                'tools-srv': {
                    tool_list_changed: {
                        type: 'prompt-queue',
                        template: '[{server}] tool list changed (forced)',
                    },
                },
            },
        });
        const { pushes, queue } = makeQueue();
        const consumer = createMcpNotificationConsumer({
            routing: disabled,
            messageQueue: queue,
            currentMode: makeMode(),
        });
        for (const kind of [
            'progress',
            'tool_list_changed',
            'resource_updated',
            'resource_list_changed',
        ] as const) {
            consumer.handle({
                type: 'mcp_server_notification',
                server_name: 'tools-srv',
                kind,
                params: kind === 'resource_updated' ? { uri: 'file:///x' } : {},
            });
        }
        expect(pushes).toHaveLength(0);
    });

    // AC2.6
    it('mcp_sampling_request logs once-per-server-per-session and does not push or throw', async () => {
        const { logger } = await import('@/ui/logger');
        const warnSpy = logger.warn as ReturnType<typeof vi.fn>;
        const { pushes, queue } = makeQueue();
        const consumer = createMcpNotificationConsumer({
            routing: enabledRouting,
            messageQueue: queue,
            currentMode: makeMode(),
        });
        expect(() => {
            for (let i = 0; i < 3; i += 1) {
                consumer.handle({
                    type: 'mcp_sampling_request',
                    server_name: 'sampling-srv',
                    request_id: i,
                    params: {},
                });
            }
            consumer.handle({
                type: 'mcp_sampling_request',
                server_name: 'other-sampling-srv',
                request_id: 42,
                params: {},
            });
        }).not.toThrow();
        expect(pushes).toHaveLength(0);
        // Two unique servers → exactly two warn lines.
        const samplingWarnings = warnSpy.mock.calls.filter((c) =>
            String(c[0]).includes('mcp_sampling_request'),
        );
        expect(samplingWarnings).toHaveLength(2);
    });

    // AC2.7
    it('unknown event types are silently ignored', () => {
        const { pushes, queue } = makeQueue();
        const consumer = createMcpNotificationConsumer({
            routing: enabledRouting,
            messageQueue: queue,
            currentMode: makeMode(),
        });
        expect(() => {
            consumer.handle({ type: 'mcp_future_kind', payload: { anything: 1 } });
            consumer.handle({ type: 'task_started' });
            consumer.handle({});
        }).not.toThrow();
        expect(pushes).toHaveLength(0);
    });

    it('unknown McpNotificationKind values inside a known event type are dropped without push', () => {
        const { pushes, queue } = makeQueue();
        const consumer = createMcpNotificationConsumer({
            routing: enabledRouting,
            messageQueue: queue,
            currentMode: makeMode(),
        });
        consumer.handle({
            type: 'mcp_server_notification',
            server_name: 'srv',
            kind: 'completely_invented',
            params: {},
        });
        expect(pushes).toHaveLength(0);
    });

    it('drops notifications with empty server_name', () => {
        const { pushes, queue } = makeQueue();
        const consumer = createMcpNotificationConsumer({
            routing: enabledRouting,
            messageQueue: queue,
            currentMode: makeMode(),
        });
        consumer.handle({
            type: 'mcp_server_notification',
            server_name: '',
            kind: 'tool_list_changed',
            params: {},
        });
        consumer.handle({
            type: 'mcp_server_notification',
            kind: 'tool_list_changed',
            params: {},
        });
        expect(pushes).toHaveLength(0);
    });

    it('malformed params do not crash the consumer (template synthesis is wrapped)', () => {
        // Force a template-render failure by patching the routing to use a
        // template that triggers .replace on a non-string (impossible via the
        // public API; simulate by hand-crafting routing with a broken template
        // value). The wrapper falls back to a (synthesis error: see logs) line.
        const broken: McpNotificationRoutingConfig = {
            enabled: true,
            defaults: { ...enabledRouting.defaults },
            perServer: {},
        };
        broken.defaults.tool_list_changed = {
            type: 'prompt-queue',
            // @ts-expect-error — deliberate runtime breakage for the catch path.
            template: 42,
        };
        const { pushes, queue } = makeQueue();
        const consumer = createMcpNotificationConsumer({
            routing: broken,
            messageQueue: queue,
            currentMode: makeMode(),
        });
        expect(() => {
            consumer.handle({
                type: 'mcp_server_notification',
                server_name: 'srv',
                kind: 'tool_list_changed',
                params: {},
            });
        }).not.toThrow();
        expect(pushes).toHaveLength(1);
        expect(pushes[0].message).toContain('synthesis error');
    });

    it('dispose() clears pending debounce timers so no late push fires', () => {
        vi.useFakeTimers();
        try {
            const { pushes, queue } = makeQueue();
            const consumer = createMcpNotificationConsumer({
                routing: enabledRouting,
                messageQueue: queue,
                currentMode: makeMode(),
            });
            consumer.handle({
                type: 'mcp_server_notification',
                server_name: 'fs',
                kind: 'resource_updated',
                params: { uri: 'file:///pending.md' },
            });
            consumer.dispose();
            vi.advanceTimersByTime(10_000);
            expect(pushes).toHaveLength(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
