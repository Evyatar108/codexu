import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockLoggerDebug: vi.fn(),
  mockIsDaemonRunningCurrentlyInstalledHappyVersion: vi.fn(),
  mockCheckIfDaemonRunningAndCleanupStaleState: vi.fn(),
  mockPrepareDaemonReplacement: vi.fn(),
  mockWaitForProcessDeath: vi.fn(),
  mockReadDaemonState: vi.fn(),
  mockSpawnHappyCLI: vi.fn(),
  mockGetLatestDaemonLog: vi.fn(),
}))

vi.mock('./controlClient', () => ({
  isDaemonRunningCurrentlyInstalledHappyVersion: mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion,
  checkIfDaemonRunningAndCleanupStaleState: mocks.mockCheckIfDaemonRunningAndCleanupStaleState,
  prepareDaemonReplacement: mocks.mockPrepareDaemonReplacement,
  waitForProcessDeath: mocks.mockWaitForProcessDeath,
}))

vi.mock('@/persistence', () => ({
  readDaemonState: mocks.mockReadDaemonState,
}))

vi.mock('@/utils/spawnHappyCLI', () => ({
  spawnHappyCLI: mocks.mockSpawnHappyCLI,
}))

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: mocks.mockLoggerDebug,
  },
  getLatestDaemonLog: mocks.mockGetLatestDaemonLog,
}))

import { ensureDaemonRunning } from './ensureDaemonRunning'

