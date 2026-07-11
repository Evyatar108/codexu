import { describe, expect, it } from 'vitest';

import type { Message } from '@/sync/typesMessage';
import {
    assertNativeHappyP0ResultRedacted,
    canonicalizeNativeHappyTarget,
    classifyNativeHappyP0Failures,
    decodeNativeHappyLocalInvite,
    encodeBase64Url,
    isExpectedNativeHappyPairResponse,
    isExpectedNativeHappySnapshotSequence,
    NATIVE_HAPPY_P0_BROWSER_ORIGIN,
    NATIVE_HAPPY_P0_MACHINE_ID,
    NATIVE_HAPPY_P0_SERVER_URL,
    NativeHappyP0ProbeController,
    type NativeHappyP0CompatibilityResult,
} from './nativeHappyP0Probe';
import {
    applyNativeHappyDurableFinal,
    applyNativeHappySnapshot,
    buildNativeHappyRendererFixtureState,
    createNativeHappySnapshotProbeState,
    getNativeHappyTransientMessageId,
    NATIVE_HAPPY_P0_RENDERER_FIXTURE,
    selectNativeHappySnapshotMessages,
} from './nativeHappySnapshotProbe';

describe('native Happy P0 probe', () => {
    it('canonicalizes query pairs without changing the path', () => {
        expect(canonicalizeNativeHappyTarget('/proof-check?b=2&a=hello%20world&a=1')).toBe(
            '/proof-check?a=1&a=hello+world&b=2',
        );
        expect(() => canonicalizeNativeHappyTarget('/proof-check?bad=%x')).toThrow(
            'invalid proof target encoding',
        );
        expect(() => canonicalizeNativeHappyTarget('/proof-check?bad=%FF')).toThrow(
            'invalid proof target encoding',
        );
    });

    it('accepts only a live exact-loopback invite for the current browser origin', () => {
        const now = Date.now();
        const issuedAt = now - 1_000;
        const invite = {
            kind: 'happy-local-pairing',
            version: 1,
            authMode: 'paired-device',
            serverUrl: NATIVE_HAPPY_P0_SERVER_URL,
            browserOrigin: NATIVE_HAPPY_P0_BROWSER_ORIGIN,
            machineId: NATIVE_HAPPY_P0_MACHINE_ID,
            pairSecret: encodeBase64Url(new Uint8Array(32).fill(1)),
            pairingNonce: encodeBase64Url(new Uint8Array(24).fill(2)),
            issuedAt: new Date(issuedAt).toISOString(),
            expiresAt: new Date(issuedAt + 120_000).toISOString(),
        };
        const token = encodeBase64Url(new TextEncoder().encode(JSON.stringify(invite)));

        expect(decodeNativeHappyLocalInvite(token, NATIVE_HAPPY_P0_BROWSER_ORIGIN, now)).toEqual(invite);
        expect(() => decodeNativeHappyLocalInvite(token, 'http://127.0.0.1:8081', now)).toThrow(
            'frozen P0 contract',
        );
        expect(() => decodeNativeHappyLocalInvite(token, NATIVE_HAPPY_P0_BROWSER_ORIGIN, now + 120_000)).toThrow(
            'expired',
        );
        const shortSecret = encodeBase64Url(new Uint8Array(31).fill(1));
        expect(() => decodeNativeHappyLocalInvite(
            encodeBase64Url(new TextEncoder().encode(JSON.stringify({ ...invite, pairSecret: shortSecret }))),
            NATIVE_HAPPY_P0_BROWSER_ORIGIN,
            now,
        )).toThrow('frozen P0 contract');
        expect(() => decodeNativeHappyLocalInvite(
            encodeBase64Url(new TextEncoder().encode(JSON.stringify({
                ...invite,
                expiresAt: new Date(issuedAt + 120_001).toISOString(),
            }))),
            NATIVE_HAPPY_P0_BROWSER_ORIGIN,
            now,
        )).toThrow('expired');
    });

    it('accepts only the exact pairing identity response', () => {
        const identity = { keyId: 'browser-key-id', publicKey: 'browser-public-key' };
        const response = {
            machine: {
                machineId: NATIVE_HAPPY_P0_MACHINE_ID,
                tunnelUrl: NATIVE_HAPPY_P0_SERVER_URL,
            },
            authMode: 'paired-device',
            pairedDevice: identity,
            githubLogin: null,
        };

        expect(isExpectedNativeHappyPairResponse(response, identity)).toBe(true);
        expect(isExpectedNativeHappyPairResponse({
            ...response,
            pairedDevice: { ...identity, publicKey: 'wrong-public-key' },
        }, identity)).toBe(false);
        expect(isExpectedNativeHappyPairResponse({ ...response, unexpected: true }, identity)).toBe(false);
    });

    it('replaces one keyed transient revision and removes it for the durable final', () => {
        let state = createNativeHappySnapshotProbeState();
        state = applyNativeHappySnapshot(state, {
            sessionId: 'compat-session',
            itemId: 'compat-item',
            revision: 7,
            text: 'compat snapshot',
            emittedAt: 1,
        });

        const first = selectNativeHappySnapshotMessages(state);
        state = applyNativeHappySnapshot(state, {
            sessionId: 'compat-session',
            itemId: 'compat-item',
            revision: 8,
            text: 'compat snapshot resumed',
            emittedAt: 2,
        });
        state = applyNativeHappySnapshot(state, {
            sessionId: 'compat-session',
            itemId: 'compat-item',
            revision: 7,
            text: 'stale snapshot',
            emittedAt: 3,
        });
        const replaced = selectNativeHappySnapshotMessages(state);

        expect(first).toHaveLength(1);
        expect(replaced).toHaveLength(1);
        expect(replaced[0]?.id).toBe(getNativeHappyTransientMessageId('compat-session', 'compat-item'));
        expect((replaced[0] as Extract<Message, { kind: 'agent-text' }>).text).toBe('compat snapshot resumed');

        const durable: Extract<Message, { kind: 'agent-text' }> = {
            kind: 'agent-text',
            id: 'compat-durable-final',
            localId: 'codex-origin:assistant:compat-item',
            createdAt: 4,
            seq: 1,
            text: 'compat durable final replaces transient snapshot',
        };
        state = applyNativeHappyDurableFinal(state, 'compat-session', durable);
        expect(selectNativeHappySnapshotMessages(state)).toEqual([durable]);

        state = applyNativeHappySnapshot(state, {
            sessionId: 'compat-session',
            itemId: 'compat-item',
            revision: 9,
            text: 'late snapshot',
            emittedAt: 5,
        });
        expect(selectNativeHappySnapshotMessages(state)).toEqual([durable]);
    });

    it('requires exactly the ordered revision 7 then 8 full-text snapshot sequence', () => {
        const revision7 = {
            sessionId: 'compat-session',
            itemId: 'compat-item',
            revision: 7,
            text: 'compat snapshot',
            emittedAt: 1,
        };
        const revision8 = {
            ...revision7,
            revision: 8,
            text: 'compat snapshot resumed',
            emittedAt: 2,
        };

        expect(isExpectedNativeHappySnapshotSequence([revision7, revision8])).toBe(true);
        expect(isExpectedNativeHappySnapshotSequence([revision8, revision8])).toBe(false);
        expect(isExpectedNativeHappySnapshotSequence([revision8, revision7])).toBe(false);
        expect(isExpectedNativeHappySnapshotSequence([revision7, revision8, revision8])).toBe(false);
        expect(isExpectedNativeHappySnapshotSequence([{ ...revision7, revision: 6 }, revision7, revision8])).toBe(false);
        expect(isExpectedNativeHappySnapshotSequence([revision7, revision8, { ...revision8, revision: 9 }])).toBe(false);
    });

    it('rejects runtime secrets in the redacted result', () => {
        const result = {
            redaction: {
                invite: '[REDACTED]',
                proofHeaders: '[REDACTED]',
                nonces: '[REDACTED]',
                privateKey: '[REDACTED]',
            },
        } as NativeHappyP0CompatibilityResult;

        expect(() => assertNativeHappyP0ResultRedacted(result, ['runtime-secret-value'])).not.toThrow();
        expect(() => assertNativeHappyP0ResultRedacted(
            { ...result, stopCondition: 'runtime-secret-value' },
            ['runtime-secret-value'],
        )).toThrow('sensitive runtime material');
    });

    it('treats missing renderer source as required P0 failure but visual invisibility as a UI gate', () => {
        expect(classifyNativeHappyP0Failures([{
            id: 'renderer-source',
            label: 'Renderer receives full-text snapshots',
            status: 'FAIL',
            detail: 'Missing revisions.',
        }])).toEqual({
            requiredP0Failed: true,
            rendererVisualFailed: false,
        });
        expect(classifyNativeHappyP0Failures([{
            id: 'renderer-visual-surface',
            label: 'Existing MessageView visual surface requires a separate UI task',
            status: 'FAIL',
            detail: 'fontSize=0px',
        }])).toEqual({
            requiredP0Failed: false,
            rendererVisualFailed: true,
        });
    });

    it('emits a structured redacted NO-GO result when transport fails before renderer evidence', async () => {
        const controller = new NativeHappyP0ProbeController(() => {});
        await controller.runInitial('not-an-invite', NATIVE_HAPPY_P0_BROWSER_ORIGIN);

        const result = controller.getCompatibilityResult();
        expect(result?.overallP0Verdict).toBe('NO_GO');
        expect(result?.transportVerdict).toBe('NO_GO_SOCKET_PROTOCOL');
        expect(result?.rendererVerdict).toBe('NOT_RUN_TRANSPORT_FAILED');
        expect(result?.renderer).toMatchObject({ source: 'NOT_RUN', completed: false });
        expect(result?.versions.socketIoClient).toBe('NOT_CAPTURED');
        expect(() => result && assertNativeHappyP0ResultRedacted(result, ['not-an-invite'])).not.toThrow();
    });

    it('builds the renderer fixture as one durable final with no transient duplicate', () => {
        const state = buildNativeHappyRendererFixtureState('compat-session');
        const messages = selectNativeHappySnapshotMessages(state) as Extract<Message, { kind: 'agent-text' }>[];

        expect(messages).toHaveLength(1);
        expect(messages[0]?.id).toBe(NATIVE_HAPPY_P0_RENDERER_FIXTURE.finalMessageId);
        expect(messages[0]?.text).toBe(NATIVE_HAPPY_P0_RENDERER_FIXTURE.finalText);
        // The transient snapshot text must not survive the durable final replacement.
        expect(messages.some(message => message.text === 'compat snapshot resumed')).toBe(false);
    });

    it('seeds the renderer visual check and passes the gate only on a nonzero visible font size', () => {
        const controller = new NativeHappyP0ProbeController(() => {});

        const view = controller.seedRendererForVisualCheck();
        const rendererMessages = view.rendererMessages as Extract<Message, { kind: 'agent-text' }>[];
        expect(rendererMessages).toHaveLength(1);
        expect(rendererMessages[0]?.text).toBe(NATIVE_HAPPY_P0_RENDERER_FIXTURE.finalText);

        // The fixed web behavior: durable text visible at a nonzero computed font size.
        const passed = controller.recordRendererVisualEvidence({
            visible: true,
            computedFontSizePx: 16,
            durableTextCount: 1,
            transientTextCount: 0,
        });
        expect(passed?.status).toBe('PASS');

        // The pre-fix regression: a 0px computed font size must still fail the gate,
        // even though the state replacement semantics are identical.
        controller.seedRendererForVisualCheck();
        const failed = controller.recordRendererVisualEvidence({
            visible: false,
            computedFontSizePx: 0,
            durableTextCount: 1,
            transientTextCount: 0,
        });
        expect(failed?.status).toBe('FAIL');
    });
});
