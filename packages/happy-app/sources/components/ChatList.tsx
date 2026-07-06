import * as React from 'react';
import { storage, useLocalSetting, useSession, useSessionMessages } from "@/sync/storage";
import { sync } from '@/sync/sync';
import { AppState, FlatList, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, View } from 'react-native';
import { useCallback } from 'react';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageView } from './MessageView';
import { AgentWorkGroupView, ToolGroupView } from './ToolGroupView';
import { Metadata, Session } from '@/sync/storageTypes';
import { ChatFooter } from './ChatFooter';
import { Message } from '@/sync/typesMessage';
import { DisplayItem, ToolGroupItem, useGroupedMessages } from '@/hooks/useGroupedMessages';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useChatWidth } from '@/hooks/useChatWidth';
import { ForkFlatChatList } from '@/fork/chat/ForkFlatChatList';

const SCROLL_THRESHOLD = 300;

export const ChatList = React.memo((props: { session: Session }) => {
    // FORK PATCH: [RESTORE-R8b] ChatList tool-grouping render path (invariant HA-5).
    // ChatList regains upstream's tool-grouping path; the fork's flat e-ink
    // rendering is quarantined in the fork overlay (sources/fork/chat/*) and
    // stays the DEFAULT via the `chatToolGrouping` local setting. Only 'grouped'
    // selects the restored path below; see docs/happy-patch-surface.md HA-5.
    const chatToolGrouping = useLocalSetting('chatToolGrouping');
    if (chatToolGrouping === 'grouped') {
        return <ChatListGrouped session={props.session} />;
    }
    return <ForkFlatChatList session={props.session} />;
});

const ChatListGrouped = React.memo((props: { session: Session }) => {
    const { messages } = useSessionMessages(props.session.id);
    return (
        <ChatListInternal
            metadata={props.session.metadata}
            sessionId={props.session.id}
            messages={messages}
        />
    )
});

const ListHeader = React.memo(() => {
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    // ListFooterComponent on an inverted FlatList renders at the visual top.
    // Fork adaptation: the fork loads older messages from storage (no reactive
    // isLoadingOlder flag on useSessionMessages), so — unlike upstream — this
    // header is a spacer only; the "loading older" spinner was dropped in the
    // grouped-mode restore. The spacer keeps the header bar from clipping the
    // oldest message.
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', height: headerHeight + safeArea.top + 32 }} />
    );
});

const ListFooter = React.memo((props: { sessionId: string }) => {
    const session = useSession(props.sessionId)!;
    return (
        <ChatFooter controlledByUser={session.agentState?.controlledByUser || false} />
    )
});

