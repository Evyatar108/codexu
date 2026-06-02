/**
 * Routing configuration for codex MCP-server notifications.
 *
 * Stage A (codex 0.115+, gated by `Feature::McpServerNotifications`) emits
 * `EventMsg::McpServerNotification` events on the codex/event stream. This
 * module owns the TS-side policy that decides, per notification `kind` and
 * per originating MCP server name, whether to surface the notification as
 * a synthesized prompt in the agent's input queue ("prompt-queue") or
 * merely log it ("display-only").
 *
 * The master switch is `enabled` (default `false`). Even when codex is
 * configured to emit notifications, this consumer is a no-op until a user
 * explicitly opts in via happy-cli settings.
 *
 * See `.ralph/jobs/codex-channels-option-b/plan.md` §3 for the design.
 */

import { logger } from '@/ui/logger';

/**
 * The snake_case wire `kind` discriminator carried inside
 * `EventMsg::McpServerNotification`. Matches codex's
 * `McpNotificationKind` enum (protocol.rs:2257-2292).
 */
export type McpNotificationKind =
    | 'progress'
    | 'cancelled'
    | 'resource_updated'
    | 'resource_list_changed'
    | 'tool_list_changed'
    | 'prompt_list_changed'
    | 'logging_message';

export const MCP_NOTIFICATION_KINDS: ReadonlyArray<McpNotificationKind> = [
    'progress',
    'cancelled',
    'resource_updated',
    'resource_list_changed',
    'tool_list_changed',
    'prompt_list_changed',
    'logging_message',
];

/**
 * What happens when a notification of a given kind is observed.
 *
 * - `display-only`: emit a debug log only; never feed into the prompt queue.
 * - `prompt-queue`: synthesize a short prompt string from `template` and
 *   push it into the input queue so the agent sees it on its next turn.
 */
export type RouteAction =
    | { type: 'display-only' }
    | {
        type: 'prompt-queue';
        /** Debounce window in milliseconds, keyed by `${server}|${uri ?? kind}`. Default 0 (no debounce). */
        debounceMs?: number;
        /** Optional template string. Supports `{server}`, `{kind}`, `{uri}`, `{summary}`. */
        template?: string;
    };

/**
 * Fully resolved routing configuration. Constructed from raw user input via
 * `loadMcpNotificationRouting()`; do not build this by hand at call sites.
 */
export interface McpNotificationRoutingConfig {
    /** Master switch. When `false`, the consumer ignores every notification. */
    enabled: boolean;
    /** Per-kind defaults, filled out for every known kind. */
    defaults: Record<McpNotificationKind, RouteAction>;
    /** Per-server overrides; partial maps shadow defaults for that server only. */
    perServer: Record<string, Partial<Record<McpNotificationKind, RouteAction>>>;
}

/**
 * Default routing table. Rationale per kind is documented in
 * `.ralph/jobs/codex-channels-option-b/plan.md` §3.
 *
 * `resource_updated` defaults to a 250 ms debounce so a burst of file-watcher
 * edits coalesces into one prompt. Other kinds either route to display-only
 * (telemetry-style) or to prompt-queue without debouncing.
 */
export const DEFAULT_MCP_NOTIFICATION_ROUTING: Readonly<Record<McpNotificationKind, RouteAction>> = Object.freeze({
    progress: { type: 'display-only' },
    cancelled: { type: 'display-only' },
    resource_updated: {
        type: 'prompt-queue',
        debounceMs: 250,
        template: '[mcp:{server}] resource updated: {uri}',
    },
    resource_list_changed: {
        type: 'prompt-queue',
        template: '[mcp:{server}] resource list changed',
    },
    tool_list_changed: {
        type: 'prompt-queue',
        template: '[mcp:{server}] tool list changed; re-check available tools',
    },
    prompt_list_changed: { type: 'display-only' },
    logging_message: { type: 'display-only' },
}) as Record<McpNotificationKind, RouteAction>;

/**
 * Fallback template used when a per-server / per-kind route doesn't supply one.
 */
const FALLBACK_TEMPLATE = '[mcp:{server}] {kind}: {summary}';

/**
 * Maximum length of the `{summary}` substitution. Keeps prompt context cheap.
 */
const SUMMARY_MAX_LENGTH = 200;

function isKnownKind(value: unknown): value is McpNotificationKind {
    return typeof value === 'string' && (MCP_NOTIFICATION_KINDS as ReadonlyArray<string>).includes(value);
}

function parseRouteAction(value: unknown, ctx: string): RouteAction | null {
    if (!value || typeof value !== 'object') {
        logger.debug(`[mcpNotificationRouting] ${ctx}: ignoring non-object route entry`);
        return null;
    }
    const obj = value as Record<string, unknown>;
    const type = obj.type;
    if (type === 'display-only') {
        return { type: 'display-only' };
    }
    if (type === 'prompt-queue') {
        const debounceMsRaw = obj.debounceMs;
        const templateRaw = obj.template;
        const debounceMs =
            typeof debounceMsRaw === 'number' && Number.isFinite(debounceMsRaw) && debounceMsRaw >= 0
                ? debounceMsRaw
                : undefined;
        const template = typeof templateRaw === 'string' ? templateRaw : undefined;
        const action: RouteAction = { type: 'prompt-queue' };
        if (debounceMs !== undefined) action.debounceMs = debounceMs;
        if (template !== undefined) action.template = template;
        return action;
    }
    logger.debug(`[mcpNotificationRouting] ${ctx}: ignoring unknown route type ${String(type)}`);
    return null;
}

