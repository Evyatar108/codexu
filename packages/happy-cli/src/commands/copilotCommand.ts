/**
 * First-token entry point for the opt-in native Copilot read-only mirror.
 */

import { ensureDaemonRunning } from '@/daemon/ensureDaemonRunning';
import { runCopilotMirror } from '@/agent/copilot/runCopilotMirror';
import { authAndSetupMachineIfNeeded } from '@/ui/auth';

function enabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export async function handleCopilotCommand(args: string[]): Promise<void> {
  if (!enabled(process.env.HAPPY_ENABLE_COPILOT_NATIVE)) {
    throw new Error('Native Copilot mirror is disabled. Set HAPPY_ENABLE_COPILOT_NATIVE=1 to enable it.');
  }

  let startedBy: 'daemon' | 'terminal' | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--started-by') {
      const value = args[++index];
      if (value !== 'daemon' && value !== 'terminal') throw new Error('Invalid --started-by value');
      startedBy = value;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: HAPPY_ENABLE_COPILOT_NATIVE=1 happy copilot [--started-by terminal|daemon]');
      return;
    }
    throw new Error(`Unknown copilot argument: ${arg}`);
  }

  const { credentials, machineId } = await authAndSetupMachineIfNeeded();
  await ensureDaemonRunning();
  await runCopilotMirror({ credentials, machineId, startedBy });
}
