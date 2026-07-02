import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDeviceEnrollmentPersister,
  readPublicPairedDevices,
  writePublicPairedDevices,
} from './publicPairedDevices';

let workDir: string;
let filePath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'happy-paired-devices-'));
  filePath = join(workDir, 'public-paired-devices.json');
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('readPublicPairedDevices', () => {
  it('returns [] when the file is absent (first start / no device paired)', async () => {
    expect(await readPublicPairedDevices(filePath)).toEqual([]);
  });

  it('round-trips written devices', async () => {
    const devices = [
      { keyId: 'device-a', publicKey: 'AAAA' },
      { keyId: 'device-b', publicKey: 'BBBB', label: 'phone' },
    ];
    await writePublicPairedDevices(filePath, devices);
    expect(await readPublicPairedDevices(filePath)).toEqual(devices);
  });

  it('throws (fail-closed) on invalid JSON rather than silently returning []', async () => {
    writeFileSync(filePath, '{ not json');
    await expect(readPublicPairedDevices(filePath)).rejects.toThrow(/not valid JSON/);
  });

  it('throws on schema-invalid content (missing publicKey)', async () => {
    writeFileSync(filePath, JSON.stringify({ version: 1, devices: [{ keyId: 'a' }] }));
    await expect(readPublicPairedDevices(filePath)).rejects.toThrow(/is invalid/);
  });

  it('throws on an unknown file version', async () => {
    writeFileSync(filePath, JSON.stringify({ version: 2, devices: [] }));
    await expect(readPublicPairedDevices(filePath)).rejects.toThrow(/is invalid/);
  });
});

describe('writePublicPairedDevices', () => {
  it('writes a versioned file (0600 on posix) mirroring the device list', async () => {
    await writePublicPairedDevices(filePath, [{ keyId: 'device-a', publicKey: 'AAAA' }]);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(parsed).toEqual({ version: 1, devices: [{ keyId: 'device-a', publicKey: 'AAAA' }] });
    if (process.platform !== 'win32') {
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });

  it('omits an undefined label field', async () => {
    await writePublicPairedDevices(filePath, [{ keyId: 'device-a', publicKey: 'AAAA' }]);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(parsed.devices[0]).not.toHaveProperty('label');
  });
});

describe('createDeviceEnrollmentPersister', () => {
  it('persists the full allDevices snapshot (the verifier is the source of truth)', async () => {
    const persist = createDeviceEnrollmentPersister(filePath);
    const all = [
      { keyId: 'device-a', publicKey: 'AAAA' },
      { keyId: 'device-b', publicKey: 'BBBB' },
    ];
    await persist({ keyId: 'device-b', publicKey: 'BBBB' }, all);
    expect(await readPublicPairedDevices(filePath)).toEqual(all);
  });

  it('overwrites with the latest snapshot on a subsequent enrollment', async () => {
    const persist = createDeviceEnrollmentPersister(filePath);
    await persist({ keyId: 'device-a', publicKey: 'AAAA' }, [{ keyId: 'device-a', publicKey: 'AAAA' }]);
    const two = [
      { keyId: 'device-a', publicKey: 'AAAA' },
      { keyId: 'device-b', publicKey: 'BBBB' },
    ];
    await persist({ keyId: 'device-b', publicKey: 'BBBB' }, two);
    expect(await readPublicPairedDevices(filePath)).toEqual(two);
  });
});
