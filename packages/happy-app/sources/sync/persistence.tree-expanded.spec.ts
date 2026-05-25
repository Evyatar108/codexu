import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();

describe('session tree expansion persistence', () => {
    beforeEach(() => {
        storage.clearAll();
        vi.resetModules();
    });

    it('returns an empty map for malformed JSON', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        storage.set('session-tree-expanded-v1', '{not valid json');

        const { loadSessionTreeExpanded } = await import('./persistence');

        expect(loadSessionTreeExpanded()).toEqual({});
        expect(errorSpy).toHaveBeenCalledWith(
            'Failed to parse session tree expanded state',
            expect.any(SyntaxError),
        );
        errorSpy.mockRestore();
    });

    it('persists only-expanded keys under the session tree key', async () => {
        const { loadSessionTreeExpanded, saveSessionTreeExpanded } = await import('./persistence');

        saveSessionTreeExpanded({ 'session-a': true, 'session-b': true });

        expect(storage.getString('session-tree-expanded-v1')).toBe(JSON.stringify({
            'session-a': true,
            'session-b': true,
        }));
        expect(loadSessionTreeExpanded()).toEqual({
            'session-a': true,
            'session-b': true,
        });
    });

    it('toggles through the zustand store, writes MMKV immediately, and hydrates on reload', async () => {
        let expansion = await import('@/hooks/useSessionTreeExpansion');

        expect(expansion.isExpanded('session-a')).toBe(false);
        expansion.toggle('session-a');

        expect(expansion.isExpanded('session-a')).toBe(true);
        expect(JSON.parse(storage.getString('session-tree-expanded-v1') ?? '{}')).toEqual({
            'session-a': true,
        });

        vi.resetModules();
        expansion = await import('@/hooks/useSessionTreeExpansion');

        expect(expansion.isExpanded('session-a')).toBe(true);

        expansion.toggle('session-a');

        expect(expansion.isExpanded('session-a')).toBe(false);
        expect(JSON.parse(storage.getString('session-tree-expanded-v1') ?? '{}')).toEqual({});
    });
});
