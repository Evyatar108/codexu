export { runCopilotMirror } from './runCopilotMirror';
export {
  initializeLaunchStatus,
  launchContextProvenance,
  markLaunchCompleted,
  markLaunchFailedBeforeOwnership,
  markLaunchOwned,
  readEvCopilotLaunchContext,
} from './launchContext';
export { CopilotEventRelay } from './eventRelay';
export { projectNativeEvent, createProjectionState, stableCopilotId } from './eventProjection';
export { spawnManagedTarget, validateRegistryEntry } from './managedServer';
export { NativeLocalRpcClient } from './nativeLocalRpcClient';
export {
  CopilotSteeringClient,
  COPILOT_ACTION_RETRY_WINDOW_MS,
  COPILOT_ANSWER_RATE_LIMIT,
  COPILOT_ANSWER_RATE_LIMIT_WINDOW_MS,
  COPILOT_HEARTBEAT_INTERVAL_MS,
  COPILOT_LEASE_TTL_MS,
} from './steeringClient';
