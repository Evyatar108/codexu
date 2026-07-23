import { describe, expect, it, vi } from 'vitest';

import {
  DaemonDrainingError,
  DaemonReplacementCoordinator,
  type DaemonReplacementIdentity,
} from './replacementCoordinator';

const identity: DaemonReplacementIdentity = {
  pid: 123,
  startedWithCliVersion: '1.2.3',
  startedWithPayloadArtifactId: 'happy-a',
  startedWithPayloadManifestSha256: 'A'.repeat(64),
};

describe('DaemonReplacementCoordinator', () => {
  it('refuses replacement while tracked children exist', () => {
    const coordinator = new DaemonReplacementCoordinator();
    expect(coordinator.prepare(identity, identity, 1)).toEqual({
      reserved: false,
      reason: 'active-children',
    });
    expect(coordinator.isDraining()).toBe(false);
  });

  it('refuses replacement while an admission is in flight', async () => {
    const coordinator = new DaemonReplacementCoordinator();
    let release!: () => void;
    const admission = coordinator.withAdmission(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(coordinator.prepare(identity, identity, 0)).toEqual({
      reserved: false,
      reason: 'admission-in-flight',
    });
    release();
    await admission;
  });

  it('atomically reserves replacement and blocks later registration races', async () => {
    const coordinator = new DaemonReplacementCoordinator();
    expect(coordinator.prepare(identity, identity, 0)).toEqual({ reserved: true });

    await expect(coordinator.withAdmission(() => undefined))
      .rejects.toBeInstanceOf(DaemonDrainingError);
    expect(coordinator.prepare(identity, identity, 0)).toEqual({
      reserved: false,
      reason: 'already-draining',
    });
  });

  it('requires the exact old daemon payload identity', () => {
    const coordinator = new DaemonReplacementCoordinator();
    expect(coordinator.prepare(
      { ...identity, startedWithPayloadManifestSha256: 'B'.repeat(64) },
      identity,
      0,
    )).toEqual({ reserved: false, reason: 'identity-mismatch' });
  });

  it('atomically attests an exact version-only daemon identity', () => {
    const coordinator = new DaemonReplacementCoordinator();
    const versionOnly: DaemonReplacementIdentity = {
      pid: 123,
      startedWithCliVersion: '1.2.3',
    };

    expect(coordinator.prepare(versionOnly, versionOnly, 0)).toEqual({ reserved: true });
  });

  it('does not conflate version-only and payload-bound identities', () => {
    const versionOnly: DaemonReplacementIdentity = {
      pid: 123,
      startedWithCliVersion: '1.2.3',
    };
    expect(new DaemonReplacementCoordinator().prepare(versionOnly, identity, 0))
      .toEqual({ reserved: false, reason: 'identity-mismatch' });
    expect(new DaemonReplacementCoordinator().prepare(identity, versionOnly, 0))
      .toEqual({ reserved: false, reason: 'identity-mismatch' });
  });
});
