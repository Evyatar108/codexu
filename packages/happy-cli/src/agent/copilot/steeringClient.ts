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
import type { NativeEvent } from './types';

export const COPILOT_HEARTBEAT_INTERVAL_MS = 15_000;
export const COPILOT_LEASE_TTL_MS = 45_000;
export const COPILOT_ACTION_RETRY_WINDOW_MS = 45_000;
export const COPILOT_ANSWER_RATE_LIMIT = 20;
export const COPILOT_ANSWER_RATE_LIMIT_WINDOW_MS = 10_000;
const COPILOT_STEERING_RPC_TIMEOUT_MS = 15_000;

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

type PendingPrompt = {
  promptType: SteeringCommandEnvelope['type'];
  destructive: boolean;
};

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
  private readonly pendingPrompts = new Map<string, PendingPrompt>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private generation = 0;
  private pendingLeaseRequestId: string | null = null;

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
        this.invalidateLease('detached');
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
    const generation = this.invalidateLease('detached');
    await this.transport.invokeSteering('happy.attach');
    const state = await this.transport.invokeSteering('happy.getControlState');
    return this.applyLeaseResult(state, generation)
      ? state
      : { outcome: 'no_lease' };
  }

  async requestLease(): Promise<SteeringResult> {
    const generation = ++this.generation;
    this.pendingLeaseRequestId = null;
    const result = await this.transport.invokeSteering('happy.requestLease');
    if (generation !== this.generation) return { outcome: 'no_lease' };
    if (result.outcome === 'pending') {
      this.pendingLeaseRequestId = result.requestId ?? null;
      this.setState({ status: 'requested', ...(result.requestId ? { requestId: result.requestId } : {}) });
    } else {
      this.applyLeaseResult(result, generation);
    }
    return result;
  }

  async heartbeat(): Promise<SteeringResult> {
    if (this.state.status !== 'active') return { outcome: 'no_lease' };
    const generation = this.generation;
    const result = await this.transport.invokeSteering('happy.heartbeat', {
      leaseId: this.state.leaseId,
    });
    return this.applyLeaseResult(result, generation)
      ? result
      : { outcome: 'no_lease' };
  }

  async releaseLease(): Promise<SteeringResult> {
    if (this.state.status !== 'active') return { outcome: 'no_lease' };
    const generation = this.generation;
    const result = await this.transport.invokeSteering('happy.releaseLease', {
      leaseId: this.state.leaseId,
    });
    if (generation !== this.generation) return { outcome: 'no_lease' };
    if (result.outcome === 'applied' || result.outcome === 'no_lease') {
      this.invalidateLease('released');
    }
    return result;
  }

  async abandonLease(): Promise<void> {
    const leaseId = this.state.status === 'active' ? this.state.leaseId : undefined;
    this.invalidateLease('detached');
    if (!leaseId) return;
    try {
      await this.transport.invokeSteering('happy.releaseLease', { leaseId });
    } catch {
      // The local generation remains revoked even if the best-effort native
      // release races a transport loss; the fork-side TTL is the backstop.
    }
  }

  async getControlState(): Promise<SteeringResult> {
    const generation = this.generation;
    const result = await this.transport.invokeSteering('happy.getControlState');
    return this.applyLeaseResult(result, generation)
      ? result
      : { outcome: 'no_lease' };
  }

  observeNativeEvent(event: NativeEvent): void {
    const eventData = typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data)
      ? event.data
      : {};
    const requestId = typeof eventData.requestId === 'string' ? eventData.requestId : undefined;
    if (!requestId) return;
    if (event.type.endsWith('.completed')) {
      this.pendingPrompts.delete(requestId);
      return;
    }
    if (!event.type.endsWith('.requested')) return;
    if (event.type === 'permission.requested') {
      if (eventData.resolvedByHook === true) return;
      const promptRequest = this.record(eventData.promptRequest);
      const permissionRequest = this.record(eventData.permissionRequest);
      this.pendingPrompts.set(requestId, {
        promptType: 'answer-permission',
        destructive: (promptRequest?.kind ?? permissionRequest?.kind) !== 'read',
      });
      return;
    }
    const promptType = event.type === 'user_input.requested'
      ? 'answer-ask-user'
      : event.type === 'elicitation.requested'
        ? 'answer-elicitation'
        : event.type === 'exit_plan_mode.requested'
          ? 'answer-plan'
          : undefined;
    if (promptType) this.pendingPrompts.set(requestId, { promptType, destructive: false });
  }

  async answerPrompt(value: SteeringCommandEnvelope): Promise<SteeringResult> {
    const command = steeringCommandEnvelopeSchema.parse(value);
    if (this.state.status !== 'active') {
      const result = { actionId: command.actionId, outcome: 'no_lease' as const };
      this.emitAction({ actionId: command.actionId, status: 'confirmed', result });
      return result;
    }
    const prompt = this.pendingPrompts.get(command.targetRequestId);
    if (!prompt || prompt.promptType !== command.type) {
      const result = { actionId: command.actionId, outcome: 'not_pending' as const };
      this.emitAction({ actionId: command.actionId, status: 'confirmed', result });
      return result;
    }
    if (command.type === 'answer-permission' && prompt.destructive) {
      const result = { actionId: command.actionId, outcome: 'destructive_kind' as const };
      this.emitAction({ actionId: command.actionId, status: 'confirmed', result });
      return result;
    }

    this.emitAction({ actionId: command.actionId, status: 'pending' });
    const startedAt = this.now();
    const deadline = startedAt + COPILOT_ACTION_RETRY_WINDOW_MS;
    const generation = this.generation;
    const { sessionId: _happySessionId, ...params } = command;
    let result: SteeringResult | undefined;
    let lastTransportError: NativeTransportError | undefined;
    while (true) {
      if (generation !== this.generation) {
        result = { actionId: command.actionId, outcome: 'no_lease' };
        break;
      }
      const remaining = deadline - this.now();
      if (remaining <= 0) {
        if (result) break;
        throw lastTransportError ?? new NativeTransportError('Copilot action retry window expired');
      }
      try {
        result = await this.transport.invokeSteering(
          'happy.answerPrompt',
          params,
          Math.min(COPILOT_STEERING_RPC_TIMEOUT_MS, remaining),
        );
      } catch (error) {
        if (!(error instanceof NativeTransportError)) throw error;
        lastTransportError = error;
        if (generation !== this.generation) {
          result = { actionId: command.actionId, outcome: 'no_lease' };
          break;
        }
        const retryRemaining = deadline - this.now();
        if (retryRemaining <= 0) throw error;
        await this.sleep(Math.min(250, retryRemaining));
        continue;
      }
      if (generation !== this.generation) {
        result = { actionId: command.actionId, outcome: 'no_lease' };
        break;
      }
      if (result.outcome !== 'rate_limited' || result.retryAfterMs === undefined) break;
      const retryRemaining = deadline - this.now();
      if (retryRemaining <= 0 || result.retryAfterMs >= retryRemaining) break;
      await this.sleep(result.retryAfterMs);
    }

    if (!result) throw new NativeTransportError('Copilot action retry window expired');
    const confirmed = result.actionId ? result : { ...result, actionId: command.actionId };
    this.emitAction({ actionId: command.actionId, status: 'confirmed', result: confirmed });
    return confirmed;
  }

  private handleNotification(notification: SteeringNotification): void {
    const { sessionId: _sessionId, ...params } = notification.params;
    if (notification.method === 'happy.leaseRevoked') {
      const revoked = steeringLeaseRevokedSchema.parse(params);
      this.invalidateLease(revoked.reason);
      return;
    }
    if (this.state.status !== 'requested') return;
    if (this.pendingLeaseRequestId === null || params.requestId !== this.pendingLeaseRequestId) return;
    const result = steeringResultSchema.parse({
      outcome: 'applied',
      ...params,
    });
    this.applyLeaseResult(result, this.generation);
  }

  private applyLeaseResult(result: SteeringResult, generation: number): boolean {
    if (generation !== this.generation) return false;
    if (result.outcome === 'no_lease') {
      this.invalidateLease();
      return true;
    }
    if (result.outcome !== 'applied' || !result.leaseId || result.expiresAt === undefined) return true;
    this.pendingLeaseRequestId = null;
    this.setState({
      status: 'active',
      leaseId: result.leaseId,
      expiresAt: result.expiresAt,
      heartbeatIntervalMs: result.heartbeatIntervalMs ?? COPILOT_HEARTBEAT_INTERVAL_MS,
      leaseTtlMs: result.leaseTtlMs ?? COPILOT_LEASE_TTL_MS,
    });
    this.armExpiry(result.expiresAt);
    return true;
  }

  private armExpiry(expiresAt: number): void {
    this.clearExpiryTimer();
    const delay = Math.max(0, expiresAt - this.now());
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.invalidateLease('expired');
    }, delay);
    this.expiryTimer.unref?.();
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private invalidateLease(reason?: SteeringLeaseRevocationReason): number {
    this.generation++;
    this.pendingLeaseRequestId = null;
    this.clearExpiryTimer();
    this.setState({ status: 'no-lease', ...(reason ? { reason } : {}) });
    return this.generation;
  }

  private setState(state: CopilotLeaseState): void {
    this.state = state;
    for (const handler of this.stateHandlers) handler(state);
  }

  private emitAction(update: CopilotActionUpdate): void {
    for (const handler of this.actionHandlers) handler(update);
  }

  private record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }
}