describe('ensureDaemonRunning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockSpawnHappyCLI.mockReturnValue({
      unref: vi.fn(),
    })
    mocks.mockCheckIfDaemonRunningAndCleanupStaleState.mockResolvedValue(true)
    mocks.mockGetLatestDaemonLog.mockResolvedValue(null)
    mocks.mockReadDaemonState.mockResolvedValue({
      pid: 123,
      httpPort: 4321,
      startedWithCliVersion: 'old',
      startedWithPayloadArtifactId: 'old-artifact',
      startedWithPayloadManifestSha256: 'A'.repeat(64),
    })
    mocks.mockPrepareDaemonReplacement.mockResolvedValue({ reserved: true })
    mocks.mockWaitForProcessDeath.mockResolvedValue(undefined)
  })

  it('refuses artifact replacement when the old daemon declines the reservation', async () => {
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockResolvedValue(false)
    mocks.mockCheckIfDaemonRunningAndCleanupStaleState.mockResolvedValue(true)
    mocks.mockPrepareDaemonReplacement.mockResolvedValue({
      reserved: false,
      reason: 'active-children',
    })

    await expect(ensureDaemonRunning({ requireIdleForReplacement: true }))
      .rejects.toThrow('busy')
    expect(mocks.mockSpawnHappyCLI).not.toHaveBeenCalled()
  })

  it('does not spawn until the reserved old daemon relinquishes ownership', async () => {
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockResolvedValue(false)
    let rejectDeath!: (error: Error) => void
    mocks.mockWaitForProcessDeath.mockReturnValue(new Promise<void>((_resolve, reject) => {
      rejectDeath = reject
    }))

    const startup = ensureDaemonRunning({ requireIdleForReplacement: true })
    await vi.waitFor(() => expect(mocks.mockPrepareDaemonReplacement).toHaveBeenCalledOnce())
    expect(mocks.mockSpawnHappyCLI).not.toHaveBeenCalled()
    rejectDeath(new Error('still alive'))

    await expect(startup).rejects.toThrow('did not relinquish ownership')
    expect(mocks.mockSpawnHappyCLI).not.toHaveBeenCalled()
  })

  it('refuses when daemon ownership changes after reservation', async () => {
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockResolvedValue(false)
    mocks.mockReadDaemonState
      .mockResolvedValueOnce({
        pid: 123,
        httpPort: 4321,
        startedWithCliVersion: 'old',
        startedWithPayloadArtifactId: 'old-artifact',
        startedWithPayloadManifestSha256: 'A'.repeat(64),
      })
      .mockResolvedValueOnce({
        pid: 456,
        httpPort: 5432,
        startedWithCliVersion: 'unexpected',
        startedWithPayloadArtifactId: 'unexpected-artifact',
        startedWithPayloadManifestSha256: 'B'.repeat(64),
      })

    await expect(ensureDaemonRunning({ requireIdleForReplacement: true }))
      .rejects.toThrow('ownership changed')
    expect(mocks.mockWaitForProcessDeath).not.toHaveBeenCalled()
    expect(mocks.mockSpawnHappyCLI).not.toHaveBeenCalled()
  })

  it('replaces an idle ordinary version-only daemon through its exact reservation', async () => {
    const ordinaryState = {
      pid: 123,
      httpPort: 4321,
      startedWithCliVersion: 'old',
    }
    mocks.mockReadDaemonState.mockResolvedValue(ordinaryState)
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    await ensureDaemonRunning({ requireIdleForReplacement: true })

    expect(mocks.mockPrepareDaemonReplacement).toHaveBeenCalledWith(ordinaryState)
    expect(mocks.mockWaitForProcessDeath).toHaveBeenCalledWith(123, 10_000)
    expect(mocks.mockSpawnHappyCLI).toHaveBeenCalledWith(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
      env: expect.objectContaining({ HAPPY_DAEMON_ROUTED_HANDOFF: '1' }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns without spawning when the daemon is already running', async () => {
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockResolvedValue(true)

    await ensureDaemonRunning()

    expect(mocks.mockSpawnHappyCLI).not.toHaveBeenCalled()
    expect(mocks.mockCheckIfDaemonRunningAndCleanupStaleState).not.toHaveBeenCalled()
    expect(mocks.mockLoggerDebug).toHaveBeenCalledWith(
      'Ensuring Happy background service is running & matches our version...',
    )
  })

  it('starts the daemon and waits for readiness when the installed version is not running', async () => {
    const mockUnref = vi.fn()
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockResolvedValue(false)
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    mocks.mockSpawnHappyCLI.mockReturnValue({
      unref: mockUnref,
    })

    await ensureDaemonRunning()

    expect(mocks.mockSpawnHappyCLI).toHaveBeenCalledWith(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    })
    expect(mockUnref).toHaveBeenCalled()
    expect(mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion).toHaveBeenCalledTimes(2)
    expect(mocks.mockLoggerDebug).toHaveBeenCalledWith('Starting Happy background service...')
    expect(mocks.mockLoggerDebug).toHaveBeenCalledWith('Happy background service is ready')
  })

  it('allows a pristine embedded database more than five seconds to initialize', async () => {
    vi.useFakeTimers()
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockResolvedValue(false)
    let readinessChecks = 0
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockImplementation(async () => {
      readinessChecks++
      return readinessChecks === 52
    })

    const startup = ensureDaemonRunning()
    await vi.advanceTimersByTimeAsync(5_200)
    await startup

    expect(readinessChecks).toBe(52)
    expect(mocks.mockLoggerDebug).toHaveBeenCalledWith('Happy background service is ready')
  })

  it('rejects with the daemon log path when automatic startup times out', async () => {
    vi.useFakeTimers()
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockResolvedValue(false)
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockResolvedValue(false)
    mocks.mockGetLatestDaemonLog.mockResolvedValue({
      file: '2026-07-15-daemon.log',
      path: 'C:\\happy-home\\logs\\2026-07-15-daemon.log',
      modified: new Date(),
    })

    const startup = ensureDaemonRunning()
    const rejection = expect(startup).rejects.toThrow(
      'C:\\happy-home\\logs\\2026-07-15-daemon.log',
    )
    await vi.advanceTimersByTimeAsync(60_000)
    await rejection
  })

  it('redacts the daemon log path for verified routed startup failures', async () => {
    vi.useFakeTimers()
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockResolvedValue(false)
    mocks.mockCheckIfDaemonRunningAndCleanupStaleState.mockResolvedValue(true)
    mocks.mockPrepareDaemonReplacement.mockResolvedValue({ reserved: true })
    mocks.mockGetLatestDaemonLog.mockResolvedValue({
      file: '2026-07-15-daemon.log',
      path: 'C:\\private\\happy-home\\logs\\2026-07-15-daemon.log',
      modified: new Date(),
    })

    const startup = ensureDaemonRunning({ requireIdleForReplacement: true })
    const rejection = expect(startup).rejects.not.toThrow('C:\\private')
    await vi.advanceTimersByTimeAsync(60_000)
    await rejection
    expect(mocks.mockSpawnHappyCLI).toHaveBeenCalledWith(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
      env: expect.objectContaining({ HAPPY_DAEMON_ROUTED_HANDOFF: '1' }),
    })
  })
})
