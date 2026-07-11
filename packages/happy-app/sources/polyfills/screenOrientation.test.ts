import { afterEach, describe, expect, it, vi } from 'vitest';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalScreen = Object.getOwnPropertyDescriptor(globalThis, 'screen');

function setBrowserGlobals(fakeScreen: object): void {
    Object.defineProperty(globalThis, 'window', {
        value: {},
        configurable: true,
    });
    Object.defineProperty(globalThis, 'screen', {
        value: fakeScreen,
        configurable: true,
    });
}

function restoreGlobal(name: 'window' | 'screen', descriptor: PropertyDescriptor | undefined): void {
    if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
    } else {
        delete (globalThis as Record<string, unknown>)[name];
    }
}

afterEach(() => {
    restoreGlobal('window', originalWindow);
    restoreGlobal('screen', originalScreen);
    vi.resetModules();
});

describe('screenOrientation polyfill', () => {
    it('installs the canonical orientation stub when the browser API is absent', async () => {
        const fakeScreen: { orientation?: Record<string, unknown> } = {};
        setBrowserGlobals(fakeScreen);

        await import('./screenOrientation');

        expect(fakeScreen.orientation).toMatchObject({
            type: 'landscape-primary',
            angle: 0,
        });
        expect(fakeScreen.orientation?.addEventListener).toEqual(expect.any(Function));
        expect(fakeScreen.orientation?.removeEventListener).toEqual(expect.any(Function));
        expect(fakeScreen.orientation?.dispatchEvent).toEqual(expect.any(Function));
    });

    it('preserves a native screen.orientation implementation', async () => {
        const orientation = {
            type: 'portrait-primary',
            angle: 90,
        };
        const fakeScreen = { orientation };
        setBrowserGlobals(fakeScreen);

        await import('./screenOrientation');

        expect(fakeScreen.orientation).toBe(orientation);
    });
});