export type CopilotSteeringRpcMethod = SteeringRpcMethod;

export class CopilotPhoneSteeringBroker {
  private ownerConnectionId: string | null = null;
  private requestingConnectionId: string | null = null;

  constructor(private readonly client: CopilotSteeringClient) {
    client.onStateChange((state) => {
      if (state.status === 'no-lease') {
        this.ownerConnectionId = null;
        this.requestingConnectionId = null;
      } else if (state.status === 'active') {
        this.requestingConnectionId = null;
      }
    });
  }

  attach(connectionId: string): SteeringResult {
    return this.isOwner(connectionId)
      ? this.localControlState()
      : { outcome: 'no_lease' };
  }

  async requestLease(connectionId: string): Promise<SteeringResult> {
    if (this.ownerConnectionId && !this.isOwner(connectionId)) return { outcome: 'no_lease' };
    this.ownerConnectionId = connectionId;
    this.requestingConnectionId = connectionId;
    try {
      const result = await this.client.requestLease();
      if (result.outcome !== 'pending' && this.client.getState().status === 'no-lease') {
        this.ownerConnectionId = null;
        this.requestingConnectionId = null;
      }
      return result;
    } catch (error) {
      this.ownerConnectionId = null;
      this.requestingConnectionId = null;
      throw error;
    }
  }

