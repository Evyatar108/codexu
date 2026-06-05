/**
 * Codex app-server lifecycle sidecar.
 *
 * The JSONL contract intentionally uses snake_case field names because this is
 * append-only diagnostic data read outside the TypeScript process. DO NOT "fix"
 * these public fields to camelCase.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { z } from 'zod';

const LIFECYCLE_DIR = 'codex-daemons';
const LIFECYCLE_FILE = 'lifecycle.jsonl';
const MAX_LIFECYCLE_BYTES = 5 * 1024 * 1024;

const epochMs = z.number().int().nonnegative();
const nullableMs = z.number().int().nonnegative().nullable();

const lifecycleBase = z.object({
    pid: z.number().int().positive(),
    started_at_ms: epochMs,
    cwd: z.string(),
    happy_session_id: z.string().optional(),
});

export const CodexDaemonLifecycleEvent = z.discriminatedUnion('event', [
    lifecycleBase.extend({
        event: z.literal('codex.daemon.spawn'),
        endpoint: z.string().optional(),
        cold_start_ms: epochMs,
    }).strict(),
    lifecycleBase.extend({
        event: z.literal('codex.daemon.reattach'),
        reattached_at_ms: epochMs,
    }).strict(),
    lifecycleBase.extend({
        event: z.literal('codex.daemon.disconnect'),
        disconnected_at_ms: epochMs,
        last_client_disconnect_age_ms: nullableMs,
    }).strict(),
    lifecycleBase.extend({
        event: z.literal('codex.daemon.exit'),
        exited_at_ms: epochMs,
        exit_code: z.number().int().nullable(),
        exit_signal: z.string().nullable().optional(),
        exit_reason: z.enum(['killed', 'session_mismatch', 'crashed', 'unknown']),
        termination_reason_detail: z.string().optional(),
        uptime_ms: nullableMs,
        rss_kb_at_exit: nullableMs,
        last_client_disconnect_age_ms: nullableMs,
    }).strict(),
]);

export type CodexDaemonLifecycleEvent = z.infer<typeof CodexDaemonLifecycleEvent>;

type LifecycleOptions = {
    homeDir?: string;
};

export function instanceKey({ pid, startedAt }: { pid: number; startedAt: number | string }): string {
    return `${pid}:${startedAt}`;
}

function lifecycleFilePath(homeDir = configuration.happyHomeDir): string {
    return join(homeDir, LIFECYCLE_DIR, LIFECYCLE_FILE);
}

export async function appendEvent(event: CodexDaemonLifecycleEvent, options?: LifecycleOptions): Promise<void> {
    const parsed = CodexDaemonLifecycleEvent.parse(event);
    const path = lifecycleFilePath(options?.homeDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(parsed)}\n`, { flag: 'a' });
}

export async function readEvents(homeDir?: string): Promise<CodexDaemonLifecycleEvent[]> {
    const path = lifecycleFilePath(homeDir);
    if (!existsSync(path)) {
        return [];
    }

    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    if (lines.at(-1) === '') {
        lines.pop();
    }

    const events: CodexDaemonLifecycleEvent[] = [];
    for (const [index, line] of lines.entries()) {
        try {
            events.push(CodexDaemonLifecycleEvent.parse(JSON.parse(line)));
        } catch (error) {
            if (index === lines.length - 1) {
                continue;
            }
            throw error;
        }
    }
    return events;
}

export function rotateIfNeeded(options?: LifecycleOptions): void {
    const path = lifecycleFilePath(options?.homeDir);
    if (!existsSync(path) || statSync(path).size <= MAX_LIFECYCLE_BYTES) {
        return;
    }

    const rotatedPath = `${path}.1`;
    try {
        if (existsSync(rotatedPath)) {
            unlinkSync(rotatedPath);
        }
        renameSync(path, rotatedPath);
    } catch (error) {
        logger.warn('Failed to rotate codex daemon lifecycle sidecar', error);
    }
}
