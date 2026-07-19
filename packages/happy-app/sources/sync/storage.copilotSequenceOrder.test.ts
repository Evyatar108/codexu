import { describe, expect, it, vi } from 'vitest';
import type { Session } from './storageTypes';

/**
 * M1a: read-only Copilot mirror predicates + durable-message total-order
 * comparators. Copilot mirrors can emit several durable events within the same
 * millisecond, so `createdAt` alone is not a total order; the comparators break
 * ties on the server-assigned `seq`. The predicates decide which sessions get
 * their phone-side mutation affordances suppressed.
 */

vi.mock('@/utils/sessionUtils', () => ({
    getSessionName: () => 'Test Session',
    getSessionSubtitle: () => 'Test Project',
    getSessionAvatarId: () => 'test-avatar',
}));

vi.mock('@/components/tools/knownTools', () => ({
    isMutableTool: () => true,
}));

vi.mock('./projectManager', () => ({
    projectManager: {
        updateSessions: vi.fn(),
        updateSessionProjectGitStatus: vi.fn(),
        getProjects: () => [],
        getProject: () => null,
        getProjectForSession: () => null,
        getProjectSessions: () => [],
        getProjectGitStatus: () => null,
        getSessionProjectGitStatus: () => null,
    },
}));

vi.mock('./sync', () => ({
    sync: {
        applySettings: vi.fn(),
    },
}));

vi.mock('expo-modules-core', () => ({
    requireOptionalNativeModule: () => null,
}));

import {
    isCopilotSession,
    isPlaceholderSession,
    isReadOnlySession,
    compareMessagesAscending,
    compareMessagesDescending,
} from './storage';

function baseSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        seq: 1,
        createdAt: 100,
        updatedAt: 100,
        active: true,
        activeAt: 100,
        metadata: {
            path: '/repo',
            host: 'devbox',
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 100,
        ...overrides,
    } as Session;
}

describe('isCopilotSession', () => {
    it('is true only for the copilot flavor', () => {
        expect(isCopilotSession(baseSession({ metadata: { path: '/r', host: 'h', flavor: 'copilot' } as Session['metadata'] }))).toBe(true);
    });

    it('is false for other flavors, missing metadata, null, and undefined', () => {
        expect(isCopilotSession(baseSession({ metadata: { path: '/r', host: 'h', flavor: 'codex' } as Session['metadata'] }))).toBe(false);
        expect(isCopilotSession(baseSession({ metadata: { path: '/r', host: 'h' } as Session['metadata'] }))).toBe(false);
        expect(isCopilotSession(baseSession({ metadata: null }))).toBe(false);
        expect(isCopilotSession(null)).toBe(false);
        expect(isCopilotSession(undefined)).toBe(false);
    });
});

describe('isPlaceholderSession', () => {
    it('is false for an undefined session so not-yet-in-store deep links keep provider behavior', () => {
        expect(isPlaceholderSession(undefined)).toBe(false);
    });

    it('is true for a null-metadata (not-yet-hydrated) row', () => {
        expect(isPlaceholderSession(baseSession({ metadata: null }))).toBe(true);
    });

    it('is true for the exact synthesized placeholder shape', () => {
        // sync.ts synthesizes { path:'', host:'', machineId } at metadataVersion 0 with no flavor.
        const placeholder = baseSession({
            metadataVersion: 0,
            metadata: { path: '', host: '', machineId: 'm1' } as Session['metadata'],
        });
        expect(isPlaceholderSession(placeholder)).toBe(true);
    });

    it('is false once real metadata (path/host or a bumped version) arrives', () => {
        expect(isPlaceholderSession(baseSession())).toBe(false);
        expect(isPlaceholderSession(baseSession({
            metadataVersion: 1,
            metadata: { path: '', host: '', machineId: 'm1' } as Session['metadata'],
        }))).toBe(false);
    });

    it('is false for a copilot session (a hydrated flavor is not a placeholder)', () => {
        expect(isPlaceholderSession(baseSession({
            metadataVersion: 0,
            metadata: { path: '', host: '', machineId: 'm1', flavor: 'copilot' } as Session['metadata'],
        }))).toBe(false);
    });
});

describe('isReadOnlySession', () => {
    it('is true for copilot mirrors and placeholders, false for hydrated non-copilot', () => {
        expect(isReadOnlySession(baseSession({ metadata: { path: '/r', host: 'h', flavor: 'copilot' } as Session['metadata'] }))).toBe(true);
        expect(isReadOnlySession(baseSession({ metadata: null }))).toBe(true);
        expect(isReadOnlySession(baseSession())).toBe(false);
        expect(isReadOnlySession(undefined)).toBe(false);
    });
});

describe('durable-message comparators', () => {
    it('ascending: createdAt dominates, seq breaks ties, equal keys preserve stable order', () => {
        expect(compareMessagesAscending({ createdAt: 1, seq: 9 }, { createdAt: 2, seq: 1 })).toBeLessThan(0);
        expect(compareMessagesAscending({ createdAt: 5, seq: 2 }, { createdAt: 5, seq: 7 })).toBeLessThan(0);
        expect(compareMessagesAscending({ createdAt: 5, seq: 7 }, { createdAt: 5, seq: 2 })).toBeGreaterThan(0);
        expect(compareMessagesAscending({ createdAt: 5, seq: 3 }, { createdAt: 5, seq: 3 })).toBe(0);
    });

    it('descending: newest createdAt first, higher seq first on ties', () => {
        expect(compareMessagesDescending({ createdAt: 2, seq: 1 }, { createdAt: 1, seq: 9 })).toBeLessThan(0);
        expect(compareMessagesDescending({ createdAt: 5, seq: 7 }, { createdAt: 5, seq: 2 })).toBeLessThan(0);
        expect(compareMessagesDescending({ createdAt: 5, seq: 2 }, { createdAt: 5, seq: 7 })).toBeGreaterThan(0);
        expect(compareMessagesDescending({ createdAt: 5, seq: 3 }, { createdAt: 5, seq: 3 })).toBe(0);
    });

    it('sorts same-millisecond Copilot events by seq (ascending)', () => {
        const rows = [
            { createdAt: 1000, seq: 3 },
            { createdAt: 1000, seq: 1 },
            { createdAt: 1000, seq: 2 },
            { createdAt: 999, seq: 99 },
        ];
        const sorted = [...rows].sort(compareMessagesAscending);
        expect(sorted.map((r) => r.seq)).toEqual([99, 1, 2, 3]);
    });

    it('sorts same-millisecond Copilot events by seq (descending, display order)', () => {
        const rows = [
            { createdAt: 1000, seq: 1 },
            { createdAt: 1000, seq: 3 },
            { createdAt: 1000, seq: 2 },
            { createdAt: 1001, seq: 1 },
        ];
        const sorted = [...rows].sort(compareMessagesDescending);
        expect(sorted.map((r) => `${r.createdAt}:${r.seq}`)).toEqual(['1001:1', '1000:3', '1000:2', '1000:1']);
    });

    it('keeps a pending optimistic row (MAX seq, newest createdAt) at the newest position', () => {
        const pendingSeq = Number.MAX_SAFE_INTEGER;
        const rows = [
            { createdAt: 100, seq: 1 },
            { createdAt: 200, seq: 2 },
            { createdAt: 300, seq: pendingSeq },
        ];
        const asc = [...rows].sort(compareMessagesAscending);
        expect(asc[asc.length - 1].seq).toBe(pendingSeq);
        const desc = [...rows].sort(compareMessagesDescending);
        expect(desc[0].seq).toBe(pendingSeq);
    });
});