  heartbeat(connectionId: string): Promise<SteeringResult> {
    return this.isOwner(connectionId)
      ? this.client.heartbeat()
      : Promise.resolve({ outcome: 'no_lease' });
  }

  releaseLease(connectionId: string): Promise<SteeringResult> {
    return this.isOwner(connectionId)
      ? this.client.releaseLease()
      : Promise.resolve({ outcome: 'no_lease' });
  }

  getControlState(connectionId: string): Promise<SteeringResult> {
    return this.isOwner(connectionId)
      ? this.client.getControlState()
      : Promise.resolve({ outcome: 'no_lease' });
  }

  answerPrompt(connectionId: string, command: SteeringCommandEnvelope): Promise<SteeringResult> {
    return this.isOwner(connectionId)
      ? this.client.answerPrompt(command)
      : Promise.resolve({ actionId: command.actionId, outcome: 'no_lease' });
  }

  invalidateOwner(): void {
    this.ownerConnectionId = null;
    this.requestingConnectionId = null;
  }

  async invalidateConnection(connectionId: string): Promise<void> {
    if (!this.isOwner(connectionId) && this.requestingConnectionId !== connectionId) return;
    this.ownerConnectionId = null;
    this.requestingConnectionId = null;
    await this.client.abandonLease();
  }

  private isOwner(connectionId: string): boolean {
    return this.ownerConnectionId === connectionId;
  }

  private localControlState(): SteeringResult {
    const state = this.client.getState();
    if (state.status !== 'active') {
      return {
        outcome: state.status === 'requested' ? 'pending' : 'no_lease',
        ...(state.status === 'requested' && state.requestId ? { requestId: state.requestId } : {}),
      };
    }
    return {
      outcome: 'applied',
      leaseId: state.leaseId,
      expiresAt: state.expiresAt,
      heartbeatIntervalMs: state.heartbeatIntervalMs,
      leaseTtlMs: state.leaseTtlMs,
    };
  }
}
