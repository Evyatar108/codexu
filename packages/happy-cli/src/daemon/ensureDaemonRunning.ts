import { getLatestDaemonLog, logger } from '@/ui/logger'
import {
  checkIfDaemonRunningAndCleanupStaleState,
  daemonHasTrackedChildren,
  isDaemonRunningCurrentlyInstalledHappyVersion,
} from './controlClient'
import { spawnHappyCLI } from '@/utils/spawnHappyCLI'

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
    && await checkIfDaemonRunningAndCleanupStaleState()
    && await daemonHasTrackedChildren()) {
    throw new Error('Running Happy daemon uses a different payload and still owns active sessions')
  }

  logger.debug('Starting Happy background service...')

  const daemonProcess = spawnHappyCLI(['daemon', 'start-sync'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
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
