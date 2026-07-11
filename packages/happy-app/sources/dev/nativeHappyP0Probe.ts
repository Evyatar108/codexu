import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import {
    decodeBase64,
    encodeBase64,
    hashRequestBody,
    SessionMessageRangeResponseSchema,
} from '@slopus/happy-wire';
import { io, type Socket } from 'socket.io-client';

import { generateDeviceKeypair, generateSecureNonce, type DeviceKeypair } from '@/auth/deviceKeypair';
import type { Message } from '@/sync/typesMessage';
import {
    applyNativeHappyDurableFinal,
    applyNativeHappySnapshot,
    buildNativeHappyRendererFixtureState,
    createNativeHappySnapshotProbeState,
    getNativeHappyTransientMessageId,
    selectNativeHappySnapshotMessages,
    type NativeHappySnapshotPayload,
    type NativeHappySnapshotProbeState,
} from './nativeHappySnapshotProbe';

ed.hashes.sha512 = (message: Uint8Array) => sha512(message);

export const NATIVE_HAPPY_P0_SERVER_URL = 'http://127.0.0.1:43127';
export const NATIVE_HAPPY_P0_BROWSER_ORIGIN = 'http://localhost:8081';
export const NATIVE_HAPPY_P0_SOCKET_PATH = '/v1/updates';
export const NATIVE_HAPPY_P0_MACHINE_ID = 'compat-machine';
export const NATIVE_HAPPY_P0_SESSION_ID = 'compat-session';
export const NATIVE_HAPPY_P0_THREAD_ID = 'compat-primary-thread';
export const NATIVE_HAPPY_P0_BROWSER_CLIENT = 'web/native-happy-p0';
export const NATIVE_HAPPY_P0_SOCKET_IO_CLIENT_VERSION = '4.8.1';
export const NATIVE_HAPPY_P0_RUST_FIXTURE_COMMIT = '3ff55692e7045e85ce78ebe8337ab40b55494c9c';
export const NATIVE_HAPPY_P0_EXPECTED_FONT_SIZE_PX = 16;
export const NATIVE_HAPPY_P0_PROOF_HEADER = 'X-Happy-Local-Device-Proof';
export const NATIVE_HAPPY_P0_CLIENT_HEADER = 'X-Happy-Client';
export const NATIVE_HAPPY_P0_PAIRING_SECRET_HEADER = 'X-Happy-Pairing-Secret';
export const NATIVE_HAPPY_P0_PAIRING_NONCE_HEADER = 'X-Happy-Pairing-Nonce';

const LOCAL_PROOF_DOMAIN = 'happy-local-device-proof/v1';
const FIXTURE_ENTER_STOPPING_EVENT = 'fixture-enter-stopping';
const FIXTURE_EXIT_STOPPING_EVENT = 'fixture-exit-stopping';
const SOCKET_ACK_TIMEOUT_MS = 5_000;
const RUST_CLIENT_WAIT_MS = 120_000;
const PAIRING_WINDOW_MS = 120_000;
const PAIRING_SECRET_BYTES = 32;
const PAIRING_NONCE_BYTES = 24;

export interface NativeHappyLocalInvite {
    kind: 'happy-local-pairing';
    version: 1;
    authMode: 'paired-device';
    serverUrl: string;
    browserOrigin: string;
    machineId: string;
    pairSecret: string;
    pairingNonce: string;
    issuedAt: string;
    expiresAt: string;
}

export interface NativeHappyLocalProofEnvelope {
    v: 1;
    keyId: string;
    publicKey: string;
    nonce: string;
    issuedAt: number;
    method: string;
    target: string;
    bodyHash: string;
    signature: string;
}

export type NativeHappyP0CheckStatus = 'PASS' | 'FAIL';

export interface NativeHappyP0Check {
    id: string;
    label: string;
    status: NativeHappyP0CheckStatus;
    detail: string;
}

export function classifyNativeHappyP0Failures(checks: readonly NativeHappyP0Check[]): {
    requiredP0Failed: boolean;
    rendererVisualFailed: boolean;
} {
    return {
        requiredP0Failed: checks.some(check => (
            check.status === 'FAIL' && check.id !== 'renderer-visual-surface'
        )),
        rendererVisualFailed: checks.some(check => (
            check.status === 'FAIL' && check.id === 'renderer-visual-surface'
        )),
    };
}

export function isExpectedNativeHappySnapshotSequence(
    snapshots: readonly NativeHappySnapshotPayload[],
): boolean {
    const relevant = snapshots.filter(snapshot => snapshot.itemId === 'compat-item');
    return relevant.length === 2
        && arraysEqual(relevant.map(snapshot => snapshot.revision), [7, 8])
        && arraysEqual(relevant.map(snapshot => snapshot.text), ['compat snapshot', 'compat snapshot resumed']);
}

export function isExpectedNativeHappyStoppingAcknowledgements(
    entered: unknown,
    rejectedRpc: unknown,
    exited: unknown | null,
    disconnectedAfterExit: boolean,
): boolean {
    return jsonValuesEqual(entered, { ok: true, result: { status: 'stopping' } })
        && jsonValuesEqual(rejectedRpc, { ok: false, error: 'server_stopping' })
        && (
            jsonValuesEqual(exited, { ok: true, result: { status: 'exiting' } })
            || (exited === null && disconnectedAfterExit)
        );
}

export type NativeHappyP0Phase =
    | 'idle'
    | 'running-initial'
    | 'waiting-rust-client'
    | 'awaiting-restart'
    | 'running-restart'
    | 'complete'
    | 'failed';

export interface NativeHappyRendererEvidence {
    source: 'J0 session-output-snapshot' | 'seed-visual-check' | 'NOT_RUN';
    completed: boolean;
    revisions: number[];
    countsByRevision: number[];
    stableTransientMessageId: boolean;
    finalDurableRemovedTransient: boolean;
    finalRenderedItemCount: number;
    browserTextVisible: boolean | null;
    browserComputedFontSizePx: number | null;
    browserDurableTextCount: number | null;
    browserTransientTextCount: number | null;
}

export type NativeHappyLocalNetworkAccessObservation =
    | 'NOT_OBSERVED'
    | 'OBSERVED_ALLOWED'
    | 'OBSERVED_BLOCKED';

export interface NativeHappyBrowserNetworkEvidence {
    preflightObserved: boolean;
    actualOrigin: string;
    actualRequestHeaderNames: string[];
    allowOrigin: string | null;
    allowPrivateNetwork: string | null;
    localNetworkAccess: NativeHappyLocalNetworkAccessObservation;
    engineIoVersion: number;
    wrongOriginStatus: number;
    fixedPortRebind: boolean;
}

export interface NativeHappyVersionEvidence {
    agentBrowser: string;
    chromium: string;
    node: string;
    pnpm: string;
    expo: string;
    socketIoClient: string;
    rustc: string;
    cargo: string;
    rustFixture: string;
}

export interface NativeHappyRustClientEvidence {
    exitCode: number;
    ok: boolean;
    transport: string;
    engineIo: number;
    capability: string;
    stateAckResult: string;
    oversizedStateAckResult: string;
    stateAfterRejectionAckResult: string;
    metadataAckResult: string;
    snapshotAckResult: string;
    oversizedSnapshotAckResult: string;
    snapshotAfterRejectionAckResult: string;
    staleSnapshotAckResult: string;
    replayedUpdates: number;
}

export interface NativeHappyRendererVisualMeasurement {
    visible: boolean;
    computedFontSizePx: number;
    durableTextCount: number;
    transientTextCount: number;
}

export interface NativeHappyP0ExternalEvidence {
    versions: NativeHappyVersionEvidence;
    rustDependencies: Record<string, string>;
    rustClient: NativeHappyRustClientEvidence;
    network: NativeHappyBrowserNetworkEvidence;
    renderer: NativeHappyRendererVisualMeasurement;
}

export interface NativeHappyP0CompatibilityResult {
    schemaVersion: 1;
    generatedAt: string;
    target: {
        serverUrl: string;
        browserOrigin: string;
        socketPath: string;
        machineId: string;
        sessionId: string;
    };
    versions: NativeHappyVersionEvidence;
    rustDependencies: Record<string, string>;
    compatibilityShims: Array<{
        name: string;
        version: string;
        reason: string;
    }>;
    p0Limitations: Array<{
        id: string;
        reason: string;
    }>;
    browserNetwork: NativeHappyBrowserNetworkEvidence;
    rustClient: NativeHappyRustClientEvidence;
    checks: NativeHappyP0Check[];
    renderer: NativeHappyRendererEvidence;
    redaction: {
        invite: '[REDACTED]';
        proofHeaders: '[REDACTED]';
        nonces: '[REDACTED]';
        privateKey: '[REDACTED]';
    };
    transportVerdict: 'GO' | 'NO_GO_SOCKET_PROTOCOL';
    rendererVerdict: 'EXISTING_RENDERER_OK' | 'REQUIRES_SEPARATE_UI_TASK' | 'NOT_RUN_TRANSPORT_FAILED';
    overallP0Verdict: 'GO' | 'NO_GO';
    stopCondition: string | null;
}

export interface NativeHappyP0ViewState {
    phase: NativeHappyP0Phase;
    statusText: string;
    checks: NativeHappyP0Check[];
    rendererMessages: Message[];
    result: NativeHappyP0CompatibilityResult | null;
}

interface BrowserSocketCapture {
    socket: Socket;
    updates: unknown[];
    overflows: unknown[];
    ephemerals: unknown[];
}

interface PairResponse {
    machine?: {
        machineId?: unknown;
        tunnelUrl?: unknown;
    };
    authMode?: unknown;
    pairedDevice?: {
        keyId?: unknown;
        publicKey?: unknown;
    };
    githubLogin?: unknown;
}

