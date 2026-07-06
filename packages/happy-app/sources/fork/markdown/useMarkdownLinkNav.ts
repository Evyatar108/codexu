import * as React from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { isHttpMarkdownLink, isInternalFileLinkUrl, parseInternalFileLinkUrl } from '@/components/markdown/linkUtils';

/**
 * FORK PATCH: [RESTORE-R8d] 8e internal file-link navigation for markdown (invariant HA-8).
 *
 * Upstream's markdown link handler only opens external http(s) URLs. The fork
 * additionally intercepts internal `file://`-style links produced by the
 * session-file autolink transform (HA-8, 8d) and routes them to the in-app
 * file viewer (`/session/<id>/file?...`) instead of a browser. External links
 * keep upstream behavior (in-app WebBrowser on native, new tab on web).
 *
 * Behavior-preserving relocation of the inline `handleLinkPress` callback that
 * used to live in components/markdown/MarkdownView.tsx. See
 * docs/happy-patch-surface.md (HA-8).
 */
export function useMarkdownLinkNav(sessionId?: string): (url: string) => void {
    const router = useRouter();
    return React.useCallback((url: string) => {
        if (isInternalFileLinkUrl(url)) {
            const fileLink = parseInternalFileLinkUrl(url);
            if (!fileLink || !sessionId) {
                return;
            }
            router.push(`/session/${sessionId}/file?path=${fileLink.path}&line=${fileLink.line}&column=${fileLink.column}&refresh=1&view=file`);
            return;
        }

        if (!isHttpMarkdownLink(url)) {
            return;
        }

        if (Platform.OS === 'web') {
            if (typeof window !== 'undefined') {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
            return;
        }

        void WebBrowser.openBrowserAsync(url);
    }, [sessionId, router]);
}
