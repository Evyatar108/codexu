/**
 * Scope B integration fixtures for the "Durable mailbox + channel wake" pattern
 * (US-006, D-002). Two contracts are pinned here end-to-end:
 *
 *  1. Happy-path "you have mail" round-trip — session A calls the
 *     `agent_comms.send` MCP tool on its bridge, the daemon hop writes B's
 *     durable inbox, B's bridge emits a `resource_updated` wake, B's real
 *     `mcpNotificationConsumer` routes a single wake prompt into B's queue, and
 *     B drains the durable inbox via the agent-comms resource read (cursor
 *     advances only after the entries are returned). A is never self-woken.
 *
 *  2. Missed-wake recovery — a message is written to B's inbox while B has no
 *     consumer/wake running; on "restart" the exported recovery helper re-reads
 *     the inbox and pushes ONE wake WITHOUT consuming, and only the explicit
 *     resource drain consumes the message. No notification replay is involved.
 *
 * Real `writeJsonAtomically` writes are used throughout (no mocks-as-main-proof).
 * The only synthesized piece is the codex `mcp_server_notification` event fed to
 * the consumer — we cannot boot a real codex app-server in a unit test, so we
 * synthesize the exact event shape the bridge's watcher would cause codex to
 * forward (see mcpNotificationConsumer.ts).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TrackedSession } from '@/daemon/types';

const tempHome = fsSync.mkdtempSync(path.join(tmpdir(), 'happy-scopeb-test-'));
process.env.HAPPY_HOME_DIR = tempHome;

let mailbox: typeof import('./mailbox');
let bridge: typeof import('@/codex/agentCommsBridge');
let recovery: typeof import('./recovery');
let controlServer: typeof import('@/daemon/controlServer');
let controlClient: typeof import('@/daemon/controlClient');
let persistence: typeof import('@/persistence');
let consumerMod: typeof import('@/codex/mcpNotificationConsumer');
let routingMod: typeof import('@/codex/mcpNotificationRouting');
let MessageQueue2Mod: typeof import('@/utils/MessageQueue2');

let server: { port: number; stop: () => Promise<void> };

// Every session id used must be "tracked" for the daemon route to accept it.
const TRACKED_IDS = ['sessA', 'sessB', 'sessA2', 'sessB2'];
const trackedSessions = TRACKED_IDS.map(id => ({
    startedBy: 'test',
    happySessionId: id,
    pid: process.pid,
})) as unknown as TrackedSession[];

const liveHandles: { dispose(): void }[] = [];
const rmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 };

beforeAll(async () => {
    mailbox = await import('./mailbox');
    bridge = await import('@/codex/agentCommsBridge');
    recovery = await import('./recovery');
    controlServer = await import('@/daemon/controlServer');
    controlClient = await import('@/daemon/controlClient');
    persistence = await import('@/persistence');
    consumerMod = await import('@/codex/mcpNotificationConsumer');
    routingMod = await import('@/codex/mcpNotificationRouting');
    MessageQueue2Mod = await import('@/utils/MessageQueue2');

    server = await controlServer.startDaemonControlServer({
        getChildren: () => trackedSessions,
        stopSession: () => true,
        spawnSession: (async () => ({ type: 'error', errorMessage: 'unused in tests' })) as never,
        requestShutdown: () => { /* noop */ },
        onHappySessionWebhook: () => { /* noop */ },
    });

    // Point daemonPost (used by controlClient.sendAgentMessage) at the test
    // control server, with the current process pid so its liveness check passes.
    persistence.writeDaemonState({
        pid: process.pid,
        httpPort: server.port,
        startTime: new Date().toISOString(),
        startedWithCliVersion: '0.0.0-test',
    });
});

afterAll(async () => {
    await server.stop();
    await fs.rm(tempHome, rmOptions);
});