type ViewStateListener = (state: NativeHappyP0ViewState) => void;

export function encodeBase64Url(bytes: Uint8Array): string {
    return encodeBase64(bytes)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

export function decodeBase64Url(value: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error('invalid base64url input');
    }
    const standard = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=');
    return decodeBase64(padded);
}

function isCanonicalBase64UrlBytes(value: string, expectedBytes: number): boolean {
    try {
        const decoded = decodeBase64Url(value);
        return decoded.length === expectedBytes && encodeBase64Url(decoded) === value;
    } catch {
        return false;
    }
}

export function decodeNativeHappyLocalInvite(
    token: string,
    expectedOrigin: string,
    now = Date.now(),
): NativeHappyLocalInvite {
    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(token.trim())));
    } catch {
        throw new Error('invalid local pairing invite');
    }
    if (!isRecord(parsed)) {
        throw new Error('invalid local pairing invite');
    }

    const invite = parsed as unknown as NativeHappyLocalInvite;
    if (
        invite.kind !== 'happy-local-pairing'
        || invite.version !== 1
        || invite.authMode !== 'paired-device'
        || invite.serverUrl !== NATIVE_HAPPY_P0_SERVER_URL
        || invite.browserOrigin !== expectedOrigin
        || invite.machineId !== NATIVE_HAPPY_P0_MACHINE_ID
        || typeof invite.pairSecret !== 'string'
        || !isCanonicalBase64UrlBytes(invite.pairSecret, PAIRING_SECRET_BYTES)
        || typeof invite.pairingNonce !== 'string'
        || !isCanonicalBase64UrlBytes(invite.pairingNonce, PAIRING_NONCE_BYTES)
        || typeof invite.issuedAt !== 'string'
        || typeof invite.expiresAt !== 'string'
    ) {
        throw new Error('local pairing invite violates the frozen P0 contract');
    }

    const serverUrl = new URL(invite.serverUrl);
    if (
        serverUrl.protocol !== 'http:'
        || serverUrl.hostname !== '127.0.0.1'
        || serverUrl.port !== '43127'
        || serverUrl.pathname !== '/'
        || serverUrl.search
        || serverUrl.hash
        || serverUrl.username
        || serverUrl.password
    ) {
        throw new Error('local pairing invite has a non-loopback endpoint');
    }

    const issuedAt = Date.parse(invite.issuedAt);
    const expiresAt = Date.parse(invite.expiresAt);
    if (
        !Number.isFinite(issuedAt)
        || !Number.isFinite(expiresAt)
        || expiresAt - issuedAt !== PAIRING_WINDOW_MS
        || issuedAt > now + 30_000
        || expiresAt <= now
    ) {
        throw new Error('local pairing invite is expired or not yet valid');
    }

    return invite;
}

export function canonicalizeNativeHappyTarget(target: string): string {
    if (!target.startsWith('/') || target.includes('#')) {
        throw new Error('invalid proof target');
    }
    for (let index = 0; index < target.length; index += 1) {
        if (
            target[index] === '%'
            && !/^[0-9A-Fa-f]{2}$/.test(target.slice(index + 1, index + 3))
        ) {
            throw new Error('invalid proof target encoding');
        }
    }
    try {
        decodeURIComponent(target);
    } catch {
        throw new Error('invalid proof target encoding');
    }

    const parsed = new URL(target, 'http://localhost');
    const pairs = Array.from(parsed.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        const keyOrder = compareUtf8(leftKey, rightKey);
        return keyOrder !== 0 ? keyOrder : compareUtf8(leftValue, rightValue);
    });
    const search = new URLSearchParams();
    for (const [key, value] of pairs) {
        search.append(key, value);
    }
    const encoded = search.toString();
    return encoded ? `${parsed.pathname}?${encoded}` : parsed.pathname;
}

function compareUtf8(left: string, right: string): number {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);
    const length = Math.min(leftBytes.length, rightBytes.length);
    for (let index = 0; index < length; index += 1) {
        if (leftBytes[index] !== rightBytes[index]) {
            return leftBytes[index]! - rightBytes[index]!;
        }
    }
    return leftBytes.length - rightBytes.length;
}

export function decodeNativeHappyLocalProofHeader(header: string): NativeHappyLocalProofEnvelope {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(header))) as unknown;
    if (!isRecord(parsed)) {
        throw new Error('invalid local proof envelope');
    }
    return parsed as unknown as NativeHappyLocalProofEnvelope;
}

export function buildNativeHappyLocalProofHeader(
    identity: DeviceKeypair,
    method: string,
    target: string,
    body: string | Uint8Array | null,
    options: { nonce?: string; issuedAt?: number } = {},
): string {
    const envelope: NativeHappyLocalProofEnvelope = {
        v: 1,
        keyId: identity.keyId,
        publicKey: identity.publicKey,
        nonce: options.nonce ?? generateLocalNonce(),
        issuedAt: options.issuedAt ?? Date.now(),
        method: method.toUpperCase(),
        target: canonicalizeNativeHappyTarget(target),
        bodyHash: hashRequestBody(body),
        signature: '',
    };
    const canonical = [
        LOCAL_PROOF_DOMAIN,
        envelope.method,
        envelope.target,
        envelope.keyId,
        envelope.publicKey,
        envelope.nonce,
        String(envelope.issuedAt),
        envelope.bodyHash,
    ].join('\n');
    envelope.signature = encodeBase64(
        ed.sign(new TextEncoder().encode(canonical), decodeBase64(identity.secretKey)),
    );
    return encodeBase64Url(new TextEncoder().encode(JSON.stringify(envelope)));
}

export function assertNativeHappyP0ResultRedacted(
    result: NativeHappyP0CompatibilityResult,
    sensitiveValues: readonly string[],
): void {
    const rendered = JSON.stringify(result);
    for (const sensitive of sensitiveValues) {
        if (sensitive.length >= 8 && rendered.includes(sensitive)) {
            throw new Error('compatibility result contains sensitive runtime material');
        }
    }

    const forbiddenKeys = new Set([
        'inviteToken',
        'pairSecret',
        'pairingNonce',
        'proofHeader',
        'privateKey',
        'secretKey',
        'publicKey',
        'keyId',
    ]);
    visitObject(result, (key, value) => {
        if (forbiddenKeys.has(key) && value !== '[REDACTED]') {
            throw new Error(`compatibility result contains forbidden field ${key}`);
        }
    });
}

export class NativeHappyP0ProbeController {
    private phase: NativeHappyP0Phase = 'idle';
    private statusText = 'Paste the one-use J0 invite to begin.';
    private readonly checks: NativeHappyP0Check[] = [];
    private readonly sensitiveValues: string[] = [];
    private identity: DeviceKeypair | null = null;
    private firstInvite: NativeHappyLocalInvite | null = null;
    private restartPersistentProof: string | null = null;
    private restartPersistentProofBody: string | null = null;
    private rendererState: NativeHappySnapshotProbeState = createNativeHappySnapshotProbeState();
    private rendererEvidence: NativeHappyRendererEvidence | null = null;
    private externalEvidence: NativeHappyP0ExternalEvidence | null = null;
    private stopCondition: string | null = null;
    private activeSocket: Socket | null = null;
    private rustClientCompleted = false;

    constructor(private readonly listener: ViewStateListener) {}

    getViewState(): NativeHappyP0ViewState {
        return {
            phase: this.phase,
            statusText: this.statusText,
            checks: [...this.checks],
            rendererMessages: selectNativeHappySnapshotMessages(this.rendererState),
            result: this.buildCompatibilityResult(),
        };
    }

    getCompatibilityResult(): NativeHappyP0CompatibilityResult | null {
        return this.buildCompatibilityResult();
    }

    /**
     * Dev-only: seed the "Existing renderer proof" panel with the canonical P0
     * renderer fixture (revision 7 then 8, then the durable final that removes the
     * transient item) WITHOUT running the J0 transport. This lets agent-browser
     * reproduce and verify the renderer-visual-surface check in isolation. It reuses
     * the exact pure snapshot/dedup functions, so state semantics are unchanged.
     */
    seedRendererForVisualCheck(): NativeHappyP0ViewState {
        this.resetRuntime();
        this.rendererState = buildNativeHappyRendererFixtureState(NATIVE_HAPPY_P0_SESSION_ID);
        this.rendererEvidence = {
            source: 'seed-visual-check',
            completed: true,
            revisions: [7, 8],
            countsByRevision: [1, 1],
            stableTransientMessageId: true,
            finalDurableRemovedTransient: true,
            finalRenderedItemCount: selectNativeHappySnapshotMessages(this.rendererState).length,
            browserTextVisible: null,
            browserComputedFontSizePx: null,
            browserDurableTextCount: null,
            browserTransientTextCount: null,
        };
        this.pass('renderer-revision-replace', 'Increasing snapshot revision replaces one keyed item', 'Revisions 7 and 8 rendered under one stable MessageView key.');
        this.pass('renderer-durable-final', 'Durable final removes the transient item', 'MessageView state contained one durable final item with no transient duplicate.');
        this.statusText = 'Renderer seeded for visual check. Measure the durable text computed font size.';
        this.publish();
        return this.getViewState();
    }

    /**
     * Dev-only: attach a Chromium-measured renderer visual observation to the seeded
     * fixture and evaluate the renderer-visual-surface gate. Returns the resulting
     * check so agent-browser can assert on it without the full transport evidence.
     */
    recordRendererVisualEvidence(measurement: NativeHappyRendererVisualMeasurement): NativeHappyP0Check | null {
        if (!this.rendererEvidence) {
            throw new Error('seed the renderer before recording visual evidence');
        }
        this.applyRendererVisualGate(this.rendererEvidence, measurement);
        this.publish();
        return this.checks.find(check => check.id === 'renderer-visual-surface') ?? null;
    }

