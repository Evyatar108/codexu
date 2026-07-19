import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  daemon: vi.fn(),
  run: vi.fn(),
}));

vi.mock('@/ui/auth', () => ({ authAndSetupMachineIfNeeded: mocks.auth }));
vi.mock('@/daemon/ensureDaemonRunning', () => ({ ensureDaemonRunning: mocks.daemon }));
vi.mock('@/agent/copilot/runCopilotMirror', () => ({ runCopilotMirror: mocks.run }));

import { handleCopilotCommand } from './copilotCommand';

describe('handleCopilotCommand', () => {
  const original = process.env.HAPPY_ENABLE_COPILOT_NATIVE;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ credentials: { token: 'token' }, machineId: 'machine-1' });
  });
  afterEach(() => {
    if (original === undefined) delete process.env.HAPPY_ENABLE_COPILOT_NATIVE;
    else process.env.HAPPY_ENABLE_COPILOT_NATIVE = original;
  });

  it('is default-off before auth or daemon startup', async () => {
    delete process.env.HAPPY_ENABLE_COPILOT_NATIVE;
    await expect(handleCopilotCommand([])).rejects.toThrow('disabled');
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.daemon).not.toHaveBeenCalled();
  });

  it('authenticates, starts the daemon, and dispatches the mirror when enabled', async () => {
    process.env.HAPPY_ENABLE_COPILOT_NATIVE = '1';
    await handleCopilotCommand(['--started-by', 'terminal']);
    expect(mocks.daemon).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      machineId: 'machine-1',
      startedBy: 'terminal',
    });
  });
});
