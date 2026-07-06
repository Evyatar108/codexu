/**
 * FORK PATCH: [RESTORE-R8b] e-ink ChatList FlatList tuning constants (invariant HA-5).
 * Relocated verbatim from components/ChatList.tsx; consumed by
 * sources/fork/chat/ForkFlatChatList.tsx. See docs/happy-patch-surface.md HA-5.
 * Do NOT change observable behavior — these values are on-device tuned for the
 * slow-CPU/no-GPU Android e-ink panel target.
 */

export const chatListEinkProps = {
    initialNumToRender: 8,
    maxToRenderPerBatch: 4,
    // Keep anchor rows mounted on slow-CPU/no-GPU e-ink panels:
    // when older messages arrive on `onEndReached`, MVCP needs the
    // data-index-0 row to be mounted to compute the offset delta.
    // windowSize=5 + removeClippedSubviews=true unmounted that
    // anchor whenever the user was scrolled high (~2.5 viewports up),
    // and contentSize changes against a null anchor caused RN to
    // fall back to absolute-offset clamping → visible snap-back when
    // a load-older batch arrived. Diagnosed 2026-04-29; see the
    // contentSize-shrink trace in
    // `.ralph/brainstorms/streaming-pagination-scroll-jump/`.
    windowSize: 21,
    removeClippedSubviews: false,
    maintainVisibleContentPosition: {
        minIndexForVisible: 0,
        autoscrollToTopThreshold: 10,
    },
};
