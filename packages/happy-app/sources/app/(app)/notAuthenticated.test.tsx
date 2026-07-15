import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
    return readFileSync(resolve(__dirname, '..', '..', path), 'utf8');
}

describe('NotAuthenticated landing (invite-only pairing)', () => {
    const home = source('app/(app)/index.tsx');

    it('routes the first-machine action to the invite import surface', () => {
        expect(home).toContain("router.push('/server')");
        expect(home).toContain("t('welcome.pairMachine')");
    });

    it('does not run any GitHub device-code or Dev Tunnels discovery during pairing', () => {
        expect(home).not.toContain('DevTunnelsClientProvider');
        expect(home).not.toContain('fetchGitHubUserProfile');
        expect(home).not.toContain('openGitHubDeviceFlow');
        expect(home).not.toContain('getDevTunnelsToken');
        expect(home).not.toContain('deviceFlowInfo');
        expect(home).not.toContain('@/auth/pairing');
    });
});
