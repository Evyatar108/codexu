import { describe, expect, it } from 'vitest';
import {
    initialAgentInputKeyboardState,
    reduceAgentInputKeyboardState,
    type AgentInputKeyboardState,
} from './keyboardStateMachine';

// R8c: these assertions pin the transition table of the relocated fork keyboard
// reducer. They must match the pre-relocation inline reducer byte-for-byte —
// `AgentInput.keyboard.test.tsx` additionally asserts `./AgentInput` re-exports
// these very references, so the two suites together guarantee an identity move.
describe('fork AgentInput keyboard state machine', () => {
    it('starts focused on the textarea with every overlay closed', () => {
        expect(initialAgentInputKeyboardState).toEqual({
            focusTarget: 'textarea',
            overlayOpen: false,
            pickerOpen: false,
            autocompleteOpen: false,
        });
    });

    it('tabFromTextarea moves focus to the first overlay control and opens the overlay', () => {
        const next = reduceAgentInputKeyboardState(initialAgentInputKeyboardState, { type: 'tabFromTextarea' });
        expect(next).toEqual({
            focusTarget: 'firstOverlayControl',
            overlayOpen: true,
            pickerOpen: false,
            autocompleteOpen: false,
        });
    });

    it('openPicker opens both the overlay and the picker and focuses the overlay control', () => {
        const next = reduceAgentInputKeyboardState(initialAgentInputKeyboardState, { type: 'openPicker' });
        expect(next).toEqual({
            focusTarget: 'firstOverlayControl',
            overlayOpen: true,
            pickerOpen: true,
            autocompleteOpen: false,
        });
    });

    it('enterOnOverlayControl opens the picker only when focus is already on the overlay control', () => {
        // No-op from the initial (textarea-focused) state — returns the same reference.
        expect(
            reduceAgentInputKeyboardState(initialAgentInputKeyboardState, { type: 'enterOnOverlayControl' }),
        ).toBe(initialAgentInputKeyboardState);

        const focused = reduceAgentInputKeyboardState(initialAgentInputKeyboardState, { type: 'tabFromTextarea' });
        const opened = reduceAgentInputKeyboardState(focused, { type: 'enterOnOverlayControl' });
        expect(opened.overlayOpen).toBe(true);
        expect(opened.pickerOpen).toBe(true);
        expect(opened.focusTarget).toBe('firstOverlayControl');
    });

    it('escape returns focus to the textarea and closes the overlay + picker (autocomplete untouched)', () => {
        const opened: AgentInputKeyboardState = {
            focusTarget: 'firstOverlayControl',
            overlayOpen: true,
            pickerOpen: true,
            autocompleteOpen: true,
        };
        const next = reduceAgentInputKeyboardState(opened, { type: 'escape' });
        expect(next).toEqual({
            focusTarget: 'textarea',
            overlayOpen: false,
            pickerOpen: false,
            autocompleteOpen: true,
        });
    });

    it('toggleAutocomplete flips only the autocomplete flag', () => {
        const on = reduceAgentInputKeyboardState(initialAgentInputKeyboardState, { type: 'toggleAutocomplete' });
        expect(on.autocompleteOpen).toBe(true);
        expect(on.focusTarget).toBe('textarea');
        expect(on.overlayOpen).toBe(false);
        const off = reduceAgentInputKeyboardState(on, { type: 'toggleAutocomplete' });
        expect(off.autocompleteOpen).toBe(false);
    });

    it('does not mutate the input state', () => {
        const frozen = Object.freeze({ ...initialAgentInputKeyboardState });
        expect(() => reduceAgentInputKeyboardState(frozen, { type: 'tabFromTextarea' })).not.toThrow();
        expect(frozen).toEqual(initialAgentInputKeyboardState);
    });
});
