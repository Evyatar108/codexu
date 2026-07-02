import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import * as z from 'zod';
import { writeJsonAtomically } from '@slopus/happy-wire/node';
import type { RemoteDeviceRecord } from 'happy-server';

import { configuration } from '@/configuration';

/**
 * Durable store for the devices TOFU-pinned via `/pair/complete` in public mode.
 *
 * The running verifier (in the embedded happy-server) is the source of truth for
 * the LIVE process — enrollment mutates its in-memory device set so a freshly
 * paired device authenticates immediately. This file exists purely for DURABILITY:
 * it lets the daemon re-seed that set on the next start so a paired device does not
 * have to re-pair after a daemon restart. It lives in the 0700 happyHomeDir and is
 * written 0600 (it holds device PUBLIC keys only — no secrets — but is kept
 * restricted for consistency with the other public-mode files).
 */

const PublicPairedDeviceSchema = z.object({
  keyId: z.string().min(1),
  publicKey: z.string().min(1),
  label: z.string().optional(),
});

const PublicPairedDevicesFileSchema = z.object({
  /** Schema version for forward-compat migrations. */
  version: z.literal(1),
  devices: z.array(PublicPairedDeviceSchema),
});

export type PublicPairedDevicesFile = z.infer<typeof PublicPairedDevicesFileSchema>;

function toRecord(device: z.infer<typeof PublicPairedDeviceSchema>): RemoteDeviceRecord {
  return {
    keyId: device.keyId,
    publicKey: device.publicKey,
    ...(device.label !== undefined ? { label: device.label } : {}),
  };
}

/**
 * Read + validate the persisted paired-device list. Returns `[]` when the file is
 * absent (first start / no device paired yet). Throws a clear fail-closed error
 * when the file exists but is invalid JSON or fails schema validation, rather than
 * silently starting with an empty set that would force every device to re-pair.
 */
export async function readPublicPairedDevices(
  filePath: string = configuration.publicPairedDevicesFile,
): Promise<RemoteDeviceRecord[]> {
  if (!existsSync(filePath)) {
    return [];
  }
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read public paired-devices at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(`public paired-devices at ${filePath} is not valid JSON`);
  }
  const result = PublicPairedDevicesFileSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(`public paired-devices at ${filePath} is invalid: ${result.error.message}`);
  }
  return result.data.devices.map(toRecord);
}

/**
 * Atomically persist the full pinned-device list (mode 0600). Called with the
 * verifier's post-enrollment device snapshot, so the on-disk file always mirrors
 * the live set. Dedup / conflict handling already happened in the verifier's
 * `enroll`, so this is a straight write of the authoritative list.
 */
export async function writePublicPairedDevices(
  filePath: string,
  devices: RemoteDeviceRecord[],
): Promise<void> {
  const file: PublicPairedDevicesFile = {
    version: 1,
    devices: devices.map((device) => ({
      keyId: device.keyId,
      publicKey: device.publicKey,
      ...(device.label !== undefined ? { label: device.label } : {}),
    })),
  };
  await writeJsonAtomically(filePath, file);
}

/**
 * Build the `onDeviceEnrolled` hook the embedded happy-server invokes after a NEW
 * device is pinned. It persists the verifier's full current device list so the pin
 * survives a daemon restart.
 */
export function createDeviceEnrollmentPersister(
  filePath: string = configuration.publicPairedDevicesFile,
): (device: RemoteDeviceRecord, allDevices: RemoteDeviceRecord[]) => Promise<void> {
  return async (_device, allDevices) => {
    await writePublicPairedDevices(filePath, allDevices);
  };
}
