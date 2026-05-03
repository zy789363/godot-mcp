import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

import { GodotPluginBridge } from '../../src/pluginClient';

describe('GodotPluginBridge', () => {
  let bridge: GodotPluginBridge | undefined;

  afterEach(async () => {
    await bridge?.stop();
    bridge = undefined;
  });

  it('sends JSON-RPC tool calls to a connected Godot plugin and returns the result', async () => {
    bridge = new GodotPluginBridge({ port: 0, requestTimeoutMs: 1000 });
    await bridge.start();

    const url = `ws://127.0.0.1:${bridge.port}`;
    const client = new WebSocket(url);
    const connected = new Promise<void>((resolve) => client.once('open', resolve));

    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      client.send(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          echoedMethod: request.method,
          echoedParams: request.params,
        },
      }));
    });

    await connected;

    const result = await bridge.call('get_project_info', { detail: true });

    expect(result).toEqual({
      echoedMethod: 'get_project_info',
      echoedParams: { detail: true },
    });

    client.close();
  });
});