const ChatListInternal = React.memo((props: {
    metadata: Metadata | null,
    sessionId: string,
    messages: Message[],
}) => {
    const { theme } = useUnistyles();
    const flatListRef = React.useRef<FlatList>(null);
    const [showScrollButton, setShowScrollButton] = React.useState(false);
    // Tracks whether the scroll-button is currently shown, so we only call
    // setShowScrollButton when the threshold is actually crossed instead of
    // on every scroll frame (60Hz). Without this guard, the entire list
    // parent re-renders on every wheel tick.
    const showScrollButtonRef = React.useRef(false);
    const session = useSession(props.sessionId);
    const { body: chatBodyWidth } = useChatWidth();

    // Collapse agent work between a user prompt and the final answer.
    // Nested tool groups remain expandable inside the work block. In grouped
    // mode the toggle has already selected grouping, so grouping is always on.
    const hasPendingPermission = Boolean(
        session?.agentState?.requests && Object.keys(session.agentState.requests).length > 0,
    );
    const collapseCurrentTurn = session?.thinking !== true && !hasPendingPermission;
    const groupingOptions = React.useMemo(
        () => ({ collapseCurrentTurn }),
        [collapseCurrentTurn],
    );
    const displayItems = useGroupedMessages(props.messages, true, groupingOptions);

    // Tracks which groups are explicitly collapsed. Groups start collapsed;
    // pending approval groups are the only ones we auto-expand.
    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => {
        const initial = new Set<string>();
        for (const item of displayItems) {
            if (isCollapsibleDisplayItem(item) && !item.hasPendingPermission) {
                initial.add(item.id);
            }
        }
        return initial;
    });

    // Auto-expand groups that need user approval — but only if the user
    // hasn't manually collapsed them.
    // We track manually-collapsed IDs so we never force-reopen them.
    const manuallyCollapsedRef = React.useRef<Set<string>>(new Set());
    const initialSeenCollapsibleGroups = React.useMemo(() => {
        const initial = new Set<string>();
        for (const item of displayItems) {
            if (isCollapsibleDisplayItem(item)) {
                initial.add(item.id);
            }
        }
        return initial;
    }, []);
    const seenCollapsibleGroupsRef = React.useRef<Set<string>>(initialSeenCollapsibleGroups);

    React.useEffect(() => {
        setCollapsedGroups((prev) => {
            let changed = false;
            const next = new Set(prev);
            const seen = seenCollapsibleGroupsRef.current;
            for (const item of displayItems) {
                if (!isCollapsibleDisplayItem(item)) {
                    continue;
                }
                const isNewGroup = !seen.has(item.id);
                if (isNewGroup) {
                    seen.add(item.id);
                }
                if (item.hasPendingPermission && prev.has(item.id) && !manuallyCollapsedRef.current.has(item.id)) {
                    next.delete(item.id);
                    changed = true;
                    continue;
                }
                if (isNewGroup && !item.hasPendingPermission) {
                    next.add(item.id);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [displayItems]);

    // Ref so AppState handler reads fresh items without re-subscribing
    const displayItemsRef = React.useRef(displayItems);
    displayItemsRef.current = displayItems;

    // Auto-collapse completed groups when app goes to background / tab hidden
    React.useEffect(() => {
        const sub = AppState.addEventListener('change', (state) => {
            if (state !== 'active') {
                setCollapsedGroups((prev) => {
                    const next = new Set(prev);
                    for (const item of displayItemsRef.current) {
                        if (isCollapsibleDisplayItem(item) && !item.hasRunning) {
                            next.add(item.id);
                        }
                    }
                    return next;
                });
            }
        });
        return () => sub.remove();
    }, []);

    // Auto-collapse all previous groups when user sends a new message
    const latestUserMsgId = React.useMemo(() => {
        for (const msg of props.messages) {
            if (msg.kind === 'user-text') return msg.id;
        }
        return null;
    }, [props.messages]);

    const prevUserMsgIdRef = React.useRef(latestUserMsgId);
    React.useEffect(() => {
        if (latestUserMsgId && latestUserMsgId !== prevUserMsgIdRef.current) {
            prevUserMsgIdRef.current = latestUserMsgId;
            manuallyCollapsedRef.current.clear();
            setCollapsedGroups((prev) => {
                const next = new Set(prev);
                for (const item of displayItemsRef.current) {
                    if (isCollapsibleDisplayItem(item)) {
                        next.add(item.id);
                    }
                }
                return next;
            });
        }
    }, [latestUserMsgId]);

    const handleToggleGroup = useCallback((groupId: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
                manuallyCollapsedRef.current.delete(groupId);
            } else {
                next.add(groupId);
                manuallyCollapsedRef.current.add(groupId);
            }
            return next;
        });
    }, []);

    const keyExtractor = useCallback((item: DisplayItem) => item.id, []);

    const renderItem = useCallback(({ item }: { item: DisplayItem }) => {
        if (item.type === 'tool-group') {
            return (
                <ToolGroupView
                    group={item}
                    metadata={props.metadata}
                    sessionId={props.sessionId}
                    expanded={!collapsedGroups.has(item.id)}
                    onToggle={() => handleToggleGroup(item.id)}
                />
            );
        }
        if (item.type === 'agent-work-group') {
            return (
                <AgentWorkGroupView
                    group={item}
                    metadata={props.metadata}
                    sessionId={props.sessionId}
                    expanded={!collapsedGroups.has(item.id)}
                    onToggle={() => handleToggleGroup(item.id)}
                />
            );
        }
        return (
            <MessageView
                message={item.message}
                metadata={props.metadata}
                sessionId={props.sessionId}
                chatBodyWidth={chatBodyWidth}
            />
        );
    }, [props.metadata, props.sessionId, chatBodyWidth, collapsedGroups, handleToggleGroup]);

    // In inverted FlatList, offset 0 = latest messages (visual bottom).
    // Offset increases as user scrolls up to see older messages.
    // Auto-stick-to-bottom on new messages is handled natively by FlatList's
    // maintainVisibleContentPosition.autoscrollToBottomThreshold — no JS-side
    // scrollToOffset is needed (and running both produces a fight that drags
    // the user's viewport when reading older messages mid-stream).
    const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetY = e.nativeEvent.contentOffset.y;
        const next = offsetY > SCROLL_THRESHOLD;
        if (next !== showScrollButtonRef.current) {
            showScrollButtonRef.current = next;
            setShowScrollButton(next);
        }
    }, []);

    const scrollToBottom = useCallback(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, []);

    // In an inverted FlatList, `onEndReached` fires when the user scrolls
    // past the visual top — i.e. when they want to see older history.
    // Initial fetch only loads the latest page, so we lazy-load earlier pages
    // here. Fork adaptation: older-page loading is storage-based (upstream's
    // hasMoreOlder / loadOlderMessages hook fields do not exist on the fork's
    // useSessionMessages), matching the fork's flat-path handleEndReached.
    const sessionId = props.sessionId;
    const handleLoadOlder = useCallback(() => {
        const sessionMessages = storage.getState().sessionMessages[sessionId];
        if (!sessionMessages?.hasOlder || sessionMessages.loadingOlder) {
            return;
        }
        void sync.loadOlder(sessionId);
    }, [sessionId]);

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

    return (
        <View style={{ flex: 1 }}>
            <FlatList
                ref={flatListRef}
                data={displayItems}
                inverted={true}
                keyExtractor={keyExtractor}
                maintainVisibleContentPosition={{
                    // Anchor on the second-newest message (index 1), not the
                    // newest. The newest slot (index 0) gets a brand-new item
                    // each agent token, which would otherwise destabilise the
                    // anchor and drag the viewport up.
                    //
                    // autoscrollToTopThreshold: for INVERTED lists this is
                    // actually the auto-stick-to-visual-bottom threshold —
                    // contentOffset 0 is at the visual bottom in an inverted
                    // list, and this prop sticks the viewport to offset 0
                    // when the user is within N units of it.
                    minIndexForVisible: 1,
                    autoscrollToTopThreshold: 50,
                }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
                renderItem={renderItem}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
                ListFooterComponent={<ListHeader />}
                onEndReached={handleLoadOlder}
                onEndReachedThreshold={0.5}
            />
            {showScrollButton && (
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
    )
});

function isCollapsibleDisplayItem(item: DisplayItem): item is ToolGroupItem | Extract<DisplayItem, { type: 'agent-work-group' }> {
    return item.type === 'tool-group' || item.type === 'agent-work-group';
}

const styles = StyleSheet.create((theme) => ({
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
}));
