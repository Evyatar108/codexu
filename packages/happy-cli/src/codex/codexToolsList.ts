/**
 * Gap 12 (codex-agent-parity-audit.md) — synthesize a tools[] array for
 * codex session metadata. Codex's `NewConversationResponse` does NOT
 * include an enumerated tools list (Claude's `system.init.tools[]`
 * equivalent), so happy-cli synthesizes one from the resolved mcpServers
 * keys (after Gap 8 filtering) plus a hardcoded list of codex built-ins.
 *
 * The hardcoded built-ins MUST be kept in sync with what `codex
 * app-server` actually exposes per turn. Today's list (codex 0.107.0):
 * - `shell` — primary execution surface
 * - `apply_patch` — file editing
 * - `update_plan` — codex's TodoWrite-equivalent
 *
 * Slash-command enumeration is deferred — codex doesn't yet expose a
 * JSON-RPC for it. When it does, extend session metadata's
 * `slashCommands` field through a separate gap.
 */
const CODEX_BUILTIN_TOOLS: readonly string[] = ['shell', 'apply_patch', 'update_plan'];

export function synthesizeCodexTools(mcpServers: Record<string, unknown>): string[] {
    const mcpKeys = Object.keys(mcpServers).sort();
    // De-dupe defensively in case a built-in name collides with an mcp
    // server name (today: no collision; the Set preserves insertion
    // order so built-ins land first).
    return Array.from(new Set([...CODEX_BUILTIN_TOOLS, ...mcpKeys]));
}
