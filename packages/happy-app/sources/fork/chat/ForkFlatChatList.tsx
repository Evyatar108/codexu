/**
 * FORK PATCH: [RESTORE-R8b] fork-owned flat e-ink ChatList rendering (invariant HA-5).
 * This is the fork's DEFAULT message-list path, relocated wholesale from
 * components/ChatList.tsx so the upstream-canonical ChatList.tsx can move back
 * toward upstream's grouped shape behind the `chatToolGrouping` toggle.
 * Behavior here is byte-for-byte the pre-R8b flat rendering (inverted FlatList +
 * BoundaryDivider + render-window reporting), with the e-ink FlatList tuning,
 * pinch-zoom, and page-turn features extracted into sibling seams:
 *   - ./chatListEinkProps  (FlatList tuning const)
 *   - ./usePinchFontScale  (pinch-to-zoom font scale)
 *   - ./usePageTurnScroll  (paginated page-turn gestures)
 * See docs/happy-patch-surface.md HA-5. Do NOT change observable behavior.
 */
import * as React from 'react';
import { storage, useLatestBoundary, useLocalSetting, useSession, useSessionMessages } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, View, ViewToken } from 'react-native';
import { useCallback } from 'react';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageView } from '@/components/MessageView';
import { Metadata, Session } from '@/sync/storageTypes';
import { ChatFooter } from '@/components/ChatFooter';
import { Message } from '@/sync/typesMessage';
import { useChatWidth } from '@/hooks/useChatWidth';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { GestureDetector } from 'react-native-gesture-handler';
import { ChatScaleLiveContext } from '@/components/ChatScaleLiveContext';
import { BoundaryDivider } from '@/components/BoundaryDivider';
import { Text } from '@/components/StyledText';
import { t } from '@/text';
import { buildChatListBoundaryItems, getLatestBoundaryKey, type ChatListBoundaryItem } from '@/components/ChatList.boundaryItems';
import type { LatestBoundary } from '@/sync/reducer/reducer';
import { chatListEinkProps } from './chatListEinkProps';
import { usePinchFontScale } from './usePinchFontScale';
import { usePageTurnScroll } from './usePageTurnScroll';

const SCROLL_THRESHOLD = 300;

export const ForkFlatChatList = React.memo((props: { session: Session, messages?: Message[] }) => {
    const stored = useSessionMessages(props.session.id);
    const messages = props.messages ?? stored.messages;
    const latestBoundary = useLatestBoundary(props.session.id);
    return (
        <ForkFlatChatListInternal
            metadata={props.session.metadata}
            sessionId={props.session.id}
            messages={messages}
            latestBoundary={latestBoundary}
        />
    )
});

const ListHeader = React.memo(() => {
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    return <View style={{ flexDirection: 'row', alignItems: 'center', height: headerHeight + safeArea.top + 32 }} />;
});

const ListFooter = React.memo((props: { sessionId: string }) => {
    const session = useSession(props.sessionId)!;
    return (
        <ChatFooter controlledByUser={session.agentState?.controlledByUser || false} />
    )
});

