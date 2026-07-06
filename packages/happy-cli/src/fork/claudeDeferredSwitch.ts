// FORK PATCH: KEEP Claude deferred-switch protocol (invariant HC-10)
//
// The fork's deferred-switch protocol lets the app defer a local->remote
// handoff until the active Claude turn ends (or a Notification/idle signal
// arrives) instead of aborting mid-turn. Upstream has no deferred switch: its
// local launcher registers stub `request-switch`/`cancel-pending-switch`
// handlers that immediately return `{ deferred: false }` / no-op.
//
// This module owns the two fork-only RPC handler bodies (`request-switch`,
// `cancel-pending-switch`) plus their wire types, behind the thin
// `installClaudeDeferredSwitch(...)` seam so the upstream-shared launcher body
// carries a single seam call instead of ~35 lines of fork-only handler code.
//
// PARTIAL EXTRACTION (US-002 AC-3): the turn-completion state machine itself
// (`performSwitch`, `doSwitch`, and the Stop/Notification hook callbacks that
// share the `pendingStopSwitchInFlight` guard) intentionally STAYS in
// `claude/claudeLocalLauncher.ts`. Those closures mutate the launcher's own
// control-flow locals (`exitReason`, `preserveDeferredSwitchCompleting`) and
// call its private `abort()` closure, so relocating them would require
// threading the launcher's core control state through the seam -- the exact
// Stop/Notification hook entanglement the story flags as fallback-eligible.
// `performSwitch` and `doSwitch` are injected here as dependencies instead.

import type { Session } from '@/claude/session';

export type RequestSwitchParams = {
    mode: 'now' | 'when-idle';
    messagePreview?: string;
};

export type RequestSwitchResponse = {
    deferred: boolean;
};

export type ClaudeDeferredSwitchDeps = {
    performSwitch: (reason: 'cancelled' | 'completed') => Promise<void>;
    doSwitch: () => Promise<void>;
};

// FORK PATCH: KEEP Claude deferred-switch protocol (invariant HC-10)
export function installClaudeDeferredSwitch(session: Session, deps: ClaudeDeferredSwitchDeps): void {
    const { performSwitch, doSwitch } = deps;

    async function requestSwitch(params: RequestSwitchParams): Promise<RequestSwitchResponse> {
        if (params.mode === 'now') {
            await doSwitch();
            return { deferred: false };
        }

        if (session.pendingSwitch) {
            throw new Error('already-pending');
        }

        if (!session.turnActive) {
            await performSwitch('completed');
            return { deferred: false };
        }

        session.setPendingSwitch({
            requestedAt: Date.now(),
            messagePreview: params.messagePreview,
        });
        return { deferred: true };
    }

    async function cancelPendingSwitch() {
        if (session.deferredSwitchCompleting) {
            return;
        }

        if (!session.pendingSwitch) {
            return;
        }

        session.setPendingSwitch(undefined);
        session.queue.reset();
    }

    session.client.rpcHandlerManager.registerHandler<RequestSwitchParams, RequestSwitchResponse>('request-switch', requestSwitch);
    session.client.rpcHandlerManager.registerHandler('cancel-pending-switch', cancelPendingSwitch);
}