    confirmRustClientComplete(): void {
        if (this.phase !== 'waiting-rust-client') {
            throw new Error('rust-client completion can only be confirmed while the probe is waiting');
        }
        this.rustClientCompleted = true;
        this.statusText = 'J0 rust-client exited successfully. Draining final browser events before validation...';
        this.publish();
    }

    async runInitial(inviteToken: string, browserOrigin: string): Promise<void> {
        if (!['idle', 'failed'].includes(this.phase)) {
            return;
        }
        this.resetRuntime();
        this.phase = 'running-initial';
        this.statusText = 'Validating invite and generating a browser Ed25519 identity...';
        this.sensitiveValues.push(inviteToken);
        this.publish();

        try {
            const invite = decodeNativeHappyLocalInvite(inviteToken, browserOrigin);
            this.firstInvite = invite;
            this.sensitiveValues.push(invite.pairSecret, invite.pairingNonce);
            this.pass('invite-contract', 'Frozen local invite contract', 'Loopback endpoint, exact browser origin, machine identity, and validity window accepted.');

            const identity = await generateDeviceKeypair();
            this.identity = identity;
            this.sensitiveValues.push(identity.secretKey, identity.publicKey, identity.keyId);
            this.pass('browser-ed25519', 'Chromium Ed25519 identity', 'Generated in the real Expo web bundle with the app crypto stack.');

            const pairing = await this.pairWithInvite(invite, identity);
            this.assert(
                pairing.response.ok
                && isExpectedNativeHappyPairResponse(pairing.payload, identity),
                'pairing',
                'Signed one-use local pairing',
                `Expected the exact successful pairing response for the submitted browser key, received HTTP ${pairing.response.status}.`,
            );
            this.pass('pairing', 'Signed one-use local pairing', 'Pairing proof was signed by the submitted browser key and accepted once.');

            const consumedPairing = await this.pairWithInvite(invite, identity);
            this.assert(
                consumedPairing.response.status === 401,
                'pairing-one-use',
                'Pairing gate closes after success',
                `Expected HTTP 401 on invite reuse, received ${consumedPairing.response.status}.`,
            );
            this.pass('pairing-one-use', 'Pairing gate closes after success', 'The same invite failed closed after its first successful use.');

            await this.runHttpProofChecks(identity);

            const missingProofRejected = await this.expectBrowserSocketRejected(undefined, 0);
            this.assert(
                missingProofRejected,
                'socket-auth-required',
                'Socket proof is mandatory',
                'A browser polling connection without a device proof was accepted.',
            );
            this.pass('socket-auth-required', 'Socket proof is mandatory', 'Missing-proof logical connection failed closed.');

            const liveCapture = await this.connectBrowserSocket(
                buildNativeHappyLocalProofHeader(identity, 'GET', NATIVE_HAPPY_P0_SOCKET_PATH, null),
                0,
            );
            this.activeSocket = liveCapture.socket;
            this.assert(
                liveCapture.socket.io.engine.transport.name === 'polling',
                'browser-polling',
                'Browser uses Engine.IO polling',
                `Unexpected transport ${liveCapture.socket.io.engine.transport.name}.`,
            );
            this.pass('browser-polling', 'Browser uses Engine.IO polling', 'Socket.IO connected through polling with reconnection and upgrades disabled.');

            this.phase = 'waiting-rust-client';
            this.statusText = 'Browser paired and connected. Run the shipped J0 rust-client smoke now.';
            this.publish();

            await waitFor(
                () => getNumericUpdateSeqs(liveCapture.updates).length >= 3
                    && getSnapshotPayloads(liveCapture.ephemerals).some(snapshot => snapshot.revision === 8),
                RUST_CLIENT_WAIT_MS,
                'J0 rust-client updates and snapshots',
            );
            await waitFor(
                () => this.rustClientCompleted,
                RUST_CLIENT_WAIT_MS,
                'explicit J0 rust-client completion signal',
            );
            await sleep(250);

            const liveUpdates = liveCapture.updates.slice();
            const liveSeqs = getNumericUpdateSeqs(liveUpdates);
            this.assert(
                arraysEqual(liveSeqs, [1, 2, 3]),
                'room-routing',
                'Auth-derived room delivery',
                `Expected live durable seqs 1,2,3 from the internal room, received ${liveSeqs.join(',')}.`,
            );
            const updateBodies = liveUpdates.map(readUpdateBody).filter(isRecord);
            this.assert(
                updateBodies.some(body => readNestedNumber(body, 'agentState', 'version') === 2)
                && updateBodies.some(body => readNestedNumber(body, 'agentState', 'version') === 3)
                && updateBodies.some(body => readNestedNumber(body, 'metadata', 'version') === 2),
                'state-update-delivery',
                'Internal CAS updates reach browser room',
                'Expected state versions 2/3 and metadata version 2 were not delivered.',
            );
            this.pass('room-routing', 'Auth-derived room delivery', 'Browser received only the intended internal durable updates and ephemeral snapshots.');
            this.pass('state-update-delivery', 'Internal CAS updates reach browser room', 'State and metadata updates retained their authoritative versions.');

            await this.runBrowserAcknowledgementChecks(liveCapture);
            this.verifyRendererReplacement(getSnapshotPayloads(liveCapture.ephemerals));

            liveCapture.socket.disconnect();
            this.activeSocket = null;

            const replayCapture = await this.connectBrowserSocket(
                buildNativeHappyLocalProofHeader(identity, 'GET', NATIVE_HAPPY_P0_SOCKET_PATH, null),
                0,
            );
            this.activeSocket = replayCapture.socket;
            await waitFor(
                () => getNumericUpdateSeqs(replayCapture.updates).length >= 5
                    && getSnapshotPayloads(replayCapture.ephemerals).some(snapshot => snapshot.revision === 8),
                10_000,
                'durable replay and latest snapshot',
            );
            const replaySeqs = getNumericUpdateSeqs(replayCapture.updates);
            this.assert(
                arraysEqual(replaySeqs, [1, 2, 3, 4, 5])
                && new Set(replaySeqs).size === replaySeqs.length,
                'reconnect-replay',
                'Explicit reconnect replays without loss or duplicates',
                `Expected seqs 1..5 exactly once, received ${replaySeqs.join(',')}.`,
            );
            this.assert(
                replayCapture.updates.slice(0, 3).every((update, index) => JSON.stringify(update) === JSON.stringify(liveUpdates[index])),
                'reconnect-live-equivalence',
                'Live and replayed updates are byte-equivalent',
                'One or more live updates changed or disappeared across reconnect.',
            );
            this.pass('reconnect-replay', 'Explicit reconnect replays without loss or duplicates', 'Fresh proof replayed seqs 1 through 5 exactly once.');
            this.pass('reconnect-live-equivalence', 'Live and replayed updates are byte-equivalent', 'The three updates observed live matched their replay copies.');
            replayCapture.socket.disconnect();
            this.activeSocket = null;

            const cursorReplayCapture = await this.connectBrowserSocket(
                buildNativeHappyLocalProofHeader(identity, 'GET', NATIVE_HAPPY_P0_SOCKET_PATH, null),
                3,
            );
            this.activeSocket = cursorReplayCapture.socket;
            await waitFor(
                () => getNumericUpdateSeqs(cursorReplayCapture.updates).length >= 2,
                10_000,
                'cursor replay after sequence 3',
            );
            await sleep(250);
            const cursorReplaySeqs = getNumericUpdateSeqs(cursorReplayCapture.updates);
            this.assert(
                arraysEqual(cursorReplaySeqs, [4, 5])
                && cursorReplayCapture.overflows.length === 0,
                'cursor-replay',
                'Valid cursor replays only unseen durable updates',
                `Expected seqs 4,5 with no overflow after lastSeenSeq=3, received ${cursorReplaySeqs.join(',')}.`,
            );
            this.pass('cursor-replay', 'Valid cursor replays only unseen durable updates', 'lastSeenSeq=3 replayed exactly seqs 4 and 5.');
            cursorReplayCapture.socket.disconnect();
            this.activeSocket = null;

            const replayedSocketProof = buildNativeHappyLocalProofHeader(
                identity,
                'GET',
                NATIVE_HAPPY_P0_SOCKET_PATH,
                null,
                { nonce: generateLocalNonce() },
            );
            this.sensitiveValues.push(replayedSocketProof);
            const firstSocket = await this.connectBrowserSocket(replayedSocketProof, 5);
            await sleep(250);
            this.assert(
                firstSocket.updates.length === 0 && firstSocket.overflows.length === 0,
                'current-cursor-empty',
                'Current cursor emits no duplicate durable updates',
                'lastSeenSeq=5 produced an update or replay-overflow event.',
            );
            this.pass('current-cursor-empty', 'Current cursor emits no duplicate durable updates', 'lastSeenSeq=5 produced neither durable updates nor overflow.');
            firstSocket.socket.disconnect();
            const socketReplayRejected = await this.expectBrowserSocketRejected(replayedSocketProof, 5);
            this.assert(
                socketReplayRejected,
                'socket-nonce-replay',
                'Socket proof nonce is one-use',
                'A consumed logical-connection proof was accepted twice.',
            );
            this.pass('socket-nonce-replay', 'Socket proof nonce is one-use', 'Reusing the exact polling handshake proof failed closed.');

            this.phase = 'awaiting-restart';
            this.statusText = 'Initial browser phase passed. Restart J0 with the same journal and 1,025 seeded updates, then paste the fresh invite.';
            this.publish();
        } catch (error) {
            this.failRuntime(error);
        }
    }

