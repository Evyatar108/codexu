/**
 * Codex app-server lifecycle telemetry emitter.
 *
 * Lifecycle event payloads intentionally use snake_case field names because the
 * sidecar is an append-only public diagnostic contract. DO NOT "fix" these
 * fields to camelCase.
 */

import { appendEvent, rotateIfNeeded, type CodexDaemonLifecycleEvent } from '@/codex/codexDaemonLifecycle';
import { logger } from '@/ui/logger';

function warnOnce(message: string, error: unknown): void {
    try {
        logger.warn(message, error);
    } catch {
        // Logging must never make lifecycle telemetry observable to callers.
    }
}

export async function emitCodexDaemonEvent(event: CodexDaemonLifecycleEvent): Promise<void> {
    try {
        logger.debug(JSON.stringify(event));
    } catch (error) {
        warnOnce('Failed to write codex daemon lifecycle event to debug log', error);
    }

    try {
        await appendEvent(event);
        rotateIfNeeded();
    } catch (error) {
        warnOnce('Failed to write codex daemon lifecycle event sidecar', error);
    }
}
