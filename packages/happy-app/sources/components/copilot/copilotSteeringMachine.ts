/**
 * T6 Copilot steering — pure, framework-free state helpers.
 *
 * These functions carry the device-local lease reasoning that the phone layers
 * on top of the server-authoritative `copilot-control` events. Keeping them
 * pure makes the lease semantics unit-testable under Vitest's node runner
 * without a React renderer or the native Expo module graph.
 *
 * Lease model (v1, single holder, `answer-prompts` scope only):
 * - The GLOBAL control state (`CopilotControlState`) is what every observer of
 *   the session sees; it does NOT tell a device whether IT holds the lease.
 * - `LocalLease` is the device-local view derived from THIS device's own RPC
 *   responses (`requestLease`/`heartbeat`/`releaseLease`/`answerPrompt`) plus
 *   authoritative revocation from control events.
 * - There is NO auto re-acquire: leaving `holding`/`requesting` always requires
 *   an explicit user action to request again.
 */

import type { CopilotControlState, CopilotPromptEntry } from '@/sync/reducer/reducer';
import type { SteeringOutcome } from '@slopus/happy-wire';

/**
 * Lease timing fallbacks used when a control event / grant omits the
 * server-tuned values. The grant payload normally supplies both.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_LEASE_TTL_MS = 45_000;

export type SteeringPromptType = CopilotPromptEntry['promptType'];

export type SteeringRevocationReason = NonNullable<CopilotControlState['reason']>;

export type LocalLease =
    | { status: 'idle' }
    | { status: 'requesting'; requestId: string | null }
    | { status: 'holding'; leaseId: string; expiresAt: number; heartbeatIntervalMs: number }
    | { status: 'revoked'; reason: SteeringRevocationReason | null };

export type SteeringViewMode = 'observing' | 'requesting' | 'holding' | 'revoked' | 'conflict';

export type SteeringView = {
    mode: SteeringViewMode;
    /** True only while this device holds the lease; gates all answer affordances. */
    canAnswer: boolean;
    /** True when the user may tap "Request steering". */
    canRequest: boolean;
    /** True when another client currently holds or is requesting the lease. */
    conflict: boolean;
    /** Coarse "another client is …" distinction for conflict copy. */
    conflictKind: 'active' | 'requested' | null;
    /** Absolute expiry (ms epoch) of this device's active lease, if holding. */
    expiresAt: number | null;
    /** Reason the lease was revoked, when in the `revoked` mode. */
    revokedReason: SteeringRevocationReason | null;
};

/**
 * Derive the phone-facing steering view from this device's local lease state
 * and the latest authoritative control event. Conflict (another client) is
 * surfaced only when this device is neither holding nor requesting.
 */
export function deriveSteeringView(local: LocalLease, control: CopilotControlState | null): SteeringView {
    if (local.status === 'holding') {
        return {
            mode: 'holding',
            canAnswer: true,
            canRequest: false,
            conflict: false,
            conflictKind: null,
            expiresAt: local.expiresAt,
            revokedReason: null,
        };
    }

    if (local.status === 'requesting') {
        return {
            mode: 'requesting',
            canAnswer: false,
            canRequest: false,
            conflict: false,
            conflictKind: null,
            expiresAt: null,
            revokedReason: null,
        };
    }

    // idle | revoked: another client's active/requested lease is a conflict.
    const conflictKind: SteeringView['conflictKind'] =
        control?.state === 'active' ? 'active' : control?.state === 'requested' ? 'requested' : null;
    const conflict = conflictKind !== null;

    if (local.status === 'revoked') {
        return {
            mode: conflict ? 'conflict' : 'revoked',
            canAnswer: false,
            canRequest: !conflict,
            conflict,
            conflictKind,
            expiresAt: null,
            revokedReason: local.reason,
        };
    }

    return {
        mode: conflict ? 'conflict' : 'observing',
        canAnswer: false,
        canRequest: !conflict,
        conflict,
        conflictKind,
        expiresAt: null,
        revokedReason: null,
    };
}

/**
 * Reconcile this device's local lease against an authoritative control event.
 * Pure so the safety-critical transitions are unit-testable without a renderer.
 *
 * Invariants encoded here:
 * - A `no-lease` event drops holding/requesting → revoked immediately (the
 *   terminal always wins).
 * - An `active`/`requested` event NEVER promotes an idle/revoked device to
 *   holding — there is no auto re-acquire; re-acquiring is an explicit action.
 * - `requesting → holding` only when the event's `requestId` matches the
 *   outstanding request (or the event carries no requestId to correlate with).
 *   The single-holder broker one tier down gates every actionable RPC by
 *   connection ownership, so this is defence-in-depth, not the sole guard —
 *   but it prevents a stale/foreign grant from promoting the wrong request.
 */
