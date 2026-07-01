/**
 * Unit tests for the US-004 writer inventory. These guard the invariants the
 * lock-drop decision depends on: the inventory is coherent, foreign writers are
 * correctly identified, and the sole-writer readiness verdict reflects them.
 */

import { describe, it, expect } from 'vitest';
import {
    MAILBOX_WRITERS,
    foreignWriters,
    daemonSoleWriterReadiness,
} from './mailboxWriters';

describe('MAILBOX_WRITERS inventory', () => {
    it('is non-empty and every entry is well-formed', () => {
        expect(MAILBOX_WRITERS.length).toBeGreaterThan(0);
        for (const w of MAILBOX_WRITERS) {
            expect(w.id).toMatch(/\S/);
            expect(w.site).toMatch(/:|mailbox\.ts/);
            expect(typeof w.isDaemon).toBe('boolean');
            expect(['daemon', 'consumer-bridge', 'member']).toContain(w.process);
            expect(w.note.length).toBeGreaterThan(0);
        }
    });

    it('has unique writer ids', () => {
        const ids = MAILBOX_WRITERS.map(w => w.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('classifies isDaemon consistently with the process field', () => {
        for (const w of MAILBOX_WRITERS) {
            expect(w.isDaemon).toBe(w.process === 'daemon');
        }
    });

    it('includes both daemon append sites and both consumer-bridge writers', () => {
        const ids = new Set(MAILBOX_WRITERS.map(w => w.id));
        expect(ids.has('daemon-control-send')).toBe(true);
        expect(ids.has('daemon-ingest-relay')).toBe(true);
        expect(ids.has('consumer-bridge-drain')).toBe(true);
        expect(ids.has('consumer-bridge-ensure-inbox')).toBe(true);
    });
});

describe('foreignWriters / daemonSoleWriterReadiness', () => {
    it('reports exactly the non-daemon writers as foreign', () => {
        const foreign = foreignWriters();
        expect(foreign.every(w => !w.isDaemon)).toBe(true);
        expect(foreign.map(w => w.id).sort()).toEqual(['consumer-bridge-drain', 'consumer-bridge-ensure-inbox']);
    });

    it('is NOT ready to drop the lock while the consumer bridge still writes', () => {
        const readiness = daemonSoleWriterReadiness();
        expect(readiness.ready).toBe(false);
        expect(readiness.blockers.map(b => b.id)).toContain('consumer-bridge-drain');
        expect(readiness.reason).toMatch(/foreign writer/i);
    });
});
