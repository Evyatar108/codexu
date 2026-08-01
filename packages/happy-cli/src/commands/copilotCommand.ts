/**
 * First-token entry point for the opt-in native Copilot read-only mirror.
 */

import { ensureDaemonRunning } from '@/daemon/ensureDaemonRunning';
import { runCopilotMirror } from '@/agent/copilot/runCopilotMirror';
import { authAndSetupMachineIfNeeded } from '@/ui/auth';
import {
  initializeLaunchStatus,
  markLaunchFailedBeforeOwnership,
  readEvCopilotLaunchContext,
  type EvCopilotHappyLaunchContextV1,
} from '@/agent/copilot/launchContext';

function enabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function parseAttachPid(value: string, source: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`Invalid ${source} PID`);
  const pid = Number(value);
  if (!Number.isSafeInteger(pid)) throw new Error(`Invalid ${source} PID`);
  return pid;
}

function attachFromEnvironment(value: string | undefined): { pid?: number } | undefined {
  if (!value || value === '0' || value.toLowerCase() === 'false') return undefined;
  if (value === '1' || value.toLowerCase() === 'true') return {};
  return { pid: parseAttachPid(value, 'HAPPY_COPILOT_ATTACH_UI_SERVER') };
}

export async function handleCopilotCommand(args: string[]): Promise<void> {
  if (!enabled(process.env.HAPPY_ENABLE_COPILOT_NATIVE)) {
    throw new Error('Native Copilot mirror is disabled. Set HAPPY_ENABLE_COPILOT_NATIVE=1 to enable it.');
  }

  let startedBy: 'daemon' | 'terminal' | undefined;
  let launchContextPath: string | undefined;
  let attachUiServer: { pid?: number } | undefined;
  let attachFlagSeen = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--started-by') {
      const value = args[++index];
      if (value !== 'daemon' && value !== 'terminal') throw new Error('Invalid --started-by value');
      startedBy = value;
      continue;
    }
    if (arg === '--launch-context') {
      const value = args[++index];
      if (!value || launchContextPath) throw new Error('Invalid --launch-context value');
      launchContextPath = value;
      continue;
    }
    if (arg === '--attach-ui-server') {
      if (attachFlagSeen) throw new Error('--attach-ui-server may only be specified once');
      attachFlagSeen = true;
      const value = args[index + 1];
      attachUiServer = value && !value.startsWith('--')
        ? { pid: parseAttachPid(args[++index], '--attach-ui-server') }
        : {};
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: HAPPY_ENABLE_COPILOT_NATIVE=1 happy copilot [--started-by terminal|daemon] [--attach-ui-server [pid]] [--launch-context <local-file>]');
      return;
    }
    throw new Error('Unknown copilot argument');
  }
  if (!attachFlagSeen) attachUiServer = attachFromEnvironment(process.env.HAPPY_COPILOT_ATTACH_UI_SERVER);
  if (attachUiServer && launchContextPath) {
    throw new Error('--attach-ui-server cannot be combined with --launch-context');
  }

  let launchContext: EvCopilotHappyLaunchContextV1 | undefined;
  if (launchContextPath) {
    if (process.env.HAPPY_COPILOT_BINARY) {
      throw new Error('HAPPY_COPILOT_BINARY cannot be combined with --launch-context');
    }
    launchContext = await readEvCopilotLaunchContext(launchContextPath);
    await initializeLaunchStatus(launchContext);
  }
  try {
    const { credentials, machineId } = await authAndSetupMachineIfNeeded();
    await ensureDaemonRunning({ requireIdleForReplacement: launchContext !== undefined });
    await runCopilotMirror({
      credentials,
      machineId,
      startedBy,
      launchContext,
      ...(attachUiServer ? { attachUiServer } : {}),
    });
  } catch (error) {
    if (launchContext) {
      await markLaunchFailedBeforeOwnership(launchContext, 'startup-failure').catch(() => undefined);
    }
    throw error;
  }
}
