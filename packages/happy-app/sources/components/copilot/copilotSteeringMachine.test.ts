import { describe, expect, it } from 'vitest';

import type { CopilotControlState } from '@/sync/reducer/reducer';
import {
    deriveSteeringView,
    describeAnswerOutcome,
    outcomeIsSuccess,
    outcomeLostLease,
    revocationReasonKey,
    type LocalLease,
} from './copilotSteeringMachine';

function control(partial: Partial<CopilotControlState>): CopilotControlState {
    return { id: 'c', seq: 1, state: 'no-lease', ...partial };
}

describe('deriveSteeringView', () => {
    it('holding gates answers and hides request/conflict', () => {
        const local: LocalLease = { status: 'holding', leaseId: 'l1', expiresAt: 1000, heartbeatIntervalMs: 15000 };
        const view = deriveSteeringView(local, control({ state: 'active' }));
        expect(view.mode).toBe('holding');
        expect(view.canAnswer).toBe(true);
        expect(view.canRequest).toBe(false);
        expect(view.conflict).toBe(false);
        expect(view.expiresAt).toBe(1000);
    });

    it('requesting is neither answerable nor a conflict', () => {
        const view = deriveSteeringView({ status: 'requesting', requestId: 'r1' }, control({ state: 'requested', requestId: 'r1' }));
        expect(view.mode).toBe('requesting');
        expect(view.canAnswer).toBe(false);
        expect(view.canRequest).toBe(false);
        expect(view.conflict).toBe(false);
    });

    it('idle with another active lease surfaces a conflict and hides request', () => {
        const view = deriveSteeringView({ status: 'idle' }, control({ state: 'active' }));
        expect(view.mode).toBe('conflict');
        expect(view.conflict).toBe(true);
        expect(view.conflictKind).toBe('active');
        expect(view.canRequest).toBe(false);
        expect(view.canAnswer).toBe(false);
    });

    it('idle with no control allows requesting', () => {
        const view = deriveSteeringView({ status: 'idle' }, null);
        expect(view.mode).toBe('observing');
        expect(view.canRequest).toBe(true);
        expect(view.conflict).toBe(false);
    });

    it('revoked (no conflict) keeps the reason and re-enables request', () => {
        const view = deriveSteeringView({ status: 'revoked', reason: 'keystroke' }, control({ state: 'no-lease', reason: 'keystroke' }));
        expect(view.mode).toBe('revoked');
        expect(view.revokedReason).toBe('keystroke');
        expect(view.canRequest).toBe(true);
        expect(view.canAnswer).toBe(false);
    });

    it('revoked but another client took over renders as conflict, not request', () => {
        const view = deriveSteeringView({ status: 'revoked', reason: 'superseded' }, control({ state: 'active' }));
        expect(view.mode).toBe('conflict');
        expect(view.canRequest).toBe(false);
    });
});

describe('describeAnswerOutcome', () => {
    it('applied is success', () => {
        expect(describeAnswerOutcome('applied')).toEqual({ kind: 'success', code: 'applied' });
    });

    it('duplicate and already_resolved render success-ish, not errors', () => {
        expect(describeAnswerOutcome('duplicate').kind).toBe('success');
        expect(describeAnswerOutcome('already_resolved').kind).toBe('success');
        expect(outcomeIsSuccess('duplicate')).toBe(true);
        expect(outcomeIsSuccess('already_resolved')).toBe(true);
        expect(outcomeIsSuccess('out_of_scope')).toBe(false);
    });

    it('typed rejections map to distinct error codes', () => {
        expect(describeAnswerOutcome('out_of_scope')).toEqual({ kind: 'error', code: 'out_of_scope' });
        expect(describeAnswerOutcome('destructive_kind')).toEqual({ kind: 'error', code: 'destructive_kind' });
        expect(describeAnswerOutcome('no_lease')).toEqual({ kind: 'error', code: 'no_lease' });
        expect(describeAnswerOutcome('not_pending')).toEqual({ kind: 'error', code: 'not_pending' });
        expect(describeAnswerOutcome('transport_failed')).toEqual({ kind: 'error', code: 'transport_failed' });
    });

    it('rate_limited includes a retry hint (ceil to seconds) when retryAfterMs is present', () => {
        expect(describeAnswerOutcome('rate_limited')).toEqual({ kind: 'error', code: 'rate_limited' });
        expect(describeAnswerOutcome('rate_limited', 1500)).toEqual({ kind: 'error', code: 'rate_limited_retry', retrySeconds: 2 });
        expect(describeAnswerOutcome('rate_limited', 0)).toEqual({ kind: 'error', code: 'rate_limited' });
    });

    it('a lingering pending on an answer is treated as a transport failure', () => {
        expect(describeAnswerOutcome('pending')).toEqual({ kind: 'error', code: 'transport_failed' });
    });
});

describe('outcomeLostLease', () => {
    it('only no_lease drops the lease', () => {
        expect(outcomeLostLease('no_lease')).toBe(true);
        expect(outcomeLostLease('applied')).toBe(false);
        expect(outcomeLostLease('rate_limited')).toBe(false);
    });
});

describe('revocationReasonKey', () => {
    it('maps each reason (and null) to a distinct i18n key', () => {
        expect(revocationReasonKey('keystroke')).toBe('copilotSteering.revokedKeystroke');
        expect(revocationReasonKey('expired')).toBe('copilotSteering.revokedExpired');
        expect(revocationReasonKey('superseded')).toBe('copilotSteering.revokedSuperseded');
        expect(revocationReasonKey('released')).toBe('copilotSteering.revokedReleased');
        expect(revocationReasonKey('detached')).toBe('copilotSteering.revokedDetached');
        expect(revocationReasonKey(null)).toBe('copilotSteering.revokedEnded');
    });
});