const ForkFlatChatListInternal = React.memo((props: {
    metadata: Metadata | null,
    sessionId: string,
    messages: Message[],
    latestBoundary: LatestBoundary | null,
}) => {
    const { theme } = useUnistyles();
    const flatListRef = React.useRef<FlatList>(null);
    const currentOffsetRef = React.useRef<number>(0);
    const contentHeightRef = React.useRef(0);
    const [showScrollButton, setShowScrollButton] = React.useState(false);
    const [viewportHeight, setViewportHeight] = React.useState<number>(0);
    const chatPaginatedScroll = useLocalSetting('chatPaginatedScroll');
    const { body: chatBodyWidth } = useChatWidth();
    const isNearBottom = React.useRef(true);
    const [preBoundaryExpanded, setPreBoundaryExpanded] = React.useState(false);
    const latestBoundaryKey = getLatestBoundaryKey(props.latestBoundary);

    const { pinchToZoomEnabled, pinchGesture, liveMultiplier, isActive } = usePinchFontScale();

    // When `latestBoundary` first becomes available — typically because an
    // older-page prefetch dragged the typed context-boundary event into the
    // loaded message range — DO NOT silently re-collapse the user's view.
    // The previous `setPreBoundaryExpanded(false)` was the eviction trigger
    // diagnosed in `.ralph/brainstorms/streaming-pagination-scroll-jump/`:
    // the user was scrolled into pre-boundary history, the boundary arrived,
    // and the `seq >= latestBoundary.seq` filter at `ChatList.boundaryItems.ts`
    // hid every message they were just looking at — including the row
    // currently under their viewport. Combined with the synthetic-key flip
    // in boundary-item ids it produced a contentSize shrink, an MVCP anchor
    // miss, and a visible snap-back.
    //
    // Fix: when the boundary key transitions from null/undefined to a
    // concrete value AND the user already has pre-boundary messages loaded,
    // auto-expand. When the user actively switches to a new session (via
    // session-id change) we still want a fresh collapse for that session,
    // so we key the reset on session id, not on `latestBoundaryKey`.
    React.useEffect(() => {
        setPreBoundaryExpanded(false);
    }, [props.sessionId]);
    const prevLatestBoundaryKeyRef = React.useRef<string | null>(latestBoundaryKey);
    React.useEffect(() => {
        const prev = prevLatestBoundaryKeyRef.current;
        if (prev === null && latestBoundaryKey !== null) {
            // Boundary just arrived. If the user has any pre-boundary
            // messages loaded, keep them visible — collapsing them now would
            // evict messages the user was already viewing.
            const hasPreBoundary = props.messages.some(message =>
                message.seq !== Number.MAX_SAFE_INTEGER &&
                props.latestBoundary !== null &&
                message.seq < props.latestBoundary.seq,
            );
            if (hasPreBoundary) {
                setPreBoundaryExpanded(true);
            }
        }
        prevLatestBoundaryKeyRef.current = latestBoundaryKey;
    }, [latestBoundaryKey, props.messages, props.latestBoundary]);

    const boundaryItems = React.useMemo(() => buildChatListBoundaryItems(
        props.messages,
        props.latestBoundary,
        preBoundaryExpanded,
    ), [props.messages, props.latestBoundary, preBoundaryExpanded]);

    const handleShowPreBoundaryHistory = React.useCallback(async () => {
        if (boundaryItems.hasLoadedBoundary) {
            setPreBoundaryExpanded(true);
            return;
        }
        const latestBoundary = props.latestBoundary;
        if (!latestBoundary) {
            setPreBoundaryExpanded(true);
            return;
        }
        let prevOldestSeq: number | undefined;
        while (true) {
            const sessionMsgs = storage.getState().sessionMessages[props.sessionId];
            if (!sessionMsgs?.hasOlder || sessionMsgs.oldestLoadedSeq <= latestBoundary.seq) {
                break;
            }
            prevOldestSeq = sessionMsgs.oldestLoadedSeq;
            await sync.loadOlder(props.sessionId);
            const after = storage.getState().sessionMessages[props.sessionId];
            if (!after || after.oldestLoadedSeq === prevOldestSeq) {
                break;
            }
        }
        setPreBoundaryExpanded(true);
    }, [boundaryItems.hasLoadedBoundary, props.latestBoundary, props.sessionId]);

    const keyExtractor = useCallback((item: ChatListBoundaryItem) => item.id, []);
    const renderItem = useCallback(({ item }: { item: ChatListBoundaryItem }) => {
        if (item.kind === 'sticky-boundary') {
            return <BoundaryDivider kind={item.latestBoundary.kind} />;
        }
        if (item.kind === 'show-pre-boundary-history') {
            return (
                <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [
                        styles.showHistoryButton,
                        pressed ? styles.showHistoryButtonPressed : null,
                    ]}
                    onPress={() => { void handleShowPreBoundaryHistory(); }}
                >
                    <Octicons name="history" size={16} color={theme.colors.text} />
                    <Text style={styles.showHistoryText}>{t('chat.boundaryDivider.showPreClearHistory')}</Text>
                </Pressable>
            );
        }
        return <MessageView message={item.message} metadata={props.metadata} sessionId={props.sessionId} chatBodyWidth={chatBodyWidth} />;
    }, [props.metadata, props.sessionId, chatBodyWidth, theme.colors.text, handleShowPreBoundaryHistory]);

    // In inverted FlatList, offset 0 = latest messages (visual bottom).
    // Offset increases as user scrolls up to see older messages.
    const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetY = e.nativeEvent.contentOffset.y;
        currentOffsetRef.current = offsetY;
        setShowScrollButton(offsetY > SCROLL_THRESHOLD);
        // Track near-bottom state for auto-scroll on new content
        isNearBottom.current = offsetY < 100;
    }, []);

    const onContentSizeChange = useCallback(() => {
        if (isNearBottom.current) {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }
    }, []);

    const scrollToBottom = useCallback(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, []);

    const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
        setViewportHeight(event.nativeEvent.layout.height);
    }, []);

    // On macOS/web, Shift+wheel swaps deltaX/deltaY — restore vertical scrolling
    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const node = (flatListRef.current as any)?.getScrollableNode?.() as HTMLElement | undefined;
        if (!node) return;
        const handler = (e: WheelEvent) => {
            if (e.shiftKey && Math.abs(e.deltaX) > 0 && Math.abs(e.deltaY) < 1) {
                node.scrollTop += e.deltaX;
                e.preventDefault();
            }
        };
        node.addEventListener('wheel', handler, { passive: false });
        return () => node.removeEventListener('wheel', handler);
    }, []);

    const handleContentSizeChange = React.useCallback((_: number, height: number) => {
        contentHeightRef.current = height;
    }, []);

    // US-006: viewport-tick adapter. The contract is intentionally narrow —
    // ChatList does NOT call storage.setRenderWindow directly, does NOT
    // import messageWindow.ts, and does NOT import prefetchManager.ts.
    // It only filters the ViewToken[] payload to confirmed message seqs and
    // forwards them to `sync.reportRenderWindow`. The flag-off short-circuit
    // and the null-window short-circuit live inside `reportRenderWindow`.
    const handleViewableItemsChanged = React.useCallback((info: { viewableItems: ViewToken[] }) => {
        const visibleSeqs: number[] = [];
        for (const token of info.viewableItems) {
            const item = token.item as ChatListBoundaryItem | undefined;
            if (item && item.kind === 'message') {
                visibleSeqs.push(item.message.seq);
            }
        }
        sync.reportRenderWindow(props.sessionId, visibleSeqs);
    }, [props.sessionId]);

    const handleEndReached = React.useCallback(() => {
        const sessionMessages = storage.getState().sessionMessages[props.sessionId];
        if (!sessionMessages?.hasOlder || sessionMessages.loadingOlder) {
            return;
        }

        void sync.loadOlder(props.sessionId);
    }, [props.sessionId]);

    const { olderMessagesTapGesture, newerMessagesTapGesture } = usePageTurnScroll({
        flatListRef,
        currentOffsetRef,
        contentHeightRef,
        viewportHeight,
        sessionId: props.sessionId,
        chatPaginatedScroll,
        firstMessageId: props.messages[0]?.id,
        setShowScrollButton,
        pinchGesture,
    });

    const list = (
        <FlatList
            ref={flatListRef}
            data={boundaryItems.items}
            inverted={true}
            keyExtractor={keyExtractor}
            {...chatListEinkProps}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
            renderItem={renderItem}
            onScroll={handleScroll}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.1}
            onViewableItemsChanged={handleViewableItemsChanged}
            onContentSizeChange={handleContentSizeChange}
            scrollEventThrottle={32}
            scrollEnabled={!chatPaginatedScroll}
            ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
            ListFooterComponent={<ListHeader />}
        />
    );

    const inner = (
        <View style={{ flex: 1 }} onLayout={handleLayout}>
            {pinchToZoomEnabled ? (
                <GestureDetector gesture={pinchGesture}>
                    {list}
                </GestureDetector>
            ) : list}
            {chatPaginatedScroll && (
                <>
                    <GestureDetector gesture={olderMessagesTapGesture}>
                        <View
                            style={[
                                styles.pageTurnZone,
                                styles.pageTurnZoneTop,
                                { height: viewportHeight * 0.15 },
                            ]}
                        />
                    </GestureDetector>
                    <GestureDetector gesture={newerMessagesTapGesture}>
                        <View
                            style={[
                                styles.pageTurnZone,
                                styles.pageTurnZoneBottom,
                                { height: viewportHeight * 0.15 },
                            ]}
                        />
                    </GestureDetector>
                </>
            )}
            {showScrollButton && !chatPaginatedScroll && (
                <View style={styles.scrollButtonContainer}>
                    <Pressable
                        style={({ pressed }) => [
                            styles.scrollButton,
                            pressed ? styles.scrollButtonPressed : styles.scrollButtonDefault
                        ]}
                        onPress={scrollToBottom}
                    >
                        <Octicons name="arrow-down" size={14} color={theme.colors.text} />
                    </Pressable>
                </View>
            )}
        </View>
    );

    return pinchToZoomEnabled ? (
        <ChatScaleLiveContext.Provider value={{ liveMultiplier, isActive }}>
            {inner}
        </ChatScaleLiveContext.Provider>
    ) : inner;
});

const styles = StyleSheet.create((theme) => ({
    pageTurnZone: {
        position: 'absolute',
        left: 0,
        right: 0,
        backgroundColor: 'transparent',
    },
    pageTurnZoneTop: {
        top: 0,
    },
    pageTurnZoneBottom: {
        bottom: 0,
    },
    scrollButtonContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 12,
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'box-none',
    },
    scrollButton: {
        borderRadius: 16,
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.divider,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 1 },
        shadowRadius: 2,
        shadowOpacity: theme.colors.shadow.opacity * 0.5,
        elevation: 2,
    },
    scrollButtonDefault: {
        backgroundColor: theme.colors.surface,
        opacity: 0.9,
    },
    scrollButtonPressed: {
        backgroundColor: theme.colors.surface,
        opacity: 0.7,
    },
    showHistoryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        gap: 8,
        marginHorizontal: 8,
        marginVertical: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        backgroundColor: theme.colors.surface,
    },
    showHistoryButtonPressed: {
        backgroundColor: theme.colors.surface,
        opacity: 0.7,
    },
    showHistoryText: {
        color: theme.colors.text,
        fontSize: 14,
        lineHeight: 20,
    },
}));
