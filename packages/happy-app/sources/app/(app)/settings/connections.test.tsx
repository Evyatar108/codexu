import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ItemProps = Record<string, unknown>;

const h = vi.hoisted(() => ({
    controller: {
        status: 'disconnected' as string,
        connectedLogin: null as string | null,
        busy: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        reload: vi.fn(),
    },
    happyLoading: false,
    items: [] as ItemProps[],
}));

vi.mock('@/hooks/useGithubConnection', () => ({ useGithubConnection: () => h.controller }));
vi.mock('@/hooks/useHappyAction', () => ({ useHappyAction: (fn: () => Promise<void>) => [h.happyLoading, fn] }));
vi.mock('@/modal', () => ({ Modal: { confirm: vi.fn() } }));
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({ theme: { colors: { text: '#000', textSecondary: '#555', textDestructive: '#f00', status: { connected: '#0a0' } } } }),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('@/components/Item', () => ({
    Item: (props: ItemProps) => {
        h.items.push(props);
        return null;
    },
}));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: (props: { children?: React.ReactNode }) => props.children ?? null }));
vi.mock('@/components/ItemList', () => ({ ItemList: (props: { children?: React.ReactNode }) => props.children ?? null }));
vi.mock('@/text', () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key) }));

import ConnectionsScreen from './connections';

async function render(): Promise<ItemProps> {
    h.items = [];
    await act(async () => {
        TestRenderer.create(React.createElement(ConnectionsScreen));
    });
    // The GitHub item is the only Item rendered by this screen.
    return h.items[h.items.length - 1]!;
}

describe('ConnectionsScreen GitHub item (e-ink: no animated loading)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.happyLoading = false;
        h.controller.busy = false;
        h.controller.status = 'disconnected';
        h.controller.connectedLogin = null;
    });

    it('never passes an animated loading prop while connecting, and disables the action', async () => {
        h.happyLoading = true; // useHappyAction reports the connect action in flight
        const item = await render();
        expect(item).not.toHaveProperty('loading');
        expect(item.subtitle).toBe('connections.connecting');
        expect(item.onPress).toBeUndefined(); // disabled while busy
    });

    it('shows a tappable connect action with static text when idle', async () => {
        const item = await render();
        expect(item).not.toHaveProperty('loading');
        expect(item.subtitle).toBe('connections.connect');
        expect(typeof item.onPress).toBe('function');
    });

    it('never passes an animated loading prop while disconnecting, using dedicated static copy', async () => {
        h.controller.status = 'connected';
        h.controller.connectedLogin = 'octocat';
        h.happyLoading = true; // disconnect action in flight
        const item = await render();
        expect(item).not.toHaveProperty('loading');
        expect(item.detail).toBe('connections.disconnecting');
        expect(item.detail).not.toBe('connections.connecting');
        expect(item.onPress).toBeUndefined(); // disabled while busy
    });

    it('shows a tappable disconnect action with static text when connected and idle', async () => {
        h.controller.status = 'connected';
        h.controller.connectedLogin = 'octocat';
        const item = await render();
        expect(item).not.toHaveProperty('loading');
        expect(item.detail).toBe('connections.disconnect');
        expect(typeof item.onPress).toBe('function');
    });
});
