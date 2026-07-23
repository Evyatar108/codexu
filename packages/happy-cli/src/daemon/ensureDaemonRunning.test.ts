import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockLoggerDebug: vi.fn(),
  mockIsDaemonRunningCurrentlyInstalledHappyVersion: vi.fn(),
  mockCheckIfDaemonRunningAndCleanupStaleState: vi.fn(),
  mockDaemonHasTrackedChildren: vi.fn(),
  mockSpawnHappyCLI: vi.fn(),
  mockGetLatestDaemonLog: vi.fn(),
}))

vi.mock('./controlClient', () => ({
  isDaemonRunningCurrentlyInstalledHappyVersion: mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion,
  checkIfDaemonRunningAndCleanupStaleState: mocks.mockCheckIfDaemonRunningAndCleanupStaleState,
  daemonHasTrackedChildren: mocks.mockDaemonHasTrackedChildren,
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
    mocks.mockDaemonHasTrackedChildren.mockResolvedValue(false)
  })

  it('refuses artifact replacement while the old daemon owns sessions', async () => {
    mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion.mockResolvedValue(false)
    mocks.mockCheckIfDaemonRunningAndCleanupStaleState.mockResolvedValue(true)
    mocks.mockDaemonHasTrackedChildren.mockResolvedValue(true)

    await expect(ensureDaemonRunning({ requireIdleForReplacement: true }))
      .rejects.toThrow('different payload')
    expect(mocks.mockSpawnHappyCLI).not.toHaveBeenCalled()
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
    mocks.mockDaemonHasTrackedChildren.mockResolvedValue(false)
    mocks.mockGetLatestDaemonLog.mockResolvedValue({
      file: '2026-07-15-daemon.log',
      path: 'C:\\private\\happy-home\\logs\\2026-07-15-daemon.log',
      modified: new Date(),
    })

    const startup = ensureDaemonRunning({ requireIdleForReplacement: true })
    const rejection = expect(startup).rejects.not.toThrow('C:\\private')
    await vi.advanceTimersByTimeAsync(60_000)
    await rejection
  })
})
