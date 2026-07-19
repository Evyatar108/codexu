import type { NativeLocalRpcClient } from '../nativeLocalRpcClient';

type TestOnlyRequest = (
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

export async function sendManagedServerStimulus(
  client: NativeLocalRpcClient,
  sessionId: string,
  prompt: string,
): Promise<void> {
  const request = (client as unknown as { request: TestOnlyRequest }).request.bind(client);
  await request('session.send', { sessionId, prompt }, 120_000);
}
