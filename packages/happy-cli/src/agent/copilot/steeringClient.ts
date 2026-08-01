/**
 * Phone-facing steering lease state machine over the Copilot happy.* RPC seam.
 */

import {
  steeringCommandEnvelopeSchema,
  steeringLeaseRevokedSchema,
  steeringResultSchema,
  type SteeringCommandEnvelope,
  type SteeringLeaseRevocationReason,
  type SteeringResult,
  type SteeringRpcMethod,
} from '@slopus/happy-wire';

import {
  NativeTransportError,
  type NativeLocalRpcClient,
  type SteeringNotification,
} from './nativeLocalRpcClient';

export const COPILOT_HEARTBEAT_INTERVAL_MS = 15_000;
export const COPILOT_LEASE_TTL_MS = 45_000;
export const COPILOT_ACTION_RETRY_WINDOW_MS = 45_000;
export const COPILOT_ANSWER_RATE_LIMIT = 20;
export const COPILOT_ANSWER_RATE_LIMIT_WINDOW_MS = 10_000;

export type CopilotLeaseState =
  | { status: 'no-lease'; reason?: SteeringLeaseRevocationReason }
  | { status: 'requested'; requestId?: string }
  | {
    status: 'active';
    leaseId: string;
    expiresAt: number;
    heartbeatIntervalMs: number;
    leaseTtlMs: number;
  };

export type CopilotActionUpdate =
  | { actionId: string; status: 'pending' }
  | { actionId: string; status: 'confirmed'; result: SteeringResult };

type SteeringTransport = Pick<
  NativeLocalRpcClient,
  'invokeSteering' | 'onSteeringNotification' | 'onTransportDisconnected'
>;

