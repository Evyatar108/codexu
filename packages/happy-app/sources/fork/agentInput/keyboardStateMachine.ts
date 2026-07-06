/**
 * FORK PATCH: [RESTORE-R8c] AgentInput keyboard/focus state machine (invariant HA-6).
 *
 * Fork-owned overlay seam for AgentInput's e-ink keyboard-navigation reducer.
 * This reducer manages the textarea ↔ firstOverlayControl focus hand-off and the
 * picker/autocomplete overlay-open flags that the fork uses to drive the
 * composer's overlay UX on the BOOX (Tab-from-textarea focuses the first overlay
 * control, Enter opens the picker, Escape returns focus to the textarea, etc.).
 *
 * The reducer + its types are FORK-INTRODUCED (absent from upstream cli-1.1.8 and
 * cli-1.1.10). Relocating them here keeps AgentInput.tsx close to upstream shape.
 * AgentInput.tsx re-exports these symbols so the reducer identity tests
 * (`AgentInput.keyboard.test.tsx`) and any consumer importing from `./AgentInput`
 * keep working. This is a PURE MOVE — the state transitions are byte-identical to
 * the pre-R8 inline reducer. See docs/happy-patch-surface.md (HA-6).
 */

export interface AgentInputKeyboardState {
    focusTarget: 'textarea' | 'firstOverlayControl';
    overlayOpen: boolean;
    pickerOpen: boolean;
    autocompleteOpen: boolean;
}

export type AgentInputKeyboardAction =
    | { type: 'tabFromTextarea' }
    | { type: 'openPicker' }
    | { type: 'enterOnOverlayControl' }
    | { type: 'escape' }
    | { type: 'toggleAutocomplete' };

export const initialAgentInputKeyboardState: AgentInputKeyboardState = {
    focusTarget: 'textarea',
    overlayOpen: false,
    pickerOpen: false,
    autocompleteOpen: false,
};

export function reduceAgentInputKeyboardState(
    state: AgentInputKeyboardState,
    action: AgentInputKeyboardAction,
): AgentInputKeyboardState {
    switch (action.type) {
        case 'tabFromTextarea':
            return {
                ...state,
                focusTarget: 'firstOverlayControl',
                overlayOpen: true,
            };
        case 'openPicker':
            return {
                ...state,
                focusTarget: 'firstOverlayControl',
                overlayOpen: true,
                pickerOpen: true,
            };
        case 'enterOnOverlayControl':
            return state.focusTarget === 'firstOverlayControl'
                ? {
                    ...state,
                    overlayOpen: true,
                    pickerOpen: true,
                }
                : state;
        case 'escape':
            return {
                ...state,
                focusTarget: 'textarea',
                overlayOpen: false,
                pickerOpen: false,
            };
        case 'toggleAutocomplete':
            return {
                ...state,
                autocompleteOpen: !state.autocompleteOpen,
            };
    }
}
