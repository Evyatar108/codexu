import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { MailboxEntry } from './mailbox';
import {
    recoverDaemonInjectState,
    buildRecoveryInjection,
    entryIdempotencyKey,
    defaultRecoveryInjector,
    type RecoveryInjector,
    type DaemonRecoveryDeps,
} from './daemonRecovery';

function entry(seq: number, id: string, sender = 'lead'): MailboxEntry {
    return { version: 1, seq, id, appendedAt: 1000 + seq, sender, body: { text: `m${seq}` } };
}

/** A deps bundle whose I/O is fully mocked; overrides win. */
function deps(overrides: Partial<DaemonRecoveryDeps> = {}): {
    d: DaemonRecoveryDeps;
    inject: ReturnType<typeof vi.fn>;
    markInjected: ReturnType<typeof vi.fn>;
} {
    const inject = vi.fn(
        async (_session: string, entries: MailboxEntry[]) => ({ injected: true, lastSeq: entries[entries.length - 1].seq }),
    );
    const markInjected = vi.fn(async () => undefined);
    const d: DaemonRecoveryDeps = {
        listInboxes: async () => [],
        readUnobserved: async () => [],
        inject: inject as unknown as RecoveryInjector,
        markInjected,
        ...overrides,
    };
    return { d, inject, markInjected };
}

describe('entryIdempotencyKey / buildRecoveryInjection', () => {
    it('uses the stable entry id as the idempotency key', () => {
        expect(entryIdempotencyKey(entry(3, 'abc'))).toBe('abc');
    });

    it('produces one deterministic key per entry and the batch lastSeq', () => {
        const entries = [entry(4, 'a'), entry(5, 'b'), entry(6, 'c')];
        const built = buildRecoveryInjection(entries);
        expect(built.idempotencyKeys).toEqual(['a', 'b', 'c']);
        expect(built.lastSeq).toBe(6);
        expect(built.text).toContain('3 pending');
    });

    it('is deterministic across two passes over the same entries (no dup on replay)', () => {
        const entries = [entry(4, 'a'), entry(5, 'b')];
        const first = buildRecoveryInjection(entries);
        const second = buildRecoveryInjection(entries);
        expect(second.idempotencyKeys).toEqual(first.idempotencyKeys);
        expect(second.lastSeq).toBe(first.lastSeq);
    });

    it('handles an empty batch (lastSeq 0, no keys)', () => {
        const built = buildRecoveryInjection([]);
        expect(built.idempotencyKeys).toEqual([]);
        expect(built.lastSeq).toBe(0);
    });
});

