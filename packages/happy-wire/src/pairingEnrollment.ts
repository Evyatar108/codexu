import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import * as z from 'zod';

import { decodeBase64, encodeBase64 } from './publicDeviceAuth';

ed.hashes.sha512 = (message: Uint8Array) => sha512(message);

export const PAIR_COMPLETE_REQUEST_VERSION = 1 as const;
export const PAIR_COMPLETE_RESPONSE_VERSION = 2 as const;
export const PAIR_COMPLETE_RESPONSE_DOMAIN = 'happy-pair-complete/v2';

export const PairCompleteRequestSchema = z.object({
  version: z.literal(PAIR_COMPLETE_REQUEST_VERSION),
  machineId: z.string().min(1).max(256),
  deviceKeyId: z.string().min(1).max(128),
  deviceEd25519PublicKey: z.string().min(1),
  mobileEcdhPublicKey: z.string().optional(),
}).strict();

export const CanonicalLocalProfileSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  avatar: z.null(),
  github: z.object({
    id: z.number(),
    login: z.string(),
    name: z.string(),
    avatar_url: z.string(),
    email: z.string().optional(),
    bio: z.string().nullable(),
  }).nullable(),
  connectedServices: z.array(z.string()),
}).strict();

export const CanonicalLocalProfileFileSchema = CanonicalLocalProfileSchema.extend({
  version: z.literal(1),
}).strict();

export const PairCompleteResponseUnsignedSchema = z.object({
  version: z.literal(PAIR_COMPLETE_RESPONSE_VERSION),
  authMode: z.literal('paired-device'),
  githubLogin: z.null(),
  profile: CanonicalLocalProfileSchema,
  machine: z.object({
    machineId: z.string().min(1),
    tunnelUrl: z.string().url(),
    ed25519PublicKey: z.string().min(1),
    x25519PublicKey: z.string().min(1),
    ed25519Fingerprint: z.string().min(1),
    mobileSharedSecret: z.string().optional(),
  }).strict(),
  pairedDevice: z.object({
    keyId: z.string().min(1),
    publicKey: z.string().min(1),
  }).strict(),
  issuedAt: z.number().int().nonnegative(),
}).strict();

export const PairCompleteResponseSchema = PairCompleteResponseUnsignedSchema.extend({
  serverSignature: z.string().min(1),
}).strict();

export type PairCompleteRequest = z.infer<typeof PairCompleteRequestSchema>;
export type CanonicalLocalProfile = z.infer<typeof CanonicalLocalProfileSchema>;
export type CanonicalLocalProfileFile = z.infer<typeof CanonicalLocalProfileFileSchema>;
export type PairCompleteResponseUnsigned = z.infer<typeof PairCompleteResponseUnsignedSchema>;
export type PairCompleteResponse = z.infer<typeof PairCompleteResponseSchema>;

export function canonicalPairCompleteResponse(response: PairCompleteResponseUnsigned): string {
  const value = PairCompleteResponseUnsignedSchema.parse(response);
  return [
    PAIR_COMPLETE_RESPONSE_DOMAIN,
    String(value.version),
    value.machine.machineId,
    value.machine.tunnelUrl,
    value.machine.ed25519PublicKey,
    value.machine.x25519PublicKey,
    value.machine.ed25519Fingerprint,
    value.pairedDevice.keyId,
    value.pairedDevice.publicKey,
    String(value.issuedAt),
    encodeBase64(sha256(new TextEncoder().encode(JSON.stringify(value.profile)))),
    value.machine.mobileSharedSecret ?? '',
  ].join('\n');
}

export async function signPairCompleteResponse(
  response: PairCompleteResponseUnsigned,
  serverSecretKey: Uint8Array,
): Promise<PairCompleteResponse> {
  const validated = PairCompleteResponseUnsignedSchema.parse(response);
  const signature = await ed.signAsync(
    new TextEncoder().encode(canonicalPairCompleteResponse(validated)),
    serverSecretKey,
  );
  return PairCompleteResponseSchema.parse({
    ...validated,
    serverSignature: encodeBase64(signature),
  });
}

export async function verifyPairCompleteResponse(response: unknown): Promise<boolean> {
  const parsed = PairCompleteResponseSchema.safeParse(response);
  if (!parsed.success) {
    return false;
  }
  const { serverSignature, ...unsigned } = parsed.data;
  try {
    return await ed.verifyAsync(
      decodeBase64(serverSignature),
      new TextEncoder().encode(canonicalPairCompleteResponse(unsigned)),
      decodeBase64(unsigned.machine.ed25519PublicKey),
    );
  } catch {
    return false;
  }
}
