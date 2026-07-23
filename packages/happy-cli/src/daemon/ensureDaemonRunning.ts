import { getLatestDaemonLog, logger } from '@/ui/logger'
import {
  checkIfDaemonRunningAndCleanupStaleState,
  isDaemonRunningCurrentlyInstalledHappyVersion,
  prepareDaemonReplacement,
  waitForProcessDeath,
} from './controlClient'
import { spawnHappyCLI } from '@/utils/spawnHappyCLI'
import { readDaemonState } from '@/persistence'

export const DAEMON_READY_TIMEOUT_MS = 60_000
export const DAEMON_READY_POLL_INTERVAL_MS = 100

export async function ensureDaemonRunning(
  options: { requireIdleForReplacement?: boolean } = {},
): Promise<void> {
  logger.debug('Ensuring Happy background service is running & matches our version...')

  if (await isDaemonRunningCurrentlyInstalledHappyVersion()) {
    return
  }
  if (options.requireIdleForReplacement
    && await checkIfDaemonRunningAndCleanupStaleState()) {
    // A compatible daemon may have won startup after our first check.
    if (await isDaemonRunningCurrentlyInstalledHappyVersion()) return
    const oldState = await readDaemonState()
    if (!oldState) {
      throw new Error('Running Happy daemon replacement identity is unavailable')
    }
    const reservation = await prepareDaemonReplacement(oldState)
    if (!reservation.reserved) {
      throw new Error(
        reservation.reason === 'active-children' || reservation.reason === 'admission-in-flight'
          ? 'Running Happy daemon uses a different payload and is busy'
          : 'Running Happy daemon replacement could not be reserved',
      )
    }
    const reservedState = await readDaemonState()
    if (reservedState && reservedState.pid !== oldState.pid) {
      if (await isDaemonRunningCurrentlyInstalledHappyVersion()) return
      throw new Error('Running Happy daemon ownership changed during replacement')
    }
    try {
      await waitForProcessDeath(oldState.pid, 10_000)
    } catch {
      throw new Error('Running Happy daemon did not relinquish ownership after replacement reservation')
    }
    const postDrainState = await readDaemonState()
    if (postDrainState && postDrainState.pid !== oldState.pid) {
      if (await isDaemonRunningCurrentlyInstalledHappyVersion()) return
      throw new Error('Running Happy daemon ownership changed during replacement')
    }
  }

  logger.debug('Starting Happy background service...')

  const daemonEnv = options.requireIdleForReplacement
    ? { ...process.env, HAPPY_DAEMON_ROUTED_HANDOFF: '1' }
    : process.env
  const daemonProcess = spawnHappyCLI(['daemon', 'start-sync'], {
    detached: true,
    stdio: 'ignore',
    env: daemonEnv,
  })
  daemonProcess.unref()

  // Wait for the spawned daemon to be fully ready: it must write daemon.state.json,
  // bind its HTTP port, and respond to a health ping. Without this, early callers
  // (e.g. notifyDaemonSessionStarted) race the daemon startup and the webhook is
  // silently lost — which later breaks resume-happy-session.
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isDaemonRunningCurrentlyInstalledHappyVersion()) {
      logger.debug('Happy background service is ready')
      return
    }
    await new Promise(resolve => setTimeout(resolve, DAEMON_READY_POLL_INTERVAL_MS))
  }

  const latestDaemonLog = await getLatestDaemonLog()
  const logDiagnostics = options.requireIdleForReplacement
    ? (latestDaemonLog
      ? 'A daemon log is available through "happy daemon logs".'
      : 'No daemon log was found; run "happy daemon logs" after retrying.')
    : latestDaemonLog
      ? `Daemon log: ${latestDaemonLog.path}.`
    : 'No daemon log was found; run "happy daemon logs" after retrying.'
  const errorMessage = `Happy background service did not become ready within ${DAEMON_READY_TIMEOUT_MS / 1000} seconds. ${logDiagnostics} Run "happy doctor" for diagnostics.`
  logger.debug(errorMessage)
  throw new Error(errorMessage)
}
