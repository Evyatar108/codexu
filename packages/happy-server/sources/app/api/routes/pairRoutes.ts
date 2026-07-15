import {
    CanonicalLocalProfileFileSchema,
    PairCompleteRequestSchema,
    PairCompleteResponseSchema,
    signPairCompleteResponse,
    type CanonicalLocalProfile,
} from "@slopus/happy-wire";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import nacl from "tweetnacl";
import { z } from "zod";

import type { LocalAuthRuntime } from "../auth/localDeviceAuth";
import type { PublicAuthRuntime } from "../auth/remoteDeviceAuth";
import type { TofuHandshakeConfig } from "../api";
import type { Fastify } from "../types";

export interface PairRoutePaths {
    profile?: string;
}

export interface PairRouteAuthOptions {
    mode: "local" | "public";
    localAuthRuntime?: LocalAuthRuntime;
    publicAuthRuntime?: PublicAuthRuntime;
}

const PAIR_RATE_LIMIT_MAX = 30;
const PAIR_RATE_LIMIT_WINDOW_MS = 60_000;
const pairRateBuckets = new Map<string, { count: number; windowStart: number }>();

function isPairRateLimited(ip: string, now: number): boolean {
    const bucket = pairRateBuckets.get(ip);
    if (!bucket || now - bucket.windowStart >= PAIR_RATE_LIMIT_WINDOW_MS) {
        pairRateBuckets.set(ip, { count: 1, windowStart: now });
        return false;
    }
    if (bucket.count >= PAIR_RATE_LIMIT_MAX) {
        return true;
    }
    bucket.count += 1;
    return false;
}

async function readCanonicalProfile(profilePath: string, localUserId: string): Promise<CanonicalLocalProfile> {
    try {
        const parsed = CanonicalLocalProfileFileSchema.safeParse(
            JSON.parse(await fs.readFile(profilePath, "utf8")),
        );
        if (parsed.success) {
            const { version: _version, ...profile } = parsed.data;
            return profile;
        }
    } catch {
        // Profile display data is optional; local identity is always available.
    }
    return {
        id: localUserId,
        timestamp: Date.now(),
        firstName: null,
        lastName: null,
        avatar: null,
        github: null,
        connectedServices: [],
    };
}

export function pairRoutes(
    app: Fastify,
    tofuConfig: TofuHandshakeConfig,
    paths: PairRoutePaths = {},
    authOptions: PairRouteAuthOptions,
) {
    app.post("/pair/complete", {
        schema: {
            body: z.unknown(),
            response: {
                200: PairCompleteResponseSchema,
                400: z.object({ error: z.string() }),
                401: z.object({ error: z.string() }),
                409: z.object({ error: z.string() }),
                429: z.object({ error: z.string() }),
                503: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        if (isPairRateLimited(request.ip, Date.now())) {
            return reply.code(429).send({ error: "rate_limited" });
        }
        if (!tofuConfig.tofuPublicKeys || !tofuConfig.ed25519SecretKey) {
            return reply.code(503).send({ error: "tofu_key_material_unavailable" });
        }
        const prepared = authOptions.mode === "local"
            ? await authOptions.localAuthRuntime?.prepareEnrollment({
                headers: request.headers,
                origin: typeof request.headers.origin === "string" ? request.headers.origin : undefined,
                rawBody: (request as any).rawBody,
                body: request.body,
            })
            : await authOptions.publicAuthRuntime?.preparePairingDevice({
                headers: request.headers,
                rawBody: (request as any).rawBody,
                body: request.body,
                expectedMachineId: tofuConfig.localUserId,
            });
        if (!prepared?.ok) {
            if (prepared?.reason === "device_key_conflict") {
                return reply.code(409).send({ error: "device_key_conflict" });
            }
            if (prepared?.reason === "invalid_device_key" || prepared?.reason === "invalid_machine_id") {
                return reply.code(400).send({ error: "invalid_device_key" });
            }
            return reply.code(401).send({ error: "pairing_denied" });
        }
        try {
            const parsedBody = PairCompleteRequestSchema.parse(request.body);
            let mobileSharedSecret: string | undefined;
            if (parsedBody.mobileEcdhPublicKey && tofuConfig.x25519SecretKey) {
                const mobilePublicKey = Buffer.from(parsedBody.mobileEcdhPublicKey, "base64");
                if (mobilePublicKey.length !== nacl.box.publicKeyLength) {
                    throw new Error("invalid_mobile_ecdh_key");
                }
                const sharedSecret = nacl.box.before(
                    mobilePublicKey,
                    tofuConfig.x25519SecretKey,
                );
                mobileSharedSecret = Buffer.from(sharedSecret).toString("base64");
            }

            const tunnelUrl = tofuConfig.publicUrl
                || process.env.PUBLIC_URL
                || `http://127.0.0.1:${process.env.PORT ?? "3005"}`;
            const profile = await readCanonicalProfile(
                paths.profile ?? path.join(os.homedir(), ".happy", "local-profile.json"),
                tofuConfig.localUserId,
            );
            const response = await signPairCompleteResponse({
                version: 2,
                authMode: "paired-device",
                githubLogin: null,
                profile,
                machine: {
                    machineId: tofuConfig.localUserId,
                    tunnelUrl,
                    ed25519PublicKey: tofuConfig.tofuPublicKeys.ed25519PublicKey,
                    x25519PublicKey: tofuConfig.tofuPublicKeys.x25519PublicKey,
                    ed25519Fingerprint: tofuConfig.tofuPublicKeys.ed25519Fingerprint ?? "",
                    ...(mobileSharedSecret ? { mobileSharedSecret } : {}),
                },
                pairedDevice: prepared.record,
                issuedAt: Date.now(),
            }, tofuConfig.ed25519SecretKey);
            const committed = await prepared.commit();
            if (!committed.ok) {
                if (committed.reason === "device_key_conflict") {
                    return reply.code(409).send({ error: "device_key_conflict" });
                }
                return reply.code(400).send({ error: "invalid_device_key" });
            }
            return response;
        } catch {
            prepared.cancel();
            return reply.code(400).send({ error: "invalid_pairing_payload" });
        }
    });

    app.post("/pair/connect", {
        schema: {
            body: z.object({ mobileEcdhPublicKey: z.string().optional() }),
        },
    }, async (_request, reply) => {
        if (!tofuConfig.tofuPublicKeys) {
            return reply.code(503).send({ error: "tofu_public_keys_unavailable" });
        }
        return {
            machineId: tofuConfig.localUserId,
            tunnelUrl: tofuConfig.publicUrl,
            ed25519PublicKey: tofuConfig.tofuPublicKeys.ed25519PublicKey,
            x25519PublicKey: tofuConfig.tofuPublicKeys.x25519PublicKey,
            ed25519Fingerprint: tofuConfig.tofuPublicKeys.ed25519Fingerprint,
        };
    });
}
