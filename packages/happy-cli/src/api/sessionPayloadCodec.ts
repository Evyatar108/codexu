import { decodeBase64, decrypt } from './encryption';

/**
 * Fork-owned session message-body codec seam (R2).
 *
 * BEHAVIOR-PRESERVING RELOCATION ONLY. This module reproduces the fork's
 * CURRENT on-the-wire / at-rest bytes verbatim; it does NOT re-enable E2E
 * encryption and does NOT change the wire or at-rest format. The fork's
 * message-body path is deliberately asymmetric today:
 *
 *   - SEND    (`encodeOutgoing`)                    → plaintext `JSON.stringify(content)` — NO `encrypt()`.
 *   - LIVE    (`decodeIncoming({ source: 'live' })`)  → `JSON.parse(raw)` — NO `decrypt()` (mirrors send).
 *   - FETCH   (`decodeIncoming({ source: 'fetch' })`) → `decrypt(...)` over the base64 body.
 *
 * The fetch-vs-(send/live) asymmetry is the latent HC-3 bug catalogued in
 * `docs/happy-patch-surface.md`: because send + live are plaintext, the fetch
 * path's `decrypt()` fails against a plaintext-sent body — it either returns
 * `null` (auth-fail, or the `dataKey` variant's internal catch) or THROWS
 * (e.g. the `legacy` variant's `bad nonce size` when the base64-garbage is
 * shorter than a nonce). The fetch CALL SITE in `apiSession.ts` wraps this in a
 * try/catch that logs "Failed to decrypt fetched message" and skips, so BOTH
 * outcomes collapse to the same silent drop of fork-sent messages on reconnect
 * catch-up. This codec is a pure relocation: it propagates the throw/null
 * verbatim and does NOT swallow it — the drop semantics stay at the call site.
 * R2 relocates this asymmetry behind one fork-owned seam WITHOUT fixing it — a
 * real fix is a wire/at-rest FORMAT change (plaintext → ciphertext) and is out
 * of scope for M1. See the plan §3d/§5 and invariants HC-1/HC-2/HC-3/HS-4.
 */

export type EncryptionVariant = 'legacy' | 'dataKey';

export type DecodeIncomingOptions =
    | { source: 'live' }
    | { source: 'fetch'; encryptionKey: Uint8Array; encryptionVariant: EncryptionVariant };

/**
 * Encode a session message body for send. Reproduces the current fork send
 * bytes verbatim: plaintext `JSON.stringify(content)` (the historical local
 * `encrypted` variable name is a misnomer — there is NO encryption on send).
 */
export function encodeOutgoing(content: unknown): string {
    return JSON.stringify(content);
}

/**
 * Decode an incoming session message body, preserving the send/live/fetch
 * asymmetry verbatim:
 *   - `'live'`  → `JSON.parse(raw)` (plaintext; mirrors the plaintext send path).
 *   - `'fetch'` → `decrypt(encryptionKey, encryptionVariant, decodeBase64(raw))`,
 *                 which fails against a plaintext-sent body by returning `null`
 *                 OR throwing (variant/length dependent) — the HC-3 silent-drop,
 *                 preserved exactly (NOT fixed here). The throw/null is
 *                 propagated to the caller, whose try/catch performs the drop.
 */
export function decodeIncoming(raw: string, options: DecodeIncomingOptions): unknown {
    if (options.source === 'live') {
        return JSON.parse(raw);
    }
    return decrypt(options.encryptionKey, options.encryptionVariant, decodeBase64(raw));
}
