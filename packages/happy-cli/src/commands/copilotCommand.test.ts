import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  daemon: vi.fn(),
  run: vi.fn(),
  readContext: vi.fn(),
  initializeStatus: vi.fn(),
  markFailedBeforeOwnership: vi.fn(),
}));

vi.mock('@/ui/auth', () => ({ authAndSetupMachineIfNeeded: mocks.auth }));
vi.mock('@/daemon/ensureDaemonRunning', () => ({ ensureDaemonRunning: mocks.daemon }));
vi.mock('@/agent/copilot/runCopilotMirror', () => ({ runCopilotMirror: mocks.run }));
vi.mock('@/agent/copilot/launchContext', () => ({
  readEvCopilotLaunchContext: mocks.readContext,
  initializeLaunchStatus: mocks.initializeStatus,
  markLaunchFailedBeforeOwnership: mocks.markFailedBeforeOwnership,
}));

import { handleCopilotCommand } from './copilotCommand';

describe('handleCopilotCommand', () => {
  const original = process.env.HAPPY_ENABLE_COPILOT_NATIVE;
  const originalBinary = process.env.HAPPY_COPILOT_BINARY;
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HAPPY_COPILOT_BINARY;
    mocks.auth.mockResolvedValue({ credentials: { token: 'token' }, machineId: 'machine-1' });
    mocks.readContext.mockResolvedValue({ invocationId: 'invocation-1' });
  });
  afterEach(() => {
    if (original === undefined) delete process.env.HAPPY_ENABLE_COPILOT_NATIVE;
    else process.env.HAPPY_ENABLE_COPILOT_NATIVE = original;
    if (originalBinary === undefined) delete process.env.HAPPY_COPILOT_BINARY;
    else process.env.HAPPY_COPILOT_BINARY = originalBinary;
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
    expect(mocks.daemon).toHaveBeenCalledWith({ requireIdleForReplacement: false });
    expect(mocks.run).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      machineId: 'machine-1',
      startedBy: 'terminal',
      launchContext: undefined,
    });
  });

  it('validates and initializes a production context before auth and requires idle replacement', async () => {
    process.env.HAPPY_ENABLE_COPILOT_NATIVE = '1';
    await handleCopilotCommand(['--started-by', 'terminal', '--launch-context', 'C:\\run\\launch-context.json']);
    expect(mocks.readContext).toHaveBeenCalledWith('C:\\run\\launch-context.json');
    expect(mocks.initializeStatus).toHaveBeenCalledWith({ invocationId: 'invocation-1' });
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.daemon).toHaveBeenCalledWith({ requireIdleForReplacement: true });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      launchContext: { invocationId: 'invocation-1' },
    }));
  });

  it('records a stable pre-ownership failure without masking the primary error', async () => {
    process.env.HAPPY_ENABLE_COPILOT_NATIVE = '1';
    mocks.daemon.mockRejectedValueOnce(new Error('daemon unavailable'));
    mocks.markFailedBeforeOwnership.mockRejectedValueOnce(new Error('status unavailable'));

    await expect(handleCopilotCommand(['--launch-context', 'C:\\run\\launch-context.json']))
      .rejects.toThrow('daemon unavailable');
    expect(mocks.markFailedBeforeOwnership).toHaveBeenCalledWith(
      { invocationId: 'invocation-1' },
      'startup-failure',
    );
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('rejects a development binary mixed with a verified launch context', async () => {
    process.env.HAPPY_ENABLE_COPILOT_NATIVE = '1';
    process.env.HAPPY_COPILOT_BINARY = 'C:\\dev\\copilot.exe';
    try {
      await expect(handleCopilotCommand(['--launch-context', 'C:\\run\\launch-context.json']))
        .rejects.toThrow('cannot be combined');
      expect(mocks.readContext).not.toHaveBeenCalled();
      expect(mocks.auth).not.toHaveBeenCalled();
    } finally {
      if (originalBinary === undefined) delete process.env.HAPPY_COPILOT_BINARY;
      else process.env.HAPPY_COPILOT_BINARY = originalBinary;
    }
  });
});
