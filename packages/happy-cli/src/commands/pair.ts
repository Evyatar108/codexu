import { createDaemonPairingInvite } from '@/daemon/controlClient';

/** Opens an explicit short-lived local/public pairing flow without startup logs. */
export async function handlePairCommand(args: string[]): Promise<void> {
  if (args.includes('--public')) {
    console.log(await createDaemonPairingInvite({ public: true }));
    return;
  }

  const originIndex = args.indexOf('--origin');
  const origin = originIndex >= 0 ? args[originIndex + 1] : undefined;
  if (!origin) {
    throw new Error('Usage: happy pair --origin <exact-origin>');
  }
  const parsed = new URL(origin);
  if (parsed.origin !== origin) {
    throw new Error('--origin must be an exact URL origin without a path, query, or fragment');
  }
  console.log(await createDaemonPairingInvite({ origin }));
}
