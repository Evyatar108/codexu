import type { DaemonLocallyPersistedState } from '@/persistence';

export type DaemonReplacementIdentity = Pick<
  DaemonLocallyPersistedState,
  | 'pid'
  | 'startedWithCliVersion'
  | 'startedWithPayloadArtifactId'
  | 'startedWithPayloadManifestSha256'
>;

export type DaemonReplacementRefusal =
  | 'identity-mismatch'
  | 'active-children'
  | 'admission-in-flight'
  | 'already-draining';

export class DaemonDrainingError extends Error {
  constructor() {
    super('Daemon is draining for replacement');
    this.name = 'DaemonDrainingError';
  }
}

function sameIdentity(
  expected: DaemonReplacementIdentity,
  actual: DaemonReplacementIdentity,
): boolean {
  return expected.pid === actual.pid
    && expected.startedWithCliVersion === actual.startedWithCliVersion
    && expected.startedWithPayloadArtifactId === actual.startedWithPayloadArtifactId
    && expected.startedWithPayloadManifestSha256 === actual.startedWithPayloadManifestSha256;
}

/**
 * Old-daemon-owned admission barrier. JavaScript executes prepare() synchronously:
 * no admission can enter between the final busy check and the draining state.
 */
export class DaemonReplacementCoordinator {
  private phase: 'active' | 'draining' = 'active';
  private admissions = 0;

  async withAdmission<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.phase === 'draining') throw new DaemonDrainingError();
    this.admissions++;
    try {
      return await action();
    } finally {
      this.admissions--;
    }
  }

  prepare(
    expected: DaemonReplacementIdentity,
    actual: DaemonReplacementIdentity,
    trackedChildren: number,
  ): { reserved: true } | { reserved: false; reason: DaemonReplacementRefusal } {
    if (this.phase === 'draining') return { reserved: false, reason: 'already-draining' };
    if (!sameIdentity(expected, actual)) return { reserved: false, reason: 'identity-mismatch' };
    if (trackedChildren > 0) return { reserved: false, reason: 'active-children' };
    if (this.admissions > 0) return { reserved: false, reason: 'admission-in-flight' };
    this.phase = 'draining';
    return { reserved: true };
  }

  isDraining(): boolean {
    return this.phase === 'draining';
  }
}