export function reconcileControlEvent(local: LocalLease, control: CopilotControlState): LocalLease {
    if (control.state === 'no-lease') {
        if (local.status === 'holding' || local.status === 'requesting') {
            return { status: 'revoked', reason: control.reason ?? null };
        }
        if (local.status === 'revoked') {
            return { status: 'revoked', reason: control.reason ?? local.reason };
        }
        return local; // idle stays idle
    }

    if (control.state === 'active') {
        if (local.status === 'requesting') {
            // LOW fix (2026-08-01): correlate the grant to THIS request. Only
            // promote when the event has no requestId (nothing to correlate) or
            // it matches the outstanding request id; a mismatch means the grant
            // belongs to a different/older request and must not promote us.
            if (control.requestId !== undefined && local.requestId !== null && control.requestId !== local.requestId) {
                return local;
            }
            return {
                status: 'holding',
                leaseId: control.leaseId ?? 'lease',
                expiresAt: control.expiresAt ?? Date.now() + (control.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS),
                heartbeatIntervalMs: control.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
            };
        }
        if (local.status === 'holding') {
            return {
                status: 'holding',
                leaseId: control.leaseId ?? local.leaseId,
                expiresAt: control.expiresAt ?? local.expiresAt,
                heartbeatIntervalMs: control.heartbeatIntervalMs ?? local.heartbeatIntervalMs,
            };
        }
        // idle | revoked: no auto re-acquire.
        return local;
    }

    // control.state === 'requested' by another client → conflict is derived by
    // deriveSteeringView; no local lease change.
    return local;
}

/**
 * Whether this device may submit `answer` for a prompt while holding the lease.
 *
 * Fork deny-first policy (2026-08-01): denial is monotonically safe for ANY
 * permission kind (it can only prevent an action), so a destructive permission
 * prompt CAN be denied from the phone. Approval remains fork-gated to the
 * fail-closed allow-list, so the phone never sends approve for a destructive
 * prompt. Non-permission prompts are never destructive today; a hypothetical
 * destructive non-permission prompt is not answerable here.
 *
 * NOTE: the caller must still confirm `status === 'holding'` — this function
 * only encodes the destructive/decision split.
 */
export function isAnswerAllowedWhileHolding(
    prompt: Pick<CopilotPromptEntry, 'promptType' | 'destructive'>,
    type: SteeringPromptType,
    content: { decision?: 'approve' | 'deny' },
): boolean {
    if (prompt.promptType !== type) {
        return false;
    }
    if (!prompt.destructive) {
        return true;
    }
    return type === 'answer-permission' && content.decision === 'deny';
}

/**
 * Typed rejections that are actually success-ish for optimistic UI: the answer
 * either already landed or the prompt was already resolved. These must render
 * as success, not as errors.
 */
export function outcomeIsSuccess(outcome: SteeringOutcome): boolean {
    return outcome === 'applied' || outcome === 'duplicate' || outcome === 'already_resolved';
}

/**
 * An answer outcome that means this device no longer holds the lease, so the
 * controller must drop to observe-only.
 */
export function outcomeLostLease(outcome: SteeringOutcome): boolean {
    return outcome === 'no_lease';
}

/** i18n key (under `copilotSteering`) describing a revocation reason. */
export function revocationReasonKey(reason: SteeringRevocationReason | null): string {
    switch (reason) {
        case 'keystroke':
            return 'copilotSteering.revokedKeystroke';
        case 'expired':
            return 'copilotSteering.revokedExpired';
        case 'superseded':
            return 'copilotSteering.revokedSuperseded';
        case 'released':
            return 'copilotSteering.revokedReleased';
        case 'detached':
            return 'copilotSteering.revokedDetached';
        default:
            return 'copilotSteering.revokedEnded';
    }
}

export type OutcomeCopy =
    | { kind: 'success'; code: 'applied' | 'duplicate' | 'already_resolved' }
    | { kind: 'error'; code: 'out_of_scope' | 'destructive_kind' | 'no_lease' | 'not_pending' | 'rate_limited' | 'transport_failed' }
    | { kind: 'error'; code: 'rate_limited_retry'; retrySeconds: number };

/**
 * Map a steering answer outcome (or a thrown transport failure) to a stable
 * message code + success/error discriminant. The component maps `code` to
 * short, e-ink-friendly copy via literal `t(...)` calls. `duplicate` /
 * `already_resolved` render success-ish; everything else that is not `applied`
 * renders as a distinct error.
 */
export function describeAnswerOutcome(
    outcome: SteeringOutcome | 'transport_failed',
    retryAfterMs?: number,
): OutcomeCopy {
    switch (outcome) {
        case 'applied':
            return { kind: 'success', code: 'applied' };
        case 'duplicate':
            return { kind: 'success', code: 'duplicate' };
        case 'already_resolved':
            return { kind: 'success', code: 'already_resolved' };
        case 'out_of_scope':
            return { kind: 'error', code: 'out_of_scope' };
        case 'destructive_kind':
            return { kind: 'error', code: 'destructive_kind' };
        case 'no_lease':
            return { kind: 'error', code: 'no_lease' };
        case 'not_pending':
            return { kind: 'error', code: 'not_pending' };
        case 'rate_limited':
            return retryAfterMs !== undefined && retryAfterMs > 0
                ? { kind: 'error', code: 'rate_limited_retry', retrySeconds: Math.ceil(retryAfterMs / 1000) }
                : { kind: 'error', code: 'rate_limited' };
        case 'pending':
            // Prompt answers resolve synchronously fork-side; a lingering
            // `pending` on an answer is treated as an in-flight/unknown error.
            return { kind: 'error', code: 'transport_failed' };
        case 'transport_failed':
            return { kind: 'error', code: 'transport_failed' };
    }
}
