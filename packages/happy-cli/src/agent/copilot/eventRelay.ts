/**
 * Gap-free persisted-history and live-event relay for the Copilot mirror.
 */

import type { ApiSessionClient } from '@/api/apiSession';

import { createProjectionState, projectNativeEvent } from './eventProjection';
import { NativeTransportError, type NativeLocalRpcClient } from './nativeLocalRpcClient';
import { COPILOT_LIVE_PROMPT_EVENT_TYPES, type NativeEvent } from './types';

const MAX_BOOTSTRAP_PAGES = 10_000;
const RECONNECT_ATTEMPTS = 3;
const MAX_BOOTSTRAP_EVENTS = 20_000;
const MAX_PREBUFFER_EVENTS = 10_000;
const MAX_BOOTSTRAP_BYTES = 32 * 1024 * 1024;
const BOOTSTRAP_TIMEOUT_MS = 60_000;
const DELIVERY_BATCH_SIZE = 50;

type BufferedEvent = { arrival: number; event: NativeEvent };

export class CopilotEventRelay {
  private stopped = false;
  private quiescing = false;
  private activeDelivery: Promise<void> | null = null;
  private liveDeliveries = new Set<Promise<void>>();
  private liveDeliveryFailure: Error | null = null;
  private seenEventIds = new Set<string>();
  private projectionState = createProjectionState('');

  constructor(
    private readonly native: NativeLocalRpcClient,
    private readonly happy: Pick<ApiSessionClient, 'sessionId' | 'sendSessionProtocolMessageWithDelivery'>,
    private readonly workspace: string,
    private readonly onNativeShutdown?: () => Promise<void>,
    private readonly onNativeReconnected?: () => Promise<void>,
  ) {}