afterEach(async () => {
    while (liveHandles.length > 0) {
        try { liveHandles.pop()!.dispose(); } catch { /* ignore */ }
    }
    await fs.rm(path.join(tempHome, 'agent-comms'), rmOptions);
});

interface CapturedMode { tag: string }
const MODE: CapturedMode = { tag: 'm' };

/** A minimal MCP server fake capturing the registered tool/resource handlers
 *  and every `sendResourceUpdated` URI. */
function makeFakeServer() {
    const tools = new Map<string, (args: any) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>>();
    const resources = new Map<string, (uri: URL, extra: unknown) => Promise<{ contents: { uri: string; mimeType?: string; text: string }[] }>>();
    const resourceUpdates: string[] = [];
    const fake = {
        registerTool: (name: string, _config: unknown, handler: (args: any) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>) => {
            tools.set(name, handler);
            return {};
        },
        registerResource: (name: string, uri: string, _config: unknown, cb: (uri: URL, extra: unknown) => Promise<{ contents: { uri: string; mimeType?: string; text: string }[] }>) => {
            resources.set(uri, cb);
            return {};
        },
        server: {
            sendResourceUpdated: (params: { uri: string }) => {
                resourceUpdates.push(params.uri);
                return Promise.resolve();
            },
        },
    };
    return {
        server: fake as unknown as Pick<McpServer, 'registerTool' | 'registerResource' | 'server'>,
        resourceUpdates,
        callTool: (name: string, args: any) => tools.get(name)!(args),
        readResource: (uri: string) => resources.get(uri)!(new URL(uri), {}),
    };
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (!pred()) {
        if (Date.now() - start > timeoutMs) return false;
        await new Promise(r => setTimeout(r, 20));
    }
    return true;
}

function makeConsumerQueue() {
    const queue = new MessageQueue2Mod.MessageQueue2<CapturedMode>(() => 'h');
    const routing = routingMod.loadMcpNotificationRouting({
        enabled: true,
        perServer: {
            happy: {
                resource_updated: { type: 'prompt-queue', debounceMs: 0, template: recovery.AGENT_COMMS_WAKE_PROMPT },
            },
        },
    });
    const consumer = consumerMod.createMcpNotificationConsumer({
        routing,
        messageQueue: queue,
        currentMode: () => MODE,
    });
    return { queue, consumer };
}