describe('recoverDaemonInjectState', () => {
    it('re-injects un-observed mail and advances the injected marker', async () => {
        const { d, inject, markInjected } = deps({
            listInboxes: async () => ['sess-1'],
            readUnobserved: async () => [entry(1, 'a'), entry(2, 'b')],
        });
        const result = await recoverDaemonInjectState(d);
        expect(inject).toHaveBeenCalledTimes(1);
        expect(inject).toHaveBeenCalledWith('sess-1', [entry(1, 'a'), entry(2, 'b')]);
        expect(markInjected).toHaveBeenCalledWith('sess-1', 2);
        expect(result.scanned).toBe(1);
        expect(result.membersRecovered).toBe(1);
        expect(result.entriesReinjected).toBe(2);
        expect(result.perSession).toEqual([{ session: 'sess-1', reinjected: 2, lastSeq: 2 }]);
        expect(result.skipped).toEqual([]);
    });

    it('never re-injects an inbox with no un-observed mail (observed mail stays put)', async () => {
        const { d, inject, markInjected } = deps({
            listInboxes: async () => ['sess-observed'],
            readUnobserved: async () => [],
        });
        const result = await recoverDaemonInjectState(d);
        expect(inject).not.toHaveBeenCalled();
        expect(markInjected).not.toHaveBeenCalled();
        expect(result.membersRecovered).toBe(0);
        expect(result.entriesReinjected).toBe(0);
        expect(result.skipped).toEqual([{ session: 'sess-observed', reason: 'no-unobserved-mail' }]);
    });

    it('skips an unreachable member WITHOUT advancing the marker (mail preserved for retry)', async () => {
        const inject: RecoveryInjector = async () => ({ injected: false, lastSeq: 0, reason: 'member-unreachable' });
        const { d, markInjected } = deps({
            listInboxes: async () => ['sess-down'],
            readUnobserved: async () => [entry(7, 'x')],
            inject,
        });
        const result = await recoverDaemonInjectState(d);
        expect(markInjected).not.toHaveBeenCalled();
        expect(result.membersRecovered).toBe(0);
        expect(result.skipped).toEqual([
            { session: 'sess-down', reason: 'member-unreachable', detail: 'member-unreachable' },
        ]);
    });

    it('maps a no-active-thread inject outcome to a no-active-thread skip', async () => {
        const inject: RecoveryInjector = async () => ({ injected: false, lastSeq: 0, reason: 'no-active-thread' });
        const { d, markInjected } = deps({
            listInboxes: async () => ['sess-nothr'],
            readUnobserved: async () => [entry(1, 'a')],
            inject,
        });
        const result = await recoverDaemonInjectState(d);
        expect(markInjected).not.toHaveBeenCalled();
        expect(result.skipped[0]).toMatchObject({ session: 'sess-nothr', reason: 'no-active-thread' });
    });

    it('captures an inject that throws as an inject-failed skip and continues to the next inbox', async () => {
        const inject = vi.fn(
            async (session: string, _entries: MailboxEntry[]) => {
                if (session === 'sess-bad') throw new Error('boom');
                return { injected: true, lastSeq: 9 };
            },
        );
        const { d, markInjected } = deps({
            listInboxes: async () => ['sess-bad', 'sess-good'],
            readUnobserved: async (s) => (s === 'sess-bad' ? [entry(3, 'a')] : [entry(9, 'z')]),
            inject: inject as unknown as RecoveryInjector,
        });
        const result = await recoverDaemonInjectState(d);
        expect(result.skipped.find((s) => s.session === 'sess-bad')).toMatchObject({ reason: 'inject-failed' });
        expect(result.perSession).toEqual([{ session: 'sess-good', reinjected: 1, lastSeq: 9 }]);
        expect(markInjected).toHaveBeenCalledWith('sess-good', 9);
        expect(markInjected).toHaveBeenCalledTimes(1);
    });

    it('re-injecting the SAME un-observed batch twice yields identical idempotency keys (no dup)', async () => {
        const captured: string[][] = [];
        const inject: RecoveryInjector = async (_session, entries) => {
            captured.push(buildRecoveryInjection(entries).idempotencyKeys);
            return { injected: true, lastSeq: entries[entries.length - 1].seq };
        };
        // Two independent recovery passes over the same un-observed mail (a crash
        // between passes would leave the un-observed set unchanged).
        const build = (): DaemonRecoveryDeps => ({
            listInboxes: async () => ['sess-1'],
            readUnobserved: async () => [entry(1, 'a'), entry(2, 'b')],
            inject,
            markInjected: async () => undefined,
        });
        await recoverDaemonInjectState(build());
        await recoverDaemonInjectState(build());
        expect(captured).toHaveLength(2);
        expect(captured[1]).toEqual(captured[0]);
        expect(captured[0]).toEqual(['a', 'b']);
    });

    it('scans multiple inboxes and aggregates the summary', async () => {
        const { d, markInjected } = deps({
            listInboxes: async () => ['s1', 's2', 's3'],
            readUnobserved: async (s) => {
                if (s === 's1') return [entry(1, 'a')];
                if (s === 's2') return [];
                return [entry(5, 'c'), entry(6, 'd')];
            },
        });
        const result = await recoverDaemonInjectState(d);
        expect(result.scanned).toBe(3);
        expect(result.membersRecovered).toBe(2);
        expect(result.entriesReinjected).toBe(3);
        expect(markInjected).toHaveBeenCalledWith('s1', 1);
        expect(markInjected).toHaveBeenCalledWith('s3', 6);
        expect(result.skipped).toEqual([{ session: 's2', reason: 'no-unobserved-mail' }]);
    });
});

describe('defaultRecoveryInjector', () => {
    let emptyHome: string;

    beforeEach(() => {
        // A controlled, empty discovery dir (no codex-active-*.json records) so
        // resolveMemberEndpoint deterministically finds no live endpoint —
        // independent of this machine's real ~/.happy contents.
        emptyHome = mkdtempSync(join(process.cwd(), 'daemonrecovery-test-'));
    });

    afterEach(() => {
        rmSync(emptyHome, { recursive: true, force: true });
    });

    it('reports member-unreachable when no live endpoint resolves', async () => {
        const injector = defaultRecoveryInjector(undefined, emptyHome);
        const outcome = await injector('00000000-0000-0000-0000-000000000000', [entry(1, 'a')]);
        expect(outcome.injected).toBe(false);
        expect(outcome.reason).toBe('member-unreachable');
    });
});