function parseKindMap(
    input: unknown,
    ctx: string,
): Partial<Record<McpNotificationKind, RouteAction>> {
    if (!input || typeof input !== 'object') return {};
    const result: Partial<Record<McpNotificationKind, RouteAction>> = {};
    for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
        if (!isKnownKind(key)) {
            logger.debug(`[mcpNotificationRouting] ${ctx}: ignoring unknown kind "${key}"`);
            continue;
        }
        const action = parseRouteAction(raw, `${ctx}.${key}`);
        if (action) result[key] = action;
    }
    return result;
}

/**
 * Parse + normalize a user-supplied routing config. Returns a fully populated
 * `McpNotificationRoutingConfig` with `defaults` filled for every known kind
 * (user defaults overlayed on `DEFAULT_MCP_NOTIFICATION_ROUTING`).
 *
 * `input === undefined | null` → no-op config (`enabled: false`).
 * Unknown kinds and malformed entries are warn-logged and dropped (per
 * AC1.3); the function never throws on bad input.
 */
export function loadMcpNotificationRouting(input: unknown): McpNotificationRoutingConfig {
    const baseDefaults: Record<McpNotificationKind, RouteAction> = {
        ...DEFAULT_MCP_NOTIFICATION_ROUTING,
    };
    if (input === undefined || input === null) {
        return { enabled: false, defaults: baseDefaults, perServer: {} };
    }
    if (typeof input !== 'object') {
        logger.debug('[mcpNotificationRouting] top-level config is not an object; treating as disabled');
        return { enabled: false, defaults: baseDefaults, perServer: {} };
    }
    const obj = input as Record<string, unknown>;
    const enabled = obj.enabled === true;
    const userDefaults = parseKindMap(obj.defaults, 'defaults');
    const merged: Record<McpNotificationKind, RouteAction> = { ...baseDefaults };
    for (const kind of MCP_NOTIFICATION_KINDS) {
        const override = userDefaults[kind];
        if (override) merged[kind] = override;
    }
    const perServer: Record<string, Partial<Record<McpNotificationKind, RouteAction>>> = {};
    const perServerRaw = obj.perServer;
    if (perServerRaw && typeof perServerRaw === 'object') {
        for (const [server, kinds] of Object.entries(perServerRaw as Record<string, unknown>)) {
            const parsed = parseKindMap(kinds, `perServer.${server}`);
            if (Object.keys(parsed).length > 0) perServer[server] = parsed;
        }
    }
    return { enabled, defaults: merged, perServer };
}

/**
 * Resolve the effective route for one notification. Per-server overrides win
 * for kinds they explicitly list; otherwise the per-kind default applies.
 */
export function resolveRoute(
    routing: McpNotificationRoutingConfig,
    server: string,
    kind: McpNotificationKind,
): RouteAction {
    const override = routing.perServer[server]?.[kind];
    if (override) return override;
    return routing.defaults[kind];
}

/**
 * Best-effort summary string derived from a notification's untyped `params`.
 * Output is always a single line and capped at `SUMMARY_MAX_LENGTH`.
 *
 * The mapping follows the rmcp notification shapes that codex forwards:
 * - resource events carry `uri`
 * - logging_message carries `{ level, data }`
 * - progress carries `{ progress, total?, progressToken }`
 * - cancelled carries `{ requestId, reason? }`
 * Anything else falls back to a JSON.stringify of the first 200 chars.
 */
export function extractNotificationSummary(kind: McpNotificationKind, params: unknown): string {
    if (!params || typeof params !== 'object') return '';
    const p = params as Record<string, unknown>;
    let raw: string;
    switch (kind) {
        case 'resource_updated':
            raw = typeof p.uri === 'string' ? p.uri : '';
            break;
        case 'logging_message': {
            const level = typeof p.level === 'string' ? p.level : '';
            const data = typeof p.data === 'string' ? p.data : JSON.stringify(p.data ?? '');
            raw = level ? `${level}: ${data}` : data;
            break;
        }
        case 'progress': {
            const progress = typeof p.progress === 'number' ? p.progress : '?';
            const total = typeof p.total === 'number' ? `/${p.total}` : '';
            const token = typeof p.progressToken === 'string' || typeof p.progressToken === 'number'
                ? String(p.progressToken)
                : '';
            raw = token ? `${token} ${progress}${total}` : `${progress}${total}`;
            break;
        }
        case 'cancelled': {
            const requestId = typeof p.requestId === 'string' || typeof p.requestId === 'number'
                ? String(p.requestId)
                : '';
            const reason = typeof p.reason === 'string' ? p.reason : '';
            raw = reason ? `${requestId}: ${reason}` : requestId;
            break;
        }
        default:
            try {
                raw = JSON.stringify(params);
            } catch {
                raw = '';
            }
    }
    const oneLine = raw.replace(/\s+/g, ' ').trim();
    return oneLine.length > SUMMARY_MAX_LENGTH
        ? `${oneLine.slice(0, SUMMARY_MAX_LENGTH - 1)}…`
        : oneLine;
}

/**
 * Resolve `{server}`, `{kind}`, `{uri}`, `{summary}` placeholders in
 * `template`. Falls back to `FALLBACK_TEMPLATE` when no template is provided.
 * Throws never; on synthesis failure the caller substitutes an error string.
 */
export function renderNotificationTemplate(
    template: string | undefined,
    server: string,
    kind: McpNotificationKind,
    params: unknown,
): string {
    const tpl = template ?? FALLBACK_TEMPLATE;
    const summary = extractNotificationSummary(kind, params);
    const uri = (() => {
        if (!params || typeof params !== 'object') return '';
        const u = (params as Record<string, unknown>).uri;
        return typeof u === 'string' ? u : '';
    })();
    return tpl
        .replace(/\{server\}/g, server)
        .replace(/\{kind\}/g, kind)
        .replace(/\{uri\}/g, uri)
        .replace(/\{summary\}/g, summary);
}