    async finishAfterRestart(inviteToken: string, browserOrigin: string): Promise<void> {
        if (this.phase !== 'awaiting-restart' || !this.identity || !this.firstInvite || !this.restartPersistentProof || !this.restartPersistentProofBody) {
            return;
        }
        this.phase = 'running-restart';
        this.statusText = 'Validating nonce persistence, fresh pairing, and replay overflow after restart...';
        this.sensitiveValues.push(inviteToken);
        this.publish();

        try {
            const invite = decodeNativeHappyLocalInvite(inviteToken, browserOrigin);
            this.sensitiveValues.push(invite.pairSecret, invite.pairingNonce);
            this.assert(
                invite.pairSecret !== this.firstInvite.pairSecret
                && invite.pairingNonce !== this.firstInvite.pairingNonce,
                'restart-fresh-invite',
                'Restart issues a fresh invite',
                'The restarted fixture reused its prior pairing secret or nonce.',
            );
            this.pass('restart-fresh-invite', 'Restart issues a fresh invite', 'The fixed port rebound with a new memory-only pairing gate.');

            const replayAfterRestart = await postProof(
                '/proof-check?a=1&b=2',
                this.restartPersistentProofBody,
                this.restartPersistentProof,
            );
            this.assert(
                replayAfterRestart.status === 401,
                'nonce-replay-restart',
                'HTTP proof replay survives restart',
                `Expected HTTP 401 for the persisted nonce, received ${replayAfterRestart.status}.`,
            );
            this.pass('nonce-replay-restart', 'HTTP proof replay survives restart', 'The disposable SQLite auth journal rejected the pre-restart proof.');

            const staleInviteAttempt = await this.pairWithInvite(this.firstInvite, this.identity);
            this.assert(
                staleInviteAttempt.response.status === 401,
                'restart-old-invite',
                'Restart invalidates the old invite',
                `Expected HTTP 401 for the old gate, received ${staleInviteAttempt.response.status}.`,
            );
            this.pass('restart-old-invite', 'Restart invalidates the old invite', 'The prior memory-only pairing gate was not reusable.');

            const freshPair = await this.pairWithInvite(invite, this.identity);
            this.assert(
                freshPair.response.ok
                && isExpectedNativeHappyPairResponse(freshPair.payload, this.identity),
                'restart-reenroll',
                'Fresh invite re-enrolls the pinned browser key',
                `Expected the exact re-enrollment response for the pinned browser key, received HTTP ${freshPair.response.status}.`,
            );
            this.pass('restart-reenroll', 'Fresh invite re-enrolls the pinned browser key', 'Same key ID/public key was idempotently confirmed with the new gate.');

            const consumedFreshPair = await this.pairWithInvite(invite, this.identity);
            this.assert(
                consumedFreshPair.response.status === 401,
                'restart-pairing-one-use',
                'Restart pairing gate remains one-use',
                `Expected HTTP 401 on fresh invite reuse, received ${consumedFreshPair.response.status}.`,
            );
            this.pass('restart-pairing-one-use', 'Restart pairing gate remains one-use', 'The replacement invite closed atomically after enrollment.');

            const aheadOverflow = await this.connectBrowserSocket(
                buildNativeHappyLocalProofHeader(this.identity, 'GET', NATIVE_HAPPY_P0_SOCKET_PATH, null),
                2_000,
            );
            await waitFor(() => aheadOverflow.overflows.length > 0, 10_000, 'ahead-cursor replay overflow');
            await sleep(250);
            this.assert(
                readBoolean(aheadOverflow.overflows[0], 'replayOverflow') === true
                && readNumber(aheadOverflow.overflows[0], 'currentSeq') === 1_025
                && aheadOverflow.updates.length === 0,
                'ahead-cursor-overflow',
                'Ahead cursor fails into replay overflow',
                'Expected replay-overflow currentSeq=1025 for lastSeenSeq=2000.',
            );
            aheadOverflow.socket.disconnect();
            this.pass('ahead-cursor-overflow', 'Ahead cursor fails into replay overflow', 'Server reported currentSeq 1025 instead of silently omitting history.');

            const behindOverflow = await this.connectBrowserSocket(
                buildNativeHappyLocalProofHeader(this.identity, 'GET', NATIVE_HAPPY_P0_SOCKET_PATH, null),
                0,
            );
            await waitFor(() => behindOverflow.overflows.length > 0, 10_000, 'behind-cursor replay overflow');
            await sleep(250);
            this.assert(
                readBoolean(behindOverflow.overflows[0], 'replayOverflow') === true
                && readNumber(behindOverflow.overflows[0], 'currentSeq') === 1_025
                && behindOverflow.updates.length === 0,
                'behind-cursor-overflow',
                'Replay-cap overflow fails into REST recovery signal',
                'Expected replay-overflow currentSeq=1025 for lastSeenSeq=0.',
            );
            behindOverflow.socket.disconnect();
            this.pass('behind-cursor-overflow', 'Replay-cap overflow fails into REST recovery signal', 'The 1,024-entry ring reported an explicit gap.');

            const lifecycleCapture = await this.connectBrowserSocket(
                buildNativeHappyLocalProofHeader(this.identity, 'GET', NATIVE_HAPPY_P0_SOCKET_PATH, null),
                1_025,
            );
            this.activeSocket = lifecycleCapture.socket;
            await this.runRpcLifecycleAcknowledgementChecks(lifecycleCapture.socket);
            await this.runMalformedUtf8QueryCheck(this.identity);
            await this.runServerStoppingAcknowledgementChecks(lifecycleCapture.socket);
            lifecycleCapture.socket.disconnect();
            this.activeSocket = null;

            this.phase = 'complete';
            this.statusText = 'Protocol run passed. Capture and inject redacted browser/version evidence to finalize the P0 verdict.';
            this.publish();
        } catch (error) {
            this.failRuntime(error);
        }
    }

    setExternalEvidence(evidence: NativeHappyP0ExternalEvidence): void {
        if (this.phase !== 'complete' && this.phase !== 'failed') {
            throw new Error('protocol run must complete before external evidence is attached');
        }
        this.externalEvidence = evidence;
        try {
            this.assert(
                evidence.versions.socketIoClient === NATIVE_HAPPY_P0_SOCKET_IO_CLIENT_VERSION,
                'socket-client-version',
                'Exact browser Socket.IO client version',
                `Expected ${NATIVE_HAPPY_P0_SOCKET_IO_CLIENT_VERSION}, received ${evidence.versions.socketIoClient}.`,
            );
            this.pass('socket-client-version', 'Exact browser Socket.IO client version', `Installed and executed socket.io-client ${evidence.versions.socketIoClient}.`);

            this.assert(
                evidence.versions.rustFixture
                    === `codex-happy-compat-spike 0.1.0 @ codex ${NATIVE_HAPPY_P0_RUST_FIXTURE_COMMIT}`,
                'rust-fixture-version',
                'Exact hardened Rust fixture revision',
                `Expected fixture ${NATIVE_HAPPY_P0_RUST_FIXTURE_COMMIT}, received ${evidence.versions.rustFixture}.`,
            );
            this.pass(
                'rust-fixture-version',
                'Exact hardened Rust fixture revision',
                `Browser proof ran against Codex fixture ${NATIVE_HAPPY_P0_RUST_FIXTURE_COMMIT}.`,
            );

            const headerNames = evidence.network.actualRequestHeaderNames.map(name => name.toLowerCase());
            const requiredHeaders = [
                NATIVE_HAPPY_P0_PROOF_HEADER,
                NATIVE_HAPPY_P0_CLIENT_HEADER,
                NATIVE_HAPPY_P0_PAIRING_SECRET_HEADER,
                NATIVE_HAPPY_P0_PAIRING_NONCE_HEADER,
            ].map(name => name.toLowerCase());
            this.assert(
                evidence.network.preflightObserved
                && evidence.network.actualOrigin === NATIVE_HAPPY_P0_BROWSER_ORIGIN
                && requiredHeaders.every(header => headerNames.includes(header))
                && evidence.network.allowOrigin === NATIVE_HAPPY_P0_BROWSER_ORIGIN,
                'browser-cors-headers',
                'Actual Chromium Origin, custom headers, and exact CORS',
                'Captured request/preflight evidence did not match the exact-origin/header contract.',
            );
            this.pass('browser-cors-headers', 'Actual Chromium Origin, custom headers, and exact CORS', 'Chromium sent the proof/client/pairing headers from localhost:8081 and received exact ACAO.');

            this.assert(
                evidence.network.localNetworkAccess !== 'OBSERVED_BLOCKED'
                && (
                    evidence.network.localNetworkAccess === 'NOT_OBSERVED'
                    || evidence.network.allowPrivateNetwork?.toLowerCase() === 'true'
                ),
                'local-network-access',
                'Chromium Local Network Access behavior',
                'Chromium emitted an LNA preflight that the fixture did not allow.',
            );
            this.pass(
                'local-network-access',
                'Chromium Local Network Access behavior',
                evidence.network.localNetworkAccess === 'NOT_OBSERVED'
                    ? 'No Access-Control-Request-Private-Network header was emitted for localhost to 127.0.0.1.'
                    : 'Observed LNA preflight received Access-Control-Allow-Private-Network: true.',
            );

            this.assert(
                evidence.network.engineIoVersion === 4,
                'engine-io-version',
                'Engine.IO protocol version',
                `Expected EIO=4, received ${evidence.network.engineIoVersion}.`,
            );
            this.pass('engine-io-version', 'Engine.IO protocol version', 'Captured polling URLs used EIO=4.');

            this.assert(
                evidence.network.wrongOriginStatus === 403,
                'wrong-origin',
                'Wrong Origin fails closed',
                `Expected HTTP 403, received ${evidence.network.wrongOriginStatus}.`,
            );
            this.pass('wrong-origin', 'Wrong Origin fails closed', 'A non-browser-origin request was rejected with HTTP 403.');

            this.assert(
                evidence.network.fixedPortRebind,
                'fixed-port-rebind',
                'Fixed port rebind',
                'The restarted fixture did not become responsive again on 127.0.0.1:43127.',
            );
            this.pass('fixed-port-rebind', 'Fixed port rebind', 'The same fixed loopback port was released and rebound across restart.');

            const rust = evidence.rustClient;
            this.assert(
                rust.exitCode === 0
                && rust.ok
                && rust.transport === 'websocket'
                && rust.engineIo === 4
                && rust.capability === '[REDACTED]'
                && rust.stateAckResult === 'success'
                && rust.oversizedStateAckResult === 'error'
                && rust.stateAfterRejectionAckResult === 'success'
                && rust.metadataAckResult === 'success'
                && rust.snapshotAckResult === 'success'
                && rust.oversizedSnapshotAckResult === 'error'
                && rust.snapshotAfterRejectionAckResult === 'success'
                && rust.staleSnapshotAckResult === 'stale'
                && rust.replayedUpdates >= 2,
                'rust-client-smoke',
                'Pinned rust_socketio internal client',
                'The shipped J0 rust-client smoke did not satisfy its websocket/CAS/snapshot/replay contract.',
            );
            this.pass('rust-client-smoke', 'Pinned rust_socketio internal client', 'Websocket role, capability auth, state CAS, snapshot acks, role denial, and replay all passed.');

            const rendererEvidence = this.rendererEvidence;
            if (!rendererEvidence && this.phase === 'complete') {
                throw new Error('renderer state proof did not complete');
            }
            if (rendererEvidence) {
                this.applyRendererVisualGate(rendererEvidence, evidence.renderer);
            }

            const result = this.buildCompatibilityResult();
            if (result) {
                assertNativeHappyP0ResultRedacted(result, this.sensitiveValues);
            }
            if (result?.overallP0Verdict === 'NO_GO') {
                this.statusText = `P0 NO-GO: ${result.stopCondition ?? 'A required P0 check failed.'}`;
            } else if (rendererEvidence) {
                this.statusText = evidence.renderer.visible
                    ? 'P0 evidence is complete and redacted. Download the compatibility result and capture the screenshot.'
                    : 'Transport P0 GO; renderer state plumbing passed, but the existing web text surface needs a separate Opus 4.8 UI task.';
            }
        } catch (error) {
            this.failRuntime(error);
            return;
        }
        this.publish();
    }

