// FORK PATCH: [MOVE-W2] fork-added message-meta fields (invariant HA-30).
// Relocated from sources/sync/typesMessageMeta.ts.
//
// The fork extends the upstream MessageMetaSchema with codex/e-ink message
// metadata (thinkingLevel, deferred-switch capabilities, attachment refs, and the
// context-boundary fallback flag). Keeping these definitions in this overlay lets
// the canonical typesMessageMeta.ts stay close to upstream. Upstream's `effort`
// field is deliberately ABSENT from the fork schema (the fork maps upstream effort
// onto its own thinkingLevel per HA-28); do NOT re-add `effort` here on merge.
import { z } from 'zod';

// Fork-added MessageMeta field definitions, spread into the canonical schema.
export const forkMessageMetaFields = {
    thinkingLevel: z.string().nullable().optional(),
    capabilities: z.object({
        deferredSwitch: z.boolean().optional(),
    }).optional(),
    attachmentRefs: z.array(z.object({
        remotePath: z.string(),
        name: z.string(),
        size: z.number(),
    })).optional(),
    contextBoundaryFallback: z.boolean().optional(),
};
