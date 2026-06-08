import { describe, expect, it } from 'vitest';
import { TunnelManager, type CommandRunner } from './tunnelManager';

describe('TunnelManager agent-comms helpers', () => {
  it('lists operator Dev Tunnels through injected CommandRunner without touching real tunnels', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = (command, args) => {
      calls.push({ command, args });
      return {
        status: 0,
        stdout: JSON.stringify({
          tunnels: [
            { tunnelId: 'codexu-alpha', name: 'codexu-alpha', ports: [{ portNumber: 3005, portUri: 'https://alpha-3005.devtunnels.ms' }] },
            { tunnelId: 'other', name: 'other', ports: [{ portNumber: 3005, portUri: 'https://other-3005.devtunnels.ms' }] },
          ],
        }),
        stderr: '',
      };
    };

    const tunnels = new TunnelManager({ runner }).listOperatorTunnels();

    expect(calls).toEqual([{ command: 'devtunnel', args: ['list', '--json'] }]);
    expect(tunnels).toEqual([{
      tunnelId: 'codexu-alpha',
      tunnelName: 'codexu-alpha',
      tunnelUrl: 'https://alpha-3005.devtunnels.ms',
      ports: [{ portNumber: 3005, portUri: 'https://alpha-3005.devtunnels.ms' }],
    }]);
  });

  it('mints a connect token through injected CommandRunner without real tunnel access', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: 'connect-token\n', stderr: '' };
    };

    const token = new TunnelManager({ runner }).mintConnectToken('codexu-alpha');

    expect(token).toBe('connect-token');
    expect(calls).toEqual([{ command: 'devtunnel', args: ['token', 'codexu-alpha', '--scope', 'connect'] }]);
  });
});