  async run(): Promise<void> {
    while (!this.stopped && !this.quiescing) {
      try {
        const cursor = await this.bootstrapFromStart();
        if (this.stopped) return;
        let liveCursor = cursor;
        const detachLive = this.native.onSessionEvent((event) => {
          if (!(COPILOT_LIVE_PROMPT_EVENT_TYPES as readonly string[]).includes(event.type)) return;
          this.trackLiveDelivery(event);
        });
        try {
          while (!this.stopped && !this.quiescing) {
            if (this.liveDeliveryFailure) throw this.liveDeliveryFailure;
            const page = await this.native.readEventLog({ cursor: liveCursor, waitMs: 30_000 });
            if (this.stopped) return;
            if (this.liveDeliveryFailure) throw this.liveDeliveryFailure;
            if (page.cursorStatus === 'expired') break;
            await this.deliverEventsWithState(page.events, this.projectionState);
            liveCursor = page.cursor;
          }
        } finally {
          detachLive();
        }
      } catch (error) {
        if (this.stopped || this.quiescing) return;
        if (!(error instanceof NativeTransportError)) throw error;
        let reconnected = false;
        for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS && !this.stopped && !this.quiescing; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 100));
          try {
            await this.native.reconnect();
            await this.onNativeReconnected?.();
            reconnected = true;
            break;
          } catch {
            // Retry only the retained, already-verified child.
          }
        }
        if (!reconnected) throw error;
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }

  quiesce(): void {
    this.quiescing = true;
  }

  async drainCurrentDelivery(): Promise<void> {
    await this.activeDelivery;
    await Promise.all(this.liveDeliveries);
  }

  async bootstrapFromStart(): Promise<string> {
    this.seenEventIds = new Set();
    const projectionState = createProjectionState(this.happy.sessionId);
    this.projectionState = projectionState;
    const prebuffer: BufferedEvent[] = [];
    let arrival = 0;
    let prebufferOpen = true;
    let prebufferOverflow = false;
    let bootstrapBytes = 0;
    const startedAt = Date.now();
    const detach = this.native.onSessionEvent((event) => {
      if (!prebufferOpen) return;
      const eventBytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
      if (prebuffer.length >= MAX_PREBUFFER_EVENTS || bootstrapBytes + eventBytes > MAX_BOOTSTRAP_BYTES) {
        prebufferOverflow = true;
        return;
      }
      bootstrapBytes += eventBytes;
      prebuffer.push({ arrival: arrival++, event });
    });

    try {
      await this.native.resume();
      const persisted: NativeEvent[] = [];
      let cursor: string | undefined;
      let pages = 0;
      let hasMore = true;
      while (hasMore) {
        if (Date.now() - startedAt > BOOTSTRAP_TIMEOUT_MS) throw new Error('Copilot bootstrap timed out');
        if (prebufferOverflow) throw new Error('Copilot notification prebuffer limit exceeded');
        if (++pages > MAX_BOOTSTRAP_PAGES) throw new Error('Copilot bootstrap page limit exceeded');
        const page = await this.native.readEventLog({ ...(cursor ? { cursor } : {}), waitMs: 0 });
        if (page.cursorStatus !== 'ok') throw new Error('Copilot bootstrap cursor expired');
        persisted.push(...page.events);
        bootstrapBytes += page.events.reduce(
          (total, event) => total + Buffer.byteLength(JSON.stringify(event), 'utf8'),
          0,
        );
        if (persisted.length > MAX_BOOTSTRAP_EVENTS || bootstrapBytes > MAX_BOOTSTRAP_BYTES) {
          throw new Error('Copilot bootstrap event limit exceeded');
        }
        cursor = page.cursor;
        hasMore = page.hasMore;
      }

      let consecutiveEmpty = 0;
      while (consecutiveEmpty < 2) {
        if (Date.now() - startedAt > BOOTSTRAP_TIMEOUT_MS) throw new Error('Copilot frontier timed out');
        if (prebufferOverflow) throw new Error('Copilot notification prebuffer limit exceeded');
        if (++pages > MAX_BOOTSTRAP_PAGES) throw new Error('Copilot frontier page limit exceeded');
        const page = await this.native.readEventLog({ cursor, waitMs: 0 });
        if (page.cursorStatus !== 'ok') throw new Error('Copilot frontier cursor expired');
        persisted.push(...page.events);
        bootstrapBytes += page.events.reduce(
          (total, event) => total + Buffer.byteLength(JSON.stringify(event), 'utf8'),
          0,
        );
        if (persisted.length > MAX_BOOTSTRAP_EVENTS || bootstrapBytes > MAX_BOOTSTRAP_BYTES) {
          throw new Error('Copilot bootstrap event limit exceeded');
        }
        cursor = page.cursor;
        consecutiveEmpty = page.events.length === 0 && page.hasMore === false ? consecutiveEmpty + 1 : 0;
      }
      if (!cursor) throw new Error('Copilot event log did not return a frontier cursor');

      prebufferOpen = false;
      detach();
      const historyIds = new Set(persisted.map((event) => event.id));
      const prebufferOnly = prebuffer
        .sort((a, b) => a.arrival - b.arrival)
        .map(({ event }) => event)
        .filter((event, index, events) =>
          !historyIds.has(event.id) && events.findIndex((candidate) => candidate.id === event.id) === index);
      await this.deliverEventsWithState([...persisted, ...prebufferOnly], projectionState);
      return cursor;
    } catch (error) {
      prebufferOpen = false;
      detach();
      throw error;
    }
  }

  private async deliverEventsWithState(
    events: NativeEvent[],
    projectionState: ReturnType<typeof createProjectionState>,
  ): Promise<void> {
    const operation = this.deliverEvents(events, projectionState);
    this.activeDelivery = operation;
    try {
      await operation;
    } finally {
      if (this.activeDelivery === operation) this.activeDelivery = null;
    }
  }

  private trackLiveDelivery(event: NativeEvent): void {
    const delivery = this.deliverEvents([event], this.projectionState);
    this.liveDeliveries.add(delivery);
    void delivery
      .catch((error) => {
        this.liveDeliveryFailure = error instanceof Error ? error : new Error('Copilot prompt delivery failed');
      })
      .finally(() => {
        this.liveDeliveries.delete(delivery);
      });
  }

  private async deliverEvents(
    events: NativeEvent[],
    projectionState: ReturnType<typeof createProjectionState>,
  ): Promise<void> {
    const deliveries: Array<ReturnType<typeof projectNativeEvent>['deliveries'][number]> = [];
    let nativeShutdown = false;
    for (const event of events) {
      if (this.stopped) return;
      if (this.seenEventIds.has(event.id)) continue;
      this.seenEventIds.add(event.id);
      if (event.type === 'session.shutdown' && this.onNativeShutdown) {
        nativeShutdown = true;
        break;
      }
      const projected = projectNativeEvent(event, projectionState, {
        happySessionId: this.happy.sessionId,
        workspace: this.workspace,
      });
      deliveries.push(...projected.deliveries);
    }
    for (let offset = 0; offset < deliveries.length; offset += DELIVERY_BATCH_SIZE) {
      const pending: Array<Promise<unknown>> = [];
      for (const delivery of deliveries.slice(offset, offset + DELIVERY_BATCH_SIZE)) {
        if (this.stopped) return;
        pending.push(this.happy.sendSessionProtocolMessageWithDelivery(delivery.envelope, {
          localId: delivery.localId,
        }));
      }
      await Promise.all(pending);
      if (this.stopped) return;
    }
    if (nativeShutdown) await this.onNativeShutdown?.();
  }
}
