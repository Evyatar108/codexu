import { describe, expect, it, vi } from 'vitest';

import { CopilotEventRelay } from './eventRelay';
import type { EventLogPage, NativeEvent, NativeNotificationHandler } from './types';

function nativeEvent(id: string, type: string, data: Record<string, unknown> = {}): NativeEvent {
  return { id, type, timestamp: '2026-07-19T00:00:00.000Z', data };
}

class FakeNative {
  handler: NativeNotificationHandler | null = null;
  reads: Array<{ cursor?: string; waitMs?: number }> = [];
  constructor(private readonly pages: EventLogPage[], private readonly duringResume?: NativeEvent) {}
  onSessionEvent(handler: NativeNotificationHandler): () => void {
    this.handler = handler;
    return () => { this.handler = null; };
  }
  async resume(): Promise<void> {
    if (this.duringResume) this.handler?.(this.duringResume);
  }
  async readEventLog(options: { cursor?: string; waitMs?: number }): Promise<EventLogPage> {
    this.reads.push(options);
    const page = this.pages.shift();
    if (!page) throw new Error('Unexpected read');
    return page;
  }
}

describe('CopilotEventRelay bootstrap', () => {
  it('registers before resume, preserves persisted then prebuffer order, and deduplicates overlap', async () => {
    const overlap = nativeEvent('message-1', 'user.message', { content: 'persisted' });
    const prebufferOnly = nativeEvent('message-2', 'user.message', { content: 'prebuffer' });
    const fake = new FakeNative([
      { events: [overlap], cursor: 'c1', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c2', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c3', cursorStatus: 'ok', hasMore: false },
    ], overlap);
    const sent: Array<{ text: string; localId: string }> = [];
    const happy = {
      sessionId: 'happy-1',
      sendSessionProtocolMessageWithDelivery: vi.fn(async (envelope, options) => {
        sent.push({ text: (envelope.ev as { text: string }).text, localId: options.localId });
        return { id: options.localId, seq: sent.length };
      }),
    };
    const relay = new CopilotEventRelay(fake as never, happy as never, process.cwd());
    fake.handler = null;
    const originalResume = fake.resume.bind(fake);
    fake.resume = async () => {
      await originalResume();
      fake.handler?.(prebufferOnly);
    };

    await expect(relay.bootstrapFromStart()).resolves.toBe('c3');
    expect(sent.map((row) => row.text)).toEqual(['persisted', 'prebuffer']);
    expect(new Set(sent.map((row) => row.localId)).size).toBe(2);
    expect(fake.reads[0]).toEqual({ waitMs: 0 });
  });

  it('requires two consecutive empty frontier reads', async () => {
    const fake = new FakeNative([
      { events: [], cursor: 'c1', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c2', cursorStatus: 'ok', hasMore: false },
      { events: [nativeEvent('late', 'user.message', { content: 'late' })], cursor: 'c3', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c4', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c5', cursorStatus: 'ok', hasMore: false },
    ]);
    const happy = {
      sessionId: 'happy-1',
      sendSessionProtocolMessageWithDelivery: vi.fn(async (_envelope, options) => ({ id: options.localId, seq: 1 })),
    };
    const relay = new CopilotEventRelay(fake as never, happy as never, process.cwd());

    await expect(relay.bootstrapFromStart()).resolves.toBe('c5');
    expect(fake.reads).toHaveLength(5);
    expect(happy.sendSessionProtocolMessageWithDelivery).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a protocol incompatibility without reconnecting', async () => {
    const fake = new FakeNative([
      { events: [], cursor: 'expired', cursorStatus: 'expired', hasMore: false },
    ]) as FakeNative & { reconnect: ReturnType<typeof vi.fn> };
    fake.reconnect = vi.fn();
    const happy = {
      sessionId: 'happy-1',
      sendSessionProtocolMessageWithDelivery: vi.fn(),
    };
    const relay = new CopilotEventRelay(fake as never, happy as never, process.cwd());

    await expect(relay.run()).rejects.toThrow('cursor expired');
    expect(fake.reconnect).not.toHaveBeenCalled();
  });

  it('bounds notifications buffered while establishing the frontier', async () => {
    const fake = new FakeNative([
      { events: [], cursor: 'c1', cursorStatus: 'ok', hasMore: false },
    ]);
    fake.resume = async () => {
      for (let index = 0; index <= 10_000; index++) {
        fake.handler?.(nativeEvent(`buffer-${index}`, 'user.message', { content: 'buffered' }));
      }
    };
    const happy = {
      sessionId: 'happy-1',
      sendSessionProtocolMessageWithDelivery: vi.fn(),
    };
    const relay = new CopilotEventRelay(fake as never, happy as never, process.cwd());

    await expect(relay.bootstrapFromStart()).rejects.toThrow('prebuffer limit');
    expect(happy.sendSessionProtocolMessageWithDelivery).not.toHaveBeenCalled();
  });

  it('does not deliver the remainder of a projected batch after stop', async () => {
    const turnStart = nativeEvent('turn-start', 'assistant.turn_start', { turnId: 'turn-1' });
    const failure = nativeEvent('failure', 'session.error');
    const fake = new FakeNative([
      { events: [turnStart, failure], cursor: 'c1', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c2', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c3', cursorStatus: 'ok', hasMore: false },
    ]);
    let relay!: CopilotEventRelay;
    const happy = {
      sessionId: 'happy-1',
      sendSessionProtocolMessageWithDelivery: vi.fn(async () => {
        if (happy.sendSessionProtocolMessageWithDelivery.mock.calls.length === 1) relay.stop();
        return { id: 'delivery', seq: 1 };
      }),
    };
    relay = new CopilotEventRelay(fake as never, happy as never, process.cwd());

    await expect(relay.bootstrapFromStart()).resolves.toBe('c3');
    expect(happy.sendSessionProtocolMessageWithDelivery).toHaveBeenCalledTimes(1);
  });

  it('queues delivery acknowledgements in M0-sized batches', async () => {
    const events = Array.from({ length: 120 }, (_, index) =>
      nativeEvent(`message-${index}`, 'user.message', { content: `message ${index}` }));
    const fake = new FakeNative([
      { events, cursor: 'c1', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c2', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c3', cursorStatus: 'ok', hasMore: false },
    ]);
    const resolvers: Array<() => void> = [];
    const happy = {
      sessionId: 'happy-1',
      sendSessionProtocolMessageWithDelivery: vi.fn(() => new Promise((resolve) => {
        resolvers.push(() => resolve({ id: 'delivery', seq: 1 }));
      })),
    };
    const relay = new CopilotEventRelay(fake as never, happy as never, process.cwd());
    const bootstrap = relay.bootstrapFromStart();
    await vi.waitFor(() => expect(happy.sendSessionProtocolMessageWithDelivery).toHaveBeenCalledTimes(50));
    resolvers.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(happy.sendSessionProtocolMessageWithDelivery).toHaveBeenCalledTimes(100));
    resolvers.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(happy.sendSessionProtocolMessageWithDelivery).toHaveBeenCalledTimes(120));
    resolvers.splice(0).forEach((resolve) => resolve());

    await expect(bootstrap).resolves.toBe('c3');
  });

  it('delivers events preceding native shutdown before finalization', async () => {
    const fake = new FakeNative([
      {
        events: [
          nativeEvent('last-message', 'user.message', { content: 'before shutdown' }),
          nativeEvent('shutdown', 'session.shutdown'),
        ],
        cursor: 'c1',
        cursorStatus: 'ok',
        hasMore: false,
      },
      { events: [], cursor: 'c2', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c3', cursorStatus: 'ok', hasMore: false },
    ]);
    const order: string[] = [];
    const happy = {
      sessionId: 'happy-1',
      sendSessionProtocolMessageWithDelivery: vi.fn(async () => {
        order.push('message');
        return { id: 'delivery', seq: 1 };
      }),
    };
    const relay = new CopilotEventRelay(fake as never, happy as never, process.cwd(), async () => {
      order.push('shutdown');
    });

    await expect(relay.bootstrapFromStart()).resolves.toBe('c3');
    expect(order).toEqual(['message', 'shutdown']);
  });

  it('replays from the start after an expired live cursor', async () => {
    const fake = new FakeNative([
      { events: [], cursor: 'c1', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c2', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c3', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'expired', cursorStatus: 'expired', hasMore: false },
      {
        events: [nativeEvent('after-replay', 'user.message', { content: 'replayed' })],
        cursor: 'c4',
        cursorStatus: 'ok',
        hasMore: false,
      },
      { events: [], cursor: 'c5', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c6', cursorStatus: 'ok', hasMore: false },
    ]);
    let relay!: CopilotEventRelay;
    const happy = {
      sessionId: 'happy-1',
      sendSessionProtocolMessageWithDelivery: vi.fn(async () => {
        relay.stop();
        return { id: 'delivery', seq: 1 };
      }),
    };
    relay = new CopilotEventRelay(fake as never, happy as never, process.cwd());

    await expect(relay.run()).resolves.toBeUndefined();
    expect(fake.reads.filter((read) => read.cursor === undefined)).toHaveLength(2);
    expect(happy.sendSessionProtocolMessageWithDelivery).toHaveBeenCalledOnce();
  });
});