describe('Scope B happy-path round-trip', () => {
    it('A sends via the agent_comms.send tool; B is woken once and drains the message; A is not self-woken', async () => {
        const MSG = { kind: 'greeting', n: 42 };

        // A's bridge: send tool wired to the REAL daemon-hop sender.
        const a = makeFakeServer();
        const aHandle = bridge.registerAgentCommsBridge({ server: a.server, sessionId: 'sessA', sendMessage: controlClient.sendAgentMessage });
        liveHandles.push(aHandle);

        // A invokes the MCP tool targeting B -> sendAgentMessage -> daemon route -> mailbox.appendMessage.
        const toolResult = await a.callTool('agent_comms.send', { targetSessionId: 'sessB', body: MSG });
        expect(toolResult.isError).toBeFalsy();
        const ack = JSON.parse(toolResult.content[0].text) as { id: string; seq: number };
        expect(typeof ack.id).toBe('string');
        expect(ack.seq).toBe(1);

        // The daemon wrote B's inbox; A's inbox is untouched (deterministic no-self-write).
        const bPending = await mailbox.readPending('sessB');
        expect(bPending).toHaveLength(1);
        expect((bPending[0].body as any).body).toEqual(MSG);
        expect((bPending[0].body as any).scope).toBe('B');
        expect(bPending[0].sender).toBe('sessA');
        expect(await mailbox.readPending('sessA')).toEqual([]);

        // B's bridge arms AFTER the write: its non-consuming initial scan emits
        // exactly one wake for B's uri. A's bridge scanned an empty inbox -> no wake.
        const b = makeFakeServer();
        const bHandle = bridge.registerAgentCommsBridge({ server: b.server, sessionId: 'sessB', sendMessage: controlClient.sendAgentMessage });
        liveHandles.push(bHandle);
        expect(await waitFor(() => b.resourceUpdates.length > 0, 3000)).toBe(true);
        // Wake count may vary with debounce coalescing / OS watch-event delivery;
        // the invariant is that every wake B received is for B's OWN uri and that
        // A is never woken (A's inbox was never written).
        expect(b.resourceUpdates.every(u => u === bridge.agentCommsInboxUri('sessB'))).toBe(true);
        expect(a.resourceUpdates).toEqual([]); // no self-wake

        const wakesAfterFirst = b.resourceUpdates.length;
        // A live inbox write (second message) drives the real fs.watch -> a new wake.
        await controlClient.sendAgentMessage('sessB', { kind: 'second' }, 'sessA');
        expect(await waitFor(() => b.resourceUpdates.length > wakesAfterFirst, 3000)).toBe(true);
        expect(b.resourceUpdates.every(u => u === bridge.agentCommsInboxUri('sessB'))).toBe(true);
        expect(a.resourceUpdates).toEqual([]); // still no self-wake

        // Consumer side: the real mcpNotificationConsumer routes the synthesized
        // resource_updated event into B's queue as exactly ONE wake prompt (not
        // the default '[mcp:happy] resource updated: {uri}' and not per-message).
        const { queue: queueB, consumer: consumerB } = makeConsumerQueue();
        consumerB.handle({
            type: 'mcp_server_notification',
            server_name: 'happy',
            kind: 'resource_updated',
            params: { uri: bridge.agentCommsInboxUri('sessB') },
        });
        expect(queueB.queue).toHaveLength(1);
        expect(queueB.queue[0].message).toBe(recovery.AGENT_COMMS_WAKE_PROMPT);
        consumerB.dispose();

        // B reads the agent-comms resource: the read returns BOTH pending entries
        // and only THEN advances the cursor (post-drain consume).
        const beforeDrain = await mailbox.readPending('sessB');
        expect(beforeDrain).toHaveLength(2); // wakes never consumed
        const readResult = await b.readResource(bridge.agentCommsInboxUri('sessB'));
        const payload = JSON.parse(readResult.contents[0].text) as { version: number; entries: { body: unknown; seq: number }[] };
        expect(payload.version).toBe(1);
        expect(payload.entries).toHaveLength(2);
        expect((payload.entries[0].body as any).body).toEqual(MSG);
        // Cursor advanced ONLY after the resource read returned the entries.
        expect(await mailbox.readPending('sessB')).toEqual([]);
    });
});

describe('Scope B missed-wake recovery', () => {
    it('mailbox drain (not wake replay) consumes the message after a missed wake', async () => {
        const MSG = { urgent: true, id: 'm-99' };

        // A2 sends to B2 while B2 has NO consumer/bridge running -> no wake event
        // ever flows into B2's process; only the durable inbox records it.
        await controlClient.sendAgentMessage('sessB2', MSG, 'sessA2');
        expect(await mailbox.readPending('sessB2')).toHaveLength(1);

        // "B2 restarts": a fresh queue + the exported recovery helper (NOT a
        // resource_updated replay). The helper detects pending mail and pushes
        // exactly one wake without consuming.
        const queueB2 = new MessageQueue2Mod.MessageQueue2<CapturedMode>(() => 'h');
        const recovered = await recovery.recoverPendingAgentCommsMessages('sessB2', queueB2, () => MODE);
        expect(recovered).toEqual({ wakeEnqueued: true });
        expect(queueB2.queue).toHaveLength(1);
        expect(queueB2.queue[0].message).toBe(recovery.AGENT_COMMS_WAKE_PROMPT);

        // Recovery did NOT consume the message.
        expect(
            await mailbox.readPending('sessB2'),
            'no notification replay occurred; mailbox drain, not wake enqueue, consumed the message',
        ).toHaveLength(1);

        // The explicit agent-comms resource drain returns the body AND advances
        // the cursor — all WITHOUT any resource_updated event being injected.
        const drained = await bridge.drainAgentCommsInbox('sessB2', (entries) => entries);
        expect(drained).toHaveLength(1);
        expect((drained[0].body as any).body).toEqual(MSG);
        expect(await mailbox.readPending('sessB2')).toEqual([]);
    });
});

