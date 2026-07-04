import { readFile, stat } from "fs/promises";

export interface LoopbackCapabilityPaths {
    loopbackCap?: string;
}

export function makeLoopbackTokenReader(paths: LoopbackCapabilityPaths = {}) {
    let cachedToken: string | null = null;
    let cachedMtimeMs: number | null = null;

    return async function readCapability(): Promise<string | null> {
        if (!paths.loopbackCap) {
            return null;
        }
        const fileStat = await stat(paths.loopbackCap);
        if (cachedToken !== null && cachedMtimeMs === fileStat.mtimeMs) {
            return cachedToken;
        }
        cachedToken = (await readFile(paths.loopbackCap, "utf-8")).trim();
        cachedMtimeMs = fileStat.mtimeMs;
        return cachedToken;
    };
}

// FORK PATCH: [RESTORE-R1b-done] socket loopback-capability handshake verifier relocated from socket.ts `createSocketAuthMiddleware` (invariant HS-3)
/**
 * Build the Socket.IO loopback-capability handshake verifier used when
 * `auth === 'loopback'`.
 *
 * Behavior-preserving relocation of the inline loopback branch that previously
 * lived in `socket.ts` `createSocketAuthMiddleware`. The capability-token reader
 * is created ONCE here (at middleware-construction time, not per connection) so
 * its mtime cache survives across handshakes exactly as before the relocation.
 * Returns `true` only when a non-empty expected token matches the handshake's
 * `x-loopback-capability` header; otherwise `false` — the thin dispatcher maps
 * `false` to a fail-closed `next(new Error('Unauthorized'))`.
 */
export function makeLoopbackSocketVerifier(paths: LoopbackCapabilityPaths = {}) {
    const readCapability = makeLoopbackTokenReader(paths);

    return async function verifyLoopbackSocketHandshake(headers: Record<string, unknown>): Promise<boolean> {
        const expectedToken = await readCapability();
        const actualToken = headers["x-loopback-capability"] as string | undefined;
        return Boolean(expectedToken && actualToken && actualToken === expectedToken);
    };
}

export function verifyLoopbackCapability(paths: LoopbackCapabilityPaths = {}) {
    const readCapability = makeLoopbackTokenReader(paths);

    return async function verifyLoopbackCapabilityDecorator(request: any, reply: any) {
        const expectedToken = await readCapability();
        const actualToken = request.headers["x-loopback-capability"] as string | undefined;
        if (!expectedToken || !actualToken || actualToken !== expectedToken) {
            return reply.code(401).send({ error: "invalid_loopback_capability" });
        }
    };
}

