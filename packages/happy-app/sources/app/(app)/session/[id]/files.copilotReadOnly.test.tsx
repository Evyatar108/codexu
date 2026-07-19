import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
    session: null as { metadata: { flavor?: string } | null } | null,
    routeId: 'session-1',
}));

vi.mock('expo-router', () => ({
    useLocalSearchParams: () => ({ id: shared.routeId }),
    useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/sync/storage', () => ({
    useSession: () => shared.session,
    useSessionGitStatus: () => null,
    isCopilotSession: (s: { metadata?: { flavor?: string } | null } | null | undefined) => s?.metadata?.flavor === 'copilot',
    isPlaceholderSession: (s: { metadata?: unknown } | null | undefined) => !!s && (s as { metadata?: unknown }).metadata === null,
}));

// FilesScreenInner must never mount for read-only sessions, so its heavy deps
// are only present to satisfy the module graph.
vi.mock('react-native', () => ({
    View: 'View',
    ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web ?? o.default },
    TextInput: 'TextInput',
}));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (f: (t: unknown) => Record<string, unknown>) => f({}) },
    useUnistyles: () => ({ theme: { colors: new Proxy({}, { get: () => '#000' }) } }),
}));
vi.mock('@/text', () => ({ t: (k: string) => k }));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ItemList', () => ({ ItemList: 'ItemList' }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('@/components/FileIcon', () => ({ FileIcon: 'FileIcon' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@expo/vector-icons', () => ({ Octicons: 'Octicons' }));
vi.mock('@/sync/gitStatusFiles', () => ({ GitFileStatus: {} }));
vi.mock('@/sync/suggestionFile', () => ({ searchFiles: vi.fn(), FileItem: {} }));
vi.mock('@/hooks/useGitStatusFiles', () => ({ useGitStatusFiles: () => ({ data: null, isLoading: false }) }));
vi.mock('@/hooks/usePrefetchFileContents', () => ({ usePrefetchFileContents: vi.fn() }));
vi.mock('@/utils/base64url', () => ({ encodeBase64Url: (v: string) => v }));

const FilesScreenGate = (await import('./files')).default as unknown as {
    type: () => React.ReactElement | null;
};

describe('FilesScreen gate (M1a fail-closed)', () => {
    beforeEach(() => {
        shared.routeId = 'session-1';
    });

    it('renders (non-null) for a normal session', () => {
        shared.session = { metadata: { flavor: 'codex' } };
        expect(FilesScreenGate.type()).not.toBeNull();
    });

    it('fails closed (null) for a Copilot mirror session', () => {
        shared.session = { metadata: { flavor: 'copilot' } };
        expect(FilesScreenGate.type()).toBeNull();
    });

    it('fails closed (null) for an unknown placeholder session', () => {
        shared.session = { metadata: null };
        expect(FilesScreenGate.type()).toBeNull();
    });
});
