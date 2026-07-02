import { describe, it, expect } from 'vitest';
import type { AgentCommsEnvelope, AgentCommsIngestBody, AgentCommsIngestHandler } from '@slopus/happy-wire';
import { startAgentCommsIngestServer, type AgentCommsIngestServerHandle } from './ingestServer';

function buildEnvelope(overrides: Partial<AgentCommsEnvelope> = {}): AgentCommsEnvelope {
    return {
        v: 1,
        id: 'env-1',
        ts: 1700000000000,
        from: { machineId: 'machine-a', sessionId: 'session-a' },
        to: { machineId: 'machine-b', sessionId: 'session-b' },
        scope: 'A',
        channel: 'message',
        kind: 'request',
        hopCount: 0,
        hopPath: [],
        body: { sealed: 'ciphertext' },
        ...overrides,
    };
}

function buildBody(envelopeOverrides: Partial<AgentCommsEnvelope> = {}): AgentCommsIngestBody {
    return {
        envelope: buildEnvelope(envelopeOverrides),
        signature: 'base64-signature',
        senderKeys: {
            ed25519PublicKey: 'ed-pub',
            ecdhPublicKey: 'ecdh-pub',
            ed25519Fingerprint: 'fp',
        },
    };
}

async function withServer(
    handler: AgentCommsIngestHandler | undefined,
    run: (base: string) => Promise<void>,
): Promise<void> {
    let server: AgentCommsIngestServerHandle | undefined;
    try {
        server = await startAgentCommsIngestServer({ port: 0, handler });
        await run(`http://127.0.0.1:${server.port}`);
    } finally {
        await server?.stop();
    }
}

function post(base: string, body: unknown): Promise<Response> {
    return fetch(`${base}/agent-comms/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('startAgentCommsIngestServer', () => {
    it('binds an ephemeral port and reports it', async () => {
        await withServer(async () => ({ id: 'x', seq: 1 }), async (base) => {
            expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        });
    });

    it('delegates a valid body to the handler and returns 200 with the ack', async () => {
        let received: AgentCommsIngestBody | undefined;
        const handler: AgentCommsIngestHandler = async (body) => {
            received = body;
            return { id: 'delivered-id', seq: 42 };
        };
        await withServer(handler, async (base) => {
            const body = buildBody();
            const res = await post(base, body);
            expect(res.status).toBe(200);
            await expect(res.json()).resolves.toEqual({ id: 'delivered-id', seq: 42 });
            expect(received).toEqual(body);
        });
    });

    it('returns 503 when no handler is injected', async () => {
        await withServer(undefined, async (base) => {
            const res = await post(base, buildBody());
            expect(res.status).toBe(503);
            await expect(res.json()).resolves.toEqual({ error: 'agent_comms_ingest_unavailable' });
        });
    });

    it('returns 400 and skips the handler when hopPath already contains the target session', async () => {
        let called = false;
        const handler: AgentCommsIngestHandler = async () => {
            called = true;
            return { id: 'should-not-happen', seq: 0 };
        };
        await withServer(handler, async (base) => {
            const res = await post(base, buildBody({ to: { machineId: 'machine-b', sessionId: 'session-b' }, hopPath: ['session-b'] }));
            expect(res.status).toBe(400);
            await expect(res.json()).resolves.toEqual({ error: 'hopPath already contains the target session' });
            expect(called).toBe(false);
        });
    });

    it('returns 400 and skips the handler when hopPath contains a duplicate session', async () => {
        let called = false;
        const handler: AgentCommsIngestHandler = async () => {
            called = true;
            return { id: 'should-not-happen', seq: 0 };
        };
        await withServer(handler, async (base) => {
            const res = await post(base, buildBody({ hopPath: ['dup', 'dup'] }));
            expect(res.status).toBe(400);
            await expect(res.json()).resolves.toEqual({ error: 'hopPath contains a duplicate session' });
            expect(called).toBe(false);
        });
    });

    it('returns 400 with the error message when the handler throws', async () => {
        const handler: AgentCommsIngestHandler = async () => {
            throw new Error('agent-comms signature verification failed for machine-a');
        };
        await withServer(handler, async (base) => {
            const res = await post(base, buildBody());
            expect(res.status).toBe(400);
            await expect(res.json()).resolves.toEqual({ error: 'agent-comms signature verification failed for machine-a' });
        });
    });

    it('returns 400 when the body fails schema validation', async () => {
        const handler: AgentCommsIngestHandler = async () => ({ id: 'x', seq: 1 });
        await withServer(handler, async (base) => {
            const res = await post(base, { envelope: buildEnvelope(), senderKeys: { ed25519PublicKey: 'ed-pub', ecdhPublicKey: 'ecdh-pub' } });
            expect(res.status).toBe(400);
        });
    });
});
