import { describe, expect, it } from 'vitest';
import { decodeIncoming, encodeOutgoing, type EncryptionVariant } from './sessionPayloadCodec';
import { decodeBase64, decrypt, encodeBase64, encrypt, getRandomBytes } from './encryption';

/**
 * GOLDEN round-trip tests for the R2 session-payload codec seam.
 *
 * These pin the codec to reproduce the fork's CURRENT bytes and control flow
 * VERBATIM (no wire/at-rest format change). Two guarantees matter:
 *   1. `encodeOutgoing` / `decodeIncoming` are byte-identical to the inline
 *      pre-refactor code for BOTH the plaintext-live and decrypt-fetch paths.
 *   2. The send/live/fetch asymmetry (HC-1/HC-2/HC-3) is preserved: send emits
 *      PLAINTEXT, and the fetch path against a plaintext body fails to recover
 *      the message — returning null OR throwing (variant/length dependent), both
 *      of which the fetch call site's try/catch collapses to the silent HC-3
 *      drop — documented, NOT fixed.
 */

const samplePayloads: unknown[] = [
    { t: 'user', text: 'hello world', meta: { seq: 1 } },
    { role: 'agent', content: [{ type: 'text', text: 'line1\nline2 — em dash 🚀' }] },
    'a bare string body',
    42,
    ['array', 'of', { nested: true }],
    { unicode: 'ключ', nested: { a: [1, 2, 3], b: null } },
];

const variants: EncryptionVariant[] = ['legacy', 'dataKey'];

describe('sessionPayloadCodec.encodeOutgoing', () => {
    it('is byte-identical to the pre-refactor inline JSON.stringify(content)', () => {
        for (const payload of samplePayloads) {
            expect(encodeOutgoing(payload)).toBe(JSON.stringify(payload));
        }
    });

    it('REGRESSION: send emits PLAINTEXT (no encryption) — documents the current contract', () => {
        // The output is plaintext JSON: it parses straight back to the input,
        // proving there is NO ciphertext on the send path. A future E2E flip
        // must be a deliberate, reviewed change that breaks this assertion.
        for (const payload of samplePayloads) {
            const raw = encodeOutgoing(payload);
            expect(JSON.parse(raw)).toEqual(payload);
        }
    });
});

describe('sessionPayloadCodec.decodeIncoming — live (plaintext)', () => {
    it('is byte-identical to the pre-refactor inline JSON.parse(content.c)', () => {
        for (const payload of samplePayloads) {
            const raw = JSON.stringify(payload);
            expect(decodeIncoming(raw, { source: 'live' })).toEqual(JSON.parse(raw));
        }
    });

    it('round-trips encodeOutgoing → decodeIncoming(live) losslessly (plaintext path)', () => {
        for (const payload of samplePayloads) {
            const raw = encodeOutgoing(payload);
            expect(decodeIncoming(raw, { source: 'live' })).toEqual(payload);
        }
    });
});

describe('sessionPayloadCodec.decodeIncoming — fetch (decrypt)', () => {
    it('is byte-identical to the pre-refactor inline decrypt(key, variant, decodeBase64(content.c))', () => {
        for (const variant of variants) {
            const key = getRandomBytes(32);
            for (const payload of samplePayloads) {
                // Build a genuinely-encrypted at-rest body (what a decrypt-on-fetch
                // path is designed to consume).
                const contentC = encodeBase64(encrypt(key, variant, payload));

                const inlineDecoded = decrypt(key, variant, decodeBase64(contentC));
                const codecDecoded = decodeIncoming(contentC, {
                    source: 'fetch',
                    encryptionKey: key,
                    encryptionVariant: variant,
                });

                expect(codecDecoded).toEqual(inlineDecoded);
                expect(codecDecoded).toEqual(payload);
            }
        }
    });

    it('HC-3 PRESERVED: fetch decode of a PLAINTEXT-sent body never recovers the message — dropped via throw-or-null (NOT fixed)', () => {
        // Capture the exact outcome (thrown error vs returned value) of an
        // expression so the codec can be proven byte-identical to the inline
        // pre-refactor code even when decrypt() THROWS rather than returns null.
        const capture = (fn: () => unknown): { threw: boolean; error?: unknown; value?: unknown } => {
            try {
                return { threw: false, value: fn() };
            } catch (error) {
                return { threw: true, error };
            }
        };

        for (const variant of variants) {
            const key = getRandomBytes(32);
            for (const payload of samplePayloads) {
                // The send path emits plaintext; the fetch path still calls
                // decrypt(decodeBase64(plaintext)). Depending on variant + body
                // length this either THROWS (legacy: `bad nonce size` when the
                // base64-garbage is shorter than a nonce, or auth-fail → null)
                // or returns null (dataKey has an internal try/catch). BOTH land
                // in the fetch call site's try/catch → 'Failed to decrypt fetched
                // message' → the fetched replay is SILENTLY DROPPED. This is the
                // HC-3 latent bug, reproduced here to lock the current behavior.
                const plaintextBody = encodeOutgoing(payload);

                const inline = capture(() => decrypt(key, variant, decodeBase64(plaintextBody)));
                const codec = capture(() =>
                    decodeIncoming(plaintextBody, {
                        source: 'fetch',
                        encryptionKey: key,
                        encryptionVariant: variant,
                    }),
                );

                // GOLDEN: the codec reproduces the inline expression VERBATIM —
                // same throw-vs-return outcome, same value/error message.
                expect(codec.threw).toBe(inline.threw);
                if (inline.threw) {
                    expect((codec.error as Error).message).toBe((inline.error as Error).message);
                } else {
                    expect(codec.value).toEqual(inline.value);
                    // When it does not throw, decrypt of plaintext yields null.
                    expect(codec.value).toBeNull();
                }

                // HC-3 invariant: whatever the mechanism (throw or null), the
                // plaintext body NEVER decodes back to the original content.
                expect(codec.threw ? null : codec.value).not.toEqual(payload);
            }
        }
    });
});
