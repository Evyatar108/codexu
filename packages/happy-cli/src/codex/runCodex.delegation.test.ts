import { describe, it, expect, vi, beforeEach } from 'vitest';

// M1-S6 / R4b thin-seam proof. `runCodex` is now a behavior-preserving thin wrapper
// whose only job is to delegate verbatim to the relocated fork hook
// `fork/onCodexRun.onCodexRun` (the full codex agent-loop body lives there). The
// existing black-box codex suites (runCodex.fork.test.ts, runCodex.turnLifecycle.test.ts,
// etc.) prove the moved body still behaves identically because their overlay mocks
// resolve to the same absolute modules; this focused test proves the seam forwards
// the exact opts object with no mutation.
vi.mock('@/fork/onCodexRun', () => ({
  onCodexRun: vi.fn(async () => {}),
}));

import { runCodex } from './runCodex';
import { onCodexRun } from '@/fork/onCodexRun';

describe('runCodex thin seam (M1-S6 / R4b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates verbatim to fork/onCodexRun with the same opts reference', async () => {
    const opts = { sessionId: 's1', model: 'codex-x', startedBy: 'terminal' } as any;
    await runCodex(opts);
    expect(onCodexRun).toHaveBeenCalledTimes(1);
    expect(onCodexRun).toHaveBeenCalledWith(opts);
    expect(vi.mocked(onCodexRun).mock.calls[0][0]).toBe(opts);
  });

  it('returns the promise produced by fork/onCodexRun', async () => {
    const sentinel = Promise.resolve();
    vi.mocked(onCodexRun).mockReturnValueOnce(sentinel);
    const returned = runCodex({} as any);
    expect(returned).toBe(sentinel);
    await returned;
  });
});
