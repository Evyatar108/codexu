import {
    LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS,
    LOCAL_DEVICE_PROOF_FRESHNESS_MS,
    LOCAL_DEVICE_PROOF_HEADER,
    LOCAL_PAIRING_NONCE_HEADER,
    LOCAL_PAIRING_SECRET_HEADER,
    createLocalPairingInvite,
    decodeLocalDeviceProofHeader,
    hashLocalRequestBody,
    isLocalProofFresh,
    verifyLocalRequest,
    type LocalPairingInvite,
    type LocalSignedRequestEnvelope,
    PairCompleteRequestSchema,
} from "@slopus/happy-wire";
import { timingSafeEqual } from "node:crypto";

import {
    isValidDeviceRecordShape,
    resolvePublicRoutePolicy,
    SOCKET_PROOF_METHOD,
    SOCKET_PROOF_PATH,
    type DeviceEnrollResult,
    type RemoteDeviceRecord,
} from "./remoteDeviceAuth";

export interface LocalDeviceAuthConfig {
    machineId: string;
    serverUrl: string;
    devices: RemoteDeviceRecord[];
    onDevicesChanged?: (devices: RemoteDeviceRecord[]) => void | Promise<void>;
    now?: () => number;
}

interface InviteState {
    invite: LocalPairingInvite;
    reserved: boolean;
}

export interface LocalEnrollmentInput {
    headers: Record<string, unknown>;
    origin: string | undefined;
    rawBody: Uint8Array | string | undefined;
    body: unknown;
}

export interface LocalAuthRuntime {
    createInvite(browserOrigin: string): LocalPairingInvite;
    enroll(input: LocalEnrollmentInput): Promise<DeviceEnrollResult>;
    httpGuard: (request: any, reply: any) => Promise<unknown>;
    bodyHashGuard: (request: any, reply: any) => Promise<unknown>;
    verifySocketHandshake(headers: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }>;
}

