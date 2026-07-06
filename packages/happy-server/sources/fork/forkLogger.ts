// FORK PATCH: [KEEP] fork quiet-logger gate + shutdownLogger relocated here from utils/log.ts, reconciled onto upstream's Bun-safe pretty()+pino.multistream shape (invariant HS-11)
//
// Owns the HAPPY_SERVER_QUIET_LOGGER delta and the daemon-shutdown flush/end so
// utils/log.ts stays a thin, upstream-shaped call-site.
import pino from 'pino';

// Embedded-daemon quiet mode. When a happy-cli daemon embeds happy-server with
// pretty logs disabled it sets HAPPY_SERVER_QUIET_LOGGER=true (see
// sources/index.ts), which suppresses the pretty stdout stream and disables the
// root logger so the embedded daemon produces no console noise.
export const isQuietLogger = process.env.HAPPY_SERVER_QUIET_LOGGER === 'true';

/**
 * Compose the fork's quiet gate onto upstream's Bun-safe multistream set: drop
 * the pretty (stdout) stream when quiet, always keep any extra streams (e.g. the
 * DANGEROUSLY_* remote-debug file stream) so file logging is unaffected by quiet
 * mode. Returns the stream list to hand to `pino.multistream(...)`.
 */
export function buildForkLoggerStreams(
    prettyStream: pino.StreamEntry,
    extraStreams: pino.StreamEntry[],
): pino.StreamEntry[] {
    const streams = isQuietLogger ? [] : [prettyStream];
    return [...streams, ...extraStreams];
}

/**
 * Merge the fork's `enabled` gate onto upstream's shared logger options. When
 * quiet, the root logger is disabled exactly as before (pino no-ops all calls).
 * Applied only to the main logger — the optional file-only logger keeps the
 * upstream shape (always enabled when it exists), matching the fork's original.
 */
export function applyForkLoggerOptions(baseOptions: pino.LoggerOptions): pino.LoggerOptions {
    return { ...baseOptions, enabled: !isQuietLogger };
}

/**
 * Build the daemon-shutdown flush + end routine for the fork's logger(s). The
 * export name `shutdownLogger` is preserved (re-exported from utils/log.ts) so
 * daemon-shutdown callers stay unbroken.
 */
export function createShutdownLogger(
    logger: pino.Logger,
    fileConsolidatedLogger: pino.Logger | undefined,
): () => void {
    return () => {
        logger.flush();
        fileConsolidatedLogger?.flush();
        const endLogger = (target: any) => {
            const end = target[pino.symbols.endSym];
            if (typeof end === 'function') {
                end.call(target);
            }
        };
        endLogger(logger);
        if (fileConsolidatedLogger) {
            endLogger(fileConsolidatedLogger);
        }
    };
}
