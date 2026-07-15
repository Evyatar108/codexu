import * as ed from "@noble/ed25519";
import {
    LOCAL_DEVICE_PROOF_HEADER,
    LOCAL_PAIRING_NONCE_HEADER,
    LOCAL_PAIRING_SECRET_HEADER,
    encodeBase64,
    encodeLocalDeviceProofHeader,
    generateLocalPairingNonce,
    hashLocalRequestBody,
    signLocalRequest,
    verifyPairCompleteResponse,
} from "@slopus/happy-wire";
import { afterEach, describe, expect, it } from "vitest";

import { configureApi, createApi } from "../api";

describe("/pair/complete v2 local strategy", () => {
    const apps: ReturnType<typeof createApi>[] = [];
    afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

    it("requires possession proof, preserves the invite after failure, and returns signed server identity", async () => {
        const now = 1_800_000_000_000;
        const serverSecret = new Uint8Array(32).fill(71);
        const serverPublic = await ed.getPublicKeyAsync(serverSecret);
        const deviceSecret = new Uint8Array(32).fill(72);
        const devicePublic = encodeBase64(await ed.getPublicKeyAsync(deviceSecret));
        let runtime: import("../auth/localDeviceAuth").LocalAuthRuntime | undefined;
        const app = createApi();
        apps.push(app);
        configureApi(app, {
            localUserId: "machine-1",
            publicUrl: "http://127.0.0.1:4567",
            tofuPublicKeys: {
                ed25519PublicKey: encodeBase64(serverPublic),
                x25519PublicKey: encodeBase64(new Uint8Array(32).fill(73)),
                ed25519Fingerprint: "SHA256:server",
            },
            ed25519SecretKey: serverSecret,
        }, {
            auth: "local-device",
            localAuth: {
                machineId: "machine-1",
                serverUrl: "http://127.0.0.1:4567",
                devices: [],
                now: () => now,
            },
            onLocalAuthRuntime: value => {
                runtime = value;
            },
        });
        await app.ready();
        const invite = runtime!.createInvite("http://127.0.0.1:8081");
        const body = JSON.stringify({
            version: 1,
            machineId: "machine-1",
            deviceKeyId: "tablet-1",
            deviceEd25519PublicKey: devicePublic,
        });
        const baseHeaders = {
            origin: invite.browserOrigin,
            "content-type": "application/json",
            [LOCAL_PAIRING_SECRET_HEADER]: invite.pairSecret,
            [LOCAL_PAIRING_NONCE_HEADER]: invite.pairingNonce,
        };
        const rejected = await app.inject({
            method: "POST",
            url: "/pair/complete",
            headers: { ...baseHeaders, [LOCAL_DEVICE_PROOF_HEADER]: "bad" },
            payload: body,
        });
        expect(rejected.statusCode).toBe(401);

        const proof = await signLocalRequest({
            method: "POST",
            target: "/pair/complete",
            keyId: "tablet-1",
            nonce: generateLocalPairingNonce(),
            issuedAt: now,
            bodyHash: hashLocalRequestBody(body),
        }, deviceSecret);
        const accepted = await app.inject({
            method: "POST",
            url: "/pair/complete",
            headers: {
                ...baseHeaders,
                [LOCAL_DEVICE_PROOF_HEADER]: encodeLocalDeviceProofHeader(proof),
            },
            payload: body,
        });
        expect(accepted.statusCode).toBe(200);
        const response = accepted.json();
        expect(response).toMatchObject({
            version: 2,
            authMode: "paired-device",
            githubLogin: null,
            profile: { id: "machine-1", github: null },
            pairedDevice: { keyId: "tablet-1", publicKey: devicePublic },
            machine: {
                machineId: "machine-1",
                ed25519PublicKey: encodeBase64(serverPublic),
                ed25519Fingerprint: "SHA256:server",
            },
        });
        await expect(verifyPairCompleteResponse(response)).resolves.toBe(true);
    });
});
