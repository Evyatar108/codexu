/**
 * FORK PATCH: [RESTORE-R8b] e-ink paginated page-turn scroll gestures (invariant HA-5).
 * Relocated from components/ChatList.tsx; consumed by
 * sources/fork/chat/ForkFlatChatList.tsx. See docs/happy-patch-surface.md HA-5.
 * Do NOT change observable behavior. Shared FlatList refs/state are threaded in
 * from the host component so the extraction stays behavior-identical.
 */
import * as React from 'react';
import { FlatList } from 'react-native';
import { runOnJS } from 'react-native-reanimated';
import { Gesture, PinchGesture, TapGesture } from 'react-native-gesture-handler';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';

const SCROLL_THRESHOLD = 300;

export interface PageTurnScrollParams {
    flatListRef: React.RefObject<FlatList | null>;
    currentOffsetRef: React.MutableRefObject<number>;
    contentHeightRef: React.MutableRefObject<number>;
    viewportHeight: number;
    sessionId: string;
    chatPaginatedScroll: boolean;
    firstMessageId: string | undefined;
    setShowScrollButton: (value: boolean) => void;
    pinchGesture: PinchGesture;
}

export interface PageTurnScroll {
    olderMessagesTapGesture: TapGesture;
    newerMessagesTapGesture: TapGesture;
}

export function usePageTurnScroll(params: PageTurnScrollParams): PageTurnScroll {
    const {
        flatListRef,
        currentOffsetRef,
        contentHeightRef,
        viewportHeight,
        sessionId,
        chatPaginatedScroll,
        firstMessageId,
        setShowScrollButton,
        pinchGesture,
    } = params;

    const previousFirstMessageIdRef = React.useRef(firstMessageId);

    const pageToOlderMessages = React.useCallback(() => {
        const maxOffset = Math.max(0, contentHeightRef.current - viewportHeight);
        const pageSize = viewportHeight;
        const nextOffset = Math.max(
            0,
            Math.min(maxOffset, currentOffsetRef.current + pageSize),
        );
        if (maxOffset > 0 && nextOffset >= maxOffset - viewportHeight * 0.1) {
            const sessionMessages = storage.getState().sessionMessages[sessionId];
            if (sessionMessages?.hasOlder && !sessionMessages.loadingOlder) {
                void sync.loadOlder(sessionId);
            }
        }
        currentOffsetRef.current = nextOffset;
        setShowScrollButton(nextOffset > SCROLL_THRESHOLD);
        flatListRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
    }, [contentHeightRef, currentOffsetRef, flatListRef, sessionId, setShowScrollButton, viewportHeight]);

    const pageToNewerMessages = React.useCallback(() => {
        const maxOffset = Math.max(0, contentHeightRef.current - viewportHeight);
        const pageSize = viewportHeight;
        const nextOffset = Math.max(
            0,
            Math.min(maxOffset, currentOffsetRef.current - pageSize),
        );
        currentOffsetRef.current = nextOffset;
        setShowScrollButton(nextOffset > SCROLL_THRESHOLD);
        flatListRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
    }, [contentHeightRef, currentOffsetRef, flatListRef, setShowScrollButton, viewportHeight]);

    const olderMessagesTapGesture = React.useMemo(() => (
        Gesture.Tap().requireExternalGestureToFail(pinchGesture).onEnd((_, success) => {
            if (success) {
                runOnJS(pageToOlderMessages)();
            }
        })
    ), [pinchGesture, pageToOlderMessages]);

    const newerMessagesTapGesture = React.useMemo(() => (
        Gesture.Tap().requireExternalGestureToFail(pinchGesture).onEnd((_, success) => {
            if (success) {
                runOnJS(pageToNewerMessages)();
            }
        })
    ), [pinchGesture, pageToNewerMessages]);

    React.useEffect(() => {
        const currentFirstId = firstMessageId;
        const firstMessageChanged = currentFirstId !== previousFirstMessageIdRef.current;
        previousFirstMessageIdRef.current = currentFirstId;
        if (!chatPaginatedScroll || !firstMessageChanged) {
            return;
        }
        if (currentOffsetRef.current < SCROLL_THRESHOLD) {
            currentOffsetRef.current = 0;
            setShowScrollButton(false);
            flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
        }
    }, [chatPaginatedScroll, firstMessageId, currentOffsetRef, flatListRef, setShowScrollButton]);

    return { olderMessagesTapGesture, newerMessagesTapGesture };
}
