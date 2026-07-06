/**
 * FORK PATCH: [RESTORE-R8b] e-ink pinch-to-zoom chat font-scale gesture (invariant HA-5).
 * Relocated from components/ChatList.tsx; consumed by
 * sources/fork/chat/ForkFlatChatList.tsx. See docs/happy-patch-surface.md HA-5.
 * Do NOT change observable behavior.
 */
import * as React from 'react';
import { runOnJS, useSharedValue, SharedValue } from 'react-native-reanimated';
import {
    Gesture,
    GestureStateChangeEvent,
    GestureUpdateEvent,
    PinchGestureHandlerEventPayload,
    PinchGesture,
} from 'react-native-gesture-handler';
import { storage, useLocalSetting } from '@/sync/storage';
import { CHAT_FONT_SCALE_MIN, CHAT_FONT_SCALE_MAX } from '@/hooks/useChatFontScale';

export interface PinchFontScale {
    pinchToZoomEnabled: boolean;
    pinchGesture: PinchGesture;
    liveMultiplier: SharedValue<number>;
    isActive: SharedValue<boolean>;
}

export function usePinchFontScale(): PinchFontScale {
    const liveMultiplier = useSharedValue(1.0);
    const isActive = useSharedValue(false);
    const pinchToZoomEnabled = useLocalSetting('pinchToZoomEnabled');
    const chatFontScale = useLocalSetting('chatFontScale');

    const setChatFontScale = React.useCallback((nextScale: number) => {
        storage.getState().applyLocalSettings({ chatFontScale: nextScale });
    }, []);

    const pinchGesture = React.useMemo(() => {
        // Pinch gesture inherently requires 2 pointers in RNGH — the previous
        // `.minPointers(2).maxPointers(2)` cast-and-call pattern crashed at
        // runtime on RNGH 2.30.0 ("minPointers is not a function") because
        // those helpers do NOT exist on PinchGesture (they live on BaseGesture
        // for tap/longPress, not pinch). Default behavior is correct.
        return Gesture.Pinch()
            .onBegin(() => {
                isActive.value = true;
            })
            .onUpdate((event: GestureUpdateEvent<PinchGestureHandlerEventPayload>) => {
                const nextScale = Math.max(CHAT_FONT_SCALE_MIN, Math.min(CHAT_FONT_SCALE_MAX, chatFontScale * event.scale));
                liveMultiplier.value = nextScale / chatFontScale;
            })
            .onEnd((event: GestureStateChangeEvent<PinchGestureHandlerEventPayload>) => {
                const nextScale = Math.max(CHAT_FONT_SCALE_MIN, Math.min(CHAT_FONT_SCALE_MAX, chatFontScale * event.scale));
                runOnJS(setChatFontScale)(nextScale);
            })
            // This onFinalize reset IS the cancelled-pinch fallback (formerly tracked as `pendingScale` in plans). Do not remove without on-device re-verification on BOOX.
            .onFinalize(() => {
                liveMultiplier.value = 1;
                isActive.value = false;
            });
    }, [chatFontScale, isActive, liveMultiplier, setChatFontScale]);

    return { pinchToZoomEnabled, pinchGesture, liveMultiplier, isActive };
}