describe('Scope B drain semantics', () => {
    it('a payload-build failure leaves the message unconsumed (F-003 build-before-consume)', async () => {
        const sid = 'sessDrain';
        await mailbox.appendMessage(sid, { keep: 'me' }, 'sessSender');

        await expect(
            bridge.drainAgentCommsInbox(sid, () => { throw new Error('boom'); }),
        ).rejects.toThrow('boom');

        // The cursor must NOT have advanced — build threw before markConsumed.
        const stillPending = await mailbox.readPending(sid);
        expect(stillPending).toHaveLength(1);
        expect(stillPending[0].body).toEqual({ keep: 'me' });

        // A subsequent successful drain still gets the message and consumes it
        // (the failed drain did not poison the per-session chain).
        const drained = await bridge.drainAgentCommsInbox(sid, (entries) => entries);
        expect(drained).toHaveLength(1);
        expect(await mailbox.readPending(sid)).toEqual([]);
    });
});

describe('agent_comms.spawn tool shape', () => {
    it('accepts the documented role/plugins/agent/cwd/machineId/initialMessage shape without dropping remote intent', async () => {
        const bridgeServer = makeFakeServer();
        const handle = bridge.registerAgentCommsBridge({
            server: bridgeServer.server,
            sessionId: 'sessA',
            sendMessage: controlClient.sendAgentMessage,
            spawnSession: async () => ({ type: 'success', sessionId: 'unused-local' }),
        });
        liveHandles.push(handle);

        const result = await bridgeServer.callTool('agent_comms.spawn', {
            role: 'reviewer',
            plugins: ['ralph-orchestration@ai-developer-toolkit'],
            agent: 'codex',
            cwd: 'D:/repo',
            machineId: 'remote-machine',
            initialMessage: 'inspect the diff',
        });

        expect(result.isError).toBe(true);
        const payload = JSON.parse(result.content[0].text) as { role?: string; plugins?: string[]; agent?: string; cwd?: string; initialMessage?: string; requiresOperatorApproval?: boolean };
        expect(payload).toMatchObject({
            role: 'reviewer',
            plugins: ['ralph-orchestration@ai-developer-toolkit'],
            agent: 'codex',
            cwd: 'D:/repo',
            initialMessage: 'inspect the diff',
            requiresOperatorApproval: true,
        });
    });
});

describe('Scope B daemon route validation', () => {
    it('rejects an untracked target with 404 (sendAgentMessage throws)', async () => {
        await expect(controlClient.sendAgentMessage('sessUNKNOWN', { x: 1 }, 'sessA')).rejects.toThrow();
    });

    it('rejects an untracked sender with 404 (sendAgentMessage throws)', async () => {
        await expect(controlClient.sendAgentMessage('sessB', { x: 1 }, 'sessUNKNOWN')).rejects.toThrow();
    });

    it('accepts widened channel and spawn-result kind through sendAgentMessage without changing local delivery', async () => {
        const ack = await controlClient.sendAgentMessage('sessB', { ok: true }, 'sessA', {
            channel: 'spawn',
            kind: 'spawn-result',
            correlationId: 'spawn-corr-1',
        });

        expect(ack.seq).toBe(1);
        const pending = await mailbox.readPending('sessB');
        expect(pending).toHaveLength(1);
        expect((pending[0].body as any)).toMatchObject({
            channel: 'spawn',
            kind: 'spawn-result',
            correlationId: 'spawn-corr-1',
            body: { ok: true },
        });
    });
});
