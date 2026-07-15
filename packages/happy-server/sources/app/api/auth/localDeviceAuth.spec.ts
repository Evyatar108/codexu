import {
    LOCAL_DEVICE_PROOF_HEADER,
    LOCAL_PAIRING_NONCE_HEADER,
    LOCAL_PAIRING_SECRET_HEADER,
    encodeBase64,
    encodeLocalDeviceProofHeader,
    generateLocalPairingNonce,
    hashLocalRequestBody,
    signLocalRequest,
} from "@slopus/happy-wire";
import * as ed from "@noble/ed25519";
import { describe, expect, it, vi } from "vitest";

import { createLocalAuthRuntime } from "./localDeviceAuth";

describe("local paired-device auth", () => {
    it("does not consume an invite or persist/pin a key after invalid enrollment", async () => {
        const now = 1_800_000_000_000;
        const persisted: Array<Array<{ keyId: string; publicKey: string }>> = [];
        const runtime = createLocalAuthRuntime({
            machineId: "machine-1",
            serverUrl: "http://127.0.0.1:4567",
            devices: [],
            now: () => now,
            onDevicesChanged: async devices => {
                persisted.push(devices);
            },
        });
        const invite = runtime.createInvite("http://127.0.0.1:8081");
        const secretKey = new Uint8Array(32).fill(7);
        const publicKey = encodeBase64(await ed.getPublicKeyAsync(secretKey));
        const body = JSON.stringify({
            version: 1,
            machineId: "machine-1",
            deviceKeyId: "tablet-1",
            deviceEd25519PublicKey: publicKey,
        });
        const bad = await runtime.enroll({
            headers: {
                origin: invite.browserOrigin,
                [LOCAL_PAIRING_SECRET_HEADER.toLowerCase()]: invite.pairSecret,
                [LOCAL_PAIRING_NONCE_HEADER.toLowerCase()]: invite.pairingNonce,
                [LOCAL_DEVICE_PROOF_HEADER.toLowerCase()]: "bad",
            },
            origin: invite.browserOrigin,
            rawBody: body,
            body: JSON.parse(body),
        });
        expect(bad.ok).toBe(false);
        expect(persisted).toEqual([]);

        const proof = await signLocalRequest({
            method: "POST",
            target: "/pair/complete",
            keyId: "tablet-1",
            nonce: generateLocalPairingNonce(),
            issuedAt: now,
            bodyHash: hashLocalRequestBody(body),
        }, secretKey);
        const accepted = await runtime.enroll({
            headers: {
                origin: invite.browserOrigin,
                [LOCAL_PAIRING_SECRET_HEADER.toLowerCase()]: invite.pairSecret,
                [LOCAL_PAIRING_NONCE_HEADER.toLowerCase()]: invite.pairingNonce,
                [LOCAL_DEVICE_PROOF_HEADER.toLowerCase()]: encodeLocalDeviceProofHeader(proof),
            },
            origin: invite.browserOrigin,
            rawBody: body,
            body: JSON.parse(body),
        });
        expect(accepted).toEqual({ ok: true, enrolled: true });
        expect(persisted).toEqual([[{ keyId: "tablet-1", publicKey }]]);
    });

    it("binds query and body and rejects stale, replayed, and unknown keys", async () => {
        const now = 1_800_000_000_000;
        const secretKey = new Uint8Array(32).fill(9);
        const publicKey = encodeBase64(await ed.getPublicKeyAsync(secretKey));
        const runtime = createLocalAuthRuntime({
            machineId: "machine-1",
            serverUrl: "http://127.0.0.1:4567",
            devices: [{ keyId: "tablet-1", publicKey }],
            now: () => now,
        });
        const body = JSON.stringify({ enabled: true });
        const proof = await signLocalRequest({
            method: "PUT",
            target: "/v2/me/settings?b=2&a=1",
            keyId: "tablet-1",
            nonce: generateLocalPairingNonce(),
            issuedAt: now,
            bodyHash: hashLocalRequestBody(body),
        }, secretKey);
        const request = {
            method: "PUT",
            url: "/v2/me/settings?a=1&b=2",
            routeOptions: { url: "/v2/me/settings" },
            headers: {
                [LOCAL_DEVICE_PROOF_HEADER.toLowerCase()]: encodeLocalDeviceProofHeader(proof),
            },
        };
        const reply = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnValue(undefined),
        };
        await runtime.httpGuard(request, reply);
        expect(reply.send).not.toHaveBeenCalled();
        await runtime.httpGuard(request, reply);
        expect(reply.code).toHaveBeenCalledWith(401);
    });

    it("admits exactly one concurrent use of the same proof nonce", async () => {
        const now = 1_800_000_000_000;
        const secretKey = new Uint8Array(32).fill(19);
        const publicKey = encodeBase64(await ed.getPublicKeyAsync(secretKey));
        const runtime = createLocalAuthRuntime({
            machineId: "machine-1",
            serverUrl: "http://127.0.0.1:4567",
            devices: [{ keyId: "tablet-1", publicKey }],
            now: () => now,
        });
        const proof = await signLocalRequest({
            method: "GET",
            target: "/v1/updates",
            keyId: "tablet-1",
            nonce: generateLocalPairingNonce(),
            issuedAt: now,
            bodyHash: hashLocalRequestBody(null),
        }, secretKey);
        const headers = {
            [LOCAL_DEVICE_PROOF_HEADER.toLowerCase()]: encodeLocalDeviceProofHeader(proof),
        };
        const results = await Promise.all([
            runtime.verifySocketHandshake(headers),
            runtime.verifySocketHandshake(headers),
        ]);
        expect(results.filter(result => result.ok)).toHaveLength(1);
        expect(results.filter(result => result.reason === "replayed_nonce")).toHaveLength(1);
    });

    it("allows only an active invite origin and expires it with the invite", () => {
        let now = 1_800_000_000_000;
        const runtime = createLocalAuthRuntime({
            machineId: "machine-1",
            serverUrl: "http://127.0.0.1:4567",
            devices: [],
            now: () => now,
        });
        runtime.createInvite("http://127.0.0.1:8081");
        expect(runtime.isOriginAllowed("http://127.0.0.1:8081")).toBe(true);
        expect(runtime.isOriginAllowed("http://127.0.0.1:8082")).toBe(false);
        now += 120_001;
        expect(runtime.isOriginAllowed("http://127.0.0.1:8081")).toBe(false);
    });
});