type SteeringClientOptions = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class CopilotSteeringClient {
  private state: CopilotLeaseState = { status: 'no-lease' };
  private expiryTimer: NodeJS.Timeout | null = null;
  private detachNotification: (() => void) | null = null;
  private detachDisconnect: (() => void) | null = null;
  private readonly stateHandlers = new Set<(state: CopilotLeaseState) => void>();
  private readonly actionHandlers = new Set<(update: CopilotActionUpdate) => void>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly transport: SteeringTransport,
    options: SteeringClientOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    }));
  }

  async start(): Promise<SteeringResult> {
    if (!this.detachNotification) {
      this.detachNotification = this.transport.onSteeringNotification((notification) => {
        this.handleNotification(notification);
      });
    }
    if (!this.detachDisconnect) {
      this.detachDisconnect = this.transport.onTransportDisconnected(() => {
        this.setNoLease('detached');
      });
    }
    return this.attachAndResync();
  }

  dispose(): void {
    this.detachNotification?.();
    this.detachDisconnect?.();
    this.detachNotification = null;
    this.detachDisconnect = null;
    this.clearExpiryTimer();
    this.stateHandlers.clear();
    this.actionHandlers.clear();
  }

  getState(): CopilotLeaseState {
    return this.state;
  }

  onStateChange(handler: (state: CopilotLeaseState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onActionUpdate(handler: (update: CopilotActionUpdate) => void): () => void {
    this.actionHandlers.add(handler);
    return () => this.actionHandlers.delete(handler);
  }

  async attachAndResync(): Promise<SteeringResult> {
    this.setNoLease('detached');
    await this.transport.invokeSteering('happy.attach');
    const state = await this.transport.invokeSteering('happy.getControlState');
    this.applyLeaseResult(state);
    return state;
  }

  async requestLease(): Promise<SteeringResult> {
    const result = await this.transport.invokeSteering('happy.requestLease');
    if (result.outcome === 'pending') {
      this.setState({ status: 'requested', ...(result.requestId ? { requestId: result.requestId } : {}) });
    } else {
      this.applyLeaseResult(result);
    }
    return result;
  }

  async heartbeat(): Promise<SteeringResult> {
    if (this.state.status !== 'active') return { outcome: 'no_lease' };
    const result = await this.transport.invokeSteering('happy.heartbeat', {
      leaseId: this.state.leaseId,
    });
    this.applyLeaseResult(result);
    return result;
  }

  async releaseLease(): Promise<SteeringResult> {
    if (this.state.status !== 'active') return { outcome: 'no_lease' };
    const result = await this.transport.invokeSteering('happy.releaseLease', {
      leaseId: this.state.leaseId,
    });
    if (result.outcome === 'applied' || result.outcome === 'no_lease') {
      this.setNoLease('released');
    }
    return result;
  }

  async getControlState(): Promise<SteeringResult> {
    const result = await this.transport.invokeSteering('happy.getControlState');
    this.applyLeaseResult(result);
    return result;
  }

  async answerPrompt(value: SteeringCommandEnvelope): Promise<SteeringResult> {
    const command = steeringCommandEnvelopeSchema.parse(value);
    if (this.state.status !== 'active') {
      const result = { actionId: command.actionId, outcome: 'no_lease' as const };
      this.emitAction({ actionId: command.actionId, status: 'confirmed', result });
      return result;
    }

    this.emitAction({ actionId: command.actionId, status: 'pending' });
    const startedAt = this.now();
    const { sessionId: _happySessionId, ...params } = command;
    let result: SteeringResult;
    while (true) {
      try {
        result = await this.transport.invokeSteering('happy.answerPrompt', params);
      } catch (error) {
        const remaining = COPILOT_ACTION_RETRY_WINDOW_MS - (this.now() - startedAt);
        if (!(error instanceof NativeTransportError) || remaining <= 0) throw error;
        await this.sleep(Math.min(250, remaining));
        continue;
      }
      if (result.outcome !== 'rate_limited' || result.retryAfterMs === undefined) break;
      const remaining = COPILOT_ACTION_RETRY_WINDOW_MS - (this.now() - startedAt);
      if (remaining <= 0 || result.retryAfterMs > remaining) break;
      await this.sleep(result.retryAfterMs);
      if (this.now() - startedAt >= COPILOT_ACTION_RETRY_WINDOW_MS) break;
    }

    const confirmed = result.actionId ? result : { ...result, actionId: command.actionId };
    this.emitAction({ actionId: command.actionId, status: 'confirmed', result: confirmed });
    return confirmed;
  }

  private handleNotification(notification: SteeringNotification): void {
    const { sessionId: _sessionId, ...params } = notification.params;
    if (notification.method === 'happy.leaseRevoked') {
      const revoked = steeringLeaseRevokedSchema.parse(params);
      this.setNoLease(revoked.reason);
      return;
    }
    const result = steeringResultSchema.parse({
      outcome: 'applied',
      ...params,
    });
    this.applyLeaseResult(result);
  }

  private applyLeaseResult(result: SteeringResult): void {
    if (result.outcome === 'no_lease') {
      this.setNoLease();
      return;
    }
    if (result.outcome !== 'applied' || !result.leaseId || result.expiresAt === undefined) return;
    this.setState({
      status: 'active',
      leaseId: result.leaseId,
      expiresAt: result.expiresAt,
      heartbeatIntervalMs: result.heartbeatIntervalMs ?? COPILOT_HEARTBEAT_INTERVAL_MS,
      leaseTtlMs: result.leaseTtlMs ?? COPILOT_LEASE_TTL_MS,
    });
    this.armExpiry(result.expiresAt);
  }

  private armExpiry(expiresAt: number): void {
    this.clearExpiryTimer();
    const delay = Math.max(0, expiresAt - this.now());
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.setNoLease('expired');
    }, delay);
    this.expiryTimer.unref?.();
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private setNoLease(reason?: SteeringLeaseRevocationReason): void {
    this.clearExpiryTimer();
    this.setState({ status: 'no-lease', ...(reason ? { reason } : {}) });
  }

  private setState(state: CopilotLeaseState): void {
    this.state = state;
    for (const handler of this.stateHandlers) handler(state);
  }

  private emitAction(update: CopilotActionUpdate): void {
    for (const handler of this.actionHandlers) handler(update);
  }
}

export type CopilotSteeringRpcMethod = SteeringRpcMethod;
