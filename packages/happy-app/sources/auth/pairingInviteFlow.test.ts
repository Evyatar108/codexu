import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PUBLIC_PAIRING_INVITE_TEST_VECTOR } from '@slopus/happy-wire';

import { enrollFromInvite, PairingInviteError } from './pairingInviteFlow';
import { LocalEnrollmentError } from './localEnrollment';
import { PublicEnrollmentError } from './publicEnrollment';

const publicToken = PUBLIC_PAIRING_INVITE_TEST_VECTOR.token;
const localToken = (JSON.parse(
    readFileSync(
        new URL('../../../happy-wire/src/fixtures/happy_local_v1_vectors.json', import.meta.url),
        'utf8',
    ),
) as { invite: { token: string } }).invite.token;

const fakeCredentials = { authMode: 'paired-device', machineId: 'm1', tunnelUrl: 'u', firstSeenAt: 1 };

describe('enrollFromInvite', () => {
    it('routes a local invite to the local enrollment path', async () => {
        const enrollLocal = vi.fn().mockResolvedValue({ credentials: fakeCredentials, invite: { machineId: 'local-machine' }, reusedDeviceKey: false });
        const enrollPublic = vi.fn();
        const result = await enrollFromInvite(localToken, { enrollLocal: enrollLocal as any, enrollPublic: enrollPublic as any });
        expect(enrollLocal).toHaveBeenCalledOnce();
        expect(enrollPublic).not.toHaveBeenCalled();
        expect(result).toEqual({ credentials: fakeCredentials, kind: 'local', machineId: 'local-machine' });
    });

    it('routes a public invite to the public enrollment path', async () => {
        const enrollLocal = vi.fn();
        const enrollPublic = vi.fn().mockResolvedValue({ credentials: fakeCredentials, invite: { machineId: 'public-machine' } });
        const result = await enrollFromInvite(publicToken, { enrollLocal: enrollLocal as any, enrollPublic: enrollPublic as any });
        expect(enrollPublic).toHaveBeenCalledOnce();
        expect(enrollLocal).not.toHaveBeenCalled();
        expect(result).toEqual({ credentials: fakeCredentials, kind: 'public', machineId: 'public-machine' });
    });

    it('normalizes a public server-identity change to a PairingInviteError', async () => {
        const enrollPublic = vi.fn().mockRejectedValue(new PublicEnrollmentError('server_identity_changed'));
        await expect(enrollFromInvite(publicToken, { enrollPublic: enrollPublic as any }))
            .rejects.toMatchObject({ code: 'server_identity_changed' });
        await expect(enrollFromInvite(publicToken, { enrollPublic: enrollPublic as any }))
            .rejects.toBeInstanceOf(PairingInviteError);
    });

    it('normalizes a local enrollment error to a PairingInviteError', async () => {
        const enrollLocal = vi.fn().mockRejectedValue(new LocalEnrollmentError('invite_expired'));
        await expect(enrollFromInvite(localToken, { enrollLocal: enrollLocal as any }))
            .rejects.toMatchObject({ code: 'invite_expired' });
    });
});
