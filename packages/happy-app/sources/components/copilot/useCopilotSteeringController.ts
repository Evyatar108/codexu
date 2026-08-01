/**
 * T6 Copilot steering — device-local controller hook.
 *
 * Owns the phone side of the steering lease that is NOT expressible from the
 * server-authoritative `copilot-control` stream alone:
 * - Whether THIS device holds the lease (derived from its own RPC responses).
 * - The heartbeat keep-alive timer while holding (15s default, server-tunable
 *   via the grant payload). The timer is a protocol keep-alive; it re-renders
 *   the UI only when the lease state actually changes (e-ink friendly — no
 *   ticking countdown).
 * - Per-prompt optimistic send state (grey-out on send, outcome on the
 *   synchronous RPC result) and answered-here attribution.
 *
 * Authoritative `copilot-control` events (revocation on keystroke/expiry/etc.)
 * always win: they instantly drop this device to observe-only. There is NO
 * auto re-acquire — the user must explicitly request again.
 */

import * as React from 'react';
import { randomUUID } from 'expo-crypto';

import { apiSocket } from '@/sync/apiSocket';
import {
    copilotAnswerPrompt,
    copilotGetControlState,
    copilotHeartbeat,
    copilotReleaseLease,
    copilotRequestLease,
} from '@/sync/ops';
import { useCopilotSteering } from '@/sync/storage';
import type { CopilotPromptEntry } from '@/sync/reducer/reducer';
import type {
    AnswerAskUserContent,
    AnswerElicitationContent,
    AnswerPermissionContent,
    AnswerPlanContent,
    SteeringCommandEnvelope,
} from '@slopus/happy-wire';

import {
    deriveSteeringView,
    describeAnswerOutcome,
    isAnswerAllowedWhileHolding,
    outcomeIsSuccess,
    outcomeLostLease,
    reconcileControlEvent,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    DEFAULT_LEASE_TTL_MS,
    type LocalLease,
    type OutcomeCopy,
    type SteeringView,
} from './copilotSteeringMachine';

export type PromptSendState = {
    actionId: string;
    status: 'sending' | 'done';
    copy?: OutcomeCopy;
};

export type AnswerContentByType = {
    'answer-permission': AnswerPermissionContent;
    'answer-elicitation': AnswerElicitationContent;
    'answer-plan': AnswerPlanContent;
    'answer-ask-user': AnswerAskUserContent;
};

export type CopilotSteeringController = {
    view: SteeringView;
    /** Pending prompts (state === 'pending'), oldest first. */
    pendingPrompts: CopilotPromptEntry[];
    /** Resolved prompts (state === 'resolved'), newest first, capped. */
    resolvedPrompts: CopilotPromptEntry[];
    /** True while a request/release RPC is in flight (disables the buttons). */
    leaseBusy: boolean;
    requestLease: () => void;
    releaseLease: () => void;
    answer: <T extends keyof AnswerContentByType>(
        prompt: CopilotPromptEntry,
        type: T,
        content: AnswerContentByType[T],
    ) => void;
    sendStateByRequestId: Record<string, PromptSendState>;
    /** requestIds this device answered successfully (for attribution). */
    isAnsweredHere: (requestId: string) => boolean;
};

const RESOLVED_HISTORY_LIMIT = 5;

/**
 * Controller for the phone-side Copilot steering panel. Pass the app-side
 * composite session id.
 */
