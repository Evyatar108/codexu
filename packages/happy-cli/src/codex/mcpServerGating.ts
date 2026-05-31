/**
 * Gap 8 (codex-agent-parity-audit.md) — partial codex-side parity for
 * `allowedTools` / `disallowedTools` per-message gating.
 *
 * The Claude path lets each message constrain which tools the model can
 * call via `allowedTools` / `disallowedTools` lists. Codex's wire surface
 * has no per-turn tool allowlist; the closest knob is to construct the
 * `mcpServers` config so disallowed tools are simply not exposed.
 *
 * **Granularity is whole-server.** A pattern targets a server by name. A
 * pattern matches a server when the pattern is either the bare server
 * name (e.g. `"happy"`) or the wildcard-tools form (e.g. `"happy.*"`).
 * A per-tool pattern like `"happy.someTool"` is recognized as
 * "this pattern mentions the happy server" — for `allowedTools` it
 * keeps the whole `happy` server (so the tool stays callable), but for
 * `disallowedTools` it does NOT drop the whole server (only that single
 * tool was forbidden). True per-tool filtering inside an MCP server is
 * deferred to a follow-up overlay crate.
 *
 * Semantics:
 * - `disallowedTools`: drop server X if any pattern equals `X` or `X.*`.
 *   `X.someTool` does NOT drop the whole X server (the partial fix can't
 *   honor that without overlay-crate filtering, and over-dropping would
 *   be a regression vs. just ignoring the constraint).
 * - `allowedTools`: when set and non-empty, drop server X UNLESS some
 *   pattern is `X`, `X.*`, or `X.<anything>` (the latter implies the
 *   server is still reachable for that tool, even though the partial
 *   filter can't restrict to only that tool).
 *
 * Both lists can apply simultaneously; an explicit deny wins over an
 * implicit allow.
 */
export function filterMcpServersByToolGating(
    mcpServers: Record<string, unknown>,
    opts: { allowedTools?: string[]; disallowedTools?: string[] },
): Record<string, unknown> {
    const { allowedTools, disallowedTools } = opts;
    const hasAllow = allowedTools !== undefined && allowedTools.length > 0;
    const hasDeny = disallowedTools !== undefined && disallowedTools.length > 0;
    if (!hasAllow && !hasDeny) return mcpServers;

    const denyWholeServer = (server: string): boolean => {
        if (!hasDeny) return false;
        for (const pattern of disallowedTools!) {
            if (pattern === server) return true;
            if (pattern === `${server}.*`) return true;
        }
        return false;
    };

    const allowMentionsServer = (server: string): boolean => {
        if (!hasAllow) return true;
        for (const pattern of allowedTools!) {
            if (pattern === server) return true;
            if (pattern === `${server}.*`) return true;
            if (pattern.startsWith(`${server}.`)) return true;
        }
        return false;
    };

    const filtered: Record<string, unknown> = {};
    for (const [server, value] of Object.entries(mcpServers)) {
        if (denyWholeServer(server)) continue;
        if (!allowMentionsServer(server)) continue;
        filtered[server] = value;
    }
    return filtered;
}