    dispose(): void {
        this.activeSocket?.disconnect();
        this.activeSocket = null;
    }

    private async runHttpProofChecks(identity: DeviceKeypair): Promise<void> {
        const body = '{"value":1}';
        const missingProof = await fetch(`${NATIVE_HAPPY_P0_SERVER_URL}/proof-check?a=1`, {
            method: 'POST',
            headers: {
                [NATIVE_HAPPY_P0_CLIENT_HEADER]: NATIVE_HAPPY_P0_BROWSER_CLIENT,
            },
            body,
        });
        this.assert(
            missingProof.status === 401,
            'http-auth-required',
            'HTTP proof is mandatory',
            `Expected HTTP 401 without proof, received ${missingProof.status}.`,
        );
        this.pass('http-auth-required', 'HTTP proof is mandatory', 'Unauthenticated proof-check request failed closed.');

        const proof = buildNativeHappyLocalProofHeader(
            identity,
            'POST',
            '/proof-check?b=2&a=1',
            body,
            { nonce: generateLocalNonce() },
        );
        this.restartPersistentProof = proof;
        this.restartPersistentProofBody = body;
        this.sensitiveValues.push(proof);
        const success = await postProof('/proof-check?a=1&b=2', body, proof);
        this.assert(
            success.ok,
            'canonical-query',
            'Canonical query binding',
            `Expected canonical query proof success, received HTTP ${success.status}.`,
        );
        this.pass('canonical-query', 'Canonical query binding', 'Decoded query pairs were sorted and re-encoded consistently across browser and Rust.');

        const replay = await postProof('/proof-check?a=1&b=2', body, proof);
        this.assert(
            replay.status === 401,
            'http-nonce-replay',
            'HTTP nonce replay fails closed',
            `Expected HTTP 401 on proof reuse, received ${replay.status}.`,
        );
        this.pass('http-nonce-replay', 'HTTP nonce replay fails closed', 'The exact signed request envelope was accepted once only.');

        const queryProof = buildNativeHappyLocalProofHeader(identity, 'POST', '/proof-check?a=1&b=2', body);
        this.sensitiveValues.push(queryProof);
        const queryTamper = await postProof('/proof-check?a=1&b=3', body, queryProof);
        this.assert(
            queryTamper.status === 401,
            'query-tamper',
            'Query tamper fails closed',
            `Expected HTTP 401 after query mutation, received ${queryTamper.status}.`,
        );
        this.pass('query-tamper', 'Query tamper fails closed', 'Changing one query value invalidated the signed target.');

        const bodyProof = buildNativeHappyLocalProofHeader(identity, 'POST', '/proof-check?a=1&b=2', body);
        this.sensitiveValues.push(bodyProof);
        const bodyTamper = await postProof('/proof-check?a=1&b=2', '{"value":2}', bodyProof);
        this.assert(
            bodyTamper.status === 401,
            'body-tamper',
            'Body tamper fails closed',
            `Expected HTTP 401 after body mutation, received ${bodyTamper.status}.`,
        );
        this.pass('body-tamper', 'Body tamper fails closed', 'Changing the raw request body invalidated its SHA-256 binding.');
    }

    private async runBrowserAcknowledgementChecks(capture: BrowserSocketCapture): Promise<void> {
        const socket = capture.socket;
        const liveUpdateCount = capture.updates.length;

        const rpc = await emitAck(socket, 'rpc-call', {
            method: `${NATIVE_HAPPY_P0_SESSION_ID}:permission`,
            params: { id: 'approval-1', approved: true, decision: 'approved' },
        });
        const duplicateRpc = await emitAck(socket, 'rpc-call', {
            method: `${NATIVE_HAPPY_P0_SESSION_ID}:permission`,
            params: { id: 'approval-1', approved: true },
        });
        const staleRpc = await emitAck(socket, 'rpc-call', {
            method: `${NATIVE_HAPPY_P0_SESSION_ID}:permission`,
            params: { id: 'unknown-approval', approved: false },
        });
        const invalidRpc = await emitAck(socket, 'rpc-call', {
            method: `${NATIVE_HAPPY_P0_SESSION_ID}:permission`,
            params: { id: 'approval-1', approved: true, decision: 'maybe' },
        });
        const unsupportedRpc = await emitAck(socket, 'rpc-call', {
            method: `${NATIVE_HAPPY_P0_SESSION_ID}:unsupported`,
            params: {},
        });
        this.assert(
            jsonValuesEqual(rpc, { ok: true, result: { status: 'applied' } })
            && jsonValuesEqual(duplicateRpc, { ok: true, result: { status: 'already_resolved' } })
            && jsonValuesEqual(staleRpc, { ok: true, result: { status: 'stale' } })
            && jsonValuesEqual(invalidRpc, { ok: false, error: 'invalid_params' })
            && jsonValuesEqual(unsupportedRpc, { ok: false, error: 'method_not_supported' }),
            'rpc-acks',
            'RPC acknowledgement contract',
            'Permission RPC or unsupported-method acknowledgement diverged from the exact frozen wrapper contract.',
        );
        this.pass('rpc-acks', 'RPC acknowledgement contract', 'Exact applied, already_resolved, stale, invalid_params, and method_not_supported wrappers matched.');

        const range = await emitAck(socket, 'session-message-range', {
            requestId: 'range-1',
            sessionId: NATIVE_HAPPY_P0_SESSION_ID,
            fromSeq: 1,
            toSeq: 2,
            limit: 1,
        });
        const fullRange = await emitAck(socket, 'session-message-range', {
            requestId: 'range-full',
            sessionId: NATIVE_HAPPY_P0_SESSION_ID,
            fromSeq: 1,
            toSeq: 2,
            limit: 2,
        });
        const older = await emitAck(socket, 'session-message-range', {
            requestId: 'range-older',
            sessionId: NATIVE_HAPPY_P0_SESSION_ID,
            fromSeq: 2,
            toSeq: 2,
            limit: 1,
        });
        const invalidRange = await emitAck(socket, 'session-message-range', {
            requestId: 'range-too-large',
            sessionId: NATIVE_HAPPY_P0_SESSION_ID,
            fromSeq: 1,
            toSeq: 2,
            limit: 201,
        });
        const parsedRange = SessionMessageRangeResponseSchema.safeParse(range);
        const parsedFullRange = SessionMessageRangeResponseSchema.safeParse(fullRange);
        const parsedOlder = SessionMessageRangeResponseSchema.safeParse(older);
        const parsedInvalid = SessionMessageRangeResponseSchema.safeParse(invalidRange);
        const rangeData = parsedRange.success && parsedRange.data.ok ? parsedRange.data : null;
        const fullRangeData = parsedFullRange.success && parsedFullRange.data.ok ? parsedFullRange.data : null;
        const olderData = parsedOlder.success && parsedOlder.data.ok ? parsedOlder.data : null;
        const invalidData = parsedInvalid.success && !parsedInvalid.data.ok ? parsedInvalid.data : null;
        this.assert(
            rangeData?.requestId === 'range-1'
            && rangeData.sessionId === NATIVE_HAPPY_P0_SESSION_ID
            && rangeData.fromSeq === 1
            && rangeData.toSeq === 2
            && rangeData.messages.length === 1
            && rangeData.messages[0]?.seq === 1
            && readNestedString(rangeData.messages[0], 'content', 't') === 'encrypted'
            && rangeData.hasMore === false
            && fullRangeData?.requestId === 'range-full'
            && fullRangeData.sessionId === NATIVE_HAPPY_P0_SESSION_ID
            && fullRangeData.fromSeq === 1
            && fullRangeData.toSeq === 2
            && arraysEqual(fullRangeData.messages.map(message => message.seq), [1, 2])
            && fullRangeData.hasMore === false
            && olderData?.requestId === 'range-older'
            && olderData.sessionId === NATIVE_HAPPY_P0_SESSION_ID
            && olderData.fromSeq === 2
            && olderData.toSeq === 2
            && arraysEqual(olderData.messages.map(message => message.seq), [2])
            && olderData.hasMore === true
            && invalidData?.requestId === 'range-too-large'
            && invalidData.error.code === 'invalid_range'
            && invalidData.error.message.length > 0,
            'range-acks',
            'Session message range acknowledgement contract',
            'Range success, ascending payload, hasMore, or invalid_range behavior diverged.',
        );
        this.pass('range-acks', 'Session message range acknowledgement contract', 'Success/error union, request ID, payload wrapper, and hasMore matched.');

        const stateDenied = await emitAck(socket, 'update-state', {
            sid: NATIVE_HAPPY_P0_SESSION_ID,
            agentState: '{}',
            expectedVersion: 3,
        });
        const aliveDenied = await emitAck(socket, 'session-alive', {
            sid: NATIVE_HAPPY_P0_SESSION_ID,
            active: true,
        });
        const snapshotDenied = await emitAck(socket, 'session-output-snapshot', {
            sessionId: NATIVE_HAPPY_P0_SESSION_ID,
            threadId: NATIVE_HAPPY_P0_THREAD_ID,
            turnId: 'browser-turn',
            itemId: 'browser-item',
            revision: 1,
            text: 'not allowed',
            emittedAt: Date.now(),
        });
        this.assert(
            readString(stateDenied, 'result') === 'error'
            && readString(aliveDenied, 'result') === 'error'
            && readString(snapshotDenied, 'result') === 'error',
            'browser-role-isolation',
            'Browser role cannot emit internal events',
            'Browser role gained access to update-state, session-alive, or session-output-snapshot.',
        );
        this.pass('browser-role-isolation', 'Browser role cannot emit internal events', 'All internal-only events returned error acknowledgements without mutation.');

        const metadata = await emitAck(socket, 'update-metadata', {
            sid: NATIVE_HAPPY_P0_SESSION_ID,
            metadata: '{"source":"browser"}',
            expectedVersion: 2,
        });
        const mismatch = await emitAck(socket, 'update-metadata', {
            sid: NATIVE_HAPPY_P0_SESSION_ID,
            metadata: '{}',
            expectedVersion: 2,
        });
        this.assert(
            readString(metadata, 'result') === 'success'
            && readNumber(metadata, 'version') === 3
            && readString(mismatch, 'result') === 'version-mismatch'
            && readNumber(mismatch, 'version') === 3
            && readString(mismatch, 'metadata') === '{"source":"browser"}',
            'metadata-cas',
            'Metadata CAS acknowledgement contract',
            'Success or authoritative version-mismatch acknowledgement diverged.',
        );
        this.pass('metadata-cas', 'Metadata CAS acknowledgement contract', 'Version advanced to 3 and stale expectedVersion returned authoritative metadata.');

        await sleep(250);
        this.assert(
            capture.updates.length === liveUpdateCount,
            'sender-echo',
            'Browser sender echo is suppressed',
            'Browser received its own durable mutation live instead of only through later replay.',
        );
        this.pass('sender-echo', 'Browser sender echo is suppressed', 'Browser-origin mutations were not echoed to the sending socket.');
    }

