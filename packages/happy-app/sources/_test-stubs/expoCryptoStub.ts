// Minimal stub for the Expo Crypto native module used only by the Vitest node
// runner. The real module depends on expo-modules-core internals that assume a
// React-Native / Metro runtime. Tests that transitively import device key
// material inject their own deterministic generators, so a counter-based byte
// source is sufficient here and keeps module import chains loading cleanly.

let counter = 0;

export function getRandomBytes(byteCount: number): Uint8Array {
    const out = new Uint8Array(byteCount);
    for (let i = 0; i < byteCount; i++) {
        out[i] = (counter + i) & 0xff;
    }
    counter = (counter + byteCount) & 0xff;
    return out;
}

export async function getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
    return getRandomBytes(byteCount);
}

export default {
    getRandomBytes,
    getRandomBytesAsync,
};