function headerString(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
        return value[0];
    }
    return undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createLocalAuthRuntime(config: LocalDeviceAuthConfig): LocalAuthRuntime {
    const devices = new Map(config.devices.map(device => [device.keyId, device]));
    const seenNonces = new Map<string, number>();
    const invites = new Map<string, InviteState>();
    const now = config.now ?? (() => Date.now());
    let enrollmentQueue = Promise.resolve();

    async function verify(
        method: string,
        target: string,
        header: string | undefined,
        bodyHash?: string,
    ): Promise<{ ok: boolean; reason?: string; envelope?: LocalSignedRequestEnvelope }> {
        const envelope = decodeLocalDeviceProofHeader(header);
        if (!envelope) {
            return { ok: false, reason: "missing_or_malformed_proof" };
        }
        const device = devices.get(envelope.keyId);
        if (!device) {
            return { ok: false, reason: "unknown_key" };
        }
        if (device.publicKey !== envelope.publicKey) {
            return { ok: false, reason: "public_key_mismatch" };
        }
        const nowMs = now();
        if (!isLocalProofFresh(
            envelope.issuedAt,
            nowMs,
            LOCAL_DEVICE_PROOF_FRESHNESS_MS,
            LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS,
        )) {
            return { ok: false, reason: "stale_proof" };
        }
        if (seenNonces.has(envelope.nonce)) {
            return { ok: false, reason: "replayed_nonce" };
        }
        const result = await verifyLocalRequest(envelope, {
            method,
            target,
            bodyHash,
            expectedPublicKey: device.publicKey,
        });
        if (!result.ok) {
            return result;
        }
        for (const [nonce, expiry] of seenNonces) {
            if (expiry <= nowMs) {
                seenNonces.delete(nonce);
            }
        }
        seenNonces.set(
            envelope.nonce,
            envelope.issuedAt + LOCAL_DEVICE_PROOF_FRESHNESS_MS + LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS,
        );
        return { ok: true, envelope };
    }

    function createInvite(browserOrigin: string): LocalPairingInvite {
        const invite = createLocalPairingInvite({
            serverUrl: config.serverUrl,
            browserOrigin,
            machineId: config.machineId,
            issuedAt: new Date(now()),
        });
        invites.set(invite.pairingNonce, { invite, reserved: false });
        return invite;
    }

    async function enroll(input: LocalEnrollmentInput): Promise<DeviceEnrollResult> {
        const pairingNonce = headerString(input.headers[LOCAL_PAIRING_NONCE_HEADER.toLowerCase()]);
        const secret = headerString(input.headers[LOCAL_PAIRING_SECRET_HEADER.toLowerCase()]);
        const state = pairingNonce ? invites.get(pairingNonce) : undefined;
        if (
            !state
            || state.reserved
            || !secret
            || !constantTimeEqual(secret, state.invite.pairSecret)
            || input.origin !== state.invite.browserOrigin
            || now() < Date.parse(state.invite.issuedAt)
            || now() >= Date.parse(state.invite.expiresAt)
        ) {
            return { ok: false, reason: "pairing_denied" };
        }
        state.reserved = true;
        try {
            const parsedBody = PairCompleteRequestSchema.safeParse(input.body);
            if (!parsedBody.success) {
                return { ok: false, reason: "invalid_device_key" };
            }
            const body = parsedBody.data;
            if (
                body.machineId !== config.machineId
                || !isValidDeviceRecordShape({
                    keyId: body.deviceKeyId,
                    publicKey: body.deviceEd25519PublicKey,
                })
            ) {
                return { ok: false, reason: "invalid_device_key" };
            }
            const proof = decodeLocalDeviceProofHeader(
                headerString(input.headers[LOCAL_DEVICE_PROOF_HEADER.toLowerCase()]),
            );
            if (!proof || proof.keyId !== body.deviceKeyId || proof.publicKey !== body.deviceEd25519PublicKey) {
                return { ok: false, reason: "invalid_device_proof" };
            }
            if (!isLocalProofFresh(
                proof.issuedAt,
                now(),
                LOCAL_DEVICE_PROOF_FRESHNESS_MS,
                LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS,
            )) {
                return { ok: false, reason: "stale_proof" };
            }
            const verification = await verifyLocalRequest(proof, {
                method: "POST",
                target: "/pair/complete",
                bodyHash: hashLocalRequestBody(input.rawBody ?? null),
                expectedPublicKey: body.deviceEd25519PublicKey,
            });
            if (!verification.ok) {
                return { ok: false, reason: verification.reason };
            }

            let result: DeviceEnrollResult = { ok: false, reason: "enrollment_failed" };
            const work = enrollmentQueue.then(async () => {
                const existing = devices.get(body.deviceKeyId);
                if (existing && existing.publicKey !== body.deviceEd25519PublicKey) {
                    result = { ok: false, reason: "device_key_conflict" };
                    return;
                }
                if (existing) {
                    result = { ok: true, enrolled: false };
                    return;
                }
                const record = {
                    keyId: body.deviceKeyId,
                    publicKey: body.deviceEd25519PublicKey,
                };
                const next = [...devices.values(), record];
                await config.onDevicesChanged?.(next);
                devices.set(record.keyId, record);
                result = { ok: true, enrolled: true };
            });
            enrollmentQueue = work.catch(() => {});
            await work;
            if (result.ok) {
                invites.delete(state.invite.pairingNonce);
            }
            return result;
        } finally {
            const current = invites.get(state.invite.pairingNonce);
            if (current) {
                current.reserved = false;
            }
        }
    }

    async function httpGuard(request: any, reply: any): Promise<unknown> {
        if (request.method === "OPTIONS") {
            return;
        }
        const routePath = request.routeOptions?.url as string | undefined;
        const policy = resolvePublicRoutePolicy(request.method, routePath);
        if (policy === null) {
            return reply.code(401).send({ error: "route_not_allowlisted" });
        }
        if (policy === "pairComplete" || policy === "oauthCallback") {
            return;
        }
        const result = await verify(
            request.method,
            String(request.url ?? ""),
            headerString(request.headers[LOCAL_DEVICE_PROOF_HEADER.toLowerCase()]),
        );
        if (!result.ok) {
            return reply.code(401).send({ error: "device_proof_required" });
        }
        request.localDeviceEnvelope = result.envelope;
    }

    async function bodyHashGuard(request: any, reply: any): Promise<unknown> {
        const envelope = request.localDeviceEnvelope as LocalSignedRequestEnvelope | undefined;
        if (envelope && hashLocalRequestBody(request.rawBody ?? null) !== envelope.bodyHash) {
            return reply.code(401).send({ error: "body_hash_mismatch" });
        }
    }

    async function verifySocketHandshake(headers: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }> {
        return verify(
            SOCKET_PROOF_METHOD,
            SOCKET_PROOF_PATH,
            headerString(headers[LOCAL_DEVICE_PROOF_HEADER.toLowerCase()]),
        );
    }

    return { createInvite, enroll, httpGuard, bodyHashGuard, verifySocketHandshake };
}
