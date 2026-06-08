import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

const tempHome = fsSync.mkdtempSync(path.join(tmpdir(), 'happy-scopec-test-'));
process.env.HAPPY_HOME_DIR = tempHome;

let mailbox: typeof import('./mailbox');
let router: typeof import('./router');
let spawnMod: typeof import('@/daemon/spawnSessionFromSession');

beforeAll(async () => {
    mailbox = await import('./mailbox');
    router = await import('./router');
    spawnMod = await import('@/daemon/spawnSessionFromSession');
});

afterAll(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
});

describe('Scope C parent-child shortcut', () => {
    it('routes a child-to-parent message as Scope C and never invokes discovery/remote transport', async () => {
        const deliverRemote = vi.fn();
        const ack = await router.dispatchAgentCommsEnvelope({
            from: { machineId: 'machine-1', sessionId: 'child' },
            to: { sessionId: 'parent' },
            body: { report: 'done' },
        }, {
            selfMachineId: 'machine-1',
            hasLocalSession: id => ['parent', 'child'].includes(id),
            sessionMetadata: [
                { sessionId: 'parent', spawnedChildren: ['machine-1:child'] },
                { sessionId: 'child', parentSessionId: 'machine-1:parent' },
            ],
            deliverLocal: envelope => mailbox.appendMessage(envelope.to.sessionId, envelope, envelope.from.sessionId),
            deliverRemote,
        });

        expect(ack).toMatchObject({ seq: 1 });
        expect(deliverRemote).not.toHaveBeenCalled();
        const pending = await mailbox.readPending('parent');
        expect(pending).toHaveLength(1);
        expect((pending[0].body as any).scope).toBe('C');
        expect((pending[0].body as any).body).toEqual({ report: 'done' });
    });

    it('keeps initialMessage propagation intact for spawned children', async () => {
        const spawnSession = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'child' });
        await spawnMod.spawnSessionFromSession({
            parentLocalId: 'parent',
            machineId: 'machine-1',
            config: { agent: 'codex', initialMessage: 'summarize the repo' },
        }, {
            getTrackedSession: () => ({
                startedBy: 'daemon',
                happySessionId: 'parent',
                happySessionMetadataFromLocalWebhook: {
                    path: process.cwd(),
                    host: 'host',
                    homeDir: tempHome,
                    happyHomeDir: tempHome,
                    happyLibDir: tempHome,
                    happyToolsDir: tempHome,
                },
                encryption: {
                    encryptionKey: new Uint8Array([1]),
                    encryptionVariant: 'legacy',
                    seq: 1,
                    metadataVersion: 1,
                    agentStateVersion: 1,
                },
                pid: process.pid,
            }),
            spawnSession,
            updateParentMetadata: vi.fn().mockResolvedValue(undefined),
            stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
        });

        expect(spawnSession).toHaveBeenCalledWith(expect.objectContaining({
            initialMessage: 'summarize the repo',
            environmentVariables: expect.objectContaining({ HAPPY_PARENT_SESSION_ID: 'machine-1:parent' }),
        }));
    });
});
