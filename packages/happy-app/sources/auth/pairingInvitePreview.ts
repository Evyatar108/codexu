import {
    decodeLocalPairingInvite,
    decodePublicPairingInvite,
    isLocalPairingInviteValid,
    isPublicPairingInviteValid,
} from '@slopus/happy-wire';

import { selectPairingEnrollment, type PairingEnrollmentKind } from './pairingInviteDispatch';

/**
 * A decoded, validity-checked summary of a pairing invite, safe to render.
 * Carries the exact host/origin + expiry so the UI can present them before the
 * user commits, and `machineId` so a blocked re-pair (server identity change)
 * can target the existing saved machine for the remove-and-repair path.
 */
export interface PairingInvitePreview {
    kind: PairingEnrollmentKind;
    machineId: string;
    serverUrl: string;
    /** `host[:port]` of the server the invite points at (for display). */
    host: string;
    /** Invite expiry, epoch milliseconds. */
    expiresAt: number;
}

export type PairingInvitePreviewError =
    | 'invalid_invite'
    | 'invite_expired'
    | 'unsupported_platform';

export type PairingInvitePreviewResult =
    | { ok: true; preview: PairingInvitePreview }
    | { ok: false; error: PairingInvitePreviewError };

export interface PairingInvitePreviewDeps {
    now?: () => number;
    /** Web origin used to validate a local (loopback) invite. */
    browserOrigin?: string;
}

function hostOf(serverUrl: string): string {
    try {
        return new URL(serverUrl).host;
    } catch {
        return serverUrl;
    }
}

function getBrowserOrigin(): string | null {
    const location = (globalThis as { location?: { origin?: unknown } }).location;
    return typeof location?.origin === 'string' && location.origin.length > 0
        ? location.origin
        : null;
}

/**
 * Decode + validate a pairing invite token WITHOUT contacting the server, so
 * the UI can distinguish local vs public, show the target host and expiry, and
 * fail closed on malformed / expired / wrong-origin tokens. Enrollment re-runs
 * the same validation server-side; this preview never persists anything.
 */
export function previewPairingInvite(
    token: string,
    deps: PairingInvitePreviewDeps = {},
): PairingInvitePreviewResult {
    const nowMs = deps.now ? deps.now() : Date.now();
    const kind = selectPairingEnrollment(token);

    if (kind === 'local') {
        const browserOrigin = deps.browserOrigin ?? getBrowserOrigin();
        if (!browserOrigin) {
            return { ok: false, error: 'unsupported_platform' };
        }
        // Returns null for malformed OR wrong-origin tokens: fail closed.
        const invite = decodeLocalPairingInvite(token, browserOrigin);
        if (!invite) {
            return { ok: false, error: 'invalid_invite' };
        }
        if (!isLocalPairingInviteValid(invite, browserOrigin, new Date(nowMs))) {
            return { ok: false, error: 'invite_expired' };
        }
        return {
            ok: true,
            preview: {
                kind: 'local',
                machineId: invite.machineId,
                serverUrl: invite.serverUrl,
                host: hostOf(invite.serverUrl),
                expiresAt: Date.parse(invite.expiresAt),
            },
        };
    }

    const invite = decodePublicPairingInvite(token);
    if (!invite) {
        return { ok: false, error: 'invalid_invite' };
    }
    if (!isPublicPairingInviteValid(invite, new Date(nowMs))) {
        return { ok: false, error: 'invite_expired' };
    }
    return {
        ok: true,
        preview: {
            kind: 'public',
            machineId: invite.machineId,
            serverUrl: invite.serverUrl,
            host: hostOf(invite.serverUrl),
            expiresAt: Date.parse(invite.expiresAt),
        },
    };
}
