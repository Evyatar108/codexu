import type { AuthCredentials } from './tokenStorage';
import { selectPairingEnrollment } from './pairingInviteDispatch';
import { enrollLocalServer, LocalEnrollmentError } from './localEnrollment';
import { enrollPublicServer, PublicEnrollmentError } from './publicEnrollment';

/**
 * Unified error surface for both local and public invite enrollment, so the UI
 * has one code space to map to user-facing copy. `server_identity_changed` is
 * the high-signal TOFU failure that must block silently-overwriting a known
 * machine's pinned server key and instead offer remove-and-repair.
 */
export type PairingInviteErrorCode =
    | 'invalid_invite'
    | 'invite_expired'
    | 'unsupported_platform'
    | 'network_error'
    | 'pairing_denied'
    | 'pair_failed'
    | 'invalid_response'
    | 'server_identity_changed';

export class PairingInviteError extends Error {
    readonly code: PairingInviteErrorCode;
    constructor(code: PairingInviteErrorCode, message?: string) {
        super(message ?? code);
        this.code = code;
        this.name = 'PairingInviteError';
    }
}

export interface EnrollFromInviteResult {
    credentials: AuthCredentials;
    kind: 'local' | 'public';
    machineId: string;
}

export interface EnrollFromInviteDeps {
    enrollLocal?: typeof enrollLocalServer;
    enrollPublic?: typeof enrollPublicServer;
}

/**
 * Route a pairing invite to the correct enrollment path (local vs public by its
 * typed invite kind) and normalize both error hierarchies to a single
 * `PairingInviteError`. Never persists credentials — the caller does that after
 * presenting the invite preview and confirming with the user.
 */
export async function enrollFromInvite(
    token: string,
    deps: EnrollFromInviteDeps = {},
): Promise<EnrollFromInviteResult> {
    const kind = selectPairingEnrollment(token);
    try {
        if (kind === 'local') {
            const result = await (deps.enrollLocal ?? enrollLocalServer)(token);
            return { credentials: result.credentials, kind: 'local', machineId: result.invite.machineId };
        }
        const result = await (deps.enrollPublic ?? enrollPublicServer)(token);
        return { credentials: result.credentials, kind: 'public', machineId: result.invite.machineId };
    } catch (error) {
        if (error instanceof LocalEnrollmentError || error instanceof PublicEnrollmentError) {
            throw new PairingInviteError(error.code, error.message);
        }
        throw error;
    }
}
