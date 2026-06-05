import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  mockAuthAndSetupMachineIfNeeded: vi.fn(),
  mockRunCodex: vi.fn(),
  mockExtractCodexArgFlag: vi.fn(),
  mockExtractCodexEffortFlag: vi.fn(),
  mockExtractCodexModelFlag: vi.fn(),
  mockExtractCodexPermissionModeFlag: vi.fn(),
  mockExtractCodexProjectDocFlag: vi.fn(),
  mockExtractCodexResumeFlag: vi.fn(),
  mockExtractCodexTransportFlag: vi.fn(),
  mockExtractNoSandboxFlag: vi.fn(),
  mockEnsureDaemonRunning: vi.fn(),
}))

vi.mock('@/ui/auth', () => ({
  authAndSetupMachineIfNeeded: mocks.mockAuthAndSetupMachineIfNeeded,
}))

vi.mock('@/codex/runCodex', () => ({
  runCodex: mocks.mockRunCodex,
}))

vi.mock('@/codex/cliArgs', () => ({
  extractCodexArgFlag: mocks.mockExtractCodexArgFlag,
  extractCodexEffortFlag: mocks.mockExtractCodexEffortFlag,
  extractCodexModelFlag: mocks.mockExtractCodexModelFlag,
  extractCodexPermissionModeFlag: mocks.mockExtractCodexPermissionModeFlag,
  extractCodexProjectDocFlag: mocks.mockExtractCodexProjectDocFlag,
  extractCodexResumeFlag: mocks.mockExtractCodexResumeFlag,
  extractCodexTransportFlag: mocks.mockExtractCodexTransportFlag,
}))

vi.mock('@/utils/sandboxFlags', () => ({
  extractNoSandboxFlag: mocks.mockExtractNoSandboxFlag,
}))

vi.mock('@/daemon/ensureDaemonRunning', () => ({
  ensureDaemonRunning: mocks.mockEnsureDaemonRunning,
}))

async function importCommand(homeDir?: string): Promise<typeof import('./codexCommand')> {
  vi.resetModules()
  if (homeDir !== undefined) {
    process.env.HAPPY_HOME_DIR = homeDir
  }
  return import('./codexCommand')
}