export function useCopilotSteeringController(sessionId: string): CopilotSteeringController {
    const { control, promptsMap } = useCopilotSteering(sessionId);

    const [local, setLocal] = React.useState<LocalLease>({ status: 'idle' });
    const [leaseBusy, setLeaseBusy] = React.useState(false);
    const [sendStateByRequestId, setSendStateByRequestId] = React.useState<Record<string, PromptSendState>>({});
    const [answeredHere, setAnsweredHere] = React.useState<ReadonlySet<string>>(() => new Set());

    // Keep a ref to the latest local lease so async RPC callbacks read fresh
    // state without re-creating callbacks on every transition.
    const localRef = React.useRef(local);
    localRef.current = local;

    const bareLocalSessionId = React.useMemo(
        () => apiSocket.forSession(sessionId).ref.localSessionId,
        [sessionId],
    );

    // --- Authoritative control reconciliation -------------------------------
    // A `no-lease` control event (keystroke/expiry/released/detached)
    // is authoritative and instantly drops answer affordances to observe-only.
    // An `active`/`requested` event never auto-re-acquires an idle/revoked
    // device. All transition logic lives in the pure `reconcileControlEvent`
    // (unit-tested) so this effect is a thin adapter.
    React.useEffect(() => {
        if (!control) {
            return;
        }
        setLocal((prev) => reconcileControlEvent(prev, control));
    }, [control]);

    // --- Snapshot-on-mount resync (contract §5) -----------------------------
    // A fresh socket connection never holds a lease, but a same-socket remount
    // (navigate away and back) may still hold it fork-side — resume if so.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const result = await copilotGetControlState(sessionId);
                if (cancelled) {
                    return;
                }
                if (result.outcome === 'applied' && result.leaseId && result.expiresAt !== undefined) {
                    setLocal({
                        status: 'holding',
                        leaseId: result.leaseId,
                        expiresAt: result.expiresAt,
                        heartbeatIntervalMs: result.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
                    });
                }
            } catch {
                // Best-effort resync; the control-event stream is the backstop.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    // --- Heartbeat keep-alive while holding ---------------------------------
    const holdingLeaseId = local.status === 'holding' ? local.leaseId : null;
    const heartbeatIntervalMs = local.status === 'holding' ? local.heartbeatIntervalMs : DEFAULT_HEARTBEAT_INTERVAL_MS;
    React.useEffect(() => {
        if (!holdingLeaseId) {
            return;
        }
        const interval = setInterval(() => {
            (async () => {
                try {
                    const result = await copilotHeartbeat(sessionId, holdingLeaseId);
                    setLocal((prev) => {
                        if (prev.status !== 'holding' || prev.leaseId !== holdingLeaseId) {
                            return prev;
                        }
                        if (result.outcome === 'applied') {
                            return result.expiresAt !== undefined ? { ...prev, expiresAt: result.expiresAt } : prev;
                        }
                        // Lost the lease; the control event will refine the reason.
                        return { status: 'revoked', reason: null };
                    });
                } catch {
                    // Transient transport failure; keep the lease and let the
                    // next tick or an authoritative control event decide.
                }
            })();
        }, heartbeatIntervalMs);
        return () => clearInterval(interval);
    }, [holdingLeaseId, heartbeatIntervalMs, sessionId]);

    // --- Actions ------------------------------------------------------------
    const requestLease = React.useCallback(() => {
        if (leaseBusy) {
            return;
        }
        setLeaseBusy(true);
        setLocal({ status: 'requesting', requestId: null });
        (async () => {
            try {
                const result = await copilotRequestLease(sessionId);
                if (result.outcome === 'applied' && result.leaseId && result.expiresAt !== undefined) {
                    setLocal({
                        status: 'holding',
                        leaseId: result.leaseId,
                        expiresAt: result.expiresAt,
                        heartbeatIntervalMs: result.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
                    });
                } else if (result.outcome === 'pending') {
                    setLocal({ status: 'requesting', requestId: result.requestId ?? null });
                } else {
                    // no_lease (another client) or an unexpected outcome: fall
                    // back to idle; conflict is surfaced via control events.
                    setLocal({ status: 'idle' });
                }
            } catch {
                setLocal({ status: 'idle' });
            } finally {
                setLeaseBusy(false);
            }
        })();
    }, [leaseBusy, sessionId]);

    const releaseLease = React.useCallback(() => {
        if (leaseBusy) {
            return;
        }
        const current = localRef.current;
        const leaseId = current.status === 'holding' ? current.leaseId : undefined;
        setLeaseBusy(true);
        setLocal({ status: 'idle' });
        (async () => {
            try {
                if (leaseId) {
                    await copilotReleaseLease(sessionId, leaseId);
                }
            } catch {
                // Best-effort; the fork-side TTL is the backstop.
            } finally {
                setLeaseBusy(false);
            }
        })();
    }, [leaseBusy, sessionId]);

    const answer = React.useCallback(<T extends keyof AnswerContentByType>(
        prompt: CopilotPromptEntry,
        type: T,
        content: AnswerContentByType[T],
    ) => {
        // Guard: must hold the lease AND the destructive/decision policy must
        // permit this answer (deny-any / approve-blocked-for-destructive).
        if (localRef.current.status !== 'holding'
            || !isAnswerAllowedWhileHolding(prompt, type, content as { decision?: 'approve' | 'deny' })) {
            return;
        }
        const requestId = prompt.requestId;
        // Reuse an in-flight actionId so a retry of the SAME user action stays
        // idempotent fork-side; otherwise mint a fresh one.
        const existing = sendStateByRequestId[requestId];
        const actionId = existing?.status === 'sending' ? existing.actionId : randomUUID();
        const command = {
            actionId,
            sessionId: bareLocalSessionId,
            targetRequestId: requestId,
            type,
            content,
        } as SteeringCommandEnvelope;
        setSendStateByRequestId((prev) => ({ ...prev, [requestId]: { actionId, status: 'sending' } }));
        (async () => {
            try {
                const result = await copilotAnswerPrompt(sessionId, command);
                const copy = describeAnswerOutcome(result.outcome, result.retryAfterMs);
                setSendStateByRequestId((prev) => ({ ...prev, [requestId]: { actionId, status: 'done', copy } }));
                if (outcomeIsSuccess(result.outcome)) {
                    setAnsweredHere((prev) => {
                        const next = new Set(prev);
                        next.add(requestId);
                        return next;
                    });
                }
                if (outcomeLostLease(result.outcome)) {
                    setLocal((prev) => (prev.status === 'holding' ? { status: 'revoked', reason: null } : prev));
                }
            } catch {
                setSendStateByRequestId((prev) => ({
                    ...prev,
                    [requestId]: { actionId, status: 'done', copy: describeAnswerOutcome('transport_failed') },
                }));
            }
        })();
    }, [bareLocalSessionId, sendStateByRequestId, sessionId]);

    const view = React.useMemo(() => deriveSteeringView(local, control), [local, control]);

    const { pendingPrompts, resolvedPrompts } = React.useMemo(() => {
        const all = Array.from(promptsMap.values());
        const pending = all.filter((p) => p.state === 'pending').sort((a, b) => a.seq - b.seq);
        const resolved = all
            .filter((p) => p.state === 'resolved')
            .sort((a, b) => b.seq - a.seq)
            .slice(0, RESOLVED_HISTORY_LIMIT);
        return { pendingPrompts: pending, resolvedPrompts: resolved };
    }, [promptsMap]);

    const isAnsweredHere = React.useCallback((requestId: string) => answeredHere.has(requestId), [answeredHere]);

    return {
        view,
        pendingPrompts,
        resolvedPrompts,
        leaseBusy,
        requestLease,
        releaseLease,
        answer,
        sendStateByRequestId,
        isAnsweredHere,
    };
}
