import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
    session: null as { metadata: { flavor?: string } | null } | null,
    routeId: 'session-1',
}));

vi.mock('expo-router', () => ({
    useLocalSearchParams: () => ({ id: shared.routeId, messageId: 'message-1' }),
    useRouter: () => ({ back: vi.fn() }),
    Stack: { Screen: 'StackScreen' },
}));

vi.mock('@/sync/storage', () => ({
    useSession: () => shared.session,
    useMessage: () => null,
    useSessionMessages: () => ({ isLoaded: true }),
    isCopilotSession: (s: { metadata?: { flavor?: string } | null } | null | undefined) => s?.metadata?.flavor === 'copilot',
    isPlaceholderSession: (s: { metadata?: unknown } | null | undefined) => !!s && (s as { metadata?: unknown }).metadata === null,
}));

vi.mock('react-native', () => ({
    Text: 'Text',
    View: 'View',
    ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('react-native-reanimated', () => ({ useSharedValue: (v: unknown) => ({ value: v }) }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (f: (t: unknown) => Record<string, unknown>) => f({ colors: new Proxy({}, { get: () => '#000' }) }) },
    useUnistyles: () => ({ theme: { colors: new Proxy({}, { get: () => '#000' }) } }),
}));
vi.mock('@/sync/sync', () => ({ sync: { onSessionVisible: vi.fn(), onActiveSessionChanged: vi.fn() } }));
vi.mock('@/components/Deferred', () => ({ Deferred: 'Deferred' }));
vi.mock('@/components/tools/ToolFullView', () => ({ ToolFullView: 'ToolFullView' }));
vi.mock('@/components/tools/ToolHeader', () => ({ ToolHeader: 'ToolHeader' }));
vi.mock('@/components/tools/ToolStatusIndicator', () => ({ ToolStatusIndicator: 'ToolStatusIndicator' }));
vi.mock('@/components/ChatScaleLiveContext', () => ({ ChatScaleLiveContext: { Provider: 'Provider' } }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));

const MessageDetailGate = (await import('./[messageId]')).default as unknown as {
    type: () => React.ReactElement | null;
};

describe('MessageDetail gate (M1a fail-closed)', () => {
    beforeEach(() => {
        shared.routeId = 'session-1';
    });

    it('renders (non-null) for a normal session', () => {
        shared.session = { metadata: { flavor: 'codex' } };
        expect(MessageDetailGate.type()).not.toBeNull();
    });

    it('fails closed (null) for a Copilot mirror session', () => {
        shared.session = { metadata: { flavor: 'copilot' } };
        expect(MessageDetailGate.type()).toBeNull();
    });

    it('fails closed (null) for an unknown placeholder session', () => {
        shared.session = { metadata: null };
        expect(MessageDetailGate.type()).toBeNull();
    });
});
