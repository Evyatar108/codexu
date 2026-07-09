// FORK PATCH: [MOVE-W2] e-ink/tablet device-local settings fields (invariant HA-33).
// Relocated from sources/sync/localSettings.ts.
//
// The fork adds a cluster of e-ink / tablet device-local settings on top of the
// upstream LocalSettingsSchema. Holding those field definitions (and their
// defaults) in this overlay keeps the canonical localSettings.ts close to
// upstream — future upstream field additions merge into the inline base cleanly
// while the fork fields stay isolated here. Upstream's `voiceUpsellOverride` and
// `zenMode` fields are deliberately ABSENT from the fork schema (guarded by
// sources/sync/encryptionDeletion.spec.ts); do NOT re-add them here on merge.
import { z } from 'zod';

// Fork-added LocalSettings field definitions, spread into the canonical schema.
export const forkLocalSettingsFields = {
    chatFontScale: z.number().min(0.85).max(1.6).describe('Scale factor for chat typography'),
    chatWidthMode: z.number().int().min(0).max(50).describe('Side-margin percentage for chat layout on large screens (0 = no margin / full width; picker exposes 0/3/5/10/15)'),
    pinchToZoomEnabled: z.boolean().describe('Enable pinch-to-zoom chat text preview'),
    chatPaginatedScroll: z.boolean().describe('Enable page-turn chat pagination mode'),
    chatToolGrouping: z.enum(['flat', 'grouped']).describe("Chat message rendering: 'flat' (fork e-ink default — every message inline) or 'grouped' (restored upstream tool-call/agent-work grouping)"),
    messageCommandChips: z.boolean().describe('Restore upstream slash-command/goal chips + fork-from-message long-press in MessageView (off by default — fork renders user messages as a flat e-ink band)'),
    enableSocketRangeFetch: z.boolean().describe('Route older-page fetch through the socket-pushed prefetch path instead of HTTP loadOlder()'),
    unifiedNewSessionComposer: z.boolean().describe('Enable the unified composer on the new-session screen'),
    sidebarMode: z.enum(['expanded', 'collapsed', 'hidden']).describe('Permanent tablet sidebar mode: expanded (full list), collapsed (72px icon rail), hidden (off — max focus)'),
    sidebarCollapsed: z.boolean().describe('Whether the right file-diffs sidebar is collapsed on desktop'),
};

// Defaults for the fork-added fields, spread into localSettingsDefaults.
export const forkLocalSettingsDefaults = {
    chatFontScale: 1.0,
    chatWidthMode: 5,
    pinchToZoomEnabled: false,
    chatPaginatedScroll: false,
    chatToolGrouping: 'flat' as const,
    messageCommandChips: false,
    enableSocketRangeFetch: true,
    unifiedNewSessionComposer: false,
    sidebarMode: 'expanded' as const,
    sidebarCollapsed: false,
};