    private async runRpcLifecycleAcknowledgementChecks(socket: Socket): Promise<void> {
        const interruptedRpc = await emitAck(socket, 'rpc-call', {
            method: `${NATIVE_HAPPY_P0_SESSION_ID}:killSession`,
            params: {},
        });
        const idleRpc = await emitAck(socket, 'rpc-call', {
            method: `${NATIVE_HAPPY_P0_SESSION_ID}:abort`,
            params: {},
        });
        this.assert(
            jsonValuesEqual(interruptedRpc, { ok: true, result: { status: 'interrupted' } })
            && jsonValuesEqual(idleRpc, { ok: true, result: { status: 'idle' } }),
            'rpc-lifecycle-acks',
            'RPC lifecycle acknowledgement contract',
            'killSession/abort did not return the exact interrupted then idle wrappers.',
        );
        this.pass(
            'rpc-lifecycle-acks',
            'RPC lifecycle acknowledgement contract',
            'killSession returned exact interrupted and the subsequent abort returned exact idle.',
        );
    }

    private async runMalformedUtf8QueryCheck(identity: DeviceKeypair): Promise<void> {
        const body = '{"value":1}';
        const proof = buildNativeHappyLocalProofHeader(
            identity,
            'POST',
            '/proof-check?bad=%EF%BF%BD',
            body,
        );
        this.sensitiveValues.push(proof);
        const response = await postProof('/proof-check?bad=%FF', body, proof);
        this.assert(
            response.status === 401,
            'malformed-query-encoding',
            'Malformed UTF-8 query encoding fails closed',
            `Expected HTTP 401 for invalid UTF-8 percent bytes, received ${response.status}; the frozen J0 canonicalizer collided with the replacement-character target.`,
        );
        this.pass(
            'malformed-query-encoding',
            'Malformed UTF-8 query encoding fails closed',
            'Invalid UTF-8 percent bytes were rejected rather than canonicalized lossily.',
        );
    }

    private async runServerStoppingAcknowledgementChecks(socket: Socket): Promise<void> {
        const entered = await emitAck(socket, FIXTURE_ENTER_STOPPING_EVENT, {});
        const rejectedRpc = await emitAck(socket, 'rpc-call', {
            method: `${NATIVE_HAPPY_P0_SESSION_ID}:abort`,
            params: {},
        });
        const exited = await emitAck(socket, FIXTURE_EXIT_STOPPING_EVENT, {}).catch(() => null);
        await waitFor(() => !socket.connected, SOCKET_ACK_TIMEOUT_MS, 'fixture socket shutdown');
        await waitForNativeHappyServerShutdown(SOCKET_ACK_TIMEOUT_MS);
        this.assert(
            isExpectedNativeHappyStoppingAcknowledgements(entered, rejectedRpc, exited, !socket.connected),
            'rpc-server-stopping',
            'Server-stopping RPC acknowledgement contract',
            'Expected fixture stopping entry, exact {ok:false,error:"server_stopping"} abort, and a clean fixture-exit shutdown.',
        );
        this.pass(
            'rpc-server-stopping',
            'Server-stopping RPC acknowledgement contract',
            exited
                ? 'fixture-enter-stopping returned stopping, abort failed with exact server_stopping, and fixture-exit-stopping returned exiting.'
                : 'fixture-enter-stopping returned stopping, abort failed with exact server_stopping, and fixture-exit-stopping closed the Socket.IO connection before its JavaScript acknowledgement while the browser independently confirmed server shutdown.',
        );
    }

    private verifyRendererReplacement(ephemerals: NativeHappySnapshotPayload[]): void {
        const snapshots = ephemerals
            .filter(snapshot => snapshot.itemId === 'compat-item');
        const relevant = snapshots;
        this.assert(
            isExpectedNativeHappySnapshotSequence(ephemerals),
            'renderer-source',
            'Renderer receives full-text snapshots',
            'Expected exactly the ordered full-text snapshot sequence revision 7 then revision 8 with no duplicate or stale emission.',
        );

        let state = createNativeHappySnapshotProbeState();
        const counts: number[] = [];
        const messageIds: string[] = [];
        for (const snapshot of relevant) {
            state = applyNativeHappySnapshot(state, snapshot);
            const messages = selectNativeHappySnapshotMessages(state);
            counts.push(messages.length);
            messageIds.push(messages[0]?.id ?? '');
        }
        const stableId = getNativeHappyTransientMessageId(NATIVE_HAPPY_P0_SESSION_ID, 'compat-item');
        this.assert(
            arraysEqual(counts, [1, 1])
            && messageIds.every(id => id === stableId)
            && selectNativeHappySnapshotMessages(state)[0]?.kind === 'agent-text'
            && (selectNativeHappySnapshotMessages(state)[0] as Extract<Message, { kind: 'agent-text' }>).text === 'compat snapshot resumed',
            'renderer-revision-replace',
            'Increasing snapshot revision replaces one keyed item',
            'Revision 8 appended a duplicate or changed the transient renderer key.',
        );

        const finalMessage: Extract<Message, { kind: 'agent-text' }> = {
            kind: 'agent-text',
            id: 'compat-durable-final',
            localId: 'codex-origin:assistant:compat-item',
            createdAt: Date.now(),
            seq: 1,
            text: 'compat durable final replaces transient snapshot',
        };
        state = applyNativeHappyDurableFinal(state, NATIVE_HAPPY_P0_SESSION_ID, finalMessage);
        const finalMessages = selectNativeHappySnapshotMessages(state);
        this.assert(
            finalMessages.length === 1
            && finalMessages[0]?.id === finalMessage.id
            && finalMessages.every(message => message.id !== stableId),
            'renderer-durable-final',
            'Durable final removes the transient item',
            'The durable assistant message left a duplicate transient snapshot behind.',
        );

        this.rendererState = state;
        this.rendererEvidence = {
            source: 'J0 session-output-snapshot',
            completed: true,
            revisions: relevant.map(snapshot => snapshot.revision),
            countsByRevision: counts,
            stableTransientMessageId: true,
            finalDurableRemovedTransient: true,
            finalRenderedItemCount: finalMessages.length,
            browserTextVisible: null,
            browserComputedFontSizePx: null,
            browserDurableTextCount: null,
            browserTransientTextCount: null,
        };
        this.pass('renderer-revision-replace', 'Increasing snapshot revision replaces one keyed item', 'Revisions 7 and 8 rendered under one stable MessageView key.');
        this.pass('renderer-durable-final', 'Durable final removes the transient item', 'MessageView state contained one durable final item with no transient duplicate.');
    }