describe('handleCodexCommand', () => {
  let tempRoot: string | undefined
  let previousHappyHomeDir: string | undefined
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    previousHappyHomeDir = process.env.HAPPY_HOME_DIR
    process.exitCode = undefined
    tempRoot = undefined
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mocks.mockAuthAndSetupMachineIfNeeded.mockResolvedValue({
      credentials: { token: 'token' },
    })
    mocks.mockExtractNoSandboxFlag.mockImplementation((args: string[]) => ({
      noSandbox: false,
      args,
    }))
    mocks.mockExtractCodexResumeFlag.mockImplementation((args: string[]) => ({
      resumeThreadId: null,
      args,
    }))
    mocks.mockExtractCodexEffortFlag.mockImplementation((args: string[]) => ({
      effortLevel: undefined,
      args,
    }))
    mocks.mockExtractCodexModelFlag.mockImplementation((args: string[]) => ({
      model: undefined,
      args,
    }))
    mocks.mockExtractCodexPermissionModeFlag.mockImplementation((args: string[]) => ({
      permissionMode: undefined,
      args,
    }))
    mocks.mockExtractCodexProjectDocFlag.mockImplementation((args: string[]) => ({
      projectDocFallback: [],
      args,
    }))
    mocks.mockExtractCodexTransportFlag.mockImplementation((args: string[]) => ({
      transport: undefined,
      args,
    }))
    mocks.mockExtractCodexArgFlag.mockImplementation((args: string[]) => ({
      codexArgs: [],
      args,
    }))
    mocks.mockEnsureDaemonRunning.mockResolvedValue(undefined)
    mocks.mockRunCodex.mockResolvedValue(undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    if (previousHappyHomeDir === undefined) {
      delete process.env.HAPPY_HOME_DIR
    } else {
      process.env.HAPPY_HOME_DIR = previousHappyHomeDir
    }
    if (tempRoot !== undefined) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
    vi.resetModules()
  })

  function tempHome(): string {
    tempRoot = mkdtempSync(join(tmpdir(), 'happy-codex-command-'))
    const homeDir = join(tempRoot, 'home')
    mkdirSync(homeDir, { recursive: true })
    return homeDir
  }

  it('ensures the daemon is running before starting a codex session', async () => {
    const { handleCodexCommand } = await importCommand()

    await handleCodexCommand(['--started-by', 'terminal'])

    expect(mocks.mockEnsureDaemonRunning).toHaveBeenCalledTimes(1)
    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: 'terminal',
      noSandbox: false,
      resumeThreadId: undefined,
      effortLevel: undefined,
      model: undefined,
      permissionMode: undefined,
      projectDocFallback: undefined,
      codexTransport: undefined,
      codexAppServerArgs: undefined,
    })
    expect(
      mocks.mockEnsureDaemonRunning.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.mockRunCodex.mock.invocationCallOrder[0])
  })

  it('passes parsed no-sandbox and resume flags through to runCodex', async () => {
    const { handleCodexCommand } = await importCommand()

    mocks.mockExtractNoSandboxFlag.mockReturnValue({
      noSandbox: true,
      args: ['--resume', 'thread-123', '--started-by', 'daemon'],
    })
    mocks.mockExtractCodexResumeFlag.mockReturnValue({
      resumeThreadId: 'thread-123',
      args: ['--effort', 'high', '--codex-transport', 'ws', '--started-by', 'daemon'],
    })
    mocks.mockExtractCodexEffortFlag.mockReturnValue({
      effortLevel: 'high',
      args: ['--model', 'o3', '--codex-transport', 'ws', '--started-by', 'daemon'],
    })
    mocks.mockExtractCodexModelFlag.mockReturnValue({
      model: 'o3',
      args: ['--permission-mode', 'safe-yolo', '--codex-transport', 'ws', '--started-by', 'daemon'],
    })
    mocks.mockExtractCodexPermissionModeFlag.mockReturnValue({
      permissionMode: 'safe-yolo',
      args: ['--codex-project-doc', 'PROJECT.md', '--codex-transport', 'ws', '--started-by', 'daemon'],
    })
    mocks.mockExtractCodexProjectDocFlag.mockReturnValue({
      projectDocFallback: ['PROJECT.md'],
      args: ['--codex-transport', 'ws', '--started-by', 'daemon'],
    })
    mocks.mockExtractCodexTransportFlag.mockReturnValue({
      transport: 'ws',
      args: ['--started-by', 'daemon'],
    })

    await handleCodexCommand(['--no-sandbox', '--resume', 'thread-123', '--model', 'o3', '--permission-mode', 'safe-yolo', '--codex-transport', 'ws', '--started-by', 'daemon'])

    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: 'daemon',
      noSandbox: true,
      resumeThreadId: 'thread-123',
      effortLevel: 'high',
      model: 'o3',
      permissionMode: 'safe-yolo',
      projectDocFallback: ['PROJECT.md'],
      codexTransport: 'ws',
      codexAppServerArgs: undefined,
    })

    expect(mocks.mockExtractCodexProjectDocFlag).toHaveBeenCalledWith([
      '--codex-project-doc',
      'PROJECT.md',
      '--codex-transport',
      'ws',
      '--started-by',
      'daemon',
    ])
    expect(mocks.mockExtractCodexTransportFlag).toHaveBeenCalledWith(['--codex-transport', 'ws', '--started-by', 'daemon'])
  })

  it('routes doctor before auth, daemon startup, or codex flag parsing', async () => {
    const homeDir = tempHome()
    const { handleCodexCommand } = await importCommand(homeDir)

    await handleCodexCommand(['doctor'])

    expect(process.exitCode).toBe(2)
    expect(mocks.mockAuthAndSetupMachineIfNeeded).not.toHaveBeenCalled()
    expect(mocks.mockEnsureDaemonRunning).not.toHaveBeenCalled()
    expect(mocks.mockRunCodex).not.toHaveBeenCalled()
    expect(mocks.mockExtractNoSandboxFlag).not.toHaveBeenCalled()
  })

  it('routes doctor with unknown flags before codex flag parsing', async () => {
    const homeDir = tempHome()
    const { handleCodexCommand } = await importCommand(homeDir)

    await handleCodexCommand(['doctor', '--some-unknown-flag'])

    expect(process.exitCode).toBe(2)
    expect(mocks.mockAuthAndSetupMachineIfNeeded).not.toHaveBeenCalled()
    expect(mocks.mockEnsureDaemonRunning).not.toHaveBeenCalled()
    expect(mocks.mockRunCodex).not.toHaveBeenCalled()
    expect(mocks.mockExtractNoSandboxFlag).not.toHaveBeenCalled()
  })

  it('routes status before auth, daemon startup, or codex flag parsing', async () => {
    const homeDir = tempHome()
    const { handleCodexCommand } = await importCommand(homeDir)

    await handleCodexCommand(['status'])

    expect(process.exitCode).toBe(2)
    expect(mocks.mockAuthAndSetupMachineIfNeeded).not.toHaveBeenCalled()
    expect(mocks.mockEnsureDaemonRunning).not.toHaveBeenCalled()
    expect(mocks.mockRunCodex).not.toHaveBeenCalled()
    expect(mocks.mockExtractNoSandboxFlag).not.toHaveBeenCalled()
  })

  it('routes status with unknown flags before codex flag parsing', async () => {
    const homeDir = tempHome()
    const { handleCodexCommand } = await importCommand(homeDir)

    await handleCodexCommand(['status', '--some-unknown-flag'])

    expect(process.exitCode).toBe(2)
    expect(mocks.mockAuthAndSetupMachineIfNeeded).not.toHaveBeenCalled()
    expect(mocks.mockEnsureDaemonRunning).not.toHaveBeenCalled()
    expect(mocks.mockRunCodex).not.toHaveBeenCalled()
    expect(mocks.mockExtractNoSandboxFlag).not.toHaveBeenCalled()
  })
})
