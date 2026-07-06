import type { MarkdownBlock, MarkdownSpan } from '@/components/markdown/parseMarkdown';
import { buildInternalFileLinkUrl } from '@/components/markdown/linkUtils';
import { splitSessionFileText } from '@/utils/sessionFileLinks';

/**
 * FORK PATCH: [RESTORE-R8d] 8d session-file autolinking transform (invariant HA-8).
 *
 * Upstream renders markdown spans verbatim. The fork post-processes parsed
 * blocks and, when a session working-directory root is known, rewrites bare
 * file-path text (e.g. `/repo/src/foo.ts:12`) into tappable internal
 * file-links. Spans that were rewritten are recorded in `trustedInternalSpans`
 * so the renderer can treat them as links even though their URL is an internal
 * `file://`-style scheme rather than an http(s) URL (see HA-8, 8e/8j).
 *
 * Behavior-preserving relocation of the inline `addSessionFileLinks` /
 * `addSessionFileLinksToSpans` helpers that used to live in
 * components/markdown/MarkdownView.tsx. See docs/happy-patch-surface.md (HA-8).
 */
function addSessionFileLinksToSpans(spans: MarkdownSpan[], sessionRoot: string | null, trustedInternalSpans: Set<MarkdownSpan>): MarkdownSpan[] {
    if (!sessionRoot) {
        return spans;
    }

    return spans.flatMap((span) => {
        if (span.url || span.styles.includes('code')) {
            return [span];
        }

        const segments = splitSessionFileText(span.text, sessionRoot);
        if (segments.length === 0) {
            return [span];
        }
        if (segments.length === 1 && !segments[0]?.link) {
            return [span];
        }

        return segments.map((segment) => {
            if (!segment.link?.withinSessionRoot) {
                return { ...span, text: segment.text, url: null };
            }
            const trustedSpan: MarkdownSpan = {
                ...span,
                text: segment.text,
                url: buildInternalFileLinkUrl(segment.link.absolutePath, segment.link.line, segment.link.column),
            };
            trustedInternalSpans.add(trustedSpan);
            return trustedSpan;
        });
    });
}

export function addSessionFileLinks(blocks: MarkdownBlock[], sessionRoot: string | null): { blocks: MarkdownBlock[]; trustedInternalSpans: Set<MarkdownSpan> } {
    const trustedInternalSpans = new Set<MarkdownSpan>();
    if (!sessionRoot) {
        return { blocks, trustedInternalSpans };
    }

    const processedBlocks = blocks.map((block) => {
        if (block.type === 'text' || block.type === 'header') {
            return { ...block, content: addSessionFileLinksToSpans(block.content, sessionRoot, trustedInternalSpans) };
        }
        if (block.type === 'list') {
            return { ...block, items: block.items.map((item) => addSessionFileLinksToSpans(item, sessionRoot, trustedInternalSpans)) };
        }
        if (block.type === 'numbered-list') {
            return {
                ...block,
                items: block.items.map((item) => ({
                    ...item,
                    spans: addSessionFileLinksToSpans(item.spans, sessionRoot, trustedInternalSpans),
                })),
            };
        }
        if (block.type === 'table') {
            return {
                ...block,
                headers: block.headers.map((header) => addSessionFileLinksToSpans(header, sessionRoot, trustedInternalSpans)),
                rows: block.rows.map((row) => row.map((cell) => addSessionFileLinksToSpans(cell, sessionRoot, trustedInternalSpans))),
            };
        }
        return block;
    });

    return { blocks: processedBlocks, trustedInternalSpans };
}