    private async pairWithInvite(
        invite: NativeHappyLocalInvite,
        identity: DeviceKeypair,
    ): Promise<{ response: Response; payload: PairResponse }> {
        const body = JSON.stringify({
            version: 1,
            machineId: invite.machineId,
            deviceKeyId: identity.keyId,
            deviceEd25519PublicKey: identity.publicKey,
        });
        const proof = buildNativeHappyLocalProofHeader(identity, 'POST', '/pair/complete', body);
        this.sensitiveValues.push(proof);
        const response = await fetch(`${invite.serverUrl}/pair/complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [NATIVE_HAPPY_P0_CLIENT_HEADER]: NATIVE_HAPPY_P0_BROWSER_CLIENT,
                [NATIVE_HAPPY_P0_PAIRING_SECRET_HEADER]: invite.pairSecret,
                [NATIVE_HAPPY_P0_PAIRING_NONCE_HEADER]: invite.pairingNonce,
                [NATIVE_HAPPY_P0_PROOF_HEADER]: proof,
            },
            body,
        });
        let payload: PairResponse = {};
        try {
            payload = await response.clone().json() as PairResponse;
        } catch {
            // Failure responses are intentionally allowed to carry no usable body.
        }
        return { response, payload };
    }

    private async connectBrowserSocket(proof: string, lastSeenSeq: number): Promise<BrowserSocketCapture> {
        this.sensitiveValues.push(proof);
        const capture = this.createBrowserSocket(proof, lastSeenSeq);
        await connectSocket(capture.socket);
        return capture;
    }

    private async expectBrowserSocketRejected(proof: string | undefined, lastSeenSeq: number): Promise<boolean> {
        const capture = this.createBrowserSocket(proof, lastSeenSeq);
        try {
            await connectSocket(capture.socket);
            capture.socket.disconnect();
            return false;
        } catch {
            capture.socket.disconnect();
            return true;
        }
    }

    private createBrowserSocket(proof: string | undefined, lastSeenSeq: number): BrowserSocketCapture {
        const headers: Record<string, string> = {
            [NATIVE_HAPPY_P0_CLIENT_HEADER]: NATIVE_HAPPY_P0_BROWSER_CLIENT,
        };
        if (proof) {
            headers[NATIVE_HAPPY_P0_PROOF_HEADER] = proof;
        }
        const updates: unknown[] = [];
        const overflows: unknown[] = [];
        const ephemerals: unknown[] = [];
        const socket = io(NATIVE_HAPPY_P0_SERVER_URL, {
            autoConnect: false,
            path: NATIVE_HAPPY_P0_SOCKET_PATH,
            transports: ['polling'],
            upgrade: false,
            reconnection: false,
            forceNew: true,
            multiplex: false,
            auth: {
                clientType: 'user-scoped',
                happyClient: NATIVE_HAPPY_P0_BROWSER_CLIENT,
                machineId: NATIVE_HAPPY_P0_MACHINE_ID,
                lastSeenSeq,
            },
            extraHeaders: headers,
            transportOptions: {
                polling: {
                    extraHeaders: headers,
                },
            },
        });
        socket.on('update', update => {
            updates.push(update);
            this.publish();
        });
        socket.on('replay-overflow', overflow => {
            overflows.push(overflow);
            this.publish();
        });
        socket.on('ephemeral', ephemeral => {
            ephemerals.push(ephemeral);
            const snapshot = parseSnapshotPayload(ephemeral);
            if (snapshot) {
                this.rendererState = applyNativeHappySnapshot(this.rendererState, snapshot);
            }
            this.publish();
        });
        return { socket, updates, overflows, ephemerals };
    }

    private applyRendererVisualGate(
        rendererEvidence: NativeHappyRendererEvidence,
        measurement: NativeHappyRendererVisualMeasurement,
    ): void {
        rendererEvidence.browserTextVisible = measurement.visible;
        rendererEvidence.browserComputedFontSizePx = measurement.computedFontSizePx;
        rendererEvidence.browserDurableTextCount = measurement.durableTextCount;
        rendererEvidence.browserTransientTextCount = measurement.transientTextCount;
        if (
            measurement.visible
            && measurement.computedFontSizePx === NATIVE_HAPPY_P0_EXPECTED_FONT_SIZE_PX
            && measurement.durableTextCount === 1
            && measurement.transientTextCount === 0
        ) {
            this.pass(
                'renderer-visual-surface',
                'Existing MessageView visibly renders the durable replacement',
                `Chromium displayed one durable assistant item at ${NATIVE_HAPPY_P0_EXPECTED_FONT_SIZE_PX}px and no transient duplicate.`,
            );
        } else {
            this.recordFailure(
                'renderer-visual-surface',
                'Existing MessageView visual surface requires a separate UI task',
                `State replacement passed, but Chromium measured durable=${measurement.durableTextCount}, transient=${measurement.transientTextCount}, fontSize=${measurement.computedFontSizePx}px.`,
            );
        }
    }

    private pass(id: string, label: string, detail: string): void {
        const existing = this.checks.find(check => check.id === id);
        if (existing) {
            existing.label = label;
            existing.status = 'PASS';
            existing.detail = detail;
        } else {
            this.checks.push({ id, label, status: 'PASS', detail });
        }
        this.publish();
    }

    private recordFailure(id: string, label: string, detail: string): void {
        const existing = this.checks.find(check => check.id === id);
        if (existing) {
            existing.label = label;
            existing.status = 'FAIL';
            existing.detail = detail;
        } else {
            this.checks.push({ id, label, status: 'FAIL', detail });
        }
        this.publish();
    }

    private assert(
        condition: boolean,
        id: string,
        label: string,
        failureDetail: string,
    ): asserts condition {
        if (condition) {
            return;
        }
        const existing = this.checks.find(check => check.id === id);
        if (existing) {
            existing.status = 'FAIL';
            existing.detail = failureDetail;
        } else {
            this.checks.push({ id, label, status: 'FAIL', detail: failureDetail });
        }
        throw new Error(`${label}: ${failureDetail}`);
    }

    private failRuntime(error: unknown): void {
        this.activeSocket?.disconnect();
        this.activeSocket = null;
        const message = error instanceof Error ? error.message : 'Unknown P0 failure';
        if (!this.checks.some(check => check.status === 'FAIL')) {
            this.checks.push({
                id: 'runtime',
                label: 'P0 runtime',
                status: 'FAIL',
                detail: message,
            });
        }
        this.phase = 'failed';
        this.stopCondition = message;
        this.statusText = `P0 NO-GO: ${message}`;
        this.publish();
    }

    private buildCompatibilityResult(): NativeHappyP0CompatibilityResult | null {
        if (!['complete', 'failed'].includes(this.phase)) {
            return null;
        }
        const externalEvidence = this.externalEvidence
            ?? (this.phase === 'failed' ? createUnavailableExternalEvidence() : null);
        if (!externalEvidence) {
            return null;
        }
        const rendererEvidence = this.rendererEvidence ?? createNotRunRendererEvidence();
        const { requiredP0Failed, rendererVisualFailed } = classifyNativeHappyP0Failures(this.checks);
        const rendererVerdict = requiredP0Failed && !rendererEvidence.completed
            ? 'NOT_RUN_TRANSPORT_FAILED'
            : rendererVisualFailed
                ? 'REQUIRES_SEPARATE_UI_TASK'
                : 'EXISTING_RENDERER_OK';
        const result: NativeHappyP0CompatibilityResult = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            target: {
                serverUrl: NATIVE_HAPPY_P0_SERVER_URL,
                browserOrigin: NATIVE_HAPPY_P0_BROWSER_ORIGIN,
                socketPath: NATIVE_HAPPY_P0_SOCKET_PATH,
                machineId: NATIVE_HAPPY_P0_MACHINE_ID,
                sessionId: NATIVE_HAPPY_P0_SESSION_ID,
            },
            versions: externalEvidence.versions,
            rustDependencies: externalEvidence.rustDependencies,
            compatibilityShims: [
                {
                    name: 'socketioxide-parser-common',
                    version: '0.17.0',
                    reason: 'Pinned compatibility adapter for socketioxide 0.18.2; no packet framing or browser-client patch.',
                },
                {
                    name: 'rust_socketio acknowledgement-array normalization',
                    version: `singleton-array unwrap @ J0 ${NATIVE_HAPPY_P0_RUST_FIXTURE_COMMIT}`,
                    reason: 'rust_socketio 0.6.0 exposes acknowledgement arguments as one JSON array; the fixture unwraps exactly one argument before contract validation.',
                },
                {
                    name: 'rust_socketio logical-auth probe settling',
                    version: `50ms + allowed session-alive ack @ J0 ${NATIVE_HAPPY_P0_RUST_FIXTURE_COMMIT}`,
                    reason: 'Engine.IO may report transport success before namespace middleware rejection is observable, so the fixture waits 50ms and requires an allowed acknowledgement.',
                },
                {
                    name: 'Socketioxide polling-upgrade guard',
                    version: `sid-bearing websocket deny @ J0 ${NATIVE_HAPPY_P0_RUST_FIXTURE_COMMIT}`,
                    reason: 'Socketioxide advertises upgrades before the authenticated role is known; fixture middleware rejects websocket upgrades carrying a polling sid.',
                },
                {
                    name: 'fixture-only capability handoff',
                    version: `Windows named pipe \\\\.\\pipe\\codex-happy-compat-43127 @ J0 ${NATIVE_HAPPY_P0_RUST_FIXTURE_COMMIT}`,
                    reason: 'The random internal capability crosses processes without entering argv, environment variables, structured output, or the disposable journal.',
                },
                {
                    name: 'fixture-only stopping transition control',
                    version: `fixture-enter-stopping/fixture-exit-stopping @ J0 ${NATIVE_HAPPY_P0_RUST_FIXTURE_COMMIT}`,
                    reason: 'The compatibility fixture exposes a deterministic stopping boundary so Chromium can assert the exact server_stopping RPC wrapper without adding a production protocol event.',
                },
                {
                    name: 'packages/happy-app/sources/polyfills/screenOrientation.ts',
                    version: 'tracked canonical polyfill restored from 8e4118b0fbd5bb36261a2ced0bd6329b407e0eb1',
                    reason: 'The entry-first web polyfill preserves native screen.orientation and supplies the historical WebKit fallback; Chromium used its native implementation.',
                },
            ],
            p0Limitations: [],
            browserNetwork: externalEvidence.network,
            rustClient: externalEvidence.rustClient,
            checks: this.checks.map(check => ({ ...check })),
            renderer: rendererEvidence,
            redaction: {
                invite: '[REDACTED]',
                proofHeaders: '[REDACTED]',
                nonces: '[REDACTED]',
                privateKey: '[REDACTED]',
            },
            transportVerdict: requiredP0Failed ? 'NO_GO_SOCKET_PROTOCOL' : 'GO',
            rendererVerdict,
            overallP0Verdict: requiredP0Failed ? 'NO_GO' : 'GO',
            stopCondition: requiredP0Failed
                ? this.stopCondition ?? 'A required P0 check failed.'
                : rendererVisualFailed
                    ? 'Existing MessageView text was present in the DOM but not visibly rendered; a separate Opus 4.8 UI task is required.'
                    : null,
        };
        assertNativeHappyP0ResultRedacted(result, this.sensitiveValues);
        return result;
    }

    private resetRuntime(): void {
        this.activeSocket?.disconnect();
        this.activeSocket = null;
        this.checks.splice(0, this.checks.length);
        this.sensitiveValues.splice(0, this.sensitiveValues.length);
        this.identity = null;
        this.firstInvite = null;
        this.restartPersistentProof = null;
        this.restartPersistentProofBody = null;
        this.rendererState = createNativeHappySnapshotProbeState();
        this.rendererEvidence = null;
        this.externalEvidence = null;
        this.stopCondition = null;
        this.rustClientCompleted = false;
    }

    private publish(): void {
        this.listener(this.getViewState());
    }
}

function createNotRunRendererEvidence(): NativeHappyRendererEvidence {
    return {
        source: 'NOT_RUN',
        completed: false,
        revisions: [],
        countsByRevision: [],
        stableTransientMessageId: false,
        finalDurableRemovedTransient: false,
        finalRenderedItemCount: 0,
        browserTextVisible: null,
        browserComputedFontSizePx: null,
        browserDurableTextCount: null,
        browserTransientTextCount: null,
    };
}

function createUnavailableExternalEvidence(): NativeHappyP0ExternalEvidence {
    return {
        versions: {
            agentBrowser: 'NOT_CAPTURED',
            chromium: 'NOT_CAPTURED',
            node: 'NOT_CAPTURED',
            pnpm: 'NOT_CAPTURED',
            expo: 'NOT_CAPTURED',
            socketIoClient: 'NOT_CAPTURED',
            rustc: 'NOT_CAPTURED',
            cargo: 'NOT_CAPTURED',
            rustFixture: 'NOT_CAPTURED',
        },
        rustDependencies: {},
        rustClient: {
            exitCode: -1,
            ok: false,
            transport: 'NOT_CAPTURED',
            engineIo: 0,
            capability: '[REDACTED]',
            stateAckResult: 'NOT_CAPTURED',
            oversizedStateAckResult: 'NOT_CAPTURED',
            stateAfterRejectionAckResult: 'NOT_CAPTURED',
            metadataAckResult: 'NOT_CAPTURED',
            snapshotAckResult: 'NOT_CAPTURED',
            oversizedSnapshotAckResult: 'NOT_CAPTURED',
            snapshotAfterRejectionAckResult: 'NOT_CAPTURED',
            staleSnapshotAckResult: 'NOT_CAPTURED',
            replayedUpdates: 0,
        },
        network: {
            preflightObserved: false,
            actualOrigin: 'NOT_CAPTURED',
            actualRequestHeaderNames: [],
            allowOrigin: null,
            allowPrivateNetwork: null,
            localNetworkAccess: 'NOT_OBSERVED',
            engineIoVersion: 0,
            wrongOriginStatus: 0,
            fixedPortRebind: false,
        },
        renderer: {
            visible: false,
            computedFontSizePx: 0,
            durableTextCount: 0,
            transientTextCount: 0,
        },
    };
}

async function postProof(target: string, body: string, proof: string): Promise<Response> {
    return fetch(`${NATIVE_HAPPY_P0_SERVER_URL}${target}`, {
        method: 'POST',
        headers: {
            [NATIVE_HAPPY_P0_CLIENT_HEADER]: NATIVE_HAPPY_P0_BROWSER_CLIENT,
            [NATIVE_HAPPY_P0_PROOF_HEADER]: proof,
        },
        body,
    });
}

function generateLocalNonce(): string {
    return generateSecureNonce().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseSnapshotPayload(value: unknown): NativeHappySnapshotPayload | null {
    if (
        !isRecord(value)
        || value.type !== 'session-output-snapshot'
        || typeof value.sessionId !== 'string'
        || typeof value.itemId !== 'string'
        || typeof value.revision !== 'number'
        || typeof value.text !== 'string'
        || typeof value.emittedAt !== 'number'
    ) {
        return null;
    }
    return {
        sessionId: value.sessionId,
        itemId: value.itemId,
        revision: value.revision,
        text: value.text,
        emittedAt: value.emittedAt,
    };
}

function getSnapshotPayloads(values: unknown[]): NativeHappySnapshotPayload[] {
    return values.map(parseSnapshotPayload).filter((value): value is NativeHappySnapshotPayload => value !== null);
}

function getNumericUpdateSeqs(values: unknown[]): number[] {
    return values.map(value => readNumber(value, 'seq')).filter((value): value is number => value !== null);
}

function readUpdateBody(value: unknown): unknown {
    return isRecord(value) ? value.body : null;
}

async function connectSocket(socket: Socket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Socket.IO logical connection timed out'));
        }, SOCKET_ACK_TIMEOUT_MS);
        const onConnect = () => {
            cleanup();
            resolve();
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };
        const cleanup = () => {
            clearTimeout(timer);
            socket.off('connect', onConnect);
            socket.off('connect_error', onError);
        };
        socket.once('connect', onConnect);
        socket.once('connect_error', onError);
        socket.connect();
    });
}

async function emitAck(socket: Socket, event: string, payload: unknown): Promise<unknown> {
    return socket.timeout(SOCKET_ACK_TIMEOUT_MS).emitWithAck(event, payload);
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
    const startedAt = Date.now();
    while (!predicate()) {
        if (Date.now() - startedAt >= timeoutMs) {
            throw new Error(`Timed out waiting for ${label}`);
        }
        await sleep(50);
    }
}

async function waitForNativeHappyServerShutdown(timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            await fetch(`${NATIVE_HAPPY_P0_SERVER_URL}/health?shutdown-probe=${Date.now()}`, {
                cache: 'no-store',
                mode: 'no-cors',
            });
        } catch {
            return;
        }
        await sleep(50);
    }
    throw new Error('Timed out waiting for the fixture listener to close');
}

async function sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function isExpectedNativeHappyPairResponse(
    payload: unknown,
    identity: Pick<DeviceKeypair, 'keyId' | 'publicKey'>,
): boolean {
    return jsonValuesEqual(payload, {
        machine: {
            machineId: NATIVE_HAPPY_P0_MACHINE_ID,
            tunnelUrl: NATIVE_HAPPY_P0_SERVER_URL,
        },
        authMode: 'paired-device',
        pairedDevice: {
            keyId: identity.keyId,
            publicKey: identity.publicKey,
        },
        githubLogin: null,
    });
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => jsonValuesEqual(value, right[index]));
    }
    if (!isRecord(left) || !isRecord(right)) {
        return false;
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return arraysEqual(leftKeys, rightKeys)
        && leftKeys.every(key => jsonValuesEqual(left[key], right[key]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string | null {
    return isRecord(value) && typeof value[key] === 'string' ? value[key] : null;
}

function readNumber(value: unknown, key: string): number | null {
    return isRecord(value) && typeof value[key] === 'number' ? value[key] : null;
}

function readBoolean(value: unknown, key: string): boolean | null {
    return isRecord(value) && typeof value[key] === 'boolean' ? value[key] : null;
}

function readArray(value: unknown, key: string): unknown[] {
    return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function readNestedString(value: unknown, parent: string, key: string): string | null {
    return isRecord(value) ? readString(value[parent], key) : null;
}

function readNestedNumber(value: unknown, parent: string, key: string): number | null {
    return isRecord(value) ? readNumber(value[parent], key) : null;
}

function visitObject(value: unknown, visitor: (key: string, value: unknown) => void): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            visitObject(item, visitor);
        }
        return;
    }
    if (!isRecord(value)) {
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        visitor(key, child);
        visitObject(child, visitor);
    }
}
