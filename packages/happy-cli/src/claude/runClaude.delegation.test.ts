import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Credentials } from '@/persistence';

// M1-S7 / R4c-i thin-seam proof. `runClaude` is now a behavior-preserving thin
// wrapper whose only job is to delegate verbatim to the relocated fork hook
// `fork/onClaudeRun.onClaudeRun` (the full claude agent-loop body lives there). The
// existing black-box claude suites (runClaude.test.ts, runClaudePublishMode.test.ts)
// prove the moved body still behaves identically because their overlay mocks resolve
// to the same absolute modules; this focused test proves the seam forwards the exact
// credentials + options with no mutation and applies the default options object.
vi.mock('@/fork/onClaudeRun', () => ({
  onClaudeRun: vi.fn(async () => {}),
}));
// `./loop` is only referenced by the wrapper for the `PermissionMode` type; mock it so
// the heavy agent-loop graph is not pulled into this focused seam test.
vi.mock('./loop', () => ({}));

import { runClaude } from './runClaude';
import { onClaudeRun } from '@/fork/onClaudeRun';

describe('runClaude thin seam (M1-S7 / R4c-i)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates verbatim to fork/onClaudeRun with the same credentials + options', async () => {
    const credentials = { token: 't', secret: new Uint8Array() } as unknown as Credentials;
    const options = { model: 'claude-x', startedBy: 'daemon' as const };
    await runClaude(credentials, options);
    expect(onClaudeRun).toHaveBeenCalledTimes(1);
    const call = vi.mocked(onClaudeRun).mock.calls[0];
    expect(call[0]).toBe(credentials);
    expect(call[1]).toBe(options);
  });

  it('passes the default (empty) options object when none provided', async () => {
    const credentials = {} as unknown as Credentials;
    await runClaude(credentials);
    expect(onClaudeRun).toHaveBeenCalledTimes(1);
    const call = vi.mocked(onClaudeRun).mock.calls[0];
    expect(call[0]).toBe(credentials);
    expect(call[1]).toEqual({});
  });
});
