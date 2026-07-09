// FORK PATCH: [MOVE-W1] e-ink autocomplete suggestion caps (invariant HA-37).
// Relocated from sources/components/autocomplete/suggestions.ts.
//
// The fork caps command-suggestion and file-mention result counts lower than
// upstream (upstream uses 50 for both) to keep the BOOX e-ink autocomplete
// popover short and legible — fewer rows means less full-panel repaint on the
// slow e-ink controller. Upstream's suggestions.ts hard-codes both limits inline;
// relocating the fork values here leaves the canonical file with only a thin
// import seam so future upstream edits to suggestions.ts merge cleanly. Behavior
// is byte-identical to the pre-MOVE fork (15 command rows, 5 file-mention rows).

export const FORK_COMMAND_SUGGESTION_LIMIT = 15;
export const FORK_FILE_MENTION_LIMIT = 5;
