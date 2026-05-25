import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { MMKV } from 'react-native-mmkv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from './storageTypes';
import type { SessionListViewItem, TreeSessionRowData } from './storage';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/utils/sessionUtils', () => ({
    getSessionName: (session: Session) => session.metadata?.name ?? session.id,
    getSessionSubtitle: (session: Session) => session.metadata?.path ?? '',
    getSessionAvatarId: (session: Session) => `avatar-${session.id}`,
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

type TestSession = Omit<Session, 'presence' | 'permissionModeUserChosen'> & {
    permissionModeUserChosen?: boolean;
};

type RowSummary =
    | { type: 'active'; id: string; name: string; machineId: string | null; path: string | null; active: boolean; depth: number; hasChildren: boolean }
    | { type: 'header'; title: string }
    | { type: 'session'; id: string; name: string; group: string; machineId: string | null; path: string | null; active: boolean; depth: number; hasChildren: boolean };

const now = Date.parse('2026-05-25T12:00:00Z');

function createSession(id: string, overrides: Partial<TestSession> = {}): TestSession {
    const machineId = id.includes(':') ? id.split(':')[0] : 'm1';
    return {
        id,
        seq: 1,
        createdAt: now,
        updatedAt: now,
        active: true,
        activeAt: now,
        metadata: {
            path: '/repo',
            host: machineId,
            machineId,
            name: id,
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        ...overrides,
    };
}

function withMetadata(base: TestSession, metadata: Partial<NonNullable<Session['metadata']>>): TestSession {
    return {
        ...base,
        metadata: {
            ...base.metadata!,
            ...metadata,
        },
    };
}

async function importFreshStorage() {
    const module = await import('./storage');
    return module.storage;
}

function summarize(data: SessionListViewItem[] | null): RowSummary[] {
    const rows: RowSummary[] = [];
    let group = '';

    for (const item of data ?? []) {
        if (item.type === 'active-sessions') {
            for (const session of item.sessions) {
                rows.push(summaryForTreeRow('active', session));
            }
        } else if (item.type === 'header') {
            group = item.title;
            rows.push({ type: 'header', title: item.title });
        } else if (item.type === 'session') {
            rows.push({
                ...summaryForTreeRow('session', item.session),
                group,
            });
        }
    }

    return rows;
}

function summaryForTreeRow(type: 'active', session: TreeSessionRowData): Extract<RowSummary, { type: 'active' }>;
function summaryForTreeRow(type: 'session', session: TreeSessionRowData): Omit<Extract<RowSummary, { type: 'session' }>, 'group'>;
function summaryForTreeRow(type: 'active' | 'session', session: TreeSessionRowData) {
    return {
        type,
        id: session.id,
        name: session.name,
        machineId: session.machineId,
        path: session.path,
        active: session.active,
        depth: session.depth,
        hasChildren: session.hasChildren,
    };
}

function rowById(rows: RowSummary[], id: string) {
    const row = rows.find((entry) => 'id' in entry && entry.id === id);
    if (!row || !('id' in row)) {
        throw new Error(`Missing row ${id}`);
    }
    return row;
}

function renderVisibleData(useVisibleSessionListViewData: () => SessionListViewItem[] | null) {
    let latest: SessionListViewItem[] | null = null;
    let renderer: ReturnType<typeof TestRenderer.create> | null = null;

    function Harness() {
        latest = useVisibleSessionListViewData();
        return null;
    }

    act(() => {
        renderer = TestRenderer.create(React.createElement(Harness));
    });

    return {
        get current() {
            return latest;
        },
        unmount() {
            act(() => {
                renderer?.unmount();
            });
        },
    };
}

describe('storage session tree derivation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-25T12:00:00Z'));
        new MMKV().clearAll();
        vi.resetModules();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('places all-active same-machine same-path sessions in DFS pre-order', async () => {
        const storage = await importFreshStorage();

        storage.getState().applySessions([
            withMetadata(createSession('m1:parent', { updatedAt: now + 400 }), { spawnedChildren: ['m1:child', 'm1:sibling'] }),
            withMetadata(createSession('m1:child', { updatedAt: now + 300 }), { spawnedChildren: ['m1:grandchild'] }),
            createSession('m1:grandchild', { updatedAt: now + 200 }),
            createSession('m1:sibling', { updatedAt: now + 100 }),
        ]);

        const rows = summarize(storage.getState().sessionListViewData);

        expect(rows).toMatchInlineSnapshot(`
          [
            {
              "active": true,
              "depth": 0,
              "hasChildren": true,
              "id": "m1:parent",
              "machineId": "m1",
              "name": "m1:parent",
              "path": "/repo",
              "type": "active",
            },
            {
              "active": true,
              "depth": 1,
              "hasChildren": true,
              "id": "m1:child",
              "machineId": "m1",
              "name": "m1:child",
              "path": "/repo",
              "type": "active",
            },
            {
              "active": true,
              "depth": 2,
              "hasChildren": false,
              "id": "m1:grandchild",
              "machineId": "m1",
              "name": "m1:grandchild",
              "path": "/repo",
              "type": "active",
            },
            {
              "active": true,
              "depth": 1,
              "hasChildren": false,
              "id": "m1:sibling",
              "machineId": "m1",
              "name": "m1:sibling",
              "path": "/repo",
              "type": "active",
            },
          ]
        `);
        expect(rows.map((row) => 'id' in row ? row.id : row.title)).toEqual(['m1:parent', 'm1:child', 'm1:grandchild', 'm1:sibling']);
        expect(rowById(rows, 'm1:parent')).toMatchObject({ type: 'active', depth: 0, hasChildren: true });
        expect(rowById(rows, 'm1:child')).toMatchObject({ type: 'active', depth: 1, hasChildren: true });
        expect(rowById(rows, 'm1:grandchild')).toMatchObject({ type: 'active', depth: 2, hasChildren: false });
        expect(rowById(rows, 'm1:sibling')).toMatchObject({ type: 'active', depth: 1, hasChildren: false });
    });

    it('keeps an inactive child under an active same-machine same-path parent', async () => {
        const storage = await importFreshStorage();

        storage.getState().applySessions([
            withMetadata(createSession('m1:active-parent', { updatedAt: now + 200 }), { spawnedChildren: ['m1:inactive-child'] }),
            createSession('m1:inactive-child', { active: false, createdAt: now - 1000, activeAt: now - 1000, updatedAt: now + 100 }),
        ]);

        const rows = summarize(storage.getState().sessionListViewData);

        expect(rows).toMatchInlineSnapshot(`
          [
            {
              "active": true,
              "depth": 0,
              "hasChildren": true,
              "id": "m1:active-parent",
              "machineId": "m1",
              "name": "m1:active-parent",
              "path": "/repo",
              "type": "active",
            },
            {
              "active": false,
              "depth": 1,
              "hasChildren": false,
              "id": "m1:inactive-child",
              "machineId": "m1",
              "name": "m1:inactive-child",
              "path": "/repo",
              "type": "active",
            },
          ]
        `);
        expect(rowById(rows, 'm1:active-parent')).toMatchObject({ type: 'active', active: true, depth: 0, hasChildren: true });
        expect(rowById(rows, 'm1:inactive-child')).toMatchObject({ type: 'active', active: false, depth: 1, hasChildren: false });
    });

    it('nests all-inactive same-date same-machine same-path sessions under their date header', async () => {
        const storage = await importFreshStorage();

        storage.getState().applySessions([
            withMetadata(createSession('m1:inactive-parent', { active: false, createdAt: now - 1000, activeAt: now - 1000, updatedAt: now + 200 }), { spawnedChildren: ['m1:inactive-child'] }),
            createSession('m1:inactive-child', { active: false, createdAt: now - 2000, activeAt: now - 2000, updatedAt: now + 100 }),
        ]);

        const rows = summarize(storage.getState().sessionListViewData);

        expect(rows).toMatchInlineSnapshot(`
          [
            {
              "title": "Today",
              "type": "header",
            },
            {
              "active": false,
              "depth": 0,
              "group": "Today",
              "hasChildren": true,
              "id": "m1:inactive-parent",
              "machineId": "m1",
              "name": "m1:inactive-parent",
              "path": "/repo",
              "type": "session",
            },
            {
              "active": false,
              "depth": 1,
              "group": "Today",
              "hasChildren": false,
              "id": "m1:inactive-child",
              "machineId": "m1",
              "name": "m1:inactive-child",
              "path": "/repo",
              "type": "session",
            },
          ]
        `);
        expect(rowById(rows, 'm1:inactive-parent')).toMatchObject({ type: 'session', group: 'Today', depth: 0, hasChildren: true });
        expect(rowById(rows, 'm1:inactive-child')).toMatchObject({ type: 'session', group: 'Today', depth: 1, hasChildren: false });
    });

    it('(g) cross-group: inactive parent today + active child same machine+path → active child orphan', async () => {
        const storage = await importFreshStorage();

        storage.getState().applySessions([
            withMetadata(
                createSession('m1:inactive-parent', {
                    active: false,
                    createdAt: now - 1000,
                    activeAt: now - 1000,
                    updatedAt: now + 200,
                }),
                { spawnedChildren: ['m1:active-child'] },
            ),
            withMetadata(
                createSession('m1:active-child', { updatedAt: now + 100 }),
                { parentSessionId: 'm1:inactive-parent' },
            ),
        ]);

        const rows = summarize(storage.getState().sessionListViewData);

        expect(rows).toMatchInlineSnapshot(`
          [
            {
              "active": true,
              "depth": 0,
              "hasChildren": false,
              "id": "m1:active-child",
              "machineId": "m1",
              "name": "m1:active-child",
              "path": "/repo",
              "type": "active",
            },
            {
              "title": "Today",
              "type": "header",
            },
            {
              "active": false,
              "depth": 0,
              "group": "Today",
              "hasChildren": false,
              "id": "m1:inactive-parent",
              "machineId": "m1",
              "name": "m1:inactive-parent",
              "path": "/repo",
              "type": "session",
            },
          ]
        `);
        expect(rowById(rows, 'm1:active-child')).toMatchObject({ type: 'active', depth: 0, hasChildren: false });
        expect(rowById(rows, 'm1:inactive-parent')).toMatchObject({ type: 'session', group: 'Today', depth: 0, hasChildren: false });
    });

    it('emits cross-machine children as depth-0 orphans', async () => {
        const storage = await importFreshStorage();

        storage.getState().applySessions([
            withMetadata(createSession('m1:parent', { updatedAt: now + 200 }), { spawnedChildren: ['m2:child'] }),
            createSession('m2:child', { updatedAt: now + 100 }),
        ]);

        const rows = summarize(storage.getState().sessionListViewData);

        expect(rows).toMatchInlineSnapshot(`
          [
            {
              "active": true,
              "depth": 0,
              "hasChildren": false,
              "id": "m1:parent",
              "machineId": "m1",
              "name": "m1:parent",
              "path": "/repo",
              "type": "active",
            },
            {
              "active": true,
              "depth": 0,
              "hasChildren": false,
              "id": "m2:child",
              "machineId": "m2",
              "name": "m2:child",
              "path": "/repo",
              "type": "active",
            },
          ]
        `);
        expect(rowById(rows, 'm1:parent')).toMatchObject({ type: 'active', machineId: 'm1', depth: 0, hasChildren: false });
        expect(rowById(rows, 'm2:child')).toMatchObject({ type: 'active', machineId: 'm2', depth: 0, hasChildren: false });
    });

    it('emits cross-project children as depth-0 orphans', async () => {
        const storage = await importFreshStorage();

        storage.getState().applySessions([
            withMetadata(createSession('m1:parent', { updatedAt: now + 200 }), { path: '/repo-a', spawnedChildren: ['m1:child'] }),
            withMetadata(createSession('m1:child', { updatedAt: now + 100 }), { path: '/repo-b' }),
        ]);

        const rows = summarize(storage.getState().sessionListViewData);

        expect(rows).toMatchInlineSnapshot(`
          [
            {
              "active": true,
              "depth": 0,
              "hasChildren": false,
              "id": "m1:parent",
              "machineId": "m1",
              "name": "m1:parent",
              "path": "/repo-a",
              "type": "active",
            },
            {
              "active": true,
              "depth": 0,
              "hasChildren": false,
              "id": "m1:child",
              "machineId": "m1",
              "name": "m1:child",
              "path": "/repo-b",
              "type": "active",
            },
          ]
        `);
        expect(rowById(rows, 'm1:parent')).toMatchObject({ type: 'active', path: '/repo-a', depth: 0, hasChildren: false });
        expect(rowById(rows, 'm1:child')).toMatchObject({ type: 'active', path: '/repo-b', depth: 0, hasChildren: false });
    });

    it('sweeps rootless cycles into the list as depth-0 orphans and warns for each member', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const storage = await importFreshStorage();

        storage.getState().applySessions([
            withMetadata(createSession('m1:cycle-a', { updatedAt: now + 200 }), { parentSessionId: 'm1:cycle-b' }),
            withMetadata(createSession('m1:cycle-b', { updatedAt: now + 100 }), { parentSessionId: 'm1:cycle-a' }),
        ]);

        const rows = summarize(storage.getState().sessionListViewData);

        expect(rows).toMatchInlineSnapshot(`
          [
            {
              "active": true,
              "depth": 0,
              "hasChildren": false,
              "id": "m1:cycle-a",
              "machineId": "m1",
              "name": "m1:cycle-a",
              "path": "/repo",
              "type": "active",
            },
            {
              "active": true,
              "depth": 0,
              "hasChildren": false,
              "id": "m1:cycle-b",
              "machineId": "m1",
              "name": "m1:cycle-b",
              "path": "/repo",
              "type": "active",
            },
          ]
        `);
        expect(warnSpy).toHaveBeenCalledWith('mobile-tree-view: rootless cycle, emitting m1:cycle-a as orphan');
        expect(warnSpy).toHaveBeenCalledWith('mobile-tree-view: rootless cycle, emitting m1:cycle-b as orphan');
        expect(rowById(rows, 'm1:cycle-a')).toMatchObject({ type: 'active', depth: 0, hasChildren: false });
        expect(rowById(rows, 'm1:cycle-b')).toMatchObject({ type: 'active', depth: 0, hasChildren: false });
        warnSpy.mockRestore();
    });

    it('filters visible rows through expand, collapse, and MMKV reload', async () => {
        const storage = await importFreshStorage();
        const { toggle, isExpanded } = await import('@/hooks/useSessionTreeExpansion');
        const { useVisibleSessionListViewData } = await import('@/hooks/useVisibleSessionListViewData');

        storage.getState().applySessions([
            withMetadata(createSession('m1:parent', { updatedAt: now + 200 }), { spawnedChildren: ['m1:child'] }),
            createSession('m1:child', { updatedAt: now + 100 }),
        ]);
        storage.getState().applyReady();

        const hook = renderVisibleData(useVisibleSessionListViewData);

        expect(summarize(hook.current).map((row) => 'id' in row ? `${row.id}:${row.depth}` : row.title)).toEqual(['m1:parent:0']);

        act(() => {
            toggle('m1:parent');
        });

        expect(isExpanded('m1:parent')).toBe(true);
        expect(summarize(hook.current).map((row) => 'id' in row ? `${row.id}:${row.depth}` : row.title)).toEqual(['m1:parent:0', 'm1:child:1']);

        act(() => {
            toggle('m1:parent');
        });

        expect(isExpanded('m1:parent')).toBe(false);
        expect(summarize(hook.current).map((row) => 'id' in row ? `${row.id}:${row.depth}` : row.title)).toEqual(['m1:parent:0']);

        act(() => {
            toggle('m1:parent');
        });

        vi.resetModules();
        const reloadedExpansion = await import('@/hooks/useSessionTreeExpansion');

        expect(reloadedExpansion.isExpanded('m1:parent')).toBe(true);
        hook.unmount();
    });
});
