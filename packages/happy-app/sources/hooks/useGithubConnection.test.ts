import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    creds: { authMode: 'paired-device', machineId: 'm', tunnelUrl: 'https://srv', firstSeenAt: 1 },
    profile: { github: null as null | { login: string } },
    fetchParams: vi.fn(),
    disconnect: vi.fn(),
    openBrowser: vi.fn(),
    refreshProfile: vi.fn(),
}));

vi.mock('expo-web-browser', () => ({ openBrowserAsync: h.openBrowser }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: h.creds }) }));
vi.mock('@/sync/storage', () => ({ useProfile: () => h.profile }));
vi.mock('@/sync/sync', () => ({ sync: { refreshProfile: h.refreshProfile } }));
vi.mock('@/sync/githubConnection', () => ({
    fetchGithubConnectParams: h.fetchParams,
    disconnectGithub: h.disconnect,
}));

import { useGithubConnection, type GithubConnectionController } from './useGithubConnection';

async function renderHook(): Promise<{ current: GithubConnectionController }> {
    const ref: { current: GithubConnectionController } = { current: null as any };
    function Probe() {
        ref.current = useGithubConnection();
        return null;
    }
    await act(async () => {
        TestRenderer.create(React.createElement(Probe));
    });
    return ref;
}

describe('useGithubConnection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.profile = { github: null };
        h.openBrowser.mockResolvedValue({ type: 'dismiss' });
        h.refreshProfile.mockResolvedValue(undefined);
    });

    it('reports unavailable when the server has no GitHub OAuth app', async () => {
        h.fetchParams.mockResolvedValue({ enabled: false });
        const hook = await renderHook();
        expect(hook.current.status).toBe('unavailable');
    });

    it('reports error when params fail to load', async () => {
        h.fetchParams.mockRejectedValue(new Error('boom'));
        const hook = await renderHook();
        expect(hook.current.status).toBe('error');
    });

    it('connects by opening the authorize URL then refreshing the profile', async () => {
        h.fetchParams.mockResolvedValue({ enabled: true, url: 'https://github.test/authorize' });
        const hook = await renderHook();
        expect(hook.current.status).toBe('disconnected');

        await act(async () => {
            await hook.current.connect();
        });

        expect(h.openBrowser).toHaveBeenCalledWith('https://github.test/authorize');
        expect(h.refreshProfile).toHaveBeenCalled();
    });

    it('shows connected state and disconnects through the server route', async () => {
        h.fetchParams.mockResolvedValue({ enabled: true, url: 'https://github.test/authorize' });
        h.profile = { github: { login: 'octocat' } };
        h.disconnect.mockResolvedValue(undefined);
        const hook = await renderHook();
        expect(hook.current.status).toBe('connected');
        expect(hook.current.connectedLogin).toBe('octocat');

        await act(async () => {
            await hook.current.disconnect();
        });

        expect(h.disconnect).toHaveBeenCalledWith(h.creds);
        expect(h.refreshProfile).toHaveBeenCalled();
    });
});
