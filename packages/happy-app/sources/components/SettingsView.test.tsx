import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
    return readFileSync(resolve(__dirname, '..', path), 'utf8');
}

describe('SettingsView machine + connected-service surfaces', () => {
    const settings = source('components/SettingsView.tsx');

    it('adds another machine through the invite flow, not Dev Tunnels discovery', () => {
        expect(settings).toContain("router.push('/server')");
        expect(settings).not.toContain('DevTunnelsClientProvider');
        expect(settings).not.toContain('acquireConnectTokenForPair');
        expect(settings).not.toContain('fetchGitHubUserProfile');
        expect(settings).not.toContain('@/auth/pairing');
    });

    it('exposes the optional GitHub connected service screen', () => {
        expect(settings).toContain("router.push('/settings/connections')");
        expect(settings).toContain("t('settings.connectedServices')");
    });
});
