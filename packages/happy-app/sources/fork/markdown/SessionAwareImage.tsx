import * as React from 'react';
import { Image, View, Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { sessionReadFile } from '@/sync/ops';

/**
 * FORK PATCH: [RESTORE-R8d] 8f session-aware markdown image loading (invariant HA-8).
 *
 * Upstream renders a markdown image with a bare `<Image source={{ uri }}>`.
 * The fork additionally resolves session-local absolute paths (POSIX and
 * Windows) to a data-URI by reading the file through the session channel
 * (`sessionReadFile`) when the direct load fails on web, and shows a
 * contrast-safe placeholder box on total failure. On native / for remote URLs
 * it degrades to the upstream direct `<Image>` behavior.
 *
 * Behavior-preserving relocation of the inline `SessionImageBlock` + image-uri
 * helpers that used to live in components/markdown/MarkdownView.tsx (including
 * the fork-only `image` / `imagePlaceholder` styles). See
 * docs/happy-patch-surface.md (HA-8).
 */

const WEB_REMOTE_IMAGE_URI = /^(?:https?:|data:)/i;
const WINDOWS_ABSOLUTE_IMAGE_PATH = /^[A-Za-z]:[\\/]/;

function normalizeSessionImagePath(url: string) {
    let decoded = url;
    try {
        decoded = decodeURI(url);
    } catch {
        decoded = url;
    }
    return decoded.replace(/\\/g, '/');
}

function isSessionImagePath(url: string) {
    if (WEB_REMOTE_IMAGE_URI.test(url)) {
        return false;
    }
    return url.startsWith('/') || WINDOWS_ABSOLUTE_IMAGE_PATH.test(url);
}

function inferImageMime(path: string) {
    const extension = path.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase();
    switch (extension) {
        case 'png':
            return 'image/png';
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'gif':
            return 'image/gif';
        case 'webp':
            return 'image/webp';
        case 'svg':
            return 'image/svg+xml';
        default:
            return 'application/octet-stream';
    }
}

function getOriginImageUri(url: string) {
    if (Platform.OS !== 'web' || !isSessionImagePath(url)) {
        return url;
    }

    const normalizedPath = normalizeSessionImagePath(url);
    if (typeof window === 'undefined' || !window.location?.origin) {
        return normalizedPath;
    }

    return `${window.location.origin}/${normalizedPath.replace(/^\/+/, '')}`;
}

export function SessionImageBlock(props: { url: string, alt: string, sessionId?: string }) {
    const [sourceUri, setSourceUri] = React.useState(() => getOriginImageUri(props.url));
    const [failed, setFailed] = React.useState(false);
    const [didTrySessionRead, setDidTrySessionRead] = React.useState(false);
    const latestUrlRef = React.useRef(props.url);
    const mountedRef = React.useRef(true);
    const accessibleLabel = props.alt || 'Markdown image';

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    React.useEffect(() => {
        latestUrlRef.current = props.url;
        setSourceUri(getOriginImageUri(props.url));
        setFailed(false);
        setDidTrySessionRead(false);
    }, [props.url]);

    const handleError = React.useCallback(() => {
        if (Platform.OS !== 'web' || !isSessionImagePath(props.url)) {
            return;
        }

        if (!props.sessionId || didTrySessionRead) {
            setFailed(true);
            return;
        }

        setDidTrySessionRead(true);
        const normalizedPath = normalizeSessionImagePath(props.url);
        const requestUrl = props.url;
        void sessionReadFile(props.sessionId, normalizedPath).then((response) => {
            if (!mountedRef.current || latestUrlRef.current !== requestUrl) {
                return;
            }
            if (response.success && response.content) {
                setSourceUri(`data:${inferImageMime(normalizedPath)};base64,${response.content}`);
                setFailed(false);
                return;
            }
            setFailed(true);
        }).catch(() => {
            if (!mountedRef.current || latestUrlRef.current !== requestUrl) {
                return;
            }
            setFailed(true);
        });
    }, [didTrySessionRead, props.sessionId, props.url]);

    if (failed) {
        return <View accessibilityLabel={accessibleLabel} style={[style.image, style.imagePlaceholder]} />;
    }

    return (
        <Image
            source={{ uri: sourceUri }}
            style={style.image}
            accessibilityLabel={accessibleLabel}
            resizeMode="contain"
            onError={handleError}
        />
    );
}

const style = StyleSheet.create((theme) => ({
    image: {
        width: '100%',
        minHeight: 160,
        height: 240,
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceHighest,
    },
    imagePlaceholder: {
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
    },
}));
